// ============================================================================
// combat/patrolWave.ts -- shared LEAF helpers for one patrol wave (Combat 0.13.0,
// Phase 12b-1)
//
// WHY THIS EXISTS, AND WHY IT IS A SEPARATE MODULE:
// Two code paths resolve a patrol's waves off the same persisted master seed:
//   1. tickCaptainPatrol (tick.ts) -- the LIVE / offline advance that actually
//      awards loot, XP, damage, fuel, and progresses the mission.
//   2. replayPatrol (patrolReplay.ts) -- a DISPLAY-ONLY reproduction that a "watch
//      the combat" UI renders (Phase 12b-1). It must resolve every wave BYTE-
//      IDENTICALLY to the live loop, yet touch no game state.
//
// Both paths build the per-wave PLAYER combatant the same way (hull defaults from
// the ship type, then override hull/shield/drones with the between-wave CARRY-STATE)
// and apply the same between-wave SHIELD REGEN. If those two leaves were duplicated
// inline in each path, a future edit to one could silently DESYNC the display replay
// from the real fight. Extracting them here makes parity STRUCTURAL: both paths call
// the one source of truth, so they cannot drift (Omega 4 consolidation + the offline
// == live determinism discipline).
//
// SCOPE: pure, tiny, side-effect-light leaves ONLY. The wave/recovery ORCHESTRATION
// (which wave fires when, limp-home, relaunch, rewards) stays in each caller; this
// module is just the two shared per-wave primitives.
// ============================================================================

import { shipToCombatant, type CombatHullType, type CombatShipStats } from "./bridge";
import type { CombatStance } from "./positioning";
import type { Combatant } from "./types";
import type { DroneSquadron } from "./drones";

// ---------------------------------------------------------------------------
// buildPatrolPlayerCombatant -- mint the PLAYER combatant for one patrol wave.
//
// Mirrors exactly what the live tick loop does per wave: build a FRESH combatant
// from the hull's combat stats + default loadout (weapons + cooldowns reset each
// wave, since each wave is a discrete battle), THEN override hull / shield / drones
// with the persisted CARRY-STATE so damage and drone losses persist across waves.
//
// PURE: constructs and returns a fresh Combatant, mutates none of its inputs. The
// caller owns whether the carry-state arrays it passes are shared or cloned (the
// live loop deep-clones its mission drones up front; resolveBattle clones again
// internally, so the combatant returned here is safe to hand straight to the sim).
// ---------------------------------------------------------------------------
export function buildPatrolPlayerCombatant(args: {
  // The player combatant's stable id across every wave (the sim's id-sort key). Use
  // the ShipInstance id so live and replay produce the identical turn order.
  playerId: string;
  // The ship's combat stat source (SHIP_TYPES entry structurally satisfies this).
  stats: CombatShipStats;
  // The combat hull class, driving the default weapons + a carrier's drone screen.
  hullType: CombatHullType;
  // The player-chosen combat stance carried by every wave.
  stance: CombatStance;
  // Between-wave CARRY-STATE (attrition): hull never regens, shield regens toward
  // full between waves, drones carry their losses/replenishment forward.
  carryHull: number;
  carryShield: number;
  carryDrones: DroneSquadron[];
}): Combatant {
  // FRESH from the hull defaults (weapons + cooldowns reset each wave).
  const player = shipToCombatant({
    id: args.playerId,
    team: "player",
    stats: args.stats,
    hullType: args.hullType,
    stance: args.stance,
  });
  // OVERRIDE with the carry-state so hull damage + drone losses persist across waves.
  player.hull = args.carryHull;
  player.shield = args.carryShield;
  player.drones = args.carryDrones;
  return player;
}

// ---------------------------------------------------------------------------
// regenPatrolShield -- one whole-tick of between-wave SHIELD regeneration.
//
// Design S14: between waves the shield pool regenerates toward capacity at the
// hull's per-tick recharge, while HULL DOES NOT regen (attrition). This is the exact
// single-tick formula the live tick loop applies on every non-wave route tick; the
// display replay applies it the same number of times over each inter-wave gap so the
// carry-state going INTO the next wave is byte-identical.
//
// PURE: a single clamped integer add, returns the new shield value, mutates nothing.
// A full shield (currentShield >= capacity) is returned unchanged (no-op), which is
// why applying it over the pre-first-wave transit ticks is harmless.
// ---------------------------------------------------------------------------
export function regenPatrolShield(
  shieldCapacity: number,
  currentShield: number,
  shieldRecharge: number,
): number {
  return Math.min(shieldCapacity, currentShield + shieldRecharge);
}
