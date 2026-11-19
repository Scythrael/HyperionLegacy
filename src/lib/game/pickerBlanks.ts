// Playtest F1 (2026-11-19, ChatGPT browser playthrough): a finished gear craft deposits an UNINSPECTED blank (ITEM
// LIFECYCLE 0.13.6), so the ship install picker's spare list stays empty until the player inspects it under
// Logistics, Crafted Blanks. The picker's empty-state text said only "Fabricate one", which read as if the craft had
// vanished. This counts the blanks that would fill the open picker, so the empty state can point at them. Pure.

import Decimal from "break_infinity.js";
import { BLUEPRINTS } from "./model";
import { blankTotal, type BlankStore } from "./qualityBlanks";

// What the open install picker fills: an equipment slot (by slot type), a weapon hardpoint, or a drone bay.
export type PickerBlankTarget = { kind: "slot"; slotType: string } | { kind: "weapon" } | { kind: "drone" };

// How many uninspected blanks the store holds whose blueprint would roll a piece for `target`. Unknown blueprint
// keys (an older or hand-edited save) count for nothing. Pure.
export function uninspectedBlanksFor(blanks: BlankStore, target: PickerBlankTarget): Decimal {
  let total = new Decimal(0);
  for (const key of Object.keys(blanks)) {
    const bp = BLUEPRINTS[key];
    if (bp === undefined) continue;
    const fills =
      target.kind === "slot"
        ? bp.equipmentOutput?.slotType === target.slotType
        : target.kind === "weapon"
          ? bp.weaponOutput !== undefined
          : bp.droneOutput !== undefined;
    if (fills) total = total.add(blankTotal(blanks, key));
  }
  return total;
}
