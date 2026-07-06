# Fleet Admiral Skill Tree (Phase 2) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a fleet-wide skill tree (Skill Points earned per Fleet Prestige, a Command branch that
makes captain-slot count a real earned/persistent number instead of a hardcoded 2, and a Research
branch with one buff node), fixing the exact `KNOWN_ISSUES.md` gap flagged when Phase 1 shipped.

**Architecture:** A generic `SkillNodeDef`/`SKILL_TREE` lookup in `model.ts` (branch, cost, linear
prerequisite, a discriminated-union effect) drives everything else. Captain count becomes derived
(`captainSlotCount`) rather than hardcoded; `freshCaptains()` becomes parameterized by count.
`tickCaptainStack` gains a 4th parameter for research-speed buffs, computed once per `tick()` call
the same way `fleetMult` already is. `buySkillNode()` in `tick.ts` is the one new mutation path,
following this codebase's established buy-action shape (validate, deduct, apply effect).

**Tech Stack:** Svelte 5 (existing non-runes style), TypeScript, Vitest. No new dependencies.

**Design doc:** `docs/plans/2026-07-06-skill-tree-design.md` — read this first if anything below is
ambiguous.

**A note on testing:** Node.js/npm is unavailable in this environment (reconfirmed at the top of
every plan this session) — no dev server, no build, no test runner. Tasks 1–3 touch genuinely
testable pure logic and follow this session's established TDD pattern: write the test, manually
trace by hand whether it would pass or fail given the code as written, then implement, then
re-trace. Task 4 is Svelte markup/CSS with no automated test story — manual code review only.

**Risk note:** Tasks 1 and 2 both contain a breaking signature change (`freshCaptains()` gains a
required `count` parameter; `tickCaptainStack()` gains a required 4th parameter). Every existing
call site of both functions must be found and updated — grep for each function name before and
after making the change, not just the call sites this plan happens to mention, since this codebase
has had multiple review-driven fixes land on top of the original Phase 1 implementation and this
plan's author cannot guarantee it has seen the exact latest state of every file.

---

### Task 1: Skill tree data model + `freshCaptains(count)` (`model.ts`)

**Files:**
- Modify: `src/lib/game/model.ts`
- Modify: `src/lib/game/model.test.ts`

**Context:** Read the current `src/lib/game/model.ts` in full before starting — it has had several
rounds of review-driven fixes since Phase 1 shipped (e.g. `freshCaptains()`'s Captain 2 now derives
from `freshCaptainStack()` via spread, not a separate literal; a `fleetLifetimeComponents` helper
was added at final review). Confirm the current signature of `freshCaptains()` (today: no
parameters, always returns exactly 2 captains) before changing it.

**Step 1: Write the failing tests**

Add to `src/lib/game/model.test.ts` (keep every existing `describe` block below the import list —
you will be EDITING several of them, not just adding new ones; see Step 1b):

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
  fleetLifetimeComponents,
  captainSlotCount,
  researchDurationMult,
  SPECIALIZATIONS,
  SKILL_TREE,
} from "./model";
```

(Replace the existing import block at the top of the file with this one — it's the same list plus
`captainSlotCount`, `researchDurationMult`, `SKILL_TREE`.)

**Step 1b: Edit these existing tests** (they currently assume `freshState()` always yields 2
captains, which is changing):

Find:

```ts
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

  it("Captain 2 has id 2, label 'Captain 2', and gets the SAME 1-miner head start as Captain 1", () => {
    // Regression test: Captain 2 previously started with 0 miners, which is
    // an unrecoverable softlock -- every module (including the miner itself)
    // costs ore, and only a miner produces ore, so 0 miners means 0 ore
    // forever, means nothing is ever affordable. Confirmed live in
    // production. Both captains must share the same playable floor.
    const state = freshState();
    const c2 = state.captains[1];
    expect(c2.id).toBe(2);
    expect(c2.label).toBe("Captain 2");
    expect(c2.modules.miner).toBe(1);
    expect(c2.modules.refinery).toBe(0);
    expect(c2.modules.fabricator).toBe(0);
    expect(c2.modules.synthesizer).toBe(0);
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
```

Replace with:

```ts
describe("freshState — captain roster shape", () => {
  it("starts with exactly 1 captain (Command branch is how the roster grows now)", () => {
    const state = freshState();
    expect(state.captains).toHaveLength(1);
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

  it("starts with 0 resources, 0 captainPoints, 0 captainPrestigeCount, null specialization", () => {
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

  it("fleet-wide fields default to 0, including the new skill tree fields", () => {
    const state = freshState();
    expect(state.augmentPoints).toBe(0);
    expect(state.prestigeCount).toBe(0);
    expect(state.gameTimeSeconds).toBe(0);
    expect(state.skillPoints).toBe(0);
    expect(state.unlockedSkillNodes).toEqual([]);
  });
});

describe("freshCaptains(count) — parameterized roster generation", () => {
  it("generates exactly `count` captains with sequential ids/labels, all sharing the 1-miner floor", () => {
    const captains = freshCaptains(3);
    expect(captains).toHaveLength(3);
    expect(captains.map((c) => c.id)).toEqual([1, 2, 3]);
    expect(captains.map((c) => c.label)).toEqual(["Captain 1", "Captain 2", "Captain 3"]);
    for (const c of captains) {
      expect(c.modules.miner).toBe(1); // regression: every captain, however generated, needs this floor
      expect(c.shipType).toBe("resourcer");
      expect(c.captainPoints).toBe(0);
      expect(c.specialization).toBe(null);
    }
  });

  it("generates a single captain when count is 1", () => {
    const captains = freshCaptains(1);
    expect(captains).toHaveLength(1);
    expect(captains[0].id).toBe(1);
    expect(captains[0].label).toBe("Captain 1");
  });
});
```

**Step 1c: Add new tests** for the skill tree data itself (append after the existing
`SPECIALIZATIONS — launch set` describe block):

```ts
describe("SKILL_TREE — launch set", () => {
  it("has 3 Command ranks with a linear prerequisite chain and increasing cost", () => {
    expect(SKILL_TREE.commandRank1.branch).toBe("command");
    expect(SKILL_TREE.commandRank1.requires).toBe(null);
    expect(SKILL_TREE.commandRank1.costSkillPoints).toBe(1);
    expect(SKILL_TREE.commandRank1.effect).toEqual({ type: "unlockCaptainSlot" });

    expect(SKILL_TREE.commandRank2.requires).toBe("commandRank1");
    expect(SKILL_TREE.commandRank2.costSkillPoints).toBe(2);

    expect(SKILL_TREE.commandRank3.requires).toBe("commandRank2");
    expect(SKILL_TREE.commandRank3.costSkillPoints).toBe(3);
  });

  it("has 1 Research node reducing Alloy Synthesis duration by 25%, no prerequisite", () => {
    expect(SKILL_TREE.researchAlloySynthesisSpeed.branch).toBe("research");
    expect(SKILL_TREE.researchAlloySynthesisSpeed.requires).toBe(null);
    expect(SKILL_TREE.researchAlloySynthesisSpeed.costSkillPoints).toBe(1);
    expect(SKILL_TREE.researchAlloySynthesisSpeed.effect).toEqual({
      type: "researchSpeedMult",
      researchKey: "alloySynthesis",
      mult: 0.75,
    });
  });
});

describe("captainSlotCount", () => {
  it("is 1 with no unlocked Command nodes", () => {
    const state = freshState();
    expect(captainSlotCount(state)).toBe(1);
  });

  it("is 1 + N with N unlocked Command nodes", () => {
    const state = freshState();
    state.unlockedSkillNodes = ["commandRank1", "commandRank2"];
    expect(captainSlotCount(state)).toBe(3);
  });

  it("does not count the Research node toward slot count", () => {
    const state = freshState();
    state.unlockedSkillNodes = ["commandRank1", "researchAlloySynthesisSpeed"];
    expect(captainSlotCount(state)).toBe(2);
  });
});

describe("researchDurationMult", () => {
  it("is 1 for a research project with no matching unlocked node", () => {
    const state = freshState();
    expect(researchDurationMult(state, "alloySynthesis")).toBe(1);
  });

  it("is the node's mult once unlocked", () => {
    const state = freshState();
    state.unlockedSkillNodes = ["researchAlloySynthesisSpeed"];
    expect(researchDurationMult(state, "alloySynthesis")).toBeCloseTo(0.75, 6);
  });
});
```

**Step 2: Confirm the tests would fail**

`SKILL_TREE`, `captainSlotCount`, `researchDurationMult` don't exist yet; `freshCaptains()` doesn't
take a parameter yet; `freshState()` returns 2 captains, not 1; `GameState` has no `skillPoints`/
`unlockedSkillNodes`. Confirm by inspection this file would not type-check against the current
`model.ts`.

**Step 3: Write the implementation**

In `src/lib/game/model.ts`:

1. Add these types/data, placed after the existing `SPECIALIZATIONS` block and before
   `CaptainState`:

```ts
export type SkillBranchKey = "command" | "research";

export type SkillNodeKey = "commandRank1" | "commandRank2" | "commandRank3" | "researchAlloySynthesisSpeed";

export type SkillNodeEffect =
  | { type: "unlockCaptainSlot" }
  | { type: "researchSpeedMult"; researchKey: ResearchKey; mult: number };

export interface SkillNodeDef {
  branch: SkillBranchKey;
  label: string;
  costSkillPoints: number;
  requires: SkillNodeKey | null; // prerequisite node in the SAME branch; null means no prerequisite
  effect: SkillNodeEffect;
}

// 3 Command ranks (unlock captain slots 2/3/4, increasing cost) + 1 Research
// node (a one-time Alloy Synthesis speed buff). Add a new entry here (and
// nowhere else -- App.svelte's panel iterates this object grouped by
// `branch`) if a new node is ever wanted; SKILL_TREE.test.ts's "launch set"
// tests will need updating to match whatever the new set looks like.
export const SKILL_TREE: Record<SkillNodeKey, SkillNodeDef> = {
  commandRank1: {
    branch: "command",
    label: "Recruit Captain (2nd slot)",
    costSkillPoints: 1,
    requires: null,
    effect: { type: "unlockCaptainSlot" },
  },
  commandRank2: {
    branch: "command",
    label: "Recruit Captain (3rd slot)",
    costSkillPoints: 2,
    requires: "commandRank1",
    effect: { type: "unlockCaptainSlot" },
  },
  commandRank3: {
    branch: "command",
    label: "Recruit Captain (4th slot)",
    costSkillPoints: 3,
    requires: "commandRank2",
    effect: { type: "unlockCaptainSlot" },
  },
  researchAlloySynthesisSpeed: {
    branch: "research",
    label: "Synthesis Efficiency",
    costSkillPoints: 1,
    requires: null,
    effect: { type: "researchSpeedMult", researchKey: "alloySynthesis", mult: 0.75 },
  },
};
```

2. Add `skillPoints`/`unlockedSkillNodes` to `GameState`:

Find:

```ts
export interface GameState {
  captains: CaptainState[];
  augmentPoints: number; // fleet-wide, from Fleet Prestige
  prestigeCount: number; // fleet-wide Fleet Prestige count
  gameTimeSeconds: number; // accumulated in-game seconds, fleet-wide, per tech spec §1
}
```

Replace with:

```ts
export interface GameState {
  captains: CaptainState[];
  augmentPoints: number; // fleet-wide, from Fleet Prestige
  prestigeCount: number; // fleet-wide Fleet Prestige count
  gameTimeSeconds: number; // accumulated in-game seconds, fleet-wide, per tech spec §1
  skillPoints: number; // unspent, fleet-wide -- earned 1 per Fleet Prestige, never reset by it
  unlockedSkillNodes: SkillNodeKey[]; // fleet-wide, persistent, never reset by Fleet Prestige
}
```

3. Replace `freshCaptains()` with a parameterized version, and update `freshState()`:

Find:

```ts
// The starting 2-captain roster for both a brand-new save (freshState) and a
// post-Fleet-Prestige reset. Both captains get the SAME shared reset baseline
// (1 free miner) -- an earlier version of this function deliberately zeroed
// out Captain 2's modules to make a "never played" slot feel distinct from a
// "just reset" one, but that was a genuine softlock: every module (including
// the miner itself) costs ore to buy, and ore is only ever produced BY a
// miner, so a captain starting at 0 miners has no possible path to ever
// afford anything, forever. Confirmed live in production (a user reported
// Captain 2 "never improves"). There is no other resource-free entry point
// into this game's economy, so 1 free miner is the floor every captain needs
// to be playable at all -- not just a nice-to-have head start.
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
      // Sharing freshCaptainStack() here (instead of a fully separate
      // hand-written literal) means any new CaptainState field added to that
      // helper is guaranteed identical for both captains, rather than relying
      // on two literals staying in sync by hand.
      ...freshCaptainStack(),
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
```

Replace with:

```ts
// Generates `count` captains (ids 1..count) sharing the same reset baseline
// (1 free miner) -- see the softlock regression note on freshCaptainStack()
// above. Used for: a brand-new save (freshState calls freshCaptains(1) --
// Phase 2's Command branch is now how the roster grows past 1), a
// post-Fleet-Prestige reset (freshCaptains(captainSlotCount(state)) in
// tick.ts, so earned slot count survives the reset), and save migration
// (backfilling a never-played slot at the real v4->v5 migration's shape).
export function freshCaptains(count: number): CaptainState[] {
  const captains: CaptainState[] = [];
  for (let i = 1; i <= count; i++) {
    captains.push({
      id: i,
      label: `Captain ${i}`,
      shipType: "resourcer",
      ...freshCaptainStack(),
      captainPoints: 0,
      captainPrestigeCount: 0,
      specialization: null,
    });
  }
  return captains;
}

export function freshState(): GameState {
  return {
    captains: freshCaptains(1),
    augmentPoints: 0,
    prestigeCount: 0,
    gameTimeSeconds: 0,
    skillPoints: 0,
    unlockedSkillNodes: [],
  };
}
```

4. Add `captainSlotCount` and `researchDurationMult`, placed after `fleetLifetimeComponents`:

```ts
// 1 (the floor every save starts with) + however many "unlockCaptainSlot"
// Command nodes have been bought. This is what BOTH a mid-game slot
// purchase (tick.ts's buySkillNode) and a Fleet Prestige reset
// (tick.ts's prestige, via freshCaptains(captainSlotCount(state))) treat as
// "how many captains should exist" -- fixes the Phase-1 gap where Fleet
// Prestige always collapsed the roster back to a hardcoded 2 regardless of
// what had actually been earned.
export function captainSlotCount(state: GameState): number {
  return (
    1 +
    state.unlockedSkillNodes.filter((key) => SKILL_TREE[key].effect.type === "unlockCaptainSlot").length
  );
}

// Product of every unlocked researchSpeedMult node's mult targeting this
// researchKey (1 if none apply). Fleet-wide, computed once per tick() call
// (see tick.ts) and applied identically to every captain's copy of that
// research project, same "compute once, apply everywhere" shape as
// globalMultiplier.
export function researchDurationMult(state: GameState, researchKey: ResourceKey extends never ? ResearchKey : ResearchKey): number {
  let mult = 1;
  for (const nodeKey of state.unlockedSkillNodes) {
    const effect = SKILL_TREE[nodeKey].effect;
    if (effect.type === "researchSpeedMult" && effect.researchKey === researchKey) {
      mult *= effect.mult;
    }
  }
  return mult;
}
```

(The `ResourceKey extends never ? ResearchKey : ResearchKey` in the signature above is a typo to
delete -- the real signature is simply `researchDurationMult(state: GameState, researchKey:
ResearchKey): number`. Use the corrected signature below, not the one just shown.)

Corrected:

```ts
export function researchDurationMult(state: GameState, researchKey: ResearchKey): number {
  let mult = 1;
  for (const nodeKey of state.unlockedSkillNodes) {
    const effect = SKILL_TREE[nodeKey].effect;
    if (effect.type === "researchSpeedMult" && effect.researchKey === researchKey) {
      mult *= effect.mult;
    }
  }
  return mult;
}
```

**Step 4: Audit every OTHER call site of `freshCaptains` before moving on**

Run a search for `freshCaptains(` across the whole `src/` tree. At this point in the plan, only
`model.ts` itself has been changed; `tick.ts` (`prestige()`) and `save.ts` (`MIGRATIONS[4]`) both
still call the OLD zero-argument form and will now fail to type-check. **Do not fix those files
here** — Tasks 2 and 3 own them respectively. Just confirm you've found every call site so nothing
is missed later: expect to find one in `model.ts` itself (`freshState`), one in `tick.ts`
(`prestige`), and one in `save.ts` (`MIGRATIONS[4]`, via `const fresh = freshCaptains();`).

**Step 5: Confirm the tests would pass**

Manually trace the key new/changed tests:
- `freshState().captains` has length 1 — `freshCaptains(1)` loops `i` from 1 to 1 inclusive, pushing
  exactly one captain. ✓
- `freshCaptains(3)` — loop pushes `i=1,2,3`, each `{id:i, label:\`Captain ${i}\`, ...}`, giving ids
  `[1,2,3]` and labels `["Captain 1","Captain 2","Captain 3"]`. ✓
- `captainSlotCount` with `unlockedSkillNodes: ["commandRank1","commandRank2"]` — both have
  `effect.type === "unlockCaptainSlot"` per `SKILL_TREE`, filter length 2, `1+2=3`. ✓ With
  `["commandRank1","researchAlloySynthesisSpeed"]` — only `commandRank1` matches the filter, length
  1, `1+1=2`. ✓
- `researchDurationMult(state, "alloySynthesis")` with `unlockedSkillNodes:
  ["researchAlloySynthesisSpeed"]` — that node's effect is `{type:"researchSpeedMult",
  researchKey:"alloySynthesis", mult:0.75}`, matches, `mult *= 0.75` → `0.75`. ✓ With no unlocked
  nodes, loop never executes, returns the initial `1`. ✓

**Step 6: Commit**

```bash
git add src/lib/game/model.ts src/lib/game/model.test.ts
git commit -m "feat: add skill tree data model, parameterize freshCaptains by count"
```

---

### Task 2: `tickCaptainStack` research-speed param, `buySkillNode`, Fleet Prestige uses earned slot count (`tick.ts`)

**Files:**
- Modify: `src/lib/game/tick.ts`
- Modify: `src/lib/game/tick.test.ts`

**Context:** Read the current `src/lib/game/tick.ts` in full — Task 1 already changed
`freshCaptains()`'s signature, so this file currently fails to type-check (`prestige()` calls
`freshCaptains()` with no arguments). Fixing that call site is part of this task.

**Step 1: Write the failing tests**

Replace the entire contents of `src/lib/game/tick.test.ts` with:

```ts
import { describe, it, expect } from "vitest";
import { tick, tickCaptainStack, prestige, captainPrestige, buySkillNode } from "./tick";
import { freshState, freshCaptains } from "./model";

const NO_RESEARCH_BUFFS = { alloySynthesis: 1 };

describe("tickCaptainStack — closed-form requirement (single captain)", () => {
  it("one big jump equals many small ticks, with modules, research, a specialization, AND a research-speed buff all active", () => {
    const base = freshCaptains(1)[0];
    base.modules.miner = 5;
    base.modules.refinery = 2;
    base.modules.fabricator = 1;
    base.research.alloySynthesis.started = true;
    base.captainPoints = 3;
    base.specialization = "mining";

    const fleetMult = 1.4;
    const researchMults = { alloySynthesis: 0.75 }; // exercises the 4th multiplier alongside the other 3

    const bigJump = tickCaptainStack(3600, base, fleetMult, researchMults);

    let stepped = base;
    for (let i = 0; i < 36000; i++) {
      stepped = tickCaptainStack(0.1, stepped, fleetMult, researchMults);
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
    const base = freshCaptains(1)[0];
    base.modules.miner = 3;
    const result = tickCaptainStack(0, base, 1, NO_RESEARCH_BUFFS);
    expect(result).toBe(base);
  });

  it("specialization gives a +25% boost only to its matching resource", () => {
    const base = freshCaptains(1)[0];
    base.modules.miner = 1;
    base.modules.refinery = 1;

    const unspecialized = tickCaptainStack(10, { ...base, specialization: null }, 1, NO_RESEARCH_BUFFS);
    const specialized = tickCaptainStack(10, { ...base, specialization: "mining" }, 1, NO_RESEARCH_BUFFS);

    expect(specialized.resources.ore).toBeCloseTo(unspecialized.resources.ore * 1.25, 6);
    expect(specialized.resources.ingots).toBeCloseTo(unspecialized.resources.ingots, 6);
  });

  it("captainPoints scale that captain's production the same way augmentPoints scale the fleet", () => {
    const base = freshCaptains(1)[0];
    base.modules.miner = 1;

    const noPoints = tickCaptainStack(10, { ...base, captainPoints: 0 }, 1, NO_RESEARCH_BUFFS);
    const withPoints = tickCaptainStack(10, { ...base, captainPoints: 10 }, 1, NO_RESEARCH_BUFFS);

    expect(withPoints.resources.ore).toBeCloseTo(noPoints.resources.ore * 2, 6);
  });

  it("advances progressSeconds for a started, incomplete project", () => {
    const base = freshCaptains(1)[0];
    base.research.alloySynthesis.started = true;

    const result = tickCaptainStack(90, base, 1, NO_RESEARCH_BUFFS);
    expect(result.research.alloySynthesis.progressSeconds).toBe(90);
    expect(result.research.alloySynthesis.completed).toBe(false);
  });

  it("completes exactly at the project's duration", () => {
    const base = freshCaptains(1)[0];
    base.research.alloySynthesis.started = true;

    const result = tickCaptainStack(180, base, 1, NO_RESEARCH_BUFFS);
    expect(result.research.alloySynthesis.progressSeconds).toBe(180);
    expect(result.research.alloySynthesis.completed).toBe(true);
  });

  it("caps progressSeconds at duration, never overshoots", () => {
    const base = freshCaptains(1)[0];
    base.research.alloySynthesis.started = true;

    const result = tickCaptainStack(500, base, 1, NO_RESEARCH_BUFFS);
    expect(result.research.alloySynthesis.progressSeconds).toBe(180);
    expect(result.research.alloySynthesis.completed).toBe(true);
  });

  it("never advances an unstarted project", () => {
    const base = freshCaptains(1)[0];
    const result = tickCaptainStack(1000, base, 1, NO_RESEARCH_BUFFS);
    expect(result.research.alloySynthesis.progressSeconds).toBe(0);
    expect(result.research.alloySynthesis.completed).toBe(false);
  });

  it("a research-speed buff shortens the effective duration (completes sooner, at the scaled duration)", () => {
    const base = freshCaptains(1)[0];
    base.research.alloySynthesis.started = true;

    // 180s * 0.75 = 135s effective duration
    const result = tickCaptainStack(135, base, 1, { alloySynthesis: 0.75 });
    expect(result.research.alloySynthesis.progressSeconds).toBe(135);
    expect(result.research.alloySynthesis.completed).toBe(true);
  });

  it("with no buff (mult 1), duration is unchanged from the base 180s", () => {
    const base = freshCaptains(1)[0];
    base.research.alloySynthesis.started = true;

    const result = tickCaptainStack(135, base, 1, NO_RESEARCH_BUFFS);
    expect(result.research.alloySynthesis.progressSeconds).toBe(135);
    expect(result.research.alloySynthesis.completed).toBe(false); // 135 < 180, not done yet
  });
});

describe("tick — loops tickCaptainStack over every captain, advances fleet gameTimeSeconds once", () => {
  it("applies the same deltaSeconds to every captain independently", () => {
    const state = freshState();
    state.captains = freshCaptains(2);
    state.captains[0].modules.miner = 2;
    state.captains[1].modules.miner = 5;

    const result = tick(10, state);

    expect(result.captains[0].resources.ore).toBeCloseTo(2 * 10, 6);
    expect(result.captains[1].resources.ore).toBeCloseTo(5 * 10, 6);
  });

  it("advances fleet-wide gameTimeSeconds by deltaSeconds exactly once (not once per captain)", () => {
    const state = freshState();
    state.captains = freshCaptains(2);
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
    state.captains = freshCaptains(2);
    state.captains[0].modules.miner = 1;
    state.captains[1].modules.miner = 1;
    state.augmentPoints = 10;

    const result = tick(10, state);
    expect(result.captains[0].resources.ore).toBeCloseTo(1 * 10 * 2, 6);
    expect(result.captains[1].resources.ore).toBeCloseTo(1 * 10 * 2, 6);
  });

  it("applies an unlocked research-speed node's buff to every captain's matching research", () => {
    const state = freshState();
    state.unlockedSkillNodes = ["researchAlloySynthesisSpeed"];
    state.captains[0].research.alloySynthesis.started = true;

    const result = tick(135, state); // 180 * 0.75 = 135
    expect(result.captains[0].research.alloySynthesis.completed).toBe(true);
  });
});

describe("captainPrestige — per-captain reset (unaffected by this task, re-verify no regression)", () => {
  it("resets only the target captain's stack, leaves other captains untouched", () => {
    const state = freshState();
    state.captains = freshCaptains(2);
    state.captains[0].lifetimeComponents = 100;
    state.captains[0].modules.miner = 50;
    state.captains[1].modules.miner = 7;

    const { next, gained } = captainPrestige(state, 1, "mining");
    expect(gained).toBe(10);
    expect(next.captains[0].modules.miner).toBe(1);
    expect(next.captains[1].modules.miner).toBe(7);
  });

  it("does nothing if gained <= 0", () => {
    const state = freshState();
    const { next, gained } = captainPrestige(state, 1, "mining");
    expect(gained).toBe(0);
    expect(next).toBe(state);
  });
});

describe("prestige — fleet-wide reset now uses earned slot count, grants a Skill Point", () => {
  it("gates on the SUM of lifetimeComponents across all captains", () => {
    const state = freshState();
    state.captains = freshCaptains(2);
    state.captains[0].lifetimeComponents = 36;
    state.captains[1].lifetimeComponents = 64;

    const { gained } = prestige(state);
    expect(gained).toBe(10);
  });

  it("rebuilds the roster at captainSlotCount(state), NOT a hardcoded 2", () => {
    const state = freshState();
    state.unlockedSkillNodes = ["commandRank1", "commandRank2"]; // slot count = 3
    state.captains = freshCaptains(3);
    state.captains[0].lifetimeComponents = 100;
    state.captains[1].modules.miner = 42;
    state.captains[2].modules.miner = 99;

    const { next } = prestige(state);
    expect(next.captains).toHaveLength(3); // NOT 2 -- this is the KNOWN_ISSUES.md fix
    for (const c of next.captains) {
      expect(c.modules.miner).toBe(1); // all reset to the shared floor
    }
  });

  it("grants +1 skillPoints and does NOT reset unlockedSkillNodes/skillPoints", () => {
    const state = freshState();
    state.captains[0].lifetimeComponents = 100;
    state.skillPoints = 2;
    state.unlockedSkillNodes = ["commandRank1"];

    const { next } = prestige(state);
    expect(next.skillPoints).toBe(3); // 2 + 1 earned
    expect(next.unlockedSkillNodes).toEqual(["commandRank1"]); // survives, unlike captain stacks
  });

  it("does nothing if gained <= 0 (skillPoints/unlockedSkillNodes untouched, same object returned)", () => {
    const state = freshState();
    state.skillPoints = 5;
    const { next, gained } = prestige(state);
    expect(gained).toBe(0);
    expect(next).toBe(state);
  });
});

describe("buySkillNode", () => {
  it("buys a node with no prerequisite, deducts cost, unlocks it", () => {
    const state = freshState();
    state.skillPoints = 1;

    const { next, success } = buySkillNode(state, "researchAlloySynthesisSpeed");
    expect(success).toBe(true);
    expect(next.skillPoints).toBe(0);
    expect(next.unlockedSkillNodes).toEqual(["researchAlloySynthesisSpeed"]);
  });

  it("buying a Command node appends exactly one new captain, seeded with the 1-free-miner floor", () => {
    const state = freshState(); // 1 captain
    state.skillPoints = 1;

    const { next, success } = buySkillNode(state, "commandRank1");
    expect(success).toBe(true);
    expect(next.captains).toHaveLength(2);
    expect(next.captains[1].id).toBe(2);
    expect(next.captains[1].label).toBe("Captain 2");
    expect(next.captains[1].modules.miner).toBe(1); // never a repeat of the softlock
  });

  it("fails if the node's prerequisite is not yet unlocked", () => {
    const state = freshState();
    state.skillPoints = 10; // plenty of points, but no prerequisite

    const { next, success } = buySkillNode(state, "commandRank2");
    expect(success).toBe(false);
    expect(next).toBe(state);
  });

  it("succeeds for rank 2 once rank 1 is already unlocked", () => {
    const state = freshState();
    state.skillPoints = 2;
    state.unlockedSkillNodes = ["commandRank1"];
    state.captains = freshCaptains(2); // roster already reflects rank 1

    const { next, success } = buySkillNode(state, "commandRank2");
    expect(success).toBe(true);
    expect(next.captains).toHaveLength(3);
    expect(next.unlockedSkillNodes).toEqual(["commandRank1", "commandRank2"]);
  });

  it("fails if not enough skillPoints", () => {
    const state = freshState();
    state.skillPoints = 0;

    const { next, success } = buySkillNode(state, "researchAlloySynthesisSpeed");
    expect(success).toBe(false);
    expect(next).toBe(state);
  });

  it("fails if the node is already unlocked (no double-purchase)", () => {
    const state = freshState();
    state.skillPoints = 5;
    state.unlockedSkillNodes = ["researchAlloySynthesisSpeed"];

    const { next, success } = buySkillNode(state, "researchAlloySynthesisSpeed");
    expect(success).toBe(false);
    expect(next).toBe(state);
  });
});
```

**Step 2: Confirm the tests would fail**

`tickCaptainStack` currently takes 3 params, not 4; `buySkillNode` doesn't exist; `prestige()` still
calls the old zero-arg `freshCaptains()` and doesn't touch `skillPoints`. Confirm by inspection.

**Step 3: Write the implementation**

Replace the entire contents of `src/lib/game/tick.ts` with:

```ts
// Tick loop — tech spec §2 (Tick Loop and Time Semantics), extended for
// Phase 1 (per-captain stacks) and Phase 2 (skill tree) of the captain/ship
// feature. See docs/plans/2026-07-06-skill-tree-design.md for Phase 2.
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
  fleetLifetimeComponents,
  captainSlotCount,
  researchDurationMult,
  RESEARCH_PROJECTS,
  SKILL_TREE,
  type GameState,
  type CaptainState,
  type SpecializationKey,
  type ResearchKey,
  type SkillNodeKey,
} from "./model";

export function tickCaptainStack(
  deltaSeconds: number,
  captain: CaptainState,
  fleetMult: number,
  researchDurationMults: Record<ResearchKey, number>
): CaptainState {
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

  // Research progress -- duration is now scaled by researchDurationMults[key]
  // (1 if no skill-tree node targets this project), computed once fleet-wide
  // by tick() below and passed in here, same "compute once, apply everywhere"
  // pattern as fleetMult.
  const research = { ...captain.research };
  for (const key of Object.keys(RESEARCH_PROJECTS) as (keyof typeof RESEARCH_PROJECTS)[]) {
    const project = research[key];
    if (project.started && !project.completed) {
      const duration = RESEARCH_PROJECTS[key].durationSeconds * (researchDurationMults[key] ?? 1);
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
  const researchDurationMults = {} as Record<ResearchKey, number>;
  for (const key of Object.keys(RESEARCH_PROJECTS) as ResearchKey[]) {
    researchDurationMults[key] = researchDurationMult(state, key);
  }

  const captains = state.captains.map((captain) =>
    tickCaptainStack(deltaSeconds, captain, fleetMult, researchDurationMults)
  );

  return {
    ...state,
    captains,
    gameTimeSeconds: state.gameTimeSeconds + deltaSeconds,
  };
}

// Per-captain prestige ("Tier 1, captain scope") -- UNCHANGED by Phase 2.
export function captainPrestige(
  state: GameState,
  captainId: number,
  chosenSpec: SpecializationKey
): { next: GameState; gained: number } {
  const idx = state.captains.findIndex((c) => c.id === captainId);
  if (idx === -1) return { next: state, gained: 0 };
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
// lifetimeComponents across every captain. On success: grants fleet-wide
// augmentPoints (unchanged formula) AND +1 skillPoints (Phase 2 -- Skill
// Points are earned per Fleet Prestige only, not Captain Prestige), and
// rebuilds the ENTIRE captains array at captainSlotCount(state) captains
// (Phase 2 fix -- previously always exactly 2, regardless of how many slots
// had actually been unlocked; see KNOWN_ISSUES.md). skillPoints and
// unlockedSkillNodes are fleet-wide persistent progression, same tier as
// augmentPoints -- neither is reset here, only earned/spent elsewhere.
export function prestige(state: GameState): { next: GameState; gained: number } {
  const gained = Math.floor(Math.sqrt(fleetLifetimeComponents(state)));
  if (gained <= 0) return { next: state, gained: 0 };

  const next: GameState = {
    captains: freshCaptains(captainSlotCount(state)),
    augmentPoints: state.augmentPoints + gained,
    prestigeCount: state.prestigeCount + 1,
    gameTimeSeconds: state.gameTimeSeconds,
    skillPoints: state.skillPoints + 1,
    unlockedSkillNodes: state.unlockedSkillNodes,
  };
  return { next, gained };
}

// Buys one skill tree node. Validates (in order): node isn't already
// unlocked, its prerequisite (if any) IS already unlocked, and enough
// skillPoints are on hand -- returns { next: state, success: false } (the
// SAME state reference, unchanged) if any check fails, mirroring this
// codebase's established buy-action shape (buyModule/startResearch in
// App.svelte). On success: deducts cost, records the node as unlocked, and
// -- ONLY for an "unlockCaptainSlot" effect -- appends exactly one new
// captain (via the shared freshCaptainStack() baseline, never a repeat of
// the Captain-2 softlock) at the next sequential id.
export function buySkillNode(state: GameState, nodeKey: SkillNodeKey): { next: GameState; success: boolean } {
  const node = SKILL_TREE[nodeKey];
  if (state.unlockedSkillNodes.includes(nodeKey)) return { next: state, success: false };
  if (node.requires && !state.unlockedSkillNodes.includes(node.requires)) return { next: state, success: false };
  if (state.skillPoints < node.costSkillPoints) return { next: state, success: false };

  let captains = state.captains;
  if (node.effect.type === "unlockCaptainSlot") {
    const nextId = captains.length + 1;
    captains = [
      ...captains,
      {
        id: nextId,
        label: `Captain ${nextId}`,
        shipType: "resourcer",
        ...freshCaptainStack(),
        captainPoints: 0,
        captainPrestigeCount: 0,
        specialization: null,
      },
    ];
  }

  return {
    next: {
      ...state,
      captains,
      skillPoints: state.skillPoints - node.costSkillPoints,
      unlockedSkillNodes: [...state.unlockedSkillNodes, nodeKey],
    },
    success: true,
  };
}
```

**Step 4: Audit every call site of `tickCaptainStack`**

Search for `tickCaptainStack(` across the whole `src/` tree. At this point, `tick.ts` (`tick()`,
just fixed above) is correct, but `src/App.svelte`'s live tick-bar loop (`onMount`'s `setInterval`
body) still calls the OLD 3-argument form directly (it doesn't go through `tick()` for its per-cycle
firing — it calls `tickCaptainStack` itself with a per-captain delta). **Do not fix App.svelte
here** — that's Task 4. Just confirm you've found this call site so it isn't missed later.

**Step 5: Confirm the tests would pass**

Manually trace the higher-risk new tests:
- Closed-form test with a research buff: `researchMults = {alloySynthesis: 0.75}` is a fixed input
  to every `tickCaptainStack` call, never derived from `deltaSeconds` or accumulated state -- so it
  behaves exactly like `fleetMult`/`capMult`/`specMult` for the closed-form proof: distributing a
  constant factor over a sum of small deltas equals applying it once to the big delta. ✓
- `buySkillNode(state, "commandRank1")` on a 1-captain `freshState()`: `unlockedSkillNodes` doesn't
  include `"commandRank1"`, `requires` is `null` (no check needed), `skillPoints (1) >=
  costSkillPoints (1)` — passes. `node.effect.type === "unlockCaptainSlot"` → `nextId = 1+1 = 2`,
  appends `{id:2, label:"Captain 2", ...freshCaptainStack()}` (miner:1). Returns
  `skillPoints: 1-1=0`, `unlockedSkillNodes: ["commandRank1"]`, `captains` length 2. ✓
- `prestige()` rebuilding at `captainSlotCount(state)`: with
  `unlockedSkillNodes:["commandRank1","commandRank2"]`, `captainSlotCount` returns `1+2=3` (per
  Task 1's own trace), so `freshCaptains(3)` produces exactly 3 captains, all with `modules.miner:1`
  via the shared baseline. ✓ `skillPoints: state.skillPoints + 1` and `unlockedSkillNodes:
  state.unlockedSkillNodes` (the SAME array reference, not reset) confirm the "survives Fleet
  Prestige" requirement. ✓

**Step 6: Commit**

```bash
git add src/lib/game/tick.ts src/lib/game/tick.test.ts
git commit -m "feat: add buySkillNode, research-speed buff plumbing, Fleet Prestige uses earned slot count"
```

---

### Task 3: Save migration v6 → v7 (`save.ts`)

**Files:**
- Modify: `src/lib/game/save.ts`
- Modify: `src/lib/game/save.test.ts`

**Context:** Read the current `src/lib/game/save.ts` in full, including its extensive migration
history comments (two real production incidents already happened on this exact file — take this
seriously). `MIGRATIONS[4]` currently calls `freshCaptains()` with no arguments; Task 1 changed that
signature, so this file currently fails to type-check. Fixing that call site (with the correct new
argument) is part of this task, alongside the new `MIGRATIONS[6]` entry.

**Step 1: Fix the now-broken `MIGRATIONS[4]` call site**

Find, inside `MIGRATIONS[4]`:

```ts
    const fresh = freshCaptains();
```

Replace with:

```ts
    const fresh = freshCaptains(2); // a v4 save is, by construction, always exactly the 2-captain Phase-1 shape
```

**Step 2: Write the failing tests**

Add to `src/lib/game/save.test.ts` (keep every existing `describe` block untouched, add these new
ones, and update the three `"current SAVE_VERSION is 6"` assertions -- see Step 2b):

```ts
describe("migrate — skill tree backfill (v6 -> v7)", () => {
  it("grandfathers an existing v6 save's 2nd captain as if commandRank1 were already bought", () => {
    // A genuine v6 save: 2 captains (Phase 1's fixed starting count), no
    // skill tree fields at all. Hand-written literal -- freshState() no
    // longer produces this shape (it now starts at 1 captain, post this
    // same feature), so it can't stand in for a real legacy save here.
    const legacyState: any = {
      augmentPoints: 10,
      prestigeCount: 1,
      gameTimeSeconds: 500,
      captains: [
        {
          id: 1,
          label: "Captain 1",
          shipType: "resourcer",
          resources: { ore: 100, ingots: 0, components: 0, alloys: 0 },
          modules: { miner: 5, refinery: 0, fabricator: 0, synthesizer: 0 },
          research: { alloySynthesis: { started: false, progressSeconds: 0, completed: false } },
          lifetimeComponents: 20,
          tickDurationSeconds: 10,
          captainPoints: 0,
          captainPrestigeCount: 0,
          specialization: null,
        },
        {
          id: 2,
          label: "Captain 2",
          shipType: "resourcer",
          resources: { ore: 0, ingots: 0, components: 0, alloys: 0 },
          modules: { miner: 1, refinery: 0, fabricator: 0, synthesizer: 0 },
          research: { alloySynthesis: { started: false, progressSeconds: 0, completed: false } },
          lifetimeComponents: 0,
          tickDurationSeconds: 10,
          captainPoints: 0,
          captainPrestigeCount: 0,
          specialization: null,
        },
      ],
    };

    const save: SaveFile = {
      version: 6,
      created_at: 0,
      last_saved_at: 0,
      game_time_seconds: 500,
      state: legacyState,
    };

    const migrated: any = migrate(save);
    expect(migrated.unlockedSkillNodes).toEqual(["commandRank1"]);
    expect(migrated.skillPoints).toBe(0); // no bonus grant, just "don't lose what you already have"
    expect(migrated.captains).toHaveLength(2); // unchanged roster, nothing deleted
    expect(migrated.captains[0].modules.miner).toBe(5); // existing progress untouched
    expect(migrated.captains[1].id).toBe(2);
  });

  it("does not grandfather commandRank1 for a genuine single-captain v6 save", () => {
    const legacyState: any = {
      augmentPoints: 0,
      prestigeCount: 0,
      gameTimeSeconds: 0,
      captains: [
        {
          id: 1,
          label: "Captain 1",
          shipType: "resourcer",
          resources: { ore: 0, ingots: 0, components: 0, alloys: 0 },
          modules: { miner: 1, refinery: 0, fabricator: 0, synthesizer: 0 },
          research: { alloySynthesis: { started: false, progressSeconds: 0, completed: false } },
          lifetimeComponents: 0,
          tickDurationSeconds: 10,
          captainPoints: 0,
          captainPrestigeCount: 0,
          specialization: null,
        },
      ],
    };

    const save: SaveFile = {
      version: 6,
      created_at: 0,
      last_saved_at: 0,
      game_time_seconds: 0,
      state: legacyState,
    };

    const migrated: any = migrate(save);
    expect(migrated.unlockedSkillNodes).toEqual([]);
    expect(migrated.skillPoints).toBe(0);
  });

  it("current SAVE_VERSION is 7", () => {
    expect(SAVE_VERSION).toBe(7);
  });
});

describe("migrate — chained v1 -> v7 migration", () => {
  it("backfills every field across all six migration steps on a genuine v1 save missing all of them", () => {
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
    expect(migrated.captains).toHaveLength(2); // v4->v5's fresh[1], per Step 1's fix above
    expect(migrated.captains[0].tickDurationSeconds).toBe(10);
    expect(migrated.captains[0].research.alloySynthesis).toEqual({
      started: false,
      progressSeconds: 0,
      completed: false,
    });
    expect(migrated.captains[0].modules.synthesizer).toBe(0);
    expect(migrated.captains[0].resources.alloys).toBe(0);
    expect(migrated.captains[0].modules.miner).toBe(1);
    expect(migrated.captains[1].modules.miner).toBe(1);
    expect(migrated.unlockedSkillNodes).toEqual(["commandRank1"]); // 2 captains -> grandfathered
    expect(migrated.skillPoints).toBe(0);
    expect(migrated.gameTimeSeconds).toBe(100);
  });
});
```

**Step 2b:** In the THREE existing `it("current SAVE_VERSION is 6", ...)` blocks (in the
`"migrate — tickDurationSeconds backfill"`, `"migrate — research field backfill"`, and
`"migrate — captains roster backfill (v4 -> v5)"` describe blocks), change
`expect(SAVE_VERSION).toBe(6)` to `expect(SAVE_VERSION).toBe(7)`. Also update the ONE existing
`"current SAVE_VERSION is 6"` inside `"migrate — captain miner-floor backfill (hotfix)"` the same
way. Same expected test maintenance done at every previous version bump this session.

**Step 3: Confirm the tests would fail**

`MIGRATIONS[6]` doesn't exist yet, `SAVE_VERSION` is currently `6`. Confirm by inspection.

**Step 4: Write the implementation**

In `src/lib/game/save.ts`:

1. Change `export const SAVE_VERSION = 6;` to `export const SAVE_VERSION = 7;`.
2. Extend the top-of-file migration-table comment and add `MIGRATIONS[6]`:

```ts
// v6 -> v7: Fleet Admiral Skill Tree (docs/plans/2026-07-06-skill-tree-plan.md,
// Task 3). GameState gains `skillPoints`/`unlockedSkillNodes`. Existing v6
// saves already have 2 captains from Phase 1 (freshState() used to always
// give 2) -- rather than shrinking their roster to match the NEW "starts at
// 1" default (which would delete a captain's progress), this grandfathers
// them: if a save already has 2+ captains, commandRank1 is marked as already
// unlocked (so captainSlotCount(state) matches what they already have,
// keeping Fleet Prestige's reset consistent going forward), with no bonus
// skillPoints granted -- just "don't lose what you already earned."
```

```ts
  6: (state: any): GameState => ({
    ...state,
    unlockedSkillNodes: state.unlockedSkillNodes ?? ((state.captains?.length ?? 1) >= 2 ? ["commandRank1"] : []),
    skillPoints: state.skillPoints ?? 0,
  }),
```

**Step 5: Confirm the tests would pass**

Manually trace the new v6→v7 test: `legacyState.captains.length` is `2`, `unlockedSkillNodes` is
absent (`undefined ?? (...)`), so the ternary evaluates: `(2 >= 2)` is `true`, giving
`["commandRank1"]`. `skillPoints` is absent, `undefined ?? 0` gives `0`. Neither existing captain
object is touched by this migration step (only two NEW top-level fields are added via the outer
`...state` spread). ✓ Single-captain case: `captains.length` is `1`, `(1 >= 2)` is `false`, giving
`[]`. ✓

Manually trace the chained v1→v7 test: version starts at 1. `MIGRATIONS[1]` backfills
`tickDurationSeconds`. `MIGRATIONS[2]` backfills `research`. `MIGRATIONS[3]` backfills
`synthesizer`/`alloys`. `MIGRATIONS[4]` (now fixed in Step 1 to call `freshCaptains(2)`) moves the
flat shape into `captains[0]` and pairs it with `fresh[1]` (a genuinely fresh Captain 2, miner:1).
`MIGRATIONS[5]` checks both captains for `modules.miner === 0` — neither is (both are 1) — no-op.
`MIGRATIONS[6]` sees `captains.length === 2`, backfills `unlockedSkillNodes: ["commandRank1"]`,
`skillPoints: 0`. Every assertion in the test matches this trace. ✓

**Step 6: Commit**

```bash
git add src/lib/game/save.ts src/lib/game/save.test.ts
git commit -m "feat: migrate save schema v6->v7, backfill skill tree fields"
```

---

### Task 4: Skill Tree panel + Fleet Prestige copy update (`App.svelte`)

**Files:**
- Modify: `src/App.svelte`

**Context:** Read the current `src/App.svelte` in full before touching it — do not rely on any
paraphrase, since this file has had extensive review-driven changes across every task of Phase 1.
The live tick-bar loop (`onMount`'s `setInterval` body) calls `tickCaptainStack` directly with 3
arguments; per Task 2's Step 4, this now needs a 4th argument. The Fleet Prestige panel's copy and
`doPrestige`'s comment both currently say "starting roster of 2" / "always yields exactly 2
captains" — both are now inaccurate and need updating.

**Step 1: Update imports**

Find:

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
    fleetLifetimeComponents,
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
  import { tick, tickCaptainStack, prestige, captainPrestige } from "./lib/game/tick";
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
    fleetLifetimeComponents,
    isModuleUnlocked,
    isResourceUnlocked,
    RESEARCH_PROJECTS,
    SPECIALIZATIONS,
    SKILL_TREE,
    type ModuleKey,
    type ResearchKey,
    type SpecializationKey,
    type SkillNodeKey,
    type GameState,
    type CaptainState,
  } from "./lib/game/model";
  import { tick, tickCaptainStack, prestige, captainPrestige, buySkillNode } from "./lib/game/tick";
```

**Step 2: Fix the live tick-loop's `tickCaptainStack` call (4th argument)**

Find, inside the `onMount` tick-bar loop:

```ts
      ensureCaptainCycles(now);
      let captains = state.captains;
      let anyFired = false;
      const fleetMult = globalMultiplier(state); // invariant for this whole poll -- nothing in this loop touches augmentPoints

      for (let i = 0; i < captains.length; i++) {
        const captain = captains[i];
        const cycle = captainCycles[captain.id];
        const barSeconds = Math.max(1, captain.tickDurationSeconds / speed);
        cycle.nowTick = now;
        const progress = (now - cycle.barCycleStart) / 1000 / barSeconds;
        if (progress >= 1) {
          const gameSecondsThisCycle = barSeconds * speed;
          if (!anyFired) {
            captains = [...captains]; // copy on first write this poll
            anyFired = true;
          }
          captains[i] = tickCaptainStack(gameSecondsThisCycle, captain, fleetMult);
          cycle.barCycleStart = now;
        }
      }
```

Replace with:

```ts
      ensureCaptainCycles(now);
      let captains = state.captains;
      let anyFired = false;
      const fleetMult = globalMultiplier(state); // invariant for this whole poll -- nothing in this loop touches augmentPoints
      const researchMults = {} as Record<ResearchKey, number>;
      for (const key of Object.keys(RESEARCH_PROJECTS) as ResearchKey[]) {
        researchMults[key] = researchDurationMult(state, key);
      }

      for (let i = 0; i < captains.length; i++) {
        const captain = captains[i];
        const cycle = captainCycles[captain.id];
        const barSeconds = Math.max(1, captain.tickDurationSeconds / speed);
        cycle.nowTick = now;
        const progress = (now - cycle.barCycleStart) / 1000 / barSeconds;
        if (progress >= 1) {
          const gameSecondsThisCycle = barSeconds * speed;
          if (!anyFired) {
            captains = [...captains]; // copy on first write this poll
            anyFired = true;
          }
          captains[i] = tickCaptainStack(gameSecondsThisCycle, captain, fleetMult, researchMults);
          cycle.barCycleStart = now;
        }
      }
```

This introduces a new reference to `researchDurationMult` — add it to the import list from Step 1
(re-open the import block and add `researchDurationMult` alongside `captainMultiplier` etc.).

**Step 3: Add `doBuySkillNode` handler**

Find `doCaptainPrestige` (added in Phase 1's Task 6):

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

Add directly below it:

```ts
  function doBuySkillNode(nodeKey: SkillNodeKey) {
    const { next, success } = buySkillNode(state, nodeKey);
    if (!success) return;
    state = next;
    pushLog(`Skill unlocked: ${SKILL_TREE[nodeKey].label}.`);
    doSave();
  }
```

**Step 4: Update the Fleet Prestige panel's copy and `doPrestige`'s comment**

Find:

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

Replace with:

```ts
  function doPrestige() {
    const { next, gained } = prestige(state);
    if (gained <= 0) return;
    state = next;
    activeCaptainIndex = 0; // Captain 1's slot always survives a Fleet Prestige reset, regardless of roster size
    pushLog(`Fleet Prestige performed. +${gained} Augment Points, +1 Skill Point. Captain roster reset.`);
    doSave();
  }
```

Find the Fleet Prestige panel:

```svelte
      <Panel>
        <div class="panel-title">FLEET PRESTIGE — TIER 2</div>
        {@const fleetGain = Math.floor(Math.sqrt(fleetLifetimeComponents(state)))}
        <p class="prestige-text">
          Retire the WHOLE FLEET for Augment Points (√ of combined lifetime components across every
          captain). Resets every captain back to the starting roster of 2 — wiping all specializations,
          Captain Points, and individual progress along with resources and modules. Augment Points and
          the global multiplier persist.
        </p>
```

Replace with:

```svelte
      <Panel>
        <div class="panel-title">FLEET PRESTIGE — TIER 2</div>
        {@const fleetGain = Math.floor(Math.sqrt(fleetLifetimeComponents(state)))}
        <p class="prestige-text">
          Retire the WHOLE FLEET for Augment Points and a Skill Point (√ of combined lifetime
          components across every captain). Resets every captain back to your currently unlocked
          roster size — wiping all specializations, Captain Points, and individual progress along
          with resources and modules. Augment Points, the global multiplier, and your unlocked
          skills all persist.
        </p>
```

**Step 5: Add the SKILL TREE panel**

Insert a new `<Panel>` immediately after the Fleet Prestige panel's closing `</Panel>` and before the
`{#if DEV_MODE_ENV && devPanelOpen}` dev panel block:

```svelte
      <Panel>
        <div class="panel-title">SKILL TREE</div>
        <p class="prestige-text">
          Unspent Skill Points: <strong>{formatNumber(state.skillPoints)}</strong>
        </p>
        <div class="skill-branch">
          <div class="skill-branch-title">Command</div>
          {#each Object.entries(SKILL_TREE).filter(([, n]) => n.branch === "command") as [key, node]}
            {@const nodeKey = key as SkillNodeKey}
            {@const owned = state.unlockedSkillNodes.includes(nodeKey)}
            {@const prereqMet = !node.requires || state.unlockedSkillNodes.includes(node.requires)}
            {@const affordable = state.skillPoints >= node.costSkillPoints}
            <div class="skill-node" class:owned class:locked={!prereqMet && !owned}>
              <div class="skill-node-label">{node.label}</div>
              {#if owned}
                <span class="skill-node-status">✓ Unlocked</span>
              {:else if !prereqMet}
                <span class="skill-node-status">🔒 Requires previous rank</span>
              {:else}
                <button
                  class="buy-btn"
                  disabled={!affordable}
                  style="opacity:{affordable ? 1 : 0.4}"
                  on:click={() => doBuySkillNode(nodeKey)}
                >
                  Unlock · {node.costSkillPoints} SP
                </button>
              {/if}
            </div>
          {/each}
        </div>
        <div class="skill-branch">
          <div class="skill-branch-title">Research</div>
          {#each Object.entries(SKILL_TREE).filter(([, n]) => n.branch === "research") as [key, node]}
            {@const nodeKey = key as SkillNodeKey}
            {@const owned = state.unlockedSkillNodes.includes(nodeKey)}
            {@const prereqMet = !node.requires || state.unlockedSkillNodes.includes(node.requires)}
            {@const affordable = state.skillPoints >= node.costSkillPoints}
            <div class="skill-node" class:owned class:locked={!prereqMet && !owned}>
              <div class="skill-node-label">{node.label}</div>
              {#if owned}
                <span class="skill-node-status">✓ Unlocked</span>
              {:else if !prereqMet}
                <span class="skill-node-status">🔒 Requires previous rank</span>
              {:else}
                <button
                  class="buy-btn"
                  disabled={!affordable}
                  style="opacity:{affordable ? 1 : 0.4}"
                  on:click={() => doBuySkillNode(nodeKey)}
                >
                  Unlock · {node.costSkillPoints} SP
                </button>
              {/if}
            </div>
          {/each}
        </div>
      </Panel>
```

**Step 6: Add supporting CSS**

Add to the `<style>` block, near `.spec-btn`:

```css
  .skill-branch { margin-bottom: 14px; }
  .skill-branch:last-child { margin-bottom: 0; }
  .skill-branch-title {
    font-size: 10px;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--color-text-secondary);
    margin-bottom: 8px;
  }
  .skill-node {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--color-panel-bg-strong);
    border: 1px solid rgba(var(--color-accent-rgb), 0.12);
    margin-bottom: 6px;
    gap: 8px;
  }
  .skill-node:last-child { margin-bottom: 0; }
  .skill-node.owned { border-color: var(--color-success); }
  .skill-node.locked { opacity: 0.5; }
  .skill-node-label { font-size: 12px; font-weight: 600; }
  .skill-node-status { font-size: 11px; color: var(--color-text-secondary); }
```

**Step 7: Audit the whole file for hardcoded 2-captain assumptions**

Read the entire current `<script>` and `<template>` sections once more, end to end. Confirm:
- The `.captain-tabs` block (`{#each state.captains as captain, i}`) already iterates the roster
  generically — no fix needed there, just confirm it.
- `activeCycle`'s fallback comment (`"It assumes captains.length never shrinks... always 2
  entries"`) is now stale — update it to note the roster can be any size `>= 1` and only ever grows
  or resets (never shrinks below 1), rather than referencing "always 2."
- No other `captains[1]` or hardcoded `2` reference exists anywhere referring to captain count
  (distinct from unrelated numbers like CSS pixel values or the `2500` alloys base cost, which are
  unrelated).

**Step 8: Manual verification (no automated test — UI markup/timing logic, Node unavailable)**

Confirm: `doBuySkillNode` calls `buySkillNode` (already reviewed/approved pure logic from Task 2),
early-returns via `success` exactly like every other buy-style action in this file. The panel's
`owned`/`locked`/purchasable three-way branching is mutually exclusive per node
(`{#if owned}...{:else if !prereqMet}...{:else}...{/if}`). Confirm the live tick loop's new
`researchMults` computation reads `state` fresh each poll (not stale), matching how `fleetMult` is
already recomputed fresh each poll on the line directly above it.

**Step 9: Commit**

```bash
git add src/App.svelte
git commit -m "feat: add Skill Tree panel, wire research-speed buff into live tick loop"
```

---

### Task 5: Docs and final commit

**Files:**
- Modify: `SESSION_LOG.md`
- Modify: `KNOWN_ISSUES.md`

**Step 1: Update `KNOWN_ISSUES.md`**

Read the existing file. Find the entry (added at Phase 1's final review) describing `prestige()`'s
fleet-wide reset always collapsing `captains` back to exactly 2 as "a Phase-1 simplification... once
Phase 2's skill tree can unlock additional captain slots, this needs to become 'reset to however
many slots the player has earned.'" This feature directly fixes that gap (`prestige()` now calls
`freshCaptains(captainSlotCount(state))`) — mark that entry resolved (either remove it entirely, or
strike it through with a note pointing at this feature/commit, matching whatever convention the
file already uses for resolved items; if no such convention exists yet, removing the entry outright
is fine since the code comment on `prestige()`/`captainSlotCount()` now documents this directly).

Consider (use judgment, only if genuinely useful per this file's own stated purpose) whether
anything new from THIS feature is worth flagging — e.g., `SKILL_TREE`'s linear single-prerequisite
model (`requires: SkillNodeKey | null`) doesn't support a node requiring MULTIPLE prerequisites or
belonging to more than one dependency chain; not a problem for today's 4 nodes, but worth a note if
future branches need a richer dependency graph.

**Step 2: Append a session log entry**

Read the existing `SESSION_LOG.md`'s most recent entries for format/tone. Check the actual final
commit count on this branch (`git log --oneline main..HEAD` or equivalent) against this plan's
5-task structure before writing — this plan has 5 tasks, but review-driven fixes may add more; count
what genuinely happened, per this session's established practice.

Draft text (correct against real history before using):

```markdown

**Session 9** — Added the Fleet Admiral Skill Tree (Phase 2 of the captain/ship
feature, docs/plans/2026-07-06-skill-tree-design.md): a generic branch/node
skill tree (Command: 3 ranks unlocking captain slots 2/3/4 at increasing
Skill Point cost; Research: 1 node cutting Alloy Synthesis's duration by
25%), earned at 1 Skill Point per Fleet Prestige. Captain-slot count is now
a real, derived, persistent number (`captainSlotCount`) instead of a
hardcoded 2 -- fixing the exact gap flagged in KNOWN_ISSUES.md when Phase 1
shipped: Fleet Prestige now rebuilds the roster at however many slots have
actually been earned, and Skill Points/unlocked nodes survive a Fleet
Prestige the same way Augment Points already do. A brand-new game now starts
with just 1 captain -- existing saves are grandfathered via a v6->v7
migration that marks the first Command rank as already-unlocked so returning
players don't lose their existing 2nd captain. `tickCaptainStack` gained a
4th parameter for research-speed buffs, computed once per tick() the same
way the fleet multiplier already is; the closed-form invariant was
re-verified with all four multipliers (fleet/captain/specialization/research
speed) active at once. Next: get eyes on this in an actual browser -- unlock
Command rank 1, confirm a new captain tab appears and is immediately
playable (not another softlock), unlock the Research node and confirm Alloy
Synthesis actually completes sooner, and confirm an existing save keeps its
2nd captain after migrating. The resourcing/combat/science specialization
redesign and "fleet starbase" navigation ideas raised during this feature's
brainstorm remain explicitly deferred to a future, not-yet-started design.
```

**Step 3: Commit**

```bash
git add SESSION_LOG.md KNOWN_ISSUES.md
git commit -m "docs: log skill tree session, resolve Fleet-Prestige-hardcoded-2 known issue"
```

**Step 4: Do not push.** Same as every other feature this session — pushing to `origin/main`
triggers a live Vercel production redeploy and needs the user's explicit go-ahead first.
