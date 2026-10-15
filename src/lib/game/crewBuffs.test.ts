import { describe, it, expect } from "vitest";
import {
  CREW_PROFESSION_BUFFS,
  SECOND_LEVEL_EXCLUSIVE,
  CREW_STAT_KEYS,
  getCrewBuffById,
  HELD_CREW_BUFF_IDS,
  ROLLABLE_SECOND_LEVEL_EXCLUSIVE,
  isHeldCrewBuff,
  crewBuffLabel,
} from "./crewBuffs";
import { freshState, type CrewBucket, type CrewProfession, type GameState } from "./model";
import { effectiveShipStats } from "./crewOverlay";
import { deserialize, migrate, serialize, type SaveFile } from "./save";

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

// Complement and Acquisition CP-1 (D14): craft duplicate is HELD. It stays in the catalog (an existing bucket keeps
// the id and still resolves) but leaves the rollable exclusive set, and its label says it is held.
describe("crewBuffs: held buffs (D14, craft duplicate)", () => {
  it("splits the exclusive pool: craft duplicate is held, the other three stay rollable in catalog order", () => {
    expect([...HELD_CREW_BUFF_IDS]).toEqual(["excl.craftDuplicate"]);
    expect(ROLLABLE_SECOND_LEVEL_EXCLUSIVE.map((b) => b.id)).toEqual(["excl.crewOutputMult", "excl.missionTurnaround", "excl.preventCrewLoss"]);
    expect(SECOND_LEVEL_EXCLUSIVE.map((b) => b.id)).toContain("excl.craftDuplicate");
    expect(getCrewBuffById("excl.craftDuplicate")?.statKey).toBe(CREW_STAT_KEYS.craftDuplicateChance);
    expect(isHeldCrewBuff("excl.craftDuplicate")).toBe(true);
    expect(isHeldCrewBuff("excl.crewOutputMult")).toBe(false);
  });

  it("labels a held buff 'Held for homeworld staffing'; every other buff keeps its catalog label", () => {
    expect(crewBuffLabel("excl.craftDuplicate")).toBe("Craft Duplicate Chance (Held for homeworld staffing)");
    expect(crewBuffLabel("excl.crewOutputMult")).toBe("Crew Output Multiplier");
    expect(crewBuffLabel("ops.unloadSpeed")).toBe("Efficient Unloading");
    expect(crewBuffLabel("does.not.exist")).toBe("does.not.exist");
  });

  it("a held bucket contributes nothing to the ship sheet and survives a save round trip", () => {
    const held: CrewBucket = { profession: "engineering", rarity: "stellar", rank: 8, race: "martian", buff1Id: "eng.range", buff2Id: "excl.craftDuplicate", count: 5 };
    const withShip = (b: CrewBucket): GameState => {
      const s = freshState();
      return { ...s, ships: s.ships.map((sh) => ({ ...sh, complement: { buckets: [b], mode: "passive" as const } })) };
    };
    const s = withShip(held);
    expect(effectiveShipStats(s, s.ships[0])).toEqual(effectiveShipStats(withShip({ ...held, buff2Id: null }), withShip({ ...held, buff2Id: null }).ships[0]));
    const loaded = migrate(deserialize(serialize(s, 0)) as SaveFile);
    expect(loaded.ships[0].complement!.buckets).toEqual([held]);
  });
});
