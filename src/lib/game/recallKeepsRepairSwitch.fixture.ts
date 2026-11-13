// OC-F14 follow-up (user 2026-11-12 afternoon "Keep the repair (Recommended)"): the test-only switch golden files use to
// prove what the rule moved (the withRepairRulesOff precedent). TEST-ONLY (imported by *.test.ts files only).
//
// The rule moves one thing in the engine: a recall on a run stamped with the repair rules (Expedition.repairRules) while
// the ship flies back from a FINISHED field repair settles that repair (groundOps.ts closeGroundOps recallKeepsRepair).
// With the switch OFF (model.ts RECALL_KEEPS_REPAIR_SWITCH.live false, for one call, restored after) such a recall stops
// the repair with its damage, exactly as before; a canceled order's share is settled either way (OC-F14 as built).

import { RECALL_KEEPS_REPAIR_SWITCH } from "./model";

export function withRecallKeepsRepairOff<T>(run: () => T): T {
  const was = RECALL_KEEPS_REPAIR_SWITCH.live;
  RECALL_KEEPS_REPAIR_SWITCH.live = false;
  try {
    return run();
  } finally {
    RECALL_KEEPS_REPAIR_SWITCH.live = was;
  }
}
