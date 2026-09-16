// fuel-to-reach.test.ts — 0.13.6 FUEL-TO-REACH (build plan:
// docs/plans/2026-09-16-fuel-to-reach-0.13.6-plan.md).
//
// Pins the parity / no-elevation guarantee: the lightyear REACH gate (canReach) is exactly the old
// capacity gate (fuelCapacity >= fuelNeeded) relabelled, so pulling fuel-to-reach in changes NO
// ship/mission eligibility. If a future edit drifts the gate, this fails.
import { describe, it, expect } from "vitest";
import { SHIP_TYPES, MISSIONS } from "./model";
import { fuelNeeded, canReach, distanceLightYears, rangeLightYears, LY_PER_TICK } from "./fuel";

describe("fuel-to-reach: the lightyear gate equals the old capacity gate (parity)", () => {
  it("canReach(mission, ship) === (fuelCapacity >= fuelNeeded) for EVERY ship x mission", () => {
    for (const [shipKey, ship] of Object.entries(SHIP_TYPES)) {
      for (const [missionKey, mission] of Object.entries(MISSIONS)) {
        const oldGate = ship.fuelCapacity >= fuelNeeded(mission, ship);
        expect(canReach(mission, ship), `${shipKey} x ${missionKey}`).toBe(oldGate);
      }
    }
  });

  it("distance is mission-intrinsic (round-trip transit x LY_PER_TICK)", () => {
    for (const mission of Object.values(MISSIONS)) {
      const rt = mission.transitOutTicks + mission.transitBackTicks;
      expect(distanceLightYears(mission)).toBeCloseTo(rt * LY_PER_TICK, 9);
    }
  });

  it("range folds engine efficiency (a more efficient hull reaches further on the same tank)", () => {
    // Two hulls, same tank, different efficiency -> the efficient one has the longer range.
    const a = { fuelCapacity: 100, engineEfficiency: 0 } as (typeof SHIP_TYPES)[keyof typeof SHIP_TYPES];
    const b = { fuelCapacity: 100, engineEfficiency: 0.5 } as (typeof SHIP_TYPES)[keyof typeof SHIP_TYPES];
    expect(rangeLightYears(b)).toBeGreaterThan(rangeLightYears(a));
    expect(rangeLightYears(a)).toBeCloseTo(100 * 1 * LY_PER_TICK, 9);
    expect(rangeLightYears(b)).toBeCloseTo(100 * 1.5 * LY_PER_TICK, 9);
  });

  it("a bigger tank reaches further, and a zero-distance local run is always reachable", () => {
    const small = { fuelCapacity: 100, engineEfficiency: 0 } as (typeof SHIP_TYPES)[keyof typeof SHIP_TYPES];
    const big = { fuelCapacity: 300, engineEfficiency: 0 } as (typeof SHIP_TYPES)[keyof typeof SHIP_TYPES];
    expect(rangeLightYears(big)).toBeGreaterThan(rangeLightYears(small));
    const localRun = { transitOutTicks: 0, transitBackTicks: 0 } as (typeof MISSIONS)[keyof typeof MISSIONS];
    expect(distanceLightYears(localRun)).toBe(0);
    expect(canReach(localRun, small)).toBe(true);
  });
});
