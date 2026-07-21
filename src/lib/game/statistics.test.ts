import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import { freshState } from "./model";
import { deriveStatistics, type StatRow } from "./statistics";

// deriveStatistics(state) is a PURE read/derive over existing GameState fields:
// it sums the lifetimeStats Decimal maps, reads the scalar Decimals, and reports
// live array lengths, returning display-ready { label, value } rows grouped into
// lifetime / career / fleet. No engine state is mutated and nothing new is
// tracked, so every expectation below is hand-traced against freshState() plus a
// few deliberate mutations. Values are formatted through the SAME formatNumber
// the rest of the UI uses (Decimals), so single-digit counts intentionally read
// "5.00" while >= 10 read as clean integers, that is formatNumber's contract,
// pinned in format.test.ts, not this module's concern.

// Small helper: pull a row's formatted value by its label so assertions do not
// depend on row order within a group.
function valueOf(rows: StatRow[], label: string): string {
  const row = rows.find((r) => r.label === label);
  if (!row) throw new Error(`no stat row labeled "${label}"`);
  return row.value;
}

describe("deriveStatistics", () => {
  it("derives lifetime, career, and fleet rows from a known state", () => {
    const state = freshState();

    // --- Career scalars ---------------------------------------------------
    // 142h 18m = 142*3600 + 18*60 = 512280 seconds. Pins the inline play-time
    // formatter (whole hours + minutes, matching the task's "142h 18m" example).
    state.gameTimeSeconds = 512280;
    state.fleetAdminLevel = 7;
    state.craftingLevel = 5;

    // --- Fleet live counts ------------------------------------------------
    // freshState seeds 1 captain, 1 ship, and 4 Standard-Issue equipment
    // pieces; clone-push to reach known counts without fabricating types.
    state.captains.push({ ...state.captains[0] });          // captains -> 2
    state.ships.push({ ...state.ships[0] });                // ships    -> 2
    state.researchedBlueprints.push("bp-alpha");            // -> 1
    state.unlockedHomeworldTalents.push(
      state.unlockedHomeworldTalents[0] ?? ("orbitalMining" as never),
    ); // -> 1

    // --- Lifetime maps + scalars -----------------------------------------
    state.lifetimeStats.missionsCompleted = { alpha: new Decimal(12), beta: new Decimal(8) }; // sum 20
    state.lifetimeStats.itemsGathered = { ore: new Decimal(1500) };
    state.lifetimeStats.itemsRefined = {}; // sum 0
    state.lifetimeStats.itemsCrafted = { gear: new Decimal(40) };
    state.lifetimeStats.creditsEarned = new Decimal(1234567);
    state.lifetimeStats.captainXpAwarded = new Decimal(9500);
    state.lifetimeStats.fleetAdminXpAwarded = new Decimal(0);

    const stats = deriveStatistics(state);

    // Lifetime group.
    expect(valueOf(stats.lifetime, "Missions Completed")).toBe("20");
    expect(valueOf(stats.lifetime, "Items Gathered")).toBe("1.50K");
    expect(valueOf(stats.lifetime, "Items Refined")).toBe("0");
    expect(valueOf(stats.lifetime, "Items Crafted")).toBe("40");
    expect(valueOf(stats.lifetime, "Credits Earned")).toBe("1.23M");
    expect(valueOf(stats.lifetime, "Captain XP Awarded")).toBe("9.50K");
    expect(valueOf(stats.lifetime, "Fleet Admiral XP Awarded")).toBe("0");

    // Career group.
    expect(valueOf(stats.career, "Play Time")).toBe("142h 18m");
    expect(valueOf(stats.career, "Fleet Admiral Level")).toBe("7");
    expect(valueOf(stats.career, "Crafting Level")).toBe("5");

    // Fleet group.
    expect(valueOf(stats.fleet, "Captains")).toBe("2");
    expect(valueOf(stats.fleet, "Ships Owned")).toBe("2");
    expect(valueOf(stats.fleet, "Equipment Pieces")).toBe("4");
    expect(valueOf(stats.fleet, "Researched Blueprints")).toBe("1");
    expect(valueOf(stats.fleet, "Homeworld Talents")).toBe("1");
  });

  it("formats sub-hour play time as minutes, and near-zero as minutes", () => {
    const state = freshState();
    state.gameTimeSeconds = 45 * 60; // 45 minutes, no hours
    expect(valueOf(deriveStatistics(state).career, "Play Time")).toBe("45m");

    state.gameTimeSeconds = 0;
    expect(valueOf(deriveStatistics(state).career, "Play Time")).toBe("0m");
  });
});
