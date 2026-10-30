// OC-D8 FOLLOW-UP GOLDENS (plan docs/plans/2026-10-15-wiring-registry-and-audit-plan.md, "USER ANSWERS (2026-10-30):
// OC-D8 patrol legs follow-up"): two readings captured on feat 336db4a BEFORE the follow-up (LIFTS_PINS_PRE).
//
// 1. FAST DEPARTURE / FAST RETURN ON PATROLS ("Yes, each its own leg"). Every patrol on every combat hull, through the
//    live engine (1 s economyTick steps), with a Flight Deck complement of LIFT_HEADS crew rolled on Fast Departure
//    (`out`), Fast Return (`back`) or one bucket of each (`both`):
//      once     : Dispatch Once to its end: the mission as dispatched, the phase timeline, the ending and the end state.
//      inFlight : the same run with the cycle's legs set back to the ship's sheet speed alone (a cycle dispatched before
//                 the lifts reached patrols). It must keep the pre-change pins.
//      repeat   : a Repeat run for REPEAT_SECONDS (relaunches included): the whole state at the end.
//      replay   : the display replay of the first cycle, read right after dispatch.
// 2. THE CONSTITUTION RUN CLOCK (tick.ts runHours, the review finding). A Repeat run with a high-Constitution pilot
//    (the Flight Deck's return cut) and tactical officer (the relaunch's battle ramp):
//      constSteady : a run whose cycles all fly one route length.
//      constMixed  : the same run whose first cycle flies the route's own legs (a cycle in flight from before OC-D8)
//                    and whose relaunches freeze the ship's: a run that mixes cycle lengths.
//    Each row: the trace of every relaunch (routes flown, the new cycle's return cut, its frozen battle bonuses) and the
//    whole state at the end.

import { PATROLS, patrolLegTicksFor, type GameState, type OfficerStats, type PatrolKey, type PatrolMissionState, type ShipTypeKey } from "./model";
import { replayPatrol } from "./combat/patrolReplay";
import { dispatchCaptainOnPatrol, economyTick } from "./tick";
import { effectiveShipStats } from "./crewOverlay";
import { hash, stateHash } from "./firstRunsGoldens.fixture";
import { LEGS_HULLS, LEGS_ROUTES, asPreLegs, inFlightWaves, legsBase, legsOnceRow, legsRepeatState } from "./patrolLegsGoldens.fixture";
import { bucketOf, seatOfficer, withBuckets } from "./wiring/probes";

const RNG = (): number => 0.5;
const must = (ok: boolean, what: string): void => {
  if (!ok) throw new Error(`patrol leg lifts goldens: ${what}`);
};

export const LIFTS_HULLS = LEGS_HULLS;
export const LIFTS_ROUTES = LEGS_ROUTES;
export type LiftsCrew = "out" | "back" | "both";
export const LIFTS_CREWS: readonly LiftsCrew[] = ["out", "back", "both"];
// A full Flight Deck bucket: +12% on its leg (0.002 per head, linear).
export const LIFT_HEADS = 60;
export const REPEAT_SECONDS = 200;

export function liftsBase(hull: ShipTypeKey, crew: LiftsCrew): GameState {
  const s = legsBase(hull, "bare");
  const buckets = [
    ...(crew !== "back" ? [bucketOf("flightDeck", "flight.transitOut", LIFT_HEADS)] : []),
    ...(crew !== "out" ? [bucketOf("flightDeck", "flight.transitBack", LIFT_HEADS)] : []),
  ];
  return withBuckets(s, buckets);
}

export function liftsDispatch(hull: ShipTypeKey, route: PatrolKey, crew: LiftsCrew, repeat: boolean): GameState {
  const r = dispatchCaptainOnPatrol(liftsBase(hull, crew), 1, route, "balanced", repeat);
  must(r.success, `${hull} ${route} ${crew}: ${r.reason}`);
  return r.next;
}

// The legs the ship's sheet speed alone freezes (patrolLegTicksFor with the speed only: the OC-D8 rule before the lifts).
export function speedOnlyLegs(s: GameState): { out: number; back: number } | undefined {
  const m = s.captains[0].mission as PatrolMissionState;
  return patrolLegTicksFor(PATROLS[m.patrolKey], effectiveShipStats(s, s.ships[0]).transitSpeedMult);
}

// A cycle as dispatched before the lifts reached patrols: captain 1's patrol with the legs its sheet speed alone gives
// (none when they are the route's) and the wave schedule shifted onto that outbound leg.
export function asPreLifts(s: GameState): GameState {
  const m = s.captains[0].mission as PatrolMissionState;
  const def = PATROLS[m.patrolKey];
  const legs = speedOnlyLegs(s);
  const shift = (legs?.out ?? def.transitOutTicks) - (m.legTicks?.out ?? def.transitOutTicks);
  const waveTicks = m.waveTicks.map((t) => t + shift);
  const bare = asPreLegs(s, waveTicks);
  if (legs === undefined) return bare;
  return {
    ...bare,
    captains: bare.captains.map((c, i) => (i === 0 && c.mission !== null ? { ...c, mission: { ...(c.mission as PatrolMissionState), legTicks: { ...legs } } } : c)),
  };
}

export function liftsRows(): Record<string, unknown> {
  const got: Record<string, unknown> = {};
  for (const hull of LIFTS_HULLS) {
    for (const route of LIFTS_ROUTES) {
      for (const crew of LIFTS_CREWS) {
        const key = `${hull}:${route}:${crew}`;
        const once = liftsDispatch(hull, route, crew, false);
        got[`once:${key}`] = legsOnceRow(once);
        got[`inFlight:${key}`] = legsOnceRow(asPreLifts(once));
        got[`repeat:${key}`] = stateHash(legsRepeatState(liftsDispatch(hull, route, crew, true), REPEAT_SECONDS));
        got[`replay:${key}`] = hash(replayPatrol(once, once.captains[0]));
      }
    }
  }
  return got;
}

// ---- 2. the Constitution run clock ----------------------------------------------------------------------------------

export const CONST_HULLS: readonly ShipTypeKey[] = ["battleship", "carrier", "prospectorHauler", "destroyer"];
export const CONST_SECONDS = 400;
const HIGH: OfficerStats = { strength: 10, integrity: 10, cunning: 10, constitution: 20 };

export function constBase(hull: ShipTypeKey): GameState {
  let s = legsBase(hull, "bare");
  s = seatOfficer(s, "pilot", [], { stats: HIGH });
  s = seatOfficer(s, "tactical", ["tac.weaponCommand"], { stats: HIGH });
  return s;
}

export function constDispatch(hull: ShipTypeKey, route: PatrolKey, mixed: boolean): GameState {
  const r = dispatchCaptainOnPatrol(constBase(hull), 1, route, "balanced", true);
  must(r.success, `${hull} ${route} const: ${r.reason}`);
  return mixed ? asPreLegs(r.next, inFlightWaves(r.next)) : r.next;
}

// Every relaunch over `seconds` 1 s steps: "routes:returnCut:officerCombat", then the end state.
export function constRow(start: GameState, seconds = CONST_SECONDS): string[] {
  const trace: string[] = [];
  let s = start;
  let routes = (s.captains[0].mission as PatrolMissionState).routesCompletedThisRun;
  for (let i = 0; i < seconds && s.captains[0].mission !== null; i++) {
    s = economyTick(s, 1, RNG);
    const m = s.captains[0].mission as PatrolMissionState | null;
    if (m !== null && m.routesCompletedThisRun !== routes) {
      routes = m.routesCompletedThisRun;
      trace.push(`${routes}:${m.returnCutTicks ?? 0}:${hash(m.officerCombat ?? null)}`);
    }
  }
  return [trace.join(","), stateHash(s)];
}

export function constRows(): Record<string, unknown> {
  const got: Record<string, unknown> = {};
  for (const hull of CONST_HULLS) {
    for (const route of LIFTS_ROUTES) {
      got[`constSteady:${hull}:${route}`] = constRow(constDispatch(hull, route, false));
      got[`constMixed:${hull}:${route}`] = constRow(constDispatch(hull, route, true));
    }
  }
  return got;
}

// Captured on feat 336db4a, before the follow-up.
export const LIFTS_PINS_PRE: Record<string, unknown> = {
  "once:generalFreighter:crimsonReaverSweep:out": ["e1c443c2","transitOut@0,engaging@3,transitBack@11","won:14","7261f11e"],
  "inFlight:generalFreighter:crimsonReaverSweep:out": ["e1c443c2","transitOut@0,engaging@3,transitBack@11","won:14","7261f11e"],
  "repeat:generalFreighter:crimsonReaverSweep:out": "205740c4",
  "replay:generalFreighter:crimsonReaverSweep:out": "597c09a2",
  "once:generalFreighter:crimsonReaverSweep:back": ["e1c443c2","transitOut@0,engaging@3,transitBack@11","won:14","48c9fe5f"],
  "inFlight:generalFreighter:crimsonReaverSweep:back": ["e1c443c2","transitOut@0,engaging@3,transitBack@11","won:14","48c9fe5f"],
  "repeat:generalFreighter:crimsonReaverSweep:back": "9b2962d",
  "replay:generalFreighter:crimsonReaverSweep:back": "597c09a2",
  "once:generalFreighter:crimsonReaverSweep:both": ["e1c443c2","transitOut@0,engaging@3,transitBack@11","won:14","d5437dac"],
  "inFlight:generalFreighter:crimsonReaverSweep:both": ["e1c443c2","transitOut@0,engaging@3,transitBack@11","won:14","d5437dac"],
  "repeat:generalFreighter:crimsonReaverSweep:both": "81eaebb6",
  "replay:generalFreighter:crimsonReaverSweep:both": "597c09a2",
  "once:generalFreighter:crimsonReaverWarband:out": ["de9c6e20","transitOut@0,engaging@5,limpingHome@10","lost:20","5a74397e"],
  "inFlight:generalFreighter:crimsonReaverWarband:out": ["de9c6e20","transitOut@0,engaging@5,limpingHome@10","lost:20","5a74397e"],
  "repeat:generalFreighter:crimsonReaverWarband:out": "e5bd9a4e",
  "replay:generalFreighter:crimsonReaverWarband:out": "3bc66d4f",
  "once:generalFreighter:crimsonReaverWarband:back": ["de9c6e20","transitOut@0,engaging@5,limpingHome@10","lost:20","2d37ff41"],
  "inFlight:generalFreighter:crimsonReaverWarband:back": ["de9c6e20","transitOut@0,engaging@5,limpingHome@10","lost:20","2d37ff41"],
  "repeat:generalFreighter:crimsonReaverWarband:back": "786886ef",
  "replay:generalFreighter:crimsonReaverWarband:back": "3bc66d4f",
  "once:generalFreighter:crimsonReaverWarband:both": ["de9c6e20","transitOut@0,engaging@5,limpingHome@10","lost:20","cefd1950"],
  "inFlight:generalFreighter:crimsonReaverWarband:both": ["de9c6e20","transitOut@0,engaging@5,limpingHome@10","lost:20","cefd1950"],
  "repeat:generalFreighter:crimsonReaverWarband:both": "a153c710",
  "replay:generalFreighter:crimsonReaverWarband:both": "3bc66d4f",
  "once:prospectorHauler:crimsonReaverSweep:out": ["a52be404","transitOut@0,engaging@4,transitBack@12","won:16","30f29ae3"],
  "inFlight:prospectorHauler:crimsonReaverSweep:out": ["a52be404","transitOut@0,engaging@4,transitBack@12","won:16","30f29ae3"],
  "repeat:prospectorHauler:crimsonReaverSweep:out": "9c762ecc",
  "replay:prospectorHauler:crimsonReaverSweep:out": "60ff4d64",
  "once:prospectorHauler:crimsonReaverSweep:back": ["a52be404","transitOut@0,engaging@4,transitBack@12","won:16","72881e5a"],
  "inFlight:prospectorHauler:crimsonReaverSweep:back": ["a52be404","transitOut@0,engaging@4,transitBack@12","won:16","72881e5a"],
  "repeat:prospectorHauler:crimsonReaverSweep:back": "a2aaa2b",
  "replay:prospectorHauler:crimsonReaverSweep:back": "60ff4d64",
  "once:prospectorHauler:crimsonReaverSweep:both": ["a52be404","transitOut@0,engaging@4,transitBack@12","won:16","d600defd"],
  "inFlight:prospectorHauler:crimsonReaverSweep:both": ["a52be404","transitOut@0,engaging@4,transitBack@12","won:16","d600defd"],
  "repeat:prospectorHauler:crimsonReaverSweep:both": "3d515f7a",
  "replay:prospectorHauler:crimsonReaverSweep:both": "60ff4d64",
  "once:prospectorHauler:crimsonReaverWarband:out": ["76ec3286","transitOut@0,engaging@7,limpingHome@15","lost:29","403af2f5"],
  "inFlight:prospectorHauler:crimsonReaverWarband:out": ["76ec3286","transitOut@0,engaging@7,limpingHome@15","lost:29","403af2f5"],
  "repeat:prospectorHauler:crimsonReaverWarband:out": "b920488c",
  "replay:prospectorHauler:crimsonReaverWarband:out": "77e1fcff",
  "once:prospectorHauler:crimsonReaverWarband:back": ["76ec3286","transitOut@0,engaging@7,limpingHome@15","lost:29","811988a4"],
  "inFlight:prospectorHauler:crimsonReaverWarband:back": ["76ec3286","transitOut@0,engaging@7,limpingHome@15","lost:29","811988a4"],
  "repeat:prospectorHauler:crimsonReaverWarband:back": "a6d9b2eb",
  "replay:prospectorHauler:crimsonReaverWarband:back": "77e1fcff",
  "once:prospectorHauler:crimsonReaverWarband:both": ["76ec3286","transitOut@0,engaging@7,limpingHome@15","lost:29","2740dce7"],
  "inFlight:prospectorHauler:crimsonReaverWarband:both": ["76ec3286","transitOut@0,engaging@7,limpingHome@15","lost:29","2740dce7"],
  "repeat:prospectorHauler:crimsonReaverWarband:both": "48916cfe",
  "replay:prospectorHauler:crimsonReaverWarband:both": "77e1fcff",
  "once:prospectorRunner:crimsonReaverSweep:out": ["901a9754","transitOut@0,engaging@2,limpingHome@3","lost:7","368ddb45"],
  "inFlight:prospectorRunner:crimsonReaverSweep:out": ["901a9754","transitOut@0,engaging@2,limpingHome@3","lost:7","368ddb45"],
  "repeat:prospectorRunner:crimsonReaverSweep:out": "f70c71ca",
  "replay:prospectorRunner:crimsonReaverSweep:out": "c35698d3",
  "once:prospectorRunner:crimsonReaverSweep:back": ["901a9754","transitOut@0,engaging@2,limpingHome@3","lost:7","f9e2cd26"],
  "inFlight:prospectorRunner:crimsonReaverSweep:back": ["901a9754","transitOut@0,engaging@2,limpingHome@3","lost:7","f9e2cd26"],
  "repeat:prospectorRunner:crimsonReaverSweep:back": "93e4295d",
  "replay:prospectorRunner:crimsonReaverSweep:back": "c35698d3",
  "once:prospectorRunner:crimsonReaverSweep:both": ["901a9754","transitOut@0,engaging@2,limpingHome@3","lost:7","26d7df9f"],
  "inFlight:prospectorRunner:crimsonReaverSweep:both": ["901a9754","transitOut@0,engaging@2,limpingHome@3","lost:7","26d7df9f"],
  "repeat:prospectorRunner:crimsonReaverSweep:both": "aa3ccf40",
  "replay:prospectorRunner:crimsonReaverSweep:both": "c35698d3",
  "once:prospectorRunner:crimsonReaverWarband:out": ["9bbff306","transitOut@0,engaging@4,limpingHome@9","lost:17","3f410de2"],
  "inFlight:prospectorRunner:crimsonReaverWarband:out": ["9bbff306","transitOut@0,engaging@4,limpingHome@9","lost:17","3f410de2"],
  "repeat:prospectorRunner:crimsonReaverWarband:out": "ee3a2365",
  "replay:prospectorRunner:crimsonReaverWarband:out": "ff4b0126",
  "once:prospectorRunner:crimsonReaverWarband:back": ["9bbff306","transitOut@0,engaging@4,limpingHome@9","lost:17","6b7e1e1f"],
  "inFlight:prospectorRunner:crimsonReaverWarband:back": ["9bbff306","transitOut@0,engaging@4,limpingHome@9","lost:17","6b7e1e1f"],
  "repeat:prospectorRunner:crimsonReaverWarband:back": "48938278",
  "replay:prospectorRunner:crimsonReaverWarband:back": "ff4b0126",
  "once:prospectorRunner:crimsonReaverWarband:both": ["9bbff306","transitOut@0,engaging@4,limpingHome@9","lost:17","5b7178f4"],
  "inFlight:prospectorRunner:crimsonReaverWarband:both": ["9bbff306","transitOut@0,engaging@4,limpingHome@9","lost:17","5b7178f4"],
  "repeat:prospectorRunner:crimsonReaverWarband:both": "8a2525b",
  "replay:prospectorRunner:crimsonReaverWarband:both": "ff4b0126",
  "once:prospectorMiner:crimsonReaverSweep:out": ["d1819c8","transitOut@0,engaging@3,limpingHome@4","lost:10","567c17fd"],
  "inFlight:prospectorMiner:crimsonReaverSweep:out": ["d1819c8","transitOut@0,engaging@3,limpingHome@4","lost:10","567c17fd"],
  "repeat:prospectorMiner:crimsonReaverSweep:out": "77c6049f",
  "replay:prospectorMiner:crimsonReaverSweep:out": "1b2af2bc",
  "once:prospectorMiner:crimsonReaverSweep:back": ["d1819c8","transitOut@0,engaging@3,limpingHome@4","lost:10","ae2b6b46"],
  "inFlight:prospectorMiner:crimsonReaverSweep:back": ["d1819c8","transitOut@0,engaging@3,limpingHome@4","lost:10","ae2b6b46"],
  "repeat:prospectorMiner:crimsonReaverSweep:back": "f818f060",
  "replay:prospectorMiner:crimsonReaverSweep:back": "1b2af2bc",
  "once:prospectorMiner:crimsonReaverSweep:both": ["d1819c8","transitOut@0,engaging@3,limpingHome@4","lost:10","f9a5ccfb"],
  "inFlight:prospectorMiner:crimsonReaverSweep:both": ["d1819c8","transitOut@0,engaging@3,limpingHome@4","lost:10","f9a5ccfb"],
  "repeat:prospectorMiner:crimsonReaverSweep:both": "69c0b851",
  "replay:prospectorMiner:crimsonReaverSweep:both": "1b2af2bc",
  "once:prospectorMiner:crimsonReaverWarband:out": ["71b9d842","transitOut@0,engaging@5,limpingHome@10","lost:20","239050c3"],
  "inFlight:prospectorMiner:crimsonReaverWarband:out": ["71b9d842","transitOut@0,engaging@5,limpingHome@10","lost:20","239050c3"],
  "repeat:prospectorMiner:crimsonReaverWarband:out": "b7e9f7e1",
  "replay:prospectorMiner:crimsonReaverWarband:out": "8774e398",
  "once:prospectorMiner:crimsonReaverWarband:back": ["71b9d842","transitOut@0,engaging@5,limpingHome@10","lost:20","93fcd0a"],
  "inFlight:prospectorMiner:crimsonReaverWarband:back": ["71b9d842","transitOut@0,engaging@5,limpingHome@10","lost:20","93fcd0a"],
  "repeat:prospectorMiner:crimsonReaverWarband:back": "3b8d1280",
  "replay:prospectorMiner:crimsonReaverWarband:back": "8774e398",
  "once:prospectorMiner:crimsonReaverWarband:both": ["71b9d842","transitOut@0,engaging@5,limpingHome@10","lost:20","fb157a91"],
  "inFlight:prospectorMiner:crimsonReaverWarband:both": ["71b9d842","transitOut@0,engaging@5,limpingHome@10","lost:20","fb157a91"],
  "repeat:prospectorMiner:crimsonReaverWarband:both": "30fbed47",
  "replay:prospectorMiner:crimsonReaverWarband:both": "8774e398",
  "once:destroyer:crimsonReaverSweep:out": ["c478f282","transitOut@0,engaging@3,transitBack@11","won:14","5723eb1c"],
  "inFlight:destroyer:crimsonReaverSweep:out": ["c478f282","transitOut@0,engaging@3,transitBack@11","won:14","5723eb1c"],
  "repeat:destroyer:crimsonReaverSweep:out": "3fcfee7b",
  "replay:destroyer:crimsonReaverSweep:out": "ba2ee129",
  "once:destroyer:crimsonReaverSweep:back": ["c478f282","transitOut@0,engaging@3,transitBack@11","won:14","4da47307"],
  "inFlight:destroyer:crimsonReaverSweep:back": ["c478f282","transitOut@0,engaging@3,transitBack@11","won:14","4da47307"],
  "repeat:destroyer:crimsonReaverSweep:back": "1049e886",
  "replay:destroyer:crimsonReaverSweep:back": "ba2ee129",
  "once:destroyer:crimsonReaverSweep:both": ["c478f282","transitOut@0,engaging@3,transitBack@11","won:14","fc2214be"],
  "inFlight:destroyer:crimsonReaverSweep:both": ["c478f282","transitOut@0,engaging@3,transitBack@11","won:14","fc2214be"],
  "repeat:destroyer:crimsonReaverSweep:both": "b36bb2bd",
  "replay:destroyer:crimsonReaverSweep:both": "ba2ee129",
  "once:destroyer:crimsonReaverWarband:out": ["4912f49d","transitOut@0,engaging@4,transitBack@16","won:20","7cec81dd"],
  "inFlight:destroyer:crimsonReaverWarband:out": ["4912f49d","transitOut@0,engaging@4,transitBack@16","won:20","7cec81dd"],
  "repeat:destroyer:crimsonReaverWarband:out": "b96268e6",
  "replay:destroyer:crimsonReaverWarband:out": "8ce2a37d",
  "once:destroyer:crimsonReaverWarband:back": ["4912f49d","transitOut@0,engaging@4,transitBack@16","won:20","202dd846"],
  "inFlight:destroyer:crimsonReaverWarband:back": ["4912f49d","transitOut@0,engaging@4,transitBack@16","won:20","202dd846"],
  "repeat:destroyer:crimsonReaverWarband:back": "da39bf93",
  "replay:destroyer:crimsonReaverWarband:back": "8ce2a37d",
  "once:destroyer:crimsonReaverWarband:both": ["4912f49d","transitOut@0,engaging@4,transitBack@16","won:20","a7c31093"],
  "inFlight:destroyer:crimsonReaverWarband:both": ["4912f49d","transitOut@0,engaging@4,transitBack@16","won:20","a7c31093"],
  "repeat:destroyer:crimsonReaverWarband:both": "54749ea4",
  "replay:destroyer:crimsonReaverWarband:both": "8ce2a37d",
  "once:battleship:crimsonReaverSweep:out": ["d148adf6","transitOut@0,engaging@5,transitBack@13","won:18","90a165e1"],
  "inFlight:battleship:crimsonReaverSweep:out": ["d148adf6","transitOut@0,engaging@5,transitBack@13","won:18","90a165e1"],
  "repeat:battleship:crimsonReaverSweep:out": "5b7f675f",
  "replay:battleship:crimsonReaverSweep:out": "1ce1681f",
  "once:battleship:crimsonReaverSweep:back": ["d148adf6","transitOut@0,engaging@5,transitBack@13","won:18","dc3100ae"],
  "inFlight:battleship:crimsonReaverSweep:back": ["d148adf6","transitOut@0,engaging@5,transitBack@13","won:18","dc3100ae"],
  "repeat:battleship:crimsonReaverSweep:back": "42089a2c",
  "replay:battleship:crimsonReaverSweep:back": "1ce1681f",
  "once:battleship:crimsonReaverSweep:both": ["d148adf6","transitOut@0,engaging@5,transitBack@13","won:18","52a83b97"],
  "inFlight:battleship:crimsonReaverSweep:both": ["d148adf6","transitOut@0,engaging@5,transitBack@13","won:18","52a83b97"],
  "repeat:battleship:crimsonReaverSweep:both": "cb1596bd",
  "replay:battleship:crimsonReaverSweep:both": "1ce1681f",
  "once:battleship:crimsonReaverWarband:out": ["e60947f4","transitOut@0,engaging@8,transitBack@20","won:28","aa989c2d"],
  "inFlight:battleship:crimsonReaverWarband:out": ["e60947f4","transitOut@0,engaging@8,transitBack@20","won:28","aa989c2d"],
  "repeat:battleship:crimsonReaverWarband:out": "a6cac848",
  "replay:battleship:crimsonReaverWarband:out": "ed71e279",
  "once:battleship:crimsonReaverWarband:back": ["e60947f4","transitOut@0,engaging@8,transitBack@20","won:28","9d33816a"],
  "inFlight:battleship:crimsonReaverWarband:back": ["e60947f4","transitOut@0,engaging@8,transitBack@20","won:28","9d33816a"],
  "repeat:battleship:crimsonReaverWarband:back": "3212197d",
  "replay:battleship:crimsonReaverWarband:back": "ed71e279",
  "once:battleship:crimsonReaverWarband:both": ["e60947f4","transitOut@0,engaging@8,transitBack@20","won:28","a7ba717"],
  "inFlight:battleship:crimsonReaverWarband:both": ["e60947f4","transitOut@0,engaging@8,transitBack@20","won:28","a7ba717"],
  "repeat:battleship:crimsonReaverWarband:both": "df6274c6",
  "replay:battleship:crimsonReaverWarband:both": "ed71e279",
  "once:carrier:crimsonReaverSweep:out": ["9bd2011","transitOut@0,engaging@4,transitBack@12","won:16","cb17f1dd"],
  "inFlight:carrier:crimsonReaverSweep:out": ["9bd2011","transitOut@0,engaging@4,transitBack@12","won:16","cb17f1dd"],
  "repeat:carrier:crimsonReaverSweep:out": "f524e216",
  "replay:carrier:crimsonReaverSweep:out": "e3cb8ac2",
  "once:carrier:crimsonReaverSweep:back": ["9bd2011","transitOut@0,engaging@4,transitBack@12","won:16","d2fd1b42"],
  "inFlight:carrier:crimsonReaverSweep:back": ["9bd2011","transitOut@0,engaging@4,transitBack@12","won:16","d2fd1b42"],
  "repeat:carrier:crimsonReaverSweep:back": "1382a035",
  "replay:carrier:crimsonReaverSweep:back": "e3cb8ac2",
  "once:carrier:crimsonReaverSweep:both": ["fb766111","transitOut@0,engaging@4,transitBack@12","won:16","ff5f408b"],
  "inFlight:carrier:crimsonReaverSweep:both": ["fb766111","transitOut@0,engaging@4,transitBack@12","won:16","ff5f408b"],
  "repeat:carrier:crimsonReaverSweep:both": "21178b0c",
  "replay:carrier:crimsonReaverSweep:both": "a99d002e",
  "once:carrier:crimsonReaverWarband:out": ["541f90e7","transitOut@0,engaging@7,transitBack@19","won:26","24efa2b"],
  "inFlight:carrier:crimsonReaverWarband:out": ["541f90e7","transitOut@0,engaging@7,transitBack@19","won:26","24efa2b"],
  "repeat:carrier:crimsonReaverWarband:out": "6c296e38",
  "replay:carrier:crimsonReaverWarband:out": "a4568b9e",
  "once:carrier:crimsonReaverWarband:back": ["541f90e7","transitOut@0,engaging@7,transitBack@19","won:26","dffe0364"],
  "inFlight:carrier:crimsonReaverWarband:back": ["541f90e7","transitOut@0,engaging@7,transitBack@19","won:26","dffe0364"],
  "repeat:carrier:crimsonReaverWarband:back": "fcd628bf",
  "replay:carrier:crimsonReaverWarband:back": "a4568b9e",
  "once:carrier:crimsonReaverWarband:both": ["4343f847","transitOut@0,engaging@7,transitBack@19","won:26","f28a1991"],
  "inFlight:carrier:crimsonReaverWarband:both": ["4343f847","transitOut@0,engaging@7,transitBack@19","won:26","f28a1991"],
  "repeat:carrier:crimsonReaverWarband:both": "1f305710",
  "replay:carrier:crimsonReaverWarband:both": "752ee160",
  "once:orion:crimsonReaverSweep:out": ["96307d3","transitOut@0,engaging@3,transitBack@11","won:14","fbd2a5eb"],
  "inFlight:orion:crimsonReaverSweep:out": ["96307d3","transitOut@0,engaging@3,transitBack@11","won:14","fbd2a5eb"],
  "repeat:orion:crimsonReaverSweep:out": "ab751fd1",
  "replay:orion:crimsonReaverSweep:out": "f6d6af33",
  "once:orion:crimsonReaverSweep:back": ["96307d3","transitOut@0,engaging@3,transitBack@11","won:14","b9e15b14"],
  "inFlight:orion:crimsonReaverSweep:back": ["96307d3","transitOut@0,engaging@3,transitBack@11","won:14","b9e15b14"],
  "repeat:orion:crimsonReaverSweep:back": "63017b2c",
  "replay:orion:crimsonReaverSweep:back": "f6d6af33",
  "once:orion:crimsonReaverSweep:both": ["96307d3","transitOut@0,engaging@3,transitBack@11","won:14","8a94a581"],
  "inFlight:orion:crimsonReaverSweep:both": ["96307d3","transitOut@0,engaging@3,transitBack@11","won:14","8a94a581"],
  "repeat:orion:crimsonReaverSweep:both": "8c19befb",
  "replay:orion:crimsonReaverSweep:both": "f6d6af33",
  "once:orion:crimsonReaverWarband:out": ["44b24d79","transitOut@0,engaging@5,limpingHome@10","lost:20","f658ee66"],
  "inFlight:orion:crimsonReaverWarband:out": ["44b24d79","transitOut@0,engaging@5,limpingHome@10","lost:20","f658ee66"],
  "repeat:orion:crimsonReaverWarband:out": "f7835c12",
  "replay:orion:crimsonReaverWarband:out": "acbf2a27",
  "once:orion:crimsonReaverWarband:back": ["44b24d79","transitOut@0,engaging@5,limpingHome@10","lost:20","2b540865"],
  "inFlight:orion:crimsonReaverWarband:back": ["44b24d79","transitOut@0,engaging@5,limpingHome@10","lost:20","2b540865"],
  "repeat:orion:crimsonReaverWarband:back": "c41cf245",
  "replay:orion:crimsonReaverWarband:back": "acbf2a27",
  "once:orion:crimsonReaverWarband:both": ["44b24d79","transitOut@0,engaging@5,limpingHome@10","lost:20","c44dfa24"],
  "inFlight:orion:crimsonReaverWarband:both": ["44b24d79","transitOut@0,engaging@5,limpingHome@10","lost:20","c44dfa24"],
  "repeat:orion:crimsonReaverWarband:both": "1fe6c310",
  "replay:orion:crimsonReaverWarband:both": "acbf2a27",
  "once:aurora:crimsonReaverSweep:out": ["6335977c","transitOut@0,engaging@3,transitBack@11","won:14","f966514e"],
  "inFlight:aurora:crimsonReaverSweep:out": ["6335977c","transitOut@0,engaging@3,transitBack@11","won:14","f966514e"],
  "repeat:aurora:crimsonReaverSweep:out": "695a1f98",
  "replay:aurora:crimsonReaverSweep:out": "6eeaff13",
  "once:aurora:crimsonReaverSweep:back": ["6335977c","transitOut@0,engaging@3,transitBack@11","won:14","fefcdc3b"],
  "inFlight:aurora:crimsonReaverSweep:back": ["6335977c","transitOut@0,engaging@3,transitBack@11","won:14","fefcdc3b"],
  "repeat:aurora:crimsonReaverSweep:back": "797b8c41",
  "replay:aurora:crimsonReaverSweep:back": "6eeaff13",
  "once:aurora:crimsonReaverSweep:both": ["6335977c","transitOut@0,engaging@3,transitBack@11","won:14","173dfdcc"],
  "inFlight:aurora:crimsonReaverSweep:both": ["6335977c","transitOut@0,engaging@3,transitBack@11","won:14","173dfdcc"],
  "repeat:aurora:crimsonReaverSweep:both": "ed8492aa",
  "replay:aurora:crimsonReaverSweep:both": "6eeaff13",
  "once:aurora:crimsonReaverWarband:out": ["b311cb5b","transitOut@0,engaging@4,limpingHome@9","lost:17","23d73da7"],
  "inFlight:aurora:crimsonReaverWarband:out": ["b311cb5b","transitOut@0,engaging@4,limpingHome@9","lost:17","23d73da7"],
  "repeat:aurora:crimsonReaverWarband:out": "decff8a9",
  "replay:aurora:crimsonReaverWarband:out": "9bf414a8",
  "once:aurora:crimsonReaverWarband:back": ["b311cb5b","transitOut@0,engaging@4,limpingHome@9","lost:17","afd61fac"],
  "inFlight:aurora:crimsonReaverWarband:back": ["b311cb5b","transitOut@0,engaging@4,limpingHome@9","lost:17","afd61fac"],
  "repeat:aurora:crimsonReaverWarband:back": "e06f7d20",
  "replay:aurora:crimsonReaverWarband:back": "9bf414a8",
  "once:aurora:crimsonReaverWarband:both": ["b311cb5b","transitOut@0,engaging@4,limpingHome@9","lost:17","7405b845"],
  "inFlight:aurora:crimsonReaverWarband:both": ["b311cb5b","transitOut@0,engaging@4,limpingHome@9","lost:17","7405b845"],
  "repeat:aurora:crimsonReaverWarband:both": "109c8beb",
  "replay:aurora:crimsonReaverWarband:both": "9bf414a8",
  "once:eir:crimsonReaverSweep:out": ["4296d6b5","transitOut@0,engaging@4,transitBack@12","won:16","6f0842fb"],
  "inFlight:eir:crimsonReaverSweep:out": ["4296d6b5","transitOut@0,engaging@4,transitBack@12","won:16","6f0842fb"],
  "repeat:eir:crimsonReaverSweep:out": "e1488103",
  "replay:eir:crimsonReaverSweep:out": "d6f1f07e",
  "once:eir:crimsonReaverSweep:back": ["4296d6b5","transitOut@0,engaging@4,transitBack@12","won:16","878363de"],
  "inFlight:eir:crimsonReaverSweep:back": ["4296d6b5","transitOut@0,engaging@4,transitBack@12","won:16","878363de"],
  "repeat:eir:crimsonReaverSweep:back": "14654ea4",
  "replay:eir:crimsonReaverSweep:back": "d6f1f07e",
  "once:eir:crimsonReaverSweep:both": ["4296d6b5","transitOut@0,engaging@4,transitBack@12","won:16","97833afd"],
  "inFlight:eir:crimsonReaverSweep:both": ["4296d6b5","transitOut@0,engaging@4,transitBack@12","won:16","97833afd"],
  "repeat:eir:crimsonReaverSweep:both": "36190a1",
  "replay:eir:crimsonReaverSweep:both": "d6f1f07e",
  "once:eir:crimsonReaverWarband:out": ["507ffe96","transitOut@0,engaging@6,limpingHome@11","lost:23","3db10f0e"],
  "inFlight:eir:crimsonReaverWarband:out": ["507ffe96","transitOut@0,engaging@6,limpingHome@11","lost:23","3db10f0e"],
  "repeat:eir:crimsonReaverWarband:out": "70ee84f0",
  "replay:eir:crimsonReaverWarband:out": "9f6fc320",
  "once:eir:crimsonReaverWarband:back": ["507ffe96","transitOut@0,engaging@6,limpingHome@11","lost:23","6e078ef7"],
  "inFlight:eir:crimsonReaverWarband:back": ["507ffe96","transitOut@0,engaging@6,limpingHome@11","lost:23","6e078ef7"],
  "repeat:eir:crimsonReaverWarband:back": "4c3c93bf",
  "replay:eir:crimsonReaverWarband:back": "9f6fc320",
  "once:eir:crimsonReaverWarband:both": ["507ffe96","transitOut@0,engaging@6,limpingHome@11","lost:23","eb5c09a4"],
  "inFlight:eir:crimsonReaverWarband:both": ["507ffe96","transitOut@0,engaging@6,limpingHome@11","lost:23","eb5c09a4"],
  "repeat:eir:crimsonReaverWarband:both": "32d7b106",
  "replay:eir:crimsonReaverWarband:both": "9f6fc320",
  "constSteady:battleship:crimsonReaverSweep": ["1:0:b300acb1,2:0:f1740f6e,3:0:7fc75f9c,4:0:55e75f51,5:0:2dbe2342,6:0:29fd8961,7:0:9915b662,8:0:d318a7ca,9:0:b0068655,10:0:2539a6b0,11:0:189a6c95,12:0:650311f,13:0:b03c09dd,14:0:8281c026,15:0:bcebef1c,16:0:3ee0de7f,17:0:eb375f1d,18:0:37ae1efa,19:0:e39df9f4,20:0:2f0d644a,21:0:8778838a,22:0:770efac1","6784b263"],
  "constMixed:battleship:crimsonReaverSweep": ["1:0:be19e8ce,2:0:f1740f6e,3:0:7fc75f9c,4:0:55e75f51,5:0:2dbe2342,6:0:29fd8961,7:0:9915b662,8:0:d318a7ca,9:0:b0068655,10:0:2539a6b0,11:0:189a6c95,12:0:650311f,13:0:b03c09dd,14:0:8281c026,15:0:bcebef1c,16:0:3ee0de7f,17:0:eb375f1d,18:0:37ae1efa,19:0:e39df9f4,20:0:2f0d644a,21:0:8778838a,22:0:770efac1","52997ca"],
  "constSteady:battleship:crimsonReaverWarband": ["1:0:9a0ad533,2:0:5258dd03,3:0:5258dd03","dd66bc69"],
  "constMixed:battleship:crimsonReaverWarband": ["1:0:8ae7544c,2:0:5258dd03,3:0:5258dd03","25499067"],
  "constSteady:carrier:crimsonReaverSweep": ["1:0:32561fee,2:0:b09cbc4c,3:0:198a2500,4:0:6e7fadb1,5:0:517d580b,6:0:41ffbc21,7:0:5caf7061,8:0:312de00,9:0:d318a7ca,10:0:86ee0d3f,11:0:a43c87f8,12:0:21a0c99,13:0:21a0c99","effb1f72"],
  "constMixed:carrier:crimsonReaverSweep": ["1:0:be19e8ce,2:0:b09cbc4c,3:0:198a2500,4:0:6e7fadb1,5:0:517d580b,6:0:41ffbc21,7:0:5caf7061,8:0:312de00,9:0:d318a7ca,10:0:86ee0d3f,11:0:a43c87f8,12:0:21a0c99,13:0:21a0c99","1fb99b1d"],
  "constSteady:carrier:crimsonReaverWarband": ["1:0:976feca2","8e4ed268"],
  "constMixed:carrier:crimsonReaverWarband": ["1:0:976feca2","f48f057e"],
  "constSteady:prospectorHauler:crimsonReaverSweep": ["1:0:32561fee,2:0:b09cbc4c,3:0:198a2500,4:0:6e7fadb1,5:0:517d580b,6:0:41ffbc21,7:0:41ffbc21","37b6b628"],
  "constMixed:prospectorHauler:crimsonReaverSweep": ["1:0:be19e8ce,2:0:b09cbc4c,3:0:198a2500,4:0:6e7fadb1,5:0:517d580b,6:0:41ffbc21,7:0:41ffbc21","24b18f60"],
  "constSteady:prospectorHauler:crimsonReaverWarband": ["1:0:976feca2","c4fe239d"],
  "constMixed:prospectorHauler:crimsonReaverWarband": ["1:0:976feca2","2dcaed2"],
  "constSteady:destroyer:crimsonReaverSweep": ["1:0:be19e8ce,2:0:9a0ad533,3:0:3c29654f,4:0:5258dd03,5:0:604df168,6:0:22eb173a,7:0:8eefa208,8:0:5caf7061,9:0:9915b662,10:0:9ca330a,11:0:69d5ea21,12:0:2a498d4d,13:0:cd3cc14e,14:0:cd3cc14e","8aeb5ae"],
  "constMixed:destroyer:crimsonReaverSweep": ["1:0:be19e8ce,2:0:9a0ad533,3:0:3c29654f,4:0:5258dd03,5:0:604df168,6:0:22eb173a,7:0:8eefa208,8:0:5caf7061,9:0:9915b662,10:0:9ca330a,11:0:69d5ea21,12:0:2a498d4d,13:0:cd3cc14e,14:0:cd3cc14e","8aeb5ae"],
  "constSteady:destroyer:crimsonReaverWarband": ["1:0:1e380c9e","ac875bec"],
  "constMixed:destroyer:crimsonReaverWarband": ["1:0:1e380c9e","ec446d82"],
};

// MOVED by the follow-up (re-pinned on the wiring commit), each returning to LIFTS_PINS_PRE with its switch off and
// traced in patrolLegLiftsGoldens.test.ts:
//   once / replay / repeat (56): the runs whose lifted legs round to other ticks than the sweeping speed's alone (7 of
//            20 hull and route pairs on each crew). `once`: the phases shift by the outbound leg's change, the ending
//            by both legs' (a lost run's limp home is twice the frozen return leg). `replay`: only an outbound lift
//            moves the waves' route ticks (Fast Return alone leaves the replay where it was). `repeat`: the same 200 s
//            fly other cycles. PATROL_LEG_LIFTS_SWITCH off: every one returns.
//   constMixed (4): the runs whose cycles fly different route lengths: from the second relaunch on, the clock sums
//            each cycle's own route ticks instead of routes x the current length, so the frozen battle bonuses and
//            the end state move. PATROL_RUN_CLOCK_SWITCH off: every one returns.
//   Held   : every inFlight row (a cycle in flight from before keeps the legs it froze), every constSteady row (a
//            run of one cycle length reads the old clock exactly and stores no routeTicksThisRun), and every run whose
//            lifted legs round back to the sweeping speed's.
export const LIFTS_PINS_MOVED: Record<string, unknown> = {
  "once:prospectorHauler:crimsonReaverWarband:out": ["59fbcc50","transitOut@0,engaging@6,limpingHome@14","lost:28","8f292e36"],
  "repeat:prospectorHauler:crimsonReaverWarband:out": "3ba03951",
  "replay:prospectorHauler:crimsonReaverWarband:out": "ab0997ea",
  "once:prospectorHauler:crimsonReaverWarband:back": ["e5f9682d","transitOut@0,engaging@7,limpingHome@15","lost:27","ad35dcd6"],
  "repeat:prospectorHauler:crimsonReaverWarband:back": "2f49fec8",
  "once:prospectorHauler:crimsonReaverWarband:both": ["c6797e3f","transitOut@0,engaging@6,limpingHome@14","lost:26","892db66e"],
  "repeat:prospectorHauler:crimsonReaverWarband:both": "e8f57ca4",
  "replay:prospectorHauler:crimsonReaverWarband:both": "ab0997ea",
  "once:prospectorRunner:crimsonReaverWarband:out": ["cd8b1b96","transitOut@0,engaging@3,limpingHome@8","lost:16","abcf4712"],
  "repeat:prospectorRunner:crimsonReaverWarband:out": "7afb7319",
  "replay:prospectorRunner:crimsonReaverWarband:out": "79255792",
  "once:prospectorRunner:crimsonReaverWarband:back": ["91f736c7","transitOut@0,engaging@4,limpingHome@9","lost:15","65e73f96"],
  "repeat:prospectorRunner:crimsonReaverWarband:back": "952bad4e",
  "once:prospectorRunner:crimsonReaverWarband:both": ["c3c0cc57","transitOut@0,engaging@3,limpingHome@8","lost:14","9ad351df"],
  "repeat:prospectorRunner:crimsonReaverWarband:both": "c66e24c3",
  "replay:prospectorRunner:crimsonReaverWarband:both": "79255792",
  "once:battleship:crimsonReaverSweep:out": ["2d6da00","transitOut@0,engaging@4,transitBack@12","won:17","761209de"],
  "repeat:battleship:crimsonReaverSweep:out": "d2439064",
  "replay:battleship:crimsonReaverSweep:out": "33148c9e",
  "once:battleship:crimsonReaverSweep:back": ["3dd9e79d","transitOut@0,engaging@5,transitBack@13","won:17","f131259e"],
  "repeat:battleship:crimsonReaverSweep:back": "60560584",
  "once:battleship:crimsonReaverSweep:both": ["6f561eef","transitOut@0,engaging@4,transitBack@12","won:16","beb05a10"],
  "repeat:battleship:crimsonReaverSweep:both": "c8688821",
  "replay:battleship:crimsonReaverSweep:both": "33148c9e",
  "once:battleship:crimsonReaverWarband:out": ["f1ac6784","transitOut@0,engaging@7,transitBack@19","won:27","a20d4cdc"],
  "repeat:battleship:crimsonReaverWarband:out": "116f1c3c",
  "replay:battleship:crimsonReaverWarband:out": "9d984a84",
  "once:battleship:crimsonReaverWarband:back": ["96619579","transitOut@0,engaging@8,transitBack@20","won:27","ec0f6ee9"],
  "repeat:battleship:crimsonReaverWarband:back": "92d896d0",
  "once:battleship:crimsonReaverWarband:both": ["a47f1e09","transitOut@0,engaging@7,transitBack@19","won:26","e271d033"],
  "repeat:battleship:crimsonReaverWarband:both": "d3517329",
  "replay:battleship:crimsonReaverWarband:both": "9d984a84",
  "once:carrier:crimsonReaverWarband:out": ["61b486d9","transitOut@0,engaging@6,transitBack@18","won:25","45cb2593"],
  "repeat:carrier:crimsonReaverWarband:out": "44dbe2be",
  "replay:carrier:crimsonReaverWarband:out": "166e78b",
  "once:carrier:crimsonReaverWarband:back": ["e7a04bf8","transitOut@0,engaging@7,transitBack@19","won:25","df26d409"],
  "repeat:carrier:crimsonReaverWarband:back": "d660a533",
  "once:carrier:crimsonReaverWarband:both": ["cf2c2806","transitOut@0,engaging@6,transitBack@18","won:24","dc5acb4a"],
  "repeat:carrier:crimsonReaverWarband:both": "1d33fc77",
  "replay:carrier:crimsonReaverWarband:both": "b76597cd",
  "once:eir:crimsonReaverSweep:out": ["5405e26","transitOut@0,engaging@3,transitBack@11","won:15","30ac35e5"],
  "repeat:eir:crimsonReaverSweep:out": "a6dc0d",
  "replay:eir:crimsonReaverSweep:out": "28bafcf2",
  "once:eir:crimsonReaverSweep:back": ["5fbc08e0","transitOut@0,engaging@4,transitBack@12","won:15","94db17a0"],
  "repeat:eir:crimsonReaverSweep:back": "d4251e4",
  "once:eir:crimsonReaverSweep:both": ["29832d98","transitOut@0,engaging@3,transitBack@11","won:14","3db1d291"],
  "repeat:eir:crimsonReaverSweep:both": "1a76c055",
  "replay:eir:crimsonReaverSweep:both": "28bafcf2",
  "once:eir:crimsonReaverWarband:out": ["4edd6cd4","transitOut@0,engaging@5,limpingHome@10","lost:22","6bdd4ba8"],
  "repeat:eir:crimsonReaverWarband:out": "9135e94",
  "replay:eir:crimsonReaverWarband:out": "5f90e37a",
  "once:eir:crimsonReaverWarband:back": ["9218b62b","transitOut@0,engaging@6,limpingHome@11","lost:21","2b477a36"],
  "repeat:eir:crimsonReaverWarband:back": "7908c818",
  "once:eir:crimsonReaverWarband:both": ["e71e100e","transitOut@0,engaging@5,limpingHome@10","lost:20","d01d9efe"],
  "repeat:eir:crimsonReaverWarband:both": "f5613870",
  "replay:eir:crimsonReaverWarband:both": "5f90e37a",
  "constMixed:battleship:crimsonReaverSweep": ["1:0:be19e8ce,2:0:b09cbc4c,3:0:26d2e511,4:0:91c1e749,5:0:5a9731,6:0:46e67944,7:0:3c3e40bc,8:0:9ca330a,9:0:c6399e39,10:0:a43c87f8,11:0:98ee427f,12:0:44eed343,13:0:6591e9fe,14:0:2bcecdd9,15:0:4dd6e03,16:0:24db61a6,17:0:820d480a,18:0:8ee8d163,19:0:11134c10,20:0:cd33c7c7,21:0:9d1a3408,22:0:87659201","80f99df8"],
  "constMixed:battleship:crimsonReaverWarband": ["1:0:8ae7544c,2:0:26d2e511,3:0:26d2e511","958b393a"],
  "constMixed:carrier:crimsonReaverSweep": ["1:0:be19e8ce,2:0:8a8e3787,3:0:c19131c4,4:0:1b5c54d8,5:0:83eee97d,6:0:f5683cb8,7:0:70dd4149,8:0:9915b662,9:0:b0d79a3,10:0:c6399e39,11:0:21ce806b,12:0:c3457db8,13:0:c3457db8","c4c698a2"],
  "constMixed:prospectorHauler:crimsonReaverSweep": ["1:0:be19e8ce,2:0:8a8e3787,3:0:c19131c4,4:0:1b5c54d8,5:0:83eee97d,6:0:f5683cb8,7:0:f5683cb8","125b7457"],
};

// ---- 3. count only flown (user 2026-10-30 "Count only flown") ------------------------------------------------------
// The Constitution run clock with a return cut that acts: the constBase runs on a fleet tick of CUT_SECONDS_PER_TICK
// (an hour), so the Flight Deck's ramp cuts every cycle's leg home. Captured on fc1ff7c, before the change (FLOWN_PINS_PRE):
//   constCut         : a Repeat run, every relaunch traced ("routes:returnCut:officerCombat") and the end state.
//   constCutInFlight : the same run's first cycle dispatched before the change (it carries no stamp; a no-op before it),
//                      read to its first relaunch: that relaunch's trace and the state there.

export const CUT_SECONDS_PER_TICK = 3600;

export function cutDispatch(hull: ShipTypeKey, route: PatrolKey): GameState {
  const r = dispatchCaptainOnPatrol({ ...constBase(hull), tickDurationSeconds: CUT_SECONDS_PER_TICK }, 1, route, "balanced", true);
  must(r.success, `${hull} ${route} cut: ${r.reason}`);
  return r.next;
}

// A cycle dispatched before "Count only flown": captain 1's patrol without its flown-clock stamp (a no-op on a record
// that carries none).
export function asPreFlown(s: GameState): GameState {
  return {
    ...s,
    captains: s.captains.map((c, i) => {
      if (i !== 0 || c.mission === null || c.mission.kind !== "patrol") return c;
      const { cutFlown: _drop, ...rest } = c.mission as PatrolMissionState & { cutFlown?: unknown };
      return { ...c, mission: rest as PatrolMissionState };
    }),
  };
}

// The run to its first relaunch (or its end): that relaunch's trace and the state there.
export function firstRelaunchRow(start: GameState): string[] {
  let s = start;
  const routes0 = (s.captains[0].mission as PatrolMissionState).routesCompletedThisRun;
  for (let i = 0; i < CONST_SECONDS && s.captains[0].mission !== null; i++) {
    s = economyTick(s, 1, RNG);
    const m = s.captains[0].mission as PatrolMissionState | null;
    if (m !== null && m.routesCompletedThisRun !== routes0) return [`${m.routesCompletedThisRun}:${m.returnCutTicks ?? 0}:${hash(m.officerCombat ?? null)}`, stateHash(s)];
  }
  return ["", stateHash(s)];
}

export function cutRows(): Record<string, unknown> {
  const got: Record<string, unknown> = {};
  for (const hull of CONST_HULLS) {
    for (const route of LIFTS_ROUTES) {
      const start = cutDispatch(hull, route);
      got[`constCut:${hull}:${route}`] = constRow(start);
      got[`constCutInFlight:${hull}:${route}`] = firstRelaunchRow(asPreFlown(start));
    }
  }
  return got;
}

// Captured on fc1ff7c, before "Count only flown".
export const FLOWN_PINS_PRE: Record<string, unknown> = {
  "constCut:battleship:crimsonReaverSweep": ["1:2:9228ca18,2:3:a723fa74,3:3:8f5c430,4:3:39afef29,5:3:46287b6b,6:3:cdb0a434,7:3:c838884c,8:3:9c39bfbe,9:3:3c5911be,10:3:ce984748,11:4:8f73995c,12:4:100304fc,13:4:f1504835,14:4:2d17bf6b,15:4:8afb2ab4,16:4:a4df6e77,17:4:c33b3e3a,18:4:25ada4b,19:4:8018f143,20:4:2cc0b0c6,21:4:581f0e2c,22:4:6c7b4a1e,23:4:aa9db8a,24:4:496944dc,25:4:930e24d5,26:4:ee5954db,27:4:9d98583f","6137071c"],
  "constCutInFlight:battleship:crimsonReaverSweep": ["1:2:9228ca18","dd1c2eaa"],
  "constCut:battleship:crimsonReaverWarband": ["1:5:b0a3dda6,2:5:f5bb4416,3:5:f5bb4416","1f0b3944"],
  "constCutInFlight:battleship:crimsonReaverWarband": ["1:5:b0a3dda6","be2db3fd"],
  "constCut:carrier:crimsonReaverSweep": ["1:2:f2741546,2:2:48a707e5,3:2:3976a662,4:2:7a3ab6fe,5:2:9c7d8d59,6:2:f01275d8,7:3:7484f88e,8:3:6220e94a,9:3:9c39bfbe,10:3:f2687c32,11:3:63c490d4,12:3:c9d63be2,13:3:b07641d4,14:3:65451799,15:3:60d1541c,16:3:12cab1c5,17:3:b0d38a8e,18:3:a4df6e77,19:3:8e7a3690,20:3:3be25a33,21:3:f921fab,22:3:74c36edd,23:3:1e3b9123,24:3:b64e59a8,25:3:bea232d1,26:3:bb5ed721,27:3:496944dc,28:3:eab254ab,29:3:df68d552,30:3:b3d53d2c","2aecae31"],
  "constCutInFlight:carrier:crimsonReaverSweep": ["1:2:f2741546","7534d531"],
  "constCut:carrier:crimsonReaverWarband": ["1:3:64a5565","20beae2a"],
  "constCutInFlight:carrier:crimsonReaverWarband": ["1:3:64a5565","c18de15d"],
  "constCut:prospectorHauler:crimsonReaverSweep": ["1:2:f2741546,2:2:48a707e5,3:2:3976a662,4:2:7a3ab6fe,5:2:9c7d8d59,6:2:f01275d8,7:3:7484f88e,8:3:6220e94a,9:3:9c39bfbe,10:3:f2687c32,11:3:63c490d4,12:3:c9d63be2,13:3:b07641d4,14:3:65451799,15:3:60d1541c,16:3:12cab1c5,17:3:b0d38a8e,18:3:a4df6e77,19:3:8e7a3690,20:3:3be25a33,21:3:f921fab,22:3:74c36edd,23:3:1e3b9123,24:3:b64e59a8,25:3:bea232d1,26:3:bb5ed721,27:3:496944dc,28:3:eab254ab,29:3:df68d552,30:3:b3d53d2c","6fbba1fb"],
  "constCutInFlight:prospectorHauler:crimsonReaverSweep": ["1:2:f2741546","11114933"],
  "constCut:prospectorHauler:crimsonReaverWarband": ["1:3:64a5565","9a36c532"],
  "constCutInFlight:prospectorHauler:crimsonReaverWarband": ["1:3:64a5565","24f9762c"],
  "constCut:destroyer:crimsonReaverSweep": ["1:1:9188a8da,2:1:b0a3dda6,3:1:d4adc0c6,4:2:f5bb4416,5:2:ff4cba8e,6:2:9b716e43,7:2:6e89163f,8:2:7484f88e,9:2:c838884c,10:2:9f642008,11:2:4f8d4e9e,12:2:1924050b,13:2:c0f54280,14:2:383c53ca,15:2:86fb9550,16:2:65451799,17:2:d9fa9576,18:2:2d17bf6b,19:2:ebc93089,20:2:f9e39ae9,21:2:c4d6803f,22:2:35f970f0,23:2:3ec24d0d,24:2:f921fab,25:2:1ae0cb3a,26:2:8688baff,27:2:581f0e2c,28:2:43f444c0,29:2:25c8d9f3,30:2:b4d8ac13,31:2:14718c9,32:2:eab254ab,33:2:53283fd5","e7a47f69"],
  "constCutInFlight:destroyer:crimsonReaverSweep": ["1:1:9188a8da","b7d374ca"],
  "constCut:destroyer:crimsonReaverWarband": ["1:1:605f98b6","bc6e6f86"],
  "constCutInFlight:destroyer:crimsonReaverWarband": ["1:1:605f98b6","b15892f3"],
};
