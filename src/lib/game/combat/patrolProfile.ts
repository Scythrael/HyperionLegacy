// ============================================================================
// combat/patrolProfile.ts: a patrol cycle's DIFFICULTY PROFILE, the one leaf the live loop (tick.ts
// tickCaptainPatrol / freshPatrolMission) and the display replay + dispatch forecast (patrolReplay.ts
// resolvePatrolWaves) both read, so the fight the card forecasts is the fight the patrol flies (Safe first runs
// SF-4, docs/plans/2026-10-15-safe-first-runs-plan.md; the stamp and the curve live in runDifficulty.ts).
//
//   - THE TRAINING CYCLE (the save's one safe patrol, user SF9 / SF10 "Fewest waves, lightest raider"): the first
//     FIRST_PATROL_WAVES waves of the cycle's own schedule (never more than the route's minWaves), each ONE enemy of
//     the route's lightest hull; and the BACKSTOP (OC-1, plan 3.2): a wave the ship would lose BREAKS OFF (no
//     defeat, no limp, no damage, no loot for that wave; the carry-state is the one it entered the wave with).
//   - A RAMPED CYCLE (SF11 "Scale enemy stats"): the route's own waves and enemies, every enemy's hull, shields,
//     weapon yields and drones at rampEnemyScale of nominal.
//   - NO STAMP (full strength: a veteran, the top of the curve, a patrol in flight from before SF-4): exactly the
//     pre-SF-4 schedule, enemies and outcome, by construction (every function below returns its input).
//
// DETERMINISM: no new draw and no new stream. The schedule is the same planWaveSchedule call (the training cycle
// keeps a prefix of it); the enemy wave draws from the same per-wave seed (the training cycle's one-hull, one-enemy
// params consume that wave's own stream, which nothing else reads); scaling is integer rounding after the draws.
// ============================================================================

import type { PatrolDef, PatrolDifficultyStamp } from "../model";
import { MARAUDER_TORPEDO_PERMILLE, type CombatRulesStamp } from "./combatRules";
import { FIRST_PATROL_WAVES, isTrainingPatrol, patrolEnemyScale, patrolStampOf, rampOddsFraction, rampedChance } from "../runDifficulty";
import { PIRATE_HULLS, type PirateHullId } from "./enemyHulls";
import type { EnemyWaveParams } from "./enemyWave";
import { planWaveSchedule, patrolWaveParams } from "./waveSchedule";
import type { Combatant } from "./types";

// WR-8 (0.14.0): and the cycle's combat rules stamp (combat/combatRules.ts), read by the wave's enemy params.
type Stamped = { difficulty?: PatrolDifficultyStamp; combatRules?: CombatRulesStamp };

// The route's LIGHTEST hull (the least hull + shield; the first in pool order on a tie): the training cycle's enemy.
// Pure.
export function lightestPatrolHull(def: PatrolDef): PirateHullId {
  let best = def.hullPool[0];
  const weight = (id: PirateHullId): number => PIRATE_HULLS[id].hullIntegrity + PIRATE_HULLS[id].shieldCapacity;
  for (const id of def.hullPool) if (weight(id) < weight(best)) best = id;
  return best;
}

// The cycle's wave schedule (absolute route ticks): planWaveSchedule exactly, the training cycle flying its first
// min(FIRST_PATROL_WAVES, minWaves) waves. Pure.
export function patrolCycleWaveTicks(masterSeed: number, def: PatrolDef, stamped: Stamped): number[] {
  const ticks = planWaveSchedule(masterSeed, patrolWaveParams(def));
  return isTrainingPatrol(stamped) ? ticks.slice(0, Math.min(FIRST_PATROL_WAVES, def.minWaves)) : ticks;
}

// One wave's enemy params: the route's pool and count band, or on the training cycle one enemy of its lightest hull.
// Pure.
export function patrolWaveEnemyParams(def: PatrolDef, stamped: Stamped, idPrefix: string): EnemyWaveParams {
  // WR-8: a cycle under the combat rules fields its enemies under them (absent: the pre-WR-8 params exactly).
  const rules = stamped.combatRules !== undefined ? { combatRules: true } : {};
  if (isTrainingPatrol(stamped)) return { hullPool: [lightestPatrolHull(def)], enemyCountMin: 1, enemyCountMax: 1, idPrefix, ...rules };
  // WR-8b: a cycle stamped with enemy torpedoes fields them (never the training cycle, above).
  const torpedoes = patrolTorpedoesLive(stamped) ? { torpedoes: { marauderPermille: patrolMarauderTorpedoPermille(stamped) } } : {};
  return { hullPool: def.hullPool, enemyCountMin: def.enemyCountMin, enemyCountMax: def.enemyCountMax, idPrefix, ...rules, ...torpedoes };
}

// WR-8b (0.14.0, enemy torpedoes; user 2026-11-10 "Simple now"): whether a cycle's enemies carry torpedoes: its combat
// rules stamp carries enemyTorpedoes (every cycle started since WR-8b) and it is not the training cycle. Pure.
export function patrolTorpedoesLive(stamped: Stamped): boolean {
  return stamped.combatRules?.enemyTorpedoes === 1 && !isTrainingPatrol(stamped);
}

// WR-8b: a Marauder's chance to carry a torpedo on this cycle, in whole permille: MARAUDER_TORPEDO_PERMILLE on the
// patrol ramp, the WR-10 Corroded mechanism (rampedChance at the odds position, one run behind the enemy curve:
// runDifficulty.ts rampOddsFraction of the cycle's completed runs). Full on a cycle without a curve stamp (a veteran, or
// past the odds ramp's top: runDifficulty.ts patrolDifficultyAt keeps stamping one patrol past the enemy curve's top, so
// that step is a step like the rest), 0 on the training cycle and on the first two ramped patrols. Pure.
export function patrolMarauderTorpedoPermille(stamped: Stamped): number {
  const s = patrolStampOf(stamped);
  if (s === null) return MARAUDER_TORPEDO_PERMILLE;
  if (s.firstRun) return 0;
  return Math.round(rampedChance(MARAUDER_TORPEDO_PERMILLE, rampOddsFraction(s.completed)));
}

// WR-8 (0.14.0): the battle options a patrol wave resolves with: under the cycle's combat rules the guns pre-charge
// during the close (OC-D9 "patrols gain precharge", like the ship events) and the rules' battle paths are on. A cycle
// without the stamp resolves exactly as before ({}).
export function patrolBattleOptions(stamped: Stamped): { precharge?: boolean; combatRules?: number } {
  return stamped.combatRules !== undefined ? { precharge: true, combatRules: stamped.combatRules.rules } : {};
}

// One enemy at `scale` of nominal: hull and shield pools, shield recharge, every weapon's yield band, every drone's
// HP and yield band, each rounded to a whole number (a hull never below 1, a band never inverted). Pure: a fresh
// combatant (weapons, squadrons and drones copied), the input untouched.
function scaleEnemy(c: Combatant, scale: number): Combatant {
  const r = (n: number): number => Math.max(0, Math.round(n * scale));
  const hullMax = Math.max(1, r(c.hullMax));
  return {
    ...c,
    hullMax,
    hull: Math.min(hullMax, Math.max(1, r(c.hull))),
    shieldMax: r(c.shieldMax),
    shield: r(c.shield),
    shieldRecharge: r(c.shieldRecharge),
    weapons: c.weapons.map((w) => {
      const yieldMin = r(w.yieldMin);
      return { ...w, effectSlots: [...w.effectSlots], yieldMin, yieldMax: Math.max(yieldMin, r(w.yieldMax)) };
    }),
    drones: c.drones.map((sq) => {
      const droneHp = Math.max(1, r(sq.droneHp));
      const yieldMin = r(sq.yieldMin);
      return {
        ...sq,
        droneHp,
        yieldMin,
        yieldMax: Math.max(yieldMin, r(sq.yieldMax)),
        drones: sq.drones.map((d) => ({ ...d, hpMax: droneHp, hp: Math.min(droneHp, Math.max(d.hp > 0 ? 1 : 0, r(d.hp))) })),
      };
    }),
  };
}

// The wave's enemies at the cycle's strength (runDifficulty.ts patrolEnemyScale): the SAME array at full strength
// (no stamp, the training cycle), scaled copies on a ramped cycle. Pure.
export function patrolCycleEnemies(enemies: Combatant[], stamped: Stamped): Combatant[] {
  const scale = patrolEnemyScale(stamped);
  return scale === 1 ? enemies : enemies.map((c) => scaleEnemy(c, scale));
}

// The backstop: whether a LOST wave breaks off instead of ending the patrol (the training cycle only). Pure.
export function patrolWaveBreaksOff(stamped: Stamped): boolean {
  return isTrainingPatrol(stamped);
}
