import { describe, it, expect } from "vitest";
import {
  CREW_PROFESSION_BUFFS,
  SECOND_LEVEL_EXCLUSIVE,
  CREW_STAT_KEYS,
  getCrewBuffById,
} from "./crewBuffs";
import type { CrewProfession } from "./model";

const PROFESSIONS: CrewProfession[] = [
  "security",
  "engineering",
  "science",
  "medical",
  "operations",
  "flightDeck",
];

describe("crewBuffs: profession pools", () => {
  it("defines a non-empty pool for every one of the six professions", () => {
    for (const p of PROFESSIONS) {
      expect(CREW_PROFESSION_BUFFS[p].length).toBeGreaterThan(0);
    }
    expect(Object.keys(CREW_PROFESSION_BUFFS).sort()).toEqual([...PROFESSIONS].sort());
  });

  it("gives every buff a positive base magnitude and a known stat key", () => {
    const knownKeys = new Set(Object.values(CREW_STAT_KEYS));
    for (const pool of Object.values(CREW_PROFESSION_BUFFS)) {
      for (const def of pool) {
        expect(def.magnitude).toBeGreaterThan(0);
        expect(knownKeys.has(def.statKey)).toBe(true);
        expect(def.label.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("crewBuffs: second-level exclusive pool", () => {
  it("has the four sweeping ship-wide effects", () => {
    const keys = SECOND_LEVEL_EXCLUSIVE.map((b) => b.statKey);
    expect(keys).toContain(CREW_STAT_KEYS.crewOutputMult);
    expect(keys).toContain(CREW_STAT_KEYS.craftDuplicateChance);
    expect(keys).toContain(CREW_STAT_KEYS.missionTurnaround);
    expect(keys).toContain(CREW_STAT_KEYS.preventCrewLoss);
  });
});

describe("crewBuffs: id uniqueness + lookup", () => {
  it("has globally unique ids across profession pools and the exclusive pool", () => {
    const all = [...Object.values(CREW_PROFESSION_BUFFS).flat(), ...SECOND_LEVEL_EXCLUSIVE];
    const ids = all.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("getCrewBuffById resolves any pool's buff and returns undefined for an unknown id", () => {
    expect(getCrewBuffById("ops.unloadSpeed")?.statKey).toBe(CREW_STAT_KEYS.unloadSpeed);
    expect(getCrewBuffById("excl.preventCrewLoss")?.statKey).toBe(CREW_STAT_KEYS.preventCrewLoss);
    expect(getCrewBuffById("does.not.exist")).toBeUndefined();
  });
});
