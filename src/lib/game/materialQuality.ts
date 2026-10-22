// Material Lines ML-3 + ML-4 (0.14.0, plan docs/plans/2026-10-17-material-lines-and-emod-plan.md section 4): material
// QUALITY on delivery and its carry into crafts. Pure helpers; the two seams that read them live in tick.ts (the
// economyTick deposit fold and startProcess / resolveProcesses).
//
// ML-3, OC-D2 (user 2026-10-15 "Chance to upgrade a unit (Recommended)"; X1 2026-10-19 "Material Lines builds it"):
// a ship's materialQualityChance lines (the Prospecting Rig family; the Refinery-Feed Rig's identity) give each
// delivered unit a chance to arrive ONE quality step higher. L4 (2026-10-19 "Expected count + 1 roll"): a delivery
// climbs exactly floor(amount x p) units, plus one more when ONE keyed rounding roll lands under the fraction left
// over. The roll is the captain's own private stream (captain id + a lifetime delivery counter + the salt), never
// the shared economy stream, so a ship with a rig takes exactly the shared draws a ship without one takes.
//
// ML-4, L5 (2026-10-19 "Toggle, lowest-first default"; mockup sign-off 2026-10-21: it starts lowest-first every
// time): a craft order spends its inputs lowest quality first unless the player turned on "Use best materials" for
// that order. L6 (2026-10-19 "Weighted average + climb"): a job stamps the unit-weighted average quality of
// everything it consumed, rounded down, and its output lands at min(5, carried + the usual quality roll).

import Decimal from "break_infinity.js";
import { makeRng } from "./combat/rng";
import { diminishing } from "./diminishing";
import { QUALITY_TIERS } from "./inventory";

// The highest quality a unit can hold (Q5).
export const MAX_MATERIAL_QUALITY = QUALITY_TIERS - 1;

// [PROVISIONAL] (no answer names the numbers; the plan asks only for a concave curve with no cap, D23): a ship's
// summed materialQualityChance points become a per-unit climb chance through the shared D23 curve,
// diminishing(points x perPoint, knee). About 1% a point at first: 10 points about 8.5%, 20 points about 15%, 30
// points about 21%, and still rising. The chance is a probability per unit, so it reads as 1 at most (every unit
// climbs); no rig gets near that.
export const MATERIAL_QUALITY_CURVE = { perPoint: 0.01, knee: 0.25 };

// The per-unit climb chance `points` of materialQualityChance buy. 0 for no points. Pure.
export function materialQualityClimbChance(points: number): number {
  if (!(points > 0)) return 0;
  const p = diminishing(points * MATERIAL_QUALITY_CURVE.perPoint, MATERIAL_QUALITY_CURVE.knee);
  return p > 1 ? 1 : p;
}

// The salt of the delivery climb's private stream (odd, unique in the repo; salts.test.ts).
export const MATERIAL_QUALITY_SALT = 0x5b3d71a9;

// The private stream seed of one delivery: an FNV-1a mix of the captain id and the captain's LIFETIME count of
// deliveries a climb chance was rolled for (CaptainState.materialQualityCycles), then the salt (the Motherlode
// precedent), so no two deliveries of a career share a roll. Pure.
export function materialQualitySeed(captainId: number, lifetimeDelivery: number): number {
  const key = `${captainId}|materialQuality|${lifetimeDelivery}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h ^ MATERIAL_QUALITY_SALT) >>> 0;
}

// One delivery's private rounding stream (one draw per delivered item, in a fixed order). Pure.
export function materialQualityStream(captainId: number, lifetimeDelivery: number): () => number {
  const rng = makeRng(materialQualitySeed(captainId, lifetimeDelivery));
  return () => rng.next();
}

// How many of `amount` delivered units climb at chance `p`: floor(amount x p), plus one when `roll()` lands under
// the fraction left over (L4: the exact expected count plus one keyed rounding roll). Never more than `amount`.
// Draws once from `roll` when p > 0 and amount > 0, else not at all. Pure.
export function deliveryClimbUnits(amount: Decimal, p: number, roll: () => number): Decimal {
  if (!(p > 0) || !amount.gt(0)) return new Decimal(0);
  let expected = amount.times(p);
  // Float noise must not turn an exact count into a rounding roll (100 x 0.1 is 10, not 10.000000000000002).
  const nearest = expected.round();
  if (expected.minus(nearest).abs().lt(1e-9)) expected = nearest;
  const whole = expected.floor();
  const frac = expected.minus(whole).toNumber();
  const climbed = roll() < frac ? whole.plus(1) : whole;
  return Decimal.min(climbed, amount);
}

// The quality a climbed unit lands at: one step above the delivery's own, Q5 at most (a Q5 unit stays Q5).
export function climbedQuality(quality: number): number {
  return Math.min(MAX_MATERIAL_QUALITY, quality + 1);
}

// ---------------------------------------------------------------------------------------------------------------
// ML-4: spending stock and the carried quality
// ---------------------------------------------------------------------------------------------------------------

// Which stock a craft order spends first. Absent on an order means "lowest" (the documented consume policy, today's
// behavior); "best" is the "Use best materials" toggle, written only when the player turns it on.
export type MaterialPreference = "lowest" | "best";

// The tally of what one job consumed: units and quality-weighted units (sum of quality x units).
export interface ConsumedQuality {
  units: Decimal;
  qualityUnits: Decimal;
}

// The carried quality of a job (L6): the unit-weighted average of the consumed quality, rounded down, Q5 at most.
// 0 when nothing was consumed. Pure.
export function carriedQuality(tally: ConsumedQuality): number {
  if (!tally.units.gt(0)) return 0;
  // A tiny epsilon keeps an exact average (2.0 computed as 1.9999...) on its own rung.
  const avg = tally.qualityUnits.div(tally.units).toNumber();
  return Math.max(0, Math.min(MAX_MATERIAL_QUALITY, Math.floor(avg + 1e-9)));
}

// A craft's output quality (L6): the carried quality plus the usual roll, Q5 at most. An absent carry is 0, so a job
// started without one (every job in flight when ML-4 landed) resolves exactly as before.
export function craftOutputQuality(carried: number | undefined, rolled: number): number {
  const c = carried ?? 0;
  return c > 0 ? Math.min(MAX_MATERIAL_QUALITY, c + rolled) : rolled;
}
