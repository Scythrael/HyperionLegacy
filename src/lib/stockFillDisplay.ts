// stockFillDisplay.ts: how full an item's warehouse shelf is (0.14.0, Gas Giant Study GG-6 review). The canister
// shelf and the Data study tab read it, so a stock at its cap reads full there exactly as on the warehouse grid: the
// claim and every producer deposit clamp at the cap (tick.ts itemCap), so a full shelf must never look roomy.
//
// DISPLAY ONLY: the same readers the warehouse grid uses (inventory.ts itemTotal, tick.ts itemCap and materialAtCap).

import Decimal from "break_infinity.js";
import type { GameState } from "./game/model";
import { itemTotal } from "./game/inventory";
import { itemCap, materialAtCap } from "./game/tick";

// tick.ts's "no cap" sentinel is astronomically large; anything this big reads as uncapped.
const UNCAPPED = new Decimal("1e99");

export interface StockFillView {
  held: Decimal;
  cap: Decimal | null; // null: no warehouse cap for this item
  pct: number; // whole percent, floored (a 99.6% shelf never reads 100% while it still takes stock)
  full: boolean; // at its cap (the grid's materialAtCap, once the item is discovered)
}

// The shelf fill of `itemId`. Pure.
export function stockFill(state: GameState, itemId: string): StockFillView {
  const held = itemTotal(state.inventory, itemId);
  const capRaw = itemCap(state, itemId);
  const cap = capRaw.gte(UNCAPPED) ? null : capRaw;
  const full = state.discovered.includes(itemId) && materialAtCap(state, itemId);
  const pct = full ? 100 : cap === null || cap.lte(0) ? 0 : Math.floor(Math.max(0, Math.min(100, held.div(cap).times(100).toNumber())));
  return { held, cap, pct, full };
}
