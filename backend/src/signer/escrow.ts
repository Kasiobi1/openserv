import { hashCanonical } from "@atl/shared";

export type OnchainStatus = "None" | "Funded" | "Submitted" | "Released" | "Slashed" | "Reclaimed";

export interface OnchainJob {
  status: OnchainStatus;
  buyer: string;
  provider: string;
  /** smallest units */
  price: string;
  stakeLocked: string;
  deadline: number;
  resultHash: string;
}

export interface EscrowClient {
  release(jobId: string): Promise<{ txHash: string }>;
  refundAndSlash(jobId: string, slashBps: number): Promise<{ txHash: string }>;
  /** Present on clients backed by a chain. null = no such job on-chain. Absent = no chain view (mock). */
  describeJob?(jobId: string): Promise<OnchainJob | null>;
}

/**
 * In-memory stand-in for the Solidity escrow. Mirrors the contract's guard: a job settles once.
 * Used for tests and offline dev; `ViemEscrowClient` is the real one.
 */
export class MockEscrow implements EscrowClient {
  readonly calls: { op: "release" | "refundAndSlash"; jobId: string; slashBps?: number; txHash: string }[] = [];
  private settled = new Set<string>();

  private guard(jobId: string) {
    if (this.settled.has(jobId)) throw new Error("escrow: job already settled");
    this.settled.add(jobId);
  }

  async release(jobId: string) {
    this.guard(jobId);
    const txHash = hashCanonical({ op: "release", jobId, n: this.calls.length });
    this.calls.push({ op: "release", jobId, txHash });
    return { txHash };
  }

  async refundAndSlash(jobId: string, slashBps: number) {
    this.guard(jobId);
    const txHash = hashCanonical({ op: "refundAndSlash", jobId, slashBps, n: this.calls.length });
    this.calls.push({ op: "refundAndSlash", jobId, slashBps, txHash });
    return { txHash };
  }
}
