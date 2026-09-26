import { addressOf } from "@atl/shared";
import { generatePrivateKey } from "viem/accounts";
import { loadEnv } from "./config";
import { MockEscrow, type EscrowClient } from "./signer/escrow";
import { PolicySigner } from "./signer/service";
import type { PolicyConfig } from "./signer/policy";
import { DEFAULT_SCORE_CONFIG } from "./reputation/score";
import { JobService } from "./services/jobs";
import { MemoryStore } from "./store/memory";
import { createSupabaseStore } from "./store/supabase";
import type { Store } from "./store/types";
import { Verifier } from "./verifier";
import { withStubs } from "./payments/registry";
import { X402StyleRail } from "./payments/x402";
import { createReasoningProvider } from "./reasoning/factory";
import { SemanticAuditor } from "./verifier/layer2";
import { createChainEscrow } from "./chain/factory";
import { buildServer } from "./server";

export function wire(opts: { store?: Store; escrow?: EscrowClient; env?: NodeJS.ProcessEnv } = {}) {
  const env = loadEnv(opts.env);
  const verifierKey = (env.VERIFIER_PRIVATE_KEY ?? generatePrivateKey()) as `0x${string}`;
  if (!env.VERIFIER_PRIVATE_KEY) console.warn("VERIFIER_PRIVATE_KEY not set: using an ephemeral key (dev only)");
  const reasoning = createReasoningProvider(env);
  const auditor = new SemanticAuditor(reasoning, {
    maxItems: env.AUDIT_MAX_ITEMS,
    maxChars: env.AUDIT_MAX_CHARS,
    minConfidence: env.AUDIT_MIN_CONFIDENCE,
  });
  const verifier = new Verifier(verifierKey, undefined, auditor);

  const policy: PolicyConfig = {
    maxSpendPerJob: BigInt(env.MAX_SPEND_PER_JOB),
    minProviderScore: env.MIN_PROVIDER_SCORE,
    slashBps: env.SLASH_BPS,
    trustedVerifiers: [verifier.address],
    reportMaxAgeMs: env.REPORT_MAX_AGE_SECONDS * 1000,
  };
  const scoreCfg = { ...DEFAULT_SCORE_CONFIG, tokenDecimals: env.TOKEN_DECIMALS };
  const persistent = Boolean(env.SUPABASE_URL && env.SUPABASE_SECRET_KEY);
  if ((env.SUPABASE_URL || env.SUPABASE_SECRET_KEY) && !persistent) {
    throw new Error("set both SUPABASE_URL and SUPABASE_SECRET_KEY to use Supabase, or neither to use the in-memory store");
  }
  const store = opts.store ?? (persistent ? createSupabaseStore(env.SUPABASE_URL!, env.SUPABASE_SECRET_KEY!) : new MemoryStore());
  const chain = opts.escrow ? undefined : createChainEscrow(env);
  const escrow = opts.escrow ?? chain ?? new MockEscrow();

  // The rail wraps the settlement backend; the signer reaches escrow only through the selected rail.
  const rails = withStubs([
    new X402StyleRail({
      escrow,
      network: env.CHAIN_NAME ?? env.RAIL_NETWORK,
      asset: env.TOKEN_ADDRESS ?? env.RAIL_ASSET,
      payTo: env.ESCROW_ADDRESS ?? env.RAIL_PAY_TO,
    }),
  ]);
  const rail = rails.getImplemented(env.RAIL);
  const explorer = {
    "base-sepolia": { tx: "https://sepolia.basescan.org/tx/", address: "https://sepolia.basescan.org/address/" },
    sepolia: { tx: "https://sepolia.etherscan.io/tx/", address: "https://sepolia.etherscan.io/address/" },
    foundry: undefined,
  }[env.CHAIN_NAME ?? "foundry"];

  const signer = new PolicySigner(store, rail, policy, scoreCfg);
  const jobs = new JobService(store, verifier, signer, scoreCfg, undefined, { auto: env.AUTO_PIPELINE });
  return { env, store, escrow, chain, rails, rail, reasoning, verifier, signer, jobs, app: buildServer(jobs, {
    ...(env.DASHBOARD_ORIGIN && { corsOrigins: env.DASHBOARD_ORIGIN.split(",").map((o) => o.trim()).filter(Boolean) }),
    publicConfig: {
      chain: env.CHAIN_NAME ?? "mock",
      explorerTxBase: explorer?.tx ?? null,
      explorerAddressBase: explorer?.address ?? null,
      escrowAddress: env.ESCROW_ADDRESS ?? null,
      tokenAddress: env.TOKEN_ADDRESS ?? null,
      tokenSymbol: env.TOKEN_SYMBOL,
      tokenDecimals: env.TOKEN_DECIMALS,
      verifier: verifier.address,
      reasoning: reasoning.id,
      policy: { maxSpendPerJob: env.MAX_SPEND_PER_JOB, minProviderScore: env.MIN_PROVIDER_SCORE, slashBps: env.SLASH_BPS },
      persistent,
    },
  }), verifierAddress: addressOf(verifierKey) };
}
