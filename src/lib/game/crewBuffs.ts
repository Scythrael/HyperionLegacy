// Crew 0.14.0 (Phase 0.5): the per-profession PRIMARY buff pools + the second-level exclusive pool
// (pure data + pure readers).
//
// Each of the six professions (model.ts CrewProfession) has a POOL of a few buff VARIANTS; a rolled
// crewmember's buff1 is drawn from its profession pool. A higher-rank crewmember's buff2 is a 2nd
// draw from that pool OR one from SECOND_LEVEL_EXCLUSIVE (the sweeping ship-wide effects). Every
// buff has a unique id (what CrewSignature.buff1Id / buff2Id reference), a display label, a target
// STAT KEY (the rollup groups contributions by this key), and a FIRST-PASS base magnitude.
//
// STAT KEYS are plain strings by design: the crew rollup (crew.ts) produces a { statKey: number }
// overlay map that a LATER phase folds into ship stats. They are centralized in CREW_STAT_KEYS so
// buffs and racial bonuses (crewRaces.ts) target a single, typo-proof vocabulary. Nothing here is
// wired into the tick or UI. All magnitudes are FIRST-PASS + TUNABLE (the plan's 0.05-0.2%/head
// curve): expressed as fractional modifiers (0.002 == +0.2%).
//
// See docs/plans/2026-09-22-crew-0.14.0-plan.md ("Professions -> primary buff pools", Phase 0.5).

import type { CrewProfession } from "./model";

// The single vocabulary of stat keys crew buffs and racial bonuses target. First-pass set; a later
// phase maps these onto concrete ship-stat overlays. Kept as a const object so callers reference
// CREW_STAT_KEYS.unloadSpeed rather than a loose literal.
export const CREW_STAT_KEYS = {
  // Operations
  unloadSpeed: "crew.unloadSpeed",
  loadSpeed: "crew.loadSpeed",
  effectiveCargo: "crew.effectiveCargo",
  // Flight / Deck
  transitOutSpeed: "crew.transitOutSpeed",
  transitBackSpeed: "crew.transitBackSpeed",
  droneHandling: "crew.droneHandling",
  // Engineering
  rangeEfficiency: "crew.rangeEfficiency",
  hullRepairRate: "crew.hullRepairRate",
  powerEfficiency: "crew.powerEfficiency",
  // Security
  boardingDefense: "crew.boardingDefense",
  counterInfiltration: "crew.counterInfiltration",
  awayTeamProtection: "crew.awayTeamProtection",
  // Science
  extractionYield: "crew.extractionYield",
  rareFindChance: "crew.rareFindChance",
  surveyAptitude: "crew.surveyAptitude",
  // Medical
  crewEffectiveness: "crew.crewEffectiveness",
  reducedCrewLosses: "crew.reducedCrewLosses",
  triage: "crew.triage",
  // Second-level exclusive (ship-wide)
  crewOutputMult: "crew.crewOutputMult",
  craftDuplicateChance: "crew.craftDuplicateChance",
  missionTurnaround: "crew.missionTurnaround",
  preventCrewLoss: "crew.preventCrewLoss",
  // Racial-only lean targets (crewRaces.ts) that are not a buff-pool stat. endurance has no source in 0.14.0: the
  // Spacer racial moved to TRANSIT_SPEED_KEY (below) and the Spacer long-haul ramp it was named for is 0.14.x (T3).
  fuelEfficiency: "crew.fuelEfficiency",
  endurance: "crew.endurance",
} as const;

export type CrewStatKey = (typeof CREW_STAT_KEYS)[keyof typeof CREW_STAT_KEYS];

// The ship's SWEEPING transit speed key (both legs: crewOverlay.ts folds it into ShipDerivedStats.transitSpeedMult,
// which every mission leg (outboundLegSpeed / returnLegSpeed) and every expedition voyage (voyage.ts) divides by).
// The Pilot's Ace Navigator rides it (crewOverlay.ts OFFICER_TRANSIT_KEY is this key), and so does the Spacer racial
// (user 2026-10-20 "+Transit speed": a small travel-speed racial at the usual officer racial size).
export const TRANSIT_SPEED_KEY = "officer.transitTimeCut";

export interface CrewBuffDef {
  id: string; // unique across ALL pools (profession pools + the exclusive pool)
  label: string;
  statKey: CrewStatKey;
  magnitude: number; // FIRST-PASS fractional base magnitude before rank/rarity scaling
}

// The per-profession primary buff pools (Proposal A, LOCKED). Each variant is one rolled buff1/buff2
// candidate. Ids are profession-prefixed so they stay globally unique.
export const CREW_PROFESSION_BUFFS: Record<CrewProfession, CrewBuffDef[]> = {
  operations: [
    { id: "ops.unloadSpeed", label: "Efficient Unloading", statKey: CREW_STAT_KEYS.unloadSpeed, magnitude: 0.002 },
    { id: "ops.loadSpeed", label: "Rapid Loadout", statKey: CREW_STAT_KEYS.loadSpeed, magnitude: 0.002 },
    { id: "ops.effectiveCargo", label: "Stowage Discipline", statKey: CREW_STAT_KEYS.effectiveCargo, magnitude: 0.0015 },
  ],
  flightDeck: [
    { id: "flight.transitOut", label: "Fast Departure", statKey: CREW_STAT_KEYS.transitOutSpeed, magnitude: 0.002 },
    { id: "flight.transitBack", label: "Fast Return", statKey: CREW_STAT_KEYS.transitBackSpeed, magnitude: 0.002 },
    { id: "flight.droneHandling", label: "Deck Handling", statKey: CREW_STAT_KEYS.droneHandling, magnitude: 0.0015 },
  ],
  engineering: [
    { id: "eng.range", label: "Engine Tuning", statKey: CREW_STAT_KEYS.rangeEfficiency, magnitude: 0.002 },
    { id: "eng.hullRepair", label: "Damage Control", statKey: CREW_STAT_KEYS.hullRepairRate, magnitude: 0.0015 },
    { id: "eng.power", label: "Power Discipline", statKey: CREW_STAT_KEYS.powerEfficiency, magnitude: 0.002 },
  ],
  security: [
    { id: "sec.boarding", label: "Boarding Defense", statKey: CREW_STAT_KEYS.boardingDefense, magnitude: 0.002 },
    { id: "sec.counterInfiltration", label: "Counter-Infiltration", statKey: CREW_STAT_KEYS.counterInfiltration, magnitude: 0.0015 },
    { id: "sec.awayTeam", label: "Away-Team Protection", statKey: CREW_STAT_KEYS.awayTeamProtection, magnitude: 0.0015 },
  ],
  science: [
    { id: "sci.extraction", label: "Extraction Yield", statKey: CREW_STAT_KEYS.extractionYield, magnitude: 0.002 },
    { id: "sci.rareFind", label: "Keen Analysis", statKey: CREW_STAT_KEYS.rareFindChance, magnitude: 0.0015 },
    { id: "sci.survey", label: "Survey Aptitude", statKey: CREW_STAT_KEYS.surveyAptitude, magnitude: 0.0015 },
  ],
  medical: [
    { id: "med.effectiveness", label: "Crew Effectiveness", statKey: CREW_STAT_KEYS.crewEffectiveness, magnitude: 0.002 },
    { id: "med.reducedLosses", label: "Reduced Crew Losses", statKey: CREW_STAT_KEYS.reducedCrewLosses, magnitude: 0.0015 },
    { id: "med.triage", label: "Triage", statKey: CREW_STAT_KEYS.triage, magnitude: 0.0015 },
  ],
};

// The second-level EXCLUSIVE pool: sweeping ship-wide effects a higher-rank crewmember's 2nd buff
// can draw from (instead of a 2nd profession buff). Larger base magnitudes than the per-head
// profession buffs because they are rarer and ship-wide. FIRST-PASS + TUNABLE. This is the CATALOG (every id an
// existing bucket may carry); the generator rolls ROLLABLE_SECOND_LEVEL_EXCLUSIVE below (D14: craft duplicate is held).
export const SECOND_LEVEL_EXCLUSIVE: CrewBuffDef[] = [
  { id: "excl.crewOutputMult", label: "Crew Output Multiplier", statKey: CREW_STAT_KEYS.crewOutputMult, magnitude: 0.01 },
  { id: "excl.craftDuplicate", label: "Craft Duplicate Chance", statKey: CREW_STAT_KEYS.craftDuplicateChance, magnitude: 0.01 },
  { id: "excl.missionTurnaround", label: "Mission Turnaround", statKey: CREW_STAT_KEYS.missionTurnaround, magnitude: 0.01 },
  { id: "excl.preventCrewLoss", label: "Prevent a Crew Loss", statKey: CREW_STAT_KEYS.preventCrewLoss, magnitude: 0.01 },
];

// Complement and Acquisition CP-1 (E-CREW Task 23, design D14): buffs that stay in the CATALOG but never roll on ship
// crew. Craft duplicate has no sensible home on a ship; the user is holding it for an FA talent or the later homeworld
// staffing system (SUGGESTIONS.md "CRAFT-DUPLICATE CREW BUFF: HOLD, likely moves off ship crew", 2026-10-02: "should
// not roll on ship crew (no dead rolls)"). A bucket rolled before this keeps the id in the save and still resolves
// through getCrewBuffById; its key maps to nothing (crewOverlay.ts), so it contributes nothing, and the UI labels it
// held (crewBuffLabel). Move an id back out of this set only when its new home gives the key a consumer.
export const HELD_CREW_BUFF_IDS: ReadonlySet<string> = new Set(["excl.craftDuplicate"]);

// The exclusive buffs the generator may roll (crewGeneration.ts): SECOND_LEVEL_EXCLUSIVE without the held ones, in
// catalog order. Still ONE draw per exclusive pick (only which buff a pick names changed), so the draw count per
// crewmember is unchanged (crewGenerationDraws.test.ts).
export const ROLLABLE_SECOND_LEVEL_EXCLUSIVE: readonly CrewBuffDef[] = SECOND_LEVEL_EXCLUSIVE.filter((def) => !HELD_CREW_BUFF_IDS.has(def.id));

// Is this buff held (in the catalog, never rolled, contributing nothing)? Pure.
export function isHeldCrewBuff(id: string): boolean {
  return HELD_CREW_BUFF_IDS.has(id);
}

// A flat id -> def lookup across every pool (profession + exclusive), built once at module load.
// Buff ids are asserted unique here so a future duplicate id fails loudly rather than silently
// shadowing.
const BUFF_BY_ID: Map<string, CrewBuffDef> = (() => {
  const map = new Map<string, CrewBuffDef>();
  const all: CrewBuffDef[] = [
    ...Object.values(CREW_PROFESSION_BUFFS).flat(),
    ...SECOND_LEVEL_EXCLUSIVE,
  ];
  for (const def of all) {
    if (map.has(def.id)) throw new Error(`Duplicate crew buff id: ${def.id}`);
    map.set(def.id, def);
  }
  return map;
})();

// Look up a buff def by id (from any pool), or undefined if the id is unknown. Pure reader.
export function getCrewBuffById(id: string): CrewBuffDef | undefined {
  return BUFF_BY_ID.get(id);
}

// The player-facing label of a crew buff: its catalog label, with "(Held for homeworld staffing)" after a held buff
// (D14) so an old bucket that still carries one reads as on hold rather than as a live bonus. An unknown id reads as
// itself. Every UI that names a complement or notable buff goes through this. Pure.
export function crewBuffLabel(id: string): string {
  const def = BUFF_BY_ID.get(id);
  if (def === undefined) return id;
  return isHeldCrewBuff(id) ? `${def.label} (Held for homeworld staffing)` : def.label;
}
