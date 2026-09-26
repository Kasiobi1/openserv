import { ShieldCheck, ShieldX } from "lucide-react";
import type { Report } from "../api";
import { ago, short } from "../format";
import { CheckList } from "./CheckList";

export function ReportPanel({ report }: { report: Report }) {
  const b = report.body;
  const l2 = b.layer2;
  return (
    <section className="panel" aria-labelledby="report-h">
      <h2 id="report-h">Verifier report</h2>
      <p className={`verdict verdict-${b.verdict}`}>{b.verdict === "pass" ? <ShieldCheck size={22} style={{ verticalAlign: "-4px", marginRight: 6 }} /> : <ShieldX size={22} style={{ verticalAlign: "-4px", marginRight: 6 }} />}{b.verdict === "pass" ? "Passed" : "Failed"}</p>
      <p className="muted small">
        Signed by <span className="mono" title={b.verifier}>{short(b.verifier)}</span>, {ago(b.issuedAt)}. Report hash <span className="mono" title={report.hash}>{short(report.hash, 8, 6)}</span>
      </p>

      <h3>Deterministic checks</h3>
      <CheckList checks={b.layer1.checks} />

      <h3>Semantic audit</h3>
      {l2 === null && <p className="muted">Not requested for this verification tier.</p>}
      {l2?.status === "skipped" && <p className="muted">Skipped because the deterministic checks already failed.</p>}
      {l2?.status === "completed" && (
        <div>
          <p className={l2.passed ? "ok-text" : "no-text"}>{l2.passed ? "Audit passed" : "Audit failed"}</p>
          <div className="meter" role="img" aria-label={`Confidence ${Math.round(l2.confidence * 100)} percent`}>
            <div className="meter-fill" style={{ width: `${Math.round(l2.confidence * 100)}%` }} />
          </div>
          <p className="muted small">
            Confidence {l2.confidence.toFixed(2)}: {l2.flaggedItems} of {l2.itemsAudited} audited items flagged ({l2.itemsTotal} delivered). Model <span className="mono">{l2.model}</span>.
          </p>
          {l2.summary && <p className="quote">{l2.summary}</p>}
          {l2.concerns.length > 0 && (
            <ul className="concerns">
              {l2.concerns.map((c, i) => (
                <li key={i}>
                  <span className={`sev sev-${c.severity}`}>{c.severity}</span>
                  <span className="muted small">{c.itemIndex === null ? "whole delivery" : `item ${c.itemIndex}`}</span>
                  <span>{c.explanation}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="muted small">The model only lists concerns. The counts, confidence and pass/fail are computed by code.</p>
        </div>
      )}
    </section>
  );
}
