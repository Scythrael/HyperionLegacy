// Complement CP-14 (hull base sensors and Science amplification, OC-16 "Explorers lead", OC-20 "Proposed numbers", OC-21
// "Multiply"): the test-only switch golden files use to prove what the slice moved (the cp13Switch.fixture.ts
// precedent). TEST-ONLY (imported by *.test.ts files only).
//
// The slice moves one thing: a ship's sensors (each hull's base sensors join the Sensor Suite's points, and the Science
// division and Science officer multiply the sum), and a survey or short-range run dispatched now on a ship they move
// carries the hullSensors stamp. With the switch OFF (model.ts HULL_SENSORS_SWITCH.live false, for one call or one file,
// restored after) no hull carries base sensors, no Science lift acts and no run is stamped, so a golden computed inside
// it is the pre-CP-14 game exactly.

import { afterAll } from "vitest";
import { HULL_SENSORS_SWITCH } from "./model";

export function withoutCp14<T>(run: () => T): T {
  const was = HULL_SENSORS_SWITCH.live;
  HULL_SENSORS_SWITCH.live = false;
  try {
    return run();
  } finally {
    HULL_SENSORS_SWITCH.live = was;
  }
}

// For a golden FILE captured before CP-14 whose pins read a ship's sensors on a hull that now carries base sensors, or
// with Science people aboard (every pin in it proves an earlier slice's move and nothing else): the whole file runs
// with the slice off, so its pins keep proving their own slice. cp14Goldens.test.ts pins the slice itself. Called once
// at the file's top level: off AT ONCE (so describe-time computations see it too), restored after its last test.
export function cp14OffForThisFile(): void {
  const was = HULL_SENSORS_SWITCH.live;
  HULL_SENSORS_SWITCH.live = false;
  afterAll(() => {
    HULL_SENSORS_SWITCH.live = was;
  });
}
