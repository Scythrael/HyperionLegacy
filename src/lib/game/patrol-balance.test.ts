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
  SHIP_TYPES,
  seedCombatStandardIssueForShip,
  type GameState,
  type ShipTypeKey,
  type PatrolMissionState,
  type CombatStandardIssueSpec,
  type EquipmentInstance,
} from "./model";
import { dispatchCaptainOnPatrol, economyTick, installMissingCombatBaselines } from "./tick";
// Combat 1.0 Unit 2.5b (the SHOWCASE-PATROL block below only): the forecast path App.svelte's
// dispatch card shows, so the block asserts the exact Threat Assessment band a player reads.
import {
  COMBAT_DEFAULT_LOADOUT,
  frameHp,
  installedDronesForPatrol,
  defaultSystemDurabilityForHull,
  type CombatHullType,
} from "./combat/bridge";
import { resolvePatrolWaves } from "./combat/patrolReplay";
import { threatAssessment } from "./combat/threatAssessment";
import { generateWeapon, generateEquipment, generateDronePod } from "./itemgen";
import type { WeaponId } from "./combat/weapons";

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

// ============================================================================
// SHOWCASE PATROL BALANCE: the tougher Crimson-Reaver Warband (Combat 1.0 Unit 2.5b).
//
// WHAT THIS LOCKS (the opposite promise from the block above): the entry Sweep must be
// reliably WINNABLE by every hull's default loadout; the Warband must be a REAL FIGHT that
// makes the mechanics VISIBLE. Three invariants, all measured through the REAL sim:
//
//   1. MID BAND on free gear: a carrier flying its Standard-Issue loadout reads a mid Threat
//      Assessment tier (NOT "Guaranteed"), a real fight with losses expected. This is the
//      whole reason the patrol exists (the Sweep is a guaranteed win for every hull, so
//      drones / gear / the bands never matter there).
//   2. CRAFTED GEAR MATTERS: installing good crafted gear pushes that same carrier's band UP
//      toward Guaranteed (a strictly higher win rate).
//   3. DRONES MATTER: a carrier fielding its drone screen reads a clearly higher win rate than
//      the same carrier with its bays empty (the corsair-heavy pool is where drones swing it).
//
// WHY THE FORECAST PATH (resolvePatrolWaves), NOT the economyTick loop the block above uses:
// this block asserts the DISPLAYED Threat Assessment band, so it drives the EXACT path
// App.svelte's dispatch card runs (resolvePatrolWaves swept over FORECAST_SEED + i, then
// threatAssessment). That path is parity-proven to the live loop (patrolReplay.test.ts), and it
// takes installedGear directly, so the crafted / drones comparisons need no live gear-install
// plumbing. For the record, the live economyTick loop (the block above's method) measures this
// same patrol's Standard-Issue win rates at destroyer ~22% / battleship ~52% / carrier ~76% over
// 200 seeds, matching the forecast bands below (the two paths agree, as the parity proof requires).
// ============================================================================

// The exact fixed forecast seed + sample count App.svelte's patrolForecastFor uses (App.svelte
// FORECAST_SEED = 0x5a4d, DEFAULT_SAMPLES = 64), so this block reads the SAME band a player sees.
const WARBAND_KEY = "crimsonReaverWarband";
const WARBAND_DEF = PATROLS[WARBAND_KEY];
const FORECAST_SEED = 0x5a4d;
const FORECAST_SAMPLES = 64;

// Standard-Issue gear (the quality-0 free floor), built EXACTLY as the tick.ts dispatch does
// (full default loadout + the hull's shield/plating/drone-pod baseline). Same shape as
// craftedGearPayoff.test.ts's helper, so this block exercises the real seeder output.
function combatSpecFor(hull: CombatHullType): CombatStandardIssueSpec {
  const def = SHIP_TYPES[hull];
  return {
    signatureWeapons: [...COMBAT_DEFAULT_LOADOUT[hull].weapons],
    droneRoles: [...COMBAT_DEFAULT_LOADOUT[hull].droneRoles],
    shieldCapacity: def.shieldCapacity,
    shieldRecharge: def.shieldRecharge,
    hullStrength: def.hullIntegrity - frameHp(def.hullIntegrity),
  };
}
function standardIssueGear(hull: CombatHullType, shipId: string): EquipmentInstance[] {
  return seedCombatStandardIssueForShip(shipId, combatSpecFor(hull), 1).pieces;
}

// A tiny seeded PRNG (test-local, exactly like craftedGearPayoff.test.ts) so the crafted mint
// is fully reproducible with zero Math.random.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function idAllocator(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}-${n++}`;
}

// A GOOD crafted set of the SAME slot shape as Standard-Issue (same weapons + one emitter + one
// plating, plus a crafted attack pod for the carrier), minted through the REAL itemgen path at a
// mid-high item level / q5 / radiant roll. Any win-rate gap vs Standard-Issue is gear POWER alone.
function craftedGear(hull: CombatHullType, shipId: string): EquipmentInstance[] {
  const rng = mulberry32(90210);
  const alloc = idAllocator("crafted");
  const rarity = "radiant" as const;
  const quality = 5;
  const weapons = COMBAT_DEFAULT_LOADOUT[hull].weapons.map((weaponType: WeaponId) =>
    generateWeapon({ weaponType, blueprintKey: null, iLevel: 40, quality, rarity, ascension: "none", rng, allocateId: alloc }),
  );
  const emitter = generateEquipment({ slotType: "shieldEmitters", varietyKey: "capacitorBank", blueprintKey: null, iLevel: 90, quality, rarity, ascension: "none", rng, allocateId: alloc });
  const plating = generateEquipment({ slotType: "hullPlating", varietyKey: "reinforcedPlating", blueprintKey: null, iLevel: 90, quality, rarity, ascension: "none", rng, allocateId: alloc });
  const pieces: EquipmentInstance[] = [...weapons, emitter, plating];
  // Carrier: mint a crafted attack pod so its drone screen scales with gear too.
  if (COMBAT_DEFAULT_LOADOUT[hull].droneRoles.length > 0) {
    pieces.push(generateDronePod({ droneRole: "attack", blueprintKey: null, iLevel: 90, quality, rarity, ascension: "none", rng, allocateId: alloc }));
  }
  return pieces.map((p) => ({ ...p, fittedToShipId: shipId }));
}

// Run the EXACT forecast sweep App.svelte runs for one hull + installed gear, returning the win
// rate + resolved Threat Assessment tier. A sample is a WIN iff the full patrol cycle was never
// defeated (survived every scheduled wave), the same discriminator patrolForecastFor uses.
function forecast(hull: CombatHullType, installedGear: EquipmentInstance[]): { rate: number; tier: string } {
  const shipDef = SHIP_TYPES[hull];
  const startDrones = installedDronesForPatrol(installedGear, `forecast-${WARBAND_KEY}-p`);
  const startSystemDurability = defaultSystemDurabilityForHull(hull, shipDef);
  let wins = 0;
  for (let i = 0; i < FORECAST_SAMPLES; i++) {
    const result = resolvePatrolWaves({
      playerId: "ship-1", stats: shipDef, hullType: hull, stance: "balanced", installedGear,
      masterSeed: FORECAST_SEED + i, factionId: WARBAND_DEF.factionId, def: WARBAND_DEF,
      startHull: shipDef.hullIntegrity, startShield: shipDef.shieldCapacity, startDrones, startSystemDurability,
    });
    if (!result.defeated) wins += 1;
  }
  return { rate: wins / FORECAST_SAMPLES, tier: threatAssessment(wins, FORECAST_SAMPLES).tier };
}

describe("SHOWCASE PATROL BALANCE: the Crimson-Reaver Warband makes the mechanics matter", () => {
  it("a Standard-Issue carrier lands in a MID threat band (a real fight, not Guaranteed)", () => {
    const si = forecast("carrier", standardIssueGear("carrier", "ship-1"));
    // eslint-disable-next-line no-console
    console.log(`[showcase-patrol] carrier Standard-Issue = ${(si.rate * 100).toFixed(1)}% (${si.tier})`);
    // RANGE assertion (not a brittle point value): the free-gear carrier must be a REAL FIGHT.
    // Measured ~0.75 (worthy). The band (0.40, 0.85) keeps it strictly out of both the "Not
    // Advised" floor below 0.40 (unwinnable-feeling) and the >= 0.80... note the ceiling is 0.85 so
    // it also stays clear of a near-certain win; a Standard-Issue carrier reading "Guaranteed" here
    // would mean the patrol failed its purpose (mechanics never forced), the exact wall this guards.
    expect(si.rate, `SI carrier win rate ${(si.rate * 100).toFixed(1)}% must sit in the mid band`).toBeGreaterThan(0.40);
    expect(si.rate, `SI carrier win rate ${(si.rate * 100).toFixed(1)}% must not be a near-certain win`).toBeLessThan(0.85);
    // And it must never be the crown "Guaranteed" tier on free gear (the categorical form of the same promise).
    expect(si.tier).not.toBe("guaranteed");
  });

  it("installing good crafted gear pushes the carrier's band UP toward Guaranteed", () => {
    const si = forecast("carrier", standardIssueGear("carrier", "ship-1"));
    const crafted = forecast("carrier", craftedGear("carrier", "ship-1"));
    // eslint-disable-next-line no-console
    console.log(`[showcase-patrol] carrier crafted = ${(crafted.rate * 100).toFixed(1)}% (${crafted.tier}) vs SI ${(si.rate * 100).toFixed(1)}%`);
    // THE PAYOFF: better gear -> strictly more wins on the SAME patrol. Measured SI ~0.75 -> crafted 1.0.
    expect(crafted.rate, "crafted carrier must win the warband strictly more often than Standard-Issue").toBeGreaterThan(si.rate);
    // And crafted must reach the top of the ladder (toward / at Guaranteed): a strong signal, not a nudge.
    expect(crafted.rate, "good crafted gear must lift the carrier to a near-certain win").toBeGreaterThanOrEqual(0.90);
  });

  it("a carrier fielding drones reads a clearly better band than one with empty bays", () => {
    const withDrones = forecast("carrier", standardIssueGear("carrier", "ship-1"));
    // Strip the drone-bay pieces from the Standard-Issue set: an otherwise-identical carrier with
    // its hangars empty (so installedDronesForPatrol yields no squadrons -> no drone screen).
    const baysEmpty = standardIssueGear("carrier", "ship-1").filter((p) => p.slotType !== "droneBay");
    const noDrones = forecast("carrier", baysEmpty);
    // eslint-disable-next-line no-console
    console.log(`[showcase-patrol] carrier drones ON = ${(withDrones.rate * 100).toFixed(1)}% vs bays EMPTY = ${(noDrones.rate * 100).toFixed(1)}%`);
    // Drones must SWING the fight against the corsair-heavy pool: a clear, non-noise lift (measured
    // ~0.75 vs ~0.56, a ~19pt gap). Assert a margin, not just strictly-greater, so the invariant is
    // "drones meaningfully help" rather than "drones help by a single unlucky seed".
    expect(withDrones.rate - noDrones.rate, "a carrier's drone screen must clearly improve its odds vs the corsair pool").toBeGreaterThan(0.08);
  });

  it("hull choice matters: the glass-cannon destroyer reads a harder band than the tankier battleship", () => {
    // The point of the Warband is that WHICH hull you send now matters. The destroyer is a striker
    // (thin hull, big guns), not an anti-swarm platform, so on this corsair-heavy pool it must read
    // the HARDEST band of the combat hulls, while the battleship sits in a mid "real fight" band.
    // These lock the documented spread (measured destroyer ~16% / battleship ~55% / carrier ~75%) so
    // a future gear or rating change cannot silently collapse it (e.g. flatten every hull to the
    // same band, or push the destroyer to a literal 0-win "Impossible" wall that reads as broken).
    const destroyer = forecast("destroyer", standardIssueGear("destroyer", "ship-1"));
    const battleship = forecast("battleship", standardIssueGear("battleship", "ship-1"));
    // eslint-disable-next-line no-console
    console.log(`[showcase-patrol] destroyer SI = ${(destroyer.rate * 100).toFixed(1)}% (${destroyer.tier}) vs battleship SI = ${(battleship.rate * 100).toFixed(1)}% (${battleship.tier})`);
    // The destroyer must be strictly the harder read of the two, but never a 0% Impossible wall (a
    // slim chance still exists; the band just warns you off).
    expect(destroyer.rate, "the glass-cannon destroyer must read harder than the battleship on this patrol").toBeLessThan(battleship.rate);
    expect(destroyer.rate, "the destroyer must still have a real (if slim) chance, never a 0% Impossible wall").toBeGreaterThan(0.02);
    // The battleship holds the middle: a genuine fight on free gear, neither a long shot nor a lock.
    expect(battleship.rate, "the battleship must be a mid-band real fight, not a near-certain loss").toBeGreaterThan(0.30);
    expect(battleship.rate, "the battleship on free gear must not be a near-certain win").toBeLessThan(0.85);
    expect(battleship.tier, "the battleship on free gear must not read the crown Guaranteed tier").not.toBe("guaranteed");
  });
});

// ============================================================================
// ECONOMY HULLS ARE STRICTLY INFERIOR ("every hull is combat-capable", user decision).
//
// WHAT THIS LOCKS: every economy hull (freighter/hauler/runner/miner), flying its WEAK
// Standard-Issue combat set, is DISPATCHABLE but STRICTLY INFERIOR to a purpose-built
// combat hull ("you will never outperform a destroyer of similar capability"). The
// machine-checked promise: on BOTH patrols, each economy hull's Standard-Issue win rate
// is BELOW the DESTROYER's (the weakest combat hull), and therefore far below the
// battleship/carrier. A hauler surviving the easy Sweep is fine; it must not rival a
// combat hull anywhere. This guards against a future loadout/stat tune silently letting an
// economy hull match a warship, the exact wall this feature exists to prevent.
//
// HOW IT MEASURES: the SAME REAL forecast sim (resolvePatrolWaves) the SHOWCASE block uses,
// swept over the same FORECAST_SEED + i for N=FORECAST_SAMPLES, on BOTH the entry Sweep and
// the tougher Warband. Measured spread (N=64), documented so a maintainer sees the headroom:
//   Sweep   : destroyer ~98% | freighter ~67% hauler ~80% runner ~67% miner ~67%
//   Warband : destroyer ~18% | freighter ~2%  hauler ~3%  runner ~1%  miner ~1%
// The gaps (an ~18pt Sweep gap, a ~15pt Warband gap on the tankiest economy hull) are wide,
// so the strict "< destroyer" inequality is robust to sampling noise at this N.
// ============================================================================

// The two patrols the inferiority contract spans, each measured through the real forecast sim.
const SWEEP_KEY = "crimsonReaverSweep";
const SWEEP_DEF = PATROLS[SWEEP_KEY];
const ECONOMY_HULLS: ShipTypeKey[] = [
  "generalFreighter",
  "prospectorHauler",
  "prospectorRunner",
  "prospectorMiner",
];

// forecast(), but for an ARBITRARY patrol def (the file's forecast is Warband-only). Same real
// sweep, so a rate here is directly comparable to the destroyer's on the same patrol.
function forecastOnPatrol(
  patrolDef: typeof SWEEP_DEF,
  patrolKey: string,
  hull: CombatHullType,
): { rate: number; tier: string } {
  const shipDef = SHIP_TYPES[hull];
  const gear = standardIssueGear(hull, "ship-1");
  const startDrones = installedDronesForPatrol(gear, `inferiority-${patrolKey}-p`);
  const startSystemDurability = defaultSystemDurabilityForHull(hull, shipDef);
  let wins = 0;
  for (let i = 0; i < FORECAST_SAMPLES; i++) {
    const result = resolvePatrolWaves({
      playerId: "ship-1", stats: shipDef, hullType: hull, stance: "balanced", installedGear: gear,
      masterSeed: FORECAST_SEED + i, factionId: patrolDef.factionId, def: patrolDef,
      startHull: shipDef.hullIntegrity, startShield: shipDef.shieldCapacity, startDrones, startSystemDurability,
    });
    if (!result.defeated) wins += 1;
  }
  return { rate: wins / FORECAST_SAMPLES, tier: threatAssessment(wins, FORECAST_SAMPLES).tier };
}

describe("ECONOMY HULLS ARE STRICTLY INFERIOR: Standard-Issue win rate below the destroyer's on both patrols", () => {
  for (const [patrolKey, patrolDef] of [
    [SWEEP_KEY, SWEEP_DEF] as const,
    [WARBAND_KEY, WARBAND_DEF] as const,
  ]) {
    it(`${patrolKey}: every economy hull wins strictly less often than the destroyer`, () => {
      const destroyer = forecastOnPatrol(patrolDef, patrolKey, "destroyer");
      for (const hull of ECONOMY_HULLS) {
        const eco = forecastOnPatrol(patrolDef, patrolKey, hull);
        // eslint-disable-next-line no-console
        console.log(
          `[inferiority] ${patrolKey.padEnd(20)} ${hull.padEnd(18)} ${(eco.rate * 100).toFixed(1).padStart(5)}% ` +
            `vs destroyer ${(destroyer.rate * 100).toFixed(1)}%`,
        );
        // THE contract: an economy hull's free-gear win rate is strictly below the DESTROYER's
        // (the weakest combat hull) on this patrol, so it never rivals a purpose-built warship.
        expect(
          eco.rate,
          `${hull} Standard-Issue win rate ${(eco.rate * 100).toFixed(1)}% must be BELOW the destroyer's ` +
            `${(destroyer.rate * 100).toFixed(1)}% on ${patrolKey} (economy hulls are strictly inferior)`,
        ).toBeLessThan(destroyer.rate);
      }
    });
  }
});

