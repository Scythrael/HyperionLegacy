// Objective affixes (AF-1, docs/plans/2026-10-14-objective-affixes-capture.md) on the engine: a risk-aware run
// dispatched before AF-1 (no affix flag) resolves exactly as before (goldens captured BEFORE the change); an
// affix-aware run stamps its objectives' affixes, REINFORCING brings extra battles per landing, raises the alert on
// every lost fight (more enemies, Heightened Senses), HOLDS an objective its alert made Impossible until the reset
// (the team moves on), and the whole thing is chunk-invariant (one call == 997 s == 1 s). Plus the LARGER JOINT
// CREWS (groundTaskCrewOptions).

import { describe, expect, it } from "vitest";
// SF-1: the claimed state hashes without the run counters (a claim writes them), absent before SF-1.
import { withoutRunCounts, goldenJson } from "./firstRunsGoldens.fixture";
import {
  freshState,
  type AwayMember,
  type BodyRiskGrades,
  type Expedition,
  type ExpeditionActivity,
  type ExpeditionBody,
  type GameState,
  type GroundStepRecord,
  type RegionTier,
  type ShipGroundTeam,
} from "./model";
import { advanceExpedition, claimExpedition } from "./expedition";
import { generateRiskProfile, type ExpeditionRegion } from "./riskFactors";
import {
  DEPLOY_SECONDS,
  applyGroundOpsEdit,
  findGroundTask,
  groundOpsAssignIdle,
  groundOpsBodyScanned,
  groundOpsLogText,
  groundTaskCrewOptions,
  groundTaskCrews,
  initGroundTasks,
} from "./groundOps";
import {
  alertLevelAt,
  alertResetsAt,
  escalationAt,
  objectiveHeld,
  objectiveHeldUntil,
  rollObjectiveAffixes,
  rollReinforcements,
  type ObjectiveAffix,
} from "./affixes";
import { resolveTaskFight, withEscalation } from "./groundFight";
import { generateEncounter } from "./gambit";
import { groundThreatOddsKey } from "./groundThreat";
import { asPreCurveDispatch, asPreG2NamesDispatch, plainAwayMember, withoutAffixes, withoutEnemyRanks, dispatchPastPropulsion } from "./awayTeamTestFixtures";
import { deserialize, migrate, serialize, type SaveFile } from "./save";
// WR-8 (0.14.0): every pin in this file was taken before the combat rules (combatRulesSwitch.fixture.ts), so the file
// runs with them switched off and its pins keep proving WR-8 moved nothing else here (the rules stamp new patrol
// cycles and runs; combatDescriptorGoldens.test.ts pins the combat rules themselves).
import { combatRulesOffForThisFile } from "./combatRulesSwitch.fixture";
combatRulesOffForThisFile();

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

const T0 = 100_000;
const SEC = ["member-1", "member-2", "member-3", "member-4", "member-5", "member-6"];
const SCI = ["member-11", "member-12", "member-13", "member-14", "member-15", "member-16"];

// ship-1: Ground + Ground (or Strike + Survey) fully slotted at `rank`.
function crewed(expeditionSeed: number, kinds: "gg" | "ss" = "gg", rank = 6): GameState {
  const base = freshState();
  const m = (id: string, t: AwayMember["teamType"]): AwayMember => ({ ...plainAwayMember(id, t, "ship-1"), rank: rank as AwayMember["rank"] });
  const teams: ShipGroundTeam[] =
    kinds === "gg"
      ? [
          { kind: "ground", security: SEC.slice(0, 3), science: SCI.slice(0, 3), helpOthers: false },
          { kind: "ground", security: SEC.slice(3), science: SCI.slice(3), helpOthers: false },
        ]
      : [
          { kind: "strike", security: SEC.slice(), science: [], helpOthers: false },
          { kind: "survey", security: [], science: SCI.slice(), helpOthers: false },
        ];
  return {
    ...base,
    gameTimeSeconds: T0,
    expeditionSeed,
    awayMembers: [...SEC.map((id) => m(id, "security")), ...SCI.map((id) => m(id, "science"))],
    nextAwayMemberId: 100,
    ships: base.ships.map((sh) => ({ ...sh, groundTeams: teams })),
  };
}

// Dispatch candidate 0, optionally on a forced region (the risk replaced before any body scans).
function dispatch(state: GameState, region?: ExpeditionRegion): { next: GameState; exp: Expedition } {
  const res = asPreCurveDispatch(asPreG2NamesDispatch(dispatchPastPropulsion(state, "ship-1", 1, "cand-0")));
  expect(res.success, String(res.reason)).toBe(true);
  // Field Kits FKR-1: the run as dispatched before enemy ranks, so the seeds picked here keep their scenarios.
  let exp = withoutEnemyRanks(res.expedition!);
  if (region) {
    const forced = generateRiskProfile(exp.seed, region, exp.bodies);
    exp = { ...exp, risk: forced.profile, bodies: exp.bodies.map((b, i) => ({ ...b, risk: forced.bodies[i] })) };
  }
  return { next: res.next, exp };
}

// ===== the gate: a risk-aware run dispatched before AF-1 resolves exactly as before =====

describe("AF-1 the gate: a run without the affix flag resolves byte-identically (goldens captured before AF-1)", () => {
  const CASES: Record<string, () => { state: GameState; region?: ExpeditionRegion }> = {
    tierOne: () => ({ state: crewed(0x0a13bd4) }),
    tierThree: () => ({ state: crewed(0x1259124), region: { tier: 3, enemyTerritory: false } }),
    tierFourEnemy: () => ({ state: crewed(0x0a13bd4), region: { tier: 4, enemyTerritory: true } }),
    strikeSurveyTierFour: () => ({ state: crewed(0x3c0ffee, "ss"), region: { tier: 4, enemyTerritory: true } }),
    tierSixWeak: () => ({ state: crewed(0x2b0b5e7, "gg", 3), region: { tier: 6, enemyTerritory: true } }),
  };
  // Captured from the code BEFORE AF-1 (commit 5fcc295): five checkpoints, the phase at 2,000,000 s, the claim
  // (when the run completes).
  const GOLDEN: Record<string, string[]> = {
    tierOne: ["544053ed", "f772abab", "4c853d53", "ddb6273c", "247423db", "activities", "unclaimed"],
    tierThree: ["7b3ef0b7", "7a377d69", "7a377d69", "7a377d69", "7a377d69", "complete", "6fea8ae1"],
    tierFourEnemy: ["5b204c68", "8ea32568", "b3a4fc92", "b3a4fc92", "b3a4fc92", "complete", "2da25f"],
    strikeSurveyTierFour: ["a4f963ee", "eddc089", "eddc089", "eddc089", "eddc089", "complete", "7acaa969"],
    tierSixWeak: ["9a6a5c6", "dc6efd05", "cf4230f1", "cf4230f1", "cf4230f1", "complete", "38ffe7d6"],
  };
  for (const [name, build] of Object.entries(CASES)) {
    it(`${name}: checkpoints and the claim match the pre-AF-1 capture`, { timeout: 120_000 }, () => {
      const { state, region } = build();
      const d = dispatch(state, region);
      const exp = withoutAffixes(d.exp);
      const hashes = [T0 + 5000, T0 + 20000, T0 + 60000, T0 + 150000, T0 + 400000].map((t) => fnv(goldenJson(advanceExpedition(exp, t))));
      const done = advanceExpedition(exp, T0 + 2_000_000);
      hashes.push(done.phase);
      const claimed = done.phase === "complete" ? claimExpedition({ ...d.next, expeditions: [done] }, done.id) : null;
      hashes.push(claimed ? fnv(goldenJson(withoutRunCounts(claimed.next))) : "unclaimed");
      expect(hashes).toEqual(GOLDEN[name]);
    });
  }
});

// ===== hand-built affix-aware runs =====

const R = (rank: number): ObjectiveAffix => ({ id: "reinforcing", rank, alignment: "negative" });
const CALM: BodyRiskGrades = { combat: 0, fauna: 0, flora: 0, hazard: 0 };

// One Ground team slotted (3 / 3) at `rank` and an empty pair: one team deploys.
function oneTeam(rank = 1): GameState {
  const base = freshState();
  const m = (id: string, t: AwayMember["teamType"]): AwayMember => ({ ...plainAwayMember(id, t, "ship-1"), rank: rank as AwayMember["rank"] });
  const teams: ShipGroundTeam[] = [
    { kind: "ground", security: SEC.slice(0, 3), science: SCI.slice(0, 3), helpOthers: false },
    { kind: "ground", security: [null, null, null], science: [null, null, null], helpOthers: false },
  ];
  return {
    ...base,
    gameTimeSeconds: T0 - 50_000,
    awayMembers: [...SEC.slice(0, 3).map((id) => m(id, "security")), ...SCI.slice(0, 3).map((id) => m(id, "science"))],
    nextAwayMemberId: 100,
    ships: base.ships.map((sh) => ({ ...sh, groundTeams: teams })),
  };
}

interface Setup {
  state?: GameState;
  pois: string[];
  risk: BodyRiskGrades;
  hazard?: number;
  tier?: RegionTier;
  seed?: number;
  securityStrength?: number;
  flag?: boolean; // the affix flag (difficultyTier on the profile); default on
  after?: (e: Expedition) => void; // edit the stamped tasks before the plan
  afterPlan?: (e: Expedition) => void; // edit the queues before the teams pick
}

// A dispatched run turned into an affix-aware run whose window opened at T0 with body 0 (carrying `risk`) just
// scanned: its tasks stamped through the real path, then planned, then the teams pick.
function affixRun(setup: Setup): Expedition {
  const res = asPreCurveDispatch(asPreG2NamesDispatch(dispatchPastPropulsion(setup.state ?? oneTeam(), "ship-1", 1, "cand-0")));
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  const d = res.expedition;
  const body: ExpeditionBody = {
    id: "body-1",
    planetType: "terrestrial",
    scanTotal: 100,
    scanProgress: 100,
    hazard: setup.hazard ?? 0.1,
    scanned: true,
    discoveries: setup.pois.map((poiId, k) => ({ id: `${d.id}-body-1-disc-${k}`, kind: "landmark", poiId })),
    activities: setup.pois.map((poiId, k) => ({ id: `${d.id}-body-1-act-${k}`, bodyId: "body-1", poiId, done: false })),
    risk: { ...setup.risk },
  };
  const exp: Expedition = structuredClone({
    ...d,
    seed: setup.seed ?? d.seed,
    ...(setup.securityStrength !== undefined ? { securityStrength: setup.securityStrength } : {}),
    phase: "activities",
    phaseAnchorSeconds: T0,
    bodies: [body],
    scanStepCursor: Math.max(0, (d.encounterSteps ?? 1) - 1),
    groundOps: { ...d.groundOps!, startedAt: T0 },
    risk: {
      version: 1,
      tier: setup.tier ?? 1,
      enemyTerritory: false,
      system: { combat: setup.risk.combat, fauna: setup.risk.fauna, flora: setup.risk.flora },
      ...(setup.flag === false ? {} : { difficultyTier: 1 }),
    },
  });
  initGroundTasks(exp, 0);
  setup.after?.(exp);
  for (const team of exp.groundOps!.teams) team.stepStartedAt = T0;
  groundOpsBodyScanned(exp, 0, T0);
  setup.afterPlan?.(exp);
  groundOpsAssignIdle(exp, T0);
  return exp;
}

const tasksOf = (e: Expedition): ExpeditionActivity[] => e.bodies[0].activities;
const historyOf = (e: Expedition, i: number): GroundStepRecord[] => e.groundOps!.history.filter((r) => r.teamIndex === i);
const force = (task: ExpeditionActivity, affixes: ObjectiveAffix[], score: number): void => {
  task.affixes = affixes;
  task.difficultyScore = score;
};

// A seed whose visit number 0 on flat index `flat` brings at least `min` extra battles for `affixes`.
function seedWithBattles(flat: number, affixes: ObjectiveAffix[], min: number): number {
  for (let s = 1; s < 100_000; s += 1) if (rollReinforcements(s, flat, 0, affixes).length >= min) return s;
  throw new Error("no seed");
}

// Advance in `step` second chunks from `from` to `to` (inclusive of `to`).
function chunked(exp: Expedition, from: number, to: number, step: number): Expedition {
  let e = exp;
  for (let t = from + step; t < to; t += step) e = advanceExpedition(e, t);
  return advanceExpedition(e, to);
}

// ===== stamping =====

describe("AF-1 stamping: an affix-aware run stamps its objectives' affixes and difficulty scores", () => {
  it("a real dispatch at Tier IV in enemy territory: every Deadly combat objective carries Reinforcing, each as rolled", { timeout: 120_000 }, () => {
    const d = dispatch(crewed(0x0a13bd4), { tier: 4, enemyTerritory: true });
    expect(d.exp.risk!.difficultyTier).toBe(1);
    const done = advanceExpedition(d.exp, T0 + 400_000);
    let deadly = 0;
    done.bodies.forEach((body, b) => {
      body.activities.forEach((task, k) => {
        if (task.difficulty === undefined) return;
        expect(typeof task.difficultyScore).toBe("number");
        const combat = (task.fightPoints?.length ?? 0) > 0;
        const want = rollObjectiveAffixes({ seed: done.seed, bodyIndex: b, taskIndex: k, tier: 4, difficulty: task.difficulty, difficultyTier: 1, combat });
        expect(task.affixes ?? []).toEqual(want);
        if (task.difficulty === 5 && combat) {
          deadly += 1;
          expect(task.affixes!.map((a) => a.id)).toContain("reinforcing");
        }
      });
    });
    expect(deadly).toBeGreaterThan(0);
    // Its pre-AF-1 twin stamps none.
    const old = advanceExpedition(withoutAffixes(d.exp), T0 + 400_000);
    for (const task of old.bodies.flatMap((b) => b.activities)) {
      expect(task.affixes).toBeUndefined();
      expect(task.difficultyScore).toBeUndefined();
      expect(task.visits).toBeUndefined();
    }
  });

  it("without the flag a Deadly objective stamps no affix (the gate)", () => {
    const deadly = { combat: 4, fauna: 0, flora: 0, hazard: 4 } as BodyRiskGrades;
    const on = affixRun({ pois: ["derelictOutpost"], risk: deadly, hazard: 0.9, tier: 4 });
    const off = affixRun({ pois: ["derelictOutpost"], risk: deadly, hazard: 0.9, tier: 4, flag: false });
    expect(tasksOf(on)[0].difficulty).toBe(5);
    expect(tasksOf(on)[0].affixes?.[0].id).toBe("reinforcing");
    expect(tasksOf(off)[0].difficulty).toBe(5);
    expect(tasksOf(off)[0].affixes).toBeUndefined();
    expect(tasksOf(off)[0].difficultyScore).toBeUndefined();
  });
});

// ===== the extra battles =====

describe("AF-1 Reinforcing: extra battles strike MID-WORK (user), at points rolled along the progress bar", () => {
  it("each strike cuts the work where it lands, the crew fights there (no fight point), then works on from that spot", { timeout: 60_000 }, () => {
    const seed = seedWithBattles(0, [R(10)], 2);
    const strikes = rollReinforcements(seed, 0, 0, [R(10)]);
    const exp = affixRun({ pois: ["crashedShip"], risk: { ...CALM, combat: 2 }, seed, securityStrength: 400, state: oneTeam(6), after: (e) => force(tasksOf(e)[0], [R(10)], 6) });
    const task0 = tasksOf(exp)[0];
    const points = task0.fightPoints!;
    // Landed at progress 0: the strikes are stored on the lead as progress points, nothing fought yet.
    const landed = advanceExpedition(exp, T0 + DEPLOY_SECONDS);
    expect(tasksOf(landed)[0].visits).toBe(1);
    const team = landed.groundOps!.teams[0];
    expect(team.step).toBe("work");
    expect(team.reinforcementsAt === undefined ? 0 : team.reinforcementsAt.length).toBeLessThan(strikes.length);
    expect(landed.groundOps!.history.some((r) => r.step === "fight")).toBe(false);
    const done = advanceExpedition(exp, T0 + 40_000);
    const fights = historyOf(done, 0).filter((r) => r.step === "fight");
    const reinf = fights.filter((r) => r.reinforcement);
    expect(reinf.length).toBe(strikes.length);
    expect(reinf.every((r) => r.outcome === "win")).toBe(true);
    // Each reinforcement fight follows a work step that ended mid-segment, at (about) its strike point.
    for (let k = 0; k < reinf.length; k += 1) {
      const before = historyOf(done, 0).filter((r) => r.endedAt === reinf[k].startedAt && r.step === "work");
      expect(before.length).toBe(1);
      expect(reinf[k].startedAt).toBeGreaterThan(T0 + DEPLOY_SECONDS);
    }
    const t = tasksOf(done)[0];
    expect(t.status).toBe("done");
    // Reinforcements cleared no point: every point fight is a plain fight, one per point.
    expect(fights.filter((r) => !r.reinforcement && r.outcome === "win").length).toBe(points.length);
    expect(t.pointsCleared).toBe(points.length);
    expect(t.fightCount).toBe(points.length + strikes.length);
    expect(done.groundOps!.teams[0].reinforcementsAt).toBeUndefined();
    expect(done.groundOps!.teams[0].reinforcing).toBeUndefined();
  });

  it("a strike lands where the roll put it: the first one's work step stops at its progress point", { timeout: 60_000 }, () => {
    const seed = seedWithBattles(0, [R(1)], 1);
    const [f] = rollReinforcements(seed, 0, 0, [R(1)]);
    const exp = affixRun({ pois: ["crashedShip"], risk: { ...CALM, combat: 2 }, seed, securityStrength: 400, state: oneTeam(6), after: (e) => force(tasksOf(e)[0], [R(1)], 6) });
    const points = tasksOf(exp)[0].fightPoints!;
    let e = advanceExpedition(exp, T0 + DEPLOY_SECONDS);
    // Walk to the reinforcement fight.
    for (let t = T0 + DEPLOY_SECONDS + 5; t < T0 + 40_000; t += 5) {
      e = advanceExpedition(e, t);
      const tm = e.groundOps!.teams[0];
      if (tm.step === "fight" && tm.pendingFight?.reinforcement) break;
    }
    const progress = tasksOf(e)[0].progress!;
    // The strike point f of the whole bar (landed at 0), up to the whole-second rounding of the cut work step.
    const seg = points.find((p) => p > f) ?? 1;
    const prev = [0, ...points].filter((p) => p < f).pop()!;
    expect(Math.abs(progress - f)).toBeLessThan((seg - prev) / 2);
    expect(progress).toBeGreaterThan(prev);
    expect(progress).toBeLessThan(seg);
    expect(tasksOf(e)[0].segmentsBanked).toBe(points.filter((p) => p <= prev).length);
  });

  it("a task without the hook never rolls (no visit counted)", () => {
    const exp = affixRun({ pois: ["crashedShip"], risk: { ...CALM, combat: 2 }, securityStrength: 400, state: oneTeam(6) });
    expect(tasksOf(exp)[0].affixes).toBeUndefined();
    const later = advanceExpedition(exp, T0 + 20_000);
    expect(tasksOf(later)[0].visits).toBeUndefined();
    expect(later.groundOps!.history.some((r) => r.reinforcement)).toBe(false);
  });
});

// ===== the alert and its escalation =====

describe("AF-1 Reinforcing: every lost fight raises the alert; the next fights are escalated", () => {
  it("withEscalation: one more enemy per level (copies in order, own ids) and Heightened Senses on every enemy's damage", () => {
    const base = generateEncounter(77, 0.3, "derelictOutpost");
    expect(withEscalation(structuredClone(base), 0)).toEqual(base);
    const up = withEscalation(structuredClone(base), 2);
    expect(up.length).toBe(base.length + 2);
    expect(new Set(up.map((e) => e.id)).size).toBe(up.length);
    const mult = escalationAt(2).damageMult;
    up.forEach((e, i) => {
      const src = base[i < base.length ? i : (i - base.length) % base.length];
      expect(e.role).toBe(src.role);
      expect(e.power).toBeCloseTo(src.power * mult, 9);
      expect(e.threat).toBe(e.power);
      expect(e.hp).toBe(src.hp);
    });
  });

  it("a loss raises the alert at the fight's end; the retry's fight is resolved at that alert", { timeout: 60_000 }, () => {
    const exp = affixRun({ pois: ["derelictOutpost"], risk: { ...CALM, combat: 4 }, securityStrength: 0, after: (e) => force(tasksOf(e)[0], [R(10)], 6) });
    let e = exp;
    let lossAt: number | null = null;
    let checked = false;
    for (let t = T0 + 10; t < T0 + 60_000 && !checked; t += 10) {
      const prevCount = tasksOf(e)[0].fightCount ?? 0;
      e = advanceExpedition(e, t);
      const task = tasksOf(e)[0];
      const loss = historyOf(e, 0).find((r) => r.step === "fight" && r.outcome === "loss");
      if (loss && lossAt === null) {
        lossAt = loss.endedAt;
        expect(task.alert).toEqual({ level: 1, lastAt: lossAt });
      }
      const team = e.groundOps!.teams[0];
      if (lossAt !== null && team.step === "fight" && team.stepStartedAt > lossAt && (task.fightCount ?? 0) > prevCount) {
        const level = alertLevelAt(task, team.stepStartedAt);
        expect(level).toBeGreaterThan(0);
        const fightTeams = [{ securityIds: team.securityIds, downedThisTask: team.downedThisTask, securityShare: e.groundOps!.factors.securityShare[0] }];
        const asStarted = { ...task, fightCount: (task.fightCount ?? 0) - 1 };
        const want = resolveTaskFight(e, fightTeams, e.bodies[0], asStarted, 0, team.carry, undefined, level);
        const flags = team.pendingFight!.reinforcement ? { reinforcement: true as const } : {};
        expect(team.pendingFight).toEqual({ ...want, ...flags });
        expect(resolveTaskFight(e, fightTeams, e.bodies[0], asStarted, 0, team.carry)).not.toEqual(want);
        checked = true;
      }
    }
    expect(checked).toBe(true);
  });

  it("the threat key reads the alert only when there is one (every read without one keys as before)", () => {
    const exp = affixRun({ pois: ["crashedShip"], risk: { ...CALM, combat: 2 } });
    const team = [{ securityIds: exp.groundOps!.teams[0].securityIds, securityShare: 1 }];
    const task = tasksOf(exp)[0];
    const plain = groundThreatOddsKey(exp, team, exp.bodies[0], task, 0, 32);
    expect(groundThreatOddsKey(exp, team, exp.bodies[0], task, 0, 32, undefined, 0)).toBe(plain);
    expect(groundThreatOddsKey(exp, team, exp.bodies[0], task, 0, 32, undefined, 2)).not.toBe(plain);
  });
});

// ===== the failsafe =====

// One weak team, a hard Reinforcing objective FIRST in its queue (a score one step below Impossible, so ONE setback
// makes it Impossible) and a calm one behind it.
function heldRun(rank: number, seed?: number): Expedition {
  return affixRun({
    pois: ["derelictOutpost", "mineralOutcrop"],
    risk: { ...CALM },
    securityStrength: 0,
    ...(seed !== undefined ? { seed } : {}),
    after: (e) => force(tasksOf(e)[0], [R(rank)], 10),
    afterPlan: (e) => {
      const ids = tasksOf(e).map((t) => t.id);
      e.groundOps!.teams[0].queue = [ids[0], ids[1]];
    },
  });
}

describe("AF-1 the FAILSAFE: an objective its alert made Impossible is held until the reset; the team moves on", () => {
  it("held (not skipped) with a countdown, the calm objective done meanwhile, the hard one picked up at the reset", { timeout: 60_000 }, () => {
    const exp = heldRun(10, seedWithBattles(0, [R(10)], 1));
    const [hard, calm] = tasksOf(exp);
    expect(hard.fightPoints!.length).toBeGreaterThan(0);
    expect(calm.fightPoints).toEqual([]);
    const done = advanceExpedition(exp, T0 + 30_000);
    const hist = historyOf(done, 0);
    const loss = hist.find((r) => r.step === "fight" && r.outcome === "loss" && r.taskId === hard.id)!;
    expect(loss).toBeDefined();
    const resetAt = loss.endedAt + 7200;
    // Right after the setback: Impossible, held, the countdown to the reset; still queued (not skipped).
    const atLoss = advanceExpedition(exp, loss.endedAt);
    const held = tasksOf(atLoss)[0];
    expect(held.alert).toEqual({ level: 1, lastAt: loss.endedAt });
    expect(held.status).toBe("queued");
    expect(objectiveHeld(held, loss.endedAt + 1)).toBe(true);
    expect(objectiveHeldUntil(held, loss.endedAt + 1)).toBe(resetAt);
    expect(alertResetsAt(held)).toBe(resetAt);
    // Nobody lands on it while it is held; the calm objective gets done.
    const deploysOnHard = hist.filter((r) => r.step === "deploy" && r.taskId === hard.id);
    expect(deploysOnHard.filter((r) => r.startedAt > loss.endedAt && r.startedAt < resetAt)).toEqual([]);
    const calmDone = tasksOf(done)[1];
    expect(calmDone.status).toBe("done");
    expect(calmDone.completedAt!).toBeLessThan(resetAt);
    // At the reset: the log line (the user's words), the record cleared, and the idle team lands on it again.
    const log = (done.groundOps!.log ?? []).filter((l) => l.kind === "alertReset");
    expect(log[0]).toEqual({ at: resetAt, kind: "alertReset", taskId: hard.id });
    expect(groundOpsLogText(done, log[0])).toBe("Derelict Outpost: the threat appears to have retreated");
    const retry = deploysOnHard.find((r) => r.startedAt >= resetAt)!;
    expect(retry.startedAt).toBe(resetAt);
    const idleEnd = hist.find((r) => r.step === "idle" && r.endedAt === resetAt);
    expect(idleEnd).toBeDefined();
    // The window never closed meanwhile (the held objective is still to do).
    expect(advanceExpedition(exp, resetAt - 1).groundOps!.endedAt).toBeUndefined();
  });

  it("a helper never borrows a held objective", { timeout: 60_000 }, () => {
    const state = crewed(0x51ed, "gg", 1);
    const exp = affixRun({
      state,
      pois: ["derelictOutpost", "mineralOutcrop"],
      risk: { ...CALM },
      securityStrength: 400,
      after: (e) => {
        force(tasksOf(e)[0], [R(1)], 10);
        tasksOf(e)[0].alert = { level: 1, lastAt: T0 };
      },
      afterPlan: (e) => {
        for (const team of e.groundOps!.teams) team.helpOthers = true;
      },
    });
    const ref = findGroundTask(exp, tasksOf(exp)[0].id)!;
    expect(objectiveHeld(ref.task, T0 + 5)).toBe(true);
    const later = advanceExpedition(exp, T0 + 1799);
    // Both teams idle or busy elsewhere: nobody (owner or helper) has touched the held objective.
    expect(later.groundOps!.history.filter((r) => r.taskId === ref.task.id)).toEqual([]);
    expect(later.groundOps!.teams.every((team) => team.taskId !== ref.task.id)).toBe(true);
    // At the reset it is workable again and somebody lands on it.
    const after = advanceExpedition(exp, T0 + 1800 + DEPLOY_SECONDS);
    expect(after.groundOps!.history.some((r) => r.taskId === ref.task.id && r.step === "deploy" && r.startedAt === T0 + 1800)).toBe(true);
  });
});

// ===== parity =====

describe("AF-1 parity: one call == 997 s chunks == 1 s chunks with a reinforced objective held and decaying", () => {
  it("a hand-built run: extra battles, a loss, Impossible, the reset, the retry", { timeout: 300_000 }, () => {
    // A first strike early on the bar (before the first fight point), so the weak crew meets it.
    let seed = 1;
    while ((rollReinforcements(seed, 0, 0, [R(3)])[0] ?? 1) > 0.2) seed += 1;
    const exp = heldRun(3, seed);
    const end = T0 + 3 * 3600;
    const one = advanceExpedition(exp, end);
    // The window holds what the test is about.
    expect(one.groundOps!.history.some((r) => r.reinforcement)).toBe(true);
    expect((one.groundOps!.log ?? []).some((l) => l.kind === "alertReset")).toBe(true);
    expect(chunked(exp, T0, end, 997)).toEqual(one);
    expect(chunked(exp, T0, end, 1)).toEqual(one);
  });

  it("a real dispatch at Tier VI in enemy territory (weak crew): one call == 997 s chunks", { timeout: 300_000 }, () => {
    const d = dispatch(crewed(0x2b0b5e7, "gg", 3), { tier: 6, enemyTerritory: true });
    const end = T0 + 200_000;
    const one = advanceExpedition(d.exp, end);
    expect(one.groundOps!.history.some((r) => r.reinforcement)).toBe(true);
    expect(chunked(d.exp, T0, end, 997)).toEqual(one);
  });
});

// ===== larger joint crews =====

describe("AF-1 LARGER JOINT CREWS (user: double up at the cost of speed)", () => {
  it("groundTaskCrewOptions: the smallest crews first, then every larger covering crew; groundTaskCrews unchanged", () => {
    const gg = affixRun({ state: crewed(0x51ed, "gg"), pois: ["crashedShip"], risk: { ...CALM, combat: 2 } });
    const id = tasksOf(gg)[0].id;
    expect(groundTaskCrews(gg, id)).toEqual([[0], [1]]);
    expect(groundTaskCrewOptions(gg, id)).toEqual([
      { teams: [0], larger: false },
      { teams: [1], larger: false },
      { teams: [0, 1], larger: true },
    ]);
    const ss = affixRun({ state: crewed(0x51ed, "ss"), pois: ["crashedShip"], risk: { ...CALM, combat: 2 } });
    expect(groundTaskCrewOptions(ss, tasksOf(ss)[0].id)).toEqual([{ teams: [0, 1], larger: false }]);
    expect(groundTaskCrewOptions(gg, "nope")).toEqual([]);
  });

  it("a larger crew works the objective as ONE joint crew (both Security squads in one fight) and completes it once", { timeout: 60_000 }, () => {
    const exp = affixRun({ state: crewed(0x51ed, "gg"), pois: ["crashedShip"], risk: { ...CALM, combat: 2 }, securityStrength: 400 });
    const task = tasksOf(exp)[0];
    // Undo the plan's pick for a clean start, then double up through the edit API at T0.
    const start = structuredClone(exp);
    for (const team of start.groundOps!.teams) {
      team.step = "idle";
      team.stepEndsAt = null;
      delete team.taskId;
      delete team.attemptPoints;
    }
    start.groundOps!.history = [];
    tasksOf(start)[0].status = "queued";
    const check = applyGroundOpsEdit(start, { kind: "assign", taskId: task.id, teamIndex: 0, partners: [1] }, T0);
    expect(check).toEqual({ ok: true });
    expect(tasksOf(start)[0].assignedTeamIds).toEqual([0, 1]);
    const done = advanceExpedition(start, T0 + 40_000);
    const t = tasksOf(done)[0];
    expect(t.status).toBe("done");
    for (const s of t.segmentBankers ?? []) expect(s).toEqual([0, 1]);
    expect(historyOf(done, 1).some((r) => r.step === "staging" && r.taskId === task.id)).toBe(true);
    expect(done.findings.filter((f) => f.relic !== undefined).length).toBeLessThanOrEqual(1);
  });
});

// ===== save and reload mid-alert =====

describe("AF-1 a save mid-alert reloads and resolves identically", () => {
  it("serialize, deserialize, migrate mid-run (alert, affixes, visits, score, pending strikes, a reset logged) == the uninterrupted run", { timeout: 300_000 }, () => {
    // A weak crew on a Reinforcing X objective scored 8 (Impossible after 3 setbacks): it loses, retries on alert,
    // goes Impossible, waits out the reset, and tries again. Find the first instant a work step is under way with a
    // strike still pending on the lead, the objective on alert, and an earlier reset in the log.
    let found: { exp: Expedition; mid: Expedition; at: number } | null = null;
    for (let seed = 1; seed < 400 && !found; seed += 1) {
      const exp = affixRun({
        pois: ["derelictOutpost", "mineralOutcrop"],
        risk: { ...CALM },
        securityStrength: 0,
        seed,
        after: (e) => force(tasksOf(e)[0], [R(10)], 8),
      });
      let e = exp;
      for (let t = T0 + 20; t < T0 + 60_000; t += 20) {
        e = advanceExpedition(e, t);
        const team = e.groundOps!.teams[0];
        const task = tasksOf(e)[0];
        const logged = (e.groundOps!.log ?? []).some((l) => l.kind === "alertReset");
        if (logged && task.alert && (team.reinforcementsAt?.length ?? 0) > 0 && team.step === "work" && team.taskId === task.id) {
          found = { exp, mid: e, at: t };
          break;
        }
      }
    }
    expect(found).not.toBeNull();
    const { exp, mid, at } = found!;
    const task = tasksOf(mid)[0];
    expect(task.affixes).toEqual([R(10)]);
    expect(task.difficultyScore).toBe(8);
    expect(task.visits).toBeGreaterThan(1);
    expect(task.alert!.level).toBeGreaterThan(0);
    const res = asPreCurveDispatch(asPreG2NamesDispatch(dispatchPastPropulsion(oneTeam(), "ship-1", 1, "cand-0")));
    const state = { ...res.next, gameTimeSeconds: at, expeditions: [mid] };
    const loaded = migrate(deserialize(serialize(state, 0)) as SaveFile);
    expect(loaded.expeditions[0]).toEqual(mid);
    const END = at + 40_000;
    expect(advanceExpedition(loaded.expeditions[0], END)).toEqual(advanceExpedition(exp, END));
  });
});
