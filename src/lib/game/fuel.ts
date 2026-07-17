// ============================================================================
// Fuel model -- pure fuel math for the mission fuel economy.
// Author: Mission Rework Task 3 (docs/plans/2026-07-14-mission-rework-plan.md),
// design §3. Created 2026-07-14.
//
// This module holds ONLY the pure, side-effect-free fuel COST math (the "how much
// fuel does this trip need" question). It deliberately owns no state: the fuel
// STOCKPILE lives on GameState.fuel (Decimal, model.ts), and the buy/spend/cap
// logic lands in tick.ts (Tasks 4/5). Kept in its own file (rather than tick.ts)
// so the pure math is trivially unit-testable and has no import cycle with the
// tick engine.
//
// WHY plain numbers, not Decimal: fuel amounts are SMALL, human-scale values (a
// round trip is tens of ticks, not idle-game astronomical magnitudes), so ordinary
// JS number math is exact enough and far cheaper. Only the accumulating STOCKPILE
// (GameState.fuel) is Decimal, to match the game's other currency fields.
// ============================================================================

import type { MissionDef, ShipTypeDef } from "./model";
import { FUEL_PER_TICK } from "./model";

// --- Functions --------------------------------------------------------------

// roundTripTransitTicks: the number of TRANSIT ticks a full mission round trip
// costs -- transit-OUT plus transit-BACK, and NOTHING else. The mission phase model
// (model.ts's MissionPhase / requiredTicksForPhase) has five phases:
//   ordersReceived -> transitOut -> extracting -> transitBack -> unloading
// Only the two TRANSIT phases represent distance covered under engine power, so only
// those burn fuel: ordersReceived (dispatch paperwork), extracting (station-keeping at
// the site), and unloading (docked at home) are explicitly NOT counted. The two
// transit legs are separate MissionDef fields (transitOutTicks / transitBackTicks) and
// can differ, so the round trip is their SUM -- not simply 2x one leg.
//
// NOTE: this reads the BASE mission's transit fields, i.e. the un-ship-adjusted
// durations. A hull's transitSpeedMult (effectiveMissionDef, model.ts) rescales how
// LONG a leg takes in wall-clock ticks, but fuel cost here is modelled as a function of
// the mission's intrinsic distance, with the hull's contribution expressed SOLELY
// through engineEfficiency in fuelNeeded below. Keeping the two effects on separate
// axes (speed vs. fuel) is a deliberate first-pass choice; revisit at the device check
// if fuel should also scale with a hull's actual (sped-up/slowed) transit time.
export function roundTripTransitTicks(mission: MissionDef): number {
  return mission.transitOutTicks + mission.transitBackTicks;
}

// fuelNeeded: the fuel a given hull burns to fly a given mission's round trip.
//
//   fuelNeeded = roundTripTransitTicks(mission) * FUEL_PER_TICK / (1 + engineEfficiency)
//
// engineEfficiency is a 0-based bonus (0 = baseline 1:1), so the denominator is >= 1
// and a MORE efficient hull always needs STRICTLY LESS fuel for the same mission.
// Returns a plain number (see the file header on why fuel isn't Decimal-scale); the
// result can be fractional and callers decide any rounding/clamping when they spend
// from the Decimal stockpile (Task 5).
//
// PURE: reads only its two argument objects and the FUEL_PER_TICK constant; mutates
// nothing. Takes the hull's ShipTypeDef (the immutable stat template) rather than a
// ShipInstance -- a ShipInstance carries only its typeKey and derives hull stats from
// SHIP_TYPES on demand (model.ts's shipDerivedStats pattern), so callers holding an
// instance pass SHIP_TYPES[instance.typeKey].
export function fuelNeeded(mission: MissionDef, ship: ShipTypeDef): number {
  const roundTrip = roundTripTransitTicks(mission);
  return (roundTrip * FUEL_PER_TICK) / (1 + ship.engineEfficiency);
}
