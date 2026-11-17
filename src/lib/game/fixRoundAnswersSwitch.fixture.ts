// Fix round answers (0.14.0, docs/qa/2026-11-13-fable-sweep-ledger.md, USER ANSWERS 2026-11-17): the test-only
// switches golden files use to prove what each answer moved (the fixRoundESwitch.fixture.ts pattern). TEST-ONLY
// (imported by *.test.ts files only).
//
//   secondaryFindPause (tick.ts SECONDARY_FIND_PAUSE_SWITCH)  Q12: a mission's secondary find of an item at its cap
//                                                             does not land; off, it lands as before.
//   pauseOvertimeRemaining (processSpeed.ts PAUSE_OVERTIME_REMAINING_SWITCH)  Q6: a repair pause's Overtime is priced by
//                                                             the repair the pause has left; off, by the docked job.
//   helperCancelReleases (tick.ts HELPER_CANCEL_RELEASES_SWITCH)  Q7: Cancel on a helper (joined) lane releases just that
//                                                             lane; off, Cancel on any lane stops the whole order.
// OFF (for one call, or one file), each answer is undone exactly, so every state made inside it is the code before it.

import { afterAll } from "vitest";
import { HELPER_CANCEL_RELEASES_SWITCH, SECONDARY_FIND_PAUSE_SWITCH } from "./tick";
import { PAUSE_OVERTIME_REMAINING_SWITCH } from "./processSpeed";

type Switch = { live: boolean };

function withOff<T>(switches: readonly Switch[], run: () => T): T {
  const was = switches.map((s) => s.live);
  for (const s of switches) s.live = false;
  try {
    return run();
  } finally {
    switches.forEach((s, i) => (s.live = was[i]));
  }
}

const BY_NAME = {
  secondaryFindPause: SECONDARY_FIND_PAUSE_SWITCH,
  pauseOvertimeRemaining: PAUSE_OVERTIME_REMAINING_SWITCH,
  helperCancelReleases: HELPER_CANCEL_RELEASES_SWITCH,
} as const satisfies Record<string, Switch>;
export type FixRoundAnswer = keyof typeof BY_NAME;

// For one call: the named answers off, restored after.
export const withAnswersOff = <T>(fixes: readonly FixRoundAnswer[], run: () => T): T => withOff(fixes.map((f) => BY_NAME[f]), run);

// For a golden FILE captured before these answers: the named ones (only those that move its pins) off for the whole
// file, restored after it. Called once at the file's top level, under a comment naming what each one moves.
export function fixRoundAnswersOffForThisFile(...fixes: readonly FixRoundAnswer[]): void {
  const switches = fixes.map((f) => BY_NAME[f]);
  const was = switches.map((s) => s.live);
  for (const s of switches) s.live = false;
  afterAll(() => {
    switches.forEach((s, i) => (s.live = was[i]));
  });
}
