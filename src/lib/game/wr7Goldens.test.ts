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
      for (const lines of [{}, { crewStations: 12, crewEfficiency: 8 }]) {
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

// Captured on the pre-WR-7 engine (feat/crew-0.14.0 4ff232e).
const PINS: Record<string, string> = {
  "rolls:cargoBay:prospectorHold:standard": "9fe6d407",
  "rolls:cargoBay:prospectorHold:luminous": "a9dd8ff0",
  "rolls:cargoBay:balancedHold:standard": "5ab7f34a",
  "rolls:cargoBay:balancedHold:luminous": "aa79bfda",
  "rolls:cargoBay:haulerHold:standard": "cfc29dc6",
  "rolls:cargoBay:haulerHold:luminous": "c5cc04ca",
  "rolls:ftlDrive:sprintDrive:standard": "1ff353d1",
  "rolls:ftlDrive:sprintDrive:luminous": "d061fafd",
  "rolls:ftlDrive:economyDrive:standard": "fcaca199",
  "rolls:ftlDrive:economyDrive:luminous": "d614ee47",
  "rolls:ftlDrive:balancedDrive:standard": "d68bc79a",
  "rolls:ftlDrive:balancedDrive:luminous": "43f144ac",
  "rolls:reactorCore:highOutputCore:standard": "e19e1db8",
  "rolls:reactorCore:highOutputCore:luminous": "564cd8db",
  "rolls:reactorCore:efficientCore:standard": "d020833d",
  "rolls:reactorCore:efficientCore:luminous": "71c6b654",
  "rolls:reactorCore:balancedCore:standard": "f58203a8",
  "rolls:reactorCore:balancedCore:luminous": "bf780f19",
  "rolls:specUtility:yieldRig:standard": "5dbd04f8",
  "rolls:specUtility:yieldRig:luminous": "694c1088",
  "rolls:specUtility:surveyRig:standard": "921bc030",
  "rolls:specUtility:surveyRig:luminous": "b53f8e28",
  "rolls:specUtility:refineryFeedRig:standard": "924a600d",
  "rolls:specUtility:refineryFeedRig:luminous": "447700d3",
  "rolls:specUtility:damageControlSuite:standard": "942e3615",
  "rolls:specUtility:damageControlSuite:luminous": "d56c8b6f",
  "rolls:specUtility:pathfinderSuite:standard": "3360ca8",
  "rolls:specUtility:pathfinderSuite:luminous": "cc2a4a85",
  "rolls:shieldEmitters:capacitorBank:standard": "f10dbd59",
  "rolls:shieldEmitters:capacitorBank:luminous": "734433a8",
  "rolls:shieldEmitters:rechargeArray:standard": "c8dd7220",
  "rolls:shieldEmitters:rechargeArray:luminous": "d08832ed",
  "rolls:shieldEmitters:balancedEmitter:standard": "9d8aca5d",
  "rolls:shieldEmitters:balancedEmitter:luminous": "8c0ccaaf",
  "rolls:hullPlating:reinforcedPlating:standard": "f36494c0",
  "rolls:hullPlating:reinforcedPlating:luminous": "4e03160a",
  "rolls:hullPlating:ablativePlating:standard": "e2e9f753",
  "rolls:hullPlating:ablativePlating:luminous": "4ab2de4c",
  "rolls:hullPlating:compositePlating:standard": "88acf122",
  "rolls:hullPlating:compositePlating:luminous": "c3f3d704",
  "rolls:hullPlating:pressureForgedPlating:standard": "6ca71c85",
  "rolls:hullPlating:pressureForgedPlating:luminous": "e229759e",
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
  "arrays:sensorWideBeam": "3a3e60ac",
  "arrays:sensorFocusedBeam": "8589b39d",
  "arrays:sensorBalanced": "2f1a493d",
  "arrays:sensorBioResonance": "51fc8b5e",
  "arrays:sensorResonance": "2093e121",
  "repair:0": "6776496f",
  "repair:10": "6776496f",
  "repair:40": "6776496f",
  "crew:generalFreighter:quartersSecurityWing:bare": "37b6201",
  "crew:generalFreighter:quartersSecurityWing:lines": "37b6201",
  "crew:generalFreighter:quartersEngineeringWing:bare": "af2b651d",
  "crew:generalFreighter:quartersEngineeringWing:lines": "af2b651d",
  "crew:generalFreighter:quartersScienceWing:bare": "55306a31",
  "crew:generalFreighter:quartersScienceWing:lines": "55306a31",
  "crew:generalFreighter:quartersMedicalWing:bare": "2ec7d2dd",
  "crew:generalFreighter:quartersMedicalWing:lines": "2ec7d2dd",
  "crew:generalFreighter:quartersOperationsWing:bare": "55376231",
  "crew:generalFreighter:quartersOperationsWing:lines": "55376231",
  "crew:generalFreighter:quartersFlightDeckWing:bare": "f7797f4d",
  "crew:generalFreighter:quartersFlightDeckWing:lines": "f7797f4d",
  "crew:generalFreighter:quartersUtilitarian:bare": "a78bf319",
  "crew:generalFreighter:quartersUtilitarian:lines": "a78bf319",
  "crew:generalFreighter:quartersEfficient:bare": "1bc2e318",
  "crew:generalFreighter:quartersEfficient:lines": "1bc2e318",
  "crew:generalFreighter:quartersElite:bare": "5877721a",
  "crew:generalFreighter:quartersElite:lines": "5877721a",
  "crew:generalFreighter:quartersGuestWing:bare": "c9ef4a92",
  "crew:generalFreighter:quartersGuestWing:lines": "c9ef4a92",
  "crew:generalFreighter:bridgeBalancedCommand:bare": "1c51537e",
  "crew:generalFreighter:bridgeBalancedCommand:lines": "1c51537e",
  "crew:generalFreighter:bridgeFocusedCommand:bare": "1d5aa080",
  "crew:generalFreighter:bridgeFocusedCommand:lines": "1d5aa080",
  "crew:generalFreighter:bridgeFlagCommand:bare": "9dba07bb",
  "crew:generalFreighter:bridgeFlagCommand:lines": "9dba07bb",
  "crew:destroyer:quartersSecurityWing:bare": "1b99705c",
  "crew:destroyer:quartersSecurityWing:lines": "1b99705c",
  "crew:destroyer:quartersEngineeringWing:bare": "b9902bd0",
  "crew:destroyer:quartersEngineeringWing:lines": "b9902bd0",
  "crew:destroyer:quartersScienceWing:bare": "5069380c",
  "crew:destroyer:quartersScienceWing:lines": "5069380c",
  "crew:destroyer:quartersMedicalWing:bare": "872df410",
  "crew:destroyer:quartersMedicalWing:lines": "872df410",
  "crew:destroyer:quartersOperationsWing:bare": "c80200c",
  "crew:destroyer:quartersOperationsWing:lines": "c80200c",
  "crew:destroyer:quartersFlightDeckWing:bare": "3f64f100",
  "crew:destroyer:quartersFlightDeckWing:lines": "3f64f100",
  "crew:destroyer:quartersUtilitarian:bare": "1a75ea44",
  "crew:destroyer:quartersUtilitarian:lines": "1a75ea44",
  "crew:destroyer:quartersEfficient:bare": "a7f5a1c3",
  "crew:destroyer:quartersEfficient:lines": "a7f5a1c3",
  "crew:destroyer:quartersElite:bare": "4b934e11",
  "crew:destroyer:quartersElite:lines": "4b934e11",
  "crew:destroyer:quartersGuestWing:bare": "1710d459",
  "crew:destroyer:quartersGuestWing:lines": "1710d459",
  "crew:destroyer:bridgeBalancedCommand:bare": "d6c2e2ad",
  "crew:destroyer:bridgeBalancedCommand:lines": "d6c2e2ad",
  "crew:destroyer:bridgeFocusedCommand:bare": "123b12bb",
  "crew:destroyer:bridgeFocusedCommand:lines": "123b12bb",
  "crew:destroyer:bridgeFlagCommand:bare": "fac6ee42",
  "crew:destroyer:bridgeFlagCommand:lines": "fac6ee42",
  "crew:eir:quartersSecurityWing:bare": "f39d431f",
  "crew:eir:quartersSecurityWing:lines": "f39d431f",
  "crew:eir:quartersEngineeringWing:bare": "d5b7a9bb",
  "crew:eir:quartersEngineeringWing:lines": "d5b7a9bb",
  "crew:eir:quartersScienceWing:bare": "6cb6594f",
  "crew:eir:quartersScienceWing:lines": "6cb6594f",
  "crew:eir:quartersMedicalWing:bare": "ec74b5fb",
  "crew:eir:quartersMedicalWing:lines": "ec74b5fb",
  "crew:eir:quartersOperationsWing:bare": "6d53c14f",
  "crew:eir:quartersOperationsWing:lines": "6d53c14f",
  "crew:eir:quartersFlightDeckWing:bare": "79f15ab",
  "crew:eir:quartersFlightDeckWing:lines": "79f15ab",
  "crew:eir:quartersUtilitarian:bare": "7a5237b7",
  "crew:eir:quartersUtilitarian:lines": "7a5237b7",
  "crew:eir:quartersEfficient:bare": "a565b300",
  "crew:eir:quartersEfficient:lines": "a565b300",
  "crew:eir:quartersElite:bare": "6c08136",
  "crew:eir:quartersElite:lines": "6c08136",
  "crew:eir:quartersGuestWing:bare": "37b63c8e",
  "crew:eir:quartersGuestWing:lines": "37b63c8e",
  "crew:eir:bridgeBalancedCommand:bare": "bce2411a",
  "crew:eir:bridgeBalancedCommand:lines": "bce2411a",
  "crew:eir:bridgeFocusedCommand:bare": "8c8f1cc8",
  "crew:eir:bridgeFocusedCommand:lines": "8c8f1cc8",
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
