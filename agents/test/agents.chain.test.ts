import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it } from "vitest";
import { foundry } from "viem/chains";
import { createPublicClient, http } from "viem";
import { deployAll, EscrowParticipant, ViemEscrowClient } from "@atl/backend/src/chain";
import { wire } from "@atl/backend/src/app";
import { MockReasoningProvider } from "@atl/backend/src/reasoning";
import { acct, hasAnvil, startAnvil } from "../../backend/test/anvil";
import { BuyerAgent } from "../src/buyer";
import { InvoiceExtractor } from "../src/extractor";
import { BackendClient } from "../src/http";
import { invoiceJob, TOKEN } from "../src/jobs";
import { ProviderAgent } from "../src/provider";
import { prepareWallets } from "../src/setup";

const [deployer, signer, buyerA, honestA, faultyA] = [acct(0), acct(1), acct(2), acct(3), acct(4)];
const PRICE = 10n * TOKEN;
const STAKE = 5n * TOKEN;

describe.skipIf(!hasAnvil)("agents end to end (real contract, real HTTP, scripted model)", () => {
  let chain: Awaited<ReturnType<typeof startAnvil>>;
  beforeAll(async () => { chain = await startAnvil(); });
  afterAll(() => chain.stop());

  let ctx: ReturnType<typeof wire>;
  let backend: BackendClient;
  let buyer: BuyerAgent, honest: ProviderAgent, faulty: ProviderAgent;
  let bW: EscrowParticipant, hW: EscrowParticipant, fW: EscrowParticipant;
  let escrow: `0x${string}`, token: `0x${string}`;
  let n = 0;
  const logs: string[] = [];
  const id = () => `agent-job-${++n}`;

  const setup = async (fault: "broken" | "fake") => {
    const d = await deployAll({ chain: foundry, rpcUrl: chain.url, deployer, policySigner: signer.address });
    escrow = d.escrow; token = d.token;
    const mk = (a: ReturnType<typeof acct>) => new EscrowParticipant({ chain: foundry, rpcUrl: chain.url, account: a, escrowAddress: escrow, tokenAddress: token });
    bW = mk(buyerA); hW = mk(honestA); fW = mk(faultyA);
    await prepareWallets({ buyer: bW, honest: hW, faulty: fW }, (l) => logs.push(l));

    const signerClient = new ViemEscrowClient({ chain: foundry, rpcUrl: chain.url, escrowAddress: escrow, account: signer });
    ctx = wire({ escrow: signerClient, env: { AUTO_PIPELINE: "true", MAX_SPEND_PER_JOB: "1000000000" } as NodeJS.ProcessEnv });
    await ctx.app.listen({ port: 0, host: "127.0.0.1" });
    const addr = ctx.app.server.address() as { port: number };
    backend = new BackendClient(`http://127.0.0.1:${addr.port}`);

    // Scripted "model": always extracts the correct invoices (stands in for SERV).
    const { truth } = invoiceJob({ id: "x", buyer: buyerA.address, price: PRICE, stake: STAKE, tier: "schema" });
    const model = new MockReasoningProvider(Array.from({ length: 6 }, () => () => JSON.stringify({ invoices: truth })));
    const worker = new InvoiceExtractor(model);
    const quiet = () => undefined;
    buyer = new BuyerAgent({ participant: bW, backend, log: quiet });
    honest = new ProviderAgent({ name: "honest", participant: hW, backend, worker, log: quiet });
    faulty = new ProviderAgent({ name: "faulty", participant: fW, backend, worker, fault, log: quiet });
  };
  afterEach(async () => { await ctx?.app.close(); });

  const job = (jobId: string, tier: "schema" | "auditor" = "schema", price = PRICE) =>
    invoiceJob({ id: jobId, buyer: buyerA.address, price, stake: STAKE, tier }).spec;
  const finish = async (jobId: string) => { await ctx.jobs.idle(); return (await buyer.waitForOutcome(jobId, { drive: false, timeoutMs: 5000, pollMs: 50 })).detail; };

  it("honest agent: does not touch an unfunded job, then delivers once funded; job is released and paid", async () => {
    await setup("broken");
    const jobId = id();
    const spec = job(jobId);
    await backend.postJob(spec, honestA.address); // authorized but not yet funded
    expect(await honest.tick()).toEqual([]);
    expect(await hW.jobOnchain(jobId)).toBeNull();

    await bW.createJob(spec, honestA.address);
    const before = await hW.tokenBalance();
    expect(await honest.tick()).toEqual([jobId]);
    const d = await finish(jobId);
    expect(d.job.status).toBe("released");
    expect(d.report.body.verdict).toBe("pass");
    expect(await hW.tokenBalance()).toBe(before + PRICE);
  });

  it("buyer agent: policy first, then funding; the honest agent's job goes through end to end", async () => {
    await setup("broken");
    const jobId = id();
    expect(await buyer.postJob(job(jobId), honestA.address)).toEqual({ ok: true });
    expect((await hW.jobOnchain(jobId))!.status).toBe("Funded");
    await honest.tick();
    expect((await finish(jobId)).job.status).toBe("released");
  });

  it("faulty agent (broken): model extracts, code sabotages, layer 1 fails, buyer refunded and provider slashed", async () => {
    await setup("broken");
    const jobId = id();
    await buyer.postJob(job(jobId), faultyA.address);
    const buyerBefore = await bW.tokenBalance();
    await faulty.tick();
    const d = await finish(jobId);
    expect(d.job.status).toBe("slashed");
    expect(d.report.body.layer1.checks.filter((c: { passed: boolean }) => !c.passed).map((c: { name: string }) => c.name)).toEqual(expect.arrayContaining(["item_count", "unique_items"]));
    expect(await bW.tokenBalance()).toBe(buyerBefore + PRICE + (STAKE * 3000n) / 10_000n);
  });

  it("faulty agent (fake) on an audited job: layer 1 passes, the audit fails it, provider slashed", async () => {
    await setup("fake");
    (ctx.reasoning as unknown as MockReasoningProvider).push(JSON.stringify({ summary: "values contradict the inputs", concerns: [{ itemIndex: 0, severity: "major", explanation: "vendor not in the invoice text" }] }));
    const jobId = id();
    await buyer.postJob(job(jobId, "auditor"), faultyA.address);
    await faulty.tick();
    const d = await finish(jobId);
    expect(d.report.body.layer1.passed).toBe(true);
    expect(d.report.body.layer2).toMatchObject({ status: "completed", passed: false });
    expect(d.job.status).toBe("slashed");
  });

  it("over the spend limit: buyer is told why, nothing is funded on-chain", async () => {
    await setup("broken");
    const jobId = id();
    const r = await buyer.postJob(job(jobId, "schema", 2000n * TOKEN), honestA.address);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons[0]).toContain("spend_limit");
    expect(await hW.jobOnchain(jobId)).toBeNull();
  });

  it("the agent refuses a job whose on-chain terms differ from the spec it was shown", async () => {
    await setup("broken");
    const jobId = id();
    await backend.postJob(job(jobId), honestA.address);
    await bW.createJob({ ...job(jobId), maxPrice: (PRICE + TOKEN).toString() }, honestA.address); // funded with a different price
    expect(await honest.tick()).toEqual([]);
    expect((await hW.jobOnchain(jobId))!.status).toBe("Funded"); // agent never committed a result
  });

  it("exposes public config for the dashboard", async () => {
    await setup("broken");
    const cfg = (await backend.config()).body;
    expect(cfg).toMatchObject({ autoPipeline: true, tokenSymbol: "mUSD", policy: { slashBps: 3000 } });
  });
});
