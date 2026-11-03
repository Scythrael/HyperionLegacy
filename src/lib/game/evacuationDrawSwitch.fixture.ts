// E5-2 (Refugee Posts, docs/plans/2026-11-02-refugee-posts-e5-plan.md Task E5-2 Step 4): the test-only switch golden
// files use to prove what the Evacuation template moved (the crewHoursSwitch.fixture.ts pattern). TEST-ONLY (imported
// by *.test.ts files only).
//
// E5-2 moves one thing: a slot's cycle at or after its v71 evacuation stamp (or any cycle of a slot with no stamp: a
// new save) draws with the Evacuation overlay (shortRange.ts shortRangeDrawVersion 2), so 1 roll in 8 becomes an
// Evacuation and every other roll is the version 1 roll unchanged. With the switch OFF (EVACUATION_DRAW_SWITCH.live
// false, for one call or one file, restored after) every cycle draws version 1, the game before E5-2 exactly, so a
// golden computed inside it is the pre-E5-2 value. refugeeArrival.test.ts and refugeeGoldens.test.ts trace the moves.

import { afterAll } from "vitest";
import { EVACUATION_DRAW_SWITCH } from "./shortRange";

export function withEvacuationDrawOff<T>(run: () => T): T {
  const was = EVACUATION_DRAW_SWITCH.live;
  EVACUATION_DRAW_SWITCH.live = false;
  try {
    return run();
  } finally {
    EVACUATION_DRAW_SWITCH.live = was;
  }
}

// For a golden FILE captured before E5-2 whose pins are about another slice: the whole file draws version 1, and its
// pins keep proving that slice moved nothing else. Called once at the file's top level: off AT ONCE (so describe-time
// computations see it too), restored after its last test.
export function evacuationDrawOffForThisFile(): void {
  const was = EVACUATION_DRAW_SWITCH.live;
  EVACUATION_DRAW_SWITCH.live = false;
  afterAll(() => {
    EVACUATION_DRAW_SWITCH.live = was;
  });
}
