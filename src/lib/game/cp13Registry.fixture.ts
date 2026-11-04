// Complement CP-13 (the hull-family module bonuses): the wiring registry READ-BACK the registry golden chains apply,
// since their pins were taken before it (the cp12ReadBack precedent). TEST-ONLY.
//
// CP-13 changes the registry one way (wiring/registry.ts hullFamilyEntries): it ADDS a row per catalog line
// (ship:HULL_FAMILY_MODULE_BONUS:<family>:...) and one audit row (ship:audit:hullFamilyInjuriesOnly), all live. No row
// that existed before changes its id, status, probe, contexts, claim, curve or note (the quarters and module rarity rows
// moved only their fixture hull, which no pin reads). cp13ReadBack takes the added rows out; apply it innermost.

import { WIRING_REGISTRY, type WiringEntry } from "./wiring/registry";

const isCp13Row = (id: string): boolean => id.startsWith("ship:HULL_FAMILY_MODULE_BONUS:") || id === "ship:audit:hullFamilyInjuriesOnly";
export const CP13_ADDED_IDS: ReadonlySet<string> = new Set(WIRING_REGISTRY.map((e) => e.id).filter(isCp13Row));

export function cp13ReadBack(entries: readonly WiringEntry[]): WiringEntry[] {
  return entries.filter((e) => !isCp13Row(e.id));
}
