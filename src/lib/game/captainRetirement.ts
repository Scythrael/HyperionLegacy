// Crew 0.14.0 (Phase C-3b): the captain RETIREMENT + XO SUCCESSION loop (pure over GameState).
//
// This is the PRESTIGE loop that FEEDS the C-3a secondary tree (captainSecondaryTree.ts): a captain
// who has climbed far enough can VOLUNTARILY retire, resetting their base progression in a full
// mini-prestige while KEEPING their secondary tree and gaining one more secondary point to spend in
// it. Retiring CONSUMES the ship's seated Executive officer (the XO), who succeeds the captain: the
// captaincy slot persists but takes on the XO's IDENTITY (name + race). Capped at 5 retirements, then
// the captaincy LOCKS IN (5 points fill exactly ONE secondary branch = one of 9 ultimate specs).
//
// MECHANICS (LOCKED, docs/plans/2026-09-22-crew-0.14.0-plan.md, "Captain RETIREMENT + succession
// (C-3b)"):
//   - VOLUNTARY + LEVEL-GATED + never forced; requires a seated Executive officer (the successor) and
//     an IDLE captain (first-pass safety: no retiring mid-mission) whose ship is not crew-locked (CP-6:
//     not on an expedition either, until it is claimed).
//   - XO SUCCESSION consumes the Executive officer (removed from state.officers, its seat emptied) and
//     transfers its identity (name + race) to the captain. The captain RACIAL-BONUS application is a
//     documented FOLLOW-ON (E-CAP captain-identity set); C-3b carries `race` as identity DATA only.
//   - FULL MINI-PRESTIGE reset of the captain: level 1, xp 0, statPoints to the level-1 baseline
//     (freshCaptainStack), base talent tree refunded (unlockedCaptainTalents [] + spec null). The
//     SECONDARY tree (unlockedSecondaryTalents) PERSISTS untouched and gains +1 secondaryPoint.
//   - ACCOUNT EXP: a stacking fleet-wide captain-XP multiplier = 1 + RETIREMENT_EXP_PER * (sum of every
//     captain's retirements). ADDITIVE-NEUTRAL at 0 total retirements (exactly 1), wired into captain XP
//     accrual in tick.ts.
//
// Every function is pure: it reads its inputs and returns fresh values, never mutating an input
// state/captain/officer/array in place (mirrors captainSecondaryTree.ts / seniorStaff.ts / armory.ts).

import Decimal from "break_infinity.js";
import type { GameState, CaptainState, SeniorStaffOfficer } from "./model";
import { freshCaptainStack } from "./model";
import { fireOfficer } from "./seniorStaff";
// CP-6: the one crew lock (a leaf module, no cycle).
import { shipCrewLocked } from "./crewLock";

// The level a captain must REACH before they may retire. FIRST-PASS + TUNABLE (a captain climbs the
// base tree meaningfully before the prestige is worthwhile).
export const RETIRE_LEVEL_GATE = 25;

// The hard cap on how many times one captaincy may retire. LOCKED: 5 retirements grant 5 secondary
// points, which fill exactly ONE of the secondary tree's 9 branches (one ultimate spec). After the
// 5th the captaincy LOCKS IN (canRetireCaptain returns false).
export const MAX_CAPTAIN_RETIREMENTS = 5;

// The fleet-wide captain-XP bonus each retirement (across ALL captains) contributes to the account EXP
// multiplier. FIRST-PASS + TUNABLE (~+5% per retirement).
export const RETIREMENT_EXP_PER = 0.05;

// The seated EXECUTIVE officer (the XO) aboard the captain's ship, or undefined when the captain has no
// ship or no seated Executive. Pure read: it resolves the captain's ship via the single-source-of-truth
// ShipInstance.assignedCaptainId, then finds the Executive officer sitting that hull.
export function seatedExecutiveOfficerFor(
  state: GameState,
  captainId: number,
): SeniorStaffOfficer | undefined {
  const ship = state.ships.find((s) => s.assignedCaptainId === captainId);
  if (!ship) return undefined;
  return state.officers.find((o) => o.seat === "executive" && o.assignedShipId === ship.id);
}

// Why `captainId` may NOT retire right now, or null when it may. Guards in order: the captain exists
// (noCaptain); is at or above the level gate (belowLevel); is under the retirement cap (lockedIn); is IDLE
// (notIdle, mission === null); its ship is not crew-locked (shipOnExpedition, CP-6: an expedition in flight
// or complete but unclaimed, the one lock in crewLock.ts; a captain mission already reported notIdle, so an
// expedition is the only lock left by then); and a seated Executive officer is aboard (noSuccessor). The
// run's stats are frozen at dispatch, but the user rule is "can't change mid-mission", and retiring would
// consume an XO who is out on the run. Pure.
export type RetireBlockReason = "noCaptain" | "belowLevel" | "lockedIn" | "notIdle" | "shipOnExpedition" | "noSuccessor";

export function retireBlockReason(state: GameState, captainId: number): RetireBlockReason | null {
  const captain = state.captains.find((c) => c.id === captainId);
  if (!captain) return "noCaptain";
  if (captain.level < RETIRE_LEVEL_GATE) return "belowLevel"; // level gate
  if ((captain.retirements ?? 0) >= MAX_CAPTAIN_RETIREMENTS) return "lockedIn"; // capped: locked in
  if (captain.mission !== null) return "notIdle"; // idle-only (no retiring mid-mission)
  const ship = state.ships.find((s) => s.assignedCaptainId === captainId);
  if (ship && shipCrewLocked(state, ship.id)) return "shipOnExpedition";
  return seatedExecutiveOfficerFor(state, captainId) !== undefined ? null : "noSuccessor"; // needs a seated XO
}

// The player-facing line for a refusal (US English), `level` being the captain's current level. EXHAUSTIVE
// with no default on purpose. Pure.
export function retireBlockText(reason: RetireBlockReason, level: number): string {
  switch (reason) {
    case "noCaptain":
      return "No such captain.";
    case "belowLevel":
      return `Reach level ${RETIRE_LEVEL_GATE} to retire (currently level ${level}).`;
    case "lockedIn":
      return "This captaincy is locked in: no retirements remain.";
    case "notIdle":
      return "Recall this captain first, retirement needs an idle captain.";
    case "shipOnExpedition":
      return "This captain's ship is on an expedition: claim it first.";
    case "noSuccessor":
      return "Seat an Executive officer (XO) aboard this captain's ship to succeed them.";
  }
}

// Whether `captainId` may retire RIGHT NOW (retireBlockReason is null). Pure.
export function canRetireCaptain(state: GameState, captainId: number): boolean {
  return retireBlockReason(state, captainId) === null;
}

// Retire `captainId`: the full mini-prestige + XO succession, atomically. Returns a NEW GameState; the
// input is never mutated. A same-reference NO-OP when the retirement is illegal (canRetireCaptain false),
// so callers can always treat the result as the current state. Pure.
export function retireCaptain(state: GameState, captainId: number): GameState {
  if (!canRetireCaptain(state, captainId)) return state; // same-ref no-op
  // Non-null by the guards above (canRetireCaptain confirmed both exist).
  const captain = state.captains.find((c) => c.id === captainId) as CaptainState;
  const xo = seatedExecutiveOfficerFor(state, captainId) as SeniorStaffOfficer;

  const baseline = freshCaptainStack(); // the level-1 statPoints baseline a fresh captain starts with

  const retired: CaptainState = {
    ...captain,
    // FULL MINI-PRESTIGE reset of the base progression.
    level: 1,
    xp: new Decimal(0),
    statPoints: baseline.statPoints,
    unlockedCaptainTalents: [], // base talent tree refunded
    spec: null, // specialization cleared
    // GRANTS: one more retirement toward the cap, one more secondary point to spend.
    retirements: (captain.retirements ?? 0) + 1,
    secondaryPoints: (captain.secondaryPoints ?? 0) + 1,
    // The SECONDARY tree PERSISTS untouched (a fresh cloned array so the input is never shared).
    unlockedSecondaryTalents: [...captain.unlockedSecondaryTalents],
    // XO SUCCESSION: the captaincy takes on the Executive officer's IDENTITY. `race` is identity DATA
    // only today (the captain RACIAL-BONUS application is a documented FOLLOW-ON, E-CAP set).
    label: xo.name,
    race: xo.race,
  };

  // CONSUME the XO through the existing officer-removal path (fireOfficer), then swap in the retired
  // captain. fireOfficer only touches state.officers, so its returned captains array is the SAME
  // reference we map over here; the Executive seat is thereby emptied.
  const withoutXo = fireOfficer(state, xo.id);
  return {
    ...withoutXo,
    captains: withoutXo.captains.map((c) => (c.id === captainId ? retired : c)),
  };
}

// The fleet-wide captain-XP multiplier from accumulated retirements: 1 + RETIREMENT_EXP_PER * (sum of
// every captain's retirements). ADDITIVE-NEUTRAL: with every captain at 0 retirements (every existing
// save) the sum is 0 and this is EXACTLY 1, so multiplying captain XP by it is byte-identical to not
// multiplying at all. Pure read.
export function retirementExpMultiplier(state: GameState): number {
  const totalRetirements = state.captains.reduce((sum, c) => sum + (c.retirements ?? 0), 0);
  return 1 + RETIREMENT_EXP_PER * totalRetirements;
}
