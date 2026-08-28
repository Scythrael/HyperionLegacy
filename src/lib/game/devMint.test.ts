// ============================================================================
// devMint.test.ts : the DEV-ONLY crafted-gear minter contract.
//
// devMintFromBlueprint mints a REAL crafted EquipmentInstance off a blueprint at a
// caller-chosen quality / iLevel / rarity (the QA path for conjuring a q4 / q5
// combat piece on demand). These tests lock the load-bearing guarantees the dev
// panel relies on:
//   - the CHOSEN quality / iLevel / rarity land on the minted piece verbatim,
//   - the piece carries the blueprint's REAL key (blueprintKey set), so it is a
//     genuine crafted item and NOT a Standard-Issue baseline (the safety predicate
//     isStandardIssueBaseline returns false),
//   - the correct generator is dispatched per blueprint output shape (weapon ->
//     slotType "weapon", drone -> "droneBay", equipment -> the economy/defensive
//     slot), and
//   - a non-gear blueprint (material / unlock-only) mints nothing (null).
//
// rng is a fixed stub (only the affix picks read it; quality/iLevel/rarity are the
// caller's explicit choice, so a constant stream is fully deterministic here).
// ============================================================================

import { describe, it, expect } from "vitest";
import { devMintFromBlueprint } from "./devMint";
import { BLUEPRINTS, isStandardIssueBaseline } from "./model";

// A fixed rng: constant 0.5. Only generate*'s internal affix picks consume it; the
// quality / iLevel / rarity under test are explicit arguments, so this is enough to
// make every mint below fully deterministic.
const rng = () => 0.5;
const allocateId = () => "equip-test-1";

describe("devMintFromBlueprint", () => {
  it("mints a quality-5 weapon: q5, real blueprintKey, slotType weapon, NOT a baseline", () => {
    const piece = devMintFromBlueprint({
      blueprint: BLUEPRINTS.plasmaBp,
      iLevel: 40,
      quality: 5,
      rarity: "radiant",
      rng,
      allocateId,
    });
    expect(piece).not.toBeNull();
    // Non-null asserted above; the ! is safe for the field reads below.
    expect(piece!.quality).toBe(5);
    expect(piece!.iLevel).toBe(40);
    expect(piece!.rarity).toBe("radiant");
    expect(piece!.slotType).toBe("weapon");
    expect(piece!.weaponType).toBe("plasma");
    // The REAL crafted-item guarantee: a set blueprintKey, and therefore NOT a baseline.
    expect(piece!.blueprintKey).toBe("plasmaBp");
    expect(isStandardIssueBaseline(piece!)).toBe(false);
  });

  it("mints a quality-4 hull plating: q4, slotType hullPlating, real key, NOT a baseline", () => {
    const piece = devMintFromBlueprint({
      blueprint: BLUEPRINTS.reinforcedPlatingBp,
      iLevel: 20,
      quality: 4,
      rarity: "stellar",
      rng,
      allocateId,
    });
    expect(piece).not.toBeNull();
    expect(piece!.quality).toBe(4);
    expect(piece!.slotType).toBe("hullPlating");
    expect(piece!.blueprintKey).toBe("reinforcedPlatingBp");
    expect(isStandardIssueBaseline(piece!)).toBe(false);
  });

  it("mints a drone pod: slotType droneBay, role from the blueprint, NOT a baseline", () => {
    const piece = devMintFromBlueprint({
      blueprint: BLUEPRINTS.attackDronePodBp,
      iLevel: 20,
      quality: 5,
      rarity: "radiant",
      rng,
      allocateId,
    });
    expect(piece).not.toBeNull();
    expect(piece!.slotType).toBe("droneBay");
    expect(piece!.droneRole).toBe("attack");
    expect(piece!.blueprintKey).toBe("attackDronePodBp");
    expect(isStandardIssueBaseline(piece!)).toBe(false);
  });

  it("mints a shield emitter (economy-path equipment): slotType shieldEmitters, real key", () => {
    const piece = devMintFromBlueprint({
      blueprint: BLUEPRINTS.balancedEmitterBp,
      iLevel: 40,
      quality: 3,
      rarity: "augmented",
      rng,
      allocateId,
    });
    expect(piece).not.toBeNull();
    expect(piece!.slotType).toBe("shieldEmitters");
    expect(piece!.blueprintKey).toBe("balancedEmitterBp");
    expect(isStandardIssueBaseline(piece!)).toBe(false);
  });

  it("returns null for a material blueprint (mints no gear)", () => {
    const piece = devMintFromBlueprint({
      blueprint: BLUEPRINTS.frameSegmentBp,
      iLevel: 40,
      quality: 5,
      rarity: "radiant",
      rng,
      allocateId,
    });
    expect(piece).toBeNull();
  });
});
