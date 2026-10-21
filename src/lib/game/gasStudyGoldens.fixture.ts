// Gas Giant Study GG-1 (plan docs/plans/2026-10-17-gas-giant-study-plan.md section 4 GG-1): the wiring registry entries
// GG-1 ADDS, for the golden files that pin the registry (shortRangeGoldens.test.ts registryPin, emodGoldens.test.ts
// rowsBack). TEST-ONLY (imported by *.test.ts files only).
//
// GG-1 adds entries and changes none: the study's engine uses (GAS_STUDY_USES), every effect field of every giant class
// and nebula kind (all pending on GG-2 to GG-4), the six canisters' sell values (live), the nine research data reserves
// (pending GG-5) and the Deuterium Canister's Refinery recipe (live). The ids are read off the registry by their
// sources, so a pin with them left out reproduces the pin from before GG-1, and gasGiantContent.test.ts pins the list
// itself (ids and statuses) so a stray entry cannot hide in it.

import { WIRING_REGISTRY } from "./wiring/registry";
import { gasStudyItemIds } from "./gasGiantContent";

const GG1_CATALOGS: ReadonlySet<string> = new Set(["GAS_STUDY_USES", "GIANT_CLASSES", "NEBULA_KINDS"]);
const GG1_ITEMS: ReadonlySet<string> = new Set(gasStudyItemIds());
export const GG1_RECIPE = "refineDeuteriumCanister";

export const GG1_ADDED_ENTRY_IDS: ReadonlySet<string> = new Set(
  WIRING_REGISTRY.filter(
    (e) =>
      GG1_CATALOGS.has(e.source.catalog) ||
      (e.source.catalog === "ITEMS" && GG1_ITEMS.has(e.source.key.split(":")[0])) ||
      (e.source.catalog === "REFINE_RECIPES" && e.source.key === GG1_RECIPE),
  ).map((e) => e.id),
);
