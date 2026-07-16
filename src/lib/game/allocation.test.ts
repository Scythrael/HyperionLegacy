// ============================================================================
// Crafting Allocation Redesign -- Task C1 tests (TDD)
//
// Author: Claude (Opus 4.8) | Date: 2026-07-16
// Plan: docs/plans/2026-07-16-crafting-allocation-redesign-plan.md (Task C1)
// Design: docs/plans/2026-07-16-crafting-allocation-redesign-design.md (§1)
//
// Pins the DERIVED material-allocation core: how much of an item active craft
// lines RESERVE (allocated) vs. how much is left to spend (free). Allocation is
// never stored -- the lines are the single source of truth -- so these pure
// helpers take a `lines` array as a parameter (C2 wires them to GameState).
//
// ⚠️ WORKED-EXAMPLE RECONCILIATION: the design §1 table illustrates with a
// hypothetical 1:1 recipe (remaining 1000 -> allocated 1000 -> free 0; after
// crafts remaining 900 -> allocated 900 -> free 0). The ONLY real REFINE_RECIPES
// entry, `refineCommonOre`, is 100:1 (100 commonOre per iteration). So we
// reproduce the exact allocated/free VALUES from the table (1000/0, then 900/0)
// with the REAL recipe by using remaining = 10 and 9 respectively
// (10 x 100 = 1000, 9 x 100 = 900). Real keys, real math, same worked-example
// numbers in the allocated/free columns.
// ============================================================================

import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import { REFINE_RECIPES, BLUEPRINTS } from "./model";
import {
  lineInputsPerIteration,
  allocatedItem,
  freeItem,
  type CraftLine,
} from "./allocation";

// --- Fixtures: REAL registry keys (confirmed present in model.ts) ------------
// refineCommonOre.input = { commonOre: Decimal(100) }            -> 100:1
// structuralAssemblyBp.recipe.inputs = { frameSegment: 2, powerCoupling: 1, titaniumIngot: 2 }
const REFINE_KEY = "refineCommonOre";
const REFINE_INPUT_ITEM = "commonOre";
const REFINE_PER_ITER = 100; // REFINE_RECIPES.refineCommonOre.input.commonOre

const FAB_KEY = "structuralAssemblyBp";

// Small helper to build a refine line for the one real refine recipe.
function refineLine(id: string, remaining: number): CraftLine {
  return { id, kind: "refine", recipeKey: REFINE_KEY, remaining };
}

// Small helper to build a fabricate line for a real blueprint.
function fabricateLine(id: string, recipeKey: string, remaining: number): CraftLine {
  return { id, kind: "fabricate", recipeKey, remaining };
}

describe("lineInputsPerIteration", () => {
  it("returns the refine recipe's input map as Decimals", () => {
    const inputs = lineInputsPerIteration(refineLine("l1", 1));
    expect(inputs[REFINE_INPUT_ITEM]).toBeInstanceOf(Decimal);
    expect(inputs[REFINE_INPUT_ITEM].toNumber()).toBe(REFINE_PER_ITER);
    // Sanity: matches the registry directly (no drift).
    expect(inputs[REFINE_INPUT_ITEM].toNumber()).toBe(
      REFINE_RECIPES[REFINE_KEY].input[REFINE_INPUT_ITEM].toNumber(),
    );
  });

  it("returns a fabricate blueprint's recipe.inputs mapped to Decimals", () => {
    const inputs = lineInputsPerIteration(fabricateLine("l1", FAB_KEY, 1));
    const recipeInputs = BLUEPRINTS[FAB_KEY].recipe.inputs;
    for (const [itemId, qty] of Object.entries(recipeInputs)) {
      expect(inputs[itemId]).toBeInstanceOf(Decimal);
      expect(inputs[itemId].toNumber()).toBe(qty);
    }
  });

  it("returns {} for an unknown recipeKey (defensive)", () => {
    const refineUnknown = lineInputsPerIteration({
      id: "x",
      kind: "refine",
      recipeKey: "doesNotExist",
      remaining: 5,
    });
    const fabUnknown = lineInputsPerIteration({
      id: "y",
      kind: "fabricate",
      recipeKey: "doesNotExist",
      remaining: 5,
    });
    expect(refineUnknown).toEqual({});
    expect(fabUnknown).toEqual({});
  });
});

describe("allocatedItem", () => {
  it("no lines -> allocated 0", () => {
    expect(allocatedItem([], "commonOre").toNumber()).toBe(0);
  });

  it("worked example: refine line, remaining 10 (x100) -> allocated 1000", () => {
    const lines = [refineLine("l1", 10)];
    expect(allocatedItem(lines, REFINE_INPUT_ITEM).toNumber()).toBe(1000);
  });

  it("worked example after crafts: remaining 9 (x100) -> allocated 900", () => {
    const lines = [refineLine("l1", 9)];
    expect(allocatedItem(lines, REFINE_INPUT_ITEM).toNumber()).toBe(900);
  });

  it("two lines reserving the SAME item sum their allocations", () => {
    const lines = [refineLine("l1", 10), refineLine("l2", 4)];
    // (10 + 4) x 100 = 1400
    expect(allocatedItem(lines, REFINE_INPUT_ITEM).toNumber()).toBe(1400);
  });

  it("multi-INPUT fabricate recipe allocates each input independently", () => {
    // structuralAssemblyBp per iteration: frameSegment 2, powerCoupling 1, titaniumIngot 2
    const lines = [fabricateLine("l1", FAB_KEY, 3)];
    expect(allocatedItem(lines, "frameSegment").toNumber()).toBe(6); // 2 x 3
    expect(allocatedItem(lines, "powerCoupling").toNumber()).toBe(3); // 1 x 3
    expect(allocatedItem(lines, "titaniumIngot").toNumber()).toBe(6); // 2 x 3
    // An item NOT in the recipe is allocated 0.
    expect(allocatedItem(lines, "commonOre").toNumber()).toBe(0);
  });

  it("item not consumed by any line -> allocated 0", () => {
    const lines = [refineLine("l1", 10)];
    expect(allocatedItem(lines, "titaniumIngot").toNumber()).toBe(0);
  });

  it("unknown recipeKey line contributes 0", () => {
    const lines: CraftLine[] = [
      { id: "x", kind: "refine", recipeKey: "doesNotExist", remaining: 999 },
    ];
    expect(allocatedItem(lines, "commonOre").toNumber()).toBe(0);
  });
});

describe("freeItem", () => {
  it("no lines -> free == full stock", () => {
    const inventory = { commonOre: new Decimal(1000) };
    expect(freeItem(inventory, [], "commonOre").toNumber()).toBe(1000);
  });

  it("worked example: stock 1000, allocated 1000 -> free 0", () => {
    const inventory = { commonOre: new Decimal(1000) };
    const lines = [refineLine("l1", 10)]; // 10 x 100 = 1000 reserved
    expect(freeItem(inventory, lines, "commonOre").toNumber()).toBe(0);
  });

  it("worked example after crafts: stock 900, allocated 900 -> free 0", () => {
    const inventory = { commonOre: new Decimal(900) };
    const lines = [refineLine("l1", 9)]; // 9 x 100 = 900 reserved
    expect(freeItem(inventory, lines, "commonOre").toNumber()).toBe(0);
  });

  it("partial reservation leaves the remainder free", () => {
    const inventory = { commonOre: new Decimal(1000) };
    const lines = [refineLine("l1", 3)]; // 3 x 100 = 300 reserved
    expect(freeItem(inventory, lines, "commonOre").toNumber()).toBe(700);
  });

  it("two lines on the same item: free reflects the SUMMED reservation", () => {
    const inventory = { commonOre: new Decimal(1000) };
    const lines = [refineLine("l1", 5), refineLine("l2", 2)]; // (5+2) x 100 = 700
    expect(freeItem(inventory, lines, "commonOre").toNumber()).toBe(300);
  });

  it("free is NEVER negative: over-reserved stock clamps to 0", () => {
    const inventory = { commonOre: new Decimal(500) };
    const lines = [refineLine("l1", 10)]; // reserves 1000 > 500 stock
    const free = freeItem(inventory, lines, "commonOre");
    expect(free.toNumber()).toBe(0);
    expect(free.gte(0)).toBe(true);
  });

  it("missing inventory key -> free 0 (defensive, not NaN/negative)", () => {
    const inventory: Record<string, Decimal> = {};
    const lines = [refineLine("l1", 1)]; // reserves 100 of an absent item
    expect(freeItem(inventory, lines, "commonOre").toNumber()).toBe(0);
  });

  it("multi-input fabricate: free tracks each input against its own reservation", () => {
    const inventory = {
      frameSegment: new Decimal(10),
      powerCoupling: new Decimal(10),
      titaniumIngot: new Decimal(10),
    };
    const lines = [fabricateLine("l1", FAB_KEY, 3)]; // fs 6, pc 3, ti 6 reserved
    expect(freeItem(inventory, lines, "frameSegment").toNumber()).toBe(4); // 10 - 6
    expect(freeItem(inventory, lines, "powerCoupling").toNumber()).toBe(7); // 10 - 3
    expect(freeItem(inventory, lines, "titaniumIngot").toNumber()).toBe(4); // 10 - 6
  });
});
