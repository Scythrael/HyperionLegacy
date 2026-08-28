// ============================================================================
// devMint.ts : DEV-ONLY crafted-gear minter (Combat 1.0 QA support)
//
// Author : feat/combat-0.13.0 (dev-panel QA tooling)
// Scope  : ONE pure function, devMintFromBlueprint, that mints a REAL crafted
//          EquipmentInstance off a blueprint at a CALLER-CHOSEN quality / iLevel
//          / rarity, instead of rolling them the way the Fabricator does. It is
//          the QA counterpart to the Fabricator mint in tick.ts: the developer
//          needs to conjure a quality-4 or quality-5 combat piece (weapon /
//          shield emitter / hull plating / drone pod) on demand to exercise the
//          crafted-gear-drives-combat features, which random crafting rarely
//          produces.
//
// WHY a blueprint drives the mint (not raw slot/variety selectors):
//   - The blueprint's OUTPUT SHAPE (equipmentOutput / weaponOutput / droneOutput)
//     already names the exact slotType + variety / weaponType / droneRole a real
//     craft uses, so every minted piece is shape-identical to genuinely-crafted
//     gear. No invalid slot/variety pairing is reachable.
//   - The blueprint's KEY becomes the piece's blueprintKey, so the item is a REAL
//     crafted item: isStandardIssueBaseline() is false (it is never rarity
//     "standard" WITH a null key), it counts against the spare-storage cap like
//     any crafted system, and (crucially) it is SALVAGE-SAFE, because salvage
//     reads BLUEPRINTS[blueprintKey].recipe and a real key always resolves. A
//     synthetic made-up key would crash salvage; this path never can.
//
// WHY this is NOT folded into the Fabricator's tick.ts mint: that mint ROLLS
// quality / rarity / iLevel off the seeded, parity-critical rng stream (the
// offline==live contract). This helper takes them as explicit arguments and is
// only ever called from the DEV_MODE-gated dev panel, so it must NOT perturb the
// tick hot path. It reuses the SAME three generators (generateEquipment /
// generateWeapon / generateDronePod) the Fabricator uses, so the minted shape is
// identical; only the source of quality/iLevel/rarity differs (dev choice vs roll).
//
// PURE + deterministic: no GameState mutation, no RNG creation, no side effects.
// The caller injects rng + allocateId exactly as it does for the generators.
// ============================================================================

import {
  blueprintKind,
  type BlueprintDef,
  type EquipmentInstance,
  type EquipmentRarity,
} from "./model";
import { generateEquipment, generateWeapon, generateDronePod } from "./itemgen";

// devMintFromBlueprint: mint one crafted EquipmentInstance off `blueprint` at the
// caller-chosen iLevel / quality / rarity, dispatching to the correct generator by
// the blueprint's output shape. Returns the minted spare (fittedToShipId null, set
// inside the generators), or null when the blueprint mints no gear (an unlock-only
// or material blueprint), so the caller can guard instead of the helper throwing.
//
// The dispatch precedence (weapon -> drone -> equipment) mirrors tick.ts's mint
// EXACTLY via the shared blueprintKind() classifier, so the two paths can never
// disagree about which generator a given blueprint feeds. blueprintKey is set to
// the blueprint's own key on every branch (a REAL crafted item, never a baseline).
export function devMintFromBlueprint(a: {
  blueprint: BlueprintDef;
  iLevel: number;
  quality: number;
  rarity: EquipmentRarity;
  rng: () => number;
  allocateId: () => string;
}): EquipmentInstance | null {
  const kind = blueprintKind(a.blueprint);

  // WEAPON: slotType "weapon", minted off the blueprint's weaponOutput.weaponType
  // (a WeaponId). Same generator + blueprintKey wiring as the Fabricator's weapon
  // branch, only quality/iLevel/rarity come from the caller instead of a roll.
  if (kind === "weapon" && a.blueprint.weaponOutput !== undefined) {
    return generateWeapon({
      weaponType: a.blueprint.weaponOutput.weaponType,
      blueprintKey: a.blueprint.key,
      iLevel: a.iLevel,
      quality: a.quality,
      rarity: a.rarity,
      ascension: "none", // base craft: never ascended (matches the Fabricator mint)
      rng: a.rng,
      allocateId: a.allocateId,
    });
  }

  // DRONE POD: slotType "droneBay", minted off the blueprint's droneOutput.role.
  if (kind === "drone" && a.blueprint.droneOutput !== undefined) {
    return generateDronePod({
      droneRole: a.blueprint.droneOutput.role,
      blueprintKey: a.blueprint.key,
      iLevel: a.iLevel,
      quality: a.quality,
      rarity: a.rarity,
      ascension: "none",
      rng: a.rng,
      allocateId: a.allocateId,
    });
  }

  // ECONOMY + DEFENSIVE EQUIPMENT: cargoBay / ftlDrive / reactorCore / specUtility
  // / shieldEmitters / hullPlating, minted off the blueprint's equipmentOutput
  // (slotType + varietyKey). generateEquipment applies the floored defensive-implicit
  // curves for shieldEmitters / hullPlating internally, identical to a real craft.
  if (kind === "equipment" && a.blueprint.equipmentOutput !== undefined) {
    return generateEquipment({
      slotType: a.blueprint.equipmentOutput.slotType,
      varietyKey: a.blueprint.equipmentOutput.varietyKey,
      blueprintKey: a.blueprint.key,
      iLevel: a.iLevel,
      quality: a.quality,
      rarity: a.rarity,
      ascension: "none",
      rng: a.rng,
      allocateId: a.allocateId,
    });
  }

  // unlockOnly / material blueprints mint no gear: nothing to make, tell the caller.
  return null;
}
