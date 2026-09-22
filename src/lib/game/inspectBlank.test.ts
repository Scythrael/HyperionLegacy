// inspectBlank.test.ts — ITEM LIFECYCLE 0.13.6.
//
// Proves the INSPECT action in isolation (before crafting is flipped to produce blanks, so the
// tests seed state.blanks directly). Inspect is the seam that moves the roll off the tick's threaded
// rng onto the per-inspect inspectSeed, so the load-bearing properties are: it consumes exactly one
// blank, mints exactly one spare into the rolled pool, advances the seed by one, and is
// reload-deterministic (the whole anti-save-scum point).
import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import {
  freshState,
  EQUIPMENT_STORAGE_CAP_BASE,
  freeEquipmentSlots,
  spareEquipmentCount,
  equipmentStorageCap,
  type GameState,
} from "./model";
import { inspectBlank, inspectBlanks } from "./tick";

describe("inspectBlank (Item Lifecycle 0.13.6)", () => {
  const KEY = "prospectorHoldBp"; // a real equipment blueprint (cargoBay / prospectorHold)

  function withBlanks(n: number) {
    return { ...freshState(), blanks: { [KEY]: new Decimal(n) } };
  }

  // Crafted Blanks 0.13.7: seed the spare bay with `occupied` stub spare crafted systems
  // (leaving cap - occupied free) plus `n` blanks of KEY. Only fittedToShipId (null =
  // spare) and blueprintKey (non-null = crafted) are read by spareEquipmentCount, so a
  // minimal stub is enough to drive freeEquipmentSlots.
  function withBayOccupied(occupied: number, n: number) {
    const s = withBlanks(n);
    const filler = Array.from({ length: occupied }, (_, i) => ({
      id: `filler-${i}`,
      fittedToShipId: null,
      blueprintKey: KEY,
    })) as unknown as (typeof s)["equipment"];
    return { ...s, equipment: filler };
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

  // Crafted Blanks 0.13.7: inspectBlank now honors the spare-bay cap (closes the 0.13.6 gap).
  it("no-ops (same reference) when the spare bay is already at cap, even with a blank held", () => {
    const s = withBayOccupied(EQUIPMENT_STORAGE_CAP_BASE, 3);
    expect(freeEquipmentSlots(s)).toBe(0);
    expect(inspectBlank(s, KEY)).toBe(s); // cap-full: no-op, blank untouched
  });

  // Atomicity: a refused inspect (bay at cap) must waste NOTHING. No blank decremented, no seed
  // burned, same-ref state, so "blank consumed but roll refused" is impossible.
  it("refused at cap wastes nothing: blanks held and inspectSeed unchanged, same-ref", () => {
    const s = withBayOccupied(EQUIPMENT_STORAGE_CAP_BASE, 1);
    const heldBefore = s.blanks[KEY].toString();
    const seedBefore = s.inspectSeed;
    const after = inspectBlank(s, KEY);
    expect(after).toBe(s);
    expect(after.blanks[KEY].toString()).toBe(heldBefore); // blank preserved
    expect(after.inspectSeed).toBe(seedBefore); // seed not advanced
  });
});

describe("inspectBlanks (Crafted Blanks 0.13.7 bulk inspect)", () => {
  const KEY = "prospectorHoldBp";

  function withBlanks(n: number) {
    return { ...freshState(), blanks: { [KEY]: new Decimal(n) } };
  }
  function withBayOccupied(occupied: number, n: number) {
    const s = withBlanks(n);
    const filler = Array.from({ length: occupied }, (_, i) => ({
      id: `filler-${i}`,
      fittedToShipId: null,
      blueprintKey: KEY,
    })) as unknown as (typeof s)["equipment"];
    return { ...s, equipment: filler };
  }

  it("bay full => 0 inspected and returns the same-ref state", () => {
    const s = withBayOccupied(EQUIPMENT_STORAGE_CAP_BASE, 5);
    const { state, inspected } = inspectBlanks(s, KEY, 5);
    expect(inspected).toBe(0);
    expect(state).toBe(s);
  });

  it("qty <= 0 is a same-ref no-op (0 inspected)", () => {
    const s = withBlanks(5);
    expect(inspectBlanks(s, KEY, 0).state).toBe(s);
    expect(inspectBlanks(s, KEY, 0).inspected).toBe(0);
    expect(inspectBlanks(s, KEY, -3).state).toBe(s);
  });

  it("clamps to free spare-bay slots when qty exceeds them, never exceeding cap", () => {
    // (cap - 2) occupied leaves exactly 2 free; hold 10 blanks; ask for 10.
    const s = withBayOccupied(EQUIPMENT_STORAGE_CAP_BASE - 2, 10);
    expect(freeEquipmentSlots(s)).toBe(2);
    const { state, inspected } = inspectBlanks(s, KEY, 10);
    expect(inspected).toBe(2); // physically fit
    expect(spareEquipmentCount(state)).toBe(EQUIPMENT_STORAGE_CAP_BASE); // filled to cap
    expect(spareEquipmentCount(state)).toBeLessThanOrEqual(equipmentStorageCap(state));
    expect(state.blanks[KEY].toString()).toBe("8"); // only 2 blanks consumed
  });

  it("preserves the blanks that did not fit (only what fit is consumed), never past cap", () => {
    // One free slot, three blanks held, ask for three: exactly one fits, two are PRESERVED.
    const s = withBayOccupied(EQUIPMENT_STORAGE_CAP_BASE - 1, 3);
    expect(freeEquipmentSlots(s)).toBe(1);
    const { state, inspected } = inspectBlanks(s, KEY, 3);
    expect(inspected).toBe(1);
    expect(state.blanks[KEY].toString()).toBe("2"); // the two that did not fit are kept
    expect(spareEquipmentCount(state)).toBe(EQUIPMENT_STORAGE_CAP_BASE);
    expect(spareEquipmentCount(state)).toBeLessThanOrEqual(equipmentStorageCap(state));
  });

  it("clamps to blanks held when qty exceeds what is held", () => {
    const s = withBlanks(3); // empty bay (plenty free), only 3 blanks
    const { state, inspected } = inspectBlanks(s, KEY, 10);
    expect(inspected).toBe(3);
    expect(state.blanks[KEY]).toBeUndefined(); // all held blanks consumed
  });

  it("returns the minted spares in roll order: pieces.length === inspected and they ARE the new spares", () => {
    const before = withBlanks(4);
    const startEquip = before.equipment.length;
    const { state, inspected, pieces } = inspectBlanks(before, KEY, 3);
    expect(inspected).toBe(3);
    expect(pieces.length).toBe(3); // one piece per inspect
    // The returned pieces are exactly the newly appended spares (roll order), by reference.
    const minted = state.equipment.slice(startEquip);
    expect(pieces).toEqual(minted);
    expect(pieces.map((p) => p.id)).toEqual(minted.map((p) => p.id));
    // Every one is a spare crafted system (not fitted, has a blueprint).
    for (const p of pieces) {
      expect(p.fittedToShipId).toBeNull();
      expect(p.blueprintKey).not.toBeNull();
    }
  });

  it("clamps pieces to what actually fit (pieces.length tracks inspected, not qty)", () => {
    const s = withBayOccupied(EQUIPMENT_STORAGE_CAP_BASE - 2, 10); // exactly 2 free
    const { inspected, pieces } = inspectBlanks(s, KEY, 10);
    expect(inspected).toBe(2);
    expect(pieces.length).toBe(2);
  });

  it("returns an empty pieces array on a no-op (bay full)", () => {
    const s = withBayOccupied(EQUIPMENT_STORAGE_CAP_BASE, 5);
    expect(inspectBlanks(s, KEY, 5).pieces).toEqual([]);
  });

  it("is byte-identical to inspecting one at a time n times (determinism preserved)", () => {
    const bulk = inspectBlanks(withBlanks(4), KEY, 3).state;
    let singles: GameState = withBlanks(4);
    for (let i = 0; i < 3; i++) singles = inspectBlank(singles, KEY);
    // Same seed advancement, same id source, same rolled pool.
    expect(bulk.inspectSeed).toBe(singles.inspectSeed);
    expect(bulk.nextEquipmentId).toBe(singles.nextEquipmentId);
    expect(bulk.blanks[KEY].toString()).toBe(singles.blanks[KEY].toString());
    expect(bulk.equipment.length).toBe(singles.equipment.length);
    const rolls = (st: typeof bulk) => st.equipment.map((e) => `${e.rarity}:${e.quality}:${e.iLevel}`);
    expect(rolls(bulk)).toEqual(rolls(singles));
  });
});
