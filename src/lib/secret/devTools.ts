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
import { markFound, pow10, unsoftenExponent, checkMilestonesMut, stepMut, effectiveExponent, totalSkillCost, skillCostToMax } from "./engine";
import { SKILLS, AUTOMATION_IDS, LEVELED_SKILLS, type LeveledSkillId, TIERS, TIER_COUNT, UPGRADES, STARFALL_EXPONENT, CAPTAIN_BEND } from "./config";

export function devMarkFound(s: SecretState, atMs: number): SecretState {
  return markFound(s, atMs);
}

// Every leveled skill at its cap with the whole schedule paid (0.14.0 Slice 4), and every automation
// unlocked and switched on (Slice 3: they unlock at milestones; this skips the wait).
function maxSkillsMut(s: SecretState): void {
  for (const d of LEVELED_SKILLS) s.skillLevels[d.id] = d.cap;
  s.skillPointsEarned = Math.max(s.skillPointsEarned, totalSkillCost());
  automateAllMut(s);
}

// Switches in the save's own order (the 0.13.11.2 automations first), so a save round-trips byte-identically.
function automateAllMut(s: SecretState): void {
  for (const d of SKILLS) if (d.auto) s.autoOn[d.id] = true;
  for (const id of AUTOMATION_IDS) {
    s.automations[id] = true;
    s.autoOn[id] = true;
  }
}

// The e1,000,000 jump's skills: the average player's levels there (LONG_SKILL_LEVELS), the schedule paid
// that far.
function midSkillsMut(s: SecretState): void {
  for (const d of LEVELED_SKILLS) s.skillLevels[d.id] = Math.min(d.cap, Math.max(s.skillLevels[d.id] ?? 0, LONG_SKILL_LEVELS[d.id] ?? 0));
  s.skillPointsEarned = Math.max(s.skillPointsEarned, totalSkillCost() - skillCostToMax(s));
  // The automations come from the milestones the jump records (checkMilestonesMut in build): Auto-buy
  // Upgrades waits for e2,000,000, as in play.
}

export function devMaxSkills(s: SecretState, atMs: number): SecretState {
  const next = cloneSecret(s);
  maxSkillsMut(next);
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

// Taken from the pacing sim near each stop (0.14.0 combined pacing retune: the average player at e1,000,000
// on day 32 and at e10,000,000 on day 117), above the automatic-prestige gain there.
const AT_LONG: Layers = { captainPoints: 1.131e8, augmentPoints: 5.265e6, dreamPoints: 3.214e5, captainCount: 93, fleetCount: 10, fleetTotal: 29, pcCount: 4 };
const AT_STARFALL: Layers = { captainPoints: 5.235e8, augmentPoints: 6.545e7, dreamPoints: 9.641e5, captainCount: 144, fleetCount: 13, fleetTotal: 43, pcCount: 5 };
// The average player's skill levels at e1,000,000 (the same sim); at e10,000,000 every skill is maxed.
const LONG_SKILL_LEVELS: Readonly<Partial<Record<LeveledSkillId, number>>> = { headStart: 2, tenfoldTraining: 4, overdrive: 3, captainsAcademy: 3, fleetLogistics: 3, lucidPlanning: 2 };

// The upgrades change where a run settles (a maxed Tenfold Tuner lifts it about a third), so the
// jump builds the state, lets the real engine run it for SETTLE_SECONDS, measures where it settled,
// rebuilds that much lower, and settles again: the result is a state the engine itself produced,
// sitting just past the target.
const SETTLE_SECONDS = 30;

export function devJumpTo(s: SecretState, effectiveTarget: number, atMs: number): SecretState {
  const goal = unsoftenExponent(effectiveTarget);
  const at = (raw: number) => settle(build(s, effectiveTarget, raw, atMs - SETTLE_SECONDS * 1000), atMs);
  const short = (x: SecretState) => effectiveExponent(x.ore) < effectiveTarget;
  const over = (x: SecretState) => x.ore.log10() > goal * 1.0002;
  let raw = goal + 1000;
  let out = at(raw);
  // The settled Ore is not proportional to the build (0.14.0: the skills' strength scales with the prestige
  // counts, and Overdrive's power moves where a run settles), so a few proportional steps, then bisection
  // between the closest builds found below and above the goal.
  let lo = 0;
  let hi = Infinity;
  for (let i = 0; i < 40 && (short(out) || over(out)); i++) {
    if (short(out)) lo = Math.max(lo, raw);
    else hi = Math.min(hi, raw);
    raw = i < 4 || !Number.isFinite(hi) || lo === 0 ? raw * (goal / Math.max(1, out.ore.log10())) * (1 + 0.00005 * (i + 1)) : (lo + hi) / 2;
    if (Number.isFinite(hi) && lo > 0 && (raw <= lo || raw >= hi)) raw = (lo + hi) / 2;
    out = at(raw);
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
  // (measured on the 0.195 Captain scale: converted like an old save, the same Captain bonus)
  out.captainPoints = new Decimal(layers.captainPoints).add(1).pow(CAPTAIN_BEND).sub(1);
  out.augmentPoints = new Decimal(layers.augmentPoints);
  out.dreamPoints = new Decimal(layers.dreamPoints);
  out.captainCount = Math.max(s.captainCount, layers.captainCount);
  out.fleetTotal = Math.max(s.fleetTotal, layers.fleetTotal);
  out.fleetCount = Math.min(layers.fleetCount, out.fleetTotal);
  out.pcCount = Math.max(s.pcCount, layers.pcCount);
  if (final) maxSkillsMut(out);
  else midSkillsMut(out);
  // No spare Skill Points on arrival (at e10,000,000 every skill is maxed, so no Fleet pays one any more).
  out.skillPoints = 0;
  out.upgrades = { ocOverclocker: 0, tenfoldTuner: 0, captainsCompound: 0, lucidDreaming: 0, turboEncabulator: 0, overdriveOverdrive: 0, singularitySharpener: 0 };
  if (final) for (const u of UPGRADES) out.upgrades[u.id] = u.cap;
  out.upgradesNoteSeen = false;
  out.lastTickAt = atMs;
  checkMilestonesMut(out, atMs);
  return out;
}
