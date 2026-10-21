// Field Kits FKR-1 (docs/plans/2026-10-14-field-kits-plan.md REVISED SLICES R3 FKR-1): ENEMY RANKS in the engine.
// A run dispatched since FKR-1 carries `Expedition.enemyRanks`; its final fight of a Challenging objective is led by
// an Elite, of a Dangerous or Deadly one by a Boss (user N1, N2 corrected, N3, N5), never on a training run. A run
// without the flag fights byte-identically (fieldKitsGoldens.test.ts FKR-0 and every earlier golden strip it at
// dispatch). Here: the STAMPED TWIN of FKR-0's fixtures (the same run with the flag back on) moves exactly where the
// placement says and nowhere else, the threat odds and the memo key follow, a training run reads as unranked, whole
// runs place every rank correctly, and offline == live holds on a stamped Deadly run.

import { describe, expect, it } from "vitest";
import { freshState, type AwayMember, type BodyRiskGrades, type Expedition, type ExpeditionActivity, type ExpeditionBody, type GameState, type GroundFightRecord, type ShipGroundTeam } from "./model";
import { advanceExpedition, expeditionCandidates, startExpedition } from "./expedition";
import { groundOpsAssignIdle, groundOpsBodyScanned, initGroundTasks, taskCover } from "./groundOps";
import { alertLevelAt } from "./affixes";
import { resolveTaskFight, taskFightGuard, taskFightSeed, withEscalation, withFloraToxins, type GroundFightTeam } from "./groundFight";
import { generateEncounter, type GambitLogEvent } from "./gambit";
import { groundTaskClearOdds, groundThreatOddsKey } from "./groundThreat";
import { resistedHazard } from "./relics";
import { bodyFloraGrade } from "./riskFactors";
import { EARLIER_FIGHT_LEAD, ENEMY_RANKS_VERSION, FINAL_FIGHT_LEAD, isTrainingRun, withEnemyRanks } from "./enemyRanks";
import { asExpeditionVeteran, plainAwayMember, withoutCurve, withoutEnemyRanks, withoutFieldKits, dispatchPastPropulsion } from "./awayTeamTestFixtures";
import { onHull, withCrew } from "./firstRunsGoldens.fixture";
import { wiringEntry } from "./wiring/registry";

// ===== shared helpers (the fieldKitsGoldens.test.ts fixtures, so the twins are FKR-0's runs) =====

const T0 = 100_000;
const SEC = ["member-1", "member-2", "member-3", "member-4", "member-5", "member-6"];
const SCI = ["member-11", "member-12", "member-13", "member-14", "member-15", "member-16"];
const CALM: BodyRiskGrades = { combat: 0, fauna: 0, flora: 0, hazard: 0 };
const RANKED = { version: ENEMY_RANKS_VERSION };
const TRAINING: NonNullable<Expedition["difficulty"]> = { version: 1, firstRun: true, ramp: 0, tier: 1 };

const member = (id: string, teamType: AwayMember["teamType"], rank: number): AwayMember => ({
  ...plainAwayMember(id, teamType, "ship-1"),
  rank: rank as AwayMember["rank"],
});

// ship-1: Ground + Ground fully slotted at `rank`, the clock at T0.
function crewed(expeditionSeed: number, rank = 6): GameState {
  const base = freshState();
  const teams: ShipGroundTeam[] = [
    { kind: "ground", security: SEC.slice(0, 3), science: SCI.slice(0, 3), helpOthers: false },
    { kind: "ground", security: SEC.slice(3), science: SCI.slice(3), helpOthers: false },
  ];
  return {
    ...base,
    gameTimeSeconds: T0,
    expeditionSeed,
    awayMembers: [...SEC.map((id) => member(id, "security", rank)), ...SCI.map((id) => member(id, "science", rank))],
    nextAwayMemberId: 100,
    ships: base.ships.map((sh) => ({ ...sh, groundTeams: teams })),
  };
}

// One Ground team slotted (3 / 3) at `rank` and an empty pair.
function oneTeam(rank: number): GameState {
  const base = freshState();
  const teams: ShipGroundTeam[] = [
    { kind: "ground", security: SEC.slice(0, 3), science: SCI.slice(0, 3), helpOthers: false },
    { kind: "ground", security: [null, null, null], science: [null, null, null], helpOthers: false },
  ];
  return {
    ...base,
    gameTimeSeconds: T0 - 50_000,
    awayMembers: [...SEC.slice(0, 3).map((id) => member(id, "security", rank)), ...SCI.slice(0, 3).map((id) => member(id, "science", rank))],
    nextAwayMemberId: 100,
    ships: base.ships.map((sh) => ({ ...sh, groundTeams: teams })),
  };
}

// A real dispatch turned into a run whose window opened at T0 with ONE body just scanned (fieldKitsGoldens handRun,
// affix catalog 2), WITHOUT the flag (FKR-0's run). `ranked` puts the flag back on: the stamped twin.
function handRun(state: GameState, pois: string[], risk: BodyRiskGrades, ranked: boolean): Expedition {
  const res = dispatchPastPropulsion(state, "ship-1", 1, "cand-0");
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  expect(res.expedition.enemyRanks).toEqual(RANKED); // a run dispatched today is ranked
  const d = withoutFieldKits(res.expedition);
  const body: ExpeditionBody = {
    id: "body-1",
    planetType: "terrestrial",
    scanTotal: 100,
    scanProgress: 100,
    hazard: 0.1,
    scanned: true,
    discoveries: pois.map((poiId, k) => ({ id: `${d.id}-body-1-disc-${k}`, kind: "landmark", poiId })),
    activities: pois.map((poiId, k) => ({ id: `${d.id}-body-1-act-${k}`, bodyId: "body-1", poiId, done: false })),
    risk: { ...risk },
  };
  const exp: Expedition = structuredClone({
    ...d,
    phase: "activities",
    phaseAnchorSeconds: T0,
    bodies: [body],
    scanStepCursor: Math.max(0, (d.encounterSteps ?? 1) - 1),
    groundOps: { ...d.groundOps!, startedAt: T0 },
    risk: { version: 1, tier: 1, enemyTerritory: false, system: { combat: risk.combat, fauna: risk.fauna, flora: risk.flora }, difficultyTier: 1, affixCatalog: 2 },
    ...(ranked ? { enemyRanks: RANKED } : {}),
  });
  initGroundTasks(exp, 0);
  for (const team of exp.groundOps!.teams) team.stepStartedAt = T0;
  groundOpsBodyScanned(exp, 0, T0);
  groundOpsAssignIdle(exp, T0);
  return exp;
}

const tasksOf = (e: Expedition): ExpeditionActivity[] => e.bodies[0].activities;
const ranked = (e: Expedition): Expedition => ({ ...e, enemyRanks: RANKED });
const training = (e: Expedition): Expedition => ({ ...e, difficulty: TRAINING });
// Safe first runs SF-2: the same run WITHOUT the training stamp (an ordinary run; nothing else changes).
const notTraining = (e: Expedition): Expedition => {
  const rest = { ...e };
  delete rest.difficulty;
  return rest;
};

const fightTeamsOf = (exp: Expedition, indices: number[] = [0]): GroundFightTeam[] =>
  indices.map((i) => {
    const t = exp.groundOps!.teams[i];
    return { securityIds: t.securityIds, downedThisTask: t.downedThisTask, securityShare: exp.groundOps!.factors.securityShare[i] };
  });

// FKR-0's graded objectives (one body, hazard 0.1, tier 1, catalog 2). Low (combat 1): grades 1 to 5; High (combat 3):
// grades 3 to 5.
const GRADE_RUNS = {
  Low: { pois: ["secureLandingZone", "clearHostiles", "derelictOutpost", "enemyColony", "enemyFortification"], combat: 1, grades: [1, 2, 3, 4, 5] },
  High: { pois: ["ancientRuins", "buriedVault", "derelictOutpost"], combat: 3, grades: [3, 4, 5] },
} as const;
type Side = { kind: "one" | "both"; rank: number };
const ONE3: Side = { kind: "one", rank: 3 };
const BOTH6: Side = { kind: "both", rank: 6 };

function gradeRun(which: keyof typeof GRADE_RUNS, side: Side = ONE3): Expedition {
  const g = GRADE_RUNS[which];
  const exp = handRun(side.kind === "one" ? oneTeam(side.rank) : crewed(0x6ade5, side.rank), [...g.pois], { ...CALM, combat: g.combat }, false);
  expect(tasksOf(exp).map((t) => t.difficulty)).toEqual([...g.grades]);
  return exp;
}

// The enemies a fight fields BEFORE ranks (resolveTaskFightOnSeed's chain; FKR-0's fieldedEnemies).
function fieldedEnemies(exp: Expedition, task: ExpeditionActivity, seed: number, alert: number) {
  const body = exp.bodies[0];
  return withEscalation(withFloraToxins(generateEncounter(seed, resistedHazard(body.hazard, exp.hazardResist ?? 0), task.poiId), bodyFloraGrade(body)), alert);
}

// One fight point of objective k, fought fresh (FKR-0's pointFight), as `kind`.
function pointFight(exp: Expedition, teams: GroundFightTeam[], k: number, point: number, kind: "point" | "surprise" | "reinforcement" = "point") {
  const task = { ...tasksOf(exp)[k], pointsCleared: point, fightCount: point };
  const alert = alertLevelAt(task, T0);
  const log: GambitLogEvent[] = [];
  const record = resolveTaskFight(exp, teams, exp.bodies[0], task, k, undefined, log, alert, taskCover(task), kind);
  return { record, log, enemies: fieldedEnemies(exp, task, taskFightSeed(exp, k, point), alert) };
}

// The strongest fielded enemy's id (highest power, first in list order): the rank's lead.
const leadIdOf = (enemies: { id: string; power: number }[]): string => enemies.reduce((best, e) => (e.power > best.power ? e : best)).id;

// Every fight a run starts before `end`, with its pending record as the engine stored it at the fight's start, the
// objective it was fought on, and the record's kind. Reads the history at 2,000 s steps (the display history is
// capped), then replays to each fight's start. Pure.
function runFights(exp: Expedition, end: number): { fight: GroundFightRecord; task: ExpeditionActivity }[] {
  const seen = new Map<string, { teamIndex: number; startedAt: number; taskId?: string }>();
  let e = exp;
  for (let t = T0 + 2000; t <= end; t += 2000) {
    e = advanceExpedition(e, t);
    for (const r of e.groundOps?.history ?? []) if (r.step === "fight") seen.set(`${r.teamIndex}:${r.startedAt}`, r);
  }
  const out: { fight: GroundFightRecord; task: ExpeditionActivity }[] = [];
  let at = exp;
  for (const r of [...seen.values()].sort((a, b) => a.startedAt - b.startedAt || a.teamIndex - b.teamIndex)) {
    at = advanceExpedition(at, r.startedAt);
    const fight = at.groundOps!.teams[r.teamIndex].pendingFight;
    expect(fight, `a fight at ${r.startedAt}`).toBeDefined();
    const task = at.bodies.flatMap((b) => b.activities).find((a) => a.id === r.taskId)!;
    out.push({ fight: fight!, task });
  }
  return out;
}

// The lead the rule puts on a fight point of an objective of grade `grade` (null = none).
const leadFor = (grade: number, point: number, points: number) => (point === points - 1 ? FINAL_FIGHT_LEAD : EARLIER_FIGHT_LEAD)[grade - 1];

// The placement rule on one stored fight: only an ordinary fight point lists ranks (the final point of a Challenging
// or harder objective, an earlier point of a Dangerous one), exactly one enemy at the lead.
function expectPlaced(fight: GroundFightRecord, task: ExpeditionActivity, trainingRun = false): void {
  const points = task.fightPoints?.length ?? 0;
  const lead = !trainingRun && !fight.surprise && !fight.reinforcement && task.difficulty ? leadFor(task.difficulty, fight.pointIndex, points) : null;
  if (lead) expect(Object.values(fight.ranks ?? {}), `${task.poiId} point ${fight.pointIndex}`).toEqual([lead]);
  else expect(fight.ranks, `${task.poiId} point ${fight.pointIndex}`).toBeUndefined();
}

// ===== the flag =====

describe("FKR-1 the flag: stamped at dispatch on new runs only", () => {
  it("startExpedition stamps Expedition.enemyRanks with the catalog version; withoutEnemyRanks takes exactly that key off", () => {
    const res = dispatchPastPropulsion(crewed(0x51ed), "ship-1", 1, expeditionCandidates(crewed(0x51ed), "ship-1")[0].id);
    const exp = res.expedition!;
    expect(exp.enemyRanks).toEqual({ version: ENEMY_RANKS_VERSION });
    expect(res.next.expeditions[0].enemyRanks).toEqual({ version: ENEMY_RANKS_VERSION });
    const off = withoutEnemyRanks(exp);
    expect("enemyRanks" in off).toBe(false);
    // Safe first runs SF-3: it also drops the ordinary run's curve stamp (a run from before FKR-1 had none).
    expect({ ...off, enemyRanks: exp.enemyRanks }).toEqual(withoutCurve(exp));
    expect(withoutEnemyRanks(off)).toBe(off);
  });

  it("an unranked run never ranks: the same fight with the flag absent equals FKR-0's capture shape (no ranks key)", () => {
    const exp = gradeRun("Low");
    const teams = fightTeamsOf(exp);
    for (const [k, t] of tasksOf(exp).entries()) {
      const f = pointFight(exp, teams, k, t.fightPoints!.length - 1);
      expect("ranks" in f.record).toBe(false);
    }
  });
});

// ===== the stamped twin of FKR-0 (2): final fights =====

describe("FKR-1 the stamped twin of FKR-0 (2): only the placed fights move", () => {
  for (const which of ["Low", "High"] as const) {
    it(`${which}: finals Challenging and Dangerous an Elite, Deadly a Boss; Dangerous earlier points Strong; every other fight unchanged`, () => {
      const plain = gradeRun(which);
      const twin = ranked(plain);
      const teams = fightTeamsOf(plain);
      let strong = 0;
      for (const [k, t] of tasksOf(plain).entries()) {
        const points = t.fightPoints!.length;
        for (let p = 0; p < points; p += 1) {
          const a = pointFight(plain, teams, k, p);
          const b = pointFight(twin, teams, k, p);
          expect(b.enemies).toEqual(a.enemies); // the fielded list before ranks is FKR-0's, untouched
          const lead = leadFor(t.difficulty!, p, points);
          if (lead === null) {
            expect(b, `${t.poiId} point ${p}`).toEqual(a);
          } else {
            expect(b.record.ranks, `${t.poiId} point ${p}`).toEqual({ [leadIdOf(a.enemies)]: lead });
            if (lead === "strong") strong += 1;
          }
        }
      }
      expect(strong).toBe(3); // the one Dangerous objective's three earlier points (Enemy Colony, Buried Vault: 4 points)
    });
  }

  it("a Deadly Enemy Fortification against a full rank 6 side: points 1 to 4 unchanged, the final one led by a Boss", () => {
    const plain = handRun(crewed(0xf0f7), ["enemyFortification"], { ...CALM, combat: 4 }, false);
    const twin = ranked(plain);
    const teams = fightTeamsOf(plain, [0, 1]);
    expect(tasksOf(plain)[0].difficulty).toBe(5);
    for (const p of [0, 1, 2, 3]) expect(pointFight(twin, teams, 0, p)).toEqual(pointFight(plain, teams, 0, p));
    const a = pointFight(plain, teams, 0, 4);
    const b = pointFight(twin, teams, 0, 4);
    expect(b.record.ranks).toEqual({ [leadIdOf(a.enemies)]: "boss" });
  });

  it("a surprise fight and a reinforcement fight on the final point stay Normal (user N5): the unranked record", () => {
    const plain = gradeRun("High", BOTH6);
    const twin = ranked(plain);
    const teams = fightTeamsOf(plain, [0, 1]);
    for (const [k, t] of tasksOf(plain).entries()) {
      const last = t.fightPoints!.length - 1;
      for (const kind of ["surprise", "reinforcement"] as const) expect(pointFight(twin, teams, k, last, kind), `${t.poiId} ${kind}`).toEqual(pointFight(plain, teams, k, last, kind));
    }
  });

  it("the ranked lead's numbers are the fight's: the battle fields the lead at its rank (the record's id is the strongest)", () => {
    const enemies = fieldedEnemies(gradeRun("High"), tasksOf(gradeRun("High"))[2], 7, 0);
    const lead = leadIdOf(enemies);
    const boss = withEnemyRanks(structuredClone(enemies), "boss").find((e) => e.id === lead)!;
    expect(boss.power).toBe(enemies.find((e) => e.id === lead)!.power * 2.5);
  });
});

// ===== the guard the wiring reads, and the Weak rank =====

describe("FKR-1 the guard a fight fields, and Weak placed by SF-3", () => {
  it("taskFightGuard is FKR-0's fielded list on an unranked run and its ranked twin on a ranked one", () => {
    const plain = gradeRun("Low");
    for (const [k, t] of tasksOf(plain).entries()) {
      const last = t.fightPoints!.length - 1;
      const task = { ...t, pointsCleared: last, fightCount: last };
      const seed = taskFightSeed(plain, k, last);
      const fielded = fieldedEnemies(plain, task, seed, 0);
      expect(taskFightGuard(plain, plain.bodies[0], task, seed)).toEqual(fielded);
      const lead = FINAL_FIGHT_LEAD[t.difficulty! - 1];
      const ranks = taskFightGuard(ranked(plain), plain.bodies[0], task, seed).filter((e) => e.rank !== "normal");
      expect(ranks.map((e) => [e.id, e.rank])).toEqual(lead ? [[leadIdOf(fielded), lead]] : []);
    }
  });

  it("every rank's wiring entries are live on HP and power (SF-3 brought Weak live: the difficulty curve's low end places it)", () => {
    for (const id of ["expedition:ENEMY_RANKS:weak", "expedition:ENEMY_RANKS:weak:hp"]) {
      const e = wiringEntry(id)!;
      expect(e.status.kind, id).toBe("live");
      expect(e.probe, id).toBe(id.endsWith(":hp") ? "content:enemyRank:weak:hp" : "content:enemyRank:weak:power");
    }
    for (const rank of ["normal", "strong", "elite", "boss"]) {
      for (const id of [`expedition:ENEMY_RANKS:${rank}`, `expedition:ENEMY_RANKS:${rank}:hp`]) expect(wiringEntry(id)!.status.kind, id).toBe("live");
    }
  });
});

// ===== the training run =====

describe("FKR-1 the training run fields no Elite or Boss", () => {
  it("SEAM, flipped at SF-2: a fresh save's first explorer run is stamped as the training run and reads as one", () => {
    const exp = dispatchPastPropulsion(withCrew(onHull("orion"), "d18"), "ship-1", 1, "cand-0").expedition!;
    expect(exp.shakedown).toBe(false); // SF-2 retired the 30 minute shakedown
    expect(exp.difficulty).toEqual({ version: 1, firstRun: true, ramp: 0, tier: 1 });
    expect(isTrainingRun(exp)).toBe(true);
  });

  // SF-2: a training run's guards are also scaled down (its own profile), so the twin it must equal is the UNRANKED
  // training run.
  it("a ranked run stamped as a training run fights every final exactly as an unranked one", () => {
    for (const which of ["Low", "High"] as const) {
      const plain = gradeRun(which);
      const twin = training(ranked(plain));
      expect(isTrainingRun(twin)).toBe(true);
      const teams = fightTeamsOf(plain);
      for (const [k, t] of tasksOf(plain).entries()) expect(pointFight(twin, teams, k, t.fightPoints!.length - 1), `${which} ${t.poiId}`).toEqual(pointFight(training(plain), teams, k, t.fightPoints!.length - 1));
    }
  });

  it("all three fresh-save candidates as training runs: the whole run equals the unranked run (no Elite or Boss anywhere)", { timeout: 300_000 }, () => {
    const END = 3_000_000;
    let ranksSeen = 0;
    for (const cand of ["cand-0", "cand-1", "cand-2"]) {
      const exp = dispatchPastPropulsion(withCrew(onHull("orion"), "rank1"), "ship-1", 1, cand).expedition!;
      expect(exp.enemyRanks).toEqual(RANKED);
      const asTraining = training(exp);
      const unranked = training(withoutEnemyRanks(exp));
      const a = advanceExpedition(asTraining, END);
      expect(withoutEnemyRanks(a), cand).toEqual(advanceExpedition(unranked, END));
      // Without the training stamp the same run DOES field ranks somewhere (the check above is not vacuous). SF-2: the
      // dispatch stamps it now, so the ordinary twin takes it off (notTraining).
      const ordinary = notTraining(exp);
      if (JSON.stringify(withoutEnemyRanks(advanceExpedition(ordinary, END))) !== JSON.stringify(withoutEnemyRanks(advanceExpedition(withoutEnemyRanks(ordinary), END)))) ranksSeen += 1;
    }
    expect(ranksSeen).toBeGreaterThan(0);
  });
});

// ===== the stamped twin of FKR-0 (3): the threat odds =====

function gradeOdds(exp: Expedition, side: Side, samples: number) {
  const teams = fightTeamsOf(exp, side.kind === "one" ? [0] : [0, 1]);
  return tasksOf(exp).map((task, k) => {
    const alert = alertLevelAt(task, T0);
    return {
      grade: task.difficulty!,
      wins: groundTaskClearOdds(exp, teams, exp.bodies[0], task, k, samples, undefined, alert, taskCover(task)).wins,
      key: groundThreatOddsKey(exp, teams, exp.bodies[0], task, k, samples, undefined, alert, taskCover(task)),
    };
  });
}

describe("FKR-1 the stamped twin of FKR-0 (3): the threat odds read the ranks, and the memo tells them apart", () => {
  it("Simple and Standard odds are unchanged; Challenging and harder never rise and drop somewhere; keys differ", () => {
    let dropped = 0;
    for (const which of ["Low", "High"] as const) {
      for (const side of [ONE3, BOTH6]) {
        const plain = gradeRun(which, side);
        const a = gradeOdds(plain, side, 32);
        const b = gradeOdds(ranked(plain), side, 32);
        const t = gradeOdds(training(ranked(plain)), side, 32);
        a.forEach((r, i) => {
          if (r.grade <= 2) expect(b[i].wins, `${which} grade ${r.grade}`).toBe(r.wins);
          else expect(b[i].wins, `${which} grade ${r.grade}`).toBeLessThanOrEqual(r.wins);
          if (b[i].wins < r.wins) dropped += 1;
          // SF-2: a training run reads Guaranteed (its backstop clears every fight point, groundThreat.ts).
          expect(t[i].wins, `${which} grade ${r.grade}: a training run reads Guaranteed`).toBe(32);
          // The memo key: a ranked read never shares an unranked one's key, nor a training run's.
          expect(b[i].key).not.toBe(r.key);
          expect(t[i].key).not.toBe(b[i].key);
          expect(b[i].key.startsWith(r.key.slice(0, -1))).toBe(true); // the ranks are appended, nothing else moves
        });
      }
    }
    expect(dropped).toBeGreaterThan(0);
  });
});

// ===== whole ranked runs =====

describe("FKR-1 whole ranked runs: every stored fight is placed by the rule", () => {
  it("a real ranked dispatch (two rank 6 teams): finals of Challenging and harder objectives hold their lead, everything else none", { timeout: 300_000 }, () => {
    let leads = 0;
    let fights = 0;
    for (const seed of [0x51ed, 0x2b0b5e7, 0x6ade5]) {
      // Safe first runs SF-3: a veteran's run (full strength: no Weak low end; that placement is safeFirstRamp.test.ts').
      const exp = dispatchPastPropulsion(asExpeditionVeteran(crewed(seed)), "ship-1", 1, "cand-0").expedition!;
      for (const { fight, task } of runFights(exp, T0 + 400_000)) {
        expectPlaced(fight, task);
        fights += 1;
        if (fight.ranks) leads += 1;
      }
    }
    expect(fights).toBeGreaterThan(0);
    expect(leads).toBeGreaterThan(0);
  });

  it("a stamped Deadly run (the hand-built fortification): the final fight meets its Boss; one call == 997 s chunks == 1 s steps", { timeout: 300_000 }, () => {
    const exp = handRun(crewed(0xf0f7), ["enemyFortification", "derelictOutpost"], { ...CALM, combat: 4 }, true);
    expect(tasksOf(exp)[0].difficulty).toBe(5);
    const fights = runFights(exp, T0 + 200_000);
    for (const { fight, task } of fights) expectPlaced(fight, task);
    expect(fights.some(({ fight }) => Object.values(fight.ranks ?? {}).includes("boss"))).toBe(true);
    const end = T0 + 200_000;
    const one = advanceExpedition(exp, end);
    let e = exp;
    for (let t = T0 + 997; t < end; t += 997) e = advanceExpedition(e, t);
    expect(advanceExpedition(e, end)).toEqual(one);
    // 1 s steps over the first three hours (every fight start and end in them), then one call to the end.
    const H = T0 + 3 * 3600;
    let s = exp;
    for (let t = T0 + 1; t <= H; t += 1) s = advanceExpedition(s, t);
    expect(s).toEqual(advanceExpedition(exp, H));
    expect(advanceExpedition(s, end)).toEqual(one);
  });
});
