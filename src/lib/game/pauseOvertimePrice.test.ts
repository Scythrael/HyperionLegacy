// ============================================================================
// Fix round answers Q6 (user 2026-11-17, "Price the actual pause"): Overtime bought during a Repeat patrol's repair
// pause is priced by what is actually left of that pause's repair (the time from now until every piece it waits on
// reaches its goal at the normal home rate), on the same curve a docked job of that length is priced on
// (gearRepairOvertimeStepCost), fixed at the first step like docked. The strip's button, its price and the charge agree.
// ============================================================================
import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import { type GameState, type PatrolMissionState } from "./model";
import { dispatchCaptainOnPatrol, economyTick, recallCaptain } from "./tick";
import { withPieceCondition } from "./gearWear";
import { pauseSecondsToTarget } from "./gearWearEngine";
import { buyGearRepairOvertime, canBuyGearRepairOvertime, gearRepairOvertimeStepCost } from "./processSpeed";
import { gearOvertimePurchase, gearOvertimeStrip } from "../gearWearDisplay";
import { onHull } from "./firstRunsGoldens.fixture";
import { asPatrolVeteran } from "./awayTeamTestFixtures";
import { withAnswersOff } from "./fixRoundAnswersSwitch.fixture";
import { HELP_TOPICS } from "../helpTopics";

const RNG = () => 0.5;
const SHIP = "ship-1";
const COMBAT = ["weapon", "reactorCore", "ftlDrive", "shieldEmitters", "hullPlating", "droneBay"];
const patrolOf = (s: GameState): PatrolMissionState | null => s.captains[0].mission as PatrolMissionState | null;
const veteran = (): GameState => asPatrolVeteran({ ...onHull("destroyer"), nextPatrolSeed: 1, credits: new Decimal(10_000_000) });
const wornAt = (s: GameState, c: number): GameState => ({
  ...s,
  equipment: s.equipment.map((e) => (e.fittedToShipId === SHIP && COMBAT.includes(e.slotType) ? withPieceCondition(e, c, s.gameTimeSeconds) : e)),
});
function stepped(s: GameState, n: number): GameState {
  let out = s;
  for (let i = 0; i < n; i++) out = economyTick(out, 1, RNG);
  return out;
}

// A Repeat Sweep paused short of full repair ("Resume when safe": the pause has a target).
function pausedShort(): GameState {
  for (const c of [20, 100, 200, 300, 400, 500, 600, 700]) {
    const r = dispatchCaptainOnPatrol(wornAt(veteran(), c), 1, "crimsonReaverSweep", "balanced", true);
    if (patrolOf(r.next)?.repairPause?.target !== undefined) return r.next;
  }
  throw new Error("no fixture pause short of full repair");
}

describe("Q6: a repair pause's Overtime is priced by the repair the pause has left", () => {
  it("the step's job is the pause's remaining time to its goals at the normal rate, on the docked curve", () => {
    const s = stepped(pausedShort(), 30);
    const q = canBuyGearRepairOvertime(s, SHIP);
    expect(q.ok).toBe(true);
    if (!q.ok) return;
    const left = pauseSecondsToTarget(s, SHIP, 0)! / 60;
    expect(q.jobMinutes).toBeCloseTo(left, 9);
    expect(q.cost).toBe(gearRepairOvertimeStepCost(s, SHIP, left, 1));
    // The pause's remaining time agrees with its countdown (within the countdown's whole-tick rounding and the one
    // settle margin tick a pause is planned with).
    expect(Math.abs(q.minutesLeft - left) * 60).toBeLessThanOrEqual(2 * s.tickDurationSeconds);
  });

  it("it is far cheaper than the docked job for the same gear (what it cost before)", () => {
    const s = stepped(pausedShort(), 30);
    const now = canBuyGearRepairOvertime(s, SHIP);
    const before = withAnswersOff(["pauseOvertimeRemaining"], () => canBuyGearRepairOvertime(s, SHIP));
    const docked = canBuyGearRepairOvertime(recallCaptain(s, 1).next, SHIP);
    expect(now.ok && before.ok && docked.ok).toBe(true);
    if (!now.ok || !before.ok || !docked.ok) return;
    expect(now.cost).toBeLessThan(before.cost);
    expect(now.jobMinutes).toBeLessThan(docked.jobMinutes);
  });

  it("the strip's button shows the price that is charged, and later steps price the same job", () => {
    const s = stepped(pausedShort(), 30);
    const piece = s.equipment.find((e) => e.fittedToShipId === SHIP && e.slotType === "weapon")!;
    const strip = gearOvertimeStrip(s, piece)!;
    const q = canBuyGearRepairOvertime(s, SHIP);
    expect(q.ok).toBe(true);
    if (!q.ok) return;
    expect(strip.cost).toBe(q.cost);
    expect(strip.button).toContain(`${q.cost.toLocaleString("en-US")} cr`);
    const bought = gearOvertimePurchase(s, SHIP);
    expect(bought.bought).toBe(true);
    expect(s.credits.minus(bought.next.credits).toNumber()).toBe(q.cost);
    expect(bought.log).toContain(`${q.cost.toLocaleString("en-US")} cr`);
    // Step 2 is priced on the job fixed at step 1 (as docked), twice the step-1 price.
    const q2 = canBuyGearRepairOvertime(bought.next, SHIP);
    if (q2.ok) {
      expect(q2.jobMinutes).toBe(q.jobMinutes);
      expect(q2.cost).toBe(gearRepairOvertimeStepCost(s, SHIP, q.jobMinutes, 2));
    }
    expect(buyGearRepairOvertime(s, SHIP).cost).toBe(q.cost);
  });

  it("the Gear wear Help states the rule", () => {
    const body = HELP_TOPICS.map((t) => t.body).join("\n");
    expect(body).toContain("In a pause the steps are priced by the repair the pause has left, the time until the patrol would head back out at the normal rate, set when you buy the first step, not by the whole repair job.");
  });
});

// Fix pass (review SHOULD-FIX): the pause price lives and ends with the pause. Before, a recall carried the pause's cheap
// frozen price (ShipInstance.gearRepairSpeed.jobMinutes) into the docked repair: its next docked step cost the pause
// price, not the docked job's.
describe("Q6 fix pass: the pause price applies only while paused", () => {
  // The review's case: a destroyer's first ("repair first") pause on a Repeat Sweep, its combat gear at 20.
  const firstPause = (): GameState => dispatchCaptainOnPatrol(wornAt(veteran(), 20), 1, "crimsonReaverSweep", "balanced", true).next;
  const buy = (s: GameState): GameState => {
    const r = buyGearRepairOvertime(s, SHIP);
    expect(r.bought).toBe(true);
    return r.next;
  };

  it("recall after pause steps: the Overtime ends with the pause, the docked job is priced by its own length", () => {
    const s0 = firstPause();
    const q1 = canBuyGearRepairOvertime(s0, SHIP);
    expect(q1).toMatchObject({ ok: true, step: 1, cost: 53, jobMinutes: 2.625 });
    const s1 = buy(s0);
    expect(canBuyGearRepairOvertime(s1, SHIP)).toMatchObject({ ok: true, step: 2, cost: 105, jobMinutes: 2.625 });
    const s2 = buy(s1);
    expect(patrolOf(s2)?.repairPause?.overtimeJobMinutes).toBe(2.625);
    const docked = recallCaptain(s2, 1).next;
    expect(docked.ships[0].gearRepairSpeed).toBeUndefined();
    // Step 1 again, on the docked job (24.5 min at the normal rate): 490 cr, as on the same gear never paused.
    const free = recallCaptain(s0, 1).next;
    expect(canBuyGearRepairOvertime(docked, SHIP)).toMatchObject({ ok: true, step: 1, cost: 490, jobMinutes: 24.5 });
    expect(canBuyGearRepairOvertime(docked, SHIP)).toEqual(canBuyGearRepairOvertime(free, SHIP));
    // Still so once the engine records the docked job, and the gear repairs at the normal rate (as the free recall's).
    const later = stepped(docked, 3);
    expect(later.ships[0].gearRepairJobMinutes).toBe(24.5);
    expect(canBuyGearRepairOvertime(later, SHIP)).toMatchObject({ ok: true, step: 1, cost: 490, jobMinutes: 24.5 });
    expect(stepped(docked, 120).equipment).toEqual(stepped(free, 120).equipment);
    // With Q6 off (the docked price in the pause, FR-E), the recall carries the Overtime on as before: step 3, 1,470 cr.
    withAnswersOff(["pauseOvertimeRemaining"], () => {
      const old = recallCaptain(buy(buy(firstPause())), 1).next;
      expect(old.ships[0].gearRepairSpeed).toEqual({ overtimeSteps: 2, jobMinutes: 24.5 });
      expect(canBuyGearRepairOvertime(old, SHIP)).toMatchObject({ ok: true, step: 3, cost: 1470 });
    });
  });

  it("a step bought in a pause's last ticks (1 cr on what is left) never prices the docked repair after a recall", () => {
    let s = firstPause();
    while ((patrolOf(s)?.repairPause?.ticksRemaining ?? 0) > 3) s = stepped(s, 1);
    expect(canBuyGearRepairOvertime(s, SHIP)).toMatchObject({ ok: true, step: 1, cost: 1, jobMinutes: 0.025 });
    const bought = buy(s);
    expect(canBuyGearRepairOvertime(bought, SHIP)).toMatchObject({ ok: true, step: 2, cost: 1 });
    const docked = recallCaptain(bought, 1).next;
    expect(docked.ships[0].gearRepairSpeed).toBeUndefined();
    expect(canBuyGearRepairOvertime(docked, SHIP)).toMatchObject({ ok: true, step: 1, cost: 438, jobMinutes: 21.9 });
  });

  it("Overtime bought DOCKED that carries into a pause keeps its docked price there, and stays on after a recall", () => {
    const worn = wornAt(veteran(), 20);
    const dockedQuote = canBuyGearRepairOvertime(worn, SHIP);
    expect(dockedQuote).toMatchObject({ ok: true, step: 1, jobMinutes: 24.5, cost: 490 });
    const carried = dispatchCaptainOnPatrol(buy(worn), 1, "crimsonReaverSweep", "balanced", true).next;
    expect(patrolOf(carried)?.repairPause?.overtime).toEqual([{ at: 0, steps: 1 }]);
    // In the pause: step 2 on the docked job (980 cr), not on what the pause has left (user 2026-11-17, "Leave it").
    expect(canBuyGearRepairOvertime(carried, SHIP)).toMatchObject({ ok: true, step: 2, cost: 980, jobMinutes: 24.5 });
    const two = buy(carried);
    expect(patrolOf(two)?.repairPause?.overtimeJobMinutes).toBeUndefined();
    const docked = recallCaptain(two, 1).next;
    expect(docked.ships[0].gearRepairSpeed).toEqual({ overtimeSteps: 2, jobMinutes: 24.5 });
    expect(canBuyGearRepairOvertime(docked, SHIP)).toMatchObject({ ok: true, step: 3, cost: 1470 });
  });

  it("offline == live after the recall: one call == 997 s chunks == 1 s steps", () => {
    const docked = recallCaptain(buy(buy(firstPause())), 1).next;
    const one = economyTick(docked, 2000, RNG);
    let chunks = docked;
    for (let t = 0; t < 2000; t += 997) chunks = economyTick(chunks, Math.min(997, 2000 - t), RNG);
    const steps = stepped(docked, 2000);
    expect(chunks.equipment).toEqual(one.equipment);
    expect(steps.equipment).toEqual(one.equipment);
    expect(steps.ships).toEqual(one.ships);
  });

  it("the Gear wear Help says the pause's Overtime ends with it, and docked Overtime carried in keeps its price", () => {
    const body = HELP_TOPICS.map((t) => t.body).join("\n");
    expect(body).toContain("Overtime bought in a pause ends with the pause, also when you recall the patrol: the ship's repair at home is then a new job, priced by its own length. Overtime bought on a docked ship before its patrol repairs first keeps that docked price in the pause, and stays on if you recall the patrol.");
  });
});
