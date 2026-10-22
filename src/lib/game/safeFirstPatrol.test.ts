// Safe first runs SF-4 (docs/plans/2026-10-15-safe-first-runs-plan.md section 4 SF-4): the safe first patrol and the
// patrol curve. The rules (runDifficulty.ts patrolDifficultyAt / nextPatrolCycleDifficulty), the profile against the
// same cycle without it (never vacuous), the backstop with a ship that cannot win a wave, offline == live on a
// training cycle and a ramped one, the forecast against the dispatch, and a fixed sample of the gated 1,000-seed
// proof (safeFirstPatrol.sweep.test.ts, `npm run test:sweep:patrol`).

import { describe, expect, it } from "vitest";
import { PATROLS, type GameState, type PatrolMissionState } from "./model";
import { dispatchCaptainOnPatrol, economyTick, tickCaptainPatrol } from "./tick";
import { replayPatrol } from "./combat/patrolReplay";
import { patrolCycleWaveTicks } from "./combat/patrolProfile";
import { planWaveSchedule, patrolWaveParams } from "./combat/waveSchedule";
import { PIRATE_HULLS } from "./combat/enemyHulls";
import {
  FIRST_PATROL_WAVES,
  N_FULL,
  isTrainingPatrol,
  nextPatrolCycleDifficulty,
  patrolDifficultyAt,
  patrolEnemyScale,
  rampEnemyScale,
  rampFraction,
  runCountsOf,
} from "./runDifficulty";
import {
  HULLS,
  RNG,
  ROUTES,
  onPatrolCurve,
  patrolBase,
  patrolForecastBand,
  patrolOf,
  patrolWon,
  proveTrainingPatrol,
  routeTicks,
} from "./safeFirstPatrol.fixture";

function asVeteran(state: GameState): GameState {
  const counts = runCountsOf(state);
  return { ...state, runCounts: { ...counts, patrol: { dispatched: 4, completed: 1, veteran: true } } };
}

// ship-1 with every weapon taken off (a weaponless "battering ram": a valid, bad choice that cannot win a wave).
function unarmed(state: GameState): GameState {
  return { ...state, equipment: state.equipment.map((e) => (e.fittedToShipId === "ship-1" && e.slotType === "weapon" ? { ...e, fittedToShipId: null } : e)) };
}

describe("SF-4 the rules: the stamp a patrol dispatch writes", () => {
  it("a fresh save's first patrol is the training cycle; after it the curve's floor; the top of the curve and a veteran store none", () => {
    expect(patrolDifficultyAt(patrolBase("destroyer", 1))).toEqual({ version: 1, firstRun: true, ramp: 0, tier: 1, completed: 0 });
    expect(patrolDifficultyAt(onPatrolCurve(patrolBase("destroyer", 1), 0))).toEqual({ version: 1, firstRun: false, ramp: 0, tier: 1, completed: 0 });
    expect(patrolDifficultyAt(onPatrolCurve(patrolBase("destroyer", 1), 5))).toEqual({ version: 1, firstRun: false, ramp: rampFraction(5), tier: 1, completed: 5 });
    expect(patrolDifficultyAt(onPatrolCurve(patrolBase("destroyer", 1), N_FULL - 1))).toBeUndefined();
    expect(patrolDifficultyAt(asVeteran(patrolBase("destroyer", 1)))).toBeUndefined();
  });

  it("a relaunch keeps the run's one curve position from the stamp alone (one step per patrol run): the training cycle hands over the floor", () => {
    // User 2026-10-21 "One step per patrol run": every route of a Repeat run flies the run's own position.
    let stamp = patrolDifficultyAt(patrolBase("destroyer", 1));
    const seen: (number | null)[] = [];
    for (let i = 0; i < N_FULL + 2; i++) {
      stamp = nextPatrolCycleDifficulty(stamp);
      seen.push(stamp ? stamp.completed : null);
      if (stamp) expect(stamp.ramp).toBe(rampFraction(stamp.completed));
    }
    expect(seen).toEqual(Array.from({ length: N_FULL + 2 }, () => 0));
    for (const c of [0, 4, N_FULL - 2]) {
      const ramped = patrolDifficultyAt(onPatrolCurve(patrolBase("destroyer", 1), c))!;
      expect(nextPatrolCycleDifficulty(ramped)).toEqual(ramped);
      expect(nextPatrolCycleDifficulty(nextPatrolCycleDifficulty(ramped))).toEqual(ramped);
    }
    expect(nextPatrolCycleDifficulty(undefined)).toBeUndefined();
    expect(nextPatrolCycleDifficulty({ version: 2 } as never)).toBeUndefined();
  });

  it("the strength: nominal on the training cycle and without a stamp, the curve's rampEnemyScale on a ramped cycle", () => {
    expect(patrolEnemyScale({})).toBe(1);
    expect(patrolEnemyScale({ difficulty: { version: 1, firstRun: true, ramp: 0, tier: 1, completed: 0 } })).toBe(1);
    expect(patrolEnemyScale({ difficulty: { version: 1, firstRun: false, ramp: 0, tier: 1, completed: 0 } })).toBe(rampEnemyScale(0));
    expect(rampEnemyScale(0)).toBe(0.35);
  });

  it("dispatch counts the patrol and stamps the record; a veteran's record carries no difficulty key", () => {
    const fresh = dispatchCaptainOnPatrol(patrolBase("destroyer", 1), 1, "crimsonReaverSweep", "balanced", false);
    expect(patrolOf(fresh.next)!.difficulty?.firstRun).toBe(true);
    expect(runCountsOf(fresh.next).patrol).toEqual({ dispatched: 1, completed: 0, veteran: false });
    const vet = dispatchCaptainOnPatrol(asVeteran(patrolBase("destroyer", 1)), 1, "crimsonReaverSweep", "balanced", false);
    expect("difficulty" in patrolOf(vet.next)!).toBe(false);
    // A second patrol dispatched while the safe one is still out is an ordinary one (one safe patrol in total, SF9).
    const second = dispatchCaptainOnPatrol({ ...fresh.next, captains: fresh.next.captains.map((c) => ({ ...c, mission: null })) }, 1, "crimsonReaverSweep", "balanced", false);
    expect(patrolOf(second.next)!.difficulty).toEqual({ version: 1, firstRun: false, ramp: 0, tier: 1, completed: 0 });
  });
});

describe("SF-4 the profile against the same cycle without it", () => {
  it("the training cycle flies the first waves of its own schedule, one enemy of the lightest hull each (a raider on both routes)", () => {
    for (const key of ROUTES) {
      const def = PATROLS[key];
      for (const seed of [1, 2, 3, 7]) {
        const full = planWaveSchedule(seed, patrolWaveParams(def));
        const training = patrolCycleWaveTicks(seed, def, { difficulty: { version: 1, firstRun: true, ramp: 0, tier: 1, completed: 0 } });
        expect(training).toEqual(full.slice(0, Math.min(FIRST_PATROL_WAVES, def.minWaves)));
        expect(patrolCycleWaveTicks(seed, def, {})).toEqual(full);
      }
      const r = dispatchCaptainOnPatrol(patrolBase("orion", 1), 1, key, "balanced", false);
      const replay = replayPatrol(r.next, r.next.captains[0]);
      expect(replay.waves.map((w) => w.enemyHullIds)).toEqual([["raider"], ["raider"]]);
      expect(replay.waves[0].enemyStart[0].hullMax).toBe(PIRATE_HULLS.raider.hullIntegrity);
    }
  });

  it("a ramped cycle fights the route's own waves with every enemy at the curve's strength; the top of the curve at nominal", () => {
    for (const key of ROUTES) {
      const at = (c: number) => {
        const r = dispatchCaptainOnPatrol(onPatrolCurve(patrolBase("battleship", 3), c), 1, key, "balanced", false);
        return replayPatrol(r.next, r.next.captains[0]);
      };
      const floor = at(0);
      const top = at(N_FULL - 1);
      expect(floor.waves.map((w) => w.enemyHullIds)).toEqual(top.waves.map((w) => w.enemyHullIds));
      for (let i = 0; i < floor.waves.length; i++) {
        floor.waves[i].enemyStart.forEach((e, j) => {
          const nominal = top.waves[i].enemyStart[j];
          expect(nominal.hullMax).toBe(PIRATE_HULLS[top.waves[i].enemyHullIds[j]].hullIntegrity);
          expect(e.hullMax).toBe(Math.round(nominal.hullMax * 0.35));
          expect(e.shieldMax).toBe(Math.round(nominal.shieldMax * 0.35));
          expect(e.weapons.map((w) => w.yieldMax)).toEqual(nominal.weapons.map((w) => Math.round(w.yieldMax * 0.35)));
        });
      }
    }
  });
});

describe("SF-4 the backstop: a training wave the ship would lose breaks off", () => {
  it("an unarmed Orion's training patrol: every wave lost in the fight, broken off, and the patrol still ends won, undamaged", () => {
    const start = unarmed(patrolBase("orion", 1));
    const r = dispatchCaptainOnPatrol(start, 1, "crimsonReaverWarband", "balanced", false);
    expect(r.success).toBe(true);
    const replay = replayPatrol(r.next, r.next.captains[0]);
    expect(replay.waves.map((w) => [w.playerWon, w.brokeOff])).toEqual([[false, true], [false, true]]);
    expect(replay.defeated).toBe(false);
    const end = economyTick(r.next, routeTicks("crimsonReaverWarband"), RNG);
    expect(patrolOf(end)).toBeNull();
    expect(end.ships[0].damaged).not.toBe(true);
    expect(end.completionLog.at(-1)?.patrolEndReason).toBe("ordersComplete");
    // No loot for a broken-off wave, and the route stays off the curve.
    expect(end.credits.toString()).toBe(r.next.credits.toString());
    expect(runCountsOf(end).patrol.completed).toBe(0);
    // Never vacuous: the same ship's NEXT patrol (the curve's floor) has no backstop and is lost.
    const next = dispatchCaptainOnPatrol(end, 1, "crimsonReaverWarband", "balanced", false);
    const nextEnd = economyTick(next.next, routeTicks("crimsonReaverWarband") * 3, RNG);
    expect(nextEnd.ships[0].damaged).toBe(true);
    expect(nextEnd.completionLog.at(-1)?.patrolEndReason).toBe("defeat");
  });

  it("the carry-state a broken-off wave leaves is the one the ship entered it with (hull never drops)", () => {
    const r = dispatchCaptainOnPatrol(unarmed(patrolBase("orion", 1)), 1, "crimsonReaverSweep", "balanced", false);
    const full = patrolOf(r.next)!.playerHull;
    let s = r.next;
    while (patrolOf(s) !== null) {
      expect(patrolOf(s)!.playerHull).toBe(full);
      s = economyTick(s, 1, RNG);
    }
  });
});

describe("SF-4 offline == live", () => {
  function drive(state: GameState, total: number, step: number): GameState {
    let s = state;
    for (let t = 0; t < total; t += step) s = economyTick(s, Math.min(step, total - t), RNG);
    return s;
  }
  const scope = (s: GameState) => ({ captains: s.captains, ships: s.ships, credits: s.credits.toString(), counts: runCountsOf(s), log: s.completionLog });

  it("a Repeat patrol from a fresh save (training cycle with broken-off waves, then ramped cycles): one call == 5 s chunks == 1 s steps", () => {
    // The unarmed Orion's span stops before its second cycle's limp home lands (a repair that starts mid-call is a
    // Shipyard matter, not the patrol's).
    const L = routeTicks("crimsonReaverSweep");
    for (const [start, total] of [[patrolBase("destroyer", 4), L * 5 + 3], [unarmed(patrolBase("orion", 1)), L + 9]] as [GameState, number][]) {
      const r = dispatchCaptainOnPatrol(start, 1, "crimsonReaverSweep", "balanced", true);
      const big = scope(economyTick(r.next, total, RNG));
      expect(scope(drive(r.next, total, 5))).toEqual(big);
      expect(scope(drive(r.next, total, 1))).toEqual(big);
    }
  });

  it("a Repeat run is ONE curve step however many routes it flies (user 2026-10-21 \"One step per patrol run\"); the training run counts none", () => {
    // The training run: its later cycles fly the floor, and none of its routes counts (SF5).
    const r = dispatchCaptainOnPatrol(patrolBase("battleship", 5), 1, "crimsonReaverSweep", "balanced", true);
    let s = r.next;
    const stamps: (number | null)[] = [patrolOf(s)!.difficulty!.firstRun ? -1 : null];
    for (let cycle = 0; cycle < 4; cycle++) {
      s = economyTick(s, routeTicks("crimsonReaverSweep"), RNG);
      const m = patrolOf(s)!;
      stamps.push(m.difficulty ? m.difficulty.completed : null);
    }
    expect(stamps).toEqual([-1, 0, 0, 0, 0]);
    expect(patrolOf(s)!.routesCompletedThisRun).toBe(4);
    expect(runCountsOf(s).patrol).toEqual({ dispatched: 1, completed: 0, veteran: false });
    expect(s.lifetimeStats.missionsCompleted.crimsonReaverSweep?.toNumber()).toBe(4);
    // A later run at curve position 2: every cycle keeps position 2, and the run counts ONCE, at its first won route.
    const later = dispatchCaptainOnPatrol(onPatrolCurve(patrolBase("battleship", 5), 2), 1, "crimsonReaverSweep", "balanced", true);
    let t = later.next;
    const positions: (number | null)[] = [patrolOf(t)!.difficulty!.completed];
    const counted: number[] = [];
    for (let cycle = 0; cycle < 4; cycle++) {
      t = economyTick(t, routeTicks("crimsonReaverSweep"), RNG);
      const m = patrolOf(t)!;
      positions.push(m.difficulty ? m.difficulty.completed : null);
      counted.push(runCountsOf(t).patrol.completed);
    }
    expect(positions).toEqual([2, 2, 2, 2, 2]);
    expect(counted).toEqual([3, 3, 3, 3]);
    expect(patrolOf(t)!.routesCompletedThisRun).toBe(4);
    // The same span in ONE call lands the same count (offline == live).
    expect(runCountsOf(economyTick(later.next, 4 * routeTicks("crimsonReaverSweep"), RNG)).patrol.completed).toBe(3);
  });

  it("an in-flight patrol from before SF-4 (no stamp) relaunches without one: the new cycle is the pre-SF-4 cycle", () => {
    const r = dispatchCaptainOnPatrol(patrolBase("destroyer", 1), 1, "crimsonReaverSweep", "balanced", true);
    const { difficulty: _drop, ...legacy } = patrolOf(r.next)! as PatrolMissionState;
    const captain = { ...r.next.captains[0], mission: { ...legacy, waveTicks: planWaveSchedule(legacy.masterSeed, patrolWaveParams(PATROLS.crimsonReaverSweep)) } };
    const ship = r.next.ships[0];
    const res = tickCaptainPatrol(routeTicks("crimsonReaverSweep"), captain, ship, 1000, 0, 1000);
    const next = res.captain.mission as PatrolMissionState;
    expect(next.phase).toBe("transitOut");
    expect("difficulty" in next).toBe(false);
    expect(isTrainingPatrol(next)).toBe(false);
    expect(res.curveRunsCompleted).toBe(1);
  });
});

describe("SF-4 the forecast reads the profile", () => {
  it("a fresh save's first patrol reads Guaranteed on every combat hull and both routes (unarmed too); the next reads its real band", () => {
    for (const hull of HULLS) {
      for (const key of ROUTES) {
        const band = patrolForecastBand(patrolBase(hull, 1), key);
        if (band === null) continue;
        expect(band, `${hull} ${key}`).toEqual({ wins: 64, tier: "guaranteed" });
      }
    }
    expect(patrolForecastBand(unarmed(patrolBase("orion", 1)), "crimsonReaverWarband")).toEqual({ wins: 64, tier: "guaranteed" });
    expect(patrolForecastBand(onPatrolCurve(patrolBase("prospectorRunner", 1), 0), "crimsonReaverWarband")!.tier).not.toBe("guaranteed");
  });
});

describe("SF-4 the proof, a fixed sample (the full 1,000 seeds: npm run test:sweep:patrol)", () => {
  it("master seeds 0 to 24 x every hull x both routes x Once and Repeat: won, no defeat, no damage, no lost wave", () => {
    let brokeOff = 0;
    for (const hull of HULLS) {
      for (let seed = 0; seed < 25; seed++) {
        for (const key of ROUTES) for (const repeat of [false, true]) brokeOff += proveTrainingPatrol(hull, key, seed, repeat).brokeOff;
      }
    }
    expect(brokeOff).toBe(0);
  });

  it("later patrols: a Runner's Warband wins fall as the curve climbs (40 seeds), and the top equals a veteran's", () => {
    const wins = (state: (seed: number) => GameState) => {
      let n = 0;
      for (let seed = 0; seed < 40; seed++) if (patrolWon(state(seed), "crimsonReaverWarband", seed)) n += 1;
      return n;
    };
    const row = [0, 3, 6, N_FULL - 1].map((c) => wins((seed) => onPatrolCurve(patrolBase("prospectorRunner", seed), c)));
    for (let i = 1; i < row.length; i++) expect(row[i]).toBeLessThanOrEqual(row[i - 1]);
    expect(row[0]).toBeGreaterThan(row[row.length - 1]);
    expect(row[row.length - 1]).toBe(wins((seed) => asVeteran(patrolBase("prospectorRunner", seed))));
  });
});
