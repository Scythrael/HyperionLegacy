// ============================================================================
// legendaryAffixes.ts: RARITY READINESS RR-5 (docs/plans/2026-10-23-rarity-readiness-plan.md; user answer 1, "As
// designed": "Luminous carries a unique legendary affix", epic design 2026-07-17 :145 and :163).
//
// The Luminous LEGENDARY AFFIX catalog: one build-defining line per slot family. A Luminous mint (and a Nova or
// Celestial Luminous) draws exactly ONE row for its slot on its private extras stream (itemgen.ts rollRarityExtras),
// stamps the row's id on the piece (EquipmentInstance.legendaryAffixId, display and identity) and ADDS the row's value
// into rolledStats under the row's stat key, an EXISTING fold key, so it acts through today's folds with no new
// consumer (the wiring registry measures each row on its fold, wiring/registry.ts legendaryAffixEntries).
// Constellar carries none (its identity is the set bonus, RR-6); no live band carries one.
//
// NOT BUILT (a [PROPOSAL] the user has not approved): any limit on how many pieces with the same legendary affix one
// ship or member may wear. One legendary affix per PIECE is the only rule.
//
// Every NAME below is a [PROPOSAL] awaiting the user's list; every number a [PROVISIONAL] first pass.
//
// Leaf: imports model.ts types only, so itemgen.ts can import it with no cycle.
// ============================================================================

import type { EquipmentSlotType } from "./model";

// [PROVISIONAL]: a legendary affix line is worth this fraction of the piece's whole budget, ADDED on top of it (like a
// secondary, but larger: the line that defines the piece).
export const LEGENDARY_AFFIX_BUDGET_SHARE = 0.25;

export interface LegendaryAffixDef {
  readonly id: string; // stable id, stamped on the piece (legendaryAffixId)
  readonly label: string; // [PROPOSAL] display name
  readonly slotTypes: readonly EquipmentSlotType[]; // the slot family it rolls on
  readonly stat: string; // an EXISTING fold key the slot already rolls (validated in legendaryAffixes.test.ts)
  readonly budgetShare: number; // the line's share of the piece's budget
}

// The catalog. ONE row per slot family for v1 (the slot's draw is uniform over its rows, so more rows per family later
// is content only).
export const LUMINOUS_AFFIXES: readonly LegendaryAffixDef[] = [
  { id: "starfallLance", label: "Starfall Lance", slotTypes: ["weapon"], stat: "weaponYield", budgetShare: LEGENDARY_AFFIX_BUDGET_SHARE },
  { id: "hivemindRelay", label: "Hivemind Relay", slotTypes: ["droneBay"], stat: "droneHp", budgetShare: LEGENDARY_AFFIX_BUDGET_SHARE },
  { id: "aegisLattice", label: "Aegis Lattice", slotTypes: ["shieldEmitters"], stat: "shieldCapacity", budgetShare: LEGENDARY_AFFIX_BUDGET_SHARE },
  { id: "bulwarkOfSol", label: "Bulwark of Sol", slotTypes: ["hullPlating"], stat: "hullStrength", budgetShare: LEGENDARY_AFFIX_BUDGET_SHARE },
  { id: "bottomlessHold", label: "Bottomless Hold", slotTypes: ["cargoBay"], stat: "cargoCapacity", budgetShare: LEGENDARY_AFFIX_BUDGET_SHARE },
  // The user is choosing between this and the plan's "Fold Engine" (transitSpeedMult, live on the sheet and in
  // expeditions). The swap is this ONE line: { id: "foldEngine", label: "Fold Engine", ..., stat: "transitSpeedMult" }
  // (the registry already measures a transitSpeedMult row; legendaryAffixes.test.ts proves it).
  { id: "endlessWake", label: "Endless Wake", slotTypes: ["ftlDrive"], stat: "fuelCapacity", budgetShare: LEGENDARY_AFFIX_BUDGET_SHARE },
  { id: "heartOfAStar", label: "Heart of a Star", slotTypes: ["reactorCore"], stat: "powerOutput", budgetShare: LEGENDARY_AFFIX_BUDGET_SHARE },
  // Review of RR-5: the sensors line IS live (equipmentStatMods folds it into the ship's sensors: survey yield, the
  // expedition sensor gate, region charting, scan events, short-range jobs).
  { id: "farWatcher", label: "Far Watcher", slotTypes: ["sensor"], stat: "sensors", budgetShare: LEGENDARY_AFFIX_BUDGET_SHARE },
  // A Spec Utility line every variety's piece is read on (materialQuality.ts), unlike the suite-only scan / hazard lines.
  { id: "transmutersSeal", label: "Transmuter's Seal", slotTypes: ["specUtility"], stat: "materialQualityChance", budgetShare: LEGENDARY_AFFIX_BUDGET_SHARE },
  { id: "grandConcourse", label: "Grand Concourse", slotTypes: ["quarters"], stat: "colonistCapacity", budgetShare: LEGENDARY_AFFIX_BUDGET_SHARE },
  { id: "oathkeeper", label: "Oathkeeper", slotTypes: ["memberWeapon"], stat: "groundPower", budgetShare: LEGENDARY_AFFIX_BUDGET_SHARE },
  { id: "lastStandWeave", label: "Last Stand Weave", slotTypes: ["memberArmor"], stat: "groundArmor", budgetShare: LEGENDARY_AFFIX_BUDGET_SHARE },
  { id: "mastersTouch", label: "Master's Touch", slotTypes: ["memberTool"], stat: "groundRelicFind", budgetShare: LEGENDARY_AFFIX_BUDGET_SHARE },
  { id: "secondSight", label: "Second Sight", slotTypes: ["implant"], stat: "groundHp", budgetShare: LEGENDARY_AFFIX_BUDGET_SHARE },
];

// The slot families with NO legendary affix in v1, each with why (no inert line: the user's "everything wired" rule).
export const LEGENDARY_AFFIX_EXCLUDED: Readonly<Partial<Record<EquipmentSlotType, string>>> = {
  bridge: "a bridge module's power is its catalog effect (crewModules.ts, scaled by rarity); its only rolled stat line (crewEfficiency) is read by nothing yet (WR-7, OC-D3)",
  module: "a universal module's power is its catalog effect (shipModules.ts); the module roster lands in EM-7",
};

// The rows a piece of this slot can draw, in catalog order. Pure.
export function legendaryAffixesFor(slotType: EquipmentSlotType): readonly LegendaryAffixDef[] {
  return LUMINOUS_AFFIXES.filter((d) => d.slotTypes.includes(slotType));
}

// A row by id (a piece's stamped legendaryAffixId), or undefined for an unknown id. Pure.
export function legendaryAffixDef(id: string | undefined): LegendaryAffixDef | undefined {
  return id === undefined ? undefined : LUMINOUS_AFFIXES.find((d) => d.id === id);
}
