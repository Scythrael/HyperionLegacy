// ============================================================================
// Equipment 0.11.0 (Task 12): the FIT / UNFIT system.
// Author: Scythrael (via Claude) | 2026-07-17
//
// PURE state-transform helpers over GameState.equipment, in the same immutable
// posture as tick.ts's action functions (assignShipToCaptain / dispatchCaptainOnMission):
// every mutator returns a NEW GameState and never touches the input.
//
// THE ONE INVARIANT everything here upholds: EquipmentInstance.fittedToShipId is
// the SINGLE SOURCE OF TRUTH for where a piece lives (null = spare in the pool),
// deliberately not duplicated onto the ship, exactly like ShipInstance.assignedCaptainId.
// So "fit a piece" == set its fittedToShipId, "unfit" == null it, and "what is on
// ship Y" == filter by fittedToShipId === Y. There is no second bookkeeping list.
//
// SCOPE (matches the task, do NOT extend here):
//   - Fit / unfit + the gate + queries ONLY.
//   - This task does NOT fold equipment stats into ship-derived stats (next task).
//   - This task does NOT seed the "a live slot is never empty / Standard-Issue
//     auto-refit" invariant (that is the later migration task). Here, unfitting
//     simply returns the piece to the pool and the slot becomes empty. The
//     auto-refit-to-Standard-Issue behavior will LAYER ON unfitEquipment once the
//     Standard-Issue baseline exists (see the note in unfitEquipment).
//   - No item-gen / crafting / quality / migration / UI.
//
// Contents (Functions -> types -> queries -> gate -> mutators):
//   captainBranchToShipSpec  the CaptainTalentBranch -> ShipSpec bridge the gate needs
//   EquipFitBlockReason      the typed block-reason union (mirrors DispatchBlockReason)
//   equippedFor              query: the pieces fitted to a ship
//   fittedInSlot             query: the piece in one ship-slot, or null
//   canFitEquipment          the fitment gate (pure predicate + typed reason)
//   fitEquipment             ATOMIC single-slot swap
//   unfitEquipment           return a slot's piece to the pool
// ============================================================================

import type {
  GameState,
  EquipmentInstance,
  EquipmentSlotType,
  ShipSpec,
  CaptainTalentBranch,
} from "./model";
import { EQUIPMENT_SLOTS, SHIP_TYPES } from "./model";

// ----------------------------------------------------------------------------
// captainBranchToShipSpec
// ----------------------------------------------------------------------------
// A captain's chosen specialization is stored as CaptainState.spec, a
// CaptainTalentBranch ("resourcefulness" | "tactical" | "science"). But an
// equipment slot's equipRequirement.captainSpec is expressed in the ShipSpec
// vocabulary ("general" | "prospector" | "tactician" | "explorer"). The two enums
// describe the same three specializations under different names, so the gate needs
// an explicit bridge to compare them.
//
// The mapping is NOT invented here: it is the exact, documented relationship the
// specialization-selector cards already pin (model.ts, specCards + the note above
// CaptainTalentBranch): the "resourcefulness" branch IS titled "Prospector",
// "tactical" IS "Tactician", "science" IS "Explorer". This function encodes that
// single established relationship in one place so the gate reads a stable helper
// instead of hard-coding a string compare.
//
// NOTE (judgment call, flagged in the task report): no shared branch->ShipSpec
// mapping existed in the codebase, so it is defined here, next to its only
// consumer. If a second consumer appears, promote it to model.ts. ShipSpec
// "general" has no captain branch (it is the neutral hull spec, not a captain
// specialization), so it is intentionally NOT a possible output.
//
// PURE: total over the three CaptainTalentBranch members, mutates nothing.
export function captainBranchToShipSpec(branch: CaptainTalentBranch): ShipSpec {
  switch (branch) {
    case "resourcefulness":
      return "prospector";
    case "tactical":
      return "tactician";
    case "science":
      return "explorer";
  }
}

// ----------------------------------------------------------------------------
// EquipFitBlockReason
// ----------------------------------------------------------------------------
// The typed reason canFitEquipment returns when a fit is BLOCKED. A string union
// (not a numeric enum) so it serializes / logs as a readable token and the later
// Equipment UI can switch on it exhaustively, mirroring tick.ts's DispatchBlockReason.
// Member order mirrors canFitEquipment's gate order (see below):
//   noInstance         , no equipment piece has that id (bad caller / stale UI ref)
//   noShip             , no ship has that id (bad caller / stale UI ref)
//   onMission          , the ship's captain is on an active mission (fitment is locked
//                        mid-mission, mirror of assignShipToCaptain's captain.mission
//                        !== null swap lock)
//   hullSpec           , the slot's equipRequirement.hullSpec does not match the hull
//   captainSpec        , the slot's equipRequirement.captainSpec does not match the
//                        assigned captain's spec (includes "captain has chosen no spec")
//   captainSpecParked  , the slot requires a captainSpec but the ship is parked (no
//                        captain to satisfy it), a distinct, clearer reason than captainSpec
export type EquipFitBlockReason =
  | "noInstance"
  | "noShip"
  | "onMission"
  | "hullSpec"
  | "captainSpec"
  | "captainSpecParked";

// ----------------------------------------------------------------------------
// equippedFor
// ----------------------------------------------------------------------------
// Every equipment piece currently FITTED to the given ship, read straight off the
// fittedToShipId authority. PURE: filters the immutable pool, returns a fresh array.
export function equippedFor(state: GameState, shipId: string): EquipmentInstance[] {
  return state.equipment.filter((e) => e.fittedToShipId === shipId);
}

// ----------------------------------------------------------------------------
// fittedInSlot
// ----------------------------------------------------------------------------
// The single piece occupying the given ship's given slot, or null when that slot
// is empty. Relies on the "a slot holds at most one piece" invariant that
// fitEquipment enforces (its atomic swap guarantees no two pieces of the same
// slotType are ever fitted to the same ship at once), so a plain .find() is exact.
// PURE.
export function fittedInSlot(
  state: GameState,
  shipId: string,
  slotType: EquipmentSlotType
): EquipmentInstance | null {
  return (
    state.equipment.find((e) => e.fittedToShipId === shipId && e.slotType === slotType) ?? null
  );
}

// ----------------------------------------------------------------------------
// onMissionLock (internal)
// ----------------------------------------------------------------------------
// The shared "is this ship's fitment editable right now?" guard, factored out
// (Omega 4, DRY) so canFitEquipment and unfitEquipment apply the IDENTICAL lock.
// Two failure modes, in order: the ship must exist (noShip), and its assigned
// captain must NOT be on an active mission (onMission).
//
// The on-mission rule MIRRORS assignShipToCaptain's swap lock EXACTLY
// (tick.ts ~line 2053: `if (captain.mission !== null) return ...fail`): you cannot
// change a hull mid-mission, and for the same closed-form reason you cannot change
// its FITMENT mid-mission either. A PARKED ship (assignedCaptainId null) has no
// captain and so no lock, it is freely editable. A captain whose mission has
// resolved to null (idle, or recalled-and-cycle-completed) is likewise unlocked;
// note recall only takes effect at the end of the current cycle (recallCaptain sets
// mission.recalled but leaves mission !== null), so a recalled-but-still-flying
// captain remains locked here, exactly as it is for a ship swap.
//
// PURE: reads state, returns a verdict, mutates nothing.
function onMissionLock(
  state: GameState,
  shipId: string
): { ok: true } | { ok: false; reason: EquipFitBlockReason } {
  const ship = state.ships.find((s) => s.id === shipId);
  if (!ship) return { ok: false, reason: "noShip" };

  // Parked hull (no captain) -> no lock. Otherwise resolve the flying captain and
  // apply the same mission !== null lock the ship-swap uses.
  if (ship.assignedCaptainId !== null) {
    const captain = state.captains.find((c) => c.id === ship.assignedCaptainId);
    // A captain genuinely on an active mission blocks fitment. (If the id somehow
    // resolves to no captain, treat it as unlocked, there is no active mission to
    // protect, same permissive stance the swap code takes for a stale link.)
    if (captain && captain.mission !== null) return { ok: false, reason: "onMission" };
  }

  return { ok: true };
}

// ----------------------------------------------------------------------------
// canFitEquipment
// ----------------------------------------------------------------------------
// THE fitment gate: a pure predicate answering "can this spare piece be fit to this
// ship right now?" It reads state + the static EQUIPMENT_SLOTS / SHIP_TYPES tables,
// mutates nothing, and is the SINGLE source of truth fitEquipment consults (the
// later Equipment UI calls it directly to enable / disable a fit button with the
// reason shown), the same single-source posture canDispatch has for dispatch.
//
// GATE ORDER (cheapest / most-fundamental first, and determines WHICH reason
// surfaces when several fail): instance exists (noInstance) -> ship exists +
// on-mission lock (noShip / onMission) -> the slot's equipRequirement, hull first
// then captain (hullSpec / captainSpec / captainSpecParked).
export function canFitEquipment(
  state: GameState,
  shipId: string,
  instanceId: string
): { ok: true } | { ok: false; reason: EquipFitBlockReason } {
  // --- Identity: the equipment piece must exist. Found by id (the pool is a flat
  // list keyed by the stable EquipmentInstance.id, like every other id lookup here).
  const instance = state.equipment.find((e) => e.id === instanceId);
  if (!instance) return { ok: false, reason: "noInstance" };

  // --- Ship existence + on-mission lock (shared with unfitEquipment). This also
  // yields the ship reference we need below, but onMissionLock re-finds it to stay
  // a self-contained guard, so we resolve the ship again here for the requirement
  // check (a find over a tiny list, negligible).
  const lock = onMissionLock(state, shipId);
  if (!lock.ok) return lock;
  // Non-null past the lock (it returned noShip otherwise).
  const ship = state.ships.find((s) => s.id === shipId)!;

  // --- Equip requirement: the slot's optional gate. Read the requirement off the
  // slot DEFINITION keyed by the INSTANCE's slotType (a piece carries its slot, and
  // the slot table owns the gate). Only the FOUR live slots have a definition this
  // patch; a piece in a reserved slot (none are generated this patch) has no def and
  // so no gate. A universal slot (cargoBay / ftlDrive / reactorCore) has no
  // equipRequirement at all and clears this whole block.
  const slotDef = EQUIPMENT_SLOTS[instance.slotType];
  const req = slotDef?.equipRequirement;
  if (req) {
    // HULL gate: the target hull's static spec (SHIP_TYPES[typeKey].spec) must equal
    // the required hullSpec. OPTIONAL, an absent hullSpec skips this check.
    if (req.hullSpec !== undefined) {
      const hullSpec = SHIP_TYPES[ship.typeKey].spec;
      if (hullSpec !== req.hullSpec) return { ok: false, reason: "hullSpec" };
    }

    // CAPTAIN gate: the assigned captain's spec (a CaptainTalentBranch, bridged to
    // ShipSpec via captainBranchToShipSpec) must equal the required captainSpec.
    // OPTIONAL, an absent captainSpec skips this check.
    if (req.captainSpec !== undefined) {
      // A parked hull has no captain to satisfy a captainSpec requirement, so a
      // spec-gated piece cannot be fit to it. Distinct reason so the UI can say
      // "assign a captain first" rather than "wrong spec".
      if (ship.assignedCaptainId === null) return { ok: false, reason: "captainSpecParked" };
      const captain = state.captains.find((c) => c.id === ship.assignedCaptainId);
      // No captain resolved, or the captain has not chosen a spec yet (spec null):
      // the requirement cannot be met.
      if (!captain || captain.spec === null) return { ok: false, reason: "captainSpec" };
      if (captainBranchToShipSpec(captain.spec) !== req.captainSpec) {
        return { ok: false, reason: "captainSpec" };
      }
    }

    // NOTE (scope): equipRequirement also DEFINES minCaptainLevel / requiresResearch
    // / requiresTalent, but this patch's ONLY gated slot (specUtility) uses just
    // captainSpec + hullSpec, so only those two are checked here (matches the task).
    // The others layer on when a slot that uses them ships.
  }

  return { ok: true };
}

// ----------------------------------------------------------------------------
// fitEquipment
// ----------------------------------------------------------------------------
// Fit a spare piece to a ship, as an ATOMIC SINGLE-SLOT SWAP. Guarded by
// canFitEquipment: on a blocked fit it THROWS with the reason token.
//
// WHY THROW (judgment call, flagged in the report) rather than the { next, success }
// no-op that tick.ts actions use: this function's signature returns a bare GameState,
// so a silent same-ref no-op would be indistinguishable from a fit that legitimately
// changed nothing, an observability hole (Omega 14). The UI calls canFitEquipment
// FIRST to decide whether the fit button is even enabled, so a throw here is a
// defensive assertion on an already-vetted call, not the player-facing failure path.
//
// ATOMIC SWAP: a slot holds AT MOST ONE piece. Fitting a new piece into a slot that
// is already occupied on that ship EVICTS the current occupant back to the spare
// pool (its fittedToShipId set to null) in the SAME transition that fits the new
// one, so the slot is never briefly double-occupied and the pool never briefly loses
// the evicted piece. Both edits happen in one .map() over the immutable pool.
export function fitEquipment(state: GameState, shipId: string, instanceId: string): GameState {
  const gate = canFitEquipment(state, shipId, instanceId);
  if (!gate.ok) {
    // Loud, tokenized failure (see WHY THROW above). The reason token is embedded so
    // a caller/log can recover it from the message.
    throw new Error(`fitEquipment blocked: ${gate.reason}`);
  }

  // gate.ok guarantees the instance exists; resolve its slotType so we know which
  // slot on this ship to clear.
  const incoming = state.equipment.find((e) => e.id === instanceId)!;
  const slotType = incoming.slotType;

  const equipment = state.equipment.map((e) => {
    // The incoming piece: fit it to this ship.
    if (e.id === instanceId) return { ...e, fittedToShipId: shipId };
    // The current occupant of the SAME slot on the SAME ship: evict to the pool.
    if (e.fittedToShipId === shipId && e.slotType === slotType) {
      return { ...e, fittedToShipId: null };
    }
    // Everything else (other ships, other slots, spares): untouched.
    return e;
  });

  return { ...state, equipment };
}

// ----------------------------------------------------------------------------
// unfitEquipment
// ----------------------------------------------------------------------------
// Return the piece in a ship's slot (if any) to the spare pool: its fittedToShipId
// is set to null. Guarded by the SAME on-mission lock as fitEquipment (via
// onMissionLock), and THROWS with the reason token when that lock blocks (same WHY
// THROW rationale as fitEquipment: bare-GameState signature -> a throw keeps the
// failure observable). If the slot is already empty, this is a no-op that returns
// the SAME state reference (nothing to unfit), matching the immutable same-ref
// convention.
//
// FUTURE (NOT this task): once the Standard-Issue craft-less baseline exists (later
// migration task), unfitEquipment will AUTO-REFIT the slot to a Standard-Issue piece
// instead of leaving it empty, upholding the "a live slot is never empty" invariant
// from the design. That behavior LAYERS ON here; this task deliberately just empties
// the slot.
export function unfitEquipment(
  state: GameState,
  shipId: string,
  slotType: EquipmentSlotType
): GameState {
  const lock = onMissionLock(state, shipId);
  if (!lock.ok) {
    throw new Error(`unfitEquipment blocked: ${lock.reason}`);
  }

  // The piece currently in that ship-slot, if any.
  const occupant = state.equipment.find((e) => e.fittedToShipId === shipId && e.slotType === slotType);
  // Slot already empty: nothing to do, return the untouched reference.
  if (!occupant) return state;

  const equipment = state.equipment.map((e) =>
    e.id === occupant.id ? { ...e, fittedToShipId: null } : e
  );
  return { ...state, equipment };
}
