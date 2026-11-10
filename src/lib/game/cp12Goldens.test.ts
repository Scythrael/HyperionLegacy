// Complement CP-12 goldens (0.14.0, plan docs/plans/2026-10-14-complement-and-acquisition-plan.md CP-12): captured on
// the code BEFORE the Bridge Module and Crew Quarters install tiles and the Sensor Suite rename, so the CP-12 commit can
// show exactly which readings moved (by design) and which held.
//
//   HELD (must never move with CP-12: the tiles route through the existing install engine, so no rule, draw or save
//   byte changes)
//     install : every bridge and quarters variety, a spare installed through fitEquipment (the engine the tiles call)
//               on an Aurora, an Eir and a General Freighter with an Operations officer seated: the sheet, the berths,
//               the slot; then uninstalled through unfitEquipmentInstance: the slot left EMPTY, the piece a spare again.
//     keep    : a quarters module installed, the complement filled to the raised cap, the module uninstalled and the
//               fill run again: the headcount never drops (CP-5 "Never evict"); the Elite Quarters adds 0 berths (WR-7).
//     save    : a fleet holding an installed bridge and quarters module (and a sensor array), serialized, and the same
//               save through deserialize + migrate + serialize: the bytes.
//     registry: every wiring registry row but the obtainable one (ids, statuses, probes, contexts, claims).
//   MOVED BY DESIGN (each named in the CP-12 commit; withoutCp12 + cp12ReadBack reproduce the capture)
//     text    : the sensor slot's display name (OC-25 "Slot = Sensor Suite") and the sensor blueprints' install line and
//               craft line label.
//     shelf   : the Fabricator's Item groups per tier (bridge and quarters get a Crew Modules group).
//     (fix round, user 2026-11-04) shelf: the Research list's sections per tier (a Crew Modules section, mockup CMR-9);
//               text: the quarters slot's display name ("Crew Quarters" everywhere). Their before values are not new
//               captures: the research ones are cp11Goldens' MOVED_AFTER catalog:research pins (CP-11's after is CP-12's
//               before, the same formula), and the quarters text hashes ea653ec's label, "Crew Quarters Module".
//     registry: the obtainable row flips live.
//
// CP12_CAPTURE = an output path: record every pin instead of asserting (the CP11_CAPTURE pattern).

import { describe, expect, it } from "vitest";
import { cp14OffForThisFile } from "./cp14Switch.fixture";
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
import { writeFileSync } from "node:fs";
import { BLUEPRINTS, EQUIPMENT_SLOTS, equipmentSlotGroupLabel, equipmentSlotLabel, type CrewBucket, type GameState, type ShipTypeKey } from "./model";
import { effectiveShipStats } from "./crewOverlay";
import { quartersCapacityBonus } from "./crewModules";
import { fitEquipment, fittedInSlot, unfitEquipmentInstance } from "./equipment";
import { resolveCrew } from "./crewOverlay";
import { CREW_PROFESSIONS } from "./commandStructure";
import { craftLineOutputLabel } from "./craftQueue";
import { deserialize, migrate, serialize } from "./save";
import { fabricateKeyGroups, researchSectionOf } from "../awayGearDisplay";
import { editShip, installPiece, seatOfficer, shipOf, wiringBase, WIRING_SHIP_ID } from "./wiring/probes";
import { WIRING_REGISTRY, type WiringEntry } from "./wiring/registry";
import { hash } from "./firstRunsGoldens.fixture";
import { withoutCp12 } from "./cp12Switch.fixture";
import { CP12_FLIPPED_ID, cp12ReadBack } from "./cp12Registry.fixture";

const CAPTURE = Boolean(import.meta.env.CP12_CAPTURE);
const HULLS: readonly ShipTypeKey[] = ["aurora", "eir", "generalFreighter"];
const SPARE = "cp12-spare";

const rowLine = (e: WiringEntry): string =>
  `${e.id}|${JSON.stringify(e.status)}|${e.probe ?? ""}|${e.contexts.join(",")}|${e.claim}|${e.direction}|${JSON.stringify(e.curve)}|${e.note ?? ""}`;

// A spare piece of `slot` / `variety` in the pool (Standard, quality 0), ship-1 with an Operations officer seated.
function withSpare(hull: ShipTypeKey, slot: string, variety: string): GameState {
  const s = installPiece(seatOfficer(wiringBase(hull), "operations", ["ops.cargoExpand"]), { id: SPARE, slotType: slot, moduleVariant: variety });
  return { ...s, equipment: s.equipment.map((e) => (e.id === SPARE ? { ...e, fittedToShipId: null } : e)) };
}

// A deep pool holding every division at every rank, ship-1 passive: the fill the passive tick path runs.
function deepPool(): CrewBucket[] {
  const pool: CrewBucket[] = [];
  for (const profession of CREW_PROFESSIONS) {
    for (let rank = 1; rank <= 8; rank += 1) pool.push({ profession, rarity: "standard", rank, race: "belter", buff1Id: "wiring.none", buff2Id: null, count: 1000 } as CrewBucket);
  }
  return pool;
}
const headcount = (s: GameState): number => (shipOf(s).complement?.buckets ?? []).reduce((a, b) => a + b.count, 0);
const fill = (s: GameState): GameState => resolveCrew({ ...s, crewPool: deepPool() });

function computePins(entries: readonly WiringEntry[]): { held: Record<string, string>; moved: Record<string, string> } {
  const held: Record<string, string> = {};
  const moved: Record<string, string> = {};
  // HELD: install and uninstall each bridge and quarters variety through the engine.
  for (const hull of HULLS) {
    for (const slot of ["bridge", "quarters"] as const) {
      for (const v of EQUIPMENT_SLOTS[slot].varieties) {
        const s = withSpare(hull, slot, v.key);
        const on = fitEquipment(s, WIRING_SHIP_ID, SPARE);
        const off = unfitEquipmentInstance(on, WIRING_SHIP_ID, SPARE);
        held[`install:${hull}:${v.key}`] = hash({
          sheet: effectiveShipStats(on, shipOf(on)),
          berths: quartersCapacityBonus(on, shipOf(on)),
          slot: fittedInSlot(on, WIRING_SHIP_ID, slot)?.id ?? null,
          offSheet: effectiveShipStats(off, shipOf(off)),
          offSlot: fittedInSlot(off, WIRING_SHIP_ID, slot)?.id ?? null,
          offPiece: off.equipment.find((e) => e.id === SPARE),
        });
      }
    }
  }
  // HELD: never evict; Elite Quarters adds 0 berths.
  for (const hull of ["aurora", "generalFreighter"] as const) {
    for (const v of ["quartersUtilitarian", "quartersEfficient", "quartersElite", "quartersGuestWing"]) {
      const bare = fill(editShip(wiringBase(hull), { complement: { buckets: [], mode: "passive" } }));
      const s = withSpare(hull, "quarters", v);
      const on = fill(editShip(fitEquipment(s, WIRING_SHIP_ID, SPARE), { complement: { buckets: [], mode: "passive" } }));
      const off = unfitEquipmentInstance(on, WIRING_SHIP_ID, SPARE);
      const again = fill(off);
      held[`keep:${hull}:${v}`] = hash({ bare: headcount(bare), on: headcount(on), off: headcount(off), again: headcount(again), berths: quartersCapacityBonus(on, shipOf(on)) });
    }
  }
  // HELD: the save bytes.
  {
    let s = installPiece(seatOfficer(wiringBase("aurora"), "science", ["ops.cargoExpand"]), { id: "cp12-bridge", slotType: "bridge", moduleVariant: "bridgeBalancedCommand" });
    s = installPiece(s, { id: "cp12-quarters", slotType: "quarters", moduleVariant: "quartersUtilitarian" });
    s = installPiece(s, { id: "cp12-sensor", slotType: "sensor", moduleVariant: "sensorWideBeam" });
    const raw = serialize(s, 0, 0);
    const loaded = deserialize(raw);
    held["save:bytes"] = hash(raw);
    held["save:roundTrip"] = hash(loaded === null ? null : serialize(migrate(loaded), 0, 0));
  }
  // HELD: every registry row but the obtainable one.
  held["registry:rows"] = hash(entries.filter((e) => e.id !== CP12_FLIPPED_ID).map(rowLine));

  // MOVED: the slot's display name and the sensor blueprints' lines.
  moved["text:sensorSlot"] = hash([EQUIPMENT_SLOTS.sensor.label, equipmentSlotLabel("sensor"), equipmentSlotLabel("sensor", "sensorWideBeam"), equipmentSlotGroupLabel("sensor")]);
  const sensorBps = Object.values(BLUEPRINTS).filter((bp) => bp.equipmentOutput?.slotType === "sensor");
  moved["text:sensorHints"] = hash(sensorBps.map((bp) => [bp.key, bp.unlockHint ?? null]));
  moved["text:sensorCraftLabels"] = hash(sensorBps.map((bp) => [bp.key, craftLineOutputLabel("fabricate", bp.key)]));
  // MOVED: the Fabricator's Item groups.
  for (const tier of [1, 2, 3]) moved[`shelf:fabricator:${tier}`] = hash(fabricateKeyGroups(Object.values(BLUEPRINTS), tier));
  // MOVED (fix round): the Research list's sections (cp11Goldens' catalog:research formula) and the quarters slot's name.
  for (const tier of [1, 2, 3]) {
    const keys = Object.values(BLUEPRINTS).filter((bp) => bp.tier === tier).map((bp) => bp.key);
    moved[`shelf:research:${tier}`] = hash(keys.map((k) => [k, researchSectionOf(BLUEPRINTS[k])]));
  }
  moved["text:quartersSlot"] = hash([EQUIPMENT_SLOTS.quarters.label, equipmentSlotLabel("quarters"), equipmentSlotLabel("quarters", "quartersGuestWing"), equipmentSlotGroupLabel("quarters")]);
  // MOVED: the obtainable row.
  const row = entries.find((e) => e.id === CP12_FLIPPED_ID);
  moved["registry:obtainable"] = hash(row === undefined ? null : rowLine(row));
  return { held, moved };
}

// Captured on the pre-CP-12 code (feat/crew-0.14.0 ea653ec).
const HELD_CAPTURE: Record<string, string> = {
  "install:aurora:bridgeBalancedCommand": "e26cce8",
  "install:aurora:bridgeFocusedCommand": "d743e012",
  "install:aurora:bridgeFlagCommand": "9cc7ee9e",
  "install:aurora:quartersSecurityWing": "465878ed",
  "install:aurora:quartersEngineeringWing": "905b1d1c",
  "install:aurora:quartersScienceWing": "683db523",
  "install:aurora:quartersMedicalWing": "7e9b48ec",
  "install:aurora:quartersOperationsWing": "c276ddb9",
  "install:aurora:quartersFlightDeckWing": "9b92a31a",
  "install:aurora:quartersUtilitarian": "7754857d",
  "install:aurora:quartersEfficient": "d49b5ddf",
  "install:aurora:quartersElite": "9d3fc383",
  "install:aurora:quartersGuestWing": "8b8e769f",
  "install:eir:bridgeBalancedCommand": "b0afdfba",
  "install:eir:bridgeFocusedCommand": "ea866e4a",
  "install:eir:bridgeFlagCommand": "11268b5f",
  "install:eir:quartersSecurityWing": "f6f2f1a9",
  "install:eir:quartersEngineeringWing": "8d1e4688",
  "install:eir:quartersScienceWing": "16ad2a7",
  "install:eir:quartersMedicalWing": "e87bf468",
  "install:eir:quartersOperationsWing": "a939e655",
  "install:eir:quartersFlightDeckWing": "e492d91e",
  "install:eir:quartersUtilitarian": "1d2b39a1",
  "install:eir:quartersEfficient": "6fcb1b75",
  "install:eir:quartersElite": "7f65f31b",
  "install:eir:quartersGuestWing": "ed4cdf7f",
  "install:generalFreighter:bridgeBalancedCommand": "821d7214",
  "install:generalFreighter:bridgeFocusedCommand": "20813438",
  "install:generalFreighter:bridgeFlagCommand": "b2e0b1c",
  "install:generalFreighter:quartersSecurityWing": "7e6239df",
  "install:generalFreighter:quartersEngineeringWing": "a20ee4ce",
  "install:generalFreighter:quartersScienceWing": "e0a43bad",
  "install:generalFreighter:quartersMedicalWing": "be0525b2",
  "install:generalFreighter:quartersOperationsWing": "5067068b",
  "install:generalFreighter:quartersFlightDeckWing": "16d70280",
  "install:generalFreighter:quartersUtilitarian": "6660da31",
  "install:generalFreighter:quartersEfficient": "db531f",
  "install:generalFreighter:quartersElite": "7a35a46d",
  "install:generalFreighter:quartersGuestWing": "d0084ed",
  "keep:aurora:quartersUtilitarian": "57bb0977",
  "keep:aurora:quartersEfficient": "5fa3b121",
  "keep:aurora:quartersElite": "34e1d055",
  "keep:aurora:quartersGuestWing": "a2e02845",
  "keep:generalFreighter:quartersUtilitarian": "a06d5289",
  "keep:generalFreighter:quartersEfficient": "54e6e059",
  "keep:generalFreighter:quartersElite": "d0529ba5",
  "keep:generalFreighter:quartersGuestWing": "8e9f3ad6",
  "save:bytes": "c095e8d6",
  "save:roundTrip": "de493c1e",
  "registry:rows": "805cd5b9",
};
const MOVED_BEFORE: Record<string, string> = {
  "text:sensorSlot": "c811afb1",
  "text:sensorHints": "b4650cd8",
  "text:sensorCraftLabels": "e0087940",
  "shelf:fabricator:1": "f33d56eb",
  "shelf:fabricator:2": "b713c86d",
  "shelf:fabricator:3": "4d3c2ad0",
  "registry:obtainable": "c261096e",
  // Fix round: cp11Goldens MOVED_AFTER catalog:research:1..3, and ea653ec's quarters label (see the header).
  "shelf:research:1": "6bcc7c83",
  "shelf:research:2": "fa1b123f",
  "shelf:research:3": "8fce850f",
  "text:quartersSlot": "6f2fe775",
};
// The by-design readings after CP-12 (pinned so a later slice cannot move one unexplained).
const MOVED_AFTER: Record<string, string> = {
  "text:sensorSlot": "4bfaaa4d",
  "text:sensorHints": "8eb2b814",
  "text:sensorCraftLabels": "c4c3098d",
  "shelf:fabricator:1": "52b7d60b",
  "shelf:fabricator:2": "c937cf0d",
  "shelf:fabricator:3": "57d238e0",
  "registry:obtainable": "ba584f7a",
  "shelf:research:1": "11cb891f",
  "shelf:research:2": "e335f0cf",
  "shelf:research:3": "3095ba53",
  "text:quartersSlot": "5b8c6245",
};

describe("Complement CP-12 goldens (captured before the Bridge Module and Crew Quarters tiles)", () => {
  if (CAPTURE) {
    it("captures", () => {
      writeFileSync(String(import.meta.env.CP12_CAPTURE), JSON.stringify(computePins(cp13ReadBack(cp14ReadBack(cp16ReadBack(cp18ReadBack(WIRING_REGISTRY))))), null, 2));
    });
    return;
  }
  const pins = computePins(cp13ReadBack(cp14ReadBack(cp16ReadBack(cp18ReadBack(WIRING_REGISTRY)))));
  it("every reading a player already owns holds (install and uninstall of each module, never evict, the save bytes, the registry)", () => {
    expect(Object.keys(HELD_CAPTURE).length).toBeGreaterThan(40);
    expect(Object.keys(pins.held).sort()).toEqual(Object.keys(HELD_CAPTURE).sort());
    for (const [k, v] of Object.entries(HELD_CAPTURE)) expect(pins.held[k], k).toBe(v);
  });
  it("the by-design readings: with CP-12 held apart, every one is the pre-CP-12 capture", () => {
    expect(Object.keys(MOVED_BEFORE).length).toBeGreaterThan(5);
    const pre = withoutCp12(() => computePins(cp12ReadBack(cp13ReadBack(cp14ReadBack(cp16ReadBack(cp18ReadBack(WIRING_REGISTRY)))))));
    expect(Object.keys(pre.moved).sort()).toEqual(Object.keys(MOVED_BEFORE).sort());
    for (const [k, v] of Object.entries(MOVED_BEFORE)) expect(pre.moved[k], k).toBe(v);
    // The held readings agree with the switch on as well (the switch touches only the moved readings).
    for (const [k, v] of Object.entries(HELD_CAPTURE)) if (k !== "registry:rows") expect(pre.held[k], k).toBe(v);
  });
  it("the by-design readings: CP-12 moves exactly the named ones (every one, each to its pinned value)", () => {
    const moved = Object.keys(MOVED_BEFORE).filter((k) => pins.moved[k] !== MOVED_BEFORE[k]).sort();
    expect(moved).toEqual(Object.keys(MOVED_BEFORE).sort());
    expect(Object.keys(MOVED_AFTER).sort()).toEqual(Object.keys(MOVED_BEFORE).sort());
    for (const [k, v] of Object.entries(MOVED_AFTER)) expect(pins.moved[k], k).toBe(v);
  });
  it("the never-evict rule: an uninstalled quarters module never lowers the headcount; the Elite Quarters adds no berths", () => {
    for (const hull of ["aurora", "generalFreighter"] as const) {
      const s = withSpare(hull, "quarters", "quartersUtilitarian");
      const on = fill(editShip(fitEquipment(s, WIRING_SHIP_ID, SPARE), { complement: { buckets: [], mode: "passive" } }));
      const off = unfitEquipmentInstance(on, WIRING_SHIP_ID, SPARE);
      expect(headcount(off)).toBe(headcount(on));
      expect(headcount(fill(off))).toBe(headcount(on));
      expect(fittedInSlot(off, WIRING_SHIP_ID, "quarters")).toBeNull();
      const elite = fitEquipment(withSpare(hull, "quarters", "quartersElite"), WIRING_SHIP_ID, SPARE);
      expect(quartersCapacityBonus(elite, shipOf(elite))).toBe(0);
    }
  });
});
