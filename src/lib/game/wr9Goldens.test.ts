// Wiring WR-9 (docs/plans/2026-10-15-wiring-registry-and-audit-plan.md section 4 WR-9, its OC-E user answers): golden
// hashes captured on the code BEFORE the engine edit (on top of 1e6a40a). The fixtures (wr9.fixture.ts) are captain
// missions flown with a Cunning 20 Pilot (OC-E4), Ground Ops runs with Command Presence and an Integrity 20 Operations
// officer aboard (OC-E9), and batches of generated complement crew (OC-E12).
//
// The WR-9 wiring commit re-pins ONLY what WR-9 moves (GOLDEN), each with its reason beside it, and proves the move with
// WR-9 switched off (wr9Switch.fixture.ts withWr9Off): every fixture then reproduces its capture (BEFORE).

import { describe, expect, it } from "vitest";
import { WR9_CREW_SEEDS, WR9_EXP_SEEDS, WR9_MISSIONS, wr9CrewBatch, wr9ExpeditionRun, wr9MissionHash, wr9MissionRun } from "./wr9.fixture";

// Captured on the code BEFORE the engine edit (1e6a40a).
const BEFORE_MISSIONS: Record<string, string> = {
  shortOreRun: "6ac16744",
  surveyMineralAnomaly: "b1ee53d5",
  frontierSupplyRun: "a0023fc3",
};
const BEFORE_EXPEDITIONS: Record<string, string[]> = {
  "1234": ["a5a972e8", "363cbcb5", "bc338487"],
  "3c3c": ["7144b2af", "719e3c3e", "bc71ccc5"],
  bebe: ["60e733c", "4476cad8", "ce9530aa"],
};
const BEFORE_CREW: Record<string, string> = {
  "1": "354d1f6c",
  c0ffee: "3eddd765",
  "5eed5eed": "d6e70288",
};

// The pins today (equal to BEFORE until the WR-9 wiring commit re-pins what it moves).
const GOLDEN_MISSIONS: Record<string, string> = { ...BEFORE_MISSIONS };
const GOLDEN_EXPEDITIONS: Record<string, string[]> = { ...BEFORE_EXPEDITIONS };
const GOLDEN_CREW: Record<string, string> = { ...BEFORE_CREW };

describe("WR-9 goldens", () => {
  for (const m of WR9_MISSIONS) it(`mission ${m}`, () => expect(wr9MissionHash(wr9MissionRun(m))).toBe(GOLDEN_MISSIONS[m]));
  for (const seed of WR9_EXP_SEEDS) {
    it(`expedition ${seed.toString(16)}`, { timeout: 120_000 }, () => expect(wr9ExpeditionRun(seed).out).toEqual(GOLDEN_EXPEDITIONS[seed.toString(16)]));
  }
  for (const seed of WR9_CREW_SEEDS) it(`crew batch ${seed.toString(16)}`, () => expect(wr9CrewBatch(seed)).toBe(GOLDEN_CREW[seed.toString(16)]));
});
