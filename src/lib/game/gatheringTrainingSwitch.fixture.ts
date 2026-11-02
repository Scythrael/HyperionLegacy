// Safe first runs SF-7 (user OC-W9 "No wear on training"; the safe first runs include "the first gathering run"): the
// test-only switch golden files use to prove what the first gathering run's wear rule moved (the hullCrewCapsSwitch /
// wr9Switch precedent). TEST-ONLY (imported by *.test.ts files only).
//
// SF-7 moves one thing: a captain mission dispatched as the save's first gathering run is stamped `training`
// (gearWearEngine.ts gatheringTrainingStamp), and its first delivered cycle records no use wear. With the switch OFF
// (GATHERING_TRAINING_WEAR_SWITCH.live false, for one call or one file, restored after) no dispatch is marked, so a
// golden computed inside it is the pre-SF-7 game exactly. The mark is written at dispatch only: a run dispatched inside
// the switch flies on unmarked after it.

import { afterAll } from "vitest";
import { GATHERING_TRAINING_WEAR_SWITCH } from "./gearWearEngine";

export function withGatheringTrainingOff<T>(run: () => T): T {
  const was = GATHERING_TRAINING_WEAR_SWITCH.live;
  GATHERING_TRAINING_WEAR_SWITCH.live = false;
  try {
    return run();
  } finally {
    GATHERING_TRAINING_WEAR_SWITCH.live = was;
  }
}

// For a golden FILE captured before SF-7 whose pins are about another slice: the whole file dispatches as before SF-7.
// Called once at the file's top level: off AT ONCE (so describe-time computations see it too), restored after its last
// test.
export function gatheringTrainingOffForThisFile(): void {
  const was = GATHERING_TRAINING_WEAR_SWITCH.live;
  GATHERING_TRAINING_WEAR_SWITCH.live = false;
  afterAll(() => {
    GATHERING_TRAINING_WEAR_SWITCH.live = was;
  });
}
