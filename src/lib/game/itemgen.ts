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
  SLOT_BASE_PHYSICALS,
  type EquipmentInstance,
  type EquipmentRarity,
  type EquipmentAscension,
  type EquipmentSlotType,
  type EquipmentVarietyDef,
} from "./model";
// Combat 1.0 (Unit 1.2): the weapon roster templates + id union. generateWeapon (below) mints a
// crafted weapon by rolling power lines off a base WEAPON_DEF. This is a safe one-way import:
// combat/weapons imports only combat/types + combat/statusEffects, never itemgen, so no cycle.
import { WEAPON_DEFS, type WeaponId } from "./combat/weapons";
// Combat 1.0 (Unit 2.1a): the drone ROLE_TEMPLATE + role id union, for generateDronePod (below),
// the DRONE analogue of generateWeapon. It mints a crafted drone pod by rolling power lines and
// validates the requested role against ROLE_TEMPLATE (the pod's fixed base def, mirroring how
// generateWeapon validates against WEAPON_DEFS). Safe one-way value import: combat/drones imports
// only combat/positioning + combat/types, never itemgen or model, so no cycle (same posture as
// the combat/weapons import above).
import { ROLE_TEMPLATE, type DroneRole } from "./combat/drones";

// SLOT_BASE_PHYSICALS moved to model.ts (0.11.0 Task 20) so it sits with the other
// slot DATA (EQUIPMENT_SLOTS / DEFAULT_EQUIPMENT_VARIETY) and can be read by model's
// craft-less Standard-Issue generator WITHOUT a model -> itemgen import cycle. It is
// re-exported here so generateEquipment's existing consumers (and itemgen.test.ts,
// which imports it from this module) keep working unchanged.
export { SLOT_BASE_PHYSICALS };

// ----------------------------------------------------------------------------
// Tunable constants (FIRST-PASS TUNABLE, see header)
// ----------------------------------------------------------------------------

// Stat-point budget granted PER item level. The linear backbone of a piece's
// power before the quality/rarity multipliers compound on top. TUNABLE.
export const PER_LEVEL_BUDGET = 2;

// Per-blueprint-TIER ceiling on a crafted piece's item level (Equipment 0.11.0, Task 19).
// The Fabricator mint feeds computeItemLevel an `itemTierCap` of `blueprint.tier * this`, so a
// tier-1 blueprint caps a piece at this level and a tier-2 blueprint at twice it, no matter how
// high the crafter's craftingLevel climbs. Ties the piece's power ceiling to the CONTENT tier
// the blueprint belongs to (a tier-1 recipe can never out-level tier-1 content). FIRST-PASS
// TUNABLE launch placeholder, retuned at the device-check stage like every other constant here.
export const EQUIPMENT_ILEVEL_CAP_PER_TIER = 20;

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

// ----------------------------------------------------------------------------
// Combat-defense rework (HYBRID model): crafted DEFENSIVE-implicit magnitudes.
//
// WHY these three implicit lines are special (and do NOT ride the shared budget curve
// every other slot uses): the combat-defense rework made the Standard-Issue defensive
// floor a FLAT, hull-independent value per stat. model.ts dials SI_PLATING_HP = 100 (hull,
// an ADDITIVE floor), SI_EMITTER_CAP = 300 (shield cap == REF_SHIELD_CAPACITY),
// SI_EMITTER_RECHARGE = 6 (recharge == REF_SHIELD_RECHARGE), the SAME on every hull. The
// bridge fold composes hull = innateHullArmor + plating.hullStrength (plating ADDED to the
// bare frame) and shield = emitter.shieldCapacity * shieldCapEffectiveness (the emitter
// MULTIPLIED by the hull's shield effectiveness). So a crafted defensive piece beats
// Standard-Issue iff its RAW magnitude clears that flat floor: crafted plating > SI iff
// hullStrength > SI_PLATING_HP (100), crafted emitter > SI iff shieldCapacity > SI_EMITTER_CAP (300).
// The frame is ADDED and the shield effectiveness scales SI and crafted EQUALLY, so each raw
// comparison is hull-independent (beat the floor and you beat SI on ANY hull).
//
// THE USER PRINCIPLE (hard requirement, design principle #3): the FIRST crafted tier is
// ALWAYS a few points above Standard-Issue. There is never a case where a crafted defensive
// item is not worth making. The shared budget line is useless here: it starts near 1 point
// at iLevel 1 (budget = iLevel * PER_LEVEL_BUDGET * ...), far BELOW the flat floors. So these
// three lines get their OWN floored magnitude curves: a BASE that already sits a few points
// above the SI floor at the lowest craftable roll (iLevel 1, quality 0, standard rarity, the
// crafting floor from rollCraftedRarity), plus a per-iLevel slope, then compounded by the SAME
// quality/rarity multipliers computeBudget uses so a higher-quality / rarer / higher-iLevel
// piece scales up monotonically.
//
// WHY plating + shield cap ride SEPARATE curves: their floors DIVERGE (plating floor 100 additive,
// shield-cap floor 300 effectiveness), so a single curve cannot clear both. Plating rides
// CRAFTED_DEFENSE_HULL_*, shield cap rides CRAFTED_DEFENSE_CAP_*, recharge rides its own tiny
// CRAFTED_DEFENSE_RECHARGE_* (floor only 6).
//
// NOTE on budget: for these lines the implicit magnitude no longer draws from the piece's
// implicitShare (the shared budget's implicit half is simply unused here); the AFFIX lines still
// draw from affixShare as normal. Deliberate: the defensive implicit is an independent, floored
// bonus, not a budget slice.
//
// ⚠️ FIRST-PASS TUNABLE: the exact BASE / PER_LEVEL numbers are launch placeholders; the 0.16.0
// balance pass refines the curves. What is STRUCTURAL (and must not regress): the lowest craftable
// roll clears its flat SI floor, and the magnitude rises with iLevel / quality / rarity.
// ----------------------------------------------------------------------------

// hullStrength (plating): keyed to the flat SI plating floor of 100 (SI_PLATING_HP, the ADDITIVE
// bare-frame floor). At the lowest craftable roll (iLevel 1, quality 0, standard rarity -> rarityIndex
// 1, so the base is already multiplied by RARITY_MULT^1) this yields ~109 raw, a few points above the
// 100 floor; at the top reachable roll (iLevel 40 = the tier-2 EQUIPMENT_ILEVEL_CAP, quality 5, radiant)
// it yields ~377 raw, ~3.5x the floor. TUNABLE.
export const CRAFTED_DEFENSE_HULL_BASE = 94;      // flat component: sits just above the 100 floor after the standard-rarity 1.15x
export const CRAFTED_DEFENSE_HULL_PER_LEVEL = 1;  // per-iLevel growth added on top of the base

// shieldCapacity (emitter): keyed to the flat SI cap floor of 300 (SI_EMITTER_CAP == REF_SHIELD_CAPACITY,
// a MULTIPLICATIVE reference). At the lowest craftable roll this yields ~311 raw, a few points above the
// 300 floor; at the top reachable roll (iLevel 40, quality 5, radiant) ~1090 raw, ~3.6x the floor. TUNABLE.
export const CRAFTED_DEFENSE_CAP_BASE = 267;      // flat component: clears the 300 floor after the standard-rarity 1.15x
export const CRAFTED_DEFENSE_CAP_PER_LEVEL = 3;   // per-iLevel growth added on top of the base

// shieldRecharge (the emitter's SECOND implicit): a much smaller stat (SI floor is only 6), so it
// rides its own tiny curve rather than the cap curve (the magnitudes differ by ~50x). At the lowest
// craftable roll this yields ~7 raw, above the SI recharge floor of 6, and scales up gently. TUNABLE.
export const CRAFTED_DEFENSE_RECHARGE_BASE = 6;
export const CRAFTED_DEFENSE_RECHARGE_PER_LEVEL = 0.2;

// craftedDefensiveImplicit: the floored magnitude for one defensive implicit line.
// (base + perLevel * iLevel), compounded by the SAME quality/rarity multipliers computeBudget
// uses, rounded to a whole point. Monotonic non-decreasing in iLevel, quality, and rarity (every
// multiplier is >= 1 and Math.round is non-decreasing), which the first-tier-above-SI guarantee
// and the "higher roll is a bigger piece" contract both rely on. PURE arithmetic.
export function craftedDefensiveImplicit(
  base: number,
  perLevel: number,
  iLevel: number,
  quality: number,
  rarityIdx: number,
): number {
  return Math.round((base + perLevel * iLevel) * QUALITY_MULT ** quality * RARITY_MULT ** rarityIdx);
}

// Per-quality-rung durability bonus: durabilityMax = base * (1 + quality * this).
// At 0.2 a quality-5 piece has double (1 + 5*0.2 = 2x) the base durability. Kept
// separate from the budget multipliers because durability is a survivability stat,
// not part of the stat-point budget. TUNABLE.
export const QUALITY_DURABILITY_BONUS = 0.2;

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
  const rarityIdx = rarityIndex(a.rarity);
  for (const stat of slotDef.implicitStats) {
    // Combat-defense rework (HYBRID model): the three DEFENSIVE implicit lines do NOT use the shared
    // budget-derived implicitEach. Their Standard-Issue floor is a FLAT, hull-independent value per stat
    // (SI_PLATING_HP = 100 additive, SI_EMITTER_CAP = 300, SI_EMITTER_RECHARGE = 6), so each rides a
    // dedicated FLOORED curve (craftedDefensiveImplicit) that guarantees the first crafted tier is a few
    // points above that floor and scales up with iLevel/quality/rarity. Strictly scoped by (slotType,
    // stat): every OTHER slot (weapons via generateWeapon, drones via generateDronePod, and the economy
    // slots cargo/ftl/reactor/specUtility here) keeps the shared implicitEach. Plating + shield cap use
    // DIFFERENT curves (their floors diverge, 100 vs 300); see the CRAFTED_DEFENSE_* constants above for
    // the why and the worked first/high-tier numbers.
    if (a.slotType === "hullPlating" && stat === "hullStrength") {
      implicitStats[stat] = craftedDefensiveImplicit(
        CRAFTED_DEFENSE_HULL_BASE, CRAFTED_DEFENSE_HULL_PER_LEVEL, a.iLevel, a.quality, rarityIdx,
      );
    } else if (a.slotType === "shieldEmitters" && stat === "shieldCapacity") {
      implicitStats[stat] = craftedDefensiveImplicit(
        CRAFTED_DEFENSE_CAP_BASE, CRAFTED_DEFENSE_CAP_PER_LEVEL, a.iLevel, a.quality, rarityIdx,
      );
    } else if (a.slotType === "shieldEmitters" && stat === "shieldRecharge") {
      implicitStats[stat] = craftedDefensiveImplicit(
        CRAFTED_DEFENSE_RECHARGE_BASE, CRAFTED_DEFENSE_RECHARGE_PER_LEVEL, a.iLevel, a.quality, rarityIdx,
      );
    } else {
      implicitStats[stat] = implicitEach;
    }
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
    // Persist the level this piece was generated at (previously consumed by computeBudget then
    // discarded). The Fabricator mint path (tick.ts) feeds the REAL computeItemLevel(...) value in,
    // so a crafted piece stores its TRUE mint iLevel, which the UI renders as "iL N".
    iLevel: a.iLevel,
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

// ============================================================================
// Combat 1.0 (Unit 1.2): generateWeapon
// ----------------------------------------------------------------------------
// Mint a crafted WEAPON as an EquipmentInstance (slotType "weapon"). A weapon is NOT
// an economy slot: its identity (family, triangle levers, effect slots, range,
// cooldown, projectiles, ambush eligibility) is FIXED by its base WEAPON_DEF and is
// never rolled. Only its power lines roll: a signature weaponYield implicit plus
// rarity-driven affixes (more yield / accuracy) off a small fixed weapon pool. The
// SAME budget machinery as economy gear (computeBudget / affixCount / the weighted
// no-duplicate picker) drives the magnitudes, so a rarer / higher-quality / higher-
// level weapon is monotonically stronger, exactly like an economy piece.
//
// The rolled lines are stored on the instance; the bridge (Unit 1.4) reconstructs a
// CombatWeapon = WEAPON_DEFS[weaponType] with these lines + quality applied. This
// minter is SEPARATE from makeWeaponInstance (weapons.ts), which stays a DETERMINISTIC
// clone for the hardcoded default loadout, so activating crafted weapons never perturbs
// current combat parity: nothing calls generateWeapon until the craft chain lands (Unit
// 1.2b), and nothing reads a fitted weapon in combat until the bridge fold (Unit 1.4).
//
// PURE + deterministic (injected rng/allocateId), same posture as generateEquipment.
// ============================================================================

// The weapon roll vocabulary. weaponYield is the signature (implicit) line every crafted
// weapon carries; the affix pool adds more yield or accuracy. Weapons have no EQUIPMENT_SLOTS
// variety, so the shared affix picker runs against a NEUTRAL variety (every stat keeps its raw
// pool weight). FIRST-PASS TUNABLE (the balance pass owns the numbers).
const WEAPON_IMPLICIT_STAT = "weaponYield";
const WEAPON_AFFIX_POOL: { stat: string; weight: number }[] = [
  { stat: "weaponYield", weight: 4 },
  { stat: "weaponAccuracy", weight: 3 },
];
const WEAPON_NEUTRAL_VARIETY: EquipmentVarietyDef = { key: "weapon", label: "Weapon", statRatios: {} };

// First-pass intrinsic mass for a crafted weapon (WEAPON_DEFS carry no mass, and the combat sim
// never reads mass). Inert until the equipment fold-in drags it against speed, same as the
// economy slots' base mass. TUNABLE.
const WEAPON_BASE_MASS = 12;

export function generateWeapon(a: {
  weaponType: WeaponId;
  blueprintKey: string | null;
  iLevel: number;
  quality: number;
  rarity: EquipmentRarity;
  ascension: EquipmentAscension;
  rng: () => number;
  allocateId: () => string;
}): EquipmentInstance {
  const template = WEAPON_DEFS[a.weaponType];
  if (template === undefined) {
    throw new Error(`generateWeapon: no weapon def for "${a.weaponType}"`);
  }

  // Budget and its implicit/affix split (identical model to economy gear).
  const budget = computeBudget(a.iLevel, a.quality, rarityIndex(a.rarity));
  const { implicitShare, affixShare } = budgetShares(budget);

  // --- Implicit: the single weaponYield signature line takes the whole implicit share.
  const implicitStats: Record<string, number> = { [WEAPON_IMPLICIT_STAT]: Math.round(implicitShare) };

  // --- Rolled affixes: rarity-driven count + the weighted no-duplicate picker, run against
  // the neutral weapon variety. affixCount FIRST (may draw once for augmented), then the picks,
  // so the rng stream advances in the same documented order as generateEquipment.
  const wantAffixes = affixCount(a.rarity, a.rng);
  const rolledStatKeys = rollDistinctAffixStats(WEAPON_AFFIX_POOL, WEAPON_NEUTRAL_VARIETY, wantAffixes, a.rng);
  const rolledStats: Record<string, number> = {};
  const affixEach = rolledStatKeys.length > 0 ? Math.round(affixShare / rolledStatKeys.length) : 0;
  for (const stat of rolledStatKeys) {
    rolledStats[stat] = affixEach;
  }

  // --- Durability: quality-scaled off the weapon template's base ceiling, starts full ----
  const durabilityMax = Math.round(template.durabilityMax * (1 + a.quality * QUALITY_DURABILITY_BONUS));

  return {
    id: a.allocateId(),
    slotType: "weapon",
    weaponType: a.weaponType,
    rarity: a.rarity,
    ascension: a.ascension,
    quality: a.quality,
    iLevel: a.iLevel,
    blueprintKey: a.blueprintKey,
    implicitStats,
    rolledStats,
    mass: WEAPON_BASE_MASS,
    powerDraw: template.powerDraw, // the weapon's reactor draw (design S10), from its def
    durabilityMax,
    durability: durabilityMax, // fresh weapon starts at full durability
    fittedToShipId: null, // spare in the pool until the install path (Unit 1.3+) assigns it
  };
}

// ============================================================================
// Combat 1.0 (Unit 2.1a): generateDronePod
// ----------------------------------------------------------------------------
// Mint a crafted DRONE POD as an EquipmentInstance (slotType "droneBay"). A pod is NOT an
// economy slot: its identity (the squadron ROLE it deploys, and that role's fixed per-drone base
// behavior, hp/family/accuracy/yield/range/evasion/cooldown + the defensive fields) is FIXED by
// the drone ROLE_TEMPLATE and is never rolled. Only its POWER lines roll: a signature droneHp
// implicit plus rarity-driven affixes (more hp / accuracy) off a small fixed pool. The SAME budget
// machinery as economy + weapon gear (computeBudget / affixCount / the weighted no-duplicate
// picker) drives the magnitudes, so a rarer / higher-quality / higher-level pod is monotonically
// stronger, exactly like a weapon or an economy piece.
//
// WHY droneHp is the SIGNATURE (not droneYield): yield is 0 for the support role (design S8: a
// support squadron has no offense, its kit is repair/cleanse), so it cannot be the UNIVERSAL power
// line every pod carries. droneHp is positive and power-meaningful for ALL THREE roles: a tougher
// squadron survives incoming fire and keeps contributing (offense, deflection, or support pulses)
// longer, whatever its mode. So droneHp is the honest role-agnostic signature, precisely mirroring
// how weaponYield is the universal weapon signature. The affix pool adds more droneHp or
// droneAccuracy (accuracy governs both attack strikes and defense-picket fire); both are drone-
// namespaced keys, distinct from weaponYield/weaponAccuracy, so a later bridge fold maps them onto
// the squadron's droneHp/accuracy fields unambiguously.
//
// The rolled lines are stored on the instance; a later bridge fold reconstructs a DroneSquadron =
// makeSquadron(role) with these lines + quality applied. This minter is SEPARATE from makeDronePod
// (drones.ts), which stays a DETERMINISTIC clone for the hardcoded default carrier loadout, so
// activating crafted pods never perturbs current combat parity: nothing calls generateDronePod
// until the drone craft chain lands (Unit 2.1b), and nothing reads a fitted pod in combat until
// the later bridge fold.
//
// PURE + deterministic (injected rng/allocateId), same posture as generateWeapon.
// ============================================================================

// The drone-pod roll vocabulary. droneHp is the signature (implicit) line every crafted pod
// carries; the affix pool adds more hp or accuracy. Pods have no EQUIPMENT_SLOTS variety, so the
// shared affix picker runs against a NEUTRAL variety (every stat keeps its raw pool weight), the
// same neutral-variety treatment generateWeapon uses. FIRST-PASS TUNABLE (the balance pass owns
// the numbers). Weights mirror the weapon pool (signature stat heavier than accuracy).
const DRONE_POD_IMPLICIT_STAT = "droneHp";
const DRONE_POD_AFFIX_POOL: { stat: string; weight: number }[] = [
  { stat: "droneHp", weight: 4 },
  { stat: "droneAccuracy", weight: 3 },
];
const DRONE_POD_NEUTRAL_VARIETY: EquipmentVarietyDef = { key: "dronePod", label: "Drone Pod", statRatios: {} };

// First-pass intrinsic physicals for a crafted drone pod (ROLE_TEMPLATE carries none: those fields
// are per-DRONE combat stats, not the pod-as-item's mass/power/durability). A pod is a hangar unit
// with real heft, draws reactor power to run its squadron, and wears like any other combat gear.
// The combat sim never reads pod mass/powerDraw yet (inert until the equipment fold-in), and a
// fresh pod starts at full, quality-scaled durability off this base ceiling. All FIRST-PASS
// TUNABLE, same posture as WEAPON_BASE_MASS and SLOT_BASE_PHYSICALS.
const DRONE_POD_BASE_MASS = 14;
// Exported so the minter tests can pin the pod's physical contract exactly (the weapon tests pin
// theirs off the exported WEAPON_DEFS; a pod has no external def table, so its bases live here).
export const DRONE_POD_BASE_POWER_DRAW = 10;
export const DRONE_POD_BASE_DURABILITY = 100;

export function generateDronePod(a: {
  droneRole: DroneRole;
  blueprintKey: string | null;
  iLevel: number;
  quality: number;
  rarity: EquipmentRarity;
  ascension: EquipmentAscension;
  rng: () => number;
  allocateId: () => string;
}): EquipmentInstance {
  // Validate the role against the drone template (the pod's fixed base def), mirroring how
  // generateWeapon validates a weaponType against WEAPON_DEFS. A corrupt caller / save that passes
  // an unknown role indexes to undefined here and is rejected, rather than minting a pod the bridge
  // could not later reconstruct a squadron for.
  if (ROLE_TEMPLATE[a.droneRole] === undefined) {
    throw new Error(`generateDronePod: no drone template for role "${a.droneRole}"`);
  }

  // Budget and its implicit/affix split (identical model to economy + weapon gear).
  const budget = computeBudget(a.iLevel, a.quality, rarityIndex(a.rarity));
  const { implicitShare, affixShare } = budgetShares(budget);

  // --- Implicit: the single droneHp signature line takes the whole implicit share.
  const implicitStats: Record<string, number> = { [DRONE_POD_IMPLICIT_STAT]: Math.round(implicitShare) };

  // --- Rolled affixes: rarity-driven count + the weighted no-duplicate picker, run against the
  // neutral pod variety. affixCount FIRST (may draw once for augmented), then the picks, so the rng
  // stream advances in the same documented order as generateEquipment / generateWeapon.
  const wantAffixes = affixCount(a.rarity, a.rng);
  const rolledStatKeys = rollDistinctAffixStats(DRONE_POD_AFFIX_POOL, DRONE_POD_NEUTRAL_VARIETY, wantAffixes, a.rng);
  const rolledStats: Record<string, number> = {};
  const affixEach = rolledStatKeys.length > 0 ? Math.round(affixShare / rolledStatKeys.length) : 0;
  for (const stat of rolledStatKeys) {
    rolledStats[stat] = affixEach;
  }

  // --- Durability: quality-scaled off the pod's first-pass base ceiling, starts full ----
  const durabilityMax = Math.round(DRONE_POD_BASE_DURABILITY * (1 + a.quality * QUALITY_DURABILITY_BONUS));

  return {
    id: a.allocateId(),
    slotType: "droneBay",
    droneRole: a.droneRole,
    rarity: a.rarity,
    ascension: a.ascension,
    quality: a.quality,
    iLevel: a.iLevel,
    blueprintKey: a.blueprintKey,
    implicitStats,
    rolledStats,
    mass: DRONE_POD_BASE_MASS,
    powerDraw: DRONE_POD_BASE_POWER_DRAW,
    durabilityMax,
    durability: durabilityMax, // fresh pod starts at full durability
    fittedToShipId: null, // spare in the pool until the install path (Unit 2.1b+) assigns it
  };
}
