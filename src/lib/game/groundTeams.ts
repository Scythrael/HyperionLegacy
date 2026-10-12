// Ground Operations 0.14.0 (D25, plan docs/plans/2026-10-09-ground-operations-plan.md): GROUND TEAMS.
//
// A ship fields groundTeamCount(typeKey) ground teams (1 on every hull today; the engine supports N). Each
// team is one Security squad + one Science squad whose members the player SLOTS (model.ts ShipGroundTeam,
// persisted on ShipInstance.groundTeams since SAVE v67). This module holds the pure readers, the shape
// guards the v66 -> v67 migration uses, the player's SLOTTING ACTIONS (GO-2) and the DEPLOYABLE READER
// (GO-2; GO-7b switches dispatch to it). The crew-action sync (hire / reassign auto-slot, fire / reassign /
// bench unslot) lives in awayTeam.ts on the groundTeamSlots.ts primitives.
//
// Module graph: model.ts <- groundTeamSlots.ts <- awayTeam.ts <- groundTeams.ts, and nothing imports this
// module from below (groundTasks / groundOps / expedition sit above it, plan section 2; medicalBay.ts sits
// BELOW awayTeam.ts since GO-3: it imports model.ts types only, and snapshotMember reads its memberPerksFor).
// Every function is pure.

import type {
  AwayMember,
  GameState,
  GroundTeamLoadout,
  ShipGroundTeam,
  ShipInstance,
  ShipTypeKey,
  SquadLoadoutKit,
} from "./model";
import { emptyGroundTeams, groundSquadSize, groundTeamCount } from "./model";
import { byIdNumber, isMemberReady, shipCrewLocked } from "./awayTeam";
import {
  GROUND_SQUAD_TYPES,
  cleanShipGroundTeams,
  findGroundSlot,
  firstEmptyGroundSlot,
  isGroundSquadType,
  shipGroundTeams,
  shipsWithMemberAutoSlotted,
  shipsWithMemberUnslotted,
  type GroundSlotMember,
  type GroundSlotRef,
  type GroundSquadType,
} from "./groundTeamSlots";
import { formatCountdown } from "./format";

// The size readers live in model.ts (freshState seeds the starting hull with them, and model.ts must not
// import this module); the slot primitives live in groundTeamSlots.ts (awayTeam.ts needs them). Re-exported
// so ground-team callers import from one place. shipGroundTeams returns a NORMALIZED COPY (hull-sized,
// fresh arrays): never mutate the result as a way to change state; the actions below write through it.
export { emptyGroundTeams, groundSquadSize, groundTeamCount };
export {
  GROUND_SQUAD_TYPES,
  cleanShipGroundTeams,
  findGroundSlot,
  firstEmptyGroundSlot,
  isGroundSquadType,
  shipGroundTeams,
  shipsWithMemberAutoSlotted,
  shipsWithMemberUnslotted,
  type GroundSlotMember,
  type GroundSlotRef,
  type GroundSquadType,
};

// The default team names by index (user 9b.7: "Alpha / Bravo / Charlie", renameable).
export const GROUND_TEAM_DEFAULT_NAMES = ["Alpha", "Bravo", "Charlie"] as const;

// D18 MINIMUM AWAY TEAM (user, 2026-10-06): at least 1 Security AND 1 Science member. Ground Ops applies it
// PER GROUND TEAM (D25: a ground team is a Security squad of 1 to capacity + a Science squad of 1 to
// capacity). expedition.ts re-exports both for its dispatch gate.
export const MIN_SECURITY_MEMBERS = 1;
export const MIN_SCIENCE_MEMBERS = 1;

// A team's display name: its custom name when set and not blank, else the default by index (Alpha /
// Bravo / Charlie), else "Team N" past the third team. [PROVISIONAL, Q15: no hull has a 4th team yet.]
export function groundTeamName(ship: ShipInstance, index: number): string {
  const custom = shipGroundTeams(ship)[index]?.name?.trim();
  if (custom) return custom;
  return groundTeamDefaultName(index);
}

// The default name for team `index`: Alpha / Bravo / Charlie, then "Team N". [PROVISIONAL, Q15.] Pure.
export function groundTeamDefaultName(index: number): string {
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

// ============================================================================
// Slotting actions (GO-2): each returns a NEW GameState; a refusal or a no-op returns the SAME reference
// ============================================================================
//
// The invariant every action keeps (groundTeams.test.ts assertSlotInvariants): a member sits in at most one
// slot fleet-wide; a slot only holds a member aboard THAT ship with the matching team type; every stored
// slot list is the hull's size. Members aboard but in no slot are the ship's RESERVE: they do not deploy.
// Every gate AND every write reads writableTeams (cleanShipGroundTeams: corrupt ids nulled, GO-3 + its
// review), so a gate judges the same slots the write edits (a member held only in a corrupt slot is
// notSlotted) and a write also leaves the ship clean.
// Every slot change refuses while the ship's crew is locked (awayTeam.ts shipCrewLocked: the ship is out on
// a mission or an expedition, so its members are busy on that run). Renaming and the help toggle do not
// (see each).

// Why a slot change is refused (the AwayCrewBlockReason gate pattern):
//   noShip:        the ship does not exist
//   onMission:     the ship's crew is locked (out on a mission or an expedition: its members are busy)
//   noSuchTeam:    the team index is out of range for the hull
//   noSuchSlot:    the slot index is out of range for that squad (a hull with no such squad has no slots)
//   noMember:      no member with that id
//   wrongShip:     the member is not aboard this ship
//   wrongTeamType: the member's team type does not match the squad (or the two members of a swap differ)
//   alreadyThere:  a no-op (slotting a member into their own slot, swapping a member with themselves)
//   notSlotted:    unslotting a member in no slot, or a swap where neither member is slotted
export type GroundSlotBlockReason =
  | "noShip"
  | "onMission"
  | "noSuchTeam"
  | "noSuchSlot"
  | "noMember"
  | "wrongShip"
  | "wrongTeamType"
  | "alreadyThere"
  | "notSlotted";

export type GroundSlotGate = { ok: true } | { ok: false; reason: GroundSlotBlockReason };

// The player-facing line for a slot refusal (US English). EXHAUSTIVE with no default on purpose (the
// awayCrewBlockText pattern): a new reason is a compile error here until it has text. Pure.
export function groundSlotBlockText(reason: GroundSlotBlockReason): string {
  switch (reason) {
    case "noShip":
      return "That ship is no longer in the fleet";
    case "onMission":
      return "Ship is out on a mission";
    case "noSuchTeam":
      return "This ship fields no such ground team";
    case "noSuchSlot":
      return "This squad has no such slot";
    case "noMember":
      return "No longer in the fleet";
    case "wrongShip":
      return "Not aboard this ship";
    case "wrongTeamType":
      return "Wrong squad for this member";
    case "alreadyThere":
      return "Already in this slot";
    case "notSlotted":
      return "Not in a ground team slot";
  }
}

const refuse = (reason: GroundSlotBlockReason): GroundSlotGate => ({ ok: false, reason });

// The ship lookup every slot gate starts with, checked in order: noShip, onMission. Pure.
function shipGate(state: GameState, shipId: string): { ship: ShipInstance } | { gate: GroundSlotGate } {
  const ship = state.ships.find((s) => s.id === shipId);
  if (!ship) return { gate: refuse("noShip") };
  if (shipCrewLocked(state, shipId)) return { gate: refuse("onMission") };
  return { ship };
}

// noMember, then wrongShip, for a member who must be aboard `shipId`. Pure.
function aboardGate(state: GameState, shipId: string, memberId: string): { member: AwayMember } | { gate: GroundSlotGate } {
  const member = state.awayMembers.find((m) => m.id === memberId);
  if (!member) return { gate: refuse("noMember") };
  if (member.assignedShipId !== shipId) return { gate: refuse("wrongShip") };
  return { member };
}

// The copy of `ship`'s teams a write edits: normalized, with every slot id that does not name a member
// aboard this ship with the slot's type nulled (GO-2 review, carried to GO-3). Pure.
function writableTeams(state: GameState, ship: ShipInstance): ShipGroundTeam[] {
  return cleanShipGroundTeams(ship, state.awayMembers);
}

// `state` with `shipId`'s ground teams replaced by `teams` (a normalized copy the caller edited). Pure.
function withShipTeams(state: GameState, shipId: string, teams: ShipGroundTeam[]): GameState {
  return { ...state, ships: state.ships.map((s) => (s.id === shipId ? { ...s, groundTeams: teams } : s)) };
}

// The team at `teamIndex` of a normalized copy, or undefined for a non-integer / out-of-range index. Pure.
function teamAt(teams: ShipGroundTeam[], teamIndex: number): ShipGroundTeam | undefined {
  return Number.isInteger(teamIndex) && teamIndex >= 0 ? teams[teamIndex] : undefined;
}

// Can `memberId` go into `shipId`'s team `teamIndex`, squad `teamType`, slot `slotIndex`? Checked in order:
// noShip, onMission, noSuchTeam, noSuchSlot, noMember, wrongShip, wrongTeamType, alreadyThere. Pure.
export function canSlotMember(
  state: GameState,
  shipId: string,
  teamIndex: number,
  teamType: GroundSquadType,
  slotIndex: number,
  memberId: string,
): GroundSlotGate {
  const s = shipGate(state, shipId);
  if ("gate" in s) return s.gate;
  const team = teamAt(writableTeams(state, s.ship), teamIndex);
  if (!team) return refuse("noSuchTeam");
  const slots = isGroundSquadType(teamType) ? team[teamType] : [];
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= slots.length) return refuse("noSuchSlot");
  const a = aboardGate(state, shipId, memberId);
  if ("gate" in a) return a.gate;
  if (a.member.teamType !== teamType) return refuse("wrongTeamType");
  if (slots[slotIndex] === memberId) return refuse("alreadyThere");
  return { ok: true };
}

// Put a member into a slot. The member leaves any slot they held first (a move), and the slot's occupant, if
// any, is UNSLOTTED (stays aboard, in the reserve). Refuses (SAME state) whenever canSlotMember does. Pure.
export function slotMember(
  state: GameState,
  shipId: string,
  teamIndex: number,
  teamType: GroundSquadType,
  slotIndex: number,
  memberId: string,
): GameState {
  if (!canSlotMember(state, shipId, teamIndex, teamType, slotIndex, memberId).ok) return state;
  const ship = state.ships.find((s) => s.id === shipId) as ShipInstance;
  const teams = writableTeams(state, ship);
  const from = findGroundSlot(teams, memberId);
  if (from) teams[from.teamIndex][from.teamType][from.slotIndex] = null;
  teams[teamIndex][teamType][slotIndex] = memberId;
  return withShipTeams(state, shipId, teams);
}

// Can this member be taken out of their slot on `shipId` (into the ship's reserve)? Checked in order: noShip,
// onMission, noMember, wrongShip, notSlotted. Pure.
export function canUnslotMember(state: GameState, shipId: string, memberId: string): GroundSlotGate {
  const s = shipGate(state, shipId);
  if ("gate" in s) return s.gate;
  const a = aboardGate(state, shipId, memberId);
  if ("gate" in a) return a.gate;
  if (!findGroundSlot(writableTeams(state, s.ship), memberId)) return refuse("notSlotted");
  return { ok: true };
}

// Take a member out of their slot; they stay aboard, in the reserve. Refuses (SAME state) whenever
// canUnslotMember does. Pure.
export function unslotMember(state: GameState, shipId: string, memberId: string): GameState {
  if (!canUnslotMember(state, shipId, memberId).ok) return state;
  const ship = state.ships.find((s) => s.id === shipId) as ShipInstance;
  const teams = writableTeams(state, ship);
  const at = findGroundSlot(teams, memberId) as GroundSlotRef;
  teams[at.teamIndex][at.teamType][at.slotIndex] = null;
  return withShipTeams(state, shipId, teams);
}

// Can two members aboard `shipId` trade places? Both must be aboard and share a team type, and at least one
// must be slotted (a reserve member swapped with a slotted one takes the slot; the other goes to the
// reserve). Checked in order: noShip, onMission, alreadyThere (the same member), noMember / wrongShip (first
// member, then second), wrongTeamType, notSlotted. Pure.
export function canSwapGroundMembers(state: GameState, shipId: string, memberIdA: string, memberIdB: string): GroundSlotGate {
  const s = shipGate(state, shipId);
  if ("gate" in s) return s.gate;
  if (memberIdA === memberIdB) return refuse("alreadyThere");
  const a = aboardGate(state, shipId, memberIdA);
  if ("gate" in a) return a.gate;
  const b = aboardGate(state, shipId, memberIdB);
  if ("gate" in b) return b.gate;
  if (a.member.teamType !== b.member.teamType || !isGroundSquadType(a.member.teamType)) return refuse("wrongTeamType");
  const teams = writableTeams(state, s.ship);
  if (!findGroundSlot(teams, memberIdA) && !findGroundSlot(teams, memberIdB)) return refuse("notSlotted");
  return { ok: true };
}

// Swap two members' places (the player's "swap one member out for another", user 2026-10-12: there are no
// automatic stand-ins). Works across teams on the same ship. Refuses (SAME state) whenever
// canSwapGroundMembers does. Pure.
export function swapGroundMembers(state: GameState, shipId: string, memberIdA: string, memberIdB: string): GameState {
  if (!canSwapGroundMembers(state, shipId, memberIdA, memberIdB).ok) return state;
  const ship = state.ships.find((s) => s.id === shipId) as ShipInstance;
  const teams = writableTeams(state, ship);
  const atA = findGroundSlot(teams, memberIdA);
  const atB = findGroundSlot(teams, memberIdB);
  if (atA) teams[atA.teamIndex][atA.teamType][atA.slotIndex] = memberIdB;
  if (atB) teams[atB.teamIndex][atB.teamType][atB.slotIndex] = memberIdA;
  return withShipTeams(state, shipId, teams);
}

// The longest custom team name, in Unicode CODE POINTS after trimming (a surrogate pair counts once and is
// never split). [PROVISIONAL]
export const GROUND_TEAM_NAME_MAX = 24;

// Rename a team. The name is trimmed and cut to GROUND_TEAM_NAME_MAX code points (GO-3: never splitting a
// surrogate pair); a blank name, null, or the team's own default name in ANY case ("alpha", "ALPHA") CLEARS
// the custom name (the team reads as Alpha / Bravo / Charlie again). Allowed while the ship is out
// (cosmetic). [PROVISIONAL] Refuses (SAME state) for an unknown ship or team index, and returns the SAME
// state when the stored name would not change. Pure.
export function renameGroundTeam(state: GameState, shipId: string, teamIndex: number, name: string | null): GameState {
  const ship = state.ships.find((s) => s.id === shipId);
  if (!ship) return state;
  const teams = writableTeams(state, ship);
  const team = teamAt(teams, teamIndex);
  if (!team) return state;
  const trimmed = Array.from((name ?? "").trim()).slice(0, GROUND_TEAM_NAME_MAX).join("").trim();
  const isDefault = trimmed.toLowerCase() === groundTeamDefaultName(teamIndex).toLowerCase();
  const custom = trimmed === "" || isDefault ? undefined : trimmed;
  if (custom === team.name) return state;
  if (custom === undefined) delete team.name;
  else team.name = custom;
  return withShipTeams(state, shipId, teams);
}

// Set a team's "When done, help other teams" toggle: the ship's DEFAULT for the next dispatch (GO-7c reads
// it at dispatch; a run in flight keeps its own copy). Allowed while the ship is out, since it only shapes
// the next run. [PROVISIONAL: the plan listed every slot change as locked except rename; the help default
// touches no slot and no live run.] Refuses (SAME state) for an unknown ship or team index; a value equal to
// the current one returns the SAME state. Pure.
export function setGroundTeamHelp(state: GameState, shipId: string, teamIndex: number, on: boolean): GameState {
  const ship = state.ships.find((s) => s.id === shipId);
  if (!ship) return state;
  const teams = writableTeams(state, ship);
  const team = teamAt(teams, teamIndex);
  if (!team || team.helpOthers === on) return state;
  team.helpOthers = on;
  return withShipTeams(state, shipId, teams);
}

// ============================================================================
// The deployable reader (GO-2; GO-7b switches dispatch to it). NO AUTOMATIC STAND-INS (user, 2026-10-12):
// a ground team with any slotted member who is not ready does not deploy, and the dispatch attempt shows
// what it is waiting on with the time remaining. The player swaps members by hand.
// ============================================================================

// Why one ground team does not deploy right now:
//   injured:      a slotted member is not ready (D24 recovery); carries the member's name, the absolute
//                 return time and the seconds left, so the wait text needs no state
//   needSecurity: fewer than MIN_SECURITY_MEMBERS Security members slotted (D18, per team)
//   needScience:  fewer than MIN_SCIENCE_MEMBERS Science members slotted
export type GroundTeamWait =
  | {
      kind: "injured";
      memberId: string;
      memberName: string;
      teamType: GroundSquadType;
      readyAtSeconds: number;
      secondsLeft: number;
    }
  | { kind: "needSecurity" }
  | { kind: "needScience" };

export interface GroundTeamReadiness {
  index: number; // ship team index (0 = Alpha)
  name: string; // groundTeamName: the custom name, else the default
  security: AwayMember[]; // the slotted Security members (aboard, matching type), slot order
  science: AwayMember[]; // the slotted Science members, slot order
  staffed: boolean; // at least one member slotted (an unstaffed team simply stays aboard)
  deploys: boolean; // every slotted member ready AND the D18 minimum in each squad
  waits: GroundTeamWait[]; // [] exactly when it deploys; injuries first (Security then Science, slot order)
  // When the team deploys by WAITING alone: now when it deploys; the last slotted member's return when the
  // only waits are injuries; null when the player must slot someone first (needSecurity / needScience).
  readyAtSeconds: number | null;
}

// Why the ship cannot launch ground operations right now:
//   noShip:        the ship does not exist
//   noGroundTeams: the hull fields no ground teams
//   noTeamReady:   no ground team deploys, so what deploys cannot meet D18 (1 Security AND 1 Science)
export type GroundDeployBlockReason = "noShip" | "noGroundTeams" | "noTeamReady";

export interface GroundDeployCheck {
  ok: boolean; // at least one team deploys and the deploying teams meet D18 in total
  reason?: GroundDeployBlockReason; // set only when not ok
  teams: GroundTeamReadiness[]; // every team of the hull, index order
  security: number; // Security members across the deploying teams
  science: number; // Science members across the deploying teams
  // The soonest time the ship can launch by waiting alone: now when ok; the earliest team readyAtSeconds
  // otherwise; null when no team gets there without the player slotting someone.
  readyAtSeconds: number | null;
}

// Per-team readiness for `shipId` at state.gameTimeSeconds. A slot naming an id that is not a member aboard
// this ship with the matching type (impossible through the actions; defensive) reads as empty. The crew
// lock is NOT part of this reader (dispatch's own gates refuse a ship that is already out). Pure.
export function deployableGroundTeams(state: GameState, shipId: string): GroundDeployCheck {
  const now = state.gameTimeSeconds;
  const ship = state.ships.find((s) => s.id === shipId);
  if (!ship) return { ok: false, reason: "noShip", teams: [], security: 0, science: 0, readyAtSeconds: null };
  const byId = new Map(state.awayMembers.map((m) => [m.id, m] as const));
  const slotted = (ids: (string | null)[], teamType: GroundSquadType): AwayMember[] => {
    const out: AwayMember[] = [];
    for (const id of ids) {
      const m = id === null ? undefined : byId.get(id);
      if (m && m.assignedShipId === shipId && m.teamType === teamType) out.push(m);
    }
    return out;
  };
  const teams: GroundTeamReadiness[] = shipGroundTeams(ship).map((t, index) => {
    const squads: Record<GroundSquadType, AwayMember[]> = {
      security: slotted(t.security, "security"),
      science: slotted(t.science, "science"),
    };
    const waits: GroundTeamWait[] = [];
    let latestReturn = now;
    for (const teamType of GROUND_SQUAD_TYPES) {
      for (const m of squads[teamType]) {
        if (isMemberReady(m, now)) continue;
        const readyAtSeconds = m.injuredUntilSeconds as number; // not ready = a future injuredUntilSeconds
        latestReturn = Math.max(latestReturn, readyAtSeconds);
        waits.push({ kind: "injured", memberId: m.id, memberName: m.name, teamType, readyAtSeconds, secondsLeft: readyAtSeconds - now });
      }
    }
    const shortSecurity = squads.security.length < MIN_SECURITY_MEMBERS;
    const shortScience = squads.science.length < MIN_SCIENCE_MEMBERS;
    if (shortSecurity) waits.push({ kind: "needSecurity" });
    if (shortScience) waits.push({ kind: "needScience" });
    return {
      index,
      name: groundTeamName(ship, index),
      security: squads.security,
      science: squads.science,
      staffed: squads.security.length + squads.science.length > 0,
      deploys: waits.length === 0,
      waits,
      readyAtSeconds: shortSecurity || shortScience ? null : latestReturn,
    };
  });
  const deploying = teams.filter((t) => t.deploys);
  const security = deploying.reduce((n, t) => n + t.security.length, 0);
  const science = deploying.reduce((n, t) => n + t.science.length, 0);
  if (teams.length === 0) return { ok: false, reason: "noGroundTeams", teams, security, science, readyAtSeconds: null };
  if (deploying.length > 0 && security >= MIN_SECURITY_MEMBERS && science >= MIN_SCIENCE_MEMBERS) {
    return { ok: true, teams, security, science, readyAtSeconds: now };
  }
  const waitable = teams.map((t) => t.readyAtSeconds).filter((v): v is number => v !== null);
  return {
    ok: false,
    reason: "noTeamReady",
    teams,
    security,
    science,
    readyAtSeconds: waitable.length > 0 ? Math.min(...waitable) : null,
  };
}

// The player-facing line for one wait (US English, UI-free: every number it needs rides on the wait), e.g.
// "Grokk returns to duty in 12m". EXHAUSTIVE with no default. Pure.
export function groundTeamWaitText(wait: GroundTeamWait): string {
  switch (wait.kind) {
    case "injured":
      return `${wait.memberName} returns to duty in ${formatCountdown(wait.secondsLeft)}`;
    case "needSecurity":
      return MIN_SECURITY_MEMBERS === 1
        ? "Needs a Security member in a slot"
        : `Needs at least ${MIN_SECURITY_MEMBERS} Security members in slots`;
    case "needScience":
      return MIN_SCIENCE_MEMBERS === 1
        ? "Needs a Science member in a slot"
        : `Needs at least ${MIN_SCIENCE_MEMBERS} Science members in slots`;
  }
}

// The player-facing line for a ship that cannot launch, or null when it can. The per-team reasons ride on
// check.teams (one groundTeamWaitText each). `gameTimeSeconds` is the same clock the check was read at.
// Pure.
export function groundDeployBlockText(check: GroundDeployCheck, gameTimeSeconds: number): string | null {
  if (check.ok) return null;
  switch (check.reason ?? "noTeamReady") {
    case "noShip":
      return "That ship is no longer in the fleet";
    case "noGroundTeams":
      return "This ship fields no ground teams";
    case "noTeamReady":
      return check.readyAtSeconds === null
        ? `No ground team is ready: slot at least ${MIN_SECURITY_MEMBERS} Security and ${MIN_SCIENCE_MEMBERS} Science member into one team`
        : `No ground team is ready: the first is ready in ${formatCountdown(check.readyAtSeconds - gameTimeSeconds)}`;
  }
}
