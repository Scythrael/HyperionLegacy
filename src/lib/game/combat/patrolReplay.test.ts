// ============================================================================
// patrolReplay.test.ts : Combat 0.13.0, Phase 12b-1
//
// Locks the DISPLAY-ONLY patrol replay (patrolReplay.ts):
//   1. REPLAY-vs-LIVE PARITY (the gate). For a dispatched patrol, the REAL economyTick
//      resolves the cycle to completion; the replay reproduces it from the same
//      masterSeed + loadout + full-hull start. Their per-wave win/loss + terminal state
//      MUST match, fuzzed across many seeds x all three combat hulls. This proves the
//      watchable replay tells the truth about the fight the live loop actually ran.
//   2. PURITY. replayPatrol mutates none of its inputs.
//   3. DETERMINISM. Same inputs -> byte-identical replay (same logs, same outcomes).
//   4. SNAPSHOT FOLD. Folding a known event stream yields the expected per-round
//      hull/shield/effect progression, and degrades gracefully on absent fields.
//
// The replay uses generateLog:true (the cosmetic stream). The parity assertions confirm
// its OUTCOME still equals the live loop's generateLog:false outcome, i.e. the cosmetic
// work never moved the result (the offline == live invariant).
// ============================================================================

import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import {
  freshState,
  SHIP_TYPES,
  PATROLS,
  type GameState,
  type ShipTypeKey,
  type PatrolMissionState,
} from "../model";
import { dispatchCaptainOnPatrol, economyTick } from "../tick";
import {
  replayPatrol,
  resolvePatrolWaves,
  foldWaveSnapshots,
} from "./patrolReplay";
import type { CombatEvent } from "./types";

const PATROL_KEY = "crimsonReaverSweep";
// A constant rng so any incidental economyTick draw is identical across compared paths
// (a patrol-only fleet makes zero draws, but this removes Math.random from every test).
const RNG = () => 0.5;

// A fresh state whose one starting captain (id 1) flies `typeKey`, with the patrol master
// seed counter pinned so the NEXT dispatch uses `seed`. Tank + credits topped up so fuel
// never gates the run.
function patrolState(typeKey: ShipTypeKey, seed: number): GameState {
  const base = freshState();
  return {
    ...base,
    nextPatrolSeed: seed,
    fuel: new Decimal(100000),
    credits: new Decimal(100000),
    ships: base.ships.map((s) => (s.id === "ship-1" ? { ...s, typeKey } : s)),
  };
}

function dispatch(state: GameState, repeat: boolean): GameState {
  const r = dispatchCaptainOnPatrol(state, 1, PATROL_KEY, "balanced", repeat);
  expect(r.success).toBe(true);
  return r.next;
}

// Drive the LIVE loop to completion, capturing the observable terminal state: the peak
// waves won/lost (the mission's own tallies, read on every tick while the mission is
// still alive, so the final values survive the tick that nulls the mission) and whether
// the ship ended DAMAGED (the limp-home defeat outcome). 60 ticks covers the 14-tick
// route + a 6-tick limp with margin.
//
// ALSO captures the PER-WON-WAVE carry-state (hull/shield) the instant each wave is won,
// so the parity gate can assert the replay's displayed arena bars line up with the real
// fight's surviving pools, not merely the win COUNT. The capture is taken on the tick
// wavesWon rises (post-battle, BEFORE the next inter-wave shield regen), which is exactly
// the moment the replay records as a won wave's playerEnd. A single 1-tick advance crosses
// at most one whole route tick, so wavesWon rises by at most 1 per tick, one push each.
function runLivePatrol(state0: GameState): {
  wavesWon: number;
  wavesLost: number;
  shipDamaged: boolean;
  wonCarry: { hull: number; shield: number }[];
} {
  let s = state0;
  let wavesWon = 0;
  let wavesLost = 0;
  let prevWavesWon = 0;
  const wonCarry: { hull: number; shield: number }[] = [];
  for (let i = 0; i < 60; i++) {
    s = economyTick(s, 1, RNG);
    const m = s.captains[0].mission as PatrolMissionState | null;
    if (m && m.kind === "patrol") {
      wavesWon = m.wavesWon;
      wavesLost = m.wavesLost;
      if (m.wavesWon > prevWavesWon) {
        // A wave just resolved as a WIN this tick: snapshot the post-battle carry pools
        // the live loop persisted (playerHull/playerShield), before any later-tick regen.
        wonCarry.push({ hull: m.playerHull, shield: m.playerShield });
        prevWavesWon = m.wavesWon;
      }
    }
  }
  return { wavesWon, wavesLost, shipDamaged: s.ships[0].damaged === true, wonCarry };
}

// ---------------------------------------------------------------------------
// 1. REPLAY-vs-LIVE PARITY (THE GATE).
// ---------------------------------------------------------------------------
describe("replay-vs-live parity (THE GATE)", () => {
  const SEEDS = [1, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37];
  const HULLS: ShipTypeKey[] = ["destroyer", "battleship", "carrier"];

  for (const hull of HULLS) {
    for (const seed of SEEDS) {
      it(`replay matches the live loop for ${hull} @ masterSeed=${seed}`, () => {
        const dispatched = dispatch(patrolState(hull, seed), false);

        // Replay from the freshly-dispatched (full-hull) mission.
        const replay = replayPatrol(dispatched, dispatched.captains[0]);
        expect(replay.available).toBe(true);

        // Resolve the SAME patrol live and capture the terminal observable state.
        const live = runLivePatrol(dispatched);

        // Per-wave win count matches, and the replay's own tally agrees with its waves.
        const replayWonWaves = replay.waves.filter((w) => w.playerWon);
        expect(replayWonWaves.length).toBe(replay.wavesWon);
        expect(replay.wavesWon).toBe(live.wavesWon);

        // CARRY-STATE PARITY (the arena-bars gate): the replay's surviving hull/shield
        // after EACH won wave MUST equal the live loop's persisted post-battle carry for
        // that same wave. This proves the watched health bars cannot silently drift from
        // the real fight, one wave at a time, not merely that the win COUNT agrees.
        expect(live.wonCarry.length).toBe(replayWonWaves.length);
        for (let i = 0; i < replayWonWaves.length; i++) {
          expect(replayWonWaves[i].playerEnd?.hull).toBe(live.wonCarry[i].hull);
          expect(replayWonWaves[i].playerEnd?.shield).toBe(live.wonCarry[i].shield);
        }

        // Terminal hull agrees: hull never regenerates post-wave, so the replay's terminal
        // finalPlayerHull is the fight's real end hull. On a clean full-clear that is the
        // last won wave's carry hull (on a defeat it is the surviving hull at the loss,
        // asserted in the public-defeat case below).
        if (!replay.defeated && replayWonWaves.length > 0) {
          expect(replay.finalPlayerHull).toBe(
            live.wonCarry[replayWonWaves.length - 1].hull,
          );
        }

        // Defeat detection matches the live loop (limp-home => ship.damaged), and
        // wavesLost agrees.
        expect(replay.defeated).toBe(live.shipDamaged);
        expect(replay.defeated).toBe(live.wavesLost > 0);

        // On a defeat the losing wave is the last replayed wave; on a clean clear the
        // replay covers exactly the waves won.
        expect(replay.waves.length).toBe(
          replay.defeated ? replay.wavesWon + 1 : replay.wavesWon,
        );
      });
    }
  }
});

// ---------------------------------------------------------------------------
// 2. PURITY. replayPatrol reads, never writes.
// ---------------------------------------------------------------------------
describe("purity", () => {
  it("does not mutate the captain's mission, the ship, or the state", () => {
    const dispatched = dispatch(patrolState("carrier", 29), true);
    const cap = dispatched.captains[0];
    const missionBefore = structuredClone(cap.mission);
    const shipBefore = structuredClone(dispatched.ships[0]);
    const captainsRef = dispatched.captains;
    const shipsRef = dispatched.ships;

    const replay = replayPatrol(dispatched, cap);
    expect(replay.available).toBe(true);

    // Inputs are byte-identical after the replay (deep value equality)...
    expect(cap.mission).toEqual(missionBefore);
    expect(dispatched.ships[0]).toEqual(shipBefore);
    // ...and no top-level array was swapped out (the replay allocated nothing on state).
    expect(dispatched.captains).toBe(captainsRef);
    expect(dispatched.ships).toBe(shipsRef);
  });
});

// ---------------------------------------------------------------------------
// 3. DETERMINISM. Same inputs -> identical replay.
// ---------------------------------------------------------------------------
describe("determinism", () => {
  it("produces byte-identical replays (logs + outcomes) across two runs", () => {
    const dispatched = dispatch(patrolState("destroyer", 29), false);
    const a = replayPatrol(dispatched, dispatched.captains[0]);
    const b = replayPatrol(dispatched, dispatched.captains[0]);
    // Full deep equality: same wave count, same enemy composition, same flavored logs,
    // same outcomes, same start/end combatants.
    expect(a).toEqual(b);
  });

  it("resolvePatrolWaves is a pure function of its inputs", () => {
    const shipDef = SHIP_TYPES["destroyer"];
    const input = {
      playerId: "ship-1",
      stats: shipDef,
      hullType: "destroyer" as const,
      stance: "balanced" as const,
      masterSeed: 29,
      factionId: "crimsonReavers",
      def: PATROLS[PATROL_KEY],
      startHull: shipDef.hullIntegrity,
      startShield: shipDef.shieldCapacity,
      startDrones: [],
    };
    expect(resolvePatrolWaves(input)).toEqual(resolvePatrolWaves(input));
  });
});

// ---------------------------------------------------------------------------
// 1b. DEFEAT-PATH PARITY. A near-dead starting carry-state loses wave 0 in BOTH the live
// loop (hull-override, the same technique patrol-tick.test.ts uses) and the replay's
// low-level resolver, proving the defeat branch + the between-wave recovery-before-the-
// first-wave both stay parity-exact.
// ---------------------------------------------------------------------------
describe("defeat-path parity (guaranteed loss)", () => {
  it("resolvePatrolWaves loses wave 0 exactly as a live hull-override defeat does", () => {
    const dispatched = dispatch(patrolState("destroyer", 29), false);
    const cap = dispatched.captains[0];
    const m = cap.mission as PatrolMissionState;

    // Inject a near-dead carry-state -> a GUARANTEED loss at wave 0 (robust against any
    // future balance pass), mirroring patrol-tick.test.ts's defeat setup.
    const wounded: GameState = {
      ...dispatched,
      captains: [{ ...cap, mission: { ...m, playerHull: 5, playerShield: 0 } }],
    };
    const live = runLivePatrol(wounded);
    expect(live.wavesWon).toBe(0);
    expect(live.wavesLost).toBe(1);
    expect(live.shipDamaged).toBe(true);

    // Replay the SAME first wave from the SAME near-dead start via the low-level resolver
    // (the public replayPatrol always starts full-hull by contract, so the defeat path is
    // exercised through the explicit-carry-state resolver, as the design intends).
    const shipDef = SHIP_TYPES["destroyer"];
    const res = resolvePatrolWaves({
      playerId: "ship-1",
      stats: shipDef,
      hullType: "destroyer",
      stance: m.stance,
      masterSeed: m.masterSeed,
      factionId: m.factionId,
      def: PATROLS[PATROL_KEY],
      startHull: 5,
      startShield: 0,
      startDrones: [],
    });
    expect(res.wavesWon).toBe(0);
    expect(res.defeated).toBe(true);
    expect(res.waves.length).toBe(1); // stops at the lost wave, no later waves replayed
    expect(res.waves[0].playerWon).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 1c. DEFEAT-PATH PARITY THROUGH THE PUBLIC ENTRY (replayPatrol).
//
// 1b above drives the defeat through the LOW-LEVEL resolver with an injected near-dead
// start. This case exercises the DEFEAT branch through the PUBLIC replayPatrol, which by
// contract always starts FULL HULL, and compares it side-by-side to a real live limp-home
// for the same patrol + seed. No production change is needed: a full-hull DESTROYER
// genuinely LOSES the shipped starter patrol (crimsonReaverSweep) at masterSeed 331
// (empirically found by scanning seeds 1..2000; battleship/carrier win every sampled seed,
// and destroyer wins the 12 seeds the main parity fuzz above happens to sample, which is
// why that fuzz never reaches a full-hull defeat). This locks that the public replay's
// early-stop (waves fought, defeated flag, wavesWon) mirrors the live loop's limp-home.
// ---------------------------------------------------------------------------
describe("defeat-path parity through the PUBLIC entry (replayPatrol)", () => {
  // masterSeed where a full-hull destroyer loses crimsonReaverSweep (see block note).
  const DEFEAT_SEED = 331;

  it("replayPatrol early-stops on a real full-hull defeat exactly as the live limp-home does", () => {
    const dispatched = dispatch(patrolState("destroyer", DEFEAT_SEED), false);

    // Public path, full-hull start by contract: this seed is chosen precisely because it
    // LOSES, so the defeat branch of replayPatrol is exercised end to end.
    const replay = replayPatrol(dispatched, dispatched.captains[0]);
    expect(replay.available).toBe(true);
    expect(replay.defeated).toBe(true);

    // Resolve the SAME patrol live and confirm the limp-home defeat outcome.
    const live = runLivePatrol(dispatched);
    expect(live.shipDamaged).toBe(true);
    expect(live.wavesLost).toBe(1);

    // PUBLIC-PATH DEFEAT PARITY: same waves won, and the replay stopped AT the lost wave
    // (waves fought == wavesWon + 1, last wave a loss), mirroring the live loop switching
    // to limp-home on that wave and fighting no further waves.
    expect(replay.wavesWon).toBe(live.wavesWon);
    expect(replay.waves.length).toBe(replay.wavesWon + 1);
    expect(replay.waves[replay.waves.length - 1].playerWon).toBe(false);

    // Per-won-wave carry parity holds on the public defeat path too (the bars up to the
    // loss match the real fight).
    const replayWonWaves = replay.waves.filter((w) => w.playerWon);
    expect(live.wonCarry.length).toBe(replayWonWaves.length);
    for (let i = 0; i < replayWonWaves.length; i++) {
      expect(replayWonWaves[i].playerEnd?.hull).toBe(live.wonCarry[i].hull);
      expect(replayWonWaves[i].playerEnd?.shield).toBe(live.wonCarry[i].shield);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. SNAPSHOT FOLD.
// ---------------------------------------------------------------------------
describe("foldWaveSnapshots (per-round arena state)", () => {
  it("folds a known event stream into the expected per-round progression", () => {
    const log: CombatEvent[] = [
      // Round 0: player hits E1; then lands a DoT on E1 at rank 1.
      { tDeciSec: 5, round: 0, type: "hit", actorId: "P", targetId: "E1", damage: 10, shieldAfter: 20, hullAfter: 100 },
      { tDeciSec: 8, round: 0, type: "effectApplied", actorId: "P", targetId: "E1", effectDefId: "plasmaFire", effectRank: 1 },
      // Round 1: E1 hits the player; the DoT ticks on E1 and escalates to rank 2.
      { tDeciSec: 12, round: 1, type: "hit", actorId: "E1", targetId: "P", damage: 5, shieldAfter: 0, hullAfter: 590 },
      { tDeciSec: 20, round: 1, type: "dot", targetId: "E1", effectDefId: "plasmaFire", effectRank: 2, damage: 4, hullAfter: 96 },
      // Round 2: a support drone cleanses the DoT off E1 (removal event).
      { tDeciSec: 25, round: 2, type: "droneCleanse", actorId: "E1", targetId: "E1", effectDefId: "plasmaFire" },
    ];
    const snaps = foldWaveSnapshots(log);
    expect(snaps.map((s) => s.round)).toEqual([0, 1, 2]);

    // Round 0: E1 pools + rank-1 DoT; the player has no event yet, so no P row.
    expect(snaps[0].combatants["E1"].hull).toBe(100);
    expect(snaps[0].combatants["E1"].shield).toBe(20);
    expect(snaps[0].combatants["E1"].effects).toEqual([{ defId: "plasmaFire", rank: 1 }]);
    expect(snaps[0].combatants["P"]).toBeUndefined();

    // Round 1: the player now has pools; E1's hull dropped via the DoT + escalated to II.
    expect(snaps[1].combatants["P"].hull).toBe(590);
    expect(snaps[1].combatants["P"].shield).toBe(0);
    expect(snaps[1].combatants["E1"].hull).toBe(96);
    expect(snaps[1].combatants["E1"].effects).toEqual([{ defId: "plasmaFire", rank: 2 }]);

    // Round 2: the cleanse stripped the effect; hull carries forward unchanged.
    expect(snaps[2].combatants["E1"].effects).toEqual([]);
    expect(snaps[2].combatants["E1"].hull).toBe(96);
  });

  it("seeds round-0 baseline from the starting combatants when provided", () => {
    // A log with a SINGLE event so only E1 is referenced; the baseline supplies P's pools.
    const log: CombatEvent[] = [
      { tDeciSec: 5, round: 0, type: "hit", actorId: "P", targetId: "E1", shieldAfter: 10, hullAfter: 90 },
    ];
    // Minimal combatant-shaped baselines (only the fields the fold reads).
    const initial = [
      { id: "P", hull: 600, shield: 300, statusEffects: [] },
      { id: "E1", hull: 120, shield: 40, statusEffects: [{ defId: "seed", rank: 1 }] },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any;
    const snaps = foldWaveSnapshots(log, initial);
    // P keeps its baseline (never targeted); E1's pools are overwritten by the event.
    expect(snaps[0].combatants["P"].hull).toBe(600);
    expect(snaps[0].combatants["P"].shield).toBe(300);
    expect(snaps[0].combatants["E1"].hull).toBe(90);
    expect(snaps[0].combatants["E1"].shield).toBe(10);
    // The baseline effect on E1 is preserved (no event removed it).
    expect(snaps[0].combatants["E1"].effects).toEqual([{ defId: "seed", rank: 1 }]);
  });

  it("degrades gracefully: empty log yields one empty round-0 snapshot", () => {
    const snaps = foldWaveSnapshots([]);
    expect(snaps.length).toBe(1);
    expect(snaps[0].round).toBe(0);
    expect(snaps[0].combatants).toEqual({});
  });

  it("degrades gracefully: events missing optional fields never throw", () => {
    const log: CombatEvent[] = [
      // An evade-like event with no hull/shield/effect payload.
      { tDeciSec: 3, round: 0, type: "evade", actorId: "P", targetId: "E1", result: "evade" },
      // A droneIntercept with only a projectilesHit count (no after-values).
      { tDeciSec: 4, round: 0, type: "droneIntercept", actorId: "E1", targetId: "P", projectilesHit: 2 },
    ];
    const snaps = foldWaveSnapshots(log);
    expect(snaps.length).toBe(1);
    // Neither combatant gained a pool value (nothing carried one), so no rows appear.
    expect(snaps[0].combatants).toEqual({});
  });

  it("folds a REAL replayed wave with its start baseline (integration)", () => {
    const dispatched = dispatch(patrolState("destroyer", 29), false);
    const replay = replayPatrol(dispatched, dispatched.captains[0]);
    const wave0 = replay.waves[0];
    const snaps = foldWaveSnapshots(wave0.log, [wave0.playerStart, ...wave0.enemyStart]);

    // The final snapshot exists and covers the last round of the wave's log.
    const last = snaps[snaps.length - 1];
    expect(last.round).toBe(wave0.log[wave0.log.length - 1].round);

    // The player won wave 0, so its final folded hull is present, positive, and equals the
    // wave's recorded end hull (the last player-targeting event's hullAfter).
    expect(wave0.playerWon).toBe(true);
    const playerSnap = last.combatants[wave0.playerStart.id];
    expect(playerSnap.hull).toBe(wave0.playerEnd!.hull);
    expect(playerSnap.hull!).toBeGreaterThan(0);

    // Every destroyed enemy folds to hull <= 0 in the final snapshot.
    for (const enemy of wave0.enemyEnd) {
      if (!enemy.alive) {
        expect(last.combatants[enemy.id].hull).not.toBeNull();
        expect(last.combatants[enemy.id].hull!).toBeLessThanOrEqual(0);
      }
    }
  });
});
