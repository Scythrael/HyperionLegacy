// ============================================================================
// quartermaster.ts: the QUARTERMASTER's Requisition counter (0.13.3.1).
// Author: Scythrael (via Claude) | 2026-09-11
//
// WHAT THIS IS. A free Standard-Issue dispenser. One player action: take a fresh
// Standard-Issue baseline for a slot, at no cost, into the spare pool.
//
// ⚠️ WHY IT HAD TO SHIP IN THE SAME RELEASE AS AUTO-SALVAGEABLE BASELINES. Until
// 0.13.3.1 a Standard-Issue baseline was one of the six auto-salvage protections: the
// automation could never destroy one, so the "every live slot has a floor" promise held
// by construction. Making baselines destroyable by automation removes that guarantee,
// and the failure it opens is not cosmetic: canDispatchPatrol (tick.ts) BLOCKS a patrol
// when a required combat slot is empty, and nothing in the game hands out a replacement
// baseline. A player whose rules ate the spare plating they had just uninstalled would
// have had no route back short of researching and crafting one.
//
// A WARNING DIALOG IS NOT A SUBSTITUTE FOR RECOVERABILITY. A warning says "do not do
// this"; a free refill makes doing it survivable. The second removes the failure mode
// instead of labelling it, which is the project's stated peace value applied
// structurally. Both ship: the dialog is the other half of this release.
//
// SCOPE, DELIBERATELY NARROW:
//   - REQUISITION (this file): every Standard-Issue floor, 0 credits.
//   - Purchase / Sell: NOT BUILT. They are placeholder sub-tabs in the console, the
//     same "Coming Soon!" treatment the Refinery's reserved rail slot uses. A real
//     merchant needs pricing, stock and an economy balance pass, which is its own
//     feature. A locked tab is an honest roadmap marker; a half-priced shop is not.
//
// ⚠️ NO FACILITY LEVEL, NO UPGRADE TRACK, AND NO FACILITIES ENTRY. This is a service
// counter, not a production building: there is nothing to run faster and no lane to buy,
// so a level would be a number that never means anything. It follows the DOCKS
// precedent (App.svelte's docks console): a dashboard card plus a console, with no
// FACILITIES[key] and no state.facilities entry at all, rather than the Salvage Bay's
// "seeded at level 0, level 0 is a working bay" posture, which exists only because the
// bay DOES have lanes to sell. Consequence: the Quartermaster adds NOTHING to the save,
// so SAVE_VERSION does not move (see the requisition transform below for the one field
// it does touch, nextEquipmentId, which every mint already touches).
//
// ⚠️ IT NEVER TOUCHES THE TICK. Requisition is a PLAYER ACTION, resolved immediately in
// its own pure transform, exactly like fitEquipment / unfitEquipmentInstance. No timed
// process, no queue adapter, no economyTick branch. That is what keeps the offline==live
// parity gate unmoved: parity compares what a tick DOES, and this changes nothing a tick
// does.
//
// PURE, IMMUTABLE, same posture as equipment.ts: every transform returns a NEW GameState
// and never mutates its input.
//
// Contents:
//   RequisitionMint          how one row mints its baseline (the four generator shapes)
//   REQUISITION_CATALOGUE    the TOTAL Record over EquipmentSlotType (totality lives here)
//   REQUISITION_ENTRIES      the DERIVED, ordered list the console renders
//   RequisitionBlockReason   the typed refusal union (mirrors EquipFitBlockReason)
//   freeSpareBaselinesFor    query: uninstalled, unreserved baselines of one slot
//   canRequisition           the gate (pure predicate + typed reason)
//   requisitionStandardIssue the mutator
// ============================================================================

import type { EquipmentInstance, EquipmentSlotType, GameState } from "./model";
import {
  DEFAULT_EQUIPMENT_VARIETY,
  EQUIPMENT_SLOTS,
  SI_EMITTER_CAP,
  SI_EMITTER_RECHARGE,
  SI_PLATING_HP,
  generateCombatStandardIssue,
  generateStandardIssue,
  isStandardIssueBaseline,
  startAutoSalvageGrace,
} from "./model";
// The weapon / drone id unions. Imported for their TYPES and for the two floor ids the
// catalogue names. quartermaster.ts is a leaf CONSUMER (nothing in model.ts or combat/
// imports it), so importing combat values here is safe and does not touch the repo-wide
// "model.ts never imports combat internals at runtime" rule. tick.ts does the same.
import type { WeaponId } from "./combat/weapons";
import type { DroneRole } from "./combat/drones";
// Reservation-awareness for the one-spare-per-slot gate below. Imported from
// reservation.ts and NOT from salvage.ts on purpose, the same reason equipment.ts records:
// salvage.ts imports from equipment.ts, so reaching for it from a sibling risks a cycle;
// reservation.ts is the leaf both sides already depend on.
import { salvageReservedInstanceIds } from "./reservation";

// ----------------------------------------------------------------------------
// RequisitionMint: HOW one catalogue row mints its baseline.
// ----------------------------------------------------------------------------
// There is no single "mint a Standard-Issue" call in the engine, and that is a real
// property of the data rather than an oversight, so this union mirrors it exactly:
//
//   economy        generateStandardIssue(slotType). Reads DEFAULT_EQUIPMENT_VARIETY +
//                  SLOT_BASE_PHYSICALS off the slot. Takes NOTHING per-hull.
//   shieldEmitter  generateCombatStandardIssue with the FIXED dials SI_EMITTER_CAP /
//                  SI_EMITTER_RECHARGE.
//   hullPlating    generateCombatStandardIssue with the FIXED dial SI_PLATING_HP.
//   weapon         generateCombatStandardIssue + a weaponType (the base WEAPON_DEF
//                  carries the real per-shot stats; the baseline's yield bonus is 0).
//   dronePod       generateCombatStandardIssue + a droneRole (the base ROLE_TEMPLATE
//                  carries the real per-drone stats; the baseline's droneHp bonus is 0).
//
// ⚠️ NONE OF THESE IS PER-HULL, AND THAT IS WHAT MAKES A FREE COUNTER POSSIBLE AT ALL.
// It was not always true: before the combat-defense rework (2026-08-27) the shield and
// plating magnitudes were resolved PER HULL by the caller, so "a Standard-Issue emitter"
// was not one object, it was seven. The rework moved each hull's defensive identity into
// its bare frame (innateHullArmor, additive) and its shield EFFECTIVENESS ratios, applied
// in the fold, and pinned the GEAR to fixed dials. So a requisitioned emitter is
// byte-identical to the one a destroyer was born with, and installing it on any hull
// reproduces that hull's own authored numbers. There are no per-ship variants to model.
export type RequisitionMint =
  | { kind: "economy" }
  | { kind: "shieldEmitter" }
  | { kind: "hullPlating" }
  | { kind: "weapon"; weaponType: WeaponId }
  | { kind: "dronePod"; droneRole: DroneRole };

// One catalogue row, before the player-facing label is resolved.
export interface RequisitionRow {
  // The name shown ONLY for a slot with no EQUIPMENT_SLOTS entry. The six slots that DO
  // have one take their label from there instead (see buildRequisitionEntries), so a slot
  // rename in the blessed table can never leave a stale name on this console. weapon and
  // droneBay mint through their own tables (WEAPON_DEFS / ROLE_TEMPLATE) and have no
  // EQUIPMENT_SLOTS entry at all, so their name lives here.
  fallbackLabel: string;
  // One line telling the player what the piece is FOR. Deliberately stat-free: the
  // magnitudes are tunable data and printing them here would let a retune make this lie.
  blurb: string;
  mint: RequisitionMint;
}

// ----------------------------------------------------------------------------
// REQUISITION_CATALOGUE: the TOTAL Record over EquipmentSlotType.
// ----------------------------------------------------------------------------
// ⚠️ THIS IS WHERE TOTALITY IS ENFORCED, AND IT IS ENFORCED BY THE COMPILER, NOT BY A
// CONVENTION. The type is Record<EquipmentSlotType, RequisitionRow | null>, so adding a
// member to the EquipmentSlotType union is a COMPILE ERROR here until someone either
// gives it a row or writes an explicit null. That is the standing content-driven-UI rule
// in its strongest available form: the console renders REQUISITION_ENTRIES below, which
// is DERIVED from this map, so a new slot type surfaces a new requisition row with ZERO
// UI edits. An array of rows would have allowed a silent omission; this cannot.
//
// null means "this slot has NO Standard-Issue floor", which is the honest answer for the
// five reserved slots: they have no EQUIPMENT_SLOTS definition, no default variety and no
// generator, so generateStandardIssue would THROW for them. A counter cannot issue a part
// that does not exist. When one of them becomes real, replacing its null here is the
// whole UI change.
export const REQUISITION_CATALOGUE: Record<EquipmentSlotType, RequisitionRow | null> = {
  // --- The four ECONOMY floors. Each mints the slot's blessed DEFAULT_EQUIPMENT_VARIETY
  // baseline, stat-neutral by design (STANDARD_ISSUE_IMPLICIT_MAGNITUDE is 0), so a ship
  // wearing one resolves missions identically to a bare hull. Free is therefore not a
  // balance question for these four: they hand out zero power. A test asserts every
  // DEFAULT_EQUIPMENT_VARIETY key has a row here, so the blessed floor set and this
  // catalogue cannot drift apart.
  cargoBay: {
    fallbackLabel: "Cargo Bay",
    blurb: "The hold. Standard-Issue carries no bonus and no mass, so a ship flies exactly as a bare hull does.",
    mint: { kind: "economy" },
  },
  ftlDrive: {
    fallbackLabel: "FTL Drive",
    blurb: "Propulsion. The baseline keeps the slot filled without changing transit speed or fuel burn.",
    mint: { kind: "economy" },
  },
  reactorCore: {
    fallbackLabel: "Reactor Core",
    blurb: "The power plant. A stat-neutral floor, there so the slot is never bare.",
    mint: { kind: "economy" },
  },
  specUtility: {
    fallbackLabel: "Prospecting Rig",
    blurb: "The specialization slot. Issued as the neutral Yield Rig; it fits a prospecting captain on a prospector hull.",
    mint: { kind: "economy" },
  },

  // --- The two DEFENSIVE COMBAT floors. Unlike the economy four these are NOT
  // stat-neutral, and issuing them free is the deliberate call this facility exists to
  // make. The alternative (charge for them, or refuse them) recreates exactly the
  // soft-block the Quartermaster was built to remove: canDispatchPatrol blocks a patrol
  // with an empty shield or plating slot, so a player who lost both baselines would be
  // grounded. The blocker's purpose is "do not fly naked", not "grind for a floor", and a
  // free floor leaves it doing precisely its job. What they grant is the hull's OWN
  // pre-gear numbers and not one point more (the fold multiplies the emitter's fixed dial
  // by the hull's effectiveness ratio and ADDS the plating's fixed floor to the bare
  // frame), so nobody gains power by shopping here: they only get back to zero.
  shieldEmitters: {
    fallbackLabel: "Shield Emitter",
    blurb: "The ship's only shield source. Restores the hull's own baseline screen, nothing beyond it.",
    mint: { kind: "shieldEmitter" },
  },
  hullPlating: {
    fallbackLabel: "Hull Plating",
    blurb: "Armor. Restores the hull's baseline plating; a patrol will not launch without it.",
    mint: { kind: "hullPlating" },
  },

  // --- The WEAPON floor. A hardpoint needs a gun before a patrol will launch.
  //
  // ⚠️ THE AUTOCANNON SPECIFICALLY, AND THE CHOICE IS LOAD-BEARING. A Standard-Issue
  // weapon's per-shot stats come ENTIRELY from its base WEAPON_DEF (the baseline's own
  // yield bonus is 0), so a free "Standard-Issue Railgun" would be a free railgun. Handing
  // the whole nine-weapon roster out at 0 credits would retire the crafted-weapon reward
  // curve in one release. The autocannon is the roster's FLOOR gun: it is the sole gun
  // every economy hull is issued and the weakest raw-damage workhorse in the set, chosen
  // as the floor when the loadout table was widened to every hull. Issuing it keeps this a
  // counter that restores a floor rather than a shop that sells firepower. A test fences
  // the choice against COMBAT_DEFAULT_LOADOUT (it must still be the most widely issued
  // Standard-Issue gun), so a retune that moves the floor fails loudly here instead of
  // quietly making this row the wrong gun. Real guns belong on the Purchase tab, when that
  // tab gets its pricing and economy pass.
  weapon: {
    fallbackLabel: "Weapon (Standard-Issue Autocannon)",
    blurb: "The floor gun, the same one every hull is issued. A patrol needs at least one weapon installed.",
    mint: { kind: "weapon", weaponType: "autocannon" },
  },

  // --- The DRONE POD floor. A bay is OPTIONAL (no dispatch blocker names it), so this row
  // is not anti-softlock the way the three required slots are; it is here because a carrier
  // that loses its issued pod otherwise loses its built-in squadron permanently, which is
  // the same irrecoverable state by a quieter route. The ATTACK role for the same reason
  // the autocannon is the gun: it is the role the carrier is actually issued, the pod's
  // droneHp bonus is 0, and the base ROLE_TEMPLATE carries the stats, so this restores the
  // carrier's own default screen and nothing more. Defense and support pods stay a crafted
  // reward.
  droneBay: {
    fallbackLabel: "Drone Pod (Standard-Issue Attack)",
    blurb: "A carrier's built-in squadron. Optional: a ship patrols without one, a carrier fights better with it.",
    mint: { kind: "dronePod", droneRole: "attack" },
  },

  // --- RESERVED slots: no definition, no default variety, no generator, so NO floor
  // exists to issue. Explicit nulls rather than omissions, which is the entire point of
  // the total Record: each of these is a recorded decision the compiler will make someone
  // revisit when the slot becomes real.
  bridge: null,
  quarters: null,
  thrusters: null,
  sensor: null,
  propellantTanks: null,
};

// One requisition row as the CONSOLE reads it: the derived, display-ready shape.
export interface RequisitionEntry {
  slotType: EquipmentSlotType;
  label: string;
  blurb: string;
  mint: RequisitionMint;
}

// Build the ordered, display-ready list from the catalogue above. DERIVED, never a second
// hand-written list: the console iterates this, so a new catalogue row appears on screen
// with no UI edit and a row removed disappears the same way.
//
// ORDER is the catalogue's own key order (ES2015+ object key order is insertion order),
// which is deliberate and readable: the four economy slots, then shields, plating, weapon,
// drone pod. Not sorted, because a sort by label would shuffle the list every time a slot
// is renamed.
//
// LABEL resolution is single-source wherever a source exists: the six slots with an
// EQUIPMENT_SLOTS entry take their label from THERE, so renaming a slot in the blessed
// table renames it here too. weapon and droneBay have no entry (they mint through
// WEAPON_DEFS / ROLE_TEMPLATE), so they fall back to the catalogue's own name.
function buildRequisitionEntries(): RequisitionEntry[] {
  const entries: RequisitionEntry[] = [];
  for (const key of Object.keys(REQUISITION_CATALOGUE)) {
    const slotType = key as EquipmentSlotType;
    const row = REQUISITION_CATALOGUE[slotType];
    if (row === null) continue; // no Standard-Issue floor for this slot: nothing to issue
    entries.push({
      slotType,
      label: EQUIPMENT_SLOTS[slotType]?.label ?? row.fallbackLabel,
      blurb: row.blurb,
      mint: row.mint,
    });
  }
  return entries;
}

// The list the Requisition tab renders. Built once at module load, like every other
// static table in this codebase.
export const REQUISITION_ENTRIES: readonly RequisitionEntry[] = buildRequisitionEntries();

// ----------------------------------------------------------------------------
// The typed refusal union. Mirrors EquipFitBlockReason / DispatchBlockReason: the gate
// returns a REASON, never a bare false, so the console can always say why. A requisition
// that quietly did nothing would be indistinguishable from a broken button.
// ----------------------------------------------------------------------------
export type RequisitionBlockReason =
  // The slot has no Standard-Issue floor (a reserved slot, or a bad key from a stale UI).
  | "noBaselineForSlot"
  // A free, uninstalled, unreserved baseline for this slot is ALREADY in the spare pool.
  // See the gate's comment for why this is the bound rather than the storage cap.
  | "alreadyHoldingOne";

// Every uninstalled Standard-Issue baseline of one slot that the player could actually
// INSTALL right now. Three filters, each load-bearing:
//   fittedToShipId === null  , an installed baseline is doing its job on a ship and is not
//                              a spare the player can put somewhere else.
//   isStandardIssueBaseline  , the STRICT predicate (blueprintKey null AND standard
//                              rarity), never blueprintKey alone: dev-granted radiant gear
//                              is also blueprint-less, and counting it here would refuse a
//                              requisition on the strength of an item that is not a floor.
//   not salvage-RESERVED     , a baseline already queued for teardown is spoken for. It
//                              cannot be installed, so treating it as "you already have
//                              one" would refuse the replacement for a piece that is on
//                              its way to being destroyed, which is the exact soft-block
//                              this facility exists to prevent.
export function freeSpareBaselinesFor(
  state: GameState,
  slotType: EquipmentSlotType
): EquipmentInstance[] {
  const reserved = salvageReservedInstanceIds(state);
  return state.equipment.filter(
    (piece) =>
      piece.fittedToShipId === null &&
      piece.slotType === slotType &&
      isStandardIssueBaseline(piece) &&
      !reserved.has(piece.id)
  );
}

// ----------------------------------------------------------------------------
// canRequisition: the gate.
// ----------------------------------------------------------------------------
// ⚠️ IT DELIBERATELY DOES NOT CONSULT equipmentAtCap, AND THIS IS THE ONE DECISION IN THIS
// FILE MOST WORTH READING BEFORE CHANGING IT.
//
// The spare-storage cap counts a specific set, stated by spareEquipmentCount (model.ts):
// unfitted AND blueprintKey !== null, i.e. spare CRAFTED systems. A Standard-Issue baseline
// is excluded BY DEFINITION, with the reason recorded at the cap itself: a baseline is the
// free slot floor, not collectible inventory, so it occupies no storage. Gating this action
// on equipmentAtCap would therefore be a FAKE gate: the thing being minted cannot move the
// number the gate reads, so the refusal would be unrelated to the state it named. Worse, it
// would reintroduce the softlock in a new place, refusing the anti-softlock refill precisely
// when a player's pool is full. The Salvage Bay already records this exact posture for the
// same reason ("THE ESCAPE VALVE IS INTACT: equipmentAtCap is NOT consulted"); requisition is
// the same class of escape valve, pointing the other way.
//
// BUT A FREE, CAP-EXEMPT MINT STILL NEEDS A BOUND, or state.equipment grows without limit
// on a held button and the save bloats. The bound is per slot: ONE free spare baseline of a
// given slot at a time. It reads as a rule rather than a number ("the counter issues a floor,
// it does not stock a warehouse"), it is the smallest bound that can never block recovery,
// and it makes the growth ceiling exactly the number of issuable slots.
//
// IT CANNOT BLOCK RECOVERY, which is the property that matters: the only way to be refused
// is to be holding an installable baseline for that very slot, and installing it immediately
// re-opens the requisition. A baseline queued for salvage does NOT count (see
// freeSpareBaselinesFor), so a player cannot be refused on the strength of a piece that is
// about to be destroyed.
export function canRequisition(
  state: GameState,
  slotType: EquipmentSlotType
): { ok: true } | { ok: false; reason: RequisitionBlockReason } {
  // Typed to include undefined deliberately: the Record is total over the union, but this
  // gate is also the BOUNDARY a UI (or a stale save, or a test) can reach with a string that
  // is not a live slot at all, and a runtime miss must be a stated refusal rather than a
  // crash. TypeScript alone would not admit the comparison without this annotation.
  const row: RequisitionRow | null | undefined = REQUISITION_CATALOGUE[slotType];
  if (row === undefined || row === null) return { ok: false, reason: "noBaselineForSlot" };
  if (freeSpareBaselinesFor(state, slotType).length > 0) {
    return { ok: false, reason: "alreadyHoldingOne" };
  }
  return { ok: true };
}

// Mint the baseline one catalogue row describes. Split out from the transform below so the
// "which generator, with which fixed dials" decision sits in ONE readable place and the
// transform stays about state.
//
// The dials are READ from model.ts (SI_EMITTER_CAP / SI_EMITTER_RECHARGE / SI_PLATING_HP)
// rather than repeated as literals here, so the 0.16.0 balance pass retunes the seeded
// baseline and the requisitioned one together and they can never diverge. Divergence is not
// theoretical: an emitter that did not provide EXACTLY the reference would break the
// byte-identity that keeps an SI ship's combat numbers equal to its authored hull values.
// EXHAUSTIVE over RequisitionMint (a switch with no default), so a new mint shape is a
// compile error here rather than a silent fall-through that mints nothing.
function mintForRow(
  slotType: EquipmentSlotType,
  mint: RequisitionMint,
  allocateId: () => string
): EquipmentInstance {
  switch (mint.kind) {
    case "economy":
      // The economy generator reads the slot's default variety and base physicals off the
      // slot definition, so the catalogue key IS the whole input.
      return generateStandardIssue({ slotType, fittedToShipId: null, allocateId });
    case "shieldEmitter":
      return generateCombatStandardIssue({
        slotType: "shieldEmitters",
        shieldCapacity: SI_EMITTER_CAP,
        shieldRecharge: SI_EMITTER_RECHARGE,
        fittedToShipId: null, // a requisitioned piece lands as a SPARE, never pre-installed
        allocateId,
      });
    case "hullPlating":
      return generateCombatStandardIssue({
        slotType: "hullPlating",
        hullStrength: SI_PLATING_HP,
        fittedToShipId: null,
        allocateId,
      });
    case "weapon":
      return generateCombatStandardIssue({
        slotType: "weapon",
        weaponType: mint.weaponType,
        fittedToShipId: null,
        allocateId,
      });
    case "dronePod":
      return generateCombatStandardIssue({
        slotType: "droneBay",
        droneRole: mint.droneRole,
        fittedToShipId: null,
        allocateId,
      });
  }
}

// ----------------------------------------------------------------------------
// requisitionStandardIssue: the mutator.
// ----------------------------------------------------------------------------
// Take one free Standard-Issue baseline for `slotType` into the spare pool.
//
// COSTS NOTHING. No credits, no materials, no time. That is the whole design: the counter's
// job is to make a missing floor an errand rather than a wall, and any price at all would
// reintroduce a state where a player cannot afford to be able to fly.
//
// ⚠️ IT STAMPS THE AUTO-SALVAGE GRACE WINDOW, exactly as every other mint site does
// (the Fabricator's mint in tick.ts, and both dev grants in App.svelte). Without the stamp a
// piece would be sweepable by the automation the instant it was issued, which with baselines
// now auto-salvageable means the counter could hand you something the rules take back before
// you reach the ship. The two Standard-Issue generators are clock-free on purpose (they run
// inside save migrations, where no clock exists), so the stamp is applied HERE, by the caller
// that does have a GameState and therefore a game clock. Game time, never Date.now(), for the
// reason startAutoSalvageGrace records: a wall-clock stamp would make protection depend on
// when a tick ran and break offline==live parity.
//
// ID ALLOCATION follows the one convention every mint site uses: "equip-" + nextEquipmentId,
// with the counter advanced in the SAME immutable transition, so two mints can never collide.
//
// NEVER A SILENT NO-OP: a refusal returns the untouched state AND a typed reason, so the
// console always has something to say.
export function requisitionStandardIssue(
  state: GameState,
  slotType: EquipmentSlotType
): { next: GameState; minted: EquipmentInstance | null; reason: RequisitionBlockReason | null } {
  const gate = canRequisition(state, slotType);
  if (!gate.ok) return { next: state, minted: null, reason: gate.reason };

  // The gate proved this row exists and is non-null.
  const row = REQUISITION_CATALOGUE[slotType]!;
  const mintedId = "equip-" + state.nextEquipmentId;
  const allocateId = () => mintedId;

  const piece = mintForRow(slotType, row.mint, allocateId);

  const stamped = startAutoSalvageGrace(piece, state.gameTimeSeconds);
  return {
    next: {
      ...state,
      equipment: [...state.equipment, stamped],
      nextEquipmentId: state.nextEquipmentId + 1,
    },
    minted: stamped,
    reason: null,
  };
}

// The player-facing sentence for each refusal. Lives here, beside the union it explains, so
// a new reason is a compile error in ONE place rather than a missing string discovered on
// screen. Total over the union (a switch with no default), which is the same exhaustiveness
// posture rarityIndex and the queue's block-reason text use.
export function requisitionBlockText(reason: RequisitionBlockReason): string {
  switch (reason) {
    case "noBaselineForSlot":
      return "There is no Standard-Issue pattern for that slot yet.";
    case "alreadyHoldingOne":
      return "You already hold a spare Standard-Issue for this slot. Install it, and the counter will issue another.";
  }
}

// Re-exported for the console's own cross-check and for tests: the blessed economy floor set
// this catalogue must cover. Named here so a reader of the Quartermaster can see WHERE the
// economy rows come from without chasing it into model.ts.
export const ECONOMY_FLOOR_SLOTS: readonly string[] = Object.keys(DEFAULT_EQUIPMENT_VARIETY);
