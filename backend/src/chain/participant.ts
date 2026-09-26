import { escrowAbi, jobKey, tokenAbi, type JobSpec } from "@atl/shared";
import type { Address } from "viem";
import { makeClients, type ChainOptions } from "./clients";

export interface ParticipantOptions extends ChainOptions {
  escrowAddress: Address;
  tokenAddress: Address;
}

/**
 * Wallet actions for buyers and providers (approve, stake, fund a job, commit a result, reclaim).
 * A participant's key can only move that participant's own funds. It has no access to release/refundAndSlash.
 */
export class EscrowParticipant {
  private readonly c;
  readonly address: Address;

  constructor(private readonly o: ParticipantOptions) {
    this.c = makeClients(o);
    this.address = o.account.address;
  }

  private async wait(hash: `0x${string}`) {
    const r = await this.c.pub.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`transaction ${hash} reverted`);
    return hash;
  }

  /**
   * Approve, then WAIT UNTIL THE ALLOWANCE IS ACTUALLY READABLE before returning. Some public RPC endpoints
   * (e.g. Base Sepolia's) load-balance across nodes that don't immediately agree, so a receipt can come back
   * "success" while a read against the escrow's allowance a moment later still sees the old value and reverts
   * with ERC20InsufficientAllowance. Polling here, once, is cheaper than every caller guarding against it.
   */
  private async approve(amount: bigint) {
    const { request } = await this.c.pub.simulateContract({
      account: this.o.account, address: this.o.tokenAddress, abi: tokenAbi,
      functionName: "approve", args: [this.o.escrowAddress, amount],
    });
    const hash = await this.wait(await this.c.wallet.writeContract(request));
    for (let i = 0; i < 10; i++) {
      const allowance = await this.c.pub.readContract({
        address: this.o.tokenAddress, abi: tokenAbi, functionName: "allowance", args: [this.address, this.o.escrowAddress],
      });
      if (allowance >= amount) return hash;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
    return hash; // give the caller its best shot; a real failure still surfaces as a clear revert
  }

  async stake(amount: bigint) {
    await this.approve(amount);
    const { request } = await this.c.pub.simulateContract({
      account: this.o.account, address: this.o.escrowAddress, abi: escrowAbi, functionName: "stake", args: [amount],
    });
    return this.wait(await this.c.wallet.writeContract(request));
  }

  async withdrawStake(amount: bigint) {
    const { request } = await this.c.pub.simulateContract({
      account: this.o.account, address: this.o.escrowAddress, abi: escrowAbi, functionName: "withdrawStake", args: [amount],
    });
    return this.wait(await this.c.wallet.writeContract(request));
  }

  /** Buyer funds the job. Deadline comes from the spec, else now + defaultTtlSeconds. */
  async createJob(spec: JobSpec, provider: Address, opts: { defaultTtlSeconds?: number } = {}) {
    const price = BigInt(spec.maxPrice);
    const deadline = spec.deadline
      ? Math.floor(new Date(spec.deadline).getTime() / 1000)
      : Math.floor(Date.now() / 1000) + (opts.defaultTtlSeconds ?? 86_400);
    await this.approve(price);
    const { request } = await this.c.pub.simulateContract({
      account: this.o.account, address: this.o.escrowAddress, abi: escrowAbi, functionName: "createJob",
      args: [jobKey(spec.id), provider, price, BigInt(spec.stakeRequired), BigInt(deadline)],
    });
    return this.wait(await this.c.wallet.writeContract(request));
  }

  /** Provider commits the payload hash on-chain. Must equal the payloadHash sent to the backend. */
  async submitResult(jobId: string, payloadHash: `0x${string}`) {
    const { request } = await this.c.pub.simulateContract({
      account: this.o.account, address: this.o.escrowAddress, abi: escrowAbi, functionName: "submitResult", args: [jobKey(jobId), payloadHash],
    });
    return this.wait(await this.c.wallet.writeContract(request));
  }

  async reclaimExpired(jobId: string) {
    const { request } = await this.c.pub.simulateContract({
      account: this.o.account, address: this.o.escrowAddress, abi: escrowAbi, functionName: "reclaimExpired", args: [jobKey(jobId)],
    });
    return this.wait(await this.c.wallet.writeContract(request));
  }

  async tokenBalance(who: Address = this.address): Promise<bigint> {
    return this.c.pub.readContract({ address: this.o.tokenAddress, abi: tokenAbi, functionName: "balanceOf", args: [who] });
  }

  /** The job as the contract sees it, or null if it doesn't exist. */
  async jobOnchain(jobId: string) {
    const j = await this.c.pub.readContract({ address: this.o.escrowAddress, abi: escrowAbi, functionName: "getJob", args: [jobKey(jobId)] });
    const status = (["None", "Funded", "Submitted", "Released", "Slashed", "Reclaimed"] as const)[j.status] ?? "None";
    if (status === "None") return null;
    return { status, buyer: j.buyer, provider: j.provider, price: j.price.toString(), stakeLocked: j.stakeLocked.toString(), deadline: Number(j.deadline), resultHash: j.resultHash };
  }

  async freeStake(who: Address = this.address): Promise<bigint> {
    return this.c.pub.readContract({ address: this.o.escrowAddress, abi: escrowAbi, functionName: "freeStake", args: [who] });
  }

  async ethBalance(who: Address = this.address): Promise<bigint> {
    return this.c.pub.getBalance({ address: who });
  }

  /** Testnet faucet: the mock token lets anyone mint. */
  async mintMock(to: Address, amount: bigint) {
    const { request } = await this.c.pub.simulateContract({
      account: this.o.account, address: this.o.tokenAddress, abi: tokenAbi, functionName: "mint", args: [to, amount],
    });
    return this.wait(await this.c.wallet.writeContract(request));
  }
}
