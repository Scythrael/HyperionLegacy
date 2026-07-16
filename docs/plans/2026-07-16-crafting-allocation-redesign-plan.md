# Crafting Allocation Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development to execute this task-by-task.
> Design: `docs/plans/2026-07-16-crafting-allocation-redesign-design.md`. Branch: `feat/crafting-allocation` (off `staging`).

**Goal:** replace the Refinery + Fabricator flat-list order UI with per-slot production-line configurators
backed by a derived material-allocation subsystem (reserve inputs, cancel/refund, no double-spend).

**Architecture:** Independent per-slot **lines** (`refineLines`/`fabricateLines` arrays) replace the single
`refineOrder`/`fabricateOrder`. **Allocation is DERIVED** from those lines (`allocated(item) = Σ lines.remaining ×
inputs`; `free = inventory − allocated`) — no stored ledger. The per-line engine clones the existing closed-form
per-tick order engine; offline parity holds via the same one-seam `economyTick` guarantee.

**Tech Stack:** Svelte 5 (legacy `$:`), `break_infinity.js` Decimal, Vitest, svelte-check. **Node via
`export PATH="/c/Program Files/nodejs:$PATH"` before EVERY npm/npx.** Gate each task: `npm run check` (0 errors)
+ `npm test` (green). Baseline at plan time: check 0 errors / 20 pre-existing App.svelte CSS warnings; **594 tests**
on `staging`.

**Definition of done:** each Refinery/Fabricator slot is a configurable production line (tier → item → quantity →
ingredient preview → optional confirm → start), quantity capped at affordable-now, cancel releases the remaining
reservation; the item tooltip shows Allocated/Free/Total; concurrent lines can't double-spend; offline==live;
save v23→v24 round-trips; check 0 / tests green; APP_VERSION 0.12.0.

**⚠️ Reference implementations to MIRROR:** the current single-order engine — `refineOrder`/`fabricateOrder`
state, `processRefineOrder`/`processFabricateOrder`, `startRefineOrder`/`startFabricateOrder`,
`canFabricate`/`canResearch` (typed-reason gate idiom), `materialAtCap` (storage-cap stop). The v0.11.0 Fabricator
(`fabricator.test.ts`, `feat/fabricator`) is the closest twin. `refineConfirmPreference.ts` (the reusable confirm
toggle). The Warehouse item tooltip (for the allocated/free/total display).

---

## Task C1: Allocation core — `allocatedItem` / `freeItem` (derived), TDD

**Files:** Modify `src/lib/game/tick.ts` (helpers) or a new `src/lib/game/allocation.ts`; Test `src/lib/game/allocation.test.ts` (new).

**Read first:** `GameState.inventory` (`Record<string, Decimal>`), `BLUEPRINTS[k].recipe.inputs`, `REFINE_RECIPES[k].input`.
Since the lines arrays don't exist yet (C2), C1's helpers take the **lines as a parameter** so they're testable now;
C2 wires them to read `state.refineLines`/`state.fabricateLines`.

**Build:** a pure helper module:
- `type CraftLine = { id: string; kind: "refine" | "fabricate"; recipeKey: string; remaining: number }`.
- `lineInputsPerIteration(line): Record<string, Decimal>` — refine → `REFINE_RECIPES[recipeKey].input`; fabricate →
  `BLUEPRINTS[recipeKey].recipe.inputs` (as Decimals).
- `allocatedItem(lines: CraftLine[], itemId): Decimal` = `Σ line.remaining × inputsPerIteration[itemId]`.
- `freeItem(inventory, lines, itemId): Decimal` = `Decimal.max(0, (inventory[itemId] ?? 0) − allocatedItem(lines, itemId))`.

**TDD tests:** the design's worked example (1000 stock, 1:1, remaining 1000 → allocated 1000 / free 0; remaining 900,
stock 900 → allocated 900 / free 0; no lines → allocated 0 / free = stock); a multi-line case (two lines reserving the
same item sum correctly); a multi-INPUT recipe; `free` never negative. → commit `feat(craft): derived allocation helpers (allocated/free)`.

## Task C2: Per-slot lines data model + engine ⚠️ offline parity

**Files:** Modify `src/lib/game/model.ts` (GameState `refineLines`/`fabricateLines`; remove `refineOrder`/`fabricateOrder`
— they're preview-only, not shipped to prod), `src/lib/game/tick.ts` (`processRefineLines`/`processFabricateLines`,
`startLine`, `cancelLine`, wire into `economyTick`), fresh-state seed; Test `allocation.test.ts` / a new `craft-lines.test.ts`.

**Read first — CRITICAL:** the ENTIRE current order engine: `processRefineOrder`/`processFabricateOrder` (the per-tick
loop: free slot → affordable → consume inputs at start → start timed job → decrement; storage-cap stop via `materialAtCap`),
`startRefineOrder`/`startFabricateOrder`, and where they're called in `economyTick` (the single per-tick seam). Also
`fabricateSlotCount`/`refineSlotCount`.

**Build:**
- `GameState.refineLines: CraftLine[]` + `fabricateLines: CraftLine[]` (fresh state `[]`). `CraftLine` gains `mode`
  (batch-N | continuous) matching the current order mode. Cap array length at the facility slot count.
- `startLine(state, kind, recipeKey, mode)` → adds a line (guarded by C3's `canStartLine`; inline for now if needed).
- `cancelLine(state, lineId)` → removes the line (unstarted reservation releases automatically; any in-flight timed
  job for that line completes normally — do NOT refund an in-flight iteration).
- `processRefineLines`/`processFabricateLines` — clone the current per-tick engine but iterate PER LINE, each line owning
  at most one in-flight job at a time (one slot per line), consuming from `free` (guaranteed by its own reservation).
  Wire both into `economyTick` at the SAME seam the single-order processors used (replace them). `resolveProcesses`
  unchanged (reuses `addItem`); `itemsRefined`/`itemsCrafted` increments unchanged.
- **⚠️ Offline parity test:** `tick(bigSpan)` == looping `economyTick(·,1)` for inventory + activeProcesses +
  refineLines + fabricateLines across MULTIPLE lines (≥2, different recipes) completing mid-span. NON-VACUOUS.
- Remove the now-dead single-order code + its tests (retire, don't leave both engines).

→ commit `feat(craft): per-slot production lines + engine (cancel, offline-parity)`. **Controller re-verifies parity.**

## Task C3: Line-start gate + affordable-now cap

**Files:** Modify `src/lib/game/tick.ts` (`canStartLine` typed reasons, `maxAffordableIterations`); wire `startLine`; Test.

**Read first:** `canFabricate`/`canResearch` (typed-reason idiom), the `freeItem` helper (C1), `materialAtCap`.

**Build:**
- `maxAffordableIterations(state, kind, recipeKey): number` = `min over inputs of floor(freeItem(item) / perIteration[item])`
  (0 if any input free is 0). This is the quantity cap the UI enforces.
- `canStartLine(state, kind, recipeKey, count) -> {ok}|{ok,reason}` — reasons: `notResearched` (fabricate only),
  `tierLocked`, `noSlot` (lines.length ≥ slotCount), `materials` (count > maxAffordableIterations OR count ≤ 0),
  `storageFull` (output at cap). Wire `startLine` to delegate.

**TDD:** each reason; `maxAffordableIterations` respects `free` not raw stock (a second line's reservation lowers the cap
for the first item); ok when all met. → commit `feat(craft): canStartLine gate + affordable-now cap`.

## Task C4: Configurator UI — ⚠️ MOCKUP-GATED, do NOT code before approval

**Files:** Modify `src/App.svelte` (Refinery + Fabricator panels).

**⚠️ STOP: before writing any UI code, the CONTROLLER produces a mockup of the per-line configurator panel and gets the
user's approval** ([[feedback_visual_ui_needs_mockup]]). Only after approval does the implementer build to the approved mockup.

**Build (to the approved mockup):** the shared per-line panel used by BOTH facilities — one panel per slot:
tier dropdown → item dropdown (refine recipes / researched blueprints at that tier) → quantity field (bounded to
`maxAffordableIterations`) → ingredient preview (each input: needed×N + its free/allocated/total) → **Start** (optional
confirm via `refineConfirmPreference`) → active line: progress bar + `formatClock` time + **Cancel** button (calls
`cancelLine`). New handlers `doStartLine`/`doCancelLine` commit state like the sibling handlers. Reuse existing CSS +
the `remainingReadout`/`formatClock` tick helpers. Empty/locked states as today (Fabricator → Research Lab signpost).
`npm run check` 0. → commit `feat(ui): per-line crafting configurator (Refinery + Fabricator)`.

## Task C5: Inventory tooltip — Allocated / Free / Total

**Files:** Modify `src/App.svelte` (Warehouse item tooltip + any other item tooltip).

**Read first:** the Warehouse tooltip markup (`hoverEnterWarehouseTooltip`/`toggleWarehouseTooltip`).

**Build:** add three lines to the item tooltip — **Total** (`inventory[item]`), **Allocated** (`allocatedItem(allLines, item)`),
**Free** (`freeItem`). Compute `allLines = [...refineLines, ...fabricateLines]`. Reuse existing tooltip styling.
→ commit `feat(ui): item tooltip shows allocated / free / total`.

## Task C6: Save migration v23→v24

**Files:** Modify `src/lib/game/save.ts` (`MIGRATIONS[23]`, `SAVE_VERSION=24`); Test `save.test.ts`.

**Read first:** `MIGRATIONS[22]` (the v22→v23 fabricator seed) — clone the idiom.

**Build:** `MIGRATIONS[23]` — seed `refineLines: []` + `fabricateLines: []`; DROP any legacy `refineOrder`/`fabricateOrder`
key (delete it from the migrated object). No stored allocation. `SAVE_VERSION=24`. Never edit shipped migrations [0..22].
Update chained-shape assertions the bump touches.

**TDD:** v23 save (with a legacy order) → migrate → v24 shape (empty lines arrays, no order key); matches `freshState()`;
round-trips; idempotent. → commit `feat(save): migration v23->v24 (production lines)`.

## Task C7: Version bump 0.12.0 + docs

**Files:** `src/lib/patchNotes.ts` (0.11.0→**0.12.0** + entry), `KNOWN_ISSUES.md`, `SESSION_LOG.md`.

- Patch note: Refinery + Fabricator reworked into per-slot production lines you configure (pick tier + item + amount);
  starting a craft reserves its materials (see Allocated/Free/Total on any item), you can cancel to refund the
  remaining, and you can't over-order past what you can reserve.
- KNOWN_ISSUES: first-pass — no per-line rename/reorder; confirm honors the existing toggle; components still need the Shipyard.
- SESSION_LOG: a Crafting Allocation Redesign entry (C1–C7).
→ commit `chore: bump 0.12.0 + crafting-redesign patch notes`.

---

## After all tasks
Final holistic review (esp. C2 offline-parity across multiple lines + C1/C3 free-aware-consumer completeness — grep that
nothing still reads raw `inventory[item]` where it should read `free`). Device-check on staging → production. **Shipyard**
(consumes components into ships) remains the next feature after this.
