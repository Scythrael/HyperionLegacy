// Tick loop — tech spec §2 (Tick Loop and Time Semantics).
// Phase 4 (docs/plans/2026-07-06-phase4-navigation-progression-overhaul-plan.md):
// the Generator Stack economy (tickCaptainStack) and everything built on top
// of it (Research, both Prestige tiers, the Skill Tree) have been removed.
// Missions (tickCaptainMission, below) are now the ONLY economy -- an idle
// captain (mission === null) does nothing on a tick; there is no more
// passive production to compute for them. tick() advances the fleet-wide
// gameTimeSeconds once per call (not once per captain -- gameTimeSeconds is
// fleet bookkeeping, not tied to any single captain's production).

import Decimal from "break_infinity.js";
import {
  requiredTicksForPhase,
  effectiveMissionDef,
  xpForNextLevel,
  xpForNextFleetAdminLevel,
  MISSIONS,
  BASE_XP_PER_TICK,
  RECIPES,
  SHIP_TYPES,
  CAPTAIN_TALENTS,
  CAPTAIN_SPEC_BONUS,
  HOMEWORLD_TALENTS,
  FACILITIES,
  REFINE_RECIPES,
  ITEMS,
  freshCaptainStack,
  shipDerivedStats,
  type ItemDef,
  type GameState,
  type ShipTypeKey,
  type ShipInstance,
  type CaptainState,
  type CaptainMissionState,
  type LootMaterialKey,
  type MissionDef,
  type ShipDerivedStats,
  type MissionPhase,
  type MissionKey,
  type RecipeKey,
  type HomePlanetMaterialKey,
  type CaptainTalentKey,
  type HomeworldTalentKey,
  type CaptainTalentBranch,
  type CaptainTalentEffect,
  type HomeworldTalentEffect,
  type TimedProcess,
  type TimedProcessKind,
  type ProcessEffect,
  WAREHOUSE_T1_BASE_CAP,
  WAREHOUSE_T2_BASE_CAP,
} from "./model";

// Must stay in sync with MissionPhase and requiredTicksForPhase's switch --
// there's no compiler link between this array and the union type, so a 6th
// phase added to MissionPhase without a matching entry here would silently
// wrap `.indexOf()` to -1 instead of erroring.
const MISSION_PHASE_ORDER: MissionPhase[] = ["ordersReceived", "transitOut", "extracting", "transitBack", "unloading"];

function emptyLootTotals(): Record<LootMaterialKey, Decimal> {
  return { commonOre: new Decimal(0), uncommonMaterial: new Decimal(0), rareMaterial: new Decimal(0) };
}

// Progression Pacing Rework (Task 6): the mission-relevant subset of
// GameState.lifetimeStats that tickCaptainMission accrues and returns per call,
// for tick() to fold into the fleet-wide lifetimeStats. Deliberately a SUBSET --
// itemsRefined/itemsCrafted are NOT here because missions produce no
// refined/crafted goods (no refinery/fabricator runs in this function); those
// two maps stay untouched by the mission economy (they'll be fed by the crafting
// path in its own later task). itemsGathered/missionsCompleted mirror the model's
// sparse-map shape (a key absent until its first recorded event); the three
// scalars are per-call Decimal sums. All Decimal, matching lifetimeStats' own types.
export interface MissionLifetimeStatsDelta {
  itemsGathered: Record<string, Decimal>;    // raw loot DELIVERED this call, keyed by material -- mirrors homePlanetDelta exactly
  missionsCompleted: Record<string, Decimal>; // +1 per completed cycle this call, keyed by MissionKey (sparse: absent when 0)
  creditsEarned: Decimal;                     // mirrors creditsDelta (credits earned this call)
  captainXpAwarded: Decimal;                  // GROSS captain XP granted this call (before level-up subtraction), NOT the captain's leftover xp
  fleetAdminXpAwarded: Decimal;               // Fleet Admiral XP granted this call
}

// The zeroed delta -- returned on the early-out paths (no mission / non-positive
// ticksElapsed) so every caller always gets a fully-shaped delta to fold, never
// undefined. Empty maps (nothing gathered / no cycle completed) + Decimal(0) scalars.
function emptyMissionLifetimeStatsDelta(): MissionLifetimeStatsDelta {
  return {
    itemsGathered: {},
    missionsCompleted: {},
    creditsEarned: new Decimal(0),
    captainXpAwarded: new Decimal(0),
    fleetAdminXpAwarded: new Decimal(0),
  };
}

// Folds a per-call tally-map delta (material/mission key -> Decimal) into an
// existing lifetimeStats map, returning a NEW map (base is not mutated). Same
// "start from the existing object, add each key" shape tick() uses for
// homePlanet.storage, generalized to dynamic keys: a key absent in `base` starts
// from Decimal(0), preserving the maps' sparse-by-design contract. Used by tick()
// to merge itemsGathered/missionsCompleted; not needed for the scalar sums, which
// fold with a plain .plus().
function mergeLifetimeStatMap(
  base: Record<string, Decimal>,
  delta: Record<string, Decimal>
): Record<string, Decimal> {
  const merged: Record<string, Decimal> = { ...base };
  for (const key of Object.keys(delta)) {
    merged[key] = (merged[key] ?? new Decimal(0)).plus(delta[key]);
  }
  return merged;
}

// Progression Pacing Rework (Task 7): folds ONE captain's per-call
// MissionLifetimeStatsDelta into a fleet-wide lifetimeStats object, returning a
// NEW lifetimeStats (base is not mutated). This is the SINGLE source of truth for
// the lifetimeStats fold, called PER CAPTAIN by BOTH tick() (offline catch-up,
// below) AND App.svelte's live poll loop -- so live play and offline catch-up
// cannot diverge for lifetime stats by construction. That drift-proofing is the
// whole reason it exists: the live loop is a SEPARATE re-implementation of the
// tick math and has historically dropped ship-stats/credits when it diverged
// from tick(); routing both paths through this one function removes that risk for
// lifetime stats. The 2 tally maps merge per-key via mergeLifetimeStatMap; the 3
// scalars .plus() their delta. Spread FIRST so the two fields the mission economy
// does NOT feed -- itemsRefined/itemsCrafted -- plus any future lifetimeStats
// field ride through untouched rather than being silently dropped (the same
// "prestige silently dropped homePlanet" bug class tick()'s homePlanet fold
// guards against). MissionLifetimeStatsDelta is a strict SUBSET of lifetimeStats
// (no itemsRefined/itemsCrafted), so those two are preserved by the spread alone
// and never overwritten here. Replaces Task 6's inline per-field accumulate +
// separate final fold inside tick(); folding one delta at a time is exactly
// value-equivalent (mergeLifetimeStatMap / .plus() are additive and associative,
// so state + d1 + d2 lands identically whether summed once or per captain).
export function foldLifetimeStatsDelta(
  lifetimeStats: GameState["lifetimeStats"],
  delta: MissionLifetimeStatsDelta
): GameState["lifetimeStats"] {
  return {
    ...lifetimeStats,
    itemsGathered: mergeLifetimeStatMap(lifetimeStats.itemsGathered, delta.itemsGathered),
    missionsCompleted: mergeLifetimeStatMap(lifetimeStats.missionsCompleted, delta.missionsCompleted),
    creditsEarned: lifetimeStats.creditsEarned.plus(delta.creditsEarned),
    captainXpAwarded: lifetimeStats.captainXpAwarded.plus(delta.captainXpAwarded),
    fleetAdminXpAwarded: lifetimeStats.fleetAdminXpAwarded.plus(delta.fleetAdminXpAwarded),
  };
}

// passiveTrickle's `material` field is typed HomePlanetMaterialKey (the wider
// superset, since a future trickle could in principle target a crafted good),
// but homePlanetDelta is keyed on the narrower LootMaterialKey -- this list
// narrows one to the other at runtime. Today's only passiveTrickle entry
// (economyTrickle) targets "commonOre", which is in this list; a future
// trickle entry targeting "refinedMaterial"/"components" would need
// homePlanetDelta's shape (and this list) widened first, not silently work.
export const LOOT_MATERIAL_KEYS: LootMaterialKey[] = ["commonOre", "uncommonMaterial", "rareMaterial"];

// Sums every unlocked Captain Talent's commonYieldMult contribution for THIS
// captain -- additive stacking, read at usage time rather than cached on
// CaptainState, per the "read at usage time" pattern the comment above
// buyCaptainTalent already documents.
//
// Radial Skill Web (Task 7): the old CAPTAIN_SPEC_BONUS.command fold-in
// (a flat commonYieldMult granted when captain.spec === "command") was removed
// here, because the `command` branch/spec and its CAPTAIN_SPEC_BONUS.command
// entry were both deleted in Task 2. This function now returns ONLY the talent
// sum. The still-valid `resourcefulness` spec bonus is handled separately in
// captainSpecBonusRollChance below (kept separate for the downstream-scaling
// reason documented there) -- it is unaffected by this removal.
export function captainCommonYieldMult(captain: CaptainState): number {
  return captain.unlockedCaptainTalents.reduce((sum, key) => {
    const effect = CAPTAIN_TALENTS[key].effect;
    return effect.type === "commonYieldMult" ? sum + effect.mult : sum;
  }, 0);
}

// Same additive-stacking, read-at-usage-time pattern as
// captainCommonYieldMult, for the uncommon-tier yield effect type.
export function captainUncommonYieldMult(captain: CaptainState): number {
  return captain.unlockedCaptainTalents.reduce((sum, key) => {
    const effect = CAPTAIN_TALENTS[key].effect;
    return effect.type === "uncommonYieldMult" ? sum + effect.mult : sum;
  }, 0);
}

// Same additive-stacking, read-at-usage-time pattern as the yield helpers
// above, for the uncommon-tier occurrence-chance effect type.
export function captainUncommonChanceMult(captain: CaptainState): number {
  return captain.unlockedCaptainTalents.reduce((sum, key) => {
    const effect = CAPTAIN_TALENTS[key].effect;
    return effect.type === "uncommonChanceMult" ? sum + effect.mult : sum;
  }, 0);
}

// Same additive-stacking, read-at-usage-time pattern as the helpers above,
// for the rare-tier occurrence-chance effect type.
export function captainRareChanceMult(captain: CaptainState): number {
  return captain.unlockedCaptainTalents.reduce((sum, key) => {
    const effect = CAPTAIN_TALENTS[key].effect;
    return effect.type === "rareChanceMult" ? sum + effect.mult : sum;
  }, 0);
}

// Same additive-stacking, read-at-usage-time pattern as the helpers above,
// for the bonus-roll TRIGGER chance (the base value from prospectorLuckyStrikeI --
// NOT a multiplier on an existing mission-defined chance, since there is no
// mission-level "bonus roll chance" to scale; this creates the chance from
// nothing, so summing raw values is the only mechanically coherent stacking
// rule, same as every other additive helper in this file). Note this effect's
// field is named `chance`, not `mult` -- unlike every OTHER effect type in
// this file, since bonusRollChance is a base value, not itself a multiplier.
export function captainBonusRollChance(captain: CaptainState): number {
  return captain.unlockedCaptainTalents.reduce((sum, key) => {
    const effect = CAPTAIN_TALENTS[key].effect;
    return effect.type === "bonusRollChance" ? sum + effect.chance : sum;
  }, 0);
}

// Relative multiplier applied ON TOP of captainBonusRollChance's base value
// (prospectorLuckyStrikeII) -- same Math.min(1, base * (1 + mult)) shape
// every other chance-mult effect in this file already uses (see
// effectiveUncommonChance/effectiveRareChance in rollExtractionTick below).
export function captainBonusRollChanceMult(captain: CaptainState): number {
  return captain.unlockedCaptainTalents.reduce((sum, key) => {
    const effect = CAPTAIN_TALENTS[key].effect;
    return effect.type === "bonusRollChanceMult" ? sum + effect.mult : sum;
  }, 0);
}

// CAPTAIN_SPEC_BONUS.resourcefulness's flat +0.01 bonus-roll TRIGGER chance,
// granted once captain.spec === "resourcefulness" (independent of whether any
// prospectorLuckyStrike talent is actually unlocked -- the spec bonus is a
// standalone grant, not a scaling of the talent tree's own contribution).
//
// Deliberately kept SEPARATE from captainBonusRollChance (not folded into
// that function's own return value) because bonusRollChance has a
// second-stage multiplier layer downstream (captainBonusRollChanceMult, see
// tickCaptainMission's effectiveBonusRollChance computation:
// `bonusRollChance * (1 + bonusRollChanceMult)`) that commonYieldMult does
// NOT have. Folding this spec bonus into captainBonusRollChance's own sum
// would let bonusRollChanceMult incorrectly re-scale the spec bonus too --
// e.g. with both prospectorLuckyStrikeI/II unlocked (bonusRollChance 0.02,
// bonusRollChanceMult 1.0), folding 0.01 in would give
// (0.02 + 0.01) * (1 + 1.0) = 0.06, overshooting the design doc's 0.05 target.
// Keeping it separate and adding it AFTER the base*(1+mult) scaling (see
// tickCaptainMission) gives the correct 0.02*(1+1.0) + 0.01 = 0.05 instead.
export function captainSpecBonusRollChance(captain: CaptainState): number {
  // CAPTAIN_SPEC_BONUS.resourcefulness is typed as the full CaptainTalentEffect
  // union (CAPTAIN_SPEC_BONUS's declared type is Partial<Record<
  // CaptainTalentBranch, CaptainTalentEffect>>, which TypeScript does not
  // narrow from the literal value assigned), so `.chance` is only accessed
  // after confirming effect.type === "bonusRollChance" specifically -- the same
  // discriminant-check pattern as the effect.type checks in the reduce helpers
  // above, rather than a non-null assertion TypeScript would reject.
  const specEffect = CAPTAIN_SPEC_BONUS.resourcefulness;
  return captain.spec === "resourcefulness" && specEffect?.type === "bonusRollChance" ? specEffect.chance : 0;
}

// Fleet-wide equivalent of the captain-level yield helpers above -- sourced
// from state.unlockedHomeworldTalents (Fleet Admiral prestige, spent
// fleet-wide) rather than one captain's own talents, so it applies
// identically to EVERY captain's mission extraction, not just whichever
// captain unlocked it. rareYieldMult is the ONLY Homeworld Talent effect type
// tied to extraction (per the design doc, there is no captain-level
// rare-yield talent).
export function fleetRareYieldMult(state: GameState): number {
  return state.unlockedHomeworldTalents.reduce((sum, key) => {
    const effect = HOMEWORLD_TALENTS[key].effect;
    return effect.type === "rareYieldMult" ? sum + effect.mult : sum;
  }, 0);
}

// Progression Pacing Rework (Task 3, docs/plans/2026-07-11-progression-pacing-
// rework-*): the SHARED per-tick XP RATE helper. Returns how much XP one whole
// extraction tick of `missionKey` is worth RIGHT NOW, for THIS captain (and,
// later, this fleet `state`). Task 4 (captain XP accrual) and Task 5 (Fleet
// Admiral XP) will BOTH call into this one function, so the two XP streams
// always scale off the exact same rate -- it is a shared dependency built
// first, deliberately NOT yet wired into tickCaptainMission (that is Task 4/5).
//
// XP RATES ARE PLAIN `number`, NOT Decimal: like every *Mult helper above, this
// returns a small multiplier-scale rate, not an accumulated total. The Decimal
// accounting stays downstream where these rates are summed into the captain's
// xp / the fleet's fleetAdminXp (both Decimal) by Task 4/5.
//
// MULTIPLIER SEAM -- READ BEFORE EXTENDING: today this returns the mission's
// flat BASE_XP_PER_TICK unchanged, because there are currently NO XP-boosting
// captain talents or global buffs -- CaptainTalentEffect / HomeworldTalentEffect
// (model.ts) have no XP-flavored member to reduce over. Per the project's
// no-placeholder rule, we do NOT fabricate a fake "xpMult" effect type just to
// have something to multiply by. Instead the future multiplier plugs in RIGHT
// HERE as a one-line change: once a real XP-mult talent/buff effect exists, this
// body becomes `return BASE_XP_PER_TICK[missionKey] * (1 + captainXpMult(captain)) *
// (1 + buffXpMult(state))`, where captainXpMult/buffXpMult are written as the SAME
// ADDITIVE-BONUS `reduce`-over-unlocked-talents shape as captainCommonYieldMult /
// fleetRareYieldMult above -- they `reduce(..., 0)` and return 0 (NOT 1) when
// nothing matches (a +50% XP talent contributes 0.5), so each is applied as
// `(1 + mult)`. Do NOT multiply the raw helper in (`... * captainXpMult(...)`):
// since these helpers return 0 when empty, that form would zero out ALL XP. The
// `captain` and `state` params already sit in the signature (intentionally
// unused today) so that extension needs no call-site changes. `state` is
// optional because the captain-level caller (Task 4) has no reason to thread
// fleet state through for a rate that ignores it today.
//
// ⚠️ CLOSED-FORM PARITY TRAP -- the moment this returns a FRACTIONAL rate ⚠️
// Task 4's captain-XP accrual (tickCaptainMission) awards xpRate * (whole ticks
// advanced) and relies on that product being drift-free across chunking so one
// big offline-catchup call equals many small live calls (the closed-form parity
// test guards it). That equality holds ONLY while this rate is an INTEGER (it is
// today: BASE_XP_PER_TICK is 1). A fractional rate -- exactly what the
// `(1 + captainXpMult)*(1 + buffXpMult)` extension above produces -- breaks it:
// a single big-call product can differ from the summed per-call products in
// floating point (0.1*3 !== 0.1+0.1+0.1), and the current rate-1 parity test
// will NOT catch the regression. See the matching ⚠️ block at the
// `xp = xp.plus(new Decimal(xpRate).times(...))` award line in tickCaptainMission:
// activating a fractional rate requires re-deriving that accrual to stay
// drift-free AND adding a closed-form parity test AT the real fractional rate
// (the Decimal wrapping there is defense-in-depth, not a proof of parity).
export function xpPerTick(missionKey: MissionKey, captain: CaptainState, state?: GameState): number {
  return BASE_XP_PER_TICK[missionKey];
}

// Talent Tree Visual Redesign (Task 9): pure string-conversion helpers for the
// Task 12 tooltip work -- turn one CAPTAIN_TALENTS/HOMEWORLD_TALENTS entry's
// `effect` field into a single human-readable line describing its numeric
// impact. No side effects, no state read -- these take the effect value
// directly (as already narrowed off a specific talent's `.effect`), not a
// GameState/CaptainState, so the tooltip can call them for ANY talent entry
// (unlocked or not) purely from its static model.ts definition.
//
// Percentage rounding follows the SAME .toFixed(1) convention App.svelte
// already uses for every other displayed chance/yield percentage (e.g. the
// "Bonus Roll: ...% chance/tick" and mission phase readouts) -- kept
// consistent rather than introducing a second rounding convention (.toFixed(0))
// just for this new tooltip text.
//
// Discriminated union with no `default` branch: TypeScript's exhaustiveness
// checking would flag a missing case at compile time if CaptainTalentEffect
// grows a new member without a matching branch here -- but there is no
// TypeScript compiler available in this dev environment to actually run that
// check, so any FUTURE new member added to CaptainTalentEffect in model.ts
// must have its switch branch added here by hand at the same time, not
// discovered later by a build failure.
export function describeCaptainTalentEffect(effect: CaptainTalentEffect): string {
  switch (effect.type) {
    case "commonYieldMult":
      return `+${(effect.mult * 100).toFixed(1)}% Common Ore yield`;
    case "uncommonYieldMult":
      return `+${(effect.mult * 100).toFixed(1)}% Uncommon Material yield`;
    case "uncommonChanceMult":
      return `+${(effect.mult * 100).toFixed(1)}% Uncommon Material chance`;
    case "rareChanceMult":
      return `+${(effect.mult * 100).toFixed(1)}% Rare Material chance`;
    case "bonusRollChance":
      return `+${(effect.chance * 100).toFixed(1)}% chance/tick for a bonus roll`;
    case "bonusRollChanceMult":
      return `+${(effect.mult * 100).toFixed(1)}% to bonus roll chance`;
    // Radial Skill Web (Task 2): the gateway-hub effect. Tactician/Explorer
    // hubs carry `{ type: "none" }` because their branches' real mechanics
    // (combat / science) don't exist yet. Rendered honestly as "no bonus yet"
    // rather than a misleading "+0.0%" line -- this is the whole reason the
    // `none` member exists instead of a `mult: 0.0` placeholder.
    case "none":
      return "No bonus yet — unlocks this branch";
  }
}

// Same pattern as describeCaptainTalentEffect above, for the Homeworld Talent
// tree's effect union. recipeBonusOutput looks up RECIPES[effect.recipeKey].label
// for the recipe's display name -- the SAME lookup App.svelte's own crafting
// log line already uses (`Crafted: ${RECIPES[recipeKey].label}.`) -- rather
// than surfacing the raw RecipeKey string. passiveTrickle has no equivalent
// display-label table anywhere in the codebase for HomePlanetMaterialKey, so
// it surfaces the raw material key as-is (e.g. "commonOre"), matching how
// this same codebase already displays raw LootMaterialKey/HomePlanetMaterialKey
// strings elsewhere with no translation layer (see mission cargo readouts in
// App.svelte). Introducing a new material-label map is out of scope for this
// pure-conversion-function task -- flagging it as a real Task 12 (tooltip UI)
// candidate, not solving it here.
export function describeHomeworldTalentEffect(effect: HomeworldTalentEffect): string {
  switch (effect.type) {
    case "unlockCaptainSlot":
      return "Unlocks a new captain slot";
    case "rareYieldMult":
      return `+${(effect.mult * 100).toFixed(1)}% Rare Material yield (fleet-wide)`;
    case "recipeBonusOutput":
      return `+${effect.bonus} bonus output per craft (${RECIPES[effect.recipeKey].label})`;
    case "passiveTrickle":
      return `+${effect.perTick}/tick passive ${effect.material}`;
    // Radial Skill Web (Task 3): the gateway-hub effect, mirroring the captain
    // side's `none` case above. Homeland Defense / Citizenry hubs carry
    // `{ type: "none" }` because their categories' real mechanics (a defense /
    // population system) don't exist yet. Rendered honestly as "no bonus yet"
    // rather than a misleading "+0.0%" line -- the whole reason the `none`
    // member exists instead of a `mult: 0.0` placeholder.
    case "none":
      return "No bonus yet — unlocks this branch";
  }
}

// requiredTicksForPhase always returns a whole number, but phaseProgressTicks
// accumulates via repeated float addition across many small tickCaptainMission
// calls (e.g. offline catch-up feeding one big ticksElapsed vs. the live loop
// feeding many small ones -- see the closed-form test). Summing a
// non-terminating binary fraction like 0.1 many times lands a hair short of
// (or past) the true integer boundary, e.g. 9.999999999999982 instead of 10.
// Left unhandled, that residue is invisible to a strict `>=` boundary check
// AND undercounts the extraction loot rolls below (Math.floor never sees the
// final whole-tick crossing) -- so one big ticksElapsed call and many small
// ones summing to the same total can disagree on both phase and loot,
// breaking the exact guarantee this function exists to provide.
const MISSION_TICK_EPSILON = 1e-9;

// A very large offline-catchup ticksElapsed could complete many mission
// cycles across many captains in one tick() call, each contributing 1-2
// Fleet Admiral XP (or a large amount of captain XP) -- summing to a
// potentially large delta applied in one shot. Capping a level-up loop at a
// fixed max per call and carrying any leftover XP forward (it keeps
// resolving on a LATER call) avoids an unbounded loop. Originally added for
// applyFleetAdminXp only (Fleet Admiral XP Rework); the Big-Number Migration
// (2026-07-08, docs/plans/2026-07-08-big-number-migration-plan.md, Task 5)
// has since reused this SAME constant (not redefined it) for the captain XP
// level-up loop inside tickCaptainMission too, now that captain xp is
// Decimal-typed -- both loops share this one cap.
//
// Exported (2026-07-11, Progression Pacing Rework Task 12) so tick.test.ts's
// cap tests import this exact value instead of each mirroring the 10_000
// literal locally (a Task 8 review item) -- keeps the tests from silently
// drifting out of sync if this cap is ever retuned. Same export-to-avoid-a-
// hand-duplicated-copy rationale as RESPEC_COST_CREDITS just below.
export const MAX_LEVEL_UPS_PER_TICK = 10_000;

// Exported so App.svelte can display/gate on this exact value (Reset button
// affordability, modal copy) without a hand-duplicated second copy of the
// number that could silently drift out of sync with this one.
export const RESPEC_COST_CREDITS = 50; // launch placeholder, not balance-tested, same spirit as MISSIONS/talent costs

// Sequential, mutually-exclusive per-tier roll for ONE whole tick of
// extraction (2026-07-08 Extraction Rework -- see the design doc). Replaces
// the old independent-and-subtractive mechanic (uncommon and rare each
// rolled separately, both COULD occur in the same tick, whatever hit was
// subtracted from a shared extractionRatePerTick pool, common absorbed the
// leftover). That old bucket-roll for uncommon's amount (75% -> 1 unit, 20%
// -> 2 units, 5% -> 3 units) and rare's flat-1-unit cap are both GONE --
// there is no per-tier amount cap anymore. Rare is checked first; if it
// misses, uncommon is checked; if that also misses, common wins by default.
// Exactly one of the three tiers wins each tick, and the winner is awarded
// the FULL extractionRatePerTick base amount for that tick (scaled by its
// own yieldMult) -- not a fraction of it, not a capped bucket roll.
//
// Only 1 or 2 rng() calls happen, NEVER 3 or more:
//   1. does rare occur (rng() < effective rare chance) -- if yes, STOP here, 1 call total.
//   2. IF rare missed: does uncommon occur (rng() < effective uncommon chance) -- if yes, STOP here, 2 calls total.
//   3. IF both missed: common wins -- this is a guaranteed, non-conditional return, no roll needed.
// This fixed, capped call count matters for hand-tracing a deterministic test
// rng, and for the closed-form guarantee tickCaptainMission depends on (use
// a CONSTANT, non-stateful rng in tests -- see that function's own comment):
// a caller can always reason about how many rng() calls one invocation of
// this function consumes without needing to know the outcome first.
//
// Behavior change worth flagging for anyone reading/testing this function:
// under the OLD mechanic, only commonYieldMult could meaningfully move the
// deterministic per-tick total in most cases, since uncommon/rare were
// capped at small flat amounts (1-3 units) regardless of the mission's
// actual per-tick rate. Under THIS mechanic, uncommonYieldMult and
// rareYieldMult now ALSO change the deterministic per-tick total whenever
// that tier wins the roll, because the winning tier receives the FULL
// per-tick base amount (extractionRatePerTick) scaled by its own mult --
// e.g. a high rareYieldMult now produces a large delivered amount on any
// tick where rare actually hits, not just a scaled flat-1 unit like before.
function rollExtractionTick(
  missionDef: MissionDef,
  bonuses: {
    commonYieldMult: number;
    uncommonYieldMult: number;
    uncommonChanceMult: number;
    rareYieldMult: number;
    rareChanceMult: number;
  },
  rng: () => number
): Record<LootMaterialKey, Decimal> {
  const effectiveUncommonChance = Math.min(1, missionDef.uncommonChance * (1 + bonuses.uncommonChanceMult));
  const effectiveRareChance = Math.min(1, missionDef.rareChance * (1 + bonuses.rareChanceMult));
  const baseAmount = new Decimal(missionDef.extractionRatePerTick);

  if (rng() < effectiveRareChance) {
    return { commonOre: new Decimal(0), uncommonMaterial: new Decimal(0), rareMaterial: baseAmount.times(1 + bonuses.rareYieldMult) };
  }
  if (rng() < effectiveUncommonChance) {
    return { commonOre: new Decimal(0), uncommonMaterial: baseAmount.times(1 + bonuses.uncommonYieldMult), rareMaterial: new Decimal(0) };
  }
  return { commonOre: baseAmount.times(1 + bonuses.commonYieldMult), uncommonMaterial: new Decimal(0), rareMaterial: new Decimal(0) };
}

// The bonus roll (Resourcefulness's Lucky Strike I/II) reuses the PRIMARY
// roll's own effectiveRareChance/effectiveUncommonChance formulas (so
// rareChanceMult/uncommonChanceMult talents boost the bonus roll too), but
// replaces the primary roll's guaranteed-common floor with a 30% CHANCE at
// common -- unlike rollExtractionTick, this roll can produce NOTHING. Called
// only when the separate bonus-roll TRIGGER check (captainBonusRollChance/
// captainBonusRollChanceMult, checked by the caller BEFORE this function is
// invoked) has already succeeded -- this function itself has no trigger
// check of its own, it IS the mini-sequence that runs once triggered.
//
// Up to 3 rng() calls (rare, then uncommon, then the 30% common check), same
// early-return-per-branch shape as rollExtractionTick, so the two functions'
// combined call count per whole tick stays easy to hand-trace: 1 (bonus
// trigger check, made by the caller) + up to 3 (this function) on top of
// rollExtractionTick's own 1-2, for a range of 3-6 total rng() calls per
// tick depending on outcomes.
const BONUS_ROLL_COMMON_CHANCE = 0.3;

function rollBonusExtractionTick(
  missionDef: MissionDef,
  bonuses: {
    commonYieldMult: number;
    uncommonYieldMult: number;
    uncommonChanceMult: number;
    rareYieldMult: number;
    rareChanceMult: number;
  },
  rng: () => number
): Record<LootMaterialKey, Decimal> {
  const effectiveUncommonChance = Math.min(1, missionDef.uncommonChance * (1 + bonuses.uncommonChanceMult));
  const effectiveRareChance = Math.min(1, missionDef.rareChance * (1 + bonuses.rareChanceMult));
  const baseAmount = new Decimal(missionDef.extractionRatePerTick);

  if (rng() < effectiveRareChance) {
    return { commonOre: new Decimal(0), uncommonMaterial: new Decimal(0), rareMaterial: baseAmount.times(1 + bonuses.rareYieldMult) };
  }
  if (rng() < effectiveUncommonChance) {
    return { commonOre: new Decimal(0), uncommonMaterial: baseAmount.times(1 + bonuses.uncommonYieldMult), rareMaterial: new Decimal(0) };
  }
  if (rng() < BONUS_ROLL_COMMON_CHANCE) {
    return { commonOre: baseAmount.times(1 + bonuses.commonYieldMult), uncommonMaterial: new Decimal(0), rareMaterial: new Decimal(0) };
  }
  return emptyLootTotals(); // all three missed -- the bonus roll produces nothing this tick
}

// MUST be closed-form: calling this once with a large ticksElapsed must
// produce the same result as calling it many times with a small ticksElapsed
// summing to the same total. Generalized from "one continuous quantity
// clamped at one threshold" to "a sequence of 5 phase thresholds that wraps
// back to the start on completion, unless recalled." One call with a large
// ticksElapsed must resolve EVERY phase transition, extraction loot roll,
// and auto-repeat cycle that ticksElapsed represents -- not just the first
// one -- which is what the while loop below does.
//
// `ticksElapsed` is NOT deltaSeconds -- it's the caller's job (tick(), in
// this same file) to convert deltaSeconds into ticksElapsed by dividing by
// the fleet's shared tickDurationSeconds. This keeps mission progress on a
// consistent fleet-wide cadence, rather than inventing a second timing
// system.
export function tickCaptainMission(
  ticksElapsed: number,
  captain: CaptainState,
  rng: () => number = Math.random,
  // Every field defaults to 0 (no bonus) so every existing call site/test
  // that omits this 4th arg (or omits individual fields) behaves EXACTLY as
  // before -- the caller (tick(), below) sums each captain-level helper +
  // the fleet-wide one (rareYieldMult only, per the design doc) into one
  // value per field before calling in.
  bonuses: {
    commonYieldMult?: number;
    uncommonYieldMult?: number;
    uncommonChanceMult?: number;
    rareYieldMult?: number;
    rareChanceMult?: number;
    bonusRollChance?: number;
    bonusRollChanceMult?: number;
    // Captain Specialization's flat addition to the bonus-roll TRIGGER chance
    // (CAPTAIN_SPEC_BONUS.resourcefulness) -- kept as its own field, NOT
    // merged into bonusRollChance, so the extraction loop below can add it
    // AFTER bonusRollChance*(1+bonusRollChanceMult) is computed rather than
    // before (see captainSpecBonusRollChance's own comment for why order
    // matters here).
    specBonusRollChance?: number;
  } = {},
  // The assigned ship's three derived stats (cargoCapacity, transitSpeedMult,
  // extractionYieldMult), or null for "no ship modifier" -- the default, which
  // reproduces this function's pre-Task-6 behavior EXACTLY, so every existing
  // call site/test that omits this 5th arg is unaffected. Applied by modifying
  // the INPUTS to the existing closed-form machinery, NOT by changing the while
  // loop: transit/cargo fold into missionDef (once, before the loop) via
  // effectiveMissionDef, and extractionYieldMult folds into resolvedBonuses'
  // per-tier yield mults (also once, before the loop). Both stay constant for
  // the whole call, so the "one big jump == many small ticks" guarantee holds
  // for the exact same reason the `bonuses` constant above does. tick() resolves
  // the assigned hull to these stats and passes them in (Task 7); this function
  // no longer reads captain.shipType at all (removed in Task 3).
  shipStats: ShipDerivedStats | null = null
): {
  captain: CaptainState;
  homePlanetDelta: Record<LootMaterialKey, Decimal>;
  fleetAdminXpDelta: number;
  creditsDelta: number;
  // Task 6: lifetime-stat accrual for this call, folded into state.lifetimeStats
  // by tick(). Always present (zeroed on the early-outs), never undefined.
  lifetimeStatsDelta: MissionLifetimeStatsDelta;
} {
  if (!captain.mission || ticksElapsed <= 0) {
    return {
      captain,
      homePlanetDelta: emptyLootTotals(),
      fleetAdminXpDelta: 0,
      creditsDelta: 0,
      lifetimeStatsDelta: emptyMissionLifetimeStatsDelta(),
    };
  }

  // Resolve the mission's transit + cargo geometry ONCE, before the while loop
  // below -- exactly like resolvedBonuses further down. effectiveMissionDef
  // rescales transitOut/BackTicks by the ship's transitSpeedMult (ceil, so they
  // stay integer) and swaps in the ship's cargoCapacity (which drives the
  // extracting phase's length via requiredTicksForPhase). Because this is
  // computed once and stays CONSTANT across every loop iteration, every phase's
  // requiredTicksForPhase value is identical whether the call was made as one
  // big ticksElapsed or as many small ones -- so the closed-form guarantee is
  // preserved. Do NOT move this inside the loop: a per-iteration recompute would
  // still yield the same numbers (effectiveMissionDef is pure), but computing it
  // once is both cheaper and the clearest signal that it's a call-constant.
  const rawMissionDef = MISSIONS[captain.mission.missionKey];
  const missionDef = shipStats ? effectiveMissionDef(rawMissionDef, shipStats) : rawMissionDef;
  let mission: CaptainMissionState | null = { ...captain.mission, cargo: { ...captain.mission.cargo } };
  let remaining = ticksElapsed;
  const homePlanetDelta = emptyLootTotals();
  // Seeded from the captain's CURRENT xp/level/statPoints. Task 4 (Progression
  // Pacing Rework) changed WHEN these mutate: captain XP is no longer a lump
  // awarded inside the cycle-completion branch, it accrues per WHOLE tick the
  // mission advances (see wholeTicksElapsed below). So the XP award + the
  // level-up loop now run exactly ONCE, AFTER the while loop, off the total
  // whole ticks counted -- not once per completed cycle.
  let xp = captain.xp;
  let level = captain.level;
  let statPoints = captain.statPoints;
  // Total WHOLE ticks the mission actually advances this call, summed across
  // every phase (orders/transit/extract/unload alike). Captain XP is awarded
  // as xpRate * this count after the loop. Counted on whole-tick boundaries --
  // the SAME closed-form device the extraction loot rolls use below -- so the
  // accrual is chunk-invariant: one big ticksElapsed and many small ones
  // summing to it credit the identical integer tick count (a sub-whole partial
  // tick credits nothing until a later call completes it), and because the
  // count only ever grows by integers, the Decimal XP sum carries no
  // fractional drift across chunking. A mission that terminates partway (e.g.
  // recall) simply stops contributing once the loop exits -- ticks never
  // advanced are never counted, matching a tick-by-tick stepping exactly.
  let wholeTicksElapsed = 0;
  // The per-tick XP RATE for this mission, resolved ONCE (call-constant): the
  // missionKey is fixed for the whole call (auto-repeat reuses the same key),
  // and xpPerTick ignores level/state today, so pulling it out of the loop is
  // both cheaper and a clear signal it does not vary per tick. Read off
  // captain.mission (guaranteed non-null past the early return above) rather
  // than the local `mission`, which can become null on a recall before we use
  // this after the loop.
  const xpRate = xpPerTick(captain.mission.missionKey, captain);
  // The mission key this call runs, captured ONCE (call-constant: auto-repeat
  // reuses the same key). Used only to key the lifetimeStatsDelta.missionsCompleted
  // tally below. Read off captain.mission (guaranteed non-null past the early
  // return) rather than the local `mission`, which can go null on a recall.
  const missionKey = captain.mission.missionKey;
  // The per-tick Fleet Admiral XP RATE for this mission, resolved ONCE
  // (call-constant), mirroring xpRate directly above. Read off missionDef -- the
  // ship-adjusted def -- which is safe because effectiveMissionDef preserves
  // fleetAdminXpPerTick unchanged (it only rescales transit/cargo geometry); it
  // is fixed for the whole call since auto-repeat reuses the same missionKey.
  // Awarded after the loop as fleetAdminXpRate * wholeTicksElapsed, the SAME
  // whole-tick count captain XP uses (Task 5).
  const fleetAdminXpRate = missionDef.fleetAdminXpPerTick;
  // Accumulates this captain's Fleet Admiral XP contribution for this call.
  // Progression Pacing Rework (Task 5): FA XP is no longer a per-completed-cycle
  // lump -- it now accrues per WHOLE tick the mission advances, awarded ONCE after
  // the loop (fleetAdminXpRate * wholeTicksElapsed), right beside the captain-XP
  // award, using the SAME wholeTicksElapsed counter. tick() sums this across every
  // captain fleet-wide before handing the total to applyFleetAdminXp -- so N
  // captains each on an active mission stack to N FA XP/tick automatically, no
  // stacking-specific code. Kept a plain `number` (integer-exact at the rate-1
  // today); see the ⚠️ parity trap at the award line before ever making the rate
  // fractional.
  let fleetAdminXpDelta = 0;
  // Accumulates this captain's credits contribution across every mission
  // cycle completed within this call -- same "accumulate locally, apply
  // once" shape as fleetAdminXpDelta immediately above. tick() sums this
  // across every captain fleet-wide, then applies it to state.credits with a
  // flat .plus() (credits has no leveling curve, unlike fleetAdminXpDelta).
  let creditsDelta = 0;
  // Task 6: counts the mission cycles COMPLETED within this call (the same
  // cycle-completion branch that awards credits below can fire many times in one
  // big offline-catchup call). Closed-form for the same reason creditsDelta is --
  // it increments in lockstep with that branch, so one big call and many small
  // ones summing to the same span count the identical number of completions.
  // Rolled into lifetimeStatsDelta.missionsCompleted[missionKey] after the loop.
  let cyclesCompleted = 0;

  // The ship's extractionYieldMult is a MULTIPLIER (1.0 = no change, 1.35 =
  // +35%), but resolvedBonuses' tier yield mults are stored as ADDITIVE deltas
  // on top of a 1.0 base (rollExtractionTick does baseAmount*(1+mult)). So a
  // ship yield of 1.35x contributes +0.35, added on top of whatever talent
  // yield bonuses the caller already summed into `bonuses`. null ship -> 0
  // (no change). This folds ALL THREE tiers equally: the hull scales how much
  // ore/material each extracting tick produces, regardless of which tier won.
  const shipYieldBonus = shipStats ? shipStats.extractionYieldMult - 1 : 0;

  // Computed ONCE per call, not per roll -- bonuses are constant for the
  // whole call, so this stays closed-form (the "one big jump equals many
  // small ticks" test doesn't care how many rolls happen, only that each
  // roll uses the same resolved bonuses either way). shipYieldBonus, added
  // to the three tier yield mults below, is likewise a call-constant -- it's
  // derived from shipStats (fixed for the whole call), so it does not disturb
  // the closed-form property. It touches ONLY the three *YieldMult fields
  // (extraction AMOUNTS); the chance/bonus-roll fields are left untouched --
  // a hull's cargo/yield stats change how much a tick yields, not the odds of
  // hitting a tier or triggering a bonus roll.
  const resolvedBonuses = {
    commonYieldMult: (bonuses.commonYieldMult ?? 0) + shipYieldBonus,
    uncommonYieldMult: (bonuses.uncommonYieldMult ?? 0) + shipYieldBonus,
    uncommonChanceMult: bonuses.uncommonChanceMult ?? 0,
    rareYieldMult: (bonuses.rareYieldMult ?? 0) + shipYieldBonus,
    rareChanceMult: bonuses.rareChanceMult ?? 0,
    bonusRollChance: bonuses.bonusRollChance ?? 0,
    bonusRollChanceMult: bonuses.bonusRollChanceMult ?? 0,
    specBonusRollChance: bonuses.specBonusRollChance ?? 0,
  };

  while (remaining > 0 && mission !== null) {
    const requiredTicks = requiredTicksForPhase(mission.phase, missionDef);
    const ticksLeftInPhase = requiredTicks - mission.phaseProgressTicks;
    let ticksToApply = Math.min(remaining, ticksLeftInPhase);

    // Snap to the exact phase boundary when float drift leaves the tentative
    // post-step progress within epsilon of it. Recomputing ticksToApply from
    // requiredTicks (rather than nudging the comparison alone) keeps the
    // extraction roll count below and the completion check further down
    // reading the SAME corrected value, so neither can disagree with the other.
    if (Math.abs(mission.phaseProgressTicks + ticksToApply - requiredTicks) < MISSION_TICK_EPSILON) {
      ticksToApply = requiredTicks - mission.phaseProgressTicks;
    }

    // Task 4: count the WHOLE ticks this step crosses, for captain-XP accrual.
    // Same floor-boundary device as the extracting loot rolls below, but applied
    // in EVERY phase (XP accrues whenever the mission is in progress, not only
    // while extracting). Computed BEFORE phaseProgressTicks is advanced (needs
    // the pre-step value). Kept as its own two Math.floor lines rather than
    // sharing the extracting block's identical computation: that block is
    // delicate closed-form loot code under a strict do-not-touch, and the two
    // extra floors per iteration are negligible -- readability/isolation over a
    // micro-consolidation. That deferred consolidation is logged in
    // SUGGESTIONS.md ("Consolidate the whole-tick floor-boundary device...").
    wholeTicksElapsed +=
      Math.floor(mission.phaseProgressTicks + ticksToApply) - Math.floor(mission.phaseProgressTicks);

    if (mission.phase === "extracting") {
      // Roll loot once per WHOLE tick boundary crossed during this step --
      // NOT once per step, since a single step can span many whole ticks
      // during a large offline-catchup jump. E.g. going from
      // phaseProgressTicks 2.4 by ticksToApply 4 (to 6.4) crosses whole
      // boundaries 3, 4, 5, 6 -- 4 rolls, matching 4 whole ticks' worth of
      // extraction, regardless of how this call got chunked.
      const fromWhole = Math.floor(mission.phaseProgressTicks);
      const toWhole = Math.floor(mission.phaseProgressTicks + ticksToApply);
      const rollsThisStep = toWhole - fromWhole;
      for (let i = 0; i < rollsThisStep; i++) {
        const delta = rollExtractionTick(missionDef, resolvedBonuses, rng);
        mission.cargo.commonOre = mission.cargo.commonOre.plus(delta.commonOre);
        mission.cargo.uncommonMaterial = mission.cargo.uncommonMaterial.plus(delta.uncommonMaterial);
        mission.cargo.rareMaterial = mission.cargo.rareMaterial.plus(delta.rareMaterial);

        // Bonus-roll trigger check runs every whole tick, independent of what
        // the primary roll above produced (see rollBonusExtractionTick's own
        // comment for why). 1 rng() call for the trigger itself; if it
        // fires, rollBonusExtractionTick makes up to 3 more.
        //
        // specBonusRollChance is added AFTER the base*(1+mult) scaling, NOT
        // folded into resolvedBonuses.bonusRollChance beforehand -- see
        // captainSpecBonusRollChance's own comment for the exact overshoot
        // this ordering avoids (0.06 instead of the design doc's 0.05 target
        // for a resourcefulness-specced captain with both Lucky Strike
        // talents unlocked).
        const effectiveBonusRollChance = Math.min(
          1,
          resolvedBonuses.bonusRollChance * (1 + resolvedBonuses.bonusRollChanceMult) +
            resolvedBonuses.specBonusRollChance
        );
        if (rng() < effectiveBonusRollChance) {
          const bonusDelta = rollBonusExtractionTick(missionDef, resolvedBonuses, rng);
          mission.cargo.commonOre = mission.cargo.commonOre.plus(bonusDelta.commonOre);
          mission.cargo.uncommonMaterial = mission.cargo.uncommonMaterial.plus(bonusDelta.uncommonMaterial);
          mission.cargo.rareMaterial = mission.cargo.rareMaterial.plus(bonusDelta.rareMaterial);
        }
      }
    }

    mission.phaseProgressTicks += ticksToApply;
    remaining -= ticksToApply;
    // A phase that completes with call budget left over (spilling into the
    // next phase within this same call) can leave a sub-epsilon residue in
    // `remaining` even after the snap above (e.g. 2.58e-15), since `remaining`
    // itself was never snapped -- only `ticksToApply` was. Left uncorrected,
    // that residue becomes the NEXT phase's starting phaseProgressTicks,
    // making a many-small-calls chain disagree with a single big call even
    // though every phase transition landed on the exact same boundary.
    if (Math.abs(remaining) < MISSION_TICK_EPSILON) {
      remaining = 0;
    }

    if (mission.phaseProgressTicks >= requiredTicks) {
      const nextIndex = MISSION_PHASE_ORDER.indexOf(mission.phase) + 1;
      if (nextIndex >= MISSION_PHASE_ORDER.length) {
        // Just completed "unloading" -- one full cycle is done.
        // Capture cargo in a const: `mission` is a `let` (CaptainMissionState |
        // null), and TS drops its non-null narrowing inside the forEach closure.
        const cargo = mission.cargo;
        (Object.keys(cargo) as LootMaterialKey[]).forEach((key) => {
          homePlanetDelta[key] = homePlanetDelta[key].plus(cargo[key]);
        });
        // Credits are still awarded once PER completed cycle (this branch can be
        // reached multiple times within one call's while loop -- e.g. a big
        // offline-catchup ticksElapsed spanning several full cycles). Captain XP
        // (Task 4) AND Fleet Admiral XP (Task 5) are NO LONGER awarded here: both
        // now accrue per WHOLE tick, awarded once after the loop (see below), so
        // this branch touches only the credit total now.
        creditsDelta += missionDef.creditsPerCycle;
        // Task 6: one more completed cycle -- counted in the SAME branch as the
        // credit award and the loot delivery above, so all three (loot,
        // credits, completion count) stay perfectly in sync per cycle.
        cyclesCompleted += 1;
        if (mission.recalled) {
          mission = null;
        } else {
          mission = {
            missionKey: mission.missionKey,
            phase: "ordersReceived",
            phaseProgressTicks: 0,
            cargo: emptyLootTotals(),
            recalled: false,
          };
        }
      } else {
        mission.phase = MISSION_PHASE_ORDER[nextIndex];
        mission.phaseProgressTicks = 0;
      }
    }
  }

  // Task 4: award captain XP ONCE per call, for the total whole ticks the
  // mission advanced above (xpRate is a call-constant). Then resolve every
  // level-up crossed by that award -- the SAME subtract-threshold loop as
  // before (unchanged semantics), just relocated out of the per-cycle branch
  // and run a single time: a while (not if) loop so a large offline-catchup
  // accrual can climb multiple levels, bounded by MAX_LEVEL_UPS_PER_TICK with
  // any excess left in xp to carry forward to a later call (mirrors
  // applyFleetAdminXp's own carry-forward). Because this loop fully drains all
  // crossable thresholds each call, awarding the total as one lump lands the
  // identical level/statPoints/leftover-xp as accruing it tick-by-tick.
  //
  // ⚠️ CLOSED-FORM PARITY TRAP -- READ BEFORE CHANGING xpRate TO A FRACTION ⚠️
  // The exact "one big call == many small calls" guarantee (protected by the
  // closed-form parity test in tick.test.ts) holds TODAY because xpRate is the
  // integer 1 (xpPerTick returns BASE_XP_PER_TICK unchanged). The big call adds
  // xpRate*(total whole ticks) in ONE product; the stepped path adds
  // xpRate*(per-call whole ticks) many times. Those two agree ONLY when the
  // per-product arithmetic is exact -- which integer rates guarantee, but a
  // FRACTIONAL rate does NOT: 0.1*3 !== 0.1+0.1+0.1 in floating point, so the
  // moment xpPerTick starts returning a fractional rate (see its documented
  // XP-mult seam), a single big-call product can silently diverge from the
  // stepped sum and break parity -- and the current rate-1 parity test will NOT
  // catch it. Using Decimal below (new Decimal(xpRate).times(...)) is
  // defense-in-depth, NOT a proof: Decimal reduces but does not by itself
  // guarantee distributivity for an arbitrary fractional rate. Before shipping
  // any fractional rate you MUST (a) re-derive this accrual to stay drift-free
  // at that rate, and (b) add a closed-form parity test AT the real fractional
  // rate -- that test, not the Decimal call, is the actual safeguard.
  // Captured as its own const (identical value to the previous inline expression --
  // behavior-preserving) so Task 6 can report the GROSS XP awarded this call in
  // lifetimeStatsDelta.captainXpAwarded below, distinct from the captain's own `xp`
  // (which the level-up loop then drains by subtracting thresholds).
  const captainXpAwardedThisCall = new Decimal(xpRate).times(wholeTicksElapsed);
  xp = xp.plus(captainXpAwardedThisCall);
  let levelUpsThisCall = 0;
  while (xp.gte(xpForNextLevel(level)) && levelUpsThisCall < MAX_LEVEL_UPS_PER_TICK) {
    xp = xp.minus(xpForNextLevel(level));
    level += 1;
    statPoints += 1;
    levelUpsThisCall += 1;
  }

  // Task 5: award Fleet Admiral XP ONCE per call, for the total whole ticks the
  // mission advanced above -- the SAME wholeTicksElapsed counter captain XP uses
  // just above, and the SAME per-active-tick model. Relocated OUT of the per-cycle
  // completion branch (where it used to add missionDef.fleetAdminXpPerCycle once
  // per finished cycle) to here, so FA XP now tracks active TIME, not cycle count.
  // tick() sums this fleetAdminXpDelta across every captain fleet-wide, so N
  // captains each on an active mission stack to N FA XP/tick with no extra code.
  //
  // ⚠️ CLOSED-FORM PARITY TRAP -- READ BEFORE MAKING fleetAdminXpRate FRACTIONAL ⚠️
  // Mirrors the captain-XP trap just above: the exact "one big call == many small
  // calls" guarantee (protected by the closed-form parity test in tick.test.ts)
  // holds TODAY because fleetAdminXpRate is the integer 1. The big call adds
  // fleetAdminXpRate * (total whole ticks) in ONE product; the stepped path adds
  // fleetAdminXpRate * (per-call whole ticks) many times -- those two agree ONLY
  // when each product is exact, which integer rates guarantee but a FRACTIONAL
  // rate does NOT (0.1*3 !== 0.1+0.1+0.1 in floating point). fleetAdminXpDelta is
  // a plain `number`, integer-exact at rate 1 (no Decimal wrap needed at this rate
  // -- unlike captain XP, whose total is a Decimal for its own big-number reasons).
  // The moment any mission's fleetAdminXpPerTick becomes fractional you MUST (a)
  // re-derive this accrual to stay drift-free at that rate, and (b) add a
  // closed-form parity test AT that fractional rate -- the current rate-1 parity
  // test will NOT catch the regression, and the `number` type is not itself a
  // proof of parity.
  //
  // Captured as its own const (single source for the product), used at BOTH the
  // fleetAdminXpDelta accrual just below and the lifetimeStatsDelta.fleetAdminXpAwarded
  // field -- mirroring captainXpAwardedThisCall's single-source treatment above.
  // Value-identical to the previous two-site computation; no behavior change.
  const fleetAdminXpAwardedThisCall = fleetAdminXpRate * wholeTicksElapsed;
  fleetAdminXpDelta += fleetAdminXpAwardedThisCall;

  // Task 6: assemble the lifetime-stat delta for this call.
  // - itemsGathered mirrors homePlanetDelta EXACTLY: inside this function
  //   homePlanetDelta is populated ONLY by the cycle-completion loot delivery
  //   above (passiveTrickle lives in tick(), not here), so it already IS the total
  //   raw loot delivered this call. A shallow clone (new object, same immutable
  //   Decimal refs) keeps it independent of the returned homePlanetDelta the caller
  //   also folds. All 3 loot keys are always present (emptyLootTotals seed), so a
  //   tier that delivered nothing records a 0 -- deliberately mirroring, not
  //   filtering, what went to homePlanetDelta.
  // - missionsCompleted is sparse: only the one running missionKey, only when at
  //   least one cycle finished (kept absent at 0 per the maps' sparse-by-design
  //   contract), so a call that completes no cycle contributes an empty map.
  // - creditsEarned mirrors creditsDelta; captainXpAwarded is the GROSS award
  //   captured pre-level-up; fleetAdminXpAwarded wraps the same fleetAdminXpAwardedThisCall
  //   const folded into fleetAdminXpDelta above, as a Decimal for the lifetime sum.
  const lifetimeStatsDelta: MissionLifetimeStatsDelta = {
    itemsGathered: { ...homePlanetDelta },
    missionsCompleted: cyclesCompleted > 0 ? { [missionKey]: new Decimal(cyclesCompleted) } : {},
    creditsEarned: new Decimal(creditsDelta),
    captainXpAwarded: captainXpAwardedThisCall,
    fleetAdminXpAwarded: new Decimal(fleetAdminXpAwardedThisCall),
  };

  return {
    captain: { ...captain, mission, xp, level, statPoints },
    homePlanetDelta,
    fleetAdminXpDelta,
    creditsDelta,
    lifetimeStatsDelta,
  };
}

// Replaces the old recomputeFleetAdmin (which recomputed fleetAdminXp fresh
// each call as the sum of every captain's level -- effectively frozen under
// realistic play, see this plan's design doc for the live-tested root
// cause). This function instead ADDS an already-computed delta (summed
// across every captain's completed mission cycles this call, fleet-wide,
// same "accumulate locally, apply once" shape as homePlanetDelta) and
// resolves level-ups by SUBTRACTING the threshold each time -- mirroring
// captain XP's own subtract-and-carry-forward loop exactly, capped at
// MAX_LEVEL_UPS_PER_TICK to guard against a very large offline-catchup
// delta (see that constant's own comment above).
//
// CORRECTNESS NOTE (found during this branch's final holistic review): the
// no-op guard checks for an unresolved BACKLOG, not just "did this call add
// anything." If a PRIOR call's delta was large enough to hit
// MAX_LEVEL_UPS_PER_TICK, that call returns with fleetAdminXp still sitting
// AT OR ABOVE the next threshold (deliberately, so no XP is lost) -- an
// early-return keyed on `fleetAdminXpDelta <= 0` alone would then freeze that
// backlog forever on every subsequent poll that doesn't ALSO carry a fresh
// positive delta, contradicting this function's own intent (leftover XP
// should keep resolving on later calls, the same way it's designed to).
// Checking `hasBacklog` here means a delta-0 poll still drains an existing
// backlog if one exists, while remaining the same cheap same-reference
// no-op it always was for the overwhelmingly common case (no delta, no
// backlog). This is only reachable at all with a delta on the order of
// 10^14+ (see MAX_LEVEL_UPS_PER_TICK's own comment and this function's tests
// in tick.test.ts) -- astronomically unlikely in practice, but worth being
// actually correct about rather than leaving a comment that overstates what
// the code did.
export function applyFleetAdminXp(state: GameState, fleetAdminXpDelta: number): GameState {
  const startingXp = fleetAdminXpDelta > 0 ? state.fleetAdminXp.plus(fleetAdminXpDelta) : state.fleetAdminXp;
  const hasBacklog = startingXp.gte(xpForNextFleetAdminLevel(state.fleetAdminLevel));
  if (fleetAdminXpDelta <= 0 && !hasBacklog) return state; // cheap no-op: no new XP this call, and nothing left over from a prior capped call to resolve

  let xp = startingXp;
  let level = state.fleetAdminLevel;
  let adminPoints = state.adminPoints;
  let levelUpsThisCall = 0;
  while (xp.gte(xpForNextFleetAdminLevel(level)) && levelUpsThisCall < MAX_LEVEL_UPS_PER_TICK) {
    xp = xp.minus(xpForNextFleetAdminLevel(level));
    level += 1;
    adminPoints += 1;
    levelUpsThisCall += 1;
  }

  return { ...state, fleetAdminXp: xp, fleetAdminLevel: level, adminPoints };
}

// Ship Production Economy (Phase 1, Task 4): the SINGLE add-to-inventory seam.
// Every code path that GRANTS an item -- mission loot delivery + passiveTrickle
// (tick(), below) and craft output (craftRecipe, further below) -- routes its
// addition through here, so the "gaining an item reveals it in the discovered
// (❓ -> rarity-color) set" rule lives in exactly ONE place and cannot drift
// between call sites (the same single-source discipline foldLifetimeStatsDelta
// uses for lifetime stats).
//
// Returns NEW inventory + discovered objects (the inputs are never mutated),
// matching the immutable-update style the rest of this file uses: callers thread
// the returned pair forward rather than writing in place. An inventory[itemId]
// that is absent starts from Decimal(0) before the add, preserving the map's
// grow-on-demand contract (a brand-new itemId can be granted without pre-seeding
// it) -- for today's callers the 3 loot keys / the 2 craft-output keys are all
// pre-seeded (freshState/migration), so the `?? new Decimal(0)` never actually
// fires and the add is value-identical to the old `storage[key].plus(amount)`.
//
// DISCOVERY IS GATED ON A POSITIVE amount: a 0 (or negative) add marks NOTHING
// discovered -- you have not "seen" an item you did not actually receive. This
// matters because tick()'s loot delivery folds all three loot tiers every call,
// most of them a 0 delta on any given tick; only the tier that actually
// delivered a positive amount this call should flip to discovered. Deducts
// (craftRecipe inputs) do NOT come through here at all -- they are a plain
// .minus() on the inventory clone, never a discovery event.
// Exported (Phase 1, Task 5) so App.svelte's live-poll loot-delivery path can
// route through this SAME add seam tick()'s offline catch-up uses -- one shared
// helper is what makes the live and offline inventory writes byte-identical
// (drift-proof). Task 4 declared this helper for tick()'s own use but left it
// module-private; Task 5 consuming it from App.svelte is the reason it is now
// exported. Behaviour is unchanged -- this is a visibility-only change.
export function addToInventory(
  inventory: Record<string, Decimal>,
  discovered: string[],
  itemId: string,
  amount: Decimal
): { inventory: Record<string, Decimal>; discovered: string[] } {
  const nextInventory = { ...inventory };
  nextInventory[itemId] = (nextInventory[itemId] ?? new Decimal(0)).plus(amount);
  const nextDiscovered =
    amount.gt(0) && !discovered.includes(itemId) ? [...discovered, itemId] : discovered;
  return { inventory: nextInventory, discovered: nextDiscovered };
}

// Phase 2 (Task A2, docs/plans/phase2-tick-map.md): the per-span economy body,
// extracted VERBATIM from tick() below so live play (App.svelte's poll loop) and
// offline catch-up (tick()) can share ONE implementation of the divergence
// surface -- the 8-field `bonuses` build + ship-stat resolution, the
// passiveTrickle loop, the loot -> addToInventory fold, the load-bearing ordering
// (mission/lifetime fold BEFORE resolveProcesses), and the credits / FA-XP /
// gameTimeSeconds accumulation. Historically those were hand-mirrored in both
// paths and drifted (ship stats, bonus-roll, credits -- all logged); centralizing
// them here is the whole point. This is a MECHANICAL lift, not a math rewrite:
// nothing in the moved arithmetic changed.
//
// Pure/deterministic given (state, ticksElapsed, rng): advancing by ticksElapsed
// in ONE call equals advancing by chunks summing to ticksElapsed, because every
// subsystem this calls (tickCaptainMission / resolveProcesses / applyFleetAdminXp)
// is already closed-form (see tickCaptainMission's header). That is what lets a
// later task (A4) drive the offline span as a chunk loop; today tick() still
// calls it ONCE over the whole span, exactly as the pre-extraction code did.
//
// Idle captains (mission === null) have no passive economy anymore -- missions
// are the only way a captain does anything. Only mission captains need advancing;
// this is the sole reason to even call .map() below rather than filtering.
// gameTimeSeconds and the keyed inventory are fleet-wide bookkeeping, each updated
// exactly once per call (not once per captain).
export function economyTick(state: GameState, ticksElapsed: number, rng: () => number = Math.random): GameState {
  // gameTimeSeconds is tracked in SECONDS, but economyTick is handed ticksElapsed
  // (not deltaSeconds), so recover the elapsed seconds via the fleet's shared
  // tickDurationSeconds -- the EXACT inverse of tick()'s
  // `deltaSeconds / tickDurationSeconds` conversion. So the value used here is
  // `(deltaSeconds / tickDurationSeconds) * tickDurationSeconds`, which round-trips
  // to the original deltaSeconds bit-exactly when tickDurationSeconds is 1 (the
  // fresh default, model.ts) or any power of two, and is within 1 ULP for any
  // other value. gameTimeSeconds is display-only fleet bookkeeping that NOTHING
  // downstream in this function reads -- deltaSeconds is used ONLY at the
  // gameTimeSeconds increment below -- so this is behavior-equivalent to the old
  // inline `state.gameTimeSeconds + deltaSeconds`.
  const deltaSeconds = ticksElapsed * state.tickDurationSeconds;

  const homePlanetDelta = emptyLootTotals();
  // Accumulates fleet-wide Fleet Admiral XP across every captain's completed
  // mission cycles this call -- same accumulate-locally-apply-once shape as
  // homePlanetDelta immediately above. Consumed once, at the end of this
  // function, by applyFleetAdminXp.
  let fleetAdminXpDelta = 0;
  // Accumulates fleet-wide credits across every captain's completed mission
  // cycles this call -- same accumulate-locally-apply-once shape as
  // fleetAdminXpDelta immediately above. Consumed once, at the end of this
  // function, via a flat state.credits.plus() -- credits has no leveling
  // curve to resolve, unlike fleetAdminXpDelta's applyFleetAdminXp call.
  let creditsDelta = 0;
  // Task 7 (Progression Pacing Rework): fleet-wide lifetimeStats accumulator,
  // SEEDED from the incoming state and folded ONE captain at a time below via the
  // shared foldLifetimeStatsDelta helper -- the exact same per-captain fold
  // App.svelte's live poll loop runs, so the two paths cannot diverge for lifetime
  // stats (that helper is the single source of truth). Replaces Task 6's five
  // parallel per-field accumulators + the separate final fold in the return
  // object: the helper now owns both the per-key map merge and the scalar sums, in
  // one place. Value-identical to the old two-stage approach (the fold is additive
  // and associative, so folding per captain lands the same totals as accumulating
  // then folding once). `let` because each fold returns a fresh object;
  // itemsRefined/itemsCrafted (never fed by the mission economy) ride through
  // untouched via the helper's spread, exactly as the old final fold's spread did.
  // If NO captain is on a mission this call, this stays === state.lifetimeStats.
  let lifetimeStats = state.lifetimeStats;
  // Computed ONCE for the whole fleet (same value for every captain), not
  // per captain inside the .map() below -- Homeworld Talents are fleet-wide,
  // not per-captain.
  const fleetRareYield = fleetRareYieldMult(state);
  const captains = state.captains.map((captain) => {
    if (captain.mission === null) return captain;
    // Phase 2 (Task B3, design §3.4): AUTO-STOP. If this mission's PRIMARY material
    // is already at its warehouse tier cap, the captain IDLES this call -- no
    // tickCaptainMission run, so no loot, no XP, no credits, no phase advance. The
    // captain object is returned UNCHANGED, exactly as an idle (mission === null)
    // captain is, so a full-material captain contributes nothing this call. This
    // check is the ONLY new gate on the per-captain path; when the primary material
    // is BELOW cap (the universal case until 1M+ is stockpiled) it is false and the
    // captain proceeds through the identical pre-B3 code below -- no behavior change.
    //
    // Placed here, inside economyTick, so it applies UNIFORMLY to live play (App.svelte
    // calls economyTick per bar) AND offline catch-up (tick()'s per-tick step loop) --
    // one seam, both paths. The check reads state.inventory as it stood at the START
    // of this call; the offline loop steps ONE tick per economyTick call (below), so
    // the cap is re-evaluated every tick and a run stops the moment its material fills
    // (correct-by-construction across the cap breakpoint). Incidental secondary drops
    // (uncommon/rare) stop WITH the run, per the design's whole-run-stop decision.
    if (materialAtCap(state, MISSIONS[captain.mission.missionKey].primaryMaterial)) {
      return captain;
    }
    // Resolve the hull this captain flies and project it to the three mission
    // stats tickCaptainMission consumes (transit/cargo/yield). GameState.ships[]
    // .assignedCaptainId is the SINGLE SOURCE OF TRUTH for who flies what -- so
    // we find THIS captain's ship by it. The invariant (every captain always
    // has exactly one assigned hull) holds post-migration (Task 4), at new-game
    // (Task 3), and at new-captain-unlock (Task 10) -- so .find() will locate a
    // hull in practice. The `ship ? ... : null` guard is belt-and-suspenders: a
    // hypothetical ship-less captain falls back to null == "no ship modifier",
    // which reproduces this loop's exact pre-ship-wiring behavior (the Freighter
    // baseline) rather than throwing on shipDerivedStats(undefined).
    const ship = state.ships.find((s) => s.assignedCaptainId === captain.id);
    const shipStats = ship ? shipDerivedStats(ship) : null;
    const bonuses = {
      commonYieldMult: captainCommonYieldMult(captain),
      uncommonYieldMult: captainUncommonYieldMult(captain),
      uncommonChanceMult: captainUncommonChanceMult(captain),
      rareYieldMult: fleetRareYield,
      rareChanceMult: captainRareChanceMult(captain),
      bonusRollChance: captainBonusRollChance(captain),
      bonusRollChanceMult: captainBonusRollChanceMult(captain),
      specBonusRollChance: captainSpecBonusRollChance(captain),
    };
    // rng passed explicitly (rather than omitted) since bonuses is positional
    // arg 4 -- omitting arg 3 here would pass bonuses AS rng. rng is economyTick's
    // own param, defaulting to Math.random, so tick()'s offline catch-up (which
    // calls economyTick without an rng) is byte-identical to the pre-extraction
    // inline Math.random; the live loop / tests can inject a deterministic rng.
    const {
      captain: updated,
      homePlanetDelta: delta,
      fleetAdminXpDelta: captainFleetAdminXpDelta,
      creditsDelta: captainCreditsDelta,
      lifetimeStatsDelta: captainLifetimeStatsDelta,
    } = tickCaptainMission(ticksElapsed, captain, rng, bonuses, shipStats);
    (Object.keys(delta) as LootMaterialKey[]).forEach((key) => {
      homePlanetDelta[key] = homePlanetDelta[key].plus(delta[key]);
    });
    fleetAdminXpDelta += captainFleetAdminXpDelta;
    creditsDelta += captainCreditsDelta;
    // Task 7: fold THIS captain's lifetime-stat delta into the fleet-wide
    // accumulator via the shared foldLifetimeStatsDelta helper -- the SAME helper
    // App.svelte's live poll loop calls per captain, so the two paths stay
    // identical by construction. Same per-captain side-effect shape as the
    // fleetAdminXpDelta/creditsDelta accumulation two lines above.
    lifetimeStats = foldLifetimeStatsDelta(lifetimeStats, captainLifetimeStatsDelta);
    return updated;
  });

  // passiveTrickle (Homeworld Talent economyTrickle): flat fleet-wide
  // material generation, independent of missions -- applies even with zero
  // captains dispatched. Scales by ticksElapsed (not deltaSeconds) to stay on
  // the same fleet-wide cadence as everything else, and multiplying by
  // ticksElapsed (rather than looping per tick) keeps this closed-form, same
  // requirement tickCaptainMission's own header comment explains.
  //
  // AUTO-STOP CONSISTENCY (Phase 2, Task B3 review -- design §3.4): a trickle is
  // a PRODUCER of its material, so it must stop the moment that material is at
  // its warehouse cap -- exactly like the mission auto-stop gate above idles a
  // captain whose primary material is full. Without this gate the trickle would
  // keep adding commonOre even while every commonOre-producing mission is
  // auto-stopped, contradicting "a full material's producers all stop." The cap
  // is read off `state` (START-of-tick inventory), the SAME snapshot the mission
  // gate above reads, so both producers make the stop decision on identical data.
  // This is additive/no-loss: a capped material simply receives no trickle THIS
  // tick (nothing is discarded), and tick()'s per-tick step loop re-evaluates the
  // cap every tick so the trickle resumes the instant the material drops below
  // cap. BELOW-cap behavior is byte-identical to before (the gate is false), so
  // the closed-form scaling for the universal below-cap case is unchanged.
  for (const key of state.unlockedHomeworldTalents) {
    const effect = HOMEWORLD_TALENTS[key].effect;
    if (
      effect.type === "passiveTrickle" &&
      (LOOT_MATERIAL_KEYS as string[]).includes(effect.material) &&
      !materialAtCap(state, effect.material)
    ) {
      homePlanetDelta[effect.material as LootMaterialKey] = homePlanetDelta[effect.material as LootMaterialKey].plus(
        effect.perTick * ticksElapsed
      );
    }
  }

  // Ship Production Economy (Phase 1, Task 4): fold the accumulated loot delta
  // (mission deliveries + passiveTrickle, BOTH already merged into homePlanetDelta
  // above) into a NEW inventory + discovered pair -- this REPLACES the old
  // homePlanet.storage write (this task stops production code writing storage;
  // a later task removes the field entirely). Every loot tier is routed through
  // addToInventory, the single add seam, so any tier that actually delivered a
  // positive amount this call is marked discovered, while a 0-delta tier neither
  // over-reveals nor changes the counts. Threaded through the 3 loot keys in turn
  // (each call returns fresh objects); seeded from the incoming
  // state.inventory/state.discovered, so a call that delivers nothing lands a
  // value-identical inventory and returns the SAME discovered reference.
  //
  // VALUES ARE IDENTICAL to the prior storage write: inventory[key] is seeded for
  // all 3 loot keys (freshState/migration), so (inventory[key] ?? 0).plus(delta)
  // equals the old storage[key].plus(delta) exactly. The old spread-then-overwrite
  // guard that preserved untouched fields (refinedMaterial/components/any future
  // key) now lives INSIDE addToInventory -- it spreads the whole inventory on each
  // add, so those keys ride through unchanged, same "don't silently drop a field"
  // protection as before.
  let inventory = state.inventory;
  let discovered = state.discovered;
  for (const key of LOOT_MATERIAL_KEYS) {
    const added = addToInventory(inventory, discovered, key, homePlanetDelta[key]);
    inventory = added.inventory;
    discovered = added.discovered;
  }

  // Phase 1, Task 9: the post-mission fleet state -- missions, passiveTrickle, and
  // the loot fold above all applied, but Fleet Admiral XP NOT yet resolved through
  // its level-up pass. Captured as a named intermediate (this was previously the
  // inline object literal passed straight to applyFleetAdminXp) SO the timed-process
  // resolver below can run against it before that final FA-XP pass. Nothing in the
  // mission/credits/loot/lifetime math above changed -- these are the exact same
  // fields with the exact same values, just held in a const instead of an inline
  // literal, so a call with no active processes lands byte-identical to before.
  const postMissionState: GameState = {
    ...state,
    captains,
    gameTimeSeconds: state.gameTimeSeconds + deltaSeconds,
    // Flat .plus() -- unlike fleetAdminXpDelta (which resolves through
    // applyFleetAdminXp's level-up loop below), credits has no leveling
    // curve to resolve, so the accumulated creditsDelta is applied directly
    // here rather than passed through a second wrapping function.
    credits: state.credits.plus(creditsDelta),
    // Loot now lands in the keyed `inventory` (+ its `discovered` reveal set).
    // The old homePlanet.storage field is GONE (removed in Task 7 -- fully
    // replaced by `inventory`), so there is nothing for `...state` to carry
    // through for it. See the loot-fold comment just above for why the values
    // are identical to the prior storage write.
    inventory,
    discovered,
    // Task 7: the fleet-wide lifetimeStats accumulated ONE captain at a time
    // above, each fold routed through the shared foldLifetimeStatsDelta helper
    // (identical to App.svelte's live loop). itemsRefined/itemsCrafted + any
    // future lifetimeStats field rode through untouched via that helper's own
    // spread (same "don't silently drop untouched fields" guard the homePlanet
    // fold above uses). If no captain was on a mission this call, `lifetimeStats`
    // is still the original state.lifetimeStats reference -- an exact no-op.
    lifetimeStats,
  };

  // Phase 1, Task 9: resolve every in-flight timed process ONCE, fleet-wide (NOT
  // per-captain -- processes are facility-owned, not captain-owned), with the SAME
  // `ticksElapsed` the per-captain mission loop above consumed. This is the SINGLE
  // shared resolver App.svelte's live poll loop ALSO calls (identical
  // resolveProcesses import), so offline catch-up and live play cannot diverge on
  // process completion -- the same drift-proof single-source discipline
  // foldLifetimeStatsDelta / addToInventory already use. A completed process's lump
  // Fleet Admiral XP (its full durationTicks) folds into the SAME fleetAdminXpDelta
  // the mission loop accumulated, so mission FA XP + process FA XP reach
  // applyFleetAdminXp together and resolve through ONE level-up pass. Threaded on
  // top of postMissionState so any process output (inventory/discovered/facilities)
  // composes with the mission loot already folded there. activeProcesses is empty
  // until refine jobs / facility upgrades start (Task 10/11), so resolveProcesses
  // early-outs to a same-reference no-op today -- inert but correct + drift-proof
  // for when processes exist.
  const { next: postProcessState, fleetAdminXpDelta: processFleetAdminXpDelta } = resolveProcesses(
    postMissionState,
    ticksElapsed
  );
  fleetAdminXpDelta += processFleetAdminXpDelta;

  // applyFleetAdminXp wraps the final state -- it runs AFTER BOTH the captain loop
  // (mission FA XP) and resolveProcesses (process FA XP) have contributed to
  // fleetAdminXpDelta, so every FA XP source this call resolves through the one
  // level-up pass. It does not touch inventory/facilities/activeProcesses -- the
  // loot fold + resolveProcesses above already produced their final values on
  // postProcessState.
  return applyFleetAdminXp(postProcessState, fleetAdminXpDelta);
}

// Offline catch-up entry point -- tech spec §2 (Tick Loop and Time Semantics).
// Converts the elapsed wall-clock span (deltaSeconds) into the fleet-wide
// ticksElapsed cadence (moved off CaptainState during the UI Redesign -- see
// docs/plans/2026-07-07-ui-redesign-design.md), CLAMPS it to the offline cap, then
// STEPS the economy forward ONE tick per economyTick call across the clamped span.
//
// Phase 2 (Task B3, design §2 + §3.4): this REPLACES the old single closed-form
// economyTick(state, wholeSpan) call. Why step per tick instead of one big call:
// auto-stop (§3.4) COUPLES production to storage -- a captain must stop the moment
// its material fills, which is a discrete breakpoint mid-span. A single big call
// checks the cap only ONCE (at the span's start), so it would keep producing past a
// cap crossing. Stepping ONE tick at a time re-checks the cap every tick inside
// economyTick, so a run stops exactly when its material fills -- correct by
// construction across the breakpoint, no closed-form breakpoint math to get wrong
// (the whole point of the step-forward foundation).
//
// Behavior parity vs. pre-B3: for the DETERMINISTIC economy (mission phase progress,
// captain/FA XP, credits, gameTimeSeconds) stepping N ticks of 1 equals one call of
// N, because economyTick/tickCaptainMission are closed-form ("one big jump == many
// small ticks", guarded by the closed-form parity test). LOOT rng SEQUENCING can
// differ with 2+ captains: a big call ran all of captain A's rolls, then all of B's;
// the stepped loop interleaves A,B per tick. Both consume the same NUMBER of rolls
// off the same stream -- only the interleaving order differs, so totals are
// statistically equivalent (a constant rng makes them bit-identical -- see the test).
//
// INTENTIONAL behavior CHANGE (design decision, user-confirmed): a span longer than
// offlineCapTicks(state) (2 real days at the default cadence) advances only 2 days;
// the excess is DISCARDED. Pre-B3 tick() advanced the FULL span uncapped. This is the
// deliberate offline cap, an extensible/derived value (see offlineCapTicks).
//
// PERFORMANCE: up to floor(offlineCapTicks) iterations (~172,800 at the 1s cadence),
// each a full economyTick. Per the design (§2.3) a tight no-render loop handles this
// well under a second; the 2-day cap BOUNDS it. Deliberately NOT hoisting economyTick's
// per-captain bonus/ship resolution out of the loop even though it recomputes
// call-constant values each tick: doing so would require a SEPARATE offline code path
// that bypasses economyTick, re-introducing the exact live-vs-offline drift the
// step-forward foundation exists to eliminate (design §2.2). Correctness over speed,
// exactly as this task scoped it; adaptive chunking is an explicitly-later task. No
// per-iteration progress log either -- it would dwarf the sub-second loop's own cost
// (console I/O per tick), and App.svelte already emits a start/end "Welcome back.
// Advanced Ns offline." bookend around this call.
//
// rng defaults to Math.random (the only production caller, App.svelte's offline
// catch-up, passes no rng -- byte-identical to the old inline Math.random). Tests
// inject a constant rng to make the stepped loot exactly assertable.
export function tick(deltaSeconds: number, state: GameState, rng: () => number = Math.random): GameState {
  if (deltaSeconds <= 0) return state;
  // Same deltaSeconds -> ticksElapsed conversion as before, then clamp to the cap.
  // Math.min discards any excess span beyond the cap (the intentional 2-day limit).
  const rawTicksElapsed = deltaSeconds / state.tickDurationSeconds;
  const clampedTicks = Math.min(rawTicksElapsed, offlineCapTicks(state));

  // Step the WHOLE ticks first: one economyTick(state, 1) per tick, so the auto-stop
  // cap-check inside economyTick runs every tick. Each call returns a fresh state that
  // feeds the next -- accumulated inventory carries forward, so a mid-span cap crossing
  // is seen on the very next iteration.
  const wholeSteps = Math.floor(clampedTicks);
  let next = state;
  for (let i = 0; i < wholeSteps; i++) {
    next = economyTick(next, 1, rng);
  }

  // Apply any fractional remainder tick LAST, matching the precision the old single
  // closed-form call carried (it passed the full fractional ticksElapsed straight to
  // economyTick). frac is exactly 0 for an integer span (skipped); for a fractional
  // span it advances the sub-tick residue, exactly as one big call's trailing fraction
  // would. Summed, wholeSteps*1 + frac == clampedTicks, so the deterministic economy
  // lands identically to a single economyTick(state, clampedTicks) call.
  const frac = clampedTicks - wholeSteps;
  if (frac > 0) {
    next = economyTick(next, frac, rng);
  }

  return next;
}

// Dispatches an idle captain (mission === null) on a mission. Finds the
// captain by id (not array index -- ids and indices can diverge once
// captains are ever removed/reordered, though nothing does that today).
// Fails (same state reference, unchanged) if no captain has that id, or if
// they already have an active mission. On success, seeds a brand-new
// CaptainMissionState at the very start of the cycle (phase "ordersReceived",
// zero progress, empty cargo, not recalled).
export function dispatchCaptainOnMission(
  state: GameState,
  captainId: number,
  missionKey: MissionKey
): { next: GameState; success: boolean } {
  const idx = state.captains.findIndex((c) => c.id === captainId);
  if (idx === -1) return { next: state, success: false };
  if (state.captains[idx].mission !== null) return { next: state, success: false };

  const captains = [...state.captains];
  captains[idx] = {
    ...captains[idx],
    mission: {
      missionKey,
      phase: "ordersReceived",
      phaseProgressTicks: 0,
      cargo: emptyLootTotals(),
      recalled: false,
    },
  };
  return { next: { ...state, captains }, success: true };
}

// Flags an active mission as recalled. Deliberately does NOT reset phase,
// phaseProgressTicks, or cargo -- recall only flags intent; tickCaptainMission
// (Task 2) already knows to end the mission (mission -> null) instead of
// auto-repeating once the CURRENT cycle's unloading phase completes. So
// recall takes effect at the end of the current cycle, not immediately --
// a deliberate design choice, not a bug. Fails if no captain has that id,
// or if they have no active mission to recall.
export function recallCaptain(state: GameState, captainId: number): { next: GameState; success: boolean } {
  const idx = state.captains.findIndex((c) => c.id === captainId);
  if (idx === -1) return { next: state, success: false };
  if (state.captains[idx].mission === null) return { next: state, success: false };

  const captains = [...state.captains];
  captains[idx] = { ...captains[idx], mission: { ...captains[idx].mission!, recalled: true } };
  return { next: { ...state, captains }, success: true };
}

// Assigns a ship to a captain under the "captains always have a hull; swapping
// is an ATOMIC REPLACE" model (Ships — Stats Foundation, Task 8). ShipInstance
// .assignedCaptainId is the SINGLE SOURCE OF TRUTH for who flies what -- this
// function is the only supported way to move it, and it keeps the invariant
// "no ship is assigned to two captains at once" intact by parking the captain's
// PREVIOUS hull whenever they take a different one. Pure: returns a new state,
// mutates nothing. The Sector Space UI (Task 11) is the caller.
//
// Same "same state reference on failure" convention as every other action
// function in this file (dispatchCaptainOnMission / recallCaptain above). Fails
// (returns the SAME state reference, success: false) if:
//   - the captain or the ship doesn't exist (find returns undefined), OR
//   - the captain is on a mission (mission !== null) -- a hull can't change
//     mid-mission. This lock is LOAD-BEARING for the closed-form guarantee:
//     tickCaptainMission resolves effectiveMissionDef from the assigned hull
//     ONCE per call and holds it constant across the whole cycle; letting the
//     hull change mid-cycle would break the "one big jump == many small ticks"
//     property that guarantee depends on, OR
//   - the target ship is already flown by a DIFFERENT captain (assignedCaptainId
//     is non-null and not this captain) -- you can't poach another captain's
//     hull; it must be parked first.
//
// ORDERING IS SUBTLE -- read before touching the .map() below. We assign the
// TARGET ship first (its branch wins), THEN park any *different* hull the
// captain used to fly. The order matters ONLY for the self-reassign case
// (assigning the captain the exact ship they already fly): if we parked "the
// captain's current ship" FIRST, that would null ship-X, and then the target
// branch would re-assign the same ship-X -- a wash, but fragile. By running the
// target branch first and gating the park branch on "assignedCaptainId ===
// captainId" for a DIFFERENT id, the self-reassign lands entirely in the target
// branch (s.id === shipId), so the park branch never fires on it. Net effect:
// self-reassign is a harmless no-op (the captain keeps their ship), and a true
// swap parks exactly the one old hull. See the "self-reassign" test in
// tick.test.ts, which exists specifically to lock this ordering in.
export function assignShipToCaptain(
  state: GameState,
  captainId: number,
  shipId: string
): { next: GameState; success: boolean } {
  const captain = state.captains.find((c) => c.id === captainId);
  const ship = state.ships.find((s) => s.id === shipId);
  if (!captain || !ship) return { next: state, success: false };
  if (captain.mission !== null) return { next: state, success: false };
  if (ship.assignedCaptainId !== null && ship.assignedCaptainId !== captainId) {
    return { next: state, success: false };
  }

  // ORDER MATTERS (see header comment): the target-assign branch is listed
  // FIRST so it wins for the self-reassign case; the park branch only fires on a
  // DIFFERENT old hull the captain was flying.
  const ships = state.ships.map((s) => {
    if (s.id === shipId) return { ...s, assignedCaptainId: captainId }; // assign target (wins)
    if (s.assignedCaptainId === captainId) return { ...s, assignedCaptainId: null }; // park the (different) old hull
    return s;
  });
  return { next: { ...state, ships }, success: true };
}

// Purchases a new hull for the fleet at the Sector Space construct (Ships —
// Stats Foundation, Task 9). Pure: returns a new state, mutates nothing. Same
// "same state reference on failure" convention as every other buy/action
// function in this file (assignShipToCaptain above, craftRecipe/respec* below).
// The Sector Space buy panel (Task 11 UI) is the caller.
//
// Three guards, checked in order (all return the SAME state reference,
// success: false):
//   1. !def.cost -- the hull is not purchasable. ShipTypeDef.cost is typed
//      `{ credits: number } | null`; a null cost means "not for sale" (e.g. a
//      future Research-gated hull). FORWARD-DEFENSIVE: all 4 current SHIP_TYPES
//      hulls have a non-null cost, so this branch is unreachable with today's
//      table -- but the guard both honors the type's own contract and protects
//      the `def.cost.credits` deref below from a null. Kept intentionally.
//   2. storage cap -- the fleet can hold at most shipStorageCapacity hulls
//      (parked + assigned combined). At capacity, no purchase.
//   3. affordability -- credits is a break_infinity.js Decimal, so the compare
//      is `.lt(number)` (NOT `<`) and the deduction is `.minus(number)` (NOT
//      `-`), matching respecCaptainTalents/craftRecipe's Decimal usage above.
//
// On success the new hull arrives PARKED (assignedCaptainId: null) -- the
// player assigns it via assignShipToCaptain afterward. Its id is minted from
// state.nextShipId as "ship-N" (the same "ship-N" scheme freshState seeds and
// ShipInstance.id documents), and nextShipId is then bumped by 1 so the id
// source stays monotonic and never reused.
export function buyShip(
  state: GameState,
  typeKey: ShipTypeKey
): { next: GameState; success: boolean } {
  const def = SHIP_TYPES[typeKey];
  if (!def.cost) return { next: state, success: false }; // not purchasable (forward-defensive; see header)
  if (state.ships.length >= state.shipStorageCapacity) return { next: state, success: false }; // storage at capacity
  if (state.credits.lt(def.cost.credits)) return { next: state, success: false }; // can't afford

  const ship: ShipInstance = { id: `ship-${state.nextShipId}`, typeKey, assignedCaptainId: null };
  return {
    next: {
      ...state,
      credits: state.credits.minus(def.cost.credits),
      ships: [...state.ships, ship],
      nextShipId: state.nextShipId + 1,
    },
    success: true,
  };
}

// Validates every input in the recipe is affordable, deducts them all, adds
// the output -- same "same state reference on failure" convention as every
// other buy/action function in this file (dispatchCaptainOnMission,
// recallCaptain). Manual-craft-button only this phase; an auto-craft toggle
// is a deliberate near-term follow-up, not built here.
export function craftRecipe(state: GameState, recipeKey: RecipeKey): { next: GameState; success: boolean } {
  const recipe = RECIPES[recipeKey];
  // recipe.inputs[key] is Decimal | undefined (Partial<Record<...>>), so the
  // fallback must be a Decimal too -- `?? 0` would leave `needed` typed
  // `Decimal | number`, and a plain number has no `.lt()`/`.minus()` methods.
  for (const key of Object.keys(recipe.inputs) as HomePlanetMaterialKey[]) {
    const needed = recipe.inputs[key] ?? new Decimal(0);
    // Affordability gate reads the keyed `inventory` (was homePlanet.storage).
    // Input keys are the recipe's own HomePlanetMaterialKeys, all seeded in
    // inventory (freshState/migration), so this is a 1:1 read swap.
    if (state.inventory[key].lt(needed)) return { next: state, success: false };
  }

  // Deduct every input from a NEW inventory clone (immutable-update style, was a
  // storage clone). A DEDUCT is NOT a discovery event -- it does NOT go through
  // addToInventory; consuming an item you already had reveals nothing new. Same
  // exact per-input .minus(needed) as before.
  const inventory = { ...state.inventory };
  for (const key of Object.keys(recipe.inputs) as HomePlanetMaterialKey[]) {
    const needed = recipe.inputs[key] ?? new Decimal(0);
    inventory[key] = inventory[key].minus(needed);
  }

  // recipeBonusOutput (Homeworld Talent, e.g. industryBonusOutput): a FLAT
  // extra amount added per craft, not a multiplier -- matches the effect
  // type's own `bonus: number` field name/shape. Reduce over every unlocked
  // talent (not just industryBonusOutput by name) so any future
  // recipeBonusOutput entry targeting a different recipeKey works without
  // touching this function again. effect.bonus stays plain number (Big-Number
  // Migration field-split table) -- this reduce is unchanged plain-number
  // arithmetic, unrelated to the Decimal boundary below.
  const bonusOutput = state.unlockedHomeworldTalents.reduce((sum, key) => {
    const effect = HOMEWORLD_TALENTS[key].effect;
    return effect.type === "recipeBonusOutput" && effect.recipeKey === recipeKey ? sum + effect.bonus : sum;
  }, 0);
  // Add the crafted output through the single add seam (addToInventory) so the
  // output item is marked discovered. The added amount is the recipe's base
  // output PLUS the flat recipeBonusOutput, combined into ONE Decimal here so the
  // helper's single .plus() reproduces the old
  // `.plus(recipe.output.amount).plus(bonusOutput)` chain exactly -- both
  // operands are integer amounts (output.amount is a Decimal, bonusOutput a plain
  // number), so this reassociation is value-identical. A real recipe's output is
  // always >= 1, so the discovered mark always fires here (unlike the loot fold,
  // which can see 0 deltas).
  const outputAmount = recipe.output.amount.plus(bonusOutput);
  const added = addToInventory(inventory, state.discovered, recipe.output.key, outputAmount);

  return { next: { ...state, inventory: added.inventory, discovered: added.discovered }, success: true };
}

// ============================================================================
// Timed-process engine — Phase 1, Task 8
// (docs/plans/2026-07-11-facility-framework-refinery-design.md §3, §4).
//
// ONE deterministic, fixed-duration process shape backs BOTH refine jobs and
// facility upgrades (design §3). Two functions:
//   - startProcess    : gate on inputs, ATOMICALLY deduct them, push the process.
//   - resolveProcesses : decrement every process's countdown, complete any that
//                        hit zero (apply effect + lump Fleet Admiral XP), remove
//                        it. The SINGLE completion resolver Task 9 calls from BOTH
//                        tick() (offline catch-up) AND App.svelte's live poll --
//                        one helper, no second hand-mirrored copy (the drift-proof
//                        single-source pattern foldLifetimeStatsDelta established).
//
// Placed in tick.ts (not a separate process.ts) deliberately: resolveProcesses
// reuses addToInventory (the shared add seam, this file), and Task 9 wires
// resolveProcesses INTO tick() (this file) -- keeping it here avoids a circular
// import (process.ts -> tick.ts for addToInventory, tick.ts -> process.ts for the
// wiring) that no local typecheck could catch on this Node-less machine. It sits
// beside every other game-action function (craftRecipe/buyShip/dispatch...).
// ============================================================================

// Starts a timed process, consuming its inputs ATOMICALLY at start (design §4).
// Mirrors the { next, success } convention of every other action in this file,
// but names the flag `started` (the design doc's term) instead of `success`.
//
// GATE then DEDUCT, both against the LIVE inventory: because every running
// process already had its inputs removed at ITS start, the live inventory IS the
// available-materials ledger -- no separate reservation bookkeeping. If ANY input
// is short, nothing changes and the SAME state reference is returned (the
// same-ref-on-failure convention dispatchCaptainOnMission/craftRecipe use).
//
// ATOMICITY is the whole point (design §4): deducting in the same transition that
// creates the process closes the "checked-but-not-yet-consumed" window, so two
// concurrent starts can NOT both see enough materials and both begin -- the first
// start's deduct is visible to the second start's gate. A DEDUCT is not a
// discovery event, so inputs are removed with a plain .minus() on an inventory
// clone (NOT routed through addToInventory) -- exactly as craftRecipe deducts its
// recipe inputs. Only the process OUTPUT (granted later, in resolveProcesses)
// goes through the discovery-marking add seam.
export function startProcess(
  state: GameState,
  kind: TimedProcessKind,
  inputs: Record<string, Decimal>,
  durationTicks: number,
  effect: ProcessEffect
): { next: GameState; started: boolean } {
  // Gate: EVERY input must be affordable. An absent inventory key reads as 0
  // (grow-on-demand contract, same as addToInventory) -- so requiring a
  // never-held item is correctly rejected unless the required qty is <= 0.
  for (const itemId of Object.keys(inputs)) {
    const have = state.inventory[itemId] ?? new Decimal(0);
    if (have.lt(inputs[itemId])) return { next: state, started: false };
  }

  // Deduct every input from a FRESH inventory clone (immutable-update style), in
  // the same transition that pushes the process below -- this is the atomic
  // consume. `?? new Decimal(0)` mirrors the gate's absent-key handling (the gate
  // already proved qty <= 0 for any absent key, so this never goes negative).
  const inventory = { ...state.inventory };
  for (const itemId of Object.keys(inputs)) {
    inventory[itemId] = (inventory[itemId] ?? new Decimal(0)).minus(inputs[itemId]);
  }

  // id minted from nextProcessId as "proc-N" (the scheme TimedProcess.id / this
  // field's freshState seed document), then nextProcessId bumped so ids stay
  // monotonic and are never reused -- identical to buyShip's "ship-N" handling.
  // remainingTicks is SEEDED from durationTicks (the countdown starts full);
  // durationTicks is retained unchanged as the fixed lump FA XP award.
  const process: TimedProcess = {
    id: `proc-${state.nextProcessId}`,
    kind,
    remainingTicks: durationTicks,
    durationTicks,
    effect,
  };

  return {
    next: {
      ...state,
      inventory,
      activeProcesses: [...state.activeProcesses, process],
      nextProcessId: state.nextProcessId + 1,
    },
    started: true,
  };
}

// ============================================================================
// Facility framework — Phase 1, Task 10
// (docs/plans/2026-07-11-facility-framework-refinery-design.md §5, §6).
//
// Two functions, built on the Task 8 startProcess engine above:
//   - canBuildFacilityUpgrade : pure predicate. Is the NEXT upgrade for a facility
//                               buildable RIGHT NOW? Returns { ok, reason? } -- the
//                               reason names the FIRST failing gate (for the future
//                               Refinery panel's red "missing" readouts).
//   - startFacilityUpgrade    : the action. If buildable, hand the upgrade's
//                               materials/duration/level-up effect to startProcess
//                               (atomic deduct-at-start). Else a same-ref no-op.
//
// The NEXT upgrade for a facility at level L is FACILITIES[key].upgrades[L]
// (upgrades[i] = requirements to reach level i+1, so a fresh level-0 facility's
// next rung is upgrades[0], the build/unlock). An out-of-range index (level ==
// upgrades.length) means the track is MAXED -> not buildable.
// ============================================================================

// Reads the current level of a facility, treating an absent facility key as level
// 0 (grow-on-demand, the SAME posture resolveProcesses' facilityLevelUp uses when
// it bumps an unseen facility). freshState seeds { refinery: { level: 0 } }, so
// today this always finds the entry, but the fallback keeps a future not-yet-seeded
// facility from reading `undefined.level`.
function facilityLevel(state: GameState, facilityKey: string): number {
  return state.facilities[facilityKey]?.level ?? 0;
}

// PURE predicate -- reads state + the static FACILITIES table, mutates nothing,
// starts nothing. `ok: true` means startFacilityUpgrade would succeed right now;
// `ok: false` carries a `reason` naming the FIRST failing gate. Gate order is
// deliberate and documented inline: cheap structural gates (facility exists /
// track not maxed) first, then the prerequisite gates (FA level, talents,
// research, facility levels), then materials LAST -- materials are the gate most
// likely to be transiently unmet (you gather ore over time), so a stale
// prerequisite (wrong FA level / missing talent) surfaces ahead of "just go mine
// more ore". This ordering only affects WHICH reason shows when multiple gates
// fail at once; `ok` itself is unaffected by order (all gates must pass).
export function canBuildFacilityUpgrade(
  state: GameState,
  facilityKey: string
): { ok: boolean; reason?: string } {
  const facilityDef = FACILITIES[facilityKey];
  // Unknown facility key -- no such facility in the table. Defensive: today every
  // caller passes "refinery", but a typo'd/removed key returns a clear reason
  // rather than throwing on `undefined.upgrades`.
  if (!facilityDef) {
    return { ok: false, reason: `Unknown facility: ${facilityKey}` };
  }

  const currentLevel = facilityLevel(state, facilityKey);
  const upgrade = facilityDef.upgrades[currentLevel]; // the NEXT rung (undefined = maxed)
  // Track maxed -- no upgrade defined past the current level. Not buildable, and
  // the UI can show the facility as fully upgraded.
  if (!upgrade) {
    return { ok: false, reason: `${facilityDef.label} is fully upgraded` };
  }

  // SEQUENTIAL-PER-FACILITY gate: at most ONE upgrade in flight for THIS facility
  // at a time. Checked BEFORE the prereq/material gates so the exploit it closes is
  // structurally impossible. Because a facility's `level` only bumps at process
  // COMPLETION, without this gate `upgrades[currentLevel]` stays the SAME rung while
  // a build is mid-flight -- so a player could start the cheap level 0->1 build
  // twice and land at level 2, SKIPPING the escalating cost + FA-level/talent gates
  // on the level 1->2 rung. Requiring the in-flight rung to complete (which bumps
  // `level`, advancing `upgrades[currentLevel]` to the NEXT rung) before the next is
  // buildable makes each facility's track strictly sequential, forcing every rung's
  // real cost/gates to be paid in order.
  //
  // CONCURRENCY IS UNAFFECTED ACROSS DISTINCT FACILITIES: this keys ONLY on
  // effect.facility === facilityKey, so an upgrade to some OTHER facility in flight
  // does NOT block this one, and vice versa. Refine JOBS (kind "refineJob") are a
  // different kind entirely and are never matched here -- they parallelize by slot
  // count, not by this gate.
  const upgradeInFlight = state.activeProcesses.some(
    (p) =>
      p.kind === "facilityUpgrade" &&
      p.effect.type === "facilityLevelUp" &&
      p.effect.facility === facilityKey
  );
  if (upgradeInFlight) {
    return { ok: false, reason: "Upgrade already in progress" };
  }

  // Prerequisite gate: Fleet Admiral level. Absent field => no FA-level wall.
  if (upgrade.requiresFleetAdminLevel !== undefined && state.fleetAdminLevel < upgrade.requiresFleetAdminLevel) {
    return { ok: false, reason: `Requires Fleet Admiral level ${upgrade.requiresFleetAdminLevel}` };
  }

  // Prerequisite gate: Homeworld Talents -- EVERY listed talent must be unlocked
  // fleet-wide. Reason names the first missing talent by its display label (the
  // SAME HOMEWORLD_TALENTS[key].label the talent tree UI shows), not the raw key.
  if (upgrade.requiresHomeworldTalents) {
    for (const talentKey of upgrade.requiresHomeworldTalents) {
      if (!state.unlockedHomeworldTalents.includes(talentKey)) {
        return { ok: false, reason: `Requires Homeworld Talent: ${HOMEWORLD_TALENTS[talentKey].label}` };
      }
    }
  }

  // Prerequisite gate: Research topics. EMPTY today (no research topics exist), so
  // this loop never runs against real data -- but it is honored if a future
  // upgrade ever lists one, per "reserve the gate, no placeholder". No label table
  // for research topics exists yet, so the raw id is surfaced as-is.
  if (upgrade.requiresResearch) {
    for (const topicId of upgrade.requiresResearch) {
      // No research-completion state exists on GameState yet, so ANY listed topic
      // is by definition unmet. When Research lands, replace this with a real
      // "is topic completed?" check against the then-existing state field.
      return { ok: false, reason: `Requires research: ${topicId}` };
    }
  }

  // Prerequisite gate: other facilities' levels (cross-facility dependency chain).
  // EMPTY today (refinery is the only Phase 1 facility, nothing to depend on), so
  // no real upgrade triggers this -- reserved gate, honored if ever populated.
  if (upgrade.requiresFacilityLevels) {
    for (const depKey of Object.keys(upgrade.requiresFacilityLevels)) {
      const need = upgrade.requiresFacilityLevels[depKey];
      if (facilityLevel(state, depKey) < need) {
        const depLabel = FACILITIES[depKey]?.label ?? depKey;
        return { ok: false, reason: `Requires ${depLabel} level ${need}` };
      }
    }
  }

  // Material gate (checked LAST -- see the ordering note on the function). EVERY
  // material entry must be affordable against LIVE inventory. Because startProcess
  // deducts every running process's inputs at ITS start, live inventory already
  // reflects everything reserved -- no separate ledger (design §4). An absent
  // inventory key reads as 0 (grow-on-demand), matching startProcess's own gate.
  for (const itemId of Object.keys(upgrade.materials)) {
    const need = upgrade.materials[itemId];
    const have = state.inventory[itemId] ?? new Decimal(0);
    if (have.lt(need)) {
      const itemLabel = ITEMS[itemId]?.label ?? itemId;
      return { ok: false, reason: `Need ${need.toString()} ${itemLabel} (have ${have.toString()})` };
    }
  }

  return { ok: true };
}

// The ACTION. Starts the next upgrade for a facility IF canBuildFacilityUpgrade
// approves it, by delegating to the Task 8 startProcess engine: materials are
// deducted ATOMICALLY at start, and a "facilityUpgrade" TimedProcess is pushed
// whose completion effect { type: "facilityLevelUp", facility } bumps the level by
// 1 (resolveProcesses applies it). Returns { next, started } -- same shape/naming
// as startProcess. On any failed gate it is a same-reference no-op ({ next: state,
// started: false }), matching startProcess's own reject convention.
//
// CONCURRENCY (design §5, user 2026-07-11, refined 2026-07-11): UNLIMITED across
// DISTINCT facilities (a refinery upgrade and a future warehouse upgrade run at
// once) but STRICTLY SEQUENTIAL per facility -- at most ONE in-flight upgrade for
// a given facility. That per-facility limit is enforced by canBuildFacilityUpgrade
// (the "Upgrade already in progress" gate), which this function inherits by calling
// it. The limit closes the rung-skip exploit: because a facility's level only bumps
// at COMPLETION, allowing two concurrent upgrades of the SAME facility would let a
// player start the cheap level 0->1 build twice and land at level 2, skipping the
// level 1->2 rung's higher cost + FA-level/talent gates. Requiring the in-flight
// rung to finish first makes each track pay every rung's real cost/gates in order.
// Refine JOBS are separately capped by slot count, not by this gate.
export function startFacilityUpgrade(
  state: GameState,
  facilityKey: string
): { next: GameState; started: boolean } {
  const check = canBuildFacilityUpgrade(state, facilityKey);
  if (!check.ok) {
    return { next: state, started: false };
  }

  // Safe: canBuildFacilityUpgrade.ok guarantees the facility exists and the rung
  // is in range (it would have returned a reason otherwise).
  const upgrade = FACILITIES[facilityKey].upgrades[facilityLevel(state, facilityKey)];
  return startProcess(state, "facilityUpgrade", upgrade.materials, upgrade.durationTicks, {
    type: "facilityLevelUp",
    facility: facilityKey,
  });
}

// ============================================================================
// Refinery — single refine jobs (Phase 1, Task 11)
// (docs/plans/2026-07-11-facility-framework-refinery-design.md §6).
//
// Two functions, both built on the Task 8 startProcess engine + the Task 10
// FACILITIES table:
//   - refineSlotCount : how many parallel refine jobs the refinery can run RIGHT
//                       NOW, derived (not stored) by summing the `addRefineSlots`
//                       grants across every upgrade LEVEL the facility has reached.
//   - startRefineJob  : start ONE manual refine job if a slot is free AND the
//                       recipe inputs are affordable; else a same-ref no-op.
// ============================================================================

// Slot count = the sum of every `addRefineSlots` grant on the upgrade rungs the
// refinery has ALREADY reached. upgrades[i] is the rung that took the facility to
// level i+1, so a facility at level L has "banked" the effects of upgrades[0..L-1]
// -- hence the loop runs `i < level`. Level 0 (unbuilt) sums nothing -> 0 slots;
// the 0->1 build (upgrades[0], addRefineSlots:1) yields the first slot; each of
// the 1->2 / 2->3 rungs adds another; the 3->4 rung is a refineSpeedMult (NOT a
// slot), so it contributes 0 here and level 4 still reports 3 slots.
//
// Derived-on-read (the SAME populated-but-inert pattern SHIP_TYPES.moduleSlots
// uses) rather than caching a slot total on FacilityState: the upgrade track is
// the single source of truth, so retuning an `addRefineSlots` value or appending a
// rung changes the slot count with no extra bookkeeping and no migration.
//
// FacilityUpgradeEffect is a NON-discriminated union ({ addRefineSlots } |
// { refineSpeedMult }) -- distinguished by property presence, so we narrow with
// `"addRefineSlots" in effect` (there is no `type` tag to switch on). The `i <
// upgrades.length` guard is belt-and-suspenders: today no facility can exceed its
// track length, but it keeps a hypothetical over-level read from indexing past the
// finite array.
export function refineSlotCount(state: GameState): number {
  const level = facilityLevel(state, "refinery");
  const upgrades = FACILITIES.refinery.upgrades;
  let slots = 0;
  for (let i = 0; i < level && i < upgrades.length; i++) {
    const effect = upgrades[i].effect;
    if ("addRefineSlots" in effect) {
      slots += effect.addRefineSlots;
    }
  }
  return slots;
}

// ============================================================================
// Tiered Warehouse — per-item storage cap helper (Phase 2, Task B2)
// (docs/plans/2026-07-13-phase-2-warehouse-refine-economy-design.md §3.3).
//
// tierCap(state, tier) returns the CURRENT per-item storage cap for a warehouse
// tier -- a DERIVED value (never stored), read off that tier's warehouse facility
// level exactly as refineSlotCount derives the refinery's slot count off its level.
// DEFINITION ONLY this task: nothing enforces the cap yet. Task B3 consumes tierCap
// at the producer seam to auto-stop a producer whose output has hit its cap.
//
// Formula: BASE_CAP[tier] doubled once per REACHED warehouse rung. Each rung of a
// warehouse track (model.ts) carries a { storageCapMult: 2 } effect, so multiplying
// that factor across the reached rungs (i < level) yields base * 2^level -- the
// design's "cap doubles per level, repeatable". The doubling factor lives on the
// rung (the upgrade track is the single source of truth), so tierCap needs no edit
// if a future tier tunes a different factor.
// ============================================================================

// Base (level-0) per-item cap per tier (design §3.3). T1 = 1,000,000 (calibrated:
// a ~week-old save is already brushing 1M, a fair mid-game starting pressure). T2 =
// 1,000,000 is a STUB placeholder -- the real T2 base is TBD when T2 content lands.
// A tier ABSENT from this map has NO warehouse cap system yet (see tierCap's
// fail-open branch). Kept in sync with model.ts's WAREHOUSE_T*_BASE_CAP, which feed
// the upgrade COST formula off the same design numbers.
const BASE_CAP: Record<number, Decimal> = {
  1: new Decimal(WAREHOUSE_T1_BASE_CAP),
  2: new Decimal(WAREHOUSE_T2_BASE_CAP), // STUB -- real T2 base TBD
};

// Which facility key holds each tier's warehouse upgrade track. Beside BASE_CAP so a
// new tier wires its cap base + its facility in one place.
const TIER_WAREHOUSE_KEY: Record<number, string> = {
  1: "warehouseT1",
  2: "warehouseT2",
};

// "Effectively uncapped" sentinel for a tier with NO warehouse cap system (a tier
// absent from BASE_CAP). A finite-but-astronomically-large Decimal, constructed from
// a STRING so it is a genuine break_infinity value (NOT JS's own number Infinity) --
// decimal-smoke.test.ts's extreme-magnitude case verifies string-built huge Decimals
// hold exactly. Chosen over Decimal(Infinity) deliberately: this repo has no Node to
// verify the library's Infinity-constructor behavior (Omega 8, no over-assumptions),
// and 1e1000 is unreachable by any in-game quantity, so B3's "amount >= cap -> stop"
// check is fail-open for un-warehoused tiers either way (a producer is NEVER idled
// for a tier that has no warehouse).
const WAREHOUSE_UNCAPPED_SENTINEL = new Decimal("1e1000");

// PURE: reads state + the static FACILITIES/BASE_CAP tables, mutates nothing. See
// the section header above for the formula. An un-warehoused tier (no BASE_CAP entry)
// fails OPEN to the uncapped sentinel so Task B3 never auto-stops a producer for a
// tier whose warehouse doesn't exist. A tier at warehouse level 0 returns its base
// cap unchanged (no reached rung to double it) -- including T2 while still LOCKED
// (level 0): its cap is defined even before unlock, but is moot this phase since no
// T2 item is obtainable.
export function tierCap(state: GameState, tier: number): Decimal {
  // Explicitly typed `Decimal | undefined`: this project builds WITHOUT
  // noUncheckedIndexedAccess (so `BASE_CAP[tier]` would otherwise type as a
  // non-nullable Decimal and make the `=== undefined` guard a TS2367 "no overlap"
  // error). The lookup genuinely CAN miss at runtime (an un-warehoused tier), so
  // the annotation states that honestly, matching the codebase's `?.`/`??`
  // grow-on-demand convention for the same situation.
  const base: Decimal | undefined = BASE_CAP[tier];
  if (base === undefined) {
    return WAREHOUSE_UNCAPPED_SENTINEL; // fail-open: no warehouse cap system for this tier
  }
  const warehouseKey = TIER_WAREHOUSE_KEY[tier];
  const facilityDef = warehouseKey ? FACILITIES[warehouseKey] : undefined;
  const level = warehouseKey ? (state.facilities[warehouseKey]?.level ?? 0) : 0;
  // Multiply the base by each REACHED rung's storageCapMult (i < level), the SAME
  // reached-rungs loop refineSlotCount uses to SUM addRefineSlots. A rung whose
  // effect is not a storageCapMult (none on today's warehouse tracks) contributes
  // nothing. The `i < upgrades.length` guard mirrors refineSlotCount's -- defensive
  // against a hypothetical over-level read past the finite track.
  let cap = base;
  if (facilityDef) {
    const upgrades = facilityDef.upgrades;
    for (let i = 0; i < level && i < upgrades.length; i++) {
      const effect = upgrades[i].effect;
      if ("storageCapMult" in effect) {
        cap = cap.times(effect.storageCapMult);
      }
    }
  }
  return cap;
}

// ============================================================================
// Auto-stop cap check (Phase 2, Task B3)
// (docs/plans/2026-07-13-phase-2-warehouse-refine-economy-design.md §3.4).
//
// materialAtCap(state, itemId) returns whether the fleet's stock of `itemId` has
// REACHED (or somehow exceeded) that item's tier storage cap. This is the ONE
// cap-check seam for the whole auto-stop mechanic: economyTick calls it to idle a
// mission whose primary material is full (below), and Task D's refine-order pause
// will call this SAME function for refinery outputs -- so both producers share one
// definition of "full" and cannot drift.
//
// PURE: reads state.inventory + the static ITEMS table + tierCap, mutates nothing.
//
// Fails OPEN on an unknown itemId (no ITEMS entry -> no tier -> return false), so a
// producer is NEVER idled for an item that has no catalog metadata. This mirrors
// tierCap's own fail-open stance (an un-warehoused tier returns the uncapped
// sentinel, against which .gte is always false anyway) -- two layers of the same
// "never wrongly stop a producer for a missing warehouse" guarantee.
//
// The `.gte(cap)` (>=, not >) is deliberate: AT the cap counts as full. At the
// uncapped sentinel (1e1000) no reachable in-game quantity is >=, so those items
// read as never-full.
// ============================================================================
export function materialAtCap(state: GameState, itemId: string): boolean {
  // Explicitly typed `ItemDef | undefined` for the SAME reason tierCap annotates
  // its BASE_CAP lookup: this project builds WITHOUT noUncheckedIndexedAccess, so
  // `ITEMS[itemId]` would otherwise type as a non-nullable ItemDef and make the
  // `=== undefined` guard a TS2367 "no overlap" error -- but the lookup genuinely
  // CAN miss at runtime (an unknown itemId), so the annotation states that honestly.
  const item: ItemDef | undefined = ITEMS[itemId];
  if (item === undefined) {
    return false; // fail-open: no catalog entry -> no cap system -> never "full"
  }
  const cap = tierCap(state, item.tier);
  // inventory is sparse for dynamically-acquired itemIds, so an absent key means 0
  // held (matching addToInventory's own `?? new Decimal(0)` grow-on-demand shape).
  const have = state.inventory[itemId] ?? new Decimal(0);
  return have.gte(cap);
}

// ============================================================================
// Offline catch-up cap (Phase 2, Task B3)
// (docs/plans/2026-07-13-phase-2-warehouse-refine-economy-design.md §2).
//
// The MAX number of ticks an offline catch-up will step forward, no matter how
// long the player was away. Derived (never stored) from a base of 2 real days,
// converted to ticks via the fleet's shared tickDurationSeconds -- the SAME
// deltaSeconds<->ticks cadence tick()/economyTick use everywhere else. At the
// default 1s cadence this is 172,800 ticks (2 * 86,400). Any elapsed span beyond
// this is DISCARDED by tick() (the excess simply does not accrue).
//
// EXTENSIBLE BY DESIGN: the cap is a FUNCTION of state, not a bare constant, so a
// future "offline extension" upgrade can lengthen it per-save without touching the
// call site. Today it returns exactly the base; the `+ future offline-extension
// upgrades` seam below is where such a bonus plugs in (NO such upgrade source
// exists yet -- per the no-placeholder rule we do NOT invent one now).
// ============================================================================
export const OFFLINE_CAP_DAYS_BASE = 2;

// Seconds in one real day -- named rather than an inline 86400 magic number, so the
// day->seconds conversion reads plainly at the one place it is used.
const SECONDS_PER_DAY = 86_400;

export function offlineCapTicks(state: GameState): number {
  // Base days, with room for future upgrade bonuses to add on. Kept as its own
  // local (not folded into the return expression) so the extension seam is a
  // one-line change here: `OFFLINE_CAP_DAYS_BASE + offlineExtensionDays(state)`.
  const capDays = OFFLINE_CAP_DAYS_BASE; // + future offline-extension upgrades
  const capSeconds = capDays * SECONDS_PER_DAY;
  // Convert the wall-clock cap into the fleet-wide tick cadence -- the EXACT same
  // `seconds / tickDurationSeconds` conversion tick() applies to deltaSeconds, so
  // the cap is expressed in the same unit tick() clamps against.
  return capSeconds / state.tickDurationSeconds;
}

// Starts ONE refine job for `recipeKey` IF (a) the recipe exists, (b) a refine
// slot is free (active refineJob count < refineSlotCount), and (c) startProcess
// can afford the recipe inputs. On any miss it is a same-reference no-op
// ({ next: state, started: false }) -- the reject convention every action in this
// file shares. On success it delegates to the Task 8 startProcess engine, which
// deducts the inputs ATOMICALLY at start (design §4) and pushes a "refineJob"
// TimedProcess whose completion effect adds the recipe output (resolveProcesses
// grants it + marks it discovered + bumps lifetimeStats.itemsRefined).
//
// SINGLE MANUAL JOBS ONLY (Task 11 scope). Batch count-N + continuous auto-repeat
// (a slot running an ORDER, not one job -- with per-iteration atomic deduct + the
// closed-form offline-bulk formula, design §6) is a DEFERRED fast-follow: see the
// "Refinery batch/continuous refine ORDERS" entry in SUGGESTIONS.md. Do NOT add
// looping here -- each call starts exactly one job.
//
// SLOT GATE vs. FACILITY UPGRADES: refine jobs parallelize by SLOT COUNT (this
// gate), NOT by the sequential-per-facility upgrade gate in canBuildFacilityUpgrade
// -- the two are deliberately independent (a refinery can run N jobs while also
// having an upgrade in flight). Only "refineJob" processes count against slots;
// facilityUpgrade processes are ignored here (and vice versa).
//
// `recipeKey` is typed `string` (forward-loose, like startFacilityUpgrade's
// facilityKey) with an explicit undefined guard, so an unknown key is a clean
// rejection rather than a throw on `undefined.input`.
export function startRefineJob(
  state: GameState,
  recipeKey: string
): { next: GameState; started: boolean } {
  const recipe = REFINE_RECIPES[recipeKey];
  if (!recipe) return { next: state, started: false };

  // Slot gate: count only the refine jobs already in flight (facility upgrades do
  // not consume refine slots). A free slot exists iff that count is below the
  // derived slot total. At 0 slots (unbuilt refinery) this is always false -> no
  // job can start until the refinery is built.
  const activeRefineJobs = state.activeProcesses.filter((p) => p.kind === "refineJob").length;
  if (activeRefineJobs >= refineSlotCount(state)) return { next: state, started: false };

  // A slot is free -> hand the recipe to startProcess, which applies the FINAL
  // gate (affordability) and the atomic deduct. If the inputs are short,
  // startProcess itself returns { next: state, started: false } (same reference),
  // so an unaffordable job is rejected here too with no extra check needed.
  return startProcess(state, "refineJob", recipe.input, recipe.durationTicks, {
    type: "addItem",
    itemId: recipe.output.itemId,
    amount: recipe.output.amount,
  });
}

// Advances every active process by `ticksElapsed` and resolves completions. THE
// single completion resolver (Task 9 calls it from BOTH tick() and the live loop).
//
// CLOSED-FORM: one resolveProcesses(state, N) must equal N resolveProcesses(_, 1)
// -- for the final inventory/facilities/activeProcesses AND the total FA XP. It
// holds because each process's fate is a pure function of its remainingTicks vs
// the elapsed total: decrementing by N once lands the same countdown as
// decrementing by 1 N times, and a process that crosses zero completes exactly
// ONCE either way (it is removed on completion, so a later/again call cannot
// re-complete or re-award it). See the parity test in process.test.ts.
//
// FRACTIONAL-TICK ROBUSTNESS: Task 9 feeds ticksElapsed = deltaSeconds /
// tickDurationSeconds, which can be fractional -- so repeated decrements can leave
// a sub-epsilon residue at a completion boundary (e.g. 1e-13 instead of 0), the
// SAME float-drift hazard the mission engine's MISSION_TICK_EPSILON guards. We
// reuse that exact constant: a process is COMPLETE once remainingTicks <=
// MISSION_TICK_EPSILON, so a boundary reached via many small fractional steps
// completes at the same logical point as one big jump. For the integer stepping
// the parity test uses, epsilon is inert (integers hit 0 exactly). durationTicks
// is expected positive; a non-positive-duration process would complete on its
// first resolve, which is the correct reading of "zero-length process".
//
// FA XP is LUMPED on completion: a completed process contributes its FULL
// durationTicks to fleetAdminXpDelta, exactly once. Task 9 folds the returned
// delta via applyFleetAdminXp (the same path mission FA XP takes). Facility
// processes award NO captain XP (no captain pilots them) -- this resolver only
// ever touches Fleet Admiral XP.
export function resolveProcesses(
  state: GameState,
  ticksElapsed: number
): { next: GameState; fleetAdminXpDelta: number } {
  // Cheap same-reference no-op: nothing in flight, or no time actually elapsed.
  // Mirrors applyFleetAdminXp's early-out. (Every SURVIVING process always has
  // remainingTicks > epsilon, so a <=0 ticksElapsed call can never leave a
  // ready-to-complete process unresolved by skipping here.)
  if (ticksElapsed <= 0 || state.activeProcesses.length === 0) {
    return { next: state, fleetAdminXpDelta: 0 };
  }

  // Threaded immutably through completions (each addToInventory returns fresh
  // objects); seeded from the incoming state so a call that completes nothing
  // returns value-identical maps. `facilities` is re-cloned per level-up below.
  let inventory = state.inventory;
  let discovered = state.discovered;
  let facilities = state.facilities;
  // Task 11: threaded so a completing refineJob can also bump its per-item
  // lifetime itemsRefined tally. Seeded from the incoming state, so a call that
  // completes no refine job returns the SAME lifetimeStats reference (value-
  // identical -- the empty-early-out and the no-completion path both leave it
  // untouched). Re-cloned only when a refineJob actually completes below.
  let lifetimeStats = state.lifetimeStats;
  let fleetAdminXpDelta = 0;
  // Survivors are rebuilt in original order, so activeProcesses ordering is stable
  // across both chunkings (the parity test compares the arrays deep-equal).
  const stillActive: TimedProcess[] = [];

  for (const process of state.activeProcesses) {
    const remainingTicks = process.remainingTicks - ticksElapsed;
    if (remainingTicks > MISSION_TICK_EPSILON) {
      // Not done -- keep it with its decremented countdown. A later resolve picks
      // up exactly here, which is why one N-tick step lands the same remaining as
      // N one-tick steps (closed-form).
      stillActive.push({ ...process, remainingTicks });
      continue;
    }

    // COMPLETE. Apply the effect, award the lump FA XP, and DROP the process
    // (never pushed to stillActive) so it resolves exactly once.
    if (process.effect.type === "addItem") {
      // Output granted through the shared add seam -> the item is marked
      // discovered (its amount is always > 0 for a real refine recipe).
      const applied = addToInventory(inventory, discovered, process.effect.itemId, process.effect.amount);
      inventory = applied.inventory;
      discovered = applied.discovered;
      // Task 11: a completed REFINE JOB (and ONLY a refine job) also accrues the
      // per-item lifetime itemsRefined total. Guarded on kind === "refineJob"
      // because addItem is a shared effect: a facilityUpgrade never uses it, but a
      // FUTURE fabricator "fabricateJob" will -- and that must feed itemsCrafted,
      // not itemsRefined, so this stays scoped to refine jobs by kind. Closed-form
      // for the SAME reason FA XP is: it fires exactly ONCE, on the same completion
      // that drops the process (a resolved process is never revisited), so one big
      // resolve and many small ones accrue the identical total. Immutable per-key
      // add (fresh maps), mirroring addToInventory's own grow-on-demand shape:
      // an item absent from itemsRefined starts at 0.
      if (process.kind === "refineJob") {
        const itemId = process.effect.itemId;
        const priorRefined = lifetimeStats.itemsRefined[itemId] ?? new Decimal(0);
        lifetimeStats = {
          ...lifetimeStats,
          itemsRefined: {
            ...lifetimeStats.itemsRefined,
            [itemId]: priorRefined.plus(process.effect.amount),
          },
        };
      }
    } else {
      // facilityLevelUp: bump the target facility on a FRESH facilities map
      // (immutable). An absent facility starts from level 0 (grow-on-demand, same
      // posture as inventory), so unlock (0->1) and every later level share one path.
      const facility = process.effect.facility;
      const current = facilities[facility] ?? { level: 0 };
      facilities = { ...facilities, [facility]: { ...current, level: current.level + 1 } };
    }
    fleetAdminXpDelta += process.durationTicks;
  }

  return {
    next: { ...state, inventory, discovered, facilities, lifetimeStats, activeProcesses: stillActive },
    fleetAdminXpDelta,
  };
}

// Same "same state reference on failure" convention as every other buy/action
// function in this file. Validates: talent exists, not already unlocked,
// learnable by graph adjacency (a hub, or adjacent to an already-unlocked node
// in this branch -- the Radial Skill Web replaced the old single-parent
// `requires` chain with this rule; it mirrors computeVisibleTalents' learnable
// condition so what the UI shows as learnable is exactly what buy allows),
// statPoints sufficient. On success:
// deducts cost, records the unlock. The effect itself isn't APPLIED here --
// each effect type is read wherever that stat matters (the 5 tier-specific
// yield/chance mults inside tickCaptainMission's rollExtractionTick call, see
// the captainCommonYieldMult/captainUncommonYieldMult/captainUncommonChanceMult/
// captainRareChanceMult helpers above) by checking unlockedCaptainTalents at
// read time, same pattern this codebase already uses for e.g. specialization
// multipliers historically. Deliberately generalized wording (not naming
// specific effect types) so this comment doesn't go stale again next time an
// effect type is added/renamed.
export function buyCaptainTalent(
  state: GameState,
  captainId: number,
  talentKey: CaptainTalentKey
): { next: GameState; success: boolean } {
  const idx = state.captains.findIndex((c) => c.id === captainId);
  if (idx === -1) return { next: state, success: false };
  const captain = state.captains[idx];
  const talent = CAPTAIN_TALENTS[talentKey];

  if (captain.unlockedCaptainTalents.includes(talentKey)) return { next: state, success: false };
  // Adjacency gate (Radial Skill Web, Task 5): a node is learnable iff it is a
  // hub OR at least one of its neighbors is already owned. Same rule as
  // computeVisibleTalents (talentWeb.ts) -- buy and visibility stay consistent.
  const isLearnable =
    talent.isHub || talent.neighbors.some((n) => captain.unlockedCaptainTalents.includes(n));
  if (!isLearnable) return { next: state, success: false };
  if (captain.statPoints < talent.cost) return { next: state, success: false };

  const captains = [...state.captains];
  captains[idx] = {
    ...captain,
    statPoints: captain.statPoints - talent.cost,
    unlockedCaptainTalents: [...captain.unlockedCaptainTalents, talentKey],
  };
  return { next: { ...state, captains }, success: true };
}

// Same shape as buyCaptainTalent, fleet-wide -- including the same graph
// adjacency gate: learnable iff a hub, or adjacent to an already-unlocked node
// in this branch (against state.unlockedHomeworldTalents). unlockCaptainSlot is
// the one effect type with additional side effects beyond "record the unlock"
// -- appending a new captain via freshCaptainStack() (same baseline every other
// captain-creation path in this codebase uses) AND granting that captain an
// assigned General Freighter, so the "every captain always has exactly one
// assigned ship" invariant holds here too (its third enforcement site, after
// new-game and save migration).
export function buyHomeworldTalent(
  state: GameState,
  talentKey: HomeworldTalentKey
): { next: GameState; success: boolean } {
  const talent = HOMEWORLD_TALENTS[talentKey];

  if (state.unlockedHomeworldTalents.includes(talentKey)) return { next: state, success: false };
  // Adjacency gate (Radial Skill Web, Task 5): learnable iff a hub OR at least
  // one neighbor is already owned. Same rule as computeVisibleTalents.
  const isLearnable =
    talent.isHub || talent.neighbors.some((n) => state.unlockedHomeworldTalents.includes(n));
  if (!isLearnable) return { next: state, success: false };
  // Fleet-Admiral-level wall (Progression Pacing Rework, Task 9): an OPTIONAL
  // gate LAYERED on top of -- not replacing -- the adjacency check above and the
  // adminPoint cost check below. Only nodes that declare requiresFleetAdminLevel
  // (today: the 3rd/4th captain-slot unlocks, L5/L25 -- the 2nd-slot unlock is
  // intentionally UNGATED) are gated; nodes without
  // it (undefined) skip this entirely, so the gate is opt-in and every other
  // talent is unaffected. Captains are "wall breakers": recruiting one needs the
  // FA level AND the adminPoint cost AND adjacency, all three (confirmed with the
  // user 2026-07-11). Same "same state reference on failure" convention as every
  // other precondition here -- purchase blocked, state returned unchanged.
  if (talent.requiresFleetAdminLevel !== undefined && state.fleetAdminLevel < talent.requiresFleetAdminLevel) {
    return { next: state, success: false };
  }
  if (state.adminPoints < talent.cost) return { next: state, success: false };

  const unlockedHomeworldTalents = [...state.unlockedHomeworldTalents, talentKey];
  const adminPoints = state.adminPoints - talent.cost;

  if (talent.effect.type === "unlockCaptainSlot") {
    // Gated ENTIRELY on the node's own `talent.cost` in adminPoints, checked
    // above -- confirmed with the user that Homeworld Talents (fleet-wide
    // Fleet Admiral prestige) are deliberately independent of any individual
    // captain's own level/statPoints, unlike the old captain-scoped
    // CAPTAIN_SLOT_UNLOCKS mechanism this replaced (removed in Task 4).
    const nextId = state.captains.length + 1;
    const captains = [
      ...state.captains,
      { id: nextId, label: `Captain ${nextId}`, ...freshCaptainStack() }, // shipType removed (captain no longer owns a hull)
    ];
    // Every captain always has exactly one assigned ship (invariant enforced at
    // new-game, migration, and HERE). A newly-unlocked captain is granted a
    // General Freighter, assigned to them, REGARDLESS of shipStorageCapacity --
    // a captain must have a hull to be dispatchable (cap is 8 > the current 4-
    // captain ceiling, so this never conflicts today).
    const ships = [
      ...state.ships,
      { id: `ship-${state.nextShipId}`, typeKey: "generalFreighter" as const, assignedCaptainId: nextId },
    ];
    return {
      next: { ...state, captains, ships, nextShipId: state.nextShipId + 1, adminPoints, unlockedHomeworldTalents },
      success: true,
    };
  }

  return { next: { ...state, adminPoints, unlockedHomeworldTalents }, success: true };
}

// Full-reset only (no per-node refunds) -- refunds every statPoints this
// captain spent across their ENTIRE unlockedCaptainTalents list, then clears
// it. Costs RESPEC_COST_CREDITS credits, fleet-wide (credits aren't
// per-captain). Fails with the SAME state reference if the captain doesn't
// exist or credits are insufficient -- same convention as every other
// buy/action function in this file.
//
// The optional `newSpec` argument bundles a spec change into this SAME
// reset+cost (per the design doc's Captain Specialization section) --
// omitting it (or passing `undefined`) leaves the captain's CURRENT spec
// untouched, so a plain "reset my talents" click doesn't force a spec
// change. Passing an explicit spec (including `null`, to clear it) sets
// `captain.spec` atomically with the talent wipe, same cost either way.
// Does NOT validate that `newSpec` is a real, unlocked-for-selection branch
// (i.e. one with a CAPTAIN_SPEC_BONUS entry) -- that's a UI-layer concern
// (App.svelte only offers selectable specs as options in the first place),
// same "trust the caller" boundary this codebase already draws elsewhere.
export function respecCaptainTalents(
  state: GameState,
  captainId: number,
  newSpec?: CaptainTalentBranch | null
): { next: GameState; success: boolean } {
  const idx = state.captains.findIndex((c) => c.id === captainId);
  if (idx === -1) return { next: state, success: false };
  if (state.credits.lt(RESPEC_COST_CREDITS)) return { next: state, success: false };

  const captain = state.captains[idx];
  const refund = captain.unlockedCaptainTalents.reduce((sum, key) => sum + CAPTAIN_TALENTS[key].cost, 0);

  const captains = [...state.captains];
  captains[idx] = {
    ...captain,
    statPoints: captain.statPoints + refund,
    unlockedCaptainTalents: [],
    // NOT `newSpec ?? captain.spec` -- `??` would also replace an explicit
    // `null` (clear spec) with captain.spec, indistinguishable from omitting
    // the argument entirely. Must stay a strict `undefined` check.
    spec: newSpec === undefined ? captain.spec : newSpec,
  };
  return { next: { ...state, captains, credits: state.credits.minus(RESPEC_COST_CREDITS) }, success: true };
}

// FREE first-pick spec setter (Radial Skill Web, Task 14). Sets a captain's
// spec ONLY when it is currently null -- the free, one-time "choose your
// specialization" pick a captain makes before their talent web appears. It is
// deliberately NOT the way to CHANGE an already-chosen spec: once
// captain.spec !== null, this function refuses (returns the same state
// reference, success: false), and the ONLY path to a different spec is
// respecCaptainTalents(state, captainId, null) -- clearing the spec back to
// null (refunding points, charging RESPEC_COST_CREDITS) so this free pick
// becomes available again. That split (first pick free here; changing an
// established spec costs exactly one respec) is a confirmed design decision:
// choosing from null undoes nothing, so it's free; changing an existing spec
// means abandoning a built talent web, which is what the respec charge exists
// to gate. Unlike respecCaptainTalents this touches NO cost and NO points --
// it only sets captain.spec. Same "same state reference on failure"
// convention and immutable "map captains, spread the one" idiom as every
// other captain-mutating function in this file.
export function chooseCaptainSpec(
  state: GameState,
  captainId: number,
  branch: CaptainTalentBranch
): { next: GameState; success: boolean } {
  const idx = state.captains.findIndex((c) => c.id === captainId);
  if (idx === -1) return { next: state, success: false };
  // Only the FREE first pick is allowed here. A captain that already has a
  // spec must go through respecCaptainTalents(..., null) to clear it first --
  // see this function's header comment for why changing an established spec is
  // deliberately not free.
  if (state.captains[idx].spec !== null) return { next: state, success: false };

  const captains = [...state.captains];
  captains[idx] = { ...captains[idx], spec: branch };
  return { next: { ...state, captains }, success: true };
}

// Full-reset only, same as respecCaptainTalents, but EXCLUDES unlockCaptainSlot
// nodes entirely -- those stay permanently unlocked (no refund, not removed
// from unlockedHomeworldTalents) since undoing one would mean deleting an
// existing captain and everything on it (their own Captain Talents, any
// in-progress mission, cargo). Confirmed with the user rather than silently
// making resets destructive. Fails with the SAME state reference if credits
// are insufficient.
export function respecHomeworldTalents(state: GameState): { next: GameState; success: boolean } {
  if (state.credits.lt(RESPEC_COST_CREDITS)) return { next: state, success: false };

  const refundableKeys = state.unlockedHomeworldTalents.filter(
    (key) => HOMEWORLD_TALENTS[key].effect.type !== "unlockCaptainSlot"
  );
  const refund = refundableKeys.reduce((sum, key) => sum + HOMEWORLD_TALENTS[key].cost, 0);
  const survivingKeys = state.unlockedHomeworldTalents.filter(
    (key) => HOMEWORLD_TALENTS[key].effect.type === "unlockCaptainSlot"
  );

  return {
    next: {
      ...state,
      adminPoints: state.adminPoints + refund,
      unlockedHomeworldTalents: survivingKeys,
      credits: state.credits.minus(RESPEC_COST_CREDITS),
    },
    success: true,
  };
}
