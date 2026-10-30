// WR-7 follow-up OC-D5 favorsSpec ("+10% on its ship type", user 2026-10-29): the test-only switch golden files use to
// prove what the favored-spec bonus moved (the EM-4 reactorLiftOff / gear wear battleWearOff precedent). TEST-ONLY
// (imported by *.test.ts files only).
//
// The bonus moves one thing: a piece whose variety favors the hull's spec counts every line +10% there (model.ts
// withFavoredLines), on the sheet, the Damage Control and Pathfinder readers, and a run dispatched now carries the
// favoredSpec stamp. With the switch OFF (model.ts FAVORED_SPEC_SWITCH.live false, for one call or one file, restored
// after) no piece is favored and no run is stamped, so a golden computed inside it is the pre-bonus game exactly.

import { afterAll } from "vitest";
import { FAVORED_SPEC_SWITCH } from "./model";

export function withFavoredSpecOff<T>(run: () => T): T {
  const was = FAVORED_SPEC_SWITCH.live;
  FAVORED_SPEC_SWITCH.live = false;
  try {
    return run();
  } finally {
    FAVORED_SPEC_SWITCH.live = was;
  }
}

// For a golden FILE captured before the bonus whose pins install a favored piece on a hull of its spec (every pin in
// it proves an earlier slice's move and nothing else): the whole file runs with the bonus off, and its pins keep proving
// the bonus moved nothing else there. favorsSpecGoldens.test.ts pins the bonus itself. Called once at the file's top
// level: off AT ONCE (so describe-time computations see it too), restored after its last test.
export function favoredSpecOffForThisFile(): void {
  const was = FAVORED_SPEC_SWITCH.live;
  FAVORED_SPEC_SWITCH.live = false;
  afterAll(() => {
    FAVORED_SPEC_SWITCH.live = was;
  });
}
