# Fuel Economy v2 — Refining Economy (Design Addendum)

**Status:** Design addendum to `2026-07-14-mission-rework-design.md`. Reworks the unmerged fuel Tasks 4/5 on
`feat/mission-rework` BEFORE merge (fuel v1 = manual-buy + hard-stop + `FUEL_PER_TICK=1` was clunky/bankrupting on
device test). Build as focused TDD tasks with offline-parity re-verified.

**Goal:** make fuel a self-sustaining REFINING economy so a player is never bricked, with credits as a soft backup.

**Why:** device-test feedback — fuel ran dry too fast and could bankrupt/brick. Fix = fuel comes primarily from
refining Deuterium Ice (mined by missions) → you can always dig out; credits auto-buy is the pricier backup.

---

## Scope (this addendum)
1. **Material renames (label-only, keep item keys → no migration for these):** `commonOre`.label "Titanium Ore" →
   **"Deuterium Ice"** (the FTL fuel source); `ferriteOre`.label "Ferrite" → **"Titanium"**. So Local Asteroid's common
   is now Deuterium Ice; Lunar Mine's common is Titanium. `commonOre`/Deuterium Ice gains a refine-to-fuel recipe.
2. **Fuel Depot** (rename facility `fuelStorage` → `fuelDepot`): TWO functions —
   - **Fuel processing plants (pipelines):** continuously refine **Deuterium Ice → fuel, 50 → 100 to start** (tunable),
     auto-running per pipeline, depositing into the tank; **auto-stops** when the tank is full or Deuterium Ice runs
     out (reuse the Phase-2 continuous-refine / timed-process + auto-stop machinery — do NOT hand-roll a new loop).
     Upgrades: **+yield** (more fuel/batch), **−input** (less ice/batch), **+pipelines** (more concurrent). Separate
     from the material Refinery.
   - **Fuel storage:** the tank cap (existing `fuelCap` / capacity upgrades — carry over).
3. **Consumption rework (replaces Task 5 hard-stop):**
   - Mission needs fuel = `fuelNeeded` (unchanged formula).
   - Tank has enough → spend it, no penalty.
   - Tank short → **auto-buy the shortfall from credits** at 5cr/unit **AND add +2 ticks** ("refuel at non-allied
     station") to that mission cycle.
   - Truly broke (tank short AND can't afford the shortfall) → **hard-stop** (mission can't start / stops). Rare,
     because the refinery + friendlier credits keep you afloat.
4. **Rebalance (tunable, device-tuned):** drop `FUEL_PER_TICK` ~25–50× so a round trip costs a small fraction of the
   mission's credit reward (v1: Local Asteroid 50 fuel = 250cr vs ~10cr reward — bankrupting). Also make **mission
   credit rewards a bit friendlier**. Target: fuel is a modest ongoing tax, and refining keeps the tank net-positive.
5. **Fuel top-bar CHIP:** a fuel indicator next to the credits chip (mirror the currency-chip pattern) showing current
   fuel; **tooltip shows refinery PRODUCTION rate vs mission EXPENDITURE rate** (net fuel/min) so the player can
   confirm fuel-sufficiency. Reuse the currency-chip hover/tap + mobile-tap idiom.
6. **One fuel type** now. (Multi-fuel-per-ship + fuel-efficiency rolling on fuel-tank/FTL/sub-light slots = deferred
   with ship equipment/modules.)

## Offline / closed-form (re-verify)
Every new per-cycle quantity — pipeline refining (Deuterium Ice → fuel), fuel consumption, the auto-buy credit spend,
the +2-tick penalty — must be evaluated at the tick/cycle boundary inside the stepped `economyTick`, so `tick(bigSpan)`
== looping `economyTick(·,1)`. Refining is a timed process (Phase-2 machinery is already closed-form). Auto-buy +
penalty are cycle-boundary events. **Required parity test:** a run where refining + consumption + an auto-buy + a
penalty all fire across a multi-cycle span, offline == live bit-identical (fuel, credits, ice, mission state).

## Deferred (NOT this addendum — logged in memory/KNOWN_ISSUES)
- **Civilian/Tax/Infrastructure economy** (citizen population 5k start, 0.25%/hr growth, Civilian Infrastructure cap
  100k, sector upgrades → tax cut, "credits/min" on Homeworld overview, likely its own tab) — a MAJOR future economy
  epic, its own brainstorm. User: "the overall economy can be tabled for a bit later."
- Multi-fuel-per-ship; fuel-efficiency rolling on ship-system slots.

## Suggested build tasks
- **F1:** renames (Deuterium Ice / Titanium) + the Deuterium-Ice→fuel refine recipe + rebalance (`FUEL_PER_TICK` down +
  friendlier mission credits). Tests pin the new values + labels.
- **F2:** Fuel Depot facility (rename `fuelStorage`→`fuelDepot`; pipelines = continuous auto-refine ice→fuel, capped,
  auto-stop; upgrades yield/input/pipelines) — reuse timed-process/continuous-refine engine. Offline parity for refining.
- **F3:** consumption rework — auto-buy shortfall + 2-tick penalty + hard-stop-when-broke (replaces Task-5 stop).
  ⚠️ HIGH-RISK offline-parity task (auto-buy credit spend + penalty per cycle). Required parity test.
- **F4:** fuel top-bar chip + production-vs-expenditure tooltip; Fuel Depot UI (pipelines + storage); drop the now-
  secondary manual-buy or keep it as an optional top-up.
- **F5:** migration (facility rename `fuelStorage`→`fuelDepot` + pipeline state; SAVE_VERSION bump) + patch notes/docs.

First-pass values are all tunable at the device checkpoint.
