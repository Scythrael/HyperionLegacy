// Completion tracking (0.14.0, docs/plans/2026-11-13-completion-tracking-design.md): golden hashes captured on the code
// BEFORE the engine edit (on top of 0157ceb3). The fixtures (completionTracking.fixture.ts) are real training runs on five
// systems, each read at the moments the slice writes: the finished run's claim, and a run recalled after its first body
// was charted (the recall, the claim once home, the abandon of its Resume system). Plus one relic study that completes
// an exceptional set inside an economy tick (one call, 1 s steps).

import { describe, expect, it } from "vitest";
import { CT_SEEDS, ctClaimed, ctHash, ctRecalled, ctSetCompleted, ctSetStudyIndex } from "./completionTracking.fixture";

// Captured on the code BEFORE the engine edit (0157ceb3).
const BEFORE_CLAIMS: Record<string, string> = {
  "1001": "a7207432",
  "2002": "b17744e8",
  "3003": "ce712cb",
  "4004": "459286d8",
  "5005": "9b0fdbbc",
};
const BEFORE_RECALLS: Record<string, string[]> = {
  "1001": ["809bc9af", "4c5c4650", "80bc782e"],
  "2002": ["d3c13f02", "9dad4eb6", "efb8cafb"],
  "3003": ["a5e5d19d", "17067623", "ee34a19c"],
  "4004": ["1d1c0c3e", "b5fa908f", "3dc7a287"],
  "5005": ["c7fe1009", "ef69e98a", "d7a088d"],
};
const BEFORE_SET = "8f9ada4e";

const GOLDEN_CLAIMS = BEFORE_CLAIMS;
const GOLDEN_RECALLS = BEFORE_RECALLS;
const GOLDEN_SET = BEFORE_SET;

describe("completion tracking goldens", () => {
  for (const seed of CT_SEEDS) {
    const key = seed.toString(16);
    it(`claim ${key}`, { timeout: 120_000 }, () => expect(ctHash(ctClaimed(seed))).toBe(GOLDEN_CLAIMS[key]));
    it(`recall, claim and abandon ${key}`, { timeout: 120_000 }, () => {
      const r = ctRecalled(seed);
      expect([ctHash(r.recalled), ctHash(r.claimed), ctHash(r.abandoned)]).toEqual(GOLDEN_RECALLS[key]);
    });
  }
  it("a relic set completed in one economy tick", () => {
    const s = ctSetStudyIndex();
    expect(s).toEqual({ index: 44, setId: "exc-t1-a", pieceId: "exc-t1-a-p1" });
    expect(ctHash(ctSetCompleted(s.index, s.setId, s.pieceId, 1805))).toBe(GOLDEN_SET);
  });
});
