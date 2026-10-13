// TEST-ONLY fixtures (imported by *.test.ts files, never by app code).
//
// D18 MINIMUM AWAY TEAM (user, 2026-10-06): startExpedition refuses a ship without at least 1 ready
// Security AND 1 ready Science member. Every test that dispatches an expedition from a fresh state goes
// through withMinimumAwayTeam so it keeps testing what it tested before (sensors, museum, relics, phases)
// rather than the gate. The members are plain: rank 1, no traits, no gear, no own program.

import { SHIP_TYPES, type AwayMember, type AwayTeamType, type Expedition, type GameState, type ShipGroundTeam, type ShipTypeDef, type ShipTypeKey } from "./model";
import { expeditionAwayTeamCheck } from "./expedition";
import { backfillV67ShipGroundTeams, shipsWithMemberAutoSlotted, v67GroundTeamCount, v68ShipGroundTeamsFromV67 } from "./groundTeams";

// Ground Operations (GO-1, and the GO-7c multi-team tests): register a SYNTHETIC hull under `key` in the
// shared SHIP_TYPES table, cloned from the General Freighter with the given `awayTeams` (undefined = a hull
// with no away-team data). Returns the cleanup that removes the entry again; call it in afterEach so no other
// test sees it. Squads SQ-1: the team count is `groundSquads` / 2 now (every real hull fields 2 teams), so
// `groundSquads` defaults to 2 x the Security entry's `count` (0 without one): a pre-SQ-1 fixture written as
// "count 3" still fields 3 teams, and its v67 shape (the count) matches its v68 shape.
export function registerSyntheticHull(
  key: ShipTypeKey,
  awayTeams: ShipTypeDef["awayTeams"],
  groundSquads?: number,
): () => void {
  const table = SHIP_TYPES as Record<string, ShipTypeDef>;
  const def: ShipTypeDef = { ...SHIP_TYPES.generalFreighter };
  if (awayTeams === undefined) delete def.awayTeams;
  else def.awayTeams = awayTeams;
  def.groundSquads = groundSquads ?? 2 * (awayTeams?.find((t) => t.teamType === "security")?.count ?? 0);
  table[key] = def;
  return () => {
    delete table[key];
  };
}

// The state with every ship's `groundTeams` (Ground Ops GO-1, SAVE v67; team kinds since Squads SQ-1, v68)
// and the founding Subspace Telescope facility (`facilities.subspaceTelescope`, SQ-1, v68) removed. Golden
// hashes of a WHOLE state captured before GO-1 hash through this, so they keep proving that nothing else
// changed: the slot state and the telescope seed are inert data to those runs, and stripping them leaves
// every other key in its original order. Pure.
export function withoutGroundSquadState(state: GameState): GameState {
  const facilities = { ...state.facilities };
  delete facilities.subspaceTelescope;
  return {
    ...state,
    facilities,
    ships: state.ships.map((ship) => {
      const rest = { ...ship };
      delete rest.groundTeams;
      return rest;
    }),
  };
}

// Ground Ops (GO-7b): the run WITHOUT its `groundOps` record, i.e. the LEGACY run the same dispatch would have
// produced before the switch (the record's presence is the feature flag; nothing else in the dispatch record
// differs for a ship whose one ground team is slotted in hire order). Tests that pin legacy behavior dispatch,
// then strip the flag with this. Pure: a shallow copy (the input is never touched).
export function withoutGroundOps(exp: Expedition): Expedition {
  const rest = { ...exp } as Expedition & { groundOps?: unknown };
  delete rest.groundOps;
  return rest;
}

// Ground Ops (GO-7b): a dispatch result turned into the LEGACY run it would have been before the switch: the
// returned expedition and every expedition in `next` lose their groundOps flag. Tests that pin legacy behavior
// (the activities-phase battles, retries, evacuation, Task 16 injuries) dispatch through this. A refusal is
// returned unchanged. Pure.
export function asLegacyDispatch<R extends { next: GameState; expedition?: Expedition }>(res: R): R {
  if (!res.expedition) return res;
  return {
    ...res,
    expedition: withoutGroundOps(res.expedition),
    next: { ...res.next, expeditions: res.next.expeditions.map(withoutGroundOps) },
  };
}

// The state as a v67 build held it (Squads SQ-1): every ship's groundTeams cut back to the v67 team count
// (groundTeams.ts v67GroundTeamCount) with each team's `kind` / `kindPending` removed, and the founding
// `facilities.subspaceTelescope` removed. Exactly the SQ-1 (v68) additions come off and every other key keeps
// its order, so a whole-state golden captured on v67 (groundOpsLegacy.test.ts claims) still proves nothing
// else moved. A ship without groundTeams is left as it is. Pure.
export function asV67GroundState(state: GameState): GameState {
  const facilities = { ...state.facilities };
  delete facilities.subspaceTelescope;
  return {
    ...state,
    facilities,
    ships: state.ships.map((ship) => {
      if (!Array.isArray(ship.groundTeams)) return ship;
      const teams = ship.groundTeams.slice(0, v67GroundTeamCount(ship.typeKey)).map((t) => {
        const rest: Partial<ShipGroundTeam> = { ...t };
        delete rest.kind;
        delete rest.kindPending;
        return rest as ShipGroundTeam;
      });
      return { ...ship, groundTeams: teams };
    }),
  };
}

// Ground Ops (GO-7b): every ship's ground-team slots refilled from its members in HIRE order (the v67
// backfill, groundTeams.ts backfillV67ShipGroundTeams), so a test that builds `awayMembers` by hand dispatches
// the same team the pre-switch "first N ready members in hire order" rule picked. Squads SQ-1: the v67 teams
// are stamped Ground and padded with empty Ground teams to the hull's v68 count (no pending flag), so the
// extra pair stays empty exactly as a migrated save's does. Pure.
export function withSlottedAwayTeams(state: GameState): GameState {
  return {
    ...state,
    ships: state.ships.map((ship) => ({
      ...ship,
      groundTeams: v68ShipGroundTeamsFromV67(ship, backfillV67ShipGroundTeams(ship, state.awayMembers), false),
    })),
  };
}

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
// nextAwayMemberId, which advances by two). Ground Ops (GO-7b): both are SLOTTED into the first empty slot
// of their squad (the hire auto-slot, groundTeamSlots.ts shipsWithMemberAutoSlotted), since dispatch now reads
// the slotted ground teams. Pure: returns a new state.
export function withMinimumAwayTeam(state: GameState, shipId = "ship-1"): GameState {
  const n = state.nextAwayMemberId;
  const security = plainAwayMember(`member-${n}`, "security", shipId);
  const science = plainAwayMember(`member-${n + 1}`, "science", shipId);
  const awayMembers = [...state.awayMembers, security, science];
  let ships = shipsWithMemberAutoSlotted(state.ships, shipId, security.id, "security", awayMembers);
  ships = shipsWithMemberAutoSlotted(ships, shipId, science.id, "science", awayMembers);
  return { ...state, ships, awayMembers, nextAwayMemberId: n + 2 };
}

// withMinimumAwayTeam only when `shipId` does not already field the D18 minimum (so a state that already
// carries its team, e.g. the `next` of an earlier dispatch, comes back as the SAME reference). A missing
// ship is returned unchanged (its refusal is the test's business). Pure.
export function ensureMinimumAwayTeam(state: GameState, shipId = "ship-1"): GameState {
  const ship = state.ships.find((s) => s.id === shipId);
  if (!ship || expeditionAwayTeamCheck(state, ship).ok) return state;
  return withMinimumAwayTeam(state, shipId);
}
