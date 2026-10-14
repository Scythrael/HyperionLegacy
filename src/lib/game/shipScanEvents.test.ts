// Ground Operations GO-8: the SHIP-SIDE SCAN EVENTS (shipScanEvents.ts) on a flagged run, replacing the scan-time
// ground battles (user 9b.6): the fixed draw layout, the gate (pre-GO-8 flagged runs and legacy runs keep their
// shape), each event's resolution and stakes (user Q12: light hull damage carried home), the ghost's bonus
// discovery, the pauses on the scan walk, and offline == live parity (one call == 997 s == 1 s over the scan).

import { describe, expect, it } from "vitest";
import { freshState, type AwayMember, type Expedition, type GameState } from "./model";
import { advanceExpedition, claimExpedition, expeditionCandidates, scanRatePerSecond, startExpedition } from "./expedition";
import { scanClockToTime } from "./groundOps";
import { plainAwayMember, withSlottedAwayTeams, withoutGroundOps, withoutShipEvents } from "./awayTeamTestFixtures";
import { processShipRepairs } from "./tick";
import {
  CLOAKED_VESSEL_HULL,
  DEBRIS_DELAY_SECONDS,
  GHOST_CLOAKED_CHANCE,
  HOSTILE_PROBE_HULL,
  PROBE_HULL_SHARE,
  PROBE_REPAIR_SECONDS,
  SHIP_EVENT_WEIGHTS,
  SHIP_EVENT_WEIGHT_TOTAL,
  applyShipEventDamage,
  resolveShipScanEvent,
  resolveShipScanEventFromDraws,
  shipEventCheckChance,
  shipEventDraws,
  shipEventEnemy,
  shipEventKindOf,
  shipEventsLive,
  type ShipEventDraws,
} from "./shipScanEvents";

const member = (id: string, teamType: AwayMember["teamType"], over: Partial<AwayMember> = {}): AwayMember => ({
  ...plainAwayMember(id, teamType, "ship-1"),
  ...over,
});
const SQUAD: AwayMember[] = [member("member-1", "security", { rank: 3 }), member("member-2", "security", { rank: 2 }), member("member-11", "science")];

function crewed(expeditionSeed: number): GameState {
  return withSlottedAwayTeams({ ...freshState(), awayMembers: SQUAD.map((m) => ({ ...m })), nextAwayMemberId: 100, expeditionSeed });
}
function dispatch(expeditionSeed: number): { next: GameState; exp: Expedition } {
  const s = crewed(expeditionSeed);
  const res = startExpedition(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id);
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  return { next: res.next, exp: res.expedition };
}
const shipEvents = (e: Expedition) => (e.scanEvents ?? []).filter((ev) => ev.kind === "shipEvent");
const FAR = 120_000;

// Seeds pinned by a sweep (the scenario test below fails loudly if a change moves them off): between them the
// runs hold every event kind and both outcomes of every check and of the cloaked fight.
const PINNED = [0x6eed1, 0x69204, 0xaadc2, 0x65426];

// The time the window opened (the scanning anchor).
function windowOpen(exp: Expedition): number {
  let t = 0;
  let e = exp;
  while (e.groundOps!.startedAt === undefined) {
    t += 600;
    e = advanceExpedition(exp, t);
  }
  return e.groundOps!.startedAt!;
}

describe("GO-8 the fixed draw layout", () => {
  it("draw 1 picks the kind by the weights; a ghost is a cloaked vessel on draw 3", () => {
    const counts: Record<string, number> = {};
    const N = 20_000;
    for (let i = 0; i < N; i++) {
      const k = shipEventKindOf(shipEventDraws({ seed: i * 2654435761 }, i % 7, 1 + (i % 9)));
      counts[k] = (counts[k] ?? 0) + 1;
    }
    const share = (k: string) => (counts[k] ?? 0) / N;
    expect(share("debris")).toBeCloseTo(SHIP_EVENT_WEIGHTS.debris / SHIP_EVENT_WEIGHT_TOTAL, 1);
    expect(share("probe")).toBeCloseTo(SHIP_EVENT_WEIGHTS.probe / SHIP_EVENT_WEIGHT_TOTAL, 1);
    expect(share("storm")).toBeCloseTo(SHIP_EVENT_WEIGHTS.storm / SHIP_EVENT_WEIGHT_TOTAL, 1);
    expect(share("ghost") + share("cloaked")).toBeCloseTo(SHIP_EVENT_WEIGHTS.ghost / SHIP_EVENT_WEIGHT_TOTAL, 1);
    expect(share("cloaked") / (share("ghost") + share("cloaked"))).toBeCloseTo(GHOST_CLOAKED_CHANCE, 1);
  });

  it("all five draws are always taken; the boarding draws (4, 5) never move draws 1 to 3 or the GO-8 outcome", () => {
    const { exp } = dispatch(PINNED[0]);
    const e = advanceExpedition(exp, windowOpen(exp) + 1);
    const body = e.bodies[0];
    for (let step = 1; step <= 9; step++) {
      const d = shipEventDraws(e, 0, step);
      for (const v of [d.check, d.cloaked, d.boardingAttempt, d.boardingRepel]) expect(v >= 0 && v < 1).toBe(true);
      const stubbed: ShipEventDraws = { ...d, boardingAttempt: 0.999, boardingRepel: 0.999 };
      const a = resolveShipScanEventFromDraws(e, body, 0, step, 0, d);
      const b = resolveShipScanEventFromDraws(e, body, 0, step, 0, stubbed);
      expect({ ...b.event, boarding: undefined }).toEqual({ ...a.event, boarding: undefined });
      expect(b.finding).toEqual(a.finding);
      expect(resolveShipScanEvent(e, body, 0, step, 0)).toEqual(a);
    }
  });

  it("the check chance: the base with no power, rising on the D23 curve, never certain", () => {
    expect(shipEventCheckChance(0.5, 0)).toBe(0.5);
    expect(shipEventCheckChance(0.5, Number.NaN)).toBe(0.5);
    expect(shipEventCheckChance(0.5, 1)).toBeGreaterThan(shipEventCheckChance(0.5, 0.5));
    expect(shipEventCheckChance(0.5, 1e9)).toBeLessThan(1);
  });
});

describe("GO-8 the gate: who rolls ship events", () => {
  it("a run dispatched now carries the battle inputs (the flag); a pre-GO-8 flagged run and a legacy run do not", () => {
    const { exp } = dispatch(PINNED[0]);
    expect(shipEventsLive(exp)).toBe(true);
    const battle = exp.groundOps!.shipEventProfile.battle!;
    expect(battle.hullType).toBe("generalFreighter");
    expect(battle.hullMax).toBeGreaterThan(0);
    expect(shipEventsLive(withoutShipEvents(exp))).toBe(false);
    expect(shipEventsLive(withoutGroundOps(exp))).toBe(false);
  });

  it("a pre-GO-8 flagged run rolls nothing at draw 1 (only supply caches); a legacy run still fights its ground encounters", () => {
    let legacyBattles = 0;
    for (const seed of PINNED) {
      const { exp } = dispatch(seed);
      const old = advanceExpedition(withoutShipEvents(exp), FAR);
      expect((old.scanEvents ?? []).every((ev) => ev.kind === "supplyCache")).toBe(true);
      expect(old.groundOps!.hullDamage).toBeUndefined();
      const legacy = advanceExpedition(withoutGroundOps(exp), FAR);
      legacyBattles += (legacy.scanEvents ?? []).filter((ev) => ev.kind === "encounter").length;
      expect(shipEvents(legacy)).toEqual([]);
      // The supply cache keeps its draw: a pre-GO-8 cache boundary holds the same cache or a ship event now.
      const now = advanceExpedition(exp, FAR);
      for (const ev of old.scanEvents ?? []) {
        const here = (now.scanEvents ?? []).find((x) => x.bodyIndex === ev.bodyIndex && x.step === ev.step);
        expect(here?.kind === "supplyCache" || here?.kind === "shipEvent").toBe(true);
      }
    }
    expect(legacyBattles).toBeGreaterThan(0);
  });
});

describe("GO-8 the events on real runs", () => {
  const runs = PINNED.map((seed) => {
    const d = dispatch(seed);
    return { ...d, done: advanceExpedition(d.exp, FAR) };
  });
  const all = runs.flatMap((r) => shipEvents(r.done));

  it("the pinned runs hold every kind and both outcomes of every check and of the cloaked fight", () => {
    const seen = new Set(all.map((ev) => `${ev.event}:${ev.outcome}`));
    for (const k of ["debris:pass", "debris:fail", "probe:win", "ghost:pass", "ghost:fail", "cloaked:win", "cloaked:loss", "storm:pass", "storm:fail"]) {
      expect(seen.has(k), k).toBe(true);
    }
  });

  it("every negative outcome is a pause; light hull damage comes only from debris and a lost battle (user Q12)", () => {
    for (const ev of all) {
      const negative = ev.outcome === "fail" || ev.outcome === "loss";
      expect((ev.pauseSeconds ?? 0) > 0).toBe(negative);
      const wears = (ev.event === "debris" && ev.outcome === "fail") || ev.outcome === "loss";
      expect((ev.hullWear ?? 0) > 0).toBe(wears);
      if (ev.event === "debris" && ev.outcome === "fail") expect(ev.pauseSeconds).toBe(DEBRIS_DELAY_SECONDS);
      if (ev.outcome === "win") expect(ev.findingId).toBeDefined();
    }
    for (const r of runs) {
      const wear = shipEvents(r.done).reduce((sum, ev) => sum + (ev.hullWear ?? 0), 0);
      expect(r.done.groundOps!.hullDamage ?? 0).toBe(wear);
    }
  });

  it("a won battle's salvage is a finding (never a relic); a ghost read true adds exactly ONE discovery to its body, last", () => {
    for (const r of runs) {
      for (const ev of shipEvents(r.done)) {
        if (ev.findingId) {
          const f = r.done.findings.find((x) => x.id === ev.findingId)!;
          expect(f.source).toBe("encounter");
          expect(f.relic).toBeNull();
        }
      }
      const plain = advanceExpedition(withoutShipEvents(r.exp), FAR);
      r.done.bodies.forEach((body, i) => {
        const bonus = shipEvents(r.done).filter((ev) => ev.bodyIndex === i && ev.bonusDiscovery).length;
        expect(body.discoveries.length).toBe(plain.bodies[i].discoveries.length + bonus);
        expect(body.discoveries.slice(0, plain.bodies[i].discoveries.length)).toEqual(plain.bodies[i].discoveries);
        expect(body.activities.length).toBe(body.discoveries.length);
        for (const task of body.activities) expect(task.status).toBeDefined(); // stamped as a task like the rest
      });
    }
    expect(all.some((ev) => ev.bonusDiscovery)).toBe(true);
  });

  it("the scan lasts its bodies' scan time plus every recorded pause plus every leg (the scan walk times them exactly)", () => {
    for (const r of runs) {
      const ops = r.done.groundOps!;
      const bodyTime = r.exp.bodies.reduce((sum, b) => sum + b.scanTotal / scanRatePerSecond(r.exp, b), 0);
      const paused = (r.done.scanEvents ?? []).reduce((sum, ev) => sum + (ev.pauseSeconds ?? 0), 0);
      const scanEnd = scanClockToTime(ops, bodyTime + paused);
      const legs = ops.shipLegs.filter((l) => l.scanBodyIndex !== null).reduce((sum, l) => sum + (l.endsAt - l.startsAt), 0);
      expect(scanEnd - ops.startedAt!).toBeCloseTo(bodyTime + paused + legs, 6);
      expect(advanceExpedition(r.exp, scanEnd - 1).bodies.some((b) => !b.scanned)).toBe(true);
      expect(advanceExpedition(r.exp, scanEnd + 1).bodies.every((b) => b.scanned)).toBe(true);
    }
  });

  it("the claim carries the light hull damage home: the ship is damaged and the Shipyard repairs it", () => {
    const r = runs.find((x) => (x.done.groundOps!.hullDamage ?? 0) > 0)!;
    let e = advanceExpedition(r.exp, 2_000_000);
    if (e.phase !== "complete") e = { ...e, phase: "complete" };
    const claimed = claimExpedition({ ...r.next, expeditions: [e] }, e.id);
    expect(claimed.success).toBe(true);
    const ship = claimed.next.ships.find((s) => s.id === "ship-1")!;
    expect(ship.damaged).toBe(true);
    expect(ship.repairDamage).toBe(Math.ceil(e.groundOps!.hullDamage!));
    expect(processShipRepairs(claimed.next).activeProcesses.some((p) => p.kind === "shipRepair")).toBe(true);
    // A run without damage (or one dispatched before GO-8) leaves the ship as it was.
    const calm = withoutShipEvents(r.exp);
    expect(applyShipEventDamage(r.next, calm)).toBe(r.next);
    // Damage adds to what the ship already carries.
    const hurt = { ...r.next, ships: r.next.ships.map((s) => ({ ...s, damaged: true, repairDamage: 10 })) };
    expect(applyShipEventDamage(hurt, e).ships[0].repairDamage).toBe(10 + Math.ceil(e.groundOps!.hullDamage!));
  });
});

describe("GO-8 the ship battles (probe and cloaked vessel)", () => {
  const { exp } = dispatch(PINNED[0]);
  const e = advanceExpedition(exp, windowOpen(exp) + 1);
  const hot = { ...e.bodies[0], hazard: 1 };
  const probeDraws = (step: number): ShipEventDraws => ({ ...shipEventDraws(e, 0, step), kind: SHIP_EVENT_WEIGHTS.debris }); // a probe

  it("is deterministic and never mutates its input", () => {
    const before = structuredClone(e);
    const a = resolveShipScanEventFromDraws(e, hot, 0, 3, 0, probeDraws(3));
    expect(a.event.event).toBe("probe");
    expect(resolveShipScanEventFromDraws(e, hot, 0, 3, 0, probeDraws(3))).toEqual(a);
    expect(e).toEqual(before);
  });

  it("the enemy grows with the hazard and Security Cunning SOFTENS it (exp.ambushSoften moved here, Task 21)", () => {
    const calm = shipEventEnemy(e, { ...hot, hazard: 0 }, 0, 1, CLOAKED_VESSEL_HULL);
    const harsh = shipEventEnemy(e, hot, 0, 1, CLOAKED_VESSEL_HULL);
    const soft = shipEventEnemy({ ...e, ambushSoften: 0.5 }, hot, 0, 1, CLOAKED_VESSEL_HULL);
    expect(calm.hullMax).toBe(CLOAKED_VESSEL_HULL.stats.hullIntegrity);
    expect(harsh.hullMax).toBe(2 * calm.hullMax);
    expect(soft.hullMax).toBe(calm.hullMax);
    expect(soft.shieldMax).toBe(calm.shieldMax);
    expect(soft.weapons.map((w) => w.yieldMax)).toEqual(calm.weapons.map((w) => w.yieldMax));
    expect(shipEventEnemy(e, hot, 0, 1, HOSTILE_PROBE_HULL).hullMax).toBeLessThan(harsh.hullMax);
    // Softer enemies, more wins: the cloaked vessel on a hazardous world over many boundaries.
    const wins = (x: Expedition) => {
      let n = 0;
      for (let step = 1; step <= 60; step++) {
        const d: ShipEventDraws = { ...shipEventDraws(x, 0, step), kind: SHIP_EVENT_WEIGHTS.debris + SHIP_EVENT_WEIGHTS.probe, cloaked: 0 };
        if (resolveShipScanEventFromDraws(x, hot, 0, step, 0, d).event.outcome === "win") n += 1;
      }
      return n;
    };
    expect(wins({ ...e, ambushSoften: 0.6 })).toBeGreaterThan(wins(e));
  });

  it("a lost battle pauses the scan while the ship repairs and leaves light hull damage; a damaged ship starts its fight hurt", () => {
    // An UNARMED ship (installed gear with no weapon) cannot win.
    const battle = { ...e.groundOps!.shipEventProfile.battle!, installedGear: [] };
    const unarmed: Expedition = { ...e, groundOps: { ...e.groundOps!, shipEventProfile: { ...e.groundOps!.shipEventProfile, battle } } };
    const r = resolveShipScanEventFromDraws(unarmed, hot, 0, 2, 0, probeDraws(2));
    expect(r.event).toMatchObject({ event: "probe", outcome: "loss", pauseSeconds: PROBE_REPAIR_SECONDS });
    expect(r.event.hullWear).toBe(Math.max(1, Math.round(PROBE_HULL_SHARE * battle.hullMax)));
    expect(r.finding).toBeNull();
  });
});

describe("GO-8 PARITY: one call == 997 s chunks == 1 s chunks over the scan", () => {
  for (const seed of PINNED) {
    it(`seed 0x${seed.toString(16)}`, { timeout: 180_000 }, () => {
      const { exp } = dispatch(seed);
      const frozen = structuredClone(exp);
      const open = windowOpen(exp);
      const scanned = advanceExpedition(exp, FAR);
      const ops = scanned.groundOps!;
      const bodyTime = exp.bodies.reduce((sum, b) => sum + b.scanTotal / scanRatePerSecond(exp, b), 0);
      const paused = (scanned.scanEvents ?? []).reduce((sum, ev) => sum + (ev.pauseSeconds ?? 0), 0);
      const END = Math.ceil(scanClockToTime(ops, bodyTime + paused)) + 5;
      expect(END).toBeGreaterThan(open);
      const big = advanceExpedition(exp, END);
      let chunked = exp;
      for (let t = 997; t < END; t += 997) chunked = advanceExpedition(chunked, t);
      chunked = advanceExpedition(chunked, END);
      expect(chunked).toEqual(big);
      let live = advanceExpedition(exp, open - 1);
      for (let t = open; t <= END; t += 1) live = advanceExpedition(live, t);
      expect(live).toEqual(big);
      expect(shipEvents(big).length).toBeGreaterThan(0);
      // The whole run, big == 997 s chunks.
      const whole = advanceExpedition(exp, FAR);
      let c2 = exp;
      for (let t = 997; t < FAR; t += 997) c2 = advanceExpedition(c2, t);
      expect(advanceExpedition(c2, FAR)).toEqual(whole);
      expect(exp).toEqual(frozen);
    });
  }
});
