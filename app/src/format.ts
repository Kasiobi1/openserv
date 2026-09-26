import type { JobStatus } from "./api";

export function fmtAmount(raw: string | bigint, decimals: number): string {
  const v = typeof raw === "bigint" ? raw : BigInt(raw);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  let frac = (abs % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  if (frac.length < 2) frac = frac.padEnd(2, "0");
  return `${neg ? "-" : ""}${whole.toString()}.${frac.slice(0, 4)}`;
}

export const short = (s: string, head = 6, tail = 4) => (s.length > head + tail + 1 ? `${s.slice(0, head)}…${s.slice(-tail)}` : s);

export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const STATUS: Record<JobStatus, { label: string; tone: "good" | "bad" | "warn" | "info" | "idle"; hint: string }> = {
  created: { label: "Open", tone: "idle", hint: "Waiting for the provider to deliver" },
  submitted: { label: "Delivered", tone: "info", hint: "Waiting for verification" },
  verified: { label: "Verified", tone: "info", hint: "Waiting for the signer to settle" },
  released: { label: "Released", tone: "good", hint: "Payment released to the provider" },
  slashed: { label: "Slashed", tone: "bad", hint: "Buyer refunded, provider stake slashed" },
  rejected: { label: "Rejected", tone: "warn", hint: "Refused by policy before any money moved" },
};

export const TIER: Record<"schema" | "auditor", string> = { schema: "Schema check", auditor: "Schema + AI audit" };

export const CHECK_LABEL: Record<string, string> = {
  spend_limit: "Under the spend limit",
  provider_score: "Provider score above the floor",
  job_state: "Job is ready to settle",
  report_signature: "Report signature is valid",
  verifier_trusted: "Signed by a trusted verifier",
  report_binds_spec: "Report matches the job spec",
  report_binds_submission: "Report matches the delivered result",
  report_fresh: "Report is recent",
  verdict_consistent: "Verdict agrees with the checks",
  tier_satisfied: "Requested verification tier was applied",
  onchain_matches: "On-chain escrow matches the job",
  payload_hash_matches: "Payload matches the hash committed on-chain",
  schema_valid: "Output matches the schema",
  items_present: "Items are present",
  item_count: "Item count is right",
  required_fields: "Required fields are filled",
  unique_items: "No duplicate items",
};
export const checkLabel = (name: string) => CHECK_LABEL[name] ?? name;
