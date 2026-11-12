// crewTransferDisplay.ts: the pure display logic behind the CREW TRANSFER picker (0.14.0 CP-10,
// docs/plans/2026-10-14-complement-and-acquisition-plan.md; signed mockup docs/mockups/2026-11-02-cp10-transfer-picker-mockup.html,
// user picks 2026-11-02: (1) destination = ship cards with their room and reasons, (2) asking for more than there is room
// for is allowed, each row warns and the button shows what will move, (3) minus / count / plus / ALL per row, (4) the
// result row by row in the modal, (5) two steps on a phone, (7) taking from the pool only from the pool view).
//
// WHY its own module: the repo has no Svelte component test harness, so every number the picker shows (a card's room,
// a row's warning, the summary, the result) is computed here and tested. Every count comes from the ONE transfer engine
// (crewTransfer.ts transferCrew, run as a preview on the live state), so the picker can never promise a move the
// engine would not make: caps through remainingCapacityForSignature with the notables aboard counted, never evict,
// locked ships refused, manual ships only (OC-7). Pure: reads state, never mutates.

import type { CrewBucket, CrewProfession, CrewRank, CrewRarity, GameState, ShipComplement, ShipInstance } from "./game/model";
import { SHIP_TYPES, shipDisplayLabel } from "./game/model";
import {
  complementTotalCap,
  remainingDivisionCapacity,
  remainingRankCapacity,
  remainingTotalCapacity,
} from "./game/commandStructure";
import { notableSignature, signatureKey } from "./game/crew";
import { crewRankLabel } from "./game/crewRank";
import { quartersCapacityBonus } from "./game/crewModules";
import { crewLockReason, crewLockReasonText, crewLockUntilText } from "./game/crewLock";
import {
  CREW_POOL,
  crewTransferGateText,
  crewTransferShortfallText,
  transferCrew,
  type CrewTransferEndpoint,
  type CrewTransferPick,
  type CrewTransferResult,
} from "./game/crewTransfer";
import { CREW_RARITY_LABEL, DIVISION_LABEL, buffChips, crewGroupName } from "./complementTableDisplay";

// Every count the player reads is grouped the US way ("1,284").
export function fmtCount(n: number): string {
  return Math.max(0, Math.floor(n)).toLocaleString("en-US");
}

function shipOf(state: GameState, id: string): ShipInstance | undefined {
  return state.ships.find((s) => s.id === id);
}

// The endpoint's display name: "Crew pool" or the ship's display label.
export function endpointName(state: GameState, endpoint: CrewTransferEndpoint): string {
  if (endpoint === CREW_POOL) return "Crew pool";
  const ship = shipOf(state, endpoint);
  return ship ? shipDisplayLabel(state, ship) : "That ship";
}

function bucketsAt(state: GameState, endpoint: CrewTransferEndpoint): readonly CrewBucket[] {
  if (endpoint === CREW_POOL) return state.crewPool;
  return shipOf(state, endpoint)?.complement?.buckets ?? [];
}

// A ship's occupancy (bulk plus every notable assigned to it): the count every cap gate reads (CP-5 review).
function occupancyOf(state: GameState, ship: ShipInstance): CrewBucket[] {
  return [
    ...(ship.complement?.buckets ?? []),
    ...state.notableCrew.filter((n) => (n.assignedShipId ?? null) === ship.id).map((n) => ({ ...notableSignature(n), count: 1 })),
  ];
}

// A ship's berths: used (the occupancy) against its total (hull plus quarters bonus).
export interface Berths {
  used: number;
  cap: number;
}
export function shipBerths(state: GameState, ship: ShipInstance): Berths {
  const used = occupancyOf(state, ship).reduce((n, b) => n + b.count, 0);
  return { used, cap: complementTotalCap(ship.typeKey, quartersCapacityBonus(state, ship)) };
}

// How many crew wait in the pool (every bucket, notables are never in the pool).
export function poolHeadcount(state: GameState): number {
  return state.crewPool.reduce((n, b) => n + Math.max(0, b.count), 0);
}

// ============================================================================
// The source check (the picker opens on this before it shows any list)
// ============================================================================

// What stops a ship from GIVING crew right now: a lock (the Transfer button stays greyed with the words) or auto-crew
// (the picker opens with the "Switch to manual" line instead of the lists, mockup section 1 note). null = it can give.
export type TransferSourceBlock = { kind: "locked"; text: string } | { kind: "autoCrew"; text: string } | null;

export function transferSourceBlock(state: GameState, from: CrewTransferEndpoint): TransferSourceBlock {
  if (from === CREW_POOL) return null;
  const ship = shipOf(state, from);
  if (!ship) return null;
  const lock = crewLockReason(state, from);
  if (lock !== null) return { kind: "locked", text: `${crewLockReasonText(lock)}: crew changes are locked ${crewLockUntilText(lock)}` };
  if ((ship.complement?.mode ?? "passive") !== "active") {
    return { kind: "autoCrew", text: `${shipDisplayLabel(state, ship)} is on auto-crew. Switch it to manual crew first; auto-crew would refill it from the pool on the next tick` };
  }
  return null;
}

// ============================================================================
// Destination cards (pick 1: every ship visible with its room, mode and lock)
// ============================================================================

// ok: pickable; autoCrew: switch it to manual first (the card offers the switch); locked: out on a run; full: no
// berth left (full or over cap; listed, never pickable). The pool never fills.
export type DestinationStatus = "ok" | "autoCrew" | "locked" | "full";

export interface DestinationCard {
  id: CrewTransferEndpoint;
  kind: "pool" | "ship";
  name: string;
  hullLabel: string | null;
  mode: "manual" | "auto" | null; // null for the pool
  status: DestinationStatus;
  pickable: boolean;
  line: string | null; // the dim facts line ("702 / 750 berths · room for 48"); null when the warning says it all
  shortLine: string | null; // the phone's shorter facts line ("702 / 750 · room for 48")
  warn: string | null; // the reason it cannot be picked as it is (autoCrew, locked)
  shortWarn: string | null; // the phone's shorter reason
  canSwitchToManual: boolean; // an auto-crew ship that is not locked: the card offers "Switch ... to manual"
}

// The cards for a transfer FROM `from`: the crew pool first (unless it is the source), then every other ship in fleet
// order. A ship that is locked AND auto-crew reads as locked (the mode cannot change while it is out). Pure.
export function transferDestinations(state: GameState, from: CrewTransferEndpoint): DestinationCard[] {
  const cards: DestinationCard[] = [];
  if (from !== CREW_POOL) {
    const waiting = fmtCount(poolHeadcount(state));
    cards.push({
      id: CREW_POOL,
      kind: "pool",
      name: "Crew pool",
      hullLabel: null,
      mode: null,
      status: "ok",
      pickable: true,
      // Homeworld reserve (user 2026-11-12): the pool is no longer "no cap" (surplus no berth can take moves on).
      line: `${waiting} waiting`,
      shortLine: `${waiting} waiting`,
      warn: null,
      shortWarn: null,
      canSwitchToManual: false,
    });
  }
  for (const ship of state.ships) {
    if (ship.id === from) continue;
    const name = shipDisplayLabel(state, ship);
    const hullLabel = SHIP_TYPES[ship.typeKey]?.label ?? null;
    const mode = (ship.complement?.mode ?? "passive") === "active" ? ("manual" as const) : ("auto" as const);
    const { used, cap } = shipBerths(state, ship);
    const lock = crewLockReason(state, ship.id);
    const room = Math.max(0, cap - used);
    const base = { id: ship.id, kind: "ship" as const, name, hullLabel, mode };
    if (lock !== null) {
      cards.push({
        ...base,
        status: "locked",
        pickable: false,
        line: null,
        shortLine: null,
        warn: `${crewLockReasonText(lock)}: crew locked ${crewLockUntilText(lock)}.`,
        shortWarn: lock === "onExpedition" ? "On an expedition until claimed." : "Out until it returns.",
        canSwitchToManual: false,
      });
      continue;
    }
    const berths = `${fmtCount(used)} / ${fmtCount(cap)} berths`;
    const shortBerths = `${fmtCount(used)} / ${fmtCount(cap)}`;
    if (mode === "auto") {
      cards.push({
        ...base,
        status: "autoCrew",
        pickable: false,
        line: berths,
        shortLine: shortBerths,
        warn: "Switch the ship to manual crew first.",
        shortWarn: "Switch to manual crew first.",
        canSwitchToManual: true,
      });
      continue;
    }
    if (room <= 0) {
      const why = used > cap ? "over cap, takes no more crew" : "full, takes no more crew";
      cards.push({
        ...base,
        status: "full",
        pickable: false,
        line: `${berths} · ${why}`,
        shortLine: `${shortBerths} · ${used > cap ? "over cap" : "full"}`,
        warn: null,
        shortWarn: null,
        canSwitchToManual: false,
      });
      continue;
    }
    cards.push({
      ...base,
      status: "ok",
      pickable: true,
      line: `${berths} · room for ${fmtCount(room)}`,
      shortLine: `${shortBerths} · room for ${fmtCount(room)}`,
      warn: null,
      shortWarn: null,
      canSwitchToManual: false,
    });
  }
  return cards;
}

// The destination the picker starts on: the first pickable card (the pool for a ship's transfer), else null.
export function defaultDestination(cards: readonly DestinationCard[]): CrewTransferEndpoint | null {
  return cards.find((c) => c.pickable)?.id ?? null;
}

// ============================================================================
// The rows (pick 2 and 3: steppers up to what the group has; each row warns; ALL)
// ============================================================================

// A row's starting amounts: every picked group whole, in the order given. Groups no longer at the source drop out.
export function initialTransferPicks(state: GameState, from: CrewTransferEndpoint, keys: readonly string[]): CrewTransferPick[] {
  const picks: CrewTransferPick[] = [];
  for (const key of keys) {
    const available = availableAt(state, from, key);
    if (available > 0) picks.push({ signatureKey: key, count: available });
  }
  return picks;
}

// How many of a group the source holds (0 when it is gone).
export function availableAt(state: GameState, from: CrewTransferEndpoint, key: string): number {
  let n = 0;
  for (const b of bucketsAt(state, from)) if (signatureKey(b) === key) n += Math.max(0, b.count);
  return n;
}

// A stepper value kept to a whole number in [0, available]. Typing a count is allowed, never past what the group has.
export function clampPickCount(value: number, available: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(Math.max(0, available), Math.floor(value)));
}

export type PickNoteKind = "ok" | "short" | "none";

export interface PickRowView {
  key: string;
  name: string; // "Earth-born science group"
  shortName: string; // "Earth-born science" (the phone row)
  rankLabel: string;
  rarity: CrewRarity;
  rarityLabel: string;
  available: number; // aboard the source ship, or waiting in the pool
  availableText: string; // "131 aboard" / "302 waiting"
  count: number; // the amount asked for
  willMove: number; // what the engine would move right now (the preview)
  upTo: number; // the most this row could move after the rows above it, if it asked for all it has
  buffsText: string | null; // the group's buffs, shown only when another picked row reads the same (tells twins apart)
  note: PickNoteKind;
  noteText: string | null; // the row's line under it (warning or "Room for all")
  shortNoteText: string | null; // the phone's shorter line
}

// The cap that stops crew of this division and rank on `ship` once a preview has run (every gate reads 0 there), for
// the row's honest reason: the ship's berths, the division, or the inclusive rank caps (rank R and above).
function boundCapText(state: GameState, ship: ShipInstance, profession: CrewProfession, rank: CrewRank): string {
  const complement: ShipComplement = { buckets: occupancyOf(state, ship), mode: "active" };
  const bonus = quartersCapacityBonus(state, ship);
  const name = shipDisplayLabel(state, ship);
  if (remainingTotalCapacity(complement, ship.typeKey, bonus) <= 0) return `${name} has no berths left`;
  if (remainingDivisionCapacity(complement, ship.typeKey, profession, bonus) <= 0) return `${name}'s ${DIVISION_LABEL[profession]} division is full`;
  if (remainingRankCapacity(complement, ship.typeKey, profession, rank, bonus) <= 0) {
    return rank <= 1
      ? `${name} has no more ${DIVISION_LABEL[profession]} berths`
      : `${name} has no more ${DIVISION_LABEL[profession]} berths at ${crewRankLabel(rank)} or above`;
  }
  return `${name} has no more room for that crew`;
}

export interface TransferPreview {
  rows: PickRowView[];
  asked: number; // every row's amount added up
  willMove: number; // what the engine would move
  stay: number; // asked minus willMove (they stay where they are)
  gateText: string | null; // the whole-transfer refusal, if any (a lock or auto-crew that changed mid-pick)
  summary: string; // the desktop line under the rows
  shortSummary: string; // the phone line
  buttonLabel: string; // "Transfer 10"
}

// The picker's live preview for moving `picks` from `from` to `to` (to null = no destination picked yet). Each row's
// willMove comes from ONE engine preview of the whole pick list in order, so rows that compete for the same caps read
// exactly what the engine would do. Pure.
export function transferPreview(
  state: GameState,
  from: CrewTransferEndpoint,
  to: CrewTransferEndpoint | null,
  picks: readonly CrewTransferPick[],
): TransferPreview {
  const sourceName = endpointName(state, from);
  const groups = new Map<string, CrewBucket>();
  for (const b of bucketsAt(state, from)) if (!groups.has(signatureKey(b))) groups.set(signatureKey(b), b);
  // The engine refuses a pick of 0 (noPicks), so the preview runs on the rows that ask for at least 1.
  const asking = picks.filter((p) => p.count >= 1);
  const preview: CrewTransferResult | null = to !== null && asking.length > 0 ? transferCrew(state, from, to, asking) : null;
  const gateOk = preview === null || preview.gate.ok;
  const movedByKey = new Map<string, number>();
  if (preview && preview.gate.ok) preview.results.forEach((r) => movedByKey.set(r.signatureKey, (movedByKey.get(r.signatureKey) ?? 0) + r.moved));
  const targetShip = to !== null && to !== CREW_POOL ? shipOf(state, to) : undefined;
  const toName = to === null ? "" : endpointName(state, to);

  const rows: PickRowView[] = [];
  let asked = 0;
  let willMove = 0;
  picks.forEach((pick, i) => {
    const b = groups.get(pick.signatureKey);
    if (!b) return;
    const available = availableAt(state, from, pick.signatureKey);
    const count = clampPickCount(pick.count, available);
    asked += count;
    const moved = gateOk ? Math.min(count, movedByKey.get(pick.signatureKey) ?? 0) : 0;
    willMove += moved;
    // "up to": this row asking for everything it has, after the rows above it as asked.
    let upTo = available;
    if (to !== null && targetShip && gateOk) {
      const before = picks.slice(0, i).filter((p) => p.count >= 1);
      const probe = transferCrew(state, from, to, [...before, { signatureKey: pick.signatureKey, count: Math.max(1, available) }]);
      upTo = probe.gate.ok ? (probe.results[probe.results.length - 1]?.moved ?? 0) : 0;
    }
    let note: PickNoteKind = "none";
    let noteText: string | null = null;
    let shortNoteText: string | null = null;
    if (to !== null && gateOk && count > 0) {
      if (moved >= count) {
        note = "ok";
        noteText = `Room for all ${fmtCount(count)}${count < upTo && upTo < available ? ` (up to ${fmtCount(upTo)})` : ""}.`;
        shortNoteText = null;
      } else {
        note = "short";
        const left = count - moved;
        // The reason reads the state at the moment this row was applied (the rows above it and this one), never
        // after later rows, which could fill berths this row did not hit.
        const upToHere = picks.slice(0, i + 1).filter((p) => p.count >= 1);
        const atRow = preview && preview.gate.ok && targetShip ? transferCrew(state, from, to, upToHere) : null;
        const after = atRow && atRow.gate.ok && targetShip ? shipOf(atRow.next, targetShip.id) : undefined;
        const why = after && atRow ? boundCapText(atRow.next, after, b.profession, b.rank) : `${toName} has no more room for that crew`;
        const stays = from === CREW_POOL ? `The other ${fmtCount(left)} stay in the pool.` : `The other ${fmtCount(left)} stay aboard ${sourceName}.`;
        noteText = moved > 0 ? `Room for ${fmtCount(moved)}: ${why}. ${stays}` : `No room: ${why}. ${from === CREW_POOL ? `All ${fmtCount(count)} stay in the pool.` : `All ${fmtCount(count)} stay aboard ${sourceName}.`}`;
        shortNoteText = moved > 0 ? `Room for ${fmtCount(moved)}. The other ${fmtCount(left)} stay.` : "No room. They all stay.";
      }
    }
    rows.push({
      key: pick.signatureKey,
      name: crewGroupName(b.race, b.profession),
      shortName: crewGroupName(b.race, b.profession).replace(/ group$/, ""),
      rankLabel: crewRankLabel(b.rank),
      rarity: b.rarity,
      rarityLabel: CREW_RARITY_LABEL[b.rarity] ?? b.rarity,
      available,
      availableText: from === CREW_POOL ? `${fmtCount(available)} waiting` : `${fmtCount(available)} aboard`,
      count,
      willMove: moved,
      upTo,
      buffsText: null,
      note,
      noteText,
      shortNoteText,
    });
  });

  // Two groups can share a name, rank and rarity and differ only in their buffs: those rows name their buffs.
  const label = (r: PickRowView) => `${r.name}|${r.rankLabel}|${r.rarity}`;
  const seen = new Map<string, number>();
  for (const r of rows) seen.set(label(r), (seen.get(label(r)) ?? 0) + 1);
  for (const r of rows) {
    if ((seen.get(label(r)) ?? 0) < 2) continue;
    const g = groups.get(r.key);
    if (g) r.buffsText = buffChips(g).map((c) => c.label).join(", ");
  }

  const stay = asked - willMove;
  const gateText = preview && !preview.gate.ok ? transferGateLine(state, preview) : null;
  return {
    rows,
    asked,
    willMove,
    stay,
    gateText,
    summary: to === null ? "Pick where the crew go." : summaryLine(state, from, to, asked, willMove),
    shortSummary: to === null ? "Pick where the crew go." : shortSummaryLine(state, from, to, asked, willMove),
    buttonLabel: `Transfer ${fmtCount(willMove)}`,
  };
}

function transferGateLine(state: GameState, preview: CrewTransferResult): string | null {
  const t = crewTransferGateText(state, preview.gate);
  return t === undefined ? null : `${t}.`;
}

// "Vesper Reach goes from 768 to 758 / 750 (still 8 over cap)": a ship endpoint's berths before and after.
function berthsChange(state: GameState, shipId: string, delta: number): string {
  const ship = shipOf(state, shipId);
  if (!ship) return "";
  const { used, cap } = shipBerths(state, ship);
  const after = used + delta;
  const over = after - cap;
  return `${shipDisplayLabel(state, ship)} goes from ${fmtCount(used)} to ${fmtCount(after)} / ${fmtCount(cap)}${over > 0 ? ` (still ${fmtCount(over)} over cap)` : ""}.`;
}

function summaryLine(state: GameState, from: CrewTransferEndpoint, to: CrewTransferEndpoint, asked: number, willMove: number): string {
  const toName = endpointName(state, to);
  if (asked === 0) return "Set how many of each group to move.";
  const head =
    willMove >= asked
      ? `Moving ${fmtCount(asked)} to ${toName}.`
      : `Moving ${fmtCount(asked)} to ${toName}: room for ${fmtCount(willMove)}, ${fmtCount(asked - willMove)} stay.`;
  // The source ship's berths change, or (from the pool) the destination's.
  const tail = from !== CREW_POOL ? berthsChange(state, from, -willMove) : to !== CREW_POOL ? berthsChange(state, to, willMove) : "";
  return tail ? `${head} ${tail}` : head;
}

function shortSummaryLine(state: GameState, from: CrewTransferEndpoint, to: CrewTransferEndpoint, asked: number, willMove: number): string {
  if (asked === 0) return "Set how many to move.";
  const head = willMove >= asked ? `Room for all ${fmtCount(asked)}.` : `Room for ${fmtCount(willMove)} of ${fmtCount(asked)}.`;
  const shipId = from !== CREW_POOL ? from : to !== CREW_POOL ? to : null;
  if (shipId === null) return head;
  const ship = shipOf(state, shipId);
  if (!ship) return head;
  const { used, cap } = shipBerths(state, ship);
  const after = used + (shipId === from ? -willMove : willMove);
  return `${head} ${shipDisplayLabel(state, ship)}: ${fmtCount(after)} / ${fmtCount(cap)}.`;
}

// ============================================================================
// The result (pick 4: row by row in the modal; nobody is ever lost)
// ============================================================================

export interface TransferResultRow {
  key: string;
  label: string; // "Earth-born science group, Lieutenant"
  moved: number;
  requested: number;
  short: boolean;
  why: string | null; // "The destination has no more room for that crew." when short
}
export interface TransferResultView {
  heading: string; // "Moved 10 of 12 to Kestrel Line"
  rows: TransferResultRow[];
  footer: string; // the fleet log note and, when any stayed, where they are
}

// The result view, read against the state BEFORE the transfer (the group labels) and the engine's per-pick rows.
export function transferResultView(
  before: GameState,
  from: CrewTransferEndpoint,
  to: CrewTransferEndpoint,
  result: CrewTransferResult,
): TransferResultView {
  const groups = new Map<string, CrewBucket>();
  for (const b of bucketsAt(before, from)) if (!groups.has(signatureKey(b))) groups.set(signatureKey(b), b);
  const requested = result.results.reduce((n, r) => n + r.requested, 0);
  const rows = result.results.map((r) => {
    const b = groups.get(r.signatureKey);
    const label = b ? `${crewGroupName(b.race, b.profession)}, ${crewRankLabel(b.rank)}` : "A crew group";
    const why = r.limitedBy === null ? null : `${capitalize(crewTransferShortfallText(r.limitedBy))}.`;
    return { key: r.signatureKey, label, moved: r.moved, requested: r.requested, short: r.moved < r.requested, why };
  });
  const left = requested - result.moved;
  const where = from === CREW_POOL ? "still in the crew pool" : `still aboard ${endpointName(before, from)}`;
  return {
    heading: `Moved ${fmtCount(result.moved)} of ${fmtCount(requested)} to ${endpointName(before, to)}`,
    rows,
    footer:
      left > 0
        ? `Logged to the fleet log. Nobody was lost: the ${fmtCount(left)} without room ${left === 1 ? "is" : "are"} ${where}.`
        : "Logged to the fleet log.",
  };
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

// The fleet log line for a transfer that moved crew ("Transferred 10 crew from Vesper Reach to Kestrel Line (2 stayed: no room)").
export function transferLogLine(before: GameState, from: CrewTransferEndpoint, to: CrewTransferEndpoint, result: CrewTransferResult): string {
  const requested = result.results.reduce((n, r) => n + r.requested, 0);
  const left = requested - result.moved;
  const crew = result.moved === 1 ? "1 crewmember" : `${fmtCount(result.moved)} crew`;
  const fromName = from === CREW_POOL ? "the crew pool" : endpointName(before, from);
  const toName = to === CREW_POOL ? "the crew pool" : endpointName(before, to);
  return `Transferred ${crew} from ${fromName} to ${toName}${left > 0 ? ` (${fmtCount(left)} stayed: no room)` : ""}.`;
}

// After a transfer, "Transfer more" reopens the picker on what did not move (each row's leftover, still at the source);
// when everything moved, on the same groups' remaining crew (whole groups again).
export function picksAfterTransfer(after: GameState, from: CrewTransferEndpoint, result: CrewTransferResult): CrewTransferPick[] {
  const leftovers: CrewTransferPick[] = [];
  for (const r of result.results) {
    const left = clampPickCount(r.requested - r.moved, availableAt(after, from, r.signatureKey));
    if (left > 0) leftovers.push({ signatureKey: r.signatureKey, count: left });
  }
  if (leftovers.length > 0) return leftovers;
  return initialTransferPicks(after, from, result.results.map((r) => r.signatureKey));
}

// ============================================================================
// The crew pool view (pick 6: its own tab in Personnel Rosters)
// ============================================================================

export interface PoolDivisionStat {
  profession: CrewProfession;
  label: string;
  count: number;
  barPct: number; // against the largest division (the mockup's stat bars)
}

// The pool's headcount per division, in the game's division order, each bar against the largest division.
export function poolDivisionStats(state: GameState, professions: readonly CrewProfession[]): PoolDivisionStat[] {
  const counts = new Map<CrewProfession, number>();
  for (const b of state.crewPool) counts.set(b.profession, (counts.get(b.profession) ?? 0) + Math.max(0, b.count));
  const max = Math.max(1, ...professions.map((p) => counts.get(p) ?? 0));
  return professions.map((p) => {
    const count = counts.get(p) ?? 0;
    return { profession: p, label: DIVISION_LABEL[p], count, barPct: Math.round((count / max) * 100) };
  });
}
