// RARITY READINESS review fixes for RR-3 / RR-4 (docs/plans/2026-10-23-rarity-readiness-plan.md carry notes):
//   1. secondaries and Artisan never land on a line the piece cannot use (a mass / draw reduction the slot's base cannot
//      absorb), and draw by the pool's weights x the variety's statRatios (integer weights on the extras stream);
//   2. the legendary step and the ascension reach module-effect gear (bridge, quarters, sensor, universal modules)
//      through moduleEffectScale, with every live band bit-identical;
//   3. the generator applies the extras EXACTLY as rollRarityExtras computes them (pinned here, so the registry rows can
//      measure the budget exactly on the signature line).

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import {
  EQUIPMENT_ASCENSIONS,
  EQUIPMENT_RARITY_LADDER,
  EQUIPMENT_SLOTS,
  MODULE_QUALITY_STEP,
  MODULE_RARITY_STEP,
  SLOT_BASE_PHYSICALS,
  moduleEffectScale,
  rarityIndex,
  type EquipmentAscension,
  type EquipmentRarity,
} from "./model";
import { LEGENDARY_BUDGET_STEP, RARITY_PROFILES, SECONDARY_BUDGET_SHARE } from "./rarityProfiles";
import { ASCENSION_BUDGET_MULT, ascendedProfile, effectiveAscension } from "./ascension";
import { WEAPON_AFFIX_POOL, budgetAtMult, budgetShares, generateEquipment, generateWeapon, rarityBudget, rollRarityExtras } from "./itemgen";

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

const EXTRAS_ONLY = { ...RARITY_PROFILES.luminous, artisanPermille: 0, legendaryAffix: false };

describe("fix 1: secondaries and Artisan land on lines the piece can use", () => {
  it("never add a mass or draw reduction the slot's base cannot absorb", () => {
    const pool = [
      { stat: "massReduction", weight: 5 },
      { stat: "powerDrawReduction", weight: 5 },
      { stat: "crewEfficiency", weight: 1 },
    ];
    for (let seed = 1; seed < 400; seed++) {
      const lines: Record<string, number> = {};
      rollRarityExtras(EXTRAS_ONLY, 400, pool, [], lines, lcg(seed).rng, { baseMass: 0, baseDraw: 1 });
      expect(lines.massReduction, String(seed)).toBeUndefined();
      expect(lines.powerDrawReduction, String(seed)).toBeUndefined();
      expect(lines.crewEfficiency).toBe(2 * Math.round(400 * SECONDARY_BUDGET_SHARE));
    }
    // a base that can absorb it still takes it
    let took = 0;
    for (let seed = 1; seed < 200; seed++) {
      const lines: Record<string, number> = {};
      rollRarityExtras(EXTRAS_ONLY, 40, pool, [], lines, lcg(seed).rng, { baseMass: 1000, baseDraw: 1000 });
      if (lines.massReduction !== undefined || lines.powerDrawReduction !== undefined) took++;
    }
    expect(took).toBeGreaterThan(100);
  });

  it("Artisan never multiplies a reduction line past what the base can absorb", () => {
    for (let seed = 1; seed < 300; seed++) {
      const lines: Record<string, number> = { massReduction: 8, crewEfficiency: 10 };
      rollRarityExtras({ ...EXTRAS_ONLY, secondaries: 0, artisanPermille: 1000 }, 400, [{ stat: "crewEfficiency", weight: 1 }], ["massReduction", "crewEfficiency"], lines, lcg(seed).rng, { baseMass: 8, baseDraw: 0 });
      expect(lines.massReduction).toBe(8);
      expect(lines.crewEfficiency).toBe(Math.round(10 * 1.25));
    }
  });

  it("secondaries draw by pool weight x variety statRatios", () => {
    const pool = [
      { stat: "a", weight: 9 },
      { stat: "b", weight: 1 },
    ];
    const share = (ratios: Record<string, number> | undefined): number => {
      let a = 0;
      const N = 3000;
      for (let seed = 1; seed <= N; seed++) {
        const lines: Record<string, number> = {};
        rollRarityExtras({ ...EXTRAS_ONLY, secondaries: 1 }, 100, pool, [], lines, lcg(seed).rng, { statRatios: ratios });
        if (lines.a !== undefined) a++;
      }
      return a / N;
    };
    expect(share(undefined)).toBeGreaterThan(0.86);
    expect(share(undefined)).toBeLessThan(0.94);
    expect(share({ a: 1, b: 9 })).toBeGreaterThan(0.45);
    expect(share({ a: 1, b: 9 })).toBeLessThan(0.55);
    // WR-7 (OC-D6 "Unlisted = never rolls"): a stat the ratios do not list is never a secondary.
    expect(share({ b: 9 })).toBe(0);
  });

  it("over 2000 Luminous bridge, sensor and reactor mints every secondary lands on a line the piece keeps", () => {
    for (const slot of ["bridge", "sensor", "reactorCore"]) {
      for (let seed = 1; seed <= 2000; seed += 7) {
        const p = generateEquipment({ slotType: slot as "bridge", varietyKey: EQUIPMENT_SLOTS[slot].varieties[seed % EQUIPMENT_SLOTS[slot].varieties.length].key, blueprintKey: null, iLevel: 40, quality: 5, rarity: "luminous", ascension: "none", rng: lcg(seed).rng, allocateId: () => "e" });
        const base = SLOT_BASE_PHYSICALS[slot as keyof typeof SLOT_BASE_PHYSICALS];
        // nothing was thrown away on the floor of mass / draw
        expect(p.mass).toBeGreaterThanOrEqual(0);
        if (base.mass === 0) expect(p.mass).toBe(0);
        const kept = Object.values(p.rolledStats).reduce((x, y) => x + y, 0);
        expect(kept, `${slot} ${seed}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("fix 2: the legendary step and the ascension reach module-effect gear", () => {
  it("every live band reads the pre-fix scale bit for bit (with or without an ascension)", () => {
    for (const r of ["derelict", "standard", "augmented", "stellar", "radiant"] as EquipmentRarity[]) {
      const step = Math.max(0, rarityIndex(r) - rarityIndex("standard"));
      for (let q = 0; q <= 5; q++) {
        const before = (1 + step * MODULE_RARITY_STEP) * (1 + q * MODULE_QUALITY_STEP);
        for (const a of EQUIPMENT_ASCENSIONS) expect(Object.is(moduleEffectScale(r, q, a), before), `${r} q${q} ${a}`).toBe(true);
        expect(Object.is(moduleEffectScale(r, q), before)).toBe(true);
      }
    }
  });

  it("a Luminous or Constellar module is Radiant x the legendary step, and Nova / Celestial multiply it", () => {
    for (const r of ["luminous", "constellar"] as EquipmentRarity[]) {
      for (const a of EQUIPMENT_ASCENSIONS as readonly EquipmentAscension[]) {
        const expected = moduleEffectScale("radiant", 3) * LEGENDARY_BUDGET_STEP * ASCENSION_BUDGET_MULT[effectiveAscension(r, a)];
        expect(moduleEffectScale(r, 3, a)).toBeCloseTo(expected, 12);
      }
    }
    expect(moduleEffectScale("luminous", 0) / moduleEffectScale("radiant", 0)).toBeCloseTo(LEGENDARY_BUDGET_STEP, 12);
    expect(moduleEffectScale("luminous", 0, "celestial")).toBeGreaterThan(moduleEffectScale("luminous", 0, "nova"));
  });

  it("every call site passes the piece's ascension", () => {
    // Every non-test source file under src (review of RR-5: a hardcoded list would miss a call in a new file, which would
    // silently read x1). A call passes the piece's ascension, or the literal "none" where no piece exists (a reference
    // scale, as the wiring registry's catalog magnitudes use).
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = `${dir}/${name}`;
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|svelte)$/.test(name) && !/\.(test|testkit)\.ts$|\.d\.ts$|\.fixture\.ts$/.test(name)) files.push(p);
      }
    };
    walk("src");
    expect(files.length).toBeGreaterThan(100);
    let calls = 0;
    for (const f of files) {
      const text = readFileSync(f, "utf8").replace(/\/\/.*$/gm, "");
      for (const m of text.matchAll(/moduleEffectScale\(([^)]*)\)/g)) {
        const args = m[1].split(",").map((s) => s.trim());
        if (f.endsWith("model.ts") && args[0] === "rarity: EquipmentRarity") continue; // the declaration
        calls++;
        expect(args.length, `${f}: moduleEffectScale(${m[1]})`).toBe(3);
        expect(args[2], `${f}: moduleEffectScale(${m[1]})`).toMatch(/ascension|^"none"$/);
      }
    }
    expect(calls).toBeGreaterThanOrEqual(9);
  });
});

describe("fix 3: the generator applies the extras exactly", () => {
  it("a Luminous or Constellar weapon's lines are its affix picks plus exactly rollRarityExtras on the next draw", () => {
    for (const rarity of ["luminous", "constellar"] as EquipmentRarity[]) {
      for (const ascension of EQUIPMENT_ASCENSIONS) {
        for (let seed = 1; seed < 40; seed++) {
          const w = generateWeapon({ weaponType: "autocannon", blueprintKey: null, iLevel: 40, quality: 5, rarity, ascension, rng: lcg(seed).rng, allocateId: () => "w" });
          // Rebuild: the weapon pool holds 2 stats, so the picks take 2 draws and leave both lines at an even share.
          const c = lcg(seed);
          c.rng();
          c.rng();
          const budget = rarityBudget(40, 5, rarity, ascension);
          const each = Math.round(budgetShares(budget).affixShare / 2);
          const expected: Record<string, number> = { weaponYield: each, weaponAccuracy: each };
          // the pick ORDER decides the Artisan line order, so read it off a plain Radiant mint on the same stream
          const order = Object.keys(generateWeapon({ weaponType: "autocannon", blueprintKey: null, iLevel: 40, quality: 5, rarity: "radiant", ascension: "none", rng: lcg(seed).rng, allocateId: () => "w" }).rolledStats);
          const lines: Record<string, number> = Object.fromEntries(order.map((k) => [k, expected[k]]));
          const id = rollRarityExtras(ascendedProfile(rarity, ascension), budget, WEAPON_AFFIX_POOL, order, lines, c.rng, { slotType: "weapon" });
          expect(w.rolledStats, `${rarity} ${ascension} ${seed}`).toEqual(lines);
          expect(w.legendaryAffixId).toBe(id);
        }
      }
    }
  });

  it("computeBudget is the index form for live bands only (the mint reads the profile)", () => {
    for (const r of ["standard", "augmented", "stellar", "radiant"] as EquipmentRarity[]) expect(rarityBudget(40, 5, r)).toBe(budgetAtMult(40, 5, RARITY_PROFILES[r].budgetMult));
    expect(EQUIPMENT_RARITY_LADDER.length).toBe(7);
  });
});

