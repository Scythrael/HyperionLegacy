// Ground Operations GO-7d: LIVE QUEUE EDITS ("apply from now"). editGroundOps(state, expeditionId, edit) first
// advances the run to state.gameTimeSeconds, validates, applies the edit to the stored queues, counts it
// (editCount) and lets idle teams pick their next work at the edit instant. Refusals return the SAME state.
// Squads (SQ-3): an assign or requeue must leave the task's crew covering its needs (a joint task can never
// stage forever). A SKIP is the user-approved escape hatch for a stuck run ("retry forever, skip by hand").

import { describe, expect, it } from "vitest";
import {
  freshState,
  type AwayMember,
  type Expedition,
  type ExpeditionBody,
  type GameState,
  type GroundStepRecord,
  type GroundTaskNeeds,
  type GroundTeamKind,
  type GroundTeamRun,
  type ShipGroundTeam,
} from "./model";
import { advanceExpedition, canEditGroundOps, claimExpedition, editGroundOps, expeditionCandidates, startExpedition } from "./expedition";
import {
  AUTO_ASSIGN_SALT,
  RETURN_SECONDS,
  groundOpsAssignIdle,
  groundOpsBodyScanned,
  groundOpsEditBlockText,
  groundOpsLogText,
  groundOpsStuck,
  groundTaskCrews,
  groundTaskFindingPrefix,
  groundTaskProgressAt,
  initGroundTasks,
  planTasksForTeams,
  findGroundTask,
  type GroundOpsEdit,
  type GroundOpsEditBlockReason,
  type GroundTaskRef,
} from "./groundOps";
import { asPreCurveDispatch, plainAwayMember, withoutGroundOps, withSlottedAwayTeams } from "./awayTeamTestFixtures";

// ===== fixtures =====

const T0 = 100_000; // the synthetic window opens here (every body scanned)
const FAR = T0 + 400_000;

const member = (id: string, teamType: AwayMember["teamType"], over: Partial<AwayMember> = {}): AwayMember => ({
  ...plainAwayMember(id, teamType, "ship-1"),
  ...over,
});
const SQUAD: AwayMember[] = [
  member("member-1", "security", { spec: "offense", rank: 3 }),
  member("member-2", "security", { spec: "defense", rank: 3 }),
  member("member-3", "security", { spec: "debuff", rank: 3, traits: ["fieldMedic"] }),
  member("member-11", "science", { rank: 2 }),
];
const LONER: AwayMember[] = [member("member-1", "security"), member("member-11", "science")];

function scannedBody(expId: string, poiIds: string[], hazard: number): ExpeditionBody {
  return {
    id: "body-1",
    planetType: "terrestrial",
    scanTotal: 100,
    scanProgress: 100,
    hazard,
    scanned: true,
    discoveries: poiIds.map((poiId, k) => ({ id: `${expId}-body-1-disc-${k}`, kind: "landmark", poiId })),
    activities: poiIds.map((poiId, k) => ({ id: `${expId}-body-1-act-${k}`, bodyId: "body-1", poiId, done: false })),
  };
}

// ONE team (a real dispatch, then one synthetic scanned body: the moment a body completes in a real run).
function oneTeamRun(poiIds: string[], opts: { members?: AwayMember[]; securityStrength?: number; hazard?: number; seed?: number } = {}): Expedition {
  const base = freshState();
  const s = withSlottedAwayTeams({
    ...base,
    gameTimeSeconds: T0 - 50_000,
    awayMembers: (opts.members ?? SQUAD).map((m) => ({ ...m })),
    nextAwayMemberId: 100,
  });
  const res = asPreCurveDispatch(startExpedition(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id));
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  const d = res.expedition;
  const exp: Expedition = structuredClone({
    ...d,
    seed: opts.seed ?? d.seed,
    ...(opts.securityStrength !== undefined ? { securityStrength: opts.securityStrength } : {}),
    phase: "activities",
    phaseAnchorSeconds: T0,
    bodies: [scannedBody(d.id, poiIds, opts.hazard ?? 0.2)],
    groundOps: { ...d.groundOps!, startedAt: T0 },
  });
  groundOpsBodyScanned(exp, 0, T0);
  groundOpsAssignIdle(exp, T0);
  return exp;
}

// TWO teams of the given kinds on the 3 / 3 freighter (the groundOpsSquads.test.ts fixture).
const SEC = ["member-1", "member-2", "member-3", "member-4", "member-5", "member-6"];
const SCI = ["member-11", "member-12", "member-13", "member-14", "member-15", "member-16"];
const CREW: AwayMember[] = [
  ...SEC.map((id, k) => member(id, "security", { spec: k % 2 === 0 ? "offense" : "defense", rank: 3 })),
  ...SCI.map((id) => member(id, "science", { rank: 2 })),
];
const squad = (pool: string[]): (string | null)[] => [...pool.splice(0, 2), null];

function compState(kinds: [GroundTeamKind, GroundTeamKind], help: [boolean, boolean]): GameState {
  const base = freshState();
  const sec = [...SEC];
  const sci = [...SCI];
  const teams: ShipGroundTeam[] = kinds.map((kind, i) => {
    if (kind === "strike") return { kind, security: [...squad(sec), ...squad(sec)], science: [], helpOthers: help[i] };
    if (kind === "survey") return { kind, security: [], science: [...squad(sci), ...squad(sci)], helpOthers: help[i] };
    return { kind, security: squad(sec), science: squad(sci), helpOthers: help[i] };
  });
  return {
    ...base,
    gameTimeSeconds: T0 - 50_000,
    awayMembers: CREW.map((m) => ({ ...m })),
    nextAwayMemberId: 100,
    ships: base.ships.map((sh) => ({ ...sh, groundTeams: teams })),
  };
}

interface SquadTask {
  poiId: string;
  needs?: GroundTaskNeeds;
}

function twoTeamRun(
  kinds: [GroundTeamKind, GroundTeamKind],
  tasks: SquadTask[],
  opts: { help?: [boolean, boolean]; securityStrength?: number; seed?: number; manual?: (e: Expedition) => void } = {},
): Expedition {
  const s = compState(kinds, opts.help ?? [false, false]);
  const res = asPreCurveDispatch(startExpedition(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id));
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  const d = res.expedition;
  const body = scannedBody(
    d.id,
    tasks.map((t) => t.poiId),
    0.2,
  );
  tasks.forEach((t, k) => {
    if (t.needs) body.activities[k].needs = { ...t.needs };
  });
  const exp: Expedition = structuredClone({
    ...d,
    seed: opts.seed ?? d.seed,
    ...(opts.securityStrength !== undefined ? { securityStrength: opts.securityStrength } : {}),
    phase: "activities",
    phaseAnchorSeconds: T0,
    bodies: [body],
    scanStepCursor: Math.max(0, (d.encounterSteps ?? 1) - 1),
    groundOps: { ...d.groundOps!, startedAt: T0 },
  });
  if (opts.manual) {
    initGroundTasks(exp, 0);
    for (const team of exp.groundOps!.teams) team.stepStartedAt = T0;
    opts.manual(exp);
  } else {
    groundOpsBodyScanned(exp, 0, T0);
  }
  groundOpsAssignIdle(exp, T0);
  return exp;
}

// A state holding `exp` as its one expedition at game time `now`.
function stateAt(exp: Expedition, now: number): GameState {
  return { ...freshState(), gameTimeSeconds: now, expeditions: [exp] };
}

// Apply `edit` at `now`; the edited run (throws when refused).
function edited(exp: Expedition, now: number, edit: GroundOpsEdit): Expedition {
  const s = stateAt(exp, now);
  const next = editGroundOps(s, exp.id, edit);
  if (next === s) throw new Error(`edit refused: ${JSON.stringify(canEditGroundOps(s, exp.id, edit))}`);
  return next.expeditions[0];
}

function refused(exp: Expedition, now: number, edit: GroundOpsEdit, reason: GroundOpsEditBlockReason): void {
  const s = stateAt(exp, now);
  expect(canEditGroundOps(s, exp.id, edit)).toEqual({ ok: false, reason });
  expect(editGroundOps(s, exp.id, edit)).toBe(s);
}

const teams = (e: Expedition): GroundTeamRun[] => e.groundOps!.teams;
const tasksOf = (e: Expedition) => e.bodies[0].activities;
const historyOf = (e: Expedition, i = 0): GroundStepRecord[] => e.groundOps!.history.filter((r) => r.teamIndex === i);
const remainingQueue = (e: Expedition, i: number): string[] =>
  teams(e)[i].queue.filter((id) => {
    const t = findGroundTask(e, id)?.task;
    return t !== undefined && (t.status === "queued" || t.status === "active");
  });

// The midpoint (whole seconds) of the first step of `kind` on `taskId` lasting at least `min` seconds.
function midOf(done: Expedition, team: number, kind: GroundStepRecord["step"], taskId: string, min = 4): number {
  const rec = historyOf(done, team).find((r) => r.step === kind && r.taskId === taskId && r.endedAt - r.startedAt >= min);
  if (!rec) throw new Error(`no ${kind} step on ${taskId}`);
  return Math.floor((rec.startedAt + rec.endedAt) / 2);
}

// ===== tests =====

describe("GO-7d refusals return the SAME state", () => {
  const exp = oneTeamRun(["mineralOutcrop", "caveNetwork", "crashedShip"], { securityStrength: 400 });
  const [a, b] = tasksOf(exp);

  it("no such expedition, a legacy run, a finished run", () => {
    const s = stateAt(exp, T0 + 10);
    expect(canEditGroundOps(s, "nope", { kind: "skip", taskId: a.id })).toEqual({ ok: false, reason: "noExpedition" });
    expect(editGroundOps(s, "nope", { kind: "skip", taskId: a.id })).toBe(s);
    refused(withoutGroundOps(exp), T0 + 10, { kind: "skip", taskId: a.id }, "notGroundOps");
    const done = advanceExpedition(exp, FAR);
    expect(done.groundOps!.endedAt).toBeDefined();
    refused(exp, FAR, { kind: "setHelp", teamIndex: 0, on: true }, "runFinished");
  });

  it("task, team and body lookups; done, skipped and not-skipped tasks; nothing to change", () => {
    refused(exp, T0 + 10, { kind: "skip", taskId: "bogus" }, "noSuchTask");
    refused(exp, T0 + 10, { kind: "assign", taskId: b.id, teamIndex: 7 }, "noSuchTeam");
    refused(exp, T0 + 10, { kind: "assign", taskId: b.id, teamIndex: 0, partners: [3] }, "noSuchTeam");
    refused(exp, T0 + 10, { kind: "requeue", taskId: b.id, teamIndex: 0 }, "notSkipped");
    refused(exp, T0 + 10, { kind: "defaultPlan", bodyIndex: 4 }, "noSuchBody");
    refused(exp, T0 + 10, { kind: "setHelp", teamIndex: 0, on: false }, "noChange");
    // The head of the remaining queue cannot move up; the last cannot move down.
    const order = remainingQueue(exp, 0);
    refused(exp, T0 + 10, { kind: "reorder", teamIndex: 0, taskId: order[0], delta: -1 }, "noChange");
    refused(exp, T0 + 10, { kind: "reorder", teamIndex: 0, taskId: order[order.length - 1], delta: 1 }, "noChange");
    // Assigning a task to the team that already holds it, where it already sits, changes nothing.
    refused(exp, T0 + 10, { kind: "assign", taskId: order[order.length - 1], teamIndex: 0 }, "noChange");
    // A done task.
    const done = advanceExpedition(exp, FAR);
    const first = tasksOf(done).reduce((x, y) => ((x.completedAt ?? Infinity) <= (y.completedAt ?? Infinity) ? x : y));
    refused(exp, first.completedAt! + 1, { kind: "skip", taskId: first.id }, "taskDone");
    // A skipped task: skip again, assign or reorder it.
    const skipped = edited(exp, T0 + 10, { kind: "skip", taskId: order[2] });
    refused(skipped, T0 + 11, { kind: "skip", taskId: order[2] }, "taskSkipped");
    refused(skipped, T0 + 11, { kind: "assign", taskId: order[2], teamIndex: 0 }, "taskSkipped");
    refused(skipped, T0 + 11, { kind: "reorder", teamIndex: 0, taskId: order[2], delta: -1 }, "notInQueue");
  });

  it("no queued task left on a body to plan", () => {
    let e = exp;
    for (const id of remainingQueue(exp, 0).slice(1)) e = edited(e, T0 + 10, { kind: "skip", taskId: id });
    refused(e, T0 + 10, { kind: "defaultPlan", bodyIndex: 0 }, "noTasks");
    refused(e, T0 + 10, { kind: "autoAssign", bodyIndex: 0 }, "noTasks");
  });

  it("every reason reads in plain words (no em dash, no double hyphen)", () => {
    const reasons: GroundOpsEditBlockReason[] = [
      "noExpedition",
      "notGroundOps",
      "runFinished",
      "noSuchTask",
      "taskDone",
      "taskSkipped",
      "notSkipped",
      "noSuchTeam",
      "noSuchBody",
      "noTasks",
      "notInQueue",
      "notEnoughSquads",
      "crewDoesNotCover",
      "noChange",
    ];
    for (const r of reasons) {
      const text = groundOpsEditBlockText(r);
      expect(text.length).toBeGreaterThan(5);
      expect(text).not.toMatch(/\u2014|-{2}/);
    }
  });
});

describe("GO-7d an edit applies FROM NOW", () => {
  it("the run is advanced to now first, the edit is counted, and nothing else moves", () => {
    const exp = oneTeamRun(["mineralOutcrop", "caveNetwork"], { securityStrength: 400 });
    const T = T0 + 1_234;
    const got = edited(exp, T, { kind: "setHelp", teamIndex: 0, on: true });
    const want = advanceExpedition(exp, T);
    want.groundOps!.teams[0].helpOthers = true;
    want.groundOps!.editCount = 1;
    expect(got).toEqual(want);
    // And the stored record is never mutated.
    expect(exp.groundOps!.editCount).toBe(0);
    expect(exp.groundOps!.teams[0].helpOthers).toBe(false);
  });
});

describe("GO-7d skip (an ACTIVE task stops at the edit instant; a fight finishes first)", () => {
  const exp = oneTeamRun(["crashedShip", "mineralOutcrop"], { securityStrength: 400 });
  const far = advanceExpedition(exp, FAR);
  const head = teams(exp)[0].taskId!;

  it("during WORK: the team stops now, keeps the interpolated progress, banks no partial segment, and takes its return trip", () => {
    const T = midOf(far, 0, "work", head);
    const before = advanceExpedition(exp, T);
    expect(teams(before)[0].step).toBe("work");
    const progress = groundTaskProgressAt(before, findGroundTask(before, head)!.task, T);
    const e = edited(exp, T, { kind: "skip", taskId: head });
    const task = findGroundTask(e, head)!.task;
    expect(task.status).toBe("skipped");
    expect(task.progress).toBeCloseTo(progress, 12);
    expect(task.progress).toBeGreaterThan(0);
    expect(task.segmentsBanked).toBe(findGroundTask(before, head)!.task.segmentsBanked);
    expect(teams(e)[0].queue).not.toContain(head);
    const team = teams(e)[0];
    expect(team).toMatchObject({ step: "return", stepStartedAt: T, stepEndsAt: T + RETURN_SECONDS });
    expect(historyOf(e).at(-1)).toMatchObject({ step: "work", taskId: head, endedAt: T, stopped: true });
    // Nothing of the cut segment is ever paid; the run finishes the other task and closes.
    const end = advanceExpedition(e, FAR);
    expect(findGroundTask(end, head)!.task).toMatchObject({ status: "skipped", segmentsBanked: task.segmentsBanked });
    expect(end.findings.filter((f) => f.id.startsWith(groundTaskFindingPrefix(end, head))).length).toBe(task.segmentsBanked! > 0 ? 1 : 0);
    expect(end.groundOps!.endedAt).toBeDefined();
    expect(tasksOf(end).find((t) => t.id !== head)!.done).toBe(true);
  });

  it("during DEPLOY: progress unchanged, the team heads back", () => {
    const T = T0 + 30; // the drop lasts DEPLOY_SECONDS from T0
    expect(teams(advanceExpedition(exp, T))[0].step).toBe("deploy");
    const e = edited(exp, T, { kind: "skip", taskId: head });
    expect(findGroundTask(e, head)!.task).toMatchObject({ status: "skipped", progress: 0 });
    expect(teams(e)[0]).toMatchObject({ step: "return", stepEndsAt: T + RETURN_SECONDS });
  });

  it("during a FIGHT: the edit waits for the fight's end (its result stands), then the team heads back", () => {
    const rec = historyOf(far).find((r) => r.step === "fight" && r.taskId === head && r.endedAt - r.startedAt >= 2)!;
    const T = rec.startedAt + 1;
    const before = advanceExpedition(exp, T);
    const e = edited(exp, T, { kind: "skip", taskId: head });
    expect(teams(e)[0]).toMatchObject({ step: "fight", stepEndsAt: rec.endedAt, recalled: true });
    expect(findGroundTask(e, head)!.task.status).toBe("skipped");
    const after = advanceExpedition(e, rec.endedAt);
    const fight = historyOf(after).find((r) => r.step === "fight" && r.startedAt === rec.startedAt)!;
    expect(fight).toMatchObject({ outcome: rec.outcome, stopped: true });
    expect(teams(after)[0].step).toBe("return");
    expect(teams(after)[0].recalled).toBeUndefined();
    const task = findGroundTask(after, head)!.task;
    expect(task.status).toBe("skipped");
    if (rec.outcome === "win") expect(task.pointsCleared).toBe((findGroundTask(before, head)!.task.pointsCleared ?? 0) + 1);
  });

  it("skipped mid-fight, then re-queued to the same crew before the fight ends: the crew simply carries on", () => {
    const rec = historyOf(far).find((r) => r.step === "fight" && r.taskId === head && r.outcome === "win" && r.endedAt - r.startedAt >= 3)!;
    const skipped = edited(exp, rec.startedAt + 1, { kind: "skip", taskId: head });
    const back = edited(skipped, rec.startedAt + 2, { kind: "requeue", taskId: head, teamIndex: 0, position: 0 });
    expect(teams(back)[0].recalled).toBeUndefined();
    expect(findGroundTask(back, head)!.task.status).toBe("active");
    const after = advanceExpedition(back, rec.endedAt);
    expect(teams(after)[0]).toMatchObject({ step: "work", taskId: head });
    // As if nothing had happened: the task finishes exactly when the unedited run finishes it.
    const end = advanceExpedition(back, FAR);
    expect(findGroundTask(end, head)!.task).toMatchObject({ done: true, completedAt: findGroundTask(far, head)!.task.completedAt });
    expect(historyOf(end).some((r) => r.stopped)).toBe(false);
  });
});

describe("GO-7d requeue resumes from the kept progress", () => {
  it("a skipped task re-queued later picks up where it stopped, and no segment is ever paid twice", () => {
    const exp = oneTeamRun(["crashedShip", "mineralOutcrop"], { securityStrength: 400 });
    const head = teams(exp)[0].taskId!;
    const far = advanceExpedition(exp, FAR);
    const T = midOf(far, 0, "work", head);
    const skipped = edited(exp, T, { kind: "skip", taskId: head });
    const kept = findGroundTask(skipped, head)!.task.progress!;
    const back = edited(skipped, T + 10, { kind: "requeue", taskId: head, teamIndex: 0 });
    expect(findGroundTask(back, head)!.task).toMatchObject({ status: "queued", assignedTeamIds: [0] });
    expect(remainingQueue(back, 0).at(-1)).toBe(head);
    const end = advanceExpedition(back, FAR);
    const task = findGroundTask(end, head)!.task;
    expect(task.done).toBe(true);
    // The first work step on it after the requeue starts from the kept progress.
    const work = historyOf(end).find((r) => r.step === "work" && r.taskId === head && r.startedAt > T)!;
    const mid = advanceExpedition(back, work.startedAt + 0.5);
    expect(teams(mid)[0].workFrom).toBe(kept);
    // Segments: each one offloaded exactly once across the task's batches.
    const segs = end.findings
      .filter((f) => f.id.startsWith(groundTaskFindingPrefix(end, head)))
      .flatMap((f) => {
        const [first, last] = f.id.split("-s").pop()!.split("-").map(Number);
        return Array.from({ length: last - first + 1 }, (_, k) => first + k);
      });
    expect(segs).toEqual(Array.from({ length: (task.fightPoints?.length ?? 0) + 1 }, (_, k) => k));
  });
});

describe("GO-7d reorder and assign", () => {
  it("reorder swaps neighbors in the team's remaining queue and never interrupts the current task", () => {
    const exp = oneTeamRun(["mineralOutcrop", "caveNetwork", "crashedShip"], { securityStrength: 400 });
    const T = T0 + 200;
    const before = advanceExpedition(exp, T);
    const order = remainingQueue(before, 0);
    const team = teams(before)[0];
    expect(team.taskId).toBe(order[0]);
    const e = edited(exp, T, { kind: "reorder", teamIndex: 0, taskId: order[2], delta: -1 });
    expect(remainingQueue(e, 0)).toEqual([order[0], order[2], order[1]]);
    // Moving the ACTIVE task down: the team keeps working it.
    const f = edited(e, T + 1, { kind: "reorder", teamIndex: 0, taskId: order[0], delta: 1 });
    expect(remainingQueue(f, 0)).toEqual([order[2], order[0], order[1]]);
    expect(teams(f)[0]).toMatchObject({ step: team.step, stepStartedAt: team.stepStartedAt, stepEndsAt: team.stepEndsAt, taskId: order[0] });
    expect(f.groundOps!.editCount).toBe(2);
  });

  it("assign moves a queued task into another team's queue at a position", () => {
    const exp = twoTeamRun(["ground", "ground"], ["mineralOutcrop", "caveNetwork", "crashedShip", "xenoFloraBloom", "ancientRuins"].map((poiId) => ({ poiId })), {
      securityStrength: 400,
    });
    const from0 = remainingQueue(exp, 0).find((id) => findGroundTask(exp, id)!.task.status === "queued")!;
    const e = edited(exp, T0 + 5, { kind: "assign", taskId: from0, teamIndex: 1, position: 0 });
    expect(teams(e)[0].queue).not.toContain(from0);
    expect(remainingQueue(e, 1)[0]).toBe(from0);
    expect(findGroundTask(e, from0)!.task.assignedTeamIds).toEqual([1]);
  });

  it("assign AWAY an active task stops its team now (progress kept) and the new team takes it from there", () => {
    const exp = twoTeamRun(["ground", "ground"], ["crashedShip", "mineralOutcrop", "caveNetwork"].map((poiId) => ({ poiId })), {
      securityStrength: 400,
    });
    const head = teams(exp)[0].taskId!;
    const far = advanceExpedition(exp, FAR);
    const T = midOf(far, 0, "work", head);
    const before = advanceExpedition(exp, T);
    const progress = groundTaskProgressAt(before, findGroundTask(before, head)!.task, T);
    const e = edited(exp, T, { kind: "assign", taskId: head, teamIndex: 1, position: 0 });
    const task = findGroundTask(e, head)!.task;
    expect(task.progress).toBeCloseTo(progress, 12);
    expect(task.assignedTeamIds).toEqual([1]);
    expect(teams(e)[0]).toMatchObject({ step: "return", stepStartedAt: T });
    // Team 1 takes it (now if idle, else when it next is) and finishes it; team 0 banked the early segments.
    const end = advanceExpedition(e, FAR);
    const done = findGroundTask(end, head)!.task;
    expect(done.done).toBe(true);
    expect(done.segmentBankers!.at(-1)).toEqual([1]);
    expect(end.groundOps!.endedAt).toBeDefined();
  });
});

describe("GO-7d Default plan and Auto-assign randomly", () => {
  const POIS = ["mineralOutcrop", "caveNetwork", "crashedShip", "xenoFloraBloom", "ancientRuins", "geothermalChamber", "buriedVault"];
  const exp = twoTeamRun(["ground", "ground"], POIS.map((poiId) => ({ poiId })), { securityStrength: 400 });
  const queuedIds = (e: Expedition) => tasksOf(e).filter((t) => t.status === "queued").map((t) => t.id);
  const signature = (e: Expedition) => [remainingQueue(e, 0), remainingQueue(e, 1)];

  it("auto-assign is deterministic for a given editCount, counts as an edit, and differs for the next one", () => {
    const T = T0 + 5;
    const a = edited(exp, T, { kind: "autoAssign", bodyIndex: 0 });
    const b = edited(structuredClone(exp), T, { kind: "autoAssign", bodyIndex: 0 });
    expect(a).toEqual(b);
    expect(a.groundOps!.editCount).toBe(1);
    // Every queued task sits in exactly one queue, assigned to that team (Ground teams each cover { 1, 1 } alone).
    for (const id of queuedIds(advanceExpedition(exp, T))) {
      const holders = teams(a).filter((t) => t.queue.includes(id)).map((t) => t.index);
      expect(holders.length).toBe(1);
      expect(findGroundTask(a, id)!.task.assignedTeamIds).toEqual(holders);
    }
    // The next edit draws on the next stream.
    const bumped = structuredClone(exp);
    bumped.groundOps!.editCount = 1;
    const c = edited(bumped, T, { kind: "autoAssign", bodyIndex: 0 });
    expect(signature(c)).not.toEqual(signature(a));
    expect(AUTO_ASSIGN_SALT % 2).toBe(1);
  });

  it("Default plan re-runs the plan over the body's queued tasks (the same result as planTasksForTeams)", () => {
    const T = T0 + 5;
    const scrambled = edited(exp, T, { kind: "autoAssign", bodyIndex: 0 });
    const planned = edited(scrambled, T, { kind: "defaultPlan", bodyIndex: 0 });
    const want = advanceExpedition(scrambled, T);
    const ids = new Set(queuedIds(want));
    for (const team of teams(want)) team.queue = team.queue.filter((id) => !ids.has(id));
    const refs: GroundTaskRef[] = [...ids].map((id) => findGroundTask(want, id)!).sort((x, y) => x.flatIndex - y.flatIndex);
    for (const ref of refs) delete ref.task.assignedTeamIds;
    planTasksForTeams(want, refs, T);
    want.groundOps!.editCount = 2;
    groundOpsAssignIdle(want, T);
    expect(planned).toEqual(advanceExpedition(want, T));
  });

  it("Default plan logs a task nobody deployed can cover (and skips it)", () => {
    const manualRun = twoTeamRun(["ground", "ground"], [{ poiId: "mineralOutcrop" }, { poiId: "caveNetwork" }, { poiId: "crashedShip" }], {
      securityStrength: 400,
      manual: (e) => {
        const [x, y, z] = tasksOf(e);
        teams(e)[0].queue = [x.id, z.id];
        teams(e)[1].queue = [y.id];
        x.assignedTeamIds = [0];
        y.assignedTeamIds = [1];
        z.assignedTeamIds = [0];
        z.needs = { security: 3, science: 0 }; // corrupted on purpose: more than both Ground teams bring
      },
    });
    const z = tasksOf(manualRun)[2].id;
    const e = edited(manualRun, T0 + 5, { kind: "defaultPlan", bodyIndex: 0 });
    expect(findGroundTask(e, z)!.task.status).toBe("skipped");
    const log = e.groundOps!.log!;
    expect(log.at(-1)).toMatchObject({ kind: "skippedNeedsSquads", taskId: z, at: T0 + 5 });
    expect(groundOpsLogText(e, log.at(-1)!)).toBe("Skipped Crashed Ship: needs 3 Security squads, 2 deployed");
    // And a requeue of it is refused: nobody deployed covers it.
    refused(e, T0 + 6, { kind: "requeue", taskId: z, teamIndex: 0 }, "notEnoughSquads");
  });
});

describe("GO-7d help toggle", () => {
  it("turning help on lets an idle team with nothing of its own borrow at once; the same value changes nothing", () => {
    const exp = twoTeamRun(["ground", "ground"], ["mineralOutcrop", "mineralOutcrop", "caveNetwork"].map((poiId) => ({ poiId })), {
      securityStrength: 400,
      manual: (e) => {
        teams(e)[0].queue = tasksOf(e).map((t) => t.id);
        for (const t of tasksOf(e)) t.assignedTeamIds = [0];
      },
    });
    expect(teams(exp)[1].step).toBe("idle");
    const e = edited(exp, T0 + 5, { kind: "setHelp", teamIndex: 1, on: true });
    expect(teams(e)[1]).toMatchObject({ helpOthers: true, step: "deploy", borrowed: true, stepStartedAt: T0 + 5 });
    refused(e, T0 + 6, { kind: "setHelp", teamIndex: 1, on: true }, "noChange");
  });
});

describe("GO-7d SKIP is the escape hatch for a stuck run (user: retry forever, skip by hand)", () => {
  it("a run of only unwinnable tasks reads stuck; skipping them lets the window close and the run come home", () => {
    const exp = oneTeamRun(["subterraneanCivilization", "derelictOutpost"], { members: LONER, securityStrength: 0, hazard: 0.9 });
    const T = T0 + 30_000;
    const stuck = advanceExpedition(exp, T);
    expect(groundOpsStuck(stuck)).toBe(true);
    expect(advanceExpedition(exp, FAR).groundOps!.endedAt).toBeUndefined();
    let e = exp;
    for (const t of tasksOf(stuck)) e = edited(e, T, { kind: "skip", taskId: t.id });
    expect(groundOpsStuck(e)).toBe(false);
    const end = advanceExpedition(e, FAR);
    expect(end.groundOps!.endedAt).toBeDefined();
    expect(end.phase).toBe("complete");
    expect(tasksOf(end).every((t) => t.status === "skipped")).toBe(true);
    const claim = claimExpedition({ ...freshState(), gameTimeSeconds: FAR, expeditions: [end] }, end.id);
    expect(claim.success).toBe(true);
  });
});

describe("GO-7d review: a recalled crew's loss, released stagers", () => {
  it("a RECALLED crew's fight loss leaves the task's loss streak and sentBack alone; the old crew still returns", () => {
    let found: { exp: Expedition; rec: GroundStepRecord; head: string } | null = null;
    for (let k = 0; k < 60 && !found; k += 1) {
      const exp = twoTeamRun(["ground", "ground"], [{ poiId: "crashedShip" }, { poiId: "mineralOutcrop" }], {
        securityStrength: 0,
        seed: (0x5eed0101 + k * 7919) >>> 0,
      });
      const head = teams(exp)[0].taskId!;
      // A loss that counts toward the streak unedited (the attempt cleared no new point).
      const rec = historyOf(advanceExpedition(exp, T0 + 20_000), 0).find(
        (r) =>
          r.step === "fight" &&
          r.taskId === head &&
          r.outcome === "loss" &&
          r.endedAt - r.startedAt >= 2 &&
          (findGroundTask(advanceExpedition(exp, r.endedAt), head)!.task.lossStreak ?? 0) >
            (findGroundTask(advanceExpedition(exp, r.startedAt + 1), head)!.task.lossStreak ?? 0),
      );
      if (rec) found = { exp, rec, head };
    }
    expect(found).not.toBeNull();
    const { exp, rec, head } = found!;
    const before = findGroundTask(advanceExpedition(exp, rec.startedAt + 1), head)!.task;
    // Unedited, this loss counts toward the streak.
    const plain = findGroundTask(advanceExpedition(exp, rec.endedAt), head)!.task;
    expect(plain.lossStreak ?? 0).toBeGreaterThan(before.lossStreak ?? 0);
    // Reassigned away mid-fight: the loss belongs to a crew that no longer holds the task, so it never counts.
    const e = edited(exp, rec.startedAt + 1, { kind: "assign", taskId: head, teamIndex: 1 });
    expect(teams(e)[0].recalled).toBe(true);
    const after = advanceExpedition(e, rec.endedAt);
    const task = findGroundTask(after, head)!.task;
    expect(task.lossStreak).toEqual(before.lossStreak);
    expect(task.sentBack).toEqual(before.sentBack);
    expect(task.status === "queued" || task.status === "active").toBe(true);
    expect(teams(after)[0].step).toBe("return");
    expect(historyOf(after, 0).find((r) => r.step === "fight" && r.startedAt === rec.startedAt)).toMatchObject({ outcome: "loss", stopped: true });
  });

  it("a skip that releases a staging team records the moment on its staging step (stopped)", () => {
    // Strike + Survey: Strike works a Security-only task while Survey stages alone on a joint one.
    const exp = twoTeamRun(["strike", "survey"], [{ poiId: "mineralOutcrop", needs: { security: 1, science: 0 } }, { poiId: "caveNetwork" }], {
      securityStrength: 400,
      manual: (e) => {
        const [solo, joint] = tasksOf(e);
        teams(e)[0].queue = [solo.id, joint.id];
        teams(e)[1].queue = [joint.id];
        solo.assignedTeamIds = [0];
        joint.assignedTeamIds = [0, 1];
      },
    });
    const joint = tasksOf(exp)[1].id;
    expect(teams(exp)[0].step).toBe("deploy");
    expect(teams(exp)[1]).toMatchObject({ step: "staging", taskId: joint, stepStartedAt: T0 });
    const e = edited(exp, T0 + 5, { kind: "skip", taskId: joint });
    expect(teams(e)[1].step).toBe("idle");
    expect(historyOf(e, 1).at(-1)).toMatchObject({ step: "staging", taskId: joint, startedAt: T0, endedAt: T0 + 5, stopped: true });
    // Released at the very instant it staged: still recorded (a zero-length step otherwise is not).
    const z = edited(exp, T0, { kind: "skip", taskId: joint });
    expect(historyOf(z, 1).at(-1)).toMatchObject({ step: "staging", taskId: joint, startedAt: T0, endedAt: T0, stopped: true });
  });
});

describe("GO-7d squads: a joint crew must still cover the task (never stages forever)", () => {
  // Strike + Survey: every { 1, 1 } task needs BOTH teams (a joint crew).
  const exp = twoTeamRun(["strike", "survey"], [{ poiId: "mineralOutcrop" }, { poiId: "caveNetwork" }, { poiId: "crashedShip" }], { securityStrength: 400 });

  it("the plan sent the pair; groundTaskCrews lists the smallest covering crews", () => {
    for (const t of tasksOf(exp)) expect(t.assignedTeamIds).toEqual([0, 1]);
    expect(groundTaskCrews(exp, tasksOf(exp)[0].id)).toEqual([[0, 1]]);
  });

  it("a reassignment that would break coverage is refused; the same crew with its partner is fine", () => {
    const queued = tasksOf(exp).find((t) => t.status === "queued")!;
    refused(exp, T0 + 5, { kind: "assign", taskId: queued.id, teamIndex: 0 }, "crewDoesNotCover");
    refused(exp, T0 + 5, { kind: "assign", taskId: queued.id, teamIndex: 1, position: 0 }, "crewDoesNotCover");
    const e = edited(exp, T0 + 5, { kind: "assign", taskId: queued.id, teamIndex: 0, partners: [1], position: 0 });
    expect(remainingQueue(e, 0)[0]).toBe(queued.id);
    expect(findGroundTask(e, queued.id)!.task.assignedTeamIds).toEqual([0, 1]);
  });

  it("skip the active joint task mid-work: both teams head back (the partner straight to its bay), the next task stages and runs", () => {
    const lead = teams(exp)[0];
    const head = lead.taskId!;
    expect(teams(exp)[1]).toMatchObject({ step: "staging", taskId: head });
    const far = advanceExpedition(exp, FAR);
    const T = midOf(far, 0, "work", head);
    const e = edited(exp, T, { kind: "skip", taskId: head });
    expect(teams(e)[0]).toMatchObject({ step: "return", stepStartedAt: T });
    expect(teams(e)[1]).toMatchObject({ step: "return", stepStartedAt: T, jointPartner: true });
    const end = advanceExpedition(e, FAR);
    expect(end.groundOps!.endedAt).toBeDefined();
    expect(tasksOf(end).filter((t) => t.id !== head).every((t) => t.done)).toBe(true);
    const partner = historyOf(end, 1).filter((r) => r.startedAt >= T);
    expect(partner[0]).toMatchObject({ step: "return" });
    expect(partner[1].step).not.toBe("offload");
    // A requeue needs the whole crew: alone it is refused, with its partner it runs to the end.
    const late = end.groundOps!.endedAt! - 1;
    const mid = advanceExpedition(e, late);
    refused(e, late, { kind: "requeue", taskId: head, teamIndex: 0 }, "crewDoesNotCover");
    expect(mid.groundOps!.endedAt).toBeUndefined();
    const back = edited(e, late, { kind: "requeue", taskId: head, teamIndex: 0, partners: [1] });
    const fin = advanceExpedition(back, FAR);
    expect(findGroundTask(fin, head)!.task.done).toBe(true);
    expect(fin.groundOps!.endedAt).toBeDefined();
  });

  it("a Survey-only task cannot go to the Strike team alone; a clearing-style task cannot go to Survey", () => {
    const run = twoTeamRun(["strike", "survey"], [
      { poiId: "mineralOutcrop", needs: { security: 1, science: 0 } },
      { poiId: "caveNetwork", needs: { security: 0, science: 1 } },
      { poiId: "crashedShip" },
    ], { securityStrength: 400 });
    const [clear, survey] = tasksOf(run);
    // Stamping floors a fight-point task at 1 Security squad; the Science-only task keeps { 1, 1 } (it has fights).
    expect(clear.assignedTeamIds).toEqual([0]);
    refused(run, T0 + 5, { kind: "assign", taskId: clear.id, teamIndex: 1 }, "crewDoesNotCover");
    expect(groundTaskCrews(run, clear.id)).toEqual([[0]]);
    expect(groundTaskCrews(run, survey.id)).toEqual([[0, 1]]);
  });
});

describe("GO-7d EDIT PARITY: one call to T + edit + one call to the end == chunks to T + edit + chunks to the end", () => {
  interface Step {
    at: number;
    edit: (e: Expedition) => GroundOpsEdit;
  }
  function play(exp: Expedition, steps: Step[], end: number, chunk: number | null): Expedition {
    let cur = exp;
    let last = T0;
    for (const step of steps) {
      if (chunk !== null) for (let t = last + chunk; t < step.at; t += chunk) cur = advanceExpedition(cur, t);
      cur = edited(cur, step.at, step.edit(advanceExpedition(cur, step.at)));
      last = step.at;
    }
    if (chunk !== null) for (let t = last + chunk; t < end; t += chunk) cur = advanceExpedition(cur, t);
    return advanceExpedition(cur, end);
  }

  it("one team: skip the active task mid-work, reorder, requeue, auto-assign", { timeout: 120_000 }, () => {
    const exp = oneTeamRun(["crashedShip", "mineralOutcrop", "caveNetwork", "ancientRuins"], { securityStrength: 6 });
    const far = advanceExpedition(exp, FAR);
    const head = teams(exp)[0].taskId!;
    const T1 = midOf(far, 0, "work", head);
    const steps: Step[] = [
      { at: T1, edit: () => ({ kind: "skip", taskId: head }) },
      { at: T1 + 31, edit: () => ({ kind: "autoAssign", bodyIndex: 0 }) },
      { at: T1 + 500, edit: (e) => ({ kind: "reorder", teamIndex: 0, taskId: remainingQueue(e, 0).at(-1)!, delta: -1 }) },
      { at: T1 + 2_003, edit: () => ({ kind: "requeue", taskId: head, teamIndex: 0 }) },
    ];
    const END = T1 + 60_000;
    const big = play(exp, steps, END, null);
    expect(play(exp, steps, END, 997)).toEqual(big);
    expect(big.groundOps!.editCount).toBe(4);
    // The scenario: the skip cut a work step, and the re-queued task was worked again after it.
    expect(historyOf(big).some((r) => r.stopped && r.step === "work" && r.taskId === head)).toBe(true);
    expect(historyOf(big).some((r) => r.step === "work" && r.taskId === head && r.startedAt > T1 + 2_003)).toBe(true);
  });

  it("one team, the same edits over 2 h: one call == 997 s chunks == 1 s chunks", { timeout: 180_000 }, () => {
    const exp = oneTeamRun(["crashedShip", "mineralOutcrop", "caveNetwork", "ancientRuins"], { securityStrength: 6 });
    const far = advanceExpedition(exp, FAR);
    const head = teams(exp)[0].taskId!;
    const T1 = midOf(far, 0, "work", head);
    const steps: Step[] = [
      { at: T1, edit: () => ({ kind: "skip", taskId: head }) },
      { at: T1 + 31, edit: () => ({ kind: "autoAssign", bodyIndex: 0 }) },
      { at: T1 + 500, edit: (e) => ({ kind: "reorder", teamIndex: 0, taskId: remainingQueue(e, 0).at(-1)!, delta: -1 }) },
      { at: T1 + 2_003, edit: () => ({ kind: "requeue", taskId: head, teamIndex: 0 }) },
    ];
    const END = T1 + 7_200;
    const big = play(exp, steps, END, null);
    expect(play(exp, steps, END, 997)).toEqual(big);
    expect(play(exp, steps, END, 1)).toEqual(big);
    expect(historyOf(big).some((r) => r.step === "work" && r.taskId === head && r.startedAt > T1 + 2_003)).toBe(true);
  });

  it("a REAL dispatched run edited while the ship still scans (and once in transit)", { timeout: 120_000 }, () => {
    const SQ: AwayMember[] = [member("member-1", "security", { rank: 3 }), member("member-2", "security", { rank: 2, traits: ["fieldMedic"] }), member("member-11", "science")];
    const s = withSlottedAwayTeams({ ...freshState(), awayMembers: SQ.map((m) => ({ ...m })), nextAwayMemberId: 100, expeditionSeed: 0x0a13bd4 });
    const res = asPreCurveDispatch(startExpedition(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id));
    const exp = res.expedition!;
    // In transit: only the help toggle has anything to change.
    const inTransit = edited(exp, 10, { kind: "setHelp", teamIndex: 0, on: true });
    expect(inTransit.phase).toBe("transit");
    expect(teams(inTransit)[0].helpOthers).toBe(true);
    // A moment while the ship scans and the team works a scanned body.
    let T = 0;
    for (let t = 600; t < 200_000; t += 300) {
      const at = advanceExpedition(exp, t);
      if (at.phase === "scanning" && teams(at)[0].step === "work") {
        T = t;
        break;
      }
    }
    expect(T).toBeGreaterThan(0);
    const on = teams(advanceExpedition(exp, T))[0].taskId!;
    const steps: Step[] = [
      { at: T, edit: () => ({ kind: "skip", taskId: on }) },
      { at: T + 1_501, edit: () => ({ kind: "requeue", taskId: on, teamIndex: 0 }) },
    ];
    const END = T + 30_000;
    let big: Expedition = exp;
    let chunked: Expedition = exp;
    let last = 0;
    for (const step of steps) {
      big = edited(big, step.at, step.edit(big));
      for (let t = last + 997; t < step.at; t += 997) chunked = advanceExpedition(chunked, t);
      chunked = edited(chunked, step.at, step.edit(chunked));
      last = step.at;
    }
    big = advanceExpedition(big, END);
    for (let t = last + 997; t < END; t += 997) chunked = advanceExpedition(chunked, t);
    expect(advanceExpedition(chunked, END)).toEqual(big);
    expect(historyOf(big).some((r) => r.stopped && r.taskId === on)).toBe(true);
  });

  it("Strike + Survey: skip a joint task mid-work, Default plan, requeue with the partner", { timeout: 120_000 }, () => {
    const exp = twoTeamRun(["strike", "survey"], [
      { poiId: "crashedShip" },
      { poiId: "mineralOutcrop", needs: { security: 1, science: 0 } },
      { poiId: "caveNetwork" },
      { poiId: "derelictOutpost" },
    ], { securityStrength: 3, help: [true, true] });
    const far = advanceExpedition(exp, FAR);
    const head = teams(exp)[0].taskId!;
    const T1 = midOf(far, 0, "work", head);
    const steps: Step[] = [
      { at: T1, edit: () => ({ kind: "skip", taskId: head }) },
      { at: T1 + 777, edit: () => ({ kind: "defaultPlan", bodyIndex: 0 }) },
      { at: T1 + 3_001, edit: () => ({ kind: "requeue", taskId: head, teamIndex: 1, partners: [0] }) },
      { at: T1 + 3_002, edit: () => ({ kind: "setHelp", teamIndex: 1, on: false }) },
    ];
    const END = T1 + 60_000;
    const big = play(exp, steps, END, null);
    expect(play(exp, steps, END, 997)).toEqual(big);
    expect(big.groundOps!.editCount).toBe(4);
    // The scenario: both crew teams were stopped by the skip, and the re-queued joint task went back to the pair.
    expect(historyOf(big, 0).some((r) => r.stopped && r.taskId === head)).toBe(true);
    expect(historyOf(big, 1).some((r) => r.startedAt === T1 && r.step === "return")).toBe(true);
    expect(findGroundTask(big, head)!.task.assignedTeamIds).toEqual([0, 1]);
    expect(findGroundTask(big, head)!.task.status).not.toBe("skipped");
  });
});
