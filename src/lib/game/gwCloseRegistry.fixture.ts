// Gear wear close-out (user 2026-11-11 "Yes, it's combat wear (Recommended)": the Damage Control Suite's wear when it
// patches a patrol wave stays as built, and the registry says it counts as combat wear): the wiring registry READ-BACK
// the registry golden chains apply, since their pins were taken before it (the ocg1ReadBack precedent). TEST-ONLY.
//
// The close-out changes ONE row's claim: wear:WEAR_SOURCES:specUtility:effectFires gains "; a Damage Control Suite's
// fire on a patrol wave it patches counts as combat wear". gwCloseReadBack puts the claim back exactly as it stood.
// Apply it innermost.

import type { WiringEntry } from "./wiring/registry";

const ROW_ID = "wear:WEAR_SOURCES:specUtility:effectFires";
const ADDED = "; a Damage Control Suite's fire on a patrol wave it patches counts as combat wear";

export function gwCloseReadBack(entries: readonly WiringEntry[]): WiringEntry[] {
  return entries.map((e) => (e.id === ROW_ID && e.claim.endsWith(ADDED) ? { ...e, claim: e.claim.slice(0, -ADDED.length) } : e));
}
