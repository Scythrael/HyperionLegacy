# Crafting Allocation Redesign — Design

**Status:** Design (brainstorm complete 2026-07-16). Next: writing-plans → subagent-driven build.
**Branch:** `feat/crafting-allocation` (off `staging`, which carries the v0.11.0 Fabricator + dev/timer work).

**Goal:** replace the flat recipe-list order UI on the **Refinery + Fabricator** with a per-slot
**production-line configurator** (tier → item → quantity → ingredient preview → confirm-to-start), unified
across both facilities, and add a **material allocation/hold** subsystem so concurrent crafts can't
double-spend and jobs can be cancelled with the remaining materials refunded.

**Why:** the flat card-list bloats as recipes multiply; per-line configurators scale and let each slot run
its own recipe. Allocation makes multi-line crafting safe (no double-spend), makes softlock structurally
impossible (cancel/refund), and gives the player a clear allocated/free/total inventory picture.

**⚠️ This reworks just-shipped code** (the v0.11.0 Fabricator order UI + engine) AND the existing Refinery
order system — deliberately, not accidentally. The current single-order + auto-pause/resume model is
replaced by independent per-line orders + up-front allocation.

---

## Locked brainstorm decisions (user, 2026-07-16)

1. **Cancellation model = ALLOCATION + cancel/refund.** Starting a line reserves ("allocates") its input
   materials; cancel releases the remaining (unstarted) reservation. Softlock impossible.
2. **Independent per-slot production LINES.** Each craft slot is its own line running its own recipe +
   quantity concurrently (a 3-slot Refinery can refine 3 different materials at once). Replaces today's
   one-order-across-all-slots model.
3. **Quantity bound = affordable-now.** The quantity field caps at `floor(free / per-iteration inputs)` —
   you can only order what you can currently reserve. (Combined with cancel/refund, no softlock.)
4. **Confirm-to-start = optional, reuse the existing toggle.** Show a "Start this craft?" confirm honoring
   the existing refine-confirm preference (`refineConfirmPreference.ts`) so it can be turned off.
5. **Inventory tooltip shows Allocated / Free / Total** per item.
6. **Both facilities together** (shared engine + allocation); phased tasks. Save v23→v24, version 0.12.0.
7. **The configurator UI is MOCKUP-GATED** — build a mockup of the per-line panel for user approval before
   coding it ([[feedback_visual_ui_needs_mockup]]).

---

## 1. Allocation is DERIVED, not stored (the core)

No stored "allocated" field on save state (no drift, minimal migration). Allocation is computed from the
active production lines, which are the single source of truth:

- **`allocated(state, item)` = Σ over all active lines L of `L.remaining × recipeInputs(L)[item]`**
  (sum across BOTH refinery + fabricator lines — they share the material inventory).
- **`free(state, item)` = `inventory[item] − allocated(state, item)`** (clamped ≥ 0 defensively).

`remaining` = iterations **not yet started** (whose inputs haven't been consumed). An in-flight iteration
has already consumed its inputs (deduct-at-start), so it is NOT counted in `allocated` — its materials
already left `inventory`. This keeps `free ≥ 0` always and matches the user's worked example:

| step | inventory[X] | line.remaining | allocated | free |
|---|---|---|---|---|
| order 1000 (1:1, 1 slot) | 1000 | 1000 | 1000 | 0 |
| after 100 crafts | 900 | 900 | 900 | 0 |
| cancel | 900 | — (line gone) | 0 | 900 |

**Consumption is per-iteration** (input leaves `inventory` when that item's craft starts); the reservation
only stops other consumers from spending those units first.

## 2. Independent production lines (data model + engine)

- Replace the single `refineOrder` / `fabricateOrder` on `GameState` with **`refineLines` / `fabricateLines`:
  an array of `{ id, recipeKey|blueprintKey, remaining, mode }`** (mode = batch-N or continuous). Cap the
  array length at the facility's slot count (`refineSlotCount` / `fabricateSlotCount`) — each line owns a slot.
- Engine (`processRefineLines` / `processFabricateLines`, cloning the current closed-form per-tick engine):
  for each line, if its slot is idle and the next iteration is affordable from **free** (it will be, since
  the line reserved it), consume the iteration's inputs, start a `refineJob`/`fabricateJob` timed process
  (durationTicks), decrement `remaining`. Output produced on completion (`resolveProcesses`, unchanged;
  respects storage cap — the existing cap-stop).
- **Cancel(lineId):** remove the line → its unstarted reservation releases automatically (allocated drops).
  The one in-flight iteration completes (already consuming). Pure state transition.
- **Offline parity ⚠️:** per-line engine is closed-form, stepped once per tick in `economyTick` (same seam
  as today). Allocation is derived (no stored state) → no new parity surface. Parity test: `tick(bigSpan)`
  == looping `economyTick(·,1)` across MULTIPLE lines completing mid-span.

## 3. Free-aware consumers

Every material-stock read that gates consumption uses **`free`**, not raw `inventory[item]`:
- Starting a new line (the quantity cap = `floor(free / per-iteration)`).
- Each line's per-iteration affordability (guaranteed by its own reservation, but checked defensively).
- The Warehouse display + tooltips (show allocated/free/total).
Fuel refining (deuteriumIce → fuel) is a SEPARATE mechanic with no material overlap — left untouched.
(If any future recipe consumes deuterium, fold it into the same `free` model then.)

## 4. Configurator UI (both facilities, one shared component) — MOCKUP-GATED

Per production line (one panel per slot):
- **Tier dropdown** → **item dropdown** (the craftable outputs at that tier, gated by researched blueprints
  for the Fabricator / available refine recipes for the Refinery) → **quantity** field (capped at
  affordable-now) → **ingredient preview** (each input: needed × N, and its free/allocated/total).
- **Start** (optional confirm via the existing toggle). Active line shows progress bar + time
  (`formatClock` / the tick-readout helpers) + **Cancel**.
- Empty/locked states: Fabricator with nothing researched points to the Research Lab (as today).
**Build a mockup of this panel for approval BEFORE coding it.**

## 5. Inventory tooltip: Allocated / Free / Total

Extend the Warehouse item tooltip (and any other item tooltip) to show three lines: **Total** (physical
stock), **Allocated** (reserved by active lines), **Free** (`total − allocated`). Reuses the derived
`allocated(state, item)` helper.

## 6. Save migration v23→v24

Replace the single `refineOrder`/`fabricateOrder` with empty `refineLines: []` / `fabricateLines: []`
(any in-flight order from v23 is dropped — acceptable, it's a preview-only feature not yet in production;
active timed jobs in `activeProcesses` still resolve normally). No stored allocation. Append `MIGRATIONS[23]`,
`SAVE_VERSION = 24`, never edit shipped migrations. Version bump **0.12.0**.

## 7. Softlock / bounds

Quantity capped at `floor(free / per-iteration)` (can't reserve what you don't have) + cancel/refund →
softlock is structurally impossible. Optional confirm dialog is belt-and-suspenders.

## 8. Suggested build decomposition (for the plan)

1. **Allocation core:** `allocated(state, item)` + `free(state, item)` helpers (derived from lines); unit
   tests incl. the worked example. (Lines don't exist yet → test against a constructed lines fixture.)
2. **Lines data model + engine:** `refineLines`/`fabricateLines` on GameState; `processRefineLines`/
   `processFabricateLines` (clone the current per-tick order engine, per-line); `startLine` / `cancelLine`;
   wire into `economyTick`; ⚠️ offline-parity test (multiple lines). Retire the single-order state.
3. **Free-aware gates:** route line-start + quantity cap through `free`; `canStartLine` typed reasons.
4. **Configurator UI — MOCKUP first, then build:** the shared per-line panel for Refinery + Fabricator.
5. **Inventory tooltip:** allocated/free/total.
6. **Migration v23→v24** + round-trip test.
7. **Version bump 0.12.0** + patch notes + KNOWN_ISSUES + SESSION_LOG.

Final holistic review (esp. the offline-parity seam + the free-aware consumer completeness). First-pass
values unchanged (this is a UX/allocation redesign, not a balance pass).
