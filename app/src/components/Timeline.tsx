import type { ReactNode } from "react";
import type { AuditEntry, PublicConfig } from "../api";
import { ago, short } from "../format";
import { CheckList } from "./CheckList";

type Tone = "good" | "bad" | "warn" | "info";

function describe(e: AuditEntry, cfg: PublicConfig | null): { title: string; tone: Tone; body?: ReactNode } {
  const d = e.data ?? {};
  const dec = cfg?.tokenDecimals;
  const txLink = (hash: string) =>
    cfg?.explorerTxBase ? (
      <a className="mono link" href={`${cfg.explorerTxBase}${hash}`} target="_blank" rel="noreferrer">View transaction {short(hash, 8, 6)}</a>
    ) : (
      <span className="mono">tx {short(hash, 8, 6)}</span>
    );

  switch (e.kind) {
    case "job_created":
      return { title: "Job authorized by policy", tone: "info", body: <CheckList checks={d.checks ?? []} decimals={dec} /> };
    case "job_rejected":
      return { title: "Job rejected by policy", tone: "warn", body: <CheckList checks={d.checks ?? []} onlyFailed decimals={dec} /> };
    case "submission_received":
      return { title: "Result delivered", tone: "info", body: <p className="small muted">Payload hash <span className="mono" title={d.payloadHash}>{short(d.payloadHash ?? "", 8, 6)}</span></p> };
    case "verification_report":
      return {
        title: `Verifier ${d.verdict === "pass" ? "passed the delivery" : "failed the delivery"}`,
        tone: d.verdict === "pass" ? "good" : "bad",
        body: <CheckList checks={d.checks ?? []} onlyFailed decimals={dec} />,
      };
    case "settlement_approved":
      return {
        title: d.action === "release" ? "Payment released to the provider" : "Buyer refunded and provider slashed",
        tone: d.action === "release" ? "good" : "bad",
        body: (
          <>
            {d.txHash && <p className="small">{txLink(d.txHash)}</p>}
            <details className="more">
              <summary>Signer checks ({(d.checks ?? []).length})</summary>
              <CheckList checks={d.checks ?? []} decimals={dec} />
            </details>
          </>
        ),
      };
    case "settlement_rejected":
      return { title: "Signer refused to settle", tone: "warn", body: <CheckList checks={d.checks ?? []} onlyFailed decimals={dec} /> };
    case "pipeline_error":
      return {
        title: `Automatic ${d.step} step hit a problem${d.willRetry ? ", retrying" : ""}`,
        tone: "warn",
        body: <p className="small muted">{d.message}</p>,
      };
    default:
      return { title: e.kind, tone: "info" };
  }
}

export function Timeline({ entries, cfg }: { entries: AuditEntry[]; cfg: PublicConfig | null }) {
  if (entries.length === 0) return <p className="muted">Nothing has happened on this job yet.</p>;
  return (
    <ol className="timeline">
      {entries.map((e, i) => {
        const x = describe(e, cfg);
        return (
          <li key={i} className={`tl tl-${x.tone} rise rise-${Math.min(i + 1, 5)}`}>
            <div className="tl-head">
              <span className="tl-title">{x.title}</span>
              <time className="muted small" dateTime={e.at} title={new Date(e.at).toLocaleString()}>{ago(e.at)}</time>
            </div>
            {x.body}
          </li>
        );
      })}
    </ol>
  );
}
