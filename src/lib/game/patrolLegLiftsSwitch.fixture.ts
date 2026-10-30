// OC-D8 FOLLOW-UP (user 2026-10-30 "Yes, each its own leg"; the review finding on the Constitution run clock): the
// test-only switches golden files use to prove what the follow-up moved (the patrolLegsSwitch.fixture.ts precedent).
// TEST-ONLY (imported by *.test.ts files only).
//
// The follow-up moves two things, each behind its own switch in model.ts:
//   PATROL_LEG_LIFTS_SWITCH : a patrol cycle freezes each leg at its own speed (Fast Departure's lift on the outbound
//                             leg, Fast Return's on the leg home). OFF: the legs freeze at the sweeping speed alone.
//   PATROL_RUN_CLOCK_SWITCH : a run's Constitution clock sums the route ticks each cycle flew, a cut cycle's less
//                             its return cut (cutFlown, user 2026-10-30 "Count only flown"). OFF: routes x the current
//                             cycle's route length, no routeTicksThisRun is stored and no cycle is stamped.
// With a switch off (for one call, restored after) a golden computed inside it is the pre-change game for
// that half.

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

export const withPatrolLegLiftsOff = <T>(run: () => T): T => withOff(PATROL_LEG_LIFTS_SWITCH, run);
export const withPatrolRunClockOff = <T>(run: () => T): T => withOff(PATROL_RUN_CLOCK_SWITCH, run);

