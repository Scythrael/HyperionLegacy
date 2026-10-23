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
  UPGRADES,
  UPGRADES_AT,
  CP_K,
  AP_K,
  DP_K,
  STARFALL_EXPONENT,
  type SkillId,
  type MilestoneId,
  type UpgradeId,
} from "./config";
import { cloneSecret, type SecretState, type AutoLayer } from "./state";

const ZERO = new Decimal(0);
const ONE = new Decimal(1);
const LOG_FLOOR_BASE = Math.log10(OC_FLOOR_BASE);
const LOG_FLOOR_STEP = Math.log10(OC_FLOOR_STEP);

// 10^x as a Decimal, built straight from mantissa and exponent. The step function runs tens of
// thousands of times per catch-up, and this is several times cheaper than Decimal.pow's general
// path for the same result (a double's precision on x, which Decimal.pow has too).
export function pow10(x: number): Decimal {
  if (!Number.isFinite(x)) return x > 0 ? Decimal.pow(10, x) : ZERO;
  const e = Math.floor(x);
  return Decimal.fromMantissaExponent_noNormalize(Math.pow(10, x - e), e);
}

// base^n for a plain positive base: an exact double while it stays below 1e300, pow10 beyond.
function powNumber(base: number, n: number): Decimal {
  const x = Math.log10(base) * n;
  return x < 300 ? new Decimal(Math.pow(base, n)) : pow10(x);
}

// base^power for a positive Decimal base, through its log.
function powPositive(base: Decimal, power: number): Decimal {
  return base.lte(0) ? ZERO : pow10(base.log10() * power);
}

// The geometric series every Max buy needs: how many items starting at 10^firstLog, each
// 10^ratioLog times the last, are affordable with `left`, and what they cost. Exact closed form with one
// check for float rounding at the top end.
function affordSeries(left: Decimal, firstLog: number, ratioLog: number, maxCount: number): { count: number; cost: Decimal } {
  if (maxCount <= 0 || left.lte(0)) return { count: 0, cost: ZERO };
  const ratio = Math.pow(10, ratioLog);
  const first = pow10(firstLog);
  const costOf = (n: number) => pow10(firstLog + ratioLog * n).sub(first).div(ratio - 1);
  let n = Math.floor(left.mul(ratio - 1).div(first).add(1).log10() / ratioLog);
  n = Math.max(0, Math.min(n, maxCount));
  let cost = n > 0 ? costOf(n) : ZERO;
  while (n > 0 && cost.gt(left)) {
    n -= 1;
    cost = n > 0 ? costOf(n) : ZERO;
  }
  return { count: n, cost };
}

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
  return pow10(softenExponent(x));
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

// The level of one e1,000,000 upgrade (0 when not bought).
export function upgradeLevel(s: SecretState, id: UpgradeId): number {
  return s.upgrades?.[id] ?? 0;
}

function upgradeStep(id: UpgradeId): number {
  return UPGRADES.find((u) => u.id === id)!.step;
}

// Captain Points x Augment Points: multiplies every generator and speeds the Overclock clock.
// Captain's Compound counts both as if you held (1 + step x level) times as many. Lucid Dreaming
// lets Dream Points speed the stack too: x (1 + DP)^(step x level).
export function prestigeMultiplier(s: SecretState): Decimal {
  const base = captainMultiplier(s).mul(augmentMultiplier(s));
  return upgradeLevel(s, "lucidDreaming") === 0 ? base : base.mul(dreamSpeedMultiplier(s));
}

// The three factors of prestigeMultiplier, also what the Prestige tab shows (so the screen can
// never disagree with the engine). At level 0 each is exactly the 0.13.11 formula.
function compoundFactor(s: SecretState): number {
  return 1 + upgradeStep("captainsCompound") * upgradeLevel(s, "captainsCompound");
}
export function captainMultiplier(s: SecretState): Decimal {
  const cc = upgradeLevel(s, "captainsCompound");
  return powPositive(cc === 0 ? s.captainPoints.add(1) : s.captainPoints.mul(compoundFactor(s)).add(1), CP_POW);
}
export function augmentMultiplier(s: SecretState): Decimal {
  const cc = upgradeLevel(s, "captainsCompound");
  return powPositive(cc === 0 ? s.augmentPoints.add(1) : s.augmentPoints.mul(compoundFactor(s)).add(1), AP_POW);
}
export function dreamSpeedMultiplier(s: SecretState): Decimal {
  const ld = upgradeLevel(s, "lucidDreaming");
  return ld === 0 ? ONE : powPositive(s.dreamPoints.add(1), upgradeStep("lucidDreaming") * ld);
}

// Dream Points: multiply the Captain and Augment Points earned per prestige.
export function gainMultiplier(s: SecretState): Decimal {
  return powPositive(s.dreamPoints.add(1), DP_POW);
}

// The raw exponent whose effective value is e (the inverse of softenExponent).
export function unsoftenExponent(e: number): number {
  if (e <= FINALE_EXPONENT) return e;
  return FINALE_EXPONENT + SOFT_SCALE * (Math.pow(1 + (SOFT_BETA * (e - FINALE_EXPONENT)) / SOFT_SCALE, 1 / SOFT_BETA) - 1);
}

export function upgradesUnlocked(s: SecretState): boolean {
  return effectiveExponent(s.bestOre) >= UPGRADES_AT;
}

// Effective exponent of the next level's price, or null at the cap.
export function upgradePriceExponent(s: SecretState, id: UpgradeId): number | null {
  const def = UPGRADES.find((u) => u.id === id)!;
  const level = upgradeLevel(s, id);
  if (level >= def.cap) return null;
  return def.priceBase * Math.pow(def.priceRatio, level);
}

// The next level's price in raw Ore, or null at the cap.
export function upgradePrice(s: SecretState, id: UpgradeId): Decimal | null {
  const e = upgradePriceExponent(s, id);
  return e === null ? null : pow10(unsoftenExponent(e));
}

export function canBuyUpgrade(s: SecretState, id: UpgradeId): boolean {
  const price = upgradePrice(s, id);
  return upgradesUnlocked(s) && price !== null && s.ore.gte(price);
}

// Buys up to maxCount levels, one at a time at the rising price. Mutates s. Returns levels bought.
export function buyUpgradeMut(s: SecretState, id: UpgradeId, maxCount = Infinity): number {
  let count = 0;
  while (count < maxCount && canBuyUpgrade(s, id)) {
    s.ore = Decimal.max(ZERO, s.ore.sub(upgradePrice(s, id)!));
    s.upgrades = { ...s.upgrades, [id]: upgradeLevel(s, id) + 1 };
    count += 1;
  }
  return count;
}

export function buyUpgrade(s: SecretState, id: UpgradeId, mode: BuyMode): SecretState {
  if (!canBuyUpgrade(s, id)) return s;
  const next = cloneSecret(s);
  buyUpgradeMut(next, id, mode === "one" ? 1 : mode === "ten" ? 10 : Infinity);
  return next;
}

// Tenfold Tuner adds step x level to the ten bonus factor.
export function tenBonusFactor(s: SecretState): number {
  const base = hasSkill(s, "tenBonus") ? TEN_BONUS_SKILL : TEN_BONUS;
  const tt = upgradeLevel(s, "tenfoldTuner");
  return tt === 0 ? base : base + upgradeStep("tenfoldTuner") * tt;
}

// The output multiplier one tier gets from its own tens bought.
export function tenMultiplier(s: SecretState, tier: number): Decimal {
  return powNumber(tenBonusFactor(s), Math.floor(s.bought[tier] / 10));
}

// Overclock Overclocker makes every Overclock level count as (1 + step x level) levels.
export function overclockMultiplier(s: SecretState): Decimal {
  const oo = upgradeLevel(s, "ocOverclocker");
  return powNumber(OC_FACTOR, oo === 0 ? s.overclock : s.overclock * (1 + upgradeStep("ocOverclocker") * oo));
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
  return pow10(def.baseCostLog10 + def.costStepLog10 * tenIndex);
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
    const def = TIERS[tier];
    const firstLog = 1 + def.baseCostLog10 + def.costStepLog10 * (b / 10); // a whole ten costs 10 units
    const { count: tens, cost } = affordSeries(left, firstLog, def.costStepLog10, Math.floor((maxCount - count) / 10));
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
  trackPeaksMut(next);
  return next;
}

// ---------------------------------------------------------------------------
// Overclock
// ---------------------------------------------------------------------------

function overclockFlatPrice(s: SecretState): Decimal {
  return s.lastIncome.mul(OC_SECONDS).div(prestigeMultiplier(s));
}

function overclockFloorPrice(level: number): Decimal {
  return pow10(LOG_FLOOR_BASE + LOG_FLOOR_STEP * level);
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
    const firstLog = LOG_FLOOR_BASE + LOG_FLOOR_STEP * (s.overclock + count);
    const { count: n, cost } = affordSeries(left, firstLog, LOG_FLOOR_STEP, maxCount === Infinity ? Number.MAX_SAFE_INTEGER : maxCount - count);
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

export function buyOverclock(s: SecretState, mode: BuyMode): SecretState {
  const next = cloneSecret(s);
  buyOverclockMut(next, next.ore, mode === "one" ? 1 : mode === "ten" ? 10 : Infinity);
  trackPeaksMut(next);
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

// 0.13.11.1 (user, 2026-10-23: "Retune so default is best"). Below the finale each layer earns
// scale x (peak exponent / threshold)^k with k under 1, so a bigger prestige pays less per minute
// waited and the default 100% target (prestige when the gain matches what you hold) is the best
// choice; at 200% to 1000%, or waiting by hand, the finale and e1,000,000 come later. Once the best
// Ore has reached the finale, Captain and Fleet Prestige return to the 0.13.11 gains (k = 1). Dream
// Points keep their bend for good: they are never reset, so a jump in their gain at the finale would
// set off Prestigeceptions that throw away weeks of climbing (measured: a two-week stall right after
// e1,000,000).
export function gainExponent(s: SecretState, k: number): number {
  return effectiveExponent(s.bestOre) >= FINALE_EXPONENT ? 1 : k;
}

function gainShape(e: number, at: number, k: number): number {
  return Math.pow(e / at, k);
}

export function captainGain(s: SecretState): Decimal {
  const e = effectiveExponent(s.runPeak);
  if (e < CAPTAIN_AT) return ZERO;
  return gainMultiplier(s).mul(CP_SCALE * gainShape(e, CAPTAIN_AT, gainExponent(s, CP_K))).floor();
}

export function fleetGain(s: SecretState): Decimal {
  const e = effectiveExponent(s.fleetPeak);
  if (e < FLEET_AT) return ZERO;
  return gainMultiplier(s).mul(AP_SCALE * gainShape(e, FLEET_AT, gainExponent(s, AP_K))).floor();
}

export function prestigeceptionGain(s: SecretState): Decimal {
  const e = effectiveExponent(s.pcPeak);
  if (e < PRESTIGECEPTION_AT) return ZERO;
  return new Decimal(DP_SCALE * gainShape(e, PRESTIGECEPTION_AT, DP_K)).floor();
}

function resetRunMut(s: SecretState): void {
  s.ore = hasSkill(s, "headStart") ? pow10(HEAD_START_LOG10) : new Decimal(START_ORE);
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

type AutoLayerDue = "pc" | "fleet" | "captain" | null;

// Which automatic prestige has reached its target (top layer first), if any.
function dueAutoPrestige(s: SecretState): AutoLayerDue {
  if (autoActive(s, "autoPc") && meetsTarget(prestigeceptionGain(s), s.dreamPoints, s.autoTarget.pc)) return "pc";
  if (autoActive(s, "autoFleet") && meetsTarget(fleetGain(s), s.augmentPoints, s.autoTarget.fleet)) return "fleet";
  if (autoActive(s, "autoCaptain") && meetsTarget(captainGain(s), s.captainPoints, s.autoTarget.captain)) return "captain";
  return null;
}

function firePrestigeMut(s: SecretState, layer: AutoLayerDue, atMs: number): void {
  if (layer === "pc") doPrestigeceptionMut(s, atMs);
  else if (layer === "fleet") doFleetMut(s, atMs);
  else if (layer === "captain") doCaptainMut(s, atMs);
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
    case "starfall":
      return e() >= STARFALL_EXPONENT;
  }
}

const MILESTONE_IDS: readonly MilestoneId[] = [
  "firstCaptain", "googol", "firstFleet", "e1000", "singularity", "firstPc", "turbo", "e100k", "allSkills", "finale", "long", "starfall",
];

// The Ore goals, in order: each appears only once the one before it is reached (0.13.11.1).
const ORE_CHAIN: readonly MilestoneId[] = ["googol", "e1000", "e100k", "finale", "long", "starfall"];

// Is a milestone shown, or still "???"? Reached ones always show. Ore goals appear one step at a
// time; the rest appear once their system is in view (design 0.13.11.1 section 5).
export function milestoneVisible(s: SecretState, id: MilestoneId): boolean {
  if (s.milestones[id] !== undefined) return true;
  const chain = ORE_CHAIN.indexOf(id);
  if (chain >= 0) return chain === 0 || s.milestones[ORE_CHAIN[chain - 1]] !== undefined;
  switch (id) {
    case "firstCaptain":
    case "turbo":
      return true;
    case "firstFleet":
      return s.captainCount > 0 || s.fleetTotal > 0;
    case "firstPc":
    case "allSkills":
      return s.fleetTotal > 0;
    case "singularity":
      return isTierUnlocked(s, TIER_COUNT - 1);
    default:
      return false;
  }
}

// The combo has unlocked the game (first success only sets the date).
export function markFound(s: SecretState, atMs: number): SecretState {
  if (s.found) return s;
  return { ...cloneSecret(s), found: true, foundAt: s.foundAt ?? atMs };
}

// Keeps the Stats peaks: the most of each tier ever owned and the highest Overclock.
function trackPeaksMut(s: SecretState): void {
  for (let k = 0; k < s.tiersUnlocked; k++) if (s.owned[k].gt(s.peakOwned[k])) s.peakOwned[k] = s.owned[k];
  if (s.overclock > s.peakOverclock) s.peakOverclock = s.overclock;
}

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

// productionDt lets a coarse catch-up step produce a little longer than the time it books (its
// fairness margin) without moving the run clock, the peaks or the prestige checks off real time.
// An automatic prestige that reached its target by the START of a step fires at the END of it, after
// that step's production. So every run gets one full step past its target, and since a catch-up
// step is never shorter than a live one, a catch-up never cuts a run shorter than live play would
// (catchUp.test.ts: never pays less).
export function stepMut(s: SecretState, dt: number, atMs: number, productionDt: number = dt): void {
  ensureRecoverableMut(s);
  const due = dueAutoPrestige(s);
  autoBuyMut(s);
  produceMut(s, productionDt);
  s.runSeconds += dt;
  if (s.ore.gt(s.runPeak)) s.runPeak = s.ore;
  if (s.ore.gt(s.fleetPeak)) s.fleetPeak = s.ore;
  if (s.ore.gt(s.pcPeak)) s.pcPeak = s.ore;
  if (s.ore.gt(s.bestOre)) s.bestOre = s.ore;
  trackPeaksMut(s);
  firePrestigeMut(s, due, atMs);
  checkMilestonesMut(s, atMs);
}

export function step(s: SecretState, dt: number, atMs: number): SecretState {
  const next = cloneSecret(s);
  stepMut(next, dt, atMs);
  return next;
}
