# Phase 1 — Facility Framework + Refinery — Implementation Plan

> **For Claude:** Execute task-by-task, subagent-driven, with two-stage review (spec then quality) per task.

**Goal:** Ship the reusable facility framework + the Refinery (timed refine jobs + upgrades), on a new
keyed inventory + item registry + discovery data model, migrated v17→v18.

**Architecture:** A shared, closed-form **timed-process engine** (refine jobs + facility upgrades) whose
completion resolver is ONE exported helper called by both offline `tick()` and App.svelte's live loop
(mirroring the shipped `foldLifetimeStatsDelta` drift-proof pattern). Inputs deducted atomically at
process start. Facility processes award **per-tick FA XP** (1/tick per active process, stacking) via the
already-shipped Progression-Pacing-Rework XP plumbing. A keyed `inventory: Record<string, Decimal>`
replaces the fixed-union `homePlanet.storage`.

**Tech Stack:** TypeScript, Svelte, `break_infinity.js` (`Decimal`), Vitest.

**Read first:** `docs/plans/2026-07-11-facility-framework-refinery-design.md` — ESPECIALLY §0 Reconciliation
(authoritative: v17→v18, lifetimeStats already live, per-tick facility FA XP, keyed-inventory confirmed).

**⚠️ ENVIRONMENT:** No Node/npm/tsc/vitest locally. "Run tests" = author + hand-trace; Vercel only *bundles*
(esbuild, NO typecheck). **HARD MERGE GATE:** the keyed-inventory refactor (Tasks 4–7) is a ~163-site
replacement with no local typecheck — this feature must NOT merge to production until the user runs
`npm run check` (svelte-check) at home. Every task: strict anti-regression, closed-form parity preserved.

---

## GROUP A — Foundational data model (additive; homePlanet.storage stays for now)

### Task 1 — Item registry (`ITEMS`) + item types
- **Files:** `src/lib/game/model.ts`; test `model.test.ts`.
- Add `ItemCategory` (`raw|refined|minorComponent|majorComponent|shipModule|shipSystem`), `ItemRarity`
  (`common|uncommon|rare|epic|legendary`), `ItemDef` (label/category/tier/rarity/flavor/`equipStats?`), and
  `ITEMS: Record<string, ItemDef>` seeding the CURRENT items: `commonOre`, `uncommonMaterial`, `rareMaterial`
  (raw), `refinedMaterial`, `components` (refined). Rarity/tier per sensible defaults; comment as launch table.
- Test: `ITEMS` has the 5 seed entries with correct categories; every current `HomePlanetMaterialKey` has an
  `ITEMS` entry (guards drift). Commit: `feat(phase1): add ITEMS registry + item taxonomy types`.

### Task 2 — Keyed `inventory` + `discovered` on GameState (additive)
- **Files:** `model.ts` (`GameState`, `freshState`); test `model.test.ts`.
- Add `inventory: Record<string, Decimal>` and `discovered: string[]` to `GameState`. `freshState`: seed
  `inventory` from the SAME zero values `homePlanet.storage` uses (keep both in sync for now), `discovered: []`.
  homePlanet.storage is NOT removed yet (Task 7). Test freshState shape. Commit: `feat(phase1): add keyed inventory + discovered set (additive)`.

### Task 3 — Facility/process state + migration v17→v18
- **Files:** `model.ts` (`GameState`: `facilities`, `activeProcesses`, `nextProcessId`); `save.ts`
  (`MIGRATIONS[17]`, SAVE_VERSION→18, hydrateDecimals); tests.
- Add to GameState: `facilities: Record<FacilityKey,{level:number}>` (Task 10 defines `FacilityKey`; use
  `Record<string,{level:number}>` here or forward-declare), `activeProcesses: TimedProcess[]` (Task 8 type),
  `nextProcessId: number`. Seed in freshState (`{refinery:{level:0}}`, `[]`, `1`).
- `MIGRATIONS[17]`: build `inventory` from `homePlanet.storage` (copy each Decimal), seed `discovered` with
  every itemId whose balance > 0, add `facilities`/`activeProcesses`/`nextProcessId`. Do NOT touch
  `lifetimeStats` (already live). `hydrateDecimals`: revive `inventory`'s per-value Decimals (mirror the
  homePlanet.storage hydration) + any Decimal in activeProcesses effects. Bump SAVE_VERSION 18.
- Test: v17→v18 round-trip — inventory built from storage, discovered seeded, facilities/processes init, existing
  fields intact, Decimals revived. Commit: `feat(save): migrate v17->v18 (inventory/discovered/facilities/processes)`.

---

## GROUP B — Inventory refactor (homePlanet.storage → inventory), staged + reviewed per file

> ⚠️ The risky part. Convert readers/writers incrementally; each task keeps homePlanet.storage in lockstep
> UNTIL Task 7 removes it, so nothing breaks mid-refactor. Grep each file for `homePlanet.storage` and convert
> EVERY site. No typecheck — the reviewer must independently grep for missed sites.

### Task 4 — Convert `tick.ts` (loot delivery, passiveTrickle, craftRecipe) to `inventory`
- All `state.homePlanet.storage[k]` reads/writes → `state.inventory[k]`. Mark items `discovered` when added.
  Update `tick.test.ts` assertions/fixtures accordingly. Preserve closed-form + all values.
- Commit: `refactor(phase1): tick.ts reads/writes keyed inventory`.

### Task 5 — Convert `App.svelte` (UI readers) to `inventory`
- The 12 `homePlanet.storage` UI references → `inventory`. No behavior change. Commit: `refactor(phase1): App.svelte reads keyed inventory`.

### Task 6 — Convert `save.ts` + remaining test fixtures to `inventory`
- save.ts references + the large `save.test.ts`/`tick.test.ts`/`model.test.ts` fixtures. Commit: `refactor(phase1): convert save + test fixtures to keyed inventory`.

### Task 7 — Remove `homePlanet.storage`
- Grep confirms ZERO remaining `homePlanet.storage` references outside comments. Remove the field from GameState +
  freshState + the `HomePlanetMaterialKey`-keyed type (keep `HomePlanetMaterialKey`/`LootMaterialKey` if still used
  as item-id unions). Migration keeps building inventory from OLD saves' storage. Commit: `refactor(phase1): drop homePlanet.storage (fully replaced by inventory)`.
- **→ CHECKPOINT (bundle):** push; confirm the Vercel preview BUNDLES (catches syntax/import breaks the refactor
  may have introduced — though not type errors). Flag to user: full typecheck still pending `npm run check` at home.

---

## GROUP C — Timed-process engine (additive, closed-form, drift-proof)

### Task 8 — `TimedProcess` engine core
- **Files:** `src/lib/game/process.ts` (new) or in `tick.ts`; test.
- `TimedProcess`/`ProcessEffect` types (design §3). `startProcess(state, kind, inputs, durationTicks, effect)`:
  gate on inputs available, deduct atomically, push process with `startTick`, `nextProcessId++`. 
  `resolveProcesses(state, nowTick)`: complete any process with `nowTick - startTick >= durationTicks` (apply
  effect: addItem→inventory + discovered, facilityLevelUp→facilities), award **per-tick FA XP** for each process's
  active ticks this step (1/tick, into the existing fleetAdminXp plumbing), remove completed. Closed-form (offline =
  bulk). Test: atomic deduct prevents double-consume; completion applies effect; FA XP per-tick; big-jump==stepped.
- Commit: `feat(phase1): timed-process engine (atomic start, closed-form resolve, per-tick FA XP)`.

### Task 9 — Wire the resolver into tick() + live loop (single source)
- Call `resolveProcesses` from BOTH `tick()` and App.svelte's live poll (ONE helper, no second copy — mirror
  `foldLifetimeStatsDelta`). Add a parity test: process completion + FA XP identical offline vs live.
- Commit: `feat(phase1): thread timed-process resolver through tick() + live loop`.

---

## GROUP D — Facility framework + Refinery

### Task 10 — Facility framework (types + FACILITIES + buildability + startUpgrade)
- `FacilityKey` (`"refinery"`), `FacilityDef`/`FacilityUpgradeDef` (design §5, incl. `requiresFleetAdminLevel?`),
  `FACILITIES` table (refinery upgrade track: unlock L0→1, +slot levels — FINITE, real content only).
  `canBuildUpgrade(state, facility)` (materials + prereqs incl. FA level). `startFacilityUpgrade` = a
  `facilityUpgrade` TimedProcess (atomic). Concurrency: unlimited upgrades (material-gated). Tests.
- Commit: `feat(phase1): facility framework + refinery upgrade track`.

### Task 11 — Refine jobs (recipes, slots, batch/continuous orders, exhaustion, itemsRefined)
- Refine recipe(s): `commonOre → refinedMaterial` + `durationTicks` (design §6 starting values). Slots from
  refinery level cap parallel jobs. `startRefineOrder` (count N or continuous); per-iteration atomic; material
  exhaustion → pause + auto-resume (design §6). On each completed iteration: output→inventory, mark discovered,
  `lifetimeStats.itemsRefined[id] += amount`. Offline closed-form bulk (design §6 formula). Tests incl. closed-form.
- Commit: `feat(phase1): refinery refine jobs (batch/continuous, closed-form, lifetime itemsRefined)`.

---

## GROUP E — UI (MOCKUP-GATED — hard stop)

### Task 12 — Refinery panel UI  ⛔ REQUIRES A USER MOCKUP FIRST
- Per the user's own rule ([[feedback_visual_ui_needs_mockup]]) + design §9: STOP and get a sketch of the Refinery
  panel (upgrade track w/ `[Item] 5/5 ✅ / 4/5 ❌` readiness, job slots, "currently building" progress rows) before
  building. Do NOT build UI from the text spec alone. When the mockup arrives, this task (or a fresh design pass)
  builds it, gated on `DEV_MODE`-free reachability decisions as needed.

---

## GROUP F — Version + docs

### Task 13 — Version bump + docs
- APP_VERSION minor bump (0.5.0 → 0.6.0) + PATCH_NOTES entry; KNOWN_ISSUES (refinery durations/ratios/slot counts
  are tunable placeholders; UI pending mockup); SESSION_LOG entry. Commit: `chore(phase1): version + docs`.

---

## Notes for the executor
- **Order:** A → B → (bundle checkpoint) → C → D → E(mockup gate) → F. Group B is the risky refactor — reviewers
  MUST independently grep for missed `homePlanet.storage` sites; a miss = a runtime bug (no typecheck to catch it).
- **Never** claim a test ran (no Node). Author + hand-trace; the user runs `npm run check` + `vitest` at home — that
  typecheck is the HARD merge gate for this feature (large refactor).
- **Closed-form:** every timed process (refine/upgrade) and its FA-XP must satisfy big-jump==stepped.
- Reference @superpowers:subagent-driven-development for the per-task loop.
