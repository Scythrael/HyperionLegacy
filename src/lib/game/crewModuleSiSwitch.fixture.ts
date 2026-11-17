// Standard-Issue crew modules (0.14.0, user 2026-11-17 "free basic set, all ships"; design
// docs/superpowers/specs/2026-11-17-research-filter-and-crew-standard-issue-design.md section 2): the test-only switch
// golden files use to prove what the free Sensor Suite, Bridge Module and Crew Quarters moved (the hullCrewCapsSwitch
// precedent). TEST-ONLY (imported by *.test.ts files only).
//
// The set moves one thing: every ship born (freshState, a Shipyard build, a captain-slot hull grant) and every ship a
// v71 save migrates gets the three pieces (model.ts seedCrewModuleStandardIssueForShip). With the switch OFF
// (model.ts CREW_MODULE_STANDARD_ISSUE_SWITCH.live false, for one call or one file, restored after) nothing seeds them,
// so a state built inside it is the game before the set exactly: no Utilitarian berths, no Balanced Command officer
// lift, no Balanced Array scan, no hull-family module lines, and the equipment ids every later mint takes unshifted.

import { afterAll } from "vitest";
import { CREW_MODULE_STANDARD_ISSUE_SWITCH } from "./model";

export function withCrewModuleSiOff<T>(run: () => T): T {
  const was = CREW_MODULE_STANDARD_ISSUE_SWITCH.live;
  CREW_MODULE_STANDARD_ISSUE_SWITCH.live = false;
  try {
    return run();
  } finally {
    CREW_MODULE_STANDARD_ISSUE_SWITCH.live = was;
  }
}

// For a golden FILE captured before the set whose pins are about another slice: the whole file runs with the set off,
// and its pins keep proving that slice moved nothing else. Called once at the file's top level, under a comment naming
// what the set moves there: off AT ONCE (so describe-time computations see it too), restored after its last test.
export function crewModuleSiOffForThisFile(): void {
  const was = CREW_MODULE_STANDARD_ISSUE_SWITCH.live;
  CREW_MODULE_STANDARD_ISSUE_SWITCH.live = false;
  afterAll(() => {
    CREW_MODULE_STANDARD_ISSUE_SWITCH.live = was;
  });
}
