import {
  addressOf,
  hashCanonical,
  signReport,
  type Layer2,
  type JobSpec,
  type Submission,
  type VerificationReport,
  type VerificationReportBody,
} from "@atl/shared";
import { runLayer1 } from "./layer1";
import { AuditUnavailable, type SemanticAuditor } from "./layer2";

export { AuditUnavailable } from "./layer2";
type Hex = `0x${string}`;

/**
 * Holds the verifier key. It signs reports and nothing else: it cannot move funds,
 * and the policy signer trusts it only if its address is on the allowlist.
 */
export class Verifier {
  readonly address: Hex;
  constructor(
    private readonly privateKey: Hex,
    private readonly clock: () => Date = () => new Date(),
    private readonly auditor?: SemanticAuditor,
  ) {
    this.address = addressOf(privateKey);
  }

  async verify(spec: JobSpec, submission: Submission): Promise<VerificationReport> {
    if (submission.jobId !== spec.id) throw new Error("submission does not belong to this job");
    const layer1 = runLayer1(spec, submission);

    let layer2: Layer2 | null = null;
    if (spec.verificationTier === "auditor") {
      if (!layer1.passed) {
        layer2 = { status: "skipped", reason: "layer1_failed" };
      } else if (!this.auditor) {
        throw new AuditUnavailable("job requires an auditor but none is configured");
      } else {
        layer2 = await this.auditor.audit(spec, submission); // throws AuditUnavailable: no report is issued
      }
    }

    const layer2Ok = layer2 === null || (layer2.status === "completed" && layer2.passed);
    const body: VerificationReportBody = {
      version: 1,
      jobId: spec.id,
      specHash: hashCanonical(spec),
      submissionHash: submission.payloadHash as Hex,
      verifier: this.address,
      issuedAt: this.clock().toISOString(),
      layer1,
      layer2,
      verdict: layer1.passed && layer2Ok ? "pass" : "fail",
    };
    return signReport(body, this.privateKey);
  }
}
