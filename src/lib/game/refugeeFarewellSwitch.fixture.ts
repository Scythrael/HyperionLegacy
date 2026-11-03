// E5-3 (Refugee Posts, docs/plans/2026-11-02-refugee-posts-e5-plan.md Task E5-3): the test-only switch golden files use
// to prove what the Relocation farewell moved (the evacuationDrawSwitch.fixture.ts pattern). TEST-ONLY (imported by
// *.test.ts files only).
//
// E5-3 moves one thing: a delivered Refugee Relocation with anyone waiting takes the longest-waiting refugee along
// (refugeeArrival.ts applyRefugeeDeliveries) and logs a farewell. With the switch OFF (REFUGEE_FAREWELL_SWITCH.live
// false, for one call, restored after) a Relocation takes nobody, the game before E5-3 exactly, so a golden computed
// inside it is the pre-E5-3 value.

import { REFUGEE_FAREWELL_SWITCH } from "./refugeeArrival";

export function withRefugeeFarewellOff<T>(run: () => T): T {
  const was = REFUGEE_FAREWELL_SWITCH.live;
  REFUGEE_FAREWELL_SWITCH.live = false;
  try {
    return run();
  } finally {
    REFUGEE_FAREWELL_SWITCH.live = was;
  }
}
