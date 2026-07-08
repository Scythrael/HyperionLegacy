# Scroll Containment & Locked Placeholders Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Convert the app shell from whole-page scroll (with fixed-position bars and pixel-guessed
padding clearance) to a fixed-height flex-column shell where only the active tab's content scrolls,
then add a consistent "🔒 Coming Soon!" locked-placeholder pattern to sub-tabs, the captain list, and
the Sector Space/Battlespace placeholders.

**Architecture:** Part 1 (Task 1) restructures `.root`/`.frame` into a fixed-height flex column with
one scrollable region per tab (`.tab-scroll-area`), removing the fragile fixed-position/padding-guess
approach entirely. Part 2 (Tasks 2-5) is independent, additive UI: a `locked` flag on `SubTabs`,
extra locked sub-tab entries, locked captain-list slots up to a roadmap cap of 10, and a matching
restyle for the two whole-tab placeholders.

**Tech Stack:** Svelte 5 (non-runes: plain `let`/`$:`, `<slot />`), TypeScript, Vitest (configured but
unexecutable — no Node/npm/tsc in this environment; every verification step is manual code tracing).

**Design doc:** `docs/plans/2026-07-07-scroll-containment-locked-placeholders-design.md`.

---

## Read this before starting

Task 1 is **HIGH RISK**: it touches the same fixed-position/safe-area-inset CSS that 3+ tasks in the
immediately-prior UI Redesign carefully tuned (`.top-bar`, `.nav-tabs`, `.frame`'s padding). Read the
ENTIRE current `src/App.svelte` fresh before touching anything — don't trust this plan's inline code
snippets to be byte-exact against the current file; re-derive from what's actually there.

**A real, expected visual side effect of Task 1, worth flagging to the user once implemented:**
today, `.top-bar` and `.nav-tabs` use `position: fixed; left: 0; right: 0`, which makes them span the
FULL browser viewport width edge-to-edge on desktop, ignoring `.frame`'s `max-width: 720px` cap
entirely (a `SUGGESTIONS.md` entry — "Full-width panels" — already flags this 720px cap as an
existing, deliberate, not-yet-revisited constraint). After Task 1, `.top-bar`/`.nav-tabs` become
normal flex children of `.frame`, so they'll be constrained to the same 720px centered column as
everything else — MORE consistent with the rest of the app, but a visible change from today's
full-bleed bars on wide screens. This is not a bug; call it out explicitly when reporting Task 1 done.

---

### Task 0: Set up git worktree

Use `superpowers:using-git-worktrees`. `.worktrees/` already exists and is gitignored. Branch name:
`feat/scroll-containment-locked-placeholders`. Base: `main`, at the commit that added this plan doc.

---

### Task 1: App shell restructuring (scroll containment) — HIGH RISK

**Files:**
- Modify: `src/App.svelte`

**Step 1: Read the entire current file.** Confirm the exact current nesting:
`.root` > `Starfield` + `.frame` > `Panel.header` + `.top-bar` + `<main class="main">` (which contains
`.nav-tabs` FIRST, then every `{#if activeTab === ...}` block). Confirm the exact current CSS for
`.root`, `.frame`, `.top-bar`, `.nav-tabs`, `.main`.

**Step 2: Restructure the markup.** The new order, all still inside `.frame`:

```
Panel.header (unchanged internals)
.top-bar (unchanged internals)
.tab-body                              <-- NEW wrapper, replaces <main class="main">
  {#if activeTab === "homeworld"}
    <SubTabs ... />                    <-- stays OUTSIDE .tab-scroll-area (doesn't scroll away)
    <div class="tab-scroll-area">      <-- NEW wrapper around the tab's actual panel content
      {#if activeHomeworldSubTab === "resources"} ...HOME PLANET Panel... {/if}
      {#if activeHomeworldSubTab === "refinery"} ...RECIPES {#each}... {/if}
      {#if activeHomeworldSubTab === "talents"} ...HOMEWORLD TALENTS Panel... {/if}
    </div>
  {/if}

  {#if activeTab === "sectorSpace"}
    <div class="tab-scroll-area">
      ...SECTOR SPACE Panel (see Task 5 for its restyle)...
    </div>
  {/if}

  {#if activeTab === "fleetCaptains"}
    <SubTabs ... />
    <div class="tab-scroll-area">
      ...the existing .fleet-captains-layout div (captain list + content pane)...
    </div>
  {/if}

  {#if activeTab === "fleetOperations"}
    <div class="tab-scroll-area">
      {#each Object.entries(MISSIONS) as [missionKey, missionDef]} ...Panel... {/each}
    </div>
  {/if}

  {#if activeTab === "battlespace"}
    <div class="tab-scroll-area">
      ...BATTLESPACE Panel (see Task 5 for its restyle)...
    </div>
  {/if}

  {#if activeTab === "system"}
    <SubTabs ... />
    <div class="tab-scroll-area">
      {#if activeSystemSubTab === "options"} ...OPTIONS Panel... {/if}
      {#if DEV_MODE_ENV && activeSystemSubTab === "debug"} ...dev-panel... {/if}
      {#if activeSystemSubTab === "log"} ...LOG Panel... {/if}
    </div>
  {/if}
.nav-tabs                              <-- MOVED here, now LAST inside .frame (was first inside <main>)
```

Every panel's INTERNAL markup (the `{@const}` bindings, event handlers, class bindings) must be
byte-identical to what's there now — this task only adds/moves wrapper elements
(`.tab-body`/`.tab-scroll-area`) and relocates `.nav-tabs` in the DOM; it does not touch any panel's
own content.

**Step 3: Replace the CSS.** Remove the old `.main` rule and the old `.top-bar`/`.nav-tabs`
fixed-position rules, replacing with:

```css
.root {
  /* Was min-height: 100dvh -- now a HARD height, so this flex column never
     grows past the viewport. The ONE scrollable region below
     (.tab-scroll-area, per active tab) absorbs overflow instead of the
     whole page growing underneath the header/nav bars, which is the entire
     point of this change -- see docs/plans/2026-07-07-scroll-containment-
     locked-placeholders-design.md. */
  height: 100dvh;
  position: relative;
  overflow: hidden;
}
.frame {
  position: relative;
  z-index: 1;
  height: 100%; /* fills .root's fixed viewport height exactly */
  max-width: 720px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  overflow: hidden; /* only .tab-scroll-area (nested inside) actually scrolls */
  /* Horizontal 16px inset unchanged from before. Top padding now the ONLY
     place safe-area-inset-top is handled (moved off .top-bar below -- since
     .top-bar sits BELOW Panel.header now instead of being pinned flush
     against the screen edge via position:fixed, .frame's own top edge is
     the one flush against the real viewport edge that needs notch/status-
     bar clearance). Bottom padding is 0 -- .nav-tabs (now the last flex
     child, flush against .frame's own bottom edge) handles its own bottom
     safe-area clearance directly, same as it always has. */
  padding: calc(20px + env(safe-area-inset-top, 0px)) 16px 0;
}
```

```css
.top-bar {
  /* position/top/left/right/z-index REMOVED -- normal flex child now,
     visually still "the bar right below the header," just via document
     flow instead of position:fixed. Visual look (background/border/shadow)
     unchanged. */
  background: var(--color-panel-bg-strong);
  border-bottom: 1px solid rgba(var(--color-accent-rgb), 0.3);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
  padding: 10px 16px;
  flex-shrink: 0; /* never compresses, even if .tab-scroll-area's content is tall */
}
```

```css
.tab-body {
  /* Replaces the old .main rule (same class removed from the <main> tag in
     the template -- <main> becomes <main class="tab-body">). This is the
     ONE flexible region between the fixed top-bar and the fixed bottom nav
     -- flex:1 + min-height:0 is the standard flexbox idiom that lets a flex
     child actually SHRINK below its content's natural height (without
     min-height:0, a flex child defaults to min-height:auto, which would let
     its content push .frame taller than the viewport instead of triggering
     the inner scrollbar -- this is the single most common way this exact
     kind of layout silently breaks, so don't drop it). */
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding-top: 14px; /* gap below .top-bar, whether the tab's first child is a <SubTabs> row or .tab-scroll-area directly */
}
.tab-scroll-area {
  /* THE scrollable region -- every tab wraps its actual panel content in
     exactly one of these. Same flex:1 + min-height:0 idiom as .tab-body
     above, but this time paired with overflow-y:auto so IT (not the page)
     is what actually scrolls. */
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px; /* preserves the old .main's gap:14px spacing between stacked panels, now scoped to just the scrollable region */
  padding-bottom: 14px; /* breathing room at the very bottom of scrolled content, above .nav-tabs */
}
```

```css
.nav-tabs {
  /* position/left/right/bottom/z-index REMOVED -- normal flex child now,
     placed LAST inside .frame (see Step 2's markup reorder) so it's the
     bottom-most thing in the flex column, visually identical to today's
     "pinned to the bottom of the screen" look, just via document flow. */
  display: flex;
  background: var(--color-panel-bg-strong);
  border-top: 1px solid rgba(var(--color-accent-rgb), 0.3);
  box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.35);
  padding-bottom: env(safe-area-inset-bottom, 0px); /* unchanged -- still the flush-bottom element, still needs this */
  flex-shrink: 0;
}
```

**Step 4: Manual verification (no dev server available — this is a careful re-read, not a live check).**

For EVERY one of the 6 tabs, re-read the final markup and confirm:
1. The tab's `{#if activeTab === "..."}` block's content is now wrapped in exactly one
   `<div class="tab-scroll-area">`, and (for Homeworld/Fleet Captain's/System) any `<SubTabs>` call
   sits OUTSIDE/ABOVE that wrapper, still inside the outer `{#if}`.
2. No panel's internal markup changed — diff each panel's content against what it looked like before
   this task started.
3. `.nav-tabs` appears exactly once, now as the LAST element inside `.frame` (after every
   `{#if activeTab === ...}` block), not first.
4. Brace-balance check: count `{#if}`/`{/if}` and `{#each}`/`{/each}` before and after your edit —
   they must match (this task only adds wrapper divs, it shouldn't change the count of Svelte control
   blocks at all).
5. Trace the CSS chain once more: `.root` (height:100dvh, overflow:hidden) → `.frame` (height:100%,
   flex column, overflow:hidden) → `.tab-body` (flex:1, min-height:0, overflow:hidden) →
   `.tab-scroll-area` (flex:1, min-height:0, overflow-y:auto). Confirm every one of these 4 elements
   has `min-height: 0` or is the outermost fixed-height anchor — a missing `min-height:0` anywhere in
   this chain is the classic silent-failure mode for this exact pattern.
6. Confirm `Starfield` (the decorative background) is untouched — still a direct child of `.root`,
   outside `.frame`, unaffected by any of this.

State explicitly in your self-review that this needs a live-device/browser check once deployed (no
way to visually confirm the scroll genuinely contains correctly in this environment) — flag the
desktop full-width-bar visual change mentioned in "Read this before starting" above too.

**Step 5: Commit**

```bash
git add src/App.svelte
git commit -m "refactor: contain scroll to a per-tab scrollable region instead of the whole page"
```

---

### Task 2: `SubTabs` locked-tab support

**Files:**
- Modify: `src/lib/SubTabs.svelte`

**Step 1: Read the current file in full** (it's short — created in the just-merged UI Redesign,
Task 5 of that plan).

**Step 2: Implement.** Replace the file's contents with:

```svelte
<script lang="ts">
  export let tabs: { key: string; label: string; locked?: boolean }[];
  export let active: string;
  export let onSelect: (key: string) => void;
</script>

<div class="sub-tabs">
  {#each tabs as tab}
    <button
      class="sub-tab"
      class:active={active === tab.key}
      class:locked={tab.locked}
      disabled={tab.locked}
      title={tab.locked ? "Coming soon — not yet available" : undefined}
      on:click={() => {
        if (!tab.locked) onSelect(tab.key);
      }}
    >
      {#if tab.locked}🔒 {/if}{tab.label}
    </button>
  {/each}
</div>

<style>
  .sub-tabs { display: flex; gap: 6px; margin-bottom: 14px; flex-wrap: wrap; }
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
  /* Locked tabs: grayed (same opacity:0.5 convention App.svelte's own
     .skill-node.locked/.module-card.locked already use), non-clickable
     (native `disabled` on the <button> -- the `if (!tab.locked)` guard in
     the click handler above is redundant belt-and-suspenders, since a
     disabled button never fires click at all, kept for clarity/defense in
     depth). Still hoverable -- disabled buttons keep responding to :hover
     and `title` tooltips in every real browser, so the subtle border
     brighten below acknowledges the hover without implying it's clickable. */
  .sub-tab.locked {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .sub-tab.locked:hover {
    border-color: rgba(var(--color-accent-rgb), 0.3);
  }
</style>
```

**Step 3: Manual verification.** Re-read the file once written. Confirm `tabs`' new `locked?: boolean`
field is optional (existing call sites that don't pass it must still compile/work — every entry
without `locked` is simply `undefined`, falsy, unlocked). Confirm the `disabled` attribute and the
`on:click` guard both correctly gate on the SAME `tab.locked` check.

**Step 4: Commit**

```bash
git add src/lib/SubTabs.svelte
git commit -m "feat: add locked-tab support to SubTabs"
```

---

### Task 3: Wire 2 locked placeholder sub-tabs into each `<SubTabs>` call site

**Files:**
- Modify: `src/App.svelte`

**Step 1**: Update all 3 `<SubTabs>` call sites' `tabs` arrays to append exactly 2 locked entries each,
using distinct dummy keys per call site (never reused across the whole file, so Svelte's `{#each}`
keying never collides even though these keys are never assigned to any state variable):

Homeworld's `<SubTabs>` (found inside `{#if activeTab === "homeworld"}`):
```svelte
tabs={[
  { key: "resources", label: "Resources" },
  { key: "refinery", label: "Refinery/Fabrication" },
  { key: "talents", label: "Homeworld Talents" },
  { key: "homeworldLocked1", label: "Coming Soon!", locked: true },
  { key: "homeworldLocked2", label: "Coming Soon!", locked: true },
]}
```

Fleet Captain's `<SubTabs>` (found inside `{#if activeTab === "fleetCaptains"}`):
```svelte
tabs={[
  { key: "overview", label: "Overview" },
  { key: "talents", label: "Talents" },
  { key: "fleetCaptainLocked1", label: "Coming Soon!", locked: true },
  { key: "fleetCaptainLocked2", label: "Coming Soon!", locked: true },
]}
```

System's `<SubTabs>` (found inside `{#if activeTab === "system"}`):
```svelte
tabs={[
  { key: "options", label: "Options" },
  { key: "log", label: "Log" },
  ...(DEV_MODE_ENV ? [{ key: "debug", label: "Debug" }] : []),
  { key: "systemLocked1", label: "Coming Soon!", locked: true },
  { key: "systemLocked2", label: "Coming Soon!", locked: true },
]}
```

None of `homeworldLocked1`/`homeworldLocked2`/`fleetCaptainLocked1`/`fleetCaptainLocked2`/
`systemLocked1`/`systemLocked2` need to be added to `HomeworldSubTab`/`FleetCaptainSubTab`/
`SystemSubTab`'s type unions — they're never assigned to `activeXSubTab` (Task 2's `disabled`
button + click guard means `onSelect` never fires for a locked tab), so the existing type unions stay
exactly as they are.

**Step 2: Manual verification.** Confirm each `<SubTabs>` call site now renders 2 more entries than
before, all 3 call sites' locked keys are unique strings not reused anywhere else in the file, and no
`activeXSubTab` state variable's type was touched.

**Step 3: Commit**

```bash
git add src/App.svelte
git commit -m "feat: add 2 locked placeholder sub-tabs to Homeworld, Fleet Captain's, and System"
```

---

### Task 4: Captain-list locked slots (up to 10)

**Files:**
- Modify: `src/App.svelte`

**Step 1**: Change the `.captain-list` block inside `{#if activeTab === "fleetCaptains"}` from:

```svelte
<div class="captain-list">
  {#each state.captains as captain, i}
    <button class="captain-list-item" class:active={i === activeCaptainIndex} on:click={() => (activeCaptainIndex = i)}>
      {captain.label}
    </button>
  {/each}
</div>
```

to:

```svelte
<div class="captain-list">
  {#each state.captains as captain, i}
    <button class="captain-list-item" class:active={i === activeCaptainIndex} on:click={() => (activeCaptainIndex = i)}>
      {captain.label}
    </button>
  {/each}
  <!-- Locked slots up to a roadmap max of 10 captains -- a genuine future
       signal (more Fleet Logistics unlock tiers planned later), not a
       promise with nothing behind it. Today's ACTUAL mechanic only supports
       growing to 4 captains (see model.ts's HOMEWORLD_TALENTS
       fleetLogisticsSlot1/2/3) -- slots 5-10 have no unlock path yet; see
       KNOWN_ISSUES.md (Task 6 of this plan). Array.from({length: N}) is
       used (not a bare {length: N} object) since Svelte's {#each} needs a
       real iterable/array, not just an array-like object. -->
  {#each Array.from({ length: Math.max(0, 10 - state.captains.length) }) as _, j}
    <div class="captain-list-item locked" title="Coming soon — not yet unlockable">
      🔒 Coming Soon!
    </div>
  {/each}
</div>
```

**Step 2**: Add CSS, right after the existing `.captain-list-item.active` rule:

```css
.captain-list-item.locked {
  opacity: 0.5;
  cursor: not-allowed;
}
.captain-list-item.locked:hover {
  border-color: rgba(var(--color-accent-rgb), 0.3);
}
```

**Step 3: Manual verification.** Hand-trace with `state.captains.length === 1` (a fresh game): the
`{#each Array.from({length: Math.max(0, 10-1)})}` produces exactly 9 locked rows, for a total of 10
rows in the list (1 real + 9 locked) — confirm the arithmetic. Hand-trace with
`state.captains.length === 4` (the current real max): exactly 6 locked rows, 10 total. Confirm the
locked `<div>` (not `<button>`) has no `on:click` at all, so it's non-interactive by construction, not
just visually disabled.

**Step 4: Commit**

```bash
git add src/App.svelte
git commit -m "feat: show captain-list slots up to 10, locked beyond the current roster"
```

---

### Task 5: Sector Space / Battlespace restyle

**Files:**
- Modify: `src/App.svelte`

**Step 1**: Change the SECTOR SPACE panel from:

```svelte
<Panel>
  <div class="panel-title">SECTOR SPACE</div>
  <p class="prestige-text">Shipyard and Starbase are still under construction.</p>
</Panel>
```

to:

```svelte
<Panel>
  <div class="panel-title">SECTOR SPACE</div>
  <p class="locked-heading">🔒 Coming Soon!</p>
  <p class="prestige-text">Shipyard and Starbase are still under construction.</p>
</Panel>
```

Apply the identical change to the BATTLESPACE panel (same structure, keep its existing sentence
`"PvP and PvE fleet operations will live here."` below the new heading line).

**Step 2**: Add CSS, near `.prestige-text`:

```css
.locked-heading {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-secondary);
  opacity: 0.7;
  margin: 0 0 6px;
}
```

**Step 3: Manual verification.** Confirm both panels' existing descriptive sentences are untouched,
just with the new heading line added above each.

**Step 4: Commit**

```bash
git add src/App.svelte
git commit -m "feat: restyle Sector Space/Battlespace placeholders to match the locked-content pattern"
```

---

### Task 6: Docs and final commit

**Files:**
- Modify: `KNOWN_ISSUES.md`

**Step 1**: Add an entry noting captain-list slots 5-10 have no unlock mechanic in
`HOMEWORLD_TALENTS` today (read 2 existing entries first for wording/style match — this file's
established convention, not a new format):

> Captain-list slots 5-10 (shown locked/"Coming Soon!") have no unlock mechanic behind them yet --
> `HOMEWORLD_TALENTS`' Fleet Logistics branch only defines 3 slot-unlock tiers
> (`fleetLogisticsSlot1/2/3`), capping the real fleet at 4 captains. Slots 5-10 are a deliberate
> future-roadmap signal (more Fleet Logistics tiers planned later), not a bug -- but there's
> currently no in-game path to ever reach them. Add more `unlockCaptainSlot`-effect entries to
> `HOMEWORLD_TALENTS` when that's ready.

**Step 2: Commit**

```bash
git add KNOWN_ISSUES.md
git commit -m "docs: log Scroll Containment & Locked Placeholders session"
```

**Step 3: Do not push.** Needs the user's explicit go-ahead first.
