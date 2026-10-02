// E-CREW "Crew Made Real": the AWAY TEAM engine (pure, DORMANT).
//
// Each ship fields a persistent roster of NAMED away-team members (model.ts AwayMember), stored flat in
// GameState.awayMembers and keyed to a ship by assignedShipId, exactly like Senior Staff officers.
// Squads are typed (D2): Security fights, Science does fieldwork, Prospecting is WIRED ONLY (every hull
// lists it with count 0, so no ship fields one). Squad sizes come from SHIP_TYPES[typeKey].awayTeams
// (design section 5.2), never from a hard-coded per-type switch, so a future hull can list two Security
// details with no engine change (S4-I19).
//
// DORMANT on purpose: nothing in tick.ts, the expedition resolver, or the UI reads this module yet. Every
// function is pure: it reads its inputs and returns fresh values, never mutating an input in place.
// See docs/plans/2026-10-02-crew-made-real-e-crew-design.md sections 4 and 5.

import type { AwayMember, AwayTeamType, GameState, ShipTypeKey } from "./model";
import { SHIP_TYPES } from "./model";

// ============================================================================
// Squad sizes (design section 5.2)
// ============================================================================

// How many members a hull's squads of `teamType` hold in total: size * count, summed over every entry
// of that type (a hull may list more than one squad of a type). 0 when the hull lists no such squad,
// has no awayTeams data at all, or the type key is unknown. Pure.
export function squadSlots(typeKey: ShipTypeKey, teamType: AwayTeamType): number {
  const teams = SHIP_TYPES[typeKey]?.awayTeams ?? [];
  let slots = 0;
  for (const t of teams) {
    if (t.teamType === teamType) slots += t.size * t.count;
  }
  return slots;
}

// The members currently on `shipId`'s `teamType` squad, in roster order. Pure read (fresh array).
export function membersInSquad(state: GameState, shipId: string, teamType: AwayTeamType): AwayMember[] {
  return state.awayMembers.filter((m) => m.assignedShipId === shipId && m.teamType === teamType);
}

// Whether `shipId`'s `teamType` squad has an open slot. False for a ship that does not exist and for any
// squad type the hull does not field (Prospecting today). Pure.
export function squadHasRoom(state: GameState, shipId: string, teamType: AwayTeamType): boolean {
  const ship = state.ships.find((s) => s.id === shipId);
  if (!ship) return false;
  return membersInSquad(state, shipId, teamType).length < squadSlots(ship.typeKey, teamType);
}
