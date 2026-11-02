// E-MOD EM-7 goldens (0.14.0, plan docs/plans/2026-10-17-material-lines-and-emod-plan.md section 4 EM-7): captured on
// the code BEFORE the v1 module roster, its blueprints, the Survey Pair set and the UNIVERSAL_MODULES_LIVE flip, so the
// EM-7 commit can show exactly which readings moved (by design) and which held (a module-free fleet).
//
//   HELD (must never move with EM-7: no save holds a universal module, so nothing a player owns today changes)
//     sheet     : effectiveShipStats for every hull, bare and with its Standard-Issue combat set.
//     dispatch  : an Orion and an Aurora expedition dispatched with no module (scan speed, relic find, hazard resist, the
//                 frozen module scan procs), and expeditionGearBonuses with a Pathfinder Suite installed.
//     sets      : gearSetBonusLines and activeGearSetTiers over the two RR-6 test sets (Survey Cadre, Field Cadre), at
//                 every piece count, a Celestial piece and a worn view (EM-7 extends the one set engine).
//     combat    : the player combatant for every combat hull (the module fold reads nothing without a module).
//   MOVED BY DESIGN (EM-7 adds content and flips the switch; each move is named in the EM-7 commit)
//     loadout   : the Armory slot set per hull (the module slots appear with the switch).
//     catalog   : the blueprint keys per Lab tier, the Archive's maximum score, the Fabricator groups and the Research
//                 sections per tier (eight module blueprints join tiers 2 to 4).
//
// EM7_CAPTURE = an output path: record every pin instead of asserting (the RR_CAPTURE / GW_CAPTURE pattern).

import { describe, expect, it } from "vitest";
import { withoutGg7Content } from "./gasGiantSpecials.fixture";
// E-MOD EM-8 came after this capture: the Precursor Lens's blueprint, variety and the circuit's recipe held apart.
import { EM8_BLUEPRINT_KEYS, withoutEm8Content } from "./emodEm8Switch.fixture";
import { writeFileSync } from "node:fs";
import {
  BLUEPRINTS,
  SHIP_TYPES,
  type EquipmentInstance,
  type EquipmentSlotType,
  type GameState,
  type ShipTypeKey,
} from "./model";
import { installMissingCombatBaselines } from "./tick";
import { effectiveShipStats } from "./crewOverlay";
import { expeditionGearBonuses } from "./expedition";
import { loadoutSlotDefsForShipType } from "./armory";
import { archiveCompletion, archivableBlueprints, maxItemScore } from "./archive";
import { fabricateKeyGroups, researchSectionOf } from "../awayGearDisplay";
import { activeGearSetTiers, gearSetBonusLines, GEAR_SETS } from "./gearSets";
import { combatHullTypeOf, shipToCombatant } from "./combat/bridge";
import { equippedFor } from "./equipmentQueries";
import { dispatchRun, installPiece, wiringBase } from "./wiring/probes";
import { hash } from "./firstRunsGoldens.fixture";
import { withoutEm7Blueprints } from "./emodEm7.fixture";
// WR-7 follow-up OC-D5 (favorsSpec, "+10% on its ship type"): every pin here predates the favored-spec bonus (the
// explorer hulls' Pathfinder Suite rows read it), so the file runs with it off; favorsSpecGoldens.test.ts pins it.
import { favoredSpecOffForThisFile } from "./favoredSpecSwitch.fixture";
favoredSpecOffForThisFile();

const CAPTURE = Boolean(import.meta.env.EM7_CAPTURE);
const HULLS = Object.keys(SHIP_TYPES) as ShipTypeKey[];
const SHIP = "ship-1";

const bare = (hull: ShipTypeKey): GameState => {
  const s = wiringBase(hull);
  return { ...s, equipment: s.equipment.filter((e) => e.fittedToShipId !== SHIP) };
};
const shipOf = (s: GameState) => s.ships.find((x) => x.id === SHIP)!;

function setPiece(slotType: string, i: number, over: Partial<EquipmentInstance> = {}): EquipmentInstance {
  return {
    id: `em7-set-${slotType}-${i}`,
    slotType: slotType as EquipmentSlotType,
    rarity: "constellar",
    ascension: "none",
    quality: 0,
    iLevel: 10,
    blueprintKey: null,
    implicitStats: {},
    rolledStats: {},
    mass: 0,
    powerDraw: 0,
    durabilityMax: 100,
    fittedToShipId: SHIP,
    ...over,
  } as EquipmentInstance;
}

// The two RR-6 test sets at every count of their own pieces (1 to 5), one Celestial, and one worn piece.
function setReadings(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const id of ["testSetSurvey", "testSetField"]) {
    const def = GEAR_SETS.find((d) => d.id === id)!;
    const slots = def.scope === "member" ? [...def.slotTypes, "implant"] : [...def.slotTypes];
    for (let k = 1; k <= slots.length; k++) {
      const pieces = slots.slice(0, k).map((slot, i) => setPiece(slot, i, { setId: id }));
      out[`${id}:${k}`] = { lines: gearSetBonusLines(pieces, def.scope), tiers: activeGearSetTiers(pieces, def.scope) };
      const celestial = pieces.map((p, i) => (i === 0 ? { ...p, ascension: "celestial" as const } : p));
      out[`${id}:${k}:celestial`] = gearSetBonusLines(celestial, def.scope);
    }
  }
  return out;
}

// `pre`: EM-7's additions held apart (the module switch off through loadoutSlotDefsForShipType's own test hook, the eight
// module blueprints left out: emodEm7.fixture.ts), which must reproduce every pre-EM-7 capture: the proof that EM-7's
// additions are the whole move.
function computePins(pre = false): { held: Record<string, string>; moved: Record<string, string> } {
  const blueprints = pre ? withoutEm7Blueprints(BLUEPRINTS) : BLUEPRINTS;
  const archivable = archivableBlueprints().filter((a) => a.key in blueprints);
  const held: Record<string, string> = {};
  const moved: Record<string, string> = {};
  for (const hull of HULLS) {
    const b = bare(hull);
    held[`sheet:${hull}:bare`] = hash(effectiveShipStats(b, shipOf(b)));
    const si = installMissingCombatBaselines(wiringBase(hull));
    held[`sheet:${hull}:si`] = hash(effectiveShipStats(si, shipOf(si)));
    const ht = combatHullTypeOf(hull);
    if (ht !== null) {
      held[`combat:${hull}`] = hash(
        shipToCombatant({ id: "p", team: "player", stats: SHIP_TYPES[hull], hullType: ht, installedGear: equippedFor(si, SHIP) }),
      );
    }
    moved[`loadout:${hull}`] = hash(pre ? loadoutSlotDefsForShipType(hull, false) : loadoutSlotDefsForShipType(hull));
  }
  for (const hull of ["orion", "aurora"] as const) {
    const run = dispatchRun(wiringBase(hull));
    held[`dispatch:${hull}`] = hash({
      scanSpeedBonus: run.scanSpeedBonus,
      relicFindBonus: run.relicFindBonus,
      hazardResist: run.hazardResist,
      moduleScanProcs: run.moduleScanProcs ?? null,
    });
    const pf = installPiece(wiringBase(hull), { slotType: "specUtility", moduleVariant: "pathfinderSuite", rolledStats: { expeditionScanSpeed: 12, hazardResist: 6 } });
    held[`gearBonuses:${hull}:pathfinder`] = hash(expeditionGearBonuses(pf, shipOf(pf)));
  }
  held["sets"] = hash(setReadings());
  // The catalog: Lab tiers 1 to 7.
  for (let tier = 1; tier <= 7; tier++) {
    const keys = Object.values(blueprints).filter((bp) => bp.tier === tier).map((bp) => bp.key);
    moved[`catalog:tier:${tier}`] = hash(keys);
    moved[`catalog:fabricator:${tier}`] = hash(fabricateKeyGroups(Object.values(blueprints), tier));
    moved[`catalog:research:${tier}`] = hash(keys.map((k) => [k, researchSectionOf(blueprints[k])]));
  }
  const max = archivable.reduce((a, { bp }) => a + maxItemScore(bp), 0);
  moved["catalog:archive"] = hash({
    slots: archivable.map((a) => a.key),
    max,
    fresh: pre ? { total: 0, max, pct: 0 } : archiveCompletion(wiringBase()),
  });
  return { held, moved };
}

// The by-design readings after EM-7 (pinned so a later slice cannot move one unexplained). E-MOD EM-10 moved three of
// them, by design and display only: the Fabricator's Item dropdown gained its own "Modules" shelf (awayGearDisplay.ts
// fabricatorGroupOf), so the module crafts on Lab tiers 2 to 4 file there instead of under Ship Systems (EM-7's values
// were fabricator:2 6b69720, fabricator:3 19a6bab3, fabricator:4 ba6192b5). No blueprint, tier or recipe changed.
const MOVED_AFTER: Record<string, string> = {
  "loadout:generalFreighter": "d29a3c6b",
  "loadout:prospectorHauler": "366ebcc4",
  "loadout:prospectorRunner": "9a356c9f",
  "loadout:prospectorMiner": "9a356c9f",
  "loadout:destroyer": "93e5db29",
  "loadout:battleship": "b1c56e38",
  "loadout:carrier": "fe3db005",
  "loadout:orion": "62a6ba3a",
  "loadout:aurora": "42dbc854",
  "loadout:eir": "62a6ba3a",
  "catalog:tier:1": "9ec83d2c",
  "catalog:fabricator:1": "308e5cf2",
  "catalog:research:1": "33c99963",
  "catalog:tier:2": "400c2de",
  "catalog:fabricator:2": "ee7fbf14",
  "catalog:research:2": "9c25116c",
  "catalog:tier:3": "76c83e13",
  "catalog:fabricator:3": "d2b40e56",
  "catalog:research:3": "a827db6a",
  "catalog:tier:4": "3178fad1",
  "catalog:fabricator:4": "f9ab1f94",
  "catalog:research:4": "d090d7a3",
  "catalog:tier:5": "9d72b6ad",
  "catalog:fabricator:5": "50003ca9",
  "catalog:research:5": "d27708aa",
  "catalog:tier:6": "7378edd4",
  "catalog:fabricator:6": "294daec8",
  "catalog:research:6": "76c27325",
  "catalog:tier:7": "6e4f45a7",
  "catalog:fabricator:7": "ecd3353b",
  "catalog:research:7": "c255dddc",
  "catalog:archive": "354f5b8d",
};

// Captured on the pre-EM-7 engine (feat/crew-0.14.0 b66b976).
const HELD: Record<string, string> = {
  "sheet:generalFreighter:bare": "cd763a7",
  "sheet:generalFreighter:si": "cd763a7",
  "combat:generalFreighter": "89fea74d",
  "sheet:prospectorHauler:bare": "af0011b2",
  "sheet:prospectorHauler:si": "af0011b2",
  "combat:prospectorHauler": "6aa71210",
  "sheet:prospectorRunner:bare": "3339682c",
  "sheet:prospectorRunner:si": "3339682c",
  "combat:prospectorRunner": "a0643b18",
  "sheet:prospectorMiner:bare": "7ef59c4e",
  "sheet:prospectorMiner:si": "7ef59c4e",
  "combat:prospectorMiner": "83d03bea",
  "sheet:destroyer:bare": "475c0565",
  "sheet:destroyer:si": "475c0565",
  "combat:destroyer": "9c575b32",
  "sheet:battleship:bare": "3293481",
  "sheet:battleship:si": "3293481",
  "combat:battleship": "51f78d5",
  "sheet:carrier:bare": "848d561f",
  "sheet:carrier:si": "848d561f",
  "combat:carrier": "e7476ba8",
  "sheet:orion:bare": "8870cb16",
  "sheet:orion:si": "8870cb16",
  "combat:orion": "66e7c3fd",
  "sheet:aurora:bare": "4e326d65",
  "sheet:aurora:si": "4e326d65",
  "combat:aurora": "d5761347",
  "sheet:eir:bare": "ade58abc",
  "sheet:eir:si": "ade58abc",
  "combat:eir": "7458f0cb",
  "dispatch:orion": "ae52dc48",
  "gearBonuses:orion:pathfinder": "1aba255e",
  "dispatch:aurora": "ae52dc48",
  "gearBonuses:aurora:pathfinder": "1aba255e",
  "sets": "7095dd53",
};
const MOVED_BEFORE: Record<string, string> = {
  "loadout:generalFreighter": "4c1868f",
  "loadout:prospectorHauler": "ad9f15a1",
  "loadout:prospectorRunner": "a54ba046",
  "loadout:prospectorMiner": "a54ba046",
  "loadout:destroyer": "91606bc",
  "loadout:battleship": "f451a3dd",
  "loadout:carrier": "b9cd4e28",
  "loadout:orion": "a54ba046",
  "loadout:aurora": "a54ba046",
  "loadout:eir": "a54ba046",
  "catalog:tier:1": "9ec83d2c",
  "catalog:fabricator:1": "308e5cf2",
  "catalog:research:1": "33c99963",
  "catalog:tier:2": "a37161ee",
  "catalog:fabricator:2": "60c155f2",
  "catalog:research:2": "12b60b73",
  "catalog:tier:3": "eda179a8",
  "catalog:fabricator:3": "97399634",
  "catalog:research:3": "5c84db07",
  "catalog:tier:4": "cee66596",
  "catalog:fabricator:4": "4007af8a",
  "catalog:research:4": "9e2f2d9b",
  "catalog:tier:5": "9d72b6ad",
  "catalog:fabricator:5": "50003ca9",
  "catalog:research:5": "d27708aa",
  "catalog:tier:6": "7378edd4",
  "catalog:fabricator:6": "294daec8",
  "catalog:research:6": "76c27325",
  "catalog:tier:7": "6e4f45a7",
  "catalog:fabricator:7": "ecd3353b",
  "catalog:research:7": "c255dddc",
  "catalog:archive": "61881823",
};

describe("E-MOD EM-7 goldens (captured before the v1 roster)", () => {
  if (CAPTURE) {
    it("captures", () => {
      writeFileSync(String(import.meta.env.EM7_CAPTURE), JSON.stringify(computePins(), null, 2));
    });
    return;
  }
  // Gas Giant Study GG-7 came after this capture. The module-free readings (sheets, combat, dispatch, sets) are computed
  // on the REAL catalog, so a GG-7 regression there shows; only the by-design catalog readings (the Armory slot sets,
  // the Lab tiers, the Archive) hold GG-7's blueprints and varieties apart (gasGiantSpecials.fixture.ts), so EM-7 stays
  // the only move named there.
  const pins = computePins();
  const catalogPins = withoutGg7Content(() => withoutEm8Content(() => computePins()));
  it("every module-free reading holds (sheets, the player combatant, expedition dispatch, the set engine)", () => {
    expect(Object.keys(HELD).length).toBeGreaterThan(30);
    for (const [k, v] of Object.entries(HELD)) expect(pins.held[k], k).toBe(v);
  });
  it("the by-design readings: with EM-7's additions held apart, every one is the pre-EM-7 capture", () => {
    expect(Object.keys(MOVED_BEFORE).length).toBeGreaterThan(20);
    const pre = withoutGg7Content(() => withoutEm8Content(() => computePins(true)));
    for (const [k, v] of Object.entries(MOVED_BEFORE)) expect(pre.moved[k], k).toBe(v);
  });
  it("the by-design readings: EM-7 moves exactly the named ones (every hull's Armory slot set, Lab tiers 2 to 4, the Archive)", () => {
    const moved = Object.keys(MOVED_BEFORE).filter((k) => catalogPins.moved[k] !== MOVED_BEFORE[k]).sort();
    expect(moved).toEqual(
      [
        ...HULLS.map((h) => `loadout:${h}`),
        ...[2, 3, 4].flatMap((t) => [`catalog:tier:${t}`, `catalog:fabricator:${t}`, `catalog:research:${t}`]),
        "catalog:archive",
      ].sort(),
    );
    expect(Object.keys(MOVED_AFTER).length).toBe(Object.keys(MOVED_BEFORE).length);
    for (const [k, v] of Object.entries(MOVED_AFTER)) expect(catalogPins.moved[k], k).toBe(v);
  });
});
