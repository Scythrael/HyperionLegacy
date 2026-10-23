// E-MOD EM-3 GOLDENS FIRST (plan docs/plans/2026-10-17-material-lines-and-emod-plan.md section 4 EM-3; user answer P6
// 2026-10-17 "sqrt curve, floor 60% (Recommended)"): the combat an over-budget ship fights, captured on the code BEFORE
// any EM-3 engine edit (on feat 21ff7c8, the WR-8 merge), so the engine commit has to name every move it makes. Real
// dispatches through dispatchCaptainOnPatrol and the live economyTick loop (1 s ticks), nothing edited after dispatch
// (the SF-0 method), on a patrol veteran save, under the WR-8 combat rules (every run is stamped):
//
//   1. battle   : the player combatant a run starting now builds (crewOverlay.ts shipCombatRulesStamp, the real stamp
//                 path) against a pirate Raider and a Marauder, six seeds, logged and not.
//   2. patrol   : four hulls x both routes, Dispatch Once: the dispatch record, the display replay, the outcome and its
//                 tick, the ship and the whole state at the end.
//   3. forecast : the dispatch card's Threat Assessment (App.svelte patrolForecastFor mirrored).
//   4. shipEvent: the Orion's Ground Operations ship battles from stubbed draws (a Hostile Probe, a Cloaked Vessel the
//                 ship strikes first and one that ambushes it).
//
// Each runs at three power levels on the same ship: IN budget (Standard Issue, 0 draw), OVER budget (a powered piece
// drawing half again the ship's output: sqrt(2/3), 81%) and DEEP over (four times the output: sqrt(1/4) = 50%, below
// the 60% floor). The draw sits on the installed Shield Emitter's pristine powerDraw, the only field it touches: power
// draw moves nothing else in combat, so before EM-3 every over and deep row equals its in-budget row except the hashes
// that include the piece itself (the ship and the whole state), and a test below proves that.

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import { PATROLS, SHIP_TYPES, type GameState, type PatrolKey, type PatrolMissionState, type ShipTypeKey } from "./model";
import { dispatchCaptainOnPatrol, economyTick } from "./tick";
import { resolveShipScanEventFromDraws, shipEventKindOf, SHIP_EVENT_DRAW_UNITS, SHIP_EVENT_WEIGHT_TOTAL, type ShipEventDraws } from "./shipScanEvents";
import { equippedFor } from "./equipment";
import { replayPatrol, resolvePatrolWaves } from "./combat/patrolReplay";
import { combatHullTypeOf, defaultSystemDurabilityForHull, foldedPlayerDefense, installedDronesForPatrol, shipToCombatant } from "./combat/bridge";
import { resolveBattle } from "./combat/resolveBattle";
import { generateEnemyWave } from "./combat/enemyWave";
import { COMBAT_RULES_WR8, stampCombatArgs } from "./combat/combatRules";
import { DEFAULT_SAMPLES } from "./combat/rating";
import { threatAssessment } from "./combat/threatAssessment";
import { hash, onHull, stateHash, withCrew } from "./firstRunsGoldens.fixture";
import { asExpeditionVeteran, asPatrolVeteran, dispatchPastPropulsion } from "./awayTeamTestFixtures";
import { patrolDifficultyAt } from "./runDifficulty";
import { shipCombatRulesStamp } from "./crewOverlay";
import { shipPowerTotals } from "./shipPower";
import { gearWearOffInThisFile } from "./gearWearSwitch.fixture";
// The pins are about combat power, not gear wear: use wear stays off so a later wear tune never moves them.
gearWearOffInThisFile();

const SHIP = "ship-1";
const RNG = (): number => 0.5;
export const EM3_PATROL_HULLS: ShipTypeKey[] = ["generalFreighter", "destroyer", "battleship", "carrier"];
export const EM3_ROUTES = Object.keys(PATROLS) as PatrolKey[];
export type PowerLevel = "in" | "over" | "deep";
export const EM3_LEVELS: readonly PowerLevel[] = ["in", "over", "deep"];

// The ship with its installed Shield Emitter drawing `level`'s share of the ship's output (in: untouched).
export function atPower(s: GameState, level: PowerLevel): GameState {
  if (level === "in") return s;
  const output = shipPowerTotals(s, SHIP).output;
  const draw = level === "over" ? Math.ceil((output * 3) / 2) : output * 4;
  let done = false;
  const equipment = s.equipment.map((e) => {
    if (done || e.fittedToShipId !== SHIP || e.slotType !== "shieldEmitters") return e;
    done = true;
    return { ...e, powerDraw: draw };
  });
  if (!done) throw new Error("atPower: no Shield Emitter installed");
  return { ...s, equipment };
}

function patrolBase(hull: ShipTypeKey, level: PowerLevel): GameState {
  return atPower(asPatrolVeteran({ ...onHull(hull), nextPatrolSeed: 1, credits: new Decimal(100_000) }), level);
}

const patrolOf = (s: GameState): PatrolMissionState | null => s.captains[0].mission as PatrolMissionState | null;

// ===== 1. battle =====
export function battleRow(hull: ShipTypeKey, level: PowerLevel): string {
  const s = atPower(onHull(hull), level);
  const ship = s.ships[0];
  const stamp = shipCombatRulesStamp(s, ship)!;
  const parts: string[] = [];
  for (const enemy of ["raider", "marauder"] as const) {
    for (let seed = 1; seed <= 6; seed++) {
      for (const generateLog of [false, true]) {
        const p = shipToCombatant({ id: "p", team: "player", stats: SHIP_TYPES[hull], hullType: combatHullTypeOf(hull)!, installedGear: equippedFor(s, SHIP), ...stampCombatArgs(stamp) });
        const e = generateEnemyWave(seed, { hullPool: [enemy], enemyCountMin: 1, enemyCountMax: 1, idPrefix: "em3", combatRules: true });
        const r = resolveBattle({ combatants: [p, ...e] }, 0x3e3 * seed, { combatRules: COMBAT_RULES_WR8, precharge: true, generateLog });
        parts.push(hash(r));
      }
    }
  }
  return hash(parts);
}

// ===== 2. patrol (Dispatch Once) =====
export function patrolRow(hull: ShipTypeKey, key: PatrolKey, level: PowerLevel, dispatch: (s: GameState) => ReturnType<typeof dispatchCaptainOnPatrol> = (s) => dispatchCaptainOnPatrol(s, 1, key, "balanced", false)): string[] {
  const r = dispatch(patrolBase(hull, level));
  expect(r.success, `${hull} ${key}: ${r.reason}`).toBe(true);
  const row = [hash(structuredClone(r.next.captains[0].mission)), hash(replayPatrol(r.next, r.next.captains[0]))];
  let s = r.next;
  let ticks = 0;
  while (patrolOf(s) !== null) {
    s = economyTick(s, 1, RNG);
    ticks += 1;
    if (ticks > 6000) throw new Error("the patrol never ended");
  }
  row.push(`${s.ships[0].damaged === true ? "lost" : "won"}:${ticks}`, hash(s.ships[0]), stateHash(s));
  return row;
}

// ===== 3. forecast (App.svelte patrolForecastFor's sweep, mirrored) =====
export function forecastRow(hull: ShipTypeKey, key: PatrolKey, level: PowerLevel, samples = DEFAULT_SAMPLES): string {
  const state = patrolBase(hull, level);
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
  for (let i = 0; i < samples; i++) {
    const result = resolvePatrolWaves({
      playerId: ship.id, stats: shipDef, hullType, stance: "balanced", installedGear, masterSeed: 0x5a4d + i, factionId: def.factionId, def,
      startHull: startDefense.hullMax, startShield: startDefense.shieldMax, startDrones, startSystemDurability,
      difficulty: patrolDifficultyAt(state), combatRules,
    });
    if (!result.defeated) wins += 1;
  }
  return `${wins}:${threatAssessment(wins, samples).tier}`;
}

// ===== 4. shipEvent (the Orion's ship battles from stubbed draws) =====
function kindDraw(want: "probe" | "cloaked"): number {
  for (let k = 0; k < SHIP_EVENT_WEIGHT_TOTAL; k++) if (shipEventKindOf({ kind: k, cloaked: 0 }) === want) return k;
  throw new Error(`no draw names ${want}`);
}
export function shipEventRow(level: PowerLevel, dispatchWith: <T>(f: () => T) => T = (f) => f()): string[] {
  const res = dispatchWith(() => dispatchPastPropulsion(atPower(asExpeditionVeteran(withCrew(onHull("orion"), "d18")), level), SHIP, 1, "cand-0"));
  expect(res.success, `orion: ${res.reason}`).toBe(true);
  const exp = res.expedition!;
  const quiet = { boardingAttempt: SHIP_EVENT_DRAW_UNITS - 1, boardingRepel: 0 };
  const cases: [string, ShipEventDraws][] = [
    ["probe", { kind: kindDraw("probe"), check: 0, cloaked: 0, ...quiet }],
    ["cloakedPass", { kind: kindDraw("cloaked"), check: 0, cloaked: 0, ...quiet }],
    ["cloakedFail", { kind: kindDraw("cloaked"), check: SHIP_EVENT_DRAW_UNITS - 1, cloaked: 0, ...quiet }],
  ];
  const out: string[] = [];
  for (const [name, draws] of cases) {
    for (let b = 0; b < Math.min(2, exp.bodies.length); b++) {
      for (const step of [0, 1, 2]) {
        const r = resolveShipScanEventFromDraws(exp, exp.bodies[b], b, step, 1, draws);
        out.push(`${name}:${b}:${step}:${r.event.outcome}:${r.event.hullWear ?? 0}:${hash(r.event)}`);
      }
    }
  }
  return out;
}

export function em3Rows(): Record<string, unknown> {
  const got: Record<string, unknown> = {};
  for (const level of EM3_LEVELS) {
    for (const hull of ["destroyer", "battleship", "carrier", "orion"] as ShipTypeKey[]) got[`battle:${hull}:${level}`] = battleRow(hull, level);
    for (const hull of EM3_PATROL_HULLS) {
      for (const key of EM3_ROUTES) {
        got[`patrol:${hull}:${key}:${level}`] = patrolRow(hull, key, level);
        got[`forecast:${hull}:${key}:${level}`] = forecastRow(hull, key, level);
      }
    }
    got[`shipEvent:orion:${level}`] = shipEventRow(level);
  }
  return got;
}

// Captured on feat 21ff7c8 (the WR-8 merge) before any EM-3 engine edit.
export const EM3_GOLDEN_PRE: Record<string, unknown> = {
  "battle:destroyer:in": "8807317b",
  "battle:battleship:in": "b10392d0",
  "battle:carrier:in": "5e7f0a4b",
  "battle:orion:in": "2577dcc4",
  "patrol:generalFreighter:crimsonReaverSweep:in": ["e38d27d1", "597c09a2", "won:14", "b2f38143", "619f0aa1"],
  "forecast:generalFreighter:crimsonReaverSweep:in": "57:likely",
  "patrol:generalFreighter:crimsonReaverWarband:in": ["8170ae77", "3bc66d4f", "lost:20", "701a58f1", "beaf4ad4"],
  "forecast:generalFreighter:crimsonReaverWarband:in": "0:impossible",
  "patrol:destroyer:crimsonReaverSweep:in": ["31e77619", "ba2ee129", "won:14", "6ad9f46c", "d4055219"],
  "forecast:destroyer:crimsonReaverSweep:in": "64:guaranteed",
  "patrol:destroyer:crimsonReaverWarband:in": ["d309e353", "5469ccef", "won:22", "6ad9f46c", "94a165d6"],
  "forecast:destroyer:crimsonReaverWarband:in": "9:extreme",
  "patrol:battleship:crimsonReaverSweep:in": ["8117c7c7", "2436a90a", "won:14", "c6dba9cb", "6a6e81a4"],
  "forecast:battleship:crimsonReaverSweep:in": "64:guaranteed",
  "patrol:battleship:crimsonReaverWarband:in": ["5ef43211", "a4925972", "won:22", "c6dba9cb", "394499f3"],
  "forecast:battleship:crimsonReaverWarband:in": "52:likely",
  "patrol:carrier:crimsonReaverSweep:in": ["10bbdaa4", "8f2f9130", "won:14", "ea909677", "9554bb6e"],
  "forecast:carrier:crimsonReaverSweep:in": "64:guaranteed",
  "patrol:carrier:crimsonReaverWarband:in": ["cf2ed6fa", "c28deffe", "won:22", "ea909677", "15006abb"],
  "forecast:carrier:crimsonReaverWarband:in": "23:notAdvised",
  "shipEvent:orion:in": ["probe:0:0:win:0:a894f168", "probe:0:1:win:0:f4bd0752", "probe:0:2:win:0:3f047c54", "probe:1:0:win:0:cc9053ba", "probe:1:1:win:0:b3d35774", "probe:1:2:win:0:8eb44f6", "cloakedPass:0:0:win:0:38c3f49", "cloakedPass:0:1:win:0:6bea0e7", "cloakedPass:0:2:win:0:eda81181", "cloakedPass:1:0:win:0:27ecdc73", "cloakedPass:1:1:win:0:31ef0e91", "cloakedPass:1:2:win:0:abfb56f3", "cloakedFail:0:0:win:0:38c3f49", "cloakedFail:0:1:win:0:6bea0e7", "cloakedFail:0:2:win:0:eda81181", "cloakedFail:1:0:win:0:27ecdc73", "cloakedFail:1:1:loss:41:28710703", "cloakedFail:1:2:win:0:abfb56f3"],
  "battle:destroyer:over": "8807317b",
  "battle:battleship:over": "b10392d0",
  "battle:carrier:over": "5e7f0a4b",
  "battle:orion:over": "2577dcc4",
  "patrol:generalFreighter:crimsonReaverSweep:over": ["e38d27d1", "597c09a2", "won:14", "b2f38143", "f97a5238"],
  "forecast:generalFreighter:crimsonReaverSweep:over": "57:likely",
  "patrol:generalFreighter:crimsonReaverWarband:over": ["8170ae77", "3bc66d4f", "lost:20", "701a58f1", "885e3925"],
  "forecast:generalFreighter:crimsonReaverWarband:over": "0:impossible",
  "patrol:destroyer:crimsonReaverSweep:over": ["31e77619", "ba2ee129", "won:14", "6ad9f46c", "efab1087"],
  "forecast:destroyer:crimsonReaverSweep:over": "64:guaranteed",
  "patrol:destroyer:crimsonReaverWarband:over": ["d309e353", "5469ccef", "won:22", "6ad9f46c", "bd700ec8"],
  "forecast:destroyer:crimsonReaverWarband:over": "9:extreme",
  "patrol:battleship:crimsonReaverSweep:over": ["8117c7c7", "2436a90a", "won:14", "c6dba9cb", "9d406c2"],
  "forecast:battleship:crimsonReaverSweep:over": "64:guaranteed",
  "patrol:battleship:crimsonReaverWarband:over": ["5ef43211", "a4925972", "won:22", "c6dba9cb", "7671172d"],
  "forecast:battleship:crimsonReaverWarband:over": "52:likely",
  "patrol:carrier:crimsonReaverSweep:over": ["10bbdaa4", "8f2f9130", "won:14", "ea909677", "9012fba4"],
  "forecast:carrier:crimsonReaverSweep:over": "64:guaranteed",
  "patrol:carrier:crimsonReaverWarband:over": ["cf2ed6fa", "c28deffe", "won:22", "ea909677", "c2373fc1"],
  "forecast:carrier:crimsonReaverWarband:over": "23:notAdvised",
  "shipEvent:orion:over": ["probe:0:0:win:0:a894f168", "probe:0:1:win:0:f4bd0752", "probe:0:2:win:0:3f047c54", "probe:1:0:win:0:cc9053ba", "probe:1:1:win:0:b3d35774", "probe:1:2:win:0:8eb44f6", "cloakedPass:0:0:win:0:38c3f49", "cloakedPass:0:1:win:0:6bea0e7", "cloakedPass:0:2:win:0:eda81181", "cloakedPass:1:0:win:0:27ecdc73", "cloakedPass:1:1:win:0:31ef0e91", "cloakedPass:1:2:win:0:abfb56f3", "cloakedFail:0:0:win:0:38c3f49", "cloakedFail:0:1:win:0:6bea0e7", "cloakedFail:0:2:win:0:eda81181", "cloakedFail:1:0:win:0:27ecdc73", "cloakedFail:1:1:loss:41:28710703", "cloakedFail:1:2:win:0:abfb56f3"],
  "battle:destroyer:deep": "8807317b",
  "battle:battleship:deep": "b10392d0",
  "battle:carrier:deep": "5e7f0a4b",
  "battle:orion:deep": "2577dcc4",
  "patrol:generalFreighter:crimsonReaverSweep:deep": ["e38d27d1", "597c09a2", "won:14", "b2f38143", "11fca6dc"],
  "forecast:generalFreighter:crimsonReaverSweep:deep": "57:likely",
  "patrol:generalFreighter:crimsonReaverWarband:deep": ["8170ae77", "3bc66d4f", "lost:20", "701a58f1", "2554c899"],
  "forecast:generalFreighter:crimsonReaverWarband:deep": "0:impossible",
  "patrol:destroyer:crimsonReaverSweep:deep": ["31e77619", "ba2ee129", "won:14", "6ad9f46c", "e91aa50b"],
  "forecast:destroyer:crimsonReaverSweep:deep": "64:guaranteed",
  "patrol:destroyer:crimsonReaverWarband:deep": ["d309e353", "5469ccef", "won:22", "6ad9f46c", "926bbf5c"],
  "forecast:destroyer:crimsonReaverWarband:deep": "9:extreme",
  "patrol:battleship:crimsonReaverSweep:deep": ["8117c7c7", "2436a90a", "won:14", "c6dba9cb", "1a747e75"],
  "forecast:battleship:crimsonReaverSweep:deep": "64:guaranteed",
  "patrol:battleship:crimsonReaverWarband:deep": ["5ef43211", "a4925972", "won:22", "c6dba9cb", "55d52fda"],
  "forecast:battleship:crimsonReaverWarband:deep": "52:likely",
  "patrol:carrier:crimsonReaverSweep:deep": ["10bbdaa4", "8f2f9130", "won:14", "ea909677", "5a3efd9e"],
  "forecast:carrier:crimsonReaverSweep:deep": "64:guaranteed",
  "patrol:carrier:crimsonReaverWarband:deep": ["cf2ed6fa", "c28deffe", "won:22", "ea909677", "f1ccd2fb"],
  "forecast:carrier:crimsonReaverWarband:deep": "23:notAdvised",
  "shipEvent:orion:deep": ["probe:0:0:win:0:a894f168", "probe:0:1:win:0:f4bd0752", "probe:0:2:win:0:3f047c54", "probe:1:0:win:0:cc9053ba", "probe:1:1:win:0:b3d35774", "probe:1:2:win:0:8eb44f6", "cloakedPass:0:0:win:0:38c3f49", "cloakedPass:0:1:win:0:6bea0e7", "cloakedPass:0:2:win:0:eda81181", "cloakedPass:1:0:win:0:27ecdc73", "cloakedPass:1:1:win:0:31ef0e91", "cloakedPass:1:2:win:0:abfb56f3", "cloakedFail:0:0:win:0:38c3f49", "cloakedFail:0:1:win:0:6bea0e7", "cloakedFail:0:2:win:0:eda81181", "cloakedFail:1:0:win:0:27ecdc73", "cloakedFail:1:1:loss:41:28710703", "cloakedFail:1:2:win:0:abfb56f3"],
};

describe("EM-3 goldens (captured before the combat over-budget penalty)", () => {
  const got = em3Rows();
  it("every row matches the capture", () => {
    expect(got).toEqual(EM3_GOLDEN_PRE);
  });
  it("before EM-3, power draw moves no fight: every over and deep row equals its in-budget row (but the piece's own hashes)", () => {
    for (const [k, v] of Object.entries(got)) {
      const level = k.split(":").pop() as PowerLevel;
      if (level === "in") continue;
      const inRow = got[k.replace(/:(over|deep)$/, ":in")];
      if (k.startsWith("patrol:")) {
        // The dispatch record, the replay and the outcome hold; the ship and the state carry the piece's draw.
        expect((v as string[]).slice(0, 3), k).toEqual((inRow as string[]).slice(0, 3));
      } else if (k.startsWith("shipEvent:")) {
        expect(v, k).toEqual(inRow);
      } else {
        expect(v, k).toEqual(inRow);
      }
    }
  });
});
