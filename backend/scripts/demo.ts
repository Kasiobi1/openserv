// End-to-end demo against a RUNNING backend (npm run dev) and your deployed escrow.
//   npm run demo -w backend               -> scenarios a b c
//   npm run demo -w backend -- a d e      -> pick scenarios
// a  honest provider, schema tier        -> verified pass, price released
// b  faulty provider, schema tier        -> layer 1 fails, refund + slash
// c  price over the spend limit          -> rejected by policy before any money moves
// d  honest provider, auditor tier       -> layer 2 (SERV) audit, expected pass
// e  faulty provider, auditor tier       -> passes schema, contradicts inputs; audit should fail -> slash
// b and e use the same provider: after one slash its score is under the floor, so the other is blocked until the backend restarts (in-memory scores).
import { hashCanonical } from "@atl/shared";
import { privateKeyToAccount } from "viem/accounts";
import { chainByName, EscrowParticipant } from "../src/chain";
import { loadEnv } from "../src/config";
import { brokenPayload, honestPayload, M, plausibleFakePayload, specFor } from "./demo-data";

const env = loadEnv();
const need = (k: string) => {
  const v = process.env[k]?.trim();
  if (!v) throw new Error(`missing ${k} in .env (run: npm run wallets -w backend)`);
  return v;
};
if (!env.CHAIN_NAME || !env.CHAIN_RPC_URL || !env.ESCROW_ADDRESS || !env.TOKEN_ADDRESS) {
  throw new Error("CHAIN_NAME, CHAIN_RPC_URL, ESCROW_ADDRESS and TOKEN_ADDRESS must be set in .env");
}

const base = process.env.BACKEND_URL ?? `http://localhost:${env.PORT}`;
const explorer = { "base-sepolia": "https://sepolia.basescan.org/tx/", sepolia: "https://sepolia.etherscan.io/tx/", foundry: "" }[env.CHAIN_NAME];
const chain = chainByName(env.CHAIN_NAME);
const mk = (keyName: string) =>
  new EscrowParticipant({
    chain,
    rpcUrl: env.CHAIN_RPC_URL,
    account: privateKeyToAccount(need(keyName) as `0x${string}`),
    escrowAddress: env.ESCROW_ADDRESS as `0x${string}`,
    tokenAddress: env.TOKEN_ADDRESS as `0x${string}`,
  });
const buyer = mk("BUYER_PRIVATE_KEY");
const honest = mk("HONEST_PRIVATE_KEY");
const faulty = mk("FAULTY_PRIVATE_KEY");

const fmt = (n: bigint) => `${Number(n) / Number(M)}`;
const say = (s = "") => console.log(s);
const stamp = Date.now().toString(36);

type Api = { status: number; body: any };
async function api(method: "GET" | "POST", path: string, body?: unknown): Promise<Api> {
  try {
    const res = await fetch(`${base}${path}`, {
      method,
      ...(body !== undefined && { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  } catch {
    throw new Error(`cannot reach the backend at ${base}. Start it in another terminal with: npm run dev`);
  }
}

async function prepare() {
  say("Checking demo wallets...");
  for (const [name, w] of [["BUYER", buyer], ["HONEST", honest], ["FAULTY", faulty]] as const) {
    if ((await w.ethBalance()) === 0n) throw new Error(`${name} wallet ${w.address} has no ETH for gas. Fund it from a faucet.`);
  }
  if ((await buyer.tokenBalance()) < 60n * M) { await buyer.mintMock(buyer.address, 100n * M); say("  minted 100 mock tokens to the buyer"); }
  for (const [name, p] of [["HONEST", honest], ["FAULTY", faulty]] as const) {
    if ((await p.freeStake()) < 10n * M) {
      if ((await p.tokenBalance()) < 30n * M) await p.mintMock(p.address, 50n * M);
      await p.stake(30n * M);
      say(`  ${name} provider staked 30 mock tokens`);
    }
  }
}

async function runJob(o: { title: string; note: string; spec: ReturnType<typeof specFor>; provider: EscrowParticipant; payload: unknown; fundOnChain?: boolean }) {
  say(`\n=== ${o.title} ===`);
  say(o.note);
  const created = await api("POST", "/jobs", { spec: o.spec, provider: o.provider.address });
  if (created.status === 403) {
    const failed = created.body.decision.checks.filter((c: any) => !c.passed);
    say("  policy: REJECTED. No money moved.");
    for (const c of failed) say(`    - ${c.name}: ${c.detail}`);
    return;
  }
  if (created.status !== 201) throw new Error(`create job failed: ${created.status} ${JSON.stringify(created.body)}`);
  say("  policy: job authorized");

  await buyer.createJob(o.spec, o.provider.address);
  say(`  buyer funded ${fmt(BigInt(o.spec.maxPrice))} tokens into escrow, provider stake locked`);

  const payloadHash = hashCanonical(o.payload);
  await o.provider.submitResult(o.spec.id, payloadHash);
  const sub = await api("POST", `/jobs/${o.spec.id}/submissions`, { jobId: o.spec.id, provider: o.provider.address, payload: o.payload, payloadHash });
  if (sub.status !== 201) throw new Error(`submission failed: ${sub.status} ${JSON.stringify(sub.body)}`);
  say("  provider committed the result hash on-chain and delivered the payload");

  const ver = await api("POST", `/jobs/${o.spec.id}/verify`);
  if (ver.status === 503) return say(`  verify: ${ver.body.error}\n  (no report issued, nobody slashed; retry once the auditor is reachable)`);
  if (ver.status !== 200) throw new Error(`verify failed: ${ver.status} ${JSON.stringify(ver.body)}`);
  const rep = ver.body.body;
  say(`  verifier: ${rep.verdict.toUpperCase()}`);
  for (const c of rep.layer1.checks.filter((c: any) => !c.passed)) say(`    layer 1 - ${c.name}: ${c.detail}`);
  if (rep.layer2?.status === "completed") {
    const l2 = rep.layer2;
    say(`    layer 2 (${l2.model}): ${l2.passed ? "passed" : "FAILED"}, confidence ${l2.confidence}, ${l2.flaggedItems}/${l2.itemsAudited} items flagged`);
    for (const c of l2.concerns.slice(0, 3)) say(`      ${c.severity} #${c.itemIndex ?? "-"}: ${c.explanation}`);
  }

  const set = await api("POST", `/jobs/${o.spec.id}/settle`);
  if (set.status !== 200) {
    say("  signer: REFUSED to settle");
    for (const c of set.body.decision?.checks?.filter((c: any) => !c.passed) ?? []) say(`    - ${c.name}: ${c.detail}`);
    return;
  }
  say(`  signer: ${set.body.decision.action === "release" ? "RELEASED payment to provider" : "REFUNDED buyer and SLASHED provider stake"}`);
  if (explorer) say(`  tx: ${explorer}${set.body.txHash}`);
  say(`  balances: buyer ${fmt(await buyer.tokenBalance())}, provider ${fmt(await o.provider.tokenBalance())}, provider free stake ${fmt(await o.provider.freeStake())}`);
}

const scenarios: Record<string, () => Promise<void>> = {
  a: () => runJob({ title: "A. Honest provider (schema tier)", note: "Correct output; expect verified pass and release.",
      spec: specFor({ id: `demo-a-${stamp}`, buyer: buyer.address, maxPrice: 10n * M, tier: "schema" }), provider: honest, payload: honestPayload() }),
  b: () => runJob({ title: "B. Faulty provider (schema tier)", note: "Broken output (19 items, wrong type, empty field, duplicate); expect refund + slash.",
      spec: specFor({ id: `demo-b-${stamp}`, buyer: buyer.address, maxPrice: 10n * M, tier: "schema" }), provider: faulty, payload: brokenPayload() }),
  c: () => runJob({ title: "C. Over the spend limit", note: "Buyer asks for 2000 tokens; per-job limit is lower. Expect rejection before any funding.",
      spec: specFor({ id: `demo-c-${stamp}`, buyer: buyer.address, maxPrice: 2000n * M, tier: "schema" }), provider: honest, payload: honestPayload() }),
  d: () => runJob({ title: "D. Honest provider (auditor tier)", note: "Correct output; layer 1 then a semantic audit by the reasoning provider in .env. Expect pass.",
      spec: specFor({ id: `demo-d-${stamp}`, buyer: buyer.address, maxPrice: 10n * M, tier: "auditor" }), provider: honest, payload: honestPayload() }),
  e: () => runJob({ title: "E. Plausible fake (auditor tier)", note: "Passes every schema rule but contradicts the inputs. Model-dependent: expect the audit to fail it.",
      spec: specFor({ id: `demo-e-${stamp}`, buyer: buyer.address, maxPrice: 10n * M, tier: "auditor" }), provider: faulty, payload: plausibleFakePayload() }),
};

const picked = process.argv.slice(2).map((s) => s.toLowerCase());
const run = picked.length ? picked : ["a", "b", "c"];
for (const k of run) if (!scenarios[k]) throw new Error(`unknown scenario "${k}" (use a b c d e)`);

const cfg = await api("GET", "/config");
if (cfg.body?.autoPipeline) {
  throw new Error("this scripted demo calls /verify and /settle itself. Restart the backend with AUTO_PIPELINE=false, or use the agents demo (npm run demo -w agents).");
}
await prepare();
for (const k of run) await scenarios[k]!();
const board = await api("GET", "/providers/leaderboard");
say("\n=== Reputation ===");
for (const r of board.body ?? []) say(`  ${r.provider}  score ${r.score}/1000  (${r.jobs} settled jobs)`);
