// TEST-ONLY (E-MOD EM-3): the slice's wiring registry move, read back so every earlier registry pin keeps proving its
// own slice was its only move (the em5ReadBack precedent). EM-3 changes the registry in two ways:
//   flipped: ship:wr8:powerInCombat, pending on EM-3 since WR-8, goes live with its check. WR-8 added that row, so every
//            pin that reads the registry through wr8ReadBack already leaves it out; nothing to restore here.
//   added  : two rows of EM-3's own, the shield recharge half of the penalty and its 60% floor.
// em3ReadBack removes the added rows. Never imported by app code.

import type { WiringEntry } from "./wiring/registry";

export const EM3_ADDED_ENTRY_IDS: ReadonlySet<string> = new Set(["ship:em3:powerShieldRecharge", "ship:em3:powerSupplyFloor"]);

export function em3ReadBack<T extends Pick<WiringEntry, "id">>(entries: readonly T[]): T[] {
  return entries.filter((e) => !EM3_ADDED_ENTRY_IDS.has(e.id));
}
