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
}

// The catalog. Larger unique effects than the complement pools; grouped by seat here for reading,
// exported as one flat array. Ids are seat-prefixed to stay globally unique.
export const SENIOR_STAFF_BONUSES: SeniorStaffBonusDef[] = [
  // Executive Officer: fleet-wide command multipliers.
  { id: "xo.commandOutput", label: "Command Presence", seat: "executive", statKey: "officer.shipOutputMult", magnitude: 0.06, description: "Lifts the ship's overall crew output while this officer sits the XO seat." },
  { id: "xo.moraleAnchor", label: "Morale Anchor", seat: "executive", statKey: "officer.crewRetention", magnitude: 0.08, description: "Steadies the complement, cutting attrition across every division." },

  // Pilot: transit and evasion.
  { id: "pilot.transitCut", label: "Ace Navigator", seat: "pilot", statKey: "officer.transitTimeCut", magnitude: 0.08, description: "Shaves a sweeping cut off both legs of a mission's transit." },
  { id: "pilot.evasion", label: "Evasive Command", seat: "pilot", statKey: "officer.evasion", magnitude: 0.1, description: "A large evasion edge in combat and hazardous transits." },

  // Operations: logistics and cargo.
  { id: "ops.unloadSurge", label: "Logistics Mastery", seat: "operations", statKey: "officer.unloadTimeCut", magnitude: 0.1, description: "A big cut to homeworld unload time for the whole ship." },
  { id: "ops.cargoExpand", label: "Cargo Optimization", seat: "operations", statKey: "officer.effectiveCargoMult", magnitude: 0.08, description: "Meaningfully raises the ship's effective cargo capacity." },

  // Science: yield and discovery.
  { id: "sci.yieldSurge", label: "Breakthrough Analysis", seat: "science", statKey: "officer.extractionYieldMult", magnitude: 0.1, description: "A sweeping lift to extraction yield across all missions." },
  { id: "sci.discovery", label: "Discovery Instinct", seat: "science", statKey: "officer.rareFindMult", magnitude: 0.12, description: "A large boost to rare-find and discovery chance." },

  // Tactical: combat power.
  { id: "tac.weaponCommand", label: "Weapons Command", seat: "tactical", statKey: "officer.weaponEffectivenessMult", magnitude: 0.1, description: "A sweeping lift to installed-weapon effectiveness in battle." },
  { id: "tac.shieldCommand", label: "Shield Command", seat: "tactical", statKey: "officer.shieldEffectivenessMult", magnitude: 0.1, description: "A sweeping lift to shield effectiveness in battle." },

  // Medical: crew survival.
  { id: "med.fleetTriage", label: "Fleet Triage", seat: "medical", statKey: "officer.crewLossPrevention", magnitude: 0.15, description: "A large chance to prevent crew losses ship-wide." },
  { id: "med.recovery", label: "Rapid Recovery", seat: "medical", statKey: "officer.repairRateMult", magnitude: 0.1, description: "Speeds hull and crew recovery between deployments." },

  // Engineering: efficiency and repair.
  { id: "eng.overdrive", label: "Reactor Overdrive", seat: "engineering", statKey: "officer.powerEfficiencyMult", magnitude: 0.1, description: "A sweeping power-efficiency lift for the whole ship." },
  { id: "eng.rangeMaster", label: "Range Mastery", seat: "engineering", statKey: "officer.rangeMult", magnitude: 0.1, description: "A large lift to the ship's effective range." },

  // Any-seat sweeping bonuses (seat-agnostic, rarer flavor).
  { id: "any.inspiringLeader", label: "Inspiring Leader", seat: "any", statKey: "officer.allStatsMult", magnitude: 0.04, description: "A small lift to every ship stat, regardless of seat." },
  { id: "any.veteranInstincts", label: "Veteran Instincts", seat: "any", statKey: "officer.missionTurnaroundCut", magnitude: 0.06, description: "A sweeping cut to overall mission turnaround." },
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
