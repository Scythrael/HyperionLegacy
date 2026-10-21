// armory.ts — ITEM LIFECYCLE 0.13.6 (Phase 3, the Armory).
//
// The LOADOUT lifecycle. This increment covers create / rename / delete; install-into-a-loadout and
// check-out-to-a-ship land in later increments (they need the per-hull slot-set derivation and the
// fittedToShipId interplay). Every function here is PURE over GameState, the same posture as
// salvage.ts / homeDashboard.ts: no clock, no rng, so the tick and the UI share one source of truth
// and offline==live is never at risk.
//
// A loadout's `slots` records only FILLED slots (slot key -> committed EquipmentInstance id); an
// empty slot is simply absent. The slot SET a loadout offers is derived from its ship type at
// render / install time (a later increment), so create does not need to enumerate slots.
import type {
  AwayMember,
  GameState,
  GroundTeamLoadout,
  Loadout,
  MemberSlotType,
  ShipGroundTeam,
  ShipTypeKey,
  SquadLoadoutKit,
  EquipmentSlotType,
  EquipmentInstance,
} from "./model";
import { SHIP_TYPES, startAutoSalvageGrace, isSparePiece, isUninstalledPiece, memberVariety } from "./model";
// The DERIVED salvage reservation (0.13.9 hotfix): a piece a queued or in-flight salvage owns cannot
// be committed to a loadout, mirroring canFitEquipment. reservation.ts imports only model/inventory,
// so no cycle.
import { salvageReservedInstanceIds } from "./reservation";
// The SHARED on-mission lock (equipment.ts): a ship whose captain is on an active mission cannot have
// its fitment changed. Checkout / check-in reuse it so a loadout can never be swapped mid-mission (the
// user's balance-loophole guard). One-way import (equipment.ts does not import armory.ts), no cycle.
import { onMissionLock, pieceEquipRequirement } from "./equipment";
// E-MOD EM-2: the power install gate, read on the ship as the check-out would leave it.
import { installPowerShortfallBetween } from "./shipPower";
// Ground team loadouts (GO-17): the crew lock, the slot reader, the member wear rules. None of these modules
// imports armory.ts (only personnelRosters.ts and the UI do), so no cycle.
import { shipCrewLocked } from "./awayTeam";
import { cleanShipGroundTeams, GROUND_SQUAD_TYPES, type GroundSquadType } from "./groundTeamSlots";
import { DEFAULT_GROUND_TEAM_KIND } from "./groundComposition";
import { memberSlotCapacity, memberWornIndex, pieceWearableBy } from "./memberEquipment";
// Field Kits FKR-7: a loadout's per-member pack lands as that member's pack preference (groundTeams.ts never imports
// this module).
import { setMemberPack } from "./groundTeams";

// The base loadout count (design: a FLAT 25, talent-expandable). Derived through loadoutCap, the ONE
// reader, so a future loadout-count talent adds to it in exactly one place (content-driven rule).
export const BASE_LOADOUT_COUNT = 25;

export function loadoutCap(_state: GameState): number {
  // + a loadout-count Homeworld talent later; a flat 25 for now.
  return BASE_LOADOUT_COUNT;
}

// How many loadouts the Armory holds: ship loadouts AND ground team loadouts (GO-17, design 5.7: squad
// loadouts share the Armory capacity rule). The ONE count every cap check reads. Pure.
export function loadoutsUsed(state: GameState): number {
  return state.loadouts.length + (state.squadLoadouts?.length ?? 0);
}

export function canCreateLoadout(state: GameState): boolean {
  return loadoutsUsed(state) < loadoutCap(state);
}

// Create an empty loadout pinned to a ship type. Returns the new state + the new loadout id, or a
// same-ref no-op + null id on an invalid ship type or a full roster (the UI gates on canCreateLoadout
// but this stays safe if called anyway).
export function createLoadout(
  state: GameState,
  shipTypeKey: ShipTypeKey,
  name = "New Loadout"
): { next: GameState; loadoutId: string | null } {
  if (!(shipTypeKey in SHIP_TYPES)) return { next: state, loadoutId: null };
  if (!canCreateLoadout(state)) return { next: state, loadoutId: null };
  const id = `loadout-${state.nextLoadoutId}`;
  const loadout: Loadout = {
    id,
    name: name.trim() || "New Loadout",
    shipTypeKey,
    slots: {},
    checkedOutToShipId: null,
  };
  return {
    next: { ...state, loadouts: [...state.loadouts, loadout], nextLoadoutId: state.nextLoadoutId + 1 },
    loadoutId: id,
  };
}

// Rename a loadout. Ignores an all-whitespace name (a loadout is never nameless) and is a same-ref
// no-op if the loadout is missing or the name is unchanged.
export function renameLoadout(state: GameState, loadoutId: string, name: string): GameState {
  const trimmed = name.trim();
  if (!trimmed) return state;
  let changed = false;
  const loadouts = state.loadouts.map((l) => {
    if (l.id !== loadoutId || l.name === trimmed) return l;
    changed = true;
    return { ...l, name: trimmed };
  });
  return changed ? { ...state, loadouts } : state;
}

// Delete a loadout, returning any committed gear to the spare pool. REFUSED (same-ref no-op) while
// the loadout is checked out to a ship: check it in first, so a live-equipped set is never deleted
// out from under a ship. Atomic: the released gear's committedToLoadoutId is cleared in the SAME new
// state the loadout is removed in, so a system can neither be stranded nor duplicated.
export function deleteLoadout(state: GameState, loadoutId: string): GameState {
  const loadout = state.loadouts.find((l) => l.id === loadoutId);
  if (loadout === undefined) return state;
  if (loadout.checkedOutToShipId !== null) return state; // refuse while equipped
  const committedIds = new Set(
    Object.values(loadout.slots).filter((v): v is string => v !== null)
  );
  const equipment =
    committedIds.size === 0
      ? state.equipment
      : state.equipment.map((e) =>
          // committed -> free spare: clear the marker AND restart the auto-salvage grace window,
          // so a long-committed system is not queued for destruction the instant it is freed.
          committedIds.has(e.id)
            ? startAutoSalvageGrace({ ...e, committedToLoadoutId: undefined }, state.gameTimeSeconds)
            : e
        );
  return {
    ...state,
    loadouts: state.loadouts.filter((l) => l.id !== loadoutId),
    equipment,
  };
}

// ---------------------------------------------------------------------------
// SLOT-SET DERIVATION + install / uninstall
// ---------------------------------------------------------------------------

// A loadout's slot, DERIVED from its pinned ship type. Mirrors ShipSystemsPanel's own enumeration
// EXACTLY (weapon x weaponHardpoints [Offense]; shieldEmitters + hullPlating + droneBay x droneBays
// [Defense]; cargoBay/ftlDrive/reactorCore always + specUtility on every specialized (non-general) hull
// [Systems]) so a loadout never offers a slot a real hull of that type would not have.
export type LoadoutSlotDef = {
  key: string; // stable key in Loadout.slots ("cargoBay", "weapon0", "droneBay1", ...)
  slotType: EquipmentSlotType;
  index: number | null; // 0-based index for a MULTI slot (weapon / droneBay); null for a singleton
  group: "offense" | "defense" | "systems";
  label: string;
};

export function loadoutSlotDefsForShipType(shipTypeKey: ShipTypeKey): LoadoutSlotDef[] {
  const def = SHIP_TYPES[shipTypeKey];
  const defs: LoadoutSlotDef[] = [];
  const hardpoints = def?.weaponHardpoints ?? 0;
  for (let i = 0; i < hardpoints; i++) {
    defs.push({ key: `weapon${i}`, slotType: "weapon", index: i, group: "offense", label: `Hardpoint ${i + 1}` });
  }
  defs.push({ key: "shieldEmitters", slotType: "shieldEmitters", index: null, group: "defense", label: "Shield Emitter" });
  defs.push({ key: "hullPlating", slotType: "hullPlating", index: null, group: "defense", label: "Hull Plating" });
  const bays = def?.droneBays ?? 0;
  for (let i = 0; i < bays; i++) {
    defs.push({ key: `droneBay${i}`, slotType: "droneBay", index: i, group: "defense", label: `Drone Bay ${i + 1}` });
  }
  defs.push({ key: "cargoBay", slotType: "cargoBay", index: null, group: "systems", label: "Cargo Bay" });
  defs.push({ key: "ftlDrive", slotType: "ftlDrive", index: null, group: "systems", label: "FTL Drive" });
  defs.push({ key: "reactorCore", slotType: "reactorCore", index: null, group: "systems", label: "Reactor Core" });
  // E4d: every SPECIALIZED hull (prospector rigs, tactician Damage Control Suite, explorer Pathfinder
  // Suite) carries the Spec Utility slot; only the general Freighter has none. Mirrors ShipSystemsPanel's
  // hasSpecUtilitySlot. (A prospector hull's slot set is unchanged.)
  if (def !== undefined && def.spec !== "general") {
    defs.push({ key: "specUtility", slotType: "specUtility", index: null, group: "systems", label: "Spec Utility" });
  }
  return defs;
}

// The Armory install picker's candidate list for one slot type: free spares (isSparePiece: on no ship
// or member, not already committed) of that type that are NOT reserved for salvage (0.13.9 hotfix).
// Lives here, beside installIntoLoadout, so the picker and the engine agree on what can be committed.
// Locked pieces are still listed (as before); installIntoLoadout refuses them.
export function loadoutInstallCandidates(state: GameState, slotType: EquipmentSlotType): EquipmentInstance[] {
  const reserved = salvageReservedInstanceIds(state);
  return state.equipment.filter(
    (e) =>
      isSparePiece(e) &&
      e.slotType === slotType &&
      !reserved.has(e.id)
  );
}

// Install a spare rolled system into a loadout slot. Refused (same-ref no-op) unless: the loadout
// exists and is NOT checked out (editing a live-equipped loadout is a later increment, gated on the
// ship's mission state to close the mid-mission-swap loophole); the slot key is a real slot for the
// loadout's ship type; the instance is a free SPARE (isSparePiece: on no ship or member, not already
// committed), not locked, and not reserved for salvage; and its slotType matches the slot. Swapping a
// filled slot returns the previous system to the spare
// pool. Atomic: the committed marker moves in the SAME new state the loadout slot is written in.
export function installIntoLoadout(
  state: GameState,
  loadoutId: string,
  slotKey: string,
  instanceId: string
): GameState {
  const loadout = state.loadouts.find((l) => l.id === loadoutId);
  if (loadout === undefined || loadout.checkedOutToShipId !== null) return state;
  const slotDef = loadoutSlotDefsForShipType(loadout.shipTypeKey).find((d) => d.key === slotKey);
  if (slotDef === undefined) return state;
  const inst = state.equipment.find((e) => e.id === instanceId);
  if (inst === undefined) return state;
  // Not a free spare (fitted / already committed), OR LOCKED (0.13.6 favorite/lock split: a locked
  // piece is hands-off until unlocked, so it cannot be committed to a loadout either).
  if (!isSparePiece(inst) || inst.locked === true) return state;
  // RESERVED FOR SALVAGE (0.13.9 hotfix): the same guard canFitEquipment applies ("queuedForSalvage").
  // Committing a reserved piece left its queued (or auto) salvage entry alive; uninstalled from the
  // loadout later, the piece was a spare again and that stale entry could salvage it, skipping the
  // post-uninstall grace window. Cancel the salvage order first to free it.
  if (salvageReservedInstanceIds(state).has(instanceId)) return state;
  if (inst.slotType !== slotDef.slotType) return state; // wrong kind of system for this slot
  // E4d: the piece's HULL-CLASS gate (pieceEquipRequirement: a variety's own gate, else the slot's), the
  // same check canFitEquipment makes, against the loadout's pinned hull type. Before E4d the only gated
  // slot (specUtility) appeared only on prospector loadouts, whose rigs always passed; now a Damage
  // Control Suite must not be committed to a prospector (or explorer) loadout and then checked out onto a
  // hull it can never be installed on by hand.
  const hullReq = pieceEquipRequirement(inst)?.hullSpec;
  if (hullReq !== undefined && SHIP_TYPES[loadout.shipTypeKey]?.spec !== hullReq) return state;
  const prevId = loadout.slots[slotKey] ?? null;
  const equipment = state.equipment.map((e) => {
    if (e.id === instanceId) return { ...e, committedToLoadoutId: loadoutId };
    // The swapped-out system returns to the free pool: clear the marker + restart its grace.
    if (prevId !== null && e.id === prevId)
      return startAutoSalvageGrace({ ...e, committedToLoadoutId: undefined }, state.gameTimeSeconds);
    return e;
  });
  const loadouts = state.loadouts.map((l) =>
    l.id === loadoutId ? { ...l, slots: { ...l.slots, [slotKey]: instanceId } } : l
  );
  return { ...state, equipment, loadouts };
}

// Uninstall the system in a loadout slot, returning it to the spare pool. Refused while the loadout is
// checked out (same as install). Same-ref no-op if the loadout is missing or the slot is already empty.
export function uninstallFromLoadout(state: GameState, loadoutId: string, slotKey: string): GameState {
  const loadout = state.loadouts.find((l) => l.id === loadoutId);
  if (loadout === undefined || loadout.checkedOutToShipId !== null) return state;
  const instanceId = loadout.slots[slotKey];
  if (instanceId === undefined || instanceId === null) return state;
  const equipment = state.equipment.map((e) =>
    // committed -> free spare: clear the marker + restart the auto-salvage grace window.
    e.id === instanceId
      ? startAutoSalvageGrace({ ...e, committedToLoadoutId: undefined }, state.gameTimeSeconds)
      : e
  );
  const nextSlots = { ...loadout.slots };
  delete nextSlots[slotKey];
  const loadouts = state.loadouts.map((l) => (l.id === loadoutId ? { ...l, slots: nextSlots } : l));
  return { ...state, equipment, loadouts };
}

// ---------------------------------------------------------------------------
// CHECK OUT / CHECK IN (equip a ship from a loadout)
// ---------------------------------------------------------------------------

// Check a loadout OUT to a ship: the ship flies that set, and its own install screen locks (edit the
// loadout in the Armory instead). Refused (same-ref no-op) unless: the loadout + ship exist; the
// loadout is pinned to the ship's type; the loadout is not already checked out; the ship has no OTHER
// loadout checked out; and the ship is not on a mission (the no-mid-mission-swap guard). On checkout,
// the ship's prior MANUAL gear (fitted but uncommitted, including Standard-Issue baselines) returns to
// the spare pool, and the loadout's committed systems become fitted to the ship so equippedFor() reads
// the loadout's set unchanged. Atomic: all of that lands in the one new state.
//
// E-MOD EM-2 (user answers P1 / P2 2026-10-17): also refused when the WHOLE set, the loadout's own Reactor Core
// included, would leave the ship over its power budget (the same gate canFitEquipment applies, read on the ship as
// the check-out would leave it, pristine values; a ship already over budget may take a set that does not make it
// worse, user ruling 2026-10-21). loadoutCheckOutPowerShortfall names the power still needed, for the refusal text.
export function checkOutLoadout(state: GameState, loadoutId: string, shipId: string): GameState {
  const next = checkOutTransition(state, loadoutId, shipId);
  if (next === state) return state;
  return installPowerShortfallBetween(state, next, shipId) > 0 ? state : next;
}

// The power a check-out still needs (0 = the power gate lets it through, or the check-out is refused for another
// reason, or is a no-op). The Armory and the roster apply show it as "needs N more power". Pure.
export function loadoutCheckOutPowerShortfall(state: GameState, loadoutId: string, shipId: string): number {
  const next = checkOutTransition(state, loadoutId, shipId);
  return next === state ? 0 : installPowerShortfallBetween(state, next, shipId);
}

// The check-out with every rule BUT the power gate, for a caller that judges the gate itself on a LATER state: the
// roster apply (personnelRosters.ts) lands its officers and crew after the gear, so it judges the gate on the fully
// applied roster (their power efficiency included) and re-runs without the loadout when it fails. Every other caller
// uses checkOutLoadout. Same-ref no-op on a refusal. Pure.
export function checkOutLoadoutBeforePowerGate(state: GameState, loadoutId: string, shipId: string): GameState {
  return checkOutTransition(state, loadoutId, shipId);
}

// The check-out itself, every rule but the power gate (same-ref no-op on a refusal).
function checkOutTransition(state: GameState, loadoutId: string, shipId: string): GameState {
  const loadout = state.loadouts.find((l) => l.id === loadoutId);
  if (loadout === undefined || loadout.checkedOutToShipId !== null) return state;
  const ship = state.ships.find((s) => s.id === shipId);
  if (ship === undefined || ship.typeKey !== loadout.shipTypeKey) return state; // type must match the pin
  if (state.loadouts.some((l) => l.checkedOutToShipId === shipId)) return state; // ship already loadout-driven
  if (!onMissionLock(state, shipId).ok) return state; // no mid-mission swap
  const committedIds = new Set(Object.values(loadout.slots).filter((v): v is string => v !== null));
  const equipment = state.equipment.map((e) => {
    if (committedIds.has(e.id)) return { ...e, fittedToShipId: shipId }; // the loadout's set -> onto the ship
    // Prior MANUAL gear -> back to the spare pool, with its auto-salvage grace window RESTARTED
    // (0.13.6 fix). Otherwise a long-expired grace stamp would let auto-salvage queue the just-
    // displaced system on the next tick, the same swap-and-lose gap every uninstall route closes.
    if (e.fittedToShipId === shipId && e.committedToLoadoutId === undefined)
      return startAutoSalvageGrace({ ...e, fittedToShipId: null }, state.gameTimeSeconds);
    return e;
  });
  const loadouts = state.loadouts.map((l) => (l.id === loadoutId ? { ...l, checkedOutToShipId: shipId } : l));
  return { ...state, equipment, loadouts };
}

// Check a loadout back IN (un-equip it from its ship). The ship's slots go empty (uninstall restores
// nothing, per the allow-empty rule); the loadout's systems stay committed to the loadout, just no
// longer fitted. Refused while the ship is on a mission. Same-ref no-op if the loadout is missing or
// already available.
export function checkInLoadout(state: GameState, loadoutId: string): GameState {
  const loadout = state.loadouts.find((l) => l.id === loadoutId);
  if (loadout === undefined || loadout.checkedOutToShipId === null) return state;
  if (!onMissionLock(state, loadout.checkedOutToShipId).ok) return state; // no mid-mission un-equip
  const committedIds = new Set(Object.values(loadout.slots).filter((v): v is string => v !== null));
  const equipment =
    committedIds.size === 0
      ? state.equipment
      : state.equipment.map((e) => (committedIds.has(e.id) ? { ...e, fittedToShipId: null } : e));
  const loadouts = state.loadouts.map((l) => (l.id === loadoutId ? { ...l, checkedOutToShipId: null } : l));
  return { ...state, equipment, loadouts };
}

// ===========================================================================
// GROUND TEAM LOADOUTS (Ground Operations GO-17, reshapes E-CREW Task 18; design 5.7 + D25)
// ===========================================================================
//
// A GroundTeamLoadout (model.ts) is a named set of member KITS for one whole ground team: one kit per
// Security slot and one per Science slot, in slot order. Gear only: who is slotted stays a Personnel choice.
// The lifecycle mirrors the ship loadouts above, with the team in the ship's place:
//   create   snapshots what the team's SLOTTED members wear into kits (slot order) and COMMITS those pieces
//            to the new loadout (committedToLoadoutId). The members keep wearing them, so the new loadout is
//            born CHECKED OUT to that team (checkedOutTo), exactly like a checked-out ship loadout: committed
//            AND installed. A committed worn piece is edited in the Armory, never uninstalled by hand
//            (memberEquipment.ts occupantInLoadout).
//   check-in takes every piece of the loadout off whoever wears it (the pieces stay committed, resting in
//            the Armory) and clears checkedOutTo.
//   apply    installs the kits onto the slotted members of a team in slot order and checks the loadout out
//            to it. A piece that cannot install is SKIPPED AND REPORTED, never forced: missing, locked, a
//            squad that cannot wear it, a unique conflict, no implant slot, no member in the slot, no such
//            slot on this hull, or a slot held by another loadout's piece. A member's own (uncommitted) gear
//            leaves only in the slot types the kit actually installs into; everything else stays on.
// Ground team loadouts count against the SAME loadoutCap as ship loadouts (loadoutsUsed). Every change refuses
// while a ship involved is crew-locked (awayTeam.ts shipCrewLocked: a captain mission or an expedition), and
// every refusal returns the SAME state reference with a typed reason (groundLoadoutBlockText). Pure: no
// clock, no rng; nothing here runs on the tick, so combat and expedition outcomes are untouched.

// Why a ground team loadout action is refused (the whole action; nothing changes):
//   noLoadout      no ground team loadout has that id
//   noShip         no ship has that id
//   noSuchTeam     the ship fields no team at that index
//   onMission      a ship involved is crew-locked (the team's ship, the loadout's ship, or a wearer's ship)
//   atCap          the Armory is full (ship + ground team loadouts at loadoutCap); create only
//   teamHasLoadout the team already wears a loadout (check it in first); create and apply
//   checkedOut     the loadout is already worn by a team (check it in first); apply only
//   notCheckedOut  the loadout already rests in the Armory; check-in only
//   wrongKind      the loadout was saved for another team kind (Ground / Strike / Survey); apply only
export type GroundLoadoutBlockReason =
  | "noLoadout"
  | "noShip"
  | "noSuchTeam"
  | "onMission"
  | "atCap"
  | "teamHasLoadout"
  | "checkedOut"
  | "notCheckedOut"
  | "wrongKind";

// Why ONE piece was skipped (the rest of the action still goes through):
//   missing             apply: the piece is gone, no longer committed to this loadout, already installed
//                       somewhere, or not the kit field's slot type
//   locked              create / apply: the player's Lock flag (a locked piece is never committed or moved)
//   wrongTeam           apply: the slot's member's squad cannot wear it (memberEquipment.ts pieceWearableBy)
//   occupantInLoadout   apply: the member's slot holds a piece another loadout installed
//   uniqueEquippedElsewhere  apply: another piece of that unique-equipped variety is worn in the fleet (D11)
//   implantSlotsFull    apply: the member has fewer implant slots than the kit has implants
//   emptySlot           apply: no member sits in that slot
//   noSlot              apply: the team has fewer slots of that squad type than the loadout has kits
//   committedElsewhere  create: the worn piece already belongs to another loadout
export type GroundLoadoutSkipReason =
  | "missing"
  | "locked"
  | "wrongTeam"
  | "occupantInLoadout"
  | "uniqueEquippedElsewhere"
  | "implantSlotsFull"
  | "emptySlot"
  | "noSlot"
  | "committedElsewhere";

// One skipped piece: which kit (squad type + slot index, the kit lists' own indexing) and why.
export interface GroundLoadoutSkip {
  teamType: GroundSquadType;
  slotIndex: number;
  pieceId: string;
  reason: GroundLoadoutSkipReason;
}

export type GroundLoadoutRefusal = { ok: false; next: GameState; reason: GroundLoadoutBlockReason };

// create / apply: the new state, the loadout id, how many pieces were committed (create) or installed (apply),
// and every skipped piece in kit order (Security kits first, then Science; armor, weapon, tool, implants).
export type GroundLoadoutResult =
  | { ok: true; next: GameState; loadoutId: string; pieces: number; skipped: GroundLoadoutSkip[] }
  | GroundLoadoutRefusal;

export type GroundLoadoutCheckInResult = { ok: true; next: GameState } | GroundLoadoutRefusal;

// Player-facing text for a refusal. EXHAUSTIVE with no default (a new reason is a compile error until it has
// text). US English, install wording. Pure.
export function groundLoadoutBlockText(reason: GroundLoadoutBlockReason): string {
  switch (reason) {
    case "noLoadout":
      return "No longer in the Armory";
    case "noShip":
      return "No longer in the fleet";
    case "noSuchTeam":
      return "No such ground team";
    case "onMission":
      return "Ship is out on a mission";
    case "atCap":
      return "The Armory is full (delete a loadout first)";
    case "teamHasLoadout":
      return "This team already wears a loadout (check it in first)";
    case "checkedOut":
      return "A team is wearing this loadout (check it in first)";
    case "notCheckedOut":
      return "Already in the Armory";
    case "wrongKind":
      return "Saved for a different team type";
  }
}

// Player-facing text for a skipped piece. EXHAUSTIVE with no default. Pure.
export function groundLoadoutSkipText(reason: GroundLoadoutSkipReason): string {
  switch (reason) {
    case "missing":
      return "No longer in this loadout";
    case "locked":
      return "Locked (unlock it first)";
    case "wrongTeam":
      return "This squad cannot use this gear";
    case "occupantInLoadout":
      return "The installed piece belongs to another loadout (check that loadout in first)";
    case "uniqueEquippedElsewhere":
      return "Unique: only one can be installed in the whole fleet";
    case "implantSlotsFull":
      return "Not enough implant slots";
    case "emptySlot":
      return "No member in this slot";
    case "noSlot":
      return "This team has fewer slots than the loadout";
    case "committedElsewhere":
      return "Committed to another loadout";
  }
}

// The kit fields that hold one piece each, with the member slot each one maps to.
const KIT_SINGLETONS = [
  ["armor", "memberArmor"],
  ["weapon", "memberWeapon"],
  ["tool", "memberTool"],
] as const;

const emptyKit = (): SquadLoadoutKit => ({ armor: null, weapon: null, tool: null, implants: [] });

// A kit's pieces in kit order (armor, weapon, tool, then implants) with the slot type each field expects.
function kitEntries(kit: SquadLoadoutKit): { pieceId: string; slotType: MemberSlotType }[] {
  const out: { pieceId: string; slotType: MemberSlotType }[] = [];
  for (const [field, slotType] of KIT_SINGLETONS) {
    const id = kit[field];
    if (id !== null) out.push({ pieceId: id, slotType });
  }
  for (const id of kit.implants) out.push({ pieceId: id, slotType: "implant" });
  return out;
}

// The team at (shipId, teamIndex) with its slots cleaned (cleanShipGroundTeams: an id that does not name a
// member aboard with the slot's squad type reads as an empty slot), or the refusal. Gate order: noShip,
// noSuchTeam, onMission. Pure.
function locateTeam(
  state: GameState,
  shipId: string,
  teamIndex: number
): { ok: true; team: ShipGroundTeam } | { ok: false; reason: GroundLoadoutBlockReason } {
  const ship = state.ships.find((s) => s.id === shipId);
  if (ship === undefined) return { ok: false, reason: "noShip" };
  const teams = cleanShipGroundTeams(ship, state.awayMembers);
  if (!Number.isInteger(teamIndex) || teamIndex < 0 || teamIndex >= teams.length) return { ok: false, reason: "noSuchTeam" };
  if (shipCrewLocked(state, shipId)) return { ok: false, reason: "onMission" };
  return { ok: true, team: teams[teamIndex] };
}

// Is some ground team loadout checked out to this team right now? Pure.
export function groundTeamWornLoadout(state: GameState, shipId: string, teamIndex: number): GroundTeamLoadout | null {
  return (
    (state.squadLoadouts ?? []).find(
      (l) => l.checkedOutTo !== null && l.checkedOutTo.shipId === shipId && l.checkedOutTo.teamIndex === teamIndex
    ) ?? null
  );
}

// Save what a ground team wears as a new loadout, worn by that team (see the section header). Gate order:
// noShip, noSuchTeam, onMission, teamHasLoadout, atCap. A worn piece that is locked or already committed to
// another loadout is left out of the kits (it stays on the member, uncommitted) and reported. A blank name
// reads "New Loadout" (the ship loadout default). Pure.
export function createGroundTeamLoadout(
  state: GameState,
  shipId: string,
  teamIndex: number,
  name: string
): GroundLoadoutResult {
  const refuse = (reason: GroundLoadoutBlockReason): GroundLoadoutRefusal => ({ ok: false, next: state, reason });
  const where = locateTeam(state, shipId, teamIndex);
  if (!where.ok) return refuse(where.reason);
  if (groundTeamWornLoadout(state, shipId, teamIndex) !== null) return refuse("teamHasLoadout");
  if (!canCreateLoadout(state)) return refuse("atCap");

  const id = `squad-${state.nextSquadLoadoutId}`;
  const worn = memberWornIndex(state); // each member's pieces in mint order (implants keep that order)
  const commit = new Set<string>();
  const skipped: GroundLoadoutSkip[] = [];
  const kitsFor = (teamType: GroundSquadType): SquadLoadoutKit[] =>
    where.team[teamType].map((memberId, slotIndex) => {
      const kit = emptyKit();
      if (memberId === null) return kit;
      const pieces = worn.get(memberId) ?? [];
      // Kit order: armor, weapon, tool, then implants (so the skip report reads in kit order).
      const ordered = [
        ...KIT_SINGLETONS.flatMap(([, slotType]) => pieces.filter((p) => p.slotType === slotType)),
        ...pieces.filter((p) => p.slotType === "implant"),
      ];
      for (const p of ordered) {
        if (p.committedToLoadoutId !== undefined) {
          skipped.push({ teamType, slotIndex, pieceId: p.id, reason: "committedElsewhere" });
          continue;
        }
        if (p.locked === true) {
          skipped.push({ teamType, slotIndex, pieceId: p.id, reason: "locked" });
          continue;
        }
        const field = KIT_SINGLETONS.find(([, slotType]) => slotType === p.slotType)?.[0];
        if (field !== undefined) kit[field] = p.id;
        else kit.implants.push(p.id);
        commit.add(p.id);
      }
      // Field Kits FKR-7 (FK4 "One per member"): the member's pack preference rides in the kit (a member on the
      // default carries no key, so a loadout saved with no preference keeps its exact shape).
      const pack = teamType === "security" ? where.team.packs?.[memberId] : undefined;
      if (pack) kit.consumables = { ...pack } as Record<string, number>;
      return kit;
    });
  const loadout: GroundTeamLoadout = {
    id,
    name: name.trim() || "New Loadout",
    kind: where.team.kind,
    security: kitsFor("security"),
    science: kitsFor("science"),
    checkedOutTo: { shipId, teamIndex },
  };
  return {
    ok: true,
    next: {
      ...state,
      equipment: commit.size === 0 ? state.equipment : state.equipment.map((e) => (commit.has(e.id) ? { ...e, committedToLoadoutId: id } : e)),
      squadLoadouts: [...(state.squadLoadouts ?? []), loadout],
      nextSquadLoadoutId: state.nextSquadLoadoutId + 1,
    },
    loadoutId: id,
    pieces: commit.size,
    skipped,
  };
}

// Install a resting loadout onto a team and check it out to that team (see the section header). Gate order:
// noLoadout, noShip, noSuchTeam, onMission, checkedOut, teamHasLoadout, wrongKind (a loadout with no kind is
// Ground). Then, per kit in slot order (Security, then Science), each piece is checked and installed or
// skipped; a member's own gear leaves (to storage, auto-salvage grace restarted) only in the slot types the
// kit installs into. The loadout is checked out to the team even when every piece was skipped, so its
// check-in stays the one way back. Pure.
export function applyGroundTeamLoadout(
  state: GameState,
  loadoutId: string,
  shipId: string,
  teamIndex: number
): GroundLoadoutResult {
  const refuse = (reason: GroundLoadoutBlockReason): GroundLoadoutRefusal => ({ ok: false, next: state, reason });
  const loadout = (state.squadLoadouts ?? []).find((l) => l.id === loadoutId);
  if (loadout === undefined) return refuse("noLoadout");
  const where = locateTeam(state, shipId, teamIndex);
  if (!where.ok) return refuse(where.reason);
  if (loadout.checkedOutTo !== null) return refuse("checkedOut");
  if (groundTeamWornLoadout(state, shipId, teamIndex) !== null) return refuse("teamHasLoadout");
  if ((loadout.kind ?? DEFAULT_GROUND_TEAM_KIND) !== where.team.kind) return refuse("wrongKind");

  // The working pool, updated as each kit lands, so a later kit sees an earlier one (a unique piece the
  // first member just put on blocks a second copy).
  const pool = new Map(state.equipment.map((e) => [e.id, e] as const));
  const members = new Map(state.awayMembers.map((m) => [m.id, m] as const));
  const skipped: GroundLoadoutSkip[] = [];
  let pieces = 0;
  // Field Kits FKR-7: the packs the loadout's Security kits carry, for the members now in those slots.
  const packs: Record<string, Record<string, number>> = {};
  for (const teamType of GROUND_SQUAD_TYPES) {
    const slots = where.team[teamType];
    loadout[teamType].forEach((kit, slotIndex) => {
      const entries = kitEntries(kit);
      const skip = (pieceId: string, reason: GroundLoadoutSkipReason) => skipped.push({ teamType, slotIndex, pieceId, reason });
      if (slotIndex >= slots.length) {
        for (const e of entries) skip(e.pieceId, "noSlot");
        return;
      }
      const memberId = slots[slotIndex];
      const member = memberId === null ? undefined : members.get(memberId);
      if (member === undefined) {
        for (const e of entries) skip(e.pieceId, "emptySlot");
        return;
      }
      if (teamType === "security" && kit.consumables) packs[member.id] = { ...kit.consumables };
      pieces += installKit(pool, member, entries, loadout.id, skip, state.gameTimeSeconds);
    });
  }
  // A kit with no pack leaves the member's preference as it is; a kit with one sets it (setMemberPack's cleaning).
  let withPacks = state;
  for (const [memberId, pack] of Object.entries(packs)) withPacks = setMemberPack(withPacks, shipId, teamIndex, memberId, pack);
  return {
    ok: true,
    next: {
      ...withPacks,
      equipment: state.equipment.map((e) => pool.get(e.id) ?? e),
      squadLoadouts: state.squadLoadouts.map((l) => (l.id === loadoutId ? { ...l, checkedOutTo: { shipId, teamIndex } } : l)),
    },
    loadoutId,
    pieces,
    skipped,
  };
}

// Install one kit onto one member inside the working pool; returns how many pieces went on. Order: (1) each
// piece's own checks (missing, locked, wrongTeam, a singleton slot held by another loadout's piece); (2) the
// member's own (uncommitted) pieces in the slot types the surviving pieces cover are marked to leave; (3) the
// unique-equipped rule against everything worn that is not leaving, and the implant cap against the implants
// staying; (4) the member's own pieces leave only in the slot types something actually installs into, and the
// kit's pieces go on. A piece that passes (3) only because a member's own copy leaves always installs, so that
// copy does leave: no rule is ever broken in between. Mutates only the passed working pool.
function installKit(
  pool: Map<string, EquipmentInstance>,
  member: AwayMember,
  entries: { pieceId: string; slotType: MemberSlotType }[],
  loadoutId: string,
  skip: (pieceId: string, reason: GroundLoadoutSkipReason) => void,
  now: number
): number {
  const wornNow = (): EquipmentInstance[] => [...pool.values()].filter((e) => e.fittedToMemberId === member.id);

  const candidates: EquipmentInstance[] = [];
  for (const { pieceId, slotType } of entries) {
    const p = pool.get(pieceId);
    if (p === undefined || p.committedToLoadoutId !== loadoutId || p.slotType !== slotType || !isUninstalledPiece(p)) {
      skip(pieceId, "missing");
      continue;
    }
    if (p.locked === true) {
      skip(pieceId, "locked");
      continue;
    }
    if (!pieceWearableBy(p, member.teamType)) {
      skip(pieceId, "wrongTeam");
      continue;
    }
    if (slotType !== "implant") {
      const occupant = wornNow().find((e) => e.slotType === slotType);
      if (occupant !== undefined && occupant.committedToLoadoutId !== undefined) {
        skip(pieceId, "occupantInLoadout");
        continue;
      }
    }
    candidates.push(p);
  }

  const ownIn = (types: Set<EquipmentSlotType>) =>
    new Set(wornNow().filter((e) => types.has(e.slotType) && e.committedToLoadoutId === undefined).map((e) => e.id));
  const mayLeave = ownIn(new Set(candidates.map((c) => c.slotType)));

  const installing: EquipmentInstance[] = [];
  let implantsStaying = wornNow().filter((e) => e.slotType === "implant" && !mayLeave.has(e.id)).length;
  const implantCap = memberSlotCapacity(member, "implant");
  for (const c of candidates) {
    if (memberVariety(c.slotType, c.moduleVariant ?? "")?.member.uniqueEquipped === true) {
      const clash =
        [...pool.values()].some(
          (e) =>
            e.id !== c.id &&
            !mayLeave.has(e.id) &&
            !!e.fittedToMemberId &&
            e.slotType === c.slotType &&
            e.moduleVariant === c.moduleVariant
        ) || installing.some((i) => i.slotType === c.slotType && i.moduleVariant === c.moduleVariant);
      if (clash) {
        skip(c.id, "uniqueEquippedElsewhere");
        continue;
      }
    }
    if (c.slotType === "implant") {
      if (implantsStaying >= implantCap) {
        skip(c.id, "implantSlotsFull");
        continue;
      }
      implantsStaying += 1;
    }
    installing.push(c);
  }

  for (const id of ownIn(new Set(installing.map((c) => c.slotType)))) {
    const e = pool.get(id) as EquipmentInstance;
    pool.set(id, startAutoSalvageGrace({ ...e, fittedToMemberId: null }, now));
  }
  for (const c of installing) pool.set(c.id, { ...c, fittedToMemberId: member.id });
  return installing.length;
}

// Take a worn loadout off its team: every piece of it comes off whoever wears it (even a member who moved to
// another team or ship since) and rests in the Armory, still committed. Gate order: noLoadout, notCheckedOut,
// onMission (the loadout's ship, or the ship of any member wearing one of its pieces). Pure.
export function checkInGroundTeamLoadout(state: GameState, loadoutId: string): GroundLoadoutCheckInResult {
  const refuse = (reason: GroundLoadoutBlockReason): GroundLoadoutRefusal => ({ ok: false, next: state, reason });
  const loadout = (state.squadLoadouts ?? []).find((l) => l.id === loadoutId);
  if (loadout === undefined) return refuse("noLoadout");
  if (loadout.checkedOutTo === null) return refuse("notCheckedOut");
  const wearing = state.equipment.filter((e) => e.committedToLoadoutId === loadoutId && !!e.fittedToMemberId);
  const ships = new Set<string>([loadout.checkedOutTo.shipId]);
  for (const e of wearing) {
    const shipOf = state.awayMembers.find((m) => m.id === e.fittedToMemberId)?.assignedShipId;
    if (shipOf) ships.add(shipOf);
  }
  if ([...ships].some((id) => shipCrewLocked(state, id))) return refuse("onMission");
  const off = new Set(wearing.map((e) => e.id));
  return {
    ok: true,
    next: {
      ...state,
      equipment: off.size === 0 ? state.equipment : state.equipment.map((e) => (off.has(e.id) ? { ...e, fittedToMemberId: null } : e)),
      squadLoadouts: state.squadLoadouts.map((l) => (l.id === loadoutId ? { ...l, checkedOutTo: null } : l)),
    },
  };
}

// Rename a ground team loadout (mirrors renameLoadout): trimmed, a blank name ignored, same ref when missing
// or unchanged. Allowed while worn (cosmetic). Pure.
export function renameGroundTeamLoadout(state: GameState, loadoutId: string, name: string): GameState {
  const trimmed = name.trim();
  if (!trimmed) return state;
  let changed = false;
  const squadLoadouts = (state.squadLoadouts ?? []).map((l) => {
    if (l.id !== loadoutId || l.name === trimmed) return l;
    changed = true;
    return { ...l, name: trimmed };
  });
  return changed ? { ...state, squadLoadouts } : state;
}

// Delete a resting ground team loadout (mirrors deleteLoadout): its committed pieces return to storage as free
// spares with their auto-salvage grace restarted. REFUSED (same ref) while a team wears it, or when missing.
// Pure.
export function deleteGroundTeamLoadout(state: GameState, loadoutId: string): GameState {
  const loadout = (state.squadLoadouts ?? []).find((l) => l.id === loadoutId);
  if (loadout === undefined || loadout.checkedOutTo !== null) return state;
  return {
    ...state,
    squadLoadouts: state.squadLoadouts.filter((l) => l.id !== loadoutId),
    equipment: state.equipment.map((e) =>
      e.committedToLoadoutId === loadoutId
        ? startAutoSalvageGrace({ ...e, committedToLoadoutId: undefined }, state.gameTimeSeconds)
        : e
    ),
  };
}
