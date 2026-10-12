// ============================================================================
// utilityGear.ts: Exploration 0.14.0 (Phase E4d), the RELIC-UNLOCKED UTILITY ITEMS' effect readers.
//
// Two specUtility families unlocked by a relic's FIRST FIND (discovery-gated research, BLUEPRINTS
// damageControlSuiteBp / pathfinderSuiteBp):
//   - DAMAGE CONTROL SUITE (tactician hulls, the RECOVERY role):
//       repairSpeed    -> a shorter post-loss shipRepair (tick.ts shipRepairDurationTicks, fixed at start)
//       waveHullRegen  -> a light hull patch-up before each LATER patrol wave (the shared wave sequence:
//                         tick.ts tickCaptainPatrol + combat/patrolReplay.ts resolvePatrolWaves)
//   - PATHFINDER SUITE (explorer hulls):
//       sensors              -> folded by equipmentStatMods like any sensor line (ShipDerivedStats.sensors)
//       expeditionScanSpeed  -> added to the expedition's dispatch-time scanSpeedBonus snapshot
//       hazardResist         -> added to the expedition's dispatch-time hazardResist snapshot
//
// PURE LEAF: imports from model.ts only (no tick / equipment / combat import), so the live tick loop, the
// display replay and expedition.ts can all read it with no cycle. Every reader takes the ship's INSTALLED
// pieces (the caller resolves them via equippedFor), and a piece counts only when its stamped moduleVariant
// names the family (generateEquipment stamps it for these varieties).
//
// ⚠️ ADDITIVE-NEUTRAL BY CONSTRUCTION: with no such piece installed (every existing save; nobody owns these
// yet) every reader returns exact zeros, and every consumer skips its adjustment entirely on a zero (no
// arithmetic pass at all), so each existing path is byte-identical.
//
// DETERMINISM: no rng anywhere. Every magnitude is a pure function of the installed pieces' rolled stat
// lines, read at a fixed point (repair start, wave build, dispatch), so offline == live holds by
// construction.
//
// ⚠️ ALL CURVE CONSTANTS BELOW ARE FIRST-PASS TUNABLE launch placeholders (the balance pass owns them),
// the same posture as PERCENT_STAT_CURVES. The raw stat lines are budget POINTS (roughly 5..110 across the
// iLevel / quality / rarity range); each effect converts its point sum through the shared diminishing
// plusToPercent curve (B * (1 - r^plus) / (1 - r)) and then a hard cap, so no amount of stacking runs away.
// ============================================================================

import { plusToPercent, type EquipmentInstance } from "./model";

// The two variety keys (EQUIPMENT_SLOTS.specUtility). Exported so the tests + UI name them once.
export const DAMAGE_CONTROL_SUITE_KEY = "damageControlSuite";
export const PATHFINDER_SUITE_KEY = "pathfinderSuite";

// --- Damage Control Suite curves (FIRST-PASS TUNABLE) ------------------------------------------------
// repairSpeed -> the FRACTION of a post-loss repair's duration removed. Asymptote B/(1-r) = 0.40, hard cap
// 0.5. A typical first craft (~12 points) shaves ~18%; a top roll approaches the cap.
export const DC_REPAIR_SPEED_B = 0.02;
export const DC_REPAIR_SPEED_R = 0.95;
export const DC_REPAIR_SPEED_MAX = 0.5;
// waveHullRegen -> the FRACTION of the (folded) max hull restored before each later wave. "LIGHT" by design:
// asymptote 0.08, hard cap 0.1. A typical first craft (~12 points) restores ~3.7% of max hull per wave.
export const DC_WAVE_REGEN_B = 0.004;
export const DC_WAVE_REGEN_R = 0.95;
export const DC_WAVE_REGEN_MAX = 0.1;

// --- Pathfinder Suite curves (FIRST-PASS TUNABLE) -----------------------------------------------------
// expeditionScanSpeed -> an additive scan-speed bonus fraction (the snapshot's scanSpeedBonus, x (1 + b)).
// Asymptote 0.30, hard cap 0.3.
export const PF_SCAN_SPEED_B = 0.015;
export const PF_SCAN_SPEED_R = 0.95;
export const PF_SCAN_SPEED_MAX = 0.3;
// hazardResist -> an additive hazard-resist fraction (the snapshot's hazardResist; relics.ts resistedHazard
// curves the COMBINED museum + gear value toward MUSEUM_HAZARD_RESIST_MAX, never reaching it, since GO-5). Asymptote 0.30, cap 0.3.
export const PF_HAZARD_RESIST_B = 0.015;
export const PF_HAZARD_RESIST_R = 0.95;
export const PF_HAZARD_RESIST_MAX = 0.3;

// Sum one stat line (implicit + rolled) across the installed pieces of ONE utility family. Pure.
function familyStatPoints(pieces: readonly EquipmentInstance[] | undefined, variantKey: string, stat: string): number {
  if (!pieces) return 0;
  let total = 0;
  for (const p of pieces) {
    if (p.slotType !== "specUtility" || p.moduleVariant !== variantKey) continue;
    total += (p.implicitStats[stat] ?? 0) + (p.rolledStats[stat] ?? 0);
  }
  return total;
}

// A point sum -> a capped fraction through the shared diminishing curve. 0 points -> exactly 0. Pure.
function cappedCurve(points: number, B: number, r: number, max: number): number {
  if (!(points > 0)) return 0;
  return Math.min(max, plusToPercent(points, B, r));
}

// ============================================================================
// Damage Control Suite
// ============================================================================

export interface DamageControlEffect {
  repairTimeReduction: number; // fraction of a post-loss repair's duration removed, in [0, DC_REPAIR_SPEED_MAX]
  waveHullRegenFraction: number; // fraction of max hull restored before each later wave, in [0, DC_WAVE_REGEN_MAX]
}

// The installed Damage Control Suite's effect, or exact zeros when none is installed (or the gear list is
// absent, the tick's "no gear passed" sentinel). Pure.
export function damageControlEffect(installedGear: readonly EquipmentInstance[] | undefined): DamageControlEffect {
  return {
    repairTimeReduction: cappedCurve(
      familyStatPoints(installedGear, DAMAGE_CONTROL_SUITE_KEY, "repairSpeed"),
      DC_REPAIR_SPEED_B,
      DC_REPAIR_SPEED_R,
      DC_REPAIR_SPEED_MAX,
    ),
    waveHullRegenFraction: cappedCurve(
      familyStatPoints(installedGear, DAMAGE_CONTROL_SUITE_KEY, "waveHullRegen"),
      DC_WAVE_REGEN_B,
      DC_WAVE_REGEN_R,
      DC_WAVE_REGEN_MAX,
    ),
  };
}

// Shorten a repair duration by the suite's reduction. CEIL (the conservative direction, keeps the duration
// an integer for the closed-form countdown), floored at 1 tick. A reduction <= 0 returns the base
// UNCHANGED with no arithmetic pass, so a ship without the suite repairs in exactly the old time. Pure.
export function damageControlRepairTicks(baseTicks: number, repairTimeReduction: number): number {
  if (!(repairTimeReduction > 0)) return baseTicks;
  return Math.max(1, Math.ceil(baseTicks * (1 - repairTimeReduction)));
}

// The hull a patrol carry-state holds AFTER the suite's between-wave patch-up: + floor(hullMax * fraction),
// clamped to hullMax. Whole hull points (floor) so the carry-state stays integral and the live loop + the
// display replay agree bit-for-bit. A fraction <= 0 (no suite) returns currentHull UNCHANGED, so the
// attrition rule (hull never regens) is byte-identical without the item. A hull already at or above max is
// never pushed past it (and never lowered). Pure.
export function damageControlWaveRegen(hullMax: number, currentHull: number, fraction: number): number {
  if (!(fraction > 0)) return currentHull;
  const amount = Math.floor(hullMax * fraction);
  if (amount <= 0 || currentHull >= hullMax) return currentHull;
  return Math.min(hullMax, currentHull + amount);
}

// ============================================================================
// Pathfinder Suite
// ============================================================================

export interface PathfinderEffect {
  scanSpeed: number; // additive scan-speed bonus fraction for an expedition dispatched with it installed
  hazardResist: number; // additive hazard-resist fraction for an expedition dispatched with it installed
}

// The installed Pathfinder Suite's EXPEDITION effect, or exact zeros when none is installed. (Its `sensors`
// line is NOT here: it folds through equipmentStatMods like any other sensor line.) Pure.
export function pathfinderEffect(installedGear: readonly EquipmentInstance[] | undefined): PathfinderEffect {
  return {
    scanSpeed: cappedCurve(
      familyStatPoints(installedGear, PATHFINDER_SUITE_KEY, "expeditionScanSpeed"),
      PF_SCAN_SPEED_B,
      PF_SCAN_SPEED_R,
      PF_SCAN_SPEED_MAX,
    ),
    hazardResist: cappedCurve(
      familyStatPoints(installedGear, PATHFINDER_SUITE_KEY, "hazardResist"),
      PF_HAZARD_RESIST_B,
      PF_HAZARD_RESIST_R,
      PF_HAZARD_RESIST_MAX,
    ),
  };
}
