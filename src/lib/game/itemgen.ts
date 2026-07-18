// ============================================================================
// Equipment 0.11.0 (Phase 2, plan Tasks 4-7): the item-generation engine.
//
// Author: Equipment 0.11.0 feature branch (feat/ship-equipment-0.11.0)
// Scope : PURE, deterministic item generation. No GameState mutation, no side
//         effects, no RNG creation. Every random decision is driven by an
//         INJECTED rng (() => number in [0,1)) so a caller that owns the seeded
//         stream (the offline/economy engine wires that up in a LATER task) gets
//         reproducible loot, and every function here is unit-testable in isolation.
//
// Why a separate module: generation is the one place equipment gains its numbers,
// and it is the easiest place for a subtle bug (double-counted budget, duplicate
// affix, non-reproducible roll) to hide. Isolating it as pure functions means the
// whole pipeline can be pinned by tests without standing up a GameState. Nothing
// in the game imports this yet; fitting, the Fabricator hookup, and save migration
// are all deliberately out of scope for this phase.
//
// Pipeline (each function is one plan task):
//   Task 4  computeItemLevel   : additive inputs clamped by the tier cap.
//   Task 5  computeBudget       : the compounding stat-point budget for a piece.
//   Task 6  affixCount          : how many affixes a rarity rolls (rng for augmented).
//           rollDistinctAffixStats : weighted, no-duplicate stat picks.
//           budgetShares        : the implicit-vs-affix budget split.
//   Task 7  generateEquipment   : assemble it all into an EquipmentInstance.
//
// All numeric constants below are FIRST-PASS TUNABLE launch placeholders (retuned
// at the device-check stage, not piecemeal), the same posture as SHIP_TYPES and
// every other economy constant in model.ts.
// ============================================================================

import {
  EQUIPMENT_SLOTS,
  rarityIndex,
  type EquipmentInstance,
  type EquipmentRarity,
  type EquipmentAscension,
  type EquipmentSlotType,
  type EquipmentVarietyDef,
} from "./model";

// ----------------------------------------------------------------------------
// Tunable constants (FIRST-PASS TUNABLE, see header)
// ----------------------------------------------------------------------------

// Stat-point budget granted PER item level. The linear backbone of a piece's
// power before the quality/rarity multipliers compound on top. TUNABLE.
export const PER_LEVEL_BUDGET = 2;

// Compounding budget multiplier per QUALITY rung (quality is 0..5). At 1.1 a
// quality-5 piece carries 1.1^5 (~1.61x) the budget of a quality-0 piece of the
// same level/rarity. TUNABLE.
export const QUALITY_MULT = 1.1;

// Compounding budget multiplier per base-RARITY index (rarityIndex 0..5). At 1.15
// each rarity step is a ~15% budget bump over the one below it. TUNABLE.
export const RARITY_MULT = 1.15;

// Fraction of the total budget that goes to the slot's IMPLICIT (signature) line(s);
// the remaining (1 - this) goes to the rolled affix lines. At 0.5 the guaranteed
// signature stat and the variable affixes get an even half each. TUNABLE.
export const IMPLICIT_BUDGET_SHARE = 0.5;

// Per-quality-rung durability bonus: durabilityMax = base * (1 + quality * this).
// At 0.2 a quality-5 piece has double (1 + 5*0.2 = 2x) the base durability. Kept
// separate from the budget multipliers because durability is a survivability stat,
// not part of the stat-point budget. TUNABLE.
export const QUALITY_DURABILITY_BONUS = 0.2;

// Per-slot BASE physical characteristics: intrinsic mass, intrinsic power draw, and
// base durability BEFORE any roll or quality scaling. Only the four LIVE slots have
// entries (the reserved EquipmentSlotType members have no generation this patch, so
// generateEquipment rejects them). These are the values a rolled massReduction /
// powerDrawReduction shaves DOWN from, and the base durability quality scales UP.
// FIRST-PASS TUNABLE. (Note reactorCore's low powerDraw of 1: a reactor supplies
// power rather than consuming it; the number is intentionally small, not a typo.)
export const SLOT_BASE_PHYSICALS: Record<
  "cargoBay" | "ftlDrive" | "reactorCore" | "specUtility",
  { mass: number; powerDraw: number; durability: number }
> = {
  cargoBay: { mass: 10, powerDraw: 2, durability: 100 },
  ftlDrive: { mass: 8, powerDraw: 4, durability: 100 },
  reactorCore: { mass: 12, powerDraw: 1, durability: 120 },
  specUtility: { mass: 6, powerDraw: 2, durability: 90 },
};

// ============================================================================
// Task 4: computeItemLevel
// ----------------------------------------------------------------------------
// The effective LEVEL of a generated piece: the crafter's crafting level plus any
// achievement and FA-talent boosts, all ADDITIVE, then CLAMPED to the tier cap so
// a piece can never out-level the content tier it drops in. Pure arithmetic.
// ============================================================================
export function computeItemLevel(a: {
  craftingLevel: number;
  achievementBoost: number;
  faTalentBonus: number;
  itemTierCap: number;
}): number {
  return Math.min(a.craftingLevel + a.achievementBoost + a.faTalentBonus, a.itemTierCap);
}

// ============================================================================
// Task 5: computeBudget
// ----------------------------------------------------------------------------
// The total stat-point budget a piece has to spend across its stat lines:
//   iLevel * PER_LEVEL_BUDGET  (linear backbone)
//     * QUALITY_MULT ^ quality (compounding quality bump)
//     * RARITY_MULT  ^ rarityIdx (compounding rarity bump)
// rounded to a whole number of points. Monotonic non-decreasing in both quality
// and rarity (multipliers > 1, round is non-decreasing), which the loot UI relies
// on: a rarer or higher-quality drop is never numerically weaker for the same level.
// ============================================================================
export function computeBudget(iLevel: number, quality: number, rarityIdx: number): number {
  const raw = iLevel * PER_LEVEL_BUDGET * QUALITY_MULT ** quality * RARITY_MULT ** rarityIdx;
  return Math.round(raw);
}

// ============================================================================
// Task 6: affixCount
// ----------------------------------------------------------------------------
// How many AFFIX lines a piece of the given rarity rolls (on top of its always-
// present implicit line). Fixed per rarity except augmented, which has a 25% chance
// of an extra affix and is therefore the ONLY rarity that consumes an rng draw here.
//
// Draw-count contract (matters because generateEquipment calls this FIRST, then
// the affix picker, on the SAME rng stream): every non-augmented rarity consumes
// ZERO draws; augmented consumes EXACTLY ONE. luminous/constellar are not produced
// this patch but are handled as radiant-count (3) so a stray value never crashes
// the pipeline.
// ============================================================================
export function affixCount(rarity: EquipmentRarity, rng: () => number): number {
  switch (rarity) {
    case "derelict":
      return 0;
    case "standard":
      return 2;
    case "augmented":
      // The single rng draw for the 25% upgrade. Kept as the ONLY draw so callers
      // can reason exactly about how far the stream advanced before the affix picks.
      return rng() < 0.25 ? 3 : 2;
    case "stellar":
    case "radiant":
      return 3;
    // Unproduced legendary flavors: treat as radiant-count for safety (no crash).
    case "luminous":
    case "constellar":
      return 3;
  }
}

// ============================================================================
// Task 6: rollDistinctAffixStats
// ----------------------------------------------------------------------------
// Pick `count` DISTINCT stats from the slot's affix pool, weighted by
// (base pool weight * variety bias), where variety bias = variety.statRatios[stat]
// if the variety lists that stat, else 1 (a stat the variety does not bias keeps
// its raw pool weight). Selection is WITHOUT replacement: after each pick the stat
// is removed from the candidate set so no item ever carries a duplicate stat line.
//
// Determinism: exactly ONE rng draw per pick, walking the cumulative-weight line,
// so a fixed rng stream always yields the same ordered picks. If the pool has fewer
// distinct stats than `count`, we return everything the pool can offer (never throw,
// never pad).
// ============================================================================
export function rollDistinctAffixStats(
  affixPool: { stat: string; weight: number }[],
  variety: EquipmentVarietyDef,
  count: number,
  rng: () => number
): string[] {
  // Build the biased candidate list ONCE. We mutate this local copy (splice out
  // picks); the caller's affixPool is never touched.
  const candidates = affixPool.map((entry) => ({
    stat: entry.stat,
    weight: entry.weight * (variety.statRatios[entry.stat] ?? 1),
  }));

  const picks: string[] = [];
  // Cannot pick more distinct stats than the pool holds.
  const drawCount = Math.min(count, candidates.length);

  for (let k = 0; k < drawCount; k++) {
    const totalWeight = candidates.reduce((sum, c) => sum + c.weight, 0);
    // One draw per pick regardless of the total, so the stream advances predictably
    // even in the degenerate all-zero-weight case below.
    let target = rng() * totalWeight;

    let chosenIdx = 0;
    if (totalWeight > 0) {
      // Walk the cumulative weight line: the first candidate that pushes the running
      // subtraction below zero owns the drawn point.
      for (let i = 0; i < candidates.length; i++) {
        target -= candidates[i].weight;
        chosenIdx = i;
        if (target < 0) break;
      }
    }
    // (totalWeight <= 0 cannot happen with the live table's positive weights, but if
    // a future pool zeroed everything out we fall back to the first candidate.)

    picks.push(candidates[chosenIdx].stat);
    candidates.splice(chosenIdx, 1);
  }

  return picks;
}

// ============================================================================
// Task 6: budgetShares
// ----------------------------------------------------------------------------
// Split a piece's total budget into the IMPLICIT-line share and the AFFIX-line
// share. affixShare is computed as (budget - implicitShare) rather than
// ((1 - IMPLICIT_BUDGET_SHARE) * budget) so the two shares always sum to EXACTLY
// budget with no floating-point drift. Each share is then divided EQUALLY among its
// lines by the caller (generateEquipment), which is where the per-line rounding
// happens.
// ============================================================================
export function budgetShares(budget: number): { implicitShare: number; affixShare: number } {
  const implicitShare = IMPLICIT_BUDGET_SHARE * budget;
  return { implicitShare, affixShare: budget - implicitShare };
}

// ============================================================================
// Task 7: generateEquipment
// ----------------------------------------------------------------------------
// Assemble a complete, well-formed EquipmentInstance from the slot table, the
// budget math, and the injected rng/allocateId. PURE: it reads EQUIPMENT_SLOTS and
// builds fresh records, mutating neither its inputs nor any shared state.
//
// Magnitude model:
//   - budget          = computeBudget(iLevel, quality, rarityIndex(rarity)).
//   - implicit lines  share IMPLICIT_BUDGET_SHARE of the budget EQUALLY (rounded).
//   - rolled affixes  share the rest EQUALLY (rounded); their stats come from the
//                     weighted no-duplicate picker.
//
// Physical fold (documented judgment call): if a rolled affix is massReduction or
// powerDrawReduction, it is CONSUMED into the piece's intrinsic mass / powerDraw
// (subtracted from the slot base, floored at 0) and REMOVED from rolledStats, so
// mass and powerDraw are the SINGLE source of truth for those quantities rather
// than being split between a base field and a lingering stat line. This is the
// "apply and remove" option the plan recommends.
//
// durabilityMax scales with quality (see QUALITY_DURABILITY_BONUS); a fresh piece
// starts at full durability.
// ============================================================================
export function generateEquipment(a: {
  slotType: EquipmentSlotType;
  varietyKey: string;
  blueprintKey: string | null;
  iLevel: number;
  quality: number;
  rarity: EquipmentRarity;
  ascension: EquipmentAscension;
  rng: () => number;
  allocateId: () => string;
}): EquipmentInstance {
  // --- Look up the slot definition and the requested variety -----------------
  const slotDef = EQUIPMENT_SLOTS[a.slotType];
  if (slotDef === undefined) {
    // Reserved slots have no definition this patch; generation cannot proceed.
    throw new Error(`generateEquipment: no slot definition for "${a.slotType}" (not a live slot this patch)`);
  }
  const variety = slotDef.varieties.find((v) => v.key === a.varietyKey);
  if (variety === undefined) {
    throw new Error(`generateEquipment: slot "${a.slotType}" has no variety "${a.varietyKey}"`);
  }
  const basePhysicals = SLOT_BASE_PHYSICALS[a.slotType as keyof typeof SLOT_BASE_PHYSICALS];
  if (basePhysicals === undefined) {
    throw new Error(`generateEquipment: no base physicals for slot "${a.slotType}"`);
  }

  // --- Budget and its implicit/affix split -----------------------------------
  const budget = computeBudget(a.iLevel, a.quality, rarityIndex(a.rarity));
  const { implicitShare, affixShare } = budgetShares(budget);

  // --- Implicit (signature) lines: always present, equal share ---------------
  const implicitStats: Record<string, number> = {};
  const implicitCount = slotDef.implicitStats.length;
  const implicitEach = implicitCount > 0 ? Math.round(implicitShare / implicitCount) : 0;
  for (const stat of slotDef.implicitStats) {
    implicitStats[stat] = implicitEach;
  }

  // --- Rolled affix lines: rarity decides how many, picker decides which ------
  // affixCount() first (may consume one rng draw for augmented), THEN the picks, so
  // the stream advances in the documented order.
  const wantAffixes = affixCount(a.rarity, a.rng);
  const rolledStatKeys = rollDistinctAffixStats(slotDef.affixPool, variety, wantAffixes, a.rng);
  const rolledStats: Record<string, number> = {};
  // Divide by the ACTUAL number of picks (the pool may have offered fewer than
  // wantAffixes), so the affix share is spread evenly across the lines that exist.
  const affixEach = rolledStatKeys.length > 0 ? Math.round(affixShare / rolledStatKeys.length) : 0;
  for (const stat of rolledStatKeys) {
    rolledStats[stat] = affixEach;
  }

  // --- Fold massReduction / powerDrawReduction into the physicals -------------
  // These two affixes, when rolled, are consumed into mass/powerDraw and dropped as
  // separate stat lines (single source of truth). "?? 0" so an unrolled reduction
  // is simply no reduction.
  const massReduction = rolledStats.massReduction ?? 0;
  const powerDrawReduction = rolledStats.powerDrawReduction ?? 0;
  const mass = Math.max(0, basePhysicals.mass - massReduction);
  const powerDraw = Math.max(0, basePhysicals.powerDraw - powerDrawReduction);
  delete rolledStats.massReduction;
  delete rolledStats.powerDrawReduction;

  // --- Durability: quality-scaled, starts full -------------------------------
  const durabilityMax = Math.round(basePhysicals.durability * (1 + a.quality * QUALITY_DURABILITY_BONUS));

  // --- Assemble the instance -------------------------------------------------
  return {
    id: a.allocateId(),
    slotType: a.slotType,
    rarity: a.rarity,
    ascension: a.ascension,
    quality: a.quality,
    blueprintKey: a.blueprintKey,
    implicitStats,
    rolledStats,
    mass,
    powerDraw,
    durabilityMax,
    durability: durabilityMax, // fresh piece starts at full durability
    fittedToShipId: null, // spare in the pool until a later fitting task assigns it
  };
}
