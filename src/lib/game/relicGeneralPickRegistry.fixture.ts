// Relics v2 R2-3 follow-up (2026-11-13, the generalPick retirement): the wiring registry READ-BACK the registry golden
// chains apply, since their pins were taken before it (the wr13ReadBack precedent). TEST-ONLY.
//
// The follow-up changes the registry by REMOVING one row: relic:audit:generalPick (R2-2's general pick for a v1 study of
// a blank with no set, relicBlanks.ts identifyGeneralRelic). No study in real play reached it: every setless blank
// entered the vault after R2-3 stamped `v: 2` on every new study, so identification v2 (relic:audit:identifyV2) studies
// each one. generalPickReadBack puts the row back in its place (right after relic:audit:identifyQueue) exactly as it
// stood on 424f5089. Apply it innermost.

import type { WiringEntry } from "./wiring/registry";

export const GENERAL_PICK_ROW_ID = "relic:audit:generalPick";
const AFTER = "relic:audit:identifyQueue";
// A plain audit row of the same section (pending, no probe), the shape the removed row had.
const SIBLING = "relic:audit:completionBlank";

const BEFORE: Partial<WiringEntry> = {
  id: GENERAL_PICK_ROW_ID,
  system: "relic",
  source: { catalog: "AUDIT", key: GENERAL_PICK_ROW_ID },
  claim: "A blank with no set identifies over the general pool by band, with the site bias (identifyGeneralRelic)",
  status: {
    kind: "pending",
    owner:
      "Relics v2 R2-3 follow-up (retire the v1 setless branch of identifyStudiedRelic: identification v2, relic:audit:identifyV2, studies every new blank, G1-5's short-range blanks included, so no study reaches this pick)",
  } as WiringEntry["status"],
  probe: undefined,
  contexts: [],
  direction: "up",
  curve: { kind: "linearAbsolute" },
  note: undefined,
};

export function generalPickReadBack(entries: readonly WiringEntry[]): WiringEntry[] {
  const sibling = entries.find((e) => e.id === SIBLING);
  if (!sibling) throw new Error(`generalPickReadBack: sibling ${SIBLING} is missing`);
  const out: WiringEntry[] = [];
  for (const e of entries) {
    out.push(e);
    if (e.id === AFTER) out.push({ ...sibling, ...BEFORE } as WiringEntry);
  }
  return out;
}
