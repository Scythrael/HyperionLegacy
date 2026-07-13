# Phase 2 — Warehouse + Refine-Order Economy (Design)

**Date:** 2026-07-13
**Type:** Feature design doc. Next step after approval: `writing-plans` → implementation plan.
**Status:** Draft for review.
**Relation:** Phase 2 of the [Ship Production Economy epic](2026-07-10-ship-production-economy-epic.md).
Builds directly on the shipped Phase 1 (facility framework + Refinery + keyed inventory + timed
processes, live in production at `APP_VERSION 0.7.0` / `SAVE_VERSION 18`).

---

## 0. Reconciliation with current (shipped) state — read first

- **Live now (0.7.0):** keyed `inventory: Record<string, Decimal>`, an `ITEMS` registry, a `discovered`
  set, a facility framework (`FACILITIES`, upgrade tracks, `facilities: Record<key,{level}>`), a
  closed-form timed-process engine (`startProcess` / `resolveProcesses`, atomic deduct-at-start), the
  Refinery (single refine jobs, slot-gated), `lifetimeStats`, and the Locations/Facilities IA.
- **⚠️ Environment (unchanged, dominant constraint):** NO Node anywhere reachable — no `svelte-check`,
  no `vitest`. The user develops fully remote; the machine this repo lives on has no Node either.
  Verification is careful reading + hand-trace + desktop testing on the Vercel preview. This constraint
  **drives the biggest architectural decision below** (§2).
- **This phase supersedes one epic assumption:** the old "Warehouse: its own phase or part of the
  facility framework?" open question (epic §6.1) is **resolved** — the Warehouse is a facility hung on
  the shipped Phase 1 framework (it is already a locked `Facilities → Homeworld` rail item).

---

## 1. What Phase 2 delivers (and the sequencing)

Three interlocking pieces, built **foundation-first** so each is verifiable on its own before the next
rides on it:

1. **The step-forward offline foundation (§2)** — change offline catch-up from per-system closed-form
   math to *stepping the real per-tick economy logic forward in bounded chunks*. Built and verified
   **first**, alone, because everything else depends on it and it is the riskiest change — and it is
   verifiable against *current* behavior (post-refactor, today's missions/refine must still catch up
   identically).
2. **The tiered Warehouse (§3)** — the inventory browser + storage caps + the upgrade/unlock economy +
   the **auto-stop** overflow mechanic. The visible payoff.
3. **The refine-order system (§4)** — batch (refine N) and continuous (refine until stopped) orders with
   pause/resume, confirmation, and cancellation. Near-trivial once the economy steps forward tick-by-tick.

**Definition of done for Phase 2:**
- Offline catch-up runs the live per-tick economy forward (chunked) and matches live play by construction.
- A Warehouse you build/upgrade, showing **every** item as a slot (❓ + hint until discovered), with
  per-tier caps that **auto-stop** producers of a full material.
- Refine orders you can queue by count or run continuously, that pause on input-exhaustion **and**
  output-full and auto-resume when unblocked.

---

## 2. The step-forward offline foundation (the load-bearing decision)

### 2.1 Why change offline at all
Phase 2 introduces two things that **couple** systems that were independent under the current
per-system closed-form model:
- **Hard caps** — a material's storage state now affects whether its producers may run (auto-stop, §3.4).
- **Continuous refine orders** — a job that consumes a material *every cycle while it is also being
  produced*, dancing around both the input-exhaustion floor and the output cap.

Deriving *closed-form math* for that coupled economy (piecewise rates, cap/depletion breakpoints, order
of production vs. consumption) is possible but **fragile**, and with no `vitest` a subtle error ships
silently and mis-pays **every** player's offline haul. That is an unacceptable risk profile for the one
thing an idle game must get right.

### 2.2 The decision: step the economy forward
Offline catch-up **runs the actual per-tick economy logic forward** over the elapsed span, in bounded
chunks, instead of computing an end-state formula.

- **Correct by construction.** The offline path *is* the live path — the same tick function — so it
  **cannot drift**. This is a stronger guarantee than closed-form (which must be *proven* equal); here
  offline == live is true because it is literally the same code.
- **Kills the standing drift risk.** Today `tick()` (offline) and App.svelte's live loop are two
  hand-mirrored copies of the mission/economy math — a logged, recurring source of "wired into one loop
  but not the other" bugs (the ship-stats, bonus-roll, and credits regressions all came from this).
  Unifying to one per-tick function called by both paths **removes that entire class of bug**.
- **Makes continuous orders trivial offline.** A continuous refine order just *runs each tick*, like
  everything else — no special offline formula.

### 2.3 Costs and mitigations (stated plainly — this is a real refactor)
- **It is the deferred tick-path unification**, a significant architectural change to working code. This
  is the highest-risk task in Phase 2. Mitigation: it is **verifiable against current behavior** — after
  the refactor, offline catch-up for today's systems (missions, single refine, XP, credits, trickle)
  must produce **identical** results to before. That gives a concrete regression oracle even without
  `vitest`: import a save, catch up a known elapsed span, confirm the numbers match the pre-refactor path.
- **Performance on very long offline spans.** At 1 tick/sec, a week ≈ 605k ticks, a month ≈ 2.6M. A tight
  no-render loop handles this in well under a second, but we **chunk adaptively**: advance in large steps
  while the per-tick state change is linear (no threshold crossing — cap hit, input exhausted, process
  completion, level-up), and only step finely across a breakpoint. This keeps "one big jump == many small
  ticks" exact while bounding the loop cost. The chunking math is the part to hand-trace hardest.
- **Build + verify this FIRST, in isolation**, before Warehouse/refine ride on it.

### 2.4 Scope guard
Unify and step-forward the **economy** tick (missions, processes, inventory, XP, credits, trickle). Do
**not** rewrite unrelated live-loop concerns (rendering, the tick-bar). The goal is one shared per-tick
**economy** function; the live loop calls it once per tick, offline catch-up calls it in the chunked loop.

---

## 3. The tiered Warehouse

### 3.1 Shape
A facility (build/unlock + upgrade track) on the Phase 1 framework, whose content is the **inventory
browser**. Organized into **tiers** (T1…T5 planned). **Each tier is its own warehouse** (its own unlock,
its own cap, its own upgrade track) and gets **its own tab**.

- **Tab axis = tier** (primary), with **category grouping within** a tier (Raw / Refined / Minor
  Components / Major Components / Ship Modules / Ship Systems) — reconciling this phase's tier framing
  with the epic's older category-tab sketch. *(Open for confirmation — see §7.)*
- Plus an **Overview** view (per the refinery/facility pattern) surfacing at-a-glance state: which
  materials are **full** (the per-item indicator), and — once refine orders exist — what each refinery
  is doing.

### 3.2 The master catalog (a hard, standing constraint)
**Every item in the game has a reserved slot in the Warehouse.** Undiscovered items render as **❓ + a
how-to-get hint**; on discovery the slot reveals the item's name, count, and rarity color (driving off
the existing `discovered` set).

- The **`ITEMS` registry is the single source of truth** for the catalog. Every item carries the metadata
  the Warehouse needs: **`tier`**, **`category`**, **`rarity`**, and an **`unlockHint`** (the ❓-state
  clue). *(Some of these already exist on `ITemDef`; this phase adds what's missing — notably `tier`
  and `unlockHint`.)*
- **Standing rule (write into the design + CONTRIBUTING notes):** no item is added anywhere in the game
  without this metadata, or it would have no Warehouse slot. The catalog is thus always complete and
  becomes the game's **100%-completion checklist**, feeding the future Completions/Achievements systems.

### 3.3 The cap + upgrade + unlock economy
- **Per-tier cap value, per-item fullness.** Upgrading a tier's warehouse raises the cap for **every item
  in that tier at once** (one shared cap value per tier). "Full" is tracked **per item** against that
  shared value — item A can be full while item B is nearly empty, both against the same tier cap.
- **T1 default cap: `1,000,000` per item.** (Calibration: the user's ~week-old save is already brushing
  1M, so this is a fair mid-game starting pressure.)
- **Upgrade = double the cap.** Each rank doubles the tier's cap (1M → 2M → 4M → …).
- **Upgrade cost = 75% of the *current* cap, in the tier's common material** (user-set 2026-07-13). Cost scales with the cap it
  is raising (at 1M → costs 750k; at 2M → 1.5M; …) — deliberately **steep so each rank feels earned**.
- **Tier unlock cost = 100% of the *previous* tier's default cap.** T2 warehouse unlock costs 1M (T1's
  default). Higher tiers scale from their predecessor's default.
- **T2 is a stub this phase:** the T2 warehouse unlocks, but its first upgrade is **gated on a T2
  material (a second ore) that isn't obtainable yet** — a real, honest "future content" wall, not a
  placeholder tier. *(Future tiers may require uncommon/rare inputs to upgrade — undecided, out of scope.)*

### 3.4 Auto-stop (the overflow mechanic)
When a material reaches its cap, **the producing task auto-stops** rather than overflowing. This is the
chosen mechanic because it **preserves the reason to upgrade** — the alternative (auto-sell overflow to
credits) quietly cancels the upgrade incentive (§6).

- **Unifies with refine pause/resume (§4).** "Pause when out of inputs" and "pause when the output is
  full" are the **same** pause/resume machinery, triggered from opposite ends. One system, two triggers.
- **Per-task, per-material.** Auto-stop idles only the producers of the **full** material; everything else
  keeps running. Filling one material never bricks a whole offline session.
- **What "the task" is per producer:**
  - **Refine/craft job** — one output; pauses when that output is full, resumes when space frees.
  - **Mission** — a run's *primary* material defines it (a "Common Ore Run" exists to gather common ore),
    so the mission auto-stops (the captain idles) when its primary material is full. Incidental secondary
    drops stop with it. *(This is the rule to confirm at plan time — see §7. Alternative considered:
    stop only the specific output while the mission continues for XP/credits — rejected as more complex
    and as re-introducing a "where does the un-stored material go" question.)*
- **Generous caps keep it a mid/late pressure**, not constant nagging — the 1M T1 start is chosen with
  that in mind.
- **Offline:** trivial on the step-forward foundation — each stepped tick simply checks the cap and
  produces or doesn't. No overflow-to-credits math, no separate offline formula.

---

## 4. The refine-order system

### 4.1 Order modes
- **Batch — "refine N":** enqueue N iterations; each is one existing refine job (atomic deduct at start,
  output at completion). The queue drains one iteration at a time.
- **Continuous — "refine until stopped":** the same, unbounded, until the player stops it.

### 4.2 Pause / auto-resume (both triggers)
An order pauses — and the Overview reports **why** — when either:
- **Out of inputs** — e.g. queue 500 but only enough for 30 → refines 30, pauses at 470 remaining,
  Overview reads *"Refinery X — out of ingredients."* When a farming captain lands more input, it
  **auto-resumes** from where it left off.
- **Output full** — the output material is at its cap (§3.4) → pauses, resumes when space frees.

Both are the same pause/resume state on the order; the trigger just differs.

### 4.3 Confirmation + cancellation
- **Confirmation popup** on starting a refine: *"Are you sure you wish to refine this item? This cannot be
  undone."* with a **don't-show-again** checkbox. Re-enableable via a **new toggle in System → Options**
  (System keeps its current layout for now — just add the toggle; no rail treatment yet).
- **Cancellation rules:**
  - The **in-progress single item cannot be cancelled** — it commits. (Prevents dodging the warehouse cap
    by cancelling mid-refine.)
  - The **queue can be stopped**: the current item finishes, the remaining queue is dropped. (Queue 100,
    stop after the first → you get 1.)

### 4.4 UI
- **Refinery Overview** shows per-refinery status (what each is doing, paused/why).
- **The refineries get their own management view/tab** within the Refinery facility (list + control of
  active orders), distinct from the facility's Overview/Upgrades.

---

## 5. Data-model changes (summary — details at plan time)

- **`ItemDef`:** add `tier: number`, `unlockHint: string`, ensure `category` + `rarity` present (some
  exist). Drives the Warehouse catalog + ❓ reveal + rarity color.
- **Warehouse facilities:** T1…T5 as facility keys (framework + T1 real + T2 stub), each with a
  cap-doubling upgrade track and a tier-unlock cost. A per-tier **cap value** derived from the tier's
  warehouse level.
- **Refine orders:** an order/queue structure on state (mode: batch(N) | continuous, remaining count,
  paused + reason), resolved by the (now stepped) economy tick.
- **Auto-stop:** enforced at the shared "material about to be added / producer about to run" seam so it
  applies uniformly to missions, refine, and trickle, live and offline.
- **Save migration:** `SAVE_VERSION 18 → 19` — initialise warehouse facility levels, refine-order state,
  the new `ItemDef` fields on existing items, and the don't-show-again preference. Existing saves migrate
  with all inventory/facilities intact.

---

## 6. Alternatives considered (the chopping block)

- **Auto-sell overflow → credits (REJECTED for now, logged in SUGGESTIONS).** Simpler in isolation and
  keeps missions running offline, but **quietly cancels the reason to upgrade** — if excess just becomes
  free credits, capacity upgrades stop mattering. Kept on the chopping block as a fallback if auto-stop
  proves too punishing in testing. (A `vendorRate` on items would be needed to revive it; not added now.)
- **Closed-form coupled-economy offline math (REJECTED).** Fast and traditional, but fragile and
  un-verifiable without `vitest` — see §2.1.

---

## 7. Open questions carried into the plan step

1. **Warehouse tab axis:** ✅ RESOLVED (user 2026-07-13) — tier-primary with category-grouping-within
   (this doc's default) confirmed.
2. **Mission auto-stop granularity:** ✅ RESOLVED (user 2026-07-13) — stop the whole run on
   primary-material-full (this doc's default) confirmed. Affects mission-loot code (closed-form-sensitive)
   — nail the exact wiring at plan time.
3. **Adaptive-chunk breakpoints (§2.3):** the exact set of per-tick events that force a fine step (cap
   hit, input exhausted, process completion, level-up, order pause/resume) — enumerate precisely at plan
   time; a missed breakpoint is an offline==live drift.
4. **Vendor rate:** deferred (auto-sell is off). Revisit only if auto-sell returns from the chopping block.
5. **T1 item set:** exactly which current items are T1, their categories/rarities/hints — enumerate at
   plan time from the live `ITEMS` registry.

---

## 8. Verification approach (no Node)

1. **Step-forward regression oracle:** after the refactor, offline catch-up for today's systems must match
   the pre-refactor numbers exactly (import save → known elapsed span → compare). This is the primary
   safety net for the riskiest task.
2. **Desktop testing on the Vercel preview** (now available via remote desktop, if wonky): build/upgrade
   the Warehouse, watch caps + auto-stop, queue batch/continuous refine, force pause/resume both ways,
   confirm offline catch-up over a real span.
3. **`vitest` + `svelte-check` the moment Node is available** — this phase's step-forward + coupled
   economy is exactly what the suite exists to nail; run it and fix-forward. (The Phase 1 test files
   already exist and have still never executed — this remains outstanding debt.)
