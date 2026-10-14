// Objective affixes (AF-1; docs/plans/2026-10-14-objective-affixes-capture.md, user 2026-10-14): a REUSABLE
// affix system. "Affixes. ... a new system that we should honestly make use of elsewhere in the project too."
// Pure building blocks; nothing here advances a run (groundOps.ts stamps, rolls and applies them).
//
//   AN AFFIX (AffixDef) has an id, a name, its own MAXIMUM RANK (Reinforcing goes to X; "other affixes won't have a
//   ton of different levels for balancing reasons", user), the ALIGNMENTS it may roll (positive / neutral /
//   negative; it rolls exactly one: "Some can roll into more than one, but only one at a time"), where it applies
//   (combat or calm objectives today; other systems later), tier and difficulty gates, a roll weight, a short
//   tooltip and a Help entry, and its mechanical HOOKS (data: the engine reads them through the readers below, so
//   a new affix plugs in by data plus the hook it needs).
//   AN INSTANCE (model.ts ObjectiveAffix) is { id, rank, alignment }, stamped on an objective once, when its body's
//   scan completes, and fixed for the run.
//   ALIGNMENT COLORS (user: "color coded with green/yellow/red"): positive green, neutral yellow, negative red
//   (affixColorClass, for the UI's pills).
//   POOLS are keyed by (region tier, difficulty grade, difficulty tier): `difficultyTier` is the hook for the future
//   difficulty tiers (user: "build anything that might be needed in the future"); every run is at the BASE tier
//   today (riskFactors.ts BASE_DIFFICULTY_TIER) and nothing else is built for it.
//
// REINFORCING (always negative; user): "The faction occupying this point is quick to reinforce their teams. This
// will lead to a random chance of additional battles to clear out this objective ... should you retreat or fail
// this mission, the compliment of enemy forces will be reinforced before your next visit."
//   - REQUIRED on Deadly combat objectives; rolls rarely on easier combat objectives and more rarely on early tiers
//     ("Early planets will seldom have this, if at all, unless the roll gets it").
//   - Ranks I to X. Per VISIT (a crew's landing), a chance of reinforcements, then 1 to the rank's maximum EXTRA
//     BATTLES, weighted toward fewer (REINFORCING_RANKS: I 25%, II 35%, III 40% (user), X 50% (user's example); up
//     to 1 / 1 / 2 / 2 / 3 / 3 / 4 / 4 / 5 / 5 battles; REINFORCEMENT_COUNT_WEIGHTS) [PROVISIONAL tables]. They
//     strike MID-WORK at random points along the progress bar, like ambushes (user). Ranks above III are rare and
//     gated by tier and difficulty; the top ranks belong mainly to the future difficulty tiers (user).
//   - THE ALERT: every retreat or wipe here raises the objective's alert level by one. Per level each fight fields
//     one more enemy and the enemies gain a stacking HEIGHTENED SENSES damage buff on the D23 curve (never capped,
//     each stack worth a bit less), and the difficulty rating rises. The alert lapses RESET seconds after the last
//     setback ("the threat appears to have retreated"; longer at higher ranks) [PROVISIONAL numbers].
//   - THE FAILSAFE (user: "trigger a failsafe for a team so they don't keep resetting and failing"): once the alert
//     pushes the rating to IMPOSSIBLE the objective is HELD: no crew starts it (it is not skipped) until the alert
//     resets; objectiveHeldUntil gives the UI its countdown. Then it returns to normal and is workable again.
//   The alert is a pure function of the stored record ({ level, lastAt }) and the time, so offline == live.
//
// ROCKY OUTCROPPINGS (AF-2; positive, neutral or negative; user): "Rocky Outcroppings that provide additional cover
// which increases evasion against long-range weaponry by 15% for both sides of combat, or perhaps for one side as a
// good or bad version ... If it's positive, you get the evasion. If neutral, both get it, if negative, the enemy gets
// it." Combat objectives only; ranks I to III (15% at rank I, user; small steps after) [PROVISIONAL]. In the
// objective's fights the covered side evades that share of LONG-RANGE attacks (gambit.ts GroundRange: the hit
// chance of a long-range strike on a covered combatant x (1 - evasion), the same single hit-check draw).
//
// THE CATALOG VERSION (AF-2): every affix carries the catalog version that introduced it (AffixDef.catalog); a run
// stamps from its own version (riskFactors.ts runAffixCatalog: an affix-aware run dispatched before AF-2 reads 1),
// so its pool and its draw layout are exactly the ones it was dispatched with.
//
// DETERMINISM: two salts, both on the run's own seed and keyed, never a shared stream:
//   AFFIX_ROLL_SALT     the stamping roll, keyed by (body index, the objective's index on its body);
//   REINFORCEMENT_SALT  the per-visit reinforcement roll, keyed by (the objective's flat index, its visit count).
// Each roll uses a FIXED draw layout (documented at the function), so a later affix appends draws, never shifts one.
//
// Module graph: model (types), combat/rng, diminishing, riskFactors. Imported by groundOps.ts; imports none of the
// ground modules.

import type { AffixAlignment, AffixId, ExpeditionActivity, ExpeditionPlanetType, ObjectiveAffix, ObjectiveAlert, RegionTier } from "./model";
import { makeRng, type Rng } from "./combat/rng";
import { diminishing } from "./diminishing";
import { AFFIX_CATALOG_VERSION, BASE_DIFFICULTY_TIER, DIFFICULTY_NAMES, difficultyGradeOf } from "./riskFactors";

export type { AffixAlignment, AffixId, ObjectiveAffix, ObjectiveAlert };

// ===== Salts =====

// The stamping roll's stream salt: odd, distinct from every engine salt (salts.test.ts checks it).
export const AFFIX_ROLL_SALT = 0x6b8d2f4b;
// The per-visit reinforcement roll's stream salt: odd, distinct (salts.test.ts).
export const REINFORCEMENT_SALT = 0x1f4e9a73;

// ===== Alignments and their colors (user: green / yellow / red) =====

export const AFFIX_ALIGNMENTS: readonly AffixAlignment[] = ["positive", "neutral", "negative"];
export type AffixColor = "green" | "yellow" | "red";
export const AFFIX_ALIGNMENT_COLORS: Readonly<Record<AffixAlignment, AffixColor>> = {
  positive: "green",
  neutral: "yellow",
  negative: "red",
};
export const AFFIX_ALIGNMENT_NAMES: Readonly<Record<AffixAlignment, string>> = {
  positive: "Positive",
  neutral: "Neutral",
  negative: "Negative",
};

// The color class of an alignment (the UI's pill reads it). Pure.
export function affixColorClass(alignment: AffixAlignment): AffixColor {
  return AFFIX_ALIGNMENT_COLORS[alignment];
}

// ===== Definitions =====

// Where an affix can apply: a COMBAT objective (at least one fight point) or a CALM one (none). Other systems
// (patrols, campaigns) add targets later.
export type AffixTarget = "combatObjective" | "calmObjective";

// The mechanical hooks an affix may carry, as data per rank (index 0 = rank I). The engine reads them through the
// readers below; an affix without a hook simply has no effect there.
export interface AffixHooks {
  // A chance per VISIT of extra battles, and the most extra battles one visit can bring.
  extraBattleChanceByRank?: readonly number[];
  maxExtraBattlesByRank?: readonly number[];
  // Every retreat or wipe raises the objective's ALERT; it lapses this many seconds after the last setback.
  alertResetSecondsByRank?: readonly number[];
  // AF-2: EVASION against LONG-RANGE attacks (a fraction) for the side(s) the instance's alignment covers:
  // positive the player's squad, neutral both sides, negative the enemy (longRangeCover).
  longRangeEvasionByRank?: readonly number[];
}

export interface AffixDef {
  id: AffixId;
  name: string;
  catalog: number; // the affix catalog version that introduced it (riskFactors.ts AFFIX_CATALOG_VERSION; AF-2)
  maxRank: number; // per affix (user: Reinforcing to X, others only a few)
  alignments: readonly AffixAlignment[]; // the alignments it may roll (exactly one per instance)
  appliesTo: readonly AffixTarget[];
  minTier: RegionTier; // never rolls below this region tier
  minDifficulty: number; // never ROLLS below this difficulty grade (1 Simple .. 5 Deadly)
  requiredFromDifficulty?: number; // always carried at this grade and above (Reinforcing: Deadly)
  rollWeight: number; // its weight among the eligible affixes of a pool (the flat default; see weightFor)
  // The PER-CONTEXT weight hook (user 2026-10-14, section 7: "we may end up having different chances of rolling
  // different affixes for different difficulties, planet types, tiers, etc."): when present, the affix's weight in
  // a pool is weightFor(context) instead of rollWeight. Absent on every affix today, so every pool reads its flat
  // rollWeight and every catalog rolls exactly as before. Read through affixRollWeight.
  weightFor?: (context: AffixRollContext) => number;
  tooltip: (instance: ObjectiveAffix) => string; // the short line (pill tooltip)
  help: string; // the Help entry (the manual explains it in full)
  hooks: AffixHooks;
}

// REINFORCING by rank I..X [PROVISIONAL table; the user may retune it]: the chance of reinforcements per visit,
// the most extra battles they bring, and how long the alert takes to lapse after the last setback.
export const REINFORCING_RANKS: readonly { chance: number; maxBattles: number; resetSeconds: number }[] = [
  { chance: 0.25, maxBattles: 1, resetSeconds: 1800 }, // I (user: 25%)
  { chance: 0.35, maxBattles: 1, resetSeconds: 2400 }, // II (user: 35%)
  { chance: 0.4, maxBattles: 2, resetSeconds: 3000 }, // III (user: 40%)
  { chance: 0.42, maxBattles: 2, resetSeconds: 3600 }, // IV
  { chance: 0.44, maxBattles: 3, resetSeconds: 4200 }, // V
  { chance: 0.46, maxBattles: 3, resetSeconds: 4800 }, // VI
  { chance: 0.47, maxBattles: 4, resetSeconds: 5400 }, // VII
  { chance: 0.48, maxBattles: 4, resetSeconds: 6000 }, // VIII
  { chance: 0.49, maxBattles: 5, resetSeconds: 6600 }, // IX
  { chance: 0.5, maxBattles: 5, resetSeconds: 7200 }, // X (user's example: 50%, up to 5)
];

const ROMAN: readonly string[] = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

// "III" for rank 3 (ranks past the table read as a plain number). Pure.
export function rankNumeral(rank: number): string {
  return ROMAN[rank - 1] ?? String(rank);
}

// "30m", "1h 30m" (whole minutes). Pure.
function minutesText(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return m % 60 === 0 ? `${h}h` : `${h}h ${m % 60}m`;
}

// The Reinforcing row of a rank (clamped to the table). Pure.
function reinforcingRow(rank: number): (typeof REINFORCING_RANKS)[number] {
  return REINFORCING_RANKS[Math.max(0, Math.min(REINFORCING_RANKS.length - 1, Math.floor(rank) - 1))];
}

// ROCKY OUTCROPPINGS by rank I..III: the evasion against long-range attacks (user: 15% at rank I; small steps
// after) [PROVISIONAL], and its roll weight among a pool's rollable affixes (Reinforcing's is 100) [PROVISIONAL].
export const ROCKY_OUTCROPPINGS_EVASION: readonly number[] = [0.15, 0.18, 0.21];
export const ROCKY_OUTCROPPINGS_ROLL_WEIGHT = 100;

// The Rocky Outcroppings evasion of a rank (clamped to the table). Pure.
function outcroppingsEvasion(rank: number): number {
  return ROCKY_OUTCROPPINGS_EVASION[Math.max(0, Math.min(ROCKY_OUTCROPPINGS_EVASION.length - 1, Math.floor(rank) - 1))];
}

// The name of the escalation's damage buff (user: "a heightened senses buff that gives them additional stacking
// damage until the alert wears off").
export const HEIGHTENED_SENSES_NAME = "Heightened Senses";

export const AFFIX_DEFS: Readonly<Record<AffixId, AffixDef>> = {
  reinforcing: {
    id: "reinforcing",
    name: "Reinforcing",
    catalog: 1,
    maxRank: REINFORCING_RANKS.length,
    alignments: ["negative"], // always negative (user)
    appliesTo: ["combatObjective"],
    minTier: 1,
    minDifficulty: 1, // "even easier combat-related options can roll the Reinforcing affix" (user)
    requiredFromDifficulty: 5, // Deadly (user)
    rollWeight: 100,
    tooltip: (a) => {
      const row = reinforcingRow(a.rank);
      const battles = row.maxBattles === 1 ? "an extra battle" : `up to ${row.maxBattles} extra battles`;
      return (
        `Quick to reinforce: a ${Math.round(row.chance * 100)}% chance of ${battles} during each visit. ` +
        `A retreat or wipe here puts the objective on alert (more enemies, ${HEIGHTENED_SENSES_NAME}) until the threat ` +
        `retreats, ${minutesText(row.resetSeconds)} after the last one.`
      );
    },
    help:
      "Reinforcing: the faction holding this objective is quick to reinforce its teams. Each time a crew goes in there " +
      "is a chance that reinforcements arrive while it works, forcing one or more extra battles where they strike " +
      "(usually one; higher ranks raise both the chance and how many battles can come). Should your crew retreat or be wiped out, the " +
      "objective goes on ALERT: every fight there fields one more enemy per alert level, and the enemies gain " +
      `${HEIGHTENED_SENSES_NAME}, extra damage that stacks with each level (each stack is worth a little less). The ` +
      "objective's difficulty rating rises with the alert. If it reaches Impossible, your teams stop trying it and " +
      "move on; it waits, not skipped, with a countdown. The alert wears off a while after the last setback (longer " +
      "at higher ranks): the threat appears to have retreated, and the objective returns to normal. Deadly combat " +
      "objectives always carry Reinforcing; easier ones can roll it, rarely, and early planets seldom see it.",
    hooks: {
      extraBattleChanceByRank: REINFORCING_RANKS.map((r) => r.chance),
      maxExtraBattlesByRank: REINFORCING_RANKS.map((r) => r.maxBattles),
      alertResetSecondsByRank: REINFORCING_RANKS.map((r) => r.resetSeconds),
    },
  },
  rockyOutcroppings: {
    id: "rockyOutcroppings",
    name: "Rocky Outcroppings",
    catalog: 2,
    maxRank: ROCKY_OUTCROPPINGS_EVASION.length,
    alignments: ["positive", "neutral", "negative"], // "Rocky Outcroppings can be all 3" (user)
    appliesTo: ["combatObjective"],
    minTier: 1,
    minDifficulty: 1,
    rollWeight: ROCKY_OUTCROPPINGS_ROLL_WEIGHT,
    tooltip: (a) => {
      const pct = Math.round(outcroppingsEvasion(a.rank) * 100);
      if (a.alignment === "positive") return `Rocky cover favors your squad: it evades ${pct}% of the enemy's long-range attacks.`;
      if (a.alignment === "negative") return `Rocky cover favors the enemy: it evades ${pct}% of your squad's long-range attacks.`;
      return `Rocky cover on both sides: each side evades ${pct}% of the other's long-range attacks.`;
    },
    help:
      "Rocky Outcroppings: the objective is broken ground with plenty of cover. Long-range attacks (rifles, and the " +
      "enemy's gunners, casters and healers) miss more often against whoever holds the cover; short-range attacks " +
      "(scatterguns, batons, sidearms, brawlers and swarms) ignore it. Positive (green): your squad has the cover. " +
      "Neutral (yellow): both sides do. Negative (red): the enemy does. Higher ranks give a little more cover, and " +
      "short-range weapons are the answer to a negative roll.",
    hooks: {
      longRangeEvasionByRank: ROCKY_OUTCROPPINGS_EVASION,
    },
  },
};
// Catalog order: the stamping roll draws per affix in this order (append new affixes at the END; each one's
// draws are made only on runs whose catalog version includes it).
export const AFFIX_ORDER: readonly AffixId[] = ["reinforcing", "rockyOutcroppings"];

// The affixes of catalog version `catalog`, in AFFIX_ORDER. Pure; a fresh array.
export function catalogAffixes(catalog: number = AFFIX_CATALOG_VERSION): AffixId[] {
  return AFFIX_ORDER.filter((id) => AFFIX_DEFS[id].catalog <= catalog);
}

export function isAffixId(id: unknown): id is AffixId {
  return typeof id === "string" && Object.prototype.hasOwnProperty.call(AFFIX_DEFS, id);
}

// "Reinforcing III". Pure.
export function affixLabel(a: Pick<ObjectiveAffix, "id" | "rank">): string {
  const def = AFFIX_DEFS[a.id];
  return def ? `${def.name} ${rankNumeral(a.rank)}` : String(a.id);
}

// The pill a UI draws for an instance: its label, color class and tooltip. Pure.
export function affixPill(a: ObjectiveAffix): { label: string; color: AffixColor; alignment: string; tooltip: string } {
  const def = AFFIX_DEFS[a.id];
  return {
    label: affixLabel(a),
    color: affixColorClass(a.alignment),
    alignment: AFFIX_ALIGNMENT_NAMES[a.alignment],
    tooltip: def ? def.tooltip(a) : "",
  };
}

// The stored affixes that are well formed (a known id, a whole rank within the affix's maximum, an alignment the
// affix allows). Anything else is ignored by every reader. Pure.
export function validAffixes(list: readonly ObjectiveAffix[] | undefined): ObjectiveAffix[] {
  const out: ObjectiveAffix[] = [];
  for (const a of list ?? []) {
    if (!a || !isAffixId(a.id)) continue;
    const def = AFFIX_DEFS[a.id];
    if (!Number.isInteger(a.rank) || a.rank < 1 || a.rank > def.maxRank) continue;
    if (!def.alignments.includes(a.alignment)) continue;
    out.push(a);
  }
  return out;
}

// ===== Pools: (region tier, difficulty, difficulty tier) =====

// The chance an objective ROLLS an affix beyond its required ones [PROVISIONAL]: by difficulty grade (Simple ..
// Deadly) times the region tier's multiplier ("rarer on early tiers").
export const AFFIX_ROLL_CHANCE_BY_DIFFICULTY: readonly number[] = [0.005, 0.01, 0.02, 0.04, 0.06];
export const AFFIX_ROLL_TIER_MULT: Readonly<Record<RegionTier, number>> = { 1: 0.25, 2: 0.5, 3: 1, 4: 1.25, 5: 1.5, 6: 1.75, 7: 2 };
// At most this many ROLLED (not required) affixes per objective [PROVISIONAL].
export const AFFIX_MAX_ROLLED = 1;
// The rank weights by region tier, rank I first, at the BASE difficulty tier [PROVISIONAL]. High ranks are VERY rare
// here (user 2026-10-14: "Ultimately, Reinforcing X won't likely be seen often by anything outside of safety
// interlock max difficulty"): ranks above III only from Tier IV, IX and X only at Tier VII at 1% each. The top
// ranks belong to the future difficulty tiers.
export const AFFIX_RANK_WEIGHTS_BY_TIER: Readonly<Record<RegionTier, readonly number[]>> = {
  1: [100],
  2: [90, 10],
  3: [70, 22, 8],
  4: [55, 28, 12, 4, 1],
  5: [45, 28, 15, 7, 3, 1, 1],
  6: [38, 27, 17, 9, 5, 2, 1, 1],
  7: [30, 24, 18, 11, 7, 4, 3, 1, 1, 1],
};
// The highest rank an objective of each difficulty grade can carry, Simple .. Deadly [PROVISIONAL]: the high ranks
// need the hard objectives too.
export const AFFIX_RANK_CAP_BY_DIFFICULTY: readonly number[] = [1, 2, 3, 5, 10];

// The FUTURE DIFFICULTY TIERS hook: a tier's multiplier on the roll chance. Only the base tier exists today; any
// other value reads as the base tier until the difficulty system is designed (nothing else is built for it).
export const DIFFICULTY_TIER_ROLL_MULT: Readonly<Record<number, number>> = { [BASE_DIFFICULTY_TIER]: 1 };
export function difficultyTierRollMult(difficultyTier: number): number {
  return DIFFICULTY_TIER_ROLL_MULT[difficultyTier] ?? DIFFICULTY_TIER_ROLL_MULT[BASE_DIFFICULTY_TIER];
}

export interface AffixPool {
  rollChance: number; // the chance of a rolled affix (beyond the required ones)
  required: AffixId[]; // always carried, catalog order
  entries: { id: AffixId; weight: number }[]; // the rollable affixes (never a required one), catalog order
  rankWeights: readonly number[]; // rank I first, before each affix's own maximum
  rankCap: number;
}

// The context an affix's roll weight may depend on (AffixDef.weightFor): the region tier, the objective's difficulty
// grade, the run's difficulty tier, the body's planet type (absent when the caller has none) and the target.
export interface AffixRollContext {
  tier: RegionTier;
  difficulty: number;
  difficultyTier: number;
  planetType?: ExpeditionPlanetType;
  target: AffixTarget;
}

// An affix's roll weight in `context`: its weightFor hook when it has one, else its flat rollWeight. A weight that
// is not a positive finite number reads 0 (the affix does not roll there). Pure.
export function affixRollWeight(def: Pick<AffixDef, "rollWeight" | "weightFor">, context: AffixRollContext): number {
  const w = def.weightFor ? def.weightFor(context) : def.rollWeight;
  // Whole numbers only (drawWeighted draws integers): a fraction floors, so 0.5 reads 0 and never rolls.
  return typeof w === "number" && Number.isFinite(w) && w >= 1 ? Math.floor(w) : 0;
}

// Clamp to a region tier. Pure.
function tierOf(tier: number): RegionTier {
  return Math.max(1, Math.min(7, Math.floor(Number.isFinite(tier) ? tier : 1))) as RegionTier;
}

// The pool of an objective (see the header). `difficulty` is its grade 1..5; `catalog` the run's affix catalog
// version (AF-2; default the current one): only the affixes of that version are in the pool; `planetType` the body's
// (AF-2 follow-up: part of the per-context weight hook's context, affixRollWeight). Pure; fresh arrays.
export function affixPool(
  tier: number,
  difficulty: number,
  difficultyTier: number,
  target: AffixTarget,
  catalog: number = AFFIX_CATALOG_VERSION,
  planetType?: ExpeditionPlanetType,
): AffixPool {
  const t = tierOf(tier);
  const d = Math.max(1, Math.min(AFFIX_ROLL_CHANCE_BY_DIFFICULTY.length, Math.floor(Number.isFinite(difficulty) ? difficulty : 1)));
  const required: AffixId[] = [];
  const entries: { id: AffixId; weight: number }[] = [];
  for (const id of catalogAffixes(catalog)) {
    const def = AFFIX_DEFS[id];
    if (!def.appliesTo.includes(target)) continue;
    if (def.requiredFromDifficulty !== undefined && d >= def.requiredFromDifficulty) {
      required.push(id);
      continue;
    }
    const context: AffixRollContext = { tier: t, difficulty: d, difficultyTier, target };
    if (planetType !== undefined) context.planetType = planetType;
    const weight = affixRollWeight(def, context);
    if (t < def.minTier || d < def.minDifficulty || !(weight > 0)) continue;
    entries.push({ id, weight });
  }
  return {
    rollChance: AFFIX_ROLL_CHANCE_BY_DIFFICULTY[d - 1] * AFFIX_ROLL_TIER_MULT[t] * difficultyTierRollMult(difficultyTier),
    required,
    entries,
    rankWeights: AFFIX_RANK_WEIGHTS_BY_TIER[t],
    rankCap: AFFIX_RANK_CAP_BY_DIFFICULTY[d - 1],
  };
}

// ===== The stamping roll =====

// The stamping roll's stream seed (see the header). Pure.
export function affixRollSeed(seed: number, bodyIndex: number, taskIndex: number): number {
  return (seed ^ AFFIX_ROLL_SALT ^ Math.imul(bodyIndex + 1, 0x9e3779b9) ^ Math.imul(taskIndex + 1, 0x85ebca6b)) >>> 0;
}

// combat/rng.ts's INTEGER-FIRST contract (the GO-8 review's): every outcome draw is an integer. A chance is drawn
// as nextInt(AFFIX_DRAW_UNITS) and passes when below the chance in the same units (affixChanceUnits, rounded); a
// weighted pick is nextInt(the weights' total) walked down the (whole-number) weights. One step per draw.
export const AFFIX_DRAW_UNITS = 1_000_000;

// A chance in [0, 1] in draw units (rounded; out of range or NaN clamps). Pure.
export function affixChanceUnits(chance: number): number {
  const p = Number.isFinite(chance) ? Math.max(0, Math.min(1, chance)) : 0;
  return Math.round(p * AFFIX_DRAW_UNITS);
}

// The weights' total (whole, non-negative parts only). Pure.
function weightTotal(weights: readonly number[]): number {
  let total = 0;
  for (const w of weights) total += Math.max(0, Math.floor(w));
  return total;
}

// ONE weighted pick: a single integer draw over the weights' total (at least 1, so the draw is always made), walked
// down the weights. Advances the rng by exactly one step. Pure otherwise.
function drawWeighted(rng: Rng, weights: readonly number[]): number {
  let roll = rng.nextInt(Math.max(1, weightTotal(weights)));
  for (let i = 0; i < weights.length; i += 1) {
    roll -= Math.max(0, Math.floor(weights[i]));
    if (roll < 0) return i;
  }
  return Math.max(0, weights.length - 1);
}

export interface AffixRollInput {
  seed: number;
  bodyIndex: number;
  taskIndex: number; // the objective's index among its body's activities
  tier: number;
  difficulty: number; // the stamped grade 1..5
  difficultyTier: number;
  combat: boolean; // the objective holds at least one fight point
  catalog?: number; // the run's affix catalog version (AF-2; riskFactors.ts runAffixCatalog); default the current one
  planetType?: ExpeditionPlanetType; // the body's (the per-context weight hook's context; AF-2 follow-up)
}

// The affixes an objective is stamped with: every REQUIRED affix of its pool, then at most AFFIX_MAX_ROLLED rolled
// one. FIXED DRAW LAYOUT on makeRng(affixRollSeed), integer draws only: draw 1 = whether an affix rolls
// (nextInt(AFFIX_DRAW_UNITS) < affixChanceUnits(rollChance)), draw 2 = which (one weighted pick among the pool's
// entries), then for EVERY affix of the run's catalog (catalogAffixes, AFFIX_ORDER) two draws, its rank (one
// weighted pick over the pool's rank weights up to min(its maxRank, the pool's cap)) and its alignment (nextInt over
// its alignments), used only by the affixes it carries. Required affixes first, then the rolled one, catalog order.
// A catalog 1 run (dispatched before AF-2) draws exactly AF-1's layout. Pure.
export function rollObjectiveAffixes(input: AffixRollInput): ObjectiveAffix[] {
  const catalog = input.catalog ?? AFFIX_CATALOG_VERSION;
  const target: AffixTarget = input.combat ? "combatObjective" : "calmObjective";
  const pool = affixPool(input.tier, input.difficulty, input.difficultyTier, target, catalog, input.planetType);
  const rng: Rng = makeRng(affixRollSeed(input.seed, input.bodyIndex, input.taskIndex));
  const hit = rng.nextInt(AFFIX_DRAW_UNITS) < affixChanceUnits(pool.rollChance);
  const pick = drawWeighted(rng, pool.entries.map((e) => e.weight));
  const drawn = new Map<AffixId, ObjectiveAffix>();
  for (const id of catalogAffixes(catalog)) {
    const def = AFFIX_DEFS[id];
    const top = Math.max(1, Math.min(def.maxRank, pool.rankCap, pool.rankWeights.length));
    const rank = 1 + drawWeighted(rng, pool.rankWeights.slice(0, top));
    const alignment = def.alignments[rng.nextInt(Math.max(1, def.alignments.length))];
    drawn.set(id, { id, rank, alignment });
  }
  const out = pool.required.map((id) => ({ ...(drawn.get(id) as ObjectiveAffix) }));
  if (hit && AFFIX_MAX_ROLLED > 0 && pool.entries.length > 0) out.push({ ...(drawn.get(pool.entries[pick].id) as ObjectiveAffix) });
  return out;
}

// ===== Hook readers =====

// The value of a per-rank hook for one instance (clamped to the table), or undefined. Pure.
function hookAt(table: readonly number[] | undefined, rank: number): number | undefined {
  if (!table || table.length === 0) return undefined;
  return table[Math.max(0, Math.min(table.length - 1, Math.floor(rank) - 1))];
}

// The chance a visit brings reinforcements: independent chances combined, 1 - prod(1 - c) (0 with none). Pure.
export function extraBattleChance(list: readonly ObjectiveAffix[] | undefined): number {
  let miss = 1;
  for (const a of validAffixes(list)) {
    const c = hookAt(AFFIX_DEFS[a.id].hooks.extraBattleChanceByRank, a.rank);
    if (c !== undefined && c > 0) miss *= 1 - Math.min(1, c);
  }
  return 1 - miss;
}

// The most extra battles one visit can bring (the largest of the affixes'; 0 with none). Pure.
export function maxExtraBattles(list: readonly ObjectiveAffix[] | undefined): number {
  let most = 0;
  for (const a of validAffixes(list)) {
    const n = hookAt(AFFIX_DEFS[a.id].hooks.maxExtraBattlesByRank, a.rank);
    if (n !== undefined && n > most) most = Math.floor(n);
  }
  return most;
}

// How long an alert lasts after the last setback (the longest of the affixes'), or 0 when none raises one. Pure.
export function alertResetSeconds(list: readonly ObjectiveAffix[] | undefined): number {
  let most = 0;
  for (const a of validAffixes(list)) {
    const s = hookAt(AFFIX_DEFS[a.id].hooks.alertResetSecondsByRank, a.rank);
    if (s !== undefined && s > most) most = s;
  }
  return most;
}

// Does a retreat or wipe on this objective raise its alert? Pure.
export function raisesAlert(list: readonly ObjectiveAffix[] | undefined): boolean {
  return alertResetSeconds(list) > 0;
}

// AF-2: the evasion against LONG-RANGE attacks each side of the objective's fights has: `team` the player's squad,
// `enemy` the guard. A positive instance covers the team, a neutral one both sides, a negative one the enemy;
// several instances combine as independent chances (1 - prod(1 - e), folded as c + e - c * e so one instance reads
// its table value exactly), never capped (D23). { 0, 0 } with none. Pure.
export interface GroundCover {
  team: number;
  enemy: number;
}
export function longRangeCover(list: readonly ObjectiveAffix[] | undefined): GroundCover {
  let team = 0;
  let enemy = 0;
  for (const a of validAffixes(list)) {
    const raw = hookAt(AFFIX_DEFS[a.id].hooks.longRangeEvasionByRank, a.rank);
    if (raw === undefined || !(raw > 0)) continue;
    const e = Math.min(1, raw);
    if (a.alignment !== "negative") team = team + e - team * e;
    if (a.alignment !== "positive") enemy = enemy + e - enemy * e;
  }
  return { team, enemy };
}

// Does the cover change anything (either side above 0)? Pure.
export function hasCover(cover: GroundCover | undefined): cover is GroundCover {
  return !!cover && (cover.team > 0 || cover.enemy > 0);
}

// ===== The per-visit reinforcement roll =====

// Its stream seed (see the header). Pure.
export function reinforcementSeed(seed: number, flatIndex: number, visit: number): number {
  return (seed ^ REINFORCEMENT_SALT ^ Math.imul(flatIndex + 1, 0x9e3779b9) ^ Math.imul(visit + 1, 0x85ebca6b)) >>> 0;
}

// How many extra battles a visit brings is WEIGHTED TOWARD FEWER (user 2026-10-14: 1 most likely, the rank's
// maximum rarest): the weights of 1, 2, 3, 4, 5 battles, cut at the rank's maximum [PROVISIONAL]. With a maximum of
// 2: 1 battle 2 / 3 of the time; with 5: 1 battle half the time, 5 battles 4%.
export const REINFORCEMENT_COUNT_WEIGHTS: readonly number[] = [50, 25, 13, 8, 4];

// The extra battles visit number `visit` (0 = the first landing) brings, as their STRIKE POINTS: ascending
// fractions in (0, 1) of the progress the visit still has ahead (0 = where the crew landed, 1 = the objective's
// end; user 2026-10-14: they strike MID-WORK, "at random points along the progress bar", like ambushes). [] = none.
// FIXED DRAW LAYOUT on makeRng(reinforcementSeed), integer draws only: draw 1 = whether reinforcements come
// (nextInt(AFFIX_DRAW_UNITS) < affixChanceUnits(extraBattleChance)), draw 2 = how many (one weighted pick over
// REINFORCEMENT_COUNT_WEIGHTS up to maxExtraBattles), then maxExtraBattles draws nextInt(AFFIX_DRAW_UNITS), one
// strike point each, ALWAYS made (the first `count` are used). No affix with the hook: [], no draw. Pure.
export function rollReinforcements(seed: number, flatIndex: number, visit: number, list: readonly ObjectiveAffix[] | undefined): number[] {
  const chance = extraBattleChance(list);
  const max = maxExtraBattles(list);
  if (!(chance > 0) || max < 1) return [];
  const rng = makeRng(reinforcementSeed(seed, flatIndex, visit));
  const hit = rng.nextInt(AFFIX_DRAW_UNITS) < affixChanceUnits(chance);
  const count = 1 + drawWeighted(rng, REINFORCEMENT_COUNT_WEIGHTS.slice(0, max));
  const points: number[] = [];
  for (let k = 0; k < max; k += 1) points.push((rng.nextInt(AFFIX_DRAW_UNITS) + 0.5) / AFFIX_DRAW_UNITS);
  return hit ? points.slice(0, count).sort((a, b) => a - b) : [];
}

// ===== The alert (Reinforcing) =====

// The escalation per alert level [PROVISIONAL]: each fight fields this many more enemies, and the enemies' damage
// rises by HEIGHTENED_SENSES_PER_LEVEL per level through the D23 curve (knee HEIGHTENED_SENSES_KNEE): +18% at one
// level, +34% at two, +48% at three, still rising after.
export const ESCALATION_ENEMIES_PER_LEVEL = 1;
export const HEIGHTENED_SENSES_PER_LEVEL = 0.2;
export const HEIGHTENED_SENSES_KNEE = 1;
// The difficulty SCORE one alert level adds, and the score at which an alerted objective reads IMPOSSIBLE (one
// past Deadly's band: a score 8 Deadly objective after 3 setbacks, a score 10 one after 1) [PROVISIONAL].
export const ALERT_DIFFICULTY_PER_LEVEL = 1;
export const IMPOSSIBLE_DIFFICULTY_SCORE = 11;
export const IMPOSSIBLE_GRADE = 6;
export const IMPOSSIBLE_DIFFICULTY_NAME = "Impossible";
// The user's words when an alert lapses.
export const ALERT_RESET_TEXT = "the threat appears to have retreated";

type AlertTask = Pick<ExpeditionActivity, "affixes" | "alert">;

// When the objective's stored alert lapses (lastAt + its reset time), or null with no alert. Pure.
export function alertResetsAt(task: AlertTask): number | null {
  const a = task.alert;
  if (!a || !Number.isFinite(a.lastAt) || !(a.level > 0)) return null;
  return a.lastAt + alertResetSeconds(task.affixes);
}

// The objective's alert level at `t`: the stored level until it lapses, then 0. Pure.
export function alertLevelAt(task: AlertTask, t: number): number {
  const at = alertResetsAt(task);
  if (at === null || !(t < at)) return 0;
  return Math.floor((task.alert as ObjectiveAlert).level);
}

// The alert after a retreat or wipe at `t`: one level above the level at `t` (a lapsed alert starts again at 1),
// its clock restarted. Null when no affix of the objective raises an alert. Pure; a fresh object.
export function alertAfterSetback(task: AlertTask, t: number): ObjectiveAlert | null {
  if (!raisesAlert(task.affixes)) return null;
  return { level: alertLevelAt(task, t) + 1, lastAt: t };
}

// The escalation of a fight at alert `level`: the extra enemies and the Heightened Senses damage multiplier. Pure.
export function escalationAt(level: number): { extraEnemies: number; damageMult: number } {
  const l = level > 0 && Number.isFinite(level) ? Math.floor(level) : 0;
  return { extraEnemies: l * ESCALATION_ENEMIES_PER_LEVEL, damageMult: 1 + diminishing(HEIGHTENED_SENSES_PER_LEVEL * l, HEIGHTENED_SENSES_KNEE) };
}

export interface ObjectiveDifficulty {
  grade: number; // 1 Simple .. 5 Deadly, 6 Impossible
  name: string;
  score: number | null; // null when only the grade is stored (a risk-aware run before AF-1)
  alertLevel: number;
  impossible: boolean;
}

// The objective's difficulty rating at `t`: its stamped score plus ALERT_DIFFICULTY_PER_LEVEL per alert level,
// graded as at stamping; an ALERTED objective at IMPOSSIBLE_DIFFICULTY_SCORE or more reads Impossible (an objective
// is never Impossible on its own). A task with only a stored grade reads it; an unrated task reads null. Pure.
export function objectiveDifficultyAt(task: AlertTask & Pick<ExpeditionActivity, "difficulty" | "difficultyScore">, t: number): ObjectiveDifficulty | null {
  const level = alertLevelAt(task, t);
  const base = task.difficultyScore;
  if (typeof base === "number" && Number.isFinite(base)) {
    const score = base + ALERT_DIFFICULTY_PER_LEVEL * level;
    const impossible = level > 0 && score >= IMPOSSIBLE_DIFFICULTY_SCORE;
    const grade = impossible ? IMPOSSIBLE_GRADE : difficultyGradeOf(score);
    return { grade, name: impossible ? IMPOSSIBLE_DIFFICULTY_NAME : DIFFICULTY_NAMES[grade - 1], score, alertLevel: level, impossible };
  }
  const d = task.difficulty;
  if (typeof d === "number" && Number.isInteger(d) && d >= 1 && d <= DIFFICULTY_NAMES.length) {
    return { grade: d, name: DIFFICULTY_NAMES[d - 1], score: null, alertLevel: level, impossible: false };
  }
  return null;
}

// THE FAILSAFE: is the objective HELD at `t` (its alert has pushed it to Impossible, so no crew starts it until
// the alert lapses)? Pure.
export function objectiveHeld(task: AlertTask & Pick<ExpeditionActivity, "difficulty" | "difficultyScore">, t: number): boolean {
  return objectiveDifficultyAt(task, t)?.impossible === true;
}

// The UI's countdown: when a HELD objective becomes workable again (its alert's reset), or null when it is not
// held at `t`. Pure.
export function objectiveHeldUntil(task: AlertTask & Pick<ExpeditionActivity, "difficulty" | "difficultyScore">, t: number): number | null {
  return objectiveHeld(task, t) ? alertResetsAt(task) : null;
}
