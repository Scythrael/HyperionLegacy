// OC-D8 FOLLOW-UP (Fast Departure / Fast Return on patrols, user 2026-10-30 "Yes, each its own leg"): the wiring
// registry READ-BACK the registry golden chains apply, since their pins were taken before it. TEST-ONLY.
//
// The follow-up flips nothing (no crew row claimed a pending patrol context) and adds two audit rows
// (wiring/registry.ts cp2AuditEntries): crew:audit:patrolDepartureLeg and crew:audit:patrolReturnLeg, each lift on its
// own patrol leg. patrolLegLiftsReadBack removes them, so a pin taken before is reproduced exactly.

import type { WiringEntry } from "./wiring/registry";

export const PATROL_LEG_LIFTS_ADDED_IDS: ReadonlySet<string> = new Set(["crew:audit:patrolDepartureLeg", "crew:audit:patrolReturnLeg"]);

export function patrolLegLiftsReadBack(entries: readonly WiringEntry[]): WiringEntry[] {
  return entries.filter((e) => !PATROL_LEG_LIFTS_ADDED_IDS.has(e.id));
}
