import type { JobSpec } from "@atl/shared";
import type { EscrowParticipant } from "@atl/backend/src/chain";
import type { BackendClient } from "./http";

export type PostResult = { ok: true } | { ok: false; reasons: string[] };

export interface Outcome {
  detail: any;
  /** true if the job reached released / slashed / rejected */
  finished: boolean;
}

/** The buyer. Authorizes with the policy layer first, then funds the escrow from its own wallet. */
export class BuyerAgent {
  constructor(private readonly o: { participant: EscrowParticipant; backend: BackendClient; log?: (l: string) => void }) {}

  get address() {
    return this.o.participant.address;
  }

  private log(l: string) {
    (this.o.log ?? console.log)(`[buyer] ${l}`);
  }

  /** Ask the policy layer first; only a job it authorizes gets funded. */
  async postJob(spec: JobSpec, provider: string): Promise<PostResult> {
    const r = await this.o.backend.postJob(spec, provider);
    if (r.status === 403) {
      const reasons = (r.body.decision.checks as { passed: boolean; name: string; detail: string }[]).filter((c) => !c.passed).map((c) => `${c.name}: ${c.detail}`);
      return { ok: false, reasons };
    }
    if (r.status !== 201) throw new Error(`posting the job failed: ${r.status} ${JSON.stringify(r.body)}`);
    await this.o.participant.createJob(spec, provider as `0x${string}`);
    this.log(`funded ${spec.id} on-chain`);
    return { ok: true };
  }

  /**
   * Waits for the job to finish. If the backend is not running the automatic pipeline (`drive`), this nudges
   * verify and settle along, as an operator would.
   */
  async waitForOutcome(jobId: string, o: { drive: boolean; timeoutMs?: number; pollMs?: number }): Promise<Outcome> {
    const deadline = Date.now() + (o.timeoutMs ?? 180_000);
    let last: any = null;
    while (Date.now() < deadline) {
      const r = await this.o.backend.job(jobId);
      last = r.body;
      const status = last?.job?.status as string | undefined;
      if (status === "released" || status === "slashed" || status === "rejected") return { detail: last, finished: true };
      if (o.drive && status === "submitted") await this.o.backend.verify(jobId);
      if (o.drive && status === "verified") {
        const s = await this.o.backend.settle(jobId);
        if (s.status === 422) return { detail: (await this.o.backend.job(jobId)).body, finished: false }; // refused: nothing more will happen
      }
      await new Promise((r) => setTimeout(r, o.pollMs ?? 1500));
    }
    return { detail: last, finished: false };
  }
}
