// Ground Operations 0.14.0 (GO-6; design section 7, user 9b.4, Q5; plan docs/plans/2026-10-09-ground-operations-plan.md):
// the THREAT INDICATOR for one task, DISPLAY ONLY. "Can this team set clear the WHOLE task in one go?": a
// Monte Carlo over the task's REMAINING fights through the real task fight (groundFight.ts), mapped to the
// seven named tiers of combat/threatAssessment.ts (the patrol card's bands), so the player reads a named,
// colored band and never a bare percentage.
//
//   - ONE SAMPLE plays the remaining fights (pointsCleared .. n - 1) in order, the way the engine will (GO-7b):
//       * the squad is taskFightTeam's (the same squad a real fight fields: the teams' Security members minus
//         their downedThisTask, the run's crew layer and officer care);
//       * CARRY DAMAGE (user Q5): each fight starts from the previous fight's memberEnd, and the sample's FIRST
//         fight starts from the task's current carried state when one is passed in, so a team already hurt
//         mid-task reads its real odds;
//       * a member downed in an earlier fight of the SAME sample sits out its later fights (the in-task rule);
//       * a sample WINS only when every remaining fight wins, and stops at its first loss.
//     No remaining fights: every sample wins (Guaranteed). A TRAINING RUN (safe first runs SF-2) reads Guaranteed
//     too: its backstop clears every fight point, won or lost.
//   - The sample's fight j (j = the fight point's index) carries the fight number a real fight there would
//     have if every earlier remaining fight were won (fightCount + j - pointsCleared), so the squad's ids match.
//
// DETERMINISM: every sample fight rolls on the threat's OWN stream:
//   seed = (exp.seed ^ GROUND_THREAT_SALT ^ imul(flatIndex + 1, 0x9e3779b9) ^ imul(s + 1, 0x85ebca6b)
//           ^ imul(j + 1, 0x27d4eb2f)) >>> 0
// (s = the sample index, j = the fight point's index), so a threat read never draws on a real fight's stream
// and can never shift one. Keyed by the POINT index (not the attempt), so a retry reads the same guards as
// long as nothing about the squad changed. Pure: reads only its arguments, mints fresh combatants per fight,
// never mutates an input.
//
// COST + MEMO (measured at GO-6): one sample fight is a full resolveGroundBattle. A decisive 5-fight task reads
// in about 2 ms (32 samples); a grinding one (a tanky squad with no damage, fights running long) about 15 ms,
// so a 20-task planet read per team could cost a few hundred ms on every recompute of a queue screen. The read
// is therefore MEMOIZED on a fingerprint of EVERY input it depends on (the exp fields a fight reads, listed by
// type in groundFight.ts TaskFightExp, the team fields, the body hazard and risk, the task fields, the flat index, the
// sample count, the carried state, and the objective affixes' alert level (AF-1) and cover (AF-2)). Because the key is the whole input, a hit returns exactly what a fresh
// computation would (the read is pure), whichever save or run asked: the memo can never leak a stale answer
// across saves, runs or edits. Bounded (GROUND_THREAT_MEMO_SIZE entries, least recently used evicted) and
// returns a fresh object each call.
//
// USES: display (GO-13 task queue odds, GO-14 task cards) plus the two the user approved: the default plan and
// the helper floor (GO-7c, HELPER_MIN_TIER).
//
// Module graph: model (types), groundFight, groundTasks, riskFactors, combat/threatAssessment; never expedition.ts.

import type { Expedition, ExpeditionActivity, ExpeditionBody } from "./model";
import {
  resolveTaskFightOnSeed,
  type GroundFightRecord,
  type GroundFightTeam,
  type GroundMemberCarry,
  type TaskFightExp,
} from "./groundFight";
import { fightPointCount, riskFightPointCount } from "./groundTasks";
import { bodyFloraGrade } from "./riskFactors";
import { threatAssessment, type ThreatAssessment, type ThreatTier } from "./combat/threatAssessment";
import { hasCover, type GroundCover } from "./affixes";
import { isTrainingRun, ranksLive } from "./enemyRanks";

// ===== Constants =====

// The threat samples' stream salt: odd, distinct from every engine salt (salts.test.ts checks it).
export const GROUND_THREAT_SALT = 0x6e5b3c27;
// Samples per read. TUNABLE (cost vs precision); ship combat's forecast uses DEFAULT_SAMPLES 64.
export const GROUND_THREAT_SAMPLES = 32;
// The lowest tier a helper team takes on a borrowed task: "Favorable" (user 9b.4) mapped onto the 7 tiers as
// Likely Victory [PROVISIONAL mapping, Q2: Likely (80%+) or A Worthy Adversary (60%+)]. GO-7c reads it with
// tierAtLeast.
export const HELPER_MIN_TIER: ThreatTier = "likely";
// The memo's bound (see the module header): a few planets' worth of tasks times teams.
export const GROUND_THREAT_MEMO_SIZE = 256;

// ===== Types =====

// What a threat read needs from the run: the fields a task fight reads, plus the run seed for the sample keys.
export type ThreatExp = TaskFightExp & Pick<Expedition, "seed">;
// Field Kits FKR-1: `difficulty` places a ranked run's ranks (the final fight's lead; enemyRanks.ts).
type ThreatTask = Pick<ExpeditionActivity, "id" | "poiId" | "fightCount" | "pointsCleared" | "fightPoints" | "difficulty">;

export interface GroundThreatSample {
  win: boolean;
  fights: GroundFightRecord[]; // the fights the sample played, in order (stops at the first loss)
}

// ===== Pure helpers =====

// One sample fight's seed (see the module header). Pure.
export function groundThreatSampleSeed(exp: Pick<Expedition, "seed">, flatIndex: number, sample: number, pointIndex: number): number {
  return (
    (exp.seed ^
      GROUND_THREAT_SALT ^
      Math.imul(flatIndex + 1, 0x9e3779b9) ^
      Math.imul(sample + 1, 0x85ebca6b) ^
      Math.imul(pointIndex + 1, 0x27d4eb2f)) >>>
    0
  );
}

// The task's total fight count: its stamped fight points, or (a task not yet stamped) the count the stamping will
// give it: on a body with risk grades the risk-aware count (groundTasks.ts riskFightPointCount, Squads SQ-4), else
// the site's count off the body's RAW hazard (groundTasks.ts fightPointCount, the count GO-7 stamps). Pure.
function taskFightTotal(task: Pick<ExpeditionActivity, "poiId" | "fightPoints">, body: Pick<ExpeditionBody, "hazard" | "risk">): number {
  if (task.fightPoints) return task.fightPoints.length;
  return body.risk ? riskFightPointCount(task.poiId, body.hazard, body.risk) : fightPointCount(task.poiId, body.hazard);
}

// The fights the task still has to win: its fight count minus the points already cleared, never below 0. Pure.
export function remainingTaskFights(
  task: Pick<ExpeditionActivity, "poiId" | "fightPoints" | "pointsCleared">,
  body: Pick<ExpeditionBody, "hazard" | "risk">,
): number {
  return Math.max(0, taskFightTotal(task, body) - Math.max(0, task.pointsCleared ?? 0));
}

// A whole sample count of at least 1 (NaN and below 1 read 1). Pure.
function sampleCount(samples: number): number {
  return Number.isFinite(samples) && samples >= 1 ? Math.floor(samples) : 1;
}

// ===== One sample =====

// Play ONE sample of the task's remaining fights (see the module header) and return every fight it played.
// Exported for the tests and for a future "how it would go" readout; groundTaskClearOdds counts these. Pure.
export function groundThreatSampleFights(
  exp: ThreatExp,
  teams: readonly GroundFightTeam[],
  body: Pick<ExpeditionBody, "hazard" | "risk">,
  task: ThreatTask,
  flatIndex: number,
  sample: number,
  carried?: Readonly<Record<string, GroundMemberCarry>>,
  alertLevel = 0,
  cover?: GroundCover,
): GroundThreatSample {
  const cleared = Math.max(0, task.pointsCleared ?? 0);
  const total = taskFightTotal(task, body);
  const fightCount = task.fightCount ?? 0;
  const fights: GroundFightRecord[] = [];
  let carry = carried;
  // Members downed earlier in THIS sample (the sit-out list grows as the sample goes).
  const downed: string[] = [];
  let sampleTeams: readonly GroundFightTeam[] = teams;
  for (let j = cleared; j < total; j += 1) {
    const record = resolveTaskFightOnSeed(
      exp,
      sampleTeams,
      body,
      // Field Kits FKR-1: the grade and the fight points ride along so a ranked run's final fight meets its lead (a
      // task not yet stamped has no grade either, so it ranks nothing).
      { id: task.id, poiId: task.poiId, pointsCleared: j, fightCount: fightCount + (j - cleared), difficulty: task.difficulty, fightPoints: task.fightPoints },
      groundThreatSampleSeed(exp, flatIndex, sample, j),
      carry,
      undefined,
      alertLevel,
      cover,
    );
    fights.push(record);
    if (record.outcome !== "win") return { win: false, fights };
    carry = record.memberEnd;
    if (record.downedMemberIds.length > 0) {
      downed.push(...record.downedMemberIds);
      sampleTeams = teams.map((t) => ({ ...t, downedThisTask: [...(t.downedThisTask ?? []), ...downed] }));
    }
  }
  return { win: true, fights };
}

// ===== The read =====

// The memo key's field lists. `satisfies Record<keyof T, true>` makes a field added to TaskFightExp,
// GroundFightTeam or ThreatTask a compile error here until it is listed, so the key can never miss an input.
// Field Kits FKR-1: the enemy ranks flag and the training run stamp (`difficulty`; and with them the task's grade) are
// keyed apart, appended only on a ranked run (an unranked fight reads neither), so every unranked key reads exactly
// as before.
const EXP_KEY_FIELDS = {
  seed: true,
  id: true,
  roster: true,
  securityStrength: true,
  squadTriage: true,
  squadFearResist: true,
  hazardResist: true,
  teamKit: true,
} as const satisfies Record<Exclude<keyof ThreatExp, "enemyRanks" | "difficulty">, true>;
const TEAM_KEY_FIELDS = { securityIds: true, downedThisTask: true, securityShare: true } as const satisfies Record<
  keyof GroundFightTeam,
  true
>;
const TASK_KEY_FIELDS = { id: true, poiId: true, fightCount: true, pointsCleared: true, fightPoints: true } as const satisfies Record<
  Exclude<keyof ThreatTask, "difficulty">,
  true
>;

function pick(o: object, fields: object): unknown[] {
  return Object.keys(fields).map((k) => (o as Record<string, unknown>)[k]);
}

// JSON drops undefined and writes NaN / Infinity as null; spell them out so two different inputs never share
// a key (a shared key would only ever be a cache miss's opposite: a wrong hit). TYPED encoding (GO-6 review):
// every string VALUE is tagged "s:", undefined is "u", a non-finite number is "n:NaN" / "n:Infinity" /
// "n:-Infinity", so a real string ("#u", "u", "n:NaN") can never read as a sentinel. Object keys (member ids
// in `carried`) are never passed through a replacer; they stay as written and are unambiguous as keys.
function keyReplacer(_k: string, v: unknown): unknown {
  if (typeof v === "string") return `s:${v}`;
  if (v === undefined) return "u";
  if (typeof v === "number" && !Number.isFinite(v)) return `n:${v}`;
  return v;
}

// The memo key: every input the read depends on (see the module header). Exported for the tests. Pure.
export function groundThreatOddsKey(
  exp: ThreatExp,
  teams: readonly GroundFightTeam[],
  body: Pick<ExpeditionBody, "hazard" | "risk">,
  task: ThreatTask,
  flatIndex: number,
  samples: number,
  carried?: Readonly<Record<string, GroundMemberCarry>>,
  alertLevel = 0,
  cover?: GroundCover,
): string {
  // Objective affixes (AF-1): an alerted objective's escalation shapes the read; appended only when present, so
  // every key without one reads exactly as before. AF-2: so does the objective's cover (Rocky Outcroppings), tagged
  // so it never reads as an alert level, appended only when either side has some.
  const escalation = alertLevel > 0 ? [alertLevel] : [];
  const covered = hasCover(cover) ? [["cover", cover.team, cover.enemy]] : [];
  // Field Kits FKR-1: a ranked run's ranks shape the read (the catalog version, the objective's grade, the training
  // run stamp), tagged and appended only on a ranked run.
  const ranked = ranksLive(exp) ? [["ranks", exp.enemyRanks?.version, task.difficulty, isTrainingRun(exp)]] : [];
  return JSON.stringify(
    // Squads SQ-4: the body's risk shapes the read, so it is part of the key: its flora the fights (groundFight.ts
    // withFloraToxins), its combat and fauna an unstamped task's fight count (taskFightTotal). Absent risk: "u".
    [
      pick(exp, EXP_KEY_FIELDS),
      teams.map((t) => pick(t, TEAM_KEY_FIELDS)),
      body.hazard,
      bodyFloraGrade(body),
      body.risk ? [body.risk.combat, body.risk.fauna] : undefined,
      pick(task, TASK_KEY_FIELDS),
      flatIndex,
      samples,
      carried,
      ...escalation,
      ...covered,
      ...ranked,
    ],
    keyReplacer,
  );
}

const oddsMemo = new Map<string, number>(); // key -> wins (samples is part of the key)

// How many of `samples` simulated runs of the task's remaining fights clear it in one go, with no memo. Pure.
function computeClearOdds(
  exp: ThreatExp,
  teams: readonly GroundFightTeam[],
  body: Pick<ExpeditionBody, "hazard" | "risk">,
  task: ThreatTask,
  flatIndex: number,
  n: number,
  carried?: Readonly<Record<string, GroundMemberCarry>>,
  alertLevel = 0,
  cover?: GroundCover,
): number {
  if (remainingTaskFights(task, body) === 0) return n;
  let wins = 0;
  for (let s = 0; s < n; s += 1) if (groundThreatSampleFights(exp, teams, body, task, flatIndex, s, carried, alertLevel, cover).win) wins += 1;
  return wins;
}

// How many of `samples` simulated runs of the task's remaining fights clear it in one go. `carried` = the
// task's current carried state (the last fight's memberEnd in this task; absent = everyone at full HP).
// `alertLevel` = the objective's alert at the read (objective affixes, AF-1; 0 = none). `cover` = the objective's
// cover against long-range attacks (AF-2, Rocky Outcroppings: affixes.ts longRangeCover; absent = none).
// Memoized on its whole input (see the module header); the result is a fresh object. Pure in effect.
export function groundTaskClearOdds(
  exp: ThreatExp,
  teams: readonly GroundFightTeam[],
  body: Pick<ExpeditionBody, "hazard" | "risk">,
  task: ThreatTask,
  flatIndex: number,
  samples: number = GROUND_THREAT_SAMPLES,
  carried?: Readonly<Record<string, GroundMemberCarry>>,
  alertLevel = 0,
  cover?: GroundCover,
): { wins: number; samples: number } {
  const n = sampleCount(samples);
  // Safe first runs SF-2: a TRAINING RUN clears every objective by construction (groundOps.ts trainingFellBack: a lost
  // fight still clears its point), so every sample wins (Guaranteed), with no sample fought and no memo entry.
  if (isTrainingRun(exp)) return { wins: n, samples: n };
  const key = groundThreatOddsKey(exp, teams, body, task, flatIndex, n, carried, alertLevel, cover);
  let wins = oddsMemo.get(key);
  if (wins !== undefined) {
    oddsMemo.delete(key); // refresh its place (least recently used goes first)
  } else {
    wins = computeClearOdds(exp, teams, body, task, flatIndex, n, carried, alertLevel, cover);
    if (oddsMemo.size >= GROUND_THREAT_MEMO_SIZE) {
      const oldest = oddsMemo.keys().next().value;
      if (oldest !== undefined) oddsMemo.delete(oldest);
    }
  }
  oddsMemo.set(key, wins);
  return { wins, samples: n };
}

// The memo's current size, for the tests (the bound). Pure read.
export function groundThreatMemoSize(): number {
  return oddsMemo.size;
}

// The task's threat as one of the 7 named tiers (threatAssessment of groundTaskClearOdds). Pure.
export function groundTaskThreat(
  exp: ThreatExp,
  teams: readonly GroundFightTeam[],
  body: Pick<ExpeditionBody, "hazard" | "risk">,
  task: ThreatTask,
  flatIndex: number,
  samples: number = GROUND_THREAT_SAMPLES,
  carried?: Readonly<Record<string, GroundMemberCarry>>,
  alertLevel = 0,
  cover?: GroundCover,
): ThreatAssessment {
  const odds = groundTaskClearOdds(exp, teams, body, task, flatIndex, samples, carried, alertLevel, cover);
  return threatAssessment(odds.wins, odds.samples);
}
