// Complement CP-18 (the soft captain level cap, OC-23): the test-only switch golden files use to prove what the slice
// moved (the cp16Switch.fixture.ts precedent). TEST-ONLY (imported by *.test.ts files only).
//
// The slice moves one thing: what xpForNextLevel charges past the threshold level. With the switch OFF (model.ts
// CAPTAIN_SOFT_CAP_SWITCH.live false, for one call or one file, restored after) every level costs 300 * level, so a
// golden computed inside it is the pre-CP-18 game exactly.

import { afterAll } from "vitest";
import { CAPTAIN_SOFT_CAP_SWITCH } from "./model";

export function withoutCp18<T>(run: () => T): T {
  const was = CAPTAIN_SOFT_CAP_SWITCH.live;
  CAPTAIN_SOFT_CAP_SWITCH.live = false;
  try {
    return run();
  } finally {
    CAPTAIN_SOFT_CAP_SWITCH.live = was;
  }
}

// For a golden FILE captured before CP-18 whose pins hash a captain past the threshold level (every pin in it proves an
// earlier slice's move and nothing else): the whole file runs with the slice off, so its pins keep proving their own
// slice. cp18Goldens.test.ts pins the slice itself. Called once at the file's top level: off AT ONCE (so describe-time
// computations see it too), restored after its last test.
export function cp18OffForThisFile(): void {
  const was = CAPTAIN_SOFT_CAP_SWITCH.live;
  CAPTAIN_SOFT_CAP_SWITCH.live = false;
  afterAll(() => {
    CAPTAIN_SOFT_CAP_SWITCH.live = was;
  });
}
