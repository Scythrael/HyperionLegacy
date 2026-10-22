// Expedition Tiers G2-6 (the dispatch console's region picker and recall, docs/plans/2026-10-14-expedition-tiers-g2-plan.md
// G2-6): the wiring registry changes it makes, for the golden files that pin the registry (shortRangeGoldens.test.ts
// registryPin, emodGoldens.test.ts BEFORE_RX). Every pin there was taken before G2-6, so each holds these apart: the
// entries G2-6 ADDS are left out, and the entries it FLIPS pending -> live read back exactly as they stood (status,
// contexts, probe). TEST-ONLY.
//
// The flips are the rows G2-2 / G2-3 / G2-4 / G2-5 left to G2-6 that the pins still hashed: the telescope's reach rows
// (the FACILITIES rungs that move only the reach tier, and every SUBSPACE_TELESCOPE_LEVELS reach entry, which was PARTIAL
// at Ground Ops), the tier rows, the deeper voyage ladder, the blind launch path and ODDS_RISKY_BELOW. The G2-4 / G2-5
// audit rows it also flips (driveClassTierGate, frontierSensors, recall, resumableSystems) and R2-2's blankTiers are
// already held apart as additions (propulsionRecallGoldens.fixture.ts G2_4_ADDED_ENTRY_IDS, R2_2_ADDED_ENTRY_IDS).

import { SUBSPACE_TELESCOPE_LEVELS } from "./model";

// G2-6 adds the tier haul and tier body count rows (the G2-2 review note) and splits the future difficulty tiers out of
// the tier-dormant row (still pending on their own owner).
export const G2_6_ADDED_ENTRY_IDS: ReadonlySet<string> = new Set<string>(["away:audit:tierHaulMult", "expedition:audit:tierBodyCount", "away:audit:difficultyTiers"]);

const PICKER = "G2-6 (the region picker: G2-2 built every tier's candidates, the console offers Tier I until then)";

export interface RegistryRowBefore {
  status: { kind: "pending"; owner: string; contexts?: readonly string[] };
  contexts: readonly string[];
  probe: string | undefined;
}

const audit = (owner: string): RegistryRowBefore => ({ status: { kind: "pending", owner }, contexts: [], probe: undefined });

export const G2_6_FLIPPED_BEFORE: Readonly<Record<string, RegistryRowBefore>> = {
  "expedition:audit:voyageDeepTiers": audit(PICKER),
  "away:audit:tierDormant": audit(`${PICKER}, SF-3`),
  "expedition:audit:blindLaunch": audit(PICKER),
  "expedition:audit:oddsRiskyBelow": audit(PICKER),
  // The telescope rungs that move only the reach tier (levels 2, 4, 6 and 8): no probe, no context.
  ...Object.fromEntries([1, 3, 5, 7].map((i) => [`facility:FACILITIES:subspaceTelescope:${i}`, audit(PICKER)])),
  // Every telescope level's reach entry: live on the card (facility), pending at Ground Ops.
  ...Object.fromEntries(
    SUBSPACE_TELESCOPE_LEVELS.map((row) => [
      `facility:SUBSPACE_TELESCOPE_LEVELS:${row.level}:reachTier`,
      { status: { kind: "pending", owner: PICKER, contexts: ["expedition:groundOps"] }, contexts: ["facility"], probe: "telescopeReach" } satisfies RegistryRowBefore,
    ]),
  ),
};
