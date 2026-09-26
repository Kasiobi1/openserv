export interface ReasoningMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ReasoningRequest {
  system?: string;
  messages: ReasoningMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface ReasoningResult {
  text: string;
  /** Which provider instance answered (useful when a fallback is in play). */
  provider: string;
  model: string;
  usage?: { inputTokens: number; outputTokens: number };
}

/**
 * Anything that turns a prompt into text. Everything it returns is an UNTRUSTED PROPOSAL:
 * it may inform a verifier's rationale or a buyer's plan, but never authorizes money movement
 * (only the deterministic policy layer does). Keep implementations swappable.
 */
export interface ReasoningProvider {
  readonly id: string;
  complete(req: ReasoningRequest): Promise<ReasoningResult>;
}

export class ReasoningError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}
