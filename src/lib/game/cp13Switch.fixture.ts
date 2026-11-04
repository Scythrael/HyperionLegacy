// Complement CP-13 (hull-family module bonuses, OC-13 "One catalog, by hull"): the test-only switch golden files use to
// prove what the bonus moved (the favoredSpecSwitch.fixture.ts precedent). TEST-ONLY (imported by *.test.ts files only).
//
// The bonus moves one thing: a bridge or quarters module gives its hull family's lines (crewModules.ts
// HULL_FAMILY_MODULE_BONUS) on the hull it is installed on, and a run dispatched now carries the hullBonus stamp. With
// the switch OFF (crewModules.ts HULL_FAMILY_SWITCH.live false, for one call or one file, restored after) no module
// gives a hull bonus and no run is stamped, so a golden computed inside it is the pre-CP-13 game exactly.

import { afterAll } from "vitest";
import { HULL_FAMILY_SWITCH } from "./crewModules";

export function withoutCp13<T>(run: () => T): T {
  const was = HULL_FAMILY_SWITCH.live;
  HULL_FAMILY_SWITCH.live = false;
  try {
    return run();
  } finally {
    HULL_FAMILY_SWITCH.live = was;
  }
}

// For a golden FILE captured before CP-13 whose pins install a bridge or quarters module (every pin in it proves an
// earlier slice's move and nothing else): the whole file runs with the bonus off, so its pins keep proving their own
// slice. cp13Goldens.test.ts pins the bonus itself. Called once at the file's top level: off AT ONCE (so describe-time
// computations see it too), restored after its last test.
export function cp13OffForThisFile(): void {
  const was = HULL_FAMILY_SWITCH.live;
  HULL_FAMILY_SWITCH.live = false;
  afterAll(() => {
    HULL_FAMILY_SWITCH.live = was;
  });
}
