import type { ReasoningProvider, ReasoningRequest, ReasoningResult } from "./types";

/** Try `primary`; on any transport error use `fallback`. Keeps the verifier portable across providers. */
export class FallbackReasoningProvider implements ReasoningProvider {
  readonly id: string;
  constructor(private readonly primary: ReasoningProvider, private readonly fallback: ReasoningProvider) {
    this.id = `${primary.id}>${fallback.id}`;
  }
  async complete(req: ReasoningRequest): Promise<ReasoningResult> {
    try {
      return await this.primary.complete(req);
    } catch {
      return this.fallback.complete(req);
    }
  }
}
