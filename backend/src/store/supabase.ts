import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { hashCanonical, type AuditEntry, type Job, type ReputationEvent, type Submission, type VerificationReport } from "@atl/shared";
import type { Store } from "./types";

/** The slice of the Supabase client this adapter actually calls. Narrow on purpose: keeps it easy to fake in tests. */
export type SbClient = Pick<SupabaseClient, "from">;

const DUPLICATE = "23505"; // Postgres unique_violation

function fail(error: { code?: string; message: string } | null, onDuplicate?: string): never {
  if (error?.code === DUPLICATE && onDuplicate) throw new Error(onDuplicate);
  throw new Error(error?.message ?? "unknown database error");
}

interface JobRow {
  id: string;
  provider: string;
  spec: Job["spec"];
  status: Job["status"];
  settlement: Job["settlement"] | null;
  created_at: string;
}
const rowToJob = (r: JobRow): Job => ({
  id: r.id,
  spec: r.spec,
  provider: r.provider,
  status: r.status,
  createdAt: r.created_at,
  ...(r.settlement && { settlement: r.settlement }),
});

interface SubmissionRow { job_id: string; provider: string; payload: unknown; payload_hash: string }
const rowToSubmission = (r: SubmissionRow): Submission => ({ jobId: r.job_id, provider: r.provider, payload: r.payload, payloadHash: r.payload_hash as `0x${string}` });

interface ReportRow { body: VerificationReport["body"]; report_hash: string; signature: string }
const rowToReport = (r: ReportRow): VerificationReport => ({ body: r.body, hash: r.report_hash as `0x${string}`, signature: r.signature });

interface ReputationRow { id: string; provider: string; job_id: string; outcome: ReputationEvent["outcome"]; amount: string; report_hash: string; occurred_at: string }
const rowToEvent = (r: ReputationRow): ReputationEvent => ({ id: r.id, provider: r.provider, jobId: r.job_id, outcome: r.outcome, amount: r.amount, reportHash: r.report_hash as `0x${string}`, occurredAt: r.occurred_at });

interface AuditRow { job_id: string; kind: AuditEntry["kind"]; data: unknown; at: string }
const rowToAudit = (r: AuditRow): AuditEntry => ({ jobId: r.job_id, kind: r.kind, data: r.data, at: r.at });

/**
 * Persists through Supabase's PostgREST API using the secret (service-role) key, so it bypasses row-level
 * security by design — this class IS the trusted backend. Matches the schema in supabase/migrations/0001_init.sql.
 * Give the anon/publishable key only to something that should get read-only access (e.g. a dashboard talking to
 * Supabase directly); this codebase's dashboard instead reads the backend's own API, so that key currently goes unused here.
 */
export class SupabaseStore implements Store {
  constructor(private readonly sb: SbClient) {}

  async insertJob(job: Job): Promise<void> {
    const { error } = await this.sb.from("jobs").insert({
      id: job.id,
      buyer: job.spec.buyer,
      provider: job.provider,
      spec: job.spec,
      spec_hash: hashCanonical(job.spec),
      max_price: job.spec.maxPrice,
      status: job.status,
      settlement: job.settlement ?? null,
      created_at: job.createdAt,
    });
    if (error) fail(error, `job ${job.id} already exists`);
  }

  async getJob(id: string): Promise<Job | null> {
    const { data, error } = await this.sb.from("jobs").select("*").eq("id", id).maybeSingle();
    if (error) fail(error);
    return data ? rowToJob(data as JobRow) : null;
  }

  async updateJob(id: string, patch: Partial<Pick<Job, "status" | "settlement">>): Promise<Job> {
    const update: Record<string, unknown> = {};
    if (patch.status !== undefined) update.status = patch.status;
    if (patch.settlement !== undefined) update.settlement = patch.settlement;
    const { error } = await this.sb.from("jobs").update(update).eq("id", id);
    if (error) fail(error);
    const job = await this.getJob(id);
    if (!job) throw new Error(`job ${id} not found`);
    return job;
  }

  async listJobs(): Promise<Job[]> {
    const { data, error } = await this.sb.from("jobs").select("*").order("created_at", { ascending: false });
    if (error) fail(error);
    return ((data ?? []) as JobRow[]).map(rowToJob);
  }

  async insertSubmission(s: Submission): Promise<void> {
    const { error } = await this.sb.from("submissions").insert({ job_id: s.jobId, provider: s.provider, payload: s.payload, payload_hash: s.payloadHash });
    if (error) fail(error, `submission for job ${s.jobId} already exists`);
  }

  async getSubmission(jobId: string): Promise<Submission | null> {
    const { data, error } = await this.sb.from("submissions").select("*").eq("job_id", jobId).maybeSingle();
    if (error) fail(error);
    return data ? rowToSubmission(data as SubmissionRow) : null;
  }

  async insertReport(r: VerificationReport): Promise<void> {
    const { error } = await this.sb.from("verification_reports").insert({
      job_id: r.body.jobId,
      report_hash: r.hash,
      body: r.body,
      signature: r.signature,
      verifier: r.body.verifier,
      verdict: r.body.verdict,
    });
    if (error) fail(error, `report for job ${r.body.jobId} already exists`);
  }

  async getReport(jobId: string): Promise<VerificationReport | null> {
    const { data, error } = await this.sb.from("verification_reports").select("*").eq("job_id", jobId).maybeSingle();
    if (error) fail(error);
    return data ? rowToReport(data as ReportRow) : null;
  }

  async insertReputationEvent(e: ReputationEvent): Promise<void> {
    const { error } = await this.sb.from("reputation_events").insert({
      id: e.id,
      provider: e.provider,
      job_id: e.jobId,
      outcome: e.outcome,
      amount: e.amount,
      report_hash: e.reportHash,
      occurred_at: e.occurredAt,
    });
    if (error) fail(error, `reputation event for job ${e.jobId} already exists`);
  }

  async listReputationEvents(provider?: string): Promise<ReputationEvent[]> {
    let q = this.sb.from("reputation_events").select("*").order("occurred_at", { ascending: true });
    if (provider) q = q.ilike("provider", provider); // no wildcards in `provider` => exact, case-insensitive match
    const { data, error } = await q;
    if (error) fail(error);
    return ((data ?? []) as ReputationRow[]).map(rowToEvent);
  }

  async appendAudit(e: AuditEntry): Promise<void> {
    const { error } = await this.sb.from("audit_log").insert({ job_id: e.jobId, kind: e.kind, data: e.data, at: e.at });
    if (error) fail(error);
  }

  async listAudit(jobId: string): Promise<AuditEntry[]> {
    const { data, error } = await this.sb.from("audit_log").select("*").eq("job_id", jobId).order("id", { ascending: true });
    if (error) fail(error);
    return ((data ?? []) as AuditRow[]).map(rowToAudit);
  }
}

export function createSupabaseStore(url: string, secretKey: string): SupabaseStore {
  return new SupabaseStore(createClient(url, secretKey, { auth: { persistSession: false } }));
}
