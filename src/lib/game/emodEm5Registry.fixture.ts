// TEST-ONLY (E-MOD EM-5): the slice's wiring registry move, read back so every earlier registry pin keeps proving its
// own slice was its only move (the ml2RowsBack / siReadBack precedent). EM-5 changes the registry in two ways:
//   added   : the two gear wear rows for the new module slot (user M9, "Slowly underway"): a use source and an
//             efficiency consumer, both pending on gear wear steps 3 and 4 like every other slot's rows.
//   re-owned: every hull's `moduleSlots` field entry stays pending, but its owner moves from WR-7 / OC-D4 ("no reader")
//             to EM-7: the install gate reads the count now, and the slot is hidden until EM-7's first module.
// em5ReadBack removes the added rows and restores the old owner text in place. Never imported by app code.

import { SHIP_TYPES, type ShipTypeKey } from "./model";
import type { WiringEntry } from "./wiring/registry";

export const EM5_ADDED_ENTRY_IDS: ReadonlySet<string> = new Set([
  "wear:WEAR_SOURCES:module:minutesUnderway",
  "wear:WEAR_EFFICIENCY:module:effect",
]);

export const EM5_MODULE_SLOTS_IDS: ReadonlySet<string> = new Set(
  (Object.keys(SHIP_TYPES) as ShipTypeKey[]).map((hull) => `ship:SHIP_TYPES:${hull}:moduleSlots`),
);
const MODULE_SLOTS_OWNER_BEFORE = "WR-7, OC-D4 (no reader; every hull has the same slot set)";

export function em5ReadBack(entries: readonly WiringEntry[]): WiringEntry[] {
  return entries
    .filter((e) => !EM5_ADDED_ENTRY_IDS.has(e.id))
    .map((e) => (EM5_MODULE_SLOTS_IDS.has(e.id) ? ({ ...e, status: { kind: "pending", owner: MODULE_SLOTS_OWNER_BEFORE } } as WiringEntry) : e));
}
