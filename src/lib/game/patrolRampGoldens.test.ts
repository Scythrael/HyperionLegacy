// Safe first runs SF-4 GOLDENS FIRST (docs/plans/2026-10-15-safe-first-runs-plan.md section 4 SF-4): the patrols the
// safe first patrol and the patrol ramp touch, captured on the code BEFORE either (on top of f85ef73), so SF-4's engine
// commit has to name every move it makes. Real dispatches through dispatchCaptainOnPatrol and the live economyTick
// loop (1 s ticks), nothing edited after dispatch (the SF-0 method, firstRunsGoldens.fixture.ts onHull):
//
//   1. ramp     : a new save whose one safe patrol is behind it (patrol.dispatched 1) with `c` won routes on the curve
//                 (c = 0: the curve's floor; 5: mid curve; 10: full strength), five hulls x both routes x master seeds
//                 1 and 2, Dispatch Once: the outcome, the dispatch record, the display replay of the cycle, the ship
//                 and the whole state at the end.
//   2. veteran  : the same patrols from a veteran save (a patrol flown before 0.14.0: the curve at full strength).
//   3. repeat   : a FRESH save's first patrol flown as Dispatch Repeatedly, up to four cycles: the state at each
//                 relaunch or the end, and the patrol counters after.
//   4. counts   : the patrol counters after a fresh save's first and second Dispatch Once patrols.
//   5. forecast : the dispatch card's Threat Assessment (App.svelte patrolForecastFor mirrored) on a fresh save, at the
//                 curve's floor and on a veteran save.
//
// SF-4's engine commit re-pins what it moves and names every move in the GOLDEN header.

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import { PATROLS, SHIP_TYPES, type GameState, type PatrolKey, type PatrolMissionState, type ShipTypeKey } from "./model";
import { dispatchCaptainOnPatrol, economyTick } from "./tick";
import { equippedFor } from "./equipment";
import { replayPatrol, resolvePatrolWaves } from "./combat/patrolReplay";
import { combatHullTypeOf, defaultSystemDurabilityForHull, foldedPlayerDefense, installedDronesForPatrol } from "./combat/bridge";
import { DEFAULT_SAMPLES } from "./combat/rating";
import { threatAssessment } from "./combat/threatAssessment";
import { hash, onHull, stateHash } from "./firstRunsGoldens.fixture";
import { runCountsOf } from "./runDifficulty";

const ROUTES = Object.keys(PATROLS) as PatrolKey[];
const RAMP_HULLS: ShipTypeKey[] = ["generalFreighter", "prospectorRunner", "destroyer", "carrier", "orion"];
const REPEAT_HULLS: ShipTypeKey[] = ["prospectorRunner", "destroyer", "carrier", "orion"];
const FORECAST_HULLS: ShipTypeKey[] = ["prospectorRunner", "destroyer", "orion"];
const RNG = (): number => 0.5;

const patrolOf = (s: GameState): PatrolMissionState | null => s.captains[0].mission as PatrolMissionState | null;

function base(hull: ShipTypeKey, seed: number): GameState {
  return { ...onHull(hull), nextPatrolSeed: seed, credits: new Decimal(100_000) };
}

// `state` with its one safe patrol behind it and `completed` won routes on the curve (not a veteran). Pure.
function onCurve(state: GameState, completed: number): GameState {
  const counts = runCountsOf(state);
  return { ...state, runCounts: { ...counts, patrol: { dispatched: 1, completed, veteran: false } } };
}

// `state` as a save that flew patrols before 0.14.0 (save v70's veteran derivation). Pure.
function asVeteran(state: GameState): GameState {
  const counts = runCountsOf(state);
  return { ...state, runCounts: { ...counts, patrol: { dispatched: 4, completed: 1, veteran: true } } };
}

// One Dispatch Once patrol from `state`, advanced in 1 s ticks until the captain idles.
function once(state: GameState, key: PatrolKey): { row: string[]; end: GameState } {
  const r = dispatchCaptainOnPatrol(state, 1, key, "balanced", false);
  expect(r.success, `${key}: ${r.reason}`).toBe(true);
  const record = structuredClone(r.next.captains[0].mission);
  const replay = hash(replayPatrol(r.next, r.next.captains[0]));
  let s = r.next;
  let ticks = 0;
  while (patrolOf(s) !== null) {
    s = economyTick(s, 1, RNG);
    ticks += 1;
    if (ticks > 2000) throw new Error("the patrol never ended");
  }
  const won = s.ships[0].damaged !== true;
  return { row: [`${won ? "won" : "lost"}:${ticks}`, hash(record), replay, hash(s.ships[0]), stateHash(s)], end: s };
}

function rows(state: (hull: ShipTypeKey, seed: number) => GameState, hulls: ShipTypeKey[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const hull of hulls) {
    out[hull] = ROUTES.flatMap((key) => [1, 2].flatMap((seed) => [`${key}:${seed}`, ...once(state(hull, seed), key).row]));
  }
  return out;
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
    });
    if (!result.defeated) wins += 1;
  }
  return `${wins}:${threatAssessment(wins, DEFAULT_SAMPLES).tier}`;
}

// Captured on f85ef73, before any SF-4 engine edit (no patrol reads the curve or a first-run profile).
const GOLDEN: Record<string, unknown> = {
  "ramp:generalFreighter:c0": [
    "crimsonReaverSweep:1", "won:14", "894fdcae", "5d83bda0", "b2f38143", "619f0aa1", "crimsonReaverSweep:2",
    "won:14", "78db202f", "c22e2a67", "b2f38143", "a247a79e", "crimsonReaverWarband:1", "lost:23", "4213eee4",
    "287f7c59", "701a58f1", "c3731d85", "crimsonReaverWarband:2", "lost:16", "36a28cca", "14a6bdbb", "701a58f1",
    "fea4cc5a",
  ],
  "ramp:prospectorRunner:c0": [
    "crimsonReaverSweep:1", "lost:10", "7a2a52c9", "2eff9144", "e1360e3a", "3458dee6", "crimsonReaverSweep:2",
    "won:14", "4be00ff0", "eb25810b", "c4afd62a", "8d243886", "crimsonReaverWarband:1", "lost:20", "254c266f",
    "a3a2ab0a", "e1360e3a", "7542ef9a", "crimsonReaverWarband:2", "lost:16", "814a58cd", "e8698fd8", "e1360e3a",
    "92dadd8",
  ],
  "ramp:destroyer:c0": [
    "crimsonReaverSweep:1", "won:14", "c614f4e", "6ca86c97", "6ad9f46c", "d4055219", "crimsonReaverSweep:2",
    "won:14", "612de50b", "5bcbe01c", "6ad9f46c", "63ce63c0", "crimsonReaverWarband:1", "won:22", "6993bb20",
    "c4d5c140", "6ad9f46c", "94a165d6", "crimsonReaverWarband:2", "lost:16", "ceb37f8a", "855a1284", "44b4c6b5",
    "c94abb2d",
  ],
  "ramp:carrier:c0": [
    "crimsonReaverSweep:1", "won:14", "d5718c2f", "9e9d9838", "ea909677", "9554bb6e", "crimsonReaverSweep:2",
    "won:14", "e9a099c5", "d1d7454a", "ea909677", "89e39fc9", "crimsonReaverWarband:1", "won:22", "47f02015",
    "4a94c4ae", "ea909677", "15006abb", "crimsonReaverWarband:2", "lost:17", "95fd3dd4", "f854ab6", "73109288",
    "950bcb53",
  ],
  "ramp:orion:c0": [
    "crimsonReaverSweep:1", "won:14", "35ea9697", "9ce7446b", "c75858d4", "9f06f3dd", "crimsonReaverSweep:2",
    "won:14", "3e13cff2", "ae9d190a", "c75858d4", "97d18578", "crimsonReaverWarband:1", "lost:20", "69062df5",
    "b2fac903", "6619cb48", "20b8680", "crimsonReaverWarband:2", "lost:16", "ba65b5fb", "432452a6", "6619cb48",
    "b6b37c6e",
  ],
  "ramp:generalFreighter:c5": [
    "crimsonReaverSweep:1", "won:14", "894fdcae", "5d83bda0", "b2f38143", "619f0aa1", "crimsonReaverSweep:2",
    "won:14", "78db202f", "c22e2a67", "b2f38143", "a247a79e", "crimsonReaverWarband:1", "lost:23", "4213eee4",
    "287f7c59", "701a58f1", "c3731d85", "crimsonReaverWarband:2", "lost:16", "36a28cca", "14a6bdbb", "701a58f1",
    "fea4cc5a",
  ],
  "ramp:prospectorRunner:c5": [
    "crimsonReaverSweep:1", "lost:10", "7a2a52c9", "2eff9144", "e1360e3a", "3458dee6", "crimsonReaverSweep:2",
    "won:14", "4be00ff0", "eb25810b", "c4afd62a", "8d243886", "crimsonReaverWarband:1", "lost:20", "254c266f",
    "a3a2ab0a", "e1360e3a", "7542ef9a", "crimsonReaverWarband:2", "lost:16", "814a58cd", "e8698fd8", "e1360e3a",
    "92dadd8",
  ],
  "ramp:destroyer:c5": [
    "crimsonReaverSweep:1", "won:14", "c614f4e", "6ca86c97", "6ad9f46c", "d4055219", "crimsonReaverSweep:2",
    "won:14", "612de50b", "5bcbe01c", "6ad9f46c", "63ce63c0", "crimsonReaverWarband:1", "won:22", "6993bb20",
    "c4d5c140", "6ad9f46c", "94a165d6", "crimsonReaverWarband:2", "lost:16", "ceb37f8a", "855a1284", "44b4c6b5",
    "c94abb2d",
  ],
  "ramp:carrier:c5": [
    "crimsonReaverSweep:1", "won:14", "d5718c2f", "9e9d9838", "ea909677", "9554bb6e", "crimsonReaverSweep:2",
    "won:14", "e9a099c5", "d1d7454a", "ea909677", "89e39fc9", "crimsonReaverWarband:1", "won:22", "47f02015",
    "4a94c4ae", "ea909677", "15006abb", "crimsonReaverWarband:2", "lost:17", "95fd3dd4", "f854ab6", "73109288",
    "950bcb53",
  ],
  "ramp:orion:c5": [
    "crimsonReaverSweep:1", "won:14", "35ea9697", "9ce7446b", "c75858d4", "9f06f3dd", "crimsonReaverSweep:2",
    "won:14", "3e13cff2", "ae9d190a", "c75858d4", "97d18578", "crimsonReaverWarband:1", "lost:20", "69062df5",
    "b2fac903", "6619cb48", "20b8680", "crimsonReaverWarband:2", "lost:16", "ba65b5fb", "432452a6", "6619cb48",
    "b6b37c6e",
  ],
  "ramp:generalFreighter:c10": [
    "crimsonReaverSweep:1", "won:14", "894fdcae", "5d83bda0", "b2f38143", "619f0aa1", "crimsonReaverSweep:2",
    "won:14", "78db202f", "c22e2a67", "b2f38143", "a247a79e", "crimsonReaverWarband:1", "lost:23", "4213eee4",
    "287f7c59", "701a58f1", "c3731d85", "crimsonReaverWarband:2", "lost:16", "36a28cca", "14a6bdbb", "701a58f1",
    "fea4cc5a",
  ],
  "ramp:prospectorRunner:c10": [
    "crimsonReaverSweep:1", "lost:10", "7a2a52c9", "2eff9144", "e1360e3a", "3458dee6", "crimsonReaverSweep:2",
    "won:14", "4be00ff0", "eb25810b", "c4afd62a", "8d243886", "crimsonReaverWarband:1", "lost:20", "254c266f",
    "a3a2ab0a", "e1360e3a", "7542ef9a", "crimsonReaverWarband:2", "lost:16", "814a58cd", "e8698fd8", "e1360e3a",
    "92dadd8",
  ],
  "ramp:destroyer:c10": [
    "crimsonReaverSweep:1", "won:14", "c614f4e", "6ca86c97", "6ad9f46c", "d4055219", "crimsonReaverSweep:2",
    "won:14", "612de50b", "5bcbe01c", "6ad9f46c", "63ce63c0", "crimsonReaverWarband:1", "won:22", "6993bb20",
    "c4d5c140", "6ad9f46c", "94a165d6", "crimsonReaverWarband:2", "lost:16", "ceb37f8a", "855a1284", "44b4c6b5",
    "c94abb2d",
  ],
  "ramp:carrier:c10": [
    "crimsonReaverSweep:1", "won:14", "d5718c2f", "9e9d9838", "ea909677", "9554bb6e", "crimsonReaverSweep:2",
    "won:14", "e9a099c5", "d1d7454a", "ea909677", "89e39fc9", "crimsonReaverWarband:1", "won:22", "47f02015",
    "4a94c4ae", "ea909677", "15006abb", "crimsonReaverWarband:2", "lost:17", "95fd3dd4", "f854ab6", "73109288",
    "950bcb53",
  ],
  "ramp:orion:c10": [
    "crimsonReaverSweep:1", "won:14", "35ea9697", "9ce7446b", "c75858d4", "9f06f3dd", "crimsonReaverSweep:2",
    "won:14", "3e13cff2", "ae9d190a", "c75858d4", "97d18578", "crimsonReaverWarband:1", "lost:20", "69062df5",
    "b2fac903", "6619cb48", "20b8680", "crimsonReaverWarband:2", "lost:16", "ba65b5fb", "432452a6", "6619cb48",
    "b6b37c6e",
  ],
  "veteran:generalFreighter": [
    "crimsonReaverSweep:1", "won:14", "894fdcae", "5d83bda0", "b2f38143", "619f0aa1", "crimsonReaverSweep:2",
    "won:14", "78db202f", "c22e2a67", "b2f38143", "a247a79e", "crimsonReaverWarband:1", "lost:23", "4213eee4",
    "287f7c59", "701a58f1", "c3731d85", "crimsonReaverWarband:2", "lost:16", "36a28cca", "14a6bdbb", "701a58f1",
    "fea4cc5a",
  ],
  "veteran:prospectorRunner": [
    "crimsonReaverSweep:1", "lost:10", "7a2a52c9", "2eff9144", "e1360e3a", "3458dee6", "crimsonReaverSweep:2",
    "won:14", "4be00ff0", "eb25810b", "c4afd62a", "8d243886", "crimsonReaverWarband:1", "lost:20", "254c266f",
    "a3a2ab0a", "e1360e3a", "7542ef9a", "crimsonReaverWarband:2", "lost:16", "814a58cd", "e8698fd8", "e1360e3a",
    "92dadd8",
  ],
  "veteran:destroyer": [
    "crimsonReaverSweep:1", "won:14", "c614f4e", "6ca86c97", "6ad9f46c", "d4055219", "crimsonReaverSweep:2",
    "won:14", "612de50b", "5bcbe01c", "6ad9f46c", "63ce63c0", "crimsonReaverWarband:1", "won:22", "6993bb20",
    "c4d5c140", "6ad9f46c", "94a165d6", "crimsonReaverWarband:2", "lost:16", "ceb37f8a", "855a1284", "44b4c6b5",
    "c94abb2d",
  ],
  "veteran:carrier": [
    "crimsonReaverSweep:1", "won:14", "d5718c2f", "9e9d9838", "ea909677", "9554bb6e", "crimsonReaverSweep:2",
    "won:14", "e9a099c5", "d1d7454a", "ea909677", "89e39fc9", "crimsonReaverWarband:1", "won:22", "47f02015",
    "4a94c4ae", "ea909677", "15006abb", "crimsonReaverWarband:2", "lost:17", "95fd3dd4", "f854ab6", "73109288",
    "950bcb53",
  ],
  "veteran:orion": [
    "crimsonReaverSweep:1", "won:14", "35ea9697", "9ce7446b", "c75858d4", "9f06f3dd", "crimsonReaverSweep:2",
    "won:14", "3e13cff2", "ae9d190a", "c75858d4", "97d18578", "crimsonReaverWarband:1", "lost:20", "69062df5",
    "b2fac903", "6619cb48", "20b8680", "crimsonReaverWarband:2", "lost:16", "ba65b5fb", "432452a6", "6619cb48",
    "b6b37c6e",
  ],
  "repeat:prospectorRunner": [
    "crimsonReaverSweep:end@10:damaged:3458dee6", "{\"dispatched\":1,\"completed\":0,\"veteran\":false}",
    "crimsonReaverWarband:end@20:damaged:7542ef9a", "{\"dispatched\":1,\"completed\":0,\"veteran\":false}",
  ],
  "repeat:destroyer": [
    "crimsonReaverSweep:relaunch@14:afcac89,relaunch@28:c96cc621,relaunch@42:d3b44caa,relaunch@56:4ccd8722",
    "{\"dispatched\":1,\"completed\":4,\"veteran\":false}",
    "crimsonReaverWarband:relaunch@22:f2452ff4,end@38:damaged:db558c17",
    "{\"dispatched\":1,\"completed\":1,\"veteran\":false}",
  ],
  "repeat:carrier": [
    "crimsonReaverSweep:relaunch@14:a3d137e9,relaunch@28:d833511a,relaunch@42:52dc8d96,relaunch@56:4146307c",
    "{\"dispatched\":1,\"completed\":4,\"veteran\":false}",
    "crimsonReaverWarband:relaunch@22:86753956,end@38:damaged:5d7605b4",
    "{\"dispatched\":1,\"completed\":1,\"veteran\":false}",
  ],
  "repeat:orion": [
    "crimsonReaverSweep:relaunch@14:89404b40,relaunch@28:f576fffe,relaunch@42:9bf01359,relaunch@56:b5cc3759",
    "{\"dispatched\":1,\"completed\":4,\"veteran\":false}", "crimsonReaverWarband:end@20:damaged:20b8680",
    "{\"dispatched\":1,\"completed\":0,\"veteran\":false}",
  ],
  "counts:destroyer": [
    "crimsonReaverSweep:won:14:{\"dispatched\":1,\"completed\":1,\"veteran\":false}:won:14:{\"dispatched\":2,\"completed\":2,\"veteran\":false}",
    "crimsonReaverWarband:won:22:{\"dispatched\":1,\"completed\":1,\"veteran\":false}:lost:16:{\"dispatched\":2,\"completed\":1,\"veteran\":false}",
  ],
  "forecast": [
    "prospectorRunner:crimsonReaverSweep:37:dice:37:dice:37:dice",
    "prospectorRunner:crimsonReaverWarband:0:impossible:0:impossible:0:impossible",
    "destroyer:crimsonReaverSweep:64:guaranteed:64:guaranteed:64:guaranteed",
    "destroyer:crimsonReaverWarband:11:extreme:11:extreme:11:extreme",
    "orion:crimsonReaverSweep:60:likely:60:likely:60:likely",
    "orion:crimsonReaverWarband:0:impossible:0:impossible:0:impossible",
  ],
};

function pin(key: string, value: unknown): void {
  expect(value, key).toEqual(GOLDEN[key]);
}

describe("SF-4 goldens 1 and 2: patrols on the curve and from a veteran save", () => {
  for (const c of [0, 5, 10]) {
    it(`a new save at ${c} won routes on the curve: five hulls x both routes x seeds 1 and 2`, () => {
      const out = rows((hull, seed) => onCurve(base(hull, seed), c), RAMP_HULLS);
      for (const hull of RAMP_HULLS) pin(`ramp:${hull}:c${c}`, out[hull]);
    });
  }
  it("a veteran save: five hulls x both routes x seeds 1 and 2", () => {
    const out = rows((hull, seed) => asVeteran(base(hull, seed)), RAMP_HULLS);
    for (const hull of RAMP_HULLS) pin(`veteran:${hull}`, out[hull]);
  });
});

describe("SF-4 goldens 3 and 4: a fresh save's first patrols", () => {
  it("Dispatch Repeatedly from a fresh save: up to four cycles, and the patrol counters after", () => {
    for (const hull of REPEAT_HULLS) {
      const out: string[] = [];
      for (const key of ROUTES) {
        const r = dispatchCaptainOnPatrol(base(hull, 1), 1, key, "balanced", true);
        expect(r.success).toBe(true);
        let s = r.next;
        let prev = patrolOf(s)!.phase;
        const marks: string[] = [];
        for (let t = 1; t <= 4000 && marks.length < 4; t++) {
          s = economyTick(s, 1, RNG);
          const m = patrolOf(s);
          if (m === null) {
            marks.push(`end@${t}:${s.ships[0].damaged === true ? "damaged" : "intact"}:${stateHash(s)}`);
            break;
          }
          if (prev === "transitBack" && m.phase === "transitOut") marks.push(`relaunch@${t}:${stateHash(s)}`);
          prev = m.phase;
        }
        out.push(`${key}:${marks.join(",")}`, JSON.stringify(runCountsOf(s).patrol));
      }
      pin(`repeat:${hull}`, out);
    }
  });

  it("the counters after a fresh save's first and second Dispatch Once patrols (destroyer, both routes)", () => {
    const out: string[] = [];
    for (const key of ROUTES) {
      const first = once(base("destroyer", 1), key);
      const second = once(first.end, key);
      out.push(`${key}:${first.row[0]}:${JSON.stringify(runCountsOf(first.end).patrol)}:${second.row[0]}:${JSON.stringify(runCountsOf(second.end).patrol)}`);
    }
    pin("counts:destroyer", out);
  });
});

describe("SF-4 golden 5: the dispatch card's Threat Assessment", () => {
  it("a fresh save, the curve's floor and a veteran save, three hulls x both routes", () => {
    const out = FORECAST_HULLS.flatMap((hull) =>
      ROUTES.map((key) => `${hull}:${key}:${forecast(onHull(hull), key)}:${forecast(onCurve(onHull(hull), 0), key)}:${forecast(asVeteran(onHull(hull)), key)}`),
    );
    pin("forecast", out);
  });
});
