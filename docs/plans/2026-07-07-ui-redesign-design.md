# UI Redesign — Design

## Context

Since Phase 4 introduced the 5-tab bottom nav, every tab has just been a flat vertical stack of
`Panel` components — functional, but "messy" per the user, and now visibly strained: the just-shipped
Captain & Homeworld Talent Trees feature stacked a 4th and 5th panel onto Fleet Ops, and there is
currently NO visible UI at all for Fleet Admiral level/XP (the only trace of it is a plain "Admin
Points: X" line buried inside the Homeworld Talents panel).

This redesign is pure UI/layout restructuring of already-working functionality (missions, crafting,
leveling, both talent trees all work today) — no new game mechanics, with one exception: a global
tick refactor that the header design surfaced as a prerequisite (see below). Node.js/npm/tsc remain
unavailable in this environment — all verification during implementation will be manual code
tracing, not live rendering.

## 1. Global tick mechanics change

Today, `CaptainState.tickDurationSeconds` lets each captain run on their own cadence (currently all
defaulted to 10s, nothing has ever diverged them, but the field was deliberately built to support
future divergence). The user wants ONE true fleet-wide tick ("every 10 seconds, things happen") that
drives every captain in lockstep, since the new global header (below) needs a single tick bar to
display, not one per captain.

- `GameState` gains `tickDurationSeconds: number` (default 10). `CaptainState.tickDurationSeconds` is
  removed entirely.
- `tick.ts`'s `tick()`: the per-captain `ticksElapsed = deltaSeconds / captain.tickDurationSeconds`
  becomes `ticksElapsed = deltaSeconds / state.tickDurationSeconds`, read once, applied to every
  captain uniformly.
- `App.svelte`'s live poll loop: the per-captain `captainCycles: Record<number, CaptainCycle>` map
  collapses into a single shared `{ barCycleStart, nowTick }` pair.
- `freshCaptainStack()` no longer sets `tickDurationSeconds`; `freshState()` sets the new top-level
  field instead.
- New save migration (v10→v11): backfill `state.tickDurationSeconds` from the first captain's old
  per-captain value if present, else default 10; strip the field off every captain object. Follows
  this file's absolute rule — never edit a prior migration body, only add a new numbered entry.

This forecloses "different ships could run different tick cadences" as a future design space, by
explicit user choice — noted here so a future session doesn't reintroduce per-captain cadence without
knowing this was deliberate.

## 2. Global always-on-top header bar

A new fixed bar, styled consistently with the existing bottom `.nav-tabs` bar, sitting between the
`FLEET ADMIRAL` title panel and the tab content, visible on every tab/sub-tab. Contents: Fleet Admiral
**Level {n}**, an XP bar (**{xp} / {xpForNextLevel} XP**), and the global tick bar (progress + seconds
remaining) driven by the new fleet-wide cadence from Section 1.

This fully replaces today's per-captain TICK panel (deleted, along with its
`activeCycle`/`activeBarSeconds`/`activeTickProgress`/`activeTickRemaining` reactive statements — no
longer meaningful once the tick is fleet-wide, not captain-scoped). `.frame`'s top padding grows
slightly to clear the new bar's height, mirroring how its bottom padding already clears the fixed
bottom nav.

## 3. Bottom nav restructuring

Six bottom tabs, replacing today's five: **Homeworld / Sector Space / Fleet Captain's / Fleet
Operations / Battlespace / System**. `TabKey` drops `"fleetOps"` and gains `"fleetCaptains"` +
`"fleetOperations"`.

## 4. `<SubTabs>` component

New `src/lib/SubTabs.svelte` — a small presentational component in the same spirit as `Panel.svelte`.
Props: an array of `{ key, label }` entries and the current active key; emits a selection event.
Renders a horizontal pill row, styled as a lighter/smaller variant of the existing `.captain-tab`
look (reused pattern, not reinvented). Each top-level tab that needs sub-navigation owns its own
`activeXSubTab` state variable in `App.svelte` and renders one `<SubTabs>` instance below the bottom
nav / above that tab's content — no shared/global sub-tab state, no router.

Sub-tab breakdown (every tab with 2+ panels gets one; tabs with a single placeholder panel don't):

- **Homeworld**: Resources · Refinery/Fabrication · Homeworld Talents
- **Fleet Captain's**: Overview · Talents (see Section 5)
- **Fleet Operations**: none yet — today's single mission list has nothing to categorize until ship
  types exist (see "Explicitly deferred" below)
- **System**: Options · Log (+ Debug, dev-mode only)
- **Sector Space / Battlespace**: unchanged, single placeholder panel each

## 5. Fleet Captain's tab

Below the bottom nav and its Overview/Talents `<SubTabs>` row, the content area splits horizontally:
a narrow left-side column listing every captain (replacing today's horizontal `.captain-tabs` pill
row with a permanent vertical list, since this is now a persistent side panel rather than a one-off
row), and the remaining width shows whichever sub-tab is active for the selected captain.
`activeCaptainIndex` (already exists) drives the selection — same variable, new surrounding layout.

- **Overview**: today's Captain Leveling panel content (Level, XP bar, Stat Points) plus a new
  read-only one-line mission status ("Currently on: Short Ore Run" / "Idle") — no dispatch/recall
  controls here; those live entirely in Fleet Operations (Section 6).
- **Talents**: today's Captain Talents panel (5-branch tree), unchanged in content, relocated here.

## 6. Fleet Operations tab

Mission-first, not captain-first. For each entry in `MISSIONS` (today: Short Ore Run, Long Ore Run),
one card shows:

- Every captain currently embarked on THAT specific mission (a mission type can have multiple
  captains on it concurrently — nothing in the data model limits this, each tracks independent
  `CaptainMissionState`), each with their own progress bar/phase readout and a Recall button —
  today's existing per-captain mission-progress markup, unchanged, just iterated across the whole
  fleet instead of scoped to one selected captain.
- A picker of eligible idle captains for dispatch. "Eligible" today simply means "idle" (no ship-type
  gating exists yet) — structuring it as a per-mission eligibility list now means future ship-type
  gating is a filter change on this same list, not a UI rework.

No sub-tabs needed this pass (see "Explicitly deferred").

## 7. Homeworld / System tab reorganization

Pure relocation, no logic changes: Home Planet storage → Resources sub-tab; the `RECIPES`-iterated
panels → Refinery/Fabrication sub-tab; Homeworld Talents panel → its own sub-tab. Options
(theme picker, Export/Delete Save) → Options sub-tab; Log panel → Log sub-tab; the dev-only debug
panel stays gated behind `DEV_MODE_ENV`, appearing under its own Debug sub-tab only when active.

## Explicitly deferred

- **Ship-type-gated mission categories in Fleet Operations.** Today `ShipType` is only ever
  `"resourcer"`; there is no ship-switching mechanic and no second ship type. Fleet Operations keeps
  today's exact mission list/logic this pass. Ship types, switching, and category-gated
  missions (e.g. "Patrol" requiring a Destroyer) are a dedicated future feature — logged in
  `SUGGESTIONS.md`.
- **Per-captain tick cadence divergence.** Deliberately removed by Section 1, not preserved as a
  disabled/future option.
