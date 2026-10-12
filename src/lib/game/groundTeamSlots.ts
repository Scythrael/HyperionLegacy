// Ground Operations 0.14.0 (GO-2, D25): the LOW-LEVEL slot primitives for per-ship ground teams.
//
// This module imports model.ts ONLY, so awayTeam.ts (hire / fire / reassign) can keep a ship's slots in sync
// without importing groundTeams.ts (which imports awayTeam.ts: that would be a cycle). groundTeams.ts
// re-exports what callers need and builds the player actions + the deployable reader on top.
//
// Module graph: model.ts <- groundTeamSlots.ts <- awayTeam.ts <- groundTeams.ts. Every function is pure.

import type { AwayMember, AwayTeamType, ShipGroundTeam, ShipInstance } from "./model";
import { groundSquadSize, groundTeamCount } from "./model";

// The two squad types a ground team slots (Prospecting is wired only and fields no ground squad).
export type GroundSquadType = "security" | "science";
export const GROUND_SQUAD_TYPES: readonly GroundSquadType[] = ["security", "science"];

export function isGroundSquadType(teamType: AwayTeamType): teamType is GroundSquadType {
  return teamType === "security" || teamType === "science";
}

// Where a member sits: a ground team, one of its two squads, a slot in that squad.
export interface GroundSlotRef {
  teamIndex: number;
  teamType: GroundSquadType;
  slotIndex: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

// One stored slot list sized to `length`: extra slots dropped, missing ones null, a non-string entry null.
function normalizedSlots(stored: unknown, length: number): (string | null)[] {
  const list = Array.isArray(stored) ? stored : [];
  return Array.from({ length }, (_, i) => (typeof list[i] === "string" ? (list[i] as string) : null));
}

// A ship's ground teams as a NORMALIZED COPY: exactly groundTeamCount(typeKey) teams (extra teams dropped,
// missing ones empty), each slot list sized to the hull's squad size (extra slots dropped, missing ones
// null), a boolean help toggle and a string name only when one is stored. A ship minted without the field
// (shipBuild, the captain-unlock grant) reads as the hull's empty teams.
// NEVER MUTATE THE RESULT IN PLACE AS A WAY TO CHANGE STATE: it is a fresh copy (fresh arrays every call),
// so a write to it changes nothing. The slot actions edit a copy and write it back onto a new ship object.
// Pure.
export function shipGroundTeams(ship: Pick<ShipInstance, "typeKey" | "groundTeams">): ShipGroundTeam[] {
  const stored: unknown[] = Array.isArray(ship.groundTeams) ? ship.groundTeams : [];
  const sec = groundSquadSize(ship.typeKey, "security");
  const sci = groundSquadSize(ship.typeKey, "science");
  return Array.from({ length: groundTeamCount(ship.typeKey) }, (_, i) => {
    const t = isRecord(stored[i]) ? stored[i] : {};
    const team: ShipGroundTeam = {
      security: normalizedSlots(t.security, sec),
      science: normalizedSlots(t.science, sci),
      helpOthers: t.helpOthers === true,
    };
    if (typeof t.name === "string") team.name = t.name;
    return team;
  });
}

// What a slot WRITE needs to know about a member: who they are, which ship they are aboard, their squad.
export type GroundSlotMember = Pick<AwayMember, "id" | "assignedShipId" | "teamType">;

// `ship`'s ground teams as a normalized copy (shipGroundTeams) with every CORRUPT slot id nulled: an id that
// does not name a member of `members` aboard THIS ship with the slot's squad type (a member who no longer
// exists, one aboard another ship, a wrong-type member), and any repeat of a member already seen in an
// earlier slot of this ship (the first slot is kept). Every slot WRITE goes through this before it chooses a
// slot (GO-2 review, carried to GO-3), so a corrupt id can never make auto-slot skip a slot and the write
// leaves the ship clean. A ship whose slots are all valid comes back exactly as shipGroundTeams reads it.
// Same contract as shipGroundTeams: a fresh copy, never stored state. Pure.
export function cleanShipGroundTeams(
  ship: Pick<ShipInstance, "id" | "typeKey" | "groundTeams">,
  members: readonly GroundSlotMember[],
): ShipGroundTeam[] {
  const aboard = new Map<string, AwayTeamType>();
  for (const m of members) if (m.assignedShipId === ship.id) aboard.set(m.id, m.teamType);
  const seen = new Set<string>();
  const teams = shipGroundTeams(ship);
  for (const team of teams) {
    for (const teamType of GROUND_SQUAD_TYPES) {
      const slots = team[teamType];
      for (let i = 0; i < slots.length; i += 1) {
        const id = slots[i];
        if (id === null) continue;
        if (aboard.get(id) !== teamType || seen.has(id)) slots[i] = null;
        else seen.add(id);
      }
    }
  }
  return teams;
}

// The slot `memberId` occupies in `teams` (team order, Security before Science, slot order), or null. Pure.
export function findGroundSlot(teams: readonly ShipGroundTeam[], memberId: string): GroundSlotRef | null {
  for (let teamIndex = 0; teamIndex < teams.length; teamIndex += 1) {
    for (const teamType of GROUND_SQUAD_TYPES) {
      const slotIndex = teams[teamIndex][teamType].indexOf(memberId);
      if (slotIndex >= 0) return { teamIndex, teamType, slotIndex };
    }
  }
  return null;
}

// The FIRST empty slot of `teamType` in `teams`: lowest team index first, then lowest slot. Null when every
// slot of that type is taken (or the hull fields none). Pure.
export function firstEmptyGroundSlot(teams: readonly ShipGroundTeam[], teamType: GroundSquadType): GroundSlotRef | null {
  for (let teamIndex = 0; teamIndex < teams.length; teamIndex += 1) {
    const slotIndex = teams[teamIndex][teamType].indexOf(null);
    if (slotIndex >= 0) return { teamIndex, teamType, slotIndex };
  }
  return null;
}

// Whether a stored (raw) ground-team value names `memberId` in any slot. Reads the stored value, not the
// normalized copy, so a ship that never held the member is never touched. Pure.
function storedHoldsMember(ship: ShipInstance, memberId: string): boolean {
  if (!Array.isArray(ship.groundTeams)) return false;
  return ship.groundTeams.some(
    (t) =>
      isRecord(t) &&
      GROUND_SQUAD_TYPES.some((type) => Array.isArray(t[type]) && (t[type] as unknown[]).includes(memberId)),
  );
}

// `ships` with `memberId` removed from every slot fleet-wide (a member LEAVING a ship: fired, reassigned
// away, benched). A ship holding the member gets its CLEANED teams (cleanShipGroundTeams over `members`, the
// state's awayMembers before the move) with those slots null; every other ship keeps its reference, and the
// SAME array comes back when no ship held the member. Pure.
export function shipsWithMemberUnslotted(
  ships: ShipInstance[],
  memberId: string,
  members: readonly GroundSlotMember[],
): ShipInstance[] {
  if (!ships.some((s) => storedHoldsMember(s, memberId))) return ships;
  return ships.map((ship) => {
    if (!storedHoldsMember(ship, memberId)) return ship;
    const teams = cleanShipGroundTeams(ship, members).map((t) => ({
      ...t,
      security: t.security.map((id) => (id === memberId ? null : id)),
      science: t.science.map((id) => (id === memberId ? null : id)),
    }));
    return { ...ship, groundTeams: teams };
  });
}

// `ships` with `memberId` AUTO-SLOTTED into `shipId`'s first empty slot of the member's squad type (lowest
// team index first: set-and-forget, D25 QoL), the sync for every ARRIVAL aboard (hire, reassign to the ship,
// unbench). The member must already be out of every other slot (the callers unslot first). The ship's slots
// are CLEANED first (cleanShipGroundTeams over `members`, the other members of the state; the arriving
// member need not be in it), so a corrupt id never hides an empty slot. No empty slot (a full squad, or a
// type the hull fields no ground squad of, Prospecting) leaves the member aboard unslotted (the ship's
// reserve) and returns the SAME array; so does an unknown ship or a member already slotted there. Pure.
export function shipsWithMemberAutoSlotted(
  ships: ShipInstance[],
  shipId: string,
  memberId: string,
  teamType: AwayTeamType,
  members: readonly GroundSlotMember[],
): ShipInstance[] {
  if (!isGroundSquadType(teamType)) return ships;
  const index = ships.findIndex((s) => s.id === shipId);
  if (index < 0) return ships;
  const ship = ships[index];
  if (findGroundSlot(shipGroundTeams(ship), memberId)) return ships;
  const teams = cleanShipGroundTeams(ship, members);
  const open = firstEmptyGroundSlot(teams, teamType);
  if (!open) return ships;
  teams[open.teamIndex][teamType][open.slotIndex] = memberId; // the fresh copy, never stored state
  const next = [...ships];
  next[index] = { ...ship, groundTeams: teams };
  return next;
}
