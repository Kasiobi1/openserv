import {
  hashCanonical,
  recoverReportSigner,
  type Job,
  type JobSpec,
  type PolicyCheck,
  type PolicyDecision,
  type Submission,
  type VerificationReport,
} from "@atl/shared";
import type { Score } from "../reputation/score";
import type { OnchainJob } from "./escrow";

export interface PolicyConfig {
  /** Hard cap on escrowed value per job, smallest units. */
  maxSpendPerJob: bigint;
  /** Providers scoring below this (0..1000) cannot be assigned jobs. */
  minProviderScore: number;
  /** Share of provider stake slashed on a failed job, in basis points. */
  slashBps: number;
  /** Verifier addresses whose signed reports the signer will act on. */
  trustedVerifiers: string[];
  reportMaxAgeMs: number;
}

const CLOCK_SKEW_MS = 60_000;

function check(name: string, passed: boolean, detail: string): PolicyCheck {
  return { name, passed, detail };
}

/** Pre-funding gate: spend limit + provider score. */
export function authorizeJob(input: { spec: JobSpec; providerScore: Score }, cfg: PolicyConfig): PolicyDecision {
  const price = BigInt(input.spec.maxPrice);
  const checks = [
    check(
      "spend_limit",
      price <= cfg.maxSpendPerJob,
      price <= cfg.maxSpendPerJob
        ? `price ${price} within per-job limit ${cfg.maxSpendPerJob}`
        : `price ${price} exceeds per-job limit ${cfg.maxSpendPerJob}`,
    ),
    check(
      "provider_score",
      input.providerScore.score >= cfg.minProviderScore,
      `provider score ${input.providerScore.score} (min ${cfg.minProviderScore})`,
    ),
  ];
  return { allowed: checks.every((c) => c.passed), checks };
}

/**
 * Release/slash gate. The report is an untrusted claim until every check here passes.
 * All checks run (no early exit) so the audit trail shows every reason.
 */
export async function authorizeSettlement(
  input: {
    job: Job;
    submission: Submission | null;
    report: VerificationReport;
    now: Date;
    /** undefined = no chain view available; null = chain has no such job. */
    onchain?: OnchainJob | null;
  },
  cfg: PolicyConfig,
): Promise<PolicyDecision> {
  const { job, submission, report, now, onchain } = input;
  const body = report.body;
  const checks: PolicyCheck[] = [];

  checks.push(check("job_state", job.status === "verified", `job status is "${job.status}", must be "verified"`));

  const rec = await recoverReportSigner(report);
  checks.push(check("report_signature", rec.ok, rec.ok ? `signed by ${rec.signer}` : rec.reason));

  const trusted = new Set(cfg.trustedVerifiers.map((a) => a.toLowerCase()));
  const signer = rec.ok ? rec.signer.toLowerCase() : null;
  checks.push(
    check(
      "verifier_trusted",
      signer !== null && trusted.has(signer) && body.verifier.toLowerCase() === signer,
      signer === null ? "no recoverable signer" : trusted.has(signer) ? "signer is on the verifier allowlist" : `signer ${signer} not on allowlist`,
    ),
  );

  const specOk = body.jobId === job.id && body.specHash.toLowerCase() === hashCanonical(job.spec).toLowerCase();
  checks.push(check("report_binds_spec", specOk, specOk ? "report matches job id and spec hash" : "report jobId/specHash does not match this job"));

  const subOk = submission !== null && body.submissionHash.toLowerCase() === submission.payloadHash.toLowerCase();
  checks.push(check("report_binds_submission", subOk, subOk ? "report matches stored submission hash" : "report submissionHash does not match stored submission"));

  const issued = new Date(body.issuedAt).getTime();
  const age = now.getTime() - issued;
  const fresh = age <= cfg.reportMaxAgeMs && age >= -CLOCK_SKEW_MS;
  checks.push(check("report_fresh", fresh, fresh ? `report age ${Math.round(age / 1000)}s` : `report age ${Math.round(age / 1000)}s outside allowed window`));

  const l2 = body.layer2;
  const consistent = body.verdict === "fail" || (body.layer1.passed && (l2 === null || (l2.status === "completed" && l2.passed)));
  checks.push(check("verdict_consistent", consistent, consistent ? "verdict consistent with checks" : 'verdict "pass" contradicts failed or skipped checks'));

  // A verifier must not quietly downgrade a job that asked for an audit.
  const tierOk = body.verdict === "fail" || job.spec.verificationTier !== "auditor" || l2?.status === "completed";
  checks.push(check("tier_satisfied", tierOk, tierOk ? `verification tier "${job.spec.verificationTier}" satisfied` : 'job requires the "auditor" tier but the report has no completed audit'));

  if (onchain !== undefined) {
    const problems: string[] = [];
    if (onchain === null) problems.push("no such job on-chain");
    else {
      if (onchain.status !== "Submitted") problems.push(`on-chain status is ${onchain.status}, must be Submitted`);
      if (submission && onchain.resultHash.toLowerCase() !== submission.payloadHash.toLowerCase()) problems.push("on-chain resultHash differs from the verified submission hash");
      if (onchain.provider.toLowerCase() !== job.provider.toLowerCase()) problems.push("on-chain provider differs");
      if (onchain.buyer.toLowerCase() !== job.spec.buyer.toLowerCase()) problems.push("on-chain buyer differs");
      if (onchain.price !== job.spec.maxPrice) problems.push(`on-chain price ${onchain.price} differs from spec ${job.spec.maxPrice}`);
      if (BigInt(onchain.stakeLocked) < BigInt(job.spec.stakeRequired)) problems.push(`locked stake ${onchain.stakeLocked} below required ${job.spec.stakeRequired}`);
    }
    checks.push(check("onchain_matches", problems.length === 0, problems.length === 0 ? "on-chain job matches spec and submission" : problems.join("; ")));
  }

  const price = BigInt(job.spec.maxPrice);
  checks.push(check("spend_limit", price <= cfg.maxSpendPerJob, `price ${price} vs per-job limit ${cfg.maxSpendPerJob}`));

  const allowed = checks.every((c) => c.passed);
  return { allowed, action: allowed ? (body.verdict === "pass" ? "release" : "refund_and_slash") : undefined, checks };
}
