// FR-C lane 1 I3 (user 2026-11-15, "Wire it in 0.14.0"): the test-only switch golden files use to prove what wiring the
// lane join moved (the refugeeFarewellSwitch.fixture.ts and cp19Switch.fixture.ts pattern). TEST-ONLY (imported by
// *.test.ts files only).
//
// The fix moves one thing: startLine opens a CraftOrder for every BATCH line, so a free lane can join it (and the order's
// run is logged once, when it is swept). With the switch OFF (LANE_JOIN_SWITCH.live false, restored after) startLine
// opens no order, the game before the fix exactly, so a golden computed inside it is the pre-fix value. The borrowed-lane
// rules and the order sweep stay in force either way: without an order they do nothing (proven by every pre-fix golden
// passing with the switch off).
//
// Traced pins (laneJoinWired.test.ts "the move, traced"): materialLinesGoldens refine / fabricate / inspect,
// materialQualityGoldens refineMixed / fabMixed / inFlight / queued, materialLinesMl2 in-flight safety, the craft-lines
// and craftQueue line shapes.

import { afterAll } from "vitest";
import { LANE_JOIN_SWITCH } from "./tick";

function off(): () => void {
  const was = LANE_JOIN_SWITCH.live;
  LANE_JOIN_SWITCH.live = false;
  return () => {
    LANE_JOIN_SWITCH.live = was;
  };
}

export function withLaneJoinOff<T>(run: () => T): T {
  const restore = off();
  try {
    return run();
  } finally {
    restore();
  }
}

// For a golden FILE captured before the lane join was wired: the whole file runs with it off, so its pins keep proving
// their own slice. Called once at the file's top level: off AT ONCE, restored after its last test.
export function laneJoinOffForThisFile(): void {
  const restore = off();
  afterAll(restore);
}
