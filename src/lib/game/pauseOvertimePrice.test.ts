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
