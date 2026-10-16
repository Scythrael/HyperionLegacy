// Fuel data model tests, Mission Rework Task 3
// (docs/plans/2026-07-14-mission-rework-plan.md Task 3, design §3).
//
// Covers the fuel DATA MODEL only (no consumption / UI, those are Tasks 5/8):
//   - Every SHIP_TYPES hull carries the two new stats (fuelCapacity,
//     engineEfficiency) so no hull can ship without them.
//   - roundTripTransitTicks / fuelNeeded pure math: a known mission+hull value,
//     and the invariant that a more-efficient hull costs strictly less fuel.
//   - WR-4: the fuel stockpile (GameState.fuel) is retired; a v69 save's field is dropped at load.
import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import {
  SHIP_TYPES,
  MISSIONS,
  freshState,
  FUEL_PER_TICK,
  FUEL_CREDITS_PER_UNIT,
  type CaptainMissionState,
} from "./model";
import { itemTotal } from "./inventory"; // Task 9a: read item TOTAL across quality buckets
import { roundTripTransitTicks, fuelNeeded } from "./fuel";
import { dispatchCaptainOnMission, economyTick, tick } from "./tick";
import { serialize, deserialize, migrate, SAVE_VERSION, type SaveFile } from "./save";

describe("ship fuel stats", () => {
  it("gives every hull a numeric fuelCapacity and engineEfficiency", () => {
    for (const [key, def] of Object.entries(SHIP_TYPES)) {
      expect(typeof def.fuelCapacity, `${key}.fuelCapacity`).toBe("number");
      expect(def.fuelCapacity, `${key}.fuelCapacity`).toBeGreaterThan(0);
      expect(typeof def.engineEfficiency, `${key}.engineEfficiency`).toBe("number");
      // engineEfficiency is a 0-based bonus (0 = baseline 1:1), never negative.
      expect(def.engineEfficiency, `${key}.engineEfficiency`).toBeGreaterThanOrEqual(0);
    }
  });

  it("makes the Freighter the range hull (largest tank) and the Runner the most efficient", () => {
    // First-pass identity check so a future tuning pass can't silently invert the
    // intended hull profiles (Freighter = big tank/low eff, Runner = small tank/high eff).
    expect(SHIP_TYPES.generalFreighter.fuelCapacity).toBeGreaterThan(
      SHIP_TYPES.prospectorRunner.fuelCapacity
    );
    expect(SHIP_TYPES.prospectorRunner.engineEfficiency).toBeGreaterThan(
      SHIP_TYPES.generalFreighter.engineEfficiency
    );
  });
});

describe("fuel constants", () => {
  it("exposes the first-pass tunables", () => {
    expect(FUEL_PER_TICK).toBe(1); // Fuel Economy v2: reverted 0.1 -> 1 in the 2026-07-15 device retune (0.1 was too generous)
    expect(FUEL_CREDITS_PER_UNIT).toBe(20); // Fuel-sourcing restructure: 5 -> 20 (expensive auto-buy; refining is the intended path)
  });
});

describe("roundTripTransitTicks", () => {
  it("sums the out + back transit phase ticks only", () => {
    // shortOreRun: transitOut 25 + transitBack 25 = 50. Extraction/unload/orders
    // are NOT transit and must not be counted.
    expect(roundTripTransitTicks(MISSIONS.shortOreRun)).toBe(50);
    expect(roundTripTransitTicks(MISSIONS.longOreRun)).toBe(140);
  });
});

describe("fuelNeeded", () => {
  it("returns roundTrip * FUEL_PER_TICK / (1 + engineEfficiency) for a known mission+hull", () => {
    // Freighter engineEfficiency 0 -> denominator 1 -> roundTrip(50) * FUEL_PER_TICK(1) = 50.
    expect(fuelNeeded(MISSIONS.shortOreRun, SHIP_TYPES.generalFreighter)).toBeCloseTo(50, 10);
  });

  it("costs a more-efficient hull strictly less fuel for the same mission", () => {
    const freighter = fuelNeeded(MISSIONS.shortOreRun, SHIP_TYPES.generalFreighter);
    const runner = fuelNeeded(MISSIONS.shortOreRun, SHIP_TYPES.prospectorRunner);
    expect(runner).toBeLessThan(freighter);
  });
});

describe("WR-4: the fuel stockpile is retired (OC-C1)", () => {
  it("a fresh save carries no fuel stockpile", () => {
    expect("fuel" in freshState()).toBe(false);
  });

  it("a v69 save's stockpile is dropped at the v70 load, and nothing else about the fuel economy breaks", () => {
    const save = deserialize(serialize(freshState(), 0)) as SaveFile;
    (save.state as any).fuel = "4000";
    const restored = migrate({ ...save, version: 69 });
    expect("fuel" in restored).toBe(false);
    expect(SAVE_VERSION).toBeGreaterThanOrEqual(70);
  });
});

// --- Task 5 / Fuel Economy v2 F3: fuel consumption at dispatch + auto-repeat -------
// (docs/plans/2026-07-14-mission-rework-plan.md Task 5 + 2026-07-14-fuel-economy-v2-
// design.md §3/§4.)
//
// freshState() seeds a single captain flying the "ship-1" General Freighter
// (fuelCapacity 200, engineEfficiency 0), so fuelNeeded(shortOreRun, Freighter) is
// exactly (25+25)*1/(1+0) = 50 fuel per round trip, an INTEGER (post-2026-07-15 device
// retune FUEL_PER_TICK 0.1 -> 1), which is what makes the offline==live parity assertions
// below bit-exact (integer Decimal deductions carry no float drift). One shortOreRun
// cycle is 149 whole ticks (1 orders + 25 out + 90 extract + 25 back + 8 unload).
//
// F3 REWORKED the auto-repeat: the old hard "stop-on-empty" is REPLACED by auto-buy +
// (+2-tick penalty) with a broke-stop floor. The tests in this section now exercise the
// BROKE-STOP path (tank short AND credits can't cover the shortfall); the auto-buy +
// penalty behavior + the multi-cycle refining parity live in fuel-consumption-v2.test.ts.
const FREIGHTER_SHORT_RUN_FUEL = 50; // fuelNeeded(shortOreRun, generalFreighter) at FUEL_PER_TICK 1
const SHORT_RUN_CYCLE_TICKS = 149;

describe("dispatch fuel gate: REACH only (dispatchCaptainOnMission)", () => {
  // 0.13.6 fuel-to-reach: the RESOURCE (empty-tank) block and the fuel DEDUCTION are gone. The only
  // fuel gate is RANGE (the hull's capacity vs the trip), tested below; dispatch spends no fuel.
  it("BLOCKS dispatch (RANGE gate) when the hull's fuelCapacity < fuelNeeded, even with a full tank", () => {
    // No real hull+mission combo trips the range gate today (every tank covers every
    // trip), so this exercises the forward-defensive branch by temporarily shrinking
    // the Runner's tank below a real mission's need, restoring it in finally.
    const state = freshState();
    state.ships = [{ id: "ship-1", typeKey: "prospectorRunner", assignedCaptainId: 1 }];
    const runnerLongRunNeed = fuelNeeded(MISSIONS.longOreRun, SHIP_TYPES.prospectorRunner);
    const originalCap = SHIP_TYPES.prospectorRunner.fuelCapacity;
    try {
      SHIP_TYPES.prospectorRunner.fuelCapacity = Math.floor(runnerLongRunNeed) - 1; // tank can't hold one trip's fuel
      const { next, success } = dispatchCaptainOnMission(state, 1, "longOreRun");
      expect(success).toBe(false); // range gate: fuelCapacity < need
      expect(next).toBe(state); // same-ref no-op
      expect(next.captains[0].mission).toBe(null);
    } finally {
      SHIP_TYPES.prospectorRunner.fuelCapacity = originalCap; // restore the shared table
    }
  });

  it("dispatches on a REACH pass and spends NO fuel (instant free refuel)", () => {
    const state = freshState();
    const { next, success } = dispatchCaptainOnMission(state, 1, "shortOreRun");
    expect(success).toBe(true);
    expect((next.captains[0].mission as CaptainMissionState)?.missionKey).toBe("shortOreRun"); // dispatched
    expect(next.credits.eq(state.credits)).toBe(true); // dispatch spends nothing (fuel-to-reach; no stockpile since WR-4)
  });
});

