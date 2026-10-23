// RARITY READINESS RR-4 (docs/plans/2026-10-23-rarity-readiness-plan.md, Review Focus 3; user answer 3 "Plumbing only"):
// Nova and Celestial ascension. Real data (budget boost, the Luminous / Constellar only rule, labels, sort, the
// auto-salvage exemption) behind the producibility switch ASCENSION_PRODUCIBLE = false: no player path mints one, the
// Debug minter is the only source, and the math is live for any piece that carries a valid ascension.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { EQUIPMENT_ASCENSIONS, EQUIPMENT_RARITY_LADDER, EQUIPMENT_SLOTS, ascensionAllowedFor, type EquipmentAscension, type EquipmentInstance, type EquipmentRarity } from "./model";
import {
  ASCENSION_BUDGET_MULT,
  ASCENSION_EXTRAS,
  ASCENSION_PRODUCIBLE,
  CELESTIAL_BUDGET_MULT,
  NOVA_BUDGET_MULT,
  ascendedProfile,
  ascensionLabel,
  ascensionOrder,
  effectiveAscension,
} from "./ascension";
import { RARITY_PROFILES } from "./rarityProfiles";
import { generateEquipment, generateWeapon, rarityBudget } from "./itemgen";
import { sortRolledPieces } from "./inspectSort";
import { autoSalvageIsBetter, autoSalvageProtection, autoSalvageProtectionContext, autoSalvageSubjectForPiece } from "./salvage";
import { freshState } from "./model";

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function cargo(rarity: EquipmentRarity, ascension: EquipmentAscension, id = "e", seed = 7, quality = 5): EquipmentInstance {
  return generateEquipment({
    slotType: "cargoBay",
    varietyKey: EQUIPMENT_SLOTS.cargoBay.varieties[1].key,
    blueprintKey: null,
    iLevel: 40,
    quality,
    rarity,
    ascension,
    rng: lcg(seed),
    allocateId: () => id,
  });
}

describe("RR-4: the switch and the rule", () => {
  it("no player path can produce an ascension", () => {
    expect(ASCENSION_PRODUCIBLE).toBe(false);
    // Every Fabricator / inspect mint and Standard-Issue mint still stamps "none" (the dev mint is the only source).
    const tick = readFileSync("src/lib/game/tick.ts", "utf8");
    const stamps = tick.match(/ascension: [^,\n]+/g) ?? [];
    expect(stamps.length).toBeGreaterThan(0);
    for (const s of stamps) expect(s).toBe('ascension: "none"');
  });

  it("an ascension counts only on Luminous and Constellar; anything else reads none", () => {
    for (const r of EQUIPMENT_RARITY_LADDER) {
      for (const a of EQUIPMENT_ASCENSIONS) expect(effectiveAscension(r, a), `${r} ${a}`).toBe(ascensionAllowedFor(r) ? a : "none");
    }
    expect(effectiveAscension("luminous", "supernova" as EquipmentAscension)).toBe("none");
  });
});

describe("RR-4: the numbers", () => {
  it("Nova and Celestial multiply a legendary's budget by their [PROVISIONAL] factors", () => {
    expect(ASCENSION_BUDGET_MULT).toEqual({ none: 1, nova: NOVA_BUDGET_MULT, celestial: CELESTIAL_BUDGET_MULT });
    expect(NOVA_BUDGET_MULT).toBe(1.25);
    expect(CELESTIAL_BUDGET_MULT).toBe(1.4);
    for (const r of ["luminous", "constellar"] as EquipmentRarity[]) {
      expect(ascendedProfile(r, "nova").budgetMult).toBeCloseTo(RARITY_PROFILES[r].budgetMult * NOVA_BUDGET_MULT, 12);
      expect(ascendedProfile(r, "celestial").budgetMult).toBeCloseTo(RARITY_PROFILES[r].budgetMult * CELESTIAL_BUDGET_MULT, 12);
      const none = rarityBudget(40, 5, r);
      const nova = rarityBudget(40, 5, r, "nova");
      const celestial = rarityBudget(40, 5, r, "celestial");
      expect(none).toBeLessThan(nova);
      expect(nova).toBeLessThan(celestial);
    }
  });

  it("Nova guarantees the Artisan line; Celestial also adds one secondary [PROVISIONAL]", () => {
    expect(ASCENSION_EXTRAS.none).toEqual({ guaranteedArtisan: false, extraSecondaries: 0 });
    expect(ASCENSION_EXTRAS.nova).toEqual({ guaranteedArtisan: true, extraSecondaries: 0 });
    expect(ASCENSION_EXTRAS.celestial).toEqual({ guaranteedArtisan: true, extraSecondaries: 1 });
    expect(ascendedProfile("luminous", "nova").artisanPermille).toBe(1000);
    expect(ascendedProfile("luminous", "celestial").secondaries).toBe(RARITY_PROFILES.luminous.secondaries + 1);
  });

  it("an ascension on a band that cannot carry it changes NOTHING (the same profile object, the same piece)", () => {
    for (const r of ["derelict", "standard", "augmented", "stellar", "radiant"] as EquipmentRarity[]) {
      for (const a of ASCENDED) {
        expect(ascendedProfile(r, a), `${r} ${a}`).toBe(RARITY_PROFILES[r]);
        const plain = cargo(r, "none");
        const stray = cargo(r, a);
        expect({ ...stray, ascension: "none" }).toEqual(plain);
        expect(rarityBudget(40, 5, r, a)).toBe(rarityBudget(40, 5, r));
      }
    }
    // and "none" on a legendary is the legendary row itself
    expect(ascendedProfile("luminous", "none")).toBe(RARITY_PROFILES.luminous);
  });

  it("a Nova or Celestial mint is stronger than the plain legendary on the same stream", () => {
    for (let seed = 1; seed < 40; seed++) {
      const lum = cargo("luminous", "none", "e", seed);
      const nova = cargo("luminous", "nova", "e", seed);
      const cel = cargo("luminous", "celestial", "e", seed);
      expect(nova.implicitStats.cargoCapacity).toBeGreaterThan(lum.implicitStats.cargoCapacity);
      expect(cel.implicitStats.cargoCapacity).toBeGreaterThan(nova.implicitStats.cargoCapacity);
      const w = generateWeapon({ weaponType: "autocannon", blueprintKey: null, iLevel: 40, quality: 5, rarity: "constellar", ascension: "celestial", rng: lcg(seed), allocateId: () => "w" });
      const wPlain = generateWeapon({ weaponType: "autocannon", blueprintKey: null, iLevel: 40, quality: 5, rarity: "constellar", ascension: "none", rng: lcg(seed), allocateId: () => "w" });
      const sum = (p: EquipmentInstance) => Object.values(p.rolledStats).reduce((a, b) => a + b, 0);
      expect(sum(w)).toBeGreaterThan(sum(wPlain));
    }
  });
});

const ASCENDED: EquipmentAscension[] = ["nova", "celestial"];

describe("RR-4: labels and order", () => {
  it("labels follow the design's naming registry, and a non-ascended piece keeps its band label", () => {
    expect(ascensionLabel("luminous", "nova")).toBe("Nova Luminous");
    expect(ascensionLabel("constellar", "celestial")).toBe("Celestial Constellar");
    expect(ascensionLabel("luminous", "none")).toBe("Luminous");
    expect(ascensionLabel("radiant", "nova")).toBe("Radiant"); // not allowed: ignored
    for (const r of EQUIPMENT_RARITY_LADDER) expect(ascensionLabel(r, "none")).toBe(r.charAt(0).toUpperCase() + r.slice(1));
  });

  it("the reveal sort puts Celestial above Nova above none within a band, and ignores a stray ascension", () => {
    expect([ascensionOrder("luminous", "none"), ascensionOrder("luminous", "nova"), ascensionOrder("luminous", "celestial")]).toEqual([0, 1, 2]);
    expect(ascensionOrder("radiant", "celestial")).toBe(0);
    const ids = sortRolledPieces([cargo("luminous", "none", "a", 1, 3), cargo("luminous", "celestial", "c", 1, 3), cargo("luminous", "nova", "b", 1, 3), cargo("radiant", "none", "r", 1, 5)]).map((p) => p.id);
    expect(ids).toEqual(["c", "b", "a", "r"]);
  });

  it("auto-salvage keep-best prefers the higher ascension after level, quality and band", () => {
    const plain = cargo("luminous", "none", "equip-1");
    const nova = cargo("luminous", "nova", "equip-2");
    expect(autoSalvageIsBetter(nova, plain)).toBe(true);
    expect(autoSalvageIsBetter(plain, nova)).toBe(false);
    // a stray ascension on a Radiant falls through to the id tie-break as before
    const r1 = cargo("radiant", "celestial", "equip-1");
    const r2 = cargo("radiant", "none", "equip-2");
    expect(autoSalvageIsBetter(r1, r2)).toBe(true); // id equip-1 < equip-2
    expect(autoSalvageIsBetter(r2, r1)).toBe(false);
  });
});

describe("RR-4: the wiring registry carries one live, probed row per ascension", () => {
  it("adds the three ASCENSION_BUDGET_MULT entries (none is the reference)", async () => {
    const { WIRING_REGISTRY } = await import("./wiring/registry");
    const { RR_ADDED_ENTRY_IDS } = await import("./rarityRegistry.fixture");
    const rows = WIRING_REGISTRY.filter((e) => RR_ADDED_ENTRY_IDS.has(e.id) && e.source.catalog === "ASCENSION_BUDGET_MULT");
    expect(rows.map((e) => `${e.id}|${e.status.kind}|${e.probe}|${e.contexts.join(",")}`)).toEqual([
      "ship:ASCENSION_BUDGET_MULT:none|live|sheetCargo|",
      "ship:ASCENSION_BUDGET_MULT:nova|live|sheetCargo|sheet",
      "ship:ASCENSION_BUDGET_MULT:celestial|live|sheetCargo|sheet",
    ]);
  });
});

describe("RR-4: a Celestial piece is never auto-salvaged (manual salvage stays allowed) [PROPOSAL]", () => {
  it("the celestial protection reason covers exactly the valid Celestial pieces", () => {
    const s = { ...freshState(), salvageConfirmQualities: [] as number[] }; // no tier asks first, so only the reason under test applies
    const ctx = autoSalvageProtectionContext(s);
    const reason = (p: EquipmentInstance) => autoSalvageProtection(ctx, autoSalvageSubjectForPiece(p));
    expect(reason(cargo("constellar", "celestial", "equip-501", 7, 1))).toBe("celestial");
    expect(reason(cargo("luminous", "celestial", "equip-502", 7, 1))).toBe("celestial");
    expect(reason(cargo("luminous", "nova", "equip-503", 7, 1))).not.toBe("celestial");
    expect(reason(cargo("radiant", "celestial", "equip-504", 7, 1))).not.toBe("celestial"); // a stray ascension is not Celestial
  });
});
