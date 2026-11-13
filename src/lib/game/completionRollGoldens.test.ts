// Completion tracking, the planet 100% bonus relic roll (user 2026-11-13 "Planet roll + system badge (Recommended)"):
// golden hashes captured on the code BEFORE the engine edit (on the merge 913ff6b1, commit 4c84f1d0). The fixtures
// (completionTracking.fixture.ts) are real training runs on five systems, read where a body's 100% can pay:
//   - the finished run's claim (every body 100%);
//   - a run recalled 60 s after its FIRST body reached 100% (the recall, the claim once home with its system held to
//     Resume, the abandon of that Resume system);
//   - the Resume system dispatched again and claimed finished, after an early recall (first body charted) and after the
//     late one (first body 100%).
// Hashed WITH the completion keys (completionTracking.fixture.ts ctHash), so the full claimed state stays pinned:
// systemRecords (with bodiesRolled), notableEvents and the vault.
//
// The engine commit re-pins ONLY what the roll moves (GOLDEN), each with its reason, and proves the move with the roll
// switched off (completionTrackingSwitch.fixture.ts withCompletionRollOff): every fixture then reproduces its capture.

import { describe, expect, it } from "vitest";
import type { GameState } from "./model";
import { CT_FAR, CT_SEEDS, ctClaimed, ctDispatch, ctFinished, ctHash, ctRecalled, ctResumed } from "./completionTracking.fixture";
import { withCompletionRollOff } from "./completionTrackingSwitch.fixture";
import { advanceExpedition, claimExpedition } from "./expedition";

// Captured on the code BEFORE the engine edit (913ff6b1).
const BEFORE_CLAIMS: Record<string, string> = {
  "1001": "1a80bb3a",
  "2002": "e1467346",
  "3003": "915ac616",
  "4004": "8d806622",
  "5005": "e7e0e676",
};
// [the recall, the claim once home, the abandon], recalled 60 s after the first body reached 100%.
const BEFORE_LATE_RECALLS: Record<string, string[]> = {
  "1001": ["779ac891", "e86635e3", "6c51a08"],
  "2002": ["ead68082", "f77173ce", "5ceea88b"],
  "3003": ["7e56ae14", "eb42c43e", "494f5191"],
  "4004": ["868117d3", "4ac282cf", "263bf1fe"],
  "5005": ["d645b68e", "7a617377", "e1c3d710"],
};
// The resumed run's claim, after the early recall and after the late one.
const BEFORE_RESUMED: Record<string, string[]> = {
  "1001": ["1d2f8db7", "12a59f2d"],
  "2002": ["9cf46bec", "ddc7371f"],
  "3003": ["58c605ac", "23db6407"],
  "4004": ["9cd9eac8", "2dd1ab3b"],
  "5005": ["550fb4de", "337c28aa"],
};

// The pins today. Each move names its reason; every one returns to BEFORE with the roll off (the describe below).
// - Every claim: the training run brings both bodies to 100%, so the claim pays two planet rolls (two completion blanks
//   at the end of the vault, each one rarity step up: augmented on these Tier I bodies) and the record keeps
//   bodiesRolled [0, 1].
// - The late recall and the recalled run's claim do NOT move (a held system writes no record and pays nothing at its
//   claim). The ABANDON moves: the first body reached 100% on that visit, so the abandon pays its roll (bodiesRolled [0]).
// - Both resumed claims move: the resumed run finishes both bodies and its claim pays both (the held visit paid none).
const GOLDEN_CLAIMS: Record<string, string> = {
  "1001": "59d462e3",
  "2002": "8d2c752d",
  "3003": "cdfdc087",
  "4004": "4374e167",
  "5005": "e346f2c4",
};
const GOLDEN_LATE_RECALLS: Record<string, string[]> = {
  "1001": ["779ac891", "e86635e3", "58a7ec5f"],
  "2002": ["ead68082", "f77173ce", "b08d8efa"],
  "3003": ["7e56ae14", "eb42c43e", "5ca8a1ed"],
  "4004": ["868117d3", "4ac282cf", "5caa373c"],
  "5005": ["d645b68e", "7a617377", "84d943c8"],
};
const GOLDEN_RESUMED: Record<string, string[]> = {
  "1001": ["12637af6", "ec23ee82"],
  "2002": ["bd6acb9", "27125874"],
  "3003": ["fcf47c2d", "563a6b50"],
  "4004": ["578b30ff", "6b609cb2"],
  "5005": ["f6ddfbca", "3b70bb4e"],
};

// The roll's two writes taken off: the completion blanks out of the vault, bodiesRolled off every record.
const withoutRoll = (s: GameState): GameState => ({
  ...s,
  relicVault: s.relicVault.filter((t) => t.source !== "completion"),
  ...(s.systemRecords
    ? {
        systemRecords: Object.fromEntries(
          Object.entries(s.systemRecords).map(([k, r]) => {
            const { bodiesRolled: _rolled, ...rest } = r;
            return [k, rest];
          }),
        ),
      }
    : {}),
});
// The completion blanks in a vault: [id, rarity, region tier, source planet].
const rolls = (s: GameState): [string, string, number, string | undefined][] =>
  s.relicVault.filter((t) => t.source === "completion").map((t) => [t.id, t.tier, t.regionTier ?? 0, t.planet]);

const lateRecalls = (seed: number): string[] => {
  const r = ctRecalled(seed, "bodyDone");
  return [ctHash(r.recalled), ctHash(r.claimed), ctHash(r.abandoned)];
};
const resumed = (seed: number): string[] => [ctHash(ctResumed(seed, "charted").claimed), ctHash(ctResumed(seed, "bodyDone").claimed)];

describe("the planet roll goldens", () => {
  for (const seed of CT_SEEDS) {
    const key = seed.toString(16);
    it(`claim ${key}`, { timeout: 120_000 }, () => expect(ctHash(ctClaimed(seed))).toBe(GOLDEN_CLAIMS[key]));
    it(`late recall, claim and abandon ${key}`, { timeout: 120_000 }, () => expect(lateRecalls(seed)).toEqual(GOLDEN_LATE_RECALLS[key]));
    it(`resumed claims ${key}`, { timeout: 240_000 }, () => expect(resumed(seed)).toEqual(GOLDEN_RESUMED[key]));
  }
});

describe("the roll off reproduces every capture (BEFORE)", () => {
  for (const seed of CT_SEEDS) {
    const key = seed.toString(16);
    it(`claim ${key}`, { timeout: 120_000 }, () => expect(withCompletionRollOff(() => ctHash(ctClaimed(seed)))).toBe(BEFORE_CLAIMS[key]));
    it(`late recall, claim and abandon ${key}`, { timeout: 120_000 }, () => expect(withCompletionRollOff(() => lateRecalls(seed))).toEqual(BEFORE_LATE_RECALLS[key]));
    it(`resumed claims ${key}`, { timeout: 240_000 }, () => expect(withCompletionRollOff(() => resumed(seed))).toEqual(BEFORE_RESUMED[key]));
  }
});

describe("the planet roll: the moves are the blanks and bodiesRolled, and nothing else", () => {
  for (const seed of CT_SEEDS) {
    const key = seed.toString(16);
    it(`claim ${key}: one blank per body, one step up, its planet named; bodiesRolled [0, 1]`, { timeout: 120_000 }, () => {
      const s = ctClaimed(seed);
      expect(ctHash(withoutRoll(s))).toBe(BEFORE_CLAIMS[key]);
      const name = Object.values(s.systemRecords!)[0].systemName;
      expect(rolls(s)).toEqual([
        ["expedition-1-relic-complete-body-1", "augmented", 1, `${name} b`],
        ["expedition-1-relic-complete-body-2", "augmented", 1, `${name} c`],
      ]);
      expect(Object.values(s.systemRecords!)[0].bodiesRolled).toEqual([0, 1]);
      // The claim result hands the same blanks to the log.
      const { state, exp } = ctFinished(seed);
      expect(claimExpedition(state, exp.id).planetRolls).toEqual(s.relicVault.filter((t) => t.source === "completion"));
    });
    it(`abandon ${key}: the first body's roll, once`, { timeout: 120_000 }, () => {
      const r = ctRecalled(seed, "bodyDone");
      expect(ctHash(withoutRoll(r.abandoned))).toBe(BEFORE_LATE_RECALLS[key][2]);
      expect(rolls(r.claimed)).toEqual([]);
      expect(rolls(r.abandoned).map((t) => t[0])).toEqual(["expedition-1-relic-complete-body-1"]);
      expect(Object.values(r.abandoned.systemRecords!)[0].bodiesRolled).toEqual([0]);
    });
    it(`resumed ${key}: the resumed claim pays both bodies, the held visit none`, { timeout: 240_000 }, () => {
      const whens = ["charted", "bodyDone"] as const;
      whens.forEach((when, i) => {
        const s = ctResumed(seed, when).claimed;
        expect(ctHash(withoutRoll(s))).toBe(BEFORE_RESUMED[key][i]);
        expect(rolls(s).map((t) => t[0])).toEqual(["expedition-2-relic-complete-body-1", "expedition-2-relic-complete-body-2"]);
      });
    });
  }

  it("never twice: the same system claimed finished again pays nothing, and its record keeps bodiesRolled", { timeout: 120_000 }, () => {
    const first = ctClaimed(0x1001);
    const { exp } = ctFinished(0x1001);
    const again = { ...exp, id: "expedition-9" };
    const r = claimExpedition({ ...first, gameTimeSeconds: first.gameTimeSeconds + 10, expeditions: [again] }, again.id);
    expect(r.success).toBe(true);
    expect(r.planetRolls).toEqual([]);
    expect(rolls(r.next)).toEqual(rolls(first));
    expect(Object.values(r.next.systemRecords!)[0].bodiesRolled).toEqual([0, 1]);
  });

  it("deterministic: the run advanced in one step or in 997 s chunks pays the same blanks at its claim", { timeout: 120_000 }, () => {
    const { next, exp } = ctDispatch(0x2002);
    const once = advanceExpedition(exp, CT_FAR);
    let chunked = exp;
    for (let t = exp.phaseAnchorSeconds + 997; chunked.phase !== "complete"; t += 997) {
      if (t > CT_FAR) throw new Error("the chunked run never finished");
      chunked = advanceExpedition(chunked, t);
    }
    const claim = (done: typeof once) => claimExpedition({ ...next, gameTimeSeconds: done.phaseAnchorSeconds, expeditions: [done] }, done.id);
    const a = claim(once);
    const b = claim(chunked);
    expect(a.planetRolls).toHaveLength(2);
    expect(b.planetRolls).toEqual(a.planetRolls);
    expect(b.next.systemRecords).toEqual(a.next.systemRecords);
  });
});
