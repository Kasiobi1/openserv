import { ReasoningError, type ReasoningProvider, type ReasoningRequest, type ReasoningResult } from "./types";

type Script = string | ((req: ReasoningRequest) => string);

/** Deterministic provider for tests and offline dev. Replies are consumed in order. */
export class MockReasoningProvider implements ReasoningProvider {
  readonly id = "mock";
  readonly requests: ReasoningRequest[] = [];
  private queue: Script[];

  constructor(script: Script[] = []) {
    this.queue = [...script];
  }

  push(...s: Script[]) {
    this.queue.push(...s);
  }

  async complete(req: ReasoningRequest): Promise<ReasoningResult> {
    this.requests.push(req);
    const next = this.queue.shift();
    if (next === undefined) throw new ReasoningError("mock: no scripted reply left");
    return { text: typeof next === "function" ? next(req) : next, provider: this.id, model: "mock" };
  }
}
