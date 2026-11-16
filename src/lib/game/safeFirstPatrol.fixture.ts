// TEST-ONLY helpers for the Safe first runs SF-4 proof (docs/plans/2026-10-15-safe-first-runs-plan.md section 4 SF-4),
// shared by safeFirstPatrol.test.ts (the default run's fixed sample) and safeFirstPatrol.sweep.test.ts (the gated
// 1,000-seed proof and the curve table). The SF-0 method (firstRunsGoldens.fixture.ts onHull: freshState, ship-1
// retyped to the hull with its Standard-Issue gear, no officers, no complement), the patrol dispatched through the real
// dispatchCaptainOnPatrol and flown through the live economyTick loop, nothing edited after dispatch.
// Never imported by app code.

import Decimal from "break_infinity.js";
import { expect } from "vitest";
import { PATROLS, SHIP_TYPES, patrolRouteOf, patrolRouteTicks, type GameState, type PatrolKey, type PatrolMissionState, type ShipTypeKey } from "./model";
import { dispatchCaptainOnPatrol, economyTick, patrolDispatchRoute } from "./tick";
import { equippedFor } from "./equipment";
import { replayPatrol, resolvePatrolWaves } from "./combat/patrolReplay";
import { lightestPatrolHull } from "./combat/patrolProfile";
import { combatHullTypeOf, defaultSystemDurabilityForHull, foldedPlayerDefense, installedDronesForPatrol } from "./combat/bridge";
import { DEFAULT_SAMPLES } from "./combat/rating";
import { threatAssessment } from "./combat/threatAssessment";
import { onHull } from "./firstRunsGoldens.fixture";
import { FIRST_PATROL_WAVES, patrolDifficultyAt, runCountsOf } from "./runDifficulty";

export const HULLS = Object.keys(SHIP_TYPES) as ShipTypeKey[];
export const ROUTES = Object.keys(PATROLS) as PatrolKey[];
export const RNG = (): number => 0.5;

export const patrolOf = (s: GameState): PatrolMissionState | null => s.captains[0].mission as PatrolMissionState | null;

// A fresh save on `hull` whose next patrol draws master seed `seed`. Pure.
export function patrolBase(hull: ShipTypeKey, seed: number): GameState {
  return { ...onHull(hull), nextPatrolSeed: seed, credits: new Decimal(100_000) };
}

// `state` with its one safe patrol behind it and `completed` patrol runs on the curve (not a veteran). Pure.
export function onPatrolCurve(state: GameState, completed: number): GameState {
  const counts = runCountsOf(state);
  return { ...state, runCounts: { ...counts, patrol: { dispatched: 1, completed, veteran: false } } };
}

// One route's length in route ticks (no officers aboard, so no Flight Deck return cut): a dispatched cycle's own route
// (WR-7 follow-up OC-D8: its frozen legs, patrolRouteOf), or the def's for a key. Pure.
export function routeTicks(of: PatrolKey | PatrolMissionState): number {
  return patrolRouteTicks(typeof of === "string" ? PATROLS[of] : patrolRouteOf(of));
}

export interface TrainingProof {
  waves: number;
  brokeOff: number;
}

// THE PROOF of one safe first patrol: a fresh save's first dispatch on `hull` / `key` at master seed `seed`, Dispatch
// Once or Repeatedly, flown in ONE economyTick call over its route. It must be the training cycle (the stamp; the
// display replay fights FIRST_PATROL_WAVES waves, each ONE enemy of the route's lightest hull) and must be WON: never a
// defeat, never a limp home, the ship never damaged; Dispatch Once ends "ordersComplete", Dispatch Repeatedly is still
// out on its second cycle, which reads the curve's floor; the training route never counts on the curve. Returns the
// waves fought and how many broke off (the backstop) for the sweep's totals.
export function proveTrainingPatrol(hull: ShipTypeKey, key: PatrolKey, seed: number, repeat: boolean): TrainingProof {
  const label = `${hull} ${key} seed ${seed} ${repeat ? "repeat" : "once"}`;
  const r = dispatchCaptainOnPatrol(patrolBase(hull, seed), 1, key, "balanced", repeat);
  expect(r.success, `${label}: ${r.reason}`).toBe(true);
  const mission = patrolOf(r.next)!;
  expect(mission.difficulty, label).toEqual({ version: 1, firstRun: true, ramp: 0, tier: 1, completed: 0 });
  const def = PATROLS[key];
  expect(mission.waveTicks.length, label).toBe(Math.min(FIRST_PATROL_WAVES, def.minWaves));
  const replay = replayPatrol(r.next, r.next.captains[0]);
  expect(replay.defeated, label).toBe(false);
  expect(replay.waves.length, label).toBe(mission.waveTicks.length);
  for (const w of replay.waves) expect(w.enemyHullIds, label).toEqual([lightestPatrolHull(def)]);
  const brokeOff = replay.waves.filter((w) => w.brokeOff === true).length;

  const end = economyTick(r.next, routeTicks(mission), RNG);
  expect(end.ships[0].damaged, label).not.toBe(true);
  expect(end.ships[0].repairDamage ?? 0, label).toBe(0);
  const counts = runCountsOf(end).patrol;
  expect(counts, label).toEqual({ dispatched: 1, completed: 0, veteran: false });
  const after = patrolOf(end);
  // Fix round FR-E (lane 4 q3, user "Stop and explain"): a Repeat run whose next route (the curve's floor) would be lost
  // even fully repaired stops at home instead, undamaged, its log saying why (still never a defeat or a limp home).
  if (repeat && after === null) {
    expect(end.completionLog.at(-1)?.patrolEndReason, label).toBe("outmatched");
    expect(end.captains[0].lastStopReason, label).toBeUndefined();
  } else if (repeat) {
    expect(after, label).not.toBeNull();
    expect(after!.phase, label).toBe("transitOut");
    expect(after!.routesCompletedThisRun, label).toBe(1);
    expect(after!.difficulty, label).toEqual({ version: 1, firstRun: false, ramp: 0, tier: 1, completed: 0 });
  } else {
    expect(after, label).toBeNull();
    expect(end.completionLog.at(-1)?.patrolEndReason, label).toBe("ordersComplete");
    expect(end.captains[0].lastStopReason, label).toBeUndefined();
  }
  return { waves: replay.waves.length, brokeOff };
}

// The dispatch card's Threat Assessment for ship-1 on `key`: App.svelte patrolForecastFor's sweep mirrored exactly
// (FORECAST_SEED 0x5a4d + i over DEFAULT_SAMPLES, the installed gear, the folded start pools, and since SF-4 the
// difficulty a dispatch would stamp now). Wins of DEFAULT_SAMPLES and the band's tier; null without a combat hull.
export function patrolForecastBand(state: GameState, key: PatrolKey): { wins: number; tier: string } | null {
  const ship = state.ships[0];
  const hullType = combatHullTypeOf(ship.typeKey);
  if (hullType === null) return null;
  const def = PATROLS[key];
  // WR-7 follow-up OC-D8: the route a dispatch now would fly (the app's forecast reads the same).
  const route = patrolDispatchRoute(state, ship, key).route;
  const shipDef = SHIP_TYPES[ship.typeKey];
  const installedGear = equippedFor(state, ship.id);
  const startDefense = foldedPlayerDefense(shipDef, installedGear);
  const difficulty = patrolDifficultyAt(state);
  let wins = 0;
  for (let i = 0; i < DEFAULT_SAMPLES; i++) {
    const result = resolvePatrolWaves({
      playerId: ship.id, stats: shipDef, hullType, stance: "balanced", installedGear, masterSeed: 0x5a4d + i, factionId: def.factionId, def: route,
      startHull: startDefense.hullMax, startShield: startDefense.shieldMax,
      startDrones: installedDronesForPatrol(installedGear, `forecast-${key}-p`),
      startSystemDurability: defaultSystemDurabilityForHull(hullType, shipDef, installedGear),
      difficulty,
    });
    if (!result.defeated) wins += 1;
  }
  return { wins, tier: threatAssessment(wins, DEFAULT_SAMPLES).tier };
}

// Dispatch Once from `state` at master seed `seed`, flown in one call over the route plus a limp home: won = ended
// with the ship undamaged. Pure.
export function patrolWon(state: GameState, key: PatrolKey, seed: number): boolean {
  const r = dispatchCaptainOnPatrol({ ...state, nextPatrolSeed: seed }, 1, key, "balanced", false);
  expect(r.success).toBe(true);
  // WR-7 follow-up OC-D8: the dispatched cycle's own route (its frozen legs).
  const route = patrolRouteOf(patrolOf(r.next)!);
  const end = economyTick(r.next, route.transitOutTicks + route.rollWindowTicks + 3 * route.transitBackTicks + 4, RNG);
  return patrolOf(end) === null && end.ships[0].damaged !== true;
}
