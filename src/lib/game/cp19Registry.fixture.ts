// Complement CP-19 (the Personnel Rosters upgrade track): the wiring registry READ-BACK the registry golden chains apply,
// since their pins were taken before it (the cp18ReadBack precedent). TEST-ONLY.
//
// CP-19 changes the registry one way: FACILITIES.personnelRosters adds one live row per rung on each candidate board
// (facility:FACILITIES:personnelRosters:<i> on the officer board, :<i>:recruits on the recruit board). cp19ReadBack takes
// the added rows out. Apply it innermost.

import { PERSONNEL_ROSTERS_LEVELS } from "./model";
import type { WiringEntry } from "./wiring/registry";

export const CP19_ADDED_IDS: ReadonlySet<string> = new Set(
  PERSONNEL_ROSTERS_LEVELS.flatMap((_row, i) => [`facility:FACILITIES:personnelRosters:${i}`, `facility:FACILITIES:personnelRosters:${i}:recruits`]),
);

export function cp19ReadBack(entries: readonly WiringEntry[]): WiringEntry[] {
  return entries.filter((e) => !CP19_ADDED_IDS.has(e.id));
}
