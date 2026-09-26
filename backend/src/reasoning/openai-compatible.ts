import { z } from "zod";
import { ReasoningError, type ReasoningProvider, type ReasoningRequest, type ReasoningResult } from "./types";

const ChatResponse = z.object({
  model: z.string().optional(),
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
  usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number() }).optional(),
});

export interface OpenAICompatibleOptions {
  id: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  /**
   * Sent whenever a request omits its own `maxTokens`. Some gateways (SERV included), when max_tokens is left
   * out entirely, silently default it to "whatever's left in the context window" — for a long prompt that can
   * exceed the model's own per-request completion-token ceiling and the call fails outright. Every one of our
   * tasks returns a short JSON object, so a modest cap is always enough and never the wrong call here.
   */
  defaultMaxTokens?: number;
  /** Injectable for tests. */
  fetch?: typeof fetch;
}

const FALLBACK_MAX_TOKENS = 4096;

/** Talks to any OpenAI-style `/chat/completions` endpoint. SERV Reasoning is this with a different base URL. */
export class OpenAICompatibleProvider implements ReasoningProvider {
  readonly id: string;
  private readonly url: string;
  /**
   * Newer reasoning-family models (some SERV rows included) reject `max_tokens` outright and require
   * `max_completion_tokens` instead. Learned on first failure and cached for the life of this instance, so
   * only the very first call on a model that needs it pays for the extra round trip.
   */
  private maxTokensField: "max_tokens" | "max_completion_tokens" = "max_tokens";

  constructor(private readonly o: OpenAICompatibleOptions) {
    this.id = o.id;
    this.url = `${o.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  }

  async complete(req: ReasoningRequest): Promise<ReasoningResult> {
    const messages = [...(req.system ? [{ role: "system", content: req.system }] : []), ...req.messages];
    const maxTokens = req.maxTokens ?? this.o.defaultMaxTokens ?? FALLBACK_MAX_TOKENS;
    let res: Response;
    try {
      res = await (this.o.fetch ?? fetch)(this.url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.o.apiKey}` },
        body: JSON.stringify({
          model: this.o.model,
          messages,
          ...(req.temperature !== undefined && { temperature: req.temperature }),
          [this.maxTokensField]: maxTokens,
        }),
        signal: AbortSignal.timeout(this.o.timeoutMs ?? 60_000),
      });
    } catch (e) {
      throw new ReasoningError(`${this.id}: request failed: ${(e as Error).message}`);
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      // Some models (e.g. reasoning-style GPT-5 rows) reject a fixed temperature. Retry once without it.
      if (res.status === 400 && req.temperature !== undefined && /temperature/i.test(detail)) {
        const { temperature: _dropped, ...rest } = req;
        return this.complete(rest);
      }
      // Some models reject `max_tokens` and name their own replacement in the error. Learn it once, retry.
      if (res.status === 400 && this.maxTokensField === "max_tokens" && /max_completion_tokens/i.test(detail)) {
        this.maxTokensField = "max_completion_tokens";
        return this.complete(req);
      }
      const snippet = detail.slice(0, 300).replace(/\s+/g, " ").trim();
      throw new ReasoningError(`${this.id}: HTTP ${res.status}${snippet ? ` - ${snippet}` : ""}`, res.status);
    }

    const parsed = ChatResponse.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new ReasoningError(`${this.id}: unexpected response shape`);
    const { choices, usage, model } = parsed.data;
    return {
      text: choices[0]!.message.content ?? "",
      provider: this.id,
      model: model ?? this.o.model,
      ...(usage && { usage: { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens } }),
    };
  }
}
