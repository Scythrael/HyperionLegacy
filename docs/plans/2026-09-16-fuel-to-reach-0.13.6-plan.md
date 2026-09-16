# 0.13.6: Fuel becomes Reach (implementation plan)

Status: PLAN (2026-09-16). Pulled into 0.13.6 by user decision (the fuel-duty captain is a live pain
point). Design lives in `2026-09-15-exploration-crew-saga-0.14.0-design.md` Part A; this is the build
plan for the 0.13.6 SLICE. US English, no em dashes.

## Decisions (user, 2026-09-16)
- Fuel stops being a resource; it is a STAT. Instant free refuel, no stockpile / refining / mining.
- The only fuel constraint is REACH: a ship's range vs a mission's distance, gated round-trip.
- Display range/distance in **lightyears** (realistic scale, not absurd; the extreme long-distance
  missions that "test the limits" arrive with 0.14.0 exploration content).
- RETIRE the Fuel Depot facility. RETIRE Deuterium Ice + the `localFuelRun` skim mission (ensure a
  starter mission remains, e.g. `shortOreRun`).
- Header: remove the global fuel readout; show range (ly) on the ship panel + dispatch/patrol cards.

## The model (PARITY-PRESERVING by construction)
Keep the existing reachability gate algebra; relabel it into lightyears and delete the depletion.
- `LY_PER_TICK` = a first-pass tunable constant (0.16.0 balance). Distances are realistic-ish:
  local runs a few ly, cross-system tens of ly; extreme (0.14.0) missions far more but never millions.
- `distanceLightYears(mission) = roundTripTransitTicks(mission) * LY_PER_TICK` (MISSION-intrinsic).
- `rangeLightYears(ship) = fuelCapacity * (1 + engineEfficiency) * LY_PER_TICK` (SHIP-intrinsic).
- Gate: `rangeLightYears(ship) >= distanceLightYears(mission)`.
  This is algebraically identical to today's `fuelCapacity >= fuelNeeded`
  (`fuelNeeded = roundTripTransitTicks / (1 + engineEfficiency)`, FUEL_PER_TICK = 1), so NO mission
  changes eligibility: pure relabel + display. That is the parity guarantee.
- Distance is mission-intrinsic; range folds the ship's efficiency. Two clean axes.

## Build sequence (incremental, gated each step; keep staging green)
1. **Reach/ly model (pure, dormant + tests).** Add `distanceLightYears`, `rangeLightYears`, and a
   `canReach(ship, mission)` helper (fuel.ts). Prove gate-equivalence to the current fuelCapacity
   check. Nothing wired yet. Parity-safe (adds pure fns).
2. **Cut the depletion + production economy.** Remove: the stockpile spend in `economyTick`, the
   shared fuel-budget threading, `processFuelPipelines` / `fuelRefineJob`, `buyFuel` + credit
   auto-buy + `REFUEL_PENALTY_TICKS`, the fuel-runway/EMA. Dispatch gates on REACH only (drop the
   `fuelEmpty` RESOURCE reason; keep the `fuelCapacity`/RANGE reason, now reach). Heavy test churn:
   every fuel-spend / refine / runway / auto-buy test retires or flips to the reach gate; parity
   fixtures that carried fuel drop the fuel axis. Run parity after.
3. **Retire the facility / material / mission + migrate.** Remove the `fuelStorage` (Fuel Depot)
   facility (nav + FACILITY_LABELS + console + upgrades), `deuteriumIce`, and `localFuelRun`.
   Save migration (SAVE_VERSION bump): drop `state.fuel`, the `fuelStorage` facility level, any
   in-flight `fuelRefineJob` processes, and the `deuteriumIce` inventory key; a captain sitting on
   `localFuelRun` is reset to idle. Confirm a fresh save still has an available starter mission.
4. **UI: lightyears.** Remove the header fuel button. Show `rangeLightYears` on the ship panel and
   each mission/patrol card, with the mission's `distanceLightYears` and a clear "out of range"
   state on the dispatch gate. Remove the Fuel Depot console + runway readouts. (Needs devpreview.)
5. **Help / copy sweep.** Update any HELP topic + tooltip that describes fuel-as-a-resource.

## Risks / notes
- PARITY is the crux (offline == live). Step 1's equivalence keeps eligibility identical; step 2's
  deletions must not change WHICH missions run, only remove the per-trip cost. Lean on
  `npx vitest run -t "parit"` after step 2.
- Migration must be lossless for everything EXCEPT the retired fuel state; settings untouched.
- LY_PER_TICK and any per-hull range numbers are FIRST-PASS TUNABLE (0.16.0 balance pass).
- Cannot preview locally; steps 4 (UI) needs a devpreview pass with the user.
