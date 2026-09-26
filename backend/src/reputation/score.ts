import type { ReputationEvent } from "@atl/shared";

export interface ScoreConfig {
  tokenDecimals: number;
  /** Older outcomes count for half as much every `halfLifeDays`. */
  halfLifeDays: number;
  /** Pseudo-weight of a neutral prior; shrinks new providers toward `priorScore`. */
  priorWeight: number;
  priorRate: number;
}

export const DEFAULT_SCORE_CONFIG: ScoreConfig = {
  tokenDecimals: 6,
  halfLifeDays: 30,
  priorWeight: 2,
  priorRate: 0.5,
};

export interface Score {
  /** 0..1000 integer. New providers start at 500. */
  score: number;
  /** 0..1, how much evidence backs the score. */
  confidence: number;
  jobs: number;
}

/**
 * Pure and deterministic: same events + same `now` => same score. No model output touches this.
 * weight = valueWeight * recencyWeight, where valueWeight = log2(1 + whole tokens) so a single
 * large job matters more than a small one without letting it dominate.
 */
export function computeScore(events: ReputationEvent[], now: Date, cfg: ScoreConfig = DEFAULT_SCORE_CONFIG): Score {
  let wTotal = 0;
  let wPass = 0;
  for (const e of events) {
    const tokens = Number(e.amount) / 10 ** cfg.tokenDecimals;
    const valueWeight = Math.log2(1 + tokens);
    const ageDays = Math.max(0, (now.getTime() - new Date(e.occurredAt).getTime()) / 86_400_000);
    const recency = 0.5 ** (ageDays / cfg.halfLifeDays);
    const w = valueWeight * recency;
    wTotal += w;
    if (e.outcome === "pass") wPass += w;
  }
  const rate = (wPass + cfg.priorWeight * cfg.priorRate) / (wTotal + cfg.priorWeight);
  return {
    score: Math.round(rate * 1000),
    confidence: Number((wTotal / (wTotal + cfg.priorWeight)).toFixed(4)),
    jobs: events.length,
  };
}
