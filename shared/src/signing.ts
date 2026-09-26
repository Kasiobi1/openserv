import { privateKeyToAccount } from "viem/accounts";
import { recoverMessageAddress } from "viem";
import { hashCanonical } from "./hash";
import type { VerificationReport, VerificationReportBody } from "./types";

type Hex = `0x${string}`;

export function addressOf(privateKey: Hex): Hex {
  return privateKeyToAccount(privateKey).address;
}

export async function signReport(body: VerificationReportBody, privateKey: Hex): Promise<VerificationReport> {
  const account = privateKeyToAccount(privateKey);
  const hash = hashCanonical(body);
  const signature = await account.signMessage({ message: { raw: hash } });
  return { body, hash, signature };
}

/** Recomputes the hash from the body and recovers the signer. Never trusts the `hash` field as given. */
export async function recoverReportSigner(
  report: VerificationReport,
): Promise<{ ok: true; signer: Hex } | { ok: false; reason: string }> {
  const expected = hashCanonical(report.body);
  if (expected.toLowerCase() !== report.hash.toLowerCase()) {
    return { ok: false, reason: "report hash does not match body" };
  }
  try {
    const signer = await recoverMessageAddress({ message: { raw: expected }, signature: report.signature as Hex });
    return { ok: true, signer };
  } catch {
    return { ok: false, reason: "signature could not be recovered" };
  }
}
