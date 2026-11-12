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
// GOLDEN_PRE is that capture (on 8688c61). The engine commit (WR-8) proves three things about it:
//   - the switch (combatRulesSwitch.fixture.ts withCombatRulesOff: no run stamped, the nine WR-8 craft lines out of
//     their pools) reproduces every GOLDEN_PRE row, so WR-8 moved nothing else here;
//   - IN FLIGHT: a patrol cycle or expedition dispatched before WR-8 (dispatched inside the switch, then advanced by
//     the live WR-8 engine) is byte-identical to GOLDEN_PRE (Dispatch Once rows, every ship-event row and battle row);
//   - GOLDEN pins the live WR-8 game, every move named in its header.

// The ordering determinism slice (canonicalOrder.ts: `discovered` and the lifetime tally maps kept in canonical order)
// came after every pin here: the file runs with it off (orderingSwitch.fixture.ts), so its pins keep proving their own
// slice (orderingGoldens.test.ts pins the order move and proves it moved order only).
import { canonicalOrderOffForThisFile } from "./orderingSwitch.fixture";
canonicalOrderOffForThisFile();
// Ordering determinism part 2 (canonicalOrder.ts: inventory keys and a call's completion log in one order) came after every pin here, traced order-only: the file runs with it off (ordering2Switch.fixture.ts).
import { ordering2OffForThisFile } from "./ordering2Switch.fixture";
ordering2OffForThisFile();
// OC-F14 (the field repair rules stamped at dispatch on a system mixing repair worlds with other bodies) came after every pin
// here, traced: the file runs with it off (fieldRepairRulesSwitch.fixture.ts), so its pins keep proving their own slice
// (fieldRepairOrderGoldens.test.ts pins OC-F14's moves and proves them with the switch off).
import { repairRulesOffForThisFile } from "./fieldRepairRulesSwitch.fixture";
repairRulesOffForThisFile();
import { describe, expect, it } from "vitest";
// WR-8b (enemy torpedoes) came after every pin here: the file runs with it off (enemyTorpedoSwitch.fixture.ts), so its
// pins keep proving their own slice (enemyTorpedoGoldens.test.ts pins what WR-8b moved, enemyTorpedoes.test.ts proves it).
import { enemyTorpedoesOffForThisFile } from "./enemyTorpedoSwitch.fixture";
enemyTorpedoesOffForThisFile();
// Wiring WR-10 (the away rules stamped at dispatch, a hire's account program) came after every pin here: the whole file
// runs with WR-10 off (wr10Switch.fixture.ts), so its pins keep proving their own slice (wr10Goldens.test.ts pins WR-10's).
import { wr10OffForThisFile } from "./wr10Switch.fixture";
wr10OffForThisFile();
import { cp16OffForThisFile } from "./cp16Switch.fixture";
// Complement CP-16 (the Hall of Command) came after every pin here: the file runs with the slice off, so its pins
// keep proving their own slice (cp16Goldens.test.ts pins what CP-16 moved: the missions counter, the notables and
// the Hall of Command entry).
cp16OffForThisFile();
import { cp14OffForThisFile } from "./cp14Switch.fixture";
// Complement CP-14 (hull base sensors and Science amplification) came after every pin here: the file runs with the
// slice off, so its pins keep proving their own slice (cp14Goldens.test.ts pins what CP-14 moved).
cp14OffForThisFile();
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
import { asExpeditionVeteran, asPatrolVeteran, dispatchPastPropulsion, withoutNebula, withoutRelicStagger } from "./awayTeamTestFixtures";
import { patrolDifficultyAt } from "./runDifficulty";
import { shipCombatRulesStamp } from "./crewOverlay";
import { withCombatRulesOff } from "./combatRulesSwitch.fixture";
// Merged onto feat (gear wear step 3 landed there after these pins): every row here was captured before step 3, so the
// file runs with use wear switched off (the precedent every pre-step-3 golden file follows); the expedition rows'
// whole-run hashes were the only rows step 3 moved (its run wear stamp), and gearWearGoldens.test.ts pins the wear.
import { gearWearOffInThisFile } from "./gearWearSwitch.fixture";
import { patrolLegsOffForThisFile } from "./patrolLegsSwitch.fixture";
import { wr11OffForThisFile } from "./wr11Switch.fixture";

// WR-7 follow-up OC-D8 (patrol legs scale with transit speed): every pin here predates the legs and is about WR-8 (the combat descriptors);
// with the legs off each one returns (checked when the legs were wired), so the file runs with them off and keeps
// proving its own slice. patrolLegsGoldens.test.ts pins the legs on every patrol and every combat hull.
patrolLegsOffForThisFile();
// Wiring WR-11 came after every pin here: the whole file runs with WR-11 off (wr11Switch.fixture.ts), so its pins keep
// proving their own slice moved nothing else (WR-11's own moves are pinned in wr11Goldens.test.ts).
wr11OffForThisFile();
gearWearOffInThisFile();

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
// `inFlight`: dispatched inside the switch (a cycle from before WR-8), then advanced by the live engine.
function patrolRow(hull: ShipTypeKey, key: PatrolKey, repeat: boolean, inFlight = false): string[] {
  const r = inFlight ? withCombatRulesOff(() => dispatchCaptainOnPatrol(base(hull), 1, key, "balanced", repeat)) : dispatchCaptainOnPatrol(base(hull), 1, key, "balanced", repeat);
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
  // WR-8: the stamp a dispatch would write now (App.svelte passes the same; before WR-8 there was none).
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

// One Ground Operations run from an expedition veteran save: its ship events and battles, and the run's outcome.
function shipEventRow(hull: ShipTypeKey, cand: string, seed: number | undefined, inFlight = false): string[] {
  const go = () => dispatchPastPropulsion(asExpeditionVeteran(withCrew(onHull(hull, seed), "d18")), "ship-1", 1, cand);
  const res = inFlight ? withCombatRulesOff(go) : go();
  expect(res.success, `${hull} ${cand}: ${res.reason}`).toBe(true);
  // Merged onto feat: Gas Giant Study GG-4 (after these pins) stamps a nebula on some systems at dispatch; these rows
  // were captured before it, so the record is read without the stamp (awayTeamTestFixtures.ts withoutNebula, the
  // strip every pre-GG-4 pin uses). It moved only the four nebula systems' whole-run hashes (default and 101 cand-2,
  // 303 cand-0 / cand-1), never a battle.
  // Relics v2 tier stagger (after these pins): a new run's relic blanks flag carries `stagger` and its relic tokens the
  // stamp; the rows are read as dispatched before it (withoutRelicStagger), which moves no draw and no battle.
  const done: Expedition = advanceExpedition(withoutRelicStagger(withoutNebula(res.expedition!)), SWEEP_END);
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
function battleRow(hull: ShipTypeKey, cand: string, inFlight = false): string[] {
  const go = () => dispatchPastPropulsion(asExpeditionVeteran(withCrew(onHull(hull), "d18")), "ship-1", 1, cand);
  const res = inFlight ? withCombatRulesOff(go) : go();
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

const GOLDEN_PRE: Record<string, unknown> = {
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

// Every row id and how to compute it (`inFlight` as above; the forecast reads the stamp a dispatch writes now).
interface Row {
  id: string;
  run: (inFlight: boolean) => unknown;
  inFlight: boolean; // a run that can be in flight (the forecast is a display read, Repeat relaunches stamp new cycles)
}
const ROWS: Row[] = [
  ...EXPLORERS.flatMap((hull) => CANDS.map((cand) => ({ id: `battle:${hull}:${cand}`, run: (f: boolean) => battleRow(hull, cand, f), inFlight: true }))),
  ...HULLS.flatMap((hull) =>
    ROUTES.flatMap((key) =>
      [false, true].map((repeat) => ({ id: `patrol:${hull}:${key}:${repeat ? "repeat" : "once"}`, run: (f: boolean) => patrolRow(hull, key, repeat, f), inFlight: !repeat })),
    ),
  ),
  ...FORECAST_HULLS.flatMap((hull) => ROUTES.map((key) => ({ id: `forecast:${hull}:${key}`, run: () => forecast(base(hull), key), inFlight: false }))),
  ...EXPLORERS.flatMap((hull) =>
    EXPEDITION_SEEDS.flatMap((seed) =>
      CANDS.map((cand) => ({ id: `shipEvent:${hull}:${seed ?? "default"}:${cand}`, run: (f: boolean) => shipEventRow(hull, cand, seed, f), inFlight: true })),
    ),
  ),
];

describe("WR-8 combat goldens: the switch reproduces the capture taken before the engine edit", () => {
  for (const row of ROWS) {
    it(row.id, () => {
      expect(withCombatRulesOff(() => row.run(false))).toEqual(GOLDEN_PRE[row.id]);
    });
  }
});

describe("WR-8 in flight: a run dispatched before WR-8 is byte-identical under the WR-8 engine", () => {
  for (const row of ROWS.filter((r) => r.inFlight)) {
    it(row.id, () => {
      expect(row.run(true)).toEqual(GOLDEN_PRE[row.id]);
    });
  }
});

describe("WR-8 combat goldens: the live game", () => {
  for (const row of ROWS) {
    it(row.id, () => {
      const id = row.id;
      expect(row.run(false)).toEqual(GOLDEN[id]);
    });
  }
});

// The live WR-8 game. Every move is the combat rules (combatRules.ts), each named:
//   patrol:*      every dispatch record and every relaunch record carries the stamp ({ rules: 1, speed: 30 }), so every
//                 record, replay and whole-state hash moves. The fights themselves now open at ENCOUNTER_OPEN_DISTANCE
//                 with pre-charged guns, the pirates carry their plates and evasion, the stance holds at its band
//                 within the ship's reach. Outcomes that changed: the General Freighter loses its Sweep at tick 14 (was
//                 won; its one autocannon against plated, evasive Raiders) and its Warband earlier (tick 20, was 23);
//                 the Prospector Hauler loses its Warband (tick 23, was won at 22); the Battleship's Warband Repeat
//                 flies a third cycle (lost at 65, was lost at 39). Every other outcome and tick holds.
//   forecast:*    the dispatch card's band under the rules: Freighter Sweep 55 of 64 (was 63), Warband 0 (was 2);
//                 Destroyer Warband 3 (was 11); Battleship Warband 47 (was 52, likely -> worthy); Carrier Warband 16
//                 (was 39, worthy -> not advised); Orion Sweep 47 (was 60, likely -> worthy). The Sweep for the
//                 Destroyer, Battleship and Carrier and the Orion's Warband are unchanged.
//   shipEvent:*   every run's frozen ship-event battle inputs carry the stamp, so every events and run hash moves; the
//                 battle outcomes, objectives, hull damage and setbacks of all 36 runs are unchanged.
//   battle:*      the vessel opens at range (the cloaked one with its railgun at 300): seven Cloaked Vessel fights that
//                 were lost are won now and two that were won are lost (orion cand-0, aurora cand-0 / cand-1, eir
//                 cand-0 / cand-1); orion cand-1 / cand-2, aurora cand-2 and eir cand-2 hold every fight.
//
// WR-8 review (user 2026-10-22: the stances decide where a ship parks, Defensive does all four; option 1 "Soften
// pirates for now"): the table above was re-pinned. What moved from the first WR-8 pin, and why:
//   patrol:*      the softened pirates (Raider armor 3 / evasion 3, Marauder 10 / 2, Corsair Carrier 8 / 1, no
//                 dampening) and Balanced parking where most of the firepower reaches (a Destroyer's autocannons fire):
//                 the General Freighter wins its Sweep again (tick 14, its Repeat flies all three cycles and wins at
//                 42), as it did before WR-8; the Battleship's Warband Repeat loses its second cycle (tick 40, was a
//                 third cycle lost at 65): the Warband's Marauders fly Balanced and now park where their autocannons
//                 fire too, and its Corsair Carriers fly Defensive (their stored "standoff") with its modifiers.
//                 Every other outcome and tick holds; every record, replay and state hash moves.
//   forecast:*    Freighter Sweep 56 (55 at the first pin, 63 before WR-8); Destroyer Warband 9 (3, 11); Battleship
//                 Warband 53, likely (47 worthy, 52 likely); Carrier Warband 29, dice (16 not advised, 39 worthy);
//                 Orion Sweep 58, likely (47 worthy, 60 likely).
//   shipEvent:*   the default-seed cand-2 Cloaked Vessel fight is lost now for all three explorers (was won): the
//                 vessel flies Balanced and its autocannon carries most of its damage, so it parks at autocannon range
//                 and both its guns fire. The other 33 runs' outcomes hold.
//   battle:*      the same Cloaked Vessel effect on the battle grid: orion cand-0 / cand-1 / cand-2 each lose one more
//                 cloaked fight, aurora cand-0 three and cand-2 two, eir cand-0 three and cand-2 one; eir cand-1 wins
//                 one back. Content balance for the vessel waits with the rest (user 2026-10-22: "the actual balancing
//                 of the content can wait").
//
// WR-8 review answer 5 (user 2026-10-22, "Closing is evasive (Recommended)"): a ship closing toward its stance range
// while none of its guns reaches a foe takes CLOSING_EVASION_PCT (40) less, both sides. Re-pinned; what moved:
//   patrol:*      every outcome and tick holds; the replays and state hashes move (the closing hits are smaller).
//   forecast:*    Freighter Sweep 58 (was 56), Battleship Warband 52 (was 53), Carrier Warband 26 (was 29); bands hold.
//   shipEvent:*   unchanged (all 36 runs, including the default-seed cand-2 cloaked loss).
//   battle:*      three cloaked fights won back (aurora cand-0 and cand-2, eir cand-2, one each).
//
// WR-8 follow-up review (2026-10-23): re-pinned again. Every outcome move is fix 3 alone (the evasive state is read
// after the move, so it stops the tick a gun reaches; an ablation with only fix 3 undone reproduces the last pin's
// outcomes): eir cand-2 loses that one cloaked fight again; forecasts Freighter Sweep 57 (was 58), Carrier Warband 23,
// not advised (was 26, dice). Patrol outcomes and ticks hold. Fix 2 (the guard drone volley's real log line) and fix 4
// (a drained Defensive shield banks no absorb remainder) move only the Warband patrols' replays and state hashes (the
// Defensive Corsair Carriers fly there), never an outcome.
const GOLDEN: Record<string, unknown> = {
  "battle:orion:cand-0": [
    "probe:0:0:win:0", "probe:0:1:win:0", "probe:0:2:win:0", "probe:1:0:win:0", "probe:1:1:win:0",
    "probe:1:2:win:0", "cloakedPass:0:0:win:0", "cloakedPass:0:1:win:0", "cloakedPass:0:2:win:0",
    "cloakedPass:1:0:win:0", "cloakedPass:1:1:win:0", "cloakedPass:1:2:win:0", "cloakedFail:0:0:win:0",
    "cloakedFail:0:1:win:0", "cloakedFail:0:2:win:0", "cloakedFail:1:0:win:0", "cloakedFail:1:1:loss:41",
    "cloakedFail:1:2:win:0",
  ],
  "battle:orion:cand-1": [
    "probe:0:0:win:0", "probe:0:1:win:0", "probe:0:2:win:0", "probe:1:0:win:0", "probe:1:1:win:0",
    "probe:1:2:win:0", "cloakedPass:0:0:win:0", "cloakedPass:0:1:win:0", "cloakedPass:0:2:win:0",
    "cloakedPass:1:0:win:0", "cloakedPass:1:1:win:0", "cloakedPass:1:2:win:0", "cloakedFail:0:0:win:0",
    "cloakedFail:0:1:win:0", "cloakedFail:0:2:loss:41", "cloakedFail:1:0:win:0", "cloakedFail:1:1:win:0",
    "cloakedFail:1:2:win:0",
  ],
  "battle:orion:cand-2": [
    "probe:0:0:win:0", "probe:0:1:win:0", "probe:0:2:win:0", "probe:1:0:win:0", "probe:1:1:win:0",
    "probe:1:2:win:0", "cloakedPass:0:0:win:0", "cloakedPass:0:1:win:0", "cloakedPass:0:2:loss:41",
    "cloakedPass:1:0:win:0", "cloakedPass:1:1:win:0", "cloakedPass:1:2:win:0", "cloakedFail:0:0:win:0",
    "cloakedFail:0:1:win:0", "cloakedFail:0:2:win:0", "cloakedFail:1:0:win:0", "cloakedFail:1:1:win:0",
    "cloakedFail:1:2:win:0",
  ],
  "battle:aurora:cand-0": [
    "probe:0:0:win:0", "probe:0:1:win:0", "probe:0:2:win:0", "probe:1:0:win:0", "probe:1:1:win:0",
    "probe:1:2:win:0", "cloakedPass:0:0:win:0", "cloakedPass:0:1:win:0", "cloakedPass:0:2:win:0",
    "cloakedPass:1:0:win:0", "cloakedPass:1:1:win:0", "cloakedPass:1:2:win:0", "cloakedFail:0:0:win:0",
    "cloakedFail:0:1:win:0", "cloakedFail:0:2:loss:36", "cloakedFail:1:0:win:0", "cloakedFail:1:1:loss:36",
    "cloakedFail:1:2:win:0",
  ],
  "battle:aurora:cand-1": [
    "probe:0:0:win:0", "probe:0:1:win:0", "probe:0:2:win:0", "probe:1:0:win:0", "probe:1:1:win:0",
    "probe:1:2:win:0", "cloakedPass:0:0:win:0", "cloakedPass:0:1:win:0", "cloakedPass:0:2:win:0",
    "cloakedPass:1:0:win:0", "cloakedPass:1:1:win:0", "cloakedPass:1:2:win:0", "cloakedFail:0:0:win:0",
    "cloakedFail:0:1:win:0", "cloakedFail:0:2:loss:36", "cloakedFail:1:0:win:0", "cloakedFail:1:1:win:0",
    "cloakedFail:1:2:win:0",
  ],
  "battle:aurora:cand-2": [
    "probe:0:0:win:0", "probe:0:1:win:0", "probe:0:2:win:0", "probe:1:0:win:0", "probe:1:1:win:0",
    "probe:1:2:win:0", "cloakedPass:0:0:win:0", "cloakedPass:0:1:win:0", "cloakedPass:0:2:loss:36",
    "cloakedPass:1:0:win:0", "cloakedPass:1:1:win:0", "cloakedPass:1:2:win:0", "cloakedFail:0:0:win:0",
    "cloakedFail:0:1:win:0", "cloakedFail:0:2:win:0", "cloakedFail:1:0:win:0", "cloakedFail:1:1:win:0",
    "cloakedFail:1:2:win:0",
  ],
  "battle:eir:cand-0": [
    "probe:0:0:win:0", "probe:0:1:win:0", "probe:0:2:win:0", "probe:1:0:win:0", "probe:1:1:win:0",
    "probe:1:2:win:0", "cloakedPass:0:0:win:0", "cloakedPass:0:1:win:0", "cloakedPass:0:2:win:0",
    "cloakedPass:1:0:win:0", "cloakedPass:1:1:win:0", "cloakedPass:1:2:win:0", "cloakedFail:0:0:win:0",
    "cloakedFail:0:1:win:0", "cloakedFail:0:2:loss:43", "cloakedFail:1:0:loss:43", "cloakedFail:1:1:loss:43",
    "cloakedFail:1:2:win:0",
  ],
  "battle:eir:cand-1": [
    "probe:0:0:win:0", "probe:0:1:win:0", "probe:0:2:win:0", "probe:1:0:win:0", "probe:1:1:win:0",
    "probe:1:2:win:0", "cloakedPass:0:0:win:0", "cloakedPass:0:1:win:0", "cloakedPass:0:2:win:0",
    "cloakedPass:1:0:win:0", "cloakedPass:1:1:win:0", "cloakedPass:1:2:win:0", "cloakedFail:0:0:win:0",
    "cloakedFail:0:1:win:0", "cloakedFail:0:2:loss:43", "cloakedFail:1:0:win:0", "cloakedFail:1:1:win:0",
    "cloakedFail:1:2:win:0",
  ],
  "battle:eir:cand-2": [
    "probe:0:0:win:0", "probe:0:1:win:0", "probe:0:2:win:0", "probe:1:0:win:0", "probe:1:1:win:0",
    "probe:1:2:win:0", "cloakedPass:0:0:win:0", "cloakedPass:0:1:win:0", "cloakedPass:0:2:loss:43",
    "cloakedPass:1:0:win:0", "cloakedPass:1:1:win:0", "cloakedPass:1:2:win:0", "cloakedFail:0:0:win:0",
    "cloakedFail:0:1:loss:43", "cloakedFail:0:2:win:0", "cloakedFail:1:0:win:0", "cloakedFail:1:1:win:0",
    "cloakedFail:1:2:win:0",
  ],
  "patrol:generalFreighter:crimsonReaverSweep:once": ["e38d27d1", "597c09a2", "won:14", "b2f38143", "619f0aa1"],
  "patrol:generalFreighter:crimsonReaverSweep:repeat": [
    "73034d22", "597c09a2", "relaunch:14", "63a72302", "802729ba", "relaunch:28", "c21dbd9a", "4099a67c",
    "won:42", "b2f38143", "1193c52",
  ],
  "patrol:generalFreighter:crimsonReaverWarband:once": ["8170ae77", "3bc66d4f", "lost:20", "701a58f1", "beaf4ad4"],
  "patrol:generalFreighter:crimsonReaverWarband:repeat": ["99dcfe20", "3bc66d4f", "lost:20", "701a58f1", "beaf4ad4"],
  "patrol:prospectorHauler:crimsonReaverSweep:once": ["f98b7306", "41ce7378", "won:14", "9d03d00b", "44d412c5"],
  "patrol:prospectorHauler:crimsonReaverSweep:repeat": [
    "934c2bc3", "41ce7378", "relaunch:14", "e12e8723", "e1b49b3", "relaunch:28", "ffa3365b", "e0ca0b5f",
    "won:42", "9d03d00b", "47f525c2",
  ],
  "patrol:prospectorHauler:crimsonReaverWarband:once": ["80c4d6e8", "45b124f1", "lost:23", "8539ed3f", "2e9d3cfb"],
  "patrol:prospectorHauler:crimsonReaverWarband:repeat": ["106706bd", "45b124f1", "lost:23", "8539ed3f", "2e9d3cfb"],
  "patrol:prospectorRunner:crimsonReaverSweep:once": ["63a6753a", "b0c9ae30", "lost:10", "e1360e3a", "3458dee6"],
  "patrol:prospectorRunner:crimsonReaverSweep:repeat": ["214270f", "b0c9ae30", "lost:10", "e1360e3a", "3458dee6"],
  "patrol:prospectorRunner:crimsonReaverWarband:once": ["121696a8", "88141285", "lost:20", "e1360e3a", "7542ef9a"],
  "patrol:prospectorRunner:crimsonReaverWarband:repeat": ["30947c7d", "88141285", "lost:20", "e1360e3a", "7542ef9a"],
  "patrol:prospectorMiner:crimsonReaverSweep:once": ["de8ea837", "1b2af2bc", "lost:10", "4a78733f", "e7fd04bd"],
  "patrol:prospectorMiner:crimsonReaverSweep:repeat": ["e25a34e0", "1b2af2bc", "lost:10", "4a78733f", "e7fd04bd"],
  "patrol:prospectorMiner:crimsonReaverWarband:once": ["45245f69", "8774e398", "lost:20", "4a78733f", "445177ad"],
  "patrol:prospectorMiner:crimsonReaverWarband:repeat": ["33ff849a", "8774e398", "lost:20", "4a78733f", "445177ad"],
  "patrol:destroyer:crimsonReaverSweep:once": ["31e77619", "ba2ee129", "won:14", "6ad9f46c", "d4055219"],
  "patrol:destroyer:crimsonReaverSweep:repeat": [
    "88ed10aa", "ba2ee129", "relaunch:14", "60ebf60a", "ec4d7b2e", "relaunch:28", "7e062882", "b1f3a2b2",
    "won:42", "6ad9f46c", "bba9124",
  ],
  "patrol:destroyer:crimsonReaverWarband:once": ["d309e353", "5469ccef", "won:22", "6ad9f46c", "94a165d6"],
  "patrol:destroyer:crimsonReaverWarband:repeat": [
    "f622e534", "5469ccef", "relaunch:22", "2ac69177", "92f08a9f", "lost:38", "44b4c6b5", "db558c17",
  ],
  "patrol:battleship:crimsonReaverSweep:once": ["8117c7c7", "2436a90a", "won:14", "c6dba9cb", "6a6e81a4"],
  "patrol:battleship:crimsonReaverSweep:repeat": [
    "20cde710", "2436a90a", "relaunch:14", "faca3df0", "a70c0c5b", "relaunch:28", "c0349798", "e313c0f5",
    "won:42", "c6dba9cb", "ae27954d",
  ],
  "patrol:battleship:crimsonReaverWarband:once": ["5ef43211", "a4925972", "won:22", "c6dba9cb", "394499f3"],
  "patrol:battleship:crimsonReaverWarband:repeat": [
    "34602562", "a4925972", "relaunch:22", "2140ca1f", "e9252c44", "lost:40", "afe73d75", "f547373a",
  ],
  "patrol:carrier:crimsonReaverSweep:once": ["10bbdaa4", "8f2f9130", "won:14", "ea909677", "9554bb6e"],
  "patrol:carrier:crimsonReaverSweep:repeat": [
    "850b5d91", "8f2f9130", "relaunch:14", "58546b3", "c852a96", "relaunch:28", "d272f5a0", "fe0a521d", "won:42",
    "ea909677", "64959369",
  ],
  "patrol:carrier:crimsonReaverWarband:once": ["cf2ed6fa", "c28deffe", "won:22", "ea909677", "15006abb"],
  "patrol:carrier:crimsonReaverWarband:repeat": [
    "a6257fcf", "c28deffe", "relaunch:22", "ef3396d8", "1f175bf5", "lost:38", "73109288", "5d7605b4",
  ],
  "patrol:orion:crimsonReaverSweep:once": ["40a9303c", "f6d6af33", "won:14", "c75858d4", "9f06f3dd"],
  "patrol:orion:crimsonReaverSweep:repeat": [
    "d818f5a9", "f6d6af33", "relaunch:14", "819d4289", "2232a633", "relaunch:28", "e7cf8ac1", "32de9505",
    "won:42", "c75858d4", "6d24a25c",
  ],
  "patrol:orion:crimsonReaverWarband:once": ["65e0e99a", "acbf2a27", "lost:20", "6619cb48", "20b8680"],
  "patrol:orion:crimsonReaverWarband:repeat": ["d6a857ef", "acbf2a27", "lost:20", "6619cb48", "20b8680"],
  "patrol:aurora:crimsonReaverSweep:once": ["dbd9c477", "6eeaff13", "won:14", "62b89a6f", "511447be"],
  "patrol:aurora:crimsonReaverSweep:repeat": [
    "a9555020", "6eeaff13", "relaunch:14", "2640ec00", "72233a1f", "relaunch:28", "88c7eb68", "2d93ea29",
    "won:42", "62b89a6f", "efae95d5",
  ],
  "patrol:aurora:crimsonReaverWarband:once": ["c5c49945", "a5c4a4bd", "lost:20", "def772e7", "e97d0cbd"],
  "patrol:aurora:crimsonReaverWarband:repeat": ["faa3a9e", "a5c4a4bd", "lost:20", "def772e7", "e97d0cbd"],
  "patrol:eir:crimsonReaverSweep:once": ["87e41c0f", "28bafcf2", "won:14", "ffdca63b", "ef5f54b8"],
  "patrol:eir:crimsonReaverSweep:repeat": [
    "59e3b7f8", "28bafcf2", "relaunch:14", "a8468558", "99ea9bf9", "relaunch:28", "e57d6b00", "e967f201",
    "won:42", "ffdca63b", "34db43b9",
  ],
  "patrol:eir:crimsonReaverWarband:once": ["3cd5058d", "5f90e37a", "lost:20", "7ddb5b8d", "d9543d0b"],
  "patrol:eir:crimsonReaverWarband:repeat": ["51f75e26", "5f90e37a", "lost:20", "7ddb5b8d", "d9543d0b"],
  "forecast:generalFreighter:crimsonReaverSweep": "57:likely",
  "forecast:generalFreighter:crimsonReaverWarband": "0:impossible",
  "forecast:destroyer:crimsonReaverSweep": "64:guaranteed",
  "forecast:destroyer:crimsonReaverWarband": "9:extreme",
  "forecast:battleship:crimsonReaverSweep": "64:guaranteed",
  "forecast:battleship:crimsonReaverWarband": "52:likely",
  "forecast:carrier:crimsonReaverSweep": "64:guaranteed",
  "forecast:carrier:crimsonReaverWarband": "23:notAdvised",
  "forecast:orion:crimsonReaverSweep": "58:likely",
  "forecast:orion:crimsonReaverWarband": "0:impossible",
  "shipEvent:orion:default:cand-0": ["none", "628d0a82", "1/11 hull:0 setbacks:0", "f24252bf"],
  "shipEvent:orion:default:cand-1": ["probe:win", "63ad049a", "7/10 hull:0 setbacks:2", "fd53203a"],
  "shipEvent:orion:default:cand-2": ["cloaked:loss", "577d816c", "4/6 hull:55 setbacks:2", "3c0d4e9d"],
  "shipEvent:orion:101:cand-0": ["probe:win", "f6d6791c", "7/12 hull:0 setbacks:1", "f17f4a40"],
  "shipEvent:orion:101:cand-1": ["none", "2a9661e9", "4/14 hull:0 setbacks:1", "7cb3b28a"],
  "shipEvent:orion:101:cand-2": ["probe:win", "c54ee85f", "7/15 hull:0 setbacks:1", "65d323a0"],
  "shipEvent:orion:202:cand-0": ["probe:win", "ca306f68", "2/6 hull:0 setbacks:1", "28794530"],
  "shipEvent:orion:202:cand-1": ["none", "741638a5", "0/3 hull:0 setbacks:0", "3a69453f"],
  "shipEvent:orion:202:cand-2": ["cloaked:win,cloaked:win", "3fc16ecc", "2/11 hull:14 setbacks:3", "8ed76201"],
  "shipEvent:orion:303:cand-0": ["none", "5925cf3a", "1/4 hull:0 setbacks:0", "272f6cc5"],
  "shipEvent:orion:303:cand-1": ["none", "ed0e6120", "4/9 hull:14 setbacks:2", "34257f8f"],
  "shipEvent:orion:303:cand-2": ["none", "63dee130", "2/11 hull:28 setbacks:3", "cfe2d89c"],
  "shipEvent:aurora:default:cand-0": ["none", "628d0a82", "1/11 hull:0 setbacks:0", "f828e41c"],
  "shipEvent:aurora:default:cand-1": ["probe:win", "63ad049a", "7/10 hull:0 setbacks:2", "53a73029"],
  "shipEvent:aurora:default:cand-2": ["cloaked:loss", "31a281f0", "4/6 hull:48 setbacks:2", "ed7b387e"],
  "shipEvent:aurora:101:cand-0": ["probe:win", "f6d6791c", "7/12 hull:0 setbacks:1", "7f02ebc"],
  "shipEvent:aurora:101:cand-1": ["none", "2a9661e9", "4/14 hull:0 setbacks:1", "9cb2d14e"],
  "shipEvent:aurora:101:cand-2": ["probe:win", "c54ee85f", "7/15 hull:0 setbacks:1", "56c82b60"],
  "shipEvent:aurora:202:cand-0": ["probe:win", "ca306f68", "2/6 hull:0 setbacks:1", "9bebd13d"],
  "shipEvent:aurora:202:cand-1": ["none", "741638a5", "0/3 hull:0 setbacks:0", "5bb05537"],
  "shipEvent:aurora:202:cand-2": ["cloaked:win,cloaked:win", "654d778e", "2/11 hull:12 setbacks:3", "f41c7a18"],
  "shipEvent:aurora:303:cand-0": ["none", "5925cf3a", "1/4 hull:0 setbacks:0", "ab2dd70c"],
  "shipEvent:aurora:303:cand-1": ["none", "6356624e", "4/9 hull:12 setbacks:2", "3f096b25"],
  "shipEvent:aurora:303:cand-2": ["none", "2f72ff6c", "2/11 hull:24 setbacks:3", "cba89d0d"],
  "shipEvent:eir:default:cand-0": ["none", "628d0a82", "1/11 hull:0 setbacks:0", "b76559a0"],
  "shipEvent:eir:default:cand-1": ["probe:win", "63ad049a", "7/10 hull:0 setbacks:2", "4c507ad3"],
  "shipEvent:eir:default:cand-2": ["cloaked:loss", "83f410ba", "4/6 hull:57 setbacks:2", "c13b4ee1"],
  "shipEvent:eir:101:cand-0": ["probe:win", "f6d6791c", "7/12 hull:0 setbacks:1", "614ff081"],
  "shipEvent:eir:101:cand-1": ["none", "2a9661e9", "4/14 hull:0 setbacks:1", "8dce36de"],
  "shipEvent:eir:101:cand-2": ["probe:win", "c54ee85f", "7/15 hull:0 setbacks:1", "11fda315"],
  "shipEvent:eir:202:cand-0": ["probe:win", "ca306f68", "2/6 hull:0 setbacks:1", "643a1566"],
  "shipEvent:eir:202:cand-1": ["none", "741638a5", "0/3 hull:0 setbacks:0", "6b10a88b"],
  "shipEvent:eir:202:cand-2": ["cloaked:win,cloaked:win", "3fc16ecc", "2/11 hull:14 setbacks:3", "d5bb95f6"],
  "shipEvent:eir:303:cand-0": ["none", "5925cf3a", "1/4 hull:0 setbacks:0", "b1d272b1"],
  "shipEvent:eir:303:cand-1": ["none", "ed0e6120", "4/9 hull:14 setbacks:2", "e1f155c2"],
  "shipEvent:eir:303:cand-2": ["none", "63dee130", "2/11 hull:28 setbacks:3", "7c9a31b1"],
};
