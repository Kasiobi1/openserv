import { Link, useParams } from "react-router-dom";
import { api, usePoll } from "../api";
import { MoneyFlow } from "../components/MoneyFlow";
import { ReportPanel } from "../components/ReportPanel";
import { StatusPill } from "../components/StatusPill";
import { Timeline } from "../components/Timeline";
import { fmtAmount, short, TIER } from "../format";

export function JobPage() {
  const { id = "" } = useParams();
  const cfg = usePoll(api.config, [], 30_000).data;
  const d = usePoll(() => api.job(id), [id], 2500);

  if (d.error && !d.data) {
    return (
      <>
        <p><Link to="/dashboard" className="link">All jobs</Link></p>
        <p className="empty" role="alert">{d.error}</p>
      </>
    );
  }
  if (!d.data || !cfg) return (
    <>
      <div className="skel rise" style={{ height: 122, marginBottom: "2rem" }} />
      <div className="cols cols-job">
        <div className="skel rise" style={{ height: 260 }} />
        <div className="skel rise" style={{ height: 260 }} />
      </div>
    </>
  );

  const { job, report, audit, submission, specHash } = d.data;
  const money = (v: string) => `${fmtAmount(v, cfg.tokenDecimals)} ${cfg.tokenSymbol}`;

  return (
    <>
      <p className="crumb"><Link to="/dashboard" className="link">All jobs</Link></p>
      <div className="job-head">
        <h1 className="mono" title={job.id}>{job.id}</h1>
        <StatusPill status={job.status} />
      </div>

      <MoneyFlow job={job} cfg={cfg} />

      <div className="cols cols-job">
        <section aria-labelledby="trail-h">
          <h2 id="trail-h">Audit trail</h2>
          <Timeline entries={audit} cfg={cfg} />
        </section>

        <div className="stack">
          {report ? (
            <ReportPanel report={report} />
          ) : (
            <section className="panel">
              <h2>Verifier report</h2>
              <p className="muted">{job.status === "rejected" ? "This job never reached verification." : "No report yet. It appears once the result is delivered and checked."}</p>
            </section>
          )}

          <section className="panel" aria-labelledby="terms-h">
            <h2 id="terms-h">Terms</h2>
            <p className="task">{job.spec.task}</p>
            <dl className="terms">
              <dt>Price</dt><dd>{money(job.spec.maxPrice)}</dd>
              <dt>Provider stake</dt><dd>{money(job.spec.stakeRequired)}</dd>
              <dt>Slash if failed</dt><dd>{cfg.policy.slashBps / 100}% of stake</dd>
              <dt>Verification</dt><dd>{TIER[job.spec.verificationTier]}</dd>
              <dt>Buyer</dt><dd className="mono" title={job.spec.buyer}>{short(job.spec.buyer, 8, 6)}</dd>
              <dt>Provider</dt><dd className="mono" title={job.provider}>{short(job.provider, 8, 6)}</dd>
              <dt>Spec hash</dt><dd className="mono" title={specHash}>{short(specHash, 8, 6)}</dd>
              {submission && (<><dt>Result hash</dt><dd className="mono" title={submission.payloadHash}>{short(submission.payloadHash, 8, 6)}</dd></>)}
              {job.settlement && cfg.explorerTxBase && (
                <>
                  <dt>Settlement</dt>
                  <dd><a className="mono link" href={`${cfg.explorerTxBase}${job.settlement.txHash}`} target="_blank" rel="noreferrer">{short(job.settlement.txHash, 8, 6)}</a></dd>
                </>
              )}
            </dl>
          </section>
        </div>
      </div>
    </>
  );
}
