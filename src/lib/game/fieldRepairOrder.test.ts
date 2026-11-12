// OC-F14 (user answers 2026-11-12 on docs/mockups/2026-11-11-field-repair-order-mockup.html): the field repair takes the
// faster of the nearest repair world and orbit ("Pick the faster": ties orbit), the preview is what the order stores, and
// one tap cancels the player's order ("Add a cancel": the share repaired is kept, proportional to the whole seconds
// repaired in exact integer arithmetic; the flight back from a world still applies). Pure and deterministic: after a
// cancel, one call == 997 s chunks == 1 s steps, and one economyTick == 997-tick chunks == 1-tick steps.

import { describe, expect, it } from "vitest";
import { advanceExpedition, canCancelFieldRepair, canOrderFieldRepair, cancelFieldRepair, mixesRepairWorlds, orderFieldRepair, recallExpedition } from "./expedition";
import {
  FIELD_REPAIR_PLANET_TYPES,
  IN_SYSTEM_LEG_SECONDS,
  fieldRepairCancelBlockText,
  fieldRepairPlan,
  fieldRepairSeconds,
  partialFieldRepair,
} from "./groundOps";
import { economyTick } from "./tick";
import { freshState, type AwayMember, type Expedition, type GameState } from "./model";
import { OCF14_FAR, ocf14Damaged, ocf14Dispatch, ocf14Threshold, ocf14WindowOpen } from "./fieldRepairOrder.fixture";
import { asPreCurveDispatch, plainAwayMember, withSlottedAwayTeams, dispatchPastPropulsion } from "./awayTeamTestFixtures";
import { expeditionCandidates } from "./expedition";

const TOXIC_FROZEN = 0xa6fe4; // body 0 toxic (the ship scans it first), body 1 frozen (a repair world)
const ARID_ONLY = 0xa6fe5; // three arid worlds

// The run of `seed` advanced to `dt` seconds into its window, carrying `damage`, as a state at that instant.
function at(seed: number, dt: number, damage: number): { state: GameState; t: number; id: string } {
  const { next, exp } = ocf14Dispatch(seed);
  const t = ocf14WindowOpen(exp) + dt;
  const run = ocf14Damaged(advanceExpedition(exp, t), damage);
  return { state: { ...next, gameTimeSeconds: t, expeditions: [run] }, t, id: exp.id };
}
const legOf = (s: GameState) => s.expeditions[0].groundOps!.repairLegs![0];
const later = (s: GameState, t: number): GameState => ({ ...s, gameTimeSeconds: t });

describe("OC-F14 the faster of world and orbit", () => {
  it("a system is stamped only when it mixes repair worlds with other bodies", () => {
    const b = (planetType: Expedition["bodies"][number]["planetType"]) => ({ planetType });
    expect(mixesRepairWorlds([b("toxic"), b("frozen")])).toBe(true);
    expect(mixesRepairWorlds([b("arid"), b("arid")])).toBe(false);
    expect(mixesRepairWorlds([b("volcanic"), b("gasGiant")])).toBe(false);
    expect(FIELD_REPAIR_PLANET_TYPES).toContain("frozen");
    expect(ocf14Dispatch(TOXIC_FROZEN).exp.repairRules).toBe(1);
    expect(ocf14Dispatch(ARID_ONLY).exp.repairRules).toBeUndefined();
  });

  it("orbit when it finishes sooner, the world when that does, orbit on a tie (no travel)", () => {
    // At the toxic body the world is a flight away: 2 x 300 s + 2T on the ground against 3T in orbit (T = the
    // Shipyard's ticks, 20 + ceil(damage / 2)), so orbit wins while T < 600, ties at T = 600 (damage 1160) and loses after.
    const { state } = at(TOXIC_FROZEN, 200, 0);
    const run = state.expeditions[0];
    const plan = (damage: number) => fieldRepairPlan(ocf14Damaged(run, damage), state.gameTimeSeconds)!;
    const small = plan(48);
    expect(small).toMatchObject({ siteBodyIndex: null, travelSeconds: 0, repairSeconds: 132, totalSeconds: 132, damage: 48, passedWorld: { bodyIndex: 1, totalSeconds: 688 } });
    const tie = plan(1160);
    expect(tie.siteBodyIndex).toBeNull();
    expect(tie.totalSeconds).toBe(1800);
    expect(tie.passedWorld).toEqual({ bodyIndex: 1, totalSeconds: 1800 });
    const big = plan(1162);
    expect(big).toMatchObject({ siteBodyIndex: 1, travelSeconds: IN_SYSTEM_LEG_SECONDS, repairSeconds: fieldRepairSeconds(1162, 0, true), damage: 1162 });
    expect(big.totalSeconds).toBe(2 * IN_SYSTEM_LEG_SECONDS + fieldRepairSeconds(1162, 0, true));
    expect(big.totalSeconds).toBeLessThan(fieldRepairSeconds(1162, 0, false));
    expect(big.passedWorld).toBeUndefined();
  });

  it("on a repair world the ground is always quicker (2x against 3x, no flight)", () => {
    const { state } = at(ARID_ONLY, 200, 48);
    expect(fieldRepairPlan(state.expeditions[0], state.gameTimeSeconds)).toMatchObject({ siteBodyIndex: 0, travelSeconds: 0, totalSeconds: 88 });
    // Even stamped (the rule itself, not the stamp, picks the world here).
    expect(fieldRepairPlan({ ...state.expeditions[0], repairRules: 1 }, state.gameTimeSeconds)).toMatchObject({ siteBodyIndex: 0, totalSeconds: 88 });
  });

  it("the preview is exactly what the order stores", () => {
    for (const damage of [48, 1162]) {
      const { state, t, id } = at(TOXIC_FROZEN, 200, damage);
      const plan = fieldRepairPlan(state.expeditions[0], t)!;
      const leg = legOf(orderFieldRepair(state, id));
      expect(leg).toMatchObject({ ordered: true, siteBodyIndex: plan.siteBodyIndex, startsAt: plan.startsAt, hullRepaired: plan.damage });
      expect(leg.arrivesAt - leg.startsAt).toBe(plan.travelSeconds);
      expect(leg.repairedAt - leg.arrivesAt).toBe(plan.repairSeconds);
      expect(leg.endsAt - leg.startsAt).toBe(plan.totalSeconds);
    }
  });

  it("a run without the stamp keeps the old rule: the world whenever there is one", () => {
    const { state, t } = at(TOXIC_FROZEN, 200, 48);
    const { repairRules: _stamp, ...old } = state.expeditions[0];
    expect(fieldRepairPlan(old, t)).toMatchObject({ siteBodyIndex: 1, travelSeconds: IN_SYSTEM_LEG_SECONDS, totalSeconds: 688 });
  });
});

describe("OC-F14 partial repair: exact integer arithmetic", () => {
  it("proportional to the whole seconds repaired, rounded down", () => {
    expect(partialFieldRepair(48, 50, 132)).toBe(18); // 2400 / 132 = 18.18
    expect(partialFieldRepair(48, 50.999, 132)).toBe(18); // whole seconds only
    expect(partialFieldRepair(1162, 400, 1242)).toBe(374); // 464800 / 1242 = 374.2
    expect(partialFieldRepair(48, 0, 132)).toBe(0);
    expect(partialFieldRepair(48, 132, 132)).toBe(48);
    expect(partialFieldRepair(48, 500, 132)).toBe(48); // never more than the damage
    expect(partialFieldRepair(7, 3, 3)).toBe(7);
    // Large values stay exact (below 2^53).
    expect(partialFieldRepair(999_999, 1_234_567, 2_000_000)).toBe(Math.floor((999_999 * 1_234_567) / 2_000_000));
  });
});

describe("OC-F14 the cancel", () => {
  it("refuses with a reason and the SAME state: nothing ordered, the threshold's own repair, the repair already done", () => {
    const { state, id } = at(TOXIC_FROZEN, 200, 48);
    expect(canCancelFieldRepair(state, id)).toEqual({ ok: false, reason: "noOrder" });
    expect(cancelFieldRepair(state, id)).toBe(state);
    expect(canCancelFieldRepair(state, "nope")).toEqual({ ok: false, reason: "noExpedition" });
    // The threshold repair is the ship's own: not cancellable.
    const { exp } = ocf14Dispatch(TOXIC_FROZEN);
    const auto = advanceExpedition(ocf14Damaged(exp, ocf14Threshold(exp) - 1), OCF14_FAR);
    const autoLeg = auto.groundOps!.repairLegs![0];
    const mid = advanceExpedition(ocf14Damaged(exp, ocf14Threshold(exp) - 1), autoLeg.startsAt + 10);
    const s = { ...state, gameTimeSeconds: autoLeg.startsAt + 10, expeditions: [mid] };
    expect(canCancelFieldRepair(s, id)).toEqual({ ok: false, reason: "noOrder" });
    // A world repair already repaired (flying back) cannot be canceled.
    const big = orderFieldRepair(at(TOXIC_FROZEN, 200, 1162).state, id);
    const leg = legOf(big);
    expect(canCancelFieldRepair(later(big, leg.repairedAt + 5), id)).toEqual({ ok: false, reason: "repaired" });
    expect(cancelFieldRepair(later(big, leg.repairedAt + 5), id)).toEqual(later(big, leg.repairedAt + 5));
    for (const r of ["noOrder", "repaired", "runFinished"] as const) expect(fieldRepairCancelBlockText(r).length).toBeGreaterThan(0);
  });

  it("repairing in orbit: the repair stops now and keeps its share; the ship is back on the scan at once", () => {
    const { state, t, id } = at(TOXIC_FROZEN, 200, 48);
    const ordered = orderFieldRepair(state, id);
    expect(legOf(ordered)).toMatchObject({ siteBodyIndex: null, startsAt: t, repairedAt: t + 132 });
    const cut = cancelFieldRepair(later(ordered, t + 50), id);
    const leg = legOf(cut);
    expect(leg).toMatchObject({ canceled: true, ordered: true, siteBodyIndex: null, startsAt: t, arrivesAt: t, repairedAt: t + 50, endsAt: t + 50, hullRepaired: 18, done: true });
    expect(cut.expeditions[0].groundOps!.hullDamage).toBe(30);
    // The order can be given again for the rest.
    expect(canOrderFieldRepair(cut, id)).toEqual({ ok: true });
  });

  it("repairing on a world: the share is kept and the flight back still applies", () => {
    const { state, t, id } = at(TOXIC_FROZEN, 200, 1162);
    const ordered = orderFieldRepair(state, id);
    const full = legOf(ordered);
    expect(full).toMatchObject({ siteBodyIndex: 1, arrivesAt: t + 300, repairedAt: t + 300 + 1202, endsAt: t + 600 + 1202 });
    const c = t + 300 + 400;
    const cut = cancelFieldRepair(later(ordered, c), id);
    const leg = legOf(cut);
    expect(leg).toMatchObject({ canceled: true, siteBodyIndex: 1, arrivesAt: t + 300, repairedAt: c, endsAt: c + IN_SYSTEM_LEG_SECONDS, hullRepaired: 386 }); // 464800 / 1202 = 386.7
    expect(leg.done).toBeUndefined();
    expect(cut.expeditions[0].groundOps!.hullDamage).toBe(1162);
    // The share lands when the ship is back (the leg's end), like any repair.
    const back = advanceExpedition(cut.expeditions[0], c + IN_SYSTEM_LEG_SECONDS);
    expect(back.groundOps!.hullDamage).toBe(1162 - 386);
    expect(back.groundOps!.repairLegs![0].done).toBe(true);
  });

  it("flying out: the ship turns back at once and flies back as far as it flew; nothing is repaired", () => {
    const { state, t, id } = at(TOXIC_FROZEN, 200, 1162);
    const ordered = orderFieldRepair(state, id);
    const cut = cancelFieldRepair(later(ordered, t + 120), id);
    expect(legOf(cut)).toMatchObject({ canceled: true, startsAt: t, arrivesAt: t + 120, repairedAt: t + 120, endsAt: t + 240, hullRepaired: 0 });
    const back = advanceExpedition(cut.expeditions[0], t + 240);
    expect(back.groundOps!.hullDamage).toBe(1162);
  });

  it("an order the ship has not started (or from this very instant) is withdrawn: the run is as if never ordered", () => {
    const { state, t, id } = at(TOXIC_FROZEN, 200, 48);
    const ordered = orderFieldRepair(state, id);
    const withdrawn = cancelFieldRepair(ordered, id);
    expect(withdrawn.expeditions[0].groundOps!.repairLegs).toBeUndefined();
    expect(advanceExpedition(withdrawn.expeditions[0], t + 5000)).toEqual(advanceExpedition(state.expeditions[0], t + 5000));
  });

  it("an order waiting for a pickup under way is withdrawn whole", { timeout: 120_000 }, () => {
    // The GO-8b parity squad (a medic aboard): its run wipes and sends the ship on a recovery leg.
    const member = (mid: string, teamType: AwayMember["teamType"], over: Partial<AwayMember> = {}): AwayMember => ({ ...plainAwayMember(mid, teamType, "ship-1"), ...over });
    const squad = [member("member-1", "security", { rank: 3 }), member("member-2", "security", { rank: 2, traits: ["fieldMedic"] }), member("member-11", "science")];
    const s0 = withSlottedAwayTeams({ ...freshState(), awayMembers: squad, nextAwayMemberId: 100, expeditionSeed: 0xa13bd4 });
    const res = asPreCurveDispatch(dispatchPastPropulsion(s0, "ship-1", 1, expeditionCandidates(s0, "ship-1")[0].id));
    const exp = res.expedition!;
    const pickup = advanceExpedition(exp, OCF14_FAR).groundOps!.shipLegs[0];
    const t = pickup.startsAt + 10;
    const run = ocf14Damaged(advanceExpedition(exp, t), 48);
    const state: GameState = { ...res.next, gameTimeSeconds: t, expeditions: [run] };
    const ordered = orderFieldRepair(state, exp.id);
    expect(legOf(ordered).startsAt).toBe(pickup.endsAt);
    const withdrawn = cancelFieldRepair(later(ordered, t + 20), exp.id);
    expect(withdrawn.expeditions[0].groundOps!.repairLegs).toBeUndefined();
    expect(advanceExpedition(withdrawn.expeditions[0], OCF14_FAR)).toEqual(advanceExpedition(run, OCF14_FAR));
  });
});

describe("OC-F14 determinism after a cancel", () => {
  it("one call == 997 s chunks == 1 s steps; a cancel on a live-stepped run == one on a run advanced in one call", { timeout: 180_000 }, () => {
    const { state, t, id } = at(TOXIC_FROZEN, 200, 1162);
    const ordered = orderFieldRepair(state, id);
    const c = t + 300 + 400;
    // The run stepped live second by second to the cancel, against the stored order advanced in one call.
    let live = ordered.expeditions[0];
    for (let x = t + 1; x <= c; x += 1) live = advanceExpedition(live, x);
    const cutLive = cancelFieldRepair({ ...ordered, gameTimeSeconds: c, expeditions: [live] }, id).expeditions[0];
    const cut = cancelFieldRepair(later(ordered, c), id).expeditions[0];
    expect(cutLive).toEqual(cut);
    const END = c + 6000;
    const big = advanceExpedition(cut, END);
    let chunked = cut;
    for (let x = c + 997; x < END; x += 997) chunked = advanceExpedition(chunked, x);
    expect(advanceExpedition(chunked, END)).toEqual(big);
    let steps = cut;
    for (let x = c + 1; x <= END; x += 1) steps = advanceExpedition(steps, x);
    expect(steps).toEqual(big);
  });

  it("one economyTick == 997-tick chunks == 1-tick steps over the cut leg's end", { timeout: 300_000 }, () => {
    const { state, t, id } = at(TOXIC_FROZEN, 200, 1162);
    const c = t + 300 + 400;
    const cut = cancelFieldRepair(later(orderFieldRepair(state, id), c), id);
    const RNG = () => 0.5;
    const N = 1500;
    const one = economyTick(cut, N, RNG);
    let chunked = cut;
    for (let n = 0; n < N; n += 997) chunked = economyTick(chunked, Math.min(997, N - n), RNG);
    let steps = cut;
    for (let n = 0; n < N; n += 1) steps = economyTick(steps, 1, RNG);
    expect(chunked.expeditions).toEqual(one.expeditions);
    expect(steps.expeditions).toEqual(one.expeditions);
    expect(one.expeditions[0].groundOps!.hullDamage).toBe(1162 - 386);
  });
});

describe("OC-F14 review: the cancel pulls queued legs earlier, a new order after a cancel, recall, a large game time", () => {
  const medicSquad = (): AwayMember[] => {
    const m = (mid: string, teamType: AwayMember["teamType"], over: Partial<AwayMember> = {}): AwayMember => ({ ...plainAwayMember(mid, teamType, "ship-1"), ...over });
    return [m("member-1", "security", { rank: 3 }), m("member-2", "security", { rank: 2, traits: ["fieldMedic"] }), m("member-11", "science")];
  };

  it("a wiped team's pickup queued behind the order starts when the cut leg ends (no idle gap); one call == 997 s == 1 s", { timeout: 300_000 }, () => {
    let checked = 0;
    for (const seed of [0xa13bd4, 0xa1d67f, 0xa2145d, 0xa2523b]) {
      const s0 = withSlottedAwayTeams({ ...freshState(), awayMembers: medicSquad(), nextAwayMemberId: 100, expeditionSeed: seed });
      const res = asPreCurveDispatch(dispatchPastPropulsion(s0, "ship-1", 1, expeditionCandidates(s0, "ship-1")[0].id));
      const exp = res.expedition!;
      const wipe = advanceExpedition(exp, OCF14_FAR).groundOps!.shipLegs[0].startsAt;
      // A long repair ordered just before the wipe, so the pickup is asked for while the ship repairs.
      const before = ocf14Damaged(advanceExpedition(exp, wipe - 60), 1162);
      const ordered = orderFieldRepair({ ...res.next, gameTimeSeconds: wipe - 60, expeditions: [before] }, exp.id);
      const repair = legOf(ordered);
      const c = wipe + 120;
      if (!(c < repair.repairedAt)) continue;
      const live = advanceExpedition(ordered.expeditions[0], c);
      const queued = live.groundOps!.shipLegs.find((l) => l.startsAt >= repair.endsAt);
      if (!queued) continue;
      expect(queued.startsAt).toBe(repair.endsAt);
      const cut = cancelFieldRepair({ ...ordered, gameTimeSeconds: c }, exp.id).expeditions[0];
      const cutLeg = cut.groundOps!.repairLegs![0];
      const pickup = cut.groundOps!.shipLegs.find((l) => l.teamIndex === queued.teamIndex && l.bodyIndex === queued.bodyIndex && l.startsAt >= cutLeg.startsAt)!;
      expect(cutLeg.canceled).toBe(true);
      expect(pickup.startsAt).toBe(cutLeg.endsAt); // no idle gap where the order used to be
      expect(pickup.endsAt - pickup.startsAt).toBe(2 * IN_SYSTEM_LEG_SECONDS);
      for (const team of cut.groundOps!.teams) if (team.step === "return" && pickup.teamIndex === team.index) expect(team.stepEndsAt).toBe(pickup.arrivesAt);
      const END = c + 6000;
      const big = advanceExpedition(cut, END);
      let chunked = cut;
      for (let x = c + 997; x < END; x += 997) chunked = advanceExpedition(chunked, x);
      expect(advanceExpedition(chunked, END)).toEqual(big);
      let steps = cut;
      for (let x = c + 1; x <= END; x += 1) steps = advanceExpedition(steps, x);
      expect(steps).toEqual(big);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("a new order during a canceled leg's flight back is accepted: it waits for the ship and fixes what is left", () => {
    const { state, t, id } = at(TOXIC_FROZEN, 200, 1162);
    const c = t + 300 + 400;
    const cut = cancelFieldRepair(later(orderFieldRepair(state, id), c), id);
    const back = legOf(cut);
    expect(canOrderFieldRepair(later(cut, c + 10), id)).toEqual({ ok: true });
    const again = orderFieldRepair(later(cut, c + 10), id);
    const second = again.expeditions[0].groundOps!.repairLegs![1];
    expect(second).toMatchObject({ ordered: true, startsAt: back.endsAt, hullRepaired: 1162 - 386 });
    expect(second.canceled).toBeUndefined();
    // The new order is the one Cancel now reaches; the first stays canceled.
    expect(canCancelFieldRepair(later(again, c + 20), id)).toEqual({ ok: true });
    const done = advanceExpedition(again.expeditions[0], second.endsAt);
    expect(done.groundOps!.hullDamage).toBeUndefined();
  });

  it("recall with the rule on: during an orbit repair the hull comes home with its damage; during a canceled leg's flight back it keeps the share", () => {
    const orbit = at(TOXIC_FROZEN, 200, 48);
    const ordered = orderFieldRepair(orbit.state, orbit.id);
    expect(ordered.expeditions[0].repairRules).toBe(1);
    expect(legOf(ordered).siteBodyIndex).toBeNull();
    const recalled = recallExpedition(later(ordered, orbit.t + 50), orbit.id);
    const ops = recalled.expeditions[0].groundOps!;
    expect(ops.recalledAt).toBe(orbit.t + 50);
    expect(ops.hullDamage).toBe(48);
    expect(ops.repairLegs![0].done).toBeUndefined();
    const world = at(TOXIC_FROZEN, 200, 1162);
    const c = world.t + 300 + 400;
    const cut = cancelFieldRepair(later(orderFieldRepair(world.state, world.id), c), world.id);
    const home = recallExpedition(later(cut, c + 10), world.id).expeditions[0].groundOps!;
    expect(home.recalledAt).toBe(c + 10);
    expect(home.hullDamage).toBe(1162 - 386);
    expect(home.repairLegs![0]).toMatchObject({ canceled: true, done: true });
  });

  it("at a large game time (3e6 s): order, cancel mid-repair, then one call == 997 s == 1 s", { timeout: 300_000 }, () => {
    const T0 = 3_000_000;
    const squad = [plainAwayMember("member-1", "security", "ship-1"), plainAwayMember("member-2", "security", "ship-1"), plainAwayMember("member-11", "science", "ship-1")];
    const s0 = withSlottedAwayTeams({ ...freshState(), gameTimeSeconds: T0, awayMembers: squad, nextAwayMemberId: 100, expeditionSeed: TOXIC_FROZEN });
    const res = asPreCurveDispatch(dispatchPastPropulsion(s0, "ship-1", 1, expeditionCandidates(s0, "ship-1")[0].id));
    const exp = res.expedition!;
    let open = exp;
    for (let x = T0; open.groundOps!.startedAt === undefined; ) {
      x += 600;
      open = advanceExpedition(exp, x);
    }
    const t = open.groundOps!.startedAt! + 200;
    expect(t).toBeGreaterThan(T0);
    const run = ocf14Damaged(advanceExpedition(exp, t), 1162);
    const ordered = orderFieldRepair({ ...res.next, gameTimeSeconds: t, expeditions: [run] }, exp.id);
    const leg = legOf(ordered);
    expect(leg.startsAt).toBe(t);
    const c = leg.arrivesAt + 400;
    expect(c).toBeLessThan(leg.repairedAt);
    const cut = cancelFieldRepair(later(ordered, c), exp.id).expeditions[0];
    const cutLeg = cut.groundOps!.repairLegs![0];
    expect(cutLeg.hullRepaired).toBe(partialFieldRepair(1162, 400, leg.repairedAt - leg.arrivesAt));
    expect(cutLeg.endsAt).toBe(c + (leg.endsAt - leg.repairedAt));
    const END = c + 6000;
    const big = advanceExpedition(cut, END);
    let chunked = cut;
    for (let x = c + 997; x < END; x += 997) chunked = advanceExpedition(chunked, x);
    expect(advanceExpedition(chunked, END)).toEqual(big);
    let steps = cut;
    for (let x = c + 1; x <= END; x += 1) steps = advanceExpedition(steps, x);
    expect(steps).toEqual(big);
    expect(big.groundOps!.repairLegs![0].done).toBe(true);
  });
});
