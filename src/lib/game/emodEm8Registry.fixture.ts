// TEST-ONLY (E-MOD EM-8): the slice's wiring registry move, read back so every earlier registry pin keeps proving its
// own slice was its only move (the em7ReadBack / wr9ReadBack precedent). EM-8 changes the registry in three ways:
//   added  : the Precursor Lens module's row (ship:UNIVERSAL_MODULES:precursorLens, live on the body-scan engine), its
//            blueprint's research row (facility:BLUEPRINTS:precursorLensBp) and the relic's first-find row
//            (relic:em8:precursorLensFirstFind, live on the researchable blueprints).
//   flipped: relic:RELICS:precursorLens, PARTIAL since E4d (its first find pending on E-MOD in the craft context), is
//            wholly live.
//   dropped: facility:ITEMS:precursorCircuit:reserved (pending on EM-8): the circuit has its consumer, so no reserve row
//            is built. It sat right before the first research-data reserve row (the ITEMS order).
// em8ReadBack removes the added rows, restores the flipped row's partial status and puts the dropped row back in place.
// Never imported by app code.

import type { WiringEntry } from "./wiring/registry";

export const EM8_ADDED_ENTRY_IDS: ReadonlySet<string> = new Set([
  "ship:UNIVERSAL_MODULES:precursorLens",
  "facility:BLUEPRINTS:precursorLensBp",
  "relic:em8:precursorLensFirstFind",
]);
export const EM8_RELIC_ROW = "relic:RELICS:precursorLens";
export const EM8_RELIC_STATUS_BEFORE = { kind: "pending", owner: "E-MOD (the first find unlocks a special module, deferred to E-MOD by decision)", contexts: ["craft"] } as const;
export const EM8_DROPPED_RESERVE_ID = "facility:ITEMS:precursorCircuit:reserved";
const EM8_RESERVE_OWNER_BEFORE = "EM-8 (the Precursor Lens special module is crafted with it)";
// The row the dropped reserve sat just before (the research data reserves follow it in ITEMS order, GG-5).
const EM8_RESERVE_SAT_BEFORE = "facility:ITEMS:propulsionData:reserved";

const droppedReserve = {
  id: EM8_DROPPED_RESERVE_ID,
  system: "facility",
  source: { catalog: "ITEMS", key: "precursorCircuit:reserved" },
  claim: "Precursor Circuit is produced and has a consumer",
  status: { kind: "pending", owner: EM8_RESERVE_OWNER_BEFORE },
  contexts: [],
  probe: undefined,
} as unknown as WiringEntry;

export function em8ReadBack(entries: readonly WiringEntry[]): WiringEntry[] {
  const out: WiringEntry[] = [];
  for (const e of entries) {
    if (EM8_ADDED_ENTRY_IDS.has(e.id)) continue;
    if (e.id === EM8_RESERVE_SAT_BEFORE) out.push(droppedReserve);
    out.push(e.id === EM8_RELIC_ROW ? ({ ...e, status: EM8_RELIC_STATUS_BEFORE } as unknown as WiringEntry) : e);
  }
  return out;
}
