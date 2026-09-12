// ============================================================================
// TRANSIT BERTHS, the derived read model
// Infrastructure 0.13.4, Phase 3 Unit 3.1. Design section 5.
//
// A PURE LEAF: model.ts plus equipment.ts's equippedFor and nothing else (see the import's
// own note for why that one is required), the same downward-only direction as reservation.ts.
// tick.ts and the console both read THIS file, so they cannot disagree about how many berths
// exist or who is waiting.
//
// ============================================================================
// ⚠️ THE SOFTLOCK PROOF. READ THIS BEFORE CHANGING ANYTHING IN THIS FILE.
// ============================================================================
//
// "You cannot unload without a free transit berth" has EXACTLY the shape of the 0.11.1 bug
// that bricked saves: the docks filled up and there was no in-game way to remove a ship, so
// acquiring one more softlocked the game. That release shipped as an emergency fix. The
// similarity here is real, it is why this proof was demanded before a line was written, and
// the structural difference is what resolves it.
//
// In 0.11.1, docks occupancy was a PARKED HULL: a resource consumed indefinitely, with no
// clearing mechanism in the game at all. Here, occupancy is a PHASE, and phases end.
//
// The guarantee is STRUCTURAL, provable from the shape of the state, not a runtime rescue,
// not a periodic sweep, not a hope:
//
//   (a) THE COUNT HAS A FLOOR NOTHING CAN LOWER. transitBerthCount is TRANSIT_BERTH_BASE
//       plus reached rungs, and every rung term only ever ADDS. A missing, malformed or
//       negative stored level falls through to the base. So the count is at least
//       TRANSIT_BERTH_BASE at every level, including a hand-edited or half-migrated save.
//       There is no derivation that can reach zero.
//
//   (b) OCCUPANCY IS TIME-BOUNDED, NEVER RESOURCE-BOUNDED. A berth is occupied exactly
//       while a captain is in the `unloading` phase, and that phase's advance is gated on
//       NOTHING: no material, no credit, no cap, no slot. The cycle completes
//       unconditionally and the cargo is folded into inventory afterwards by economyTick,
//       where the cap clamp DISCARDS overflow rather than stalling the phase. So every
//       occupant provably clears within `unloadTicks` ticks, unconditionally.
//
//   (c) OCCUPANCY IS DERIVED, NEVER STORED. There is no berth-assignment field anywhere:
//       no `berthId` on a mission, no occupancy array in the save. It is recomputed from
//       `phase === "unloading"` on every read. So there is no bookkeeping value that can
//       leak, no orphaned reservation, and no state a crash or a migration can strand.
//
//   THEREFORE the worst case is a DELAY, not a lock, and the delay has a computable
//   ceiling: ceil(concurrentReturns / berths) x unloadTicks. Both terms are bounded, and
//   the ceiling shrinks to zero as the player buys the track out.
//
// ⚠️ A STORED `berthId` IS REFUSED, PERMANENTLY. It is the obvious "optimisation" (why
// recompute every read?) and it would delete property (c), reintroducing precisely the
// stranded-resource class that made 0.11.1 an emergency. The recompute is a filter over at
// most MAX_UNLOCKABLE_CAPTAINS captains. It is not a cost worth a softlock.
//
// ⚠️ NO PAID BYPASS, EVER (design 5.5 I4, confirmed by the user at 17.1 Q3). The wait is
// bounded by (b), so there is no lock to escape. Selling relief from a delay the game
// manufactured is the exact anti-pattern the project's "never build in stress, friction or
// punishment" value forbids, and pricing it in forfeited cargo would be a punishment
// outright. The reachable, affordable fix is the UPGRADE TRACK. If a bypass is ever wanted,
// the only safe shape is a FREE "unload by tender" available while held, and that is a
// decision to re-open deliberately, not a convenience to add quietly.
// ============================================================================

import {
  MISSION_PHASE_LABEL,
  TRANSIT_BERTH_BASE,
  TRANSIT_BERTH_RUNGS,
  MISSIONS,
  effectiveMissionDef,
  requiredTicksForPhase,
  shipDerivedStats,
  type GameState,
  type CaptainState,
  type MissionKey,
} from "./model";
// ⚠️ ONE EXTRA IMPORT BEYOND model.ts, AND IT IS DELIBERATE. isAwaitingBerth has to ask the
// SAME question the engine asks ("has transitBack banked at its requirement?"), and the
// requirement depends on the ship's INSTALLED gear through effectiveMissionDef, which takes
// derived stats rather than the raw hull. Deriving it from the bare hull instead would make
// this file disagree with tick.ts for any ship carrying an engine module, which is precisely
// the two-definitions drift this file's header exists to prevent. equipment.ts imports only
// model.ts and reservation.ts, so there is no cycle.
import { equippedFor } from "./equipment";

// How many transit berths the fleet has RIGHT NOW.
//
// ⚠️ FLOOR PLUS RUNGS, NEVER A SUM FROM ZERO. This is proof property (a) above, and it is
// the same argument SALVAGE_BAY_BASE_SLOTS' comment makes: a sum-from-zero derivation gives
// every existing save zero, and every existing save is at the base. The stored field is the
// RUNG LEVEL, so an absent or corrupt value reads as level 0 and the count lands exactly on
// the base rather than on nothing.
//
// ⚠️ THE STORED FIELD IS A LEVEL, NOT A COUNT, which is a deliberate divergence from design
// 5.3's sketch (recorded in the 0.13.4 plan's corrections table). Storing a COUNT would let
// a save carry a capacity the code can no longer justify after a retune; storing a level
// means the count is always recomputed from the current table. It also makes the floor
// automatic rather than something a defensive `??` has to remember.
//
// Clamped to the track length so a hand-edited level far past the last rung reports the real
// ceiling instead of an invented number, and clamped at 0 below so a negative cannot subtract.
export function transitBerthCount(state: GameState): number {
  const level = state.transitBerthCapacity;
  const safeLevel = typeof level === "number" && Number.isFinite(level) ? Math.max(0, Math.floor(level)) : 0;
  return TRANSIT_BERTH_BASE + Math.min(safeLevel, TRANSIT_BERTH_RUNGS.length);
}

// Is this captain currently occupying a berth? True exactly while it is UNLOADING.
//
// This one predicate is proof property (c): occupancy is a question asked of the phase, never
// a fact stored anywhere. PURE.
function isUnloading(captain: CaptainState): boolean {
  return captain.mission !== null && captain.mission.kind === "extraction" && captain.mission.phase === "unloading";
}

// How many berths are occupied right now. Derived on every read, by design.
export function transitBerthsOccupied(state: GameState): number {
  return state.captains.filter(isUnloading).length;
}

// How many berths are free. Never negative: an over-occupied state (only reachable by a
// hand-edited save, or by lowering the base in a future retune while ships are docked) reports
// 0 free rather than a negative that would underflow a comparison somewhere downstream.
export function transitBerthsFree(state: GameState): number {
  return Math.max(0, transitBerthCount(state) - transitBerthsOccupied(state));
}

// Is this captain HELD at the end of its return leg, waiting for a berth?
//
// ⚠️ FULLY DERIVED, WITH NO NEW STATE FIELD (design 5.2). A captain is waiting exactly when
// it is an extraction mission in `transitBack` whose phase progress has BANKED at the phase
// requirement. That is the state the hold in tick.ts leaves behind: progress at exactly
// `requiredTicks`, phase unchanged, loop broken. Nothing is stored, so nothing can go stale.
//
// The `>=` rather than `===` is deliberate: phase progress is a float accumulated across
// calls, and the mission tick's own epsilon snapping means a banked value can sit a hair
// above the requirement. An `===` here would silently stop recognising held captains.
export function isAwaitingBerth(state: GameState, captain: CaptainState): boolean {
  const mission = captain.mission;
  if (mission === null || mission.kind !== "extraction" || mission.phase !== "transitBack") return false;
  const ship = state.ships.find((s) => s.assignedCaptainId === captain.id);
  if (ship === undefined) return false;
  const rawDef = MISSIONS[mission.missionKey as MissionKey];
  // An unknown key is not a held captain: the inert guard will drop it to idle. Reporting it
  // as "waiting" would put a ship in the berth queue that is about to stop existing.
  if (rawDef === undefined) return false;
  // The SAME resolution tickCaptainMission performs before it compares progress to the
  // requirement, so the two cannot disagree about when a leg is finished.
  const def = effectiveMissionDef(rawDef, shipDerivedStats(ship, equippedFor(state, ship.id)));
  return mission.phaseProgressTicks >= requiredTicksForPhase("transitBack", def);
}

// Every captain waiting for a berth, in `state.captains` ORDER.
//
// ⚠️ ARRAY ORDER IS THE QUEUE ORDER, and that is a determinism decision rather than an
// arbitrary one. state.captains is in monotonic captain-id insertion order, which is stable
// across a save, a load and an offline catch-up. It is the same ordering processShipRepairs
// uses for damaged hulls. Sorting by anything derived (progress, ETA, cargo value) would make
// the queue depend on values that move, and a queue that reorders itself between ticks cannot
// be explained to a player or held byte-identical offline.
export function captainsAwaitingBerth(state: GameState): number[] {
  return state.captains.filter((c) => isAwaitingBerth(state, c)).map((c) => c.id);
}

// This captain's 1-based place in the berth queue, or null if it is not waiting.
export function berthQueuePosition(state: GameState, captainId: number): number | null {
  const index = captainsAwaitingBerth(state).indexOf(captainId);
  return index === -1 ? null : index + 1;
}

// ⚠️ DISPLAY ONLY. An ESTIMATE of how many ticks until this captain gets a berth, for the
// "Waiting for a transit berth (3rd in line)" readout. NOTHING IN THE ENGINE MAY READ THIS:
// the hold is decided by transitBerthsFree at the moment of the advance, never by an ETA.
//
// The estimate assumes the pessimistic case, that every berth is currently full and each
// clears after a full `unloadTicks`. It therefore reads as an upper bound that ticks down,
// which is the honest direction for a wait estimate: a player who is told "about 8 ticks" and
// waits 3 is pleasantly surprised, while the reverse is a broken promise.
//
// Returns null when the captain is not waiting, and 0 when a berth is free for it right now
// (the position is within the free count, so the next advance will claim one).
export function berthEtaTicks(state: GameState, captainId: number): number | null {
  const position = berthQueuePosition(state, captainId);
  if (position === null) return null;
  const free = transitBerthsFree(state);
  if (position <= free) return 0;
  const berths = transitBerthCount(state);
  // How many full clearing rounds this captain must wait through.
  const rounds = Math.ceil((position - free) / Math.max(1, berths));
  // The longest unload in the game, so the estimate is an upper bound rather than an average
  // that under-promises for a slow mission. Derived from the table, never hardcoded, so a
  // retuned mission moves this with it.
  const worstUnload = Math.max(...Object.values(MISSIONS).map((m) => m.unloadTicks));
  return rounds * worstUnload;
}

// The WORST-CASE wait, in ticks, that the current fleet can produce. This is the computable
// ceiling the softlock proof promises, expressed as code so it can be asserted rather than
// argued.
//
// ⚠️ DERIVED FROM THE REACHABLE CAPTAIN COUNT, never a hardcoded number. The design's prose
// quoted 24 ticks from a captain ceiling of 5; the real ceiling is 4, so the real worst case
// is 16. Writing the expression rather than the number means this tracks automatically when
// unlock nodes are added, instead of silently going stale the way that 24 did.
export function worstCaseBerthWaitTicks(state: GameState, concurrentReturns: number): number {
  const berths = transitBerthCount(state);
  const worstUnload = Math.max(...Object.values(MISSIONS).map((m) => m.unloadTicks));
  return Math.ceil(Math.max(0, concurrentReturns) / Math.max(1, berths)) * worstUnload;
}

// ============================================================================
// THE PLAYER-FACING STATUS (Phase 4 Unit 4.1)
// ============================================================================

// The phase label a captain should show, WITH the berth hold folded in.
//
// ⚠️ ONE FUNCTION FOR EVERY RENDER SITE, AND THAT IS THE WHOLE POINT. There are exactly two
// places that render a mission phase (the captain card in App.svelte and the Home board row in
// homeDashboard.ts), and both previously read MISSION_PHASE_LABEL directly. Giving each its own
// held-state branch would be two chances to word it differently and two chances to forget. This
// release has already shipped a one-site fix twice (the trimmed-space bug, the zero-manifest
// guard) and had the same bug survive elsewhere, so the class gets swept, not the instance.
//
// A captain that is NOT held reads exactly as it did before this release, character for
// character, so nothing on either surface changes for an uncontended fleet.
//
// ⚠️ THE WAIT IS NAMED, NOT IMPLIED. "Waiting for a transit berth (3rd in line)" is the
// requirement the user attached to this feature: a feature whose only player-facing signal is
// "my missions got slower" is the failure mode they named by name. A held ship must never look
// like a stalled one.
export function missionPhaseStatus(state: GameState, captain: CaptainState): string {
  const mission = captain.mission;
  if (mission === null) return "";
  // A PATROL is not an extraction mission and has its own phase vocabulary (PATROL_PHASE_LABEL),
  // which this function deliberately does not own: patrols never occupy a berth (design 5.4), so
  // there is nothing for it to add. Returning "" hands the caller back to whatever it rendered
  // before, rather than indexing the extraction label table with a patrol phase.
  if (mission.kind !== "extraction") return "";
  if (!isAwaitingBerth(state, captain)) return MISSION_PHASE_LABEL[mission.phase];
  const position = berthQueuePosition(state, captain.id);
  // Position is non-null here by construction (isAwaitingBerth is the same predicate
  // captainsAwaitingBerth filters on), but a defensive fall-through beats rendering "null".
  if (position === null) return "Waiting for a transit berth";
  // ⚠️ BANKED IS NOT THE SAME AS BLOCKED, and conflating them mislabels a ship that is about to
  // dock. isAwaitingBerth recognises the BANKED state (progress at the requirement, phase still
  // transitBack), which is also the state a captain passes through for an instant on the tick it
  // claims a berth normally. If a berth is actually available for this captain (its queue
  // position is within the free count, the same test berthEtaTicks uses to return 0), it is
  // arriving, not queuing, and must read as an ordinary return leg.
  if (position <= transitBerthsFree(state)) return MISSION_PHASE_LABEL[mission.phase];
  return `Waiting for a transit berth (${ordinal(position)} in line)`;
}

// 1st / 2nd / 3rd / 4th. Small and local rather than a shared utility, because this is the only
// place in the codebase that needs an ordinal and inventing a general one now would be
// speculative. Handles the English teens correctly (11th, not 11st), which a naive
// last-digit switch gets wrong and which is reachable once the captain roster grows.
function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}
