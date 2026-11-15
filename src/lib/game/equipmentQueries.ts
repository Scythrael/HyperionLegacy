// equipmentQueries.ts: the LEAF equipment queries (E-MOD EM-2 review, 0.14.0). Pure reads over GameState with no
// imports but types, moved out of equipment.ts (which re-exports every one) so the power budget reader
// (shipPower.ts), the crew fold (crewOverlay.ts, crewModules.ts) and the crew lock (crewLock.ts) can read them
// without importing equipment.ts, which itself imports shipPower.ts for the install gate. Keep this file a leaf:
// it must never import a module that imports equipment.ts.

import type { EquipmentInstance, EquipmentSlotType, GameState } from "./model";

// MULTI_SLOT_TYPES: the slots that hold MORE THAN ONE piece per ship (weapon fills the hull's hardpoints; droneBay
// fills the hull's drone bays; E-MOD EM-5's module fills the hull's moduleSlots, shared with the specUtility piece). A
// slotType NOT in this set is a singleton (at most one piece per ship-slot). Read by the install gate and mutators
// (equipment.ts) and the power budget's candidate swap (shipPower.ts).
export const MULTI_SLOT_TYPES: ReadonlySet<EquipmentSlotType> = new Set<EquipmentSlotType>(["weapon", "droneBay", "module"]);

// ----------------------------------------------------------------------------
// equippedFor
// ----------------------------------------------------------------------------
// Every equipment piece currently FITTED to the given ship, read straight off the
// fittedToShipId authority. PURE: filters the immutable pool, returns a fresh array.
//
// Staging freeze perf pass (2026-11-14; no outcome change): the pieces are indexed by ship ONCE per equipment list and
// the read copies that ship's slice (the same pieces in the same order the filter returned, a fresh array every call).
// Every equipment write makes a new list (nothing edits the list or a piece in place), so an index never goes stale; a
// full fleet's per-tick crew fill no longer scans every spare in storage once per ship. The index keys every piece by its
// fittedToShipId as it is (Map keys match as === does), so even a caller that slips a non-string id through reads the
// same pieces the filter did.
const FITTED_INDEX = new WeakMap<EquipmentInstance[], Map<string | null, EquipmentInstance[]>>();
const NONE_FITTED: readonly EquipmentInstance[] = [];
export function equippedFor(state: GameState, shipId: string): EquipmentInstance[] {
  let index = FITTED_INDEX.get(state.equipment);
  if (index === undefined) {
    index = new Map();
    for (const e of state.equipment) {
      const list = index.get(e.fittedToShipId);
      if (list === undefined) index.set(e.fittedToShipId, [e]);
      else list.push(e);
    }
    FITTED_INDEX.set(state.equipment, index);
  }
  return (index.get(shipId) ?? NONE_FITTED).slice();
}

// ----------------------------------------------------------------------------
// onMissionLock (shared guard, exported)
// ----------------------------------------------------------------------------
// The shared "is this ship editable / mutable right now?" guard, factored out
// (Omega 4, DRY) so canFitEquipment and unfitEquipment apply the IDENTICAL lock.
// EXPORTED as of ship-salvage (0.11.0): salvage.ts's salvageShip reuses this exact
// on-mission guard to BLOCK tearing apart a hull whose captain is out on a mission,
// so the fitment lock and the salvage lock can never drift apart (one source of truth
// for "this ship's captain is busy in flight").
// Two failure modes, in order: the ship must exist (noShip), and its assigned
// captain must NOT be on an active mission (onMission).
//
// The on-mission rule MIRRORS assignShipToCaptain's swap lock EXACTLY
// (tick.ts ~line 2053: `if (captain.mission !== null) return ...fail`): you cannot
// change a hull mid-mission, and for the same closed-form reason you cannot change
// its FITMENT mid-mission either. A PARKED ship (assignedCaptainId null) has no
// captain and so no lock, it is freely editable. A captain whose mission has
// resolved to null (idle, or recalled-and-cycle-completed) is likewise unlocked;
// note recall only takes effect at the end of the current cycle (recallCaptain sets
// mission.recalled but leaves mission !== null), so a recalled-but-still-flying
// captain remains locked here, exactly as it is for a ship swap.
//
// PURE: reads state, returns a verdict, mutates nothing.
export function onMissionLock(
  state: GameState,
  shipId: string
): { ok: true } | { ok: false; reason: "noShip" | "onMission" } {
  const ship = state.ships.find((s) => s.id === shipId);
  if (!ship) return { ok: false, reason: "noShip" };

  // Parked hull (no captain) -> no lock. Otherwise resolve the flying captain and
  // apply the same mission !== null lock the ship-swap uses.
  if (ship.assignedCaptainId !== null) {
    const captain = state.captains.find((c) => c.id === ship.assignedCaptainId);
    // A captain genuinely on an active mission blocks fitment. (If the id somehow
    // resolves to no captain, treat it as unlocked, there is no active mission to
    // protect, same permissive stance the swap code takes for a stale link.)
    if (captain && captain.mission !== null) return { ok: false, reason: "onMission" };
  }

  return { ok: true };
}

