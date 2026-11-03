// E5-4 (Refugee Posts, docs/plans/2026-11-02-refugee-posts-e5-plan.md Task E5-4): the test-only switch golden files use
// to prove what the facility buffs moved (the evacuationDrawSwitch.fixture.ts pattern). TEST-ONLY (imported by *.test.ts
// files only).
//
// E5-4 moves one thing: a facility with a refugee posted reads a buff b > 0 (refugeeBuffs.ts refugeeFacilityBonus), which
// eight consumer seams fold in. With the switch OFF (REFUGEE_BUFFS_SWITCH.live false, for one call, restored after) every
// b reads 0, so every seam takes its pre-E5-4 path: a golden computed inside it is the pre-E5-4 value.

import { REFUGEE_BUFFS_SWITCH } from "./refugeeBuffs";

export function withRefugeeBuffsOff<T>(run: () => T): T {
  const was = REFUGEE_BUFFS_SWITCH.live;
  REFUGEE_BUFFS_SWITCH.live = false;
  try {
    return run();
  } finally {
    REFUGEE_BUFFS_SWITCH.live = was;
  }
}
