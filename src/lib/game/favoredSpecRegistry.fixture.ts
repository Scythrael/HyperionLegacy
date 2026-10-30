// WR-7 follow-up OC-D5 favorsSpec ("+10% on its ship type", user 2026-10-29): the wiring registry READ-BACK the registry
// golden chains apply, since their pins were taken before it. TEST-ONLY.
//
// The change moves exactly one entry and adds none: ship:audit:favorsSpec flipped pending -> live, with its probe and
// contexts (wiring/registry.ts wr7AuditWiring). favorsSpecReadBack puts it back as it stood, so a pin taken before is
// reproduced exactly.

import type { WiringEntry } from "./wiring/registry";

export const FAVORS_SPEC_ROW = "ship:audit:favorsSpec";
export const FAVORS_SPEC_BEFORE: WiringEntry["status"] = {
  kind: "pending",
  owner: "WR-7 follow-up, OC-D5 (\"+10% on its ship type\": the fold needs a per-run stamp on missions, patrol cycles and expeditions so a run in flight stays byte-identical)",
};

export function favorsSpecReadBack(entries: readonly WiringEntry[]): WiringEntry[] {
  return entries.map((e) => (e.id === FAVORS_SPEC_ROW ? ({ ...e, status: FAVORS_SPEC_BEFORE, contexts: [], probe: undefined } as WiringEntry) : e));
}
