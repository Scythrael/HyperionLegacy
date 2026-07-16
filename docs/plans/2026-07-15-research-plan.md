# Research (Phase 3) — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development to execute this task-by-task.
> Design: `docs/plans/2026-07-15-research-design.md`. Branch: `feat/research` (off main).

**Goal:** a Research facility that unlocks **blueprints** (the future Fabricator's recipes) via timed research projects
costing time + credits, in tiers gated by the facility's upgrade level.

**Architecture:** Extends the Phase-1 facility framework (`FACILITIES`, timed upgrade tracks) + the closed-form
timed-process engine (`startProcess`/`resolveProcesses` — the same machinery behind refine jobs, fuel pipelines, and
facility upgrades). Research projects are timed processes with a new `unlockBlueprint` effect. No new tick loop.

**Tech Stack:** Svelte 5, `break_infinity.js` Decimal, Vitest, svelte-check. Node via `export PATH="/c/Program
Files/nodejs:$PATH"` before every npm/npx. Gate each task: `npm run check` (0 errors) + `npm test` (green).

**Definition of done:** a Research Lab facility (Homeworld) where you start timed research projects (credits + time) on
tier-available blueprints; completing one adds it to `researchedBlueprints`; facility upgrades unlock higher tiers +
research slots; blueprints carry their future Fabricator recipe; save v21→v22 round-trips; check 0 / tests green;
APP_VERSION 0.10.0. Researched blueprints read "craftable when the Fabricator comes online" (Fabricator = next feature).

---

## Task R1: Data model — blueprints + researchedBlueprints + constants
**Files:** Modify `src/lib/game/model.ts` (BlueprintDef, BLUEPRINTS, GameState.researchedBlueprints, constants, helpers), fresh-state seed; Test `src/lib/game/model.test.ts` or new `research.test.ts`.

- `BlueprintDef { key; label; tier: number; researchDurationTicks: number; researchCreditCost: number; recipe: { inputs: Record<string, number>; outputItem: string; outputQty: number }; flavor?; unlockHint? }`.
- `BLUEPRINTS: Record<string, BlueprintDef>` — first-pass content (tunable, flag in-code), using the scaffolded component items:
  - **Tier 1:** `frameSegmentBp` (→ `frameSegment`, recipe from refined mats e.g. titaniumIngot), `powerCouplingBp` (→ `powerCoupling`, from polysilicateWafer/refined mats).
  - **Tier 2:** `structuralAssemblyBp` (→ `structuralAssembly`, from minor components + refined mats).
  - Confirm the exact ITEM keys exist in the registry; use real keys. Recipes are first-pass (finalized with the Fabricator).
- `GameState.researchedBlueprints: string[]` (blueprint keys; no Decimal → no hydration). Fresh state `[]`.
- Helpers: `blueprintUnlocked(state, key)`, `blueprintResearchable(state, key)` (tier ≤ facility level && !unlocked && !in-progress).
- **TDD:** failing test — BLUEPRINTS entries exist with valid tiers/recipes resolving to real ITEMS; fresh `researchedBlueprints` is `[]`; helpers behave. → implement → pass → commit `feat(research): blueprint data model + researchedBlueprints state`.

## Task R2: Research Lab facility
**Files:** Modify `model.ts` (`FACILITIES.research`), `tick.ts` (`researchSlotCount`), fresh-state seed; Test.

- `FACILITIES.research` — new `FacilityKey`, label **"Research Lab"** (provisional — user may rename), Homeworld owner, House rail+SubTabs. Finite upgrade track (caps at real content): each level unlocks the next blueprint TIER; chosen rungs add a research SLOT. Gated on credits (+ optional FA-level prereq, mirror other facilities), TIMED via existing facility-upgrade machinery.
- `researchSlotCount(state)` — from facility level (start **1**, +1 on chosen rungs). Parallels `refineSlotCount`.
- Fresh state seeds `research` at level **1** (tier-1 researchable from start; no soft-lock, mirrors Mission Control).
- **TDD:** fresh state has research level 1 + slot count 1; tier-1 blueprints researchable, tier-2 not (until upgrade); upgrade track caps at real content. → commit `feat(research): Research Lab facility (tier + slot upgrade track)`.

## Task R3: Research engine (timed projects) — ⚠️ offline parity
**Files:** Modify `tick.ts` (`startResearch`, the `resolveProcesses` completion), `model.ts` (ProcessEffect + TimedProcessKind); Test `research.test.ts`.

- Extend the timed-process types: `TimedProcessKind` gains `"researchProject"`; `ProcessEffect` gains `{ type: "unlockBlueprint"; key: string }`.
- `startResearch(state, blueprintKey)`: guard via `canResearch` (R4); **deduct `researchCreditCost` credits at start** (atomic, like `startProcess`/refine deduct-at-start); push a `researchProject` TimedProcess (`durationTicks = researchDurationTicks`, effect `unlockBlueprint{key}`). Respect `researchSlotCount` (count active researchProject processes < slots).
- `resolveProcesses`: on a completed `unlockBlueprint` effect, add `key` to `researchedBlueprints` (idempotent — no dup). No FA XP for research (mirror the fuel-refine exclusion, or include — pick + note; default: exclude, it's automated infra).
- **⚠️ Offline parity:** research runs as ordinary timed processes stepped in `economyTick`; `tick(bigSpan)` == looping `economyTick(·,1)` for `researchedBlueprints` + `credits` + `activeProcesses` across a research completing mid-span. Add the parity test (mirror the fuel-depot/refine parity idiom). Controller re-verifies.
- **TDD:** start deducts credits + starts a process; slot cap blocks a 2nd when full; completion unlocks the blueprint; offline==live parity. → commit `feat(research): research-project engine (credit deduct-at-start, timed unlock, offline-parity)`.

## Task R4: Availability gate + reasons
**Files:** Modify `tick.ts` (`canResearch(state, blueprintKey) -> {ok}|{ok,reason}`); Test.

- `canResearch` reasons: `alreadyResearched`, `tierLocked` (facility level < tier), `noSlot` (all research slots busy), `credits` (can't afford), `inProgress`. Returns `{ok:true}` when researchable + a free slot + affordable.
- Wire `startResearch` to use it. **TDD:** each reason for the right unmet condition; ok when all met. → commit `feat(research): canResearch gate + typed reasons`.

## Task R5: UI — Research Lab panel
**Files:** Modify `src/App.svelte`. Reuse the House rail+SubTabs + facility-upgrade + card/progress idioms.

- Research Lab facility rail entry (Homeworld). **Overview:** research slots in use, in-progress projects with progress bars (reuse refine/upgrade progress idiom), researched-vs-available counts, + the forward signpost ("crafting arrives with the Fabricator"). **Research (list):** blueprints grouped by tier — available ones with a **Research** button gated by `canResearch` (disabled + reason); researched ones marked ✓ ("craftable once the Fabricator is online"); higher-tier locked with the facility-level requirement. Show each blueprint's recipe (what it'll craft) + cost/time. **Upgrades:** the facility track wired to `canBuildFacilityUpgrade`/`doStartFacilityUpgrade`.
- `npm run check` 0; reuse existing CSS; mobile-tap lessons if tooltips. → commit `feat(ui): Research Lab panel (research projects, tiers, upgrades)`.

## Task R6: Save migration v21→v22
**Files:** Modify `src/lib/game/save.ts` (`MIGRATIONS[21]`, `SAVE_VERSION=22`); Test `save.test.ts`.

- Seed `researchedBlueprints: []` + the `research` facility at level 1. `researchedBlueprints` is string keys (no Decimal → no hydration change). `researchProject` processes ride `activeProcesses` (already handled). Mirror the Phase-1/2 seed-migration idiom; never edit shipped migrations. `:any` signature.
- **TDD:** v21 save → migrate → v22 shape (researchedBlueprints [], research L1, tier-1 researchable), round-trips + plays. → commit `feat(save): migration v21->v22 (research state)`.

## Task R7: Version bump + docs
**Files:** `src/lib/game/patchNotes.ts` (APP_VERSION 0.9.0→**0.10.0** + PATCH_NOTES), `KNOWN_ISSUES.md`, `SESSION_LOG.md`.

- Patch note (player-facing): a new **Research Lab** where you research blueprints (time + credits) that unlock what you'll be able to build; blueprint tiers unlock as you upgrade the lab. Note crafting arrives with the Fabricator.
- KNOWN_ISSUES: researched blueprints aren't craftable until the Fabricator (next feature); first-pass tunables (recipes, durations, credit costs, tier count, slot rungs).
- `npm run check` 0 / `npm test` green. → commit `chore: bump 0.10.0 + Research patch notes`.

---

## After all tasks
Final holistic reviewer over the branch (esp. the R3 offline-parity seam + the facility/tier integration), then → the **Fabricator** feature (crafts these blueprints from materials) — likely built next and shipped together with Research so there's no idle window. Tune first-pass values at the device checkpoint.
