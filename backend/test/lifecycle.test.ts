import { describe, expect, it, beforeEach } from "vitest";
import { generatePrivateKey } from "viem/accounts";
import { addressOf, signReport, type VerificationReportBody } from "@atl/shared";
import { wire } from "../src/app";
import { MockEscrow } from "../src/signer/escrow";
import { authorizeSettlement, type PolicyConfig } from "../src/signer/policy";
import { BUYER, FAULTY, HONEST, faultyPayload, honestPayload, invoiceSpec, submissionFor } from "./fixtures";

let ctx: ReturnType<typeof wire>;
let escrow: MockEscrow;

beforeEach(() => {
  escrow = new MockEscrow();
  ctx = wire({ escrow, env: { MAX_SPEND_PER_JOB: "50000000" } as NodeJS.ProcessEnv });
});

async function post(url: string, payload?: unknown) {
  const res = await ctx.app.inject({ method: "POST", url, payload: payload as object });
  return { status: res.statusCode, body: res.json() };
}
const get = async (url: string) => (await ctx.app.inject({ method: "GET", url })).json();

async function runToVerified(id: string, provider: string, payload: unknown) {
  expect((await post("/jobs", { spec: invoiceSpec(id), provider })).status).toBe(201);
  expect((await post(`/jobs/${id}/submissions`, submissionFor(id, provider, payload))).status).toBe(201);
  return post(`/jobs/${id}/verify`);
}

describe("end-to-end lifecycle", () => {
  it("honest provider: verified, released, score up", async () => {
    const v = await runToVerified("job-honest", HONEST, honestPayload());
    expect(v.body.body.verdict).toBe("pass");

    const s = await post("/jobs/job-honest/settle");
    expect(s.status).toBe(200);
    expect(s.body.decision.action).toBe("release");
    expect(s.body.job.status).toBe("released");
    expect(escrow.calls).toHaveLength(1);
    expect(escrow.calls[0]!.op).toBe("release");

    const score = await get(`/providers/${HONEST}`);
    expect(score.score).toBeGreaterThan(500);
  });

  it("faulty provider: verified fail, refunded + slashed, score down", async () => {
    const v = await runToVerified("job-faulty", FAULTY, faultyPayload());
    expect(v.body.body.verdict).toBe("fail");

    const s = await post("/jobs/job-faulty/settle");
    expect(s.status).toBe(200);
    expect(s.body.decision.action).toBe("refund_and_slash");
    expect(s.body.job.status).toBe("slashed");
    expect(escrow.calls[0]).toMatchObject({ op: "refundAndSlash", slashBps: 3000 });
    expect((await get(`/providers/${FAULTY}`)).score).toBeLessThan(500);
  });

  it("rejects a job over the spend limit and never touches escrow", async () => {
    const r = await post("/jobs", { spec: invoiceSpec("job-big", "999000000"), provider: HONEST });
    expect(r.status).toBe(403);
    expect(r.body.job.status).toBe("rejected");
    expect(r.body.decision.checks.find((c: { name: string }) => c.name === "spend_limit").passed).toBe(false);
    expect((await post("/jobs/job-big/submissions", submissionFor("job-big", HONEST, honestPayload()))).status).toBe(409);
    expect(escrow.calls).toHaveLength(0);
  });

  it("blocks a provider whose score has fallen below the minimum", async () => {
    // With default scoring, one failed 10-token job takes a new provider to ~183, under the 300 floor.
    await runToVerified("f1", FAULTY, faultyPayload());
    await post("/jobs/f1/settle");
    expect((await get(`/providers/${FAULTY}`)).score).toBeLessThan(300);

    const r = await post("/jobs", { spec: invoiceSpec("f2"), provider: FAULTY });
    expect(r.status).toBe(403);
    expect(r.body.decision.checks.find((c: { name: string }) => c.name === "provider_score").passed).toBe(false);
    // An untouched provider is still fine.
    expect((await post("/jobs", { spec: invoiceSpec("h1"), provider: HONEST })).status).toBe(201);
  });

  it("cannot settle twice", async () => {
    await runToVerified("job-once", HONEST, honestPayload());
    expect((await post("/jobs/job-once/settle")).status).toBe(200);
    const again = await post("/jobs/job-once/settle");
    expect(again.status).toBe(422);
    expect(again.body.decision.checks.find((c: { name: string }) => c.name === "job_state").passed).toBe(false);
    expect(escrow.calls).toHaveLength(1);
  });

  it("only the assigned provider can submit", async () => {
    await post("/jobs", { spec: invoiceSpec("job-x"), provider: HONEST });
    const r = await post("/jobs/job-x/submissions", submissionFor("job-x", FAULTY, honestPayload()));
    expect(r.status).toBe(403);
  });

  it("returns an audit trail per job and a leaderboard", async () => {
    await runToVerified("a1", HONEST, honestPayload());
    await post("/jobs/a1/settle");
    await runToVerified("a2", FAULTY, faultyPayload());
    await post("/jobs/a2/settle");

    const detail = await get("/jobs/a1");
    expect(detail.audit.map((a: { kind: string }) => a.kind)).toEqual([
      "job_created", "submission_received", "verification_report", "settlement_approved",
    ]);
    const board = await get("/providers/leaderboard");
    expect(board[0].provider).toBe(HONEST);
    expect(board[1].provider).toBe(FAULTY);
  });

  it("validates request bodies", async () => {
    expect((await post("/jobs", { spec: { id: "" }, provider: HONEST })).status).toBe(400);
    expect((await post("/jobs/nope/verify")).status).toBe(404);
  });
});

describe("policy signer rejects untrusted or inconsistent reports", () => {
  const cfg = (trusted: string[]): PolicyConfig => ({
    maxSpendPerJob: 50_000_000n,
    minProviderScore: 300,
    slashBps: 3000,
    trustedVerifiers: trusted,
    reportMaxAgeMs: 900_000,
  });

  async function verifiedJob() {
    await runToVerified("p1", FAULTY, faultyPayload());
    return {
      job: (await ctx.store.getJob("p1"))!,
      submission: await ctx.store.getSubmission("p1"),
      report: (await ctx.store.getReport("p1"))!,
    };
  }
  const failedNames = (d: { checks: { name: string; passed: boolean }[] }) => d.checks.filter((c) => !c.passed).map((c) => c.name);

  it("accepts a genuine report (control)", async () => {
    const { job, submission, report } = await verifiedJob();
    const d = await authorizeSettlement({ job, submission, report, now: new Date() }, cfg([ctx.verifier.address]));
    expect(d.allowed).toBe(true);
  });

  it("rejects a forged 'pass' signed by an unknown key", async () => {
    const { job, submission, report } = await verifiedJob();
    const rogueKey = generatePrivateKey();
    const forgedBody: VerificationReportBody = { ...report.body, verdict: "pass", verifier: addressOf(rogueKey) };
    const forged = await signReport(forgedBody, rogueKey);
    const d = await authorizeSettlement({ job, submission, report: forged, now: new Date() }, cfg([ctx.verifier.address]));
    expect(d.allowed).toBe(false);
    expect(failedNames(d)).toContain("verifier_trusted");
  });

  it("rejects a report whose body was edited after signing", async () => {
    const { job, submission, report } = await verifiedJob();
    const edited = { ...report, body: { ...report.body, verdict: "pass" as const } };
    const d = await authorizeSettlement({ job, submission, report: edited, now: new Date() }, cfg([ctx.verifier.address]));
    expect(d.allowed).toBe(false);
    expect(failedNames(d)).toContain("report_signature");
  });

  it("rejects a stale report", async () => {
    const { job, submission, report } = await verifiedJob();
    const later = new Date(Date.now() + 3_600_000);
    const d = await authorizeSettlement({ job, submission, report, now: later }, cfg([ctx.verifier.address]));
    expect(failedNames(d)).toContain("report_fresh");
  });

  it("rejects a report that does not match the stored submission", async () => {
    const { job, report } = await verifiedJob();
    const other = submissionFor("p1", FAULTY, honestPayload());
    const d = await authorizeSettlement({ job, submission: other, report, now: new Date() }, cfg([ctx.verifier.address]));
    expect(failedNames(d)).toContain("report_binds_submission");
  });

  it("rejects a 'pass' verdict contradicting failed checks, even from a trusted key", async () => {
    const { job, submission, report } = await verifiedJob();
    const trustedKey = generatePrivateKey();
    const lie = await signReport({ ...report.body, verdict: "pass", verifier: addressOf(trustedKey) }, trustedKey);
    const d = await authorizeSettlement({ job, submission, report: lie, now: new Date() }, cfg([addressOf(trustedKey)]));
    expect(d.allowed).toBe(false);
    expect(failedNames(d)).toEqual(["verdict_consistent"]);
  });
});

describe("wiring", () => {
  it("routes settlement through the selected rail and refuses placeholder rails", async () => {
    expect(ctx.rail.id).toBe("x402");
    expect(ctx.reasoning.id).toBe("mock");
    expect(() => wire({ env: { RAIL: "ap2" } as NodeJS.ProcessEnv })).toThrow("placeholder");
  });
});

describe("audited tier through the API", () => {
  const audited = (id: string) => ({ ...invoiceSpec(id), verificationTier: "auditor" as const });
  const mock = () => ctx.reasoning as unknown as import("../src/reasoning").MockReasoningProvider;

  it("503s without slashing when the auditor is down, then succeeds on retry", async () => {
    await post("/jobs", { spec: audited("aud1"), provider: HONEST });
    await post("/jobs/aud1/submissions", submissionFor("aud1", HONEST, honestPayload()));

    const down = await post("/jobs/aud1/verify"); // mock has no scripted reply => provider error
    expect(down.status).toBe(503);
    expect((await get("/jobs/aud1")).job.status).toBe("submitted");
    expect(escrow.calls).toHaveLength(0);

    mock().push(JSON.stringify({ summary: "fine", concerns: [] }));
    const ok = await post("/jobs/aud1/verify");
    expect(ok.status).toBe(200);
    expect(ok.body.body.layer2).toMatchObject({ status: "completed", passed: true });
    expect((await post("/jobs/aud1/settle")).body.decision.action).toBe("release");
  });

  it("a failed audit leads to refund + slash", async () => {
    await post("/jobs", { spec: audited("aud2"), provider: FAULTY });
    await post("/jobs/aud2/submissions", submissionFor("aud2", FAULTY, honestPayload()));
    mock().push(JSON.stringify({ summary: "fabricated", concerns: [{ itemIndex: 1, severity: "major", explanation: "vendor does not appear in inputs" }] }));
    expect((await post("/jobs/aud2/verify")).body.body.verdict).toBe("fail");
    expect((await post("/jobs/aud2/settle")).body.decision.action).toBe("refund_and_slash");
  });
});

describe("config", () => {
  it("treats blank env values as unset (as copied from .env.example)", () => {
    const c = wire({ env: { VERIFIER_PRIVATE_KEY: "", ESCROW_ADDRESS: "", REASONING_BASE_URL: "", CHAIN_NAME: "", REASONING_PROVIDER: "mock" } as NodeJS.ProcessEnv });
    expect(c.chain).toBeUndefined();
    expect(c.rail.id).toBe("x402");
  });
});

describe("auto pipeline and public config", () => {
  it("submission alone triggers verify + settle when AUTO_PIPELINE=true", async () => {
    const auto = wire({ escrow: new MockEscrow(), env: { AUTO_PIPELINE: "true" } as NodeJS.ProcessEnv });
    const call = async (url: string, payload?: unknown) => (await auto.app.inject({ method: "POST", url, payload: payload as object })).json();
    await call("/jobs", { spec: invoiceSpec("auto1"), provider: HONEST });
    await call("/jobs/auto1/submissions", submissionFor("auto1", HONEST, honestPayload()));
    await auto.jobs.idle();
    const detail = (await auto.app.inject({ method: "GET", url: "/jobs/auto1" })).json();
    expect(detail.job.status).toBe("released");
    expect(detail.audit.map((a: { kind: string }) => a.kind)).toEqual([
      "job_created", "submission_received", "verification_report", "settlement_approved",
    ]);
  });

  it("logs a pipeline_error and retries when the auditor is unreachable, then completes", async () => {
    const auto = wire({ escrow: new MockEscrow(), env: { AUTO_PIPELINE: "true" } as NodeJS.ProcessEnv });
    (auto.jobs as unknown as { pipeline: { retryMs: number } }).pipeline = { auto: true, retryMs: 10 } as never;
    const spec = { ...invoiceSpec("auto2"), verificationTier: "auditor" as const };
    const call = async (url: string, payload?: unknown) => (await auto.app.inject({ method: "POST", url, payload: payload as object })).json();
    await call("/jobs", { spec, provider: HONEST });
    await call("/jobs/auto2/submissions", submissionFor("auto2", HONEST, honestPayload()));
    // first attempt fails (mock has no scripted reply); script the reply before the retry fires
    setTimeout(() => (auto.reasoning as unknown as { push: (s: string) => void }).push(JSON.stringify({ summary: "ok", concerns: [] })), 5);
    await auto.jobs.idle();
    const detail = (await auto.app.inject({ method: "GET", url: "/jobs/auto2" })).json();
    expect(detail.job.status).toBe("released");
    expect(detail.audit.some((a: { kind: string; data: { willRetry: boolean } }) => a.kind === "pipeline_error" && a.data.willRetry)).toBe(true);
  });

  it("serves /config and CORS headers for the dashboard", async () => {
    const cfg = (await ctx.app.inject({ method: "GET", url: "/config" })).json();
    expect(cfg).toMatchObject({ chain: "mock", autoPipeline: false, tokenSymbol: "mUSD", tokenDecimals: 6, policy: { slashBps: 3000 } });
    const res = await ctx.app.inject({ method: "GET", url: "/jobs", headers: { origin: "https://dash.example" } });
    expect(res.headers["access-control-allow-origin"]).toBeTruthy();
  });
});

describe("Supabase persistence wiring", () => {
  it("uses the in-memory store when neither SUPABASE var is set, and reports that in /config", async () => {
    const c = wire({ escrow: new MockEscrow(), env: {} as NodeJS.ProcessEnv });
    expect(c.store.constructor.name).toBe("MemoryStore");
    const cfg = (await c.app.inject({ method: "GET", url: "/config" })).json();
    expect(cfg.persistent).toBe(false);
  });

  it("refuses to start if only one of SUPABASE_URL / SUPABASE_SECRET_KEY is set", () => {
    expect(() => wire({ escrow: new MockEscrow(), env: { SUPABASE_URL: "https://x.supabase.co" } as NodeJS.ProcessEnv })).toThrow(/SUPABASE_URL and SUPABASE_SECRET_KEY/);
    expect(() => wire({ escrow: new MockEscrow(), env: { SUPABASE_SECRET_KEY: "k" } as NodeJS.ProcessEnv })).toThrow(/SUPABASE_URL and SUPABASE_SECRET_KEY/);
  });

  it("selects SupabaseStore and reports persistent:true when both are set", async () => {
    const c = wire({ escrow: new MockEscrow(), env: { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SECRET_KEY: "k" } as NodeJS.ProcessEnv });
    expect(c.store.constructor.name).toBe("SupabaseStore");
    const cfg = (await c.app.inject({ method: "GET", url: "/config" })).json();
    expect(cfg.persistent).toBe(true);
  });
});
