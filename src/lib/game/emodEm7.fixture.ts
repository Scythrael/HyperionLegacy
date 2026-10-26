// TEST-ONLY (E-MOD EM-7): the catalog additions of the v1 module roster, so every golden captured before EM-7 can hold
// them apart and keep proving its own slice was its only move (the HELD_DRIVE_KEYS / OC15_ADDED precedent). EM-7 adds:
//   - eight blueprints (model.ts MODULE_BLUEPRINTS, Lab tiers 2 to 4), spread into BLUEPRINTS after the
//     Bio-Resonance Array;
//   - eight module slot varieties (EQUIPMENT_SLOTS.module, derived from shipModules.ts UNIVERSAL_MODULES);
//   - the Armory's module slots (UNIVERSAL_MODULES_LIVE: loadoutSlotDefsForShipType offers them now).
// Never imported by app code.

import { MODULE_BLUEPRINTS } from "./model";
import { UNIVERSAL_MODULES } from "./shipModules";

export const EM7_BLUEPRINT_KEYS: ReadonlySet<string> = new Set(Object.keys(MODULE_BLUEPRINTS));
export const EM7_MODULE_VARIETIES: ReadonlySet<string> = new Set(UNIVERSAL_MODULES.map((d) => d.id));

// A blueprint record (or key list) without EM-7's eight module blueprints, in its own order.
export function withoutEm7Blueprints<T>(record: Readonly<Record<string, T>>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([k]) => !EM7_BLUEPRINT_KEYS.has(k)));
}
export function withoutEm7Keys(keys: readonly string[]): string[] {
  return keys.filter((k) => !EM7_BLUEPRINT_KEYS.has(k));
}
