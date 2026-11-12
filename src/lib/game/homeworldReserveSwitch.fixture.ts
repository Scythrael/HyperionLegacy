// HOMEWORLD RESERVE slice (homeworldReserve.ts; user 2026-11-12): the test-only switch golden files use to prove what the
// slice moved (the orderingSwitch.fixture.ts precedent). TEST-ONLY (imported by *.test.ts files only).
//
// With the switch OFF (HOMEWORLD_RESERVE_SWITCH.live false, for one call or one file, restored after) resolveCrew never
// sweeps the surplus into the reserve and never draws from it, and a roster's bulk fill never draws from it: the game
// before the reserve exactly.

import { afterAll } from "vitest";
import { HOMEWORLD_RESERVE_SWITCH } from "./homeworldReserve";

export function withHomeworldReserveOff<T>(run: () => T): T {
  const was = HOMEWORLD_RESERVE_SWITCH.live;
  HOMEWORLD_RESERVE_SWITCH.live = false;
  try {
    return run();
  } finally {
    HOMEWORLD_RESERVE_SWITCH.live = was;
  }
}

// For a golden FILE captured before the reserve whose pins hash a fleet with every berth of some division and rank full
// across a transport window (each such pin proves an earlier slice and nothing else): the whole file runs with the reserve
// off, so its pins keep proving their own slice. homeworldReserveGoldens.test.ts pins the reserve itself. Called once at
// the file's top level: off AT ONCE (so describe-time computations see it too), restored after its last test.
export function homeworldReserveOffForThisFile(): void {
  const was = HOMEWORLD_RESERVE_SWITCH.live;
  HOMEWORLD_RESERVE_SWITCH.live = false;
  afterAll(() => {
    HOMEWORLD_RESERVE_SWITCH.live = was;
  });
}
