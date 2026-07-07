# UI Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Collapse per-captain tick cadence into one true fleet-wide tick, then rebuild the UI around
a global always-on-top header (Fleet Admiral level/XP + the new global tick) and a 6-tab bottom nav
with per-tab sub-tabs, including a captain-list-driven Fleet Captain's tab and a mission-first Fleet
Operations tab.

**Architecture:** Tasks 1-4 are a self-contained mechanics change (global tick) with its own save
migration, landed and verified BEFORE any UI work starts, so there's a clean checkpoint. Tasks 5-11
are pure layout: a new reusable `<SubTabs>` component, a new fixed header bar, a 6-tab bottom nav,
and per-tab reorganization that relocates existing panel content without touching its logic (except
Fleet Operations, which reorganizes existing mission dispatch/recall around a mission-first view).

**Tech Stack:** Svelte 5 (non-runes: plain `let`/`$:`, `<slot />`), TypeScript, Vitest (configured but
unexecutable — no Node/npm/tsc in this environment; every verification step is manual code tracing).

**Design doc:** `docs/plans/2026-07-07-ui-redesign-design.md`.

---

## Read this before starting

Tasks 1-3 (the global tick collapse) are **HIGH RISK**: `tickDurationSeconds` is read/tested across
`model.ts`, `tick.ts`, `App.svelte`, and three `.test.ts` files. Grep the whole `src/` tree for
`tickDurationSeconds` yourself before touching anything (don't trust this plan's file list to be
exhaustive — grep it fresh). Task 4 (save migration) touches the absolute hard rule of this
codebase: once shipped, a migration body is NEVER edited, only new numbered entries added.

Task 9 (Fleet Operations) changes `doDispatchCaptainOnMission`/`doRecallCaptain`'s signatures from
"always target `activeCaptain`" to "target an explicit captain" — grep every call site in
`App.svelte` before changing them (there are 2 today: the existing Fleet Ops mission panel, which
this task's Task 6/8 relocation removes anyway).

---

### Task 1: Move `tickDurationSeconds` from `CaptainState` to `GameState` — HIGH RISK

**Files:**
- Modify: `src/lib/game/model.ts`
- Modify: `src/lib/game/model.test.ts`

**Step 1: Write the failing tests**

Replace the two tests that assert `tickDurationSeconds` on a captain/stack:

```ts
// In "freshState — captain roster shape", replace the existing
// "starts with tickDurationSeconds 10 and xp:0, level:1, statPoints:0" test with:
it("starts with xp:0, level:1, statPoints:0 per captain, and fleet-wide tickDurationSeconds 10", () => {
  const state = freshState();
  for (const c of state.captains) {
    expect(c.xp).toBe(0);
    expect(c.level).toBe(1);
    expect(c.statPoints).toBe(0);
  }
  expect(state.tickDurationSeconds).toBe(10);
});
```

```ts
// In "freshCaptainStack — shared reset baseline", replace the existing
// "returns the baseline a brand-new captain slot starts with" test with:
it("returns the baseline a brand-new captain slot starts with (no tickDurationSeconds -- that's fleet-wide now)", () => {
  const stack = freshCaptainStack();
  expect(stack.mission).toBe(null);
  expect(stack.xp).toBe(0);
  expect(stack.level).toBe(1);
  expect(stack.statPoints).toBe(0);
  expect((stack as any).tickDurationSeconds).toBeUndefined();
});
```

**Step 2: Confirm the tests would fail**

`state.tickDurationSeconds` doesn't exist yet (still per-captain) — confirm by inspection of the
current `model.ts`.

**Step 3: Write the implementation**

In `src/lib/game/model.ts`:

1. Remove the `tickDurationSeconds: number; // this captain's own tick-bar cycle length; cadences can diverge between captains`
   line from `CaptainState` (currently right after `shipType: ShipType;`).
2. Add to `GameState` (after `captains: CaptainState[];`):
   ```ts
   tickDurationSeconds: number; // fleet-wide tick cadence -- every captain advances in lockstep on this single cadence (collapsed from a per-captain field during the UI Redesign; see docs/plans/2026-07-07-ui-redesign-design.md)
   ```
3. In `freshCaptainStack()`: remove `"tickDurationSeconds"` from the `Pick<...>` type and remove
   `tickDurationSeconds: 10,` from the returned object.
4. In `freshState()`: add `tickDurationSeconds: 10,` to the returned object (alongside
   `gameTimeSeconds: 0,`).

**Step 4: Confirm tests pass, trace by hand**

**Step 5: Commit**

```bash
git add src/lib/game/model.ts src/lib/game/model.test.ts
git commit -m "refactor: move tickDurationSeconds from CaptainState to GameState (fleet-wide tick)"
```

---

### Task 2: Update `tick()`'s mission math to use the fleet-wide cadence — HIGH RISK

**Files:**
- Modify: `src/lib/game/tick.ts`
- Modify: `src/lib/game/tick.test.ts`

**Context:** `tick()` currently computes `ticksElapsed = deltaSeconds / captain.tickDurationSeconds`
per captain inside its `captains.map(...)` loop. After Task 1, that field no longer exists on
`CaptainState` — it must read `state.tickDurationSeconds` once, outside the loop, and reuse the same
value for every captain (this is now uniform across the fleet by design).

**Step 1: Update the failing/breaking tests**

- Line ~229 in `tick.test.ts` (inside `"an idle captain (mission: null) is returned completely
  unchanged"`) currently asserts `expect(result.captains[0].tickDurationSeconds).toBe(before.tickDurationSeconds);`
  — delete this line entirely (the field no longer exists on `CaptainState`).
- The two comments at lines ~266 and ~342 that say `tickDurationSeconds=10, deltaSeconds=10 ->
  ticksElapsed=1` are still arithmetically correct (10/10=1) but should be reworded to say
  `state.tickDurationSeconds=10` instead of implying it's per-captain, so a future reader isn't
  confused about where the value now lives. Update the wording only, not the numbers.
- Every test in this file that calls `tick(deltaSeconds, state)` relies on `freshState()`'s new
  `tickDurationSeconds: 10` default (from Task 1) — no other test changes should be needed, since the
  actual arithmetic (10-second cadence) is unchanged, only WHERE the 10 comes from.

**Step 2: Confirm the tests would fail**

`tick.ts` still reads `captain.tickDurationSeconds`, which is now `undefined` post-Task-1 — every
`tick()` call would produce `NaN` ticksElapsed. Confirm by inspection.

**Step 3: Write the implementation**

In `src/lib/game/tick.ts`'s `tick()` function, change:

```ts
export function tick(deltaSeconds: number, state: GameState): GameState {
  if (deltaSeconds <= 0) return state;

  const homePlanetDelta = emptyLootTotals();
  const captains = state.captains.map((captain) => {
    if (captain.mission === null) return captain;
    const ticksElapsed = deltaSeconds / captain.tickDurationSeconds;
    const { captain: updated, homePlanetDelta: delta } = tickCaptainMission(ticksElapsed, captain);
```

to:

```ts
export function tick(deltaSeconds: number, state: GameState): GameState {
  if (deltaSeconds <= 0) return state;

  // Fleet-wide cadence (moved off CaptainState during the UI Redesign -- see
  // docs/plans/2026-07-07-ui-redesign-design.md) -- read ONCE, applied
  // uniformly to every captain below, rather than each captain reading its
  // own field.
  const ticksElapsed = deltaSeconds / state.tickDurationSeconds;
  const homePlanetDelta = emptyLootTotals();
  const captains = state.captains.map((captain) => {
    if (captain.mission === null) return captain;
    const { captain: updated, homePlanetDelta: delta } = tickCaptainMission(ticksElapsed, captain);
```

(the rest of the function body is unchanged — `ticksElapsed` is now computed once above the `.map`
instead of inside it).

Also update the comment on `tickCaptainMission` itself (around line 71-75) that says *"it's the
caller's job (tick(), in this same file) to convert deltaSeconds into ticksElapsed by dividing by the
captain's own tickDurationSeconds"* — change "the captain's own tickDurationSeconds" to "the fleet's
shared tickDurationSeconds", since `tickCaptainMission` itself is untouched (it still just takes a
plain `ticksElapsed` number and doesn't care where it came from) but the comment's phrasing is now
stale.

**Step 4: Confirm tests pass, trace by hand**

**Step 5: Commit**

```bash
git add src/lib/game/tick.ts src/lib/game/tick.test.ts
git commit -m "refactor: compute ticksElapsed once from the fleet-wide tickDurationSeconds"
```

---

### Task 3: Save migration v10→v11 — HIGH RISK

**Files:**
- Modify: `src/lib/game/save.ts`
- Modify: `src/lib/game/save.test.ts`

**Step 1: Confirm the current `SAVE_VERSION`** by grepping `save.ts` — expected 10 as of this plan's
writing, but verify, don't assume.

**Step 2: Write the failing tests**

Add a new standalone describe block (following this file's established per-migration test pattern —
read the v9→v10 block immediately above it for the exact style/wording convention to match):

```ts
describe("migrate — fleet-wide tickDurationSeconds backfill (v10 -> v11)", () => {
  it("reads tickDurationSeconds off the first captain and strips it from every captain", () => {
    // A genuine pre-v11 shape: every captain still carries its own
    // tickDurationSeconds (the per-captain era, before the UI Redesign
    // collapsed it fleet-wide), and GameState has no top-level
    // tickDurationSeconds at all.
    const legacyState: any = {
      gameTimeSeconds: 500,
      homePlanet: { storage: { commonOre: 10, uncommonMaterial: 0, rareMaterial: 0, refinedMaterial: 0, components: 0 } },
      unlockedHomeworldTalents: [],
      fleetAdminXp: 0,
      fleetAdminLevel: 1,
      adminPoints: 0,
      captains: [
        { id: 1, label: "Captain 1", shipType: "resourcer", tickDurationSeconds: 10, mission: null, xp: 0, level: 1, statPoints: 0, unlockedCaptainTalents: [] },
        { id: 2, label: "Captain 2", shipType: "resourcer", tickDurationSeconds: 10, mission: null, xp: 0, level: 1, statPoints: 0, unlockedCaptainTalents: [] },
      ],
    };

    const save: SaveFile = { version: 10, created_at: 0, last_saved_at: 0, game_time_seconds: 500, state: legacyState };
    const migrated: any = migrate(save);

    expect(migrated.tickDurationSeconds).toBe(10);
    expect(migrated.captains[0].tickDurationSeconds).toBeUndefined();
    expect(migrated.captains[1].tickDurationSeconds).toBeUndefined();

    // Unrelated pre-existing fields survive the backfill untouched.
    expect(migrated.captains[0].id).toBe(1);
    expect(migrated.gameTimeSeconds).toBe(500);
    expect(migrated.homePlanet.storage.commonOre).toBe(10);
  });

  it("defaults to 10 if the first captain has no tickDurationSeconds at all (defense in depth, not reachable today)", () => {
    const legacyState: any = {
      gameTimeSeconds: 0,
      homePlanet: { storage: { commonOre: 0, uncommonMaterial: 0, rareMaterial: 0, refinedMaterial: 0, components: 0 } },
      unlockedHomeworldTalents: [],
      fleetAdminXp: 0,
      fleetAdminLevel: 1,
      adminPoints: 0,
      captains: [{ id: 1, label: "Captain 1", shipType: "resourcer", mission: null, xp: 0, level: 1, statPoints: 0, unlockedCaptainTalents: [] }],
    };
    const save: SaveFile = { version: 10, created_at: 0, last_saved_at: 0, game_time_seconds: 0, state: legacyState };
    const migrated: any = migrate(save);
    expect(migrated.tickDurationSeconds).toBe(10);
  });

  it("current SAVE_VERSION is 11", () => {
    expect(SAVE_VERSION).toBe(11);
  });
});
```

Retire the existing `"migrate — chained v1 -> v10 migration"` describe block with a NOTE comment
matching this file's established retirement precedent (there are 5+ prior examples — v1→v4 through
v1→v10 — match their exact wording/placement style), and add a new `"migrate — chained v1 -> v11
migration"` block that's the old one extended one more step, asserting the new
`migrated.tickDurationSeconds` and `migrated.captains[0].tickDurationSeconds`/`captains[1].tickDurationSeconds`
being stripped, alongside every existing assertion in that chained test.

**Step 3: Implement**

Add to the `MIGRATIONS` object in `save.ts` (after `9: ...`):

```ts
  10: (state: any): GameState => {
    // v10 -> v11: UI Redesign (docs/plans/2026-07-07-ui-redesign-plan.md,
    // Task 3). Collapses tickDurationSeconds from per-captain (where it lived
    // since MIGRATIONS[4]'s Multi-Captain Stacks split) back to a single
    // fleet-wide field on GameState -- every captain now advances on the same
    // shared cadence (see the design doc for why). Reads the value off the
    // FIRST captain (any pre-v11 save's captains all share the same value --
    // nothing has ever diverged them) as the new fleet-wide default, then
    // strips the now-removed field from every captain via destructuring
    // (same "delete via destructure" idiom MIGRATIONS[4] used when it moved
    // fields IN the other direction). Falls back to 10 if captains[0] somehow
    // has no tickDurationSeconds at all -- not reachable through any current
    // code path (freshCaptainStack always set it pre-v11), but defense in
    // depth, same category as several earlier migrations' `??` comments.
    const tickDurationSeconds = state.captains[0]?.tickDurationSeconds ?? 10;
    return {
      ...state,
      tickDurationSeconds,
      captains: state.captains.map((c: any) => {
        const { tickDurationSeconds: _unused, ...rest } = c;
        return rest;
      }),
    };
  },
```

Bump `SAVE_VERSION` to `11`. Add a file-header comment entry (matching the existing per-migration
convention at the top of the file) documenting the v10→v11 step.

**Step 4: Confirm tests pass, trace by hand.**

**Step 5: Commit**

```bash
git add src/lib/game/save.ts src/lib/game/save.test.ts
git commit -m "feat: migrate tickDurationSeconds from per-captain to fleet-wide (v10 -> v11)"
```

---

### Task 4: Live poll loop — collapse `captainCycles` into one shared cycle

**Files:**
- Modify: `src/App.svelte`

**Context:** This is the last piece of the mechanics change, and the riskiest UI-side edit in this
plan — read the ENTIRE current `onMount`'s tick-bar loop (including the `speed === 0`/`paused`
branches) before touching it. `<script>` changes only in this task; no markup/CSS yet.

**Step 1: Remove the per-captain cycle map**

Delete the `CaptainCycle` interface, the `captainCycles: Record<number, CaptainCycle>` variable, and
the `ensureCaptainCycles()` function. Replace with a single shared cycle:

```ts
let cycle: { barCycleStart: number; nowTick: number } = { barCycleStart: Date.now(), nowTick: Date.now() };
```

**Step 2: Rewrite the tick loop body**

Replace the `tickHandle = setInterval(...)` callback's body. The per-captain `barSeconds`/`progress`
check inside the `for` loop goes away entirely — there's now ONE shared progress check, and when it
completes, EVERY captain with an active mission advances together (using the same `ticksElapsed`,
since the cadence is now uniform):

```ts
    tickHandle = setInterval(() => {
      const now = Date.now();

      if (speed === 0) {
        paused = true;
        lastPollTime = now;
        return;
      }

      if (paused) {
        lastPollTime = now;
        cycle.barCycleStart = now;
        paused = false;
        return;
      }

      const realElapsedSeconds = (now - lastPollTime) / 1000;
      lastPollTime = now;
      state = { ...state, gameTimeSeconds: state.gameTimeSeconds + realElapsedSeconds * speed };

      const barSeconds = Math.max(1, state.tickDurationSeconds / speed);
      cycle.nowTick = now;
      const progress = (now - cycle.barCycleStart) / 1000 / barSeconds;

      if (progress >= 1) {
        const gameSecondsThisCycle = barSeconds * speed;
        const ticksElapsed = gameSecondsThisCycle / state.tickDurationSeconds;

        let captains = state.captains;
        let anyFired = false;
        let anyLootDelivered = false;
        const homePlanetDelta: Record<LootMaterialKey, number> = { commonOre: 0, uncommonMaterial: 0, rareMaterial: 0 };

        for (let i = 0; i < captains.length; i++) {
          const captain = captains[i];
          if (captain.mission === null) continue;
          if (!anyFired) {
            captains = [...captains];
            anyFired = true;
          }
          const { captain: updatedCaptain, homePlanetDelta: delta } = tickCaptainMission(ticksElapsed, captain);
          captains[i] = updatedCaptain;
          if (delta.commonOre !== 0 || delta.uncommonMaterial !== 0 || delta.rareMaterial !== 0) {
            anyLootDelivered = true;
            homePlanetDelta.commonOre += delta.commonOre;
            homePlanetDelta.uncommonMaterial += delta.uncommonMaterial;
            homePlanetDelta.rareMaterial += delta.rareMaterial;
          }
        }

        cycle.barCycleStart = now;

        if (anyFired) {
          state = { ...state, captains };
        }
        if (anyLootDelivered) {
          state = {
            ...state,
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
      }

      state = recomputeFleetAdmin(state);
    }, 100);
```

Notes on what changed vs. the old per-captain version, so the diff is easy to review:
- `barSeconds`/`progress`/`ticksElapsed` are now computed ONCE per poll (outside any per-captain
  loop), from `state.tickDurationSeconds`, not `captain.tickDurationSeconds`.
- The per-captain loop no longer checks each captain's OWN cycle — it unconditionally advances every
  mission captain by the same `ticksElapsed` whenever the ONE shared `progress >= 1`.
- `cycle.barCycleStart = now` resets once (outside the loop), not per-captain.
- `ensureCaptainCycles(now)` calls are removed (there's nothing to "ensure" anymore — `cycle` is a
  single object initialized once, not a map keyed by captain id that grows as captains are added).
- `recomputeFleetAdmin(state)` at the end is unchanged from before.

**Step 3: Update the reactive statements that read the old per-captain cycle**

Delete these 4 lines (they'll be replaced by global equivalents in Task 6, since they're needed by
the new header bar, not deleted outright — but remove them here since `captainCycles`/`activeCaptain`
per-captain lookup no longer applies):

```ts
$: activeCycle = captainCycles[activeCaptain?.id] ?? { barCycleStart: Date.now(), nowTick: Date.now() };
$: activeBarSeconds = Math.max(1, (activeCaptain?.tickDurationSeconds ?? 10) / (speed || 1));
$: activeTickProgress = Math.min(1, Math.max(0, (activeCycle.nowTick - activeCycle.barCycleStart) / 1000 / activeBarSeconds));
$: activeTickRemaining = Math.max(0, activeBarSeconds * (1 - activeTickProgress));
```

Replace with global equivalents (consumed by Task 6's header bar):

```ts
$: globalBarSeconds = Math.max(1, state.tickDurationSeconds / (speed || 1));
$: globalTickProgress = Math.min(1, Math.max(0, (cycle.nowTick - cycle.barCycleStart) / 1000 / globalBarSeconds));
$: globalTickRemaining = Math.max(0, globalBarSeconds * (1 - globalTickProgress));
```

**Step 4: Update `onMount`'s setup**

Remove the `ensureCaptainCycles(lastPollTime);` call in `onMount` (right after `lastPollTime =
Date.now();`) — replace with `cycle = { barCycleStart: lastPollTime, nowTick: lastPollTime };`.

**Step 5: Manual verification (no test runner)**

Hand-trace: with `speed=1`, `state.tickDurationSeconds=10`, and 2 captains both on missions, confirm
a poll where `progress >= 1` advances BOTH captains by the same `ticksElapsed` (1, since
`gameSecondsThisCycle = barSeconds*speed = 10*1 = 10`, `ticksElapsed = 10/10 = 1`) — matching the old
per-captain behavior exactly when all captains shared cadence 10 (which they always did, since
nothing ever diverged it), so this is behavior-preserving for every save that exists today.

**Step 6: Commit**

```bash
git add src/App.svelte
git commit -m "refactor: collapse per-captain tick cycles into one shared fleet-wide cycle"
```

---

### Task 5: `<SubTabs>` component

**Files:**
- Create: `src/lib/SubTabs.svelte`

**Step 1: Write the component**

```svelte
<script lang="ts">
  export let tabs: { key: string; label: string }[];
  export let active: string;
  export let onSelect: (key: string) => void;
</script>

<div class="sub-tabs">
  {#each tabs as tab}
    <button class="sub-tab" class:active={active === tab.key} on:click={() => onSelect(tab.key)}>
      {tab.label}
    </button>
  {/each}
</div>

<style>
  .sub-tabs { display: flex; gap: 6px; margin-bottom: 14px; flex-wrap: wrap; }
  /* Lighter/smaller variant of App.svelte's .captain-tab -- same visual
     language (rounded pill, accent-tinted background/border), scaled down
     since this can appear multiple times per screen (unlike the single
     top-level bottom nav). */
  .sub-tab {
    background: rgba(var(--color-accent-rgb), 0.05);
    border: 1px solid rgba(var(--color-accent-rgb), 0.16);
    border-radius: 6px;
    padding: 6px 10px;
    color: var(--color-text-secondary);
    font-size: 11px;
    cursor: pointer;
  }
  .sub-tab.active {
    background: rgba(var(--color-accent-rgb), 0.14);
    color: var(--color-accent-bright);
    border-color: var(--color-accent);
  }
</style>
```

A plain callback prop (`onSelect`), not `createEventDispatcher` — matches this codebase's existing
simplicity (no component anywhere uses the dispatcher pattern; `Panel.svelte` has no interactivity at
all, and every click handler in `App.svelte` is a plain inline arrow function).

**Step 2: Manual verification (no test runner, no compiler)**

Re-read the file once written: confirm `tabs`/`active`/`onSelect` prop names have no typos, confirm
the `class:active={active === tab.key}` comparison reads correctly, confirm CSS class names don't
collide with existing global class names in `App.svelte`'s `<style>` block (checked: no existing
`.sub-tab`/`.sub-tabs` class exists there).

**Step 3: Commit**

```bash
git add src/lib/SubTabs.svelte
git commit -m "feat: add reusable SubTabs component"
```

---

### Task 6: Global header bar (Fleet Admiral stats + global tick)

**Files:**
- Modify: `src/App.svelte`

**Step 1: Add the markup**

Immediately after the `<Panel class="header">...</Panel>` block (the existing `FLEET ADMIRAL` title
panel) and BEFORE `<main class="main">`, add:

```svelte
    <div class="top-bar">
      <div class="top-bar-row">
        <span class="top-bar-label">Fleet Admiral · Level {state.fleetAdminLevel}</span>
        <span class="top-bar-value">{formatNumber(state.fleetAdminXp)} / {formatNumber(xpForNextFleetAdminLevel(state.fleetAdminLevel))} XP</span>
      </div>
      <div class="research-bar-track">
        <div class="research-bar-fill" style="width:{Math.min(100, (state.fleetAdminXp / xpForNextFleetAdminLevel(state.fleetAdminLevel)) * 100)}%"></div>
      </div>
      <div class="tick-bar-track">
        <div class="tick-bar-fill" style="width:{globalTickProgress * 100}%"></div>
      </div>
      <div class="tick-bar-readout">{globalTickRemaining.toFixed(1)}s</div>
    </div>
```

Add `xpForNextFleetAdminLevel` to the existing import from `./lib/game/model` (it's not currently
imported in `App.svelte` — check the existing import list first, since `xpForNextLevel` already is).

**Step 2: Delete the old per-captain TICK panel**

Remove this entire block (currently the first thing inside `<main class="main">`, right after
`.nav-tabs`):

```svelte
      <Panel>
        <div class="panel-title">TICK — {activeCaptain?.label ?? ""}</div>
        <div class="tick-bar-track">
          <div class="tick-bar-fill" style="width:{activeTickProgress * 100}%"></div>
        </div>
        <div class="tick-bar-readout">{activeTickRemaining.toFixed(1)}s</div>
      </Panel>
```

(This is fully superseded by the new `.top-bar`'s own tick bar from Step 1, which is fleet-wide, not
captain-scoped, matching Task 4's mechanics change.)

**Step 3: Add CSS**

```css
  /* Fixed to the TOP of the viewport, mirroring .nav-tabs' fixed-to-bottom
     treatment -- "always on top" per the design doc, visible regardless of
     which tab/sub-tab is active. Sits below the (non-fixed, scrolls-away)
     FLEET ADMIRAL title panel in document order, but visually pins above it
     once that panel scrolls out of view. */
  .top-bar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 50;
    background: var(--color-panel-bg-strong);
    border-bottom: 1px solid rgba(var(--color-accent-rgb), 0.3);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
    padding: 10px 16px;
    /* Devices with a notch/status-bar inset reserve a safe area at the TOP of
       the screen -- this bar sits flush against it (position: fixed, top: 0),
       so its own top padding needs to grow to clear that inset, same pattern
       as .nav-tabs' bottom padding already handles for the bottom inset. */
    padding-top: calc(10px + env(safe-area-inset-top, 0px));
  }
  .top-bar-row { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px; }
  .top-bar-label { font-size: 11px; letter-spacing: 0.5px; color: var(--color-accent); text-transform: uppercase; }
  .top-bar-value { font-family: var(--font-mono); font-size: 11px; color: var(--color-text-secondary); }
```

**Step 4: Grow `.frame`'s top padding to clear the new bar**

Change `.frame`'s `padding` from:

```css
    padding: 20px 16px calc(96px + env(safe-area-inset-bottom, 0px));
```

to:

```css
    /* Top padding grows to clear the new fixed .top-bar (added in the UI
       Redesign) -- mirrors how the bottom padding already clears the fixed
       .nav-tabs bar below. 90px is a generous estimate of .top-bar's real
       height (2 rows of text + 2 progress bars + padding); this is the one
       piece of this plan that genuinely benefits from a live-device check
       once deployed, since pixel-exact panel heights can't be verified
       without a renderer in this environment -- flag as such in the PR/
       session log if it's ever visibly off. */
    padding: calc(90px + env(safe-area-inset-top, 0px)) 16px calc(96px + env(safe-area-inset-bottom, 0px));
```

**Step 5: Remove now-dead reactive statements / imports**

`activeCycle`/`activeBarSeconds`/`activeTickProgress`/`activeTickRemaining` were already removed in
Task 4 Step 3 — confirm they're gone (this task only ADDS the new header, it doesn't re-touch those).

**Step 6: Manual verification (no test runner)**

Re-read the full file once edited: confirm `globalTickProgress`/`globalTickRemaining` (from Task 4)
are correctly referenced in the new markup, confirm `xpForNextFleetAdminLevel` is imported, confirm
no leftover reference to the deleted TICK panel's `activeCaptain?.label` remains anywhere.

**Step 7: Commit**

```bash
git add src/App.svelte
git commit -m "feat: add global always-on-top header (Fleet Admiral level/XP + global tick)"
```

---

### Task 7: Bottom nav restructuring (6 tabs)

**Files:**
- Modify: `src/App.svelte`

**Step 1: Update `TabKey` and the nav markup**

Change:

```ts
  type TabKey = "homeworld" | "sectorSpace" | "fleetOps" | "battlespace" | "system";
  let activeTab: TabKey = "fleetOps";
```

to:

```ts
  type TabKey = "homeworld" | "sectorSpace" | "fleetCaptains" | "fleetOperations" | "battlespace" | "system";
  let activeTab: TabKey = "fleetCaptains";
```

Change the `.nav-tabs` button row from 5 buttons to 6:

```svelte
      <div class="nav-tabs">
        <button class="nav-tab" class:active={activeTab === "homeworld"} on:click={() => (activeTab = "homeworld")}>Homeworld</button>
        <button class="nav-tab" class:active={activeTab === "sectorSpace"} on:click={() => (activeTab = "sectorSpace")}>Sector Space</button>
        <button class="nav-tab" class:active={activeTab === "fleetCaptains"} on:click={() => (activeTab = "fleetCaptains")}>Fleet Captain's</button>
        <button class="nav-tab" class:active={activeTab === "fleetOperations"} on:click={() => (activeTab = "fleetOperations")}>Fleet Operations</button>
        <button class="nav-tab" class:active={activeTab === "battlespace"} on:click={() => (activeTab = "battlespace")}>Battlespace</button>
        <button class="nav-tab" class:active={activeTab === "system"} on:click={() => (activeTab = "system")}>System</button>
      </div>
```

Do NOT change the existing `{#if activeTab === "..."}` content blocks yet — this task is ONLY the
tab list/state, so the old `{#if activeTab === "fleetOps"}` block (which still references the OLD
tab key) will be a dangling, unreachable block until Tasks 8-9 replace it. That's fine and expected
for one commit — the next two tasks fix it. Note this explicitly in your self-review so it isn't
mistaken for an oversight if reviewed task-by-task.

**Step 2: Manual verification**

Confirm `TabKey`'s 6 literals match the 6 button `on:click` targets exactly (no typos — this is a
union type, so a typo here is a silent runtime bug, not a compile error, since there's no `tsc` to
catch it in this environment).

**Step 3: Commit**

```bash
git add src/App.svelte
git commit -m "refactor: bottom nav becomes 6 tabs (split Fleet Ops into Fleet Captain's / Fleet Operations)"
```

---

### Task 8: Fleet Captain's tab (left captain list + Overview/Talents sub-tabs)

**Files:**
- Modify: `src/App.svelte`

**Context:** This task REPLACES the old `{#if activeTab === "fleetOps"}` block (left dangling by
Task 7) with two things: the new `{#if activeTab === "fleetCaptains"}` block, and relocates the
existing CAPTAIN LEVELING + CAPTAIN TALENTS panel content into it (unchanged content, new
surrounding layout). The MISSIONS panel from the old block moves to Task 9 instead (Fleet
Operations) — do NOT relocate it here.

**Step 1: Add sub-tab state**

```ts
  type FleetCaptainSubTab = "overview" | "talents";
  let activeFleetCaptainSubTab: FleetCaptainSubTab = "overview";
```

**Step 2: Replace the old Fleet Ops block**

Delete the entire `{#if activeTab === "fleetOps"} ... {/if}` block (currently contains: the
`.captain-tabs` row, the MISSIONS panel, the CAPTAIN LEVELING panel, the CAPTAIN TALENTS panel).

Replace with:

```svelte
      {#if activeTab === "fleetCaptains"}
      <SubTabs
        tabs={[{ key: "overview", label: "Overview" }, { key: "talents", label: "Talents" }]}
        active={activeFleetCaptainSubTab}
        onSelect={(key) => (activeFleetCaptainSubTab = key as FleetCaptainSubTab)}
      />

      <div class="fleet-captains-layout">
        <div class="captain-list">
          {#each state.captains as captain, i}
            <button class="captain-list-item" class:active={i === activeCaptainIndex} on:click={() => (activeCaptainIndex = i)}>
              {captain.label}
            </button>
          {/each}
        </div>

        <div class="fleet-captains-content">
          {#if activeFleetCaptainSubTab === "overview"}
            <Panel>
              <div class="panel-title">CAPTAIN LEVELING</div>
              <div class="research-name">Level {activeCaptain.level}</div>
              <div class="research-bar-track">
                <div class="research-bar-fill" style="width:{Math.min(100, (activeCaptain.xp / xpForNextLevel(activeCaptain.level)) * 100)}%"></div>
              </div>
              <div class="research-readout">{formatNumber(activeCaptain.xp)} / {formatNumber(xpForNextLevel(activeCaptain.level))} XP</div>
              <div class="research-cost">Stat Points: {formatNumber(activeCaptain.statPoints)}</div>
              <div class="research-cost">
                {#if activeCaptain.mission === null}
                  Currently: Idle
                {:else}
                  Currently on: {MISSIONS[activeCaptain.mission.missionKey].label}
                {/if}
              </div>
            </Panel>
          {:else if activeFleetCaptainSubTab === "talents"}
            <Panel>
              <div class="panel-title">CAPTAIN TALENTS — {activeCaptain.label}</div>
              {#each (["command", "tactical", "science", "resourcefulness", "diplomacy"] as CaptainTalentBranch[]) as branch}
                {@const nodes = Object.entries(CAPTAIN_TALENTS).filter(([, def]) => def.branch === branch)}
                <div class="skill-branch">
                  <div class="skill-branch-title">{branch}</div>
                  {#if nodes.length === 0}
                    <p class="prestige-text">Not yet available.</p>
                  {:else}
                    {#each nodes as [key, talent]}
                      {@const owned = activeCaptain.unlockedCaptainTalents.includes(key as CaptainTalentKey)}
                      {@const locked = !owned && talent.requires !== null && !activeCaptain.unlockedCaptainTalents.includes(talent.requires)}
                      {@const buyable = !owned && !locked && activeCaptain.statPoints >= talent.cost}
                      <div class="skill-node" class:owned={owned} class:locked={locked}>
                        <div>
                          <div class="skill-node-label">{talent.label}</div>
                          <div class="skill-node-status">
                            {#if owned}
                              Owned
                            {:else if locked}
                              Requires: {CAPTAIN_TALENTS[talent.requires!].label}
                            {:else}
                              Cost: {formatNumber(talent.cost)} Stat Points
                            {/if}
                          </div>
                        </div>
                        {#if !owned}
                          <button class="buy-btn" disabled={!buyable} on:click={() => doBuyCaptainTalent(key as CaptainTalentKey)}>
                            Learn
                          </button>
                        {/if}
                      </div>
                    {/each}
                  {/if}
                </div>
              {/each}
            </Panel>
          {/if}
        </div>
      </div>
      {/if}
```

This is a pure relocation of the CAPTAIN LEVELING and CAPTAIN TALENTS panels' EXISTING markup (byte-
identical content, new surrounding `{#if activeFleetCaptainSubTab === ...}` wrapper and layout div),
plus one new line (the "Currently: Idle" / "Currently on: {mission label}" readout) per the design
doc. Import `SubTabs` from `./lib/SubTabs` and `type CaptainTalentBranch` alongside the existing
`CaptainTalentKey` import if not already present (check the current import list first).

**Step 3: Add CSS**

```css
  .fleet-captains-layout { display: flex; gap: 12px; align-items: flex-start; }
  .captain-list { display: flex; flex-direction: column; gap: 6px; flex: 0 0 96px; }
  .captain-list-item {
    background: rgba(var(--color-accent-rgb), 0.06);
    border: 1px solid rgba(var(--color-accent-rgb), 0.2);
    border-radius: 8px;
    padding: 10px 8px;
    color: var(--color-text-secondary);
    font-size: 12px;
    cursor: pointer;
    text-align: left;
  }
  .captain-list-item.active {
    background: rgba(var(--color-accent-rgb), 0.15);
    color: var(--color-accent-bright);
    border-color: var(--color-accent);
  }
  .fleet-captains-content { flex: 1; min-width: 0; }
```

The old `.captain-tabs`/`.captain-tab` CSS rules (the horizontal pill row) become unused by this
change — leave them in place for now rather than deleting (they're the SAME visual pattern
`.captain-list-item` above is modeled on; deleting immediately risks losing the reference before the
final holistic review confirms nothing else uses them). Note this in KNOWN_ISSUES.md in Task 11 if
they're still unused by then.

**Step 4: Manual verification (no test runner)**

Confirm `activeCaptainIndex`/`activeCaptain` (pre-existing reactive var) still drive the right-hand
content correctly. Confirm the Overview panel's new mission-status line reads `activeCaptain.mission`
correctly (null-checked before accessing `.missionKey`).

**Step 5: Commit**

```bash
git add src/App.svelte
git commit -m "feat: add Fleet Captain's tab (captain list + Overview/Talents sub-tabs)"
```

---

### Task 9: Fleet Operations tab (mission-first layout)

**Files:**
- Modify: `src/App.svelte`

**Context:** New tab, entirely mission-first (NOT scoped to `activeCaptain`). Grep `App.svelte` for
every call site of `doDispatchCaptainOnMission`/`doRecallCaptain` first — after Task 8 removed the
old Fleet Ops block, these 2 handlers currently have ZERO call sites (dangling), so this task is free
to change their signatures without touching any other caller.

**Step 1: Change the handler signatures**

Change:

```ts
  function doDispatchCaptainOnMission(missionKey: MissionKey) {
    const captain = activeCaptain;
    const { next, success } = dispatchCaptainOnMission(state, captain.id, missionKey);
    if (!success) return;
    state = next;
    pushLog(`[${captain.label}] Dispatched on mission: ${MISSIONS[missionKey].label}.`);
    doSave();
  }
```

to:

```ts
  function doDispatchCaptainOnMission(captainId: number, missionKey: MissionKey) {
    const captain = state.captains.find((c) => c.id === captainId)!;
    const { next, success } = dispatchCaptainOnMission(state, captainId, missionKey);
    if (!success) return;
    state = next;
    pushLog(`[${captain.label}] Dispatched on mission: ${MISSIONS[missionKey].label}.`);
    doSave();
  }
```

and:

```ts
  function doRecallCaptain() {
    const captain = activeCaptain;
    const missionLabel = MISSIONS[captain.mission!.missionKey].label;
    const { next, success } = recallCaptain(state, captain.id);
    if (!success) return;
    state = next;
    pushLog(`[${captain.label}] Recall ordered — returning to base from: ${missionLabel}.`);
    doSave();
  }
```

to:

```ts
  function doRecallCaptain(captainId: number) {
    const captain = state.captains.find((c) => c.id === captainId)!;
    const missionLabel = MISSIONS[captain.mission!.missionKey].label;
    const { next, success } = recallCaptain(state, captainId);
    if (!success) return;
    state = next;
    pushLog(`[${captain.label}] Recall ordered — returning to base from: ${missionLabel}.`);
    doSave();
  }
```

**Step 2: Add the tab markup**

```svelte
      {#if activeTab === "fleetOperations"}
      {#each Object.entries(MISSIONS) as [missionKey, missionDef]}
        {@const embarked = state.captains.filter((c) => c.mission?.missionKey === missionKey)}
        {@const eligible = state.captains.filter((c) => c.mission === null)}
        <Panel>
          <div class="panel-title">{missionDef.label.toUpperCase()}</div>
          <div class="research-cost">Cargo capacity: {formatNumber(missionDef.cargoCapacity)}</div>

          {#each embarked as captain}
            {@const mission = captain.mission!}
            {@const requiredTicks = requiredTicksForPhase(mission.phase, missionDef)}
            {@const progress = Math.min(1, mission.phaseProgressTicks / requiredTicks)}
            {@const remainingTicks = Math.max(0, requiredTicks - mission.phaseProgressTicks)}
            <div class="mission-card">
              <div class="research-name">{captain.label}</div>
              <div class="research-cost">Phase: {MISSION_PHASE_LABEL[mission.phase]}</div>
              <div class="research-bar-track">
                <div class="research-bar-fill" style="width:{progress * 100}%"></div>
              </div>
              <div class="research-readout">{remainingTicks.toFixed(1)} ticks remaining in phase</div>
              <div class="research-cost">
                Cargo so far: {formatNumber(mission.cargo.commonOre)} ore, {formatNumber(mission.cargo.uncommonMaterial)} uncommon,
                {formatNumber(mission.cargo.rareMaterial)} rare
              </div>
              {#if mission.recalled}
                <p class="prestige-text mission-recalled-text">Recall ordered — returning to base once the current cycle's unloading completes.</p>
              {:else}
                <button class="recall-btn" on:click={() => doRecallCaptain(captain.id)}>Recall Captain</button>
              {/if}
            </div>
          {/each}

          {#if eligible.length > 0}
            <div class="mission-list">
              {#each eligible as captain}
                <div class="mission-card">
                  <div class="research-name">{captain.label}</div>
                  <button class="buy-btn" on:click={() => doDispatchCaptainOnMission(captain.id, missionKey as MissionKey)}>
                    Dispatch · {missionDef.label}
                  </button>
                </div>
              {/each}
            </div>
          {:else if embarked.length === 0}
            <p class="prestige-text">No eligible captains available.</p>
          {/if}
        </Panel>
      {/each}
      {/if}
```

**Step 2: Manual verification (no test runner)**

Hand-trace: with 2 captains, one on `shortOreRun` and one idle, confirm the `shortOreRun` card shows
the embarked captain's progress + Recall button, AND the idle captain in its eligible list with a
Dispatch button for `shortOreRun` — but the `longOreRun` card shows ONLY the idle captain (not the
one already on `shortOreRun`, since `eligible` filters on `mission === null` fleet-wide, correctly
excluding a captain already committed to a different mission).

**Step 3: Commit**

```bash
git add src/App.svelte
git commit -m "feat: add Fleet Operations tab (mission-first dispatch/recall)"
```

---

### Task 10: Homeworld and System tab sub-tabs

**Files:**
- Modify: `src/App.svelte`

**Step 1: Homeworld sub-tabs**

Add state:

```ts
  type HomeworldSubTab = "resources" | "refinery" | "talents";
  let activeHomeworldSubTab: HomeworldSubTab = "resources";
```

Inside the existing `{#if activeTab === "homeworld"}` block, add a `<SubTabs>` row right after the
opening `{#if}` and wrap each of the 3 existing panel groups (HOME PLANET; the `{#each
Object.entries(RECIPES)}` block; HOMEWORLD TALENTS) in its own `{#if activeHomeworldSubTab ===
"..."}` conditional — pure relocation, panel content unchanged:

```svelte
      {#if activeTab === "homeworld"}
      <SubTabs
        tabs={[{ key: "resources", label: "Resources" }, { key: "refinery", label: "Refinery/Fabrication" }, { key: "talents", label: "Homeworld Talents" }]}
        active={activeHomeworldSubTab}
        onSelect={(key) => (activeHomeworldSubTab = key as HomeworldSubTab)}
      />

      {#if activeHomeworldSubTab === "resources"}
      <Panel>
        <!-- existing HOME PLANET panel content, unchanged -->
      </Panel>
      {/if}

      {#if activeHomeworldSubTab === "refinery"}
      {#each Object.entries(RECIPES) as [recipeKey, recipe]}
        <!-- existing Refinery/Fabrication panel content, unchanged -->
      {/each}
      {/if}

      {#if activeHomeworldSubTab === "talents"}
      <Panel>
        <!-- existing HOMEWORLD TALENTS panel content, unchanged -->
      </Panel>
      {/if}
      {/if}
```

**Step 2: System sub-tabs**

Add state:

```ts
  type SystemSubTab = "options" | "log" | "debug";
  let activeSystemSubTab: SystemSubTab = "options";
```

Inside the existing `{#if activeTab === "system"}` block, add a `<SubTabs>` row (include "Debug" in
the `tabs` array only `{#if DEV_MODE_ENV}`) and wrap the OPTIONS panel, the LOG panel, and the dev
debug panel each in their own `{#if activeSystemSubTab === "..."}` conditional — pure relocation,
content unchanged. The dev panel's existing `{#if DEV_MODE_ENV && devPanelOpen}` guard becomes
`{#if DEV_MODE_ENV && activeSystemSubTab === "debug"}` (the dev-mode toggle button in the header
still controls whether Debug is even a reachable sub-tab, but once dev mode is on, the debug panel's
own visibility is now driven by sub-tab selection instead of the separate `devPanelOpen` toggle —
simplify by removing `devPanelOpen`/its toggle button entirely, since the Debug sub-tab now serves
that exact purpose; confirm this simplification doesn't lose any behavior by re-reading the
`devPanelOpen` toggle button in the header before removing it).

**Step 3: Manual verification (no test runner)**

Re-read both reorganized tabs in full: confirm every relocated panel's original content (including
all `{#each}`/`{@const}` bindings) is byte-identical to before, just wrapped in a new conditional.
Confirm `DEV_MODE_ENV` gating still fully hides the Debug sub-tab button itself (not just the panel)
when dev mode is off, matching today's behavior of hiding the Dev toggle button entirely.

**Step 4: Commit**

```bash
git add src/App.svelte
git commit -m "feat: add sub-tabs to Homeworld and System tabs"
```

---

### Task 11: Docs and final commit

**Files:**
- Modify: `SESSION_LOG.md`
- Modify: `KNOWN_ISSUES.md` (only if warranted)

**Step 1**: Check whether `.captain-tabs`/`.captain-tab` CSS (superseded by Task 8's
`.captain-list`/`.captain-list-item`) are now genuinely unused — if so, either remove them or log
them in `KNOWN_ISSUES.md` following this file's established "orphaned CSS" convention (see the
existing Phase-4-era entry for `.research-status`/`.module-*`/etc. for the wording style to match).

**Step 2**: Append a session log entry, verifying actual commit count against this plan's task
structure first (this session's established practice).

**Step 3: Commit**

```bash
git add SESSION_LOG.md KNOWN_ISSUES.md
git commit -m "docs: log UI Redesign session"
```

**Step 4: Do not push.** Needs the user's explicit go-ahead first.
