// WR-7 goldens (0.14.0, plan docs/plans/2026-10-15-wiring-registry-and-audit-plan.md section 4 WR-7): captured on the
// code BEFORE the ship-system wiring, so every WR-7 commit shows exactly which readings moved (by design, each named in
// its commit) and which held.
//
//   rolls    : 40 mints of every ship slot variety at Standard and Luminous (OC-D6 statRatios: "Unlisted = never
//              rolls" moves the varieties whose pools hold unlisted keys).
//   sheet    : effectiveShipStats, the Damage Control and Pathfinder effects of every hull with each favored-spec piece
//              installed (OC-D5 favorsSpec: "+10% on its ship type").
//   arrays   : an Orion Ground Ops run with each sensor array, its scan rate and the discoveries of its bodies (OC-D11:
//              coverage width drives the discovery attempts, cadence alone drives the scan speed).
//   repair   : an Orion run with a Damage Control Suite: its frozen ship-event battle and a field repair's seconds
//              (OC-D10: "Field repairs too").
//   crew     : every crew module with and without its rolled lines: capacity, division and officer multipliers and
//              the per-division room of an empty complement (OC-D3 module lines, OC-D7 quarters capacity).
//   patrol   : one Dispatch Once cycle of the first patrol for every combat hull (OC-D8: patrol legs scale with the
//              ship's transit speed).
//
// WR7_CAPTURE = an output path: record every pin instead of asserting.

import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import {
  EQUIPMENT_SLOTS,
  MEMBER_SLOT_TYPES,
  SHIP_TYPES,
  type CrewProfession,
  type EquipmentRarity,
  type EquipmentSlotType,
  type GameState,
  type ShipTypeKey,
} from "./model";
import { generateEquipment } from "./itemgen";
import { makeRng } from "./combat/rng";
import { effectiveShipStats } from "./crewOverlay";
import { equippedFor } from "./equipmentQueries";
import { damageControlEffect, pathfinderEffect } from "./utilityGear";
import { advanceExpedition, scanRatePerSecond } from "./expedition";
import { fieldRepairSeconds } from "./groundOps";
import { SENSOR_ARRAYS } from "./sensorArrays";
import { BRIDGE_MODULES, QUARTERS_MODULES, bridgeOfficerMultiplier, installedBridgeModule, installedQuartersModule, quartersCapacityBonus, quartersProfessionMultiplier } from "./crewModules";
import { CREW_PROFESSIONS, remainingCapacityForSignature } from "./commandStructure";
import { combatHullTypeOf } from "./combat/bridge";
import { combatBase, dispatchRun, installPiece, patrolDigest, readProbe, wiringBase } from "./wiring/probes";
import { hash } from "./firstRunsGoldens.fixture";

const CAPTURE = import.meta.env.WR7_CAPTURE as string | undefined;
const HULLS = Object.keys(SHIP_TYPES) as ShipTypeKey[];
const SHIP = "ship-1";
const shipOf = (s: GameState) => s.ships.find((x) => x.id === SHIP)!;

function rollPins(out: Record<string, string>): void {
  for (const [slotType, slot] of Object.entries(EQUIPMENT_SLOTS)) {
    if ((MEMBER_SLOT_TYPES as readonly string[]).includes(slotType)) continue;
    for (const v of slot.varieties) {
      for (const rarity of ["standard", "luminous"] as EquipmentRarity[]) {
        const rolls: Record<string, number>[] = [];
        for (let seed = 1; seed <= 40; seed++) {
          const rng = makeRng(seed * 2 + 1);
          const piece = generateEquipment({
            slotType: slotType as EquipmentSlotType,
            varietyKey: v.key,
            blueprintKey: null,
            iLevel: 20,
            quality: 0,
            rarity,
            ascension: "none",
            rng: () => rng.next(),
            allocateId: () => "wr7",
          });
          rolls.push({ ...piece.rolledStats, mass: piece.mass, draw: piece.powerDraw });
        }
        out[`rolls:${slotType}:${v.key}:${rarity}`] = hash(rolls);
      }
    }
  }
}

// The favored-spec pieces (each variety that names a favorsSpec), at the lines a crafted piece carries.
const FAVORED: readonly { slotType: string; blueprintKey: string; moduleVariant?: string; implicitStats: Record<string, number>; rolledStats: Record<string, number> }[] = [
  { slotType: "cargoBay", blueprintKey: "prospectorHoldBp", implicitStats: { cargoCapacity: 20 }, rolledStats: { engineEfficiency: 4 } },
  { slotType: "specUtility", blueprintKey: "yieldRigBp", implicitStats: { extractionYieldMult: 12 }, rolledStats: { sensors: 4, materialQualityChance: 6 } },
  { slotType: "specUtility", blueprintKey: "damageControlSuiteBp", moduleVariant: "damageControlSuite", implicitStats: { repairSpeed: 10, waveHullRegen: 10 }, rolledStats: {} },
  { slotType: "specUtility", blueprintKey: "pathfinderSuiteBp", moduleVariant: "pathfinderSuite", implicitStats: { sensors: 8, expeditionScanSpeed: 10, hazardResist: 10 }, rolledStats: {} },
];

function sheetPins(out: Record<string, string>): void {
  for (const hull of HULLS) {
    for (const p of FAVORED) {
      const s = installPiece(wiringBase(hull), p);
      const gear = equippedFor(s, SHIP);
      out[`sheet:${hull}:${p.blueprintKey}`] = hash({ sheet: effectiveShipStats(s, shipOf(s)), dc: damageControlEffect(gear), pf: pathfinderEffect(gear) });
    }
  }
}

function arrayPins(out: Record<string, string>): void {
  for (const def of [null, ...SENSOR_ARRAYS]) {
    const base = wiringBase("orion");
    const s = def ? installPiece(base, { slotType: "sensor", moduleVariant: def.id, implicitStats: { sensors: 10 } }) : base;
    const run = dispatchRun(s);
    const done = advanceExpedition(structuredClone(run), run.phaseAnchorSeconds + 30 * 86400);
    out[`arrays:${def?.id ?? "none"}`] = hash({
      scanParams: run.scanParams,
      rates: run.bodies.map((b) => scanRatePerSecond(run, b)),
      discoveries: done.bodies.map((b) => b.discoveries.map((d) => d.poiId)),
    });
  }
}

function repairPins(out: Record<string, string>): void {
  for (const points of [0, 10, 40]) {
    const base = wiringBase("orion");
    const s = points === 0 ? base : installPiece(base, { slotType: "specUtility", moduleVariant: "damageControlSuite", implicitStats: { repairSpeed: points } });
    const run = dispatchRun(s);
    const battle = run.groundOps?.shipEventProfile.battle;
    out[`repair:${points}`] = hash({ battle: battle ?? null, seconds: [100, 400].map((d) => [fieldRepairSeconds(d, battle?.repairSpeed ?? 0, true), fieldRepairSeconds(d, battle?.repairSpeed ?? 0, false)]) });
  }
}

function crewPins(out: Record<string, string>): void {
  const variants = [...QUARTERS_MODULES.map((m) => ({ slotType: "quarters", id: m.id })), ...BRIDGE_MODULES.map((m) => ({ slotType: "bridge", id: m.id }))];
  for (const hull of ["generalFreighter", "destroyer", "eir"] as ShipTypeKey[]) {
    for (const v of variants) {
      for (const lines of [{}, { crewStations: 12, crewEfficiency: 8 }] as Record<string, number>[]) {
        const s = installPiece(wiringBase(hull), { slotType: v.slotType, moduleVariant: v.id, implicitStats: {}, rolledStats: lines });
        const ship = shipOf(s);
        const q = installedQuartersModule(s, ship);
        const b = installedBridgeModule(s, ship);
        const bonus = quartersCapacityBonus(s, ship);
        const room = Object.fromEntries(
          (CREW_PROFESSIONS as readonly CrewProfession[]).map((p) => [p, remainingCapacityForSignature({ buckets: [] } as never, hull, { profession: p, rank: 1 } as never, bonus)]),
        );
        out[`crew:${hull}:${v.id}:${Object.keys(lines).length > 0 ? "lines" : "bare"}`] = hash({
          bonus,
          mult: q ? CREW_PROFESSIONS.map((p) => quartersProfessionMultiplier(q, p)) : null,
          officer: b ? bridgeOfficerMultiplier(b, { seat: "tactical", rank: 3 } as never, "tactician") : null,
          room,
        });
      }
    }
  }
}

function patrolPins(out: Record<string, string>): void {
  for (const hull of HULLS) {
    if (combatHullTypeOf(hull) === null) continue;
    const s = combatBase(hull);
    out[`patrol:${hull}`] = hash({ legs: readProbe("patrolOutboundTicks", s, "patrol"), cycle: patrolDigest(s) });
    const fast = installPiece(s, { slotType: "ftlDrive", implicitStats: { transitSpeedMult: 30 } });
    out[`patrol:${hull}:fastDrive`] = hash({ legs: readProbe("patrolOutboundTicks", fast, "patrol"), cycle: patrolDigest(fast) });
  }
}

function computePins(): Record<string, string> {
  const out: Record<string, string> = {};
  rollPins(out);
  sheetPins(out);
  arrayPins(out);
  repairPins(out);
  crewPins(out);
  patrolPins(out);
  return out;
}

// Captured on the pre-WR-7 engine (feat/crew-0.14.0 4ff232e), then re-pinned by the WR-7 wiring commit. MOVED, every one
// by design (the rest held):
//   rolls  : the 38 ship varieties whose statRatios leave a pool stat unlisted (OC-D6 "Unlisted = never rolls"), and the
//            plating and emitter varieties (they list the resist lines at VARIETY_RESIST_RATIO now). Held: the fully listed
//            Balanced Hold and Damage Control Suite, and every empty-ratio variety (modules, arrays, crew modules).
//   arrays : the Wide-Beam and Focused-Beam runs only (coverage not 1: OC-D11's split). Held: no array, Balanced,
//            Bio-Resonance, Resonance (coverage 1).
//   repair : the Damage Control Suite runs (the frozen dcRepairTimeReduction and the shorter field repair, OC-D10). Held:
//            no suite.
//   crew   : every quarters module with berths (the bonus spreads across the divisions, OC-D7) and every module with its
//            lines (OC-D3). Held: the Elite Quarters and the bridges without lines.
//   Held whole: sheet (favorsSpec, OC-D5, is not built) and patrol (the patrol legs, OC-D8, are not built).
// Re-pinned by the WR-7 review round (user answers 2026-10-29): arrays:sensorWideBeam / sensorFocusedBeam (the coverage
// retune to even finds per hour) and every quarters ":lines" row (12 Crew Stations points now add 0 berths on the small
// curve, and the Elite Quarters none). Nothing else moved.
const PINS: Record<string, string> = {
  "rolls:cargoBay:prospectorHold:standard": "27bcb56a",
  "rolls:cargoBay:prospectorHold:luminous": "50b569ad",
  "rolls:cargoBay:balancedHold:standard": "5ab7f34a",
  "rolls:cargoBay:balancedHold:luminous": "aa79bfda",
  "rolls:cargoBay:haulerHold:standard": "bd4e6d4d",
  "rolls:cargoBay:haulerHold:luminous": "f5b22db8",
  "rolls:ftlDrive:sprintDrive:standard": "d72c6363",
  "rolls:ftlDrive:sprintDrive:luminous": "bc098034",
  "rolls:ftlDrive:economyDrive:standard": "125cc9c9",
  "rolls:ftlDrive:economyDrive:luminous": "bfa9f39a",
  "rolls:ftlDrive:balancedDrive:standard": "4f6cf0c9",
  "rolls:ftlDrive:balancedDrive:luminous": "9cd1756b",
  "rolls:reactorCore:highOutputCore:standard": "a32596cd",
  "rolls:reactorCore:highOutputCore:luminous": "b94a62f9",
  "rolls:reactorCore:efficientCore:standard": "1a8c2b1",
  "rolls:reactorCore:efficientCore:luminous": "b7b1ae4d",
  "rolls:reactorCore:balancedCore:standard": "b0c6189f",
  "rolls:reactorCore:balancedCore:luminous": "b7b1ae4d",
  "rolls:specUtility:yieldRig:standard": "1f747170",
  "rolls:specUtility:yieldRig:luminous": "c6f13b60",
  "rolls:specUtility:surveyRig:standard": "5f9e817a",
  "rolls:specUtility:surveyRig:luminous": "6d06bf17",
  "rolls:specUtility:refineryFeedRig:standard": "a026566f",
  "rolls:specUtility:refineryFeedRig:luminous": "87a8fcb0",
  "rolls:specUtility:damageControlSuite:standard": "942e3615",
  "rolls:specUtility:damageControlSuite:luminous": "d56c8b6f",
  "rolls:specUtility:pathfinderSuite:standard": "d07942ab",
  "rolls:specUtility:pathfinderSuite:luminous": "19686d8e",
  "rolls:shieldEmitters:capacitorBank:standard": "3c81b94",
  "rolls:shieldEmitters:capacitorBank:luminous": "4254ebed",
  "rolls:shieldEmitters:rechargeArray:standard": "f8f25940",
  "rolls:shieldEmitters:rechargeArray:luminous": "bb9bf8d3",
  "rolls:shieldEmitters:balancedEmitter:standard": "fe92de38",
  "rolls:shieldEmitters:balancedEmitter:luminous": "72886ead",
  "rolls:hullPlating:reinforcedPlating:standard": "375e08e2",
  "rolls:hullPlating:reinforcedPlating:luminous": "95f05222",
  "rolls:hullPlating:ablativePlating:standard": "ecf08909",
  "rolls:hullPlating:ablativePlating:luminous": "3edf009",
  "rolls:hullPlating:compositePlating:standard": "fd83d403",
  "rolls:hullPlating:compositePlating:luminous": "7ba5738f",
  "rolls:hullPlating:pressureForgedPlating:standard": "416c9ea6",
  "rolls:hullPlating:pressureForgedPlating:luminous": "69e326c7",
  "rolls:bridge:bridgeBalancedCommand:standard": "1439871d",
  "rolls:bridge:bridgeBalancedCommand:luminous": "31758b8f",
  "rolls:bridge:bridgeFocusedCommand:standard": "1439871d",
  "rolls:bridge:bridgeFocusedCommand:luminous": "31758b8f",
  "rolls:bridge:bridgeFlagCommand:standard": "1439871d",
  "rolls:bridge:bridgeFlagCommand:luminous": "31758b8f",
  "rolls:quarters:quartersSecurityWing:standard": "9eabe1ff",
  "rolls:quarters:quartersSecurityWing:luminous": "5b919715",
  "rolls:quarters:quartersEngineeringWing:standard": "9eabe1ff",
  "rolls:quarters:quartersEngineeringWing:luminous": "5b919715",
  "rolls:quarters:quartersScienceWing:standard": "9eabe1ff",
  "rolls:quarters:quartersScienceWing:luminous": "5b919715",
  "rolls:quarters:quartersMedicalWing:standard": "9eabe1ff",
  "rolls:quarters:quartersMedicalWing:luminous": "5b919715",
  "rolls:quarters:quartersOperationsWing:standard": "9eabe1ff",
  "rolls:quarters:quartersOperationsWing:luminous": "5b919715",
  "rolls:quarters:quartersFlightDeckWing:standard": "9eabe1ff",
  "rolls:quarters:quartersFlightDeckWing:luminous": "5b919715",
  "rolls:quarters:quartersUtilitarian:standard": "9eabe1ff",
  "rolls:quarters:quartersUtilitarian:luminous": "5b919715",
  "rolls:quarters:quartersEfficient:standard": "9eabe1ff",
  "rolls:quarters:quartersEfficient:luminous": "5b919715",
  "rolls:quarters:quartersElite:standard": "9eabe1ff",
  "rolls:quarters:quartersElite:luminous": "5b919715",
  "rolls:quarters:quartersGuestWing:standard": "9eabe1ff",
  "rolls:quarters:quartersGuestWing:luminous": "5b919715",
  "rolls:sensor:sensorWideBeam:standard": "b5b8c4bd",
  "rolls:sensor:sensorWideBeam:luminous": "75fb85f1",
  "rolls:sensor:sensorFocusedBeam:standard": "b5b8c4bd",
  "rolls:sensor:sensorFocusedBeam:luminous": "75fb85f1",
  "rolls:sensor:sensorBalanced:standard": "b5b8c4bd",
  "rolls:sensor:sensorBalanced:luminous": "75fb85f1",
  "rolls:sensor:sensorBioResonance:standard": "b5b8c4bd",
  "rolls:sensor:sensorBioResonance:luminous": "75fb85f1",
  "rolls:sensor:sensorResonance:standard": "b5b8c4bd",
  "rolls:sensor:sensorResonance:luminous": "75fb85f1",
  "rolls:module:auxiliaryCapacitor:standard": "a2e9ec3d",
  "rolls:module:auxiliaryCapacitor:luminous": "a2e9ec3d",
  "rolls:module:structuralBracing:standard": "64f5d24d",
  "rolls:module:structuralBracing:luminous": "64f5d24d",
  "rolls:module:arcDischarger:standard": "79377b3d",
  "rolls:module:arcDischarger:luminous": "79377b3d",
  "rolls:module:prospectorsEcho:standard": "c65708fd",
  "rolls:module:prospectorsEcho:luminous": "c65708fd",
  "rolls:module:lastStandProtocol:standard": "c65708fd",
  "rolls:module:lastStandProtocol:luminous": "c65708fd",
  "rolls:module:shieldSurge:standard": "795ebacd",
  "rolls:module:shieldSurge:luminous": "795ebacd",
  "rolls:module:longBaselineArray:standard": "795ebacd",
  "rolls:module:longBaselineArray:luminous": "795ebacd",
  "rolls:module:signalIntegrator:standard": "ce9a841d",
  "rolls:module:signalIntegrator:luminous": "ce9a841d",
  "rolls:module:ramscoopCollector:standard": "795ebacd",
  "rolls:module:ramscoopCollector:luminous": "795ebacd",
  "sheet:generalFreighter:prospectorHoldBp": "e3f3e1aa",
  "sheet:generalFreighter:yieldRigBp": "3d568b41",
  "sheet:generalFreighter:damageControlSuiteBp": "d1342ae6",
  "sheet:generalFreighter:pathfinderSuiteBp": "dc777399",
  "sheet:prospectorHauler:prospectorHoldBp": "2360d96f",
  "sheet:prospectorHauler:yieldRigBp": "69303f2c",
  "sheet:prospectorHauler:damageControlSuiteBp": "4ce8e4e5",
  "sheet:prospectorHauler:pathfinderSuiteBp": "8e57e12c",
  "sheet:prospectorRunner:prospectorHoldBp": "5ac635c5",
  "sheet:prospectorRunner:yieldRigBp": "a9433d46",
  "sheet:prospectorRunner:damageControlSuiteBp": "337a457f",
  "sheet:prospectorRunner:pathfinderSuiteBp": "a21c3492",
  "sheet:prospectorMiner:prospectorHoldBp": "ad5bb6b4",
  "sheet:prospectorMiner:yieldRigBp": "41fd0611",
  "sheet:prospectorMiner:damageControlSuiteBp": "7692c53d",
  "sheet:prospectorMiner:pathfinderSuiteBp": "80b66754",
  "sheet:destroyer:prospectorHoldBp": "3ebc0429",
  "sheet:destroyer:yieldRigBp": "81a35737",
  "sheet:destroyer:damageControlSuiteBp": "4445df94",
  "sheet:destroyer:pathfinderSuiteBp": "8a91fd1b",
  "sheet:battleship:prospectorHoldBp": "fcf10679",
  "sheet:battleship:yieldRigBp": "a528dca9",
  "sheet:battleship:damageControlSuiteBp": "5dbc3304",
  "sheet:battleship:pathfinderSuiteBp": "dd9bb58b",
  "sheet:carrier:prospectorHoldBp": "b28bb586",
  "sheet:carrier:yieldRigBp": "db285149",
  "sheet:carrier:damageControlSuiteBp": "f92cffca",
  "sheet:carrier:pathfinderSuiteBp": "367b39d5",
  "sheet:orion:prospectorHoldBp": "cc0049b9",
  "sheet:orion:yieldRigBp": "a42fb6",
  "sheet:orion:damageControlSuiteBp": "732e0d31",
  "sheet:orion:pathfinderSuiteBp": "65135d60",
  "sheet:aurora:prospectorHoldBp": "bac24126",
  "sheet:aurora:yieldRigBp": "f7a2eb91",
  "sheet:aurora:damageControlSuiteBp": "d0b4d134",
  "sheet:aurora:pathfinderSuiteBp": "b49ce06b",
  "sheet:eir:prospectorHoldBp": "c8ee5668",
  "sheet:eir:yieldRigBp": "6d34f2f6",
  "sheet:eir:damageControlSuiteBp": "6d93f9df",
  "sheet:eir:pathfinderSuiteBp": "8fc21592",
  "arrays:none": "543de03c",
  "arrays:sensorWideBeam": "5c2622bc",
  "arrays:sensorFocusedBeam": "b20d7523",
  "arrays:sensorBalanced": "2f1a493d",
  "arrays:sensorBioResonance": "51fc8b5e",
  "arrays:sensorResonance": "2093e121",
  "repair:0": "6776496f",
  "repair:10": "e353ccd1",
  "repair:40": "ff9907c1",
  "crew:generalFreighter:quartersSecurityWing:bare": "8da353ac",
  "crew:generalFreighter:quartersSecurityWing:lines": "204e951b",
  "crew:generalFreighter:quartersEngineeringWing:bare": "1d7c6cf8",
  "crew:generalFreighter:quartersEngineeringWing:lines": "e56a242b",
  "crew:generalFreighter:quartersScienceWing:bare": "6be58c5c",
  "crew:generalFreighter:quartersScienceWing:lines": "c963515b",
  "crew:generalFreighter:quartersMedicalWing:bare": "db6c8f38",
  "crew:generalFreighter:quartersMedicalWing:lines": "85a891db",
  "crew:generalFreighter:quartersOperationsWing:bare": "76ddf45c",
  "crew:generalFreighter:quartersOperationsWing:lines": "c023cab",
  "crew:generalFreighter:quartersFlightDeckWing:bare": "8fd1b4a8",
  "crew:generalFreighter:quartersFlightDeckWing:lines": "87307d5b",
  "crew:generalFreighter:quartersUtilitarian:bare": "88a8c1f0",
  "crew:generalFreighter:quartersUtilitarian:lines": "74ce73ec",
  "crew:generalFreighter:quartersEfficient:bare": "1dee9c8a",
  "crew:generalFreighter:quartersEfficient:lines": "b3310b48",
  "crew:generalFreighter:quartersElite:bare": "5877721a",
  "crew:generalFreighter:quartersElite:lines": "1d34ba58",
  "crew:generalFreighter:quartersGuestWing:bare": "c5001e03",
  "crew:generalFreighter:quartersGuestWing:lines": "c5001e03",
  "crew:generalFreighter:bridgeBalancedCommand:bare": "1c51537e",
  "crew:generalFreighter:bridgeBalancedCommand:lines": "3ca97108",
  "crew:generalFreighter:bridgeFocusedCommand:bare": "1d5aa080",
  "crew:generalFreighter:bridgeFocusedCommand:lines": "d2e0826e",
  "crew:generalFreighter:bridgeFlagCommand:bare": "9dba07bb",
  "crew:generalFreighter:bridgeFlagCommand:lines": "9dba07bb",
  "crew:destroyer:quartersSecurityWing:bare": "605e6ea7",
  "crew:destroyer:quartersSecurityWing:lines": "c147ced4",
  "crew:destroyer:quartersEngineeringWing:bare": "d93a26b3",
  "crew:destroyer:quartersEngineeringWing:lines": "eded5f64",
  "crew:destroyer:quartersScienceWing:bare": "4957",
  "crew:destroyer:quartersScienceWing:lines": "7b90d614",
  "crew:destroyer:quartersMedicalWing:bare": "4c1097f3",
  "crew:destroyer:quartersMedicalWing:lines": "1d099e94",
  "crew:destroyer:quartersOperationsWing:bare": "bc173157",
  "crew:destroyer:quartersOperationsWing:lines": "220e7fe4",
  "crew:destroyer:quartersFlightDeckWing:bare": "a18c23e3",
  "crew:destroyer:quartersFlightDeckWing:lines": "2404c214",
  "crew:destroyer:quartersUtilitarian:bare": "c14acdb9",
  "crew:destroyer:quartersUtilitarian:lines": "2351e455",
  "crew:destroyer:quartersEfficient:bare": "3eb5ea4e",
  "crew:destroyer:quartersEfficient:lines": "b55ef85c",
  "crew:destroyer:quartersElite:bare": "4b934e11",
  "crew:destroyer:quartersElite:lines": "d98a6c83",
  "crew:destroyer:quartersGuestWing:bare": "a4198624",
  "crew:destroyer:quartersGuestWing:lines": "a4198624",
  "crew:destroyer:bridgeBalancedCommand:bare": "d6c2e2ad",
  "crew:destroyer:bridgeBalancedCommand:lines": "3c1366b3",
  "crew:destroyer:bridgeFocusedCommand:bare": "123b12bb",
  "crew:destroyer:bridgeFocusedCommand:lines": "88880c1d",
  "crew:destroyer:bridgeFlagCommand:bare": "fac6ee42",
  "crew:destroyer:bridgeFlagCommand:lines": "fac6ee42",
  "crew:eir:quartersSecurityWing:bare": "3cb6ae5",
  "crew:eir:quartersSecurityWing:lines": "1f93f67e",
  "crew:eir:quartersEngineeringWing:bare": "6a6005d1",
  "crew:eir:quartersEngineeringWing:lines": "51500b4e",
  "crew:eir:quartersScienceWing:bare": "b17dc795",
  "crew:eir:quartersScienceWing:lines": "d35fa1be",
  "crew:eir:quartersMedicalWing:bare": "60589d11",
  "crew:eir:quartersMedicalWing:lines": "bbbc723e",
  "crew:eir:quartersOperationsWing:bare": "b21b2f95",
  "crew:eir:quartersOperationsWing:lines": "8482b3ce",
  "crew:eir:quartersFlightDeckWing:bare": "5ee7aa81",
  "crew:eir:quartersFlightDeckWing:lines": "1a264dbe",
  "crew:eir:quartersUtilitarian:bare": "f3006743",
  "crew:eir:quartersUtilitarian:lines": "cfa873ff",
  "crew:eir:quartersEfficient:bare": "44dd9519",
  "crew:eir:quartersEfficient:lines": "6816114b",
  "crew:eir:quartersElite:bare": "6c08136",
  "crew:eir:quartersElite:lines": "1f44cc0",
  "crew:eir:quartersGuestWing:bare": "158af6b",
  "crew:eir:quartersGuestWing:lines": "158af6b",
  "crew:eir:bridgeBalancedCommand:bare": "bce2411a",
  "crew:eir:bridgeBalancedCommand:lines": "323b7bf0",
  "crew:eir:bridgeFocusedCommand:bare": "8c8f1cc8",
  "crew:eir:bridgeFocusedCommand:lines": "e175f30a",
  "crew:eir:bridgeFlagCommand:bare": "d4b7f4f5",
  "crew:eir:bridgeFlagCommand:lines": "d4b7f4f5",
  "patrol:generalFreighter": "5eb9fc4c",
  "patrol:generalFreighter:fastDrive": "24f7588f",
  "patrol:prospectorHauler": "6d3278a3",
  "patrol:prospectorHauler:fastDrive": "cb2b81e",
  "patrol:prospectorRunner": "7947d073",
  "patrol:prospectorRunner:fastDrive": "4a9e888a",
  "patrol:prospectorMiner": "f9c38de2",
  "patrol:prospectorMiner:fastDrive": "ebc14c6c",
  "patrol:destroyer": "c79c3507",
  "patrol:destroyer:fastDrive": "fe083fc3",
  "patrol:battleship": "1a1a7871",
  "patrol:battleship:fastDrive": "2b88da6e",
  "patrol:carrier": "bc6578ac",
  "patrol:carrier:fastDrive": "f613d397",
  "patrol:orion": "4e8dc7da",
  "patrol:orion:fastDrive": "5661c949",
  "patrol:aurora": "5ff0f071",
  "patrol:aurora:fastDrive": "321757f5",
  "patrol:eir": "fbfea59",
  "patrol:eir:fastDrive": "f79bdd19",
};

describe("WR-7 goldens", () => {
  it("every reading matches its pin (moves are named in MOVED)", () => {
    const now = computePins();
    if (CAPTURE) {
      writeFileSync(CAPTURE, JSON.stringify(now, null, 2));
      return;
    }
    expect(now).toEqual(PINS);
  }, 600_000);
});
