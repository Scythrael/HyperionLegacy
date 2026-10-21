// CP-7 (0.14.0, docs/plans/2026-10-14-complement-and-acquisition-plan.md, E-CREW Task 25 engine): TRANSFER.
//
// Design 6.3: "Active mode gets a TRANSFER action (move selected buckets between a ship and the pool or another
// ship, cap-aware)." transferCrew moves up to each requested count of a complement bucket from one endpoint (a
// ship's complement or the crew pool) to another, in the order the picks are given:
//   - CAP-AWARE per pick through remainingCapacityForSignature on the TARGET ship, with the target's quarters
//     capacity bonus AND its assigned notables counted as occupants (the applyRoster occupancy rule), so bulk
//     plus notables never exceed a cap. The pool has no cap (none exists, CP-6 carry), so it takes everything.
//   - PARTIAL when the target fills or the source runs short, reported per pick (requested, moved, and what
//     limited it). Over cap (OC-6, user 2026-10-16 "Never evict"): an over-cap target simply takes no more.
//   - REFUSED whole (the SAME state) while a ship involved is crew-locked (CP-6 crewLock.ts shipCrewLocked: a
//     captain mission, or an expedition until it is claimed), and while a ship involved is in auto-crew mode
//     (OC-7, user 2026-10-16 "Manual ships only (Recommended)"; the UI offers to switch it to manual first).
//   - No crew created or destroyed: every head that reaches the target left the source (moveBetweenBucketLists).
// Only the fungible BULK moves. Notables are their own records (assignedShipId) and never move here.
//
// WHY ITS OWN MODULE (the plan named crew.ts): the target's quarters bonus lives in crewModules.ts, which imports
// seniorStaff.ts, which imports crew.ts, so asking crewModules from crew.ts would close an import cycle. This
// module sits above all of them; nothing imports it back.
//
// RNG-free, clock-free, never runs on the tick. Pure: reads state, returns a new state, never mutates an input.

import type { CrewBucket, CrewSignature, GameState, NotableCrewMember, ShipComplement } from "./model";
import { addToBucketList, coalesceBuckets, moveBetweenBucketLists, signatureKey } from "./crew";
import { remainingCapacityForSignature } from "./commandStructure";
import { quartersCapacityBonus } from "./crewModules";
import { crewLockText, shipCrewLocked } from "./crewLock";

// The crew pool endpoint. Any other string is a ship id.
export const CREW_POOL = "pool" as const;
export type CrewTransferEndpoint = typeof CREW_POOL | string;

// One requested move: `count` crew of the bucket whose signatureKey (crew.ts) is `signatureKey`.
export interface CrewTransferPick {
  signatureKey: string;
  count: number;
}

// Why a transfer is refused whole:
//   noPicks:      no picks, or a pick whose count is not a whole number of at least 1
//   sameEndpoint: the source and the target are the same ship (or both the pool)
//   noShip:       a ship involved is no longer in the fleet
//   onMission:    a ship involved is crew-locked (crewLockText gives the accurate mission / expedition words)
//   autoCrew:     a ship involved is in auto-crew mode (OC-7: manual ships only)
// shipId names the ship for the three ship reasons (the source is checked before the target).
export type CrewTransferBlockReason = "noPicks" | "sameEndpoint" | "noShip" | "onMission" | "autoCrew";
export type CrewTransferGate =
  | { ok: true }
  | { ok: false; reason: "noPicks" | "sameEndpoint" }
  | { ok: false; reason: "noShip" | "onMission" | "autoCrew"; shipId: string };

// The player-facing words for a refusal (US English). EXHAUSTIVE with no default. Pure.
export function crewTransferBlockText(reason: CrewTransferBlockReason): string {
  switch (reason) {
    case "noPicks":
      return "Pick at least one crew member to transfer";
    case "sameEndpoint":
      return "Pick a different destination";
    case "noShip":
      return "That ship is no longer in the fleet";
    case "onMission":
      return "Ship is out on a mission";
    case "autoCrew":
      return "Switch the ship to manual crew first";
  }
}

// The player text for a gate, naming the real lock (mission vs expedition); undefined when it is open. Pure.
export function crewTransferGateText(state: GameState, gate: CrewTransferGate): string | undefined {
  if (gate.ok) return undefined;
  switch (gate.reason) {
    case "noPicks":
    case "sameEndpoint":
    case "noShip":
    case "autoCrew":
      return crewTransferBlockText(gate.reason);
    case "onMission":
      return crewLockText(state, gate.shipId) ?? crewTransferBlockText(gate.reason);
  }
}

function validPicks(picks: readonly CrewTransferPick[]): boolean {
  return picks.length > 0 && picks.every((p) => Number.isInteger(p.count) && p.count >= 1);
}

// Can crew move from `from` to `to`? Checked in order: noPicks, sameEndpoint, then for the source and then the
// target ship: noShip, onMission, autoCrew. The pool endpoint has no checks. A fresh ship with no complement
// reads as auto-crew (passive), the same default the tick uses. Pure.
export function canTransferCrew(
  state: GameState,
  from: CrewTransferEndpoint,
  to: CrewTransferEndpoint,
  picks: readonly CrewTransferPick[],
): CrewTransferGate {
  if (!validPicks(picks)) return { ok: false, reason: "noPicks" };
  if (from === to) return { ok: false, reason: "sameEndpoint" };
  const shipIds = [from, to].filter((e) => e !== CREW_POOL);
  for (const shipId of shipIds) {
    if (!state.ships.some((s) => s.id === shipId)) return { ok: false, reason: "noShip", shipId };
  }
  for (const shipId of shipIds) {
    if (shipCrewLocked(state, shipId)) return { ok: false, reason: "onMission", shipId };
  }
  for (const shipId of shipIds) {
    const ship = state.ships.find((s) => s.id === shipId)!;
    if ((ship.complement?.mode ?? "passive") !== "active") return { ok: false, reason: "autoCrew", shipId };
  }
  return { ok: true };
}

// What limited one pick (null when it moved in full):
//   targetFull:  the target ship's total, division or inclusive rank cap bound first
//   sourceShort: the source holds fewer of that bucket than requested (none at all included)
export type CrewTransferShortfall = "targetFull" | "sourceShort";

export interface CrewTransferPickResult {
  signatureKey: string;
  requested: number;
  moved: number;
  limitedBy: CrewTransferShortfall | null;
}

// The outcome of transferCrew. `next` is the SAME reference as the input state when the gate refuses or when no
// crew moved at all (so a handler's same-ref guard skips the save and log); `results` has one row per pick, in
// the given order (empty on a refusal); `moved` is the total headcount that changed hands.
export interface CrewTransferResult {
  next: GameState;
  gate: CrewTransferGate;
  results: CrewTransferPickResult[];
  moved: number;
}

// The player text for a pick that moved short (US English); null for a full move. Pure.
export function crewTransferShortfallText(limitedBy: CrewTransferShortfall): string {
  switch (limitedBy) {
    case "targetFull":
      return "the destination has no more room for that crew";
    case "sourceShort":
      return "not that many are available";
  }
}

// The occupant signature of a notable (one complement slot of its rank and division). Pure.
function notableOccupant(n: NotableCrewMember): CrewBucket {
  return {
    profession: n.profession,
    rarity: n.rarity,
    rank: n.rank,
    race: n.race,
    buff1Id: n.buff1Id,
    buff2Id: n.buff2Id,
    count: 1,
  };
}

function bucketsAt(state: GameState, endpoint: CrewTransferEndpoint): CrewBucket[] {
  if (endpoint === CREW_POOL) return state.crewPool;
  return state.ships.find((s) => s.id === endpoint)?.complement?.buckets ?? [];
}

// Move the picks from `from` to `to` (see the file header). Refuses whole while canTransferCrew does. Pure.
export function transferCrew(
  state: GameState,
  from: CrewTransferEndpoint,
  to: CrewTransferEndpoint,
  picks: readonly CrewTransferPick[],
): CrewTransferResult {
  const gate = canTransferCrew(state, from, to, picks);
  if (!gate.ok) return { next: state, gate, results: [], moved: 0 };

  let source = bucketsAt(state, from).map((b) => ({ ...b }));
  let target = bucketsAt(state, to).map((b) => ({ ...b }));

  // The target ship's cap inputs: its hull, its quarters bonus, and its occupancy (bulk plus every notable
  // assigned to it). Absent for the pool (no cap).
  const targetShip = to === CREW_POOL ? undefined : state.ships.find((s) => s.id === to);
  const bonusCapacity = targetShip ? quartersCapacityBonus(state, targetShip) : 0;
  let occupancy: CrewBucket[] = targetShip
    ? coalesceBuckets([
        ...target,
        ...state.notableCrew.filter((n) => (n.assignedShipId ?? null) === to).map(notableOccupant),
      ])
    : [];

  const results: CrewTransferPickResult[] = [];
  let moved = 0;
  for (const pick of picks) {
    const bucket = source.find((b) => signatureKey(b) === pick.signatureKey);
    const available = bucket ? bucket.count : 0;
    let room = Infinity;
    if (targetShip && bucket) {
      const complement: ShipComplement = { buckets: occupancy, mode: "active" };
      room = remainingCapacityForSignature(complement, targetShip.typeKey, bucket, bonusCapacity);
    }
    const count = Math.min(pick.count, available, room);
    let limitedBy: CrewTransferShortfall | null = null;
    if (count < pick.count) limitedBy = room < Math.min(pick.count, available) ? "targetFull" : "sourceShort";
    if (bucket && count > 0) {
      const sig: CrewSignature = bucket;
      const step = moveBetweenBucketLists(source, target, sig, count);
      source = step.from;
      target = step.to;
      if (targetShip) occupancy = addToBucketList(occupancy, sig, count);
      moved += count;
    }
    results.push({ signatureKey: pick.signatureKey, requested: pick.count, moved: count, limitedBy });
  }

  if (moved === 0) return { next: state, gate, results, moved };

  const withBuckets = (endpoint: CrewTransferEndpoint, buckets: CrewBucket[], s: GameState): GameState =>
    endpoint === CREW_POOL
      ? { ...s, crewPool: buckets }
      : {
          ...s,
          ships: s.ships.map((sh) =>
            sh.id === endpoint ? { ...sh, complement: { buckets, mode: sh.complement?.mode ?? "active" } } : sh,
          ),
        };
  const next = withBuckets(to, target, withBuckets(from, source, state));
  return { next, gate, results, moved };
}

// The headcount a transfer could move right now for one bucket on the target, for a picker's "up to N" hint:
// min(what the source holds, the target's room for that signature). 0 when the transfer is refused. Pure.
export function crewTransferRoom(
  state: GameState,
  from: CrewTransferEndpoint,
  to: CrewTransferEndpoint,
  key: string,
): number {
  const bucket = bucketsAt(state, from).find((b) => signatureKey(b) === key);
  if (!bucket) return 0;
  const preview = transferCrew(state, from, to, [{ signatureKey: key, count: bucket.count }]);
  return preview.gate.ok ? preview.moved : 0;
}
