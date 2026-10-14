// Ground Operations 0.14.0 (D25, plan docs/plans/2026-10-09-ground-operations-plan.md): GROUND TEAMS.
//
// A ship fields groundTeamCount(typeKey) ground teams (2 on every hull since Squads SQ-1; the engine supports
// N). Each team is a PAIR of squads whose members the player SLOTS, named by its kind (Ground = Security +
// Science, Strike = 2 Security, Survey = 2 Science; model.ts ShipGroundTeam, persisted on
// ShipInstance.groundTeams since SAVE v67, kinds since v68; the kind math is groundComposition.ts). This
// module holds the pure readers, the shape guards the v66 -> v67 and v67 -> v68 migrations use, the player's
// SLOTTING ACTIONS (GO-2) and the DEPLOYABLE READER
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
  GroundTeamKind,
  GroundTeamLoadout,
  ShipGroundTeam,
  ShipInstance,
  ShipTypeKey,
  SquadLoadoutKit,
} from "./model";
import { emptyGroundTeams, groundSquadSize, groundTeamCount } from "./model";
import {
  DEFAULT_GROUND_TEAM_KIND,
  isGroundTeamKind,
  isValidComposition,
  squadsOfType,
  teamSlotCount,
} from "./groundComposition";
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

// D18 MINIMUM AWAY TEAM (user, 2026-10-06): at least 1 Security AND 1 Science member. Squads SQ-2 (user,
// capture 3c: D18 stands across what deploys): it applies ACROSS THE DEPLOYING TEAMS, since a Strike team (2
// Security squads) or a Survey team (2 Science squads) can never hold both types alone. expedition.ts
// re-exports both for its dispatch gate.
export const MIN_SECURITY_MEMBERS = 1;
export const MIN_SCIENCE_MEMBERS = 1;

// The fewest members EACH SQUAD of a deploying team must have slotted (Squads SQ-2, design 2.4: a "Strike
// team" with an empty second squad would be a mislabel). Replaces GO-2's per-team D18 check.
export const MIN_SQUAD_MEMBERS = 1;

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
// Shape guards (the v66 -> v67 and v67 -> v68 migrations keep a value only when it passes)
// ============================================================================

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isSlotList = (v: unknown, length: number): v is (string | null)[] =>
  Array.isArray(v) && v.length === length && v.every((id) => id === null || typeof id === "string");

// Whether `value` is a ship's ground-team list in the CURRENT (v68) shape for `typeKey`: groundTeamCount
// teams, each with a known `kind`, Security / Science slot lists of member ids or null sized to that kind on
// this hull (groundComposition.ts teamSlotCount), a boolean help toggle, an optional string name and an
// optional `kindPending: true`. Shape only: it does not check that the ids name members aboard (GO-2's
// invariant) nor that the composition keeps one squad of each type (groundComposition.ts isValidComposition;
// no build can store a refused one, SQ-2's kind change refuses it).
export function isWellFormedShipGroundTeams(value: unknown, typeKey: ShipTypeKey): value is ShipGroundTeam[] {
  if (!Array.isArray(value) || value.length !== groundTeamCount(typeKey)) return false;
  return value.every(
    (t) =>
      isRecord(t) &&
      isGroundTeamKind(t.kind) &&
      (t.name === undefined || typeof t.name === "string") &&
      isSlotList(t.security, teamSlotCount(typeKey, t.kind, "security")) &&
      isSlotList(t.science, teamSlotCount(typeKey, t.kind, "science")) &&
      typeof t.helpOthers === "boolean" &&
      (t.kindPending === undefined || t.kindPending === true),
  );
}

// The FROZEN migration shapes (GO-1's v67, SQ-1's v68). The v66 -> v67 and v67 -> v68 migration steps
// must keep producing exactly what they produced when they shipped, whatever later hull data says, so they
// read ONLY the frozen constants below, never SHIP_TYPES (SQ-1 review: retuning a hull's squad count, squad
// sizes or awayTeams count must never reshape an old save as it migrates). The live (current) shape is
// isWellFormedShipGroundTeams above plus groundTeamSlots.ts shipGroundTeams, which re-sizes a stored list to
// the CURRENT hull whenever it is read, so a frozen step's output is always readable.

// The per-hull ground squad sizes when SAVE v67 (GO-1) and v68 (SQ-1) shipped (identical in both: the E-CREW
// table, model.ts awayTeams[].size). A hull missing here did not exist then, so no v66 / v67 save can hold
// one; the frozen steps give it no teams (the live normalizer builds them on first read).
const FROZEN_GROUND_SQUAD_SIZES: Readonly<Record<string, Readonly<Record<GroundSquadType, number>>>> = {
  generalFreighter: { security: 3, science: 3 },
  prospectorHauler: { security: 3, science: 3 },
  prospectorRunner: { security: 3, science: 3 },
  prospectorMiner: { security: 3, science: 3 },
  destroyer: { security: 4, science: 3 },
  battleship: { security: 4, science: 3 },
  carrier: { security: 4, science: 3 },
  orion: { security: 3, science: 4 },
  aurora: { security: 3, science: 4 },
  eir: { security: 4, science: 4 },
};

// The team count of each frozen shape on a hull that existed then: 1 at v67 (GO-1: one Security + one
// Science squad per ship), 2 at v68 (SQ-1: 4 squads = 2 teams on every hull).
export const V67_GROUND_TEAM_COUNT = 1;
export const V68_GROUND_TEAM_COUNT = 2;

// The frozen squad sizes of a hull that existed at v67 / v68, else undefined. Pure.
function frozenSizes(typeKey: unknown): Readonly<Record<GroundSquadType, number>> | undefined {
  return typeof typeKey === "string" && Object.prototype.hasOwnProperty.call(FROZEN_GROUND_SQUAD_SIZES, typeKey)
    ? FROZEN_GROUND_SQUAD_SIZES[typeKey]
    : undefined;
}

// One v67 ground team: the v68 team without `kind` / `kindPending`.
export type V67ShipGroundTeam = Omit<ShipGroundTeam, "kind" | "kindPending">;

// The team count the v67 shape used (frozen): V67_GROUND_TEAM_COUNT on a hull that existed at v67, else 0.
export function v67GroundTeamCount(typeKey: ShipTypeKey): number {
  return frozenSizes(typeKey) ? V67_GROUND_TEAM_COUNT : 0;
}

// Whether `value` is a ship's ground-team list in the v67 shape for `typeKey` (GO-1's guard, frozen):
// v67GroundTeamCount teams, each with frozen-size Security / Science slot lists (one squad each) of member
// ids or null, a boolean help toggle and an optional string name. Shape only.
export function isWellFormedV67ShipGroundTeams(value: unknown, typeKey: ShipTypeKey): value is V67ShipGroundTeam[] {
  if (!Array.isArray(value) || value.length !== v67GroundTeamCount(typeKey)) return false;
  const sizes = frozenSizes(typeKey);
  if (!sizes) return true; // a hull unknown at v67: only the empty list
  return value.every(
    (t) =>
      isRecord(t) &&
      (t.name === undefined || typeof t.name === "string") &&
      isSlotList(t.security, sizes.security) &&
      isSlotList(t.science, sizes.science) &&
      typeof t.helpOthers === "boolean",
  );
}

// Whether `value` is a ship's ground-team list in the v68 shape as SQ-1 shipped it (frozen): exactly
// V68_GROUND_TEAM_COUNT teams on a hull that existed then (none otherwise), each with a known `kind`, slot
// lists sized to that kind at the frozen squad sizes (the kind's squads of each type come from
// groundComposition.ts squadsOfType: the definition of the three kinds, not hull data), a boolean help
// toggle, an optional string name and an optional `kindPending: true`. The migrations' idempotency guard.
// Shape only.
export function isWellFormedV68ShipGroundTeams(value: unknown, typeKey: ShipTypeKey): value is ShipGroundTeam[] {
  const sizes = frozenSizes(typeKey);
  if (!Array.isArray(value) || value.length !== (sizes ? V68_GROUND_TEAM_COUNT : 0)) return false;
  if (!sizes) return true;
  return value.every(
    (t) =>
      isRecord(t) &&
      isGroundTeamKind(t.kind) &&
      (t.name === undefined || typeof t.name === "string") &&
      isSlotList(t.security, squadsOfType(t.kind, "security") * sizes.security) &&
      isSlotList(t.science, squadsOfType(t.kind, "science") * sizes.science) &&
      typeof t.helpOthers === "boolean" &&
      (t.kindPending === undefined || t.kindPending === true),
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

// Whether `value` is a GroundTeamLoadout (model.ts): string id + name, an optional known team `kind` (SQ-1;
// absent = Ground), Security / Science kit lists, and a null or { shipId, teamIndex } check-out. The
// never-built Task 2 per-team-TYPE shape fails it.
export function isWellFormedGroundTeamLoadout(value: unknown): value is GroundTeamLoadout {
  if (!isRecord(value)) return false;
  const out = value.checkedOutTo;
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    (value.kind === undefined || isGroundTeamKind(value.kind)) &&
    Array.isArray(value.security) &&
    value.security.every(isKit) &&
    Array.isArray(value.science) &&
    value.science.every(isKit) &&
    (out === null ||
      (isRecord(out) && typeof out.shipId === "string" && Number.isInteger(out.teamIndex) && (out.teamIndex as number) >= 0))
  );
}

// ============================================================================
// The v67 backfill (frozen) and the v67 -> v68 upgrade
// ============================================================================

// A ship's ground teams in the v67 shape, filled from its members (GO-1's fill, frozen): v67GroundTeamCount
// empty teams (one squad of each type at the frozen sizes, no kind), then team 0's Security / Science slots
// take that ship's members of the matching teamType in HIRE order (byIdNumber, the same order
// deployableMembers uses), up to each squad's size. Injury is IGNORED: an injured member stays slotted and
// simply does not deploy while injured. Members past the slots stay aboard unslotted (the reserve). Reads raw
// save data, so malformed member entries (not an object, no string id) are skipped. With every member ready
// this reproduces the pre-Ground-Ops dispatch ("first N members in hire order"). Pure.
export function backfillV67ShipGroundTeams(ship: Pick<ShipInstance, "id" | "typeKey">, members: readonly unknown[]): V67ShipGroundTeam[] {
  const sizes = frozenSizes(ship.typeKey) ?? { security: 0, science: 0 };
  const teams: V67ShipGroundTeam[] = Array.from({ length: v67GroundTeamCount(ship.typeKey) }, () => ({
    security: Array.from({ length: sizes.security }, () => null),
    science: Array.from({ length: sizes.science }, () => null),
    helpOthers: false,
  }));
  const aboard = members.filter(
    (m): m is AwayMember => isRecord(m) && typeof m.id === "string" && m.assignedShipId === ship.id,
  );
  for (const teamType of GROUND_SQUAD_TYPES) {
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

// The v67 -> v68 team upgrade (Squads SQ-1, design section 2.7; frozen): every v67 team becomes a GROUND team
// with its slots, name and help toggle untouched (GO-1's shape IS Ground), and empty Ground teams at the
// frozen squad sizes are appended up to V68_GROUND_TEAM_COUNT (one pair). With `markAdded` the appended teams
// carry `kindPending: true` (the migration's "Pick a type" prompt). NO MEMBER MOVES: every slotted id stays
// in its slot and nobody lands in the new pair. A v67 list longer than the v68 count (no hull has one) keeps
// its first teams; a hull unknown at v68 gets no teams. Fresh arrays. Pure.
export function v68ShipGroundTeamsFromV67(
  ship: Pick<ShipInstance, "typeKey">,
  v67Teams: readonly V67ShipGroundTeam[],
  markAdded: boolean,
): ShipGroundTeam[] {
  const sizes = frozenSizes(ship.typeKey);
  if (!sizes) return [];
  const kind: GroundTeamKind = DEFAULT_GROUND_TEAM_KIND;
  const teams: ShipGroundTeam[] = v67Teams.slice(0, V68_GROUND_TEAM_COUNT).map((t) => {
    const team: ShipGroundTeam = { kind, security: [...t.security], science: [...t.science], helpOthers: t.helpOthers };
    if (typeof t.name === "string") team.name = t.name;
    return team;
  });
  while (teams.length < V68_GROUND_TEAM_COUNT) {
    const added: ShipGroundTeam = {
      kind,
      security: Array.from({ length: sizes.security }, () => null),
      science: Array.from({ length: sizes.science }, () => null),
      helpOthers: false,
    };
    if (markAdded) added.kindPending = true;
    teams.push(added);
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
//   noSuchKind:    a team type change to something that is not Ground / Strike / Survey (SQ-2)
//   sameKind:      a no-op team type change: the team already is that type and needs no confirm (SQ-2)
//   needsBothTypes: the change would leave the ship without a Security squad or without a Science squad
//                  (user: "Always require one of each type minimum"; Strike + Strike, Survey + Survey) (SQ-2)
export type GroundSlotBlockReason =
  | "noShip"
  | "onMission"
  | "noSuchTeam"
  | "noSuchSlot"
  | "noMember"
  | "wrongShip"
  | "wrongTeamType"
  | "alreadyThere"
  | "notSlotted"
  | "noSuchKind"
  | "sameKind"
  | "needsBothTypes";

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
    case "noSuchKind":
      return "No such team type";
    case "sameKind":
      return "Already this team type";
    case "needsBothTypes":
      return "A ship needs at least one Security squad and one Science squad";
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
// Team type change (Squads SQ-2, design 2.6 + the user's rulings 2026-10-12)
// ============================================================================
//
// setGroundTeamKind turns one team into a Ground (Security + Science), Strike (2 Security) or Survey (2
// Science) team. Rules:
// - Refuses while the ship's crew is locked (out on a run), like every slot write.
// - Refuses a composition without a Security squad or without a Science squad (needsBothTypes).
// - Members whose type the new kind still holds keep their slots, in place (Ground -> Strike keeps the
//   Security squad as squad 1; Strike -> Ground keeps squad 1 and drops squad 2). Members of a DROPPED squad
//   go to the ship's RESERVE (aboard, unslotted). Nobody leaves the ship: the reserve berths are one squad's
//   worth (groundComposition.ts shipReserveBerths), so a change from a full reserve-free ship always fits;
//   a ship whose reserve was already in use can end up OVER CAPACITY, which only blocks hiring that type
//   (awayTeam.ts squadGate overCapacity) until members leave.
// - The NEW squad (the slots the new kind adds) auto-fills from the reserve of its type, first by hire
//   order (the GO-2 auto-slot QoL). Gaps the player left in a kept squad stay as they are.
// - Clears `kindPending` (the migration's "Pick a type" prompt); choosing the type a pending team already
//   has is that confirm ("Keep Ground"), so it is not a no-op.

// What a type change would move: the members of dropped squads (to the reserve, slot order) and the reserve
// members the new squad takes (hire order). The UI names them before the player confirms ("Sho and Vela
// move to the reserve"). On refusal, the reason. Pure.
export type GroundTeamKindPreview =
  | { ok: true; toReserve: string[]; fromReserve: string[] }
  | { ok: false; reason: GroundSlotBlockReason };

// The gate plus the planned teams (a normalized, cleaned copy with the change applied). Checked in order:
// noShip, onMission, noSuchTeam, noSuchKind, sameKind, needsBothTypes. Pure.
function planGroundTeamKind(
  state: GameState,
  shipId: string,
  teamIndex: number,
  kind: GroundTeamKind,
): { gate: GroundSlotGate } | { teams: ShipGroundTeam[]; toReserve: string[]; fromReserve: string[] } {
  const s = shipGate(state, shipId);
  if ("gate" in s) return { gate: s.gate };
  const teams = writableTeams(state, s.ship);
  const team = teamAt(teams, teamIndex);
  if (!team) return { gate: refuse("noSuchTeam") };
  if (!isGroundTeamKind(kind)) return { gate: refuse("noSuchKind") };
  if (team.kind === kind && team.kindPending !== true) return { gate: refuse("sameKind") };
  const kinds = teams.map((t) => t.kind);
  kinds[teamIndex] = kind;
  if (!isValidComposition(kinds)) return { gate: refuse("needsBothTypes") };

  const next: ShipGroundTeam = { ...team, kind, security: [], science: [] };
  delete next.kindPending;
  const toReserve: string[] = [];
  const fromReserve: string[] = [];
  const opened: [GroundSquadType, number][] = [];
  for (const teamType of GROUND_SQUAD_TYPES) {
    const old = team[teamType];
    const length = teamSlotCount(s.ship.typeKey, kind, teamType);
    next[teamType] = Array.from({ length }, (_, i) => (i < old.length ? old[i] : null));
    for (let i = length; i < old.length; i += 1) {
      const id = old[i];
      if (id !== null) toReserve.push(id);
    }
    if (length > old.length) opened.push([teamType, old.length]);
  }
  teams[teamIndex] = next;
  for (const [teamType, from] of opened) {
    const slotted = new Set<string>();
    for (const t of teams) for (const id of [...t.security, ...t.science]) if (id !== null) slotted.add(id);
    const reserve = state.awayMembers
      .filter((m) => m.assignedShipId === shipId && m.teamType === teamType && !slotted.has(m.id))
      .sort(byIdNumber);
    const slots = next[teamType];
    for (let i = from, r = 0; i < slots.length && r < reserve.length; i += 1, r += 1) {
      slots[i] = reserve[r].id;
      fromReserve.push(reserve[r].id);
    }
  }
  return { teams, toReserve, fromReserve };
}

// Can team `teamIndex` of `shipId` become `kind`? Pure.
export function canSetGroundTeamKind(state: GameState, shipId: string, teamIndex: number, kind: GroundTeamKind): GroundSlotGate {
  const plan = planGroundTeamKind(state, shipId, teamIndex, kind);
  return "gate" in plan ? plan.gate : { ok: true };
}

// Who a type change would move (see GroundTeamKindPreview). Pure.
export function previewGroundTeamKind(
  state: GameState,
  shipId: string,
  teamIndex: number,
  kind: GroundTeamKind,
): GroundTeamKindPreview {
  const plan = planGroundTeamKind(state, shipId, teamIndex, kind);
  if ("gate" in plan) return plan.gate.ok ? { ok: true, toReserve: [], fromReserve: [] } : plan.gate;
  return { ok: true, toReserve: plan.toReserve, fromReserve: plan.fromReserve };
}

// Change a team's type (the rules above). Refuses (SAME state) whenever canSetGroundTeamKind does. Never
// changes an awayMembers record (nobody leaves the ship; only slots move). Pure.
export function setGroundTeamKind(state: GameState, shipId: string, teamIndex: number, kind: GroundTeamKind): GameState {
  const plan = planGroundTeamKind(state, shipId, teamIndex, kind);
  if ("gate" in plan) return state;
  return withShipTeams(state, shipId, plan.teams);
}

// ============================================================================
// Squads SQ-6: set a whole COMPOSITION at once (the launch recommendation's "Set composition", design 6.5 step 5;
// SQ-7's button calls applyComposition). Built ONLY from setGroundTeamKind, so every SQ-2 rule holds: the crew lock,
// one of each type at every step, kept members in place, dropped squads to the reserve, the new squad filled from
// the reserve, kindPending cleared on a changed team.
// ============================================================================
//
// `kinds` is a composition (a multiset: team order never matters). Of every way to give the ship's teams those
// kinds, the plan picks the FEWEST squads changed, then the fewest members moved (to and from the reserve), then
// the one that leaves the EARLIER teams as they are (ties: the later team changes, so Alpha stays put). Its changes
// run in team order, or in the other order when the one-of-each rule refuses a middle step. A team whose kind
// already matches is never written (a pending team keeps its "Pick a type" prompt).

export interface CompositionChange {
  teamIndex: number;
  from: GroundTeamKind;
  to: GroundTeamKind;
  toReserve: string[]; // members this change drops to the reserve (slot order)
  fromReserve: string[]; // reserve members it slots (hire order)
}

export type CompositionPlan = { ok: true; changes: CompositionChange[] } | { ok: false; reason: GroundSlotBlockReason };

// Every distinct ordering of a short list (team counts are 2 today). Pure.
function orderings<T>(list: readonly T[]): T[][] {
  if (list.length <= 1) return [[...list]];
  const out: T[][] = [];
  const seen = new Set<string>();
  list.forEach((item, i) => {
    for (const rest of orderings([...list.slice(0, i), ...list.slice(i + 1)])) {
      const p = [item, ...rest];
      const key = JSON.stringify(p);
      if (!seen.has(key)) {
        seen.add(key);
        out.push(p);
      }
    }
  });
  return out;
}

// The plan (see above) and the state it lands on, or the refusal. Checked in order: noShip, onMission, noSuchTeam
// (a kind list of the wrong length), noSuchKind, needsBothTypes (not a valid composition), sameKind (the ship
// already fields it). Pure.
function compositionRun(
  state: GameState,
  shipId: string,
  kinds: readonly GroundTeamKind[],
): { gate: GroundSlotGate } | { changes: CompositionChange[]; next: GameState } {
  const s = shipGate(state, shipId);
  if ("gate" in s) return { gate: s.gate };
  const teams = writableTeams(state, s.ship);
  if (!Array.isArray(kinds) || kinds.length !== teams.length) return { gate: refuse("noSuchTeam") };
  if (!kinds.every(isGroundTeamKind)) return { gate: refuse("noSuchKind") };
  if (!isValidComposition(kinds)) return { gate: refuse("needsBothTypes") };
  const current = teams.map((t) => t.kind);
  let best: { changes: CompositionChange[]; next: GameState; squads: number; moved: number; changed: boolean[] } | null = null;
  for (const target of orderings(kinds)) {
    const indices = target.map((_, i) => i).filter((i) => target[i] !== current[i]);
    if (indices.length === 0) return { gate: refuse("sameKind") };
    let run: { changes: CompositionChange[]; next: GameState } | null = null;
    for (const order of orderings(indices)) {
      let st = state;
      const changes: CompositionChange[] = [];
      for (const i of order) {
        const preview = previewGroundTeamKind(st, shipId, i, target[i]);
        if (!preview.ok) break;
        changes.push({ teamIndex: i, from: current[i], to: target[i], toReserve: preview.toReserve, fromReserve: preview.fromReserve });
        st = setGroundTeamKind(st, shipId, i, target[i]);
      }
      if (changes.length === order.length) {
        run = { changes, next: st };
        break;
      }
    }
    if (!run) continue;
    const squads = indices.reduce((n, i) => n + Math.abs(squadsOfType(target[i], "security") - squadsOfType(current[i], "security")), 0);
    const moved = run.changes.reduce((n, c) => n + c.toReserve.length + c.fromReserve.length, 0);
    const changed = target.map((k, i) => k !== current[i]);
    const ahead =
      best === null ||
      squads < best.squads ||
      (squads === best.squads && (moved < best.moved || (moved === best.moved && earlierTeamsKept(changed, best.changed))));
    if (ahead) best = { ...run, squads, moved, changed };
  }
  if (!best) return { gate: refuse("needsBothTypes") };
  return { changes: best.changes, next: best.next };
}

// Does `a` leave an earlier team unchanged where `b` changes it (compared from Alpha on)? Pure.
function earlierTeamsKept(a: readonly boolean[], b: readonly boolean[]): boolean {
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return !a[i];
  return false;
}

// Which teams setting composition `kinds` would change, and who moves (the UI's confirm). Pure.
export function planComposition(state: GameState, shipId: string, kinds: readonly GroundTeamKind[]): CompositionPlan {
  const run = compositionRun(state, shipId, kinds);
  if ("gate" in run) return run.gate.ok ? { ok: true, changes: [] } : run.gate;
  return { ok: true, changes: run.changes };
}

// Set composition `kinds` on `shipId` (see above). Refuses (SAME state) whenever planComposition does. Never
// changes an awayMembers record. Pure.
export function applyComposition(state: GameState, shipId: string, kinds: readonly GroundTeamKind[]): GameState {
  const run = compositionRun(state, shipId, kinds);
  return "gate" in run ? state : run.next;
}

// ============================================================================
// The deployable reader (GO-2; GO-7b switches dispatch to it). NO AUTOMATIC STAND-INS (user, 2026-10-12):
// a ground team with any slotted member who is not ready does not deploy, and the dispatch attempt shows
// what it is waiting on with the time remaining. The player swaps members by hand.
// ============================================================================

// Why one ground team does not deploy right now:
//   injured:    a slotted member is not ready (D24 recovery); carries the member's name, the absolute return
//               time and the seconds left, so the wait text needs no state
//   emptySquad: one of the team's squads has fewer than MIN_SQUAD_MEMBERS members slotted (Squads SQ-2:
//               PER SQUAD, replacing GO-2's per-team needSecurity / needScience). `squadIndex` is the squad's
//               place in the team (Security squads first, then Science: the flat slot lists' order),
//               `typeSquadIndex` its place among the team's `typeSquads` squads of that type.
export type GroundTeamWait =
  | {
      kind: "injured";
      memberId: string;
      memberName: string;
      teamType: GroundSquadType;
      readyAtSeconds: number;
      secondsLeft: number;
    }
  | { kind: "emptySquad"; squadIndex: number; teamType: GroundSquadType; typeSquadIndex: number; typeSquads: number };

// One squad of a team, as the deploy check read it (Squads SQ-2).
export interface GroundSquadReadiness {
  index: number; // the squad's place in the team: Security squads first, then Science
  teamType: GroundSquadType;
  members: AwayMember[]; // the slotted members (aboard, matching type), slot order
}

export interface GroundTeamReadiness {
  index: number; // ship team index (0 = Alpha)
  name: string; // groundTeamName: the custom name, else the default
  kind: GroundTeamKind; // the team's type (SQ-2)
  squads: GroundSquadReadiness[]; // the team's squads by its kind (Ground: Security then Science)
  security: AwayMember[]; // every slotted Security member across its squads, slot order
  science: AwayMember[]; // every slotted Science member, slot order
  staffed: boolean; // at least one member slotted (an unstaffed team simply stays aboard)
  deploys: boolean; // every slotted member ready AND every squad holds at least MIN_SQUAD_MEMBERS
  waits: GroundTeamWait[]; // [] exactly when it deploys; injuries first (squad then slot order), then empty squads
  // When the team deploys by WAITING alone: now when it deploys; the last slotted member's return when the
  // only waits are injuries; null when the player must slot someone first (an empty squad).
  readyAtSeconds: number | null;
}

// Why the ship cannot launch ground operations right now:
//   noShip:        the ship does not exist
//   noGroundTeams: the hull fields no ground teams
//   noTeamReady:   no ground team deploys
//   missingType:   at least one team deploys, but what deploys lacks D18's Security or Science member (a
//                  Strike team ready while the only Science squads wait, SQ-2); `missingType` names it
export type GroundDeployBlockReason = "noShip" | "noGroundTeams" | "noTeamReady" | "missingType";

export interface GroundDeployCheck {
  ok: boolean; // at least one team deploys and the deploying teams meet D18 in total
  reason?: GroundDeployBlockReason; // set only when not ok
  missingType?: GroundSquadType; // set only with reason missingType
  teams: GroundTeamReadiness[]; // every team of the hull, index order
  security: number; // Security members across the deploying teams
  science: number; // Science members across the deploying teams
  // The soonest time the ship can launch by waiting alone: now when ok; otherwise the first time the teams
  // that are ready by then (each team's readyAtSeconds) hold D18's Security AND Science member between them;
  // null when no wait gets there without the player slotting someone.
  readyAtSeconds: number | null;
}

// The soonest time the waitable teams cover D18 between them: teams in readyAtSeconds order (ties by index),
// summing each one's slotted Security / Science members, the first readyAtSeconds at which both minimums
// hold; null when they never do. Pure.
function launchReadyAt(teams: readonly GroundTeamReadiness[]): number | null {
  const waitable = teams
    .filter((t): t is GroundTeamReadiness & { readyAtSeconds: number } => t.readyAtSeconds !== null)
    .sort((a, b) => a.readyAtSeconds - b.readyAtSeconds || a.index - b.index);
  let security = 0;
  let science = 0;
  for (const t of waitable) {
    security += t.security.length;
    science += t.science.length;
    if (security >= MIN_SECURITY_MEMBERS && science >= MIN_SCIENCE_MEMBERS) return t.readyAtSeconds;
  }
  return null;
}

// Per-team readiness for `shipId` at state.gameTimeSeconds (Squads SQ-2: per SQUAD). A team deploys only
// when EACH of its squads has at least MIN_SQUAD_MEMBERS slotted and every slotted member is ready (no
// automatic stand-ins, user 2026-10-12: a ready reserve member never stands in); the ship is ok when at
// least one team deploys and the deploying teams hold D18 (MIN_SECURITY_MEMBERS AND MIN_SCIENCE_MEMBERS)
// between them. A slot naming an id that is not a member aboard this ship with the matching type
// (impossible through the actions; defensive) reads as empty. The crew lock is NOT part of this reader
// (dispatch's own gates refuse a ship that is already out). Pure.
export function deployableGroundTeams(state: GameState, shipId: string): GroundDeployCheck {
  const now = state.gameTimeSeconds;
  const ship = state.ships.find((s) => s.id === shipId);
  if (!ship) return { ok: false, reason: "noShip", teams: [], security: 0, science: 0, readyAtSeconds: null };
  const byId = new Map(state.awayMembers.map((m) => [m.id, m] as const));
  const slotted = (ids: readonly (string | null)[], teamType: GroundSquadType): AwayMember[] => {
    const out: AwayMember[] = [];
    for (const id of ids) {
      const m = id === null ? undefined : byId.get(id);
      if (m && m.assignedShipId === shipId && m.teamType === teamType) out.push(m);
    }
    return out;
  };
  const teams: GroundTeamReadiness[] = shipGroundTeams(ship).map((t, index) => {
    const squads: GroundSquadReadiness[] = [];
    const empties: GroundTeamWait[] = [];
    for (const teamType of GROUND_SQUAD_TYPES) {
      const typeSquads = squadsOfType(t.kind, teamType);
      const size = groundSquadSize(ship.typeKey, teamType);
      for (let k = 0; k < typeSquads; k += 1) {
        const members = slotted(t[teamType].slice(k * size, (k + 1) * size), teamType);
        const squadIndex = squads.length;
        squads.push({ index: squadIndex, teamType, members });
        if (members.length < MIN_SQUAD_MEMBERS) empties.push({ kind: "emptySquad", squadIndex, teamType, typeSquadIndex: k, typeSquads });
      }
    }
    const waits: GroundTeamWait[] = [];
    let latestReturn = now;
    for (const squad of squads) {
      for (const m of squad.members) {
        if (isMemberReady(m, now)) continue;
        const readyAtSeconds = m.injuredUntilSeconds as number; // not ready = a future injuredUntilSeconds
        latestReturn = Math.max(latestReturn, readyAtSeconds);
        waits.push({ kind: "injured", memberId: m.id, memberName: m.name, teamType: squad.teamType, readyAtSeconds, secondsLeft: readyAtSeconds - now });
      }
    }
    waits.push(...empties);
    const security = squads.filter((q) => q.teamType === "security").flatMap((q) => q.members);
    const science = squads.filter((q) => q.teamType === "science").flatMap((q) => q.members);
    return {
      index,
      name: groundTeamName(ship, index),
      kind: t.kind,
      squads,
      security,
      science,
      staffed: security.length + science.length > 0,
      deploys: waits.length === 0,
      waits,
      readyAtSeconds: empties.length > 0 ? null : latestReturn,
    };
  });
  const deploying = teams.filter((t) => t.deploys);
  const security = deploying.reduce((n, t) => n + t.security.length, 0);
  const science = deploying.reduce((n, t) => n + t.science.length, 0);
  if (teams.length === 0) return { ok: false, reason: "noGroundTeams", teams, security, science, readyAtSeconds: null };
  if (deploying.length > 0 && security >= MIN_SECURITY_MEMBERS && science >= MIN_SCIENCE_MEMBERS) {
    return { ok: true, teams, security, science, readyAtSeconds: now };
  }
  const readyAtSeconds = launchReadyAt(teams);
  if (deploying.length === 0) return { ok: false, reason: "noTeamReady", teams, security, science, readyAtSeconds };
  return {
    ok: false,
    reason: "missingType",
    missingType: security < MIN_SECURITY_MEMBERS ? "security" : "science",
    teams,
    security,
    science,
    readyAtSeconds,
  };
}

// The player-facing line for one wait (US English, UI-free: every number it needs rides on the wait), e.g.
// "Grokk returns to duty in 12m", "Needs a Science member in a slot" (a Ground team's one Science squad),
// "Security squad 2 needs a member in a slot" (a Strike team). EXHAUSTIVE with no default. Pure.
export function groundTeamWaitText(wait: GroundTeamWait): string {
  switch (wait.kind) {
    case "injured":
      return `${wait.memberName} returns to duty in ${formatCountdown(wait.secondsLeft)}`;
    case "emptySquad": {
      const type = wait.teamType === "security" ? "Security" : "Science";
      return wait.typeSquads === 1
        ? `Needs a ${type} member in a slot`
        : `${type} squad ${wait.typeSquadIndex + 1} needs a member in a slot`;
    }
  }
}

// The teams whose waits a blocked dispatch should list (Squads SQ-1): the STAFFED teams (at least one member
// slotted), or, when nobody is slotted anywhere, the first team alone (what to slot to launch at all). Every
// hull fields 2 teams since SQ-1, and the empty pair (the v68 migration's, or a fresh ship's Bravo) would
// otherwise add "needs a member" lines to a block that is really about Alpha. Pure.
export function groundWaitTeams(check: Pick<GroundDeployCheck, "teams">): GroundTeamReadiness[] {
  const staffed = check.teams.filter((t) => t.staffed);
  return staffed.length > 0 ? staffed : check.teams.slice(0, 1);
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
        ? `No ground team is ready: slot at least ${MIN_SQUAD_MEMBERS} member into each squad of a team`
        : `No ground team is ready: the first is ready in ${formatCountdown(check.readyAtSeconds - gameTimeSeconds)}`;
    case "missingType": {
      const type = check.missingType === "security" ? "Security" : "Science";
      return check.readyAtSeconds === null
        ? `Nothing ready covers ${type}: a team with a ${type} squad must deploy too`
        : `Nothing ready covers ${type}: ready in ${formatCountdown(check.readyAtSeconds - gameTimeSeconds)}`;
    }
  }
}
