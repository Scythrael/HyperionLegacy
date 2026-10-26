// TEST-ONLY (E-MOD EM-7): the slice's wiring registry move, read back so every earlier registry pin keeps proving its
// own slice was its only move (the em5ReadBack / em4ReadBack precedent). EM-7 changes the registry in two ways:
//   added  : one row per v1 universal module (ship:UNIVERSAL_MODULES:<id>, each live on its category's engine), the
//            Survey Pair's set tier (ship:GEAR_SETS:surveyPair:2) and the eight module blueprints' research rows.
//   flipped: every hull's `moduleSlots` field entry, pending on EM-7 since EM-5 ("the module slot is hidden until a
//            module can be crafted"), is live now (the install gate's count, content:moduleInstalls:<hull>).
// em7ReadBack removes the added rows and restores the flipped rows as EM-5 left them (pending, no probe, no context).
// Never imported by app code.

import { MODULE_BLUEPRINTS, SHIP_TYPES, type ShipTypeKey } from "./model";
import { UNIVERSAL_MODULES } from "./shipModules";
import type { WiringEntry } from "./wiring/registry";

export const EM7_ADDED_ENTRY_IDS: ReadonlySet<string> = new Set([
  ...UNIVERSAL_MODULES.map((d) => `ship:UNIVERSAL_MODULES:${d.id}`),
  "ship:GEAR_SETS:surveyPair:2",
  // Each module blueprint's research entry (recipeAndBlueprintEntries enumerates every blueprint).
  ...Object.keys(MODULE_BLUEPRINTS).map((k) => `facility:BLUEPRINTS:${k}`),
]);

export const EM7_MODULE_SLOTS_IDS: ReadonlySet<string> = new Set(
  (Object.keys(SHIP_TYPES) as ShipTypeKey[]).map((hull) => `ship:SHIP_TYPES:${hull}:moduleSlots`),
);
export const EM7_MODULE_SLOTS_OWNER_BEFORE = "EM-7 (the module slot is hidden until a module can be crafted: UNIVERSAL_MODULES_LIVE)";

export function em7ReadBack(entries: readonly WiringEntry[]): WiringEntry[] {
  return entries
    .filter((e) => !EM7_ADDED_ENTRY_IDS.has(e.id))
    .map((e) =>
      EM7_MODULE_SLOTS_IDS.has(e.id)
        ? ({ ...e, status: { kind: "pending", owner: EM7_MODULE_SLOTS_OWNER_BEFORE }, probe: undefined, contexts: [], note: undefined } as unknown as WiringEntry)
        : e,
    );
}
