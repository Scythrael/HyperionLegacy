# Research / Material Discovery — Design

*Approved 2026-07-03.*

## Purpose

Add the "Research" system from the design doc's §10.6 roadmap (next after
the panel/theme work), scoped down to fit the prototype's actual current
state rather than the master design doc's full vision.

## Scope Mismatch, Resolved

The master design doc's §4.8 "Research" assumes infrastructure that
doesn't exist yet in this prototype: an "Energy" resource, "material
families," "Relics," and a "synthesis" system. The prototype (per its own
§10.5 minimal scope) only has a 3-resource linear chain (ore → ingots →
components), one prestige tier, and the tick bar — no captains, crew,
ships, sectors, cargo, or missions.

**Decision:** build a right-sized version instead of the full vision.
Research here means: spend a resource, wait (in game-time) for a
timed project to complete, and permanently unlock a new 4th resource
tier + module. This captures the spirit of "research discovers new
things to produce" without needing Energy/synthesis/relics to exist
first. The full-game Research system (material families, RNG-driven
discovery, Energy-funded) remains a future iteration once those
prerequisites are built.

## New Resource + Module: Alloys / Synthesizer

Extends the existing generic patterns exactly, not a bespoke addition:

- `ResourceKey` gains `"alloys"`, added to `RESOURCE_ORDER`/`RESOURCE_LABEL`
  the same way `"components"` already is.
- `ModuleKey` gains `"synthesizer"`, added to `MODULES` the same way
  `"fabricator"` already is: `{ label: "Synthesizer", resource: "alloys",
  baseRate: 0.04, baseCost: 2500, costMult: 1.22, unit: "alloys/s" }`.
  These numbers continue the existing per-tier scaling trend (each tier
  roughly 3x slower production, 6-7x more expensive, and a slightly
  steeper cost curve than the tier before) — reasoned starting points,
  tunable after playtesting like every other balance number this session.
- Because `tick()`'s production loop already iterates `Object.keys(MODULES)`
  generically, **no changes are needed to `tick()`'s production math** —
  alloys will accrue correctly the moment a player owns a Synthesizer,
  exactly like the other three resources.
- Matches the existing, already-documented simplification that modules
  are independent parallel producers rather than a real consumption
  chain (`KNOWN_ISSUES.md`) — Synthesizer doesn't consume components to
  produce alloys, same as Refinery doesn't consume ore today.

## Research Mechanic

One research project for this iteration: **Alloy Synthesis**.

- Cost: `500 components`, paid upfront when the player clicks "Start
  Research" (deducted immediately, not refundable).
- Duration: `180 game-seconds` (3 minutes), tracked on the same game-time
  clock as ticks and offline catch-up — **not** a separate real-world
  timer. This is a deliberate architectural choice: research progresses
  through `tick()`'s existing closed-form delta-time mechanism, so it
  correctly advances during offline catch-up and the dev speed
  multiplier, consistent with how every other time-based system in this
  game already works. A separate wall-clock timer would be the one thing
  in this game that didn't follow that rule.
- State: a new `research: Record<ResearchKey, ResearchState>` field on
  `GameState`, where `ResearchKey = "alloySynthesis"` (for now — a record
  keyed by project name is the natural seam for adding a second project
  later without redesigning anything) and `ResearchState = { started:
  boolean; progressSeconds: number; completed: boolean }`.
- `tick()` gains a small loop (mirroring the existing `MODULES` loop)
  that advances `progressSeconds` for any `started && !completed` research
  entry, and flips `completed = true` once `progressSeconds >=` that
  project's duration.

## Unlock Gating

A small `isModuleUnlocked(key: ModuleKey, state: GameState): boolean`
helper: returns `true` unconditionally for `miner`/`refinery`/`fabricator`,
and checks `state.research.alloySynthesis.completed` for `synthesizer`.
Consulted in two places — the UI (to decide locked vs. buyable display)
and inside `buyModule` itself (an early-return guard, so the lock can't
be bypassed even if the UI somehow rendered a buy button it shouldn't
have — the same defense-in-depth instinct behind tonight's delete-modal
confirmation gate, not just a single point of enforcement).

## UI

**New RESEARCH panel** (reuses the `Panel` component, positioned after
Generator Stack): shows "Alloy Synthesis," its cost, and a "Start
Research" button (disabled if unaffordable) before it's started; once
started, a progress bar in the same chamfered visual style as the
existing tick bar, with a percentage/remaining-time readout; once
complete, a simple "Complete" state (no further interaction needed).

**Generator Stack** shows a locked row from the start: "Synthesizer 🔒
Locked — requires Alloy Synthesis research," replaced by the normal
buyable row once `isModuleUnlocked` returns true for it. **Resources
panel** shows the alloys card the same way — a locked placeholder instead
of a numeric value — for consistency with the same "visible wall"
principle already applied to Generator Stack, rather than only
half-applying it.

## Save Migration

`research` is a new required field on `GameState`, same situation as
`tickDurationSeconds` when the tick bar landed — existing saves won't
have it. Needs a `SAVE_VERSION` bump (2 → 3) and a new migration entry
backfilling `research: { alloySynthesis: { started: false, progressSeconds:
0, completed: false } }` for saves missing it, following the exact
pattern already established in `save.ts` (never editing the existing v1→v2
migration, only adding v2→v3 alongside it).

## Testing

- `tick()`'s research-progress loop is genuinely unit-testable, same
  category as the existing closed-form regression test: verify that
  advancing game-time by the full duration completes a started research
  project, that an unstarted project never advances, and that a
  completed project's `progressSeconds` doesn't keep climbing past
  completion (avoids a runaway number that's harmless but sloppy).
- `isModuleUnlocked()` is a pure function, testable directly (true for
  the original 3, false for synthesizer pre-research, true after).
- The new panel/locked-row markup has no automated test story, same
  limitation as every other visual change this session (Node/npm
  unavailable in this environment, confirmed again before writing this
  design) — verified by manual code review only, pending an actual
  browser check once deployed.

## Explicitly Out of Scope

- A second research project, prerequisite chains, or any kind of research
  "tree" UI — the `Record<ResearchKey, ...>` shape is deliberately
  future-proofed for this, but not built now.
- Energy, material families, Relics, synthesis-from-energy, or anything
  else from the master design doc's full §4.8 vision — those need their
  own prerequisite infrastructure this doesn't attempt to build.
- Fixing the "modules don't actually consume the prior tier" simplification
  (`KNOWN_ISSUES.md`) — Synthesizer follows the same existing pattern,
  not a new one.
