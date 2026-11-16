// FR-C R2-5 and R8-6: the test-only switch golden files use to prove what this round's two read-side folds moved (the
// laneJoinSwitch.fixture.ts pattern). TEST-ONLY (imported by *.test.ts files only).
//
// The folds: lifetimeStats.fleetAdminXpAwarded gains the Fleet Admiral XP finite work grants (R2-5), and an auto-salvage
// completed-events entry carries `auto: true` (R8-6, for the While You Were Away recap). With the switch OFF (tick.ts
// RECAP_FOLDS_SWITCH.live false, restored after) neither happens, so a golden computed inside it is the pre-fix value.

import { afterAll } from "vitest";
import { RECAP_FOLDS_SWITCH } from "./tick";

function off(): () => void {
  const was = RECAP_FOLDS_SWITCH.live;
  RECAP_FOLDS_SWITCH.live = false;
  return () => {
    RECAP_FOLDS_SWITCH.live = was;
  };
}

export function withRecapFoldsOff<T>(run: () => T): T {
  const restore = off();
  try {
    return run();
  } finally {
    restore();
  }
}

// For a golden FILE captured before the folds: the whole file runs with them off. Called once at the file's top level.
export function recapFoldsOffForThisFile(): void {
  const restore = off();
  afterAll(restore);
}
