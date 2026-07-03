# Chamfered HUD Panel Style — Design

*Approved 2026-07-02.*

## Purpose

Replace the current rounded-rectangle `.panel` style with an angular,
sci-fi HUD-inspired look across the whole app: chamfered (cut) corners,
a glowing border, and small corner accent marks — inspired by a reference
image the user shared, recolored to the app's existing cyan/teal theme
tokens rather than the reference's white/monochrome palette.

## Scope

- Applies to **every** panel in the app: header, Resources, Tick,
  Generator Stack, Prestige, the dev-only debug panel, and Log. One
  consistent visual language, no exceptions.
- Also applies (at a smaller scale) to the tick bar's track element.
- Background (Starfield + dark gradient) is explicitly **unchanged** —
  this redesign is scoped to panels and the tick bar only, not a grid
  overlay or other background changes.
- Color scheme is explicitly **unchanged** — same CSS custom properties
  (`--color-accent`, `--color-border`, etc.) from `src/app.css`, just a
  different shape/border treatment applied to them.

## Geometry

All 4 corners of every panel are chamfered (cut at 45°) via
`clip-path: polygon(...)`, with a cut size of `14px` — chosen to roughly
match the current `border-radius: 14px`, so panels keep a similar visual
footprint to today. The existing `border: 1px solid var(--color-border)`
is kept as-is; `clip-path` correctly clips borders to follow the new
chamfered outline with no extra work.

## Glow

**Decision: use `filter: drop-shadow()`, not `box-shadow`.**

This is not a cosmetic preference — it's a real technical constraint.
`clip-path` clips the *entire* rendered element, including `box-shadow`.
A `box-shadow`-based glow would render correctly along straight edges but
visibly cut off right at each chamfered corner, since the shadow is
computed against the original rectangular box before it gets clipped to
the octagon shape. `filter: drop-shadow()` instead operates on the
element's actual rendered (post-clip) silhouette, so the glow correctly
wraps around the cut corners too.

Starting value: `filter: drop-shadow(0 0 8px rgba(103, 232, 249, 0.35))`
(roughly matching the current box-shadow's visual weight, using the
accent color rather than the current dark-teal tint, to read as an
intentional "HUD glow" rather than a soft ambient shadow).

## Corner Accents

A short (~8-10px) bright diagonal line in `var(--color-accent-bright)`
at each of the 4 cut corners, echoing the reference image's tick-marks.
Exact pixel placement is refined during implementation, not pinned to
the pixel in this doc.

## Component Architecture

**New component: `src/lib/Panel.svelte`.**

Currently every section in `App.svelte` is a bare
`<section class="panel">...</section>`, all sharing one `.panel` CSS
class. Repeating the corner-accent markup (extra small elements per
corner) at 6+ call sites would be error-prone and hard to keep in sync.
Instead, `Panel.svelte` centralizes the chamfer/border/glow/corner-accent
markup in one place:

- Accepts a `class` prop (default `""`) so panel-specific layout classes
  still apply — e.g. `<Panel class="header">` for the header's internal
  flex layout, `<Panel class="dev-panel">` for the debug panel's existing
  amber (`--color-warning`) border-color override.
- Renders its children via `<slot />` (this codebase's existing Svelte
  pattern — App.svelte and Starfield.svelte don't use Svelte 5 runes, so
  `Panel.svelte` matches that style rather than introducing snippets).
- Every `<section class="panel">` in `App.svelte` (6 call sites: header,
  Resources, Tick, Generator Stack, Prestige, dev panel, Log) becomes
  `<Panel>...</Panel>` (or `<Panel class="...">...</Panel>` where an
  existing modifier class applies).

## Tick Bar

Same chamfer technique, smaller scale: `~4px` cut corners, sized for the
existing 10px-tall `.tick-bar-track`. Track keeps its current translucent
background (`--color-panel-bg-strong`) — explicitly **not** made opaque,
per the "transparent against the background like it is now" requirement.

**No changes needed to `.tick-bar-fill`.** Because `clip-path` on a
parent element also crops the rendering of its children, applying the
chamfer to `.tick-bar-track` (which already has `overflow: hidden`)
automatically crops the plain-rectangle `.tick-bar-fill` bar to match the
same chamfered shape wherever it's visible — including at very low/high
fill percentages, with no risk of the corner-cut geometry glitching
against the fill's dynamically-changing width.

## Explicitly Out of Scope (deferred to a follow-up design)

The user also asked for an options/settings menu, full theme-color
switching (green/blue/red/white/black/gray, etc.), and an in-game
"delete save data" option visible to normal players (not just the
dev-only Reset Save button). These are a distinct, larger feature —
intentionally not designed here. This redesign's CSS-custom-property-only
approach (no hardcoded colors anywhere in the new styles) is exactly the
foundation a future theme switcher needs, so building this first is a
deliberate sequencing choice, not just a scoping convenience.
