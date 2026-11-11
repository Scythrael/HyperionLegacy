// Field Kits FKR-1 (docs/plans/2026-10-14-field-kits-plan.md REVISED SLICES R3 FKR-1; user 2026-10-16): ENEMY RANKS,
// pure. Every ground enemy has a rank (user-named: Weak, Normal, Strong, Elite, Boss) that scales its stats, the
// FOUNDATION for ground combat (FKR-6's gambit rank conditions read it off the combatant).
//
//   - STRENGTH (user, N1 "Weak 0.7 to Boss 2.5"): ONE multiplier per rank on HP and power alike: Weak x0.7, Normal x1,
//     Strong x1.3, Elite x1.7, Boss x2.5. It multiplies hp, hpMax, power and heal; `threat` follows power (the
//     generateEncounter rule threat == power, kept through withEscalation).
//   - PLACEMENT (user, N2 "By difficulty" with the 2026-10-16 correction, then "Soften Dangerous" and "Use them on the
//     curve", N5 "Normal"): the FINAL fight of an objective (its last fight point) is led by an Elite on a Challenging
//     or Dangerous objective and by a Boss on a Deadly one; every EARLIER fight point of a Dangerous objective is led
//     by a Strong enemy; Simple and Standard objectives have none. The lead is the fight's strongest enemy (highest
//     power, then list order). Every other enemy is Normal: the rest of a led fight, every surprise fight (an ambush
//     met where the crew stood) and every Reinforcing reinforcement fight. An unrated objective (legacy, before SQ-4)
//     is all Normal. Weak is placed by the difficulty curve (safe first runs SF-3, user "Use them on the curve", then
//     the SF-3 review "Fade Weak"): on an ordinary run on the curve every enemy a fight leaves unled takes the faded
//     Weak factor (curveBaseFactor: x0.7 at the curve's floor rising to x1 at full strength) and reads Weak while that
//     factor is below the Weak / Normal midpoint (curveBaseRank). Surprise and reinforcement fights are unled, so their
//     enemies take it too: REINFORCEMENT_RANK (N5 "Normal") means "no lead, the run's base", the same rule as every
//     other unled enemy.
//   - TRAINING RUN (safe first runs, user: "never on a training run"): every enemy Normal. Read through ONE helper,
//     isTrainingRun, off the safe first runs stamp (`Expedition.difficulty.firstRun`, typed by SF-1, written at dispatch
//     by SF-2); a run without that stamp is not a training run.
//   - FLAG: `Expedition.enemyRanks` (stamped at dispatch with ENEMY_RANKS_VERSION). A run without it never ranks.
//
// DETERMINISM: no draw. A rank is arithmetic on stored values (the objective's stamped grade, the fight's place in it,
// the generated enemies' power), so every fight stream and every generation draw read exactly as before.
//
// Module graph: model (types), gambit (the combatant type) and runDifficulty (the curve, SF-3) only.

import type { EnemyRank, Expedition, ExpeditionActivity } from "./model";
import type { GroundCombatant } from "./gambit";
import { rampedStampOf } from "./runDifficulty";

export type { EnemyRank } from "./model";

// ===== The catalog =====

// The catalog version a ranked run is stamped with (Expedition.enemyRanks.version). Bump it when a rank's numbers or
// placement change after a version has reached players, and keep the old version's rules for runs stamped with it
// (the 2026-10-16 "Soften Dangerous" follow-up kept version 1: no ranked run had shipped).
export const ENEMY_RANKS_VERSION = 1;

export interface EnemyRankDef {
  order: number; // 0 Weak .. 4 Boss (FKR-6's "Elite or stronger" compares these)
  label: string; // the player-facing word
  mult: number; // the ONE multiplier on HP and power (heal follows), user N1
}

export const ENEMY_RANKS: Readonly<Record<EnemyRank, EnemyRankDef>> = {
  weak: { order: 0, label: "Weak", mult: 0.7 },
  normal: { order: 1, label: "Normal", mult: 1 },
  strong: { order: 2, label: "Strong", mult: 1.3 },
  elite: { order: 3, label: "Elite", mult: 1.7 },
  boss: { order: 4, label: "Boss", mult: 2.5 },
};

// Weakest to strongest.
export const ENEMY_RANK_IDS: readonly EnemyRank[] = ["weak", "normal", "strong", "elite", "boss"];

// The FINAL fight's lead by objective grade (index grade - 1): Simple and Standard none, Challenging and Dangerous an
// Elite, Deadly a Boss (user N2 corrected, then "Soften Dangerous", 2026-10-16).
export const FINAL_FIGHT_LEAD: readonly (EnemyRank | null)[] = [null, null, "elite", "elite", "boss"];

// Every EARLIER fight point's lead by objective grade: Strong on a Dangerous objective only (user "Use them on the
// curve", 2026-10-16), none elsewhere.
export const EARLIER_FIGHT_LEAD: readonly (EnemyRank | null)[] = [null, null, null, "strong", null];

// A Reinforcing reinforcement fight's enemies (user N5 "Normal").
export const REINFORCEMENT_RANK: EnemyRank = "normal";

// Safe first runs SF-3 (user 2026-10-16 "Use them on the curve": early-curve runs use Weak enemies; SF-3 review
// 2026-10-21 "Fade Weak": ordinary enemies x(0.7 + 0.3 x ramp), so Weak fades out with no step): the rank whose
// multiplier the curve's ordinary (unled) enemies start from. Like every rank it multiplies AFTER the curve's strength
// (the Field Kits plan's rule "ranks multiply after the ramp scale"), so an ordinary enemy on run 2 stands at 0.35 x 0.7
// of nominal and at full strength exactly at nominal; a fight's lead keeps the rank its objective places (N2).
export const EARLY_CURVE_RANK: EnemyRank = "weak";
// [PROVISIONAL] The curve position below which the faded factor still reads (name, chip, gambit rank rules) as Weak:
// the factor below the Weak / Normal midpoint (0.85), runs 2 to 7 (ramp 0 to 0.41; run 8 sits at 0.54, far from the
// line, so no rounding near-tie decides the name). From there the enemies read Normal at their faded factor.
export const EARLY_CURVE_WEAK_UNTIL = 0.5;

// ===== Pure helpers =====

// Is `exp` a ranked run (its enemyRanks flag stamped with a known catalog version)? Pure.
export function ranksLive(exp: Pick<Expedition, "enemyRanks">): boolean {
  const v = exp.enemyRanks?.version;
  return typeof v === "number" && v >= 1;
}

// Is `exp` a TRAINING RUN (the safe first run)? The ONE read of the safe first runs stamp
// (`Expedition.difficulty.firstRun`: SF-1 types it, SF-2 writes it in buildExpedition); a run without the stamp (every
// run before SF-2) is not one. Strict: only a stored `true` counts. Pure.
export function isTrainingRun(exp: Pick<Expedition, "difficulty">): boolean {
  const difficulty: unknown = exp.difficulty;
  return typeof difficulty === "object" && difficulty !== null && (difficulty as { firstRun?: unknown }).firstRun === true;
}

// The BASE rank of every fight on `exp` (the rank its ordinary, unled enemies are named): EARLY_CURVE_RANK on an
// ordinary run below EARLY_CURVE_WEAK_UNTIL, Normal everywhere else (a run without the stamp, the training run, the
// rest of the curve, Tier II and up). Pure.
export function curveBaseRank(exp: Pick<Expedition, "difficulty">): EnemyRank {
  const stamp = rampedStampOf(exp);
  return stamp && stamp.ramp < EARLY_CURVE_WEAK_UNTIL ? EARLY_CURVE_RANK : "normal";
}

// The multiplier every ordinary (unled) enemy of `exp` takes (SF-3 review "Fade Weak"): EARLY_CURVE_RANK's multiplier
// at the curve's floor, rising linearly with the ramp to exactly 1 at full strength; 1 on a run without an ordinary
// stamp. Pure.
export function curveBaseFactor(exp: Pick<Expedition, "difficulty">): number {
  const stamp = rampedStampOf(exp);
  if (!stamp || stamp.ramp >= 1) return 1;
  const weak = ENEMY_RANKS[EARLY_CURVE_RANK].mult;
  return weak + (1 - weak) * stamp.ramp;
}

// Where a fight sits in its objective: a fight point ("point"), a surprise fight (an ambush met where the crew stood)
// or a Reinforcing reinforcement fight.
export type RankedFightKind = "point" | "surprise" | "reinforcement";

export interface FightRankContext {
  grade: number | undefined; // the objective's stamped difficulty grade (1 Simple .. 5 Deadly); absent = unrated
  pointIndex: number; // the fight point fought for (the objective's pointsCleared at the start)
  fightPointCount: number; // the objective's fight points
  kind: RankedFightKind;
  trainingRun: boolean;
}

// The rank of a fight's LEAD (its strongest enemy) by the objective's grade and the fight's place (see the header):
// the grade's FINAL_FIGHT_LEAD on the final fight point, its EARLIER_FIGHT_LEAD on an earlier one, Normal for every
// other fight. Pure.
export function fightLeadRank(ctx: FightRankContext): EnemyRank {
  if (ctx.trainingRun) return "normal";
  if (ctx.kind === "reinforcement") return REINFORCEMENT_RANK;
  if (ctx.kind !== "point") return "normal";
  const g = ctx.grade;
  if (typeof g !== "number" || !Number.isInteger(g) || g < 1 || g > FINAL_FIGHT_LEAD.length) return "normal";
  const p = ctx.pointIndex;
  if (!(ctx.fightPointCount >= 1) || !Number.isInteger(p) || p < 0 || p >= ctx.fightPointCount) return "normal";
  return (p === ctx.fightPointCount - 1 ? FINAL_FIGHT_LEAD : EARLIER_FIGHT_LEAD)[g - 1] ?? "normal";
}

// The rank context of one fight of `task` on `exp`: its stamped grade, `fightPointCount` (the objective's fight
// points), the point fought for and the kind. Pure.
export function fightRankContext(
  exp: Pick<Expedition, "difficulty">,
  task: Pick<ExpeditionActivity, "difficulty" | "pointsCleared">,
  fightPointCount: number,
  kind: RankedFightKind = "point",
): FightRankContext {
  return { grade: task.difficulty, pointIndex: task.pointsCleared ?? 0, fightPointCount, kind, trainingRun: isTrainingRun(exp) };
}

// Rank a fight's fresh enemy list: the LEAD (the strongest enemy: highest power, then list order) takes `lead` (Normal
// = no lead), every other enemy `base` (Normal; SF-3: curveBaseRank) at `baseMult` (default the base rank's own
// multiplier; SF-3: curveBaseFactor). Each enemy is stamped with its rank; its hp, hpMax, power, heal and threat take
// its multiplier (hp rounded to a whole number, at least 1). Ids keep their role tag. No draw. Mutates the fresh list it
// is handed and returns it.
export function withEnemyRanks(enemies: GroundCombatant[], lead: EnemyRank, base: EnemyRank = "normal", baseMult: number = ENEMY_RANKS[base].mult): GroundCombatant[] {
  let leadAt = -1;
  if (lead !== "normal") {
    for (let i = 0; i < enemies.length; i += 1) if (leadAt < 0 || enemies[i].power > enemies[leadAt].power) leadAt = i;
  }
  enemies.forEach((e, i) => {
    const rank: EnemyRank = i === leadAt ? lead : base;
    e.rank = rank;
    const m = i === leadAt ? ENEMY_RANKS[lead].mult : baseMult;
    if (m === 1) return;
    e.hp = Math.max(1, Math.round(e.hp * m));
    e.hpMax = Math.max(1, Math.round(e.hpMax * m));
    e.power *= m;
    e.heal *= m;
    e.threat *= m;
  });
  return enemies;
}

// The fight record's ranks: enemy id -> rank for every enemy not Normal, or undefined when there is none. Pure.
export function rankedEnemies(enemies: readonly Pick<GroundCombatant, "id" | "rank">[]): Record<string, EnemyRank> | undefined {
  let out: Record<string, EnemyRank> | undefined;
  for (const e of enemies) {
    if (e.rank === undefined || e.rank === "normal") continue;
    (out ??= {})[e.id] = e.rank;
  }
  return out;
}

// Is `rank` at least `min` (FKR-6's "target is Elite or stronger")? Absent reads Normal. Pure.
// Field Kits FKR-6 hardening: a rule's `min` comes from a stored save, so an unknown one (a hostile or damaged save) is
// never met and never throws; an unknown `rank` reads Normal.
export function rankAtLeast(rank: EnemyRank | undefined, min: EnemyRank): boolean {
  const want = (ENEMY_RANKS as Partial<Record<string, EnemyRankDef>>)[min]?.order;
  if (typeof want !== "number") return false;
  const have = (ENEMY_RANKS as Partial<Record<string, EnemyRankDef>>)[rank ?? "normal"]?.order;
  return (typeof have === "number" ? have : ENEMY_RANKS.normal.order) >= want;
}
