// Field Kits FKR-1 (docs/plans/2026-10-14-field-kits-plan.md REVISED SLICES R3 FKR-1; user 2026-10-16): ENEMY RANKS,
// pure. Every ground enemy has a rank (user-named: Weak, Normal, Strong, Elite, Boss) that scales its stats, the
// FOUNDATION for ground combat (FKR-6's gambit rank conditions read it off the combatant).
//
//   - STRENGTH (user, N1 "Weak 0.7 to Boss 2.5"): ONE multiplier per rank on HP and power alike: Weak x0.7, Normal x1,
//     Strong x1.3, Elite x1.7, Boss x2.5. It multiplies hp, hpMax, power and heal; `threat` follows power (the
//     generateEncounter rule threat == power, kept through withEscalation).
//   - PLACEMENT (user, N2 "By difficulty" with the 2026-10-16 correction, N3 "Only final fights", N5 "Normal"): the
//     FINAL fight of an objective (its last fight point) is led by an Elite on a Challenging objective and by a Boss
//     on a Dangerous or Deadly one; Simple and Standard objectives have none. The lead is the fight's strongest enemy
//     (highest power, then list order). Every other enemy is Normal: the rest of the final fight, every earlier fight,
//     every surprise fight (an ambush met where the crew stood) and every Reinforcing reinforcement fight. An unrated
//     objective (legacy, before SQ-4) is all Normal. Weak and Strong exist in the catalog; nothing places them yet.
//   - TRAINING RUN (safe first runs, user: "never on a training run"): every enemy Normal. Read through ONE helper,
//     isTrainingRun, off the safe first runs stamp (`Expedition.difficulty.firstRun`, typed by SF-1, written at dispatch
//     by SF-2); a run without that stamp is not a training run.
//   - FLAG: `Expedition.enemyRanks` (stamped at dispatch with ENEMY_RANKS_VERSION). A run without it never ranks.
//
// DETERMINISM: no draw. A rank is arithmetic on stored values (the objective's stamped grade, the fight's place in it,
// the generated enemies' power), so every fight stream and every generation draw read exactly as before.
//
// Module graph: model (types) and gambit (the combatant type) only.

import type { EnemyRank, Expedition, ExpeditionActivity } from "./model";
import type { GroundCombatant } from "./gambit";

export type { EnemyRank } from "./model";

// ===== The catalog =====

// The catalog version a ranked run is stamped with (Expedition.enemyRanks.version). Bump it when a rank's numbers or
// placement change, and keep the old version's rules for runs stamped with it.
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

// The FINAL fight's lead by objective grade (index grade - 1): Simple and Standard none, Challenging an Elite,
// Dangerous and Deadly a Boss (user N2, corrected 2026-10-16).
export const FINAL_FIGHT_LEAD: readonly (EnemyRank | null)[] = [null, null, "elite", "boss", "boss"];

// A Reinforcing reinforcement fight's enemies (user N5 "Normal").
export const REINFORCEMENT_RANK: EnemyRank = "normal";

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
// the grade's FINAL_FIGHT_LEAD on the final fight point, Normal everywhere else. Pure.
export function fightLeadRank(ctx: FightRankContext): EnemyRank {
  if (ctx.trainingRun) return "normal";
  if (ctx.kind === "reinforcement") return REINFORCEMENT_RANK;
  if (ctx.kind !== "point") return "normal";
  const g = ctx.grade;
  if (typeof g !== "number" || !Number.isInteger(g) || g < 1 || g > FINAL_FIGHT_LEAD.length) return "normal";
  if (!(ctx.fightPointCount >= 1) || ctx.pointIndex !== ctx.fightPointCount - 1) return "normal";
  return FINAL_FIGHT_LEAD[g - 1] ?? "normal";
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

// Rank a fight's fresh enemy list: the LEAD (the strongest enemy: highest power, then list order) takes `lead`, every
// other enemy Normal. Each enemy is stamped with its rank; a ranked enemy's hp, hpMax, power, heal and threat take
// its multiplier (hp rounded to a whole number, at least 1). Ids keep their role tag. No draw. Mutates the fresh list
// it is handed and returns it.
export function withEnemyRanks(enemies: GroundCombatant[], lead: EnemyRank): GroundCombatant[] {
  let leadAt = -1;
  if (lead !== "normal") {
    for (let i = 0; i < enemies.length; i += 1) if (leadAt < 0 || enemies[i].power > enemies[leadAt].power) leadAt = i;
  }
  enemies.forEach((e, i) => {
    const rank: EnemyRank = i === leadAt ? lead : "normal";
    e.rank = rank;
    const m = ENEMY_RANKS[rank].mult;
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

// The player-facing name of a ranked enemy: "Elite Bruiser" (a Normal enemy, or no rank, is just its role name). Pure.
export function rankedEnemyName(rank: EnemyRank | undefined, roleName: string): string {
  return rank === undefined || rank === "normal" ? roleName : `${ENEMY_RANKS[rank].label} ${roleName}`;
}

// Is `rank` at least `min` (FKR-6's "target is Elite or stronger")? Absent reads Normal. Pure.
export function rankAtLeast(rank: EnemyRank | undefined, min: EnemyRank): boolean {
  return ENEMY_RANKS[rank ?? "normal"].order >= ENEMY_RANKS[min].order;
}
