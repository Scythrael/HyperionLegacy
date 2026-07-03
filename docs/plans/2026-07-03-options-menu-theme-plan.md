# Options Menu (Theme Switcher + Delete Save) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a player-facing options menu (gear icon) with 6 selectable accent-color themes and a typed-confirmation "delete save" action, without breaking the dev-only debug panel or any existing styling.

**Architecture:** Themes are CSS custom-property overrides keyed by a `data-theme` attribute on `<html>`, switched with one line of JS (`document.documentElement.dataset.theme = name`) and no component re-render. A new `src/lib/theme.ts` module owns the theme name list, validation, and localStorage persistence, kept separate from `src/lib/game/save.ts` since theme is a display preference, not game state (it must survive a "delete save"). The delete-confirmation modal is new UI-only code with no new game logic — it just gates the existing `resetSave()` function behind a typed confirmation.

**Tech Stack:** Svelte 5 (this codebase's existing non-runes style), CSS custom properties + `data-theme` attribute selectors, Vitest. No new dependencies.

**Design doc:** `docs/plans/2026-07-03-options-menu-theme-design.md` — read this first if anything below is ambiguous.

**A note on testing:** Node.js/npm is unavailable in this environment (reconfirmed immediately before this plan was written) — no dev server, no build, nothing renderable. Most of this feature (CSS theme values, the modal's layout, icon placement) has no automated test story and is verified by manual code review only, same as the tick-bar and panel-chamfer features. The one piece that IS genuinely testable is `theme.ts`'s validation logic — see Task 3 for why the test only covers the pure `isValidTheme()` function and not the localStorage-touching `loadTheme()`/`saveTheme()` wrappers.

---

### Task 1: Add the RGB-triplet token and 6 theme blocks to app.css

**Files:**
- Modify: `src/app.css`

**Step 1: Add `--color-accent-rgb` to the existing `:root` block**

In the `:root { ... }` block, add this line right after `--color-accent-bright: #8ff0e0;`:

```css
  --color-accent-rgb: 103, 232, 249; /* R,G,B triplet matching --color-accent, for rgba() use in App.svelte */
```

**Step 2: Add 6 theme override blocks, after the `:root` block and before the `* { box-sizing: border-box; }` rule**

```css
[data-theme="cyan"] {
  --color-accent: #67e8f9;
  --color-accent-bright: #8ff0e0;
  --color-accent-rgb: 103, 232, 249;
  --color-border: rgba(103, 232, 249, 0.18);
  --color-border-strong: rgba(103, 232, 249, 0.4);
}
[data-theme="green"] {
  --color-accent: #67f9a8;
  --color-accent-bright: #8ffdc4;
  --color-accent-rgb: 103, 249, 168;
  --color-border: rgba(103, 249, 168, 0.18);
  --color-border-strong: rgba(103, 249, 168, 0.4);
}
[data-theme="blue"] {
  --color-accent: #6798f9;
  --color-accent-bright: #8fb0fd;
  --color-accent-rgb: 103, 152, 249;
  --color-border: rgba(103, 152, 249, 0.18);
  --color-border-strong: rgba(103, 152, 249, 0.4);
}
[data-theme="red"] {
  --color-accent: #f96767;
  --color-accent-bright: #fd8f8f;
  --color-accent-rgb: 249, 103, 103;
  --color-border: rgba(249, 103, 103, 0.18);
  --color-border-strong: rgba(249, 103, 103, 0.4);
}
[data-theme="white"] {
  --color-accent: #e8e8f0;
  --color-accent-bright: #ffffff;
  --color-accent-rgb: 232, 232, 240;
  --color-border: rgba(232, 232, 240, 0.18);
  --color-border-strong: rgba(232, 232, 240, 0.4);
}
[data-theme="gray"] {
  --color-accent: #a0a8b0;
  --color-accent-bright: #c0c8d0;
  --color-accent-rgb: 160, 168, 176;
  --color-border: rgba(160, 168, 176, 0.18);
  --color-border-strong: rgba(160, 168, 176, 0.4);
}
```

Notes:
- `[data-theme="cyan"]` intentionally duplicates `:root`'s current values exactly. This is deliberate, not redundant: it makes cyan a real, explicit theme selectable through the same mechanism as the other 5, rather than "whatever happens to be in `:root`." `:root`'s own values stay as they are, acting as the fallback if `data-theme` is ever unset for any reason.
- These 6 hex values are a reasoned starting point (same brightness/saturation as cyan, hue-shifted) per the design doc — expect to tune them once viewable in a browser, same caveat as every other visual value this session.
- Only these 5 tokens change per theme. `--color-bg-deep`, `--color-bg-mid`, `--color-panel-bg`, `--color-panel-bg-strong`, `--color-text-*`, `--color-warning`, `--color-danger`, `--color-success` stay constant across all themes — do not add theme overrides for these.

**Step 2: No automated test** (pure CSS values). Read back the file and confirm all 6 blocks have exactly 5 properties each, with correctly matching RGB triplets between the hex color and its `-rgb` variant (e.g. `#67f9a8` ↔ `103, 249, 168` — verify by converting hex to decimal if you added new values, or just double-check the ones given above match).

**Step 3: Commit**

```bash
git add src/app.css
git commit -m "feat: add theme tokens and 6 theme presets to app.css"
```

---

### Task 2: Fix hardcoded accent colors in App.svelte to use the new RGB token

**Files:**
- Modify: `src/App.svelte`

**Why this matters:** these spots currently use literal `rgba(103, 232, 249, X)` values. Switching `--color-accent`'s value (via Task 1's theme blocks) does nothing to them — they'd stay cyan regardless of the selected theme. This task makes them repaint correctly with every theme.

**Step 1: Find and replace each of these exactly, preserving each one's existing alpha value**

In `.stat-pill`:
```css
    background: rgba(103, 232, 249, 0.08);
    border: 1px solid rgba(103, 232, 249, 0.2);
```
becomes:
```css
    background: rgba(var(--color-accent-rgb), 0.08);
    border: 1px solid rgba(var(--color-accent-rgb), 0.2);
```

In `.icon-btn`:
```css
    background: rgba(103, 232, 249, 0.1);
    border: 1px solid rgba(103, 232, 249, 0.25);
```
becomes:
```css
    background: rgba(var(--color-accent-rgb), 0.1);
    border: 1px solid rgba(var(--color-accent-rgb), 0.25);
```

In `.resource-card`:
```css
    border: 1px solid rgba(103, 232, 249, 0.14);
```
becomes:
```css
    border: 1px solid rgba(var(--color-accent-rgb), 0.14);
```

In `.tick-bar-track`:
```css
    border: 1px solid rgba(103, 232, 249, 0.14);
```
becomes:
```css
    border: 1px solid rgba(var(--color-accent-rgb), 0.14);
```

In `.module-card`:
```css
    border: 1px solid rgba(103, 232, 249, 0.12);
```
becomes:
```css
    border: 1px solid rgba(var(--color-accent-rgb), 0.12);
```

In `.buy-btn`:
```css
    background: rgba(103, 232, 249, 0.15);
```
becomes:
```css
    background: rgba(var(--color-accent-rgb), 0.15);
```

**Do not touch** `.prestige-btn`, `.dev-btn`, `.dev-panel`-related rules, or anything using `rgba(251, 191, 36, ...)` (amber/warning) or `#fcd34d` — those are the dev-panel's intentionally distinct warning-color scheme, not accent-color usages, and are explicitly out of scope for theming per the design doc (only "primary"/accent colors are themed, not semantic colors).

**Step 2: No automated test.** Read back the file and grep for `rgba(103, 232, 249` — it should return zero matches after this task (everything using that literal triplet should now reference `var(--color-accent-rgb)` instead). Any remaining `rgba(103, 232, 249, ...)` occurrence means you missed a spot.

**Step 3: Commit**

```bash
git add src/App.svelte
git commit -m "fix: use --color-accent-rgb instead of hardcoded cyan in App.svelte"
```

---

### Task 3: Create the theme module with a real, executable unit test

**Files:**
- Create: `src/lib/theme.ts`
- Test: Create `src/lib/theme.test.ts`

**Why this file lives outside `src/lib/game/`:** everything under `src/lib/game/` (`model.ts`, `tick.ts`, `save.ts`, `format.ts`) is game-state logic — the save file contract, tick math, the data model. Theme is a display preference explicitly designed (per the design doc) to persist independently of the save file and survive a "delete save." Putting it in `save.ts` would blur that file's stated scope ("Save file contract — tech spec §6," per its own header comment). `src/lib/theme.ts` (a plain `.ts` module, not a Svelte component, so not alongside `Panel.svelte`/`Starfield.svelte` either) is a clean, small home of its own.

**Why the test only covers `isValidTheme()`, not `loadTheme()`/`saveTheme()`:** this project's Vitest setup (see `vite.config.ts` — no `test.environment` configured) runs in Vitest's default `node` environment, which has no global `localStorage` object. The existing `saveToLocalStorage`/`loadFromLocalStorage`/`clearSave` functions in `save.ts` are similarly never directly unit-tested for the same reason — only the pure `migrate()` function has a test. This plan follows that same precedent rather than introducing a `jsdom` environment change as an unrelated side quest: the pure validation logic (`isValidTheme`) gets a real test; the thin `localStorage`-touching wrappers around it don't.

**Step 1: Write the failing test**

Create `src/lib/theme.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isValidTheme, THEME_NAMES, DEFAULT_THEME } from "./theme";

describe("isValidTheme", () => {
  it("accepts every name in THEME_NAMES", () => {
    for (const name of THEME_NAMES) {
      expect(isValidTheme(name)).toBe(true);
    }
  });

  it("rejects an unknown theme name", () => {
    expect(isValidTheme("purple")).toBe(false);
  });

  it("rejects null", () => {
    expect(isValidTheme(null)).toBe(false);
  });

  it("DEFAULT_THEME is itself a valid theme name", () => {
    expect(isValidTheme(DEFAULT_THEME)).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/theme.test.ts`
Expected: FAIL — `./theme` doesn't exist yet.

**Step 3: Write the implementation**

Create `src/lib/theme.ts`:

```ts
// Theme persistence — a display preference, deliberately separate from
// src/lib/game/save.ts's save-file contract so it survives a "delete save."

export const THEME_NAMES = ["cyan", "green", "blue", "red", "white", "gray"] as const;
export type ThemeName = (typeof THEME_NAMES)[number];

export const DEFAULT_THEME: ThemeName = "cyan";

const THEME_KEY = "fleet_admiral_theme";

// Swatch preview colors for the options menu — intentionally duplicated
// from app.css's [data-theme="..."] blocks rather than read back from
// computed styles, since that would require a DOM measurement trick for
// no real benefit in a 6-entry hobby-scope lookup table. Keep these in
// sync with app.css by hand if a theme's accent color ever changes.
export const THEME_PREVIEW_COLORS: Record<ThemeName, string> = {
  cyan: "#67e8f9",
  green: "#67f9a8",
  blue: "#6798f9",
  red: "#f96767",
  white: "#e8e8f0",
  gray: "#a0a8b0",
};

export function isValidTheme(name: string | null): name is ThemeName {
  return (THEME_NAMES as readonly string[]).includes(name ?? "");
}

export function loadTheme(): ThemeName {
  const raw = localStorage.getItem(THEME_KEY);
  return isValidTheme(raw) ? raw : DEFAULT_THEME;
}

export function saveTheme(name: ThemeName): void {
  localStorage.setItem(THEME_KEY, name);
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/theme.test.ts`
Expected: PASS (all 4 tests)

**Step 5: Commit**

```bash
git add src/lib/theme.ts src/lib/theme.test.ts
git commit -m "feat: add theme module with tested validation logic"
```

---

### Task 4: Apply the saved theme on load

**Files:**
- Modify: `src/App.svelte`

**Step 1: Import theme functions**

Add to the existing imports:

```ts
  import { loadTheme, saveTheme, THEME_NAMES, THEME_PREVIEW_COLORS, type ThemeName } from "./lib/theme";
```

**Step 2: Add a reactive `currentTheme` variable**

Near the other `let` state declarations (e.g. right after `let devPanelOpen = false;`):

```ts
  let currentTheme: ThemeName = "cyan";
  let optionsPanelOpen = false;
```

(`optionsPanelOpen` is declared here too since Task 6 needs it — declaring both now keeps this task and Task 6 from touching the same line twice.)

**Step 3: Apply the saved theme at the start of `onMount`**

At the very top of the `onMount(() => { ... })` callback, before the `loadFromLocalStorage()` call:

```ts
    currentTheme = loadTheme();
    document.documentElement.dataset.theme = currentTheme;
```

**Step 4: Add a function to change themes (used by Task 6's swatch buttons)**

Near `resetSave()`:

```ts
  function setTheme(name: ThemeName) {
    currentTheme = name;
    document.documentElement.dataset.theme = name;
    saveTheme(name);
  }
```

**Step 5: No automated test** (DOM/onMount wiring, not pure logic — `loadTheme()`/`saveTheme()`'s own logic is already tested in Task 3). Read back the file and confirm `currentTheme` is set before `document.documentElement.dataset.theme`, and that this happens before the existing offline-catch-up logic (order doesn't functionally matter here, but keep it at the top for readability — theme should visually apply as early as possible).

**Step 6: Commit**

```bash
git add src/App.svelte
git commit -m "feat: apply saved theme on load, add setTheme function"
```

---

### Task 5: Relabel the dev icon, add the new options gear icon

**Files:**
- Modify: `src/App.svelte`

**Step 1: Relabel the existing dev-only button**

Find:
```svelte
        {#if DEV_MODE_ENV}
          <button class="icon-btn" on:click={() => (devPanelOpen = !devPanelOpen)} title="Toggle debug panel">⚙</button>
        {/if}
```

Replace the button's content (only the emoji/glyph, not the whole element) so it reads "Dev" instead of "⚙":

```svelte
        {#if DEV_MODE_ENV}
          <button class="icon-btn" on:click={() => (devPanelOpen = !devPanelOpen)} title="Toggle debug panel">Dev</button>
        {/if}
```

**Step 2: Add the new, always-visible options button right after it**

```svelte
        <button class="icon-btn" on:click={() => (optionsPanelOpen = !optionsPanelOpen)} title="Options">⚙</button>
```

This one is NOT wrapped in `{#if DEV_MODE_ENV}` — it must be visible in production. The full `.header-right` block should now read:

```svelte
      <div class="header-right">
        <div class="stat-pill">
          <div class="stat-label">Augment Pts</div>
          <div class="stat-value">{formatNumber(state.augmentPoints)}</div>
        </div>
        <div class="stat-pill">
          <div class="stat-label">Multiplier</div>
          <div class="stat-value">×{mult.toFixed(2)}</div>
        </div>
        {#if DEV_MODE_ENV}
          <button class="icon-btn" on:click={() => (devPanelOpen = !devPanelOpen)} title="Toggle debug panel">Dev</button>
        {/if}
        <button class="icon-btn" on:click={() => (optionsPanelOpen = !optionsPanelOpen)} title="Options">⚙</button>
      </div>
```

**Step 3: No automated test.** Read back the header markup and confirm: the dev button still only renders inside `{#if DEV_MODE_ENV}`, the new options button has no such guard, and both buttons reuse the existing `.icon-btn` class (no new CSS needed for this task).

**Step 4: Commit**

```bash
git add src/App.svelte
git commit -m "feat: relabel dev icon to text, add always-visible options gear icon"
```

---

### Task 6: Add the options panel (theme swatches + Delete Save button)

**Files:**
- Modify: `src/App.svelte`

**Step 1: Add the panel markup**

In `<main class="main">`, add this new conditional panel. Position doesn't need to be exact, but a reasonable spot is right after the closing `</Panel>` of the RESOURCES section and before the TICK panel (or anywhere else in the `<main>` list — it's independent of the others):

```svelte
      {#if optionsPanelOpen}
        <Panel>
          <div class="panel-title">OPTIONS</div>
          <div class="theme-row">
            {#each THEME_NAMES as name}
              <button
                class="theme-swatch"
                class:active={currentTheme === name}
                style="background:{THEME_PREVIEW_COLORS[name]}"
                title={name}
                on:click={() => setTheme(name)}
              ></button>
            {/each}
          </div>
          <button class="dev-btn danger" on:click={() => (deleteModalOpen = true)}>Delete Save</button>
        </Panel>
      {/if}
```

(`deleteModalOpen` is declared in Task 7 — this task references it, Task 7 defines it. If executing tasks strictly in order this means Task 6 alone would leave a reference to an undeclared variable; that's fine for a moment mid-plan, since Task 7 immediately follows and both land before anyone runs `npm run check`. If you want to avoid a transient broken-reference state, declare `let deleteModalOpen = false;` in this task instead, alongside `currentTheme`/`optionsPanelOpen` from Task 4 — either is fine, just be consistent.)

**Step 2: Add supporting CSS**

In the `<style>` block, add (near `.dev-row`/`.dev-btn`, since this reuses that visual language):

```css
  .theme-row { display: flex; gap: 8px; margin-bottom: 12px; }
  .theme-swatch {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
    padding: 0;
  }
  .theme-swatch.active {
    border-color: var(--color-text-primary);
  }
```

**Step 3: No automated test.** Read back and confirm the `{#each THEME_NAMES as name}` loop correctly references the imported `THEME_NAMES`/`THEME_PREVIEW_COLORS` (from Task 4's import), and that `class:active={currentTheme === name}` uses Svelte's class-directive syntax correctly (matches the existing `class:active={speed === s}` pattern already used in the dev panel's speed buttons — same technique, already proven to work in this codebase).

**Step 4: Commit**

```bash
git add src/App.svelte
git commit -m "feat: add options panel with theme swatches and delete-save trigger"
```

---

### Task 7: Add the delete-confirmation modal

**Files:**
- Modify: `src/App.svelte`

**This is the first modal in this codebase — read this before touching anything.**

`.root` (the outermost wrapping div) has `overflow: hidden`, and `Panel.svelte`'s `.panel` class has both `filter: drop-shadow(...)` and `backdrop-filter: blur(10px)`. Both `filter` and `backdrop-filter` (like `transform`) create a new **containing block** for `position: fixed` descendants — meaning if the modal's full-screen backdrop were rendered *inside* a `<Panel>` (e.g. nested inside the OPTIONS panel from Task 6), `position: fixed` would position it relative to that `<Panel>`'s own box instead of the actual browser viewport, breaking the "cover the whole screen" effect.

**The fix: the modal backdrop must be a direct child of `<div class="root">`, as a sibling to `<div class="frame">` — not nested inside `.frame`, not nested inside any `<Panel>`.** `.root` itself only has `overflow: hidden` and `position: relative`, neither of which affects `position: fixed` descendants, so this placement is safe.

**Step 1: Declare state**

Alongside `currentTheme`/`optionsPanelOpen` (or wherever Task 6 left it, per that task's note):

```ts
  let deleteModalOpen = false;
  let deleteConfirmText = "";
```

**Step 2: Add confirm/cancel functions**

Near `resetSave()`:

```ts
  function confirmDelete() {
    if (deleteConfirmText !== "DELETE") return;
    resetSave();
    deleteModalOpen = false;
    deleteConfirmText = "";
  }

  function cancelDelete() {
    deleteModalOpen = false;
    deleteConfirmText = "";
  }
```

**Step 3: Add the modal markup as a sibling of `.frame`, inside `.root`**

Find the end of the existing structure:

```svelte
<div class="root">
  <Starfield />
  <div class="frame">
    ...
  </div>
</div>
```

Add the modal block **after `</div>` that closes `.frame`, but still inside the `.root` div** (i.e., insert between `.frame`'s closing tag and `.root`'s closing tag):

```svelte
<div class="root">
  <Starfield />
  <div class="frame">
    ...
  </div>

  {#if deleteModalOpen}
    <div class="modal-backdrop">
      <Panel class="modal-dialog">
        <div class="panel-title">DELETE SAVE</div>
        <p class="modal-warning">This will permanently erase your progress. This can't be undone.</p>
        <p class="modal-instruction">Type <strong>DELETE</strong> to confirm.</p>
        <input class="modal-input" type="text" bind:value={deleteConfirmText} />
        <div class="modal-row">
          <button class="dev-btn" on:click={cancelDelete}>Cancel</button>
          <button class="dev-btn danger" disabled={deleteConfirmText !== "DELETE"} on:click={confirmDelete}>Delete</button>
        </div>
      </Panel>
    </div>
  {/if}
</div>
```

**Step 4: Add supporting CSS**

```css
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    padding: 20px;
  }
  .modal-dialog {
    max-width: 360px;
    width: 100%;
  }
  .modal-warning { font-size: 13px; color: var(--color-danger); line-height: 1.5; margin: 0 0 10px; }
  .modal-instruction { font-size: 12px; color: var(--color-text-secondary); margin: 0 0 8px; }
  .modal-input {
    width: 100%;
    padding: 8px 10px;
    margin-bottom: 14px;
    background: var(--color-panel-bg-strong);
    border: 1px solid var(--color-border-strong);
    border-radius: 8px;
    color: var(--color-text-primary);
    font-family: var(--font-mono);
    font-size: 13px;
  }
  .modal-row { display: flex; justify-content: flex-end; gap: 8px; }
```

`z-index: 100` only needs to beat `.frame`'s existing `z-index: 1` — both are positioned elements and siblings under `.root`, so this comparison is direct and doesn't depend on exactly which element establishes which stacking context.

There is deliberately no "click the backdrop to close" behavior — only the Cancel and Delete buttons close the modal. This is a simplicity choice (avoids accidental dismissal while someone's mid-typing the confirmation), not an oversight.

**Step 5: No automated test.** Read back and confirm: the `{#if deleteModalOpen}` block is a direct child of `.root`, NOT nested inside `.frame` or any `<Panel>` (this is the one thing in this task most likely to silently go wrong — double-check the indentation/nesting matches the snippet above exactly). Confirm the Delete button's `disabled` binding matches `deleteConfirmText !== "DELETE"` (case-sensitive, exact match, per the design doc).

**Step 6: Commit**

```bash
git add src/App.svelte
git commit -m "feat: add delete-save confirmation modal"
```

---

### Task 8: Session log and final commit

**Files:**
- Modify: `SESSION_LOG.md`

**Step 1: Append a session log entry**

```markdown

**Session 5** — Added a player-facing options menu (new always-visible gear
icon, distinct from the relabeled dev-only "Dev" button): 6 selectable
accent-color themes (cyan/green/blue/red/white/gray) via CSS custom
properties and a `data-theme` attribute, persisted separately from the
save file so theme survives a delete; and a typed-confirmation ("type
DELETE") modal — the first modal in this codebase — gating the existing
reset-save function for real players. Also fixed ~6 CSS rules that had
hardcoded cyan values instead of referencing the accent color token, which
would otherwise not have repainted on theme switch. Next: get eyes on this
in an actual browser — check all 6 themes actually look distinct and
readable, and confirm the delete modal correctly covers the full viewport
rather than being clipped or mispositioned (the one layout detail in this
feature that's easiest to get subtly wrong without seeing it rendered).
```

**Step 2: Commit**

```bash
git add SESSION_LOG.md
git commit -m "docs: log options menu / theme switcher session"
```

**Step 3: Do not push.** Same as every other feature this session — pushing to `origin/main` triggers a live Vercel production redeploy and needs the user's explicit go-ahead first.
