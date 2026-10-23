// ============================================================================
// rarityProfiles.ts: RARITY READINESS RR-3 (docs/plans/2026-10-23-rarity-readiness-plan.md; user answers 5 and 6).
//
// ONE tunable row per rarity band: the budget multiplier, the affix count and its extra-affix chance, the secondary
// lines and the Artisan chance. The three generators (itemgen.ts generateEquipment / generateWeapon / generateDronePod)
// and the craft preview read this table instead of the old `RARITY_MULT ** rarityIndex` budget and the hand-written
// affixCount switch.
//
// LIVE TIERS ARE BIT-IDENTICAL (answer 5, "live tiers stay exactly as they are"): the Derelict to Radiant rows are
// DERIVED from today's constants (`RARITY_MULT ** rarityIndex(band)`, the same double the old budget computed) and
// carry today's affix counts, extra chance and zero secondaries (answer 6, "Legendary and up only"). The RR-0 LIVE
// goldens pin it.
//
// THE LEGENDARY ROWS (answer 5, "legendaries start at the design's +20% over Radiant"; design 2026-07-17 :160-164):
// Luminous and Constellar take Radiant's budget times LEGENDARY_BUDGET_STEP, keep 3 affixes, and roll secondaries (2
// on Luminous; 1 on Constellar, whose second is replaced by its set bonus) and the Artisan chance. Nothing produces
// them except the Debug minter (answer 4).
//
// Leaf module: imports model.ts only (never itemgen.ts), so itemgen can import it with no cycle.
// ============================================================================

import { LEGENDARY_BUDGET_STEP, isEquipmentRarity, rarityIndex, type EquipmentRarity } from "./model";
// LEGENDARY_BUDGET_STEP moved to model.ts (review of RR-3: the module effect scale reads it there too); re-exported.
export { LEGENDARY_BUDGET_STEP };

// Compounding budget multiplier per base-RARITY index (rarityIndex 0..4). At 1.15 each rarity step is a ~15% budget
// bump over the one below it. TUNABLE. (Moved here from itemgen.ts at RR-3, which re-exports it, so every importer
// keeps working; the value is unchanged.)
export const RARITY_MULT = 1.15;

// [PROVISIONAL] (answer 6; the design names secondaries but no size): what ONE secondary line is worth, as a fraction
// of the piece's whole budget, ADDED on top of it (a secondary is extra power, not a slice of the affix share).
export const SECONDARY_BUDGET_SHARE = 0.15;

// [PROVISIONAL] (design :163, "25% chance of the Artisan effect"): the Artisan chance, per mille (an integer draw).
export const ARTISAN_CHANCE_PERMILLE = 250;

// [PROVISIONAL] (design :163 "+50% min roll, +25% max roll on one random affix"): today's rolls have no min / max range
// (each affix line is an even share of the budget), so the effect is folded into ONE multiplier on one random affix
// line. Flagged for the user.
export const ARTISAN_LINE_MULT = 1.25;

// The salt of a legendary piece's private extras stream (secondaries, Artisan). Odd, 32-bit, registered in
// salts.test.ts. The stream is seeded from ONE draw on the mint's shared stream, taken only by a band whose row has
// extras, AFTER the affix picks, so every live band draws exactly what it drew before.
export const RARITY_EXTRAS_SALT = 0x3e5a9c71;

export interface RarityProfile {
  readonly budgetMult: number; // multiplies the iLevel x PER_LEVEL_BUDGET x QUALITY_MULT^quality backbone
  readonly affixes: number; // affix lines rolled (on top of the implicit line)
  readonly extraAffixChance: number; // chance of one more affix (ONE shared-stream draw when > 0; Augmented only)
  readonly secondaries: number; // extra lines on the private extras stream (legendary only, answer 6)
  readonly artisanPermille: number; // the Artisan chance per mille, on the private extras stream (legendary only)
  // RR-5 (answer 1): the band rolls ONE Luminous legendary affix (legendaryAffixes.ts) on the private extras stream.
  readonly legendaryAffix: boolean;
}

// A live band's budget multiplier: exactly the double the pre-RR-3 budget computed (RARITY_MULT ** rarityIndex).
const liveMult = (band: EquipmentRarity): number => RARITY_MULT ** rarityIndex(band);
const LEGENDARY_MULT = RARITY_MULT ** rarityIndex("radiant") * LEGENDARY_BUDGET_STEP;

// The table. TOTAL over the ladder, so a new band is a compile error here until it is answered for.
export const RARITY_PROFILES: Readonly<Record<EquipmentRarity, RarityProfile>> = {
  // RR-7 (answer 9): Derelict is the Standard-Issue floor: Standard's budget, no affixes (a floor piece rolls none).
  derelict: { budgetMult: liveMult("standard"), affixes: 0, extraAffixChance: 0, secondaries: 0, artisanPermille: 0, legendaryAffix: false },
  standard: { budgetMult: liveMult("standard"), affixes: 2, extraAffixChance: 0, secondaries: 0, artisanPermille: 0, legendaryAffix: false },
  augmented: { budgetMult: liveMult("augmented"), affixes: 2, extraAffixChance: 0.25, secondaries: 0, artisanPermille: 0, legendaryAffix: false },
  stellar: { budgetMult: liveMult("stellar"), affixes: 3, extraAffixChance: 0, secondaries: 0, artisanPermille: 0, legendaryAffix: false },
  radiant: { budgetMult: liveMult("radiant"), affixes: 3, extraAffixChance: 0, secondaries: 0, artisanPermille: 0, legendaryAffix: false },
  luminous: { budgetMult: LEGENDARY_MULT, affixes: 3, extraAffixChance: 0, secondaries: 2, artisanPermille: ARTISAN_CHANCE_PERMILLE, legendaryAffix: true },
  constellar: { budgetMult: LEGENDARY_MULT, affixes: 3, extraAffixChance: 0, secondaries: 1, artisanPermille: ARTISAN_CHANCE_PERMILLE, legendaryAffix: false },
};

// A band's row. Total: an unknown value reads the Standard row (RR-1, the Standard-Issue floor). Pure.
export function rarityProfile(rarity: EquipmentRarity): RarityProfile {
  return isEquipmentRarity(rarity) ? RARITY_PROFILES[rarity] : RARITY_PROFILES.standard;
}
