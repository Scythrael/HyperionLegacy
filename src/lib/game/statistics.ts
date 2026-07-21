// ============================================================================
// statistics.ts, the pure derivation behind Home's Statistics panel.
//
// Author: Claude Opus 4.8 / 2026-07-21 (0.11.2 Shell Correction, Task 2).
//
// deriveStatistics(state) is a READ-ONLY projection of fields that ALREADY exist
// on GameState. It adds NO tracked counters, mutates nothing, and has no tick /
// economy / save-format side effects, it only reshapes existing data into
// display-ready rows. Keeping it a pure function (state in, formatted rows out)
// is what makes it unit-testable without a runtime, see statistics.test.ts.
//
// The output is grouped into three subtabs the Home panel renders:
//   - lifetime: sums of the lifetimeStats Decimal maps + the scalar Decimals
//   - career:   play time (formatted duration) + the two 1-based levels
//   - fleet:    live array lengths (captains / ships / equipment / etc.)
//
// Every Decimal value is formatted through the shared formatNumber (Ops S8.E.4,
// the ONE display formatter), so this module never calls .toString() on a game
// number itself. Play Time is formatted inline (see formatPlayTime below) rather
// than via format.ts's formatDuration, on purpose, that helper renders an
// APPROXIMATE, tick-based "~2h 15m" estimate that rolls hours up into days, a
// poor fit for an EXACT, hours-first elapsed-time counter ("142h 18m").
// ============================================================================

import Decimal from "break_infinity.js";
import type { GameState } from "./model";
import { formatNumber } from "./format";

// One display row: a label and its already-formatted value string. The panel
// renders these verbatim, no further formatting happens in the component.
export interface StatRow {
  label: string;
  value: string;
}

// The full derived payload, one array per Home Statistics subtab.
export interface DerivedStatistics {
  lifetime: StatRow[];
  career: StatRow[];
  fleet: StatRow[];
}

// ----------------------------------------------------------------------------
// sumDecimalMap, total every per-key Decimal in a lifetimeStats map.
//
// The lifetimeStats maps (missionsCompleted, itemsGathered, itemsRefined,
// itemsCrafted) are keyed tallies; the panel wants the fleet-wide total, so we
// reduce with Decimal.plus starting from a fresh Decimal(0). Object.values on an
// empty map yields [], reducing to the seed 0, so an untouched map reports "0"
// rather than throwing or reading NaN.
// ----------------------------------------------------------------------------
function sumDecimalMap(map: Record<string, Decimal>): Decimal {
  return Object.values(map).reduce((total, value) => total.plus(value), new Decimal(0));
}

// ----------------------------------------------------------------------------
// formatPlayTime, an EXACT hours-first elapsed-time string.
//
// gameTimeSeconds is accumulated in-game seconds. Players read this counter as a
// badge of total time invested, so it stays hours-first ("142h 18m") instead of
// rolling up into days the way format.ts's formatDuration does. Sub-hour spans
// drop to "45m", and anything under a minute (including a brand-new 0-second
// save) reads "0m" so the readout is never blank or a bare "0s".
//
// Guards: a non-finite or non-positive input has no sensible span, so it reports
// "0m" (the "nothing logged yet" floor) rather than NaN or a negative clock.
// ----------------------------------------------------------------------------
function formatPlayTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "0m";

  const SECONDS_PER_HOUR = 3600;
  const SECONDS_PER_MINUTE = 60;

  const hours = Math.floor(totalSeconds / SECONDS_PER_HOUR);
  const minutes = Math.floor((totalSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  // A positive-but-sub-minute span still reads "0m", not "0s", so the counter
  // shows the same minute-granular unit at every scale.
  return "0m";
}

// ----------------------------------------------------------------------------
// formatCount, render a discrete integer counter (a level or an array length).
//
// These are NOT resource magnitudes, so they bypass formatNumber (whose <10
// branch would render "7.00" for a single-digit level) and display raw, matching
// how App.svelte interpolates `{state.fleetAdminLevel}` and facility levels. A
// non-integer or non-finite input is floored/zeroed defensively, callers only
// ever pass real integers today, this just keeps the readout stable if that
// changes.
// ----------------------------------------------------------------------------
function formatCount(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return String(Math.floor(n));
}

// ----------------------------------------------------------------------------
// deriveStatistics, the single public entry point.
//
// Pure: given a GameState it returns the grouped rows and touches nothing. The
// component wires it reactively ($: stats = deriveStatistics(state)) so the
// readout refreshes each tick from live state.
// ----------------------------------------------------------------------------
export function deriveStatistics(state: GameState): DerivedStatistics {
  const lifetime: StatRow[] = [
    { label: "Missions Completed", value: formatNumber(sumDecimalMap(state.lifetimeStats.missionsCompleted)) },
    { label: "Items Gathered", value: formatNumber(sumDecimalMap(state.lifetimeStats.itemsGathered)) },
    { label: "Items Refined", value: formatNumber(sumDecimalMap(state.lifetimeStats.itemsRefined)) },
    { label: "Items Crafted", value: formatNumber(sumDecimalMap(state.lifetimeStats.itemsCrafted)) },
    { label: "Credits Earned", value: formatNumber(state.lifetimeStats.creditsEarned) },
    { label: "Captain XP Awarded", value: formatNumber(state.lifetimeStats.captainXpAwarded) },
    { label: "Fleet Admiral XP Awarded", value: formatNumber(state.lifetimeStats.fleetAdminXpAwarded) },
  ];

  const career: StatRow[] = [
    { label: "Play Time", value: formatPlayTime(state.gameTimeSeconds) },
    // fleetAdminLevel and craftingLevel are plain 1-based DISCRETE counters, not
    // resource magnitudes. They are displayed RAW here (String, not formatNumber)
    // to match the codebase's own convention, App.svelte's top bar renders the FA
    // level as bare `{state.fleetAdminLevel}` and every facility level the same
    // way. Routing them through formatNumber would print "7.00" for a single-digit
    // level (formatNumber's <10 branch shows 2 decimals), which is wrong for a
    // level readout. formatNumber stays reserved for the lifetime Decimals below.
    { label: "Fleet Admiral Level", value: formatCount(state.fleetAdminLevel) },
    { label: "Crafting Level", value: formatCount(state.craftingLevel) },
  ];

  const fleet: StatRow[] = [
    // Live array LENGTHS are small discrete integers, same reasoning as the
    // levels above: render raw so a count of 2 reads "2", not "2.00".
    { label: "Captains", value: formatCount(state.captains.length) },
    { label: "Ships Owned", value: formatCount(state.ships.length) },
    { label: "Equipment Pieces", value: formatCount(state.equipment.length) },
    { label: "Researched Blueprints", value: formatCount(state.researchedBlueprints.length) },
    { label: "Homeworld Talents", value: formatCount(state.unlockedHomeworldTalents.length) },
  ];

  return { lifetime, career, fleet };
}
