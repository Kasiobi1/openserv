# Agent Trust Layer

**Escrow + verification + reputation for agent-to-agent commerce.**
When one AI agent pays another for work, how do you know the work is good before the money moves — without trusting an AI model to make that call?

## 🟢 Live Demo
- **Dashboard:** https://pactx.vercel.app
- **Backend API:** https://atl-backend-32to.onrender.com
- **Demo video:** [link]
- **Network:** Base Sepolia | **Escrow contract:** `0x3028655a1184bf68b30a244481e8be42bbabea57`
- **Status:** 124 tests passing · Persistent (Supabase) · Real on-chain settlement

> Backend runs on Render's free tier — first request after inactivity may take 30–60s to wake up.

## How it works
1. **Buyer** funds an escrow contract on-chain.
2. **Provider** delivers the work.
3. **Two-layer verification:**
   - Layer 1 — deterministic checks (schema, hashes). No AI involved.
   - Layer 2 — AI semantic audit (via OpenServ SERV). The model can only flag concerns — every number that decides pass/fail is computed by code, never trusted from the model.
4. **Policy signer** — the only key that can move funds — releases payment or refunds + slashes the provider's stake, based on the verdict.
5. **Reputation** updates: value-weighted, recency-decayed. Fall below the floor, you're locked out of new jobs.

## Why it's real
- ✅ 124 automated tests passing
- ✅ Real settled transactions on Base Sepolia
- ✅ Persistent (Supabase), hosted, live — not a local-only demo
- ✅ Found and fixed two real bugs during live testing (see commit history)

## Core principle
**AI never touches the money decision.** Model output is advisory input to deterministic code — always. This is enforced structurally: the reasoning layer has no code path to the signer or the escrow contract.

---

## Technical details
*(For judges who want to dig deeper — architecture, trust boundaries, API reference, contract details, local setup.)*

### Local setup
npm install
npm test # 70 tests (14 need Foundry's anvil; skipped if absent)
npm run typecheck
cp .env.example .env # fill in keys; the scripts load ../.env automatically (Node >= 22.9)
npm run dev # :8787, in-memory store, mock escrow, ephemeral verifier key


### Trust boundaries
- **Verifier** holds a key that signs `VerificationReport`s. It cannot move funds.
- **PolicySigner** is the only code that calls escrow `release` / `refundAndSlash`. It acts only when
  every policy check passes: valid signature, allowlisted verifier, report bound to this job's spec and
  submission, fresh, verdict consistent with checks, price under spend limit, job in `verified` state.
- Providers/agents can only: submit work. No model output reaches the policy or score code.
- Score is a pure function of settled outcomes (value-weighted, recency-decayed, shrunk toward a neutral prior).

### API
| | |
|---|---|
| `POST /jobs` `{spec, provider}` | authorize (spend limit, provider score); 201 created / 403 rejected |
| `POST /jobs/:id/submissions` | assigned provider submits payload + payloadHash |
| `POST /jobs/:id/verify` | verifier runs layer 1, returns signed report |
| `POST /jobs/:id/settle` | signer decides; 200 executed / 422 refused (with per-check reasons) |
| `GET /jobs`, `GET /jobs/:id` | job feed / detail with full audit trail |
| `GET /providers/leaderboard`, `GET /providers/:address` | scores |

### Reasoning and payment interfaces
- `ReasoningProvider` (`src/reasoning`): one method, `complete()`. Implementations: `OpenAICompatibleProvider`
  (SERV Reasoning is this with base URL `https://inference-api.openserv.ai/v1`), `MockReasoningProvider`,
  `FallbackReasoningProvider`. `completeJson(provider, req, zodSchema)` validates model output and retries once;
  its result is schema-valid, never trusted. Nothing in policy or scoring consumes model output.
- `PaymentRail` (`src/payments`): `requestPayment` -> buyer signs -> `acceptPayment` funds escrow; extends
  `EscrowClient`, so `release` / `refundAndSlash` stay reachable only through the PolicySigner. `X402StyleRail` is a
  demo (x402 semantics, not the real wire format or a facilitator). `ap2`, `mpp`, `stablecoin` are placeholders that
  throw `not_implemented`, and `getImplemented()` refuses to wire them.

### Layer 2: semantic audit (`verificationTier: "auditor"`)
`SemanticAuditor` asks a `ReasoningProvider` for `concerns` (index, minor/major, explanation) and a summary. Nothing
else from the model is used: `itemsAudited`, `flaggedItems`, `confidence` (= 1 - flagged/audited) and `passed`
(no major concern and confidence >= `AUDIT_MIN_CONFIDENCE`) are computed by code. Verdict = layer 1 AND layer 2.
- Layer 1 failed -> layer 2 is skipped (no model spend). Tier `schema` -> layer 2 is `null`.
- Model down or unusable output -> `AuditUnavailable`: HTTP 503, **no report, no slash**, job stays `submitted` for retry.
- Deliveries over `AUDIT_MAX_ITEMS` are sampled deterministically from the submission hash.
- Delivered content is untrusted: it goes only into delimited data blocks (random delimiter), never the system
  prompt, and a small pattern screen fails instruction-like payloads without calling the model. **This screen is a
  heuristic; a paraphrased injection can still suppress concerns.** The floor is still layer 1 plus deterministic
  policy, so a fooled auditor cannot move money by itself.
- Without `spec.inputs` the auditor can only judge plausibility and consistency, not accuracy against the source.
- The signer also refuses a `pass` that omits an audit the job asked for (`tier_satisfied`).

### Escrow contract (`contracts/`)
`AgentEscrow.sol` + `MockERC20.sol` (testnet mint, 6 decimals). Build: `npm run build:contracts` (solc-js, no network;
writes typed ABIs to `contracts/artifacts/`, which are committed).
- Provider: `stake`, `withdrawStake` (unlocked stake only). Buyer: `createJob(jobId, provider, price, stakeLocked, deadline)`.
  Provider: `submitResult(jobId, hash)`. Job ids are `keccak256(utf8(jobId))` (`jobKey` in `@atl/shared`).
- **Only the policy signer** can `release` (price to provider, stake unlocked) or `refundAndSlash` (price + slashed
  share of locked stake to the buyer, rest of stake back to provider). Owner can rotate the signer.
- `reclaimExpired`: if the provider never submits by the deadline, the buyer takes the price back; stake is unlocked, not slashed.
- OpenZeppelin 5.0.2 (`SafeERC20`, `ReentrancyGuard`). **Unaudited prototype.** Assumes a plain ERC-20 (no fee-on-transfer).
- Known limitation: after a result is submitted, funds wait on the policy signer. There is no on-chain timeout for
  that phase (a buyer-side one would let a buyer grief a provider after delivery).
- Slashed stake goes to the buyer as compensation. Change `refundAndSlash` if you prefer a treasury or burn.

### Chain client and deploy
- `ViemEscrowClient` (signer key only): simulate -> send -> await receipt; reverts throw with the contract's error name.
  `assertReady()` runs at startup and refuses to boot if there is no contract or the key is not the contract's `policySigner`.
- Before any release/slash the signer reads the job on-chain and requires `onchain_matches`: status `Submitted`,
  `resultHash` equal to the verified submission hash, and provider, buyer, price and locked stake matching the spec.
  This closes the "commit hash A on-chain, show the verifier payload B" swap.
- `EscrowParticipant`: wallet actions for buyer/provider (approve, stake, createJob, submitResult, reclaimExpired).
- Deploy: `DEPLOYER_PRIVATE_KEY=.. SIGNER_PRIVATE_KEY=.. CHAIN_NAME=base-sepolia CHAIN_RPC_URL=.. npm run deploy -w backend`.
- Set `ESCROW_ADDRESS` (+ `CHAIN_NAME`, `CHAIN_RPC_URL`, `SIGNER_PRIVATE_KEY`) and the backend uses the chain instead of `MockEscrow`.
- Chain tests run on a local anvil (`ANVIL_BIN=/path/to/anvil` or `anvil` on PATH). They have NOT been run on a public testnet.

### Persistence (Supabase)
The hosted deployment above is running against real Supabase persistence. Without `SUPABASE_URL` and
`SUPABASE_SECRET_KEY` set locally, the backend keeps everything in memory instead.

To make it durable:
1. Create a project at supabase.com.
2. Open its SQL Editor, paste in `supabase/migrations/0001_init.sql`, and run it. This creates the five tables
   the backend expects (`jobs`, `submissions`, `verification_reports`, `reputation_events`, `audit_log`).
3. From Project Settings -> API, copy the **Project URL** and the **secret** key (older Supabase accounts call
   this the *service_role* key, same thing). Set both in `.env`. Never use the publishable/anon key here: it
   only has read access under row-level security, and every backend write would fail.
4. Restart the backend. It logs which store it's using on startup, and the dashboard's header chip reads
   "Persistent" instead of "In-memory" once it's connected.

Setting only one of the two variables is treated as a misconfiguration and the backend refuses to start, rather
than silently falling back to memory.

### Demo
`npm run wallets -w backend` prints three throwaway wallets (buyer, honest provider, faulty provider). Paste the keys into `.env`
and fund each with a little Base Sepolia ETH. With the backend running (`npm run dev`), in a second terminal:

npm run demo -w backend # scenarios a b c
npm run demo -w backend -- a d e # pick scenarios

a honest, schema tier: pass, released | b faulty: layer 1 fails, refund + slash | c over the spend limit: rejected before funding |
d honest, auditor tier: audited by the reasoning provider in `.env` | e plausible fake: passes schema, contradicts inputs, audit should fail it.
The script mints mock tokens and stakes for the providers automatically. b and e share a provider: after one slash its score is
under the floor, so the other is blocked until the backend restarts (scores are in memory). Scenarios d/e depend on the model.

### Dashboard (`app/`)
Vite + React (not Next.js: Next's compiler binary needs macOS 13+). Reads the backend's public endpoints and polls every few seconds.

npm run dashboard # http://localhost:5173 (backend on :8787; override with VITE_BACKEND_URL in app/.env)
npm run build # production build in app/dist

Home: totals, job feed, provider reputation with the score floor marked. Job page: where the money went (buyer, escrow, provider),
the audit trail, the verifier report (deterministic checks, semantic audit with concerns and confidence), terms and hashes, and
explorer links once a real chain is configured. Dark theme, bold metric cards, lucide-react icons, and small motion (count-up
numbers, staggered entrance, an animated dashed line on the money-flow lane that just fired) via `prefers-reduced-motion`-aware CSS.
Deployed on Vercel (Root Directory `app`, env `VITE_BACKEND_URL` pointing at the hosted backend). The backend must be reachable
from the browser (`DASHBOARD_ORIGIN` restricts CORS).

### Agents (`agents/`)
- **Provider agent**: polls for jobs assigned to its wallet, checks the job is really funded on-chain with matching terms, has the model
  extract the 20 invoices (SERV via the `ReasoningProvider`), commits the result hash on-chain, then delivers the payload.
  The model part (`InvoiceExtractor`) only turns text into text: it holds no keys. The wallet part is plain code using the provider's own key,
  which can move only that provider's own stake. Faulty mode (`--fault broken|fake`) sabotages the extracted result in code.
- **Buyer agent**: asks the policy layer first, funds the escrow only if authorized, then waits for the outcome. Price, stake and tier come
  from code, not a model.

npm run demo -w agents # buyer + honest + faulty agents vs the running backend
npm run demo -w agents -- --fault fake # faulty agent submits plausible-but-wrong values; the AI audit must catch them
npm run provider -w agents -- --role honest # run one provider agent until Ctrl-C

The demo works with `AUTO_PIPELINE` true or false. It needs `REASONING_PROVIDER=serv` (or any real model): the extraction is the point.

### Not built yet
A buyer agent that plans jobs with a model, PromptGuard (no known API switch), a funding step in the job state machine
(rails can issue/accept payments but no endpoint calls them; buyers fund on-chain directly for now), API auth,
contract verification on Basescan, and the demo agents running against the public hosted deployment.
