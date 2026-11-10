// GEAR WEAR step 5 (docs/plans/2026-10-16-gear-wear-design.md section 11 step 5; the SF-7 note): the "turn it off"
// switch the golden tests use to prove what PATROL USE WEAR moved (the battleWearSwitch / gatheringTrainingSwitch
// precedent). TEST-ONLY (imported by *.test.ts files only).
//
// Step 5 moves a patrol in exactly one way: a patrol dispatched while it is live is stamped
// (PatrolMissionState.useWear, gearWearEngine.ts patrolUseWearStamp), and each of its non-training cycles records a
// USE event where it ends (the reactor, the crew modules and the universal modules by the minutes flown, the drive by
// the round trip). With the switch OFF (PATROL_USE_WEAR_SWITCH.live false, for one call or one file, restored after)
// no patrol is stamped, so a run dispatched inside it is the pre-step-5 run exactly. The stamp is written at dispatch
// only: a run dispatched inside the switch flies on unstamped after it.

import { afterAll } from "vitest";
import { PATROL_USE_WEAR_SWITCH } from "./gearWearEngine";

export function withPatrolUseWearOff<T>(run: () => T): T {
  const was = PATROL_USE_WEAR_SWITCH.live;
  PATROL_USE_WEAR_SWITCH.live = false;
  try {
    return run();
  } finally {
    PATROL_USE_WEAR_SWITCH.live = was;
  }
}

// For a golden FILE captured before step 5 whose pins are about another slice: the whole file dispatches as before.
// Called once at the file's top level: off AT ONCE (so describe-time computations see it too), restored after its last
// test.
export function patrolUseWearOffForThisFile(): void {
  const was = PATROL_USE_WEAR_SWITCH.live;
  PATROL_USE_WEAR_SWITCH.live = false;
  afterAll(() => {
    PATROL_USE_WEAR_SWITCH.live = was;
  });
}
