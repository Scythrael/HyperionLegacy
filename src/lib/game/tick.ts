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
  xpForNextLevel,
  xpForNextFleetAdminLevel,
  MISSIONS,
  RECIPES,
  CAPTAIN_TALENTS,
  HOMEWORLD_TALENTS,
  freshCaptainStack,
  type GameState,
  type CaptainState,
  type CaptainMissionState,
  type LootMaterialKey,
  type MissionDef,
  type MissionPhase,
  type MissionKey,
  type RecipeKey,
  type HomePlanetMaterialKey,
  type CaptainTalentKey,
  type HomeworldTalentKey,
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

// Flat XP award per completed mission cycle -- a launch placeholder balance
// value, same spirit as MISSIONS' own hand-tuned tick counts. Awarded once
// PER CYCLE completed within a call (a big offline-catchup jump can complete
// several cycles in one call -- see the while loop below), never once per call.
const XP_PER_MISSION_CYCLE = 50;

// A very large offline-catchup ticksElapsed could complete many mission
// cycles across many captains in one tick() call, each contributing 1-2
// Fleet Admiral XP -- summing to a potentially large delta applied in one
// shot. Capping applyFleetAdminXp's level-up loop at a fixed max per call
// and carrying any leftover XP forward (it keeps resolving on the NEXT
// tick() call, which happens continuously during live play) avoids an
// unbounded loop. This same constant is reused (not redefined) by the
// separate, not-yet-started Big-Number Migration
// (docs/plans/2026-07-08-big-number-migration-plan.md), which needs the
// identical safeguard for captain XP once that field becomes Decimal-typed.
const MAX_LEVEL_UPS_PER_TICK = 10_000;

// Independent per-tier roll for ONE whole tick of extraction (2026-07-07 Loot
// Tier Rework -- see the design doc). Replaces the old single mutually-
// exclusive rollLootTable pick: uncommon and rare are each rolled
// independently here and CAN both occur in the same tick (not exclusive of
// each other), each replacing that many units of common ore rather than
// adding on top of it.
//
// Exactly 3 rng() calls happen, ALWAYS in this order, regardless of outcome:
//   1. does uncommon occur (rng() < effective uncommon chance)
//   2. IF uncommon occurred: its base amount (rng() again -- 75% -> 1, 20% -> 2, 5% -> 3)
//   3. does rare occur (rng() < effective rare chance) -- rare's amount is always 1, no 4th call needed
// This fixed call count/order matters for hand-tracing a deterministic test
// rng, and for the closed-form guarantee tickCaptainMission depends on (use
// a CONSTANT, non-stateful rng in tests -- see that function's own comment).
//
// yieldMults scale the AMOUNT actually delivered: commonYieldMult scales the
// leftover-after-carve-out common amount (so total per-tick delivery CAN
// exceed extractionRatePerTick -- intentional, this is what "more efficient
// common extraction" should feel like); uncommonYieldMult/rareYieldMult each
// scale their own tier's rolled amount, only when that tier actually
// occurred this tick (nothing to scale if it didn't).
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

  let uncommonAmount = new Decimal(0);
  if (rng() < effectiveUncommonChance) {
    const amountRoll = rng();
    const baseAmount = amountRoll < 0.75 ? 1 : amountRoll < 0.95 ? 2 : 3;
    uncommonAmount = new Decimal(baseAmount).times(1 + bonuses.uncommonYieldMult);
  }

  let rareAmount = new Decimal(0);
  if (rng() < effectiveRareChance) {
    rareAmount = new Decimal(1).times(1 + bonuses.rareYieldMult);
  }

  // Split into two named steps -- carve out uncommon/rare, THEN scale by
  // commonYieldMult -- so this central formula reads the same two-stage
  // shape the header comment above describes, rather than one long chained
  // expression that has to be held in your head across a line wrap.
  const commonBeforeYield = Decimal.max(
    0,
    new Decimal(missionDef.extractionRatePerTick).minus(uncommonAmount).minus(rareAmount)
  );
  const commonAmount = commonBeforeYield.times(1 + bonuses.commonYieldMult);

  return { commonOre: commonAmount, uncommonMaterial: uncommonAmount, rareMaterial: rareAmount };
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
  } = {}
): { captain: CaptainState; homePlanetDelta: Record<LootMaterialKey, Decimal>; fleetAdminXpDelta: number } {
  if (!captain.mission || ticksElapsed <= 0) {
    return { captain, homePlanetDelta: emptyLootTotals(), fleetAdminXpDelta: 0 };
  }

  const missionDef = MISSIONS[captain.mission.missionKey];
  let mission: CaptainMissionState | null = { ...captain.mission, cargo: { ...captain.mission.cargo } };
  let remaining = ticksElapsed;
  const homePlanetDelta = emptyLootTotals();
  // Seeded from the captain's CURRENT xp/level/statPoints -- mutated only
  // inside the cycle-completion branch below, once per cycle actually
  // completed within this call (mirrors homePlanetDelta's own accumulation).
  let xp = captain.xp;
  let level = captain.level;
  let statPoints = captain.statPoints;
  // Accumulates this captain's Fleet Admiral XP contribution across every
  // mission cycle completed within this call -- same "accumulate locally,
  // apply once" shape as homePlanetDelta above. tick() sums this across
  // every captain fleet-wide before handing the total to applyFleetAdminXp.
  let fleetAdminXpDelta = 0;

  // Computed ONCE per call, not per roll -- bonuses are constant for the
  // whole call, so this stays closed-form (the "one big jump equals many
  // small ticks" test doesn't care how many rolls happen, only that each
  // roll uses the same resolved bonuses either way).
  const resolvedBonuses = {
    commonYieldMult: bonuses.commonYieldMult ?? 0,
    uncommonYieldMult: bonuses.uncommonYieldMult ?? 0,
    uncommonChanceMult: bonuses.uncommonChanceMult ?? 0,
    rareYieldMult: bonuses.rareYieldMult ?? 0,
    rareChanceMult: bonuses.rareChanceMult ?? 0,
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
        // XP is awarded once per cycle completed here (this branch can be
        // reached multiple times within one call's while loop -- e.g. a big
        // offline-catchup ticksElapsed spanning several full cycles), NOT
        // once per tickCaptainMission call. Resolve every level-up crossed by
        // this award, not just one -- a while (not if) loop, same closed-form
        // spirit as the phase-advancement logic above.
        xp += XP_PER_MISSION_CYCLE;
        fleetAdminXpDelta += missionDef.fleetAdminXpPerCycle;
        while (xp >= xpForNextLevel(level)) {
          xp -= xpForNextLevel(level);
          level += 1;
          statPoints += 1;
        }
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

  return { captain: { ...captain, mission, xp, level, statPoints }, homePlanetDelta, fleetAdminXpDelta };
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
  const startingXp = fleetAdminXpDelta > 0 ? state.fleetAdminXp + fleetAdminXpDelta : state.fleetAdminXp;
  const hasBacklog = startingXp >= xpForNextFleetAdminLevel(state.fleetAdminLevel);
  if (fleetAdminXpDelta <= 0 && !hasBacklog) return state; // cheap no-op: no new XP this call, and nothing left over from a prior capped call to resolve

  let xp = startingXp;
  let level = state.fleetAdminLevel;
  let adminPoints = state.adminPoints;
  let levelUpsThisCall = 0;
  while (xp >= xpForNextFleetAdminLevel(level) && levelUpsThisCall < MAX_LEVEL_UPS_PER_TICK) {
    xp -= xpForNextFleetAdminLevel(level);
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
  // Computed ONCE for the whole fleet (same value for every captain), not
  // per captain inside the .map() below -- Homeworld Talents are fleet-wide,
  // not per-captain.
  const fleetRareYield = fleetRareYieldMult(state);
  const captains = state.captains.map((captain) => {
    if (captain.mission === null) return captain;
    const bonuses = {
      commonYieldMult: captainCommonYieldMult(captain),
      uncommonYieldMult: captainUncommonYieldMult(captain),
      uncommonChanceMult: captainUncommonChanceMult(captain),
      rareYieldMult: fleetRareYield,
      rareChanceMult: captainRareChanceMult(captain),
    };
    // Math.random passed explicitly (rather than omitted) since bonuses is
    // positional arg 4 -- omitting arg 3 here would pass bonuses AS rng.
    const {
      captain: updated,
      homePlanetDelta: delta,
      fleetAdminXpDelta: captainFleetAdminXpDelta,
    } = tickCaptainMission(ticksElapsed, captain, Math.random, bonuses);
    (Object.keys(delta) as LootMaterialKey[]).forEach((key) => {
      homePlanetDelta[key] += delta[key];
    });
    fleetAdminXpDelta += captainFleetAdminXpDelta;
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
      homePlanetDelta[effect.material as LootMaterialKey] += effect.perTick * ticksElapsed;
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
          commonOre: state.homePlanet.storage.commonOre + homePlanetDelta.commonOre,
          uncommonMaterial: state.homePlanet.storage.uncommonMaterial + homePlanetDelta.uncommonMaterial,
          rareMaterial: state.homePlanet.storage.rareMaterial + homePlanetDelta.rareMaterial,
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

// Validates every input in the recipe is affordable, deducts them all, adds
// the output -- same "same state reference on failure" convention as every
// other buy/action function in this file (dispatchCaptainOnMission,
// recallCaptain). Manual-craft-button only this phase; an auto-craft toggle
// is a deliberate near-term follow-up, not built here.
export function craftRecipe(state: GameState, recipeKey: RecipeKey): { next: GameState; success: boolean } {
  const recipe = RECIPES[recipeKey];
  for (const key of Object.keys(recipe.inputs) as HomePlanetMaterialKey[]) {
    const needed = recipe.inputs[key] ?? 0;
    if (state.homePlanet.storage[key] < needed) return { next: state, success: false };
  }

  const storage = { ...state.homePlanet.storage };
  for (const key of Object.keys(recipe.inputs) as HomePlanetMaterialKey[]) {
    storage[key] -= recipe.inputs[key] ?? 0;
  }

  // recipeBonusOutput (Homeworld Talent, e.g. industryBonusOutput): a FLAT
  // extra amount added per craft, not a multiplier -- matches the effect
  // type's own `bonus: number` field name/shape. Reduce over every unlocked
  // talent (not just industryBonusOutput by name) so any future
  // recipeBonusOutput entry targeting a different recipeKey works without
  // touching this function again.
  const bonusOutput = state.unlockedHomeworldTalents.reduce((sum, key) => {
    const effect = HOMEWORLD_TALENTS[key].effect;
    return effect.type === "recipeBonusOutput" && effect.recipeKey === recipeKey ? sum + effect.bonus : sum;
  }, 0);
  storage[recipe.output.key] += recipe.output.amount + bonusOutput;

  return { next: { ...state, homePlanet: { storage } }, success: true };
}

// Same "same state reference on failure" convention as every other buy/action
// function in this file. Validates: talent exists, not already unlocked,
// prerequisite (if any) already unlocked, statPoints sufficient. On success:
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
  if (talent.requires && !captain.unlockedCaptainTalents.includes(talent.requires)) {
    return { next: state, success: false };
  }
  if (captain.statPoints < talent.cost) return { next: state, success: false };

  const captains = [...state.captains];
  captains[idx] = {
    ...captain,
    statPoints: captain.statPoints - talent.cost,
    unlockedCaptainTalents: [...captain.unlockedCaptainTalents, talentKey],
  };
  return { next: { ...state, captains }, success: true };
}

// Same shape as buyCaptainTalent, fleet-wide. unlockCaptainSlot is the one
// effect type with an additional side effect beyond "record the unlock" --
// appending a new captain via freshCaptainStack(), same baseline every other
// captain-creation path in this codebase uses.
export function buyHomeworldTalent(
  state: GameState,
  talentKey: HomeworldTalentKey
): { next: GameState; success: boolean } {
  const talent = HOMEWORLD_TALENTS[talentKey];

  if (state.unlockedHomeworldTalents.includes(talentKey)) return { next: state, success: false };
  if (talent.requires && !state.unlockedHomeworldTalents.includes(talent.requires)) {
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
      { id: nextId, label: `Captain ${nextId}`, shipType: "resourcer" as const, ...freshCaptainStack() },
    ];
    return { next: { ...state, captains, adminPoints, unlockedHomeworldTalents }, success: true };
  }

  return { next: { ...state, adminPoints, unlockedHomeworldTalents }, success: true };
}
