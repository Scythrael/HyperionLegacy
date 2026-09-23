// Crew 0.14.0 (Phase 0.5): crew RARITY multipliers (pure data + pure readers).
//
// Rarity is a small MULTIPLICATIVE modifier on a crewmember's buff magnitude (NEVER additive):
// a 0.20 buff at stellar rolls to 0.20 * 1.35 = 0.27, not 5.20. Rarity is decoupled from rank
// (rank gates buff count). The crew GENERATOR caps at "stellar" (CREW_RARITY_CAP), even though the
// EquipmentRarity ladder continues to radiant/luminous/constellar; the full ladder is kept on the
// type so a future change could lift the cap without a data-model change.
//
// FIRST-PASS + TUNABLE numbers. Nothing here is wired into the tick or UI.
// See docs/plans/2026-09-22-crew-0.14.0-plan.md ("Buff count + magnitude model", Phase 0.5).

import type { EquipmentRarity } from "./model";
import { rarityIndex } from "./model";

// The highest rarity the crew generator ever mints. Wiring supports the full ladder; the generator
// stops here.
export const CREW_RARITY_CAP: EquipmentRarity = "stellar";

// Per-tier magnitude multiplier for the crew-usable band (derelict..stellar). Partial on purpose:
// tiers above the cap have no crew multiplier because the generator never produces them.
// FIRST-PASS: derelict 0.9, standard 1.0, augmented 1.15, stellar 1.35.
export const CREW_RARITY_MULTIPLIER: Partial<Record<EquipmentRarity, number>> = {
  derelict: 0.9,
  standard: 1.0,
  augmented: 1.15,
  stellar: 1.35,
};

// Clamp any rarity to the crew cap: anything at or above "stellar" on the ladder becomes "stellar".
// Used to validate/normalize a crew rarity before reading its multiplier (a defensive guard, since
// the generator already stops at the cap).
export function clampCrewRarity(rarity: EquipmentRarity): EquipmentRarity {
  return rarityIndex(rarity) > rarityIndex(CREW_RARITY_CAP) ? CREW_RARITY_CAP : rarity;
}

// The multiplicative magnitude modifier for a crew rarity. Clamps to the cap first, then reads the
// table; a standard (1.0) fallback keeps the reader total even if an out-of-band rarity slips in.
export function crewRarityMultiplier(rarity: EquipmentRarity): number {
  const clamped = clampCrewRarity(rarity);
  return CREW_RARITY_MULTIPLIER[clamped] ?? 1.0;
}
