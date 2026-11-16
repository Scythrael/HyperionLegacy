// Fix round FR-E (0.14.0, docs/qa/2026-11-13-fable-sweep-ledger.md lanes 3 and 4, USER ANSWERS 2026-11-13/14): the
// test-only switches golden files use to prove what the round moved (the withCompletionRollOff precedent). TEST-ONLY
// (imported by *.test.ts files only).
//
// Expeditions (model.ts):
//   RECALL_NO_REPAY_SWITCH            lane 3 I1 + M1: a recall keeps the cut-short body's rolled scan boundaries and a
//                                     charted anomaly, so the next launch to the system pays neither again;
//   RECALL_KEEPS_LIST_SWITCH          lane 3 I3: a recall that sends its system back to the candidates restores the list
//                                     the launch drew (no free reroll), with the held candidates that launch rolled off;
//   STAR_BODIES_SWITCH                lane 3 I2: a real star's bodies are drawn from the star, the same every visit;
//   PLANET_ROLL_REAL_OBJECTIVE_SWITCH lane 3 q3: a planet's 100% roll needs one objective really finished there.
// Patrols (tick.ts, runDifficulty.ts):
//   PATROL_RESUME_WHEN_SAFE_SWITCH    lane 4 I1: a Repeat repair pause ends once the next route no longer breaks gear;
//   PATROL_REPEAT_CLIMB_SWITCH        lane 4 I2: a Repeat run climbs the patrol curve every PATROL_CLIMB_EVERY_ROUTES;
//   PATROL_STOP_DOOMED_SWITCH         lane 4 q3: Repeat never flies a route it would lose even fully repaired;
//   PAUSE_JOB_LIKE_DOCKED_SWITCH      lane 4 M6: a pause's Overtime is priced by the docked job's length.
// OFF (for one call, or one file), each fix is undone exactly, so every state made inside it is the code before it.
//
// A golden file captured before the round switches off, for the whole file, ONLY the fixes that move it
// (fixRoundESwitchesOffForThisFile), each named in the file's own comment with what it moves; every other fix of the
// round runs there. A file no fix moves switches nothing.

import { afterAll } from "vitest";
import { PLANET_ROLL_REAL_OBJECTIVE_SWITCH, RECALL_KEEPS_LIST_SWITCH, RECALL_NO_REPAY_SWITCH, STAR_BODIES_SWITCH } from "./model";
import { PATROL_RESUME_WHEN_SAFE_SWITCH, PATROL_STOP_DOOMED_SWITCH, PAUSE_JOB_LIKE_DOCKED_SWITCH } from "./tick";
import { PATROL_REPEAT_CLIMB_SWITCH } from "./runDifficulty";

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

export const FIX_ROUND_E_EXPEDITION_SWITCHES: readonly Switch[] = [RECALL_NO_REPAY_SWITCH, RECALL_KEEPS_LIST_SWITCH, STAR_BODIES_SWITCH, PLANET_ROLL_REAL_OBJECTIVE_SWITCH];

export const withRecallNoRepayOff = <T>(run: () => T): T => withOff([RECALL_NO_REPAY_SWITCH], run);
export const withRecallKeepsListOff = <T>(run: () => T): T => withOff([RECALL_KEEPS_LIST_SWITCH], run);
export const withStarBodiesOff = <T>(run: () => T): T => withOff([STAR_BODIES_SWITCH], run);
export const withPlanetRollRealObjectiveOff = <T>(run: () => T): T => withOff([PLANET_ROLL_REAL_OBJECTIVE_SWITCH], run);
// Every expedition fix of the round off at once.
export const withFixRoundEExpeditionsOff = <T>(run: () => T): T => withOff(FIX_ROUND_E_EXPEDITION_SWITCHES, run);

export const FIX_ROUND_E_PATROL_SWITCHES: readonly Switch[] = [PATROL_RESUME_WHEN_SAFE_SWITCH, PATROL_REPEAT_CLIMB_SWITCH, PATROL_STOP_DOOMED_SWITCH, PAUSE_JOB_LIKE_DOCKED_SWITCH];

export const withResumeWhenSafeOff = <T>(run: () => T): T => withOff([PATROL_RESUME_WHEN_SAFE_SWITCH], run);
export const withRepeatClimbOff = <T>(run: () => T): T => withOff([PATROL_REPEAT_CLIMB_SWITCH], run);
export const withStopDoomedOff = <T>(run: () => T): T => withOff([PATROL_STOP_DOOMED_SWITCH], run);
export const withPauseJobLikeDockedOff = <T>(run: () => T): T => withOff([PAUSE_JOB_LIKE_DOCKED_SWITCH], run);
// Every patrol fix of the round off at once.
export const withFixRoundEPatrolsOff = <T>(run: () => T): T => withOff(FIX_ROUND_E_PATROL_SWITCHES, run);

// Every fix of the round off at once.
export const withFixRoundEOff = <T>(run: () => T): T => withOff([...FIX_ROUND_E_EXPEDITION_SWITCHES, ...FIX_ROUND_E_PATROL_SWITCHES], run);

// The round's fixes by name, for a file's narrow switch.
const BY_NAME = {
  recallNoRepay: RECALL_NO_REPAY_SWITCH,
  recallKeepsList: RECALL_KEEPS_LIST_SWITCH,
  starBodies: STAR_BODIES_SWITCH,
  planetRollRealObjective: PLANET_ROLL_REAL_OBJECTIVE_SWITCH,
  resumeWhenSafe: PATROL_RESUME_WHEN_SAFE_SWITCH,
  repeatClimb: PATROL_REPEAT_CLIMB_SWITCH,
  stopDoomed: PATROL_STOP_DOOMED_SWITCH,
  pauseJobLikeDocked: PAUSE_JOB_LIKE_DOCKED_SWITCH,
} as const satisfies Record<string, Switch>;
export type FixRoundEFix = keyof typeof BY_NAME;

// For a golden or fixture FILE captured before the round: the named fixes (only those that move its pins) off for the
// whole file, restored after it. Called once at the file's top level, under a comment naming what each one moves.
export function fixRoundESwitchesOffForThisFile(...fixes: readonly FixRoundEFix[]): void {
  const switches = fixes.map((f) => BY_NAME[f]);
  const was = switches.map((s) => s.live);
  for (const s of switches) s.live = false;
  afterAll(() => {
    switches.forEach((s, i) => (s.live = was[i]));
  });
}
