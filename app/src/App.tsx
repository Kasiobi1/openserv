import { Activity } from "lucide-react";
import { Link, Route, Routes, useLocation } from "react-router-dom";
import { api, BACKEND, usePoll } from "./api";
import { ago, short } from "./format";
import { Landing } from "./pages/Landing";
import { Home } from "./pages/Home";
import { JobPage } from "./pages/JobPage";

function DashboardChrome() {
  const cfg = usePoll(api.config, [], 30_000);
  const c = cfg.data;
  const jobs = usePoll(api.jobs, [], 3000); // drives the "live" indicator; pages poll their own data
  return (
    <>
      <header className="topbar">
        <div className="topbar-in">
          <Link to="/dashboard" className="brand">
            <span className="brand-mark" aria-hidden="true" />
            Agent Trust Layer
          </Link>
          <div className="topbar-meta">
            {c && (
              <>
                <span className="chip">{c.chain === "mock" ? "Mock escrow (no chain)" : c.chain}</span>
                <span className={`chip ${c.persistent ? "" : "chip-warn"}`} title={c.persistent ? "Backed by Supabase" : "In-memory only: data is lost on restart"}>
                  {c.persistent ? "Persistent" : "In-memory"}
                </span>
                {c.escrowAddress && (
                  c.explorerAddressBase ? (
                    <a className="mono link" href={`${c.explorerAddressBase}${c.escrowAddress}`} target="_blank" rel="noreferrer" title="Escrow contract">
                      Escrow {short(c.escrowAddress)}
                    </a>
                  ) : (
                    <span className="mono" title="Escrow contract">Escrow {short(c.escrowAddress)}</span>
                  )
                )}
              </>
            )}
            <span className={`live ${jobs.error ? "live-off" : ""}`} role="status">
              <span className="live-dot" aria-hidden="true" />
              {jobs.error ? "Backend unreachable" : jobs.at ? `Live, updated ${ago(new Date(jobs.at).toISOString())}` : "Connecting"}
            </span>
          </div>
        </div>
      </header>
      <main className="page">
        <Routes>
          <Route path="/dashboard" element={<Home />} />
          <Route path="/dashboard/jobs/:id" element={<JobPage />} />
          <Route path="*" element={<p className="empty"><Activity size={16} style={{ verticalAlign: "-3px", marginRight: 6 }} />That page doesn't exist. <Link to="/dashboard" className="link">Back to all jobs</Link></p>} />
        </Routes>
      </main>
      <footer className="foot">
        Data from <span className="mono">{BACKEND}</span>. Reasoning output is treated as an untrusted proposal; only the policy signer moves money.
      </footer>
    </>
  );
}

export function App() {
  const { pathname } = useLocation();
  if (pathname === "/" || pathname === "") return <Landing />;
  return <DashboardChrome />;
}
