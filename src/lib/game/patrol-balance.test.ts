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
  // Combat-defense rework: the FIXED SI-gear dials the local SI-spec mirror mints at.
  SI_PLATING_HP,
  SI_EMITTER_CAP,
  SI_EMITTER_RECHARGE,
  type GameState,
  type ShipTypeKey,
  type PatrolMissionState,
  patrolRouteOf,
  patrolRouteTicks,
  type CombatStandardIssueSpec,
  type EquipmentInstance,
} from "./model";
import { dispatchCaptainOnPatrol, economyTick, installMissingCombatBaselines, patrolDispatchCycle, patrolDispatchRoute } from "./tick";
// Combat 1.0 Unit 2.5b (the SHOWCASE-PATROL block below only): the forecast path App.svelte's
// dispatch card shows, so the block asserts the exact Threat Assessment band a player reads.
import {
	defaultWeaponsForHull,
	defaultDroneRolesForHull,
  COMBAT_DEFAULT_LOADOUT,
  installedDronesForPatrol,
  defaultSystemDurabilityForHull,
  foldedPlayerDefense,
  type CombatHullType,
} from "./combat/bridge";
import { resolvePatrolWaves } from "./combat/patrolReplay";
import { threatAssessment } from "./combat/threatAssessment";
import { generateWeapon, generateEquipment, generateDronePod } from "./itemgen";
import type { WeaponId } from "./combat/weapons";
import { asPatrolVeteran } from "./awayTeamTestFixtures";
// WR-8b fix round: the forecast blocks read the stamps a dispatch writes now, exactly as App.svelte patrolForecastFor.
import { patrolDifficultyAt } from "./runDifficulty";
import { shipCombatRulesStamp } from "./crewOverlay";
import { hullFamilyWeaponLine } from "./crewModules";

const PATROL_KEY = "crimsonReaverSweep";
// WR-7 follow-up OC-D8: a cycle's route length is its own (patrolRouteOf: the legs it froze at the ship's transit
// speed), so the harness reads it from the dispatched cycle instead of the def.
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
// (Same shape as patrol-tick.test.ts's helper.) Safe first runs SF-4: a PATROL VETERAN (asPatrolVeteran), so every
// patrol here is the route at full strength (never the safe first patrol or the curve) and the numbers stay the
// balance contract they always were (plan section 4 SF-4: "patrol-balance.test.ts runs as a veteran").
function patrolState(typeKey: ShipTypeKey, seed: number): GameState {
  const base = asPatrolVeteran(freshState());
  // Combat 1.0 (Unit 1.3): seed the combat baseline the retype skipped so a fabricated combat hull
  // clears the new empty-required-slot dispatch blocker (economy hull -> no-op).
  return installMissingCombatBaselines({
    ...base,
    nextPatrolSeed: seed,
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
  // makes economyTick(state, N) identical to N single ticks. Advancing the cycle's full route (its own legs) plus 2
  // slack guarantees the Dispatch-Once patrol resolves (completes or is defeated) so mission === null.
  const routeLen = patrolRouteTicks(patrolRouteOf(dispatched.next.captains[0].mission as PatrolMissionState));
  const final = economyTick(dispatched.next, routeLen + 2, RNG);
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
// same patrol's Standard-Issue win rates at destroyer 8% (16/200) / battleship 71.5% (143/200) /
// carrier 19.5% (39/200), matching the forecast bands below (the two paths agree, as the parity
// proof requires).
//
// WR-8b FIX ROUND (2026-11-10): until this round the forecast helpers ran resolvePatrolWaves with
// no difficulty and no combat rules stamp, so they measured the pre-WR-8 fight (a Standard-Issue
// carrier ~75%) while the player's card (App.svelte patrolForecastFor) reads the WR-8 rules and the
// WR-8b enemy torpedoes. They now mirror the card (liveForecast below). The Warband is harder than
// it was: the user answered (2026-11-10, "Keep, tune in 0.16.0 (Recommended)") that the measured
// numbers stand, every torpedo chance [PROVISIONAL] for the 0.16.0 balancing patch. The bands below
// are the truthfully measured ones (N=64): carrier 15.6% (Extreme), crafted carrier 98.4%, bays
// empty 6.3%, destroyer 6.3%, battleship 71.9% (Worthy). [PROVISIONAL]: re-measure at 0.16.0.
// ============================================================================

// The exact fixed forecast seed + sample count App.svelte's patrolForecastFor uses (App.svelte
// FORECAST_SEED = 0x5a4d, DEFAULT_SAMPLES = 64), so this block reads the SAME band a player sees.
const WARBAND_KEY = "crimsonReaverWarband";
const WARBAND_DEF = PATROLS[WARBAND_KEY];
const FORECAST_SEED = 0x5a4d;
const FORECAST_SAMPLES = 64;

// Standard-Issue gear (the quality-0 free floor), built EXACTLY as the tick.ts dispatch does
// (full default loadout + the FIXED SI-gear dials). Same shape as craftedGearPayoff.test.ts's
// helper, so this block exercises the real seeder output. Combat-defense rework: the SI defensive
// magnitudes are hull-independent; the fold recomposes an SI set to the hull's authored totals via
// the hull's innate stats, so the win-rate bands below are unchanged (byte-identical SI combatant).
function combatSpecFor(hull: CombatHullType): CombatStandardIssueSpec {
  return {
    // 0.13.5 F5: defaultWeaponsForHull, NOT the raw signature list, because that is what the real
    // caller (tick.ts) passes: every hardpoint is filled, so no ship is seeded with an empty slot.
    signatureWeapons: defaultWeaponsForHull(hull),
    droneRoles: defaultDroneRolesForHull(hull),
    shieldCapacity: SI_EMITTER_CAP,
    shieldRecharge: SI_EMITTER_RECHARGE,
    hullStrength: SI_PLATING_HP,
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
  // 0.13.5 F5: the FULL hardpoint count, so crafted and Standard-Issue fill the SAME number of
  // slots and any win-rate gap is gear POWER alone (the whole point of this fixture).
  const weapons = defaultWeaponsForHull(hull).map((weaponType: WeaponId) =>
    generateWeapon({ weaponType, blueprintKey: null, iLevel: 40, quality, rarity, ascension: "none", rng, allocateId: alloc }),
  );
  const emitter = generateEquipment({ slotType: "shieldEmitters", varietyKey: "capacitorBank", blueprintKey: null, iLevel: 90, quality, rarity, ascension: "none", rng, allocateId: alloc });
  const plating = generateEquipment({ slotType: "hullPlating", varietyKey: "reinforcedPlating", blueprintKey: null, iLevel: 90, quality, rarity, ascension: "none", rng, allocateId: alloc });
  const pieces: EquipmentInstance[] = [...weapons, emitter, plating];
  // Carrier: mint a crafted attack pod so its drone screen scales with gear too.
  // 0.13.5 F5: one crafted pod per BAY, matching the Standard-Issue screen.
  for (const droneRole of defaultDroneRolesForHull(hull)) {
    pieces.push(generateDronePod({ droneRole, blueprintKey: null, iLevel: 90, quality, rarity, ascension: "none", rng, allocateId: alloc }));
  }
  return pieces.map((p) => ({ ...p, fittedToShipId: shipId }));
}

// Run the EXACT forecast sweep App.svelte runs for one hull + installed gear, returning the win
// rate + resolved Threat Assessment tier. A sample is a WIN iff the full patrol cycle was never
// defeated (survived every scheduled wave), the same discriminator patrolForecastFor uses.
function forecast(hull: CombatHullType, installedGear: EquipmentInstance[]): { rate: number; tier: string } {
  return liveForecast(WARBAND_KEY, hull, installedGear, `forecast-${WARBAND_KEY}-p`);
}

// WR-8b fix round (2026-11-10): App.svelte patrolForecastFor mirrored for `installedGear` on a patrol veteran's
// `hull` (patrolState), so every forecast block below measures what the player's dispatch card shows: the difficulty
// and the combat rules stamp a dispatch writes now (runDifficulty.ts patrolDifficultyAt, crewOverlay.ts
// shipCombatRulesStamp: the WR-8 rules and the WR-8b enemy torpedoes), the route at the ship's transit speed, the
// cycle's frozen gear, the folded start pools, the durability seed with the stamp, the favored hull and the bridge's
// weapon line. Before this round the blocks ran resolvePatrolWaves with neither stamp, the pre-WR-8 fight. The
// stamp's speed and system pools are the state's own (its Standard-Issue reactor and drive; the crafted set below
// replaces only weapons, shields, plating and pods).
function liveForecast(patrolKey: string, hull: CombatHullType, installedGear: EquipmentInstance[], dronePrefix: string): { rate: number; tier: string } {
  const state = patrolState(hull, 0);
  const ship = state.ships.find((s) => s.id === "ship-1")!;
  const shipDef = SHIP_TYPES[hull];
  const key = patrolKey as keyof typeof PATROLS;
  const def = PATROLS[key];
  const difficulty = patrolDifficultyAt(state);
  const combatRules = shipCombatRulesStamp(state, ship);
  const route = patrolDispatchRoute(state, ship, key).route;
  const hullWeapon = hullFamilyWeaponLine(state, ship);
  const cycleGear = patrolDispatchCycle(state, installedGear, difficulty).gear;
  const startDrones = installedDronesForPatrol(cycleGear, dronePrefix);
  const startSystemDurability = defaultSystemDurabilityForHull(hull, shipDef, cycleGear, combatRules);
  const startDefense = foldedPlayerDefense(shipDef, cycleGear);
  let wins = 0;
  for (let i = 0; i < FORECAST_SAMPLES; i++) {
    const result = resolvePatrolWaves({
      playerId: "ship-1", stats: shipDef, hullType: hull, stance: "balanced", installedGear: cycleGear,
      masterSeed: FORECAST_SEED + i, factionId: def.factionId, def: route,
      startHull: startDefense.hullMax, startShield: startDefense.shieldMax, startDrones, startSystemDurability,
      difficulty, combatRules, favoredHull: ship.typeKey,
      ...(hullWeapon > 0 ? { hullWeapon } : {}),
    });
    if (!result.defeated) wins += 1;
  }
  return { rate: wins / FORECAST_SAMPLES, tier: threatAssessment(wins, FORECAST_SAMPLES).tier };
}

describe("SHOWCASE PATROL BALANCE: the Crimson-Reaver Warband makes the mechanics matter", () => {
  it("a Standard-Issue carrier reads a real fight with a real chance (not Guaranteed)", () => {
    const si = forecast("carrier", standardIssueGear("carrier", "ship-1"));
    // eslint-disable-next-line no-console
    console.log(`[showcase-patrol] carrier Standard-Issue = ${(si.rate * 100).toFixed(1)}% (${si.tier})`);
    // RANGE assertion (not a brittle point value): the free-gear carrier must be a REAL FIGHT.
    // Measured 0.156 (Extreme, 10 of 64) on the live path since WR-8b (the Corsair Carriers'
    // torpedoes; it was ~0.75 Worthy on the pre-WR-8 path this block used to run). The user kept
    // that difficulty (2026-11-10, "Keep, tune in 0.16.0 (Recommended)"), so the floor is the
    // measured band's: above 0.10 (a real chance, never a hopeless wall) [PROVISIONAL] for 0.16.0.
    // The ceiling 0.85 stays clear of a near-certain win; a Standard-Issue carrier reading
    // "Guaranteed" here would mean the patrol failed its purpose (mechanics never forced), the exact
    // wall this guards.
    expect(si.rate, `SI carrier win rate ${(si.rate * 100).toFixed(1)}% must keep a real chance`).toBeGreaterThan(0.10);
    expect(si.rate, `SI carrier win rate ${(si.rate * 100).toFixed(1)}% must not be a near-certain win`).toBeLessThan(0.85);
    // And it must never be the crown "Guaranteed" tier on free gear (the categorical form of the same promise).
    expect(si.tier).not.toBe("guaranteed");
  });

  it("installing good crafted gear pushes the carrier's band UP toward Guaranteed", () => {
    const si = forecast("carrier", standardIssueGear("carrier", "ship-1"));
    const crafted = forecast("carrier", craftedGear("carrier", "ship-1"));
    // eslint-disable-next-line no-console
    console.log(`[showcase-patrol] carrier crafted = ${(crafted.rate * 100).toFixed(1)}% (${crafted.tier}) vs SI ${(si.rate * 100).toFixed(1)}%`);
    // THE PAYOFF: better gear -> strictly more wins on the SAME patrol. Measured SI 0.156 -> crafted 0.984
    // (the live path since the WR-8b fix round; was ~0.75 -> 1.0 on the pre-WR-8 path).
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
    // 0.156 vs 0.063, a ~9pt gap, on the live path since the WR-8b fix round; ~0.75 vs ~0.56 on the
    // pre-WR-8 path). Assert a margin, not just strictly-greater, so the invariant is
    // "drones meaningfully help" rather than "drones help by a single unlucky seed".
    expect(withDrones.rate - noDrones.rate, "a carrier's drone screen must clearly improve its odds vs the corsair pool").toBeGreaterThan(0.08);
  });

  it("hull choice matters: the glass-cannon destroyer reads a harder band than the tankier battleship", () => {
    // The point of the Warband is that WHICH hull you send now matters. The destroyer is a striker
    // (thin hull, big guns), not an anti-swarm platform, so on this corsair-heavy pool it must read
    // the HARDEST band of the combat hulls, while the battleship sits in a mid "real fight" band.
    // These lock the documented spread (measured on the live path since the WR-8b fix round: destroyer
    // 6.3% / battleship 71.9% / carrier 15.6%; ~16% / ~55% / ~75% on the pre-WR-8 path) so
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
// the tougher Warband. Measured spread (N=64), documented so a maintainer sees the headroom
// (the WR-8b fix round, 2026-11-10: the live path, liveForecast; the user kept the difficulty,
// "Keep, tune in 0.16.0 (Recommended)", [PROVISIONAL] for 0.16.0):
//   Sweep   : destroyer 100%  | freighter ~78% hauler ~86% runner ~58% miner ~58%
//   Warband : destroyer ~6.3% | freighter 0%   hauler 0%   runner 0%   miner 0%
// (WR-4, B14, on the pre-WR-8 path: Sweep destroyer 100% | freighter ~98% hauler 100% runner ~58% miner
// ~58%; Warband destroyer ~17% | freighter ~3% hauler ~3% runner 0% miner 0%.) Every economy hull wins
// no Warband sample while the destroyer wins 4 of 64, so its strict "< destroyer" inequality holds; the
// saturated Sweep is checked as "never above the destroyer".
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
  // WR-8b fix round: the live forecast path (liveForecast above); patrolDef is PATROLS[patrolKey].
  expect(patrolDef).toBe(PATROLS[patrolKey as keyof typeof PATROLS]);
  return liveForecast(patrolKey, hull, standardIssueGear(hull, "ship-1"), `inferiority-${patrolKey}-p`);
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
        // THE contract: an economy hull's free-gear win rate never reaches past the DESTROYER's (the weakest
        // combat hull), and on the Warband it is strictly below it, so it never rivals a purpose-built warship.
        // WR-4 (B14): turn order is by side now (the player acts first), so the entry Sweep SATURATES: the
        // destroyer and the hauler both clear every seed, and a strict "<" against 100% cannot hold. On the Sweep
        // the check is the user's own words ("you will never outperform a destroyer"); the Warband keeps the
        // strict gap. (Balance of the Sweep is SF-4's, plan 2026-10-15 B9.)
        const message =
          `${hull} Standard-Issue win rate ${(eco.rate * 100).toFixed(1)}% must be BELOW the destroyer's ` +
          `${(destroyer.rate * 100).toFixed(1)}% on ${patrolKey} (economy hulls are strictly inferior)`;
        if (patrolKey === SWEEP_KEY) expect(eco.rate, message).toBeLessThanOrEqual(destroyer.rate);
        else expect(eco.rate, message).toBeLessThan(destroyer.rate);
      }
    });
  }
});

