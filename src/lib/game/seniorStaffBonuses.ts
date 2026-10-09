// Crew 0.14.0 (Phase 0.5): the SENIOR STAFF bonus catalog (pure data + pure readers).
//
// Senior Staff officers (the few named bridge-seat officers, model.ts SeniorStaffOfficer) provide
// LARGER, SWEEPING, UNIQUE effects, a deliberately bigger class than the tiny per-head complement
// buff pools. The (later) officer engine rolls each officer's TWO bonuses from this catalog, and a
// bonus magnitude scales with officer rank (Ensign -> Commander). THIS MODULE IS DATA ONLY: no
// rolling, no engine, nothing wired into the tick or UI.
//
// Each bonus is tied to a bridge SEAT (so a Science officer rolls science-flavored bonuses, etc.),
// with a few "any"-seat sweeping bonuses that any officer can carry. Magnitudes are the base
// (Ensign-tier) values; the officer engine scales them by rank later. FIRST-PASS + TUNABLE.
//
// See docs/plans/2026-09-22-crew-0.14.0-plan.md ("Senior Staff", Phase 0.5).

import type { SeniorStaffSeat } from "./model";

export interface SeniorStaffBonusDef {
  id: string; // unique across the catalog
  label: string;
  seat: SeniorStaffSeat | "any"; // which bridge seat rolls this (or "any" = sweeping, seat-agnostic)
  statKey: string; // the ship-level effect this touches (own broader vocabulary than the crew buffs)
  magnitude: number; // FIRST-PASS base (Ensign-tier) magnitude; the officer engine scales by rank
  description: string; // flavor / intent (US English)
  // E-CREW Task 19 (S4-C03, "some officer skills roll FAR RARER than others"): how often the candidate
  // board rolls this bonus. The tiers are the Crew Made Real mockup's section 7 "Roll" column and the
  // weights are OFFICER_BONUS_TIER_WEIGHTS. This is ROLL ODDS only, not an officer rarity tier (officers
  // stay rarity-free; rarity is complement-only).
  rollTier: OfficerBonusRollTier;
}

// How often a bonus rolls on the candidate board (E-CREW Task 19). FIRST-PASS + TUNABLE.
export type OfficerBonusRollTier = "common" | "uncommon" | "rare" | "veryRare";

// The relative weight of each roll tier (FIRST-PASS + TUNABLE, from the mockup table): a common bonus is
// six times as likely as a very rare one in the same pool. Every weight is a positive integer so the
// weighted pick stays a single integer draw (seniorStaff.ts pickWeightedBonusIndex).
export const OFFICER_BONUS_TIER_WEIGHTS: Readonly<Record<OfficerBonusRollTier, number>> = {
  common: 6,
  uncommon: 3,
  rare: 2,
  veryRare: 1,
};

// A bonus's roll weight (its tier's weight). Pure reader.
export function bonusRollWeight(def: SeniorStaffBonusDef): number {
  return OFFICER_BONUS_TIER_WEIGHTS[def.rollTier];
}

// The catalog. Larger unique effects than the complement pools; grouped by seat here for reading,
// exported as one flat array. Ids are seat-prefixed to stay globally unique.
export const SENIOR_STAFF_BONUSES: SeniorStaffBonusDef[] = [
  // Executive Officer: fleet-wide command multipliers.
  { id: "xo.commandOutput", label: "Command Presence", seat: "executive", statKey: "officer.shipOutputMult", magnitude: 0.06, rollTier: "rare", description: "Grows the materials and credits every one of the ship's runs brings home (missions and patrols)." },
  { id: "xo.moraleAnchor", label: "Morale Anchor", seat: "executive", statKey: "officer.crewRetention", magnitude: 0.08, rollTier: "uncommon", description: "Steadies the away team: every member resists Fear. (Complement attrition, if that system ever lands.)" },

  // Pilot: transit and evasion.
  { id: "pilot.transitCut", label: "Ace Navigator", seat: "pilot", statKey: "officer.transitTimeCut", magnitude: 0.08, rollTier: "common", description: "Shaves a sweeping cut off both legs of a mission's transit." },
  { id: "pilot.evasion", label: "Evasive Command", seat: "pilot", statKey: "officer.evasion", magnitude: 0.1, rollTier: "uncommon", description: "A large evasion edge in ship battles, and fewer random battles while an expedition scans." },

  // Operations: logistics and cargo.
  { id: "ops.unloadSurge", label: "Logistics Mastery", seat: "operations", statKey: "officer.unloadTimeCut", magnitude: 0.1, rollTier: "common", description: "A big cut to homeworld unload time for the whole ship." },
  { id: "ops.cargoExpand", label: "Cargo Optimization", seat: "operations", statKey: "officer.effectiveCargoMult", magnitude: 0.08, rollTier: "common", description: "Meaningfully raises the ship's effective cargo capacity." },

  // Science: yield and discovery.
  { id: "sci.yieldSurge", label: "Breakthrough Analysis", seat: "science", statKey: "officer.extractionYieldMult", magnitude: 0.1, rollTier: "common", description: "A sweeping lift to extraction yield across all missions." },
  { id: "sci.discovery", label: "Discovery Instinct", seat: "science", statKey: "officer.rareFindMult", magnitude: 0.12, rollTier: "rare", description: "A large boost to the expedition relic chance and to the rare drops of survey missions." },

  // Tactical: combat power.
  { id: "tac.weaponCommand", label: "Weapons Command", seat: "tactical", statKey: "officer.weaponEffectivenessMult", magnitude: 0.1, rollTier: "uncommon", description: "A sweeping lift to installed-weapon damage in ship battles and patrols." },
  { id: "tac.shieldCommand", label: "Shield Command", seat: "tactical", statKey: "officer.shieldEffectivenessMult", magnitude: 0.1, rollTier: "uncommon", description: "A sweeping lift to shield capacity and recharge in ship battles and patrols." },

  // Medical: crew survival.
  { id: "med.fleetTriage", label: "Fleet Triage", seat: "medical", statKey: "officer.crewLossPrevention", magnitude: 0.15, rollTier: "uncommon", description: "Stronger away-team healing and first-aid cures in ground battles." },
  { id: "med.recovery", label: "Rapid Recovery", seat: "medical", statKey: "officer.repairRateMult", magnitude: 0.1, rollTier: "uncommon", description: "Speeds Shipyard hull repair and shortens away-team injuries." },

  // Engineering: efficiency and repair.
  { id: "eng.overdrive", label: "Reactor Overdrive", seat: "engineering", statKey: "officer.powerEfficiencyMult", magnitude: 0.1, rollTier: "uncommon", description: "A sweeping power-efficiency lift for the whole ship (live with the power budget)." },
  { id: "eng.rangeMaster", label: "Range Mastery", seat: "engineering", statKey: "officer.rangeMult", magnitude: 0.1, rollTier: "common", description: "A large lift to the ship's effective range." },

  // Any-seat sweeping bonuses (seat-agnostic, rarer flavor).
  { id: "any.inspiringLeader", label: "Inspiring Leader", seat: "any", statKey: "officer.allStatsMult", magnitude: 0.04, rollTier: "veryRare", description: "A small lift to every ship stat (cargo, speed, yield, sensors, range, unload, weapons, shields, hull), regardless of seat." },
  { id: "any.veteranInstincts", label: "Veteran Instincts", seat: "any", statKey: "officer.missionTurnaroundCut", magnitude: 0.06, rollTier: "rare", description: "Shorter mission turnaround: faster unloading at home and faster Shipyard repair." },
];

// Every bonus rollable for a given seat: the seat's own bonuses plus the seat-agnostic "any" ones.
// Pure reader; returns a fresh array.
export function seniorStaffBonusesForSeat(seat: SeniorStaffSeat): SeniorStaffBonusDef[] {
  return SENIOR_STAFF_BONUSES.filter((b) => b.seat === seat || b.seat === "any");
}

// Look up a senior-staff bonus by id, or undefined. Pure reader.
export function getSeniorStaffBonusById(id: string): SeniorStaffBonusDef | undefined {
  return SENIOR_STAFF_BONUSES.find((b) => b.id === id);
}
