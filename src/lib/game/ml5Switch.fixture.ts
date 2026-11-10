// Material Lines ML-5 (quality blanks): the test-only switch golden files use to prove what the slice moved (the
// cp19Switch.fixture.ts precedent). TEST-ONLY (imported by *.test.ts files only).
//
// The slice moves two things: a fabricate job that deposits a blank stamps the quality it carried (ML-4's tally), so
// the blank lands in that quality's bucket and an inspect of it starts from that quality; and the blank store's shape
// (a Decimal[] per blueprint), which goldenJson (firstRunsGoldens.fixture.ts) writes back as the old flat count for a
// Q0-only blank. With the switch OFF (qualityBlanks.ts QUALITY_BLANKS_SWITCH.live false, for one call or one file,
// restored after) no job stamps a blank, every blank lands at Q0 and every inspect carries nothing, so a golden
// computed inside it is the pre-ML-5 game exactly.
//
// Traced rows (ml5Goldens.test.ts, "with the slice switched off"): blankBest, blankLowest (both moved by design), and
// blankQ0, grant, load (held).

import { afterAll } from "vitest";
import { QUALITY_BLANKS_SWITCH } from "./qualityBlanks";

function off(): () => void {
  const was = QUALITY_BLANKS_SWITCH.live;
  QUALITY_BLANKS_SWITCH.live = false;
  return () => {
    QUALITY_BLANKS_SWITCH.live = was;
  };
}

export function withoutMl5<T>(run: () => T): T {
  const restore = off();
  try {
    return run();
  } finally {
    restore();
  }
}

// For a golden FILE captured before ML-5 whose pins run a fabricate job on stock above Q0 into a blank (every pin in
// it proves an earlier slice's move and nothing else): the whole file runs with the slice off. Called once at the
// file's top level: off AT ONCE (so describe-time computations see it too), restored after its last test.
export function ml5OffForThisFile(): void {
  const restore = off();
  afterAll(restore);
}
