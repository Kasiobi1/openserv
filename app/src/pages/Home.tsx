import { Link } from "react-router-dom";
import { api, usePoll, type Job, type ProviderRow, type PublicConfig } from "../api";
import { useAnimatedNumber, useJustChanged } from "../hooks";
import { StatusPill } from "../components/StatusPill";
import { ago, fmtAmount, short, TIER } from "../format";

export function Home() {
  const cfg = usePoll(api.config, [], 30_000).data;
  const jobs = usePoll(api.jobs, [], 3000);
  const board = usePoll(api.leaderboard, [], 3000);

  if (jobs.error && !jobs.data) return <p className="empty" role="alert">{jobs.error}</p>;
  if (!jobs.data) return <p className="muted">Loading jobs…</p>;

  const list = [...jobs.data].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const count = (s: Job["status"]) => list.filter((j) => j.status === s).length;
  const inFlight = list.filter((j) => ["created", "submitted", "verified"].includes(j.status)).length;
  const released = count("released");
  const slashed = count("slashed");
  const rejected = count("rejected");
  const needsAttention = slashed + rejected;

  return (
    <>
      <section className="ledger" aria-label="Totals">
        <Stat n={list.length} label="jobs" />
        <Stat n={released} label="released" tone="hero" />
        <Stat n={slashed} label="slashed" />
        <Stat n={rejected} label="rejected by policy" tone={needsAttention > 0 ? "caution" : undefined} />
        <Stat n={inFlight} label="in progress" />
      </section>

      <div className="cols">
        <section aria-labelledby="feed-h">
          <h2 id="feed-h">Jobs</h2>
          {list.length === 0 ? (
            <p className="empty">No jobs yet. With the backend running, start the agents: <span className="mono">npm run demo -w agents</span></p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Job</th>
                    <th>Provider</th>
                    <th className="num">Price{cfg ? ` (${cfg.tokenSymbol})` : ""}</th>
                    <th>Verification</th>
                    <th>Status</th>
                    <th className="num">Age</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((j) => <JobRow key={j.id} job={j} cfg={cfg} />)}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <Leaderboard rows={board.data ?? []} cfg={cfg} />
      </div>
    </>
  );
}

function JobRow({ job, cfg }: { job: Job; cfg: PublicConfig | null }) {
  const flash = useJustChanged(job.status);
  return (
    <tr className={flash ? "row-flash" : ""}>
      <td><Link className="link mono" to={`/dashboard/jobs/${encodeURIComponent(job.id)}`}>{short(job.id, 14, 4)}</Link></td>
      <td className="mono" title={job.provider}>{short(job.provider)}</td>
      <td className="num">{cfg ? fmtAmount(job.spec.maxPrice, cfg.tokenDecimals) : job.spec.maxPrice}</td>
      <td>{TIER[job.spec.verificationTier]}</td>
      <td><StatusPill status={job.status} /></td>
      <td className="num muted">{ago(job.createdAt)}</td>
    </tr>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone?: "hero" | "caution" }) {
  const shown = useAnimatedNumber(n);
  const flash = useJustChanged(n);
  return (
    <div className={`stat ${tone ? `stat-${tone}` : ""} ${flash && !tone ? "stat-flash" : ""}`}>
      <span className="stat-n">{shown}</span>
      <span className="stat-l">{label}</span>
    </div>
  );
}

function Leaderboard({ rows, cfg }: { rows: ProviderRow[]; cfg: PublicConfig | null }) {
  const floor = cfg?.policy.minProviderScore ?? 0;
  return (
    <section aria-labelledby="board-h">
      <h2 id="board-h">Provider reputation</h2>
      {rows.length === 0 ? (
        <p className="empty">Scores appear once a job settles.</p>
      ) : (
        <ol className="board">
          {rows.map((r) => <BoardRow key={r.provider} row={r} floor={floor} explorerBase={cfg?.explorerAddressBase ?? null} />)}
        </ol>
      )}
      <p className="muted small">Scores run 0 to 1000. New providers start at 500. Larger and more recent jobs count for more.</p>
    </section>
  );
}

function BoardRow({ row, floor, explorerBase }: { row: ProviderRow; floor: number; explorerBase: string | null }) {
  const score = useAnimatedNumber(row.score);
  const blocked = row.score < floor;
  const addr = explorerBase ? `${explorerBase}${row.provider}` : null;
  return (
    <li>
      <div className="board-top">
        {addr ? <a className="mono link" href={addr} target="_blank" rel="noreferrer" title={row.provider}>{short(row.provider)}</a> : <span className="mono" title={row.provider}>{short(row.provider)}</span>}
        <span className="board-score">{score}</span>
      </div>
      <div className="score-bar" role="img" aria-label={`Score ${row.score} out of 1000`}>
        <div className={`score-fill ${blocked ? "score-bad" : ""}`} style={{ width: `${row.score / 10}%` }} />
        {floor > 0 && <div className="score-floor" style={{ left: `${floor / 10}%` }} title={`Minimum score ${floor}`} />}
      </div>
      <p className="muted small">
        {row.jobs} settled {row.jobs === 1 ? "job" : "jobs"}
        {blocked && <span className="no-text"> · Below the {floor} floor, blocked from new jobs</span>}
      </p>
    </li>
  );
}
