// Tick loop — tech spec §2 (Tick Loop and Time Semantics).
// Phase 4 (docs/plans/2026-07-06-phase4-navigation-progression-overhaul-plan.md):
// the Generator Stack economy (tickCaptainStack) and everything built on top
// of it (Research, both Prestige tiers, the Skill Tree) have been removed.
// Missions (tickCaptainMission, below) are now the ONLY economy -- an idle
// captain (mission === null) does nothing on a tick; there is no more
// passive production to compute for them. tick() advances the fleet-wide
// gameTimeSeconds once per call (not once per captain -- gameTimeSeconds is
// fleet bookkeeping, not tied to any single captain's production).

import {
  requiredTicksForPhase,
  rollLootTable,
  xpForNextLevel,
  MISSIONS,
  RECIPES,
  CAPTAIN_SLOT_UNLOCKS,
  CAPTAIN_TALENTS,
  HOMEWORLD_TALENTS,
  freshCaptainStack,
  type GameState,
  type CaptainState,
  type CaptainMissionState,
  type LootMaterialKey,
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

function emptyLootTotals(): Record<LootMaterialKey, number> {
  return { commonOre: 0, uncommonMaterial: 0, rareMaterial: 0 };
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
// the captain's own tickDurationSeconds. This keeps mission progress on a
// consistent per-captain cadence, rather than inventing a second timing
// system.
export function tickCaptainMission(
  ticksElapsed: number,
  captain: CaptainState,
  rng: () => number = Math.random
): { captain: CaptainState; homePlanetDelta: Record<LootMaterialKey, number> } {
  if (!captain.mission || ticksElapsed <= 0) {
    return { captain, homePlanetDelta: emptyLootTotals() };
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
        const material = rollLootTable(missionDef.lootTable, rng);
        mission.cargo[material] += missionDef.extractionRatePerTick;
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
          homePlanetDelta[key] += mission.cargo[key];
        });
        // XP is awarded once per cycle completed here (this branch can be
        // reached multiple times within one call's while loop -- e.g. a big
        // offline-catchup ticksElapsed spanning several full cycles), NOT
        // once per tickCaptainMission call. Resolve every level-up crossed by
        // this award, not just one -- a while (not if) loop, same closed-form
        // spirit as the phase-advancement logic above.
        xp += XP_PER_MISSION_CYCLE;
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

  return { captain: { ...captain, mission, xp, level, statPoints }, homePlanetDelta };
}

// Idle captains (mission === null) have no passive economy anymore --
// missions are the only way a captain does anything. Only mission captains
// need advancing; this is the sole reason to even call .map() below rather
// than filtering. gameTimeSeconds and homePlanet.storage are fleet-wide
// bookkeeping, each updated exactly once per call (not once per captain).
export function tick(deltaSeconds: number, state: GameState): GameState {
  if (deltaSeconds <= 0) return state;

  const homePlanetDelta = emptyLootTotals();
  const captains = state.captains.map((captain) => {
    if (captain.mission === null) return captain;
    const ticksElapsed = deltaSeconds / captain.tickDurationSeconds;
    const { captain: updated, homePlanetDelta: delta } = tickCaptainMission(ticksElapsed, captain);
    (Object.keys(delta) as LootMaterialKey[]).forEach((key) => {
      homePlanetDelta[key] += delta[key];
    });
    return updated;
  });

  return {
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
  };
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
  storage[recipe.output.key] += recipe.output.amount;

  return { next: { ...state, homePlanet: { storage } }, success: true };
}

// Same "same state reference on failure" convention as every other buy/action
// function in this file. Validates: talent exists, not already unlocked,
// prerequisite (if any) already unlocked, statPoints sufficient. On success:
// deducts cost, records the unlock. The effect itself isn't APPLIED here --
// each effect type is read wherever that stat matters (extractionYieldMult
// inside tickCaptainMission's extraction math, rareLootChanceMult inside the
// loot roll) by checking unlockedCaptainTalents at read time, same pattern
// this codebase already uses for e.g. specialization multipliers historically.
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
    const nextId = state.captains.length + 1;
    const captains = [
      ...state.captains,
      { id: nextId, label: `Captain ${nextId}`, shipType: "resourcer" as const, ...freshCaptainStack() },
    ];
    return { next: { ...state, captains, adminPoints, unlockedHomeworldTalents }, success: true };
  }

  return { next: { ...state, adminPoints, unlockedHomeworldTalents }, success: true };
}

// Spends the unlocking captain's own statPoints plus a shared Components cost
// to append a new captain slot -- replaces the old Skill Tree Command branch.
// Any captain who has reached the required level can do this (not a dedicated
// "admiral" action) -- see design doc. Fails (same state reference) if there's
// no next slot defined, the captain doesn't exist, isn't at the required
// level, or either cost isn't affordable.
export function unlockCaptainSlot(state: GameState, captainId: number): { next: GameState; success: boolean } {
  const slotIndex = state.captains.length - 1; // captains.length IS the current slot count -- no separate counter needed, since nothing resets the roster anymore
  const unlockDef = CAPTAIN_SLOT_UNLOCKS[slotIndex];
  if (!unlockDef) return { next: state, success: false };

  const idx = state.captains.findIndex((c) => c.id === captainId);
  if (idx === -1) return { next: state, success: false };
  const captain = state.captains[idx];
  if (captain.level < unlockDef.atLevel) return { next: state, success: false };
  if (captain.statPoints < unlockDef.statPointCost) return { next: state, success: false };
  if (state.homePlanet.storage.components < unlockDef.componentsCost) return { next: state, success: false };

  const captains = [...state.captains];
  captains[idx] = { ...captain, statPoints: captain.statPoints - unlockDef.statPointCost };
  const nextId = captains.length + 1;
  captains.push({
    id: nextId,
    label: `Captain ${nextId}`,
    shipType: "resourcer",
    ...freshCaptainStack(),
  });

  return {
    next: {
      ...state,
      captains,
      homePlanet: { storage: { ...state.homePlanet.storage, components: state.homePlanet.storage.components - unlockDef.componentsCost } },
    },
    success: true,
  };
}
