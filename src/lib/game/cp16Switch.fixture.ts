// Complement CP-16 (the final-retirement warning and the Hall of Command, OC-22; the CP-16 notables answer of
// 2026-11-06): the test-only switch golden files use to prove what the slice moved (the cp14Switch.fixture.ts
// precedent). TEST-ONLY (imported by *.test.ts files only).
//
// The slice moves three records and nothing else: CaptainState.missionsFlown and CaptainState.commandNotables (written
// by economyTick, an expedition's dispatch and claim, and a short-range dispatch) and GameState.hallOfCommand (appended
// by retireCaptain). With the switch OFF (captainNotables.ts HALL_OF_COMMAND_SWITCH.live false, for one call or one
// file, restored after) none of the three is written, so a golden computed inside it is the pre-CP-16 game exactly.

import { afterAll } from "vitest";
import { HALL_OF_COMMAND_SWITCH } from "./captainNotables";
import type { GameState } from "./model";

export function withoutCp16<T>(run: () => T): T {
  const was = HALL_OF_COMMAND_SWITCH.live;
  HALL_OF_COMMAND_SWITCH.live = false;
  try {
    return run();
  } finally {
    HALL_OF_COMMAND_SWITCH.live = was;
  }
}

// For a golden FILE captured before CP-16 whose pins hash a captain that flies a mission, patrol or short-range run, an
// expedition dispatch or claim, or a retirement (every pin in it proves an earlier slice's move and nothing else): the
// whole file runs with the slice off, so its pins keep proving their own slice. cp16Goldens.test.ts pins the slice
// itself. Called once at the file's top level: off AT ONCE (so describe-time computations see it too), restored after
// its last test.
export function cp16OffForThisFile(): void {
  const was = HALL_OF_COMMAND_SWITCH.live;
  HALL_OF_COMMAND_SWITCH.live = false;
  afterAll(() => {
    HALL_OF_COMMAND_SWITCH.live = was;
  });
}

// A state without the three CP-16 records (a no-op on a state without them): the pre-CP-16 bytes of a state the slice
// wrote to, since the records sit last on each captain (captainNotables.ts withCommandKeysLast) and hallOfCommand is
// appended last. Pure: shallow copies.
export function asPreCp16(s: GameState): GameState {
  const { hallOfCommand: _hall, ...rest } = s;
  return {
    ...(rest as GameState),
    captains: s.captains.map((c) => {
      if (c.missionsFlown === undefined && c.commandNotables === undefined) return c;
      const { missionsFlown: _m, commandNotables: _n, ...career } = c;
      return career;
    }),
  };
}
