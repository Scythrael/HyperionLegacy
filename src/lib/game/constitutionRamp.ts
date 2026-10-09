// E-CREW 0.14.0 (Task 21): the CONSTITUTION long-haul ramp, a pure LEAF (imports only the shared D23 curve) so
// model.ts (effectiveMissionDef's return leg) can read it without importing the officer engine.
// officerStats.ts re-exports both names; see its header for the facet rules.

import { diminishing } from "./diminishing";

// The ramp's knee in hours (D23: a knee, never a cap; the plan's first-pass "capped 5 hours").
export const CONSTITUTION_RAMP_KNEE_HOURS = 5;

// The fleet tick length the mission-def ramps assume when they turn phase ticks into hours (the fleet runs a
// 1 second tick, freshState tickDurationSeconds 1). Patrols read the live state value instead.
export const RAMP_SECONDS_PER_TICK = 1;

// The long-haul ramp share for a Constitution facet `facet` after `hoursOut` hours: facet *
// diminishing(hoursOut, knee). Exactly 0 when either is 0, so a run with no Constitution is unchanged. Pure.
export function constitutionRamp(facet: number, hoursOut: number): number {
  if (!(facet > 0) || !(hoursOut > 0)) return 0;
  return facet * diminishing(hoursOut, CONSTITUTION_RAMP_KNEE_HOURS);
}
