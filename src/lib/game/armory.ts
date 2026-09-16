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
import type { GameState, Loadout, ShipTypeKey } from "./model";
import { SHIP_TYPES } from "./model";

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
          committedIds.has(e.id) ? { ...e, committedToLoadoutId: undefined } : e
        );
  return {
    ...state,
    loadouts: state.loadouts.filter((l) => l.id !== loadoutId),
    equipment,
  };
}
