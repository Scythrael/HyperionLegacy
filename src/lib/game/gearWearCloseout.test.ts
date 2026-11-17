// GEAR WEAR close-out fix pass (docs/plans/2026-10-16-gear-wear-design.md, "Close-out review (2026-11-11) and USER
// ANSWERS"), through the real engine:
//   1. a Repeat patrol paused to repair reads as home and repairing on every gear screen, and its bar is live through
//      the pause and never jumps when it closes;
//   2. "Allow Overtime in pauses": one tap speeds the pause like any docked repair, priced by the pause's whole length;
//      the countdown is rescaled so the patrol heads out on the tick its combat gear is full; offline == live;
//   3. "Keep the bay rate": gear keeps the Shipyard bay rate until full after the hull leaves, so hull Overtime never
//      makes "Gear full in" longer (the review's 14.7 and 19.1 min, re-measured);
//   4. "Make it exact": leftover underway seconds at a window's edge are credited at the rate that applied, in the exact
//      integer bank;
//   5. "Yes, it's combat wear": the Damage Control Suite's patrol fires are named combat wear (registry, Help);
//   6. the Help lines and the reactor catalog text.

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import { type EquipmentInstance, type GameState, type PatrolMissionState } from "./model";
import { dispatchCaptainOnPatrol, economyTick, processShipRepairs, recallCaptain, shipRepairDurationTicks } from "./tick";
import { CONDITION_FULL, REPAIR_BANK_PER_MILLE, REPAIR_RATES, WEAR_EFFICIENCY, decodeRepairAnchor, pieceCondition, repairRateQ, secondsToFull, withPieceCondition } from "./gearWear";
import { REPAIR_PAUSE_SLOTS, livePieceCondition, pauseRepairWindows, scheduledWalker, settleScheduled } from "./gearWearEngine";
import { OVERTIME_CREDITS_PER_MINUTE, buyOvertime, canBuyGearRepairOvertime, gearRepairJobMinutes, gearRepairOvertimeTier } from "./processSpeed";
import { aboutMinutes, fleetCare, gearOvertimePurchase, gearOvertimeStrip, pieceCareText, shipGearSummary } from "../gearWearDisplay";
import { buildHomeDashboard } from "./homeDashboard";
import { GEAR_WEAR_PARAGRAPHS } from "../helpTopics";
import { WIRING_REGISTRY } from "./wiring/registry";
import { onHull } from "./firstRunsGoldens.fixture";
import { asPatrolVeteran } from "./awayTeamTestFixtures";
import { withCloseoutOff } from "./gearWearCloseoutSwitch.fixture";
import { withEnemyTorpedoesOff } from "./enemyTorpedoSwitch.fixture";
import { fixRoundESwitchesOffForThisFile } from "./fixRoundESwitch.fixture";
import { fixRoundAnswersOffForThisFile } from "./fixRoundAnswersSwitch.fixture";

// Fix round FR-E (0.14.0): Resume when safe (lane 4 I1, PATROL_RESUME_WHEN_SAFE_SWITCH: a Repeat repair pause ends once
// the next route is safe, not at full) moves sections 1, 2 and 2b (the pause to full: its 1,471 s repro, the live bar
// to full, Overtime's exact resume tick and the mid-bank reference; the same promises on the pause the game now makes:
// patrolFixRoundE.test.ts "I1 with Overtime"); and the pause's docked pricing (lane 4 M6, PAUSE_JOB_LIKE_DOCKED_SWITCH:
// a repair pause records the docked job's length for its Overtime) moves section 2's price (the pause's whole length;
// the docked price: patrolFixRoundE.test.ts M6). The pins here predate the round and are about another slice, so the
// file runs with those fixes off (fixRoundESwitch.fixture.ts); every other fix of the round runs here. The round's own
// pins: patrolFixRoundE.test.ts.
fixRoundESwitchesOffForThisFile("resumeWhenSafe", "pauseJobLikeDocked");
// Fix round answers Q6 (2026-11-17, "Price the actual pause": a pause's Overtime is priced by the repair the pause has
// left) moves section 2's price the same way; its pin (the pause's whole length) is the code before, so it is off here
// too (fixRoundAnswersSwitch.fixture.ts). The answer's own pins: pauseOvertimePrice.test.ts.
fixRoundAnswersOffForThisFile("pauseOvertimeRemaining");

const RNG = () => 0.5;
const SHIP = "ship-1";
const COMBAT = ["weapon", "reactorCore", "ftlDrive", "shieldEmitters", "hullPlating", "droneBay"];

function stepped(s: GameState, n: number): GameState {
  let out = s;
  for (let i = 0; i < n; i++) out = economyTick(out, 1, RNG);
  return out;
}

const pieces = (s: GameState): EquipmentInstance[] => s.equipment.filter((e) => e.fittedToShipId === SHIP);
const combat = (s: GameState): EquipmentInstance[] => pieces(s).filter((e) => REPAIR_PAUSE_SLOTS.has(e.slotType));
const patrolOf = (s: GameState): PatrolMissionState | null => s.captains[0].mission as PatrolMissionState | null;
const veteran = (): GameState => asPatrolVeteran({ ...onHull("destroyer"), nextPatrolSeed: 1, credits: new Decimal(10_000_000) });
const wornAt = (s: GameState, slots: readonly string[] | null, c: number): GameState => ({
  ...s,
  equipment: s.equipment.map((e) => (e.fittedToShipId === SHIP && (slots === null || slots.includes(e.slotType)) ? withPieceCondition(e, c, s.gameTimeSeconds) : e)),
});

// The review's repro: a destroyer whose combat gear is at 2%, dispatched on Repeat Sweep ("Repair first, then go").
function pausedAt2(): GameState {
  const r = dispatchCaptainOnPatrol(wornAt(veteran(), COMBAT, 20), 1, "crimsonReaverSweep", "balanced", true);
  expect(r.success, r.reason).toBe(true);
  expect(patrolOf(r.next)!.repairPause?.first).toBe(true);
  return r.next;
}

describe("1. a paused patrol's gear reads home and repairing, live, and never jumps", () => {
  it("the review's repro: 300 s into a 1,471 s pause the bar reads the home rate's 22%, not the underway 3%", () => {
    const s0 = pausedAt2();
    expect(patrolOf(s0)!.repairPause!.ticksRemaining).toBe(1471);
    const s = stepped(s0, 300);
    for (const p of combat(s)) expect(livePieceCondition(s, p), p.slotType).toBe(20 + Math.floor((REPAIR_RATES.home * 300) / 60));
  });

  it("through the whole pause the live bar climbs at the home rate and the stored value it closes on is no jump", () => {
    let s = pausedAt2();
    let prev = combat(s).map((p) => livePieceCondition(s, p));
    while (patrolOf(s)!.repairPause !== undefined) {
      s = economyTick(s, 1, RNG);
      const now = combat(s).map((p) => livePieceCondition(s, p));
      // At most one per-mille a second at the home rate (40 a minute), never down, never a leap.
      now.forEach((c, i) => {
        expect(c - prev[i]).toBeGreaterThanOrEqual(0);
        expect(c - prev[i]).toBeLessThanOrEqual(1);
      });
      prev = now;
    }
    // It closed with every combat piece full, which the live bar already read.
    expect(prev.every((c) => c === CONDITION_FULL)).toBe(true);
  });

  it("a mid-run pause (underway wear before it): the live read just before it closes is the stored value after, per piece", () => {
    withEnemyTorpedoesOff(() => {
      let s = dispatchCaptainOnPatrol(veteran(), 1, "crimsonReaverSweep", "balanced", true).next;
      let guard = 0;
      while (patrolOf(s) !== null && patrolOf(s)!.repairPause === undefined && guard++ < 40_000) s = economyTick(s, 1, RNG);
      expect(patrolOf(s)?.repairPause).toBeDefined();
      let before = s;
      while (patrolOf(s)!.repairPause !== undefined) {
        before = s;
        s = economyTick(s, 1, RNG);
      }
      for (const p of pieces(before)) {
        const after = s.equipment.find((e) => e.id === p.id)!;
        const live = livePieceCondition(before, p);
        expect(pieceCondition(after) - live, p.slotType).toBeGreaterThanOrEqual(0);
        expect(pieceCondition(after) - live, p.slotType).toBeLessThanOrEqual(1);
      }
    });
  });

  it("the four display paths say Repairing at home (the card, the Overtime strip, the chip, Fleet care); the Home row too", () => {
    const s = stepped(pausedAt2(), 300);
    const weapon = combat(s).find((p) => p.slotType === "weapon")!;
    const minutes = (CONDITION_FULL - 220) / REPAIR_RATES.home;
    expect(pieceCareText(s, weapon)).toBe(`Repairing at home while its patrol pauses: back to full in ${aboutMinutes(minutes)}, on its own. Repair is always free.`);
    const strip = gearOvertimeStrip(s, weapon)!;
    expect(strip.state).toBe("buy");
    expect(strip.button).not.toBe("Docked only");
    // (Fix round FR-E lane 4 I1: the patrol heads out once its gear is safe for the next route, not always at full.)
    expect(strip.when).toMatch(/^Speeds up the repair pause: .* back on patrol in about \d+ min instead of about \d+ min\.$/);
    const chip = shipGearSummary(s, SHIP);
    expect(chip.recovery).toMatch(/^Repairing at home, full in about \d+ min$/);
    expect(chip.context).toBe("home");
    const care = fleetCare(s)!;
    expect(care.rows.find((r) => r.shipId === SHIP)!.status).toMatch(/^Repairing at home while its patrol pauses, back out in about \d+ min$/);
    expect(care.summary).toContain("1 ship recovering.");
    expect(care.summary).not.toContain("out on patrol");
    expect(buildHomeDashboard(s).inProgress.find((x) => x.kind === "patrol")!.secondaryLabel).toBe("Repairing gear at home");
  });

  it("recall during a pause: the run ends at once and the bar does not jump; docked, it carries on at the home rate", () => {
    const s = stepped(pausedAt2(), 300);
    const weapon = combat(s).find((p) => p.slotType === "weapon")!;
    const live = livePieceCondition(s, weapon);
    const r = recallCaptain(s, 1, 1234);
    expect(r.next.captains[0].mission).toBeNull();
    const w = (st: GameState) => livePieceCondition(st, st.equipment.find((e) => e.id === weapon.id)!);
    expect(w(r.next)).toBe(live);
    expect(w(stepped(r.next, 60))).toBe(live + REPAIR_RATES.home);
  });
});

describe("2. Overtime during a repair pause (user 2026-11-11 'Allow Overtime in pauses')", () => {
  it("one tap: priced by the pause's whole length, the countdown rescaled, the log shows both times", () => {
    const s0 = stepped(pausedAt2(), 300);
    const pause = patrolOf(s0)!.repairPause!;
    const fullMinutes = (300 + pause.ticksRemaining) / 60;
    expect(gearRepairJobMinutes(s0, SHIP)).toBeCloseTo(fullMinutes, 9);
    // The same whenever in the pause it is bought.
    const later = stepped(s0, 200);
    expect(gearRepairJobMinutes(later, SHIP)).toBeCloseTo(fullMinutes, 9);
    const q = canBuyGearRepairOvertime(s0, SHIP);
    expect(q.ok).toBe(true);
    if (!q.ok) return;
    expect(q.cost).toBe(Math.ceil(OVERTIME_CREDITS_PER_MINUTE * fullMinutes * gearRepairOvertimeTier(s0, SHIP) * 1));
    expect(q.minutesLeft).toBe(pause.ticksRemaining / 60);
    expect(q.minutesLeftAfter).toBeLessThan(q.minutesLeft);
    const r = gearOvertimePurchase(s0, SHIP);
    expect(r.bought).toBe(true);
    const name = gearOvertimeStrip(s0, combat(s0)[0])!.shipName;
    expect(r.log).toBe(
      `Overtime on ${name}'s repair pause: step 1 of 3 for ${q.cost.toLocaleString("en-US")} cr. The patrol heads back out in ${aboutMinutes(q.minutesLeftAfter)} instead of ${aboutMinutes(q.minutesLeft)}.`,
    );
    expect(s0.credits.minus(r.next.credits).toNumber()).toBe(q.cost);
    const after = patrolOf(r.next)!.repairPause!;
    expect(after.ticksRemaining).toBe(q.minutesLeftAfter * 60);
    expect(after.overtime).toEqual([{ at: s0.gameTimeSeconds, steps: 1 }]);
    expect(r.next.ships[0].gearRepairSpeed).toEqual({ overtimeSteps: 1, jobMinutes: q.jobMinutes });
    // The card says so.
    expect(pieceCareText(r.next, combat(r.next)[0])).toMatch(/with Overtime\. Repair is always free\.$/);
  });

  it("the patrol heads out on the tick its combat gear is full: full then, not a tick before; steps 1 to 3", () => {
    for (let steps = 1; steps <= 3; steps++) {
      let s = stepped(pausedAt2(), 300);
      for (let i = 0; i < steps; i++) s = gearOvertimePurchase(s, SHIP).next;
      expect(s.ships[0].gearRepairSpeed?.overtimeSteps).toBe(steps);
      let before = s;
      while (patrolOf(s)!.repairPause !== undefined) {
        before = s;
        s = economyTick(s, 1, RNG);
      }
      // One tick before the close a combat piece was still short of full; the relaunched cycle opens with none worn.
      expect(combat(before).some((p) => livePieceCondition(before, p) < CONDITION_FULL), `x${steps}`).toBe(true);
      const opened = patrolOf(s)!.cycleStartCondition ?? {};
      expect(combat(s).filter((p) => opened[p.id] !== undefined), `x${steps}`).toEqual([]);
      // The record clears as the patrol heads out.
      expect(s.ships[0].gearRepairSpeed, `x${steps}`).toBeUndefined();
    }
  });

  it("it is sooner: the pause with 3 steps ends earlier than the free one, and the pieces match the closed form", () => {
    const base = stepped(pausedAt2(), 300);
    const free = patrolOf(base)!.repairPause!.ticksRemaining;
    let s = base;
    for (let i = 0; i < 3; i++) s = gearOvertimePurchase(s, SHIP).next;
    const fast = patrolOf(s)!.repairPause!.ticksRemaining;
    // 780 per-mille left at 40 x 1.75 = 70 a minute: ceil(780 x 60000 / 70000) seconds.
    expect(fast).toBe(Math.ceil((780 * REPAIR_BANK_PER_MILLE) / repairRateQ(REPAIR_RATES.home * 1.75)));
    expect(fast).toBeLessThan(free);
  });

  it("offline == live after the purchase: one call == 997 s chunks == 1 s steps, through the close and on", () => {
    let s = stepped(pausedAt2(), 300);
    s = gearOvertimePurchase(gearOvertimePurchase(s, SHIP).next, SHIP).next;
    const n = 1994;
    const one = economyTick(s, n, RNG);
    const chunks = economyTick(economyTick(s, 997, RNG), 997, RNG);
    const steps = stepped(s, n);
    for (const [name, x] of [["one", one], ["chunks", chunks]] as const) {
      expect(JSON.stringify(x.equipment), name).toBe(JSON.stringify(steps.equipment));
      expect(JSON.stringify(x.captains), name).toBe(JSON.stringify(steps.captains));
      expect(JSON.stringify(x.ships), name).toBe(JSON.stringify(steps.ships));
    }
  });

  it("a docked ship's Overtime carries into its first pause (it never left home): the pause is that much shorter", () => {
    const worn = wornAt(veteran(), COMBAT, 20);
    const bought = gearOvertimePurchase(worn, SHIP).next;
    expect(bought.ships[0].gearRepairSpeed?.overtimeSteps).toBe(1);
    const plain = patrolOf(dispatchCaptainOnPatrol(worn, 1, "crimsonReaverSweep", "balanced", true).next)!.repairPause!;
    const r = dispatchCaptainOnPatrol(bought, 1, "crimsonReaverSweep", "balanced", true).next;
    const pause = patrolOf(r)!.repairPause!;
    expect(pause.overtime).toEqual([{ at: bought.gameTimeSeconds, steps: 1 }]);
    expect(pause.ticksRemaining).toBeLessThan(plain.ticksRemaining);
    // Kept through the pause, gone once it heads out.
    expect(economyTick(r, 1, RNG).ships[0].gearRepairSpeed?.overtimeSteps).toBe(1);
  });
});

// Review 2026-11-11 (Critical): a purchase splits the pause into back-to-back windows; the second window must be entered
// with its own rate even though it starts on the very second the first ends. Checked against a HAND-BUILT exact reference
// (not the walk against itself), at purchase seconds where the bank is NOT zero, and at a mid-second large game time.
describe("2b. Overtime bought mid-bank: the live bar and the resume tick against a hand-built exact reference", () => {
  const Q_HOME = repairRateQ(REPAIR_RATES.home); // 40,000 bank units a second; one per-mille is 60,000
  // A combat piece at 20, anchored (bank 0) at the pause's start t0, with Overtime steps bought at [instant, steps].
  function reference(t0: number, buys: readonly [number, number][], t: number): number {
    let units = 0;
    let from = t0;
    let q = Q_HOME;
    for (const [at, steps] of buys) {
      if (t <= at) break;
      units += q * (at - from);
      from = at;
      q = repairRateQ(REPAIR_RATES.home * (1 + 0.25 * steps));
    }
    units += q * Math.max(0, t - from);
    return Math.min(CONDITION_FULL, 20 + Math.floor(units / REPAIR_BANK_PER_MILLE));
  }
  function pausedFrom(t0: number): GameState {
    const base = { ...veteran(), gameTimeSeconds: t0 };
    const r = dispatchCaptainOnPatrol(wornAt(base, COMBAT, 20), 1, "crimsonReaverSweep", "balanced", true);
    expect(r.success, r.reason).toBe(true);
    expect(patrolOf(r.next)!.repairPause?.from).toBe(t0);
    return r.next;
  }
  // Buy at each offset (seconds after t0, steps in order), then step 1 s: every second the live bar of every combat piece
  // is the reference; the pause closes on exactly the second the reference reaches full (not a tick before or after).
  // `coarse` (a large game time, where one economyTick call costs far more): the spans before the buy and up to 3 s
  // before the close run as one call each (one call == 1 s steps, proved above), the last seconds in 1 s steps.
  function check(t0: number, offsets: readonly number[], coarse = false): void {
    let s = pausedFrom(t0);
    const buys: [number, number][] = [];
    for (const off of offsets) {
      const n = off - (s.gameTimeSeconds - t0);
      s = coarse ? economyTick(s, n, RNG) : stepped(s, n);
      const live = combat(s).map((p) => livePieceCondition(s, p));
      for (const c of live) expect(c, `${t0}+${off} before the buy`).toBe(reference(t0, buys, s.gameTimeSeconds));
      const r = gearOvertimePurchase(s, SHIP);
      expect(r.bought, `${t0}+${off}`).toBe(true);
      s = r.next;
      buys.push([s.gameTimeSeconds, buys.length + 1]);
      // The bar does not move at the purchase.
      for (const p of combat(s)) expect(livePieceCondition(s, p), `${t0}+${off} at the buy`).toBe(reference(t0, buys, s.gameTimeSeconds));
    }
    let fullAt = s.gameTimeSeconds;
    while (reference(t0, buys, fullAt) < CONDITION_FULL) fullAt += 1;
    if (coarse && fullAt - 3 > s.gameTimeSeconds) {
      s = economyTick(s, fullAt - 3 - s.gameTimeSeconds, RNG);
      expect(patrolOf(s)!.repairPause).toBeDefined();
      for (const p of combat(s)) expect(livePieceCondition(s, p), `${t0} ${offsets} at ${s.gameTimeSeconds}`).toBe(reference(t0, buys, s.gameTimeSeconds));
    }
    while (patrolOf(s)!.repairPause !== undefined) {
      s = economyTick(s, 1, RNG);
      if (patrolOf(s)!.repairPause !== undefined) {
        for (const p of combat(s)) expect(livePieceCondition(s, p), `${t0} ${offsets} at ${s.gameTimeSeconds}`).toBe(reference(t0, buys, s.gameTimeSeconds));
      }
    }
    // Relaunch tick == the tick the combat gear is full.
    expect(s.gameTimeSeconds, `${t0} ${offsets} resumes`).toBe(fullAt);
    expect(reference(t0, buys, fullAt - 1)).toBeLessThan(CONDITION_FULL);
    const opened = patrolOf(s)!.cycleStartCondition ?? {};
    expect(combat(s).filter((p) => opened[p.id] !== undefined), `${t0} ${offsets}`).toEqual([]);
  }

  it("bought at 301 s and at 302 s (a bank in flight), one step", () => {
    check(0, [301]);
    check(0, [302]);
  });

  it("two steps at banked seconds (301 s, then 517 s)", () => {
    check(0, [301, 517]);
  });

  it("a mid-second purchase at a large game time (3e6 + 0.5 s, bought 301 s in)", () => {
    check(3e6 + 0.5, [301], true);
  });
});

describe("3. Keep the bay rate (user 2026-11-11): hull Overtime never makes the gear slower", () => {
  // The review's repro: a destroyer with a 620-tick hull repair, every installed piece at 0.
  function inBay620(hullOvertime: number): GameState {
    const base = veteran();
    const ship = base.ships.find((x) => x.id === SHIP)!;
    let damage = 1;
    while (shipRepairDurationTicks({ ...ship, repairDamage: damage }, pieces(base)) < 620) damage += 1;
    expect(shipRepairDurationTicks({ ...ship, repairDamage: damage }, pieces(base))).toBe(620);
    let s = processShipRepairs(wornAt({ ...base, ships: base.ships.map((x) => (x.id === SHIP ? { ...x, damaged: true, repairDamage: damage } : x)) }, null, 0));
    const repair = s.activeProcesses.find((p) => p.kind === "shipRepair")!;
    expect(repair.durationTicks).toBe(620);
    for (let i = 0; i < hullOvertime; i++) s = buyOvertime(s, { kind: "process", id: repair.id }).next;
    return s;
  }
  // Seconds until every installed piece is full, in 1 s steps; and the Fleet care "Gear full in" minutes at the start.
  function gearFull(s0: GameState): { seconds: number; saidMinutes: number | null } {
    let s = s0;
    let t = 0;
    while (pieces(s).some((p) => p.condition !== undefined) && t < 5000) {
      s = economyTick(s, 1, RNG);
      t += 1;
    }
    return { seconds: t, saidMinutes: shipGearSummary(s0, SHIP).minutesToFull };
  }

  it("re-measured: 14.7 min and 19.1 min before (3 hull Overtime steps made it LATER); 12.5 min both now, as the card says", () => {
    const before0 = withCloseoutOff(() => gearFull(inBay620(0)));
    const before3 = withCloseoutOff(() => gearFull(inBay620(3)));
    expect((before0.seconds / 60).toFixed(1)).toBe("14.7");
    expect((before3.seconds / 60).toFixed(1)).toBe("19.1");
    const now0 = gearFull(inBay620(0));
    const now3 = gearFull(inBay620(3));
    expect(now0.seconds).toBe(Math.ceil((1000 * REPAIR_BANK_PER_MILLE) / repairRateQ(REPAIR_RATES.shipyardBay)));
    expect(now0.seconds / 60).toBe(12.5);
    expect(now3.seconds).toBe(now0.seconds);
    expect(now3.seconds / 60).toBeLessThanOrEqual(14.7);
    // Truthful: the card and Fleet care say the time it really takes.
    expect(now0.saidMinutes).toBe(12.5);
    expect(now3.saidMinutes).toBe(12.5);
    expect(fleetCare(inBay620(3))!.rows[0].status).toContain(`Gear full in ${aboutMinutes(12.5)}`);
  });

  it("the kept rate ends with the gear (full, or the ship leaves); one call == chunks == 1 s steps", () => {
    const s0 = inBay620(3);
    const n = 800;
    const steps = stepped(s0, n);
    expect(steps.ships[0].gearBayRate).toBeUndefined();
    const mid = stepped(s0, 500);
    expect(mid.ships[0].gearBayRate).toBe(1);
    expect(economyTick(s0, 500, RNG).ships).toEqual(mid.ships);
    expect(economyTick(s0, 500, RNG).equipment).toEqual(mid.equipment);
    const chunks = economyTick(economyTick(s0, 400, RNG), 400, RNG);
    expect(chunks.equipment).toEqual(steps.equipment);
    const out = dispatchCaptainOnPatrol(mid, 1, "crimsonReaverSweep", "balanced", false).next;
    expect(economyTick(out, 1, RNG).ships[0].gearBayRate).toBeUndefined();
  });
});

describe("4. Make it exact (user 2026-11-11): each second at the rate that applied, in the integer bank", () => {
  const base = (): EquipmentInstance => ({ ...pieces(veteran())[0] });

  it("entering a home window 22 s after the anchor: 22 s underway, then the window, never 22 s at the home rate", () => {
    const p = withPieceCondition(base(), 650, 0);
    const exact = settleScheduled(p, 128, REPAIR_RATES.underway, [{ from: 22, to: 128 }], REPAIR_RATES.home);
    // 22 x 2000 + 106 x 40000 = 4,284,000 units: 71 per-mille and 24,000 units banked.
    expect(pieceCondition(exact)).toBe(721);
    const legacy = withCloseoutOff(() => settleScheduled(p, 128, REPAIR_RATES.underway, [{ from: 22, to: 128 }], REPAIR_RATES.home));
    expect(pieceCondition(legacy)).toBe(735); // the old credit: the whole 128 s at the home rate
    // Left at the window's end, the 24,000 units banked are re-expressed at the underway rate (exact integers): the
    // anchor sits 24,000 / 2,000 = 12 s before the edge, a whole second with nothing banked.
    expect(exact.conditionAt).toBe(128 - 24_000 / repairRateQ(REPAIR_RATES.underway));
    expect(decodeRepairAnchor(exact.conditionAt!, repairRateQ(REPAIR_RATES.underway))).toEqual({ at: 116, bank: 0 });
  });

  it("the walk is the same in one step or event by event, and in chunks, through windows and Overtime parts", () => {
    const p = withPieceCondition(base(), 300, 1000);
    const windows = pauseRepairWindows({ from: 1037, overtime: [{ at: 1300, steps: 1 }, { at: 1450, steps: 3 }] }, 1800);
    expect(windows).toEqual([{ from: 1037, to: 1300 }, { from: 1300, to: 1450, overtime: 1.25 }, { from: 1450, to: 1800, overtime: 1.75 }]);
    const one = settleScheduled(p, 2100, REPAIR_RATES.underway, windows, REPAIR_RATES.home);
    for (const step of [1, 7, 97, 333]) {
      const walk = scheduledWalker(REPAIR_RATES.underway, windows, REPAIR_RATES.home);
      let x = p;
      for (let t = 1000; t < 2100; ) {
        t = Math.min(2100, t + step);
        x = walk(x, t);
      }
      expect(x, `step ${step}`).toEqual(one);
    }
    // Member gear never takes a pause's Overtime.
    expect(pieceCondition(settleScheduled(p, 1800, REPAIR_RATES.underway, windows, REPAIR_RATES.home, false))).toBeLessThan(pieceCondition(settleScheduled(p, 1800, REPAIR_RATES.underway, windows, REPAIR_RATES.home)));
  });

  it("secondsToFull counts in the settle's own integers: full lands on exactly that second", () => {
    const p = withPieceCondition(base(), 780, 500);
    const secs = secondsToFull(p, 500, REPAIR_RATES.home * 1.75);
    expect(secs).toBe(Math.ceil((220 * REPAIR_BANK_PER_MILLE) / repairRateQ(70)));
    expect(settleScheduled(p, 500 + secs - 1, 70, undefined, 70).condition).toBeDefined();
    expect(settleScheduled(p, 500 + secs, 70, undefined, 70).condition).toBeUndefined();
  });
});

describe("5 and 6. the words (registry, Help, catalog)", () => {
  it("the Damage Control Suite's patrol fires are named combat wear (user 2026-11-11 'Yes, it's combat wear')", () => {
    const row = WIRING_REGISTRY.find((e) => e.id === "wear:WEAR_SOURCES:specUtility:effectFires")!;
    expect(row.claim).toContain("counts as combat wear");
    expect(GEAR_WEAR_PARAGRAPHS.join(" ")).toContain("Damage Control Suite");
    expect(GEAR_WEAR_PARAGRAPHS.join(" ")).toMatch(/counts as combat wear/);
  });

  it("Help: repair itself is always free (Overtime is paid); universal modules by time underway; Fleet care lists patrols and waiting hulls; Overtime in a pause", () => {
    const help = GEAR_WEAR_PARAGRAPHS.join(" ");
    expect(help).not.toContain("never costs anything");
    expect(help).toContain("Repair itself is always free");
    expect(help).toContain("universal modules by time underway");
    expect(help).toContain("out on patrol");
    expect(help).toContain("waiting for a free Shipyard bay");
    expect(help).toContain("repair pause");
    expect(help.includes(String.fromCharCode(0x2014)) || help.includes("-".repeat(2))).toBe(false);
  });

  it("the reactor's catalog row never claims wear cuts its power output (user 'Stays full')", () => {
    const row = WEAR_EFFICIENCY.find((c) => c.id === "reactorCore:powerOutput")!;
    expect(row.reads).toContain("stays full");
    expect(row.reads).not.toMatch(/power output where something consumes it/);
  });
});
