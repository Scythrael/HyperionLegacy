// armory.ts — ITEM LIFECYCLE 0.13.6 (Phase 3, the Armory).
//
// The LOADOUT lifecycle. This increment covers create / rename / delete; install-into-a-loadout and
// check-out-to-a-ship land in later increments (they need the per-hull slot-set derivation and the
// fittedToShipId interplay). Every function here is PURE over GameState, the same posture as
// salvage.ts / homeDashboard.ts: no clock, no rng, so the tick and the UI share one source of truth
// and offline==live is never at risk.
//
// A loadout's `slots` records only FILLED slots (slot key -> committed EquipmentInstance id); an
// empty slot is simply absent. The slot SET a loadout offers is derived from its ship type at
// render / install time (a later increment), so create does not need to enumerate slots.
import type { GameState, Loadout, ShipTypeKey, EquipmentSlotType } from "./model";
import { SHIP_TYPES, startAutoSalvageGrace } from "./model";
// The SHARED on-mission lock (equipment.ts): a ship whose captain is on an active mission cannot have
// its fitment changed. Checkout / check-in reuse it so a loadout can never be swapped mid-mission (the
// user's balance-loophole guard). One-way import (equipment.ts does not import armory.ts), no cycle.
import { onMissionLock } from "./equipment";

// The base loadout count (design: a FLAT 25, talent-expandable). Derived through loadoutCap, the ONE
// reader, so a future loadout-count talent adds to it in exactly one place (content-driven rule).
export const BASE_LOADOUT_COUNT = 25;

export function loadoutCap(_state: GameState): number {
  // + a loadout-count Homeworld talent later; a flat 25 for now.
  return BASE_LOADOUT_COUNT;
}

export function canCreateLoadout(state: GameState): boolean {
  return state.loadouts.length < loadoutCap(state);
}

// Create an empty loadout pinned to a ship type. Returns the new state + the new loadout id, or a
// same-ref no-op + null id on an invalid ship type or a full roster (the UI gates on canCreateLoadout
// but this stays safe if called anyway).
export function createLoadout(
  state: GameState,
  shipTypeKey: ShipTypeKey,
  name = "New Loadout"
): { next: GameState; loadoutId: string | null } {
  if (!(shipTypeKey in SHIP_TYPES)) return { next: state, loadoutId: null };
  if (!canCreateLoadout(state)) return { next: state, loadoutId: null };
  const id = `loadout-${state.nextLoadoutId}`;
  const loadout: Loadout = {
    id,
    name: name.trim() || "New Loadout",
    shipTypeKey,
    slots: {},
    checkedOutToShipId: null,
  };
  return {
    next: { ...state, loadouts: [...state.loadouts, loadout], nextLoadoutId: state.nextLoadoutId + 1 },
    loadoutId: id,
  };
}

// Rename a loadout. Ignores an all-whitespace name (a loadout is never nameless) and is a same-ref
// no-op if the loadout is missing or the name is unchanged.
export function renameLoadout(state: GameState, loadoutId: string, name: string): GameState {
  const trimmed = name.trim();
  if (!trimmed) return state;
  let changed = false;
  const loadouts = state.loadouts.map((l) => {
    if (l.id !== loadoutId || l.name === trimmed) return l;
    changed = true;
    return { ...l, name: trimmed };
  });
  return changed ? { ...state, loadouts } : state;
}

// Delete a loadout, returning any committed gear to the spare pool. REFUSED (same-ref no-op) while
// the loadout is checked out to a ship: check it in first, so a live-equipped set is never deleted
// out from under a ship. Atomic: the released gear's committedToLoadoutId is cleared in the SAME new
// state the loadout is removed in, so a system can neither be stranded nor duplicated.
export function deleteLoadout(state: GameState, loadoutId: string): GameState {
  const loadout = state.loadouts.find((l) => l.id === loadoutId);
  if (loadout === undefined) return state;
  if (loadout.checkedOutToShipId !== null) return state; // refuse while equipped
  const committedIds = new Set(
    Object.values(loadout.slots).filter((v): v is string => v !== null)
  );
  const equipment =
    committedIds.size === 0
      ? state.equipment
      : state.equipment.map((e) =>
          // committed -> free spare: clear the marker AND restart the auto-salvage grace window,
          // so a long-committed system is not queued for destruction the instant it is freed.
          committedIds.has(e.id)
            ? startAutoSalvageGrace({ ...e, committedToLoadoutId: undefined }, state.gameTimeSeconds)
            : e
        );
  return {
    ...state,
    loadouts: state.loadouts.filter((l) => l.id !== loadoutId),
    equipment,
  };
}

// ---------------------------------------------------------------------------
// SLOT-SET DERIVATION + install / uninstall
// ---------------------------------------------------------------------------

// A loadout's slot, DERIVED from its pinned ship type. Mirrors ShipSystemsPanel's own enumeration
// EXACTLY (weapon x weaponHardpoints [Offense]; shieldEmitters + hullPlating + droneBay x droneBays
// [Defense]; cargoBay/ftlDrive/reactorCore always + specUtility only on a prospector-spec hull
// [Systems]) so a loadout never offers a slot a real hull of that type would not have.
export type LoadoutSlotDef = {
  key: string; // stable key in Loadout.slots ("cargoBay", "weapon0", "droneBay1", ...)
  slotType: EquipmentSlotType;
  index: number | null; // 0-based index for a MULTI slot (weapon / droneBay); null for a singleton
  group: "offense" | "defense" | "systems";
  label: string;
};

export function loadoutSlotDefsForShipType(shipTypeKey: ShipTypeKey): LoadoutSlotDef[] {
  const def = SHIP_TYPES[shipTypeKey];
  const defs: LoadoutSlotDef[] = [];
  const hardpoints = def?.weaponHardpoints ?? 0;
  for (let i = 0; i < hardpoints; i++) {
    defs.push({ key: `weapon${i}`, slotType: "weapon", index: i, group: "offense", label: `Hardpoint ${i + 1}` });
  }
  defs.push({ key: "shieldEmitters", slotType: "shieldEmitters", index: null, group: "defense", label: "Shield Emitter" });
  defs.push({ key: "hullPlating", slotType: "hullPlating", index: null, group: "defense", label: "Hull Plating" });
  const bays = def?.droneBays ?? 0;
  for (let i = 0; i < bays; i++) {
    defs.push({ key: `droneBay${i}`, slotType: "droneBay", index: i, group: "defense", label: `Drone Bay ${i + 1}` });
  }
  defs.push({ key: "cargoBay", slotType: "cargoBay", index: null, group: "systems", label: "Cargo Bay" });
  defs.push({ key: "ftlDrive", slotType: "ftlDrive", index: null, group: "systems", label: "FTL Drive" });
  defs.push({ key: "reactorCore", slotType: "reactorCore", index: null, group: "systems", label: "Reactor Core" });
  if (def?.spec === "prospector") {
    defs.push({ key: "specUtility", slotType: "specUtility", index: null, group: "systems", label: "Spec Utility" });
  }
  return defs;
}

// Install a spare rolled system into a loadout slot. Refused (same-ref no-op) unless: the loadout
// exists and is NOT checked out (editing a live-equipped loadout is a later increment, gated on the
// ship's mission state to close the mid-mission-swap loophole); the slot key is a real slot for the
// loadout's ship type; the instance is a free SPARE (fittedToShipId null and not already committed);
// and its slotType matches the slot. Swapping a filled slot returns the previous system to the spare
// pool. Atomic: the committed marker moves in the SAME new state the loadout slot is written in.
export function installIntoLoadout(
  state: GameState,
  loadoutId: string,
  slotKey: string,
  instanceId: string
): GameState {
  const loadout = state.loadouts.find((l) => l.id === loadoutId);
  if (loadout === undefined || loadout.checkedOutToShipId !== null) return state;
  const slotDef = loadoutSlotDefsForShipType(loadout.shipTypeKey).find((d) => d.key === slotKey);
  if (slotDef === undefined) return state;
  const inst = state.equipment.find((e) => e.id === instanceId);
  if (inst === undefined) return state;
  if (inst.fittedToShipId !== null || inst.committedToLoadoutId !== undefined) return state; // not a free spare
  if (inst.slotType !== slotDef.slotType) return state; // wrong kind of system for this slot
  const prevId = loadout.slots[slotKey] ?? null;
  const equipment = state.equipment.map((e) => {
    if (e.id === instanceId) return { ...e, committedToLoadoutId: loadoutId };
    // The swapped-out system returns to the free pool: clear the marker + restart its grace.
    if (prevId !== null && e.id === prevId)
      return startAutoSalvageGrace({ ...e, committedToLoadoutId: undefined }, state.gameTimeSeconds);
    return e;
  });
  const loadouts = state.loadouts.map((l) =>
    l.id === loadoutId ? { ...l, slots: { ...l.slots, [slotKey]: instanceId } } : l
  );
  return { ...state, equipment, loadouts };
}

// Uninstall the system in a loadout slot, returning it to the spare pool. Refused while the loadout is
// checked out (same as install). Same-ref no-op if the loadout is missing or the slot is already empty.
export function uninstallFromLoadout(state: GameState, loadoutId: string, slotKey: string): GameState {
  const loadout = state.loadouts.find((l) => l.id === loadoutId);
  if (loadout === undefined || loadout.checkedOutToShipId !== null) return state;
  const instanceId = loadout.slots[slotKey];
  if (instanceId === undefined || instanceId === null) return state;
  const equipment = state.equipment.map((e) =>
    // committed -> free spare: clear the marker + restart the auto-salvage grace window.
    e.id === instanceId
      ? startAutoSalvageGrace({ ...e, committedToLoadoutId: undefined }, state.gameTimeSeconds)
      : e
  );
  const nextSlots = { ...loadout.slots };
  delete nextSlots[slotKey];
  const loadouts = state.loadouts.map((l) => (l.id === loadoutId ? { ...l, slots: nextSlots } : l));
  return { ...state, equipment, loadouts };
}

// ---------------------------------------------------------------------------
// CHECK OUT / CHECK IN (equip a ship from a loadout)
// ---------------------------------------------------------------------------

// Check a loadout OUT to a ship: the ship flies that set, and its own install screen locks (edit the
// loadout in the Armory instead). Refused (same-ref no-op) unless: the loadout + ship exist; the
// loadout is pinned to the ship's type; the loadout is not already checked out; the ship has no OTHER
// loadout checked out; and the ship is not on a mission (the no-mid-mission-swap guard). On checkout,
// the ship's prior MANUAL gear (fitted but uncommitted, including Standard-Issue baselines) returns to
// the spare pool, and the loadout's committed systems become fitted to the ship so equippedFor() reads
// the loadout's set unchanged. Atomic: all of that lands in the one new state.
export function checkOutLoadout(state: GameState, loadoutId: string, shipId: string): GameState {
  const loadout = state.loadouts.find((l) => l.id === loadoutId);
  if (loadout === undefined || loadout.checkedOutToShipId !== null) return state;
  const ship = state.ships.find((s) => s.id === shipId);
  if (ship === undefined || ship.typeKey !== loadout.shipTypeKey) return state; // type must match the pin
  if (state.loadouts.some((l) => l.checkedOutToShipId === shipId)) return state; // ship already loadout-driven
  if (!onMissionLock(state, shipId).ok) return state; // no mid-mission swap
  const committedIds = new Set(Object.values(loadout.slots).filter((v): v is string => v !== null));
  const equipment = state.equipment.map((e) => {
    if (committedIds.has(e.id)) return { ...e, fittedToShipId: shipId }; // the loadout's set -> onto the ship
    // Prior MANUAL gear -> back to the spare pool, with its auto-salvage grace window RESTARTED
    // (0.13.6 fix). Otherwise a long-expired grace stamp would let auto-salvage queue the just-
    // displaced system on the next tick, the same swap-and-lose gap every uninstall route closes.
    if (e.fittedToShipId === shipId && e.committedToLoadoutId === undefined)
      return startAutoSalvageGrace({ ...e, fittedToShipId: null }, state.gameTimeSeconds);
    return e;
  });
  const loadouts = state.loadouts.map((l) => (l.id === loadoutId ? { ...l, checkedOutToShipId: shipId } : l));
  return { ...state, equipment, loadouts };
}

// Check a loadout back IN (un-equip it from its ship). The ship's slots go empty (uninstall restores
// nothing, per the allow-empty rule); the loadout's systems stay committed to the loadout, just no
// longer fitted. Refused while the ship is on a mission. Same-ref no-op if the loadout is missing or
// already available.
export function checkInLoadout(state: GameState, loadoutId: string): GameState {
  const loadout = state.loadouts.find((l) => l.id === loadoutId);
  if (loadout === undefined || loadout.checkedOutToShipId === null) return state;
  if (!onMissionLock(state, loadout.checkedOutToShipId).ok) return state; // no mid-mission un-equip
  const committedIds = new Set(Object.values(loadout.slots).filter((v): v is string => v !== null));
  const equipment =
    committedIds.size === 0
      ? state.equipment
      : state.equipment.map((e) => (committedIds.has(e.id) ? { ...e, fittedToShipId: null } : e));
  const loadouts = state.loadouts.map((l) => (l.id === loadoutId ? { ...l, checkedOutToShipId: null } : l));
  return { ...state, equipment, loadouts };
}
