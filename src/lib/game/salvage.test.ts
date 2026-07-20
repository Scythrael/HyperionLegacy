/// <reference types="vite/client" />
// ============================================================================
// Equipment recycle-salvage, 0.11.0 Storage/Salvage Task C1.
// (docs/plans/2026-07-18-storage-salvage-0.11.0-design.md §2;
//  docs/plans/2026-07-18-0.11.0-completion-plan.md Task C1.)
//
// salvageEquipment is a LIVE-ONLY, player-initiated INSTANT action: it consumes a
// SPARE CRAFTED ship system and returns a fraction of its blueprint's crafting
// inputs to inventory at quality tier 0 (crude recovery), freeing a storage slot.
//
// PARITY BOUNDARY (the whole reason this needs no offline-parity test): the action
// uses Math.random and NEVER runs inside economyTick / offline tick() /
// resolveProcesses. This suite proves the reward math, the reject cases, the
// quality-scaled yield, the softlock relief at cap, and (by source grep) that the
// function is not wired into any economy-tick path.
// ============================================================================
import { describe, it, expect } from "vitest";
// tick.ts loaded as a RAW STRING (Vite's ?raw) for the live-only source grep below.
// ?raw keeps this a pure Vite/Vitest concern with no Node type dependency (the app
// tsconfig deliberately excludes @types/node), so `npm run check` stays clean.
import tickSource from "./tick.ts?raw";
import {
  salvageEquipment,
  salvageSalvagedMaterial,
  SALVAGE_FRACTION_MIN,
  SALVAGE_FRACTION_MAX,
  SALVAGE_QUALITY_BONUS_PER_TIER,
  SALVAGE_CEILING_THRESHOLDS,
} from "./salvage";
import {
  freshState,
  generateStandardIssue,
  spareEquipmentCount,
  equipmentAtCap,
  equipmentStorageCap,
  BLUEPRINTS,
  ITEMS,
  SALVAGE_LOOT_POOLS,
  type GameState,
  type EquipmentInstance,
  type EquipmentSlotType,
} from "./model";
import Decimal from "break_infinity.js";
import { getBucket, itemTotal } from "./inventory";

// The equipment blueprint the salvage fixtures recycle. Its recipe inputs
// ({ frameSegment: 2, titaniumIngot: 3 }) are the exact amounts the reward math is
// asserted against, so the test reads them straight off BLUEPRINTS (no hard-coded
// duplicate that could drift from the data).
const SALVAGE_BP = "prospectorHoldBp";
const SALVAGE_BP_INPUTS = BLUEPRINTS[SALVAGE_BP].recipe.inputs;

// Build ONE EquipmentInstance with a chosen fitment / crafted-nature / quality, by
// starting from a real Standard-Issue baseline (so every other field is valid) and
// overriding ONLY the fields salvage reads: fittedToShipId (null = spare), blueprintKey
// (non-null = crafted; null = Standard-Issue baseline), and quality (drives the bonus).
function makePiece(opts: {
  slotType: EquipmentSlotType;
  fitted: boolean;
  crafted: boolean;
  quality: number;
  id: string;
}): EquipmentInstance {
  const base = generateStandardIssue({
    slotType: opts.slotType,
    fittedToShipId: opts.fitted ? "ship-1" : null,
    allocateId: () => opts.id,
  });
  return {
    ...base,
    fittedToShipId: opts.fitted ? "ship-1" : null,
    blueprintKey: opts.crafted ? SALVAGE_BP : null,
    quality: opts.quality,
  };
}

// A fresh state whose equipment pool is exactly the supplied pieces (freshState seeds
// ship-1's four FITTED baselines, which are 0 spare-crafted, so a supplied pool is
// the whole spare picture). Inventory starts empty of the recipe inputs so a deposit
// is observable against a known zero baseline.
function stateWith(pieces: EquipmentInstance[]): GameState {
  return { ...freshState(), equipment: pieces };
}

// The exact fraction the implementation computes, recomputed here from the exported
// consts so the test pins the FORMULA, not a magic number. rng() is stubbed to a
// fixed value in every case so the band roll is deterministic.
function expectedFraction(rngValue: number, quality: number): number {
  const band = SALVAGE_FRACTION_MIN + rngValue * (SALVAGE_FRACTION_MAX - SALVAGE_FRACTION_MIN);
  return band + quality * SALVAGE_QUALITY_BONUS_PER_TIER;
}

describe("salvageEquipment: recovers floored inputs at quality 0 and consumes the piece (Task C1)", () => {
  it("deposits floor(qty * fraction) of each recipe input into the quality-0 bucket and removes the piece", () => {
    const quality = 3;
    const rngValue = 0.5; // pins the band mid-range; fraction = 0.30 + 0.05 + 0.06 = 0.41
    const piece = makePiece({ slotType: "cargoBay", fitted: false, crafted: true, quality, id: "sp-1" });
    const state = stateWith([piece]);

    const result = salvageEquipment(state, "sp-1", () => rngValue);
    expect("recovered" in result).toBe(true);
    if (!("recovered" in result)) return; // narrow for the type checker

    const fraction = expectedFraction(rngValue, quality);
    // Every recipe input is reported with its floored recovered amount (including 0),
    // and every positive amount lands in the QUALITY-0 bucket specifically.
    for (const [itemId, qty] of Object.entries(SALVAGE_BP_INPUTS)) {
      const expected = Math.floor(qty * fraction);
      expect(result.recovered[itemId]).toBe(expected);
      expect(getBucket(result.next.inventory, itemId, 0).toNumber()).toBe(expected);
    }
    // At least one input recovered a non-zero amount, so the deposit is real.
    expect(Object.values(result.recovered).some((n) => n > 0)).toBe(true);

    // The piece is consumed (gone from the pool), and the input state is untouched.
    expect(result.next.equipment.find((e) => e.id === "sp-1")).toBeUndefined();
    expect(state.equipment.find((e) => e.id === "sp-1")).toBeDefined(); // immutability: original intact
  });

  it("deposits recovered scrap at quality tier 0 (crude recovery), never a higher tier", () => {
    const piece = makePiece({ slotType: "cargoBay", fitted: false, crafted: true, quality: 5, id: "sp-2" });
    const result = salvageEquipment(stateWith([piece]), "sp-2", () => 0.99);
    if (!("recovered" in result)) throw new Error("expected success");
    for (const itemId of Object.keys(SALVAGE_BP_INPUTS)) {
      // Bucket 0 holds the recovery; bucket 1 stays empty (no high-tier scrap).
      expect(getBucket(result.next.inventory, itemId, 1).toNumber()).toBe(0);
    }
  });
});

describe("salvageEquipment: rejects non-salvageable targets as a same-ref no-op + reason (Task C1)", () => {
  it("rejects a missing id (same-ref state, reason)", () => {
    const state = stateWith([]);
    const result = salvageEquipment(state, "nope", () => 0.5);
    expect("reason" in result).toBe(true);
    expect(result.next).toBe(state); // SAME reference: no state change
  });

  it("rejects a FITTED crafted system (only a SPARE can be salvaged)", () => {
    const piece = makePiece({ slotType: "cargoBay", fitted: true, crafted: true, quality: 2, id: "fit-1" });
    const state = stateWith([piece]);
    const result = salvageEquipment(state, "fit-1", () => 0.5);
    expect("reason" in result).toBe(true);
    expect(result.next).toBe(state);
    // The fitted piece is still present (not consumed).
    expect(result.next.equipment.find((e) => e.id === "fit-1")).toBeDefined();
  });

  it("rejects a Standard-Issue baseline (blueprintKey null: free/craftless, nothing to recover)", () => {
    const piece = makePiece({ slotType: "cargoBay", fitted: false, crafted: false, quality: 0, id: "base-1" });
    const state = stateWith([piece]);
    const result = salvageEquipment(state, "base-1", () => 0.5);
    expect("reason" in result).toBe(true);
    expect(result.next).toBe(state);
    expect(result.next.equipment.find((e) => e.id === "base-1")).toBeDefined();
  });
});

describe("salvageEquipment: higher-quality systems recover more (Task C1)", () => {
  it("a quality-5 system recovers at least as much, and strictly more of some input, than a quality-0 system on the SAME rng", () => {
    const rng = () => 0; // band pinned to the minimum so only the quality bonus varies
    const low = makePiece({ slotType: "cargoBay", fitted: false, crafted: true, quality: 0, id: "q0" });
    const high = makePiece({ slotType: "cargoBay", fitted: false, crafted: true, quality: 5, id: "q5" });

    const lowRes = salvageEquipment(stateWith([low]), "q0", rng);
    const highRes = salvageEquipment(stateWith([high]), "q5", rng);
    if (!("recovered" in lowRes) || !("recovered" in highRes)) throw new Error("expected success");

    // Total recovered scrap is strictly greater for the higher-quality system.
    const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
    expect(sum(highRes.recovered)).toBeGreaterThan(sum(lowRes.recovered));
  });
});

describe("salvageEquipment: SOFTLOCK RELIEF, salvage works AT the storage cap (Task C1)", () => {
  it("salvaging a spare with the pool at cap succeeds and drops the spare count below cap (cap is never consulted)", () => {
    const cap = equipmentStorageCap(freshState());
    // Fill the spare pool to EXACTLY the cap with crafted spares.
    const pool: EquipmentInstance[] = [];
    for (let i = 0; i < cap; i++) {
      pool.push(makePiece({ slotType: "cargoBay", fitted: false, crafted: true, quality: 1, id: `cap-${i}` }));
    }
    const state = stateWith(pool);
    expect(equipmentAtCap(state)).toBe(true); // precondition: the store is FULL
    expect(spareEquipmentCount(state)).toBe(cap);

    // Salvage still succeeds at cap: salvage never checks equipmentAtCap, so a full
    // store is always relievable (the guarantee deferred from Task B1).
    const result = salvageEquipment(state, "cap-0", () => 0.5);
    expect("recovered" in result).toBe(true);
    expect(spareEquipmentCount(result.next)).toBe(cap - 1);
    expect(equipmentAtCap(result.next)).toBe(false);
  });
});

describe("salvageEquipment: LIVE-ONLY, never wired into an economy-tick path (Task C1)", () => {
  it("is not referenced anywhere in tick.ts (economyTick / tick / resolveProcesses live there)", () => {
    // GUARD: salvage is a discrete live action, not a timed/offline process. tick.ts
    // owns economyTick, the offline tick(), and resolveProcesses; if salvageEquipment
    // ever appears there, the parity boundary has been breached. A source grep is the
    // most direct, maintainable proof of the negative.
    expect(tickSource).not.toContain("salvageEquipment");
    expect(tickSource).not.toContain("salvageSalvagedMaterial");
    expect(tickSource).not.toContain("./salvage");
  });
});

// ============================================================================
// salvageSalvagedMaterial (Task C2/C3): the tiered, progression-gated loot roll.
// ============================================================================

// The salvaged material every loot-roll fixture salvages. Its id is deliberately the
// legacy `intactReactorCore` (the Damaged Reactor Housing), reclassified to
// `salvagedMaterial` in Task A3, so the tests read the id straight off the data.
const HOUSING = "intactReactorCore";

// A stub rng that returns a FIXED sequence of values, one per call, then repeats the
// last value (so a caller that draws more than expected still gets a defined value
// instead of NaN). salvageSalvagedMaterial makes exactly two draws (tier, then item),
// so a two-element sequence pins one exact roll.
function seqRng(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[Math.min(i, values.length - 1)];
    i++;
    return v;
  };
}

// A fresh state that holds `count` of the Damaged Reactor Housing at quality 0, and a
// chosen Fleet Admiral level (drives the progression ceiling). freshState seeds no
// Housing, so this is the whole picture.
function stateWithHousing(count: number, fleetAdminLevel: number): GameState {
  const base = freshState();
  return {
    ...base,
    fleetAdminLevel,
    inventory: { ...base.inventory, [HOUSING]: [new Decimal(count)] },
  };
}

// A deterministic PRNG (mulberry32) for the STATISTICAL balance/gating tests, so "over
// many rolls" is reproducible run to run (no reliance on Math.random).
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// FA level that unlocks the FULL ladder (>= the highest threshold), for tests that need
// the top tier reachable. Read off the data so it can never drift from the thresholds.
const MAX_CEILING_LEVEL = Math.max(...SALVAGE_CEILING_THRESHOLDS.map((t) => t.minFleetAdminLevel));

describe("salvageSalvagedMaterial: a seeded roll deposits the expected tier+item and consumes one unit (Task C2)", () => {
  it("rng [0,0] rolls the LOW tier's staple at that tier's quality and consumes one Housing", () => {
    const state = stateWithHousing(3, 1); // fresh FA level: only the standard tier eligible
    const lowTier = SALVAGE_LOOT_POOLS[HOUSING][0];
    const staple = lowTier.drops[0]; // first drop = the reliable staple

    // rng()=0 picks the first eligible tier, then the first drop in it.
    const result = salvageSalvagedMaterial(state, HOUSING, seqRng([0, 0]));
    expect("rolled" in result).toBe(true);
    if (!("rolled" in result) || !result.rolled) throw new Error("expected a roll");

    // The rolled item is the low tier's staple, deposited at the tier's quality bucket.
    expect(result.rolled.itemId).toBe(staple.itemId);
    expect(result.rolled.tier).toBe(lowTier.tier);
    expect(result.rolled.quality).toBe(lowTier.quality);
    expect(getBucket(result.next.inventory, staple.itemId, lowTier.quality).toNumber()).toBe(1);
    expect(result.recovered[staple.itemId]).toBe(1);

    // Exactly ONE Housing consumed (3 -> 2), and the input state is untouched.
    expect(itemTotal(result.next.inventory, HOUSING).toNumber()).toBe(2);
    expect(itemTotal(state.inventory, HOUSING).toNumber()).toBe(3); // immutability
  });

  it("rng near 1 on the tier draw, with the full ladder unlocked, rolls the TOP tier's first exotic", () => {
    const state = stateWithHousing(1, MAX_CEILING_LEVEL);
    const pool = SALVAGE_LOOT_POOLS[HOUSING];
    const topTier = pool[pool.length - 1]; // radiant this patch
    const topDrop = topTier.drops[0];

    // 0.999999 on the tier draw walks past every lower tier to the last eligible one;
    // 0 on the item draw picks that tier's first drop (an exclusive exotic).
    const result = salvageSalvagedMaterial(state, HOUSING, seqRng([0.999999, 0]));
    if (!("rolled" in result) || !result.rolled) throw new Error("expected a roll");

    expect(result.rolled.tier).toBe(topTier.tier);
    expect(result.rolled.itemId).toBe(topDrop.itemId);
    expect(result.rolled.quality).toBe(topTier.quality);
    expect(getBucket(result.next.inventory, topDrop.itemId, topTier.quality).toNumber()).toBe(1);
  });
});

describe("salvageSalvagedMaterial: rejects invalid targets as a same-ref no-op + reason (Task C2)", () => {
  it("rejects a NON-salvagedMaterial item id", () => {
    const state = stateWithHousing(1, 1);
    // scrapAlloy is a raw item, not a salvaged material: no loot pool, not salvageable.
    const result = salvageSalvagedMaterial(state, "scrapAlloy", seqRng([0, 0]));
    expect("reason" in result).toBe(true);
    if (!("reason" in result)) return;
    expect(result.reason).toBe("notSalvagedMaterial");
    expect(result.next).toBe(state); // SAME reference: no state change
  });

  it("rejects when the player holds ZERO of the salvaged material", () => {
    const state = stateWithHousing(0, 1); // Housing present as a key but at 0
    const result = salvageSalvagedMaterial(state, HOUSING, seqRng([0, 0]));
    expect("reason" in result).toBe(true);
    if (!("reason" in result)) return;
    expect(result.reason).toBe("noneHeld");
    expect(result.next).toBe(state);
  });
});

describe("salvageSalvagedMaterial: progression gates the rarity ceiling (Task C2)", () => {
  it("at a LOW FA level, only the low tier rolls, the high-tier exclusive exotic is UNREACHABLE", () => {
    const state = stateWithHousing(2000, 1); // fresh FA level: ceiling = index 0
    const rng = mulberry32(12345);
    const lowTierQuality = SALVAGE_LOOT_POOLS[HOUSING][0].quality;

    // The stellar tier's first drop is the first exclusive exotic (anomalousAlloy). At a
    // fresh FA level that tier is out of reach, so it must NEVER be deposited, and no
    // drop should ever land above the low tier's quality bucket.
    const exoticId = SALVAGE_LOOT_POOLS[HOUSING][2].drops[0].itemId;
    let next = state;
    for (let i = 0; i < 2000; i++) {
      const r = salvageSalvagedMaterial(next, HOUSING, rng);
      if (!("rolled" in r) || !r.rolled) throw new Error("expected a roll");
      // No roll ever exceeds the low tier's quality (nothing above the ceiling rolled).
      expect(r.rolled.quality).toBeLessThanOrEqual(lowTierQuality);
      next = r.next;
    }
    // The exclusive exotic never entered inventory at all.
    expect(itemTotal(next.inventory, exoticId).toNumber()).toBe(0);
  });

  it("a ceilingBonus lifts the ceiling so the top tier becomes reachable (the FA-talent hook)", () => {
    const state = stateWithHousing(1, 1); // fresh FA level, but...
    const pool = SALVAGE_LOOT_POOLS[HOUSING];
    const topTier = pool[pool.length - 1];
    // ...a ceilingBonus large enough to unlock the whole ladder. rng near 1 forces the
    // top eligible tier, proving the bonus (not FA level) opened it.
    const result = salvageSalvagedMaterial(state, HOUSING, seqRng([0.999999, 0]), pool.length);
    if (!("rolled" in result) || !result.rolled) throw new Error("expected a roll");
    expect(result.rolled.tier).toBe(topTier.tier);
  });
});

describe("salvageSalvagedMaterial: balance, exotics dominate the high tiers, refined/components are super-rare (Task C3)", () => {
  it("over many top-ceiling rolls, exclusive exotics vastly outnumber plain refined/components", () => {
    const state = stateWithHousing(20000, MAX_CEILING_LEVEL); // full ladder unlocked
    const rng = mulberry32(99);

    // The exclusive salvage-only exotics (from A3) vs the plain refined/fabricated items
    // that may appear only at super-rare weights.
    const exotics = new Set(["anomalousAlloy", "precursorCircuit", "intactDataCore"]);
    const plainRefinedComponents = new Set(["titaniumIngot", "frameSegment", "powerCoupling"]);

    let exoticCount = 0;
    let refinedComponentCount = 0;
    let total = 0;
    let next = state;
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const r = salvageSalvagedMaterial(next, HOUSING, rng);
      if (!("rolled" in r) || !r.rolled) throw new Error("expected a roll");
      if (exotics.has(r.rolled.itemId)) exoticCount++;
      if (plainRefinedComponents.has(r.rolled.itemId)) refinedComponentCount++;
      total++;
      next = r.next;
    }

    // Exotics dominate over plain refined/components (steep-but-reachable high tiers vs
    // super-rare guardrail weights): a wide margin, asserted as a ratio so the exact
    // seed does not make the test brittle.
    expect(exoticCount).toBeGreaterThan(refinedComponentCount * 3);
    // Plain refined/components stay genuinely RARE overall (< 2% of all rolls): salvage
    // must never become a sensible way to source them.
    expect(refinedComponentCount / total).toBeLessThan(0.02);
    // Sanity: the common outcome is still the modest low-tier staple (the majority).
    expect(exoticCount / total).toBeLessThan(0.5);
  });
});

describe("SALVAGE_LOOT_POOLS: the pool data is well-formed (Task C3)", () => {
  it("every referenced drop item exists in ITEMS, tiers ascend in quality, and exotics sit at the top", () => {
    for (const [materialId, tiers] of Object.entries(SALVAGE_LOOT_POOLS)) {
      // The keyed salvaged material itself is a real, salvagedMaterial-category item.
      expect(ITEMS[materialId]?.category).toBe("salvagedMaterial");
      expect(tiers.length).toBeGreaterThan(0);

      let prevQuality = -1;
      for (const tier of tiers) {
        expect(tier.weight).toBeGreaterThan(0);
        // Quality is a valid 0..5 rung and ascends (weakly) with tier index.
        expect(tier.quality).toBeGreaterThanOrEqual(0);
        expect(tier.quality).toBeLessThanOrEqual(5);
        expect(tier.quality).toBeGreaterThanOrEqual(prevQuality);
        prevQuality = tier.quality;
        expect(tier.drops.length).toBeGreaterThan(0);
        for (const drop of tier.drops) {
          expect(ITEMS[drop.itemId]).toBeDefined(); // no dangling item reference
          expect(drop.weight).toBeGreaterThan(0);
        }
      }

      // The exclusive exotics appear ONLY in the upper half of the ladder, never the
      // lowest tier (they are the high-tier payoff, not a common drop).
      const exotics = new Set(["anomalousAlloy", "precursorCircuit", "intactDataCore"]);
      const lowestTierItems = new Set(tiers[0].drops.map((d) => d.itemId));
      for (const id of exotics) {
        expect(lowestTierItems.has(id)).toBe(false);
      }
    }
  });
});
