# Tick Bar Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn resource production from continuous smooth accrual into discrete lump-sum grants on a fixed, visible 10-second cadence (a "tick bar"), where the tick duration is a persisted, mutable game value that future bonuses will shorten.

**Architecture:** `tick(deltaSeconds, state)` in `src/lib/game/tick.ts` is already closed-form and needs zero changes — we just call it once per tick cycle instead of once per 100ms. A new `tickDurationSeconds` field on `GameState` (default 10) drives the cycle length. `App.svelte`'s existing 100ms interval is repurposed to track cycle progress (`barSeconds = max(1, tickDurationSeconds / speed)`) and fire `tick()` once when a cycle completes, instead of firing it continuously with a tiny delta.

**Tech Stack:** Vite + Svelte 5 + TypeScript, Vitest for unit tests. No new dependencies.

**Design doc:** `docs/plans/2026-07-02-tick-bar-design.md` — read this first if anything below is ambiguous.

---

### Task 1: Add `tickDurationSeconds` to the data model

**Files:**
- Modify: `src/lib/game/model.ts`
- Test: Create `src/lib/game/model.test.ts`

**Step 1: Write the failing test**

Create `src/lib/game/model.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { freshState } from "./model";

describe("freshState — tick duration default", () => {
  it("defaults tickDurationSeconds to 10", () => {
    const state = freshState();
    expect(state.tickDurationSeconds).toBe(10);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/game/model.test.ts`
Expected: FAIL — `state.tickDurationSeconds` is `undefined`, not `10` (the field doesn't exist on `GameState` yet, so this will actually be a TypeScript error if you run `npm run check`, but Vitest itself will just report the assertion failure).

**Step 3: Write minimal implementation**

In `src/lib/game/model.ts`, add the field to the `GameState` interface (near `gameTimeSeconds`):

```ts
export interface GameState {
  resources: Record<ResourceKey, number>;
  modules: Record<ModuleKey, number>;
  lifetimeComponents: number;
  augmentPoints: number;
  prestigeCount: number;
  gameTimeSeconds: number; // accumulated in-game seconds, per tech spec §1
  tickDurationSeconds: number; // length of one tick-bar cycle; shrinks via future bonuses
}
```

And set the default in `freshState()`:

```ts
export function freshState(): GameState {
  return {
    resources: { ore: 0, ingots: 0, components: 0 },
    modules: { miner: 1, refinery: 0, fabricator: 0 },
    lifetimeComponents: 0,
    augmentPoints: 0,
    prestigeCount: 0,
    gameTimeSeconds: 0,
    tickDurationSeconds: 10,
  };
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/game/model.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/game/model.ts src/lib/game/model.test.ts
git commit -m "feat: add tickDurationSeconds to GameState"
```

---

### Task 2: Bump save version and add migration

**Files:**
- Modify: `src/lib/game/save.ts`
- Test: Create `src/lib/game/save.test.ts`

**Step 1: Write the failing test**

Create `src/lib/game/save.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { migrate, SAVE_VERSION, type SaveFile } from "./save";
import { freshState } from "./model";

describe("migrate — tickDurationSeconds backfill", () => {
  it("defaults tickDurationSeconds to 10 on a v1 save that predates the field", () => {
    const legacyState = freshState();
    // simulate an old save: strip the field to mimic a pre-migration record
    delete (legacyState as any).tickDurationSeconds;

    const save: SaveFile = {
      version: 1,
      created_at: 0,
      last_saved_at: 0,
      game_time_seconds: 0,
      state: legacyState,
    };

    const migrated = migrate(save);
    expect(migrated.tickDurationSeconds).toBe(10);
  });

  it("current SAVE_VERSION is 2", () => {
    expect(SAVE_VERSION).toBe(2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/game/save.test.ts`
Expected: FAIL — `SAVE_VERSION` is `1`, and `migrated.tickDurationSeconds` is `undefined` since `MIGRATIONS` is empty.

**Step 3: Write minimal implementation**

In `src/lib/game/save.ts`, bump the version and add the migration:

```ts
export const SAVE_VERSION = 2;
```

```ts
type Migration = (state: any) => any;
const MIGRATIONS: Record<number, Migration> = {
  1: (state: any): GameState => ({ ...state, tickDurationSeconds: state.tickDurationSeconds ?? 10 }),
};
```

(`GameState` is already imported at the top of this file, so no new import is needed.)

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/game/save.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/game/save.ts src/lib/game/save.test.ts
git commit -m "feat: bump save version to 2, migrate missing tickDurationSeconds"
```

---

### Task 3: Carry `tickDurationSeconds` through prestige

**Files:**
- Modify: `src/lib/game/tick.ts:37-49` (the `prestige` function)
- Test: `src/lib/game/tick.test.ts` (add a new test)

**Step 1: Write the failing test**

Add to `src/lib/game/tick.test.ts` (new `describe` block, keep the existing ones untouched):

```ts
import { prestige } from "./tick";

describe("prestige — tickDurationSeconds persistence", () => {
  it("carries tickDurationSeconds forward through a prestige reset", () => {
    const base = freshState();
    base.modules.fabricator = 5;
    base.lifetimeComponents = 100; // sqrt(100) = 10 Augment Points, so prestige actually fires
    base.tickDurationSeconds = 7; // simulate a future bonus having shortened it

    const { next } = prestige(base);
    expect(next.tickDurationSeconds).toBe(7);
  });
});
```

(Note: `tick.ts` already exports `prestige`; only the import line needs `prestige` added alongside the existing `tick` import if it isn't already there.)

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/game/tick.test.ts`
Expected: FAIL — `next.tickDurationSeconds` is `10` (from `freshState()`'s default), not `7`.

**Step 3: Write minimal implementation**

In `src/lib/game/tick.ts`, update the `prestige` function's `next` construction to carry the field forward, same pattern as `augmentPoints`:

```ts
export function prestige(state: GameState): { next: GameState; gained: number } {
  const gained = Math.floor(Math.sqrt(state.lifetimeComponents));
  if (gained <= 0) return { next: state, gained: 0 };

  const next: GameState = {
    ...freshState(),
    lifetimeComponents: state.lifetimeComponents,
    augmentPoints: state.augmentPoints + gained,
    prestigeCount: state.prestigeCount + 1,
    gameTimeSeconds: state.gameTimeSeconds,
    tickDurationSeconds: state.tickDurationSeconds,
  };
  return { next, gained };
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/game/tick.test.ts`
Expected: PASS (all tests in the file, including the three pre-existing ones)

**Step 5: Commit**

```bash
git add src/lib/game/tick.ts src/lib/game/tick.test.ts
git commit -m "feat: carry tickDurationSeconds through prestige reset"
```

---

### Task 4: Replace the continuous tick loop with the tick-bar timing loop

**Files:**
- Modify: `src/App.svelte`

This task changes UI/timing logic driven by `setInterval` and `Date.now()`. That combination isn't practically unit-testable without a much larger fake-timer harness than this hobby-scope prototype currently has (no existing precedent for it in this file) — so this task is verified manually against the running dev server instead of with an automated test. This matches how the existing dev-only debug panel (speed multiplier, offline simulator) is already verified in this codebase.

**Step 1: Update state variables**

In the `<script>` block of `src/App.svelte`, replace:

```ts
  let lastTick = Date.now();
```

with:

```ts
  let barCycleStart = Date.now();
  let nowTick = Date.now();
```

**Step 2: Update the offline catch-up block in `onMount`**

Replace:

```ts
    lastTick = Date.now();
```

(the line right after the `if (loadedSave) { ... } else { ... }` block) with:

```ts
    barCycleStart = Date.now();
    nowTick = Date.now();
```

**Step 3: Replace the tick interval body**

Replace the existing interval:

```ts
    // Active tick loop — tech spec §2, nominal 10 Hz.
    tickHandle = setInterval(() => {
      const now = Date.now();
      const delta = ((now - lastTick) / 1000) * speed;
      lastTick = now;
      state = tick(delta, state);
    }, 100);
```

with:

```ts
    // Tick-bar loop — checks cycle progress every 100ms, fires a discrete
    // tick() call once per full cycle. barSeconds is floored at 1 real
    // second so dev-speed presets never make the bar flicker unreadably;
    // multiple game-ticks just batch into that one visual cycle, which is
    // still correct because tick() is closed-form (see design doc).
    tickHandle = setInterval(() => {
      if (speed === 0) return; // paused — bar and resources both freeze
      const barSeconds = Math.max(1, state.tickDurationSeconds / speed);
      const now = Date.now();
      nowTick = now;
      const progress = (now - barCycleStart) / 1000 / barSeconds;
      if (progress >= 1) {
        const gameSecondsThisCycle = barSeconds * speed;
        state = tick(gameSecondsThisCycle, state);
        barCycleStart = now;
      }
    }, 100);
```

**Step 4: Add reactive bar progress declarations**

Near the existing `$: mult = globalMultiplier(state);` line, add:

```ts
  $: barSeconds = Math.max(1, state.tickDurationSeconds / (speed || 1));
  $: tickProgress = Math.min(1, Math.max(0, (nowTick - barCycleStart) / 1000 / barSeconds));
  $: tickRemaining = Math.max(0, barSeconds * (1 - tickProgress));
```

**Step 5: Add the tick bar panel to the markup**

In the `<main class="main">` block, insert a new `<section>` between the `RESOURCES` section and the `GENERATOR STACK` section:

```svelte
      <section class="panel">
        <div class="panel-title">TICK</div>
        <div class="tick-bar-track">
          <div class="tick-bar-fill" style="width:{tickProgress * 100}%"></div>
        </div>
        <div class="tick-bar-readout">{tickRemaining.toFixed(1)}s</div>
      </section>
```

**Step 6: Add matching styles**

In the `<style>` block, add (near the other panel-content styles, e.g. after `.resource-grid`/`.resource-card` rules):

```css
  .tick-bar-track {
    height: 10px;
    border-radius: 6px;
    background: var(--color-panel-bg-strong);
    border: 1px solid rgba(103, 232, 249, 0.14);
    overflow: hidden;
  }
  .tick-bar-fill {
    height: 100%;
    background: var(--color-accent);
    transition: width 0.1s linear;
  }
  .tick-bar-readout {
    margin-top: 6px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--color-text-secondary);
    text-align: right;
  }
```

**Step 7: Type-check**

Run: `npm run check`
Expected: no errors (this catches any leftover reference to the removed `lastTick`/`delta` variables).

**Step 8: Manual verification**

Run: `npm run dev`, open the printed `localhost` URL.

Verify, at default 1x speed:
- The tick bar fills smoothly from 0% to 100% over ~10 seconds, then resets.
- `Common Ore` (and other resources, once you own those modules) jump by a lump amount exactly when the bar completes a cycle — not smoothly between cycles.

If `.env.local` has `VITE_DEV_MODE=true` (see README), open the debug panel (gear icon) and verify:
- `10x`/`100x`/`1000x` speed presets make the bar cycle faster, never faster than once per second (the 1-second floor).
- `Pause` freezes the bar in place with no resource change.
- `+1h`/`+8h`/`+24h` offline-simulation buttons still work exactly as before (they call `tick()` directly, bypassing the bar).

**Step 9: Commit**

```bash
git add src/App.svelte
git commit -m "feat: replace continuous accrual with tick-bar discrete resource grants"
```

---

### Task 5: Update project docs and final commit

**Files:**
- Modify: `SESSION_LOG.md`
- Modify: `KNOWN_ISSUES.md` (only if manual verification in Task 4 surfaces something worth recording — see below)

**Step 1: Append a session log entry**

Per this repo's own convention (`SESSION_LOG.md`, "two sentences per session"), add a new entry following the existing `Session 2` entry:

```markdown

**Session 3** — Added the tick bar: resource production now grants in discrete
lumps on a 10-second cycle (`tickDurationSeconds` on `GameState`, persisted
through saves and prestige) instead of continuous smooth accrual, with a new
UI panel showing cycle progress and time remaining. Next: continue per
§10.6 (missions or the boss-encounter design question, §5.1).
```

**Step 2: Check `KNOWN_ISSUES.md`**

If Step 8 of Task 4 revealed a real limitation (e.g. the accepted mid-cycle speed-change bar jump, from the design doc's "Known edge case"), add one line to `KNOWN_ISSUES.md` describing it, matching the file's existing bullet style. This is optional — only add it if it's something a future you would actually want written down (per Ops §8.E.7, "so you don't relitigate it").

**Step 3: Commit**

```bash
git add SESSION_LOG.md KNOWN_ISSUES.md
git commit -m "docs: log tick bar session, note any residual known issues"
```

**Step 4: Confirm before pushing**

Do not run `git push` as part of this plan. Pushing to `origin/main` triggers a live Vercel production redeploy — confirm with the user first, same as the rename push earlier in this project.
