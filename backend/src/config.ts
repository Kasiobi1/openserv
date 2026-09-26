import { z } from "zod";

const Env = z.object({
  VERIFIER_PRIVATE_KEY: z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional(),
  SIGNER_PRIVATE_KEY: z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional(),
  TOKEN_DECIMALS: z.coerce.number().int().min(0).max(18).default(6),
  MAX_SPEND_PER_JOB: z.string().regex(/^\d+$/).default("1000000000"),
  MIN_PROVIDER_SCORE: z.coerce.number().int().min(0).max(1000).default(300),
  SLASH_BPS: z.coerce.number().int().min(0).max(10_000).default(3000),
  REPORT_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(900),
  PORT: z.coerce.number().int().default(8787),

  // When true, a submission automatically triggers verify then settle (no one has to call /verify and /settle).
  AUTO_PIPELINE: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  // Comma-separated list of dashboard origins allowed by CORS. Unset = any origin (read-only demo data).
  DASHBOARD_ORIGIN: z.string().optional(),
  TOKEN_SYMBOL: z.string().default("mUSD"),

  // Reasoning: "serv" and "openai-compatible" both need KEY + MODEL (serv defaults the base URL).
  REASONING_PROVIDER: z.enum(["mock", "serv", "openai-compatible"]).default("mock"),
  REASONING_BASE_URL: z.string().url().optional(),
  REASONING_API_KEY: z.string().min(1).optional(),
  REASONING_MODEL: z.string().min(1).optional(),

  // Semantic audit (verifier layer 2)
  AUDIT_MAX_ITEMS: z.coerce.number().int().positive().default(50),
  AUDIT_MAX_CHARS: z.coerce.number().int().positive().default(60_000),
  AUDIT_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.8),

  // Persistence. Leave both unset to use the in-memory store (lost on restart).
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SECRET_KEY: z.string().min(1).optional(),

  // Chain. Leave ESCROW_ADDRESS unset to use the in-memory mock escrow.
  CHAIN_NAME: z.enum(["base-sepolia", "sepolia", "foundry"]).optional(),
  CHAIN_RPC_URL: z.string().url().optional(),
  ESCROW_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  TOKEN_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),

  // Payment rail used on the settlement path. Only "x402" is implemented.
  RAIL: z.enum(["x402", "ap2", "mpp", "stablecoin"]).default("x402"),
  RAIL_NETWORK: z.string().default("base-sepolia"),
  RAIL_ASSET: z.string().default("mock-erc20"),
  /** Escrow contract address. Zero address is a placeholder until the contract is deployed. */
  RAIL_PAY_TO: z.string().regex(/^0x[a-fA-F0-9]{40}$/).default("0x0000000000000000000000000000000000000000"),
});

/** Blank values (`KEY=` lines copied from .env.example) are treated as unset, so defaults and optionals still apply. */
export function loadEnv(env: NodeJS.ProcessEnv = process.env) {
  return Env.parse(Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v.trim() !== "")));
}
