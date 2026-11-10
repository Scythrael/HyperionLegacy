// Material Lines ML-5 (quality blanks): the wiring registry READ-BACK the registry golden chains apply, since their
// pins were taken before it (the cp19ReadBack precedent). TEST-ONLY.
//
// ML-5 changes the registry one way:
//   added : two live audit rows, facility:audit:blankCarriedQuality (a fabricate job's blank keeps its carried
//           quality) and facility:audit:inspectCarriedQuality (inspect takes the highest quality first and starts the
//           piece from it). Nothing else moved.
// ml5ReadBack takes the added rows out. Apply it innermost.

import type { WiringEntry } from "./wiring/registry";

export const ML5_ADDED_IDS: ReadonlySet<string> = new Set(["facility:audit:blankCarriedQuality", "facility:audit:inspectCarriedQuality"]);

export function ml5ReadBack(entries: readonly WiringEntry[]): WiringEntry[] {
  return entries.filter((e) => !ML5_ADDED_IDS.has(e.id));
}
