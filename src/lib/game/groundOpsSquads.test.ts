// Squads SQ-3 (docs/plans/2026-10-12-squads-and-subspace-telescope-design.md section 3): tasks state their NEEDS in
// squads (requiredTeams N carries forward as { N, N }), a task's CREW is the smallest set of deployed teams whose
// squads cover them, fights field every Security squad of the crew and fieldwork every Science squad, helpers
// borrow only what they cover alone, the crew layer splits per SQUAD, a task nobody deployed can cover is skipped
// at planning (never planned: no softlock, user), ONE SHARED PICKUP when a crew wipes together (user), one offload
// per joint crew, and the SURVEY AMBUSH (user #5: a crew with no Security squad retreats with light injuries).
// Real hull (General Freighter, 3 / 3 squads, 2 teams) with the team kinds written straight into the slots.

import { describe, expect, it } from "vitest";
import {
  freshState,
  type AwayMember,
  type Expedition,
  type ExpeditionActivity,
  type ExpeditionBody,
  type GameState,
  type GroundStepRecord,
  type GroundTaskNeeds,
  type GroundTeamKind,
  type GroundTeamRun,
  type ShipGroundTeam,
} from "./model";
import { advanceExpedition, expeditionCandidates, startExpedition } from "./expedition";
import {
  DEPLOY_SECONDS,
  IN_SYSTEM_LEG_SECONDS,
  RETURN_SECONDS,
  SURVEY_AMBUSH_CHANCE,
  SURVEY_AMBUSH_CONDITIONS,
  SURVEY_AMBUSH_MAX_PER_TASK,
  groundOpsAssignIdle,
  groundOpsBodyScanned,
  groundOpsLogText,
  groundTaskAmbushChance,
  groundTaskFindingPrefix,
  initGroundTasks,
  snapshotGroundOps,
  squadsCover,
  taskNeedsOf,
  teamSquadsOf,
} from "./groundOps";
import { deployableGroundTeams } from "./groundTeams";
import { taskFieldworkRun, taskFullHaul, taskWorkSeconds } from "./groundTasks";
import { plainAwayMember } from "./awayTeamTestFixtures";

// ===== fixtures =====

const T0 = 100_000;
const FAR = T0 + 400_000;

const member = (id: string, teamType: AwayMember["teamType"], over: Partial<AwayMember> = {}): AwayMember => ({
  ...plainAwayMember(id, teamType, "ship-1"),
  ...over,
});
const SEC = ["member-1", "member-2", "member-3", "member-4", "member-5", "member-6"];
const SCI = ["member-11", "member-12", "member-13", "member-14", "member-15", "member-16"];
const CREW: AwayMember[] = [
  ...SEC.map((id, k) => member(id, "security", { spec: k % 2 === 0 ? "offense" : "defense", rank: 3 })),
  ...SCI.map((id) => member(id, "science", { rank: 2 })),
];

// The 3 slots of one squad on the 3 / 3 freighter: two members and an open slot.
const squad = (pool: string[]): (string | null)[] => [...pool.splice(0, 2), null];

// A ship of the given composition, members taken in id order: Strike = 2 Security squads of 2, Survey = 2
// Science squads of 2, Ground = 2 Security + 2 Science (one squad each).
function compState(kinds: [GroundTeamKind, GroundTeamKind], help: [boolean, boolean] = [false, false]): GameState {
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

interface TaskSpec {
  poiId: string;
  needs?: GroundTaskNeeds; // content needs (stamped through initGroundTasks)
  // A SURVEY-ONLY task, pre-stamped with no fight points (the risk-aware generation of SQ-4 makes them; today's
  // content always holds at least one), its needs and its ambush chance.
  survey?: { needs: GroundTaskNeeds; ambushChance?: number };
}

interface Setup {
  kinds: [GroundTeamKind, GroundTeamKind];
  tasks: TaskSpec[];
  hazard?: number;
  seed?: number;
  securityStrength?: number;
  help?: [boolean, boolean];
  scanning?: boolean; // a second, huge body is still being scanned (legs pause it)
  manual?: (e: Expedition) => void; // hand-made queues instead of the default plan
}

function surveyTask(id: string, poiId: string, needs: GroundTaskNeeds, ambushChance?: number): ExpeditionActivity {
  return {
    id,
    bodyId: "body-1",
    poiId,
    done: false,
    needs: { ...needs },
    ...(ambushChance !== undefined ? { ambushChance } : {}),
    fightPoints: [],
    progress: 0,
    pointsCleared: 0,
    segmentsBanked: 0,
    segmentsOffloaded: 0,
    fightCount: 0,
    status: "queued",
  };
}

// A dispatched run of the composition turned into a hand-built run whose window opened at T0 with body 0 scanned
// and its tasks planned (or hand-queued): the moment a body completes in a real run.
function squadRun(setup: Setup): Expedition {
  const s = compState(setup.kinds, setup.help);
  const res = startExpedition(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id);
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  const d = res.expedition;
  const body: ExpeditionBody = {
    id: "body-1",
    planetType: "terrestrial",
    scanTotal: 100,
    scanProgress: 100,
    hazard: setup.hazard ?? 0.2,
    scanned: true,
    discoveries: setup.tasks.map((t, k) => ({ id: `${d.id}-body-1-disc-${k}`, kind: "landmark", poiId: t.poiId })),
    activities: setup.tasks.map((t, k) => {
      const id = `${d.id}-body-1-act-${k}`;
      if (t.survey) return surveyTask(id, t.poiId, t.survey.needs, t.survey.ambushChance);
      return { id, bodyId: "body-1", poiId: t.poiId, done: false, ...(t.needs ? { needs: { ...t.needs } } : {}) };
    }),
  };
  const bodies: ExpeditionBody[] = [body];
  if (setup.scanning) {
    bodies.push({ id: "body-2", planetType: "terrestrial", scanTotal: 1e9, scanProgress: 0, hazard: 0.1, scanned: false, discoveries: [], activities: [] });
  }
  const exp: Expedition = structuredClone({
    ...d,
    seed: setup.seed ?? d.seed,
    ...(setup.securityStrength !== undefined ? { securityStrength: setup.securityStrength } : {}),
    phase: setup.scanning ? "scanning" : "activities",
    phaseAnchorSeconds: T0,
    bodies,
    scanStepCursor: Math.max(0, (d.encounterSteps ?? 1) - 1),
    groundOps: { ...d.groundOps!, startedAt: T0 },
  });
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
const tasksOf = (e: Expedition) => e.bodies[0].activities;
const historyOf = (e: Expedition, i: number): GroundStepRecord[] => e.groundOps!.history.filter((r) => r.teamIndex === i);
function own(e: Expedition, queues: number[][]): void {
  const acts = tasksOf(e);
  queues.forEach((ks, i) => {
    teams(e)[i].queue = ks.map((k) => acts[k].id);
    for (const k of ks) acts[k].assignedTeamIds = [...(acts[k].assignedTeamIds ?? []), teams(e)[i].index].sort((a, b) => a - b);
  });
}

// ===== needs =====

describe("SQ-3 task needs (design 3.2)", () => {
  it("taskNeedsOf: stored needs (whole squads >= 0) win; requiredTeams N carries forward as { N, N }; else one Ground team's worth", () => {
    expect(taskNeedsOf({ needs: { security: 2, science: 0 } })).toEqual({ security: 2, science: 0 });
    expect(taskNeedsOf({ needs: { security: 0, science: 1 }, requiredTeams: 3 })).toEqual({ security: 0, science: 1 });
    expect(taskNeedsOf({ requiredTeams: 2 })).toEqual({ security: 2, science: 2 });
    expect(taskNeedsOf({})).toEqual({ security: 1, science: 1 });
    for (const bad of [{ security: -1, science: 1 }, { security: 1.5, science: 1 }, { security: Number.NaN, science: 0 }]) {
      expect(taskNeedsOf({ needs: bad as GroundTaskNeeds, requiredTeams: 2 })).toEqual({ security: 2, science: 2 });
    }
    for (const bad of [0, -1, 1.5, Number.NaN]) expect(taskNeedsOf({ requiredTeams: bad })).toEqual({ security: 1, science: 1 });
  });

  it("team squads by kind (absent = Ground, a pre-SQ-3 run) and coverage", () => {
    expect(teamSquadsOf({})).toEqual({ security: 1, science: 1 });
    expect(teamSquadsOf({ kind: "strike" })).toEqual({ security: 2, science: 0 });
    expect(teamSquadsOf({ kind: "survey" })).toEqual({ security: 0, science: 2 });
    expect(teamSquadsOf({ kind: "bogus" as GroundTeamKind })).toEqual({ security: 1, science: 1 });
    expect(squadsCover({ security: 2, science: 0 }, { security: 1, science: 0 })).toBe(true);
    expect(squadsCover({ security: 2, science: 0 }, { security: 1, science: 1 })).toBe(false);
    expect(squadsCover({ security: 3, science: 1 }, { security: 3, science: 1 })).toBe(true);
  });

  it("stamping writes needs (no requiredTeams); content needs are kept; a task with fight points always needs Security", () => {
    const e = squadRun({
      kinds: ["ground", "ground"],
      tasks: [{ poiId: "mineralOutcrop" }, { poiId: "crashedShip", needs: { security: 2, science: 0 } }, { poiId: "caveNetwork", needs: { security: 0, science: 1 } }],
    });
    const [plain, clearing, floored] = tasksOf(e);
    expect(plain.needs).toEqual({ security: 1, science: 1 });
    expect("requiredTeams" in plain).toBe(false);
    expect(clearing.needs).toEqual({ security: 2, science: 0 });
    expect(floored.fightPoints!.length).toBeGreaterThan(0);
    expect(floored.needs).toEqual({ security: 1, science: 1 });
    // The ambush hook is wired at 0 until the risk factors land (SQ-4): nothing is stamped.
    expect(SURVEY_AMBUSH_CHANCE).toBe(0);
    expect(groundTaskAmbushChance({ fightPoints: [] })).toBe(0);
    expect(groundTaskAmbushChance({ fightPoints: [0.5] })).toBe(0);
    for (const task of tasksOf(e)) expect("ambushChance" in task).toBe(false);
  });
});

// ===== the snapshot =====

describe("SQ-3 the dispatch snapshot: team kinds and the crew layer split per SQUAD (design 3.4)", () => {
  const snap = (kinds: [GroundTeamKind, GroundTeamKind]) => {
    const s = compState(kinds);
    expect(deployableGroundTeams(s, "ship-1").ok).toBe(true);
    return snapshotGroundOps(s, s.ships[0], {});
  };

  it("Strike + Survey: the Strike team carries both Security shares and no Science share", () => {
    const sn = snap(["strike", "survey"]);
    expect(sn.teams.map((t) => [t.index, t.kind, t.securityIds, t.scienceIds])).toEqual([
      [0, "strike", ["member-1", "member-2", "member-3", "member-4"], []],
      [1, "survey", [], ["member-11", "member-12", "member-13", "member-14"]],
    ]);
    expect(sn.factors.securityShare).toEqual([1, 0]);
    expect(sn.factors.scienceShare).toEqual([0, 1]);
  });

  it("Strike + Ground: 2 of 3 Security squads and none of the Science; Ground + Ground halves", () => {
    const sg = snap(["strike", "ground"]);
    expect(sg.factors.securityShare).toEqual([2 / 3, 1 / 3]);
    expect(sg.factors.scienceShare).toEqual([0, 1]);
    const gg = snap(["ground", "ground"]);
    expect(gg.factors.securityShare).toEqual([0.5, 0.5]);
    expect(gg.factors.scienceShare).toEqual([0.5, 0.5]);
  });
});

// ===== crew planning =====

describe("SQ-3 crew planning: the smallest set of deployed teams covering the needs (design 3.3)", () => {
  it("Strike + Survey: a { 1, 1 } task needs the PAIR; a clearing task goes to Strike alone; a survey-only task to Survey alone", () => {
    const e = squadRun({
      kinds: ["strike", "survey"],
      securityStrength: 400,
      tasks: [
        { poiId: "mineralOutcrop" },
        { poiId: "crashedShip", needs: { security: 2, science: 0 } },
        { poiId: "ancientRuins", survey: { needs: { security: 0, science: 1 } } },
      ],
    });
    const [joint, clearing, survey] = tasksOf(e);
    expect(joint.assignedTeamIds).toEqual([0, 1]);
    expect(clearing.assignedTeamIds).toEqual([0]);
    expect(survey.assignedTeamIds).toEqual([1]);
    expect(teams(e)[0].queue).toEqual(expect.arrayContaining([joint.id, clearing.id]));
    expect(teams(e)[1].queue).toEqual(expect.arrayContaining([joint.id, survey.id]));
    expect(teams(e)[0].queue).not.toContain(survey.id);
    expect(teams(e)[1].queue).not.toContain(clearing.id);
    // Run to the end: everything gets done, the window closes.
    const done = advanceExpedition(e, FAR);
    expect(tasksOf(done).every((t) => t.status === "done")).toBe(true);
    expect(done.groundOps!.endedAt).toBeDefined();
  });

  it("Strike + Ground: a { 1, 1 } task goes to Ground ALONE (the smallest crew); { 3, 1 } and { 2, 1 } need both", () => {
    const e = squadRun({
      kinds: ["strike", "ground"],
      securityStrength: 400,
      tasks: [
        { poiId: "mineralOutcrop" },
        { poiId: "crashedShip", needs: { security: 3, science: 1 } },
        { poiId: "derelictOutpost", needs: { security: 2, science: 1 } },
        { poiId: "geothermalChamber", needs: { security: 2, science: 0 } },
      ],
    });
    const [solo, big, mid, clearing] = tasksOf(e);
    expect(solo.assignedTeamIds).toEqual([1]);
    expect(big.assignedTeamIds).toEqual([0, 1]);
    expect(mid.assignedTeamIds).toEqual([0, 1]);
    expect(clearing.assignedTeamIds).toEqual([0]);
  });

  it("a task NOBODY deployed can cover is skipped at planning with a needs-based log line (never planned: no softlock)", () => {
    const e = squadRun({
      kinds: ["strike", "survey"],
      securityStrength: 400,
      tasks: [{ poiId: "crashedShip", needs: { security: 3, science: 0 } }, { poiId: "derelictOutpost", needs: { security: 3, science: 3 } }, { poiId: "mineralOutcrop" }],
    });
    const [fort, both, ok] = tasksOf(e);
    expect(fort.status).toBe("skipped");
    expect(both.status).toBe("skipped");
    expect(teams(e).some((t) => t.queue.includes(fort.id) || t.queue.includes(both.id))).toBe(false);
    expect(ok.status).toBe("active");
    expect(e.groundOps!.log).toEqual([
      { at: T0, kind: "skippedNeedsSquads", taskId: fort.id, needs: { security: 3, science: 0 }, deployed: { security: 2, science: 2 } },
      { at: T0, kind: "skippedNeedsSquads", taskId: both.id, needs: { security: 3, science: 3 }, deployed: { security: 2, science: 2 } },
    ]);
    expect(groundOpsLogText(e, e.groundOps!.log![0])).toBe("Skipped Crashed Ship: needs 3 Security squads, 2 deployed");
    expect(groundOpsLogText(e, e.groundOps!.log![1])).toBe("Skipped Derelict Outpost: needs 3 Security squads, 2 deployed; 3 Science squads, 2 deployed");
    // The GO-7c line (a run planned before SQ-3) still reads.
    expect(groundOpsLogText(e, { at: T0, kind: "skippedNeedsTeams", taskId: ok.id, requiredTeams: 4, deployedTeams: 2 })).toBe(
      "Skipped Mineral Outcrop: needs 4 ground teams, 2 deployed",
    );
  });
});

// ===== fights, fieldwork, the single offload =====

describe("SQ-3 a joint crew: fights field every Security squad, fieldwork every Science squad, ONE completion, ONE offload", () => {
  it("Strike + Survey on a { 1, 1 } task: Strike fights, Survey works, the task completes and pays once, only the lead offloads", () => {
    const e = squadRun({ kinds: ["strike", "survey"], securityStrength: 400, tasks: [{ poiId: "crashedShip" }] });
    const [task0] = tasksOf(e);
    expect(teams(e)[0]).toMatchObject({ step: "deploy", taskId: task0.id, stepEndsAt: T0 + DEPLOY_SECONDS });
    expect(teams(e)[1]).toMatchObject({ step: "staging", taskId: task0.id });
    // The work time is the Survey team's fieldwork (the Strike team brings none).
    const ops = e.groundOps!;
    const work = (i: number) => ({ ...teams(e)[i], scienceShare: ops.factors.scienceShare[i] });
    const full = taskWorkSeconds(e, [work(0), work(1)], e.bodies[0]);
    expect(taskFieldworkRun(e, [work(0), work(1)]).roster!.science.map((m) => m.memberId)).toEqual(["member-11", "member-12", "member-13", "member-14"]);
    expect(taskFieldworkRun(e, [work(0)]).roster!.science).toEqual([]);
    const done = advanceExpedition(e, FAR);
    const task = tasksOf(done)[0];
    expect(task).toMatchObject({ status: "done", done: true });
    const lead = historyOf(done, 0).filter((r) => r.taskId === task.id);
    const partner = historyOf(done, 1).filter((r) => r.taskId === task.id);
    const w = lead.find((r) => r.step === "work")!;
    expect(w.endedAt - w.startedAt).toBe(Math.max(1, Math.round(task.fightPoints![0] * full)));
    // ONE offload (the lead's); the partner goes from its return straight to its own bay / reload.
    expect(lead.filter((r) => r.step === "offload").length).toBe(1);
    expect(partner.filter((r) => r.step === "offload")).toEqual([]);
    const ret = partner.find((r) => r.step === "return")!;
    const after = partner.find((r) => r.startedAt === ret.endedAt)!;
    expect(["bay", "reload"]).toContain(after.step);
    // Pays ONCE: the batches sum to the full haul at the crew's yield, and exactly one batch carries the relic key.
    const found = done.findings.filter((f) => f.id.startsWith(groundTaskFindingPrefix(done, task.id)));
    const haul = taskFullHaul(e, [work(0), work(1)], e.bodies[0], task.poiId, 0);
    const sum: Record<string, number> = {};
    for (const f of found) for (const [k, v] of Object.entries(f.materials ?? {})) sum[k] = (sum[k] ?? 0) + v;
    expect(sum).toEqual(haul.materials);
    expect(found.reduce((a, f) => a + (f.credits ?? 0), 0)).toBe(haul.credits);
    expect(found.filter((f) => "relic" in f).length).toBe(1);
    expect(task.segmentBankers!.every((ids) => ids.join(",") === "0,1")).toBe(true);
  });

  it("Strike + Ground on a { 3, 1 } task: one fight side fields all three Security squads", () => {
    const e = squadRun({ kinds: ["strike", "ground"], securityStrength: 400, tasks: [{ poiId: "crashedShip", needs: { security: 3, science: 1 } }] });
    const done = advanceExpedition(e, FAR);
    const fight = historyOf(done, 0).find((r) => r.step === "fight")!;
    const mid = advanceExpedition(e, fight.startedAt + 0.5);
    const rec = teams(mid)[0].pendingFight!;
    expect([...Object.keys(rec.memberEnd), ...rec.downedMemberIds].sort()).toEqual(["member-1", "member-2", "member-3", "member-4", "member-5", "member-6"]);
  });
});

// ===== helpers =====

describe("SQ-3 helpers borrow only tasks they cover ALONE (design 3.3)", () => {
  it("a Strike helper takes the owner's clearing task but never its { 1, 1 } task", () => {
    const e = squadRun({
      kinds: ["strike", "ground"],
      securityStrength: 400,
      help: [true, false],
      tasks: [{ poiId: "mineralOutcrop" }, { poiId: "mineralOutcrop" }, { poiId: "mineralOutcrop", needs: { security: 1, science: 0 } }],
      manual: (x) => own(x, [[], [0, 1, 2]]),
    });
    const [, second, clearing] = tasksOf(e);
    expect(teams(e)[1]).toMatchObject({ step: "deploy", taskId: tasksOf(e)[0].id });
    expect(teams(e)[0]).toMatchObject({ step: "deploy", taskId: clearing.id, borrowed: true });
    expect(second.status).toBe("queued");
    const done = advanceExpedition(e, FAR);
    const borrowed = historyOf(done, 0).filter((r) => r.step === "deploy").map((r) => r.taskId);
    expect(borrowed).toEqual([clearing.id]);
    expect(tasksOf(done).every((t) => t.status === "done")).toBe(true);
  });
});

// ===== the wipe guard and the shared pickup =====

describe("SQ-3 wipes: never on an empty Security list; ONE SHARED PICKUP for a crew wiped together (user)", () => {
  it("a team with NO Security member that loses is never a wipe (no recovery leg): it shuttles up on its own", () => {
    // A Survey team forced onto a fight task (planning never does this; the guard holds anyway).
    const e = squadRun({ kinds: ["strike", "survey"], tasks: [{ poiId: "mineralOutcrop" }], scanning: true, manual: (x) => own(x, [[], [0]]) });
    expect(teams(e)[1]).toMatchObject({ step: "deploy" });
    const done = advanceExpedition(e, T0 + 2_000);
    const loss = historyOf(done, 1).find((r) => r.step === "fight" && r.outcome === "loss")!;
    expect(loss).toBeDefined();
    expect(done.groundOps!.shipLegs).toEqual([]);
    const ret = historyOf(done, 1).find((r) => r.step === "return" && r.startedAt === loss.endedAt)!;
    expect(ret.endedAt - ret.startedAt).toBe(RETURN_SECONDS);
    expect(ret.recovered).toBeUndefined();
  });

  it("Strike + Survey: the crew's Security all down = the whole crew waits for ONE leg that picks up both teams", () => {
    const e = squadRun({
      kinds: ["strike", "survey"],
      securityStrength: 0,
      hazard: 0.9,
      scanning: true,
      tasks: [{ poiId: "subterraneanCivilization" }],
    });
    const first = advanceExpedition(e, T0 + 3_000);
    const loss = historyOf(first, 0).find((r) => r.step === "fight" && r.outcome === "loss")!;
    const at = advanceExpedition(e, loss.endedAt);
    expect(at.groundOps!.shipLegs).toEqual([
      {
        kind: "recovery",
        teamIndex: 0,
        teamIndices: [0, 1],
        bodyIndex: 0,
        scanBodyIndex: 1,
        startsAt: loss.endedAt,
        arrivesAt: loss.endedAt + IN_SYSTEM_LEG_SECONDS,
        endsAt: loss.endedAt + 2 * IN_SYSTEM_LEG_SECONDS,
      },
    ]);
    const leg = at.groundOps!.shipLegs[0];
    for (const i of [0, 1]) expect(teams(at)[i]).toMatchObject({ step: "return", stepEndsAt: leg.arrivesAt });
    const later = advanceExpedition(e, leg.endsAt + 1);
    for (const i of [0, 1]) {
      expect(historyOf(later, i).find((r) => r.step === "return" && r.startedAt === loss.endedAt)).toMatchObject({ endedAt: leg.arrivesAt, recovered: true });
    }
  });

  it("Ground + Ground on a { 2, 2 } task wiped together: ONE leg for both (replaces GO-7c's leg per team)", () => {
    const e = squadRun({
      kinds: ["ground", "ground"],
      securityStrength: 0,
      hazard: 0.9,
      tasks: [{ poiId: "subterraneanCivilization", needs: { security: 2, science: 2 } }],
    });
    const first = advanceExpedition(e, T0 + 3_000);
    const loss = historyOf(first, 0).find((r) => r.step === "fight" && r.outcome === "loss")!;
    const at = advanceExpedition(e, loss.endedAt);
    expect(at.groundOps!.shipLegs.map((l) => [l.teamIndex, l.teamIndices, l.startsAt, l.scanBodyIndex])).toEqual([[0, [0, 1], loss.endedAt, null]]);
    expect(tasksOf(at)[0]).toMatchObject({ status: "queued", lossStreak: 1 });
  });
});

// ===== the Survey ambush =====

describe("SQ-3 the SURVEY AMBUSH (user #5): a crew with no Security squad retreats with light injuries", () => {
  const ambushRun = (chance: number | undefined, kinds: [GroundTeamKind, GroundTeamKind] = ["strike", "survey"], who = 1) =>
    squadRun({
      kinds,
      tasks: [{ poiId: "ancientRuins", survey: { needs: { security: 0, science: 1 }, ambushChance: chance } }],
      manual: (x) => own(x, who === 1 ? [[], [0]] : [[0], []]),
    });

  it("an ambush cuts the work step short: no fight, progress kept, no haul, light injuries, an ordinary return, then they come back", () => {
    const e = ambushRun(1);
    const done = advanceExpedition(e, FAR);
    const task = tasksOf(done)[0];
    const lane = historyOf(done, 1);
    const works = lane.filter((r) => r.step === "work");
    // At most SURVEY_AMBUSH_MAX_PER_TASK ambushes (a cap, so a task can never be ambushed forever), then it finishes.
    expect(works.filter((r) => r.ambushed).length).toBe(SURVEY_AMBUSH_MAX_PER_TASK);
    expect(works.length).toBe(SURVEY_AMBUSH_MAX_PER_TASK + 1);
    expect(task).toMatchObject({ status: "done", done: true, progress: 1, ambushes: SURVEY_AMBUSH_MAX_PER_TASK });
    expect(lane.some((r) => r.step === "fight")).toBe(false);
    expect(done.groundOps!.shipLegs).toEqual([]);
    // Right after the first ambush: queued with its progress, nothing banked, a 60 s retreat.
    const first = works[0];
    const at = advanceExpedition(e, first.endedAt);
    const t0 = tasksOf(at)[0];
    expect(t0.status).toBe("queued");
    expect(t0.progress).toBeGreaterThan(0);
    expect(t0.progress).toBeLessThan(1);
    expect(t0.segmentsBanked).toBe(0);
    expect(t0.ambushes).toBe(1);
    expect(teams(at)[1]).toMatchObject({ step: "return", stepEndsAt: first.endedAt + RETURN_SECONDS });
    for (const id of teams(at)[1].scienceIds) expect(teams(at)[1].conditions[id]).toEqual([...SURVEY_AMBUSH_CONDITIONS]);
    // Aboard: nothing to offload, straight to the bay for the light injuries.
    const aboard = lane.find((r) => r.startedAt === first.endedAt + RETURN_SECONDS)!;
    expect(aboard.step).toBe("bay");
    // The retry resumes from the kept progress (the second work step starts where the first stopped).
    const second = advanceExpedition(e, works[1].startedAt);
    expect(teams(second)[1].workFrom).toBe(t0.progress);
    // One finding, paid at the completing offload.
    expect(done.findings.filter((f) => f.id.startsWith(groundTaskFindingPrefix(done, task.id))).length).toBe(1);
  });

  it("no chance, no ambush; a crew WITH a Security squad never retreats", () => {
    for (const chance of [undefined, 0]) {
      const done = advanceExpedition(ambushRun(chance), FAR);
      expect(historyOf(done, 1).filter((r) => r.step === "work").length).toBe(1);
      expect(tasksOf(done)[0].ambushes).toBeUndefined();
    }
    const ground = advanceExpedition(ambushRun(1, ["ground", "survey"], 0), FAR);
    expect(historyOf(ground, 0).filter((r) => r.step === "work").length).toBe(1);
    expect(tasksOf(ground)[0]).toMatchObject({ status: "done" });
    expect(tasksOf(ground)[0].ambushes).toBeUndefined();
  });
});

// ===== parity =====

describe("SQ-3 PARITY: one big advance == 997 s chunks == 1 s chunks", () => {
  it("a Strike + Survey needs-split run with a shared pickup and a Survey retreat, over 2 hours", { timeout: 180_000 }, () => {
    const e = squadRun({
      kinds: ["strike", "survey"],
      securityStrength: 0,
      hazard: 0.9,
      scanning: true,
      tasks: [
        { poiId: "subterraneanCivilization" }, // { 1, 1 }: the pair (weak: wipes, a shared pickup)
        { poiId: "mineralOutcrop", needs: { security: 1, science: 0 } }, // Strike alone
        { poiId: "ancientRuins", survey: { needs: { security: 0, science: 1 }, ambushChance: 0.9 } }, // Survey alone
        { poiId: "xenoFloraBloom", survey: { needs: { security: 0, science: 2 } } },
      ],
    });
    const END = T0 + 7200;
    const frozen = structuredClone(e);
    const big = advanceExpedition(e, END);
    let chunked = e;
    for (let t = 997; t < END; t += 997) chunked = advanceExpedition(chunked, t);
    chunked = advanceExpedition(chunked, END);
    expect(chunked).toEqual(big);
    let live = advanceExpedition(e, T0);
    for (let t = T0 + 1; t <= END; t += 1) live = advanceExpedition(live, t);
    expect(live).toEqual(big);
    expect(e).toEqual(frozen); // the input is never mutated
    // The scenario: a needs split, a shared pickup, a Survey retreat.
    const ops = big.groundOps!;
    const [joint, clearing, survey] = tasksOf(big);
    expect(joint.assignedTeamIds).toEqual([0, 1]);
    expect(clearing.assignedTeamIds).toEqual([0]);
    expect(survey.assignedTeamIds).toEqual([1]);
    expect(ops.shipLegs.some((l) => l.teamIndices?.join(",") === "0,1")).toBe(true);
    expect(ops.history.some((r) => r.teamIndex === 1 && r.step === "work" && r.ambushed)).toBe(true);
  });

  it("a REAL dispatched Strike + Survey run: today's content needs { 1, 1 } everywhere, so every task goes to the pair; big == 997 s", { timeout: 180_000 }, () => {
    const s = { ...compState(["strike", "survey"]), expeditionSeed: 0x0a13bd4 };
    const res = startExpedition(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id);
    expect(res.success).toBe(true);
    const exp = res.expedition!;
    expect(exp.groundOps!.teams.map((t) => t.kind)).toEqual(["strike", "survey"]);
    const END = 250_000;
    let chunked = exp;
    for (let c = 997; c < END; c += 997) chunked = advanceExpedition(chunked, c);
    chunked = advanceExpedition(chunked, END);
    const big = advanceExpedition(exp, END);
    expect(chunked).toEqual(big);
    const planned = big.bodies.flatMap((b) => b.activities).filter((t) => t.status !== undefined);
    expect(planned.length).toBeGreaterThan(0);
    for (const task of planned) expect(task.assignedTeamIds).toEqual([0, 1]);
    // The Survey team never fought alone and was never a wipe on its own.
    for (const leg of big.groundOps!.shipLegs) expect(leg.teamIndices ?? [leg.teamIndex]).toEqual([0, 1]);
  });
});
