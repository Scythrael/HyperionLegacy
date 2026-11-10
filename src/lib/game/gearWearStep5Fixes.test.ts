// GEAR WEAR step 5 review fixes (docs/plans/2026-10-16-gear-wear-design.md, USER ANSWERS 2026-11-09: step 5 review):
//   C1: repair settles in exact integer arithmetic (whole-second anchors, an integer bank, the rate quantized), so one
//       call, 997 s chunks and 1 s steps store the SAME bytes at any game time, with no tolerance anywhere.
//   C2: a patrol's use wear is curved BEFORE it is carried (gearWear.ts useWearCarried), so a Repeat patrol settles where
//       wear and the underway upkeep balance instead of grinding to the 60% use floor.

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import { type EquipmentInstance, type GameState, type PatrolMissionState } from "./model";
import { dispatchCaptainOnPatrol, economyTick } from "./tick";
import {
  CONDITION_FULL,
  REPAIR_BANK_PER_MILLE,
  REPAIR_RATES,
  decodeRepairAnchor,
  repairRateQ,
  TOUGHNESS_REFERENCE,
  USE_CARRY_PER_MILLE,
  USE_WEAR_FLOOR,
  WEAR_SOURCES,
  pieceCondition,
  settlePiece,
  useWearCarried,
  withPieceCondition,
} from "./gearWear";
import { emptyWearEvents, rebaseAnchor, resolveGearWear } from "./gearWearEngine";
import { OVERTIME_CREDITS_PER_MINUTE, buyGearRepairOvertime, canBuyGearRepairOvertime, gearRepairJobMinutes, gearRepairOvertimeTier, shipGearMinutesToFull } from "./processSpeed";
import { aboutMinutes, gearOvertimePurchase, gearOvertimeStrip, pieceWearCard } from "../gearWearDisplay";
import { onHull } from "./firstRunsGoldens.fixture";
import { asPatrolVeteran } from "./awayTeamTestFixtures";
import { withBattleWearOff } from "./battleWearSwitch.fixture";
import { withPatrolUseWearOff } from "./patrolUseWearSwitch.fixture";

const RNG = () => 0.5;
const SHIP = "ship-1";
const ROUTE = "crimsonReaverSweep" as const;
const pieces = (s: GameState): EquipmentInstance[] => s.equipment.filter((e) => e.fittedToShipId === SHIP);

function veteranAt(t: number): GameState {
  return asPatrolVeteran({ ...onHull("destroyer"), gameTimeSeconds: t, nextPatrolSeed: 1, credits: new Decimal(10_000_000) });
}

function stepPiece(p: EquipmentInstance, from: number, to: number, step: number, rate: number): EquipmentInstance {
  let out = p;
  for (let t = from; t < to; ) {
    t = Math.min(to, t + step);
    out = settlePiece(out, t, rate);
  }
  return out;
}

describe("C1: exact settling at large game times", () => {
  const BIG = [3e6, 3e7, 1e8];
  const RATES = [50, 70, 100];

  it("settlePiece: one call == 997 s chunks == 1 s steps, byte-identical, at 3e6, 3e7 and 1e8 s, rates 50, 70 and 100", () => {
    const base: EquipmentInstance = { ...pieces(veteranAt(0))[0] };
    for (const t0 of BIG) {
      for (const rate of RATES) {
        const worn = withPieceCondition(base, 300, t0);
        // Through partway (a bank in flight) and through to full.
        for (const span of [137, 421, 1000, Math.ceil((700 * 60) / rate) + 5]) {
          const one = settlePiece(worn, t0 + span, rate);
          expect(stepPiece(worn, t0, t0 + span, 997, rate), `${t0} ${rate} ${span} chunks`).toEqual(one);
          expect(stepPiece(worn, t0, t0 + span, 1, rate), `${t0} ${rate} ${span} steps`).toEqual(one);
          // The anchor decodes exactly: a whole second and an integer bank below one second's worth of the rate.
          if (one.condition !== undefined) {
            const rq = repairRateQ(rate);
            const { at, bank } = decodeRepairAnchor(one.conditionAt!, rq);
            expect(Number.isInteger(at) && Number.isInteger(bank)).toBe(true);
            expect(bank).toBeLessThan(rq);
            expect(Math.abs(rq * (at - one.conditionAt!) - bank)).toBeLessThan(0.01);
          }
        }
        // Full arrives on the same second whatever the game time: ceil(700 x 60000 / rateQ) seconds.
        const need = Math.ceil((700 * REPAIR_BANK_PER_MILLE) / Math.round(rate * 1000));
        expect(settlePiece(worn, t0 + need - 1, rate).condition, `${t0} ${rate}`).toBeDefined();
        expect(settlePiece(worn, t0 + need, rate).condition, `${t0} ${rate}`).toBeUndefined();
      }
    }
  });

  it("a rebase keeps the banked fraction and re-encodes it at the new rate: exact across chunkings at a large game time", () => {
    const base: EquipmentInstance = { ...pieces(veteranAt(0))[0] };
    const t0 = 1e8;
    const worn = withPieceCondition(base, 500, t0);
    const underway = settlePiece(worn, t0 + 47, REPAIR_RATES.underway);
    const rebased = rebaseAnchor(underway, t0 + 47, REPAIR_RATES.underway, 70);
    // 47 s at 2 a minute: one per-mille at 30 s, 17 s banked = 17 x 2000 units, re-encoded at 70 a minute.
    expect(rebased.condition).toBe(501);
    expect(rebased.conditionAt).toBe(t0 + 47 - (17 * 2000) / 70_000);
    expect(decodeRepairAnchor(rebased.conditionAt!, 70_000)).toEqual({ at: t0 + 47, bank: 17 * 2000 });
    const one = settlePiece(rebased, t0 + 47 + 600, 70);
    expect(stepPiece(rebased, t0 + 47, t0 + 47 + 600, 1, 70)).toEqual(one);
    expect(stepPiece(rebased, t0 + 47, t0 + 47 + 600, 997, 70)).toEqual(one);
  });

  it("a drifted float anchor from a save written before C1 decodes deterministically and settles exactly from there", () => {
    const base: EquipmentInstance = { ...pieces(veteranAt(0))[0] };
    const legacy: EquipmentInstance = { ...base, condition: 400, conditionAt: 3e6 + 0.1234567 };
    const one = settlePiece(legacy, 3e6 + 600, 70);
    expect(stepPiece(legacy, 3e6, 3e6 + 600, 1, 70)).toEqual(one);
    expect(stepPiece(legacy, 3e6, 3e6 + 600, 997, 70)).toEqual(one);
  });

  it("where the old float arithmetic was exact (the free rates from whole-second anchors) the bytes are the same as before", () => {
    const base: EquipmentInstance = { ...pieces(veteranAt(0))[0] };
    for (const rate of [REPAIR_RATES.underway, REPAIR_RATES.home, REPAIR_RATES.shipyardBay]) {
      const worn = withPieceCondition(base, 500, 1000);
      // The pre-C1 rule: anchor + gained x 60 / rate, in 1 s steps.
      let anchor = 1000;
      let c = 500;
      let p = worn;
      for (let t = 1001; t <= 1300; t++) {
        const g = Math.min(CONDITION_FULL - c, Math.floor((rate * (t - anchor)) / 60));
        if (g > 0) {
          c += g;
          anchor += (g * 60) / rate;
        }
        p = settlePiece(p, t, rate);
        expect(p.condition ?? CONDITION_FULL, `${rate} ${t}`).toBe(c);
        if (p.conditionAt !== undefined) expect(p.conditionAt, `${rate} ${t}`).toBe(anchor);
      }
    }
  });

  // The tail pass itself (resolveGearWear, economyTick's gear step) on a docked ship with Overtime bought, at large game
  // times. The clock is advanced directly (a whole economyTick at 1e8 s spends its time in unrelated per-call work), so
  // this is exactly the settle every economyTick call runs at its tail.
  it("the tail pass with Overtime at 3e6, 3e7 and 1e8 s: one call == 997 s chunks == 1 s steps, byte-identical", () => {
    const advance = (s: GameState, to: number): GameState => resolveGearWear(s, { ...s, gameTimeSeconds: to }, emptyWearEvents());
    const run = (s: GameState, n: number, step: number): GameState => {
      let out = s;
      const end = s.gameTimeSeconds + n;
      while (out.gameTimeSeconds < end) out = advance(out, Math.min(end, out.gameTimeSeconds + step));
      return out;
    };
    for (const t0 of BIG) {
      for (let steps = 1; steps <= 3; steps++) {
        const s0 = veteranAt(t0);
        let bought: GameState = { ...s0, equipment: s0.equipment.map((e) => (e.fittedToShipId === SHIP ? withPieceCondition(e, 300, t0) : e)) };
        for (let i = 0; i < steps; i++) bought = buyGearRepairOvertime(bought, SHIP).next;
        expect(bought.ships[0].gearRepairSpeed?.overtimeSteps).toBe(steps);
        for (const N of [137, 600, 1100]) {
          const live = run(bought, N, 1);
          expect(pieces(run(bought, N, N)), `${t0} x${steps} ${N} one`).toEqual(pieces(live));
          expect(pieces(run(bought, N, 997)), `${t0} x${steps} ${N} chunks`).toEqual(pieces(live));
          expect(run(bought, N, N).ships, `${t0} x${steps} ${N} ships`).toEqual(live.ships);
        }
        // Full arrives together: 700 per-mille at the bought rate, the same second whatever the game time.
        const rq = repairRateQ(REPAIR_RATES.home * (1 + 0.25 * steps));
        const need = Math.ceil((700 * REPAIR_BANK_PER_MILLE) / rq);
        expect(pieces(run(bought, need - 1, need - 1)).some((p) => p.condition !== undefined)).toBe(true);
        expect(pieces(run(bought, need, need)).every((p) => p.condition === undefined)).toBe(true);
      }
    }
  });
});

describe("C2: a patrol's use wear is curved before it is carried", () => {
  it("useWearCarried: the curve acts on every event (no 'at least 1'), shrinks to nothing at the floor, carries the rest", () => {
    // A quarter-minute of reactor use (raw 1 a 15 s) at full on a reference piece: 1 per-mille, nothing carried.
    expect(useWearCarried(1, TOUGHNESS_REFERENCE, CONDITION_FULL, 0)).toEqual({ amount: 1, carry: 0 });
    // Halfway to the floor the same event is half a per-mille: carried, not rounded up to 1.
    expect(useWearCarried(1, TOUGHNESS_REFERENCE, 800, 0)).toEqual({ amount: 0, carry: USE_CARRY_PER_MILLE / 2 });
    expect(useWearCarried(1, TOUGHNESS_REFERENCE, 800, USE_CARRY_PER_MILLE / 2)).toEqual({ amount: 1, carry: 0 });
    // At the floor use takes nothing at all.
    expect(useWearCarried(50, TOUGHNESS_REFERENCE, USE_WEAR_FLOOR, 0).amount).toBe(0);
  });

  // A Repeat Sweep flown for `minutes` in 1 s ticks (battle wear off: use alone), each piece read at every cycle start
  // in the last hour.
  function repeatSweep(minutes: number): Map<string, number[]> {
    return withBattleWearOff(() => {
      const r = dispatchCaptainOnPatrol(veteranAt(0), 1, ROUTE, "balanced", true);
      expect(r.success).toBe(true);
      let st = r.next;
      const trace = new Map<string, number[]>();
      let seed = (st.captains[0].mission as PatrolMissionState).masterSeed;
      for (let t = 1; t <= minutes * 60; t++) {
        st = economyTick(st, 1, RNG);
        const m = st.captains[0].mission as PatrolMissionState | null;
        expect(m).not.toBeNull();
        if (m!.masterSeed !== seed) {
          seed = m!.masterSeed;
          if (t > (minutes - 60) * 60) for (const p of pieces(st)) trace.set(p.slotType, [...(trace.get(p.slotType) ?? []), pieceCondition(p)]);
        }
      }
      return trace;
    });
  }

  it("on use alone, a Repeat Sweep SETTLES where wear and upkeep balance (never grinds to the floor) and stays there", () => {
    // Before the fix the destroyer's reactor went 939, 880, ... 600 by 210 minutes. Now each piece approaches its balance
    // point (wear x (c - 600) / 400 = the underway upkeep) and holds: the reactor (toughness 120, 4 a minute at full)
    // at 600 + 400 x 2 / (4 x 100 / 120) = 840.
    const trace = repeatSweep(600);
    const reactor = WEAR_SOURCES.find((w) => w.id === "reactorCore:minutesRunning")!;
    const balance = USE_WEAR_FLOOR + ((CONDITION_FULL - USE_WEAR_FLOOR) * REPAIR_RATES.underway) / ((reactor.raw * TOUGHNESS_REFERENCE) / 120);
    expect(balance).toBe(840);
    const r = trace.get("reactorCore")!;
    expect(r.length).toBeGreaterThan(100);
    for (const c of r) expect(Math.abs(c - balance)).toBeLessThanOrEqual(4);
    // The drive settles too (its own balance point, by light-years), in the Sound band or better, flat in the last hour.
    const d = trace.get("ftlDrive")!;
    expect(Math.min(...d)).toBeGreaterThanOrEqual(800);
    expect(Math.max(...d) - Math.min(...d)).toBeLessThanOrEqual(4);
    // Use never touches the weapons or the defenses.
    for (const slot of ["weapon", "shieldEmitters", "hullPlating", "cargoBay"]) expect(Math.min(...trace.get(slot)!), slot).toBe(CONDITION_FULL);
  });

  it("parity: one economyTick call == 997 s chunks == 1 s steps on a long Repeat patrol (use and battle wear)", () => {
    const r = dispatchCaptainOnPatrol(veteranAt(0), 1, ROUTE, "balanced", true);
    const N = 4000;
    let steps = r.next;
    for (let i = 0; i < N; i++) steps = economyTick(steps, 1, RNG);
    let chunks = r.next;
    for (let left = N; left > 0; left -= Math.min(997, left)) chunks = economyTick(chunks, Math.min(997, left), RNG);
    const one = economyTick(r.next, N, RNG);
    expect(pieces(chunks)).toEqual(pieces(steps));
    expect(pieces(one)).toEqual(pieces(steps));
    expect(one.captains[0].mission).toEqual(steps.captains[0].mission);
  });

  it("the training cycle records no use wear and leaves no carry (W9, SF-7)", () => {
    const fresh = { ...onHull("destroyer"), nextPatrolSeed: 1, credits: new Decimal(100_000) };
    const r = dispatchCaptainOnPatrol(fresh, 1, ROUTE, "balanced", false);
    let s = r.next;
    for (let t = 0; t < 6000 && s.captains[0].mission !== null; t++) s = economyTick(s, 1, RNG);
    expect(pieces(s).filter((e) => e.condition !== undefined || e.useWearCarry !== undefined)).toEqual([]);
  });

  it("a patrol in flight from before step 5 (unstamped) records no use and carries nothing", () => {
    const r = withPatrolUseWearOff(() => dispatchCaptainOnPatrol(veteranAt(0), 1, ROUTE, "balanced", true));
    const s = withBattleWearOff(() => {
      let st = r.next;
      for (let t = 0; t < 600; t++) st = economyTick(st, 1, RNG);
      return st;
    });
    expect(pieces(s).filter((e) => e.condition !== undefined || e.useWearCarry !== undefined)).toEqual([]);
  });
});

describe("Overtime price: the repair job's FULL length, fixed when bought (user 2026-11-09 'Match the existing rule')", () => {
  function wornDockedAt(c: number): GameState {
    const s = veteranAt(0);
    return { ...s, equipment: s.equipment.map((e) => (e.fittedToShipId === SHIP ? withPieceCondition(e, c, s.gameTimeSeconds) : e)) };
  }

  it("the engine records the job's full length when it starts, and the price never falls as the job runs", () => {
    const s0 = wornDockedAt(700);
    const full = gearRepairJobMinutes(s0, SHIP);
    expect(full).toBeCloseTo(300 / REPAIR_RATES.home, 9);
    const q0 = canBuyGearRepairOvertime(s0, SHIP);
    let s = s0;
    for (let i = 0; i < 120; i++) s = economyTick(s, 1, RNG);
    // Two minutes in: the job is recorded at its start, so the same step costs the same.
    expect(s.ships[0].gearRepairJobMinutes).toBeCloseTo(full, 9);
    expect(shipGearMinutesToFull(s, SHIP, true)!).toBeLessThan(full);
    const q1 = canBuyGearRepairOvertime(s, SHIP);
    expect(q0.ok && q1.ok).toBe(true);
    if (q0.ok && q1.ok) {
      expect(q1.jobMinutes).toBe(q0.jobMinutes);
      expect(q1.cost).toBe(q0.cost);
      expect(q1.cost).toBe(Math.ceil(OVERTIME_CREDITS_PER_MINUTE * full * gearRepairOvertimeTier(s, SHIP) * 1));
    }
    // Fixed when bought: every later step prices the same job (step k = k x step 1's job size).
    const b = buyGearRepairOvertime(s, SHIP).next;
    expect(b.ships[0].gearRepairSpeed?.jobMinutes).toBeCloseTo(full, 9);
    const q2 = canBuyGearRepairOvertime(b, SHIP);
    if (q2.ok && q1.ok) expect(q2.cost).toBe(Math.ceil(OVERTIME_CREDITS_PER_MINUTE * full * gearRepairOvertimeTier(b, SHIP) * 2));
  });

  it("the job record ends with the job (gear full, or the ship leaves), and one call == chunks == 1 s steps", () => {
    const s0 = wornDockedAt(900);
    let live = s0;
    for (let i = 0; i < 400; i++) live = economyTick(live, 1, RNG);
    expect(live.ships[0].gearRepairJobMinutes).toBeUndefined();
    const one = economyTick(s0, 400, RNG);
    expect(one.ships).toEqual(live.ships);
    const mid = economyTick(s0, 30, RNG);
    let midSteps = s0;
    for (let i = 0; i < 30; i++) midSteps = economyTick(midSteps, 1, RNG);
    expect(mid.ships).toEqual(midSteps.ships);
    expect(mid.ships[0].gearRepairJobMinutes).toBeCloseTo(100 / REPAIR_RATES.home, 9);
    const out = dispatchCaptainOnPatrol(mid, 1, ROUTE, "balanced", false).next;
    expect(economyTick(out, 1, RNG).ships[0].gearRepairJobMinutes).toBeUndefined();
  });
});

describe("the gear card's Overtime strip (the approved 2026-11-09 mockup: per ship, one tap, gear card only)", () => {
  const wornDocked = (c: number): GameState => {
    const s = veteranAt(0);
    return { ...s, equipment: s.equipment.map((e) => (e.fittedToShipId === SHIP ? withPieceCondition(e, c, s.gameTimeSeconds) : e)) };
  };

  it("docked: the exact next-step cost and the new time to full, from the engine's quote", () => {
    const s = wornDocked(700);
    const piece = pieces(s)[0];
    const strip = gearOvertimeStrip(s, piece)!;
    const q = canBuyGearRepairOvertime(s, SHIP);
    expect(q.ok).toBe(true);
    if (!q.ok) return;
    expect(strip.state).toBe("buy");
    expect(strip.steps).toBe(0);
    expect(strip.maxSteps).toBe(3);
    expect(strip.cost).toBe(q.cost);
    expect(strip.button).toBe(`+25% · ${q.cost.toLocaleString("en-US")} cr`);
    expect(strip.when).toBe(`Speeds up all of ${strip.shipName}'s gear: full in ${aboutMinutes(q.minutesLeftAfter)} instead of ${aboutMinutes(q.minutesLeft)}.`);
    expect(pieceWearCard(s, piece).overtime).toEqual(strip);
    expect(pieceWearCard(s, piece).care).toBe(`Back to full in ${aboutMinutes(300 / REPAIR_RATES.home)} at home, on its own. Repair is always free.`);
  });

  it("one tap buys the step, logs it, and the strip moves on (1 of 3, then the maximum)", () => {
    let s = wornDocked(400);
    const before = s.credits;
    const q = canBuyGearRepairOvertime(s, SHIP);
    const r = gearOvertimePurchase(s, SHIP);
    expect(r.bought).toBe(true);
    if (!q.ok) throw new Error("quote");
    expect(before.minus(r.next.credits).toNumber()).toBe(q.cost);
    expect(r.log).toBe(`Overtime on ${gearOvertimeStrip(s, pieces(s)[0])!.shipName}'s gear repair: step 1 of 3 for ${q.cost.toLocaleString("en-US")} cr. All of its gear full in ${aboutMinutes(q.minutesLeftAfter)}.`);
    s = r.next;
    const one = gearOvertimeStrip(s, pieces(s)[0])!;
    expect(one.steps).toBe(1);
    expect(one.rateText).toBe("1.25x");
    expect(one.when?.startsWith("Next step: all of")).toBe(true);
    expect(pieceWearCard(s, pieces(s)[0]).care).toMatch(/at home, with Overtime\. Repair is always free\.$/);
    s = gearOvertimePurchase(gearOvertimePurchase(s, SHIP).next, SHIP).next;
    const max = gearOvertimeStrip(s, pieces(s)[0])!;
    expect(max.state).toBe("max");
    expect(max.rateText).toBe("1.75x");
    expect(max.button).toBeNull();
    const refused = gearOvertimePurchase(s, SHIP);
    expect(refused.bought).toBe(false);
    expect(refused.next).toBe(s);
    expect(refused.log).toBeNull();
  });

  it("out on a run: disabled with the reason; short of credits: the price and what is missing; pristine: hidden", () => {
    const out = dispatchCaptainOnPatrol(wornDocked(700), 1, ROUTE, "balanced", false).next;
    const off = gearOvertimeStrip(out, pieces(out)[0])!;
    expect(off.state).toBe("out");
    expect(off.button).toBe("Docked only");
    expect(off.note).toBe(`Overtime works only while ${off.shipName} is docked. It is out on a run; once home, its gear recovers fast on its own.`);
    expect(gearOvertimePurchase(out, SHIP).bought).toBe(false);
    const poor = { ...wornDocked(700), credits: new Decimal(10) };
    const short = gearOvertimeStrip(poor, pieces(poor)[0])!;
    expect(short.state).toBe("credits");
    expect(short.need).toBe((short.cost ?? 0) - 10);
    expect(short.button).toBe(`${(short.cost ?? 0).toLocaleString("en-US")} cr · need ${(short.need ?? 0).toLocaleString("en-US")} more`);
    expect(gearOvertimeStrip(veteranAt(0), pieces(veteranAt(0))[0])).toBeNull();
    expect(pieceWearCard(veteranAt(0), pieces(veteranAt(0))[0]).overtime).toBeNull();
  });
});
