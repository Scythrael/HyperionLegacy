// Safe first runs SF-7 (the close-out): the wiring registry READ-BACK the registry golden chains apply, since their pins
// were taken before it (the cp5ReadBack / em8ReadBack precedent). TEST-ONLY.
//
// SF-7 changes the registry one way (wiring/registry.ts):
//   deferred : away:audit:difficultyTiers (pending "SF-3 follow-up ...") is deferred on the user's own words (objective
//              affixes capture 2026-10-14: the hooks built, the higher difficulty tiers not), so no SF entry is pending.
// sf7ReadBack puts the row's status back as it stood, so a pin taken before SF-7 is reproduced exactly.

import type { WiringEntry } from "./wiring/registry";

export const SF7_DEFERRED_ID = "away:audit:difficultyTiers";
export const SF7_BEFORE = {
  status: { kind: "pending", owner: "SF-3 follow-up (the future difficulty tiers: nothing designed; objective affixes capture 2026-10-14)" },
} as const;

export function sf7ReadBack(entries: readonly WiringEntry[]): WiringEntry[] {
  return entries.map((e) => (e.id === SF7_DEFERRED_ID ? ({ ...e, status: { ...SF7_BEFORE.status } } as unknown as WiringEntry) : e));
}
