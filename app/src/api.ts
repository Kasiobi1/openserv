import { useEffect, useState } from "react";

export const BACKEND = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.replace(/\/+$/, "") ?? "http://localhost:8787";

export type JobStatus = "created" | "submitted" | "verified" | "released" | "slashed" | "rejected";

export interface PublicConfig {
  chain: string;
  explorerTxBase: string | null;
  explorerAddressBase: string | null;
  escrowAddress: string | null;
  tokenAddress: string | null;
  tokenSymbol: string;
  tokenDecimals: number;
  verifier: string;
  reasoning: string;
  autoPipeline: boolean;
  persistent: boolean;
  policy: { maxSpendPerJob: string; minProviderScore: number; slashBps: number };
}

export interface JobSpec {
  id: string;
  buyer: string;
  task: string;
  maxPrice: string;
  stakeRequired: string;
  verificationTier: "schema" | "auditor";
  completeness?: { expectedItemCount: number };
}

export interface Job {
  id: string;
  spec: JobSpec;
  provider: string;
  status: JobStatus;
  createdAt: string;
  settlement?: { action: "release" | "refund_and_slash"; txHash: string; at: string };
}

export interface Check { name: string; passed: boolean; detail: string }
export interface Concern { itemIndex: number | null; severity: "minor" | "major"; explanation: string }
export interface Layer2Completed {
  status: "completed";
  passed: boolean;
  provider: string;
  model: string;
  itemsTotal: number;
  itemsAudited: number;
  flaggedItems: number;
  confidence: number;
  concerns: Concern[];
  summary: string;
}
export type Layer2 = { status: "skipped"; reason: string } | Layer2Completed | null;

export interface Report {
  body: {
    jobId: string;
    verifier: string;
    issuedAt: string;
    layer1: { passed: boolean; checks: Check[] };
    layer2: Layer2;
    verdict: "pass" | "fail";
  };
  hash: string;
  signature: string;
}

export interface AuditEntry {
  jobId: string;
  at: string;
  kind: "job_created" | "job_rejected" | "submission_received" | "verification_report" | "settlement_approved" | "settlement_rejected" | "pipeline_error";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
}

export interface JobDetail {
  job: Job;
  specHash: string;
  submission: { payloadHash: string; provider: string } | null;
  report: Report | null;
  audit: AuditEntry[];
}

export interface ProviderRow { provider: string; score: number; confidence: number; jobs: number }

async function get<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BACKEND}${path}`);
  } catch {
    throw new Error(`Can't reach the backend at ${BACKEND}. Start it with npm run dev.`);
  }
  if (!res.ok) throw new Error(res.status === 404 ? "Not found." : `Backend returned ${res.status}.`);
  return res.json() as Promise<T>;
}

export const api = {
  config: () => get<PublicConfig>("/config"),
  jobs: () => get<Job[]>("/jobs"),
  job: (id: string) => get<JobDetail>(`/jobs/${encodeURIComponent(id)}`),
  leaderboard: () => get<ProviderRow[]>("/providers/leaderboard"),
};

export interface Polled<T> { data: T | null; error: string | null; at: number | null }

/** Loads once, then every `ms` milliseconds. Keeps the last good data while a refresh fails. */
export function usePoll<T>(load: () => Promise<T>, deps: unknown[], ms = 3000): Polled<T> {
  const [state, setState] = useState<Polled<T>>({ data: null, error: null, at: null });
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      try {
        const data = await load();
        if (alive) setState({ data, error: null, at: Date.now() });
      } catch (e) {
        if (alive) setState((s) => ({ ...s, error: (e as Error).message }));
      }
      if (alive) timer = setTimeout(run, ms);
    };
    void run();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}
