// G1-0 (Short-Range Missions, docs/plans/2026-10-17-short-range-missions-plan.md section 4 G1-0): golden hashes and
// tables captured on the code BEFORE any short-range engine edit (on top of a678241). They are the "today" record every
// G1 slice compares against: with no short-range dispatch every pin here stays byte-identical, and a slice that moves
// one on purpose (G1-1's quarters affix line is the first) must name the move beside the pin. Whole records, never a
// narrow subset; every whole STATE goes through g1StateHash (no `runCounts`, no `homeworld`, no `shortRangeBoard`),
// so the counters and the board G1-3 adds move nothing by themselves.
//
//   1. fleet    : a mixed fleet (a captain mission on Repeat, a patrol on Repeat, an expedition) advanced six hours
//                 through economyTick, the whole state hashed every hour.
//   2. views    : the Home dashboard and the Ships roster (the Operations pure view helpers) on that fleet at 0, 3
//                 and 6 hours.
//   3. stats    : effectiveShipStats for every hull carrying an Operations and an Engineering complement bucket (so a
//                 quarters module's division multipliers show), bare and with each quarters variety installed (a
//                 derelict piece: implicit lines only, so the affix pool cannot reach it), hashed through statsHash.
//   4. gen      : generateEquipment for the quarters slot at 50 fixed seeds (varieties, rarities, qualities and item
//                 levels cycled), one readable line per seed. Adding an affix to the quarters pool moves these.
//   5. registry : the wiring registry's ids and statuses (hash and count), with the entries a G1 slice adds held
//                 apart (G1_ADDED_ENTRY_IDS), so the base pin proves no existing entry moved.
//   6. old save : a v69 save of the same fleet through deserialize + migrate, its state and every ship's stats.
// Already pinned elsewhere and covered by the same rule: one delivered cycle for every MISSIONS key x every hull
// (firstRunsGoldens.test.ts `gather:*`) and the SF-0 old save (`old:v69` there).
//
// MOVED BY G1-1 (guest quarters), each on purpose; every other pin here is unchanged:
//   gen:quarters   the Crew Quarters pool gained the guest quarters affix (appended, weight 2: total weight 8 -> 10),
//                  so the weighted picks of 46 of the 50 seeds land on other lines, and a guest line is stored in
//                  berths (4 per budget point). GEN_QUARTERS_AT_G1_0 keeps the G1-0 record, and golden 4b proves the
//                  generator reproduces it exactly with the G1-0 pool: the appended affix is the only cause.
//   registry       8 entries ADDED (G1_ADDED_ENTRY_IDS, pinned as `registry:g1`); the base pin is unchanged, so no
//                  existing entry moved.
// MOVED BY G1-2 (templates, sheets and the roll): `registry:g1` gains the 21 short-range template entries (seven
// templates x rolls, work, reward), all pending G1-4; the base pin and every other pin here are unchanged.
// MOVED BY FKR-4 (Field Kits conditions, merged before G1-1): the base `registry` pin moves 1170 -> 1181, entirely
// FKR-4's added and flipped entries (its new condition, severity and inflictor rows, and the rows it flipped live).
// G2-2's registry edits only reword pending owners (pending stays pending), so they hash the same. Then the review
// rulings (user 2026-10-19) flip two entries pending -> live (29f0a757 -> 74fa057, the count unchanged): the Bleed
// status (`away:GAMBIT_STATUSES:bleed`) and its bay row (`away:GROUND_CONDITIONS:bleed`), now that Strikers inflict it.
// MOVED BY CP-8 (graduate, notable cap, manifest; OC-11 pause while out), each on purpose:
//   registry       1181 -> 1182: the pending `crew:audit:notables` row becomes live with its own check, and
//                  `crew:audit:notableIdentityOnly` is added (one row out, two entries in).
//   fleet          hours 1 to 6: OC-11 holds the transport crew for a ship that is out (the freighter on Repeat, the
//                  destroyer on patrol, the Orion on expedition), so those crew wait in the pool. FLEET_BEFORE_OC11
//                  keeps the old record and golden 1 reproduces it with withOc11Off: the pause is the only cause.
//                  The views do not move.
// MOVED BY WR-6 (captain primary, spec, race, Homeworld placeholders): `registry` 93d27465 -> c748495a, the count
// unchanged: nine placeholder entries flip pending -> live (WR6_WIRED_IDS); golden 5 reproduces the old hash with
// those nine read as pending.
// ADDED BY ML-1 (Material Lines items and recipes): 14 registry entries, held apart like G1's (ML1_ADDED_ENTRY_IDS,
// pinned as `registry:ml1`): the seven new Refinery recipes (pending while the Refinery hides them, refineRecipeOffered;
// each reads live by itself once ML-2 gives its output a use) and the seven typed reserves (pending, owned by ML-2 or
// EM-8). No existing entry moved, so the base pin is unchanged.
// MOVED BY FKR-5 (grenade charges), its review rulings (user 2026-10-20) and G2-3 (the voyage engine), re-captured
// once at their integration (0.14.0):
//   registry       1182 c748495a -> 1201 e6523a6f: FKR-5 adds 19 entries and flips Explosives pending -> live; the
//                  rulings hide three of the 19 until FKR-7 (FIELD_KITS_PLAYER_LIVE false: the Impact Grenade
//                  blueprint and the Stun and Toxin carry lines) and add one audit row naming them; G2-3 adds two
//                  audit rows. Every registry check goes through registryPin, the one exclusion helper: with those
//                  slices held apart and the flip read back as pending it reproduces c748495a, and with WR-6 read back
//                  too it reproduces the pin from before WR-6. The registry moves before this one: FKR-4, the
//                  2026-10-19 review rulings (the Bleed flips), CP-8 and WR-6 (above).
// ADDED BY G1-1: `guests:<hull>` (guest quarters bare and with each quarters variety, the Guest Wing last) and
// `stats:<hull>:guestWing` (every other stat with a Guest Wing installed). The sheets hash through withoutGuests, so
// the stats pins keep proving no other stat moved (the transport hulls now carry base guest quarters).

import { describe, expect, it, vi } from "vitest";
import { writeFileSync } from "node:fs";
import Decimal from "break_infinity.js";
import { EQUIPMENT_SLOTS, FIELD_KITS_PLAYER_LIVE, MISSIONS, SHIP_TYPES, type EquipmentInstance, type EquipmentRarity, type GameState, type ShipDerivedStats, type ShipTypeKey } from "./model";
import { dispatchCaptainOnMission, dispatchCaptainOnPatrol, economyTick, installMissingCombatBaselines, mintBuiltShip } from "./tick";
import { startExpedition } from "./expedition";
import { effectiveShipStats } from "./crewOverlay";
import { generateEquipment } from "./itemgen";
import { buildHomeDashboard } from "./homeDashboard";
import { buildShipRoster } from "./shipRoster";
import { deserialize, migrate, serialize, type SaveFile } from "./save";
import { WIRING_REGISTRY } from "./wiring/registry";
import { bucketOf, withBuckets } from "./wiring/probes";
import { hash, onHull, withCrew, withoutGuests } from "./firstRunsGoldens.fixture";
import { asPreG2NamesDispatch } from "./awayTeamTestFixtures";
// CP-8 / OC-11: the test switch that proves the auto-crew pause is the only thing that moved the fleet pin.
vi.mock("./crewLock", async (io) => (await import("./complementOc11Switch.fixture")).oc11CrewLockMock(io));
import { withOc11Off } from "./complementOc11Switch.fixture";

// ===== shared helpers =====

const HULLS = Object.keys(SHIP_TYPES) as ShipTypeKey[];
const RNG = (): number => 0.5;

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// The whole state WITHOUT the fields the G1 slices (and SF-1 / G2-1 before them) add on purpose: the run counters, the
// stored homeworld and the short-range board (G1-3). A no-op for the board today. Pure.
function g1StateHash(state: GameState): string {
  const rest = { ...state } as Record<string, unknown>;
  delete rest.runCounts;
  delete rest.homeworld;
  delete rest.shortRangeBoard;
  return hash(rest);
}

// A ship's derived stats WITHOUT guest quarters (the optional `colonistCapacity` G1-1 makes live), so these pins prove
// every OTHER stat is unchanged; the guest quarters values have their own pins (`guests:<hull>`). Pure.
function statsHash(stats: ShipDerivedStats): string {
  return hash(withoutGuests(stats));
}

// The nine quarters varieties as they stood at G1-0, named literally so a variety added later never shifts which
// variety a seed rolls below.
const QUARTERS_VARIETIES_AT_G1_0 = [
  "quartersSecurityWing",
  "quartersEngineeringWing",
  "quartersScienceWing",
  "quartersMedicalWing",
  "quartersOperationsWing",
  "quartersFlightDeckWing",
  "quartersUtilitarian",
  "quartersEfficient",
  "quartersElite",
] as const;

// Install `piece` on `shipId` (the slot is a singleton: nothing else of its slot is on the ship in these fixtures).
function withPiece(state: GameState, piece: EquipmentInstance, shipId: string): GameState {
  return { ...state, equipment: [...state.equipment, { ...piece, fittedToShipId: shipId }] };
}

// A derelict quarters piece of `variety` (no affixes: only the implicit lines, which the affix pool cannot reach).
function derelictQuarters(variety: string, id: string): EquipmentInstance {
  return generateEquipment({
    slotType: "quarters",
    varietyKey: variety,
    blueprintKey: null,
    iLevel: 10,
    quality: 0,
    rarity: "derelict",
    ascension: "none",
    rng: RNG,
    allocateId: () => id,
  });
}

// ===== the mixed fleet =====

const MAX_UNLOCK = Math.max(...Object.values(MISSIONS).map((m) => m.unlockLevel));

// ship-1 an Orion with a rank 3 crew (the expedition, captain 1), ship-2 a General Freighter (a captain mission on
// Repeat, captain 2), ship-3 a Destroyer (a patrol on Repeat, captain 3). Mission Control at the highest unlock and the
// stores full of credits, so nothing refuses on what this golden is not about.
function mixedFleet(): GameState {
  const crewed = withCrew(onHull("orion"), "rank3");
  const cap1 = crewed.captains[0];
  // The two extra hulls are minted the way the Shipyard mints a build (Standard Issue on every live slot).
  let acc = { ships: crewed.ships, nextShipId: crewed.nextShipId, equipment: crewed.equipment, nextEquipmentId: crewed.nextEquipmentId };
  const freighter = mintBuiltShip(acc, "generalFreighter");
  acc = freighter;
  const destroyer = mintBuiltShip(acc, "destroyer");
  const captainOf: Record<string, number> = { [freighter.shipId]: 2, [destroyer.shipId]: 3 };
  const fleet: GameState = installMissingCombatBaselines({
    ...crewed,
    credits: new Decimal(1_000_000_000),
    facilities: { ...crewed.facilities, missionControl: { ...crewed.facilities.missionControl, level: MAX_UNLOCK } },
    ships: destroyer.ships.map((sh) => (captainOf[sh.id] === undefined ? sh : { ...sh, assignedCaptainId: captainOf[sh.id] })),
    nextShipId: destroyer.nextShipId,
    equipment: destroyer.equipment,
    nextEquipmentId: destroyer.nextEquipmentId,
    captains: [
      { ...cap1, level: 10 },
      { ...cap1, id: 2, label: "Second", level: 10 },
      { ...cap1, id: 3, label: "Third", level: 10 },
    ],
  });
  // G2-2: the dispatch as it was before G2-2 (the console names and region fields stripped), so the pins hold.
  const exp = asPreG2NamesDispatch(startExpedition(fleet, "ship-1", 1, "cand-0"));
  if (!exp.success) throw new Error(`expedition refused: ${exp.reason}`);
  const mission = dispatchCaptainOnMission(exp.next, 2, "shortOreRun");
  if (!mission.success) throw new Error(`mission refused: ${mission.reason}`);
  const patrol = dispatchCaptainOnPatrol(mission.next, 3, "crimsonReaverSweep", "balanced", true);
  if (!patrol.success) throw new Error(`patrol refused: ${patrol.reason}`);
  return patrol.next;
}

const HOUR = 3600;
const ROSTER_OPTS = { sortKey: "attention", filterKey: "all", searchText: "", favorites: new Set<string>() } as const;

function views(s: GameState): string[] {
  return [hash(buildHomeDashboard(s)), hash(buildShipRoster(s, { ...ROSTER_OPTS, favorites: new Set<string>() }))];
}

// ===== the goldens =====

// Captured on a678241 (feat/crew-0.14.0), before any G1 engine edit. Line layouts: fleet = [start, hour 1 .. hour 6]
// state hashes; views = per checkpoint [home, roster]; stats:<hull> = [bare, then each QUARTERS_VARIETIES_AT_G1_0
// variety installed]; gen:quarters = one line per seed; registry = [count, hash] of the entries outside
// G1_ADDED_ENTRY_IDS; old = [state, then each ship's stats].
const GOLDEN: Record<string, unknown> = {
  "fleet": ["aa94ddcd", "56ea6bfc", "9e282be3", "41544d1e", "cccaec70", "f73efc26", "583cf72c"],
  "views": [["a78ec59d", "f4663cfa"], ["c4d89f65", "f4663cfa"], ["d17143e7", "f4663cfa"]],
  "stats:generalFreighter": ["4ec6953b", "a23b4064", "64c2af9f", "a23b4064", "a23b4064", "adc17d60", "a23b4064", "7d4cb65c", "4cb04650", "be1d595e"],
  "stats:prospectorHauler": ["dab172af", "4c6d2883", "e7aa301f", "4c6d2883", "4c6d2883", "e795f0e6", "4c6d2883", "a1875eb0", "ec014cd9", "8c4400cf"],
  "stats:prospectorRunner": ["b800f591", "d8f1dbc7", "bbc001a6", "d8f1dbc7", "d8f1dbc7", "4f50d62e", "d8f1dbc7", "f563b320", "6816dbdf", "d4a28dc3"],
  "stats:prospectorMiner": ["b8a60abf", "11d1dfb7", "6c436790", "11d1dfb7", "11d1dfb7", "60ce6075", "11d1dfb7", "8b42c18c", "3904fab2", "a2014a1b"],
  "stats:destroyer": ["3d40bb7a", "f728345c", "52394197", "f728345c", "f728345c", "5770fb9a", "f728345c", "195a282f", "bfeb6df9", "78a70374"],
  "stats:battleship": ["246f2c62", "ce0e2391", "b3fab6f4", "ce0e2391", "ce0e2391", "12d5eca0", "ce0e2391", "5e8b95e", "b3e3dae7", "5b6570e8"],
  "stats:carrier": ["67cd439e", "dec91223", "48df020c", "dec91223", "dec91223", "9544b23c", "dec91223", "b9fcb13b", "cbaad9cb", "b0c9ff28"],
  "stats:orion": ["859f2c75", "ec74deed", "b55917c9", "ec74deed", "ec74deed", "2cc7074a", "ec74deed", "f800d632", "a2037617", "d24d5073"],
  "stats:aurora": ["59fc8c38", "d52a9ba3", "dc065a95", "d52a9ba3", "d52a9ba3", "6bf9671a", "d52a9ba3", "11b7d999", "f5eae818", "727da0bf"],
  "stats:eir": ["f48e6005", "692728ff", "9330a43b", "692728ff", "692728ff", "13923d66", "692728ff", "aaf5508c", "f3a3b171", "9a5833b0"],
  "stats:generalFreighter:guestWing": "4ec6953b",
  "guests:generalFreighter": [20, 22, 22, 22, 22, 22, 22, 22, 22, 22, 66],
  "stats:prospectorHauler:guestWing": "dab172af",
  "guests:prospectorHauler": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 40],
  "stats:prospectorRunner:guestWing": "b800f591",
  "guests:prospectorRunner": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 40],
  "stats:prospectorMiner:guestWing": "b8a60abf",
  "guests:prospectorMiner": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 40],
  "stats:destroyer:guestWing": "3d40bb7a",
  "guests:destroyer": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 40],
  "stats:battleship:guestWing": "246f2c62",
  "guests:battleship": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 40],
  "stats:carrier:guestWing": "67cd439e",
  "guests:carrier": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 40],
  "stats:orion:guestWing": "859f2c75",
  "guests:orion": [40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 80],
  "stats:aurora:guestWing": "59fc8c38",
  "guests:aurora": [40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 80],
  "stats:eir:guestWing": "f48e6005",
  "guests:eir": [80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 120],
  "gen:quarters": [
    "1:quartersEngineeringWing:augmented:q1:iL8:{\"crewStations\":12}:{\"crewStations\":6}:m0:quartersEngineeringWing",
    "2:quartersScienceWing:stellar:q2:iL15:{\"crewStations\":28}:{\"colonistCapacity\":36,\"crewEfficiency\":9}:m0:quartersScienceWing",
    "3:quartersMedicalWing:radiant:q3:iL22:{\"crewStations\":51}:{\"colonistCapacity\":68,\"crewStations\":17}:m0:quartersMedicalWing",
    "4:quartersOperationsWing:standard:q4:iL29:{\"crewStations\":49}:{\"colonistCapacity\":100}:m0:quartersOperationsWing",
    "5:quartersFlightDeckWing:augmented:q5:iL36:{\"crewStations\":77}:{\"crewStations\":38,\"colonistCapacity\":152}:m0:quartersFlightDeckWing",
    "6:quartersUtilitarian:stellar:q0:iL3:{\"crewStations\":5}:{\"colonistCapacity\":8,\"crewStations\":2,\"crewEfficiency\":2}:m0:quartersUtilitarian",
    "7:quartersEfficient:radiant:q1:iL10:{\"crewStations\":19}:{\"colonistCapacity\":24,\"crewStations\":6,\"crewEfficiency\":6}:m0:quartersEfficient",
    "8:quartersElite:standard:q2:iL17:{\"crewStations\":24}:{\"colonistCapacity\":48,\"crewStations\":12}:m0:quartersElite",
    "9:quartersSecurityWing:augmented:q3:iL24:{\"crewStations\":42}:{\"crewStations\":21,\"colonistCapacity\":84}:m0:quartersSecurityWing",
    "10:quartersEngineeringWing:stellar:q4:iL31:{\"crewStations\":69}:{\"colonistCapacity\":92,\"crewStations\":23,\"crewEfficiency\":23}:m0:quartersEngineeringWing",
    "11:quartersScienceWing:radiant:q5:iL38:{\"crewStations\":107}:{\"colonistCapacity\":144,\"crewEfficiency\":36,\"crewStations\":36}:m0:quartersScienceWing",
    "12:quartersMedicalWing:standard:q0:iL5:{\"crewStations\":6}:{\"colonistCapacity\":12,\"crewEfficiency\":3}:m0:quartersMedicalWing",
    "13:quartersOperationsWing:augmented:q1:iL12:{\"crewStations\":18}:{\"colonistCapacity\":36,\"crewStations\":9}:m0:quartersOperationsWing",
    "14:quartersFlightDeckWing:stellar:q2:iL19:{\"crewStations\":35}:{\"colonistCapacity\":48,\"crewStations\":12}:m0:quartersFlightDeckWing",
    "15:quartersUtilitarian:radiant:q3:iL26:{\"crewStations\":61}:{\"colonistCapacity\":80,\"crewEfficiency\":20}:m0:quartersUtilitarian",
    "16:quartersEfficient:standard:q4:iL33:{\"crewStations\":56}:{\"colonistCapacity\":112,\"crewStations\":28}:m0:quartersEfficient",
    "17:quartersElite:augmented:q5:iL40:{\"crewStations\":85}:{\"crewStations\":43,\"crewEfficiency\":43}:m0:quartersElite",
    "18:quartersSecurityWing:stellar:q0:iL7:{\"crewStations\":11}:{\"colonistCapacity\":16,\"crewStations\":4}:m0:quartersSecurityWing",
    "19:quartersEngineeringWing:radiant:q1:iL14:{\"crewStations\":27}:{\"colonistCapacity\":36,\"crewStations\":9,\"crewEfficiency\":9}:m0:quartersEngineeringWing",
    "20:quartersScienceWing:standard:q2:iL21:{\"crewStations\":29}:{\"colonistCapacity\":60,\"crewStations\":15}:m0:quartersScienceWing",
    "21:quartersMedicalWing:augmented:q3:iL28:{\"crewStations\":50}:{\"crewEfficiency\":25,\"colonistCapacity\":100}:m0:quartersMedicalWing",
    "22:quartersOperationsWing:stellar:q4:iL35:{\"crewStations\":78}:{\"colonistCapacity\":104,\"crewEfficiency\":26,\"crewStations\":26}:m0:quartersOperationsWing",
    "23:quartersFlightDeckWing:radiant:q5:iL2:{\"crewStations\":6}:{\"colonistCapacity\":8,\"crewEfficiency\":2,\"crewStations\":2}:m0:quartersFlightDeckWing",
    "24:quartersUtilitarian:standard:q0:iL9:{\"crewStations\":11}:{\"colonistCapacity\":20,\"crewEfficiency\":5}:m0:quartersUtilitarian",
    "25:quartersEfficient:augmented:q1:iL16:{\"crewStations\":24}:{\"colonistCapacity\":48,\"crewStations\":12}:m0:quartersEfficient",
    "26:quartersElite:stellar:q2:iL23:{\"crewStations\":43}:{\"colonistCapacity\":56,\"crewStations\":14}:m0:quartersElite",
    "27:quartersSecurityWing:radiant:q3:iL30:{\"crewStations\":70}:{\"colonistCapacity\":92,\"crewStations\":23}:m0:quartersSecurityWing",
    "28:quartersEngineeringWing:standard:q4:iL37:{\"crewStations\":63}:{\"colonistCapacity\":124,\"crewStations\":31}:m0:quartersEngineeringWing",
    "29:quartersScienceWing:augmented:q5:iL4:{\"crewStations\":9}:{\"crewStations\":4,\"crewEfficiency\":4}:m0:quartersScienceWing",
    "30:quartersMedicalWing:stellar:q0:iL11:{\"crewStations\":17}:{\"colonistCapacity\":24,\"crewStations\":6,\"crewEfficiency\":6}:m0:quartersMedicalWing",
    "31:quartersOperationsWing:radiant:q1:iL18:{\"crewStations\":35}:{\"colonistCapacity\":48,\"crewStations\":12}:m0:quartersOperationsWing",
    "32:quartersFlightDeckWing:standard:q2:iL25:{\"crewStations\":35}:{\"colonistCapacity\":72,\"crewStations\":18}:m0:quartersFlightDeckWing",
    "33:quartersUtilitarian:augmented:q3:iL32:{\"crewStations\":57}:{\"crewEfficiency\":28,\"crewStations\":28}:m0:quartersUtilitarian",
    "34:quartersEfficient:stellar:q4:iL39:{\"crewStations\":87}:{\"colonistCapacity\":116,\"crewEfficiency\":29,\"crewStations\":29}:m0:quartersEfficient",
    "35:quartersElite:radiant:q5:iL6:{\"crewStations\":17}:{\"colonistCapacity\":24,\"crewEfficiency\":6,\"crewStations\":6}:m0:quartersElite",
    "36:quartersSecurityWing:standard:q0:iL13:{\"crewStations\":15}:{\"colonistCapacity\":32}:m0:quartersSecurityWing",
    "37:quartersEngineeringWing:augmented:q1:iL20:{\"crewStations\":29}:{\"colonistCapacity\":60,\"crewEfficiency\":15}:m0:quartersEngineeringWing",
    "38:quartersScienceWing:stellar:q2:iL27:{\"crewStations\":50}:{\"colonistCapacity\":68,\"crewStations\":17,\"crewEfficiency\":17}:m0:quartersScienceWing",
    "39:quartersMedicalWing:radiant:q3:iL34:{\"crewStations\":79}:{\"colonistCapacity\":104,\"crewStations\":26,\"crewEfficiency\":26}:m0:quartersMedicalWing",
    "40:quartersOperationsWing:standard:q4:iL1:{\"crewStations\":2}:{\"colonistCapacity\":4,\"crewStations\":1}:m0:quartersOperationsWing",
    "41:quartersFlightDeckWing:augmented:q5:iL8:{\"crewStations\":17}:{\"crewStations\":9}:m0:quartersFlightDeckWing",
    "42:quartersUtilitarian:stellar:q0:iL15:{\"crewStations\":23}:{\"colonistCapacity\":32,\"crewStations\":8,\"crewEfficiency\":8}:m0:quartersUtilitarian",
    "43:quartersEfficient:radiant:q1:iL22:{\"crewStations\":43}:{\"colonistCapacity\":56,\"crewStations\":14}:m0:quartersEfficient",
    "44:quartersElite:standard:q2:iL29:{\"crewStations\":41}:{\"colonistCapacity\":80,\"crewEfficiency\":20}:m0:quartersElite",
    "45:quartersSecurityWing:augmented:q3:iL36:{\"crewStations\":64}:{\"crewStations\":32}:m0:quartersSecurityWing",
    "46:quartersEngineeringWing:stellar:q4:iL3:{\"crewStations\":7}:{\"colonistCapacity\":8,\"crewEfficiency\":2}:m0:quartersEngineeringWing",
    "47:quartersScienceWing:radiant:q5:iL10:{\"crewStations\":28}:{\"colonistCapacity\":36,\"crewStations\":9}:m0:quartersScienceWing",
    "48:quartersMedicalWing:standard:q0:iL17:{\"crewStations\":20}:{\"colonistCapacity\":40}:m0:quartersMedicalWing",
    "49:quartersOperationsWing:augmented:q1:iL24:{\"crewStations\":35}:{\"crewStations\":18,\"crewEfficiency\":18}:m0:quartersOperationsWing",
    "50:quartersFlightDeckWing:stellar:q2:iL31:{\"crewStations\":57}:{\"colonistCapacity\":76,\"crewStations\":19}:m0:quartersFlightDeckWing",
    "pool:[{\"stat\":\"crewStations\",\"weight\":5},{\"stat\":\"crewEfficiency\",\"weight\":2},{\"stat\":\"massReduction\",\"weight\":1},{\"stat\":\"colonistCapacity\",\"weight\":2}]",
  ],
  "registry": [1201, "e6523a6f"],
  "registry:ml1": [
    "facility:REFINE_RECIPES:refineFerriteIngot|pending",
    "facility:REFINE_RECIPES:refineReclaimedCircuit|pending",
    "facility:REFINE_RECIPES:refineIridiumCatalyst|pending",
    "facility:REFINE_RECIPES:synthCobaltCoil|pending",
    "facility:REFINE_RECIPES:synthOsmiumPlate|pending",
    "facility:REFINE_RECIPES:synthPhotonicGel|pending",
    "facility:REFINE_RECIPES:synthBiocatalyst|pending",
    "facility:ITEMS:reclaimedCircuit:reserved|pending",
    "facility:ITEMS:iridiumCatalyst:reserved|pending",
    "facility:ITEMS:cobaltCoil:reserved|pending",
    "facility:ITEMS:osmiumPlate:reserved|pending",
    "facility:ITEMS:photonicGel:reserved|pending",
    "facility:ITEMS:biocatalyst:reserved|pending",
    "facility:ITEMS:precursorCircuit:reserved|pending",
  ],
  "registry:g1": ["ship:gearLine:colonistCapacity|pending", "ship:SHIP_TYPES:generalFreighter:colonistCapacity|pending", "ship:SHIP_TYPES:orion:colonistCapacity|pending", "ship:SHIP_TYPES:aurora:colonistCapacity|pending", "ship:SHIP_TYPES:eir:colonistCapacity|pending", "ship:SHIP_SEAMS:generalQuartersGuestPerk|pending", "ship:QUARTERS_MODULES:quartersGuestWing|live", "ship:QUARTERS_MODULES:quartersGuestWing:capacity|pending",
    // G1-2: the short-range template catalog, pending the cycle engine (G1-4).
    "mission:SHORT_RANGE_TEMPLATES:refugeeRelocation:rolls|pending", "mission:SHORT_RANGE_TEMPLATES:refugeeRelocation:work|pending", "mission:SHORT_RANGE_TEMPLATES:refugeeRelocation:reward|pending", "mission:SHORT_RANGE_TEMPLATES:supplyDropOff:rolls|pending", "mission:SHORT_RANGE_TEMPLATES:supplyDropOff:work|pending", "mission:SHORT_RANGE_TEMPLATES:supplyDropOff:reward|pending", "mission:SHORT_RANGE_TEMPLATES:supplyPickup:rolls|pending", "mission:SHORT_RANGE_TEMPLATES:supplyPickup:work|pending", "mission:SHORT_RANGE_TEMPLATES:supplyPickup:reward|pending", "mission:SHORT_RANGE_TEMPLATES:phenomenonSurvey:rolls|pending", "mission:SHORT_RANGE_TEMPLATES:phenomenonSurvey:work|pending", "mission:SHORT_RANGE_TEMPLATES:phenomenonSurvey:reward|pending", "mission:SHORT_RANGE_TEMPLATES:telescopeRepair:rolls|pending", "mission:SHORT_RANGE_TEMPLATES:telescopeRepair:work|pending", "mission:SHORT_RANGE_TEMPLATES:telescopeRepair:reward|pending", "mission:SHORT_RANGE_TEMPLATES:commBoosterBuild:rolls|pending", "mission:SHORT_RANGE_TEMPLATES:commBoosterBuild:work|pending", "mission:SHORT_RANGE_TEMPLATES:commBoosterBuild:reward|pending", "mission:SHORT_RANGE_TEMPLATES:prisonerTransport:rolls|pending", "mission:SHORT_RANGE_TEMPLATES:prisonerTransport:work|pending", "mission:SHORT_RANGE_TEMPLATES:prisonerTransport:reward|pending"],
  "old": ["aa94ddcd", "817862c7", "4ac62731", "d9a483c6"],
};

// The G1-0 record of golden 4 (captured on a678241), with the pool it was drawn from, kept for golden 4b.
const GEN_QUARTERS_AT_G1_0: readonly string[] = [
  "1:quartersEngineeringWing:augmented:q1:iL8:{\"crewStations\":12}:{\"crewEfficiency\":6,\"crewStations\":6}:m0:quartersEngineeringWing",
  "2:quartersScienceWing:stellar:q2:iL15:{\"crewStations\":28}:{\"crewEfficiency\":9,\"crewStations\":9}:m0:quartersScienceWing",
  "3:quartersMedicalWing:radiant:q3:iL22:{\"crewStations\":51}:{\"crewEfficiency\":17,\"crewStations\":17}:m0:quartersMedicalWing",
  "4:quartersOperationsWing:standard:q4:iL29:{\"crewStations\":49}:{\"crewEfficiency\":25}:m0:quartersOperationsWing",
  "5:quartersFlightDeckWing:augmented:q5:iL36:{\"crewStations\":77}:{\"crewStations\":38}:m0:quartersFlightDeckWing",
  "6:quartersUtilitarian:stellar:q0:iL3:{\"crewStations\":5}:{\"crewEfficiency\":2,\"crewStations\":2}:m0:quartersUtilitarian",
  "7:quartersEfficient:radiant:q1:iL10:{\"crewStations\":19}:{\"crewEfficiency\":6,\"crewStations\":6}:m0:quartersEfficient",
  "8:quartersElite:standard:q2:iL17:{\"crewStations\":24}:{\"crewEfficiency\":12,\"crewStations\":12}:m0:quartersElite",
  "9:quartersSecurityWing:augmented:q3:iL24:{\"crewStations\":42}:{\"crewStations\":21,\"crewEfficiency\":21}:m0:quartersSecurityWing",
  "10:quartersEngineeringWing:stellar:q4:iL31:{\"crewStations\":69}:{\"crewEfficiency\":23,\"crewStations\":23}:m0:quartersEngineeringWing",
  "11:quartersScienceWing:radiant:q5:iL38:{\"crewStations\":107}:{\"crewEfficiency\":36,\"crewStations\":36}:m0:quartersScienceWing",
  "12:quartersMedicalWing:standard:q0:iL5:{\"crewStations\":6}:{\"crewEfficiency\":3,\"crewStations\":3}:m0:quartersMedicalWing",
  "13:quartersOperationsWing:augmented:q1:iL12:{\"crewStations\":18}:{\"crewEfficiency\":9,\"crewStations\":9}:m0:quartersOperationsWing",
  "14:quartersFlightDeckWing:stellar:q2:iL19:{\"crewStations\":35}:{\"crewEfficiency\":12,\"crewStations\":12}:m0:quartersFlightDeckWing",
  "15:quartersUtilitarian:radiant:q3:iL26:{\"crewStations\":61}:{\"crewEfficiency\":20,\"crewStations\":20}:m0:quartersUtilitarian",
  "16:quartersEfficient:standard:q4:iL33:{\"crewStations\":56}:{\"crewEfficiency\":28,\"crewStations\":28}:m0:quartersEfficient",
  "17:quartersElite:augmented:q5:iL40:{\"crewStations\":85}:{\"crewStations\":43,\"crewEfficiency\":43}:m0:quartersElite",
  "18:quartersSecurityWing:stellar:q0:iL7:{\"crewStations\":11}:{\"crewEfficiency\":4,\"crewStations\":4}:m0:quartersSecurityWing",
  "19:quartersEngineeringWing:radiant:q1:iL14:{\"crewStations\":27}:{\"crewEfficiency\":9,\"crewStations\":9}:m0:quartersEngineeringWing",
  "20:quartersScienceWing:standard:q2:iL21:{\"crewStations\":29}:{\"crewEfficiency\":15,\"crewStations\":15}:m0:quartersScienceWing",
  "21:quartersMedicalWing:augmented:q3:iL28:{\"crewStations\":50}:{\"crewStations\":25}:m0:quartersMedicalWing",
  "22:quartersOperationsWing:stellar:q4:iL35:{\"crewStations\":78}:{\"crewEfficiency\":26,\"crewStations\":26}:m0:quartersOperationsWing",
  "23:quartersFlightDeckWing:radiant:q5:iL2:{\"crewStations\":6}:{\"crewEfficiency\":2,\"crewStations\":2}:m0:quartersFlightDeckWing",
  "24:quartersUtilitarian:standard:q0:iL9:{\"crewStations\":11}:{\"crewEfficiency\":5,\"crewStations\":5}:m0:quartersUtilitarian",
  "25:quartersEfficient:augmented:q1:iL16:{\"crewStations\":24}:{\"crewStations\":12}:m0:quartersEfficient",
  "26:quartersElite:stellar:q2:iL23:{\"crewStations\":43}:{\"crewEfficiency\":14,\"crewStations\":14}:m0:quartersElite",
  "27:quartersSecurityWing:radiant:q3:iL30:{\"crewStations\":70}:{\"crewEfficiency\":23,\"crewStations\":23}:m0:quartersSecurityWing",
  "28:quartersEngineeringWing:standard:q4:iL37:{\"crewStations\":63}:{\"crewEfficiency\":31,\"crewStations\":31}:m0:quartersEngineeringWing",
  "29:quartersScienceWing:augmented:q5:iL4:{\"crewStations\":9}:{\"crewStations\":4,\"crewEfficiency\":4}:m0:quartersScienceWing",
  "30:quartersMedicalWing:stellar:q0:iL11:{\"crewStations\":17}:{\"crewEfficiency\":6,\"crewStations\":6}:m0:quartersMedicalWing",
  "31:quartersOperationsWing:radiant:q1:iL18:{\"crewStations\":35}:{\"crewEfficiency\":12,\"crewStations\":12}:m0:quartersOperationsWing",
  "32:quartersFlightDeckWing:standard:q2:iL25:{\"crewStations\":35}:{\"crewEfficiency\":18,\"crewStations\":18}:m0:quartersFlightDeckWing",
  "33:quartersUtilitarian:augmented:q3:iL32:{\"crewStations\":57}:{\"crewEfficiency\":28,\"crewStations\":28}:m0:quartersUtilitarian",
  "34:quartersEfficient:stellar:q4:iL39:{\"crewStations\":87}:{\"crewEfficiency\":29,\"crewStations\":29}:m0:quartersEfficient",
  "35:quartersElite:radiant:q5:iL6:{\"crewStations\":17}:{\"crewEfficiency\":6,\"crewStations\":6}:m0:quartersElite",
  "36:quartersSecurityWing:standard:q0:iL13:{\"crewStations\":15}:{\"crewEfficiency\":8}:m0:quartersSecurityWing",
  "37:quartersEngineeringWing:augmented:q1:iL20:{\"crewStations\":29}:{\"crewEfficiency\":15}:m0:quartersEngineeringWing",
  "38:quartersScienceWing:stellar:q2:iL27:{\"crewStations\":50}:{\"crewEfficiency\":17,\"crewStations\":17}:m0:quartersScienceWing",
  "39:quartersMedicalWing:radiant:q3:iL34:{\"crewStations\":79}:{\"crewEfficiency\":26,\"crewStations\":26}:m0:quartersMedicalWing",
  "40:quartersOperationsWing:standard:q4:iL1:{\"crewStations\":2}:{\"crewStations\":1}:m0:quartersOperationsWing",
  "41:quartersFlightDeckWing:augmented:q5:iL8:{\"crewStations\":17}:{\"crewStations\":9,\"crewEfficiency\":9}:m0:quartersFlightDeckWing",
  "42:quartersUtilitarian:stellar:q0:iL15:{\"crewStations\":23}:{\"crewStations\":8,\"crewEfficiency\":8}:m0:quartersUtilitarian",
  "43:quartersEfficient:radiant:q1:iL22:{\"crewStations\":43}:{\"crewStations\":14,\"crewEfficiency\":14}:m0:quartersEfficient",
  "44:quartersElite:standard:q2:iL29:{\"crewStations\":41}:{\"crewStations\":20}:m0:quartersElite",
  "45:quartersSecurityWing:augmented:q3:iL36:{\"crewStations\":64}:{\"crewEfficiency\":32,\"crewStations\":32}:m0:quartersSecurityWing",
  "46:quartersEngineeringWing:stellar:q4:iL3:{\"crewStations\":7}:{\"crewEfficiency\":2,\"crewStations\":2}:m0:quartersEngineeringWing",
  "47:quartersScienceWing:radiant:q5:iL10:{\"crewStations\":28}:{\"crewEfficiency\":9,\"crewStations\":9}:m0:quartersScienceWing",
  "48:quartersMedicalWing:standard:q0:iL17:{\"crewStations\":20}:{\"crewEfficiency\":10}:m0:quartersMedicalWing",
  "49:quartersOperationsWing:augmented:q1:iL24:{\"crewStations\":35}:{\"crewStations\":18,\"crewEfficiency\":18}:m0:quartersOperationsWing",
  "50:quartersFlightDeckWing:stellar:q2:iL31:{\"crewStations\":57}:{\"crewStations\":19,\"crewEfficiency\":19}:m0:quartersFlightDeckWing",
  "pool:[{\"stat\":\"crewStations\",\"weight\":5},{\"stat\":\"crewEfficiency\",\"weight\":2},{\"stat\":\"massReduction\",\"weight\":1}]",
];

const QUARTERS_POOL_AT_G1_0 = [
  { stat: "crewStations", weight: 5 },
  { stat: "crewEfficiency", weight: 2 },
  { stat: "massReduction", weight: 1 },
];
// The registry entries a G1 slice adds (new ids only; an existing entry never changes here). G1-1: the guest quarters
// sources (the gear line, the four transport hulls' bases, the General quarters perk) and the Guest Wing module. G1-2:
// the short-range template catalog's 21 effect fields.
const G1_ADDED_ENTRY_IDS: ReadonlySet<string> = new Set<string>([
  "ship:gearLine:colonistCapacity",
  "ship:SHIP_TYPES:generalFreighter:colonistCapacity",
  "ship:SHIP_TYPES:orion:colonistCapacity",
  "ship:SHIP_TYPES:aurora:colonistCapacity",
  "ship:SHIP_TYPES:eir:colonistCapacity",
  "ship:SHIP_SEAMS:generalQuartersGuestPerk",
  "ship:QUARTERS_MODULES:quartersGuestWing",
  "ship:QUARTERS_MODULES:quartersGuestWing:capacity",
  // G1-2: every effect field of every short-range template (rolls, work, reward), pending the cycle engine (G1-4).
  ...["refugeeRelocation", "supplyDropOff", "supplyPickup", "phenomenonSurvey", "telescopeRepair", "commBoosterBuild", "prisonerTransport"].flatMap((k) =>
    ["rolls", "work", "reward"].map((f) => `mission:SHORT_RANGE_TEMPLATES:${k}:${f}`),
  ),
]);
// The registry entries ML-1 adds (new ids only): its seven Refinery recipes and its seven typed reserves.
const ML1_ADDED_ENTRY_IDS: ReadonlySet<string> = new Set<string>([
  ...["refineFerriteIngot", "refineReclaimedCircuit", "refineIridiumCatalyst", "synthCobaltCoil", "synthOsmiumPlate", "synthPhotonicGel", "synthBiocatalyst"].map(
    (k) => `facility:REFINE_RECIPES:${k}`,
  ),
  ...["reclaimedCircuit", "iridiumCatalyst", "cobaltCoil", "osmiumPlate", "photonicGel", "biocatalyst", "precursorCircuit"].map((id) => `facility:ITEMS:${id}:reserved`),
]);

// Field Kits FKR-5 (tool charges and the grenade family), held apart by the cause checks: the 19 entries it ADDS (the
// Impact Grenade's three lines and the carry line on the two older grenades, each grenade's four GRENADES rows, the
// throwGrenade action, the Impact Grenade blueprint's research) and the ONE entry it FLIPS pending -> live (Explosives:
// Saboteur on the Saboteur's own throws), read back as pending there.
const FKR5_ADDED_ENTRY_IDS: ReadonlySet<string> = new Set<string>([
  "gear:security:stunGrenade:groundCarryCapacity",
  "gear:security:toxinGrenade:groundCarryCapacity",
  "gear:security:impactGrenade:groundPower",
  "gear:security:impactGrenade:groundAccuracy",
  "gear:security:impactGrenade:groundCarryCapacity",
  ...["stunGrenade", "toxinGrenade", "impactGrenade"].flatMap((k) => ["charges", "perBattle", "blast", "status"].map((f) => `away:GRENADES:${k}:${f}`)),
  "away:GAMBIT_ACTIONS:throwGrenade",
  "facility:BLUEPRINTS:impactGrenadeBp",
]);
const FKR5_FLIPPED_LIVE: ReadonlySet<string> = new Set<string>(["away:KIT_CATEGORY_RULES:explosives"]);
// The review rulings (user 2026-10-20 "Hide until kits are live"): while FIELD_KITS_PLAYER_LIVE is false three of
// FKR-5's entries are not in the registry (the Impact Grenade blueprint waits outside BLUEPRINTS; the Stun and Toxin
// carry lines are not rollable), and one audit row naming them is added (pending FKR-7). Held apart with FKR-5.
const FKR5_HIDDEN_UNTIL_FKR7: ReadonlySet<string> = new Set<string>([
  "gear:security:stunGrenade:groundCarryCapacity",
  "gear:security:toxinGrenade:groundCarryCapacity",
  "facility:BLUEPRINTS:impactGrenadeBp",
]);
const FKR5_RULINGS_ADDED: ReadonlySet<string> = new Set<string>(["away:audit:fieldKitsHiddenPieces"]);
// Expedition Tiers G2-3 (the voyage engine) ADDS two audit rows (the voyage ladder above Tier I, owner G2-6; the drive
// class halving, owner G2-4). Its ship speed rows went live at Ground Ops but stay partial (pending for the patrol), so
// their status kind hashes the same.
const G23_ADDED_ENTRY_IDS: ReadonlySet<string> = new Set<string>(["expedition:audit:voyageDeepTiers", "expedition:audit:voyageDriveClass"]);
// The `registry` pin on the feat base before FKR-5 and G2-3 merged (after WR-6, CP-8 and G1-2).
const REGISTRY_BEFORE_FKR5_G23 = [1182, "c748495a"];

// The ONE exclusion helper every registry pin goes through. Each slice names the entries it ADDED (stripped) and the
// entries it FLIPPED (read back as their earlier status), so a pin taken before that slice is reproduced exactly and
// proves no other entry moved. Lines are `${id}|${status kind}` in registry order; the pin is [count, hash].
type RegistrySlice = { readonly added?: ReadonlySet<string>; readonly flipped?: ReadonlySet<string>; readonly was?: string };
const G1_SLICE: RegistrySlice = { added: G1_ADDED_ENTRY_IDS };
const ML1_SLICE: RegistrySlice = { added: ML1_ADDED_ENTRY_IDS };
const FKR5_SLICE: RegistrySlice = { added: new Set([...FKR5_ADDED_ENTRY_IDS, ...FKR5_RULINGS_ADDED]), flipped: FKR5_FLIPPED_LIVE, was: "pending" };
const G23_SLICE: RegistrySlice = { added: G23_ADDED_ENTRY_IDS };
function registryPin(...slices: readonly RegistrySlice[]): [number, string] {
  const lines = WIRING_REGISTRY.filter((e) => !slices.some((sl) => sl.added?.has(e.id))).map((e) => {
    const flip = slices.find((sl) => sl.flipped?.has(e.id));
    return `${e.id}|${flip ? (flip.was ?? "pending") : e.status.kind}`;
  });
  return [lines.length, hash(lines)];
}

const CAPTURE = Boolean(import.meta.env.G1_CAPTURE);
const captured: Record<string, unknown> = {};
function pin(key: string, value: unknown): void {
  if (CAPTURE) {
    captured[key] = value;
    return;
  }
  expect(value, key).toEqual(GOLDEN[key]);
}

function fleetRun(): { hours: string[]; seen: string[][]; s: GameState } {
  let s = mixedFleet();
  const hours: string[] = [g1StateHash(s)];
  const seen: string[][] = [views(s)];
  for (let h = 1; h <= 6; h++) {
    s = economyTick(s, HOUR, RNG);
    hours.push(g1StateHash(s));
    if (h === 3 || h === 6) seen.push(views(s));
  }
  return { hours, seen, s };
}

// The `registry` pin before WR-6 (after CP-8), and the nine entries WR-6 flips pending -> live.
const REGISTRY_BEFORE_WR6 = [1182, "93d27465"];
const WR6_WIRED_IDS: ReadonlySet<string> = new Set<string>([
  "captain:CAPTAIN_TALENTS:tacticianHub",
  "captain:CAPTAIN_TALENTS:explorerHub",
  "captain:CAPTAIN_SPEC_BONUS:tactical",
  "captain:CAPTAIN_SPEC_BONUS:science",
  "captain:progression:race",
  "fleetAdmiral:HOMEWORLD_TALENTS:fleetLogisticsSalvage",
  "fleetAdmiral:HOMEWORLD_TALENTS:industryHub",
  "fleetAdmiral:HOMEWORLD_TALENTS:homelandDefenseHub",
  "fleetAdmiral:HOMEWORLD_TALENTS:citizenryHub",
]);
const WR6_SLICE: RegistrySlice = { flipped: WR6_WIRED_IDS, was: "pending" };

// The `fleet` record before OC-11 (captured on a678241); reproduced with the pause off.
const FLEET_BEFORE_OC11 = ["aa94ddcd", "1a72036c", "5008dacf", "cbf18a80", "6c8ebe80", "33d00a42", "19f8bdb2"];

describe("G1-0 golden 1 + 2: a mixed fleet over six hours, and the Home and Ships views on it", () => {
  it("the whole state every hour, and the views at 0, 3 and 6 hours", () => {
    const { hours, seen, s } = fleetRun();
    // Still out: the mission and the patrol repeat, the expedition is on its way.
    expect(s.captains[1].mission).not.toBeNull();
    expect(s.captains[2].mission).not.toBeNull();
    expect(s.expeditions.length).toBe(1);
    pin("fleet", hours);
    pin("views", seen);
  });
  // CP-8 / OC-11: with the pause off the run reproduces the record from before OC-11, views included.
  it("OC-11 is the only cause of the fleet move", () => {
    const before = withOc11Off(() => fleetRun());
    expect(before.hours).toEqual(FLEET_BEFORE_OC11);
    expect(before.seen).toEqual(GOLDEN.views);
  });
});

describe("G1-0 golden 3: effectiveShipStats for every hull, bare and with each quarters variety", () => {
  for (const hull of HULLS) {
    it(`${hull}`, () => {
      const s0 = withBuckets(onHull(hull), [bucketOf("operations", "ops.unloadSpeed"), bucketOf("engineering", "eng.range"), bucketOf("operations", "ops.effectiveCargo")]);
      const ship = s0.ships[0];
      const out = [statsHash(effectiveShipStats(s0, ship))];
      // G1-1: guest quarters, bare then each variety (the G1-0 nine, then the Guest Wing).
      const guests = [effectiveShipStats(s0, ship).colonistCapacity ?? 0];
      for (const v of QUARTERS_VARIETIES_AT_G1_0) {
        const s = withPiece(s0, derelictQuarters(v, `equip-q-${v}`), ship.id);
        out.push(statsHash(effectiveShipStats(s, ship)));
        guests.push(effectiveShipStats(s, ship).colonistCapacity ?? 0);
      }
      pin(`stats:${hull}`, out);
      const wing = withPiece(s0, derelictQuarters("quartersGuestWing", "equip-q-wing"), ship.id);
      guests.push(effectiveShipStats(wing, ship).colonistCapacity ?? 0);
      pin(`stats:${hull}:guestWing`, statsHash(effectiveShipStats(wing, ship)));
      pin(`guests:${hull}`, guests);
    });
  }
});

// Golden 4's lines: one per seed (variety, rarity, quality, iLevel, the implicit and rolled lines, mass, the stamp),
// then the pool the seeds draw from, so a move names its cause.
function genQuartersLines(): string[] {
    const rarities: EquipmentRarity[] = ["standard", "augmented", "stellar", "radiant"];
    const out: string[] = [];
    for (let seed = 1; seed <= 50; seed++) {
      const variety = QUARTERS_VARIETIES_AT_G1_0[seed % QUARTERS_VARIETIES_AT_G1_0.length];
      const rarity = rarities[seed % rarities.length];
      const quality = seed % 6;
      const iLevel = 1 + ((seed * 7) % 40);
      const p = generateEquipment({
        slotType: "quarters",
        varietyKey: variety,
        blueprintKey: null,
        iLevel,
        quality,
        rarity,
        ascension: "none",
        rng: lcg(0x6100 + seed),
        allocateId: () => `equip-${seed}`,
      });
      out.push(`${seed}:${variety}:${rarity}:q${quality}:iL${iLevel}:${JSON.stringify(p.implicitStats)}:${JSON.stringify(p.rolledStats)}:m${p.mass}:${p.moduleVariant}`);
    }
    out.push(`pool:${JSON.stringify(EQUIPMENT_SLOTS.quarters.affixPool)}`);
    return out;
}

describe("G1-0 golden 4: generateEquipment for the quarters slot at 50 fixed seeds", () => {
  it("one line per seed: variety, rarity, quality, iLevel, the implicit and rolled lines, mass", () => {
    pin("gen:quarters", genQuartersLines());
  });

  // G1-1: the move's cause, proven. With the pool put back to its G1-0 table the generator reproduces the G1-0 record
  // line for line, so the appended guest quarters affix is the ONLY thing that moved these rolls (the berth
  // conversion touches only guest lines, which the G1-0 pool cannot roll).
  it("4b: with the G1-0 pool the generator reproduces the G1-0 record exactly", () => {
    const slot = EQUIPMENT_SLOTS.quarters;
    const live = slot.affixPool;
    slot.affixPool = QUARTERS_POOL_AT_G1_0.map((e) => ({ ...e }));
    try {
      expect(genQuartersLines()).toEqual(GEN_QUARTERS_AT_G1_0);
    } finally {
      slot.affixPool = live;
    }
    expect(slot.affixPool.map((e) => e.stat)).toEqual([...QUARTERS_POOL_AT_G1_0.map((e) => e.stat), "colonistCapacity"]);
  });
});

describe("G1-0 golden 5: the wiring registry's ids and statuses", () => {
  it("the entries outside the G1 additions, hashed in registry order", () => {
    pin("registry", registryPin(G1_SLICE, ML1_SLICE));
  });
  // FKR-5 and G2-3 moved the pin (see the header); with their entries held apart and the Explosives flip read back as
  // pending, the registry hashes exactly as the feat base before them.
  it("FKR-5 and G2-3 are the only causes of the registry move", () => {
    expect(registryPin(G1_SLICE, ML1_SLICE, FKR5_SLICE, G23_SLICE)).toEqual(REGISTRY_BEFORE_FKR5_G23);
  });
  // WR-6: the nine placeholder entries it wires flip pending -> live (the count and the order hold). With those nine
  // read as pending again (and the later slices held apart) the lines hash to the pin from before WR-6, so the flips
  // are the only move.
  it("WR-6 is the only cause of the registry move", () => {
    expect(WIRING_REGISTRY.filter((e) => WR6_WIRED_IDS.has(e.id)).map((e) => e.status.kind)).toEqual(Array(WR6_WIRED_IDS.size).fill("live"));
    expect(registryPin(G1_SLICE, ML1_SLICE, FKR5_SLICE, G23_SLICE, WR6_SLICE)).toEqual(REGISTRY_BEFORE_WR6);
  });
  it("Field Kits FKR-5: the added entries and the one flipped, each with its status", () => {
    const added = WIRING_REGISTRY.filter((e) => FKR5_ADDED_ENTRY_IDS.has(e.id));
    const shown = [...FKR5_ADDED_ENTRY_IDS].filter((id) => FIELD_KITS_PLAYER_LIVE || !FKR5_HIDDEN_UNTIL_FKR7.has(id));
    expect(added.map((e) => e.id).sort()).toEqual(shown.sort());
    expect(added.every((e) => e.status.kind === "live")).toBe(true);
    if (!FIELD_KITS_PLAYER_LIVE) for (const id of FKR5_RULINGS_ADDED) expect(WIRING_REGISTRY.find((e) => e.id === id)?.status.kind, id).toBe("pending");
    for (const id of FKR5_FLIPPED_LIVE) expect(WIRING_REGISTRY.find((e) => e.id === id)?.status.kind, id).toBe("live");
  });
  it("G1-1: the added entries, each with its status", () => {
    const added = WIRING_REGISTRY.filter((e) => G1_ADDED_ENTRY_IDS.has(e.id)).map((e) => `${e.id}|${e.status.kind}`);
    expect(added.length).toBe(G1_ADDED_ENTRY_IDS.size);
    pin("registry:g1", added);
  });
  it("ML-1: the added entries, each with its status", () => {
    const added = WIRING_REGISTRY.filter((e) => ML1_ADDED_ENTRY_IDS.has(e.id)).map((e) => `${e.id}|${e.status.kind}`);
    expect(added.length).toBe(ML1_ADDED_ENTRY_IDS.size);
    pin("registry:ml1", added);
  });
});

describe("G1-0 golden 6: an old save (v69) of the mixed fleet through migrate", () => {
  it("the migrated state and every ship's stats", () => {
    const held = mixedFleet();
    const save = deserialize(serialize(held, 0)) as SaveFile;
    const state = migrate({ ...save, version: 69 });
    pin("old", [g1StateHash(state), ...state.ships.map((sh) => statsHash(effectiveShipStats(state, sh)))]);
  });
});

describe.runIf(CAPTURE)("G1-0 capture (G1_CAPTURE = an output path): write the goldens there", () => {
  it("writes", () => {
    writeFileSync(String(import.meta.env.G1_CAPTURE), JSON.stringify(captured, null, 2));
  });
});
