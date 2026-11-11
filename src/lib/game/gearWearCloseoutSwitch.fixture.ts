// GEAR WEAR close-out (docs/plans/2026-10-16-gear-wear-design.md, "Close-out review (2026-11-11) and USER ANSWERS"):
// the "turn it off" switch golden files captured before the close-out use to tick as before it (the
// gearRepairJobSwitch / patrolUseWearSwitch precedent). TEST-ONLY (imported by *.test.ts files only). It turns off the
// two engine answers:
//   - "Make it exact" (gearWearEngine.ts REPAIR_EXACT_EDGES_SWITCH): leftover underway seconds at a context change (a
//     run's end, a repair pause's or a field repair leg's edges, a recall during a pause) credited at the rate that
//     applied;
//   - "Keep the bay rate" (GEAR_BAY_RATE_KEPT_SWITCH): a ship's gear keeps the Shipyard bay rate until full after its
//     hull leaves the bay.
// gearWearCloseoutGoldens.test.ts traces every pin they move (PRE with them off, LIVE with them on).

import { afterAll } from "vitest";
import { GEAR_BAY_RATE_KEPT_SWITCH, REPAIR_EXACT_EDGES_SWITCH } from "./gearWearEngine";

// Run `f` with both answers off, then restore them.
export function withCloseoutOff<T>(f: () => T): T {
  const exact = REPAIR_EXACT_EDGES_SWITCH.live;
  const bay = GEAR_BAY_RATE_KEPT_SWITCH.live;
  REPAIR_EXACT_EDGES_SWITCH.live = false;
  GEAR_BAY_RATE_KEPT_SWITCH.live = false;
  try {
    return f();
  } finally {
    REPAIR_EXACT_EDGES_SWITCH.live = exact;
    GEAR_BAY_RATE_KEPT_SWITCH.live = bay;
  }
}

// For a golden FILE captured before the close-out whose pins are about another slice: off AT ONCE (so describe-time
// computations see it too), restored after its last test.
export function gearWearCloseoutOffForThisFile(): void {
  const exact = REPAIR_EXACT_EDGES_SWITCH.live;
  const bay = GEAR_BAY_RATE_KEPT_SWITCH.live;
  REPAIR_EXACT_EDGES_SWITCH.live = false;
  GEAR_BAY_RATE_KEPT_SWITCH.live = false;
  afterAll(() => {
    REPAIR_EXACT_EDGES_SWITCH.live = exact;
    GEAR_BAY_RATE_KEPT_SWITCH.live = bay;
  });
}
