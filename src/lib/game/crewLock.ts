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
import { onMissionLock } from "./equipment";

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

// WHY a ship is crew-locked, for the player text: "onMission" (its captain is flying a mission or patrol;
// this wins when both apply, since recall is the first step) or "onExpedition" (in flight, or complete but
// unclaimed). null exactly when shipCrewLocked is false: it asks shipCrewLocked first, so the one predicate
// stays the source of truth and this only names the cause. Pure.
export type CrewLockReason = "onMission" | "onExpedition";

export function crewLockReason(state: GameState, shipId: string): CrewLockReason | null {
  if (!shipCrewLocked(state, shipId)) return null;
  const mission = onMissionLock(state, shipId);
  return !mission.ok && mission.reason === "onMission" ? "onMission" : "onExpedition";
}

// The player-facing words for a lock (US English). EXHAUSTIVE with no default, so a new lock cause is a
// compile error until it has text. Pure.
export function crewLockReasonText(reason: CrewLockReason): string {
  switch (reason) {
    case "onMission":
      return "Ship is out on a mission";
    case "onExpedition":
      return "Ship is on an expedition";
  }
}

// How long the lock lasts, to finish a lock line ("... locked until it returns"). EXHAUSTIVE. Pure.
export function crewLockUntilText(reason: CrewLockReason): string {
  switch (reason) {
    case "onMission":
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
