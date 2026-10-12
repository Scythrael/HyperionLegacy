// Ground Operations 0.14.0 (D25, plan docs/plans/2026-10-09-ground-operations-plan.md): GROUND TEAMS.
//
// A ship fields groundTeamCount(typeKey) ground teams (1 on every hull today; the engine supports N). Each
// team is one Security squad + one Science squad whose members the player SLOTS (model.ts ShipGroundTeam,
// persisted on ShipInstance.groundTeams since SAVE v67). This module holds the pure readers and the shape
// guards the v66 -> v67 migration uses. GO-2 adds the slotting actions here; GO-7 dispatches by slot.
//
// Module graph: groundTeams.ts imports model.ts and awayTeam.ts only, and nothing imports it from below
// (medicalBay / groundTasks / groundOps sit above it, plan section 2). Every function is pure.

import type { AwayMember, GroundTeamLoadout, ShipGroundTeam, ShipInstance, ShipTypeKey, SquadLoadoutKit } from "./model";
import { emptyGroundTeams, groundSquadSize, groundTeamCount } from "./model";
import { byIdNumber } from "./awayTeam";

// The size readers live in model.ts (freshState seeds the starting hull with them, and model.ts must not
// import this module); re-exported so ground-team callers import from one place.
export { emptyGroundTeams, groundSquadSize, groundTeamCount };

// The default team names by index (user 9b.7: "Alpha / Bravo / Charlie", renameable).
export const GROUND_TEAM_DEFAULT_NAMES = ["Alpha", "Bravo", "Charlie"] as const;

// A ship's ground teams: the stored value, else the hull's empty teams (a ship minted without the field,
// e.g. by shipBuild or the captain-unlock grant). Returns the stored array itself when present. Pure.
export function shipGroundTeams(ship: ShipInstance): ShipGroundTeam[] {
  return ship.groundTeams ?? emptyGroundTeams(ship.typeKey);
}

// A team's display name: its custom name when set and not blank, else the default by index (Alpha /
// Bravo / Charlie), else "Team N" past the third team. [PROVISIONAL, Q15: no hull has a 4th team yet.]
export function groundTeamName(ship: ShipInstance, index: number): string {
  const custom = shipGroundTeams(ship)[index]?.name?.trim();
  if (custom) return custom;
  return GROUND_TEAM_DEFAULT_NAMES[index] ?? `Team ${index + 1}`;
}

// The compact label (user 9b.7: "A, B, and C is fine"): the letter by INDEX, even after a rename, so a badge
// never changes when a team is renamed. Letters run A..Z, then the 1-based number. [PROVISIONAL, Q15.]
export function groundTeamShortLabel(index: number): string {
  return index >= 0 && index < 26 ? String.fromCharCode(65 + index) : String(index + 1);
}

// ============================================================================
// Shape guards (the v66 -> v67 migration keeps a value only when it passes)
// ============================================================================

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isSlotList = (v: unknown, length: number): v is (string | null)[] =>
  Array.isArray(v) && v.length === length && v.every((id) => id === null || typeof id === "string");

// Whether `value` is a ship's ground-team list in the CURRENT shape for `typeKey`: groundTeamCount teams,
// each with hull-sized Security / Science slot lists of member ids or null, a boolean help toggle and an
// optional string name. Shape only: it does not check that the ids name members aboard (GO-2's invariant).
export function isWellFormedShipGroundTeams(value: unknown, typeKey: ShipTypeKey): value is ShipGroundTeam[] {
  if (!Array.isArray(value) || value.length !== groundTeamCount(typeKey)) return false;
  const sec = groundSquadSize(typeKey, "security");
  const sci = groundSquadSize(typeKey, "science");
  return value.every(
    (t) =>
      isRecord(t) &&
      (t.name === undefined || typeof t.name === "string") &&
      isSlotList(t.security, sec) &&
      isSlotList(t.science, sci) &&
      typeof t.helpOthers === "boolean",
  );
}

const isNullableString = (v: unknown): boolean => v === null || typeof v === "string";
const isKit = (v: unknown): v is SquadLoadoutKit =>
  isRecord(v) &&
  isNullableString(v.armor) &&
  isNullableString(v.weapon) &&
  isNullableString(v.tool) &&
  Array.isArray(v.implants) &&
  v.implants.every((id) => typeof id === "string");

// Whether `value` is a GroundTeamLoadout (model.ts): string id + name, Security / Science kit lists, and a
// null or { shipId, teamIndex } check-out. The never-built Task 2 per-team-TYPE shape fails it.
export function isWellFormedGroundTeamLoadout(value: unknown): value is GroundTeamLoadout {
  if (!isRecord(value)) return false;
  const out = value.checkedOutTo;
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    Array.isArray(value.security) &&
    value.security.every(isKit) &&
    Array.isArray(value.science) &&
    value.science.every(isKit) &&
    (out === null ||
      (isRecord(out) && typeof out.shipId === "string" && Number.isInteger(out.teamIndex) && (out.teamIndex as number) >= 0))
  );
}

// ============================================================================
// The v67 backfill
// ============================================================================

// A ship's ground teams filled from its members: the hull's empty teams, then team 0's Security / Science
// slots (then team 1's, ...) take that ship's members of the matching teamType in HIRE order (byIdNumber,
// the same order deployableMembers uses), up to each squad's size. Injury is IGNORED: an injured member
// stays slotted and simply does not deploy while injured. Members past the slots stay aboard unslotted (the
// reserve). Reads raw save data, so malformed member entries (not an object, no string id) are skipped.
// With every member ready this reproduces today's dispatch ("first N members in hire order"). Pure.
export function backfillShipGroundTeams(ship: Pick<ShipInstance, "id" | "typeKey">, members: readonly unknown[]): ShipGroundTeam[] {
  const teams = emptyGroundTeams(ship.typeKey);
  const aboard = members.filter(
    (m): m is AwayMember => isRecord(m) && typeof m.id === "string" && m.assignedShipId === ship.id,
  );
  for (const teamType of ["security", "science"] as const) {
    const queue = aboard.filter((m) => m.teamType === teamType).sort(byIdNumber);
    let next = 0;
    for (const team of teams) {
      const slots = team[teamType];
      for (let i = 0; i < slots.length && next < queue.length; i += 1) {
        slots[i] = queue[next].id;
        next += 1;
      }
    }
  }
  return teams;
}
