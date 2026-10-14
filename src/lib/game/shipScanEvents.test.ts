// Ground Operations GO-8: the SHIP-SIDE SCAN EVENTS (shipScanEvents.ts) on a flagged run, replacing the scan-time
// ground battles (user 9b.6): the fixed draw layout, the gate (pre-GO-8 flagged runs and legacy runs keep their
// shape), each event's resolution and stakes (user Q12: light hull damage carried home), the ghost's bonus
// discovery, the pauses on the scan walk, and offline == live parity (one call == 997 s == 1 s over the scan).

import { describe, expect, it } from "vitest";
import { freshState, type AwayMember, type Expedition, type GameState } from "./model";
import {
  advanceExpedition,
  claimExpedition,
  expeditionCandidates,
  expeditionDispatchBlockText,
  expeditionLaunchView,
  expeditionShipRepairText,
  scanRatePerSecond,
  startExpedition,
} from "./expedition";
import { formatCountdown } from "./format";
import { scanClockToTime } from "./groundOps";
import { plainAwayMember, withSlottedAwayTeams, withoutGroundOps, withoutShipEvents } from "./awayTeamTestFixtures";
import { economyTick, processShipRepairs } from "./tick";
import {
  BOARDING_ATTEMPT_CHANCE,
  BOARDING_CREDIT_LOSS_SHARE,
  BOARDING_PAUSE_SECONDS,
  CLOAKED_REPAIR_SECONDS,
  CLOAKED_VESSEL_HULL,
  DEBRIS_DELAY_SECONDS,
  GHOST_CLOAKED_CHANCE,
  HOSTILE_PROBE_HULL,
  PROBE_HULL_SHARE,
  PROBE_REPAIR_SECONDS,
  SHIP_EVENT_DRAW_UNITS,
  SHIP_EVENT_WEIGHTS,
  chanceUnits,
  SHIP_EVENT_WEIGHT_TOTAL,
  applyShipEventDamage,
  boardingRepelChance,
  takeBoardingLoss,
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

  it("all five draws are always taken; the boarding draws (4, 5) never move draws 1 to 3 or what they decide", () => {
    const { exp } = dispatch(PINNED[0]);
    const e = advanceExpedition(exp, windowOpen(exp) + 1);
    const body = e.bodies[0];
    for (let step = 1; step <= 9; step++) {
      const d = shipEventDraws(e, 0, step);
      // GO-8 review: integer draws (combat/rng.ts integer-first).
      for (const v of [d.check, d.cloaked, d.boardingAttempt, d.boardingRepel]) expect(Number.isInteger(v) && v >= 0 && v < SHIP_EVENT_DRAW_UNITS).toBe(true);
      const stubbed: ShipEventDraws = { ...d, boardingAttempt: SHIP_EVENT_DRAW_UNITS - 1, boardingRepel: SHIP_EVENT_DRAW_UNITS - 1 };
      const a = resolveShipScanEventFromDraws(e, body, 0, step, 0, d);
      const b = resolveShipScanEventFromDraws(e, body, 0, step, 0, stubbed);
      // GO-9: a boarding the crew did not repel adds its pause on top; everything else is draws 1 to 3's.
      const boarded = a.event.boarding && !a.event.boarding.repelled ? BOARDING_PAUSE_SECONDS : 0;
      const pause = (a.event.pauseSeconds ?? 0) - boarded;
      expect({ ...b.event, boarding: undefined, pauseSeconds: b.event.pauseSeconds ?? 0 }).toEqual({ ...a.event, boarding: undefined, pauseSeconds: pause });
      expect(b.event.boarding).toBeUndefined();
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
      // GO-9: a boarding the crew did not repel is a negative outcome too.
      const negative = ev.outcome === "fail" || ev.outcome === "loss" || ev.boarding?.repelled === false;
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

describe("GO-9 boarding attempts (D26: crew.boardingDefense and the Ossir racial decide them)", () => {
  const { exp } = dispatch(PINNED[3]);
  const e = advanceExpedition(exp, windowOpen(exp) + 1);
  const hot = { ...e.bodies[0], hazard: 0.5 };
  const withDefense = (x: Expedition, boardingDefense: number): Expedition => ({
    ...x,
    groundOps: { ...x.groundOps!, shipEventProfile: { ...x.groundOps!.shipEventProfile, boardingDefense } },
  });

  it("the repel chance: half with no defense, rising with it on the D23 curve, never certain", () => {
    expect(boardingRepelChance(0)).toBe(0.5);
    expect(boardingRepelChance(0.1)).toBeGreaterThan(0.5);
    expect(boardingRepelChance(0.5)).toBeGreaterThan(boardingRepelChance(0.1));
    expect(boardingRepelChance(1e6)).toBeLessThan(1);
  });

  it("the dispatch freezes crew.boardingDefense: an Ossir officer aboard (the racial) raises it", () => {
    expect(exp.groundOps!.shipEventProfile.boardingDefense).toBe(0);
    const s = crewed(PINNED[3]);
    const none = { id: "test.none", magnitude: 0 };
    const ossir = {
      id: "officer-9",
      seat: "tactical",
      name: "Officer",
      race: "ossir",
      gender: "nonbinary",
      rank: "ensign",
      bonuses: [none, none],
      missionsCompleted: 0,
      assignedShipId: "ship-1",
    };
    const s2 = { ...s, officers: [ossir] } as unknown as GameState;
    const res = startExpedition(s2, "ship-1", 1, expeditionCandidates(s2, "ship-1")[0].id);
    expect(res.expedition!.groundOps!.shipEventProfile.boardingDefense).toBeGreaterThan(0);
  });

  it("only a probe or a cloaked vessel tries to board, on draw 4; more defense repels more often (seed sweep)", () => {
    let attempts = 0;
    const repels = [0, 0.25, 1].map((bd) => {
      let n = 0;
      for (let step = 1; step <= 99; step++) {
        for (const kind of [0, SHIP_EVENT_WEIGHTS.debris, SHIP_EVENT_WEIGHTS.debris + SHIP_EVENT_WEIGHTS.probe + SHIP_EVENT_WEIGHTS.ghost]) {
          const d = { ...shipEventDraws(e, 1, step), kind };
          const r = resolveShipScanEventFromDraws(withDefense(e, bd), hot, 1, step, 0, d).event;
          const boards = r.event === "probe" || r.event === "cloaked";
          expect(r.boarding !== undefined).toBe(boards && d.boardingAttempt < chanceUnits(BOARDING_ATTEMPT_CHANCE));
          if (r.boarding) {
            if (bd === 0) attempts += 1;
            if (r.boarding.repelled) n += 1;
          }
        }
      }
      return n;
    });
    expect(attempts).toBeGreaterThan(10);
    expect(repels[1]).toBeGreaterThan(repels[0]);
    expect(repels[2]).toBeGreaterThan(repels[1]);
  });

  it("not repelled: a scan pause plus a small credit loss from the run's findings, never below zero (user Q13)", () => {
    const d = { ...shipEventDraws(e, 0, 4), kind: SHIP_EVENT_WEIGHTS.debris, boardingAttempt: 0, boardingRepel: SHIP_EVENT_DRAW_UNITS - 1 };
    const rich: Expedition = {
      ...e,
      findings: [
        { id: "f1", source: "supplyCache", credits: 100 },
        { id: "f2", source: "supplyCache", credits: 7 },
      ],
    };
    const r = resolveShipScanEventFromDraws(rich, hot, 0, 4, 0, d);
    expect(r.event.boarding!.repelled).toBe(false);
    const base = r.event.outcome === "loss" ? (r.event.event === "cloaked" ? CLOAKED_REPAIR_SECONDS : PROBE_REPAIR_SECONDS) : 0;
    expect(r.event.pauseSeconds).toBe(base + BOARDING_PAUSE_SECONDS);
    expect(r.event.boarding!.creditsLost).toBe(Math.floor(BOARDING_CREDIT_LOSS_SHARE * (107 + (r.finding?.credits ?? 0))));
    // Repelled: recorded only.
    const held = resolveShipScanEventFromDraws(rich, hot, 0, 4, 0, { ...d, boardingRepel: 0 });
    expect(held.event.boarding).toEqual({ repelled: true });
    expect(held.event.pauseSeconds ?? 0).toBe(base);
    // The loss comes off the newest findings first, never below zero.
    const fs: { credits?: number }[] = [{ credits: 100 }, { credits: 7 }, {}, { credits: 3 }];
    takeBoardingLoss(fs, 12);
    expect(fs).toEqual([{ credits: 98 }, { credits: 0 }, {}, { credits: 0 }]);
    takeBoardingLoss(fs, 1000);
    expect(fs.every((f) => (f.credits ?? 0) === 0)).toBe(true);
  });

  it("on a real run the boarders' share leaves the run's findings; a strong defense keeps it", () => {
    const done = advanceExpedition(exp, FAR);
    const boarded = shipEvents(done).filter((ev) => ev.boarding);
    expect(boarded.some((ev) => ev.boarding!.repelled)).toBe(true);
    expect(boarded.some((ev) => !ev.boarding!.repelled && (ev.boarding!.creditsLost ?? 0) > 0)).toBe(true);
    const strong = advanceExpedition(withDefense(exp, 1e9), FAR);
    expect(shipEvents(strong).filter((ev) => ev.boarding).every((ev) => ev.boarding!.repelled)).toBe(true);
    const credits = (x: Expedition) => x.findings.reduce((sum, f) => sum + (f.credits ?? 0), 0);
    expect(credits(strong)).toBeGreaterThan(credits(done));
    for (const f of done.findings) expect(f.credits ?? 0).toBeGreaterThanOrEqual(0);
  });

  it("a run with no boarding attempt resolves identically whatever its frozen boarding defense", () => {
    const quiet = PINNED.map((seed) => dispatch(seed).exp).find((x) => !shipEvents(advanceExpedition(x, FAR)).some((ev) => ev.boarding))!;
    expect(quiet).toBeDefined();
    const a = advanceExpedition(quiet, FAR);
    const b = advanceExpedition(withDefense(quiet, 0.8), FAR);
    expect({ ...b, groundOps: { ...b.groundOps!, shipEventProfile: a.groundOps!.shipEventProfile } }).toEqual(a);
  });
});

describe("GO-8 review (user, 2026-10-14: \"Must be repaired first\", the patrol rule): a damaged ship cannot launch", () => {
  const base = crewed(PINNED[0]);
  const hurt: GameState = { ...base, ships: base.ships.map((s) => (s.id === "ship-1" ? { ...s, damaged: true, repairDamage: 120 } : s)) };
  const cand = (s: GameState) => expeditionCandidates(s, "ship-1")[0].id;

  it("damaged and waiting for a bay: refused with the SAME state, said plainly", () => {
    const res = startExpedition(hurt, "ship-1", 1, cand(hurt));
    expect(res).toMatchObject({ success: false, reason: "shipDamaged" });
    expect(res.next).toBe(hurt);
    expect(expeditionDispatchBlockText("shipDamaged")).toBe("Ship is damaged, repair it first");
    expect(expeditionShipRepairText(hurt, hurt.ships[0])).toBe("Damaged: waiting for a free Shipyard repair bay");
    expect(expeditionShipRepairText(base, base.ships[0])).toBeNull();
  });

  it("under Shipyard repair: refused, with the repair's own end time (\"Repairing: ready in 4m\")", () => {
    const repairing = processShipRepairs(hurt);
    const proc = repairing.activeProcesses.find((p) => p.kind === "shipRepair")!;
    expect(proc).toBeDefined();
    expect(startExpedition(repairing, "ship-1", 1, cand(repairing)).reason).toBe("shipDamaged");
    const secs = proc.remainingTicks * repairing.tickDurationSeconds;
    expect(expeditionShipRepairText(repairing, repairing.ships[0])).toBe(`Repairing: ready in ${formatCountdown(secs)}`);
    // A repair process alone (the flag already cleared by hand) still holds the ship.
    const flagOff = { ...repairing, ships: repairing.ships.map((s) => ({ ...s, damaged: undefined })) };
    expect(startExpedition(flagOff, "ship-1", 1, cand(flagOff)).reason).toBe("shipDamaged");
  });

  it("once repaired the ship launches again; the candidate list and the launch view still read while it waits", () => {
    let s = processShipRepairs(hurt);
    for (let i = 0; i < 5000 && (s.ships[0].damaged || s.activeProcesses.some((p) => p.kind === "shipRepair")); i++) s = economyTick(s, 1, () => 0.5);
    expect(s.ships[0].damaged).toBeUndefined();
    expect(startExpedition(s, "ship-1", 1, cand(s)).success).toBe(true);
    // Display paths on the blocked ship: no throw, a full candidate list, a launch view.
    const list = expeditionCandidates(hurt, "ship-1");
    expect(list.length).toBeGreaterThan(0);
    expect(() => expeditionLaunchView(hurt, "ship-1", list[0])).not.toThrow();
  });
});
