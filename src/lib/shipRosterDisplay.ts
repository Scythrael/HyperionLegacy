// shipRosterDisplay.ts: the display decisions behind the roster picker on a ship's personnel screen (0.14.0
// Complement CP-17, E-CREW Task 30; crew spec "a DROPDOWN to load one from the ship's personnel screen").
//
// WHY a .ts beside ShipRosterBar.svelte: this repo has no Svelte component test harness, so every decision worth
// gating (which rosters are offered, whether the ship's people are saved in any roster, and why Apply is disabled)
// lives here as pure functions over the tested engine (personnelRosters.ts, crewLock.ts). No game rule lives here:
// the Apply gate is the engine's own canApplyRoster, and the click runs App's doApplyRoster, the same handler the
// Personnel Rosters facility uses, so a linked loadout travels exactly as it does from there. The warning, the
// pulled-people list and the match check run the pure applyRoster on the current state only to read the result back;
// nothing here writes state.

import { SHIP_TYPES, shipDisplayLabel } from "./game/model";
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
// to another hull simply stays in the Armory, never forced, and shipRosterGearLine says so), so neither does this.
// Pure.
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

// How the ship's current people read against a roster:
//   exact:  every seat holds the roster's officer (an empty seat matches an unpinned one) and the notable crew aboard
//           are exactly its pins.
//   capped: the same, except for pinned notable crew the engine's caps keep off this ship, so applying the roster again
//           right now would leave its people as they are. A clean apply that skipped a pin at a cap lands here. It is
//           read back from applyRoster, never modeled; a refused apply (a ship involved is locked) proves nothing, so
//           it is no match.
//   null:   neither. A roster without people records none, so it never matches.
// Pure.
function rosterMatch(state: GameState, shipId: string, roster: PersonnelRoster): "exact" | "capped" | null {
  if (!roster.includePeople) return null;
  const ship = shipSetup(state, shipId);
  const pinned = rosterSetup(state, roster);
  if (sameSetup(ship, pinned)) return "exact";
  if (SENIOR_STAFF_SEATS.some((seat) => ship.seats[seat] !== pinned.seats[seat])) return null;
  for (const id of ship.notableIds) if (!pinned.notableIds.has(id)) return null;
  const after = applyRoster(state, roster.id, shipId);
  return after !== state && sameSetup(ship, shipSetup(after, shipId)) ? "capped" : null;
}

// Whether the ship's current people are a roster's, exactly or as far as the ship's caps allow. Pure.
export function shipMatchesRoster(state: GameState, shipId: string, roster: PersonnelRoster): boolean {
  return rosterMatch(state, shipId, roster) !== null;
}

// The saved roster the ship's people match, or null: the first exact match, else the first capped one. Pure.
export function shipMatchingRosterId(state: GameState, shipId: string): string | null {
  const rosters = state.personnelRosters;
  const match =
    rosters.find((r) => rosterMatch(state, shipId, r) === "exact") ??
    rosters.find((r) => rosterMatch(state, shipId, r) === "capped");
  return match?.id ?? null;
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

// Whether the unsaved warning applies (user 2026-11-09, "Only when something is lost"): the setup is unsaved AND
// applying this roster really takes someone off this ship, so "will lose it" is always true. The one person applyRoster
// takes off the target ship is an officer evicted from a pinned seat: step (a) unassigns a different occupant, step (b)
// only adds notable crew, step (c) only adds bulk, and a seat the roster does not pin keeps its officer. So an additive
// apply never warns. It is the engine's own applyRoster, run on the current state and read back. Pure.
export function shipRosterApplyWarns(state: GameState, shipId: string, rosterId: string): boolean {
  if (!shipSetupUnsaved(state, shipId)) return false;
  const after = applyRoster(state, rosterId, shipId);
  if (after === state) return false;
  const before = shipSetup(state, shipId).seats;
  const now = shipSetup(after, shipId).seats;
  return SENIOR_STAFF_SEATS.some((seat) => before[seat] !== null && before[seat] !== now[seat]);
}

// === Who an apply pulls off other ships ===

export interface RosterPull {
  id: string;
  name: string;
  fromShipId: string;
  fromShipLabel: string;
}

// The people this apply would take off OTHER ships (user 2026-11-09, "Warn and log it"), officers first, then notable
// crew. Read back from the engine's own applyRoster, so it is the same rule by construction: assignOfficerToShip and
// step (b) take a pinned person from any ship that is not out, a notable the caps keep out stays where it is and is not
// listed, and a refused apply lists no one. Someone unassigned or already aboard is not pulled. Display and log only:
// nothing here decides who moves. Pure.
export function rosterApplyPulls(state: GameState, rosterId: string, shipId: string): RosterPull[] {
  const after = applyRoster(state, rosterId, shipId);
  if (after === state) return [];
  const pull = (
    before: readonly { id: string; name: string; assignedShipId?: string | null }[],
    now: readonly { id: string; assignedShipId?: string | null }[],
  ): RosterPull[] => {
    const out: RosterPull[] = [];
    for (const person of before) {
      const from = person.assignedShipId ?? null;
      if (from === null || from === shipId) continue;
      if ((now.find((p) => p.id === person.id)?.assignedShipId ?? null) !== shipId) continue;
      const ship = state.ships.find((s) => s.id === from);
      out.push({ id: person.id, name: person.name, fromShipId: from, fromShipLabel: ship ? shipDisplayLabel(state, ship) : from });
    }
    return out;
  };
  return [...pull(state.officers, after.officers), ...pull(state.notableCrew, after.notableCrew)];
}

// One pulled person, as both confirm steps list them. Pure.
export function rosterPullLine(pull: RosterPull): string {
  return `${pull.name}, from ${pull.fromShipLabel}`;
}

// The log line naming each person pulled and the ship they left. Pure.
export function rosterPullsLogText(rosterName: string, pulls: readonly RosterPull[]): string {
  return `Roster "${rosterName}" pulled ${pulls.map((p) => `${p.name} from ${p.fromShipLabel}`).join(", ")}.`;
}

// The confirm title when only a pull needs saying (the facility always, the ship picker when nothing is lost).
export const ROSTER_PULL_TITLE = "Pulled From Another Ship";

// The ship picker's one confirm step before Apply, or null to apply at once: `unsaved` when the unsaved warning applies,
// `pulls` for anyone pulled off another ship, even when nothing is lost on this ship. Pure.
export interface ShipRosterConfirm {
  title: string;
  unsaved: boolean;
  pulls: RosterPull[];
}

export function shipRosterApplyConfirm(state: GameState, shipId: string, rosterId: string): ShipRosterConfirm | null {
  const unsaved = shipRosterApplyWarns(state, shipId, rosterId);
  const pulls = rosterApplyPulls(state, rosterId, shipId);
  if (!unsaved && pulls.length === 0) return null;
  return { title: unsaved ? "Unsaved Configuration" : ROSTER_PULL_TITLE, unsaved, pulls };
}

// The one-line status under the picker: which saved roster the ship's people match, that they match none, or
// nothing for a ship with no people yet. Pure.
export function shipRosterStatusText(state: GameState, shipId: string): string | null {
  if (!shipHasPeople(state, shipId)) return null;
  const matchId = shipMatchingRosterId(state, shipId);
  const roster = state.personnelRosters.find((r) => r.id === matchId);
  if (roster === undefined) return "Current officers and notable crew are not saved in any roster.";
  return rosterMatch(state, shipId, roster) === "capped"
    ? `Current officers and notable crew match ${roster.name}, as far as this ship's caps allow.`
    : `Current officers and notable crew match ${roster.name}.`;
}

// The picker's default: the roster the ship's people match (a ship with people), else the first offered, else "".
// Pure.
export function defaultShipRosterId(state: GameState, shipId: string): string {
  const options = shipRosterOptions(state);
  const matchId = shipHasPeople(state, shipId) ? shipMatchingRosterId(state, shipId) : null;
  if (matchId !== null && options.some((o) => o.id === matchId)) return matchId;
  return options[0]?.id ?? "";
}

// === Where a linked loadout goes ===

// The truthful line when Apply would land the people but leave the roster's linked loadout in the Armory because it
// is pinned to another hull type (user 2026-11-09, "Say so in both"), or null. The engine's rule (armory.ts
// checkOutTransition, "type must match the pin", through personnelRosters.ts withLinkedLoadout): the loadout must
// be free and its shipTypeKey must be the ship's typeKey, and a refusal leaves the ship's own gear as it was. A
// loadout another ship wears never reaches that check and stays on that ship, not in the Armory, so it gets no such
// line. Null too when there is no Apply to speak of (a roster without people, or a refused apply). Display only. Pure.
export function shipRosterGearLine(state: GameState, shipId: string, rosterId: string): string | null {
  const roster = state.personnelRosters.find((r) => r.id === rosterId);
  const ship = state.ships.find((s) => s.id === shipId);
  if (roster === undefined || ship === undefined || !roster.includePeople) return null;
  if (!canApplyRoster(state, rosterId, shipId).ok) return null;
  const linked = state.loadouts.find((l) => l.id === roster.linkedLoadoutId);
  if (linked === undefined || linked.checkedOutToShipId !== null || linked.shipTypeKey === ship.typeKey) return null;
  const hull = SHIP_TYPES[linked.shipTypeKey].label;
  return `Gear stays in the Armory: this loadout is for ${/^[AEIOU]/.test(hull) ? "an" : "a"} ${hull}.`;
}

// === Why Apply is disabled ===

export interface ShipRosterBlock {
  text: string;
  // true when the reason is a crew lock (CP-6), so the bar shows the lock glyph beside the words.
  locked: boolean;
}

// The engine gate's refusal in words, or null when it is open: the one gate-to-text mapping behind this picker and the
// facility's Apply. `why` is the bare reason (the facility's button title), `text` the full line. Pure.
export function rosterApplyRefusal(
  state: GameState,
  rosterId: string,
  shipId: string,
): (ShipRosterBlock & { why: string }) | null {
  const gate = canApplyRoster(state, rosterId, shipId);
  if (gate.ok) return null;
  const why = rosterApplyGateText(state, gate) ?? "";
  const reason = "lockedShipId" in gate ? crewLockReason(state, gate.lockedShipId) : null;
  return reason !== null
    ? { why, text: `${why}: crew changes wait ${crewLockUntilText(reason)}.`, locked: true }
    : { why, text: `${why}.`, locked: false };
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
  const refusal = rosterApplyRefusal(state, rosterId, shipId);
  return refusal === null ? null : { text: refusal.text, locked: refusal.locked };
}

// The reason line the bar prints under its row, or null. The ship's own crew lock is already stated by the pane under
// the bar (the Senior Staff and Complement panes each carry their own lock line, which also covers their other
// controls), so the bar does not say it twice; Apply stays disabled with the reason as its title. Pure.
export function shipRosterBlockLine(state: GameState, shipId: string, rosterId: string): ShipRosterBlock | null {
  return crewLockReason(state, shipId) !== null ? null : shipRosterApplyBlock(state, shipId, rosterId);
}
