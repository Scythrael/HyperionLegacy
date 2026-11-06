// Complement CP-16 (the Hall of Command): the wiring registry READ-BACK the registry golden chains apply, since their
// pins were taken before it (the cp14ReadBack precedent). TEST-ONLY.
//
// CP-16 changes the registry one way (wiring/registry.ts cp16HallEntries):
//   added : captain:progression:missionsFlown, captain:progression:commandNotables, captain:progression:hallOfCommand
//           and the audit rows captain:audit:commandFirsts, :commandFirstRelicClaim, :commandFirstRelicShortRange and
//           :commandFirstRefugee (the fix round: one per path a first is recorded on), all live.
// cp16ReadBack takes the added rows out. Apply it innermost.

import type { WiringEntry } from "./wiring/registry";

export const CP16_ADDED_IDS: ReadonlySet<string> = new Set([
  "captain:progression:missionsFlown",
  "captain:progression:commandNotables",
  "captain:progression:hallOfCommand",
  "captain:audit:commandFirsts",
  "captain:audit:commandFirstRelicClaim",
  "captain:audit:commandFirstRelicShortRange",
  "captain:audit:commandFirstRefugee",
]);

export function cp16ReadBack(entries: readonly WiringEntry[]): WiringEntry[] {
  return entries.filter((e) => !CP16_ADDED_IDS.has(e.id));
}
