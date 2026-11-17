// Ground Operations GO-7b: the timeline engine, one team (groundOps.ts advanceGroundOpsWindow and the step
// machine). Hand-built runs: a real dispatch (roster snapshot, frozen factors), then ONE synthetic scanned body
// whose tasks are stamped and planned, so each test controls the sites, the hazard and the squad's strength.
// The scan side (overlap, recovery legs) and the parity suite are in groundOpsParity.test.ts.

import { afterEach, describe, expect, it } from "vitest";
import {
  freshState,
  type AwayMember,
  type EquipmentInstance,
  type Expedition,
  type ExpeditionBody,
  type ExpeditionPlanetType,
  type GameState,
  type GroundFightRecord,
  type GroundStepRecord,
  type GroundTeamRun,
} from "./model";
import { advanceExpedition, claimExpedition, expeditionCandidates, expeditionDispatchBlockText, expeditionPhaseFraction } from "./expedition";
import {
  DEPLOY_SECONDS,
  GROUND_HISTORY_CAP,
  GROUND_OPS_STUCK_TEXT,
  GROUND_STUCK_LOSSES,
  IN_SYSTEM_LEG_SECONDS,
  OFFLOAD_BASE_SECONDS,
  RELOAD_BASE_SECONDS,
  RETURN_SECONDS,
  groundOpsAssignIdle,
  groundOpsBodyScanned,
  groundOpsProgress,
  groundOpsStuck,
  groundTaskFindingId,
  groundTaskStuck,
  groundTeamBaySeconds,
  groundTeamStuck,
  scanClockToTime,
} from "./groundOps";
import { fightPointFractions, segmentHaul, taskFullHaul, taskWorkSeconds } from "./groundTasks";
import { resolveTaskFight, taskFightSeconds } from "./groundFight";
import { asPreSafeFirstRunsDispatch, plainAwayMember, registerSyntheticHull, withSlottedAwayTeams, dispatchPastPropulsion } from "./awayTeamTestFixtures";
import type { ShipTypeKey } from "./model";
import { crewModuleSiOffForThisFile } from "./crewModuleSiSwitch.fixture";

// Standard-Issue crew modules (0.14.0, user 2026-11-17 "free basic set, all ships"): this file's pins predate the
// free Sensor Suite, Bridge Module and Crew Quarters every ship now carries (their berths, officer lift, hull bonus
// and equipment ids), so the set is off here and the pins keep proving their own slice. The set itself is pinned in
// crewModuleStandardIssue.test.ts.
crewModuleSiOffForThisFile();

// ===== fixtures =====

const T0 = 100_000; // the synthetic window opens here (phase "activities", every body scanned)
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

function hardsuit(wearer: string, hazardPoints: number): EquipmentInstance {
  return {
    id: "equip-901",
    slotType: "memberArmor",
    moduleVariant: "assaultHardsuit",
    rarity: "standard",
    ascension: "none",
    quality: 0,
    iLevel: 10,
    blueprintKey: "assaultHardsuitBp",
    implicitStats: { groundArmor: 4, groundHp: 4 },
    rolledStats: hazardPoints > 0 ? { groundHazardResist: hazardPoints } : {},
    mass: 0,
    powerDraw: 0,
    durabilityMax: 100,
    fittedToShipId: null,
    fittedToMemberId: wearer,
  } as EquipmentInstance;
}

interface Setup {
  members?: AwayMember[];
  gear?: EquipmentInstance[];
  poiIds: string[];
  hazard?: number;
  planetType?: ExpeditionPlanetType;
  seed?: number;
  securityStrength?: number;
  state?: (s: GameState) => GameState;
}

// A dispatched Ground Ops run turned into a one-body run whose window opened at T0 with the body scanned,
// its tasks stamped, planned and the team deployed (the moment a body completes in a real run).
function opsRun(setup: Setup): { state: GameState; exp: Expedition } {
  const base = freshState();
  let s: GameState = withSlottedAwayTeams({
    ...base,
    gameTimeSeconds: T0 - 50_000,
    awayMembers: (setup.members ?? SQUAD).map((m) => ({ ...m })),
    equipment: [...base.equipment, ...(setup.gear ?? [])],
    nextAwayMemberId: 100,
  });
  if (setup.state) s = setup.state(s);
  // Safe first runs SF-2: the run as dispatched before SF-2 (the 30 minute shakedown legs these timings were written
  // around; withoutSafeFirstRuns).
  const res = asPreSafeFirstRunsDispatch(dispatchPastPropulsion(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id));
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  const dispatched = res.expedition;
  const body: ExpeditionBody = {
    id: "body-1",
    planetType: setup.planetType ?? "terrestrial",
    scanTotal: 100,
    scanProgress: 100,
    hazard: setup.hazard ?? 0.2,
    scanned: true,
    discoveries: setup.poiIds.map((poiId, k) => ({ id: `${dispatched.id}-body-1-disc-${k}`, kind: "landmark", poiId })),
    activities: setup.poiIds.map((poiId, k) => ({ id: `${dispatched.id}-body-1-act-${k}`, bodyId: "body-1", poiId, done: false })),
  };
  const exp: Expedition = structuredClone({
    ...dispatched,
    seed: setup.seed ?? dispatched.seed,
    ...(setup.securityStrength !== undefined ? { securityStrength: setup.securityStrength } : {}),
    phase: "activities",
    phaseAnchorSeconds: T0,
    bodies: [body],
    groundOps: { ...dispatched.groundOps!, startedAt: T0 },
  });
  // The body's scan completes at T0 (the first scanned body: the team can first act now), then the team deploys.
  groundOpsBodyScanned(exp, 0, T0);
  groundOpsAssignIdle(exp, T0);
  return { state: { ...res.next, gameTimeSeconds: T0 }, exp };
}

const teamOf = (e: Expedition): GroundTeamRun => e.groundOps!.teams[0];
const historyOf = (e: Expedition): GroundStepRecord[] => e.groundOps!.history.filter((r) => r.teamIndex === 0);
const tasksOf = (e: Expedition) => e.bodies.flatMap((b) => b.activities);

// The fight records of a run as they were resolved (each fight's pendingFight, read mid-step), in order.
function fightRecords(
  start: Expedition,
  end: Expedition,
  from = -Infinity,
): { rec: GroundFightRecord; taskId: string; startedAt: number; downedBefore: string[]; carry: GroundTeamRun["carry"] }[] {
  return historyOf(end)
    .filter((r) => r.step === "fight" && r.startedAt >= from)
    .map((r) => {
      const mid = advanceExpedition(start, r.startedAt + 0.5);
      const team = teamOf(mid);
      return { rec: team.pendingFight!, taskId: r.taskId!, startedAt: r.startedAt, downedBefore: [...team.downedThisTask], carry: team.carry };
    });
}

// Search the run seed for a hand-built run satisfying `pred` once advanced to `until`.
function findOps(
  setup: Omit<Setup, "seed">,
  pred: (done: Expedition, start: Expedition) => boolean,
  until = FAR,
  limit = 300,
): { state: GameState; exp: Expedition; done: Expedition } {
  for (let i = 0; i < limit; i++) {
    const run = opsRun({ ...setup, seed: (0x5eed0001 + i * 7919) >>> 0 });
    const done = advanceExpedition(run.exp, until);
    if (pred(done, run.exp)) return { ...run, done };
  }
  throw new Error("no run satisfied the precondition");
}

// ===== tests =====

describe("GO-7b dispatch: slotted ground teams, no automatic stand-ins", () => {
  it("a ready member who is aboard but UNSLOTTED never stands in: the run is refused with the new text", () => {
    const s0 = withSlottedAwayTeams({ ...freshState(), awayMembers: LONER.map((m) => ({ ...m })), nextAwayMemberId: 100 });
    const unslotted: GameState = {
      ...s0,
      ships: s0.ships.map((sh) => ({ ...sh, groundTeams: sh.groundTeams!.map((t) => ({ ...t, security: t.security.map(() => null) })) })),
    };
    const res = dispatchPastPropulsion(unslotted, "ship-1", 1, expeditionCandidates(unslotted, "ship-1")[0].id);
    expect(res.success).toBe(false);
    expect(res.reason).toBe("needsAwayTeam");
    expect(expeditionDispatchBlockText("needsAwayTeam")).toBe(
      "Needs a ground team with at least 1 Security and 1 Science member slotted and ready: set it up on the ship's Away Team tab",
    );
    const ok = dispatchPastPropulsion(s0, "ship-1", 1, expeditionCandidates(s0, "ship-1")[0].id);
    expect(ok.success).toBe(true);
    expect(ok.expedition!.groundOps!.teams.map((t) => [t.securityIds, t.scienceIds])).toEqual([[["member-1"], ["member-11"]]]);
  });
});

describe("GO-7b stamping and planning", () => {
  it("a scanned body's tasks are stamped (fight points from the site, queued) and queued EASIEST first", () => {
    const { exp } = opsRun({ poiIds: ["subterraneanCivilization", "mineralOutcrop", "crashedShip"], hazard: 0.2 });
    const [civ, outcrop, crashed] = tasksOf(exp);
    expect(civ.fightPoints).toEqual(fightPointFractions(4));
    expect(outcrop.fightPoints).toEqual(fightPointFractions(1));
    // Squads SQ-3: the squad needs are stamped (one Ground team's worth), never requiredTeams.
    expect(crashed).toMatchObject({ needs: { security: 1, science: 1 }, progress: 0, pointsCleared: 0, segmentsBanked: 0, segmentsOffloaded: 0, fightCount: 0 });
    expect("requiredTeams" in crashed).toBe(false);
    expect(crashed.assignedTeamIds).toEqual([0]);
    // The 1-fight outcrop rates easiest, the 4-fight civilization hardest.
    const queue = teamOf(exp).queue;
    expect(queue[0]).toBe(outcrop.id);
    expect(queue[queue.length - 1]).toBe(civ.id);
    // ...and the team deployed on the head of its queue at once.
    expect(teamOf(exp)).toMatchObject({ step: "deploy", taskId: outcrop.id, stepStartedAt: T0, stepEndsAt: T0 + DEPLOY_SECONDS });
    expect(outcrop.status).toBe("active");
  });

  it("the first scanned body is when the teams can first act: an idle team's stepStartedAt moves there", () => {
    const { exp } = opsRun({ poiIds: [] });
    const e = structuredClone(exp);
    e.bodies = [{ ...e.bodies[0], scanned: false, activities: [], discoveries: [] }];
    teamOf(e).stepStartedAt = 1;
    e.bodies[0].scanned = true;
    groundOpsBodyScanned(e, 0, T0 + 123);
    expect(teamOf(e)).toMatchObject({ step: "idle", stepStartedAt: T0 + 123 });
  });
});

describe("GO-7b one task, start to finish", () => {
  it("a 3-fight task with a strong squad: work, fight x3, work, done; 4 segments; findings only at offload end; the relic on the completing batch", () => {
    const { state, exp } = opsRun({ poiIds: ["crashedShip"], securityStrength: 400 });
    const done = advanceExpedition(exp, FAR);
    const task = tasksOf(done)[0];
    expect(task).toMatchObject({ status: "done", done: true, progress: 1, pointsCleared: 3, segmentsBanked: 4, segmentsOffloaded: 4, fightCount: 3 });
    expect(task.segmentBankers).toEqual([[0], [0], [0], [0]]);
    const steps = historyOf(done).map((r) => r.step);
    expect(steps.slice(0, 9)).toEqual(["deploy", "work", "fight", "work", "fight", "work", "fight", "work", "return"]);
    expect(steps[9]).toBe("offload");
    expect(historyOf(done).filter((r) => r.step === "fight").map((r) => r.outcome)).toEqual(["win", "win", "win"]);
    expect(task.completedAt).toBe(historyOf(done)[7].endedAt);
    // The findings land at the offload END, not before.
    const offload = historyOf(done)[9];
    const before = advanceExpedition(exp, offload.endedAt - 0.5);
    expect(before.findings.filter((f) => f.source === "activity")).toEqual([]);
    const after = advanceExpedition(exp, offload.endedAt);
    const found = after.findings.filter((f) => f.source === "activity");
    expect(found.map((f) => f.id)).toEqual([groundTaskFindingId(exp, task.id, 0, 3)]);
    expect("relic" in found[0]).toBe(true);
    // The batch is the task's whole haul at the banking team's yield (the segments sum exactly).
    const ops = exp.groundOps!;
    const full = taskFullHaul(exp, [{ ...teamOf(exp), scienceShare: ops.factors.scienceShare[0] }], exp.bodies[0], task.poiId, 0);
    expect(found[0].materials).toEqual(full.materials);
    expect(found[0].credits).toBe(full.credits);
    // The window closes (the one task done, the team in the bay or reloading), the run returns and completes.
    expect(done.groundOps!.endedAt).toBeDefined();
    expect(done.phase).toBe("complete");
    const claimed = claimExpedition({ ...state, gameTimeSeconds: FAR, expeditions: [done] }, done.id);
    expect(claimed.success).toBe(true);
    expect(claimed.injuries).toEqual([]);
  });

  it("a wipe at fight 2, then a strong retry: progress held at the point, segments 0..1 offloaded once, the retry re-fights point 2 on a fresh encounter", () => {
    const { exp, done: lost } = findOps({ poiIds: ["crashedShip"], members: LONER, securityStrength: 6 }, (d) => {
      const fights = historyOf(d).filter((r) => r.step === "fight");
      return fights.length >= 2 && fights[0].outcome === "win" && fights[1].outcome === "loss";
    });
    const lossAt = historyOf(lost).filter((r) => r.step === "fight")[1].endedAt;
    const atLoss = advanceExpedition(exp, lossAt);
    const held = tasksOf(atLoss)[0];
    expect(held).toMatchObject({ status: "queued", pointsCleared: 1, progress: held.fightPoints![1], segmentsBanked: 2, fightCount: 2 });
    expect(teamOf(atLoss).step).toBe("return");
    expect(teamOf(atLoss).carry).toBeUndefined(); // the carry is dropped after a wipe
    // The strong retry fixture: the same stored run, its squad's crew layer raised from here on.
    const strong: Expedition = { ...atLoss, securityStrength: 400 };
    const done = advanceExpedition(strong, FAR);
    const task = tasksOf(done)[0];
    expect(task).toMatchObject({ status: "done", pointsCleared: 3, segmentsBanked: 4, segmentsOffloaded: 4 });
    const records = fightRecords(strong, done, lossAt);
    // The retry's first fight is point 2 (index 1) as the task's THIRD fight (a different stream key).
    expect(records[0].rec.pointIndex).toBe(1);
    expect(records[0].rec.fightNumber).toBe(2);
    expect(tasksOf(advanceExpedition(strong, records[0].startedAt + 0.5))[0].fightCount).toBe(3);
    // No segment is ever banked twice (user 9b.1): the batches tile 0..3 exactly once.
    const ids = done.findings.filter((f) => f.source === "activity").map((f) => f.id);
    expect(ids).toEqual([groundTaskFindingId(exp, task.id, 0, 1), groundTaskFindingId(exp, task.id, 2, 3)]);
    const [first, last] = done.findings.filter((f) => f.source === "activity");
    expect("relic" in first).toBe(false);
    expect("relic" in last).toBe(true);
  });

  it("carry damage (user Q5): each fight after a win starts from the last fight's memberEnd; a wipe and the bay drop it", () => {
    const { exp, done } = findOps({ poiIds: ["derelictOutpost", "crashedShip"], securityStrength: 30 }, (d) => {
      const fights = historyOf(d).filter((r) => r.step === "fight");
      return fights.length >= 4 && fights.some((r) => r.outcome === "loss") && fights.some((r) => r.outcome === "win");
    });
    const records = fightRecords(exp, done);
    let hurtCarry = false;
    for (let i = 0; i < records.length; i++) {
      const { rec, taskId, carry, downedBefore } = records[i];
      const prev = records[i - 1];
      const sameAttempt = prev !== undefined && prev.taskId === taskId && prev.rec.outcome === "win" && rec.fightNumber === prev.rec.fightNumber + 1;
      if (sameAttempt) {
        expect(carry).toEqual(prev.rec.memberEnd);
        if (Object.values(carry ?? {}).some((c) => c.hp < c.hpMax)) hurtCarry = true;
      } else {
        expect(carry).toBeUndefined();
      }
      // The record is exactly the GO-5 fight on that carry and that sit-out list.
      const ref = done.bodies[0].activities.findIndex((a) => a.id === taskId);
      const task = { ...done.bodies[0].activities[ref], fightCount: rec.fightNumber, pointsCleared: rec.pointIndex };
      const ops = exp.groundOps!;
      const side = [{ securityIds: teamOf(exp).securityIds, downedThisTask: downedBefore, securityShare: ops.factors.securityShare[0] }];
      expect(resolveTaskFight(exp, side, done.bodies[0], task, ref, carry)).toEqual(rec);
    }
    expect(hurtCarry).toBe(true);
  });

  it("a member downed in a WON fight sits out the task's later fights, and fights again after the bay", () => {
    const fielded = (rec: GroundFightRecord): string[] => [...Object.keys(rec.memberEnd), ...rec.downedMemberIds];
    // A won fight with someone down, followed by another fight of the same attempt, and a later trip's fight.
    const shape = (start: Expedition, done: Expedition) => {
      const records = fightRecords(start, done);
      const k = records.findIndex(
        (r, i) => r.rec.outcome === "win" && r.rec.downedMemberIds.length > 0 && records[i + 1]?.taskId === r.taskId && records[i + 1].rec.fightNumber === r.rec.fightNumber + 1,
      );
      if (k < 0) return null;
      const bay = historyOf(done).find((r) => r.step === "bay" && r.startedAt > records[k].startedAt);
      const later = bay ? records.find((r) => r.startedAt > bay.endedAt) : undefined;
      return later ? { records, k, later } : null;
    };
    const { exp, done } = findOps({ poiIds: ["derelictOutpost", "subterraneanCivilization", "crashedShip"], securityStrength: 40 }, (d, start) => shape(start, d) !== null, T0 + 60_000);
    const { records, k, later } = shape(exp, done)!;
    const out = records[k].rec.downedMemberIds;
    expect(out.length).toBeGreaterThan(0);
    // The same attempt = no new drop (deploy) between two fights of the task.
    const deploys = historyOf(done).filter((r) => r.step === "deploy").map((r) => r.startedAt);
    const sameAttempt = (a: number, b: number) => !deploys.some((t) => t > records[a].startedAt && t < records[b].startedAt);
    let checked = 0;
    for (let i = k + 1; i < records.length && records[i].taskId === records[k].taskId && sameAttempt(k, i); i++) {
      for (const id of out) expect(fielded(records[i].rec)).not.toContain(id);
      expect(records[i].downedBefore).toEqual(expect.arrayContaining(out));
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
    for (const id of out) expect(fielded(later.rec)).toContain(id);
  });
});

describe("GO-7b return trip: offload, bay, reload", () => {
  // A run whose team is mid-offload at T0 + 10 on a done task, with the given conditions gathered on the trip.
  function inOffload(conditions: Record<string, string[]>, members: AwayMember[]): { state: GameState; exp: Expedition } {
    // A second task stays queued so the window stays open through the bay and the reload.
    const run = opsRun({ poiIds: ["mineralOutcrop", "mineralOutcrop"], members });
    const e = structuredClone(run.exp);
    const task = e.bodies[0].activities[0];
    Object.assign(task, { status: "done", done: true, progress: 1, pointsCleared: 1, segmentsBanked: 2, segmentsOffloaded: 2, completedAt: T0 });
    Object.assign(teamOf(e), { step: "offload", stepStartedAt: T0, stepEndsAt: T0 + 10, taskId: task.id, conditions });
    return { state: run.state, exp: e };
  }

  it("the bay lasts the LONGEST member condition; the mockup bay (a Fracture on an Ossir member) is 2250 s with no care", () => {
    const members = [
      member("member-1", "security", { race: "ossir" }),
      member("member-2", "security"),
      member("member-3", "security"),
      member("member-11", "science"),
    ];
    const conditions = { "member-1": ["fracture"], "member-2": ["health", "poison"], "member-3": ["concussion"] };
    const { exp } = inOffload(conditions, members);
    expect(exp.roster!.security[0].perks).toEqual(["stoneskin"]);
    expect(groundTeamBaySeconds(exp, teamOf(exp))).toEqual({ "member-1": 2250, "member-2": 60, "member-3": 900, "member-11": 0 });
    const e = advanceExpedition(exp, T0 + 11);
    expect(teamOf(e)).toMatchObject({ step: "bay", stepStartedAt: T0 + 10, stepEndsAt: T0 + 10 + 2250, bayStart: T0 + 10 });
    expect(teamOf(e).bayEnds).toEqual({ "member-1": T0 + 2260, "member-2": T0 + 70, "member-3": T0 + 910 });
    // Healed at the bay's end: the trip's conditions and the task's downed list are cleared, then the reload.
    const healed = advanceExpedition(exp, T0 + 2261);
    expect(teamOf(healed)).toMatchObject({ step: "reload", conditions: {}, downedThisTask: [] });
  });

  it("nobody hurt: no bay step (straight to the reload)", () => {
    const { exp } = inOffload({}, LONER);
    const e = advanceExpedition(exp, T0 + 11);
    expect(teamOf(e)).toMatchObject({ step: "reload", stepStartedAt: T0 + 10 });
    expect(teamOf(e).bayEnds).toEqual({});
  });

  it("run end: the window closes with the team in the bay; the return leg runs; the claim injures exactly the members still in it", () => {
    const members = [member("member-1", "security", { race: "ossir" }), member("member-2", "security"), member("member-11", "science")];
    const { state, exp } = inOffload({ "member-1": ["fracture"], "member-2": ["health"] }, members);
    Object.assign(exp.bodies[0].activities[1], { status: "skipped" }); // the only other task is out of play
    const e = advanceExpedition(exp, T0 + 11);
    expect(e.groundOps!.endedAt).toBe(T0 + 10);
    expect(e.phase).toBe("return");
    const done = advanceExpedition(exp, T0 + 10 + 1800);
    expect(done.phase).toBe("complete"); // the shakedown return leg (1800 s)
    const now = T0 + 1810;
    const claimed = claimExpedition({ ...state, gameTimeSeconds: now, expeditions: [done] }, done.id);
    expect(claimed.injuries).toEqual([{ memberId: "member-1", recoverySeconds: T0 + 2260 - now, untilSeconds: T0 + 2260 }]);
    const m1 = claimed.next.awayMembers.find((m) => m.id === "member-1")!;
    expect(m1).toMatchObject({ injuredUntilSeconds: T0 + 2260, injuredAtSeconds: T0 + 10 });
    expect(claimed.next.awayMembers.find((m) => m.id === "member-2")!.injuredUntilSeconds).toBeUndefined();
  });

  const crewed = (s: GameState): GameState => ({
    ...s,
    ships: s.ships.map((sh) =>
      sh.id === "ship-1"
        ? {
            ...sh,
            complement: {
              mode: "passive",
              buckets: [{ profession: "operations", rarity: "standard", rank: 3, race: "earthBorn", buff1Id: "ops.loadSpeed", buff2Id: "ops.unloadSpeed", count: 20 }],
            },
          }
        : sh,
    ),
  } as GameState);
  const logistics4 = (s: GameState): GameState => ({
    ...s,
    captains: s.captains.map((c) => (c.id === 1 ? { ...c, unlockedSecondaryTalents: ["logistics4"] as typeof c.unlockedSecondaryTalents } : c)),
  });

  it("the offload shortens with the unload bonus and the reload with Rapid Loadout and Efficient Stowage", () => {
    const lengths = (state?: (s: GameState) => GameState) => {
      const { exp } = opsRun({ poiIds: ["mineralOutcrop", "mineralOutcrop"], securityStrength: 400, state });
      const done = advanceExpedition(exp, FAR);
      const rec = (step: string) => historyOf(done).find((r) => r.step === step)!;
      return { offload: rec("offload").endedAt - rec("offload").startedAt, reload: rec("reload").endedAt - rec("reload").startedAt, factors: exp.groundOps!.factors };
    };
    const bare = lengths();
    expect(bare.offload).toBe(OFFLOAD_BASE_SECONDS);
    expect(bare.reload).toBe(RELOAD_BASE_SECONDS);
    const crew = lengths(crewed);
    expect(crew.factors.offloadMult).toBeGreaterThan(1);
    expect(crew.factors.reloadMult).toBeGreaterThan(1);
    expect(crew.offload).toBeCloseTo(OFFLOAD_BASE_SECONDS / crew.factors.offloadMult, 9);
    expect(crew.reload).toBeCloseTo(RELOAD_BASE_SECONDS / crew.factors.reloadMult, 9);
    expect(crew.offload).toBeLessThan(bare.offload);
    expect(crew.reload).toBeLessThan(bare.reload);
    const talent = lengths(logistics4);
    expect(talent.reload).toBeLessThan(bare.reload);
    expect(talent.offload).toBe(bare.offload);
  });

  it("a return with nothing new to offload skips the offload [PROVISIONAL]", () => {
    const { exp } = opsRun({ poiIds: ["crashedShip"], members: LONER, securityStrength: 0 });
    const done = advanceExpedition(exp, T0 + 20_000);
    const recs = historyOf(done);
    // A retry that loses at once (no work done) returns with nothing new: return -> bay or reload, no offload.
    for (let i = 0; i < recs.length - 1; i++) {
      if (recs[i].step !== "return") continue;
      const before = recs.slice(0, i).reverse().find((r) => r.step === "deploy")!;
      const between = recs.filter((r) => r.startedAt >= before.startedAt && r.startedAt < recs[i].startedAt);
      if (!between.some((r) => r.step === "work")) expect(recs[i + 1].step).not.toBe("offload");
    }
  });
});

describe("GO-7b task work (D26 Assault Hardsuit, standing members)", () => {
  it("an Assault Hardsuit on a SECURITY member shortens task work on a hazardous body, not on a calm one", () => {
    const firstWork = (hazard: number, gear: EquipmentInstance[]) => {
      const { exp } = opsRun({ poiIds: ["mineralOutcrop"], hazard, gear, securityStrength: 400 });
      const done = advanceExpedition(exp, T0 + 5000);
      const w = historyOf(done).find((r) => r.step === "work")!;
      return w.endedAt - w.startedAt;
    };
    expect(firstWork(0.8, [hardsuit("member-1", 60)])).toBeLessThan(firstWork(0.8, []));
    expect(firstWork(0, [hardsuit("member-1", 60)])).toBe(firstWork(0, []));
  });

  it("a work step lasts (to - from) of the task's full work time for the members still standing", () => {
    const { exp } = opsRun({ poiIds: ["crashedShip"], securityStrength: 400 });
    const done = advanceExpedition(exp, T0 + 5000);
    const w = historyOf(done).find((r) => r.step === "work")!;
    const ops = exp.groundOps!;
    const full = taskWorkSeconds(exp, [{ ...teamOf(exp), scienceShare: ops.factors.scienceShare[0] }], exp.bodies[0]);
    expect(w.endedAt - w.startedAt).toBe(Math.max(1, Math.round(0.25 * full)));
  });
});

describe("GO-7b hold and flag (user Q4) + back of the line (user, GO-7b answers)", () => {
  it("after GROUND_STUCK_LOSSES losses in a row a task goes to the BACK of the line: the easier task behind it gets done, progress is kept", () => {
    // Force the hard task to the head (the plan would queue it last) and find a squad that wins the easy one.
    const setup = (securityStrength: number) => {
      const run = opsRun({ poiIds: ["subterraneanCivilization", "mineralOutcrop"], securityStrength, hazard: 0.3 });
      const e = structuredClone(run.exp);
      const [hard, easy] = tasksOf(e);
      teamOf(e).queue = [hard.id, easy.id];
      teamOf(e).taskId = hard.id;
      hard.status = "active";
      easy.status = "queued";
      return e;
    };
    let found: Expedition | null = null;
    for (const strength of [0, 2, 4, 6, 8, 12]) {
      const e = setup(strength);
      const done = advanceExpedition(e, T0 + 60_000);
      const [hard, easy] = tasksOf(done);
      if (easy.done && !hard.done && (hard.sentBack ?? 0) >= 1) {
        found = e;
        break;
      }
    }
    expect(found).not.toBeNull();
    const e = found!;
    const losses = historyOf(advanceExpedition(e, T0 + 60_000)).filter((r) => r.outcome === "loss" && r.taskId === tasksOf(e)[0].id);
    // After the third loss in a row: the hard task is at the back, flagged, but the run is NOT stuck (the easy one remains).
    const third = advanceExpedition(e, losses[GROUND_STUCK_LOSSES - 1].endedAt);
    const [hard3, easy3] = tasksOf(third);
    expect(teamOf(third).queue).toEqual([easy3.id, hard3.id]);
    expect(hard3).toMatchObject({ status: "queued", lossStreak: GROUND_STUCK_LOSSES, sentBack: 1 });
    expect(groundTaskStuck(hard3)).toBe(true);
    expect(groundTeamStuck(third, teamOf(third))).toBe(false);
    expect(groundOpsStuck(third)).toBe(false);
    expect(advanceExpedition(e, losses[GROUND_STUCK_LOSSES - 2].endedAt).bodies[0].activities[0].sentBack).toBeUndefined();
    // The next deploy takes the easy task, which gets done.
    const nextDeploy = historyOf(advanceExpedition(e, T0 + 60_000)).find((r) => r.step === "deploy" && r.startedAt > losses[GROUND_STUCK_LOSSES - 1].endedAt)!;
    expect(nextDeploy.taskId).toBe(easy3.id);
    const later = advanceExpedition(e, T0 + 60_000);
    expect(tasksOf(later)[1].done).toBe(true);
    // The hard task comes around again with a FRESH streak and its progress kept; only now is the run stuck.
    const retry = historyOf(later).find((r) => r.step === "deploy" && r.taskId === hard3.id && r.startedAt > nextDeploy.startedAt)!;
    const onRetry = advanceExpedition(e, retry.startedAt + 0.5);
    expect(tasksOf(onRetry)[0].lossStreak).toBeUndefined();
    expect(tasksOf(onRetry)[0].progress).toBe(hard3.progress);
    expect(tasksOf(onRetry)[0].pointsCleared).toBe(hard3.pointsCleared);
    expect(groundOpsStuck(onRetry)).toBe(true);
  });

  it("a run of only unwinnable tasks reads stuck and keeps retrying (never gives up); the history stays capped", () => {
    const { exp } = opsRun({ poiIds: ["subterraneanCivilization", "derelictOutpost"], members: LONER, securityStrength: 0, hazard: 0.9 });
    const early = advanceExpedition(exp, T0 + 30_000);
    const losses = historyOf(early).filter((r) => r.outcome === "loss");
    expect(losses.length).toBeGreaterThan(2 * GROUND_STUCK_LOSSES);
    // Not stuck while a task has not hit the streak yet.
    expect(groundOpsStuck(advanceExpedition(exp, losses[0].endedAt))).toBe(false);
    // Once both have hit it, stuck from then on (through the retries, whose streaks start fresh).
    const both = losses.findIndex((_, i) => {
      const at = advanceExpedition(exp, losses[i].endedAt);
      return tasksOf(at).every((t) => (t.sentBack ?? 0) > 0);
    });
    expect(both).toBeGreaterThanOrEqual(0);
    for (const t of [losses[both].endedAt, losses[both].endedAt + 333, T0 + 30_000]) expect(groundOpsStuck(advanceExpedition(exp, t))).toBe(true);
    expect(GROUND_OPS_STUCK_TEXT).toBe("Stuck: needs a stronger team or a skip");
    const done = advanceExpedition(exp, T0 + 300_000);
    expect(tasksOf(done).every((t) => !t.done && (t.fightCount ?? 0) > 3 * GROUND_STUCK_LOSSES)).toBe(true);
    expect(done.groundOps!.endedAt).toBeUndefined();
    expect(done.phase).toBe("activities");
    expect(groundOpsStuck(done)).toBe(true);
    expect(historyOf(done).length).toBe(GROUND_HISTORY_CAP);
  });

  it("a run whose team works on is not stuck; a finished window never is", () => {
    const { exp } = opsRun({ poiIds: ["mineralOutcrop"], securityStrength: 400 });
    expect(groundOpsStuck(exp)).toBe(false);
    expect(groundOpsStuck(advanceExpedition(exp, FAR))).toBe(false);
  });
});

describe("GO-7b late wipes (user, GO-7b answers): the ship still comes for them", () => {
  it("a wipe after the system is fully scanned waits for the ship's recovery leg; no scan is paused", () => {
    const { exp } = opsRun({ poiIds: ["subterraneanCivilization"], members: LONER, securityStrength: 0, hazard: 0.9 });
    const e = advanceExpedition(exp, T0 + 20_000);
    const ops = e.groundOps!;
    const loss = historyOf(e).find((r) => r.outcome === "loss")!;
    const leg = ops.shipLegs[0];
    expect(leg).toMatchObject({ kind: "recovery", teamIndex: 0, bodyIndex: 0, scanBodyIndex: null, startsAt: loss.endedAt });
    expect(leg.arrivesAt).toBe(leg.startsAt + IN_SYSTEM_LEG_SECONDS);
    expect(leg.endsAt).toBe(leg.startsAt + 2 * IN_SYSTEM_LEG_SECONDS);
    const ret = historyOf(e).find((r) => r.step === "return" && r.startedAt === loss.endedAt)!;
    expect(ret).toMatchObject({ endedAt: leg.arrivesAt, recovered: true });
    // Every wipe got its leg, serialized, and none of them touches the scan clock.
    expect(ops.shipLegs.length).toBe(historyOf(e).filter((r) => r.outcome === "loss").length);
    for (let i = 1; i < ops.shipLegs.length; i++) expect(ops.shipLegs[i].startsAt).toBeGreaterThanOrEqual(ops.shipLegs[i - 1].endsAt);
    expect(scanClockToTime(ops, 5)).toBe(T0 + 5);
  });
});

describe("GO-7b same-instant batch (GO-7c guard)", () => {
  const KEY = "syntheticOpsPair" as ShipTypeKey;
  let cleanup: (() => void) | null = null;
  afterEach(() => {
    cleanup?.();
    cleanup = null;
  });

  it("team ends at one instant run as one batch in team index order, and each team takes its own queue", () => {
    cleanup = registerSyntheticHull(KEY, [
      { teamType: "security", size: 1, count: 2 },
      { teamType: "science", size: 1, count: 2 },
    ]);
    const members = [member("member-1", "security"), member("member-2", "security"), member("member-11", "science"), member("member-12", "science")];
    const pair = (s: GameState): GameState => withSlottedAwayTeams({ ...s, ships: s.ships.map((sh) => ({ ...sh, typeKey: KEY })) }, 2);
    const { exp } = opsRun({ poiIds: ["mineralOutcrop", "caveNetwork"], members, securityStrength: 400, state: pair });
    const e = structuredClone(exp);
    const ops = e.groundOps!;
    expect(ops.teams.map((t) => t.index)).toEqual([0, 1]);
    const [a, b] = tasksOf(e);
    for (const task of [a, b]) task.status = "queued";
    Object.assign(ops.teams[0], { queue: [a.id], step: "reload", stepStartedAt: T0, stepEndsAt: T0 + 5, taskId: undefined });
    Object.assign(ops.teams[1], { queue: [b.id], step: "reload", stepStartedAt: T0, stepEndsAt: T0 + 5 });
    delete ops.teams[0].taskId;
    const after = advanceExpedition(e, T0 + 5);
    expect(after.groundOps!.teams.map((t) => [t.step, t.taskId, t.stepStartedAt])).toEqual([
      ["deploy", a.id, T0 + 5],
      ["deploy", b.id, T0 + 5],
    ]);
    const closed = after.groundOps!.history.filter((r) => r.step === "reload" && r.endedAt === T0 + 5).map((r) => r.teamIndex);
    expect(closed).toEqual([0, 1]);
  });
});

describe("GO-7b readers", () => {
  it("the activities bar reads the tasks' progress, interpolated along the current work step", () => {
    const { exp } = opsRun({ poiIds: ["crashedShip", "mineralOutcrop"], securityStrength: 400 });
    expect(expeditionPhaseFraction(exp, T0)).toBe(0);
    const done = advanceExpedition(exp, FAR);
    const w = historyOf(done).find((r) => r.step === "work")!;
    const mid = advanceExpedition(exp, (w.startedAt + w.endedAt) / 2);
    const f = groundOpsProgress(mid, (w.startedAt + w.endedAt) / 2);
    expect(f).toBeGreaterThan(0);
    expect(f).toBeLessThan(1);
    expect(expeditionPhaseFraction(mid, (w.startedAt + w.endedAt) / 2)).toBe(f);
  });

  it("every step length is a pure function of stored values (deploy, return, offload, reload, fight)", () => {
    const { exp, done } = findOps({ poiIds: ["crashedShip", "derelictOutpost"], securityStrength: 30 }, (d) => historyOf(d).some((r) => r.outcome === "loss"));
    const ops = exp.groundOps!;
    const records = fightRecords(exp, done);
    let fight = 0;
    for (const r of historyOf(done)) {
      const len = r.endedAt - r.startedAt;
      if (r.step === "deploy") expect(len).toBe(DEPLOY_SECONDS);
      if (r.step === "return" && !r.recovered) expect(len).toBe(RETURN_SECONDS);
      if (r.step === "return" && r.recovered) expect(len).toBe(IN_SYSTEM_LEG_SECONDS); // no leg queued ahead on one team
      if (r.step === "offload") expect(len).toBe(OFFLOAD_BASE_SECONDS / ops.factors.offloadMult);
      if (r.step === "reload") expect(len).toBe(RELOAD_BASE_SECONDS / ops.factors.reloadMult);
      if (r.step === "fight") expect(len).toBe(taskFightSeconds(records[fight++].rec));
    }
  });

  it("segment hauls split the full haul exactly (the banking team's yield)", () => {
    const { exp, done } = findOps({ poiIds: ["crashedShip"], members: LONER, securityStrength: 6 }, (d) => d.findings.filter((f) => f.source === "activity").length >= 1);
    const task = tasksOf(done)[0];
    const ops = exp.groundOps!;
    const full = taskFullHaul(exp, [{ ...teamOf(exp), scienceShare: ops.factors.scienceShare[0] }], exp.bodies[0], task.poiId, 0);
    for (const f of done.findings.filter((x) => x.source === "activity")) {
      const [first, last] = f.id.split("-s").pop()!.split("-").map(Number);
      const want = { materials: {} as Record<string, number>, credits: 0 };
      for (let s = first; s <= last; s++) {
        const seg = segmentHaul(full, 4, s);
        for (const [k, v] of Object.entries(seg.materials)) want.materials[k] = (want.materials[k] ?? 0) + v;
        want.credits += seg.credits;
      }
      expect(f.materials).toEqual(want.materials);
      expect(f.credits).toBe(want.credits);
    }
  });
});
