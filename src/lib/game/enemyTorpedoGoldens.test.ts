// WR-8b ENEMY TORPEDOES, GOLDENS FIRST (docs/plans/2026-10-15-wiring-registry-and-audit-plan.md, the USER ANSWERS
// 2026-11-10 "Enemy torpedoes" bullet: "Simple now"): the fights the slice touches, captured on the code BEFORE the
// engine edit (on top of f8d3623), so the engine commit has to name every move it makes. Real dispatches through
// dispatchCaptainOnPatrol / dispatchPastPropulsion and the live loops, nothing edited after dispatch except where a row
// says so (the ship-event tier rows set the run's frozen difficulty stamp to each tier, the only way to fly every tier
// from one fixture):
//
//   1. stamp    : the combat rules stamp a run starting now writes (crewOverlay.ts shipCombatRulesStamp).
//   2. patrol   : the three tactician hulls x both routes, Dispatch Once, Balanced, on a patrol veteran save (full
//                 strength), plus a Defensive Carrier on the Warband and a Destroyer on the Sweep at three curve
//                 positions: the dispatch record, the display replay, the outcome and its tick, the ship and the state.
//   3. forecast : the dispatch card's Threat Assessment (App.svelte patrolForecastFor mirrored) for the three hulls x
//                 both routes.
//   4. tiers    : the ship battles at each expedition tier (an Orion veteran run, stubbed draws: a Hostile Probe and a
//                 Cloaked Vessel with the sensor check passed and failed, two bodies x eight steps).
//   5. shipEvent: whole Ground Operations runs (three explorers x two seeds, Tier I veteran, D18 crew) to SWEEP_END.

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import { PATROLS, SHIP_TYPES, type Expedition, type GameState, type PatrolKey, type PatrolMissionState, type RegionTier, type ShipTypeKey } from "./model";
import { dispatchCaptainOnPatrol, economyTick } from "./tick";
import { advanceExpedition } from "./expedition";
import { resolveShipScanEventFromDraws, shipEventKindOf, SHIP_EVENT_DRAW_UNITS, SHIP_EVENT_WEIGHT_TOTAL, type ShipEventDraws } from "./shipScanEvents";
import { equippedFor } from "./equipment";
import { replayPatrol, resolvePatrolWaves } from "./combat/patrolReplay";
import { combatHullTypeOf, defaultSystemDurabilityForHull, foldedPlayerDefense, installedDronesForPatrol } from "./combat/bridge";
import { DEFAULT_SAMPLES } from "./combat/rating";
import { threatAssessment } from "./combat/threatAssessment";
import type { CombatStance } from "./combat/positioning";
import { hash, onHull, runOutcome, stateHash, SWEEP_END, withCrew } from "./firstRunsGoldens.fixture";
import { asExpeditionVeteran, asPatrolVeteran, dispatchPastPropulsion } from "./awayTeamTestFixtures";
import { onPatrolCurve, routeTicks } from "./safeFirstPatrol.fixture";
import { patrolDifficultyAt } from "./runDifficulty";
import { shipCombatRulesStamp } from "./crewOverlay";

const TACTICIANS: ShipTypeKey[] = ["destroyer", "battleship", "carrier"];
const ROUTES = Object.keys(PATROLS) as PatrolKey[];
const EXPLORERS: ShipTypeKey[] = ["orion", "aurora", "eir"];
const RUN_SEEDS: (number | undefined)[] = [undefined, 202];
const TIERS: RegionTier[] = [1, 2, 3, 4, 7];
const CURVE: number[] = [3, 6, 9];
const RNG = (): number => 0.5;

const patrolOf = (s: GameState): PatrolMissionState | null => s.captains[0].mission as PatrolMissionState | null;

function patrolSave(hull: ShipTypeKey, completed: number | null): GameState {
  const s = { ...onHull(hull), nextPatrolSeed: 1, credits: new Decimal(100_000) };
  return completed === null ? asPatrolVeteran(s) : onPatrolCurve(s, completed);
}

// One Dispatch Once patrol advanced in one call over its route (the loop's closed-form parity: one call == 1 s steps).
export function torpedoPatrolRow(hull: ShipTypeKey, key: PatrolKey, stance: CombatStance, completed: number | null, dispatch = dispatchCaptainOnPatrol): string[] {
  const r = dispatch(patrolSave(hull, completed), 1, key, stance, false);
  expect(r.success, `${hull} ${key}: ${r.reason}`).toBe(true);
  const m = patrolOf(r.next)!;
  const row = [hash(structuredClone(m)), hash(replayPatrol(r.next, r.next.captains[0]))];
  const end = economyTick(r.next, routeTicks(m) + 2, RNG);
  expect(patrolOf(end)).toBeNull();
  row.push(end.ships[0].damaged === true ? "lost" : "won", hash(end.ships[0]), stateHash(end));
  return row;
}

// App.svelte patrolForecastFor's sweep, mirrored (FORECAST_SEED 0x5a4d + i over DEFAULT_SAMPLES).
function forecast(hull: ShipTypeKey, key: PatrolKey): string {
  const state = patrolSave(hull, null);
  const ship = state.ships[0];
  const hullType = combatHullTypeOf(ship.typeKey)!;
  const def = PATROLS[key];
  const shipDef = SHIP_TYPES[ship.typeKey];
  const installedGear = equippedFor(state, ship.id);
  const startDrones = installedDronesForPatrol(installedGear, `forecast-${key}-p`);
  const combatRules = shipCombatRulesStamp(state, ship);
  const startSystemDurability = defaultSystemDurabilityForHull(hullType, shipDef, installedGear, combatRules);
  const startDefense = foldedPlayerDefense(shipDef, installedGear);
  let wins = 0;
  for (let i = 0; i < DEFAULT_SAMPLES; i++) {
    const result = resolvePatrolWaves({
      playerId: ship.id, stats: shipDef, hullType, stance: "balanced", installedGear, masterSeed: 0x5a4d + i, factionId: def.factionId, def,
      startHull: startDefense.hullMax, startShield: startDefense.shieldMax, startDrones, startSystemDurability,
      difficulty: patrolDifficultyAt(state), combatRules,
    });
    if (!result.defeated) wins += 1;
  }
  return `${wins}:${threatAssessment(wins, DEFAULT_SAMPLES).tier}`;
}

// An Orion veteran's Tier I run (the D18 crew), as dispatched.
export function torpedoRun(dispatch: typeof dispatchPastPropulsion = dispatchPastPropulsion): Expedition {
  const res = dispatch(asExpeditionVeteran(withCrew(onHull("orion"), "d18")), "ship-1", 1, "cand-0");
  expect(res.success, res.reason).toBe(true);
  return res.expedition!;
}
function kindDraw(want: "probe" | "cloaked"): number {
  for (let k = 0; k < SHIP_EVENT_WEIGHT_TOTAL; k++) if (shipEventKindOf({ kind: k, cloaked: 0 }) === want) return k;
  throw new Error(`no draw names ${want}`);
}
// The run's ship battles with its frozen difficulty stamp read at `tier` (full strength), from stubbed draws.
export function torpedoTierRow(exp: Expedition, tier: RegionTier): string {
  const atTier = { ...exp, difficulty: { version: 1 as const, firstRun: false, ramp: 1, tier } };
  const quiet = { boardingAttempt: SHIP_EVENT_DRAW_UNITS - 1, boardingRepel: 0 };
  const cases: [string, ShipEventDraws][] = [
    ["p", { kind: kindDraw("probe"), check: 0, cloaked: 0, ...quiet }],
    ["cp", { kind: kindDraw("cloaked"), check: 0, cloaked: 0, ...quiet }],
    ["cf", { kind: kindDraw("cloaked"), check: SHIP_EVENT_DRAW_UNITS - 1, cloaked: 0, ...quiet }],
  ];
  const out: string[] = [];
  for (const [name, draws] of cases) {
    for (let b = 0; b < Math.min(2, exp.bodies.length); b++) {
      for (let step = 0; step < 8; step++) {
        const r = resolveShipScanEventFromDraws(atTier, exp.bodies[b], b, step, 1, draws);
        out.push(`${name}${b}${step}:${r.event.outcome === "win" ? "w" : "l"}${r.event.hullWear ?? 0}`);
      }
    }
  }
  return out.join(",");
}

function shipEventRow(hull: ShipTypeKey, seed: number | undefined): string[] {
  const res = dispatchPastPropulsion(asExpeditionVeteran(withCrew(onHull(hull, seed), "d18")), "ship-1", 1, "cand-0");
  expect(res.success, `${hull}: ${res.reason}`).toBe(true);
  const done: Expedition = advanceExpedition(res.expedition!, SWEEP_END);
  const events = (done.scanEvents ?? []).filter((e) => e.kind === "shipEvent");
  const battles = events.filter((e) => e.event === "probe" || e.event === "cloaked").map((e) => `${e.event}:${e.outcome}`);
  const o = runOutcome(done);
  return [battles.join(",") || "none", hash(events), `${o.objectives} hull:${o.hullDamage} setbacks:${o.setbacks}`, hash(done)];
}

// Captured on the code BEFORE the engine edit (f8d3623).
export const TORPEDO_GOLDEN_PRE: Record<string, unknown> = {
  "stamp": "f61e5bbf",
  "patrol:destroyer:crimsonReaverSweep": ["c478f282", "ba2ee129", "won", "6ad9f46c", "7ade5edc"],
  "forecast:destroyer:crimsonReaverSweep": "64:guaranteed",
  "patrol:destroyer:crimsonReaverWarband": ["4912f49d", "8ce2a37d", "won", "6ad9f46c", "d180151"],
  "forecast:destroyer:crimsonReaverWarband": "9:extreme",
  "patrol:battleship:crimsonReaverSweep": ["d148adf6", "1ce1681f", "won", "c6dba9cb", "b5a20ae8"],
  "forecast:battleship:crimsonReaverSweep": "64:guaranteed",
  "patrol:battleship:crimsonReaverWarband": ["e60947f4", "ed71e279", "won", "c6dba9cb", "ac5e573d"],
  "forecast:battleship:crimsonReaverWarband": "52:likely",
  "patrol:carrier:crimsonReaverSweep": ["4e649c52", "9cc52b1a", "won", "ea909677", "98532b55"],
  "forecast:carrier:crimsonReaverSweep": "64:guaranteed",
  "patrol:carrier:crimsonReaverWarband": ["f131f134", "613e0ea8", "won", "ea909677", "c71daa72"],
  "forecast:carrier:crimsonReaverWarband": "23:notAdvised",
  "patrol:carrier:warband:standoff": ["bebd93ff", "708a5014", "won", "ea909677", "3449a3f9"],
  "patrol:destroyer:sweep:c3": ["f17a3614", "bd838264", "won", "6ad9f46c", "6ca4ceec"],
  "patrol:destroyer:sweep:c6": ["48c8c555", "e7d1e7fc", "won", "6ad9f46c", "2edb440b"],
  "patrol:destroyer:sweep:c9": ["149cbfa0", "7e5649b", "won", "6ad9f46c", "2306786f"],
  "tier:1": "p00:w0,p01:w0,p02:w0,p03:w0,p04:w0,p05:w0,p06:w0,p07:w0,p10:w0,p11:w0,p12:w0,p13:w0,p14:w0,p15:w0,p16:w0,p17:w0,cp00:w0,cp01:w0,cp02:w0,cp03:w0,cp04:w0,cp05:w0,cp06:w0,cp07:w0,cp10:w0,cp11:w0,cp12:w0,cp13:w0,cp14:w0,cp15:w0,cp16:w0,cp17:w0,cf00:w0,cf01:w0,cf02:w0,cf03:w0,cf04:l41,cf05:w0,cf06:w0,cf07:w0,cf10:w0,cf11:l41,cf12:w0,cf13:w0,cf14:w0,cf15:w0,cf16:w0,cf17:w0",
  "tier:2": "p00:w0,p01:w0,p02:w0,p03:w0,p04:w0,p05:w0,p06:w0,p07:w0,p10:w0,p11:w0,p12:w0,p13:w0,p14:w0,p15:w0,p16:w0,p17:w0,cp00:l41,cp01:l41,cp02:l41,cp03:l41,cp04:l41,cp05:l41,cp06:l41,cp07:l41,cp10:w0,cp11:w0,cp12:w0,cp13:w0,cp14:w0,cp15:w0,cp16:w0,cp17:w0,cf00:l41,cf01:l41,cf02:l41,cf03:l41,cf04:l41,cf05:l41,cf06:l41,cf07:l41,cf10:w0,cf11:l41,cf12:w0,cf13:w0,cf14:w0,cf15:w0,cf16:w0,cf17:w0",
  "tier:3": "p00:w0,p01:w0,p02:w0,p03:w0,p04:w0,p05:w0,p06:w0,p07:w0,p10:w0,p11:w0,p12:w0,p13:w0,p14:w0,p15:w0,p16:w0,p17:w0,cp00:l41,cp01:l41,cp02:l41,cp03:l41,cp04:l41,cp05:l41,cp06:l41,cp07:l41,cp10:w0,cp11:w0,cp12:w0,cp13:w0,cp14:w0,cp15:w0,cp16:w0,cp17:w0,cf00:l41,cf01:l41,cf02:l41,cf03:l41,cf04:l41,cf05:l41,cf06:l41,cf07:l41,cf10:w0,cf11:l41,cf12:w0,cf13:w0,cf14:w0,cf15:w0,cf16:w0,cf17:w0",
  "tier:4": "p00:w0,p01:w0,p02:w0,p03:w0,p04:w0,p05:w0,p06:w0,p07:w0,p10:w0,p11:w0,p12:w0,p13:w0,p14:w0,p15:w0,p16:w0,p17:w0,cp00:l41,cp01:l41,cp02:l41,cp03:l41,cp04:l41,cp05:l41,cp06:l41,cp07:l41,cp10:w0,cp11:w0,cp12:w0,cp13:w0,cp14:w0,cp15:w0,cp16:w0,cp17:w0,cf00:l41,cf01:l41,cf02:l41,cf03:l41,cf04:l41,cf05:l41,cf06:l41,cf07:l41,cf10:w0,cf11:l41,cf12:w0,cf13:w0,cf14:w0,cf15:w0,cf16:w0,cf17:w0",
  "tier:7": "p00:w0,p01:w0,p02:w0,p03:w0,p04:w0,p05:w0,p06:w0,p07:w0,p10:w0,p11:w0,p12:w0,p13:w0,p14:w0,p15:w0,p16:w0,p17:w0,cp00:l41,cp01:l41,cp02:l41,cp03:l41,cp04:l41,cp05:l41,cp06:l41,cp07:l41,cp10:w0,cp11:w0,cp12:w0,cp13:w0,cp14:w0,cp15:w0,cp16:w0,cp17:w0,cf00:l41,cf01:l41,cf02:l41,cf03:l41,cf04:l41,cf05:l41,cf06:l41,cf07:l41,cf10:w0,cf11:l41,cf12:w0,cf13:w0,cf14:w0,cf15:w0,cf16:w0,cf17:w0",
  "shipEvent:orion:default": ["none", "628d0a82", "1/11 hull:0 setbacks:0", "67d47d9b"],
  "shipEvent:orion:202": ["probe:win", "80f873f6", "3/7 hull:0 setbacks:0", "177040db"],
  "shipEvent:aurora:default": ["none", "628d0a82", "1/11 hull:0 setbacks:0", "31de8458"],
  "shipEvent:aurora:202": ["probe:win", "a0a9f50a", "3/7 hull:0 setbacks:0", "4fccefcf"],
  "shipEvent:eir:default": ["none", "628d0a82", "1/11 hull:0 setbacks:0", "255e5e5c"],
  "shipEvent:eir:202": ["probe:win", "7a7aef9b", "2/6 hull:0 setbacks:1", "7d6947c8"],
};

describe("WR-8b goldens: the pre-torpedo capture", () => {
  it("stamp", () => expect(hash(shipCombatRulesStamp(onHull("destroyer"), onHull("destroyer").ships[0]))).toBe(TORPEDO_GOLDEN_PRE.stamp));
  for (const hull of TACTICIANS) {
    for (const key of ROUTES) {
      it(`patrol ${hull} ${key}`, { timeout: 120_000 }, () => expect(torpedoPatrolRow(hull, key, "balanced", null)).toEqual(TORPEDO_GOLDEN_PRE[`patrol:${hull}:${key}`]));
      it(`forecast ${hull} ${key}`, { timeout: 120_000 }, () => expect(forecast(hull, key)).toBe(TORPEDO_GOLDEN_PRE[`forecast:${hull}:${key}`]));
    }
  }
  it("patrol carrier Warband Defensive", { timeout: 120_000 }, () =>
    expect(torpedoPatrolRow("carrier", "crimsonReaverWarband", "standoff", null)).toEqual(TORPEDO_GOLDEN_PRE["patrol:carrier:warband:standoff"]));
  for (const k of CURVE) {
    it(`patrol destroyer Sweep on the curve (${k} completed)`, { timeout: 120_000 }, () =>
      expect(torpedoPatrolRow("destroyer", "crimsonReaverSweep", "balanced", k)).toEqual(TORPEDO_GOLDEN_PRE[`patrol:destroyer:sweep:c${k}`]));
  }
  it("ship battles by tier", { timeout: 120_000 }, () => {
    const exp = torpedoRun();
    for (const tier of TIERS) expect(torpedoTierRow(exp, tier), `tier ${tier}`).toBe(TORPEDO_GOLDEN_PRE[`tier:${tier}`]);
  });
  for (const hull of EXPLORERS) {
    for (const seed of RUN_SEEDS) {
      it(`ship events ${hull} ${seed ?? "default"}`, { timeout: 300_000 }, () => expect(shipEventRow(hull, seed)).toEqual(TORPEDO_GOLDEN_PRE[`shipEvent:${hull}:${seed ?? "default"}`]));
    }
  }
});
