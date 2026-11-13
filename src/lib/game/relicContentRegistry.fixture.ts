// Relics v2 R2-6 / R2-7 (the content slices, 2026-11-13): the wiring registry READ-BACK the registry golden chains apply,
// since their pins were taken before them (the ocf14ReadBack precedent). TEST-ONLY.
//
// The content slices change the registry by FLIPPING three rows, each with its own probe:
//   - relic:audit:blankCulture        pending (R2-6) -> live, probe content:relic:cultureReveal, a reworded claim;
//   - relic:audit:identifyQueue       pending (R2-7) -> live, probe content:relic:queue;
//   - facility:DATA_STUDY_SEAM:cultureStudyPoint   seam (R2-6) -> live, probe content:dataStudy:cultureReveal, a new note.
// R2-5 renamed the exceptional sets and pieces (their rows' claims read the labels). relicContentReadBack puts each row
// back exactly as it stood. Apply it innermost.

import type { WiringEntry } from "./wiring/registry";
import { tierNumeral } from "./galaxy";

type Shape = Pick<WiringEntry, "status" | "probe" | "contexts" | "direction" | "curve" | "note" | "claim">;

const UNPROBED: Partial<Shape> = { probe: undefined, contexts: [], direction: "up", curve: { kind: "linearAbsolute" } };

export const RELIC_CONTENT_BEFORE: Readonly<Record<string, Partial<Shape>>> = {
  "relic:audit:blankCulture": {
    ...UNPROBED,
    status: { kind: "pending", owner: "Relics v2 R2-6 (cultures: study points and the name reveal)" },
    claim: "A blank's culture (cultureForBody, stamped on every new run's relic): the culture study reads it",
  },
  "relic:audit:identifyQueue": {
    ...UNPROBED,
    status: { kind: "pending", owner: "Relics v2 R2-7 (the Identification tab: feed, queue, reorder; the engine queue is built and tested)" },
  },
  "facility:DATA_STUDY_SEAM:cultureStudyPoint": {
    ...UNPROBED,
    status: {
      kind: "seam",
      owner: "Relics v2 R2-6 (culture naming reads the study points)",
      userRef: 'relics v2 call 9 (2026-10-19, "Tied to source planet"): +1 study point per identified find plus 15b ancient data; named at 10',
    },
    note: "dataStudy.ts feedCultureData writes the point; nothing reads it until culture names are signed off (R2-8)",
  },
};

// R2-5 also renamed every exceptional set and piece, and the EXCEPTIONAL_SETS rows' claims read the labels: the claim
// goes back to the R2-1 placeholder ("[PROPOSAL] Tier II Set A piece 3: transitSpeed", "[PROPOSAL] Tier II Exceptional
// Set A full set: relicFindChance"), the rest of the row unchanged.
function placeholderClaim(e: WiringEntry): string | null {
  const m = /^relic:EXCEPTIONAL_SETS:exc-t(\d)-([a-z]):(?:exc-t\d-[a-z]-p(\d)|full)$/.exec(e.id);
  if (!m) return null;
  const head = `[PROPOSAL] Tier ${tierNumeral(Number(m[1]))}`;
  const letter = m[2].toUpperCase();
  const tail = e.claim.slice(e.claim.lastIndexOf(":"));
  return m[3] !== undefined ? `${head} Set ${letter} piece ${m[3]}${tail}` : `${head} Exceptional Set ${letter} full set${tail}`;
}

export function relicContentReadBack(entries: readonly WiringEntry[]): WiringEntry[] {
  return entries.map((e) => {
    const old = placeholderClaim(e);
    // The piece rows' note named the sign-off sheet before it came (R2-5 rewrote it).
    const pieceNote = old !== null && !e.id.endsWith(":full") ? { note: "the piece held alone (no set completes); names and values await the R2-5 content sheet" } : {};
    const base = old !== null ? ({ ...e, claim: old, ...pieceNote } as WiringEntry) : e;
    return RELIC_CONTENT_BEFORE[e.id] ? ({ ...base, ...RELIC_CONTENT_BEFORE[e.id] } as WiringEntry) : base;
  });
}
