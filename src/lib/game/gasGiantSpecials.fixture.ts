// TEST-ONLY (Gas Giant Study GG-7): the catalog additions of the canisters' crafting uses and the three special
// blueprints, so every golden captured before GG-7 can hold them apart and keep proving its own slice was its only move
// (the emodEm7.fixture.ts / OC15_ADDED precedent). GG-7 adds:
//   - four blueprints (model.ts GAS_GIANT_BLUEPRINTS: the three special blueprints and the Lab tier III Elite Quarters),
//     spread into BLUEPRINTS after EM-7's module blueprints;
//   - three slot varieties: Pressure-Forged Plating (hullPlating), the Resonance Sensor Array (sensor, with its
//     SENSOR_ARRAYS row) and the Ramscoop Collector (module, with its UNIVERSAL_MODULES row).
// withoutGg7Content runs `fn` with all of them taken out of the static tables and puts them back exactly (key order
// included) in a finally (the withTestModules / withPreMl2Recipes precedent). Never imported by app code.

import { BLUEPRINTS, EQUIPMENT_SLOTS, GAS_GIANT_BLUEPRINTS, resetRefineConsumerCacheForTest, type BlueprintDef } from "./model";
import { UNIVERSAL_MODULES, type UniversalModuleDef } from "./shipModules";
import { SENSOR_ARRAYS, type SensorArrayDef } from "./sensorArrays";
import { PRESSURE_FORGED_PLATING_VARIETY, RAMSCOOP_COLLECTOR_MODULE, RESONANCE_SENSOR_ARRAY } from "./specialBlueprints";

export const GG7_BLUEPRINT_KEYS: ReadonlySet<string> = new Set(Object.keys(GAS_GIANT_BLUEPRINTS));
// `${slotType}:${varietyKey}` of each added variety.
export const GG7_VARIETIES: ReadonlySet<string> = new Set([
  `hullPlating:${PRESSURE_FORGED_PLATING_VARIETY}`,
  `sensor:${RESONANCE_SENSOR_ARRAY}`,
  `module:${RAMSCOOP_COLLECTOR_MODULE}`,
]);

export function withoutGg7Keys(keys: readonly string[]): string[] {
  return keys.filter((k) => !GG7_BLUEPRINT_KEYS.has(k));
}

export function withoutGg7Content<T>(fn: () => T): T {
  const savedBps: [string, BlueprintDef][] = Object.entries(BLUEPRINTS);
  const slots = ["hullPlating", "sensor", "module"] as const;
  const savedVarieties = slots.map((s) => EQUIPMENT_SLOTS[s].varieties.slice());
  const arrays = SENSOR_ARRAYS as SensorArrayDef[];
  const modules = UNIVERSAL_MODULES as UniversalModuleDef[];
  const savedArrays = arrays.slice();
  const savedModules = modules.slice();
  try {
    for (const k of GG7_BLUEPRINT_KEYS) delete BLUEPRINTS[k];
    for (const s of slots) {
      const v = EQUIPMENT_SLOTS[s].varieties;
      v.splice(0, v.length, ...v.filter((x) => !GG7_VARIETIES.has(`${s}:${x.key}`)));
    }
    arrays.splice(0, arrays.length, ...arrays.filter((a) => a.id !== RESONANCE_SENSOR_ARRAY));
    modules.splice(0, modules.length, ...modules.filter((d) => d.id !== RAMSCOOP_COLLECTOR_MODULE));
    resetRefineConsumerCacheForTest();
    return fn();
  } finally {
    for (const k of Object.keys(BLUEPRINTS)) delete BLUEPRINTS[k];
    for (const [k, bp] of savedBps) BLUEPRINTS[k] = bp;
    slots.forEach((s, i) => {
      const v = EQUIPMENT_SLOTS[s].varieties;
      v.splice(0, v.length, ...savedVarieties[i]);
    });
    arrays.splice(0, arrays.length, ...savedArrays);
    modules.splice(0, modules.length, ...savedModules);
    resetRefineConsumerCacheForTest();
  }
}
