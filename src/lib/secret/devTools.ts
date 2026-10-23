// devTools.ts: [DEV] shortcuts for testing the minigame (0.13.11.1). Debug tab only: App reaches this
// module through a dynamic import behind the compile-time DEV_MODE gate, so it never ships in a
// production bundle.
//
// The jumps build INTERNALLY CONSISTENT states, not just a big Ore number: generator counts, owned
// amounts and Overclock are scaled from the steady player's real state at e1,000,000 (pacing sim,
// day 30: bought = 10 x raw exponent / price step per tier, owned exponents a fixed share of it,
// Overclock about 1.22 x the raw exponent, income about the Ore itself), prestige currencies sit
// just above what an automatic prestige would pay so nothing resets on arrival, and every milestone
// up to the target is recorded (milestones already earned keep their dates).

import Decimal from "break_infinity.js";
import { cloneSecret, type SecretState } from "./state";
import { markFound, pow10, unsoftenExponent, checkMilestonesMut, stepMut, effectiveExponent } from "./engine";
import { SKILLS, TIERS, TIER_COUNT, UPGRADES, STARFALL_EXPONENT } from "./config";

export function devMarkFound(s: SecretState, atMs: number): SecretState {
  return markFound(s, atMs);
}

export function devMaxSkills(s: SecretState, atMs: number): SecretState {
  const next = cloneSecret(s);
  for (const d of SKILLS) {
    next.skills[d.id] = true;
    if (d.auto) next.autoOn[d.id] = true;
  }
  checkMilestonesMut(next, atMs);
  return next;
}

// Owned exponent per tier as a share of the raw Ore exponent (the e1,000,000 sim state).
const OWNED_SHARE = [0.77591, 0.62797, 0.49715, 0.37774, 0.27261, 0.17603, 0.08516];
const OC_SHARE = 1.21858;

interface Layers {
  captainPoints: number;
  augmentPoints: number;
  dreamPoints: number;
  captainCount: number;
  fleetCount: number;
  fleetTotal: number;
  pcCount: number;
}

// Taken from the pacing sim near each stop, then nudged above the automatic-prestige gain there.
const AT_LONG: Layers = { captainPoints: 1.812e8, augmentPoints: 5.507e6, dreamPoints: 1.756e6, captainCount: 650, fleetCount: 13, fleetTotal: 72, pcCount: 7 };
const AT_STARFALL: Layers = { captainPoints: 4e9, augmentPoints: 1.6e8, dreamPoints: 2.8e7, captainCount: 935, fleetCount: 12, fleetTotal: 122, pcCount: 11 };

// The upgrades change where a run settles (a maxed Tenfold Tuner lifts it about a third), so the
// jump builds the state, lets the real engine run it for SETTLE_SECONDS, measures where it settled,
// rebuilds that much lower, and settles again: the result is a state the engine itself produced,
// sitting just past the target.
const SETTLE_SECONDS = 30;

export function devJumpTo(s: SecretState, effectiveTarget: number, atMs: number): SecretState {
  const goal = unsoftenExponent(effectiveTarget);
  let raw = goal + 1000;
  let out = settle(build(s, effectiveTarget, raw, atMs - SETTLE_SECONDS * 1000), atMs);
  for (let i = 0; i < 4 && (effectiveExponent(out.ore) < effectiveTarget || out.ore.log10() > goal * 1.0002); i++) {
    raw = raw * (goal / out.ore.log10()) * (1 + 0.00005 * (i + 1));
    out = settle(build(s, effectiveTarget, raw, atMs - SETTLE_SECONDS * 1000), atMs);
  }
  return out;
}

function settle(x: SecretState, atMs: number): SecretState {
  const start = x.lastTickAt;
  for (let i = 1; i <= SETTLE_SECONDS; i++) stepMut(x, 1, start + i * 1000);
  x.lastTickAt = atMs;
  return x;
}

function build(s: SecretState, effectiveTarget: number, raw: number, atMs: number): SecretState {
  const next = markFound(cloneSecret(s), atMs);
  const out = next === s ? cloneSecret(s) : next;
  const final = effectiveTarget >= STARFALL_EXPONENT;
  const layers = final ? AT_STARFALL : AT_LONG;
  const ocBoost = final ? 1 + UPGRADES.find((u) => u.id === "ocOverclocker")!.step * UPGRADES.find((u) => u.id === "ocOverclocker")!.cap : 1;

  for (const d of SKILLS) {
    out.skills[d.id] = true;
    if (d.auto) out.autoOn[d.id] = true;
  }
  out.tiersUnlocked = TIER_COUNT;
  out.bought = TIERS.map((t) => Math.floor((10 * raw) / t.costStepLog10));
  out.owned = out.bought.map((b, k) => (k < OWNED_SHARE.length ? pow10(raw * OWNED_SHARE[k]) : new Decimal(b)));
  out.peakOwned = out.owned.map((d, k) => Decimal.max(d, s.peakOwned[k] ?? d));
  out.overclock = Math.floor((OC_SHARE * raw) / ocBoost);
  out.peakOverclock = Math.max(out.overclock, s.peakOverclock);
  out.ore = pow10(raw);
  out.lastIncome = out.ore;
  out.runPeak = out.ore;
  out.fleetPeak = out.ore;
  out.pcPeak = out.ore;
  out.bestOre = Decimal.max(out.ore, s.bestOre);
  out.runSeconds = 86400;
  out.captainPoints = new Decimal(layers.captainPoints);
  out.augmentPoints = new Decimal(layers.augmentPoints);
  out.dreamPoints = new Decimal(layers.dreamPoints);
  out.captainCount = Math.max(s.captainCount, layers.captainCount);
  out.fleetTotal = Math.max(s.fleetTotal, layers.fleetTotal);
  out.fleetCount = Math.min(layers.fleetCount, out.fleetTotal);
  out.pcCount = Math.max(s.pcCount, layers.pcCount);
  out.skillPoints = Math.max(0, out.fleetTotal - SKILLS.reduce((n, d) => n + d.cost, 0));
  out.upgrades = { ocOverclocker: 0, tenfoldTuner: 0, captainsCompound: 0, lucidDreaming: 0 };
  if (final) for (const u of UPGRADES) out.upgrades[u.id] = u.cap;
  out.upgradesNoteSeen = false;
  out.lastTickAt = atMs;
  checkMilestonesMut(out, atMs);
  return out;
}
