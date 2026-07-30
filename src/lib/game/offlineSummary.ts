// ============================================================================
// offlineSummary.ts : Combat 0.13.0, Phase 13 (design Section 17)
//
// Author: Claude (Opus 4.8) | Date: 2026-07-30
// Plan: docs/plans/2026-07-22-combat-0.13.0-design.md Section 17
//       ("While-You-Were-Away overhaul")
//
// PURPOSE
//   Produce the "While you were away" report shown when a player returns after
//   being offline. The offline catch-up itself is a SINGLE deterministic call in
//   App.svelte's onMount: `state = tick(offlineSeconds, loadedSave.state)`. That
//   call is the live economy run at fast-forward; it is byte-identical to what the
//   player would have gotten sitting at the keyboard.
//
//   ⚠️ HARD INVARIANT: this module NEVER touches the sim. It is a PURE, READ-ONLY
//   DIFF of two GameState snapshots (the pre-tick `before` and the post-tick
//   `after`). It rolls no RNG, threads nothing through the deterministic tick, and
//   adds no draws. Offline == live stays exactly as `tick()` produced it; this file
//   only READS what changed so the UI can narrate it.
//
// ROBUSTNESS POSTURE (fail-open)
//   The summary is DISPLAY-ONLY. A missing / renamed / malformed field must never
//   throw and blank the game on load, so every accessor guards its input and falls
//   open to "nothing to report" for that section rather than propagating an error.
//   This mirrors the grow-on-demand, absent-is-default posture the inventory and
//   ship-repair fields already use.
// ============================================================================

import Decimal from "break_infinity.js";
import type { GameState, CaptainState, ShipInstance } from "./model";
import { itemTotal } from "./inventory";

// One material whose on-hand total rose across the offline advance. `qty` is the
// POSITIVE delta (after - before) as a Decimal, so the UI can format it with the
// shared formatNumber helper (never .toString()). `itemId` keys back into the ITEMS
// registry for the display label.
export interface OfflineMaterialGain {
  itemId: string;
  qty: Decimal;
}

// One captain who gained at least one level while away. Captains are matched by
// their stable numeric id between the two snapshots; `name` is the captain's live
// label captured from the AFTER snapshot (its most current display name).
export interface OfflineCaptainLevel {
  id: number;
  name: string;
  fromLevel: number;
  toLevel: number;
}

// One ship that limped home into the repair queue DURING the offline advance, i.e.
// it is flagged damaged in `after` but was not in `before`. `name` falls back to the
// ship's id when the hull has no player-given name (naming is still optional).
export interface OfflineShipInRepair {
  id: string;
  name: string;
}

// The complete before/after diff the "While you were away" modal renders. Every
// collection is empty (and every scalar zero) when nothing of that kind happened,
// so a section can be shown purely on its own non-emptiness. `hasContent` is the
// single "is any of this worth showing" gate (true iff at least one field below is
// non-zero / non-empty).
export interface OfflineSummary {
  secondsAway: number;
  hasContent: boolean;
  missionsCompleted: number;
  creditsEarned: Decimal;
  materialsGained: OfflineMaterialGain[];
  captainsLeveled: OfflineCaptainLevel[];
  shipsInRepair: OfflineShipInRepair[];
}

// --- Small fail-open readers ------------------------------------------------
// Each pulls one shape off a GameState defensively so a corrupt / partial snapshot
// degrades that ONE section to empty instead of throwing on load.

// Sum of every value in a Decimal tally map (e.g. lifetimeStats.missionsCompleted).
// Absent / non-object map -> Decimal(0). Non-Decimal stray values are skipped rather
// than trusted, keeping the sum well-defined on a hand-edited save.
function sumDecimalTally(tally: Record<string, Decimal> | undefined): Decimal {
  if (!tally || typeof tally !== "object") return new Decimal(0);
  let total = new Decimal(0);
  for (const value of Object.values(tally)) {
    if (value instanceof Decimal) total = total.plus(value);
  }
  return total;
}

// The captains array off a snapshot, or [] when absent / not an array. Callers then
// match by id, so a missing side simply yields no matches (skip), per the spec.
function captainsOf(state: GameState): CaptainState[] {
  const captains = (state as GameState | undefined)?.captains;
  return Array.isArray(captains) ? captains : [];
}

// The ships array off a snapshot, or [] when absent / not an array. Same fail-open
// posture as captainsOf.
function shipsOf(state: GameState): ShipInstance[] {
  const ships = (state as GameState | undefined)?.ships;
  return Array.isArray(ships) ? ships : [];
}

// The inventory map off a snapshot, or {} when absent. itemTotal already treats an
// absent key as 0, so an empty map yields no gains.
function inventoryOf(state: GameState): Record<string, Decimal[]> {
  const inv = (state as GameState | undefined)?.inventory;
  return inv && typeof inv === "object" ? inv : {};
}

// ============================================================================
// summarizeOfflineProgress : the ONE pure diff entry point.
//
// Computes what changed between `before` (pre-tick) and `after` (post-tick) across
// the offline advance of `secondsAway` real seconds. PURE: reads both snapshots,
// allocates the summary, mutates nothing, rolls no RNG.
//
// FIELD-BY-FIELD (all derived, none stored):
//   missionsCompleted : delta of summed lifetimeStats.missionsCompleted tallies,
//                       clamped >= 0 and rounded to a whole display count.
//   creditsEarned     : after.credits - before.credits, clamped >= 0 for display
//                       (a net spend while away is not "earned", so it shows 0).
//   materialsGained   : per-item itemTotal(after) - itemTotal(before), kept only
//                       where it ROSE (strictly positive), as a Decimal delta.
//   captainsLeveled   : captains (matched by id) whose level rose, from->to.
//   shipsInRepair     : ships flagged `damaged` in after that were NOT damaged in
//                       before (i.e. they limped home into repair while away). The
//                       repair field used is ShipInstance.damaged (the S13 flag the
//                       repair queue and re-dispatch gate both read).
//
// hasContent is the OR of every section being non-trivial, so the caller can decide
// whether the modal is worth opening at all.
// ============================================================================
export function summarizeOfflineProgress(
  before: GameState,
  after: GameState,
  secondsAway: number
): OfflineSummary {
  // --- Missions completed (summed tally delta) ---
  // lifetimeStats.missionsCompleted is a per-mission-key Decimal tally; the summary
  // reports the TOTAL new completions, so we diff the summed-across-keys totals.
  const missionsDelta = sumDecimalTally(after?.lifetimeStats?.missionsCompleted).minus(
    sumDecimalTally(before?.lifetimeStats?.missionsCompleted)
  );
  // Clamp negatives to 0 (a tally should only ever rise) then round to a whole count
  // for display. toNumber is safe here: a completion count never approaches the
  // double ceiling that would justify a Decimal display.
  const missionsCompleted = Math.max(0, Math.round(missionsDelta.toNumber()));

  // --- Credits earned (net gain, clamped) ---
  // Kept a Decimal so the modal formats it through formatNumber like every other
  // game number. A net SPEND while away (rare offline, but possible via auto-started
  // processes) clamps to 0 rather than showing a negative "earned" figure.
  const beforeCredits = before?.credits instanceof Decimal ? before.credits : new Decimal(0);
  const afterCredits = after?.credits instanceof Decimal ? after.credits : new Decimal(0);
  const creditsDelta = afterCredits.minus(beforeCredits);
  const creditsEarned = creditsDelta.lt(0) ? new Decimal(0) : creditsDelta;

  // --- Materials gained (per-item positive itemTotal delta) ---
  // Union the item keys of both inventories so an item that only EXISTS in `after`
  // (a first-ever pickup) is considered. itemTotal sums an item's quality buckets and
  // treats an absent key as 0, so a brand-new item reads before=0, after=full.
  const beforeInv = inventoryOf(before);
  const afterInv = inventoryOf(after);
  const materialKeys = new Set<string>([...Object.keys(beforeInv), ...Object.keys(afterInv)]);
  const materialsGained: OfflineMaterialGain[] = [];
  for (const itemId of materialKeys) {
    const delta = itemTotal(afterInv, itemId).minus(itemTotal(beforeInv, itemId));
    if (delta.gt(0)) materialsGained.push({ itemId, qty: delta }); // skip unchanged / decreased
  }

  // --- Captains leveled (matched by id, level rose) ---
  // Index the BEFORE captains by id so each after-captain finds its prior level in
  // O(1). A captain present on only one side (newly unlocked, or somehow removed) has
  // no counterpart to diff, so it is skipped per the spec.
  const beforeCaptainLevel = new Map<number, number>();
  for (const captain of captainsOf(before)) {
    beforeCaptainLevel.set(captain.id, captain.level);
  }
  const captainsLeveled: OfflineCaptainLevel[] = [];
  for (const captain of captainsOf(after)) {
    const fromLevel = beforeCaptainLevel.get(captain.id);
    if (fromLevel === undefined) continue; // no before-counterpart -> skip
    if (captain.level > fromLevel) {
      captainsLeveled.push({
        id: captain.id,
        name: captain.label,
        fromLevel,
        toLevel: captain.level,
      });
    }
  }

  // --- Ships newly in repair (damaged in after, not in before) ---
  // Index the BEFORE ships' damaged flag by id so we only count hulls that BECAME
  // damaged during the advance (a ship already limping when the player left is not
  // "news"). ShipInstance.damaged is the S13 flag the repair queue + re-dispatch gate
  // key on, so it is the authoritative "this ship is in the repair loop" signal.
  const beforeDamaged = new Map<string, boolean>();
  for (const ship of shipsOf(before)) {
    beforeDamaged.set(ship.id, ship.damaged === true);
  }
  const shipsInRepair: OfflineShipInRepair[] = [];
  for (const ship of shipsOf(after)) {
    const wasDamaged = beforeDamaged.get(ship.id) === true;
    if (ship.damaged === true && !wasDamaged) {
      shipsInRepair.push({ id: ship.id, name: ship.name ?? ship.id });
    }
  }

  // --- hasContent gate ---
  // True iff at least one section carries something worth surfacing. The modal (and
  // the onMount open-decision) reads this single boolean rather than re-checking each
  // field.
  const hasContent =
    missionsCompleted > 0 ||
    creditsEarned.gt(0) ||
    materialsGained.length > 0 ||
    captainsLeveled.length > 0 ||
    shipsInRepair.length > 0;

  return {
    secondsAway,
    hasContent,
    missionsCompleted,
    creditsEarned,
    materialsGained,
    captainsLeveled,
    shipsInRepair,
  };
}
