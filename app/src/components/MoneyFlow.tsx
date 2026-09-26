import { ArrowLeftRight, User, Warehouse } from "lucide-react";
import type { Job, PublicConfig } from "../api";
import { CountUp } from "./CountUp";
import { fmtAmount, short, STATUS } from "../format";

/** Where the money physically is, and where it ended up. */
export function MoneyFlow({ job, cfg }: { job: Job; cfg: PublicConfig }) {
  const d = cfg.tokenDecimals;
  const sym = cfg.tokenSymbol;
  const price = BigInt(job.spec.maxPrice);
  const stake = BigInt(job.spec.stakeRequired);
  const slash = (stake * BigInt(cfg.policy.slashBps)) / 10_000n;
  const money = (v: bigint) => `${fmtAmount(v, d)} ${sym}`;

  const released = job.status === "released";
  const slashed = job.status === "slashed";
  const rejected = job.status === "rejected";

  const buyerDelta = released ? -price : slashed ? slash : rejected ? null : -price;
  const providerDelta = released ? price : slashed ? -slash : null;

  const escrowLine = rejected ? "Never funded" : released || slashed ? "Settled, escrow is empty" : `Holding ${money(price)}`;

  return (
    <section className="flow" aria-label="Where the money went">
      <div className="node rise rise-1">
        <div className="node-role">Buyer</div>
        <div className="node-addr mono" title={job.spec.buyer}>{short(job.spec.buyer)}</div>
        {buyerDelta !== null && <Delta v={buyerDelta} money={money} tone={slashed ? "good" : "neutral"} note={slashed ? "refund + slashed stake" : released ? "paid for delivered work" : "in escrow"} />}
      </div>

      <Lane dir="left" lit={slashed} tone="bad" label={slashed ? `Refund ${money(price)}` : ""} sub={slashed && slash > 0n ? `+ ${money(slash)} slashed stake` : ""} />

      <div className={`node node-escrow rise rise-3 ${!released && !slashed && !rejected ? "node-live" : ""}`}>
        <div className="node-role"><Warehouse size={13} style={{ verticalAlign: "-2px", marginRight: 5 }} />Escrow</div>
        <div className="node-addr">{escrowLine}</div>
        <div className="node-sub">{STATUS[job.status].hint}</div>
      </div>

      <Lane dir="right" lit={released} tone="good" label={released ? `Release ${money(price)}` : ""} sub={released && stake > 0n ? `stake ${money(stake)} unlocked` : ""} />

      <div className="node rise rise-5">
        <div className="node-role"><User size={13} style={{ verticalAlign: "-2px", marginRight: 5 }} />Provider</div>
        <div className="node-addr mono" title={job.provider}>{short(job.provider)}</div>
        {providerDelta !== null ? (
          <Delta v={providerDelta} money={money} tone={slashed ? "bad" : "good"} note={slashed ? "of locked stake" : "payment"} />
        ) : !rejected && stake > 0n ? (
          <div className="node-sub">{money(stake)} stake locked</div>
        ) : null}
      </div>
    </section>
  );
}

function Delta({ v, money, note, tone }: { v: bigint; money: (v: bigint) => string; note: string; tone: "good" | "bad" | "neutral" }) {
  const up = v > 0n;
  return (
    <div className={`delta delta-${tone}`}>
      <span className="delta-num">{up ? "+" : ""}{money(v)}</span>
      <span className="delta-note">{note}</span>
    </div>
  );
}

function Lane({ dir, lit, tone, label, sub }: { dir: "left" | "right"; lit: boolean; tone: "good" | "bad"; label: string; sub: string }) {
  return (
    <div className={`lane lane-${dir} rise rise-${dir === "left" ? 2 : 4} ${lit ? `lane-lit lane-${tone}` : ""}`} aria-hidden={!lit}>
      <div className="lane-label">{label || <ArrowLeftRight size={13} style={{ opacity: 0.35 }} />}</div>
      <div className="lane-line" />
      <div className="lane-sub">{sub}</div>
    </div>
  );
}
