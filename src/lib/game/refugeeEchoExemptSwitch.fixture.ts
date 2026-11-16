// FR-C crew lane I2 (user 2026-11-13/14, "Exempt echoes (Recommended)"): the test-only switch golden files use to prove
// what the exemption moved (the refugeeFarewellSwitch.fixture.ts pattern). TEST-ONLY (imported by *.test.ts files only).
//
// The fix moves one thing: a Refugee Relocation never takes a waiting echo along (refugeeArrival.ts refugeeFarewellPick).
// With the switch OFF (REFUGEE_ECHO_EXEMPT_SWITCH.live false, restored after) an echo may leave like anyone waiting, the
// game before the fix exactly, so a golden computed inside it is the pre-fix value.

import { afterAll } from "vitest";
import { REFUGEE_ECHO_EXEMPT_SWITCH } from "./refugeeArrival";

function off(): () => void {
  const was = REFUGEE_ECHO_EXEMPT_SWITCH.live;
  REFUGEE_ECHO_EXEMPT_SWITCH.live = false;
  return () => {
    REFUGEE_ECHO_EXEMPT_SWITCH.live = was;
  };
}

export function withEchoExemptOff<T>(run: () => T): T {
  const restore = off();
  try {
    return run();
  } finally {
    restore();
  }
}

// For a golden FILE captured before the fix: the whole file runs with it off. Called once at the file's top level.
export function echoExemptOffForThisFile(): void {
  const restore = off();
  afterAll(restore);
}
