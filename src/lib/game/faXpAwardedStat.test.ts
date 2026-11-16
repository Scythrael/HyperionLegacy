// FR-C R2-5 (QA 2026-11-14 observation): Statistics' "Fleet Admiral XP Awarded" read Captain XP only, leaving out the
// Fleet Admiral XP finite work grants (upgrades, research, crafting: resolveProcesses' lump FA XP). The lifetime stat now
// folds that XP too, on both paths (one economyTick fold, so offline equals live).
import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import { freshState, type GameState, type TimedProcess } from "./model";
import { economyTick, resolveProcesses, tick } from "./tick";

const RNG = () => 0.5;

function withRefineJob(ticks: number): GameState {
  const base = freshState();
  const job: TimedProcess = {
    id: "proc-1",
    kind: "refineJob",
    remainingTicks: ticks,
    durationTicks: ticks,
    effect: { type: "addItem", itemId: "titaniumIngot", amount: new Decimal(1) },
  };
  return { ...base, activeProcesses: [job], nextProcessId: 2 };
}

describe("Fleet Admiral XP Awarded counts the XP from finite work", () => {
  it("a completed refine job's FA XP lands in lifetimeStats.fleetAdminXpAwarded", () => {
    const s = withRefineJob(12);
    const award = resolveProcesses(s, 12).fleetAdminXpDelta;
    expect(award).toBeGreaterThan(0);
    let live = s;
    for (let i = 0; i < 13; i++) live = economyTick(live, 1, RNG);
    expect(live.lifetimeStats.fleetAdminXpAwarded.minus(s.lifetimeStats.fleetAdminXpAwarded).toNumber()).toBe(award);
  });

  it("offline equals live for the stat", () => {
    const s = withRefineJob(12);
    let live = s;
    for (let i = 0; i < 20; i++) live = economyTick(live, 1, RNG);
    const offline = tick(20 * s.tickDurationSeconds, s, RNG);
    expect(offline.lifetimeStats.fleetAdminXpAwarded.toString()).toBe(live.lifetimeStats.fleetAdminXpAwarded.toString());
  });
});
