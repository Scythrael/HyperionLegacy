# Captain & Homeworld Talent Trees Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add two parallel talent trees (per-captain and fleet-wide), each with 5 branches (3 real,
2 stubs), spent from existing/new point pools, and a Fleet Admiral leveling system that feeds the
fleet-wide pool.

**Architecture:** Two new data-driven tables (`CAPTAIN_TALENTS`/`HOMEWORLD_TALENTS`) mirror the
deleted Skill Tree's exact conventions. Two new generic buy functions apply typed effects. Fleet
Admiral XP derives from the sum of captain levels, checked in both places captain-mission XP is
already checked (pure `tick()` and the live poll loop), using the same closed-form "resolve every
level-up crossed in one pass" shape already proven for captain leveling. The existing
`CAPTAIN_SLOT_UNLOCKS`/`unlockCaptainSlot()` mechanism (Phase 4) is deliberately removed in its own
dedicated task, AFTER the new Fleet Logistics branch can already do the same job — never two
competing slot-unlock systems live at once for longer than one task boundary.

**Tech Stack:** Svelte 5, TypeScript, Vitest (configured but unexecutable — no Node/npm/tsc in this
environment; every verification step is manual code tracing).

**Design doc:** `docs/plans/2026-07-07-captain-homeworld-talent-trees-design.md`.

---

## Read this before starting

Task 3 (Fleet Admiral XP hook) touches `tickCaptainMission()` in `tick.ts` — a closed-form,
float-drift-tolerant state machine that needed 3 review rounds in Phase 3a and already carries one
delicate XP-hook (captain leveling, added in Phase 4). Task 4 (removing `CAPTAIN_SLOT_UNLOCKS`) is a
real removal of shipped, tested code with call sites in `App.svelte` — read every reference before
touching it, same discipline Phase 4's Generator Stack removal required. Both are flagged **HIGH
RISK** in their own task below.

---

### Task 1: Talent tree data model (`model.ts`)

**Files:**
- Modify: `src/lib/game/model.ts`
- Modify: `src/lib/game/model.test.ts`

**Step 1: Write the failing tests**

```ts
describe("CAPTAIN_TALENTS — launch set", () => {
  it("Command and Resourcefulness have real nodes; Tactical/Science/Diplomacy are empty", () => {
    const branches = Object.values(CAPTAIN_TALENTS).map((t) => t.branch);
    expect(branches.filter((b) => b === "command").length).toBeGreaterThan(0);
    expect(branches.filter((b) => b === "resourcefulness").length).toBeGreaterThan(0);
    expect(branches.filter((b) => b === "tactical").length).toBe(0);
    expect(branches.filter((b) => b === "science").length).toBe(0);
    expect(branches.filter((b) => b === "diplomacy").length).toBe(0);
  });
});

describe("HOMEWORLD_TALENTS — launch set", () => {
  it("Fleet Logistics, Industry, Economy have real nodes; Homeland Defense/Citizenry are empty", () => {
    const branches = Object.values(HOMEWORLD_TALENTS).map((t) => t.branch);
    expect(branches.filter((b) => b === "fleetLogistics").length).toBeGreaterThan(0);
    expect(branches.filter((b) => b === "industry").length).toBeGreaterThan(0);
    expect(branches.filter((b) => b === "economy").length).toBeGreaterThan(0);
    expect(branches.filter((b) => b === "homelandDefense").length).toBe(0);
    expect(branches.filter((b) => b === "citizenry").length).toBe(0);
  });

  it("Fleet Logistics has exactly 3 unlockCaptainSlot nodes, matching today's CAPTAIN_SLOT_UNLOCKS count", () => {
    const slotNodes = Object.values(HOMEWORLD_TALENTS).filter((t) => t.effect.type === "unlockCaptainSlot");
    expect(slotNodes).toHaveLength(3);
  });
});

describe("freshState / freshCaptainStack — talent and Fleet Admiral fields", () => {
  it("a fresh captain has no unlocked talents", () => {
    expect(freshCaptains(1)[0].unlockedCaptainTalents).toEqual([]);
  });

  it("freshState starts Fleet Admiral at level 1, 0 xp, 0 adminPoints, no unlocked Homeworld talents", () => {
    const state = freshState();
    expect(state.fleetAdminXp).toBe(0);
    expect(state.fleetAdminLevel).toBe(1);
    expect(state.adminPoints).toBe(0);
    expect(state.unlockedHomeworldTalents).toEqual([]);
  });
});
```

**Step 2: Confirm the tests would fail**

None of these symbols exist yet. Confirm by inspection.

**Step 3: Write the implementation**

Add after `CAPTAIN_SLOT_UNLOCKS` (which stays untouched for now — Task 4 removes it later):

```ts
export type CaptainTalentBranch = "command" | "tactical" | "science" | "resourcefulness" | "diplomacy";
export type HomeworldTalentBranch = "fleetLogistics" | "homelandDefense" | "citizenry" | "economy" | "industry";

export type CaptainTalentEffect =
  | { type: "extractionYieldMult"; mult: number }
  | { type: "rareLootChanceMult"; mult: number };

export type HomeworldTalentEffect =
  | { type: "unlockCaptainSlot"; atLevel: number; statPointCost: number; componentsCost: number }
  | { type: "fleetExtractionYieldMult"; mult: number }
  | { type: "recipeBonusOutput"; recipeKey: RecipeKey; bonus: number }
  | { type: "passiveTrickle"; material: HomePlanetMaterialKey; perTick: number };

export interface CaptainTalentDef {
  branch: CaptainTalentBranch;
  label: string;
  cost: number; // statPoints
  requires: CaptainTalentKey | null; // same-branch prerequisite, same convention as the old Skill Tree
}

export interface HomeworldTalentDef {
  branch: HomeworldTalentBranch;
  label: string;
  cost: number; // adminPoints
  requires: HomeworldTalentKey | null;
}

// NOTE: effect lives on the *Def directly below via a second field, not nested
// inside CaptainTalentDef/HomeworldTalentDef above -- TypeScript can't express
// "this interface's shape depends on which union member `effect` is" cleanly
// without generics that would over-complicate a launch table this small, so
// each entry below is typed with an explicit inline `& { effect: ... }`.

// Only Command and Resourcefulness get real launch content. Tactical, Science,
// and Diplomacy are deliberately EMPTY (zero entries with that branch) --
// each depends on a system that doesn't exist yet (combat, a redefined
// Science mechanic). The UI iterates the fixed 5-branch list, not this
// table's keys, so an empty branch still renders as a labeled column with
// nothing in it. Add entries here (and nowhere else -- App.svelte's Captain
// Talents panel iterates this object) when a branch's system is ready.
export type CaptainTalentKey =
  | "commandExtractionI"
  | "commandExtractionII"
  | "resourcefulnessRareChanceI"
  | "resourcefulnessRareChanceII";

export const CAPTAIN_TALENTS: Record<CaptainTalentKey, CaptainTalentDef & { effect: CaptainTalentEffect }> = {
  commandExtractionI: {
    branch: "command",
    label: "Command Efficiency I",
    cost: 2,
    requires: null,
    effect: { type: "extractionYieldMult", mult: 0.1 },
  },
  commandExtractionII: {
    branch: "command",
    label: "Command Efficiency II",
    cost: 4,
    requires: "commandExtractionI",
    effect: { type: "extractionYieldMult", mult: 0.15 },
  },
  resourcefulnessRareChanceI: {
    branch: "resourcefulness",
    label: "Keen Eye I",
    cost: 2,
    requires: null,
    effect: { type: "rareLootChanceMult", mult: 0.25 },
  },
  resourcefulnessRareChanceII: {
    branch: "resourcefulness",
    label: "Keen Eye II",
    cost: 4,
    requires: "resourcefulnessRareChanceI",
    effect: { type: "rareLootChanceMult", mult: 0.5 },
  },
};

// Fleet Logistics absorbs CAPTAIN_SLOT_UNLOCKS' 3 tiers wholesale (Task 4
// removes the old table/mechanism once this is proven in place -- see plan).
// Homeland Defense and Citizenry are deliberately EMPTY, same reasoning as
// Tactical/Science/Diplomacy above (need Battlespace / a population system,
// neither exists yet).
export type HomeworldTalentKey =
  | "fleetLogisticsSlot1"
  | "fleetLogisticsSlot2"
  | "fleetLogisticsSlot3"
  | "fleetLogisticsYield"
  | "industryBonusOutput"
  | "economyTrickle";

export const HOMEWORLD_TALENTS: Record<HomeworldTalentKey, HomeworldTalentDef & { effect: HomeworldTalentEffect }> = {
  fleetLogisticsSlot1: {
    branch: "fleetLogistics",
    label: "Recruit Captain (2nd slot)",
    cost: 3,
    requires: null,
    effect: { type: "unlockCaptainSlot", atLevel: 3, statPointCost: 2, componentsCost: 5 },
  },
  fleetLogisticsSlot2: {
    branch: "fleetLogistics",
    label: "Recruit Captain (3rd slot)",
    cost: 5,
    requires: "fleetLogisticsSlot1",
    effect: { type: "unlockCaptainSlot", atLevel: 6, statPointCost: 4, componentsCost: 15 },
  },
  fleetLogisticsSlot3: {
    branch: "fleetLogistics",
    label: "Recruit Captain (4th slot)",
    cost: 8,
    requires: "fleetLogisticsSlot2",
    effect: { type: "unlockCaptainSlot", atLevel: 10, statPointCost: 6, componentsCost: 40 },
  },
  fleetLogisticsYield: {
    branch: "fleetLogistics",
    label: "Fleet Requisitions",
    cost: 4,
    requires: null,
    effect: { type: "fleetExtractionYieldMult", mult: 0.05 },
  },
  industryBonusOutput: {
    branch: "industry",
    label: "Tooling Upgrade",
    cost: 4,
    requires: null,
    effect: { type: "recipeBonusOutput", recipeKey: "fabricateComponents", bonus: 1 },
  },
  economyTrickle: {
    branch: "economy",
    label: "Trade Contacts",
    cost: 3,
    requires: null,
    effect: { type: "passiveTrickle", material: "commonOre", perTick: 1 },
  },
};
```

**Step 4: Add the bare new fields**

`CaptainState` gains (after `statPoints`):
```ts
  unlockedCaptainTalents: CaptainTalentKey[]; // logic (buyCaptainTalent) lands in Task 2
```

`GameState` gains (after `homePlanet`):
```ts
  unlockedHomeworldTalents: HomeworldTalentKey[]; // logic (buyHomeworldTalent) lands in Task 2
  fleetAdminXp: number; // Fleet Admiral leveling -- logic lands in Task 3
  fleetAdminLevel: number; // starts at 1
  adminPoints: number; // unspent, spent via buyHomeworldTalent (Task 2)
```

Update `freshCaptainStack()`'s `Pick<>` and return value to include `unlockedCaptainTalents: []`.
Update `freshState()` to include `unlockedHomeworldTalents: [], fleetAdminXp: 0, fleetAdminLevel: 1,
adminPoints: 0`.

**Step 5: Confirm tests pass**

Trace each by hand against the tables/fields above.

**Step 6: Commit**

```bash
git add src/lib/game/model.ts src/lib/game/model.test.ts
git commit -m "feat: add Captain/Homeworld talent tables and bare Fleet Admiral fields"
```

---

### Task 2: Generic buy functions (`tick.ts`)

**Files:**
- Modify: `src/lib/game/tick.ts`
- Modify: `src/lib/game/tick.test.ts`

**Context:** At the end of this task, BOTH the old `unlockCaptainSlot()` (level-gated, per-captain
cost) AND the new `buyHomeworldTalent`-driven Fleet Logistics unlock (adminPoints-gated) exist side
by side. This is intentional — Task 4 removes the old one only after this new path is proven working.

**Step 1: Write the failing tests**

```ts
describe("buyCaptainTalent", () => {
  it("succeeds when affordable and prerequisite met, deducts statPoints, records the unlock", () => {
    const state = freshState();
    state.captains[0].statPoints = 2;
    const { next, success } = buyCaptainTalent(state, 1, "commandExtractionI");
    expect(success).toBe(true);
    expect(next.captains[0].statPoints).toBe(0);
    expect(next.captains[0].unlockedCaptainTalents).toEqual(["commandExtractionI"]);
  });

  it("fails (same state reference) if already unlocked", () => {
    const state = freshState();
    state.captains[0].statPoints = 10;
    const { next: dispatched } = buyCaptainTalent(state, 1, "commandExtractionI");
    const { next, success } = buyCaptainTalent(dispatched, 1, "commandExtractionI");
    expect(success).toBe(false);
    expect(next).toBe(dispatched);
  });

  it("fails if the prerequisite isn't unlocked yet", () => {
    const state = freshState();
    state.captains[0].statPoints = 10;
    const { next, success } = buyCaptainTalent(state, 1, "commandExtractionII");
    expect(success).toBe(false);
    expect(next).toBe(state);
  });

  it("fails if statPoints are insufficient", () => {
    const state = freshState();
    state.captains[0].statPoints = 1; // costs 2
    const { next, success } = buyCaptainTalent(state, 1, "commandExtractionI");
    expect(success).toBe(false);
    expect(next).toBe(state);
  });
});

describe("buyHomeworldTalent", () => {
  it("succeeds for a non-slot node: deducts adminPoints, records the unlock", () => {
    const state = freshState();
    state.adminPoints = 4;
    const { next, success } = buyHomeworldTalent(state, "industryBonusOutput");
    expect(success).toBe(true);
    expect(next.adminPoints).toBe(0);
    expect(next.unlockedHomeworldTalents).toEqual(["industryBonusOutput"]);
  });

  it("succeeds for an unlockCaptainSlot node: also appends a new captain", () => {
    const state = freshState();
    state.adminPoints = 3;
    const { next, success } = buyHomeworldTalent(state, "fleetLogisticsSlot1");
    expect(success).toBe(true);
    expect(next.captains).toHaveLength(2);
    expect(next.captains[1].id).toBe(2);
  });

  it("fails if adminPoints are insufficient", () => {
    const state = freshState();
    state.adminPoints = 2; // costs 3
    const { next, success } = buyHomeworldTalent(state, "fleetLogisticsSlot1");
    expect(success).toBe(false);
    expect(next).toBe(state);
  });
});
```

**Step 2: Confirm the tests would fail**

Neither function exists yet.

**Step 3: Write the implementation**

Add `CAPTAIN_TALENTS`, `HOMEWORLD_TALENTS`, `type CaptainTalentKey`, `type HomeworldTalentKey` to the
existing import from `./model`. Add after `craftRecipe`:

```ts
// Same "same state reference on failure" convention as every other buy/action
// function in this file. Validates: talent exists, not already unlocked,
// prerequisite (if any) already unlocked, statPoints sufficient. On success:
// deducts cost, records the unlock. The effect itself isn't APPLIED here --
// each effect type is read wherever that stat matters (extractionYieldMult
// inside tickCaptainMission's extraction math, rareLootChanceMult inside the
// loot roll) by checking unlockedCaptainTalents at read time, same pattern
// this codebase already uses for e.g. specialization multipliers historically.
export function buyCaptainTalent(
  state: GameState,
  captainId: number,
  talentKey: CaptainTalentKey
): { next: GameState; success: boolean } {
  const idx = state.captains.findIndex((c) => c.id === captainId);
  if (idx === -1) return { next: state, success: false };
  const captain = state.captains[idx];
  const talent = CAPTAIN_TALENTS[talentKey];

  if (captain.unlockedCaptainTalents.includes(talentKey)) return { next: state, success: false };
  if (talent.requires && !captain.unlockedCaptainTalents.includes(talent.requires)) {
    return { next: state, success: false };
  }
  if (captain.statPoints < talent.cost) return { next: state, success: false };

  const captains = [...state.captains];
  captains[idx] = {
    ...captain,
    statPoints: captain.statPoints - talent.cost,
    unlockedCaptainTalents: [...captain.unlockedCaptainTalents, talentKey],
  };
  return { next: { ...state, captains }, success: true };
}

// Same shape as buyCaptainTalent, fleet-wide. unlockCaptainSlot is the one
// effect type with an additional side effect beyond "record the unlock" --
// appending a new captain via freshCaptainStack(), same baseline every other
// captain-creation path in this codebase uses.
export function buyHomeworldTalent(
  state: GameState,
  talentKey: HomeworldTalentKey
): { next: GameState; success: boolean } {
  const talent = HOMEWORLD_TALENTS[talentKey];

  if (state.unlockedHomeworldTalents.includes(talentKey)) return { next: state, success: false };
  if (talent.requires && !state.unlockedHomeworldTalents.includes(talent.requires)) {
    return { next: state, success: false };
  }
  if (state.adminPoints < talent.cost) return { next: state, success: false };

  const unlockedHomeworldTalents = [...state.unlockedHomeworldTalents, talentKey];
  const adminPoints = state.adminPoints - talent.cost;

  if (talent.effect.type === "unlockCaptainSlot") {
    const nextId = state.captains.length + 1;
    const captains = [
      ...state.captains,
      { id: nextId, label: `Captain ${nextId}`, shipType: "resourcer" as const, ...freshCaptainStack() },
    ];
    return { next: { ...state, captains, adminPoints, unlockedHomeworldTalents }, success: true };
  }

  return { next: { ...state, adminPoints, unlockedHomeworldTalents }, success: true };
}
```

**Step 4: Confirm tests pass, trace by hand**

**Step 5: Commit**

```bash
git add src/lib/game/tick.ts src/lib/game/tick.test.ts
git commit -m "feat: add buyCaptainTalent/buyHomeworldTalent, generic talent-purchase functions"
```

---

### Task 3: Fleet Admiral leveling — HIGH RISK

**Files:**
- Modify: `src/lib/game/tick.ts`
- Modify: `src/lib/game/tick.test.ts`
- Modify: `src/App.svelte`

**Context:** Read `tickCaptainMission`'s existing XP-hook (the `xp`/`level`/`statPoints` local
variables and the `while (xp >= xpForNextLevel(level))` loop inside the cycle-completion branch) one
more time before writing this task's code — this task's Fleet Admiral hook needs the SAME closed-form
property (a big jump that levels several captains at once must resolve every Fleet Admiral level-up
crossed, not just the first), but it lives in `tick()`, not inside `tickCaptainMission` itself, since
Fleet Admiral XP depends on the SUM across all captains, not any single captain's own mission.

**Step 1: Write the failing tests**

```ts
describe("recomputeFleetAdmin", () => {
  it("no-op when the aggregate captain-level sum hasn't changed", () => {
    const state = freshState();
    state.captains[0].level = 5;
    state.fleetAdminXp = 0;
    // First call establishes the baseline sum; calling again with no captain
    // level change must not re-award XP for the same sum twice.
    const once = recomputeFleetAdmin(state);
    const twice = recomputeFleetAdmin(once);
    expect(twice.fleetAdminXp).toBe(once.fleetAdminXp);
    expect(twice.fleetAdminLevel).toBe(once.fleetAdminLevel);
  });

  it("awards Fleet Admiral XP proportional to the SUM of captain levels, with a much steeper curve", () => {
    const state = freshState();
    state.captains = freshCaptains(2);
    state.captains[0].level = 10;
    state.captains[1].level = 5;
    const result = recomputeFleetAdmin(state);
    // Exact expected xp/level depend on the formula chosen below -- hand-trace
    // against YOUR actual xpForNextFleetAdminLevel implementation, don't copy
    // this assertion blindly.
    expect(result.fleetAdminXp).toBeGreaterThanOrEqual(0);
  });

  it("a big jump in aggregate captain levels resolves every Fleet Admiral level-up crossed, not just one", () => {
    const state = freshState();
    state.captains = freshCaptains(3);
    state.captains[0].level = 50;
    state.captains[1].level = 50;
    state.captains[2].level = 50;
    const result = recomputeFleetAdmin(state);
    expect(result.fleetAdminLevel).toBeGreaterThan(1);
    expect(result.adminPoints).toBeGreaterThan(0);
  });
});
```

**Step 2: Confirm the tests would fail**

`recomputeFleetAdmin` doesn't exist yet.

**Step 3: Write the implementation**

Add to `model.ts` (alongside `xpForNextLevel`):

```ts
// Deliberately much steeper than a captain's own xpForNextLevel -- the
// intent (per design doc) is "level-50 captains might only mean a level 3-4
// Fleet Admiral." A simple quadratic-ish curve achieves that without needing
// per-level hand-tuning (unlike CAPTAIN_SLOT_UNLOCKS-style finite tables).
export function xpForNextFleetAdminLevel(level: number): number {
  return 500 * level * level;
}
```

Add to `tick.ts` (add `xpForNextFleetAdminLevel` to the existing import):

```ts
// Fleet Admiral XP is NOT accumulated incrementally like captain XP (there's
// no single "cycle completion" event for the fleet as a whole) -- it's
// recomputed fresh each call from the sum of every captain's CURRENT level.
// This makes it naturally idempotent (calling it twice with no captain-level
// change is a genuine no-op) and naturally closed-form (a big jump in
// several captains' levels between calls is just a bigger sum on the next
// call -- there's no "many small calls vs one big call" distinction to get
// wrong here, unlike tickCaptainMission's own XP hook, since this doesn't
// process a delta, it recomputes an absolute value every time).
export function recomputeFleetAdmin(state: GameState): GameState {
  const targetXp = state.captains.reduce((sum, c) => sum + c.level, 0);
  if (targetXp === state.fleetAdminXp) return state; // no captain leveled since last check -- same reference

  let xp = targetXp;
  let level = state.fleetAdminLevel;
  let adminPoints = state.adminPoints;
  while (xp >= xpForNextFleetAdminLevel(level)) {
    level += 1;
    adminPoints += 1;
  }

  return { ...state, fleetAdminXp: xp, fleetAdminLevel: level, adminPoints };
}
```

Call `recomputeFleetAdmin` at the end of `tick()`, after building the `captains` array (so it sees
each captain's post-tick level):

```ts
export function tick(deltaSeconds: number, state: GameState): GameState {
  // ... existing body producing `captains`, `homePlanet` ...
  return recomputeFleetAdmin({
    ...state,
    captains,
    gameTimeSeconds: state.gameTimeSeconds + deltaSeconds,
    homePlanet: { /* unchanged from existing code */ },
  });
}
```

In `App.svelte`'s `onMount` live poll loop, find where the per-captain tick-bar loop finishes (after
the `anyFired`/`anyLootDelivered` state reassignments) and call `recomputeFleetAdmin` there too, same
"both the pure tick() path and the live-loop path need the same hook" pattern `tickCaptainMission`'s
own XP-award already established in Phase 4. Add `recomputeFleetAdmin` to the existing import from
`./lib/game/tick`.

**Step 4: Confirm tests pass, trace by hand**

Note: because `recomputeFleetAdmin` recomputes from an absolute sum rather than accumulating a delta,
its closed-form property is structurally simpler to reason about than `tickCaptainMission`'s (no
"many small calls vs one big call" distinction exists — it's pure function of current captain
levels). State this explicitly in your self-review rather than skipping the check because it "seems
obviously fine."

**Step 5: Commit**

```bash
git add src/lib/game/model.ts src/lib/game/tick.ts src/lib/game/tick.test.ts src/App.svelte
git commit -m "feat: add Fleet Admiral leveling (recomputeFleetAdmin), wired into tick() and the live loop"
```

---

### Task 4: Remove the old CAPTAIN_SLOT_UNLOCKS mechanism — HIGH RISK

**Files:**
- Modify: `src/lib/game/model.ts`
- Modify: `src/lib/game/model.test.ts`
- Modify: `src/lib/game/tick.ts`
- Modify: `src/lib/game/tick.test.ts`
- Modify: `src/App.svelte`

**Context:** Read the plan's "Read this before starting" section again. Fleet Logistics
(`fleetLogisticsSlot1/2/3`, Task 1) now does the exact same job as `CAPTAIN_SLOT_UNLOCKS`. Grep the
ENTIRE codebase for `CAPTAIN_SLOT_UNLOCKS`, `CaptainSlotUnlockDef`, and `unlockCaptainSlot` (the OLD
level-gated function, not `buyHomeworldTalent`) before removing anything.

**Step 1: Remove from `model.ts`**: `CaptainSlotUnlockDef`, `CAPTAIN_SLOT_UNLOCKS`. Remove the
now-stale `xp`/`statPoints` doc-comments on `CaptainState` that reference `unlockCaptainSlot()` — they
should now reference `buyHomeworldTalent`'s `unlockCaptainSlot` effect instead.

**Step 2: Remove from `tick.ts`**: the old `unlockCaptainSlot()` function entirely. Remove
`CAPTAIN_SLOT_UNLOCKS` from the import list.

**Step 3: Remove from `App.svelte`**: the Captain Leveling panel's entire "Unlock" section (the
`{#if CAPTAIN_SLOT_UNLOCKS[...]}` block and its button) — Fleet Logistics in the new Homeworld Talents
panel (Task 6) replaces it. Remove `doUnlockCaptainSlot()`, and `unlockCaptainSlot`/
`CAPTAIN_SLOT_UNLOCKS` from the imports. The Captain Leveling panel keeps its level/XP-bar/statPoints
display — only the Unlock section goes.

**Step 4: Update tests**: delete `"CAPTAIN_SLOT_UNLOCKS — launch set"` from `model.test.ts` and
`"unlockCaptainSlot"` from `tick.test.ts` (the OLD describe block testing the removed function — do
NOT touch the NEW `buyHomeworldTalent` tests from Task 2, which cover the same behavior through the
new mechanism).

**Step 5: Self-review**

Grep the whole codebase one more time for `CAPTAIN_SLOT_UNLOCKS`/`CaptainSlotUnlockDef`/the old
`unlockCaptainSlot` (careful: `buyHomeworldTalent` internally handles an `effect.type ===
"unlockCaptainSlot"` case — that's a STRING literal on the new effect union, not a reference to the
removed function; don't let a naive grep for the substring "unlockCaptainSlot" make you think you
missed something there). Confirm zero remaining references to the actually-removed symbols.

**Step 6: Commit**

```bash
git add src/lib/game/model.ts src/lib/game/model.test.ts src/lib/game/tick.ts src/lib/game/tick.test.ts src/App.svelte
git commit -m "refactor: remove CAPTAIN_SLOT_UNLOCKS, superseded by the Fleet Logistics talent branch"
```

---

### Task 5: Save migration (`save.ts`)

**Files:**
- Modify: `src/lib/game/save.ts`
- Modify: `src/lib/game/save.test.ts`

**Step 1: Confirm the current `SAVE_VERSION`** (grep it, don't assume — expected to be 9 as of this
plan's writing, bumping to 10, but verify).

**Step 2: Write the failing tests**, following this file's established v-to-v+1 pattern: a standalone
hand-written legacy fixture (captain with no `unlockedCaptainTalents`, state with no
`unlockedHomeworldTalents`/`fleetAdminXp`/`fleetAdminLevel`/`adminPoints`) confirming all backfill to
their defaults (`[]`, `[]`, `0`, `1`, `0`), plus updating/retiring the chained migration test to the
new final version, following this file's own NOTE-comment retirement precedent (there are several
prior examples in this exact file — match their wording/placement).

**Step 3: Implement** the new `MIGRATIONS[N]` entry (never edit any lower-numbered entry):

```ts
  N: (state: any): GameState => ({
    ...state,
    captains: state.captains.map((c: any) => ({ ...c, unlockedCaptainTalents: c.unlockedCaptainTalents ?? [] })),
    unlockedHomeworldTalents: state.unlockedHomeworldTalents ?? [],
    fleetAdminXp: state.fleetAdminXp ?? 0,
    fleetAdminLevel: state.fleetAdminLevel ?? 1,
    adminPoints: state.adminPoints ?? 0,
  }),
```

Bump `SAVE_VERSION`. Add a file-header comment matching the existing per-migration convention.

**Step 4: Confirm tests pass, trace by hand.**

**Step 5: Commit**

```bash
git add src/lib/game/save.ts src/lib/game/save.test.ts
git commit -m "feat: migrate save schema, backfill talent trees and Fleet Admiral fields"
```

---

### Task 6: UI — Captain Talents panel, Homeworld Talents panel (`App.svelte`)

**Files:**
- Modify: `src/App.svelte`

**Step 1**: Add `doBuyCaptainTalent(talentKey)`/`doBuyHomeworldTalent(talentKey)` handlers, mirroring
existing `do*` handlers' shape (call the function, check `success`, `pushLog`, `doSave()`). Add
`buyCaptainTalent`, `buyHomeworldTalent` to the import from `./lib/game/tick`; add `CAPTAIN_TALENTS`,
`HOMEWORLD_TALENTS`, `type CaptainTalentBranch`, `type HomeworldTalentBranch` to the import from
`./lib/game/model`.

**Step 2**: Add a CAPTAIN TALENTS panel under `fleetOps`, per-captain-scoped, placed after the
CAPTAIN LEVELING panel. Iterate the fixed 5-branch list (`["command", "tactical", "science",
"resourcefulness", "diplomacy"] as CaptainTalentBranch[]`); for each branch, filter
`Object.entries(CAPTAIN_TALENTS)` to that branch and render its nodes (label, cost, owned/locked/
buyable state per this codebase's established Skill-Tree-era `class:owned`/`class:locked` pattern —
check `git log`/older diffs if you need the exact CSS class names, or reuse whatever the Captain
Leveling panel already established), or "Not yet available" if the filtered list is empty.

**Step 3**: Add a HOMEWORLD TALENTS panel under `homeworld`, fleet-wide, placed after the existing
REFINERY/FABRICATION panels. Same 5-branch iteration over `HOMEWORLD_TALENTS`, gated on
`state.adminPoints`. For `unlockCaptainSlot`-effect nodes specifically, show the same
level/statPoints/Components requirement readout the OLD Captain Leveling panel's Unlock section used
to show (per-node now, reading `effect.atLevel`/`effect.statPointCost`/`effect.componentsCost`),
PLUS the node's own `cost` in `adminPoints` — buying a slot-unlock node now requires both the
`adminPoints` cost AND satisfying the embedded level/statPoints/Components requirement (read
`buyHomeworldTalent`'s actual implementation from Task 2 to confirm exactly what it validates before
writing this gating logic — don't guess).

**Step 4**: Manual verification (no test runner): confirm both panels' stub branches render as empty
sections rather than not appearing at all. Confirm a captain-talent purchase and a homeworld-talent
purchase each update the right state slice (per-captain vs fleet-wide) without touching the other.

**Step 5: Commit**

```bash
git add src/App.svelte
git commit -m "feat: add Captain Talents and Homeworld Talents panels"
```

---

### Task 7: Docs and final commit

**Files:**
- Modify: `SESSION_LOG.md`
- Modify: `KNOWN_ISSUES.md` (only if warranted)

**Step 1**: Check `KNOWN_ISSUES.md` — consider whether the thin Economy branch (one placeholder node,
explicitly provisional per the design doc) or the stub branches (5 total across both trees) deserve a
line, following this file's established "known, deliberately deferred" convention.

**Step 2**: Append a session log entry, verifying actual commit count against this plan's task
structure first (this session's established practice — count what genuinely happened).

**Step 3: Commit**

```bash
git add SESSION_LOG.md KNOWN_ISSUES.md
git commit -m "docs: log Captain & Homeworld Talent Trees session"
```

**Step 4: Do not push.** Needs the user's explicit go-ahead first.
