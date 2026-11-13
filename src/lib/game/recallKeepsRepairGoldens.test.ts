// OC-F14 follow-up (user 2026-11-12 afternoon, "Keep the repair (Recommended)": a recall during a FINISHED field
// repair's flight back keeps the repair, as a canceled repair's flight back already did; docs/plans/
// 2026-10-15-wiring-registry-and-audit-plan.md). Golden hashes captured on the code BEFORE the engine edit (on top of
// 02cf05d5). Each fixture is a real Ground Ops run (fieldRepairOrder.fixture.ts) recalled at one instant, read two ways:
// the recalled record and that record advanced home (OCF14_FAR).
//
// The engine commit re-pins ONLY what the rule moves (GOLDEN), each with its reason beside it, and proves the move with
// the rule switched off (recallKeepsRepairSwitch.fixture.ts withRecallKeepsRepairOff): every fixture then reproduces its
// capture (BEFORE). The rule rides the OC-F14 repair rules stamp (Expedition.repairRules; nothing with it has shipped),
// so a run without the stamp recalls by the old rule.

import { describe, expect, it } from "vitest";
import { advanceExpedition, cancelFieldRepair, orderFieldRepair, recallExpedition } from "./expedition";
import { fieldRepairStripView } from "../fieldRepairStripDisplay";
import { withRecallKeepsRepairOff } from "./recallKeepsRepairSwitch.fixture";
import { economyTick } from "./tick";
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

// The pins today. Each move names its reason; every one returns to BEFORE with the rule off (the describe below).
// Moved: the two finished repairs recalled during their flight back on a stamped run. The recall now settles the whole
// repair (the leg is done, the hull damage it fixed is gone), so the recalled record moves and so does the run home.
//   - worldFlightBack: the order's 1162 damage, repaired on the frozen world, comes home repaired (was 1162).
//   - autoFlightBack: the automatic repair's damage (1200 plus the first hit) comes home repaired (was all of it).
// Unmoved: a recall mid-repair (worldMidRepair, orbitLastSecond: the repair is not finished, it stops with its damage);
// the orbit repair at its end (orbitAtEnd: no flight back, the run already settled it at that instant); the canceled
// order's flight back (canceledFlightBack: OC-F14 already kept its share); the unstamped run (unstampedFlightBack: a run
// without the repair rules keeps the old rule).
const GOLDEN: Record<string, string[]> = {
  ...BEFORE,
  worldFlightBack: ["a1b16e85", "648ef108"],
  autoFlightBack: ["e9d348e5", "740b1579"],
};
const MOVED = ["worldFlightBack", "autoFlightBack"];

// The stored state each moved fixture recalls, before the recall.
function recallSourceState(name: string): GameState {
  if (name === "autoFlightBack") {
    const { next, exp } = ocf14Dispatch(TOXIC_FROZEN);
    return { ...next, expeditions: [ocf14Damaged(exp, 1200)] };
  }
  return ordered(1162).state;
}

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

describe("recall keeps the repair: the rule off reproduces every capture (BEFORE)", () => {
  for (const name of Object.keys(RECALL_FIXTURES)) {
    it(name, { timeout: 120_000 }, () => expect(withRecallKeepsRepairOff(() => read(RECALL_FIXTURES[name]()))).toEqual(BEFORE[name]));
  }
  it("only the named pins moved", () => {
    for (const name of Object.keys(RECALL_FIXTURES)) expect(GOLDEN[name] !== BEFORE[name]).toBe(MOVED.includes(name));
  });
});

// A run dispatched before OC-F14 (no repair rules stamp) recalls by the old rule: the stored record with the stamp taken
// off recalls exactly as the rule-off fixture does (less the stamp).
describe("recall keeps the repair: a run without the stamp keeps the old rule", () => {
  for (const name of MOVED) {
    it(name, { timeout: 120_000 }, () => {
      const src = recallSourceState(name);
      const at = RECALL_FIXTURES[name]().at;
      const { repairRules: _stamp, ...old } = src.expeditions[0];
      const replay = recallExpedition({ ...src, gameTimeSeconds: at, expeditions: [old] }, old.id).expeditions[0];
      const { repairRules: _offStamp, ...off } = withRecallKeepsRepairOff(RECALL_FIXTURES[name]).run;
      expect(ocf14Hash(replay)).toBe(ocf14Hash(off));
      expect(replay.groundOps!.repairLegs![0].done).toBeUndefined();
    });
  }
});

describe("recall keeps the repair: what the recall keeps", () => {
  it("a finished repair flying back comes home repaired, the automatic one and the order alike", () => {
    const w = worldFlightBack();
    expect(w.run.groundOps!.hullDamage).toBeUndefined();
    expect(w.run.groundOps!.repairLegs![0]).toMatchObject({ done: true, hullRepaired: 1162, endsAt: w.leg.endsAt });
    expect(withRecallKeepsRepairOff(worldFlightBack).run.groundOps!.hullDamage).toBe(1162);
    const a = autoFlightBack();
    expect(a.leg.hullRepaired).toBeGreaterThan(1200);
    expect(a.run.groundOps!.hullDamage).toBeUndefined();
    expect(withRecallKeepsRepairOff(autoFlightBack).run.groundOps!.hullDamage).toBe(a.leg.hullRepaired);
  });
  it("a repair still under way stops with its damage; a canceled one keeps its share; an unstamped run loses it", () => {
    expect(worldMidRepair().run.groundOps!.hullDamage).toBe(1162);
    expect(orbitLastSecond().run.groundOps!.hullDamage).toBe(48);
    expect(orbitAtEnd().run.groundOps!.hullDamage).toBeUndefined();
    const c = canceledFlightBack();
    expect(c.leg.hullRepaired).toBeGreaterThan(0);
    expect(c.run.groundOps!.hullDamage).toBe(1162 - c.leg.hullRepaired);
    expect(unstampedFlightBack().run.groundOps!.hullDamage).toBe(48);
  });
  it("a recall at the first instant of the flight back keeps it (t == repairedAt); one second before, it stops", () => {
    const { state, id } = ordered(1162);
    const leg = legOf(state);
    expect(recallExpedition({ ...state, gameTimeSeconds: leg.repairedAt }, id).expeditions[0].groundOps!.hullDamage).toBeUndefined();
    expect(recallExpedition({ ...state, gameTimeSeconds: leg.repairedAt - 1 }, id).expeditions[0].groundOps!.hullDamage).toBe(1162);
  });
  it("after the recall, one call == 997 s chunks == 1 s steps, and one economyTick == 997-tick chunks == 1-tick steps", { timeout: 300_000 }, () => {
    const { state, id } = ordered(1162);
    const at = legOf(state).repairedAt + 10;
    const recalled = recallExpedition({ ...state, gameTimeSeconds: at }, id);
    const run = recalled.expeditions[0];
    const END = at + 4000;
    const big = advanceExpedition(run, END);
    let chunked = run;
    for (let x = at + 997; x < END; x += 997) chunked = advanceExpedition(chunked, x);
    expect(advanceExpedition(chunked, END)).toEqual(big);
    let steps = run;
    for (let x = at + 1; x <= END; x += 1) steps = advanceExpedition(steps, x);
    expect(steps).toEqual(big);
    expect(big.groundOps!.hullDamage).toBeUndefined();
    const RNG = () => 0.5;
    const N = 1500;
    const one = economyTick(recalled, N, RNG);
    let tickChunks = recalled;
    for (let n = 0; n < N; n += 997) tickChunks = economyTick(tickChunks, Math.min(997, N - n), RNG);
    let tickSteps = recalled;
    for (let n = 0; n < N; n += 1) tickSteps = economyTick(tickSteps, 1, RNG);
    expect(tickChunks.expeditions).toEqual(one.expeditions);
    expect(tickSteps.expeditions).toEqual(one.expeditions);
    // Recalled live (the order stepped one second at a time to the recall) == recalled on the run advanced in one call.
    let live = state;
    for (let x = state.gameTimeSeconds + 1; x <= at; x += 1) live = { ...live, gameTimeSeconds: x, expeditions: [advanceExpedition(live.expeditions[0], x)] };
    expect(recallExpedition(live, id).expeditions).toEqual(recalled.expeditions);
  });
  it("the strip's hull readout after a recall is the hull the ship carries home", () => {
    // Stamped: the repair was kept, the hull is whole, nothing to show.
    const w = worldFlightBack();
    expect(fieldRepairStripView(w.run, w.at + 5)).toBeNull();
    // Unstamped: the repair was lost; the readout shows the 48 the ship carries home (it read 0 before, so it hid).
    const u = unstampedFlightBack();
    const view = fieldRepairStripView(u.run, u.at + 5)!;
    expect(view.state).toBe("over");
    expect(view.numbersWide!.map((p) => p.text).join("")).toBe(`48 of ${Math.round(u.run.groundOps!.shipEventProfile.battle!.hullMax)}`);
  });
});
