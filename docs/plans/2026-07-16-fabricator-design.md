# Fabricator (Phase 4) — Design

**Status:** Design (brainstorm complete 2026-07-16). Next: writing-plans → subagent-driven build.
**Branch:** `feat/fabricator` (off `main`).

**Goal:** a **Fabricator facility** — step 3 of the crafting pipeline — that consumes materials to
craft the **components** unlocked by researched blueprints (the `BLUEPRINTS` registry +
`researchedBlueprints`, shipped with the Research Lab in 0.10.0). Pairs with, and completes, the
Research → Fabricator loop.

**Pipeline:** mine (missions) → **Refinery (step 2, exists)** → **Fabricator (step 3, this build)**.
Both live under the **Facilities** tab and both use the same order/slot timed-crafting mechanic.

---

## Locked brainstorm decisions (user, 2026-07-16)

1. **Craft mechanic = mirror the Refinery** (the order/slot timed-process system): pick a researched
   blueprint, run it as an ORDER — **Craft N** or **continuous** — with concurrency **slots**, timed
   jobs, and **auto-stop** when materials run out or the component's storage is capped. Offline-safe
   through the shared `economyTick` seam. (Option 3, build-to-target auto-chain, is DEFERRED — logged
   to SUGGESTIONS.md.)
2. **Refinery scope = untouched engine + clean split.** The Refinery already uses this mechanic; do
   NOT rewrite its working refine engine. Instead, cleanly separate the two steps by retiring the
   legacy `RECIPES` instant-craft system (which conflated "refine" + "fabricate" in one registry).
3. **Cost = materials + time, NO credits.** Each blueprint's `recipe` inputs are the material cost;
   a new per-blueprint `craftDurationTicks` is the time. Credits stay Research's sink; materials are
   the Fabricator's — the two facilities stay economically distinct. (Facility UPGRADES still cost
   credits, like every other facility.)
4. **Availability = from the start, under Facilities**, but with an empty-state that **signposts the
   Research Lab** ("Research blueprints to unlock things to fabricate") so a new player sees at a
   glance where to go. (No tech gate on the facility itself; the real gate is having researched
   blueprints to craft.)
5. **Legacy cleanup** (once the new panels stand in):
   - Remove the legacy `RECIPES` / `craftRecipe` / `doCraftRecipe` / `RecipeKey` and the Homeworld
     **Fabrication** sub-tab that rendered them (the old instant-click "REFINERY"/"FABRICATION" panel).
   - Remove ONLY the legacy inventory display (the hardcoded "HOME PLANET" 3-material panel) from the
     Homeworld **Overview** sub-tab — the Warehouse replaced it. KEEP the Overview sub-tab itself as a
     placeholder to be fleshed out later.
   - Keep the `itemsCrafted` lifetime stat — now fed by the Fabricator instead of `craftRecipe`.

---

## 1. Fabricator facility (`FACILITIES.fabricator`)

- New `FacilityKey` `fabricator`, label **"Fabricator"**, Homeworld owner, House rail + SubTabs
  (Overview / Craft / Upgrades), like the Refinery / Research Lab / Fuel Depot.
- **Upgrade track** (finite, caps at real content): mirrors the Research Lab's tier+slot pattern —
  each level unlocks the next blueprint **tier** for fabrication AND (on chosen rungs) adds a **craft
  slot**. Gated on **credits** (+ optional FA-level prereq, mirror other facilities), TIMED via the
  existing facility-upgrade machinery.
- `fabricateSlotCount(state)` — concurrent crafts, from the facility level (start **1**, +1 on chosen
  rungs). Parallels `refineSlotCount` / `researchSlotCount`.
- Seeded at level **1** in fresh state (tier-1 blueprints fabricable from the start once researched;
  no soft-lock, mirrors Research/Mission Control).
- **Tier gate:** a blueprint is fabricable only when `fabricator level >= blueprint.tier` AND the
  blueprint is researched.

## 2. Crafting engine (timed orders) — offline-safe

- Reuses the closed-form timed-process engine (`startProcess`/`resolveProcesses`) + the refine-ORDER
  idiom (count-N / continuous, per-iteration atomic deduct, idle-and-resume on material exhaustion,
  storage-cap auto-stop) that the Refinery already proved. A `fabricateOrder` on state selects the
  active blueprint + mode (count N or continuous).
- New `TimedProcessKind` `"fabricateJob"`; the completion effect reuses the existing
  `{ type: "addItem"; itemId; amount }` effect (deposits `recipe.outputQty` of `recipe.outputItem`),
  so `resolveProcesses` needs no new effect type.
- `startFabricateJob(state, blueprintKey)`: guards via a typed `canFabricate` gate (see §4);
  deducts the recipe inputs ATOMICALLY at start (like refine/fuel deduct-at-start); pushes a
  `fabricateJob` TimedProcess (`durationTicks = blueprint.craftDurationTicks`, effect adds the
  component). Concurrency capped by `fabricateSlotCount`.
- **Offline parity:** fabricate jobs are ordinary timed processes stepped in `economyTick` —
  `tick(bigSpan)` == looping `economyTick(·,1)` for inventory + activeProcesses across a craft
  completing mid-span. The order-loop's closed-form offline resolution mirrors the refine-order math
  (iterations = min(remaining count, floor(E/duration), per-input floor(available/perIteration))).
  This is the high-risk seam — controller re-verifies. Increments `lifetimeStats.itemsCrafted`.

## 3. Blueprint recipes + the dependency chain

- Reuses each `BlueprintDef.recipe` (`inputs: Record<itemId, number>`, `outputItem`, `outputQty`)
  from R1. Add a tunable **`craftDurationTicks: number`** field to `BlueprintDef` (first-pass values,
  flagged in-code, finalized at the device checkpoint).
- The R1 recipes already form a chain: `structuralAssembly` (tier 2) consumes `frameSegment` +
  `powerCoupling` (tier 1) + refined mats. The player crafts intermediates first, then the assembly —
  the manual chain works today; auto-chaining is the deferred Option 3.
- Components output to the unified inventory (the Warehouse Component tab already renders them).

## 4. Availability gate + reasons

- `canFabricate(state, blueprintKey) -> { ok } | { ok:false, reason }`, mirroring `canResearch` /
  `canDispatch`. Reasons: `notResearched` (blueprint not yet unlocked), `tierLocked` (fabricator
  level < blueprint.tier), `noSlot` (all craft slots busy), `materials` (can't afford the recipe
  inputs), `storageFull` (the component is at its storage cap). Returns `{ok:true}` when researched +
  tier-available + a free slot + affordable + room.
- `startFabricateJob` delegates to it (no drifted duplicate guard).

## 5. Legacy cleanup (code + UI)

- **Remove** `RECIPES`, `craftRecipe`, `doCraftRecipe`, the `RecipeKey` type, and any now-dead
  imports/helpers they alone used. Verify `HomePlanetMaterialKey` and `itemsCrafted` usages before
  touching them: `itemsCrafted` STAYS (fed by the Fabricator now); `HomePlanetMaterialKey` — check
  whether anything but `RECIPES` references it; keep if still used, remove if orphaned.
- **Remove** the Homeworld **Fabrication** sub-tab (the `RECIPES`-iterating "REFINERY"/"FABRICATION"
  instant-craft panel) from the Locations → Homeworld SubTabs.
- **Remove** ONLY the hardcoded "HOME PLANET" 3-material panel from the Homeworld **Overview**
  sub-tab. Keep the Overview sub-tab shell (a placeholder for future content). Homeworld's SubTabs
  become Overview (placeholder) + Administration (talents).
- No save migration needed for the removals — `RECIPES` is a static registry, not persisted state.

## 6. UI (Fabricator facility panel, App.svelte)

Mirrors the Refinery panel (House rail + SubTabs), reusing existing classes + Wave-1 `formatDuration`:
- **Overview:** craft slots in use / total; in-flight fabricate jobs with progress bars + time
  remaining (human time via `formatDuration`); researched-vs-fabricable counts; the forward signpost
  that these components feed the **Shipyard** (next feature).
- **Craft:** the researched-blueprint list grouped by tier — each with its recipe (inputs → output),
  duration as real time, and Craft-N / continuous order controls gated by `canFabricate` (disabled +
  reason). When NOTHING is researched yet, an empty-state that **points to the Research Lab**.
- **Upgrades:** the fabricator tier/slot track wired to `canBuildFacilityUpgrade` /
  `doStartFacilityUpgrade` (credits-gated), like the other facilities.

## 7. Save migration v22→v23

Seed `FACILITIES.fabricator` at level 1 (mirror the Research L1 seed idiom, `MIGRATIONS[21]`).
`researchedBlueprints` already exists (v22); the component items already exist; `itemsCrafted`
already exists. Never edit shipped migrations; append `MIGRATIONS[22]` + bump `SAVE_VERSION = 23`.
Version bump **0.11.0** (Y-bump — new feature).

## 8. Deferred / next

- **Option 3 — build-to-target auto-chain** ("I want N structuralAssembly" → auto-craft the whole
  dependency chain): logged to SUGGESTIONS.md for future implementation.
- **Shipyard** — consumes these components into ships (the north-star). The next feature after the
  Fabricator; components stockpile with no sink until then (the same accepted forward-window as
  Research → Fabricator).

## 9. Suggested build decomposition (for the plan)

1. **Data model:** `BlueprintDef.craftDurationTicks`, `FACILITIES.fabricator` (tier/slot track),
   `fabricateSlotCount`, fresh-state seed at level 1. Catalog/seed test.
2. **Fabricate engine:** `startFabricateJob` + `fabricateOrder` (count-N / continuous),
   `"fabricateJob"` kind, order-loop with per-iteration atomic deduct + idle-resume + storage-cap
   stop, `resolveProcesses` reuse of the `addItem` effect, `itemsCrafted` increment. ⚠️ Offline-parity
   test (mirror the refine-order parity idiom).
3. **Gate:** `canFabricate` + typed reasons; wire `startFabricateJob` to use it.
4. **UI:** Fabricator facility panel (Overview + Craft order controls + Upgrades), Research-Lab
   empty-state signpost, Shipyard forward signpost.
5. **Legacy cleanup:** remove `RECIPES`/`craftRecipe`/`doCraftRecipe`/`RecipeKey` + the Homeworld
   Fabrication sub-tab + the Overview HOME PLANET panel; keep `itemsCrafted`.
6. **Migration v22→v23** + round-trip test.
7. **Version bump 0.11.0** + patch notes + KNOWN_ISSUES + SESSION_LOG.

First-pass values (craft durations, tier count, slot rungs, recipes) all tunable at the device checkpoint.
