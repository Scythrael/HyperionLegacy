// ============================================================================
// craftingProgress.test.ts
// Crafting 0.13.3, Phase 3 Unit 3.1
// Design: docs/plans/2026-09-01-crafting-0.13.3-design.md section 6.
//
// This unit's value IS the proof, so the suite is organised around it:
//
//   1. Design table 6.2 transcribed VERBATIM as characterization tests. Every
//      weight and every award is asserted against the number the design states,
//      so a later retune shows up as a deliberate, visible test edit rather than
//      as a quiet balance drift.
//   2. Design table 6.3 transcribed VERBATIM, curve values and cumulatives.
//   3. The design's WORKED PROOF (section 6.4) as an executable test: how long,
//      and how much ore, it takes to reach the tier-2 iLevel ceiling by pure
//      refining versus by fabricating tier-2 equipment. This is the user's core
//      balance requirement made checkable.
//   4. Integer exactness across a long accumulation, and monotonicity.
//   5. The mechanical guards: the xpWeightNum default, per-process resolution,
//      and the readouts.
//
// ⚠️ ONE DISCREPANCY FOUND AGAINST THE DESIGN, reported and NOT silently patched.
// See the "design's Route B assumes three Fabricator slots" block in section 3.
//
// Project punctuation rule: no em dashes, and no doubled hyphens standing in for
// one. (The // --- rules --- are section dividers, the one sanctioned use.)
// ============================================================================

import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import {
  freshState,
  BLUEPRINTS,
  REFINE_RECIPES,
  SHIP_TYPES,
  FACILITIES,
  FABRICATOR_FACILITY_KEY,
  WAREHOUSE_T1_BASE_CAP,
  CRAFTING_XP_PER_DURATION_TICK,
  CRAFTING_XP_WEIGHT_DENOM,
  REFINE_XP_WEIGHT_NUM,
  MATERIAL_FABRICATE_XP_WEIGHT_NUM_PER_TIER,
  EQUIPMENT_FABRICATE_XP_WEIGHT_NUM_PER_TIER,
  SHIP_BUILD_XP_WEIGHT_NUM,
  CRAFT_XP_BASE,
  CRAFT_XP_KNEE,
  blueprintMintsEquipmentInstance,
  type BlueprintDef,
  type RefineRecipeDef,
  type TimedProcess,
  type TimedProcessKind,
} from "./model";
import { refineSlotCount, fabricateSlotCount } from "./tick";
import { EQUIPMENT_ILEVEL_CAP_PER_TIER } from "./itemgen";
import {
  craftingXpForNext,
  craftingXpWeightNum,
  craftingXpAward,
  craftingXpAwardFor,
  craftingXpAwardForProcess,
  craftingXpPerTick,
  craftingXpSubjectForProcess,
  craftingXpCumulativeToReach,
  craftingLevelProgress,
  craftedItemLevelReadout,
  itemLevelCeilingForTier,
  type CraftingXpSubject,
} from "./craftingProgress";

// --- Shared fixtures ---------------------------------------------------------

// Real blueprints standing in for each row of design table 6.2. Picked from live data
// (not hand-built) so the characterization breaks if the content table is retiered.
const T1_MATERIAL_BP = BLUEPRINTS.frameSegmentBp;            // tier 1, material output
const T2_MATERIAL_BP = BLUEPRINTS.structuralAssemblyBp;      // tier 2, material output
const T1_EQUIPMENT_BP = BLUEPRINTS.pointDefenseArrayBp;      // tier 1, mints an instance
const T2_EQUIPMENT_BP = BLUEPRINTS.gravitonBp;               // tier 2, mints an instance

const REFINE_COMMON_ORE = REFINE_RECIPES.refineCommonOre;
const REFINE_WAFER = REFINE_RECIPES.refinePolysilicateWafer;

const refineSubject = (recipe: RefineRecipeDef): CraftingXpSubject => ({ kind: "refine", recipe });
const fabricateSubject = (blueprint: BlueprintDef): CraftingXpSubject => ({ kind: "fabricate", blueprint });
const SHIP_BUILD_SUBJECT: CraftingXpSubject = { kind: "shipBuild" };
const NONE_SUBJECT: CraftingXpSubject = { kind: "none" };

// A TimedProcess shell for the resolver tests. Only kind/durationTicks/effect are read.
function processOf(kind: TimedProcessKind, durationTicks: number, effect: TimedProcess["effect"]): TimedProcess {
  return { id: "p-1", kind, remainingTicks: durationTicks, durationTicks, effect };
}

// A fully upgraded facility state, so the worked proof measures the CEILING of each
// production route rather than an arbitrary mid-game level. Levels come from the track
// lengths, so appending a rung moves the proof automatically.
function maxedFacilities() {
  return {
    ...freshState(),
    facilities: {
      refinery: { level: FACILITIES.refinery.upgrades.length },
      [FABRICATOR_FACILITY_KEY]: { level: FACILITIES[FABRICATOR_FACILITY_KEY].upgrades.length },
    },
  };
}

// An independent BigInt oracle for the curve, computed from the design's own algebra
// (BASE * L^2 * (KNEE + L) / KNEE) in exact integer arithmetic. Used to prove the shipped
// implementation's float grouping is exact, rather than comparing it against itself.
function curveOracle(level: number): bigint {
  const L = BigInt(level);
  return (BigInt(CRAFT_XP_BASE) * L * L * (BigInt(CRAFT_XP_KNEE) + L)) / BigInt(CRAFT_XP_KNEE);
}

// ============================================================================
// 1. Design table 6.2, transcribed verbatim
// ============================================================================

describe("design 6.1: the weight table", () => {
  it("uses a denominator of 4, so the smallest weight (refining) is a clean quarter", () => {
    expect(CRAFTING_XP_WEIGHT_DENOM).toBe(4);
    expect(REFINE_XP_WEIGHT_NUM).toBe(1);
    expect(MATERIAL_FABRICATE_XP_WEIGHT_NUM_PER_TIER).toBe(4);
    expect(EQUIPMENT_FABRICATE_XP_WEIGHT_NUM_PER_TIER).toBe(6);
    expect(SHIP_BUILD_XP_WEIGHT_NUM).toBe(12);
    // The base rate is UNCHANGED by this unit. Tier-1 material fabrication landing on
    // 4/4 is what makes the pre-0.13.3 pacing the anchor the rest of the table is
    // measured against, and that only holds while the base rate stays 2.
    expect(CRAFTING_XP_PER_DURATION_TICK).toBe(2);
  });

  it("refining weighs 1 (0.25x), the deliberate laggard", () => {
    expect(craftingXpWeightNum(refineSubject(REFINE_COMMON_ORE))).toBe(1);
    expect(craftingXpWeightNum(refineSubject(REFINE_WAFER))).toBe(1);
  });

  it("material fabrication weighs 4 x tier (1.0x per tier)", () => {
    expect(craftingXpWeightNum(fabricateSubject(T1_MATERIAL_BP))).toBe(4);
    expect(craftingXpWeightNum(fabricateSubject(T2_MATERIAL_BP))).toBe(8);
  });

  it("instance-minting fabrication weighs 6 x tier (1.5x per tier)", () => {
    expect(craftingXpWeightNum(fabricateSubject(T1_EQUIPMENT_BP))).toBe(6);
    expect(craftingXpWeightNum(fabricateSubject(T2_EQUIPMENT_BP))).toBe(12);
  });

  it("ship builds weigh 12 (3.0x), flat, NOT per tier", () => {
    expect(craftingXpWeightNum(SHIP_BUILD_SUBJECT)).toBe(SHIP_BUILD_XP_WEIGHT_NUM);
  });

  it("everything else weighs 0", () => {
    expect(craftingXpWeightNum(NONE_SUBJECT)).toBe(0);
    expect(craftingXpAwardFor(NONE_SUBJECT, 10_000)).toBe(0);
  });

  it("the equipment/material split is read from blueprintMintsEquipmentInstance, so weapons and drone pods price as equipment", () => {
    // Design 6.1 names "equipment or weapon"; the predicate it names also covers drone
    // pods, and that is the behavior shipped. Locked here so the wider coverage is a
    // stated decision rather than an accident.
    const weapon = BLUEPRINTS.autocannonBp;   // tier 1, weapon
    const drone = BLUEPRINTS.attackDronePodBp; // tier 1, drone pod
    expect(blueprintMintsEquipmentInstance(weapon)).toBe(true);
    expect(blueprintMintsEquipmentInstance(drone)).toBe(true);
    expect(craftingXpWeightNum(fabricateSubject(weapon))).toBe(6);
    expect(craftingXpWeightNum(fabricateSubject(drone))).toBe(6);
  });
});

describe("design table 6.2: worked examples, what each thing is worth", () => {
  // Each row is (job, ticks, XP new, XP per tick), transcribed from the design.

  it("refineCommonOre, 12 ticks, 6 XP, 0.5 per tick", () => {
    expect(REFINE_COMMON_ORE.durationTicks).toBe(12); // the design's stated tick count
    expect(craftingXpAwardFor(refineSubject(REFINE_COMMON_ORE), 12)).toBe(6);
    expect(craftingXpPerTick(refineSubject(REFINE_COMMON_ORE))).toBe(0.5);
  });

  it("refinePolysilicateWafer, 20 ticks, 10 XP, 0.5 per tick", () => {
    expect(REFINE_WAFER.durationTicks).toBe(20);
    expect(craftingXpAwardFor(refineSubject(REFINE_WAFER), 20)).toBe(10);
    expect(craftingXpPerTick(refineSubject(REFINE_WAFER))).toBe(0.5);
  });

  it("tier-1 material blueprint, 120 ticks, 240 XP, 2.0 per tick (the pre-0.13.3 anchor)", () => {
    expect(T1_MATERIAL_BP.tier).toBe(1);
    expect(T1_MATERIAL_BP.craftDurationTicks).toBe(120);
    expect(craftingXpAwardFor(fabricateSubject(T1_MATERIAL_BP), 120)).toBe(240);
    expect(craftingXpPerTick(fabricateSubject(T1_MATERIAL_BP))).toBe(2);
    // The anchor claim, stated as an equation: a tier-1 material craft pays exactly what
    // the old flat award paid, so existing pacing is unchanged for this one row.
    expect(craftingXpAwardFor(fabricateSubject(T1_MATERIAL_BP), 120)).toBe(CRAFTING_XP_PER_DURATION_TICK * 120);
  });

  it("tier-2 material blueprint, 300 ticks, 1,200 XP, 4.0 per tick", () => {
    expect(T2_MATERIAL_BP.tier).toBe(2);
    expect(T2_MATERIAL_BP.craftDurationTicks).toBe(300);
    expect(craftingXpAwardFor(fabricateSubject(T2_MATERIAL_BP), 300)).toBe(1200);
    expect(craftingXpPerTick(fabricateSubject(T2_MATERIAL_BP))).toBe(4);
  });

  it("tier-1 equipment blueprint, 120 ticks, 360 XP, 3.0 per tick", () => {
    expect(T1_EQUIPMENT_BP.tier).toBe(1);
    expect(craftingXpAwardFor(fabricateSubject(T1_EQUIPMENT_BP), 120)).toBe(360);
    expect(craftingXpPerTick(fabricateSubject(T1_EQUIPMENT_BP))).toBe(3);
  });

  it("tier-2 equipment blueprint, 300 ticks, 1,800 XP, 6.0 per tick", () => {
    expect(T2_EQUIPMENT_BP.tier).toBe(2);
    expect(T2_EQUIPMENT_BP.craftDurationTicks).toBe(300);
    expect(craftingXpAwardFor(fabricateSubject(T2_EQUIPMENT_BP), 300)).toBe(1800);
    expect(craftingXpPerTick(fabricateSubject(T2_EQUIPMENT_BP))).toBe(6);
  });

  it("cheapest hull, 300 ticks, 1,800 XP, 6.0 per tick", () => {
    // ⚠️ DESIGN NAMING NIT (numbers correct, label wrong): design table 6.2 calls this
    // row "Corvette hull". There is no Corvette in SHIP_TYPES. The 300-tick hull is the
    // General Freighter, the cheapest build in the table, so the NUMBER the design used
    // is the live number and only the name is off. Recorded, not silently reworded away.
    const cheapest = Math.min(...Object.values(SHIP_TYPES).map((s) => s.buildRecipe.durationTicks));
    expect(cheapest).toBe(300);
    expect(SHIP_TYPES.generalFreighter.buildRecipe.durationTicks).toBe(300);
    expect(craftingXpAwardFor(SHIP_BUILD_SUBJECT, 300)).toBe(1800);
    expect(craftingXpPerTick(SHIP_BUILD_SUBJECT)).toBe(6);
  });

  it("largest hull, 1,200 ticks, 7,200 XP, 6.0 per tick", () => {
    const largest = Math.max(...Object.values(SHIP_TYPES).map((s) => s.buildRecipe.durationTicks));
    expect(largest).toBe(1200);
    expect(craftingXpAwardFor(SHIP_BUILD_SUBJECT, 1200)).toBe(7200);
  });

  it("every row of table 6.2 awards a whole number of XP", () => {
    const rows: [CraftingXpSubject, number][] = [
      [refineSubject(REFINE_COMMON_ORE), 12],
      [refineSubject(REFINE_WAFER), 20],
      [fabricateSubject(T1_MATERIAL_BP), 120],
      [fabricateSubject(T2_MATERIAL_BP), 300],
      [fabricateSubject(T1_EQUIPMENT_BP), 120],
      [fabricateSubject(T2_EQUIPMENT_BP), 300],
      [SHIP_BUILD_SUBJECT, 300],
      [SHIP_BUILD_SUBJECT, 1200],
    ];
    for (const [subject, ticks] of rows) {
      expect(Number.isInteger(craftingXpAwardFor(subject, ticks))).toBe(true);
    }
  });
});

// ============================================================================
// 2. Design table 6.3, transcribed verbatim
// ============================================================================

describe("design 6.3: the curve, gentle then steep", () => {
  it("uses BASE 120 and KNEE 20", () => {
    expect(CRAFT_XP_BASE).toBe(120);
    expect(CRAFT_XP_KNEE).toBe(20);
  });

  // ⚠️ READING NOTE on design table 6.3's first column. Its header is "Cost of this
  // level", and for rows 5 / 10 / 25 / 40 / 50 the stated figure is craftingXpForNext(L),
  // the cost to go FROM L to L+1. Its row-2 figure (126) is craftingXpForNext(1), the
  // cost to REACH level 2. Both readings are transcribed below against the number the
  // design actually prints, so nothing is invented; only the column's label is loose.
  // The "Cumulative to reach it" column is consistent across every row and is asserted
  // as its own set below.
  it("craftingXpForNext matches every value design table 6.3 prints", () => {
    expect(craftingXpForNext(1).toNumber()).toBe(126);       // row 2, "cost of this level"
    expect(craftingXpForNext(5).toNumber()).toBe(3750);      // row 5
    expect(craftingXpForNext(10).toNumber()).toBe(18000);    // row 10
    expect(craftingXpForNext(25).toNumber()).toBe(168750);   // row 25
    expect(craftingXpForNext(40).toNumber()).toBe(576000);   // row 40
    expect(craftingXpForNext(50).toNumber()).toBe(1050000);  // row 50
  });

  it("craftingXpCumulativeToReach matches design table 6.3's cumulative column", () => {
    expect(craftingXpCumulativeToReach(2).toNumber()).toBe(126);
    expect(craftingXpCumulativeToReach(5).toNumber()).toBe(4200);
    expect(craftingXpCumulativeToReach(10).toNumber()).toBe(46350);
    expect(craftingXpCumulativeToReach(25).toNumber()).toBe(1128000);
    expect(craftingXpCumulativeToReach(40).toNumber()).toBe(6115200);
    expect(craftingXpCumulativeToReach(50).toNumber()).toBe(13854750);
  });

  it("reaching level 1 costs nothing, and sub-1 / non-finite input is 0 rather than a throw", () => {
    expect(craftingXpCumulativeToReach(1).toNumber()).toBe(0);
    expect(craftingXpCumulativeToReach(0).toNumber()).toBe(0);
    expect(craftingXpCumulativeToReach(-5).toNumber()).toBe(0);
    expect(craftingXpCumulativeToReach(Number.NaN).toNumber()).toBe(0);
  });

  it("is steeper in SHAPE than the retired 500 * L^2 curve: 32x versus 16x from level 10 to 40", () => {
    const newRatio = craftingXpForNext(40).div(craftingXpForNext(10)).toNumber();
    expect(newRatio).toBe(32);
    const oldRatio = (500 * 40 * 40) / (500 * 10 * 10);
    expect(oldRatio).toBe(16);
    expect(newRatio).toBeGreaterThan(oldRatio);
  });

  it("is LOWER in absolute scale than the retired curve across the reachable band, because refine income was cut 4x", () => {
    // Design table 6.3's last column, transcribed: cumulative under the old 500 * L^2.
    const oldCumulative = (target: number) => {
      let total = 0;
      for (let k = 1; k < target; k++) total += 500 * k * k;
      return total;
    };
    expect(oldCumulative(2)).toBe(500);
    expect(oldCumulative(5)).toBe(15000);
    expect(oldCumulative(10)).toBe(142500);
    expect(oldCumulative(25)).toBe(2450000);
    expect(oldCumulative(40)).toBe(10270000);
    expect(oldCumulative(50)).toBe(20212500);
    for (const level of [2, 5, 10, 25, 40, 50]) {
      expect(craftingXpCumulativeToReach(level).toNumber()).toBeLessThan(oldCumulative(level));
    }
  });

  it("is gentle at the low end: level 2 is 21 refine jobs, or a single tier-1 component craft", () => {
    // The design's own low-end cross check, so "gentle early" is not just an adjective.
    const costOfLevel2 = craftingXpCumulativeToReach(2).toNumber();
    expect(costOfLevel2).toBe(126);
    const perRefine = craftingXpAwardFor(refineSubject(REFINE_COMMON_ORE), REFINE_COMMON_ORE.durationTicks);
    expect(Math.ceil(costOfLevel2 / perRefine)).toBe(21);
    // 21 jobs on one slot is 21 * 12 = 252 ticks, which the design rounds to "about 84
    // seconds"; that figure assumed the three-slot refinery, so state it that way.
    expect((21 * REFINE_COMMON_ORE.durationTicks) / 3).toBe(84);
    // And one tier-1 component craft clears the level on its own.
    expect(craftingXpAwardFor(fabricateSubject(T1_MATERIAL_BP), T1_MATERIAL_BP.craftDurationTicks))
      .toBeGreaterThan(costOfLevel2);
  });

  it("is monotonically increasing per level", () => {
    for (let level = 1; level < 200; level++) {
      expect(craftingXpForNext(level + 1).gt(craftingXpForNext(level))).toBe(true);
    }
  });

  it("is computed with an EXACT integer grouping, not the design's prose float form", () => {
    // The prose form BASE * L^2 * (1 + L / KNEE) evaluates 1 + L/20 as a binary float
    // and drifts: it returns 7938.000000000001 at level 7 and 108485.99999999999 at
    // level 21. The shipped grouping divides once, at the end, over whole numbers.
    // Oracle is BigInt, so this compares the implementation against real arithmetic
    // rather than against a second copy of itself.
    for (let level = 1; level <= 46; level++) {
      const value = craftingXpForNext(level).toNumber();
      expect(Number.isInteger(value)).toBe(true);
      expect(BigInt(value)).toBe(curveOracle(level));
    }
    // Explicitly pin the two levels the prose form gets wrong.
    expect(craftingXpForNext(7).toNumber()).toBe(7938);
    expect(craftingXpForNext(21).toNumber()).toBe(108486);
    // Well past the reachable band the break_infinity Decimal's mantissa/exponent
    // storage can cost the last bit or two. That is a property of the accumulator type,
    // not of this formula, and it is far below anything a threshold comparison can see.
    for (let level = 47; level <= 500; level++) {
      const value = craftingXpForNext(level).toNumber();
      const exact = Number(curveOracle(level));
      expect(Math.abs(value - exact) / exact).toBeLessThan(1e-12);
    }
  });
});

// ============================================================================
// 3. The worked proof (design section 6.4), executable
// ============================================================================
//
// THE USER'S CORE REQUIREMENT, made checkable: crafting level drives crafted-equipment
// iLevel and all crafting feeds it, but bulk refining must not be a viable road to the
// iLevel ceiling. This block computes both roads from live content data and compares
// them, rather than trusting the design's prose.

describe("design 6.4: bulk refining cannot outpace meaningful crafting", () => {
  // The destination: the tier-2 iLevel ceiling. Two content tiers exist, the per-tier cap
  // is 20, so the live ceiling is iLevel 40, reached at crafting level 40 (design 6.5).
  const TIER_2_ILEVEL_CEILING = 2 * EQUIPMENT_ILEVEL_CAP_PER_TIER;
  const TARGET_CRAFTING_LEVEL = TIER_2_ILEVEL_CEILING;
  const XP_TO_TARGET = craftingXpCumulativeToReach(TARGET_CRAFTING_LEVEL).toNumber();

  // One tick is one second (freshState's tickDurationSeconds), which is what turns tick
  // counts into the hours the design quotes.
  const SECONDS_PER_TICK = freshState().tickDurationSeconds;

  it("the destination is 6,115,200 XP at crafting level 40, the tier-2 iLevel ceiling", () => {
    expect(EQUIPMENT_ILEVEL_CAP_PER_TIER).toBe(20);
    expect(TIER_2_ILEVEL_CEILING).toBe(40);
    expect(XP_TO_TARGET).toBe(6115200); // the design's stated figure
    expect(SECONDS_PER_TICK).toBe(1);
  });

  it("Route A, pure bulk refining: 3 slots, 1.5 XP per tick, about 1,132 hours", () => {
    const refineSlots = refineSlotCount(maxedFacilities());
    expect(refineSlots).toBe(3); // design: "Refinery tops out at 3 slots"

    const perSlotPerTick = craftingXpPerTick(refineSubject(REFINE_COMMON_ORE));
    expect(perSlotPerTick).toBe(0.5);

    const routeARate = refineSlots * perSlotPerTick;
    expect(routeARate).toBe(1.5); // design: "a fully upgraded Refinery earns 1.5 XP per tick"

    const routeATicks = XP_TO_TARGET / routeARate;
    expect(routeATicks).toBe(4076800); // design: "4,076,800 ticks"

    const routeAHours = (routeATicks * SECONDS_PER_TICK) / 3600;
    expect(Math.round(routeAHours)).toBe(1132); // design: "about 1,132 hours"
    expect(Math.round(routeAHours / 24)).toBe(47); // design: "roughly 47 days"
  });

  it("Route A needs 20.4 million Titanium Ore, more than 20 full warehouses", () => {
    const perJob = craftingXpAwardFor(refineSubject(REFINE_COMMON_ORE), REFINE_COMMON_ORE.durationTicks);
    expect(perJob).toBe(6);

    const jobs = XP_TO_TARGET / perJob;
    expect(jobs).toBe(1019200); // design: "1,019,200 refine jobs"

    const orePerJob = REFINE_COMMON_ORE.input.commonOre.toNumber();
    expect(orePerJob).toBe(20);

    const oreNeeded = jobs * orePerJob;
    expect(oreNeeded).toBe(20384000); // design: "20.4 million Titanium Ore"

    // THE MATERIALS HALF OF THE REQUIREMENT: the refining road is not merely slow, it
    // asks for more ore than the warehouse can hold, by more than an order of magnitude.
    expect(WAREHOUSE_T1_BASE_CAP).toBe(1000000); // design: "a base warehouse cap of 1,000,000 per item"
    expect(oreNeeded).toBeGreaterThan(WAREHOUSE_T1_BASE_CAP);
    expect(oreNeeded / WAREHOUSE_T1_BASE_CAP).toBeGreaterThan(20); // "20 full warehouses"
  });

  // ==========================================================================
  // ⚠️ DISCREPANCY AGAINST THE DESIGN, REPORTED NOT PATCHED.
  //
  // Design 6.4 Route B reads: "Three fabricate slots at 6 XP per tick = 18 XP per tick",
  // giving 339,733 ticks (about 94 hours) and a 12x advantage over refining.
  //
  // LIVE DATA SAYS TWO SLOTS, NOT THREE. FACILITIES.fabricator has exactly two rungs
  // (upgrades[0], the pre-granted founding rung, and upgrades[1], the level 1->2 rung),
  // each granting { addFabricateSlots: 1 }, so fabricateSlotCount tops out at 2. There
  // is no talent, and no other track, that grants a fabricate slot (HomeworldTalentEffect
  // has no such member). The design appears to have assumed the Fabricator matched the
  // Refinery's three slots; the Refinery's three IS correct.
  //
  // CONSEQUENCE: Route B runs at 12 XP per tick, not 18, so it takes 509,600 ticks
  // (about 142 hours) and the advantage over refining is 8x, not 12x.
  //
  // THE DESIGN'S CONCLUSION SURVIVES INTACT. Eight times faster, against a road that
  // also needs twenty warehouses of ore it cannot hold, still means bulk refining
  // contributes without being able to lead. Only the two quoted figures are wrong.
  //
  // NOT SILENTLY ADJUSTED: the tests below assert the LIVE numbers, and the test after
  // them pins the design's own arithmetic so the error is provably the slot count and
  // not the formula. Whether to retune (a third Fabricator rung, or a higher weight) is
  // a balance call for the owner, not a thing to paper over here.
  // ==========================================================================

  it("Route B, tier-2 equipment fabrication: 2 LIVE slots, 12 XP per tick, about 142 hours", () => {
    const fabSlots = fabricateSlotCount(maxedFacilities());
    expect(fabSlots).toBe(2); // ⚠️ design 6.4 says three; see the block above

    const perSlotPerTick = craftingXpPerTick(fabricateSubject(T2_EQUIPMENT_BP));
    expect(perSlotPerTick).toBe(6); // this half of the design IS right

    const routeBRate = fabSlots * perSlotPerTick;
    expect(routeBRate).toBe(12); // ⚠️ design says 18

    const routeBTicks = XP_TO_TARGET / routeBRate;
    expect(routeBTicks).toBe(509600); // ⚠️ design says 339,733

    const routeBHours = (routeBTicks * SECONDS_PER_TICK) / 3600;
    expect(Math.round(routeBHours)).toBe(142); // ⚠️ design says about 94
  });

  it("the LIVE advantage of fabricating over refining is 8x", () => {
    const routeARate = refineSlotCount(maxedFacilities()) * craftingXpPerTick(refineSubject(REFINE_COMMON_ORE));
    const routeBRate = fabricateSlotCount(maxedFacilities()) * craftingXpPerTick(fabricateSubject(T2_EQUIPMENT_BP));
    expect(routeBRate / routeARate).toBe(8); // ⚠️ design claims 12x
  });

  it("the design's own arithmetic is self-consistent, so the error is the slot count and nothing else", () => {
    // Given the design's assumed three fabricate slots, every figure it quotes follows.
    // Pinning that here isolates the discrepancy to one input.
    const assumedSlots = 3;
    const assumedRate = assumedSlots * craftingXpPerTick(fabricateSubject(T2_EQUIPMENT_BP));
    expect(assumedRate).toBe(18);
    expect(Math.floor(XP_TO_TARGET / assumedRate)).toBe(339733);
    expect(Math.round((XP_TO_TARGET / assumedRate) / 3600)).toBe(94);
    const routeARate = 3 * craftingXpPerTick(refineSubject(REFINE_COMMON_ORE));
    expect(assumedRate / routeARate).toBe(12);
  });

  it("THE REQUIREMENT: refining cannot lead, on either the time axis or the materials axis", () => {
    // Stated slot-count-agnostically, so a Fabricator retune cannot quietly invalidate
    // the guarantee this whole weight model exists to provide.
    const state = maxedFacilities();
    const refineRate = refineSlotCount(state) * craftingXpPerTick(refineSubject(REFINE_COMMON_ORE));
    const fabricateRate = fabricateSlotCount(state) * craftingXpPerTick(fabricateSubject(T2_EQUIPMENT_BP));

    // Time: fabricating must be at least several times faster than refining.
    expect(fabricateRate / refineRate).toBeGreaterThanOrEqual(8);

    // Materials: the refining road must exceed the warehouse ore cap by an order of
    // magnitude, so it is blocked by physics and not only by patience.
    const jobs = XP_TO_TARGET / craftingXpAwardFor(refineSubject(REFINE_COMMON_ORE), REFINE_COMMON_ORE.durationTicks);
    const oreNeeded = jobs * REFINE_COMMON_ORE.input.commonOre.toNumber();
    expect(oreNeeded / WAREHOUSE_T1_BASE_CAP).toBeGreaterThan(10);

    // And refining is NOT zero: it still moves the bar, which is the other half of the
    // requirement (contribute without leading).
    expect(refineRate).toBeGreaterThan(0);
  });

  it("intermediate case: tier-1 component fabrication matches the top route's rate per slot pair", () => {
    // The design's own cross check, that a player crafting the components they actually
    // need is not punished relative to chasing tier-2 equipment.
    // Two slots of tier-1 material at 2.0 per tick is 4 per tick; two slots of tier-2
    // material is 8; the design's "6 XP per tick" figure for this case again assumed
    // three slots. Assert the per-slot rates, which are slot-count independent.
    expect(craftingXpPerTick(fabricateSubject(T1_MATERIAL_BP))).toBe(2);
    expect(craftingXpPerTick(fabricateSubject(T2_MATERIAL_BP))).toBe(4);
    // Either beats refining per slot by a wide margin, which is the point being checked.
    expect(craftingXpPerTick(fabricateSubject(T1_MATERIAL_BP)))
      .toBeGreaterThan(craftingXpPerTick(refineSubject(REFINE_COMMON_ORE)) * 3);
  });
});

// ============================================================================
// 4. Integer exactness and monotonicity
// ============================================================================

describe("craftingXpAward: integer arithmetic on purpose", () => {
  it("implements floor(durationTicks * rate * weightNum / DENOM) exactly", () => {
    for (const ticks of [1, 3, 7, 12, 13, 20, 99, 120, 300, 1200]) {
      for (const weight of [1, 4, 6, 8, 12, 24]) {
        const expected = Math.floor((ticks * CRAFTING_XP_PER_DURATION_TICK * weight) / CRAFTING_XP_WEIGHT_DENOM);
        expect(craftingXpAward(ticks, weight)).toBe(expected);
      }
    }
  });

  it("always returns a whole number, including on the odd-tick cases where the floor bites", () => {
    // Weight 1 over denominator 4 with rate 2 means an ODD tick count loses a half point.
    // That is the only place the floor can act, and it must act cleanly.
    expect(craftingXpAward(13, REFINE_XP_WEIGHT_NUM)).toBe(6); // 13 * 2 * 1 / 4 = 6.5 -> 6
    expect(craftingXpAward(1, REFINE_XP_WEIGHT_NUM)).toBe(0);  // a 1-tick refine rounds to nothing
    for (let ticks = 1; ticks <= 400; ticks++) {
      for (const weight of [1, 4, 6, 8, 12]) {
        expect(Number.isInteger(craftingXpAward(ticks, weight))).toBe(true);
      }
    }
  });

  it("accumulates over 100,000 awards with ZERO drift from the exact integer total", () => {
    // The property offline==live parity rests on: many small awards summed in any order
    // land on the same integer a single closed-form computation does. A float multiplier
    // is exactly what would break this.
    const runs = 100_000;
    const ticks = REFINE_COMMON_ORE.durationTicks;
    const perJob = craftingXpAwardFor(refineSubject(REFINE_COMMON_ORE), ticks);
    let accumulated = 0;
    for (let i = 0; i < runs; i++) accumulated += perJob;
    expect(accumulated).toBe(perJob * runs);
    expect(Number.isInteger(accumulated)).toBe(true);
    expect(BigInt(accumulated)).toBe(BigInt(perJob) * BigInt(runs));
  });

  it("accumulates a MIXED workload with zero drift", () => {
    const workload: [CraftingXpSubject, number][] = [
      [refineSubject(REFINE_COMMON_ORE), 12],
      [refineSubject(REFINE_WAFER), 20],
      [fabricateSubject(T1_MATERIAL_BP), 120],
      [fabricateSubject(T2_EQUIPMENT_BP), 300],
      [SHIP_BUILD_SUBJECT, 1200],
    ];
    let total = 0;
    let oracle = 0n;
    for (let i = 0; i < 20_000; i++) {
      const [subject, ticks] = workload[i % workload.length];
      const award = craftingXpAwardFor(subject, ticks);
      total += award;
      oracle += BigInt(award);
    }
    expect(BigInt(total)).toBe(oracle);
  });

  it("is defensive: non-finite, negative or zero inputs award 0 rather than NaN", () => {
    expect(craftingXpAward(Number.NaN, 4)).toBe(0);
    expect(craftingXpAward(120, Number.NaN)).toBe(0);
    expect(craftingXpAward(-120, 4)).toBe(0);
    expect(craftingXpAward(120, -4)).toBe(0);
    expect(craftingXpAward(0, 4)).toBe(0);
    expect(craftingXpAward(Number.POSITIVE_INFINITY, 4)).toBe(0);
  });
});

describe("monotonicity: more work, or more valuable work, is never worth less", () => {
  it("award is non-decreasing in durationTicks", () => {
    for (const weight of [1, 4, 6, 8, 12]) {
      let previous = 0;
      for (let ticks = 0; ticks <= 500; ticks++) {
        const award = craftingXpAward(ticks, weight);
        expect(award).toBeGreaterThanOrEqual(previous);
        previous = award;
      }
    }
  });

  it("award is non-decreasing in weightNum", () => {
    for (const ticks of [1, 7, 12, 120, 300, 1200]) {
      let previous = 0;
      for (let weight = 0; weight <= 40; weight++) {
        const award = craftingXpAward(ticks, weight);
        expect(award).toBeGreaterThanOrEqual(previous);
        previous = award;
      }
    }
  });

  it("a higher blueprint tier is never worth less than a lower one", () => {
    expect(craftingXpAwardFor(fabricateSubject(T2_MATERIAL_BP), 120))
      .toBeGreaterThan(craftingXpAwardFor(fabricateSubject(T1_MATERIAL_BP), 120));
    expect(craftingXpAwardFor(fabricateSubject(T2_EQUIPMENT_BP), 120))
      .toBeGreaterThan(craftingXpAwardFor(fabricateSubject(T1_EQUIPMENT_BP), 120));
  });

  it("instance-minting always beats material at the same tier, which is why crafting level feeds iLevel", () => {
    expect(craftingXpAwardFor(fabricateSubject(T1_EQUIPMENT_BP), 120))
      .toBeGreaterThan(craftingXpAwardFor(fabricateSubject(T1_MATERIAL_BP), 120));
    expect(craftingXpAwardFor(fabricateSubject(T2_EQUIPMENT_BP), 300))
      .toBeGreaterThan(craftingXpAwardFor(fabricateSubject(T2_MATERIAL_BP), 300));
  });
});

describe("a facility SPEED multiplier changes XP per job, not XP per unit time", () => {
  // Design 6.1's stated property: speed upgrades should raise throughput, not XP rate.
  // The award is proportional to durationTicks, so halving a job's length halves its
  // award and the player simply runs twice as many jobs.
  //
  // ⚠️ BUILD-TIME FINDING. Design 6.1 says to "verify at build time that the speed
  // multiplier is applied to durationTicks at start (it is, in the line engine's duration
  // derivation)". It is NOT. FACILITIES.refinery's rung-3 { refineSpeedMult: 1.5 } is
  // declared and RENDERED (App.svelte's upgrade description) but read by no engine code:
  // grepping refineSpeedMult across src finds the type member, the data row, three
  // comments and one template string, and no duration derivation. It is a
  // populated-but-inert effect. Reported, not fixed: making it live is a balance and
  // engine change well outside a pure XP module.
  //
  // The property below therefore tests the INVARIANT directly (award scales with
  // duration), which is what makes the design's conclusion hold whenever the multiplier
  // does become live.
  it("a 1.5x speed multiplier yields the same XP per tick of wall time", () => {
    const subject = fabricateSubject(T2_EQUIPMENT_BP);
    const baseTicks = 300;
    const spedUpTicks = baseTicks / 1.5; // 200

    const baseAward = craftingXpAwardFor(subject, baseTicks);
    const spedUpAward = craftingXpAwardFor(subject, spedUpTicks);

    expect(spedUpAward).toBeLessThan(baseAward);          // less XP per JOB
    expect(baseAward / baseTicks).toBe(spedUpAward / spedUpTicks); // same XP per TICK
    expect(baseAward / baseTicks).toBe(craftingXpPerTick(subject));
  });

  it("three short jobs pay exactly what one job of the same total length pays", () => {
    const subject = refineSubject(REFINE_COMMON_ORE);
    const oneLong = craftingXpAwardFor(subject, 36);
    const threeShort = 3 * craftingXpAwardFor(subject, 12);
    expect(threeShort).toBe(oneLong);
  });
});

// ============================================================================
// 5. Mechanical guards
// ============================================================================

describe("RefineRecipeDef.xpWeightNum, the per-recipe tuning knob", () => {
  it("is ABSENT on both shipped recipes, so both sit on the default weight", () => {
    // Design 6.1's explicit recommendation: add the knob, differentiate nothing yet.
    for (const [key, recipe] of Object.entries(REFINE_RECIPES)) {
      expect(recipe.xpWeightNum, `${key}.xpWeightNum`).toBeUndefined();
      expect(craftingXpWeightNum(refineSubject(recipe))).toBe(REFINE_XP_WEIGHT_NUM);
    }
  });

  it("an override is honoured, so a future tier-2 refine recipe declares its own worth in the data table", () => {
    const richRecipe: RefineRecipeDef = { ...REFINE_COMMON_ORE, xpWeightNum: 4 };
    expect(craftingXpWeightNum(refineSubject(richRecipe))).toBe(4);
    expect(craftingXpAwardFor(refineSubject(richRecipe), 12)).toBe(24); // 4x the default row
  });

  it("an override of 0 is respected (a recipe may legitimately be declared worthless)", () => {
    const worthless: RefineRecipeDef = { ...REFINE_COMMON_ORE, xpWeightNum: 0 };
    expect(craftingXpWeightNum(refineSubject(worthless))).toBe(0);
    expect(craftingXpAwardFor(refineSubject(worthless), 1200)).toBe(0);
  });

  it("a nonsense override falls back to the default rather than poisoning a persisted XP total", () => {
    for (const bad of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      const recipe: RefineRecipeDef = { ...REFINE_COMMON_ORE, xpWeightNum: bad };
      expect(craftingXpWeightNum(refineSubject(recipe))).toBe(REFINE_XP_WEIGHT_NUM);
    }
  });

  it("a blueprint with a nonsense tier prices at zero, not at the tier-1 baseline", () => {
    for (const bad of [Number.NaN, -2, 0]) {
      const bp: BlueprintDef = { ...T1_MATERIAL_BP, tier: bad };
      expect(craftingXpWeightNum(fabricateSubject(bp))).toBe(0);
    }
  });
});

describe("craftingXpSubjectForProcess: resolving a completed process to its weight", () => {
  it("resolves a refine job from its output item", () => {
    const process = processOf("refineJob", 12, {
      type: "addItem",
      itemId: REFINE_COMMON_ORE.output.itemId,
      amount: REFINE_COMMON_ORE.output.amount,
    });
    const subject = craftingXpSubjectForProcess(process);
    expect(subject.kind).toBe("refine");
    expect(craftingXpAwardForProcess(process)).toBe(6);
  });

  it("resolves a MATERIAL fabricate from its output item", () => {
    const process = processOf("fabricateJob", 120, {
      type: "addItem",
      itemId: T1_MATERIAL_BP.recipe.outputItem as string,
      amount: new Decimal(1),
    });
    const subject = craftingXpSubjectForProcess(process);
    expect(subject).toEqual({ kind: "fabricate", blueprint: T1_MATERIAL_BP });
    expect(craftingXpAwardForProcess(process)).toBe(240);
  });

  it("resolves an INSTANCE-MINTING fabricate from the blueprintKey the effect already carries", () => {
    const process = processOf("fabricateJob", 300, { type: "addEquipment", blueprintKey: "gravitonBp" });
    expect(craftingXpSubjectForProcess(process)).toEqual({ kind: "fabricate", blueprint: T2_EQUIPMENT_BP });
    expect(craftingXpAwardForProcess(process)).toBe(1800);
  });

  it("resolves a ship build", () => {
    const process = processOf("shipBuild", 1200, { type: "addShip", typeKey: "battleship" });
    expect(craftingXpSubjectForProcess(process)).toEqual({ kind: "shipBuild" });
    expect(craftingXpAwardForProcess(process)).toBe(7200);
  });

  it("every non-production kind resolves to none and awards 0", () => {
    // Mirrors PROCESS_XP_AWARDS' crafting:false rows (tick.ts). That table decides
    // WHETHER a kind pays; this function decides HOW MUCH. They must not disagree.
    const nonProduction: TimedProcessKind[] = [
      "facilityUpgrade",
      "fuelRefineJob",
      "researchProject",
      "equipmentStorageUpgrade",
      "docksExpansion",
      "shipRepair",
      "salvageJob",
    ];
    for (const kind of nonProduction) {
      const process = processOf(kind, 1200, { type: "facilityLevelUp", facility: "refinery" });
      expect(craftingXpSubjectForProcess(process), kind).toEqual({ kind: "none" });
      expect(craftingXpAwardForProcess(process), kind).toBe(0);
    }
  });

  it("an unresolvable job degrades safely instead of throwing", () => {
    // A refine job whose output is not in any recipe still prices at the default refine
    // weight (correct for every recipe that exists), and a fabricate whose blueprint
    // cannot be found pays nothing rather than guessing.
    const orphanRefine = processOf("refineJob", 12, { type: "addItem", itemId: "notARecipeOutput", amount: new Decimal(1) });
    expect(craftingXpAwardForProcess(orphanRefine)).toBe(6);

    const orphanFabricate = processOf("fabricateJob", 300, { type: "addEquipment", blueprintKey: "noSuchBlueprint" });
    expect(craftingXpAwardForProcess(orphanFabricate)).toBe(0);

    const orphanMaterial = processOf("fabricateJob", 300, { type: "addItem", itemId: "notABlueprintOutput", amount: new Decimal(1) });
    expect(craftingXpAwardForProcess(orphanMaterial)).toBe(0);
  });

  it("the reverse index is UNAMBIGUOUS today: no two refine recipes, and no two material blueprints, share an output", () => {
    // The assumption the output-item reverse lookup rests on. When this fails, the fix is
    // to carry a source key on the TimedProcess, not to pick a winner here.
    const refineOutputs = Object.values(REFINE_RECIPES).map((r) => r.output.itemId);
    expect(new Set(refineOutputs).size).toBe(refineOutputs.length);

    const materialOutputs = Object.values(BLUEPRINTS)
      .filter((bp) => !blueprintMintsEquipmentInstance(bp) && typeof bp.recipe.outputItem === "string")
      .map((bp) => bp.recipe.outputItem as string);
    expect(new Set(materialOutputs).size).toBe(materialOutputs.length);
  });
});

describe("readouts for the Phase 4 consoles", () => {
  it("craftingLevelProgress reads the stored remainder, which is why a curve retune cannot demote anybody", () => {
    // GameState.craftingXp holds the remainder INSIDE the current level (applyCraftingXp
    // subtracts each threshold as it is crossed), so the readout needs no cumulative
    // bookkeeping and no back-derivation of level from a lifetime total. That is exactly
    // the grandfathering guarantee of design 6.5, visible in the data shape.
    const progress = craftingLevelProgress({ craftingLevel: 10, craftingXp: new Decimal(4500) });
    expect(progress.level).toBe(10);
    expect(progress.xpIntoLevel.toNumber()).toBe(4500);
    expect(progress.xpForNextLevel.toNumber()).toBe(18000);
    expect(progress.fraction).toBeCloseTo(0.25, 10);
  });

  it("craftingLevelProgress clamps its fraction to 0..1 even with a backlog above the threshold", () => {
    // A capped level-up pass (MAX_LEVEL_UPS_PER_TICK) can legitimately leave craftingXp
    // at or above the next threshold, so the bar must not overflow.
    const over = craftingLevelProgress({ craftingLevel: 1, craftingXp: new Decimal(999999) });
    expect(over.fraction).toBe(1);
    const fresh = craftingLevelProgress({ craftingLevel: 1, craftingXp: new Decimal(0) });
    expect(fresh.fraction).toBe(0);
  });

  it("a fresh save reads as level 1 with an empty bar", () => {
    const state = freshState();
    const progress = craftingLevelProgress(state);
    expect(progress.level).toBe(1);
    expect(progress.xpForNextLevel.toNumber()).toBe(126);
    expect(progress.fraction).toBe(0);
  });

  it("itemLevelCeilingForTier is the hard tier cap: 20 per tier, 40 at tier 2", () => {
    expect(itemLevelCeilingForTier(1)).toBe(20);
    expect(itemLevelCeilingForTier(2)).toBe(40);
    expect(itemLevelCeilingForTier(0)).toBe(0);
  });

  it("craftedItemLevelReadout reports the current roll, the ceiling, and whether more levels still help", () => {
    const below = craftedItemLevelReadout({ craftingLevel: 12, blueprintTier: 1 });
    expect(below).toEqual({ iLevel: 12, ceiling: 20, atCeiling: false });

    const capped = craftedItemLevelReadout({ craftingLevel: 35, blueprintTier: 1 });
    expect(capped).toEqual({ iLevel: 20, ceiling: 20, atCeiling: true });

    const tier2 = craftedItemLevelReadout({ craftingLevel: 35, blueprintTier: 2 });
    expect(tier2).toEqual({ iLevel: 35, ceiling: 40, atCeiling: false });
  });

  it("the ceiling is HARD: no bonus can push a craft past its blueprint tier's cap", () => {
    // Design 6.5's content-integrity guarantee, asserted here as a readout property.
    // Unit 3.3 wires the talent that supplies faTalentBonus; the cap must hold then too.
    const boosted = craftedItemLevelReadout({
      craftingLevel: 40,
      blueprintTier: 1,
      achievementBoost: 50,
      faTalentBonus: 50,
    });
    expect(boosted.iLevel).toBe(20);
    expect(boosted.atCeiling).toBe(true);
  });

  it("reaching the tier-2 ceiling needs crafting level 40 with no bonuses, which is what the worked proof prices", () => {
    expect(craftedItemLevelReadout({ craftingLevel: 39, blueprintTier: 2 }).atCeiling).toBe(false);
    expect(craftedItemLevelReadout({ craftingLevel: 40, blueprintTier: 2 }).atCeiling).toBe(true);
  });
});
