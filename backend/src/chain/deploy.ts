import { escrowAbi, escrowBytecode, tokenAbi, tokenBytecode } from "@atl/shared";
import type { Account, Address } from "viem";
import { makeClients, type ChainOptions } from "./clients";

export interface DeployOptions extends Omit<ChainOptions, "account"> {
  deployer: Account;
  /** Address of the policy signer key. Only this address can release/slash. */
  policySigner: Address;
  /** Defaults to the deployer. Can rotate the signer, so keep it separate from the signer in real use. */
  owner?: Address;
  /** Reuse an existing ERC-20; otherwise MockERC20 is deployed (testnet only). */
  tokenAddress?: Address;
}

export async function deployAll(o: DeployOptions): Promise<{ escrow: Address; token: Address; tokenDeployed: boolean }> {
  const { pub, wallet } = makeClients({ ...o, account: o.deployer });

  let token = o.tokenAddress;
  if (!token) {
    const hash = await wallet.deployContract({ abi: tokenAbi, bytecode: tokenBytecode });
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== "success" || !r.contractAddress) throw new Error("token deployment failed");
    token = r.contractAddress;
  }

  const hash = await wallet.deployContract({
    abi: escrowAbi,
    bytecode: escrowBytecode,
    args: [token, o.policySigner, o.owner ?? o.deployer.address],
  });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success" || !r.contractAddress) throw new Error("escrow deployment failed");
  return { escrow: r.contractAddress, token, tokenDeployed: !o.tokenAddress };
}
