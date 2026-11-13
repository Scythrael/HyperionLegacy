// Completion tracking, the planet 100% bonus relic roll (user 2026-11-13 "Planet roll + system badge (Recommended)"):
// golden hashes captured on the code BEFORE the engine edit (on the merge 913ff6b1). The fixtures
// (completionTracking.fixture.ts) are real training runs on five systems, read where a body's 100% can pay:
//   - the finished run's claim (every body 100%);
//   - a run recalled 60 s after its FIRST body reached 100% (the recall, the claim once home with its system held to
//     Resume, the abandon of that Resume system);
//   - the Resume system dispatched again and claimed finished, after an early recall (first body charted) and after the
//     late one (first body 100%).
// Hashed WITH the completion keys (completionTracking.fixture.ts ctHash), so the full claimed state stays pinned.

import { describe, expect, it } from "vitest";
import { CT_SEEDS, ctClaimed, ctHash, ctRecalled, ctResumed } from "./completionTracking.fixture";

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

const lateRecalls = (seed: number): string[] => {
  const r = ctRecalled(seed, "bodyDone");
  return [ctHash(r.recalled), ctHash(r.claimed), ctHash(r.abandoned)];
};
const resumed = (seed: number): string[] => [ctHash(ctResumed(seed, "charted").claimed), ctHash(ctResumed(seed, "bodyDone").claimed)];

describe("the planet roll goldens (captured before the engine edit)", () => {
  for (const seed of CT_SEEDS) {
    const key = seed.toString(16);
    it(`claim ${key}`, { timeout: 120_000 }, () => expect(ctHash(ctClaimed(seed))).toBe(BEFORE_CLAIMS[key]));
    it(`late recall, claim and abandon ${key}`, { timeout: 120_000 }, () => expect(lateRecalls(seed)).toEqual(BEFORE_LATE_RECALLS[key]));
    it(`resumed claims ${key}`, { timeout: 240_000 }, () => expect(resumed(seed)).toEqual(BEFORE_RESUMED[key]));
  }
});
