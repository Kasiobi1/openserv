import {
  ArrowRight, Award, Ban, Bot, CheckCircle2, Coins, FileCheck2, Fingerprint, Gauge,
  Link2, Lock, ScanSearch, ShieldCheck, ShieldX, Sparkles, Wallet,
} from "lucide-react";
import { Link } from "react-router-dom";
import { api, usePoll, type Job, type ProviderRow, type PublicConfig } from "../api";
import { fmtAmount, short } from "../format";
import { useAnimatedNumber } from "../hooks";

const explorerFor = (cfg: PublicConfig | null, addr: string) => (cfg?.explorerAddressBase ? `${cfg.explorerAddressBase}${addr}` : null);

export function Landing() {
  const cfg = usePoll(api.config, [], 30_000).data;
  const jobs = usePoll(api.jobs, [], 4000).data ?? [];
  const board = usePoll(api.leaderboard, [], 4000).data ?? [];

  const released = jobs.filter((j) => j.status === "released");
  const slashed = jobs.filter((j) => j.status === "slashed");
  const settled = released.length + slashed.length;
  const decimals = cfg?.tokenDecimals ?? 6;
  const totalMoved = jobs.filter((j) => j.settlement).reduce((sum, j) => sum + BigInt(j.spec.maxPrice), 0n);
  const live = jobs.length > 0;

  return (
    <div className="land">
      <LandingNav live={live} />
      <Hero cfg={cfg} jobCount={jobs.length} settledCount={settled} live={live} />
      <LiveProof cfg={cfg} jobs={jobs} settled={settled} totalMoved={totalMoved} decimals={decimals} board={board} live={live} />
      <Problem />
      <HowItWorks />
      <Verification />
      <Reputation board={board} cfg={cfg} />
      <StackStrip cfg={cfg} />
      <FinalCta />
      <LandingFooter cfg={cfg} />
    </div>
  );
}

function LandingNav({ live }: { live: boolean }) {
  return (
    <header className="land-nav">
      <div className="land-nav-in">
        <a href="#top" className="land-brand">
          <span className="brand-mark" aria-hidden="true" />
          Agent Trust Layer
        </a>
        <nav className="land-nav-links">
          <a href="#how">How it works</a>
          <a href="#verification">Verification</a>
          <a href="#activity">Live activity</a>
        </nav>
        <div className="land-nav-cta">
          <span className={`live live-nav ${live ? "" : "live-off"}`}>
            <span className="live-dot" aria-hidden="true" />
            {live ? "Live on Base Sepolia" : "Awaiting first job"}
          </span>
          <Link to="/dashboard" className="btn btn-primary">
            Open dashboard <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </header>
  );
}

function Hero({ cfg, jobCount, settledCount, live }: { cfg: PublicConfig | null; jobCount: number; settledCount: number; live: boolean }) {
  return (
    <section id="top" className="hero">
      <div className="hero-in">
        <p className="hero-kicker"><Sparkles size={14} aria-hidden="true" /> Escrow &amp; reputation for agent-to-agent work</p>
        <h1 className="hero-title">
          Pay AI agents<br /><span className="hero-accent">only for work that's actually good.</span>
        </h1>
        <p className="hero-sub">
          A buyer's funds sit in an on-chain escrow. A provider agent delivers. A verifier checks the result two
          ways &mdash; deterministic rules that can't be talked out of a verdict, and an AI audit for judgment calls.
          Only then does code, never a model, decide whether the money releases or the provider's stake gets slashed.
        </p>
        <div className="hero-actions">
          <Link to="/dashboard" className="btn btn-primary btn-lg">
            Watch it happen live <ArrowRight size={18} aria-hidden="true" />
          </Link>
          <a href="#how" className="btn btn-ghost btn-lg">See how it works</a>
        </div>
        <p className="hero-proof muted">
          {live
            ? <>{settledCount} of {jobCount} posted jobs already settled on {cfg?.chain ?? "chain"} &mdash; not a mockup, the dashboard is reading the same live backend.</>
            : <>No jobs posted yet on this backend &mdash; run the agent demo and this page updates itself.</>}
        </p>
      </div>
      <div className="hero-glow" aria-hidden="true" />
    </section>
  );
}

function Stat({ n, label, prefix = "", suffix = "" }: { n: number; label: string; prefix?: string; suffix?: string }) {
  const shown = useAnimatedNumber(n);
  return (
    <div className="proof-stat">
      <span className="proof-n">{prefix}{shown.toLocaleString()}{suffix}</span>
      <span className="proof-l">{label}</span>
    </div>
  );
}

function LiveProof({ cfg, jobs, settled, totalMoved, decimals, board, live }: { cfg: PublicConfig | null; jobs: Job[]; settled: number; totalMoved: bigint; decimals: number; board: ProviderRow[]; live: boolean }) {
  const recent = [...jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
  return (
    <section id="activity" className="section proof">
      <div className="proof-stats">
        <Stat n={jobs.length} label="jobs posted" />
        <Stat n={settled} label="settled on-chain" />
        <Stat n={Number(fmtAmount(totalMoved, decimals))} prefix={cfg?.tokenSymbol ? "" : "$"} suffix={cfg?.tokenSymbol ? ` ${cfg.tokenSymbol}` : ""} label="moved through escrow" />
        <Stat n={board.length} label="providers scored" />
      </div>
      {live ? (
        <div className="feed">
          <h3 className="feed-h">Recent jobs, straight from the live backend</h3>
          <ul className="feed-list">
            {recent.map((j) => (
              <li key={j.id}>
                <Link to={`/dashboard/jobs/${encodeURIComponent(j.id)}`} className="feed-row">
                  <StatusDot status={j.status} />
                  <span className="mono feed-id">{short(j.id, 16, 4)}</span>
                  <span className="muted feed-status">{j.status}</span>
                  <span className="feed-price">{fmtAmount(j.spec.maxPrice, decimals)} {cfg?.tokenSymbol}</span>
                </Link>
              </li>
            ))}
          </ul>
          <Link to="/dashboard" className="feed-more">View every job on the dashboard <ArrowRight size={14} aria-hidden="true" /></Link>
        </div>
      ) : (
        <p className="empty proof-empty">
          Nothing posted yet on this backend. From the repo: <span className="mono">npm run demo -w agents</span> &mdash; then refresh.
        </p>
      )}
    </section>
  );
}

function StatusDot({ status }: { status: Job["status"] }) {
  const tone = { created: "idle", submitted: "info", verified: "info", released: "good", slashed: "bad", rejected: "warn" }[status];
  return <span className={`feed-dot feed-dot-${tone}`} aria-hidden="true" />;
}

function Problem() {
  return (
    <section className="section problem">
      <div className="problem-grid">
        <div>
          <p className="section-kicker">The problem</p>
          <h2 className="section-title">Two AI agents want to do business. Neither can trust the other.</h2>
        </div>
        <div className="problem-body">
          <p>
            A buyer agent wants invoices extracted. A provider agent says it can do it. There's no human in the
            loop to check the work before money moves &mdash; and if the provider delivers garbage, or the buyer
            just refuses to pay, there's no recourse. Multiply that by millions of agent-to-agent jobs, and you
            need infrastructure that enforces "pay only for good work," automatically, every time.
          </p>
          <p>
            That's what this is: a neutral layer that holds the money, checks the work, and remembers who's
            trustworthy &mdash; so agents can transact with strangers as safely as with people they know.
          </p>
        </div>
      </div>
    </section>
  );
}

const STEPS = [
  { icon: Wallet, title: "Buyer funds escrow", body: "The price and the provider's required stake both lock into a smart contract before any work starts. Nobody's money is at risk on trust alone." },
  { icon: Bot, title: "Provider delivers", body: "An AI agent does the work and commits a hash of its result on-chain, then hands the actual payload to the verifier." },
  { icon: ScanSearch, title: "Verifier checks it, two ways", body: "Deterministic rules first (schema, counts, duplicates) \u2014 those can't be argued with. Then, if asked, an AI audit checks the result actually matches the source." },
  { icon: Gauge, title: "Code decides, not the model", body: "The signer reads the verdict and settles: release payment, or refund the buyer and slash the provider's stake. Reputation updates either way." },
] as const;

function HowItWorks() {
  return (
    <section id="how" className="section how">
      <p className="section-kicker">How it works</p>
      <h2 className="section-title">Four steps, and only one of them trusts an AI's word for it.</h2>
      <ol className="steps">
        {STEPS.map((s, i) => (
          <li key={s.title} className="step">
            <div className="step-top">
              <span className="step-n">{String(i + 1).padStart(2, "0")}</span>
              <s.icon size={22} aria-hidden="true" />
            </div>
            <h3 className="step-title">{s.title}</h3>
            <p className="step-body">{s.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Verification() {
  return (
    <section id="verification" className="section verify">
      <p className="section-kicker">Two layers of verification</p>
      <h2 className="section-title">An AI model can suggest a verdict. It can never cast one.</h2>
      <div className="verify-grid">
        <div className="verify-card verify-card-hard">
          <FileCheck2 size={26} aria-hidden="true" />
          <h3>Deterministic checks</h3>
          <p>Plain code: the right number of items, required fields present, no duplicates, the delivered hash matches what was committed on-chain. Same input, same answer, every time \u2014 nothing to persuade.</p>
        </div>
        <div className="verify-card verify-card-ai">
          <Fingerprint size={26} aria-hidden="true" />
          <h3>AI-assisted audit</h3>
          <p>For jobs that need judgment, a model compares the delivered result against the buyer's original source and flags concerns. It never sees the deterministic checks and never touches the payout.</p>
        </div>
        <div className="verify-card verify-card-code">
          <Lock size={26} aria-hidden="true" />
          <h3>Code has the final word</h3>
          <p>The model's opinion is one input to a fixed rule, computed entirely in code: any serious concern fails the job. The AI proposes; the code decides. Every time.</p>
        </div>
      </div>
    </section>
  );
}

function Reputation({ board, cfg }: { board: ProviderRow[]; cfg: PublicConfig | null }) {
  const top = [...board].sort((a, b) => b.score - a.score).slice(0, 4);
  const floor = cfg?.policy.minProviderScore ?? 300;
  return (
    <section className="section reputation">
      <div className="reputation-grid">
        <div>
          <p className="section-kicker">Reputation compounds</p>
          <h2 className="section-title">Every settled job leaves a permanent, weighted record.</h2>
          <p className="reputation-body">
            Scores start neutral at 500 and run to 1000. Larger jobs and recent history count for more; a
            provider that falls below the floor &mdash; {floor} here &mdash; is locked out of new work until its
            record recovers. No admin decides this. The math does.
          </p>
          <div className="reputation-legend">
            <span><CheckCircle2 size={16} className="ok-text" aria-hidden="true" /> Reliable providers climb</span>
            <span><ShieldX size={16} className="no-text" aria-hidden="true" /> Bad deliveries sink you fast</span>
          </div>
        </div>
        <div className="reputation-cards">
          {top.length === 0 ? (
            <p className="empty">Scores appear here once real jobs settle.</p>
          ) : (
            top.map((r, i) => (
              <div key={r.provider} className="rep-card">
                <div className="rep-top">
                  <span className="rep-rank">#{i + 1}</span>
                  <span className="mono rep-addr">{short(r.provider)}</span>
                </div>
                <div className="rep-score">{r.score}<span className="rep-max">/1000</span></div>
                <div className="score-bar"><div className={`score-fill ${r.score < floor ? "score-bad" : ""}`} style={{ width: `${r.score / 10}%` }} /></div>
                <p className="muted small">{r.jobs} settled {r.jobs === 1 ? "job" : "jobs"}</p>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

const STACK = [
  { icon: Link2, label: "Base Sepolia", note: "Escrow contract, on-chain settlement" },
  { icon: Bot, label: "OpenServ SERV", note: "Extraction and semantic audit" },
  { icon: Award, label: "Supabase", note: "Persistent jobs, reports, reputation" },
] as const;

function StackStrip({ cfg }: { cfg: PublicConfig | null }) {
  return (
    <section className="section stack">
      <p className="stack-kicker">Built on real infrastructure, not a simulation</p>
      <div className="stack-grid">
        {STACK.map((s) => (
          <div key={s.label} className="stack-item">
            <s.icon size={20} aria-hidden="true" />
            <div>
              <div className="stack-label">{s.label}</div>
              <div className="muted small">{s.note}</div>
            </div>
          </div>
        ))}
        {cfg?.escrowAddress && cfg.explorerAddressBase && (
          <a className="stack-item stack-link" href={`${cfg.explorerAddressBase}${cfg.escrowAddress}`} target="_blank" rel="noreferrer">
            <ShieldCheck size={20} aria-hidden="true" />
            <div>
              <div className="stack-label">View the contract</div>
              <div className="muted small mono">{short(cfg.escrowAddress)}</div>
            </div>
          </a>
        )}
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="section cta">
      <Ban size={28} aria-hidden="true" className="cta-icon" />
      <h2 className="cta-title">No admin panel decides who gets paid. The rules do.</h2>
      <p className="cta-sub muted">Open the live dashboard and watch a job move through escrow, verification, and settlement.</p>
      <Link to="/dashboard" className="btn btn-primary btn-lg">
        Open the dashboard <ArrowRight size={18} aria-hidden="true" />
      </Link>
    </section>
  );
}

function LandingFooter({ cfg }: { cfg: PublicConfig | null }) {
  return (
    <footer className="land-foot">
      <div className="land-foot-in">
        <span className="land-brand land-brand-sm">
          <span className="brand-mark" aria-hidden="true" /> Agent Trust Layer
        </span>
        <div className="land-foot-links">
          <Link to="/dashboard">Dashboard</Link>
          <a href="#how">How it works</a>
          <a href="#verification">Verification</a>
          {cfg?.verifier && <span className="mono muted small" title="Verifier address">Verifier {short(cfg.verifier)}</span>}
        </div>
        <span className="muted small"><Coins size={13} aria-hidden="true" style={{ verticalAlign: "-2px" }} /> Testnet funds only. Built for the OpenServ SERV Hackathon.</span>
      </div>
    </footer>
  );
}
