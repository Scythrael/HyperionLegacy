// Ground Operations GO-7c: several ground teams on one ship (groundOps.ts): the DEFAULT PLAN (user 9b.3),
// HELPERS (user D25 + 9b.4) with the HELPER_MIN_TIER floor and the skippedBorrowed no-loop rule, JOINT tasks
// (requiredTeams N: staging, a LEAD carrying the joint steps, one fight side, the team set banking and paying),
// recovery legs for several wiped teams (user Q1: one leg at a time, each team waits for its own pickup), and
// offline == live parity on a 3-team run. Every REAL hull fields exactly 1 ground team, so these tests run on a
// SYNTHETIC 3-team hull (awayTeamTestFixtures.ts registerSyntheticHull), registered per test and removed after.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  freshState,
  type AwayMember,
  type Expedition,
  type ExpeditionBody,
  type GameState,
  type GroundFightRecord,
  type GroundStepRecord,
  type GroundTeamRun,
  type ShipTypeKey,
} from "./model";
import { advanceExpedition, expeditionCandidates, startExpedition } from "./expedition";
import {
  DEPLOY_SECONDS,
  GROUND_STUCK_LOSSES,
  IN_SYSTEM_LEG_SECONDS,
  RETURN_SECONDS,
  groundOpsAssignIdle,
  groundOpsBodyScanned,
  groundOpsLogText,
  groundTaskFindingPrefix,
  initGroundTasks,
  requiredTeamsOf,
  scanClockAt,
} from "./groundOps";
import { HELPER_MIN_TIER, groundTaskClearOdds, groundTaskThreat } from "./groundThreat";
import { tierAtLeast } from "./combat/threatAssessment";
import { segmentCount, taskFullHaul, taskWorkSeconds } from "./groundTasks";
import { plainAwayMember, registerSyntheticHull, withSlottedAwayTeams } from "./awayTeamTestFixtures";

// ===== fixtures =====

const KEY = "syntheticOpsTrio" as ShipTypeKey;
let cleanup: (() => void) | null = null;
beforeEach(() => {
  cleanup = registerSyntheticHull(KEY, [
    { teamType: "security", size: 2, count: 3 },
    { teamType: "science", size: 1, count: 3 },
  ]);
});
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

const T0 = 100_000;
const FAR = T0 + 400_000;

const member = (id: string, teamType: AwayMember["teamType"], over: Partial<AwayMember> = {}): AwayMember => ({
  ...plainAwayMember(id, teamType, "ship-1"),
  ...over,
});
// Hire order fills team 0, then 1, then 2 (the v67 backfill): Security 1+2 / 3+4 / 5+6, Science 11 / 12 / 13.
const TRIO: AwayMember[] = [
  member("member-1", "security", { spec: "offense", rank: 3 }),
  member("member-2", "security", { spec: "defense", rank: 3, traits: ["fieldMedic"] }),
  member("member-3", "security", { spec: "offense", rank: 3 }),
  member("member-4", "security", { spec: "defense", rank: 3, traits: ["fieldMedic"] }),
  member("member-5", "security", { spec: "offense", rank: 3 }),
  member("member-6", "security", { spec: "defense", rank: 3, traits: ["fieldMedic"] }),
  member("member-11", "science", { rank: 2 }),
  member("member-12", "science", { rank: 2 }),
  member("member-13", "science", { rank: 2 }),
];

// The ship on the synthetic 3-team hull, its teams slotted in hire order, `help` = each team's helpOthers.
function trioState(help: boolean[] = [false, false, false], members: AwayMember[] = TRIO): GameState {
  const base = freshState();
  const s = withSlottedAwayTeams({
    ...base,
    gameTimeSeconds: T0 - 50_000,
    awayMembers: members.map((m) => ({ ...m })),
    nextAwayMemberId: 100,
    ships: base.ships.map((sh) => ({ ...sh, typeKey: KEY })),
  });
  return { ...s, ships: s.ships.map((sh) => ({ ...sh, groundTeams: sh.groundTeams!.map((t, i) => ({ ...t, helpOthers: help[i] === true })) })) };
}

interface Setup {
  poiIds: string[];
  required?: (number | undefined)[]; // per task: requiredTeams before stamping (content wiring)
  hazard?: number;
  seed?: number;
  securityStrength?: number;
  shares?: number[]; // GroundOpsFactors.securityShare override (each team's crew-layer share: its strength lever)
  help?: boolean[];
  scanning?: boolean; // a second, huge body is still being scanned (the ship is busy scanning: legs pause it)
  // Hand-made queues instead of the default plan: called on the stamped run before the first assignment.
  manual?: (e: Expedition) => void;
}

// A dispatched 3-team Ground Ops run turned into a hand-built run whose window opened at T0 with body 0 scanned
// and its tasks planned (or hand-queued), the teams deployed (the moment a body completes in a real run).
function opsRun(setup: Setup): Expedition {
  const s = trioState(setup.help);
  const res = startExpedition(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id);
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  const dispatched = res.expedition;
  const body: ExpeditionBody = {
    id: "body-1",
    planetType: "terrestrial",
    scanTotal: 100,
    scanProgress: 100,
    hazard: setup.hazard ?? 0.2,
    scanned: true,
    discoveries: setup.poiIds.map((poiId, k) => ({ id: `${dispatched.id}-body-1-disc-${k}`, kind: "landmark", poiId })),
    activities: setup.poiIds.map((poiId, k) => ({
      id: `${dispatched.id}-body-1-act-${k}`,
      bodyId: "body-1",
      poiId,
      done: false,
      ...(setup.required?.[k] !== undefined ? { requiredTeams: setup.required[k] } : {}),
    })),
  };
  const bodies: ExpeditionBody[] = [body];
  if (setup.scanning) {
    bodies.push({ id: "body-2", planetType: "terrestrial", scanTotal: 1e9, scanProgress: 0, hazard: 0.1, scanned: false, discoveries: [], activities: [] });
  }
  const steps = dispatched.encounterSteps ?? 1;
  const exp: Expedition = structuredClone({
    ...dispatched,
    seed: setup.seed ?? dispatched.seed,
    ...(setup.securityStrength !== undefined ? { securityStrength: setup.securityStrength } : {}),
    phase: setup.scanning ? "scanning" : "activities",
    phaseAnchorSeconds: T0,
    bodies,
    scanStepCursor: Math.max(0, steps - 1), // body 0's step boundaries are behind the scan
    groundOps: { ...dispatched.groundOps!, startedAt: T0 },
  });
  if (setup.shares) exp.groundOps!.factors.securityShare = [...setup.shares];
  if (setup.manual) {
    initGroundTasks(exp, 0);
    for (const team of exp.groundOps!.teams) team.stepStartedAt = T0;
    setup.manual(exp);
  } else {
    groundOpsBodyScanned(exp, 0, T0);
  }
  groundOpsAssignIdle(exp, T0);
  return exp;
}

const teams = (e: Expedition): GroundTeamRun[] => e.groundOps!.teams;
const historyOf = (e: Expedition, i: number): GroundStepRecord[] => e.groundOps!.history.filter((r) => r.teamIndex === i);
const tasksOf = (e: Expedition) => e.bodies[0].activities;
const fresh = (e: Expedition, i: number) => ({ securityIds: teams(e)[i].securityIds, downedThisTask: [], securityShare: e.groundOps!.factors.securityShare[i] });

// Owner queues by hand: team i gets the tasks listed (by activity index), each owned by it.
function own(e: Expedition, queues: number[][]): void {
  const acts = tasksOf(e);
  queues.forEach((ks, i) => {
    teams(e)[i].queue = ks.map((k) => acts[k].id);
    for (const k of ks) acts[k].assignedTeamIds = [...(acts[k].assignedTeamIds ?? []), teams(e)[i].index].sort((a, b) => a - b);
  });
}

// The fight record a team was carrying mid-fight (resolved at its start), read with an advance to just after.
function pendingAt(start: Expedition, rec: GroundStepRecord): GroundFightRecord {
  const mid = advanceExpedition(start, rec.startedAt + 0.5);
  return teams(mid).find((t) => t.index === rec.teamIndex)!.pendingFight!;
}

// ===== tests =====

describe("GO-7c the synthetic hull", () => {
  it("dispatch deploys all three teams (hire order), each with its own share of the crew layer", () => {
    const e = opsRun({ poiIds: [] });
    expect(teams(e).map((t) => [t.index, t.securityIds, t.scienceIds])).toEqual([
      [0, ["member-1", "member-2"], ["member-11"]],
      [1, ["member-3", "member-4"], ["member-12"]],
      [2, ["member-5", "member-6"], ["member-13"]],
    ]);
    expect(e.groundOps!.factors.securityShare.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });
});

describe("GO-7c the default plan (user 9b.3: harder tasks to A, middling to B, easy to C)", () => {
  const POIS = ["mineralOutcrop", "subterraneanCivilization", "caveNetwork", "derelictOutpost", "crashedShip", "ancientRuins"];
  const SHARES = [0.6, 0.3, 0.1];

  it("ranks the teams by mean clear rate, gives the strongest the hardest ceil(n / teams), each queue easiest first", () => {
    const e = opsRun({ poiIds: POIS, hazard: 0.3, securityStrength: 60, shares: SHARES });
    const acts = tasksOf(e);
    // The rule, recomputed from the odds reads (the display stream; a read never shifts a fight).
    const wins = [0, 1, 2].map((i) => acts.map((task, k) => groundTaskClearOdds(e, [fresh(e, i)], e.bodies[0], task, k).wins));
    const mean = (i: number) => wins[i].reduce((a, b) => a + b, 0) / acts.length;
    const ranked = [0, 1, 2].sort((a, b) => mean(b) - mean(a) || a - b);
    expect(ranked).toEqual([0, 1, 2]); // the share lever ranks A > B > C
    const hardest = acts.map((_, k) => k).sort((a, b) => wins[ranked[0]][a] - wins[ranked[0]][b] || a - b);
    const per = Math.ceil(acts.length / 3);
    const want = [0, 1, 2].map((rank) => {
      const mine = hardest.slice(rank * per, (rank + 1) * per);
      const team = ranked[rank];
      return mine.sort((a, b) => wins[team][b] - wins[team][a] || a - b).map((k) => acts[k].id);
    });
    expect(teams(e).map((t) => t.queue)).toEqual(want);
    // Hardest to A: everything A holds rates no better for A than anything C holds.
    const aWorst = Math.max(...want[0].map((id) => wins[0][acts.findIndex((a) => a.id === id)]));
    const cBest = Math.min(...want[2].map((id) => wins[0][acts.findIndex((a) => a.id === id)]));
    expect(aWorst).toBeLessThanOrEqual(cBest);
    // Each task is owned by the team that queued it, and every team started on the head of its queue.
    for (const t of teams(e)) {
      for (const id of t.queue) expect(acts.find((a) => a.id === id)!.assignedTeamIds).toEqual([t.index]);
      expect(t).toMatchObject({ step: "deploy", taskId: t.queue[0], stepEndsAt: T0 + DEPLOY_SECONDS });
    }
  });

  it("two teams work in PARALLEL: their steps overlap in time and the history is written in event order", () => {
    const e = opsRun({ poiIds: POIS, hazard: 0.3, securityStrength: 60, shares: SHARES });
    const done = advanceExpedition(e, T0 + 20_000);
    const work = (i: number) => historyOf(done, i).filter((r) => r.step === "work");
    const overlap = work(0).some((a) => work(1).some((b) => a.startedAt < b.endedAt && b.startedAt < a.endedAt));
    expect(overlap).toBe(true);
    const ends = done.groundOps!.history.map((r) => r.endedAt);
    for (let i = 1; i < ends.length; i++) expect(ends[i]).toBeGreaterThanOrEqual(ends[i - 1]);
    // With nobody helping, each team only ever deploys on its own queue's tasks.
    for (const t of teams(done)) for (const r of historyOf(done, t.index)) if (r.step === "deploy") expect(t.queue).toContain(r.taskId);
  });
});

describe("GO-7c helpers (user D25 + 9b.4)", () => {
  // Team A owns three tasks; team C (helpOthers) has nothing of its own; team B neither helps nor owns.
  const helperRun = (over: Partial<Setup> = {}) =>
    opsRun({
      poiIds: ["mineralOutcrop", "subterraneanCivilization", "mineralOutcrop"],
      hazard: 0.3,
      securityStrength: 60,
      shares: [0.5, 0.0, 0.5],
      help: [false, false, true],
      manual: (e) => own(e, [[0, 1, 2]]),
      ...over,
    });

  it("borrows the first task of another team's queue that rates at least the floor, skipping one below it", () => {
    const e = helperRun();
    const [a0, hard, easy] = tasksOf(e);
    // Preconditions on the odds (the floor reads the helper's own fresh squad from the task's progress).
    expect(tierAtLeast(groundTaskThreat(e, [fresh(e, 2)], e.bodies[0], hard, 1).tier, HELPER_MIN_TIER)).toBe(false);
    expect(tierAtLeast(groundTaskThreat(e, [fresh(e, 2)], e.bodies[0], easy, 2).tier, HELPER_MIN_TIER)).toBe(true);
    expect(teams(e)[0]).toMatchObject({ step: "deploy", taskId: a0.id });
    expect(teams(e)[0].borrowed).toBeUndefined();
    expect(teams(e)[1]).toMatchObject({ step: "idle" }); // no help, no queue
    expect(teams(e)[2]).toMatchObject({ step: "deploy", taskId: easy.id, borrowed: true });
    expect(hard.status).toBe("queued");
    expect(easy.status).toBe("active");
    expect(easy.assignedTeamIds).toEqual([0]); // still the owner's task
    // Every borrow over the run rated at least the floor at that moment.
    const done = advanceExpedition(e, T0 + 30_000);
    const borrows = historyOf(done, 2).filter((r) => r.step === "deploy");
    expect(borrows.length).toBeGreaterThan(0);
    for (const r of borrows) {
      const at = advanceExpedition(e, r.startedAt);
      const k = tasksOf(at).findIndex((x) => x.id === r.taskId);
      expect(teams(at)[2].borrowed).toBe(true);
      expect(tierAtLeast(groundTaskThreat(at, [fresh(at, 2)], at.bodies[0], tasksOf(at)[k], k).tier, HELPER_MIN_TIER)).toBe(true);
    }
    // A helper win finishes the task normally; the owner never works a done task.
    expect(tasksOf(done)[2]).toMatchObject({ status: "done", done: true });
    expect(tasksOf(done)[2].segmentBankers!.every((ids) => ids.length === 1)).toBe(true);
  });

  // A helper's borrowed fight that it LOSES (a wipe), on a run where the ship is still scanning: the helper's
  // crew layer is cut to 0 once it has borrowed (stored values; the floor read it at full strength).
  function helperLoss(): { start: Expedition; lossAt: GroundStepRecord } {
    for (let i = 0; i < 200; i++) {
      const run = helperRun({ seed: (0x7e1c0001 + i * 7919) >>> 0, scanning: true });
      if (teams(run)[2].taskId !== tasksOf(run)[2].id) continue;
      const start = structuredClone(run);
      start.groundOps!.factors.securityShare[2] = 0;
      start.bodies[0].hazard = 0.95; // and a far harsher site from here on
      tasksOf(start)[2].lossStreak = 2; // the OWNER lost it twice before (the helper must not make it 3)
      const done = advanceExpedition(start, T0 + 20_000);
      const lossAt = historyOf(done, 2).find((r) => r.step === "fight" && r.outcome === "loss");
      if (!lossAt) continue;
      const at = advanceExpedition(start, lossAt.endedAt);
      const helper = teams(at)[2];
      if (!helper.securityIds.every((id) => helper.downedThisTask.includes(id))) continue; // want a wipe
      return { start, lossAt };
    }
    throw new Error("no helper loss found");
  }

  it("a helper LOSS: the task goes back to its owner (progress kept), the helper skips it for good and takes its return trip", () => {
    const { start, lossAt } = helperLoss();
    const id = tasksOf(start)[2].id;
    const at = advanceExpedition(start, lossAt.endedAt);
    const task = tasksOf(at)[2];
    expect(task.status).toBe("queued");
    expect(teams(at)[2].skippedBorrowed).toEqual([id]);
    expect(teams(at)[2].step).toBe("return");
    expect(task.progress).toBeGreaterThan(0); // the work before the fight is kept
    expect(task.segmentsBanked).toBe(1);
    // Never borrowed again (the no-loop rule), and the owner finishes it later.
    const done = advanceExpedition(start, T0 + 60_000);
    expect(historyOf(done, 2).filter((r) => r.step === "deploy" && r.taskId === id && r.startedAt > lossAt.endedAt)).toEqual([]);
    expect(historyOf(done, 0).some((r) => r.step === "deploy" && r.taskId === id)).toBe(true);
  });

  it("a helper loss never counts toward the OWNER's loss streak and never moves the task in the owner's queue", () => {
    const { start, lossAt } = helperLoss();
    const before = teams(start)[0].queue;
    const at = advanceExpedition(start, lossAt.endedAt);
    const task = tasksOf(at)[2];
    expect(task.lossStreak).toBe(2);
    expect(task.sentBack).toBeUndefined();
    expect(teams(at)[0].queue).toEqual(before);
  });

  it("a helper WIPED while the ship scans gets a recovery leg like any team: the scan pauses for it", () => {
    const { start, lossAt } = helperLoss();
    const at = advanceExpedition(start, lossAt.endedAt + 1);
    const leg = at.groundOps!.shipLegs.find((l) => l.teamIndex === 2)!;
    expect(leg).toMatchObject({ kind: "recovery", bodyIndex: 0, scanBodyIndex: 1 });
    expect(leg.startsAt).toBeGreaterThanOrEqual(lossAt.endedAt);
    const later = advanceExpedition(start, leg.endsAt + 1);
    expect(historyOf(later, 2).find((r) => r.step === "return" && r.startedAt === lossAt.endedAt)).toMatchObject({ endedAt: leg.arrivesAt, recovered: true });
    // The scan clock stops for the whole leg.
    expect(scanClockAt(later.groundOps!, leg.endsAt) - scanClockAt(later.groundOps!, leg.startsAt)).toBe(0);
  });

  it("a team that does not help never borrows; a helper with its own queued work does its own first", () => {
    const e = helperRun({ help: [false, false, false] });
    expect(teams(e)[2].step).toBe("idle");
    const own2 = helperRun({ manual: (x) => own(x, [[0, 1], [], [2]]) });
    expect(teams(own2)[2]).toMatchObject({ step: "deploy", taskId: tasksOf(own2)[2].id });
    expect(teams(own2)[2].borrowed).toBeUndefined();
  });
});

describe("GO-7c recovery legs with several teams (user Q1: one leg at a time)", () => {
  it("two teams wiped close together queue for the ship: the second waits for its own pickup after the first leg", () => {
    const e = opsRun({
      poiIds: ["subterraneanCivilization", "subterraneanCivilization"],
      hazard: 0.9,
      securityStrength: 0,
      shares: [0, 0, 0],
      manual: (x) => own(x, [[0], [1]]),
    });
    const done = advanceExpedition(e, T0 + 5_000);
    const legs = done.groundOps!.shipLegs;
    expect(legs.length).toBeGreaterThanOrEqual(2);
    const [first, second] = legs;
    expect(new Set([first.teamIndex, second.teamIndex])).toEqual(new Set([0, 1]));
    const wipeOf = (i: number) => historyOf(done, i).find((r) => r.step === "fight" && r.outcome === "loss")!.endedAt;
    expect(first.startsAt).toBe(wipeOf(first.teamIndex));
    expect(wipeOf(second.teamIndex)).toBeLessThan(first.endsAt); // the second wipe came while the ship was away
    expect(second.startsAt).toBe(first.endsAt);
    expect(second.arrivesAt).toBe(first.endsAt + IN_SYSTEM_LEG_SECONDS);
    // Each team's return ends when ITS leg arrives.
    for (const leg of [first, second]) {
      expect(historyOf(done, leg.teamIndex).find((r) => r.step === "return" && r.startedAt === wipeOf(leg.teamIndex))).toMatchObject({ endedAt: leg.arrivesAt, recovered: true });
    }
  });
});

describe("GO-7c joint tasks (requiredTeams N, D25: tasks scale to several teams)", () => {
  it("content's requiredTeams is kept when stamped (a whole number >= 1), else 1", () => {
    expect(requiredTeamsOf({ requiredTeams: 2 })).toBe(2);
    for (const bad of [undefined, 0, -1, 1.5, Number.NaN]) expect(requiredTeamsOf({ requiredTeams: bad })).toBe(1);
  });

  it("a 2-team task: both teams stage, the LEAD deploys and carries the steps, both squads fight as ONE side", () => {
    const e = opsRun({ poiIds: ["crashedShip", "mineralOutcrop"], required: [2, 1], securityStrength: 400, shares: [0.5, 0.3, 0.2] });
    const [joint, solo] = tasksOf(e);
    expect(joint.requiredTeams).toBe(2);
    expect(joint.assignedTeamIds).toEqual([0, 1]); // the two strongest
    expect(teams(e)[0].queue).toContain(joint.id);
    expect(teams(e)[1].queue).toContain(joint.id);
    expect(solo.assignedTeamIds).toEqual([0]);
    // The lead (lowest index) deployed; the partner mirrors its task while staging.
    expect(teams(e)[0]).toMatchObject({ step: "deploy", taskId: joint.id, stepEndsAt: T0 + DEPLOY_SECONDS });
    expect(teams(e)[1]).toMatchObject({ step: "staging", taskId: joint.id, stepEndsAt: null });
    expect(joint.status).toBe("active");
    const done = advanceExpedition(e, FAR);
    const task = tasksOf(done)[0];
    expect(task).toMatchObject({ status: "done", segmentsBanked: segmentCount(task), segmentsOffloaded: segmentCount(task) });
    expect(task.segmentBankers).toEqual(Array.from({ length: segmentCount(task) }, () => [0, 1]));
    // Only the lead's lane shows the joint deploy, work and fights; the partner stages until the joint return.
    const lead = historyOf(done, 0).filter((r) => r.taskId === joint.id);
    const partner = historyOf(done, 1).filter((r) => r.taskId === joint.id);
    expect(lead.map((r) => r.step).slice(0, 3)).toEqual(["deploy", "work", "fight"]);
    expect(partner[0]).toMatchObject({ step: "staging", startedAt: T0 });
    const ret = lead.find((r) => r.step === "return")!;
    expect(partner[0].endedAt).toBe(ret.startedAt);
    expect(partner[1]).toMatchObject({ step: "return", startedAt: ret.startedAt, endedAt: ret.startedAt + RETURN_SECONDS });
    // One side: every fight fields both teams' Security squads.
    for (const r of lead.filter((x) => x.step === "fight")) {
      const rec = pendingAt(e, r);
      expect([...Object.keys(rec.memberEnd), ...rec.downedMemberIds].sort()).toEqual(["member-1", "member-2", "member-3", "member-4"]);
    }
    // The work time is the union's (both Science members' fieldwork summed).
    const ops = e.groundOps!;
    const work = (i: number) => ({ ...teams(e)[i], scienceShare: ops.factors.scienceShare[i] });
    const full = taskWorkSeconds(e, [work(0), work(1)], e.bodies[0]);
    const w = lead.find((r) => r.step === "work")!;
    expect(w.endedAt - w.startedAt).toBe(Math.max(1, Math.round(joint.fightPoints![0] * full)));
    // The offload pays the team SET's yield: the whole haul at both teams' yield, offloaded once.
    const found = done.findings.filter((f) => f.id.startsWith(groundTaskFindingPrefix(done, joint.id)));
    const haul = taskFullHaul(e, [work(0), work(1)], e.bodies[0], joint.poiId, 0);
    const sum: Record<string, number> = {};
    for (const f of found) for (const [k, v] of Object.entries(f.materials ?? {})) sum[k] = (sum[k] ?? 0) + v;
    expect(sum).toEqual(haul.materials);
    expect(found.reduce((a, f) => a + (f.credits ?? 0), 0)).toBe(haul.credits);
  });

  it("a staged team WAITS for a busy partner; the joint task deploys the moment the partner joins", () => {
    const e = opsRun({
      poiIds: ["mineralOutcrop", "mineralOutcrop"],
      required: [2, 1],
      securityStrength: 400,
      manual: (x) => {
        own(x, [[0], [1, 0]]);
        Object.assign(teams(x)[1], { step: "reload", stepStartedAt: T0, stepEndsAt: T0 + 500 });
      },
    });
    const id = tasksOf(e)[0].id;
    expect(teams(e)[0]).toMatchObject({ step: "staging", taskId: id, stepEndsAt: null });
    const busy = advanceExpedition(e, T0 + 499);
    expect(teams(busy)[0]).toMatchObject({ step: "staging", stepStartedAt: T0 });
    // Team B is free at T0 + 500: it JOINS the waiting joint task before its own solo task (no two joint tasks
    // can ever wait on each other), and the lead deploys at once.
    const joined = advanceExpedition(e, T0 + 500);
    expect(teams(joined)[0]).toMatchObject({ step: "deploy", taskId: id, stepStartedAt: T0 + 500 });
    expect(teams(joined)[1]).toMatchObject({ step: "staging", taskId: id, stepStartedAt: T0 + 500 });
    expect(historyOf(joined, 0).find((r) => r.step === "staging")).toMatchObject({ startedAt: T0, endedAt: T0 + 500, taskId: id });
    const done = advanceExpedition(e, FAR);
    expect(tasksOf(done).every((t) => t.done)).toBe(true);
  });

  it("two joint tasks queued in opposite orders never wait on each other", () => {
    const e = opsRun({
      poiIds: ["mineralOutcrop", "mineralOutcrop"],
      required: [2, 2],
      securityStrength: 400,
      manual: (x) => own(x, [[0, 1], [1, 0]]),
    });
    const [j0] = tasksOf(e);
    expect(teams(e)[0]).toMatchObject({ step: "deploy", taskId: j0.id });
    expect(teams(e)[1]).toMatchObject({ step: "staging", taskId: j0.id });
    const done = advanceExpedition(e, FAR);
    expect(tasksOf(done).every((t) => t.done)).toBe(true);
    expect(done.groundOps!.endedAt).toBeDefined();
  });

  it("a joint WIPE: each wiped team waits for its own pickup; the loss counts once and both owners send it back", () => {
    const e = opsRun({
      poiIds: ["subterraneanCivilization", "mineralOutcrop"],
      required: [2, 1],
      hazard: 0.9,
      securityStrength: 0,
      shares: [0, 0, 0],
      manual: (x) => own(x, [[0, 1], [0]]),
    });
    const id = tasksOf(e)[0].id;
    const first = advanceExpedition(e, T0 + 3_000);
    const loss = historyOf(first, 0).find((r) => r.step === "fight" && r.outcome === "loss")!;
    const at = advanceExpedition(e, loss.endedAt);
    expect(tasksOf(at)[0]).toMatchObject({ status: "queued", lossStreak: 1 });
    const legs = at.groundOps!.shipLegs;
    expect(legs.map((l) => [l.teamIndex, l.startsAt])).toEqual([
      [0, loss.endedAt],
      [1, loss.endedAt + 2 * IN_SYSTEM_LEG_SECONDS],
    ]);
    // Each team runs its OWN return: the partner's staging closes at the loss, its return ends on its own leg.
    expect(teams(at)[1]).toMatchObject({ step: "return", stepEndsAt: legs[1].arrivesAt });
    expect(historyOf(at, 1).find((r) => r.step === "staging")).toMatchObject({ endedAt: loss.endedAt, taskId: id });
    // After GROUND_STUCK_LOSSES joint losses in a row it goes to the back of BOTH owners' queues.
    const later = advanceExpedition(e, T0 + 30_000);
    const losses = historyOf(later, 0).filter((r) => r.step === "fight" && r.outcome === "loss" && r.taskId === id);
    expect(losses.length).toBeGreaterThanOrEqual(GROUND_STUCK_LOSSES);
    const third = advanceExpedition(e, losses[GROUND_STUCK_LOSSES - 1].endedAt);
    expect(tasksOf(third)[0]).toMatchObject({ lossStreak: GROUND_STUCK_LOSSES, sentBack: 1 });
    expect(teams(third)[0].queue[teams(third)[0].queue.length - 1]).toBe(id);
    expect(teams(third)[1].queue).toEqual([id]);
  });

  it("a task needing more teams than deployed is SKIPPED at planning with a log line [PROVISIONAL, Q20]", () => {
    const e = opsRun({ poiIds: ["crashedShip", "mineralOutcrop"], required: [4, 1], securityStrength: 400 });
    const [big, ok] = tasksOf(e);
    expect(big.status).toBe("skipped");
    expect(teams(e).some((t) => t.queue.includes(big.id))).toBe(false);
    expect(ok.status).toBe("active");
    expect(e.groundOps!.log).toEqual([{ at: T0, kind: "skippedNeedsTeams", taskId: big.id, requiredTeams: 4, deployedTeams: 3 }]);
    expect(groundOpsLogText(e, e.groundOps!.log![0])).toBe("Skipped Crashed Ship: needs 4 ground teams, 3 deployed");
    // A run with nothing to log writes no log at all (the stored shape is unchanged).
    expect(opsRun({ poiIds: ["mineralOutcrop"] }).groundOps!.log).toBeUndefined();
  });
});

describe("GO-7c PARITY: one big advance == 997 s chunks == 1 s chunks", () => {
  const check = (exp: Expedition, end: number): Expedition => {
    const big = advanceExpedition(exp, end);
    let chunked = exp;
    for (let t = 997; t < end; t += 997) chunked = advanceExpedition(chunked, t);
    chunked = advanceExpedition(chunked, end);
    expect(chunked).toEqual(big);
    let live = exp;
    const from = Math.floor(exp.groundOps?.startedAt ?? 0);
    live = advanceExpedition(live, from);
    for (let t = from + 1; t <= end; t += 1) live = advanceExpedition(live, t);
    expect(live).toEqual(big);
    return big;
  };

  it("a hand-built 3-team run with a joint task, a helper and wipes, over 2 hours", { timeout: 180_000 }, () => {
    const e = opsRun({
      poiIds: ["crashedShip", "derelictOutpost", "mineralOutcrop", "caveNetwork", "subterraneanCivilization"],
      required: [2, 1, 1, 1, 1],
      hazard: 0.6,
      securityStrength: 25,
      shares: [0.5, 0.3, 0.2],
      help: [false, false, true],
      scanning: true,
    });
    const frozen = structuredClone(e);
    const big = check(e, T0 + 7200);
    expect(e).toEqual(frozen); // the input is never mutated
    const ops = big.groundOps!;
    expect(ops.history.some((r) => r.step === "staging")).toBe(true);
    expect(ops.history.some((r) => r.outcome === "loss")).toBe(true);
    expect(new Set(ops.history.filter((r) => r.step === "fight").map((r) => r.teamIndex)).size).toBeGreaterThanOrEqual(2);
    // The helper borrowed (a deploy on a task outside its own queue).
    expect(ops.history.some((r) => r.teamIndex === 2 && r.step === "deploy" && !ops.teams[2].queue.includes(r.taskId!))).toBe(true);
  });

  it("a REAL dispatched 3-team run (overlap with the scan, the default plan per body) over the first 2 hours of the window", { timeout: 180_000 }, () => {
    const s = { ...trioState([false, false, true]), expeditionSeed: 0x0a13bd4 };
    const res = startExpedition(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id);
    expect(res.success).toBe(true);
    const exp = res.expedition!;
    expect(exp.groundOps!.teams.length).toBe(3);
    let t = 0;
    let e = exp;
    while (e.groundOps!.startedAt === undefined) e = advanceExpedition(exp, (t += 600));
    const open = e.groundOps!.startedAt!;
    let chunked = exp;
    const END = open + 7200;
    for (let c = 997; c < END; c += 997) chunked = advanceExpedition(chunked, c);
    chunked = advanceExpedition(chunked, END);
    const big = advanceExpedition(exp, END);
    expect(chunked).toEqual(big);
    let live = advanceExpedition(exp, open);
    for (let c = Math.floor(open) + 1; c <= END; c += 1) live = advanceExpedition(live, c);
    expect(live).toEqual(big);
    // The run used several teams (the default plan split the bodies' tasks), and wiped teams queued for the ship.
    const deployed = new Set(big.groundOps!.history.filter((r) => r.step === "deploy").map((r) => r.teamIndex));
    expect(deployed.size).toBeGreaterThanOrEqual(2);
    expect(new Set(big.groundOps!.shipLegs.map((l) => l.teamIndex)).size).toBeGreaterThanOrEqual(2);
    // The whole run (big == 997 s chunks): all three teams work, and late wipes keep queuing for the ship.
    const WHOLE = open + 150_000;
    let whole = exp;
    for (let c = 997; c < WHOLE; c += 997) whole = advanceExpedition(whole, c);
    whole = advanceExpedition(whole, WHOLE);
    const far = advanceExpedition(exp, WHOLE);
    expect(whole).toEqual(far);
    expect(new Set(far.groundOps!.history.filter((r) => r.step === "deploy").map((r) => r.teamIndex))).toEqual(new Set([0, 1, 2]));
    expect(far.groundOps!.shipLegs.some((l) => l.scanBodyIndex === null)).toBe(true);
  });
});
