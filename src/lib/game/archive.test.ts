// archive.test.ts — ITEM LIFECYCLE 0.13.6 (Phase 4, the Archive).
import { describe, it, expect } from "vitest";
import { freshState, BLUEPRINTS } from "./model";
import { itemScore, maxItemScore, archivableBlueprints, archiveCompletion, archiveItem } from "./archive";

describe("archive (Item Lifecycle 0.13.6)", () => {
  it("itemScore uses the 1-indexed (rarity+1)(quality+1)(iLevel)(10) form", () => {
    expect(itemScore({ rarity: "standard", quality: 0, iLevel: 1 })).toBe((1 + 1) * (0 + 1) * 1 * 10); // 20
    expect(itemScore({ rarity: "augmented", quality: 2, iLevel: 100 })).toBe((2 + 1) * (2 + 1) * 100 * 10); // 9000
  });

  it("maxItemScore uses top rarity, top quality, and the absolute tier ceiling", () => {
    const bp = BLUEPRINTS.autocannonBp;
    expect(maxItemScore(bp)).toBe((5 + 1) * (5 + 1) * (bp.tier * 20) * 10);
  });

  it("archivableBlueprints returns only equipment-minting blueprints, non-empty", () => {
    const list = archivableBlueprints();
    expect(list.length).toBeGreaterThan(0);
    expect(list.some((e) => e.key === "autocannonBp")).toBe(true);
  });

  it("archiveCompletion is 0% on an empty archive but has a positive maximum", () => {
    const c = archiveCompletion(freshState());
    expect(c.total).toBe(0);
    expect(c.pct).toBe(0);
    expect(c.max).toBeGreaterThan(0);
  });

  function stateWithSpare(overrides: any = {}): any {
    const base = freshState();
    const inst = {
      ...base.equipment[0], id: "equip-x", blueprintKey: "autocannonBp", slotType: "weapon",
      rarity: "augmented", quality: 2, iLevel: 5, fittedToShipId: null, committedToLoadoutId: undefined,
      ...overrides,
    };
    return { ...base, equipment: [...base.equipment, inst] };
  }

  it("archiveItem consumes the spare and records its score", () => {
    const after = archiveItem(stateWithSpare(), "equip-x");
    expect(after.equipment.find((e: any) => e.id === "equip-x")).toBeUndefined(); // consumed
    expect(after.archive.autocannonBp).toBe(itemScore({ rarity: "augmented", quality: 2, iLevel: 5 }));
  });

  it("archiveItem keeps the BEST score (a worse item does not lower it, but is still consumed)", () => {
    const s: any = { ...stateWithSpare({ rarity: "standard", quality: 0, iLevel: 1 }), archive: { autocannonBp: 9999 } };
    const after = archiveItem(s, "equip-x");
    expect(after.equipment.find((e: any) => e.id === "equip-x")).toBeUndefined(); // still consumed
    expect(after.archive.autocannonBp).toBe(9999); // best kept
  });

  it("archiveItem refuses a baseline (no blueprintKey), a fitted, or a committed instance", () => {
    const baseline: any = stateWithSpare();
    baseline.equipment = baseline.equipment.map((e: any) => (e.id === "equip-x" ? { ...e, blueprintKey: null } : e));
    expect(archiveItem(baseline, "equip-x")).toBe(baseline);

    const fitted = stateWithSpare({ fittedToShipId: "ship-1" });
    expect(archiveItem(fitted, "equip-x")).toBe(fitted);

    const committed = stateWithSpare({ committedToLoadoutId: "loadout-1" });
    expect(archiveItem(committed, "equip-x")).toBe(committed);
  });
});
