import { escrowAbi, jobKey } from "@atl/shared";
import type { Account, Address, Chain, Transport } from "viem";
import type { EscrowClient, OnchainJob, OnchainStatus } from "../signer/escrow";
import { makeClients } from "./clients";

const STATUS: OnchainStatus[] = ["None", "Funded", "Submitted", "Released", "Slashed", "Reclaimed"];

export interface ViemEscrowOptions {
  chain: Chain;
  rpcUrl?: string;
  transport?: Transport;
  escrowAddress: Address;
  /** The policy signer's account. This is the only key that can release or slash. */
  account: Account;
}

/**
 * Real EscrowClient. Every write is simulated first (so reverts surface with a reason before anything is
 * broadcast), then sent, then awaited; a reverted receipt throws. Give it ONLY to the PolicySigner.
 */
export class ViemEscrowClient implements EscrowClient {
  private readonly c;
  readonly signerAddress: Address;

  constructor(private readonly o: ViemEscrowOptions) {
    this.c = makeClients(o);
    this.signerAddress = o.account.address;
  }

  /** Startup safety check: code exists at the address and this account really is the contract's policy signer. */
  async assertReady(): Promise<void> {
    const code = await this.c.pub.getCode({ address: this.o.escrowAddress });
    if (!code || code === "0x") throw new Error(`no contract at ${this.o.escrowAddress}`);
    const onchainSigner = await this.c.pub.readContract({ address: this.o.escrowAddress, abi: escrowAbi, functionName: "policySigner" });
    if (onchainSigner.toLowerCase() !== this.signerAddress.toLowerCase()) {
      throw new Error(`escrow policySigner is ${onchainSigner}, but the configured signer key is ${this.signerAddress}`);
    }
  }

  async release(jobId: string): Promise<{ txHash: string }> {
    const { request } = await this.c.pub.simulateContract({
      account: this.o.account,
      address: this.o.escrowAddress,
      abi: escrowAbi,
      functionName: "release",
      args: [jobKey(jobId)],
    });
    return this.send(await this.c.wallet.writeContract(request));
  }

  async refundAndSlash(jobId: string, slashBps: number): Promise<{ txHash: string }> {
    const { request } = await this.c.pub.simulateContract({
      account: this.o.account,
      address: this.o.escrowAddress,
      abi: escrowAbi,
      functionName: "refundAndSlash",
      args: [jobKey(jobId), slashBps],
    });
    return this.send(await this.c.wallet.writeContract(request));
  }

  async describeJob(jobId: string): Promise<OnchainJob | null> {
    const j = await this.c.pub.readContract({ address: this.o.escrowAddress, abi: escrowAbi, functionName: "getJob", args: [jobKey(jobId)] });
    const status = STATUS[j.status] ?? "None";
    if (status === "None") return null;
    return {
      status,
      buyer: j.buyer,
      provider: j.provider,
      price: j.price.toString(),
      stakeLocked: j.stakeLocked.toString(),
      deadline: Number(j.deadline),
      resultHash: j.resultHash,
    };
  }

  private async send(hash: `0x${string}`) {
    const receipt = await this.c.pub.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`transaction ${hash} reverted`);
    return { txHash: hash };
  }
}
