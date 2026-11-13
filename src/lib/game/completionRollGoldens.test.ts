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
import { CT_FAR, CT_SEEDS, ctClaimed, ctDispatch, ctFinished, ctHash, ctRecalled, ctResumed, ctSkipRecalled } from "./completionTracking.fixture";
import { withCompletionRollOff, withHeldSkipsOff } from "./completionTrackingSwitch.fixture";
import { heldCompletion, runCompletion } from "./completion";
import { advanceExpedition, claimExpedition } from "./expedition";
import { economyTick } from "./tick";

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

// The review's Important 1 (2026-11-13), captured BEFORE its fix (on cb65cda3): a body's every objective SKIPPED, then
// the run recalled (completionTracking.fixture.ts ctSkipRecalled): [the recall, the claim once home, the abandon, the
// resumed run's claim]. On this code the recall re-queues the skips, so the held system counted them as not done.
const BEFORE_SKIP_RECALLS: Record<string, string[]> = {
  "1001": ["fc5a6aa7", "2cb09d46", "cb8a5ef4", "b51f422c"],
  "2002": ["35a57f3c", "20d2be2a", "602b8f3f", "3796db2b"],
  "3003": ["cbad5126", "30c0e7b", "4c376096", "24f4979b"],
  "4004": ["d60f5d0f", "936c62e2", "9ed63450", "428b48dd"],
  "5005": ["a94ab7fe", "8c0e45b8", "82731baf", "4bd8e5bc"],
};
// The pins after the fix (user Q3 "count as done", "never dips"). Moved, each returning to BEFORE with the fix off:
// - the recall: the held system keeps its skipped objective ids (HeldSystem.skipped), the objectives re-queued as before;
// - the claim once home: the same held system;
// - the abandon: the record counts the skips (the body 100%, the system 50%) and the body's planet roll pays (one blank,
//   bodiesRolled [0]); before the fix it kept 0 skipped and paid none.
// The resumed run's claim does NOT move: the resumed run finishes every objective, so its claim paid both rolls already.
const GOLDEN_SKIP_RECALLS: Record<string, string[]> = {
  "1001": ["35cc2fd9", "3bbdccbc", "31d5064e", "b51f422c"],
  "2002": ["a3b823e6", "cf043fa8", "9ccab2bf", "3796db2b"],
  "3003": ["e9c50f52", "f1f16967", "c10e440a", "24f4979b"],
  "4004": ["4ba669fb", "be283fc6", "24d06542", "428b48dd"],
  "5005": ["2fb18b58", "74d5d1d6", "1bf9cf40", "4bd8e5bc"],
};
const skipRecalls = (seed: number): string[] => {
  const r = ctSkipRecalled(seed);
  return [ctHash(r.recalled), ctHash(r.claimed), ctHash(r.abandoned), ctHash(r.resumed)];
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

describe("skips kept through a recall (the review fix)", () => {
  for (const seed of CT_SEEDS) {
    const key = seed.toString(16);
    it(`skip, recall, claim, abandon and resume ${key}`, { timeout: 240_000 }, () => expect(skipRecalls(seed)).toEqual(GOLDEN_SKIP_RECALLS[key]));
    it(`with the fix off every capture returns ${key}`, { timeout: 240_000 }, () => expect(withHeldSkipsOff(() => skipRecalls(seed))).toEqual(BEFORE_SKIP_RECALLS[key]));
    it(`${key}: the % never dips through the recall, and the skip-only 100% body pays its roll exactly once`, { timeout: 240_000 }, () => {
      const r = ctSkipRecalled(seed);
      const live = runCompletion(r.recalled.expeditions[0]);
      const held = heldCompletion(r.held);
      // The recall keeps the % and the skips (the objectives themselves wait in the queue for Resume, as before).
      expect([held.percent, held.objectivesSkipped, held.objectivesDone]).toEqual([live.percent, live.objectivesSkipped, live.objectivesDone]);
      expect(held.objectivesSkipped).toBeGreaterThan(0);
      expect(held.bodyLines[0].complete).toBe(true);
      expect(r.held.bodies![0].activities.every((a) => a.status === "queued")).toBe(true);
      // The resumed run starts where the held system stood.
      expect(runCompletion(r.resumedRun).percent).toBe(held.percent);
      // Abandon: the record keeps the skips, the body pays once.
      const ab = Object.values(r.abandoned.systemRecords!)[0];
      expect(ab.bodies[0].skipped).toBe(held.objectivesSkipped);
      expect(ab.bodiesRolled).toEqual([0]);
      expect(r.abandoned.relicVault.filter((t) => t.source === "completion")).toHaveLength(1);
      // Or resume and finish: both bodies pay once each, the skip-only body included.
      const rs = Object.values(r.resumed.systemRecords!)[0];
      expect(rs.bodiesRolled).toEqual([0, 1]);
      expect(r.resumed.relicVault.filter((t) => t.source === "completion").map((t) => t.id)).toEqual([`${r.resumedRun.id}-relic-complete-${r.resumedRun.bodies[0].id}`, `${r.resumedRun.id}-relic-complete-${r.resumedRun.bodies[1].id}`]);
    });
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

  it("deterministic through the economy: one economyTick == 997 s chunks == 1 s steps, then the claim pays the same", { timeout: 240_000 }, () => {
    const { next, exp } = ctDispatch(0x2002);
    const span = Math.ceil(advanceExpedition(exp, CT_FAR).phaseAnchorSeconds - next.gameTimeSeconds) + 5;
    const one = economyTick(next, span, () => 0);
    let chunks = next;
    for (let left = span; left > 0; left -= 997) chunks = economyTick(chunks, Math.min(997, left), () => 0);
    let steps = next;
    for (let i = 0; i < span; i++) steps = economyTick(steps, 1, () => 0);
    const claim = (s: GameState) => claimExpedition(s, exp.id);
    const [a, b, c] = [claim(one), claim(chunks), claim(steps)];
    expect(a.success && b.success && c.success).toBe(true);
    expect(a.planetRolls).toHaveLength(2);
    expect(b.planetRolls).toEqual(a.planetRolls);
    expect(c.planetRolls).toEqual(a.planetRolls);
    expect(ctHash(b.next)).toBe(ctHash(a.next));
    expect(ctHash(c.next)).toBe(ctHash(a.next));
  });
});
