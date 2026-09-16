// armory.test.ts — ITEM LIFECYCLE 0.13.6 (Phase 3). Loadout create / rename / delete mechanics.
import { describe, it, expect } from "vitest";
import { freshState, SHIP_TYPES } from "./model";
import {
  createLoadout, renameLoadout, deleteLoadout, loadoutCap, canCreateLoadout,
  loadoutSlotDefsForShipType, installIntoLoadout, uninstallFromLoadout,
} from "./armory";

describe("armory: loadout create / rename / delete (Item Lifecycle 0.13.6)", () => {
  it("createLoadout appends an empty loadout pinned to the ship type and advances the id source", () => {
    const s = freshState();
    const { next, loadoutId } = createLoadout(s, "destroyer", "Reaper");
    expect(loadoutId).toBe(`loadout-${s.nextLoadoutId}`);
    expect(next.loadouts).toHaveLength(1);
    const lo = next.loadouts[0];
    expect(lo.id).toBe(loadoutId);
    expect(lo.name).toBe("Reaper");
    expect(lo.shipTypeKey).toBe("destroyer");
    expect(lo.slots).toEqual({}); // empty slots are absent, not pre-seeded
    expect(lo.checkedOutToShipId).toBeNull();
    expect(next.nextLoadoutId).toBe(s.nextLoadoutId + 1);
  });

  it("createLoadout refuses an invalid ship type (same ref, null id)", () => {
    const s = freshState();
    const { next, loadoutId } = createLoadout(s, "notAHull" as any);
    expect(next).toBe(s);
    expect(loadoutId).toBeNull();
  });

  it("createLoadout refuses when the roster is at the cap", () => {
    const cap = loadoutCap(freshState());
    const full: any = {
      ...freshState(),
      loadouts: Array.from({ length: cap }, (_, i) => ({
        id: `loadout-${i + 1}`, name: "x", shipTypeKey: "destroyer", slots: {}, checkedOutToShipId: null,
      })),
      nextLoadoutId: cap + 1,
    };
    expect(canCreateLoadout(full)).toBe(false);
    const { next, loadoutId } = createLoadout(full, "destroyer");
    expect(next).toBe(full);
    expect(loadoutId).toBeNull();
  });

  it("renameLoadout renames (trimmed); ignores an empty name; same ref when missing", () => {
    const { next } = createLoadout(freshState(), "destroyer", "Old");
    const id = next.loadouts[0].id;
    expect(renameLoadout(next, id, "  New Name  ").loadouts[0].name).toBe("New Name");
    expect(renameLoadout(next, id, "   ")).toBe(next); // empty -> no-op
    expect(renameLoadout(next, "nope", "X")).toBe(next); // missing -> no-op
  });

  it("deleteLoadout removes it and returns committed gear to the spare pool (committedToLoadoutId cleared)", () => {
    const base = freshState();
    const committed = { ...base.equipment[0], id: "equip-committed", fittedToShipId: null, committedToLoadoutId: "loadout-1" };
    const s: any = {
      ...base,
      equipment: [...base.equipment, committed],
      loadouts: [{ id: "loadout-1", name: "L", shipTypeKey: "destroyer", slots: { cargoBay: "equip-committed" }, checkedOutToShipId: null }],
      nextLoadoutId: 2,
    };
    const after = deleteLoadout(s, "loadout-1");
    expect(after.loadouts).toHaveLength(0);
    expect(after.equipment.find((e) => e.id === "equip-committed")!.committedToLoadoutId).toBeUndefined();
  });

  it("deleteLoadout refuses while the loadout is checked out (same ref)", () => {
    const s: any = {
      ...freshState(),
      loadouts: [{ id: "loadout-1", name: "L", shipTypeKey: "destroyer", slots: {}, checkedOutToShipId: "ship-1" }],
      nextLoadoutId: 2,
    };
    expect(deleteLoadout(s, "loadout-1")).toBe(s);
  });
});

describe("armory: slot derivation + install / uninstall (Item Lifecycle 0.13.6)", () => {
  it("loadoutSlotDefsForShipType matches the hull's SHIP_TYPES slots", () => {
    const defs = loadoutSlotDefsForShipType("destroyer");
    const dt = SHIP_TYPES.destroyer;
    expect(defs.filter((d) => d.slotType === "weapon")).toHaveLength(dt.weaponHardpoints);
    expect(defs.filter((d) => d.slotType === "droneBay")).toHaveLength(dt.droneBays ?? 0);
    expect(defs.some((d) => d.slotType === "shieldEmitters")).toBe(true);
    expect(defs.some((d) => d.slotType === "hullPlating")).toBe(true);
    expect(defs.some((d) => d.slotType === "cargoBay")).toBe(true);
    expect(defs.some((d) => d.slotType === "specUtility")).toBe(dt.spec === "prospector");
  });

  it("a prospector-spec hull gets the specUtility slot", () => {
    expect(SHIP_TYPES.prospectorMiner.spec).toBe("prospector"); // guard the fixture
    expect(loadoutSlotDefsForShipType("prospectorMiner").some((d) => d.slotType === "specUtility")).toBe(true);
  });

  function stateWithSpareWeapon(): any {
    const base = freshState();
    const weapon = { ...base.equipment[0], id: "equip-wpn", slotType: "weapon", fittedToShipId: null, committedToLoadoutId: undefined };
    return {
      ...base,
      equipment: [...base.equipment, weapon],
      loadouts: [{ id: "loadout-1", name: "L", shipTypeKey: "destroyer", slots: {}, checkedOutToShipId: null }],
      nextLoadoutId: 2,
    };
  }

  it("installIntoLoadout commits a spare into a matching slot", () => {
    const after = installIntoLoadout(stateWithSpareWeapon(), "loadout-1", "weapon0", "equip-wpn");
    expect(after.loadouts[0].slots.weapon0).toBe("equip-wpn");
    expect(after.equipment.find((e) => e.id === "equip-wpn")!.committedToLoadoutId).toBe("loadout-1");
  });

  it("installIntoLoadout refuses wrong slotType, a bad slot key, a non-spare, and a checked-out loadout", () => {
    const s = stateWithSpareWeapon();
    expect(installIntoLoadout(s, "loadout-1", "cargoBay", "equip-wpn")).toBe(s); // weapon into a cargo slot
    expect(installIntoLoadout(s, "loadout-1", "weapon99", "equip-wpn")).toBe(s); // no such hardpoint
    const fittedId = s.equipment.find((e: any) => e.fittedToShipId !== null)!.id;
    expect(installIntoLoadout(s, "loadout-1", "weapon0", fittedId)).toBe(s); // not a free spare
    const co = { ...s, loadouts: [{ ...s.loadouts[0], checkedOutToShipId: "ship-1" }] };
    expect(installIntoLoadout(co, "loadout-1", "weapon0", "equip-wpn")).toBe(co); // checked out
  });

  it("install then uninstall returns the system to the spare pool", () => {
    const installed = installIntoLoadout(stateWithSpareWeapon(), "loadout-1", "weapon0", "equip-wpn");
    const after = uninstallFromLoadout(installed, "loadout-1", "weapon0");
    expect(after.loadouts[0].slots.weapon0).toBeUndefined();
    expect(after.equipment.find((e) => e.id === "equip-wpn")!.committedToLoadoutId).toBeUndefined();
  });

  it("installIntoLoadout swaps: the previous system returns to the pool", () => {
    const s = stateWithSpareWeapon();
    const weapon2 = { ...s.equipment[0], id: "equip-wpn2", slotType: "weapon", fittedToShipId: null, committedToLoadoutId: undefined };
    const s2: any = { ...s, equipment: [...s.equipment, weapon2] };
    const first = installIntoLoadout(s2, "loadout-1", "weapon0", "equip-wpn");
    const swapped = installIntoLoadout(first, "loadout-1", "weapon0", "equip-wpn2");
    expect(swapped.loadouts[0].slots.weapon0).toBe("equip-wpn2");
    expect(swapped.equipment.find((e) => e.id === "equip-wpn2")!.committedToLoadoutId).toBe("loadout-1");
    expect(swapped.equipment.find((e) => e.id === "equip-wpn")!.committedToLoadoutId).toBeUndefined();
  });
});
