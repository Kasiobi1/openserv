import { createPublicClient, createWalletClient, http, type Account, type Chain, type Transport } from "viem";

export interface ChainOptions {
  chain: Chain;
  /** Either an RPC URL or a ready-made transport (tests). */
  rpcUrl?: string;
  transport?: Transport;
  account: Account;
}

export function makeClients(o: ChainOptions) {
  const transport = o.transport ?? http(o.rpcUrl);
  return {
    pub: createPublicClient({ chain: o.chain, transport }),
    wallet: createWalletClient({ chain: o.chain, transport, account: o.account }),
  };
}
