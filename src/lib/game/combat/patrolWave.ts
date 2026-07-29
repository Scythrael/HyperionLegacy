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
import type { PatrolSystemDurability } from "../model";

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
  // Between-wave CARRY-STATE (Phase 12b Unit B2): the player ship's per-system DURABILITY,
  // so wear ACCUMULATES across the cycle's waves (a weapon worn in wave 1 opens wave 2 already
  // worn). OPTIONAL: absent => leave the fresh full-durability build untouched (the pre-B2
  // behaviour, and the safe default for a hand-built fixture or a not-yet-fought first wave).
  // Applied by OVERRIDING each fresh system's current durability, CLAMPED to that system's
  // fresh max (so a stale/hand-edited carry can never exceed the ceiling or go negative).
  carrySystemDurability?: PatrolSystemDurability;
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
  // OVERRIDE the fresh systems with the carried DURABILITY so wear persists across waves
  // (Phase 12b Unit B2). Absent => the fresh full build stands (no wear yet). shipToCombatant
  // built fresh per-combatant weapon / reactor / ftl objects, so these writes never leak into
  // a shared template.
  if (args.carrySystemDurability) applyCarriedSystemDurability(player, args.carrySystemDurability);
  return player;
}

// Clamp a carried durability value to [0, max] as an integer. A carried value can only ever be
// a prior FULL seed or a post-battle current (both already integers in [0, max]); this guard
// keeps a hand-edited / stale save from injecting a negative or over-ceiling durability.
function clampDurability(value: number, max: number): number {
  return Math.max(0, Math.min(max, Math.floor(value)));
}

// Apply a carried per-system durability onto a freshly-built player combatant, mutating the
// combatant's own (freshly-minted, unshared) systems in place. Weapons align BY INDEX to the
// hull's default loadout (rebuilt in the same fixed order every wave), so index i is the same
// weapon; a length mismatch (a hand-edited carry) is tolerated by iterating the overlap only.
// The reactor / ftl override each apply only when the fresh build actually carries that system.
function applyCarriedSystemDurability(
  player: Combatant,
  carry: PatrolSystemDurability,
): void {
  const weaponCount = Math.min(player.weapons.length, carry.weapons.length);
  for (let i = 0; i < weaponCount; i++) {
    player.weapons[i].durability = clampDurability(carry.weapons[i], player.weapons[i].durabilityMax);
  }
  if (player.reactor !== undefined) {
    player.reactor.durability = clampDurability(carry.reactor, player.reactor.durabilityMax);
  }
  if (player.ftl !== undefined) {
    player.ftl.durability = clampDurability(carry.ftl, player.ftl.durabilityMax);
  }
}

// capturePlayerSystemDurability -- read a POST-battle player combatant's per-system durability
// into the JSON-safe carry-state the mission persists (and the display replay carries wave-to-
// wave). Combat 0.13.0 (Phase 12b Unit B2). Reads the CURRENT durability off each weapon (in
// loadout order), the reactor, and the ftl. Both the live tick loop and the replay call this on
// the id-sorted finalCombatants player, so the wear they carry forward is derived from the SAME
// combat-stream state and stays byte-identical (parity). A combatant with no reactor/ftl (a bare
// fixture) yields 0 for that slot; a real bridged player always carries both. PURE: reads only.
export function capturePlayerSystemDurability(player: Combatant): PatrolSystemDurability {
  return {
    weapons: player.weapons.map((weapon) => weapon.durability),
    reactor: player.reactor ? player.reactor.durability : 0,
    ftl: player.ftl ? player.ftl.durability : 0,
  };
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
