# Research / Material Discovery Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add one timed research project ("Alloy Synthesis") that unlocks a 4th resource+module tier (alloys/Synthesizer), progressing on game-time so it's consistent with offline catch-up and the dev speed multiplier, with visible locked placeholders until unlocked.

**Architecture:** Alloys/Synthesizer extend the existing generic `MODULES`/`RESOURCE_KEY` arrays exactly like the current 3 resources — `tick()`'s production loop needs zero changes to make them work. Research state is a small `Record<ResearchKey, ResearchState>` on `GameState`, advanced by a new loop in `tick()` that mirrors the existing production loop's shape. Unlock gating goes through one pure function (`isModuleUnlocked`) and its resource-side twin (`isResourceUnlocked`), consulted both for display and as a defense-in-depth guard inside `buyModule`.

**Tech Stack:** Svelte 5 (existing non-runes style), TypeScript, Vitest. No new dependencies.

**Design doc:** `docs/plans/2026-07-03-research-design.md` — read this first if anything below is ambiguous.

**A note on testing:** Node.js/npm is unavailable in this environment (reconfirmed before writing this plan) — no dev server, no build. Tasks 1-3 touch genuinely testable pure logic (data model, tick's closed-form math, save migration) and follow this session's established TDD pattern (`model.test.ts`, `tick.test.ts`, `save.test.ts` precedents) — write the test, manually trace whether it would pass/fail, then implement. Tasks 4-6 are Svelte markup/CSS with no automated test story, verified by manual code review only, same limitation as every other UI task this session.

---

### Task 1: Extend the data model (resources, modules, research state, unlock helpers)

**Files:**
- Modify: `src/lib/game/model.ts`
- Test: Modify `src/lib/game/model.test.ts` (add tests, keep the existing one)

**Step 1: Write the failing tests**

Add to `src/lib/game/model.test.ts` (keep the existing `describe` block untouched, add new ones):

```ts
import { describe, it, expect } from "vitest";
import { freshState, isModuleUnlocked, isResourceUnlocked } from "./model";

describe("freshState — tick duration default", () => {
  it("defaults tickDurationSeconds to 10", () => {
    const state = freshState();
    expect(state.tickDurationSeconds).toBe(10);
  });
});

describe("freshState — alloys/synthesizer/research defaults", () => {
  it("starts with 0 alloys and 0 synthesizers", () => {
    const state = freshState();
    expect(state.resources.alloys).toBe(0);
    expect(state.modules.synthesizer).toBe(0);
  });

  it("starts with alloySynthesis research not started/not completed", () => {
    const state = freshState();
    expect(state.research.alloySynthesis).toEqual({
      started: false,
      progressSeconds: 0,
      completed: false,
    });
  });
});

describe("isModuleUnlocked", () => {
  it("miner, refinery, and fabricator are always unlocked", () => {
    const state = freshState();
    expect(isModuleUnlocked("miner", state)).toBe(true);
    expect(isModuleUnlocked("refinery", state)).toBe(true);
    expect(isModuleUnlocked("fabricator", state)).toBe(true);
  });

  it("synthesizer is locked until alloySynthesis research completes", () => {
    const state = freshState();
    expect(isModuleUnlocked("synthesizer", state)).toBe(false);

    const completed = {
      ...state,
      research: { ...state.research, alloySynthesis: { ...state.research.alloySynthesis, completed: true } },
    };
    expect(isModuleUnlocked("synthesizer", completed)).toBe(true);
  });
});

describe("isResourceUnlocked", () => {
  it("ore, ingots, and components are always unlocked", () => {
    const state = freshState();
    expect(isResourceUnlocked("ore", state)).toBe(true);
    expect(isResourceUnlocked("ingots", state)).toBe(true);
    expect(isResourceUnlocked("components", state)).toBe(true);
  });

  it("alloys is locked until alloySynthesis research completes", () => {
    const state = freshState();
    expect(isResourceUnlocked("alloys", state)).toBe(false);

    const completed = {
      ...state,
      research: { ...state.research, alloySynthesis: { ...state.research.alloySynthesis, completed: true } },
    };
    expect(isResourceUnlocked("alloys", completed)).toBe(true);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/game/model.test.ts`
Expected: FAIL — `alloys`/`synthesizer`/`research` don't exist on `GameState` yet, `isModuleUnlocked`/`isResourceUnlocked` aren't exported yet.

**Step 3: Write the implementation**

In `src/lib/game/model.ts`:

1. Extend the two key types:
```ts
export type ResourceKey = "ore" | "ingots" | "components" | "alloys";
export type ModuleKey = "miner" | "refinery" | "fabricator" | "synthesizer";
```

2. Add the 4th module to `MODULES`:
```ts
export const MODULES: Record<ModuleKey, ModuleDef> = {
  miner: { label: "Mining Laser", resource: "ore", baseRate: 1, baseCost: 10, costMult: 1.15, unit: "ore/s" },
  refinery: { label: "Refinery", resource: "ingots", baseRate: 0.4, baseCost: 60, costMult: 1.17, unit: "ingots/s" },
  fabricator: { label: "Fabricator", resource: "components", baseRate: 0.12, baseCost: 400, costMult: 1.2, unit: "components/s" },
  synthesizer: { label: "Synthesizer", resource: "alloys", baseRate: 0.04, baseCost: 2500, costMult: 1.22, unit: "alloys/s" },
};
```

3. Extend `RESOURCE_ORDER`/`RESOURCE_LABEL`:
```ts
export const RESOURCE_ORDER: ResourceKey[] = ["ore", "ingots", "components", "alloys"];
export const RESOURCE_LABEL: Record<ResourceKey, string> = {
  ore: "Common Ore",
  ingots: "Refined Ingots",
  components: "Components",
  alloys: "Alloys",
};
```

4. Add research types and the project lookup (place after `RESOURCE_LABEL`, before `GameState`):
```ts
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
```

5. Add `research` to `GameState`:
```ts
export interface GameState {
  resources: Record<ResourceKey, number>;
  modules: Record<ModuleKey, number>;
  lifetimeComponents: number;
  augmentPoints: number;
  prestigeCount: number;
  gameTimeSeconds: number;
  tickDurationSeconds: number;
  research: Record<ResearchKey, ResearchState>;
}
```

6. Update `freshState()`:
```ts
export function freshState(): GameState {
  return {
    resources: { ore: 0, ingots: 0, components: 0, alloys: 0 },
    modules: { miner: 1, refinery: 0, fabricator: 0, synthesizer: 0 },
    lifetimeComponents: 0,
    augmentPoints: 0,
    prestigeCount: 0,
    gameTimeSeconds: 0,
    tickDurationSeconds: 10,
    research: { alloySynthesis: { started: false, progressSeconds: 0, completed: false } },
  };
}
```

7. Add the two unlock helpers (after `costFor`, before or after `globalMultiplier` — either is fine):
```ts
// Only one gated module/resource exists right now (Synthesizer/alloys, behind
// Alloy Synthesis research). If a second gated module is ever added, this
// needs a real lookup instead of a single hardcoded key check.
export function isModuleUnlocked(key: ModuleKey, state: GameState): boolean {
  if (key === "synthesizer") return state.research.alloySynthesis.completed;
  return true;
}

export function isResourceUnlocked(key: ResourceKey, state: GameState): boolean {
  if (key === "alloys") return state.research.alloySynthesis.completed;
  return true;
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/game/model.test.ts`
Expected: PASS (all tests, including the pre-existing `tickDurationSeconds` one)

**Step 5: Commit**

```bash
git add src/lib/game/model.ts src/lib/game/model.test.ts
git commit -m "feat: add alloys/synthesizer resource tier, research state, unlock helpers"
```

---

### Task 2: Add research progress to tick()

**Files:**
- Modify: `src/lib/game/tick.ts`
- Test: Modify `src/lib/game/tick.test.ts`

**This must not change the existing resource-production loop or break the closed-form regression test.** Read the current `tick.ts` in full before editing — the production loop and the `producedComponents`/return-object lines must stay intact; you're adding a second, independent loop for research.

**Step 1: Write the failing tests**

Add to `src/lib/game/tick.test.ts` (new `describe` blocks; keep everything else untouched):

```ts
describe("tick — research progress", () => {
  it("advances progressSeconds for a started, incomplete project", () => {
    const base = freshState();
    base.research.alloySynthesis.started = true;

    const result = tick(90, base);
    expect(result.research.alloySynthesis.progressSeconds).toBe(90);
    expect(result.research.alloySynthesis.completed).toBe(false);
  });

  it("completes exactly at the project's duration", () => {
    const base = freshState();
    base.research.alloySynthesis.started = true;

    const result = tick(180, base);
    expect(result.research.alloySynthesis.progressSeconds).toBe(180);
    expect(result.research.alloySynthesis.completed).toBe(true);
  });

  it("caps progressSeconds at duration, never overshoots", () => {
    const base = freshState();
    base.research.alloySynthesis.started = true;

    const result = tick(500, base); // way more than the 180s duration
    expect(result.research.alloySynthesis.progressSeconds).toBe(180);
    expect(result.research.alloySynthesis.completed).toBe(true);
  });

  it("never advances an unstarted project", () => {
    const base = freshState(); // started: false by default
    const result = tick(1000, base);
    expect(result.research.alloySynthesis.progressSeconds).toBe(0);
    expect(result.research.alloySynthesis.completed).toBe(false);
  });

  it("one big jump equals many small ticks (closed-form, same property as resource production)", () => {
    const base = freshState();
    base.research.alloySynthesis.started = true;

    const bigJump = tick(180, base);

    let stepped = base;
    for (let i = 0; i < 1800; i++) {
      stepped = tick(0.1, stepped);
    }

    expect(bigJump.research.alloySynthesis.progressSeconds).toBeCloseTo(
      stepped.research.alloySynthesis.progressSeconds,
      6
    );
    expect(bigJump.research.alloySynthesis.completed).toBe(stepped.research.alloySynthesis.completed);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/game/tick.test.ts`
Expected: FAIL — `tick()` doesn't touch `research` yet, so `result.research` would just be a pass-through of the unmodified input (progressSeconds stays 0 in every case).

**Step 3: Write the implementation**

In `src/lib/game/tick.ts`, update the import line and add a research loop inside `tick()`, after the existing production loop but before computing `producedComponents`:

```ts
import { MODULES, globalMultiplier, freshState, RESEARCH_PROJECTS, type GameState } from "./model";

export function tick(deltaSeconds: number, state: GameState): GameState {
  if (deltaSeconds <= 0) return state;

  const mult = globalMultiplier(state);
  const resources = { ...state.resources };

  for (const key of Object.keys(MODULES) as (keyof typeof MODULES)[]) {
    const m = MODULES[key];
    const count = state.modules[key];
    if (count > 0) {
      resources[m.resource] += m.baseRate * count * mult * deltaSeconds;
    }
  }

  const research = { ...state.research };
  for (const key of Object.keys(RESEARCH_PROJECTS) as (keyof typeof RESEARCH_PROJECTS)[]) {
    const project = research[key];
    if (project.started && !project.completed) {
      const duration = RESEARCH_PROJECTS[key].durationSeconds;
      const newProgress = Math.min(project.progressSeconds + deltaSeconds, duration);
      research[key] = { ...project, progressSeconds: newProgress, completed: newProgress >= duration };
    }
  }

  const producedComponents = Math.max(0, resources.components - state.resources.components);

  return {
    ...state,
    resources,
    research,
    lifetimeComponents: state.lifetimeComponents + producedComponents,
    gameTimeSeconds: state.gameTimeSeconds + deltaSeconds,
  };
}
```

Do not touch `prestige()` in this task — whether research state should reset or carry through prestige is not addressed by this plan (see the design doc's explicit scope; research state isn't mentioned there, so leave `prestige()` exactly as it is for now, meaning research state will currently reset to fresh on prestige via the existing `...freshState()` spread, which is a reasonable default nobody has asked to change).

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/game/tick.test.ts`
Expected: PASS — all tests, including the 3 original closed-form tests (unaffected, since the production loop wasn't touched) and the `prestige` describe blocks from earlier sessions.

**Step 5: Commit**

```bash
git add src/lib/game/tick.ts src/lib/game/tick.test.ts
git commit -m "feat: advance research progress in tick(), capped at project duration"
```

---

### Task 3: Save migration for the new `research` field

**Files:**
- Modify: `src/lib/game/save.ts`
- Test: Modify `src/lib/game/save.test.ts`

**Step 1: Write the failing test**

Add to `src/lib/game/save.test.ts` (keep the existing tests untouched):

```ts
describe("migrate — research field backfill", () => {
  it("defaults research to a fresh alloySynthesis entry on a v2 save that predates the field", () => {
    const legacyState = freshState();
    delete (legacyState as any).research;

    const save: SaveFile = {
      version: 2,
      created_at: 0,
      last_saved_at: 0,
      game_time_seconds: 0,
      state: legacyState,
    };

    const migrated = migrate(save);
    expect(migrated.research.alloySynthesis).toEqual({
      started: false,
      progressSeconds: 0,
      completed: false,
    });
  });

  it("current SAVE_VERSION is 3", () => {
    expect(SAVE_VERSION).toBe(3);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/game/save.test.ts`
Expected: FAIL — `SAVE_VERSION` is still `2`, and `MIGRATIONS[2]` doesn't exist, so a v2 save stops migrating at version 2 and `migrated.research` is `undefined`.

**Step 3: Write the implementation**

In `src/lib/game/save.ts`:

```ts
export const SAVE_VERSION = 3;
```

```ts
// v1 -> v2: tick bar feature added tickDurationSeconds (see MIGRATIONS[1]).
// v2 -> v3: research feature (docs/plans/2026-07-03-research-plan.md, Task 3)
// added `research` to GameState. Saves made before that field existed need
// it backfilled to a fresh, not-yet-started alloySynthesis entry.
// Per Ops SS8.E.1: MIGRATIONS[1] is never edited again now that it's shipped.
const MIGRATIONS: Record<number, Migration> = {
  1: (state: any): GameState => ({ ...state, tickDurationSeconds: state.tickDurationSeconds ?? 10 }),
  2: (state: any): GameState => ({
    ...state,
    research: state.research ?? { alloySynthesis: { started: false, progressSeconds: 0, completed: false } },
  }),
};
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/game/save.test.ts`
Expected: PASS (all tests, including the pre-existing v1→v2 migration test)

**Step 5: Commit**

```bash
git add src/lib/game/save.ts src/lib/game/save.test.ts
git commit -m "feat: bump save version to 3, migrate missing research field"
```

---

### Task 4: Wire `startResearch` and the `buyModule` unlock guard

**Files:**
- Modify: `src/App.svelte`

**Step 1: Update imports**

Add `isModuleUnlocked`, `isResourceUnlocked`, and `RESEARCH_PROJECTS` to the existing `model` import, and `type ResearchKey` alongside `type ModuleKey`/`type GameState`:

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

**Step 2: Add the unlock guard to `buyModule`**

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

**Step 3: Add `startResearch`**

Add near `resetSave()`/`setTheme()`:

```ts
  function startResearch(key: ResearchKey) {
    const project = RESEARCH_PROJECTS[key];
    if (state.resources.components < project.costComponents) return;
    state = {
      ...state,
      resources: { ...state.resources, components: state.resources.components - project.costComponents },
      research: { ...state.research, [key]: { ...state.research[key], started: true } },
    };
    pushLog(`Research started: ${project.label}.`);
  }
```

**Step 4: No automated test.** Read back and confirm: `buyModule`'s new guard is the very first line in the function body (before the existing cost check), and `startResearch` deducts `costComponents` from `components` (not `ore` — this is a different currency than module purchases) before flipping `started` to `true`.

**Step 5: Commit**

```bash
git add src/App.svelte
git commit -m "feat: add startResearch and buyModule unlock guard"
```

---

### Task 5: Locked placeholders in Generator Stack and Resources

**Files:**
- Modify: `src/App.svelte`

**Step 1: Update the Generator Stack module-list loop**

Replace:

```svelte
          {#each Object.entries(MODULES) as [key, m]}
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
          {/each}
```

with:

```svelte
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
```

(The locked branch's message hardcodes "Alloy Synthesis" as the requirement — fine for now since it's the only gated module; see the comment already added to `isModuleUnlocked` in Task 1 about generalizing this if a second gated module is ever added.)

**Step 2: Update the Resources resource-grid loop**

Replace:

```svelte
          {#each RESOURCE_ORDER as r}
            <div class="resource-card">
              <div class="resource-label">{RESOURCE_LABEL[r]}</div>
              <div class="resource-value">{formatNumber(state.resources[r])}</div>
            </div>
          {/each}
```

with:

```svelte
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
```

**Step 3: Add supporting CSS**

Add near `.module-card`/`.resource-value`:

```css
  .module-card.locked { opacity: 0.5; }
  .resource-value.locked { color: var(--color-text-dim); font-size: 18px; }
```

**Step 4: No automated test.** Read back and confirm: the `resource-grid` now always renders 4 cards (ore/ingots/components/alloys) regardless of unlock state, only the alloys card's *value* differs (lock icon vs number) — the card itself isn't hidden, matching the design doc's "visible locked placeholder" decision. Same for the Generator Stack: all 4 modules always render a row, only the synthesizer row's *content* differs (locked message vs buy button).

**Step 5: Commit**

```bash
git add src/App.svelte
git commit -m "feat: show locked placeholders for alloys/synthesizer until research completes"
```

---

### Task 6: RESEARCH panel

**Files:**
- Modify: `src/App.svelte`

**Step 1: Add the panel markup**

Insert a new `<Panel>` section after the GENERATOR STACK panel's closing `</Panel>` and before the PRESTIGE panel:

```svelte
      <Panel>
        <div class="panel-title">RESEARCH</div>
        {#if state.research.alloySynthesis.completed}
          <p class="research-status">✓ {RESEARCH_PROJECTS.alloySynthesis.label} — Complete</p>
        {:else if state.research.alloySynthesis.started}
          {@const project = RESEARCH_PROJECTS.alloySynthesis}
          {@const progress = state.research.alloySynthesis.progressSeconds / project.durationSeconds}
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

**Step 2: Add supporting CSS**

```css
  .research-name { font-size: 13px; font-weight: 600; margin-bottom: 6px; }
  .research-cost { font-size: 12px; color: var(--color-text-secondary); margin-bottom: 10px; }
  .research-status { font-size: 13px; color: var(--color-success); margin: 0; }
  .research-bar-track {
    height: 10px;
    background: var(--color-panel-bg-strong);
    border: 1px solid rgba(var(--color-accent-rgb), 0.14);
    overflow: hidden;
    margin-bottom: 6px;
    clip-path: polygon(
      4px 0,
      calc(100% - 4px) 0,
      100% 4px,
      100% calc(100% - 4px),
      calc(100% - 4px) 100%,
      4px 100%,
      0 calc(100% - 4px),
      0 4px
    );
  }
  .research-bar-fill {
    height: 100%;
    background: var(--color-accent);
    transition: width 0.2s linear;
  }
  .research-readout { font-size: 11px; color: var(--color-text-secondary); text-align: right; }
```

(`--color-success` is an existing token from `app.css` not yet used anywhere in `App.svelte` — this is its first use, no new CSS variable needed. The research progress bar reuses the exact same chamfer technique as `.tick-bar-track`, just under a different class name since it's a visually distinct panel, not because the CSS itself differs.)

**Step 3: No automated test.** Read back and confirm: the three `{#if}`/`{:else if}`/`{:else}` branches are mutually exclusive and cover all 3 states (completed / in-progress / not-started), and `startResearch("alloySynthesis")` passes the correct literal key matching `ResearchKey`.

**Step 4: Commit**

```bash
git add src/App.svelte
git commit -m "feat: add RESEARCH panel with start/progress/complete states"
```

---

### Task 7: Docs and final commit

**Files:**
- Modify: `SESSION_LOG.md`
- Modify: `KNOWN_ISSUES.md` (only if warranted — see below)

**Step 1: Check `KNOWN_ISSUES.md`**

Consider whether anything from this feature belongs there. One candidate: `isModuleUnlocked`'s locked-row message hardcodes "Alloy Synthesis" as the only possible unlock requirement (noted in a code comment in Task 1) — this only becomes a real gap once a second gated module exists, which isn't true yet, so it's arguably not worth a `KNOWN_ISSUES.md` entry (the code comment already covers it for whoever adds the next one). Use judgment; add an entry only if you find something that would genuinely help a future you avoid re-discovering a gap, per this file's own stated purpose.

**Step 2: Append a session log entry**

```markdown

**Session 6** — Added the Research system (right-sized against the design
doc's fuller SS4.8 vision, which assumes Energy/materials/synthesis that
don't exist in this prototype yet): one timed project, Alloy Synthesis
(500 components, 180 game-seconds), unlocking a 4th resource+module tier
(alloys/Synthesizer) that slots into the existing generic MODULES/
RESOURCE_KEY patterns — `tick()`'s production loop needed zero changes to
make alloys accrue once unlocked. Research progresses on the same
game-time clock as everything else (verified with the same "one big jump
equals many small ticks" closed-form test used for resource production),
so it advances correctly through offline catch-up and the dev speed
multiplier rather than needing a separate wall-clock timer. Generator
Stack and Resources both show visible locked placeholders for
Synthesizer/alloys until research completes, per the design doc's
"visible walls are motivating" principle already applied to the panel
redesign. Next: get eyes on this in an actual browser — start research,
confirm the progress bar advances and completes, confirm Synthesizer
actually becomes buyable and starts producing alloys afterward, and try
the dev panel's offline-simulation buttons to confirm research also
completes correctly across a simulated offline gap.
```

**Step 3: Commit**

```bash
git add SESSION_LOG.md KNOWN_ISSUES.md
git commit -m "docs: log research session"
```

**Step 4: Do not push.** Same as every other feature this session — pushing to `origin/main` triggers a live Vercel production redeploy and needs the user's explicit go-ahead first.
