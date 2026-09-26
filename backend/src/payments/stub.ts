import { RailError, type FundingReceipt, type PaymentRail, type PaymentRequirements, type RailId } from "./types";

/** Reserves a rail's place in the architecture. Every call fails loudly rather than pretending to work. */
export class UnsupportedRail implements PaymentRail {
  readonly implemented = false;
  constructor(readonly id: RailId, private readonly note: string) {}

  private fail(): never {
    throw new RailError("not_implemented", `rail "${this.id}" is not implemented: ${this.note}`);
  }
  async requestPayment(): Promise<PaymentRequirements> { return this.fail(); }
  async acceptPayment(): Promise<FundingReceipt> { return this.fail(); }
  async release(): Promise<{ txHash: string }> { return this.fail(); }
  async refundAndSlash(): Promise<{ txHash: string }> { return this.fail(); }
}

export const stubRails = () => [
  new UnsupportedRail("ap2", "authorization mandates layer; add once AP2 tooling is confirmed"),
  new UnsupportedRail("mpp", "newest and least documented; revisit after the hackathon"),
  new UnsupportedRail("stablecoin", "BVNK-style settlement needs a business relationship; architecture diagram only"),
];
