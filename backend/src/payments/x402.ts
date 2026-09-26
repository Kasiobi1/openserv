import { hashCanonical } from "@atl/shared";
import { recoverMessageAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { EscrowClient, OnchainJob } from "../signer/escrow";
import { RailError, type FundingReceipt, type PaymentAuthorization, type PaymentRail, type PaymentRequirements } from "./types";

type Hex = `0x${string}`;

/** Buyer-side helper: sign the requirements exactly as issued. */
export async function signPaymentAuthorization(requirements: PaymentRequirements, privateKey: Hex): Promise<PaymentAuthorization> {
  const signature = await privateKeyToAccount(privateKey).signMessage({ message: { raw: hashCanonical(requirements) } });
  return { requirements, signature };
}

export interface X402StyleOptions {
  /** Settlement backend (MockEscrow now, viem-backed escrow later). */
  escrow: EscrowClient;
  network: string;
  asset: string;
  /** Escrow contract address. */
  payTo: string;
  ttlMs?: number;
  clock?: () => Date;
}

/**
 * x402-STYLE demo rail: pay-per-request semantics (requirements -> signed authorization) but not the real
 * x402 wire format or a facilitator. Checks: requirements were issued by us, unmodified, unexpired,
 * signed by the named payer, and not seen before. Issued/used state is in memory only.
 * Swap the body of acceptPayment for a real facilitator call when tooling is confirmed.
 */
export class X402StyleRail implements PaymentRail {
  readonly id = "x402" as const;
  readonly implemented = true;
  private issued = new Map<string, string>(); // nonce -> requirements hash
  private used = new Set<string>();

  /** Present only when the underlying escrow can read chain state. */
  describeJob?: (jobId: string) => Promise<OnchainJob | null>;

  constructor(private readonly o: X402StyleOptions) {
    if (o.escrow.describeJob) this.describeJob = (jobId) => o.escrow.describeJob!(jobId);
  }

  private now() {
    return (this.o.clock ?? (() => new Date()))();
  }

  async requestPayment(input: { jobId: string; buyer: string; amount: string }): Promise<PaymentRequirements> {
    const requirements: PaymentRequirements = {
      rail: "x402",
      scheme: "escrow-exact",
      network: this.o.network,
      asset: this.o.asset,
      amount: input.amount,
      payTo: this.o.payTo,
      jobId: input.jobId,
      payer: input.buyer,
      nonce: crypto.randomUUID(),
      validBefore: new Date(this.now().getTime() + (this.o.ttlMs ?? 600_000)).toISOString(),
    };
    this.issued.set(requirements.nonce, hashCanonical(requirements));
    return requirements;
  }

  async acceptPayment(auth: PaymentAuthorization): Promise<FundingReceipt> {
    const r = auth.requirements;
    const expected = this.issued.get(r.nonce);
    if (!expected) throw new RailError("unknown_requirements", "requirements were not issued by this rail");
    if (this.used.has(r.nonce)) throw new RailError("replay", "authorization already used");

    const hash = hashCanonical(r);
    if (hash !== expected) throw new RailError("tampered", "requirements differ from what was issued");
    if (this.now().getTime() > new Date(r.validBefore).getTime()) throw new RailError("expired", "requirements expired");

    let signer: string;
    try {
      signer = await recoverMessageAddress({ message: { raw: hash }, signature: auth.signature });
    } catch {
      throw new RailError("bad_signature", "signature could not be recovered");
    }
    if (signer.toLowerCase() !== r.payer.toLowerCase()) throw new RailError("bad_signature", "signature is not from the named payer");

    // Re-check after the await so two concurrent accepts cannot both pass.
    if (this.used.has(r.nonce)) throw new RailError("replay", "authorization already used");
    this.used.add(r.nonce);

    return { rail: "x402", jobId: r.jobId, payer: r.payer, amount: r.amount, reference: hashCanonical({ hash, signature: auth.signature }) };
  }

  release(jobId: string) {
    return this.o.escrow.release(jobId);
  }
  refundAndSlash(jobId: string, slashBps: number) {
    return this.o.escrow.refundAndSlash(jobId, slashBps);
  }
}
