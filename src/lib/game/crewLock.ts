// CP-6 (0.14.0, docs/plans/2026-10-14-complement-and-acquisition-plan.md): THE ONE CREW LOCK.
//
// Source decision 11 (SUGGESTIONS 151): "Crew-allocation settings LOCK when a mission starts (can't change
// mid-mission)." Design 5.6: "A ship on any mission locks officer, complement and away-team changes (S1-62);
// the UI shows the lock and why." Every crew-changing action (away members, ground slots, member gear, the
// Armory, officers, rosters, captain retirement, the complement mode) asks shipCrewLocked below, so the rule
// can never drift between screens. Promotion, renaming and favoriting stay allowed: they change no allocation.
//
// WHY A LEAF MODULE: seniorStaff.ts, personnelRosters.ts and captainRetirement.ts need the lock, and
// awayTeam.ts (its first home) imports seniorStaff.ts, so asking awayTeam.ts from there would close an
// import cycle. This file imports only equipment.ts (onMissionLock) and model types; awayTeam.ts re-exports
// shipCrewLocked and crewLockReason so every existing importer keeps working.
//
// Pure: reads state, returns verdicts or new states, never mutates an input. No draws, no clock.

import type { GameState, ShipComplement } from "./model";
import { onMissionLock } from "./equipmentQueries";

// Whether a ship's crew is LOCKED right now (design section 5.6, S1-62). Two sources, both existing state:
//   - the captain is on a mission or patrol: equipment.ts onMissionLock, the SAME guard that locks gear
//     installs and ship salvage (one source of truth for "this hull is in flight");
//   - the ship is on an expedition: onMissionLock does not see those (an expedition lives in
//     state.expeditions, not on captain.mission), yet that is exactly when the away team is deployed and
//     its members are snapshotted, and claim later applies injuries to the live members. The test is the
//     same "one expedition per ship" check startExpedition uses; it holds until the run is CLAIMED, so a
//     run that is complete but unclaimed still locks.
// A ship that does not exist is not locked (there is nothing in flight to protect), so a person left
// pointing at a removed hull can still be fired or reassigned. Pure.
export function shipCrewLocked(state: GameState, shipId: string): boolean {
  const lock = onMissionLock(state, shipId);
  if (!lock.ok && lock.reason === "onMission") return true;
  return state.expeditions.some((e) => e.shipId === shipId);
}

// WHY a ship is crew-locked, for the player text. The captain's run comes first (it wins when both apply, since
// recall is the first step), named by its kind so the words are honest (S2, user 2026-10-17: a refusal names the
// real reason): "onMission" (an extraction mission), "onPatrol" or "onShortRange" (a Short-Range board run);
// otherwise "onExpedition" (in flight, or complete but unclaimed). null exactly when shipCrewLocked is false: it
// asks shipCrewLocked first, so the one predicate stays the source of truth and this only names the cause. Pure.
export type CrewLockReason = "onMission" | "onPatrol" | "onShortRange" | "onExpedition";

export function crewLockReason(state: GameState, shipId: string): CrewLockReason | null {
  if (!shipCrewLocked(state, shipId)) return null;
  const mission = onMissionLock(state, shipId);
  if (mission.ok || mission.reason !== "onMission") return "onExpedition";
  // onMissionLock found the ship's assigned captain flying a run, so both finds resolve.
  const ship = state.ships.find((s) => s.id === shipId)!;
  const kind = state.captains.find((c) => c.id === ship.assignedCaptainId)!.mission!.kind;
  switch (kind) {
    case "extraction":
      return "onMission";
    case "patrol":
      return "onPatrol";
    case "shortRange":
      return "onShortRange";
  }
}

// The player-facing words for a lock (US English). EXHAUSTIVE with no default, so a new lock cause is a
// compile error until it has text. Pure.
export function crewLockReasonText(reason: CrewLockReason): string {
  switch (reason) {
    case "onMission":
      return "Ship is out on a mission";
    case "onPatrol":
      return "Ship is out on a patrol";
    case "onShortRange":
      return "Ship is on a short-range run";
    case "onExpedition":
      return "Ship is on an expedition";
  }
}

// How long the lock lasts, to finish a lock line ("... locked until it returns"). EXHAUSTIVE. Pure.
export function crewLockUntilText(reason: CrewLockReason): string {
  switch (reason) {
    case "onMission":
    case "onPatrol":
    case "onShortRange":
      return "until it returns";
    case "onExpedition":
      return "until its expedition is claimed";
  }
}

// The accurate lock words for one ship, or null when it is not locked. Pure.
export function crewLockText(state: GameState, shipId: string): string | null {
  const reason = crewLockReason(state, shipId);
  return reason === null ? null : crewLockReasonText(reason);
}

// The lock words for the FIRST locked ship among the ones an action involves (a move's origin then its
// target, say), or null when none is locked. null / undefined entries (an unassigned person) are skipped.
// Pure.
export function crewLockTextAmong(state: GameState, shipIds: readonly (string | null | undefined)[]): string | null {
  for (const id of shipIds) {
    if (id === null || id === undefined) continue;
    const text = crewLockText(state, id);
    if (text !== null) return text;
  }
  return null;
}

// ============================================================================
// The complement mode toggle (Auto-crew on / off). It had no engine fn before CP-6 (App wrote the field
// inline); it lives here because the lock is its only rule beyond "the ship exists".
// ============================================================================

//   noShip:    the ship is no longer in the fleet
//   unchanged: the ship is already in that mode (the old silent no-op, now typed)
//   onMission: the ship is crew-locked (shipCrewLocked; crewLockText gives the accurate words)
export type ComplementModeBlockReason = "noShip" | "unchanged" | "onMission";
export type ComplementModeGate = { ok: true } | { ok: false; reason: ComplementModeBlockReason };

export function complementModeBlockText(reason: ComplementModeBlockReason): string {
  switch (reason) {
    case "noShip":
      return "That ship is no longer in the fleet";
    case "unchanged":
      return "Already set";
    case "onMission":
      return "Ship is out on a mission";
  }
}

// Can `shipId` switch its complement to `mode` ("passive" = auto-crew fills on the tick, "active" =
// player-curated)? Checked in order: noShip, onMission, unchanged. A fresh ship with no complement reads as
// passive. Pure.
export function canSetComplementMode(state: GameState, shipId: string, mode: ShipComplement["mode"]): ComplementModeGate {
  const ship = state.ships.find((s) => s.id === shipId);
  if (!ship) return { ok: false, reason: "noShip" };
  if (shipCrewLocked(state, shipId)) return { ok: false, reason: "onMission" };
  if ((ship.complement?.mode ?? "passive") === mode) return { ok: false, reason: "unchanged" };
  return { ok: true };
}

// Switch the ship's complement mode. Refuses (the SAME state) whenever canSetComplementMode does. A fresh
// ship with no complement yet gets an empty one so the mode is stored. Pure.
export function setComplementMode(state: GameState, shipId: string, mode: ShipComplement["mode"]): GameState {
  if (!canSetComplementMode(state, shipId, mode).ok) return state;
  return {
    ...state,
    ships: state.ships.map((s) =>
      s.id === shipId ? { ...s, complement: { ...(s.complement ?? { buckets: [], mode: "passive" as const }), mode } } : s,
    ),
  };
}

// ============================================================================
// S1 / S2 (docs/plans/2026-10-17-small-calls-answers.md, user 2026-10-17, both "Lock it (Recommended)"): the ship
// gear lock and the captain lock read the SAME crew lock as every crew change, so a ship that is out (a mission, a
// patrol, a short-range run, or an expedition until it is claimed) keeps its gear and its captain until it is home.
// ============================================================================

// The gear lock words for a refusal list ("Cannot install system: ..."), lower case like the other install reasons:
// "ship is on an expedition (gear locked until its expedition is claimed)". Pure.
export function shipGearLockReasonText(reason: CrewLockReason): string {
  const why = crewLockReasonText(reason);
  return `${why.charAt(0).toLowerCase()}${why.slice(1)} (gear locked ${crewLockUntilText(reason)})`;
}

// The gear lock as a sentence, for a disabled control's tooltip or a log line. Pure.
export function shipGearLockHint(reason: CrewLockReason): string {
  return `${crewLockReasonText(reason)}: its gear is locked ${crewLockUntilText(reason)}`;
}

// S1: whether captain `captainId` moving onto ship `shipId` (assignShipToCaptain) is crew-locked. Neither the
// captain's current ship (moving off it) nor the target (moving onto it) may be out. Returns the first locked ship
// and why, the current ship first, or null. The captain's own run is covered by the current ship's lock
// (onMissionLock reads it); a captain or ship that does not exist is the caller's refusal, not a lock. Pure.
export function captainMoveLock(
  state: GameState,
  captainId: number,
  shipId: string,
): { shipId: string; reason: CrewLockReason } | null {
  const current = state.ships.find((s) => s.assignedCaptainId === captainId);
  for (const id of [current?.id, shipId]) {
    if (id === undefined) continue;
    const reason = crewLockReason(state, id);
    if (reason !== null) return { shipId: id, reason };
  }
  return null;
}

// Whether captain `captainId`'s current ship is out, so the captain cannot leave it (false with no ship). Pure.
export function captainShipLocked(state: GameState, captainId: number): boolean {
  const current = state.ships.find((s) => s.assignedCaptainId === captainId);
  return current !== undefined && shipCrewLocked(state, current.id);
}

// The captain lock as a sentence: "Ship is on an expedition: captains stay aboard until its expedition is claimed".
// Pure.
export function captainMoveLockText(reason: CrewLockReason): string {
  return `${crewLockReasonText(reason)}: captains stay aboard ${crewLockUntilText(reason)}`;
}
