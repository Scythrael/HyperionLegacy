// Wiring WR-13 (OC-C4 "Keep tested hooks", registry seam away:audit:objectiveHooks): the TASK CHAIN mechanism (user
// #14, squads design: completing a task can REVEAL a follow-up task on its body). No chain is authored
// (riskFactors.ts TASK_CHAIN_FOLLOW_UPS is empty), so this file LENDS one for the test and restores it after: on the
// GO-7b parity run (groundOpsParity.test.ts, the same pinned seed and squad) the Crashed Ship on the first body
// reveals a Derelict Outpost when it is done. Proven: the follow-up joins that body once, as a discovery and a
// planned task, at the completion instant; the run is otherwise the unlent run up to that instant; and one big
// advance == 997 s chunks == 1 s steps across the reveal.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { freshState, type AwayMember, type Expedition } from "./model";
import { advanceExpedition, expeditionCandidates } from "./expedition";
import { getPoiById } from "./expeditionContent";
import { TASK_CHAIN_FOLLOW_UPS, taskChainFollowUp } from "./riskFactors";
import { asPreFieldKitsDispatch, plainAwayMember, withSlottedAwayTeams, withoutEnemyRanks, withoutShipEvents, dispatchPastPropulsion } from "./awayTeamTestFixtures";

const member = (id: string, teamType: AwayMember["teamType"], over: Partial<AwayMember> = {}): AwayMember => ({
  ...plainAwayMember(id, teamType, "ship-1"),
  ...over,
});
const SQUAD: AwayMember[] = [
  member("member-1", "security", { rank: 3 }),
  member("member-2", "security", { rank: 2, traits: ["fieldMedic"] }),
  member("member-11", "science"),
];
const SEED = 0x0a13bd4; // groundOpsParity.test.ts's pinned run
const COMPLETED = "crashedShip";
const REVEALED = "derelictOutpost";

function dispatch(): Expedition {
  const s = withSlottedAwayTeams({ ...freshState(), awayMembers: SQUAD.map((m) => ({ ...m })), nextAwayMemberId: 100, expeditionSeed: SEED });
  const res = asPreFieldKitsDispatch(dispatchPastPropulsion(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id));
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  return withoutShipEvents(withoutEnemyRanks(res.expedition));
}

const count = (exp: Expedition, bodyIndex: number, poiId: string): number => exp.bodies[bodyIndex].activities.filter((a) => a.poiId === poiId).length;

describe("WR-13 task chains: a completed task reveals its follow-up (a lent chain)", () => {
  // The unlent run: where the Crashed Ship sits and when it is done.
  const base = dispatch();
  const unlent = advanceExpedition(base, 200_000);
  const source = unlent.bodies[0].activities.find((a) => a.poiId === COMPLETED)!;
  const doneAt = source.completedAt!;

  beforeEach(() => {
    TASK_CHAIN_FOLLOW_UPS.set(COMPLETED, REVEALED);
  });
  afterEach(() => {
    TASK_CHAIN_FOLLOW_UPS.delete(COMPLETED);
  });

  it("the pinned run has the scenario: one Crashed Ship on body 0, done in the window, no Derelict Outpost there", () => {
    expect(count(unlent, 0, COMPLETED)).toBe(1);
    expect(source.status).toBe("done");
    expect(doneAt).toBeGreaterThan(unlent.groundOps!.startedAt!);
    expect(count(unlent, 0, REVEALED)).toBe(0);
    expect(taskChainFollowUp(COMPLETED)).toBe(REVEALED);
  });

  it("finishing the task reveals the follow-up ONCE on the same body, as a discovery and a planned task", () => {
    const exp = dispatch();
    const before = advanceExpedition(exp, doneAt - 1);
    expect(count(before, 0, REVEALED)).toBe(0);
    // Up to the completion instant the lent run is the unlent run.
    expect(before).toEqual(advanceExpedition(base, doneAt - 1));

    const at = advanceExpedition(exp, doneAt);
    const body = at.bodies[0];
    const n = before.bodies[0].activities.length;
    expect(body.activities.length).toBe(n + 1);
    expect(count(at, 0, REVEALED)).toBe(1);
    const task = body.activities[n];
    expect(task).toMatchObject({ id: `${exp.id}-${body.id}-act-${n}`, bodyId: body.id, poiId: REVEALED });
    expect(body.discoveries[n]).toEqual({
      id: `${exp.id}-${body.id}-disc-${n}`,
      kind: getPoiById(REVEALED)!.pool === "underground" ? "underground" : "landmark",
      poiId: REVEALED,
    });
    // Stamped and planned like a scanned body's task: a deployed team holds it in its queue.
    expect(task.fightPoints).toBeDefined();
    expect(task.needs).toBeDefined();
    expect(task.assignedTeamIds?.length ?? 0).toBeGreaterThan(0);
    expect(at.groundOps!.teams.some((team) => team.queue.includes(task.id))).toBe(true);
    // No other body changes shape.
    for (let b = 1; b < at.bodies.length; b += 1) expect(at.bodies[b].activities.length).toBe(before.bodies[b].activities.length);

    // Much later the follow-up is still the one reveal (a done task never completes twice, and nothing chains from it).
    const later = advanceExpedition(exp, 200_000);
    expect(count(later, 0, REVEALED)).toBe(1);
    expect(later.bodies[0].discoveries.filter((d) => d.poiId === REVEALED).length).toBe(1);
    expect(later.bodies[0].activities.length).toBe(n + 1);
  });

  it("PARITY across the reveal: one big advance == 997 s chunks == 1 s steps", { timeout: 180_000 }, () => {
    const exp = dispatch();
    const END = doneAt + 3600;
    const big = advanceExpedition(exp, END);
    expect(count(big, 0, REVEALED)).toBe(1);

    let chunked = exp;
    for (let t = 997; t < END; t += 997) chunked = advanceExpedition(chunked, t);
    chunked = advanceExpedition(chunked, END);
    expect(chunked).toEqual(big);

    let live = exp;
    for (let t = 1; t <= END; t += 1) live = advanceExpedition(live, t);
    expect(live).toEqual(big);
  });

  it("the production table holds no chain, and the lent one is gone after each test", () => {
    TASK_CHAIN_FOLLOW_UPS.delete(COMPLETED);
    expect(TASK_CHAIN_FOLLOW_UPS.size).toBe(0);
    expect(taskChainFollowUp(COMPLETED)).toBeNull();
  });
});
