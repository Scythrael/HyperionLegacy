// OC-D8 FOLLOW-UP (user 2026-10-30 "Yes, each its own leg"; the review finding on the Constitution run clock): the
// test-only switches golden files use to prove what the follow-up moved (the patrolLegsSwitch.fixture.ts precedent).
// TEST-ONLY (imported by *.test.ts files only).
//
// The follow-up moves two things, each behind its own switch in model.ts:
//   PATROL_LEG_LIFTS_SWITCH : a patrol cycle freezes each leg at its own speed (Fast Departure's lift on the outbound
//                             leg, Fast Return's on the leg home). OFF: the legs freeze at the sweeping speed alone.
//   PATROL_RUN_CLOCK_SWITCH : a run's Constitution clock sums the route ticks each cycle flew. OFF: routes x the
//                             current cycle's route length, and no routeTicksThisRun is stored.
// With a switch off (for one call or one file, restored after) a golden computed inside it is the pre-change game for
// that half.

import { afterAll } from "vitest";
import { PATROL_LEG_LIFTS_SWITCH, PATROL_RUN_CLOCK_SWITCH } from "./model";

type Switch = { live: boolean };

function withOff<T>(sw: Switch, run: () => T): T {
  const was = sw.live;
  sw.live = false;
  try {
    return run();
  } finally {
    sw.live = was;
  }
}

function offForThisFile(sw: Switch): void {
  const was = sw.live;
  sw.live = false;
  afterAll(() => {
    sw.live = was;
  });
}

export const withPatrolLegLiftsOff = <T>(run: () => T): T => withOff(PATROL_LEG_LIFTS_SWITCH, run);
export const withPatrolRunClockOff = <T>(run: () => T): T => withOff(PATROL_RUN_CLOCK_SWITCH, run);

// For a golden FILE captured before the follow-up whose pins are about another slice: the whole file runs with the
// lifts off. Called once at the file's top level: off AT ONCE (so describe-time computations see it too), restored
// after its last test.
export function patrolLegLiftsOffForThisFile(): void {
  offForThisFile(PATROL_LEG_LIFTS_SWITCH);
}
export function patrolRunClockOffForThisFile(): void {
  offForThisFile(PATROL_RUN_CLOCK_SWITCH);
}
