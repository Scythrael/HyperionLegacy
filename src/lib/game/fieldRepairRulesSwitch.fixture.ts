// OC-F14 (the player-ordered field repair, user answers 2026-11-12): the test-only switch golden files use to prove what
// OC-F14 moved (the withWr10Off precedent). TEST-ONLY (imported by *.test.ts files only).
//
// OC-F14 moves one thing in the engine: a dispatch on a system that mixes repair worlds with other bodies stamps the
// field repair rules (Expedition.repairRules), under which every field repair, the threshold's and the player's order,
// takes the faster of the nearest repair world and orbit (groundOps.ts fieldRepairPlan). The cancel is a new player action
// and moves nothing on its own. With the switch OFF (model.ts FIELD_REPAIR_RULES_SWITCH.live false, for one call or one
// file, restored after) no stamp is written, so every run made inside it repairs by the old nearest-world rule exactly.

import { afterAll } from "vitest";
import { FIELD_REPAIR_RULES_SWITCH } from "./model";

export function withRepairRulesOff<T>(run: () => T): T {
  const was = FIELD_REPAIR_RULES_SWITCH.live;
  FIELD_REPAIR_RULES_SWITCH.live = false;
  try {
    return run();
  } finally {
    FIELD_REPAIR_RULES_SWITCH.live = was;
  }
}

// For a golden FILE captured before OC-F14 whose pins are about another slice: the whole file runs with OC-F14 off, and
// its pins keep proving that slice moved nothing else. Called once at the file's top level, restored after its last test.
export function repairRulesOffForThisFile(): void {
  const was = FIELD_REPAIR_RULES_SWITCH.live;
  FIELD_REPAIR_RULES_SWITCH.live = false;
  afterAll(() => {
    FIELD_REPAIR_RULES_SWITCH.live = was;
  });
}
