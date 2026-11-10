// GEAR WEAR step 5 review fix (the Overtime price, user 2026-11-09 "Match the existing rule"): the "turn it off" switch
// golden files captured before the docked gear repair JOB RECORD (ShipInstance.gearRepairJobMinutes, gearWearEngine.ts
// trackGearRepairJobs) use to tick as before it (the patrolUseWearSwitch precedent). TEST-ONLY (imported by *.test.ts
// files only). The record is the only thing it moves: a ship that sits docked with worn gear for a tick gains it, so a
// golden whose run ends home and worn moves its state hash and nothing else (proved on the patrol legs goldens: with
// the record off every pin holds). gearWearStep5Fixes.test.ts pins the record itself.

import { afterAll } from "vitest";
import { GEAR_REPAIR_JOB_SWITCH } from "./gearWearEngine";

// For a golden FILE captured before the record whose pins are about another slice: off AT ONCE (so describe-time
// computations see it too), restored after its last test.
export function gearRepairJobOffForThisFile(): void {
  const was = GEAR_REPAIR_JOB_SWITCH.live;
  GEAR_REPAIR_JOB_SWITCH.live = false;
  afterAll(() => {
    GEAR_REPAIR_JOB_SWITCH.live = was;
  });
}
