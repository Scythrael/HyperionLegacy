// TEST-ONLY (E-MOD EM-8): the Precursor Lens's additions, held apart, so every golden captured before EM-8 can prove
// EM-8 was its only move (the gasGiantSpecials.fixture.ts / emodEm7.fixture.ts precedent). EM-8 adds:
//   - one module (shipModules.ts UNIVERSAL_MODULES: precursorLens, the Special) and so one module slot variety
//     (EQUIPMENT_SLOTS.module.varieties, derived from the catalog);
//   - one discovery-gated blueprint (model.ts BLUEPRINTS.precursorLensBp, gated on the Precursor Lens relic);
//   - the Precursor Circuit's consumer: its ItemDef drops the reserve marker and its hint names the recipe.
// withoutEm8Content runs `fn` with all of them taken out (the item restored to its pre-EM-8 def) and puts them back
// exactly (key order included) in a finally. Never imported by app code.

import { BLUEPRINTS, EQUIPMENT_SLOTS, ITEMS, resetRefineConsumerCacheForTest, type BlueprintDef, type ItemDef } from "./model";
import { PRECURSOR_LENS_MODULE, UNIVERSAL_MODULES, type UniversalModuleDef } from "./shipModules";

export const EM8_BLUEPRINT_KEYS: ReadonlySet<string> = new Set(["precursorLensBp"]);

// The Precursor Circuit's ItemDef fields before EM-8 (the WR-11 reserve marker and hint).
export const EM8_PRE_CIRCUIT: Readonly<Pick<ItemDef, "unlockHint" | "reserved">> = {
  unlockHint: "Recovered only from salvage. Sells at the Quartermaster; reserved for a future recipe not yet built.",
  reserved: "EM-8 (the Precursor Lens special module is crafted with it)",
};

export function withoutEm8Keys(keys: readonly string[]): string[] {
  return keys.filter((k) => !EM8_BLUEPRINT_KEYS.has(k));
}

export function withoutEm8Content<T>(fn: () => T): T {
  const savedBps: [string, BlueprintDef][] = Object.entries(BLUEPRINTS);
  const varieties = EQUIPMENT_SLOTS.module.varieties;
  const savedVarieties = varieties.slice();
  const modules = UNIVERSAL_MODULES as UniversalModuleDef[];
  const savedModules = modules.slice();
  const items = ITEMS as Record<string, ItemDef>;
  const savedCircuit = items.precursorCircuit;
  try {
    for (const k of EM8_BLUEPRINT_KEYS) delete BLUEPRINTS[k];
    varieties.splice(0, varieties.length, ...varieties.filter((v) => v.key !== PRECURSOR_LENS_MODULE));
    modules.splice(0, modules.length, ...modules.filter((d) => d.id !== PRECURSOR_LENS_MODULE));
    // The pre-EM-8 def, in its own key order (unlockHint, flavor, sellValue, reserved).
    const { unlockHint: _hint, flavor, sellValue, ...head } = savedCircuit;
    items.precursorCircuit = { ...head, unlockHint: EM8_PRE_CIRCUIT.unlockHint, flavor, sellValue, reserved: EM8_PRE_CIRCUIT.reserved } as ItemDef;
    resetRefineConsumerCacheForTest();
    return fn();
  } finally {
    for (const k of Object.keys(BLUEPRINTS)) delete BLUEPRINTS[k];
    for (const [k, bp] of savedBps) BLUEPRINTS[k] = bp;
    varieties.splice(0, varieties.length, ...savedVarieties);
    modules.splice(0, modules.length, ...savedModules);
    items.precursorCircuit = savedCircuit;
    resetRefineConsumerCacheForTest();
  }
}
