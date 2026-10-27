// GO-14: the display decisions of a running Ground Operations window (groundOpsTimelineDisplay.ts): the team lanes
// and the ship's lane, the task progress cards, the medical bay card. Real runs (a dispatch, then one synthetic
// scanned body, the groundOpsTimeline.test.ts fixture) for what the engine writes, and hand-written history for
// the rarer shapes (a round-cap retreat, an ambush retreat, a surprise fight). Display only: nothing here changes
// a rule.

import { describe, expect, it } from "vitest";
import { freshState, type AwayMember, type Expedition, type ExpeditionBody, type GameState, type GroundStepRecord } from "./game/model";
import { advanceExpedition, editGroundOps, expeditionCandidates, flaggedScanTimeline } from "./game/expedition";
import { IN_SYSTEM_LEG_SECONDS, groundOpsAssignIdle, groundOpsBayCare, groundOpsBodyScanned } from "./game/groundOps";
import { GROUND_CONDITIONS, conditionCureSeconds } from "./game/medicalBay";
import { asPreCurveDispatch, plainAwayMember, withSlottedAwayTeams, dispatchPastPropulsion } from "./game/awayTeamTestFixtures";
import { runTeamName } from "./groundTaskQueueDisplay";
import {
  GROUND_OPS_PHASE_LABEL,
  TIMELINE_RECENT_STEPS,
  activitiesPhaseLabel,
  bayCardView,
  bayCardsView,
  leftText,
  outside,
  scanPauseWords,
  shipNowText,
  spanText,
  taskCardView,
  taskCardsView,
  taskTouched,
  timelineView,
  type ScanTimelineReader,
} from "./groundOpsTimelineDisplay";

// ===== fixtures (groundOpsTimeline.test.ts) =====

const T0 = 100_000;
const FAR = T0 + 400_000;
const member = (id: string, teamType: AwayMember["teamType"], over: Partial<AwayMember> = {}): AwayMember => ({
  ...plainAwayMember(id, teamType, "ship-1"),
  ...over,
});
const SQUAD: AwayMember[] = [
  member("member-1", "security", { spec: "offense", rank: 3 }),
  member("member-2", "security", { spec: "defense", rank: 3 }),
  member("member-3", "security", { spec: "debuff", rank: 3 }),
  member("member-11", "science", { rank: 2 }),
];
const LONER: AwayMember[] = [member("member-1", "security", { name: "Grokk", race: "ossir" }), member("member-11", "science", { name: "Ysseth" })];

interface Setup {
  members?: AwayMember[];
  poiIds: string[];
  seed?: number;
  securityStrength?: number;
}

function opsRun(setup: Setup): { state: GameState; exp: Expedition } {
  const s = withSlottedAwayTeams({ ...freshState(), gameTimeSeconds: T0 - 50_000, awayMembers: (setup.members ?? SQUAD).map((m) => ({ ...m })), nextAwayMemberId: 100 });
  const res = asPreCurveDispatch(dispatchPastPropulsion(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id));
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  const d = res.expedition;
  const body: ExpeditionBody = {
    id: "body-1",
    planetType: "terrestrial",
    scanTotal: 100,
    scanProgress: 100,
    hazard: 0.2,
    scanned: true,
    discoveries: setup.poiIds.map((poiId, k) => ({ id: `${d.id}-body-1-disc-${k}`, kind: "landmark", poiId })),
    activities: setup.poiIds.map((poiId, k) => ({ id: `${d.id}-body-1-act-${k}`, bodyId: "body-1", poiId, done: false })),
  };
  const exp: Expedition = structuredClone({
    ...d,
    seed: setup.seed ?? d.seed,
    ...(setup.securityStrength !== undefined ? { securityStrength: setup.securityStrength } : {}),
    phase: "activities",
    phaseAnchorSeconds: T0,
    bodies: [body],
    groundOps: { ...d.groundOps!, startedAt: T0 },
  });
  groundOpsBodyScanned(exp, 0, T0);
  groundOpsAssignIdle(exp, T0);
  return { state: { ...res.next, gameTimeSeconds: T0 }, exp };
}

function findOps(setup: Omit<Setup, "seed">, pred: (done: Expedition) => boolean, until = FAR): { state: GameState; exp: Expedition; done: Expedition } {
  for (let i = 0; i < 300; i++) {
    const run = opsRun({ ...setup, seed: (0x5eed0001 + i * 7919) >>> 0 });
    const done = advanceExpedition(run.exp, until);
    if (pred(done)) return { ...run, done };
  }
  throw new Error("no run satisfied the precondition");
}

const shipOf = (s: GameState) => s.ships.find((x) => x.id === "ship-1") ?? null;
const historyOf = (e: Expedition): GroundStepRecord[] => e.groundOps!.history.filter((r) => r.teamIndex === 0);
const scan: ScanTimelineReader = flaggedScanTimeline;
const firstTask = (e: Expedition) => e.bodies[0].activities[0];

// ===== words =====

describe("GO-14 small words", () => {
  it("spans read in plain words, whole seconds, never negative", () => {
    expect(spanText(45)).toBe("45s");
    expect(spanText(360)).toBe("6m");
    expect(spanText(372)).toBe("6m 12s");
    expect(spanText(2250)).toBe("37m 30s");
    expect(spanText(4320)).toBe("1h 12m");
    expect(spanText(-5)).toBe("0s");
    expect(spanText(Number.NaN)).toBe("0s");
    expect(leftText(T0 + 90.2, T0)).toBe("1m 31s left");
    expect(leftText(T0, T0)).toBe("ending now");
  });

  it("the activities phase reads Ground Operations on a Ground Ops run [PROVISIONAL copy]", () => {
    expect(activitiesPhaseLabel(opsRun({ poiIds: [] }).exp)).toBe(GROUND_OPS_PHASE_LABEL);
    expect(activitiesPhaseLabel({ groundOps: undefined })).toBe("Activities");
  });
});

// ===== the lanes =====

describe("GO-14 team lanes", () => {
  it("a won task: every step on the shared axis in order, no overlap, the right glyphs and colors", () => {
    const { state, exp } = opsRun({ poiIds: ["crashedShip"], securityStrength: 400 });
    const done = advanceExpedition(exp, FAR);
    const view = timelineView(done, shipOf(state), FAR, "whole", scan)!;
    expect(view.closed).toBe(true);
    expect(view.axis).toMatchObject({ start: T0, end: done.groundOps!.endedAt, startText: "window opened", endText: "operations ended" });
    const lane = view.lanes[0];
    expect(lane).toMatchObject({ index: 0, letter: "A", name: runTeamName(shipOf(state), 0), kindName: "Ground" });
    const cats = lane.segments.map((s) => s.category);
    expect(cats.slice(0, 9)).toEqual(["travel", "work", "fight", "work", "fight", "work", "fight", "work", "travel"]);
    expect(lane.segments.filter((s) => s.category === "fight").map((s) => s.label)).toEqual(["won", "won", "won"]);
    expect(lane.segments[1]).toMatchObject({ glyph: "tool", label: "Crashed Ship" });
    expect(lane.segments.some((s) => s.category === "load" && s.glyph === "offload")).toBe(true);
    // Sequential, inside the track, nothing current once the window closed.
    for (let i = 1; i < lane.segments.length; i++) {
      expect(lane.segments[i].leftPct).toBeGreaterThanOrEqual(lane.segments[i - 1].leftPct + lane.segments[i - 1].widthPct - 1e-6);
    }
    for (const seg of lane.segments) {
      expect(seg.leftPct + seg.widthPct).toBeLessThanOrEqual(100 + 1e-9);
      expect(seg.current).toBe(false);
    }
    expect(lane.nowText).toBe("Back aboard");
    // The step list: most recent first, in words.
    expect(lane.steps[lane.steps.length - 1].text).toMatch(/^Drop to Crashed Ship/);
  });

  it("Recent shows the last few steps of every lane; Whole run starts at the window", () => {
    const { state, exp } = opsRun({ poiIds: ["crashedShip", "mineralOutcrop"], securityStrength: 400 });
    const now = advanceExpedition(exp, FAR).groundOps!.endedAt! - 1; // the window still open
    const mid = advanceExpedition(exp, now);
    const recs = historyOf(mid);
    expect(recs.length).toBeGreaterThan(TIMELINE_RECENT_STEPS);
    const recent = timelineView(mid, shipOf(state), now, "recent", scan)!;
    const whole = timelineView(mid, shipOf(state), now, "whole", scan)!;
    expect(whole.axis.start).toBe(T0);
    // The live step plus history: the axis starts at the 8th step from the end.
    const all = [...recs.map((r) => r.startedAt), mid.groundOps!.teams[0].stepStartedAt];
    expect(recent.axis.start).toBe(all[all.length - TIMELINE_RECENT_STEPS]);
    expect(recent.lanes[0].segments.length).toBe(TIMELINE_RECENT_STEPS);
    expect(recent.axis.startText).toMatch(/before now$/);
    expect(whole.lanes[0].segments.length).toBe(all.length);
  });

  it("the live step is highlighted with its time left", () => {
    const { state, exp } = opsRun({ poiIds: ["crashedShip"], securityStrength: 400 });
    const now = T0 + 30; // the drop (60 s)
    const view = timelineView(advanceExpedition(exp, now), shipOf(state), now, "recent", scan)!;
    const live = view.lanes[0].segments[view.lanes[0].segments.length - 1];
    expect(live).toMatchObject({ current: true, category: "travel", label: "drop" });
    expect(view.lanes[0].nowText).toBe("Dropping to Crashed Ship · 30s left");
    expect(view.lanes[0].steps[0]).toMatchObject({ current: true, when: "now" });
  });
});

describe("GO-14 a wipe and its recovery leg", () => {
  const { state, exp, done } = findOps({ poiIds: ["crashedShip"], members: LONER, securityStrength: 6 }, (d) =>
    historyOf(d).some((r) => r.step === "fight" && r.outcome === "loss"),
  );
  const ship = shipOf(state);
  const loss = historyOf(done).find((r) => r.step === "fight" && r.outcome === "loss")!;
  const leg = done.groundOps!.shipLegs.find((l) => l.startsAt >= loss.endedAt - 1e-6)!;

  it("while the team waits: the lost fight reads as a wipe, the lane waits for the ship, the ship flies the leg", () => {
    const now = loss.endedAt + 1;
    const live = advanceExpedition(exp, now);
    const view = timelineView(live, ship, now, "whole", scan)!;
    const lane = view.lanes[0];
    const wipe = lane.segments.find((s) => s.category === "wipe")!;
    expect(wipe).toMatchObject({ label: "wiped", glyph: "fightPoint" });
    expect(wipe.detail).toMatch(/lost, Security wiped/);
    expect(lane.segments[lane.segments.length - 1]).toMatchObject({ current: true, label: "awaiting pickup" });
    expect(lane.nowText).toBe(`Waiting for the ship: pickup in ${spanText(leg.arrivesAt - now)}`);
    const legSeg = view.ship.segments.find((s) => s.category === "leg")!;
    expect(legSeg).toMatchObject({ label: `pickup: ${runTeamName(ship, 0)}`, glyph: "ship", current: true });
    expect(view.ship.nowText).toMatch(new RegExp(`^Flying to pick up ${runTeamName(ship, 0)} · arrives in`));
    expect(legSeg.detail).toMatch(new RegExp(`\\(${spanText(2 * IN_SYSTEM_LEG_SECONDS)}\\)$`));
  });

  it("the task card holds the bar at the point: the pip reads wiped here, the haul banked vs offloaded", () => {
    const now = loss.endedAt + 1;
    const live = advanceExpedition(exp, now);
    const task = firstTask(live);
    const card = taskCardView(live, ship, task, now);
    const cleared = task.pointsCleared ?? 0;
    expect(card.state).toBe("paused");
    expect(card.stateText).toBe(`Paused: ${runTeamName(ship, 0)} waiting for the ship`);
    expect(card.pips[cleared]).toMatchObject({ state: "wiped", label: `fight ${cleared + 1}: wiped here, resumes here` });
    for (let i = 0; i < cleared; i++) expect(card.pips[i].state).toBe("won");
    expect(card.pointText).toBe(`Progress held at ${card.progressPct}%: Security wiped at fight ${cleared + 1}; the retry resumes there`);
    expect(card.crew.map((c) => c.index)).toEqual([0]);
    const banked = task.segmentsBanked ?? 0;
    if (banked > 0) expect(card.haulText).toMatch(new RegExp(`^Haul: ${banked} of 4 segments banked, 0 offloaded`));
    else expect(card.haulText).toMatch(/^Haul: none banked yet/);
  });

  it("after the pickup the return reads 'pickup' and the wipe stays marked; the bay pauses the card", () => {
    const now = leg.arrivesAt + 1;
    const after = advanceExpedition(exp, now);
    const lane = timelineView(after, ship, now, "whole", scan)!.lanes[0];
    const wipeAt = lane.segments.findIndex((s) => s.category === "wipe");
    expect(lane.segments[wipeAt + 1]).toMatchObject({ category: "travel", label: "pickup" });
    const team = after.groundOps!.teams[0];
    expect(["offload", "bay", "reload"]).toContain(team.step);
    const card = taskCardView(after, ship, firstTask(after), now);
    expect(card.stateText).toMatch(new RegExp(`^Paused: ${runTeamName(ship, 0)} (offloading|in the med bay|reloading)$`));
  });
});

describe("GO-14 hand-written history: a retreat, an ambush, a surprise fight", () => {
  function withHistory(records: Omit<GroundStepRecord, "teamIndex">[]): { state: GameState; exp: Expedition; now: number } {
    const { state, exp } = opsRun({ poiIds: ["mineralOutcrop"] });
    const e = structuredClone(exp);
    const ops = e.groundOps!;
    ops.history = records.map((r) => ({ teamIndex: 0, ...r }));
    const end = records[records.length - 1].endedAt;
    const team = ops.teams[0];
    Object.assign(team, { step: "idle", stepStartedAt: end, stepEndsAt: null });
    delete team.taskId;
    const task = firstTask(e);
    task.status = "queued";
    return { state, exp: e, now: end + 10 };
  }

  it("a fight lost WITHOUT a wipe (an ordinary return) reads 'lost', not a wipe", () => {
    const { state, exp, now } = withHistory([
      { step: "deploy", startedAt: T0, endedAt: T0 + 60, taskId: "x" },
      { step: "fight", startedAt: T0 + 60, endedAt: T0 + 120, taskId: "x", outcome: "loss" },
      { step: "return", startedAt: T0 + 120, endedAt: T0 + 180, taskId: "x" },
    ]);
    const lane = timelineView(exp, shipOf(state), now, "whole", scan)!.lanes[0];
    expect(lane.segments[1]).toMatchObject({ category: "fight", label: "lost", lost: true });
    expect(lane.segments[1].detail).toMatch(/the team fell back/);
    expect(lane.segments[2]).toMatchObject({ label: "return" });
  });

  it("SF-6: a training run's lost fight whose guards fell back reads the backstop's log line, not a held loss", () => {
    const { state, exp, now } = withHistory([
      { step: "deploy", startedAt: T0, endedAt: T0 + 60, taskId: "x" },
      { step: "fight", startedAt: T0 + 60, endedAt: T0 + 120, taskId: "x", outcome: "loss", fellBack: true },
      { step: "return", startedAt: T0 + 120, endedAt: T0 + 180, taskId: "x" },
    ]);
    const lane = timelineView(exp, shipOf(state), now, "whole", scan)!.lanes[0];
    expect(lane.segments[1]).toMatchObject({ category: "fight", label: "guards fell back", lost: false });
    expect(lane.segments[1].detail).toMatch(/: The guards fell back\. Training run: no setback\. \(1m\)$/);
  });

  it("an ambush retreat and a surprise fight become notes on the task card and words on the lane", () => {
    const { state, exp: base } = opsRun({ poiIds: ["mineralOutcrop"] });
    const id = firstTask(base).id;
    const { exp, now } = withHistory([
      { step: "deploy", startedAt: T0, endedAt: T0 + 60, taskId: id },
      { step: "work", startedAt: T0 + 60, endedAt: T0 + 200, taskId: id, ambushed: true },
      { step: "return", startedAt: T0 + 200, endedAt: T0 + 260, taskId: id },
      { step: "bay", startedAt: T0 + 260, endedAt: T0 + 320, taskId: id },
      { step: "reload", startedAt: T0 + 320, endedAt: T0 + 380, taskId: id },
      { step: "idle", startedAt: T0 + 380, endedAt: T0 + 380 },
      { step: "deploy", startedAt: T0 + 380, endedAt: T0 + 440, taskId: id },
      { step: "work", startedAt: T0 + 440, endedAt: T0 + 500, taskId: id, ambushed: true },
      { step: "fight", startedAt: T0 + 500, endedAt: T0 + 548, taskId: id, outcome: "win", surprise: true },
    ]);
    firstTask(exp).progress = 0.4;
    firstTask(exp).ambushes = 2;
    const lane = timelineView(exp, shipOf(state), now, "whole", scan)!.lanes[0];
    expect(lane.segments[1]).toMatchObject({ category: "work", label: "ambushed" });
    expect(lane.segments[1].detail).toMatch(/ambushed, the crew retreated$/);
    const work2 = lane.segments.filter((s) => s.category === "work")[1];
    expect(work2.detail).toMatch(/ambushed, the crew stood and fought$/);
    expect(lane.segments.find((s) => s.category === "fight")).toMatchObject({ label: "surprise, won" });
    const card = taskCardView(exp, shipOf(state), firstTask(exp), now);
    expect(card.notes).toEqual(["Retreated from an ambush", "Won a surprise fight"]);
    expect(card.state).toBe("paused");
    expect(card.stateText).toBe("Paused: queued to resume");
    expect(taskTouched(exp, firstTask(exp))).toBe(true);
  });
});

describe("GO-14 an edit stops the active task", () => {
  it("skipping mid-work hatches the stopped step and the card says the progress is kept", () => {
    const { state, exp } = opsRun({ poiIds: ["crashedShip"], securityStrength: 400 });
    const work = historyOf(advanceExpedition(exp, FAR)).find((r) => r.step === "work")!;
    const now = Math.round((work.startedAt + work.endedAt) / 2);
    const s0: GameState = { ...state, gameTimeSeconds: now, expeditions: [exp] };
    const s1 = editGroundOps(s0, exp.id, { kind: "skip", taskId: firstTask(exp).id });
    expect(s1).not.toBe(s0);
    const edited = s1.expeditions[0];
    const view = timelineView(edited, shipOf(s1), now, "whole", scan)!;
    expect(view.hasStopped).toBe(true);
    const stopped = view.lanes[0].segments.find((s) => s.stopped)!;
    expect(stopped).toMatchObject({ category: "work", label: "stopped" });
    expect(stopped.detail).toMatch(/stopped by your edit$/);
    const card = taskCardView(edited, shipOf(s1), firstTask(edited), now);
    expect(card.state).toBe("skipped");
    expect(card.notes).toContain(`Skipped partway: progress kept at ${card.progressPct}%`);
    expect(card.haulText).not.toMatch(/relic/);
    expect(card.pointText).toMatch(/^Skipped with \d of 3 fights won$/);
  });
});

describe("AF-1 objective affixes on the timelines and cards", () => {
  // A crashed ship with two fight points, its first point fight still ahead, and Reinforcing on it.
  function reinforced(records: Omit<GroundStepRecord, "teamIndex">[]) {
    const { state, exp } = opsRun({ poiIds: ["crashedShip"] });
    const e = structuredClone(exp);
    const ops = e.groundOps!;
    const id = firstTask(e).id;
    ops.history = records.map((r) => ({ teamIndex: 0, ...r, ...(r.step === "idle" ? {} : { taskId: id }) }));
    const end = records[records.length - 1].endedAt;
    const team = ops.teams[0];
    Object.assign(team, { step: "idle", stepStartedAt: end, stepEndsAt: null });
    delete team.taskId;
    Object.assign(firstTask(e), {
      status: "queued",
      fightPoints: [0.3, 0.6],
      pointsCleared: 0,
      progress: 0.3,
      fightCount: 1,
      difficulty: 5,
      difficultyScore: 8,
      affixes: [{ id: "reinforcing", rank: 3, alignment: "negative" }],
    });
    return { state, exp: e, now: end + 10 };
  }

  it("a reinforcement fight is labelled on the lane, and a lost one never reads 'wiped here' at the next point", () => {
    const { state, exp, now } = reinforced([
      { step: "deploy", startedAt: T0, endedAt: T0 + 60 },
      { step: "work", startedAt: T0 + 60, endedAt: T0 + 200 },
      { step: "fight", startedAt: T0 + 200, endedAt: T0 + 260, outcome: "win", reinforcement: true },
      { step: "work", startedAt: T0 + 260, endedAt: T0 + 300 },
      { step: "fight", startedAt: T0 + 300, endedAt: T0 + 360, outcome: "loss", reinforcement: true },
      { step: "return", startedAt: T0 + 360, endedAt: T0 + 420 },
    ]);
    const fights = timelineView(exp, shipOf(state), now, "whole", scan)!.lanes[0].segments.filter((s) => s.category === "fight");
    expect(fights.map((s) => s.label)).toEqual(["reinforcements, won", "reinforcements, lost"]);
    expect(fights[0].detail).toMatch(/^Reinforcements at Crashed Ship: won/);
    expect(fights[1].detail).toMatch(/^Reinforcements at Crashed Ship: lost, the team fell back/);
    const card = taskCardView(exp, shipOf(state), firstTask(exp), now);
    // The bar sits AT point 1 (progress 30%), but the last fight was a reinforcement fight: no held line, no pip.
    expect(card.pips.map((p) => p.state)).toEqual(["pending", "pending"]);
    expect(card.pointText).toBe("2 fights ahead; the first at 30%");
    expect(card.notes).toEqual(["Beat back reinforcements once", "Lost a fight to reinforcements"]);
  });

  it("a lost POINT fight after a won reinforcement fight still holds the bar at the point", () => {
    const { state, exp, now } = reinforced([
      { step: "deploy", startedAt: T0, endedAt: T0 + 60 },
      { step: "fight", startedAt: T0 + 60, endedAt: T0 + 120, outcome: "win", reinforcement: true },
      { step: "work", startedAt: T0 + 120, endedAt: T0 + 200 },
      { step: "fight", startedAt: T0 + 200, endedAt: T0 + 260, outcome: "loss" },
      { step: "return", startedAt: T0 + 260, endedAt: T0 + 320 },
    ]);
    const card = taskCardView(exp, shipOf(state), firstTask(exp), now);
    expect(card.pips[0]).toMatchObject({ state: "lost", label: "fight 1: lost here, resumes here" });
    expect(card.pointText).toBe("Progress held at 30%: lost at fight 1; the retry resumes there");
  });

  it("the card carries the affix pill and, while held at Impossible, the live countdown", () => {
    const { state, exp, now } = reinforced([
      { step: "deploy", startedAt: T0, endedAt: T0 + 60 },
      { step: "fight", startedAt: T0 + 60, endedAt: T0 + 120, outcome: "loss" },
      { step: "return", startedAt: T0 + 120, endedAt: T0 + 180 },
    ]);
    firstTask(exp).alert = { level: 3, lastAt: now - 100 };
    const card = taskCardView(exp, shipOf(state), firstTask(exp), now);
    expect(card.affixes!.pills.map((p) => [p.label, p.color, p.alignment])).toEqual([["Reinforcing III", "red", "Negative"]]);
    expect(card.affixes!.alert).toMatchObject({ held: true, headline: "Impossible: resets in 48m 20s" });
    expect(taskCardView(exp, shipOf(state), firstTask(exp), now + 60).affixes!.alert!.headline).toBe("Impossible: resets in 47m 20s");
    // Done: the pills stay, the alert goes (nothing is left to retry).
    Object.assign(firstTask(exp), { status: "done", done: true, progress: 1, pointsCleared: 2 });
    expect(taskCardView(exp, shipOf(state), firstTask(exp), now).affixes).toMatchObject({ alert: null });
  });

  it("a live reinforcement fight is labelled as one and never marks a fight point 'under way'", () => {
    const { state, exp, now } = reinforced([{ step: "deploy", startedAt: T0, endedAt: T0 + 60 }]);
    const team = exp.groundOps!.teams[0];
    const task = firstTask(exp);
    task.status = "active";
    Object.assign(team, {
      step: "fight",
      taskId: task.id,
      stepStartedAt: now - 5,
      stepEndsAt: now + 50,
      pendingFight: { pointIndex: 0, fightNumber: 1, outcome: "win", rounds: 3, downedMemberIds: [], memberConditions: {}, memberEnd: {}, reinforcement: true },
    });
    const lane = timelineView(exp, shipOf(state), now, "whole", scan)!.lanes[0];
    expect(lane.segments[lane.segments.length - 1]).toMatchObject({ current: true, label: "reinforcements" });
    expect(lane.segments[lane.segments.length - 1].detail).toBe("Reinforcements at Crashed Ship, under way");
    expect(taskCardView(exp, shipOf(state), task, now).pips[0].state).toBe("pending");
  });
});

describe("GO-14 task cards", () => {
  it("only touched tasks get a card; in progress first; the count of done tasks", () => {
    const { state, exp } = opsRun({ poiIds: ["crashedShip", "mineralOutcrop", "caveNetwork"], securityStrength: 400 });
    const view = taskCardsView(exp, shipOf(state), T0);
    expect(view.total).toBe(3);
    expect(view.done).toBe(0);
    expect(view.cards.map((c) => c.state)).toEqual(["inProgress"]); // only the deployed one
    const done = advanceExpedition(exp, FAR);
    const after = taskCardsView(done, shipOf(state), FAR);
    expect(after.done).toBe(3);
    expect(after.cards.every((c) => c.state === "done")).toBe(true);
    const crashed = after.cards.find((c) => c.name === "Crashed Ship")!;
    expect(crashed.pips.map((p) => p.state)).toEqual(["won", "won", "won"]);
    expect(crashed.pointText).toBe("Done: 3 fights won");
    expect(crashed.haulText).toBe("Haul: 4 of 4 segments banked, all offloaded");
    expect(crashed.progressPct).toBe(100);
    expect(crashed.haul).not.toBeNull();
    expect(crashed.haul!.materials.length + (crashed.haul!.credits > 0 ? 1 : 0)).toBeGreaterThan(0);
  });

  it("a fight under way marks its pip 'under way'; the card reads In progress", () => {
    const { state, exp } = opsRun({ poiIds: ["crashedShip"], securityStrength: 400 });
    const fight = historyOf(advanceExpedition(exp, FAR)).find((r) => r.step === "fight")!;
    const now = fight.startedAt + 1;
    const mid = advanceExpedition(exp, now);
    const card = taskCardView(mid, shipOf(state), firstTask(mid), now);
    expect(card).toMatchObject({ state: "inProgress", stateText: "In progress" });
    expect(card.pips[0]).toMatchObject({ state: "fighting", label: "fight 1: under way" });
    expect(card.pointText).toMatch(/^3 fights ahead; the first at \d+%$/);
  });
});

describe("GO-14 the medical bay card", () => {
  it("one bar per condition, the longest highlighted, Stoneskin on the Ossir member's injury, bay time = the longest", () => {
    const { state, exp } = opsRun({ poiIds: ["crashedShip"], members: LONER });
    const e = structuredClone(exp);
    const ops = e.groundOps!;
    const grokk = e.roster!.security.find((m) => m.memberId === "member-1")!;
    expect(grokk.perks).toEqual(["stoneskin"]); // the Ossir racial, frozen at dispatch
    const team = ops.teams[0];
    const now = T0 + 1000;
    Object.assign(team, {
      step: "bay",
      stepStartedAt: now - 10,
      stepEndsAt: now + 5000,
      conditions: { "member-1": ["fracture", "health"], "member-11": ["poison", "health", "stun"] },
    });
    const care = groundOpsBayCare(ops.factors);
    const fracture = conditionCureSeconds(GROUND_CONDITIONS.fracture, ["stoneskin"], care);
    const health = conditionCureSeconds(GROUND_CONDITIONS.health, [], care);
    const poison = conditionCureSeconds(GROUND_CONDITIONS.poison, [], care);
    const card = bayCardView(e, shipOf(state), team, now, state.awayMembers)!;
    expect(card.inBay).toBe(true);
    expect(card.title).toBe(`Medical bay · ${runTeamName(shipOf(state), 0)}`);
    expect(card.rows[0]).toMatchObject({ label: "Fracture", cls: "injury", who: "Grokk (injury, Stoneskin)", seconds: fracture, longest: true, stoneskin: true, widthPct: 100 });
    expect(card.rows.find((r) => r.conditionId === "health")).toMatchObject({ who: "everyone (health)", seconds: health, longest: false });
    expect(card.rows.find((r) => r.conditionId === "poison")).toMatchObject({ who: "Ysseth (ailment)", seconds: poison });
    expect(card.rows.some((r) => r.conditionId === "stun")).toBe(false); // a battle-only status needs no bay time
    expect(card.baySeconds).toBe(fracture);
    expect(card.bayText).toBe(`Bay time: ${spanText(fracture)} (the longest one)`);
    expect(card.statusText).toBe(`${spanText(5000)} left`);
    // GO-14 review: the longest row also reads the time left; the others only their length.
    expect(card.rows[0].timeText).toBe(`${spanText(fracture)} (${spanText(5000)} left)`);
    expect(card.rows.find((r) => r.conditionId === "poison")!.timeText).toBe(spanText(poison));
    expect(card.stoneskinNote).toBe("Grokk is Ossir: Stoneskin makes injuries last 25% longer.");
    // With no care at all, the mockup's numbers: Fracture on an Ossir member is 2250 s.
    if (care.medicalShare + care.rapidRecoveryShare + care.officerFacetShare + care.injurySteady === 0) expect(fracture).toBe(2250);
  });

  it("shows on the way home (Starts after the offload), never for an idle team or one without conditions", () => {
    const { state, exp } = opsRun({ poiIds: ["crashedShip"], members: LONER });
    const e = structuredClone(exp);
    const team = e.groundOps!.teams[0];
    Object.assign(team, { step: "offload", stepStartedAt: T0, stepEndsAt: T0 + 120, conditions: { "member-11": ["poison"] } });
    const heading = bayCardView(e, shipOf(state), team, T0 + 5, state.awayMembers)!;
    expect(heading).toMatchObject({ inBay: false, statusText: "Starts after the offload" });
    expect(heading.rows[0].timeText).not.toMatch(/left/); // the bay has not started: no time left yet
    Object.assign(team, { step: "offload", conditions: {} });
    expect(bayCardView(e, shipOf(state), team, T0 + 5, state.awayMembers)).toBeNull();
    Object.assign(team, { step: "idle", stepEndsAt: null, conditions: { "member-11": ["poison"] } });
    expect(bayCardsView(e, shipOf(state), T0 + 5, state.awayMembers)).toEqual([]);
  });
});

describe("GO-14 the ship's lane", () => {
  it("scans, a scan pause, a shared pickup and a field repair, each in words", () => {
    const { state, exp } = opsRun({ poiIds: ["mineralOutcrop"] });
    const e = structuredClone(exp);
    const ops = e.groundOps!;
    e.bodies = [{ ...e.bodies[0] }, { ...e.bodies[0], id: "body-2", scanned: false, activities: [], discoveries: [] }];
    ops.shipLegs = [{ kind: "recovery", teamIndex: 0, teamIndices: [0, 1], bodyIndex: 0, scanBodyIndex: 1, startsAt: T0 + 1000, arrivesAt: T0 + 1300, endsAt: T0 + 1600 }];
    ops.repairLegs = [{ kind: "repair", siteBodyIndex: 0, scanBodyIndex: 1, startsAt: T0 + 2000, arrivesAt: T0 + 2300, repairedAt: T0 + 2900, endsAt: T0 + 3200, hullRepaired: 30 }];
    const stub: ScanTimelineReader = () => ({
      bodies: [
        { bodyIndex: 0, startsAt: T0 - 500, endsAt: T0 },
        { bodyIndex: 1, startsAt: T0, endsAt: null },
      ],
      pauses: [{ bodyIndex: 1, step: 1, startsAt: T0 + 400, endsAt: T0 + 520, event: { bodyIndex: 1, step: 1, kind: "shipEvent", event: "debris", outcome: "fail", pauseSeconds: 120 } }],
    });
    const ship = shipOf(state);
    const now = T0 + 1100;
    const view = timelineView(e, ship, now, "whole", stub)!;
    const segs = view.ship.segments;
    // Only what the ship is doing now is highlighted: the leg, not the scan it broke off.
    expect(segs.find((s) => s.category === "scan" && s.label === "scan c")).toMatchObject({ current: false });
    expect(segs.filter((s) => s.current).map((s) => s.category)).toEqual(["leg"]);
    expect(segs.find((s) => s.category === "pause")).toMatchObject({ glyph: "shipDebris", label: "debris field" });
    expect(segs.find((s) => s.category === "pause")!.detail).toBe("Debris field: a detour around the debris (2m)");
    const pickup = segs.find((s) => s.category === "leg")!;
    expect(pickup.label).toBe(`shared pickup: ${runTeamName(ship, 0)} + ${runTeamName(ship, 1)}`);
    expect(pickup.current).toBe(true);
    expect(view.ship.nowText).toBe(`Flying to pick up ${runTeamName(ship, 0)} + ${runTeamName(ship, 1)} · arrives in 3m 20s`);
    // After pickup the crew is aboard while the ship flies back: say so, not "bringing back".
    expect(shipNowText(e, ship, T0 + 1400)).toBe(`${runTeamName(ship, 0)} + ${runTeamName(ship, 1)} aboard · returning to the scan · 3m 20s left`);
    const late = structuredClone(e);
    late.groundOps!.shipLegs[0].scanBodyIndex = null;
    expect(shipNowText(late, ship, T0 + 1400)).toBe(`${runTeamName(ship, 0)} + ${runTeamName(ship, 1)} aboard · returning to station · 3m 20s left`);
    // The repair (future, past the axis end) is not drawn yet; later it is, with its legs in words.
    expect(segs.some((s) => s.category === "repair")).toBe(false);
    const later = timelineView(e, ship, T0 + 2500, "whole", stub)!;
    const repair = later.ship.segments.find((s) => s.category === "repair")!;
    expect(repair.detail).toBe(`Field repair at ${e.systemName} b · Terrestrial (after heavy damage): flying 5m, repairing 10m, flying back 5m; fixes 30 hull`);
    expect(shipNowText(e, ship, T0 + 2500)).toBe(`Setting down for repairs at ${e.systemName} b · Terrestrial · 6m 40s left`);
    expect(view.ship.steps[0].current).toBe(true);
  });

  it("the scan and the hold are drawn only where no leg covers them, and listed once", () => {
    expect(outside(0, 100, [[10, 20], [15, 30], [90, 120]])).toEqual([[0, 10], [30, 90]]);
    expect(outside(0, 100, [])).toEqual([[0, 100]]);
    const { state, exp } = opsRun({ poiIds: ["mineralOutcrop"] });
    const e = structuredClone(exp);
    e.groundOps!.shipLegs = [{ kind: "recovery", teamIndex: 0, bodyIndex: 0, scanBodyIndex: null, startsAt: T0 + 100, arrivesAt: T0 + 400, endsAt: T0 + 700 }];
    const stub: ScanTimelineReader = () => ({ bodies: [{ bodyIndex: 0, startsAt: T0 - 500, endsAt: T0 }], pauses: [] });
    const view = timelineView(e, shipOf(state), T0 + 1000, "whole", stub)!;
    const holds = view.ship.segments.filter((s) => s.category === "hold");
    expect(holds.map((h) => [h.startsAt, h.endsAt])).toEqual([[T0, T0 + 100], [T0 + 700, T0 + 1000]]);
    expect(holds.map((h) => h.current)).toEqual([false, true]);
    expect(view.ship.steps.filter((st) => st.text.startsWith("Holding station")).length).toBe(1);
  });

  it("scan pause words name the event and a boarding", () => {
    expect(scanPauseWords({ bodyIndex: 0, step: 1, kind: "shipEvent", event: "probe", outcome: "loss", pauseSeconds: 600, boarding: { repelled: false } }, 600)).toEqual({
      label: "hostile probe",
      detail: "Hostile probe: repairs after the fight; boarders got aboard (10m)",
      glyph: "boarding",
    });
    expect(scanPauseWords({ bodyIndex: 0, step: 1, kind: "shipEvent", event: "ghost", outcome: "fail", pauseSeconds: 180 }, 180).glyph).toBe("sensorGhost");
  });

  it("flaggedScanTimeline walks a real run: contiguous body spans from the window's start, each pause as long as recorded", () => {
    const s = withSlottedAwayTeams({ ...freshState(), awayMembers: SQUAD.map((m) => ({ ...m })), nextAwayMemberId: 100, expeditionSeed: 0x6eed1 });
    const res = asPreCurveDispatch(dispatchPastPropulsion(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id));
    const exp = res.expedition!;
    let t = 0;
    let e = exp;
    while (e.phase !== "activities" && e.phase !== "return" && t < 400_000) {
      t += 300;
      e = advanceExpedition(exp, t);
    }
    expect(e.phase).toBe("activities");
    const tl = flaggedScanTimeline(e);
    expect(tl.bodies.length).toBe(e.bodies.length);
    expect(tl.bodies[0].startsAt).toBe(e.groundOps!.startedAt);
    for (let i = 1; i < tl.bodies.length; i++) expect(tl.bodies[i].startsAt).toBeCloseTo(tl.bodies[i - 1].endsAt!, 6);
    // The last body ends where the activities phase began (the scan's end, legs included).
    expect(tl.bodies[tl.bodies.length - 1].endsAt).toBeCloseTo(e.phaseAnchorSeconds, 6);
    for (const p of tl.pauses) expect(p.endsAt - p.startsAt).toBeGreaterThanOrEqual((p.event.pauseSeconds ?? 0) - 1e-6);
    expect(tl.pauses.length).toBe((e.scanEvents ?? []).filter((ev) => (ev.pauseSeconds ?? 0) > 0).length);
    // Before the window opens there is nothing to draw.
    expect(timelineView(exp, shipOf(res.next), 0, "recent", flaggedScanTimeline)).toBeNull();
  });
});
