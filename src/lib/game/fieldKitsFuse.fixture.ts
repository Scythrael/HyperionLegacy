// Timed grenades (user 2026-10-21): the wiring registry entries the fuse ADDS, for the golden files that pin the
// registry (shortRangeGoldens.test.ts registryPin, emodGoldens.test.ts rowsBack). TEST-ONLY (imported by *.test.ts files
// only).
//
// The fuse adds entries and changes none: each grenade's `fuse` (the turns from the throw to the blast: 1 for the Stun
// and Toxin Grenades, 0 for the Impact Grenade) and `movedClear` (the moved-clear chance on a timed one; not applicable
// on the Impact Grenade). So a pin with them left out reproduces the pin from before the fuse, and
// fieldKitsFuse.test.ts pins the list itself (ids and statuses) so a stray entry cannot hide in it.

import { GRENADE_IDS } from "./fieldKitsGrenades";

export const FUSE_ADDED_ENTRY_IDS: ReadonlySet<string> = new Set(GRENADE_IDS.flatMap((k) => [`away:GRENADES:${k}:fuse`, `away:GRENADES:${k}:movedClear`]));
