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
// SCOPE:
//   - Fit / unfit + the gate + queries.
//   - Fold of equipment stats into ship-derived stats lives in model.ts (shipDerivedStats).
//   - The "a live slot is never empty / Standard-Issue auto-refit" invariant is now
//     IMPLEMENTED here (0.11.0 Task 20): unfitEquipment evicts the occupant to the pool
//     and mints a fresh Standard-Issue into the slot so it is never left empty (this
//     layered ON once the Standard-Issue baseline existed, see the note in unfitEquipment).
//   - No item-gen internals / crafting / quality / migration / UI (unfit calls the shared
//     model.ts generateStandardIssue rather than reimplementing minting).
//
// COMBAT 1.0 (Unit 1.8a) EXTENSION: this file now installs COMBAT gear too, on the SAME
// fittedToShipId authority. Two shapes join the four singleton economy slots:
//   - weapon is a MULTI slot: a hull holds UP TO SHIP_TYPES[hull].weaponHardpoints weapon
//     pieces at once. Installing ADDS a weapon (it does not evict a sibling); the gate
//     blocks the (cap+1)th with a new "hardpointsFull" reason.
//   - shieldEmitters + hullPlating are SINGLETONS, exactly like the economy slots (install
//     replaces the current piece in that slot).
// NEVER-EMPTY vs ALLOW-EMPTY split (the key combat behavior): ECONOMY slots keep the
// never-empty invariant (uninstall restores a Standard-Issue baseline). COMBAT slots ALLOW
// EMPTY: uninstalling a combat piece just returns it to the spare pool, leaving the slot
// bare. This is REQUIRED so the dispatch blocker (canDispatchPatrol, Unit 1.3) is reachable
// ("strip a required combat slot -> cannot patrol"); the stripped baseline sits in the pool
// and can be re-installed, so it is a recoverable state, never a permanent brick.
//
// Contents (Functions -> types -> queries -> gate -> mutators):
//   captainBranchToShipSpec  the CaptainTalentBranch -> ShipSpec bridge the gate needs
//   EquipFitBlockReason      the typed block-reason union (mirrors DispatchBlockReason)
//   equippedFor              query: the pieces fitted to a ship
//   fittedInSlot             query: the piece in one ship-slot, or null
//   canFitEquipment          the fitment gate (pure predicate + typed reason)
//   fitEquipment             ADD (multi weapon) / atomic single-slot swap (singleton)
//   unfitEquipment           evict a slot's piece to the pool + auto-refit Standard-Issue (economy)
//   unfitEquipmentInstance   uninstall ONE piece by id (economy never-empty / combat allow-empty)
// ============================================================================

import type {
  GameState,
  EquipmentInstance,
  EquipmentSlotType,
  ShipSpec,
  CaptainTalentBranch,
} from "./model";
import { EQUIPMENT_SLOTS, SHIP_TYPES, generateStandardIssue, isStandardIssueBaseline } from "./model";

// The slot-type partitions the fit gate (canFitEquipment) and the mutators read. Sets (not arrays)
// for O(1) membership; typed to EquipmentSlotType so a slot rename is a compile error.
//
// ECONOMY_INSTALLABLE_SLOTS: the four economy slots. They are the NEVER-EMPTY slots (uninstall
// restores a Standard-Issue baseline) and every one is a SINGLETON.
// COMBAT_SLOT_TYPES: the combat slots (weapon/shieldEmitters/hullPlating + Combat 1.0 Unit 2.2
// droneBay). Combat 1.0 OPENS these to player install (they were rejected in Unit 1.3 while only the
// auto-installed baseline existed). They are the ALLOW-EMPTY slots (uninstall leaves the slot bare;
// for the three REQUIRED slots that makes the dispatch blocker reachable, and a drone bay is simply
// optional-empty).
// MULTI_SLOT_TYPES: the slots that hold MORE THAN ONE piece per ship (weapon fills the hull's
// hardpoints; droneBay fills the hull's drone bays). A slotType NOT in this set is a singleton (at
// most one piece per ship-slot). Kept as its own set so a future multi slot is a one-line add.
const ECONOMY_INSTALLABLE_SLOTS: ReadonlySet<EquipmentSlotType> = new Set<EquipmentSlotType>([
  "cargoBay",
  "ftlDrive",
  "reactorCore",
  "specUtility",
]);
const COMBAT_SLOT_TYPES: ReadonlySet<EquipmentSlotType> = new Set<EquipmentSlotType>([
  "weapon",
  "shieldEmitters",
  "hullPlating",
  "droneBay",
]);
const MULTI_SLOT_TYPES: ReadonlySet<EquipmentSlotType> = new Set<EquipmentSlotType>(["weapon", "droneBay"]);

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
  // A reserved/unknown slot (bridge/quarters/thrusters/sensor/propellantTanks, none generated yet)
  // has no install support at all and is rejected generically. Combat 1.0 (Unit 1.8a) REMOVED the
  // former "combatSlotNotInstallable" member: the three combat slots (weapon / shieldEmitters /
  // hullPlating) are now player-installable, so that reason is no longer produced.
  | "slotNotInstallable"
  | "noShip"
  | "onMission"
  | "hullSpec"
  | "captainSpec"
  | "captainSpecParked"
  // Combat 1.0 (Unit 1.8a): a WEAPON cannot be installed because the hull's weapon hardpoints
  // (SHIP_TYPES[hull].weaponHardpoints) are already full. Weapon is the one MULTI slot, so unlike a
  // singleton (which just swaps) an over-cap install has nowhere to go; the player must uninstall a
  // weapon first. Only ever returned for a weapon piece.
  | "hardpointsFull"
  // Combat 1.0 (Unit 2.2): a DRONE POD cannot be installed because the hull's drone bays
  // (SHIP_TYPES[hull].droneBays, non-zero only on a carrier) are already full, or the hull has no
  // bays at all (droneBays 0). droneBay is a MULTI slot like weapon; over-cap has nowhere to go.
  // Only ever returned for a droneBay piece.
  | "baysFull";

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
// onMissionLock (shared guard, exported)
// ----------------------------------------------------------------------------
// The shared "is this ship editable / mutable right now?" guard, factored out
// (Omega 4, DRY) so canFitEquipment and unfitEquipment apply the IDENTICAL lock.
// EXPORTED as of ship-salvage (0.11.0): salvage.ts's salvageShip reuses this exact
// on-mission guard to BLOCK tearing apart a hull whose captain is out on a mission,
// so the fitment lock and the salvage lock can never drift apart (one source of truth
// for "this ship's captain is busy in flight").
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
export function onMissionLock(
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
// surfaces when several fail): instance exists (noInstance) -> slot is installable
// (slotNotInstallable) -> ship exists + on-mission lock (noShip / onMission) -> the
// slot's equipRequirement, hull first then captain (hullSpec / captainSpec /
// captainSpecParked) -> weapon hardpoint capacity (hardpointsFull, weapon only).
export function canFitEquipment(
  state: GameState,
  shipId: string,
  instanceId: string
): { ok: true } | { ok: false; reason: EquipFitBlockReason } {
  // --- Identity: the equipment piece must exist. Found by id (the pool is a flat
  // list keyed by the stable EquipmentInstance.id, like every other id lookup here).
  const instance = state.equipment.find((e) => e.id === instanceId);
  if (!instance) return { ok: false, reason: "noInstance" };

  // --- Installable-slot guard: the FOUR economy slots AND the three combat slots (weapon /
  // shieldEmitters / hullPlating) are player-installable. Combat 1.0 (Unit 1.8a) OPENED the combat
  // slots here (Unit 1.3 rejected them while only the auto-installed baseline existed). A
  // reserved/unknown slot (bridge/quarters/etc., none generated yet) is still rejected generically.
  // Checked early (a pure property of the piece, more fundamental than any ship/mission state) so a
  // bad install is refused before any ship lookup. Without this, a reserved slot (no EQUIPMENT_SLOTS
  // entry, no combat handling) would fall through to {ok:true}.
  if (!ECONOMY_INSTALLABLE_SLOTS.has(instance.slotType) && !COMBAT_SLOT_TYPES.has(instance.slotType)) {
    return { ok: false, reason: "slotNotInstallable" };
  }

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

  // --- Weapon hardpoint capacity (Combat 1.0, Unit 1.8a): weapon is the one MULTI slot. A hull holds
  // UP TO SHIP_TYPES[hull].weaponHardpoints weapons; installing ADDS one (fitEquipment does not evict a
  // sibling). So the install is refused only when the OTHER weapons already fitted to this ship fill
  // every hardpoint. We count weapons EXCLUDING this instance so a re-install of an already-fitted
  // weapon (a UI no-op) is never miscounted as needing an extra slot. Checked LAST: a wrong-hull/captain
  // requirement (more fundamental) surfaces before a capacity block, and only a weapon reaches here.
  if (instance.slotType === "weapon") {
    const cap = SHIP_TYPES[ship.typeKey].weaponHardpoints;
    const otherWeapons = state.equipment.filter(
      (e) => e.fittedToShipId === shipId && e.slotType === "weapon" && e.id !== instanceId
    ).length;
    if (otherWeapons >= cap) return { ok: false, reason: "hardpointsFull" };
  }

  // --- Drone bay capacity (Combat 1.0, Unit 2.2): droneBay is the other MULTI slot. A hull holds UP
  // TO SHIP_TYPES[hull].droneBays drone pods (non-zero only on a carrier); installing ADDS one. So the
  // install is refused when the OTHER pods already fill every bay, OR the hull has no bays at all
  // (droneBays absent/0, e.g. a destroyer). Counts pods EXCLUDING this instance (re-install no-op),
  // same posture as the weapon check above.
  if (instance.slotType === "droneBay") {
    const cap = SHIP_TYPES[ship.typeKey].droneBays ?? 0;
    const otherPods = state.equipment.filter(
      (e) => e.fittedToShipId === shipId && e.slotType === "droneBay" && e.id !== instanceId
    ).length;
    if (otherPods >= cap) return { ok: false, reason: "baysFull" };
  }

  return { ok: true };
}

// ----------------------------------------------------------------------------
// fitEquipment
// ----------------------------------------------------------------------------
// Fit a spare piece to a ship. A SINGLETON slot (economy + shieldEmitters +
// hullPlating) is an atomic single-slot swap; a MULTI slot (weapon) ADDS the piece
// to the ship's hardpoints (up to the cap, vetted by the gate). Guarded by
// canFitEquipment: on a blocked fit it THROWS with the reason token.
//
// WHY THROW (judgment call, flagged in the report) rather than the { next, success }
// no-op that tick.ts actions use: this function's signature returns a bare GameState,
// so a silent same-ref no-op would be indistinguishable from a fit that legitimately
// changed nothing, an observability hole (Omega 14). The UI calls canFitEquipment
// FIRST to decide whether the fit button is even enabled, so a throw here is a
// defensive assertion on an already-vetted call, not the player-facing failure path.
//
// TWO INSTALL SHAPES, branched on the slot (Combat 1.0, Unit 1.8a):
//
// MULTI slot (weapon): a hull holds UP TO its weaponHardpoints weapons. Installing ADDS
// the incoming weapon and does NOT evict any sibling weapon, so a partly-armed hull fills
// its remaining hardpoints one gun at a time. The hardpoint cap is enforced by
// canFitEquipment (hardpointsFull) BEFORE we get here, so this branch just sets fitment.
//
// SINGLETON slot (the four economy slots + shieldEmitters + hullPlating): a slot holds AT
// MOST ONE piece, so installing a new piece into an already-occupied slot on that ship
// EVICTS the current occupant back to the spare pool (its fittedToShipId set to null) in
// the SAME transition that fits the new one, so the slot is never briefly double-occupied
// and the pool never briefly loses the evicted piece. Both edits happen in one .map().
export function fitEquipment(state: GameState, shipId: string, instanceId: string): GameState {
  const gate = canFitEquipment(state, shipId, instanceId);
  if (!gate.ok) {
    // Loud, tokenized failure (see WHY THROW above). The reason token is embedded so
    // a caller/log can recover it from the message.
    throw new Error(`fitEquipment blocked: ${gate.reason}`);
  }

  // gate.ok guarantees the instance exists; resolve its slotType so we know how to install it.
  const incoming = state.equipment.find((e) => e.id === instanceId)!;
  const slotType = incoming.slotType;

  // MULTI slot (weapon): ADD the piece, evicting nothing. The cap is already vetted by the gate.
  if (MULTI_SLOT_TYPES.has(slotType)) {
    const equipment = state.equipment.map((e) =>
      e.id === instanceId ? { ...e, fittedToShipId: shipId } : e
    );
    return { ...state, equipment };
  }

  // SINGLETON slot: atomic swap. The incoming piece takes the slot; ANY current occupant of the SAME
  // slot on this ship is DISPLACED and EVICTED to the spare pool (fittedToShipId -> null). Nothing is
  // ever DESTROYED here, for any occupant, economy or combat, baseline or crafted or dev-granted.
  //
  // ⚠️ NO AUTO-DELETE (user principle 2026-08-26, reported repeatedly): the game must never make a
  // player's item vanish. An earlier version DESTROYED a displaced economy Standard-Issue baseline on
  // install as an anti-clutter measure; a player installing a crafted reactor over the free baseline
  // saw the baseline "vanish into thin air", which reads as data loss even for a worthless +0 floor.
  // So the displaced piece now ALWAYS becomes a recoverable spare that the install picker re-offers.
  // Bulk declutter of worthless baseline spares is OPT-IN only (Salvage Bay "Destroy" + the 0.13.1
  // auto-salvage rules), never an automatic side effect of installing gear.
  //
  // DUPE-SAFE: this only ever MOVES pieces (incoming -> fitted, displaced -> pool), never mints, and
  // uninstall likewise never re-mints (allow-empty), so a full install/uninstall round-trip is item-
  // count-neutral. The `id !== instanceId` guard on the eviction makes a re-install of the already-
  // fitted piece a safe no-op rather than a self-evict.
  const equipment = state.equipment.map((e) => {
    // The incoming piece: fit it to this ship.
    if (e.id === instanceId) return { ...e, fittedToShipId: shipId };
    // Any OTHER occupant of the SAME slot on this ship (the displaced piece): evict to the spare pool.
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
// Return the piece in a ship's slot (if any) to the spare pool AND auto-refit the
// slot with a fresh Standard-Issue baseline, so a LIVE SLOT IS NEVER EMPTY. Guarded
// by the SAME on-mission lock as fitEquipment (via onMissionLock), and THROWS with the
// reason token when that lock blocks (same WHY THROW rationale as fitEquipment: bare-
// GameState signature -> a throw keeps the failure observable).
//
// NEVER-EMPTY INVARIANT (0.11.0 Task 20, the behavior the design's "a live slot is
// never empty, Standard-Issue re-fits if you unequip to nothing" pins): after the
// current occupant is evicted to the pool (fittedToShipId -> null), the slot would be
// empty, so a FRESH Standard-Issue is minted and fitted in its place, advancing
// nextEquipmentId (the same monotonic "equip-N" counter every mint site spends).
// - Unfitting a CRAFTED piece: the crafted piece returns to the pool as a spare, and
//   a Standard-Issue takes the slot (the player keeps their gear, the slot stays live).
// - Unfitting a STANDARD-ISSUE BASELINE: the baseline is the free, non-collectible slot
//   FLOOR, not real inventory, so uninstalling it is a NO-OP. The same instance stays
//   fitted, nothing is evicted to the pool, nothing is minted, and the counter does not
//   advance. (The old behavior evicted the baseline to the pool AND minted a fresh one,
//   which net-created one extra baseline every call, the reported duplication bug.)
// If the slot is already EMPTY (nothing fitted), there is nothing to evict; the slot
// is nonetheless brought into the never-empty invariant by minting a Standard-Issue
// into it, so a same-ref no-op is NOT returned in that case (the slot gains a baseline).
//
// COMBAT 1.0 (Unit 1.8a) SCOPE: this is the ECONOMY / SINGLETON uninstall path and it stays
// never-empty. It is UNCHANGED (its economy callers rely on the exact behavior above). It must
// NOT be called on a combat slot: generateStandardIssue only mints economy baselines (it throws
// for a combat/reserved slotType), AND combat slots are ALLOW-EMPTY, not never-empty. Combat gear
// (and, in general, any uninstall-by-instance) goes through unfitEquipmentInstance below.
export function unfitEquipment(
  state: GameState,
  shipId: string,
  slotType: EquipmentSlotType
): GameState {
  const lock = onMissionLock(state, shipId);
  if (!lock.ok) {
    throw new Error(`unfitEquipment blocked: ${lock.reason}`);
  }

  // Identify the current occupant (if any) of this ship's slot.
  const occupant = state.equipment.find((e) => e.fittedToShipId === shipId && e.slotType === slotType);

  // NON-CREATE GUARD (integrity, same rule as unfitEquipmentInstance): an economy Standard-Issue
  // BASELINE (blueprintKey === null) is the free slot FLOOR, not collectible inventory. Uninstalling
  // it the old way evicted it to the pool AND minted a replacement, netting one EXTRA baseline every
  // time. Since the slot already holds a baseline, uninstalling a baseline is a NO-OP: the same
  // instance stays fitted, nothing is pooled or minted, the counter does not advance. (All four
  // economy slots this function serves are never-empty singletons, so a present occupant is always an
  // economy piece; a baseline occupant is exactly the floor.)
  // ⚠️ Uses the STRICT isStandardIssueBaseline predicate (blueprintKey null AND rarity "standard"),
  // not bare blueprintKey===null (audit AUDIT-3, defense-in-depth): a dev-granted radiant spare is
  // also blueprintKey null; treating it as a floor here would wrongly no-op a dev "reset" on it.
  // This is a DEV-only slot-based helper so it is not player-reachable, but aligning every
  // baseline-classifying site to the one strict predicate prevents per-site drift.
  if (occupant && isStandardIssueBaseline(occupant)) {
    return state;
  }

  // Evict a CRAFTED occupant (if any) to the pool. The slot is now empty.
  const evicted = occupant
    ? state.equipment.map((e) => (e.id === occupant.id ? { ...e, fittedToShipId: null } : e))
    : state.equipment;

  // Mint + fit a fresh Standard-Issue so the slot is never left empty (this also FILLS a slot that was
  // already empty, occupant undefined). The id is captured before advancing the counter, mirroring
  // every other "equip-N" mint site (freshState / the migration / the tick.ts build + unlock paths).
  const mintedId = state.nextEquipmentId;
  const replacement = generateStandardIssue({
    slotType,
    fittedToShipId: shipId,
    allocateId: () => `equip-${mintedId}`,
  });

  return {
    ...state,
    equipment: [...evicted, replacement],
    nextEquipmentId: mintedId + 1,
  };
}

// ----------------------------------------------------------------------------
// unfitEquipmentInstance
// ----------------------------------------------------------------------------
// Uninstall ONE specific piece BY ITS INSTANCE ID (Combat 1.0, Unit 1.8a). This is the
// uniform "uninstall the thing the player tapped" entry point the combat-fit UI (Unit 1.8b)
// calls for EVERY slot, so the interaction is one consistent flow. It is instance-targeted
// (not slot-targeted) because a MULTI weapon slot holds several pieces, so "uninstall the
// weapon" is ambiguous without an id; targeting the id works for singletons too.
//
// Guarded by the SAME on-mission lock as fitEquipment / unfitEquipment (via onMissionLock),
// and THROWS with the reason token when that lock blocks (same WHY THROW rationale: the
// bare-GameState signature makes a silent no-op indistinguishable from a real change, an
// observability hole, Omega 14). It also THROWS on a stale/bad call (unknown instance, or an
// instance not actually fitted to this ship): the UI only ever offers uninstall on a piece it
// already lists as fitted here, so these are defensive assertions on a vetted call, not the
// player-facing failure path.
//
// ALL SLOTS ARE NOW ALLOW-EMPTY AND UNIFORM (economy unified with combat, user calls 2026-08-26).
// Uninstalling ANY piece, economy or combat, crafted or Standard-Issue baseline, does the SAME thing:
// evict it to the spare pool (fittedToShipId -> null) and leave the slot (or, for a weapon, that one
// hardpoint) EMPTY. Nothing is minted; nothing is destroyed. Consequences:
//   - Whatever you take off is RECOVERABLE: it sits in storage and the install picker lists any
//     fittedToShipId===null piece of the slot's type (baselines included), so it can be re-installed.
//     This is REQUIRED for economy too: an earlier version DESTROYED an economy baseline on uninstall
//     as anti-clutter, but that made the free floor VANISH with no way back (there is no baseline
//     blueprint to fabricate), which read as a lost item, the user-reported "nowhere to be found".
//   - An empty ECONOMY slot is economically identical to a baseline (both fold to +0 in
//     equipmentStatMods), so stripping one costs no stats. An empty required COMBAT slot instead
//     trips canDispatchPatrol's blocker, a reachable "re-install something" state, not a brick.
//   - Bulk declutter of worthless baseline spares is a SEPARATE, opt-in concern: destroy in the
//     Salvage Bay today (salvage.ts), auto-salvage rules in 0.13.1. We do NOT pay for it by silently
//     deleting what the player uninstalled.
//
// NON-CREATE INTEGRITY: this only ever MOVES a piece to the pool, never mints, so no path can
// net-create an item (the reported duplication bug cannot recur).
//
// PURE: returns a new GameState, mutates nothing (nextEquipmentId is never advanced here any more).
export function unfitEquipmentInstance(
  state: GameState,
  shipId: string,
  instanceId: string
): GameState {
  const lock = onMissionLock(state, shipId);
  if (!lock.ok) {
    throw new Error(`unfitEquipmentInstance blocked: ${lock.reason}`);
  }

  // Identity: the piece must exist and must actually be fitted to THIS ship (an uninstall of a
  // spare, or of a piece on another ship, is a stale/bad call, refused loudly).
  const occupant = state.equipment.find((e) => e.id === instanceId);
  if (!occupant) {
    throw new Error(`unfitEquipmentInstance blocked: noInstance (${instanceId})`);
  }
  if (occupant.fittedToShipId !== shipId) {
    throw new Error(
      `unfitEquipmentInstance blocked: instance ${instanceId} is not installed on ship ${shipId}`
    );
  }

  // Evict the targeted piece to the spare pool, leaving the slot (or, for a weapon, that one
  // hardpoint) EMPTY. UNIFORM for every slot and every piece (see the header): the pooled piece,
  // baseline or crafted, is a re-installable spare, so nothing the player uninstalls is ever lost.
  // (`occupant.blueprintKey` / `occupant.slotType` no longer branch anything here; occupant is used
  // only by the identity guards above.)
  return {
    ...state,
    equipment: state.equipment.map((e) =>
      e.id === instanceId ? { ...e, fittedToShipId: null } : e
    ),
  };
}
