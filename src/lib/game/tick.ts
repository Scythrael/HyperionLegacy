// Tick loop — tech spec §2 (Tick Loop and Time Semantics), extended for
// Phase 1 of the captain/ship feature (docs/plans/2026-07-03-captain-ship-design.md).
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
  RESEARCH_PROJECTS,
  type GameState,
  type CaptainState,
  type SpecializationKey,
} from "./model";

export function tickCaptainStack(deltaSeconds: number, captain: CaptainState, fleetMult: number): CaptainState {
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

  // Research progress — same shape as before Phase 1, just scoped to this
  // captain's own `research` instead of a fleet-wide one. See the original
  // comment in the pre-Phase-1 tick.ts (preserved in git history) for the
  // full rationale on why `completed` is a one-way terminal flag.
  const research = { ...captain.research };
  for (const key of Object.keys(RESEARCH_PROJECTS) as (keyof typeof RESEARCH_PROJECTS)[]) {
    const project = research[key];
    if (project.started && !project.completed) {
      const duration = RESEARCH_PROJECTS[key].durationSeconds;
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
  const captains = state.captains.map((captain) => tickCaptainStack(deltaSeconds, captain, fleetMult));

  return {
    ...state,
    captains,
    gameTimeSeconds: state.gameTimeSeconds + deltaSeconds,
  };
}

// Per-captain prestige ("Tier 1, captain scope"). Gate mirrors the original
// single-stack prestige()'s exact formula, scoped to one captain's own
// lifetimeComponents. Resets that captain to the shared freshCaptainStack()
// baseline, keeps id/label/shipType, adds the gain to captainPoints, and
// assigns (or re-assigns) the chosen specialization -- respeccing a captain
// is just prestiging them again with a different pick. Other captains in the
// array are untouched.
export function captainPrestige(
  state: GameState,
  captainId: number,
  chosenSpec: SpecializationKey
): { next: GameState; gained: number } {
  const idx = state.captains.findIndex((c) => c.id === captainId);
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
// lifetimeComponents across every captain -- deliberately the bigger,
// slower-to-reach reset. On success: grants fleet-wide augmentPoints (same
// formula as before Phase 1) and collapses the ENTIRE captains array back to
// the starting 2-captain shape (freshCaptains()) -- wiping every captain's
// specialization, captainPoints, individual prestige count, and stack
// progress along with it. gameTimeSeconds still carries forward unchanged.
export function prestige(state: GameState): { next: GameState; gained: number } {
  const totalLifetimeComponents = state.captains.reduce((sum, c) => sum + c.lifetimeComponents, 0);
  const gained = Math.floor(Math.sqrt(totalLifetimeComponents));
  if (gained <= 0) return { next: state, gained: 0 };

  const next: GameState = {
    captains: freshCaptains(),
    augmentPoints: state.augmentPoints + gained,
    prestigeCount: state.prestigeCount + 1,
    gameTimeSeconds: state.gameTimeSeconds,
  };
  return { next, gained };
}
