// TEST-ONLY (E-MOD EM-5): the universal module catalog ships EMPTY until EM-7 authors the v1 roster, so the engine
// tests run against FIXTURE modules: withTestModules puts the given defs into UNIVERSAL_MODULES and the module slot's
// varieties (EQUIPMENT_SLOTS.module) for the duration of `fn`, then restores both exactly (the withPreMl2Recipes
// precedent: static data swapped for the call, restored in a finally). The fixture ids start "testModule" and are
// never real content. Never imported by app code.

import { EQUIPMENT_SLOTS, type EquipmentInstance, type EquipmentRarity } from "./model";
import { UNIVERSAL_MODULES, type UniversalModuleDef } from "./shipModules";
import { generateEquipment } from "./itemgen";

export function withTestModules<T>(defs: readonly UniversalModuleDef[], fn: () => T): T {
  const catalog = UNIVERSAL_MODULES as UniversalModuleDef[];
  const varieties = EQUIPMENT_SLOTS.module.varieties;
  const savedCatalog = catalog.slice();
  const savedVarieties = varieties.slice();
  try {
    catalog.push(...defs);
    varieties.push(...defs.map((d) => ({ key: d.id, label: d.label, statRatios: {} })));
    return fn();
  } finally {
    catalog.splice(0, catalog.length, ...savedCatalog);
    varieties.splice(0, varieties.length, ...savedVarieties);
  }
}

// A passive fixture module (one engine key each), a conditional fixture, and plain power-free fixtures for the slot
// counts (a passive power output of a tiny magnitude, distinct ids).
export const TEST_CAPACITOR: UniversalModuleDef = {
  id: "testModuleCapacitor",
  label: "Test Capacitor",
  category: "passive",
  contexts: ["patrol", "shipEvent", "mission", "expedition"],
  effect: { key: "powerOutput", magnitude: 8 },
  powerDraw: 0,
  source: "craft",
};
export const TEST_BRACING: UniversalModuleDef = {
  id: "testModuleBracing",
  label: "Test Bracing",
  category: "passive",
  contexts: ["patrol", "shipEvent"],
  effect: { key: "hullIntegrity", magnitude: 0.06 },
  powerDraw: 3,
  source: "craft",
};
export const TEST_LAST_STAND: UniversalModuleDef = {
  id: "testModuleLastStand",
  label: "Test Last Stand",
  category: "conditional",
  contexts: ["patrol", "shipEvent"],
  condition: { kind: "hullBelow", fraction: 0.25 },
  effect: { key: "weaponDamage", magnitude: 0.12 },
  powerDraw: 4,
  source: "craft",
};
// Five distinct no-draw modules for the slot counts (the most module slots on any hull is 5).
export const TEST_FILLERS: UniversalModuleDef[] = Array.from({ length: 6 }, (_, i) => ({
  id: `testModuleFiller${i}`,
  label: `Test Filler ${i}`,
  category: "passive" as const,
  contexts: ["patrol", "shipEvent", "mission", "expedition"] as const,
  effect: { key: "powerOutput" as const, magnitude: 1 },
  powerDraw: 0,
  source: "craft" as const,
}));

let mintCount = 0;
// Mint a module piece of `def` (inside withTestModules), in storage.
export function mintTestModule(def: UniversalModuleDef, rarity: EquipmentRarity = "standard", quality = 0, id?: string): EquipmentInstance {
  const n = mintCount++;
  return generateEquipment({
    slotType: "module",
    varietyKey: def.id,
    blueprintKey: null,
    iLevel: 20,
    quality,
    rarity,
    ascension: "none",
    rng: () => 0.5,
    allocateId: () => id ?? `test-module-${n}`,
  });
}
