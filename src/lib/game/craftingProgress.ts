// ============================================================================
// craftingProgress.ts: the pure crafting-XP weight model, level curve and readouts
// Crafting 0.13.3, Phase 3 Unit 3.1
// Author: Claude (Opus 5) | 2026-09-01
// Design: docs/plans/2026-09-01-crafting-0.13.3-design.md (section 6, tables 6.2
//         and 6.3, and the worked proof in 6.4).
// Build plan: docs/plans/2026-09-01-crafting-0.13.3-plan.md (Phase 3 Unit 3.1).
//
// ----------------------------------------------------------------------------
// WHY THIS MODULE EXISTS: the bulk-refining failure mode
// ----------------------------------------------------------------------------
// Crafting level drives the iLevel of everything the Fabricator mints, so it has to
// be fed by ALL crafting, refining included. The trap is that refining is the
// cheapest, fastest, most repeatable crafting there is: it needs no research, no
// blueprint and no components, its feedstock falls out of every mission, and a job
// finishes in a dozen ticks. Under the pre-0.13.3 flat award (every kind paid the
// same XP per tick) the optimal way to reach the iLevel ceiling was to ignore the
// Fabricator entirely and grind ore. That is the exact opposite of the intent: the
// stat that governs crafted gear should be earned by crafting gear.
//
// The fix is a WEIGHT per recipe kind and tier, not a ban. Refining still pays, it
// simply pays a quarter of the base rate while equipment fabrication pays six
// quarters per blueprint tier. Two consequences fall out, both proven as executable
// tests in craftingProgress.test.ts rather than asserted here in prose:
//   1. TIME. Reaching the current iLevel ceiling by pure refining takes many times
//      longer than by fabricating tier-2 equipment.
//   2. MATERIALS. The refining route needs more ore than the warehouse can hold, by
//      more than an order of magnitude, so it is not merely slow, it is not a road.
// Refining is not punished and is not zero. It just cannot lead.
//
// ----------------------------------------------------------------------------
// WHY THE MATH IS INTEGER
// ----------------------------------------------------------------------------
// Weights are numerators over a shared denominator (CRAFTING_XP_WEIGHT_DENOM = 4),
// never fractional multipliers. So an award is
//
//     floor( durationTicks * CRAFTING_XP_PER_DURATION_TICK * weightNum / DENOM )
//
// where all three factors are integers and the SINGLE division floors once at the
// end. The result is exactly an integer, on every platform, in every order.
//
// This is not fastidiousness, it is a load-bearing property the codebase already
// paid for. Offline catch-up is closed form: one resolve of N ticks has to land on
// the same state as N resolves of one tick, and the parity suite compares the two
// paths deep-equal. A 0.25 multiplier written as a float would make the award
// order-dependent in the last bits and turn those parity tests into a coin flip.
// CRAFTING_XP_PER_DURATION_TICK's own comment in model.ts calls that out explicitly;
// this module inherits the rule rather than reopening it.
//
// ----------------------------------------------------------------------------
// PURE MODULE
// ----------------------------------------------------------------------------
// No Svelte, no DOM, no side effects, no rng, no clock, no mutation of anything it
// is handed. Same posture as craftQueue.ts, homeDashboard.ts and shipRoster.ts.
// Everything here is a function of static content data plus plain numbers, so the
// live path and the offline path compute identical results by construction.
//
// SCOPE FENCE (updated by Unit 3.2, which wired the award in):
//   - ✅ resolveProcesses (tick.ts) now awards craftingXpAwardForProcess. That is the
//     ONE call site of this module's award path, and the only one it should ever have.
//   - computeItemLevel is untouched. Unit 3.3 adds the craftingItemLevel talent.
//   - the readouts below exist for the Phase 4 consoles; nothing renders them yet.
//
// Project punctuation rule: no em dashes, and no doubled hyphens standing in for
// one. Commas, colons, periods and parentheses only. (The // --- rules --- below
// are section dividers, which is the one sanctioned use.)
// ============================================================================

import Decimal from "break_infinity.js";
import {
  BLUEPRINTS,
  REFINE_RECIPES,
  CRAFTING_XP_PER_DURATION_TICK,
  CRAFTING_XP_WEIGHT_DENOM,
  REFINE_XP_WEIGHT_NUM,
  MATERIAL_FABRICATE_XP_WEIGHT_NUM_PER_TIER,
  EQUIPMENT_FABRICATE_XP_WEIGHT_NUM_PER_TIER,
  SHIP_BUILD_XP_WEIGHT_NUM,
  craftingXpForNext,
  blueprintMintsEquipmentInstance,
  type BlueprintDef,
  type RefineRecipeDef,
  type GameState,
  type TimedProcess,
  type TimedProcessKind,
} from "./model";
import { EQUIPMENT_ILEVEL_CAP_PER_TIER, computeItemLevel } from "./itemgen";

// Re-exported so a consumer needs ONE import for the whole crafting-progress story
// (curve plus weights plus readouts) instead of reaching into model.ts for half of
// it. The curve itself deliberately still LIVES in model.ts beside
// CRAFTING_XP_PER_DURATION_TICK, where applyCraftingXp (tick.ts) reads it directly.
// This is a re-export, not a second copy: there is exactly one curve in the codebase
// and it is the one below.
//
// ⚠️ DEPENDENCY DIRECTION (corrected by Unit 3.2, which made tick.ts an importer).
// This module sits ABOVE model.ts and itemgen.ts and BELOW tick.ts: tick.ts imports
// craftingXpAwardForProcess from here, and this file imports nothing from tick.ts, so
// the arrow is one-way and there is no cycle. Do not confuse that with craftQueue.ts,
// which is a VIEW model that imports FROM tick.ts and therefore must never be imported
// BY it. The rule both files obey is the same one (arrows point one way); the two files
// simply sit on opposite sides of the engine.
export { craftingXpForNext };

// ============================================================================
// --- The weight model (design section 6.1) ----------------------------------
// ============================================================================

// What a completed job IS, for XP purposes. A discriminated union rather than a bare
// process kind because two of the four arms need the recipe or blueprint in hand to
// price the job: a refine recipe may carry its own xpWeightNum, and a blueprint's
// weight depends on its tier and on whether it mints an instance.
//
// The "none" arm is a real answer, not a failure: most timed processes (facility
// upgrades, research, fuel batches, storage expansions, repairs, salvage) are not
// production and pay no crafting XP at all. Making that an explicit arm means a
// caller can never confuse "this kind earns nothing" with "I could not work out what
// this is".
export type CraftingXpSubject =
  | { kind: "refine"; recipe: RefineRecipeDef }
  | { kind: "fabricate"; blueprint: BlueprintDef }
  | { kind: "shipBuild" }
  | { kind: "none" };

// A weight numerator, in quarters of CRAFTING_XP_PER_DURATION_TICK.
//
// THE TABLE (design 6.1), and the reasoning for each row:
//   refine        REFINE_XP_WEIGHT_NUM (1, so 0.25x). The bulk source named above.
//                 A recipe may override via xpWeightNum; none currently does.
//   fabricate     4 x tier for a MATERIAL blueprint (1.0x per tier, tier 1 landing
//                 exactly on the old flat rate so known pacing is the anchor), and
//                 6 x tier for one that MINTS AN INSTANCE (1.5x per tier). The split
//                 is read from blueprintMintsEquipmentInstance, the predicate the
//                 Fabricator's own gates already use, so equipment, weapon and drone
//                 blueprints all price the same way with no second classification to
//                 keep in sync.
//   shipBuild     SHIP_BUILD_XP_WEIGHT_NUM (12, so 3.0x), flat. A hull already
//                 scales its own reward through a far longer durationTicks; a tier
//                 multiplier on top would count the size twice.
//   none          0.
//
// DEFENSIVE ON THE DATA IT READS. A blueprint tier or a recipe override arriving as
// undefined, negative, NaN or fractional would otherwise propagate a garbage award
// into a persisted XP total. Each is clamped to a sane non-negative integer here, at
// the one place that reads it, rather than trusted.
export function craftingXpWeightNum(subject: CraftingXpSubject): number {
  switch (subject.kind) {
    case "refine": {
      // Absent is the NORMAL case (design 6.1 recommends adding the knob but leaving
      // both shipped recipes on the default), so an absent field is not a fallback
      // for bad data, it IS the data. A present-but-nonsense value still falls back.
      const override = subject.recipe.xpWeightNum;
      if (override === undefined) return REFINE_XP_WEIGHT_NUM;
      return safeWeightNum(override, REFINE_XP_WEIGHT_NUM);
    }
    case "fabricate": {
      const tier = safeTier(subject.blueprint.tier);
      const perTier = blueprintMintsEquipmentInstance(subject.blueprint)
        ? EQUIPMENT_FABRICATE_XP_WEIGHT_NUM_PER_TIER
        : MATERIAL_FABRICATE_XP_WEIGHT_NUM_PER_TIER;
      return perTier * tier;
    }
    case "shipBuild":
      return SHIP_BUILD_XP_WEIGHT_NUM;
    case "none":
      return 0;
  }
}

// A tier that is missing, fractional, negative or NaN prices as tier 0 (no XP) rather
// than as tier 1 (free XP): an unclassifiable blueprint should pay nothing, not pay
// the baseline. Every real blueprint in BLUEPRINTS carries a positive integer tier
// (asserted in model.test.ts), so this only ever fires on corrupt data.
function safeTier(tier: number): number {
  if (!Number.isFinite(tier) || tier <= 0) return 0;
  return Math.floor(tier);
}

// A recipe override that is not a non-negative integer falls back to the default
// weight. Zero IS allowed (a future recipe may legitimately be declared worthless).
function safeWeightNum(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value < 0) return fallback;
  return Math.floor(value);
}

// THE award. `floor(durationTicks * rate * weightNum / DENOM)`, exactly as design 6.1
// specifies, with the single division and the single floor at the end.
//
// INTEGER ON PURPOSE (see this file's header): all three factors are integers, so the
// product is exact well inside the 2^53 safe range (the longest job in the game is
// 1,200 ticks and the largest weight is 24, giving a product of 57,600) and the one
// division floors deterministically. Never rewrite this as a float multiplier.
//
// Defensive: a non-finite or non-positive duration awards 0. A duration of 0 is a real
// state (the Fabricator's founding rung is a zero-tick process) and 0 XP is the right
// answer for it, so this needs no special case beyond the guard.
export function craftingXpAward(durationTicks: number, weightNum: number): number {
  if (!Number.isFinite(durationTicks) || durationTicks <= 0) return 0;
  if (!Number.isFinite(weightNum) || weightNum <= 0) return 0;
  const ticks = Math.floor(durationTicks);
  return Math.floor((ticks * CRAFTING_XP_PER_DURATION_TICK * weightNum) / CRAFTING_XP_WEIGHT_DENOM);
}

// The one call the award path wants: price a subject's job of a given length.
export function craftingXpAwardFor(subject: CraftingXpSubject, durationTicks: number): number {
  return craftingXpAward(durationTicks, craftingXpWeightNum(subject));
}

// XP PER TICK for a subject, as a display number (design table 6.2's last column, and
// what the Phase 4 consoles want next to a recipe: "this job is worth 6 XP per tick").
//
// ⚠️ FLOAT, and deliberately so: 0.5 XP per tick is a true statement about a refine job
// and there is no integer that says it. This is a READOUT. It must never feed an award:
// the award is craftingXpAward and only craftingXpAward, whose floor can and does shave
// a fraction off this rate on an odd-length job (a 13-tick refine pays 6, not 6.5).
export function craftingXpPerTick(subject: CraftingXpSubject): number {
  return (craftingXpWeightNum(subject) * CRAFTING_XP_PER_DURATION_TICK) / CRAFTING_XP_WEIGHT_DENOM;
}

// ============================================================================
// --- Resolving a live process to its subject --------------------------------
// ============================================================================
//
// ⚠️ BUILD-TIME FINDING from Unit 3.1, CONSUMED AS DESIGNED by Unit 3.2 (Omega 8: no
// silent assumptions). 3.2 wired the award through this bridge and did NOT add a
// sourceKey to TimedProcess, because that is a save-shape change and is only warranted
// the day outputs actually collide. The guard below is what tells us that day arrived.
// Design 6.1 says the weight is read off the blueprint and needs "no data change".
// That is true for an EQUIPMENT fabricate, whose completion effect carries
// { type: "addEquipment", blueprintKey }. It is NOT true for the other two producing
// kinds: a MATERIAL fabricate and a refine job both complete with a bare
// { type: "addItem", itemId }, and a TimedProcess carries no recipe or blueprint key
// of its own (see TimedProcess in model.ts: id, kind, ticks, effect, optional lineId).
// So the completed process cannot name what produced it.
//
// This module bridges that with a REVERSE INDEX from output item to the recipe or
// blueprint that makes it, built once at module load from the static tables. That is
// sound today because every producing recipe and every material blueprint has a
// distinct output item (asserted in craftingProgress.test.ts, which fails loudly the
// day someone adds a second recipe for the same output). It is not sound forever.
//
// THE DURABLE FIX, if a future recipe ever collides: carry the source key on the
// process (a `sourceKey` beside `lineId`) so the award reads it directly instead of
// inferring it. That is a save-shape change and is out of Unit 3.1's scope, so it is
// logged here rather than done. The ambiguity guard below degrades to the safe answer
// in the meantime.

// Output item id -> the refine recipe producing it, or null when two recipes claim the
// same output (ambiguous, so we refuse to guess). Built once; never mutated after.
const REFINE_RECIPE_BY_OUTPUT: ReadonlyMap<string, RefineRecipeDef | null> = buildOutputIndex(
  Object.values(REFINE_RECIPES).map((recipe) => [recipe.output.itemId, recipe] as const),
);

// Output item id -> the MATERIAL blueprint producing it, or null when ambiguous.
// Instance-minting blueprints are excluded on purpose: they produce no stackable item,
// so they have no output id to index, and they are resolved by blueprintKey instead.
const MATERIAL_BLUEPRINT_BY_OUTPUT: ReadonlyMap<string, BlueprintDef | null> = buildOutputIndex(
  Object.values(BLUEPRINTS)
    .filter((bp) => !blueprintMintsEquipmentInstance(bp) && typeof bp.recipe.outputItem === "string")
    .map((bp) => [bp.recipe.outputItem as string, bp] as const),
);

// Shared index builder: first entry wins, a SECOND entry for the same key poisons that
// key to null. Poisoning rather than first-wins-silently is the point: an ambiguous key
// should visibly fall back to the default weight, not quietly price every job as
// whichever recipe happened to be declared first.
function buildOutputIndex<T>(entries: readonly (readonly [string, T])[]): ReadonlyMap<string, T | null> {
  const index = new Map<string, T | null>();
  for (const [key, value] of entries) {
    index.set(key, index.has(key) ? null : value);
  }
  return index;
}

// What did this completed process produce, for XP purposes?
//
// EXHAUSTIVE over TimedProcessKind with no default branch, so adding a kind to the
// union is a COMPILE ERROR here. That is the same guard PROCESS_XP_AWARDS (tick.ts)
// gives the "does this kind pay at all" question, and the two must agree: that table
// decides WHETHER a kind feeds the crafting axis, this function decides HOW MUCH. A
// kind marked crafting:true there and "none" here would pay nothing; a kind marked
// crafting:false there is never asked. Unit 3.2 wired the two together and kept BOTH:
// the `if (xpAward.crafting)` gate in resolveProcesses is what makes salvageJob's zero a
// LOCK rather than a weight some later retune could nudge off zero.
export function craftingXpSubjectForProcess(process: TimedProcess): CraftingXpSubject {
  const kind: TimedProcessKind = process.kind;
  switch (kind) {
    case "refineJob": {
      // An unknown or ambiguous output falls back to a plain refine at the default
      // weight, which is the correct price for every recipe that exists today anyway.
      const recipe =
        process.effect.type === "addItem" ? REFINE_RECIPE_BY_OUTPUT.get(process.effect.itemId) : undefined;
      return { kind: "refine", recipe: recipe ?? FALLBACK_REFINE_RECIPE };
    }
    case "fabricateJob": {
      if (process.effect.type === "addEquipment") {
        const bp = BLUEPRINTS[process.effect.blueprintKey];
        // A blueprintKey with no definition (a hand-edited save, or a retired
        // blueprint still in flight across an upgrade) pays nothing rather than
        // throwing: an unresolvable job must not be able to break a tick.
        return bp ? { kind: "fabricate", blueprint: bp } : { kind: "none" };
      }
      if (process.effect.type === "addItem") {
        const bp = MATERIAL_BLUEPRINT_BY_OUTPUT.get(process.effect.itemId);
        return bp ? { kind: "fabricate", blueprint: bp } : { kind: "none" };
      }
      return { kind: "none" };
    }
    case "shipBuild":
      return { kind: "shipBuild" };
    // Everything below is not production and pays no crafting XP (design 6.1's
    // "everything else" row, matching PROCESS_XP_AWARDS' crafting:false rows).
    case "facilityUpgrade":
    case "fuelRefineJob":
    case "researchProject":
    case "equipmentStorageUpgrade":
    case "docksExpansion":
    case "shipRepair":
    case "salvageJob":
      return { kind: "none" };
  }
}

// The default-weight stand-in used when a refine job's recipe cannot be identified.
// Frozen so nothing can mutate the shared fallback. Its durationTicks is never read
// (the award uses the PROCESS's duration, not the recipe's), and it carries no
// xpWeightNum, so it prices at REFINE_XP_WEIGHT_NUM.
const FALLBACK_REFINE_RECIPE: RefineRecipeDef = Object.freeze({
  input: {},
  output: { itemId: "", amount: new Decimal(0) },
  durationTicks: 0,
});

// The whole award in one call, for Unit 3.2's single call site.
export function craftingXpAwardForProcess(process: TimedProcess): number {
  return craftingXpAwardFor(craftingXpSubjectForProcess(process), process.durationTicks);
}

// ============================================================================
// --- The curve and its derivations (design section 6.3) ---------------------
// ============================================================================

// Total XP that must be earned, starting from a fresh level 1, to REACH `level`.
// That is the sum of every threshold below it: sum of craftingXpForNext(k) for
// k = 1 .. level-1. Reaching level 1 costs 0 (it is where a save starts).
//
// Summed rather than closed form on purpose. A closed form exists (the curve is
// 120*L^2 + 6*L^3, so the cumulative is a pair of standard power sums) but it would
// be a SECOND expression of the curve, silently wrong the moment the curve is
// retuned. Summing the real function cannot drift from it. Cost is bounded by the
// level, which is a small number, and the sum is exact under Decimal.
//
// Used by the Phase 4 readouts and by the balance proof in the test suite. A level
// below 1, or not an integer, returns 0 rather than throwing.
export function craftingXpCumulativeToReach(level: number): Decimal {
  if (!Number.isFinite(level) || level <= 1) return new Decimal(0);
  const target = Math.floor(level);
  let total = new Decimal(0);
  for (let k = 1; k < target; k++) {
    total = total.plus(craftingXpForNext(k));
  }
  return total;
}

// What a crafting-level readout needs: the level, how far into it the player is, what
// the next level costs, and a 0..1 fraction for a progress bar.
export interface CraftingLevelProgress {
  level: number;
  xpIntoLevel: Decimal;   // GameState.craftingXp IS the remainder inside the current level
  xpForNextLevel: Decimal;
  fraction: number;       // clamped to 0..1; a plain number because it drives a bar width
}

// Built straight off the two persisted fields. `craftingXp` is already the REMAINDER
// within the current level, not a lifetime total: applyCraftingXp (tick.ts) subtracts
// each threshold as it is crossed and carries the rest forward. So the readout needs
// no cumulative bookkeeping and no back-derivation of the level from a total, which is
// also precisely why retuning the curve cannot demote anybody (see the grandfathering
// note on craftingXpForNext in model.ts).
//
// Takes a Pick rather than a whole GameState so a test, or a future component with only
// a slice in hand, can call it without constructing a world.
export function craftingLevelProgress(
  state: Pick<GameState, "craftingLevel" | "craftingXp">,
): CraftingLevelProgress {
  const level = state.craftingLevel;
  const xpIntoLevel = state.craftingXp;
  const xpForNextLevel = craftingXpForNext(level);
  // A zero or negative threshold cannot happen on the real curve (level >= 1), but
  // dividing by it would produce NaN or Infinity in a bar width, so guard the display.
  const fraction = xpForNextLevel.lte(0)
    ? 1
    : Math.min(1, Math.max(0, xpIntoLevel.div(xpForNextLevel).toNumber()));
  return { level, xpIntoLevel, xpForNextLevel, fraction };
}

// ============================================================================
// --- iLevel readouts (design section 6.5) -----------------------------------
// ============================================================================
//
// READ-ONLY. computeItemLevel is unchanged and is not called from any new site by
// this unit; these helpers exist so the Phase 4 consoles can answer "what iLevel do
// my crafts roll at right now, and what is the ceiling" without re-deriving the cap
// formula in a template. Unit 3.3 owns wiring the craftingItemLevel talent into the
// real mint sites.

// The hard per-tier iLevel ceiling: a tier-N blueprint can never mint above
// N * EQUIPMENT_ILEVEL_CAP_PER_TIER, no matter how high crafting level climbs. The cap
// is a content-integrity guarantee (a tier-1 recipe must not out-level tier-1 content),
// which is why design 6.5 keeps it HARD rather than letting a talent push past it.
export function itemLevelCeilingForTier(blueprintTier: number): number {
  return safeTier(blueprintTier) * EQUIPMENT_ILEVEL_CAP_PER_TIER;
}

export interface CraftedItemLevelReadout {
  iLevel: number;    // what a craft from this blueprint tier rolls at right now
  ceiling: number;   // the hard tier cap
  atCeiling: boolean; // true once more crafting levels stop helping this tier
}

// Delegates the actual arithmetic to computeItemLevel so there is exactly one iLevel
// formula in the codebase. The bonuses default to 0, which is the live value: the
// achievement boost is reserved for a Player Score feature that does not exist yet, and
// the FA talent bonus is Unit 3.3's job. Passing them explicitly keeps this function
// honest when those land, instead of hiding a stale zero.
export function craftedItemLevelReadout(a: {
  craftingLevel: number;
  blueprintTier: number;
  achievementBoost?: number;
  faTalentBonus?: number;
}): CraftedItemLevelReadout {
  const ceiling = itemLevelCeilingForTier(a.blueprintTier);
  const iLevel = computeItemLevel({
    craftingLevel: a.craftingLevel,
    achievementBoost: a.achievementBoost ?? 0,
    faTalentBonus: a.faTalentBonus ?? 0,
    itemTierCap: ceiling,
  });
  return { iLevel, ceiling, atCeiling: iLevel >= ceiling };
}
