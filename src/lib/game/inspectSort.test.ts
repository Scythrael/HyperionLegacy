// inspectSort.test.ts — Crafted Blanks 0.13.7 (bulk inspect-reveal display order).
//
// Proves sortRolledPieces ranks a batch rarity DESC -> quality DESC -> iLevel DESC, using the
// game's canonical rarity ordering (so rarity dominates quality: a low-quality high-rarity roll
// still sits above a maxed-quality lower-rarity one), and that it does not mutate its input.
import { describe, it, expect } from "vitest";
import type { EquipmentRarity, EquipmentInstance } from "./model";
import { sortRolledPieces } from "./inspectSort";

// A minimal stub: sortRolledPieces reads only rarity / quality / iLevel. `tag` lets a test assert
// the resulting ORDER by identity without leaning on the sort keys themselves.
function piece(tag: string, rarity: EquipmentRarity, quality: number, iLevel: number): EquipmentInstance {
  return { id: tag, rarity, quality, iLevel } as unknown as EquipmentInstance;
}

describe("sortRolledPieces (Crafted Blanks 0.13.7)", () => {
  it("rarity dominates quality: radiant/Q0 sorts above stellar/Q5", () => {
    const stellarMax = piece("stellar", "stellar", 5, 42);
    const radiantMin = piece("radiant", "radiant", 0, 39);
    const sorted = sortRolledPieces([stellarMax, radiantMin]);
    expect(sorted.map((p) => p.id)).toEqual(["radiant", "stellar"]);
  });

  it("orders a mixed batch by rarity, then quality, then iLevel (all DESC)", () => {
    const batch = [
      piece("stellar-q2", "stellar", 2, 40),
      piece("radiant-q0", "radiant", 0, 39),
      piece("standard-q3", "standard", 3, 40),
      piece("radiant-q5", "radiant", 5, 43),
      piece("augmented-q1", "augmented", 1, 38),
      piece("derelict-q2", "derelict", 2, 36),
      piece("augmented-q4", "augmented", 4, 42),
      piece("stellar-q5", "stellar", 5, 42),
      piece("standard-q1", "standard", 1, 37),
      piece("augmented-q3", "augmented", 3, 40),
    ];
    const sorted = sortRolledPieces(batch);
    expect(sorted.map((p) => p.id)).toEqual([
      "radiant-q5", // radiant (idx 4) first, Q5 > Q0
      "radiant-q0",
      "stellar-q5", // stellar (idx 3), Q5 > Q2
      "stellar-q2",
      "augmented-q4", // augmented (idx 2), Q4 > Q3 > Q1
      "augmented-q3",
      "augmented-q1",
      "standard-q3", // standard (idx 1), Q3 > Q1
      "standard-q1",
      "derelict-q2", // derelict (idx 0) last
    ]);
  });

  it("breaks a rarity+quality tie by iLevel DESC", () => {
    const lo = piece("il40", "augmented", 3, 40);
    const hi = piece("il44", "augmented", 3, 44);
    expect(sortRolledPieces([lo, hi]).map((p) => p.id)).toEqual(["il44", "il40"]);
  });

  it("ties luminous with constellar on rarity (parallel top tier), then falls through", () => {
    // Both map to rarityIndex 5, so quality breaks the tie (constellar/Q4 above luminous/Q1).
    const luminous = piece("luminous", "luminous", 1, 40);
    const constellar = piece("constellar", "constellar", 4, 40);
    expect(sortRolledPieces([luminous, constellar]).map((p) => p.id)).toEqual(["constellar", "luminous"]);
  });

  it("returns a NEW array and does not mutate the input", () => {
    const input = [piece("a", "standard", 0, 40), piece("b", "radiant", 0, 40)];
    const snapshot = input.map((p) => p.id);
    const sorted = sortRolledPieces(input);
    expect(sorted).not.toBe(input);
    expect(input.map((p) => p.id)).toEqual(snapshot); // input order untouched
  });
});
