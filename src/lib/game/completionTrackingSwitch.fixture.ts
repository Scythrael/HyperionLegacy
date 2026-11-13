// Completion tracking (0.14.0, user answers 2026-11-13): the test-only switch golden files use to prove what the slice
// moved (the withRepairRulesOff precedent). TEST-ONLY (imported by *.test.ts files only).
//
// The slice moves two things in the engine: a claim writes the system's record (GameState.systemRecords) and, at 100%,
// the ledger's "system completed" event (GameState.notableEvents); an abandon writes the Resume system's record, marked
// abandoned. With the switch OFF (model.ts COMPLETION_TRACKING_SWITCH.live false, for one call or one file, restored
// after) neither is written, so every state made inside it is the game before the slice exactly. The ledger's "relic
// set completed" event is the Relics v2 content slice's (tick.ts writes it always, at the merge of 424f5089): the switch
// leaves it.

import { afterAll } from "vitest";
import { COMPLETION_ROLL_SWITCH, COMPLETION_TRACKING_SWITCH } from "./model";

export function withCompletionTrackingOff<T>(run: () => T): T {
  const was = COMPLETION_TRACKING_SWITCH.live;
  COMPLETION_TRACKING_SWITCH.live = false;
  try {
    return run();
  } finally {
    COMPLETION_TRACKING_SWITCH.live = was;
  }
}

// For a golden FILE captured before the slice whose pins are about another slice: the whole file runs with completion
// tracking off, and its pins keep proving that slice moved nothing else. Called once at the file's top level.
export function completionTrackingOffForThisFile(): void {
  const was = COMPLETION_TRACKING_SWITCH.live;
  COMPLETION_TRACKING_SWITCH.live = false;
  afterAll(() => {
    COMPLETION_TRACKING_SWITCH.live = was;
  });
}

// The planet 100% bonus relic roll (user 2026-11-13 "Planet roll + system badge"): OFF (model.ts COMPLETION_ROLL_SWITCH),
// a claim and an abandon pay no planet roll (no completion blank to the vault, no SystemRecord.bodiesRolled) and write
// everything else as before, so every state made inside it is the completion tracking slice before the roll exactly.
export function withCompletionRollOff<T>(run: () => T): T {
  const was = COMPLETION_ROLL_SWITCH.live;
  COMPLETION_ROLL_SWITCH.live = false;
  try {
    return run();
  } finally {
    COMPLETION_ROLL_SWITCH.live = was;
  }
}

// For a golden FILE about the completion tracking slice before the roll (completionTrackingGoldens.test.ts): the whole
// file runs with the planet roll off, so its pins keep proving the records and the ledger alone (the roll's own pins:
// completionRollGoldens.test.ts). Called once at the file's top level.
export function completionRollOffForThisFile(): void {
  const was = COMPLETION_ROLL_SWITCH.live;
  COMPLETION_ROLL_SWITCH.live = false;
  afterAll(() => {
    COMPLETION_ROLL_SWITCH.live = was;
  });
}
