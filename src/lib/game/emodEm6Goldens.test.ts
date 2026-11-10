// E-MOD EM-6 (0.14.0, plan docs/plans/2026-10-17-material-lines-and-emod-plan.md section 4 EM-6): golden hashes
// captured on the code BEFORE the Proc and Active engine (the CP-0 / WR-4 / EM-0 pattern), in their own commit. The
// engine adds trigger points to the battle step loop, the extraction cycle and the body scan, so every pin below must
// hold byte for byte afterward: a fleet with no module (every save today; the catalog is empty until EM-7) takes the
// exact path it took before. Each pin covers one trigger family:
//
//   battle    : resolveBattle on the player combatants every combat hull folds from its installed gear, against an
//               enemy, for every open (plain, precharged, the player ambushing, the player ambushed), logged and not
//               (battle start, both ambush points, on hit, per combat tick, below a hull threshold).
//   patrol    : a Repeat patrol per combat hull on both routes: the dispatch record, the display replay every 150 s,
//               the state, and an IN-FLIGHT run (saved at 40 s, loaded, stepped on) that must equal the straight run.
//   groundOps : Orion runs with ship events live (probe battles and cloaked ambushes), through claim (body scanned).
//   mission   : extraction runs (a mining run, a survey, a salvage run) stepped 700 economyTick seconds, and the same
//               span as ONE offline tick() call (per mission cycle).

import { describe, expect, it } from "vitest";
import { cp16OffForThisFile } from "./cp16Switch.fixture";
// Complement CP-19: this file's pins predate the Personnel Rosters track (a new game's facility map gains its
// pre-granted Level 1), so it runs with the slice off; cp19Goldens.test.ts pins the slice itself.
import { cp19OffForThisFile } from "./cp19Switch.fixture";
cp19OffForThisFile();
// Complement CP-16 (the Hall of Command) came after every pin here: the file runs with the slice off, so its pins
// keep proving their own slice (cp16Goldens.test.ts pins what CP-16 moved: the missions counter, the notables and
// the Hall of Command entry).
cp16OffForThisFile();
import { cp14OffForThisFile } from "./cp14Switch.fixture";
// Complement CP-14 (hull base sensors and Science amplification) came after every pin here: the file runs with the
// slice off, so its pins keep proving their own slice (cp14Goldens.test.ts pins what CP-14 moved).
cp14OffForThisFile();
// Merged with WR-8 (0.14.0): every pin in this file was taken before the combat rules (combatRulesSwitch.fixture.ts),
// so the file runs with them switched off and its pins keep proving nothing else moved (the rules stamp new patrol
// cycles and runs; combatDescriptorGoldens.test.ts pins the combat rules themselves).
import { combatRulesOffForThisFile } from "./combatRulesSwitch.fixture";
import { patrolLegsOffForThisFile } from "./patrolLegsSwitch.fixture";

// WR-7 follow-up OC-D8 (patrol legs scale with transit speed): every pin here predates the legs and is about E-MOD EM-6;
// with the legs off each one returns (checked when the legs were wired), so the file runs with them off and keeps
// proving its own slice. patrolLegsGoldens.test.ts pins the legs on every patrol and every combat hull.
patrolLegsOffForThisFile();
combatRulesOffForThisFile();
// Wiring WR-11 came after every pin here: the whole file runs with WR-11 off (wr11Switch.fixture.ts), so its pins keep
// proving their own slice moved nothing else (WR-11's own moves are pinned in wr11Goldens.test.ts).
wr11OffForThisFile();
// GEAR WEAR step 3: this file's pins were captured before the use wear engine; it runs with the use sources off
// (gearWearSwitch.fixture.ts), so they keep proving nothing else moved. gearWearGoldens.test.ts pins the wear.
import { gearWearOffInThisFile } from "./gearWearSwitch.fixture";
gearWearOffInThisFile();
import Decimal from "break_infinity.js";
import { SHIP_TYPES, freshState, type AwayMember, type GameState, type MissionKey, type PatrolKey, type PatrolMissionState, type ShipTypeKey } from "./model";
import { dispatchCaptainOnMission, dispatchCaptainOnPatrol, economyTick, installMissingCombatBaselines, tick } from "./tick";
import { replayPatrol } from "./combat/patrolReplay";
import { combatHullTypeOf, shipToCombatant } from "./combat/bridge";
import { resolveBattle, type ResolveOptions } from "./combat/resolveBattle";
import { equippedFor } from "./equipment";
import { advanceExpedition, claimExpedition, expeditionCandidates } from "./expedition";
import { shipEventsLive } from "./shipScanEvents";
import { deserialize, migrate, serialize } from "./save";
import { asPreNebulaDispatch, asPreStaggerDispatch, plainAwayMember, withSlottedAwayTeams, dispatchPastPropulsion } from "./awayTeamTestFixtures";
import { goldenJson, withV1Museum } from "./firstRunsGoldens.fixture";
import { wr11OffForThisFile } from "./wr11Switch.fixture";

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}
const hash = (v: unknown): string => fnv(goldenJson(withV1Museum(v)));

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const SHIP = "ship-1";

// ship-1 re-hulled to `hull` with its Standard Issue economy and combat gear.
function hullState(hull: ShipTypeKey): GameState {
  const base = freshState();
  return installMissingCombatBaselines({ ...base, credits: new Decimal(1_000_000), ships: base.ships.map((sh) => (sh.id === SHIP ? { ...sh, typeKey: hull } : sh)) });
}

// ===== battle =====

const COMBAT_HULLS: ShipTypeKey[] = ["destroyer", "battleship", "carrier"];
const OPENS: readonly (keyof typeof OPEN_OPTIONS)[] = ["plain", "precharge", "playerAmbush", "enemyAmbush"];
const OPEN_OPTIONS = {
  plain: {},
  precharge: { precharge: true },
  playerAmbush: { precharge: true, ambush: "p" },
  enemyAmbush: { precharge: true, ambush: "e" },
} satisfies Record<string, ResolveOptions>;

function battleHash(hull: ShipTypeKey, enemyHull: ShipTypeKey, open: keyof typeof OPEN_OPTIONS): string {
  const s = hullState(hull);
  const parts: string[] = [];
  for (let seed = 1; seed <= 6; seed++) {
    for (const generateLog of [false, true]) {
      const p = shipToCombatant({ id: "p", team: "player", stats: SHIP_TYPES[hull], hullType: combatHullTypeOf(hull)!, installedGear: equippedFor(s, SHIP) });
      const e = shipToCombatant({ id: "e", team: "enemy", stats: SHIP_TYPES[enemyHull], hullType: combatHullTypeOf(enemyHull)!, position: 40 });
      const r = resolveBattle({ combatants: [p, e] }, 0x6e6 * seed, { ...OPEN_OPTIONS[open], generateLog });
      parts.push(hash(r));
    }
  }
  return fnv(parts.join("|"));
}

// ===== patrol =====

const ROUTES: PatrolKey[] = ["crimsonReaverSweep", "crimsonReaverWarband"];
const SAVE_AT = 40; // the tick the in-flight continuation saves at (mid first wave window on both routes)

function patrolRun(hull: ShipTypeKey, route: PatrolKey): { pins: string[]; inFlight: string } {
  const r = dispatchCaptainOnPatrol({ ...hullState(hull), nextPatrolSeed: 11 }, 1, route, "balanced", true);
  if (!r.success) return { pins: [`refused:${r.reason}`], inFlight: "" };
  let s = r.next;
  const out = [hash(s.captains[0].mission)];
  let saved: string | null = null;
  for (let i = 0; i < 600; i++) {
    if (i === SAVE_AT) saved = serialize(s, 0, 0);
    s = economyTick(s, 1, () => 0.5);
    if (s.captains[0].mission === null) break;
    if (i % 150 === 0) out.push(hash(replayPatrol(s, s.captains[0])));
  }
  out.push(hash(s));
  // The in-flight continuation: the run saved mid-patrol, loaded and stepped on the same span.
  let inFlight = "";
  if (saved !== null) {
    let t = migrate(deserialize(saved)!);
    for (let i = SAVE_AT; i < 600; i++) {
      t = economyTick(t, 1, () => 0.5);
      if (t.captains[0].mission === null) break;
    }
    inFlight = hash(t.captains[0]);
    expect(inFlight).toBe(hash(s.captains[0]));
  }
  return { pins: out, inFlight };
}

// ===== Ground Ops (ship events, body scans) =====

const member = (id: string, teamType: AwayMember["teamType"], over: Partial<AwayMember> = {}): AwayMember => ({ ...plainAwayMember(id, teamType, SHIP), ...over });
const SQUAD: AwayMember[] = [member("member-1", "security", { rank: 3 }), member("member-2", "security", { rank: 2, traits: ["fieldMedic"] }), member("member-11", "science")];

function groundOpsRun(seed: number): { pins: string[]; events: string } {
  const s0 = hullState("orion");
  const s = withSlottedAwayTeams({ ...s0, awayMembers: SQUAD.map((m) => ({ ...m })), nextAwayMemberId: 100, expeditionSeed: seed });
  // Gas Giant Study GG-4 came after this capture: the run flies as a pre-GG-4 dispatch (no nebula stamp, so no sweep;
  // asPreNebulaDispatch), so the pins keep proving nothing else moved (gasGiantNebulaLabGoldens.test.ts pins the sweep).
  // Relics v2 tier stagger (after this capture too): a pre-stagger dispatch (asPreStaggerDispatch, no draw moves).
  const res = asPreStaggerDispatch(asPreNebulaDispatch(dispatchPastPropulsion(s, SHIP, 1, expeditionCandidates(s, SHIP)[0].id)));
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  const exp = res.expedition;
  expect(shipEventsLive(exp)).toBe(true);
  const done = advanceExpedition(exp, 2_000_000);
  expect(done.phase).toBe("complete");
  const claim = claimExpedition({ ...res.next, expeditions: [done] }, done.id);
  expect(claim.success).toBe(true);
  const events = (done.scanEvents ?? []).map((e) => (e.kind === "shipEvent" ? `${e.event}:${e.outcome ?? ""}` : e.kind)).join(",");
  return { pins: [hash(exp), hash(done), hash(claim.next)], events };
}

// ===== missions =====

const MISSION_KEYS: MissionKey[] = ["shortOreRun", "surveyMineralAnomaly", "salvageWreckage"];

function missionRun(key: MissionKey): { stepped: string; offline: string } {
  const base = hullState("generalFreighter");
  const st: GameState = { ...base, captains: base.captains.map((c) => ({ ...c, level: 10 })) };
  const r = dispatchCaptainOnMission(st, 1, key);
  expect(r.success, key).toBe(true);
  let s = r.next;
  const rng = lcg(0xe60d);
  for (let i = 0; i < 700; i++) s = economyTick(s, 1, rng);
  const offline = tick(700, r.next, lcg(0xe60d), 0);
  return { stepped: hash(s), offline: hash(offline.captains) };
}

// ===== the goldens =====

// Captured on 3306bda (feat/crew-0.14.0) before any EM-6 engine edit. Re-pinned at the merge of feat bc25a23 for the
// feat's own changes, never EM-6's: the six patrol and patrolInFlight pins (SF-4, the safe first patrol and the
// patrol ramp) and groundOps:def0 (GG-2, orbital bodies). All 27 pins pass on bc25a23 WITHOUT the engine, so the
// engine moves nothing (no module builds no engine).
const PINS: Record<string, unknown> = {
  "battle:destroyer:plain": "73f89056",
  "battle:destroyer:precharge": "6525d0d7",
  "battle:destroyer:playerAmbush": "c324fffa",
  "battle:destroyer:enemyAmbush": "948cc89c",
  "battle:battleship:plain": "1a3961d5",
  "battle:battleship:precharge": "99568c5e",
  "battle:battleship:playerAmbush": "4f5095c1",
  "battle:battleship:enemyAmbush": "88bbdfb2",
  "battle:carrier:plain": "32c6444b",
  "battle:carrier:precharge": "365c28e2",
  "battle:carrier:playerAmbush": "6e5fba44",
  "battle:carrier:enemyAmbush": "410be37d",
  "patrol:destroyer:crimsonReaverSweep": ["e88e7058","681a7541","3818d18c","5bd6529f","572c6fce","9c3552e"],
  "patrolInFlight:destroyer:crimsonReaverSweep": "6b143eee",
  "patrol:destroyer:crimsonReaverWarband": ["4e42cdb","47b5b6da","1ce04289","4ddc5dc6","3a8e704c","78e4f845"],
  "patrolInFlight:destroyer:crimsonReaverWarband": "cf3b55b0",
  "patrol:battleship:crimsonReaverSweep": ["f40de116","95289fa1","278d563a","2811f8d7","f281de36","d4960ad3"],
  "patrolInFlight:battleship:crimsonReaverSweep": "67356c88",
  "patrol:battleship:crimsonReaverWarband": ["6a3fa333","f722f03a","33859064","1cd723ac","25e7d286","8836c80e"],
  "patrolInFlight:battleship:crimsonReaverWarband": "3b53a1b4",
  "patrol:carrier:crimsonReaverSweep": ["5f8dd1ac","8c9a3a1d","409304c1","9f465a0","80456753","1053ecec"],
  "patrolInFlight:carrier:crimsonReaverSweep": "8f053a59",
  "patrol:carrier:crimsonReaverWarband": ["3bdc91f5","30ca13f2","2db8da84","864ea95e","b443eca0","a86d9bba"],
  "patrolInFlight:carrier:crimsonReaverWarband": "dc7808fe",
  "groundOps:1234": ["cd15a363","f3d06723","60e19965"],
  "groundOpsEvents:1234": "supplyCache,debris:pass",
  "groundOps:5678": ["edabe07","e33c3497","689c6e8b"],
  "groundOpsEvents:5678": "debris:pass,supplyCache,supplyCache",
  "groundOps:9abc": ["a0085a30","64e97e30","c963310d"],
  "groundOpsEvents:9abc": "probe:win,ghost:pass,probe:win,storm:pass",
  "groundOps:def0": ["e50cd3a7","8b240a31","fab02d81"],
  "groundOpsEvents:def0": "debris:pass,cloaked:win,debris:pass,cloaked:win,storm:pass,supplyCache",
  "groundOps:2468": ["558e9737","c40215f8","e3f739ae"],
  "groundOpsEvents:2468": "probe:win,supplyCache",
  "groundOps:1357": ["20e5b097","c1198986","73c24ae7"],
  "groundOpsEvents:1357": "probe:win,supplyCache,probe:win,storm:pass,debris:pass",
  "mission:shortOreRun": "4f10cd9b",
  "missionOffline:shortOreRun": "29148ec1",
  "mission:surveyMineralAnomaly": "97d7ffc8",
  "missionOffline:surveyMineralAnomaly": "a12999e",
  "mission:salvageWreckage": "49a70c21",
  "missionOffline:salvageWreckage": "e4a3521d",
};

function pinned(key: string, value: unknown): void {
  if (!(key in PINS)) {
    console.log(`EM6PIN ${JSON.stringify(key)}: ${JSON.stringify(value)},`);
    throw new Error(`no pin for ${key}`);
  }
  if (JSON.stringify(value) !== JSON.stringify(PINS[key])) console.log(`EM6MOVE ${JSON.stringify(key)}: ${JSON.stringify(value)},`);
  expect(value).toEqual(PINS[key]);
}

describe("EM-6 goldens (module-free: the engine must leave every one byte-identical)", () => {
  for (const hull of COMBAT_HULLS) {
    for (const open of OPENS) {
      it(`battle: ${hull} vs destroyer, ${open}, six seeds, logged and offline`, () => {
        pinned(`battle:${hull}:${open}`, battleHash(hull, "destroyer", open));
      });
    }
  }
  for (const hull of COMBAT_HULLS) {
    for (const route of ROUTES) {
      it(`patrol: ${hull} on ${route}, Repeat, with the display replay and an in-flight continuation`, { timeout: 60_000 }, () => {
        const run = patrolRun(hull, route);
        pinned(`patrol:${hull}:${route}`, run.pins);
        pinned(`patrolInFlight:${hull}:${route}`, run.inFlight);
      });
    }
  }
  for (const seed of [0x1234, 0x5678, 0x9abc, 0xdef0, 0x2468, 0x1357]) {
    it(`groundOps: an Orion run with ship events (seed ${seed.toString(16)}), through claim`, { timeout: 60_000 }, () => {
      const run = groundOpsRun(seed);
      pinned(`groundOps:${seed.toString(16)}`, run.pins);
      pinned(`groundOpsEvents:${seed.toString(16)}`, run.events);
    });
  }
  for (const key of MISSION_KEYS) {
    it(`mission ${key}: 700 economyTick seconds, and the same span offline`, { timeout: 60_000 }, () => {
      const run = missionRun(key);
      pinned(`mission:${key}`, run.stepped);
      pinned(`missionOffline:${key}`, run.offline);
    });
  }
});
