// Safe First Runs SF-0 (docs/plans/2026-10-15-safe-first-runs-plan.md section 4 SF-0): golden hashes and outcome
// tables captured on the code BEFORE any safe-first-runs engine edit (on top of bfac15f). They are the "today" record
// every later slice compares against: SF-2 (the safe first expedition) and SF-4 (the safe first patrol) MOVE the first
// run goldens on purpose and must name each move; everything a veteran or a later run does stays put unless SF-3 or
// SF-4 names it. Whole serialized records, never a narrow subset; every whole STATE goes through stateHash (no
// `runCounts`, no `homeworld`), so SF-1's counters and G2-1's homeworld move nothing by themselves:
//
//   1. fresh    : the "first" predicates of a new save (nextExpeditionId 1, nextPatrolSeed 1, the default expedition
//                 seed, no away members, no completed mission key) and the fresh recruit board (section 2.2).
//   2. patrol   : the WHOLE first cycle (Dispatch Once) from freshState for every hull x both routes at master seeds 1
//                 and 2 (the dispatch record, the display replay at every route tick, the ship, the completion log, the
//                 whole state); a Repeat patrol's first two cycles at seed 1; the SECOND patrol of a save (dispatched
//                 from the state the won first one left); closed-form parity.
//   3. gather   : one delivered cycle for every MISSIONS key x every hull (the refusal for a hull that cannot fly it).
//   4. first    : the section 2.5 A runs: the FIRST expedition of the three fresh-save candidates from the General
//                 Freighter, Orion, Aurora and Eir with every section 2.5 crew (firstRunsGoldens.fixture.ts): the
//                 dispatch record, the run at 3,000,000 s and (a finished run) the claimed state; the launch view of
//                 the first run; offline == live parity on the Orion's training run. RE-PINNED by SF-2 (see GOLDEN).
//   5. later    : later expeditions: the same candidates as expedition 2 and expedition 11, and a REAL second run
//                 dispatched after the first one is claimed.
//   6. guards   : generateEncounter for the Vault and Subterranean guards (and three ordinary sites) at every hazard
//                 the Tier I planet types carry and between (the hazard-scaled guards section 3.5 bounds).
//   7. old save : a v69 save that already flew expeditions and a patrol, through deserialize + migrate, then one patrol
//                 cycle and one expedition run (old saves count as veterans: unchanged from SF-1 to SF-4).
// GATED (SF_SWEEP set, or `npm run test:sweep`): the pure measurement tables, i.e. the dispatch card's Threat
// Assessment bands, the section 2.5 E 200-seed win table and the readable section 2.5 A outcome lines. The section 2.5
// B table (60 Tier I seeds) lives in firstRunsGoldens.sweep.test.ts (7 seeds in the default run, all 60 gated).
//
// THE G2-0 GOLDENS (expeditionTiersGoldens.test.ts) are the other half of this record: golden 1 (the stored in-flight
// runs) must stay unchanged in EVERY SF slice; golden 2's expedition 1 dispatches (the shakedowns, rank 10 crews) are
// compared as dispatched before SF-2 (awayTeamTestFixtures.ts asPreSafeFirstRunsDispatch: no stamp, the shakedown).

import { describe, expect, it } from "vitest";
import { hullCrewCapsOffForThisFile } from "./hullCrewCapsSwitch.fixture";
// Complement plan CP-5 (per-hull crew caps): every pin here predates CP-5 and is about another slice, so the file runs
// with the per-hull caps off (hullCrewCapsSwitch.fixture.ts); cp5Goldens.test.ts pins what CP-5 moved.
hullCrewCapsOffForThisFile();
// GEAR WEAR step 3: this file's pins were captured before the use wear engine; it runs with the use sources off
// (gearWearSwitch.fixture.ts), so they keep proving nothing else moved. gearWearGoldens.test.ts pins the wear.
import { gearWearOffInThisFile } from "./gearWearSwitch.fixture";
import { patrolLegsOffForThisFile } from "./patrolLegsSwitch.fixture";
import { wr9OffForThisFile } from "./wr9Switch.fixture";

// Wiring WR-9: this file's pins are about other slices and were captured before WR-9; it runs with WR-9 off (the
// WR-9 moves are pinned and proven in wr9Goldens.test.ts), so every pin here keeps proving its own slice exactly.
wr9OffForThisFile();

// WR-7 follow-up OC-D8 (patrol legs scale with transit speed): every pin here predates the legs and is about safe first runs;
// with the legs off each one returns (checked when the legs were wired), so the file runs with them off and keeps
// proving its own slice. patrolLegsGoldens.test.ts pins the legs on every patrol and every combat hull.
patrolLegsOffForThisFile();
gearWearOffInThisFile();
import Decimal from "break_infinity.js";
import {
  EXPEDITION_DEFAULT_SEED,
  freshState,
  MISSIONS,
  PATROLS,
  SHIP_TYPES,
  SUBSPACE_TELESCOPE_FACILITY_KEY,
  type Expedition,
  type GameState,
  type MissionKey,
  type PatrolKey,
  type PatrolMissionState,
  type ShipTypeKey,
} from "./model";
import { advanceExpedition, advanceExpeditionSeed, claimExpedition, expeditionCandidates, expeditionLaunchView } from "./expedition";
import { deserialize, migrate, serialize, type SaveFile } from "./save";
import { canDispatch, dispatchCaptainOnMission, dispatchCaptainOnPatrol, economyTick } from "./tick";
import { awayRecruitCandidates } from "./awayTeam";
import { generateEncounter } from "./gambit";
import { equippedFor } from "./equipment";
import { replayPatrol, resolvePatrolWaves } from "./combat/patrolReplay";
import { combatHullTypeOf, defaultSystemDurabilityForHull, foldedPlayerDefense, installedDronesForPatrol, shipToCombatant } from "./combat/bridge";
import { battleRating, DEFAULT_SAMPLES } from "./combat/rating";
import { threatAssessment } from "./combat/threatAssessment";
import { CREW_NAMES, hash, onHull, runOutcome, stateHash, SWEEP, SWEEP_END, withCrew, type CrewName, type RunOutcome } from "./firstRunsGoldens.fixture";
import { asPreG2Candidate, asPreG2NamesDispatch, asPreRanksDispatch, dispatchPastPropulsion, asPatrolVeteran } from "./awayTeamTestFixtures";
import { patrolDifficultyAt } from "./runDifficulty";
import { isTrainingRun } from "./enemyRanks";
// WR-8 (0.14.0): every pin in this file was taken before the combat rules (combatRulesSwitch.fixture.ts), so the file
// runs with them switched off and its pins keep proving WR-8 moved nothing else here (the rules stamp new patrol
// cycles and runs; combatDescriptorGoldens.test.ts pins the combat rules themselves).
import { combatRulesOffForThisFile } from "./combatRulesSwitch.fixture";
import { wr11OffForThisFile } from "./wr11Switch.fixture";
combatRulesOffForThisFile();
// Wiring WR-11 came after every pin here: the whole file runs with WR-11 off (wr11Switch.fixture.ts), so its pins keep
// proving their own slice moved nothing else (WR-11's own moves are pinned in wr11Goldens.test.ts).
wr11OffForThisFile();

// ===== shared helpers =====

const HULLS = Object.keys(SHIP_TYPES) as ShipTypeKey[];
const ROUTES = Object.keys(PATROLS) as PatrolKey[];
const CANDS = ["cand-0", "cand-1", "cand-2"];
const RNG = (): number => 0.5;

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// A run outcome as one readable line: phase, objectives done / total, lost fights, send-backs, stuck sites, hull
// damage, ship-event setbacks, credits taken by boardings, Vault / Subterranean sites.
function line(o: RunOutcome): string {
  return `${o.phase} ${o.objectives} lost:${o.lostFights} sent:${o.sentBack} stuck:${o.stuck.join("+") || "none"} hull:${o.hullDamage} setbacks:${o.setbacks} boarded:${o.boardingLoss} vault:${o.vaultSites}`;
}

// ===== the goldens =====

// Captured on the code BEFORE any safe-first-runs engine edit (SF-0, on top of bfac15f). Line layouts: patrol = per
// route and seed [route:seed:outcome:ticks, dispatch record, replays, ship, completion log, state] (+ [second:outcome:
// ticks, record, state] after a won seed 1); first / later = per candidate [dispatch record, run at 3,000,000 s, claim
// or "unclaimed"] (the "lines:" keys hold the gated outcome lines of the same runs); gather = per hull [hull:ticks, dispatch record, state at delivery] or the
// refusal. Cross-checks: the board, the 2.5 A stuck sites and the 2.5 E win table reproduce the plan's section 2.2
// and 2.5 numbers; "first:launch" equaled G2-0 "display:launch" at Level 5 (b4d99ab5, 25f32e71, 8105e2b) before SF-2:
// the shakedown's launch view for a D18 minimum crew on a Freighter or an Orion was the one a rank 10 crew reads.
//
// RE-PINNED BY SAFE FIRST RUNS SF-2 (the moves, each on purpose; every other key here is unchanged):
//   first:generalFreighter:*  the 30 minute shakedown is retired, so a freighter's first run flies the regular transit
//                             (21,600 s each way): every phase anchor and step time shifts. NOT a training run (not an
//                             explorer): same objectives, same fights, same stalls.
//   first:orion|aurora|eir:*  the first explorer run is the TRAINING RUN (Expedition.difficulty stamped; the tutorial
//                             transit, equal to the regular one): one guard per fight at 0.2 strength, no affixes, no
//                             ambushes, pass-only ship events, the fell-back backstop; every row completes and claims.
//   first:launch              UNCHANGED: Level 5 reads these Tier I candidates below Forecast detail (no threat read),
//                             and the demand and the recommended composition are the same; safeFirstExpedition.test.ts
//                             pins the training run's forecast (at Forecast detail) against the run.
//   first:parity             the parity run (D18 Orion, candidate 1) is now its training run.
//   later:eir:real            its first run (the Eir rank 3 training run) and so the second run's start time move.
//   later:orion:*             unchanged: the fixture marks the training run done (the runs are expedition 2 and 11).
//   lines:first:* (gated)     the readable lines of the same runs.
// The section 2.5 B sweep (firstRunsGoldens.sweep.test.ts) stays the pre-SF-2 NOMINAL Tier I record (dispatched as
// before SF-2), the baseline SF-3's ramp is measured against; SF-2's proof sweep is safeFirstExpedition.sweep.test.ts.
//
// SAFE FIRST RUNS SF-3 moved NOTHING here: sweepRun dispatches through asPreRanksDispatch, and a run from before FKR-1
// is from before SF-3's ordinary curve stamp too (awayTeamTestFixtures.ts withoutEnemyRanks drops it), so the
// freighter, later and old-save rows stay the pre-SF-3 record. The runs AS THE GAME NOW DISPATCHES THEM (the curve,
// the Tier I hazard ceiling, Weak on the low end) are pinned in rampGoldens.test.ts, captured before SF-3 and re-pinned
// by it with every move named.
//
// RE-PINNED BY SAFE FIRST RUNS SF-4 (the moves, each on purpose; every other key here is unchanged):
//   patrol:<hull>     a fresh save's first patrol (seeds 1 AND 2: each row is a fresh save) is now the TRAINING CYCLE
//                     (PatrolMissionState.difficulty stamped): the first 2 waves of its own schedule, each 1 Raider, a
//                     lost wave breaking off: every row is won (Sweep at 14 ticks, Warband at 22; was lost on the
//                     Runner and Miner Sweep at seed 1, on the Warband at seed 1 for the freighter, Runner, Miner and
//                     explorers, and at seed 2 for every hull but the battleship), so every route now has its "second"
//                     row. The second patrol is the curve's FLOOR (enemies
//                     at 0.35 of nominal on the route's own waves): won everywhere but the Runner, Miner and explorers'
//                     Warband (lost at tick 16).
//   patrol:repeat     the first cycle is the training cycle, the relaunched one the curve's floor.
//                     RE-PINNED AGAIN at the SF-4 merge (user 2026-10-21 "One step per patrol run"): the training run
//                     counts no route on the curve (runCounts.patrol.completed stays 0 through the run), so every
//                     second-cycle state hash moved; the cycles fought are unchanged (the floor either way).
//   patrol:forecast   (gated) the card forecasts the dispatch's own profile: every hull and route reads Guaranteed on a
//                     fresh save (the training cycle cannot be lost).
// Unchanged: the closed-form pair (now the training Orion Sweep and a VETERAN Runner's lost, limping Warband), the
// 200-seed WINS table (dispatched as a patrol veteran: the nominal record the top of the curve equals), gather:*,
// guards and old:v69 (a veteran: no stamp). The curve's own pins are patrolRampGoldens.test.ts (captured before SF-4)
// and safeFirstPatrol.sweep.test.ts.
const GOLDEN: Record<string, unknown> = {
  "board:summary": [
    "security:4:2", "science:3:2", "security:1:1", "security:1:1", "security:1:1", "security:3:2", "science:4:2",
    "security:2:1", "science:1:1", "science:1:1",
  ],
  "board:hash": "810463ea",
  // Re-pinned by WR-4 (B14): a battle's turn order is by side, then input order (the player side first); it used
  // to sort by id, and "crimsonReavers-w..." sorted ahead of "ship-1", so the pirates moved first. Every patrol below
  // moves. Outcomes that changed: the hauler now WINS Warband seed 1 (was lost at tick 23) and the Repeat run
  // relaunches on it; the freighter and the runner lose Warband seed 1 later (tick 23, was 20; tick 20, was 16).
  // Every other win, loss and relaunch tick is as before.
  "patrol:generalFreighter": [
    "crimsonReaverSweep:1:won:14", "da397d6f", "d1a44363", "b2f38143", "d906373f", "619f0aa1", "second:won:14",
    "9bcf9987", "47bf5f7c", "crimsonReaverSweep:2:won:14", "9513f580", "d0a063cd", "b2f38143", "d906373f",
    "a247a79e", "crimsonReaverWarband:1:won:22", "2f7ce1c3", "a10774bd", "b2f38143", "cad0779e", "d4df3066",
    "second:won:22", "cbeb0462", "87340c43", "crimsonReaverWarband:2:won:22", "4839a6b0", "e1cae927", "b2f38143",
    "cad0779e", "fc73981",
  ],
  "patrol:prospectorHauler": [
    "crimsonReaverSweep:1:won:14", "eb7c9ce0", "4b700f67", "9d03d00b", "d906373f", "44d412c5", "second:won:14",
    "15096638", "eb8605e0", "crimsonReaverSweep:2:won:14", "2da7b9f", "5b0c2091", "9d03d00b", "d906373f", "b3aefbee",
    "crimsonReaverWarband:1:won:22", "c95a941c", "2a06071d", "9d03d00b", "cad0779e", "7d25bde", "second:won:22",
    "5bbc8085", "d0056853", "crimsonReaverWarband:2:won:22", "9d9af88f", "cce2b05", "9d03d00b", "cad0779e",
    "1632e275",
  ],
  "patrol:prospectorRunner": [
    "crimsonReaverSweep:1:won:14", "c38b9630", "ce5d0293", "c4afd62a", "d906373f", "9a22f569", "second:won:14",
    "ac686298", "d49be24c", "crimsonReaverSweep:2:won:14", "47bc7413", "bcd29e6f", "c4afd62a", "d906373f",
    "8d243886", "crimsonReaverWarband:1:won:22", "f650790c", "b80aad1", "c4afd62a", "cad0779e", "a67c3ea0",
    "second:lost:16", "ce930375", "a8227127", "crimsonReaverWarband:2:won:22", "b000efa3", "f431921f", "c4afd62a",
    "cad0779e", "78f8a799",
  ],
  "patrol:prospectorMiner": [
    "crimsonReaverSweep:1:won:14", "60b554e1", "8bee8e17", "3e9366f7", "d906373f", "837945dc", "second:won:14",
    "9a205e99", "22b0962b", "crimsonReaverSweep:2:won:14", "6c2d59a2", "e5733243", "3e9366f7", "d906373f",
    "e66648bd", "crimsonReaverWarband:1:won:22", "aab746b5", "fbc5965f", "3e9366f7", "cad0779e", "18b92631",
    "second:lost:16", "ed937268", "1649f03c", "crimsonReaverWarband:2:won:22", "ceaab0f2", "384e6bb", "3e9366f7",
    "cad0779e", "6ade3dec",
  ],
  "patrol:destroyer": [
    "crimsonReaverSweep:1:won:14", "7a61e94b", "6d9c823f", "6ad9f46c", "d906373f", "d4055219", "second:won:14",
    "10580e63", "a69e92e8", "crimsonReaverSweep:2:won:14", "53e59d2c", "8a5edc7f", "6ad9f46c", "d906373f",
    "63ce63c0", "crimsonReaverWarband:1:won:22", "b26e2aaf", "c730354f", "6ad9f46c", "cad0779e", "b04a712",
    "second:won:22", "488980a2", "45bec8dd", "crimsonReaverWarband:2:won:22", "74db9b9c", "5df1019f", "6ad9f46c",
    "cad0779e", "659a3091",
  ],
  "patrol:battleship": [
    "crimsonReaverSweep:1:won:14", "dd08c199", "a0f0018b", "c6dba9cb", "d906373f", "6a6e81a4", "second:won:14",
    "b9136de1", "668e43f9", "crimsonReaverSweep:2:won:14", "3a7bb48c", "14f63e6b", "c6dba9cb", "d906373f",
    "d36aa39d", "crimsonReaverWarband:1:won:22", "6807bb1d", "b943700f", "c6dba9cb", "cad0779e", "27b6783b",
    "second:won:22", "60f4526a", "82db7a3c", "crimsonReaverWarband:2:won:22", "fef704fc", "148430a7", "c6dba9cb",
    "cad0779e", "8febd782",
  ],
  "patrol:carrier": [
    "crimsonReaverSweep:1:won:14", "da5b27d2", "b05cbf43", "ea909677", "d906373f", "9554bb6e", "second:won:14",
    "ec7ddb1d", "d5d094bf", "crimsonReaverSweep:2:won:14", "fe0142d6", "36e5dcc1", "ea909677", "d906373f",
    "89e39fc9", "crimsonReaverWarband:1:won:22", "cb34089e", "d4878337", "ea909677", "cad0779e", "83ccd623",
    "second:won:22", "c8d16a2c", "7eb1c780", "crimsonReaverWarband:2:won:22", "f5bf3f66", "c451f3db", "ea909677",
    "cad0779e", "9eadf440",
  ],
  "patrol:orion": [
    "crimsonReaverSweep:1:won:14", "c0cd5832", "ecf336bd", "c75858d4", "d906373f", "9f06f3dd", "second:won:14",
    "ce36d4a", "e43faea4", "crimsonReaverSweep:2:won:14", "86b9a9d9", "25efb35", "c75858d4", "d906373f", "97d18578",
    "crimsonReaverWarband:1:won:22", "28e7811e", "a68dc25b", "c75858d4", "cad0779e", "63bfa796", "second:lost:16",
    "f154a2f3", "3ef058ad", "crimsonReaverWarband:2:won:22", "9e4d44e9", "697397f7", "c75858d4", "cad0779e",
    "91ceb875",
  ],
  "patrol:aurora": [
    "crimsonReaverSweep:1:won:14", "d8be966d", "c604260d", "62b89a6f", "d906373f", "511447be", "second:won:14",
    "ab375435", "5ab34d1d", "crimsonReaverSweep:2:won:14", "62b1f23a", "a77da1dd", "62b89a6f", "d906373f",
    "6a87fd45", "crimsonReaverWarband:1:won:22", "fa6f4a9", "c13f483", "62b89a6f", "cad0779e", "a89096c1",
    "second:lost:16", "f52f979c", "77057370", "crimsonReaverWarband:2:won:22", "b3838e4a", "87b530ed", "62b89a6f",
    "cad0779e", "826d73ca",
  ],
  "patrol:eir": [
    "crimsonReaverSweep:1:won:14", "6bf43f15", "8669d3fd", "ffdca63b", "d906373f", "ef5f54b8", "second:won:14",
    "6b3bb8bd", "8a6c62bb", "crimsonReaverSweep:2:won:14", "5b44bc6e", "2de6f1ab", "ffdca63b", "d906373f",
    "aa5a7369", "crimsonReaverWarband:1:won:22", "e1ba0679", "c3f3c0e5", "ffdca63b", "cad0779e", "45896f69",
    "second:lost:16", "5d2dfdb8", "ea15d5b2", "crimsonReaverWarband:2:won:22", "780c56be", "110d42cb", "ffdca63b",
    "cad0779e", "a6fff670",
  ],
  "patrol:repeat": [
    "generalFreighter:crimsonReaverSweep:relaunch@14:e5306b13,relaunch@28:2578b1a9",
    "generalFreighter:crimsonReaverWarband:relaunch@22:a54da55c,end@40:48fbc319",
    "prospectorHauler:crimsonReaverSweep:relaunch@14:a0d3be46,relaunch@28:5774e52e",
    "prospectorHauler:crimsonReaverWarband:relaunch@22:b6fa7735,relaunch@44:cbe4db62",
    "prospectorRunner:crimsonReaverSweep:relaunch@14:d57555c2,relaunch@28:f7ed7432",
    "prospectorRunner:crimsonReaverWarband:relaunch@22:ccb5e217,end@38:dd06458",
    "prospectorMiner:crimsonReaverSweep:relaunch@14:e416353e,relaunch@28:a6f419ea",
    "prospectorMiner:crimsonReaverWarband:relaunch@22:af45d285,end@38:3c5fe3ad",
    "destroyer:crimsonReaverSweep:relaunch@14:f0981ffd,relaunch@28:bca9db2d",
    "destroyer:crimsonReaverWarband:relaunch@22:4ab039c4,relaunch@44:d0ab4325",
    "battleship:crimsonReaverSweep:relaunch@14:6ef5a77a,relaunch@28:fdaa6a0c",
    "battleship:crimsonReaverWarband:relaunch@22:5565aaa9,relaunch@44:ae10bb58",
    "carrier:crimsonReaverSweep:relaunch@14:508ac4d5,relaunch@28:629760e6",
    "carrier:crimsonReaverWarband:relaunch@22:653d1be6,relaunch@44:f7e7c9c0",
    "orion:crimsonReaverSweep:relaunch@14:557dcd54,relaunch@28:41a1dc4a",
    "orion:crimsonReaverWarband:relaunch@22:29c1bc99,end@38:77152b3a",
    "aurora:crimsonReaverSweep:relaunch@14:9653a4aa,relaunch@28:7e73d9a8",
    "aurora:crimsonReaverWarband:relaunch@22:63b39fcd,end@38:1b95d1d1",
    "eir:crimsonReaverSweep:relaunch@14:a932f642,relaunch@28:13c4af12",
    "eir:crimsonReaverWarband:relaunch@22:803db37d,end@38:903e03bf",
  ],
  "gather:localFuelRun": [
    "generalFreighter:99", "aa03a7cf", "50bfa0ed", "prospectorHauler:197", "aa03a7cf", "a7a3225c",
    "prospectorRunner:67", "aa03a7cf", "fe04e14e", "prospectorMiner:99", "aa03a7cf", "43a424ee", "destroyer:34",
    "aa03a7cf", "2b0067e0", "battleship:45", "aa03a7cf", "638ca733", "carrier:29", "aa03a7cf", "b3cae159", "orion:132",
    "aa03a7cf", "4704ec57", "aurora:110", "aa03a7cf", "ed06bfca", "eir:241", "aa03a7cf", "98c4837",
  ],
  "gather:shortOreRun": [
    "generalFreighter:149", "173ed900", "34d2f0c9", "prospectorHauler:261", "173ed900", "47784b6e",
    "prospectorRunner:101", "173ed900", "5c76cf3c", "prospectorMiner:149", "173ed900", "4e000572", "destroyer:74",
    "173ed900", "cda62423", "battleship:117", "173ed900", "60273ba6", "carrier:93", "173ed900", "e6687d4b", "orion:178",
    "173ed900", "205dba59", "aurora:150", "173ed900", "d51c8898", "eir:297", "173ed900", "edc15768",
  ],
  // Re-pinned by WR-4 (OC-C2): the Lunar Mine's uncommon strike is Dense Ore (was Cobalt Ore). Only the item key moved:
  // naming denseOre back to cobaltOre in each delivered state reproduces the SF-0 capture exactly (b5a45464, a88a60b9,
  // 9c723e64, 6171239, 918723ae, da2d527c, e20c7223, 774e6e96, d0deecde, 263885a6); the delivery ticks did not move.
  "gather:longOreRun": [
    "generalFreighter:239", "8e6386f4", "2b1de52d", "prospectorHauler:373", "8e6386f4", "45c25bc4",
    "prospectorRunner:161", "8e6386f4", "b72ef111", "prospectorMiner:239", "8e6386f4", "86e4640", "destroyer:142",
    "8e6386f4", "9085303d", "battleship:245", "8e6386f4", "64f3fe85", "carrier:205", "8e6386f4", "5228b070",
    "orion:260", "8e6386f4", "d5be4397", "aurora:218", "8e6386f4", "4bab7207", "eir:397", "8e6386f4", "e63a927b",
  ],
  "gather:salvageWreckage": [
    "generalFreighter:189", "35190dab", "94d14e2c", "prospectorHauler:311", "35190dab", "6b5d179c",
    "prospectorRunner:refused:cargo", "prospectorMiner:189", "35190dab", "9751a7a5", "destroyer:refused:cargo",
    "battleship:refused:cargo", "carrier:refused:cargo", "orion:214", "35190dab", "9d52aef5", "aurora:180", "35190dab",
    "bc231926", "eir:341", "35190dab", "e684ec02",
  ],
  "gather:forageFlora": [
    "generalFreighter:209", "c1cb8da7", "51cfb373", "prospectorHauler:335", "c1cb8da7", "463b2586",
    "prospectorRunner:refused:cargo", "prospectorMiner:209", "c1cb8da7", "b1ad3402", "destroyer:refused:cargo",
    "battleship:refused:cargo", "carrier:refused:cargo", "orion:232", "c1cb8da7", "db6b94f7", "aurora:196", "c1cb8da7",
    "77c7a097", "eir:365", "c1cb8da7", "bee0303a",
  ],
  "gather:surveyMineralAnomaly": [
    "generalFreighter:269", "3779b356", "d6a8e5be", "prospectorHauler:411", "3779b356", "8d407fb3",
    "prospectorRunner:refused:cargo", "prospectorMiner:269", "3779b356", "b6a0946f", "destroyer:refused:cargo",
    "battleship:refused:cargo", "carrier:refused:cargo", "orion:288", "3779b356", "2f67c847", "aurora:242", "3779b356",
    "870a2c68", "eir:431", "3779b356", "b1359274",
  ],
  "gather:surveyStellarPhenomena": [
    "generalFreighter:289", "c883a6b9", "74e4070", "prospectorHauler:refused:fuelCapacity",
    "prospectorRunner:refused:cargo", "prospectorMiner:refused:fuelCapacity", "destroyer:refused:cargo",
    "battleship:refused:cargo", "carrier:refused:cargo", "orion:306", "c883a6b9", "9da9cf8", "aurora:258", "c883a6b9",
    "17c98825", "eir:453", "c883a6b9", "fe834404",
  ],
  "gather:frontierSupplyRun": [
    "generalFreighter:219", "dd5c4e0", "8a3458c2", "prospectorHauler:347", "dd5c4e0", "886db511",
    "prospectorRunner:refused:cargo", "prospectorMiner:219", "dd5c4e0", "9d0c4883", "destroyer:refused:cargo",
    "battleship:refused:cargo", "carrier:refused:cargo", "orion:242", "dd5c4e0", "6fb67338", "aurora:204", "dd5c4e0",
    "a092a694", "eir:375", "dd5c4e0", "135d4bd1",
  ],
  "gather:colonySupplyLift": [
    "generalFreighter:279", "a3dde4a3", "e0b3d894", "prospectorHauler:423", "a3dde4a3", "d22dccfc",
    "prospectorRunner:refused:cargo", "prospectorMiner:refused:fuelCapacity", "destroyer:refused:cargo",
    "battleship:refused:cargo", "carrier:refused:cargo", "orion:296", "a3dde4a3", "11d3ef3c", "aurora:250", "a3dde4a3",
    "9fac7ed5", "eir:441", "a3dde4a3", "d979f329",
  ],
  // ADDED BY the reactor fuel ladder (0.14.0): the new Tier I Cometary Ice Harvest, flown by every hull (no capability
  // gate) and delivered without a defeat (gathering cannot be lost: its first run is safe). Every earlier key unchanged.
  "gather:cometIceHarvest": [
    "generalFreighter:179", "9c5f859f", "b4fa3ce7", "prospectorHauler:297", "9c5f859f", "df15f4fe",
    "prospectorRunner:121", "9c5f859f", "51277a52", "prospectorMiner:179", "9c5f859f", "201c8dba", "destroyer:96",
    "9c5f859f", "7986696f", "battleship:161", "9c5f859f", "bc7ec67b", "carrier:129", "9c5f859f", "76a0455",
    "orion:206", "9c5f859f", "9bb2008", "aurora:172", "9c5f859f", "6c80e869", "eir:331", "9c5f859f", "2aa271c8",
  ],
  "first:generalFreighter:d18": [
    "47d11304", "4cb86809", "unclaimed", "91f28891", "4a1da812", "unclaimed", "d9bf4fd6", "37454deb", "unclaimed",
  ],
  "first:generalFreighter:board2": [
    "bc81d820", "dff111f7", "unclaimed", "2d1dcde1", "5f0a5e43", "unclaimed", "acc74e56", "2a8ccfae", "unclaimed",
  ],
  "first:generalFreighter:board10": [
    "dc62d368", "10c67cb3", "unclaimed", "c191b40d", "ae3e3ad9", "unclaimed", "eaedc4ae", "b56b26f8", "unclaimed",
  ],
  "first:generalFreighter:rank1": [
    "f5dc9601", "a4c7bc3d", "unclaimed", "37a95a8c", "cabdc288", "unclaimed", "165fa21d", "c81ce36d", "unclaimed",
  ],
  "first:generalFreighter:rank3": [
    "24a5b27b", "1fb33b4e", "unclaimed", "99cad552", "90c8a27b", "unclaimed", "f3979dd3", "5fd246e", "unclaimed",
  ],
  "first:generalFreighter:rank6": [
    "3d8aad2d", "3d04c4ea", "unclaimed", "6bce4278", "9785fa01", "7c361eb8", "12f1c405", "ea45cccc", "unclaimed",
  ],
  "first:orion:d18": [
    "3d7a070b", "dca49d9f", "93c8088a", "777d5254", "271fa153", "24e36633", "dc1b2939", "17b5db74", "9486a6fd",
  ],
  "first:orion:board2": [
    "5a652de3", "8c4120a6", "334f1fdd", "db19f574", "408904d4", "e0776b26", "c6384589", "d6ba55d4", "6b9dfbbe",
  ],
  "first:orion:board10": [
    "c9d333c7", "8c859e1e", "7b59139", "441d37b0", "4b73407e", "a1e3b7d6", "9f23e19b", "7c124f40", "725b484",
  ],
  "first:orion:rank1": [
    "87683284", "9bd64d6a", "1b1e95ef", "47664b7b", "edce0c63", "43a3762a", "63696348", "7c43be68", "1bcadf60",
  ],
  "first:orion:rank3": [
    "3d42d2a6", "2568b464", "c026b38b", "265d1151", "a638f769", "61ee137a", "65e1181e", "88366b6e", "8dee4a00",
  ],
  "first:orion:rank6": [
    "8f74d860", "ba594362", "334cf6fd", "6d13c387", "f048eb3b", "e8827460", "63969060", "ce8c2614", "e3cf8066",
  ],
  "first:aurora:d18": [
    "358748f5", "57d50f9d", "21007ef5", "9d2ff6ca", "56e3b8a7", "5c8635c", "e5a70745", "bebfc16a", "8c1ed388",
  ],
  "first:aurora:board2": [
    "74bb56dd", "7e2f13ca", "e53016e2", "7d70baea", "a401c3d8", "656a64d9", "986f81b5", "b5f7bd58", "39718c0f",
  ],
  "first:aurora:board10": [
    "9ad9ac11", "3b96bd52", "40ca89f8", "81eb3576", "193dcc20", "73064ba5", "3ff8f20f", "fea4a6d6", "3388f301",
  ],
  "first:aurora:rank1": [
    "db5f260", "a0a115e6", "b37ad72a", "78bd46b7", "9e2c6edf", "689ce667", "a29bc03a", "33786262", "cf355d17",
  ],
  "first:aurora:rank3": [
    "b6aac6ba", "15d72918", "d1c5747a", "1155e655", "bafb63bd", "d982ed43", "ca926100", "7464c4e8", "8abdfa33",
  ],
  "first:aurora:rank6": [
    "6a8113fc", "a857646e", "5859d560", "ef933213", "182269e7", "476812d5", "26002f82", "dce97cbe", "8324f5c5",
  ],
  "first:eir:d18": [
    "f7a7bac5", "32ca541", "eb456ceb", "99f8bf32", "363370a5", "69a001a", "681b0917", "80345d92", "1cbbcc58",
  ],
  "first:eir:board2": [
    "8ede7b1d", "1dc624d4", "8667c0c6", "73afe252", "5deaf3b2", "6bf86609", "2aac6b27", "2449991a", "958eb335",
  ],
  "first:eir:board10": [
    "77443fb1", "3b0ea030", "e51bf588", "3030afee", "980f8630", "8a7a69d5", "4c7af14f", "65d38b8e", "374af687",
  ],
  "first:eir:rank1": [
    "3097967c", "1083c313", "59437672", "61770f1b", "446b675", "96c1ce8f", "f637e3c0", "9b022aac", "276c6b6f",
  ],
  "first:eir:rank3": [
    "43d29592", "7b08d0b8", "56bfb182", "ac9a4975", "f12788d7", "7a5bf12b", "d6c185f2", "f88048e", "cc74890b",
  ],
  "first:eir:rank6": [
    "3c770b00", "b7c7c7da", "931f9d68", "bc6ee55f", "f81e4a8d", "9c97c41d", "67d717d8", "67a1dc90", "3f9acc7d",
  ],
  "first:systems": [
    "Lyra's Wake: volcanic 0.65, barren 0.1", "Halcyon Drift: ocean 0.4, barren 0.1",
    "Calliope Reach: toxic 0.9, gasGiant 0.1",
  ],
  "first:candidates": "8207442a",
  // Re-pinned by Gas Giant Study GG-2 (cand-2 only, Calliope Reach with its gas giant; was 8105e2b): the giant's
  // ground objectives leave the demand and the recommendation, which count its one ship study instead (G2-0
  // display:launch moved the same way). Re-pinned by GG-4 (cand-2 only; was 839d60ba): Calliope Reach holds a nebula,
  // which joins its demand (`nebulaSweep`) and forecast (`nebula`), as G2-0 display:launch moved.
  "first:launch": [
    "generalFreighter:cand-0:b4d99ab5", "generalFreighter:cand-1:25f32e71", "generalFreighter:cand-2:8da715f0",
    "orion:cand-0:b4d99ab5", "orion:cand-1:25f32e71", "orion:cand-2:8da715f0",
  ],
  "first:parity": "271fa153",
  "later:orion:d18:2": [
    "a862d950", "6ddb7975", "unclaimed", "f5d00cb1", "f090d549", "unclaimed", "80cf940e", "7d17542b", "unclaimed",
  ],
  "later:orion:d18:11": [
    "a81b07ea", "12fc4967", "unclaimed", "74efe27", "57df3c8d", "unclaimed", "3b6126c0", "2e893ca5", "unclaimed",
  ],
  "later:orion:rank1:2": [
    "6c60c819", "182ec2ee", "unclaimed", "a776360", "7f5516cd", "unclaimed", "e3ec8609", "10d71e1d", "unclaimed",
  ],
  "later:orion:rank1:11": [
    "82a89aab", "9aa5f6d8", "unclaimed", "9a3a52be", "f635524d", "unclaimed", "caf42cf3", "768a8477", "unclaimed",
  ],
  "later:orion:rank6:2": [
    "3ebe3031", "297bc2dd", "unclaimed", "ddabe588", "75f3ef6", "b593e13f", "24220565", "5a9637ba", "unclaimed",
  ],
  "later:orion:rank6:11": [
    "9ea9cc93", "733b01d7", "unclaimed", "18972976", "a952bd2e", "1095876b", "ebc0bc6f", "628cb48", "unclaimed",
  ],
  "later:eir:real": [
    "56bfb182", "a61af6e0", "62a5aa81", "unclaimed",
  ],
  "lines:later:eir:real": [
    "complete 11/11 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:2",
    "activities 7/8 lost:76 sent:554 stuck:geothermalChamber hull:14 setbacks:1 boarded:0 vault:3",
  ],
  guards: [
    "buriedVault:0:n=3/3/3/3:hp=180/180/180/180:e7648019", "buriedVault:0.1:n=3/3/3/3:hp=195/195/195/195:d92e99cd",
    "buriedVault:0.2:n=3/3/3/3:hp=208/208/208/208:d127e205", "buriedVault:0.3:n=3/3/3/3:hp=224/224/224/224:fc562e6d",
    "buriedVault:0.4:n=3/3/3/3:hp=237/237/237/237:6850691d", "buriedVault:0.5:n=3/3/3/3:hp=252/252/252/252:69520845",
    "buriedVault:0.65:n=3/3/3/4:hp=273/273/273/334:c9c59e1e", "buriedVault:0.9:n=3/3/3/4:hp=309/309/309/378:d28259f0",
    "buriedVault:1:n=3/3/3/4:hp=324/324/324/396:3d1a3aab",
    "subterraneanCivilization:0:n=4/4/4/4:hp=180/180/180/180:dedcb135",
    "subterraneanCivilization:0.1:n=4/4/4/4:hp=195/195/195/195:9ce5749d",
    "subterraneanCivilization:0.2:n=4/4/4/4:hp=208/208/208/208:283577bd",
    "subterraneanCivilization:0.3:n=4/4/4/4:hp=224/224/224/224:7443fb6d",
    "subterraneanCivilization:0.4:n=4/4/4/4:hp=238/238/238/238:751ceedd",
    "subterraneanCivilization:0.5:n=4/4/4/4:hp=252/252/252/252:9f0a11d5",
    "subterraneanCivilization:0.65:n=4/4/4/5:hp=274/274/274/335:f5030332",
    "subterraneanCivilization:0.9:n=4/4/4/5:hp=309/309/309/378:f8ab84dc",
    "subterraneanCivilization:1:n=4/4/4/5:hp=324/324/324/396:414ea59b",
    "ancientRuins:0:n=2/2/2/2:hp=104/104/104/104:df42735", "ancientRuins:0.1:n=2/2/2/2:hp=113/113/113/113:65231da5",
    "ancientRuins:0.2:n=2/2/2/2:hp=120/120/120/120:282a97e5", "ancientRuins:0.3:n=2/2/2/2:hp=129/129/129/129:86cdfeed",
    "ancientRuins:0.4:n=2/2/2/2:hp=137/137/137/137:77d65c65", "ancientRuins:0.5:n=2/2/2/2:hp=146/146/146/146:ce1f067d",
    "ancientRuins:0.65:n=2/2/2/3:hp=158/158/158/264:6bcdc552", "ancientRuins:0.9:n=2/2/2/3:hp=178/178/178/298:baf6cf08",
    "ancientRuins:1:n=2/2/2/3:hp=187/187/187/313:c7d4ae", "caveNetwork:0:n=3/3/3/3:hp=54/54/54/54:58f61181",
    "caveNetwork:0.1:n=3/3/3/3:hp=57/57/57/57:7ae340b1", "caveNetwork:0.2:n=3/3/3/3:hp=63/63/63/63:d8615b1",
    "caveNetwork:0.3:n=3/3/3/3:hp=66/66/66/66:ebd749b1", "caveNetwork:0.4:n=3/3/3/3:hp=72/72/72/72:181d6e19",
    "caveNetwork:0.5:n=3/3/3/3:hp=75/75/75/75:377c2109", "caveNetwork:0.65:n=3/3/3/4:hp=81/81/81/108:1a648a3a",
    "caveNetwork:0.9:n=3/3/3/4:hp=93/93/93/124:6706619e", "caveNetwork:1:n=3/3/3/4:hp=96/96/96/128:dc235d3e",
    "unknownSite:0:n=2/2/2/2:hp=104/104/104/104:bc37d8b5", "unknownSite:0.1:n=2/2/2/2:hp=113/113/113/113:a9e3f585",
    "unknownSite:0.2:n=2/2/2/2:hp=120/120/120/120:6fd5cc05", "unknownSite:0.3:n=2/2/2/2:hp=129/129/129/129:464d5ecd",
    "unknownSite:0.4:n=2/2/2/2:hp=137/137/137/137:78e8bce5", "unknownSite:0.5:n=2/2/2/2:hp=146/146/146/146:a500e57d",
    "unknownSite:0.65:n=2/2/2/3:hp=158/158/158/210:910e3ce6", "unknownSite:0.9:n=2/2/2/3:hp=178/178/178/236:79db530a",
    "unknownSite:1:n=2/2/2/3:hp=187/187/187/248:a435ab2a",
  ],
  // Moved by the G2-2 review (user 2026-10-19, "Next list for veterans"): this save is a VETERAN (two expeditions
  // flown before v70), so its dispatch stamps `wolf359List: 3` (its next Tier I list holds Wolf 359). Only the claimed
  // state's hash moves (was "a830e43c"); golden 7 proves that state without the key still hashes to the old value.
  "old:v69": [
    "92c29f65", "patrol:won:14", "2150f1b6", "80ce239", "expedition:complete", "a4fc1f4f", "bbbd0b9e", "c3a94416",
  ],
  // Re-pinned by WR-4 (B14): turn order by side, then input order (the player side first) moves the forecast wins.
  "patrol:forecast": [
    "generalFreighter:crimsonReaverSweep:{\"rating\":1310,\"wins\":64,\"tier\":\"guaranteed\"}",
    "generalFreighter:crimsonReaverWarband:{\"rating\":1310,\"wins\":64,\"tier\":\"guaranteed\"}",
    "prospectorHauler:crimsonReaverSweep:{\"rating\":1558,\"wins\":64,\"tier\":\"guaranteed\"}",
    "prospectorHauler:crimsonReaverWarband:{\"rating\":1558,\"wins\":64,\"tier\":\"guaranteed\"}",
    "prospectorRunner:crimsonReaverSweep:{\"rating\":766,\"wins\":64,\"tier\":\"guaranteed\"}",
    "prospectorRunner:crimsonReaverWarband:{\"rating\":766,\"wins\":64,\"tier\":\"guaranteed\"}",
    "prospectorMiner:crimsonReaverSweep:{\"rating\":942,\"wins\":64,\"tier\":\"guaranteed\"}",
    "prospectorMiner:crimsonReaverWarband:{\"rating\":942,\"wins\":64,\"tier\":\"guaranteed\"}",
    "destroyer:crimsonReaverSweep:{\"rating\":1967,\"wins\":64,\"tier\":\"guaranteed\"}",
    "destroyer:crimsonReaverWarband:{\"rating\":1967,\"wins\":64,\"tier\":\"guaranteed\"}",
    "battleship:crimsonReaverSweep:{\"rating\":3386,\"wins\":64,\"tier\":\"guaranteed\"}",
    "battleship:crimsonReaverWarband:{\"rating\":3386,\"wins\":64,\"tier\":\"guaranteed\"}",
    "carrier:crimsonReaverSweep:{\"rating\":3138,\"wins\":64,\"tier\":\"guaranteed\"}",
    "carrier:crimsonReaverWarband:{\"rating\":3138,\"wins\":64,\"tier\":\"guaranteed\"}",
    "orion:crimsonReaverSweep:{\"rating\":1464,\"wins\":64,\"tier\":\"guaranteed\"}",
    "orion:crimsonReaverWarband:{\"rating\":1464,\"wins\":64,\"tier\":\"guaranteed\"}",
    "aurora:crimsonReaverSweep:{\"rating\":1348,\"wins\":64,\"tier\":\"guaranteed\"}",
    "aurora:crimsonReaverWarband:{\"rating\":1348,\"wins\":64,\"tier\":\"guaranteed\"}",
    "eir:crimsonReaverSweep:{\"rating\":1380,\"wins\":64,\"tier\":\"guaranteed\"}",
    "eir:crimsonReaverWarband:{\"rating\":1380,\"wins\":64,\"tier\":\"guaranteed\"}",
  ],
  "lines:first:generalFreighter:d18": [
    "cand-0 activities 1/11 lost:40 sent:584 stuck:derelictOutpost+geothermalChamber+derelictOutpost+geothermalChamber+mineralOutcrop+subterraneanCivilization+mineralOutcrop+mineralOutcrop+crashedShip+subterraneanCivilization hull:0 setbacks:0 boarded:0 vault:2",
    "cand-1 activities 7/10 lost:40 sent:583 stuck:geothermalChamber+subterraneanCivilization+subterraneanCivilization hull:0 setbacks:3 boarded:3 vault:2",
    "cand-2 activities 7/9 lost:40 sent:554 stuck:buriedVault+geothermalChamber hull:80 setbacks:2 boarded:0 vault:1",
  ],
  "lines:first:generalFreighter:board2": [
    "cand-0 activities 1/11 lost:40 sent:581 stuck:derelictOutpost+geothermalChamber+derelictOutpost+geothermalChamber+mineralOutcrop+subterraneanCivilization+mineralOutcrop+mineralOutcrop+crashedShip+subterraneanCivilization hull:0 setbacks:0 boarded:0 vault:2",
    "cand-1 activities 7/10 lost:40 sent:581 stuck:geothermalChamber+subterraneanCivilization+subterraneanCivilization hull:0 setbacks:3 boarded:3 vault:2",
    "cand-2 activities 7/9 lost:40 sent:580 stuck:buriedVault+geothermalChamber hull:80 setbacks:2 boarded:0 vault:1",
  ],
  "lines:first:generalFreighter:board10": [
    "cand-0 activities 10/11 lost:78 sent:563 stuck:subterraneanCivilization hull:0 setbacks:0 boarded:0 vault:2",
    "cand-1 activities 9/10 lost:40 sent:574 stuck:subterraneanCivilization hull:0 setbacks:3 boarded:3 vault:2",
    "cand-2 activities 8/9 lost:40 sent:569 stuck:buriedVault hull:80 setbacks:2 boarded:0 vault:1",
  ],
  "lines:first:generalFreighter:rank1": [
    "cand-0 activities 10/11 lost:43 sent:515 stuck:subterraneanCivilization hull:0 setbacks:0 boarded:0 vault:2",
    "cand-1 activities 9/10 lost:40 sent:457 stuck:subterraneanCivilization hull:0 setbacks:3 boarded:3 vault:2",
    "cand-2 activities 8/9 lost:40 sent:573 stuck:buriedVault hull:80 setbacks:2 boarded:0 vault:1",
  ],
  "lines:first:generalFreighter:rank3": [
    "cand-0 activities 10/11 lost:43 sent:561 stuck:subterraneanCivilization hull:0 setbacks:0 boarded:0 vault:2",
    "cand-1 activities 9/10 lost:40 sent:576 stuck:subterraneanCivilization hull:0 setbacks:3 boarded:3 vault:2",
    "cand-2 activities 8/9 lost:40 sent:571 stuck:buriedVault hull:80 setbacks:2 boarded:0 vault:1",
  ],
  "lines:first:generalFreighter:rank6": [
    "cand-0 activities 10/11 lost:40 sent:563 stuck:subterraneanCivilization hull:0 setbacks:0 boarded:0 vault:2",
    "cand-1 complete 10/10 lost:2 sent:0 stuck:none hull:0 setbacks:3 boarded:3 vault:2",
    "cand-2 activities 8/9 lost:40 sent:572 stuck:buriedVault hull:80 setbacks:2 boarded:0 vault:1",
  ],
  "lines:first:orion:d18": [
    "cand-0 complete 11/11 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:2",
    "cand-1 complete 11/11 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:2",
    "cand-2 complete 9/9 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:1",
  ],
  "lines:first:orion:board2": [
    "cand-0 complete 11/11 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:2",
    "cand-1 complete 11/11 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:2",
    "cand-2 complete 9/9 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:1",
  ],
  "lines:first:orion:board10": [
    "cand-0 complete 11/11 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:2",
    "cand-1 complete 11/11 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:2",
    "cand-2 complete 9/9 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:1",
  ],
  "lines:first:orion:rank1": [
    "cand-0 complete 11/11 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:2",
    "cand-1 complete 11/11 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:2",
    "cand-2 complete 9/9 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:1",
  ],
  "lines:first:orion:rank3": [
    "cand-0 complete 11/11 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:2",
    "cand-1 complete 11/11 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:2",
    "cand-2 complete 9/9 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:1",
  ],
  "lines:first:orion:rank6": [
    "cand-0 complete 11/11 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:2",
    "cand-1 complete 11/11 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:2",
    "cand-2 complete 9/9 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:1",
  ],
  "lines:first:aurora:d18": [
    "cand-0 complete 11/11 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:2",
    "cand-1 complete 11/11 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:2",
    "cand-2 complete 9/9 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:1",
  ],
  "lines:first:aurora:board2": [
    "cand-0 complete 11/11 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:2",
    "cand-1 complete 11/11 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:2",
    "cand-2 complete 9/9 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:1",
  ],
  "lines:first:aurora:board10": [
    "cand-0 complete 11/11 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:2",
    "cand-1 complete 11/11 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:2",
    "cand-2 complete 9/9 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:1",
  ],
  "lines:first:aurora:rank1": [
    "cand-0 complete 11/11 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:2",
    "cand-1 complete 11/11 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:2",
    "cand-2 complete 9/9 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:1",
  ],
  "lines:first:aurora:rank3": [
    "cand-0 complete 11/11 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:2",
    "cand-1 complete 11/11 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:2",
    "cand-2 complete 9/9 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:1",
  ],
  "lines:first:aurora:rank6": [
    "cand-0 complete 11/11 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:2",
    "cand-1 complete 11/11 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:2",
    "cand-2 complete 9/9 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:1",
  ],
  "lines:first:eir:d18": [
    "cand-0 complete 11/11 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:2",
    "cand-1 complete 11/11 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:2",
    "cand-2 complete 9/9 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:1",
  ],
  "lines:first:eir:board2": [
    "cand-0 complete 11/11 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:2",
    "cand-1 complete 11/11 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:2",
    "cand-2 complete 9/9 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:1",
  ],
  "lines:first:eir:board10": [
    "cand-0 complete 11/11 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:2",
    "cand-1 complete 11/11 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:2",
    "cand-2 complete 9/9 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:1",
  ],
  "lines:first:eir:rank1": [
    "cand-0 complete 11/11 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:2",
    "cand-1 complete 11/11 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:2",
    "cand-2 complete 9/9 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:1",
  ],
  "lines:first:eir:rank3": [
    "cand-0 complete 11/11 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:2",
    "cand-1 complete 11/11 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:2",
    "cand-2 complete 9/9 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:1",
  ],
  "lines:first:eir:rank6": [
    "cand-0 complete 11/11 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:2",
    "cand-1 complete 11/11 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:2",
    "cand-2 complete 9/9 lost:0 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:1",
  ],
  "lines:later:orion:d18:2": [
    "cand-0 activities 1/11 lost:40 sent:584 stuck:derelictOutpost+geothermalChamber+derelictOutpost+geothermalChamber+mineralOutcrop+subterraneanCivilization+mineralOutcrop+mineralOutcrop+crashedShip+subterraneanCivilization hull:0 setbacks:0 boarded:0 vault:2",
    "cand-1 activities 7/10 lost:40 sent:583 stuck:geothermalChamber+subterraneanCivilization+subterraneanCivilization hull:0 setbacks:2 boarded:3 vault:2",
    "cand-2 activities 7/9 lost:40 sent:554 stuck:buriedVault+geothermalChamber hull:55 setbacks:2 boarded:0 vault:1",
  ],
  "lines:later:orion:d18:11": [
    "cand-0 activities 1/11 lost:40 sent:584 stuck:derelictOutpost+geothermalChamber+derelictOutpost+geothermalChamber+mineralOutcrop+subterraneanCivilization+mineralOutcrop+mineralOutcrop+crashedShip+subterraneanCivilization hull:0 setbacks:0 boarded:0 vault:2",
    "cand-1 activities 7/10 lost:40 sent:583 stuck:geothermalChamber+subterraneanCivilization+subterraneanCivilization hull:0 setbacks:2 boarded:3 vault:2",
    "cand-2 activities 7/9 lost:40 sent:554 stuck:buriedVault+geothermalChamber hull:55 setbacks:2 boarded:0 vault:1",
  ],
  "lines:later:orion:rank1:2": [
    "cand-0 activities 10/11 lost:43 sent:515 stuck:subterraneanCivilization hull:0 setbacks:0 boarded:0 vault:2",
    "cand-1 activities 9/10 lost:40 sent:457 stuck:subterraneanCivilization hull:0 setbacks:2 boarded:3 vault:2",
    "cand-2 activities 8/9 lost:40 sent:573 stuck:buriedVault hull:55 setbacks:2 boarded:0 vault:1",
  ],
  "lines:later:orion:rank1:11": [
    "cand-0 activities 10/11 lost:43 sent:515 stuck:subterraneanCivilization hull:0 setbacks:0 boarded:0 vault:2",
    "cand-1 activities 9/10 lost:40 sent:457 stuck:subterraneanCivilization hull:0 setbacks:2 boarded:3 vault:2",
    "cand-2 activities 8/9 lost:40 sent:573 stuck:buriedVault hull:55 setbacks:2 boarded:0 vault:1",
  ],
  "lines:later:orion:rank6:2": [
    "cand-0 activities 10/11 lost:40 sent:563 stuck:subterraneanCivilization hull:0 setbacks:0 boarded:0 vault:2",
    "cand-1 complete 10/10 lost:2 sent:0 stuck:none hull:0 setbacks:2 boarded:3 vault:2",
    "cand-2 activities 8/9 lost:40 sent:572 stuck:buriedVault hull:55 setbacks:2 boarded:0 vault:1",
  ],
  "lines:later:orion:rank6:11": [
    "cand-0 activities 10/11 lost:40 sent:563 stuck:subterraneanCivilization hull:0 setbacks:0 boarded:0 vault:2",
    "cand-1 complete 10/10 lost:2 sent:0 stuck:none hull:0 setbacks:2 boarded:3 vault:2",
    "cand-2 activities 8/9 lost:40 sent:572 stuck:buriedVault hull:55 setbacks:2 boarded:0 vault:1",
  ],
};

// One pinned value: the whole value equals its golden.
function pin(key: string, value: unknown): void {
  expect(value, key).toEqual(GOLDEN[key]);
}

// ===== 1. a new save's "first" predicates and the fresh recruit board =====

describe("SF-0 golden 1: a new save's first-run predicates and the fresh recruit board", () => {
  it("freshState: expedition 1 (the shakedown), patrol seed 1, the default expedition seed, no crew, no mission key", () => {
    const s = freshState();
    expect(s.nextExpeditionId).toBe(1);
    expect(s.nextPatrolSeed).toBe(1);
    expect(s.expeditionSeed).toBe(EXPEDITION_DEFAULT_SEED);
    expect(s.expeditions).toEqual([]);
    expect(s.awayMembers).toEqual([]);
    expect(s.crewPool).toEqual([]);
    expect(Object.keys(s.lifetimeStats.missionsCompleted)).toEqual([]);
    expect(s.ships.map((sh) => sh.typeKey)).toEqual(["generalFreighter"]);
  });

  it("the fresh recruit board (window 0): ten candidates, their squads, ranks and trait counts, and the whole board", () => {
    const board = awayRecruitCandidates(freshState());
    pin("board:summary", board.map((c) => `${c.teamType}:${c.rank}:${c.traits.length}`));
    pin("board:hash", hash(board));
  });
});

// ===== 2. patrols =====

function patrolBase(hull: ShipTypeKey, seed: number): GameState {
  return { ...onHull(hull), nextPatrolSeed: seed, credits: new Decimal(100_000) };
}

const patrolOf = (s: GameState): PatrolMissionState | null => s.captains[0].mission as PatrolMissionState | null;

// One Dispatch Once patrol from `state`, advanced in 1 s ticks until the captain idles. Returns the dispatch record,
// the display replay hashed at every live tick, the end state and the outcome (won = ended, not damaged).
function patrolOnce(state: GameState, key: PatrolKey): { record: unknown; replays: string[]; end: GameState; won: boolean; ticks: number } {
  const r = dispatchCaptainOnPatrol(state, 1, key, "balanced", false);
  expect(r.success, `${key}: ${r.reason}`).toBe(true);
  const record = structuredClone(r.next.captains[0].mission);
  let s = r.next;
  const replays: string[] = [];
  let ticks = 0;
  while (patrolOf(s) !== null) {
    replays.push(hash(replayPatrol(s, s.captains[0])));
    s = economyTick(s, 1, RNG);
    ticks += 1;
    if (ticks > 2000) throw new Error("the patrol never ended");
  }
  return { record, replays, end: s, won: s.ships[0].damaged !== true, ticks };
}

// The Threat Assessment band the patrol dispatch card shows: App.svelte patrolForecastFor's sweep mirrored exactly
// (FORECAST_SEED 0x5a4d + i over DEFAULT_SAMPLES, the installed gear, the folded start pools, the battle rating; since
// SF-4 the difficulty a dispatch would stamp now). null for a hull the card shows no readout for (combatHullTypeOf null).
function patrolForecast(state: GameState, key: PatrolKey): { rating: number; wins: number; tier: string } | null {
  const ship = state.ships[0];
  const hullType = combatHullTypeOf(ship.typeKey);
  if (hullType === null) return null;
  const def = PATROLS[key];
  const shipDef = SHIP_TYPES[ship.typeKey];
  const installedGear = equippedFor(state, ship.id);
  const rating = battleRating(shipToCombatant({ id: ship.id, team: "player", stats: shipDef, hullType, stance: "balanced", installedGear }));
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
  return { rating, wins, tier: threatAssessment(wins, DEFAULT_SAMPLES).tier };
}

describe("SF-0 golden 2: patrols", () => {
  for (const hull of HULLS) {
    it(`${hull}: the whole first cycle on both routes at master seeds 1 and 2, and the save's second patrol`, () => {
      const out: string[] = [];
      for (const key of ROUTES) {
        for (const seed of [1, 2]) {
          const { record, replays, end, won, ticks } = patrolOnce(patrolBase(hull, seed), key);
          expect(end.nextPatrolSeed).toBe(seed + 1);
          out.push(`${key}:${seed}:${won ? "won" : "lost"}:${ticks}`, hash(record), hash(replays), hash(end.ships[0]), hash(end.completionLog), stateHash(end));
          // The save's SECOND patrol, dispatched from the state the won first one left (a lost one is in the Shipyard).
          if (won && seed === 1) {
            const second = patrolOnce(end, key);
            out.push(`second:${second.won ? "won" : "lost"}:${second.ticks}`, hash(second.record), stateHash(second.end));
          }
        }
      }
      pin(`patrol:${hull}`, out);
    });
  }

  it("a Repeat patrol's first two cycles at seed 1 on every hull and both routes (the state at each relaunch or the end)", () => {
    const out: string[] = [];
    for (const hull of HULLS) {
      for (const key of ROUTES) {
        const r = dispatchCaptainOnPatrol(patrolBase(hull, 1), 1, key, "balanced", true);
        expect(r.success).toBe(true);
        let s = r.next;
        let prev = patrolOf(s)!.phase;
        const marks: string[] = [];
        for (let t = 1; t <= 2000 && marks.length < 2; t++) {
          s = economyTick(s, 1, RNG);
          const m = patrolOf(s);
          if (m === null) {
            marks.push(`end@${t}:${stateHash(s)}`);
            break;
          }
          if (prev === "transitBack" && m.phase === "transitOut") marks.push(`relaunch@${t}:${stateHash(s)}`);
          prev = m.phase;
        }
        out.push(`${hull}:${key}:${marks.join(",")}`);
      }
    }
    pin("patrol:repeat", out);
  });

  // SF-4: a fresh save's first patrol is the training cycle (never lost), so the lost, limping case is a veteran's.
  it("closed form: one economyTick call == 1 s ticks over a won (Orion Sweep, the training cycle) and a lost, limping (a veteran Runner's Warband) patrol", () => {
    for (const [hull, key, veteran] of [["orion", "crimsonReaverSweep", false], ["prospectorRunner", "crimsonReaverWarband", true]] as [ShipTypeKey, PatrolKey, boolean][]) {
      const from = veteran ? asPatrolVeteran(patrolBase(hull, 1)) : patrolBase(hull, 1);
      const start = dispatchCaptainOnPatrol(from, 1, key, "balanced", false).next;
      const { end, ticks, won } = patrolOnce(from, key);
      expect(won).toBe(!veteran);
      // The patrol-tick.test.ts parity gate's scope: the mission carry-state, the ship, the seed counter, the tank.
      const big = economyTick(start, ticks, RNG);
      expect(big.captains).toEqual(end.captains);
      expect(big.ships).toEqual(end.ships);
      expect(big.nextPatrolSeed).toBe(end.nextPatrolSeed);
      expect(big.credits.toString()).toBe(end.credits.toString());
    }
  });
});

// ===== 3. gathering: one delivered cycle for every mission x every hull =====

const MAX_UNLOCK = Math.max(...Object.values(MISSIONS).map((m) => m.unlockLevel));

// ship-1 on `hull`, the captain at level 10, Mission Control at the highest unlock level and the stores full, so the
// gate refuses only on what the hull decides.
function gatherBase(hull: ShipTypeKey): GameState {
  const b = onHull(hull);
  return {
    ...b,
    credits: new Decimal(1_000_000_000),
    captains: b.captains.map((c) => ({ ...c, level: 10 })),
    facilities: { ...b.facilities, missionControl: { ...b.facilities.missionControl, level: MAX_UNLOCK } },
  };
}

describe("SF-0 golden 3: gathering, one delivered cycle for every MISSIONS key x every hull", () => {
  for (const key of Object.keys(MISSIONS) as MissionKey[]) {
    it(`${key}: the dispatch record, the ticks to the first delivery and the state at delivery (or the refusal)`, () => {
      const out: string[] = [];
      for (const hull of HULLS) {
        const s0 = gatherBase(hull);
        const gate = canDispatch(s0, 1, key);
        if (!gate.ok) {
          out.push(`${hull}:refused:${gate.reason}`);
          continue;
        }
        const r = dispatchCaptainOnMission(s0, 1, key);
        expect(r.success).toBe(true);
        // The SF-5 first-run marker: no completed cycle of this key before the first delivery.
        expect(r.next.lifetimeStats.missionsCompleted[key]).toBeUndefined();
        const record = structuredClone(r.next.captains[0].mission);
        const rng = lcg(0x5f0);
        let s = r.next;
        let ticks = 0;
        while (!(s.lifetimeStats.missionsCompleted[key]?.gt(0) ?? false)) {
          s = economyTick(s, 1, rng);
          ticks += 1;
          if (ticks > 5000) throw new Error(`${hull} ${key}: never delivered`);
        }
        // Gathering cannot be lost: the captain is still flying (auto-repeat) and no log line is a defeat.
        expect(s.captains[0].mission).not.toBeNull();
        expect(s.completionLog.some((e) => e.patrolEndReason === "defeat")).toBe(false);
        out.push(`${hull}:${ticks}`, hash(record), stateHash(s));
      }
      pin(`gather:${key}`, out);
    });
  }
});

// ===== 4. the first expedition from a fresh save: section 2.5 A (SF-2: the training run on an explorer) =====

const FIRST_HULLS: ShipTypeKey[] = ["generalFreighter", "orion", "aurora", "eir"];

// Field Kits FKR-1: the run as dispatched before enemy ranks (the flag off), so every SF-0 pin keeps its capture.
function sweepRun(state: GameState, cand: string): { exp: Expedition; done: Expedition; claimed: GameState | null; next: GameState } {
  const res = asPreG2NamesDispatch(asPreRanksDispatch(dispatchPastPropulsion(state, "ship-1", 1, cand)));
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  const done = advanceExpedition(res.expedition, SWEEP_END);
  let claimed: GameState | null = null;
  if (done.phase === "complete") {
    const claim = claimExpedition({ ...res.next, expeditions: [done] }, done.id);
    expect(claim.success).toBe(true);
    claimed = claim.next;
  }
  return { exp: res.expedition, done, claimed, next: res.next };
}

describe("SF-0 golden 4: the first expedition of the three fresh-save candidates (section 2.5 A; SF-2: the training run)", () => {
  for (const hull of FIRST_HULLS) {
    for (const crew of CREW_NAMES) {
      it(`${hull} ${crew}: the outcome of each candidate, the dispatch record, the run at 3,000,000 s and the claim`, () => {
        const out: string[] = [];
        for (const cand of CANDS) {
          const { exp, done, claimed } = sweepRun(withCrew(onHull(hull), crew), cand);
          // SF-2: the shakedown is retired; the first run from an explorer is the training run.
          expect(exp.shakedown).toBe(false);
          expect(isTrainingRun(exp)).toBe(hull !== "generalFreighter");
          out.push(hash(exp), hash(done), claimed === null ? "unclaimed" : stateHash(claimed));
        }
        pin(`first:${hull}:${crew}`, out);
      });
    }
  }

  it("the three candidates every new save is offered: systems, bodies and hazards", () => {
    const cands = expeditionCandidates(withCrew(onHull("orion"), "d18"), "ship-1");
    const exps = CANDS.map((c) => asPreG2NamesDispatch(dispatchPastPropulsion(withCrew(onHull("orion"), "d18"), "ship-1", 1, c)).expedition!);
    pin("first:systems", exps.map((e) => `${e.systemName}: ${e.bodies.map((b) => `${b.planetType} ${b.hazard}`).join(", ")}`));
    pin("first:candidates", hash(cands.map((c) => asPreG2Candidate(c)))); // G2-2: as offered before G2-2 (ids, names)
  });

  // At telescope Level 5 (the founding telescope reads no per-body detail, so its launch view is empty).
  it("the launch view (demand, recommendation, forecast) of each first-run candidate at telescope Level 5, D18 minimum crew", () => {
    const out: string[] = [];
    for (const hull of ["generalFreighter", "orion"] as ShipTypeKey[]) {
      const crewed = withCrew(onHull(hull), "d18");
      const s = { ...crewed, facilities: { ...crewed.facilities, [SUBSPACE_TELESCOPE_FACILITY_KEY]: { level: 5 } } };
      for (const c of expeditionCandidates(s, "ship-1")) {
        const view = expeditionLaunchView(s, "ship-1", c);
        expect(view.demand).not.toBeNull();
        out.push(`${hull}:${asPreG2Candidate(c).id}:${hash(view)}`); // G2-2: the pre-G2 id (cand-1-0 reads cand-0)
      }
    }
    pin("first:launch", out);
  });

  // The D18 minimum crew's Orion run of candidate 1 (before SF-2 a stalled shakedown: ship-event setbacks, a stuck
  // Subterranean site; since SF-2 its training run) over its first 250,000 s: one call == 997 s chunks == an
  // EVENT-BOUNDARY chain (t - 1, t, t + 1 at every phase anchor, step record, log line and ship leg of the one-call run).
  it("offline == live: one call == 997 s chunks == the event-boundary chain on the D18 Orion's first run", () => {
    const H = 250_000;
    const exp = asPreG2NamesDispatch(asPreRanksDispatch(dispatchPastPropulsion(withCrew(onHull("orion"), "d18"), "ship-1", 1, "cand-1"))).expedition!; // FKR-1: flag off
    const frozen = structuredClone(exp);
    const one = advanceExpedition(exp, H);
    let e = exp;
    for (let t = 997; t < H; t += 997) e = advanceExpedition(e, t);
    expect(advanceExpedition(e, H)).toEqual(one);
    const times = new Set<number>([exp.phaseAnchorSeconds]);
    const ops = one.groundOps!;
    for (const r of ops.history) for (const t of [r.startedAt, r.endedAt]) times.add(t);
    for (const l of ops.log ?? []) times.add(l.at);
    for (const leg of ops.shipLegs) for (const t of [leg.startsAt, leg.arrivesAt, leg.endsAt]) times.add(t);
    const chain = [...times].filter((t) => Number.isFinite(t) && t > 1 && t + 1 < H).sort((a, b) => a - b);
    expect(chain.length).toBeGreaterThan(20);
    e = exp;
    for (const t of chain) for (const at of [t - 1, t, t + 1]) e = advanceExpedition(e, at);
    expect(advanceExpedition(e, H)).toEqual(one);
    expect(exp).toEqual(frozen);
    pin("first:parity", hash(one));
  });
});

// ===== 5. later expeditions =====

// Safe first runs SF-2: a save that ran expeditions up to `nextExpeditionId`, so its training run is behind it (done
// and claimed; the ordinary runs after it counted). The run counters are all it changes (whole states hash without
// them), so these rows keep their pre-SF-2 capture. Pure.
function afterTraining(state: GameState): GameState {
  const counts = state.runCounts!;
  return { ...state, runCounts: { ...counts, expedition: { completed: Math.max(0, state.nextExpeditionId - 2), trainingDone: true, veteran: false } } };
}

describe("SF-0 golden 5: later expeditions", () => {
  for (const crew of ["d18", "rank1", "rank6"] as CrewName[]) {
    for (const nextId of [2, 11]) {
      it(`Orion ${crew} as expedition ${nextId}: the outcome of each candidate, the record, the run and the claim`, () => {
        const out: string[] = [];
        for (const cand of CANDS) {
          const { exp, done, claimed } = sweepRun(afterTraining({ ...withCrew(onHull("orion"), crew), nextExpeditionId: nextId }), cand);
          expect(exp.shakedown).toBe(false);
          expect(exp.difficulty).toBeUndefined(); // SF-2: not the training run
          out.push(hash(exp), hash(done), claimed === null ? "unclaimed" : stateHash(claimed));
        }
        pin(`later:orion:${crew}:${nextId}`, out);
      });
    }
  }

  it("a REAL second run: Eir rank 3 first run (SF-2: its training run) of candidate 0 claimed, then the next save's candidate 0 dispatched", () => {
    const first = sweepRun(withCrew(onHull("eir"), "rank3"), "cand-0");
    expect(first.claimed).not.toBeNull();
    const back = { ...first.claimed!, gameTimeSeconds: first.done.phaseAnchorSeconds + 1 };
    expect(back.nextExpeditionId).toBe(2);
    const second = sweepRun(back, "cand-0");
    expect(second.exp.shakedown).toBe(false);
    expect(isTrainingRun(first.exp)).toBe(true); // SF-2
    expect(second.exp.difficulty).toBeUndefined(); // the claimed training run marked training done
    pin("later:eir:real", [stateHash(first.claimed!), hash(second.exp), hash(second.done), second.claimed === null ? "unclaimed" : stateHash(second.claimed)]);
    if (SWEEP) pin("lines:later:eir:real", [line(runOutcome(first.done)), line(runOutcome(second.done))]);
  });
});

// ===== 6. the hazard-scaled guards =====

describe("SF-0 golden 6: the hazard-scaled guards (generateEncounter)", () => {
  it("Vault, Subterranean and three ordinary sites at hazards 0 to 1, seeds 1, 2, 3 and 0x9e3779b9", () => {
    const out: string[] = [];
    for (const poi of ["buriedVault", "subterraneanCivilization", "ancientRuins", "caveNetwork", "unknownSite"]) {
      for (const hazard of [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.65, 0.9, 1]) {
        const sets = [1, 2, 3, 0x9e3779b9].map((seed) => generateEncounter(seed, hazard, poi));
        const hp = sets.map((s) => s.reduce((n, c) => n + c.hp, 0));
        out.push(`${poi}:${hazard}:n=${sets.map((s) => s.length).join("/")}:hp=${hp.join("/")}:${hash(sets)}`);
      }
    }
    pin("guards", out);
  });
});

// ===== 7. an OLD save: a v69 save that already ran expeditions and a patrol =====

// A save written before safe first runs (SAVE v69): ship-1 an Eir with a rank 3 crew slotted across both teams, two
// expeditions already flown and claimed (nextExpeditionId 3, the save seed advanced twice), four patrols dispatched
// (nextPatrolSeed 5) and one Sweep won (lifetimeStats.missionsCompleted). Written to a save, stamped v69 and loaded back
// through deserialize + migrate. From SF-1 on the migration counts it as a veteran (plan section 3.3), so its patrol
// and its expedition must stay byte-identical from SF-1 to SF-4 (whole states through stateHash).
const PRE_SF_SAVE_VERSION = 69;

function oldSave(): GameState {
  const crewed = withCrew(onHull("eir"), "rank3");
  const held: GameState = {
    ...crewed,
    gameTimeSeconds: 500_000,
    nextExpeditionId: 3,
    expeditionSeed: advanceExpeditionSeed(advanceExpeditionSeed(EXPEDITION_DEFAULT_SEED)),
    nextPatrolSeed: 5,
    credits: new Decimal(100_000),
    lifetimeStats: { ...crewed.lifetimeStats, missionsCompleted: { ...crewed.lifetimeStats.missionsCompleted, crimsonReaverSweep: new Decimal(1) } },
  };
  const save = deserialize(serialize(held, 0)) as SaveFile;
  return migrate({ ...save, version: PRE_SF_SAVE_VERSION });
}

describe("SF-0 golden 7: an old save (v69, expeditions and a patrol already flown) through migrate", () => {
  it("the migrated state, one Sweep patrol cycle and one expedition run, hashed whole", () => {
    const state = oldSave();
    expect(state.nextExpeditionId).toBe(3);
    expect(state.nextPatrolSeed).toBe(5);
    const patrol = patrolOnce(state, "crimsonReaverSweep");
    const run = sweepRun(state, "cand-0");
    expect(run.exp.shakedown).toBe(false);
    const out = [
      stateHash(state),
      `patrol:${patrol.won ? "won" : "lost"}:${patrol.ticks}`, hash(patrol.record), stateHash(patrol.end),
      `expedition:${run.done.phase}`, hash(run.exp), hash(run.done), run.claimed === null ? "unclaimed" : stateHash(run.claimed),
    ];
    pin("old:v69", out);
    // G2-2 review: the veteran's one Wolf 359 stamp is the only change to the claimed state.
    expect(run.claimed?.wolf359List).toBe(3);
    const { wolf359List: _stamp, ...unstamped } = run.claimed!;
    expect(stateHash(unstamped as GameState)).toBe("a830e43c");
  });
});

// ===== measurement tables (SF_SWEEP or npm run test:sweep only) =====

describe.runIf(SWEEP)("SF-0 measurement tables (gated): forecast bands, the 200-seed win table, outcome lines", () => {
  it("the dispatch card's Threat Assessment band for every hull x both routes on a fresh save", () => {
    const out = HULLS.flatMap((hull) => ROUTES.map((key) => `${hull}:${key}:${JSON.stringify(patrolForecast(onHull(hull), key))}`));
    pin("patrol:forecast", out);
  });

  // Section 2.5 E: Dispatch Once over master seeds 0 to 199 through the live economyTick loop, wins out of 200
  // (won = the cycle ended and the ship is not damaged). One big call per patrol (closed-form parity, above).
  // Re-pinned by WR-4 (B14: turn order by side, then input order, the player side first). Was: freighter 187 / 3,
  // hauler 199 / 8, runner 103 / 0, miner 107 / 0 (unchanged), destroyer 200 / 39, battleship 200 / 156, carrier
  // 200 / 101, Orion 178 / 1, Aurora 177 / 1, Eir 173 / 1.
  const WINS: Record<string, [number, number]> = {
    generalFreighter: [191, 5],
    prospectorHauler: [198, 10],
    prospectorRunner: [106, 0],
    prospectorMiner: [107, 0],
    destroyer: [200, 44],
    battleship: [200, 158],
    carrier: [200, 109],
    orion: [176, 1],
    aurora: [174, 1],
    eir: [172, 1],
  };
  for (const hull of HULLS) {
    it(`${hull}: the 200-seed win table (Sweep, Warband)`, () => {
      const wins = ROUTES.map((key) => {
        const def = PATROLS[key];
        const span = def.transitOutTicks + def.rollWindowTicks + 3 * def.transitBackTicks + 4;
        let n = 0;
        for (let seed = 0; seed < 200; seed++) {
          // SF-4: dispatched as a PATROL VETERAN, so this stays the section 2.5 E NOMINAL record (the route at full
          // strength, which the top of the patrol curve equals: safeFirstPatrol.sweep.test.ts CURVE_WINS); a fresh
          // save's first patrol is now the training cycle (proven in safeFirstPatrol).
          const r = dispatchCaptainOnPatrol(asPatrolVeteran(patrolBase(hull, seed)), 1, key, "balanced", false);
          expect(r.success).toBe(true);
          const end = economyTick(r.next, span, RNG);
          if (patrolOf(end) === null && end.ships[0].damaged !== true) n += 1;
        }
        return n;
      });
      expect(wins).toEqual(WINS[hull]);
    });
  }

  // The section 2.5 A outcome lines (the same runs golden 4 hashes) and golden 5's.
  for (const hull of FIRST_HULLS) {
    for (const crew of CREW_NAMES) {
      it(`${hull} ${crew}: the shakedown outcome line of each candidate (section 2.5 A)`, () => {
        pin(`lines:first:${hull}:${crew}`, CANDS.map((cand) => `${cand} ${line(runOutcome(sweepRun(withCrew(onHull(hull), crew), cand).done))}`));
      });
    }
  }
  for (const crew of ["d18", "rank1", "rank6"] as CrewName[]) {
    for (const nextId of [2, 11]) {
      it(`Orion ${crew} as expedition ${nextId}: the outcome line of each candidate`, () => {
        const lines = CANDS.map((cand) => `${cand} ${line(runOutcome(sweepRun(afterTraining({ ...withCrew(onHull("orion"), crew), nextExpeditionId: nextId }), cand).done))}`);
        pin(`lines:later:orion:${crew}:${nextId}`, lines);
      });
    }
  }
});
