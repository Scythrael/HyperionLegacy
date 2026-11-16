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

// The ordering determinism slice (canonicalOrder.ts: `discovered` and the lifetime tally maps kept in canonical order)
// came after every pin here: the file runs with it off (orderingSwitch.fixture.ts), so its pins keep proving their own
// slice (orderingGoldens.test.ts pins the order move and proves it moved order only).
import { canonicalOrderOffForThisFile } from "./orderingSwitch.fixture";
canonicalOrderOffForThisFile();
// Ordering determinism part 2 (canonicalOrder.ts: inventory keys and a call's completion log in one order) came after every pin here, traced order-only: the file runs with it off (ordering2Switch.fixture.ts).
import { ordering2OffForThisFile } from "./ordering2Switch.fixture";
ordering2OffForThisFile();
import { describe, expect, it } from "vitest";
import { cp16OffForThisFile } from "./cp16Switch.fixture";
// Complement CP-16 (the Hall of Command) came after every pin here: the file runs with the slice off, so its pins
// keep proving their own slice (cp16Goldens.test.ts pins what CP-16 moved: the missions counter, the notables and
// the Hall of Command entry).
cp16OffForThisFile();
import Decimal from "break_infinity.js";
import { PATROLS, SHIP_TYPES, type GameState, type PatrolKey, type PatrolMissionState, type ShipTypeKey } from "./model";
import { dispatchCaptainOnPatrol, economyTick } from "./tick";
import { equippedFor } from "./equipment";
import { replayPatrol, resolvePatrolWaves } from "./combat/patrolReplay";
import { combatHullTypeOf, defaultSystemDurabilityForHull, foldedPlayerDefense, installedDronesForPatrol } from "./combat/bridge";
import { DEFAULT_SAMPLES } from "./combat/rating";
import { threatAssessment } from "./combat/threatAssessment";
import { hash, onHull, stateHash } from "./firstRunsGoldens.fixture";
import { patrolDifficultyAt, runCountsOf } from "./runDifficulty";
// WR-8 (0.14.0): every pin in this file was taken before the combat rules (combatRulesSwitch.fixture.ts), so the file
// runs with them switched off and its pins keep proving WR-8 moved nothing else here (the rules stamp new patrol
// cycles and runs; combatDescriptorGoldens.test.ts pins the combat rules themselves).
import { combatRulesOffForThisFile } from "./combatRulesSwitch.fixture";
import { patrolLegsOffForThisFile } from "./patrolLegsSwitch.fixture";

// WR-7 follow-up OC-D8 (patrol legs scale with transit speed): every pin here predates the legs and is about safe first runs SF-4 (the patrol curve);
// with the legs off each one returns (checked when the legs were wired), so the file runs with them off and keeps
// proving its own slice. patrolLegsGoldens.test.ts pins the legs on every patrol and every combat hull.
patrolLegsOffForThisFile();
combatRulesOffForThisFile();
// Gear wear step 4 (0.14.0): the same for battle wear (battleWearSwitch.fixture.ts): the pins predate it, and a patrol
// cycle stamped for it fights its carried wear (gearWearCombatGoldens.test.ts pins that).
import { battleWearOffInThisFile } from "./battleWearSwitch.fixture";
import { fixRoundESwitchesOffForThisFile } from "./fixRoundESwitch.fixture";

// Fix round FR-E (0.14.0): the stop rule (lane 4 q3, PATROL_STOP_DOOMED_SWITCH: Repeat stops "outmatched" before a
// route it would lose even fully repaired) moves the Dispatch Repeatedly row (a cycle meets a route it would lose). The
// pins here predate the round and are about another slice, so the file runs with that fix off
// (fixRoundESwitch.fixture.ts); every other fix of the round runs here. The round's own pins: patrolFixRoundE.test.ts.
fixRoundESwitchesOffForThisFile("stopDoomed");
battleWearOffInThisFile();

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
      // SF-4: the difficulty a dispatch would stamp now (App.svelte passes the same).
      difficulty: patrolDifficultyAt(state),
    });
    if (!result.defeated) wins += 1;
  }
  return `${wins}:${threatAssessment(wins, DEFAULT_SAMPLES).tier}`;
}

// Captured on f85ef73, before any SF-4 engine edit (no patrol reads the curve or a first-run profile). RE-PINNED BY
// SF-4, each move on purpose:
//   ramp:*:c0          the curve's floor: the route's own waves with every enemy at 0.35 of nominal (the stamp
//                      `difficulty: { version 1, firstRun false, ramp 0, tier 1, completed 0 }` on the record, so every
//                      record hash moves). Won now: the freighter's, destroyer's and carrier's Warbands, the Runner's
//                      Sweep seed 1 and the Runner's and Orion's Warband seed 1 (was lost); still lost: the Runner's and
//                      Orion's Warband seed 2.
//   ramp:*:c5          mid curve (strength 0.35 + 0.65 x rampFraction(5)): the same wins but the freighter's Warband
//                      seed 2, lost again.
//   repeat:*           a fresh save's first cycle is the training cycle (2 waves of 1 Raider), so the Runner flies its
//                      Sweep on (was lost at tick 10) and every Warband relaunches; the relaunched cycles climb the curve
//                      (the destroyer's and carrier's Warbands now fly four cycles; the Runner's and Orion's lose the
//                      floor cycle at tick 38). The counters: the training route never counts (Sweep 3 of 4 routes).
//                      SF-4 MERGE (user 2026-10-21 "One step per patrol run"): a Repeat run keeps ONE curve position
//                      for every route, so the training run's later cycles all fly the floor (no climb) and the run
//                      counts nothing (the counters read completed 0, was 3); every relaunch hash after the first moved.
//   counts:destroyer   the training route is off the curve (completed 0 after the first patrol, was 1), and the second
//                      patrol at the floor now wins the Warband.
//   forecast           the card forecasts the dispatch's own profile: Guaranteed on a fresh save (the training cycle),
//                      the floor's real band after it (Runner Warband 15 of 64, Orion Warband 34), the veteran unchanged.
// UNCHANGED, the proof that full strength is the pre-SF-4 game: every ramp:*:c10 row (the top of the curve stores no
// stamp) and every veteran:* row.
const GOLDEN: Record<string, unknown> = {
  "ramp:generalFreighter:c0": [
    "crimsonReaverSweep:1", "won:14", "dab0e126", "e10668bb", "b2f38143", "619f0aa1", "crimsonReaverSweep:2",
    "won:14", "9bcf9987", "39341c86", "b2f38143", "a247a79e", "crimsonReaverWarband:1", "won:22", "73c0b42c",
    "1c01d1b1", "b2f38143", "6e917796", "crimsonReaverWarband:2", "won:22", "cbeb0462", "d42e97c0", "b2f38143",
    "5ce7f81d",
  ],
  "ramp:prospectorRunner:c0": [
    "crimsonReaverSweep:1", "won:14", "57dfe011", "217bcdda", "c4afd62a", "9a22f569", "crimsonReaverSweep:2",
    "won:14", "ac686298", "124e35dd", "c4afd62a", "8d243886", "crimsonReaverWarband:1", "won:22", "b86ec607",
    "93c0233", "c4afd62a", "e7e6129c", "crimsonReaverWarband:2", "lost:16", "ce930375", "1e3995da", "e1360e3a",
    "92dadd8",
  ],
  "ramp:destroyer:c0": [
    "crimsonReaverSweep:1", "won:14", "6b2c54c6", "86dd5abe", "6ad9f46c", "d4055219", "crimsonReaverSweep:2",
    "won:14", "10580e63", "df48132d", "6ad9f46c", "63ce63c0", "crimsonReaverWarband:1", "won:22", "dc1f0e08",
    "f7429bf3", "6ad9f46c", "94a165d6", "crimsonReaverWarband:2", "won:22", "488980a2", "63f21fe2", "6ad9f46c",
    "1a38b167",
  ],
  "ramp:carrier:c0": [
    "crimsonReaverSweep:1", "won:14", "bc4d4b87", "23fa791d", "ea909677", "9554bb6e", "crimsonReaverSweep:2",
    "won:14", "ec7ddb1d", "44c60066", "ea909677", "89e39fc9", "crimsonReaverWarband:1", "won:22", "b51c379d",
    "c7839938", "ea909677", "15006abb", "crimsonReaverWarband:2", "won:22", "c8d16a2c", "2f35d82c", "ea909677",
    "9602855c",
  ],
  "ramp:orion:c0": [
    "crimsonReaverSweep:1", "won:14", "8852f5af", "79a5635", "c75858d4", "9f06f3dd", "crimsonReaverSweep:2",
    "won:14", "ce36d4a", "3b6092e4", "c75858d4", "97d18578", "crimsonReaverWarband:1", "won:22", "8fee28fd",
    "3aff3854", "c75858d4", "3af40022", "crimsonReaverWarband:2", "lost:16", "f154a2f3", "6059fc35", "6619cb48",
    "b6b37c6e",
  ],
  "ramp:generalFreighter:c5": [
    "crimsonReaverSweep:1", "won:14", "bb0166a5", "e6e9e0cd", "b2f38143", "619f0aa1", "crimsonReaverSweep:2",
    "won:14", "942385ae", "a8b2b03a", "b2f38143", "a247a79e", "crimsonReaverWarband:1", "won:22", "a33a85c3",
    "f98792b2", "b2f38143", "6e917796", "crimsonReaverWarband:2", "lost:16", "15483b3b", "4673edc7", "701a58f1",
    "fea4cc5a",
  ],
  "ramp:prospectorRunner:c5": [
    "crimsonReaverSweep:1", "won:14", "19236e16", "431aede1", "c4afd62a", "9a22f569", "crimsonReaverSweep:2",
    "won:14", "2e256bc9", "e6c040c4", "c4afd62a", "8d243886", "crimsonReaverWarband:1", "won:22", "d5bbdd0c",
    "ac4d4437", "c4afd62a", "e7e6129c", "crimsonReaverWarband:2", "lost:16", "ad2445f4", "7d679484", "e1360e3a",
    "92dadd8",
  ],
  "ramp:destroyer:c5": [
    "crimsonReaverSweep:1", "won:14", "9bbeba4d", "eb99d32f", "6ad9f46c", "d4055219", "crimsonReaverSweep:2",
    "won:14", "661184e", "9fb261f3", "6ad9f46c", "63ce63c0", "crimsonReaverWarband:1", "won:22", "21bc4eaf",
    "c52fa955", "6ad9f46c", "94a165d6", "crimsonReaverWarband:2", "won:22", "82f4567", "2a9a593f", "6ad9f46c",
    "1a38b167",
  ],
  "ramp:carrier:c5": [
    "crimsonReaverSweep:1", "won:14", "48969090", "ed61717f", "ea909677", "9554bb6e", "crimsonReaverSweep:2",
    "won:14", "96b4f570", "fbb11afb", "ea909677", "89e39fc9", "crimsonReaverWarband:1", "won:22", "675acc9e",
    "3acc50e1", "ea909677", "15006abb", "crimsonReaverWarband:2", "won:22", "456355a9", "c9d2b749", "ea909677",
    "9602855c",
  ],
  "ramp:orion:c5": [
    "crimsonReaverSweep:1", "won:14", "43a78df8", "6a79ed2", "c75858d4", "9f06f3dd", "crimsonReaverSweep:2",
    "won:14", "e9e5af97", "ec68b2", "c75858d4", "97d18578", "crimsonReaverWarband:1", "won:22", "852e51e",
    "49db7310", "c75858d4", "3af40022", "crimsonReaverWarband:2", "lost:16", "74974f76", "4472ba50", "6619cb48",
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
    "crimsonReaverSweep:relaunch@14:d57555c2,relaunch@28:f7ed7432,relaunch@42:c3520bd1,relaunch@56:2b0b73e3",
    "{\"dispatched\":1,\"completed\":0,\"veteran\":false}",
    "crimsonReaverWarband:relaunch@22:ccb5e217,end@38:damaged:dd06458",
    "{\"dispatched\":1,\"completed\":0,\"veteran\":false}",
  ],
  "repeat:destroyer": [
    "crimsonReaverSweep:relaunch@14:f0981ffd,relaunch@28:bca9db2d,relaunch@42:bfacfaf6,relaunch@56:c57b937e",
    "{\"dispatched\":1,\"completed\":0,\"veteran\":false}",
    "crimsonReaverWarband:relaunch@22:4ab039c4,relaunch@44:d0ab4325,relaunch@66:6581ddc8,relaunch@88:fea94f80",
    "{\"dispatched\":1,\"completed\":0,\"veteran\":false}",
  ],
  "repeat:carrier": [
    "crimsonReaverSweep:relaunch@14:508ac4d5,relaunch@28:629760e6,relaunch@42:4511fb52,relaunch@56:d82aa7b8",
    "{\"dispatched\":1,\"completed\":0,\"veteran\":false}",
    "crimsonReaverWarband:relaunch@22:653d1be6,relaunch@44:f7e7c9c0,relaunch@66:526cb10,relaunch@88:94c6a5e",
    "{\"dispatched\":1,\"completed\":0,\"veteran\":false}",
  ],
  "repeat:orion": [
    "crimsonReaverSweep:relaunch@14:557dcd54,relaunch@28:41a1dc4a,relaunch@42:382e08f5,relaunch@56:8c3870f5",
    "{\"dispatched\":1,\"completed\":0,\"veteran\":false}",
    "crimsonReaverWarband:relaunch@22:29c1bc99,end@38:damaged:77152b3a",
    "{\"dispatched\":1,\"completed\":0,\"veteran\":false}",
  ],
  "counts:destroyer": [
    "crimsonReaverSweep:won:14:{\"dispatched\":1,\"completed\":0,\"veteran\":false}:won:14:{\"dispatched\":2,\"completed\":1,\"veteran\":false}",
    "crimsonReaverWarband:won:22:{\"dispatched\":1,\"completed\":0,\"veteran\":false}:won:22:{\"dispatched\":2,\"completed\":1,\"veteran\":false}",
  ],
  "forecast": [
    "prospectorRunner:crimsonReaverSweep:64:guaranteed:64:guaranteed:37:dice",
    "prospectorRunner:crimsonReaverWarband:64:guaranteed:15:notAdvised:0:impossible",
    "destroyer:crimsonReaverSweep:64:guaranteed:64:guaranteed:64:guaranteed",
    "destroyer:crimsonReaverWarband:64:guaranteed:64:guaranteed:11:extreme",
    "orion:crimsonReaverSweep:64:guaranteed:64:guaranteed:60:likely",
    "orion:crimsonReaverWarband:64:guaranteed:34:dice:0:impossible",
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
