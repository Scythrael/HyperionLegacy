// ============================================================================
// offlineSummary.test.ts : Combat 0.13.0, Phase 13 (design Section 17)
//
// Locks the PURE before/after diff that feeds the "While you were away" modal.
// The helper never touches the sim; these tests prove it reads the right fields
// off two GameState snapshots and reports the correct deltas, plus the
// hasContent=false "nothing happened" case.
// ============================================================================

import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import { freshState, type GameState } from "./model";
import { addItemQuality } from "./inventory";
import { summarizeOfflineProgress } from "./offlineSummary";

// A deep-enough clone for snapshot tests: freshState builds a new object graph each
// call, so `before` and `after` start as two INDEPENDENT states. We then mutate only
// `after` to model what an offline advance changed. (We never share sub-objects that
// a test mutates, so no cross-contamination between the two snapshots.)
function twoFreshStates(): { before: GameState; after: GameState } {
  return { before: freshState(), after: freshState() };
}

describe("summarizeOfflineProgress", () => {
  it("reports zero content when the two snapshots are identical", () => {
    const { before, after } = twoFreshStates();
    const summary = summarizeOfflineProgress(before, after, 3600);

    expect(summary.hasContent).toBe(false);
    expect(summary.secondsAway).toBe(3600); // passed through verbatim
    expect(summary.missionsCompleted).toBe(0);
    expect(summary.creditsEarned.eq(0)).toBe(true);
    expect(summary.materialsGained).toEqual([]);
    expect(summary.captainsLeveled).toEqual([]);
    expect(summary.shipsInRepair).toEqual([]);
  });

  it("computes the credits delta and clamps a net spend to zero", () => {
    const { before, after } = twoFreshStates();
    before.credits = new Decimal(1000);
    after.credits = new Decimal(3500);

    const gain = summarizeOfflineProgress(before, after, 120);
    expect(gain.hasContent).toBe(true);
    expect(gain.creditsEarned.eq(2500)).toBe(true); // 3500 - 1000

    // A net spend while away is not "earned": it clamps to 0 (and, alone, is no content).
    const spentBefore = freshState();
    const spentAfter = freshState();
    spentBefore.credits = new Decimal(3500);
    spentAfter.credits = new Decimal(1000);
    const spend = summarizeOfflineProgress(spentBefore, spentAfter, 120);
    expect(spend.creditsEarned.eq(0)).toBe(true);
    expect(spend.hasContent).toBe(false);
  });

  it("lists only materials whose total rose, with the positive delta", () => {
    const { before, after } = twoFreshStates();
    // titaniumIngot rises by 40 (across quality bucket 0); a first-ever item also appears.
    after.inventory = addItemQuality(after.inventory, "titaniumIngot", new Decimal(40), 0);
    after.inventory = addItemQuality(after.inventory, "deuteriumIce", new Decimal(7), 0);
    // A material that DROPPED must not be reported. Seed a before-stock and lower it.
    before.inventory = addItemQuality(before.inventory, "titaniumIngot", new Decimal(5), 0);

    const summary = summarizeOfflineProgress(before, after, 600);
    const byId = Object.fromEntries(summary.materialsGained.map((m) => [m.itemId, m.qty]));

    // titaniumIngot: after 40 - before 5 = 35 gained.
    expect(byId["titaniumIngot"].eq(35)).toBe(true);
    expect(byId["deuteriumIce"].eq(7)).toBe(true);
    // Only the two that rose are present (nothing decreased into the list).
    expect(summary.materialsGained.every((m) => m.qty.gt(0))).toBe(true);
  });

  it("reports missions completed as the summed tally delta", () => {
    const { before, after } = twoFreshStates();
    before.lifetimeStats.missionsCompleted = { localAsteroid: new Decimal(2) };
    after.lifetimeStats.missionsCompleted = {
      localAsteroid: new Decimal(5),
      crimsonReaverSweep: new Decimal(3),
    };

    const summary = summarizeOfflineProgress(before, after, 900);
    // (5 - 2) on localAsteroid + (3 - 0) on the new key = 6 total completions.
    expect(summary.missionsCompleted).toBe(6);
    expect(summary.hasContent).toBe(true);
  });

  it("reports a captain that leveled, matched by id, from->to", () => {
    const { before, after } = twoFreshStates();
    // freshState seeds captain id 1 at level 1. Model a level-up to 4 in `after`.
    after.captains = after.captains.map((c) => (c.id === 1 ? { ...c, level: 4 } : c));

    const summary = summarizeOfflineProgress(before, after, 1800);
    expect(summary.captainsLeveled).toHaveLength(1);
    expect(summary.captainsLeveled[0]).toMatchObject({ id: 1, fromLevel: 1, toLevel: 4 });
    expect(summary.captainsLeveled[0].name).toBe(before.captains[0].label);
  });

  it("reports a ship that became damaged (limped home) during the advance", () => {
    const { before, after } = twoFreshStates();
    // freshState's ship-1 starts healthy. Model it limping home into repair.
    after.ships = after.ships.map((s) => (s.id === "ship-1" ? { ...s, damaged: true } : s));

    const summary = summarizeOfflineProgress(before, after, 1200);
    expect(summary.shipsInRepair).toHaveLength(1);
    expect(summary.shipsInRepair[0].id).toBe("ship-1");
    expect(summary.hasContent).toBe(true);

    // A ship ALREADY damaged before the advance is not "news" and is not re-reported.
    const damagedBefore = freshState();
    damagedBefore.ships = damagedBefore.ships.map((s) => ({ ...s, damaged: true }));
    const stillDamaged = freshState();
    stillDamaged.ships = stillDamaged.ships.map((s) => ({ ...s, damaged: true }));
    const noNews = summarizeOfflineProgress(damagedBefore, stillDamaged, 1200);
    expect(noNews.shipsInRepair).toEqual([]);
  });

  it("fails open (empty, no throw) on missing/malformed snapshot fields", () => {
    // A partial object standing in for a corrupt/old snapshot: no captains, ships,
    // inventory, credits, or lifetimeStats. The helper must degrade to empty, not throw.
    const partial = {} as unknown as GameState;
    const summary = summarizeOfflineProgress(partial, partial, 60);
    expect(summary.hasContent).toBe(false);
    expect(summary.missionsCompleted).toBe(0);
    expect(summary.creditsEarned.eq(0)).toBe(true);
    expect(summary.materialsGained).toEqual([]);
    expect(summary.captainsLeveled).toEqual([]);
    expect(summary.shipsInRepair).toEqual([]);
  });
});
