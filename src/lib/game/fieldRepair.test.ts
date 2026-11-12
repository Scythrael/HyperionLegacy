// Ground Operations GO-8b: EXPEDITION FIELD REPAIR (user WWVD, 2026-10-12). A damaged ship never has to go home:
// past the damage threshold (or by the player's order) it sets down on the nearest rocky world with an atmosphere
// (never a gas giant), or repairs in orbit when there is none, on the Shipyard's repair formula divided by its
// frozen Engineering repair speed-up, then resumes. The leg pauses the scan like a recovery leg, never overlaps
// another leg, and fixes the damage at its end. Pure: one call == 997 s == 1 s over the scan.

import { describe, expect, it } from "vitest";
import { freshState, repairTicksForDamage, type AwayMember, type Expedition, type ExpeditionBody, type GameState } from "./model";
import {
  advanceExpedition,
  canOrderFieldRepair,
  claimExpedition,
  expeditionCandidates,
  orderFieldRepair,
  scanRatePerSecond,
  } from "./expedition";
import {
  FIELD_REPAIR_DAMAGE_SHARE,
  FIELD_REPAIR_PLANET_TYPES,
  FIELD_REPAIR_TIME_MULT,
  IN_SYSTEM_LEG_SECONDS,
  ORBIT_REPAIR_TIME_MULT,
  fieldRepairBlockText,
  fieldRepairSeconds,
  fieldRepairSite,
  groundShipPosition,
  scanClockAt,
  scanClockToTime,
  shipLegsInOrder,
} from "./groundOps";
import { shipRepairDurationTicks } from "./tick";
import { withRepairRulesOff } from "./fieldRepairRulesSwitch.fixture";
import { asPreCurveDispatch, plainAwayMember, withoutGroundOps, withoutShipEvents, withSlottedAwayTeams, dispatchPastPropulsion } from "./awayTeamTestFixtures";

const member = (id: string, teamType: AwayMember["teamType"], over: Partial<AwayMember> = {}): AwayMember => ({
  ...plainAwayMember(id, teamType, "ship-1"),
  ...over,
});
const SQUAD: AwayMember[] = [member("member-1", "security", { rank: 3 }), member("member-2", "security", { rank: 2 }), member("member-11", "science")];
// A run whose scan holds two damaging events (a cloaked vessel lost, then debris), pinned by a sweep.
const SEED = 0xa6fe4;
const FAR = 120_000;

// The GO-7b parity squad (a medic aboard): its runs wipe and send the ship on recovery legs.
const MEDIC_SQUAD: AwayMember[] = [member("member-1", "security", { rank: 3 }), member("member-2", "security", { rank: 2, traits: ["fieldMedic"] }), member("member-11", "science")];

function dispatch(expeditionSeed = SEED, squad: AwayMember[] = SQUAD): { next: GameState; exp: Expedition } {
  const s = withSlottedAwayTeams({ ...freshState(), awayMembers: squad.map((m) => ({ ...m })), nextAwayMemberId: 100, expeditionSeed });
  const res = asPreCurveDispatch(dispatchPastPropulsion(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id));
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  return { next: res.next, exp: res.expedition };
}

// The run with the ship already carrying `damage` hull points (a test fixture: the first light damage then
// crosses the threshold), optionally with every body's planet type replaced.
function damaged(exp: Expedition, damage: number, planetType?: ExpeditionBody["planetType"]): Expedition {
  return {
    ...exp,
    bodies: planetType ? exp.bodies.map((b) => ({ ...b, planetType })) : exp.bodies,
    groundOps: { ...exp.groundOps!, hullDamage: damage },
  };
}
const threshold = (exp: Expedition) => FIELD_REPAIR_DAMAGE_SHARE * exp.groundOps!.shipEventProfile.battle!.hullMax;
const body = (planetType: ExpeditionBody["planetType"]): ExpeditionBody => ({
  id: "b",
  planetType,
  scanTotal: 100,
  scanProgress: 0,
  hazard: 0,
  scanned: false,
  discoveries: [],
  activities: [],
});
function windowOpen(exp: Expedition): number {
  let t = 0;
  let e = exp;
  while (e.groundOps!.startedAt === undefined) {
    t += 600;
    e = advanceExpedition(exp, t);
  }
  return e.groundOps!.startedAt!;
}
const scanEnd = (exp: Expedition, done: Expedition): number => {
  const bodyTime = exp.bodies.reduce((sum, b) => sum + b.scanTotal / scanRatePerSecond(exp, b), 0);
  const paused = (done.scanEvents ?? []).reduce((sum, ev) => sum + (ev.pauseSeconds ?? 0), 0);
  return scanClockToTime(done.groundOps!, bodyTime + paused);
};

describe("GO-8b the pieces", () => {
  it("the repair time is the Shipyard's formula (one definition), divided by the repair speed-up, x the field multiplier", () => {
    for (const damage of [1, 37, 150, 600]) {
      for (const speed of [0, 0.25, 1.5]) {
        expect(repairTicksForDamage(damage, speed)).toBe(shipRepairDurationTicks({ id: "x", typeKey: "destroyer", assignedCaptainId: null, repairDamage: damage }, [], speed));
        expect(fieldRepairSeconds(damage, speed, true)).toBe(repairTicksForDamage(damage, speed) * FIELD_REPAIR_TIME_MULT);
        expect(fieldRepairSeconds(damage, speed, false)).toBe(repairTicksForDamage(damage, speed) * ORBIT_REPAIR_TIME_MULT);
      }
    }
    expect(ORBIT_REPAIR_TIME_MULT).toBeGreaterThan(FIELD_REPAIR_TIME_MULT); // in orbit is slower
    expect(fieldRepairSeconds(150, 1, true)).toBeLessThan(fieldRepairSeconds(150, 0, true));
  });

  it("the site: the nearest rocky world with an atmosphere (ties to the lower index), never a gas giant; none = orbit", () => {
    expect(FIELD_REPAIR_PLANET_TYPES).not.toContain("gasGiant");
    const at = (types: ExpeditionBody["planetType"][], from: number) => fieldRepairSite({ bodies: types.map(body) }, from);
    expect(at(["gasGiant", "barren", "terrestrial"], 0)).toBe(2);
    expect(at(["toxic", "ocean", "gasGiant", "arid"], 2)).toBe(1);
    expect(at(["frozen", "gasGiant"], 1)).toBe(0);
    expect(at(["arid"], 0)).toBe(0);
    expect(at(["gasGiant", "barren", "toxic", "volcanic"], 1)).toBeNull();
  });

  it("the dispatch freezes the repair speed-up (the field repair flag)", () => {
    const { exp } = dispatch();
    expect(exp.groundOps!.shipEventProfile.battle!.repairSpeed).toBe(0);
  });
});

describe("GO-8b the threshold repair on a real run", () => {
  const { next, exp: dispatched } = dispatch();
  const start = damaged(dispatched, threshold(dispatched) - 1);
  const done = advanceExpedition(start, FAR);
  const ops = done.groundOps!;
  const leg = ops.repairLegs![0];

  it("the first light damage past the threshold sends the ship down for repairs at that event's time", () => {
    const wear = (done.scanEvents ?? []).find((ev) => ev.kind === "shipEvent" && (ev.hullWear ?? 0) > 0)!;
    expect(ops.repairLegs).toHaveLength(1);
    expect(leg.ordered).toBeUndefined();
    expect(leg.hullRepaired).toBe(threshold(dispatched) - 1 + wear.hullWear!);
    expect(leg.scanBodyIndex).toBe(wear.bodyIndex);
    // The repair site and its legs. OC-F14: this system mixes a repair world (the frozen body 1) with the toxic body the
    // ship scans, so the run carries the repair rules and the leg takes the faster of that world and orbit: orbit here.
    const world = fieldRepairSite(done, wear.bodyIndex);
    expect(dispatched.repairRules).toBe(1);
    expect(world).toBe(1);
    expect(wear.bodyIndex).toBe(0);
    const worldTotal = 2 * IN_SYSTEM_LEG_SECONDS + fieldRepairSeconds(leg.hullRepaired, 0, true);
    const orbitTotal = fieldRepairSeconds(leg.hullRepaired, 0, false);
    expect(orbitTotal).toBeLessThan(worldTotal);
    expect(leg.siteBodyIndex).toBeNull();
    expect(leg.arrivesAt - leg.startsAt).toBe(0);
    expect(leg.repairedAt - leg.arrivesAt).toBe(orbitTotal);
    expect(leg.endsAt - leg.repairedAt).toBe(0);
    expect(leg.done).toBe(true);
    // The ship is on the leg, the scan clock stops for the whole of it.
    expect(groundShipPosition(done, leg.startsAt + 1)).toEqual({ kind: "repair", leg });
    expect(scanClockAt(ops, leg.endsAt) - scanClockAt(ops, leg.startsAt)).toBe(0);
  });

  it("a run without the repair rules (dispatched before OC-F14) still sets down on the nearest repair world", () => {
    const old = withRepairRulesOff(() => {
      const d = dispatch().exp;
      return advanceExpedition(damaged(d, threshold(d) - 1), FAR);
    });
    expect(old.repairRules).toBeUndefined();
    const wear = (old.scanEvents ?? []).find((ev) => ev.kind === "shipEvent" && (ev.hullWear ?? 0) > 0)!;
    const oldLeg = old.groundOps!.repairLegs![0];
    const site = fieldRepairSite(old, wear.bodyIndex);
    expect(oldLeg.siteBodyIndex).toBe(site);
    const travel = site === null || site === wear.bodyIndex ? 0 : IN_SYSTEM_LEG_SECONDS;
    expect(travel).toBe(IN_SYSTEM_LEG_SECONDS);
    expect(oldLeg.arrivesAt - oldLeg.startsAt).toBe(travel);
    expect(oldLeg.repairedAt - oldLeg.arrivesAt).toBe(fieldRepairSeconds(oldLeg.hullRepaired, 0, site !== null));
    expect(oldLeg.endsAt - oldLeg.repairedAt).toBe(travel);
    expect(oldLeg.done).toBe(true);
  });

  it("the damage is fixed at the leg's end; only later light damage comes home", () => {
    const during = advanceExpedition(start, leg.endsAt - 1).groundOps!;
    expect(during.hullDamage).toBe(leg.hullRepaired);
    const after = advanceExpedition(start, leg.endsAt).groundOps!;
    expect(after.hullDamage).toBeUndefined();
    const later = (done.scanEvents ?? []).filter((ev) => ev.kind === "shipEvent" && (ev.hullWear ?? 0) > 0).slice(1);
    expect(ops.hullDamage ?? 0).toBe(later.reduce((sum, ev) => sum + ev.hullWear!, 0));
    let e = advanceExpedition(start, 2_000_000);
    if (e.phase !== "complete") e = { ...e, phase: "complete" };
    const ship = claimExpedition({ ...next, expeditions: [e] }, e.id).next.ships[0];
    expect(ship.damaged === true).toBe((ops.hullDamage ?? 0) > 0);
  });

  it("the scan lasts its bodies, its pauses and its legs; one call == 997 s == 1 s over the scan", { timeout: 180_000 }, () => {
    const end = scanEnd(start, done);
    const legs = shipLegsInOrder(ops).filter((l) => l.scanBodyIndex !== null).reduce((sum, l) => sum + (l.endsAt - l.startsAt), 0);
    const bodyTime = start.bodies.reduce((sum, b) => sum + b.scanTotal / scanRatePerSecond(start, b), 0);
    const paused = (done.scanEvents ?? []).reduce((sum, ev) => sum + (ev.pauseSeconds ?? 0), 0);
    expect(end - ops.startedAt!).toBeCloseTo(bodyTime + paused + legs, 6);
    const END = Math.ceil(end) + 5;
    const big = advanceExpedition(start, END);
    let chunked = start;
    for (let t = 997; t < END; t += 997) chunked = advanceExpedition(chunked, t);
    expect(advanceExpedition(chunked, END)).toEqual(big);
    const open = windowOpen(start);
    let live = advanceExpedition(start, open - 1);
    for (let t = open; t <= END; t += 1) live = advanceExpedition(live, t);
    expect(live).toEqual(big);
    expect(big.groundOps!.repairLegs).toHaveLength(1);
  });

  it("with no suitable world in the system the ship repairs in orbit, where it is, slower", () => {
    const orbit = advanceExpedition(damaged(dispatched, threshold(dispatched) - 1, "gasGiant"), FAR).groundOps!.repairLegs![0];
    expect(orbit.siteBodyIndex).toBeNull();
    expect(orbit.arrivesAt).toBe(orbit.startsAt);
    expect(orbit.endsAt).toBe(orbit.repairedAt);
    expect(orbit.repairedAt - orbit.arrivesAt).toBe(fieldRepairSeconds(orbit.hullRepaired, 0, false));
  });

  it("a run without the flag never sets down (pre-GO-8b, pre-GO-8, legacy)", () => {
    const battle = { ...dispatched.groundOps!.shipEventProfile.battle! };
    delete battle.repairSpeed;
    const pre8b: Expedition = { ...start, groundOps: { ...start.groundOps!, shipEventProfile: { ...start.groundOps!.shipEventProfile, battle } } };
    expect(advanceExpedition(pre8b, FAR).groundOps!.repairLegs).toBeUndefined();
    expect(advanceExpedition(withoutShipEvents(start), FAR).groundOps!.repairLegs).toBeUndefined();
  });
});

describe("GO-8b the player's order", () => {
  const { next, exp } = dispatch();
  const open = windowOpen(exp);

  it("refuses with a reason and the SAME state", () => {
    const at = (e: Expedition, t: number): GameState => ({ ...next, gameTimeSeconds: t, expeditions: [e] });
    const calm = at(exp, open + 10);
    expect(canOrderFieldRepair(calm, "nope")).toEqual({ ok: false, reason: "noExpedition" });
    expect(canOrderFieldRepair(at(withoutGroundOps(exp), open + 10), exp.id)).toEqual({ ok: false, reason: "notGroundOps" });
    expect(canOrderFieldRepair(at(withoutShipEvents(damaged(exp, 50)), open + 10), exp.id)).toEqual({ ok: false, reason: "noFieldRepair" });
    expect(canOrderFieldRepair(calm, exp.id)).toEqual({ ok: false, reason: "noDamage" });
    expect(orderFieldRepair(calm, exp.id)).toBe(calm);
    for (const r of ["noFieldRepair", "noDamage", "alreadyRepairing", "runFinished"] as const) expect(fieldRepairBlockText(r).length).toBeGreaterThan(0);
  });

  it("an order mid-scan starts now, pauses the scan, and a second order waits its turn (alreadyRepairing)", { timeout: 120_000 }, () => {
    const s0: GameState = { ...next, gameTimeSeconds: open + 200, expeditions: [damaged(exp, 40)] };
    expect(canOrderFieldRepair(s0, exp.id)).toEqual({ ok: true });
    const s1 = orderFieldRepair(s0, exp.id);
    const leg = s1.expeditions[0].groundOps!.repairLegs![0];
    expect(leg).toMatchObject({ ordered: true, startsAt: open + 200, hullRepaired: 40 });
    expect(leg.scanBodyIndex).not.toBeNull();
    expect(canOrderFieldRepair({ ...s1, gameTimeSeconds: open + 210 }, exp.id)).toEqual({ ok: false, reason: "alreadyRepairing" });
    // Parity with the order stored: one call == 997 s chunks over the scan, and the input is untouched.
    const stored = s1.expeditions[0];
    const frozen = structuredClone(stored);
    const far = advanceExpedition(stored, FAR);
    const END = Math.ceil(scanEnd(stored, far)) + 5;
    let chunked = stored;
    for (let t = open + 997; t < END; t += 997) chunked = advanceExpedition(chunked, t);
    expect(advanceExpedition(chunked, END)).toEqual(advanceExpedition(stored, END));
    expect(stored).toEqual(frozen);
  });

  it("an order after the scan pauses nothing, holds the window open until it is done, and the ship comes home whole", () => {
    const t = Math.ceil(scanEnd(exp, advanceExpedition(exp, FAR))) + 30;
    const e = advanceExpedition(exp, t);
    expect(e.bodies.every((b) => b.scanned)).toBe(true);
    expect(e.groundOps!.endedAt).toBeUndefined(); // the pinned run's teams are still at work
    const s1 = orderFieldRepair({ ...next, gameTimeSeconds: t, expeditions: [damaged(e, 30)] }, exp.id);
    const leg = s1.expeditions[0].groundOps!.repairLegs![0];
    expect(leg).toMatchObject({ ordered: true, scanBodyIndex: null, startsAt: t, hullRepaired: 30 });
    expect(fieldRepairSite(e)).toBe(leg.siteBodyIndex); // from the last body (holding station)
    const done = advanceExpedition(s1.expeditions[0], 2_000_000);
    if (done.groundOps!.endedAt !== undefined) expect(done.groundOps!.endedAt).toBeGreaterThanOrEqual(leg.endsAt);
    expect(done.groundOps!.hullDamage).toBeUndefined();
    // A window whose teams are all done waits for the repair before the ship heads home.
    const idle = { ...s1.expeditions[0], bodies: s1.expeditions[0].bodies.map((b) => ({ ...b, activities: b.activities.map((a) => ({ ...a, status: "skipped" as const })) })) };
    const settled = advanceExpedition(idle, leg.endsAt - 1);
    expect(settled.groundOps!.endedAt).toBeUndefined();
    expect(advanceExpedition(idle, 2_000_000).groundOps!.endedAt).toBeGreaterThanOrEqual(leg.endsAt);
  });
});

describe("GO-8b the ship flies one leg at a time (Q1: a wiped team's pickup waits for the repair)", () => {
  it("a wipe during a field repair waits for it; no leg ever overlaps another; the teams keep working meanwhile", { timeout: 120_000 }, () => {
    let waited = 0;
    let working = 0;
    for (const seed of [0xa13bd4, 0xa1d67f, 0xa2145d, 0xa2523b]) {
      const { exp } = dispatch(seed, MEDIC_SQUAD);
      // The first wipe while scanning, without any repair; then a long repair ordered just before it.
      const plain = advanceExpedition(exp, FAR).groundOps!;
      const wipe = plain.shipLegs[0].startsAt;
      const s1 = orderFieldRepair({ ...freshState(), gameTimeSeconds: wipe - 60, expeditions: [damaged(exp, 400)] }, exp.id);
      const ops = advanceExpedition(s1.expeditions[0], FAR).groundOps!;
      const repair = ops.repairLegs![0];
      expect(repair.startsAt).toBe(wipe - 60);
      const legs = shipLegsInOrder(ops);
      for (let i = 1; i < legs.length; i += 1) expect(legs[i].startsAt).toBeGreaterThanOrEqual(legs[i - 1].endsAt);
      if (ops.shipLegs.some((l) => l.startsAt === repair.endsAt)) waited += 1;
      // The display history is capped, so read it near the repair.
      const near = advanceExpedition(s1.expeditions[0], repair.endsAt + 600).groundOps!;
      working += near.history.filter((r) => (r.step === "work" || r.step === "fight") && r.startedAt < repair.endsAt && repair.startsAt < r.endedAt).length;
    }
    expect(waited).toBeGreaterThan(0);
    expect(working).toBeGreaterThan(0);
  });
});
