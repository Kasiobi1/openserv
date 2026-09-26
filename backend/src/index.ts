import { wire } from "./app";

const { app, env, verifierAddress, chain, store } = wire();
await chain?.assertReady(); // refuse to start if the escrow is missing or the signer key does not match
await app.listen({ port: env.PORT, host: "0.0.0.0" });
const storeName = store.constructor.name === "SupabaseStore" ? "Supabase store" : "in-memory store";
console.log(`agent-trust-layer backend on :${env.PORT} (verifier ${verifierAddress}, ${storeName}, ${chain ? "on-chain escrow" : "mock escrow"})`);
