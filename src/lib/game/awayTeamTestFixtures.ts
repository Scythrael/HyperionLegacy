// TEST-ONLY fixtures (imported by *.test.ts files, never by app code).
//
// D18 MINIMUM AWAY TEAM (user, 2026-10-06): startExpedition refuses a ship without at least 1 ready
// Security AND 1 ready Science member. Every test that dispatches an expedition from a fresh state goes
// through withMinimumAwayTeam so it keeps testing what it tested before (sensors, museum, relics, phases)
// rather than the gate. The members are plain: rank 1, no traits, no gear, no own program.

import type { AwayMember, AwayTeamType, GameState } from "./model";
import { expeditionAwayTeamCheck } from "./expedition";

// A plain away-team member assigned to `shipId`. Pure.
export function plainAwayMember(id: string, teamType: AwayTeamType, shipId: string): AwayMember {
  return {
    id,
    teamType,
    spec: teamType === "science" ? "geology" : "offense",
    name: `Member ${id}`,
    race: "earthBorn",
    gender: "female",
    rank: 1,
    traits: [],
    assignedShipId: shipId,
  };
}

// The state with one plain Security and one plain Science member added to `shipId`'s squads (ids from
// nextAwayMemberId, which advances by two). Pure: returns a new state.
export function withMinimumAwayTeam(state: GameState, shipId = "ship-1"): GameState {
  const n = state.nextAwayMemberId;
  return {
    ...state,
    awayMembers: [
      ...state.awayMembers,
      plainAwayMember(`member-${n}`, "security", shipId),
      plainAwayMember(`member-${n + 1}`, "science", shipId),
    ],
    nextAwayMemberId: n + 2,
  };
}

// withMinimumAwayTeam only when `shipId` does not already field the D18 minimum (so a state that already
// carries its team, e.g. the `next` of an earlier dispatch, comes back as the SAME reference). A missing
// ship is returned unchanged (its refusal is the test's business). Pure.
export function ensureMinimumAwayTeam(state: GameState, shipId = "ship-1"): GameState {
  const ship = state.ships.find((s) => s.id === shipId);
  if (!ship || expeditionAwayTeamCheck(state, ship).ok) return state;
  return withMinimumAwayTeam(state, shipId);
}
