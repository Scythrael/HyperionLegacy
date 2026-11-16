// ============================================================================
// Quartermaster SELL counter (0.13.6). See quartermaster.ts's SELL section.
//
// WHAT THIS SUITE FENCES:
//   (1) THE GUARD IS LOAD-BEARING. Only an item with a sellValue can be sold. A real,
//       owned, NON-sellable item (commonOre) is refused with notSellable and nothing
//       is written, and so is an unknown id. This is the safety story for the whole
//       "sell anything later" seam.
//   (2) THE DERIVED SHELF. sellableInventory lists only sellable items the player
//       actually holds (owned > 0), with the derived unit value, and never a
//       non-sellable good.
//   (3) THE MATH + IMMUTABILITY. sellItem credits qty * sellValue, drains the units,
//       and never mutates the input state.
//   (4) THE BOUND. qty <= 0 and qty > owned are typed refusals that write nothing.
// ============================================================================
import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import { freshState, ITEMS, type GameState } from "./model";
import { canSell, isRetiredStock, sellItem, sellableInventory } from "./quartermaster";

// Deuterium Ice was the first item flagged sellable (0.13.6). Its price, 40 then, is 4 since the user's 2026-10-21 call
// ("Cut ice to ~4 credits"): a crafting input, not a money run (model.ts DEUTERIUM_ICE_SELL_VALUE).
const ICE_VALUE = 4;

function stocked(ice: number, ore: number, credits = 1000): GameState {
  const base = freshState();
  return {
    ...base,
    inventory: {
      ...base.inventory,
      deuteriumIce: [new Decimal(ice)],
      commonOre: [new Decimal(ore)],
    },
    credits: new Decimal(credits),
  };
}

describe("Quartermaster sell: the sellable-flag guard", () => {
  it("Deuterium Ice carries its sellValue (4 cr/unit); commonOre carries none", () => {
    expect(ITEMS.deuteriumIce.sellValue).toBe(ICE_VALUE);
    expect(ITEMS.commonOre.sellValue).toBeUndefined();
  });

  it("refuses a real, owned, NON-sellable item and writes nothing", () => {
    const state = stocked(0, 50);
    const gate = canSell(state, "commonOre", new Decimal(10));
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toBe("notSellable");

    const result = sellItem(state, "commonOre", new Decimal(10));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("notSellable");
  });

  it("refuses an unknown item id", () => {
    const state = stocked(100, 0);
    const gate = canSell(state, "notARealItem", new Decimal(1));
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toBe("notSellable");
  });
});

describe("Quartermaster sell: the derived shelf", () => {
  it("lists a sellable item only when the player holds some", () => {
    expect(sellableInventory(stocked(0, 50)).some((e) => e.itemId === "deuteriumIce")).toBe(false);
    const held = sellableInventory(stocked(120, 50));
    const ice = held.find((e) => e.itemId === "deuteriumIce");
    expect(ice).toBeDefined();
    expect(ice?.owned.toNumber()).toBe(120);
    expect(ice?.unitValue).toBe(ICE_VALUE);
  });

  it("never lists a non-sellable good, however much is held", () => {
    const held = sellableInventory(stocked(10, 9999));
    expect(held.some((e) => e.itemId === "commonOre")).toBe(false);
  });
});

describe("Quartermaster sell: the math + immutability", () => {
  it("credits qty * value, drains the units, and does not mutate the input", () => {
    const state = stocked(100, 0, 1000);
    const result = sellItem(state, "deuteriumIce", new Decimal(30));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.credited.toNumber()).toBe(30 * ICE_VALUE); // 120
    expect(result.unitsSold.toNumber()).toBe(30);
    expect(result.next.credits.toNumber()).toBe(1000 + 30 * ICE_VALUE);
    expect(result.next.inventory.deuteriumIce.reduce((s, b) => s + b.toNumber(), 0)).toBe(70);
    // input untouched
    expect(state.credits.toNumber()).toBe(1000);
    expect(state.inventory.deuteriumIce[0].toNumber()).toBe(100);
  });

  it("selling all empties the stock", () => {
    const state = stocked(250, 0, 0);
    const result = sellItem(state, "deuteriumIce", new Decimal(250));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.next.credits.toNumber()).toBe(250 * ICE_VALUE); // 1000
    expect(result.next.inventory.deuteriumIce.reduce((s, b) => s + b.toNumber(), 0)).toBe(0);
  });
});

describe("Quartermaster sell: the bound", () => {
  it("refuses a non-positive quantity", () => {
    const state = stocked(100, 0);
    for (const qty of [new Decimal(0), new Decimal(-5)]) {
      const gate = canSell(state, "deuteriumIce", qty);
      expect(gate.ok).toBe(false);
      if (!gate.ok) expect(gate.reason).toBe("noneRequested");
    }
  });

  it("refuses more than is held and writes nothing", () => {
    const state = stocked(100, 0, 500);
    const gate = canSell(state, "deuteriumIce", new Decimal(101));
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toBe("insufficient");

    const result = sellItem(state, "deuteriumIce", new Decimal(101));
    expect(result.ok).toBe(false);
    // input untouched on refusal
    expect(state.credits.toNumber()).toBe(500);
    expect(state.inventory.deuteriumIce[0].toNumber()).toBe(100);
  });
});

// FR-C lane 1 M7 (user 2026-11-13/14, "Sell only free stock (Recommended)"): stock a running line or a queued order has
// reserved is not for sale; the counter sells only the Free amount (the same Free the Warehouse tooltip shows).
describe("Quartermaster sell: only free stock", () => {
  // A running canister line with 5 iterations left reserves 50 ice.
  function reserving(ice: number): GameState {
    const base = stocked(ice, 0, 0);
    return {
      ...base,
      refineLines: [{ id: "line-1", kind: "refine", recipeKey: "refineDeuteriumCanister", remaining: 5, mode: { kind: "batch", remaining: 5 } }],
    };
  }

  it("refuses a sale that would dip into reserved stock, writing nothing", () => {
    const state = reserving(100);
    const gate = canSell(state, "deuteriumIce", new Decimal(51));
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toBe("reserved");
    expect(sellItem(state, "deuteriumIce", new Decimal(51)).ok).toBe(false);
  });

  it("sells up to the free amount", () => {
    const state = reserving(100);
    expect(canSell(state, "deuteriumIce", new Decimal(50)).ok).toBe(true);
  });

  it("the shelf row carries the free amount next to the owned amount", () => {
    const ice = sellableInventory(reserving(100)).find((e) => e.itemId === "deuteriumIce");
    expect(ice?.owned.toNumber()).toBe(100);
    expect(ice?.free.toNumber()).toBe(50);
  });
});

// 0.14.0 (reactor fuel ladder review): the shelf's "Retired" tag reads ItemDef.retired, never every row. Deuterium Ice and
// the canisters have crafting uses, so nothing sellable today is retired.
describe("Quartermaster sell: the Retired tag", () => {
  it("no item is retired today, so no shelf row is tagged", () => {
    expect(Object.keys(ITEMS).filter(isRetiredStock)).toEqual([]);
    expect(isRetiredStock("deuteriumIce")).toBe(false);
    expect(isRetiredStock("deuteriumCanister")).toBe(false);
    expect(isRetiredStock("noSuchItem")).toBe(false);
    const state: GameState = { ...stocked(10, 0), inventory: { ...stocked(10, 0).inventory, deuteriumCanister: [new Decimal(2)] } };
    const shelf = sellableInventory(state);
    expect(shelf.map((e) => e.itemId)).toEqual(expect.arrayContaining(["deuteriumIce", "deuteriumCanister"]));
    expect(shelf.every((e) => e.retired === false)).toBe(true);
  });

  it("an item flagged retired is tagged on the shelf", () => {
    ITEMS.wiringRetiredProbe = { ...ITEMS.deuteriumIce, label: "Retired Probe", retired: true };
    try {
      expect(isRetiredStock("wiringRetiredProbe")).toBe(true);
      const state: GameState = { ...stocked(0, 0), inventory: { ...stocked(0, 0).inventory, wiringRetiredProbe: [new Decimal(1)] } };
      expect(sellableInventory(state).find((e) => e.itemId === "wiringRetiredProbe")?.retired).toBe(true);
    } finally {
      delete ITEMS.wiringRetiredProbe;
    }
  });
});
