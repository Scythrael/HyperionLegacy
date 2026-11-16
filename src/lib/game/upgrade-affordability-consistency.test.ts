// ============================================================================
// Upgrade affordability / display consistency (fix/warehouse-overcap-reconcile, 2026-07-24).
//
// THE BUG (legit prod player): a facility upgrade's readiness row showed the RAW inventory
// total ("you have 1.52M ore") while the Build button was disabled saying "not enough",
// because the affordability gate (canBuildFacilityUpgrade) spends from the reservation-aware
// FREE pool (inventory MINUS what active craft lines reserve), NOT the raw total. The two
// surfaces read DIFFERENT numbers, so one screen contradicted the other.
//
// THE FIX (App.svelte): every facility-upgrade material readiness row now reads
// freeItemForState (the SAME value the gate spends against) for its have/met, and surfaces
// the reserved remainder. This test LOCKS the invariant at the pure-helper level (the
// App.svelte row is a direct render of freeItemForState, so the number it shows is exactly
// what is asserted here):
//   - with ore reserved by an active refine line, freeItemForState (the displayed have) is
//     STRICTLY LESS than itemTotal (the raw Warehouse total), and
//   - canBuildFacilityUpgrade agrees: it returns ok:false, and its reason reports the FREE
//     amount, the same number the row now displays, so no surface can contradict another.
//
// The scenario uses the Warehouse (Tier I) rung-0 upgrade (cost 750,000 commonOre, no other
// gate) and a continuous refineCommonOre line (20 commonOre/iteration).
// ============================================================================
import { describe, it, expect } from "vitest";
import { canBuildFacilityUpgrade } from "./tick";
import { freeItemForState, type CraftLine } from "./allocation";
import { freshState, FACILITIES } from "./model";
import { itemTotal } from "./inventory";
import Decimal from "break_infinity.js";

// A continuous refine line reserving commonOre: refineCommonOre consumes 20 commonOre per
// iteration, and a continuous line reserves exactly its ONE queued next iteration... so to
// reserve a large slice we use a BATCH line with `remaining` iterations still queued (each
// reserves its 20 commonOre until it starts). remaining=15,000 -> 300,000 commonOre reserved.
function refineLineReserving(iterations: number): CraftLine {
  return {
    id: "test-refine-line",
    kind: "refine",
    recipeKey: "refineCommonOre",
    remaining: iterations,
    mode: { kind: "batch", remaining: iterations },
  };
}

describe("upgrade readiness row reads the FREE amount, consistent with the Build gate", () => {
  it("free < raw when ore is reserved, and canBuildFacilityUpgrade agrees (reason reports free)", () => {
    const state = freshState();
    // Ore sitting AT its cap (1,000,000): the raw Warehouse total looks more than enough for
    // the 750,000 rung-0 cost.
    state.inventory = { ...state.inventory, commonOre: [new Decimal(1_000_000)] };
    // A refine line reserving 300,000 commonOre (15,000 iterations x 20), so free = 700,000.
    state.refineLines = [refineLineReserving(15_000)];

    const need = new Decimal(750_000); // Warehouse (Tier I) rung-0 material cost
    const raw = itemTotal(state.inventory, "commonOre");
    const free = freeItemForState(state, "commonOre");

    // The Warehouse (raw) shows enough; the upgrade row (free) does NOT: the exact split that
    // produced the contradictory screens before the fix.
    expect(raw.equals(1_000_000)).toBe(true);
    expect(free.equals(700_000)).toBe(true);
    expect(free.lt(raw)).toBe(true);
    expect(raw.gte(need)).toBe(true); // raw would (wrongly) show the material as met
    expect(free.lt(need)).toBe(true); // free correctly shows it as NOT met

    // The gate uses the SAME free value the row now displays: it refuses the upgrade and its
    // reason reports the FREE amount (700000), never the raw 1,000,000.
    const check = canBuildFacilityUpgrade(state, "warehouseT1");
    expect(check.ok).toBe(false);
    expect(check.reason).toContain("700000"); // the free "have", matching the displayed value
    expect(check.reason).not.toContain("1000000"); // never the raw total
  });

  it("with NOTHING reserved, free == raw, so the row is byte-identical to the old raw display", () => {
    const state = freshState();
    state.inventory = { ...state.inventory, commonOre: [new Decimal(800_000)] };
    state.refineLines = []; // no reservation

    const raw = itemTotal(state.inventory, "commonOre");
    const free = freeItemForState(state, "commonOre");
    expect(free.equals(raw)).toBe(true); // no reservation -> display unchanged from before

    // 800,000 free >= 750,000 need, and no other gate, so the upgrade is buildable.
    const check = canBuildFacilityUpgrade(state, "warehouseT1");
    expect(check.ok).toBe(true);
  });
});

// FR-C lane 1 M2: Warehouse rungs 5 to 7 (and T2 rung 5) cost 12000000.000000002 and so on (Decimal times/div drift), so
// holding exactly the listed ore could not buy them. Every warehouse rung cost is now an exact whole number.
describe("warehouse rung costs are exact whole numbers", () => {
  it("every T1 and T2 rung material cost is an integer, and exactly the listed amount buys it", () => {
    for (const key of ["warehouseT1", "warehouseT2"] as const) {
      FACILITIES[key].upgrades.forEach((rung, i) => {
        for (const [itemId, cost] of Object.entries(rung.materials)) {
          // The cost IS the Decimal of its whole number (break_infinity cannot print every big integer exactly, so the
          // check is equality with the whole number's own Decimal, the same value a stock of that size holds).
          const whole = Math.round(cost.toNumber());
          expect(cost.eq(new Decimal(whole)), `${key}[${i}] ${itemId} ${cost.toString()}`).toBe(true);
          const state = freshState();
          state.facilities = { ...state.facilities, [key]: { level: i } };
          state.inventory = { ...state.inventory, [itemId]: [new Decimal(whole)] };
          expect(freeItemForState(state, itemId).gte(cost), `${key}[${i}] exact stock covers ${itemId}`).toBe(true);
        }
      });
    }
  });
});
