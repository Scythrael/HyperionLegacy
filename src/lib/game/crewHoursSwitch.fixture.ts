// The crewHours determinism fix (2026-10-30, hub call "one call == chunked == 1 s steps"): the test-only switch golden
// files use to prove what the fix moved (the patrolLegsSwitch.fixture.ts precedent). TEST-ONLY (imported by *.test.ts
// files only).
//
// The fix moves one thing: an officer's crewHours accrues as a whole-millisecond counter (SeniorStaffOfficer.crewHoursMs)
// instead of a float promotionCounters.crewHours summed per call. With the switch OFF (model.ts
// CREW_HOURS_MS_SWITCH.live false, for one call or one file, restored after) the float accrues as before, so a golden
// computed inside it is the pre-fix game exactly. crewHoursMs.test.ts traces the move: with the switch on, every
// state differs only in that counter, the float's value rounded to whole milliseconds.

import { afterAll } from "vitest";
import { CREW_HOURS_MS_SWITCH } from "./model";

export function withCrewHoursFloat<T>(run: () => T): T {
  const was = CREW_HOURS_MS_SWITCH.live;
  CREW_HOURS_MS_SWITCH.live = false;
  try {
    return run();
  } finally {
    CREW_HOURS_MS_SWITCH.live = was;
  }
}

// For a golden FILE captured before the fix whose pins are about another slice: the whole file runs with the float
// counter, and its pins keep proving that slice moved nothing else. Called once at the file's top level: off AT ONCE
// (so describe-time computations see it too), restored after its last test.
export function crewHoursFloatForThisFile(): void {
  const was = CREW_HOURS_MS_SWITCH.live;
  CREW_HOURS_MS_SWITCH.live = false;
  afterAll(() => {
    CREW_HOURS_MS_SWITCH.live = was;
  });
}
