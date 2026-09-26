import { keccak256, toBytes } from "viem";

/** Deterministic JSON: sorted keys, no whitespace. Undefined properties are dropped. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "bigint") return JSON.stringify(value.toString());
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",")}}`;
}

export function hashCanonical(value: unknown): `0x${string}` {
  return keccak256(toBytes(canonicalize(value)));
}

/** On-chain job id (bytes32) for a backend job id string. */
export function jobKey(id: string): `0x${string}` {
  return keccak256(toBytes(id));
}
