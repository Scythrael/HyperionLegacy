// ML-2 goldens (0.14.0): the pre-rework capture (ml2RecipeGoldens.fixture.ts ML2_GOLDEN, taken on feat/crew-0.14.0 at
// 624b0c5 before any ML-2 data edit) pinned as it stands. Test-only.

import { describe, expect, it } from "vitest";
import { hash } from "./firstRunsGoldens.fixture";
import { ML2_GOLDEN, ML2_REWORKED, fabricated, inspected, isEquipment, reworkedRows, salvageRows, untouchedRows } from "./ml2RecipeGoldens.fixture";

describe("ML-2 pre-change goldens (captured before the recipe rework)", () => {
  it("recipes: the untouched table and each reworked row", () => {
    expect(hash(untouchedRows())).toBe(ML2_GOLDEN.recipesUntouched);
    expect(reworkedRows()).toEqual(ML2_GOLDEN.recipesReworked);
  });

  it("fabricate: one craft of every reworked blueprint through completion", () => {
    expect(ML2_REWORKED.map((k) => [k, fabricated(k)])).toEqual(ML2_GOLDEN.fabricate);
  });

  it("inspect: the piece each reworked equipment blank rolls", () => {
    expect(ML2_REWORKED.filter(isEquipment).map((k) => [k, hash(inspected(k).equipment.at(-1))])).toEqual(ML2_GOLDEN.inspect);
  });

  it("salvage: each reworked equipment piece at four band draws", () => {
    expect(salvageRows()).toEqual(ML2_GOLDEN.salvage);
  });
});
