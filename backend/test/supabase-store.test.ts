import { describe, expect, it } from "vitest";
import type { Job, ReputationEvent, VerificationReport } from "@atl/shared";
import { hashCanonical } from "@atl/shared";
import { SupabaseStore } from "../src/store/supabase";
import { FakeSupabase, type Call } from "./fake-supabase";
import { honestPayload, invoiceSpec, submissionFor, HONEST } from "./fixtures";

const ok = (data: unknown = null) => ({ data, error: null });
const dup = { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
const boom = { data: null, error: { message: "connection refused" } };

const job: Job = { id: "j1", spec: invoiceSpec("j1"), provider: HONEST, status: "created", createdAt: "2026-09-23T00:00:00.000Z" };

describe("SupabaseStore: jobs", () => {
  it("insertJob sends the right row, including a computed spec_hash", async () => {
    let seen: Call | undefined;
    const store = new SupabaseStore(new FakeSupabase((c) => { seen = c; return ok(); }));
    await store.insertJob(job);
    expect(seen).toMatchObject({
      table: "jobs",
      op: "insert",
      payload: {
        id: "j1", buyer: job.spec.buyer, provider: HONEST, spec: job.spec,
        spec_hash: hashCanonical(job.spec), max_price: job.spec.maxPrice, status: "created",
        settlement: null, created_at: job.createdAt,
      },
    });
  });

  it("insertJob turns a unique-violation into a clear duplicate-job error", async () => {
    const store = new SupabaseStore(new FakeSupabase(() => dup));
    await expect(store.insertJob(job)).rejects.toThrow("job j1 already exists");
  });

  it("insertJob surfaces other database errors as-is", async () => {
    const store = new SupabaseStore(new FakeSupabase(() => boom));
    await expect(store.insertJob(job)).rejects.toThrow("connection refused");
  });

  it("getJob maps a found row and filters by id; returns null when there is none", async () => {
    const row = { id: "j1", provider: HONEST, spec: job.spec, status: "verified", settlement: null, created_at: job.createdAt };
    let seen: Call | undefined;
    const found = new SupabaseStore(new FakeSupabase((c) => { seen = c; return ok(row); }));
    expect(await found.getJob("j1")).toEqual({ ...job, status: "verified" });
    expect(seen?.filters).toEqual([{ method: "eq", args: ["id", "j1"] }]);

    const missing = new SupabaseStore(new FakeSupabase(() => ok(null)));
    expect(await missing.getJob("nope")).toBeNull();
  });

  it("getJob includes settlement only when the row has one", async () => {
    const settlement = { action: "release" as const, txHash: "0xabc", at: job.createdAt };
    const store = new SupabaseStore(new FakeSupabase(() => ok({ id: "j1", provider: HONEST, spec: job.spec, status: "released", settlement, created_at: job.createdAt })));
    expect((await store.getJob("j1"))?.settlement).toEqual(settlement);
  });

  it("updateJob sends only the given fields, then re-reads the full row", async () => {
    const calls: Call[] = [];
    const store = new SupabaseStore(new FakeSupabase((c) => {
      calls.push(c);
      if (c.op === "update") return ok();
      return ok({ id: "j1", provider: HONEST, spec: job.spec, status: "verified", settlement: null, created_at: job.createdAt });
    }));
    const result = await store.updateJob("j1", { status: "verified" });
    expect(result.status).toBe("verified");
    expect(calls[0]).toMatchObject({ op: "update", payload: { status: "verified" } });
    expect(calls[0]!.payload).not.toHaveProperty("settlement");
    expect(calls[0]!.filters).toEqual([{ method: "eq", args: ["id", "j1"] }]);
  });

  it("updateJob throws if the job vanished between the update and the re-read", async () => {
    const store = new SupabaseStore(new FakeSupabase((c) => (c.op === "update" ? ok() : ok(null))));
    await expect(store.updateJob("ghost", { status: "verified" })).rejects.toThrow("job ghost not found");
  });

  it("listJobs orders by created_at descending and maps every row", async () => {
    let seen: Call | undefined;
    const rows = [{ id: "j2", provider: HONEST, spec: job.spec, status: "created", settlement: null, created_at: "2026-09-23T01:00:00.000Z" }];
    const store = new SupabaseStore(new FakeSupabase((c) => { seen = c; return ok(rows); }));
    expect(await store.listJobs()).toEqual([{ ...job, id: "j2", createdAt: "2026-09-23T01:00:00.000Z" }]);
    expect(seen?.filters).toEqual([{ method: "order", args: ["created_at", { ascending: false }] }]);
  });
});

describe("SupabaseStore: submissions and reports", () => {
  const submission = submissionFor("j1", HONEST, honestPayload());

  it("round-trips a submission", async () => {
    let seen: Call | undefined;
    const store = new SupabaseStore(new FakeSupabase((c) => {
      if (c.op === "insert") { seen = c; return ok(); }
      return ok({ job_id: "j1", provider: HONEST, payload: submission.payload, payload_hash: submission.payloadHash });
    }));
    await store.insertSubmission(submission);
    expect(seen?.payload).toEqual({ job_id: "j1", provider: HONEST, payload: submission.payload, payload_hash: submission.payloadHash });
    expect(await store.getSubmission("j1")).toEqual(submission);
  });

  it("round-trips a verification report, keyed by its report hash and job id", async () => {
    const report: VerificationReport = {
      body: { version: 1, jobId: "j1", specHash: hashCanonical(job.spec), submissionHash: submission.payloadHash, verifier: HONEST, issuedAt: job.createdAt, layer1: { passed: true, checks: [] }, layer2: null, verdict: "pass" },
      hash: "0x1111111111111111111111111111111111111111111111111111111111111111".slice(0, 66) as `0x${string}`,
      signature: "0xsig",
    };
    let seen: Call | undefined;
    const store = new SupabaseStore(new FakeSupabase((c) => {
      if (c.op === "insert") { seen = c; return ok(); }
      return ok({ body: report.body, report_hash: report.hash, signature: report.signature });
    }));
    await store.insertReport(report);
    expect(seen?.payload).toMatchObject({ job_id: "j1", report_hash: report.hash, verifier: HONEST, verdict: "pass" });
    expect(await store.getReport("j1")).toEqual(report);
  });
});

describe("SupabaseStore: reputation and audit", () => {
  const event: ReputationEvent = { id: "e1", provider: HONEST, jobId: "j1", outcome: "pass", amount: "10000000", reportHash: "0xreport" as `0x${string}`, occurredAt: job.createdAt };

  it("insertReputationEvent turns a duplicate job_id into a clear error", async () => {
    const store = new SupabaseStore(new FakeSupabase(() => dup));
    await expect(store.insertReputationEvent(event)).rejects.toThrow("reputation event for job j1 already exists");
  });

  it("listReputationEvents filters case-insensitively by provider only when given", async () => {
    const calls: Call[] = [];
    const store = new SupabaseStore(new FakeSupabase((c) => { calls.push(c); return ok([]); }));
    await store.listReputationEvents(HONEST.toUpperCase());
    await store.listReputationEvents();
    expect(calls[0]!.filters).toEqual([
      { method: "order", args: ["occurred_at", { ascending: true }] },
      { method: "ilike", args: ["provider", HONEST.toUpperCase()] },
    ]);
    expect(calls[1]!.filters).toEqual([{ method: "order", args: ["occurred_at", { ascending: true }] }]);
  });

  it("maps reputation rows back to events", async () => {
    const store = new SupabaseStore(new FakeSupabase(() => ok([{ id: "e1", provider: HONEST, job_id: "j1", outcome: "pass", amount: "10000000", report_hash: "0xreport", occurred_at: job.createdAt }])));
    expect(await store.listReputationEvents()).toEqual([event]);
  });

  it("appends and lists audit entries in id order", async () => {
    let inserted: Call | undefined;
    const entry = { jobId: "j1", at: job.createdAt, kind: "job_created" as const, data: { ok: true } };
    const store = new SupabaseStore(new FakeSupabase((c) => {
      if (c.op === "insert") { inserted = c; return ok(); }
      return ok([{ job_id: "j1", kind: "job_created", data: { ok: true }, at: job.createdAt }]);
    }));
    await store.appendAudit(entry);
    expect(inserted?.payload).toEqual({ job_id: "j1", kind: "job_created", data: { ok: true }, at: job.createdAt });
    expect(await store.listAudit("j1")).toEqual([entry]);
  });

  it("propagates a generic database error from listAudit", async () => {
    const store = new SupabaseStore(new FakeSupabase(() => boom));
    await expect(store.listAudit("j1")).rejects.toThrow("connection refused");
  });
});
