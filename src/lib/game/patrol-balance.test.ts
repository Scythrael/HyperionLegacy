// ============================================================================
// patrol-balance.test.ts : Combat 0.13.0, Phase 9b BALANCE gate
//
// PURPOSE: guard the ONE promise the starter patrol must keep for a new player,
// that each of the three tactician warships (Destroyer, Battleship, Carrier),
// flying its DEFAULT loadout, can RELIABLY WIN the entry patrol
// (crimsonReaverSweep). The starter is the first combat a player ever sees; if a
// hull literally cannot clear it, that hull is dead on arrival. This test makes
// "reliably winnable by all three" a machine-checked invariant so a future tune
// to PATROLS / PIRATE_HULLS / COMBAT_DEFAULT_LOADOUT cannot silently rebuild the
// wall.
//
// HOW IT MEASURES THE TRUTH (not a guess): it drives the REAL production patrol
// loop, economyTick, exactly as the game does. For each hull, across a spread of
// master seeds, it dispatches a Dispatch-Once patrol and advances the full route.
// A Dispatch-Once patrol ends with mission === null either way; the WIN vs LOSS
// discriminator is the ship's `damaged` flag, which the loop raises ONLY on a
// defeat (tick.ts: a lost wave sets shipDamaged = true). So:
//     won  = mission ended AND ship NOT damaged
//     lost = mission ended AND ship damaged
// Because this rides the real seeds + salts (deriveWaveSeed) and the real
// wave/enemy/battle generators, the win rate it reports is the win rate a player
// actually experiences, not a reconstruction that could drift from the loop.
//
// BETWEEN-WAVE STATE: handled by the real loop, NOT simplified here. Hull attrition
// carries, shields regen at shieldRecharge per transit tick, drones replenish. That
// is the honest measurement; nothing is reset to full mid-route.
// ============================================================================

import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import {
  freshState,
  PATROLS,
  type GameState,
  type ShipTypeKey,
  type PatrolMissionState,
} from "./model";
import { dispatchCaptainOnPatrol, economyTick, installMissingCombatBaselines } from "./tick";

const PATROL_KEY = "crimsonReaverSweep";
const DEF = PATROLS[PATROL_KEY];
// Full route length in whole ticks. Advancing this many ticks guarantees the
// Dispatch-Once patrol resolves (completes or is defeated) so mission === null.
const ROUTE_LEN = DEF.transitOutTicks + DEF.rollWindowTicks + DEF.transitBackTicks;
// A constant rng so any incidental economyTick draw is identical + reproducible (a
// patrol-only fleet makes zero economy draws, but this removes Math.random entirely).
const RNG = () => 0.5;

// The seed sample. 0..199 is a large, representative spread of starter patrols
// (each master seed => a distinct wave schedule + enemy composition + battle rolls).
const SEED_COUNT = 200;

// The three tactician combat hulls, each measured with its DEFAULT loadout
// (COMBAT_DEFAULT_LOADOUT in bridge.ts, applied by shipToCombatant inside the loop).
const COMBAT_HULLS: ShipTypeKey[] = ["destroyer", "battleship", "carrier"];

// A fresh state whose one starting captain (id 1) flies `typeKey` and whose patrol
// master-seed counter starts at `seed`, so the NEXT dispatch pins that master seed.
// Fuel/credits topped up so a shortfall never confounds the combat measurement.
// (Same shape as patrol-tick.test.ts's helper.)
function patrolState(typeKey: ShipTypeKey, seed: number): GameState {
  const base = freshState();
  // Combat 1.0 (Unit 1.3): seed the combat baseline the retype skipped so a fabricated combat hull
  // clears the new empty-required-slot dispatch blocker (economy hull -> no-op).
  return installMissingCombatBaselines({
    ...base,
    nextPatrolSeed: seed,
    fuel: new Decimal(100000),
    credits: new Decimal(100000),
    ships: base.ships.map((s) => (s.id === "ship-1" ? { ...s, typeKey } : s)),
  });
}

// Run ONE starter patrol (Dispatch Once) for a hull + master seed through the REAL
// loop and report whether it was WON. mission === null after the full route means it
// resolved; the ship's `damaged` flag (raised only on a defeat) is the win/loss bit.
function patrolWon(typeKey: ShipTypeKey, seed: number): boolean {
  const dispatched = dispatchCaptainOnPatrol(
    patrolState(typeKey, seed),
    1,
    PATROL_KEY,
    "balanced",
    false, // Dispatch Once: no relaunch, so mission === null means the single cycle ended.
  );
  expect(dispatched.success).toBe(true);
  // One big call is safe: the loop's closed-form parity (proven in patrol-tick.test.ts)
  // makes economyTick(state, N) identical to N single ticks. +2 slack over ROUTE_LEN.
  const final = economyTick(dispatched.next, ROUTE_LEN + 2, RNG);
  const mission = final.captains[0].mission as PatrolMissionState | null;
  const ship = final.ships.find((s) => s.id === "ship-1");
  // WON iff the cycle resolved (mission null) AND the ship was not flagged damaged.
  return mission === null && ship !== undefined && ship.damaged !== true;
}

// The measured win rate for a hull across the whole seed sample [0, SEED_COUNT).
function winRate(typeKey: ShipTypeKey): { wins: number; rate: number } {
  let wins = 0;
  for (let seed = 0; seed < SEED_COUNT; seed++) {
    if (patrolWon(typeKey, seed)) wins++;
  }
  return { wins, rate: wins / SEED_COUNT };
}

// THE LOCKING THRESHOLD. Each hull must clear the starter on at least this fraction of
// sampled seeds. As measured after Phase 12b Unit B1 wired LIVE SYSTEM DURABILITY, the
// win rates are: destroyer 99.0% (198/200), battleship 100% (200/200), carrier 100%
// (200/200). Wiring durability wear (Phase 12b) and then Combat 1.0 Unit 1.5 status-effect
// completion (the enemy carrier's plasma now inflicts Harmonic Gap on the player) each added
// combat-stream draws that shifted the per-seed schedule, nudging the destroyer off its old
// 200/200 by a couple of unlucky seeds; NO
// constant re-tune was required (durability is intentionally low-impact within one short
// starter battle, base 100 ceiling; cross-wave attrition is Unit B2). We assert >= 0.95
// rather than a brittle == 1.0 so a trivial future sim tweak that flips a single unlucky
// seed does not fail CI, while any REAL regression (a starter that drops back toward the
// old 37.5% destroyer wall) is caught loudly. 0.95 means "reliably winnable by a new
// player," which is the whole promise here.
const MIN_WIN_RATE = 0.95;

describe("STARTER PATROL BALANCE: winnable by all three tactician hulls", () => {
  // Observe the three win rates AND assert the floor. Logged so a maintainer can SEE the
  // balance headroom, not just the pass/fail (Omega 14: observable, not silent). Measuring
  // all three in one test keeps the 200-seed x 3-hull sweep to a single describe block.
  it("each of the three tactician hulls wins the starter at or above the floor", () => {
    for (const hull of COMBAT_HULLS) {
      const { wins, rate } = winRate(hull);
      // eslint-disable-next-line no-console
      console.log(
        `[patrol-balance] ${hull.padEnd(10)} win rate = ${(rate * 100).toFixed(1)}% ` +
          `(${wins}/${SEED_COUNT})`,
      );
      // The guard: this hull's DEFAULT loadout must reliably clear the starter. A failure
      // here means a tune (PATROLS / PIRATE_HULLS / COMBAT_DEFAULT_LOADOUT) has made the
      // FIRST patrol unwinnable for `hull` again, the exact wall this test exists to prevent.
      expect(
        rate,
        `${hull} win rate ${(rate * 100).toFixed(1)}% is below the ${(MIN_WIN_RATE * 100).toFixed(0)}% floor: ` +
          `the starter patrol must be reliably winnable by every tactician hull's default loadout`,
      ).toBeGreaterThanOrEqual(MIN_WIN_RATE);
    }
  });
});
