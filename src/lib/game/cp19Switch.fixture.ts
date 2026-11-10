// Complement CP-19 (the Personnel Rosters upgrade track, OC-17): the test-only switch golden files use to prove what the
// slice moved (the cp18Switch.fixture.ts precedent). TEST-ONLY (imported by *.test.ts files only).
//
// The slice moves three things: FACILITIES gains the `personnelRosters` track, a save's facility map gains it at its
// pre-granted Level 1 (freshState, the v70 -> v71 step and every load), and the candidate boards add the track's slots.
// With the switch OFF (model.ts PERSONNEL_ROSTERS_TRACK_SWITCH.live false and the FACILITIES entry taken out, for one
// call or one file, restored after) none of it happens, so a golden computed inside it is the pre-CP-19 game exactly
// (the wiringGoldens.test.ts precedent swaps FACILITIES entries the same way). The registry rows the track adds are
// built once at load, so cp19Registry.fixture.ts takes them out instead.
//
// Traced rows (cp19Goldens.test.ts, "with the slice switched off"): every row of cp19Rows.

import { afterAll } from "vitest";
import { FACILITIES, PERSONNEL_ROSTERS_FACILITY_KEY, PERSONNEL_ROSTERS_TRACK_SWITCH } from "./model";

const TRACK = FACILITIES[PERSONNEL_ROSTERS_FACILITY_KEY];

function off(): () => void {
  const was = PERSONNEL_ROSTERS_TRACK_SWITCH.live;
  const had = PERSONNEL_ROSTERS_FACILITY_KEY in FACILITIES;
  PERSONNEL_ROSTERS_TRACK_SWITCH.live = false;
  delete FACILITIES[PERSONNEL_ROSTERS_FACILITY_KEY];
  return () => {
    PERSONNEL_ROSTERS_TRACK_SWITCH.live = was;
    if (had) FACILITIES[PERSONNEL_ROSTERS_FACILITY_KEY] = TRACK;
  };
}

export function withoutCp19<T>(run: () => T): T {
  const restore = off();
  try {
    return run();
  } finally {
    restore();
  }
}

// For a golden FILE captured before CP-19 whose pins hash a new game's or a loaded save's facility map, or walk
// FACILITIES (every pin in it proves an earlier slice's move and nothing else): the whole file runs with the slice off,
// so its pins keep proving their own slice. cp19Goldens.test.ts pins the slice itself. Called once at the file's top
// level: off AT ONCE (so describe-time computations see it too), restored after its last test.
export function cp19OffForThisFile(): void {
  const restore = off();
  afterAll(restore);
}
