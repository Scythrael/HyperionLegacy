# Fleet Operations Mission UI — Design

## Context

Today's Fleet Operations tab (`src/App.svelte`, `activeTab === "fleetOperations"`) is a flat,
mission-first list: one `Panel` per `MISSIONS` entry (`shortOreRun`, `longOreRun`), each listing
embarked captains (with progress) above a plain list of idle captains with a single "Dispatch"
button — no preview of drop rates, timing, or which captain benefits from which talents before
committing.

The user wants a richer, browsable mission-selection flow: pick a mission category, pick a
difficulty tier, pick a specific mission, preview its stats for a specific captain, then dispatch.
This also gives the newly-wired talent effects (`extractionYieldMult`, `rareLootChanceMult`,
`fleetExtractionYieldMult` — see the just-shipped talent-effects commit) a place to actually be
*visible* to the player before they commit a captain, not just felt after the fact.

This is pure UI/display work layered on top of already-working mission mechanics — no changes to
`tickCaptainMission`, `dispatchCaptainOnMission`, or the save schema. Node.js/npm/tsc remain
unavailable in this environment; all verification is manual code tracing, not live rendering.

## 1. Mission category buttons

A left-side vertical button list, replacing today's flat `Panel`-per-mission layout, visually
matching the Fleet Captain's tab's captain list (`.captain-list`/`.captain-list-item`, flat
panel-look, thin gaps — the 2026-07-07 button-style pass). Four buttons:

- **Resource-Gathering** — real, clickable. The only category with actual mission content today.
- **Patrol Missions**, **Surveying**, **Long-Term Exploration** — locked/"🔒 Coming Soon!", same
  visual treatment as locked captain-list slots. Patrol needs combat (Battlespace is still a stub);
  Surveying and Long-Term Exploration have no backing mechanics yet. Confirmed with the user:
  these are placeholders, not scoped for this pass.

## 2. Difficulty tier sub-tabs

Selecting Resource-Gathering shows a tier row at the top of the content pane, reusing the existing
`SubTabs.svelte` component (same as Homeworld/Fleet Captain's/System's own sub-tab rows) — no new
component needed, `locked` support already exists.

- **Tier I** — real. Contains BOTH of today's missions (`shortOreRun` "Short Ore Run", `longOreRun`
  "Long Ore Run") — confirmed with the user neither is a separate tier; they're both Tier I content.
- **Tier II / III / IV / V** — locked/"Coming Soon!", reserved for future higher-tier mission
  content.

## 3. Mission cards (inside Tier I)

Each of the two Tier I missions gets a card:

- **Portrait-frame placeholder.** A bordered rectangle with a centered generic picture icon,
  theme-aware (border/icon color via the existing `--color-accent`/`--color-text-secondary` CSS
  variables, same as every other themed element — no hardcoded color). Reserved for future
  semi-transparent asteroid-field/ship-silhouette art; today it's just the placeholder.
- **Cargo capacity** (already shown today, kept).
- **Base drop-rate breakdown per material** — percentage odds (each `lootTable` entry's
  `weight / totalWeight`) and the mission's own base per-tick amount (`extractionRatePerTick`,
  unmodified — no captain selected yet at this stage). E.g. for Short Ore Run (weights 980/19/1
  out of 1000): commonOre ~9.8/tick (98%), uncommonMaterial ~0.19/tick (1.9%), rareMaterial
  ~0.01/tick (0.1%).

Clicking a card opens the captain-selection popup (below) rather than dispatching immediately.

## 4. Captain-selection popup

Reuses the existing modal pattern (`.modal-backdrop` + `Panel.modal-dialog`, same shape as the
Delete Save confirmation modal) rather than inventing a new one.

- Lists every idle captain (`mission === null`) as a selectable button.
- Selecting a captain recalculates and displays:
  - **The same drop-rate breakdown**, but now adjusted for that specific captain's actual unlocked
    Captain Talents plus fleet-wide unlocked Homeworld Talents — the exact math already implemented
    in `tick.ts`'s `captainExtractionYieldMult`, `captainRareLootChanceMult`, and
    `fleetExtractionYieldMult` (reused here for display, not re-derived).
  - **Full timing breakdown**: transit out, extracting, transit back, unloading — each shown in
    ticks AND real seconds (`ticks * state.tickDurationSeconds`), plus a grand total (sum of all
    four, both units).
- A **Dispatch** button (enabled once a captain is selected) calls the existing
  `dispatchCaptainOnMission` unchanged, then closes the popup.

## 5. Explicitly out of scope

- **Ship selection.** Confirmed with the user: not built now (every captain still has exactly one
  ship, `ShipType` stays hardcoded to `"resourcer"`), but flagged as the exact spot ship-switching
  will plug into once the upcoming Ships & Crew feature lands — logging this in SUGGESTIONS.md so
  it isn't lost.
- Patrol Missions / Surveying / Long-Term Exploration content, and Tier II-V mission content —
  future work, not this pass.

## Testing approach

No Node/npm/tsc/dev-server in this environment — verification is manual code tracing (hand-check
the drop-rate percentage math against each mission's actual `lootTable` weights, hand-check the
timing math against `MissionDef`'s actual tick counts and `state.tickDurationSeconds`), not live
rendering. A live-device/browser check is needed once deployed, same as every other UI change this
session.
