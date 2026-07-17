# Shipyard (Phase 5) — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development to execute this task-by-task.
> Design: `docs/plans/2026-07-16-shipyard-design.md`. Branch: `feat/shipyard` (off `staging`). **Staging-only**
> (production frozen until Combat).

**Goal:** a Shipyard facility that builds ships from a component BOM + credits via timed construction, unifying
all material consumers on the reservation (`free`) model.

**Architecture:** A `shipBuild` timed process (1 slot) consumes a hull's `ShipTypeDef.buildRecipe` (components
reserved via the existing derived-allocation model + credits deducted at start) and, on completion, mints a
parked `ShipInstance` (new `addShip` effect). The instant credit-buy (`buyShip`/Requisition) is retired; Docks
assignment stays. Allocation is extended so a build's reserved BOM counts toward `allocated`, and EVERY material
spender routes through `freeItem`.

**Tech Stack:** Svelte 5 (legacy `$:`), `break_infinity.js` Decimal, Vitest, svelte-check. **Node via
`export PATH="/c/Program Files/nodejs:$PATH"` before EVERY npm/npx.** Gate each task: `npm run check` (0 errors)
+ `npm test` (green). Baseline on `staging`: check 0 errors / 20 pre-existing App.svelte CSS warnings; **632 tests**.

**Definition of done:** found the Shipyard (credits + FA level) in Sector Space; build a hull from a component
BOM + credits over a timed job (1 slot, build-speed upgrades), producing a parked hull you assign via Docks;
ship-builds + facility upgrades + all spenders respect `free` (no double-spend); Requisition/`buyShip` retired;
offline==live; save v24→v25 round-trips; check 0 / tests green; APP_VERSION 0.13.0.

**⚠️ Reference implementations to MIRROR:** the Fabricator/crafting engine (`startFabricateJob`/`canFabricate`,
`allocation.ts` `allocatedItem`/`freeItem`, the `startProcess`+`resolveProcesses` `addItem` completion, the C4
configurator + C6 migration); `FACILITIES.research`/`fabricator` (founding + upgrade track + FA-level gate);
`buyShip`/`assignShipToCaptain` + the Starbase Docks/Requisition UI (what's retired vs kept); the C2 multi-line
offline-parity test idiom (`craft-lines.test.ts`).

---

## Task S1: Data model — `buildRecipe` + `FACILITIES.shipyard` + `shipBuildSlotCount` + seed

**Files:** Modify `src/lib/game/model.ts` (`ShipTypeDef.buildRecipe`, `FACILITIES.shipyard`, fresh-state seed),
`src/lib/game/tick.ts` (`shipBuildSlotCount`); Test `src/lib/game/shipyard.test.ts` (new).

**Read first:** `ShipTypeDef` + `SHIP_TYPES` (the hulls: generalFreighter/hauler/runner/prospector — confirm exact
keys); `FACILITIES.research`/`fabricator` (founding rung with `credits` + `requiresFleetAdminLevel`, the upgrade
track shape, `FacilityUpgradeEffect`); how the Shipyard placeholder is referenced (App.svelte locked rail item);
fresh-state facility seed.

**Build (mirror the facility pattern):**
- `ShipTypeDef.buildRecipe: { components: Record<string, number>; credits: number; durationTicks: number }` on
  EVERY `SHIP_TYPES` entry. First-pass TUNABLE values scaling with the hull (bigger/faster = more components +
  credits + time); use real component item ids (`frameSegment`/`powerCoupling`/`structuralAssembly`). Flag in-code.
- `SHIPYARD_FACILITY_KEY = "shipyard"`; `FACILITIES.shipyard` — Fleet-Sector owner, founding rung gated on
  `credits` + `requiresFleetAdminLevel` (clone the research/fabricator founding); upgrade rungs carry a NEW
  `buildSpeedMult` (or `buildDurationScale`) `FacilityUpgradeEffect` field (additive+inert, like `addFabricateSlots`).
  Fresh state seeds `shipyard` at level 0 (LOCKED/unfounded — NOT auto-established; the founding rung establishes it).
- `shipBuildSlotCount(state)` in tick.ts = 1 (a forward hook; a `const` for now, documented for drones).

**TDD (`shipyard.test.ts`):** every `SHIP_TYPES[k].buildRecipe` has positive components/credits/duration + real
component ids; `FACILITIES.shipyard` exists (Fleet-Sector, founding credits+FA-level, build-speed upgrade rungs);
`shipBuildSlotCount` === 1; fresh state seeds shipyard level 0. → commit `feat(shipyard): ShipTypeDef.buildRecipe + Shipyard facility (founding + build-speed track)`.

## Task S2: Allocation UNIFICATION — builds reserve BOM + all spenders use `free` ⚠️ cross-cutting

**Files:** Modify `src/lib/game/allocation.ts` (extend `allocatedItem` to include a build's reserved BOM),
`src/lib/game/tick.ts` (`canBuildFacilityUpgrade`/`startFacilityUpgrade` → `free`; audit every material spender);
Test `allocation.test.ts` + a new reservation test.

**Read first — CRITICAL:** `allocation.ts` (`allocatedItem(lines, itemId)` = Σ lines' remaining × inputs;
`freeItem`); `canBuildFacilityUpgrade`/`startFacilityUpgrade` (they read raw `state.inventory[item]` — the leak);
grep EVERY `state.inventory[` material read that gates a SPEND (facility upgrades, craft-line starts [already use
free], ship-build [S3], fuel). Also the shipBuild state you'll add in S3 — coordinate: `allocatedItem` must sum
BOTH craft lines AND any in-flight/queued ship build's reserved BOM.

**Build:**
- Introduce a single reservation source: `allocatedItem(state, itemId)` (or a helper that takes the whole state)
  summing craft-line reservations + an in-flight `shipBuild`'s remaining BOM. (Decide the cleanest signature — the
  craft `allocatedItem(lines,...)` may become `allocatedItem(state,...)`; update its call sites. Keep it derived.)
- `freeItem(state, itemId)` = `inventory − allocatedItem`.
- **Route `canBuildFacilityUpgrade` + `startFacilityUpgrade` through `freeItem`** (not raw inventory). Audit and
  convert every other material-spend gate (the ship-build gate lands in S3 already using free).

**TDD:** a facility upgrade can NO LONGER spend materials a craft line reserved (blocked on `free`); `freeItem`
still ≥ 0; existing craft-line allocation tests still pass (behavior-preserving for lines). ⚠️ Confirm no
behavior change to a facility upgrade when nothing is reserved (free == raw). → commit `refactor(alloc): unify all material spenders on free (facility upgrades + ship builds)`.

## Task S3: Build engine — `shipBuild` + `addShip` + `canBuildShip` ⚠️ offline parity

**Files:** Modify `src/lib/game/model.ts` (`TimedProcessKind |= "shipBuild"`; `ProcessEffect |= { type:"addShip"; typeKey }`),
`src/lib/game/tick.ts` (`startShipBuild`, `canBuildShip`, `resolveProcesses` addShip branch), fresh-state; Test `shipyard.test.ts`.

**Read first:** `startFabricateJob` (deduct-at-start + startProcess), `resolveProcesses` (the `addItem` branch —
you ADD an `addShip` branch beside it), `nextShipId`/`ShipInstance` mint + `shipStorageCapacity`, `canFabricate`
(typed-reason idiom), `shipBuildSlotCount` (S1), the S2 `freeItem`.

**Build:**
- `resolveProcesses` `addShip` branch: on completion, mint `ShipInstance { id: "ship-"+nextShipId, typeKey, assignedCaptainId: null }`,
  push to `state.ships`, bump `nextShipId` — ONLY if `ships.length < shipStorageCapacity` (else... decide: drop the
  build with a log, or hold — RECOMMEND: the build shouldn't have STARTED if storage was full, so at completion just
  park it even if it would exceed by the one it reserved a slot for; simplest correct: gate at START on storage, park at completion).
- `canBuildShip(state, typeKey) -> {ok}|{ok,reason}`: reasons `notFounded` (shipyard level 0), `noSlot` (a shipBuild
  already in flight — 1 slot), `storageFull` (`ships.length >= shipStorageCapacity`), `materials` (BOM unaffordable
  from `freeItem`), `credits`. `startShipBuild` delegates; reserves BOM (the reservation is the in-flight process's
  BOM that `allocatedItem` sums) + deducts credits at start; pushes a `shipBuild` process (`durationTicks` scaled by
  the Shipyard's build-speed upgrade). Exclude `shipBuild` from FA-XP (like the craft jobs).
- ⚠️ **Offline-parity test:** `tick(bigSpan)` == looping `economyTick(·,1)` for `ships` + `activeProcesses` +
  inventory + credits across a build completing mid-span. NON-VACUOUS (a hull actually parked, BOM consumed, credits
  deducted once).

→ commit `feat(shipyard): shipBuild engine (addShip effect, canBuildShip, offline-parity)`. **Controller re-verifies parity.**

## Task S4: Retire Requisition + `buyShip` (keep Docks)

**Files:** Modify `src/App.svelte` (remove the Requisition sub-tab + its buy panel + `doBuyShip`), `src/lib/game/tick.ts`
(remove `buyShip`); Test — remove/update `buyShip` tests.

**⚠️ Comprehension-first:** grep every `buyShip`/`doBuyShip`/Requisition ref. KEEP `assignShipToCaptain` + the Docks
sub-tab + `shipStorageCapacity`. The fresh-state starter Freighter seed stays. Remove the `StarbaseSubTab` "requisition"
entry (leaving "docks"), `doBuyShip`, the Requisition panel markup, `buyShip` + its imports/tests. Grep confirms zero
dangling refs. `npm run check` 0. → commit `refactor: retire Requisition credit-buy (buyShip); Shipyard builds hulls now`.

## Task S5: UI — Shipyard build panel ⚠️ MOCKUP-GATED

**Files:** Modify `src/App.svelte`.

**⚠️ STOP: the CONTROLLER produces a mockup of the Shipyard build panel and gets user approval BEFORE any UI code**
([[feedback_visual_ui_needs_mockup]]).

**Build (to the approved mockup):** unlock the `shipyard` rail item into a real facility panel (House rail + SubTabs):
**Build** (hull list — each hull's BOM with component free/allocated/total, credit cost, build time via `formatClock`;
a Build button gated by `canBuildShip` + reason text; the in-flight build shows a progress bar + time-remaining via
`remainingReadout`), **Upgrades** (the founding rung + build-speed track wired to `canBuildFacilityUpgrade`/the shared
start-upgrade handler). New `doStartShipBuild(typeKey)` commits state like the sibling handlers. Reuse crafting/tick
CSS + helpers. `npm run check` 0. → commit `feat(ui): Shipyard build panel (build hulls, upgrades)`.

## Task S6: Save migration v24→v25

**Files:** Modify `src/lib/game/save.ts` (`MIGRATIONS[24]`, `SAVE_VERSION=25`); Test `save.test.ts`.

**Read first:** `MIGRATIONS[23]` (v23→v24) — clone. **Build:** seed `facilities.shipyard` at level 0 (locked/unfounded)
if absent; any shipBuild state rides `activeProcesses` (already handled); no hydration change (ShipInstance Decimal-free).
`SAVE_VERSION=25`; never edit shipped `[0..23]`; update chained-shape assertions the bump touches. **TDD:** v24 → migrate
→ v25 (shipyard level 0, matches freshState, round-trips). → commit `feat(save): migration v24->v25 (shipyard state)`.

## Task S7: Version bump 0.13.0 + docs

**Files:** `src/lib/patchNotes.ts` (0.12.0→**0.13.0** + entry), `KNOWN_ISSUES.md` (RESOLVE the facility-upgrade free-leak
entry; note first-pass BOM tunables + deferred refit/repairs/drones/advanced-hulls), `SESSION_LOG.md`.

- Patch note: a new **Shipyard** where you BUILD ships from your fabricated components + credits over a timed
  construction (assign the finished hull to a captain at the Docks); the old instant credit-buy is retired; reserved
  materials are now protected across ALL builds. Note refit/repairs/advanced hulls come later.
→ commit `chore: bump 0.13.0 + Shipyard patch notes`.

---

## After all tasks
Final holistic review (esp. the S3 offline-parity seam + the S2 free-unification completeness — grep that NO material
spend still reads raw `inventory[item]`). Merge to staging, device-check. **Combat** is the roadmap gate for the eventual
production promotion. Log deferred items (refit, repairs, drones, advanced hulls + research-gated ship blueprints) to SUGGESTIONS.
