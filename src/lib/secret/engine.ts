// engine.ts: the rules of "Hyperion Legacy v0.0000001a", the secret generator game (0.13.11).
//
// PURE. No DOM, no clock, no storage, no randomness: every function is a function of its
// arguments, so live ticking, offline catch-up and the pacing simulation all run the exact same
// code. Public functions take a state and return a NEW state; the *Mut twins mutate a working copy
// and exist so catch-up can run tens of thousands of steps without copying per step.
//
// Nothing here reads or writes the main game. The main GameState, economyTick and the main
// offline catch-up never see this module.
//
// THE CASCADE. Tier I (Mining Laser) makes Ore; tier k makes tier k-1. Each tier's rate is
//   rho[k] = baseRate[k] x tenBonus^floor(bought[k]/10) x 1.125^overclock x prestigeMultiplier
// and a step of dt seconds integrates the linear chain EXACTLY for constant rates (a truncated
// exponential: the j-th tier above contributes owned x product(rho) x dt^j / j!). So one 10 s step
// equals ten 1 s steps whenever nothing is bought in between.
//
// THE CLOCK. Overclock is priced in seconds of income (config.ts), which makes the in-run climb of
// the Ore exponent steady over real time and proportional to the prestige multiplier. Prestige
// currencies then grow with time spent, not with how often you click, which is what keeps the
// planned playtime robust and lets long offline gaps run in coarse steps without paying less.
//
// RAW VS EFFECTIVE. The engine keeps raw Ore. Everything a player sees or is paid by (display,
// prices shown, prestige gains, milestones, the goal bar) reads the EFFECTIVE exponent, which is
// the raw exponent up to e777,777 and a concave curve above it: diminishing returns from the
// finale on, never a cap (design section 6, user builder check Q1; D23).

import Decimal from "break_infinity.js";
import {
  TIERS,
  TIER_COUNT,
  TEN_BONUS,
  TEN_BONUS_SKILL,
  START_ORE,
  OC_FACTOR,
  OC_SECONDS,
  OC_FLOOR_BASE,
  OC_FLOOR_STEP,
  OC_AUTO_SHARE,
  CAPTAIN_AT,
  FLEET_AT,
  PRESTIGECEPTION_AT,
  CP_SCALE,
  CP_POW,
  AP_SCALE,
  AP_POW,
  DP_SCALE,
  DP_POW,
  HEAD_START_LOG10,
  OVERDRIVE_POWER,
  FINALE_EXPONENT,
  LONG_EXPONENT,
  SOFT_SCALE,
  SOFT_BETA,
  SKILLS,
  TURBO_LEVEL,
  type SkillId,
  type MilestoneId,
} from "./config";
import { cloneSecret, type SecretState, type AutoLayer } from "./state";

const ZERO = new Decimal(0);
const ONE = new Decimal(1);
const LOG_FLOOR_BASE = Math.log10(OC_FLOOR_BASE);
const LOG_FLOOR_STEP = Math.log10(OC_FLOOR_STEP);

// ---------------------------------------------------------------------------
// The effective scale
// ---------------------------------------------------------------------------

export function softenExponent(x: number): number {
  if (x <= FINALE_EXPONENT) return x;
  return FINALE_EXPONENT + (SOFT_SCALE * (Math.pow(1 + (x - FINALE_EXPONENT) / SOFT_SCALE, SOFT_BETA) - 1)) / SOFT_BETA;
}

// d(effective)/d(raw), for turning a raw income into a displayed one.
function softenSlope(x: number): number {
  if (x <= FINALE_EXPONENT) return 1;
  return Math.pow(1 + (x - FINALE_EXPONENT) / SOFT_SCALE, SOFT_BETA - 1);
}

function rawExponent(raw: Decimal): number {
  return raw.lte(1) ? 0 : raw.log10();
}

// log10 of Ore on the effective scale (what milestones, gains and the goal bar read).
export function effectiveExponent(raw: Decimal): number {
  return softenExponent(rawExponent(raw));
}

// A raw amount as the player sees it.
export function displayOre(raw: Decimal): Decimal {
  const x = rawExponent(raw);
  if (x <= FINALE_EXPONENT) return raw;
  return Decimal.pow(10, softenExponent(x));
}

// Ore per second as the player sees it (the chain rule through the softening curve).
export function displayIncome(s: SecretState): Decimal {
  const x = rawExponent(s.ore);
  if (x <= FINALE_EXPONENT || s.ore.lte(0)) return s.lastIncome;
  return displayOre(s.ore).mul(softenSlope(x)).mul(s.lastIncome.div(s.ore));
}

// ---------------------------------------------------------------------------
// Multipliers
// ---------------------------------------------------------------------------

export function hasSkill(s: SecretState, id: SkillId): boolean {
  return s.skills[id] === true;
}

// An auto skill acts only when owned and switched on (missing switch means on).
export function autoActive(s: SecretState, id: SkillId): boolean {
  return hasSkill(s, id) && s.autoOn[id] !== false;
}

// Captain Points x Augment Points: multiplies every generator and speeds the Overclock clock.
export function prestigeMultiplier(s: SecretState): Decimal {
  return s.captainPoints.add(1).pow(CP_POW).mul(s.augmentPoints.add(1).pow(AP_POW));
}

// Dream Points: multiply the Captain and Augment Points earned per prestige.
export function gainMultiplier(s: SecretState): Decimal {
  return s.dreamPoints.add(1).pow(DP_POW);
}

export function tenBonusFactor(s: SecretState): number {
  return hasSkill(s, "tenBonus") ? TEN_BONUS_SKILL : TEN_BONUS;
}

// The output multiplier one tier gets from its own tens bought.
export function tenMultiplier(s: SecretState, tier: number): Decimal {
  return Decimal.pow(tenBonusFactor(s), Math.floor(s.bought[tier] / 10));
}

export function overclockMultiplier(s: SecretState): Decimal {
  return Decimal.pow(OC_FACTOR, s.overclock);
}

// Everything multiplying one tier's rate, for display.
export function tierMultiplier(s: SecretState, tier: number): Decimal {
  return tenMultiplier(s, tier).mul(overclockMultiplier(s)).mul(prestigeMultiplier(s));
}

export function isTierUnlocked(s: SecretState, tier: number): boolean {
  return tier >= 0 && tier < s.tiersUnlocked;
}

// Ore per second over the last step (raw).
export function oreIncome(s: SecretState): Decimal {
  return s.lastIncome;
}

// ---------------------------------------------------------------------------
// Generator purchases
// ---------------------------------------------------------------------------

export type BuyMode = "one" | "ten" | "max";

function priceAtTen(tier: number, tenIndex: number): Decimal {
  const def = TIERS[tier];
  return Decimal.pow(10, def.baseCostLog10 + def.costStepLog10 * tenIndex);
}

// The price of the next single unit of a tier (flat within the current ten).
export function unitPrice(s: SecretState, tier: number): Decimal {
  return priceAtTen(tier, Math.floor(s.bought[tier] / 10));
}

// Buys up to maxCount units of a tier with at most `budget` Ore. Mutates s. Returns units bought.
// Closed form: the rest of the current ten, then whole tens as a geometric series, then a partial
// ten, so Max stays O(1) even when it buys millions of units.
export function buyTierMut(s: SecretState, tier: number, budget: Decimal, maxCount = Infinity): number {
  if (!isTierUnlocked(s, tier) || budget.lte(0) || maxCount <= 0) return 0;
  let left = Decimal.min(budget, s.ore);
  let b = s.bought[tier];
  let count = 0;

  const fill = (room: number): void => {
    const price = priceAtTen(tier, Math.floor(b / 10));
    let n = Math.min(room, maxCount - count);
    const affordable = left.div(price).floor();
    if (affordable.lt(n)) n = affordable.toNumber();
    if (n > 0) {
      left = left.sub(price.mul(n));
      b += n;
      count += n;
    }
  };

  fill(10 - (b % 10));
  if (b % 10 === 0 && count < maxCount && left.gt(0)) {
    const step = Math.pow(10, TIERS[tier].costStepLog10);
    const first = priceAtTen(tier, b / 10).mul(10);
    let tens = Math.floor(Decimal.affordGeometricSeries(left, first, step, 0).toNumber());
    tens = Math.max(0, Math.min(tens, Math.floor((maxCount - count) / 10)));
    let cost = tens > 0 ? Decimal.sumGeometricSeries(tens, first, step, 0) : ZERO;
    while (tens > 0 && cost.gt(left)) {
      tens -= 1;
      cost = tens > 0 ? Decimal.sumGeometricSeries(tens, first, step, 0) : ZERO;
    }
    if (tens > 0) {
      left = left.sub(cost);
      b += 10 * tens;
      count += 10 * tens;
    }
    if (count < maxCount && left.gt(0)) fill(10);
  }
  if (count > 0) {
    const spent = Decimal.min(budget, s.ore).sub(left);
    s.ore = Decimal.max(ZERO, s.ore.sub(spent));
    s.bought[tier] = b;
    s.owned[tier] = s.owned[tier].add(count);
  }
  return count;
}

export function buyTier(s: SecretState, tier: number, mode: BuyMode): SecretState {
  const next = cloneSecret(s);
  const max = mode === "one" ? 1 : mode === "ten" ? 10 - (s.bought[tier] % 10) : Infinity;
  buyTierMut(next, tier, next.ore, max);
  return next;
}

// ---------------------------------------------------------------------------
// Overclock
// ---------------------------------------------------------------------------

function overclockFlatPrice(s: SecretState): Decimal {
  return s.lastIncome.mul(OC_SECONDS).div(prestigeMultiplier(s));
}

function overclockFloorPrice(level: number): Decimal {
  return Decimal.pow(10, LOG_FLOOR_BASE + LOG_FLOOR_STEP * level);
}

// The price of the next Overclock level.
export function overclockPrice(s: SecretState): Decimal {
  return Decimal.max(overclockFlatPrice(s), overclockFloorPrice(s.overclock));
}

// Buys up to maxCount levels with at most `budget` Ore. Mutates s. Returns levels bought.
// Levels whose floor is below the income price cost the flat income price; above that the floor's
// geometric series applies.
// Overclock only speeds up a stack that is producing. Refusing it while nothing is owned or there is
// no income yet means the starting (or post-reset) Ore can never be sunk into Overclock with no
// generator left to buy, which used to soft-lock a fresh game at 0 Ore.
export function canOverclock(s: SecretState): boolean {
  return s.lastIncome.gt(0) && s.owned.some((d) => d.gt(0));
}

export function buyOverclockMut(s: SecretState, budget: Decimal, maxCount = Infinity): number {
  if (budget.lte(0) || maxCount <= 0 || !canOverclock(s)) return 0;
  let left = Decimal.min(budget, s.ore);
  let count = 0;
  const flat = overclockFlatPrice(s);
  if (flat.gt(0)) {
    const firstFloorAbove = Math.ceil((flat.log10() - LOG_FLOOR_BASE) / LOG_FLOOR_STEP);
    const flatLevels = Math.min(Math.max(0, firstFloorAbove - s.overclock), maxCount);
    if (flatLevels > 0) {
      let n = flatLevels;
      const affordable = left.div(flat).floor();
      if (affordable.lt(n)) n = affordable.toNumber();
      if (n > 0) {
        left = left.sub(flat.mul(n));
        count += n;
      }
      if (n < flatLevels) return commitOverclock(s, budget, left, count);
    }
  }
  if (count < maxCount && left.gt(0)) {
    const first = overclockFloorPrice(s.overclock + count);
    let n = Math.floor(Decimal.affordGeometricSeries(left, first, OC_FLOOR_STEP, 0).toNumber());
    n = Math.max(0, Math.min(n, maxCount - count));
    let cost = n > 0 ? Decimal.sumGeometricSeries(n, first, OC_FLOOR_STEP, 0) : ZERO;
    while (n > 0 && cost.gt(left)) {
      n -= 1;
      cost = n > 0 ? Decimal.sumGeometricSeries(n, first, OC_FLOOR_STEP, 0) : ZERO;
    }
    if (n > 0) {
      left = left.sub(cost);
      count += n;
    }
  }
  return commitOverclock(s, budget, left, count);
}

function commitOverclock(s: SecretState, budget: Decimal, left: Decimal, count: number): number {
  if (count > 0) {
    const spent = Decimal.min(budget, s.ore).sub(left);
    s.ore = Decimal.max(ZERO, s.ore.sub(spent));
    s.overclock += count;
  }
  return count;
}

export function buyOverclock(s: SecretState, mode: "one" | "max"): SecretState {
  const next = cloneSecret(s);
  buyOverclockMut(next, next.ore, mode === "one" ? 1 : Infinity);
  return next;
}

// ---------------------------------------------------------------------------
// Production
// ---------------------------------------------------------------------------

export function produceMut(s: SecretState, dt: number): void {
  if (dt <= 0) return;
  const n = s.tiersUnlocked;
  const shared = overclockMultiplier(s).mul(prestigeMultiplier(s));
  const rho: Decimal[] = [];
  for (let k = 0; k < n; k++) rho.push(tenMultiplier(s, k).mul(TIERS[k].baseRate).mul(shared));
  // x[0] is Ore, x[m] is owned[m - 1]. The top unlocked tier is only ever bought.
  const x: Decimal[] = [s.ore, ...s.owned.slice(0, n)];
  const gains: Decimal[] = new Array(n).fill(ZERO);
  for (let m = 0; m < n; m++) {
    let acc = ZERO;
    let prod = ONE;
    for (let j = 1; m + j <= n; j++) {
      prod = prod.mul(rho[m + j - 1]).mul(dt / j);
      const src = x[m + j];
      if (src.gt(0)) acc = acc.add(src.mul(prod));
    }
    gains[m] = acc;
  }
  let oreGain = gains[0];
  if (hasSkill(s, "overdrive") && oreGain.gt(0)) oreGain = oreGain.div(dt).pow(OVERDRIVE_POWER).mul(dt);
  s.lastIncome = oreGain.div(dt);
  s.ore = s.ore.add(oreGain);
  for (let m = 1; m < n; m++) s.owned[m - 1] = s.owned[m - 1].add(gains[m]);
}

// ---------------------------------------------------------------------------
// Auto-buyers
// ---------------------------------------------------------------------------

function autoBuyMut(s: SecretState): void {
  let overclockBought = false;
  const autoOc = autoActive(s, "autoOverclock");
  // "Income priced": the stack is producing and the next level costs seconds of income rather
  // than the post-reset floor. Only then may Auto Overclock spend past its share or make the
  // generators wait for it. Right after a reset (no income, floor price) it only ever spends its
  // share, so it can never starve the generators of the Ore they need to get going.
  const flat = overclockFlatPrice(s);
  const incomePriced = s.lastIncome.gt(0) && flat.gte(overclockFloorPrice(s.overclock));
  if (autoOc) {
    const price = overclockPrice(s);
    let budget = s.ore.mul(OC_AUTO_SHARE);
    if (incomePriced && budget.lt(price) && s.ore.gte(price)) budget = price;
    overclockBought = buyOverclockMut(s, budget) > 0;
  }
  const low = autoActive(s, "autoBuyLow");
  const high = autoActive(s, "autoBuyHigh");
  if (!low && !high) return;
  // While Auto Overclock is saving up for a level, the generators leave that much Ore alone.
  const reserve = autoOc && incomePriced && !overclockBought ? Decimal.min(s.ore, overclockPrice(s)) : ZERO;
  for (let k = s.tiersUnlocked - 1; k >= 0; k--) {
    if (!(k < 4 ? low : high)) continue;
    const budget = s.ore.sub(reserve);
    if (budget.lte(0)) break;
    buyTierMut(s, k, budget);
  }
}

// ---------------------------------------------------------------------------
// Prestige layers
// ---------------------------------------------------------------------------

export function captainGain(s: SecretState): Decimal {
  const e = effectiveExponent(s.runPeak);
  if (e < CAPTAIN_AT) return ZERO;
  return gainMultiplier(s).mul(CP_SCALE * (e / CAPTAIN_AT)).floor();
}

export function fleetGain(s: SecretState): Decimal {
  const e = effectiveExponent(s.fleetPeak);
  if (e < FLEET_AT) return ZERO;
  return gainMultiplier(s).mul(AP_SCALE * (e / FLEET_AT)).floor();
}

export function prestigeceptionGain(s: SecretState): Decimal {
  const e = effectiveExponent(s.pcPeak);
  if (e < PRESTIGECEPTION_AT) return ZERO;
  return new Decimal(DP_SCALE * (e / PRESTIGECEPTION_AT)).floor();
}

function resetRunMut(s: SecretState): void {
  s.ore = hasSkill(s, "headStart") ? Decimal.pow(10, HEAD_START_LOG10) : new Decimal(START_ORE);
  s.bought = new Array(TIER_COUNT).fill(0);
  s.owned = Array.from({ length: TIER_COUNT }, () => ZERO);
  s.overclock = 0;
  s.lastIncome = ZERO;
  s.runPeak = s.ore;
  s.runSeconds = 0;
}

function unlockTiersMut(s: SecretState): void {
  for (let k = s.tiersUnlocked; k < TIER_COUNT; k++) {
    if (s.fleetTotal >= TIERS[k].unlockFleet) s.tiersUnlocked = k + 1;
    else break;
  }
}

function doCaptainMut(s: SecretState, atMs: number): boolean {
  const gain = captainGain(s);
  if (gain.lte(0)) return false;
  s.captainPoints = s.captainPoints.add(gain);
  s.captainCount += 1;
  resetRunMut(s);
  checkMilestonesMut(s, atMs);
  return true;
}

function doFleetMut(s: SecretState, atMs: number): boolean {
  const gain = fleetGain(s);
  if (gain.lte(0)) return false;
  s.augmentPoints = s.augmentPoints.add(gain);
  s.fleetCount += 1;
  s.fleetTotal += 1;
  s.skillPoints += 1;
  s.captainPoints = ZERO;
  unlockTiersMut(s);
  resetRunMut(s);
  s.fleetPeak = s.ore;
  checkMilestonesMut(s, atMs);
  return true;
}

function doPrestigeceptionMut(s: SecretState, atMs: number): boolean {
  const gain = prestigeceptionGain(s);
  if (gain.lte(0)) return false;
  s.dreamPoints = s.dreamPoints.add(gain);
  s.pcCount += 1;
  s.captainPoints = ZERO;
  s.augmentPoints = ZERO;
  s.fleetCount = 0;
  resetRunMut(s);
  s.fleetPeak = s.ore;
  s.pcPeak = s.ore;
  checkMilestonesMut(s, atMs);
  return true;
}

export function doCaptain(s: SecretState, atMs: number): SecretState {
  const next = cloneSecret(s);
  return doCaptainMut(next, atMs) ? next : s;
}

export function doFleet(s: SecretState, atMs: number): SecretState {
  const next = cloneSecret(s);
  return doFleetMut(next, atMs) ? next : s;
}

export function doPrestigeception(s: SecretState, atMs: number): SecretState {
  const next = cloneSecret(s);
  return doPrestigeceptionMut(next, atMs) ? next : s;
}

// Would an auto prestige with this target fire? gain >= target% of what you have (and > 0).
function meetsTarget(gain: Decimal, have: Decimal, pct: number): boolean {
  return gain.gt(0) && gain.gte(have.mul(pct / 100));
}

function autoPrestigeMut(s: SecretState, atMs: number): void {
  if (autoActive(s, "autoPc") && meetsTarget(prestigeceptionGain(s), s.dreamPoints, s.autoTarget.pc)) {
    doPrestigeceptionMut(s, atMs);
    return;
  }
  if (autoActive(s, "autoFleet") && meetsTarget(fleetGain(s), s.augmentPoints, s.autoTarget.fleet)) {
    doFleetMut(s, atMs);
    return;
  }
  if (autoActive(s, "autoCaptain") && meetsTarget(captainGain(s), s.captainPoints, s.autoTarget.captain)) {
    doCaptainMut(s, atMs);
  }
}

// ---------------------------------------------------------------------------
// Skills and settings
// ---------------------------------------------------------------------------

export function canBuySkill(s: SecretState, id: SkillId): boolean {
  const def = SKILLS.find((d) => d.id === id);
  if (!def || hasSkill(s, id)) return false;
  if (def.requires && !hasSkill(s, def.requires)) return false;
  return s.skillPoints >= def.cost;
}

export function buySkill(s: SecretState, id: SkillId, atMs: number): SecretState {
  if (!canBuySkill(s, id)) return s;
  const def = SKILLS.find((d) => d.id === id)!;
  const next = cloneSecret(s);
  next.skillPoints -= def.cost;
  next.skills[id] = true;
  checkMilestonesMut(next, atMs);
  return next;
}

export function setAuto(s: SecretState, id: SkillId, on: boolean): SecretState {
  const next = cloneSecret(s);
  next.autoOn[id] = on;
  return next;
}

export function setAutoTarget(s: SecretState, layer: AutoLayer, pct: number): SecretState {
  if (!Number.isFinite(pct) || pct <= 0) return s;
  const next = cloneSecret(s);
  next.autoTarget[layer] = pct;
  return next;
}

// ---------------------------------------------------------------------------
// Milestones (recorded with the real date, never moved once set)
// ---------------------------------------------------------------------------

function reached(s: SecretState, id: MilestoneId): boolean {
  const e = () => effectiveExponent(s.bestOre);
  switch (id) {
    case "firstCaptain":
      return s.captainCount > 0;
    case "googol":
      return e() >= 100;
    case "firstFleet":
      return s.fleetTotal > 0;
    case "e1000":
      return e() >= 1000;
    case "singularity":
      return s.tiersUnlocked >= TIER_COUNT && s.owned[TIER_COUNT - 1].gt(0);
    case "firstPc":
      return s.pcCount > 0;
    case "turbo":
      return s.overclock >= TURBO_LEVEL;
    case "e100k":
      return e() >= 100000;
    case "allSkills":
      return SKILLS.every((d) => hasSkill(s, d.id));
    case "finale":
      return e() >= FINALE_EXPONENT;
    case "long":
      return e() >= LONG_EXPONENT;
  }
}

const MILESTONE_IDS: readonly MilestoneId[] = [
  "firstCaptain", "googol", "firstFleet", "e1000", "singularity", "firstPc", "turbo", "e100k", "allSkills", "finale", "long",
];

export function checkMilestonesMut(s: SecretState, atMs: number): void {
  for (const id of MILESTONE_IDS) {
    if (s.milestones[id] === undefined && reached(s, id)) s.milestones[id] = atMs;
  }
}

// ---------------------------------------------------------------------------
// The step: auto-buy, produce, track peaks, auto-prestige, milestones
// ---------------------------------------------------------------------------

// The no-dead-end invariant: an empty stack always has at least enough Ore for a Mining Laser.
function ensureRecoverableMut(s: SecretState): void {
  if (s.owned.every((d) => d.lte(0)) && s.ore.lt(unitPrice(s, 0))) s.ore = new Decimal(START_ORE);
}

export function stepMut(s: SecretState, dt: number, atMs: number): void {
  ensureRecoverableMut(s);
  autoBuyMut(s);
  produceMut(s, dt);
  s.runSeconds += dt;
  if (s.ore.gt(s.runPeak)) s.runPeak = s.ore;
  if (s.ore.gt(s.fleetPeak)) s.fleetPeak = s.ore;
  if (s.ore.gt(s.pcPeak)) s.pcPeak = s.ore;
  if (s.ore.gt(s.bestOre)) s.bestOre = s.ore;
  autoPrestigeMut(s, atMs);
  checkMilestonesMut(s, atMs);
}

export function step(s: SecretState, dt: number, atMs: number): SecretState {
  const next = cloneSecret(s);
  stepMut(next, dt, atMs);
  return next;
}
