// Completion tracking (0.14.0, user answers 2026-11-13): the test-only switch golden files use to prove what the slice
// moved (the withRepairRulesOff precedent). TEST-ONLY (imported by *.test.ts files only).
//
// The slice moves three things in the engine: a claim writes the system's record (GameState.systemRecords) and, at 100%,
// the hidden ledger's "system completed" event (GameState.notableEvents); an abandon writes the Resume system's record,
// marked abandoned; a relic study that completes an exceptional set appends the ledger's "relic set completed" event.
// With the switch OFF (model.ts COMPLETION_TRACKING_SWITCH.live false, for one call or one file, restored after) none of
// them is written, so every state made inside it is the game before the slice exactly.

import { afterAll } from "vitest";
import { COMPLETION_TRACKING_SWITCH } from "./model";

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
