// npm run demo -w agents [-- --fault broken|fake]     runs buyer + honest + faulty agents against a running backend
// npm run provider -w agents -- --role honest|faulty [--fault broken|fake]     runs one provider agent until Ctrl-C
import { privateKeyToAccount } from "viem/accounts";
import { chainByName, EscrowParticipant } from "@atl/backend/src/chain";
import { loadEnv } from "@atl/backend/src/config";
import { createReasoningProvider } from "@atl/backend/src/reasoning";
import { BuyerAgent } from "./buyer";
import { InvoiceExtractor } from "./extractor";
import type { Fault } from "./faults";
import { BackendClient } from "./http";
import { invoiceJob, TOKEN } from "./jobs";
import { ProviderAgent } from "./provider";
import { prepareWallets } from "./setup";

const env = loadEnv();
const args = process.argv.slice(2);
const cmd = args[0];
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const say = (s = "") => console.log(s);
const need = (k: string) => {
  const v = process.env[k]?.trim();
  if (!v) throw new Error(`missing ${k} in .env`);
  return v;
};

if (!env.CHAIN_NAME || !env.CHAIN_RPC_URL || !env.ESCROW_ADDRESS || !env.TOKEN_ADDRESS) {
  throw new Error("CHAIN_NAME, CHAIN_RPC_URL, ESCROW_ADDRESS and TOKEN_ADDRESS must be set in .env");
}
const chain = chainByName(env.CHAIN_NAME);
const wallet = (k: string) =>
  new EscrowParticipant({
    chain,
    rpcUrl: env.CHAIN_RPC_URL,
    account: privateKeyToAccount(need(k) as `0x${string}`),
    escrowAddress: env.ESCROW_ADDRESS as `0x${string}`,
    tokenAddress: env.TOKEN_ADDRESS as `0x${string}`,
  });
const backend = new BackendClient(process.env.BACKEND_URL ?? `http://localhost:${env.PORT}`);
const explorerTx = { "base-sepolia": "https://sepolia.basescan.org/tx/", sepolia: "https://sepolia.etherscan.io/tx/", foundry: "" }[env.CHAIN_NAME];
const fmt = (n: bigint) => `${Number(n) / Number(TOKEN)}`;

function reasoning() {
  if (env.REASONING_PROVIDER === "mock") {
    throw new Error("the agents need a real model to do the extraction. Set REASONING_PROVIDER=serv plus REASONING_API_KEY and REASONING_MODEL in .env");
  }
  return new InvoiceExtractor(createReasoningProvider(env));
}

const faultOf = (v: string | undefined): Fault | undefined => {
  if (v === undefined) return undefined;
  if (v !== "broken" && v !== "fake") throw new Error(`--fault must be broken or fake`);
  return v;
};

if (cmd === "provider") {
  const role = flag("role");
  if (role !== "honest" && role !== "faulty") throw new Error("--role must be honest or faulty");
  const fault = role === "faulty" ? (faultOf(flag("fault")) ?? "broken") : undefined;
  const agent = new ProviderAgent({ name: `${role}-agent`, participant: wallet(role === "honest" ? "HONEST_PRIVATE_KEY" : "FAULTY_PRIVATE_KEY"), backend, worker: reasoning(), ...(fault && { fault }) });
  say(`${role} provider agent running as ${agent.address}. Ctrl-C to stop.`);
  await agent.run();
} else if (cmd === "demo") {
  const cfg = (await backend.config()).body;
  const drive = !cfg?.autoPipeline;
  const fault = faultOf(flag("fault")) ?? "broken";
  const faultyTier = fault === "fake" ? "auditor" : "schema";
  const worker = reasoning();

  const buyerW = wallet("BUYER_PRIVATE_KEY");
  const honestW = wallet("HONEST_PRIVATE_KEY");
  const faultyW = wallet("FAULTY_PRIVATE_KEY");
  await prepareWallets({ buyer: buyerW, honest: honestW, faulty: faultyW }, (l) => say(`  ${l}`));

  const buyer = new BuyerAgent({ participant: buyerW, backend });
  const honest = new ProviderAgent({ name: "honest-agent", participant: honestW, backend, worker });
  const faulty = new ProviderAgent({ name: "faulty-agent", participant: faultyW, backend, worker, fault });
  void honest.run(2000);
  void faulty.run(2000);

  const stamp = Date.now().toString(36);
  const stake = 5n * TOKEN;

  async function scenario(title: string, note: string, o: { id: string; provider: EscrowParticipant; price: bigint; tier: "schema" | "auditor" }) {
    say(`\n=== ${title} ===\n${note}`);
    const { spec } = invoiceJob({ id: o.id, buyer: buyer.address, price: o.price, stake, tier: o.tier });
    const posted = await buyer.postJob(spec, o.provider.address);
    if (!posted.ok) {
      say("  policy: REJECTED. No money moved.");
      for (const r of posted.reasons) say(`    - ${r}`);
      return;
    }
    say("  waiting for the provider agent to work, the verifier to check, and the signer to settle...");
    const { detail, finished } = await buyer.waitForOutcome(o.id, { drive });
    const rep = detail?.report?.body;
    if (rep) {
      say(`  verifier: ${rep.verdict.toUpperCase()}`);
      for (const c of rep.layer1.checks.filter((c: any) => !c.passed)) say(`    layer 1 - ${c.name}: ${c.detail}`);
      if (rep.layer2?.status === "completed") {
        const l2 = rep.layer2;
        say(`    layer 2 (${l2.model}): ${l2.passed ? "passed" : "FAILED"}, confidence ${l2.confidence}, ${l2.flaggedItems}/${l2.itemsAudited} flagged`);
        for (const c of l2.concerns.slice(0, 3)) say(`      ${c.severity} #${c.itemIndex ?? "-"}: ${c.explanation}`);
      }
    }
    const s = detail?.job?.settlement;
    if (s) {
      say(`  signer: ${s.action === "release" ? "RELEASED payment to provider" : "REFUNDED buyer and SLASHED provider stake"}`);
      if (explorerTx) say(`  tx: ${explorerTx}${s.txHash}`);
      say(`  balances: buyer ${fmt(await buyerW.tokenBalance())}, provider ${fmt(await o.provider.tokenBalance())}`);
    } else if (!finished) {
      say(`  not finished (status: ${detail?.job?.status ?? "unknown"}). See the dashboard audit trail for why.`);
    }
  }

  say(`Backend ${backend.base} (${drive ? "manual pipeline: this demo triggers verify and settle" : "automatic pipeline"}).`);
  await scenario("1. Honest agent, AI-audited job", "The agent extracts 20 invoices with the reasoning model; the verifier audits the result.", { id: `agents-honest-${stamp}`, provider: honestW, price: 10n * TOKEN, tier: "auditor" });
  await scenario(`2. Faulty agent (${fault})`, fault === "broken" ? "Same model, then deliberate damage: a missing item, a wrong type, an empty field, a duplicate." : "Same model, then plausible-looking but wrong values that only the AI audit can catch.", { id: `agents-faulty-${stamp}`, provider: faultyW, price: 10n * TOKEN, tier: faultyTier });
  await scenario("3. Job over the spend limit", "The buyer asks for 2000 tokens. The policy layer should refuse before anything is funded.", { id: `agents-over-${stamp}`, provider: honestW, price: 2000n * TOKEN, tier: "schema" });

  honest.stop();
  faulty.stop();
  say("\n=== Reputation ===");
  for (const r of (await backend.leaderboard()) ?? []) say(`  ${r.provider}  score ${r.score}/1000  (${r.jobs} settled jobs)`);
  say("\nOpen the dashboard to see the audit trail: npm run dashboard  (http://localhost:5173)");
  process.exit(0);
} else {
  say("usage:\n  npm run demo -w agents [-- --fault broken|fake]\n  npm run provider -w agents -- --role honest|faulty [--fault broken|fake]");
}
