// Tick loop — tech spec §2 (Tick Loop and Time Semantics).
//
// tick() MUST be closed-form: calling it once with delta=3600 must produce
// the same result as calling it 36000 times with delta=0.1. This is what
// makes offline progression, speed multipliers, and the debug offline
// simulator all correct by construction rather than by luck.
//
// Test this assumption in game.test.ts before adding anything that breaks
// it (capacity caps, consumption chains, anything stateful mid-tick).

import { MODULES, globalMultiplier, freshState, type GameState } from "./model";

export function tick(deltaSeconds: number, state: GameState): GameState {
  if (deltaSeconds <= 0) return state;

  const mult = globalMultiplier(state);
  const resources = { ...state.resources };

  for (const key of Object.keys(MODULES) as (keyof typeof MODULES)[]) {
    const m = MODULES[key];
    const count = state.modules[key];
    if (count > 0) {
      resources[m.resource] += m.baseRate * count * mult * deltaSeconds;
    }
  }

  const producedComponents = Math.max(0, resources.components - state.resources.components);

  return {
    ...state,
    resources,
    lifetimeComponents: state.lifetimeComponents + producedComponents,
    gameTimeSeconds: state.gameTimeSeconds + deltaSeconds,
  };
}

export function prestige(state: GameState): { next: GameState; gained: number } {
  const gained = Math.floor(Math.sqrt(state.lifetimeComponents));
  if (gained <= 0) return { next: state, gained: 0 };

  const next: GameState = {
    ...freshState(),
    lifetimeComponents: state.lifetimeComponents,
    augmentPoints: state.augmentPoints + gained,
    prestigeCount: state.prestigeCount + 1,
    gameTimeSeconds: state.gameTimeSeconds,
    tickDurationSeconds: state.tickDurationSeconds,
  };
  return { next, gained };
}
