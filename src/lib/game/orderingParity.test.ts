// ORDERING DETERMINISM (docs/plans/2026-10-22-roadmap-and-release-gates.md, "Ordering wrinkles found by CP-14 / CP-16
// parity tests"): offline == live means one economyTick call == 997 s chunks == 1 s steps EXACTLY, order included. The
// codex's `discovered` list and the four lifetime tally maps (itemsGathered, itemsRefined, itemsCrafted,
// missionsCompleted) are compared byte for byte here, with no normalization: the whole state as JSON.

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import type { GameState } from "./model";
import { tick } from "./tick";
import { deserialize, migrate, serialize } from "./save";
import { cp16PatrolStart, cp16ShortRangeStart, patrolSecondsToEnd, steppedBy } from "./cp16Goldens.fixture";
import { OFFLINE_SECONDS, twoCaptainsStart } from "./orderingGoldens.fixture";

const RNG = (): number => 0.5;
const json = (v: unknown): string => JSON.stringify(v);
const tallyKeys = (s: GameState) => ({
  itemsGathered: Object.keys(s.lifetimeStats.itemsGathered),
  itemsRefined: Object.keys(s.lifetimeStats.itemsRefined),
  itemsCrafted: Object.keys(s.lifetimeStats.itemsCrafted),
  missionsCompleted: Object.keys(s.lifetimeStats.missionsCompleted),
});
const sorted = (xs: readonly string[]): string[] => [...xs].sort();

// One call, 997 s chunks and a ragged chunk against 1 s steps: the order of `discovered` and of every tally map's keys,
// then the whole state.
function expectChunkingParity(s0: GameState, n: number, ragged: number): GameState {
  const steps = steppedBy(s0, n, 1);
  for (const chunk of [n, 997, ragged]) {
    const got = steppedBy(s0, n, chunk);
    expect(got.discovered, `discovered, ${chunk} s chunks`).toEqual(steps.discovered);
    expect(tallyKeys(got), `tally keys, ${chunk} s chunks`).toEqual(tallyKeys(steps));
    expect(json(got), `whole state, ${chunk} s chunks`).toBe(json(steps));
  }
  return steps;
}

// The order is the canonical one (code unit order), not the order a call happened to meet the items in.
function expectCanonical(s: GameState): void {
  expect(s.discovered).toEqual(sorted(s.discovered));
  for (const keys of Object.values(tallyKeys(s))) expect(keys).toEqual(sorted(keys));
}

describe("ordering determinism: one call == 997 s chunks == 1 s steps, order included", () => {
  it("a patrol's finds (`discovered` met in another order by the steps)", () => {
    const s0 = cp16PatrolStart();
    const steps = expectChunkingParity(s0, patrolSecondsToEnd(s0), 3);
    expect(steps.discovered.length).toBeGreaterThan(2);
    expectCanonical(steps);
  });

  it("a short-range run's finds", () => {
    const steps = expectChunkingParity(cp16ShortRangeStart(0), 900, 13);
    expect(steps.discovered.length).toBe(2);
    expectCanonical(steps);
  });

  it("two captains: missionsCompleted gains its keys in one order however the time is cut", () => {
    const steps = expectChunkingParity(twoCaptainsStart(), 1000, 7);
    expect(Object.keys(steps.lifetimeStats.missionsCompleted)).toEqual(["longOreRun", "shortOreRun"]);
    expectCanonical(steps);
  });

  it("a long offline catch-up (tick) == 1 s steps == 97 s chunks, order included", () => {
    const two = twoCaptainsStart();
    const caughtUp = tick(OFFLINE_SECONDS, two, RNG);
    expect(json(steppedBy(two, OFFLINE_SECONDS, 1))).toBe(json(caughtUp));
    expect(json(steppedBy(two, OFFLINE_SECONDS, 97))).toBe(json(caughtUp));
    expectCanonical(caughtUp);
  });

  it("an older save whose lists are in first-seen order: every chunking lands on the same canonical order", () => {
    // A save written before the slice: `discovered` and missionsCompleted in the order they were first met.
    const base = twoCaptainsStart();
    const old: GameState = {
      ...base,
      discovered: ["titaniumIngot", "deuteriumIce", ...base.discovered],
      lifetimeStats: {
        ...base.lifetimeStats,
        missionsCompleted: { salvageWreckage: new Decimal(3), localFuelRun: new Decimal(2), ...base.lifetimeStats.missionsCompleted },
      },
    };
    const steps = expectChunkingParity(old, 1000, 7);
    expect(steps.discovered).toEqual(["commonOre", "deuteriumIce", "ferriteOre", "titaniumIngot"]);
    expect(Object.keys(steps.lifetimeStats.missionsCompleted)).toEqual(["localFuelRun", "longOreRun", "salvageWreckage", "shortOreRun"]);
    expect(Number(steps.lifetimeStats.missionsCompleted.salvageWreckage)).toBe(3);
  });

  it("an older save in first-seen order loads as it is (no bump, nothing reordered or lost on load)", () => {
    const base = twoCaptainsStart();
    const old: GameState = {
      ...base,
      discovered: ["titaniumIngot", "deuteriumIce"],
      lifetimeStats: { ...base.lifetimeStats, missionsCompleted: { salvageWreckage: new Decimal(3), localFuelRun: new Decimal(2) } },
    };
    const file = deserialize(serialize(old, 0, 0));
    expect(file).not.toBeNull();
    const loaded = migrate(file!);
    expect(loaded.discovered).toEqual(["titaniumIngot", "deuteriumIce"]);
    expect(Object.keys(loaded.lifetimeStats.missionsCompleted)).toEqual(["salvageWreckage", "localFuelRun"]);
    expect(Number(loaded.lifetimeStats.missionsCompleted.localFuelRun)).toBe(2);
  });
});
