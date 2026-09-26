import { describe, expect, it } from "vitest";
import { generatePrivateKey } from "viem/accounts";
import { addressOf } from "@atl/shared";
import { MockEscrow } from "../src/signer/escrow";
import { RailError, X402StyleRail, signPaymentAuthorization, withStubs } from "../src/payments";

const buyerKey = generatePrivateKey();
const buyer = addressOf(buyerKey);

function setup(clock?: () => Date) {
  const escrow = new MockEscrow();
  const rail = new X402StyleRail({ escrow, network: "base-sepolia", asset: "mock-erc20", payTo: "0x00000000000000000000000000000000000000e5", ...(clock && { clock }) });
  return { escrow, rail };
}
const codeOf = async (p: Promise<unknown>) => p.then(() => "ok", (e: RailError) => e.code);

describe("x402-style rail", () => {
  it("issues requirements, accepts the buyer's signed authorization, returns a receipt", async () => {
    const { rail } = setup();
    const req = await rail.requestPayment({ jobId: "j1", buyer, amount: "10000000" });
    expect(req).toMatchObject({ rail: "x402", jobId: "j1", payer: buyer, amount: "10000000" });
    const receipt = await rail.acceptPayment(await signPaymentAuthorization(req, buyerKey));
    expect(receipt).toMatchObject({ rail: "x402", jobId: "j1", payer: buyer, amount: "10000000" });
    expect(receipt.reference).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("rejects replay, tampering, wrong signer, unknown and expired requirements", async () => {
    const { rail } = setup();
    const req = await rail.requestPayment({ jobId: "j1", buyer, amount: "10000000" });
    const auth = await signPaymentAuthorization(req, buyerKey);

    // wrong signer
    expect(await codeOf(rail.acceptPayment(await signPaymentAuthorization(req, generatePrivateKey())))).toBe("bad_signature");
    // tampered amount (signature is over the tampered body, so only the issued-hash check can catch it)
    const cheaper = { ...req, amount: "1" };
    expect(await codeOf(rail.acceptPayment(await signPaymentAuthorization(cheaper, buyerKey)))).toBe("tampered");
    // never issued
    const fake = { ...req, nonce: "made-up" };
    expect(await codeOf(rail.acceptPayment(await signPaymentAuthorization(fake, buyerKey)))).toBe("unknown_requirements");
    // first use ok, second is a replay
    await rail.acceptPayment(auth);
    expect(await codeOf(rail.acceptPayment(auth))).toBe("replay");
  });

  it("rejects expired requirements", async () => {
    let t = new Date("2026-09-19T00:00:00Z");
    const { rail } = setup(() => t);
    const req = await rail.requestPayment({ jobId: "j1", buyer, amount: "5" });
    t = new Date("2026-09-19T01:00:00Z");
    expect(await codeOf(rail.acceptPayment(await signPaymentAuthorization(req, buyerKey)))).toBe("expired");
  });

  it("does not let two concurrent accepts both succeed", async () => {
    const { rail } = setup();
    const req = await rail.requestPayment({ jobId: "j1", buyer, amount: "5" });
    const auth = await signPaymentAuthorization(req, buyerKey);
    const results = await Promise.all([codeOf(rail.acceptPayment(auth)), codeOf(rail.acceptPayment(auth))]);
    expect(results.filter((r) => r === "ok")).toHaveLength(1);
  });

  it("delegates settlement to the escrow", async () => {
    const { rail, escrow } = setup();
    await rail.release("j1");
    await rail.refundAndSlash("j2", 3000);
    expect(escrow.calls.map((c) => c.op)).toEqual(["release", "refundAndSlash"]);
  });
});

describe("registry and stubs", () => {
  it("lists implemented vs placeholder rails and refuses to wire a placeholder", async () => {
    const { rail } = setup();
    const reg = withStubs([rail]);
    expect(reg.list().sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: "ap2", implemented: false },
      { id: "mpp", implemented: false },
      { id: "stablecoin", implemented: false },
      { id: "x402", implemented: true },
    ]);
    expect(reg.getImplemented("x402")).toBe(rail);
    expect(() => reg.getImplemented("ap2")).toThrow("placeholder");
    expect(await codeOf(reg.get("ap2").release("j"))).toBe("not_implemented");
    expect(await codeOf(reg.get("stablecoin").requestPayment({ jobId: "j", buyer, amount: "1" }))).toBe("not_implemented");
  });
});
