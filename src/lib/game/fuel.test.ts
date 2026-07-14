// Fuel data model tests — Mission Rework Task 3
// (docs/plans/2026-07-14-mission-rework-plan.md Task 3, design §3).
//
// Covers the fuel DATA MODEL only (no consumption / UI — those are Tasks 5/8):
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
} from "./model";
import { roundTripTransitTicks, fuelNeeded } from "./fuel";
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
    expect(FUEL_PER_TICK).toBe(1);
    expect(FUEL_CREDITS_PER_UNIT).toBe(5);
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
    // Freighter engineEfficiency 0 -> denominator 1 -> raw round-trip ticks.
    expect(fuelNeeded(MISSIONS.shortOreRun, SHIP_TYPES.generalFreighter)).toBeCloseTo(50, 10);
  });

  it("costs a more-efficient hull strictly less fuel for the same mission", () => {
    const freighter = fuelNeeded(MISSIONS.shortOreRun, SHIP_TYPES.generalFreighter);
    const runner = fuelNeeded(MISSIONS.shortOreRun, SHIP_TYPES.prospectorRunner);
    expect(runner).toBeLessThan(freighter);
  });
});

describe("GameState.fuel", () => {
  it("seeds a fresh save to Decimal 0", () => {
    const state = freshState();
    expect(state.fuel).toBeInstanceOf(Decimal);
    expect(state.fuel.eq(0)).toBe(true);
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
