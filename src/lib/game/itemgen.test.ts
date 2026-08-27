// ============================================================================
// Equipment 0.11.0 (Phase 2, plan Tasks 4-7): item-generation engine tests.
//
// itemgen.ts is a PURE module: every function is deterministic given its inputs
// and an INJECTED rng (() => number in [0,1)). These tests lock that contract:
//   - computeItemLevel: additive, clamped by the tier cap (Task 4).
//   - computeBudget: the worked budget formula + monotonicity (Task 5).
//   - affixCount / rollDistinctAffixStats / budgetShares: rng-driven rolls that
//     are REPRODUCIBLE under a fixed rng stream, respect the affix weights over
//     many draws, never duplicate a stat, and fully allocate the budget (Task 6).
//   - generateEquipment: assembly into a well-formed EquipmentInstance, with the
//     massReduction/powerDrawReduction fold and quality-scaled durability (Task 7).
//
// Determinism is tested two ways: an ARRAY-backed stub rng (seqRng) for exact,
// hand-verifiable draw sequences, and a seeded LCG (mulberry32) for the
// statistical-weighting checks that need a long, well-distributed stream. Neither
// is created by itemgen itself; the module only ever calls the rng passed in.
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  EQUIPMENT_SLOTS,
  rarityIndex,
  // Combat-defense rework (Unit 4): the FLAT, hull-independent Standard-Issue defensive floor
  // that the first crafted tier must clear (crafted plating > SI iff hullStrength > SI_PLATING_HP,
  // crafted emitter > SI iff shieldCapacity > SI_EMITTER_CAP).
  SI_PLATING_HP,
  SI_EMITTER_CAP,
  SI_EMITTER_RECHARGE,
  type EquipmentVarietyDef,
} from "./model";
import {
  PER_LEVEL_BUDGET,
  QUALITY_MULT,
  RARITY_MULT,
  IMPLICIT_BUDGET_SHARE,
  QUALITY_DURABILITY_BONUS,
  SLOT_BASE_PHYSICALS,
  computeItemLevel,
  computeBudget,
  affixCount,
  rollDistinctAffixStats,
  budgetShares,
  generateEquipment,
  generateWeapon,
  generateDronePod,
  DRONE_POD_BASE_POWER_DRAW,
  DRONE_POD_BASE_DURABILITY,
} from "./itemgen";
import { WEAPON_DEFS } from "./combat/weapons";

// --- Deterministic rng helpers (test-local; NOT part of itemgen) --------------

// Exact-control stub: replays a fixed array of draws, wrapping if exhausted. Lets
// a test assert "this precise rng sequence yields this precise pick" without any
// PRNG math in the way.
function seqRng(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

// mulberry32: a tiny, well-distributed seeded PRNG. Used ONLY where a test needs a
// long stream (the statistical-weighting checks). Deterministic per seed, so the
// suite stays reproducible.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// An incrementing id source, the test analog of GameState's nextEquipmentId.
function idAllocator(): () => string {
  let n = 0;
  return () => `equip-test-${++n}`;
}

// A neutral variety (no statRatios bias): weights fall through to the raw affix
// pool weights, so a weighting test reads the pool table directly.
function neutralVariety(): EquipmentVarietyDef {
  return { key: "neutral", label: "Neutral", statRatios: {} };
}

// ============================================================================
// Task 4: computeItemLevel
// ============================================================================
describe("computeItemLevel", () => {
  it("sums the additive inputs when below the tier cap", () => {
    const lvl = computeItemLevel({ craftingLevel: 10, achievementBoost: 3, faTalentBonus: 2, itemTierCap: 100 });
    expect(lvl).toBe(15);
  });

  it("returns exactly the sum when it equals the cap", () => {
    const lvl = computeItemLevel({ craftingLevel: 40, achievementBoost: 5, faTalentBonus: 5, itemTierCap: 50 });
    expect(lvl).toBe(50);
  });

  it("clamps to the tier cap when the sum exceeds it", () => {
    const lvl = computeItemLevel({ craftingLevel: 90, achievementBoost: 20, faTalentBonus: 20, itemTierCap: 60 });
    expect(lvl).toBe(60);
  });

  it("treats each boost additively (each extra point raises the level by one, below cap)", () => {
    const base = computeItemLevel({ craftingLevel: 10, achievementBoost: 0, faTalentBonus: 0, itemTierCap: 100 });
    const withAch = computeItemLevel({ craftingLevel: 10, achievementBoost: 4, faTalentBonus: 0, itemTierCap: 100 });
    const withBoth = computeItemLevel({ craftingLevel: 10, achievementBoost: 4, faTalentBonus: 3, itemTierCap: 100 });
    expect(withAch - base).toBe(4);
    expect(withBoth - withAch).toBe(3);
  });
});

// ============================================================================
// Task 5: computeBudget
// ============================================================================
describe("computeBudget", () => {
  it("matches the worked formula example", () => {
    // iLevel 10, quality 0, rarityIdx 1 (standard):
    // round(10 * 2 * 1.1^0 * 1.15^1) = round(23) = 23.
    expect(computeBudget(10, 0, 1)).toBe(23);
  });

  it("compounds quality and rarity multipliers", () => {
    // round(20 * 2 * 1.1^2 * 1.15^4) = round(20*2*1.21*1.74900625) = round(84.65...) = 85.
    const expected = Math.round(20 * PER_LEVEL_BUDGET * QUALITY_MULT ** 2 * RARITY_MULT ** 4);
    expect(computeBudget(20, 2, 4)).toBe(expected);
  });

  it("never lowers budget as quality rises (monotonic in quality)", () => {
    let prev = -Infinity;
    for (let q = 0; q <= 5; q++) {
      const b = computeBudget(30, q, 2);
      expect(b).toBeGreaterThanOrEqual(prev);
      prev = b;
    }
  });

  it("never lowers budget as rarity rises (monotonic in rarity)", () => {
    let prev = -Infinity;
    for (let r = 0; r <= 5; r++) {
      const b = computeBudget(30, 3, r);
      expect(b).toBeGreaterThanOrEqual(prev);
      prev = b;
    }
  });
});

// ============================================================================
// Task 6: affixCount
// ============================================================================
describe("affixCount", () => {
  it("derelict rolls zero affixes and consumes no rng draw", () => {
    let calls = 0;
    const rng = () => {
      calls++;
      return 0.5;
    };
    expect(affixCount("derelict", rng)).toBe(0);
    expect(calls).toBe(0);
  });

  it("standard rolls exactly two affixes, no rng draw", () => {
    let calls = 0;
    const rng = () => {
      calls++;
      return 0.5;
    };
    expect(affixCount("standard", rng)).toBe(2);
    expect(calls).toBe(0);
  });

  it("augmented consumes ONE rng draw and upgrades to three on a sub-25% roll", () => {
    // A single draw below 0.25 => the 3-affix upgrade fires.
    let calls = 0;
    const lucky = () => {
      calls++;
      return 0.1;
    };
    expect(affixCount("augmented", lucky)).toBe(3);
    expect(calls).toBe(1);

    // A draw at/above 0.25 => stays at two. Still exactly one draw consumed.
    calls = 0;
    const unlucky = () => {
      calls++;
      return 0.9;
    };
    expect(affixCount("augmented", unlucky)).toBe(2);
    expect(calls).toBe(1);
  });

  it("stellar and radiant roll three affixes, no rng draw", () => {
    const rng = () => 0.5;
    expect(affixCount("stellar", rng)).toBe(3);
    expect(affixCount("radiant", rng)).toBe(3);
  });

  it("treats the unproduced legendary flavors as radiant-count (never crashes)", () => {
    const rng = () => 0.5;
    expect(affixCount("luminous", rng)).toBe(3);
    expect(affixCount("constellar", rng)).toBe(3);
  });
});

// ============================================================================
// Task 6: rollDistinctAffixStats
// ============================================================================
describe("rollDistinctAffixStats", () => {
  const cargoPool = EQUIPMENT_SLOTS.cargoBay.affixPool;

  it("is reproducible: the same rng sequence yields identical picks", () => {
    const seq = [0.05, 0.6, 0.99, 0.4];
    const a = rollDistinctAffixStats(cargoPool, neutralVariety(), 3, seqRng(seq));
    const b = rollDistinctAffixStats(cargoPool, neutralVariety(), 3, seqRng(seq));
    expect(a).toEqual(b);
  });

  it("never repeats a stat on one item", () => {
    const picks = rollDistinctAffixStats(cargoPool, neutralVariety(), 4, mulberry32(7));
    expect(new Set(picks).size).toBe(picks.length);
  });

  it("returns only as many as the pool has when count exceeds pool size", () => {
    const tinyPool = [
      { stat: "cargoCapacity", weight: 3 },
      { stat: "massReduction", weight: 1 },
    ];
    const picks = rollDistinctAffixStats(tinyPool, neutralVariety(), 5, mulberry32(1));
    expect(picks.length).toBe(2);
    expect(new Set(picks).size).toBe(2);
  });

  it("returns an empty array for a zero count", () => {
    expect(rollDistinctAffixStats(cargoPool, neutralVariety(), 0, mulberry32(1))).toEqual([]);
  });

  it("consumes exactly one rng draw per pick (draw-count contract)", () => {
    // generateEquipment calls affixCount() and this picker on the SAME rng stream,
    // so the picker MUST advance the stream by exactly one draw per pick (no hidden
    // or skipped draws) or downstream reproducibility reasoning breaks.
    let calls = 0;
    const counting = () => {
      calls++;
      return 0.5;
    };
    // count 3 on the 4-stat cargo pool: 3 distinct picks => exactly 3 draws.
    rollDistinctAffixStats(cargoPool, neutralVariety(), 3, counting);
    expect(calls).toBe(3);
  });

  it("consumes zero rng draws for a zero count", () => {
    let calls = 0;
    const counting = () => {
      calls++;
      return 0.5;
    };
    rollDistinctAffixStats(cargoPool, neutralVariety(), 0, counting);
    expect(calls).toBe(0);
  });

  it("returns [] and consumes zero rng draws for an empty pool", () => {
    // Empty pool: the internal drawCount clamps to the pool size (0), so no picks
    // and no draws even when a positive count is requested. A future slot that ships
    // with no affixes must not advance the shared stream here.
    let calls = 0;
    const counting = () => {
      calls++;
      return 0.5;
    };
    const picks = rollDistinctAffixStats([], neutralVariety(), 1, counting);
    expect(picks).toEqual([]);
    expect(calls).toBe(0);
  });

  it("respects the affix weights over many single-pick draws (neutral variety)", () => {
    // cargoBay pool weights: cargoCapacity 5, massReduction 2, engineEfficiency 2,
    // extractionYieldMult 1 (total 10). With a neutral variety the pick frequency
    // should track those fractions.
    const N = 40000;
    const tally: Record<string, number> = {};
    const rng = mulberry32(123456);
    for (let i = 0; i < N; i++) {
      const [pick] = rollDistinctAffixStats(cargoPool, neutralVariety(), 1, rng);
      tally[pick] = (tally[pick] ?? 0) + 1;
    }
    expect(tally.cargoCapacity / N).toBeCloseTo(0.5, 1);
    expect(tally.massReduction / N).toBeCloseTo(0.2, 1);
    expect(tally.engineEfficiency / N).toBeCloseTo(0.2, 1);
    expect(tally.extractionYieldMult / N).toBeCloseTo(0.1, 1);
  });

  it("applies variety bias: a yieldRig leans single picks toward extractionYieldMult", () => {
    // specUtility pool: extractionYieldMult 5, sensors 2, materialQualityChance 2,
    // massReduction 1. yieldRig statRatios bias extractionYieldMult 0.75 (=> weight
    // 3.75), far above the rest, so it should be the single most-picked stat.
    const slot = EQUIPMENT_SLOTS.specUtility;
    const yieldRig = slot.varieties.find((v) => v.key === "yieldRig")!;
    const N = 20000;
    const tally: Record<string, number> = {};
    const rng = mulberry32(99);
    for (let i = 0; i < N; i++) {
      const [pick] = rollDistinctAffixStats(slot.affixPool, yieldRig, 1, rng);
      tally[pick] = (tally[pick] ?? 0) + 1;
    }
    const top = Object.entries(tally).sort((a, b) => b[1] - a[1])[0][0];
    expect(top).toBe("extractionYieldMult");
  });
});

// ============================================================================
// Task 6: budgetShares (the implicit/affix magnitude split)
// ============================================================================
describe("budgetShares", () => {
  it("splits the budget into implicit and affix shares that sum exactly to it", () => {
    const budget = 87;
    const { implicitShare, affixShare } = budgetShares(budget);
    expect(implicitShare).toBeCloseTo(IMPLICIT_BUDGET_SHARE * budget, 10);
    expect(implicitShare + affixShare).toBeCloseTo(budget, 10);
  });
});

// ============================================================================
// Task 7: generateEquipment
// ============================================================================
describe("generateEquipment", () => {
  it("produces a well-formed instance with the slot's implicit line always present", () => {
    const item = generateEquipment({
      slotType: "cargoBay",
      varietyKey: "balancedHold",
      blueprintKey: null,
      iLevel: 20,
      quality: 0,
      rarity: "standard",
      ascension: "none",
      rng: mulberry32(3),
      allocateId: idAllocator(),
    });
    // cargoBay's signature implicit is cargoCapacity, and it is always present.
    expect(item.implicitStats.cargoCapacity).toBeGreaterThan(0);
    expect(item.slotType).toBe("cargoBay");
    expect(item.blueprintKey).toBeNull();
    expect(item.fittedToShipId).toBeNull();
    expect(item.ascension).toBe("none");
    expect(item.durability).toBe(item.durabilityMax);
  });

  it("mints every craftable shield-emitter + hull-plating variety as a valid, non-empty piece (Combat 1.0 defense gear)", () => {
    // Regression for the shipped gap where shieldEmitters / hullPlating had no blueprints at all: prove
    // the fabricate mint path (generateEquipment) produces a well-formed, positively-statted piece for
    // EVERY defensive variety, so the 6 new blueprints actually craft usable gear (not a +0 dud).
    const defenseVarieties: { slotType: "shieldEmitters" | "hullPlating"; varietyKey: string }[] = [
      { slotType: "shieldEmitters", varietyKey: "balancedEmitter" },
      { slotType: "shieldEmitters", varietyKey: "rechargeArray" },
      { slotType: "shieldEmitters", varietyKey: "capacitorBank" },
      { slotType: "hullPlating", varietyKey: "reinforcedPlating" },
      { slotType: "hullPlating", varietyKey: "ablativePlating" },
      { slotType: "hullPlating", varietyKey: "compositePlating" },
    ];
    for (const { slotType, varietyKey } of defenseVarieties) {
      const item = generateEquipment({
        slotType, varietyKey, blueprintKey: `${varietyKey}Bp`,
        iLevel: 40, quality: 3, rarity: "radiant", ascension: "none",
        rng: mulberry32(11), allocateId: idAllocator(),
      });
      expect(item.slotType, `${varietyKey} slotType`).toBe(slotType);
      expect(item.durability, `${varietyKey} durability`).toBe(item.durabilityMax);
      // A crafted defensive piece carries real, positive stats (better than the +0 Standard-Issue floor).
      const total = [...Object.values(item.implicitStats), ...Object.values(item.rolledStats)].reduce((a, b) => a + b, 0);
      expect(total, `${varietyKey} has positive stats`).toBeGreaterThan(0);
    }
  });

  // ==========================================================================
  // Combat-defense rework (HYBRID model): the first crafted tier of each defensive slot
  // is ALWAYS a few points above the flat Standard-Issue floor, and it scales up.
  //
  // WHY this is the load-bearing guarantee: the rework made the SI defensive floor a FLAT,
  // hull-independent value per stat (SI_PLATING_HP = 100 additive hull floor, SI_EMITTER_CAP = 300,
  // SI_EMITTER_RECHARGE = 6, the shield references). The bridge ADDS the plating to the bare frame and
  // MULTIPLIES the emitter by the hull's shield effectiveness, so a crafted piece beats SI on EVERY hull
  // iff its RAW magnitude clears that flat floor. The user principle (design #3) is that crafting is NEVER
  // pointless: the lowest craftable roll must already beat SI. We assert the RELATIONSHIP (> SI floor, and
  // high > low), NOT magic magnitudes, so the 0.16.0 balance pass can re-dial the curves without churning this test.
  // ==========================================================================
  describe("crafted defensive gear always beats the flat Standard-Issue floor (Unit 4)", () => {
    // The LOWEST craftable roll: a tier-1 blueprint at the lowest crafting level clamps to
    // iLevel 1 (computeItemLevel floor), quality 0, and standard rarity (rollCraftedRarity's
    // floor). This is the weakest piece the game can ever mint for these slots.
    const LOWEST_ILEVEL = 1;

    it("the lowest-tier crafted shield emitter out-caps Standard-Issue and clears the recharge floor", () => {
      const emitter = generateEquipment({
        slotType: "shieldEmitters",
        varietyKey: "balancedEmitter", // the tier-1 workhorse variety
        blueprintKey: "balancedEmitterBp",
        iLevel: LOWEST_ILEVEL,
        quality: 0,
        rarity: "standard",
        ascension: "none",
        rng: mulberry32(1),
        allocateId: idAllocator(),
      });
      // Raw shieldCapacity beats the flat SI cap floor -> beats SI on ANY hull (effectiveness scales both).
      expect(emitter.implicitStats.shieldCapacity).toBeGreaterThan(SI_EMITTER_CAP);
      // Recharge is not "boosted" but must at least reach the SI recharge floor at first tier.
      expect(emitter.implicitStats.shieldRecharge).toBeGreaterThanOrEqual(SI_EMITTER_RECHARGE);
    });

    it("the lowest-tier crafted hull plating out-armors Standard-Issue", () => {
      const plating = generateEquipment({
        slotType: "hullPlating",
        varietyKey: "reinforcedPlating", // the tier-1 workhorse variety
        blueprintKey: "reinforcedPlatingBp",
        iLevel: LOWEST_ILEVEL,
        quality: 0,
        rarity: "standard",
        ascension: "none",
        rng: mulberry32(2),
        allocateId: idAllocator(),
      });
      // Raw hullStrength beats the flat SI plating floor -> beats SI on ANY hull (the bare frame is added to both).
      expect(plating.implicitStats.hullStrength).toBeGreaterThan(SI_PLATING_HP);
    });

    it("a high-iLevel q5/radiant defensive piece scales substantially above the lowest tier", () => {
      // Top reachable roll: tier-2 iLevel cap (EQUIPMENT_ILEVEL_CAP_PER_TIER * 2 = 40), quality 5, radiant.
      const HIGH_ILEVEL = 40;
      const highEmitter = generateEquipment({
        slotType: "shieldEmitters", varietyKey: "capacitorBank", blueprintKey: "capacitorBankBp",
        iLevel: HIGH_ILEVEL, quality: 5, rarity: "radiant", ascension: "none",
        rng: mulberry32(3), allocateId: idAllocator(),
      });
      const lowEmitter = generateEquipment({
        slotType: "shieldEmitters", varietyKey: "balancedEmitter", blueprintKey: "balancedEmitterBp",
        iLevel: LOWEST_ILEVEL, quality: 0, rarity: "standard", ascension: "none",
        rng: mulberry32(3), allocateId: idAllocator(),
      });
      const highPlating = generateEquipment({
        slotType: "hullPlating", varietyKey: "compositePlating", blueprintKey: "compositePlatingBp",
        iLevel: HIGH_ILEVEL, quality: 5, rarity: "radiant", ascension: "none",
        rng: mulberry32(4), allocateId: idAllocator(),
      });
      const lowPlating = generateEquipment({
        slotType: "hullPlating", varietyKey: "reinforcedPlating", blueprintKey: "reinforcedPlatingBp",
        iLevel: LOWEST_ILEVEL, quality: 0, rarity: "standard", ascension: "none",
        rng: mulberry32(4), allocateId: idAllocator(),
      });
      // Scaling works: the high roll is meaningfully bigger than the floor roll (relationship, not a magic number).
      expect(highEmitter.implicitStats.shieldCapacity).toBeGreaterThan(lowEmitter.implicitStats.shieldCapacity);
      expect(highPlating.implicitStats.hullStrength).toBeGreaterThan(lowPlating.implicitStats.hullStrength);
      // And it comfortably clears the flat SI floor (at least ~2x it), so high-tier gear is a real upgrade.
      expect(highEmitter.implicitStats.shieldCapacity).toBeGreaterThan(SI_EMITTER_CAP * 2);
      expect(highPlating.implicitStats.hullStrength).toBeGreaterThan(SI_PLATING_HP * 2);
    });
  });

  it("stores the input iLevel on the instance (persisted so the UI can show item power at a glance)", () => {
    // iLevel was previously consumed by computeBudget then DISCARDED. It is now stored on the
    // instance verbatim so the Ship Systems tiles / tooltip can render "iL N" without recomputing.
    const item = generateEquipment({
      slotType: "reactorCore",
      varietyKey: "highOutputCore",
      blueprintKey: "bp-x",
      iLevel: 84,
      quality: 3,
      rarity: "radiant",
      ascension: "none",
      rng: mulberry32(7),
      allocateId: idAllocator(),
    });
    expect(item.iLevel).toBe(84);
  });

  it("a Radiant/quality-5 cargoBay carries a larger implicit than a Standard/quality-0 one", () => {
    const common = {
      slotType: "cargoBay" as const,
      varietyKey: "balancedHold",
      blueprintKey: null,
      iLevel: 30,
      ascension: "none" as const,
      rng: () => 0.5,
      allocateId: idAllocator(),
    };
    const weak = generateEquipment({ ...common, quality: 0, rarity: "standard" });
    const strong = generateEquipment({ ...common, quality: 5, rarity: "radiant" });
    expect(strong.implicitStats.cargoCapacity).toBeGreaterThan(weak.implicitStats.cargoCapacity);
  });

  it("is reproducible: the same rng seed yields identical stat lines and physicals", () => {
    const build = () =>
      generateEquipment({
        slotType: "reactorCore",
        varietyKey: "balancedCore",
        blueprintKey: "bp-x",
        iLevel: 25,
        quality: 2,
        rarity: "radiant",
        ascension: "none",
        rng: mulberry32(555),
        allocateId: idAllocator(),
      });
    const a = build();
    const b = build();
    expect(a.implicitStats).toEqual(b.implicitStats);
    expect(a.rolledStats).toEqual(b.rolledStats);
    expect(a.mass).toBe(b.mass);
    expect(a.powerDraw).toBe(b.powerDraw);
    expect(a.durabilityMax).toBe(b.durabilityMax);
  });

  it("mints a unique id per call via the injected allocateId", () => {
    const alloc = idAllocator();
    const ids = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const item = generateEquipment({
        slotType: "cargoBay",
        varietyKey: "haulerHold",
        blueprintKey: null,
        iLevel: 10,
        quality: 0,
        rarity: "standard",
        ascension: "none",
        rng: mulberry32(i + 1),
        allocateId: alloc,
      });
      ids.add(item.id);
    }
    expect(ids.size).toBe(5);
  });

  it("derelict yields no rolled affixes, only the implicit line", () => {
    const item = generateEquipment({
      slotType: "cargoBay",
      varietyKey: "balancedHold",
      blueprintKey: null,
      iLevel: 20,
      quality: 0,
      rarity: "derelict",
      ascension: "none",
      rng: mulberry32(2),
      allocateId: idAllocator(),
    });
    expect(Object.keys(item.rolledStats).length).toBe(0);
    expect(item.implicitStats.cargoCapacity).toBeGreaterThan(0);
  });

  it("scales durabilityMax by quality (round(base * (1 + quality * bonus)))", () => {
    const base = SLOT_BASE_PHYSICALS.cargoBay.durability;
    const item = generateEquipment({
      slotType: "cargoBay",
      varietyKey: "balancedHold",
      blueprintKey: null,
      iLevel: 20,
      quality: 3,
      rarity: "standard",
      ascension: "none",
      rng: mulberry32(4),
      allocateId: idAllocator(),
    });
    expect(item.durabilityMax).toBe(Math.round(base * (1 + 3 * QUALITY_DURABILITY_BONUS)));
  });

  it("folds a rolled massReduction into mass and removes it as a separate stat line", () => {
    // cargoBay radiant picks 3 of 4 affixes; massReduction is included on most
    // seeds. We scan deterministically for the first seed that rolled it, then
    // assert the fold: mass dropped by the affix magnitude and no massReduction
    // stat line survives.
    const iLevel = 40;
    const quality = 0;
    const rarity = "radiant" as const;
    const budget = computeBudget(iLevel, quality, rarityIndex(rarity));
    const { affixShare } = budgetShares(budget);
    const affixEach = Math.round(affixShare / 3); // radiant => 3 affix lines, equal split
    const baseMass = SLOT_BASE_PHYSICALS.cargoBay.mass;

    let found = false;
    for (let seed = 1; seed <= 200 && !found; seed++) {
      const item = generateEquipment({
        slotType: "cargoBay",
        varietyKey: "balancedHold",
        blueprintKey: null,
        iLevel,
        quality,
        rarity,
        ascension: "none",
        rng: mulberry32(seed),
        allocateId: idAllocator(),
      });
      // A seed that reduced mass below base is one where massReduction rolled.
      if (item.mass < baseMass) {
        found = true;
        expect(item.rolledStats.massReduction).toBeUndefined();
        expect(item.mass).toBe(Math.max(0, baseMass - affixEach));
      }
    }
    expect(found).toBe(true);
  });

  it("folds a rolled powerDrawReduction into powerDraw and removes it as a stat line", () => {
    // reactorCore is the live slot whose affix pool carries powerDrawReduction.
    // Radiant picks 3 of its 4 affixes, so powerDrawReduction is included on most
    // seeds. Same scan-and-assert shape as the massReduction fold above: the affix
    // is consumed into powerDraw and no powerDrawReduction stat line survives.
    const iLevel = 40;
    const quality = 0;
    const rarity = "radiant" as const;
    const budget = computeBudget(iLevel, quality, rarityIndex(rarity));
    const { affixShare } = budgetShares(budget);
    const affixEach = Math.round(affixShare / 3); // radiant => 3 affix lines, equal split
    const basePowerDraw = SLOT_BASE_PHYSICALS.reactorCore.powerDraw;

    let found = false;
    for (let seed = 1; seed <= 200 && !found; seed++) {
      const item = generateEquipment({
        slotType: "reactorCore",
        varietyKey: "balancedCore",
        blueprintKey: null,
        iLevel,
        quality,
        rarity,
        ascension: "none",
        rng: mulberry32(seed),
        allocateId: idAllocator(),
      });
      // A seed that reduced powerDraw below base is one where powerDrawReduction rolled.
      if (item.powerDraw < basePowerDraw) {
        found = true;
        expect(item.rolledStats.powerDrawReduction).toBeUndefined();
        expect(item.powerDraw).toBe(Math.max(0, basePowerDraw - affixEach));
      }
    }
    expect(found).toBe(true);
  });

  it("does not mutate the caller's input record (pure)", () => {
    const args = {
      slotType: "cargoBay" as const,
      varietyKey: "balancedHold",
      blueprintKey: null,
      iLevel: 20,
      quality: 1,
      rarity: "standard" as const,
      ascension: "none" as const,
      rng: mulberry32(8),
      allocateId: idAllocator(),
    };
    const snapshot = { ...args };
    generateEquipment(args);
    expect(args).toEqual(snapshot);
  });
});

// --- generateWeapon (Combat 1.0 Unit 1.2) -----------------------------------
// Weapons are minted separately from economy gear: their identity comes from a base
// WEAPON_DEF (fixed), and only their power lines (weaponYield implicit + weaponYield /
// weaponAccuracy affixes) roll, off the SAME budget machinery. These pin that contract:
// a well-formed weapon instance, determinism, monotonicity, the weapon-only vocabulary,
// input purity, and the bad-type guard.
describe("generateWeapon: crafted-weapon minting (Combat 1.0 Unit 1.2)", () => {
  it("mints a well-formed weapon EquipmentInstance carrying its base type", () => {
    const w = generateWeapon({
      weaponType: "railgun",
      blueprintKey: "railgunBp",
      iLevel: 20,
      quality: 2,
      rarity: "augmented",
      ascension: "none",
      rng: mulberry32(3),
      allocateId: idAllocator(),
    });
    expect(w.slotType).toBe("weapon");
    expect(w.weaponType).toBe("railgun");
    // The signature weaponYield implicit is always present + positive.
    expect(w.implicitStats.weaponYield).toBeGreaterThan(0);
    // powerDraw comes straight off the weapon def (the reactor bite is a type property).
    expect(w.powerDraw).toBe(WEAPON_DEFS.railgun.powerDraw);
    // A fresh weapon starts at full, quality-scaled durability off the template ceiling.
    expect(w.durability).toBe(w.durabilityMax);
    expect(w.durabilityMax).toBe(
      Math.round(WEAPON_DEFS.railgun.durabilityMax * (1 + 2 * QUALITY_DURABILITY_BONUS)),
    );
    expect(w.fittedToShipId).toBeNull();
  });

  it("is deterministic under a fixed rng + allocateId", () => {
    const args = () => ({
      weaponType: "plasma" as const,
      blueprintKey: "plasmaBp",
      iLevel: 15,
      quality: 3,
      rarity: "radiant" as const,
      ascension: "none" as const,
      rng: mulberry32(9),
      allocateId: idAllocator(),
    });
    expect(generateWeapon(args())).toEqual(generateWeapon(args()));
  });

  it("is monotonic: a rarer, higher-quality weapon has a larger yield signature", () => {
    // The weaponYield implicit is pure budget (no rng), so this holds for any stream.
    const common = { weaponType: "autocannon" as const, blueprintKey: null, iLevel: 20, ascension: "none" as const };
    const weak = generateWeapon({ ...common, quality: 0, rarity: "standard", rng: mulberry32(1), allocateId: idAllocator() });
    const strong = generateWeapon({ ...common, quality: 5, rarity: "radiant", rng: mulberry32(1), allocateId: idAllocator() });
    expect(strong.implicitStats.weaponYield).toBeGreaterThan(weak.implicitStats.weaponYield);
  });

  it("only ever rolls weapon-vocabulary stats (weaponYield / weaponAccuracy)", () => {
    const w = generateWeapon({
      weaponType: "voltaic",
      blueprintKey: null,
      iLevel: 25,
      quality: 4,
      rarity: "radiant",
      ascension: "none",
      rng: mulberry32(7),
      allocateId: idAllocator(),
    });
    const allowed = new Set(["weaponYield", "weaponAccuracy"]);
    for (const k of Object.keys(w.implicitStats)) expect(allowed.has(k)).toBe(true);
    for (const k of Object.keys(w.rolledStats)) expect(allowed.has(k)).toBe(true);
  });

  it("throws on an unknown weapon type (corrupt caller / save)", () => {
    expect(() =>
      generateWeapon({
        weaponType: "notAWeapon" as unknown as "railgun",
        blueprintKey: null,
        iLevel: 10,
        quality: 0,
        rarity: "standard",
        ascension: "none",
        rng: mulberry32(1),
        allocateId: idAllocator(),
      }),
    ).toThrow(/no weapon def/);
  });

  it("does not mutate its input args (PURE)", () => {
    const args = {
      weaponType: "empCannon" as const,
      blueprintKey: null,
      iLevel: 18,
      quality: 1,
      rarity: "standard" as const,
      ascension: "none" as const,
      rng: mulberry32(4),
      allocateId: idAllocator(),
    };
    const snapshot = { ...args };
    generateWeapon(args);
    expect(args).toEqual(snapshot);
  });
});

// --- generateDronePod (Combat 1.0 Unit 2.1a) --------------------------------
// Drone pods are minted separately from economy + weapon gear: their identity comes from the drone
// ROLE_TEMPLATE (fixed), and only their power lines (droneHp implicit + droneHp / droneAccuracy
// affixes) roll, off the SAME budget machinery. These pin that contract: a well-formed pod instance
// carrying its role, determinism, monotonicity, the drone-only vocabulary, input purity, and the
// bad-role guard. Mirrors the generateWeapon suite exactly.
describe("generateDronePod: crafted-drone-pod minting (Combat 1.0 Unit 2.1a)", () => {
  it("mints a well-formed droneBay EquipmentInstance carrying its role", () => {
    const p = generateDronePod({
      droneRole: "attack",
      blueprintKey: "attackPodBp",
      iLevel: 20,
      quality: 2,
      rarity: "augmented",
      ascension: "none",
      rng: mulberry32(3),
      allocateId: idAllocator(),
    });
    expect(p.slotType).toBe("droneBay");
    expect(p.droneRole).toBe("attack");
    // The signature droneHp implicit is always present + positive.
    expect(p.implicitStats.droneHp).toBeGreaterThan(0);
    // powerDraw is the pod's first-pass flat base (a hangar bay running a squadron draws power).
    expect(p.powerDraw).toBe(DRONE_POD_BASE_POWER_DRAW);
    // A fresh pod starts at full, quality-scaled durability off the pod base ceiling.
    expect(p.durability).toBe(p.durabilityMax);
    expect(p.durabilityMax).toBe(
      Math.round(DRONE_POD_BASE_DURABILITY * (1 + 2 * QUALITY_DURABILITY_BONUS)),
    );
    expect(p.fittedToShipId).toBeNull();
    // No weaponType leaks onto a pod (droneRole is the pod's identity field, not weaponType).
    expect(p.weaponType).toBeUndefined();
  });

  it("is deterministic under a fixed rng + allocateId", () => {
    const args = () => ({
      droneRole: "defense" as const,
      blueprintKey: "defensePodBp",
      iLevel: 15,
      quality: 3,
      rarity: "radiant" as const,
      ascension: "none" as const,
      rng: mulberry32(9),
      allocateId: idAllocator(),
    });
    expect(generateDronePod(args())).toEqual(generateDronePod(args()));
  });

  it("is monotonic: a rarer, higher-quality pod has a larger hp signature", () => {
    // The droneHp implicit is pure budget (no rng), so this holds for any stream.
    const common = { droneRole: "support" as const, blueprintKey: null, iLevel: 20, ascension: "none" as const };
    const weak = generateDronePod({ ...common, quality: 0, rarity: "standard", rng: mulberry32(1), allocateId: idAllocator() });
    const strong = generateDronePod({ ...common, quality: 5, rarity: "radiant", rng: mulberry32(1), allocateId: idAllocator() });
    expect(strong.implicitStats.droneHp).toBeGreaterThan(weak.implicitStats.droneHp);
  });

  it("only ever rolls drone-vocabulary stats (droneHp / droneAccuracy)", () => {
    const p = generateDronePod({
      droneRole: "attack",
      blueprintKey: null,
      iLevel: 25,
      quality: 4,
      rarity: "radiant",
      ascension: "none",
      rng: mulberry32(7),
      allocateId: idAllocator(),
    });
    const allowed = new Set(["droneHp", "droneAccuracy"]);
    for (const k of Object.keys(p.implicitStats)) expect(allowed.has(k)).toBe(true);
    for (const k of Object.keys(p.rolledStats)) expect(allowed.has(k)).toBe(true);
  });

  it("throws on an unknown drone role (corrupt caller / save)", () => {
    expect(() =>
      generateDronePod({
        droneRole: "notARole" as unknown as "attack",
        blueprintKey: null,
        iLevel: 10,
        quality: 0,
        rarity: "standard",
        ascension: "none",
        rng: mulberry32(1),
        allocateId: idAllocator(),
      }),
    ).toThrow(/no drone template/);
  });

  it("does not mutate its input args (PURE)", () => {
    const args = {
      droneRole: "support" as const,
      blueprintKey: null,
      iLevel: 18,
      quality: 1,
      rarity: "standard" as const,
      ascension: "none" as const,
      rng: mulberry32(4),
      allocateId: idAllocator(),
    };
    const snapshot = { ...args };
    generateDronePod(args);
    expect(args).toEqual(snapshot);
  });
});
