// Expedition Tiers G2-9 close-out (docs/plans/2026-10-14-expedition-tiers-g2-plan.md, "G2-9 close-out review"): the
// wiring registry READ-BACK the registry golden chains apply, since their pins were taken before it (the ocg1ReadBack
// precedent). TEST-ONLY.
//
// G2-9 changes the registry by ADDING one row and by NARROWING one claim:
//   added   : expedition:audit:enemyTerritory (enemy territory's own row, probed by consoleCombatGrade: the same
//             candidate inside vs outside its tier's sector rolls one Combat grade higher);
//   claim   : away:audit:tierDormant no longer claims enemy territory (its probe reads only the tier).
// g29ReadBack leaves the added row out and puts the claim back exactly as it stood. Apply it innermost.

import type { WiringEntry } from "./wiring/registry";

export const G2_9_ADDED_ENTRY_IDS: ReadonlySet<string> = new Set<string>(["expedition:audit:enemyTerritory"]);

export const G2_9_BEFORE: Readonly<Record<string, Partial<Pick<WiringEntry, "claim">>>> = {
  "away:audit:tierDormant": {
    claim: "The tier rows a deeper launch reads: RISK_TIER_ODDS II to VII, enemy territory (the homeworld's fixed sectors), hostile sites, SCIENCE_HEAVY, affix rows above Tier I, the deeper famous systems",
  },
};

export function g29ReadBack(entries: readonly WiringEntry[]): WiringEntry[] {
  return entries.filter((e) => !G2_9_ADDED_ENTRY_IDS.has(e.id)).map((e) => (G2_9_BEFORE[e.id] ? ({ ...e, ...G2_9_BEFORE[e.id] } as WiringEntry) : e));
}
