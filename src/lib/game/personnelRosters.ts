// Crew 0.14.0 (Phase C-2): the PERSONNEL ROSTERS engine (pure over GameState).
//
// A PersonnelRoster (model.ts) is a NAMED, priority-ordered set of PINNED people (officers by seat +
// notable crew by id) plus a fill policy, applied to a ship and CAPPED by that ship's real caps. It
// is the personnel counterpart to the Armory Loadout: a Loadout saves a ship's GEAR, a roster saves
// its PEOPLE. This module owns the roster CRUD, the pure per-field editors, and applyRoster (the one
// action that lands a roster's people on a ship). Every function is PURE over GameState, the same
// posture as armory.ts / salvage.ts / seniorStaff.ts: no clock, no rng, so the tick and the UI share
// one source of truth and offline==live is never at risk. A failed guard returns the SAME-REF state
// (or skips the offending entry safely).
//
// ⚠️ ADDITIVE-NEUTRAL: NONE of this runs on the tick; it runs ONLY on explicit user action. So with
// no roster applied, all existing behavior + the crew parity tests are byte-identical. Folding an
// ASSIGNED notable's stat contribution into crewOverlay.shipCrewContribution is a documented
// FOLLOW-ON (the same phased posture the officer/complement go-live used), NOT this phase.
//
// COMPLEMENT PRIORITY MODEL (user 2026-09-24): officers + notable crew are individual records with
// ids, so they pin by id in a reorderable PRIORITY order; the BULK complement is fungible histogram
// buckets, so it is NOT individually pinnable and simply AUTO-FILLS to cap honoring the pins.

import type {
  GameState,
  PersonnelRoster,
  NotableCrewMember,
  CrewSignature,
  CrewBucket,
  ShipComplement,
  SeniorStaffSeat,
} from "./model";
import { assignOfficerToShip, unassignOfficer, SENIOR_STAFF_SEATS } from "./seniorStaff";
import { autoCrewShip } from "./autoCrew";
import { quartersCapacityBonus } from "./crewModules";
import { remainingCapacityForSignature } from "./commandStructure";
import { addToBucketList, removeFromBucketList, coalesceBuckets } from "./crew";
// S4-CP39 (Ground Ops GO-17): applyRoster brings its linked Armory ship loadout. armory.ts never imports this
// module, so no cycle.
import {
  applyGroundTeamLoadout,
  checkInGroundTeamLoadout,
  checkInLoadout,
  checkOutLoadoutBeforePowerGate,
  groundTeamWornLoadout,
} from "./armory";
import { SHIP_TYPES, groundTeamCount, type ShipTypeKey } from "./model";
// CP-6: the one crew lock (a leaf module, no cycle).
import { crewLockReason, crewLockText, shipCrewLocked } from "./crewLock";
// E-MOD EM-2: the power install gate, judged on the fully applied roster.
import { installPowerShortfall, powerShortfall, shipPowerTotals } from "./shipPower";

// The pure-signature view of a notable, for cap math + occupancy bookkeeping. A notable occupies ONE
// complement slot of exactly this signature (its rank/division). Pure.
function notableSignature(n: NotableCrewMember): CrewSignature {
  return {
    profession: n.profession,
    rarity: n.rarity,
    rank: n.rank,
    race: n.race,
    buff1Id: n.buff1Id,
    buff2Id: n.buff2Id,
  };
}

// ============================================================================
// CRUD
// ============================================================================

// The editable fields of a roster (everything but its id). updateRoster overwrites the ones present.
export type RosterPatch = Partial<Pick<
  PersonnelRoster,
  "name" | "linkedLoadoutId" | "includePeople" | "seatAssignments" | "pinnedNotableCrew"
>>;

// Validate an optional loadout link: null (unlinked) is always fine; a non-null id must reference a
// real loadout. Pure read.
function loadoutLinkOk(state: GameState, linkedLoadoutId: string | null): boolean {
  if (linkedLoadoutId === null) return true;
  return state.loadouts.some((l) => l.id === linkedLoadoutId);
}

// Create a roster. Returns the new state + the new roster id, or a same-ref no-op + null id when the
// (optional) loadout link is a non-null id that does not exist. A blank name falls back to the default
// (a roster is never nameless), mirroring createLoadout. The id is minted from nextRosterId as
// "roster-N" (mirrors nextLoadoutId). Pure.
export function createRoster(
  state: GameState,
  opts: { name?: string; linkedLoadoutId?: string | null; includePeople?: boolean } = {},
): { next: GameState; rosterId: string | null } {
  const linkedLoadoutId = opts.linkedLoadoutId ?? null;
  if (!loadoutLinkOk(state, linkedLoadoutId)) return { next: state, rosterId: null };
  const id = `roster-${state.nextRosterId}`;
  const roster: PersonnelRoster = {
    id,
    name: (opts.name ?? "").trim() || "New Roster",
    linkedLoadoutId,
    includePeople: opts.includePeople ?? true,
    seatAssignments: {},
    pinnedNotableCrew: [],
  };
  return {
    next: { ...state, personnelRosters: [...state.personnelRosters, roster], nextRosterId: state.nextRosterId + 1 },
    rosterId: id,
  };
}

// Overwrite a roster's fields from a patch (the Save/Update path: the builder writes back the whole
// config). Same-ref no-op if the roster is missing, or if the patch sets a non-null loadout link that
// does not exist. Only the fields PRESENT in the patch are overwritten. Pure.
export function updateRoster(state: GameState, rosterId: string, patch: RosterPatch): GameState {
  const roster = state.personnelRosters.find((r) => r.id === rosterId);
  if (roster === undefined) return state;
  if (patch.linkedLoadoutId !== undefined && !loadoutLinkOk(state, patch.linkedLoadoutId)) return state;
  const name = patch.name !== undefined ? (patch.name.trim() || roster.name) : roster.name;
  const updated: PersonnelRoster = {
    ...roster,
    name,
    linkedLoadoutId: patch.linkedLoadoutId !== undefined ? patch.linkedLoadoutId : roster.linkedLoadoutId,
    includePeople: patch.includePeople !== undefined ? patch.includePeople : roster.includePeople,
    seatAssignments: patch.seatAssignments !== undefined ? { ...patch.seatAssignments } : roster.seatAssignments,
    pinnedNotableCrew: patch.pinnedNotableCrew !== undefined ? [...patch.pinnedNotableCrew] : roster.pinnedNotableCrew,
  };
  return { ...state, personnelRosters: state.personnelRosters.map((r) => (r.id === rosterId ? updated : r)) };
}

// Delete a roster by id. Same-ref no-op if it is missing. Rosters own no committed gear (the linked
// loadout is a reference, not ownership), so deleting one frees nothing else. Pure.
export function deleteRoster(state: GameState, rosterId: string): GameState {
  if (!state.personnelRosters.some((r) => r.id === rosterId)) return state;
  return { ...state, personnelRosters: state.personnelRosters.filter((r) => r.id !== rosterId) };
}

// ============================================================================
// Pure per-field editors (operate by id, return a new state; validate ids exist)
// ============================================================================

// Replace one roster with the result of `edit`, returning a new state. Same-ref no-op if the roster
// is missing OR `edit` returns the same object (an editor signals "no change" by returning its input).
function withRoster(
  state: GameState,
  rosterId: string,
  edit: (r: PersonnelRoster) => PersonnelRoster,
): GameState {
  const roster = state.personnelRosters.find((r) => r.id === rosterId);
  if (roster === undefined) return state;
  const next = edit(roster);
  if (next === roster) return state;
  return { ...state, personnelRosters: state.personnelRosters.map((r) => (r.id === rosterId ? next : r)) };
}

// Rename a roster. Ignores an all-whitespace name and is a same-ref no-op if missing or unchanged
// (mirrors renameLoadout). Pure.
export function renameRoster(state: GameState, rosterId: string, name: string): GameState {
  const trimmed = name.trim();
  if (!trimmed) return state;
  return withRoster(state, rosterId, (r) => (r.name === trimmed ? r : { ...r, name: trimmed }));
}

// Set (or clear, with null) a roster's Armory-loadout link. Same-ref no-op if the roster is missing,
// the link is a non-null id that does not exist, or the value is unchanged. Pure.
export function setLinkedLoadout(state: GameState, rosterId: string, linkedLoadoutId: string | null): GameState {
  if (!loadoutLinkOk(state, linkedLoadoutId)) return state;
  return withRoster(state, rosterId, (r) =>
    r.linkedLoadoutId === linkedLoadoutId ? r : { ...r, linkedLoadoutId },
  );
}

// How many ground teams a roster can link a squad loadout for: the most teams any hull fields (a roster is
// not tied to one hull; a link past the target ship's teams is simply skipped on apply). Pure.
export function rosterSquadLinkSlots(): number {
  return Math.max(0, ...(Object.keys(SHIP_TYPES) as ShipTypeKey[]).map(groundTeamCount));
}

// GO-17 UI (user S14: "rosters link squad loadouts one per team"): set (or clear, with null) the Armory GROUND
// TEAM loadout linked to team `teamIndex` (0 = Alpha). A loadout links to ONE team: setting it here clears it
// from any other team of this roster. Trailing empty links are trimmed and an all-empty list is removed, so an
// unlinked roster keeps the absent field. Same-ref no-op on a missing roster, a bad team index, a non-null id
// that names no ground team loadout, or no change. Pure.
export function setLinkedSquadLoadout(
  state: GameState,
  rosterId: string,
  teamIndex: number,
  loadoutId: string | null,
): GameState {
  if (!Number.isInteger(teamIndex) || teamIndex < 0 || teamIndex >= rosterSquadLinkSlots()) return state;
  if (loadoutId !== null && !(state.squadLoadouts ?? []).some((l) => l.id === loadoutId)) return state;
  return withRoster(state, rosterId, (r) => {
    const current = r.linkedSquadLoadoutIds ?? [];
    if ((current[teamIndex] ?? null) === loadoutId) return r;
    const links = Array.from({ length: Math.max(current.length, teamIndex + 1) }, (_, i) =>
      current[i] === loadoutId ? null : current[i] ?? null,
    );
    links[teamIndex] = loadoutId;
    while (links.length > 0 && links[links.length - 1] === null) links.pop();
    const { linkedSquadLoadoutIds: _old, ...rest } = r;
    return links.length === 0 ? rest : { ...rest, linkedSquadLoadoutIds: links };
  });
}

// Toggle whether the roster carries people (Senior Staff + Complement). Same-ref no-op if missing or
// unchanged. Pure.
export function setIncludePeople(state: GameState, rosterId: string, includePeople: boolean): GameState {
  return withRoster(state, rosterId, (r) => (r.includePeople === includePeople ? r : { ...r, includePeople }));
}

// Pin (or clear, with null) the officer for a seat. A non-null officerId must reference a real officer
// whose OWN seat type matches `seat` (seats are typed; an officer can only fill its matching seat).
// Same-ref no-op on a missing roster, a bad/mismatched officer, or no change. Pure.
export function assignSeat(
  state: GameState,
  rosterId: string,
  seat: SeniorStaffSeat,
  officerId: string | null,
): GameState {
  if (officerId !== null) {
    const officer = state.officers.find((o) => o.id === officerId);
    if (!officer || officer.seat !== seat) return state;
  }
  return withRoster(state, rosterId, (r) => {
    const current = r.seatAssignments[seat] ?? null;
    if (current === officerId) return r;
    const seatAssignments = { ...r.seatAssignments };
    if (officerId === null) delete seatAssignments[seat];
    else seatAssignments[seat] = officerId;
    return { ...r, seatAssignments };
  });
}

// Pin a notable to the roster (appended at the LOWEST priority). Validates the notable exists; a
// same-ref no-op if the roster is missing, the notable is unknown, or it is already pinned. Pure.
export function pinNotable(state: GameState, rosterId: string, notableId: string): GameState {
  if (!state.notableCrew.some((n) => n.id === notableId)) return state;
  return withRoster(state, rosterId, (r) =>
    r.pinnedNotableCrew.includes(notableId) ? r : { ...r, pinnedNotableCrew: [...r.pinnedNotableCrew, notableId] },
  );
}

// Unpin a notable from the roster. Same-ref no-op if the roster is missing or the notable is not
// pinned. Pure.
export function unpinNotable(state: GameState, rosterId: string, notableId: string): GameState {
  return withRoster(state, rosterId, (r) =>
    r.pinnedNotableCrew.includes(notableId)
      ? { ...r, pinnedNotableCrew: r.pinnedNotableCrew.filter((id) => id !== notableId) }
      : r,
  );
}

// Move a pinned notable from `fromIndex` to `toIndex` in the priority order. Same-ref no-op if the
// roster is missing, either index is out of range, or the move is a no-op. Pure.
export function reorderNotable(state: GameState, rosterId: string, fromIndex: number, toIndex: number): GameState {
  return withRoster(state, rosterId, (r) => {
    const n = r.pinnedNotableCrew.length;
    if (fromIndex < 0 || fromIndex >= n || toIndex < 0 || toIndex >= n || fromIndex === toIndex) return r;
    const next = [...r.pinnedNotableCrew];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    return { ...r, pinnedNotableCrew: next };
  });
}

// Convenience: raise a pinned notable one step (toward the front / higher priority). Same-ref no-op at
// the top or on a bad id. Pure.
export function moveNotableUp(state: GameState, rosterId: string, notableId: string): GameState {
  const roster = state.personnelRosters.find((r) => r.id === rosterId);
  if (roster === undefined) return state;
  const i = roster.pinnedNotableCrew.indexOf(notableId);
  if (i <= 0) return state;
  return reorderNotable(state, rosterId, i, i - 1);
}

// Convenience: lower a pinned notable one step (toward the back / lower priority). Same-ref no-op at
// the bottom or on a bad id. Pure.
export function moveNotableDown(state: GameState, rosterId: string, notableId: string): GameState {
  const roster = state.personnelRosters.find((r) => r.id === rosterId);
  if (roster === undefined) return state;
  const i = roster.pinnedNotableCrew.indexOf(notableId);
  if (i < 0 || i >= roster.pinnedNotableCrew.length - 1) return state;
  return reorderNotable(state, rosterId, i, i + 1);
}

// Flip a notable crew member's optional `favorite` curation flag (an absent value reads as false, so
// the first toggle sets it true). SAME-REF NO-OP when the id is unknown, so a caller can skip the
// save/log on state === next. Operates on the notable RECORD (state.notableCrew), the officer-favorite
// counterpart to seniorStaff.ts's toggleOfficerFavorite; it does NOT touch any roster's pins. Pure
// UI/curation flag (nothing mechanical reads it). Returns a NEW state; the input is never mutated.
export function toggleNotableFavorite(state: GameState, notableId: string): GameState {
  if (!state.notableCrew.some((n) => n.id === notableId)) return state; // unknown: same-ref no-op
  return {
    ...state,
    notableCrew: state.notableCrew.map((n) => (n.id === notableId ? { ...n, favorite: !n.favorite } : n)),
  };
}

// ============================================================================
// applyRoster: land a roster's people on a ship (the one side-effectful action)
// ============================================================================

// CP-6: applyRoster refuses WHOLE (the SAME state, never a partial landing) while a ship it would touch is
// crew-locked (crewLock.ts shipCrewLocked: a captain mission, or an expedition until it is claimed):
//   noRoster:               the roster no longer exists
//   noShip:                 the target ship no longer exists
//   onMission:              the TARGET ship is locked (this refuses a gear-only roster too: a linked
//                           loadout swap is a crew-side change of the ship that is out)
//   pinnedAboardLockedShip: a pinned officer or notable (a roster carrying people) sits on ANOTHER ship that
//                           is locked, so landing it here would pull it off a run
// lockedShipId names the locked ship for the text. A pin that is missing or mismatched (applyRoster skips
// those safely) never refuses. Pure.
export type RosterApplyBlockReason = "noRoster" | "noShip" | "onMission" | "pinnedAboardLockedShip";
export type RosterApplyGate =
  | { ok: true }
  | { ok: false; reason: "noRoster" | "noShip" }
  | { ok: false; reason: "onMission" | "pinnedAboardLockedShip"; lockedShipId: string };

export function rosterApplyBlockText(reason: RosterApplyBlockReason): string {
  switch (reason) {
    case "noRoster":
      return "That roster no longer exists";
    case "noShip":
      return "That ship is no longer in the fleet";
    case "onMission":
      return "Ship is out on a mission";
    case "pinnedAboardLockedShip":
      return "A pinned officer or crew member is aboard a ship that is out";
  }
}

// The player text for a gate, naming the real lock (mission vs expedition); undefined when it is open. Pure.
export function rosterApplyGateText(state: GameState, gate: RosterApplyGate): string | undefined {
  if (gate.ok) return undefined;
  switch (gate.reason) {
    case "noRoster":
    case "noShip":
      return rosterApplyBlockText(gate.reason);
    case "onMission":
      return crewLockText(state, gate.lockedShipId) ?? rosterApplyBlockText(gate.reason);
    case "pinnedAboardLockedShip": {
      const why = crewLockReason(state, gate.lockedShipId);
      switch (why) {
        case "onMission":
          return "A pinned officer or crew member is aboard a ship out on a mission";
        case "onPatrol":
          return "A pinned officer or crew member is aboard a ship out on a patrol";
        case "onShortRange":
          return "A pinned officer or crew member is aboard a ship on a short-range run";
        case "onExpedition":
          return "A pinned officer or crew member is aboard a ship on an expedition";
        case null:
          return rosterApplyBlockText(gate.reason);
      }
    }
  }
}

export function canApplyRoster(state: GameState, rosterId: string, shipId: string): RosterApplyGate {
  const roster = state.personnelRosters.find((r) => r.id === rosterId);
  if (roster === undefined) return { ok: false, reason: "noRoster" };
  if (!state.ships.some((s) => s.id === shipId)) return { ok: false, reason: "noShip" };
  if (shipCrewLocked(state, shipId)) return { ok: false, reason: "onMission", lockedShipId: shipId };
  if (!roster.includePeople) return { ok: true };
  const lockedElsewhere = (from: string | null | undefined): from is string =>
    from !== null && from !== undefined && from !== shipId && shipCrewLocked(state, from);
  for (const seat of SENIOR_STAFF_SEATS) {
    const officerId = roster.seatAssignments[seat];
    if (officerId === undefined) continue;
    const officer = state.officers.find((o) => o.id === officerId);
    if (!officer || officer.seat !== seat) continue; // applyRoster skips it safely
    if (lockedElsewhere(officer.assignedShipId)) {
      return { ok: false, reason: "pinnedAboardLockedShip", lockedShipId: officer.assignedShipId };
    }
  }
  for (const notableId of roster.pinnedNotableCrew) {
    const from = state.notableCrew.find((n) => n.id === notableId)?.assignedShipId;
    if (lockedElsewhere(from)) return { ok: false, reason: "pinnedAboardLockedShip", lockedShipId: from };
  }
  return { ok: true };
}

// Apply a roster's PEOPLE to a ship. Returns a NEW GameState; the roster object itself is UNCHANGED
// (the auto-filled randoms are never written back to it). Steps, in order:
//   (a) OFFICERS: for each pinned seat, evict any DIFFERENT officer currently in that seat on the ship,
//       then assign the roster's officer to it (reassigning it from wherever it was bound). Seats the
//       roster does not pin are left alone (a partial bridge stays partial; officers are hand-curated,
//       never auto-completed).
//   (b) NOTABLES: assign the pinned notables to the ship in PRIORITY order, CAP-AWARE. A notable
//       occupies one complement slot of its rank/division; a pin that would breach the ship's
//       per-rank / division / total caps (commandStructure + the quarters-module capacity bonus) is
//       SKIPPED safely, and the walk continues (a lower-priority pin can still fit a different bucket).
//   (c) BULK: auto-fill the REMAINING berths from the crew pool via autoCrewShip. The remaining
//       capacity SUBTRACTS the slots the assigned notables took (they are seeded into the occupancy
//       autoCrewShip reads), so notables + bulk never exceed cap. The randoms are NOT persisted to the
//       roster.
//
// includePeople=false => the roster carries no people, so applyRoster applies none (it still brings a
// linked loadout; with no link it is a same-ref no-op). Missing roster/ship => same-ref no-op. A missing
// officer/notable id is skipped safely. CP-6: refused whole while a ship involved is crew-locked
// (canApplyRoster above).
//
// ⚠️ LINKED LOADOUT (S4-CP39, carried from E-CREW Task 18 into Ground Ops GO-17): when linkedLoadoutId is
// set, that Armory ship loadout is checked out to the ship FIRST (withLinkedLoadout below), so the people
// are capped against the new gear. CAPS still come from the TARGET SHIP's real caps
// (commandStructureForHull(ship.typeKey) + quartersCapacityBonus), which then reflect that gear.
//
// The overlay: an assigned notable feeds ship stats like one crew of its signature (GL-1 folds it in
// crewOverlay.ts rawShipCrewContribution), and the tick's auto-crew (resolveCrew) seeds the same
// notable occupancy as step (c), so a passive ship never fills past its caps around its notables (CP-8).
//
// E-MOD EM-2 (power install gate): the linked loadout is judged on the FULLY applied roster, its officers and crew
// included (their power efficiency counts), against the same roster applied without the loadout. When the gate refuses,
// the roster is applied again WITHOUT the loadout: the people still land, the gear stays in the Armory
// (rosterLoadoutPowerShortfall names the power it needs).
export function applyRoster(state: GameState, rosterId: string, shipId: string): GameState {
  if (!canApplyRoster(state, rosterId, shipId).ok) return state; // CP-6: refuse whole (same ref)
  const full = applyRosterSteps(state, rosterId, shipId, true);
  return rosterLoadoutRefused(state, rosterId, shipId, full) > 0 ? applyRosterSteps(state, rosterId, shipId, false) : full;
}

// The power the linked loadout still needs on the fully applied roster (0 = it lands, or there is nothing to judge:
// no link, or the loadout did not check out for another reason). Pure.
function rosterLoadoutRefused(state: GameState, rosterId: string, shipId: string, full: GameState): number {
  const linkedId = state.personnelRosters.find((r) => r.id === rosterId)?.linkedLoadoutId ?? null;
  if (linkedId === null) return 0;
  const landed = full.loadouts.find((l) => l.id === linkedId)?.checkedOutToShipId === shipId;
  const wasOn = state.loadouts.find((l) => l.id === linkedId)?.checkedOutToShipId === shipId;
  if (!landed || wasOn) return 0;
  const after = shipPowerTotals(full, shipId);
  if (powerShortfall(after) === 0) return 0; // in budget: the roster without the loadout is never built
  return installPowerShortfall(shipPowerTotals(applyRosterSteps(state, rosterId, shipId, false), shipId), after);
}

// E-MOD EM-2: the power the roster's linked loadout needs on this ship, judged exactly as applyRoster judges it (the
// fully applied roster against the roster without the loadout). 0 = it lands, or nothing applies. Pure.
export function rosterLoadoutPowerShortfall(state: GameState, rosterId: string, shipId: string): number {
  if (!canApplyRoster(state, rosterId, shipId).ok) return 0;
  return rosterLoadoutRefused(state, rosterId, shipId, applyRosterSteps(state, rosterId, shipId, true));
}

// The roster's steps (a) to (c) below, with or without the linked ship loadout. The caller has run canApplyRoster.
function applyRosterSteps(state: GameState, rosterId: string, shipId: string, withLoadout: boolean): GameState {
  const roster = state.personnelRosters.find((r) => r.id === rosterId);
  if (roster === undefined) return state;
  const ship = state.ships.find((s) => s.id === shipId);
  if (ship === undefined) return state;

  // S4-CP39: the linked loadout's GEAR lands first, so the people below are capped against the new gear.
  let next = withLoadout ? withLinkedLoadout(state, roster, shipId) : state;
  // GO-17 UI: then each team's linked squad loadout (gear only, so it never touches the caps below).
  next = withLinkedSquadLoadouts(next, roster, shipId);
  if (!roster.includePeople) return next; // no people to apply (a gear-only roster still brings its loadout)

  // (a) OFFICERS -> their matching seats on the ship (deterministic seat order).
  for (const seat of SENIOR_STAFF_SEATS) {
    const officerId = roster.seatAssignments[seat];
    if (officerId === undefined) continue; // seat not pinned by this roster
    const officer = next.officers.find((o) => o.id === officerId);
    if (!officer || officer.seat !== seat) continue; // missing / mismatched: skip safely
    // Evict any OTHER officer currently sitting this seat on the ship, so the roster's pick lands
    // (assignOfficerToShip refuses a seat occupied by a different officer).
    const occupant = next.officers.find(
      (o) => o.id !== officerId && o.assignedShipId === shipId && o.seat === seat,
    );
    if (occupant) next = unassignOfficer(next, occupant.id);
    next = assignOfficerToShip(next, officerId, shipId);
  }

  // Cap inputs from the TARGET SHIP's real caps.
  const hullType = ship.typeKey;
  const bonusCapacity = quartersCapacityBonus(next, ship);
  const mode = ship.complement?.mode ?? "passive";
  const existingBulk = (ship.complement?.buckets ?? []).map((b) => ({ ...b }));

  // (b) NOTABLES -> the ship, in priority order, cap-aware. The occupancy that gates each pin is the
  // ship's existing bulk PLUS the notables already assigned to this ship that are NOT roster pins
  // (they hold their slots too), PLUS the pins accepted so far.
  const pinnedIds = new Set(roster.pinnedNotableCrew);
  let occupancy: CrewBucket[] = coalesceBuckets([
    ...existingBulk,
    ...next.notableCrew
      .filter((n) => (n.assignedShipId ?? null) === shipId && !pinnedIds.has(n.id))
      .map((n) => ({ ...notableSignature(n), count: 1 })),
  ]);

  const acceptedPinIds = new Set<string>();
  for (const notableId of roster.pinnedNotableCrew) {
    const notable = next.notableCrew.find((n) => n.id === notableId);
    if (!notable) continue; // missing: skip safely
    const sig = notableSignature(notable);
    const complement: ShipComplement = { buckets: occupancy, mode };
    if (remainingCapacityForSignature(complement, hullType, sig, bonusCapacity) >= 1) {
      acceptedPinIds.add(notableId);
      occupancy = addToBucketList(occupancy, sig, 1);
    }
    // else: no room for this rank/division right now; skip and keep walking.
  }
  if (acceptedPinIds.size > 0) {
    next = {
      ...next,
      notableCrew: next.notableCrew.map((n) =>
        acceptedPinIds.has(n.id) ? { ...n, assignedShipId: shipId } : n,
      ),
    };
  }

  // (c) BULK auto-fill. Seed autoCrewShip's occupancy with the ship's existing bulk + EVERY notable
  // now assigned to the ship, so the remaining capacity it fills already subtracts the notables' slots
  // (notables + bulk never exceed cap). Then strip the notable slots back out so ship.complement holds
  // ONLY the fungible bulk (notables persist as their own records via assignedShipId).
  const shipNotables = next.notableCrew.filter((n) => (n.assignedShipId ?? null) === shipId);
  const seededBuckets = coalesceBuckets([
    ...existingBulk,
    ...shipNotables.map((n) => ({ ...notableSignature(n), count: 1 })),
  ]);
  const filled = autoCrewShip(next.crewPool, hullType, { buckets: seededBuckets, mode }, bonusCapacity);
  let bulkBuckets = filled.complement.buckets;
  for (const n of shipNotables) {
    bulkBuckets = removeFromBucketList(bulkBuckets, notableSignature(n), 1);
  }

  return {
    ...next,
    crewPool: filled.pool,
    ships: next.ships.map((s) => (s.id === shipId ? { ...s, complement: { buckets: bulkBuckets, mode } } : s)),
  };
}

// S4-CP39: check the roster's linked Armory SHIP loadout out to the ship, swapping out a DIFFERENT loadout
// the ship wears (checked back in to the Armory first). NEVER forced, and ATOMIC: the SAME state comes back
// when there is no link, the loadout is gone, the ship already wears it, ANOTHER ship wears it (it is never
// pulled off that ship [PROPOSAL]), or the check-out refuses (the loadout is pinned to another hull type, or
// the ship is on a mission), so a refused swap never leaves the ship stripped. Pure.
function withLinkedLoadout(state: GameState, roster: PersonnelRoster, shipId: string): GameState {
  const linkedId = roster.linkedLoadoutId;
  if (linkedId === null) return state;
  const linked = state.loadouts.find((l) => l.id === linkedId);
  if (linked === undefined || linked.checkedOutToShipId !== null) return state;
  const current = state.loadouts.find((l) => l.checkedOutToShipId === shipId);
  let next = state;
  if (current !== undefined) {
    next = checkInLoadout(next, current.id);
    if (next === state) return state; // the current one could not come off (on a mission)
  }
  // EM-2: the power gate is judged by applyRoster on the fully applied roster, not here.
  const out = checkOutLoadoutBeforePowerGate(next, linkedId, shipId);
  return out === next ? state : out;
}

// GO-17 UI: put each team's linked GROUND TEAM loadout on that team of the ship, in team order, the ship
// loadout rule above per team: a team wearing a DIFFERENT loadout checks it in first; a linked loadout that is
// gone or already worn (by this team or any other) is left alone, never pulled off; and a refused put (another
// team type, no such team on this hull, the ship crew-locked) leaves that team exactly as it was, its own
// loadout still on. Pieces that cannot install are skipped by applyGroundTeamLoadout itself (never forced).
// Same state when nothing changes. Pure.
function withLinkedSquadLoadouts(state: GameState, roster: PersonnelRoster, shipId: string): GameState {
  const links = roster.linkedSquadLoadoutIds ?? [];
  let next = state;
  links.forEach((loadoutId, teamIndex) => {
    if (loadoutId === null || loadoutId === undefined) return;
    const linked = (next.squadLoadouts ?? []).find((l) => l.id === loadoutId);
    if (linked === undefined || linked.checkedOutTo !== null) return;
    let trial = next;
    const worn = groundTeamWornLoadout(trial, shipId, teamIndex);
    if (worn !== null) {
      const back = checkInGroundTeamLoadout(trial, worn.id);
      if (!back.ok) return;
      trial = back.next;
    }
    const put = applyGroundTeamLoadout(trial, loadoutId, shipId, teamIndex);
    if (put.ok) next = put.next;
  });
  return next;
}
