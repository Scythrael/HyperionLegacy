// Quartermaster Standard-Issue member gear and the D26 line swap (0.14.0): the wiring registry READ-BACK every
// registry golden chain applies, since all of their pins were taken before this change. TEST-ONLY.
//
// The change only ADDS and RETIRES entries (no existing entry's status, contexts or probe moves):
//   - added: every `si:` entry (the Standard-Issue lines), and the three Science lines the swap brings
//     (SI_SCIENCE_ADDED_IDS);
//   - retired: the nine combat lines the Sidearm, Field Suit and Hazard Suit no longer roll (seven pending under the
//     old SCIENCE_LINE_SWAP owner, the Hazard Suit's two Prospecting ARM / HP lines deferred), each restored at its old
//     place (after the entry it followed) with its old row.
// siReadBack applies both, so a pin taken before the change is reproduced exactly.

import type { WiringEntry } from "./wiring/registry";

export const SI_SCIENCE_ADDED_IDS: ReadonlySet<string> = new Set([
  "gear:science:sidearm:groundRelicFind",
  "gear:science:sidearm:groundFieldwork",
  "gear:science:fieldSuit:groundHazardResist",
]);

export const isSiAdded = (id: string): boolean => id.startsWith("si:") || SI_SCIENCE_ADDED_IDS.has(id);

const SWAP_OWNER = "Science gear line swap (D26): Science gear rolls fieldwork/hazard/find lines instead";
const swapPending = { kind: "pending", owner: SWAP_OWNER, contexts: ["ground"] } as const;
const prospectingDeferred = {
  kind: "deferred",
  owner: "prospecting quests patch",
  userRef: "safe-first-runs plan, user answers group 4 (2026-10-16): build Prospecting fully but hidden",
} as const;

// [id, status, contexts, probe], each after the entry it followed, in registry order.
export type RetiredRow = readonly [string, WiringEntry["status"], readonly string[], string | null];
export const SI_RETIRED: readonly { readonly after: string; readonly row: RetiredRow }[] = [
  { after: "gear:security:assaultHardsuit:groundHazardResist", row: ["gear:science:fieldSuit:groundHp", swapPending, [], "sciCombatPower"] },
  { after: "gear:science:fieldSuit:groundHp", row: ["gear:science:fieldSuit:groundArmor", swapPending, [], "sciCombatPower"] },
  { after: "gear:science:fieldSuit:groundFieldwork", row: ["gear:science:hazardSuit:groundHp", swapPending, [], "sciCombatPower"] },
  { after: "gear:science:hazardSuit:groundHp", row: ["gear:science:hazardSuit:groundArmor", swapPending, [], "sciCombatPower"] },
  { after: "gear:science:hazardSuit:groundHazardResist", row: ["gear:prospecting:hazardSuit:groundHp", prospectingDeferred, [], null] },
  { after: "gear:prospecting:hazardSuit:groundHp", row: ["gear:prospecting:hazardSuit:groundArmor", prospectingDeferred, [], null] },
  { after: "gear:security:shockBaton:groundStatusChance", row: ["gear:science:sidearm:groundPower", swapPending, [], "sciCombatPower"] },
  { after: "gear:science:sidearm:groundPower", row: ["gear:science:sidearm:groundAccuracy", swapPending, [], "sciCombatPower"] },
  { after: "gear:science:sidearm:groundAccuracy", row: ["gear:science:sidearm:groundStatusChance", swapPending, [], "sciCombatPower"] },
];

// `items` (registry-ordered, one per entry) as they stood before the change: the added entries left out and every
// retired row put back after the entry it followed (`make` builds an item from a retired row). Pure.
export function siReadBack<T>(items: readonly T[], idOf: (t: T) => string, make: (row: RetiredRow) => T): T[] {
  const out = items.filter((t) => !isSiAdded(idOf(t)));
  for (const { after, row } of SI_RETIRED) {
    const at = out.findIndex((t) => idOf(t) === after);
    if (at < 0) throw new Error(`siReadBack: no entry ${after} to restore ${row[0]} after`);
    out.splice(at + 1, 0, make(row));
  }
  return out;
}
