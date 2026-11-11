// ORDERING DETERMINISM (docs/plans/2026-10-22-roadmap-and-release-gates.md, "Ordering wrinkles found by CP-14 / CP-16
// parity tests"): offline == live means one economyTick call == 997 s chunks == 1 s steps EXACTLY, order included. The
// codex's `discovered` list and the four lifetime tally maps (itemsGathered, itemsRefined, itemsCrafted,
// missionsCompleted) are compared byte for byte here, with no normalization: the whole state as JSON.

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import { freshState, type GameState, type RelicVaultToken, type TimedProcess } from "./model";
import { startRelicStudy, tick } from "./tick";
import { deserialize, migrate, serialize } from "./save";
import { cp16PatrolStart, cp16ShortRangeStart, patrolSecondsToEnd, steppedBy } from "./cp16Goldens.fixture";
import { OFFLINE_SECONDS, twoCaptainsStart } from "./orderingGoldens.fixture";
import { withCanonicalOrderOff } from "./orderingSwitch.fixture";

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

  it("a salvage reveal (a process, folded after the captains in a call) and later patrol finds", () => {
    // A material salvage of a held Damaged Weapon System completes at second 5 and reveals the Polysilicate Wafer it
    // recovers; the patrol's finds (powerCoupling, titaniumIngot among them, both after it in canonical order) come
    // later. 1 s steps reveal the salvage first; one call folds the patrol first and the salvage after it, so an
    // appended reveal would land out of order there.
    const job: TimedProcess = {
      id: "proc-salvage",
      kind: "salvageJob",
      remainingTicks: 5,
      durationTicks: 5,
      effect: { type: "salvageResolve", target: { kind: "material", itemId: "damagedWeaponSystem" } },
    };
    const patrol = cp16PatrolStart();
    const n = patrolSecondsToEnd(patrol);
    const s0: GameState = {
      ...patrol,
      inventory: { ...patrol.inventory, damagedWeaponSystem: [new Decimal(3)] },
      activeProcesses: [...patrol.activeProcesses, job],
    };
    // Strict on `discovered` and the tally keys. The whole state is compared with ONE order normalized, the inventory's
    // keys: the recovered item gains its inventory key after the patrol's loot in one call (the inventory key order
    // wrinkle the carry note logs as its own follow-up). Every value and every other byte is compared as is.
    const keyed = (s: GameState): string =>
      json({ ...s, inventory: Object.fromEntries(Object.keys(s.inventory).sort().map((k) => [k, s.inventory[k]])) });
    const steps = steppedBy(s0, n, 1);
    for (const chunk of [n, 997, 7]) {
      const got = steppedBy(s0, n, chunk);
      expect(got.discovered, `discovered, ${chunk} s chunks`).toEqual(steps.discovered);
      expect(tallyKeys(got), `tally keys, ${chunk} s chunks`).toEqual(tallyKeys(steps));
      expect(keyed(got), `whole state, ${chunk} s chunks`).toBe(keyed(steps));
    }
    expect(steps.discovered).toContain("polysilicateWafer");
    expect(steps.discovered).toContain("titaniumIngot");
    expectCanonical(steps);
    // Not vacuous: with the slice off, one call lists the same finds in another order than 1 s steps.
    const [oneCall, stepped] = withCanonicalOrderOff(() => [steppedBy(s0, n, n).discovered, steppedBy(s0, n, 1).discovered]);
    expect(oneCall).not.toEqual(stepped);
  });

  it("relic studies (left out of the slice): the first-find registry already lands in one order however the time is cut", () => {
    // Four studies at Lab VII started longest first, so the process array order is the reverse of completion order; the
    // study lanes deposit into the registry in completion order, so `relicDiscovered` needs no canonical order
    // (canonicalOrder.ts header).
    const rarities = ["radiant", "stellar", "augmented", "standard"] as const;
    const vault: RelicVaultToken[] = rarities.map((tier, i) => ({ id: `vault-${i}`, tier, quality: 0, ...(i % 2 === 0 ? {} : { regionTier: 7 as const }) }));
    let s: GameState = { ...freshState(1), facilities: { ...freshState(1).facilities, research: { level: 7 } }, relicVault: vault, relicQueue: [] };
    for (const t of vault) {
      const r = startRelicStudy(s, t.id);
      expect(r.started, t.id).toBe(true);
      s = r.next;
    }
    const n = Math.max(...s.activeProcesses.map((p) => p.remainingTicks)) + 5;
    const steps = steppedBy(s, n, 1);
    expect(steps.relicDiscovered).toHaveLength(4);
    // The registry and the Museum, strict. (The completion log is NOT compared: one call logs these studies in process
    // array order and 1 s steps in completion order, an order wrinkle of its own logged in the carry note.)
    for (const chunk of [n, 997, 7]) {
      const got = steppedBy(s, n, chunk);
      expect(got.relicDiscovered, `${chunk} s chunks`).toEqual(steps.relicDiscovered);
      expect(json(got.museumV2), `${chunk} s chunks`).toBe(json(steps.museumV2));
    }
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
