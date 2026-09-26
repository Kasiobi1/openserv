import { nonceManager } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chainByName, type ChainName } from "./chains";
import { ViemEscrowClient } from "./viem-escrow";

export interface ChainEnv {
  CHAIN_NAME?: ChainName | undefined;
  CHAIN_RPC_URL?: string | undefined;
  ESCROW_ADDRESS?: string | undefined;
  SIGNER_PRIVATE_KEY?: string | undefined;
}

/** Returns undefined when no ESCROW_ADDRESS is configured (mock escrow). Otherwise all four vars are required. */
export function createChainEscrow(env: ChainEnv): ViemEscrowClient | undefined {
  if (!env.ESCROW_ADDRESS) return undefined;
  const missing = [
    !env.CHAIN_NAME && "CHAIN_NAME",
    !env.CHAIN_RPC_URL && "CHAIN_RPC_URL",
    !env.SIGNER_PRIVATE_KEY && "SIGNER_PRIVATE_KEY",
  ].filter(Boolean);
  if (missing.length) throw new Error(`ESCROW_ADDRESS is set, so these are required too: ${missing.join(", ")}`);
  return new ViemEscrowClient({
    chain: chainByName(env.CHAIN_NAME!),
    rpcUrl: env.CHAIN_RPC_URL!,
    escrowAddress: env.ESCROW_ADDRESS as `0x${string}`,
    account: privateKeyToAccount(env.SIGNER_PRIVATE_KEY as `0x${string}`, { nonceManager }),
  });
}
