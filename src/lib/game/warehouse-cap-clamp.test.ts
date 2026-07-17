// ============================================================================
// Warehouse cap clamp, producer deposits are clamped at the item's storage cap
// (fix/warehouse-cap-clamp, 2026-07-16).
//
// THE BUG: a material could OVERSHOOT its warehouse cap. The `materialAtCap`
// auto-stop only prevents a producer from STARTING when already at cap, it does
// NOT clamp the DEPOSIT itself, so a mission cycle (or a producer job) completing
// while just UNDER cap dumps its whole haul PAST the cap (user saw Deuterium Ice at
// 1.3M against a 1M cap).
//
// THE FIX: every producer deposit routes through the shared `addToInventory` seam,
// which now CLAMPS each add at the item's cap via `Decimal.min(have+amount, cap)`.
// Excess is silently discarded (standard idle-game "storage full = overflow lost").
// `itemCap(state, itemId)` supplies the cap; an unknown item or an un-warehoused
// tier fails OPEN to the WAREHOUSE_UNCAPPED_SENTINEL (1e1000), against which `min`
// is a no-op for any reachable in-game quantity.
//
// These tests cover: (1) an over-cap deposit lands EXACTLY at cap, overflow gone;
// (2) an uncapped (sentinel) item is never clamped; (3) a below-cap deposit is
// byte-identical to the old plain `.plus()`; (4) itemCap returns the tier cap for a
// capped item and the sentinel for unknown/uncapped; (5) ⚠️ OFFLINE PARITY across a
// cap-crossing mission span, tick(bigSpan) bit-identical to looping
// economyTick(_,1), material ends EXACTLY at cap on both paths (non-vacuous: the
// haul genuinely exceeds the gap left below the cap, so it really overshoots).
// ============================================================================
import { describe, it, expect } from "vitest";
import { addToInventory, itemCap, tierCap, economyTick, tick } from "./tick";
import { freshState, type CaptainMissionState, type MissionKey } from "./model";
import Decimal from "break_infinity.js";

// The sentinel value tierCap/itemCap return for an un-warehoused tier or an unknown
// item id, kept in sync with tick.ts's WAREHOUSE_UNCAPPED_SENTINEL (not exported;
// re-declared here so the test pins the exact fail-open magnitude).
const UNCAPPED_SENTINEL = new Decimal("1e1000");

// Minimal CaptainMissionState builder (mirrors tick.test.ts's own local helper) so a
// captain can be put on a mining mission for the offline-parity span.
function missionCaptain(missionKey: MissionKey = "shortOreRun"): CaptainMissionState {
  return {
    missionKey,
    phase: "ordersReceived",
    phaseProgressTicks: 0,
    cargo: {
      commonOre: new Decimal(0),
      uncommonMaterial: new Decimal(0),
      rareMaterial: new Decimal(0),
    },
    recalled: false,
  };
}

describe("warehouse cap clamp, addToInventory clamps producer deposits at the item's cap", () => {
  // (1) An over-cap deposit lands EXACTLY at the cap; the overflow is discarded.
  it("clamps a deposit that would exceed the cap to EXACTLY the cap (overflow discarded)", () => {
    const state = freshState();
    const cap = itemCap(state, "commonOre"); // tier-1 cap (1,000,000 at level 0)
    // Start 100 below the cap, then deposit 500 -> naive would be cap+400.
    const inventory: Record<string, Decimal> = { commonOre: cap.minus(100) };
    const { inventory: next } = addToInventory(inventory, ["commonOre"], "commonOre", new Decimal(500), cap);
    // Lands AT the cap, never past it.
    expect(next.commonOre.equals(cap)).toBe(true);
    expect(next.commonOre.gt(cap)).toBe(false);
  });

  // (2) An UNCAPPED item (its cap is the sentinel) is never clamped, deposits
  //     accumulate freely, because no reachable quantity approaches 1e1000.
  it("never clamps an uncapped (sentinel-cap) item, deposits accumulate freely", () => {
    const cap = UNCAPPED_SENTINEL;
    let inventory: Record<string, Decimal> = { unknownRaw: new Decimal(0) };
    const disc: string[] = [];
    // A huge single deposit is untouched (1e50 << 1e1000).
    ({ inventory } = addToInventory(inventory, disc, "unknownRaw", new Decimal("1e50"), cap));
    expect(inventory.unknownRaw.equals(new Decimal("1e50"))).toBe(true);
    // A second huge deposit keeps accumulating, min never bites.
    ({ inventory } = addToInventory(inventory, disc, "unknownRaw", new Decimal("1e50"), cap));
    expect(inventory.unknownRaw.equals(new Decimal("2e50"))).toBe(true);
  });

  // (3) A below-cap deposit is byte-identical to the old plain `.plus()`, the clamp
  //     only bites AT/OVER the cap, so ordinary play is completely unaffected.
  it("leaves a below-cap deposit byte-identical to have+amount", () => {
    const state = freshState();
    const cap = itemCap(state, "commonOre"); // 1,000,000, far above these values
    const inventory: Record<string, Decimal> = { commonOre: new Decimal(100) };
    const { inventory: next } = addToInventory(inventory, ["commonOre"], "commonOre", new Decimal(50), cap);
    expect(next.commonOre.equals(new Decimal(150))).toBe(true);
  });

  // (4) itemCap resolves the tier cap for a catalogued item and the fail-open sentinel
  //     for an unknown item id (an un-warehoused tier fails open the same way).
  it("itemCap returns the tier cap for a capped item and the sentinel for an unknown item", () => {
    const state = freshState();
    // commonOre is tier 1 -> its cap is exactly tierCap(state, 1).
    expect(itemCap(state, "commonOre").equals(tierCap(state, 1))).toBe(true);
    // An item id with no ITEMS entry fails OPEN to the uncapped sentinel.
    expect(itemCap(state, "totallyUnknownItemXYZ").equals(UNCAPPED_SENTINEL)).toBe(true);
  });
});

describe("warehouse cap clamp, ⚠️ offline parity across a cap-crossing mission span", () => {
  // (5) The load-bearing parity proof. A captain mines commonOre on shortOreRun with
  //     inventory seeded just below the cap, so a completing cycle CROSSES the cap
  //     mid-span. tick(bigSpan) (which internally loops economyTick(_,1)) must be
  //     bit-identical to a hand loop of economyTick(_,1) over the same span, and the
  //     material must end EXACTLY at the cap on both paths, never over.
  //
  //     Non-vacuity is proven by a CONTROL run from 0: over the same span the haul is
  //     far larger than the tiny gap left below the cap, so the crossing genuinely
  //     overshoots (and the clamp is what pins it to the cap rather than past it).
  it("tick(bigSpan) == looping economyTick(_,1); commonOre ends EXACTLY at cap after a cap crossing", () => {
    const SPAN_TICKS = 300; // > 2 shortOreRun cycles (149 ticks each) -> at least one cycle delivers
    const GAP = new Decimal(10); // seed the inventory this far below the cap

    // Fresh, fully-configured fixture, built identically for every path (freshState is
    // deterministic). fuel-rich so the auto-repeat never stalls on the fuel gate.
    const makeState = (startCommonOre: Decimal) => {
      const s = freshState();
      s.captains[0].mission = missionCaptain("shortOreRun");
      s.fuel = new Decimal(1_000_000);
      s.inventory = { ...s.inventory, commonOre: startCommonOre };
      return s;
    };

    // The tier-1 cap (same for every fixture, freshState warehouse level is identical).
    const cap = itemCap(freshState(), "commonOre");

    // --- CONTROL: from 0, how much commonOre does this span actually deliver? ---
    // Proves the haul is real and far exceeds GAP (so the crossing genuinely overshoots).
    const controlResult = tick(SPAN_TICKS, makeState(new Decimal(0)), () => 0.999);
    const delivered = controlResult.inventory.commonOre;
    expect(delivered.gt(GAP)).toBe(true); // haul > gap => the crossing is non-vacuous

    // --- OFFLINE path: one tick(bigSpan) call (internally loops economyTick(state,1)). ---
    const viaTick = tick(SPAN_TICKS, makeState(cap.minus(GAP)), () => 0.999);

    // --- HAND-LOOPED path: economyTick(_,1) SPAN_TICKS times, same constant rng. ---
    let stepped = makeState(cap.minus(GAP));
    for (let i = 0; i < SPAN_TICKS; i++) {
      stepped = economyTick(stepped, 1, () => 0.999);
    }

    // Bit-identical across the two paths (parity), AND both land EXACTLY at the cap.
    expect(viaTick.inventory.commonOre.equals(stepped.inventory.commonOre)).toBe(true);
    expect(viaTick.inventory.commonOre.equals(cap)).toBe(true);
    expect(viaTick.inventory.commonOre.gt(cap)).toBe(false); // never overshoots
  });
});
