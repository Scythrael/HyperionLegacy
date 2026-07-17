// Verifies the production chain CONNECTS: the Refinery now produces the exact refined
// materials the Fabricator's tier-1 blueprints consume (mine -> refine -> fabricate).
// Before the 2026-07-16 recipe add, the only refine recipe made the generic
// `refinedMaterial`, which no blueprint uses -- the chain dead-ended in the middle.
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
    expect(REFINE_RECIPES.refineTitaniumIngot.input.commonOre.toNumber()).toBeGreaterThan(0);
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
