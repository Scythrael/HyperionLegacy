// armory.test.ts — ITEM LIFECYCLE 0.13.6 (Phase 3). Loadout create / rename / delete mechanics.
import { describe, it, expect } from "vitest";
import { freshState } from "./model";
import { createLoadout, renameLoadout, deleteLoadout, loadoutCap, canCreateLoadout } from "./armory";

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
