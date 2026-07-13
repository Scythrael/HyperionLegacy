# Phase 2 — Warehouse + Refine-Order Economy — Implementation Plan

> **For Claude:** Execute task-by-task, subagent-driven, two-stage review (spec then quality) per task.
> **Read first:** `docs/plans/2026-07-13-phase-2-warehouse-refine-economy-design.md` — the authoritative design.

**Goal:** Ship a step-forward offline foundation, a tiered Warehouse (full item catalog + storage caps +
auto-stop), and batch/continuous refine orders — foundation-first so each rides on a verified base.

**Architecture:** Unify the economy tick into ONE per-tick function called by both the live loop and a
chunked offline catch-up loop (offline == live by construction). On that base, add per-tier warehouse
facilities with per-item caps that auto-stop producers when full, and refine orders (batch N / continuous)
that pause/resume on input-exhaustion and output-full.

**Tech Stack:** TypeScript, Svelte, `break_infinity.js` (`Decimal`), Vitest (authored, run at home).

**⚠️ ENVIRONMENT — READ EVERY TASK:** NO Node/npm/tsc/vitest anywhere reachable. "Run the test" = author it
+ hand-trace it + `git diff`; NEVER claim it ran. Vercel bundles via esbuild (no typecheck). Desktop
preview testing is available (via remote desktop, wonky). **HARD MERGE GATE stands:** do not merge to
production until `npm run check` + `npm test` run clean at home — this phase's step-forward refactor +
coupled economy is exactly what the suite exists to verify.

**Ground rule — Anti-Regression:** the mission/XP/loot/credits math is shipped, working, closed-form code.
Group A MOVES it into a shared function; it must stay behaviorally identical (the regression oracle in
Task A5 is the proof). Groups B–D are additive on top.

---

## GROUP A — Step-forward offline foundation (the risky prerequisite; build + verify FIRST)

> The deferred tick-path unification. Everything else depends on it. Verified against CURRENT behavior:
> after Group A, offline catch-up for today's systems must produce identical results to before.

### Task A1 — Map the current tick paths (investigation, no code change)
- **Files:** read `src/lib/game/tick.ts` (`tick()`, `tickCaptainMission`, `resolveProcesses`, the loot/
  trickle/credits/XP folds) and `src/App.svelte`'s live `setInterval` poll loop.
- **Deliverable:** a written map (commit as a `docs/plans/phase2-tick-map.md` scratch note) of: every
  per-tick economy effect, which loop computes it, what inputs each loop passes, what deltas each
  accumulates, and where `tick()` currently batches vs. steps a long offline jump. This is the factual
  base the unification is built on — no guessing later.
- Commit: `docs(phase2): map current tick + live-loop economy paths`.

### Task A2 — Extract the shared per-tick economy function
- **Files:** `src/lib/game/tick.ts` (new `economyTick(state, ctx): { next, deltas }` or similar); test
  `tick.test.ts`.
- Extract ONE function that advances the economy exactly one tick: missions (via the already-shared
  `tickCaptainMission`), process resolution, trickle, inventory adds, XP, credits — returning the new
  state. Pure/deterministic given inputs (per the design's drift-proof rule).
- **Test (author + hand-trace):** one `economyTick` call equals one tick of the old path for a fixture
  state (materials, XP, credits, process state all match). Commit: `feat(phase2): extract shared economyTick`.

### Task A3 — Live loop calls `economyTick`
- **Files:** `src/App.svelte` (live poll loop).
- Replace the live loop's hand-mirrored economy math with a call to `economyTick` once per elapsed tick
  (keep rendering/tick-bar concerns in the loop; only the ECONOMY moves). No behavior change intended.
- **Verify:** hand-trace that every effect the live loop did is now done by `economyTick`; nothing dropped
  (this is where the historical drift bugs lived). Commit: `refactor(phase2): live loop uses economyTick`.

### Task A4 — Offline catch-up loops `economyTick` (chunked)
- **Files:** `src/lib/game/tick.ts` (`tick()` offline catch-up).
- Replace the closed-form offline catch-up with a loop over `economyTick`, **adaptively chunked**: advance
  in large steps while no per-tick BREAKPOINT falls inside the step, step finely across a breakpoint.
  **Breakpoints (design §7.3 — enumerate exactly):** a process completion, a cap hit, an input exhaustion,
  a level-up threshold, a refine-order pause/resume. Between breakpoints the state change is linear, so a
  chunk is one `economyTick` scaled by the chunk length.
- **Test (author + hand-trace):** `tick(state, BIG_ELAPSED)` equals looping `economyTick` BIG_ELAPSED times
  (big-jump == stepped) for a fixture with a mid-span process completion. Commit: `feat(phase2): chunked step-forward offline catch-up`.

### Task A5 — Regression oracle: offline == pre-refactor
- **Files:** test `tick.test.ts` (a dedicated regression suite).
- Author tests asserting: for representative saves + elapsed spans (short, one-cycle, multi-day), the new
  step-forward `tick()` yields the SAME materials/XP/levels/credits/process-state as the documented
  pre-refactor behavior (use the Task A1 map + existing Phase 1 fixtures as the baseline).
- This is the primary safety net for Group A without `vitest` running here — it must be hand-traced
  rigorously and is the FIRST thing to run at the home checkpoint. Commit: `test(phase2): offline==live regression oracle`.
- **→ CHECKPOINT (bundle + desktop):** push; confirm Vercel bundles; device-test that live play and a
  close/reopen offline jump behave as before. Flag: full typecheck/tests pending Node.

---

## GROUP B — Warehouse data model, caps, auto-stop (additive on Group A)

### Task B1 — `ItemDef` gains `tier` + `unlockHint` (+ confirm `category`/`rarity`)
- **Files:** `src/lib/game/model.ts` (`ItemDef`, `ITEMS`); test `model.test.ts`.
- Add `tier: number` and `unlockHint: string` to `ItemDef`; populate for every current `ITEMS` entry
  (enumerate the live registry — design §7.5). **Standing-rule test:** every `ITEMS` entry has non-empty
  `tier`/`category`/`rarity`/`unlockHint` (guards the "every item has a catalog slot" constraint). Commit:
  `feat(phase2): ItemDef tier + unlockHint (catalog metadata)`.

### Task B2 — Warehouse facilities: T1 track + T2 stub + per-tier cap
- **Files:** `model.ts` (`FACILITIES` warehouse entries `warehouseT1`…, a `tierCap(state, tier): Decimal`
  helper); `tick.ts` (helper wiring); tests.
- T1 warehouse: unlock + a cap-doubling upgrade track; `tierCap` = `1_000_000 * 2^level`. Upgrade cost =
  `0.75 * currentCap` in the tier's common material. T2 warehouse: unlock cost = `1_000_000` (100% of T1
  default); its first upgrade gated on a not-yet-obtainable T2 ore (add the item to `ITEMS`, tier 2,
  `unlockHint`). Build the tier FRAMEWORK; only T1 real, T2 stub (design §3.3). Tests: cap doubling, cost
  scaling, T2 gate. Commit: `feat(phase2): tiered warehouse facilities (T1 track, T2 stub)`.

### Task B3 — Auto-stop enforcement at the producer seam
- **Files:** `tick.ts` (the shared add/produce seam used by `economyTick`); tests.
- At the "material about to be added / producer about to run" seam: if the material is at its `tierCap`,
  the producing task **does not run / does not add** (auto-stop) — per-material, per-task (design §3.4).
  Refine/craft output-full → pause the order (Group D consumes this). Mission whose PRIMARY material is
  full → that mission does not progress this tick (its captain idles). Because this lives in `economyTick`,
  it applies live AND in the chunked offline loop identically.
- **Test (author + hand-trace):** at cap, a producing mission/process makes no more of that material and
  loses nothing else improperly; below cap it resumes; a cap-hit is a Task-A4 breakpoint. Commit:
  `feat(phase2): auto-stop producers at warehouse cap`.

### Task B4 — Migration v18 → v19
- **Files:** `src/lib/game/save.ts` (`MIGRATIONS[18]`, `SAVE_VERSION → 19`, `hydrateDecimals`); tests.
- Init warehouse facility levels (T1 unlocked-or-level-0 per design intent, T2 locked), the new `ItemDef`
  fields are code-side (no per-save data), the don't-show-again pref (Group D), and any refine-order state
  (Group D) as empty. Existing inventory/facilities untouched. Round-trip test v18→v19. Commit:
  `feat(save): migrate v18->v19 (warehouse + prefs)`.

---

## GROUP C — Warehouse UI  ⛔ MOCKUP-GATED

### Task C1 — Warehouse panel  ⛔ REQUIRES A USER MOCKUP FIRST
- Per [[feedback_visual_ui_needs_mockup]] + design §3.1: STOP for a user sketch of the Warehouse panel —
  the per-TIER tabs (category-grouped within), the ❓/hint/rarity-reveal item slots, the per-item "full"
  indicator, the Overview (what's full / what each refinery is doing), and the upgrade/unlock controls.
  It lives in `Facilities → Homeworld → Warehouse`. Build only after the mockup lands. Uses B1–B3 data.

---

## GROUP D — Refine orders (batch/continuous) on the step-forward base

### Task D1 — Refine-order state + engine
- **Files:** `tick.ts` (order struct: `mode: {kind:"batch",remaining:number}|{kind:"continuous"}`,
  `pausedReason?: "noInput"|"outputFull"`; drive from `economyTick`); `model.ts` (state field); tests.
- Each tick, a running order tries to start one refine iteration if a slot is free AND inputs affordable
  AND output not full; else pause with the reason; auto-resume when unblocked (design §4.2). Batch
  decrements `remaining`; continuous runs until stopped. Atomic per-iteration deduct (Phase 1 rule).
- **Test (author + hand-trace):** queue N with inputs for K<N → makes K, pauses "noInput", a later input
  add resumes it; output-full pauses "outputFull"; big offline jump == stepped (rides Group A). Commit:
  `feat(phase2): refine-order engine (batch/continuous, pause/resume)`.

### Task D2 — Cancellation rules
- **Files:** `tick.ts`/order controls; tests.
- In-progress single iteration commits (not cancellable). Stopping the queue lets the current iteration
  finish and drops the remainder (design §4.3). Test both. Commit: `feat(phase2): refine-order cancellation rules`.

### Task D3 — Confirmation preference + System → Options toggle
- **Files:** `App.svelte` (a confirm modal reusing the DELETE-SAVE modal pattern; a `refineConfirmEnabled`
  pref persisted like `tickBarEnabled`); `save.ts` (pref default in migration). 
- The "Are you sure… cannot be undone" modal with don't-show-again; a toggle in System → Options to
  re-enable (System keeps current layout — just the toggle, design §4.3). Commit: `feat(phase2): refine confirmation + re-enable toggle`.

### Task D4 — Refine-order UI  ⛔ MOCKUP-GATED (folds into the Warehouse/Refinery mockup)
- The order controls (enter N / continuous / stop) + the per-refinery status view (design §4.4). Gate on
  the same mockup pass as C1 (they're adjacent surfaces). Build after the sketch.

---

## GROUP E — Version + docs

### Task E1 — Version bump + docs
- `APP_VERSION` minor bump (0.7.0 → 0.8.0) + player PATCH_NOTES entry (warehouse + storage caps + refine
  orders); KNOWN_ISSUES (auto-sell on the chopping block; T2+ tiers stubbed; the standing Node gate);
  SUGGESTIONS (auto-sell fallback, per design §6); SESSION_LOG. `SAVE_VERSION` = 19 (from B4). Commit:
  `chore(phase2): version + docs`.

---

## Notes for the executor
- **Order:** A → (checkpoint) → B → C(mockup gate) → D → E. Group A is the risky refactor; its regression
  oracle (A5) is the safety net — hand-trace it hardest, and it's the first thing to run at the Node checkpoint.
- **Never** claim a test ran (no Node). Author + hand-trace; the user runs `npm run check` + `vitest` at home.
- **Closed-form/stepped parity:** every offline path must satisfy big-jump == stepped (Group A makes this
  structural; keep it so).
- **Auto-stop lives in `economyTick`** so it's uniform live + offline — never special-case it per loop.
- Reference @superpowers:subagent-driven-development for the per-task loop.
