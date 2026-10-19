// Field Kits FKR-3 (docs/plans/2026-10-14-field-kits-plan.md REVISED SLICES R3 FKR-3, USER ANSWERS call 3 "Two
// research tiers", N13 "3x material value", calls 16 + 17): the six kits as stackable ITEMS, their material
// blueprints in two research tiers, a craft depositing them, and the Quartermaster price data. Nothing spends a kit
// yet (FKR-6 uses them in battle, FKR-7 packs, sells and tops up).

import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import { BLUEPRINTS, ITEMS, blueprintKind, freshState, type GameState } from "./model";
import { economyTick, startLine, startResearch } from "./tick";
import { addItemQuality, itemTotal } from "./inventory";
import {
  FIELD_KITS,
  FIELD_KIT_BLUEPRINT,
  FIELD_KIT_IDS,
  FIELD_KIT_MATERIAL_WORTH,
  FIELD_KIT_PRICES,
  FIELD_KIT_PRICE_MULTIPLE,
  FIELD_KIT_PRICE_STEP,
  fieldKitMaterialValue,
  type FieldKitId,
} from "./fieldKits";

// Call 3 as answered ("Two research tiers (Recommended)", the proposal's recipes): tier 1 cheap, 2 per craft; tier 2
// the serious kits.
const RECIPES: Readonly<Record<FieldKitId, { tier: number; inputs: Record<string, number>; qty: number }>> = {
  firstAidKit: { tier: 1, inputs: { purifiedBiomass: 1, polysilicateWafer: 1 }, qty: 2 },
  // User 2026-10-19 merge batch answers: Antitoxin "Biomass + Titanium, 60"; Splint "Raise to Tier 2 band" (95).
  antitoxin: { tier: 1, inputs: { purifiedBiomass: 1, titaniumIngot: 1 }, qty: 2 },
  splint: { tier: 1, inputs: { titaniumIngot: 1, fibrousBiomass: 1, purifiedBiomass: 2 }, qty: 2 },
  combatStim: { tier: 2, inputs: { volatileResin: 1, purifiedBiomass: 1 }, qty: 2 },
  traumaKit: { tier: 2, inputs: { purifiedBiomass: 2, exoticSporeCluster: 1, polysilicateWafer: 1 }, qty: 1 },
  injuryKit: { tier: 2, inputs: { purifiedBiomass: 2, polysilicateWafer: 1, powerCoupling: 1 }, qty: 1 },
};

const RESEARCH_BY_TIER: Readonly<Record<number, { ticks: number; credits: number }>> = {
  1: { ticks: 60, credits: 700 },
  2: { ticks: 120, credits: 1600 },
};

const HINT = "Crafted at the Fabricator after research.";

// A fresh save with the Research Lab and the Fabricator at level 2 (both tiers open), rich in credits.
function workshop(): GameState {
  const s = freshState();
  return {
    ...s,
    credits: new Decimal(1e9),
    facilities: { ...s.facilities, research: { level: 2 }, fabricator: { level: 2 } },
  };
}

function hold(s: GameState, item: string, qty: number): GameState {
  return { ...s, inventory: addItemQuality(s.inventory, item, new Decimal(qty), 0) };
}

function run(s: GameState, ticks: number): GameState {
  let out = s;
  for (let i = 0; i < ticks; i += 1) out = economyTick(out, 1, () => 0.5);
  return out;
}

describe("field kit items (FKR-3)", () => {
  it("each kit is a stackable fieldKit ITEMS row keyed by its kit id, labeled as the catalog names it", () => {
    for (const id of FIELD_KIT_IDS) {
      const item = ITEMS[id];
      expect(item, id).toBeDefined();
      expect(item.category).toBe("fieldKit");
      expect(item.label).toBe(FIELD_KITS[id].label);
      expect(item.tier).toBe(1); // the warehouse tier that holds it (both research tiers store in Tier 1)
      expect(item.subCategory).toBeUndefined();
      expect(item.flavor.length).toBeGreaterThan(0);
    }
  });

  it("every kit's hint is honest: crafted at the Fabricator after research", () => {
    for (const id of FIELD_KIT_IDS) expect(ITEMS[id].unlockHint).toBe(HINT);
  });

  it("only the six kits carry the fieldKit category", () => {
    const kits = Object.keys(ITEMS).filter((k) => ITEMS[k].category === "fieldKit");
    expect(kits.sort()).toEqual([...FIELD_KIT_IDS].sort());
  });

  it("no kit is sellable at the Sell counter (the Quartermaster SELLS kits at FKR-7, it never buys them back)", () => {
    for (const id of FIELD_KIT_IDS) expect(ITEMS[id].sellValue).toBeUndefined();
  });
});

describe("field kit blueprints (FKR-3, call 3: two research tiers)", () => {
  it("each kit has a material blueprint whose output is the kit", () => {
    for (const id of FIELD_KIT_IDS) {
      const key = FIELD_KIT_BLUEPRINT[id];
      const bp = BLUEPRINTS[key];
      expect(bp, key).toBeDefined();
      expect(bp.key).toBe(key);
      expect(blueprintKind(bp)).toBe("material");
      expect(bp.recipe.outputItem).toBe(id);
      expect(bp.label).toBe(`${FIELD_KITS[id].label} Blueprint`);
    }
  });

  it("recipes, output counts and research tiers are the answered proposal", () => {
    for (const id of FIELD_KIT_IDS) {
      const bp = BLUEPRINTS[FIELD_KIT_BLUEPRINT[id]];
      const want = RECIPES[id];
      expect(bp.tier, id).toBe(want.tier);
      expect(bp.recipe.inputs, id).toEqual(want.inputs);
      expect(bp.recipe.outputQty, id).toBe(want.qty);
      expect(bp.researchDurationTicks, id).toBe(RESEARCH_BY_TIER[want.tier].ticks);
      expect(bp.researchCreditCost, id).toBe(RESEARCH_BY_TIER[want.tier].credits);
    }
  });

  it("tier 1 is First Aid Kit, Antitoxin, Splint at 2 per craft; tier 2 is Combat Stim, Trauma Kit, Injury Kit", () => {
    const tier = (t: number) => FIELD_KIT_IDS.filter((id) => BLUEPRINTS[FIELD_KIT_BLUEPRINT[id]].tier === t).sort();
    expect(tier(1)).toEqual(["antitoxin", "firstAidKit", "splint"]);
    expect(tier(2)).toEqual(["combatStim", "injuryKit", "traumaKit"]);
    for (const id of tier(1)) expect(BLUEPRINTS[FIELD_KIT_BLUEPRINT[id]].recipe.outputQty).toBe(2);
  });

  it("every input is an existing material, never a kit", () => {
    for (const id of FIELD_KIT_IDS) {
      for (const input of Object.keys(BLUEPRINTS[FIELD_KIT_BLUEPRINT[id]].recipe.inputs)) {
        expect(ITEMS[input], `${id} <- ${input}`).toBeDefined();
        expect(ITEMS[input].category).not.toBe("fieldKit");
      }
    }
  });

  it("each blueprint's hint names the Research Lab and the Fabricator", () => {
    for (const id of FIELD_KIT_IDS) {
      const hint = BLUEPRINTS[FIELD_KIT_BLUEPRINT[id]].unlockHint ?? "";
      expect(hint).toContain("Research Lab");
      expect(hint).toContain("Fabricator");
    }
  });

  it("research, then a one-craft line, deposits the kit (outputQty units, any quality bucket)", () => {
    for (const id of FIELD_KIT_IDS) {
      const key = FIELD_KIT_BLUEPRINT[id];
      const bp = BLUEPRINTS[key];
      let s = workshop();
      const r = startResearch(s, key);
      expect(r.started, `${id}: research starts`).toBe(true);
      s = run(r.next, bp.researchDurationTicks + 1);
      expect(s.researchedBlueprints, `${id}: researched`).toContain(key);
      for (const [input, qty] of Object.entries(bp.recipe.inputs)) s = hold(s, input, qty);
      const line = startLine(s, "fabricate", key, { kind: "batch", remaining: 1 });
      expect(line.started, `${id}: craft starts (${line.reason ?? "ok"})`).toBe(true);
      const done = run(line.next, bp.craftDurationTicks + 2);
      expect(Number(itemTotal(done.inventory, id)), id).toBe(bp.recipe.outputQty);
      for (const input of Object.keys(bp.recipe.inputs)) expect(Number(itemTotal(done.inventory, input)), `${id} spent ${input}`).toBe(0);
    }
  });

  it("an unresearched kit blueprint cannot be crafted", () => {
    let s = workshop();
    for (const [input, qty] of Object.entries(RECIPES.firstAidKit.inputs)) s = hold(s, input, qty);
    const line = startLine(s, "fabricate", FIELD_KIT_BLUEPRINT.firstAidKit, { kind: "batch", remaining: 1 });
    expect(line.started).toBe(false);
    expect(line.reason).toBe("notResearched");
  });
});

describe("Quartermaster price data (FKR-3, N13: 3x material value)", () => {
  it("every kit has a whole, positive price on the step", () => {
    for (const id of FIELD_KIT_IDS) {
      const p = FIELD_KIT_PRICES[id];
      expect(Number.isInteger(p), id).toBe(true);
      expect(p, id).toBeGreaterThan(0);
      expect(p % FIELD_KIT_PRICE_STEP, id).toBe(0);
    }
  });

  it("a price is 3x the material value of one kit, rounded to the step", () => {
    expect(FIELD_KIT_PRICE_MULTIPLE).toBe(3);
    for (const id of FIELD_KIT_IDS) {
      const bp = BLUEPRINTS[FIELD_KIT_BLUEPRINT[id]];
      const value = Object.entries(bp.recipe.inputs).reduce((sum, [k, q]) => sum + q * FIELD_KIT_MATERIAL_WORTH[k], 0) / (bp.recipe.outputQty ?? 1);
      expect(fieldKitMaterialValue(id)).toBeCloseTo(value, 9);
      expect(FIELD_KIT_PRICES[id]).toBe(Math.round((value * FIELD_KIT_PRICE_MULTIPLE) / FIELD_KIT_PRICE_STEP) * FIELD_KIT_PRICE_STEP);
    }
  });

  it("the user's examples hold: First Aid Kit 60, Combat Stim 150", () => {
    expect(FIELD_KIT_PRICES.firstAidKit).toBe(60);
    expect(FIELD_KIT_PRICES.combatStim).toBe(150);
  });

  it("the user's 2026-10-19 prices hold: Antitoxin 60 (like First Aid), Splint near 100 between First Aid and Stim", () => {
    expect(FIELD_KIT_PRICES.antitoxin).toBe(60);
    expect(FIELD_KIT_PRICES.splint).toBe(95);
    expect(FIELD_KIT_PRICES.splint).toBeGreaterThan(FIELD_KIT_PRICES.firstAidKit);
    expect(FIELD_KIT_PRICES.splint).toBeLessThan(FIELD_KIT_PRICES.combatStim);
  });

  it("every recipe input has a worth", () => {
    for (const id of FIELD_KIT_IDS) {
      for (const input of Object.keys(BLUEPRINTS[FIELD_KIT_BLUEPRINT[id]].recipe.inputs)) {
        expect(FIELD_KIT_MATERIAL_WORTH[input], input).toBeGreaterThan(0);
      }
    }
  });

  it("the serious tier 2 kits (Trauma Kit, Injury Kit) cost more than every tier 1 kit", () => {
    const tier1 = FIELD_KIT_IDS.filter((id) => BLUEPRINTS[FIELD_KIT_BLUEPRINT[id]].tier === 1).map((id) => FIELD_KIT_PRICES[id]);
    for (const id of ["traumaKit", "injuryKit"] as const) expect(FIELD_KIT_PRICES[id]).toBeGreaterThan(Math.max(...tier1));
  });
});
