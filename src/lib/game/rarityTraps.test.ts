// RARITY READINESS RR-7 (docs/plans/2026-10-23-rarity-readiness-plan.md, Review Focus 5): the traps a later switch-on
// would spring. Crew multiplier rows above the cap (answer 7), warehouse colors on the rarity tokens (the color-blind
// palette), relic blanks decoupled from the salvage pool (answer 10), a fifth salvage ceiling row, the set-complete
// shoutout, and Derelict unified as the Standard-Issue floor (answer 9).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  EQUIPMENT_RARITY_LADDER,
  EQUIPMENT_SLOTS,
  PRODUCIBLE_EQUIPMENT_RARITIES,
  SALVAGE_LOOT_POOLS,
  freshState,
  itemValueRarity,
  moduleEffectScale,
  rarityIndex,
  rollCraftedRarity,
  salvageDurationTicks,
  type EquipmentInstance,
  type EquipmentRarity,
  type GameState,
} from "./model";
import { CREW_LEGENDARY_MULTIPLIER, CREW_RARITY_CAP, CREW_RARITY_MULTIPLIER, crewRarityMultiplier, crewRarityMultiplierAt } from "./crewRarity";
import { RELIC_BLANK_LADDER_I, RELIC_BLANK_WEIGHTS, relicBlankCeiling, rollBlankRarity } from "./relicBlanks";
import { rollRelicToken } from "./gambit";
import { SALVAGE_CEILING_THRESHOLDS, salvageBaseCeiling } from "./salvage";
import { RARITY_PROFILES } from "./rarityProfiles";
import { itemScore } from "./archive";
import { RELIC_SET_BY_POI, relicBandOf } from "./relics";
import { sortRolledPieces } from "./inspectSort";
import { autoSalvageIsBetter } from "./salvage";
import { generateEquipment, rarityBudget } from "./itemgen";
import { setCompletionShoutouts } from "./setShoutouts";
import { makeRng } from "./combat/rng";
import appSource from "../../App.svelte?raw";

const LADDER = EQUIPMENT_RARITY_LADDER;

describe("RR-7: crew multiplier rows (answer 7)", () => {
  it("every band has a row; the live rows are unchanged; Luminous and Constellar share one legendary value", () => {
    expect(Object.keys(CREW_RARITY_MULTIPLIER)).toEqual([...LADDER]);
    expect([CREW_RARITY_MULTIPLIER.derelict, CREW_RARITY_MULTIPLIER.standard, CREW_RARITY_MULTIPLIER.augmented, CREW_RARITY_MULTIPLIER.stellar]).toEqual([0.9, 1.0, 1.15, 1.35]);
    expect(CREW_RARITY_MULTIPLIER.radiant).toBe(1.55);
    expect(CREW_RARITY_MULTIPLIER.luminous).toBe(CREW_LEGENDARY_MULTIPLIER);
    expect(CREW_RARITY_MULTIPLIER.constellar).toBe(CREW_LEGENDARY_MULTIPLIER);
  });

  it("the cap stays Stellar, so a crew above it still reads Stellar's value today", () => {
    expect(CREW_RARITY_CAP).toBe("stellar");
    for (const r of ["radiant", "luminous", "constellar"] as EquipmentRarity[]) expect(crewRarityMultiplier(r)).toBe(CREW_RARITY_MULTIPLIER.stellar);
  });

  it("whatever the cap is raised to, a higher band is never weaker (the guard)", () => {
    for (const cap of LADDER) {
      let prev = -Infinity;
      for (const r of LADDER) {
        const m = crewRarityMultiplierAt(r, cap);
        expect(m, `${r} under cap ${cap}`).toBeGreaterThanOrEqual(prev);
        prev = m;
      }
    }
    expect(crewRarityMultiplierAt("radiant", "constellar")).toBe(1.55);
  });
});

describe("RR-7: warehouse colors ride the rarity tokens (and so the color-blind palette)", () => {
  const css = readFileSync("src/app.css", "utf8");
  const block = (sel: string) => {
    const i = css.indexOf(sel);
    return i < 0 ? "" : css.slice(i, css.indexOf("}", i));
  };
  it("warehouseRarityColor returns a var(--item-rarity-*) token for every item rarity", () => {
    const fn = appSource.slice(appSource.indexOf("function warehouseRarityColor"), appSource.indexOf("function warehouseRarityColor") + 900);
    for (const r of ["common", "uncommon", "rare", "epic", "legendary"]) expect(fn).toContain(`var(--item-rarity-${r})`);
    expect(fn).not.toMatch(/#[0-9a-fA-F]{6}/);
  });
  it("the tokens keep today's colors, and the cbsafe palette remaps the hard-coded ones", () => {
    const root = block(":root {");
    expect(root).toContain("--item-rarity-common: #8b9cb0;");
    expect(root).toContain("--item-rarity-uncommon: var(--color-success);");
    expect(root).toContain("--item-rarity-rare: #4fa3f2;");
    expect(root).toContain("--item-rarity-epic: #b07cf2;");
    expect(root).toContain("--item-rarity-legendary: var(--color-warning);");
    const cb = block(':root[data-palette="cbsafe"] {');
    expect(cb).toContain("--item-rarity-rare: #56b4e9;");
    expect(cb).toContain("--item-rarity-epic: #cc79a7;");
  });
});

describe("RR-7: relic blanks no longer read the salvage pool (answer 10)", () => {
  it("the Tier I blank ladder is its own frozen table with today's rows", () => {
    expect(RELIC_BLANK_LADDER_I).toEqual([
      { tier: "standard", weight: 1000, quality: 0 },
      { tier: "augmented", weight: 300, quality: 1 },
      { tier: "stellar", weight: 40, quality: 3 },
      { tier: "radiant", weight: 5, quality: 4 },
    ]);
    expect(RELIC_BLANK_WEIGHTS[1]).toEqual(RELIC_BLANK_LADDER_I);
  });

  it("a legendary salvage tier added to the pool neither creates nor flattens a relic blank", () => {
    const pool = SALVAGE_LOOT_POOLS.intactReactorCore as unknown as { tier: EquipmentRarity; weight: number; quality: number; drops: unknown[] }[];
    const roll = () => {
      const out: unknown[] = [relicBlankCeiling(1), relicBlankCeiling(1, 3)];
      for (let seed = 1; seed < 200; seed++) {
        out.push(rollBlankRarity(makeRng(seed), 1, 9).tier, rollBlankRarity(makeRng(seed), 4, 9).tier);
        out.push(rollRelicToken(seed, 1, Object.keys(RELIC_SET_BY_POI)[0], `r-${seed}`, 1)?.tier ?? null);
      }
      return out;
    };
    const before = roll();
    pool.push({ tier: "luminous", weight: 1, quality: 5, drops: [{ itemId: "scrapAlloy", weight: 1 }] });
    try {
      const after = roll();
      expect(after).toEqual(before);
      expect(after).not.toContain("luminous");
    } finally {
      pool.pop();
    }
  });
});

describe("RR-7: the salvage ceiling has a fifth row (clamped to each pool's real top)", () => {
  it("Fleet Admiral 20 opens index 4 [PROVISIONAL]; the four-tier pools still top out at index 3", () => {
    expect(SALVAGE_CEILING_THRESHOLDS[SALVAGE_CEILING_THRESHOLDS.length - 1]).toEqual({ minFleetAdminLevel: 20, maxTierIndex: 4 });
    expect(salvageBaseCeiling(19)).toBe(3);
    expect(salvageBaseCeiling(20)).toBe(4);
    for (const pool of Object.values(SALVAGE_LOOT_POOLS)) expect(Math.min(salvageBaseCeiling(20), pool.length - 1)).toBe(pool.length - 1);
  });
});

describe("RR-7: Derelict is the Standard-Issue floor in every item value reader (answer 9), still never produced", () => {
  const cargo = (rarity: EquipmentRarity, id: string, quality = 2): EquipmentInstance =>
    generateEquipment({ slotType: "cargoBay", varietyKey: EQUIPMENT_SLOTS.cargoBay.varieties[0].key, blueprintKey: null, iLevel: 20, quality, rarity, ascension: "none", rng: () => 0.5, allocateId: () => id });
  it("value readers: Derelict reads as Standard (budget, module scale, salvage, relic band, Archive score)", () => {
    expect(itemValueRarity("derelict")).toBe("standard");
    for (const r of ["standard", "augmented", "luminous"] as EquipmentRarity[]) expect(itemValueRarity(r)).toBe(r);
    expect(RARITY_PROFILES.derelict.budgetMult).toBe(RARITY_PROFILES.standard.budgetMult);
    expect(RARITY_PROFILES.derelict.affixes).toBe(0); // a Standard-Issue floor piece rolls no affixes
    expect(rarityBudget(20, 2, "derelict")).toBe(rarityBudget(20, 2, "standard"));
    expect(moduleEffectScale("derelict", 3)).toBe(moduleEffectScale("standard", 3));
    expect(relicBandOf("derelict")).toBe("standard");
    expect(itemScore({ rarity: "derelict", quality: 2, iLevel: 20 })).toBe(itemScore({ rarity: "standard", quality: 2, iLevel: 20 }));
    expect(salvageDurationTicks({ kind: "equipment", iLevel: 20, quality: 2, rarity: "derelict", tier: 1 })).toBe(salvageDurationTicks({ kind: "equipment", iLevel: 20, quality: 2, rarity: "standard", tier: 1 }));
    expect(cargo("derelict", "d").implicitStats).toEqual(cargo("standard", "s").implicitStats);
  });
  it("order readers keep it just below Standard, and nothing produces it", () => {
    expect(rarityIndex("derelict")).toBeLessThan(rarityIndex("standard"));
    expect(sortRolledPieces([cargo("derelict", "d"), cargo("standard", "s")]).map((p) => p.id)).toEqual(["s", "d"]);
    expect(autoSalvageIsBetter(cargo("standard", "equip-9"), cargo("derelict", "equip-1"))).toBe(true);
    expect(PRODUCIBLE_EQUIPMENT_RARITIES).not.toContain("derelict");
    for (let i = 0; i < 1000; i++) expect(rollCraftedRarity(() => i / 1000)).not.toBe("derelict");
    // crew Derelict is a LIVE crew band and is not touched
    expect(CREW_RARITY_MULTIPLIER.derelict).toBe(0.9);
  });
});

describe("RR-7: the set-complete shoutout", () => {
  function withSets(s: GameState, sets: string[]): GameState {
    return { ...s, museumV2: { ...(s.museumV2 ?? { general: {}, exceptional: {}, frozen: {}, cultures: {}, culturesNamed: [] }), setsCompleted: sets } as GameState["museumV2"] };
  }
  it("names each newly completed relic set once, with no [PROPOSAL] tag", () => {
    const s = freshState();
    const before = withSets(s, []);
    const after = withSets(s, ["exc-t1-a"]);
    const lines = setCompletionShoutouts(before, after);
    expect(lines).toHaveLength(1);
    // MOVED by Relics v2 R2-5: the approved set name (was the placeholder "Tier I Exceptional Set A").
    expect(lines[0]).toContain("Waystation Set");
    expect(lines[0]).not.toContain("[PROPOSAL]");
    expect(setCompletionShoutouts(after, after)).toEqual([]);
  });

  it("names a gear set the moment a ship completes it (all of its tiers active)", () => {
    const s = freshState();
    const ship = s.ships[0].id;
    const survey = ["cargoBay", "ftlDrive", "sensor", "reactorCore", "specUtility"].map(
      (slotType, i) =>
        ({ id: `sp-${i}`, slotType, rarity: "constellar", ascension: "none", quality: 0, iLevel: 10, blueprintKey: null, implicitStats: {}, rolledStats: {}, mass: 0, powerDraw: 0, durabilityMax: 100, fittedToShipId: ship, setId: "testSetSurvey" }) as EquipmentInstance,
    );
    const four = { ...s, equipment: [...s.equipment, ...survey.slice(0, 4)] };
    const five = { ...s, equipment: [...s.equipment, ...survey] };
    expect(setCompletionShoutouts(four, five).some((l) => l.includes("Survey Cadre"))).toBe(true);
    expect(setCompletionShoutouts(five, five)).toEqual([]);
    expect(setCompletionShoutouts(five, four)).toEqual([]); // breaking a set says nothing
  });

  it("the App logs the shoutouts after the offline catch-up and on every live state change", () => {
    expect(appSource).toMatch(/setCompletionShoutouts\(beforeSnapshot, state\)/);
    expect(appSource).toMatch(/setCompletionShoutouts\(shoutoutBasis, state\)/);
  });
});
