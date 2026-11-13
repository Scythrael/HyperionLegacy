// Completion tracking (0.14.0, docs/plans/2026-11-13-completion-tracking-design.md): golden hashes captured on the code
// BEFORE the engine edit (on top of 0157ceb3, commit 2652ed7c). The fixtures (completionTracking.fixture.ts) are real
// training runs on five systems, each read at the moments the slice writes: the finished run's claim, and a run recalled
// after its first body was charted (the recall, the claim once home, the abandon of its Resume system). Plus one relic
// study that completes an exceptional set inside an economy tick.
//
// The engine commit re-pins ONLY what the slice moves (GOLDEN), each with its reason, and proves the move with the slice
// switched off (completionTrackingSwitch.fixture.ts withCompletionTrackingOff): every fixture then reproduces its capture
// (BEFORE). A second proof: each moved state with the two new keys taken off hashes to its capture.

import { describe, expect, it } from "vitest";
import type { GameState } from "./model";
import { CT_SEEDS, ctClaimed, ctHash, ctRecalled, ctSetCompleted, ctSetStudyIndex, ctSetStudyState } from "./completionTracking.fixture";
import { withCompletionTrackingOff } from "./completionTrackingSwitch.fixture";
import { recordCompletion } from "./completion";
import { economyTick, tick } from "./tick";

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

// The pins today. Each move names its reason; every one returns to BEFORE with the slice off (the describe below).
// - Every claim: the training run finishes every objective, so the claim writes the system's record (100%) and the
//   ledger's "system completed" event.
// - The recall and the recalled run's claim do NOT move: a recalled run whose system is held to Resume writes nothing at
//   its claim (it is listed live from the held record). The ABANDON moves: it writes the Resume system's record at the %
//   it reached, marked abandoned.
// - The relic set: the study that completes the set appends the ledger's "relic set completed" event.
const GOLDEN_CLAIMS: Record<string, string> = {
  "1001": "94e204f8",
  "2002": "7285e727",
  "3003": "c924fe53",
  "4004": "bc9ef223",
  "5005": "60bb3fc3",
};
const GOLDEN_RECALLS: Record<string, string[]> = {
  "1001": ["809bc9af", "4c5c4650", "67a5c7c8"],
  "2002": ["d3c13f02", "9dad4eb6", "8a152b5f"],
  "3003": ["a5e5d19d", "17067623", "5c5176dc"],
  "4004": ["1d1c0c3e", "b5fa908f", "554631a"],
  "5005": ["c7fe1009", "ef69e98a", "563f3bc3"],
};
const GOLDEN_SET = "e279dcb4";

const withoutSlice = (s: GameState): GameState => {
  const rest = { ...s };
  delete rest.systemRecords;
  delete rest.notableEvents;
  return rest;
};
const recalls = (seed: number): string[] => {
  const r = ctRecalled(seed);
  return [ctHash(r.recalled), ctHash(r.claimed), ctHash(r.abandoned)];
};
const SET = { index: 44, setId: "exc-t1-a", pieceId: "exc-t1-a-p1" };

describe("completion tracking goldens", () => {
  for (const seed of CT_SEEDS) {
    const key = seed.toString(16);
    it(`claim ${key}`, { timeout: 120_000 }, () => expect(ctHash(ctClaimed(seed))).toBe(GOLDEN_CLAIMS[key]));
    it(`recall, claim and abandon ${key}`, { timeout: 120_000 }, () => expect(recalls(seed)).toEqual(GOLDEN_RECALLS[key]));
  }
  it("a relic set completed in one economy tick", () => {
    expect(ctSetStudyIndex()).toEqual(SET);
    expect(ctHash(ctSetCompleted(SET.index, SET.setId, SET.pieceId, 1805))).toBe(GOLDEN_SET);
  });
});

describe("completion tracking off reproduces every capture (BEFORE)", () => {
  for (const seed of CT_SEEDS) {
    const key = seed.toString(16);
    it(`claim ${key}`, { timeout: 120_000 }, () => expect(withCompletionTrackingOff(() => ctHash(ctClaimed(seed)))).toBe(BEFORE_CLAIMS[key]));
    it(`recall, claim and abandon ${key}`, { timeout: 120_000 }, () => expect(withCompletionTrackingOff(() => recalls(seed))).toEqual(BEFORE_RECALLS[key]));
  }
  it("the relic set", () => expect(withCompletionTrackingOff(() => ctHash(ctSetCompleted(SET.index, SET.setId, SET.pieceId, 1805)))).toBe(BEFORE_SET));
});

describe("completion tracking: the moves are the two new keys and nothing else", () => {
  for (const seed of CT_SEEDS) {
    const key = seed.toString(16);
    it(`claim ${key}: a 100% record and one ledger event`, { timeout: 120_000 }, () => {
      const s = ctClaimed(seed);
      expect(ctHash(withoutSlice(s))).toBe(BEFORE_CLAIMS[key]);
      const recs = Object.values(s.systemRecords ?? {});
      expect(recs).toHaveLength(1);
      expect(recordCompletion(recs[0])).toMatchObject({ percent: 100, complete: true });
      expect(s.notableEvents).toEqual([expect.objectContaining({ kind: "systemCompleted", key: `system-completed:${recs[0].systemId}`, systemId: recs[0].systemId, tier: 1 })]);
    });
    it(`abandon ${key}: an abandoned record under 100%, no ledger event`, { timeout: 120_000 }, () => {
      const r = ctRecalled(seed);
      expect(ctHash(withoutSlice(r.abandoned))).toBe(BEFORE_RECALLS[key][2]);
      const recs = Object.values(r.abandoned.systemRecords ?? {});
      expect(recs).toHaveLength(1);
      expect(recs[0].abandoned).toBe(true);
      const c = recordCompletion(recs[0]);
      expect(c.complete).toBe(false);
      expect(c.percent).toBeGreaterThan(0);
      expect(r.abandoned.notableEvents).toBeUndefined();
    });
  }
  it("the relic set: one ledger event, the same in one call, 997 s chunks and 1 s steps", () => {
    const one = ctSetCompleted(SET.index, SET.setId, SET.pieceId, 1805);
    expect(ctHash(withoutSlice(one))).toBe(BEFORE_SET);
    expect(one.notableEvents).toEqual([{ key: "relic-set-completed:exc-t1-a", kind: "relicSetCompleted", atGameSeconds: 1800, setId: "exc-t1-a", tier: 1 }]);
    const start = ctSetStudyState(SET.index, SET.setId, SET.pieceId);
    let stepped = start;
    for (let i = 0; i < 1805; i++) stepped = economyTick(stepped, 1, () => 0);
    let chunks = start;
    for (let left = 1805; left > 0; left -= 997) chunks = tick(Math.min(997, left), chunks, () => 0);
    expect(stepped.notableEvents).toEqual(one.notableEvents);
    expect(chunks.notableEvents).toEqual(one.notableEvents);
    expect(ctHash(stepped)).toBe(ctHash(one));
  });
});
