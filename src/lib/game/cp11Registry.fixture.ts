// Complement plan CP-11 (crew module and early sensor array blueprints): the wiring registry READ-BACK the registry
// golden chains apply, since their pins were taken before it (the cp5ReadBack / sf7ReadBack precedent). TEST-ONLY.
//
// CP-11 changes the registry two ways (wiring/registry.ts):
//   added   : per blueprint, its research row (facility:BLUEPRINTS:<key>, recipeAndBlueprintEntries walks BLUEPRINTS)
//             and its effect row (ship:BLUEPRINTS:<key>:effect: the crafted piece installed moves its consumer);
//   restated: ship:EQUIPMENT_SLOTS:bridge+quarters:obtainable stays pending, its owner narrowed to CP-12 (the install
//             tiles) now that every blueprint exists.
// cp11ReadBack drops the added rows and puts the restated row's status back as it stood, so a pin taken before CP-11 is
// reproduced exactly. The keys come from cp11BlueprintsSwitch.fixture.ts (listed by name, so the set is the same before
// and after the content).

import type { WiringEntry } from "./wiring/registry";
import { CP11_BLUEPRINT_KEYS } from "./cp11BlueprintsSwitch.fixture";

export const CP11_ADDED_ENTRY_IDS: ReadonlySet<string> = new Set([...CP11_BLUEPRINT_KEYS].flatMap((k) => [`facility:BLUEPRINTS:${k}`, `ship:BLUEPRINTS:${k}:effect`]));

export const CP11_RESTATED_ID = "ship:EQUIPMENT_SLOTS:bridge+quarters:obtainable";
export const CP11_BEFORE = {
  status: { kind: "pending", owner: "CP-11, CP-12 (no blueprint makes any of the 12 modules; no install tile)" },
} as const;

export function cp11ReadBack(entries: readonly WiringEntry[]): WiringEntry[] {
  return entries.filter((e) => !CP11_ADDED_ENTRY_IDS.has(e.id)).map((e) => (e.id === CP11_RESTATED_ID ? ({ ...e, ...CP11_BEFORE } as unknown as WiringEntry) : e));
}
