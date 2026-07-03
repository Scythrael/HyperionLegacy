# Chamfered HUD Panel Style Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the app's rounded-rectangle `.panel` style with an angular, chamfered-corner HUD look (glowing border, corner accent marks), applied consistently across every panel via one new reusable component, plus a smaller-scale version on the tick bar's track.

**Architecture:** A new `src/lib/Panel.svelte` component centralizes the chamfer (`clip-path`), glow (`filter: drop-shadow`, not `box-shadow` — see Task 1), and corner-accent markup in one place. All 7 `<section class="panel">`/`<header class="panel header">` call sites in `src/App.svelte` are replaced with `<Panel>`. Two existing modifier styles (`.header`'s flex layout, `.dev-panel`'s border-color override) must move from `App.svelte`'s `<style>` block into `Panel.svelte`'s — see Task 4 for why this is required, not optional.

**Tech Stack:** Svelte 5 (this codebase's existing non-runes style — plain `let`/`$:`, `<slot />`), CSS `clip-path` + `filter: drop-shadow()`. No new dependencies.

**Design doc:** `docs/plans/2026-07-02-panel-chamfer-design.md` — read this first if anything below is ambiguous.

**A note on testing:** this is a purely visual/CSS change with no game-logic behavior to unit test — there's no TDD story here the way the tick-bar's data-model work had one. Node.js/npm is also unavailable in this dev environment (confirmed repeatedly this session), so there's no way to run a dev server or take a screenshot during implementation. Every task below is verified by careful manual code review (checking the CSS is syntactically valid and the Svelte scoping is correct — see Task 4's explanation of a real Svelte gotcha), not by looking at it. **Expect to need visual fine-tuning once you can actually view this in a browser** — treat the pixel values below as reasoned starting points, not final answers.

---

### Task 1: Create `Panel.svelte` with the base chamfered look

**Files:**
- Create: `src/lib/Panel.svelte`

**Step 1: Write the component**

```svelte
<script lang="ts">
  let className = "";
  export { className as class };
</script>

<section class="panel {className}">
  <slot />
</section>

<style>
  .panel {
    position: relative;
    padding: 16px;
    background: var(--color-panel-bg);
    backdrop-filter: blur(10px);
    border: 1px solid var(--color-border);
    filter: drop-shadow(0 0 8px rgba(103, 232, 249, 0.35));
    clip-path: polygon(
      14px 0,
      calc(100% - 14px) 0,
      100% 14px,
      100% calc(100% - 14px),
      calc(100% - 14px) 100%,
      14px 100%,
      0 calc(100% - 14px),
      0 14px
    );
  }
</style>
```

Notes on why this is written this way (don't second-guess these during implementation):

- `let className = ""; export { className as class };` is the standard Svelte idiom for accepting a `class` prop — `class` itself is a reserved word so it can't be used as the variable name directly, but consumers still write `<Panel class="...">` normally.
- `position: relative` is required now even though nothing needs it yet — Task 2's corner-accent marks are `position: absolute` and need this as their positioning parent.
- **`filter: drop-shadow()`, not `box-shadow`, is a deliberate, non-negotiable choice.** `clip-path` clips the entire rendered element, including `box-shadow` — a box-shadow-based glow would render fine along straight edges but visibly cut off right at each chamfered corner, because the shadow is computed against the original rectangular box before `clip-path` crops it to the octagon shape. `filter: drop-shadow()` instead operates on the element's actual post-clip silhouette, so the glow correctly wraps around the cut corners. Do not "simplify" this back to `box-shadow` — it will look broken at every corner.
- The `clip-path: polygon(...)` value is an 8-point octagon: each of the 4 corners gets two points spaced `14px` apart along the two edges meeting at that corner, producing a 45° cut of consistent size everywhere. `14px` was chosen to roughly match the panel's previous `border-radius: 14px`, keeping a similar visual footprint.

**Step 2: No automated test** (see the plan's testing note above). Read back the file once and confirm the `clip-path` polygon has exactly 8 comma-separated points and the `<style>` block isn't left with a hanging/missing bracket — that's the failure mode most likely to silently break every panel in the app at once.

**Step 3: Commit**

```bash
git add src/lib/Panel.svelte
git commit -m "feat: add Panel.svelte with chamfered-corner base style"
```

---

### Task 2: Add corner accent marks

**Files:**
- Modify: `src/lib/Panel.svelte`

**Step 1: Add the accent markup and styles**

Update the template to add 4 decorative elements after the slot:

```svelte
<section class="panel {className}">
  <slot />
  <span class="corner corner-tl" aria-hidden="true"></span>
  <span class="corner corner-tr" aria-hidden="true"></span>
  <span class="corner corner-bl" aria-hidden="true"></span>
  <span class="corner corner-br" aria-hidden="true"></span>
</section>
```

Add to the `<style>` block (after the `.panel` rule):

```css
  .corner {
    position: absolute;
    width: 12px;
    height: 2px;
    background: var(--color-accent-bright);
    pointer-events: none;
  }
  .corner-tl {
    top: 4px;
    left: -2px;
    transform: rotate(45deg);
    transform-origin: left center;
  }
  .corner-tr {
    top: 4px;
    right: -2px;
    transform: rotate(-45deg);
    transform-origin: right center;
  }
  .corner-bl {
    bottom: 4px;
    left: -2px;
    transform: rotate(-45deg);
    transform-origin: left center;
  }
  .corner-br {
    bottom: 4px;
    right: -2px;
    transform: rotate(45deg);
    transform-origin: right center;
  }
```

`aria-hidden="true"` is required — these are pure decoration, not content, and must not be announced by screen readers.

**Step 2: No automated test.** Read back the 4 corner rules and confirm each one pairs a correct `top`/`bottom` with `left`/`right` (no rule should set both `top` and `bottom`, or both `left` and `right`) and that the rotation direction is consistent with which edge it's meant to sit flush against (this is described precisely above — don't need to re-derive it, just confirm the code matches). These specific pixel offsets (`4px`, `-2px`, `12px` long) are a reasoned starting point for a `14px` chamfer cut, not verified against a real render — flag in your task report that this may need adjustment once viewed in an actual browser.

**Step 3: Commit**

```bash
git add src/lib/Panel.svelte
git commit -m "feat: add corner accent marks to Panel.svelte"
```

---

### Task 3: Move `.header` and `.dev-panel` modifier styles into Panel.svelte

**Files:**
- Modify: `src/lib/Panel.svelte`

**This task exists to avoid a real, easy-to-miss Svelte bug — read this before touching anything.**

`App.svelte` currently has CSS rules `.header { display: flex; ... }` and `.dev-panel { border-color: ...; }` in its own `<style>` block, applied to `<header class="panel header">` and `<section class="panel dev-panel">` respectively. Task 4 (next) replaces those elements with `<Panel class="header">` and `<Panel class="dev-panel">`.

**This will silently break if `.header` and `.dev-panel` stay in `App.svelte`'s `<style>` block.** Svelte scopes component styles by adding a generated attribute (e.g. `svelte-xyz123`) only to elements written directly in that component's own template. The `<section>` that ends up carrying the `header`/`dev-panel` class is written inside `Panel.svelte`'s template (`<section class="panel {className}">`), not `App.svelte`'s — so a rule written in `App.svelte`'s scoped `<style>` block requires `App.svelte`'s own scoping attribute on the target element, which that `<section>` will never have. The layout would just silently stop applying (header's flex layout breaks, dev panel's amber border disappears) with no compile error — it would look wrong but nothing would tell you why.

The fix: since the `<section>` carrying these classes is `Panel.svelte`'s own element, the modifier rules belong in `Panel.svelte`'s own `<style>` block instead, where Svelte's scoping will correctly match them.

**Step 1: Add these two rules to `Panel.svelte`'s `<style>` block**

```css
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    margin-bottom: 16px;
  }
  .dev-panel {
    border-color: rgba(251, 191, 36, 0.5);
  }
```

(These are copied verbatim from `App.svelte`'s current `<style>` block — Task 4 removes them from there.)

**Step 2: No automated test.** This is purely a "will the CSS cascade correctly" concern, addressed by the explanation above, not by running anything.

**Step 3: Commit**

```bash
git add src/lib/Panel.svelte
git commit -m "feat: move header/dev-panel modifier styles into Panel.svelte for correct scoping"
```

---

### Task 4: Replace all `<section class="panel">` usages in App.svelte with `<Panel>`

**Files:**
- Modify: `src/App.svelte`

**Step 1: Import Panel**

Add to the `<script>` block's imports (near the top, alongside the existing `Starfield` import):

```ts
  import Panel from "./lib/Panel.svelte";
```

**Step 2: Replace each of the 7 call sites**

Find and replace each of these exactly (there are 7: the header plus 6 `<section>` panels):

1. Header — replace:
   ```svelte
   <header class="panel header">
   ```
   and its matching closing tag:
   ```svelte
   </header>
   ```
   with:
   ```svelte
   <Panel class="header">
   ```
   and:
   ```svelte
   </Panel>
   ```
   (Note: this changes the semantic HTML tag from `<header>` to `<section>` under the hood, since `Panel.svelte` always renders a `<section>`. This is an accepted, minor trade-off for a hobby prototype — not worth adding a `tag` prop to `Panel.svelte` just to preserve it.)

2. Resources, Tick, Generator Stack, Prestige, and Log sections — each currently:
   ```svelte
   <section class="panel">
   ```
   ...
   ```svelte
   </section>
   ```
   becomes:
   ```svelte
   <Panel>
   ```
   ...
   ```svelte
   </Panel>
   ```
   (5 occurrences — Resources, Tick, Generator Stack, Prestige, Log. Everything between the opening and closing tags stays exactly as-is; only the wrapping tag changes.)

3. Dev panel — currently:
   ```svelte
   <section class="panel dev-panel">
   ```
   ...
   ```svelte
   </section>
   ```
   becomes:
   ```svelte
   <Panel class="dev-panel">
   ```
   ...
   ```svelte
   </Panel>
   ```

**Step 3: Remove the now-redundant CSS from `App.svelte`'s `<style>` block**

Delete these three rules entirely from `App.svelte` (they now live in `Panel.svelte`, per Tasks 1 and 3):

```css
  .panel {
    padding: 16px;
    border-radius: 14px;
    background: var(--color-panel-bg);
    backdrop-filter: blur(10px);
    border: 1px solid var(--color-border);
    box-shadow: 0 0 24px rgba(30, 80, 100, 0.15);
  }
```

```css
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    margin-bottom: 16px;
  }
```

```css
  .dev-panel { border-color: rgba(251, 191, 36, 0.5); }
```

**Do not remove anything else** — `.header-left`, `.title`, `.subtitle`, `.header-right`, `.stat-pill`, `.stat-label`, `.stat-value`, `.icon-btn`, `.panel-title`, `.resource-grid`, `.resource-card`, `.tick-bar-*`, `.module-*`, `.buy-btn`, `.prestige-*`, `.dev-title`, `.dev-row`, `.dev-label`, `.dev-btn`, `.log-*` all stay exactly as they are — those style elements that are still written directly inside `App.svelte`'s own template (as children passed into `<Panel>`), which Svelte scopes correctly to `App.svelte` regardless of which component wraps them.

**Step 4: No automated test.** Read back `App.svelte` once and confirm: every `<Panel>` has a matching `</Panel>` (no leftover `</section>` or `</header>` closing tags from the old markup), the `Panel` import is present, and the three CSS rules above are actually gone (not just commented out).

**Step 5: Commit**

```bash
git add src/App.svelte
git commit -m "feat: use Panel component for all panels in App.svelte"
```

---

### Task 5: Apply a smaller chamfer to the tick bar's track

**Files:**
- Modify: `src/App.svelte`

**Step 1: Update `.tick-bar-track`**

Replace:

```css
  .tick-bar-track {
    height: 10px;
    border-radius: 6px;
    background: var(--color-panel-bg-strong);
    border: 1px solid rgba(103, 232, 249, 0.14);
    overflow: hidden;
  }
```

with:

```css
  .tick-bar-track {
    height: 10px;
    background: var(--color-panel-bg-strong);
    border: 1px solid rgba(103, 232, 249, 0.14);
    overflow: hidden;
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
```

(Same 8-point octagon technique as `Panel.svelte`, just with a `4px` cut sized for a 10px-tall bar instead of `14px`. `border-radius` is removed since `clip-path` replaces it — don't leave both, they'd conflict.)

**Do not touch `.tick-bar-fill`.** Because `clip-path` on a parent also crops its children's rendering, the plain-rectangle fill bar automatically appears chamfered wherever it's visible inside the track — including at very low or high fill percentages — with zero changes needed there. Adding a separate `clip-path` to `.tick-bar-fill` would be redundant at best and could visually glitch at low fill widths (where a `4px`-per-side cut could exceed the element's actual rendered width) at worst — do not add one.

**Step 2: No automated test.** Read back the rule and confirm `border-radius` was actually removed (not left alongside `clip-path`), and that `.tick-bar-fill`'s rule below it is completely unchanged.

**Step 3: Commit**

```bash
git add src/App.svelte
git commit -m "feat: apply smaller chamfer to tick bar track"
```

---

### Task 6: Session log and final commit

**Files:**
- Modify: `SESSION_LOG.md`

**Step 1: Append a session log entry**

```markdown

**Session 4** — Redesigned panel styling from rounded rectangles to an
angular, chamfered-corner HUD look (clip-path corners, drop-shadow glow,
corner accent marks) via a new reusable Panel.svelte component used by
every panel in the app, plus a matching smaller-scale treatment on the
tick bar's track. Options menu, theme switching, and an in-game delete-save
option are explicitly deferred to a follow-up design. Next: get eyes on
this in an actual browser and tune pixel values (chamfer size, glow
intensity, corner accent placement) before considering it finished.
```

**Step 2: Commit**

```bash
git add SESSION_LOG.md
git commit -m "docs: log panel chamfer redesign session"
```

**Step 3: Do not push.** Same as every other feature this session — pushing to `origin/main` triggers a live Vercel production redeploy and needs the user's explicit go-ahead first.
