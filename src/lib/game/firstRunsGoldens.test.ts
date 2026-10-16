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
//   4. first    : the section 2.5 A runs: the shakedown of the three fresh-save candidates from the General Freighter,
//                 Orion, Aurora and Eir with every section 2.5 crew (firstRunsGoldens.fixture.ts): the dispatch record,
//                 the run at 3,000,000 s and (a finished run) the claimed state; the launch view of the shakedown;
//                 offline == live parity on a stalled shakedown.
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
// compared through `withoutDifficulty` once SF-2 stamps `Expedition.difficulty`.

import { describe, expect, it } from "vitest";
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
import { advanceExpedition, advanceExpeditionSeed, claimExpedition, expeditionCandidates, expeditionLaunchView, startExpedition } from "./expedition";
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
// and 2.5 numbers; "first:launch" equals G2-0 "display:launch" at Level 5 (b4d99ab5, 25f32e71, 8105e2b): today the
// shakedown's launch view for a D18 minimum crew on a Freighter or an Orion is the one a rank 10 crew reads.
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
    "crimsonReaverSweep:1:won:14", "894fdcae", "f603498f", "b2f38143", "d906373f", "9aaccaac", "second:won:14",
    "78db202f", "5c5f200f", "crimsonReaverSweep:2:won:14", "78db202f", "d0a063cd", "b2f38143", "d906373f", "846bdabf",
    "crimsonReaverWarband:1:lost:23", "4213eee4", "1a749a44", "701a58f1", "9e7bd12c", "4cb7057a",
    "crimsonReaverWarband:2:lost:16", "36a28cca", "7d2f6f3d", "701a58f1", "9e7bd12c", "e85992e3",
  ],
  "patrol:prospectorHauler": [
    "crimsonReaverSweep:1:won:14", "26da28a9", "13a0e65f", "9d03d00b", "d906373f", "602748c4", "second:won:14",
    "dffae6a0", "b6b1cf6f", "crimsonReaverSweep:2:won:14", "dffae6a0", "5b0c2091", "9d03d00b", "d906373f", "64782bdb",
    "crimsonReaverWarband:1:won:22", "e98455fb", "6a4da60d", "9d03d00b", "cad0779e", "623023d1", "second:lost:16",
    "5d562ccd", "310f0f68", "crimsonReaverWarband:2:lost:16", "5d562ccd", "2ba17e8d", "8539ed3f", "9e7bd12c",
    "cd118af1",
  ],
  "patrol:prospectorRunner": [
    "crimsonReaverSweep:1:lost:10", "7a2a52c9", "24b128ff", "e1360e3a", "b9abbd11", "364a5e8f",
    "crimsonReaverSweep:2:won:14", "4be00ff0", "bcd29e6f", "c4afd62a", "d906373f", "48a753a7",
    "crimsonReaverWarband:1:lost:20", "254c266f", "c001d6c9", "e1360e3a", "9e7bd12c", "7cc32db7",
    "crimsonReaverWarband:2:lost:16", "814a58cd", "df452afd", "e1360e3a", "9e7bd12c", "f0588aad",
  ],
  "patrol:prospectorMiner": [
    "crimsonReaverSweep:1:lost:10", "2bf09384", "1f40a647", "4a78733f", "b9abbd11", "f24797ea",
    "crimsonReaverSweep:2:won:14", "1b079aa1", "e5733243", "3e9366f7", "d906373f", "55528ada",
    "crimsonReaverWarband:1:lost:20", "73831be6", "19ddf77d", "4a78733f", "9e7bd12c", "70e1e9de",
    "crimsonReaverWarband:2:lost:16", "385f8ab0", "923a96dd", "4a78733f", "9e7bd12c", "b5dcc6bc",
  ],
  "patrol:destroyer": [
    "crimsonReaverSweep:1:won:14", "c614f4e", "92e2290b", "6ad9f46c", "d906373f", "4dbab70a", "second:won:14",
    "612de50b", "a2584e79", "crimsonReaverSweep:2:won:14", "612de50b", "8a5edc7f", "6ad9f46c", "d906373f", "254c14f3",
    "crimsonReaverWarband:1:won:22", "6993bb20", "d63f0205", "6ad9f46c", "cad0779e", "e616f487", "second:lost:16",
    "ceb37f8a", "4accee1d", "crimsonReaverWarband:2:lost:16", "ceb37f8a", "dfb6b4dd", "44b4c6b5", "9e7bd12c",
    "abe2906a",
  ],
  "patrol:battleship": [
    "crimsonReaverSweep:1:won:14", "233cf766", "f450532b", "c6dba9cb", "d906373f", "e122bfe3", "second:won:14",
    "292269d9", "721f2948", "crimsonReaverSweep:2:won:14", "292269d9", "14f63e6b", "c6dba9cb", "d906373f", "6a9b041a",
    "crimsonReaverWarband:1:won:22", "518735a0", "2f3d1b47", "c6dba9cb", "cad0779e", "2cdaa522", "second:won:22",
    "e41c4bc2", "8a1d5ed1", "crimsonReaverWarband:2:won:22", "e41c4bc2", "1f696f91", "c6dba9cb", "cad0779e",
    "cc27c553",
  ],
  "patrol:carrier": [
    "crimsonReaverSweep:1:won:14", "d5718c2f", "2a9583d7", "ea909677", "d906373f", "8a22b163", "second:won:14",
    "e9a099c5", "e6c360fc", "crimsonReaverSweep:2:won:14", "e9a099c5", "36e5dcc1", "ea909677", "d906373f", "c015e028",
    "crimsonReaverWarband:1:won:22", "47f02015", "fe21761f", "ea909677", "cad0779e", "c743aab8", "second:lost:17",
    "95fd3dd4", "b6aa627d", "crimsonReaverWarband:2:lost:17", "95fd3dd4", "5a573127", "73109288", "9e7bd12c",
    "3972c48a",
  ],
  "patrol:orion": [
    "crimsonReaverSweep:1:won:14", "35ea9697", "34c59cd", "c75858d4", "d906373f", "588aace", "second:won:14",
    "3e13cff2", "182ed205", "crimsonReaverSweep:2:won:14", "3e13cff2", "25efb35", "c75858d4", "d906373f", "167cccf3",
    "crimsonReaverWarband:1:lost:20", "69062df5", "d2b7b6fd", "6619cb48", "9e7bd12c", "29712beb",
    "crimsonReaverWarband:2:lost:16", "ba65b5fb", "c8a597ad", "6619cb48", "9e7bd12c", "57bd8e9",
  ],
  "patrol:aurora": [
    "crimsonReaverSweep:1:won:14", "6ac4f480", "22d0d86d", "62b89a6f", "d906373f", "43b51fe3", "second:won:14",
    "14b5f02d", "3d65bc6a", "crimsonReaverSweep:2:won:14", "14b5f02d", "a77da1dd", "62b89a6f", "d906373f", "55b29fb4",
    "crimsonReaverWarband:1:lost:20", "3c51a286", "db5eccb5", "def772e7", "9e7bd12c", "80f78478",
    "crimsonReaverWarband:2:lost:16", "7e5bc7d4", "6d6203cd", "def772e7", "9e7bd12c", "34ca5c86",
  ],
  "patrol:eir": [
    "crimsonReaverSweep:1:won:14", "da45804", "c39acad", "ffdca63b", "d906373f", "3a103b0f", "second:won:14",
    "e91372d5", "46c9d492", "crimsonReaverSweep:2:won:14", "e91372d5", "2de6f1ab", "ffdca63b", "d906373f", "fd32715e",
    "crimsonReaverWarband:1:lost:20", "abe6f092", "734c54a5", "7ddb5b8d", "9e7bd12c", "88961f0c",
    "crimsonReaverWarband:2:lost:16", "31fd4d70", "4286587d", "7ddb5b8d", "9e7bd12c", "d2484ab2",
  ],
  "patrol:repeat": [
    "generalFreighter:crimsonReaverSweep:relaunch@14:a8402136,relaunch@28:37ba0a7c",
    "generalFreighter:crimsonReaverWarband:end@23:4cb7057a",
    "prospectorHauler:crimsonReaverSweep:relaunch@14:762b9573,relaunch@28:ff68e883",
    "prospectorHauler:crimsonReaverWarband:relaunch@22:6d698a6,end@38:56de09f1",
    "prospectorRunner:crimsonReaverSweep:end@10:364a5e8f", "prospectorRunner:crimsonReaverWarband:end@20:7cc32db7",
    "prospectorMiner:crimsonReaverSweep:end@10:f24797ea", "prospectorMiner:crimsonReaverWarband:end@20:70e1e9de",
    "destroyer:crimsonReaverSweep:relaunch@14:76ca853a,relaunch@28:8e4df34e",
    "destroyer:crimsonReaverWarband:relaunch@22:b9cc7a59,end@38:9d1b6e1a",
    "battleship:crimsonReaverSweep:relaunch@14:28eb16cd,relaunch@28:dc924a07",
    "battleship:crimsonReaverWarband:relaunch@22:df4228c8,end@39:d23d28b1",
    "carrier:crimsonReaverSweep:relaunch@14:a2d4cbec,relaunch@28:7a2cc90f",
    "carrier:crimsonReaverWarband:relaunch@22:7e5ede91,end@38:ec4655a5",
    "orion:crimsonReaverSweep:relaunch@14:f23a6edb,relaunch@28:64157315", "orion:crimsonReaverWarband:end@20:29712beb",
    "aurora:crimsonReaverSweep:relaunch@14:d90946bf,relaunch@28:a4e60bed",
    "aurora:crimsonReaverWarband:end@20:80f78478", "eir:crimsonReaverSweep:relaunch@14:df1b0f2d,relaunch@28:9fc6059",
    "eir:crimsonReaverWarband:end@20:88961f0c",
  ],
  "gather:localFuelRun": [
    "generalFreighter:99", "aa03a7cf", "5cb7d17c", "prospectorHauler:197", "aa03a7cf", "f95add53",
    "prospectorRunner:67", "aa03a7cf", "adfb07fb", "prospectorMiner:99", "aa03a7cf", "b50c8005", "destroyer:34",
    "aa03a7cf", "d4f4801b", "battleship:45", "aa03a7cf", "e3da3400", "carrier:29", "aa03a7cf", "205bb158", "orion:132",
    "aa03a7cf", "13bc036", "aurora:110", "aa03a7cf", "b0b16d1d", "eir:241", "aa03a7cf", "3e08c03e",
  ],
  "gather:shortOreRun": [
    "generalFreighter:149", "173ed900", "71f4e5f8", "prospectorHauler:261", "173ed900", "68634ae1",
    "prospectorRunner:101", "173ed900", "5c6fcd51", "prospectorMiner:149", "173ed900", "c0252403", "destroyer:74",
    "173ed900", "bafb9044", "battleship:117", "173ed900", "db61b049", "carrier:93", "173ed900", "f1ce2096", "orion:178",
    "173ed900", "f1c59294", "aurora:150", "173ed900", "3ee58661", "eir:297", "173ed900", "119e8729",
  ],
  // Re-pinned by WR-4 (OC-C2): the Lunar Mine's uncommon strike is Dense Ore (was Cobalt Ore). Only the item key moved:
  // naming denseOre back to cobaltOre in each delivered state reproduces the SF-0 capture exactly (b5a45464, a88a60b9,
  // 9c723e64, 6171239, 918723ae, da2d527c, e20c7223, 774e6e96, d0deecde, 263885a6); the delivery ticks did not move.
  "gather:longOreRun": [
    "generalFreighter:239", "8e6386f4", "bcaa3a86", "prospectorHauler:373", "8e6386f4", "703b91b5",
    "prospectorRunner:161", "8e6386f4", "fbb3099e", "prospectorMiner:239", "8e6386f4", "3a81b117", "destroyer:142",
    "8e6386f4", "9ad9447a", "battleship:245", "8e6386f4", "817e097c", "carrier:205", "8e6386f4", "b5b79a13",
    "orion:260", "8e6386f4", "bcd67224", "aurora:218", "8e6386f4", "741bbc86", "eir:397", "8e6386f4", "bb47cfbe",
  ],
  "gather:salvageWreckage": [
    "generalFreighter:189", "35190dab", "435061d", "prospectorHauler:311", "35190dab", "6d57eaeb",
    "prospectorRunner:refused:cargo", "prospectorMiner:189", "35190dab", "a124e0c2", "destroyer:refused:cargo",
    "battleship:refused:cargo", "carrier:refused:cargo", "orion:214", "35190dab", "a2e97dea", "aurora:180", "35190dab",
    "1e2c94c3", "eir:341", "35190dab", "14a9e885",
  ],
  "gather:forageFlora": [
    "generalFreighter:209", "c1cb8da7", "41a1dba4", "prospectorHauler:335", "c1cb8da7", "cb7371e7",
    "prospectorRunner:refused:cargo", "prospectorMiner:209", "c1cb8da7", "8a2c45d3", "destroyer:refused:cargo",
    "battleship:refused:cargo", "carrier:refused:cargo", "orion:232", "c1cb8da7", "5f675192", "aurora:196", "c1cb8da7",
    "53160c94", "eir:365", "c1cb8da7", "826b0915",
  ],
  "gather:surveyMineralAnomaly": [
    "generalFreighter:269", "3779b356", "3b44c217", "prospectorHauler:411", "3779b356", "fa2a7fa6",
    "prospectorRunner:refused:cargo", "prospectorMiner:269", "3779b356", "c282f8aa", "destroyer:refused:cargo",
    "battleship:refused:cargo", "carrier:refused:cargo", "orion:288", "3779b356", "87d89698", "aurora:242", "3779b356",
    "9c6bd709", "eir:431", "3779b356", "447c125b",
  ],
  "gather:surveyStellarPhenomena": [
    "generalFreighter:289", "c883a6b9", "b4ea4745", "prospectorHauler:refused:fuelCapacity",
    "prospectorRunner:refused:cargo", "prospectorMiner:refused:fuelCapacity", "destroyer:refused:cargo",
    "battleship:refused:cargo", "carrier:refused:cargo", "orion:306", "c883a6b9", "b782dfdd", "aurora:258", "c883a6b9",
    "d5b4f99c", "eir:453", "c883a6b9", "13309cf7",
  ],
  "gather:frontierSupplyRun": [
    "generalFreighter:219", "dd5c4e0", "dcd6cce1", "prospectorHauler:347", "dd5c4e0", "1586b17c",
    "prospectorRunner:refused:cargo", "prospectorMiner:219", "dd5c4e0", "edca7b36", "destroyer:refused:cargo",
    "battleship:refused:cargo", "carrier:refused:cargo", "orion:242", "dd5c4e0", "f1b251c3", "aurora:204", "dd5c4e0",
    "edd344bd", "eir:375", "dd5c4e0", "e0f2e1a2",
  ],
  "gather:colonySupplyLift": [
    "generalFreighter:279", "a3dde4a3", "b9356573", "prospectorHauler:423", "a3dde4a3", "c5ba079f",
    "prospectorRunner:refused:cargo", "prospectorMiner:refused:fuelCapacity", "destroyer:refused:cargo",
    "battleship:refused:cargo", "carrier:refused:cargo", "orion:296", "a3dde4a3", "acd911d1", "aurora:250", "a3dde4a3",
    "16929aa2", "eir:441", "a3dde4a3", "741ba1c0",
  ],
  "first:generalFreighter:d18": [
    "9e5223c9", "3a5a95d9", "unclaimed", "2115da58", "71f5cbed", "unclaimed", "fd592d55", "becf9484", "unclaimed",
  ],
  "first:generalFreighter:board2": [
    "3da2c645", "2823a200", "unclaimed", "8304ea98", "bfb6992a", "unclaimed", "3732ba19", "a214f5fe", "unclaimed",
  ],
  "first:generalFreighter:board10": [
    "cd4fcbd1", "53e686c7", "unclaimed", "1beccb10", "2be2ead9", "unclaimed", "480c8429", "503b3056", "unclaimed",
  ],
  "first:generalFreighter:rank1": [
    "31f939de", "49731bac", "unclaimed", "25f2e1bb", "9014510", "unclaimed", "496d6e18", "a2081d57", "unclaimed",
  ],
  "first:generalFreighter:rank3": [
    "facd5f14", "a2d97311", "unclaimed", "43b8770d", "2623ac1b", "unclaimed", "8769feca", "7cd794bc", "unclaimed",
  ],
  "first:generalFreighter:rank6": [
    "1dadcf56", "7522a9e4", "unclaimed", "9def7063", "9d98dd39", "40bd9861", "1becdf14", "bc2880f", "unclaimed",
  ],
  "first:orion:d18": [
    "bf09aa6a", "64188ee0", "unclaimed", "ae4c51ff", "d5744d5b", "unclaimed", "72573038", "bd23b57f", "unclaimed",
  ],
  "first:orion:board2": [
    "2e25da36", "db2af4c5", "unclaimed", "2fc00f3f", "f3ab2c7f", "unclaimed", "dfd4f8bc", "c487b8f1", "unclaimed",
  ],
  "first:orion:board10": [
    "3abc17b8", "809df1dd", "unclaimed", "1f8293ed", "f52f303d", "unclaimed", "124bff60", "d76be846", "unclaimed",
  ],
  "first:orion:rank1": [
    "c90a2e2b", "41a12945", "unclaimed", "5a902f36", "54074929", "unclaimed", "a3c5474b", "336cdf54", "unclaimed",
  ],
  "first:orion:rank3": [
    "8bda8e61", "d753750", "unclaimed", "f7abe8e8", "870bb909", "unclaimed", "a4a39ed5", "100f31d9", "unclaimed",
  ],
  "first:orion:rank6": [
    "affcd813", "223525a2", "unclaimed", "860b3dae", "bf21bed5", "b6cb2433", "4470367", "c7b46c88", "unclaimed",
  ],
  "first:aurora:d18": [
    "52536dde", "756ee33c", "unclaimed", "5a7ab11b", "5dd300cf", "unclaimed", "87d5ba4a", "dd32a3f9", "unclaimed",
  ],
  "first:aurora:board2": [
    "fa2dceaa", "28607fcf", "unclaimed", "55313a5b", "c287057b", "unclaimed", "4967997e", "c4305587", "unclaimed",
  ],
  "first:aurora:board10": [
    "49375564", "5a6036f7", "unclaimed", "5f4ed371", "f7b92c21", "unclaimed", "2d9dec82", "b77026b6", "unclaimed",
  ],
  "first:aurora:rank1": [
    "88eb9415", "44669eb3", "unclaimed", "1a3d22e4", "4ed13047", "unclaimed", "e7ca94df", "2fca8cb0", "unclaimed",
  ],
  "first:aurora:rank3": [
    "86763a7b", "bfaa6416", "unclaimed", "74b53c5e", "5c417add", "unclaimed", "6e276961", "f8354d21", "unclaimed",
  ],
  "first:aurora:rank6": [
    "7087672d", "99c4d0f6", "unclaimed", "cd047b4c", "1d9bc0c9", "d02d8fba", "df55fd0b", "daab71f8", "unclaimed",
  ],
  "first:eir:d18": [
    "642344c4", "5d9d444a", "unclaimed", "55785a59", "a4032671", "unclaimed", "1aac0526", "1fa77fb5", "unclaimed",
  ],
  "first:eir:board2": [
    "56a48f68", "2a5a989b", "unclaimed", "4940b499", "7a20ad31", "unclaimed", "61b6a912", "ee419ce7", "unclaimed",
  ],
  "first:eir:board10": [
    "27a3b4f8", "84fb8de5", "unclaimed", "8a585031", "7c62a83b", "34383073", "7a333c16", "e61e1745", "unclaimed",
  ],
  "first:eir:rank1": [
    "ab42177f", "e2f372fb", "unclaimed", "2b4146ce", "94ba26f6", "c5eb3f80", "be290397", "61f70297", "unclaimed",
  ],
  "first:eir:rank3": [
    "d3ded431", "b69720a", "bbf5b584", "4a025d0c", "8624329f", "7ef7b4be", "ff3ba6f5", "d5007501", "dcb515f6",
  ],
  "first:eir:rank6": [
    "592b5c07", "c6e3826e", "unclaimed", "6b218f86", "e478219", "unclaimed", "2563a80b", "6a6f159f", "a7b92c9c",
  ],
  "first:systems": [
    "Lyra's Wake: volcanic 0.65, barren 0.1", "Halcyon Drift: ocean 0.4, barren 0.1",
    "Calliope Reach: toxic 0.9, gasGiant 0.1",
  ],
  "first:candidates": "8207442a",
  "first:launch": [
    "generalFreighter:cand-0:b4d99ab5", "generalFreighter:cand-1:25f32e71", "generalFreighter:cand-2:8105e2b",
    "orion:cand-0:b4d99ab5", "orion:cand-1:25f32e71", "orion:cand-2:8105e2b",
  ],
  "first:parity": "7ad8dc07",
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
    "3ebe3031", "297bc2dd", "unclaimed", "ddabe588", "75f3ef6", "d1d4a03a", "24220565", "5a9637ba", "unclaimed",
  ],
  "later:orion:rank6:11": [
    "9ea9cc93", "733b01d7", "unclaimed", "18972976", "a952bd2e", "6976cc8", "ebc0bc6f", "628cb48", "unclaimed",
  ],
  "later:eir:real": ["bbf5b584", "d2d53bc8", "a076d1ec", "unclaimed"],
  "lines:later:eir:real": [
    "complete 11/11 lost:47 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:2",
    "activities 7/8 lost:76 sent:502 stuck:geothermalChamber hull:14 setbacks:1 boarded:0 vault:3",
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
  "old:v69": [
    "46fc44f8", "patrol:won:14", "2150f1b6", "cfe43cca", "expedition:complete", "a4fc1f4f", "bbbd0b9e", "75ab4c47",
  ],
  // Re-pinned by WR-4 (B14): turn order by side, then input order (the player side first) moves the forecast wins.
  "patrol:forecast": [
    "generalFreighter:crimsonReaverSweep:{\"rating\":1310,\"wins\":63,\"tier\":\"likely\"}",
    "generalFreighter:crimsonReaverWarband:{\"rating\":1310,\"wins\":2,\"tier\":\"extreme\"}",
    "prospectorHauler:crimsonReaverSweep:{\"rating\":1558,\"wins\":64,\"tier\":\"guaranteed\"}",
    "prospectorHauler:crimsonReaverWarband:{\"rating\":1558,\"wins\":2,\"tier\":\"extreme\"}",
    "prospectorRunner:crimsonReaverSweep:{\"rating\":766,\"wins\":37,\"tier\":\"dice\"}",
    "prospectorRunner:crimsonReaverWarband:{\"rating\":766,\"wins\":0,\"tier\":\"impossible\"}",
    "prospectorMiner:crimsonReaverSweep:{\"rating\":942,\"wins\":37,\"tier\":\"dice\"}",
    "prospectorMiner:crimsonReaverWarband:{\"rating\":942,\"wins\":0,\"tier\":\"impossible\"}",
    "destroyer:crimsonReaverSweep:{\"rating\":1967,\"wins\":64,\"tier\":\"guaranteed\"}",
    "destroyer:crimsonReaverWarband:{\"rating\":1967,\"wins\":11,\"tier\":\"extreme\"}",
    "battleship:crimsonReaverSweep:{\"rating\":3386,\"wins\":64,\"tier\":\"guaranteed\"}",
    "battleship:crimsonReaverWarband:{\"rating\":3386,\"wins\":52,\"tier\":\"likely\"}",
    "carrier:crimsonReaverSweep:{\"rating\":3138,\"wins\":64,\"tier\":\"guaranteed\"}",
    "carrier:crimsonReaverWarband:{\"rating\":3138,\"wins\":39,\"tier\":\"worthy\"}",
    "orion:crimsonReaverSweep:{\"rating\":1464,\"wins\":60,\"tier\":\"likely\"}",
    "orion:crimsonReaverWarband:{\"rating\":1464,\"wins\":0,\"tier\":\"impossible\"}",
    "aurora:crimsonReaverSweep:{\"rating\":1348,\"wins\":60,\"tier\":\"likely\"}",
    "aurora:crimsonReaverWarband:{\"rating\":1348,\"wins\":0,\"tier\":\"impossible\"}",
    "eir:crimsonReaverSweep:{\"rating\":1380,\"wins\":57,\"tier\":\"likely\"}",
    "eir:crimsonReaverWarband:{\"rating\":1380,\"wins\":0,\"tier\":\"impossible\"}",
  ],
  "lines:first:generalFreighter:d18": [
    "cand-0 activities 1/11 lost:40 sent:588 stuck:derelictOutpost+geothermalChamber+derelictOutpost+geothermalChamber+mineralOutcrop+subterraneanCivilization+mineralOutcrop+mineralOutcrop+crashedShip+subterraneanCivilization hull:0 setbacks:0 boarded:0 vault:2",
    "cand-1 activities 7/10 lost:40 sent:587 stuck:geothermalChamber+subterraneanCivilization+subterraneanCivilization hull:0 setbacks:3 boarded:3 vault:2",
    "cand-2 activities 7/9 lost:40 sent:558 stuck:buriedVault+geothermalChamber hull:80 setbacks:2 boarded:0 vault:1",
  ],
  "lines:first:generalFreighter:board2": [
    "cand-0 activities 1/11 lost:40 sent:585 stuck:derelictOutpost+geothermalChamber+derelictOutpost+geothermalChamber+mineralOutcrop+subterraneanCivilization+mineralOutcrop+mineralOutcrop+crashedShip+subterraneanCivilization hull:0 setbacks:0 boarded:0 vault:2",
    "cand-1 activities 7/10 lost:40 sent:585 stuck:geothermalChamber+subterraneanCivilization+subterraneanCivilization hull:0 setbacks:3 boarded:3 vault:2",
    "cand-2 activities 7/9 lost:40 sent:583 stuck:buriedVault+geothermalChamber hull:80 setbacks:2 boarded:0 vault:1",
  ],
  "lines:first:generalFreighter:board10": [
    "cand-0 activities 10/11 lost:78 sent:566 stuck:subterraneanCivilization hull:0 setbacks:0 boarded:0 vault:2",
    "cand-1 activities 9/10 lost:40 sent:578 stuck:subterraneanCivilization hull:0 setbacks:3 boarded:3 vault:2",
    "cand-2 activities 8/9 lost:40 sent:573 stuck:buriedVault hull:80 setbacks:2 boarded:0 vault:1",
  ],
  "lines:first:generalFreighter:rank1": [
    "cand-0 activities 10/11 lost:43 sent:519 stuck:subterraneanCivilization hull:0 setbacks:0 boarded:0 vault:2",
    "cand-1 activities 9/10 lost:40 sent:461 stuck:subterraneanCivilization hull:0 setbacks:3 boarded:3 vault:2",
    "cand-2 activities 8/9 lost:40 sent:577 stuck:buriedVault hull:80 setbacks:2 boarded:0 vault:1",
  ],
  "lines:first:generalFreighter:rank3": [
    "cand-0 activities 10/11 lost:43 sent:565 stuck:subterraneanCivilization hull:0 setbacks:0 boarded:0 vault:2",
    "cand-1 activities 9/10 lost:40 sent:580 stuck:subterraneanCivilization hull:0 setbacks:3 boarded:3 vault:2",
    "cand-2 activities 8/9 lost:40 sent:575 stuck:buriedVault hull:80 setbacks:2 boarded:0 vault:1",
  ],
  "lines:first:generalFreighter:rank6": [
    "cand-0 activities 10/11 lost:40 sent:567 stuck:subterraneanCivilization hull:0 setbacks:0 boarded:0 vault:2",
    "cand-1 complete 10/10 lost:2 sent:0 stuck:none hull:0 setbacks:3 boarded:3 vault:2",
    "cand-2 activities 8/9 lost:40 sent:575 stuck:buriedVault hull:80 setbacks:2 boarded:0 vault:1",
  ],
  "lines:first:orion:d18": [
    "cand-0 activities 1/11 lost:40 sent:588 stuck:derelictOutpost+geothermalChamber+derelictOutpost+geothermalChamber+mineralOutcrop+subterraneanCivilization+mineralOutcrop+mineralOutcrop+crashedShip+subterraneanCivilization hull:0 setbacks:0 boarded:0 vault:2",
    "cand-1 activities 7/10 lost:40 sent:587 stuck:geothermalChamber+subterraneanCivilization+subterraneanCivilization hull:0 setbacks:2 boarded:3 vault:2",
    "cand-2 activities 7/9 lost:40 sent:558 stuck:buriedVault+geothermalChamber hull:55 setbacks:2 boarded:0 vault:1",
  ],
  "lines:first:orion:board2": [
    "cand-0 activities 1/11 lost:40 sent:585 stuck:derelictOutpost+geothermalChamber+derelictOutpost+geothermalChamber+mineralOutcrop+subterraneanCivilization+mineralOutcrop+mineralOutcrop+crashedShip+subterraneanCivilization hull:0 setbacks:0 boarded:0 vault:2",
    "cand-1 activities 7/10 lost:40 sent:585 stuck:geothermalChamber+subterraneanCivilization+subterraneanCivilization hull:0 setbacks:2 boarded:3 vault:2",
    "cand-2 activities 7/9 lost:40 sent:583 stuck:buriedVault+geothermalChamber hull:55 setbacks:2 boarded:0 vault:1",
  ],
  "lines:first:orion:board10": [
    "cand-0 activities 10/11 lost:40 sent:519 stuck:subterraneanCivilization hull:0 setbacks:0 boarded:0 vault:2",
    "cand-1 activities 9/10 lost:40 sent:535 stuck:subterraneanCivilization hull:0 setbacks:2 boarded:3 vault:2",
    "cand-2 activities 8/9 lost:40 sent:571 stuck:buriedVault hull:55 setbacks:2 boarded:0 vault:1",
  ],
  "lines:first:orion:rank1": [
    "cand-0 activities 10/11 lost:43 sent:519 stuck:subterraneanCivilization hull:0 setbacks:0 boarded:0 vault:2",
    "cand-1 activities 9/10 lost:40 sent:461 stuck:subterraneanCivilization hull:0 setbacks:2 boarded:3 vault:2",
    "cand-2 activities 8/9 lost:40 sent:577 stuck:buriedVault hull:55 setbacks:2 boarded:0 vault:1",
  ],
  "lines:first:orion:rank3": [
    "cand-0 activities 10/11 lost:43 sent:565 stuck:subterraneanCivilization hull:0 setbacks:0 boarded:0 vault:2",
    "cand-1 activities 9/10 lost:40 sent:580 stuck:subterraneanCivilization hull:0 setbacks:2 boarded:3 vault:2",
    "cand-2 activities 8/9 lost:40 sent:575 stuck:buriedVault hull:55 setbacks:2 boarded:0 vault:1",
  ],
  "lines:first:orion:rank6": [
    "cand-0 activities 10/11 lost:40 sent:567 stuck:subterraneanCivilization hull:0 setbacks:0 boarded:0 vault:2",
    "cand-1 complete 10/10 lost:2 sent:0 stuck:none hull:0 setbacks:2 boarded:3 vault:2",
    "cand-2 activities 8/9 lost:40 sent:575 stuck:buriedVault hull:55 setbacks:2 boarded:0 vault:1",
  ],
  "lines:first:aurora:d18": [
    "cand-0 activities 1/11 lost:40 sent:588 stuck:derelictOutpost+geothermalChamber+derelictOutpost+geothermalChamber+mineralOutcrop+subterraneanCivilization+mineralOutcrop+mineralOutcrop+crashedShip+subterraneanCivilization hull:0 setbacks:0 boarded:0 vault:2",
    "cand-1 activities 7/10 lost:40 sent:587 stuck:geothermalChamber+subterraneanCivilization+subterraneanCivilization hull:0 setbacks:2 boarded:3 vault:2",
    "cand-2 activities 7/9 lost:40 sent:558 stuck:buriedVault+geothermalChamber hull:48 setbacks:2 boarded:0 vault:1",
  ],
  "lines:first:aurora:board2": [
    "cand-0 activities 1/11 lost:40 sent:585 stuck:derelictOutpost+geothermalChamber+derelictOutpost+geothermalChamber+mineralOutcrop+subterraneanCivilization+mineralOutcrop+mineralOutcrop+crashedShip+subterraneanCivilization hull:0 setbacks:0 boarded:0 vault:2",
    "cand-1 activities 7/10 lost:40 sent:585 stuck:geothermalChamber+subterraneanCivilization+subterraneanCivilization hull:0 setbacks:2 boarded:3 vault:2",
    "cand-2 activities 7/9 lost:40 sent:583 stuck:buriedVault+geothermalChamber hull:48 setbacks:2 boarded:0 vault:1",
  ],
  "lines:first:aurora:board10": [
    "cand-0 activities 10/11 lost:40 sent:519 stuck:subterraneanCivilization hull:0 setbacks:0 boarded:0 vault:2",
    "cand-1 activities 9/10 lost:40 sent:535 stuck:subterraneanCivilization hull:0 setbacks:2 boarded:3 vault:2",
    "cand-2 activities 8/9 lost:40 sent:571 stuck:buriedVault hull:48 setbacks:2 boarded:0 vault:1",
  ],
  "lines:first:aurora:rank1": [
    "cand-0 activities 10/11 lost:43 sent:519 stuck:subterraneanCivilization hull:0 setbacks:0 boarded:0 vault:2",
    "cand-1 activities 9/10 lost:40 sent:461 stuck:subterraneanCivilization hull:0 setbacks:2 boarded:3 vault:2",
    "cand-2 activities 8/9 lost:40 sent:577 stuck:buriedVault hull:48 setbacks:2 boarded:0 vault:1",
  ],
  "lines:first:aurora:rank3": [
    "cand-0 activities 10/11 lost:43 sent:565 stuck:subterraneanCivilization hull:0 setbacks:0 boarded:0 vault:2",
    "cand-1 activities 9/10 lost:40 sent:580 stuck:subterraneanCivilization hull:0 setbacks:2 boarded:3 vault:2",
    "cand-2 activities 8/9 lost:40 sent:575 stuck:buriedVault hull:48 setbacks:2 boarded:0 vault:1",
  ],
  "lines:first:aurora:rank6": [
    "cand-0 activities 10/11 lost:40 sent:567 stuck:subterraneanCivilization hull:0 setbacks:0 boarded:0 vault:2",
    "cand-1 complete 10/10 lost:2 sent:0 stuck:none hull:0 setbacks:2 boarded:3 vault:2",
    "cand-2 activities 8/9 lost:40 sent:575 stuck:buriedVault hull:48 setbacks:2 boarded:0 vault:1",
  ],
  "lines:first:eir:d18": [
    "cand-0 activities 1/11 lost:40 sent:588 stuck:derelictOutpost+geothermalChamber+derelictOutpost+geothermalChamber+mineralOutcrop+subterraneanCivilization+mineralOutcrop+mineralOutcrop+crashedShip+subterraneanCivilization hull:0 setbacks:0 boarded:0 vault:2",
    "cand-1 activities 7/10 lost:40 sent:587 stuck:geothermalChamber+subterraneanCivilization+subterraneanCivilization hull:0 setbacks:2 boarded:3 vault:2",
    "cand-2 activities 7/9 lost:40 sent:558 stuck:buriedVault+geothermalChamber hull:57 setbacks:2 boarded:0 vault:1",
  ],
  "lines:first:eir:board2": [
    "cand-0 activities 1/11 lost:40 sent:585 stuck:derelictOutpost+geothermalChamber+derelictOutpost+geothermalChamber+mineralOutcrop+subterraneanCivilization+mineralOutcrop+mineralOutcrop+crashedShip+subterraneanCivilization hull:0 setbacks:0 boarded:0 vault:2",
    "cand-1 activities 7/10 lost:40 sent:585 stuck:geothermalChamber+subterraneanCivilization+subterraneanCivilization hull:0 setbacks:2 boarded:3 vault:2",
    "cand-2 activities 7/9 lost:40 sent:583 stuck:buriedVault+geothermalChamber hull:57 setbacks:2 boarded:0 vault:1",
  ],
  "lines:first:eir:board10": [
    "cand-0 activities 10/11 lost:40 sent:571 stuck:subterraneanCivilization hull:0 setbacks:0 boarded:0 vault:2",
    "cand-1 complete 10/10 lost:27 sent:0 stuck:none hull:0 setbacks:2 boarded:3 vault:2",
    "cand-2 activities 8/9 lost:40 sent:571 stuck:buriedVault hull:57 setbacks:2 boarded:0 vault:1",
  ],
  "lines:first:eir:rank1": [
    "cand-0 activities 10/11 lost:78 sent:574 stuck:subterraneanCivilization hull:0 setbacks:0 boarded:0 vault:2",
    "cand-1 complete 10/10 lost:31 sent:0 stuck:none hull:0 setbacks:2 boarded:3 vault:2",
    "cand-2 activities 8/9 lost:40 sent:576 stuck:buriedVault hull:57 setbacks:2 boarded:0 vault:1",
  ],
  "lines:first:eir:rank3": [
    "cand-0 complete 11/11 lost:47 sent:0 stuck:none hull:0 setbacks:0 boarded:0 vault:2",
    "cand-1 complete 10/10 lost:0 sent:0 stuck:none hull:0 setbacks:2 boarded:3 vault:2",
    "cand-2 complete 9/9 lost:39 sent:0 stuck:none hull:57 setbacks:2 boarded:0 vault:1",
  ],
  "lines:first:eir:rank6": [
    "cand-0 activities 10/11 lost:61 sent:580 stuck:subterraneanCivilization hull:0 setbacks:0 boarded:0 vault:2",
    "cand-1 activities 9/10 lost:40 sent:581 stuck:subterraneanCivilization hull:0 setbacks:2 boarded:3 vault:2",
    "cand-2 complete 9/9 lost:2 sent:0 stuck:none hull:57 setbacks:2 boarded:0 vault:1",
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
  return { ...onHull(hull), nextPatrolSeed: seed, fuel: new Decimal(100_000), credits: new Decimal(100_000) };
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
// (FORECAST_SEED 0x5a4d + i over DEFAULT_SAMPLES, the installed gear, the folded start pools, the battle rating).
// null for a hull the card shows no readout for (combatHullTypeOf null).
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

  it("closed form: one economyTick call == 1 s ticks over a won (Orion Sweep) and a lost, limping (Runner Warband) first patrol", () => {
    for (const [hull, key] of [["orion", "crimsonReaverSweep"], ["prospectorRunner", "crimsonReaverWarband"]] as [ShipTypeKey, PatrolKey][]) {
      const start = dispatchCaptainOnPatrol(patrolBase(hull, 1), 1, key, "balanced", false).next;
      const { end, ticks } = patrolOnce(patrolBase(hull, 1), key);
      // The patrol-tick.test.ts parity gate's scope: the mission carry-state, the ship, the seed counter, the tank.
      const big = economyTick(start, ticks, RNG);
      expect(big.captains).toEqual(end.captains);
      expect(big.ships).toEqual(end.ships);
      expect(big.nextPatrolSeed).toBe(end.nextPatrolSeed);
      expect(big.fuel.toString()).toBe(end.fuel.toString());
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
    fuel: new Decimal(1_000_000_000),
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

// ===== 4. the first expedition (the shakedown) from a fresh save: section 2.5 A =====

const FIRST_HULLS: ShipTypeKey[] = ["generalFreighter", "orion", "aurora", "eir"];

function sweepRun(state: GameState, cand: string): { exp: Expedition; done: Expedition; claimed: GameState | null; next: GameState } {
  const res = startExpedition(state, "ship-1", 1, cand);
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

describe("SF-0 golden 4: the first expedition (the shakedown) of the three fresh-save candidates (section 2.5 A)", () => {
  for (const hull of FIRST_HULLS) {
    for (const crew of CREW_NAMES) {
      it(`${hull} ${crew}: the outcome of each candidate, the dispatch record, the run at 3,000,000 s and the claim`, () => {
        const out: string[] = [];
        for (const cand of CANDS) {
          const { exp, done, claimed } = sweepRun(withCrew(onHull(hull), crew), cand);
          expect(exp.shakedown).toBe(true);
          out.push(hash(exp), hash(done), claimed === null ? "unclaimed" : stateHash(claimed));
        }
        pin(`first:${hull}:${crew}`, out);
      });
    }
  }

  it("the three candidates every new save is offered: systems, bodies and hazards", () => {
    const cands = expeditionCandidates(withCrew(onHull("orion"), "d18"), "ship-1");
    const exps = CANDS.map((c) => startExpedition(withCrew(onHull("orion"), "d18"), "ship-1", 1, c).expedition!);
    pin("first:systems", exps.map((e) => `${e.systemName}: ${e.bodies.map((b) => `${b.planetType} ${b.hazard}`).join(", ")}`));
    pin("first:candidates", hash(cands));
  });

  // At telescope Level 5 (the founding telescope reads no per-body detail, so its launch view is empty).
  it("the launch view (demand, recommendation, forecast) of each shakedown candidate at telescope Level 5, D18 minimum crew", () => {
    const out: string[] = [];
    for (const hull of ["generalFreighter", "orion"] as ShipTypeKey[]) {
      const crewed = withCrew(onHull(hull), "d18");
      const s = { ...crewed, facilities: { ...crewed.facilities, [SUBSPACE_TELESCOPE_FACILITY_KEY]: { level: 5 } } };
      for (const c of expeditionCandidates(s, "ship-1")) {
        const view = expeditionLaunchView(s, "ship-1", c);
        expect(view.demand).not.toBeNull();
        out.push(`${hull}:${c.id}:${hash(view)}`);
      }
    }
    pin("first:launch", out);
  });

  // A stalled shakedown (D18 minimum crew, Orion, candidate 1: ship-event setbacks, a stuck Subterranean site) over its
  // first 250,000 s: one call == 997 s chunks == an EVENT-BOUNDARY chain (t - 1, t, t + 1 at every phase anchor, step
  // record, log line and ship leg of the one-call run).
  it("offline == live: one call == 997 s chunks == the event-boundary chain on a stalled shakedown", () => {
    const H = 250_000;
    const exp = startExpedition(withCrew(onHull("orion"), "d18"), "ship-1", 1, "cand-1").expedition!;
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

describe("SF-0 golden 5: later expeditions", () => {
  for (const crew of ["d18", "rank1", "rank6"] as CrewName[]) {
    for (const nextId of [2, 11]) {
      it(`Orion ${crew} as expedition ${nextId}: the outcome of each candidate, the record, the run and the claim`, () => {
        const out: string[] = [];
        for (const cand of CANDS) {
          const { exp, done, claimed } = sweepRun({ ...withCrew(onHull("orion"), crew), nextExpeditionId: nextId }, cand);
          expect(exp.shakedown).toBe(false);
          out.push(hash(exp), hash(done), claimed === null ? "unclaimed" : stateHash(claimed));
        }
        pin(`later:orion:${crew}:${nextId}`, out);
      });
    }
  }

  it("a REAL second run: Eir rank 3 shakedown of candidate 0 claimed, then the next save's candidate 0 dispatched", () => {
    const first = sweepRun(withCrew(onHull("eir"), "rank3"), "cand-0");
    expect(first.claimed).not.toBeNull();
    const back = { ...first.claimed!, gameTimeSeconds: first.done.phaseAnchorSeconds + 1 };
    expect(back.nextExpeditionId).toBe(2);
    const second = sweepRun(back, "cand-0");
    expect(second.exp.shakedown).toBe(false);
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
    fuel: new Decimal(100_000),
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
          const r = dispatchCaptainOnPatrol(patrolBase(hull, seed), 1, key, "balanced", false);
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
        const lines = CANDS.map((cand) => `${cand} ${line(runOutcome(sweepRun({ ...withCrew(onHull("orion"), crew), nextExpeditionId: nextId }, cand).done))}`);
        pin(`lines:later:orion:${crew}:${nextId}`, lines);
      });
    }
  }
});
