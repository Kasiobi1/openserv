import { baseSepolia, foundry, sepolia } from "viem/chains";
import type { Chain } from "viem";

export const CHAIN_NAMES = ["base-sepolia", "sepolia", "foundry"] as const;
export type ChainName = (typeof CHAIN_NAMES)[number];

/** "foundry" = local anvil (chain id 31337). */
export function chainByName(name: ChainName): Chain {
  return { "base-sepolia": baseSepolia, sepolia, foundry }[name];
}
