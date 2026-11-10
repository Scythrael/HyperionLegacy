// Complement CP-18 (the soft captain level cap): the wiring registry READ-BACK the registry golden chains apply, since
// their pins were taken before it (the cp16ReadBack precedent). TEST-ONLY.
//
// CP-18 changes the registry one way: it adds captain:progression:softLevelCap, live. cp18ReadBack takes the added row
// out. Apply it innermost.

import type { WiringEntry } from "./wiring/registry";

export const CP18_ADDED_IDS: ReadonlySet<string> = new Set(["captain:progression:softLevelCap"]);

export function cp18ReadBack(entries: readonly WiringEntry[]): WiringEntry[] {
  return entries.filter((e) => !CP18_ADDED_IDS.has(e.id));
}
