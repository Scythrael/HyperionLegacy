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
import type { GameState, CaptainState, CaptainStopReason, ShipInstance } from "./model";
// Static registries + leveling curves (pure DATA / pure math, NOT the sim). MISSIONS/PATROLS
// classify a completed-mission key into its player-facing type (extraction = gathering, patrol =
// combat). xpForNextLevel / xpForNextFleetAdminLevel are the SAME curves the sim's level-up fold
// reads; the summary reuses them ONLY to reconstruct gross XP earned from two leftover-xp
// snapshots (see xpEarnedAcrossLevels). Importing these keeps the pure-diff invariant: no RNG, no
// tick(), just reading catalog data the same way the Warehouse/Operations UI already does.
import { MISSIONS, PATROLS, xpForNextLevel, xpForNextFleetAdminLevel, shipDisplayLabel } from "./model";
import { itemTotal } from "./inventory";
import { formatDuration } from "./format";
// FR-C R8-6 / R11-4: the recap's auto-salvage, started-order and finished-upgrade sections read the engine's cumulative
// tally and the queue, named through the SAME views the Home board and the consoles use (pure readers, no sim contact).
import type { CompletionLogEntry, QueueFacilityKey, RecapTally } from "./model";
import { completionRowView } from "./homeDashboard";
import { buildAllCraftQueues } from "./craftQueue";

// One material whose on-hand total rose across the offline advance. `qty` is the
// POSITIVE delta (after - before) as a Decimal, so the UI can format it with the
// shared formatNumber helper (never .toString()). `itemId` keys back into the ITEMS
// registry for the display label.
export interface OfflineMaterialGain {
  itemId: string;
  qty: Decimal;
}

// One mission TYPE and how many completions of that type landed while away. The
// completed-mission tally is keyed by mission id; each id is classified into a
// player-facing type (Gathering for extraction runs, Combat for patrols, Other for
// unknown/legacy keys) and the counts are summed per type. `count` is a whole number
// (a completion count never approaches the double ceiling), formatted via formatNumber.
export interface OfflineMissionTypeCount {
  type: string;
  count: number;
}

// One captain who EARNED XP while away (levels gained may be zero). Captains are matched
// by their stable numeric id between the two snapshots; `name` is the captain's live label
// captured from the AFTER snapshot (its most current display name). `xpGained` is the GROSS
// XP earned reconstructed across any level-ups (see xpEarnedAcrossLevels), a positive Decimal
// formatted via formatNumber; `levelsGained` is the whole-level rise (after.level - before.level,
// clamped >= 0), shown as "+N".
export interface OfflineCaptainProgress {
  id: number;
  name: string;
  xpGained: Decimal;
  levelsGained: number;
  // OPTIONAL "why did it stop early" hint: set only when this captain TRANSITIONED from
  // running a mission (before) to idle (after) DURING the window AND the sim stamped a
  // wall-stop reason (CaptainState.lastStopReason) at that stop. undefined when the captain
  // is still running, finished cleanly, or was already idle before the window. Read straight
  // off the AFTER snapshot (a pure diff, no sim contact); the modal maps it to a friendly note.
  stopReason?: CaptainStopReason;
}

// One ship that limped home into the repair queue DURING the offline advance, i.e.
// it is flagged damaged in `after` but was not in `before`. `name` is the shared ship
// display label (custom name, else hull label, numbered when hulls share a label).
export interface OfflineShipInRepair {
  id: string;
  name: string;
}

// FR-C R8-6: what the Auto-Salvage Terminal took while away, one row per thing it broke down (the completed-events
// entry's own label, "Salvaged, Prospector Hold"), with how many.
export interface OfflineAutoSalvageRow {
  label: string;
  count: number;
}

// FR-C R11-4: a queued order that started while away (it left its facility's queue), named as its queue row named it.
export interface OfflineOrderStarted {
  id: string;
  facility: QueueFacilityKey;
  label: string;
}

// FR-C R11-4: an upgrade that finished while away (a facility level, a Docks, Systems Bay or berth expansion), named as
// its RECENTLY COMPLETED row names it ("Upgraded, Fuel Depot, Level 2").
export interface OfflineUpgradeFinished {
  id: string;
  label: string;
}

// The complete before/after diff the "While you were away" modal renders. Every
// collection is empty (and every scalar zero) when nothing of that kind happened,
// so a section can be shown purely on its own non-emptiness. `hasContent` is the
// single "is any of this worth showing" gate (true iff at least one field below is
// non-zero / non-empty).
export interface OfflineSummary {
  secondsAway: number;
  hasContent: boolean;
  missionsByType: OfflineMissionTypeCount[];
  creditsEarned: Decimal;
  fleetXpGained: Decimal;
  fleetLevelsGained: number;
  captainsProgressed: OfflineCaptainProgress[];
  materialsGained: OfflineMaterialGain[];
  shipsInRepair: OfflineShipInRepair[];
  // G1-5: the unidentified relics that reached the vault while away (short-range cycles find them as they deliver; an
  // expedition's relics only land when the player claims it). A whole count, 0 when none.
  relicsFound: number;
  // FR-C R8-6 / R11-4 (each empty when nothing of the kind happened).
  autoSalvaged: OfflineAutoSalvageRow[];
  ordersStarted: OfflineOrderStarted[];
  upgradesFinished: OfflineUpgradeFinished[];
}

// FR-C fix pass: the recap's three engine sections read the cumulative tally (GameState.recapTally), diffed before
// against after, never the 50-entry completed-events log, so the counts are exact however long the absence ran.
function tallyOf(state: GameState): RecapTally {
  const t = (state as GameState | undefined)?.recapTally;
  return t && typeof t === "object" ? t : {};
}

// What the Auto-Salvage Terminal took: each key's count delta, named through the Home board's own row (a synthetic
// entry carrying the key's naming fields), rows with the same name merged, in first-seen key order. Fail-open.
function autoSalvagedOf(before: GameState, after: GameState): OfflineAutoSalvageRow[] {
  const was = tallyOf(before).autoSalvage ?? {};
  const now = tallyOf(after).autoSalvage ?? {};
  const rows: OfflineAutoSalvageRow[] = [];
  for (const key of Object.keys(now)) {
    const count = Math.max(0, (now[key] ?? 0) - (was[key] ?? 0));
    if (count <= 0) continue;
    let label = "Salvaged";
    try {
      const [reward, subjectKey, salvageSubject] = JSON.parse(key) as [CompletionLogEntry["reward"], string | null, CompletionLogEntry["salvageSubject"] | null];
      label = completionRowView(syntheticEntry({ kind: "salvageJob", reward, subjectKey, ...(salvageSubject ? { salvageSubject } : {}) }), after).primaryLabel;
    } catch {
      // a malformed key keeps the plain verb
    }
    const row = rows.find((r) => r.label === label);
    if (row !== undefined) row.count += count;
    else rows.push({ label, count });
  }
  return rows;
}

// The upgrades that finished: per track, its count delta n, one row per level reached (level - n + 1 through level,
// every upgrade raising its track by one), named as RECENTLY COMPLETED names it. Fail-open.
function upgradesFinishedOf(before: GameState, after: GameState): OfflineUpgradeFinished[] {
  const was = tallyOf(before).upgrades ?? {};
  const now = tallyOf(after).upgrades ?? {};
  const out: OfflineUpgradeFinished[] = [];
  for (const key of Object.keys(now)) {
    const track = now[key];
    const n = Math.max(0, (track?.n ?? 0) - (was[key]?.n ?? 0));
    if (n <= 0 || typeof track?.level !== "number") continue;
    const bar = key.indexOf("|");
    const kind = key.slice(0, bar) as CompletionLogEntry["kind"];
    const subjectKey = key.slice(bar + 1);
    for (let level = track.level - n + 1; level <= track.level; level++) {
      const view = completionRowView(syntheticEntry({ kind, reward: "level", subjectKey, level }), after);
      out.push({ id: `${key}|${level}`, label: view.secondaryLabel !== null ? `${view.primaryLabel}, ${view.secondaryLabel}` : view.primaryLabel });
    }
  }
  return out;
}

// A completed-events entry carrying only the naming fields the recap needs (the rest neutral), for completionRowView.
function syntheticEntry(fields: Pick<CompletionLogEntry, "kind" | "reward" | "subjectKey"> & Partial<CompletionLogEntry>): CompletionLogEntry {
  return { id: "recap", atMs: 0, startedAtMs: 0, iterations: 1, items: [], pieces: 0, level: null, fuelAmount: null, creditsAmount: null, stale: false, ...fields };
}

// The queued orders the ENGINE started: in BEFORE's queue, gone from AFTER's, and recorded by the promotion pass (so an
// order the player removed or started by hand, live between two absences, is never listed). Named by BEFORE's own
// queue rows. Fail-open to none.
function ordersStartedOf(before: GameState, after: GameState): OfflineOrderStarted[] {
  const beforeQueue = Array.isArray(before?.processQueue) ? before.processQueue : [];
  if (beforeQueue.length === 0) return [];
  const stillQueued = new Set((Array.isArray(after?.processQueue) ? after.processQueue : []).map((j) => j.id));
  const promotedIds = tallyOf(after).promoted;
  const promoted = new Set(Array.isArray(promotedIds) ? promotedIds : []);
  const left = beforeQueue.filter((j) => !stillQueued.has(j.id) && promoted.has(j.id));
  if (left.length === 0) return [];
  const rows = new Map<string, { facility: QueueFacilityKey; label: string }>();
  try {
    for (const view of buildAllCraftQueues(before)) for (const row of view.queued) rows.set(row.id, { facility: view.facility, label: row.summary });
  } catch {
    // a malformed snapshot: the rows below fall back to the raw facility
  }
  return left.map((j) => ({ id: j.id, facility: j.facility, label: rows.get(j.id)?.label ?? "Queued order" }));
}

// --- Small fail-open readers ------------------------------------------------
// Each pulls one shape off a GameState defensively so a corrupt / partial snapshot
// degrades that ONE section to empty instead of throwing on load.

// The completed-mission tally off a snapshot, or {} when absent / not an object. Keyed by
// mission id -> Decimal completion count. Callers diff it per key, so a missing side yields no
// completions for that key (fail-open).
function missionTallyOf(state: GameState): Record<string, Decimal> {
  const tally = (state as GameState | undefined)?.lifetimeStats?.missionsCompleted;
  return tally && typeof tally === "object" ? tally : {};
}

// A single tally cell as a Decimal: the stored value if it is one, else 0. Guards against a
// stray non-Decimal on a hand-edited save so the per-key diff stays well-defined.
function tallyCell(value: Decimal | undefined): Decimal {
  return value instanceof Decimal ? value : new Decimal(0);
}

// Classify a completed-mission tally KEY into its player-facing TYPE label. The tally is keyed
// by mission id: an extraction mission (a key in the MISSIONS registry) is resource GATHERING; a
// patrol (a key in the PATROLS registry) is COMBAT. An unknown / legacy / renamed key falls back
// to "Other" so its completions still count somewhere rather than silently vanishing. PURE: reads
// only the static registries, mirrors how the mission id -> kind mapping is defined in model.ts.
function missionTypeLabel(missionId: string): string {
  if (Object.prototype.hasOwnProperty.call(MISSIONS, missionId)) return "Gathering";
  if (Object.prototype.hasOwnProperty.call(PATROLS, missionId)) return "Combat";
  // G1-6 (the recap line of the signed-off board mockup): a delivered short-range cycle counts under
  // `shortRange:<template>` (tick.ts), so the recap names its own type instead of "Other".
  if (missionId.startsWith(SHORT_RANGE_TALLY_PREFIX)) return "Short-Range";
  return "Other";
}

// The lifetime tally's key prefix of a delivered short-range cycle (tick.ts economyTick's short-range arm).
const SHORT_RANGE_TALLY_PREFIX = "shortRange:";

// Fixed render order for the per-type rows so the modal is deterministic regardless of the
// tally's key-iteration order. Combat first (the headline of a combat session), then Gathering, then
// Short-Range (G1-6), then the Other catch-all last.
const MISSION_TYPE_ORDER = ["Combat", "Gathering", "Short-Range", "Other"] as const;

// Reconstruct the GROSS xp EARNED across a level span from two leftover-xp snapshots.
//
// Both captain.xp and fleetAdminXp store xp LEFTOVER toward the NEXT level: the shared level-up
// fold in tick.ts (foldXpLevelUps) SUBTRACTS each crossed threshold, so the field RESETS on every
// level-up. A naive after.minus(before) therefore goes NEGATIVE whenever a level was gained,
// which is the COMMON offline case (captains and the Fleet Admiral routinely level while away).
//
// The true earned amount is the leftover delta PLUS every threshold crossed between the two
// levels:
//     earned = (afterXp - beforeXp) + sum over l in [fromLevel, toLevel-1] of thresholdFor(l)
// This is exact and cap-independent: the fold's MAX_LEVEL_UPS_PER_TICK cap only CARRIES surplus
// xp forward in the returned leftover (it never DISCARDS xp, per that constant's contract), so
// the final leftover already contains any un-leveled surplus. Equivalently, this equals the gross
// XP the sim granted while away.
//
// PURE: reads only the static leveling curve passed in, rolls no RNG, never calls the sim.
// Clamps a negative result to 0 so a corrupt / hand-edited snapshot (level or xp went DOWN)
// degrades to "nothing earned" rather than surfacing a negative figure.
function xpEarnedAcrossLevels(
  beforeXp: Decimal,
  fromLevel: number,
  afterXp: Decimal,
  toLevel: number,
  thresholdFor: (level: number) => number,
): Decimal {
  let earned = afterXp.minus(beforeXp);
  for (let level = fromLevel; level < toLevel; level++) {
    earned = earned.plus(thresholdFor(level));
  }
  return earned.lt(0) ? new Decimal(0) : earned;
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

// The relic vault's token ids off a snapshot, or none when absent / not an array (fail-open).
function vaultIdsOf(state: GameState): string[] {
  const vault = (state as GameState | undefined)?.relicVault;
  return Array.isArray(vault) ? vault.map((t) => (t && typeof t === "object" && typeof t.id === "string" ? t.id : "")) : [];
}

// ============================================================================
// summarizeOfflineProgress : the ONE pure diff entry point.
//
// Computes what changed between `before` (pre-tick) and `after` (post-tick) across
// the offline advance of `secondsAway` real seconds. PURE: reads both snapshots,
// allocates the summary, mutates nothing, rolls no RNG.
//
// FIELD-BY-FIELD (all derived, none stored):
//   missionsByType    : per-key lifetimeStats.missionsCompleted deltas, each clamped >= 0 and
//                       rounded, then SUMMED into their player-facing type (Gathering / Combat /
//                       Other, see missionTypeLabel). One row per non-empty type.
//   creditsEarned     : after.credits - before.credits, clamped >= 0 for display
//                       (a net spend while away is not "earned", so it shows 0).
//   fleetXpGained     : gross Fleet Admiral XP earned, reconstructed across level-ups from
//                       fleetAdminXp + fleetAdminLevel (see xpEarnedAcrossLevels), a Decimal.
//   fleetLevelsGained : after.fleetAdminLevel - before.fleetAdminLevel, clamped >= 0.
//   materialsGained   : per-item itemTotal(after) - itemTotal(before), kept only
//                       where it ROSE (strictly positive), as a Decimal delta.
//   captainsProgressed: captains (matched by id) that EARNED xp, each with gross xpGained
//                       (reconstructed across level-ups) and levelsGained (+N).
//   relicsFound       : relic vault tokens in after whose id was not in before (G1-5: short-range finds).
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
  // --- Missions completed BY TYPE (per-key delta, summed into each type bucket) ---
  // lifetimeStats.missionsCompleted is a per-mission-key Decimal tally. Diff each key, clamp its
  // delta >= 0 and round to a whole count (a completion count never approaches the double ceiling
  // that would justify a Decimal display), then SUM the per-key counts into their player-facing
  // type (Gathering / Combat / Other). Union both sides' keys so a mission first completed while
  // away (present only in `after`) is still counted.
  const beforeMissions = missionTallyOf(before);
  const afterMissions = missionTallyOf(after);
  const missionKeys = new Set<string>([...Object.keys(beforeMissions), ...Object.keys(afterMissions)]);
  const countByType = new Map<string, number>();
  for (const key of missionKeys) {
    const delta = tallyCell(afterMissions[key]).minus(tallyCell(beforeMissions[key]));
    const whole = Math.max(0, Math.round(delta.toNumber()));
    if (whole <= 0) continue; // skip unchanged / decreased keys
    const type = missionTypeLabel(key);
    countByType.set(type, (countByType.get(type) ?? 0) + whole);
  }
  // Emit one row per non-empty type in the fixed display order (deterministic regardless of the
  // tally's key iteration order).
  const missionsByType: OfflineMissionTypeCount[] = MISSION_TYPE_ORDER
    .filter((type) => (countByType.get(type) ?? 0) > 0)
    .map((type) => ({ type, count: countByType.get(type)! }));

  // --- Credits earned (net gain, clamped) ---
  // Kept a Decimal so the modal formats it through formatNumber like every other
  // game number. A net SPEND while away (rare offline, but possible via auto-started
  // processes) clamps to 0 rather than showing a negative "earned" figure.
  const beforeCredits = before?.credits instanceof Decimal ? before.credits : new Decimal(0);
  const afterCredits = after?.credits instanceof Decimal ? after.credits : new Decimal(0);
  const creditsDelta = afterCredits.minus(beforeCredits);
  const creditsEarned = creditsDelta.lt(0) ? new Decimal(0) : creditsDelta;

  // --- Fleet Admiral XP + levels ---
  // fleetAdminXp is leftover-toward-next-level (it resets on each FA level-up), so the gross XP
  // earned is reconstructed across the level span rather than read as a raw field delta (see
  // xpEarnedAcrossLevels for why a raw delta would go negative on a level-up). fleetAdminLevel is a
  // plain number starting at 1; its rise is the levels gained, clamped >= 0.
  const beforeFaXp = before?.fleetAdminXp instanceof Decimal ? before.fleetAdminXp : new Decimal(0);
  const afterFaXp = after?.fleetAdminXp instanceof Decimal ? after.fleetAdminXp : new Decimal(0);
  const beforeFaLevel = typeof before?.fleetAdminLevel === "number" ? before.fleetAdminLevel : 1;
  const afterFaLevel = typeof after?.fleetAdminLevel === "number" ? after.fleetAdminLevel : 1;
  const fleetXpGained = xpEarnedAcrossLevels(
    beforeFaXp,
    beforeFaLevel,
    afterFaXp,
    afterFaLevel,
    xpForNextFleetAdminLevel
  );
  const fleetLevelsGained = Math.max(0, afterFaLevel - beforeFaLevel);

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

  // --- Captains that earned XP (matched by id) ---
  // Index the BEFORE captains by id so each after-captain finds its prior level + xp in O(1). A
  // captain present on only one side (newly unlocked, or somehow removed) has no counterpart to
  // diff, so it is skipped. For each matched captain, reconstruct the GROSS xp earned across any
  // level-ups (captain.xp is leftover-toward-next-level, same reset semantics as fleetAdminXp) and
  // keep only captains that actually earned xp (levelsGained may be 0). One compact row each, so
  // the modal's internal scroll fits all captains.
  // Also capture whether the BEFORE captain was on a mission, so the after-loop can detect the
  // "had a mission -> now idle" transition that means the captain STOPPED during the window (as
  // opposed to a captain that was already idle before the player left, which did NOT stop away).
  const beforeCaptainProgress = new Map<number, { level: number; xp: Decimal; hadMission: boolean }>();
  for (const captain of captainsOf(before)) {
    beforeCaptainProgress.set(captain.id, {
      level: captain.level,
      xp: captain.xp instanceof Decimal ? captain.xp : new Decimal(0),
      hadMission: captain.mission != null,
    });
  }
  const captainsProgressed: OfflineCaptainProgress[] = [];
  for (const captain of captainsOf(after)) {
    const prev = beforeCaptainProgress.get(captain.id);
    if (prev === undefined) continue; // no before-counterpart -> skip
    const afterXp = captain.xp instanceof Decimal ? captain.xp : new Decimal(0);
    const xpGained = xpEarnedAcrossLevels(prev.xp, prev.level, afterXp, captain.level, xpForNextLevel);
    if (xpGained.lte(0)) continue; // only captains that earned xp
    // "Stopped during the window" = had a mission before AND is idle (mission == null) now. Only
    // for that transition do we surface the wall-stop reason the sim stamped on the AFTER captain
    // (fuel / cargo / defeat). A still-running captain, or one that was already idle before the
    // window, carries no reason here (even if a stale lastStopReason lingers from a past stop).
    const stoppedDuringWindow = prev.hadMission && captain.mission == null;
    const stopReason = stoppedDuringWindow ? captain.lastStopReason : undefined;
    captainsProgressed.push({
      id: captain.id,
      name: captain.label,
      xpGained,
      levelsGained: Math.max(0, captain.level - prev.level),
      ...(stopReason !== undefined ? { stopReason } : {}),
    });
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
      shipsInRepair.push({ id: ship.id, name: shipDisplayLabel(after, ship) });
    }
  }

  // --- Relics found (G1-5): vault tokens new by id (a study started while away removes one, never adds one) ---
  const beforeVault = new Set(vaultIdsOf(before));
  const relicsFound = vaultIdsOf(after).filter((id) => id !== "" && !beforeVault.has(id)).length;

  // --- FR-C R8-6 / R11-4 (exact since the fix pass): auto-salvage taken, upgrades finished, queued orders started ---
  const autoSalvaged = autoSalvagedOf(before, after);
  const upgradesFinished = upgradesFinishedOf(before, after);
  const ordersStarted = ordersStartedOf(before, after);

  // --- hasContent gate ---
  // True iff at least one section carries something worth surfacing. The modal (and
  // the onMount open-decision) reads this single boolean rather than re-checking each
  // field.
  const hasContent =
    missionsByType.length > 0 ||
    creditsEarned.gt(0) ||
    fleetXpGained.gt(0) ||
    fleetLevelsGained > 0 ||
    captainsProgressed.length > 0 ||
    materialsGained.length > 0 ||
    shipsInRepair.length > 0 ||
    relicsFound > 0 ||
    autoSalvaged.length > 0 ||
    ordersStarted.length > 0 ||
    upgradesFinished.length > 0;

  return {
    secondsAway,
    hasContent,
    missionsByType,
    creditsEarned,
    fleetXpGained,
    fleetLevelsGained,
    captainsProgressed,
    materialsGained,
    shipsInRepair,
    relicsFound,
    autoSalvaged,
    ordersStarted,
    upgradesFinished,
  };
}

// ============================================================================
// HOTFIX 0.13.11.3: the recap's time lines, truthful and cap-aware.
//
// User, 2026-11-02: "we should note the current cap (which should be upgradable through talents at
// some point), and when the cap is hit, the popup should easily reflect this."
//
// `paidSeconds` is what the catch-up actually PAID (never the raw gap), `capSeconds` is the save's
// own cap (offlineCapSeconds(state), so a future talent shows here unchanged), and
// `cappedAwaySeconds` is the full absence when it ran past the cap (null: it did not). PURE.
// ============================================================================

// A cap reads as a plain length ("4d"), not an estimate ("~4d").
export function formatOfflineCap(capSeconds: number): string {
  return formatDuration(capSeconds, 1).replace(/^~/, "");
}

export interface OfflineRecapText {
  lead: string; // the opening sentence: how long the fleet ran
  capLine: string; // one short line naming the cap, or saying it was reached
  capHit: boolean;
}

export function offlineRecapText(paidSeconds: number, capSeconds: number, cappedAwaySeconds: number | null): OfflineRecapText {
  const cap = formatOfflineCap(capSeconds);
  const paid = formatDuration(paidSeconds, 1);
  if (cappedAwaySeconds !== null) {
    return {
      lead: `Your fleet ran for ${paid} while you were away. Here is what it got done.`,
      capLine: `You were away ${formatDuration(cappedAwaySeconds, 1)}. Offline progress pays up to ${cap}.`,
      capHit: true,
    };
  }
  return {
    lead: `You were away for ${paid}. Here is what your fleet got done.`,
    capLine: `Offline progress pays up to ${cap} per absence.`,
    capHit: false,
  };
}
