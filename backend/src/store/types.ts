import type { AuditEntry, Job, ReputationEvent, Submission, VerificationReport } from "@atl/shared";

/** Persistence boundary. In-memory now; Supabase adapter implements the same interface. */
export interface Store {
  insertJob(job: Job): Promise<void>;
  getJob(id: string): Promise<Job | null>;
  updateJob(id: string, patch: Partial<Pick<Job, "status" | "settlement">>): Promise<Job>;
  listJobs(): Promise<Job[]>;
  insertSubmission(s: Submission): Promise<void>;
  getSubmission(jobId: string): Promise<Submission | null>;
  insertReport(r: VerificationReport): Promise<void>;
  getReport(jobId: string): Promise<VerificationReport | null>;
  insertReputationEvent(e: ReputationEvent): Promise<void>;
  listReputationEvents(provider?: string): Promise<ReputationEvent[]>;
  appendAudit(e: AuditEntry): Promise<void>;
  listAudit(jobId: string): Promise<AuditEntry[]>;
}
