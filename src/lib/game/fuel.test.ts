// Fuel data model tests, Mission Rework Task 3
// (docs/plans/2026-07-14-mission-rework-plan.md Task 3, design §3).
//
// Covers the fuel DATA MODEL only (no consumption / UI, those are Tasks 5/8):
//   - Every SHIP_TYPES hull carries the two new stats (fuelCapacity,
//     engineEfficiency) so no hull can ship without them.
//   - roundTripTransitTicks / fuelNeeded pure math: a known mission+hull value,
//     and the invariant that a more-efficient hull costs strictly less fuel.
//   - GameState.fuel seeds to Decimal 0 on a fresh save and survives a
//     serialize -> deserialize round trip as a live Decimal.
//   - Defensive hydration: a v20 save that predates the `fuel` field (pre-Task-9
//     migration) rehydrates to Decimal 0 instead of NaN / throwing.
import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import {
  SHIP_TYPES,
  MISSIONS,
  freshState,
  FUEL_PER_TICK,
  FUEL_CREDITS_PER_UNIT,
  FUEL_TANK_BASE_CAP,
  type CaptainMissionState,
} from "./model";
import { itemTotal } from "./inventory"; // Task 9a: read item TOTAL across quality buckets
import { roundTripTransitTicks, fuelNeeded } from "./fuel";
import { fuelCap, buyFuel, dispatchCaptainOnMission, economyTick, tick } from "./tick";
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

describe("GameState.fuel", () => {
  it("seeds a fresh save to a FULL Decimal tank (FUEL_TANK_BASE_CAP)", () => {
    // Soft-lock fix (2026-07-14): a brand-new fleet now starts with a full tank, not an
    // empty one, so the very first mission is dispatchable with no credits/ice, see
    // dispatch-requirements.test.ts for the behavioral no-soft-lock proof.
    const state = freshState();
    expect(state.fuel).toBeInstanceOf(Decimal);
    expect(state.fuel.eq(FUEL_TANK_BASE_CAP)).toBe(true);
  });

  it("survives a serialize -> deserialize -> migrate round trip as a live Decimal", () => {
    const state = freshState();
    state.fuel = new Decimal(42);
    const save = deserialize(serialize(state, 0));
    expect(save).not.toBeNull();
    const restored = migrate(save as SaveFile);
    expect(restored.fuel).toBeInstanceOf(Decimal);
    expect(restored.fuel.eq(42)).toBe(true);
  });

  it("defensively rehydrates a pre-migration save (no fuel field) to Decimal 0", () => {
    // A current-version save whose state predates the `fuel` field. The real
    // seeding migration is Task 9's job; hydrateDecimals must not NaN/throw before
    // then. Build the save shape by stripping `fuel` off a fresh serialized state.
    const save = deserialize(serialize(freshState(), 0)) as SaveFile;
    delete (save.state as any).fuel;
    expect(save.version).toBe(SAVE_VERSION);
    // migrate() runs no version steps (already current) then hydrateDecimals,
    // which must default the absent field rather than produce NaN.
    const restored = migrate(save);
    expect(restored.fuel).toBeInstanceOf(Decimal);
    expect(restored.fuel.eq(0)).toBe(true);
  });
});

// --- Task 4: fuel-storage facility cap + buyFuel ----------------------------
describe("fuelCap", () => {
  it("returns a POSITIVE base cap on a fresh state (no soft-lock, fuel buyable from start)", () => {
    // ⚠️ The critical no-soft-lock guarantee: missions are available from game
    // start and need fuel to dispatch, so the tank MUST hold fuel at facility
    // level 0. Unlike an un-built warehouse tier, fuelCap never returns a tiny /
    // sentinel value, a fresh fleet's cap is exactly FUEL_TANK_BASE_CAP.
    const state = freshState();
    const cap = fuelCap(state);
    expect(cap).toBeInstanceOf(Decimal);
    expect(cap.gt(0)).toBe(true);
    expect(cap.eq(FUEL_TANK_BASE_CAP)).toBe(true);
  });

  it("doubles the base cap once per reached fuelStorage level (base * 2^level)", () => {
    const state = freshState();
    state.facilities.fuelStorage = { level: 1 };
    expect(fuelCap(state).eq(FUEL_TANK_BASE_CAP * 2)).toBe(true);
    state.facilities.fuelStorage = { level: 3 };
    expect(fuelCap(state).eq(FUEL_TANK_BASE_CAP * 8)).toBe(true); // 500 * 2^3 = 4000
  });
});

describe("buyFuel", () => {
  it("deducts units * FUEL_CREDITS_PER_UNIT credits and adds units fuel (affordable + fits)", () => {
    const state = freshState();
    state.credits = new Decimal(1000);
    state.fuel = new Decimal(0);
    const next = buyFuel(state, 10);
    expect(next.fuel.eq(10)).toBe(true);
    expect(next.credits.eq(1000 - 10 * FUEL_CREDITS_PER_UNIT)).toBe(true); // 1000 - 50 = 950
    // Immutable: the ORIGINAL state is untouched.
    expect(state.fuel.eq(0)).toBe(true);
    expect(state.credits.eq(1000)).toBe(true);
  });

  it("clamps the purchase to remaining tank capacity (can't overfill)", () => {
    const state = freshState(); // cap = FUEL_TANK_BASE_CAP (500) at level 0
    state.credits = new Decimal(100000);
    state.fuel = new Decimal(FUEL_TANK_BASE_CAP - 5); // room for only 5 more
    const next = buyFuel(state, 100); // asked for 100, only 5 fit
    expect(next.fuel.eq(FUEL_TANK_BASE_CAP)).toBe(true); // filled exactly to cap
    // Charged only for the 5 units actually bought.
    expect(next.credits.eq(new Decimal(100000).minus(5 * FUEL_CREDITS_PER_UNIT))).toBe(true);
  });

  it("clamps the purchase to what the credits can afford (can't overspend / go negative)", () => {
    const state = freshState();
    // Exactly enough for 2 units (computed off the constant so it survives price retunes).
    state.credits = new Decimal(2 * FUEL_CREDITS_PER_UNIT);
    state.fuel = new Decimal(0);
    const next = buyFuel(state, 100); // asked for 100, affords 2
    expect(next.fuel.eq(2)).toBe(true);
    expect(next.credits.eq(0)).toBe(true); // spent all, never negative
    expect(next.credits.gte(0)).toBe(true);
  });

  it("is a no-op when broke (0 credits)", () => {
    const state = freshState();
    state.credits = new Decimal(0);
    state.fuel = new Decimal(0);
    const next = buyFuel(state, 10);
    expect(next.fuel.eq(0)).toBe(true);
    expect(next.credits.eq(0)).toBe(true);
  });

  it("is a no-op when the tank is already full", () => {
    const state = freshState();
    state.credits = new Decimal(1000);
    state.fuel = new Decimal(FUEL_TANK_BASE_CAP); // at cap already
    const next = buyFuel(state, 10);
    expect(next.fuel.eq(FUEL_TANK_BASE_CAP)).toBe(true);
    expect(next.credits.eq(1000)).toBe(true); // nothing spent
  });

  it("is a no-op for a non-positive request (no negative-units exploit)", () => {
    const state = freshState();
    state.credits = new Decimal(1000);
    state.fuel = new Decimal(100);
    const next = buyFuel(state, -5); // negative must not add credits / remove fuel
    expect(next.fuel.eq(100)).toBe(true);
    expect(next.credits.eq(1000)).toBe(true);
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
    state.fuel = new Decimal(1_000_000); // plenty of fuel -> isolate the RANGE gate from the RESOURCE gate
    state.ships = [{ id: "ship-1", typeKey: "prospectorRunner", assignedCaptainId: 1 }];
    const runnerLongRunNeed = fuelNeeded(MISSIONS.longOreRun, SHIP_TYPES.prospectorRunner);
    const originalCap = SHIP_TYPES.prospectorRunner.fuelCapacity;
    try {
      SHIP_TYPES.prospectorRunner.fuelCapacity = Math.floor(runnerLongRunNeed) - 1; // tank can't hold one trip's fuel
      const { next, success } = dispatchCaptainOnMission(state, 1, "longOreRun");
      expect(success).toBe(false); // range gate: fuelCapacity < need
      expect(next).toBe(state); // same-ref no-op
      expect(next.captains[0].mission).toBe(null);
      expect(next.fuel.eq(1_000_000)).toBe(true); // no fuel spent
    } finally {
      SHIP_TYPES.prospectorRunner.fuelCapacity = originalCap; // restore the shared table
    }
  });

  it("dispatches on a REACH pass and spends NO fuel (instant free refuel)", () => {
    const state = freshState();
    const startFuel = state.fuel;
    const { next, success } = dispatchCaptainOnMission(state, 1, "shortOreRun");
    expect(success).toBe(true);
    expect((next.captains[0].mission as CaptainMissionState)?.missionKey).toBe("shortOreRun"); // dispatched
    expect(next.fuel.eq(startFuel)).toBe(true); // no fuel deducted at dispatch (fuel-to-reach)
  });
});

