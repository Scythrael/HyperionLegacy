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
  freshCaptainStack,
  shipDerivedStats,
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
} from "./model";

// Must stay in sync with MissionPhase and requiredTicksForPhase's switch --
// there's no compiler link between this array and the union type, so a 6th
// phase added to MissionPhase without a matching entry here would silently
// wrap `.indexOf()` to -1 instead of erroring.
const MISSION_PHASE_ORDER: MissionPhase[] = ["ordersReceived", "transitOut", "extracting", "transitBack", "unloading"];

function emptyLootTotals(): Record<LootMaterialKey, Decimal> {
  return { commonOre: new Decimal(0), uncommonMaterial: new Decimal(0), rareMaterial: new Decimal(0) };
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
const MAX_LEVEL_UPS_PER_TICK = 10_000;

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
} {
  if (!captain.mission || ticksElapsed <= 0) {
    return { captain, homePlanetDelta: emptyLootTotals(), fleetAdminXpDelta: 0, creditsDelta: 0 };
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
  // Accumulates this captain's Fleet Admiral XP contribution across every
  // mission cycle completed within this call -- same "accumulate locally,
  // apply once" shape as homePlanetDelta above. tick() sums this across
  // every captain fleet-wide before handing the total to applyFleetAdminXp.
  let fleetAdminXpDelta = 0;
  // Accumulates this captain's credits contribution across every mission
  // cycle completed within this call -- same "accumulate locally, apply
  // once" shape as fleetAdminXpDelta immediately above. tick() sums this
  // across every captain fleet-wide, then applies it to state.credits with a
  // flat .plus() (credits has no leveling curve, unlike fleetAdminXpDelta).
  let creditsDelta = 0;

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
        (Object.keys(mission.cargo) as LootMaterialKey[]).forEach((key) => {
          homePlanetDelta[key] = homePlanetDelta[key].plus(mission.cargo[key]);
        });
        // Fleet Admiral XP and credits are still awarded once PER completed
        // cycle (this branch can be reached multiple times within one call's
        // while loop -- e.g. a big offline-catchup ticksElapsed spanning several
        // full cycles). Captain XP is NO LONGER awarded here: Task 4 moved it to
        // a single per-whole-tick accrual after the loop (see below), so this
        // branch touches only the fleet-wide/credit totals now.
        fleetAdminXpDelta += missionDef.fleetAdminXpPerCycle;
        creditsDelta += missionDef.creditsPerCycle;
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
  xp = xp.plus(new Decimal(xpRate).times(wholeTicksElapsed));
  let levelUpsThisCall = 0;
  while (xp.gte(xpForNextLevel(level)) && levelUpsThisCall < MAX_LEVEL_UPS_PER_TICK) {
    xp = xp.minus(xpForNextLevel(level));
    level += 1;
    statPoints += 1;
    levelUpsThisCall += 1;
  }

  return { captain: { ...captain, mission, xp, level, statPoints }, homePlanetDelta, fleetAdminXpDelta, creditsDelta };
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

// Idle captains (mission === null) have no passive economy anymore --
// missions are the only way a captain does anything. Only mission captains
// need advancing; this is the sole reason to even call .map() below rather
// than filtering. gameTimeSeconds and homePlanet.storage are fleet-wide
// bookkeeping, each updated exactly once per call (not once per captain).
export function tick(deltaSeconds: number, state: GameState): GameState {
  if (deltaSeconds <= 0) return state;

  // Fleet-wide cadence (moved off CaptainState during the UI Redesign -- see
  // docs/plans/2026-07-07-ui-redesign-design.md) -- read ONCE, applied
  // uniformly to every captain below, rather than each captain reading its
  // own field.
  const ticksElapsed = deltaSeconds / state.tickDurationSeconds;
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
  // Computed ONCE for the whole fleet (same value for every captain), not
  // per captain inside the .map() below -- Homeworld Talents are fleet-wide,
  // not per-captain.
  const fleetRareYield = fleetRareYieldMult(state);
  const captains = state.captains.map((captain) => {
    if (captain.mission === null) return captain;
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
    // Math.random passed explicitly (rather than omitted) since bonuses is
    // positional arg 4 -- omitting arg 3 here would pass bonuses AS rng.
    const {
      captain: updated,
      homePlanetDelta: delta,
      fleetAdminXpDelta: captainFleetAdminXpDelta,
      creditsDelta: captainCreditsDelta,
    } = tickCaptainMission(ticksElapsed, captain, Math.random, bonuses, shipStats);
    (Object.keys(delta) as LootMaterialKey[]).forEach((key) => {
      homePlanetDelta[key] = homePlanetDelta[key].plus(delta[key]);
    });
    fleetAdminXpDelta += captainFleetAdminXpDelta;
    creditsDelta += captainCreditsDelta;
    return updated;
  });

  // passiveTrickle (Homeworld Talent economyTrickle): flat fleet-wide
  // material generation, independent of missions -- applies even with zero
  // captains dispatched. Scales by ticksElapsed (not deltaSeconds) to stay on
  // the same fleet-wide cadence as everything else, and multiplying by
  // ticksElapsed (rather than looping per tick) keeps this closed-form, same
  // requirement tickCaptainMission's own header comment explains.
  for (const key of state.unlockedHomeworldTalents) {
    const effect = HOMEWORLD_TALENTS[key].effect;
    if (effect.type === "passiveTrickle" && (LOOT_MATERIAL_KEYS as string[]).includes(effect.material)) {
      homePlanetDelta[effect.material as LootMaterialKey] = homePlanetDelta[effect.material as LootMaterialKey].plus(
        effect.perTick * ticksElapsed
      );
    }
  }

  // applyFleetAdminXp wraps the final state object -- it must run AFTER
  // captains is built above, since fleetAdminXpDelta was accumulated from
  // each captain's mission-cycle completions during THIS call's .map()
  // above. Does not touch homePlanet at all -- the spread-then-overwrite
  // pattern immediately below (guarding against the "prestige silently
  // dropped homePlanet" bug class) is untouched by this wrapping.
  return applyFleetAdminXp(
    {
      ...state,
      captains,
      gameTimeSeconds: state.gameTimeSeconds + deltaSeconds,
      // Flat .plus() -- unlike fleetAdminXpDelta (which resolves through
      // applyFleetAdminXp's level-up loop below), credits has no leveling
      // curve to resolve, so the accumulated creditsDelta is applied directly
      // here rather than passed through a second wrapping function.
      credits: state.credits.plus(creditsDelta),
      homePlanet: {
        storage: {
          // Spread FIRST, then overwrite only the 3 loot tiers this function
          // actually touches -- preserves any OTHER field a later task (the
          // Homeworld crafting system) adds to homePlanet.storage
          // (e.g. refinedMaterial, components) that this function doesn't
          // itself produce. Without this spread, tick() would silently zero
          // out any such field on every call, since it wouldn't exist on this
          // object literal -- the exact class of bug a "prestige silently
          // dropped homePlanet" fix caught in the immediately-prior shipped
          // feature (Phase 3a). Do not remove this spread.
          ...state.homePlanet.storage,
          commonOre: state.homePlanet.storage.commonOre.plus(homePlanetDelta.commonOre),
          uncommonMaterial: state.homePlanet.storage.uncommonMaterial.plus(homePlanetDelta.uncommonMaterial),
          rareMaterial: state.homePlanet.storage.rareMaterial.plus(homePlanetDelta.rareMaterial),
        },
      },
    },
    fleetAdminXpDelta
  );
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
    if (state.homePlanet.storage[key].lt(needed)) return { next: state, success: false };
  }

  const storage = { ...state.homePlanet.storage };
  for (const key of Object.keys(recipe.inputs) as HomePlanetMaterialKey[]) {
    const needed = recipe.inputs[key] ?? new Decimal(0);
    storage[key] = storage[key].minus(needed);
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
  // bonusOutput (plain number) flows directly into .plus() -- DecimalSource
  // accepts plain numbers, no wrapping needed.
  storage[recipe.output.key] = storage[recipe.output.key].plus(recipe.output.amount).plus(bonusOutput);

  return { next: { ...state, homePlanet: { storage } }, success: true };
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
