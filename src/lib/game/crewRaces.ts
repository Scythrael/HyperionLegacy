// Crew 0.14.0 (Phase 0.5): the crew RACE catalog (pure data + pure readers).
//
// Six human origins + four allied species (LOCKED with the user 2026-09-22). Each race carries:
//   - a display label + a short "lean" (its flavor tendency; NO hard stat gate, just flavor),
//   - a CONTEXT-SCALED racial bonus: one target stat key with TWO magnitudes, a STRONG value when
//     the crewmember is a Senior Staff officer and a TINY per-head value in the Complement rollup,
//   - inclusive NAME-GENERATION pools (given + family) and are drawn against the global CREW_GENDERS.
//
// INCLUSIVITY (a hard design rule): the six HUMAN origins all draw from ONE shared, deliberately
// diverse name pool (HUMAN_GIVEN_NAMES / HUMAN_FAMILY_NAMES spanning many real-world cultures), so
// there is NO ethnicity -> stat linkage anywhere: a Martian and an Earth-born pull the same names.
// The four species use their own COINED pools (new canon). Gender (CREW_GENDERS) is cosmetic only.
//
// All magnitudes are FIRST-PASS + TUNABLE. Pools are modest but real. Nothing here is wired into the
// tick or UI. See docs/plans/2026-09-22-crew-0.14.0-plan.md ("Races", Phase 0.5).

import type { CrewRace } from "./model";
import { CREW_STAT_KEYS, TRANSIT_SPEED_KEY, type CrewStatKey } from "./crewBuffs";

// Cosmetic, inclusive gender set (male/female/nonbinary). No mechanical effect anywhere.
export const CREW_GENDERS: readonly string[] = ["male", "female", "nonbinary"];

// A race's context-scaled racial bonus. One stat key, two magnitudes. FIRST-PASS values. The key is a crew.* key, or
// the ship's sweeping transit speed key (the Spacer).
export interface RacialBonus {
  statKey: CrewStatKey | typeof TRANSIT_SPEED_KEY;
  seniorStaff: number; // STRONG magnitude when this race sits in a bridge seat (officer engine, later)
  complement: number; // TINY per-head magnitude in the complement rollup
}

export interface CrewRaceNamePools {
  given: string[];
  family: string[];
}

export interface CrewRaceDef {
  id: CrewRace;
  label: string;
  species: "human" | "vael" | "ossir" | "stheni" | "draell";
  lean: string; // flavor tendency (US English), not a hard gate
  racialBonus: RacialBonus;
  names: CrewRaceNamePools;
}

// Shared, deliberately multicultural HUMAN name pools. Modest but real; every human origin points at
// these SAME arrays (see the inclusivity note above). Not exhaustive, easy to grow.
const HUMAN_GIVEN_NAMES: string[] = [
  "Amara", "Chen", "Rafael", "Priya", "Kofi", "Yuki", "Nadia", "Diego",
  "Aisha", "Lars", "Mei", "Tomas", "Zara", "Ravi", "Sofia", "Kwame",
  "Ingrid", "Hassan", "Lena", "Jun", "Fatima", "Oscar", "Anaya", "Bjorn",
  "Rosa", "Omar", "Keiko", "Marcus", "Layla", "Sanjay",
];

const HUMAN_FAMILY_NAMES: string[] = [
  "Okafor", "Nakamura", "Silva", "Petrov", "Hassan", "Andersson", "Reyes", "Cohen",
  "Mwangi", "Rossi", "Kim", "Dubois", "Haidari", "Novak", "Costa", "Ivanova",
  "Adeyemi", "Larsen", "Vasquez", "Oyelaran", "Fischer", "Nwosu", "Tanaka", "Moreno",
];

export const CREW_RACES: Record<CrewRace, CrewRaceDef> = {
  // --- 6 human origins ---
  earthBorn: {
    id: "earthBorn",
    label: "Earth-born",
    species: "human",
    lean: "balanced, no specialty",
    racialBonus: { statKey: CREW_STAT_KEYS.crewEffectiveness, seniorStaff: 0.04, complement: 0.0004 },
    names: { given: HUMAN_GIVEN_NAMES, family: HUMAN_FAMILY_NAMES },
  },
  martian: {
    id: "martian",
    label: "Martian",
    species: "human",
    lean: "engineering / efficiency",
    racialBonus: { statKey: CREW_STAT_KEYS.powerEfficiency, seniorStaff: 0.05, complement: 0.0005 },
    names: { given: HUMAN_GIVEN_NAMES, family: HUMAN_FAMILY_NAMES },
  },
  belter: {
    id: "belter",
    label: "Belter",
    species: "human",
    lean: "flight-deck / EVA",
    racialBonus: { statKey: CREW_STAT_KEYS.droneHandling, seniorStaff: 0.05, complement: 0.0005 },
    names: { given: HUMAN_GIVEN_NAMES, family: HUMAN_FAMILY_NAMES },
  },
  outerColony: {
    id: "outerColony",
    label: "Outer-Colony",
    species: "human",
    lean: "security / survey",
    racialBonus: { statKey: CREW_STAT_KEYS.surveyAptitude, seniorStaff: 0.05, complement: 0.0005 },
    names: { given: HUMAN_GIVEN_NAMES, family: HUMAN_FAMILY_NAMES },
  },
  stationBorn: {
    id: "stationBorn",
    label: "Station-born",
    species: "human",
    lean: "operations / logistics",
    racialBonus: { statKey: CREW_STAT_KEYS.unloadSpeed, seniorStaff: 0.05, complement: 0.0005 },
    names: { given: HUMAN_GIVEN_NAMES, family: HUMAN_FAMILY_NAMES },
  },
  spacer: {
    id: "spacer",
    label: "Spacer",
    species: "human",
    lean: "endurance / long-haul",
    // 0.14.0 (user 2026-10-20 "+Transit speed (Recommended)": a small travel-speed racial at the usual officer racial
    // size, so no race is inert): the ship's sweeping transit speed, both legs and the expedition voyage. The full
    // Spacer long-haul ramp (crew.endurance, D26) stays 0.14.x (T3).
    racialBonus: { statKey: TRANSIT_SPEED_KEY, seniorStaff: 0.05, complement: 0.0005 },
    names: { given: HUMAN_GIVEN_NAMES, family: HUMAN_FAMILY_NAMES },
  },
  // --- 4 allied species (coined names; NEW canon) ---
  vael: {
    id: "vael",
    label: "Vael",
    species: "vael",
    lean: "science / sensors",
    racialBonus: { statKey: CREW_STAT_KEYS.surveyAptitude, seniorStaff: 0.06, complement: 0.0006 },
    names: {
      given: ["Sennei", "Aluun", "Virel", "Ossae", "Naeth", "Iliru", "Vaelen", "Sooma"],
      family: ["Threnaal", "Suvei", "Oorlan", "Aethis", "Nuvaan"],
    },
  },
  ossir: {
    id: "ossir",
    label: "Ossir",
    species: "ossir",
    lean: "security / boarding-defense",
    racialBonus: { statKey: CREW_STAT_KEYS.boardingDefense, seniorStaff: 0.06, complement: 0.0006 },
    names: {
      given: ["Grokk", "Ossra", "Dromm", "Kavel", "Hurrn", "Tessk", "Ruum", "Vokka"],
      family: ["Kholmm", "Dragga", "Osskarr", "Vennuk", "Torrhak"],
    },
  },
  stheni: {
    id: "stheni",
    label: "Stheni",
    species: "stheni",
    lean: "engineering / repair",
    racialBonus: { statKey: CREW_STAT_KEYS.hullRepairRate, seniorStaff: 0.06, complement: 0.0006 },
    names: {
      given: ["Ysseth", "Kirra", "Nasha", "Thessa", "Vryn", "Ssura", "Ophi", "Lysseth"],
      family: ["Ssovann", "Threxa", "Nirriss", "Ossheen", "Vraals"],
    },
  },
  draell: {
    id: "draell",
    label: "Draell",
    species: "draell",
    lean: "flight / fuel-efficiency",
    racialBonus: { statKey: CREW_STAT_KEYS.fuelEfficiency, seniorStaff: 0.06, complement: 0.0006 },
    names: {
      given: ["Aeri", "Dwuun", "Faelo", "Iyra", "Mowa", "Tsael", "Ureth", "Zephi"],
      family: ["Skyloen", "Vaardu", "Ellith", "Oorae", "Naevann"],
    },
  },
};

// Every race id, handy for iteration (kept in declaration order).
export const CREW_RACE_IDS = Object.keys(CREW_RACES) as CrewRace[];
