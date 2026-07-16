# Research (Phase 3) — Design

**Status:** Design (brainstorm complete 2026-07-15). Next: writing-plans → subagent-driven build.
**Branch:** `feat/research` (off `main`).

**Goal:** a **Research facility** that unlocks **blueprints** — the recipes the (next-feature) Fabricator will craft
into ship components, equipment, and modules. Research is the *gate* on what you can eventually build; the Fabricator
is the forge.

**Why now:** roadmap Phase 3 of the Ship Production Economy epic (Warehouse ✅ → mission material sources ✅ → **Research**
→ Fabricator → Shipyard → ship systems). It's the unlock layer between the material economy and building ships — the
next step toward the north-star (*build a ship from scratch with a captain + a Freighter*).

**⚠️ NOT** a revert of the removed generator-stack "Research" (that was a placeholder). This is the intended
blueprint-unlock engine.

---

## Brainstorm decisions (locked)
1. **Unlocks BLUEPRINTS** — recipes the Fabricator crafts. (Not direct stat upgrades.)
2. **Mechanic = timed research PROJECTS** at a Research facility (reuse the closed-form timed-process engine — the same
   machinery behind refine jobs, fuel refining, and facility upgrades).
3. **Cost = time + CREDITS. No materials.** (Materials are the Fabricator's job; credits get a real long-term sink.)
4. **Structure = TIERS gated by the Research facility's upgrade LEVEL.** Upgrade the facility to reach the next
   blueprint tier; within an available tier, research in any order. (Mirrors the existing facility-upgrade pattern.)
5. **Research now, Fabricator next** (accepted a short window where researched blueprints aren't yet craftable) — a
   researched blueprint reads *"researched — craftable when the Fabricator comes online."* Likely ship Research +
   Fabricator as a pair so players never see an idle window.

---

## Scope

**In this pass:**
- The **Research facility** (Homeworld/Facilities, House rail + SubTabs, its own upgrade track that gates blueprint tiers + research slots).
- The **blueprint data model** (`BLUEPRINTS` registry — each blueprint carries the recipe the Fabricator will use, so the two features share one definition) + a `GameState.researchedBlueprints` set.
- The **research-project engine** (start → timed process consuming credits deduct-at-start → completion unlocks the blueprint; concurrency capped by research slots), offline-safe.
- A **first-pass tier-1 (and stub tier-2) blueprint set** — basic ship components, using the already-scaffolded component items.
- Research facility **UI** (available/in-progress/researched blueprints by tier; the "craftable with the Fabricator" signpost).
- Save migration **v21→v22**.

**Deferred (NOT this pass):**
- The **Fabricator / crafting** itself (the very next feature — actually crafts the researched blueprints from materials). Blueprints define their recipe now; nothing crafts them yet.
- Equipment / modules / ship-systems blueprints beyond a first component set (they arrive with the Fabricator + ship-systems phases).
- Research Data / a knowledge currency (we chose credits; a Data currency remains a possible future layer).
- Any research that applies a *direct* upgrade (we chose blueprints-only).

---

## 1. The Research facility
- New `FacilityKey` `research` (label "Research Lab" or "Research Division" — confirm name). Homeworld owner, renders in the Facilities tab via the House rail + SubTabs pattern (Overview / Research / Upgrades), like the Refinery/Warehouse/Fuel Depot.
- **Upgrade track** (finite, caps at real content — no placeholder tiers): each level does two things (first-pass): **unlocks the next blueprint TIER** and, on some rungs, **adds a research SLOT**. Gated on credits (+ optional FA-level / homeworld-talent prereqs, like other facilities). Timed via the existing facility-upgrade machinery.
- **Research slots** = concurrent research projects, from the facility level (start **1**; +1 on chosen upgrade rungs). Parallels `refineSlotCount` / fuel pipelines.
- Seeded at level **1** in fresh state (so tier-1 blueprints are researchable from the start — no soft-lock, mirrors Mission Control).

## 2. Blueprints — data model
- `BLUEPRINTS: Record<BlueprintKey, BlueprintDef>` in `model.ts`:
  ```
  BlueprintDef {
    key; label; tier: number;               // tier gated by research facility level
    researchDurationTicks: number;          // time to research (tunable)
    researchCreditCost: number;             // credits, deduct-at-start (tunable)
    // The recipe the FABRICATOR will use (defined now, crafted later):
    recipe: { inputs: Record<itemId, number>; outputItem: itemId; outputQty: number };
    flavor?; unlockHint?;
  }
  ```
- `GameState.researchedBlueprints: string[]` (or a set serialized as an array) — the unlocked blueprint keys.
- `blueprintUnlocked(state, key)` = `researchedBlueprints.includes(key)`.
- `blueprintAvailableToResearch(state, key)` = facility level ≥ `BLUEPRINTS[key].tier` AND not already researched AND not currently in progress.

## 3. Research-project engine
- `startResearch(state, blueprintKey)`: guard (available + a free research slot + affordable credits); **deduct `researchCreditCost` at start** (atomic, like `startProcess`/refine); start a timed process (kind `"researchProject"`, `durationTicks = researchDurationTicks`, effect `{ type: "unlockBlueprint"; key }`).
- On completion (in `resolveProcesses`): add `key` to `researchedBlueprints` (idempotent). Reuse the existing timed-process resolver — **closed-form, offline-safe** (no parity concern beyond what refine/facility upgrades already have).
- Concurrency capped by `researchSlotCount(state)`. No auto-repeat (research is one-shot per blueprint).

## 4. Tiers
- The Research facility level gates blueprint availability: level ≥ `blueprint.tier` → researchable. Upgrade the facility → unlock the next tier.
- First-pass: **Tier 1** available at facility level 1; **Tier 2** at level 2; etc. Track caps at the highest real tier.

## 5. First-pass blueprint content (proposed, tunable)
Tied to the scaffolded component items (`frameSegment`, `powerCoupling` [minorComponent], `structuralAssembly` [majorComponent]). Each blueprint's `recipe` consumes refined/raw materials → the component (crafted later at the Fabricator):
- **Tier 1 (basic components):** `frameSegmentBlueprint` (→ frameSegment), `powerCouplingBlueprint` (→ powerCoupling). Recipes consume refined materials (e.g. titaniumIngot / polysilicateWafer) — first-pass amounts.
- **Tier 2 (major components):** `structuralAssemblyBlueprint` (→ structuralAssembly, from minor components + refined mats).
- Higher tiers (equipment / modules / ship systems) = STUBS/deferred until the Fabricator + ship-systems phases define them. Track caps at real content.
(Exact recipes get finalized WITH the Fabricator, since they consume its crafting inputs — but defining them here keeps the two features one coherent data set.)

## 6. Cost model
- **Credits** (`researchCreditCost`, deduct-at-start) + **time** (`researchDurationTicks`). First-pass values tunable at the device checkpoint. Credits are the sink; no materials.
- Facility upgrades also cost credits (+ optional prereqs).

## 7. UI (Research facility panel, App.svelte)
- **Overview:** research SLOTS in use, in-progress projects with progress bars (reuse the refine/facility-upgrade progress idiom), a count of researched vs available blueprints, and the forward-signpost that crafting arrives with the Fabricator.
- **Research (project list):** blueprints grouped by tier — available ones with a **Research** button (disabled + reason when no slot / can't afford / tier locked), researched ones marked ✓ ("craftable once the Fabricator is online"), higher-tier ones shown locked with the facility-level requirement. Reuse the Warehouse/Operations card + rarity/tooltip idioms where fitting.
- **Upgrades:** the facility upgrade track (unlock next tier / +slot), wired to `canBuildFacilityUpgrade` / `doStartFacilityUpgrade` like the other facilities.

## 8. Save migration v21→v22
Seed `researchedBlueprints: []` and the `research` facility at level 1; active research projects live in `activeProcesses` (already migrated/handled). `researchedBlueprints` is string keys (no Decimal → no hydration). Mirror the Phase-1/2 seed-migration idiom; never edit shipped migrations. Round-trip test.

## 9. Offline / closed-form
Research projects are ordinary timed processes stepped inside `economyTick` — offline catch-up completes them exactly like refine/facility-upgrade jobs. Credits deduct at start (a discrete event), so no per-tick drift. No new parity seam beyond the established timed-process one.

## 10. Suggested build decomposition (for the plan)
1. **Data model:** `BLUEPRINTS` registry + `BlueprintDef` + `GameState.researchedBlueprints` + constants; `blueprintUnlocked`/`blueprintAvailableToResearch`. Catalog test.
2. **Research facility:** `FACILITIES.research` (upgrade track gating tiers + slots), `researchSlotCount`, fresh-state seed at level 1.
3. **Research engine:** `startResearch` (credit deduct-at-start + slot gate + timed process), `"researchProject"` kind + `"unlockBlueprint"` effect in `resolveProcesses`, completion unlocks the blueprint. Offline-parity test (a research run offline == live).
4. **Tier gating + availability:** facility level → available tiers; `canResearch(state, key) -> {ok}|{ok,reason}`.
5. **UI:** Research facility panel (Overview + Research list + Upgrades), the Fabricator-coming signpost.
6. **Migration v21→v22** + round-trip test.
7. **Version bump 0.10.0** (Y-bump — a new feature) + patch notes + KNOWN_ISSUES + SESSION_LOG.

First-pass values (durations, credit costs, tier count, slot rungs, recipes) all tunable at the device checkpoint.

## 11. Open questions (resolve at plan/review)
- Research facility NAME ("Research Lab" / "Research Division" / other — user picks).
- Exact tier-1 blueprint recipes (finalized WITH the Fabricator, since it consumes them) — first-pass amounts for now.
- Whether Research + Fabricator ship as a pair (recommended, so no idle window) or Research ships first.
- Slot-per-level vs a separate slot-upgrade line; number of tiers to seed now.
