// E-MOD EM-4 (0.14.0, plan docs/plans/2026-10-17-material-lines-and-emod-plan.md section 4 EM-4; the B10 fix): the
// REACTOR SURPLUS DRIVE LIFT. User answers 2026-10-17: Reactor Core value "Power headroom + surplus bonus
// (Recommended)", then P3 "Speeds the drive (Recommended)" (the B.4 grid: power not spent on the ship's systems goes to
// the drive). D23 (2026-10-08): a diminishing curve, never a cap.
//
// A crafted Reactor Core's unused output (shipPower.ts reactorSurplus: min(the reactor's own output, max(0, output -
// net draw)); the hull's own base power is never surplus) multiplies the ship's transit speed by
//
//   1 + perPoint x diminishing(surplus, knee)
//
// so a ship whose systems leave the reactor idle flies faster, and every powered system installed (a module, a Class
// II+ drive) spends lift before it spends budget. Speed counts everywhere it is read (OC-D8): the mission legs, the
// short-range legs, the expedition voyage and, through the combat rules stamp, the ship's combat speed (WR-8). Patrol
// legs are still fixed route ticks (WR-7). Fuel and reach are untouched: the core's mass still drags fuel efficiency.
//
// IN-FLIGHT RUNS ARE BYTE-IDENTICAL: a captain mission and a short-range run read the lift only when the run carries
// the REACTOR_LIFT_VERSION flag (stamped at dispatch on a ship with a powered Reactor Core, carried to every later
// cycle of the run), so a run in flight at
// the update flies exactly as it did. A patrol cycle reads it through its combat rules stamp, frozen when the cycle
// starts (a cycle in flight keeps its stamp; the WR-8 / EM-3 rule), and an expedition through its dispatch snapshot
// (the voyage and the ship-event stamp). Pure; no random draw, so no salt and offline == live by construction.

import type { EquipmentInstance } from "./model";
import { diminishing } from "./diminishing";

// [PROPOSAL] (the plan's "knee so a Standard-quality tier 1 core nets positive on every hull after its mass"; the
// numbers are the user's to change): about 2.2% speed per surplus point at the small end, on a knee of 10 points. The
// B10 reference (a Standard-quality tier 1 core at the tier's top item level 20, its worst roll: 23 output, the full
// mass 12, which alone costs 1 / (1 + 0.24) of the speed) gains +30% and nets about +5% on every hull; a worst roll
// breaks even from about 17 output (item level 15); the strongest core 0.14.0 can mint (item level 40, quality 5,
// Radiant, about 150 output) lifts about +100%.
export const REACTOR_SURPLUS_LIFT = { perPoint: 0.022, knee: 10 } as const;

// The flag version a run is stamped with (CaptainMissionState.reactorLift, ShortRangeMissionState.reactorLift).
export const REACTOR_LIFT_VERSION = 1 as const;

// TEST-ONLY off switch (emodEm4Switch.fixture.ts withReactorLiftOff): while false, no sheet carries the lift and no new
// run is stamped with the flag, so anything computed inside the switch is the pre-EM-4 game exactly. Always true in
// the app.
export const REACTOR_LIFT_SWITCH: { live: boolean } = { live: true };

// The transit speed multiplier a reactor surplus of `surplus` power points gives. Exactly 1 at 0 (or below, or while
// the test switch is off), strictly rising and concave, never capped. Pure.
export function reactorSurplusSpeedLift(surplus: number): number {
  if (!REACTOR_LIFT_SWITCH.live || !(surplus > 0)) return 1;
  return 1 + REACTOR_SURPLUS_LIFT.perPoint * diminishing(surplus, REACTOR_SURPLUS_LIFT.knee);
}

// The flag a run dispatched now on a ship with `pieces` installed carries. Written only when an installed Reactor Core
// supplies power (a crafted core): the gear is locked while the ship is out (equipment.ts onMissionLock), so a run
// without one can never have a surplus and the flag would change nothing; leaving it off keeps every such run's
// record exactly as before EM-4. Undefined while the test switch is off. Pure.
export function newReactorLiftFlag(pieces: readonly EquipmentInstance[]): { version: typeof REACTOR_LIFT_VERSION } | undefined {
  if (!REACTOR_LIFT_SWITCH.live) return undefined;
  const powered = pieces.some((p) => p.slotType === "reactorCore" && (p.implicitStats.powerOutput ?? 0) + (p.rolledStats.powerOutput ?? 0) > 0);
  return powered ? { version: REACTOR_LIFT_VERSION } : undefined;
}
