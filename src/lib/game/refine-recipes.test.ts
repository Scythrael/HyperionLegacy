// Verifies the production chain CONNECTS: the Refinery now produces the exact refined
// materials the Fabricator's tier-1 blueprints consume (mine -> refine -> fabricate).
// Before the 2026-07-16 recipe add, the only refine recipe made the generic
// `refinedMaterial`, which no blueprint used, the chain dead-ended in the middle.
// ITEM-MERGE (0.11.0 Task A1, 2026-07-18): `refinedMaterial` was fully retired, folded
// into `titaniumIngot` (the sole refined-titanium item). The guard block at the bottom
// asserts that retirement stays complete (no recipe/blueprint/ITEMS reference survives).
import { describe, it, expect } from "vitest";
import { REFINE_RECIPES, BLUEPRINTS, ITEMS } from "./model";

describe("Refinery produces the Fabricator's blueprint inputs (chain connects)", () => {
  const refineOutputs = new Set(Object.values(REFINE_RECIPES).map((r) => r.output.itemId));
  const blueprintOutputs = new Set(Object.values(BLUEPRINTS).map((b) => b.recipe.outputItem));

  it("the two new recipes produce titaniumIngot and polysilicateWafer", () => {
    expect(refineOutputs.has("titaniumIngot")).toBe(true);
    expect(refineOutputs.has("polysilicateWafer")).toBe(true);
  });

  it("their inputs are real, mined raw ores", () => {
    expect(ITEMS.commonOre?.category).toBe("raw"); // Titanium Ore
    expect(ITEMS.uncommonMaterial?.category).toBe("raw"); // Polysilicate Ore
    expect(REFINE_RECIPES.refineCommonOre.input.commonOre.toNumber()).toBeGreaterThan(0);
    expect(REFINE_RECIPES.refinePolysilicateWafer.input.uncommonMaterial.toNumber()).toBeGreaterThan(0);
  });

  it("their outputs resolve to real refined ITEMS", () => {
    expect(ITEMS.titaniumIngot?.category).toBe("refined");
    expect(ITEMS.polysilicateWafer?.category).toBe("refined");
  });

  it("every 'refined' input any blueprint needs is producible by refining (chain has no dead end)", () => {
    for (const bp of Object.values(BLUEPRINTS)) {
      for (const inputId of Object.keys(bp.recipe.inputs)) {
        if (ITEMS[inputId]?.category !== "refined") continue; // component inputs come from other blueprints
        // A refined input must be obtainable: from the Refinery, or (defensively) as a blueprint output.
        expect(refineOutputs.has(inputId) || blueprintOutputs.has(inputId)).toBe(true);
      }
    }
  });
});

// ITEM-MERGE guard (0.11.0 Task A1): the retired `refinedMaterial` item must stay gone.
// It was a duplicate of `titaniumIngot` (both refined from the same Titanium Ore); this
// block proves the merge is complete and stays complete, no live reference reintroduces
// the dead item, and titaniumIngot is the one refined-titanium item. (Old-save migration
// buckets are a SEPARATE concern handled by a later save-migration task, not asserted here.)
describe("ITEM-MERGE, refinedMaterial fully retired into titaniumIngot", () => {
  it("is absent from the ITEMS registry", () => {
    expect(ITEMS.refinedMaterial).toBeUndefined();
    expect(ITEMS.titaniumIngot).toBeDefined();
    expect(ITEMS.titaniumIngot.category).toBe("refined");
  });

  it("is not produced by any REFINE_RECIPE", () => {
    for (const recipe of Object.values(REFINE_RECIPES)) {
      expect(recipe.output.itemId).not.toBe("refinedMaterial");
    }
  });

  it("is not consumed as an input by any BLUEPRINT recipe", () => {
    for (const bp of Object.values(BLUEPRINTS)) {
      expect(Object.keys(bp.recipe.inputs)).not.toContain("refinedMaterial");
    }
  });

  it("titaniumIngot is the SOLE refined-titanium item: it is the only refine output whose input is commonOre (Titanium Ore)", () => {
    // After the 0.11.0 recipe-collapse there is exactly ONE commonOre-fed recipe
    // (refineCommonOre, now at the 20:1 ratio); it outputs titaniumIngot and nothing
    // else, so no commonOre-fed recipe outputs any other item.
    const titaniumFedOutputs = new Set(
      Object.values(REFINE_RECIPES)
        .filter((r) => Object.keys(r.input).includes("commonOre"))
        .map((r) => r.output.itemId),
    );
    expect([...titaniumFedOutputs]).toEqual(["titaniumIngot"]);
  });
});
