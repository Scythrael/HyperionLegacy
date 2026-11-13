// OC-F14 follow-up (user 2026-11-12 afternoon, "Keep the repair (Recommended)": a recall during a FINISHED field
// repair's flight back keeps the repair, as a canceled repair's flight back already did; docs/plans/
// 2026-10-15-wiring-registry-and-audit-plan.md). Golden hashes captured on the code BEFORE the engine edit (on top of
// 02cf05d5). Each fixture is a real Ground Ops run (fieldRepairOrder.fixture.ts) recalled at one instant, read two ways:
// the recalled record and that record advanced home (OCF14_FAR).

import { describe, expect, it } from "vitest";
import { advanceExpedition, cancelFieldRepair, orderFieldRepair, recallExpedition } from "./expedition";
import { OCF14_FAR, ocf14Damaged, ocf14Dispatch, ocf14Hash, ocf14WindowOpen } from "./fieldRepairOrder.fixture";
import { withRepairRulesOff } from "./fieldRepairRulesSwitch.fixture";
import { IN_SYSTEM_LEG_SECONDS } from "./groundOps";
import type { Expedition, GameState, GroundRepairLeg } from "./model";

const TOXIC_FROZEN = 0xa6fe4; // body 0 toxic (the ship scans it first), body 1 frozen (a repair world)

interface Recalled {
  run: Expedition; // the recalled record
  leg: GroundRepairLeg; // the repair leg as it stood before the recall
  at: number; // the recall's instant
}

// The run of TOXIC_FROZEN 200 s into its window carrying `damage`, with the player's order, as a state at that instant.
function ordered(damage: number): { state: GameState; id: string } {
  const { next, exp } = ocf14Dispatch(TOXIC_FROZEN);
  const t = ocf14WindowOpen(exp) + 200;
  const run = ocf14Damaged(advanceExpedition(exp, t), damage);
  return { state: orderFieldRepair({ ...next, gameTimeSeconds: t, expeditions: [run] }, exp.id), id: exp.id };
}
const legOf = (s: GameState): GroundRepairLeg => s.expeditions[0].groundOps!.repairLegs![0];
function recall(state: GameState, id: string, at: number, leg: GroundRepairLeg): Recalled {
  return { run: recallExpedition({ ...state, gameTimeSeconds: at }, id).expeditions[0], leg, at };
}

// (a) A finished world repair's flight back: 1162 damage at the toxic body, the frozen world is faster; recalled 10 s
// into the 300 s flight back.
export function worldFlightBack(): Recalled {
  const { state, id } = ordered(1162);
  const leg = legOf(state);
  return recall(state, id, leg.repairedAt + 10, leg);
}
// Control: the same world repair recalled mid-repair (400 s into the ground time).
export function worldMidRepair(): Recalled {
  const { state, id } = ordered(1162);
  const leg = legOf(state);
  return recall(state, id, leg.arrivesAt + 400, leg);
}
// (b) A finished orbit repair (48 damage, orbit 132 s): it has no flight back (repairedAt == endsAt), so a recall at
// its last instant finds it settled; a recall one second before finds it mid-repair.
export function orbitAtEnd(): Recalled {
  const { state, id } = ordered(48);
  const leg = legOf(state);
  return recall(state, id, leg.repairedAt, leg);
}
export function orbitLastSecond(): Recalled {
  const { state, id } = ordered(48);
  const leg = legOf(state);
  return recall(state, id, leg.repairedAt - 1, leg);
}
// (c) A canceled repair's flight back: canceled 400 s into the ground time, recalled 10 s into the flight back.
export function canceledFlightBack(): Recalled {
  const { state, id } = ordered(1162);
  const leg = legOf(state);
  const c = leg.arrivesAt + 400;
  const cut = cancelFieldRepair({ ...state, gameTimeSeconds: c }, id);
  return recall(cut, id, c + 10, legOf(cut));
}
// (d) The automatic repair at 25%: the ship already carries 1200 damage, so the first hit (at the toxic body) sends it
// down at once, and the frozen world is faster; recalled 10 s into the flight back.
export function autoFlightBack(): Recalled {
  const { next, exp } = ocf14Dispatch(TOXIC_FROZEN);
  const damaged = ocf14Damaged(exp, 1200);
  const leg = advanceExpedition(damaged, OCF14_FAR).groundOps!.repairLegs![0];
  return recall({ ...next, expeditions: [damaged] }, exp.id, leg.repairedAt + 10, leg);
}
// (e) A run dispatched without the repair rules stamp (OC-F14 off: the old nearest-world rule): the order flies to the
// frozen world (688 s); recalled 10 s into the flight back.
export function unstampedFlightBack(): Recalled {
  return withRepairRulesOff(() => {
    const { state, id } = ordered(48);
    const leg = legOf(state);
    return recall(state, id, leg.repairedAt + 10, leg);
  });
}

export const RECALL_FIXTURES: Record<string, () => Recalled> = {
  worldFlightBack,
  worldMidRepair,
  orbitAtEnd,
  orbitLastSecond,
  canceledFlightBack,
  autoFlightBack,
  unstampedFlightBack,
};
const read = (r: Recalled): string[] => [ocf14Hash(r.run), ocf14Hash(advanceExpedition(r.run, OCF14_FAR))];

// Captured on the code BEFORE the engine edit (02cf05d5).
const BEFORE: Record<string, string[]> = {
  worldFlightBack: ["5c101fa9", "98d34d80"],
  worldMidRepair: ["62d2a991", "e5aaadb6"],
  orbitAtEnd: ["3068629b", "561399ef"],
  orbitLastSecond: ["e0ce6bab", "8fd67387"],
  canceledFlightBack: ["b5099493", "69f44a72"],
  autoFlightBack: ["d4f1fb7e", "80f1bf1a"],
  unstampedFlightBack: ["5c26035d", "5a790a1e"],
};

// The pins today (nothing moved yet).
const GOLDEN: Record<string, string[]> = { ...BEFORE };

describe("recall keeps the repair: the fixtures are what they say", () => {
  it("each fixture's leg and instant", () => {
    const w = worldFlightBack();
    expect(w.run.repairRules).toBe(1);
    expect([w.leg.siteBodyIndex, w.leg.endsAt - w.leg.repairedAt, w.leg.ordered]).toEqual([1, IN_SYSTEM_LEG_SECONDS, true]);
    expect(w.at > w.leg.repairedAt && w.at < w.leg.endsAt).toBe(true);
    const m = worldMidRepair();
    expect(m.at > m.leg.arrivesAt && m.at < m.leg.repairedAt).toBe(true);
    const o = orbitAtEnd();
    expect([o.leg.siteBodyIndex, o.leg.repairedAt, o.at]).toEqual([null, o.leg.endsAt, o.leg.endsAt]);
    const c = canceledFlightBack();
    expect([c.leg.canceled, c.leg.siteBodyIndex]).toEqual([true, 1]);
    expect(c.at > c.leg.repairedAt && c.at < c.leg.endsAt).toBe(true);
    const a = autoFlightBack();
    expect(a.run.repairRules).toBe(1);
    expect([a.leg.ordered, a.leg.siteBodyIndex, a.leg.endsAt - a.leg.repairedAt]).toEqual([undefined, 1, IN_SYSTEM_LEG_SECONDS]);
    expect(a.at > a.leg.repairedAt && a.at < a.leg.endsAt).toBe(true);
    const u = unstampedFlightBack();
    expect(u.run.repairRules).toBeUndefined();
    expect([u.leg.siteBodyIndex, u.leg.endsAt - u.leg.repairedAt]).toEqual([1, IN_SYSTEM_LEG_SECONDS]);
    for (const r of [w, m, o, c, a, u]) expect(r.run.groundOps!.recalledAt).toBe(r.at);
  });
});

describe("recall keeps the repair: goldens", () => {
  for (const name of Object.keys(RECALL_FIXTURES)) {
    it(name, { timeout: 120_000 }, () => expect(read(RECALL_FIXTURES[name]())).toEqual(GOLDEN[name]));
  }
});
