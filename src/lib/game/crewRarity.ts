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

// RARITY READINESS RR-7 (answer 7, "Yes, same for both"): the [PROVISIONAL] multiplier the legendary crew bands share.
export const CREW_LEGENDARY_MULTIPLIER = 1.8;

// Per-tier magnitude multiplier for EVERY band (RR-7: a TOTAL record, so a new band is a compile error here). The crew
// generator still stops at the cap (CREW_RARITY_CAP stays Stellar until the user raises it), so the rows above it act
// the moment the cap is raised and never before; they exist so raising the cap can never make a higher band weaker
// (the pre-RR-7 table had no row above Stellar, so a raised cap would have read the 1.0 fallback).
// FIRST-PASS: derelict 0.9, standard 1.0, augmented 1.15, stellar 1.35; [PROVISIONAL] radiant 1.55, luminous and
// constellar CREW_LEGENDARY_MULTIPLIER (one shared value).
export const CREW_RARITY_MULTIPLIER: Readonly<Record<EquipmentRarity, number>> = {
  derelict: 0.9,
  standard: 1.0,
  augmented: 1.15,
  stellar: 1.35,
  radiant: 1.55,
  luminous: CREW_LEGENDARY_MULTIPLIER,
  constellar: CREW_LEGENDARY_MULTIPLIER,
};

// Clamp any rarity to the crew cap: anything at or above "stellar" on the ladder becomes "stellar".
// Used to validate/normalize a crew rarity before reading its multiplier (a defensive guard, since
// the generator already stops at the cap).
export function clampCrewRarity(rarity: EquipmentRarity): EquipmentRarity {
  return clampCrewRarityAt(rarity, CREW_RARITY_CAP);
}

// RR-7: the same clamp at any cap (the guard test lifts it). Pure.
export function clampCrewRarityAt(rarity: EquipmentRarity, cap: EquipmentRarity): EquipmentRarity {
  return rarityIndex(rarity) > rarityIndex(cap) ? cap : rarity;
}

// The multiplicative magnitude modifier for a crew rarity. Clamps to the cap first, then reads the
// table; a standard (1.0) fallback keeps the reader total even if an out-of-band rarity slips in.
export function crewRarityMultiplier(rarity: EquipmentRarity): number {
  return crewRarityMultiplierAt(rarity, CREW_RARITY_CAP);
}

// RR-7: the multiplier under any cap (crewRarityMultiplier is this at CREW_RARITY_CAP). Pure.
export function crewRarityMultiplierAt(rarity: EquipmentRarity, cap: EquipmentRarity): number {
  const clamped = clampCrewRarityAt(rarity, cap);
  // RR-1: an OWN finite entry only, so an inherited name ("constructor" reads a function off the prototype) can never
  // turn into NaN downstream.
  const m = Object.prototype.hasOwnProperty.call(CREW_RARITY_MULTIPLIER, clamped) ? CREW_RARITY_MULTIPLIER[clamped] : undefined;
  return typeof m === "number" && Number.isFinite(m) ? m : 1.0;
}
