import type { z } from "zod";
import type { ReasoningProvider, ReasoningRequest, ReasoningResult } from "./types";

export type JsonResult<T> =
  | { ok: true; value: T; raw: ReasoningResult; attempts: number }
  | { ok: false; error: string; raw: ReasoningResult; attempts: number };

function stripFences(text: string): string {
  const t = text.trim();
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (m?.[1] ?? t).trim();
}

function parse<T>(text: string, schema: z.ZodType<T>): { ok: true; value: T } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(stripFences(text));
  } catch {
    return { ok: false, error: "reply was not valid JSON" };
  }
  const r = schema.safeParse(json);
  if (r.success) return { ok: true, value: r.data };
  const issues = r.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
  return { ok: false, error: `JSON did not match schema (${issues.join("; ")})` };
}

/**
 * Ask for JSON and validate it against a zod schema. On a bad reply it retries once with the error fed back.
 * Returns a result instead of throwing on bad model output, because bad output is expected, not exceptional.
 * A successful `value` is schema-valid, NOT trustworthy: treat it as a proposal.
 * Transport errors from the provider still throw.
 */
export async function completeJson<T>(
  provider: ReasoningProvider,
  req: ReasoningRequest,
  schema: z.ZodType<T>,
  opts: { maxAttempts?: number } = {},
): Promise<JsonResult<T>> {
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 2);
  let messages = req.messages;
  let error = "";
  let raw!: ReasoningResult;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    raw = await provider.complete({ ...req, messages });
    const parsed = parse(raw.text, schema);
    if (parsed.ok) return { ok: true, value: parsed.value, raw, attempts: attempt };
    error = parsed.error;
    messages = [
      ...req.messages,
      { role: "assistant", content: raw.text },
      { role: "user", content: `Your previous reply was invalid: ${error}. Reply with only valid JSON that matches the required schema.` },
    ];
  }
  return { ok: false, error, raw, attempts: maxAttempts };
}
