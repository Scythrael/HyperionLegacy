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
//
// E5-3 (a delivered Refugee Relocation takes the longest-waiting refugee along): the `e5-2:` pins keep their values and
// are checked with the farewell OFF (refugeeFarewellSwitch.fixture.ts withRefugeeFarewellOff: the game before E5-3
// exactly), which traces every move; beside each moved pin an `e5-3:` pin records the new value with it ON.
//   golden 2  the fleet's Evacuations bring people home and slot 0's Repeat Relocations then take them along
//             (`e5-3:fleet`); the board and the previews do not move (no draw is taken).
//   golden 5  the same from each slot's stamp on (`e5-3:old`); hour 0 and the previews unchanged. The draw-off pins
//             (`fleet`, `old`) do not move: with no Evacuation nobody is ever waiting, so a Relocation runs as before.
//   goldens 1, 3, 4 and 6 unchanged.
//
// The short-range slow-start parity fix (shortRangeCycle.ts tickShortRangeFleet: a call longer than one tick advances
// two or more short-range runs together, so each cycle start reads the counters 1 s steps would have left): goldens 2
// and 5 step four captains on a fresh ramp in one-HOUR calls, so they move. Every earlier pin keeps its value and is
// checked with the fix OFF (shortRangeFleetSwitch.fixture.ts withShortRangeFleetOff: the game before the fix exactly);
// the `srfix:` pins record the new values with it ON. No production path moves: live play and the offline catch-up
// both step economyTick(state, 1), which never takes the joint path. Goldens 1, 3, 4 and 6 unchanged.
//
// E5-4 (the facility buffs a posted refugee gives): NO existing pin moves. Nothing on the tick posts anyone, so every
// fixture here (and every old save) has nobody posted, every buff reads 0 and each seam takes its old path. Golden 4
// holds the sixteen new registry rows apart (E5_ADDED_ENTRY_IDS). The new `e5-4:consumers:*` pins (golden 3b) read the
// eight seams with every refugee facility staffed; traced with the buffs OFF (refugeeBuffsSwitch.fixture.ts
// withRefugeeBuffsOff), where they read the unstaffed values, which are golden 3's own pins.

// The ordering determinism slice (canonicalOrder.ts: `discovered` and the lifetime tally maps kept in canonical order)
// came after every pin here: the file runs with it off (orderingSwitch.fixture.ts), so its pins keep proving their own
// slice (orderingGoldens.test.ts pins the order move and proves it moved order only).
import { canonicalOrderOffForThisFile, withCanonicalOrderOn } from "./orderingSwitch.fixture";
canonicalOrderOffForThisFile();
import { describe, expect, it } from "vitest";
// WR-8b (enemy torpedoes) came after every pin here: the file runs with it off (enemyTorpedoSwitch.fixture.ts), so its
// pins keep proving their own slice (enemyTorpedoGoldens.test.ts pins what WR-8b moved, enemyTorpedoes.test.ts proves it).
import { enemyTorpedoesOffForThisFile } from "./enemyTorpedoSwitch.fixture";
enemyTorpedoesOffForThisFile();
import { gw5ReadBack } from "./gearWearStep5Registry.fixture"; // Gear wear step 5: its deleted and flipped rows read back, innermost
import { otUiReadBack } from "./otUiRegistry.fixture"; // OT-UI: the Overtime row restated, read back innermost
import { cp16OffForThisFile } from "./cp16Switch.fixture";
// Complement CP-19: this file's pins predate the Personnel Rosters track (a new game's facility map gains its
// pre-granted Level 1), so it runs with the slice off; cp19Goldens.test.ts pins the slice itself.
import { cp19OffForThisFile } from "./cp19Switch.fixture";
cp19OffForThisFile();
// Complement CP-16 (the Hall of Command) came after every pin here: the file runs with the slice off, so its pins
// keep proving their own slice (cp16Goldens.test.ts pins what CP-16 moved: the missions counter, the notables and
// the Hall of Command entry).
cp16OffForThisFile();
import { cp13ReadBack } from "./cp13Registry.fixture"; // Complement CP-13: its added rows read back, innermost
import { cp14ReadBack } from "./cp14Registry.fixture"; // Complement CP-14: its added, flipped and moved rows read back, innermost
import { cp16ReadBack } from "./cp16Registry.fixture"; // Complement CP-16: its added Hall of Command rows read back, innermost
import { cp18ReadBack } from "./cp18Registry.fixture";
import { cp19ReadBack } from "./cp19Registry.fixture";
// Material Lines ML-5: its two added audit rows held apart (ml5Goldens.test.ts pins the slice).
import { ml5ReadBack } from "./ml5Registry.fixture";
// Wiring WR-10 flipped twelve away rows after every pin here (wr10Registry.fixture.ts): read back innermost.
import { wr10ReadBack } from "./wr10Registry.fixture";
import { wr13ReadBack } from "./wr13Registry.fixture";
// WR-8b (enemy torpedoes) came after these pins: its registry rows are read back innermost.
import { wr8bReadBack } from "./wr8bRegistry.fixture";
// Wiring OC-G1 (the legacy expedition path deleted) came after these pins: its registry read-back applies innermost.
import { ocg1ReadBack } from "./ocg1Registry.fixture";
// Complement CP-4's rest (the Flight Deck's Integrity on replenish) added one audit row after every pin here: read back innermost.
import { cp4FdReadBack } from "./cp4FlightDeckRegistry.fixture";
import { g29ReadBack } from "./g29Registry.fixture";
import { ocf14ReadBack } from "./ocf14Registry.fixture"; // OC-F14: the field repair order row read back to pending, innermost
import { relicContentReadBack } from "./relicContentRegistry.fixture"; // Relics v2 R2-6 / R2-7: three rows read back, innermost
import { generalPickReadBack } from "./relicGeneralPickRegistry.fixture"; // Relics v2 R2-3 follow-up: the retired generalPick row read back, innermost
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
// E5-3: the Relocation farewell's test-only off switch (the pre-E5-3 game), tracing every moved pin.
import { withRefugeeFarewellOff } from "./refugeeFarewellSwitch.fixture";
import { withEchoRefugeesOff } from "./refugeeEchoSwitch.fixture"; // E5-6b: the echo refugees off (the game before E5-6b)
import { E5_2_ADDED_ENTRY_IDS, E5_4_ADDED_ENTRY_IDS } from "./refugeeRegistry.fixture";
// The short-range slow-start parity fix: its test-only off switch (the game before the fix), tracing every moved pin.
import { withShortRangeFleetOff } from "./shortRangeFleetSwitch.fixture";
// E5-4: the facility buffs' test-only off switch (the pre-E5-4 game), the posting fixture and the seams golden 3b reads.
import { withRefugeeBuffsOff } from "./refugeeBuffsSwitch.fixture";
import { REFUGEE_BACKGROUNDS, REFUGEE_BACKGROUND_KEYS } from "./refugees";
import { refugeeShortRangePlan } from "./refugeeBuffs";
import { fabricateDurationTicks, researchSpeedFor, startProcess } from "./tick";
import { dispatchRun, withRefugeePosted } from "./wiring/probes";
import { CP11_BLUEPRINT_KEYS } from "./cp11BlueprintsSwitch.fixture";
import { CP11_ADDED_ENTRY_IDS } from "./cp11Registry.fixture";
import { cp12ReadBack } from "./cp12Registry.fixture";
import { CP12_HELP_EDITS, cp12HelpReadBack } from "./cp12Switch.fixture";
import { CP13_HELP_EDITS, cp13HelpReadBack } from "./cp13Switch.fixture";
// Homeworld reserve (user 2026-11-12; homeworldReserve.ts): this file's pins were captured before the reserve and hash a
// fleet whose surplus crew the reserve now moves out of the pool, so the whole file runs with it off and its pins keep
// proving their own slice (switch-off reproduction: every pin holds with it off). homeworldReserveGoldens pins the reserve.
import { homeworldReserveOffForThisFile } from "./homeworldReserveSwitch.fixture";
homeworldReserveOffForThisFile();

// The wiring registry entries E5 adds (E5-4 fills it). Held apart from golden 4, so that pin proves nothing else moved.
// E5-2: the Evacuation template's three rows (the template catalog loop, registry.ts; refugeeRegistry.fixture.ts).
// E5-4: the sixteen refugee post rows (refugeeRegistry.fixture.ts).
export const E5_ADDED_ENTRY_IDS: readonly string[] = [...E5_2_ADDED_ENTRY_IDS, ...E5_4_ADDED_ENTRY_IDS];

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
// Complement CP-11 came after this capture: its fifteen crew module and sensor array blueprints are held apart from the
// research and fabricate readings (cp11BlueprintsSwitch.fixture.ts), so they keep proving every formula is unchanged.
const blueprintsBeforeCp11 = () => Object.entries(BLUEPRINTS).filter(([k]) => !CP11_BLUEPRINT_KEYS.has(k));
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
    research: hash(blueprintsBeforeCp11().map(([k, bp]) => [k, museumResearchDurationTicks(bp.researchDurationTicks, museumSpeed)])),
    relicStudy: STUDY_TIERS.map((t) => museumResearchDurationTicks(relicStudyDurationTicks(t), museumSpeed)),
    fabricate: hash(blueprintsBeforeCp11().map(([k, bp]) => [k, bp.craftDurationTicks])),
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
  "e5-7:help:shortRange": "8960cfe1",
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
  // E5-3 (the Relocation farewell): the moved pins' new values, captured with the farewell on (see the header).
  "e5-3:fleet": ["766005", "49335167", "77602096", "562044af", "cb3fb2c1", "d6c0aba7", "a75266bd"],
  "e5-3:old": ["766005", "49335167", "77602096", "562044af", "cb3fb2c1", "d6c0aba7", "a75266bd"],
  // The slow-start parity fix: the moved pins' new values, captured with the fix on (see the header). Slot 0's cursor
  // reads 154 (157 before): its cycle starts now see the other three runs' earlier deliveries on the shared ramp.
  "srfix:fleet": ["766005", "595b2ef0", "aeb9c2c4", "2ce48141", "92f4c0ff", "7437f00f", "585cc328"],
  "srfix:fleet:previews": ["ce47edc0", "deaf482e", "d0fe0d97", "6680b6d7"],
  "srfix:fleet:board": {"version": 1, "nextCycle": {"0": 154, "1": 150, "2": 85, "3": 91}},
  "srfix:old": ["766005", "595b2ef0", "aeb9c2c4", "2ce48141", "92f4c0ff", "7437f00f", "585cc328"],
  "srfix:old:previews": ["ce47edc0", "deaf482e", "d0fe0d97", "6680b6d7"],
  // E5-6b (echo refugees): goldens 2 and 5 with the echoes live; every earlier pin above is traced with them off
  // (refugeeEchoSwitch.fixture.ts withEchoRefugeesOff). Hour 0, the board and the previews do not move.
  "e5-6b:fleet": ["766005", "7112415c", "cfe8fe3b", "bb4ee4d8", "3621ab92", "e158ec8e", "f749ace9"],
  "e5-6b:old": ["766005", "7112415c", "cfe8fe3b", "bb4ee4d8", "3621ab92", "e158ec8e", "f749ace9"],
  // E5-4 (golden 3b): the eight seams with every refugee facility staffed (one matched person each, skill 50).
  // E5-4 fix round ("Carry the fractions"): cyclePlans moved a071a4f4 -> 5beb196c (each cycle plan now pays its
  // phases' rounding forward from phase to phase); traced: with the buffs off it still reads golden 3's own pin.
  "e5-4:consumers:low": {"refineExtra": 8, "research": "a9803a86", "relicStudy": [573, 860, 1146, 1719, 1719, 1719], "fabricate": "d96eec13", "build": [286.3353450309967, 668.1158050723257, 429.503017546495, 524.9481325568273, 572.6706900619934, 1145.3413801239867, 1097.6188226188206, 954.4511501033223, 906.7285925981562, 1049.8962651136546], "salvage": [1.047722557505166, 0.31431676725154983, 0.340509831189179, 0.3667028951268081, 0.3928959590644373, 0.41898425074631596], "fleetReachBonus": 0.09772255750516612, "range": "3753dbec", "discoveryBias": [0.047722557505166116, 0.047722557505166116], "cyclePlans": "5beb196c"},
  "e5-4:consumers:mid": {"refineExtra": 8, "research": "a9803a86", "relicStudy": [573, 860, 1146, 1719, 1719, 1719], "fabricate": "d96eec13", "build": [95.44511501033223, 222.70526835744187, 143.16767251549834, 174.98271085227574, 190.89023002066446, 381.7804600413289, 365.8729408729402, 318.15038336777405, 302.2428641993854, 349.9654217045515], "salvage": [1.047722557505166, 0.31431676725154983, 0.340509831189179, 0.3667028951268081, 0.3928959590644373, 0.41898425074631596], "fleetReachBonus": 0.24772255750516614, "range": "27515647", "discoveryBias": [0.047722557505166116, 0.047722557505166116], "cyclePlans": "5beb196c"},
  "e5-4:consumers:top": {"refineExtra": 8, "research": "a9803a86", "relicStudy": [573, 860, 1146, 1719, 1719, 1719], "fabricate": "d96eec13", "build": [95.44511501033223, 222.70526835744187, 143.16767251549834, 174.98271085227574, 190.89023002066446, 381.7804600413289, 365.8729408729402, 318.15038336777405, 302.2428641993854, 349.9654217045515], "salvage": [1.047722557505166, 0.31431676725154983, 0.340509831189179, 0.3667028951268081, 0.3928959590644373, 0.41898425074631596], "fleetReachBonus": 0.4977225575051661, "range": "c0d4f00e", "discoveryBias": [0.047722557505166116, 0.047722557505166116], "cyclePlans": "5beb196c"},
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
    // Every pin before the slow-start parity fix is traced with the fix off (the header).
    // E5-6b: every pin before the echo refugees is traced with the echoes off (withEchoRefugeesOff, the game before
    // E5-6b); the echoes' own pin is the last one.
    const preFix = <T,>(run: () => T): T => withShortRangeFleetOff(() => withEchoRefugeesOff(run));
    const old = preFix(() => withEvacuationDrawOff(fleetHours));
    pin("fleet", old.hours);
    pin("fleet:previews", old.previews);
    pin("fleet:board", old.board);
    // E5-2: the fleet's fresh board draws the overlay, so Evacuations join its cycles and bring people home. Traced with
    // the E5-3 farewell off (the game before E5-3).
    const e52 = preFix(() => withRefugeeFarewellOff(fleetHours));
    pin("e5-2:fleet", e52.hours);
    pin("e5-2:fleet:previews", e52.previews);
    pin("e5-2:fleet:board", e52.board);
    expect(e52.s.completionLog.some((e) => e.kind === "refugeeArrival")).toBe(true);
    // E5-3: slot 0's Repeat Relocations take the waiting people along; no draw is taken, so the board and the previews
    // stay the E5-2 pins.
    const now = preFix(fleetHours);
    pin("e5-3:fleet", now.hours);
    expect(now.previews).toEqual(e52.previews);
    expect(now.board).toEqual(e52.board);
    expect(now.s.completionLog.some((e) => e.kind === "refugeeFarewell")).toBe(true);
    // The slow-start parity fix: the four runs share the fresh ramp, so the hour calls now read the counters in the
    // order 1 s steps do; hour 0 is the same state.
    const fixed = withEchoRefugeesOff(fleetHours);
    expect(fixed.hours[0]).toBe(now.hours[0]);
    pin("srfix:fleet", fixed.hours);
    pin("srfix:fleet:previews", fixed.previews);
    pin("srfix:fleet:board", fixed.board);
    // E5-6b: about 1 in 50 arrivals is an echo refugee (their roster name and background); the fleet's Evacuations bring
    // at least one home in the six hours, so the hours move from the first echo on. No draw moves: hour 0, the board and
    // the previews are the parity fix's pins.
    const echoes = fleetHours();
    expect(echoes.hours[0]).toBe(fixed.hours[0]);
    expect(echoes.previews).toEqual(fixed.previews);
    expect(echoes.board).toEqual(fixed.board);
    expect(echoes.s.refugees?.echoes?.length ?? 0).toBeGreaterThan(0);
    pin("e5-6b:fleet", echoes.hours);
    // ...and the new hour-1 state IS the live game's: 3600 one-second steps land on the same state, compared STRICT
    // (the whole JSON, no key order or list normalized). This file runs with the ordering slice off for its pins, so
    // the comparison runs with it on: canonicalOrder.ts keeps `discovered`, the tallies and the inventory's keys in one
    // order however the hour is cut (with it off one call meets the captains' first finds in captain map order).
    const [live, once, unfixed] = withCanonicalOrderOn(() => {
      let stepped = shortRangeFleet();
      for (let t = 0; t < HOUR; t++) stepped = economyTick(stepped, 1, RNG);
      return [
        JSON.stringify(stepped),
        JSON.stringify(economyTick(shortRangeFleet(), HOUR, RNG)),
        JSON.stringify(preFix(() => economyTick(shortRangeFleet(), HOUR, RNG))),
      ];
    });
    expect(live).toBe(once);
    expect(live).not.toBe(unfixed);
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

// E5-4 (the facility buffs): golden 3 read through the eight seams E5-4 folds a posted refugee into, on the same three
// fixtures, with every refugee facility staffed (one matched person each, skill 50, the facility built). Traced: with the
// buffs OFF (refugeeBuffsSwitch.fixture.ts withRefugeeBuffsOff, the game before E5-4) the staffed fixture reads exactly
// the unstaffed one, and the unstaffed one reads golden 3's own pinned values (the seams are the identity at b = 0).
function staffedFixture(kind: LevelFixture): GameState {
  let s = facilityFixture(kind); // every refugee facility is at Level 1 or above in all three fixtures
  for (const f of REFUGEE_FACILITIES) {
    const bg = REFUGEE_BACKGROUND_KEYS.find((b) => REFUGEE_BACKGROUNDS[b].facility === f)!;
    s = withRefugeePosted(s, bg, f, 50);
  }
  return s;
}

function consumersE54(s: GameState): Record<string, unknown> {
  const museumSpeed = museumBonuses(s).researchSpeed;
  const vet = veteranCounts(s);
  const ship = { ...vet.ships[0], typeKey: "generalFreighter" as ShipTypeKey };
  const vetShip = { ...vet, ships: [ship, ...vet.ships.slice(1)] };
  const stats = effectiveShipStats(vetShip, ship);
  const eng = shortRangeShipEngineering(vetShip, ship);
  const plans = [0, 2].flatMap((slotId) =>
    Array.from({ length: 10 }, (_, c) => {
      const roll = rollShortRangeJob(vetShip, { id: slotId, tier: slotId === 0 ? 1 : 2 }, c);
      return [roll.template, refugeeShortRangePlan(vetShip, shortRangeCyclePlan(roll, stats, eng)).plan]; // each a run's first cycle (carry 0)
    }),
  );
  // The Refiner: 200 real refine jobs from process 1 (startProcess stamps), the extra batches they deliver.
  let jobs: GameState = { ...s, activeProcesses: [], nextProcessId: 1 };
  let extra = 0;
  for (let i = 0; i < 200; i++) {
    const r = startProcess(jobs, "refineJob", {}, 12, { type: "addItem", itemId: "titaniumIngot", amount: new Decimal(1) });
    if (r.next.activeProcesses.at(-1)?.bonusOutput) extra += 1;
    jobs = { ...r.next, activeProcesses: [] };
  }
  return {
    refineExtra: extra,
    research: hash(blueprintsBeforeCp11().map(([k, bp]) => [k, museumResearchDurationTicks(bp.researchDurationTicks, researchSpeedFor(s, museumSpeed))])),
    relicStudy: STUDY_TIERS.map((t) => museumResearchDurationTicks(relicStudyDurationTicks(t), researchSpeedFor(s, museumSpeed))),
    fabricate: hash(blueprintsBeforeCp11().map(([k, bp]) => [k, fabricateDurationTicks(s, bp.craftDurationTicks)])),
    build: HULLS.map((h) => shipBuildDurationTicks(s, h)),
    salvage: [salvageYieldMult(s), ...[0, 0.25, 0.5, 0.75, 0.999].map((d) => hullTeardownFraction(s, d))],
    fleetReachBonus: fleetReachBonus(s),
    range: hash(HULLS.map((h) => shipRangeLightYears(s, { ...s.ships[0], typeKey: h }))),
    discoveryBias: [dispatchRun(s).scanParams.landmarkOddsBias, dispatchRun(s).scanParams.undergroundPoiOddsBias],
    cyclePlans: hash(plans),
  };
}

describe("E5-4 golden 3b: the consumers with every refugee facility staffed", () => {
  for (const kind of ["low", "mid", "top"] as const) {
    it(`the staffed consumers at the ${kind} fixture`, () => {
      // Golden 3's cycle plans sample a fresh board's rolls with the Evacuation draw off; so do these.
      const staffed = withEvacuationDrawOff(() => consumersE54(staffedFixture(kind)));
      const bare = withEvacuationDrawOff(() => consumersE54(facilityFixture(kind)));
      // The trace: the buffs off read the unstaffed values, and those are golden 3's own pins.
      expect(withRefugeeBuffsOff(() => withEvacuationDrawOff(() => consumersE54(staffedFixture(kind))))).toEqual(bare);
      if (!CAPTURE) {
        const old = GOLDEN[`consumers:${kind}`] as Record<string, unknown>;
        for (const k of ["research", "relicStudy", "fabricate", "build", "salvage", "fleetReachBonus", "range", "cyclePlans"] as const) expect(bare[k], k).toEqual(old[k]);
        expect(bare.refineExtra).toBe(0);
        expect(bare.discoveryBias).toEqual([0, 0]);
      }
      pin(`e5-4:consumers:${kind}`, staffed);
    });
  }
});

describe("E5-0 golden 4: the wiring registry's ids and statuses", () => {
  it("count and hash, E5's added entries held apart", () => {
    // Complement CP-11's rows (cp11Registry.fixture.ts) came after and are held apart the same way.
    const added = new Set([...E5_ADDED_ENTRY_IDS, ...CP11_ADDED_ENTRY_IDS]);
    // Complement CP-12's flip of the obtainable row came after too (cp12ReadBack puts it back).
    const lines = cp12ReadBack(cp13ReadBack(cp14ReadBack(cp16ReadBack(cp18ReadBack(cp19ReadBack(gw5ReadBack(ml5ReadBack(otUiReadBack(wr10ReadBack(wr13ReadBack(wr8bReadBack(ocg1ReadBack(cp4FdReadBack(g29ReadBack(ocf14ReadBack(relicContentReadBack(generalPickReadBack(WIRING_REGISTRY)))))))))))))))))).filter((e) => !added.has(e.id)).map((e) => `${e.id}|${e.status.kind}`);
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
    // Every pin before the slow-start parity fix is traced with the fix off (the header).
    // E5-6b: every pin before the echo refugees is traced with the echoes off (the game before E5-6b).
    const preFix = <T,>(run: () => T): T => withShortRangeFleetOff(() => withEchoRefugeesOff(run));
    const old = preFix(() => withEvacuationDrawOff(oldSaveHours));
    pin("old", old.hours);
    pin("old:previews", old.previews);
    // E5-2: every roll before a slot's stamp is the old roll (the job in flight and, for slot 0, its cursor's preview),
    // so the loaded state is unchanged; the overlay starts at each stamp, so the later hours move.
    const now = preFix(oldSaveHours);
    const stamps = now.loaded.shortRangeBoard!.evacuationFrom!;
    for (const slot of shortRangeBoardSlots(now.loaded)) {
      for (let c = 0; c < stamps[slot.id]; c++) {
        expect(hash(rollShortRangeJob(now.loaded, slot, c)), `slot ${slot.id} cycle ${c}`).toBe(hash(withEvacuationDrawOff(() => rollShortRangeJob(now.loaded, slot, c))));
      }
    }
    expect(now.hours[0]).toBe(old.hours[0]);
    // E5-2, traced with the E5-3 farewell off (the game before E5-3).
    const e52 = preFix(() => withRefugeeFarewellOff(oldSaveHours));
    pin("e5-2:old", e52.hours);
    pin("e5-2:old:previews", e52.previews);
    // E5-3: the farewell moves the hours after the first Relocation that finds someone waiting; hour 0 and the previews
    // do not move.
    expect(now.hours[0]).toBe(e52.hours[0]);
    expect(now.previews).toEqual(e52.previews);
    pin("e5-3:old", now.hours);
    // The slow-start parity fix: the loaded save (hour 0) is the same state; the hour calls move as golden 2's do.
    const fixed = withEchoRefugeesOff(oldSaveHours);
    expect(fixed.hours[0]).toBe(now.hours[0]);
    pin("srfix:old", fixed.hours);
    pin("srfix:old:previews", fixed.previews);
    // E5-6b: the loaded save (hour 0) and the previews do not move; the hours move from the first echo arrival on. An
    // old save simply starts rolling echoes on its next arrivals (no stamp: no saved state changes meaning).
    const echoes = oldSaveHours();
    expect(echoes.hours[0]).toBe(fixed.hours[0]);
    expect(echoes.previews).toEqual(fixed.previews);
    expect(echoes.s.refugees?.echoes?.length ?? 0).toBeGreaterThan(0);
    pin("e5-6b:old", echoes.hours);
  });
});

describe("E5-0 golden 6: the short-range Help topic and the board's job types list", () => {
  it("the topic text and the type rows (fresh, and after the fleet's six hours)", () => {
    const live = HELP_TOPICS.find((t) => t.id === "shortRange");
    expect(live).toBeDefined();
    // Complement CP-12's fix round came after these pins: its "Crew Quarters" wording in the GUEST QUARTERS paragraph is
    // read back (cp12HelpReadBack), so every pin here still reads E5 alone. Both edits are in the live body.
    // Complement CP-13's fix round likewise ("more with a better one": the General guest perk scales), read back first.
    for (const [, after] of CP13_HELP_EDITS) expect(live!.body).toContain(after);
    for (const [, after] of CP12_HELP_EDITS) expect(live!.body).toContain(after);
    const topic = { ...live!, body: cp12HelpReadBack(cp13HelpReadBack(live!.body)) };
    const types = shortRangeTypeRows(freshState()).map((r) => `${r.template}|${r.label}|${r.icon}|${r.status}|${r.uses.map((u) => u.category).join(",")}`);
    // The pins, traced: E5-2 adds the Evacuation job line to the topic and the eighth row to the job types; with them
    // taken out, both are the old pins.
    // E5-7 adds the evacuation to the topic's opening job list and a REFUGEES paragraph (the cross-link to the
    // Refugees topic); with both taken out, the body is the E5-2 pin.
    const e57Added = ", evacuate people from a nearby world";
    const refugeesLine = topic!.body.split("\n").find((l) => l.startsWith("REFUGEES: "));
    expect(topic!.body).toContain(e57Added);
    expect(refugeesLine).toBeDefined();
    const e52Body = topic!.body.replace(e57Added, "").replace(`\n${refugeesLine}`, "");
    const evacLine = e52Body.split("\n").find((l) => l.startsWith("- Evacuation ("));
    expect(evacLine).toBeDefined();
    pin("help:shortRange", hash({ ...topic, body: e52Body.replace(`\n${evacLine}`, "") }));
    pin("types:fresh", types.filter((t) => !t.startsWith("evacuation|")));
    pin("e5-2:help:shortRange", hash({ ...topic, body: e52Body }));
    pin("e5-7:help:shortRange", hash(topic));
    pin("e5-2:types:fresh", types);
  });
});

describe.runIf(CAPTURE)("E5-0 capture (E5_CAPTURE = an output path): write the goldens there", () => {
  it("writes", () => {
    writeFileSync(String(import.meta.env.E5_CAPTURE), JSON.stringify(captured, null, 2));
  });
});
