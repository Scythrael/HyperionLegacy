// ============================================================================
// fuel-flow-summary.test.ts
//
// Author: Claude Opus 4.8 · 2026-07-16
// Covers the DISPLAY-ONLY fuel-economy summary helper `fuelFlowSummary(state)`
// added to tick.ts. This helper exists to fix a UI bug: the top-bar fuel chip
// and Fuel Depot "REFINING" panel were subtracting mission burn from the
// refinery's THEORETICAL MAX throughput (a ceiling) UNCONDITIONALLY, so when the
// player was OUT of Deuterium Ice, when the refinery actually produces 0, the
// Net still read POSITIVE. The player reported: "even when I'm out of deuterium
// ice, it's still showing a net positive."
//
// fuelFlowSummary mirrors processFuelPipelines' EXACT refining gate (tick.ts):
//   - ice on hand = state.inventory["deuteriumIce"] ?? 0  (Decimal)
//   - refining stops when: pipelines <= 0, OR fuel >= fuelCap (tank full),
//     OR iceOnHand < fuelBatchInput (ice out).
// so `effectiveProductionPerTick` is 0 exactly when the real refinery makes 0.
//
// It is a PURE read-only helper (no state mutation), it does NOT touch the tick
// engine. These tests pin the gate + net-sign + sufficiency contract the UI reads.
// ============================================================================

import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import { fuelFlowSummary } from "./tick";
import { itemTotal } from "./inventory"; // Task 9a: read item TOTAL across quality buckets
import { fuelNeeded } from "./fuel"; // folded-burn match assertion
import {
  freshState,
  FUEL_TANK_BASE_CAP,
  SHIP_TYPES,
  MISSIONS,
  shipDerivedStats,
  effectiveMissionDef,
  requiredTicksForPhase,
  type GameState,
  type CaptainMissionState,
  type MissionPhase,
  type EquipmentInstance,
} from "./model";

// A fresh state with a chosen Fuel Depot (fuelStorage) level, ice reserve, and
// starting fuel, the SAME construction idiom fuel-depot.test.ts uses so the
// pipeline / cap / ice gates are exercised against known level-0 numbers. Its
// single seeded captain (id 1) stays IDLE (mission: null) unless burnStates
// below re-assigns it, so burnPerTick is 0 in the base case.
function depotState(opts: { deuteriumIce?: number; fuel?: number; fuelStorageLevel?: number }): GameState {
  const s = freshState();
  const inventory: Record<string, Decimal[]> = { ...s.inventory };
  if (opts.deuteriumIce !== undefined) inventory.deuteriumIce = [new Decimal(opts.deuteriumIce)];
  return {
    ...s,
    inventory,
    fuel: new Decimal(opts.fuel ?? 0),
    facilities: { ...s.facilities, fuelStorage: { level: opts.fuelStorageLevel ?? 0 } },
  };
}

// depotState, but with the seeded captain (id 1, flying the seeded "ship-1"
// General Freighter) put ON a fuel-burning mission (shortOreRun, transitOut/back
// 25 ticks each, so fuelNeeded > 0). This drives burnPerTick > 0, which is what
// makes the ICE-OUT net strictly NEGATIVE (the bug's proof). cargo carries the
// three loot-material keys at 0 (fuelFlowSummary never reads cargo, but a real
// CaptainMissionState requires the shape).
function burningState(opts: { deuteriumIce?: number; fuel?: number; fuelStorageLevel?: number }): GameState {
  const s = depotState(opts);
  const mission: CaptainMissionState = {
    kind: "extraction",
    missionKey: "shortOreRun",
    phase: "transitOut" as MissionPhase,
    phaseProgressTicks: 0,
    cargo: {
      commonOre: new Decimal(0),
      uncommonMaterial: new Decimal(0),
      rareMaterial: new Decimal(0),
    },
    recalled: false,
  };
  const captains = s.captains.map((c, i) => (i === 0 ? { ...c, mission } : c));
  return { ...s, captains };
}

// Level-0 refinery constants (verified in fuel-depot.test.ts):
//   1 pipeline * 100 fuel/batch / 10 ticks = 10 fuel/tick MAX production
//   1 pipeline *  50 ice/batch  / 10 ticks =  5 ice/tick input
//   one batch needs 50 ice on hand to start.
const MAX_PROD = 10;
const ICE_INPUT = 5;
const ONE_BATCH_ICE = 50;

describe("fuelFlowSummary, production ceiling vs effective (ice gate)", () => {
  it("(a) ice present + tank not full: effectiveProduction == max, net == max - burn", () => {
    // Idle captain -> burn 0, so net == effectiveProduction == max.
    const summary = fuelFlowSummary(depotState({ deuteriumIce: 100, fuel: 0 }));
    expect(summary.maxProductionPerTick).toBe(MAX_PROD);
    expect(summary.effectiveProductionPerTick).toBe(MAX_PROD);
    expect(summary.iceInputPerTick).toBe(ICE_INPUT);
    expect(summary.burnPerTick).toBe(0);
    expect(summary.netPerTick).toBe(MAX_PROD - 0);
    expect(summary.hasIce).toBe(true);
    expect(summary.tankFull).toBe(false);
    expect(summary.refiningActive).toBe(true);
    expect(summary.sufficient).toBe(true);
  });

  it("(a') ice present + burning captain: net == max - burn (burn > 0, net still positive here)", () => {
    const summary = fuelFlowSummary(burningState({ deuteriumIce: 100, fuel: 0 }));
    expect(summary.effectiveProductionPerTick).toBe(MAX_PROD);
    expect(summary.burnPerTick).toBeGreaterThan(0);
    expect(summary.netPerTick).toBeCloseTo(MAX_PROD - summary.burnPerTick, 10);
    expect(summary.hasIce).toBe(true);
  });

  it("(b) THE BUG: ice OUT (deuteriumIce = 0) -> effectiveProduction 0, net == -burn (NEGATIVE), hasIce false", () => {
    const summary = fuelFlowSummary(burningState({ deuteriumIce: 0, fuel: 0 }));
    // The refinery makes NOTHING with no ice, the fix.
    expect(summary.effectiveProductionPerTick).toBe(0);
    // max ceiling is still reported (informational "Production (max)" line).
    expect(summary.maxProductionPerTick).toBe(MAX_PROD);
    expect(summary.hasIce).toBe(false);
    expect(summary.burnPerTick).toBeGreaterThan(0);
    // Net is now the pure drain: -burn, and strictly negative (was falsely +positive before).
    expect(summary.netPerTick).toBeCloseTo(-summary.burnPerTick, 10);
    expect(summary.netPerTick).toBeLessThan(0);
    expect(summary.tankFull).toBe(false);
    expect(summary.refiningActive).toBe(false);
    expect(summary.sufficient).toBe(false);
  });

  it("(c) ice below one batch (49 < 50) is treated as NO ice: effectiveProduction 0, hasIce false", () => {
    const summary = fuelFlowSummary(depotState({ deuteriumIce: ONE_BATCH_ICE - 1, fuel: 0 }));
    expect(summary.hasIce).toBe(false);
    expect(summary.effectiveProductionPerTick).toBe(0);
    expect(summary.refiningActive).toBe(false);
  });

  it("(c') ice at exactly one batch (50) IS enough: hasIce true, effectiveProduction == max", () => {
    const summary = fuelFlowSummary(depotState({ deuteriumIce: ONE_BATCH_ICE, fuel: 0 }));
    expect(summary.hasIce).toBe(true);
    expect(summary.effectiveProductionPerTick).toBe(MAX_PROD);
  });

  it("(d) tank full + ice: tankFull true, refiningActive false, sufficient true", () => {
    const summary = fuelFlowSummary(depotState({ deuteriumIce: 100, fuel: FUEL_TANK_BASE_CAP }));
    expect(summary.tankFull).toBe(true);
    expect(summary.hasIce).toBe(true);
    expect(summary.refiningActive).toBe(false);
    // topped off = fine even though throttled: sufficient regardless of net sign.
    expect(summary.sufficient).toBe(true);
  });

  it("(d') tank full + ice + burning captain: still sufficient (tankFull overrides negative net)", () => {
    const summary = fuelFlowSummary(burningState({ deuteriumIce: 100, fuel: FUEL_TANK_BASE_CAP }));
    expect(summary.tankFull).toBe(true);
    expect(summary.sufficient).toBe(true);
  });

  it("(e) no pipelines (no Fuel Depot record) -> effectiveProduction 0 even with ice", () => {
    const s = depotState({ deuteriumIce: 100, fuel: 0 });
    const facilities = { ...s.facilities };
    delete facilities["fuelStorage"]; // fuelPipelineCount returns 0 with no depot record
    const summary = fuelFlowSummary({ ...s, facilities });
    expect(summary.maxProductionPerTick).toBe(0);
    expect(summary.effectiveProductionPerTick).toBe(0);
    expect(summary.hasIce).toBe(false); // pipelines <= 0 -> no ice gate passes
    expect(summary.refiningActive).toBe(false);
  });
});

// ============================================================================
// FOLDED-STATS BURN (fix: fuelFlowSummary used UNFOLDED hull stats, 2026-08-27).
// The top-bar burn/net was priced at the BASELINE hull while the engine burns from the
// EQUIPMENT-FOLDED engineEfficiency / transitSpeedMult, so a geared ship could read
// "sufficient" while the tank actually drained. The summary now folds installed gear.
// ============================================================================
describe("fuelFlowSummary, burnPerTick uses equipment-folded stats", () => {
  // An FTL/engine piece fitted to ship-1 that raises engineEfficiency (the stat the tick engine
  // burns from). mass 0 isolates the engineEfficiency fold from any mass drag on transit speed.
  function efficiencyDrive(): EquipmentInstance {
    return {
      id: "eff-drive-1",
      slotType: "ftlDrive",
      rarity: "standard",
      ascension: "none",
      quality: 0,
      iLevel: 1,
      blueprintKey: null,
      implicitStats: {},
      rolledStats: { engineEfficiency: 5 }, // large boost -> clearly lower folded burn
      mass: 0,
      powerDraw: 0,
      durabilityMax: 100,
      durability: 100,
      fittedToShipId: "ship-1",
    };
  }

  it("a fitted efficiency drive LOWERS the displayed burn (before the fix, gear had no effect)", () => {
    const base = burningState({ deuteriumIce: 0, fuel: 100 });
    const geared: GameState = { ...base, equipment: [...base.equipment, efficiencyDrive()] };
    const baseBurn = fuelFlowSummary(base).burnPerTick;
    const gearedBurn = fuelFlowSummary(geared).burnPerTick;
    expect(baseBurn).toBeGreaterThan(0);
    // The fix: the folded efficiency drive reduces the shown burn. Pre-fix (UNFOLDED SHIP_TYPES
    // stats) these would be EQUAL because gear was ignored.
    expect(gearedBurn).toBeLessThan(baseBurn);
    expect(gearedBurn).toBeGreaterThan(0);
  });

  it("burnPerTick EXACTLY matches the engine's folded burn (fuelNeeded at folded eff / folded cycle)", () => {
    const geared: GameState = (() => {
      const base = burningState({ deuteriumIce: 0, fuel: 100 });
      return { ...base, equipment: [...base.equipment, efficiencyDrive()] };
    })();
    const gearedBurn = fuelFlowSummary(geared).burnPerTick;

    // Independently reconstruct the burn the tick engine actually draws: fuelNeeded priced at the
    // FOLDED engineEfficiency, amortized over the FOLDED cycle length. This is the exact figure
    // economyTick's extraction arm spends per real tick.
    const ship = geared.ships.find((s) => s.assignedCaptainId === 1)!;
    const folded = shipDerivedStats(
      ship,
      geared.equipment.filter((e) => e.fittedToShipId === ship.id),
    );
    const baseMission = MISSIONS.shortOreRun;
    const effDef = effectiveMissionDef(baseMission, folded);
    const PHASES: MissionPhase[] = ["ordersReceived", "transitOut", "extracting", "transitBack", "unloading"];
    const cycleTicks = PHASES.reduce((t, p) => t + requiredTicksForPhase(p, effDef), 0);
    const expected =
      fuelNeeded(baseMission, { ...SHIP_TYPES[ship.typeKey], engineEfficiency: folded.engineEfficiency }) / cycleTicks;

    expect(gearedBurn).toBeCloseTo(expected, 10);
    // Non-vacuity: the folded burn genuinely differs from the OLD unfolded computation.
    const unfoldedCycle = PHASES.reduce(
      (t, p) => t + requiredTicksForPhase(p, effectiveMissionDef(baseMission, shipDerivedStats(ship))),
      0,
    );
    const unfolded = fuelNeeded(baseMission, SHIP_TYPES[ship.typeKey]) / unfoldedCycle;
    expect(expected).not.toBeCloseTo(unfolded, 6);
  });
});
