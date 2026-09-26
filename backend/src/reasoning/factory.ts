import { MockReasoningProvider } from "./mock";
import { OpenAICompatibleProvider } from "./openai-compatible";
import type { ReasoningProvider } from "./types";

export interface ReasoningEnv {
  REASONING_PROVIDER: "mock" | "serv" | "openai-compatible";
  REASONING_BASE_URL?: string | undefined;
  REASONING_API_KEY?: string | undefined;
  REASONING_MODEL?: string | undefined;
}

/** Per the brief: SERV Reasoning is OpenAI-SDK compatible at this base URL. Model name and access are not confirmed. */
export const SERV_BASE_URL = "https://inference-api.openserv.ai/v1";

export function createReasoningProvider(env: ReasoningEnv, fetchImpl?: typeof fetch): ReasoningProvider {
  if (env.REASONING_PROVIDER === "mock") return new MockReasoningProvider();

  const baseUrl = env.REASONING_BASE_URL ?? (env.REASONING_PROVIDER === "serv" ? SERV_BASE_URL : undefined);
  const missing = [
    !baseUrl && "REASONING_BASE_URL",
    !env.REASONING_API_KEY && "REASONING_API_KEY",
    !env.REASONING_MODEL && "REASONING_MODEL",
  ].filter(Boolean);
  if (missing.length) throw new Error(`reasoning provider "${env.REASONING_PROVIDER}" needs: ${missing.join(", ")}`);

  return new OpenAICompatibleProvider({
    id: env.REASONING_PROVIDER,
    baseUrl: baseUrl!,
    apiKey: env.REASONING_API_KEY!,
    model: env.REASONING_MODEL!,
    ...(fetchImpl && { fetch: fetchImpl }),
  });
}
