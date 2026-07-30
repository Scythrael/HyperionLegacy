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
import { freshState, xpForNextLevel, xpForNextFleetAdminLevel, type GameState } from "./model";
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
    expect(summary.missionsByType).toEqual([]);
    expect(summary.creditsEarned.eq(0)).toBe(true);
    expect(summary.fleetXpGained.eq(0)).toBe(true);
    expect(summary.fleetLevelsGained).toBe(0);
    expect(summary.materialsGained).toEqual([]);
    expect(summary.captainsProgressed).toEqual([]);
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

  it("breaks missions completed down by type (Combat / Gathering / Other), summed per type", () => {
    const { before, after } = twoFreshStates();
    // shortOreRun is a real EXTRACTION mission key (-> Gathering); crimsonReaverSweep is a real
    // PATROL key (-> Combat); legacyGhostRun is neither (-> Other, the fallback bucket).
    before.lifetimeStats.missionsCompleted = { shortOreRun: new Decimal(2) };
    after.lifetimeStats.missionsCompleted = {
      shortOreRun: new Decimal(5), // +3 Gathering
      crimsonReaverSweep: new Decimal(3), // +3 Combat
      legacyGhostRun: new Decimal(4), // +4 Other (unknown key)
    };

    const summary = summarizeOfflineProgress(before, after, 900);
    // Fixed display order: Combat, Gathering, Other.
    expect(summary.missionsByType).toEqual([
      { type: "Combat", count: 3 },
      { type: "Gathering", count: 3 },
      { type: "Other", count: 4 },
    ]);
    expect(summary.hasContent).toBe(true);
  });

  it("reports a captain's gross xp earned across level-ups, plus levels gained", () => {
    const { before, after } = twoFreshStates();
    // freshState seeds captain id 1 at level 1, xp 0. Model a level-up to 3 with 40 xp leftover.
    // captain.xp is leftover-toward-next-level (it resets on level-up), so the GROSS xp earned is
    // the leftover (40) PLUS the two thresholds crossed (level 1 -> 2, level 2 -> 3).
    after.captains = after.captains.map((c) =>
      c.id === 1 ? { ...c, level: 3, xp: new Decimal(40) } : c
    );
    const expectedXp = new Decimal(40).plus(xpForNextLevel(1)).plus(xpForNextLevel(2));

    const summary = summarizeOfflineProgress(before, after, 1800);
    expect(summary.captainsProgressed).toHaveLength(1);
    expect(summary.captainsProgressed[0]).toMatchObject({ id: 1, levelsGained: 2 });
    expect(summary.captainsProgressed[0].name).toBe(before.captains[0].label);
    expect(summary.captainsProgressed[0].xpGained.eq(expectedXp)).toBe(true);
  });

  it("lists a captain that earned xp WITHOUT leveling (levelsGained 0)", () => {
    const { before, after } = twoFreshStates();
    // Same level (1), xp 0 -> 150: 150 gross xp earned, no threshold crossed.
    after.captains = after.captains.map((c) =>
      c.id === 1 ? { ...c, xp: new Decimal(150) } : c
    );

    const summary = summarizeOfflineProgress(before, after, 600);
    expect(summary.captainsProgressed).toHaveLength(1);
    expect(summary.captainsProgressed[0]).toMatchObject({ id: 1, levelsGained: 0 });
    expect(summary.captainsProgressed[0].xpGained.eq(150)).toBe(true);
  });

  it("reports Fleet Admiral gross xp earned across level-ups, plus levels gained", () => {
    const { before, after } = twoFreshStates();
    // freshState seeds fleetAdminLevel 1, fleetAdminXp 0. Model climbing to level 3 with 50 xp
    // leftover: gross earned = leftover (50) + thresholds for FA levels 1 and 2.
    before.fleetAdminLevel = 1;
    before.fleetAdminXp = new Decimal(0);
    after.fleetAdminLevel = 3;
    after.fleetAdminXp = new Decimal(50);
    const expectedFaXp = new Decimal(50)
      .plus(xpForNextFleetAdminLevel(1))
      .plus(xpForNextFleetAdminLevel(2));

    const summary = summarizeOfflineProgress(before, after, 1800);
    expect(summary.fleetLevelsGained).toBe(2);
    expect(summary.fleetXpGained.eq(expectedFaXp)).toBe(true);
    expect(summary.hasContent).toBe(true);
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
    expect(summary.missionsByType).toEqual([]);
    expect(summary.creditsEarned.eq(0)).toBe(true);
    expect(summary.fleetXpGained.eq(0)).toBe(true);
    expect(summary.fleetLevelsGained).toBe(0);
    expect(summary.materialsGained).toEqual([]);
    expect(summary.captainsProgressed).toEqual([]);
    expect(summary.shipsInRepair).toEqual([]);
  });
});
