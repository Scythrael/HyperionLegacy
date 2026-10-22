// S1 / S2 crew locks (0.14.0, docs/plans/2026-10-17-small-calls-answers.md, user 2026-10-17, both "Lock it
// (Recommended)"): "no captain moves onto or off a ship that is out" and "no ship gear changes while the ship is out
// (hand installs, Armory ship loadout check-out / check-in, roster loadout apply all use shipCrewLocked, not only the
// captain-mission lock)". Every ship gear change path and the captain move refuse (the same state back, or the
// engine's throw for an uninstall) for every way a ship can be out, name the real reason, and work again once the
// ship is home (the run ends, or the expedition is claimed).
import { describe, expect, it } from "vitest";
import type { GameState } from "./model";
import { canFitEquipment, fitEquipment, shipGearLock, unfitEquipment, unfitEquipmentInstance } from "./equipment";
import { checkInLoadout, checkOutLoadout } from "./armory";
import { assignShipToCaptain } from "./tick";
import { applyRoster, canApplyRoster, rosterApplyGateText } from "./personnelRosters";
import {
  captainMoveLock,
  captainMoveLockText,
  captainShipLocked,
  crewLockReason,
  crewLockReasonText,
  crewLockUntilText,
  shipCrewLocked,
  shipGearLockHint,
  shipGearLockReasonText,
  type CrewLockReason,
} from "./crewLock";
import { GEAR_LOCK_KINDS, GL_LOADOUT, GL_SPARE, gearLockFleet, lockShip, withLoadoutWorn, type GearLockKind } from "./shipGearLock.fixture";

const REASON: Record<GearLockKind, CrewLockReason> = {
  mission: "onMission",
  patrol: "onPatrol",
  shortRange: "onShortRange",
  expedition: "onExpedition",
  expeditionUnclaimed: "onExpedition",
};

const fittedCargoId = (s: GameState): string => s.equipment.find((e) => e.fittedToShipId === "ship-1" && e.slotType === "cargoBay")!.id;

// Home again: the captain's run ends (mission null) and every expedition is claimed (removed).
const home = (s: GameState): GameState => ({ ...s, captains: s.captains.map((c) => ({ ...c, mission: null })), expeditions: [] });

describe("S2: the one gear lock names every way a ship can be out", () => {
  for (const kind of GEAR_LOCK_KINDS) {
    it(`${kind}: crewLockReason and shipGearLock agree with shipCrewLocked`, () => {
      const s = lockShip(gearLockFleet(), kind);
      expect(shipCrewLocked(s, "ship-1")).toBe(true);
      expect(crewLockReason(s, "ship-1")).toBe(REASON[kind]);
      expect(shipGearLock(s, "ship-1")).toEqual({ ok: false, reason: "onMission", lock: REASON[kind] });
      expect(shipGearLock(s, "ship-2")).toBeNull();
    });
  }

  it("a home ship is unlocked and a missing ship reads noShip", () => {
    const s = gearLockFleet();
    expect(shipGearLock(s, "ship-1")).toBeNull();
    expect(shipGearLock(s, "ship-nope")).toEqual({ ok: false, reason: "noShip" });
  });

  it("the captain's run wins over an expedition (recall is the first step)", () => {
    const s = lockShip(lockShip(gearLockFleet(), "patrol"), "expedition");
    expect(crewLockReason(s, "ship-1")).toBe("onPatrol");
  });

  it("the words name the real reason, never 'captain is on a mission' for a non-mission", () => {
    expect(crewLockReasonText("onMission")).toBe("Ship is out on a mission");
    expect(crewLockReasonText("onPatrol")).toBe("Ship is out on a patrol");
    expect(crewLockReasonText("onShortRange")).toBe("Ship is on a short-range run");
    expect(crewLockReasonText("onExpedition")).toBe("Ship is on an expedition");
    expect(crewLockUntilText("onPatrol")).toBe("until it returns");
    expect(crewLockUntilText("onShortRange")).toBe("until it returns");
    expect(shipGearLockReasonText("onExpedition")).toBe("ship is on an expedition (gear locked until its expedition is claimed)");
    expect(shipGearLockReasonText("onShortRange")).toBe("ship is on a short-range run (gear locked until it returns)");
    expect(shipGearLockHint("onPatrol")).toBe("Ship is out on a patrol: its gear is locked until it returns");
    expect(captainMoveLockText("onExpedition")).toBe("Ship is on an expedition: captains stay aboard until its expedition is claimed");
    for (const r of ["onMission", "onPatrol", "onShortRange", "onExpedition"] as const) {
      for (const text of [crewLockReasonText(r), shipGearLockReasonText(r), shipGearLockHint(r), captainMoveLockText(r)]) {
        expect(text).not.toMatch(/captain is on a mission/i);
        expect(text.includes(String.fromCharCode(0x2014)) || text.includes("-".repeat(2))).toBe(false); // the text rules
      }
    }
  });
});

describe("S2: every ship gear change path refuses while the ship is out", () => {
  for (const kind of GEAR_LOCK_KINDS) {
    describe(kind, () => {
      it("hand install: canFitEquipment refuses with the reason, fitEquipment throws", () => {
        const s = lockShip(gearLockFleet(), kind);
        expect(canFitEquipment(s, "ship-1", GL_SPARE)).toEqual({ ok: false, reason: "onMission", lock: REASON[kind] });
        expect(() => fitEquipment(s, "ship-1", GL_SPARE)).toThrow(/onMission/);
        // Home again, the same install goes through.
        expect(canFitEquipment(home(s), "ship-1", GL_SPARE)).toEqual({ ok: true });
      });

      it("hand install into another ship that is home still works", () => {
        const s = lockShip(gearLockFleet(), kind);
        expect(canFitEquipment(s, "ship-2", GL_SPARE)).toEqual({ ok: true });
      });

      it("hand uninstall: unfitEquipmentInstance and the slot uninstall throw onMission", () => {
        const s = lockShip(gearLockFleet(), kind);
        expect(() => unfitEquipmentInstance(s, "ship-1", fittedCargoId(s))).toThrow(/blocked: onMission/);
        expect(() => unfitEquipment(s, "ship-1", "cargoBay")).toThrow(/blocked: onMission/);
        const back = home(s);
        expect(unfitEquipmentInstance(back, "ship-1", fittedCargoId(back))).not.toBe(back);
      });

      it("Armory check-out refuses (the same state), and works once home", () => {
        const s = lockShip(gearLockFleet(), kind);
        expect(checkOutLoadout(s, GL_LOADOUT, "ship-1")).toBe(s);
        const back = home(s);
        expect(checkOutLoadout(back, GL_LOADOUT, "ship-1")).not.toBe(back);
      });

      it("Armory check-in refuses (the same state), and works once home", () => {
        const worn = lockShip(withLoadoutWorn(gearLockFleet(), checkOutLoadout), kind);
        expect(checkInLoadout(worn, GL_LOADOUT)).toBe(worn);
        const back = home(worn);
        const out = checkInLoadout(back, GL_LOADOUT);
        expect(out).not.toBe(back);
        expect(out.loadouts.find((l) => l.id === GL_LOADOUT)!.checkedOutToShipId).toBeNull();
      });
    });
  }
});

describe("S2: the roster loadout apply refuses while the ship is out, naming the reason", () => {
  const withRoster = (s: GameState): GameState => ({
    ...s,
    personnelRosters: [
      { id: "roster-gl", name: "Gear Lock", linkedLoadoutId: GL_LOADOUT, includePeople: false, seatAssignments: {}, pinnedNotableCrew: [] },
    ],
  });
  for (const kind of GEAR_LOCK_KINDS) {
    it(kind, () => {
      const s = lockShip(withRoster(gearLockFleet()), kind);
      expect(canApplyRoster(s, "roster-gl", "ship-1")).toEqual({ ok: false, reason: "onMission", lockedShipId: "ship-1" });
      expect(applyRoster(s, "roster-gl", "ship-1")).toBe(s);
      expect(rosterApplyGateText(s, canApplyRoster(s, "roster-gl", "ship-1"))).toBe(crewLockReasonText(REASON[kind]));
      const back = home(s);
      expect(applyRoster(back, "roster-gl", "ship-1")).not.toBe(back);
    });
  }
});

describe("S1: no captain moves onto or off a ship that is out", () => {
  for (const kind of GEAR_LOCK_KINDS) {
    it(`${kind}: captain 1 cannot leave ship-1 for a parked ship`, () => {
      const s = lockShip(gearLockFleet(), kind);
      expect(captainShipLocked(s, 1)).toBe(true);
      expect(captainMoveLock(s, 1, "ship-2")).toEqual({ shipId: "ship-1", reason: REASON[kind] });
      const r = assignShipToCaptain(s, 1, "ship-2");
      expect(r.success).toBe(false);
      expect(r.next).toBe(s);
      // Home again, the swap goes through.
      const back = assignShipToCaptain(home(s), 1, "ship-2");
      expect(back.success).toBe(true);
    });
  }

  for (const kind of ["expedition", "expeditionUnclaimed"] as const) {
    it(`${kind}: no captain moves onto a parked ship that is out (a save from before S1 can hold one)`, () => {
      const s = lockShip(gearLockFleet(), kind, "ship-2");
      expect(captainShipLocked(s, 2)).toBe(false); // captain 2 has no ship
      expect(captainMoveLock(s, 2, "ship-2")).toEqual({ shipId: "ship-2", reason: "onExpedition" });
      const r = assignShipToCaptain(s, 2, "ship-2");
      expect(r.success).toBe(false);
      expect(r.next).toBe(s);
      expect(assignShipToCaptain(home(s), 2, "ship-2").success).toBe(true);
    });
  }

  it("an expedition on ANOTHER ship never locks a move between home ships", () => {
    const s = lockShip(gearLockFleet(), "expedition", "ship-2");
    // Captain 1 (ship-1, home) is not locked; a third parked hull takes them.
    const third: GameState = { ...s, ships: [...s.ships, { ...s.ships[1], id: "ship-3" }] };
    expect(captainMoveLock(third, 1, "ship-3")).toBeNull();
    expect(assignShipToCaptain(third, 1, "ship-3").success).toBe(true);
  });

  it("a captain with no ship moving onto a home parked ship is not locked", () => {
    const s = gearLockFleet();
    expect(captainShipLocked(s, 2)).toBe(false);
    expect(captainMoveLock(s, 2, "ship-2")).toBeNull();
    expect(assignShipToCaptain(s, 2, "ship-2").success).toBe(true);
  });
});
