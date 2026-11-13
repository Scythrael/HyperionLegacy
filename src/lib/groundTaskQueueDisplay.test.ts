// GO-13 + Squads SQ-7 section 7.3: the per-planet task queue screen's display decisions (groundTaskQueueDisplay.ts)
// over real Ground Ops runs. No rule lives in the module; these pin what the screen shows and that every edit it
// sends is one the engine accepts.

import { describe, expect, it } from "vitest";
import {
  freshState,
  type AwayMember,
  type Expedition,
  type ExpeditionBody,
  type GameState,
  type GroundTaskNeeds,
  type GroundTeamKind,
  type ShipGroundTeam,
} from "./game/model";
import { advanceExpedition, editGroundOps, expeditionCandidates } from "./game/expedition";
import { GROUND_OPS_STUCK_TEXT, groundOpsAssignIdle, groundOpsBodyScanned, groundOpsStuck, type GroundOpsEdit } from "./game/groundOps";
import { asPreCurveDispatch, plainAwayMember, withSlottedAwayTeams, dispatchPastPropulsion } from "./game/awayTeamTestFixtures";
import type { ThreatAssessment } from "./game/combat/threatAssessment";
import {
  AUTO_ASSIGN_LABEL,
  DEFAULT_PLAN_LABEL,
  GROUND_QUEUE_NOTE,
  NEEDS_PARTNER_TEXT,
  NO_FIGHTS_TEXT,
  QUEUE_EMPTY_TEXT,
  STUCK_HINT,
  bodyNumeral,
  createOddsMemo,
  crewEdit,
  crewFromKey,
  crewKey,
  defaultCrewPick,
  difficultyView,
  fightBarView,
  groundOpsEditLogText,
  groundQueueView,
  largerCrewNote,
  largerCrewWord,
  needsPhrase,
  ordinal,
  queueTaskStatus,
  type OddsMemo,
} from "./groundTaskQueueDisplay";

// ===== fixtures (the groundOpsEdits.test.ts runs) =====

const T0 = 100_000;
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

function finish(d: Expedition, body: ExpeditionBody, opts: { securityStrength?: number }): Expedition {
  const exp: Expedition = structuredClone({
    ...d,
    ...(opts.securityStrength !== undefined ? { securityStrength: opts.securityStrength } : {}),
    phase: "activities",
    phaseAnchorSeconds: T0,
    bodies: [body],
    scanStepCursor: Math.max(0, (d.encounterSteps ?? 1) - 1),
    groundOps: { ...d.groundOps!, startedAt: T0 },
  });
  groundOpsBodyScanned(exp, 0, T0);
  groundOpsAssignIdle(exp, T0);
  return exp;
}

function oneTeamRun(poiIds: string[], opts: { members?: AwayMember[]; securityStrength?: number; hazard?: number } = {}): { state: GameState; exp: Expedition } {
  const s = withSlottedAwayTeams({ ...freshState(), gameTimeSeconds: T0 - 50_000, awayMembers: (opts.members ?? SQUAD).map((m) => ({ ...m })), nextAwayMemberId: 100 });
  const res = asPreCurveDispatch(dispatchPastPropulsion(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id));
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  const exp = finish(res.expedition, scannedBody(res.expedition.id, poiIds, opts.hazard ?? 0.2), opts);
  return { state: { ...res.next, gameTimeSeconds: T0, expeditions: [exp] }, exp };
}

const SEC = ["member-1", "member-2", "member-3", "member-4", "member-5", "member-6"];
const SCI = ["member-11", "member-12", "member-13", "member-14", "member-15", "member-16"];
const CREW: AwayMember[] = [
  ...SEC.map((id, k) => member(id, "security", { spec: k % 2 === 0 ? "offense" : "defense", rank: 3 })),
  ...SCI.map((id) => member(id, "science", { rank: 2 })),
];
const squad = (pool: string[]): (string | null)[] => [...pool.splice(0, 2), null];

function twoTeamRun(kinds: [GroundTeamKind, GroundTeamKind], tasks: { poiId: string; needs?: GroundTaskNeeds }[]): { state: GameState; exp: Expedition } {
  const base = freshState();
  const sec = [...SEC];
  const sci = [...SCI];
  const teams: ShipGroundTeam[] = kinds.map((kind) => {
    if (kind === "strike") return { kind, security: [...squad(sec), ...squad(sec)], science: [], helpOthers: false };
    if (kind === "survey") return { kind, security: [], science: [...squad(sci), ...squad(sci)], helpOthers: false };
    return { kind, security: squad(sec), science: squad(sci), helpOthers: false };
  });
  const s: GameState = {
    ...base,
    gameTimeSeconds: T0 - 50_000,
    awayMembers: CREW.map((m) => ({ ...m })),
    nextAwayMemberId: 100,
    ships: base.ships.map((sh) => ({ ...sh, groundTeams: teams })),
  };
  const res = asPreCurveDispatch(dispatchPastPropulsion(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id));
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  const body = scannedBody(res.expedition.id, tasks.map((t) => t.poiId), 0.2);
  tasks.forEach((t, k) => {
    if (t.needs) body.activities[k].needs = { ...t.needs };
  });
  const exp = finish(res.expedition, body, {});
  return { state: { ...res.next, gameTimeSeconds: T0, expeditions: [exp] }, exp };
}

const shipOf = (s: GameState) => s.ships.find((x) => x.id === "ship-1") ?? null;

// A memo over a counting fake reader (a fixed tier), so a test can see exactly when a cell is read.
function countingMemo(): { memo: OddsMemo; calls: string[] } {
  const calls: string[] = [];
  const fake: ThreatAssessment = {
    tier: "even",
    name: "A Worthy Adversary",
    shortName: "Worthy",
    colorHex: "#d6c45a",
    fuzzyRange: "About even",
    voice: "Steady.",
  } as unknown as ThreatAssessment;
  const memo = createOddsMemo((_exp, crew, taskId) => {
    calls.push(`${taskId}|${crew.join("+")}`);
    return fake;
  });
  return { memo, calls };
}

// Apply an edit the screen built; throws when the engine refuses it.
function apply(state: GameState, expId: string, edit: GroundOpsEdit): GameState {
  const next = editGroundOps(state, expId, edit);
  if (next === state) throw new Error(`refused: ${JSON.stringify(edit)}`);
  return next;
}

// ===== tests =====

describe("GO-13 small words", () => {
  it("numerals, ordinals, crew keys", () => {
    expect([0, 1, 3, 9].map(bodyNumeral)).toEqual(["I", "II", "IV", "X"]);
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 103].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "103rd"]);
    expect(crewKey([0, 1])).toBe("0+1");
    expect(crewFromKey("0+1")).toEqual([0, 1]);
    expect(crewFromKey("")).toBeNull();
    expect(crewFromKey("a")).toBeNull();
  });

  it("needs read in the team-type phrasing of design 3.2", () => {
    expect(needsPhrase({ security: 1, science: 1 })).toBe("Ground team (or Strike + Survey together)");
    expect(needsPhrase({ security: 2, science: 0 })).toBe("Strike team");
    expect(needsPhrase({ security: 0, science: 2 })).toBe("Survey team");
    expect(needsPhrase({ security: 0, science: 1 })).toBe("1 Science squad (Survey or Ground)");
    expect(needsPhrase({ security: 1, science: 0 })).toBe("1 Security squad (Strike or Ground)");
    expect(needsPhrase({ security: 2, science: 1 })).toBe("Strike + Ground, or 2 Ground teams");
    expect(needsPhrase({ security: 4, science: 0 })).toBe("2 Strike teams");
    expect(needsPhrase({ security: 3, science: 2 })).toBe("3 Security squads + 2 Science squads");
  });

  it("difficulty: pips + grade + 'counts xN toward objective progress'; an unrated task shows none", () => {
    const v = difficultyView({ difficulty: 3 });
    expect(v).not.toBeNull();
    expect(v!.name).toBe("Challenging");
    expect(v!.pips).toEqual([true, true, true, false, false]);
    expect(v!.weightText).toBe("counts x3 toward objective progress");
    expect(difficultyView({ difficulty: 5 })!.weightText).toBe("counts x8 toward objective progress");
    expect(difficultyView({})).toBeNull();
    expect(difficultyView({ difficulty: 9 })).toBeNull();
  });
});

describe("GO-13 the queue screen on a one-team run", () => {
  it("one block per scanned body: title, count, a row per task with its card, odds and crew", () => {
    const { state, exp } = oneTeamRun(["mineralOutcrop", "caveNetwork", "crashedShip"]);
    const { memo } = countingMemo();
    const v = groundQueueView(exp, shipOf(state), T0, memo);
    expect(v.teams.map((t) => [t.index, t.letter, t.name, t.kindName])).toEqual([[0, "A", "Alpha", "Ground"]]);
    expect(v.bodies).toHaveLength(1);
    const body = v.bodies[0];
    expect(body.title).toBe(`${exp.systemName} b · Terrestrial`);
    expect(body.countText).toBe("3 objectives discovered");
    expect(body.rows.map((r) => r.name)).toEqual(["Mineral Outcrop", "Cave Network", "Crashed Ship"]);
    for (const r of body.rows) {
      expect(r.odds).toHaveLength(1);
      expect(r.odds[0].kind).toBe("chip");
      expect(r.crewText).toBe("Alpha");
      expect(r.options.map((o) => o.label)).toEqual(["Alpha"]);
      expect(r.needs.chips.every((c) => c.met)).toBe(true);
      expect(r.needs.coverText).toBe("Alpha (Ground)");
      expect(r.bar.total).toBeGreaterThan(0);
    }
    expect(v.stuck).toBeNull();
    expect(v.locked).toBeNull();
    expect(GROUND_QUEUE_NOTE).toBe("Nothing ever waits for you; reorder, reassign or skip at any time.");
    expect([DEFAULT_PLAN_LABEL, AUTO_ASSIGN_LABEL]).toEqual(["Default plan", "Auto-assign randomly"]);
  });

  it("the odds are read once per (expedition, task, team, pointsCleared, fightCount), never per tick", () => {
    const { state, exp } = oneTeamRun(["mineralOutcrop", "caveNetwork"]);
    const { memo, calls } = countingMemo();
    groundQueueView(exp, shipOf(state), T0, memo);
    expect(calls).toHaveLength(2);
    // Ticks that move nothing the read depends on: no new read.
    for (let t = T0 + 1; t < T0 + 20; t += 1) groundQueueView(advanceExpedition(exp, t), shipOf(state), t, memo);
    expect(calls).toHaveLength(2);
    // A fight point cleared: that task is read again.
    const moved = structuredClone(exp);
    moved.bodies[0].activities[1].pointsCleared = 1;
    groundQueueView(moved, shipOf(state), T0, memo);
    expect(calls).toEqual([`${exp.bodies[0].activities[0].id}|0`, `${exp.bodies[0].activities[1].id}|0`, `${exp.bodies[0].activities[1].id}|0`]);
    expect(memo.reads()).toBe(3);
  });

  it("the real reader returns a threat tier per covering team (ThreatChip's input)", () => {
    const { state, exp } = oneTeamRun(["caveNetwork"]);
    const v = groundQueueView(exp, shipOf(state), T0, createOddsMemo());
    const cell = v.bodies[0].rows[0].odds[0];
    expect(cell.kind).toBe("chip");
    if (cell.kind === "chip") {
      expect(typeof cell.assessment.name).toBe("string");
      expect(cell.context).toBe("Alpha odds");
    }
  });

  it("status: active with what the crew does, queued, skipped, done; the queue place and its arrows", () => {
    const { state, exp } = oneTeamRun(["mineralOutcrop", "caveNetwork", "crashedShip"]);
    const ship = shipOf(state);
    const { memo } = countingMemo();
    const rows = groundQueueView(exp, ship, T0, memo).bodies[0].rows;
    const active = rows.find((r) => r.status === "active")!;
    expect(active.statusText).toBe("Active");
    expect(active.statusDetail).toBe("Alpha dropping to the surface");
    expect(active.queue!.text).toBe("1st of 3 in Alpha's queue");
    expect(active.queue!.canUp).toBe(false);
    expect(active.queue!.canDown).toBe(true);
    const last = rows.find((r) => r.queue?.position === 3)!;
    expect(last.status).toBe("queued");
    expect(last.queue!.canDown).toBe(false);
    expect(last.queue!.upLabel).toBe(`Move ${last.name} earlier in Alpha's queue`);
    // Move the last one up: its place changes, the edit is the engine's reorder.
    const s1 = apply(state, exp.id, { kind: "reorder", teamIndex: last.queue!.teamIndex, taskId: last.id, delta: -1 });
    const after = groundQueueView(s1.expeditions[0], ship, T0, memo).bodies[0].rows.find((r) => r.id === last.id)!;
    expect(after.queue!.position).toBe(2);
    // Skip the ACTIVE task: it reads skipped, offers Re-queue with the same crews, no odds, no queue place.
    const s2 = apply(s1, exp.id, { kind: "skip", taskId: active.id });
    const skipped = groundQueueView(s2.expeditions[0], ship, T0, memo).bodies[0].rows.find((r) => r.id === active.id)!;
    expect(skipped.status).toBe("skipped");
    expect(skipped.canSkip).toBe(false);
    expect(skipped.canRequeue).toBe(true);
    expect(skipped.queue).toBeNull();
    expect(skipped.odds[0]).toEqual({ kind: "none", text: "-" });
    expect(skipped.crewKey).toBe("");
    const pick = defaultCrewPick(skipped, s2.expeditions[0].bodies[0].activities.find((a) => a.id === active.id));
    expect(pick).toBe("0");
    const requeue = crewEdit(skipped, pick)!;
    expect(requeue).toEqual({ kind: "requeue", taskId: active.id, teamIndex: 0 });
    const s3 = apply(s2, exp.id, requeue);
    expect(queueTaskStatus(s3.expeditions[0], s3.expeditions[0].bodies[0].activities.find((a) => a.id === active.id)!)).not.toBe("skipped");
  });

  it("a finished task reads done with a full bar and nothing to edit", () => {
    const { state, exp } = oneTeamRun(["mineralOutcrop"], { securityStrength: 400 });
    const done = advanceExpedition(exp, T0 + 200_000);
    const v = groundQueueView(done, shipOf(state), T0 + 200_000, createOddsMemo());
    expect(v.bodies).toHaveLength(1);
    const row = v.bodies[0].rows[0];
    expect(row.status).toBe("done");
    expect(row.bar.progressPct).toBe(100);
    expect(row.canAssign || row.canSkip || row.canRequeue).toBe(false);
    expect(row.queue).toBeNull();
    // Once the window has closed, the screen is locked and nothing is re-planned.
    expect(done.groundOps?.endedAt).toBeDefined();
    expect(v.locked).toBe("The ground operations are over: the ship is heading home.");
    expect(v.bodies[0].canReplan).toBe(false);
  });

  it("the fight bar: won pips, the label; zero fight points read 'No fights expected'", () => {
    const { exp } = oneTeamRun(["caveNetwork"]);
    const task = structuredClone(exp.bodies[0].activities[0]);
    task.fightPoints = [0.25, 0.5, 0.75];
    task.pointsCleared = 1;
    const bar = fightBarView(exp, task, T0);
    expect(bar.pips).toEqual([
      { at: 25, won: true },
      { at: 50, won: false },
      { at: 75, won: false },
    ]);
    expect(bar.label).toBe("1 of 3 fights won");
    expect(bar.fightsText).toBe("1 / 3");
    task.fightPoints = [];
    task.pointsCleared = 0;
    const calm = fightBarView(exp, task, T0);
    expect(calm.label).toBe(NO_FIGHTS_TEXT);
    expect(calm.fightsText).toBe("None");
    expect(calm.pips).toEqual([]);
  });

  it("the run-level stuck flag lists the stuck tasks; skipping them (the escape hatch) clears it", () => {
    const { state, exp } = oneTeamRun(["subterraneanCivilization", "derelictOutpost"], { members: LONER, securityStrength: 0, hazard: 0.9 });
    const T = T0 + 30_000;
    const stuckRun = advanceExpedition(exp, T);
    expect(groundOpsStuck(stuckRun)).toBe(true);
    let s: GameState = { ...state, gameTimeSeconds: T, expeditions: [stuckRun] };
    const v = groundQueueView(stuckRun, shipOf(s), T, createOddsMemo());
    expect(v.stuck).not.toBeNull();
    expect(v.stuck!.text).toBe(GROUND_OPS_STUCK_TEXT);
    expect(v.stuck!.text).toBe("Stuck: needs a stronger team or a skip");
    expect(v.stuck!.tasks.map((t) => t.name).sort()).toEqual(["Derelict Outpost", "Subterranean Civilization"]);
    const stuckRows = v.bodies[0].rows.filter((r) => r.status === "stuck" || r.status === "active");
    expect(stuckRows.length).toBeGreaterThan(0);
    expect(v.bodies[0].rows.some((r) => r.status === "stuck" && r.statusDetail?.includes(GROUND_OPS_STUCK_TEXT))).toBe(true);
    for (const t of v.stuck!.tasks) s = apply(s, exp.id, { kind: "skip", taskId: t.id });
    const after = groundQueueView(s.expeditions[0], shipOf(s), T, createOddsMemo());
    expect(after.stuck).toBeNull();
    expect(after.bodies[0].rows.every((r) => r.status === "skipped")).toBe(true);
  });

  it("a task sent to the back of the line while other work remains reads 'Sent back'", () => {
    const { exp } = oneTeamRun(["caveNetwork", "mineralOutcrop"]);
    const e = structuredClone(exp);
    const [a, b] = e.bodies[0].activities;
    a.status = "queued";
    a.sentBack = 1;
    b.status = "queued";
    expect(queueTaskStatus(e, a)).toBe("sentBack");
    b.status = "done";
    b.done = true;
    expect(queueTaskStatus(e, a)).toBe("stuck");
  });
});

describe("GO-13 squads: requirement chips, joint crews, 'Needs a partner'", () => {
  it("Strike + Survey: a {1,1} task needs both, so each column says 'Needs a partner' and the crew is joint", () => {
    const { state, exp } = twoTeamRun(["strike", "survey"], [{ poiId: "caveNetwork", needs: { security: 1, science: 1 } }, { poiId: "mineralOutcrop", needs: { security: 2, science: 0 } }]);
    const ship = shipOf(state);
    const { memo, calls } = countingMemo();
    const v = groundQueueView(exp, ship, T0, memo);
    expect(v.teams.map((t) => `${t.name} ${t.kindName}`)).toEqual(["Alpha Strike", "Bravo Survey"]);
    const [joint, clearing] = v.bodies[0].rows;
    expect(joint.odds.map((c) => c.kind)).toEqual(["partner", "partner"]);
    expect(joint.odds[0]).toEqual({ kind: "partner", text: NEEDS_PARTNER_TEXT });
    expect(joint.options.map((o) => [o.key, o.label])).toEqual([["0+1", "Alpha + Bravo (joint)"]]);
    expect(joint.crewKey).toBe("0+1");
    expect(joint.crewText).toBe("Alpha + Bravo");
    expect(joint.jointOdds).not.toBeNull();
    expect(joint.needs.phrase).toBe("Ground team (or Strike + Survey together)");
    expect(joint.needs.coverText).toBe("Alpha (Strike) + Bravo (Survey)");
    expect(joint.needs.chips.map((c) => [c.text, c.met])).toEqual([
      ["1 Security squad", true],
      ["1 Science squad", true],
    ]);
    // The joint crew's read is the pair; the Strike team alone covers the clearing task, Survey cannot.
    expect(calls).toContain(`${joint.id}|0+1`);
    expect(clearing.odds.map((c) => c.kind)).toEqual(["chip", "partner"]);
    expect(clearing.needs.phrase).toBe("Strike team");
    // AF-1 larger crews: the smallest crew first, then the larger one, marked with what it brings and its cost.
    expect(clearing.options.map((o) => [o.label, o.larger])).toEqual([
      ["Alpha", false],
      ["Alpha + Bravo (doubled)", true],
    ]);
    // The joint crew's re-queue edit carries the partner, and the engine accepts it.
    const s1 = apply(state, exp.id, { kind: "skip", taskId: joint.id });
    const skipped = groundQueueView(s1.expeditions[0], ship, T0, memo).bodies[0].rows[0];
    const edit = crewEdit(skipped, defaultCrewPick(skipped))!;
    expect(edit).toEqual({ kind: "requeue", taskId: joint.id, teamIndex: 0, partners: [1] });
    apply(s1, exp.id, edit);
  });

  it("unmet needs: a chip marked not met and the shortfall in plain words", () => {
    const { state, exp } = twoTeamRun(["ground", "ground"], [{ poiId: "enemyColony", needs: { security: 3, science: 1 } }]);
    const row = groundQueueView(exp, shipOf(state), T0, countingMemo().memo).bodies[0].rows[0];
    expect(row.status).toBe("skipped"); // the plan skipped it: no crew covers it
    expect(row.needs.covered).toBe(false);
    expect(row.needs.chips.map((c) => [c.text, c.met])).toEqual([
      ["3 Security squads", false],
      ["1 Science squad", true],
    ]);
    expect(row.needs.coverText).toBe("No deployed crew covers it: needs 3 Security squads, 2 deployed");
    expect(row.canRequeue).toBe(false);
  });

  it("Ground + Ground: reassign to the other team through the select's edit; Default plan and Auto-assign are accepted", () => {
    const { state, exp } = twoTeamRun(["ground", "ground"], ["mineralOutcrop", "caveNetwork", "crashedShip", "xenoFloraBloom"].map((poiId) => ({ poiId })));
    const ship = shipOf(state);
    const { memo } = countingMemo();
    const v = groundQueueView(exp, ship, T0, memo);
    const queued = v.bodies[0].rows.find((r) => r.status === "queued")!;
    expect(queued.options.map((o) => o.key)).toEqual(["0", "1", "0+1"]);
    const other = queued.options.find((o) => o.key !== queued.crewKey && !o.larger)!;
    const s1 = apply(state, exp.id, crewEdit(queued, other.key)!);
    const moved = groundQueueView(s1.expeditions[0], ship, T0, memo).bodies[0].rows.find((r) => r.id === queued.id)!;
    expect(moved.crewKey).toBe(other.key);
    expect(v.bodies[0].canReplan).toBe(true);
    const s2 = apply(s1, exp.id, { kind: "autoAssign", bodyIndex: v.bodies[0].bodyIndex });
    apply(s2, exp.id, { kind: "defaultPlan", bodyIndex: v.bodies[0].bodyIndex });
  });
});

describe("GO-13 log lines and text rules", () => {
  it("each edit kind has a plain log line", () => {
    const { state, exp } = twoTeamRun(["strike", "survey"], [{ poiId: "caveNetwork", needs: { security: 1, science: 1 } }]);
    const ship = shipOf(state);
    const id = exp.bodies[0].activities[0].id;
    const title = `${exp.systemName} b · Terrestrial`; // G2-2: a stamped run letters its bodies
    expect(groundOpsEditLogText(exp, ship, { kind: "assign", taskId: id, teamIndex: 0, partners: [1] })).toBe("Cave Network assigned to Alpha + Bravo.");
    expect(groundOpsEditLogText(exp, ship, { kind: "requeue", taskId: id, teamIndex: 1 })).toBe("Cave Network re-queued for Bravo.");
    expect(groundOpsEditLogText(exp, ship, { kind: "skip", taskId: id })).toBe("Skipped Cave Network.");
    expect(groundOpsEditLogText(exp, ship, { kind: "reorder", teamIndex: 0, taskId: id, delta: 1 })).toBe("Cave Network moved later in Alpha's queue.");
    expect(groundOpsEditLogText(exp, ship, { kind: "defaultPlan", bodyIndex: 0 })).toBe(`Default plan applied on ${title}.`);
    expect(groundOpsEditLogText(exp, ship, { kind: "autoAssign", bodyIndex: 0 })).toBe(`Queued objectives on ${title} auto-assigned at random.`);
    expect(groundOpsEditLogText(exp, ship, { kind: "setHelp", teamIndex: 1, on: true })).toBe("Bravo will help other teams when done.");
  });

  it("no em dash, no double hyphen, no 'fit' wording in anything the screen shows", () => {
    const { state, exp } = twoTeamRun(["strike", "survey"], [{ poiId: "caveNetwork", needs: { security: 1, science: 1 } }, { poiId: "mineralOutcrop", needs: { security: 2, science: 0 } }]);
    const text = JSON.stringify(groundQueueView(exp, shipOf(state), T0, countingMemo().memo)) + GROUND_QUEUE_NOTE;
    expect(text).not.toMatch(/\u2014|-{2}/);
    expect(text).not.toMatch(/\bfit(ting|ted|ment)?\b/i);
    // User 2026-10-14: player-facing text says "objective", never "task".
    expect(text.replace(/"(id|crewKey|key)":"[^"]*"/g, "")).not.toMatch(/\btasks?\b/i);
    expect(GROUND_QUEUE_NOTE + QUEUE_EMPTY_TEXT + STUCK_HINT).not.toMatch(/\btasks?\b/i);
  });
});

describe("AF-1 larger crews and affixes on the queue screen", () => {
  it("Ground + Ground: the select offers the doubled crew after the solo ones, and the engine accepts it", () => {
    const { state, exp } = twoTeamRun(["ground", "ground"], [{ poiId: "crashedShip" }, { poiId: "caveNetwork" }]);
    const ship = shipOf(state);
    const { memo } = countingMemo();
    const row = groundQueueView(exp, ship, T0, memo).bodies[0].rows[0];
    expect(row.options.map((o) => [o.key, o.label, o.larger, o.note])).toEqual([
      ["0", "Alpha", false, null],
      ["1", "Bravo", false, null],
      ["0+1", "Alpha + Bravo (doubled)", true, "Doubled crew: more punch and more fieldwork, one objective at a time."],
    ]);
    expect(row.options[2].crew).toBe("Alpha + Bravo");
    const edit = crewEdit(row, "0+1")!;
    expect(edit).toEqual({ kind: "assign", taskId: row.id, teamIndex: 0, partners: [1] });
    const s1 = apply(state, exp.id, edit);
    const after = groundQueueView(s1.expeditions[0], ship, T0, memo).bodies[0].rows[0];
    expect(after.crewKey).toBe("0+1");
    expect(after.crewText).toBe("Alpha + Bravo");
    expect(after.jointOdds).not.toBeNull(); // the larger crew's own tier on its card
    expect(defaultCrewPick(after)).toBe("0+1");
  });

  it("a larger crew reads doubled or larger, what the extra squads bring, always the cost", () => {
    expect(largerCrewWord(2, 1)).toBe("doubled");
    expect(largerCrewWord(3, 2)).toBe("larger crew");
    expect(largerCrewNote({ security: 2, science: 2 }, { security: 1, science: 1 })).toBe("more punch and more fieldwork, one objective at a time");
    expect(largerCrewNote({ security: 4, science: 0 }, { security: 2, science: 0 })).toBe("more punch, one objective at a time");
    expect(largerCrewNote({ security: 1, science: 1 }, { security: 1, science: 1 })).toBe("one objective at a time");
  });

  it("a row carries the affix pills and the alert; a finished one keeps its pills only", () => {
    const { state, exp } = twoTeamRun(["ground", "ground"], [{ poiId: "crashedShip" }]);
    const e = structuredClone(exp);
    const task = e.bodies[0].activities[0];
    Object.assign(task, { difficulty: 5, difficultyScore: 8, affixes: [{ id: "reinforcing", rank: 2, alignment: "negative" }], alert: { level: 3, lastAt: T0 - 60 } });
    const row = groundQueueView(e, shipOf(state), T0, countingMemo().memo).bodies[0].rows[0];
    expect(row.affixes!.pills.map((p) => p.label)).toEqual(["Reinforcing II"]);
    expect(row.affixes!.alert).toMatchObject({ held: true, headline: "Impossible: resets in 39m" });
    Object.assign(task, { status: "done", done: true });
    expect(groundQueueView(e, shipOf(state), T0, countingMemo().memo).bodies[0].rows[0].affixes).toMatchObject({ alert: null });
    task.affixes = undefined;
    task.alert = undefined;
    expect(groundQueueView(e, shipOf(state), T0, countingMemo().memo).bodies[0].rows[0].affixes).toBeNull();
  });
});
