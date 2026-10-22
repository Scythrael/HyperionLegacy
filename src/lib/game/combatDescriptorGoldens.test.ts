// WR-8 GOLDENS FIRST (docs/plans/2026-10-15-wiring-registry-and-audit-plan.md section 4 WR-8): the combat the slice's
// descriptors touch, captured on the code BEFORE any WR-8 engine edit (on top of 8688c61), so the engine commit has to
// name every move it makes. Real dispatches through dispatchCaptainOnPatrol and the live economyTick loop (1 s ticks),
// nothing edited after dispatch (the SF-0 method, firstRunsGoldens.fixture.ts onHull), on a patrol veteran save (full
// strength: no training cycle, no curve stamp):
//
//   1. patrol   : every hull x both routes x Dispatch Once and Dispatch Repeatedly (up to three cycles): the outcome
//                 and its tick, the dispatch record, the display replay of the cycle, the ship and the whole state at
//                 the end (Repeat: at each relaunch and the end).
//   2. forecast : the dispatch card's Threat Assessment (App.svelte patrolForecastFor mirrored) for five hulls x both
//                 routes.
//   3. shipEvent: the Ground Operations ship battles: every explorer x four expedition seeds x the three candidates on
//                 an expedition veteran save with the D18 crew, the run advanced in one call to SWEEP_END: the scan
//                 events and the ship battle outcomes.
//
// The engine commit re-pins what it moves and names every move in GOLDEN's header.

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import { PATROLS, SHIP_TYPES, type Expedition, type GameState, type PatrolKey, type PatrolMissionState, type ShipTypeKey } from "./model";
import { dispatchCaptainOnPatrol, economyTick } from "./tick";
import { advanceExpedition } from "./expedition";
import { resolveShipScanEventFromDraws, shipEventKindOf, SHIP_EVENT_DRAW_UNITS, SHIP_EVENT_WEIGHT_TOTAL, type ShipEventDraws } from "./shipScanEvents";
import { equippedFor } from "./equipment";
import { replayPatrol, resolvePatrolWaves } from "./combat/patrolReplay";
import { combatHullTypeOf, defaultSystemDurabilityForHull, foldedPlayerDefense, installedDronesForPatrol } from "./combat/bridge";
import { DEFAULT_SAMPLES } from "./combat/rating";
import { threatAssessment } from "./combat/threatAssessment";
import { hash, onHull, runOutcome, stateHash, SWEEP_END, withCrew } from "./firstRunsGoldens.fixture";
import { asExpeditionVeteran, asPatrolVeteran, dispatchPastPropulsion } from "./awayTeamTestFixtures";
import { patrolDifficultyAt } from "./runDifficulty";

const HULLS = Object.keys(SHIP_TYPES) as ShipTypeKey[];
const ROUTES = Object.keys(PATROLS) as PatrolKey[];
const FORECAST_HULLS: ShipTypeKey[] = ["generalFreighter", "destroyer", "battleship", "carrier", "orion"];
const EXPLORERS: ShipTypeKey[] = ["orion", "aurora", "eir"];
const CANDS = ["cand-0", "cand-1", "cand-2"];
const EXPEDITION_SEEDS: (number | undefined)[] = [undefined, 101, 202, 303];
const RNG = (): number => 0.5;
const MAX_CYCLES = 3;

const patrolOf = (s: GameState): PatrolMissionState | null => s.captains[0].mission as PatrolMissionState | null;

function base(hull: ShipTypeKey): GameState {
  return asPatrolVeteran({ ...onHull(hull), nextPatrolSeed: 1, credits: new Decimal(100_000) });
}

// One patrol from a veteran save on `hull`, advanced in 1 s ticks until the captain idles (Once) or MAX_CYCLES cycles
// have started (Repeat: then recalled and flown home).
function patrolRow(hull: ShipTypeKey, key: PatrolKey, repeat: boolean): string[] {
  const r = dispatchCaptainOnPatrol(base(hull), 1, key, "balanced", repeat);
  expect(r.success, `${hull} ${key}: ${r.reason}`).toBe(true);
  const row = [hash(structuredClone(r.next.captains[0].mission)), hash(replayPatrol(r.next, r.next.captains[0]))];
  let s = r.next;
  let ticks = 0;
  let cycles = 1;
  let seed = patrolOf(s)!.masterSeed;
  while (patrolOf(s) !== null) {
    s = economyTick(s, 1, RNG);
    ticks += 1;
    const m = patrolOf(s);
    if (m !== null && m.masterSeed !== seed) {
      seed = m.masterSeed;
      cycles += 1;
      row.push(`relaunch:${ticks}`, hash(structuredClone(m)), stateHash(s));
      if (cycles >= MAX_CYCLES) s = { ...s, captains: s.captains.map((c, i) => (i === 0 && c.mission?.kind === "patrol" ? { ...c, mission: { ...c.mission, recalled: true } } : c)) };
    }
    if (ticks > 6000) throw new Error("the patrol never ended");
  }
  row.push(`${s.ships[0].damaged === true ? "lost" : "won"}:${ticks}`, hash(s.ships[0]), stateHash(s));
  return row;
}

// App.svelte patrolForecastFor's sweep, mirrored (FORECAST_SEED 0x5a4d + i over DEFAULT_SAMPLES).
function forecast(state: GameState, key: PatrolKey): string {
  const ship = state.ships[0];
  const hullType = combatHullTypeOf(ship.typeKey);
  if (hullType === null) return "none";
  const def = PATROLS[key];
  const shipDef = SHIP_TYPES[ship.typeKey];
  const installedGear = equippedFor(state, ship.id);
  const startDrones = installedDronesForPatrol(installedGear, `forecast-${key}-p`);
  const startSystemDurability = defaultSystemDurabilityForHull(hullType, shipDef, installedGear);
  const startDefense = foldedPlayerDefense(shipDef, installedGear);
  let wins = 0;
  for (let i = 0; i < DEFAULT_SAMPLES; i++) {
    const result = resolvePatrolWaves({
      playerId: ship.id, stats: shipDef, hullType, stance: "balanced", installedGear, masterSeed: 0x5a4d + i, factionId: def.factionId, def,
      startHull: startDefense.hullMax, startShield: startDefense.shieldMax, startDrones, startSystemDurability,
      difficulty: patrolDifficultyAt(state),
    });
    if (!result.defeated) wins += 1;
  }
  return `${wins}:${threatAssessment(wins, DEFAULT_SAMPLES).tier}`;
}

// One Ground Operations run from an expedition veteran save: its ship events and battles, and the run's outcome.
function shipEventRow(hull: ShipTypeKey, cand: string, seed: number | undefined): string[] {
  const res = dispatchPastPropulsion(asExpeditionVeteran(withCrew(onHull(hull, seed), "d18")), "ship-1", 1, cand);
  expect(res.success, `${hull} ${cand}: ${res.reason}`).toBe(true);
  const done: Expedition = advanceExpedition(res.expedition!, SWEEP_END);
  const events = (done.scanEvents ?? []).filter((e) => e.kind === "shipEvent");
  const battles = events.filter((e) => e.event === "probe" || e.event === "cloaked").map((e) => `${e.event}:${e.outcome}`);
  const o = runOutcome(done);
  return [battles.join(",") || "none", hash(events), `${o.objectives} hull:${o.hullDamage} setbacks:${o.setbacks}`, hash(done)];
}

// The ship battles themselves, from stubbed draws (resolveShipScanEventFromDraws: the event's own seeded battle): a
// Hostile Probe, and a Cloaked Vessel with the sensor check passed (the ship strikes first) and failed (it ambushes the
// ship), at each of the run's first two bodies and first three steps.
function kindDraw(want: "probe" | "cloaked"): number {
  for (let k = 0; k < SHIP_EVENT_WEIGHT_TOTAL; k++) if (shipEventKindOf({ kind: k, cloaked: 0 }) === want) return k;
  throw new Error(`no draw names ${want}`);
}
function battleRow(hull: ShipTypeKey, cand: string): string[] {
  const res = dispatchPastPropulsion(asExpeditionVeteran(withCrew(onHull(hull), "d18")), "ship-1", 1, cand);
  expect(res.success, `${hull} ${cand}: ${res.reason}`).toBe(true);
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
        out.push(`${name}:${b}:${step}:${r.event.outcome}:${r.event.hullWear ?? 0}`);
      }
    }
  }
  return out;
}

const GOLDEN: Record<string, unknown> = {
  "battle:orion:cand-0": [
    "probe:0:0:win:0", "probe:0:1:win:0", "probe:0:2:win:0", "probe:1:0:win:0", "probe:1:1:win:0",
    "probe:1:2:win:0", "cloakedPass:0:0:win:0", "cloakedPass:0:1:win:0", "cloakedPass:0:2:loss:41",
    "cloakedPass:1:0:win:0", "cloakedPass:1:1:win:0", "cloakedPass:1:2:win:0", "cloakedFail:0:0:win:0",
    "cloakedFail:0:1:win:0", "cloakedFail:0:2:win:0", "cloakedFail:1:0:loss:41", "cloakedFail:1:1:win:0",
    "cloakedFail:1:2:win:0",
  ],
  "battle:orion:cand-1": [
    "probe:0:0:win:0", "probe:0:1:win:0", "probe:0:2:win:0", "probe:1:0:win:0", "probe:1:1:win:0",
    "probe:1:2:win:0", "cloakedPass:0:0:win:0", "cloakedPass:0:1:win:0", "cloakedPass:0:2:win:0",
    "cloakedPass:1:0:win:0", "cloakedPass:1:1:win:0", "cloakedPass:1:2:win:0", "cloakedFail:0:0:win:0",
    "cloakedFail:0:1:win:0", "cloakedFail:0:2:win:0", "cloakedFail:1:0:win:0", "cloakedFail:1:1:win:0",
    "cloakedFail:1:2:win:0",
  ],
  "battle:orion:cand-2": [
    "probe:0:0:win:0", "probe:0:1:win:0", "probe:0:2:win:0", "probe:1:0:win:0", "probe:1:1:win:0",
    "probe:1:2:win:0", "cloakedPass:0:0:win:0", "cloakedPass:0:1:win:0", "cloakedPass:0:2:win:0",
    "cloakedPass:1:0:win:0", "cloakedPass:1:1:win:0", "cloakedPass:1:2:win:0", "cloakedFail:0:0:win:0",
    "cloakedFail:0:1:win:0", "cloakedFail:0:2:win:0", "cloakedFail:1:0:win:0", "cloakedFail:1:1:win:0",
    "cloakedFail:1:2:win:0",
  ],
  "battle:aurora:cand-0": [
    "probe:0:0:win:0", "probe:0:1:win:0", "probe:0:2:win:0", "probe:1:0:win:0", "probe:1:1:win:0",
    "probe:1:2:win:0", "cloakedPass:0:0:win:0", "cloakedPass:0:1:win:0", "cloakedPass:0:2:loss:36",
    "cloakedPass:1:0:win:0", "cloakedPass:1:1:win:0", "cloakedPass:1:2:win:0", "cloakedFail:0:0:win:0",
    "cloakedFail:0:1:win:0", "cloakedFail:0:2:win:0", "cloakedFail:1:0:loss:36", "cloakedFail:1:1:win:0",
    "cloakedFail:1:2:win:0",
  ],
  "battle:aurora:cand-1": [
    "probe:0:0:win:0", "probe:0:1:win:0", "probe:0:2:win:0", "probe:1:0:win:0", "probe:1:1:win:0",
    "probe:1:2:win:0", "cloakedPass:0:0:win:0", "cloakedPass:0:1:win:0", "cloakedPass:0:2:win:0",
    "cloakedPass:1:0:win:0", "cloakedPass:1:1:win:0", "cloakedPass:1:2:win:0", "cloakedFail:0:0:win:0",
    "cloakedFail:0:1:win:0", "cloakedFail:0:2:win:0", "cloakedFail:1:0:win:0", "cloakedFail:1:1:loss:36",
    "cloakedFail:1:2:win:0",
  ],
  "battle:aurora:cand-2": [
    "probe:0:0:win:0", "probe:0:1:win:0", "probe:0:2:win:0", "probe:1:0:win:0", "probe:1:1:win:0",
    "probe:1:2:win:0", "cloakedPass:0:0:win:0", "cloakedPass:0:1:win:0", "cloakedPass:0:2:win:0",
    "cloakedPass:1:0:win:0", "cloakedPass:1:1:win:0", "cloakedPass:1:2:win:0", "cloakedFail:0:0:win:0",
    "cloakedFail:0:1:win:0", "cloakedFail:0:2:win:0", "cloakedFail:1:0:win:0", "cloakedFail:1:1:win:0",
    "cloakedFail:1:2:win:0",
  ],
  "battle:eir:cand-0": [
    "probe:0:0:win:0", "probe:0:1:win:0", "probe:0:2:win:0", "probe:1:0:win:0", "probe:1:1:win:0",
    "probe:1:2:win:0", "cloakedPass:0:0:win:0", "cloakedPass:0:1:win:0", "cloakedPass:0:2:loss:43",
    "cloakedPass:1:0:win:0", "cloakedPass:1:1:win:0", "cloakedPass:1:2:win:0", "cloakedFail:0:0:win:0",
    "cloakedFail:0:1:win:0", "cloakedFail:0:2:win:0", "cloakedFail:1:0:loss:43", "cloakedFail:1:1:win:0",
    "cloakedFail:1:2:win:0",
  ],
  "battle:eir:cand-1": [
    "probe:0:0:win:0", "probe:0:1:win:0", "probe:0:2:win:0", "probe:1:0:win:0", "probe:1:1:win:0",
    "probe:1:2:win:0", "cloakedPass:0:0:win:0", "cloakedPass:0:1:win:0", "cloakedPass:0:2:win:0",
    "cloakedPass:1:0:win:0", "cloakedPass:1:1:win:0", "cloakedPass:1:2:win:0", "cloakedFail:0:0:win:0",
    "cloakedFail:0:1:win:0", "cloakedFail:0:2:win:0", "cloakedFail:1:0:win:0", "cloakedFail:1:1:loss:43",
    "cloakedFail:1:2:win:0",
  ],
  "battle:eir:cand-2": [
    "probe:0:0:win:0", "probe:0:1:win:0", "probe:0:2:win:0", "probe:1:0:win:0", "probe:1:1:win:0",
    "probe:1:2:win:0", "cloakedPass:0:0:win:0", "cloakedPass:0:1:win:0", "cloakedPass:0:2:win:0",
    "cloakedPass:1:0:win:0", "cloakedPass:1:1:win:0", "cloakedPass:1:2:win:0", "cloakedFail:0:0:win:0",
    "cloakedFail:0:1:loss:43", "cloakedFail:0:2:win:0", "cloakedFail:1:0:win:0", "cloakedFail:1:1:win:0",
    "cloakedFail:1:2:win:0",
  ],
  "patrol:generalFreighter:crimsonReaverSweep:once": ["894fdcae", "5d83bda0", "won:14", "b2f38143", "619f0aa1"],
  "patrol:generalFreighter:crimsonReaverSweep:repeat": [
    "e77591eb", "5d83bda0", "relaunch:14", "6b00191d", "4bc91d37", "relaunch:28", "d3d5f7c7", "c1f5b4c5",
    "won:42", "b2f38143", "1193c52",
  ],
  "patrol:generalFreighter:crimsonReaverWarband:once": ["4213eee4", "287f7c59", "lost:23", "701a58f1", "c3731d85"],
  "patrol:generalFreighter:crimsonReaverWarband:repeat": ["357ffcd1", "287f7c59", "lost:23", "701a58f1", "c3731d85"],
  "patrol:prospectorHauler:crimsonReaverSweep:once": ["26da28a9", "17457803", "won:14", "9d03d00b", "44d412c5"],
  "patrol:prospectorHauler:crimsonReaverSweep:repeat": [
    "f2b311da", "17457803", "relaunch:14", "d2bd7770", "d10962a", "relaunch:28", "864d38ee", "ae3c32da",
    "won:42", "9d03d00b", "47f525c2",
  ],
  "patrol:prospectorHauler:crimsonReaverWarband:once": ["e98455fb", "b773a2a5", "won:22", "9d03d00b", "7503e6ee"],
  "patrol:prospectorHauler:crimsonReaverWarband:repeat": [
    "d939d03c", "b773a2a5", "relaunch:22", "db7a06d1", "3a9daf11", "lost:38", "8539ed3f", "51a2bb8e",
  ],
  "patrol:prospectorRunner:crimsonReaverSweep:once": ["7a2a52c9", "2eff9144", "lost:10", "e1360e3a", "3458dee6"],
  "patrol:prospectorRunner:crimsonReaverSweep:repeat": ["1439c87a", "2eff9144", "lost:10", "e1360e3a", "3458dee6"],
  "patrol:prospectorRunner:crimsonReaverWarband:once": ["254c266f", "a3a2ab0a", "lost:20", "e1360e3a", "7542ef9a"],
  "patrol:prospectorRunner:crimsonReaverWarband:repeat": ["93f75ed8", "a3a2ab0a", "lost:20", "e1360e3a", "7542ef9a"],
  "patrol:prospectorMiner:crimsonReaverSweep:once": ["2bf09384", "8182c739", "lost:10", "4a78733f", "e7fd04bd"],
  "patrol:prospectorMiner:crimsonReaverSweep:repeat": ["792ccf1", "8182c739", "lost:10", "4a78733f", "e7fd04bd"],
  "patrol:prospectorMiner:crimsonReaverWarband:once": ["73831be6", "4f343110", "lost:20", "4a78733f", "445177ad"],
  "patrol:prospectorMiner:crimsonReaverWarband:repeat": ["7b208223", "4f343110", "lost:20", "4a78733f", "445177ad"],
  "patrol:destroyer:crimsonReaverSweep:once": ["c614f4e", "6ca86c97", "won:14", "6ad9f46c", "d4055219"],
  "patrol:destroyer:crimsonReaverSweep:repeat": [
    "2482ac0b", "6ca86c97", "relaunch:14", "fc51ce1", "afcac89", "relaunch:28", "55c53187", "c96cc621", "won:42",
    "6ad9f46c", "bba9124",
  ],
  "patrol:destroyer:crimsonReaverWarband:once": ["6993bb20", "c4d5c140", "won:22", "6ad9f46c", "94a165d6"],
  "patrol:destroyer:crimsonReaverWarband:repeat": [
    "e48e3075", "c4d5c140", "relaunch:22", "f0f559a0", "f2452ff4", "lost:38", "44b4c6b5", "db558c17",
  ],
  "patrol:battleship:crimsonReaverSweep:once": ["233cf766", "10a14de7", "won:14", "c6dba9cb", "6a6e81a4"],
  "patrol:battleship:crimsonReaverSweep:repeat": [
    "80f668a3", "10a14de7", "relaunch:14", "99b30a91", "82a0abce", "relaunch:28", "666547ef", "b23cf248",
    "won:42", "c6dba9cb", "ae27954d",
  ],
  "patrol:battleship:crimsonReaverWarband:once": ["518735a0", "e8ca824f", "won:22", "c6dba9cb", "394499f3"],
  "patrol:battleship:crimsonReaverWarband:repeat": [
    "27835bf5", "e8ca824f", "relaunch:22", "6241254e", "a2f451dd", "lost:39", "afe73d75", "4c6aa502",
  ],
  "patrol:carrier:crimsonReaverSweep:once": ["d5718c2f", "9e9d9838", "won:14", "ea909677", "9554bb6e"],
  "patrol:carrier:crimsonReaverSweep:repeat": [
    "16e07798", "9e9d9838", "relaunch:14", "27ec48e", "a3d137e9", "relaunch:28", "9759c1e7", "d833511a",
    "won:42", "ea909677", "64959369",
  ],
  "patrol:carrier:crimsonReaverWarband:once": ["47f02015", "4a94c4ae", "won:22", "ea909677", "15006abb"],
  "patrol:carrier:crimsonReaverWarband:repeat": [
    "5178250e", "4a94c4ae", "relaunch:22", "80ee93b5", "86753956", "lost:38", "73109288", "5d7605b4",
  ],
  "patrol:orion:crimsonReaverSweep:once": ["35ea9697", "9ce7446b", "won:14", "c75858d4", "9f06f3dd"],
  "patrol:orion:crimsonReaverSweep:repeat": [
    "9a60cec0", "9ce7446b", "relaunch:14", "e9e040d2", "89404b40", "relaunch:28", "97d084c4", "f576fffe",
    "won:42", "c75858d4", "6d24a25c",
  ],
  "patrol:orion:crimsonReaverWarband:once": ["69062df5", "b2fac903", "lost:20", "6619cb48", "20b8680"],
  "patrol:orion:crimsonReaverWarband:repeat": ["ddc1676e", "b2fac903", "lost:20", "6619cb48", "20b8680"],
  "patrol:aurora:crimsonReaverSweep:once": ["6ac4f480", "d1fa7742", "won:14", "62b89a6f", "511447be"],
  "patrol:aurora:crimsonReaverSweep:repeat": [
    "849f0555", "d1fa7742", "relaunch:14", "64896807", "b3307526", "relaunch:28", "93880a79", "ece65b0c",
    "won:42", "62b89a6f", "efae95d5",
  ],
  "patrol:aurora:crimsonReaverWarband:once": ["3c51a286", "f0d1fdd3", "lost:20", "def772e7", "e97d0cbd"],
  "patrol:aurora:crimsonReaverWarband:repeat": ["17e8ee43", "f0d1fdd3", "lost:20", "def772e7", "e97d0cbd"],
  "patrol:eir:crimsonReaverSweep:once": ["da45804", "b0e8a479", "won:14", "ffdca63b", "ef5f54b8"],
  "patrol:eir:crimsonReaverSweep:repeat": [
    "ad9cc671", "b0e8a479", "relaunch:14", "bc0fe3a3", "d82c1ef6", "relaunch:28", "984c845d", "ceb5ece",
    "won:42", "ffdca63b", "34db43b9",
  ],
  "patrol:eir:crimsonReaverWarband:once": ["abe6f092", "84a07220", "lost:20", "7ddb5b8d", "d9543d0b"],
  "patrol:eir:crimsonReaverWarband:repeat": ["24603987", "84a07220", "lost:20", "7ddb5b8d", "d9543d0b"],
  "forecast:generalFreighter:crimsonReaverSweep": "63:likely",
  "forecast:generalFreighter:crimsonReaverWarband": "2:extreme",
  "forecast:destroyer:crimsonReaverSweep": "64:guaranteed",
  "forecast:destroyer:crimsonReaverWarband": "11:extreme",
  "forecast:battleship:crimsonReaverSweep": "64:guaranteed",
  "forecast:battleship:crimsonReaverWarband": "52:likely",
  "forecast:carrier:crimsonReaverSweep": "64:guaranteed",
  "forecast:carrier:crimsonReaverWarband": "39:worthy",
  "forecast:orion:crimsonReaverSweep": "60:likely",
  "forecast:orion:crimsonReaverWarband": "0:impossible",
  "shipEvent:orion:default:cand-0": ["none", "628d0a82", "1/11 hull:0 setbacks:0", "2c54761a"],
  "shipEvent:orion:default:cand-1": ["probe:win", "63ad049a", "7/10 hull:0 setbacks:2", "ca14848b"],
  "shipEvent:orion:default:cand-2": ["cloaked:win", "c21ba1b3", "4/6 hull:14 setbacks:2", "bc94ed3e"],
  "shipEvent:orion:101:cand-0": ["probe:win", "f6d6791c", "7/12 hull:0 setbacks:1", "dbcdd893"],
  "shipEvent:orion:101:cand-1": ["none", "2a9661e9", "4/14 hull:0 setbacks:1", "619fc54d"],
  "shipEvent:orion:101:cand-2": ["probe:win", "c54ee85f", "7/15 hull:0 setbacks:1", "c050eba9"],
  "shipEvent:orion:202:cand-0": ["probe:win", "ca306f68", "2/6 hull:0 setbacks:1", "55ddd593"],
  "shipEvent:orion:202:cand-1": ["none", "741638a5", "0/3 hull:0 setbacks:0", "198589c0"],
  "shipEvent:orion:202:cand-2": ["cloaked:win,cloaked:win", "3fc16ecc", "2/11 hull:14 setbacks:3", "455dc28c"],
  "shipEvent:orion:303:cand-0": ["none", "5925cf3a", "1/4 hull:0 setbacks:0", "6b2b0592"],
  "shipEvent:orion:303:cand-1": ["none", "ed0e6120", "4/9 hull:14 setbacks:2", "bf2cb5f8"],
  "shipEvent:orion:303:cand-2": ["none", "63dee130", "2/11 hull:28 setbacks:3", "7e43881"],
  "shipEvent:aurora:default:cand-0": ["none", "628d0a82", "1/11 hull:0 setbacks:0", "58e0e093"],
  "shipEvent:aurora:default:cand-1": ["probe:win", "63ad049a", "7/10 hull:0 setbacks:2", "d9e25fce"],
  "shipEvent:aurora:default:cand-2": ["cloaked:win", "9f36b3f1", "4/6 hull:12 setbacks:2", "576b7b5a"],
  "shipEvent:aurora:101:cand-0": ["probe:win", "f6d6791c", "7/12 hull:0 setbacks:1", "b0d16611"],
  "shipEvent:aurora:101:cand-1": ["none", "2a9661e9", "4/14 hull:0 setbacks:1", "9d5ef99f"],
  "shipEvent:aurora:101:cand-2": ["probe:win", "c54ee85f", "7/15 hull:0 setbacks:1", "6ef2674f"],
  "shipEvent:aurora:202:cand-0": ["probe:win", "ca306f68", "2/6 hull:0 setbacks:1", "918c2d7e"],
  "shipEvent:aurora:202:cand-1": ["none", "741638a5", "0/3 hull:0 setbacks:0", "5e78256e"],
  "shipEvent:aurora:202:cand-2": ["cloaked:win,cloaked:win", "654d778e", "2/11 hull:12 setbacks:3", "2bf97849"],
  "shipEvent:aurora:303:cand-0": ["none", "5925cf3a", "1/4 hull:0 setbacks:0", "2db13e11"],
  "shipEvent:aurora:303:cand-1": ["none", "6356624e", "4/9 hull:12 setbacks:2", "cc55c578"],
  "shipEvent:aurora:303:cand-2": ["none", "2f72ff6c", "2/11 hull:24 setbacks:3", "461611fe"],
  "shipEvent:eir:default:cand-0": ["none", "628d0a82", "1/11 hull:0 setbacks:0", "242f1a63"],
  "shipEvent:eir:default:cand-1": ["probe:win", "63ad049a", "7/10 hull:0 setbacks:2", "338a7aea"],
  "shipEvent:eir:default:cand-2": ["cloaked:win", "c21ba1b3", "4/6 hull:14 setbacks:2", "33d78c09"],
  "shipEvent:eir:101:cand-0": ["probe:win", "f6d6791c", "7/12 hull:0 setbacks:1", "dbb560b0"],
  "shipEvent:eir:101:cand-1": ["none", "2a9661e9", "4/14 hull:0 setbacks:1", "1f4324a3"],
  "shipEvent:eir:101:cand-2": ["probe:win", "c54ee85f", "7/15 hull:0 setbacks:1", "37ed7f0e"],
  "shipEvent:eir:202:cand-0": ["probe:win", "ca306f68", "2/6 hull:0 setbacks:1", "755f8e05"],
  "shipEvent:eir:202:cand-1": ["none", "741638a5", "0/3 hull:0 setbacks:0", "29ade6f6"],
  "shipEvent:eir:202:cand-2": ["cloaked:win,cloaked:win", "3fc16ecc", "2/11 hull:14 setbacks:3", "aaca777d"],
  "shipEvent:eir:303:cand-0": ["none", "5925cf3a", "1/4 hull:0 setbacks:0", "d89793da"],
  "shipEvent:eir:303:cand-1": ["none", "ed0e6120", "4/9 hull:14 setbacks:2", "49f92c63"],
  "shipEvent:eir:303:cand-2": ["none", "63dee130", "2/11 hull:28 setbacks:3", "6e14b4bc"],
};

describe("WR-8 combat goldens (captured before the engine edit)", () => {
  for (const hull of EXPLORERS) {
    for (const cand of CANDS) {
      const id = `battle:${hull}:${cand}`;
      it(id, () => {
        expect(battleRow(hull, cand)).toEqual(GOLDEN[id]);
      });
    }
  }
  for (const hull of HULLS) {
    for (const key of ROUTES) {
      for (const repeat of [false, true]) {
        const id = `patrol:${hull}:${key}:${repeat ? "repeat" : "once"}`;
        it(id, () => {
          expect(patrolRow(hull, key, repeat)).toEqual(GOLDEN[id]);
        });
      }
    }
  }
  for (const hull of FORECAST_HULLS) {
    for (const key of ROUTES) {
      const id = `forecast:${hull}:${key}`;
      it(id, () => {
        expect(forecast(base(hull), key)).toEqual(GOLDEN[id]);
      });
    }
  }
  for (const hull of EXPLORERS) {
    for (const seed of EXPEDITION_SEEDS) {
      for (const cand of CANDS) {
        const id = `shipEvent:${hull}:${seed ?? "default"}:${cand}`;
        it(id, () => {
          expect(shipEventRow(hull, cand, seed)).toEqual(GOLDEN[id]);
        });
      }
    }
  }
});
