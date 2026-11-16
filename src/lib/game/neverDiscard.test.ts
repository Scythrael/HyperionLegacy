// ============================================================================
// FR-C lane 1 M5 / M6 and lane 3 M2 (user 2026-11-13/14, "Never discard (Recommended)": deliveries may sit over the
// cap, nothing trimmed on load, logs show what landed).
//
// Before: addToInventory clamped every deposit at the item's cap (a mission's secondary finds, an expedition haul or a
// craft's output landing on a full stack were silently discarded, and the claim log still named the full haul), and
// every load trimmed any stack over its cap (salvage refunds and kits coming home, which deposit raw, were cut back on
// the next load). Now a deposit always lands in full and a load trims nothing. Producers still PAUSE at the cap (the
// materialAtCap auto-stop, the Storage topic's promise), and a purchase is still refused over the cap: this is only
// about what is delivered.
// ============================================================================
import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import { addToInventory, itemCap, materialAtCap } from "./tick";
import { freshState, type GameState } from "./model";
import { itemTotal } from "./inventory";
import { deserialize, migrate, serialize } from "./save";
import { depositExpeditionFindings } from "./expedition";
import { canBuyFieldKits } from "./quartermaster";

describe("a delivery is never discarded at the cap", () => {
  it("a deposit that crosses the cap lands in full", () => {
    const state = freshState();
    const cap = itemCap(state, "commonOre");
    const { inventory } = addToInventory({ commonOre: [cap.minus(100)] }, ["commonOre"], "commonOre", new Decimal(500), cap);
    expect(itemTotal(inventory, "commonOre").equals(cap.plus(400))).toBe(true);
  });

  it("a stack already over the cap keeps its overshoot when more arrives (no drain)", () => {
    const state = freshState();
    const cap = itemCap(state, "commonOre");
    const { inventory } = addToInventory({ commonOre: [new Decimal(5), cap.plus(100)] }, ["commonOre"], "commonOre", new Decimal(10), cap);
    expect(itemTotal(inventory, "commonOre").equals(cap.plus(115))).toBe(true);
  });

  it("an expedition haul on a full warehouse lands in full, so the claim reads what landed", () => {
    const base = freshState();
    const cap = itemCap(base, "commonOre");
    const state: GameState = { ...base, inventory: { ...base.inventory, commonOre: [cap] } };
    const next = depositExpeditionFindings(state, [{ materials: { commonOre: 250 } } as never]);
    expect(itemTotal(next.inventory, "commonOre").equals(cap.plus(250))).toBe(true);
  });

  it("producers still pause at the cap, and a purchase is still refused over it", () => {
    const base = freshState();
    const cap = itemCap(base, "commonOre");
    const full: GameState = { ...base, inventory: { ...base.inventory, commonOre: [cap.plus(1)] } };
    expect(materialAtCap(full, "commonOre")).toBe(true);
    const kitCap = itemCap(base, "firstAidKit");
    const kits: GameState = { ...base, credits: new Decimal(1e12), inventory: { ...base.inventory, firstAidKit: [kitCap] } };
    expect(canBuyFieldKits(kits, "firstAidKit", 1)).toEqual({ ok: false, reason: "overCap" });
  });
});

describe("a load trims nothing", () => {
  it("a stack over its cap survives a save round trip unchanged", () => {
    const base = freshState();
    const cap = itemCap(base, "commonOre");
    const state: GameState = { ...base, inventory: { ...base.inventory, commonOre: [cap.times(1.5)] } };
    const save = deserialize(serialize(state, 0, 0));
    expect(save).not.toBeNull();
    const loaded = migrate(save!);
    expect(itemTotal(loaded.inventory, "commonOre").equals(cap.times(1.5))).toBe(true);
  });
});
