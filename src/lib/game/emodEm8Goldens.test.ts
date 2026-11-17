// E-MOD EM-8 goldens (0.14.0, plan docs/plans/2026-10-17-material-lines-and-emod-plan.md section 4 EM-8): captured on
// the code BEFORE the Precursor Lens special module, its discovery-gated blueprint and the Precursor Circuit's consumer,
// so the EM-8 commit can show exactly which readings moved (by design) and which held.
//
//   HELD (must never move with EM-8: no save holds a Precursor Lens module, and a run in flight replays its own stamp)
//     dispatch  : an Orion and an Aurora expedition dispatched with no module (the frozen scan procs, scan speed, relic
//                 find) and the discoveries their bodies roll (the real roll, 24 synthetic bodies each).
//     inFlight  : a run whose dispatch froze a body-scan proc (Expedition.moduleScanProcs) rolls its bodies exactly as
//                 before: the stamp is read, never the catalog, so a catalog number cannot move a run already out.
//     museum    : the Precursor set's per-copy and tier bonuses for a Museum holding Precursor Lens copies.
//     sell      : the Precursor Circuit's Quartermaster price (WR-11) and its sale.
//     sheet     : the Aurora's sheet and power budget with no module.
//   MOVED BY DESIGN (EM-8 adds the module, its blueprint and the circuit's recipe; each move is named in the EM-8 commit)
//     unlock    : blueprintsUnlockedByRelic("precursorLens") and the blueprints a top Research Lab can start once a
//                 Precursor Lens is identified (it opens one project).
//     catalog   : Lab tier 2's blueprint keys, Fabricator groups and Research sections, the Archive's slots and maximum.
//     slot      : the module slot's varieties and each hull's Armory slot set (the varieties are the catalog).
//     item      : the Precursor Circuit's ItemDef (its reserve marker drops and its hint names the recipe).
//
// EM8_CAPTURE = an output path: record every pin instead of asserting (the EM7_CAPTURE pattern).

import { describe, expect, it } from "vitest";
import { cp14OffForThisFile } from "./cp14Switch.fixture";
import { crewModuleSiOffForThisFile } from "./crewModuleSiSwitch.fixture";

// Standard-Issue crew modules (0.14.0, user 2026-11-17 "free basic set, all ships"): this file's pins predate the
// free Sensor Suite, Bridge Module and Crew Quarters every ship now carries (their berths, officer lift, hull bonus
// and equipment ids), so the set is off here and the pins keep proving their own slice. The set itself is pinned in
// crewModuleStandardIssue.test.ts.
crewModuleSiOffForThisFile();
// Complement CP-14 (hull base sensors and Science amplification) came after every pin here: the file runs with the
// slice off, so its pins keep proving their own slice (cp14Goldens.test.ts pins what CP-14 moved).
cp14OffForThisFile();
import { writeFileSync } from "node:fs";
import Decimal from "break_infinity.js";
import { BLUEPRINTS, EQUIPMENT_SLOTS, ITEMS, blueprintResearchable, blueprintsUnlockedByRelic, type Expedition, type GameState } from "./model";
import { effectiveShipStats } from "./crewOverlay";
import { shipPowerBudget } from "./shipPower";
import { rollBodyDiscoveries } from "./expedition";
import { archiveCompletion, archivableBlueprints, maxItemScore } from "./archive";
import { fabricateKeyGroups, researchSectionOf } from "../awayGearDisplay";
import { museumBonusesFromRecord } from "./relics";
import { sellItem } from "./quartermaster";
import { PLANET_TYPES } from "./expeditionContent";
import { dispatchRun, holding, syntheticBody, wiringBase, withFacilityLevel } from "./wiring/probes";
import { hash } from "./firstRunsGoldens.fixture";
import { withoutEm8Content } from "./emodEm8Switch.fixture";
import { withoutCp11Content } from "./cp11BlueprintsSwitch.fixture";

const CAPTURE = Boolean(import.meta.env.EM8_CAPTURE);
const SHIP = "ship-1";
const shipOf = (s: GameState) => s.ships.find((x) => x.id === SHIP)!;

// The real discovery roll of `run` over every planet type, `per` body indices each.
function discoveriesOf(run: Expedition, per: number): unknown {
  const out: unknown[] = [];
  for (const p of PLANET_TYPES) {
    for (let i = 0; i < per; i++) out.push(rollBodyDiscoveries(run, { ...syntheticBody(p.id, 0), id: `em8-${p.id}-${i}` }, i).map((d) => [d.kind, d.poiId]));
  }
  return out;
}

function computePins(): { held: Record<string, string>; moved: Record<string, string> } {
  const held: Record<string, string> = {};
  const moved: Record<string, string> = {};
  for (const hull of ["orion", "aurora"] as const) {
    const run = dispatchRun(wiringBase(hull));
    held[`dispatch:${hull}`] = hash({ moduleScanProcs: run.moduleScanProcs ?? null, scanSpeedBonus: run.scanSpeedBonus, relicFindBonus: run.relicFindBonus });
    held[`discoveries:${hull}`] = hash(discoveriesOf(run, 3));
    // A run out when EM-8 lands, its dispatch having frozen a body-scan proc (any module id, any chance).
    for (const [tag, chanceUnits] of [["low", 150_000], ["half", 500_000], ["sure", 1_000_000]] as const) {
      const flying: Expedition = { ...run, moduleScanProcs: [{ moduleId: "precursorLens", chanceUnits, count: 1 }] };
      held[`inFlight:${hull}:${tag}`] = hash(discoveriesOf(flying, 4));
    }
  }
  held["museum:lens"] = hash(museumBonusesFromRecord({ glyphTablet: 45, resonanceShard: 41, starChartFragment: 22, precursorLens: 18 }));
  held["museum:lensOnly"] = hash(museumBonusesFromRecord({ precursorLens: 7 }));
  const sold = sellItem(holding(wiringBase(), "precursorCircuit", new Decimal(2)), "precursorCircuit", new Decimal(2));
  held["sell:precursorCircuit"] = hash({ value: ITEMS.precursorCircuit.sellValue, ok: sold.ok, credited: sold.ok ? String(sold.credited) : null });
  const aurora = wiringBase("aurora");
  held["sheet:aurora"] = hash({ sheet: effectiveShipStats(aurora, shipOf(aurora)), power: shipPowerBudget(aurora, SHIP) });

  moved["unlock:relic"] = hash(blueprintsUnlockedByRelic("precursorLens").map((b) => b.key));
  const lab = withFacilityLevel(wiringBase(), "research", 9);
  const researchable = (s: GameState) => Object.keys(BLUEPRINTS).filter((k) => blueprintResearchable(s, k));
  moved["unlock:researchable:undiscovered"] = hash(researchable(lab));
  moved["unlock:researchable:discovered"] = hash(researchable({ ...lab, relicDiscovered: [...(lab.relicDiscovered ?? []), "precursorLens"] }));
  const keys = Object.values(BLUEPRINTS).filter((bp) => bp.tier === 2).map((bp) => bp.key);
  moved["catalog:tier:2"] = hash(keys);
  moved["catalog:fabricator:2"] = hash(fabricateKeyGroups(Object.values(BLUEPRINTS), 2));
  moved["catalog:research:2"] = hash(keys.map((k) => [k, researchSectionOf(BLUEPRINTS[k])]));
  const archivable = archivableBlueprints();
  moved["catalog:archive"] = hash({ slots: archivable.map((a) => a.key), max: archivable.reduce((a, { bp }) => a + maxItemScore(bp), 0), fresh: archiveCompletion(wiringBase()) });
  moved["slot:module"] = hash(EQUIPMENT_SLOTS.module.varieties);
  moved["item:precursorCircuit"] = hash(ITEMS.precursorCircuit);
  return { held, moved };
}

// The by-design readings after EM-8 (pinned so a later slice cannot move one unexplained).
const MOVED_AFTER: Record<string, string> = {
  "unlock:relic": "d409324c",
  "unlock:researchable:undiscovered": "45b79745",
  "unlock:researchable:discovered": "39881208",
  "catalog:tier:2": "146bb51",
  "catalog:fabricator:2": "11449f17",
  "catalog:research:2": "d7773872",
  "catalog:archive": "96eef5d1",
  "slot:module": "79c34827",
  "item:precursorCircuit": "6b43be67",
};

// Captured on the pre-EM-8 engine (feat/crew-0.14.0 7c553ac).
const HELD: Record<string, string> = {
  "dispatch:orion": "e69c87e0",
  "discoveries:orion": "212c7888",
  "inFlight:orion:low": "b38f5f1f",
  "inFlight:orion:half": "cd37cd5",
  "inFlight:orion:sure": "a32c644",
  "dispatch:aurora": "e69c87e0",
  "discoveries:aurora": "212c7888",
  "inFlight:aurora:low": "b38f5f1f",
  "inFlight:aurora:half": "cd37cd5",
  "inFlight:aurora:sure": "a32c644",
  "museum:lens": "1f3dcad4",
  "museum:lensOnly": "f457a6c6",
  "sell:precursorCircuit": "9e65d5fd",
  "sheet:aurora": "b3fce2eb",
};
const MOVED_BEFORE: Record<string, string> = {
  "unlock:relic": "741638a5",
  "unlock:researchable:undiscovered": "45b79745",
  "unlock:researchable:discovered": "45b79745",
  "catalog:tier:2": "400c2de",
  "catalog:fabricator:2": "ee7fbf14",
  "catalog:research:2": "9c25116c",
  "catalog:archive": "a336c620",
  "slot:module": "6f131eb4",
  "item:precursorCircuit": "1e3442a2",
};

describe("E-MOD EM-8 goldens (captured before the Precursor Lens)", () => {
  if (CAPTURE) {
    it("captures", () => {
      writeFileSync(String(import.meta.env.EM8_CAPTURE), JSON.stringify(computePins(), null, 2));
    });
    return;
  }
  const pins = computePins();
  // Complement CP-11 came after this capture: its crew module and sensor array blueprints join the catalog readings
  // (tier 2, the researchable lists, the Archive), so the by-design readings hold them apart (cp11BlueprintsSwitch.fixture.ts).
  const catalogPins = withoutCp11Content(() => computePins());
  it("every reading a player already owns holds (module-free dispatch and discoveries, runs in flight, the Museum, the sale)", () => {
    expect(Object.keys(HELD).length).toBeGreaterThan(10);
    for (const [k, v] of Object.entries(HELD)) expect(pins.held[k], k).toBe(v);
  });
  // EM-8 moved the by-design readings. With its additions held apart (emodEm8Switch.fixture.ts) every one is the
  // pre-EM-8 capture: the proof that the Lens, its blueprint and the circuit's recipe are the whole move.
  it("the by-design readings: with EM-8's additions held apart, every one is the pre-EM-8 capture", () => {
    expect(Object.keys(MOVED_BEFORE).length).toBeGreaterThan(8);
    const pre = withoutCp11Content(() => withoutEm8Content(() => computePins()));
    for (const [k, v] of Object.entries(MOVED_BEFORE)) expect(pre.moved[k], k).toBe(v);
    for (const [k, v] of Object.entries(HELD)) expect(pre.held[k], k).toBe(v);
  });
  it("the by-design readings: EM-8 moves exactly the named ones", () => {
    const moved = Object.keys(MOVED_BEFORE).filter((k) => catalogPins.moved[k] !== MOVED_BEFORE[k]).sort();
    // Unmoved: the researchable list before any Precursor Lens is identified (the project stays masked and locked).
    expect(moved).toEqual(Object.keys(MOVED_BEFORE).filter((k) => k !== "unlock:researchable:undiscovered").sort());
    expect(Object.keys(MOVED_AFTER).sort()).toEqual(Object.keys(MOVED_BEFORE).sort());
    for (const [k, v] of Object.entries(MOVED_AFTER)) expect(catalogPins.moved[k], k).toBe(v);
  });
});
