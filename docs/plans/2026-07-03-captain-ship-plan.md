# Multi-Captain Stacks + Two-Tier Prestige (Phase 1) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split the single implicit production pool into an array of independent per-captain
stacks (each with its own resources/modules/research/tick cadence), and add a two-tier prestige
system — per-captain reset with a specialization choice, and a fleet-wide reset that collapses the
whole roster back to the starting 2 captains.

**Architecture:** `GameState` becomes fleet-wide-only (`captains: CaptainState[]`, `augmentPoints`,
`prestigeCount`, `gameTimeSeconds`). Today's `tick()` body is extracted into
`tickCaptainStack(deltaSeconds, captain, fleetMult): CaptainState`, reused in a per-captain loop.
Two prestige functions exist: `captainPrestige()` (resets one captain, grants `captainPoints` +
lets the player pick a specialization) and the extended `prestige()` (resets the whole roster,
grants fleet-wide `augmentPoints`). The live tick-bar loop in `App.svelte` becomes a loop over all
captains, each tracking its own cycle progress independently.

**Tech Stack:** Svelte 5 (existing non-runes style), TypeScript, Vitest. No new dependencies.

**Design doc:** `docs/plans/2026-07-03-captain-ship-design.md` — read this first if anything below
is ambiguous.

**A note on testing:** Node.js/npm is unavailable in this environment (reconfirmed at the top of
every plan this session) — no dev server, no build, no test runner. Tasks 1–3 touch genuinely
testable pure logic (data model, `tick()`'s closed-form math, save migration) and follow this
session's established TDD pattern: write the test, manually trace by hand whether it would pass or
fail given the code as written, then implement, then re-trace. State the trace explicitly rather
than claiming a test "passes" without showing the reasoning. Tasks 4–7 are Svelte markup/CSS/timing
logic with no automated test story — verified by manual code review only, same limitation as every
other UI task this session.

**Risk note:** This is the largest single feature this session. Task 1 (the data model refactor)
and Task 4 (the per-captain tick-loop rewrite in `App.svelte`) are the two highest-risk pieces —
almost everything else depends on Task 1's shape being right, and Task 4 replaces timing logic
that has been stable and battle-tested (including a real production hotfix) all session. Both get
extra-careful, explicit step-by-step treatment below. Do not skip ahead or combine steps.

---

### Task 1: Data model refactor (`model.ts`)

**Files:**
- Modify: `src/lib/game/model.ts`
- Modify: `src/lib/game/model.test.ts` (this is a near-total rewrite, not additions — the existing
  tests assume the old flat shape and will not compile against the new one)

**Context:** Read the current `src/lib/game/model.ts` in full before starting. Every one of its
exports changes shape or signature: `GameState` loses `resources`/`modules`/`research`/
`lifetimeComponents`/`tickDurationSeconds` (they move into a new `CaptainState`), `freshState()`
now builds a 2-captain roster instead of a flat object, and `isModuleUnlocked`/`isResourceUnlocked`
now take a `CaptainState` instead of a `GameState` (since `research` is no longer fleet-wide).

**Step 1: Write the failing tests**

Replace the entire contents of `src/lib/game/model.test.ts` with:

```ts
import { describe, it, expect } from "vitest";
import {
  freshState,
  freshCaptains,
  freshCaptainStack,
  isModuleUnlocked,
  isResourceUnlocked,
  captainMultiplier,
  specializationMultiplier,
  SPECIALIZATIONS,
} from "./model";

describe("freshState — captain roster shape", () => {
  it("starts with exactly 2 captains", () => {
    const state = freshState();
    expect(state.captains).toHaveLength(2);
  });

  it("Captain 1 has id 1, label 'Captain 1', shipType resourcer, and a 1-miner head start", () => {
    const state = freshState();
    const c1 = state.captains[0];
    expect(c1.id).toBe(1);
    expect(c1.label).toBe("Captain 1");
    expect(c1.shipType).toBe("resourcer");
    expect(c1.modules.miner).toBe(1);
    expect(c1.modules.refinery).toBe(0);
    expect(c1.modules.fabricator).toBe(0);
    expect(c1.modules.synthesizer).toBe(0);
  });

  it("Captain 2 has id 2, label 'Captain 2', and starts completely empty (no head start)", () => {
    const state = freshState();
    const c2 = state.captains[1];
    expect(c2.id).toBe(2);
    expect(c2.label).toBe("Captain 2");
    expect(c2.modules.miner).toBe(0);
  });

  it("both captains start with 0 resources, 0 captainPoints, 0 captainPrestigeCount, null specialization", () => {
    const state = freshState();
    for (const c of state.captains) {
      expect(c.resources).toEqual({ ore: 0, ingots: 0, components: 0, alloys: 0 });
      expect(c.lifetimeComponents).toBe(0);
      expect(c.tickDurationSeconds).toBe(10);
      expect(c.captainPoints).toBe(0);
      expect(c.captainPrestigeCount).toBe(0);
      expect(c.specialization).toBe(null);
      expect(c.research.alloySynthesis).toEqual({ started: false, progressSeconds: 0, completed: false });
    }
  });

  it("fleet-wide fields default to 0", () => {
    const state = freshState();
    expect(state.augmentPoints).toBe(0);
    expect(state.prestigeCount).toBe(0);
    expect(state.gameTimeSeconds).toBe(0);
  });
});

describe("freshCaptainStack — shared reset baseline", () => {
  it("returns the 1-free-miner baseline used by both prestige tiers", () => {
    const stack = freshCaptainStack();
    expect(stack.modules.miner).toBe(1);
    expect(stack.modules.refinery).toBe(0);
    expect(stack.resources).toEqual({ ore: 0, ingots: 0, components: 0, alloys: 0 });
    expect(stack.lifetimeComponents).toBe(0);
    expect(stack.tickDurationSeconds).toBe(10);
    expect(stack.research.alloySynthesis).toEqual({ started: false, progressSeconds: 0, completed: false });
  });
});

describe("isModuleUnlocked (per-captain)", () => {
  it("miner, refinery, and fabricator are always unlocked", () => {
    const captain = freshCaptains()[0];
    expect(isModuleUnlocked("miner", captain)).toBe(true);
    expect(isModuleUnlocked("refinery", captain)).toBe(true);
    expect(isModuleUnlocked("fabricator", captain)).toBe(true);
  });

  it("synthesizer is locked until THIS captain's alloySynthesis research completes", () => {
    const captain = freshCaptains()[0];
    expect(isModuleUnlocked("synthesizer", captain)).toBe(false);

    const completed = {
      ...captain,
      research: { ...captain.research, alloySynthesis: { ...captain.research.alloySynthesis, completed: true } },
    };
    expect(isModuleUnlocked("synthesizer", completed)).toBe(true);
  });
});

describe("isResourceUnlocked (per-captain)", () => {
  it("ore, ingots, and components are always unlocked", () => {
    const captain = freshCaptains()[0];
    expect(isResourceUnlocked("ore", captain)).toBe(true);
    expect(isResourceUnlocked("ingots", captain)).toBe(true);
    expect(isResourceUnlocked("components", captain)).toBe(true);
  });

  it("alloys is locked until THIS captain's alloySynthesis research completes", () => {
    const captain = freshCaptains()[0];
    expect(isResourceUnlocked("alloys", captain)).toBe(false);

    const completed = {
      ...captain,
      research: { ...captain.research, alloySynthesis: { ...captain.research.alloySynthesis, completed: true } },
    };
    expect(isResourceUnlocked("alloys", completed)).toBe(true);
  });
});

describe("captainMultiplier", () => {
  it("is 1 with 0 captainPoints", () => {
    const captain = { ...freshCaptains()[0], captainPoints: 0 };
    expect(captainMultiplier(captain)).toBe(1);
  });

  it("is 1 + points * 0.1", () => {
    const captain = { ...freshCaptains()[0], captainPoints: 20 };
    expect(captainMultiplier(captain)).toBeCloseTo(3, 6);
  });
});

describe("specializationMultiplier", () => {
  it("is 1 for every resource when specialization is null", () => {
    const captain = { ...freshCaptains()[0], specialization: null };
    expect(specializationMultiplier(captain, "ore")).toBe(1);
    expect(specializationMultiplier(captain, "ingots")).toBe(1);
  });

  it("is 1 + bonusMult for the matching resource, 1 for others", () => {
    const captain = { ...freshCaptains()[0], specialization: "mining" as const };
    expect(specializationMultiplier(captain, "ore")).toBeCloseTo(1 + SPECIALIZATIONS.mining.bonusMult, 6);
    expect(specializationMultiplier(captain, "ingots")).toBe(1);
    expect(specializationMultiplier(captain, "components")).toBe(1);
  });
});
```

**Step 2: Confirm the tests would fail**

Read the current (pre-refactor) `model.ts`. None of `freshCaptains`, `freshCaptainStack`,
`captainMultiplier`, `specializationMultiplier`, or `SPECIALIZATIONS` exist yet, and `freshState()`
returns the old flat shape, and `isModuleUnlocked`/`isResourceUnlocked` take a `GameState`. Confirm
by inspection that this test file would fail to even type-check/import against the current file
(not just fail assertions) — this is the expected starting point.

**Step 3: Write the implementation**

Replace the entire contents of `src/lib/game/model.ts` with:

```ts
// Data model — tech spec §1 (Data Model) and §3 (Generator Stack Structure).
// Phase 1 of the captain/ship feature (docs/plans/2026-07-03-captain-ship-design.md):
// the single flat stack is now N independent per-captain stacks. Fleet-wide
// fields (augmentPoints, prestigeCount, gameTimeSeconds) stay on GameState;
// everything else moves into CaptainState.

export type ResourceKey = "ore" | "ingots" | "components" | "alloys";
export type ModuleKey = "miner" | "refinery" | "fabricator" | "synthesizer";

export interface ModuleDef {
  label: string;
  resource: ResourceKey;
  baseRate: number; // units per second at count=1, multiplier=1
  baseCost: number; // cost of the first purchase (count 0 -> 1)
  costMult: number; // exponential cost scaling per tech spec §3
  unit: string;
}

export const MODULES: Record<ModuleKey, ModuleDef> = {
  miner: { label: "Mining Laser", resource: "ore", baseRate: 1, baseCost: 10, costMult: 1.15, unit: "ore/s" },
  refinery: { label: "Refinery", resource: "ingots", baseRate: 0.4, baseCost: 60, costMult: 1.17, unit: "ingots/s" },
  fabricator: { label: "Fabricator", resource: "components", baseRate: 0.12, baseCost: 400, costMult: 1.2, unit: "components/s" },
  synthesizer: { label: "Synthesizer", resource: "alloys", baseRate: 0.04, baseCost: 2500, costMult: 1.22, unit: "alloys/s" },
};

export const RESOURCE_ORDER: ResourceKey[] = ["ore", "ingots", "components", "alloys"];
export const RESOURCE_LABEL: Record<ResourceKey, string> = {
  ore: "Common Ore",
  ingots: "Refined Ingots",
  components: "Components",
  alloys: "Alloys",
};

export type ResearchKey = "alloySynthesis";

export interface ResearchState {
  started: boolean;
  progressSeconds: number;
  completed: boolean;
}

export interface ResearchProjectDef {
  label: string;
  costComponents: number;
  durationSeconds: number;
}

export const RESEARCH_PROJECTS: Record<ResearchKey, ResearchProjectDef> = {
  alloySynthesis: { label: "Alloy Synthesis", costComponents: 500, durationSeconds: 180 },
};

// Only "resourcer" is real today. Modeled as a union (not a bare string) so
// Phase 3+'s combat-type ships slot in as a new literal without touching
// every existing call site that pattern-matches on this field.
export type ShipType = "resourcer";

export type SpecializationKey = "mining" | "refining" | "fabrication";

export interface SpecializationDef {
  label: string;
  resource: ResourceKey;
  bonusMult: number; // e.g. 0.25 for +25% to the matching module's production
}

// Exactly 3 at launch, one per base resource. Alloys/Synthesizer intentionally
// excluded -- it's still gated behind research, so a specialization for it
// would be dead weight for most of a captain's early life. Add a 4th entry
// here (and nowhere else -- App.svelte's picker iterates this object) if a
// synthesis specialization is ever wanted.
export const SPECIALIZATIONS: Record<SpecializationKey, SpecializationDef> = {
  mining: { label: "Mining Specialist", resource: "ore", bonusMult: 0.25 },
  refining: { label: "Refining Specialist", resource: "ingots", bonusMult: 0.25 },
  fabrication: { label: "Fabrication Specialist", resource: "components", bonusMult: 0.25 },
};

export interface CaptainState {
  id: number;
  label: string; // placeholder, e.g. "Captain 1" -- naming UI deferred per master doc §10.7
  shipType: ShipType;
  resources: Record<ResourceKey, number>;
  modules: Record<ModuleKey, number>;
  research: Record<ResearchKey, ResearchState>;
  lifetimeComponents: number;
  tickDurationSeconds: number; // this captain's own tick-bar cycle length; cadences can diverge between captains
  captainPoints: number; // earned via THIS captain's own prestige (captainPrestige)
  captainPrestigeCount: number;
  specialization: SpecializationKey | null;
}

export interface GameState {
  captains: CaptainState[];
  augmentPoints: number; // fleet-wide, from Fleet Prestige
  prestigeCount: number; // fleet-wide Fleet Prestige count
  gameTimeSeconds: number; // accumulated in-game seconds, fleet-wide, per tech spec §1
}

// The baseline BOTH prestige tiers reset a captain's stack to: 1 free Mining
// Laser, everything else zeroed. This is the same floor the old single-stack
// prestige() has always reset to (freshState() always gave 1 free miner) --
// prestiging is "start this captain's economy over with a small foothold,"
// not "erase them back to before they existed." Only a captain slot that has
// NEVER been played (Captain 2 in a brand-new/migrated save, before its first
// captainPrestige) starts with zero modules instead -- see freshCaptains().
export function freshCaptainStack(): Pick<
  CaptainState,
  "resources" | "modules" | "research" | "lifetimeComponents" | "tickDurationSeconds"
> {
  return {
    resources: { ore: 0, ingots: 0, components: 0, alloys: 0 },
    modules: { miner: 1, refinery: 0, fabricator: 0, synthesizer: 0 },
    research: { alloySynthesis: { started: false, progressSeconds: 0, completed: false } },
    lifetimeComponents: 0,
    tickDurationSeconds: 10,
  };
}

// The starting 2-captain roster for both a brand-new save (freshState) and a
// post-Fleet-Prestige reset. Captain 1 gets the shared reset baseline (1 free
// miner); Captain 2 starts from an entirely empty stack -- deliberately
// asymmetric, since Captain 2 is a slot that has never been played before,
// not a captain being reset. See docs/plans/2026-07-03-captain-ship-design.md.
export function freshCaptains(): CaptainState[] {
  return [
    {
      id: 1,
      label: "Captain 1",
      shipType: "resourcer",
      ...freshCaptainStack(),
      captainPoints: 0,
      captainPrestigeCount: 0,
      specialization: null,
    },
    {
      id: 2,
      label: "Captain 2",
      shipType: "resourcer",
      resources: { ore: 0, ingots: 0, components: 0, alloys: 0 },
      modules: { miner: 0, refinery: 0, fabricator: 0, synthesizer: 0 },
      research: { alloySynthesis: { started: false, progressSeconds: 0, completed: false } },
      lifetimeComponents: 0,
      tickDurationSeconds: 10,
      captainPoints: 0,
      captainPrestigeCount: 0,
      specialization: null,
    },
  ];
}

export function freshState(): GameState {
  return {
    captains: freshCaptains(),
    augmentPoints: 0,
    prestigeCount: 0,
    gameTimeSeconds: 0,
  };
}

export function costFor(moduleKey: ModuleKey, count: number): number {
  const m = MODULES[moduleKey];
  return Math.ceil(m.baseCost * Math.pow(m.costMult, count));
}

// Only one gated module/resource exists right now (Synthesizer/alloys, behind
// Alloy Synthesis research). If a second gated module is ever added, this
// needs a real lookup instead of a single hardcoded key check. Per-captain as
// of Phase 1: each captain's OWN research state gates THEIR OWN Synthesizer.
export function isModuleUnlocked(key: ModuleKey, captain: CaptainState): boolean {
  if (key === "synthesizer") return captain.research.alloySynthesis.completed;
  return true;
}

export function isResourceUnlocked(key: ResourceKey, captain: CaptainState): boolean {
  if (key === "alloys") return captain.research.alloySynthesis.completed;
  return true;
}

// Fleet-wide multiplier, from Fleet Prestige's augmentPoints. Applies equally
// to every captain's production.
export function globalMultiplier(state: GameState): number {
  return 1 + state.augmentPoints * 0.1;
}

// Per-captain multiplier, from that captain's OWN captainPrestige history.
// Same shape as globalMultiplier, deliberately -- a captain's own prestige
// track is a smaller, faster echo of the fleet-wide one.
export function captainMultiplier(captain: CaptainState): number {
  return 1 + captain.captainPoints * 0.1;
}

// 1 + bonusMult if this captain has a specialization matching the given
// resource, else 1. A captain with no specialization (specialization: null)
// always returns 1 for every resource.
export function specializationMultiplier(captain: CaptainState, resource: ResourceKey): number {
  if (!captain.specialization) return 1;
  const spec = SPECIALIZATIONS[captain.specialization];
  return spec.resource === resource ? 1 + spec.bonusMult : 1;
}
```

**Step 4: Confirm the tests would pass**

Manually trace each test in the new `model.test.ts` against the implementation above:
- `freshState().captains` has length 2 — `freshCaptains()` returns a 2-element array literal. ✓
- Captain 1: `id:1`, `label:"Captain 1"`, `shipType:"resourcer"`, spread of `freshCaptainStack()`
  gives `modules.miner:1` and the rest 0. ✓
- Captain 2: `id:2`, `label:"Captain 2"`, `modules.miner:0` (its own literal, not spread from
  `freshCaptainStack()`). ✓
- `captainMultiplier({captainPoints:20})` = `1 + 20*0.1` = `3`. ✓
- `specializationMultiplier({specialization:"mining"}, "ore")` = `1 + 0.25` = `1.25`;
  for `"ingots"`, `spec.resource ("ore") === "ingots"` is false, returns `1`. ✓
- `isModuleUnlocked("synthesizer", captain)` reads `captain.research.alloySynthesis.completed`,
  `false` on a fresh captain, `true` once that field is set. ✓

**Step 5: Commit**

```bash
git add src/lib/game/model.ts src/lib/game/model.test.ts
git commit -m "feat: refactor GameState to per-captain stacks with specializations"
```

---

### Task 2: `tick.ts` refactor — per-captain production, closed-form, two prestige tiers

**Files:**
- Modify: `src/lib/game/tick.ts`
- Modify: `src/lib/game/tick.test.ts`

**Context:** Read the current `tick.ts` in full — its `tick()` body (production loop + research
loop) is being extracted, parameterized per captain, and reused in a loop. `prestige()` is being
extended to sum across captains and reset the whole roster. A new `captainPrestige()` resets one
captain in place.

**Step 1: Write the failing tests**

Replace the entire contents of `src/lib/game/tick.test.ts` with:

```ts
import { describe, it, expect } from "vitest";
import { tick, tickCaptainStack, prestige, captainPrestige } from "./tick";
import { freshState, freshCaptains } from "./model";

describe("tickCaptainStack — closed-form requirement (single captain)", () => {
  it("one big jump equals many small ticks, with modules, research, AND a specialization all active", () => {
    const base = freshCaptains()[0];
    base.modules.miner = 5;
    base.modules.refinery = 2;
    base.modules.fabricator = 1;
    base.research.alloySynthesis.started = true;
    base.captainPoints = 3;
    base.specialization = "mining"; // exercises specMult alongside fleetMult/capMult

    const fleetMult = 1.4; // arbitrary fixed fleet multiplier for this test

    const bigJump = tickCaptainStack(3600, base, fleetMult);

    let stepped = base;
    for (let i = 0; i < 36000; i++) {
      stepped = tickCaptainStack(0.1, stepped, fleetMult);
    }

    expect(bigJump.resources.ore).toBeCloseTo(stepped.resources.ore, 6);
    expect(bigJump.resources.ingots).toBeCloseTo(stepped.resources.ingots, 6);
    expect(bigJump.resources.components).toBeCloseTo(stepped.resources.components, 6);
    expect(bigJump.research.alloySynthesis.progressSeconds).toBeCloseTo(
      stepped.research.alloySynthesis.progressSeconds,
      6
    );
  });

  it("zero delta is a no-op", () => {
    const base = freshCaptains()[0];
    base.modules.miner = 3;
    const result = tickCaptainStack(0, base, 1);
    expect(result).toBe(base);
  });

  it("specialization gives a +25% boost only to its matching resource", () => {
    const base = freshCaptains()[0];
    base.modules.miner = 1;
    base.modules.refinery = 1;

    const unspecialized = tickCaptainStack(10, { ...base, specialization: null }, 1);
    const specialized = tickCaptainStack(10, { ...base, specialization: "mining" }, 1);

    expect(specialized.resources.ore).toBeCloseTo(unspecialized.resources.ore * 1.25, 6);
    expect(specialized.resources.ingots).toBeCloseTo(unspecialized.resources.ingots, 6); // unaffected
  });

  it("captainPoints scale that captain's production the same way augmentPoints scale the fleet", () => {
    const base = freshCaptains()[0];
    base.modules.miner = 1;

    const noPoints = tickCaptainStack(10, { ...base, captainPoints: 0 }, 1);
    const withPoints = tickCaptainStack(10, { ...base, captainPoints: 10 }, 1); // captainMult = 2x

    expect(withPoints.resources.ore).toBeCloseTo(noPoints.resources.ore * 2, 6);
  });
});

describe("tick — loops tickCaptainStack over every captain, advances fleet gameTimeSeconds once", () => {
  it("applies the same deltaSeconds to every captain independently", () => {
    const state = freshState();
    state.captains[0].modules.miner = 2;
    state.captains[1].modules.miner = 5; // different loadout, must not affect captain 0's math

    const result = tick(10, state);

    expect(result.captains[0].resources.ore).toBeCloseTo(2 * 10, 6);
    expect(result.captains[1].resources.ore).toBeCloseTo(5 * 10, 6);
  });

  it("advances fleet-wide gameTimeSeconds by deltaSeconds exactly once (not once per captain)", () => {
    const state = freshState(); // 2 captains
    const result = tick(10, state);
    expect(result.gameTimeSeconds).toBe(10);
  });

  it("zero delta is a no-op", () => {
    const state = freshState();
    const result = tick(0, state);
    expect(result).toBe(state);
  });

  it("fleet multiplier (augmentPoints) applies equally to every captain", () => {
    const state = freshState();
    state.captains[0].modules.miner = 1;
    state.captains[1].modules.miner = 1;
    state.augmentPoints = 10; // fleetMult = 2x

    const result = tick(10, state);
    expect(result.captains[0].resources.ore).toBeCloseTo(1 * 10 * 2, 6);
    expect(result.captains[1].resources.ore).toBeCloseTo(1 * 10 * 2, 6);
  });
});

describe("captainPrestige — per-captain reset", () => {
  it("resets only the target captain's stack, leaves the other captain untouched", () => {
    const state = freshState();
    state.captains[0].lifetimeComponents = 100; // sqrt(100) = 10 captainPoints
    state.captains[0].modules.miner = 50;
    state.captains[1].modules.miner = 7; // must survive untouched

    const { next, gained } = captainPrestige(state, 1, "mining");
    expect(gained).toBe(10);
    expect(next.captains[0].modules.miner).toBe(1); // reset to the 1-free-miner baseline
    expect(next.captains[0].lifetimeComponents).toBe(0);
    expect(next.captains[0].captainPoints).toBe(10);
    expect(next.captains[0].captainPrestigeCount).toBe(1);
    expect(next.captains[0].specialization).toBe("mining");
    expect(next.captains[1].modules.miner).toBe(7); // untouched
  });

  it("does nothing if gained <= 0", () => {
    const state = freshState(); // lifetimeComponents 0 for both captains
    const { next, gained } = captainPrestige(state, 1, "mining");
    expect(gained).toBe(0);
    expect(next).toBe(state);
  });

  it("accumulates captainPoints across repeated prestiges and allows respeccing", () => {
    const state = freshState();
    state.captains[0].lifetimeComponents = 100; // +10 points

    const { next: afterFirst } = captainPrestige(state, 1, "mining");
    afterFirst.captains[0].lifetimeComponents = 400; // +20 points

    const { next: afterSecond } = captainPrestige(afterFirst, 1, "refining");
    expect(afterSecond.captains[0].captainPoints).toBe(30); // 10 + 20
    expect(afterSecond.captains[0].captainPrestigeCount).toBe(2);
    expect(afterSecond.captains[0].specialization).toBe("refining"); // respecced
  });
});

describe("prestige — fleet-wide reset (extended for multi-captain)", () => {
  it("gates on the SUM of lifetimeComponents across all captains", () => {
    const state = freshState();
    state.captains[0].lifetimeComponents = 36; // sqrt(36) = 6
    state.captains[1].lifetimeComponents = 64; // sqrt(64) = 8, but combined: sqrt(100) = 10

    const { gained } = prestige(state);
    expect(gained).toBe(10);
  });

  it("collapses the whole captains array back to the starting 2-captain shape", () => {
    const state = freshState();
    state.captains[0].lifetimeComponents = 100;
    state.captains[0].captainPoints = 999;
    state.captains[0].specialization = "mining";
    state.captains[1].modules.miner = 42;

    const { next } = prestige(state);
    expect(next.captains).toHaveLength(2);
    expect(next.captains[0].captainPoints).toBe(0);
    expect(next.captains[0].specialization).toBe(null);
    expect(next.captains[0].modules.miner).toBe(1); // back to Captain 1's head start
    expect(next.captains[1].modules.miner).toBe(0); // back to Captain 2's empty start
  });

  it("carries augmentPoints/prestigeCount/gameTimeSeconds forward, does nothing if gained <= 0", () => {
    const state = freshState();
    state.gameTimeSeconds = 500;
    const { next, gained } = prestige(state);
    expect(gained).toBe(0);
    expect(next).toBe(state);
  });

  it("yields nothing on a second immediate prestige with no new components produced", () => {
    const state = freshState();
    state.captains[0].lifetimeComponents = 100;

    const { next: afterFirst } = prestige(state);
    const { gained: secondGain } = prestige(afterFirst);
    expect(secondGain).toBe(0);
  });
});
```

**Step 2: Confirm the tests would fail**

`tickCaptainStack` and `captainPrestige` don't exist in the current `tick.ts`; `tick()` currently
takes/returns the old flat `GameState`; `prestige()` currently gates on a single top-level
`lifetimeComponents`. Confirm by inspection this file would not type-check against the current
`tick.ts`.

**Step 3: Write the implementation**

Replace the entire contents of `src/lib/game/tick.ts` with:

```ts
// Tick loop — tech spec §2 (Tick Loop and Time Semantics), extended for
// Phase 1 of the captain/ship feature (docs/plans/2026-07-03-captain-ship-design.md).
//
// tickCaptainStack() MUST be closed-form per captain: calling it once with a
// large delta must produce the same result as calling it many times with a
// small delta, for THAT captain's stack. tick() loops this over every
// captain in the roster and additionally advances the fleet-wide
// gameTimeSeconds once per call (not once per captain -- gameTimeSeconds is
// fleet bookkeeping, not tied to any single captain's production).
//
// Test this assumption in tick.test.ts before adding anything that breaks it
// (capacity caps, consumption chains, anything stateful mid-tick).

import {
  MODULES,
  globalMultiplier,
  captainMultiplier,
  specializationMultiplier,
  freshCaptains,
  freshCaptainStack,
  RESEARCH_PROJECTS,
  type GameState,
  type CaptainState,
  type SpecializationKey,
} from "./model";

export function tickCaptainStack(deltaSeconds: number, captain: CaptainState, fleetMult: number): CaptainState {
  if (deltaSeconds <= 0) return captain;

  const capMult = captainMultiplier(captain);
  const resources = { ...captain.resources };

  for (const key of Object.keys(MODULES) as (keyof typeof MODULES)[]) {
    const m = MODULES[key];
    const count = captain.modules[key];
    if (count > 0) {
      const specMult = specializationMultiplier(captain, m.resource);
      resources[m.resource] += m.baseRate * count * fleetMult * capMult * specMult * deltaSeconds;
    }
  }

  // Research progress — same shape as before Phase 1, just scoped to this
  // captain's own `research` instead of a fleet-wide one. See the original
  // comment in the pre-Phase-1 tick.ts (preserved in git history) for the
  // full rationale on why `completed` is a one-way terminal flag.
  const research = { ...captain.research };
  for (const key of Object.keys(RESEARCH_PROJECTS) as (keyof typeof RESEARCH_PROJECTS)[]) {
    const project = research[key];
    if (project.started && !project.completed) {
      const duration = RESEARCH_PROJECTS[key].durationSeconds;
      const newProgress = Math.min(project.progressSeconds + deltaSeconds, duration);
      research[key] = { ...project, progressSeconds: newProgress, completed: newProgress >= duration };
    }
  }

  const producedComponents = Math.max(0, resources.components - captain.resources.components);

  return {
    ...captain,
    resources,
    research,
    lifetimeComponents: captain.lifetimeComponents + producedComponents,
  };
}

export function tick(deltaSeconds: number, state: GameState): GameState {
  if (deltaSeconds <= 0) return state;

  const fleetMult = globalMultiplier(state);
  const captains = state.captains.map((captain) => tickCaptainStack(deltaSeconds, captain, fleetMult));

  return {
    ...state,
    captains,
    gameTimeSeconds: state.gameTimeSeconds + deltaSeconds,
  };
}

// Per-captain prestige ("Tier 1, captain scope"). Gate mirrors the original
// single-stack prestige()'s exact formula, scoped to one captain's own
// lifetimeComponents. Resets that captain to the shared freshCaptainStack()
// baseline, keeps id/label/shipType, adds the gain to captainPoints, and
// assigns (or re-assigns) the chosen specialization -- respeccing a captain
// is just prestiging them again with a different pick. Other captains in the
// array are untouched.
export function captainPrestige(
  state: GameState,
  captainId: number,
  chosenSpec: SpecializationKey
): { next: GameState; gained: number } {
  const idx = state.captains.findIndex((c) => c.id === captainId);
  const captain = state.captains[idx];
  const gained = Math.floor(Math.sqrt(captain.lifetimeComponents));
  if (gained <= 0) return { next: state, gained: 0 };

  const resetCaptain: CaptainState = {
    ...captain,
    ...freshCaptainStack(),
    captainPoints: captain.captainPoints + gained,
    captainPrestigeCount: captain.captainPrestigeCount + 1,
    specialization: chosenSpec,
  };

  const captains = [...state.captains];
  captains[idx] = resetCaptain;

  return { next: { ...state, captains }, gained };
}

// Fleet-wide prestige ("Tier 2, admiral scope"). Gate is the SUM of
// lifetimeComponents across every captain -- deliberately the bigger,
// slower-to-reach reset. On success: grants fleet-wide augmentPoints (same
// formula as before Phase 1) and collapses the ENTIRE captains array back to
// the starting 2-captain shape (freshCaptains()) -- wiping every captain's
// specialization, captainPoints, individual prestige count, and stack
// progress along with it. gameTimeSeconds still carries forward unchanged.
export function prestige(state: GameState): { next: GameState; gained: number } {
  const totalLifetimeComponents = state.captains.reduce((sum, c) => sum + c.lifetimeComponents, 0);
  const gained = Math.floor(Math.sqrt(totalLifetimeComponents));
  if (gained <= 0) return { next: state, gained: 0 };

  const next: GameState = {
    captains: freshCaptains(),
    augmentPoints: state.augmentPoints + gained,
    prestigeCount: state.prestigeCount + 1,
    gameTimeSeconds: state.gameTimeSeconds,
  };
  return { next, gained };
}
```

**Note on a deliberately changed behavior:** the pre-Phase-1 codebase had a regression test,
`"prestige — tickDurationSeconds persistence"`, asserting that a customized `tickDurationSeconds`
survived a prestige reset. That test is **intentionally not carried forward** — `tickDurationSeconds`
is now part of `CaptainState`, and both prestige tiers reset a captain's stack fully (including
`tickDurationSeconds`, via `freshCaptainStack()`/`freshCaptains()`), per the approved design. This
is a deliberate, approved behavior change, not an accidental regression: no code anywhere currently
*changes* `tickDurationSeconds` away from its default 10 (it remains an inert placeholder for a
"future bonus" that doesn't exist yet), so nothing observable is lost in practice today. This is
called out explicitly rather than silently dropped, per this project's standing rule against
silently rewriting tested behavior.

**Step 4: Confirm the tests would pass**

Manually trace the higher-risk ones:
- Closed-form test: `tickCaptainStack`'s formula multiplies `fleetMult * capMult * specMult *
  deltaSeconds` — all three multipliers are recomputed fresh from the *input* `captain`/`fleetMult`
  on every call, never derived from accumulated state, so summing many small deltas equals one big
  delta by ordinary arithmetic distributivity, exactly as it did before Phase 1 with just
  `mult * deltaSeconds`. This holds regardless of how many multiplicative factors are chained in,
  since none of them depend on `deltaSeconds` or on the running total.
- `captainPrestige(state, 1, "mining")` with `captains[0].lifetimeComponents = 100`: `gained =
  floor(sqrt(100)) = 10`. `resetCaptain = { ...captain, ...freshCaptainStack(), captainPoints: 0 +
  10, captainPrestigeCount: 0 + 1, specialization: "mining" }` — `freshCaptainStack()` sets
  `modules.miner: 1`, overriding the test's `modules.miner = 50`. `captains[1]` is never touched
  since only `captains[idx]` (idx 0) is replaced in the copied array. ✓
- `prestige(state)` with `captains[0].lifetimeComponents=36, captains[1].lifetimeComponents=64`:
  `totalLifetimeComponents = 100`, `gained = floor(sqrt(100)) = 10`. ✓ `next.captains =
  freshCaptains()` — a brand new 2-element array with Captain 1's `modules.miner:1` and Captain 2's
  `modules.miner:0`, matching the test's expectations regardless of what was in `state.captains`
  before (the whole array is replaced, not merged). ✓

**Step 5: Commit**

```bash
git add src/lib/game/tick.ts src/lib/game/tick.test.ts
git commit -m "feat: extract tickCaptainStack, add captainPrestige, extend fleet prestige"
```

---

### Task 3: Save migration v4 → v5 (`save.ts`)

**Files:**
- Modify: `src/lib/game/save.ts`
- Modify: `src/lib/game/save.test.ts`

**Context:** Read the current `save.ts` in full, including its extensive comments about the v2→v3
gap that caused a real production hotfix this session (a save got re-stamped to a version number
without actually having the fields that version implies). That incident is exactly why this
migration needs a genuine "old flat shape, `captains` entirely absent" test, not just a stripped
field, and a full chained v1→v5 test — not just an isolated v4→v5 step.

**Step 1: Write the failing tests**

Add to `src/lib/game/save.test.ts` (keep every existing `describe` block untouched, add these new
ones, and update the two `"current SAVE_VERSION is 4"` assertions — see Step 1b below):

```ts
describe("migrate — captains roster backfill (v4 -> v5)", () => {
  it("moves the old flat shape into captains[0] and adds a fresh captains[1]", () => {
    // A genuine pre-Phase-1 save: resources/modules/research/lifetimeComponents/
    // tickDurationSeconds sitting directly on the state object, `captains`
    // entirely absent -- exactly the real shape this migration exists to repair.
    const legacyState: any = {
      resources: { ore: 500, ingots: 200, components: 50, alloys: 12 },
      modules: { miner: 19, refinery: 5, fabricator: 2, synthesizer: 1 },
      research: { alloySynthesis: { started: false, progressSeconds: 0, completed: true } },
      lifetimeComponents: 300,
      tickDurationSeconds: 10,
      augmentPoints: 42,
      prestigeCount: 3,
      gameTimeSeconds: 9000,
    };

    const save: SaveFile = {
      version: 4,
      created_at: 0,
      last_saved_at: 0,
      game_time_seconds: 9000,
      state: legacyState,
    };

    const migrated: any = migrate(save);
    expect(migrated.captains).toHaveLength(2);

    // Captain 1: the old single stack, preserved verbatim (including
    // already-completed research -- this is what a real returning player's
    // save looks like right now).
    expect(migrated.captains[0].id).toBe(1);
    expect(migrated.captains[0].label).toBe("Captain 1");
    expect(migrated.captains[0].shipType).toBe("resourcer");
    expect(migrated.captains[0].resources).toEqual({ ore: 500, ingots: 200, components: 50, alloys: 12 });
    expect(migrated.captains[0].modules).toEqual({ miner: 19, refinery: 5, fabricator: 2, synthesizer: 1 });
    expect(migrated.captains[0].research.alloySynthesis.completed).toBe(true);
    expect(migrated.captains[0].lifetimeComponents).toBe(300);
    expect(migrated.captains[0].captainPoints).toBe(0);
    expect(migrated.captains[0].captainPrestigeCount).toBe(0);
    expect(migrated.captains[0].specialization).toBe(null);

    // Captain 2: fresh, empty, never played.
    expect(migrated.captains[1].id).toBe(2);
    expect(migrated.captains[1].label).toBe("Captain 2");
    expect(migrated.captains[1].modules.miner).toBe(0);
    expect(migrated.captains[1].lifetimeComponents).toBe(0);

    // Fleet-wide fields survive untouched; old top-level per-stack fields are gone.
    expect(migrated.augmentPoints).toBe(42);
    expect(migrated.prestigeCount).toBe(3);
    expect(migrated.gameTimeSeconds).toBe(9000);
    expect(migrated.resources).toBeUndefined();
    expect(migrated.modules).toBeUndefined();
    expect(migrated.research).toBeUndefined();
    expect(migrated.lifetimeComponents).toBeUndefined();
    expect(migrated.tickDurationSeconds).toBeUndefined();
  });

  it("current SAVE_VERSION is 5", () => {
    expect(SAVE_VERSION).toBe(5);
  });
});

describe("migrate — chained v1 -> v5 migration", () => {
  it("backfills every field across all four migration steps on a genuine v1 save missing all of them", () => {
    // The real v1 shape: no tickDurationSeconds, no research, no
    // synthesizer/alloys fields, AND (obviously) no captains array at all --
    // this exercises MIGRATIONS[1] through [4] running back-to-back on the
    // same object, not just one isolated step.
    const legacyState: any = {
      resources: { ore: 10, ingots: 0, components: 0 },
      modules: { miner: 1, refinery: 0, fabricator: 0 },
      lifetimeComponents: 0,
      augmentPoints: 0,
      prestigeCount: 0,
      gameTimeSeconds: 100,
    };

    const save: SaveFile = {
      version: 1,
      created_at: 0,
      last_saved_at: 0,
      game_time_seconds: 100,
      state: legacyState,
    };

    const migrated: any = migrate(save);
    expect(migrated.captains).toHaveLength(2);
    expect(migrated.captains[0].tickDurationSeconds).toBe(10);
    expect(migrated.captains[0].research.alloySynthesis).toEqual({
      started: false,
      progressSeconds: 0,
      completed: false,
    });
    expect(migrated.captains[0].modules.synthesizer).toBe(0);
    expect(migrated.captains[0].resources.alloys).toBe(0);
    expect(migrated.captains[0].modules.miner).toBe(1); // original v1 progress preserved
    expect(migrated.captains[1].modules.miner).toBe(0); // fresh second captain
    expect(migrated.gameTimeSeconds).toBe(100); // fleet-wide field survives the whole chain
  });
});
```

**Step 1b:** In the two existing `it("current SAVE_VERSION is 4", ...)` blocks (in the
`"migrate — tickDurationSeconds backfill"` and `"migrate — research field backfill"` describe
blocks), change `expect(SAVE_VERSION).toBe(4)` to `expect(SAVE_VERSION).toBe(5)`. This is the same
kind of expected test maintenance done at every previous version bump this session (the test's
purpose is catching an accidental revert of the bump, not pinning the number forever).

**Step 2: Confirm the tests would fail**

`MIGRATIONS[4]` doesn't exist yet and `SAVE_VERSION` is currently `4`. Confirm by inspection.

**Step 3: Write the implementation**

In `src/lib/game/save.ts`:

1. Change `export const SAVE_VERSION = 4;` to `export const SAVE_VERSION = 5;`.
2. Add `import { freshCaptains, type CaptainState } from "./model";` — wait, `GameState` is already
   imported; add `freshCaptains` to that same import line instead of a new one:
   ```ts
   import { type GameState, freshCaptains } from "./model";
   ```
3. Extend the top-of-file migration-table comment and add `MIGRATIONS[4]`:

```ts
// Migration table, keyed by the version a save is migrating FROM.
// v1 -> v2: tick bar feature added tickDurationSeconds (see MIGRATIONS[1]).
// v2 -> v3: research feature (docs/plans/2026-07-03-research-plan.md, Task 3)
// added `research` to GameState. Saves made before that field existed need
// it backfilled to a fresh, not-yet-started alloySynthesis entry.
// v3 -> v4: HOTFIX. The same research feature also added a 4th module/
// resource pair (modules.synthesizer, resources.alloys) to MODULES/
// RESOURCE_ORDER, but MIGRATIONS[2] only backfilled `research` -- it never
// backfilled these two fields. Any save migrated through the *unpatched*
// MIGRATIONS[2] already got re-stamped as v3 by the next autosave (serialize()
// always writes the current SAVE_VERSION), but still has an object literal
// missing the `synthesizer`/`alloys` keys entirely -- not just a numeric
// zero. That undefined count makes costFor() -> Math.pow(x, undefined) ->
// NaN, which makes affordable = ore >= NaN always false: Synthesizer looks
// permanently unaffordable no matter how much ore you have.
// Because those already-v3-stamped saves will never re-run MIGRATIONS[2]
// (their version field already reads 3), patching MIGRATIONS[2] cannot fix
// them. Per Ops §8.E.1 (never edit a shipped migration body), this repair
// has to be a new v3 -> v4 step instead, so it runs for both the
// already-corrupted v3 saves and any v1/v2 save still chaining through.
// v4 -> v5: Multi-Captain Stacks (docs/plans/2026-07-03-captain-ship-plan.md,
// Task 3). The single flat resources/modules/research/lifetimeComponents/
// tickDurationSeconds shape moves into captains[0]; a fresh captains[1] is
// added alongside it. The old top-level fields are dropped from the migrated
// shape (they no longer exist on GameState at all -- there is nothing to
// backfill them TO on the fleet-wide object, unlike prior migrations which
// only ever added missing fields to an otherwise-intact shape).
type Migration = (state: any) => any;
const MIGRATIONS: Record<number, Migration> = {
  1: (state: any): GameState => ({ ...state, tickDurationSeconds: state.tickDurationSeconds ?? 10 }),
  2: (state: any): GameState => ({
    ...state,
    research: state.research ?? { alloySynthesis: { started: false, progressSeconds: 0, completed: false } },
  }),
  3: (state: any): GameState => ({
    ...state,
    modules: { ...state.modules, synthesizer: state.modules?.synthesizer ?? 0 },
    resources: { ...state.resources, alloys: state.resources?.alloys ?? 0 },
  }),
  4: (state: any): GameState => {
    const fresh = freshCaptains();
    const captainOne: CaptainState = {
      id: 1,
      label: "Captain 1",
      shipType: "resourcer",
      resources: state.resources,
      modules: state.modules,
      research: state.research,
      lifetimeComponents: state.lifetimeComponents,
      tickDurationSeconds: state.tickDurationSeconds,
      captainPoints: 0,
      captainPrestigeCount: 0,
      specialization: null,
    };
    const { resources, modules, research, lifetimeComponents, tickDurationSeconds, ...fleetWide } = state;
    return {
      ...fleetWide,
      captains: [captainOne, fresh[1]],
    };
  },
};
```

**Step 4: Confirm the tests would pass**

Manually trace the new v4→v5 test: `legacyState` has the old flat fields plus fleet-wide
`augmentPoints`/`prestigeCount`/`gameTimeSeconds`. `MIGRATIONS[4]` builds `captainOne` from the old
fields directly (preserving `resources`/`modules`/`research`/`lifetimeComponents`/
`tickDurationSeconds` verbatim, including `research.alloySynthesis.completed: true`), destructures
the old fields out of `state` via the rest-spread (`...fleetWide` now contains only
`augmentPoints`/`prestigeCount`/`gameTimeSeconds`), and returns `{ ...fleetWide, captains: [captainOne,
fresh[1]] }`. Since `resources`/`modules`/`research`/`lifetimeComponents`/`tickDurationSeconds` are
destructured OUT of `state` before spreading `fleetWide`, they do not appear on the returned object
at all — confirming `migrated.resources` etc. are `undefined`. `fresh[1]` is `freshCaptains()`'s
second element — id 2, empty stack — independent of whatever was in the legacy save. ✓

Manually trace the chained v1→v5 test: `migrate()`'s `while (MIGRATIONS[version])` loop starts at
version 1. `MIGRATIONS[1]` backfills `tickDurationSeconds:10` (still on the flat shape at this
point — version becomes 2). `MIGRATIONS[2]` backfills `research` (version becomes 3).
`MIGRATIONS[3]` backfills `modules.synthesizer:0`/`resources.alloys:0` (version becomes 4).
`MIGRATIONS[4]` now sees a fully-populated flat shape (all prior steps already ran on it in
sequence) and moves it into `captains[0]`/`captains[1]` as above (version becomes 5).
`MIGRATIONS[5]` doesn't exist, loop halts. Every assertion in the test reads a field that this
chain populates in order. ✓

**Step 5: Commit**

```bash
git add src/lib/game/save.ts src/lib/game/save.test.ts
git commit -m "feat: migrate save schema v4->v5, move flat shape into captains[0]"
```

---

### Task 4: Per-captain tick-bar loop rewrite (`App.svelte`) — HIGH RISK, read fully before editing

**Files:**
- Modify: `src/App.svelte`

**Context — read this whole section before touching any code.** The current `onMount` sets up ONE
`setInterval(100ms)` tracking a single `barCycleStart`/`nowTick`/`paused`, calling the whole-state
`tick()` once per cycle. Since `tickDurationSeconds` is now per-captain (cadences CAN diverge, even
though nothing currently makes them diverge — see the design doc), this loop must become: one
`setInterval(100ms)` that, on every poll, (a) advances the fleet-wide `gameTimeSeconds` by the real
elapsed time since the last poll (independent of any captain's cycle — `gameTimeSeconds` is fleet
bookkeeping, not tied to production), and (b) checks EVERY captain's own cycle progress, firing
`tickCaptainStack` for whichever captain(s) complete a cycle on this poll, independently of the
others.

This task ONLY touches the timing/state-management logic in `<script>` — it does NOT touch the
`<template>` markup (that's Task 5) beyond what's strictly required to keep the file compiling
(the existing `TICK` panel reads `tickProgress`/`tickRemaining`, which are being replaced by
per-captain equivalents; Task 5 will re-point that panel at the active captain — for THIS task,
keep the file compiling by deriving `tickProgress`/`tickRemaining` for whichever captain is at
index 0, as a placeholder Task 5 will correct).

**Step 1: Replace the timing state variables**

Find (near the top of `<script>`):

```ts
  let speed = 1;
  let logEntries: string[] = [];
  let barCycleStart = Date.now();
  let nowTick = Date.now();
  let paused = false;
  let tickHandle: ReturnType<typeof setInterval>;
  let saveHandle: ReturnType<typeof setInterval>;
```

Replace with:

```ts
  let speed = 1;
  let logEntries: string[] = [];
  let paused = false;
  let tickHandle: ReturnType<typeof setInterval>;
  let saveHandle: ReturnType<typeof setInterval>;
  let lastPollTime = Date.now();

  // Per-captain cycle tracking, keyed by captain id. Each captain's own
  // tickDurationSeconds can diverge from the others' (nothing does that yet,
  // but the data model is built for it -- see design doc), so each needs its
  // own independent barCycleStart/nowTick rather than one shared pair.
  interface CaptainCycle {
    barCycleStart: number;
    nowTick: number;
  }
  let captainCycles: Record<number, CaptainCycle> = {};

  function ensureCaptainCycles(now: number) {
    for (const captain of state.captains) {
      if (!captainCycles[captain.id]) {
        captainCycles[captain.id] = { barCycleStart: now, nowTick: now };
      }
    }
    captainCycles = captainCycles; // reassign to trigger Svelte reactivity on the mutated object
  }
```

**Step 2: Replace the `onMount` tick-bar loop**

Find (the whole tick-bar-related block inside `onMount`, from the `barCycleStart = Date.now();`
line through the end of the `tickHandle = setInterval(...)` call):

```ts
    barCycleStart = Date.now();
    nowTick = Date.now();

    // Tick-bar loop — checks cycle progress every 100ms, fires a discrete
    // tick() call once per full cycle. barSeconds is floored at 1 real
    // second so dev-speed presets never make the bar flicker unreadably;
    // multiple game-ticks just batch into that one visual cycle, which is
    // still correct because tick() is closed-form (see design doc).
    tickHandle = setInterval(() => {
      if (speed === 0) {
        paused = true;
        return; // paused — bar and resources both freeze
      }
      const now = Date.now();
      if (paused) {
        // Resuming: discard the paused wall-clock gap entirely rather than
        // letting it read as elapsed cycle time (which would fire an
        // instant, unearned tick on resume).
        barCycleStart = now;
        nowTick = now;
        paused = false;
        return;
      }
      const barSeconds = Math.max(1, state.tickDurationSeconds / speed);
      nowTick = now;
      const progress = (now - barCycleStart) / 1000 / barSeconds;
      if (progress >= 1) {
        const gameSecondsThisCycle = barSeconds * speed;
        state = tick(gameSecondsThisCycle, state);
        barCycleStart = now;
      }
    }, 100);
```

Replace with:

```ts
    lastPollTime = Date.now();
    ensureCaptainCycles(lastPollTime);

    // Tick-bar loop — checks EVERY captain's own cycle progress every 100ms,
    // firing tickCaptainStack independently for whichever captain(s)
    // complete a cycle on this poll. Fleet-wide gameTimeSeconds advances
    // continuously off real elapsed time every poll, decoupled from any
    // single captain's cadence (gameTimeSeconds is fleet bookkeeping; it is
    // never read by tickCaptainStack's production math, so this decoupling
    // cannot desync production from time). barSeconds is floored at 1 real
    // second per captain so dev-speed presets never make that captain's bar
    // flicker unreadably — multiple game-ticks just batch into one visual
    // cycle, which is still correct because tickCaptainStack is closed-form.
    tickHandle = setInterval(() => {
      const now = Date.now();

      if (speed === 0) {
        paused = true;
        lastPollTime = now; // freeze the fleet clock too while paused
        return;
      }

      if (paused) {
        // Resuming: discard the paused wall-clock gap entirely for the fleet
        // clock AND every captain's cycle, rather than letting it read as
        // elapsed time (which would fire unearned progress on resume).
        lastPollTime = now;
        for (const id of Object.keys(captainCycles)) {
          captainCycles[Number(id)].barCycleStart = now;
        }
        captainCycles = captainCycles;
        paused = false;
        return;
      }

      const realElapsedSeconds = (now - lastPollTime) / 1000;
      lastPollTime = now;
      state = { ...state, gameTimeSeconds: state.gameTimeSeconds + realElapsedSeconds * speed };

      ensureCaptainCycles(now);
      let captains = state.captains;
      let anyFired = false;

      for (let i = 0; i < captains.length; i++) {
        const captain = captains[i];
        const cycle = captainCycles[captain.id];
        const barSeconds = Math.max(1, captain.tickDurationSeconds / speed);
        cycle.nowTick = now;
        const progress = (now - cycle.barCycleStart) / 1000 / barSeconds;
        if (progress >= 1) {
          const fleetMult = globalMultiplier(state);
          const gameSecondsThisCycle = barSeconds * speed;
          if (!anyFired) {
            captains = [...captains]; // copy on first write this poll
            anyFired = true;
          }
          captains[i] = tickCaptainStack(gameSecondsThisCycle, captain, fleetMult);
          cycle.barCycleStart = now;
        }
      }

      captainCycles = captainCycles; // reassign to trigger reactivity on the mutated cycle map
      if (anyFired) {
        state = { ...state, captains };
      }
    }, 100);
```

**Step 3: Update imports**

Find:

```ts
  import { tick, prestige } from "./lib/game/tick";
```

Replace with:

```ts
  import { tick, tickCaptainStack, prestige, captainPrestige } from "./lib/game/tick";
```

(`captainPrestige` isn't wired up to any UI yet — that's Task 6 — but importing it now avoids a
second import-line edit in that task.)

**Step 4: Keep the file compiling — placeholder reactive derivations**

Find the existing reactive block at the bottom of `<script>`:

```ts
  $: mult = globalMultiplier(state);
  $: barSeconds = Math.max(1, state.tickDurationSeconds / (speed || 1));
  $: tickProgress = Math.min(1, Math.max(0, (nowTick - barCycleStart) / 1000 / barSeconds));
  $: tickRemaining = Math.max(0, barSeconds * (1 - tickProgress));
```

Replace with:

```ts
  $: mult = globalMultiplier(state);
```

(The `barSeconds`/`tickProgress`/`tickRemaining` derivations move to Task 5, scoped per-captain —
removing them here is safe because Task 5 lands in the same review cycle before this is considered
done; the `TICK` panel in the template will not compile between Task 4 and Task 5 landing, which is
expected and acceptable mid-plan, not mid-review.)

**Step 5: Manual verification (no automated test — timing logic, Node unavailable)**

Trace through by hand:
- On mount, `ensureCaptainCycles` seeds one `CaptainCycle` per captain in `state.captains` (2 on a
  fresh/migrated save), both starting at `now`.
- Each 100ms poll: `realElapsedSeconds` is computed from wall-clock delta since the last poll (not
  since app start), so it stays small and consistent even if the tab was backgrounded and polls
  were throttled — this matches the OLD code's behavior of measuring from `barCycleStart` each
  time, just now measuring the fleet clock independently of any bar.
- If two captains have the same `tickDurationSeconds` (true for both captains on a fresh/migrated
  save, since nothing currently sets a different value), both cycles reach `progress >= 1` on the
  same poll, both get updated in the same `captains` copy, matching the pre-Phase-1 single-loop
  behavior exactly when there's effectively only one cadence in play.
- Pausing (`speed === 0`) freezes `lastPollTime` (so the fleet clock doesn't jump on resume) without
  touching any `captainCycles` entry; resuming discards the gap for the fleet clock AND every
  captain's own cycle in one pass, mirroring the old single-cycle pause/resume behavior class of
  bug fixed earlier this session (the pause/resume tick-bar bug from the tick-bar feature's final
  review) — re-verify that fix's spirit is preserved for N captains, not just re-derived by luck.

**Step 6: Commit**

```bash
git add src/App.svelte
git commit -m "feat: rewrite tick-bar loop to track each captain's cycle independently"
```

---

### Task 5: Captain tabs + scope existing panels to the active captain (`App.svelte`)

**Files:**
- Modify: `src/App.svelte`

**Context:** The `RESOURCES`, `TICK`, `GENERATOR STACK`, and `RESEARCH` panels currently read
`state.xxx` directly. They need to read from whichever captain is selected by a new tab strip. The
dev panel's `grantResource`/`simulateOffline` actions also need to target the active captain
instead of a flat `state.resources`.

**Step 1: Add active-captain state and a reactive derivation**

In `<script>`, near the other `let` declarations, add:

```ts
  let activeCaptainIndex = 0;
```

In the reactive block at the bottom of `<script>` (from Task 4, currently just `$: mult =
globalMultiplier(state);`), add:

```ts
  $: activeCaptain = state.captains[activeCaptainIndex];
  $: activeCycle = captainCycles[activeCaptain?.id] ?? { barCycleStart: Date.now(), nowTick: Date.now() };
  $: activeBarSeconds = Math.max(1, (activeCaptain?.tickDurationSeconds ?? 10) / (speed || 1));
  $: activeTickProgress = Math.min(1, Math.max(0, (activeCycle.nowTick - activeCycle.barCycleStart) / 1000 / activeBarSeconds));
  $: activeTickRemaining = Math.max(0, activeBarSeconds * (1 - activeTickProgress));
```

(The `?? Date.now()`/`?? 10` fallbacks only matter for the single render tick before `onMount`
seeds `captainCycles` — same defensive style already used elsewhere in this file.)

**Step 2: Update imports**

Find:

```ts
  import {
    MODULES,
    RESOURCE_ORDER,
    RESOURCE_LABEL,
    freshState,
    costFor,
    globalMultiplier,
    isModuleUnlocked,
    isResourceUnlocked,
    RESEARCH_PROJECTS,
    type ModuleKey,
    type ResearchKey,
    type GameState,
  } from "./lib/game/model";
```

Replace with:

```ts
  import {
    MODULES,
    RESOURCE_ORDER,
    RESOURCE_LABEL,
    freshState,
    costFor,
    globalMultiplier,
    captainMultiplier,
    specializationMultiplier,
    isModuleUnlocked,
    isResourceUnlocked,
    RESEARCH_PROJECTS,
    SPECIALIZATIONS,
    type ModuleKey,
    type ResearchKey,
    type SpecializationKey,
    type GameState,
    type CaptainState,
  } from "./lib/game/model";
```

**Step 3: Update `buyModule`, `startResearch`, and dev-panel actions to target the active captain**

Find:

```ts
  function buyModule(key: ModuleKey) {
    if (!isModuleUnlocked(key, state)) return;
    const cost = costFor(key, state.modules[key]);
    if (state.resources.ore < cost) return;
    state = {
      ...state,
      resources: { ...state.resources, ore: state.resources.ore - cost },
      modules: { ...state.modules, [key]: state.modules[key] + 1 },
    };
  }
```

Replace with:

```ts
  function updateActiveCaptain(updater: (c: CaptainState) => CaptainState) {
    const captains = [...state.captains];
    captains[activeCaptainIndex] = updater(captains[activeCaptainIndex]);
    state = { ...state, captains };
  }

  function buyModule(key: ModuleKey) {
    const captain = activeCaptain;
    if (!isModuleUnlocked(key, captain)) return;
    const cost = costFor(key, captain.modules[key]);
    if (captain.resources.ore < cost) return;
    updateActiveCaptain((c) => ({
      ...c,
      resources: { ...c.resources, ore: c.resources.ore - cost },
      modules: { ...c.modules, [key]: c.modules[key] + 1 },
    }));
  }
```

Find:

```ts
  function grantResource(resource: keyof GameState["resources"], amount: number) {
    state = { ...state, resources: { ...state.resources, [resource]: state.resources[resource] + amount } };
    pushLog(`[DEV] Granted ${formatNumber(amount)} ${resource}.`);
  }

  function simulateOffline(hours: number) {
    state = tick(hours * 3600, state);
    pushLog(`[DEV] Simulated ${hours}h offline.`);
  }
```

Replace with:

```ts
  function grantResource(resource: keyof CaptainState["resources"], amount: number) {
    updateActiveCaptain((c) => ({ ...c, resources: { ...c.resources, [resource]: c.resources[resource] + amount } }));
    pushLog(`[${activeCaptain.label}] [DEV] Granted ${formatNumber(amount)} ${resource}.`);
  }

  function simulateOffline(hours: number) {
    state = tick(hours * 3600, state); // fleet-wide: advances every captain, matches real offline catch-up
    pushLog(`[DEV] Simulated ${hours}h offline for the whole fleet.`);
  }
```

Find:

```ts
  function startResearch(key: ResearchKey) {
    const project = RESEARCH_PROJECTS[key];
    const entry = state.research[key];
    if (entry.started || entry.completed) return; // not safe to call twice by construction otherwise
    if (state.resources.components < project.costComponents) return;
    state = {
      ...state,
      resources: { ...state.resources, components: state.resources.components - project.costComponents },
      research: { ...state.research, [key]: { ...entry, started: true } },
    };
    pushLog(`Research started: ${project.label}.`);
  }
```

Replace with:

```ts
  function startResearch(key: ResearchKey) {
    const project = RESEARCH_PROJECTS[key];
    const captain = activeCaptain;
    const entry = captain.research[key];
    if (entry.started || entry.completed) return; // not safe to call twice by construction otherwise
    if (captain.resources.components < project.costComponents) return;
    updateActiveCaptain((c) => ({
      ...c,
      resources: { ...c.resources, components: c.resources.components - project.costComponents },
      research: { ...c.research, [key]: { ...entry, started: true } },
    }));
    pushLog(`[${captain.label}] Research started: ${project.label}.`);
  }
```

**Step 4: Add the tab strip and scope the RESOURCES/TICK/GENERATOR STACK/RESEARCH panels**

Find the opening of `<main class="main">` through the end of the `RESEARCH` panel (i.e. everything
from `<main class="main">` down to the `RESEARCH` panel's closing `</Panel>`, NOT including the
`PRESTIGE — TIER 1` panel that follows):

```svelte
    <main class="main">
      <Panel>
        <div class="panel-title">RESOURCES</div>
        <div class="resource-grid">
          {#each RESOURCE_ORDER as r}
            {@const unlocked = isResourceUnlocked(r, state)}
            <div class="resource-card">
              <div class="resource-label">{RESOURCE_LABEL[r]}</div>
              {#if unlocked}
                <div class="resource-value">{formatNumber(state.resources[r])}</div>
              {:else}
                <div class="resource-value locked">🔒</div>
              {/if}
            </div>
          {/each}
        </div>
      </Panel>

      <Panel>
        <div class="panel-title">TICK</div>
        <div class="tick-bar-track">
          <div class="tick-bar-fill" style="width:{tickProgress * 100}%"></div>
        </div>
        <div class="tick-bar-readout">{tickRemaining.toFixed(1)}s</div>
      </Panel>

      <Panel>
        <div class="panel-title">GENERATOR STACK</div>
        <div class="module-list">
          {#each Object.entries(MODULES) as [key, m]}
            {@const unlocked = isModuleUnlocked(key as ModuleKey, state)}
            {#if unlocked}
              {@const count = state.modules[key as ModuleKey]}
              {@const cost = costFor(key as ModuleKey, count)}
              {@const rate = m.baseRate * count * mult}
              {@const perTick = rate * state.tickDurationSeconds}
              {@const affordable = state.resources.ore >= cost}
              <div class="module-card">
                <div class="module-top">
                  <div>
                    <div class="module-name">{m.label}</div>
                    <div class="module-rate">
                      {formatNumber(perTick)} {m.unit.replace("/s", "")}/tick · {formatNumber(rate)} {m.unit} · owned {count}
                    </div>
                  </div>
                  <button
                    class="buy-btn"
                    disabled={!affordable}
                    style="opacity:{affordable ? 1 : 0.4}"
                    on:click={() => buyModule(key as ModuleKey)}
                  >
                    Buy · {formatNumber(cost)} ore
                  </button>
                </div>
              </div>
            {:else}
              <div class="module-card locked">
                <div class="module-top">
                  <div>
                    <div class="module-name">{m.label}</div>
                    <div class="module-rate">🔒 Locked — requires {RESEARCH_PROJECTS.alloySynthesis.label} research</div>
                  </div>
                </div>
              </div>
            {/if}
          {/each}
        </div>
      </Panel>

      <Panel>
        <div class="panel-title">RESEARCH</div>
        {#if state.research.alloySynthesis.completed}
          <p class="research-status">✓ {RESEARCH_PROJECTS.alloySynthesis.label} — Complete</p>
        {:else if state.research.alloySynthesis.started}
          {@const project = RESEARCH_PROJECTS.alloySynthesis}
          {@const progress = Math.min(1, state.research.alloySynthesis.progressSeconds / project.durationSeconds)}
          {@const remaining = Math.max(0, project.durationSeconds - state.research.alloySynthesis.progressSeconds)}
          <div class="research-name">{project.label}</div>
          <div class="research-bar-track">
            <div class="research-bar-fill" style="width:{progress * 100}%"></div>
          </div>
          <div class="research-readout">{remaining.toFixed(0)}s remaining</div>
        {:else}
          {@const project = RESEARCH_PROJECTS.alloySynthesis}
          {@const affordable = state.resources.components >= project.costComponents}
          <div class="research-name">{project.label}</div>
          <div class="research-cost">Cost: {formatNumber(project.costComponents)} components</div>
          <button
            class="buy-btn"
            disabled={!affordable}
            style="opacity:{affordable ? 1 : 0.4}"
            on:click={() => startResearch("alloySynthesis")}
          >
            Start Research
          </button>
        {/if}
      </Panel>
```

Replace with (note the new `captain-tabs` block right after `<main class="main">`, and every
`state.resources`/`state.modules`/`state.research`/`state.tickDurationSeconds` reference below it
changed to `activeCaptain.*`, plus `tickProgress`/`tickRemaining` changed to
`activeTickProgress`/`activeTickRemaining`):

```svelte
    <main class="main">
      <div class="captain-tabs">
        {#each state.captains as captain, i}
          <button class="captain-tab" class:active={i === activeCaptainIndex} on:click={() => (activeCaptainIndex = i)}>
            {captain.label}
          </button>
        {/each}
      </div>

      <Panel>
        <div class="panel-title">RESOURCES</div>
        <div class="resource-grid">
          {#each RESOURCE_ORDER as r}
            {@const unlocked = isResourceUnlocked(r, activeCaptain)}
            <div class="resource-card">
              <div class="resource-label">{RESOURCE_LABEL[r]}</div>
              {#if unlocked}
                <div class="resource-value">{formatNumber(activeCaptain.resources[r])}</div>
              {:else}
                <div class="resource-value locked">🔒</div>
              {/if}
            </div>
          {/each}
        </div>
      </Panel>

      <Panel>
        <div class="panel-title">TICK</div>
        <div class="tick-bar-track">
          <div class="tick-bar-fill" style="width:{activeTickProgress * 100}%"></div>
        </div>
        <div class="tick-bar-readout">{activeTickRemaining.toFixed(1)}s</div>
      </Panel>

      <Panel>
        <div class="panel-title">GENERATOR STACK</div>
        <div class="module-list">
          {#each Object.entries(MODULES) as [key, m]}
            {@const unlocked = isModuleUnlocked(key as ModuleKey, activeCaptain)}
            {#if unlocked}
              {@const count = activeCaptain.modules[key as ModuleKey]}
              {@const cost = costFor(key as ModuleKey, count)}
              {@const specMult = specializationMultiplier(activeCaptain, m.resource)}
              {@const rate = m.baseRate * count * mult * captainMultiplier(activeCaptain) * specMult}
              {@const perTick = rate * activeCaptain.tickDurationSeconds}
              {@const affordable = activeCaptain.resources.ore >= cost}
              <div class="module-card">
                <div class="module-top">
                  <div>
                    <div class="module-name">{m.label}</div>
                    <div class="module-rate">
                      {formatNumber(perTick)} {m.unit.replace("/s", "")}/tick · {formatNumber(rate)} {m.unit} · owned {count}
                    </div>
                  </div>
                  <button
                    class="buy-btn"
                    disabled={!affordable}
                    style="opacity:{affordable ? 1 : 0.4}"
                    on:click={() => buyModule(key as ModuleKey)}
                  >
                    Buy · {formatNumber(cost)} ore
                  </button>
                </div>
              </div>
            {:else}
              <div class="module-card locked">
                <div class="module-top">
                  <div>
                    <div class="module-name">{m.label}</div>
                    <div class="module-rate">🔒 Locked — requires {RESEARCH_PROJECTS.alloySynthesis.label} research</div>
                  </div>
                </div>
              </div>
            {/if}
          {/each}
        </div>
      </Panel>

      <Panel>
        <div class="panel-title">RESEARCH</div>
        {#if activeCaptain.research.alloySynthesis.completed}
          <p class="research-status">✓ {RESEARCH_PROJECTS.alloySynthesis.label} — Complete</p>
        {:else if activeCaptain.research.alloySynthesis.started}
          {@const project = RESEARCH_PROJECTS.alloySynthesis}
          {@const progress = Math.min(1, activeCaptain.research.alloySynthesis.progressSeconds / project.durationSeconds)}
          {@const remaining = Math.max(0, project.durationSeconds - activeCaptain.research.alloySynthesis.progressSeconds)}
          <div class="research-name">{project.label}</div>
          <div class="research-bar-track">
            <div class="research-bar-fill" style="width:{progress * 100}%"></div>
          </div>
          <div class="research-readout">{remaining.toFixed(0)}s remaining</div>
        {:else}
          {@const project = RESEARCH_PROJECTS.alloySynthesis}
          {@const affordable = activeCaptain.resources.components >= project.costComponents}
          <div class="research-name">{project.label}</div>
          <div class="research-cost">Cost: {formatNumber(project.costComponents)} components</div>
          <button
            class="buy-btn"
            disabled={!affordable}
            style="opacity:{affordable ? 1 : 0.4}"
            on:click={() => startResearch("alloySynthesis")}
          >
            Start Research
          </button>
        {/if}
      </Panel>
```

**Step 5: Update the stale header subtitle**

Find:

```svelte
        <span class="subtitle">prototype build · single ship · single sector</span>
```

Replace with:

```svelte
        <span class="subtitle">prototype build · multi-captain · single sector</span>
```

**Step 6: Add tab-strip CSS**

Add to the `<style>` block, near `.main`:

```css
  .captain-tabs { display: flex; gap: 8px; }
  .captain-tab {
    flex: 1;
    background: rgba(var(--color-accent-rgb), 0.06);
    border: 1px solid rgba(var(--color-accent-rgb), 0.2);
    border-radius: 8px;
    padding: 8px 10px;
    color: var(--color-text-secondary);
    font-size: 12px;
    cursor: pointer;
  }
  .captain-tab.active {
    background: rgba(var(--color-accent-rgb), 0.15);
    color: var(--color-accent-bright);
    border-color: var(--color-accent);
  }
```

**Step 7: Manual verification (no automated test — UI markup, Node unavailable)**

Confirm by reading: every reference to `state.resources`/`state.modules`/`state.research`/
`state.tickDurationSeconds` inside the four scoped panels now reads `activeCaptain.*` instead;
`activeCaptain` is a `$:` reactive derivation off `state.captains[activeCaptainIndex]`, so it
recomputes whenever `state` or `activeCaptainIndex` changes — including after `tickCaptainStack`
fires for that captain (Task 4's loop reassigns `state`, which Svelte's reactivity picks up). The
`GENERATOR STACK` panel's rate calculation now includes `captainMultiplier(activeCaptain)` and
`specializationMultiplier(activeCaptain, m.resource)` alongside the existing fleet `mult`, matching
`tickCaptainStack`'s actual production formula from Task 2 exactly — if these ever drift apart, the
displayed rate would silently lie about actual production; re-check this whenever either formula
changes in the future.

**Step 8: Commit**

```bash
git add src/App.svelte
git commit -m "feat: add captain tabs, scope Resources/Tick/Generator Stack/Research to active captain"
```

---

### Task 6: Captain Prestige panel + specialization picker (`App.svelte`)

**Files:**
- Modify: `src/App.svelte`

**Step 1: Add the `doCaptainPrestige` handler**

Find `doPrestige` (added in an earlier feature, currently just above `grantResource`):

```ts
  function doPrestige() {
    const { next, gained } = prestige(state);
    if (gained <= 0) return;
    state = next;
    pushLog(`Prestige performed. +${gained} Augment Points.`);
    doSave();
  }
```

Leave this exactly as-is (it's being renamed conceptually to "Fleet Prestige" in Task 7's copy, not
its function name — renaming the function itself is unnecessary churn). Add a new function directly
below it:

```ts
  function doCaptainPrestige(spec: SpecializationKey) {
    const { next, gained } = captainPrestige(state, activeCaptain.id, spec);
    if (gained <= 0) return;
    const label = activeCaptain.label;
    state = next;
    pushLog(`[${label}] Captain Prestige performed. +${gained} Captain Points (${SPECIALIZATIONS[spec].label}).`);
    doSave();
  }
```

**Step 2: Add the Captain Prestige panel**

Insert a new `<Panel>` immediately after the `RESEARCH` panel's closing `</Panel>` (added in Task
5) and before the `PRESTIGE — TIER 1` panel:

```svelte
      <Panel>
        <div class="panel-title">CAPTAIN PRESTIGE — TIER 1</div>
        {@const captainGain = Math.floor(Math.sqrt(activeCaptain.lifetimeComponents))}
        <p class="prestige-text">
          Retire {activeCaptain.label}'s current run for Captain Points (√ of THIS captain's lifetime
          components). Resets {activeCaptain.label}'s resources, modules, and research. Choose a
          specialization as part of the reset — picking again later respecs.
        </p>
        <div class="prestige-row">
          <div class="prestige-yield">
            Would yield <strong>{formatNumber(captainGain)}</strong> Captain Points
          </div>
        </div>
        {#if activeCaptain.specialization}
          <div class="spec-current">
            Current specialization: <strong>{SPECIALIZATIONS[activeCaptain.specialization].label}</strong>
            · {formatNumber(activeCaptain.captainPoints)} Captain Points · {activeCaptain.captainPrestigeCount} prestiges
          </div>
        {/if}
        <div class="spec-picker">
          {#each Object.entries(SPECIALIZATIONS) as [key, def]}
            <button
              class="spec-btn"
              disabled={captainGain <= 0}
              style="opacity:{captainGain <= 0 ? 0.4 : 1}"
              on:click={() => doCaptainPrestige(key as SpecializationKey)}
            >
              {def.label}
            </button>
          {/each}
        </div>
      </Panel>
```

**Step 3: Add supporting CSS**

Add to the `<style>` block, near `.prestige-btn`:

```css
  .spec-current { font-size: 11px; color: var(--color-text-secondary); margin: 10px 0; }
  .spec-picker { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
  .spec-btn {
    background: rgba(var(--color-accent-rgb), 0.1);
    border: 1px solid rgba(var(--color-accent-rgb), 0.3);
    border-radius: 8px;
    padding: 8px 12px;
    color: var(--color-accent-bright);
    font-size: 11px;
    cursor: pointer;
  }
  .spec-btn:disabled { cursor: not-allowed; }
```

**Step 4: Manual verification (no automated test — UI markup, Node unavailable)**

Confirm: `captainGain` recomputes reactively per-render off `activeCaptain.lifetimeComponents`
(via the `{@const}`, recalculated on every re-render of this block, which happens whenever
`activeCaptain` changes). Clicking a specialization button calls `doCaptainPrestige(key)`, which
early-returns via `captainPrestige`'s own `gained <= 0` guard if clicked when ineligible (defense in
depth — the `disabled` attribute is the primary guard, matching this project's established
convention of gating at both the UI and function level). Confirm `SpecializationKey` is correctly
imported (added in Task 5's import-list edit).

**Step 5: Commit**

```bash
git add src/App.svelte
git commit -m "feat: add Captain Prestige panel with specialization picker"
```

---

### Task 7: Fleet Prestige panel updates + captain-labeled log entries (`App.svelte`)

**Files:**
- Modify: `src/App.svelte`

**Step 1: Update the Fleet Prestige panel's copy and yield calculation**

Find:

```svelte
      <Panel>
        <div class="panel-title">PRESTIGE — TIER 1</div>
        <p class="prestige-text">
          Retire this run for Augment Points (√ of lifetime components produced). Resources and modules reset;
          Augment Points and the global multiplier persist.
        </p>
        <div class="prestige-row">
          <div class="prestige-yield">
            Would yield <strong>{formatNumber(Math.floor(Math.sqrt(state.lifetimeComponents)))}</strong> Augment Points
          </div>
          <button class="prestige-btn" on:click={doPrestige}>Prestige</button>
        </div>
      </Panel>
```

Replace with:

```svelte
      <Panel>
        <div class="panel-title">FLEET PRESTIGE — TIER 2</div>
        {@const fleetLifetimeComponents = state.captains.reduce((sum, c) => sum + c.lifetimeComponents, 0)}
        <p class="prestige-text">
          Retire the WHOLE FLEET for Augment Points (√ of combined lifetime components across every
          captain). Resets every captain back to the starting roster of 2 — wiping all specializations,
          Captain Points, and individual progress along with resources and modules. Augment Points and
          the global multiplier persist.
        </p>
        <div class="prestige-row">
          <div class="prestige-yield">
            Would yield <strong>{formatNumber(Math.floor(Math.sqrt(fleetLifetimeComponents)))}</strong> Augment Points
          </div>
          <button class="prestige-btn" on:click={doPrestige}>Fleet Prestige</button>
        </div>
      </Panel>
```

**Step 2: Reset `activeCaptainIndex` after a fleet prestige (defensive, even though it can't go
out of bounds today)**

Find `doPrestige`:

```ts
  function doPrestige() {
    const { next, gained } = prestige(state);
    if (gained <= 0) return;
    state = next;
    pushLog(`Prestige performed. +${gained} Augment Points.`);
    doSave();
  }
```

Replace with:

```ts
  function doPrestige() {
    const { next, gained } = prestige(state);
    if (gained <= 0) return;
    state = next;
    activeCaptainIndex = 0; // fleet prestige always yields exactly 2 captains, back to Captain 1's tab
    pushLog(`Fleet Prestige performed. +${gained} Augment Points. Captain roster reset.`);
    doSave();
  }
```

**Step 3: Prefix log entries with the originating captain's label**

The `startResearch` and `grantResource` call sites already got their `pushLog` calls updated with a
`[${captain.label}]`/`[${activeCaptain.label}]` prefix in Task 5. Confirm those are in place, then
find the one remaining un-prefixed captain-scoped log call, `doCaptainPrestige` (added in Task 6) —
confirm it already has `[${label}]`. No further call sites need changes: `doPrestige` (fleet-wide,
correctly has no captain prefix), `simulateOffline` (fleet-wide dev action, correctly has no
captain prefix), the initial `"New save initialized."` and `"Welcome back..."` messages (fleet-wide
by nature), and `"Save reset."` (fleet-wide) all stay unprefixed since none of them are scoped to
one captain.

**Step 4: Manual verification (no automated test — UI markup, Node unavailable)**

Confirm `fleetLifetimeComponents` sums across `state.captains` — matches `prestige()`'s own gate
formula in `tick.ts` exactly (both must agree, or the displayed "would yield" preview would lie
about what clicking the button actually does). Confirm `activeCaptainIndex = 0` after a fleet
prestige can never go out of bounds, since `prestige()` always returns exactly a 2-element
`captains` array (via `freshCaptains()`).

**Step 5: Commit**

```bash
git add src/App.svelte
git commit -m "feat: update Fleet Prestige copy/yield for multi-captain, finalize log prefixing"
```

---

### Task 8: Docs and final commit

**Files:**
- Modify: `SESSION_LOG.md`
- Modify: `KNOWN_ISSUES.md` (only if warranted — see below)

**Step 1: Check `KNOWN_ISSUES.md`**

Read the existing file first to match its tone/format. Consider flagging, if not already obvious
from in-code comments:
- The fixed "Fleet Prestige always collapses back to exactly 2 captains" behavior is a Phase-1-only
  simplification — once Phase 2's skill tree can unlock additional captain slots, Fleet Prestige's
  reset target needs to become "the number of slots earned so far," not a hardcoded 2. Check
  whether `tick.ts`'s `prestige()` already has an inline comment covering this (it references
  `freshCaptains()`, which is hardcoded to 2 today) — if not, this is worth a `KNOWN_ISSUES.md`
  entry, since it's a real gap a future Phase 2 implementer needs to know about, not a hypothetical.
- Whether the 3-specialization set (mining/refining/fabrication) hardcoded in `SPECIALIZATIONS`
  needs a similar forward-looking note for whoever eventually wants a 4th (e.g. a
  synthesis/alloys-focused specialization).

Use judgment — only add entries that would genuinely save a future session from re-discovering a
real gap, per this file's own stated purpose (established practice from the Research feature's
Task 7, which found the analogous gap not yet worth flagging since only one gated pair existed —
here, the situation is a little different since Phase 2 is an explicitly planned next step, not a
hypothetical future one).

**Step 2: Append a session log entry**

Read the existing `SESSION_LOG.md` first to match its established format (check the immediately
preceding "Session 6" entry for tone/structure). Before writing, verify the actual final task/commit
count against `git log` for this branch — this plan has 8 tasks, but real review-driven fixes
often add more; count what genuinely happened, per this session's established practice of
correcting a plan's draft assumptions against real history rather than assuming the plan matched
reality exactly.

Draft text (correct against real history before using):

```markdown

**Session 7** — Began the Captain/Ship feature (Phase 1 of
docs/plans/2026-07-03-captain-ship-design.md), scoped down from the master
design doc's fuller vision (which assumes augments/mission-spoils/parallel
multi-ship operation that don't exist yet): the single implicit production
pool became an array of independent per-captain stacks (`captains:
CaptainState[]`), each with its own resources/modules/research/tick cadence.
`tick()`'s body was extracted into `tickCaptainStack()`, reused in a loop —
the closed-form invariant (one big jump equals many small ticks) now holds
per captain, verified with a captain exercising modules, research, AND a
specialization simultaneously. Added a two-tier prestige system: Captain
Prestige (per captain, grants Captain Points, lets the player pick one of 3
specializations — Mining/Refining/Fabrication, each a flat +25% to its
resource) and an extended Fleet Prestige (gates on combined lifetime
components across every captain, collapses the whole roster back to the
starting 2). Save schema bumped to v5, migrating the old flat shape into
captains[0] with a fresh captains[1] alongside it — tested against a genuine
old-shape save (not just a stripped field) plus the full v1-\>v5 chain, given
this session's own history with an under-tested migration gap causing a real
production bug earlier. The tick-bar loop in App.svelte was rewritten to
track each captain's cycle independently rather than one shared cycle. Next:
get eyes on this in an actual browser — switch between captain tabs, confirm
each captain's stack ticks and produces independently, run both prestige
tiers, confirm the specialization picker actually boosts the right resource,
and confirm a real existing save migrates cleanly to the 2-captain shape with
progress intact. Phase 2 (a fleet-wide skill tree that makes captain-slot
count actually unlockable, replacing today's fixed 2) is a separate,
not-yet-started design.
```

**Step 3: Commit**

```bash
git add SESSION_LOG.md KNOWN_ISSUES.md
git commit -m "docs: log captain/ship Phase 1 session"
```

(Only `git add KNOWN_ISSUES.md` if it was actually changed.)

**Step 4: Do not push.** Same as every other feature this session — pushing to `origin/main`
triggers a live Vercel production redeploy and needs the user's explicit go-ahead first.
