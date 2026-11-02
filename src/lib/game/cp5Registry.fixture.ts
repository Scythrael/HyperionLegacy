// Complement plan CP-5 (per-hull crew caps): the wiring registry READ-BACK the registry golden chains apply, since their
// pins were taken before it (the wr9ReadBack / em8ReadBack precedent). TEST-ONLY.
//
// CP-5 changes the registry two ways (wiring/registry.ts):
//   flipped : crew:audit:commandCaps (pending "CP-5, CP-7", no probe) is live, measured on the auto-crew fill
//             (probe autoCrewHeadcount: an Eir seats 150 more than an Orion), with its claim rewritten to the rule.
//   added   : the hull rows of the two new SHIP_TYPES fields, live on the same fill: ship:SHIP_TYPES:eir:complementCap
//             and ship:SHIP_TYPES:<hull>:complementDivisionWeights and :leanDivisions for the Battleship, Carrier, Aurora
//             and Eir.
// cp5ReadBack drops the added rows and puts the flipped row's claim, status, contexts and probe back as they stood, so a
// pin taken before CP-5 is reproduced exactly.

import { SHIP_TYPES, type ShipTypeKey } from "./model";
import type { WiringEntry } from "./wiring/registry";

export const CP5_FLIPPED_ID = "crew:audit:commandCaps";
export const CP5_BEFORE = {
  claim: "Command structure caps (passive ships only; not enforced on load)",
  status: { kind: "pending", owner: "CP-5, CP-7" },
  contexts: [] as string[],
  probe: undefined,
} as const;
export const CP5_ADDED_IDS: ReadonlySet<string> = new Set(
  (Object.keys(SHIP_TYPES) as ShipTypeKey[]).flatMap((h) => [
    ...(SHIP_TYPES[h].complementCap !== undefined ? [`ship:SHIP_TYPES:${h}:complementCap`] : []),
    ...(SHIP_TYPES[h].complementDivisionWeights !== undefined ? [`ship:SHIP_TYPES:${h}:complementDivisionWeights`] : []),
    ...(SHIP_TYPES[h].leanDivisions !== undefined ? [`ship:SHIP_TYPES:${h}:leanDivisions`] : []),
  ]),
);

export function cp5ReadBack(entries: readonly WiringEntry[]): WiringEntry[] {
  return entries
    .filter((e) => !CP5_ADDED_IDS.has(e.id))
    .map((e) => (e.id === CP5_FLIPPED_ID ? ({ ...e, ...CP5_BEFORE, contexts: [...CP5_BEFORE.contexts] } as unknown as WiringEntry) : e));
}
