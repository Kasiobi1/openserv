import { describe, expect, it } from "vitest";
import { hashCanonical, type Job, type ReputationEvent, type VerificationReport } from "@atl/shared";
import { SupabaseStore } from "../src/store/supabase";
import { FakeSupabase, type Call } from "./fake-supabase";
import { HONEST, honestPayload, invoiceSpec, submissionFor } from "./fixtures";

const job = (): Job => ({ id: "j1", spec: invoiceSpec("j1"), provider: HONEST, status: "created", createdAt: "2026-09-23T00:00:00.000Z" });
const ok = (data: unknown = null) => ({ data, error: null });
const dup = { data: null, error: { code: "23505", message: "duplicate key" } };

describe("SupabaseStore: writes send correctly-shaped rows", () => {
  it("insertJob computes spec_hash and stores settlement as null", async () => {
    let seen: Call | undefined;
    const sb = new FakeSupabase((c) => { seen = c; return ok(); });
    await new SupabaseStore(sb).insertJob(job());
    expect(seen!.table).toBe("jobs");
    expect(seen!.op).toBe("insert");
    expect(seen!.payload).toMatchObject({ id: "j1", buyer: job().spec.buyer, provider: HONEST, status: "created", settlement: null, spec_hash: hashCanonical(job().spec) });
  });

  it("insertSubmission, insertReport, insertReputationEvent, appendAudit map to the right tables and columns", async () => {
    const calls: Call[] = [];
    const sb = new FakeSupabase((c) => { calls.push({ ...c }); return ok(); });
    const store = new SupabaseStore(sb);

    await store.insertSubmission(submissionFor("j1", HONEST, honestPayload()));
    expect(calls[0]).toMatchObject({ table: "submissions", op: "insert", payload: { job_id: "j1", provider: HONEST } });

    const report: VerificationReport = { body: { version: 1, jobId: "j1", specHash: "0x" + "0".repeat(64), submissionHash: "0x" + "1".repeat(64), verifier: HONEST, issuedAt: "2026-09-23T00:00:00.000Z", layer1: { passed: true, checks: [] }, layer2: null, verdict: "pass" }, hash: ("0x" + "2".repeat(64)) as `0x${string}`, signature: "0xsig" };
    await store.insertReport(report);
    expect(calls[1]).toMatchObject({ table: "verification_reports", op: "insert", payload: { job_id: "j1", report_hash: report.hash, verifier: HONEST, verdict: "pass" } });

    const event: ReputationEvent = { id: "e1", provider: HONEST, jobId: "j1", outcome: "pass", amount: "10000000", reportHash: report.hash, occurredAt: "2026-09-23T00:00:00.000Z" };
    await store.insertReputationEvent(event);
    expect(calls[2]).toMatchObject({ table: "reputation_events", op: "insert", payload: { job_id: "j1", report_hash: report.hash } });

    await store.appendAudit({ jobId: "j1", at: "2026-09-23T00:00:00.000Z", kind: "job_created", data: { ok: true } });
    expect(calls[3]).toMatchObject({ table: "audit_log", op: "insert", payload: { job_id: "j1", kind: "job_created" } });
  });

  it("filters reputation events by provider with a wildcard-free ilike (exact, case-insensitive)", async () => {
    let seen: Call | undefined;
    const sb = new FakeSupabase((c) => { seen = c; return ok([]); });
    await new SupabaseStore(sb).listReputationEvents(HONEST);
    expect(seen!.filters).toContainEqual({ method: "ilike", args: ["provider", HONEST] });
  });
});

describe("SupabaseStore: reads map rows back to the shared types", () => {
  it("getJob maps a row to a Job, including settlement when present", async () => {
    const row = { id: "j1", provider: HONEST, spec: job().spec, status: "released", settlement: { action: "release", txHash: "0xabc", at: "2026-09-23T01:00:00.000Z" }, created_at: "2026-09-23T00:00:00.000Z" };
    const store = new SupabaseStore(new FakeSupabase(() => ok(row)));
    expect(await store.getJob("j1")).toEqual({ id: "j1", provider: HONEST, spec: row.spec, status: "released", createdAt: row.created_at, settlement: row.settlement });
  });

  it("getJob returns null, never a row, when nothing matches", async () => {
    const store = new SupabaseStore(new FakeSupabase(() => ok(null)));
    expect(await store.getJob("nope")).toBeNull();
  });

  it("listJobs maps every row", async () => {
    const rows = [{ id: "a", provider: HONEST, spec: job().spec, status: "created", settlement: null, created_at: "t1" }, { id: "b", provider: HONEST, spec: job().spec, status: "released", settlement: null, created_at: "t2" }];
    const store = new SupabaseStore(new FakeSupabase(() => ok(rows)));
    expect((await store.listJobs()).map((j) => j.id)).toEqual(["a", "b"]);
  });

  it("getReport reconstructs the VerificationReport shape from the stored body + hash + signature", async () => {
    const body = { version: 1, jobId: "j1", specHash: "0x" + "0".repeat(64), submissionHash: "0x" + "1".repeat(64), verifier: HONEST, issuedAt: "t", layer1: { passed: true, checks: [] }, layer2: null, verdict: "pass" };
    const row = { body, report_hash: "0x" + "2".repeat(64), signature: "0xsig" };
    const store = new SupabaseStore(new FakeSupabase(() => ok(row)));
    expect(await store.getReport("j1")).toEqual({ body, hash: row.report_hash, signature: "0xsig" });
  });
});

describe("SupabaseStore: updateJob merges the patch then re-reads the full row", () => {
  it("sends only the changed columns, then returns the merged job", async () => {
    const calls: Call[] = [];
    const row = { id: "j1", provider: HONEST, spec: job().spec, status: "created", settlement: null, created_at: "t1" };
    const sb = new FakeSupabase((c) => {
      calls.push({ ...c });
      if (c.op === "update") return ok();
      return ok({ ...row, status: "released", settlement: { action: "release", txHash: "0x1", at: "t2" } });
    });
    const result = await new SupabaseStore(sb).updateJob("j1", { status: "released", settlement: { action: "release", txHash: "0x1", at: "t2" } });
    expect(calls[0]).toMatchObject({ table: "jobs", op: "update", payload: { status: "released" } });
    expect(result.status).toBe("released");
  });

  it("throws if the job disappeared between the update and the re-read", async () => {
    const sb = new FakeSupabase((c) => (c.op === "update" ? ok() : ok(null)));
    await expect(new SupabaseStore(sb).updateJob("ghost", { status: "released" })).rejects.toThrow("ghost");
  });
});

describe("SupabaseStore: duplicate inserts surface a clear error, not a raw Postgres code", () => {
  it("insertJob", async () => {
    await expect(new SupabaseStore(new FakeSupabase(() => dup)).insertJob(job())).rejects.toThrow("j1 already exists");
  });
  it("insertReputationEvent", async () => {
    const e: ReputationEvent = { id: "e1", provider: HONEST, jobId: "j1", outcome: "pass", amount: "1", reportHash: "0xabc" as `0x${string}`, occurredAt: "t" };
    await expect(new SupabaseStore(new FakeSupabase(() => dup)).insertReputationEvent(e)).rejects.toThrow("j1 already exists");
  });
  it("a non-duplicate database error still surfaces, unwrapped from the code path", async () => {
    const sb = new FakeSupabase(() => ({ data: null, error: { message: "connection refused" } }));
    await expect(new SupabaseStore(sb).getJob("j1")).rejects.toThrow("connection refused");
  });
});
