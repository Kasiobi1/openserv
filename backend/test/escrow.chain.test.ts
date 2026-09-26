import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { foundry } from "viem/chains";
import { createPublicClient, http } from "viem";
import { escrowAbi, hashCanonical, jobKey } from "@atl/shared";
import { deployAll, EscrowParticipant, ViemEscrowClient } from "../src/chain";
import { wire } from "../src/app";
import { acct, hasAnvil, startAnvil } from "./anvil";
import { faultyPayload, honestPayload, invoiceSpec, submissionFor } from "./fixtures";

const M = 1_000_000n; // one token (6 decimals)
const PRICE = 10n * M;
const STAKE = 5n * M;

const deployer = acct(0);
const signer = acct(1);
const buyer = acct(2);
const honest = acct(3);
const faulty = acct(4);
const stranger = acct(5);

describe.skipIf(!hasAnvil)("AgentEscrow on a local chain (anvil)", () => {
  let chain: Awaited<ReturnType<typeof startAnvil>>;
  let pub: ReturnType<typeof createPublicClient>;

  beforeAll(async () => {
    chain = await startAnvil();
    pub = createPublicClient({ chain: foundry, transport: http(chain.url) });
  });
  afterAll(() => chain.stop());

  // Fresh contracts + funded, staked participants for every test.
  let escrow: `0x${string}`, token: `0x${string}`;
  let B: EscrowParticipant, H: EscrowParticipant, F: EscrowParticipant;
  let signerClient: ViemEscrowClient;
  let n = 0;
  const id = () => `job-${++n}-${Math.random().toString(36).slice(2, 8)}`;
  const jobSpec = (jobId: string, extra: Record<string, unknown> = {}) => ({
    ...invoiceSpec(jobId, PRICE.toString()), buyer: buyer.address, stakeRequired: STAKE.toString(), ...extra,
  });

  const part = (a: ReturnType<typeof acct>) =>
    new EscrowParticipant({ chain: foundry, rpcUrl: chain.url, account: a, escrowAddress: escrow, tokenAddress: token });
  const freeStake = (who: `0x${string}`) => pub.readContract({ address: escrow, abi: escrowAbi, functionName: "freeStake", args: [who] });

  beforeEach(async () => {
    const d = await deployAll({ chain: foundry, rpcUrl: chain.url, deployer, policySigner: signer.address });
    escrow = d.escrow;
    token = d.token;
    B = part(buyer); H = part(honest); F = part(faulty);
    await B.mintMock(buyer.address, 100n * M);
    await H.mintMock(honest.address, 50n * M);
    await H.mintMock(faulty.address, 50n * M);
    await H.stake(20n * M);
    await F.stake(20n * M);
    signerClient = new ViemEscrowClient({ chain: foundry, rpcUrl: chain.url, escrowAddress: escrow, account: signer });
  });

  it("deploy wiring: policy signer matches, and assertReady rejects a wrong key", async () => {
    await expect(signerClient.assertReady()).resolves.toBeUndefined();
    const wrong = new ViemEscrowClient({ chain: foundry, rpcUrl: chain.url, escrowAddress: escrow, account: stranger });
    await expect(wrong.assertReady()).rejects.toThrow(/policySigner/);
  });

  it("pass path: funds the job, locks stake, releases price to provider, unlocks stake", async () => {
    const jobId = id();
    const spec = jobSpec(jobId);
    await B.createJob(spec, honest.address);
    expect(await B.tokenBalance()).toBe(90n * M);
    expect(await freeStake(honest.address)).toBe(20n * M - STAKE); // locked

    const hash = hashCanonical(honestPayload());
    await H.submitResult(jobId, hash);
    expect((await signerClient.describeJob(jobId))!).toMatchObject({ status: "Submitted", resultHash: hash, price: PRICE.toString() });

    await signerClient.release(jobId);
    expect(await H.tokenBalance()).toBe(30n * M + PRICE); // 50 minted - 20 staked + price
    expect(await freeStake(honest.address)).toBe(20n * M);
    expect((await signerClient.describeJob(jobId))!.status).toBe("Released");
  });

  it("fail path: refunds the buyer, slashes part of the stake to the buyer, returns the rest", async () => {
    const jobId = id();
    await B.createJob(jobSpec(jobId), faulty.address);
    await F.submitResult(jobId, hashCanonical(faultyPayload()));
    await signerClient.refundAndSlash(jobId, 3000);

    const slashed = (STAKE * 3000n) / 10_000n; // 1.5 tokens
    expect(await B.tokenBalance()).toBe(100n * M + slashed); // price refunded + slash
    expect(await freeStake(faulty.address)).toBe(20n * M - slashed);
    expect((await signerClient.describeJob(jobId))!.status).toBe("Slashed");
  });

  it("only the policy signer can release or slash (buyer, provider, stranger all revert)", async () => {
    const jobId = id();
    await B.createJob(jobSpec(jobId), honest.address);
    await H.submitResult(jobId, hashCanonical(honestPayload()));
    for (const who of [buyer, honest, stranger, deployer]) {
      const c = new ViemEscrowClient({ chain: foundry, rpcUrl: chain.url, escrowAddress: escrow, account: who });
      await expect(c.release(jobId)).rejects.toThrow(/NotPolicySigner/);
      await expect(c.refundAndSlash(jobId, 10_000)).rejects.toThrow(/NotPolicySigner/);
    }
    expect((await signerClient.describeJob(jobId))!.status).toBe("Submitted");
  });

  it("cannot settle twice or settle before a result is submitted", async () => {
    const jobId = id();
    await B.createJob(jobSpec(jobId), honest.address);
    await expect(signerClient.release(jobId)).rejects.toThrow(/BadStatus/);
    await H.submitResult(jobId, hashCanonical(honestPayload()));
    await signerClient.release(jobId);
    await expect(signerClient.release(jobId)).rejects.toThrow(/BadStatus/);
    await expect(signerClient.refundAndSlash(jobId, 3000)).rejects.toThrow(/BadStatus/);
  });

  it("rejects slashBps above 100%", async () => {
    const jobId = id();
    await B.createJob(jobSpec(jobId), faulty.address);
    await F.submitResult(jobId, hashCanonical(faultyPayload()));
    await expect(signerClient.refundAndSlash(jobId, 10_001)).rejects.toThrow(/BadBps/);
  });

  it("only the assigned provider can submit; duplicate ids and missing stake are refused", async () => {
    const jobId = id();
    await B.createJob(jobSpec(jobId), honest.address);
    await expect(F.submitResult(jobId, hashCanonical(honestPayload()))).rejects.toThrow(/NotProvider/);
    await expect(B.createJob(jobSpec(jobId), honest.address)).rejects.toThrow(/JobExists/);
    await expect(B.createJob(jobSpec(id(), { stakeRequired: (100n * M).toString() }), honest.address)).rejects.toThrow(/InsufficientStake/);
  });

  it("locked stake cannot be withdrawn, free stake can", async () => {
    const jobId = id();
    await B.createJob(jobSpec(jobId), honest.address); // 5 locked, 15 free
    await expect(H.withdrawStake(16n * M)).rejects.toThrow(/InsufficientStake/);
    await H.withdrawStake(15n * M);
    expect(await freeStake(honest.address)).toBe(0n);
  });

  it("expired unsubmitted job: buyer reclaims price, provider stake unlocked unslashed; too-early and non-buyer refused", async () => {
    const jobId = id();
    const spec = jobSpec(jobId, { deadline: new Date(Date.now() + 60_000).toISOString() });
    await B.createJob(spec, honest.address);
    await expect(B.reclaimExpired(jobId)).rejects.toThrow(/NotExpired/);
    await chain.increaseTime(120);
    await expect(H.reclaimExpired(jobId)).rejects.toThrow(/NotBuyer/);
    await expect(H.submitResult(jobId, hashCanonical(honestPayload()))).rejects.toThrow(/DeadlinePassed/);
    await B.reclaimExpired(jobId);
    expect(await B.tokenBalance()).toBe(100n * M);
    expect(await freeStake(honest.address)).toBe(20n * M);
  });

  it("describeJob returns null for an unknown job", async () => {
    expect(await signerClient.describeJob("nope")).toBeNull();
    expect(jobKey("nope")).toMatch(/^0x[0-9a-f]{64}$/);
  });

  describe("backend end-to-end against the real contract", () => {
    let ctx: ReturnType<typeof wire>;
    beforeEach(() => {
      ctx = wire({ escrow: signerClient, env: { MAX_SPEND_PER_JOB: "1000000000" } as NodeJS.ProcessEnv });
    });
    const post = async (url: string, payload?: unknown) => {
      const r = await ctx.app.inject({ method: "POST", url, payload: payload as object });
      return { status: r.statusCode, body: r.json() };
    };

    async function backendJob(jobId: string, provider: typeof honest, payload: unknown, onchainHash = hashCanonical(payload)) {
      const spec = jobSpec(jobId);
      await B.createJob(spec, provider.address);
      expect((await post("/jobs", { spec, provider: provider.address })).status).toBe(201);
      await (provider === honest ? H : F).submitResult(jobId, onchainHash);
      await post(`/jobs/${jobId}/submissions`, submissionFor(jobId, provider.address, payload));
      expect((await post(`/jobs/${jobId}/verify`)).status).toBe(200);
    }

    it("honest job: verify -> settle releases real funds", async () => {
      const jobId = id();
      await backendJob(jobId, honest, honestPayload());
      const s = await post(`/jobs/${jobId}/settle`);
      expect(s.status).toBe(200);
      expect(s.body.decision.checks.find((c: { name: string }) => c.name === "onchain_matches").passed).toBe(true);
      expect(s.body.job.status).toBe("released");
      expect(await H.tokenBalance()).toBe(30n * M + PRICE);
    });

    it("faulty job: verified fail -> real refund and slash", async () => {
      const jobId = id();
      await backendJob(jobId, faulty, faultyPayload());
      const s = await post(`/jobs/${jobId}/settle`);
      expect(s.body.decision.action).toBe("refund_and_slash");
      expect(await B.tokenBalance()).toBe(100n * M + (STAKE * 3000n) / 10_000n);
      expect(s.body.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it("refuses when the provider committed a different hash on-chain than the payload it gave the verifier", async () => {
      const jobId = id();
      await backendJob(jobId, honest, honestPayload(), hashCanonical(faultyPayload())); // bait and switch
      const s = await post(`/jobs/${jobId}/settle`);
      expect(s.status).toBe(422);
      expect(s.body.decision.checks.find((c: { name: string }) => c.name === "onchain_matches").passed).toBe(false);
      expect((await signerClient.describeJob(jobId))!.status).toBe("Submitted"); // nothing moved
    });

    it("refuses when the job was never funded on-chain", async () => {
      const jobId = id();
      const spec = jobSpec(jobId);
      await post("/jobs", { spec, provider: honest.address });
      const payload = honestPayload();
      await post(`/jobs/${jobId}/submissions`, submissionFor(jobId, honest.address, payload));
      await post(`/jobs/${jobId}/verify`);
      const s = await post(`/jobs/${jobId}/settle`);
      expect(s.status).toBe(422);
      expect(s.body.decision.checks.find((c: { name: string }) => c.name === "onchain_matches").detail).toContain("no such job");
    });
  });
});
