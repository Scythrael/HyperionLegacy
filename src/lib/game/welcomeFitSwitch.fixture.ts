// FR-C A1-2 (QA 2026-11-14): the test-only switch golden files use to prove what the fitted welcome batch moved (the
// laneJoinSwitch.fixture.ts pattern). TEST-ONLY (imported by *.test.ts files only).
//
// The fix moves one thing: a save that takes the welcome batch receives one crewmember per open seat (division and rank)
// instead of the most recent ordinary transports. With the switch OFF (transports.ts WELCOME_FIT_SWITCH.live false,
// restored after) the welcome is the transport-count batch exactly as before, so a golden computed inside it is the
// pre-fix value.

import { afterAll } from "vitest";
import { WELCOME_FIT_SWITCH } from "./transports";

function off(): () => void {
  const was = WELCOME_FIT_SWITCH.live;
  WELCOME_FIT_SWITCH.live = false;
  return () => {
    WELCOME_FIT_SWITCH.live = was;
  };
}

export function withWelcomeFitOff<T>(run: () => T): T {
  const restore = off();
  try {
    return run();
  } finally {
    restore();
  }
}

// For a golden FILE captured before the fix: the whole file runs with it off. Called once at the file's top level.
export function welcomeFitOffForThisFile(): void {
  const restore = off();
  afterAll(restore);
}
