// E5-6b (echo refugees): the test-only switch golden files use to prove what the echoes moved (the
// refugeeFarewellSwitch.fixture.ts pattern). TEST-ONLY (imported by *.test.ts files only).
//
// E5-6b moves one thing: an arrival whose echo draw falls under REFUGEE_ECHO_CHANCE, with an echo still to come, is
// that echo (their roster name and background, plus the `echo` key on the record and in RefugeeState.echoes). With the
// switch OFF (REFUGEE_ECHO_SWITCH.live false, for one call, restored after) every arrival is a normal refugee, the game
// before E5-6b exactly, so a golden computed inside it is the pre-E5-6b value.

import { REFUGEE_ECHO_SWITCH } from "./refugeeEchoes";

export function withEchoRefugeesOff<T>(run: () => T): T {
  const was = REFUGEE_ECHO_SWITCH.live;
  REFUGEE_ECHO_SWITCH.live = false;
  try {
    return run();
  } finally {
    REFUGEE_ECHO_SWITCH.live = was;
  }
}
