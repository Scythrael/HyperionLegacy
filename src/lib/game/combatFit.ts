// ============================================================================
// combatFit.ts -- pure combat-fit readout helpers (Combat 1.0, Unit 1.8b)
// Author: Claude (Opus 4.8) | 2026-08-12
// Reworked 2026-08-27 (combat-defense rework, Unit 6): the readout now folds
// defense the SAME way the sim does (innate ship stats + item gear), instead of
// the retired frame+plating split, so the ShipSystemsPanel shows the REAL combat
// numbers a dispatched ship fights with.
//
// The combat-slot install PANEL (ShipSystemsPanel.svelte) needs derived facts about
// a ship's INSTALLED combat gear, all pure functions of the fitted EquipmentInstance[]
// + the hull's static stats:
//   1. the combat READOUT split three ways so the innate-vs-gear composition is
//      legible: the hull's INNATE stats (innate armor + shield amplification mults +
//      hardpoint / drone-bay caps), the DEFENSIVE totals (hull = innate + plating,
//      shield = emitter cap x amplification), and the OFFENSIVE / SUPPORT gear lists,
//   2. which combat slots are still EMPTY (drives the panel's advisory wording),
//   3. the ordered lists of installed weapons + drone pods (the strip cells).
//
// These are extracted OUT of the Svelte component so they are unit-testable in
// isolation (no DOM), and so the panel is a thin presenter over one computation.
//
// PURE: every function reads its inputs and returns fresh values, mutating nothing.
// It reads `hullInnateDefense` (combat/bridge.ts) so the innate + gear composition
// here matches the sim's fold (shipToCombatant) EXACTLY: one source of truth for the
// split, and the numbers the panel shows equal the numbers the ship fights with.
// A combat leaf (combatFit) importing a combat leaf (bridge) is the allowed direction.
// ============================================================================

import type { EquipmentInstance } from "./model";
import { hullInnateDefense, type CombatShipStats } from "./combat/bridge";

// The three combat slots the ShipSystemsPanel readout reports as still empty.
// NOTE (combat-defense rework, Unit 3): these are NO LONGER hard dispatch requirements.
// canDispatchPatrol now hard-blocks ONLY on an empty reactor; a missing weapon is a
// non-blocking dispatch advisory ("cannot return fire"), and a missing shield emitter /
// hull plating are silent player choices (a bare hull keeps its innate armor; no emitter
// means simply 0 shields). This list stays a "combat completeness" readout for the install
// panel (what is still worth installing), and the panel words it as an advisory, never a
// hard block. The type name is retained (internal, this-file + panel + test only) with this
// clarifying comment rather than renamed, to keep the diff scoped to the fold fix.
export type RequiredCombatSlot = "weapon" | "shieldEmitters" | "hullPlating";

// The fully-derived combat readout for one ship: everything the panel's Innate /
// Offensive / Defensive / Support readout sections render from.
export interface CombatReadout {
  // --- OFFENSIVE ------------------------------------------------------------
  // Installed weapon pieces, in fitted (state.equipment) order, so the hardpoint
  // strip can index cells positionally and the count matches the sim's loadout.
  mountedWeapons: EquipmentInstance[];
  // The hull's weapon hardpoint cap (SHIP_TYPES[hull].weaponHardpoints).
  hardpointCap: number;

  // --- SUPPORT (carrier-only) ----------------------------------------------
  // Installed DRONE POD pieces (slotType "droneBay"), in fitted order, one per filled
  // bay cell, EXACTLY as mountedWeapons does for hardpoints. Empty on any hull with no
  // bays (a non-carrier), so the panel's Support group shows a "no drone bays" empty state.
  mountedPods: EquipmentInstance[];
  // The hull's drone bay cap (SHIP_TYPES[hull].droneBays; 0 on a non-carrier). The DRONE
  // analogue of hardpointCap. Drone bays are OPTIONAL, so this never contributes to
  // missingRequired below.
  droneBayCap: number;

  // The installed singleton combat pieces (null when the slot is stripped bare).
  shieldEmitter: EquipmentInstance | null;
  hullPlating: EquipmentInstance | null;

  // --- INNATE (the hull itself) --------------------------------------------
  // Derived from the hull's authored SHIP_TYPES totals against the fixed SI-gear dials
  // (hullInnateDefense, design 3a/4): the standalone armor pool the bare hull contributes,
  // and the multipliers it applies to an installed emitter ("wired for shields"). These are
  // the SAME innate values shipToCombatant folds, so the panel's composition matches combat.
  innateHullArmor: number;
  innateShieldCapMult: number;
  innateShieldRechargeMult: number;

  // --- DEFENSIVE (composition = innate + gear) ------------------------------
  // Hull: innate armor + the installed plating's raw hullStrength (0 when bare). hullTotal
  // is exactly what the sim's hull pool folds to; platingHullStrength is shown as the "+ N"
  // gear part so the innate/gear split is legible (e.g. "640 = 500 innate + 140").
  platingHullStrength: number;
  hullTotal: number;
  // Shield: the emitter's RAW cap / recharge (0 when no emitter), and the AMPLIFIED totals
  // the sim actually fights with (raw x (1 + innate mult); 0 with no emitter, because an
  // emitter is the shield SOURCE and the mult has nothing to amplify). shieldTotal /
  // rechargeTotal equal shipToCombatant's shield pool + regen exactly. Shown as
  // "300 = 100 x 3.0" so the raw-cap-times-amplification composition reads clearly.
  emitterCap: number;
  emitterRecharge: number;
  shieldTotal: number;
  rechargeTotal: number;

  // Mitigation affix off the plating (0 when absent or un-rolled). Shown so the
  // "Ablative armor" readout row is real the moment a plating piece rolls it.
  ablativeArmor: number;

  // Which combat slots are still EMPTY (drives the panel's advisory wording). Empty array
  // => every combat slot is filled. NOT a hard-dispatch gate (see the type comment above).
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
// (equippedFor()'s array); `stats` is the hull's combat stat source (a SHIP_TYPES
// entry, or a plain literal of the same three fields in tests) from which the innate
// side is derived; `hardpointCap` is SHIP_TYPES[hull].weaponHardpoints, and
// `droneBayCap` is SHIP_TYPES[hull].droneBays (0 on a non-carrier). PURE.
//
// The `stats` object (CombatShipStats: hullIntegrity / shieldCapacity / shieldRecharge)
// replaced the old bare hullIntegrity number so the innate shield mults can be derived
// here the SAME way the bridge derives them; a real SHIP_TYPES entry satisfies the Pick
// structurally, so the panel passes shipDef directly.
//
// droneBayCap defaults to 0 so a caller that does not care about drones (an economy
// context, or an older call site) reads a carrier-free readout, and only the panel
// passes the real bay count.
export function computeCombatReadout(
  gear: EquipmentInstance[],
  stats: CombatShipStats,
  hardpointCap: number,
  droneBayCap = 0
): CombatReadout {
  // Partition the fitted gear by combat slot. Weapons keep their fitted order (a
  // MULTI slot); shield + plating are singletons (at most one each per ship).
  const mountedWeapons = gear.filter((p) => p.slotType === "weapon");
  const shieldEmitter = gear.find((p) => p.slotType === "shieldEmitters") ?? null;
  const hullPlating = gear.find((p) => p.slotType === "hullPlating") ?? null;
  // Drone pods are the OTHER MULTI slot: keep their fitted order, one per bay cell,
  // EXACTLY as weapons above. A non-carrier fits none, so this is [].
  const mountedPods = gear.filter((p) => p.slotType === "droneBay");

  // The hull's INNATE defense (design 3a/4), derived from its authored SHIP_TYPES totals
  // against the fixed SI dials. This is the SAME helper shipToCombatant folds through, so
  // the innate + gear composition below is byte-identical to what the ship fights with.
  const innate = hullInnateDefense(stats);

  // DEFENSIVE composition (design 3c) -- identical to shipToCombatant's fold:
  //   hull   = innateHullArmor + plating.hullStrength      (plating OPTIONAL; bare hull is armored)
  //   shield = emitter.shieldCapacity  * (1 + capMult)     (0 with no emitter; emitter is the source)
  //   rech   = emitter.shieldRecharge  * (1 + rechMult)    (0 with no emitter)
  const platingHullStrength = hullPlating ? statOf(hullPlating, "hullStrength") : 0;
  const hullTotal = innate.innateHullArmor + platingHullStrength;

  const emitterCap = shieldEmitter ? statOf(shieldEmitter, "shieldCapacity") : 0;
  const emitterRecharge = shieldEmitter ? statOf(shieldEmitter, "shieldRecharge") : 0;
  const shieldTotal = shieldEmitter ? emitterCap * (1 + innate.innateShieldCapMult) : 0;
  const rechargeTotal = shieldEmitter ? emitterRecharge * (1 + innate.innateShieldRechargeMult) : 0;

  // Ablative armor is a rolled affix only (never a signature implicit), so read the
  // rolled value directly; 0 when the plating is absent or rolled none.
  const ablativeArmor = hullPlating ? hullPlating.rolledStats.ablativeArmor ?? 0 : 0;

  // Which combat slots are still EMPTY, in a stable order. This drives the panel's
  // advisory wording (a missing weapon = "cannot return fire"; a missing plating / shield =
  // an optional, unstyled note), NOT a hard dispatch block (only an empty reactor blocks).
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
    innateHullArmor: innate.innateHullArmor,
    innateShieldCapMult: innate.innateShieldCapMult,
    innateShieldRechargeMult: innate.innateShieldRechargeMult,
    platingHullStrength,
    hullTotal,
    emitterCap,
    emitterRecharge,
    shieldTotal,
    rechargeTotal,
    ablativeArmor,
    missingRequired,
  };
}
