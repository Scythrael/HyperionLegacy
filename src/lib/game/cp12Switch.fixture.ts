// TEST-ONLY (Complement CP-12: the Bridge Module and Crew Quarters install tiles, the slot renamed to Sensor Suite): the
// CP-12 changes held apart, so every golden captured before CP-12 can prove CP-12 was its only move (the
// cp11BlueprintsSwitch.fixture.ts / hullCrewCapsSwitch.fixture.ts precedent). Never imported by app code.
//
// CP-12 changes no rule, no draw and no save byte. What it changes that a pin can read:
//   text    : the sensor slot's display name, "Sensor Array" -> "Sensor Suite" (OC-25: "Slot = Sensor Suite"; the arrays
//             stay its varieties): EQUIPMENT_SLOTS.sensor.label and the "installed in a ship's <slot> slot" line of every
//             blueprint that makes a sensor piece. Identifiers (the "sensor" slot type, every variety key) are unchanged.
//   shelf   : the Fabricator's Item list files bridge and quarters blueprints under their own "Crew Modules" group
//             (awayGearDisplay.ts CREW_MODULE_SHELF_SWITCH), where they sat under Ship Systems.
//   registry: ship:EQUIPMENT_SLOTS:bridge+quarters:obtainable flips live (cp12Registry.fixture.ts reads it back).
// withoutCp12 runs `fn` with the text and the shelf as they stood, and puts them back exactly in a finally.

import { BLUEPRINTS, EQUIPMENT_SLOTS, type BlueprintDef } from "./model";
import { CREW_MODULE_SHELF_SWITCH } from "../awayGearDisplay";

export const CP12_SLOT_NAME_BEFORE = "Sensor Array";
export const CP12_SLOT_NAME_AFTER = "Sensor Suite";

export function withoutCp12<T>(fn: () => T): T {
  const label = EQUIPMENT_SLOTS.sensor.label;
  const shelf = CREW_MODULE_SHELF_SWITCH.on;
  const hints: [string, BlueprintDef][] = [];
  try {
    EQUIPMENT_SLOTS.sensor.label = CP12_SLOT_NAME_BEFORE;
    CREW_MODULE_SHELF_SWITCH.on = false;
    for (const [k, bp] of Object.entries(BLUEPRINTS)) {
      if (bp.equipmentOutput?.slotType !== "sensor" || bp.unlockHint === undefined) continue;
      hints.push([k, bp]);
      BLUEPRINTS[k] = { ...bp, unlockHint: bp.unlockHint.replace(`${CP12_SLOT_NAME_AFTER} slot`, `${CP12_SLOT_NAME_BEFORE} slot`) };
    }
    return fn();
  } finally {
    EQUIPMENT_SLOTS.sensor.label = label;
    CREW_MODULE_SHELF_SWITCH.on = shelf;
    for (const [k, bp] of hints) BLUEPRINTS[k] = bp;
  }
}
