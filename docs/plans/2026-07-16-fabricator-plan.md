# Fabricator (Phase 4) — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development to execute this task-by-task.
> Design: `docs/plans/2026-07-16-fabricator-design.md`. Branch: `feat/fabricator` (off `main`).

**Goal:** a Fabricator facility that crafts researched-blueprint **components** from materials via a
Refinery-style order/slot timed engine, plus retiring the legacy `RECIPES` instant-craft system.

**Architecture:** Extends the facility framework (`FACILITIES`, timed upgrade tracks) + the closed-form
timed-process engine (`startProcess`/`resolveProcesses`) + the refine-ORDER idiom (count-N / continuous,
per-iteration atomic deduct, idle-and-resume, storage-cap stop). Fabricate jobs are timed processes with
the existing `addItem` completion effect. No new tick loop.

**Tech Stack:** Svelte 5 (legacy `$:`), `break_infinity.js` Decimal, Vitest, svelte-check. **Node via
`export PATH="/c/Program Files/nodejs:$PATH"` before EVERY npm/npx.** Gate each task: `npm run check`
(0 errors) + `npm test` (green). Baseline at plan time: check 0 errors / 21 pre-existing App.svelte CSS
warnings; **547 tests** on `main`.

**Definition of done:** a Fabricator facility (Homeworld/Facilities) where you run timed craft ORDERS
(Craft N / continuous) on researched, tier-available blueprints, consuming materials → components, with
slots, auto-stop on out-of-materials / storage-cap, offline==live parity; the legacy `RECIPES` instant-
craft system + the Homeworld Fabrication sub-tab + the Overview HOME PLANET panel are removed; save
v22→v23 round-trips; check 0 / tests green; APP_VERSION 0.11.0. Components read "usable when the Shipyard
comes online."

**⚠️ Reference implementations to MIRROR (read before each relevant task):**
- Research Lab (the closest twin): `FACILITIES.research`, `researchSlotCount`, `startResearch`,
  `canResearch`/`ResearchBlockReason` (tick.ts); the Research Lab panel + `doStartResearch`
  (App.svelte); `MIGRATIONS[21]` v21→v22 (save.ts); `research.test.ts`.
- Refine-ORDER engine (the order/slot + count-N/continuous + idle-resume + closed-form offline idiom):
  `REFINE_RECIPES`, `startRefineJob`, `refineSlotCount`, the refine-order state + `processRefineOrder`
  (search tick.ts for `refineOrder`/`processRefineOrder`), and the Refinery panel's order controls in
  App.svelte. **The Fabricator's order semantics MUST match the Refinery's exactly.**
- `fuelFlowSummary` / `fuelRunwayProjection` tests show the current pure-function test style.

---

## Task F1: Data model — `craftDurationTicks` + `FACILITIES.fabricator` + `fabricateSlotCount` + seed

**Files:** Modify `src/lib/game/model.ts` (BlueprintDef field, FACILITIES.fabricator, FACILITY_KEYS if
one exists, fresh-state seed), `src/lib/game/tick.ts` (`fabricateSlotCount`); Test `src/lib/game/fabricator.test.ts` (new).

**Read first:** `BlueprintDef` + `BLUEPRINTS` (model.ts), `FACILITIES.research` and its upgrade track +
`researchSlotCount` (the exact pattern to clone), the fresh-state facility seed block, and how
`RESEARCH_FACILITY_KEY` is declared/used.

**Step 1 — failing test** (`fabricator.test.ts`):
- Every `BLUEPRINTS[key].craftDurationTicks` is a positive finite number.
- `FACILITIES.fabricator` exists: label "Fabricator", Homeworld owner, a finite `upgrades` array whose
  rungs (a) gate the next blueprint tier and (b) on chosen rungs carry `addFabricateSlots`.
- `fabricateSlotCount(freshState())` === 1; after seeding fabricator level 2, === 2 (or whatever the
  chosen rungs give — assert against the rung data, not a magic number).
- `freshState().facilities.fabricator.level` === 1.
Run: `export PATH="/c/Program Files/nodejs:$PATH" && npm test -- fabricator` → FAIL (fabricateSlotCount / FACILITIES.fabricator undefined).

**Step 2 — implement:**
- Add `craftDurationTicks: number` to `BlueprintDef`; set first-pass values on each `BLUEPRINTS` entry
  (tunable — flag in-code; e.g. tier-1 ~ 120 ticks, tier-2 ~ 300, in the same launch-placeholder spirit
  as researchDurationTicks). Add a `FABRICATOR_FACILITY_KEY = "fabricator"` const if the file uses that
  idiom for other facilities.
- Add `FACILITIES.fabricator` mirroring `FACILITIES.research`: finite upgrade track, each rung unlocks
  the next tier + chosen rungs add a fabricate slot via a new `addFabricateSlots` effect field on the
  facility upgrade effect (additive to `FacilityUpgradeEffect`, inert for existing facilities — same way
  `addResearchSlots` was added). Rungs cost **credits** (reuse the optional `credits?` gate the Research
  rungs use). Cap at real content (tiers 1–2 today).
- `fabricateSlotCount(state)` in tick.ts: sum `addFabricateSlots` over reached rungs, base 1 — clone
  `researchSlotCount` exactly.
- Fresh state: seed `facilities.fabricator` at level 1.

**Step 3 — pass:** `npm test -- fabricator` green; FULL `npm test` + `npm run check` 0.
**Step 4 — commit:** `feat(fabricator): blueprint craftDurationTicks + Fabricator facility (tier/slot track)`.

---

## Task F2: Fabricate engine — orders + `startFabricateJob` + `resolveProcesses` reuse ⚠️ offline parity

**Files:** Modify `src/lib/game/model.ts` (`TimedProcessKind` gains `"fabricateJob"`; the fabricate-order
state shape on GameState, mirroring `refineOrder`), `src/lib/game/tick.ts` (`startFabricateJob`,
`processFabricateOrder`, order state helpers), fresh-state seed; Test `fabricator.test.ts`.

**Read first — CRITICAL:** the ENTIRE refine-order implementation: the `refineOrder` field on GameState,
`startRefineJob`, and `processFabricateOrder`'s analog `processRefineOrder` (count-N / continuous,
per-iteration atomic deduct at each iteration start, idle-and-resume when the next iteration is
unaffordable, storage-cap auto-stop, and the CLOSED-FORM offline bulk resolution). Also read
`startResearch` (deduct-at-start + startProcess with an effect) and where `processFuelPipelines` /
`processRefineOrder` are called inside `economyTick` (the single per-tick seam).

**Step 1 — failing tests:**
- `startFabricateJob(state, key)` on a researched, tier-available blueprint with enough materials +
  a free slot: deducts the recipe inputs once (atomic), pushes ONE `fabricateJob` process with
  `durationTicks === BLUEPRINTS[key].craftDurationTicks` and effect `{type:"addItem", itemId: recipe.outputItem, amount: recipe.outputQty}`; returns `{ started: true }`.
- Slot cap: with `fabricateSlotCount` jobs already in flight, a further start returns `{started:false}`
  same-ref.
- Completion: stepping the process to done adds `recipe.outputQty` of the component to inventory and
  increments `lifetimeStats.itemsCrafted[outputItem]` by that amount (idempotent — no double count).
- Order (count-N): set an order of count N continuous=false; run `economyTick` enough ticks; exactly N
  components produced, N×inputs consumed, order goes idle; per-iteration deduct means a mid-run material
  shortfall pauses (idle) and resumes when materials return (mirror the refine-order tests).
- **⚠️ Offline parity:** `tick(bigSpan, seed())` deep-equals looping `economyTick(·,1)` bigSpan times for
  `inventory` + `activeProcesses` + the fabricate-order state across a craft completing mid-span. Make it
  NON-VACUOUS (a component actually produced, inputs actually consumed, a process actually consumed).
Run → FAIL.

**Step 2 — implement:** `TimedProcessKind |= "fabricateJob"`; add the fabricate-order state to GameState
(clone `refineOrder`'s shape; fresh state = idle/null). `startFabricateJob` delegates to `canFabricate`
(stub it as an inline guard for now IF F3 not done — but prefer implementing F3's `canFabricate` first if
convenient; otherwise inline the guards here and F3 refactors them out). `processFabricateOrder` clones
`processRefineOrder`'s closed-form loop against the blueprint recipe. Wire `processFabricateOrder` into
`economyTick` at the SAME seam as `processRefineOrder` (read that call site; step per whole tick).
`resolveProcesses` needs NO new branch — reuse the `addItem` effect. Increment `itemsCrafted` where the
refine order increments `itemsRefined` (mirror exactly).

**Step 3 — pass:** target tests, then FULL suite + `npm run check` 0. **Controller re-verifies the parity
test personally.**
**Step 4 — commit:** `feat(fabricator): fabricate-order engine (atomic deduct, timed craft, offline-parity)`.

---

## Task F3: Availability gate — `canFabricate` + typed reasons

**Files:** Modify `src/lib/game/tick.ts` (`canFabricate`, `FabricateBlockReason`); wire
`startFabricateJob`; Test `fabricator.test.ts`.

**Read first:** `canResearch` + `ResearchBlockReason` (the exact idiom), the storage-cap helper the
refine order uses (`materialAtCap` or similar), `blueprintUnlocked`, `fabricateSlotCount`, `facilityLevel`.

**Step 1 — failing tests:** `canFabricate(state, key)` returns each reason for its unmet condition:
`notResearched` (`!blueprintUnlocked`), `tierLocked` (`blueprint.tier > fabricator level`), `noSlot`
(active fabricateJob count ≥ `fabricateSlotCount`), `materials` (inputs unaffordable), `storageFull`
(output component at cap); `{ok:true}` when all pass. Gate order: notResearched → tierLocked → noSlot →
materials → storageFull (cheapest/most-fundamental first — mirror canResearch's ordering rationale).
`startFabricateJob` returns `{started:false, reason}` on each block (same-ref), unchanged success path.
Run → FAIL.

**Step 2 — implement** `canFabricate` mirroring `canResearch`; refactor `startFabricateJob` to delegate.
**Step 3 — pass:** target + FULL + check 0.
**Step 4 — commit:** `feat(fabricator): canFabricate gate + typed reasons`.

---

## Task F4: UI — Fabricator facility panel

**Files:** Modify `src/App.svelte`.

**Read first:** the Research Lab panel (rail entry + Overview/Craft-list/Upgrades SubTabs +
`doStartResearch` + `researchBlockText`) AND the Refinery panel's ORDER controls (Craft-N input +
continuous toggle + in-flight progress bars + the order-status/paused readout). The Fabricator = Research
Lab's structure with the Refinery's order controls. `formatDuration(ticks, state.tickDurationSeconds)`
for all durations. `activeFacility` union + how facilities render (hardcoded switch — add `fabricator`).

**Build:** a `fabricator` rail entry + panel:
- **Overview:** craft slots in use / total; in-flight `fabricateJob`s with progress bar + `formatDuration`
  time-remaining; researched-vs-fabricable counts; forward signpost "components become usable when the
  **Shipyard** comes online (next feature)".
- **Craft:** researched blueprints grouped by tier — recipe (inputs → outputQty×output, ITEM labels),
  duration as real time, and the ORDER controls (Craft-N field + continuous toggle + start/stop) wired to
  a new `doStartFabricate`/`doSetFabricateOrder` handler that commits state the SAME way the refine-order
  and `doStartResearch` handlers do. Buttons gated by `canFabricate` (disabled + `fabricateBlockText`
  reason mapping, cloned from `researchBlockText`). **Empty state when nothing researched:** a line
  pointing to the Research Lab ("Research blueprints at the Research Lab to unlock things to fabricate").
- **Upgrades:** the fabricator tier/slot track wired to `canBuildFacilityUpgrade` /
  `doStartFacilityUpgrade` (credits-gated), exactly like the Research/Refinery Upgrades tabs.

Reuse existing CSS classes (no new check warnings). `npm run check` 0.
**Commit:** `feat(ui): Fabricator panel (craft orders, tiers, upgrades)`.

---

## Task F5: Legacy cleanup — retire `RECIPES` + Homeworld Fabrication sub-tab + Overview inventory panel

**Files:** Modify `src/App.svelte` (remove the Fabrication sub-tab + its `RECIPES` panel + the Overview
HOME PLANET panel + `doCraftRecipe` + the `RECIPES`/`craftRecipe`/`RecipeKey` imports), `src/lib/game/model.ts`
(remove `RECIPES`, `RecipeKey`; `HomePlanetMaterialKey` only if orphaned), `src/lib/game/tick.ts` (remove
`craftRecipe` if it exists there); Test — update/remove any test that referenced `RECIPES`/`craftRecipe`.

**⚠️ Anti-Regression / comprehension-first:** BEFORE deleting, grep every usage of `RECIPES`, `craftRecipe`,
`doCraftRecipe`, `RecipeKey`, `HomePlanetMaterialKey`, `itemsCrafted`. **KEEP `itemsCrafted`** (now fed by
F2's fabricate engine). Delete a symbol ONLY when its last non-test reference is gone. This is a
deletion-only task — do it AFTER F1–F4 so the Fabricator already replaces the function.

**Steps:**
1. Remove the Homeworld **Fabrication** SubTabs entry + the `{#if activeHomeworldSubTab === "refinery"}`
   `RECIPES`-iterating panel block (App.svelte ~2372+).
2. Remove ONLY the "HOME PLANET" 3-material `<Panel>` inside the Homeworld **Overview**
   (`activeHomeworldSubTab === "resources"`) block — KEEP the sub-tab shell (leave a minimal placeholder
   comment/empty Panel so the tab still renders; it's "fleshed out later").
3. Remove `doCraftRecipe`, the `RECIPES`/`craftRecipe`/`RecipeKey` imports in App.svelte, then the
   definitions in model.ts/tick.ts. Remove `HomePlanetMaterialKey` only if grep shows no remaining use.
4. Update/remove tests referencing the removed symbols.
5. `npm run check` 0 (fix any now-unused-import errors) + `npm test` green.
**Commit:** `refactor: retire legacy RECIPES instant-craft + Homeworld Overview inventory panel`.

---

## Task F6: Save migration v22→v23

**Files:** Modify `src/lib/game/save.ts` (`MIGRATIONS[22]`, `SAVE_VERSION = 23`); Test `save.test.ts`.

**Read first:** `MIGRATIONS[21]` (v21→v22, the Research seed) — clone its idiom EXACTLY.

**Step 1 — failing test:** a v22 save (no `fabricator` facility, no fabricate-order state) → migrate →
v23 shape: `facilities.fabricator` at `{level:1}`, fabricate-order seeded to its fresh idle value; matches
`freshState()`'s fabricator/order fields; round-trips (save→load→deep-equal, plays); a v22 save that
already has them (defensive) isn't clobbered; `SAVE_VERSION === 23`. Update the existing chained-shape
assertions that the bump touches (the version + full-facilities-map assertions), same as R6 did.
**Step 2 — implement** `MIGRATIONS[22]` (additive `?? {level:1}` / `?? <idle order>` seeds, `state.facilities?.`
guard) + `SAVE_VERSION = 23`. Never edit shipped migrations `[0..21]`.
**Step 3 — pass:** `npm test -- save` + FULL + check 0.
**Commit:** `feat(save): migration v22->v23 (fabricator state)`.

---

## Task F7: Version bump 0.11.0 + docs

**Files:** `src/lib/patchNotes.ts` (APP_VERSION 0.10.0→**0.11.0** + a newest-first PATCH_NOTES entry),
`KNOWN_ISSUES.md`, `SESSION_LOG.md`.

- Patch note (player-facing, match the existing `{version, summary}` shape): a new **Fabricator** where
  you craft your researched blueprints into components from materials, running Craft-N or continuous
  orders across craft slots; upgrade the Fabricator to unlock higher component tiers + more slots. Note
  components become usable with the **Shipyard** (next feature). Also mention the tidy-up: the old
  Homeworld instant-craft panel + placeholder resource list were retired in favor of the Warehouse +
  facility panels.
- KNOWN_ISSUES: components aren't consumed by anything until the Shipyard; first-pass tunables (craft
  durations, tier count, slot rungs, recipes).
- SESSION_LOG: a Fabricator (Phase 4) entry summarizing F1–F7.
- If a test hardcodes APP_VERSION/entry count, update it. `npm run check` 0 / `npm test` green.
**Commit:** `chore: bump 0.11.0 + Fabricator patch notes`.

---

## After all tasks
Final holistic reviewer over the branch (esp. the F2 offline-parity seam + the F5 deletion completeness —
confirm no dangling `RECIPES`/`craftRecipe` refs and `itemsCrafted` still increments). Then device-check
on staging → production. **Shipyard** (consumes these components into ships) is the next feature.
