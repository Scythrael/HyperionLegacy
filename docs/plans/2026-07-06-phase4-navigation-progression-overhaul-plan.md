# Navigation Restructuring & Progression Overhaul Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the single-column panel layout with a 5-tab bottom navigation shell, retire the
Generator Stack (and everything built on top of it — Research, Skill Tree, both Prestige tiers), and
replace them with a fleet-wide Homeworld crafting economy (Refinery/Fabrication) fed by mission loot,
plus a captain XP/leveling system that grows the fleet.

**Architecture:** Mission loot (`homePlanet.storage`, already shipped) becomes the sole raw material
source. Two new fleet-wide structures (Refinery, Fabrication) each run one data-driven recipe,
mirroring the `MISSIONS` table pattern already proven in this codebase. Captains gain XP on mission-
cycle completion (hooking the existing `tickCaptainMission` completion event, not a new one); XP
grows via a simple formula, and a small hand-tunable table gates each additional captain slot behind
a level threshold plus a stat-point + Components cost. Generator Stack, Research, Skill Tree, and
both Prestige tiers are deleted outright — none of them have anything left to operate on.

**Tech Stack:** Svelte 5, TypeScript, Vitest (configured but unexecutable — no Node/npm/tsc in this
environment; every verification step below is manual code tracing, as it has been for every prior
feature this session).

**Design doc:** `docs/plans/2026-07-06-phase4-navigation-progression-overhaul-design.md` — read this
first if you haven't; this plan assumes its decisions are settled and doesn't re-justify them.

---

## Read this before starting

This plan deletes a large, interconnected slice of already-shipped, already-tested code
(Generator Stack, Research, Skill Tree, both Prestige tiers) across `model.ts`, `tick.ts`,
`save.ts`-adjacent tests, and `App.svelte` simultaneously, with **no compiler available anywhere in
this environment** to catch a missed reference. Task 2 and Task 3 below are the highest-risk work in
this entire plan — higher-stakes than Phase 3a's `tickCaptainMission` algorithm, because that was
new code being gotten right; this is working, shipped code being removed, where a missed reference
doesn't fail loudly, it just silently breaks at runtime (or worse, only in a code path nobody
exercises immediately).

Before touching anything in Task 2 or Task 3, grep the ENTIRE codebase (`src/`) for every symbol
being removed and read every result. Do not trust this plan's own list of call sites as exhaustive —
verify it yourself. This mirrors how Phase 1's per-captain refactor was safely done: model.ts's
interface changes land in one task, tick.ts's consuming changes land in the next, and the codebase is
allowed to be in a temporarily inconsistent state BETWEEN those two commits (nothing can run/compile-
check it anyway in this environment) as long as each task's OWN diff is internally deliberate and
fully cross-referenced.

---

### Task 1: Navigation shell (`App.svelte`) — additive only, no data model changes

**Files:**
- Modify: `src/App.svelte`

**Context:** This task ONLY adds tab navigation and relocates existing panel markup into tab-scoped
blocks. It does not delete, rename, or change the behavior of anything. This is deliberately the
first, safest task — if something looks wrong after this lands, it's purely a layout/visibility bug,
never a logic bug.

**Step 1: Add tab state**

Near the other `let` declarations (around line 74, after `activeCaptainIndex`), add:

```ts
type TabKey = "homeworld" | "sectorSpace" | "fleetOps" | "battlespace" | "system";
let activeTab: TabKey = "fleetOps"; // land on Fleet Ops by default -- captains/missions are the core loop
```

**Step 2: Add the tab bar markup**

Immediately inside `<main class="main">` (the very first thing inside it, before `.captain-tabs`),
add:

```svelte
<div class="nav-tabs">
  <button class="nav-tab" class:active={activeTab === "homeworld"} on:click={() => (activeTab = "homeworld")}>Homeworld</button>
  <button class="nav-tab" class:active={activeTab === "sectorSpace"} on:click={() => (activeTab = "sectorSpace")}>Sector Space</button>
  <button class="nav-tab" class:active={activeTab === "fleetOps"} on:click={() => (activeTab = "fleetOps")}>Fleet Ops</button>
  <button class="nav-tab" class:active={activeTab === "battlespace"} on:click={() => (activeTab = "battlespace")}>Battlespace</button>
  <button class="nav-tab" class:active={activeTab === "system"} on:click={() => (activeTab = "system")}>System</button>
</div>
```

Style `.nav-tabs`/`.nav-tab` matching the existing `.captain-tabs`/`.captain-tab` pattern (same file,
find it in the `<style>` block — same flex row, same active-state treatment, just visually distinct
enough to read as the OUTER nav vs. the INNER captain switcher). Fix `.nav-tab` to the bottom of the
viewport (`position: fixed; bottom: 0`) per "tabs along the bottom of the screen" — the rest of
`.frame`'s content needs bottom padding added so the fixed bar never overlaps the LOG panel or
whatever ends up at the bottom of System.

**Step 3: Wrap existing panel groups in tab-scoped conditionals**

Wrap each existing block (found in the current file at the line ranges below — re-verify these by
reading the file yourself first, since earlier tasks in this session may have shifted them slightly)
in `{#if activeTab === "..."}` / `{/if}`:

- **`homeworld`**: the HOME PLANET panel only, for now (Refinery/Fabrication panels land in Task 8).
- **`sectorSpace`**: nothing exists yet — add a placeholder `<Panel>` with a title and a single line
  of text: "Shipyard and Starbase are still under construction."
- **`fleetOps`**: `.captain-tabs`, RESOURCES, TICK, GENERATOR STACK, RESEARCH, MISSIONS, CAPTAIN
  PRESTIGE — TIER 1, FLEET PRESTIGE — TIER 2, and SKILL TREE panels, all exactly as they are today.
  (Yes, this temporarily puts soon-to-be-deleted panels under Fleet Ops — that's fine, Task 4 removes
  them from here directly. Keeping this task purely mechanical is more valuable than trying to
  pre-empt work that hasn't landed yet.)
- **`battlespace`**: nothing exists yet — add a placeholder `<Panel>`: "PvP and PvE fleet operations
  will live here."
- **`system`**: the existing OPTIONS overlay's content (theme row, Delete Save button) and the LOG
  panel, both moved OUT of their current spots (the Options overlay becomes unnecessary as a
  modal — fold its content directly into the System tab instead) and into this tab. Keep the
  DELETE SAVE confirmation as its own modal exactly as it is today (that's a deliberate, separately-
  reviewed destructive-action flow — don't restructure it). Remove the gear-icon (`⚙`) header button
  and `optionsPanelOpen` state entirely, since Options is no longer an overlay.

**Step 4: Manual verification (no automated test — layout/markup, Node unavailable)**

Confirm every panel that existed before this task still renders, under exactly one tab, with zero
logic changes — click through all 5 tabs (mentally trace the conditionals) and confirm nothing that
used to be visible is now permanently hidden, and nothing renders under two tabs at once.

**Step 5: Commit**

```bash
git add src/App.svelte
git commit -m "feat: add 5-tab bottom navigation shell, relocate existing panels"
```

---

### Task 2: Remove Generator Stack, Research, Skill Tree, and Prestige from `model.ts` — HIGHEST RISK

**Files:**
- Modify: `src/lib/game/model.ts`
- Modify: `src/lib/game/model.test.ts`

**Context:** Read the ENTIRE current `model.ts` before touching it. This task removes every type,
constant, and function whose sole purpose was the Generator Stack economy or the systems built on
top of it, and adds three new BARE data fields to `CaptainState` for the leveling system (values
only — no logic yet; Task 6 adds the logic that uses them). Landing the interface's FINAL shape in
one task (rather than adding leveling fields in a separate later task) means `CaptainState`/
`GameState` only change shape once in this whole plan, which is easier to reason about with no
compiler to check it.

**Step 1: Remove these exactly** (grep the file yourself to confirm current line numbers before
editing — this plan's line numbers are a snapshot, not a guarantee):

- `ResourceKey`, `ModuleKey`, `ModuleDef`, `MODULES`, `RESOURCE_ORDER`, `RESOURCE_LABEL`
- `ResearchKey`, `ResearchState`, `ResearchProjectDef`, `RESEARCH_PROJECTS`
- `SpecializationKey`, `SpecializationDef`, `SPECIALIZATIONS`
- `SkillBranchKey`, `SkillNodeKey`, `SkillNodeEffect`, `SkillNodeDef`, `SKILL_TREE`
- `costFor()`, `isModuleUnlocked()`, `isResourceUnlocked()`, `captainMultiplier()`,
  `specializationMultiplier()`, `captainSlotCount()`, `researchDurationMult()`
- From `CaptainState`: `resources`, `modules`, `research`, `lifetimeComponents`, `captainPoints`,
  `captainPrestigeCount`, `specialization`
- From `GameState`: `augmentPoints`, `prestigeCount`, `skillPoints`, `unlockedSkillNodes`
- `globalMultiplier()`, `fleetLifetimeComponents()`

Do NOT remove anything mission-related: `LootMaterialKey`, `LootTableEntry`, `MissionPhase`,
`MissionDef`, `MISSIONS`, `MissionKey`, `CaptainMissionState`, `requiredTicksForPhase()`,
`rollLootTable()`, `ShipType`, or `homePlanet` on `GameState` (Phase 3a's mission engine is completely
untouched by this task).

**Step 2: Add the new bare leveling fields**

To `CaptainState`, add (as the new last fields, after `mission`):

```ts
  xp: number; // accumulated toward the NEXT level -- see xpForNextLevel() below
  level: number; // starts at 1
  statPoints: number; // unspent, earned on level-up -- spent via unlockCaptainSlot() (Task 6, tick.ts)
```

**Step 3: Rewrite `freshCaptainStack()`/`freshCaptains()`/`freshState()`**

`freshCaptainStack()` collapses to just the fields a fresh OR reset captain needs (there is no more
prestige to reset a captain THROUGH — this function is now purely "what a brand-new captain slot
starts with"):

```ts
export function freshCaptainStack(): Pick<CaptainState, "tickDurationSeconds" | "mission" | "xp" | "level" | "statPoints"> {
  return {
    tickDurationSeconds: 10,
    mission: null,
    xp: 0,
    level: 1,
    statPoints: 0,
  };
}
```

`freshCaptains(count)` and `freshState()` keep their existing shape/signature — just drop the now-
removed fields (`captainPoints: 0`, `captainPrestigeCount: 0`, `specialization: null`) from
`freshCaptains`' per-captain object literal, since `freshCaptainStack()` no longer needs them spread
in from elsewhere.

**Step 4: Update `model.test.ts`**

Delete these describe blocks entirely (they test removed symbols): `"isModuleUnlocked (per-captain)"`,
`"isResourceUnlocked (per-captain)"`, `"captainMultiplier"`, `"specializationMultiplier"`,
`"SPECIALIZATIONS — launch set"`, `"SKILL_TREE — launch set"`, `"captainSlotCount"`,
`"researchDurationMult"`, `"fleetLifetimeComponents — shared by prestige()'s gate and the UI preview"`.

Update `"freshState — captain roster shape"`, `"freshCaptains(count) — parameterized roster
generation"`, `"freshCaptainStack — shared reset baseline"`, and `"freshState / freshCaptainStack —
mission and Home Planet fields"` to match the new, smaller shape (drop assertions on removed fields,
add assertions that a fresh captain has `xp: 0`, `level: 1`, `statPoints: 0`).

Leave `"MISSIONS — launch set"`, `"requiredTicksForPhase"`, and `"rollLootTable"` completely
untouched.

**Step 5: Self-review**

Grep `model.ts` for every symbol you just removed — confirm zero remaining references INSIDE this
file (e.g. no other function still reads `captain.modules`). `tick.ts`, `save.ts`, and `App.svelte`
will still reference several of these removed symbols after this task — that's expected and gets
fixed in Tasks 3 and 4. Do not attempt to fix those other files in this task.

**Step 6: Commit**

```bash
git add src/lib/game/model.ts src/lib/game/model.test.ts
git commit -m "refactor: remove Generator Stack/Research/Skill Tree/Prestige from model.ts, add bare captain leveling fields"
```

---

### Task 3: Remove Generator Stack, Research, Skill Tree, and Prestige from `tick.ts` — HIGHEST RISK

**Files:**
- Modify: `src/lib/game/tick.ts`
- Modify: `src/lib/game/tick.test.ts`

**Context:** Read the ENTIRE current `tick.ts` before touching it. With Generator Stack gone
(Task 2), `tickCaptainStack()` has nothing left to compute — every idle captain (no active mission)
now does nothing at all on a tick, which is a real, deliberate behavior change (previously idle
captains passively produced resources; now "idle" genuinely means idle, since missions are the only
economy). `tick()` simplifies accordingly.

**Step 1: Remove entirely**

`tickCaptainStack()`, `captainPrestige()`, `prestige()`, `buySkillNode()`. Remove their now-dead
imports from `./model` at the top of the file (`MODULES`, `globalMultiplier`, `captainMultiplier`,
`specializationMultiplier`, `captainSlotCount`, `researchDurationMult`, `RESEARCH_PROJECTS`,
`SKILL_TREE`, and the `ResearchKey`/`SkillNodeKey`/`SpecializationKey` types).

**Step 2: Simplify `tick()`**

```ts
export function tick(deltaSeconds: number, state: GameState): GameState {
  if (deltaSeconds <= 0) return state;

  // Idle captains (mission === null) have no passive economy anymore -- missions
  // are the only way a captain does anything. Only mission captains need advancing.
  const homePlanetDelta = emptyLootTotals();
  const captains = state.captains.map((captain) => {
    if (captain.mission === null) return captain;
    const ticksElapsed = deltaSeconds / captain.tickDurationSeconds;
    const { captain: updated, homePlanetDelta: delta } = tickCaptainMission(ticksElapsed, captain);
    (Object.keys(delta) as LootMaterialKey[]).forEach((key) => {
      homePlanetDelta[key] += delta[key];
    });
    return updated;
  });

  return {
    ...state,
    captains,
    gameTimeSeconds: state.gameTimeSeconds + deltaSeconds,
    homePlanet: {
      storage: {
        ...state.homePlanet.storage,
        commonOre: state.homePlanet.storage.commonOre + homePlanetDelta.commonOre,
        uncommonMaterial: state.homePlanet.storage.uncommonMaterial + homePlanetDelta.uncommonMaterial,
        rareMaterial: state.homePlanet.storage.rareMaterial + homePlanetDelta.rareMaterial,
      },
    },
  };
}
```

Note the `...state.homePlanet.storage` spread now included before the three named fields — this
preserves whatever Task 5 (crafting) ends up adding to `homePlanet.storage` (`refinedMaterial`,
`components`) that this function doesn't otherwise touch. Without it, `tick()` would silently zero
out those fields every call, since they wouldn't exist on the object literal — the EXACT class of bug
Task 6's prestige fix caught last phase. Don't repeat it.

`dispatchCaptainOnMission()` and `recallCaptain()` are untouched (Phase 3a's mission actions, nothing
here depends on the Generator Stack). `tickCaptainMission()` and `MISSION_TICK_EPSILON`/
`MISSION_PHASE_ORDER`/`emptyLootTotals()` are untouched.

**Step 3: Update `tick.test.ts`**

Delete these describe blocks entirely: `"tickCaptainStack — closed-form requirement (single
captain)"`, `"captainPrestige — per-captain reset (unaffected by this task, re-verify no
regression)"`, `"prestige — fleet-wide reset now uses earned slot count, grants a Skill Point"`,
`"buySkillNode"`, and `"captainPrestige and prestige cancel an active mission (falls out of
freshCaptainStack's mission: null)"` (the mechanic it tested no longer exists).

Rewrite `"tick — loops tickCaptainStack over every captain, advances fleet gameTimeSeconds once"` —
its premise (looping `tickCaptainStack`) no longer holds. Replace with a smaller set of tests for the
new `tick()`:
- an idle captain (`mission: null`) is returned completely unchanged (same object reference even, if
  your implementation naturally does that — verify what `.map()` actually returns for an untouched
  captain and assert accordingly, don't assume reference equality if the map callback always
  constructs something new).
- `gameTimeSeconds` still advances exactly once per call, not per captain (keep this test, it's still
  meaningful).
- zero delta is still a no-op.

Update `"tick() — routes captains on a mission through tickCaptainMission instead of production"` —
its current first test (`"a captain on a mission produces NOTHING via their normal Generator Stack
this tick"`) is testing something that can no longer happen at all (there's no Generator Stack call
to skip) — delete that specific test, keep the loot-aggregation tests (they're still fully valid,
just simplify away any `modules.miner`-setup lines that no longer compile against the new
`CaptainState` shape).

**Step 4: Self-review**

Grep `tick.ts` for every removed symbol — confirm zero remaining references. `App.svelte` will still
reference several removed `tick.ts` exports after this task (`tickCaptainStack`, `prestige`,
`captainPrestige`, `buySkillNode`) — expected, fixed in Task 4. Do not touch `App.svelte` in this
task.

**Step 5: Commit**

```bash
git add src/lib/game/tick.ts src/lib/game/tick.test.ts
git commit -m "refactor: remove Generator Stack/Research/Skill Tree/Prestige from tick.ts, simplify tick()"
```

---

### Task 4: Remove the dead panels and handlers from `App.svelte`

**Files:**
- Modify: `src/App.svelte`

**Context:** After Tasks 2 and 3, `App.svelte` has dangling references to everything removed. This
task deletes the UI side. Read the ENTIRE current `App.svelte` first (it's ~1100 lines; Task 1 already
reorganized it into tabs, so panel locations have shifted from where they were in this plan's earlier
research — find them fresh).

**Step 1: Remove from the `<script>` block**

- Now-dead imports from `./lib/game/model`: `MODULES`, `RESOURCE_ORDER`, `RESOURCE_LABEL`,
  `costFor`, `globalMultiplier`, `captainMultiplier`, `specializationMultiplier`,
  `fleetLifetimeComponents`, `isModuleUnlocked`, `isResourceUnlocked`, `RESEARCH_PROJECTS`,
  `SPECIALIZATIONS`, `SKILL_TREE`, `researchDurationMult`, and the types `ModuleKey`, `ResearchKey`,
  `SpecializationKey`, `SkillNodeKey`.
- Now-dead imports from `./lib/game/tick`: `tickCaptainStack`, `prestige`, `captainPrestige`,
  `buySkillNode`.
- Functions: `buyModule()`, `doPrestige()`, `doCaptainPrestige()`, `doBuySkillNode()`,
  `startResearch()`. In `grantResource()` and `simulateOffline()` (the dev-panel helpers): these
  reference `CaptainState["resources"]`, which no longer exists — remove `grantResource()` entirely
  for now (Task 8 can add an equivalent dev-grant helper targeting the NEW crafting resources once
  they exist); `simulateOffline()` itself is still valid (it just calls `tick()`), keep it as-is.
- The `mult` reactive statement (`$: mult = globalMultiplier(state);`) and anywhere it's read.

**Step 2: Remove from the markup**

- GENERATOR STACK, RESEARCH, CAPTAIN PRESTIGE — TIER 1, FLEET PRESTIGE — TIER 2, and SKILL TREE
  panels, wherever Task 1 relocated them (inside the `fleetOps` tab block).
- The header's "Augment Pts" and "Multiplier" stat-pills (their data no longer exists).
- The dev panel's `+1K ore` / `+1K ingots` / `+1K components` grant buttons (call `grantResource`,
  which you just removed) — delete the whole `.dev-row` containing them for now.

**Step 3: Confirm what's left compiles-by-inspection**

Grep the WHOLE file for every removed symbol/function name. Confirm the RESOURCES panel (which reads
`activeCaptain.resources`) — wait, check whether RESOURCES panel is still meaningful at all: it
displayed the 4 Generator-Stack resources, which are gone. Remove the RESOURCES panel entirely too
(it has nothing left to show — the new crafting resources live at the Home Planet, fleet-wide, not
per-captain, and get their own display in Task 8's Homeworld panels). Also remove the TICK panel's
underlying `activeTickProgress`/`activeBarSeconds`/`activeTickRemaining` reactive statements ONLY IF
nothing else uses them — check first, since the live tick-bar loop in `onMount` still needs
`captainCycles`/`barCycleStart` bookkeeping for MISSION progress display purposes; if the TICK panel
was purely cosmetic (a standalone progress bar) and nothing else depends on those reactive values,
you can remove the TICK panel too, since mission progress already has its own bar in the MISSIONS
panel. Use your judgment here and state your reasoning in the commit message.

**Step 4: Manual verification**

Read through the final `fleetOps` tab block start-to-finish: it should now contain the captain tabs,
the MISSIONS panel, and nothing else (until Task 8 adds the new Captain Leveling panel here). Confirm
no leftover references to anything removed in Tasks 2-4 remain anywhere in the file.

**Step 5: Commit**

```bash
git add src/App.svelte
git commit -m "refactor: remove Generator Stack/Research/Skill Tree/Prestige panels and handlers from App.svelte"
```

---

### Task 5: Homeworld crafting system — `RECIPES` table and `craftRecipe()` (`model.ts`, `tick.ts`)

**Files:**
- Modify: `src/lib/game/model.ts`
- Modify: `src/lib/game/model.test.ts`
- Modify: `src/lib/game/tick.ts`
- Modify: `src/lib/game/tick.test.ts`

**Step 1: Expand `homePlanet.storage`'s type (`model.ts`)**

```ts
export type HomePlanetMaterialKey = LootMaterialKey | "refinedMaterial" | "components";
```

Change `GameState.homePlanet` to:

```ts
  homePlanet: { storage: Record<HomePlanetMaterialKey, number> };
```

Update `freshState()`'s `homePlanet.storage` literal to include the two new keys at `0`.

**Step 2: Add the `RECIPES` table (`model.ts`)**

```ts
export type RecipeKey = "refineUnobtainium" | "fabricateComponents";

export interface RecipeDef {
  label: string;
  inputs: Partial<Record<HomePlanetMaterialKey, number>>;
  output: { key: HomePlanetMaterialKey; amount: number };
}

// 2 recipes at launch, one per structure -- proves the crafting mechanic.
// Add entries here (and nowhere else -- App.svelte's Homeworld panels iterate
// this object) as the "fully fleshed out crafting system" grows later.
export const RECIPES: Record<RecipeKey, RecipeDef> = {
  refineUnobtainium: {
    label: "Refine Unobtainium Ore",
    inputs: { commonOre: 10 },
    output: { key: "refinedMaterial", amount: 1 },
  },
  fabricateComponents: {
    label: "Fabricate Components",
    inputs: { refinedMaterial: 5 },
    output: { key: "components", amount: 1 },
  },
};
```

**Step 3: Write the failing tests (`model.test.ts`)**

```ts
describe("RECIPES — launch set", () => {
  it("has exactly 2 recipes with well-formed inputs/output", () => {
    expect(Object.keys(RECIPES)).toHaveLength(2);
    for (const recipe of Object.values(RECIPES)) {
      expect(Object.keys(recipe.inputs).length).toBeGreaterThan(0);
      expect(recipe.output.amount).toBeGreaterThan(0);
    }
  });
});
```

**Step 4: Write the failing tests for `craftRecipe` (`tick.test.ts`)**

Add `craftRecipe` to the existing import from `./tick`, and `RECIPES` to the existing import from
`./model`.

```ts
describe("craftRecipe", () => {
  it("succeeds when inputs are sufficient: deducts inputs, adds output", () => {
    const state = freshState();
    state.homePlanet.storage.commonOre = 25;
    const { next, success } = craftRecipe(state, "refineUnobtainium");
    expect(success).toBe(true);
    expect(next.homePlanet.storage.commonOre).toBe(15);
    expect(next.homePlanet.storage.refinedMaterial).toBe(1);
  });

  it("fails (same state reference) when inputs are insufficient", () => {
    const state = freshState(); // commonOre: 0
    const { next, success } = craftRecipe(state, "refineUnobtainium");
    expect(success).toBe(false);
    expect(next).toBe(state);
  });

  it("supports multi-input recipes, deducting every input listed", () => {
    const state = freshState();
    state.homePlanet.storage.refinedMaterial = 12;
    const { next, success } = craftRecipe(state, "fabricateComponents");
    expect(success).toBe(true);
    expect(next.homePlanet.storage.refinedMaterial).toBe(7);
    expect(next.homePlanet.storage.components).toBe(1);
  });
});
```

**Step 5: Implement `craftRecipe` (`tick.ts`)**

Add `RECIPES`, `type RecipeKey`, `type HomePlanetMaterialKey` to the existing import from `./model`.

```ts
// Validates every input in the recipe is affordable, deducts them all, adds
// the output -- same "same state reference on failure" convention as every
// other buy/action function in this file (dispatchCaptainOnMission,
// recallCaptain). Manual-craft-button only this phase; an auto-craft toggle
// is a deliberate near-term follow-up, not built here.
export function craftRecipe(state: GameState, recipeKey: RecipeKey): { next: GameState; success: boolean } {
  const recipe = RECIPES[recipeKey];
  for (const key of Object.keys(recipe.inputs) as HomePlanetMaterialKey[]) {
    const needed = recipe.inputs[key] ?? 0;
    if (state.homePlanet.storage[key] < needed) return { next: state, success: false };
  }

  const storage = { ...state.homePlanet.storage };
  for (const key of Object.keys(recipe.inputs) as HomePlanetMaterialKey[]) {
    storage[key] -= recipe.inputs[key] ?? 0;
  }
  storage[recipe.output.key] += recipe.output.amount;

  return { next: { ...state, homePlanet: { storage } }, success: true };
}
```

**Step 6: Confirm tests pass**

Trace both craft tests by hand against the implementation above — straightforward arithmetic, no
closed-form/float concerns here (this is a discrete, single-call action, not a tick-accumulation
function).

**Step 7: Commit**

```bash
git add src/lib/game/model.ts src/lib/game/model.test.ts src/lib/game/tick.ts src/lib/game/tick.test.ts
git commit -m "feat: add RECIPES table and craftRecipe(), the Homeworld crafting engine"
```

---

### Task 6: Captain leveling + slot unlocks (`model.ts`, `tick.ts`)

**Files:**
- Modify: `src/lib/game/model.ts`
- Modify: `src/lib/game/model.test.ts`
- Modify: `src/lib/game/tick.ts`
- Modify: `src/lib/game/tick.test.ts`

**Step 1: Add the XP curve and slot-unlock table (`model.ts`)**

```ts
// Open-ended (levels can climb indefinitely) -- a formula, not a table, unlike
// CAPTAIN_SLOT_UNLOCKS below (which is finite and worth hand-tuning per entry).
export function xpForNextLevel(level: number): number {
  return 100 * level;
}

export interface CaptainSlotUnlockDef {
  atLevel: number; // the unlocking captain must be at least this level
  statPointCost: number; // deducted from the unlocking captain's OWN statPoints
  componentsCost: number; // deducted from the shared, fleet-wide homePlanet.storage.components
}

// Ordered by slot number (index 0 = the 2nd captain slot, since slot 1 always
// exists). Small and hand-tunable on purpose -- unlike level count, there are
// only ever a few of these, so a table you can eyeball beats a formula you'd
// have to reverse-engineer. Add entries here (and nowhere else -- tick.ts's
// unlockCaptainSlot reads this by index, App.svelte's leveling panel iterates
// it for display) for a 5th+ slot later.
export const CAPTAIN_SLOT_UNLOCKS: CaptainSlotUnlockDef[] = [
  { atLevel: 3, statPointCost: 2, componentsCost: 5 },
  { atLevel: 6, statPointCost: 4, componentsCost: 15 },
  { atLevel: 10, statPointCost: 6, componentsCost: 40 },
];
```

**Step 2: Write the failing tests (`model.test.ts`)**

```ts
describe("xpForNextLevel", () => {
  it("grows with level (100 at level 1, 200 at level 2)", () => {
    expect(xpForNextLevel(1)).toBe(100);
    expect(xpForNextLevel(2)).toBe(200);
  });
});

describe("CAPTAIN_SLOT_UNLOCKS — launch set", () => {
  it("has 3 entries, each with a positive level/statPoint/components cost", () => {
    expect(CAPTAIN_SLOT_UNLOCKS).toHaveLength(3);
    for (const entry of CAPTAIN_SLOT_UNLOCKS) {
      expect(entry.atLevel).toBeGreaterThan(0);
      expect(entry.statPointCost).toBeGreaterThan(0);
      expect(entry.componentsCost).toBeGreaterThan(0);
    }
  });
});
```

**Step 3: Hook XP into `tickCaptainMission`'s cycle-completion (`tick.ts`)**

Read `tickCaptainMission()`'s full current body first (the closed-form state machine from Phase 3a —
do not disturb its float-drift-tolerance logic). Find the exact point where a full cycle completes
(the `nextIndex >= MISSION_PHASE_ORDER.length` branch, where `homePlanetDelta` is populated from
`mission.cargo`). Add XP there, on the CAPTAIN object being built, not as a separate pass:

```ts
// Inside the nextIndex >= MISSION_PHASE_ORDER.length branch, alongside the
// existing homePlanetDelta accumulation -- one full mission cycle completing
// is the sole XP-awarding event, per the design doc. This needs `captain`'s
// CURRENT xp/level to compute against, so the leveling math has to happen
// where the cycle-completion is detected, not deferred to the caller.
```

The tricky part: `tickCaptainMission`'s `while` loop can complete MULTIPLE full cycles within a
single call (a big offline-catchup `ticksElapsed` — this is exactly what its closed-form guarantee is
for). XP must be awarded once per cycle completed, not once per call, mirroring how `homePlanetDelta`
already accumulates correctly across multiple cycles within one call. Track `xp`/`level`/`statPoints`
as local mutable variables seeded from `captain.xp`/`captain.level`/`captain.statPoints` at the top of
the function (alongside the existing `let mission = ...`), award a flat XP amount (propose `50`, a
placeholder balance value, same spirit as this project's other "launch placeholder, explicitly
tunable" constants) each time a cycle completes, apply `xpForNextLevel()` in a `while (xp >=
xpForNextLevel(level))` loop (an XP jump big enough to cross multiple levels must resolve all of them
in one call, same closed-form spirit as everything else in this function) granting `+1 statPoint`
per level gained, and return the final `xp`/`level`/`statPoints` values as part of the returned
`captain` object.

**Step 4: Write the failing tests for the XP hook (`tick.test.ts`)**

```ts
describe("tickCaptainMission — awards XP on cycle completion", () => {
  it("awards XP once when a cycle completes, not at all otherwise", () => {
    const base = freshCaptains(1)[0];
    base.mission = missionCaptain(); // helper already exists in this file from Phase 3a
    const { captain } = tickCaptainMission(0.5, base, ALWAYS_COMMON_ORE); // mid-cycle, no completion
    expect(captain.xp).toBe(0);
  });

  it("levels up and grants a stat point when accumulated XP crosses the threshold", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain(), phase: "unloading", phaseProgressTicks: 0 };
    base.xp = 90; // needs 100 to reach level 2; this cycle's completion award should push it over
    const { captain } = tickCaptainMission(1, base, ALWAYS_COMMON_ORE);
    expect(captain.level).toBe(2);
    expect(captain.statPoints).toBe(1);
  });

  it("a big jump completing multiple cycles awards XP and levels for EACH cycle, not just one", () => {
    const base = freshCaptains(1)[0];
    base.mission = missionCaptain(); // shortOreRun, 18 ticks/cycle
    const { captain } = tickCaptainMission(36, base, ALWAYS_COMMON_ORE); // exactly 2 full cycles
    // Trace the exact expected xp/level/statPoints against whatever flat
    // award value you actually pick in Step 3 -- do not copy this assertion
    // blindly, recompute it from your own implementation.
  });
});
```

**Step 5: Add `unlockCaptainSlot()` (`tick.ts`)**

```ts
// Spends the unlocking captain's own statPoints plus a shared Components cost
// to append a new captain slot -- replaces the old Skill Tree Command branch.
// Any captain who has reached the required level can do this (not a dedicated
// "admiral" action) -- see design doc. Fails (same state reference) if there's
// no next slot defined, the captain doesn't exist, isn't at the required
// level, or either cost isn't affordable.
export function unlockCaptainSlot(state: GameState, captainId: number): { next: GameState; success: boolean } {
  const slotIndex = state.captains.length - 1; // captains.length IS the current slot count -- no separate counter needed, since nothing resets the roster anymore
  const unlockDef = CAPTAIN_SLOT_UNLOCKS[slotIndex];
  if (!unlockDef) return { next: state, success: false };

  const idx = state.captains.findIndex((c) => c.id === captainId);
  if (idx === -1) return { next: state, success: false };
  const captain = state.captains[idx];
  if (captain.level < unlockDef.atLevel) return { next: state, success: false };
  if (captain.statPoints < unlockDef.statPointCost) return { next: state, success: false };
  if (state.homePlanet.storage.components < unlockDef.componentsCost) return { next: state, success: false };

  const captains = [...state.captains];
  captains[idx] = { ...captain, statPoints: captain.statPoints - unlockDef.statPointCost };
  const nextId = captains.length + 1;
  captains.push({
    id: nextId,
    label: `Captain ${nextId}`,
    shipType: "resourcer",
    ...freshCaptainStack(),
  });

  return {
    next: {
      ...state,
      captains,
      homePlanet: { storage: { ...state.homePlanet.storage, components: state.homePlanet.storage.components - unlockDef.componentsCost } },
    },
    success: true,
  };
}
```

**Step 6: Write the failing tests (`tick.test.ts`)**

```ts
describe("unlockCaptainSlot", () => {
  it("succeeds when level/statPoints/components all meet the next slot's requirement", () => {
    const state = freshState();
    state.captains[0].level = 3;
    state.captains[0].statPoints = 2;
    state.homePlanet.storage.components = 5;
    const { next, success } = unlockCaptainSlot(state, 1);
    expect(success).toBe(true);
    expect(next.captains).toHaveLength(2);
    expect(next.captains[0].statPoints).toBe(0);
    expect(next.homePlanet.storage.components).toBe(0);
  });

  it("fails if the captain isn't high enough level yet", () => {
    const state = freshState();
    state.captains[0].level = 2; // needs 3
    state.captains[0].statPoints = 2;
    state.homePlanet.storage.components = 5;
    const { next, success } = unlockCaptainSlot(state, 1);
    expect(success).toBe(false);
    expect(next).toBe(state);
  });

  it("fails if there's no next slot defined (roster already at the table's max)", () => {
    const state = freshState();
    state.captains = freshCaptains(4); // all 3 CAPTAIN_SLOT_UNLOCKS entries already used
    state.captains[0].level = 999;
    state.captains[0].statPoints = 999;
    state.homePlanet.storage.components = 999;
    const { next, success } = unlockCaptainSlot(state, 1);
    expect(success).toBe(false);
    expect(next).toBe(state);
  });
});
```

**Step 7: Confirm tests pass, trace by hand**

**Step 8: Commit**

```bash
git add src/lib/game/model.ts src/lib/game/model.test.ts src/lib/game/tick.ts src/lib/game/tick.test.ts
git commit -m "feat: add captain XP/leveling and unlockCaptainSlot(), replacing Skill Tree's Command branch"
```

---

### Task 7: Save migration v8 → v9 (`save.ts`)

**Files:**
- Modify: `src/lib/game/save.ts`
- Modify: `src/lib/game/save.test.ts`

**Context:** Read the current `save.ts` in full, including its incident-driven comments. Same
absolute hard rule as always: never edit `MIGRATIONS[1]` through `[7]`'s bodies. This is the first
migration in this project's history to correspond to REMOVED fields, not just added ones — per the
design doc, do NOT attempt to strip the old fields (`modules`, `resources`, `research`,
`captainPoints`, `captainPrestigeCount`, `specialization`, `skillPoints`, `unlockedSkillNodes`,
`augmentPoints`, `prestigeCount`) from an old save's JSON. Once `CaptainState`/`GameState` stop
declaring them, nothing reads them — they become harmless, inert extra properties. This migration's
only real job is backfilling the NEW required fields.

**Step 1: Write the failing tests**

Grep the exact current `SAVE_VERSION` assertion count and value first, do not assume.

```ts
describe("migrate — captain leveling and Homeworld crafting backfill (v8 -> v9)", () => {
  it("backfills xp/level/statPoints on every captain, and refinedMaterial/components on homePlanet storage", () => {
    const legacyState: any = {
      gameTimeSeconds: 5000,
      homePlanet: { storage: { commonOre: 200, uncommonMaterial: 10, rareMaterial: 2 } }, // pre-v9: no refinedMaterial/components keys at all
      captains: [
        {
          id: 1,
          label: "Captain 1",
          shipType: "resourcer",
          tickDurationSeconds: 10,
          mission: null,
          // no xp/level/statPoints -- the real pre-v9 shape
        },
      ],
    };
    const save: SaveFile = { version: 8, created_at: 0, last_saved_at: 0, game_time_seconds: 5000, state: legacyState };
    const migrated: any = migrate(save);
    expect(migrated.captains[0].xp).toBe(0);
    expect(migrated.captains[0].level).toBe(1);
    expect(migrated.captains[0].statPoints).toBe(0);
    expect(migrated.homePlanet.storage.refinedMaterial).toBe(0);
    expect(migrated.homePlanet.storage.components).toBe(0);
    expect(migrated.homePlanet.storage.commonOre).toBe(200); // untouched fields survive
  });

  it("current SAVE_VERSION is 9", () => {
    expect(SAVE_VERSION).toBe(9);
  });
});
```

Update (or replace, per this file's own established precedent of retiring the prior chained test in
favor of a strict superset — find the NOTE comments from the v7/v8 transitions and follow the same
pattern) the chained migration test to walk all 8 steps, v1 → v9.

**Step 2: Implement**

```ts
  8: (state: any): GameState => ({
    ...state,
    captains: state.captains.map((c: any) => ({
      ...c,
      xp: c.xp ?? 0,
      level: c.level ?? 1,
      statPoints: c.statPoints ?? 0,
    })),
    homePlanet: {
      storage: {
        ...state.homePlanet.storage,
        refinedMaterial: state.homePlanet.storage.refinedMaterial ?? 0,
        components: state.homePlanet.storage.components ?? 0,
      },
    },
  }),
```

Bump `SAVE_VERSION` to `9`. Add a file-header comment block above `MIGRATIONS` describing this step,
matching the existing per-migration documentation convention exactly (read the v7→v8 comment
immediately above it as your template).

**Step 3: Confirm tests pass, trace by hand**

**Step 4: Commit**

```bash
git add src/lib/game/save.ts src/lib/game/save.test.ts
git commit -m "feat: migrate save schema v8->v9, backfill captain leveling and Homeworld crafting fields"
```

---

### Task 8: UI — Homeworld crafting panels, Captain Leveling panel, Export Save (`App.svelte`)

**Files:**
- Modify: `src/App.svelte`

**Step 1: Add craft handlers**

```ts
function doCraftRecipe(recipeKey: RecipeKey) {
  const { next, success } = craftRecipe(state, recipeKey);
  if (!success) return;
  state = next;
  pushLog(`Crafted: ${RECIPES[recipeKey].label}.`);
  doSave();
}

function doUnlockCaptainSlot() {
  const captain = activeCaptain;
  const { next, success } = unlockCaptainSlot(state, captain.id);
  if (!success) return;
  state = next;
  pushLog(`[${captain.label}] Spent stat points and Components to unlock a new captain slot.`);
  doSave();
}
```

Add `craftRecipe`, `unlockCaptainSlot` to the import from `./lib/game/tick`; add `RECIPES`,
`type RecipeKey`, `xpForNextLevel`, `CAPTAIN_SLOT_UNLOCKS` to the import from `./lib/game/model`.

**Step 2: Add REFINERY and FABRICATION panels under the `homeworld` tab**

One panel per structure, each showing its single recipe's inputs/output, current affordability
(compare `state.homePlanet.storage[inputKey]` against the required amount for every input in
`recipe.inputs`), and a Craft button — follow this file's existing `disabled`/`opacity` affordability
pattern (see the old GENERATOR STACK panel's `buy-btn` for the exact idiom, even though that panel
itself is gone — same visual convention applies here).

**Step 3: Add the CAPTAIN LEVELING panel under `fleetOps`, in the spot Captain Prestige used to
occupy**

Show `activeCaptain.level`, an XP bar (`activeCaptain.xp / xpForNextLevel(activeCaptain.level)`,
same `research-bar-track`/`research-bar-fill` CSS idiom already used for Mission/Research progress),
`activeCaptain.statPoints`, and — only if `CAPTAIN_SLOT_UNLOCKS[state.captains.length - 1]` exists
(i.e. there IS a next slot to unlock) — that slot's requirement (level/statPoint/Components cost)
and an Unlock button wired to `doUnlockCaptainSlot`, disabled/dimmed when unaffordable by the SAME
convention as everything else.

**Step 4: Wire up Export Save under `system`**

`exportRawSave()` already exists in `save.ts` (unused until now — confirm this yourself by grepping
`App.svelte` for it before assuming). Add an Export Save button:

```ts
function doExportSave() {
  const raw = exportRawSave();
  if (!raw) return;
  const blob = new Blob([raw], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `fleet-admiral-save-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
```

Add `exportRawSave` to the existing import from `./lib/game/save`.

**Step 5: Manual verification (no automated test — UI markup, Node unavailable)**

Confirm both Homeworld panels correctly gate on their recipe's FULL input list (not just the first
input, for `fabricateComponents` which has only one input today but the affordability check should
still generically loop `Object.entries(recipe.inputs)` so it doesn't silently break if a future
recipe has 2+ inputs). Confirm the Captain Leveling panel's Unlock button is correctly ABSENT (not
just disabled) when `state.captains.length` has already reached `CAPTAIN_SLOT_UNLOCKS.length + 1`
(no more slots defined).

**Step 6: Commit**

```bash
git add src/App.svelte
git commit -m "feat: add Refinery/Fabrication/Captain Leveling panels and Export Save"
```

---

### Task 9: Docs and final commit

**Files:**
- Modify: `SESSION_LOG.md`
- Modify: `KNOWN_ISSUES.md` (only if warranted)

**Step 1: Check `KNOWN_ISSUES.md`**

Consider whether the flat XP-per-cycle-completion award (Task 6, a launch placeholder like several
other numeric constants this project has shipped) is worth flagging as a future balance pass, and
whether the now-simplified `tick()` (idle captains doing nothing) has any interaction with the
existing "backgrounded tab loses uncredited cycles" KNOWN_ISSUES entry worth a one-line update
(it likely no longer applies to idle captains at all now, only mission captains — which that entry
was already updated to cover during Phase 3a).

**Step 2: Append a session log entry**

Read `SESSION_LOG.md`'s most recent entries for format/tone. Verify the actual commit count on this
branch against this plan's task structure before writing — count what genuinely happened, not what
this plan assumed would happen (this plan may itself pick up review-driven fixes along the way,
exactly like Phase 3a did three separate times).

**Step 3: Commit**

```bash
git add SESSION_LOG.md KNOWN_ISSUES.md
git commit -m "docs: log Phase 4 navigation restructuring & progression overhaul session"
```

**Step 4: Do not push.** Pushing to `origin/main` triggers a live Vercel production redeploy and
needs the user's explicit go-ahead first.
