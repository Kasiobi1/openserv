// Usage: DEPLOYER_PRIVATE_KEY=0x.. SIGNER_PRIVATE_KEY=0x.. CHAIN_NAME=base-sepolia CHAIN_RPC_URL=https://.. npm run deploy
// Deploys AgentEscrow (and MockERC20 unless TOKEN_ADDRESS is set) and prints the env lines the backend needs.
import { privateKeyToAccount } from "viem/accounts";
import { chainByName, deployAll, CHAIN_NAMES, type ChainName } from "../src/chain";

const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
};
const name = need("CHAIN_NAME") as ChainName;
if (!CHAIN_NAMES.includes(name)) throw new Error(`CHAIN_NAME must be one of ${CHAIN_NAMES.join(", ")}`);

const deployer = privateKeyToAccount(need("DEPLOYER_PRIVATE_KEY") as `0x${string}`);
const signer = privateKeyToAccount(need("SIGNER_PRIVATE_KEY") as `0x${string}`);
if (deployer.address === signer.address) console.warn("warning: deployer and signer are the same key; use separate keys outside local testing");

const out = await deployAll({
  chain: chainByName(name),
  rpcUrl: need("CHAIN_RPC_URL"),
  deployer,
  policySigner: signer.address,
  ...(process.env.OWNER_ADDRESS && { owner: process.env.OWNER_ADDRESS as `0x${string}` }),
  ...(process.env.TOKEN_ADDRESS && { tokenAddress: process.env.TOKEN_ADDRESS as `0x${string}` }),
});

console.log(`\nDeployed on ${name}${out.tokenDeployed ? " (mock token deployed)" : ""}.\nAdd to .env:\n`);
console.log(`CHAIN_NAME=${name}\nESCROW_ADDRESS=${out.escrow}\nTOKEN_ADDRESS=${out.token}`);
