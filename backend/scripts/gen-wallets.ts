// Generates three throwaway demo wallets (buyer + two providers). Testnet only. Run: npm run wallets -w backend
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const roles = ["BUYER", "HONEST", "FAULTY"] as const;
const keys = roles.map((r) => ({ r, k: generatePrivateKey() }));

console.log("Paste these into .env:\n");
for (const { r, k } of keys) console.log(`${r}_PRIVATE_KEY=${k}`);
console.log("\nFund each of these with a little Base Sepolia ETH (gas):\n");
for (const { r, k } of keys) console.log(`${r.padEnd(7)} ${privateKeyToAccount(k).address}`);
console.log("\nThe mock token is free: the demo mints it for you.");
