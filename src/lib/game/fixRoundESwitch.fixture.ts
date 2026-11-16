// Fix round FR-E (0.14.0, docs/qa/2026-11-13-fable-sweep-ledger.md lanes 3 and 4, USER ANSWERS 2026-11-13/14): the
// test-only switches golden files use to prove what the round moved (the withCompletionRollOff precedent). TEST-ONLY
// (imported by *.test.ts files only).
//
// Expeditions (model.ts):
//   RECALL_NO_REPAY_SWITCH            lane 3 I1 + M1: a recall keeps the cut-short body's rolled scan boundaries and a
//                                     charted anomaly, so the next launch to the system pays neither again;
//   RECALL_KEEPS_LIST_SWITCH          lane 3 I3: a recall that sends its system back to the candidates restores the list
//                                     the launch drew (no free reroll);
//   STAR_BODIES_SWITCH                lane 3 I2: a real star's bodies are drawn from the star, the same every visit;
//   PLANET_ROLL_REAL_OBJECTIVE_SWITCH lane 3 q3: a planet's 100% roll needs one objective really finished there.
// Patrols (tick.ts):
//   PATROL_RESUME_WHEN_SAFE_SWITCH    lane 4 I1: a Repeat repair pause ends once the next route no longer breaks gear;
//   PATROL_REPEAT_CLIMB_SWITCH        lane 4 I2: a Repeat run climbs the patrol curve every PATROL_CLIMB_EVERY_ROUTES;
//   PATROL_STOP_DOOMED_SWITCH         lane 4 q3: Repeat never flies a route it would lose even fully repaired;
//   PAUSE_JOB_LIKE_DOCKED_SWITCH      lane 4 M6: a pause's Overtime is priced by the docked job's length.
// OFF (for one call, or one file), each fix is undone exactly, so every state made inside it is the code before it.

import { afterAll } from "vitest";
import { PLANET_ROLL_REAL_OBJECTIVE_SWITCH, RECALL_KEEPS_LIST_SWITCH, RECALL_NO_REPAY_SWITCH, STAR_BODIES_SWITCH } from "./model";

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

function offForThisFile(switches: readonly Switch[]): void {
  const was = switches.map((s) => s.live);
  for (const s of switches) s.live = false;
  afterAll(() => {
    switches.forEach((s, i) => (s.live = was[i]));
  });
}

export const FIX_ROUND_E_EXPEDITION_SWITCHES: readonly Switch[] = [RECALL_NO_REPAY_SWITCH, RECALL_KEEPS_LIST_SWITCH, STAR_BODIES_SWITCH, PLANET_ROLL_REAL_OBJECTIVE_SWITCH];

export const withRecallNoRepayOff = <T>(run: () => T): T => withOff([RECALL_NO_REPAY_SWITCH], run);
export const withRecallKeepsListOff = <T>(run: () => T): T => withOff([RECALL_KEEPS_LIST_SWITCH], run);
export const withStarBodiesOff = <T>(run: () => T): T => withOff([STAR_BODIES_SWITCH], run);
export const withPlanetRollRealObjectiveOff = <T>(run: () => T): T => withOff([PLANET_ROLL_REAL_OBJECTIVE_SWITCH], run);
// Every expedition fix of the round off at once.
export const withFixRoundEExpeditionsOff = <T>(run: () => T): T => withOff(FIX_ROUND_E_EXPEDITION_SWITCHES, run);

// For a golden or fixture FILE captured before the round whose pins are about another slice (its fixtures happen to
// launch a real star, recall and resume, or finish a planet by skips): the whole file runs with the round's expedition
// fixes off, and its pins keep proving that slice moved nothing else. The round's own pins: expeditionFixRoundEGoldens
// .test.ts. Called once at the file's top level.
export function fixRoundEExpeditionsOffForThisFile(): void {
  offForThisFile(FIX_ROUND_E_EXPEDITION_SWITCHES);
}

export { withOff as withSwitchesOff, offForThisFile as switchesOffForThisFile };
