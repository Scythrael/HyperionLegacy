// E5-4 (Refugee Posts, design docs/plans/2026-11-02-refugee-posts-e5-design.md, plan
// docs/plans/2026-11-02-refugee-posts-e5-plan.md Task E5-4): what a posted refugee does for the facility they work at.
//
// What the user decided (design section 2 and MOCKUP APPROVED):
// - A refugee whose background MATCHES the facility gives a strong buff; at any other facility a small one
//   (REFUGEE_OFF_MATCH_RATIO of it).
// - Several refugees at one facility stack on the D23 diminishing curve (diminishing.ts), never a hard cap.
// - Moving is free, any time (refugees.ts postRefugee / unpostRefugee); nothing here costs or times anything.
// - The Refiner gives each finished refine batch a chance of extra output, and the Stargazer raises the expedition
//   discovery odds (the user's E5-0 calls: "Extra output", then "Discovery odds now", which supersedes "Rare-aspect
//   spotting" until rare aspects exist; plan USER ANSWERS).
//
// The buff b of a facility is DERIVED on read (refugeeFacilityBonus), never stored: b = diminishing(sum of shares,
// REFUGEE_STACK_KNEE), where a refugee's share is skill x REFUGEE_MATCH_SHARE_PER_SKILL, times REFUGEE_OFF_MATCH_RATIO
// off match. b = 0 with nobody posted, and every consumer then takes its old code path bit for bit (each fold below is
// guarded on b > 0), so a save without refugees, and every old save, is byte-identical.
//
// WHEN a buff applies (determinism): postings change only through the player's actions, between ticks; nothing on the
// tick posts or unposts anyone (an arrival joins the waiting list, a farewell leaves from it). So within one economyTick
// call every b is constant, and one call == chunked == 1 s steps by construction. Each consumer then reads b at the
// moment its own facility stat is already read today:
//   refinery          the extra-output roll, decided when the refine job STARTS and stamped on it (the Works
//                     Directorate precedent, tick.ts startProcess bonusOutput), on its own keyed stream;
//   fuelStorage       fleet reach, a live read (tick.ts fleetReachBonus);
//   missionControl    each phase of a short-range cycle plan, frozen at the cycle START (shortRangeBoard.ts);
//   research          research and relic study durations, decided at the START (tick.ts);
//   fabricator        fabricate durations, decided at the START (tick.ts);
//   shipyard          the build speed, decided at the START (tick.ts shipBuildSpeedMult);
//   salvageBay        the recovery fraction, a live read (salvage.ts salvageYieldMult, as the museum's);
//   subspaceTelescope the discovery odds, frozen on the expedition at DISPATCH (expedition.ts shipSensorSnapshot).
// A run or job in flight is never re-timed by a posting; the next one reads the new value.
//
// Every number here is a [PROPOSAL] (the user's to change) in one named constant.

import { makeRng } from "./combat/rng";
import { diminishing } from "./diminishing";
import type { GameState } from "./model";
import type { ShortRangeCyclePlan } from "./shortRange";
import { REFUGEE_STACK_KNEE, postRefugee, refugeeShare, refugeesOf, type RefugeeFacilityKey } from "./refugees";

// The share numbers live with the record (refugees.ts, so the posting action's swap can read a share without an import
// cycle); re-exported here, the buffs' own module.
export { REFUGEE_MATCH_SHARE_PER_SKILL, REFUGEE_OFF_MATCH_RATIO, REFUGEE_STACK_KNEE, refugeeShare } from "./refugees";

// The Refiner's extra-output roll: its own keyed stream's salt (never a shared stream).
export const REFUGEE_REFINE_SALT = 0x2e5f4e1d;
// The roll's resolution: chances compared in ten-thousandths (one integer draw), as Works Directorate's.
const REFINE_ROLL_DENOMINATOR = 10_000;

// TEST-ONLY off switch (refugeeBuffsSwitch.fixture.ts): with `live` false every facility buff reads 0, the game before
// E5-4 exactly, so a golden can trace what the buffs moved. Production never writes it.
export const REFUGEE_BUFFS_SWITCH: { live: boolean } = { live: true };

// The buff the people posted at `facility` give it: diminishing(sum of their shares, REFUGEE_STACK_KNEE) (D23: strictly
// increasing as posts fill, unbounded, never a cap). 0 with nobody posted. Pure.
export function refugeeFacilityBonus(state: Pick<GameState, "refugees">, facility: RefugeeFacilityKey): number {
  if (!REFUGEE_BUFFS_SWITCH.live || state.refugees === undefined) return 0;
  let sum = 0;
  for (const r of refugeesOf(state).list) if (r.posting === facility) sum += refugeeShare(r, facility);
  return sum > 0 ? diminishing(sum, REFUGEE_STACK_KNEE) : 0;
}

// For the picker (E5-5): the facility's total if `refugeeId` were posted there now (a full facility swaps, as
// postRefugee does: `replaceId` is the person the player picked to replace, else the lowest share is the fallback),
// and the gain over today's total. A post that would fail (an invalid `replaceId` included) gains 0. Pure.
export function refugeeBonusIfPosted(
  state: GameState,
  refugeeId: number,
  facility: RefugeeFacilityKey,
  replaceId?: number,
): { gain: number; total: number } {
  const now = refugeeFacilityBonus(state, facility);
  const r = postRefugee(state, refugeeId, facility, replaceId);
  if (!r.success) return { gain: 0, total: now };
  const total = refugeeFacilityBonus(r.next, facility);
  return { gain: total - now, total };
}

// ===== the consumer folds (each the identity at b = 0) =====

// A speed bonus `speed` (a duration divides by 1 + speed) with the refugee buff multiplied in: (1 + speed) x (1 + b) - 1
// (the "Always multiply" convention relicStudyDurationFor uses). `speed` itself, untouched, at b <= 0. Pure.
export function withRefugeeSpeed(speed: number, b: number): number {
  return b > 0 ? (1 + Math.max(0, speed)) * (1 + b) - 1 : speed;
}

// ===== carried fractions (the user's 2026-11-03 call "Carry the fractions") =====
//
// A whole-tick duration shortened by a small buff used to round back up (ceil(60 / 1.01) = 60): the buff never acted.
// Now each consumer keeps the fraction it rounded up by, the CARRY c in [0, 1), and the next duration it decides pays
// it back: ticks = max(1, ceil(ideal - c)), new c = ticks - (ideal - c). Over a run of jobs the summed ticks track the
// summed ideal durations within one tick, so even a small buff always acts over time. The first duration (c = 0) is
// ceil(ideal), exactly the old value. A consumer folds its carry only while its buff is live (b > 0); at b = 0 it
// takes its old path and its carry is neither read nor written, so a save without refugees is byte-identical.
// Where each carry lives (absent = 0; RefugeeState.carry or the run):
//   missionControl  ShortRangeMissionState.refugeeCarry, per run (each run's cycles start in its own time order);
//   research        RefugeeState.carry.research (blueprint research starts);
//   relicStudy      RefugeeState.carry.relicStudy (relic study starts, the player's and the queue's);
//   fabricator      RefugeeState.carry.fabricator (line jobs and one-off crafts).
// Every start that consumes a carry happens at a whole-tick boundary (tick() steps economyTick(_, 1)) or as a player
// action, in a fixed order, so one call == 997 s chunks == 1 s steps and offline == live hold by construction.

// A stored carry as the engine reads it: a finite number in [0, 1), else 0. Pure.
export function cleanRefugeeCarry(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 && v < 1 ? v : 0;
}

// `ideal` ticks (a positive real) as a whole-tick duration with the carried fraction `carry` paid back: the ticks and
// the new carry (see the header above). Pure.
export function carriedTicks(ideal: number, carry: number): { ticks: number; carry: number } {
  const c = cleanRefugeeCarry(carry);
  const d = ideal - c;
  // Nothing left to round up (an ideal under the carry): the 1-tick floor, the carry kept as it was.
  if (!(d > 0)) return { ticks: 1, carry: c };
  const ticks = Math.max(1, Math.ceil(d));
  return { ticks, carry: cleanRefugeeCarry(ticks - d) };
}

// A whole-tick duration shortened by the buff b with the carry paid back: ideal ticks / (1 + b) through carriedTicks.
// `ticks` and the carry untouched at b <= 0, or when `ticks` is not a positive finite number (a 0-tick phase stays 0).
// Pure.
export function refugeeDurationCarried(ticks: number, b: number, carry: number): { ticks: number; carry: number } {
  if (!(b > 0) || !(ticks > 0) || !Number.isFinite(ticks)) return { ticks, carry };
  return carriedTicks(ticks / (1 + b), carry);
}

// The duration alone with no carry: max(1, ceil(ticks / (1 + b))), the first job's value. Pure.
export function refugeeDurationTicks(ticks: number, b: number): number {
  return refugeeDurationCarried(ticks, b, 0).ticks;
}

// The state-held carries (RefugeeState.carry): which consumer.
export type RefugeeCarryKey = "research" | "relicStudy" | "fabricator";

// The carry `key` holds now (0 when absent). Pure.
export function refugeeCarryOf(state: Pick<GameState, "refugees">, key: RefugeeCarryKey): number {
  return cleanRefugeeCarry(state.refugees?.carry?.[key]);
}

// `state` with carry `key` set to `carry`: a 0 removes the key (and an empty carry record), and the SAME state comes
// back when nothing changes (and with no refugee record at all, where no buff can be live). Pure.
export function withRefugeeCarry<S extends Pick<GameState, "refugees">>(state: S, key: RefugeeCarryKey, carry: number): S {
  const refugees = state.refugees;
  if (refugees === undefined) return state;
  const c = cleanRefugeeCarry(carry);
  if (cleanRefugeeCarry(refugees.carry?.[key]) === c && (c > 0 || refugees.carry?.[key] === undefined)) return state;
  const nextCarry = { ...(refugees.carry ?? {}) };
  if (c > 0) nextCarry[key] = c;
  else delete nextCarry[key];
  const { carry: _old, ...rest } = refugees;
  return { ...state, refugees: Object.keys(nextCarry).length > 0 ? { ...rest, carry: nextCarry } : rest };
}

// The Dispatcher's fold on a short-range cycle plan: every phase shortened by the Mission Control buff (frozen with the
// plan at the cycle start), in phase order through the run's carry `carry` (absent = 0). The same plan object and
// carry at b = 0. Pure.
export function refugeeShortRangePlan(
  state: Pick<GameState, "refugees">,
  plan: ShortRangeCyclePlan,
  carry = 0,
): { plan: ShortRangeCyclePlan; carry: number } {
  const b = refugeeFacilityBonus(state, "missionControl");
  if (!(b > 0)) return { plan, carry };
  let c = carry;
  const phase = (t: number): number => {
    const r = refugeeDurationCarried(t, b, c);
    c = r.carry;
    return r.ticks;
  };
  const transitOutTicks = phase(plan.transitOutTicks);
  const onSiteTicks = phase(plan.onSiteTicks);
  const transitBackTicks = phase(plan.transitBackTicks);
  const unloadTicks = phase(plan.unloadTicks);
  return {
    plan: { transitOutTicks, onSiteTicks, transitBackTicks, unloadTicks, totalTicks: transitOutTicks + onSiteTicks + transitBackTicks + unloadTicks },
    carry: c,
  };
}

// The keyed stream seed of the refine job minted as process number `processNumber` in the save keyed by `saveSeed`
// (the worksDirectorateSeed mix with this file's salt), so the Refiner's roll never shares a stream with any other
// draw and job N rolls differently in every save. Pure uint32.
export function refugeeRefineSeed(saveSeed: number, processNumber: number): number {
  let h = ((saveSeed >>> 0) ^ REFUGEE_REFINE_SALT ^ Math.imul(processNumber >>> 0, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

// Whether the refine job minted as process number `processNumber` yields one extra batch of its output, at `chance`
// (the Refinery buff). One integer draw on its own keyed stream; false with no draw at chance <= 0. Pure.
export function refugeeRefineBonus(saveSeed: number, processNumber: number, chance: number): boolean {
  if (!(chance > 0)) return false;
  return makeRng(refugeeRefineSeed(saveSeed, processNumber)).chance(Math.round(Math.min(1, chance) * REFINE_ROLL_DENOMINATOR), REFINE_ROLL_DENOMINATOR);
}
