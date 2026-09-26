import { describe, expect, it } from "vitest";
import type { ReputationEvent } from "@atl/shared";
import { computeScore } from "../src/reputation/score";

const now = new Date("2026-09-19T00:00:00Z");
const ev = (outcome: "pass" | "fail", amount: string, daysAgo: number, i = 0): ReputationEvent => ({
  id: `e${i}`,
  provider: "0x00000000000000000000000000000000000000a1",
  jobId: `j${i}`,
  outcome,
  amount,
  reportHash: `0x${"0".repeat(64)}`,
  occurredAt: new Date(now.getTime() - daysAgo * 86_400_000).toISOString(),
});

describe("reputation score", () => {
  it("starts new providers at neutral with zero confidence", () => {
    expect(computeScore([], now)).toEqual({ score: 500, confidence: 0, jobs: 0 });
  });

  it("is deterministic", () => {
    const events = [ev("pass", "10000000", 3, 1), ev("fail", "5000000", 10, 2)];
    expect(computeScore(events, now)).toEqual(computeScore([...events].reverse(), now));
  });

  it("rises on pass and falls on fail", () => {
    expect(computeScore([ev("pass", "10000000", 1)], now).score).toBeGreaterThan(500);
    expect(computeScore([ev("fail", "10000000", 1)], now).score).toBeLessThan(500);
  });

  it("weights larger jobs more", () => {
    const small = computeScore([ev("pass", "1000000", 1, 1), ev("fail", "100000000", 1, 2)], now).score;
    const large = computeScore([ev("pass", "100000000", 1, 1), ev("fail", "1000000", 1, 2)], now).score;
    expect(large).toBeGreaterThan(small);
  });

  it("decays old failures toward the prior", () => {
    const recentFail = computeScore([ev("fail", "10000000", 1)], now).score;
    const oldFail = computeScore([ev("fail", "10000000", 180)], now).score;
    expect(oldFail).toBeGreaterThan(recentFail);
  });
});
