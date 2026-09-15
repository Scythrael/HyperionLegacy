// inspectBlank.test.ts — ITEM LIFECYCLE 0.13.6.
//
// Proves the INSPECT action in isolation (before crafting is flipped to produce blanks, so the
// tests seed state.blanks directly). Inspect is the seam that moves the roll off the tick's threaded
// rng onto the per-inspect inspectSeed, so the load-bearing properties are: it consumes exactly one
// blank, mints exactly one spare into the rolled pool, advances the seed by one, and is
// reload-deterministic (the whole anti-save-scum point).
import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import { freshState } from "./model";
import { inspectBlank } from "./tick";

describe("inspectBlank (Item Lifecycle 0.13.6)", () => {
  const KEY = "prospectorHoldBp"; // a real equipment blueprint (cargoBay / prospectorHold)

  function withBlanks(n: number) {
    return { ...freshState(), blanks: { [KEY]: new Decimal(n) } };
  }

  it("no-ops (same reference) when there is no blank of that type", () => {
    const s = freshState();
    expect(inspectBlank(s, KEY)).toBe(s);
  });

  it("no-ops on an unknown blueprint key even if a count exists (never consumes it)", () => {
    const s: any = { ...freshState(), blanks: { notARealBlueprint: new Decimal(3) } };
    expect(inspectBlank(s, "notARealBlueprint")).toBe(s);
  });

  it("consumes one blank, mints one spare into the rolled pool, advances the seed + id source", () => {
    const before = withBlanks(2);
    const startEquip = before.equipment.length;
    const after = inspectBlank(before, KEY);
    expect(after).not.toBe(before);
    expect(after.blanks[KEY].toString()).toBe("1"); // one consumed
    expect(after.equipment.length).toBe(startEquip + 1); // one minted
    const minted = after.equipment[after.equipment.length - 1];
    expect(minted.fittedToShipId).toBeNull(); // a spare, not fitted
    expect(minted.slotType).toBe("cargoBay");
    expect(after.inspectSeed).toBe(before.inspectSeed + 1); // seed advanced by exactly one
    expect(after.nextEquipmentId).toBe(before.nextEquipmentId + 1);
  });

  it("drops the blank key entirely when the last one is inspected", () => {
    const after = inspectBlank(withBlanks(1), KEY);
    expect(after.blanks[KEY]).toBeUndefined();
  });

  it("is reload-deterministic: the SAME seed rolls the SAME piece (no save-scum reroll)", () => {
    const s = withBlanks(1);
    const a = inspectBlank(s, KEY).equipment.slice(-1)[0]; // same input state...
    const b = inspectBlank(s, KEY).equipment.slice(-1)[0]; // ...= same seed = same roll
    expect(a.rarity).toBe(b.rarity);
    expect(a.quality).toBe(b.quality);
    expect(a.iLevel).toBe(b.iLevel);
  });

  it("stamps the auto-salvage grace window at inspect time (grace moves to instantiation)", () => {
    const s = { ...withBlanks(1), gameTimeSeconds: 12345 };
    const minted = inspectBlank(s, KEY).equipment.slice(-1)[0];
    expect(minted.graceStartedAtGameSeconds).toBe(12345);
  });
});
