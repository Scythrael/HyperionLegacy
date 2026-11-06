// shipRosterDisplay.ts: the display decisions behind the roster picker on a ship's personnel screen (0.14.0
// Complement CP-17, E-CREW Task 30; crew spec "a DROPDOWN to load one from the ship's personnel screen").
//
// WHY a .ts beside ShipRosterBar.svelte: this repo has no Svelte component test harness, so every decision worth
// gating (which rosters are offered, whether the ship's people are saved in any roster, and why Apply is disabled)
// lives here as pure functions over the tested engine (personnelRosters.ts, crewLock.ts). No game rule lives here:
// the Apply gate is the engine's own canApplyRoster, and the click runs App's doApplyRoster, the same handler the
// Personnel Rosters facility uses, so a linked loadout travels exactly as it does from there. The warning check runs
// the pure applyRoster on the current state only to read the result back; nothing here writes state.

import type { GameState, PersonnelRoster, SeniorStaffSeat } from "./game/model";
import { SENIOR_STAFF_SEATS } from "./game/seniorStaff";
import { applyRoster, canApplyRoster, rosterApplyGateText } from "./game/personnelRosters";
import { crewLockReason, crewLockReasonText, crewLockUntilText } from "./game/crewLock";

// === What is offered ===

export interface ShipRosterOption {
  id: string;
  label: string;
}

// The saved rosters the picker offers, in saved order: every roster that carries people. The facility's Apply
// is disabled for a roster without people ("This roster carries no people to apply"), so this picker never
// offers one. The facility enforces no hull filter (it lists every ship for every roster; a linked loadout pinned
// to another hull simply stays in the Armory, never forced), so neither does this. Pure.
export function shipRosterOptions(state: GameState): ShipRosterOption[] {
  return state.personnelRosters.filter((r) => r.includePeople).map((r) => ({ id: r.id, label: r.name }));
}

// The truthful empty state when nothing can be offered, or null when the picker has options. Pure.
export function shipRosterEmptyText(state: GameState): string | null {
  if (state.personnelRosters.length === 0) {
    return "No saved rosters yet. Build one in Facilities, Personnel Rosters.";
  }
  if (shipRosterOptions(state).length === 0) {
    return "No saved roster carries people yet. Turn on Include Senior Staff & Complement for one in Facilities, Personnel Rosters.";
  }
  return null;
}

// === Is the ship's current setup saved? ===

// The people a roster records, as the ship would read them: the officer per seat and the set of notable crew.
// The bulk complement is fungible and never part of a roster (it auto-fills on apply), so it is not compared.
interface PeopleSetup {
  seats: Record<SeniorStaffSeat, string | null>;
  notableIds: ReadonlySet<string>;
}

// The ship's current people. Pure.
function shipSetup(state: GameState, shipId: string): PeopleSetup {
  const seats = {} as Record<SeniorStaffSeat, string | null>;
  for (const seat of SENIOR_STAFF_SEATS) {
    seats[seat] = state.officers.find((o) => o.assignedShipId === shipId && o.seat === seat)?.id ?? null;
  }
  const notableIds = new Set(
    state.notableCrew.filter((n) => (n.assignedShipId ?? null) === shipId).map((n) => n.id),
  );
  return { seats, notableIds };
}

// The people a roster records. A pin the engine would skip on apply (an officer or notable no longer in the
// fleet, or an officer whose seat type does not match) is read as no pin, the engine's own skip rule. Pure.
function rosterSetup(state: GameState, roster: PersonnelRoster): PeopleSetup {
  const seats = {} as Record<SeniorStaffSeat, string | null>;
  for (const seat of SENIOR_STAFF_SEATS) {
    const id = roster.seatAssignments[seat];
    const officer = id === undefined ? undefined : state.officers.find((o) => o.id === id);
    seats[seat] = officer !== undefined && officer.seat === seat ? officer.id : null;
  }
  const notableIds = new Set(roster.pinnedNotableCrew.filter((id) => state.notableCrew.some((n) => n.id === id)));
  return { seats, notableIds };
}

function sameSetup(a: PeopleSetup, b: PeopleSetup): boolean {
  if (SENIOR_STAFF_SEATS.some((seat) => a.seats[seat] !== b.seats[seat])) return false;
  if (a.notableIds.size !== b.notableIds.size) return false;
  for (const id of a.notableIds) if (!b.notableIds.has(id)) return false;
  return true;
}

// Whether the ship's current people are exactly a roster's: every seat holds the roster's officer (an empty seat
// matches an unpinned one) and the notable crew aboard are exactly its pins. A roster without people records
// none, so it never matches. Pure.
export function shipMatchesRoster(state: GameState, shipId: string, roster: PersonnelRoster): boolean {
  if (!roster.includePeople) return false;
  return sameSetup(shipSetup(state, shipId), rosterSetup(state, roster));
}

// The first saved roster the ship's people match, or null. Pure.
export function shipMatchingRosterId(state: GameState, shipId: string): string | null {
  return state.personnelRosters.find((r) => shipMatchesRoster(state, shipId, r))?.id ?? null;
}

// Whether the ship has any people a roster could record (a seated officer or a notable aboard). Pure.
function shipHasPeople(state: GameState, shipId: string): boolean {
  const setup = shipSetup(state, shipId);
  return setup.notableIds.size > 0 || SENIOR_STAFF_SEATS.some((seat) => setup.seats[seat] !== null);
}

// THE WARNING CONDITION (crew spec: "If the current roster is UNSAVED and the player tries to switch rosters,
// WARN that the current configuration is unsaved and will be lost on swap"): the ship's people differ from every
// saved roster. A ship with no officers and no notable crew has nothing to lose, so it never warns. Pure.
export function shipSetupUnsaved(state: GameState, shipId: string): boolean {
  return shipHasPeople(state, shipId) && shipMatchingRosterId(state, shipId) === null;
}

// Whether Apply should open the warning first: the setup is unsaved AND applying this roster would actually change
// the ship's officers or notable crew (it is the engine's own applyRoster, run on the current state and read back).
// A roster whose people are already aboard changes nothing here, so nothing is lost and the words would not be
// true. Pure.
export function shipRosterApplyWarns(state: GameState, shipId: string, rosterId: string): boolean {
  if (!shipSetupUnsaved(state, shipId)) return false;
  const after = applyRoster(state, rosterId, shipId);
  if (after === state) return false;
  return !sameSetup(shipSetup(state, shipId), shipSetup(after, shipId));
}

// The one-line status under the picker: which saved roster the ship's people match, that they match none, or
// nothing for a ship with no people yet. Pure.
export function shipRosterStatusText(state: GameState, shipId: string): string | null {
  if (!shipHasPeople(state, shipId)) return null;
  const matchId = shipMatchingRosterId(state, shipId);
  if (matchId === null) return "Current officers and notable crew are not saved in any roster.";
  const name = state.personnelRosters.find((r) => r.id === matchId)?.name ?? matchId;
  return `Current officers and notable crew match ${name}.`;
}

// The picker's default: the roster the ship's people match (a ship with people), else the first offered, else "".
// Pure.
export function defaultShipRosterId(state: GameState, shipId: string): string {
  const options = shipRosterOptions(state);
  const matchId = shipHasPeople(state, shipId) ? shipMatchingRosterId(state, shipId) : null;
  if (matchId !== null && options.some((o) => o.id === matchId)) return matchId;
  return options[0]?.id ?? "";
}

// === Why Apply is disabled ===

export interface ShipRosterBlock {
  text: string;
  // true when the reason is a crew lock (CP-6), so the bar shows the lock glyph beside the words.
  locked: boolean;
}

// Why Apply is disabled for this ship and pick, or null when it is enabled. The ship's own crew lock comes first
// and holds whatever is picked (the same words as the facility: "Ship is out on a mission: crew changes wait
// until it returns."). Otherwise the engine's gate for the picked roster decides (a pinned person aboard another
// ship that is out, a roster or ship that is gone). Pure.
export function shipRosterApplyBlock(state: GameState, shipId: string, rosterId: string): ShipRosterBlock | null {
  const own = crewLockReason(state, shipId);
  if (own !== null) {
    return { text: `${crewLockReasonText(own)}: crew changes wait ${crewLockUntilText(own)}.`, locked: true };
  }
  if (rosterId === "") return { text: "Choose a roster to apply.", locked: false };
  const roster = state.personnelRosters.find((r) => r.id === rosterId);
  if (roster !== undefined && !roster.includePeople) {
    return { text: "This roster carries no people to apply.", locked: false };
  }
  const gate = canApplyRoster(state, rosterId, shipId);
  if (gate.ok) return null;
  const why = rosterApplyGateText(state, gate) ?? "";
  if ("lockedShipId" in gate) {
    const reason = crewLockReason(state, gate.lockedShipId);
    if (reason !== null) return { text: `${why}: crew changes wait ${crewLockUntilText(reason)}.`, locked: true };
  }
  return { text: `${why}.`, locked: false };
}
