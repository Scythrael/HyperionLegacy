// Complement CP-11 goldens (0.14.0, plan docs/plans/2026-10-14-complement-and-acquisition-plan.md CP-11): captured on
// the code BEFORE the crew module and early sensor array blueprints, so the CP-11 commit can show exactly which readings
// moved (by design) and which held.
//
//   HELD (must never move with CP-11: it adds blueprints only; every module and array it makes was already a slot
//   variety with a live catalog row, and no save holds a CP-11 craft, so nothing a player owns changes)
//     module    : the sheet, the crew berths and the dispatch every existing bridge, quarters and sensor variety gives,
//                 installed by hand (Standard, quality 0) on an Aurora, an Eir and a General Freighter.
//     mint      : the inspect mint of the blueprints that already make a quarters or sensor piece (Elite Quarters, the
//                 Bio-Resonance and Resonance arrays): the same seeded roll, the same piece.
//     research  : every pre-CP-11 blueprint's research verdict at Lab levels 0 to 3, with every relic found or none.
//     registry  : every wiring registry row outside CP-11's (ids, statuses, probes; cp11Registry.fixture.ts reads back).
//   MOVED BY DESIGN (CP-11 adds fifteen blueprints; each move is named in the CP-11 commit)
//     catalog   : the blueprint keys; the keys, Fabricator groups and Research sections of Lab tiers 1 to 3; the
//                 Archive's slots and maximum (its completion % drops, the Task 10 precedent: a patch note).
//     unlock    : the blueprints a fresh save's Lab I can research.
//     registry  : the obtainable row's owner (CP-12 alone now) and the row count (thirty added rows).
//
// CP11_CAPTURE = an output path: record every pin instead of asserting (the EM8_CAPTURE pattern).

import { describe, expect, it } from "vitest";
import { cp14OffForThisFile } from "./cp14Switch.fixture";
// Complement CP-19: this file's pins predate the Personnel Rosters track (a new game's facility map gains its
// pre-granted Level 1), so it runs with the slice off; cp19Goldens.test.ts pins the slice itself.
import { cp19OffForThisFile } from "./cp19Switch.fixture";
cp19OffForThisFile();
// Complement CP-14 (hull base sensors and Science amplification) came after every pin here: the file runs with the
// slice off, so its pins keep proving their own slice (cp14Goldens.test.ts pins what CP-14 moved).
cp14OffForThisFile();
import { cp13OffForThisFile } from "./cp13Switch.fixture";
// Complement CP-13 (hull-family module bonuses) came after every pin here: the file runs with the bonus off, so its pins
// keep proving their own slice (cp13Goldens.test.ts pins what CP-13 moved).
cp13OffForThisFile();
import { cp13ReadBack } from "./cp13Registry.fixture"; // Complement CP-13: its added rows read back, innermost
import { cp14ReadBack } from "./cp14Registry.fixture"; // Complement CP-14: its added, flipped and moved rows read back, innermost
import { cp16ReadBack } from "./cp16Registry.fixture"; // Complement CP-16: its added Hall of Command rows read back, innermost
import { cp18ReadBack } from "./cp18Registry.fixture";
import { cp19ReadBack } from "./cp19Registry.fixture";
import { writeFileSync } from "node:fs";
import Decimal from "break_infinity.js";
import { BLUEPRINTS, EQUIPMENT_SLOTS, blueprintResearchable, freshState, type GameState, type ShipTypeKey } from "./model";
import { effectiveShipStats } from "./crewOverlay";
import { quartersCapacityBonus } from "./crewModules";
import { canResearch, inspectBlank } from "./tick";
import { archiveCompletion, archivableBlueprints, maxItemScore } from "./archive";
import { fabricateKeyGroups, researchSectionOf } from "../awayGearDisplay";
import { RELICS } from "./relics";
import { dispatchRun, installPiece, wiringBase, withFacilityLevel } from "./wiring/probes";
import { WIRING_REGISTRY } from "./wiring/registry";
import { hash } from "./firstRunsGoldens.fixture";
import { CP11_BLUEPRINT_KEYS, withoutCp11Content } from "./cp11BlueprintsSwitch.fixture";
import { cp11ReadBack } from "./cp11Registry.fixture";
// Complement CP-12 came after these pins: its Sensor Suite text, its Crew Modules shelf (withoutCp12) and its registry
// flip (cp12ReadBack) are held apart, so every pin here still reads CP-11 alone.
import { withoutCp12 } from "./cp12Switch.fixture";
import { cp12ReadBack } from "./cp12Registry.fixture";

const CAPTURE = Boolean(import.meta.env.CP11_CAPTURE);
const SHIP = "ship-1";
const HULLS: readonly ShipTypeKey[] = ["aurora", "eir", "generalFreighter"];
const shipOf = (s: GameState) => s.ships.find((x) => x.id === SHIP)!;
const REGISTRY = cp12ReadBack(cp13ReadBack(cp14ReadBack(cp16ReadBack(cp18ReadBack(cp19ReadBack(WIRING_REGISTRY))))));

function registryRows(): string[] {
  return cp11ReadBack(REGISTRY).map((e) => `${e.id}|${JSON.stringify(e.status)}|${e.probe ?? ""}|${e.contexts.join(",")}|${e.claim}`);
}

function computePins(): { held: Record<string, string>; moved: Record<string, string> } {
  const held: Record<string, string> = {};
  const moved: Record<string, string> = {};
  // HELD: each existing crew module and array, installed by hand.
  for (const hull of HULLS) {
    for (const slot of ["bridge", "quarters", "sensor"] as const) {
      for (const v of EQUIPMENT_SLOTS[slot].varieties) {
        const s = installPiece(wiringBase(hull), { slotType: slot, moduleVariant: v.key });
        const ship = shipOf(s);
        const run = dispatchRun(s);
        held[`module:${hull}:${v.key}`] = hash({ sheet: effectiveShipStats(s, ship), berths: quartersCapacityBonus(s, ship), scan: run.scanParams });
      }
    }
  }
  // HELD: the existing quarters and sensor blueprints' inspect mint.
  for (const key of ["eliteQuartersBp", "bioResonanceArrayBp", "resonanceSensorArrayBp"]) {
    const s = wiringBase();
    const after = inspectBlank({ ...s, blanks: { ...s.blanks, [key]: new Decimal(1) } }, key);
    held[`mint:${key}`] = hash(after.equipment.filter((e) => !s.equipment.some((x) => x.id === e.id)));
  }
  // HELD: every pre-CP-11 blueprint's research verdict at Lab 0 to 3, relics found or not.
  const preKeys = Object.keys(BLUEPRINTS).filter((k) => !CP11_BLUEPRINT_KEYS.has(k));
  for (let level = 0; level <= 3; level++) {
    for (const relics of [false, true]) {
      const lab = withFacilityLevel(wiringBase(), "research", level);
      const s = relics ? { ...lab, relicDiscovered: RELICS.map((r) => r.id) } : lab;
      held[`research:${level}:${relics ? "relics" : "none"}`] = hash(preKeys.map((k) => [k, canResearch(s, k)]));
    }
  }
  // HELD: every registry row outside CP-11's, read back.
  held["registry:rows"] = hash(registryRows().filter((r) => !r.startsWith("ship:EQUIPMENT_SLOTS:bridge+quarters:obtainable|")));

  // MOVED: the catalog.
  moved["catalog:keys"] = hash(Object.keys(BLUEPRINTS));
  for (const tier of [1, 2, 3]) {
    const keys = Object.values(BLUEPRINTS).filter((bp) => bp.tier === tier).map((bp) => bp.key);
    moved[`catalog:tier:${tier}`] = hash(keys);
    moved[`catalog:fabricator:${tier}`] = hash(fabricateKeyGroups(Object.values(BLUEPRINTS), tier));
    moved[`catalog:research:${tier}`] = hash(keys.map((k) => [k, researchSectionOf(BLUEPRINTS[k])]));
  }
  const archivable = archivableBlueprints();
  moved["catalog:archive"] = hash({ slots: archivable.map((a) => a.key), max: archivable.reduce((a, { bp }) => a + maxItemScore(bp), 0), fresh: archiveCompletion(wiringBase()) });
  // MOVED: what a fresh save's Lab I can research.
  const fresh = withFacilityLevel({ ...freshState(), credits: new Decimal(1e6) }, "research", 1);
  moved["unlock:researchable:lab1"] = hash(Object.keys(BLUEPRINTS).filter((k) => blueprintResearchable(fresh, k)));
  // MOVED: the registry's obtainable row and its row count.
  moved["registry:obtainable"] = hash(REGISTRY.find((e) => e.id === "ship:EQUIPMENT_SLOTS:bridge+quarters:obtainable")?.status);
  moved["registry:count"] = String(REGISTRY.length);
  return { held, moved };
}

// The by-design readings after CP-11 (pinned so a later slice cannot move one unexplained).
const MOVED_AFTER: Record<string, string> = {
  "catalog:keys": "33bbfc86",
  "catalog:tier:1": "32093649",
  "catalog:fabricator:1": "f33d56eb",
  "catalog:research:1": "6bcc7c83",
  "catalog:tier:2": "1dc7a56b",
  "catalog:fabricator:2": "b713c86d",
  "catalog:research:2": "fa1b123f",
  "catalog:tier:3": "102b1131",
  "catalog:fabricator:3": "4d3c2ad0",
  "catalog:research:3": "8fce850f",
  "catalog:archive": "45c2d91",
  "unlock:researchable:lab1": "32093649",
  "registry:obtainable": "95a353a1",
  "registry:count": "1777",
};

// Captured on the pre-CP-11 engine (feat/crew-0.14.0 05b5938).
const HELD_CAPTURE: Record<string, string> = {
  "module:aurora:bridgeBalancedCommand": "3072fd3",
  "module:aurora:bridgeFocusedCommand": "3072fd3",
  "module:aurora:bridgeFlagCommand": "3072fd3",
  "module:aurora:quartersSecurityWing": "fc13ec59",
  "module:aurora:quartersEngineeringWing": "fc13ec59",
  "module:aurora:quartersScienceWing": "fc13ec59",
  "module:aurora:quartersMedicalWing": "fc13ec59",
  "module:aurora:quartersOperationsWing": "fc13ec59",
  "module:aurora:quartersFlightDeckWing": "fc13ec59",
  "module:aurora:quartersUtilitarian": "2b60f7d4",
  "module:aurora:quartersEfficient": "22a25a1",
  "module:aurora:quartersElite": "3072fd3",
  "module:aurora:quartersGuestWing": "279e26f",
  "module:aurora:sensorWideBeam": "6eafb6d1",
  "module:aurora:sensorFocusedBeam": "65e83a89",
  "module:aurora:sensorBalanced": "eca927af",
  "module:aurora:sensorBioResonance": "1717ea5f",
  "module:aurora:sensorResonance": "3072fd3",
  "module:eir:bridgeBalancedCommand": "c02bf956",
  "module:eir:bridgeFocusedCommand": "c02bf956",
  "module:eir:bridgeFlagCommand": "c02bf956",
  "module:eir:quartersSecurityWing": "93b468a4",
  "module:eir:quartersEngineeringWing": "93b468a4",
  "module:eir:quartersScienceWing": "93b468a4",
  "module:eir:quartersMedicalWing": "93b468a4",
  "module:eir:quartersOperationsWing": "93b468a4",
  "module:eir:quartersFlightDeckWing": "93b468a4",
  "module:eir:quartersUtilitarian": "b5b01a53",
  "module:eir:quartersEfficient": "1ee7faa6",
  "module:eir:quartersElite": "c02bf956",
  "module:eir:quartersGuestWing": "6d6305b2",
  "module:eir:sensorWideBeam": "73538fec",
  "module:eir:sensorFocusedBeam": "f0b96066",
  "module:eir:sensorBalanced": "d043a692",
  "module:eir:sensorBioResonance": "f9fc5076",
  "module:eir:sensorResonance": "c02bf956",
  "module:generalFreighter:bridgeBalancedCommand": "61244159",
  "module:generalFreighter:bridgeFocusedCommand": "61244159",
  "module:generalFreighter:bridgeFlagCommand": "61244159",
  "module:generalFreighter:quartersSecurityWing": "28896ea9",
  "module:generalFreighter:quartersEngineeringWing": "28896ea9",
  "module:generalFreighter:quartersScienceWing": "28896ea9",
  "module:generalFreighter:quartersMedicalWing": "28896ea9",
  "module:generalFreighter:quartersOperationsWing": "28896ea9",
  "module:generalFreighter:quartersFlightDeckWing": "28896ea9",
  "module:generalFreighter:quartersUtilitarian": "274fa8e4",
  "module:generalFreighter:quartersEfficient": "27f31cf1",
  "module:generalFreighter:quartersElite": "880c83a3",
  "module:generalFreighter:quartersGuestWing": "c24aa9bf",
  "module:generalFreighter:sensorWideBeam": "9691bc27",
  "module:generalFreighter:sensorFocusedBeam": "907c8af3",
  "module:generalFreighter:sensorBalanced": "c1e9232d",
  "module:generalFreighter:sensorBioResonance": "101c7615",
  "module:generalFreighter:sensorResonance": "61244159",
  "mint:eliteQuartersBp": "b46d61be",
  "mint:bioResonanceArrayBp": "a9c25dae",
  "mint:resonanceSensorArrayBp": "f83398ee",
  "research:0:none": "c3ed2090",
  "research:0:relics": "90e3d20f",
  "research:1:none": "4976d62c",
  "research:1:relics": "5e41262d",
  "research:2:none": "24716ef5",
  "research:2:relics": "fe3a46a3",
  "research:3:none": "66b9501f",
  "research:3:relics": "561e0ff9",
  "registry:rows": "f6d764",
};
const MOVED_BEFORE: Record<string, string> = {
  "catalog:keys": "231ed808",
  "catalog:tier:1": "9ec83d2c",
  "catalog:fabricator:1": "308e5cf2",
  "catalog:research:1": "33c99963",
  "catalog:tier:2": "146bb51",
  "catalog:fabricator:2": "11449f17",
  "catalog:research:2": "d7773872",
  "catalog:tier:3": "9e58d5b8",
  "catalog:fabricator:3": "47701677",
  "catalog:research:3": "410759a1",
  "catalog:archive": "96eef5d1",
  "unlock:researchable:lab1": "9ec83d2c",
  "registry:obtainable": "fc2ce00f",
  "registry:count": "1747",
};

describe("Complement CP-11 goldens (captured before the crew module and array blueprints)", () => {
  if (CAPTURE) {
    it("captures", () => {
      writeFileSync(String(import.meta.env.CP11_CAPTURE), JSON.stringify(computePins(), null, 2));
    });
    return;
  }
  const pins = withoutCp12(() => computePins());
  it("every reading a player already owns holds (each module and array by hand, the existing mints, research verdicts, the registry)", () => {
    expect(Object.keys(HELD_CAPTURE).length).toBeGreaterThan(40);
    expect(Object.keys(pins.held).sort()).toEqual(Object.keys(HELD_CAPTURE).sort());
    for (const [k, v] of Object.entries(HELD_CAPTURE)) expect(pins.held[k], k).toBe(v);
  });
  it("the by-design readings: with CP-11's additions held apart, every one is the pre-CP-11 capture", () => {
    expect(Object.keys(MOVED_BEFORE).length).toBeGreaterThan(10);
    const pre = withoutCp11Content(() => withoutCp12(() => computePins()));
    for (const [k, v] of Object.entries(MOVED_BEFORE)) {
      if (k === "registry:obtainable" || k === "registry:count") continue; // the registry is built once; read back below
      expect(pre.moved[k], k).toBe(v);
    }
    const back = cp11ReadBack(REGISTRY);
    expect(String(back.length)).toBe(MOVED_BEFORE["registry:count"]);
    expect(hash(back.find((e) => e.id === "ship:EQUIPMENT_SLOTS:bridge+quarters:obtainable")?.status)).toBe(MOVED_BEFORE["registry:obtainable"]);
  });
  it("the by-design readings: CP-11 moves exactly the named ones (every one, each to its pinned value)", () => {
    const moved = Object.keys(MOVED_BEFORE).filter((k) => pins.moved[k] !== MOVED_BEFORE[k]).sort();
    expect(moved).toEqual(Object.keys(MOVED_BEFORE).sort());
    expect(Object.keys(MOVED_AFTER).sort()).toEqual(Object.keys(MOVED_BEFORE).sort());
    for (const [k, v] of Object.entries(MOVED_AFTER)) expect(pins.moved[k], k).toBe(v);
    // Thirty registry rows: each blueprint's research row and its effect row.
    expect(Number(MOVED_AFTER["registry:count"]) - Number(MOVED_BEFORE["registry:count"])).toBe(2 * CP11_BLUEPRINT_KEYS.size);
  });
});
