// RARITY READINESS RR-3 (docs/plans/2026-10-23-rarity-readiness-plan.md, Review Focus 3): the per-rarity profile table.
// The live rows (Derelict to Radiant) reproduce the pre-RR-3 numbers EXACTLY (answer 5); only Luminous and Constellar
// gain the +20% legendary step, secondaries and Artisan (answers 5 and 6), drawn AFTER the affix picks so the shared
// stream of every live band is untouched.

import { describe, expect, it } from "vitest";
import { EQUIPMENT_RARITY_LADDER, EQUIPMENT_SLOTS, rarityIndex, type EquipmentRarity } from "./model";
import {
  ARTISAN_CHANCE_PERMILLE,
  ARTISAN_LINE_MULT,
  LEGENDARY_BUDGET_STEP,
  RARITY_MULT,
  RARITY_PROFILES,
  SECONDARY_BUDGET_SHARE,
  rarityProfile,
} from "./rarityProfiles";
import { affixCount, computeBudget, generateEquipment, generateWeapon, rarityBudget, rollRarityExtras } from "./itemgen";

const LIVE: EquipmentRarity[] = ["derelict", "standard", "augmented", "stellar", "radiant"];

function lcg(seed: number): { rng: () => number; draws: () => number } {
  let s = seed >>> 0;
  let n = 0;
  return {
    rng: () => {
      n++;
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    },
    draws: () => n,
  };
}

describe("RR-3: the live rows are today's numbers", () => {
  it("budgetMult is exactly RARITY_MULT ** rarityIndex, with zero secondaries and no Artisan", () => {
    for (const r of LIVE) {
      expect(Object.is(RARITY_PROFILES[r].budgetMult, RARITY_MULT ** rarityIndex(r)), r).toBe(true);
      expect(RARITY_PROFILES[r].secondaries, r).toBe(0);
      expect(RARITY_PROFILES[r].artisanPermille, r).toBe(0);
    }
  });

  it("the affix counts and the extra chance match the pre-RR-3 switch (Derelict 0, Standard 2, Augmented 2 + 25%, Stellar and Radiant 3)", () => {
    expect(LIVE.map((r) => [RARITY_PROFILES[r].affixes, RARITY_PROFILES[r].extraAffixChance])).toEqual([
      [0, 0],
      [2, 0],
      [2, 0.25],
      [3, 0],
      [3, 0],
    ]);
    // affixCount reads the table: Augmented draws once and gets 3 below 0.25, every other band draws nothing.
    let draws = 0;
    expect(affixCount("augmented", () => (draws++, 0.2499))).toBe(3);
    expect(affixCount("augmented", () => (draws++, 0.25))).toBe(2);
    expect(draws).toBe(2);
    for (const r of ["derelict", "standard", "stellar", "radiant", "luminous", "constellar"] as EquipmentRarity[]) {
      let d = 0;
      affixCount(r, () => (d++, 0));
      expect(d, r).toBe(0);
    }
  });

  it("rarityBudget equals the old index budget for every live band, level and quality", () => {
    for (const r of LIVE) {
      for (const iLevel of [0, 1, 7, 20, 40, 400]) {
        for (let q = 0; q <= 5; q++) expect(rarityBudget(iLevel, q, r), `${r} ${iLevel} ${q}`).toBe(computeBudget(iLevel, q, rarityIndex(r)));
      }
    }
  });
});

describe("RR-3: the legendary rows", () => {
  it("Luminous and Constellar start at Radiant x LEGENDARY_BUDGET_STEP (the design's +20%)", () => {
    expect(LEGENDARY_BUDGET_STEP).toBe(1.2);
    for (const r of ["luminous", "constellar"] as EquipmentRarity[]) {
      expect(RARITY_PROFILES[r].budgetMult).toBeCloseTo(RARITY_PROFILES.radiant.budgetMult * 1.2, 12);
      expect(RARITY_PROFILES[r].affixes).toBe(3);
      expect(RARITY_PROFILES[r].artisanPermille).toBe(ARTISAN_CHANCE_PERMILLE);
    }
    expect(RARITY_PROFILES.luminous.secondaries).toBe(2);
    expect(RARITY_PROFILES.constellar.secondaries).toBe(1); // the second is replaced by the set bonus (design :164)
  });

  it("the budget never falls as the ladder climbs, and the two legendaries share one tier", () => {
    const b = EQUIPMENT_RARITY_LADDER.map((r) => rarityBudget(40, 5, r));
    for (let i = 1; i < b.length; i++) expect(b[i], EQUIPMENT_RARITY_LADDER[i]).toBeGreaterThanOrEqual(b[i - 1]);
    expect(rarityBudget(40, 5, "luminous")).toBe(rarityBudget(40, 5, "constellar"));
    expect(rarityBudget(40, 5, "luminous")).toBeGreaterThan(rarityBudget(40, 5, "radiant"));
  });

  it("an unknown band reads the Standard row", () => {
    expect(rarityProfile("mythic" as EquipmentRarity)).toBe(RARITY_PROFILES.standard);
    expect(rarityProfile("constructor" as EquipmentRarity)).toBe(RARITY_PROFILES.standard);
  });
});

describe("RR-3: secondaries and Artisan (the private extras stream)", () => {
  const pool = [
    { stat: "a", weight: 1 },
    { stat: "b", weight: 1 },
    { stat: "groundCarryCapacity", weight: 1 },
  ];

  it("a live band takes NO draw and changes nothing", () => {
    for (const r of LIVE) {
      const lines = { a: 10 };
      let d = 0;
      rollRarityExtras(RARITY_PROFILES[r], 100, pool, ["a"], lines, () => (d++, 0.5));
      expect(d, r).toBe(0);
      expect(lines).toEqual({ a: 10 });
    }
  });

  it("a legendary takes exactly ONE shared draw and adds its secondaries, never on a carry line", () => {
    for (let seed = 1; seed < 400; seed++) {
      const c = lcg(seed);
      const lines: Record<string, number> = { a: 10 };
      rollRarityExtras(RARITY_PROFILES.luminous, 100, pool, ["a"], lines, c.rng);
      expect(c.draws()).toBe(1);
      expect(lines.groundCarryCapacity).toBeUndefined();
      const each = Math.round(100 * SECONDARY_BUDGET_SHARE);
      const total = (lines.a ?? 0) + (lines.b ?? 0);
      // 2 secondaries; Artisan (when it fires) multiplied the affix line "a" BEFORE they landed.
      expect([10 + 2 * each, Math.round(10 * ARTISAN_LINE_MULT) + 2 * each]).toContain(total);
    }
  });

  it("Artisan fires at its configured rate (one affix line x ARTISAN_LINE_MULT)", () => {
    let fired = 0;
    const N = 4000;
    for (let seed = 1; seed <= N; seed++) {
      const lines: Record<string, number> = { a: 100 };
      rollRarityExtras({ ...RARITY_PROFILES.luminous, secondaries: 0 }, 100, pool, ["a"], lines, lcg(seed).rng);
      if (lines.a === Math.round(100 * ARTISAN_LINE_MULT)) fired++;
      else expect(lines.a).toBe(100);
    }
    expect(fired / N).toBeGreaterThan(ARTISAN_CHANCE_PERMILLE / 1000 - 0.03);
    expect(fired / N).toBeLessThan(ARTISAN_CHANCE_PERMILLE / 1000 + 0.03);
  });

  it("a Luminous mint keeps the Radiant affix picks and adds power on top (one extra draw)", () => {
    for (let seed = 1; seed < 60; seed++) {
      const mint = (rarity: EquipmentRarity) => {
        const c = lcg(seed);
        const p = generateEquipment({
          slotType: "cargoBay",
          varietyKey: EQUIPMENT_SLOTS.cargoBay.varieties[1].key,
          blueprintKey: null,
          iLevel: 40,
          quality: 5,
          rarity,
          ascension: "none",
          rng: c.rng,
          allocateId: () => "e",
        });
        return { p, draws: c.draws() };
      };
      const rad = mint("radiant");
      const lum = mint("luminous");
      expect(lum.draws).toBe(rad.draws + 1);
      for (const k of Object.keys(rad.p.rolledStats)) expect(lum.p.rolledStats[k], k).toBeGreaterThan(rad.p.rolledStats[k]);
      expect(lum.p.implicitStats.cargoCapacity).toBeGreaterThan(rad.p.implicitStats.cargoCapacity);
    }
  });

  it("a Constellar weapon rolls exactly one secondary's worth on top of its affixes when Artisan does not fire", () => {
    let checked = 0;
    for (let seed = 1; seed < 200; seed++) {
      const w = generateWeapon({ weaponType: "autocannon", blueprintKey: null, iLevel: 40, quality: 5, rarity: "constellar", ascension: "none", rng: lcg(seed).rng, allocateId: () => "e" });
      const budget = rarityBudget(40, 5, "constellar");
      const affixEach = Math.round((budget - 0.5 * budget) / 2);
      const total = Object.values(w.rolledStats).reduce((a, b) => a + b, 0);
      const plain = affixEach * 2 + Math.round(budget * SECONDARY_BUDGET_SHARE);
      if (total === plain) checked++;
      else expect(total).toBeGreaterThan(plain);
    }
    expect(checked).toBeGreaterThan(100);
  });
});

describe("RR-3: the wiring registry carries one live, probed row per profile", () => {
  it("adds exactly the seven RARITY_PROFILES entries (held apart from the older registry snapshot pins)", async () => {
    const { WIRING_REGISTRY } = await import("./wiring/registry");
    const { RR_ADDED_ENTRY_IDS } = await import("./rarityRegistry.fixture");
    const rows = WIRING_REGISTRY.filter((e) => RR_ADDED_ENTRY_IDS.has(e.id) && e.source.catalog === "RARITY_PROFILES");
    expect(rows.map((e) => `${e.id}|${e.status.kind}|${e.probe}|${e.contexts.join(",")}`)).toEqual(
      EQUIPMENT_RARITY_LADDER.map((r) => `ship:RARITY_PROFILES:${r}|live|sheetCargo|${r === "standard" ? "" : "sheet"}`),
    );
    expect(rows.find((e) => e.id === "ship:RARITY_PROFILES:standard")!.notApplicable).toBeTruthy();
  });
});
