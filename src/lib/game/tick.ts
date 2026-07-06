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
  RESEARCH_PROJECTS,
  SKILL_TREE,
  type GameState,
  type CaptainState,
  type SpecializationKey,
  type ResearchKey,
  type SkillNodeKey,
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

export function tick(deltaSeconds: number, state: GameState): GameState {
  if (deltaSeconds <= 0) return state;

  const fleetMult = globalMultiplier(state);
  const researchDurationMults = {} as Record<ResearchKey, number>;
  for (const key of Object.keys(RESEARCH_PROJECTS) as ResearchKey[]) {
    researchDurationMults[key] = researchDurationMult(state, key);
  }

  const captains = state.captains.map((captain) =>
    tickCaptainStack(deltaSeconds, captain, fleetMult, researchDurationMults)
  );

  return {
    ...state,
    captains,
    gameTimeSeconds: state.gameTimeSeconds + deltaSeconds,
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
