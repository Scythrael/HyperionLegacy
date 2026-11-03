// The short-range slow-start parity fix (shortRangeCycle.ts tickShortRangeFleet; docs/plans/2026-11-02-refugee-posts-
// e5-plan.md, the E5-3 carry note): the test-only switch golden files use to prove what the fix moved (the
// refugeeFarewellSwitch.fixture.ts pattern). TEST-ONLY (imported by *.test.ts files only).
//
// The fix moves one thing: an economyTick call LONGER than one tick with two or more short-range runs advances them
// together, so each cycle start reads the counters 1 s steps would have left. With the switch OFF
// (SHORT_RANGE_FLEET_SWITCH.live false, for one call, restored after) each run takes the whole call one captain at a
// time, the game before the fix exactly, so a golden computed inside it is the pre-fix value.

import { SHORT_RANGE_FLEET_SWITCH } from "./shortRangeCycle";

export function withShortRangeFleetOff<T>(run: () => T): T {
  const was = SHORT_RANGE_FLEET_SWITCH.live;
  SHORT_RANGE_FLEET_SWITCH.live = false;
  try {
    return run();
  } finally {
    SHORT_RANGE_FLEET_SWITCH.live = was;
  }
}
