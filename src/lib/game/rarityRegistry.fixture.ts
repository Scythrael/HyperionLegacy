// TEST-ONLY: the wiring registry entries the rarity readiness slices ADD (docs/plans/2026-10-23-rarity-readiness-plan.md),
// after every registry snapshot pin was taken, so each pin holds them apart (the RX_ADDED_ENTRY_IDS precedent,
// reactorFuelGoldens.fixture.ts). rarityProfiles.test.ts pins the added entries themselves.
//   RR-3: one entry per RARITY_PROFILES row.
//   RR-4: one entry per ASCENSION_BUDGET_MULT row.
//   RR-5: one entry per LUMINOUS_AFFIXES row.
//   Review of RR-3 / RR-4: the MODULE_RARITY_FACTOR rows, the two ascension module rows and one pending audit row.
// Never imported by app code.

import { WIRING_REGISTRY } from "./wiring/registry";

export const RR_CATALOGS: ReadonlySet<string> = new Set(["RARITY_PROFILES", "ASCENSION_BUDGET_MULT", "LUMINOUS_AFFIXES", "MODULE_RARITY_FACTOR"]);

const RR_AUDIT_IDS: ReadonlySet<string> = new Set(["ship:audit:rrCrewModuleExtras"]);

export const RR_ADDED_ENTRY_IDS: ReadonlySet<string> = new Set(
  WIRING_REGISTRY.filter((e) => RR_CATALOGS.has(e.source.catalog) || RR_AUDIT_IDS.has(e.id)).map((e) => e.id),
);
