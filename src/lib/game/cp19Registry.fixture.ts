// Complement CP-19 (the Personnel Rosters upgrade track): the wiring registry READ-BACK the registry golden chains apply,
// since their pins were taken before it (the cp18ReadBack / cp14ReadBack precedent). TEST-ONLY.
//
// CP-19 changes the registry two ways:
//   added : FACILITIES.personnelRosters adds one live row per rung on each candidate board
//           (facility:FACILITIES:personnelRosters:<i> on the officer board, :<i>:recruits on the recruit board).
//   moved : the fix round (USER ANSWERS 2026-11-09 "Flat +1 always") made the Recruiter (commandCrew4) a flat +1 slot,
//           so its two rows' claim, curve, tolerance and note changed (was WR-5c's x1.08 rounded up).
// cp19ReadBack takes the added rows out and puts the moved rows back as they stood. Apply it innermost.

import { PERSONNEL_ROSTERS_LEVELS } from "./model";
import type { Curve, WiringEntry } from "./wiring/registry";

export const CP19_ADDED_IDS: ReadonlySet<string> = new Set(
  PERSONNEL_ROSTERS_LEVELS.flatMap((_row, i) => [`facility:FACILITIES:personnelRosters:${i}`, `facility:FACILITIES:personnelRosters:${i}:recruits`]),
);

export const CP19_MOVED_IDS: ReadonlySet<string> = new Set([
  "captain:SECONDARY_CAPTAIN_TALENTS:commandCrew4",
  "captain:SECONDARY_CAPTAIN_TALENTS:commandCrew4:recruits",
]);
export const CP19_RECRUITER_BEFORE = {
  claim: "Recruiter: +8% candidate board size, rounded up (+1 on each board of 10); fleet-wide, the best Recruiter counts and a second one adds nothing",
  curve: { kind: "linearRelative" } as Curve,
  tolerance: 1,
  note: "rounded up to whole candidates",
};

export function cp19ReadBack(entries: readonly WiringEntry[]): WiringEntry[] {
  return entries
    .filter((e) => !CP19_ADDED_IDS.has(e.id))
    .map((e) => (CP19_MOVED_IDS.has(e.id) ? { ...e, ...CP19_RECRUITER_BEFORE } : e));
}
