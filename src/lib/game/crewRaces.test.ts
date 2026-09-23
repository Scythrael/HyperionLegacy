import { describe, it, expect } from "vitest";
import { CREW_RACES, CREW_RACE_IDS, CREW_GENDERS } from "./crewRaces";
import { CREW_STAT_KEYS } from "./crewBuffs";
import type { CrewRace } from "./model";

const EXPECTED_RACES: CrewRace[] = [
  "earthBorn",
  "martian",
  "belter",
  "outerColony",
  "stationBorn",
  "spacer",
  "vael",
  "ossir",
  "stheni",
  "draell",
];

describe("crewRaces: roster", () => {
  it("has exactly the 10 locked races (6 human origins + 4 species)", () => {
    expect(CREW_RACE_IDS.sort()).toEqual([...EXPECTED_RACES].sort());
    const humans = CREW_RACE_IDS.filter((r) => CREW_RACES[r].species === "human");
    expect(humans).toHaveLength(6);
    expect(CREW_RACE_IDS.length - humans.length).toBe(4);
  });

  it("keys each def to its own id and gives it a label + lean", () => {
    for (const r of CREW_RACE_IDS) {
      expect(CREW_RACES[r].id).toBe(r);
      expect(CREW_RACES[r].label.length).toBeGreaterThan(0);
      expect(CREW_RACES[r].lean.length).toBeGreaterThan(0);
    }
  });
});

describe("crewRaces: context-scaled racial bonus", () => {
  it("gives every race a known stat key and TWO magnitudes, senior-staff STRONGER than complement", () => {
    const knownKeys = new Set(Object.values(CREW_STAT_KEYS));
    for (const r of CREW_RACE_IDS) {
      const rb = CREW_RACES[r].racialBonus;
      expect(knownKeys.has(rb.statKey)).toBe(true);
      expect(rb.seniorStaff).toBeGreaterThan(0);
      expect(rb.complement).toBeGreaterThan(0);
      // The whole point of context scaling: the officer magnitude dwarfs the per-head one.
      expect(rb.seniorStaff).toBeGreaterThan(rb.complement);
    }
  });
});

describe("crewRaces: name pools + gender", () => {
  it("gives every race non-empty given + family pools", () => {
    for (const r of CREW_RACE_IDS) {
      expect(CREW_RACES[r].names.given.length).toBeGreaterThan(0);
      expect(CREW_RACES[r].names.family.length).toBeGreaterThan(0);
    }
  });

  it("shares ONE human name pool across all six human origins (no ethnicity->stat linkage)", () => {
    const humans = CREW_RACE_IDS.filter((r) => CREW_RACES[r].species === "human");
    const given = CREW_RACES[humans[0]].names.given;
    const family = CREW_RACES[humans[0]].names.family;
    for (const h of humans) {
      expect(CREW_RACES[h].names.given).toBe(given); // same array reference
      expect(CREW_RACES[h].names.family).toBe(family);
    }
  });

  it("gives the four species their OWN coined pools (not the human pool)", () => {
    const humanGiven = CREW_RACES.earthBorn.names.given;
    for (const r of CREW_RACE_IDS.filter((x) => CREW_RACES[x].species !== "human")) {
      expect(CREW_RACES[r].names.given).not.toBe(humanGiven);
    }
  });

  it("exposes the inclusive gender set", () => {
    expect(CREW_GENDERS).toEqual(["male", "female", "nonbinary"]);
  });
});
