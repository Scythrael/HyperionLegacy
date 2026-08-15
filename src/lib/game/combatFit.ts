// ============================================================================
// combatFit.ts -- pure combat-fit readout helpers (Combat 1.0, Unit 1.8b)
// Author: Claude (Opus 4.8) | 2026-08-12
//
// The combat-slot install PANEL (ShipSystemsPanel.svelte) needs three derived
// facts about a ship's INSTALLED combat gear, all pure functions of the fitted
// EquipmentInstance[] + the hull's static stats:
//   1. the combat READOUT (hull = frame + plating, shield capacity/recharge,
//      weapons mounted N / hardpoint cap),
//   2. which REQUIRED combat slots are still empty (the dispatch-blocker banner),
//   3. the ordered list of installed weapons (the hardpoint strip cells).
//
// These are extracted OUT of the Svelte component so they are unit-testable in
// isolation (no DOM), and so the "is this ship dispatchable?" answer here reads
// the SAME slot rules the engine's real dispatch gate uses (tick.ts
// canDispatchPatrol: >=1 weapon + a shieldEmitters + a hullPlating). The panel is
// then a thin presenter over this one computation.
//
// PURE: every function reads its inputs and returns fresh values, mutating nothing.
// It reads the combat leaf `frameHp` (combat/bridge.ts) so the hull-pool fold here
// matches the sim's fold EXACTLY (design 6a: hull = frameHp(hullIntegrity) +
// installed hullPlating.hullStrength), i.e. one source of truth for the split.
// ============================================================================

import type { EquipmentInstance } from "./model";
import { frameHp } from "./combat/bridge";

// The three REQUIRED combat slots a combat hull must have filled to patrol. This
// list is the panel's mirror of tick.ts canDispatchPatrol's per-slot gate order
// (noWeapon -> noShieldEmitter -> noHullPlating), so the banner names the exact
// same missing slots the dispatch gate would block on.
export type RequiredCombatSlot = "weapon" | "shieldEmitters" | "hullPlating";

// The fully-derived combat readout for one ship, everything the panel's combat
// section + banner + weapon strip render from.
export interface CombatReadout {
  // Installed weapon pieces, in fitted (state.equipment) order, so the hardpoint
  // strip can index cells positionally and the count matches the sim's loadout.
  mountedWeapons: EquipmentInstance[];
  // The hull's weapon hardpoint cap (SHIP_TYPES[hull].weaponHardpoints).
  hardpointCap: number;
  // Combat 1.0 (Unit 2.4): installed DRONE POD pieces (slotType "droneBay"), in fitted
  // order, one per filled bay cell, EXACTLY as mountedWeapons does for hardpoints. Empty
  // on any hull with no bays (a non-carrier), so the panel's drone strip stays carrier-only.
  mountedPods: EquipmentInstance[];
  // The hull's drone bay cap (SHIP_TYPES[hull].droneBays; 0 on a non-carrier). The DRONE
  // analogue of hardpointCap. Drone bays are OPTIONAL (unlike the three required combat
  // slots), so this never contributes to missingRequired below.
  droneBayCap: number;
  // The installed singleton combat pieces (null when the slot is stripped bare).
  shieldEmitter: EquipmentInstance | null;
  hullPlating: EquipmentInstance | null;
  // Hull pool split (design 6a): intrinsic frame + plating.hullStrength = total.
  frameHp: number;
  platingHp: number;
  hullTotal: number;
  // Shield pool + regen from the installed emitter (0 when stripped bare).
  shieldCapacity: number;
  shieldRecharge: number;
  // Mitigation affixes off the plating (0 when absent or un-rolled). Shown so the
  // "Ablative armor" readout row is real the moment a plating piece rolls it.
  ablativeArmor: number;
  // Which required combat slots are still EMPTY (drives the dispatch-blocker banner).
  // Empty array => the ship is combat-dispatchable (as far as slots are concerned).
  missingRequired: RequiredCombatSlot[];
}

// The combined magnitude of one stat line on a piece: its implicit (signature)
// value PLUS any rolled affix of the same key. Mirrors combat/bridge.ts statOf
// EXACTLY (that is the fold the sim uses), so the panel's readout equals combat.
// Absent keys read 0. PURE.
function statOf(piece: EquipmentInstance, key: string): number {
  return (piece.implicitStats[key] ?? 0) + (piece.rolledStats[key] ?? 0);
}

// computeCombatReadout: fold a ship's INSTALLED combat gear + its hull stats into
// the readout the panel renders. `gear` is the pieces fitted to the ship
// (equippedFor()'s array), `hullIntegrity` is SHIP_TYPES[hull].hullIntegrity,
// `hardpointCap` is SHIP_TYPES[hull].weaponHardpoints, and `droneBayCap` is
// SHIP_TYPES[hull].droneBays (0 on a non-carrier). PURE.
//
// droneBayCap defaults to 0 so a caller that does not care about drones (an economy
// context, or an older 3-arg call site) reads a carrier-free readout unchanged, and
// only the carrier panel passes the real bay count.
export function computeCombatReadout(
  gear: EquipmentInstance[],
  hullIntegrity: number,
  hardpointCap: number,
  droneBayCap = 0
): CombatReadout {
  // Partition the fitted gear by combat slot. Weapons keep their fitted order (a
  // MULTI slot); shield + plating are singletons (at most one each per ship).
  const mountedWeapons = gear.filter((p) => p.slotType === "weapon");
  const shieldEmitter = gear.find((p) => p.slotType === "shieldEmitters") ?? null;
  const hullPlating = gear.find((p) => p.slotType === "hullPlating") ?? null;
  // Drone pods are the OTHER MULTI slot (Combat 1.0, Unit 2.4): keep their fitted order,
  // one per bay cell, EXACTLY as weapons above. A non-carrier fits none, so this is [].
  const mountedPods = gear.filter((p) => p.slotType === "droneBay");

  // Hull pool (design 6a): frame is intrinsic; plating carries the remainder.
  const frame = frameHp(hullIntegrity);
  const platingHp = hullPlating ? statOf(hullPlating, "hullStrength") : 0;

  // Shield pool + regen come purely from the emitter (design 5a): no emitter, no shields.
  const shieldCapacity = shieldEmitter ? statOf(shieldEmitter, "shieldCapacity") : 0;
  const shieldRecharge = shieldEmitter ? statOf(shieldEmitter, "shieldRecharge") : 0;

  // Ablative armor is a rolled affix only (never a signature implicit), so read the
  // rolled value directly; 0 when the plating is absent or rolled none.
  const ablativeArmor = hullPlating ? hullPlating.rolledStats.ablativeArmor ?? 0 : 0;

  // Missing required slots, in canDispatchPatrol's gate order so the banner names
  // them the same way the dispatch gate would.
  const missingRequired: RequiredCombatSlot[] = [];
  if (mountedWeapons.length === 0) missingRequired.push("weapon");
  if (shieldEmitter === null) missingRequired.push("shieldEmitters");
  if (hullPlating === null) missingRequired.push("hullPlating");

  return {
    mountedWeapons,
    hardpointCap,
    mountedPods,
    droneBayCap,
    shieldEmitter,
    hullPlating,
    frameHp: frame,
    platingHp,
    hullTotal: frame + platingHp,
    shieldCapacity,
    shieldRecharge,
    ablativeArmor,
    missingRequired,
  };
}
