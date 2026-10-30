// WR-7 follow-up OC-D8 patrol legs ("patrol legs scale with transitSpeedMult", user 2026-10-15): the wiring registry
// READ-BACK the registry golden chains apply, since their pins were taken before it. TEST-ONLY.
//
// The change flips the transit sources' pending patrol context live and adds one audit row (wiring/registry.ts):
//   flipped : the gear speed line (ship:gearLine:transitSpeedMult), every combat hull's transitSpeedMult (all ten hulls
//             can patrol) and the museum's transit speed (relic:MUSEUM_STATS:transitSpeed): each was
//             pending(PATROL_LEGS_OWNER, ["patrol"]) with its live contexts unchanged.
//   added   : ship:audit:patrolLegs (the sheet speed scaling the legs, measured once).
// patrolLegsReadBack puts them back as they stood, so a pin taken before is reproduced exactly.

import { SHIP_TYPES, type ShipTypeKey } from "./model";
import { combatHullTypeOf } from "./combat/bridge";
import type { WiringEntry } from "./wiring/registry";

export const PATROL_LEGS_ADDED_IDS: ReadonlySet<string> = new Set(["ship:audit:patrolLegs"]);
export const PATROL_LEGS_FLIPPED_IDS: ReadonlySet<string> = new Set([
  "ship:gearLine:transitSpeedMult",
  ...(Object.keys(SHIP_TYPES) as ShipTypeKey[]).filter((h) => combatHullTypeOf(h) !== null).map((h) => `ship:SHIP_TYPES:${h}:transitSpeedMult`),
  "relic:MUSEUM_STATS:transitSpeed",
]);
export const PATROL_LEGS_BEFORE: WiringEntry["status"] = {
  kind: "pending",
  owner: "WR-7 follow-up, OC-D8 (patrol legs scale with transit speed; moves every patrol golden, its own slice)",
  contexts: ["patrol"],
};

export function patrolLegsReadBack(entries: readonly WiringEntry[]): WiringEntry[] {
  return entries.filter((e) => !PATROL_LEGS_ADDED_IDS.has(e.id)).map((e) => (PATROL_LEGS_FLIPPED_IDS.has(e.id) ? ({ ...e, status: PATROL_LEGS_BEFORE } as WiringEntry) : e));
}
