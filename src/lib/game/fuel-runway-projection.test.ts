// ============================================================================
// fuel-runway-projection.test.ts
//
// Author: Claude Opus 4.8 · 2026-07-16
// Covers the PURE "fuel runway" projection helper `fuelRunwayProjection(input)`
// added to tick.ts (Wave 2, full-sustainability fuel readout).
//
// WHAT IT ANSWERS: "how many ticks until the player runs out of fuel?" under a
// FULL-SUSTAINABILITY model -- it credits the Deuterium Ice that running missions
// keep mining. Because mission ice output is a stochastic loot roll, the LIVE
// loop MEASURES the actual per-tick fuel & ice deltas (an EMA) and feeds them in
// here; this function is the pure two-phase projection over those measured rates.
//
// PURE: plain numbers in, {sustainable, runwayTicks} out. No Decimal, no state,
// no side effects -- so the whole decision matrix is pinned here directly.
//
// DECISION MATRIX (EPS = 1e-9):
//   1. No burn (burnPerTick <= EPS)            -> sustainable (fuel isn't spent)
//   2. Ice NOT depleting (dIce >= -EPS):
//        fuel stable/growing (dFuel >= -EPS)   -> sustainable
//        fuel draining (dFuel < -EPS)          -> fuel / -dFuel
//   3. Ice depleting (dIce < -EPS), two-phase:
//        fuel dies before ice                  -> fuel / -dFuel
//        fuel survives to ice-out              -> iceRunway + fuelAtIceOut/burn
//   Guards: any non-finite input, or a computed non-finite/negative runway
//   -> {sustainable:false, runwayTicks:null} (UI renders "unknown"). Final
//   runwayTicks is clamped to >= 0.
// ============================================================================

import { describe, it, expect } from "vitest";
import { fuelRunwayProjection } from "./tick";

describe("fuelRunwayProjection", () => {
  // --- Case 1: no burn -> self-sustaining regardless of the deltas. Fuel is not
  // being consumed at all, so there is no runway to count down.
  it("no burn -> sustainable, runwayTicks null", () => {
    const r = fuelRunwayProjection({
      fuel: 100,
      fuelCap: 1000,
      ice: 50,
      dFuelPerTick: -5, // even a draining measurement is moot with zero burn
      dIcePerTick: -1,
      burnPerTick: 0,
    });
    expect(r).toEqual({ sustainable: true, runwayTicks: null });
  });

  // --- Case 2a: ice not depleting AND fuel stable/growing -> the refinery keeps
  // up forever. Sustainable.
  it("ice not depleting + fuel growing -> sustainable", () => {
    const r = fuelRunwayProjection({
      fuel: 100,
      fuelCap: 1000,
      ice: 50,
      dFuelPerTick: 2, // net fuel is rising
      dIcePerTick: 1, // ice stockpile is rising too
      burnPerTick: 3,
    });
    expect(r).toEqual({ sustainable: true, runwayTicks: null });
  });

  // --- Case 2b: ice not depleting but fuel still net-negative -> burn outruns
  // even full refining; fuel drains at |dFuel|/tick. runway = fuel / -dFuel.
  it("ice not depleting + fuel draining -> fuel / -dFuel", () => {
    const r = fuelRunwayProjection({
      fuel: 100,
      fuelCap: 1000,
      ice: 50,
      dFuelPerTick: -4, // 100 / 4 = 25 ticks
      dIcePerTick: 0.5,
      burnPerTick: 5,
    });
    expect(r.sustainable).toBe(false);
    expect(r.runwayTicks).toBeCloseTo(25, 9);
  });

  // --- Case 3a: ice depleting AND fuel dies first. Both draining, but fuel's own
  // runway (10) is shorter than the ice runway (100), so fuel-out is the wall.
  it("ice depleting + fuel dies before ice -> fuel / -dFuel", () => {
    const r = fuelRunwayProjection({
      fuel: 100,
      fuelCap: 1000,
      ice: 100,
      dFuelPerTick: -10, // fuelRunway = 100/10 = 10
      dIcePerTick: -1, // iceRunway   = 100/1 = 100 -> fuel dies first
      burnPerTick: 5,
    });
    expect(r.sustainable).toBe(false);
    expect(r.runwayTicks).toBeCloseTo(10, 9);
  });

  // --- Case 3b: ice depleting AND ice dies first (two-phase). Phase 1: fuel
  // drifts to iceRunway. Phase 2: no more refining, tank burns down at burn/tick.
  //   iceRunway   = 10 / 1 = 10
  //   fuelAtIceOut= clamp(100 + (-1)*10, 0, cap) = 90
  //   phase2      = 90 / 9 = 10
  //   total       = 10 + 10 = 20
  it("ice depleting + ice dies first -> iceRunway + fuelAtIceOut/burn", () => {
    const r = fuelRunwayProjection({
      fuel: 100,
      fuelCap: 1000,
      ice: 10,
      dFuelPerTick: -1,
      dIcePerTick: -1,
      burnPerTick: 9,
    });
    expect(r.sustainable).toBe(false);
    expect(r.runwayTicks).toBeCloseTo(20, 9);
  });

  // --- Case 3c: ice depleting but fuel GROWING (dFuel > -EPS) -> phase-1 fuel
  // gain overshoots the tank and CLAMPS at fuelCap, then phase-2 burns the full
  // tank down.
  //   iceRunway    = 10 / 1 = 10
  //   fuelAtIceOut = clamp(990 + 5*10 = 1040, 0, 1000) = 1000  (clamped at cap)
  //   phase2       = 1000 / 10 = 100
  //   total        = 10 + 100 = 110
  it("ice depleting + fuel growing (clamps at cap) -> iceRunway + fuelCap/burn", () => {
    const r = fuelRunwayProjection({
      fuel: 990,
      fuelCap: 1000,
      ice: 10,
      dFuelPerTick: 5, // rising, would exceed cap during phase 1
      dIcePerTick: -1,
      burnPerTick: 10,
    });
    expect(r.sustainable).toBe(false);
    expect(r.runwayTicks).toBeCloseTo(110, 9);
  });

  // --- Guard: any non-finite input -> unknown ({false, null}).
  it("NaN input -> {false, null}", () => {
    const r = fuelRunwayProjection({
      fuel: NaN,
      fuelCap: 1000,
      ice: 50,
      dFuelPerTick: -1,
      dIcePerTick: -1,
      burnPerTick: 5,
    });
    expect(r).toEqual({ sustainable: false, runwayTicks: null });
  });

  it("Infinity input -> {false, null}", () => {
    const r = fuelRunwayProjection({
      fuel: 100,
      fuelCap: 1000,
      ice: 50,
      dFuelPerTick: -Infinity,
      dIcePerTick: -1,
      burnPerTick: 5,
    });
    expect(r).toEqual({ sustainable: false, runwayTicks: null });
  });

  // --- Case: already-empty fuel and draining -> runway is exactly 0 (clamped >=0),
  // NOT negative and NOT null. The player is out of fuel right now.
  it("already-empty fuel + draining -> 0", () => {
    const r = fuelRunwayProjection({
      fuel: 0,
      fuelCap: 1000,
      ice: 50,
      dFuelPerTick: -5,
      dIcePerTick: 0, // ice not depleting -> case 2b path, fuel/-dFuel = 0/5 = 0
      burnPerTick: 5,
    });
    expect(r.sustainable).toBe(false);
    expect(r.runwayTicks).toBe(0);
  });
});
