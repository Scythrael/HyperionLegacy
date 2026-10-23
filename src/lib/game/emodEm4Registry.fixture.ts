// TEST-ONLY (E-MOD EM-4): the slice's wiring registry move, read back so every earlier registry pin keeps proving its
// own slice was its only move (the em3ReadBack / em5ReadBack precedent). EM-4 changes the registry in two ways:
//   flipped: ship:audit:reactorCoreNet (B10), pending on EM-4 since WR-1, goes live with its check (the sheet's transit
//            speed and the Ground Ops voyage), its claim rewritten to the fixed behavior.
//   added  : ship:em4:reactorLiftCombatSpeed, the lift reaching the combat speed stamp (the WR-8 hand-off).
// em4ReadBack removes the added row and restores the flipped row's old claim and owner in place. Never imported by app
// code.

import type { WiringEntry } from "./wiring/registry";

export const EM4_ADDED_ENTRY_IDS: ReadonlySet<string> = new Set(["ship:em4:reactorLiftCombatSpeed"]);
export const EM4_FLIPPED_ID = "ship:audit:reactorCoreNet";
const CLAIM_BEFORE =
  "A crafted Reactor Core is net negative: its output only raises the power budget (no install gate or penalty before EM-2 / EM-3, the hull's own output covers every loadout), and its mass drags speed and fuel (B10)";
const OWNER_BEFORE = "E-MOD EM-4 (unused reactor power speeds the drive, P3)";

export function em4ReadBack<T extends Pick<WiringEntry, "id">>(entries: readonly T[]): T[] {
  return entries
    .filter((e) => !EM4_ADDED_ENTRY_IDS.has(e.id))
    .map((e) => {
      if (e.id !== EM4_FLIPPED_ID) return e;
      // The row as it stood: the registry's entry defaults (no probe, no contexts) with its pending status.
      const { probe: _probe, tolerance: _tolerance, ...rest } = e as unknown as WiringEntry;
      return { ...rest, claim: CLAIM_BEFORE, status: { kind: "pending", owner: OWNER_BEFORE }, contexts: [], direction: "up", curve: { kind: "linearAbsolute" } } as unknown as T;
    });
}
