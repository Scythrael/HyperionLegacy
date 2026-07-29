// ============================================================================
// combat/combatView.ts: PURE view-model helpers for the combat view
// (Combat 0.13.0, Phase 12b Unit C, the "watch live" arena UI)
//
// WHAT THIS IS. CombatView.svelte renders the approved combat-view mockup from a
// DISPLAY-ONLY patrol replay (patrolReplay.ts). Every non-trivial decision the
// component makes about WHICH data to show is factored OUT into the small, pure,
// individually unit-tested functions below (combatView.test.ts), so the Svelte
// file is left with only wiring + markup and the logic is testable without a DOM.
//
// PURITY. Nothing here reads or mutates GameState, draws an RNG, or touches the
// combat stream. Each function is a pure map from its arguments to a value: same
// inputs always give the same output. That keeps the combat view display-only
// (design S17 / patrolReplay.ts's HARD CONTRACT) all the way down to the pixels.
// ============================================================================

import type { CombatEvent, Combatant } from "./types";
import { BAND_LONG } from "./positioning";
import type { SquadronStatusSummary } from "./drones";
// Type-only import (no runtime dependency, so no import cycle): the mobile roster
// helpers below read a folded RoundSnapshot to find each enemy's CURRENT hull.
import type { RoundSnapshot } from "./patrolReplay";

// ---------------------------------------------------------------------------
// currentReplayWaveIndex: which wave the view should show for a live patrol.
//
// The live tick loop resolves each wave INSTANTLY at its route tick (there is no
// real mid-wave moment), so "the current wave" is really "the wave the patrol is
// on right now": the most-recently-resolved wave once any has resolved, or the
// FIRST (upcoming) wave before any has. This matches the unit spec: "show the
// patrol's CURRENT wave; if between waves or finished, show the most recently
// resolved wave".
//
// INPUTS:
//   nextWaveIndex: the mission's pointer to the NEXT unfought wave (0 at
//                    dispatch, advancing to waveTicks.length when all are done).
//   waveCount:     how many waves the replay actually produced (replay.waves
//                    .length; a defeat stops the replay early, so this can be
//                    shorter than the schedule).
// RETURNS the 0-based index into replay.waves to display, or null when there is
// no wave to show (an empty replay).
// ---------------------------------------------------------------------------
export function currentReplayWaveIndex(
  nextWaveIndex: number,
  waveCount: number,
): number | null {
  if (waveCount <= 0) return null;
  // Nothing resolved yet: show the first (upcoming) wave.
  if (nextWaveIndex <= 0) return 0;
  // Otherwise the most-recently-resolved wave, clamped into the replay's range
  // (the clamp guards a mission that reports more resolved waves than the replay
  // produced, e.g. a defeat that ended the replay one wave early).
  const idx = nextWaveIndex - 1;
  if (idx >= waveCount) return waveCount - 1;
  return idx;
}

// ---------------------------------------------------------------------------
// buildNameFor: the id -> display-name lookup the flavor render step needs.
//
// interpolateFlavor(template, event, nameFor) binds {actor}/{target} via this
// callback. The player combatant renders as the captain/ship name; each enemy
// renders as its hull label (aligned to the enemy ids by index). An unknown id
// falls back to itself so a missing name never renders "undefined".
// ---------------------------------------------------------------------------
export function buildNameFor(
  playerId: string,
  playerName: string,
  enemyIds: readonly string[],
  enemyLabels: readonly string[],
): (id: string) => string {
  // Pre-index the enemy ids -> labels once so the returned closure is O(1).
  const enemyName = new Map<string, string>();
  for (let i = 0; i < enemyIds.length; i++) {
    // Guard a labels array shorter than the ids array (never in normal play, but
    // keeps the closure total): fall back to the id when a label is missing.
    enemyName.set(enemyIds[i], enemyLabels[i] ?? enemyIds[i]);
  }
  return (id: string): string => {
    if (id === playerId) return playerName;
    return enemyName.get(id) ?? id;
  };
}

// ---------------------------------------------------------------------------
// rangeMarkerPercent: where the range-track marker sits for a given distance.
//
// The track spans Short .. Medium .. Long. The marker's LEFT offset is the
// distance as a percentage of the long-band ceiling (BAND_LONG, the single
// source of truth for the thresholds in positioning.ts), clamped to 0..100 so a
// distance beyond long range simply parks at the far end. Integer output so the
// style string stays clean.
// ---------------------------------------------------------------------------
export function rangeMarkerPercent(distance: number): number {
  if (distance <= 0) return 0;
  const pct = Math.round((distance / BAND_LONG) * 100);
  if (pct < 0) return 0;
  if (pct > 100) return 100;
  return pct;
}

// ---------------------------------------------------------------------------
// logLineClass: the mockup's per-event log-line style class.
//
// Maps one combat event to the single style class the mockup log CSS uses
// (crit / dot / destroy / evade / atten), or "" for a plain line. The order IS
// the priority: a kill line wins over everything, then a crit, then a DoT tick,
// then a particle attenuation bleed, then a clean miss. Everything else is plain.
// Pure switch over the event's own flags, no lookup.
// ---------------------------------------------------------------------------
export function logLineClass(event: CombatEvent): string {
  if (event.type === "destroyed") return "destroy";
  if (event.crit) return "crit";
  if (event.type === "dot") return "dot";
  if (event.attenuated) return "atten";
  if (event.type === "evade") return "evade";
  return "";
}

// One drone-squadron pip for the arena (the mockup's carrier squadron row).
export interface DronePip {
  // The pip's style class, matching the mockup's drone-pip CSS.
  cls: "online" | "disrupted" | "refab" | "offline";
  // The hover tooltip text.
  title: string;
}

// ---------------------------------------------------------------------------
// dronePips: expand a squadron status summary into one pip per drone.
//
// The per-round fold does NOT carry absolute drone pip counts (patrolReplay.ts
// header), so the view reads a squadron's status straight off a wave combatant
// via squadronStatusSummary and renders it here: one Online / Disrupted /
// Refabricating pip per live drone in that state, plus one Destroyed (offline)
// pip per lost drone (total minus alive). Kept pure over the summary so it is
// trivially testable without a DroneSquadron literal.
// ---------------------------------------------------------------------------
export function dronePips(summary: SquadronStatusSummary): DronePip[] {
  const pips: DronePip[] = [];
  for (let i = 0; i < summary.online; i++) {
    pips.push({ cls: "online", title: "Online" });
  }
  for (let i = 0; i < summary.disrupted; i++) {
    pips.push({ cls: "disrupted", title: "Disrupted" });
  }
  for (let i = 0; i < summary.refabricating; i++) {
    pips.push({ cls: "refab", title: "Refabricating" });
  }
  // Destroyed drones = the remainder after the three shown states. NOT `total - alive`:
  // a REFABRICATING drone has alive=false (drones.ts), so `total - alive` counts it as
  // destroyed even though it already got a refab pip above, double-counting it. Subtract
  // each rendered state explicitly so a refabricating drone is a refab pip and nothing else.
  const destroyed = Math.max(
    0,
    summary.total - summary.online - summary.disrupted - summary.refabricating,
  );
  for (let i = 0; i < destroyed; i++) {
    pips.push({ cls: "offline", title: "Destroyed" });
  }
  return pips;
}

// ---------------------------------------------------------------------------
// logSpeedToMs: the combat-view log-stream cadence, in milliseconds.
//
// The mobile control row exposes a Speed toggle (1s / 5s) alongside the mode
// toggle. This is the ONE place the two speeds map to their reveal-interval
// delays, so the component never hard-codes a magic millisecond literal and the
// mapping is unit-tested. "fast" is the default (design S16: "streams ~1 round/
// second live"); "slow" is the relaxed 5-second cadence for reading the log.
// ---------------------------------------------------------------------------
export type LogSpeed = "fast" | "slow";
export function logSpeedToMs(speed: LogSpeed): number {
  return speed === "slow" ? 5000 : 1000;
}

// ---------------------------------------------------------------------------
// targetEnemyId: which living enemy the sim is focus-firing this round.
//
// The battle sim focus-fires the enemy with the LOWEST current hull, so the
// mobile roster marks that ship as the TARGET. This is a pure read of the wave's
// enemy combatants against the current folded snapshot: each enemy's CURRENT hull
// is its snapshot hull (falling back to its wave-start hull before the first
// snapshot exists, or when a snapshot never carried a hull for it). A destroyed
// enemy (hull <= 0) can never be the target. Ties break to the FIRST enemy in
// wave order (stable), matching the deterministic sim's own turn-order tiebreak.
//
// RETURNS the target enemy's id, or null when every enemy is destroyed (or the
// wave has no enemies).
// ---------------------------------------------------------------------------
export function targetEnemyId(
  enemies: readonly Combatant[],
  snap: RoundSnapshot | null,
): string | null {
  let bestId: string | null = null;
  let bestHull = Number.POSITIVE_INFINITY;
  for (const enemy of enemies) {
    // Nullish (null snapshot value OR no snapshot yet) falls back to the wave-start
    // hull, so a never-targeted enemy still reports its opening pool.
    const hull = snap?.combatants[enemy.id]?.hull ?? enemy.hull;
    if (hull <= 0) continue; // destroyed, not a valid focus-fire target
    // Strict < keeps the FIRST enemy on a tie (stable, matches the sim tiebreak).
    if (hull < bestHull) {
      bestHull = hull;
      bestId = enemy.id;
    }
  }
  return bestId;
}

// The living / destroyed split of an enemy wave, for the roster's "Enemy Wave (N)"
// header + its "K down" count.
export interface EnemyWaveTally {
  living: number;
  down: number;
}

// ---------------------------------------------------------------------------
// enemyWaveTally: how many enemies are still alive vs destroyed this round.
//
// Same CURRENT-hull read as targetEnemyId (snapshot hull, falling back to the
// wave-start hull): an enemy with hull <= 0 is counted as down, otherwise living.
// Pure over the enemies + snapshot so the header counts are testable without a DOM.
// ---------------------------------------------------------------------------
export function enemyWaveTally(
  enemies: readonly Combatant[],
  snap: RoundSnapshot | null,
): EnemyWaveTally {
  let living = 0;
  let down = 0;
  for (const enemy of enemies) {
    const hull = snap?.combatants[enemy.id]?.hull ?? enemy.hull;
    if (hull <= 0) down += 1;
    else living += 1;
  }
  return { living, down };
}
