// ============================================================================
// Fuel model, pure fuel math for the mission fuel economy.
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
// costs, transit-OUT plus transit-BACK, and NOTHING else. The mission phase model
// (model.ts's MissionPhase / requiredTicksForPhase) has five phases:
//   ordersReceived -> transitOut -> extracting -> transitBack -> unloading
// Only the two TRANSIT phases represent distance covered under engine power, so only
// those burn fuel: ordersReceived (dispatch paperwork), extracting (station-keeping at
// the site), and unloading (docked at home) are explicitly NOT counted. The two
// transit legs are separate MissionDef fields (transitOutTicks / transitBackTicks) and
// can differ, so the round trip is their SUM, not simply 2x one leg.
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
// engineEfficiency is a 0-based bonus (0 = baseline 1:1). For a BARE hull it is >= 0,
// so the denominator is >= 1 and a more efficient hull needs less fuel. That invariant
// is NO LONGER universal as of Equipment 0.11.0 (Task 13): the equipment stat fold can
// drive engineEfficiency BELOW 0 via the mass penalty (a heavy loadout), so 1 + eff can
// be < 1 and a heavily fitted ship can need MORE fuel than the bare hull. fuelNeeded has
// NO internal guard against this; it relies on the fold clamping engineEfficiency UPSTREAM
// at ENGINE_EFF_FLOOR (= -0.9, model.ts's shipDerivedStats), which keeps the denominator
// 1 + eff >= 0.1 (fuel at most 10x baseline, never zero/negative). Callers that overlay a
// folded engineEfficiency onto a ShipTypeDef (economyTick / canDispatch, tick.ts) pass the
// already-clamped value, so this function stays safe without duplicating the clamp.
// Returns a plain number (see the file header on why fuel isn't Decimal-scale); the
// result can be fractional and callers decide any rounding/clamping when they spend
// from the Decimal stockpile (Task 5).
//
// PURE: reads only its two argument objects and the FUEL_PER_TICK constant; mutates
// nothing. Takes the hull's ShipTypeDef (the immutable stat template) rather than a
// ShipInstance, a ShipInstance carries only its typeKey and derives hull stats from
// SHIP_TYPES on demand (model.ts's shipDerivedStats pattern), so callers holding an
// instance pass SHIP_TYPES[instance.typeKey].
export function fuelNeeded(mission: MissionDef, ship: ShipTypeDef): number {
  const roundTrip = roundTripTransitTicks(mission);
  return (roundTrip * FUEL_PER_TICK) / (1 + ship.engineEfficiency);
}

// fuelForRoundTrip: the fuel a given hull burns to fly a round trip described DIRECTLY by
// its two transit legs, rather than by a full MissionDef. Combat 0.13.0 (Phase 9b.5a): a
// Patrol has transit legs (transitOutTicks / transitBackTicks on PatrolDef) but is NOT a
// MissionDef, so it cannot call fuelNeeded (whose first param is a full MissionDef). This
// helper takes just the two leg lengths + the hull, applying the IDENTICAL cost model
// fuelNeeded uses (only transit burns fuel; efficiency divides the burn). Kept as its own
// tiny function rather than widening fuelNeeded's contract so the working extraction path
// is untouched (Omega 15). ⚠️ Omega 4 (DRY): fuelNeeded's body is the same formula with
// its legs summed via roundTripTransitTicks; a future consolidation could have fuelNeeded
// delegate here, flagged not done to avoid editing the shipped extraction path this unit.
// PURE: reads only its args + FUEL_PER_TICK. The engineEfficiency-below-0 caveat on
// fuelNeeded (a heavy fitment can push 1+eff < 1) applies identically; callers pass the
// already-clamped folded value, so no internal guard is duplicated here either.
export function fuelForRoundTrip(
  transitOutTicks: number,
  transitBackTicks: number,
  ship: ShipTypeDef
): number {
  return ((transitOutTicks + transitBackTicks) * FUEL_PER_TICK) / (1 + ship.engineEfficiency);
}

// ============================================================================
// 0.13.6 FUEL-TO-REACH (build plan: docs/plans/2026-09-16-fuel-to-reach-0.13.6-plan.md).
//
// Fuel stops being a depleting resource and becomes a RANGE stat measured in LIGHTYEARS. There is no
// stockpile, no refining, no mining, and refuel is instant and free. The ONLY fuel constraint is
// REACH: a ship's range must cover a mission's round-trip distance, or it cannot be dispatched
// (send a combat hull too far and it would run dry halfway).
//
// PARITY / NO-ELEVATION GUARANTEE: canReach is defined so it is algebraically identical to the old
// gate `fuelCapacity >= fuelNeeded`, just relabelled into lightyears. DISTANCE is mission-intrinsic
// (round-trip transit x LY_PER_TICK); RANGE folds the ship's engine efficiency
// (fuelCapacity x (1+eff) x LY_PER_TICK). Since
//   range >= distance  <=>  fuelCapacity*(1+eff) >= roundTripTransitTicks  <=>  fuelCapacity >= fuelNeeded
// (FUEL_PER_TICK is 1), NO ship/mission pairing changes eligibility: this is a display relabel plus
// the removal of the per-trip COST, not a rebalance. fuel-to-reach.test.ts pins that equivalence
// across every SHIP_TYPES x MISSIONS pair so a future edit cannot silently drift the gate.
//
// LY_PER_TICK is a FIRST-PASS TUNABLE constant (0.16.0 balance): it only scales the displayed
// lightyear numbers (it cancels out of the gate), chosen so local runs read as a few ly and
// cross-system runs as tens. The extreme long-distance missions that "test the limits" arrive with
// 0.14.0 exploration content.
// ============================================================================
export const LY_PER_TICK = 0.5;

// The round-trip distance of a mission, in lightyears. A pure property of the MISSION (its transit
// legs), independent of which hull flies it.
export function distanceLightYears(mission: MissionDef): number {
  return roundTripTransitTicks(mission) * LY_PER_TICK;
}

// How far a hull can travel on a full tank, in lightyears. A pure property of the SHIP: its fuel
// capacity scaled by engine efficiency (a more efficient engine reaches further on the same tank).
// Takes the same ShipTypeDef shape as fuelNeeded; callers overlaying a folded engineEfficiency pass
// the already-clamped value (see fuelNeeded's note on the ENGINE_EFF_FLOOR clamp).
export function rangeLightYears(ship: ShipTypeDef): number {
  return ship.fuelCapacity * (1 + ship.engineEfficiency) * LY_PER_TICK;
}

// The reach gate: can this hull complete this mission's round trip? Equivalent to the pre-0.13.6
// `fuelCapacity >= fuelNeeded` capacity check (see the header), so it never changes which missions a
// hull is eligible for; it only drops the depleting per-trip cost that used to sit alongside it.
export function canReach(mission: MissionDef, ship: ShipTypeDef): boolean {
  return rangeLightYears(ship) >= distanceLightYears(mission);
}
