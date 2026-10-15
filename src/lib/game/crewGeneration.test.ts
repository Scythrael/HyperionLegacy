// Crew 0.14.0 (Phase 2): tests for the DORMANT complement crew generator (crewGeneration.ts).
// Covers: determinism in (seed, index), rarity NEVER exceeds stellar, buff COUNT matches
// buffCountForRank (1 buff -> buff2 null; 2+ -> buff2 present + distinct/valid), profession pinning,
// and that every rolled buff id is a real catalog entry. Nothing here touches the tick or ship stats.

import { describe, it, expect } from "vitest";
import { rarityIndex } from "./model";
import type { CrewProfession } from "./model";
import { generateComplementCrew } from "./crewGeneration";
import { CREW_PROFESSION_BUFFS, SECOND_LEVEL_EXCLUSIVE, getCrewBuffById } from "./crewBuffs";
import { buffCountForRank } from "./crewRank";
import { CREW_RARITY_CAP } from "./crewRarity";
import { CREW_RACE_IDS } from "./crewRaces";
import { TRANSPORT_BATCH_SIZE, transportBatch } from "./transports";

const PROFESSIONS: CrewProfession[] = ["security", "engineering", "science", "medical", "operations", "flightDeck"];

describe("complement generator - determinism", () => {
  it("is deterministic in (seed, index): same inputs => byte-identical signature", () => {
    for (let i = 0; i < 25; i += 1) {
      expect(generateComplementCrew(12345, i)).toEqual(generateComplementCrew(12345, i));
    }
  });

  it("different indices decorrelate (not every row is identical)", () => {
    const rows = Array.from({ length: 40 }, (_, i) => JSON.stringify(generateComplementCrew(777, i)));
    expect(new Set(rows).size).toBeGreaterThan(1);
  });

  it("honors a pinned profession", () => {
    for (const p of PROFESSIONS) {
      for (let i = 0; i < 10; i += 1) {
        expect(generateComplementCrew(42, i, { profession: p }).profession).toBe(p);
      }
    }
  });
});

describe("complement generator - locked model invariants", () => {
  it("rarity NEVER exceeds the crew cap (stellar), across many rolls", () => {
    const cap = rarityIndex(CREW_RARITY_CAP);
    for (let i = 0; i < 500; i += 1) {
      const sig = generateComplementCrew(2026, i);
      expect(rarityIndex(sig.rarity)).toBeLessThanOrEqual(cap);
    }
  });

  it("buff COUNT matches buffCountForRank: 1 => buff2 null, 2+ => buff2 present", () => {
    for (let i = 0; i < 500; i += 1) {
      const sig = generateComplementCrew(99, i);
      const count = buffCountForRank(sig.rank);
      if (count >= 2) {
        expect(sig.buff2Id).not.toBeNull();
      } else {
        expect(sig.buff2Id).toBeNull();
      }
    }
  });

  it("buff1 is always a real entry of the crew's OWN profession pool", () => {
    for (let i = 0; i < 500; i += 1) {
      const sig = generateComplementCrew(55, i);
      const poolIds = CREW_PROFESSION_BUFFS[sig.profession].map((b) => b.id);
      expect(poolIds).toContain(sig.buff1Id);
    }
  });

  it("buff2 (when present) is a real buff, distinct from buff1, from the profession pool OR the exclusive pool", () => {
    const exclusiveIds = new Set(SECOND_LEVEL_EXCLUSIVE.map((b) => b.id));
    for (let i = 0; i < 500; i += 1) {
      const sig = generateComplementCrew(321, i);
      if (sig.buff2Id === null) continue;
      expect(sig.buff2Id).not.toBe(sig.buff1Id);
      expect(getCrewBuffById(sig.buff2Id)).toBeDefined();
      const poolIds = new Set(CREW_PROFESSION_BUFFS[sig.profession].map((b) => b.id));
      expect(poolIds.has(sig.buff2Id) || exclusiveIds.has(sig.buff2Id)).toBe(true);
    }
  });

  it("race is always a real catalog race", () => {
    const races = new Set(CREW_RACE_IDS);
    for (let i = 0; i < 200; i += 1) {
      expect(races.has(generateComplementCrew(8, i).race)).toBe(true);
    }
  });

  it("the exclusive pool is reachable as a 2nd buff on 3-buff-eligible ranks (7/8) but never at low ranks", () => {
    const exclusiveIds = new Set(SECOND_LEVEL_EXCLUSIVE.map((b) => b.id));
    let sawExclusive = false;
    for (let i = 0; i < 2000; i += 1) {
      const sig = generateComplementCrew(13, i);
      if (sig.buff2Id !== null && exclusiveIds.has(sig.buff2Id)) {
        sawExclusive = true;
        // Only ranks whose buff count is 3+ may draw the exclusive pool.
        expect(buffCountForRank(sig.rank)).toBeGreaterThanOrEqual(3);
      }
    }
    expect(sawExclusive).toBe(true);
  });
});

// Complement and Acquisition CP-1 (D14, SUGGESTIONS "CRAFT-DUPLICATE CREW BUFF"): craft duplicate is held and never
// rolls on ship crew. (The draw count per crewmember is pinned unchanged by crewGenerationDraws.test.ts.)
describe("complement generator - craft duplicate never rolls (D14)", () => {
  it("no crewmember in 10,000 holds craft duplicate, yet the other exclusive buffs still roll", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i += 1) {
      const sig = generateComplementCrew(0xd14, i);
      expect(sig.buff1Id).not.toBe("excl.craftDuplicate");
      expect(sig.buff2Id).not.toBe("excl.craftDuplicate");
      if (sig.buff2Id !== null && sig.buff2Id.startsWith("excl.")) seen.add(sig.buff2Id);
    }
    expect([...seen].sort()).toEqual(["excl.crewOutputMult", "excl.missionTurnaround", "excl.preventCrewLoss"]);
  });

  it("a 20-window transport backlog delivers no craft duplicate either", () => {
    for (let w = 1; w <= 20; w += 1) {
      for (const b of transportBatch(0x7ea5e, w, TRANSPORT_BATCH_SIZE)) expect(b.buff2Id).not.toBe("excl.craftDuplicate");
    }
  });
});
