import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import Decimal from "break_infinity.js";
import { BLUEPRINTS } from "./model";
import { uninspectedBlanksFor } from "./pickerBlanks";

// Playtest F1 (2026-11-19): a crafted Class II drive sat as an uninspected blank while the install picker said
// "Fabricate one". The count below drives the picker's pointer to Logistics, Crafted Blanks.
describe("uninspectedBlanksFor", () => {
  const store = {
    classIIDriveBp: [new Decimal(1)],
    balancedDriveBp: [new Decimal(0), new Decimal(2)], // two at Q1
    plasmaBp: [new Decimal(3)],
    attackDronePodBp: [new Decimal(4)],
    notARealBlueprint: [new Decimal(9)],
  };

  it("the keys this test relies on exist with the expected output shapes", () => {
    expect(BLUEPRINTS.classIIDriveBp?.equipmentOutput?.slotType).toBe("ftlDrive");
    expect(BLUEPRINTS.balancedDriveBp?.equipmentOutput?.slotType).toBe("ftlDrive");
    expect(BLUEPRINTS.plasmaBp?.weaponOutput).toBeDefined();
    expect(BLUEPRINTS.attackDronePodBp?.droneOutput).toBeDefined();
  });

  it("counts every quality of every blueprint that fills the slot", () => {
    expect(uninspectedBlanksFor(store, { kind: "slot", slotType: "ftlDrive" }).toNumber()).toBe(3);
  });

  it("counts weapon and drone blanks for hardpoints and bays", () => {
    expect(uninspectedBlanksFor(store, { kind: "weapon" }).toNumber()).toBe(3);
    expect(uninspectedBlanksFor(store, { kind: "drone" }).toNumber()).toBe(4);
  });

  it("is zero for a slot with no blanks, an empty store, and ignores unknown keys", () => {
    expect(uninspectedBlanksFor(store, { kind: "slot", slotType: "reactorCore" }).toNumber()).toBe(0);
    expect(uninspectedBlanksFor({}, { kind: "slot", slotType: "ftlDrive" }).toNumber()).toBe(0);
  });

  it("the install picker's empty state reads the count and names the inspect step", () => {
    const src = readFileSync("src/lib/ShipSystemsPanel.svelte", "utf8");
    expect(src).toContain("uninspectedBlanksFor(state.blanks, pickerBlankTarget)");
    expect(src).toContain("under Logistics, Crafted Blanks to roll a system you can install.");
    expect(src).toContain("Fabricate one and inspect it under Logistics, Crafted Blanks, or uninstall one from another ship.");
    expect(src).not.toContain("Fabricate one, or uninstall from another ship.");
  });
});
