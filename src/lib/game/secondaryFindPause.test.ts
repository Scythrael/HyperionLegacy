// ============================================================================
// Fix round answers Q12 (user 2026-11-17, "Stop at the cap"): a mission's SECONDARY find (its loot table's uncommon
// and rare items) is a producer that pauses at the cap. With that item at or over its cap at the start of a tick, the
// tick's find of it does not land (no partial trim, not gathered); under the cap it lands in full. The primary
// delivery and every other deposit still never discard (Q8 "Keep it wide"). The Storage Help says the same.
// ============================================================================
import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import { freshState, MISSIONS, type GameState } from "./model";
import { itemTotal } from "./inventory";
import { dispatchCaptainOnMission, economyTick, itemCap, pauseCappedSecondaryFinds, tick } from "./tick";
import { withAnswersOff } from "./fixRoundAnswersSwitch.fixture";
import { HELP_TOPICS } from "../helpTopics";

const MISSION = "shortOreRun" as const;
const SECONDARY = MISSIONS[MISSION].lootTable.uncommon; // "uncommonMaterial"
const RARE = MISSIONS[MISSION].lootTable.rare;
const PRIMARY = MISSIONS[MISSION].primaryMaterial;
const CYCLE_TICKS = 149; // shortOreRun: 1 orders + 25 out + 90 extract + 25 back + 8 unload

// A seeded rng (an LCG) so tier rolls land on every tier across a cycle.
function seeded(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

function step(state: GameState, n: number, rng: () => number): GameState {
  let s = state;
  for (let i = 0; i < n; i++) s = economyTick(s, 1, rng);
  return s;
}

function withStock(s: GameState, itemId: string, amount: Decimal): GameState {
  return { ...s, inventory: { ...s.inventory, [itemId]: [amount] } };
}

function run(stock: (cap: Decimal) => Decimal): { before: Decimal; after: GameState } {
  const base = dispatchCaptainOnMission(freshState(), 1, MISSION).next;
  const before = stock(itemCap(base, SECONDARY));
  const after = step(withStock(base, SECONDARY, before), CYCLE_TICKS * 3, seeded(7));
  return { before, after };
}

describe("Q12: a mission's secondary find pauses at the cap", () => {
  it("the run really finds the secondary item (the baseline the pins read)", () => {
    const { before, after } = run(() => new Decimal(0));
    expect(itemTotal(after.inventory, SECONDARY).gt(before)).toBe(true);
  });

  it("at the cap, the find does not land and is not gathered; the primary still lands", () => {
    const { before, after } = run((cap) => cap);
    expect(itemTotal(after.inventory, SECONDARY).equals(before)).toBe(true);
    expect(after.lifetimeStats.itemsGathered[SECONDARY]?.gt(0) ?? false).toBe(false);
    expect(itemTotal(after.inventory, PRIMARY).gt(0)).toBe(true);
  });

  it("over the cap, nothing is trimmed and nothing lands", () => {
    const { before, after } = run((cap) => cap.plus(500));
    expect(itemTotal(after.inventory, SECONDARY).equals(before)).toBe(true);
  });

  it("switch off: the capped find lands in full, as before (the FR-C never-discard deposit)", () => {
    const out = withAnswersOff(["secondaryFindPause"], () => run((cap) => cap));
    expect(itemTotal(out.after.inventory, SECONDARY).gt(out.before)).toBe(true);
  });

  it("one under the cap: the find lands in full and may sit over the cap (no partial trim)", () => {
    const on = run((cap) => cap.minus(1));
    const off = withAnswersOff(["secondaryFindPause"], () => run((cap) => cap.minus(1)));
    const cap = itemCap(on.after, SECONDARY);
    const landedOn = itemTotal(on.after.inventory, SECONDARY);
    // The first find crosses the cap in full; later finds then pause, so it ends over the cap but at or under the
    // never-paused total.
    expect(landedOn.gt(cap)).toBe(true);
    expect(landedOn.lte(itemTotal(off.after.inventory, SECONDARY))).toBe(true);
  });

  it("offline equals live: one tick() call equals stepping one tick at a time", () => {
    const base = dispatchCaptainOnMission(freshState(), 1, MISSION).next;
    const start = withStock(base, SECONDARY, itemCap(base, SECONDARY).minus(1));
    const live = step(start, CYCLE_TICKS * 3, seeded(11));
    const offline = tick(CYCLE_TICKS * 3 * start.tickDurationSeconds, start, seeded(11));
    expect(itemTotal(offline.inventory, SECONDARY).equals(itemTotal(live.inventory, SECONDARY))).toBe(true);
    expect(itemTotal(offline.inventory, PRIMARY).equals(itemTotal(live.inventory, PRIMARY))).toBe(true);
    expect(itemTotal(offline.inventory, RARE).equals(itemTotal(live.inventory, RARE))).toBe(true);
  });

  it("the helper leaves the primary and any uncapped item alone, and returns the same objects when nothing is capped", () => {
    const base = freshState();
    const delta = { [PRIMARY]: new Decimal(10), [SECONDARY]: new Decimal(2), [RARE]: new Decimal(1) };
    const life = { itemsGathered: { ...delta }, missionsCompleted: {}, creditsEarned: new Decimal(0), captainXpAwarded: new Decimal(0), fleetAdminXpAwarded: new Decimal(0) };
    const none = pauseCappedSecondaryFinds(base, MISSION, delta, life);
    expect(none.delta).toBe(delta);
    expect(none.lifetimeStatsDelta).toBe(life);
    const full = withStock(withStock(base, PRIMARY, itemCap(base, PRIMARY)), SECONDARY, itemCap(base, SECONDARY));
    const out = pauseCappedSecondaryFinds(full, MISSION, delta, life);
    expect(Object.keys(out.delta).sort()).toEqual([PRIMARY, RARE].sort());
    expect(Object.keys(out.lifetimeStatsDelta.itemsGathered).sort()).toEqual([PRIMARY, RARE].sort());
  });

  it("the Storage Help states the rule", () => {
    const storage = HELP_TOPICS.find((t) => t.id === "storage")!;
    expect(storage.body).toContain("A mission's extra finds pause the same way: while a material is at its cap, a mission collects none of it as an extra find");
    expect(storage.body).not.toContain("(a mission's extra finds,");
  });
});
