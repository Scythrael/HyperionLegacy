// GG-6 review: the canister shelf and the Data study tab read the warehouse grid's fill and full state, so a stock at
// its cap never looks roomy (the claim clamps there).

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import { freshState, type GameState } from "./game/model";
import { addItemQuality } from "./game/inventory";
import { itemCap, materialAtCap } from "./game/tick";
import { stockFill } from "./stockFillDisplay";

function holding(id: string, n: number, discovered = true): GameState {
  const base = freshState();
  return { ...base, inventory: addItemQuality(base.inventory, id, new Decimal(n), 0), discovered: discovered ? [...base.discovered, id] : base.discovered };
}

describe("stock fill (the warehouse grid's treatment)", () => {
  it("floors the percent of the cap and reads full exactly when materialAtCap does", () => {
    const id = "hydrogenCanister";
    const cap = itemCap(freshState(), id).toNumber();
    const half = stockFill(holding(id, Math.floor(cap / 2)), id);
    expect(half.cap?.toNumber()).toBe(cap);
    expect(half.pct).toBe(Math.floor((Math.floor(cap / 2) / cap) * 100));
    expect(half.full).toBe(false);
    const nearly = stockFill(holding(id, cap - 1), id);
    expect(nearly.pct).toBeLessThan(100);
    expect(nearly.full).toBe(false);
    const s = holding(id, cap);
    expect(materialAtCap(s, id)).toBe(true);
    expect(stockFill(s, id)).toMatchObject({ pct: 100, full: true });
  });

  it("an undiscovered item never reads full (the grid's rule)", () => {
    const id = "methaneCanister";
    const cap = itemCap(freshState(), id).toNumber();
    expect(stockFill(holding(id, cap, false), id).full).toBe(false);
  });
});
