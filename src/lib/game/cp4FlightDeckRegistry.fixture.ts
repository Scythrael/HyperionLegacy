// Complement plan CP-4's rest (user 2026-11-10 "Build it"): the registry read-back the earlier registry pins use to prove
// the Flight Deck Integrity facet's registry move is exactly its own (the otUiRegistry / cp16Registry precedent).
// TEST-ONLY.
//
// The facet moved the registry one way: it ADDED one live audit row, crew:audit:flightDeckIntegrityReplenish (measured
// by the patrolReplenishSteadyLift probe). The read-back drops it, so a pin taken before the facet is reproduced exactly.
// Applied innermost.

import type { WiringEntry } from "./wiring/registry";

export const CP4_FD_ADDED_IDS: ReadonlySet<string> = new Set<string>(["crew:audit:flightDeckIntegrityReplenish"]);

// The whole registry list read back to before the facet.
export function cp4FdReadBack<T extends Pick<WiringEntry, "id">>(entries: readonly T[]): T[] {
  return entries.filter((e) => !CP4_FD_ADDED_IDS.has(e.id));
}
