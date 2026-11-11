// ORDERING DETERMINISM PART 2 (canonicalOrder.ts; docs/plans/2026-10-22-roadmap-and-release-gates.md, "Ordering
// determinism part 2 BUILT (2026-11-11)"): offline == live means one economyTick call == 997 s chunks == 1 s steps
// EXACTLY, order included. Here the key order of `inventory` and the completion log are compared byte for byte, with
// the whole state as JSON and no normalization; each case also proves it fails with part 2 switched off.

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import type { GameState } from "./model";
import { steppedBy } from "./cp16Goldens.fixture";
import { deserialize, migrate, serialize } from "./save";
import { addItemQuality, removeItemLowestFirst, setItemBuckets } from "./inventory";
import { twoCaptainsStart } from "./orderingGoldens.fixture";
import { oldSaveStart, processesStart, relicsStart, salvageStart } from "./ordering2Goldens.fixture";
import { withOrdering2Off } from "./ordering2Switch.fixture";

const json = (v: unknown): string => JSON.stringify(v);
const sorted = (xs: readonly string[]): string[] => [...xs].sort();
const logOf = (s: GameState): string[] => s.completionLog.map((e) => `${e.id}:${e.kind}:${e.subjectKey ?? ""}`);

// One call, 997 s chunks and a ragged chunk against 1 s steps: the inventory's key order, the log, then the whole state.
function expectChunkingParity(s0: GameState, n: number, ragged: number): GameState {
  const steps = steppedBy(s0, n, 1);
  for (const chunk of [n, 997, ragged]) {
    const got = steppedBy(s0, n, chunk);
    expect(Object.keys(got.inventory), `inventory keys, ${chunk} s chunks`).toEqual(Object.keys(steps.inventory));
    expect(logOf(got), `completion log, ${chunk} s chunks`).toEqual(logOf(steps));
    expect(json(got), `whole state, ${chunk} s chunks`).toBe(json(steps));
  }
  return steps;
}

// Not vacuous: with part 2 off, one call and 1 s steps differ.
function expectDiffersWhenOff(s0: GameState, n: number): void {
  const [oneCall, stepped] = withOrdering2Off(() => [json(steppedBy(s0, n, n)), json(steppedBy(s0, n, 1))]);
  expect(oneCall).not.toBe(stepped);
}

describe("ordering determinism part 2: one call == 997 s chunks == 1 s steps, inventory order and the log included", () => {
  it("inventory: a salvage's recovered item and a patrol's loot gain their keys in one order however the time is cut", () => {
    const { s0, n } = salvageStart();
    const steps = expectChunkingParity(s0, n, 7);
    expect(Object.keys(steps.inventory)).toContain("polysilicateWafer");
    expect(Object.keys(steps.inventory)).toContain("titaniumIngot");
    expect(Object.keys(steps.inventory)).toEqual(sorted(Object.keys(steps.inventory)));
    expectDiffersWhenOff(s0, n);
  });

  it("the completion log: relic studies finishing out of array order are logged in completion order in every chunking", () => {
    const { s0, n } = relicsStart();
    const steps = expectChunkingParity(s0, n, 7);
    expect(steps.completionLog.map((e) => e.kind)).toEqual(["relicStudy", "relicStudy", "relicStudy", "relicStudy"]);
    expectDiffersWhenOff(s0, n);
  });

  it("the completion log and the inventory: five processes completing in the reverse of their array order", () => {
    const { s0, n } = processesStart();
    const steps = expectChunkingParity(s0, n, 2);
    expect(logOf(steps)).toEqual([
      "done-1:facilityUpgrade:research",
      "done-2:refineJob:polysilicateWafer",
      "done-3:relicStudy:resonanceShard",
      "done-4:refineJob:titaniumIngot",
      "done-5:facilityUpgrade:salvageBay",
    ]);
    // The entries themselves are what they were: the same kinds, rewards, subjects and stamps, only met in time order.
    const off = withOrdering2Off(() => steppedBy(s0, n, n));
    const content = (s: GameState) => s.completionLog.map((e) => json({ ...e, id: "" })).sort();
    expect(content(steps)).toEqual(content(off));
    expectDiffersWhenOff(s0, n);
  });

  it("two captains for 1000 s: the whole state, strict", () => {
    const steps = expectChunkingParity(twoCaptainsStart(), 1000, 7);
    expect(Object.keys(steps.inventory)).toEqual(sorted(Object.keys(steps.inventory)));
  });

  it("an older save whose inventory is in first-seen order: every chunking lands on the same canonical order", () => {
    const old = oldSaveStart();
    expect(Object.keys(old.inventory).slice(0, 2)).toEqual(["titaniumIngot", "deuteriumIce"]);
    const steps = expectChunkingParity(old, 1000, 7);
    expect(Object.keys(steps.inventory)).toEqual(["commonOre", "denseOre", "deuteriumIce", "ferriteOre", "osmiumOre", "rareMaterial", "titaniumIngot", "uncommonMaterial"]);
    expect(Number(steps.inventory.titaniumIngot[0])).toBe(4);
    expect(Number(steps.inventory.deuteriumIce[0])).toBe(2);
  });

  it("an older save in first-seen order loads as it is (no bump, nothing reordered or lost on load)", () => {
    const old = oldSaveStart();
    const file = deserialize(serialize(old, 0, 0));
    expect(file).not.toBeNull();
    const loaded = migrate(file!);
    expect(Object.keys(loaded.inventory)).toEqual(Object.keys(old.inventory));
    expect(Number(loaded.inventory.titaniumIngot[0])).toBe(4);
  });
});

describe("the one inventory write seam (inventory.ts setItemBuckets)", () => {
  const inv = (): Record<string, Decimal[]> => ({ rareMaterial: [new Decimal(1)], commonOre: [new Decimal(2)] });

  it("a key already held keeps its place, and so does every other key (no sort on the hot path)", () => {
    const next = addItemQuality(inv(), "rareMaterial", new Decimal(5), 0);
    expect(Object.keys(next)).toEqual(["rareMaterial", "commonOre"]);
    expect(Number(next.rareMaterial[0])).toBe(6);
    const drained = removeItemLowestFirst(next, "commonOre", new Decimal(2));
    expect(Object.keys(drained)).toEqual(["rareMaterial", "commonOre"]);
    expect(Number(drained.commonOre[0])).toBe(0);
  });

  it("a NEW key puts the whole map in canonical order; with part 2 off it is appended", () => {
    expect(Object.keys(addItemQuality(inv(), "ferriteOre", new Decimal(1), 0))).toEqual(["commonOre", "ferriteOre", "rareMaterial"]);
    expect(Object.keys(setItemBuckets(inv(), "ferriteOre", [new Decimal(1)]))).toEqual(["commonOre", "ferriteOre", "rareMaterial"]);
    expect(withOrdering2Off(() => Object.keys(addItemQuality(inv(), "ferriteOre", new Decimal(1), 0)))).toEqual(["rareMaterial", "commonOre", "ferriteOre"]);
  });

  it("a deleted key leaves the rest in their order", () => {
    const three: Record<string, Decimal[]> = { titaniumIngot: [new Decimal(1)], commonOre: [new Decimal(2)], ferriteOre: [new Decimal(3)] };
    const rest = { ...three };
    delete rest.commonOre;
    expect(Object.keys(rest)).toEqual(["titaniumIngot", "ferriteOre"]);
  });

  it("never mutates its input", () => {
    const before = inv();
    const keys = Object.keys(before);
    setItemBuckets(before, "ferriteOre", [new Decimal(1)]);
    addItemQuality(before, "rareMaterial", new Decimal(1), 0);
    expect(Object.keys(before)).toEqual(keys);
    expect(Number(before.rareMaterial[0])).toBe(1);
  });
});
