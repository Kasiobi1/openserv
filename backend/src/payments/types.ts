import type { EscrowClient } from "../signer/escrow";

export type RailId = "x402" | "ap2" | "mpp" | "stablecoin";

export class RailError extends Error {
  constructor(
    readonly code: "unknown_requirements" | "replay" | "tampered" | "expired" | "bad_signature" | "not_implemented",
    message: string,
  ) {
    super(message);
  }
}

/** What the buyer must authorize to fund a job's escrow (the x402 "402 Payment Required" payload, roughly). */
export interface PaymentRequirements {
  rail: RailId;
  scheme: string;
  network: string;
  asset: string;
  /** Smallest units, decimal string. */
  amount: string;
  /** Escrow contract address that receives the funds. */
  payTo: string;
  jobId: string;
  /** The only address whose signature can authorize this payment. */
  payer: string;
  nonce: string;
  validBefore: string;
}

export interface PaymentAuthorization {
  requirements: PaymentRequirements;
  /** Payer's signature over the canonical hash of `requirements`. */
  signature: `0x${string}`;
}

export interface FundingReceipt {
  rail: RailId;
  jobId: string;
  payer: string;
  amount: string;
  reference: string;
}

/**
 * How money gets into escrow and back out. Settlement (`release` / `refundAndSlash`) is inherited from
 * EscrowClient so the PolicySigner stays the only caller. Funding is buyer-authorized, never agent-initiated.
 */
export interface PaymentRail extends EscrowClient {
  readonly id: RailId;
  /** false for placeholders that only reserve the slot in the architecture. */
  readonly implemented: boolean;
  requestPayment(input: { jobId: string; buyer: string; amount: string }): Promise<PaymentRequirements>;
  acceptPayment(auth: PaymentAuthorization): Promise<FundingReceipt>;
}
