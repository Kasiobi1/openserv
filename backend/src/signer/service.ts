import type { Job, JobSpec, PolicyDecision, Submission, VerificationReport } from "@atl/shared";
import { computeScore, DEFAULT_SCORE_CONFIG, type Score, type ScoreConfig } from "../reputation/score";
import { DomainError } from "../services/errors";
import type { Store } from "../store/types";
import type { EscrowClient } from "./escrow";
import { authorizeJob, authorizeSettlement, type PolicyConfig } from "./policy";

/**
 * The only component allowed to call release/slash. Reasoning agents never reach this class;
 * they can only submit work, and this class acts solely on a valid, trusted, fresh signed report.
 */
export class PolicySigner {
  private inFlight = new Set<string>();

  constructor(
    private readonly store: Store,
    private readonly escrow: EscrowClient,
    private readonly cfg: PolicyConfig,
    private readonly scoreCfg: ScoreConfig = DEFAULT_SCORE_CONFIG,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async scoreOf(provider: string): Promise<Score> {
    return computeScore(await this.store.listReputationEvents(provider), this.clock(), this.scoreCfg);
  }

  async authorizeJob(spec: JobSpec, provider: string): Promise<PolicyDecision> {
    return authorizeJob({ spec, providerScore: await this.scoreOf(provider) }, this.cfg);
  }

  async settle(job: Job, submission: Submission | null, report: VerificationReport) {
    if (this.inFlight.has(job.id)) throw new DomainError(409, "settlement already in progress");
    this.inFlight.add(job.id);
    try {
      const now = this.clock();
      let onchain: Awaited<ReturnType<NonNullable<EscrowClient["describeJob"]>>> | undefined;
      if (this.escrow.describeJob) {
        try {
          onchain = await this.escrow.describeJob(job.id);
        } catch (e) {
          throw new DomainError(502, `could not read on-chain job: ${(e as Error).message}`);
        }
      }
      const decision = await authorizeSettlement({ job, submission, report, now, ...(onchain !== undefined && { onchain }) }, this.cfg);
      if (!decision.allowed || !decision.action) return { decision, txHash: null as string | null };

      let txHash: string;
      try {
        txHash =
          decision.action === "release"
            ? (await this.escrow.release(job.id)).txHash
            : (await this.escrow.refundAndSlash(job.id, this.cfg.slashBps)).txHash;
      } catch (e) {
        throw new DomainError(502, `escrow call failed: ${(e as Error).message}`);
      }

      await this.store.updateJob(job.id, {
        status: decision.action === "release" ? "released" : "slashed",
        settlement: { action: decision.action, txHash, at: now.toISOString() },
      });
      // Reputation is written only from a verified, settled outcome.
      await this.store.insertReputationEvent({
        id: crypto.randomUUID(),
        provider: job.provider,
        jobId: job.id,
        outcome: report.body.verdict,
        amount: job.spec.maxPrice,
        reportHash: report.hash,
        occurredAt: now.toISOString(),
      });
      return { decision, txHash };
    } finally {
      this.inFlight.delete(job.id);
    }
  }
}
