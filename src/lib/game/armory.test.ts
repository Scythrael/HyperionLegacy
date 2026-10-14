// armory.test.ts — ITEM LIFECYCLE 0.13.6 (Phase 3). Loadout create / rename / delete mechanics.
import { describe, it, expect } from "vitest";
import { freshState, SHIP_TYPES, isSparePiece, AUTO_SALVAGE_RARITIES_NONE, AUTO_SALVAGE_GRACE_SECONDS_DEFAULT } from "./model";
import { salvageEquipment, selectAutoSalvageTargets } from "./salvage";
import { canFitEquipment } from "./equipment";
import { canFitToMember, fitToMember } from "./memberEquipment";
import { canStartSalvage } from "./tick";
import type {
  AwayMember, AwayTeamType, CaptainMissionState, CrewRace, EquipmentInstance, EquipmentSlotType, GameState,
  GroundTeamLoadout, ShipGroundTeam,
} from "./model";
import {
  createLoadout, renameLoadout, deleteLoadout, loadoutCap, canCreateLoadout,
  loadoutSlotDefsForShipType, installIntoLoadout, uninstallFromLoadout,
  checkOutLoadout, checkInLoadout, loadoutInstallCandidates,
  createGroundTeamLoadout, applyGroundTeamLoadout, checkInGroundTeamLoadout, renameGroundTeamLoadout,
  deleteGroundTeamLoadout, loadoutsUsed, groundLoadoutBlockText, groundLoadoutSkipText,
  type GroundLoadoutBlockReason, type GroundLoadoutSkipReason,
} from "./armory";

describe("armory: loadout create / rename / delete (Item Lifecycle 0.13.6)", () => {
  it("createLoadout appends an empty loadout pinned to the ship type and advances the id source", () => {
    const s = freshState();
    const { next, loadoutId } = createLoadout(s, "destroyer", "Reaper");
    expect(loadoutId).toBe(`loadout-${s.nextLoadoutId}`);
    expect(next.loadouts).toHaveLength(1);
    const lo = next.loadouts[0];
    expect(lo.id).toBe(loadoutId);
    expect(lo.name).toBe("Reaper");
    expect(lo.shipTypeKey).toBe("destroyer");
    expect(lo.slots).toEqual({}); // empty slots are absent, not pre-seeded
    expect(lo.checkedOutToShipId).toBeNull();
    expect(next.nextLoadoutId).toBe(s.nextLoadoutId + 1);
  });

  it("createLoadout refuses an invalid ship type (same ref, null id)", () => {
    const s = freshState();
    const { next, loadoutId } = createLoadout(s, "notAHull" as any);
    expect(next).toBe(s);
    expect(loadoutId).toBeNull();
  });

  it("createLoadout refuses when the roster is at the cap", () => {
    const cap = loadoutCap(freshState());
    const full: any = {
      ...freshState(),
      loadouts: Array.from({ length: cap }, (_, i) => ({
        id: `loadout-${i + 1}`, name: "x", shipTypeKey: "destroyer", slots: {}, checkedOutToShipId: null,
      })),
      nextLoadoutId: cap + 1,
    };
    expect(canCreateLoadout(full)).toBe(false);
    const { next, loadoutId } = createLoadout(full, "destroyer");
    expect(next).toBe(full);
    expect(loadoutId).toBeNull();
  });

  it("renameLoadout renames (trimmed); ignores an empty name; same ref when missing", () => {
    const { next } = createLoadout(freshState(), "destroyer", "Old");
    const id = next.loadouts[0].id;
    expect(renameLoadout(next, id, "  New Name  ").loadouts[0].name).toBe("New Name");
    expect(renameLoadout(next, id, "   ")).toBe(next); // empty -> no-op
    expect(renameLoadout(next, "nope", "X")).toBe(next); // missing -> no-op
  });

  it("deleteLoadout removes it and returns committed gear to the spare pool (committedToLoadoutId cleared)", () => {
    const base = freshState();
    const committed = { ...base.equipment[0], id: "equip-committed", fittedToShipId: null, committedToLoadoutId: "loadout-1" };
    const s: any = {
      ...base,
      equipment: [...base.equipment, committed],
      loadouts: [{ id: "loadout-1", name: "L", shipTypeKey: "destroyer", slots: { cargoBay: "equip-committed" }, checkedOutToShipId: null }],
      nextLoadoutId: 2,
    };
    const after = deleteLoadout(s, "loadout-1");
    expect(after.loadouts).toHaveLength(0);
    expect(after.equipment.find((e) => e.id === "equip-committed")!.committedToLoadoutId).toBeUndefined();
  });

  it("deleteLoadout refuses while the loadout is checked out (same ref)", () => {
    const s: any = {
      ...freshState(),
      loadouts: [{ id: "loadout-1", name: "L", shipTypeKey: "destroyer", slots: {}, checkedOutToShipId: "ship-1" }],
      nextLoadoutId: 2,
    };
    expect(deleteLoadout(s, "loadout-1")).toBe(s);
  });
});

describe("armory: slot derivation + install / uninstall (Item Lifecycle 0.13.6)", () => {
  it("loadoutSlotDefsForShipType matches the hull's SHIP_TYPES slots", () => {
    const defs = loadoutSlotDefsForShipType("destroyer");
    const dt = SHIP_TYPES.destroyer;
    expect(defs.filter((d) => d.slotType === "weapon")).toHaveLength(dt.weaponHardpoints);
    expect(defs.filter((d) => d.slotType === "droneBay")).toHaveLength(dt.droneBays ?? 0);
    expect(defs.some((d) => d.slotType === "shieldEmitters")).toBe(true);
    expect(defs.some((d) => d.slotType === "hullPlating")).toBe(true);
    expect(defs.some((d) => d.slotType === "cargoBay")).toBe(true);
    // E4d: every SPECIALIZED hull (prospector / tactician / explorer) carries the Spec Utility slot (the
    // tactician Damage Control Suite lives there); only the general Freighter has none.
    expect(defs.some((d) => d.slotType === "specUtility")).toBe(dt.spec !== "general");
    expect(loadoutSlotDefsForShipType("generalFreighter").some((d) => d.slotType === "specUtility")).toBe(false);
    expect(loadoutSlotDefsForShipType("orion").some((d) => d.slotType === "specUtility")).toBe(true);
  });

  it("a prospector-spec hull gets the specUtility slot", () => {
    expect(SHIP_TYPES.prospectorMiner.spec).toBe("prospector"); // guard the fixture
    expect(loadoutSlotDefsForShipType("prospectorMiner").some((d) => d.slotType === "specUtility")).toBe(true);
  });

  function stateWithSpareWeapon(): any {
    const base = freshState();
    const weapon = { ...base.equipment[0], id: "equip-wpn", slotType: "weapon", fittedToShipId: null, committedToLoadoutId: undefined };
    return {
      ...base,
      equipment: [...base.equipment, weapon],
      loadouts: [{ id: "loadout-1", name: "L", shipTypeKey: "destroyer", slots: {}, checkedOutToShipId: null }],
      nextLoadoutId: 2,
    };
  }

  it("installIntoLoadout commits a spare into a matching slot", () => {
    const after = installIntoLoadout(stateWithSpareWeapon(), "loadout-1", "weapon0", "equip-wpn");
    expect(after.loadouts[0].slots.weapon0).toBe("equip-wpn");
    expect(after.equipment.find((e) => e.id === "equip-wpn")!.committedToLoadoutId).toBe("loadout-1");
  });

  it("installIntoLoadout refuses wrong slotType, a bad slot key, a non-spare, and a checked-out loadout", () => {
    const s = stateWithSpareWeapon();
    expect(installIntoLoadout(s, "loadout-1", "cargoBay", "equip-wpn")).toBe(s); // weapon into a cargo slot
    expect(installIntoLoadout(s, "loadout-1", "weapon99", "equip-wpn")).toBe(s); // no such hardpoint
    const fittedId = s.equipment.find((e: any) => e.fittedToShipId !== null)!.id;
    expect(installIntoLoadout(s, "loadout-1", "weapon0", fittedId)).toBe(s); // not a free spare
    const co = { ...s, loadouts: [{ ...s.loadouts[0], checkedOutToShipId: "ship-1" }] };
    expect(installIntoLoadout(co, "loadout-1", "weapon0", "equip-wpn")).toBe(co); // checked out
  });

  it("installIntoLoadout refuses a LOCKED spare (0.13.6 favorite/lock split)", () => {
    const s = stateWithSpareWeapon();
    const locked = { ...s, equipment: s.equipment.map((e: any) => (e.id === "equip-wpn" ? { ...e, locked: true } : e)) };
    expect(installIntoLoadout(locked, "loadout-1", "weapon0", "equip-wpn")).toBe(locked); // locked, same ref
  });

  // A queued salvage order for equip-wpn, so the derived reservation (reservation.ts) owns it.
  function withWeaponQueuedForSalvage(s: any): any {
    return {
      ...s,
      processQueue: [
        {
          id: "q-1",
          facility: "salvageBay",
          order: { type: "salvage", target: { kind: "equipment", instanceId: "equip-wpn" }, mode: { kind: "batch", remaining: 1 } },
        },
      ],
    };
  }

  it("0.13.9: installIntoLoadout refuses a spare RESERVED for salvage (same ref)", () => {
    // Mirrors canFitEquipment's queuedForSalvage guard. Committing a reserved piece left its salvage
    // entry alive; once uninstalled from the loadout again, that stale entry could salvage it.
    const reserved = withWeaponQueuedForSalvage(stateWithSpareWeapon());
    expect(installIntoLoadout(reserved, "loadout-1", "weapon0", "equip-wpn")).toBe(reserved);
  });

  it("0.13.9: loadoutInstallCandidates lists free spares of the slot type, excluding reserved and committed pieces", () => {
    const s = stateWithSpareWeapon();
    expect(loadoutInstallCandidates(s, "weapon").map((e) => e.id)).toEqual(["equip-wpn"]);
    expect(loadoutInstallCandidates(withWeaponQueuedForSalvage(s), "weapon")).toEqual([]); // reserved
    const committed = { ...s, equipment: s.equipment.map((e: any) => (e.id === "equip-wpn" ? { ...e, committedToLoadoutId: "loadout-1" } : e)) };
    expect(loadoutInstallCandidates(committed, "weapon")).toEqual([]); // already in a loadout
    expect(loadoutInstallCandidates(s, "cargoBay").some((e) => e.id === "equip-wpn")).toBe(false); // wrong slot type
  });

  it("install then uninstall returns the system to the spare pool", () => {
    const installed = installIntoLoadout(stateWithSpareWeapon(), "loadout-1", "weapon0", "equip-wpn");
    const after = uninstallFromLoadout(installed, "loadout-1", "weapon0");
    expect(after.loadouts[0].slots.weapon0).toBeUndefined();
    expect(after.equipment.find((e) => e.id === "equip-wpn")!.committedToLoadoutId).toBeUndefined();
  });

  it("installIntoLoadout swaps: the previous system returns to the pool", () => {
    const s = stateWithSpareWeapon();
    const weapon2 = { ...s.equipment[0], id: "equip-wpn2", slotType: "weapon", fittedToShipId: null, committedToLoadoutId: undefined };
    const s2: any = { ...s, equipment: [...s.equipment, weapon2] };
    const first = installIntoLoadout(s2, "loadout-1", "weapon0", "equip-wpn");
    const swapped = installIntoLoadout(first, "loadout-1", "weapon0", "equip-wpn2");
    expect(swapped.loadouts[0].slots.weapon0).toBe("equip-wpn2");
    expect(swapped.equipment.find((e) => e.id === "equip-wpn2")!.committedToLoadoutId).toBe("loadout-1");
    expect(swapped.equipment.find((e) => e.id === "equip-wpn")!.committedToLoadoutId).toBeUndefined();
  });
});

describe("armory: check out / check in (Item Lifecycle 0.13.6)", () => {
  // A parked destroyer ship, a destroyer loadout holding one committed weapon, and one piece of
  // prior MANUAL gear fitted to that ship.
  function checkoutState(): any {
    const base = freshState();
    const ship = { ...base.ships[0], id: "ship-d", typeKey: "destroyer", assignedCaptainId: null };
    const committed = { ...base.equipment[0], id: "equip-committed", slotType: "weapon", fittedToShipId: null, committedToLoadoutId: "loadout-1" };
    const manual = { ...base.equipment[0], id: "equip-manual", slotType: "cargoBay", fittedToShipId: "ship-d", committedToLoadoutId: undefined };
    return {
      ...base,
      ships: [ship, ...base.ships.slice(1)],
      equipment: [...base.equipment, committed, manual],
      loadouts: [{ id: "loadout-1", name: "L", shipTypeKey: "destroyer", slots: { weapon0: "equip-committed" }, checkedOutToShipId: null }],
      nextLoadoutId: 2,
    };
  }

  it("checkOutLoadout fits the loadout's set, returns prior manual gear to the pool, and marks the ship", () => {
    const after = checkOutLoadout(checkoutState(), "loadout-1", "ship-d");
    expect(after.loadouts[0].checkedOutToShipId).toBe("ship-d");
    expect(after.equipment.find((e) => e.id === "equip-committed")!.fittedToShipId).toBe("ship-d");
    expect(after.equipment.find((e) => e.id === "equip-manual")!.fittedToShipId).toBeNull();
  });

  it("checkOutLoadout refuses a ship-type mismatch", () => {
    const s = checkoutState();
    const wrong = { ...s, loadouts: [{ ...s.loadouts[0], shipTypeKey: "carrier" }] };
    expect(checkOutLoadout(wrong, "loadout-1", "ship-d")).toBe(wrong);
  });

  it("checkOutLoadout refuses when the ship already has a loadout checked out", () => {
    const s = checkoutState();
    const busy = { ...s, loadouts: [s.loadouts[0], { id: "loadout-2", name: "X", shipTypeKey: "destroyer", slots: {}, checkedOutToShipId: "ship-d" }] };
    expect(checkOutLoadout(busy, "loadout-1", "ship-d")).toBe(busy);
  });

  it("checkOutLoadout refuses while the ship is on a mission", () => {
    const s = checkoutState();
    const cap = { ...s.captains[0], id: "cap-1", mission: { anything: true } };
    const onMission = { ...s, captains: [cap, ...s.captains.slice(1)], ships: [{ ...s.ships[0], assignedCaptainId: "cap-1" }, ...s.ships.slice(1)] };
    expect(checkOutLoadout(onMission, "loadout-1", "ship-d")).toBe(onMission);
  });

  it("checkInLoadout un-fits the set (ship empty) and clears the ship binding, keeping gear committed", () => {
    const out = checkOutLoadout(checkoutState(), "loadout-1", "ship-d");
    const back = checkInLoadout(out, "loadout-1");
    expect(back.loadouts[0].checkedOutToShipId).toBeNull();
    expect(back.equipment.find((e) => e.id === "equip-committed")!.fittedToShipId).toBeNull();
    expect(back.equipment.find((e) => e.id === "equip-committed")!.committedToLoadoutId).toBe("loadout-1");
  });
});

// 0.13.6 bug-sweep regressions: any route that returns a system to the FREE spare pool must
// restart its auto-salvage grace window, so a long-committed (or long-installed) system is never
// queued for destruction the instant it is freed. Committed gear that STAYS committed keeps its
// protection and does not need a fresh window.
describe("armory: freeing gear restarts the auto-salvage grace window (0.13.6 regressions)", () => {
  const NOW = 5000;

  it("checkOutLoadout restarts grace on the ship's displaced MANUAL gear", () => {
    const base = freshState();
    const ship = { ...base.ships[0], id: "ship-d", typeKey: "destroyer", assignedCaptainId: null };
    const manual: any = { ...base.equipment[0], id: "equip-manual", slotType: "cargoBay", fittedToShipId: "ship-d", committedToLoadoutId: undefined, graceStartedAtGameSeconds: 0 };
    const s: any = {
      ...base, gameTimeSeconds: NOW,
      ships: [ship, ...base.ships.slice(1)],
      equipment: [...base.equipment, manual],
      loadouts: [{ id: "loadout-1", name: "L", shipTypeKey: "destroyer", slots: {}, checkedOutToShipId: null }],
      nextLoadoutId: 2,
    };
    const after = checkOutLoadout(s, "loadout-1", "ship-d");
    const m = after.equipment.find((e: any) => e.id === "equip-manual")!;
    expect(m.fittedToShipId).toBeNull();
    expect(m.graceStartedAtGameSeconds).toBe(NOW); // restarted, not left stale at 0
  });

  it("uninstallFromLoadout frees the piece and restarts its grace window", () => {
    const base = freshState();
    const committed: any = { ...base.equipment[0], id: "equip-c", slotType: "weapon", fittedToShipId: null, committedToLoadoutId: "loadout-1", graceStartedAtGameSeconds: 0 };
    const s: any = {
      ...base, gameTimeSeconds: NOW,
      equipment: [...base.equipment, committed],
      loadouts: [{ id: "loadout-1", name: "L", shipTypeKey: "destroyer", slots: { weapon0: "equip-c" }, checkedOutToShipId: null }],
      nextLoadoutId: 2,
    };
    const c = uninstallFromLoadout(s, "loadout-1", "weapon0").equipment.find((e: any) => e.id === "equip-c")!;
    expect(c.committedToLoadoutId).toBeUndefined();
    expect(c.graceStartedAtGameSeconds).toBe(NOW);
  });

  it("deleteLoadout frees committed gear and restarts its grace window", () => {
    const base = freshState();
    const committed: any = { ...base.equipment[0], id: "equip-c", fittedToShipId: null, committedToLoadoutId: "loadout-1", graceStartedAtGameSeconds: 0 };
    const s: any = {
      ...base, gameTimeSeconds: NOW,
      equipment: [...base.equipment, committed],
      loadouts: [{ id: "loadout-1", name: "L", shipTypeKey: "destroyer", slots: { cargoBay: "equip-c" }, checkedOutToShipId: null }],
      nextLoadoutId: 2,
    };
    const c = deleteLoadout(s, "loadout-1").equipment.find((e: any) => e.id === "equip-c")!;
    expect(c.committedToLoadoutId).toBeUndefined();
    expect(c.graceStartedAtGameSeconds).toBe(NOW);
  });
});

// ===========================================================================
// GROUND TEAM LOADOUTS (Ground Operations GO-17 engine half, reshapes E-CREW Task 18)
// ===========================================================================

function gMember(id: string, teamType: AwayTeamType, shipId: string | null, race: CrewRace = "earthBorn"): AwayMember {
  return {
    id, teamType, spec: teamType === "science" ? "geology" : "offense", name: `Member ${id}`, race,
    gender: "female", rank: 1, traits: [], assignedShipId: shipId,
  };
}

function gPiece(id: string, slotType: EquipmentSlotType, moduleVariant: string, overrides: Partial<EquipmentInstance> = {}): EquipmentInstance {
  return {
    id, slotType, moduleVariant, rarity: "standard", ascension: "none", quality: 2, iLevel: 10, blueprintKey: "bp-test",
    implicitStats: {}, rolledStats: {}, mass: 0, powerDraw: 0, durabilityMax: 100, durability: 100, fittedToShipId: null,
    ...overrides,
  };
}

function gTeam(security: (string | null)[], science: (string | null)[], kind: ShipGroundTeam["kind"] = "ground"): ShipGroundTeam {
  return { kind, security, science, helpOthers: false };
}
const EMPTY_GROUND = (): ShipGroundTeam => gTeam([null, null, null], [null, null, null]);

const G_NOW = 9000;

// Two General Freighters (3 / 3 squads, Ground + Ground). ship-1 (captain 1, idle) team Alpha: m-s1, m-s2
// (Martian, 2 implant slots) in Security slots 0 / 1, m-c1 in Science slot 0. ship-2 (no captain) team
// Alpha: m-s3 and m-s4 in Security slots 0 / 2 (slot 1 empty), m-c2 in Science slot 0.
// Worn gear: m-s1 armor a1 / weapon w1 / tool t1 / implant i1 (Neural Backup); m-s2 weapon w2 / implants
// i2 + i3; m-c1 armor a3 / tool t3.
function gState(extra: EquipmentInstance[] = []): GameState {
  const base = freshState();
  return {
    ...base,
    gameTimeSeconds: G_NOW,
    ships: [
      { ...base.ships[0], id: "ship-1", typeKey: "generalFreighter", assignedCaptainId: 1, groundTeams: [gTeam(["m-s1", "m-s2", null], ["m-c1", null, null]), EMPTY_GROUND()] },
      { ...base.ships[0], id: "ship-2", typeKey: "generalFreighter", assignedCaptainId: null, groundTeams: [gTeam(["m-s3", null, "m-s4"], ["m-c2", null, null]), EMPTY_GROUND()] },
    ],
    captains: base.captains.map((c) => (c.id === 1 ? { ...c, mission: null } : c)),
    awayMembers: [
      gMember("m-s1", "security", "ship-1"),
      gMember("m-s2", "security", "ship-1", "martian"),
      gMember("m-c1", "science", "ship-1"),
      gMember("m-s3", "security", "ship-2"),
      gMember("m-s4", "security", "ship-2"),
      gMember("m-c2", "science", "ship-2"),
    ],
    equipment: [
      gPiece("a1", "memberArmor", "ballisticWeave", { fittedToMemberId: "m-s1" }),
      gPiece("w1", "memberWeapon", "pulseRifle", { fittedToMemberId: "m-s1" }),
      gPiece("t1", "memberTool", "stunGrenade", { fittedToMemberId: "m-s1" }),
      gPiece("i1", "implant", "neuralBackup", { fittedToMemberId: "m-s1" }),
      gPiece("w2", "memberWeapon", "scattergun", { fittedToMemberId: "m-s2" }),
      gPiece("i2", "implant", "dermalWeave", { fittedToMemberId: "m-s2" }),
      gPiece("i3", "implant", "reflexBooster", { fittedToMemberId: "m-s2" }),
      gPiece("a3", "memberArmor", "fieldSuit", { fittedToMemberId: "m-c1" }),
      gPiece("t3", "memberTool", "decryptor", { fittedToMemberId: "m-c1" }),
      ...extra,
    ],
    loadouts: [],
    squadLoadouts: [],
    nextSquadLoadoutId: 1,
    expeditions: [],
  };
}

const gById = (s: GameState, id: string) => s.equipment.find((e) => e.id === id)!;
const wornBy = (s: GameState, memberId: string) => s.equipment.filter((e) => e.fittedToMemberId === memberId).map((e) => e.id).sort();

function gMission(): CaptainMissionState {
  return { kind: "extraction", missionKey: "shortOreRun", phase: "transitOut", phaseProgressTicks: 0, cargo: {} as CaptainMissionState["cargo"], recalled: false };
}
const onCaptainMission = (s: GameState): GameState => ({ ...s, captains: s.captains.map((c) => (c.id === 1 ? { ...c, mission: gMission() } : c)) });
const onExpeditionShip = (s: GameState, shipId: string): GameState => ({ ...s, expeditions: [{ shipId } as GameState["expeditions"][number]] });

// Create from ship-1 Alpha then check it in: the kit set rests in the Armory, the members wear nothing.
function createdAndCheckedIn(s: GameState = gState()): { s: GameState; id: string } {
  const made = createGroundTeamLoadout(s, "ship-1", 0, "Assault");
  if (!made.ok) throw new Error(made.reason);
  const back = checkInGroundTeamLoadout(made.next, made.loadoutId);
  if (!back.ok) throw new Error(back.reason);
  return { s: back.next, id: made.loadoutId };
}

describe("ground team loadouts: create (GO-17)", () => {
  it("snapshots the slotted members' installed pieces into kits in slot order and commits them", () => {
    const s = gState();
    const r = createGroundTeamLoadout(s, "ship-1", 0, "  Assault  ");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.loadoutId).toBe("squad-1");
    expect(r.next.nextSquadLoadoutId).toBe(2);
    expect(r.pieces).toBe(9);
    expect(r.skipped).toEqual([]);
    const lo = r.next.squadLoadouts[0];
    expect(lo).toEqual({
      id: "squad-1",
      name: "Assault",
      kind: "ground",
      security: [
        { armor: "a1", weapon: "w1", tool: "t1", implants: ["i1"] },
        { armor: null, weapon: "w2", tool: null, implants: ["i2", "i3"] },
        { armor: null, weapon: null, tool: null, implants: [] },
      ],
      science: [
        { armor: "a3", weapon: null, tool: "t3", implants: [] },
        { armor: null, weapon: null, tool: null, implants: [] },
        { armor: null, weapon: null, tool: null, implants: [] },
      ],
      checkedOutTo: { shipId: "ship-1", teamIndex: 0 },
    });
    // Committed AND still worn: the team is wearing the loadout it just saved (like a checked-out ship loadout).
    for (const id of ["a1", "w1", "t1", "i1", "w2", "i2", "i3", "a3", "t3"]) {
      expect(gById(r.next, id).committedToLoadoutId).toBe("squad-1");
    }
    expect(wornBy(r.next, "m-s1")).toEqual(["a1", "i1", "t1", "w1"]);
    expect(s.squadLoadouts).toEqual([]); // input untouched
  });

  it("a blank name falls back to the default", () => {
    const r = createGroundTeamLoadout(gState(), "ship-1", 0, "   ");
    expect(r.ok && r.next.squadLoadouts[0].name).toBe("New Loadout");
  });

  it("skips (and reports) a locked piece and a piece committed to another loadout; they stay manual", () => {
    const s = gState();
    const tweaked: GameState = {
      ...s,
      equipment: s.equipment.map((e) =>
        e.id === "t1" ? { ...e, locked: true } : e.id === "w2" ? { ...e, committedToLoadoutId: "squad-9" } : e,
      ),
    };
    const r = createGroundTeamLoadout(tweaked, "ship-1", 0, "A");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.skipped).toEqual([
      { teamType: "security", slotIndex: 0, pieceId: "t1", reason: "locked" },
      { teamType: "security", slotIndex: 1, pieceId: "w2", reason: "committedElsewhere" },
    ]);
    expect(r.next.squadLoadouts[0].security[0].tool).toBeNull();
    expect(r.next.squadLoadouts[0].security[1].weapon).toBeNull();
    expect(gById(r.next, "t1").committedToLoadoutId).toBeUndefined();
    expect(gById(r.next, "w2").committedToLoadoutId).toBe("squad-9");
  });

  it("refusals return the SAME state: no ship, no team, team already wearing a loadout", () => {
    const s = gState();
    const expectRefused = (r: ReturnType<typeof createGroundTeamLoadout>, reason: GroundLoadoutBlockReason) => {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe(reason);
      return r.next;
    };
    expect(expectRefused(createGroundTeamLoadout(s, "ship-404", 0, "A"), "noShip")).toBe(s);
    expect(expectRefused(createGroundTeamLoadout(s, "ship-1", 5, "A"), "noSuchTeam")).toBe(s);
    expect(expectRefused(createGroundTeamLoadout(s, "ship-1", -1, "A"), "noSuchTeam")).toBe(s);
    const made = createGroundTeamLoadout(s, "ship-1", 0, "A");
    if (!made.ok) throw new Error("setup");
    expect(expectRefused(createGroundTeamLoadout(made.next, "ship-1", 0, "B"), "teamHasLoadout")).toBe(made.next);
  });
});

describe("ground team loadouts: check-in / apply (GO-17)", () => {
  it("check-in takes the kits off the members; they stay committed in the Armory", () => {
    const { s, id } = createdAndCheckedIn();
    expect(s.squadLoadouts[0].checkedOutTo).toBeNull();
    for (const pid of ["a1", "w1", "t1", "i1", "w2", "i2", "i3", "a3", "t3"]) {
      const p = gById(s, pid);
      expect(p.fittedToMemberId ?? null).toBeNull();
      expect(p.committedToLoadoutId).toBe(id);
      expect(isSparePiece(p)).toBe(false);
    }
  });

  it("ROUND TRIP: create, check in, apply to the same team restores the same kits on the same members", () => {
    const made = createGroundTeamLoadout(gState(), "ship-1", 0, "Assault");
    if (!made.ok) throw new Error("setup");
    const back = checkInGroundTeamLoadout(made.next, made.loadoutId);
    if (!back.ok) throw new Error("setup");
    const applied = applyGroundTeamLoadout(back.next, made.loadoutId, "ship-1", 0);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.pieces).toBe(9);
    expect(applied.skipped).toEqual([]);
    expect(applied.next.equipment).toEqual(made.next.equipment);
    expect(applied.next.squadLoadouts).toEqual(made.next.squadLoadouts);
  });

  it("applies onto another team in slot order: an empty slot's kit is skipped and reported, manual occupants go to storage", () => {
    const { s, id } = createdAndCheckedIn(gState([
      gPiece("w9", "memberWeapon", "pulseRifle", { fittedToMemberId: "m-s3" }),
      gPiece("a9", "memberArmor", "assaultHardsuit", { fittedToMemberId: "m-s4" }),
    ]));
    const r = applyGroundTeamLoadout(s, id, "ship-2", 0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Security slot 0 (m-s3) takes kit 0; the manual rifle w9 returns to storage with a fresh grace window.
    expect(wornBy(r.next, "m-s3")).toEqual(["a1", "i1", "t1", "w1"]);
    expect(isSparePiece(gById(r.next, "w9"))).toBe(true);
    expect(gById(r.next, "w9").graceStartedAtGameSeconds).toBe(G_NOW);
    // Security slot 1 is empty: kit 1's pieces stay in the Armory.
    expect(r.skipped).toEqual([
      { teamType: "security", slotIndex: 1, pieceId: "w2", reason: "emptySlot" },
      { teamType: "security", slotIndex: 1, pieceId: "i2", reason: "emptySlot" },
      { teamType: "security", slotIndex: 1, pieceId: "i3", reason: "emptySlot" },
    ]);
    expect(gById(r.next, "w2").fittedToMemberId ?? null).toBeNull();
    // Security slot 2 (m-s4) gets the empty kit 2: the manual armor a9 stays (the kit installs nothing there).
    expect(wornBy(r.next, "m-s4")).toEqual(["a9"]);
    expect(wornBy(r.next, "m-c2")).toEqual(["a3", "t3"]);
    expect(r.pieces).toBe(6);
    expect(r.next.squadLoadouts[0].checkedOutTo).toEqual({ shipId: "ship-2", teamIndex: 0 });
  });

  it("a member keeps manual gear in slot types the kit leaves empty", () => {
    const { s, id } = createdAndCheckedIn();
    // After the check-in m-s2 puts on armor by hand; kit 1 saved no armor, so it stays on.
    const dressed: GameState = { ...s, equipment: [...s.equipment, gPiece("a7", "memberArmor", "assaultHardsuit", { fittedToMemberId: "m-s2" })] };
    const r = applyGroundTeamLoadout(dressed, id, "ship-1", 0);
    expect(r.ok && wornBy(r.next, "m-s2")).toEqual(["a7", "i2", "i3", "w2"]);
  });

  it("UNIQUE CONFLICT: a Neural Backup worn elsewhere in the fleet is skipped with a reason, never forced", () => {
    const { s, id } = createdAndCheckedIn(gState([gPiece("nb-x", "implant", "neuralBackup", { fittedToMemberId: "m-s3" })]));
    const r = applyGroundTeamLoadout(s, id, "ship-1", 0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.skipped).toEqual([{ teamType: "security", slotIndex: 0, pieceId: "i1", reason: "uniqueEquippedElsewhere" }]);
    expect(groundLoadoutSkipText("uniqueEquippedElsewhere")).toBe("Unique: only one can be installed in the whole fleet");
    expect(gById(r.next, "i1").fittedToMemberId ?? null).toBeNull();
    expect(gById(r.next, "i1").committedToLoadoutId).toBe(id);
    expect(gById(r.next, "nb-x").fittedToMemberId).toBe("m-s3");
    expect(r.next.equipment.filter((e) => e.moduleVariant === "neuralBackup" && e.fittedToMemberId)).toHaveLength(1);
    expect(wornBy(r.next, "m-s1")).toEqual(["a1", "t1", "w1"]);
  });

  it("the member's OWN manual Neural Backup leaves in the same apply, so the kit's one installs", () => {
    const { s, id } = createdAndCheckedIn();
    const withOwn: GameState = { ...s, equipment: [...s.equipment, gPiece("nb-own", "implant", "neuralBackup", { fittedToMemberId: "m-s1" })] };
    const r = applyGroundTeamLoadout(withOwn, id, "ship-1", 0);
    expect(r.ok && r.skipped).toEqual([]);
    if (!r.ok) return;
    expect(wornBy(r.next, "m-s1")).toEqual(["a1", "i1", "t1", "w1"]);
    expect(isSparePiece(gById(r.next, "nb-own"))).toBe(true);
  });

  it("skips and reports missing, locked, wrong-team pieces and implants past the member's slots", () => {
    const { s: rested, id } = createdAndCheckedIn();
    // i1 locked after the save; t3 gone from storage; a Science-only implant planted in Security kit 0.
    const lo = rested.squadLoadouts[0];
    const planted: GroundTeamLoadout = { ...lo, security: [{ ...lo.security[0], implants: ["i1", "sa"] }, ...lo.security.slice(1)] };
    const s: GameState = {
      ...rested,
      squadLoadouts: [planted],
      equipment: [
        ...rested.equipment.filter((e) => e.id !== "t3").map((e) => (e.id === "i1" ? { ...e, locked: true } : e)),
        gPiece("sa", "implant", "synapticAccelerator", { committedToLoadoutId: id }),
      ],
      // ship-2 Alpha with m-s4 (Earth-born, 1 implant slot) moved into Security slot 1, so kit 1's 2 implants hit the cap.
      ships: rested.ships.map((sh) => (sh.id === "ship-2" ? { ...sh, groundTeams: [gTeam(["m-s3", "m-s4", null], ["m-c2", null, null]), EMPTY_GROUND()] } : sh)),
    };
    const r = applyGroundTeamLoadout(s, id, "ship-2", 0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.skipped).toEqual([
      { teamType: "security", slotIndex: 0, pieceId: "i1", reason: "locked" },
      { teamType: "security", slotIndex: 0, pieceId: "sa", reason: "wrongTeam" },
      { teamType: "security", slotIndex: 1, pieceId: "i3", reason: "implantSlotsFull" },
      { teamType: "science", slotIndex: 0, pieceId: "t3", reason: "missing" },
    ]);
    expect(wornBy(r.next, "m-s3")).toEqual(["a1", "t1", "w1"]);
    expect(wornBy(r.next, "m-s4")).toEqual(["i2", "w2"]);
    expect(wornBy(r.next, "m-c2")).toEqual(["a3"]);
  });

  it("a kit past the team's slot count is reported as noSlot", () => {
    const { s, id } = createdAndCheckedIn();
    const lo = s.squadLoadouts[0];
    const longer: GameState = {
      ...s,
      squadLoadouts: [{ ...lo, security: [...lo.security, { armor: null, weapon: "w7", tool: null, implants: [] }] }],
      equipment: [...s.equipment, gPiece("w7", "memberWeapon", "pulseRifle", { committedToLoadoutId: id })],
    };
    const r = applyGroundTeamLoadout(longer, id, "ship-1", 0);
    expect(r.ok && r.skipped).toEqual([{ teamType: "security", slotIndex: 3, pieceId: "w7", reason: "noSlot" }]);
  });

  it("never swaps out a piece another loadout installed (occupantInLoadout)", () => {
    const { s, id } = createdAndCheckedIn(gState([gPiece("w8", "memberWeapon", "pulseRifle", { fittedToMemberId: "m-s3", committedToLoadoutId: "squad-9" })]));
    const r = applyGroundTeamLoadout(s, id, "ship-2", 0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.skipped[0]).toEqual({ teamType: "security", slotIndex: 0, pieceId: "w1", reason: "occupantInLoadout" });
    expect(gById(r.next, "w8").fittedToMemberId).toBe("m-s3");
    expect(gById(r.next, "w1").fittedToMemberId ?? null).toBeNull();
  });

  it("refusals return the SAME state: no loadout, already checked out, team already wearing one, wrong team kind", () => {
    const made = createGroundTeamLoadout(gState(), "ship-1", 0, "A");
    if (!made.ok) throw new Error("setup");
    const out = made.next;
    const refused = (r: ReturnType<typeof applyGroundTeamLoadout>, reason: GroundLoadoutBlockReason, same: GameState) => {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe(reason);
      expect(r.next).toBe(same);
    };
    refused(applyGroundTeamLoadout(out, "squad-404", "ship-2", 0), "noLoadout", out);
    refused(applyGroundTeamLoadout(out, made.loadoutId, "ship-404", 0), "noShip", out);
    refused(applyGroundTeamLoadout(out, made.loadoutId, "ship-2", 9), "noSuchTeam", out);
    refused(applyGroundTeamLoadout(out, made.loadoutId, "ship-2", 0), "checkedOut", out);
    // A second loadout saved from ship-2 Alpha, checked in, then aimed at ship-1 Alpha (still wearing squad-1).
    const second = createGroundTeamLoadout(out, "ship-2", 0, "B");
    if (!second.ok) throw new Error("setup");
    const rested = checkInGroundTeamLoadout(second.next, second.loadoutId);
    if (!rested.ok) throw new Error("setup");
    refused(applyGroundTeamLoadout(rested.next, second.loadoutId, "ship-1", 0), "teamHasLoadout", rested.next);
    // A Strike loadout never applies to a Ground team.
    const strike: GameState = {
      ...rested.next,
      squadLoadouts: rested.next.squadLoadouts.map((l) => (l.id === second.loadoutId ? { ...l, kind: "strike" as const } : l)),
    };
    refused(applyGroundTeamLoadout(strike, second.loadoutId, "ship-2", 0), "wrongKind", strike);
    // Check-in of a loadout already in the Armory, or of no loadout.
    const r = checkInGroundTeamLoadout(rested.next, second.loadoutId);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("notCheckedOut");
    expect(r.next).toBe(rested.next);
    expect(checkInGroundTeamLoadout(rested.next, "squad-404").next).toBe(rested.next);
  });

  it("a loadout with no kind reads as Ground", () => {
    const { s, id } = createdAndCheckedIn();
    const legacy: GameState = { ...s, squadLoadouts: s.squadLoadouts.map(({ kind: _k, ...l }) => l) };
    expect(applyGroundTeamLoadout(legacy, id, "ship-1", 0).ok).toBe(true);
  });
});

describe("ground team loadouts: refused while the ship is on a mission (GO-17)", () => {
  it("create, apply and check-in all refuse on a crew-locked ship (captain mission or expedition), same state", () => {
    const locked = onCaptainMission(gState());
    const c = createGroundTeamLoadout(locked, "ship-1", 0, "A");
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.reason).toBe("onMission");
    expect(c.next).toBe(locked);

    const { s, id } = createdAndCheckedIn();
    const expedition = onExpeditionShip(s, "ship-2");
    const a = applyGroundTeamLoadout(expedition, id, "ship-2", 0);
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.reason).toBe("onMission");
    expect(a.next).toBe(expedition);

    const made = createGroundTeamLoadout(gState(), "ship-1", 0, "A");
    if (!made.ok) throw new Error("setup");
    const lockedOut = onCaptainMission(made.next);
    const back = checkInGroundTeamLoadout(lockedOut, made.loadoutId);
    expect(back.ok).toBe(false);
    if (!back.ok) expect(back.reason).toBe("onMission");
    expect(back.next).toBe(lockedOut);
  });

  it("check-in refuses while a wearer sits on a crew-locked ship, even after moving off the loadout's ship", () => {
    const made = createGroundTeamLoadout(gState(), "ship-1", 0, "A");
    if (!made.ok) throw new Error("setup");
    // m-s1 (wearing kit 0) now aboard ship-2, which is out on an expedition.
    const moved: GameState = onExpeditionShip(
      { ...made.next, awayMembers: made.next.awayMembers.map((m) => (m.id === "m-s1" ? { ...m, assignedShipId: "ship-2" } : m)) },
      "ship-2",
    );
    const r = checkInGroundTeamLoadout(moved, made.loadoutId);
    expect(r.ok).toBe(false);
    expect(r.next).toBe(moved);
  });
});

describe("ground team loadouts: the shared loadout cap (GO-17)", () => {
  it("ship loadouts and ground team loadouts count against ONE loadoutCap", () => {
    const cap = loadoutCap(freshState());
    const s = gState();
    const shipLoadouts = Array.from({ length: cap - 1 }, (_, i) => ({
      id: `loadout-${i + 1}`, name: "x", shipTypeKey: "destroyer" as const, slots: {}, checkedOutToShipId: null,
    }));
    const almost: GameState = { ...s, loadouts: shipLoadouts, nextLoadoutId: cap };
    expect(loadoutsUsed(almost)).toBe(cap - 1);
    const made = createGroundTeamLoadout(almost, "ship-1", 0, "A");
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(loadoutsUsed(made.next)).toBe(cap);
    // Full now: neither kind can be created.
    expect(canCreateLoadout(made.next)).toBe(false);
    expect(createLoadout(made.next, "destroyer").next).toBe(made.next);
    const again = createGroundTeamLoadout(made.next, "ship-2", 0, "B");
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toBe("atCap");
    expect(again.next).toBe(made.next);
  });
});

describe("ground team loadouts: rename / delete + texts (GO-17)", () => {
  it("rename trims and ignores blanks; delete refuses while worn, then releases the kits to storage", () => {
    const made = createGroundTeamLoadout(gState(), "ship-1", 0, "A");
    if (!made.ok) throw new Error("setup");
    expect(renameGroundTeamLoadout(made.next, made.loadoutId, "  Breach  ").squadLoadouts[0].name).toBe("Breach");
    expect(renameGroundTeamLoadout(made.next, made.loadoutId, "  ")).toBe(made.next);
    expect(renameGroundTeamLoadout(made.next, "squad-404", "X")).toBe(made.next);
    expect(deleteGroundTeamLoadout(made.next, made.loadoutId)).toBe(made.next); // worn: refuse
    const back = checkInGroundTeamLoadout(made.next, made.loadoutId);
    if (!back.ok) throw new Error("setup");
    const gone = deleteGroundTeamLoadout(back.next, made.loadoutId);
    expect(gone.squadLoadouts).toEqual([]);
    for (const pid of ["a1", "w1", "i1", "t3"]) {
      expect(isSparePiece(gById(gone, pid))).toBe(true);
      expect(gById(gone, pid).graceStartedAtGameSeconds).toBe(G_NOW);
    }
    expect(gone.nextSquadLoadoutId).toBe(2); // ids are never reused
  });

  it("every block and skip reason has player-facing text, no em dashes, install wording", () => {
    const blocks: GroundLoadoutBlockReason[] = ["noShip", "noSuchTeam", "onMission", "noLoadout", "atCap", "teamHasLoadout", "checkedOut", "notCheckedOut", "wrongKind"];
    const skips: GroundLoadoutSkipReason[] = ["missing", "locked", "uniqueEquippedElsewhere", "wrongTeam", "implantSlotsFull", "emptySlot", "noSlot", "occupantInLoadout", "committedElsewhere"];
    for (const t of [...blocks.map(groundLoadoutBlockText), ...skips.map(groundLoadoutSkipText)]) {
      expect(t.length).toBeGreaterThan(0);
      expect(t.includes(String.fromCharCode(0x2014))).toBe(false); // no em dash
      expect(t.includes("-".repeat(2))).toBe(false);
      expect(t.toLowerCase()).not.toMatch(/\bfit|\btask/);
    }
  });
});

// The lifecycle invariant for squad-N pieces (GO-17 engine follow-up): a piece RESTING in a ground team
// loadout (committed, checked in, worn by nobody) is not a free spare, so every route that takes a spare
// refuses it or skips it, exactly as for a resting ship loadout's piece.
describe("ground team loadouts: resting pieces stay protected (GO-17)", () => {
  const RESTING = ["a1", "w1", "t1", "i1", "w2", "i2", "i3", "a3", "t3"];

  it("manual salvage refuses every resting piece as committed (same state)", () => {
    const { s } = createdAndCheckedIn();
    for (const id of RESTING) {
      const r = salvageEquipment(s, id, () => 0.5);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("committed");
      expect(r.next).toBe(s);
    }
  });

  it("a queued salvage order never starts on a resting piece", () => {
    const { s } = createdAndCheckedIn();
    const order = { type: "salvage" as const, target: { kind: "equipment" as const, instanceId: "w1" }, mode: { kind: "batch" as const, remaining: 1 } };
    expect(canStartSalvage(s, order)).toEqual({ ok: false, reason: "committed" });
  });

  it("auto-salvage never selects a resting piece, even with every quality and rarity eligible", () => {
    const { s } = createdAndCheckedIn(gState([gPiece("loose", "memberWeapon", "pulseRifle", { quality: 2, graceStartedAtGameSeconds: 0 })]));
    const eager: GameState = {
      ...s,
      gameTimeSeconds: G_NOW + 10 * AUTO_SALVAGE_GRACE_SECONDS_DEFAULT,
      salvageConfirmQualities: [],
      autoSalvage: {
        enabled: true,
        qualities: [0, 1, 2, 3, 4, 5],
        duplicates: false,
        keepPerVariety: 0,
        rarities: { ...AUTO_SALVAGE_RARITIES_NONE },
        graceSeconds: AUTO_SALVAGE_GRACE_SECONDS_DEFAULT,
      },
    };
    const ids = selectAutoSalvageTargets(eager, 1000).map((t) => (t.kind === "equipment" ? t.instanceId : t.kind));
    expect(ids).toContain("loose"); // the rules are live: a free spare IS taken
    for (const id of RESTING) expect(ids).not.toContain(id);
  });

  it("a ship install refuses a resting piece (member slot), and any piece carrying a squad-N commitment", () => {
    const { s, id: loadoutId } = createdAndCheckedIn();
    for (const id of RESTING) expect(canFitEquipment(s, "ship-2", id)).toEqual({ ok: false, reason: "slotNotInstallable" });
    // Defensive: even a SHIP-slot piece committed to a ground team loadout reads as committed, not free.
    const shipPiece = { ...freshState().equipment[0], id: "cargo-x", fittedToShipId: null, fittedToMemberId: null, committedToLoadoutId: loadoutId };
    const withShipPiece: GameState = { ...s, equipment: [...s.equipment, shipPiece] };
    expect(canFitEquipment(withShipPiece, "ship-2", "cargo-x")).toEqual({ ok: false, reason: "committedToLoadout" });
    expect(isSparePiece(shipPiece)).toBe(false);
  });

  it("a member install refuses a resting piece as committedToLoadout, and fitToMember throws", () => {
    const { s } = createdAndCheckedIn();
    expect(canFitToMember(s, "m-s3", "w1")).toEqual({ ok: false, reason: "committedToLoadout" });
    expect(canFitToMember(s, "m-c2", "a3")).toEqual({ ok: false, reason: "committedToLoadout" });
    expect(() => fitToMember(s, "m-s3", "w1")).toThrow(/committedToLoadout/);
  });
});
