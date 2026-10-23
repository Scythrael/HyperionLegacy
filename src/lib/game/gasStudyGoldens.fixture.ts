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
import { GAS_STUDY_USES, gasStudyItemIds, type GasStudyUse } from "./gasGiantContent";

const GG1_CATALOGS: ReadonlySet<string> = new Set(["GAS_STUDY_USES", "GIANT_CLASSES", "NEBULA_KINDS"]);
const GG1_ITEMS: ReadonlySet<string> = new Set(gasStudyItemIds());
export const GG1_RECIPE = "refineDeuteriumCanister";

export const GG1_ADDED_ENTRY_IDS: ReadonlySet<string> = new Set(
  WIRING_REGISTRY.filter(
    (e) =>
      GG1_CATALOGS.has(e.source.catalog) ||
      (e.source.catalog === "ITEMS" && GG1_ITEMS.has(e.source.key.split(":")[0])) ||
      // GG-5: the nine research data reserve rows keep their ids (and places) but now name the lane's consumer.
      isGg5ConsumeRow(e) ||
      (e.source.catalog === "REFINE_RECIPES" && e.source.key === GG1_RECIPE),
  ).map((e) => e.id),
);

// GG-5 (the Research Lab's data study lane) dropped the nine research data reserves and flipped their rows live in
// place; these were their owners (the ITEMS `reserved` markers GG-1 wrote).
const GG5_DATA_STUDY_BEFORE = "GG-5 (the Research Lab study lane studies it into a +12% boost on the next project of its family)";
const GG5_ANCIENT_STUDY_BEFORE = "GG-5 (the Research Lab study lane decodes the next ancient entry from it)";
function isGg5ConsumeRow(e: (typeof WIRING_REGISTRY)[number]): boolean {
  return e.source.catalog === "DATA_STUDY" && e.source.key.startsWith("consume:");
}

// Gas Giant Study GG-2 / GG-3 (the engine slices): entries that FLIP pending -> live, never added or removed. Each id
// maps to the status it had before (every one was pending, with no live context and no probe), so a registry pin taken
// before GG-2 reads them back and keeps proving nothing else moved. The ids are read off the registry: the gas giant's
// orbitalOnly row (GG-2 took it live) and every GG-1 study entry a built slice has taken live since (each with the
// owner GG-1 gave it).
const GG1_CLASS_FIELD_OWNER: Readonly<Record<string, GasStudyUse>> = {
  weight: "classRoll",
  massMinMilliJ: "classRoll",
  massMaxMilliJ: "classRoll",
  radiusModel: "probeDive",
  inflation: "probeDive",
  bandOdds: "studyReward",
  itemWeights: "studyReward",
};
const GG1_KIND_FIELD_OWNER: Readonly<Record<string, GasStudyUse>> = { bandOdds: "nebulaSweep", itemWeights: "nebulaSweep" };
export const ORBITAL_ONLY_ENTRY_ID = "expedition:PLANET_TYPES:gasGiant:orbitalOnly";
const ORBITAL_ONLY_BEFORE = "gas giant study 15b + OC-G2 (teams land and fight there, B21)";

function ggBeforeOwner(e: (typeof WIRING_REGISTRY)[number]): string | null {
  if (e.id === ORBITAL_ONLY_ENTRY_ID) return ORBITAL_ONLY_BEFORE;
  if (e.source.catalog === "GAS_STUDY_USES") return GAS_STUDY_USES[e.source.key as GasStudyUse] ?? null;
  if (isGg5ConsumeRow(e)) return e.source.key === "consume:ancientDataFragment" ? GG5_ANCIENT_STUDY_BEFORE : GG5_DATA_STUDY_BEFORE;
  const field = e.source.key.split(":")[1];
  if (e.source.catalog === "GIANT_CLASSES" && GG1_CLASS_FIELD_OWNER[field]) return GAS_STUDY_USES[GG1_CLASS_FIELD_OWNER[field]];
  if (e.source.catalog === "NEBULA_KINDS" && GG1_KIND_FIELD_OWNER[field]) return GAS_STUDY_USES[GG1_KIND_FIELD_OWNER[field]];
  return null;
}

// The entries the engine slices ADD (GG-3: the probe dive seam; GG-5: the lab lane's boosts, recipe chance, decode and
// decode gate seam), left out by every pin taken before them.
export const GG_STUDY_ADDED_ENTRY_IDS: ReadonlySet<string> = new Set(
  WIRING_REGISTRY.filter(
    (e) => e.source.catalog === "GAS_STUDY_SEAM" || e.source.catalog === "DATA_STUDY_SEAM" || (e.source.catalog === "DATA_STUDY" && !isGg5ConsumeRow(e)),
  ).map((e) => e.id),
);

export const GG_STUDY_FLIPPED_BEFORE: ReadonlyMap<string, { kind: "pending"; owner: string }> = new Map(
  WIRING_REGISTRY.flatMap((e) => {
    if (e.status.kind !== "live") return [];
    const owner = ggBeforeOwner(e);
    return owner === null ? [] : [[e.id, { kind: "pending" as const, owner }] as const];
  }),
);
