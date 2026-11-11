// Expedition Tiers G2-5 (docs/plans/2026-10-14-expedition-tiers-g2-plan.md section 3 G2-5 and its USER ANSWERS): the
// recall and the resumable systems. 1:1 return times (the detour not counted), the window closing at the recall with
// progress kept and finished work brought home, the shared pickup, the held systems (an ordinary candidate again, or
// resumable by any explorer), abandon, the refusals, and offline == live on every recalled and resumed run.

import { describe, expect, it } from "vitest";
import { freshState, type AwayMember, type Expedition, type GameState, type ShipGroundTeam } from "./model";
import {
  ANOMALY_CHECK_FRACTION,
  abandonHeldSystem,
  advanceExpedition,
  canAbandonHeldSystem,
  canRecallExpedition,
  claimExpedition,
  expeditionCandidates,
  heldSystems,
  recallBlockText,
  recallExpedition,
  recallPreview,
  resumableSystems,
  returnDurationSeconds,
  startExpedition,
  tierCandidateSystems,
} from "./expedition";
import { REGION_TIERS } from "./galaxy";
import { WOLF_359_ID } from "./starCatalog";
import { IN_SYSTEM_LEG_SECONDS } from "./groundOps";
import { installMissingCombatBaselines } from "./tick";
import { asExpeditionVeteran, plainAwayMember } from "./awayTeamTestFixtures";

const T0 = 100_000;
const FINAL = T0 + 3_000_000;
const SEC = ["member-1", "member-2", "member-3", "member-4", "member-5", "member-6"];
const SCI = ["member-11", "member-12", "member-13", "member-14", "member-15", "member-16"];

function crewed(hull: "orion" | "aurora" | "eir" = "orion"): GameState {
  const base = freshState();
  const m = (id: string, t: AwayMember["teamType"]): AwayMember => ({ ...plainAwayMember(id, t, "ship-1"), rank: 10 as AwayMember["rank"] });
  const teams: ShipGroundTeam[] = [
    { kind: "ground", security: SEC.slice(0, 3), science: SCI.slice(0, 3), helpOthers: false },
    { kind: "ground", security: SEC.slice(3), science: SCI.slice(3), helpOthers: false },
  ];
  const s: GameState = {
    ...base,
    gameTimeSeconds: T0,
    nextExpeditionId: 2,
    awayMembers: [...SEC.map((id) => m(id, "security")), ...SCI.map((id) => m(id, "science"))],
    nextAwayMemberId: 100,
    ships: base.ships.map((sh) => ({ ...sh, typeKey: hull, groundTeams: teams })),
  };
  return asExpeditionVeteran(installMissingCombatBaselines(s));
}

function launched(cand = "cand-1-0", s: GameState = crewed()): { state: GameState; exp: Expedition } {
  const res = startExpedition(s, "ship-1", 1, cand);
  expect(res.success, res.reason).toBe(true);
  return { state: res.next, exp: res.expedition! };
}
const at = (state: GameState, t: number): GameState => ({ ...state, gameTimeSeconds: t });
const only = (state: GameState): Expedition => state.expeditions[0];

function phaseAnchors(exp: Expedition): Record<string, number> {
  const out: Record<string, number> = { [exp.phase]: exp.phaseAnchorSeconds };
  let e = exp;
  for (let t = exp.phaseAnchorSeconds + 61; e.phase !== "complete" && t < FINAL; t += 61) {
    e = advanceExpedition(e, t);
    if (!(e.phase in out)) out[e.phase] = e.phaseAnchorSeconds;
  }
  return out;
}

function chunked(exp: Expedition, from: number, to: number, step: number): Expedition {
  let e = exp;
  for (let t = from + step; t < to; t += step) e = advanceExpedition(e, t);
  return advanceExpedition(e, to);
}

// offline == live from `exp` to its end: one call == 997 s chunks == 1 s steps over 600 s around its last anchor.
function expectParity(exp: Expedition): Expedition {
  const frozen = structuredClone(exp);
  const anchors = phaseAnchors(exp);
  expect(anchors.complete).toBeDefined();
  const end = anchors.complete + 1;
  const one = advanceExpedition(exp, end);
  expect(chunked(exp, exp.phaseAnchorSeconds, end, 997)).toEqual(one);
  const from = Math.max(exp.phaseAnchorSeconds, Math.floor(anchors.complete) - 300);
  expect(chunked(advanceExpedition(exp, from), from, from + 600, 1)).toEqual(advanceExpedition(exp, from + 600));
  expect(exp).toEqual(frozen);
  return one;
}

describe("G2-5 recall in transit: home in the time flown (user #7), the system an ordinary candidate again", () => {
  it("at 40% of the outbound leg: the return is 40% of the return leg; the run claims and changes no counter", () => {
    const { state, exp } = launched();
    const v = exp.voyage!;
    const t = T0 + Math.round(v.outboundSeconds * 0.4);
    const s1 = recallExpedition(at(state, t), exp.id);
    const r = only(s1);
    expect(r.phase).toBe("return");
    expect(r.phaseAnchorSeconds).toBe(t);
    expect(r.recall).toEqual({
      version: 1,
      atSeconds: t,
      phaseAtRecall: "transit",
      flownSeconds: t - T0,
      pickupSeconds: 0,
      returnSeconds: Math.round((v.returnSeconds * (t - T0)) / v.outboundSeconds),
      held: `held-${exp.id}`,
    });
    expect(returnDurationSeconds(r)).toBe(r.recall!.returnSeconds);
    const home = advanceExpedition(r, t + r.recall!.returnSeconds);
    expect(home.phase).toBe("complete");
    expect(advanceExpedition(r, t + r.recall!.returnSeconds - 1).phase).toBe("return");
    const claim = claimExpedition({ ...s1, gameTimeSeconds: home.phaseAnchorSeconds, expeditions: [home] }, exp.id);
    expect(claim.success).toBe(true);
    expect(claim.next.expeditions).toEqual([]);
    expect(claim.next.runCounts).toEqual(s1.runCounts);
    expectParity(r);
  });

  it("the detour is not distance flown (G14): mid-detour the flown time holds at the anomaly check", () => {
    const { state, exp } = launched();
    const charted: Expedition = { ...exp, anomalyResolved: true, anomalyCharted: true };
    const v = exp.voyage!;
    const mid = v.outboundSeconds * ANOMALY_CHECK_FRACTION;
    const s = { ...state, expeditions: [charted] };
    const during = only(recallExpedition(at(s, T0 + Math.ceil(mid + v.anomalySeconds / 2)), exp.id));
    expect(during.recall!.flownSeconds).toBe(mid);
    const late = T0 + v.outboundSeconds + v.anomalySeconds - 10;
    const after = only(recallExpedition(at(s, late), exp.id));
    expect(after.recall!.flownSeconds).toBe(v.outboundSeconds - 10);
    expect(after.recall!.returnSeconds).toBeLessThanOrEqual(v.returnSeconds);
  });

  it("the system returns to the ordinary candidates of its tier and launches fresh from there; the list stays", () => {
    const { state, exp } = launched();
    const s1 = recallExpedition(at(state, T0 + 600), exp.id);
    expect(heldSystems(s1)).toMatchObject([{ id: `held-${exp.id}`, kind: "candidate", seed: exp.seed, systemName: exp.systemName }]);
    expect(resumableSystems(s1)).toEqual([]);
    const home = advanceExpedition(only(s1), FINAL);
    const s2 = claimExpedition({ ...s1, gameTimeSeconds: home.phaseAnchorSeconds, expeditions: [home] }, exp.id).next;
    const list = expeditionCandidates(s2, "ship-1", 1);
    expect(list.map((c) => c.id)).toEqual(["cand-1-0", "cand-1-1", "cand-1-2", `held-${exp.id}`]);
    expect(list[3]).toMatchObject({ seed: exp.seed, systemName: exp.systemName, region: { tier: 1 } });
    const again = startExpedition(s2, "ship-1", 1, `held-${exp.id}`);
    expect(again.success).toBe(true);
    expect(again.expedition!.seed).toBe(exp.seed);
    expect(again.expedition!.resume).toBeUndefined();
    expect(again.expedition!.bodies.map((b) => b.scanned)).toEqual(exp.bodies.map(() => false));
    expect(again.next.heldSystems).toEqual([]);
    expect(again.next.expeditionSeed).toBe(s2.expeditionSeed);
  });

  // G2-9 close-out (user 2026-10-19, "No limit, refresh normally (Recommended)": an ordinary candidate again): the
  // returned candidate rolls off with the next list draw, like the list's own three. A resumable system stays.
  it("a returned candidate rolls off with the next dispatch from the list; a resumable system stays", () => {
    const { state, exp } = launched();
    const s1 = recallExpedition(at(state, T0 + 600), exp.id);
    const home = advanceExpedition(only(s1), FINAL);
    const s2 = claimExpedition({ ...s1, gameTimeSeconds: home.phaseAnchorSeconds, expeditions: [home] }, exp.id).next;
    const resume = { ...heldSystems(s2)[0], id: "held-expedition-99", fromExpeditionId: "expedition-99", kind: "resume" as const, bodies: home.bodies, risk: home.risk };
    const s3 = { ...s2, heldSystems: [...heldSystems(s2), resume] };
    expect(expeditionCandidates(s3, "ship-1", 1).map((c) => c.id)).toContain(`held-${exp.id}`);
    const fromList = startExpedition(s3, "ship-1", 1, "cand-1-1");
    expect(fromList.success, fromList.reason).toBe(true);
    expect(fromList.next.heldSystems).toEqual([resume]);
    expect(fromList.next.expeditionSeed).not.toBe(s3.expeditionSeed);
    expect("heldLaunches" in fromList.next).toBe(false);
    const freed = { ...fromList.next, expeditions: [] };
    expect(expeditionCandidates(freed, "ship-1", 1).map((c) => c.id)).toEqual(["cand-1-0", "cand-1-1", "cand-1-2"]);
    // No held candidate: the dispatch leaves the held list as it was (the same reference, or no key at all).
    const plain = startExpedition(crewed(), "ship-1", 1, "cand-1-0");
    expect("heldSystems" in plain.next).toBe(false);
  });

  // G2-9 close-out (bug-check 2026-11-11): a launch to a held system is not from the list, so it must not reroll it.
  // Before the fix the Wolf 359 clock counted every dispatch, so a held launch after the first run moved slot 0 off
  // Wolf 359 (freshState(12345): Wolf 359, LB-6795, LB-0733 became LB-6210, LB-6795, LB-0733, expeditionSeed unchanged).
  it("a held launch leaves every tier's list deep-equal and a veteran's Wolf 359 stamp matched", () => {
    for (const veteran of [false, true]) {
      const base = { ...crewed(), nextExpeditionId: 1 };
      const s0 = veteran ? base : { ...base, runCounts: { ...base.runCounts!, expedition: { ...base.runCounts!.expedition, veteran: false } } };
      const first = startExpedition(s0, "ship-1", 1, "cand-1-0");
      expect(first.success, first.reason).toBe(true);
      const exp = first.expedition!;
      const listAfterFirst = tierCandidateSystems(first.next, 1);
      if (!veteran) expect(listAfterFirst[0].famousId).toBe(WOLF_359_ID);
      const s1 = recallExpedition(at(first.next, T0 + 600), exp.id);
      const home = advanceExpedition(only(s1), FINAL);
      const s2 = claimExpedition({ ...s1, gameTimeSeconds: home.phaseAnchorSeconds, expeditions: [home] }, exp.id).next;
      const before = REGION_TIERS.map((t) => tierCandidateSystems(s2, t));
      const again = startExpedition(s2, "ship-1", 1, `held-${exp.id}`);
      expect(again.success, again.reason).toBe(true);
      expect(again.next.expeditionSeed).toBe(s2.expeditionSeed);
      expect(again.next.heldLaunches).toBe(1);
      expect(REGION_TIERS.map((t) => tierCandidateSystems(again.next, t))).toEqual(before);
      expect(tierCandidateSystems(again.next, 1)).toEqual(listAfterFirst);
      expect(again.next.wolf359List).toBe(s2.wolf359List);
      if (veteran) {
        // The stamp names the list on screen or the next one: still the same list after the held launch.
        expect(typeof s2.wolf359List).toBe("number");
        const hasWolf = (st: GameState): boolean => tierCandidateSystems(st, 1)[0].famousId === WOLF_359_ID;
        expect(hasWolf(again.next)).toBe(hasWolf(s2));
      }
    }
  });
});

// The first moment in the window a crew is mid-objective with banked work still aboard to offload, or simply working.
function windowTimes(exp: Expedition): { open: number; close: number } {
  const anchors = phaseAnchors(exp);
  return { open: anchors.scanning, close: anchors.return };
}

describe("G2-5 recall after arrival: the window closes, finished work comes home, the system stays resumable", () => {
  it("at every 1,500 s of the window: pickup only when a team is down, 1:1 return leg, nothing left active", () => {
    const { state, exp } = launched();
    const { open, close } = windowTimes(exp);
    expect(close - open).toBeGreaterThan(3_000);
    let pickedUp = 0;
    for (let t = Math.ceil(open) + 1; t < close; t += 1_500) {
      const before = advanceExpedition(exp, t);
      const down = before.groundOps!.teams.some((team) => ["deploy", "work", "fight", "return"].includes(team.step));
      const preview = recallPreview(at(state, t), exp.id);
      const s1 = recallExpedition(at(state, t), exp.id);
      const r = only(s1);
      expect(preview).toEqual({ ok: true, preview: { phase: r.recall!.phaseAtRecall, returnSeconds: r.recall!.returnSeconds, pickupSeconds: r.recall!.pickupSeconds, held: heldSystems(s1)[0]?.kind ?? null } });
      expect(r.recall!.pickupSeconds).toBe(down ? IN_SYSTEM_LEG_SECONDS : 0);
      if (down) pickedUp += 1;
      expect(r.recall!.returnSeconds).toBe(r.recall!.pickupSeconds + exp.voyage!.returnSeconds);
      const ops = r.groundOps!;
      expect(ops.endedAt).toBe(t);
      expect(ops.recalledAt).toBe(t);
      const tasks = r.bodies.flatMap((b) => b.activities);
      expect(tasks.some((a) => a.status === "active")).toBe(false);
      for (const a of tasks) expect(a.segmentsOffloaded ?? 0, a.id).toBe(a.segmentsBanked ?? 0);
      for (const team of ops.teams) {
        expect(["idle", "bay"]).toContain(team.step);
        expect(team.pendingFight).toBeUndefined();
      }
      // Progress kept: every objective's points and progress at least what the run had at the recall.
      const had = before.bodies.flatMap((b) => b.activities);
      tasks.forEach((a, i) => {
        expect(a.pointsCleared ?? 0).toBe(had[i].pointsCleared ?? 0);
        expect(a.progress ?? 0).toBeGreaterThanOrEqual(had[i].progress ?? 0);
      });
      const done = expectParity(r);
      const claim = claimExpedition({ ...s1, gameTimeSeconds: done.phaseAnchorSeconds, expeditions: [done] }, exp.id);
      expect(claim.success).toBe(true);
      expect(claim.findings).toEqual(done.findings);
      expect(claim.next.runCounts).toEqual(s1.runCounts);
    }
    expect(pickedUp).toBeGreaterThan(0);
  });

  it("a recall with charted bodies leaves a resumable system: bodies, progress and objectives as the recall left them", () => {
    const { state, exp } = launched();
    const { open, close } = windowTimes(exp);
    const t = Math.round((open + close) / 2);
    const s1 = recallExpedition(at(state, t), exp.id);
    const [held] = heldSystems(s1);
    expect(held.kind).toBe("resume");
    expect(held.region).toEqual(exp.region);
    const r = only(s1);
    expect(held.bodies!.map((b) => b.scanned)).toEqual(r.bodies.map((b) => b.scanned));
    const tasks = held.bodies!.flatMap((b) => b.activities);
    expect(tasks.every((a) => a.done || (a.status === "queued" && a.assignedTeamIds === undefined))).toBe(true);
    const [view] = resumableSystems(s1, 1);
    expect(view).toMatchObject({ id: held.id, tier: 1, systemName: exp.systemName, bodies: exp.bodies.length });
    expect(view.bodiesScanned).toBeGreaterThan(0);
    expect(view.progress).toBeGreaterThan(0);
    expect(resumableSystems(s1, 2)).toEqual([]);
  });
});

describe("G2-5 resume: any explorer, pick up where you left off, the trip flown again", () => {
  function heldResume(): { state: GameState; held: string; recalled: Expedition } {
    const { state, exp } = launched();
    const { open, close } = windowTimes(exp);
    const t = Math.round(open + (close - open) * 0.6);
    const s1 = recallExpedition(at(state, t), exp.id);
    const home = advanceExpedition(only(s1), FINAL);
    const s2 = claimExpedition({ ...s1, gameTimeSeconds: home.phaseAnchorSeconds, expeditions: [home] }, exp.id).next;
    return { state: s2, held: heldSystems(s2)[0].id, recalled: home };
  }

  it("an Aurora resumes the Orion's system: charted bodies stay done, objectives keep progress, nothing pays twice", () => {
    const { state, held, recalled } = heldResume();
    const aurora = installMissingCombatBaselines({ ...state, ships: state.ships.map((s) => ({ ...s, typeKey: "aurora" as const })) });
    const res = startExpedition(aurora, "ship-1", 1, held);
    expect(res.success, res.reason).toBe(true);
    const run = res.expedition!;
    const charted = recalled.bodies.filter((b) => b.scanned).length;
    expect(run.resume).toEqual({ version: 1, heldId: held, scannedBodies: charted });
    expect(run.anomalyResolved).toBe(true);
    expect(run.seed).toBe(recalled.seed);
    expect(run.voyage!.tier).toBe(1);
    expect(res.next.heldSystems).toEqual([]);
    // The window opens when the trip out ends (no detour: the anomaly was met on the first trip), past the charted
    // bodies: they stay scanned and the next scan starts at once (the clock skip is their time on this run's sensors).
    const open = run.phaseAnchorSeconds + run.voyage!.outboundSeconds;
    const opened = advanceExpedition(run, open);
    expect(opened.phase === "scanning" || opened.phase === "activities").toBe(true);
    expect(opened.bodies.slice(0, charted).every((b) => b.scanned)).toBe(true);
    expect(opened.groundOps!.startedAt! + (opened.groundOps!.scanClockSkip ?? 0)).toBe(open);
    if (charted < run.bodies.length) expect(opened.groundOps!.scanClockSkip!).toBeGreaterThan(0);
    const done = expectParity(run);
    expect(done.bodies.every((b) => b.scanned)).toBe(true);
    // An objective done on the first trip pays nothing on this one; every finding is this run's.
    const firstDone = recalled.bodies.flatMap((b) => b.activities.filter((a) => a.done).map((a) => a.id));
    for (const f of done.findings) {
      expect(f.id.startsWith(`${run.id}-`)).toBe(true);
      for (const id of firstDone) expect(f.id.startsWith(`${run.id}-find-task-${id}-s`), f.id).toBe(false);
    }
    // Objectives in progress on the first trip finish from their kept progress: no task loses cleared fight points.
    const before = new Map(recalled.bodies.flatMap((b) => b.activities).map((a) => [a.id, a.pointsCleared ?? 0] as const));
    for (const a of done.bodies.flatMap((b) => b.activities)) expect(a.pointsCleared ?? 0).toBeGreaterThanOrEqual(before.get(a.id) ?? 0);
    const claim = claimExpedition({ ...res.next, gameTimeSeconds: done.phaseAnchorSeconds, expeditions: [done] }, run.id);
    expect(claim.success).toBe(true);
  });

  it("recalled with one body charted of several: the resumed run scans the rest from its window's opening", () => {
    // A system with two or more bodies (cand-1-0 to cand-1-2 of the fixture; the first with 2+).
    const base = crewed();
    const cand = ["cand-1-0", "cand-1-1", "cand-1-2"].map((id) => launched(id, base)).find(({ exp }) => exp.bodies.length >= 2);
    expect(cand).toBeDefined();
    const { state, exp } = cand!;
    const { open, close } = windowTimes(exp);
    let t = Math.ceil(open);
    while (t < close && advanceExpedition(exp, t).bodies.filter((b) => b.scanned).length !== 1) t += 30;
    expect(t).toBeLessThan(close);
    const s1 = recallExpedition(at(state, t), exp.id);
    const home = advanceExpedition(only(s1), FINAL);
    const s2 = claimExpedition({ ...s1, gameTimeSeconds: home.phaseAnchorSeconds, expeditions: [home] }, exp.id).next;
    const [held] = heldSystems(s2);
    expect(held.kind).toBe("resume");
    const res = startExpedition(s2, "ship-1", 1, held.id);
    expect(res.success).toBe(true);
    const run = res.expedition!;
    expect(run.resume!.scannedBodies).toBe(1);
    expect(run.bodies[1].scanned).toBe(false);
    expect(run.bodies[1].scanProgress).toBe(0);
    const openAt = run.phaseAnchorSeconds + run.voyage!.outboundSeconds;
    const opened = advanceExpedition(run, openAt);
    expect(opened.groundOps!.scanClockSkip!).toBeGreaterThan(0);
    expect(opened.groundOps!.startedAt! + opened.groundOps!.scanClockSkip!).toBe(openAt);
    expect(opened.scanStepCursor).toBe((run.encounterSteps ?? 1) - 1);
    const done = expectParity(run);
    expect(done.bodies.every((b) => b.scanned)).toBe(true);
  });

  it("a non-explorer cannot resume it (the propulsion gates apply)", () => {
    const { state, held } = heldResume();
    const freighter = { ...state, ships: state.ships.map((s) => ({ ...s, typeKey: "generalFreighter" as const })) };
    expect(startExpedition(freighter, "ship-1", 1, held).reason).toBe("notExplorer");
  });

  it("abandon lets the saved progress go, once; anything else is refused with the same state", () => {
    const { state, held } = heldResume();
    expect(canAbandonHeldSystem(state, held)).toBe(true);
    const gone = abandonHeldSystem(state, held);
    expect(heldSystems(gone)).toEqual([]);
    expect(abandonHeldSystem(gone, held)).toBe(gone);
    expect(canAbandonHeldSystem(state, "held-nope")).toBe(false);
    expect(startExpedition(gone, "ship-1", 1, held).reason).toBe("noSuchCandidate");
  });
});

describe("G2-5 refusals and neutrality", () => {
  it("refused while returning, once complete, and for an unknown run: the SAME state", () => {
    const { state, exp } = launched();
    const s1 = recallExpedition(at(state, T0 + 100), exp.id);
    expect(recallExpedition(s1, exp.id)).toBe(s1);
    expect(canRecallExpedition(s1, exp.id)).toEqual({ ok: false, reason: "returning" });
    const end = at(state, FINAL);
    expect(canRecallExpedition(end, exp.id)).toEqual({ ok: false, reason: "complete" });
    expect(recallExpedition(end, exp.id)).toBe(end);
    expect(recallExpedition(state, "expedition-99")).toBe(state);
    expect(recallPreview(state, "expedition-99")).toEqual({ ok: false, reason: "noExpedition" });
    for (const r of ["noExpedition", "returning", "complete"] as const) expect(recallBlockText(r)).not.toMatch(/—|--/);
  });

  it("a recall at the dispatch instant flies straight home (0 s) and never longer than an ordinary return", () => {
    const { state, exp } = launched();
    const r = only(recallExpedition(state, exp.id));
    expect(r.recall!.returnSeconds).toBe(0);
    expect(advanceExpedition(r, T0).phase).toBe("complete");
    expect(returnDurationSeconds(advanceExpedition(exp, FINAL - 1))).toBe(exp.voyage!.returnSeconds);
  });

  it("a run nobody recalls is untouched: no recall field, no held system, the same timeline", () => {
    const { state, exp } = launched();
    const done = advanceExpedition(exp, FINAL);
    expect("recall" in done).toBe(false);
    expect("resume" in exp).toBe(false);
    expect(state.heldSystems).toBeUndefined();
    expect(done.groundOps!.recalledAt).toBeUndefined();
  });
});
