// Tick loop — tech spec §2 (Tick Loop and Time Semantics), extended for
// Phase 1 (per-captain stacks) and Phase 2 (skill tree) of the captain/ship
// feature. See docs/plans/2026-07-06-skill-tree-design.md for Phase 2.
//
// tickCaptainStack() MUST be closed-form per captain: calling it once with a
// large delta must produce the same result as calling it many times with a
// small delta, for THAT captain's stack. tick() loops this over every
// captain in the roster and additionally advances the fleet-wide
// gameTimeSeconds once per call (not once per captain -- gameTimeSeconds is
// fleet bookkeeping, not tied to any single captain's production).
//
// Test this assumption in tick.test.ts before adding anything that breaks it
// (capacity caps, consumption chains, anything stateful mid-tick).

import {
  MODULES,
  globalMultiplier,
  captainMultiplier,
  specializationMultiplier,
  freshCaptains,
  freshCaptainStack,
  fleetLifetimeComponents,
  captainSlotCount,
  researchDurationMult,
  requiredTicksForPhase,
  rollLootTable,
  MISSIONS,
  RESEARCH_PROJECTS,
  SKILL_TREE,
  type GameState,
  type CaptainState,
  type SpecializationKey,
  type ResearchKey,
  type SkillNodeKey,
  type CaptainMissionState,
  type LootMaterialKey,
  type MissionPhase,
  type MissionKey,
} from "./model";

export function tickCaptainStack(
  deltaSeconds: number,
  captain: CaptainState,
  fleetMult: number,
  researchDurationMults: Record<ResearchKey, number>
): CaptainState {
  if (deltaSeconds <= 0) return captain;

  const capMult = captainMultiplier(captain);
  const resources = { ...captain.resources };

  for (const key of Object.keys(MODULES) as (keyof typeof MODULES)[]) {
    const m = MODULES[key];
    const count = captain.modules[key];
    if (count > 0) {
      const specMult = specializationMultiplier(captain, m.resource);
      resources[m.resource] += m.baseRate * count * fleetMult * capMult * specMult * deltaSeconds;
    }
  }

  // Research progress -- duration is now scaled by researchDurationMults[key]
  // (1 if no skill-tree node targets this project), computed once fleet-wide
  // by tick() below and passed in here, same "compute once, apply everywhere"
  // pattern as fleetMult.
  const research = { ...captain.research };
  for (const key of Object.keys(RESEARCH_PROJECTS) as (keyof typeof RESEARCH_PROJECTS)[]) {
    const project = research[key];
    if (project.started && !project.completed) {
      const duration = RESEARCH_PROJECTS[key].durationSeconds * (researchDurationMults[key] ?? 1);
      const newProgress = Math.min(project.progressSeconds + deltaSeconds, duration);
      research[key] = { ...project, progressSeconds: newProgress, completed: newProgress >= duration };
    }
  }

  const producedComponents = Math.max(0, resources.components - captain.resources.components);

  return {
    ...captain,
    resources,
    research,
    lifetimeComponents: captain.lifetimeComponents + producedComponents,
  };
}

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

// The mission-progress analog of tickCaptainStack: MUST be closed-form,
// exactly like tickCaptainStack, but generalized from "one continuous
// quantity clamped at one threshold" to "a sequence of 5 phase thresholds
// that wraps back to the start on completion, unless recalled." One call
// with a large ticksElapsed must resolve EVERY phase transition, extraction
// loot roll, and auto-repeat cycle that ticksElapsed represents -- not just
// the first one -- which is what the while loop below does.
//
// `ticksElapsed` is NOT deltaSeconds -- it's the caller's job (tick(), in
// this same file) to convert deltaSeconds into ticksElapsed by dividing by
// the captain's own tickDurationSeconds, same cadence used for that
// captain's normal production. This keeps mission progress on the same
// per-captain cadence as everything else, rather than inventing a second
// timing system.
//
// This function is built and tested IN ISOLATION as of this commit -- it is
// NOT yet called from tick()/tickCaptainStack() or anywhere else in the app.
// Wiring it into the actual game loop is a separate, later task.
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

  return { captain: { ...captain, mission }, homePlanetDelta };
}

export function tick(deltaSeconds: number, state: GameState): GameState {
  if (deltaSeconds <= 0) return state;

  const fleetMult = globalMultiplier(state);
  const researchDurationMults = {} as Record<ResearchKey, number>;
  for (const key of Object.keys(RESEARCH_PROJECTS) as ResearchKey[]) {
    researchDurationMults[key] = researchDurationMult(state, key);
  }

  // Captains on a mission are mutually exclusive with their normal Generator
  // Stack/research economy this tick (design doc, Phase 3a) -- they skip
  // tickCaptainStack entirely and instead advance tickCaptainMission, which
  // uses its OWN discrete tick-count cadence (ticksElapsed), not continuous
  // deltaSeconds. Converting deltaSeconds -> ticksElapsed via THIS captain's
  // own tickDurationSeconds keeps mission progress on the same per-captain
  // cadence convention tickCaptainStack already relies on (see file header).
  // Loot delivered home (homePlanetDelta) this tick is summed across every
  // captain on a mission and applied to state.homePlanet.storage once below,
  // same "accumulate locally, apply once" shape as gameTimeSeconds.
  const homePlanetDelta = emptyLootTotals();
  const captains = state.captains.map((captain) => {
    if (captain.mission !== null) {
      const ticksElapsed = deltaSeconds / captain.tickDurationSeconds;
      const { captain: updatedCaptain, homePlanetDelta: delta } = tickCaptainMission(ticksElapsed, captain);
      (Object.keys(delta) as LootMaterialKey[]).forEach((key) => {
        homePlanetDelta[key] += delta[key];
      });
      return updatedCaptain;
    }
    return tickCaptainStack(deltaSeconds, captain, fleetMult, researchDurationMults);
  });

  return {
    ...state,
    captains,
    gameTimeSeconds: state.gameTimeSeconds + deltaSeconds,
    // Field-by-field (not Object.keys().forEach like homePlanetDelta's own
    // accumulation above) for readability -- must stay in sync with
    // LootMaterialKey if a 4th tier is ever added.
    homePlanet: {
      storage: {
        commonOre: state.homePlanet.storage.commonOre + homePlanetDelta.commonOre,
        uncommonMaterial: state.homePlanet.storage.uncommonMaterial + homePlanetDelta.uncommonMaterial,
        rareMaterial: state.homePlanet.storage.rareMaterial + homePlanetDelta.rareMaterial,
      },
    },
  };
}

// Per-captain prestige ("Tier 1, captain scope") -- UNCHANGED by Phase 2.
export function captainPrestige(
  state: GameState,
  captainId: number,
  chosenSpec: SpecializationKey
): { next: GameState; gained: number } {
  const idx = state.captains.findIndex((c) => c.id === captainId);
  if (idx === -1) return { next: state, gained: 0 };
  const captain = state.captains[idx];
  const gained = Math.floor(Math.sqrt(captain.lifetimeComponents));
  if (gained <= 0) return { next: state, gained: 0 };

  const resetCaptain: CaptainState = {
    ...captain,
    ...freshCaptainStack(),
    captainPoints: captain.captainPoints + gained,
    captainPrestigeCount: captain.captainPrestigeCount + 1,
    specialization: chosenSpec,
  };

  const captains = [...state.captains];
  captains[idx] = resetCaptain;

  return { next: { ...state, captains }, gained };
}

// Fleet-wide prestige ("Tier 2, admiral scope"). Gate is the SUM of
// lifetimeComponents across every captain. On success: grants fleet-wide
// augmentPoints (unchanged formula) AND +1 skillPoints (Phase 2 -- Skill
// Points are earned per Fleet Prestige only, not Captain Prestige), and
// rebuilds the ENTIRE captains array at captainSlotCount(state) captains
// (Phase 2 fix -- previously always exactly 2, regardless of how many slots
// had actually been unlocked; see KNOWN_ISSUES.md). skillPoints and
// unlockedSkillNodes are fleet-wide persistent progression, same tier as
// augmentPoints -- neither is reset here, only earned/spent elsewhere.
// `unlockedSkillNodes: state.unlockedSkillNodes` reuses the same array
// reference rather than cloning it -- safe because buySkillNode (the only
// writer) always replaces it via `[...state.unlockedSkillNodes, nodeKey]`,
// never mutates in place, so no caller can ever observe this reused
// reference change out from under it.
export function prestige(state: GameState): { next: GameState; gained: number } {
  const gained = Math.floor(Math.sqrt(fleetLifetimeComponents(state)));
  if (gained <= 0) return { next: state, gained: 0 };

  const next: GameState = {
    captains: freshCaptains(captainSlotCount(state)),
    augmentPoints: state.augmentPoints + gained,
    prestigeCount: state.prestigeCount + 1,
    gameTimeSeconds: state.gameTimeSeconds,
    skillPoints: state.skillPoints + 1,
    unlockedSkillNodes: state.unlockedSkillNodes,
    homePlanet: state.homePlanet, // never reset by Fleet Prestige, same as skillPoints/unlockedSkillNodes
  };
  return { next, gained };
}

// Buys one skill tree node. Validates (in order): node isn't already
// unlocked, its prerequisite (if any) IS already unlocked, and enough
// skillPoints are on hand -- returns { next: state, success: false } (the
// SAME state reference, unchanged) if any check fails, mirroring this
// codebase's established buy-action shape (buyModule/startResearch in
// App.svelte). On success: deducts cost, records the node as unlocked, and
// -- ONLY for an "unlockCaptainSlot" effect -- appends exactly one new
// captain (via the shared freshCaptainStack() baseline, never a repeat of
// the Captain-2 softlock) at the next sequential id.
export function buySkillNode(state: GameState, nodeKey: SkillNodeKey): { next: GameState; success: boolean } {
  const node = SKILL_TREE[nodeKey];
  if (state.unlockedSkillNodes.includes(nodeKey)) return { next: state, success: false };
  if (node.requires && !state.unlockedSkillNodes.includes(node.requires)) return { next: state, success: false };
  if (state.skillPoints < node.costSkillPoints) return { next: state, success: false };

  // `captains.length + 1` for the new id relies on `captains.length` staying
  // in lockstep with `captainSlotCount(state)` -- true today because the
  // only two mutators of either value (this function and prestige(),
  // via freshCaptains(captainSlotCount(state))) always keep them in sync by
  // construction, but nothing enforces this invariant at compile- or
  // run-time. A future change that lets them diverge (e.g. a node that
  // REMOVES a slot) would silently produce a duplicate or skipped id here.
  let captains = state.captains;
  if (node.effect.type === "unlockCaptainSlot") {
    const nextId = captains.length + 1;
    captains = [
      ...captains,
      {
        id: nextId,
        label: `Captain ${nextId}`,
        shipType: "resourcer",
        ...freshCaptainStack(),
        captainPoints: 0,
        captainPrestigeCount: 0,
        specialization: null,
      },
    ];
  }

  return {
    next: {
      ...state,
      captains,
      skillPoints: state.skillPoints - node.costSkillPoints,
      unlockedSkillNodes: [...state.unlockedSkillNodes, nodeKey],
    },
    success: true,
  };
}

// Dispatches an idle captain (mission === null) on a mission. Finds the
// captain by id (not array index -- ids and indices can diverge once
// captains are ever removed/reordered, though nothing does that today;
// mirrors captainPrestige's/buySkillNode's existing id-lookup convention).
// Fails (same state reference, unchanged) if no captain has that id, or if
// they already have an active mission -- mirrors captainPrestige's
// not-found guard and buySkillNode's already-unlocked guard. On success,
// seeds a brand-new CaptainMissionState at the very start of the cycle
// (phase "ordersReceived", zero progress, empty cargo, not recalled).
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
