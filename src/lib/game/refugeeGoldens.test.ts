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
import { hash } from "./firstRunsGoldens.fixture";

// The wiring registry entries E5 adds (E5-4 fills it). Held apart from golden 4, so that pin proves nothing else moved.
export const E5_ADDED_ENTRY_IDS: readonly string[] = [];

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

describe("E5-0 golden 1: the short-range board's upcoming draws on existing saves", () => {
  it("rollShortRangeJob for slots 0..3 x cycles 0..63 x three board seeds x two counter states", () => {
    const fresh = withMissionControl(freshState(), 3);
    const seeds: Record<string, number> = {
      fresh: shortRangeBoardSeed(fresh),
      homeworld: shortRangeBoardSeed(freshState(HOMEWORLD_SEED)),
      default: SHORT_RANGE_DEFAULT_SEED,
    };
    expect(seeds.fresh).toBe(SHORT_RANGE_DEFAULT_SEED);
    const counters: Record<string, GameState> = { fresh, veteran: veteranCounts(fresh) };
    for (const [seedName, seed] of Object.entries(seeds)) {
      for (const [countName, state] of Object.entries(counters)) {
        for (const slot of shortRangeBoardSlots(state)) {
          const rolls = Array.from({ length: 64 }, (_, c) => rollShortRangeJob(state, slot, c, seed));
          pin(`draws:${seedName}:${countName}:slot${slot.id}`, hash(rolls));
        }
      }
    }
    // Every template appears, so a moved draw cannot hide behind one template's absence.
    const templates = new Set(Array.from({ length: 64 }, (_, c) => rollShortRangeJob(fresh, { id: 0, tier: 1 }, c).template));
    expect([...templates].sort()).toEqual([...SHORT_RANGE_TEMPLATE_KEYS].sort());
  });
});

describe("E5-0 golden 2: a short-range fleet on Repeat on every slot, six hours", () => {
  it("the whole state every hour, then every slot's preview", () => {
    let s = shortRangeFleet();
    expect(s.captains.find((c) => c.id === 1)?.mission).toMatchObject({ kind: "shortRange", roll: { template: "refugeeRelocation" } });
    const hours = [hash(s)];
    for (let h = 1; h <= 6; h++) {
      s = economyTick(s, HOUR, RNG);
      hours.push(hash(s));
    }
    expect(s.captains.every((c) => c.mission !== null && c.mission.kind === "shortRange")).toBe(true);
    pin("fleet", hours);
    pin("fleet:previews", previews(s));
    pin("fleet:board", s.shortRangeBoard);
  });
});

describe("E5-0 golden 3: every facility stat the eight backgrounds will touch", () => {
  for (const kind of ["low", "mid", "top"] as const) {
    it(`the consumers at the ${kind} fixture`, () => {
      pin(`consumers:${kind}`, consumers(facilityFixture(kind)));
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
  it("the state every hour and every slot's preview", () => {
    const save = deserialize(serialize(shortRangeFleet(), 0, SAVED_AT_MS)) as SaveFile;
    expect(save.version).toBe(70);
    let s = migrate(save, MIGRATE_ENTROPY);
    const hours = [hash(s)];
    for (let h = 1; h <= 6; h++) {
      s = economyTick(s, HOUR, RNG);
      hours.push(hash(s));
    }
    pin("old", hours);
    pin("old:previews", previews(s));
  });
});

describe("E5-0 golden 6: the short-range Help topic and the board's job types list", () => {
  it("the topic text and the type rows (fresh, and after the fleet's six hours)", () => {
    const topic = HELP_TOPICS.find((t) => t.id === "shortRange");
    expect(topic).toBeDefined();
    pin("help:shortRange", hash(topic));
    pin("types:fresh", shortRangeTypeRows(freshState()).map((r) => `${r.template}|${r.label}|${r.icon}|${r.status}|${r.uses.map((u) => u.category).join(",")}`));
  });
});

describe.runIf(CAPTURE)("E5-0 capture (E5_CAPTURE = an output path): write the goldens there", () => {
  it("writes", () => {
    writeFileSync(String(import.meta.env.E5_CAPTURE), JSON.stringify(captured, null, 2));
  });
});
