// WR-5b (0.14.0, plan docs/plans/2026-10-15-wiring-registry-and-audit-plan.md section 4 WR-5b, section 5.A and the
// USER ANSWERS OC-A1 / OC-A2 / OC-A3 and the 2026-10-17 WR-5a calls): the captain SECONDARY talent readers of the
// TACTICIAN tree (Gunnery, Aegis, Fleet Ops) and each node's player text.
//
// The user's rulings:
//   OC-A1 + "Always multiply" (2026-10-17): every "+X%" node is its own x (1 + X) factor on the named value, never an
//     additive +X on a sum of bonuses. Here each node folds AFTER the officers' bonuses on the same value.
//   OC-A2 "own ship": a node acts on the ship that captain commands (ship.assignedCaptainId), frozen at dispatch for
//     runs (the Ground Ops ship-event battle profile) and per cycle for patrols (PatrolMissionState.captainCombat,
//     beside officerCombat). The Shipyard repair reads it when the repair starts (its duration is fixed then).
//   OC-A3 "Proposed sizes": every capstone has its configured magnitude (model.ts) and no placeholder is left.
//
// Where each node acts (combat/captainEdge.ts is the battle side):
//   gunnery1 Weapons Drill    : every weapon projectile's damage x (1 + m), banked in thousandths so it is exact
//   gunnery2 Marksman         : every weapon's accuracy x (1 + m), rounded (the hit roll's existing 0 to 100 clamp)
//   gunnery3 Overcharge       : x (1 + m) on a projectile whose target is above half hull (OVERCHARGE_HULL_SHARE)
//   gunnery4 Ammo Reserves    : every weapon's cooldown clock runs (1 + m) as fast (cooldown / (1 + m))
//   gunnery5 Alpha Strike     : x (1 + m) on each weapon's first shot of a battle
//   aegis1 Shield Discipline  : the shield pool and its recharge x (1 + m)
//   aegis2 Reinforced Hull    : the hull pool x (1 + m)
//   aegis3 Damage Control     : the Shipyard repair divisor, the Ground Ops field repair divisor and the Damage
//                               Control Suite's between-wave patch-up, each x (1 + m)
//   aegis4 Point Defense      : every enemy shot's and drone's hit chance against the ship / (1 + m) [PROVISIONAL:
//                               the ship's own evasion is 0 without an Evasive Command officer, so a multiplier on
//                               it would do nothing; the alternative is +m x 100 evasion points]
//   aegis5 Bulwark            : m times per battle, a hit that would destroy the ship leaves it at 1 hull
//   fleetOps1 Drone Handler   : every drone hit's damage x (1 + m), banked in thousandths
//   fleetOps2 Squadron Tactics: every drone's hit points x (1 + m), rounded
//   fleetOps3 Patrol Efficiency: every won patrol wave's materials and credits x (1 + m) (the existing whole-unit
//                               rounding on the wave's private output stream)
//   fleetOps4 Wing Commander  : the drone screen's replenish rate x (1 + m), rounded [PROVISIONAL: no multi-ship
//                               system exists; plan 5.A's proposed real effect]
//   fleetOps5 Wolfpack        : m more drone squadrons, each a copy of the first installed pod's squadron (a ship with
//                               no drone pod fields none)
//
// Battles today open with every ship at position 0 (OC-D9 "Enemies start at range" is not built yet), so Alpha
// Strike's "first shot" is each weapon's first shot of the battle, wherever the fight opens.
//
// Every magnitude is read from the catalog (model.ts SECONDARY_CAPTAIN_TALENTS) by node KEY, so a retune is a data
// edit. All PURE.

import {
  SECONDARY_CAPTAIN_TALENTS,
  type CaptainCombatMods,
  type CaptainState,
  type GameState,
  type SecondaryTalentKey,
} from "./model";
import { OVERCHARGE_HULL_SHARE } from "./combat/captainEdge";

// The node's configured magnitude: a statMult's mult, a procChance's chance, a capstone's magnitude; 0 otherwise.
export function tacticianMagnitude(key: SecondaryTalentKey): number {
  const e = SECONDARY_CAPTAIN_TALENTS[key].effect;
  switch (e.type) {
    case "statMult":
      return e.mult;
    case "procChance":
      return e.chance;
    case "capstone":
      return e.magnitude ?? 0;
    default:
      return 0;
  }
}

// Each Tactician node's CaptainCombatMods key.
export const TACTICIAN_MOD_OF: Readonly<Partial<Record<SecondaryTalentKey, keyof CaptainCombatMods>>> = {
  gunnery1: "weaponDamage",
  gunnery2: "accuracy",
  gunnery3: "highHealthDamage",
  gunnery4: "cooldown",
  gunnery5: "openingVolley",
  aegis1: "shield",
  aegis2: "hull",
  aegis3: "repair",
  aegis4: "evasion",
  aegis5: "bulwark",
  fleetOps1: "droneDamage",
  fleetOps2: "droneHp",
  fleetOps3: "patrolLoot",
  fleetOps4: "droneReplenish",
  fleetOps5: "wolfpack",
};

// The captain's Tactician talents as the frozen record (undefined when none is owned, so the caller never stores an
// empty record). Pure.
export function captainCombatMods(captain: CaptainState | undefined | null): CaptainCombatMods | undefined {
  if (!captain || captain.unlockedSecondaryTalents.length === 0) return undefined;
  let mods: CaptainCombatMods | undefined;
  for (const key of captain.unlockedSecondaryTalents) {
    const field = TACTICIAN_MOD_OF[key];
    if (!field) continue;
    const m = tacticianMagnitude(key);
    if (!(m > 0)) continue;
    mods = { ...(mods ?? {}), [field]: m };
  }
  return mods;
}

// The captain who commands `ship` (OC-A2), or undefined for an unassigned hull. Pure.
export function commandingCaptainOf(state: GameState, ship: { assignedCaptainId: number | null }): CaptainState | undefined {
  return ship.assignedCaptainId === null ? undefined : state.captains.find((c) => c.id === ship.assignedCaptainId);
}

// The ship's commanding captain's frozen record (the dispatch read). Pure.
export function shipCaptainCombatMods(state: GameState, ship: { assignedCaptainId: number | null }): CaptainCombatMods | undefined {
  return captainCombatMods(commandingCaptainOf(state, ship));
}

// A repair divisor's speed-up with Damage Control on top: (1 + bonus) x (1 + repair) - 1. The bonus unchanged
// without the node (byte-identical). Pure.
export function withCaptainRepair(speedBonus: number, mods: CaptainCombatMods | undefined): number {
  const r = mods?.repair ?? 0;
  return r > 0 ? (1 + speedBonus) * (1 + r) - 1 : speedBonus;
}

// The Damage Control Suite's between-wave patch-up fraction with Damage Control on top (0 stays 0). Pure.
export function captainWaveRegenFraction(fraction: number, mods: CaptainCombatMods | undefined): number {
  const r = mods?.repair ?? 0;
  return r > 0 && fraction > 0 ? fraction * (1 + r) : fraction;
}

// The factor a won patrol wave's materials and credits grow by: Command Presence's share and Patrol Efficiency, each
// its own factor. Exactly 1 + outputShare without the node. Pure.
export function patrolWaveRewardMult(outputShare: number, mods: CaptainCombatMods | undefined): number {
  const loot = mods?.patrolLoot ?? 0;
  return loot > 0 ? (1 + outputShare) * (1 + loot) : 1 + outputShare;
}

// ============================================================================
// Player text (the talent tooltip and the registry claim read THIS, so they agree)
// ============================================================================

const pct = (x: number): string => `${Math.round(x * 1000) / 10}%`;

// The Tactician tree's exact text, from the catalog magnitudes; null for a node of another tree.
export function tacticianEffectText(key: SecondaryTalentKey): string | null {
  const m = tacticianMagnitude(key);
  switch (key) {
    case "gunnery1":
      return `+${pct(m)} weapon damage in ship battles (patrols and expedition ship events)`;
    case "gunnery2":
      return `+${pct(m)} weapon accuracy in ship battles`;
    case "gunnery3":
      return `+${pct(m)} weapon damage against a target above ${pct(OVERCHARGE_HULL_SHARE)} hull`;
    case "gunnery4":
      return `+${pct(m)} weapon fire rate: every weapon's cooldown is divided by ${Math.round((1 + m) * 100) / 100} in ship battles`;
    case "gunnery5":
      return `Alpha Strike: +${pct(m)} damage on each weapon's first shot of a battle`;
    case "aegis1":
      return `+${pct(m)} shield capacity and recharge in ship battles`;
    case "aegis2":
      return `+${pct(m)} hull in ship battles`;
    case "aegis3":
      return `+${pct(m)} hull repair rate (Shipyard repairs, field repairs, the Damage Control Suite between waves)`;
    case "aegis4":
      return `+${pct(m)} evasion: enemy hit chance against the ship is divided by ${Math.round((1 + m) * 100) / 100}`;
    case "aegis5":
      return `Bulwark: ${m === 1 ? "once" : `${m} times`} per battle, a hit that would destroy the ship leaves it at 1 hull`;
    case "fleetOps1":
      return `+${pct(m)} drone damage`;
    case "fleetOps2":
      return `+${pct(m)} drone hit points`;
    case "fleetOps3":
      return `+${pct(m)} patrol returns (the materials and credits of every won wave)`;
    case "fleetOps4":
      return `+${pct(m)} drone replenish rate (destroyed and disrupted drones recover faster)`;
    case "fleetOps5":
      return `Wolfpack: +${m} drone squadron${m === 1 ? "" : "s"}, a copy of the first installed pod's squadron`;
    default:
      return null;
  }
}
