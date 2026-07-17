// Shipyard (Phase 5) -- Task S1 data-model tests.
//
// SCOPE (S1 only, per docs/plans/2026-07-16-shipyard-plan.md): the DATA MODEL that
// the later Shipyard tasks build on -- (1) every hull's `buildRecipe` BOM, (2) the
// `FACILITIES.shipyard` facility def (founding rung gated on credits + FA level, a
// finite build-speed upgrade track), (3) `shipBuildSlotCount` = 1, and (4) the
// fresh-state seed of `shipyard` at level 0 (LOCKED / unfounded). The build ENGINE
// (S3), allocation unification (S2), and UI (S5) are NOT tested here -- they arrive
// in their own tasks.
//
// These assertions mirror the shape the sibling systems already lock down (see
// fabricator.test.ts / research.test.ts): "every table entry is well-formed + points
// at real registry keys", so a mistyped component id or a missing rung cannot slip in.

import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import {
  freshState,
  SHIP_TYPES,
  ITEMS,
  FACILITIES,
  SHIPYARD_FACILITY_KEY,
  type ShipTypeKey,
} from "./model";
import { shipBuildSlotCount } from "./tick";

// The exact hull keys S1 ships against -- an explicit list (not `Object.keys`) so a
// hull silently dropped from SHIP_TYPES fails this test instead of being skipped.
const HULL_KEYS: ShipTypeKey[] = [
  "generalFreighter",
  "prospectorHauler",
  "prospectorRunner",
  "prospectorMiner",
];

describe("ShipTypeDef.buildRecipe (S1 BOM)", () => {
  it("every hull declares a buildRecipe", () => {
    for (const key of HULL_KEYS) {
      expect(SHIP_TYPES[key].buildRecipe, `buildRecipe missing on ${key}`).toBeDefined();
    }
  });

  it("every buildRecipe lists at least one component, all real ITEMS keys with positive counts", () => {
    for (const key of HULL_KEYS) {
      const recipe = SHIP_TYPES[key].buildRecipe;
      const entries = Object.entries(recipe.components);
      expect(entries.length, `${key} has no components`).toBeGreaterThan(0);
      for (const [itemId, qty] of entries) {
        // The component id must exist in the ITEMS registry (no ghost item).
        expect(ITEMS[itemId], `${key} references unknown item "${itemId}"`).toBeDefined();
        expect(qty, `${key}.${itemId} count must be positive`).toBeGreaterThan(0);
      }
    }
  });

  it("every buildRecipe has positive credits + durationTicks", () => {
    for (const key of HULL_KEYS) {
      const recipe = SHIP_TYPES[key].buildRecipe;
      expect(recipe.credits, `${key} credits`).toBeGreaterThan(0);
      expect(recipe.durationTicks, `${key} durationTicks`).toBeGreaterThan(0);
    }
  });

  it("uses the real component item ids (frameSegment / powerCoupling / structuralAssembly)", () => {
    // A guard that the BOMs draw ONLY from the fabricated component pool (design §6),
    // not from raw ores or refined stock -- ships are assembled from components.
    const allowed = new Set(["frameSegment", "powerCoupling", "structuralAssembly"]);
    for (const key of HULL_KEYS) {
      for (const itemId of Object.keys(SHIP_TYPES[key].buildRecipe.components)) {
        expect(allowed.has(itemId), `${key} uses non-component "${itemId}"`).toBe(true);
      }
    }
  });
});

describe("FACILITIES.shipyard (S1 facility)", () => {
  it("SHIPYARD_FACILITY_KEY is 'shipyard' and the facility exists with a label", () => {
    expect(SHIPYARD_FACILITY_KEY).toBe("shipyard");
    expect(FACILITIES[SHIPYARD_FACILITY_KEY]).toBeDefined();
    expect(FACILITIES[SHIPYARD_FACILITY_KEY].label).toBe("Shipyard");
  });

  it("founding rung (level 0->1) is gated on credits + FA level, with NO materials", () => {
    const founding = FACILITIES[SHIPYARD_FACILITY_KEY].upgrades[0];
    expect(founding, "founding rung missing").toBeDefined();
    // Founding cost = credits (a Decimal, like research/fabricator's credit rungs).
    expect(founding.credits instanceof Decimal, "founding credits must be a Decimal").toBe(true);
    expect((founding.credits as Decimal).gt(0), "founding credits must be positive").toBe(true);
    // Founding gate = Fleet-Admiral level (mirrors research/fabricator's FA gate).
    expect(founding.requiresFleetAdminLevel, "founding FA-level gate").toBeGreaterThan(0);
    // NO materials on the founding rung this pass (mirrors research's rung).
    expect(Object.keys(founding.materials).length, "founding rung must cost no materials").toBe(0);
  });

  it("a later rung carries the build-speed effect (buildSpeedMult)", () => {
    const upgrades = FACILITIES[SHIPYARD_FACILITY_KEY].upgrades;
    // Finite track: at least one rung BEYOND the founding rung.
    expect(upgrades.length, "shipyard needs at least one upgrade rung past founding").toBeGreaterThan(1);
    // Every rung past the founding one carries a positive buildSpeedMult.
    for (let i = 1; i < upgrades.length; i++) {
      const effect = upgrades[i].effect;
      expect("buildSpeedMult" in effect, `rung ${i} must carry buildSpeedMult`).toBe(true);
      if ("buildSpeedMult" in effect) {
        expect(effect.buildSpeedMult, `rung ${i} buildSpeedMult`).toBeGreaterThan(0);
      }
    }
  });

  it("buildSpeedMult is INERT for every existing facility (no non-shipyard rung sets it)", () => {
    // Anti-regression (Omega 15): the new effect field must change NO existing facility.
    for (const [facilityKey, def] of Object.entries(FACILITIES)) {
      if (facilityKey === SHIPYARD_FACILITY_KEY) continue;
      for (const rung of def.upgrades) {
        expect(
          "buildSpeedMult" in rung.effect,
          `${facilityKey} unexpectedly sets buildSpeedMult`,
        ).toBe(false);
      }
    }
  });
});

describe("shipBuildSlotCount + fresh-state seed (S1)", () => {
  it("shipBuildSlotCount is 1 on a fresh state (single build slot this pass)", () => {
    expect(shipBuildSlotCount(freshState())).toBe(1);
  });

  it("fresh state seeds the shipyard at level 0 (LOCKED / unfounded)", () => {
    // Unlike research/fabricator (seeded at level 1), the Shipyard starts LOCKED so
    // the founding rung (level 0->1) is a real unlock the player must buy.
    expect(freshState().facilities[SHIPYARD_FACILITY_KEY].level).toBe(0);
  });
});
