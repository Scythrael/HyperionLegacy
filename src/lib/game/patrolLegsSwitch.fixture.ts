// WR-7 follow-up OC-D8 patrol legs ("patrol legs scale with transitSpeedMult", user 2026-10-15): the test-only switch
// golden files use to prove what the legs moved (the EM-4 reactorLiftOff / OC-D5 favoredSpecOff precedent). TEST-ONLY
// (imported by *.test.ts files only).
//
// The change moves one thing: a patrol cycle freezes its two transit legs at the ship's transit speed when it starts
// (model.ts patrolLegTicksFor), and its phases, waves, end, limp home and Constitution clock follow that route. With the
// switch OFF (model.ts PATROL_LEGS_SWITCH.live false, for one call or one file, restored after) no cycle freezes legs,
// so every patrol flies its route's legs and a golden computed inside it is the pre-change game exactly.

import { afterAll } from "vitest";
import { PATROL_LEGS_SWITCH } from "./model";

export function withPatrolLegsOff<T>(run: () => T): T {
  const was = PATROL_LEGS_SWITCH.live;
  PATROL_LEGS_SWITCH.live = false;
  try {
    return run();
  } finally {
    PATROL_LEGS_SWITCH.live = was;
  }
}

// For a golden FILE captured before the legs scaled whose pins are about another slice: the whole file runs with the
// legs off, and its pins keep proving that slice moved nothing else. Called once at the file's top level: off AT ONCE
// (so describe-time computations see it too), restored after its last test.
export function patrolLegsOffForThisFile(): void {
  const was = PATROL_LEGS_SWITCH.live;
  PATROL_LEGS_SWITCH.live = false;
  afterAll(() => {
    PATROL_LEGS_SWITCH.live = was;
  });
}
