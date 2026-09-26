import { z } from "zod";

export const Address = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "invalid address");
export const Hex32 = z.string().regex(/^0x[a-fA-F0-9]{64}$/, "invalid 32-byte hex");
export const HexString = z.string().regex(/^0x[a-fA-F0-9]+$/, "invalid hex");
/** Token amount in smallest units, as a decimal string (never a JS number). */
export const Amount = z.string().regex(/^\d+$/, "amount must be a non-negative integer string");

export const VerificationTier = z.enum(["schema", "auditor"]);
export type VerificationTier = z.infer<typeof VerificationTier>;

/** Deterministic completeness rules the verifier enforces on top of the JSON Schema. */
export const Completeness = z.object({
  /** Key in the payload that holds the item array. Omit if the payload itself is the array. */
  itemsKey: z.string().optional(),
  expectedItemCount: z.number().int().positive(),
  /** Fields that must be present and non-empty on every item. */
  requiredFields: z.array(z.string()).default([]),
  /** Field whose value must be unique across items (e.g. invoiceNumber). */
  uniqueBy: z.string().optional(),
});
export type Completeness = z.infer<typeof Completeness>;

export const JobSpec = z.object({
  id: z.string().min(1),
  buyer: Address,
  task: z.string().min(1),
  /** JSON Schema (draft-07) the provider's output must satisfy. */
  outputSchema: z.record(z.unknown()),
  completeness: Completeness.optional(),
  /** Optional buyer-supplied source material. Lets the semantic auditor compare output against inputs. */
  inputs: z.unknown().optional(),
  maxPrice: Amount,
  /** Provider stake locked against this job on-chain. */
  stakeRequired: Amount.default("0"),
  verificationTier: VerificationTier.default("schema"),
  deadline: z.string().datetime().optional(),
});
export type JobSpec = z.infer<typeof JobSpec>;

export const Submission = z.object({
  jobId: z.string().min(1),
  provider: Address,
  /** Off-chain payload. Its canonical hash is what goes on-chain. */
  payload: z.unknown(),
  payloadHash: Hex32,
});
export type Submission = z.infer<typeof Submission>;

export const CheckResult = z.object({
  name: z.string(),
  passed: z.boolean(),
  detail: z.string(),
});
export type CheckResult = z.infer<typeof CheckResult>;

export const Verdict = z.enum(["pass", "fail"]);
export type Verdict = z.infer<typeof Verdict>;

export const Severity = z.enum(["minor", "major"]);

export const Concern = z.object({
  /** Index into the delivered items; null = about the delivery as a whole. */
  itemIndex: z.number().int().nonnegative().nullable(),
  severity: Severity,
  explanation: z.string(),
});
export type Concern = z.infer<typeof Concern>;

/**
 * Semantic audit. The model contributes only `concerns` and `summary` (prose + categorical labels).
 * Every number and the `passed` flag are computed by deterministic code from those concerns.
 */
export const Layer2 = z.discriminatedUnion("status", [
  z.object({ status: z.literal("skipped"), reason: z.string() }),
  z.object({
    status: z.literal("completed"),
    passed: z.boolean(),
    provider: z.string(),
    model: z.string(),
    itemsTotal: z.number().int().nonnegative(),
    itemsAudited: z.number().int().nonnegative(),
    flaggedItems: z.number().int().nonnegative(),
    /** 1 - flaggedItems/itemsAudited, 4 decimals. 0 when nothing was audited. */
    confidence: z.number().min(0).max(1),
    concerns: z.array(Concern),
    summary: z.string(),
  }),
]);
export type Layer2 = z.infer<typeof Layer2>;

export const VerificationReportBody = z.object({
  version: z.literal(1),
  jobId: z.string(),
  specHash: Hex32,
  submissionHash: Hex32,
  verifier: Address,
  issuedAt: z.string().datetime(),
  layer1: z.object({ passed: z.boolean(), checks: z.array(CheckResult) }),
  /** null = not requested (tier "schema"). */
  layer2: Layer2.nullable(),
  verdict: Verdict,
});
export type VerificationReportBody = z.infer<typeof VerificationReportBody>;

export const VerificationReport = z.object({
  body: VerificationReportBody,
  /** keccak256 of the canonical JSON of body */
  hash: Hex32,
  /** EIP-191 signature by the verifier over `hash` */
  signature: HexString,
});
export type VerificationReport = z.infer<typeof VerificationReport>;

export const ReputationEvent = z.object({
  id: z.string(),
  provider: Address,
  jobId: z.string(),
  outcome: Verdict,
  amount: Amount,
  reportHash: Hex32,
  occurredAt: z.string().datetime(),
});
export type ReputationEvent = z.infer<typeof ReputationEvent>;

export const JobStatus = z.enum(["created", "submitted", "verified", "released", "slashed", "rejected"]);
export type JobStatus = z.infer<typeof JobStatus>;

export interface Job {
  id: string;
  spec: JobSpec;
  provider: string;
  status: JobStatus;
  createdAt: string;
  settlement?: { action: "release" | "refund_and_slash"; txHash: string; at: string };
}

export interface PolicyCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface PolicyDecision {
  allowed: boolean;
  action?: "release" | "refund_and_slash";
  checks: PolicyCheck[];
}

export interface AuditEntry {
  jobId: string;
  at: string;
  kind:
    | "job_created"
    | "job_rejected"
    | "submission_received"
    | "verification_report"
    | "settlement_approved"
    | "settlement_rejected"
    | "pipeline_error";
  data: unknown;
}
