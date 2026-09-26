import type { AuditEntry, Job, ReputationEvent, Submission, VerificationReport } from "@atl/shared";
import type { Store } from "./types";

export class MemoryStore implements Store {
  private jobs = new Map<string, Job>();
  private submissions = new Map<string, Submission>();
  private reports = new Map<string, VerificationReport>();
  private events: ReputationEvent[] = [];
  private audit: AuditEntry[] = [];

  async insertJob(job: Job) {
    if (this.jobs.has(job.id)) throw new Error(`job ${job.id} already exists`);
    this.jobs.set(job.id, structuredClone(job));
  }
  async getJob(id: string) {
    const j = this.jobs.get(id);
    return j ? structuredClone(j) : null;
  }
  async updateJob(id: string, patch: Partial<Pick<Job, "status" | "settlement">>) {
    const j = this.jobs.get(id);
    if (!j) throw new Error(`job ${id} not found`);
    Object.assign(j, patch);
    return structuredClone(j);
  }
  async listJobs() {
    return [...this.jobs.values()].map((j) => structuredClone(j));
  }
  async insertSubmission(s: Submission) {
    this.submissions.set(s.jobId, structuredClone(s));
  }
  async getSubmission(jobId: string) {
    const s = this.submissions.get(jobId);
    return s ? structuredClone(s) : null;
  }
  async insertReport(r: VerificationReport) {
    this.reports.set(r.body.jobId, structuredClone(r));
  }
  async getReport(jobId: string) {
    const r = this.reports.get(jobId);
    return r ? structuredClone(r) : null;
  }
  async insertReputationEvent(e: ReputationEvent) {
    if (this.events.some((x) => x.jobId === e.jobId)) throw new Error(`reputation event for job ${e.jobId} already exists`);
    this.events.push(structuredClone(e));
  }
  async listReputationEvents(provider?: string) {
    const p = provider?.toLowerCase();
    return this.events.filter((e) => !p || e.provider.toLowerCase() === p).map((e) => structuredClone(e));
  }
  async appendAudit(e: AuditEntry) {
    this.audit.push(structuredClone(e));
  }
  async listAudit(jobId: string) {
    return this.audit.filter((a) => a.jobId === jobId).map((a) => structuredClone(a));
  }
}
