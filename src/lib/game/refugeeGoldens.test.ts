// E5-0 (Refugee Posts, docs/plans/2026-11-02-refugee-posts-e5-plan.md Task E5-0): golden pins captured on the code
// BEFORE any E5 engine edit (on top of 19e5ac4, feat/crew-0.14.0). They are the "today" record every E5 slice compares
// against. A slice that moves one on purpose names the move beside the pin and traces it with a switch fixture; a pin
// that moves without a named cause is a bug.
//
//   1. draws     : rollShortRangeJob for slots 0..3 x cycles 0..63 x three board seeds (a fresh save's, a fixed
//                  homeworld's, SHORT_RANGE_DEFAULT_SEED) x two counter states (fresh, every template a veteran),
//                  hashed per (seed, counters, slot). E5-2's Evacuation template must leave every one byte-identical
//                  on an existing save (the v71 stamp), so these are the old boards' upcoming draws.
//   2. fleet     : four captains on short-range Repeat on all four slots (slot 0 flying a Refugee Relocation), six
//                  hours through economyTick, the whole state hashed at every hour, plus every slot's preview at the
//                  end.
//   3. consumers : every facility stat the eight refugee backgrounds will touch, on three facility-level fixtures:
//                  refine duration per recipe, research and relic study durations, fabricate duration per blueprint,
//                  build duration per hull, the salvage fraction (fixed band draws), fleetReachBonus and each hull's
//                  range, telescopeReading().rangeLy (and per level), and shortRangeCyclePlan for 20 rolls.
//   4. registry  : the wiring registry's ids and statuses (count and hash), with the entries E5 adds held apart
//                  (E5_ADDED_ENTRY_IDS, empty now; E5-4 fills it), so the pin keeps proving no existing entry moved.
//   5. old save  : the fleet saved at v70, through deserialize + migrate, then six hours; the state hash at every hour
//                  and every slot's preview.
//   6. help      : the `shortRange` Help topic text and the board's job types list (shortRangeBoardDisplay.ts).
//
// Capture: `E5_CAPTURE=<path> npx vitest run src/lib/game/refugeeGoldens.test.ts` writes every pin to <path> (the
// G1_CAPTURE precedent in shortRangeGoldens.test.ts) instead of checking it.
//
// E5-2 (the Evacuation template, versioned draw): the pins captured on 19e5ac4 keep their values and are checked with
// the Evacuation draw OFF (evacuationDrawSwitch.fixture.ts withEvacuationDrawOff: the game before E5-2 exactly), which
// traces every move. Beside each moved pin, an `e5-2:` pin records the new value with the draw ON. What moved and why:
//   golden 1  a fresh board has no v71 stamp, so it draws the overlay from cycle 0 (`e5-2:draws:*`); a STAMPED board
//             (every slot stamped at 64) is byte-identical to the old pins with the draw ON (an existing save's boards).
//   golden 2  the fleet starts on a fresh board, so Evacuations join its cycles (`e5-2:fleet*`).
//   golden 5  the migrated old save draws the overlay from each slot's stamp on; hour 0 and every roll before a stamp
//             are unchanged (asserted), the later hours move (`e5-2:old*`).
//   golden 4  unchanged: the three Evacuation template rows are E5_ADDED_ENTRY_IDS.
//   golden 6  the Help topic gains the Evacuation job line and the job types list its eighth row; with that line and row
//             taken out, both equal the old pins.
//   golden 3  unchanged (no consumer reads a refugee yet); its cycle plans sample a fresh board's rolls, so it reads
//             them with the draw off (the draw's move is golden 1's).

import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import Decimal from "break_infinity.js";
import { BLUEPRINTS, FACILITIES, REFINE_RECIPES, SHIP_TYPES, freshState, type EquipmentRarity, type GameState, type ShipTypeKey, type ShortRangeMissionState } from "./model";
import { SHORT_RANGE_DEFAULT_SEED, SHORT_RANGE_TEMPLATE_KEYS, rollShortRangeJob, shortRangeBoardSeed, shortRangeCyclePlan, shortRangeShipEngineering } from "./shortRange";
import { shortRangeBoardSlots, shortRangeNextCycle, shortRangeSlotPreview, startShortRangeCycle } from "./shortRangeBoard";
import { newRunRelicBlanksFlag } from "./relicBlanks";
import { economyTick, fleetReachBonus, installMissingCombatBaselines, mintBuiltShip, museumResearchDurationTicks, refineJobDurationTicks, shipBuildDurationTicks, shipRangeLightYears } from "./tick";
import { effectiveShipStats } from "./crewOverlay";
import { relicStudyDurationTicks, museumBonuses } from "./relics";
import { hullTeardownFraction, salvageYieldMult } from "./salvage";
import { telescopeReading, telescopeReadingAtLevel } from "./telescope";
import { deserialize, migrate, serialize, type SaveFile } from "./save";
import { WIRING_REGISTRY } from "./wiring/registry";
import { HELP_TOPICS } from "../helpTopics";
import { shortRangeTypeRows } from "../shortRangeBoardDisplay";
// E5-1: golden 5 hashes its migrated old save without the v71 board stamp (asserted beside the pin instead).
import { hash, withoutEvacuationStamp } from "./firstRunsGoldens.fixture";
// E5-2: the Evacuation draw's test-only off switch (the pre-E5-2 game), tracing every moved pin.
import { withEvacuationDrawOff } from "./evacuationDrawSwitch.fixture";
import { E5_2_ADDED_ENTRY_IDS } from "./refugeeRegistry.fixture";

// The wiring registry entries E5 adds (E5-4 fills it). Held apart from golden 4, so that pin proves nothing else moved.
// E5-2: the Evacuation template's three rows (the template catalog loop, registry.ts; refugeeRegistry.fixture.ts).
export const E5_ADDED_ENTRY_IDS: readonly string[] = [...E5_2_ADDED_ENTRY_IDS];

const RNG = (): number => 0.5;
const HOUR = 3600;
const HOMEWORLD_SEED = 0x5eed0e50;
const MIGRATE_ENTROPY = 0x0e5e0e50;
const SAVED_AT_MS = 1_790_000_000_000;

// ===== fixtures =====

// Every template flown 20 times: each roll past its training run and at full size (the slow start's end).
function veteranCounts(state: GameState): GameState {
  return {
    ...state,
    runCounts: {
      version: 1,
      expedition: { completed: 0, trainingDone: false, veteran: false },
      patrol: { dispatched: 0, completed: 0, veteran: false },
      shortRange: Object.fromEntries(SHORT_RANGE_TEMPLATE_KEYS.map((k) => [k, { dispatched: 20, completed: 20 }])),
    },
  };
}

function withMissionControl(state: GameState, level: number): GameState {
  return { ...state, facilities: { ...state.facilities, missionControl: { ...state.facilities.missionControl, level } } };
}

// The first cycle index whose slot 0 roll is a Refugee Relocation (the fleet's slot 0 starts there). Pure.
function firstRelocationCycle(state: GameState): number {
  for (let c = 0; c < 256; c++) if (rollShortRangeJob(state, { id: 0, tier: 1 }, c).template === "refugeeRelocation") return c;
  throw new Error("no refugee relocation in 256 cycles");
}

// A fixed homeworld's save with ship-1 a General Freighter, three more General Freighters minted the Shipyard's way,
// four level 10 captains (one per hull), Mission Control at level 3 (all four board slots), every transit berth rung
// bought (the shortRangeCycle.test.ts parity fleet's 8: no home unload ever waits, so an hour-long call cannot starve
// the later slots of a berth) and the stores full of credits, then every captain on short-range Repeat, captain i on slot i - 1. Slot 0's board cursor is set
// to its first Refugee Relocation, so the fleet flies one from its first cycle. Each first cycle starts through the
// board's own cycle-start seam (startShortRangeCycle, the G1-4 golden 7 precedent: the sheet gate is the dispatch's,
// not the cycle's), with the relic blanks flag a run dispatched today carries.
function shortRangeFleet(): GameState {
  const fresh = freshState(HOMEWORLD_SEED);
  let s: GameState = installMissingCombatBaselines({
    ...fresh,
    ships: fresh.ships.map((sh) => (sh.id === "ship-1" ? { ...sh, typeKey: "generalFreighter" } : sh)),
  });
  let acc = { ships: s.ships, nextShipId: s.nextShipId, equipment: s.equipment, nextEquipmentId: s.nextEquipmentId };
  const minted: string[] = [];
  for (let i = 0; i < 3; i++) {
    const m = mintBuiltShip(acc, "generalFreighter");
    minted.push(m.shipId);
    acc = m;
  }
  const captainOf: Record<string, number> = { "ship-1": 1, [minted[0]]: 2, [minted[1]]: 3, [minted[2]]: 4 };
  const cap1 = s.captains[0];
  s = withMissionControl(
    installMissingCombatBaselines({
      ...s,
      credits: new Decimal(1_000_000_000),
      transitBerthCapacity: 8,
      ships: acc.ships.map((sh) => ({ ...sh, assignedCaptainId: captainOf[sh.id] })),
      nextShipId: acc.nextShipId,
      equipment: acc.equipment,
      nextEquipmentId: acc.nextEquipmentId,
      captains: [1, 2, 3, 4].map((id) => ({ ...cap1, id, label: `Captain ${id}`, level: 10, mission: null })),
    }),
    3,
  );
  s = { ...s, shortRangeBoard: { version: 1, nextCycle: { 0: firstRelocationCycle(s) } } };
  for (const slot of shortRangeBoardSlots(s)) {
    const captainId = slot.id + 1;
    const ship = s.ships.find((sh) => sh.assignedCaptainId === captainId)!;
    const start = startShortRangeCycle(s, ship, slot, shortRangeNextCycle(s, slot.id), undefined, false);
    const mission: ShortRangeMissionState = {
      kind: "shortRange",
      slotId: slot.id,
      roll: start.roll,
      plan: start.plan,
      phase: "transitOut",
      phaseProgressTicks: 0,
      recalled: false,
      relicBlanks: newRunRelicBlanksFlag(),
    };
    s = { ...s, captains: s.captains.map((c) => (c.id === captainId ? { ...c, mission } : c)), runCounts: start.runCounts };
  }
  return s;
}

function previews(s: GameState): string[] {
  return shortRangeBoardSlots(s).map((slot) => hash(shortRangeSlotPreview(s, slot)));
}

// The three facility-level fixtures golden 3 reads: every refugee facility at level 1, at level 4 (or its top, when
// shorter), and at its top level.
const REFUGEE_FACILITIES = ["refinery", "fuelStorage", "missionControl", "research", "fabricator", "shipyard", "salvageBay", "subspaceTelescope"] as const;
type LevelFixture = "low" | "mid" | "top";
function facilityFixture(kind: LevelFixture): GameState {
  const base = installMissingCombatBaselines(freshState(HOMEWORLD_SEED));
  const facilities = { ...base.facilities };
  for (const k of REFUGEE_FACILITIES) {
    const top = FACILITIES[k].upgrades.length;
    facilities[k] = { ...facilities[k], level: kind === "low" ? 1 : kind === "mid" ? Math.min(4, top) : top };
  }
  return { ...base, facilities };
}

const HULLS = Object.keys(SHIP_TYPES) as ShipTypeKey[];
const STUDY_TIERS: readonly EquipmentRarity[] = ["standard", "augmented", "stellar", "radiant", "luminous", "constellar"];

function consumers(s: GameState): Record<string, unknown> {
  const museumSpeed = museumBonuses(s).researchSpeed;
  const vet = veteranCounts(s);
  const ship = { ...vet.ships[0], typeKey: "generalFreighter" as ShipTypeKey };
  const vetShip = { ...vet, ships: [ship, ...vet.ships.slice(1)] };
  const stats = effectiveShipStats(vetShip, ship);
  const eng = shortRangeShipEngineering(vetShip, ship);
  const plans = [0, 2].flatMap((slotId) =>
    Array.from({ length: 10 }, (_, c) => {
      const roll = rollShortRangeJob(vetShip, { id: slotId, tier: slotId === 0 ? 1 : 2 }, c);
      return [roll.template, shortRangeCyclePlan(roll, stats, eng)];
    }),
  );
  return {
    refine: hash(Object.entries(REFINE_RECIPES).map(([k, r]) => [k, refineJobDurationTicks(s, r.durationTicks)])),
    research: hash(Object.entries(BLUEPRINTS).map(([k, bp]) => [k, museumResearchDurationTicks(bp.researchDurationTicks, museumSpeed)])),
    relicStudy: STUDY_TIERS.map((t) => museumResearchDurationTicks(relicStudyDurationTicks(t), museumSpeed)),
    fabricate: hash(Object.entries(BLUEPRINTS).map(([k, bp]) => [k, bp.craftDurationTicks])),
    build: HULLS.map((h) => shipBuildDurationTicks(s, h)),
    salvage: [salvageYieldMult(s), ...[0, 0.25, 0.5, 0.75, 0.999].map((d) => hullTeardownFraction(s, d))],
    fleetReachBonus: fleetReachBonus(s),
    range: hash(HULLS.map((h) => shipRangeLightYears(s, { ...s.ships[0], typeKey: h }))),
    telescope: [telescopeReading(s).rangeLy, telescopeReading(s).reachTier, telescopeReading(s).detail],
    cyclePlans: hash(plans),
  };
}

// ===== the goldens =====

// Captured on 19e5ac4 (feat/crew-0.14.0), before any E5 engine edit.
const GOLDEN: Record<string, unknown> = {
  "draws:fresh:fresh:slot0": "79a02929",
  "draws:fresh:fresh:slot1": "b9e6bc6b",
  "draws:fresh:fresh:slot2": "629f8a",
  "draws:fresh:fresh:slot3": "1f2b73c3",
  "draws:fresh:veteran:slot0": "578f7d92",
  "draws:fresh:veteran:slot1": "d1ca1095",
  "draws:fresh:veteran:slot2": "f0e5605a",
  "draws:fresh:veteran:slot3": "79c9c3f",
  "draws:homeworld:fresh:slot0": "5c4908bb",
  "draws:homeworld:fresh:slot1": "5ebc5910",
  "draws:homeworld:fresh:slot2": "4abdcd1e",
  "draws:homeworld:fresh:slot3": "55a86dfe",
  "draws:homeworld:veteran:slot0": "bb35810",
  "draws:homeworld:veteran:slot1": "b4819b4a",
  "draws:homeworld:veteran:slot2": "a9641e90",
  "draws:homeworld:veteran:slot3": "cfcb9c25",
  "draws:default:fresh:slot0": "79a02929",
  "draws:default:fresh:slot1": "b9e6bc6b",
  "draws:default:fresh:slot2": "629f8a",
  "draws:default:fresh:slot3": "1f2b73c3",
  "draws:default:veteran:slot0": "578f7d92",
  "draws:default:veteran:slot1": "d1ca1095",
  "draws:default:veteran:slot2": "f0e5605a",
  "draws:default:veteran:slot3": "79c9c3f",
  "fleet": ["766005", "a031b4e8", "c327e769", "186d2a73", "ad1395fe", "fde92863", "feee53e"],
  "fleet:previews": ["45496c4d", "2d37bfec", "d0fe0d97", "afa7193f"],
  "fleet:board": {"version": 1, "nextCycle": {"0": 157, "1": 145, "2": 85, "3": 89}},
  "consumers:low": {"refine": "b2054c1b", "research": "bfee57bc", "relicStudy": [600, 900, 1200, 1800, 1800, 1800], "fabricate": "313a5c57", "build": [300, 700, 450, 550, 600, 1200, 1150, 1000, 950, 1100], "salvage": [1, 0.3, 0.325, 0.35, 0.375, 0.39990000000000003], "fleetReachBonus": 0.05, "range": "ff93643", "telescope": [215, 1, 2], "cyclePlans": "1508f8db"},
  "consumers:mid": {"refine": "c1ec4799", "research": "bfee57bc", "relicStudy": [600, 900, 1200, 1800, 1800, 1800], "fabricate": "313a5c57", "build": [100, 233.33333333333334, 150, 183.33333333333334, 200, 400, 383.3333333333333, 333.3333333333333, 316.6666666666667, 366.6666666666667], "salvage": [1, 0.3, 0.325, 0.35, 0.375, 0.39990000000000003], "fleetReachBonus": 0.2, "range": "de2ecafe", "telescope": [7630, 4, 3], "cyclePlans": "1508f8db"},
  "consumers:top": {"refine": "c1ec4799", "research": "bfee57bc", "relicStudy": [600, 900, 1200, 1800, 1800, 1800], "fabricate": "313a5c57", "build": [100, 233.33333333333334, 150, 183.33333333333334, 200, 400, 383.3333333333333, 333.3333333333333, 316.6666666666667, 366.6666666666667], "salvage": [1, 0.3, 0.325, 0.35, 0.375, 0.39990000000000003], "fleetReachBonus": 0.44999999999999996, "range": "55801334", "telescope": [26470, 7, 5], "cyclePlans": "1508f8db"},
  "telescope:levels": [0, 150, 3000, 3000, 7600, 7600, 13000, 25000, 26500],
  "registry": [1728, "bf47b0ce"],
  "old": ["766005", "a031b4e8", "c327e769", "186d2a73", "ad1395fe", "fde92863", "feee53e"],
  "old:previews": ["45496c4d", "2d37bfec", "d0fe0d97", "afa7193f"],
  "help:shortRange": "db693b08",
  "types:fresh": [
    "refugeeRelocation|Refugee Relocation|team|Training run next|range,guests",
    "supplyDropOff|Supply Drop-off|offload|Training run next|range,cargo",
    "supplyPickup|Supply Pickup|reload|Training run next|range,cargo",
    "phenomenonSurvey|Phenomenon Survey|discovery|Training run next|range,sensors",
    "telescopeRepair|Telescope Repair|telescope|Training run next|range,cargo,engineering",
    "commBoosterBuild|Comm Booster Build|commBooster|Training run next|range,cargo,engineering",
    "prisonerTransport|Prisoner Transport|security|Training run next|range,guests,security",
  ],
  // E5-2 (the Evacuation template): the moved pins' new values, captured with the Evacuation draw on (see the header).
  "e5-2:draws:fresh:fresh:slot0": "f636df88",
  "e5-2:draws:fresh:fresh:slot1": "2d70213a",
  "e5-2:draws:fresh:fresh:slot2": "ad015c8",
  "e5-2:draws:fresh:fresh:slot3": "b33b92de",
  "e5-2:draws:fresh:veteran:slot0": "b936d849",
  "e5-2:draws:fresh:veteran:slot1": "6a125fd1",
  "e5-2:draws:fresh:veteran:slot2": "48b4486d",
  "e5-2:draws:fresh:veteran:slot3": "cb446560",
  "e5-2:draws:homeworld:fresh:slot0": "335db946",
  "e5-2:draws:homeworld:fresh:slot1": "60278115",
  "e5-2:draws:homeworld:fresh:slot2": "b5e1a30d",
  "e5-2:draws:homeworld:fresh:slot3": "fa6fbb7f",
  "e5-2:draws:homeworld:veteran:slot0": "4971491b",
  "e5-2:draws:homeworld:veteran:slot1": "51b26350",
  "e5-2:draws:homeworld:veteran:slot2": "be9a4425",
  "e5-2:draws:homeworld:veteran:slot3": "cac79702",
  "e5-2:draws:default:fresh:slot0": "f636df88",
  "e5-2:draws:default:fresh:slot1": "2d70213a",
  "e5-2:draws:default:fresh:slot2": "ad015c8",
  "e5-2:draws:default:fresh:slot3": "b33b92de",
  "e5-2:draws:default:veteran:slot0": "b936d849",
  "e5-2:draws:default:veteran:slot1": "6a125fd1",
  "e5-2:draws:default:veteran:slot2": "48b4486d",
  "e5-2:draws:default:veteran:slot3": "cb446560",
  "e5-2:fleet": ["766005", "4c2952ef", "cb8490a6", "6fd8464d", "932b0371", "e7bb5a0a", "9331e17a"],
  "e5-2:fleet:previews": ["867fc47a", "deaf482e", "d0fe0d97", "6680b6d7"],
  "e5-2:fleet:board": {"version": 1, "nextCycle": {"0": 157, "1": 150, "2": 85, "3": 91}},
  "e5-2:old": ["766005", "4c2952ef", "cb8490a6", "6fd8464d", "932b0371", "e7bb5a0a", "9331e17a"],
  "e5-2:old:previews": ["867fc47a", "deaf482e", "d0fe0d97", "6680b6d7"],
  "e5-2:help:shortRange": "48fd5726",
  "e5-2:types:fresh": [
    "refugeeRelocation|Refugee Relocation|team|Training run next|range,guests",
    "supplyDropOff|Supply Drop-off|offload|Training run next|range,cargo",
    "supplyPickup|Supply Pickup|reload|Training run next|range,cargo",
    "phenomenonSurvey|Phenomenon Survey|discovery|Training run next|range,sensors",
    "telescopeRepair|Telescope Repair|telescope|Training run next|range,cargo,engineering",
    "commBoosterBuild|Comm Booster Build|commBooster|Training run next|range,cargo,engineering",
    "prisonerTransport|Prisoner Transport|security|Training run next|range,guests,security",
    "evacuation|Evacuation|home|Training run next|range,guests",
  ],
};

const CAPTURE = Boolean(import.meta.env.E5_CAPTURE);
const captured: Record<string, unknown> = {};
function pin(key: string, value: unknown): void {
  if (CAPTURE) {
    captured[key] = value;
    return;
  }
  expect(value, key).toEqual(GOLDEN[key]);
}

// Golden 1's draws on `board` (absent: a fresh board), keyed as the pins are. Pure.
function draws(board?: GameState["shortRangeBoard"]): Record<string, string> {
  const fresh = withMissionControl(freshState(), 3);
  const seeds: Record<string, number> = {
    fresh: shortRangeBoardSeed(fresh),
    homeworld: shortRangeBoardSeed(freshState(HOMEWORLD_SEED)),
    default: SHORT_RANGE_DEFAULT_SEED,
  };
  expect(seeds.fresh).toBe(SHORT_RANGE_DEFAULT_SEED);
  const counters: Record<string, GameState> = { fresh, veteran: veteranCounts(fresh) };
  const out: Record<string, string> = {};
  for (const [seedName, seed] of Object.entries(seeds)) {
    for (const [countName, base] of Object.entries(counters)) {
      const state = board === undefined ? base : { ...base, shortRangeBoard: board };
      for (const slot of shortRangeBoardSlots(state)) {
        const rolls = Array.from({ length: 64 }, (_, c) => rollShortRangeJob(state, slot, c, seed));
        out[`draws:${seedName}:${countName}:slot${slot.id}`] = hash(rolls);
      }
    }
  }
  return out;
}

describe("E5-0 golden 1: the short-range board's upcoming draws on existing saves", () => {
  it("rollShortRangeJob for slots 0..3 x cycles 0..63 x three board seeds x two counter states", () => {
    // The pins, traced: the game before E5-2 (the Evacuation draw off).
    for (const [k, v] of Object.entries(withEvacuationDrawOff(() => draws()))) pin(k, v);
    // E5-2: an EXISTING save's board (every slot stamped past these 64 cycles) draws exactly the pins with the draw ON.
    const stamped = draws({ version: 1, nextCycle: {}, evacuationFrom: { 0: 64, 1: 64, 2: 64, 3: 64 } });
    if (!CAPTURE) for (const [k, v] of Object.entries(stamped)) expect(v, k).toBe(GOLDEN[k]);
    // E5-2: a fresh board (no stamp) draws the Evacuation overlay from cycle 0.
    for (const [k, v] of Object.entries(draws())) pin(`e5-2:${k}`, v);
    // Every template appears, so a moved draw cannot hide behind one template's absence: the seven before E5-2, all
    // eight after.
    const fresh = withMissionControl(freshState(), 3);
    const templates = (): string[] => [...new Set(Array.from({ length: 64 }, (_, c) => rollShortRangeJob(fresh, { id: 0, tier: 1 }, c).template))].sort();
    expect(withEvacuationDrawOff(templates)).toEqual(SHORT_RANGE_TEMPLATE_KEYS.filter((k) => k !== "evacuation").sort());
    expect(templates()).toEqual([...SHORT_RANGE_TEMPLATE_KEYS].sort());
  });
});

describe("E5-0 golden 2: a short-range fleet on Repeat on every slot, six hours", () => {
  function fleetHours(): { hours: string[]; previews: string[]; board: unknown; s: GameState } {
    let s = shortRangeFleet();
    expect(s.captains.find((c) => c.id === 1)?.mission).toMatchObject({ kind: "shortRange", roll: { template: "refugeeRelocation" } });
    const hours = [hash(s)];
    for (let h = 1; h <= 6; h++) {
      s = economyTick(s, HOUR, RNG);
      hours.push(hash(s));
    }
    expect(s.captains.every((c) => c.mission !== null && c.mission.kind === "shortRange")).toBe(true);
    return { hours, previews: previews(s), board: s.shortRangeBoard, s };
  }

  it("the whole state every hour, then every slot's preview", () => {
    // The pins, traced: the game before E5-2 (the Evacuation draw off).
    const old = withEvacuationDrawOff(fleetHours);
    pin("fleet", old.hours);
    pin("fleet:previews", old.previews);
    pin("fleet:board", old.board);
    // E5-2: the fleet's fresh board draws the overlay, so Evacuations join its cycles and bring people home.
    const now = fleetHours();
    pin("e5-2:fleet", now.hours);
    pin("e5-2:fleet:previews", now.previews);
    pin("e5-2:fleet:board", now.board);
    expect(now.s.completionLog.some((e) => e.kind === "refugeeArrival")).toBe(true);
  });
});

describe("E5-0 golden 3: every facility stat the eight backgrounds will touch", () => {
  for (const kind of ["low", "mid", "top"] as const) {
    it(`the consumers at the ${kind} fixture`, () => {
      // E5-2: `cyclePlans` samples 20 rolls of a fresh board, so the pin reads them with the Evacuation draw off (the
      // draw's move is golden 1's); every consumer formula here is unchanged.
      pin(`consumers:${kind}`, withEvacuationDrawOff(() => consumers(facilityFixture(kind))));
    });
  }
  it("the telescope's range at every level", () => {
    const top = FACILITIES.subspaceTelescope.upgrades.length;
    pin("telescope:levels", Array.from({ length: top + 1 }, (_, L) => telescopeReadingAtLevel(L).rangeLy));
  });
});

describe("E5-0 golden 4: the wiring registry's ids and statuses", () => {
  it("count and hash, E5's added entries held apart", () => {
    const added = new Set(E5_ADDED_ENTRY_IDS);
    const lines = WIRING_REGISTRY.filter((e) => !added.has(e.id)).map((e) => `${e.id}|${e.status.kind}`);
    pin("registry", [lines.length, hash(lines)]);
  });
});

describe("E5-0 golden 5: the fleet's v70 save through deserialize + migrate, then six hours", () => {
  // The fleet as a v70 build saved it, through the v70 -> v71 step and six hours.
  function oldSaveHours(): { hours: string[]; previews: string[]; loaded: GameState; s: GameState } {
    // E5-1: serialize writes v71 now; the save a v70 build wrote is the same state under version 70 (the fleet holds
    // no field v71 added), so the v70 -> v71 step runs on it as it will on a player's save. The fleet is built with the
    // Evacuation draw off: a v70 build could never have rolled one.
    const fleet = withEvacuationDrawOff(shortRangeFleet);
    const save = { ...(deserialize(serialize(fleet, 0, SAVED_AT_MS)) as SaveFile), version: 70 };
    let s = migrate(save, MIGRATE_ENTROPY);
    const loaded = s;
    // E5-1: the v71 step stamps every slot at its cursor + 1, and the cursor writes carry the stamp unchanged.
    const stampAtLoad = s.shortRangeBoard?.evacuationFrom;
    expect(stampAtLoad).toEqual({ 0: shortRangeNextCycle(s, 0) + 1, 1: 1, 2: 1, 3: 1 });
    const hours = [hash(withoutEvacuationStamp(s))];
    for (let h = 1; h <= 6; h++) {
      s = economyTick(s, HOUR, RNG);
      expect(s.shortRangeBoard?.evacuationFrom).toBe(stampAtLoad);
      hours.push(hash(withoutEvacuationStamp(s)));
    }
    return { hours, previews: previews(s), loaded, s };
  }

  it("the state every hour and every slot's preview", () => {
    // The pins, traced: the game before E5-2 (the Evacuation draw off).
    const old = withEvacuationDrawOff(oldSaveHours);
    pin("old", old.hours);
    pin("old:previews", old.previews);
    // E5-2: every roll before a slot's stamp is the old roll (the job in flight and, for slot 0, its cursor's preview),
    // so the loaded state is unchanged; the overlay starts at each stamp, so the later hours move.
    const now = oldSaveHours();
    const stamps = now.loaded.shortRangeBoard!.evacuationFrom!;
    for (const slot of shortRangeBoardSlots(now.loaded)) {
      for (let c = 0; c < stamps[slot.id]; c++) {
        expect(hash(rollShortRangeJob(now.loaded, slot, c)), `slot ${slot.id} cycle ${c}`).toBe(hash(withEvacuationDrawOff(() => rollShortRangeJob(now.loaded, slot, c))));
      }
    }
    expect(now.hours[0]).toBe(old.hours[0]);
    pin("e5-2:old", now.hours);
    pin("e5-2:old:previews", now.previews);
  });
});

describe("E5-0 golden 6: the short-range Help topic and the board's job types list", () => {
  it("the topic text and the type rows (fresh, and after the fleet's six hours)", () => {
    const topic = HELP_TOPICS.find((t) => t.id === "shortRange");
    expect(topic).toBeDefined();
    const types = shortRangeTypeRows(freshState()).map((r) => `${r.template}|${r.label}|${r.icon}|${r.status}|${r.uses.map((u) => u.category).join(",")}`);
    // The pins, traced: E5-2 adds the Evacuation job line to the topic and the eighth row to the job types; with them
    // taken out, both are the old pins.
    const evacLine = topic!.body.split("\n").find((l) => l.startsWith("- Evacuation ("));
    expect(evacLine).toBeDefined();
    pin("help:shortRange", hash({ ...topic, body: topic!.body.replace(`\n${evacLine}`, "") }));
    pin("types:fresh", types.filter((t) => !t.startsWith("evacuation|")));
    pin("e5-2:help:shortRange", hash(topic));
    pin("e5-2:types:fresh", types);
  });
});

describe.runIf(CAPTURE)("E5-0 capture (E5_CAPTURE = an output path): write the goldens there", () => {
  it("writes", () => {
    writeFileSync(String(import.meta.env.E5_CAPTURE), JSON.stringify(captured, null, 2));
  });
});
