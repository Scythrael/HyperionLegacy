// TEST-ONLY: Relics v2 R2-4's wiring registry move (wiring/registry.ts relicV2Entries and AUDIT_ROWS section H). R2-4
// came after every registry pin was taken, so each pin holds its move apart (the R2_2 / R2_3 / GG_STUDY precedents):
//   - ADDED: one relic:MUSEUM_V2_PER_COPY entry per tier above I and the relic:audit:softCap row;
//   - FLIPPED pending -> live: every relic:RELIC_TYPES and relic:EXCEPTIONAL_SETS entry (R2-1 registered them pending on
//     R2-4), read back here as they stood (pending on their R2-1 owner, no live context, no probe).
// relicsV2Museum.test.ts pins the move itself. Never imported by app code.

import { WIRING_REGISTRY } from "./wiring/registry";

export const R2_4_ADDED_ENTRY_IDS: ReadonlySet<string> = new Set<string>([
  ...WIRING_REGISTRY.filter((e) => e.source.catalog === "MUSEUM_V2_PER_COPY").map((e) => e.id),
  "relic:audit:softCap",
]);

// The owners R2-1 gave the dormant v2 catalog's entries (verbatim, as the pins captured them).
const R2_1_TYPES_OWNER = "Relics v2 R2-4 (museum math v2 sums each general type's stats per tier)";
const R2_1_EXCEPTIONAL_OWNER = "Relics v2 R2-4 + R2-5 (exceptional piece and full-set values; names await the content sign-off sheet)";

type PendingBefore = { kind: "pending"; owner: string };
export const R2_4_FLIPPED_BEFORE: ReadonlyMap<string, PendingBefore> = new Map(
  WIRING_REGISTRY.flatMap((e): [string, PendingBefore][] => {
    if (e.id.startsWith("relic:RELIC_TYPES:")) return [[e.id, { kind: "pending", owner: R2_1_TYPES_OWNER }]];
    if (e.id.startsWith("relic:EXCEPTIONAL_SETS:")) return [[e.id, { kind: "pending", owner: R2_1_EXCEPTIONAL_OWNER }]];
    return [];
  }),
);
