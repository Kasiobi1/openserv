import { hashCanonical } from "@atl/shared";
import type { EscrowParticipant } from "@atl/backend/src/chain";
import type { BackendClient } from "./http";
import { applyFault, type Fault } from "./faults";
import type { Worker } from "./extractor";

export interface ProviderAgentOptions {
  name: string;
  /** Wallet actions for THIS provider only (its own stake and its own submitResult). It cannot release or slash. */
  participant: EscrowParticipant;
  backend: BackendClient;
  /** The model-driven part. Never sees the wallet. */
  worker: Worker;
  /** Sabotage mode for the deliberately faulty provider. */
  fault?: Fault;
  maxAttempts?: number;
  log?: (line: string) => void;
}

/**
 * Finds jobs assigned to this provider, checks they are really funded on-chain, has the worker do the task,
 * commits the result hash on-chain, then delivers the payload. The model only ever produces text; this class
 * (plain code) decides what gets committed and signs with the provider's own key.
 */
export class ProviderAgent {
  private done = new Set<string>();
  private attempts = new Map<string, number>();
  private unposted = new Map<string, { payload: unknown; payloadHash: `0x${string}` }>();
  private running = false;
  private readonly log: (line: string) => void;

  constructor(private readonly o: ProviderAgentOptions) {
    this.log = (line) => (o.log ?? console.log)(`[${o.name}] ${line}`);
  }

  get address() {
    return this.o.participant.address;
  }

  /** One pass over the job list. Returns the ids it delivered. */
  async tick(): Promise<string[]> {
    const delivered: string[] = [];
    const me = this.address.toLowerCase();

    // A result already committed on-chain but not yet delivered to the backend (e.g. the backend was briefly down).
    for (const [id, s] of this.unposted) {
      const r = await this.o.backend.submit(id, { jobId: id, provider: this.address, payload: s.payload, payloadHash: s.payloadHash });
      if (r.status === 201) {
        this.unposted.delete(id);
        this.done.add(id);
        delivered.push(id);
        this.log(`delivered ${id}`);
      }
    }

    const jobs = await this.o.backend.jobs();
    for (const job of jobs.filter((j) => j.provider.toLowerCase() === me && j.status === "created" && !this.done.has(j.id) && !this.unposted.has(j.id))) {
      const chain = await this.o.participant.jobOnchain(job.id);
      if (!chain || chain.status !== "Funded") continue; // not funded yet, look again next tick

      if (chain.price !== job.spec.maxPrice || BigInt(chain.stakeLocked) < BigInt(job.spec.stakeRequired)) {
        this.log(`skipping ${job.id}: on-chain terms do not match the job spec`);
        this.done.add(job.id);
        continue;
      }
      if (chain.deadline * 1000 < Date.now() + 30_000) {
        this.log(`skipping ${job.id}: deadline too close`);
        this.done.add(job.id);
        continue;
      }

      this.log(`working on ${job.id}`);
      const work = await this.o.worker.extract(job.spec);
      if (!work.ok) {
        const n = (this.attempts.get(job.id) ?? 0) + 1;
        this.attempts.set(job.id, n);
        this.log(`could not complete ${job.id} (attempt ${n}): ${work.error}`);
        if (n >= (this.o.maxAttempts ?? 3)) this.done.add(job.id);
        continue;
      }

      const payload = this.o.fault ? applyFault(work.payload, this.o.fault) : work.payload;
      if (this.o.fault) this.log(`(deliberately faulty: ${this.o.fault})`);
      const payloadHash = hashCanonical(payload);
      await this.o.participant.submitResult(job.id, payloadHash);
      this.unposted.set(job.id, { payload, payloadHash });
      this.log(`committed result hash on-chain for ${job.id}`);
      const r = await this.o.backend.submit(job.id, { jobId: job.id, provider: this.address, payload, payloadHash });
      if (r.status === 201) {
        this.unposted.delete(job.id);
        this.done.add(job.id);
        delivered.push(job.id);
        this.log(`delivered ${job.id}`);
      } else {
        this.log(`backend refused the delivery (${r.status}); will retry`);
      }
    }
    return delivered;
  }

  /** Polls until stop() is called. Errors are logged, never fatal. */
  async run(pollMs = 2000) {
    this.running = true;
    while (this.running) {
      try {
        await this.tick();
      } catch (e) {
        this.log(`error: ${(e as Error).message}`);
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }

  stop() {
    this.running = false;
  }
}
