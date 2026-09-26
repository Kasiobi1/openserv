import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  FallbackReasoningProvider,
  MockReasoningProvider,
  OpenAICompatibleProvider,
  ReasoningError,
  SERV_BASE_URL,
  completeJson,
  createReasoningProvider,
} from "../src/reasoning";

const Verdict = z.object({ ok: z.boolean(), rationale: z.string() });

describe("completeJson", () => {
  it("parses plain and fenced JSON", async () => {
    const p = new MockReasoningProvider(['{"ok":true,"rationale":"fine"}', '```json\n{"ok":false,"rationale":"bad"}\n```']);
    const a = await completeJson(p, { messages: [{ role: "user", content: "x" }] }, Verdict);
    const b = await completeJson(p, { messages: [{ role: "user", content: "x" }] }, Verdict);
    expect(a).toMatchObject({ ok: true, value: { ok: true }, attempts: 1 });
    expect(b).toMatchObject({ ok: true, value: { ok: false } });
  });

  it("retries once with the error fed back, then succeeds", async () => {
    const p = new MockReasoningProvider(["not json", '{"ok":true,"rationale":"r"}']);
    const r = await completeJson(p, { messages: [{ role: "user", content: "x" }] }, Verdict);
    expect(r).toMatchObject({ ok: true, attempts: 2 });
    const retryMsgs = p.requests[1]!.messages;
    expect(retryMsgs.at(-1)!.content).toContain("not valid JSON");
    expect(retryMsgs.at(-2)).toEqual({ role: "assistant", content: "not json" });
  });

  it("returns ok:false (does not throw) when output stays invalid", async () => {
    const p = new MockReasoningProvider(['{"ok":"yes"}', '{"ok":"yes"}']);
    const r = await completeJson(p, { messages: [{ role: "user", content: "x" }] }, Verdict);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("did not match schema");
  });

  it("propagates transport errors", async () => {
    const p = new MockReasoningProvider([]);
    await expect(completeJson(p, { messages: [] }, Verdict)).rejects.toBeInstanceOf(ReasoningError);
  });
});

describe("OpenAICompatibleProvider", () => {
  const okBody = { model: "m-1", choices: [{ message: { content: "hello" } }], usage: { prompt_tokens: 3, completion_tokens: 2 } };

  it("posts to {base}/chat/completions with bearer auth and maps the response", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify(okBody), { status: 200 });
    }) as unknown as typeof fetch;
    const p = new OpenAICompatibleProvider({ id: "t", baseUrl: "https://x.test/v1/", apiKey: "k", model: "m", fetch: fakeFetch });

    const r = await p.complete({ system: "sys", messages: [{ role: "user", content: "hi" }], temperature: 0, maxTokens: 50 });
    expect(seen!.url).toBe("https://x.test/v1/chat/completions");
    expect((seen!.init.headers as Record<string, string>).authorization).toBe("Bearer k");
    expect(JSON.parse(seen!.init.body as string)).toEqual({
      model: "m",
      messages: [{ role: "system", content: "sys" }, { role: "user", content: "hi" }],
      temperature: 0,
      max_tokens: 50,
    });
    expect(r).toEqual({ text: "hello", provider: "t", model: "m-1", usage: { inputTokens: 3, outputTokens: 2 } });
  });

  it("throws ReasoningError on HTTP errors and malformed bodies", async () => {
    const mk = (res: () => Response) =>
      new OpenAICompatibleProvider({ id: "t", baseUrl: "https://x.test/v1", apiKey: "k", model: "m", fetch: (async () => res()) as unknown as typeof fetch });
    await expect(mk(() => new Response("no", { status: 401 })).complete({ messages: [] })).rejects.toMatchObject({ status: 401 });
    await expect(mk(() => new Response("insufficient credits", { status: 400 })).complete({ messages: [] })).rejects.toMatchObject({ status: 400, message: expect.stringContaining("insufficient credits") });
    await expect(mk(() => new Response(JSON.stringify({ nope: 1 }), { status: 200 })).complete({ messages: [] })).rejects.toThrow("unexpected response shape");
  });

  it("always sends an explicit max_tokens, never omits it (regression: a real run got HTTP 400 'max_tokens is too large' when the gateway auto-computed one)", async () => {
    let seenBody: Record<string, unknown> | undefined;
    const f = (async (_u: string, init: RequestInit) => {
      seenBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify(okBody), { status: 200 });
    }) as unknown as typeof fetch;
    const p = new OpenAICompatibleProvider({ id: "t", baseUrl: "https://x.test/v1", apiKey: "k", model: "m", fetch: f });
    await p.complete({ messages: [{ role: "user", content: "hi" }] }); // no maxTokens given
    expect(seenBody!.max_tokens).toBeTypeOf("number");
    expect(seenBody!.max_tokens).toBeGreaterThan(0);
  });

  it("switches to max_completion_tokens after the model rejects max_tokens by name, and keeps using it on later calls (regression: a real run got HTTP 400 'Unsupported parameter: max_tokens... Use max_completion_tokens instead')", async () => {
    const bodies: Record<string, unknown>[] = [];
    const f = (async (_u: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      bodies.push(body);
      if ("max_tokens" in body) {
        return new Response(JSON.stringify({ error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.", type: "invalid_request_error", param: "max_tokens", code: "unsupported_parameter" } }), { status: 400 });
      }
      return new Response(JSON.stringify(okBody), { status: 200 });
    }) as unknown as typeof fetch;
    const p = new OpenAICompatibleProvider({ id: "t", baseUrl: "https://x.test/v1", apiKey: "k", model: "m", fetch: f });

    const first = await p.complete({ messages: [{ role: "user", content: "hi" }] });
    expect(first.text).toBe("hello");
    expect(bodies).toHaveLength(2); // failed with max_tokens, succeeded with max_completion_tokens
    expect(bodies[1]!.max_completion_tokens).toBeTypeOf("number");
    expect("max_tokens" in bodies[1]!).toBe(false);

    await p.complete({ messages: [{ role: "user", content: "again" }] });
    expect(bodies).toHaveLength(3); // no wasted retry the second time; goes straight to the learned field
    expect(bodies[2]!.max_completion_tokens).toBeTypeOf("number");
  });
});

describe("temperature handling", () => {
  it("retries once without temperature when the model rejects it", async () => {
    const bodies: Record<string, unknown>[] = [];
    const f = (async (_u: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      bodies.push(body);
      if ("temperature" in body) return new Response(JSON.stringify({ error: { message: "Unsupported value: 'temperature' does not support 0 with this model" } }), { status: 400 });
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const p = new OpenAICompatibleProvider({ id: "t", baseUrl: "https://x.test/v1", apiKey: "k", model: "m", fetch: f });
    expect((await p.complete({ messages: [], temperature: 0 })).text).toBe("ok");
    expect(bodies).toHaveLength(2);
    expect("temperature" in bodies[1]!).toBe(false);
  });

  it("does not retry other 400s", async () => {
    let calls = 0;
    const f = (async () => { calls++; return new Response("bad model", { status: 400 }); }) as unknown as typeof fetch;
    const p = new OpenAICompatibleProvider({ id: "t", baseUrl: "https://x.test/v1", apiKey: "k", model: "m", fetch: f });
    await expect(p.complete({ messages: [], temperature: 0 })).rejects.toMatchObject({ status: 400 });
    expect(calls).toBe(1);
  });
});

describe("fallback + factory", () => {
  it("uses the fallback when the primary throws, not otherwise", async () => {
    const good = new MockReasoningProvider(["primary"]);
    const bad = new MockReasoningProvider([]);
    const backup = new MockReasoningProvider(["backup"]);
    expect((await new FallbackReasoningProvider(good, backup).complete({ messages: [] })).text).toBe("primary");
    expect((await new FallbackReasoningProvider(bad, backup).complete({ messages: [] })).text).toBe("backup");
  });

  it("defaults to mock, and serv defaults its base URL but still needs key + model", async () => {
    expect(createReasoningProvider({ REASONING_PROVIDER: "mock" }).id).toBe("mock");
    expect(() => createReasoningProvider({ REASONING_PROVIDER: "serv" })).toThrow("REASONING_API_KEY, REASONING_MODEL");
    expect(() => createReasoningProvider({ REASONING_PROVIDER: "openai-compatible", REASONING_API_KEY: "k", REASONING_MODEL: "m" })).toThrow("REASONING_BASE_URL");

    let url = "";
    const f = (async (u: string) => { url = u; return new Response(JSON.stringify({ choices: [{ message: { content: "x" } }] })); }) as unknown as typeof fetch;
    await createReasoningProvider({ REASONING_PROVIDER: "serv", REASONING_API_KEY: "k", REASONING_MODEL: "m" }, f).complete({ messages: [] });
    expect(url).toBe(`${SERV_BASE_URL}/chat/completions`);
  });
});
