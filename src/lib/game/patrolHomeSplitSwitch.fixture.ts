// Lane 4 M8 (0.14.0, docs/qa/2026-11-13-fable-sweep-ledger.md lane 4 M8 and M4): the test-only switches golden files use
// to prove what the fix moved (the fixRoundESwitch.fixture.ts precedent). TEST-ONLY (imported by *.test.ts files only).
//
//   PATROL_HOME_SPLIT_SWITCH (tick.ts) "homeSplit": a patrol run that ends inside an economyTick call longer than one
//     tick splits the call at the whole tick the ship comes home, so the passive crew fill, the Shipyard repair
//     auto-start, the docked gear repair job and the crew hours happen there (as 1 s steps do), not at the call's end;
//   CREW_WINDOW_FILL_SWITCH (crewOverlay.ts) "windowFill": a call longer than one tick that spans two or more transport
//     windows delivers and fills window by window (as 1 s steps do), not from the whole backlog at once.
// Both act only on a call longer than one tick: production steps one tick per call, so no player sees either.
// OFF (for one call, or one file), each is undone exactly, so every state made inside it is the code before it.
//
// A golden file captured before the fix switches off, for the whole file, ONLY the switches that move its pins
// (lane4M8SwitchesOffForThisFile), each named in the file's own comment with what it moves. A file neither moves
// switches nothing.

import { afterAll } from "vitest";
import { PATROL_HOME_SPLIT_SWITCH } from "./tick";
import { CREW_WINDOW_FILL_SWITCH } from "./crewOverlay";

type Switch = { live: boolean };

const BY_NAME = {
  homeSplit: PATROL_HOME_SPLIT_SWITCH,
  windowFill: CREW_WINDOW_FILL_SWITCH,
} as const satisfies Record<string, Switch>;
export type Lane4M8Fix = keyof typeof BY_NAME;

function withOff<T>(switches: readonly Switch[], run: () => T): T {
  const was = switches.map((s) => s.live);
  for (const s of switches) s.live = false;
  try {
    return run();
  } finally {
    switches.forEach((s, i) => (s.live = was[i]));
  }
}

export const withPatrolHomeSplitOff = <T>(run: () => T): T => withOff([PATROL_HOME_SPLIT_SWITCH], run);
export const withCrewWindowFillOff = <T>(run: () => T): T => withOff([CREW_WINDOW_FILL_SWITCH], run);
// The whole fix off at once.
export const withLane4M8Off = <T>(run: () => T): T => withOff([PATROL_HOME_SPLIT_SWITCH, CREW_WINDOW_FILL_SWITCH], run);

// For a golden or fixture FILE captured before the fix: the named switches (only those that move its pins) off for the
// whole file, restored after it. Called once at the file's top level, under a comment naming what each one moves.
export function lane4M8SwitchesOffForThisFile(...fixes: readonly Lane4M8Fix[]): void {
  const switches = fixes.map((f) => BY_NAME[f]);
  const was = switches.map((s) => s.live);
  for (const s of switches) s.live = false;
  afterAll(() => {
    switches.forEach((s, i) => (s.live = was[i]));
  });
}
