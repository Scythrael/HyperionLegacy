// E-MOD EM-4 (plan docs/plans/2026-10-17-material-lines-and-emod-plan.md section 4 EM-4): the test-only switch golden
// files use to prove what the reactor surplus drive lift moved. TEST-ONLY (imported by *.test.ts files only).
//
// EM-4 moves one thing: a ship whose crafted Reactor Core has unused power flies faster (reactorSurplus.ts), on its sheet
// and so on every leg, voyage and combat speed that reads it, and a run dispatched now on such a ship carries the lift
// flag. With the switch OFF (reactorSurplus.ts REACTOR_LIFT_SWITCH.live false, for one call or one file, restored
// after) no sheet carries the lift and no run is stamped, so a golden computed inside it is the pre-EM-4 game exactly.

import { afterAll, beforeAll } from "vitest";
import { REACTOR_LIFT_SWITCH } from "./reactorSurplus";

export function withReactorLiftOff<T>(run: () => T): T {
  const was = REACTOR_LIFT_SWITCH.live;
  REACTOR_LIFT_SWITCH.live = false;
  try {
    return run();
  } finally {
    REACTOR_LIFT_SWITCH.live = was;
  }
}

// For a golden FILE captured before EM-4 whose pins fly a crafted Reactor Core (every pin in it proves an earlier
// slice's move and nothing else): the whole file runs with the lift off (vitest isolates each test file's modules), and
// its pins keep proving EM-4 moved nothing else there. emodEm4Goldens.test.ts pins the lift itself.
export function reactorLiftOffForThisFile(): void {
  let was = true;
  beforeAll(() => {
    was = REACTOR_LIFT_SWITCH.live;
    REACTOR_LIFT_SWITCH.live = false;
  });
  afterAll(() => {
    REACTOR_LIFT_SWITCH.live = was;
  });
}
