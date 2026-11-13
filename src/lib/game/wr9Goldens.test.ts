// Wiring WR-9 (docs/plans/2026-10-15-wiring-registry-and-audit-plan.md section 4 WR-9, its OC-E user answers): golden
// hashes captured on the code BEFORE the engine edit (on top of 1e6a40a). The fixtures (wr9.fixture.ts) are captain
// missions flown with a Cunning 20 Pilot (OC-E4), Ground Ops runs with Command Presence and an Integrity 20 Operations
// officer aboard (OC-E9), and batches of generated complement crew (OC-E12).
//
// The WR-9 wiring commit re-pins ONLY what WR-9 moves (GOLDEN), each with its reason beside it, and proves the move with
// WR-9 switched off (wr9Switch.fixture.ts withWr9Off): every fixture then reproduces its capture (BEFORE).

// The ordering determinism slice (canonicalOrder.ts: `discovered` and the lifetime tally maps kept in canonical order)
// came after every pin here: the file runs with it off (orderingSwitch.fixture.ts), so its pins keep proving their own
// slice (orderingGoldens.test.ts pins the order move and proves it moved order only).
import { canonicalOrderOffForThisFile } from "./orderingSwitch.fixture";
canonicalOrderOffForThisFile();
// Ordering determinism part 2 (canonicalOrder.ts: inventory keys and a call's completion log in one order) came after every pin here, traced order-only: the file runs with it off (ordering2Switch.fixture.ts).
import { ordering2OffForThisFile } from "./ordering2Switch.fixture";
ordering2OffForThisFile();
// OC-F14 (the field repair rules stamped at dispatch on a system mixing repair worlds with other bodies) came after every pin
// here, traced: the file runs with it off (fieldRepairRulesSwitch.fixture.ts), so its pins keep proving their own slice
// (fieldRepairOrderGoldens.test.ts pins OC-F14's moves and proves them with the switch off).
import { repairRulesOffForThisFile } from "./fieldRepairRulesSwitch.fixture";
repairRulesOffForThisFile();
import { describe, expect, it } from "vitest";
// Relics v2 source planets (user 2026-11-13 "First + count") came after these pins: each blank now also carries its
// planet's name (display only). The file runs with the stamp off, so every pin reproduces as captured (relicPlanet.fixture.ts).
import { planetStampOffForThisFile } from "./relicPlanet.fixture";
planetStampOffForThisFile();
// WR-8b (enemy torpedoes) came after every pin here: the file runs with it off (enemyTorpedoSwitch.fixture.ts), so its
// pins keep proving their own slice (enemyTorpedoGoldens.test.ts pins what WR-8b moved, enemyTorpedoes.test.ts proves it).
import { enemyTorpedoesOffForThisFile } from "./enemyTorpedoSwitch.fixture";
enemyTorpedoesOffForThisFile();
// Wiring WR-10 (the away rules stamped at dispatch, a hire's account program) came after every pin here: the whole file
// runs with WR-10 off (wr10Switch.fixture.ts), so its pins keep proving their own slice (wr10Goldens.test.ts pins WR-10's).
import { wr10OffForThisFile } from "./wr10Switch.fixture";
wr10OffForThisFile();
import { cp16OffForThisFile } from "./cp16Switch.fixture";
// Complement CP-16 (the Hall of Command) came after every pin here: the file runs with the slice off, so its pins
// keep proving their own slice (cp16Goldens.test.ts pins what CP-16 moved: the missions counter, the notables and
// the Hall of Command entry).
cp16OffForThisFile();
// Complement CP-18 (the soft captain level cap) came after every pin here: the mission captures fly a level 30 captain
// past level 31, so the file runs with the slice off and its pins keep proving their own slice.
import { cp18OffForThisFile } from "./cp18Switch.fixture";
cp18OffForThisFile();
import { cp14OffForThisFile } from "./cp14Switch.fixture";
// Complement CP-14 (hull base sensors and Science amplification) came after every pin here: the file runs with the
// slice off, so its pins keep proving their own slice (cp14Goldens.test.ts pins what CP-14 moved).
cp14OffForThisFile();
import {
  WR9_CREW_SEEDS,
  WR9_EXP_SEEDS,
  WR9_MISSIONS,
  wr9CrewBatch,
  wr9ExpeditionRun,
  wr9Hash,
  wr9LoadedCrew,
  wr9MissionHash,
  wr9MissionRun,
  wr9PatrolRun,
  wr9ShortRangeRun,
} from "./wr9.fixture";
import { withWr9Off } from "./wr9Switch.fixture";
import { gatheringTrainingOffForThisFile } from "./gatheringTrainingSwitch.fixture";

// Safe first runs SF-7 came after every pin here: its mission row is a fresh save's first gathering run, whose first
// delivery now wears nothing. The file dispatches as before SF-7 (gatheringTrainingSwitch.fixture.ts), so its pins keep
// proving WR-9 alone (SF-7's own moves: gatheringTrainingWearGoldens.test.ts).
gatheringTrainingOffForThisFile();
// E5-2 (Refugee Posts) came after every pin here: its short-range runs fly a fresh board, which now draws the
// Evacuation overlay. The file draws the seven-template board (evacuationDrawSwitch.fixture.ts), so its pins keep proving
// their own slice (E5-2's moves: refugeeGoldens.test.ts and refugeeArrival.test.ts).
import { evacuationDrawOffForThisFile } from "./evacuationDrawSwitch.fixture";
evacuationDrawOffForThisFile();

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
// The WR-9 fix round (review "recall replays the Pilot roll") moved all three again: a stamped dispatch now steps the
//   captain's lifetime Cunning counter (cunningCycles starts at 1), so every cycle's roll keys one step later. The
//   WR-9 build's pins were shortOreRun d7172350, surveyMineralAnomaly ce29b119, frontierSupplyRun 7d936e01.
const GOLDEN_MISSIONS: Record<string, string> = {
  shortOreRun: "b8289591",
  surveyMineralAnomaly: "b06c40a",
  frontierSupplyRun: "1335f873",
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

// ===== The WR-9 fix round (user answers 2026-10-31) =====
// Captured on the WR-9 build (cdfd2bd) BEFORE the fix round's engine edit: a short-range run and a Repeat patrol flown
// with a Cunning 20 Pilot (the Pilot's Cunning did not reach them yet), and a save written with two-buff Lieutenants and
// Lieutenant Commanders, loaded (no third buff was granted on load yet).
const FIX_BEFORE = { shortRange: "ead3b698", patrol: "877dcbfd", load: "c1d3160d" };
// The pins today, each moved by the fix round, and each back to FIX_BEFORE with WR-9 off:
//   shortRange: the dispatch stamps the Pilot's Cunning and each cycle start rolls it on its job seed; a landed cycle's
//               plan flies home a tick sooner, so later cycles start sooner and every count and payout shifts.
//   patrol    : the dispatch stamps it and each cycle (dispatch and relaunch) rolls it on its masterSeed; a landed cut is
//               folded into the cycle's frozen legs (legTicks), so its route, clock and later cycles shift.
//   load      : the save's two-buff Lieutenants and Lieutenant Commanders (complement, pool, notable) roll their third
//               buff on load, each on its own identity's seed; the exclusive-buff bucket splits by the buff it rolled.
const GOLDEN_FIX = { shortRange: "d397ce48", patrol: "b913e855", load: "2f0b3c19" };

describe("WR-9 fix round goldens", () => {
  it("short-range run", () => expect(wr9MissionHash(wr9ShortRangeRun())).toBe(GOLDEN_FIX.shortRange));
  it("patrol run", () => expect(wr9MissionHash(wr9PatrolRun())).toBe(GOLDEN_FIX.patrol));
  it("legacy crew save, loaded", () => expect(wr9Hash(wr9LoadedCrew())).toBe(GOLDEN_FIX.load));
});

describe("WR-9 fix round off reproduces every capture (FIX_BEFORE)", () => {
  it("short-range run", () => expect(withWr9Off(() => wr9MissionHash(wr9ShortRangeRun()))).toBe(FIX_BEFORE.shortRange));
  it("patrol run", () => expect(withWr9Off(() => wr9MissionHash(wr9PatrolRun()))).toBe(FIX_BEFORE.patrol));
  it("legacy crew save, loaded", () => expect(withWr9Off(() => wr9Hash(wr9LoadedCrew()))).toBe(FIX_BEFORE.load));
});
