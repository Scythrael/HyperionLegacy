// FR-C lane 1 M5 / M6 and lane 3 M2 (user 2026-11-13/14, "Never discard (Recommended)"): the test-only switch golden
// files use to prove what the change moved (the laneJoinSwitch.fixture.ts pattern). TEST-ONLY (imported by *.test.ts
// files only).
//
// The change moves two things: addToInventory lands every deposit in full (no clamp at the cap, no drain of an over-cap
// stack), and a load trims nothing (save.ts migrate). With the switch OFF (tick.ts NEVER_DISCARD_SWITCH.live false,
// restored after) both come back exactly as before, so a golden computed inside it is the pre-change value.

import { afterAll } from "vitest";
import { NEVER_DISCARD_SWITCH } from "./tick";

function off(): () => void {
  const was = NEVER_DISCARD_SWITCH.live;
  NEVER_DISCARD_SWITCH.live = false;
  return () => {
    NEVER_DISCARD_SWITCH.live = was;
  };
}

export function withNeverDiscardOff<T>(run: () => T): T {
  const restore = off();
  try {
    return run();
  } finally {
    restore();
  }
}

// For a golden FILE (or a test file pinning the old clamp) captured before the change: the whole file runs with it off,
// so its pins keep proving their own slice. Called once at the file's top level: off AT ONCE, restored after its last
// test.
export function neverDiscardOffForThisFile(): void {
  const restore = off();
  afterAll(restore);
}
