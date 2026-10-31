// Wiring WR-9 (docs/plans/2026-10-15-wiring-registry-and-audit-plan.md section 4 WR-9, its OC-E user answers): golden
// hashes captured on the code BEFORE the engine edit (on top of 1e6a40a). The fixtures (wr9.fixture.ts) are captain
// missions flown with a Cunning 20 Pilot (OC-E4), Ground Ops runs with Command Presence and an Integrity 20 Operations
// officer aboard (OC-E9), and batches of generated complement crew (OC-E12).
//
// The WR-9 wiring commit re-pins ONLY what WR-9 moves (GOLDEN), each with its reason beside it, and proves the move with
// WR-9 switched off (wr9Switch.fixture.ts withWr9Off): every fixture then reproduces its capture (BEFORE).

import { describe, expect, it } from "vitest";
import { WR9_CREW_SEEDS, WR9_EXP_SEEDS, WR9_MISSIONS, wr9CrewBatch, wr9ExpeditionRun, wr9MissionHash, wr9MissionRun } from "./wr9.fixture";
import { withWr9Off } from "./wr9Switch.fixture";

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

// The pins today. Each move names its reason; every one returns to BEFORE with WR-9 off (the last describe below).
// Missions (OC-E4): the dispatch stamps the Pilot's Cunning (pilotCunning 0.1), the captain's lifetime Cunning counter
//   now steps every delivered cycle (cunningCycles), and the cycles whose Flight Deck roll lands fly home a tick
//   sooner, so every later cycle, haul and XP tick shifts. All three moved.
// Expeditions (OC-E9): the dispatched record carries Command Presence (groundOutputShare) and its Ground Ops factors
//   the Operations officer's Integrity (offloadSteady), so every dispatch hash moves; the done and claim hashes move
//   with the larger objective hauls and the faster whole-objective offloads.
// Crew (OC-E12): every Lieutenant and Lieutenant Commander in a batch now carries a third profession buff (buff3Id),
//   drawn after every earlier draw, so each batch hash moves (every other field of every crewmember is unchanged:
//   wr9.test.ts proves it).
const GOLDEN_MISSIONS: Record<string, string> = {
  shortOreRun: "d7172350",
  surveyMineralAnomaly: "ce29b119",
  frontierSupplyRun: "7d936e01",
};
const GOLDEN_EXPEDITIONS: Record<string, string[]> = {
  "1234": ["34a4915", "9585929f", "23392cc7"],
  "3c3c": ["41e75d4", "65601417", "5ace47d5"],
  bebe: ["5ec62973", "25ea8167", "63153a93"],
};
const GOLDEN_CREW: Record<string, string> = {
  "1": "d35a573c",
  c0ffee: "fe89490e",
  "5eed5eed": "d54d4a7b",
};

describe("WR-9 goldens", () => {
  for (const m of WR9_MISSIONS) it(`mission ${m}`, () => expect(wr9MissionHash(wr9MissionRun(m))).toBe(GOLDEN_MISSIONS[m]));
  for (const seed of WR9_EXP_SEEDS) {
    it(`expedition ${seed.toString(16)}`, { timeout: 120_000 }, () => expect(wr9ExpeditionRun(seed).out).toEqual(GOLDEN_EXPEDITIONS[seed.toString(16)]));
  }
  for (const seed of WR9_CREW_SEEDS) it(`crew batch ${seed.toString(16)}`, () => expect(wr9CrewBatch(seed)).toBe(GOLDEN_CREW[seed.toString(16)]));
});

describe("WR-9 off reproduces every capture (BEFORE)", () => {
  for (const m of WR9_MISSIONS) it(`mission ${m}`, () => expect(withWr9Off(() => wr9MissionHash(wr9MissionRun(m)))).toBe(BEFORE_MISSIONS[m]));
  for (const seed of WR9_EXP_SEEDS) {
    it(`expedition ${seed.toString(16)}`, { timeout: 120_000 }, () => expect(withWr9Off(() => wr9ExpeditionRun(seed).out)).toEqual(BEFORE_EXPEDITIONS[seed.toString(16)]));
  }
  for (const seed of WR9_CREW_SEEDS) it(`crew batch ${seed.toString(16)}`, () => expect(withWr9Off(() => wr9CrewBatch(seed))).toBe(BEFORE_CREW[seed.toString(16)]));
});
