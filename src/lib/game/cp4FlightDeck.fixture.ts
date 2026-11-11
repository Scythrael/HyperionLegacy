// Complement plan CP-4's rest (user 2026-11-10 "Build it"): the Flight Deck Integrity facet on drone replenishment below
// half hull. The shared patrol fixtures its goldens (cp4FlightDeckGoldens.test.ts) and its wiring tests
// (cp4FlightDeck.test.ts) fly. TEST-ONLY (imported by *.test.ts files only).

import Decimal from "break_infinity.js";
import { freshState, SHIP_TYPES, type CrewBucket, type CrewRace, type GameState, type OfficerStats, type PatrolMissionState, type ShipTypeKey } from "./model";
import { dispatchCaptainOnPatrol, installMissingCombatBaselines } from "./tick";
import { foldedPlayerDefense } from "./combat/bridge";
import { equippedFor } from "./equipmentQueries";
import { seatOfficer } from "./wiring/probes";
import type { CombatStance } from "./combat/positioning";

export const STAT_10: OfficerStats = { strength: 10, integrity: 10, cunning: 10, constitution: 10 };
export const STAT_20: OfficerStats = { ...STAT_10, integrity: 20 };

export const flightBucket = (race: CrewRace, buff1Id: string, count: number): CrewBucket => ({
  profession: "flightDeck",
  rarity: "standard",
  rank: 1,
  race,
  buff1Id,
  buff2Id: null,
  count,
});

export interface Cp4Fixture {
  hull: ShipTypeKey;
  integrity: OfficerStats;
  race: CrewRace;
  crew: CrewBucket;
}

//   steady   : a carrier with Deck Handling crew (150 Belter crewmen), a Pilot and an XO at Integrity 20.
//   neutral  : the same carrier with the two officers at Integrity 10 (the facet is 0).
//   noDeck   : Integrity 20 officers of a race with no Deck Handling racial, and crew without the key.
//   noDrones : the steady crew and officers on a destroyer (no drone screen).
export const CP4_FIXTURES: Readonly<Record<"steady" | "neutral" | "noDeck" | "noDrones", Cp4Fixture>> = {
  steady: { hull: "carrier", integrity: STAT_20, race: "belter", crew: flightBucket("belter", "flight.droneHandling", 150) },
  neutral: { hull: "carrier", integrity: STAT_10, race: "belter", crew: flightBucket("belter", "flight.droneHandling", 150) },
  noDeck: { hull: "carrier", integrity: STAT_20, race: "earthBorn", crew: flightBucket("earthBorn", "flight.transitOut", 150) },
  noDrones: { hull: "destroyer", integrity: STAT_20, race: "belter", crew: flightBucket("belter", "flight.droneHandling", 150) },
};

// The crewed save before dispatch: ship-1 of `f.hull`, a Pilot and an XO at `f.integrity`, the one crew bucket.
export function cp4Crewed(f: Cp4Fixture): GameState {
  const base = freshState();
  let s: GameState = installMissingCombatBaselines({ ...base, credits: new Decimal(100000), ships: base.ships.map((sh) => ({ ...sh, typeKey: f.hull })) });
  s = seatOfficer(s, "pilot", [], { race: f.race, stats: f.integrity });
  s = seatOfficer(s, "executive", [], { race: f.race, stats: f.integrity });
  return { ...s, ships: s.ships.map((sh) => (sh.id === "ship-1" ? { ...sh, complement: { mode: "active", buckets: [{ ...f.crew }] } } : sh)) };
}

// The crewed save, dispatched on a Repeat Warband patrol held at ramp 0.2 of the patrol curve (a real fight the ship wins
// while its hull falls below half; a relaunch keeps a ramped cycle's stamp, so every cycle of the run flies there). The
// dispatched cycle keeps the wave plan its dispatch made (the training waves); every relaunch plans its own at ramp 0.2.
// The stance and the held ramp default to the goldens' (Balanced, 0.2); the torpedoes-on test flies another pair.
export function cp4Dispatched(f: Cp4Fixture, s0: GameState = cp4Crewed(f), stance: CombatStance = "balanced", ramp = 0.2): GameState {
  const r = dispatchCaptainOnPatrol(s0, 1, "crimsonReaverWarband", stance, true);
  if (!r.success) throw new Error(`patrol refused: ${r.reason}`);
  const m = r.next.captains[0].mission as PatrolMissionState;
  const held: PatrolMissionState = { ...m, difficulty: { version: 1, firstRun: false, ramp, tier: 1, completed: 2 } };
  return { ...r.next, captains: r.next.captains.map((c, i) => (i === 0 ? { ...c, mission: held } : c)) };
}

// 1 when, entering this tick, a drone is recovering while the hull is below half (the facet's trigger), else 0. The hull
// max is the cycle's folded pool (the one the engine compares against).
export function steadyTick(before: GameState): number {
  const m = before.captains[0].mission as PatrolMissionState | null;
  if (!m || m.kind !== "patrol" || m.phase === "limpingHome") return 0;
  const recovering = m.playerDrones.some((sq) => sq.drones.some((d) => !d.alive || d.status === "disrupted"));
  if (!recovering) return 0;
  const ship = before.ships.find((sh) => sh.id === "ship-1")!;
  const max = foldedPlayerDefense(SHIP_TYPES[ship.typeKey], equippedFor(before, ship.id), m.officerCombat, m.captainCombat).hullMax;
  return m.playerHull * 2 < max ? 1 : 0;
}
