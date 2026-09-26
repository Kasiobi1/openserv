import { hashCanonical, JobSpec, Submission, type Job } from "@atl/shared";
import { computeScore, DEFAULT_SCORE_CONFIG, type ScoreConfig } from "../reputation/score";
import type { PolicySigner } from "../signer/service";
import type { Store } from "../store/types";
import { AuditUnavailable, type Verifier } from "../verifier";
import { DomainError } from "./errors";

/** Orchestrates the job lifecycle. Holds no keys; verification and settlement are delegated. */
export interface PipelineOptions {
  /** After a submission, run verify then settle in the background. */
  auto?: boolean;
  /** Wait between retries when the auditor is unavailable. */
  retryMs?: number;
  maxAttempts?: number;
}

export class JobService {
  private readonly pending = new Set<Promise<void>>();

  constructor(
    private readonly store: Store,
    private readonly verifier: Verifier,
    private readonly signer: PolicySigner,
    private readonly scoreCfg: ScoreConfig = DEFAULT_SCORE_CONFIG,
    private readonly clock: () => Date = () => new Date(),
    private readonly pipeline: PipelineOptions = {},
  ) {}

  get autoPipeline() {
    return this.pipeline.auto === true;
  }

  /** Resolves when all background pipelines have finished (tests and graceful shutdown). */
  async idle() {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }

  private startPipeline(jobId: string) {
    const p = this.runPipeline(jobId).finally(() => this.pending.delete(p));
    this.pending.add(p);
  }

  private async pipelineError(jobId: string, step: string, e: unknown, willRetry: boolean) {
    await this.store.appendAudit({
      jobId,
      at: this.clock().toISOString(),
      kind: "pipeline_error",
      data: { step, message: (e as Error).message, willRetry },
    });
  }

  /** verify -> settle. Only the auditor being unreachable is retried; everything else stops and is logged. */
  private async runPipeline(jobId: string) {
    const max = this.pipeline.maxAttempts ?? 3;
    for (let attempt = 1; attempt <= max; attempt++) {
      try {
        await this.verify(jobId);
        break;
      } catch (e) {
        const retry = e instanceof DomainError && e.status === 503 && attempt < max;
        await this.pipelineError(jobId, "verify", e, retry);
        if (!retry) return;
        await new Promise((r) => setTimeout(r, this.pipeline.retryMs ?? 5000));
      }
    }
    try {
      await this.settle(jobId);
    } catch (e) {
      await this.pipelineError(jobId, "settle", e, false);
    }
  }

  private async mustGet(id: string): Promise<Job> {
    const job = await this.store.getJob(id);
    if (!job) throw new DomainError(404, `job ${id} not found`);
    return job;
  }

  async createJob(specInput: unknown, provider: string) {
    const spec = JobSpec.parse(specInput);
    if (await this.store.getJob(spec.id)) throw new DomainError(409, `job ${spec.id} already exists`);

    const decision = await this.signer.authorizeJob(spec, provider);
    const at = this.clock().toISOString();
    const job: Job = { id: spec.id, spec, provider, status: decision.allowed ? "created" : "rejected", createdAt: at };
    await this.store.insertJob(job);
    await this.store.appendAudit({ jobId: job.id, at, kind: decision.allowed ? "job_created" : "job_rejected", data: decision });
    return { job, decision };
  }

  async submit(jobId: string, input: unknown) {
    const job = await this.mustGet(jobId);
    const submission = Submission.parse(input);
    if (job.status !== "created") throw new DomainError(409, `job is "${job.status}", cannot accept a submission`);
    if (submission.jobId !== job.id) throw new DomainError(400, "submission jobId mismatch");
    if (submission.provider.toLowerCase() !== job.provider.toLowerCase()) throw new DomainError(403, "submitter is not the assigned provider");

    await this.store.insertSubmission(submission);
    await this.store.updateJob(job.id, { status: "submitted" });
    await this.store.appendAudit({
      jobId,
      at: this.clock().toISOString(),
      kind: "submission_received",
      data: { payloadHash: submission.payloadHash, provider: submission.provider },
    });
    if (this.autoPipeline) this.startPipeline(jobId);
    return { payloadHash: submission.payloadHash };
  }

  async verify(jobId: string) {
    const job = await this.mustGet(jobId);
    if (job.status !== "submitted") throw new DomainError(409, `job is "${job.status}", nothing to verify`);
    const submission = await this.store.getSubmission(jobId);
    if (!submission) throw new DomainError(409, "no submission on file");

    let report;
    try {
      report = await this.verifier.verify(job.spec, submission);
    } catch (e) {
      // Infrastructure problem, not the provider's fault: no report, no slash, job stays "submitted" for a retry.
      if (e instanceof AuditUnavailable) throw new DomainError(503, `audit unavailable: ${e.message}`);
      throw e;
    }
    await this.store.insertReport(report);
    await this.store.updateJob(jobId, { status: "verified" });
    await this.store.appendAudit({
      jobId,
      at: this.clock().toISOString(),
      kind: "verification_report",
      data: { reportHash: report.hash, verdict: report.body.verdict, checks: report.body.layer1.checks },
    });
    return report;
  }

  async settle(jobId: string) {
    const job = await this.mustGet(jobId);
    const [submission, report] = await Promise.all([this.store.getSubmission(jobId), this.store.getReport(jobId)]);
    if (!report) throw new DomainError(409, "no verification report on file");

    const { decision, txHash } = await this.signer.settle(job, submission, report);
    await this.store.appendAudit({
      jobId,
      at: this.clock().toISOString(),
      kind: decision.allowed ? "settlement_approved" : "settlement_rejected",
      data: { action: decision.action ?? null, txHash, checks: decision.checks },
    });
    return { decision, txHash, job: await this.mustGet(jobId) };
  }

  async getJobDetail(jobId: string) {
    const job = await this.mustGet(jobId);
    const [submission, report, audit] = await Promise.all([
      this.store.getSubmission(jobId),
      this.store.getReport(jobId),
      this.store.listAudit(jobId),
    ]);
    return { job, specHash: hashCanonical(job.spec), submission, report, audit };
  }

  async listJobs() {
    return this.store.listJobs();
  }

  async providerScore(provider: string) {
    return { provider, ...computeScore(await this.store.listReputationEvents(provider), this.clock(), this.scoreCfg) };
  }

  async leaderboard() {
    const [jobs, events] = await Promise.all([this.store.listJobs(), this.store.listReputationEvents()]);
    const providers = new Map<string, string>();
    for (const p of [...jobs.map((j) => j.provider), ...events.map((e) => e.provider)]) providers.set(p.toLowerCase(), p);
    const rows = [...providers.values()].map((p) => ({
      provider: p,
      ...computeScore(events.filter((e) => e.provider.toLowerCase() === p.toLowerCase()), this.clock(), this.scoreCfg),
    }));
    return rows.sort((a, b) => b.score - a.score);
  }
}
