// TEST-ONLY (E-MOD EM-4): the slice's wiring registry move, read back so every earlier registry pin keeps proving its
// own slice was its only move (the em3ReadBack / em5ReadBack precedent). EM-4 changes the registry in two ways:
//   flipped: ship:audit:reactorCoreNet (B10), pending on EM-4 since WR-1, goes live with its check (the sheet's transit
//            speed and the Ground Ops voyage), its claim rewritten to the fixed behavior.
//   added  : ship:em4:reactorLiftCombatSpeed, the lift reaching the combat speed stamp (the WR-8 hand-off), and
//            ship:em4:reactorNeverSlower, the floor (user 2026-10-23 "Never slower").
// em4ReadBack removes the added row and restores the flipped row's old claim and owner in place. Never imported by app
// code.

import type { WiringEntry } from "./wiring/registry";

export const EM4_ADDED_ENTRY_IDS: ReadonlySet<string> = new Set(["ship:em4:reactorLiftCombatSpeed", "ship:em4:reactorNeverSlower"]);
export const EM4_FLIPPED_ID = "ship:audit:reactorCoreNet";
const CLAIM_BEFORE =
  "A crafted Reactor Core is net negative: its output only raises the power budget (no install gate or penalty before EM-2 / EM-3, the hull's own output covers every loadout), and its mass drags speed and fuel (B10)";
const OWNER_BEFORE = "E-MOD EM-4 (unused reactor power speeds the drive, P3)";

// Re-owned (EM-4 review): the reactor wear consumer row stays pending on gear wear step 4; its owner text now names the
// drive lift as a reader too.
export const EM4_REOWNED_ID = "wear:WEAR_EFFICIENCY:reactorCore:powerOutput";
const REOWNED_OWNER_BEFORE = "the reactor's power output is read only by the install gate (pristine, design 4.3) and the combat power budget";
const REOWNED_OWNER_NOW = "the reactor's power output is read by the install gate (pristine, design 4.3), the combat power budget and the reactor surplus drive lift (pristine for now, an open call)";

export function em4ReadBack<T extends Pick<WiringEntry, "id">>(entries: readonly T[]): T[] {
  return entries
    .filter((e) => !EM4_ADDED_ENTRY_IDS.has(e.id))
    .map((e) => {
      if (e.id === EM4_REOWNED_ID) {
        const st = (e as unknown as WiringEntry).status;
        if (st.kind !== "pending") return e;
        return { ...e, status: { ...st, owner: st.owner.replace(REOWNED_OWNER_NOW, REOWNED_OWNER_BEFORE) } } as unknown as T;
      }
      if (e.id !== EM4_FLIPPED_ID) return e;
      // The row as it stood: the registry's entry defaults (no probe, no contexts) with its pending status.
      const { probe: _probe, tolerance: _tolerance, ...rest } = e as unknown as WiringEntry;
      return { ...rest, claim: CLAIM_BEFORE, status: { kind: "pending", owner: OWNER_BEFORE }, contexts: [], direction: "up", curve: { kind: "linearAbsolute" } } as unknown as T;
    });
}
