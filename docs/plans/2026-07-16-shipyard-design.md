# Shipyard (Phase 5) — Design

**Status:** Design (brainstorm complete 2026-07-16). Next: writing-plans → subagent-driven build.
**Branch:** `feat/shipyard` (off `staging`, which carries v0.12.0). **Staging-only** per the cadence change
(production frozen at v0.10.0 until the roadmap through Combat ships — see [[feedback_fleet_admiral_workflow]]).

**Goal:** a **Shipyard** facility that BUILDS ships from fabricated **components** (+ credits) via timed
construction — giving components their sink and closing the loop research → fabricate → **build a ship**
(the north-star). On the path to Combat.

---

## Locked brainstorm decisions (user, 2026-07-16)

1. **Acquisition = timed build from a component BOM + credits.** Retire the instant credit-only buy
   (`buyShip` / the Requisition panel). Getting a hull now always runs through the production chain.
2. **1 build slot** (one ship at a time). Enough until **drones** (future mass-production) justify parallel
   slots. Upgrades improve **build TIME** (not slot count this pass), and are the future home for
   **refitting** + **repairs**.
3. **Founding gate = credits + Fleet-Admiral level** (like other facilities' founding rung). The Shipyard
   is the locked Fleet-Sector placeholder; establishing it is a deliberate unlock.
4. **Unify ALL material consumers on `free` now.** Ship-builds reserve their components (allocated/free)
   like craft lines; AND fix facility upgrades (and any other spender) to check `free`, closing the
   KNOWN_ISSUES leak the crafting review flagged for "when the Shipyard lands."

---

## 1. Build model

- A **`shipBuild`** timed process (1 concurrent, gated by a new `shipBuildSlotCount` = 1 this pass) consumes
  a hull's **component BOM** (reserved at start) + **credits** (deducted at start) over a **build duration**;
  on completion it adds a **parked `ShipInstance`** (`assignedCaptainId: null`) IF `state.ships.length <
  shipStorageCapacity` (else the build holds/blocks — see engine). The player then assigns it to a captain
  via the existing **Docks** (`assignShipToCaptain` — unchanged). Build → park → assign.
- Offline-safe: `shipBuild` is an ordinary timed process stepped in `economyTick`; a build completing mid
  offline-catch-up just parks the hull. `tick(bigSpan)` == looping `economyTick(·,1)`.

## 2. Shipyard facility (Fleet Sector)

- Unlock the locked **`shipyard`** placeholder as a real `FacilityKey` (House rail + SubTabs), Fleet-Sector
  owner. **Founding** rung gated on **credits + `requiresFleetAdminLevel`** (mirror the other facilities'
  founding + FA-level gates). **Upgrade track = reduced build DURATION** (a `buildSpeedMult`/duration-scale
  effect; first-pass rungs). Refit + repairs are FUTURE rungs (hooked, not built).
- `shipBuildSlotCount(state)` = 1 this pass (a forward hook for drones/parallel builds later).

## 3. Retire Requisition, keep Docks

- Remove the **Requisition** sub-tab + its `buyShip`-with-credits path (the instant credit buy). Keep
  **Docks** (capacity + per-ship rows + `assignShipToCaptain` assign/swap) exactly as-is. The Shipyard's
  build panel replaces Requisition as the hull source. `buyShip` is retired (grep for stragglers; the
  fresh-state starter Freighter stays seeded).

## 4. Material allocation — unify consumers on `free`

- Ship-builds join the derived-allocation model: a `shipBuild`'s reserved components count toward
  `allocated` (extend the allocation basis beyond craft lines — e.g. an `allocatedItem` that also sums a
  build's BOM while it's queued/in-flight), so a build + a craft line can't double-spend the same stock.
- ⚠️ **Route every material spender through `free`**, not raw `inventory`: `canBuildFacilityUpgrade` /
  `startFacilityUpgrade` (the documented leak), the ship-build gate, and (audit) any other. A single
  reserve-aware `spendGate`/`freeItem` check — strictly ≤ raw, so it only ever TIGHTENS. Closes the
  KNOWN_ISSUES entry + the SUGGESTIONS "unify all material consumers" item. Fuel (deuteriumIce) has no
  craft overlap, but audit it too.

## 5. Build engine + new effect

- `TimedProcessKind` gains `"shipBuild"`; `ProcessEffect` gains `{ type: "addShip"; typeKey: ShipTypeKey }`
  (produces a hull, not an inventory item — a NEW resolveProcesses branch, unlike the craft reuse of
  `addItem`). Completion mints a `ShipInstance` from `nextShipId` (parked), respecting `shipStorageCapacity`.
- `startShipBuild(state, typeKey)`: guard via `canBuildShip` (typed reasons: `notFounded`, `noSlot`
  [a build already in flight], `storageFull` [`ships.length >= shipStorageCapacity`], `materials`
  [BOM unaffordable from `free`], `credits`); reserve BOM + deduct credits at start; push the `shipBuild`
  process (`durationTicks` scaled by the Shipyard's build-speed upgrades). Ships excluded from FA-XP (like
  the craft jobs) or included — decide at build (default: exclude, automated infra).
- ⚠️ Offline parity is the high-risk seam — a build completing mid-span must be bit-identical live vs offline.

## 6. Build recipes (BOM)

- Each existing hull (`generalFreighter`, `Hauler`, `Runner`, `Prospector`) gets a first-pass
  `buildRecipe: { components: Record<itemId, number>; credits: number; durationTicks: number }` on
  `ShipTypeDef`, scaling roughly with the hull's stats (bigger/faster hulls cost more components + credits +
  time). All device-check TUNABLE, flagged in-code (same posture as every other first-pass economy value).
  The starter Freighter stays seeded/free; additional Freighters are buildable.

## 7. Scope-deferred (logged to SUGGESTIONS)

Research-gated advanced hulls (the 6 future hull buckets) + ship blueprints in Research; **drones**
(→ parallel build slots / mass production); **refitting** (needs module/equipment system); **repairs**
(needs combat/damage); module/equipment install. All FUTURE — hooked (slot-count forward, upgrade-rung
forward), not built.

## 8. UI (Shipyard build panel) — MOCKUP-GATED

A Shipyard facility panel: **Build** (hull list → each hull's BOM [component free/allocated/total] + credit
cost + build time → Build button gated by `canBuildShip` + reason; the in-flight build shows progress bar +
`formatClock` time), **Upgrades** (the build-speed track). **Build a mockup for approval before coding it**
([[feedback_visual_ui_needs_mockup]]). Reuse the crafting configurator idioms + tick-readout helpers.

## 9. Save migration v24→v25 + version 0.13.0

Seed the `shipyard` facility (level 0 = locked/unfounded, or the founding model's initial state) +
`shipBuild`-order/slot state if any; no hydration change (ShipInstance is Decimal-free). Append
`MIGRATIONS[24]`, `SAVE_VERSION=25`, never edit shipped migrations. Version bump **0.13.0** (staging only).

## 10. Suggested build decomposition (for the plan)

1. **Data model:** `ShipTypeDef.buildRecipe` (BOM+credits+duration), `FACILITIES.shipyard` (founding
   credits+FA-level; build-speed upgrade track), `shipBuildSlotCount`, fresh-state seed.
2. **Allocation unification:** extend `allocatedItem`/`free` to include a build's reserved BOM; route
   `canBuildFacilityUpgrade` + all material spenders through `free`. Tests (a build + a craft line can't
   double-spend; an upgrade can't spend reserved stock).
3. **Build engine:** `"shipBuild"` kind + `"addShip"` effect + resolveProcesses branch; `startShipBuild` +
   `canBuildShip` typed reasons; storage-cap gate; ⚠️ offline-parity test.
4. **Retire Requisition/`buyShip`** (keep Docks + assignment).
5. **UI — MOCKUP first, then build** the Shipyard Build + Upgrades panel.
6. **Migration v24→v25** + round-trip test.
7. **Version bump 0.13.0** + patch notes + KNOWN_ISSUES (resolve the free-leak entry) + SESSION_LOG.

Final holistic review (offline-parity seam + the free-unification completeness — grep that no material
spender still reads raw `inventory`). Then device-check on staging. **Combat** remains the roadmap gate.
