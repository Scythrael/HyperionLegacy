# Mission Rework + Fuel Economy — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development to execute this task-by-task.
> Design: `docs/plans/2026-07-14-mission-rework-design.md`. Branch: `feat/mission-rework` (off main @ 735ca36).

**Goal:** 4 material-sourcing missions + a mission-control unlock facility + a fuel economy (buy/store/spend) + per-mission XP, feeding future crafting.

**Architecture:** Extends the existing closed-form mission engine (`tickCaptainMission` inside `economyTick`) and the Phase-1 facility framework (`FACILITIES`, timed upgrades) + Phase-2 warehouse cap-upgrade pattern. Fuel deducts at dispatch (closed-form-safe). No new tick loop.

**Tech Stack:** Svelte 5, `break_infinity.js` Decimal, Vitest, svelte-check. Node via `export PATH="/c/Program Files/nodejs:$PATH"` before every npm/npx. Gate each task: `npm run check` (0 errors) + `npm test` (green).

**Definition of done:** all 12 raw materials sourced by 4 missions; mission-control unlocks Salvage+Forage at ~50× ore completions; fuel bought at 5cr/unit into a capped tank, spent per dispatch, auto-repeat stops on empty; per-mission XP + exp/tick shown; requirements gate dispatch; save v20→v21 round-trips; check 0 / tests green; APP_VERSION bumped.

**⚠️ Two high-risk tasks (controller re-verifies personally): Task 2 (fractional XP parity) and Task 5 (fuel offline==live parity).**

---

## Task 1: Missions & materials — rename + 2 new + loot tables

**Files:** Modify `src/lib/game/model.ts` (MISSIONS, mission labels, primaryMaterial); Test `src/lib/game/model.test.ts` (or a new `mission-catalog.test.ts`).

- Keep `MissionKey`s `shortOreRun`/`longOreRun` (label-only rename → no key migration). Add 2 new keys: `salvageWreckage`, `forageFlora`.
- Rename display labels: Local Asteroid / Lunar Mine Contract / Salvage Skirmish Wreckage / Forage Minerals & Flora.
- Each mission's loot triad maps to the scaffolded `ITEMS` (common/uncommon/rare): ore1=Titanium/Polysilicate/Iridium; ore2=ferriteOre/cobaltOre/osmiumOre; salvage=scrapAlloy/salvagedCircuitry/intactReactorCore; forage=fibrousBiomass/volatileResin/exoticSporeCluster. Reuse the existing rarity roll (drop rates 98.5/1.4/0.1 per Phase-1 balance note; tunable).
- Set each new mission's `primaryMaterial` = its common item (auto-stop gate).
- New missions reuse the existing cycle/phase model; give first-pass transit/extraction/unloading durations (tunable).

**Steps:** (1) failing test: `MISSIONS.salvageWreckage`/`forageFlora` exist with 3 rarity-tagged loot items each + a `primaryMaterial`; all 4 missions' triads resolve to real `ITEMS`. (2) run → fail. (3) implement MISSIONS entries + label renames. (4) run → pass. (5) commit `feat(mission): rename ore runs + add salvage/forage missions with loot triads`.

## Task 2: XP — retune rates + ⚠️ fractional-rate parity + exp/tick

**Files:** Modify `src/lib/game/model.ts` (`BASE_XP_PER_TICK`), possibly `tick.ts` (accrual, only if not already per-step); Test `src/lib/game/tick.test.ts` + a NEW fractional-parity test.

- Set `BASE_XP_PER_TICK`: `shortOreRun:1, longOreRun:1.1, salvageWreckage:1.2, forageFlora:1.25` (first-pass).
- **⚠️ CRITICAL:** read tick.ts:304 "CLOSED-FORM PARITY TRAP". Confirm the accrual awards `Decimal(xpRate).times(wholeTicksThisCall)` per `economyTick` call and that BOTH tick() and the live loop step per-tick (they do, post-Phase-2). If any path passes multi-whole-tick spans, fix to per-step.
- **Required test:** a closed-form parity test AT rate 1.1 (or 1.25): assert `tick(bigSpan)` XP == looping `economyTick(·,1)` XP for a fractional-rate mission, across a span that crosses a level-up. This replaces the rate-1 test's blind spot.

**Steps:** (1) failing parity test at a fractional rate + a per-mission-rate test. (2) run → fail (rate values / parity). (3) set rates; if parity fails, re-derive accrual to be strictly per-step (Decimal-wrap the per-step rate, never `rate*N` for N>1 whole ticks). (4) run → pass. (5) commit `feat(mission): per-mission XP rates + fractional-rate closed-form parity test`.

**Then exp/tick readout (same task or split):** Operations mission UI shows `xpPerTick(missionKey, captain)` per mission. Commit `feat(ui): show exp/tick per mission`.

## Task 3: Fuel data model — ship stats, GameState.fuel, constants, fuelNeeded

**Files:** Modify `src/lib/game/model.ts` (ShipTypeDef/ShipInstance stats, SHIP_TYPES, GameState.fuel, fuel constants), `src/lib/game/tick.ts` or a new `src/lib/game/fuel.ts` (`fuelNeeded`); Test `src/lib/game/fuel.test.ts`.

- Add ship stats `fuelCapacity: number`, `engineEfficiency: number` to `ShipTypeDef`; give the 4 existing hulls distinct first-pass values (Freighter big tank/low eff, Runner small tank/high eff, etc.). Grandfather onto `ShipInstance`.
- Add `GameState.fuel: Decimal` (current stockpile). Cap derives from the fuel-storage facility level (Task 4).
- Constants: `FUEL_PER_TICK = 1`, `FUEL_CREDITS_PER_UNIT = 5`.
- `fuelNeeded(mission, ship) = roundTripTransitTicks(mission) * FUEL_PER_TICK / (1 + ship.engineEfficiency)` — roundTrip = out+back transit phase ticks. Pure function.

**Steps:** (1) failing test: `fuelNeeded` for a known mission+hull; a more-efficient hull needs less. (2) run→fail. (3) implement stats + constants + fuelNeeded. (4) run→pass. (5) commit `feat(fuel): ship fuel stats, GameState.fuel, fuelNeeded`.

## Task 4: Fuel-storage facility (cap-upgrade, Warehouse pattern) + buy fuel

**Files:** Modify `src/lib/game/model.ts` (`FACILITIES.fuelStorage`), `src/lib/game/tick.ts` (fuel cap helper + `buyFuel`), Test `fuel.test.ts`.

- `FACILITIES.fuelStorage`: base cap + doubling upgrade track (mirror `warehouseT1`); `fuelCap(state) = BASE × 2^level` (parallel `tierCap`).
- `buyFuel(state, units)`: cost `units × FUEL_CREDITS_PER_UNIT`; clamp to remaining cap; deduct credits; add fuel. Guard affordability + cap.

**Steps:** (1) failing tests: fuelCap scales with level; buyFuel deducts credits, respects cap + affordability. (2) run→fail. (3) implement. (4) run→pass. (5) commit `feat(fuel): fuel-storage facility + buyFuel`.

## Task 5: ⚠️ Fuel consumption at dispatch + auto-repeat stop-on-empty + offline parity

**Files:** Modify `src/lib/game/tick.ts` (dispatch path in `dispatchCaptainOnMission` + the auto-repeat point in `tickCaptainMission`/`economyTick`), Test `tick.test.ts` + `fuel.test.ts`.

- On dispatch: block if `ship.fuelCapacity < fuelNeeded` (range) or `state.fuel < fuelNeeded` (resource); else deduct `fuelNeeded` from `state.fuel`.
- Auto-repeat: at the cycle boundary where a mission re-dispatches, deduct fuel again; if the tank can't cover it, STOP (captain idles) — mirror the Warehouse auto-stop gate in `economyTick`. Fuel NOT auto-bought offline (spend-from-tank only).
- **⚠️ Required:** offline==live parity test — a fuel-gated multi-cycle run: `tick(bigSpan)` fuel + captain state == looping `economyTick(·,1)`, including the stop-on-empty cycle.

**Steps:** (1) failing tests: dispatch blocked/deducts; auto-repeat stops when tank empties; offline==live parity for a fuel-gated run. (2) run→fail. (3) implement, reusing the auto-stop pattern. (4) run→pass; controller re-verifies the parity personally. (5) commit `feat(fuel): consume at dispatch + auto-repeat stop-on-empty (offline-parity)`.

## Task 6: Mission-control facility + completion-gated unlock track

**Files:** Modify `src/lib/game/model.ts` (`FACILITIES.missionControl`), `src/lib/game/tick.ts` (unlock helper + gate), Test.

- `FACILITIES.missionControl`: level 1 = ore missions; level-2 upgrade unlocks Salvage+Forage, GATED on `lifetimeStats.missionsCompleted[key] >= ~50` for each current mission (+ optional material cost). Track caps at level 2.
- `missionUnlocked(state, missionKey)` derives from facility level (no separate flag).
- Migration seeds mission-control at level 1 (ore stays available).

**Steps:** (1) failing tests: ore missions unlocked at level 1; the level-2 upgrade requires the completion counts; unlock derives from level. (2) run→fail. (3) implement (reuse `canBuildFacilityUpgrade` with a completion-count prereq). (4) run→pass. (5) commit `feat(mission): mission-control facility with completion-gated unlocks`.

## Task 7: Mission requirements + dispatch gating

**Files:** Modify `src/lib/game/model.ts` (per-mission requirement fields), `src/lib/game/tick.ts` (`canDispatch(state, captainId, missionKey) -> {ok, reason}`), Test.

- Per-mission requirements: captain level, cargo capacity, fuel capacity (first-pass values). Combine with the unlock gate + fuel checks.
- `canDispatch` returns a reason enum for the UI (locked / captainLevel / cargo / fuelCapacity / fuelEmpty / credits).

**Steps:** (1) failing tests per reason. (2) run→fail. (3) implement. (4) run→pass. (5) commit `feat(mission): dispatch requirements + reasons`.

## Task 8: UI — Operations dispatch (requirements/fuel/exp) + Facilities panels

**Files:** Modify `src/App.svelte`. Follow the House rail+SubTabs pattern; reuse Warehouse fill/cap UI for the fuel tank.

- Operations: per-mission requirement display + block-with-reason + exp/tick + fuel cost.
- Facilities: mission-control (Overview: unlocked missions + completion progress; Upgrades: unlock track). Fuel-storage (Overview: fuel/cap gauge + buy-fuel control; Upgrades: cap track).
- Verify `npm run check` 0 errors after markup. Mobile tap patterns per the Warehouse lessons.

**Steps:** additive edits; check after each. Commit `feat(ui): mission requirements, fuel cost/exp readouts, mission-control + fuel-storage panels`.

## Task 9: Save migration v20→v21

**Files:** Modify `src/lib/game/save.ts` (`MIGRATIONS[20]`, `SAVE_VERSION=21`), Test `save.test.ts`.

- Seed `fuel: 0`; fuel-storage level 0; mission-control level 1; grandfather `fuelCapacity`/`engineEfficiency` onto existing ships from hull defs. `:any` signature; never edit shipped migrations.

**Steps:** (1) failing round-trip test (v20 save → v21 shape). (2) run→fail. (3) implement. (4) run→pass. (5) commit `feat(save): migration v20->v21 (fuel + mission facilities)`.

## Task 10: Version bump + docs

**Files:** `src/App.svelte` (APP_VERSION 0.8.0→0.9.0 + PATCH_NOTES), `KNOWN_ISSUES.md`, `SESSION_LOG.md`.

- Patch notes cover the mission rework + fuel economy AND fold in the tile-size/one-tap fix already on main.
- KNOWN_ISSUES: deferred items (refined forms, fuel-refine, consumable, difficulties, engine-module source of engineEfficiency).
- `npm run check` 0 / `npm test` green.
- Commit `chore: bump 0.9.0 + mission-rework/fuel patch notes`.

---

## After all tasks
Dispatch a final holistic reviewer over the whole branch (esp. the two parity seams + the fuel/dispatch/offline integration), then superpowers:finishing-a-development-branch → device test → merge to main + confirm-then-push. First-pass numbers get tuned at the device checkpoint.
