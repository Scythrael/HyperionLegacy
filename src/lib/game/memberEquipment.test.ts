// E-CREW Task 8: installing gear on away-team MEMBERS (memberEquipment.ts) and the item-side install list.
//
// Covers the member install gate (every MemberFitBlockReason reachable, in gate order), the install / swap /
// uninstall mutators (singleton swap, targeted implant swap, auto-salvage grace on everything pooled), the
// fleet-wide unique-equipped rule (Neural Backup), the ship / member separation in both directions, the
// salvage + auto-salvage exclusion of worn pieces, firing a member, and installTargetsFor agreeing with the
// per-target predicates for both gear kinds. Nothing here exercises the tick or the UI.

import { describe, it, expect } from "vitest";
import {
  freshState,
  isSparePiece,
  AUTO_SALVAGE_RARITIES_NONE,
  AUTO_SALVAGE_GRACE_SECONDS_DEFAULT,
  EQUIPMENT_SLOTS,
} from "./model";
import type {
  AwayMember,
  AwayTeamType,
  CaptainMissionState,
  CrewRace,
  EquipmentInstance,
  EquipmentSlotType,
  GameState,
  QueuedJob,
} from "./model";
import {
  canFitToMember,
  fitToMember,
  canUnfitFromMember,
  unfitFromMember,
  memberEquipment,
  memberPieceInSlot,
  memberSlotPieces,
  memberSlotCapacity,
  installTargetsFor,
  memberFitBlockText,
  pieceWearableBy,
  memberWornIndex,
  type MemberFitBlockReason,
} from "./memberEquipment";
import { canFitEquipment } from "./equipment";
import { fireAwayMember } from "./awayTeam";
import { salvageEquipment, selectAutoSalvageTargets } from "./salvage";

// ===== fixtures =====

function member(id: string, teamType: AwayTeamType, shipId: string | null, race: CrewRace = "earthBorn"): AwayMember {
  return {
    id,
    teamType,
    spec: teamType === "science" ? "geology" : "offense",
    name: `Member ${id}`,
    race,
    gender: "female",
    rank: 1,
    traits: [],
    assignedShipId: shipId,
  };
}

// A crafted spare. Member pieces carry their stamped variety (moduleVariant), as generateEquipment mints them.
function piece(
  id: string,
  slotType: EquipmentSlotType,
  moduleVariant: string | undefined,
  overrides: Partial<EquipmentInstance> = {}
): EquipmentInstance {
  return {
    id,
    slotType,
    ...(moduleVariant !== undefined ? { moduleVariant } : {}),
    rarity: "standard",
    ascension: "none",
    quality: 2,
    iLevel: 10,
    blueprintKey: "bp-test",
    implicitStats: {},
    rolledStats: {},
    mass: 0,
    powerDraw: 0,
    durabilityMax: 100,
    durability: 100,
    fittedToShipId: null,
    ...overrides,
  };
}

function activeMission(): CaptainMissionState {
  return {
    kind: "extraction",
    missionKey: "shortOreRun",
    phase: "transitOut",
    phaseProgressTicks: 0,
    cargo: {} as CaptainMissionState["cargo"],
    recalled: false,
  };
}

// Two idle Destroyers: ship-a flown by captain 1, ship-b parked. Members:
//   m-sec   Security, Earth-born, ship-a (1 implant slot)
//   m-sci   Science, Earth-born, ship-a
//   m-mar   Security, Martian, ship-b (augment affinity: 2 implant slots)
//   m-bench Security, Earth-born, benched (assignedShipId null)
function state(equipment: EquipmentInstance[] = [], gameTimeSeconds = 500): GameState {
  const base = freshState();
  return {
    ...base,
    gameTimeSeconds,
    ships: [
      { ...base.ships[0], id: "ship-a", typeKey: "destroyer", assignedCaptainId: 1 },
      { ...base.ships[0], id: "ship-b", typeKey: "destroyer", assignedCaptainId: null },
    ],
    captains: base.captains.map((c) => (c.id === 1 ? { ...c, mission: null } : c)),
    awayMembers: [
      member("m-sec", "security", "ship-a"),
      member("m-sci", "science", "ship-a"),
      member("m-mar", "security", "ship-b", "martian"),
      member("m-bench", "security", null),
    ],
    equipment,
    expeditions: [],
  };
}

// Captain 1 on an active mission: crew-locks ship-a.
function onMission(s: GameState): GameState {
  return { ...s, captains: s.captains.map((c) => (c.id === 1 ? { ...c, mission: activeMission() } : c)) };
}

// ship-b out on an expedition: crew-locks ship-b (onMissionLock does not see expeditions; shipCrewLocked does).
function onExpedition(s: GameState): GameState {
  return { ...s, expeditions: [{ shipId: "ship-b" } as GameState["expeditions"][number]] };
}

function withQueuedSalvage(s: GameState, instanceId: string): GameState {
  const job: QueuedJob = {
    id: "q-1",
    facility: "salvageBay",
    order: { type: "salvage", target: { kind: "equipment", instanceId }, mode: { kind: "batch", remaining: 1 } },
  };
  return { ...s, processQueue: [...(s.processQueue ?? []), job] };
}

const byId = (s: GameState, id: string) => s.equipment.find((e) => e.id === id)!;

// ===== the gate =====

describe("canFitToMember", () => {
  it("allows a spare member piece whose variety lists the member's squad", () => {
    const s = state([piece("rifle", "memberWeapon", "pulseRifle"), piece("suit", "memberArmor", "fieldSuit")]);
    expect(canFitToMember(s, "m-sec", "rifle")).toEqual({ ok: true });
    expect(canFitToMember(s, "m-sci", "suit")).toEqual({ ok: true });
  });

  it("noInstance for an unknown piece", () => {
    expect(canFitToMember(state(), "m-sec", "nope")).toEqual({ ok: false, reason: "noInstance" });
  });

  it("notMemberSlot for ship gear", () => {
    const s = state([piece("cargo", "cargoBay", undefined)]);
    expect(canFitToMember(s, "m-sec", "cargo")).toEqual({ ok: false, reason: "notMemberSlot" });
  });

  it("queuedForSalvage for a piece a queued salvage owns", () => {
    const s = withQueuedSalvage(state([piece("rifle", "memberWeapon", "pulseRifle")]), "rifle");
    expect(canFitToMember(s, "m-sec", "rifle")).toEqual({ ok: false, reason: "queuedForSalvage" });
  });

  it("committedToLoadout for a piece committed to a loadout", () => {
    const s = state([piece("rifle", "memberWeapon", "pulseRifle", { committedToLoadoutId: "lo-1" })]);
    expect(canFitToMember(s, "m-sec", "rifle")).toEqual({ ok: false, reason: "committedToLoadout" });
  });

  it("locked for a locked piece", () => {
    const s = state([piece("rifle", "memberWeapon", "pulseRifle", { locked: true })]);
    expect(canFitToMember(s, "m-sec", "rifle")).toEqual({ ok: false, reason: "locked" });
  });

  it("notSpare for a piece another member (or this one) already wears", () => {
    const s = state([piece("rifle", "memberWeapon", "pulseRifle", { fittedToMemberId: "m-mar" })]);
    expect(canFitToMember(s, "m-sec", "rifle")).toEqual({ ok: false, reason: "notSpare" });
    expect(canFitToMember(s, "m-mar", "rifle")).toEqual({ ok: false, reason: "notSpare" });
  });

  it("noMember for an unknown member", () => {
    const s = state([piece("rifle", "memberWeapon", "pulseRifle")]);
    expect(canFitToMember(s, "m-404", "rifle")).toEqual({ ok: false, reason: "noMember" });
  });

  it("onMission while the member's ship is crew-locked (mission or expedition); benched members are never locked", () => {
    const s = state([piece("rifle", "memberWeapon", "pulseRifle")]);
    const mission = onMission(s);
    expect(canFitToMember(mission, "m-sec", "rifle")).toEqual({ ok: false, reason: "onMission" });
    expect(canFitToMember(mission, "m-mar", "rifle")).toEqual({ ok: true });
    expect(canFitToMember(mission, "m-bench", "rifle")).toEqual({ ok: true });
    const expedition = onExpedition(s);
    expect(canFitToMember(expedition, "m-mar", "rifle")).toEqual({ ok: false, reason: "onMission" });
    expect(canFitToMember(expedition, "m-sec", "rifle")).toEqual({ ok: true });
    expect(canFitToMember(onExpedition(mission), "m-bench", "rifle")).toEqual({ ok: true });
  });

  it("wrongTeam when the variety's squads exclude the member's, or the variety cannot be resolved", () => {
    const s = state([
      piece("sidearm", "memberWeapon", "sidearm"), // Science only
      piece("rifle", "memberWeapon", "pulseRifle"), // Security only
      piece("blank", "memberWeapon", undefined), // no stamped variety
      piece("retired", "memberWeapon", "retiredVariety"),
    ]);
    expect(canFitToMember(s, "m-sec", "sidearm")).toEqual({ ok: false, reason: "wrongTeam" });
    expect(canFitToMember(s, "m-sci", "rifle")).toEqual({ ok: false, reason: "wrongTeam" });
    expect(canFitToMember(s, "m-sci", "sidearm")).toEqual({ ok: true });
    expect(canFitToMember(s, "m-sec", "blank")).toEqual({ ok: false, reason: "wrongTeam" });
    expect(canFitToMember(s, "m-sec", "retired")).toEqual({ ok: false, reason: "wrongTeam" });
  });

  it("an occupied singleton slot is a swap, never a capacity refusal", () => {
    const s = state([
      piece("old", "memberWeapon", "pulseRifle", { fittedToMemberId: "m-sec" }),
      piece("new", "memberWeapon", "scattergun"),
    ]);
    expect(canFitToMember(s, "m-sec", "new")).toEqual({ ok: true });
    // Naming the occupant explicitly is the same swap.
    expect(canFitToMember(s, "m-sec", "new", "old")).toEqual({ ok: true });
  });

  it("replaceTargetInvalid for an unknown, self, foreign or other-slot replace target", () => {
    const s = state([
      piece("imp-old", "implant", "dermalWeave", { fittedToMemberId: "m-sec" }),
      piece("imp-mar", "implant", "reflexBooster", { fittedToMemberId: "m-mar" }),
      piece("rifle-worn", "memberWeapon", "pulseRifle", { fittedToMemberId: "m-sec" }),
      piece("imp-new", "implant", "targetingOptic"),
    ]);
    for (const target of ["nope", "imp-new", "imp-mar", "rifle-worn"]) {
      expect(canFitToMember(s, "m-sec", "imp-new", target)).toEqual({ ok: false, reason: "replaceTargetInvalid" });
    }
    expect(canFitToMember(s, "m-sec", "imp-new", "imp-old")).toEqual({ ok: true });
  });

  it("occupantInLoadout when the piece being swapped out is held by a loadout", () => {
    const s = state([
      piece("imp-old", "implant", "dermalWeave", { fittedToMemberId: "m-sec", committedToLoadoutId: "lo-1" }),
      piece("imp-new", "implant", "targetingOptic"),
      piece("rifle-old", "memberWeapon", "pulseRifle", { fittedToMemberId: "m-sec", committedToLoadoutId: "lo-1" }),
      piece("rifle-new", "memberWeapon", "scattergun"),
    ]);
    expect(canFitToMember(s, "m-sec", "imp-new", "imp-old")).toEqual({ ok: false, reason: "occupantInLoadout" });
    // A singleton occupant held by a loadout is not torn off by an implicit swap either.
    expect(canFitToMember(s, "m-sec", "rifle-new")).toEqual({ ok: false, reason: "occupantInLoadout" });
  });

  it("implantSlotsFull at the cap, unless a worn implant is named as the one to replace", () => {
    const s = state([
      piece("imp-1", "implant", "dermalWeave", { fittedToMemberId: "m-sec" }),
      piece("imp-2", "implant", "reflexBooster"),
    ]);
    expect(canFitToMember(s, "m-sec", "imp-2")).toEqual({ ok: false, reason: "implantSlotsFull" });
    expect(canFitToMember(s, "m-sec", "imp-2", "imp-1")).toEqual({ ok: true });
  });

  it("an augment-affinity race holds two implants, and refuses a third", () => {
    let s = state([
      piece("imp-1", "implant", "dermalWeave"),
      piece("imp-2", "implant", "reflexBooster"),
      piece("imp-3", "implant", "targetingOptic"),
    ]);
    s = fitToMember(s, "m-mar", "imp-1");
    expect(canFitToMember(s, "m-mar", "imp-2")).toEqual({ ok: true });
    s = fitToMember(s, "m-mar", "imp-2");
    expect(canFitToMember(s, "m-mar", "imp-3")).toEqual({ ok: false, reason: "implantSlotsFull" });
    expect(canFitToMember(s, "m-mar", "imp-3", "imp-2")).toEqual({ ok: true });
  });

  it("uniqueEquippedElsewhere: a second Neural Backup refuses on any member, any ship, or the bench", () => {
    const s = state([
      piece("nb-1", "implant", "neuralBackup", { fittedToMemberId: "m-mar" }), // on ship-b
      piece("nb-2", "implant", "neuralBackup"),
    ]);
    expect(canFitToMember(s, "m-sec", "nb-2")).toEqual({ ok: false, reason: "uniqueEquippedElsewhere" });
    expect(canFitToMember(s, "m-bench", "nb-2")).toEqual({ ok: false, reason: "uniqueEquippedElsewhere" });
    // The wearer cannot stack a second one either (it has a free implant slot, so only uniqueness refuses).
    expect(canFitToMember(s, "m-mar", "nb-2")).toEqual({ ok: false, reason: "uniqueEquippedElsewhere" });
  });

  it("swapping a worn Neural Backup for another Neural Backup on the SAME member is allowed", () => {
    const s = state([
      piece("nb-1", "implant", "neuralBackup", { fittedToMemberId: "m-mar" }),
      piece("nb-2", "implant", "neuralBackup"),
    ]);
    expect(canFitToMember(s, "m-mar", "nb-2", "nb-1")).toEqual({ ok: true });
    const next = fitToMember(s, "m-mar", "nb-2", "nb-1");
    expect(next.equipment.filter((e) => e.moduleVariant === "neuralBackup" && e.fittedToMemberId)).toHaveLength(1);
    expect(byId(next, "nb-2").fittedToMemberId).toBe("m-mar");
    expect(isSparePiece(byId(next, "nb-1"))).toBe(true);
  });

  it("a spare (unworn) Neural Backup does not block installing another one", () => {
    const s = state([piece("nb-1", "implant", "neuralBackup"), piece("nb-2", "implant", "neuralBackup")]);
    expect(canFitToMember(s, "m-sec", "nb-2")).toEqual({ ok: true });
  });

  it("precedence: an installed piece reports notSpare before committed or locked", () => {
    const s = state([
      piece("worn-locked", "memberWeapon", "pulseRifle", { fittedToMemberId: "m-mar", locked: true }),
      piece("on-ship", "memberWeapon", "pulseRifle", { fittedToShipId: "ship-a", committedToLoadoutId: "lo-1" }),
    ]);
    expect(canFitToMember(s, "m-sec", "worn-locked")).toEqual({ ok: false, reason: "notSpare" });
    expect(canFitToMember(s, "m-sec", "on-ship")).toEqual({ ok: false, reason: "notSpare" });
  });

  it("precedence: a resting piece that is committed AND locked reports committedToLoadout", () => {
    const s = state([piece("both", "memberWeapon", "pulseRifle", { committedToLoadoutId: "lo-1", locked: true })]);
    expect(canFitToMember(s, "m-sec", "both")).toEqual({ ok: false, reason: "committedToLoadout" });
  });

  it("precedence: wrongTeam beats a bad replace target", () => {
    const s = state([piece("sidearm", "memberWeapon", "sidearm")]);
    expect(canFitToMember(s, "m-sec", "sidearm", "nope")).toEqual({ ok: false, reason: "wrongTeam" });
  });

  it("precedence: a duplicate unique piece at a full implant cap reports uniqueEquippedElsewhere", () => {
    const s = state([
      piece("imp-worn", "implant", "dermalWeave", { fittedToMemberId: "m-sec" }), // m-sec's one slot is full
      piece("nb-worn", "implant", "neuralBackup", { fittedToMemberId: "m-mar" }),
      piece("nb-new", "implant", "neuralBackup"),
    ]);
    expect(canFitToMember(s, "m-sec", "nb-new")).toEqual({ ok: false, reason: "uniqueEquippedElsewhere" });
  });

  it("every block reason is reachable (exhaustive over MemberFitBlockReason)", () => {
    const base = state([
      piece("rifle", "memberWeapon", "pulseRifle"),
      piece("cargo", "cargoBay", undefined),
      piece("sidearm", "memberWeapon", "sidearm"),
      piece("worn", "memberWeapon", "pulseRifle", { fittedToMemberId: "m-mar" }),
      piece("imp-worn", "implant", "dermalWeave", { fittedToMemberId: "m-sec" }),
      piece("imp-new", "implant", "reflexBooster"),
      piece("nb-worn", "implant", "neuralBackup", { fittedToMemberId: "m-mar" }),
      piece("nb-new", "implant", "neuralBackup"),
      piece("committed", "memberWeapon", "pulseRifle", { committedToLoadoutId: "lo-1" }),
      piece("locked", "memberWeapon", "pulseRifle", { locked: true }),
      piece("held-armor", "memberArmor", "ballisticWeave", { fittedToMemberId: "m-bench", committedToLoadoutId: "lo-1" }),
      piece("armor-new", "memberArmor", "assaultHardsuit"),
    ]);
    const cases: Record<MemberFitBlockReason, () => ReturnType<typeof canFitToMember>> = {
      noInstance: () => canFitToMember(base, "m-sec", "nope"),
      notMemberSlot: () => canFitToMember(base, "m-sec", "cargo"),
      queuedForSalvage: () => canFitToMember(withQueuedSalvage(base, "rifle"), "m-sec", "rifle"),
      committedToLoadout: () => canFitToMember(base, "m-sec", "committed"),
      locked: () => canFitToMember(base, "m-sec", "locked"),
      notSpare: () => canFitToMember(base, "m-sec", "worn"),
      noMember: () => canFitToMember(base, "m-404", "rifle"),
      onMission: () => canFitToMember(onMission(base), "m-sec", "rifle"),
      wrongTeam: () => canFitToMember(base, "m-sec", "sidearm"),
      replaceTargetInvalid: () => canFitToMember(base, "m-sec", "imp-new", "nope"),
      occupantInLoadout: () => canFitToMember(base, "m-bench", "armor-new"),
      uniqueEquippedElsewhere: () => canFitToMember(base, "m-bench", "nb-new"),
      implantSlotsFull: () => canFitToMember(base, "m-sec", "imp-new"),
      notWornByMember: () => canUnfitFromMember(base, "m-sec", "rifle"),
    };
    for (const [reason, run] of Object.entries(cases)) {
      expect(run(), reason).toEqual({ ok: false, reason });
    }
  });

  it("never mutates its input", () => {
    const s = state([piece("rifle", "memberWeapon", "pulseRifle")]);
    const snapshot = structuredClone(s);
    canFitToMember(s, "m-sec", "rifle");
    canFitToMember(s, "m-sci", "rifle");
    expect(s).toEqual(snapshot);
  });
});

// ===== ship / member separation =====

describe("ship gear and member gear never cross", () => {
  it("canFitEquipment still refuses a member piece on a ship", () => {
    const s = state([piece("rifle", "memberWeapon", "pulseRifle"), piece("imp", "implant", "dermalWeave")]);
    expect(canFitEquipment(s, "ship-a", "rifle")).toEqual({ ok: false, reason: "slotNotInstallable" });
    expect(canFitEquipment(s, "ship-b", "imp")).toEqual({ ok: false, reason: "slotNotInstallable" });
  });

  it("canFitToMember refuses ship gear on a member", () => {
    const s = state([piece("cargo", "cargoBay", undefined), piece("gun", "weapon", undefined)]);
    expect(canFitToMember(s, "m-sec", "cargo")).toEqual({ ok: false, reason: "notMemberSlot" });
    expect(canFitToMember(s, "m-sec", "gun")).toEqual({ ok: false, reason: "notMemberSlot" });
  });
});

// ===== mutators =====

describe("fitToMember", () => {
  it("installs a spare on the member (fittedToMemberId set, no longer spare, ship field untouched)", () => {
    const s = state([piece("rifle", "memberWeapon", "pulseRifle")]);
    const next = fitToMember(s, "m-sec", "rifle");
    const worn = byId(next, "rifle");
    expect(worn.fittedToMemberId).toBe("m-sec");
    expect(worn.fittedToShipId).toBeNull();
    expect(isSparePiece(worn)).toBe(false);
    expect(memberEquipment(next, "m-sec").map((e) => e.id)).toEqual(["rifle"]);
  });

  it("throws with the reason token on a blocked install", () => {
    const s = state([piece("sidearm", "memberWeapon", "sidearm")]);
    expect(() => fitToMember(s, "m-sec", "sidearm")).toThrow(/wrongTeam/);
    expect(() => fitToMember(s, "m-sec", "sidearm", "x-1")).toThrow(
      "fitToMember blocked: wrongTeam (member m-sec, piece sidearm, replacing x-1)"
    );
    expect(() => fitToMember(onMission(s), "m-sci", "sidearm")).toThrow(/onMission/);
  });

  it("a singleton swap returns the old piece to storage with its auto-salvage grace restarted", () => {
    const s = state(
      [
        piece("old", "memberArmor", "ballisticWeave", { fittedToMemberId: "m-sec", graceStartedAtGameSeconds: 1 }),
        piece("new", "memberArmor", "assaultHardsuit"),
        piece("other", "memberArmor", "ballisticWeave", { fittedToMemberId: "m-mar" }),
      ],
      900
    );
    const next = fitToMember(s, "m-sec", "new");
    expect(next.equipment).toHaveLength(3); // nothing minted, nothing lost
    expect(byId(next, "new").fittedToMemberId).toBe("m-sec");
    const old = byId(next, "old");
    expect(old.fittedToMemberId).toBeNull();
    expect(isSparePiece(old)).toBe(true);
    expect(old.graceStartedAtGameSeconds).toBe(900);
    expect(byId(next, "other").fittedToMemberId).toBe("m-mar"); // another member's same slot untouched
    expect(memberPieceInSlot(next, "m-sec", "memberArmor")?.id).toBe("new");
  });

  it("the targeted implant swap is one transition: never over cap, nothing lost or duplicated", () => {
    const s = state(
      [
        piece("imp-old", "implant", "dermalWeave", { fittedToMemberId: "m-sec" }),
        piece("imp-new", "implant", "reflexBooster"),
      ],
      700
    );
    const next = fitToMember(s, "m-sec", "imp-new", "imp-old");
    expect(next.equipment).toHaveLength(2);
    expect(memberEquipment(next, "m-sec").map((e) => e.id)).toEqual(["imp-new"]);
    const old = byId(next, "imp-old");
    expect(isSparePiece(old)).toBe(true);
    expect(old.graceStartedAtGameSeconds).toBe(700);
  });

  it("installing an implant into a free slot leaves the other worn implant alone", () => {
    const s = state([
      piece("imp-1", "implant", "dermalWeave", { fittedToMemberId: "m-mar" }),
      piece("imp-2", "implant", "reflexBooster"),
    ]);
    const next = fitToMember(s, "m-mar", "imp-2");
    expect(memberEquipment(next, "m-mar").map((e) => e.id).sort()).toEqual(["imp-1", "imp-2"]);
  });

  it("never mutates its input", () => {
    const s = state([
      piece("old", "memberArmor", "ballisticWeave", { fittedToMemberId: "m-sec" }),
      piece("new", "memberArmor", "assaultHardsuit"),
    ]);
    const snapshot = structuredClone(s);
    const next = fitToMember(s, "m-sec", "new");
    expect(next).not.toBe(s);
    expect(s).toEqual(snapshot);
  });
});

describe("unfitFromMember / canUnfitFromMember", () => {
  it("returns the piece to storage with its auto-salvage grace restarted", () => {
    const s = state([piece("rifle", "memberWeapon", "pulseRifle", { fittedToMemberId: "m-sec" })], 1234);
    expect(canUnfitFromMember(s, "m-sec", "rifle")).toEqual({ ok: true });
    const next = unfitFromMember(s, "m-sec", "rifle");
    const back = byId(next, "rifle");
    expect(back.fittedToMemberId).toBeNull();
    expect(isSparePiece(back)).toBe(true);
    expect(back.graceStartedAtGameSeconds).toBe(1234);
    expect(memberEquipment(next, "m-sec")).toEqual([]);
  });

  it("refuses while the member's ship is crew-locked; a benched member is never locked", () => {
    const s = state([
      piece("rifle", "memberWeapon", "pulseRifle", { fittedToMemberId: "m-sec" }),
      piece("rifle-b", "memberWeapon", "pulseRifle", { fittedToMemberId: "m-mar" }),
      piece("rifle-bench", "memberWeapon", "pulseRifle", { fittedToMemberId: "m-bench" }),
    ]);
    const locked = onExpedition(onMission(s));
    expect(canUnfitFromMember(locked, "m-sec", "rifle")).toEqual({ ok: false, reason: "onMission" });
    expect(canUnfitFromMember(locked, "m-mar", "rifle-b")).toEqual({ ok: false, reason: "onMission" });
    expect(() => unfitFromMember(locked, "m-sec", "rifle")).toThrow(/onMission/);
    expect(canUnfitFromMember(locked, "m-bench", "rifle-bench")).toEqual({ ok: true });
    expect(byId(unfitFromMember(locked, "m-bench", "rifle-bench"), "rifle-bench").fittedToMemberId).toBeNull();
  });

  it("refuses an unknown piece, an unknown member, a piece not worn by that member, and a loadout-held piece", () => {
    const s = state([
      piece("rifle", "memberWeapon", "pulseRifle", { fittedToMemberId: "m-sec" }),
      piece("held", "memberArmor", "ballisticWeave", { fittedToMemberId: "m-sec", committedToLoadoutId: "lo-1" }),
    ]);
    expect(canUnfitFromMember(s, "m-sec", "nope")).toEqual({ ok: false, reason: "noInstance" });
    expect(canUnfitFromMember(s, "m-404", "rifle")).toEqual({ ok: false, reason: "noMember" });
    expect(canUnfitFromMember(s, "m-mar", "rifle")).toEqual({ ok: false, reason: "notWornByMember" });
    expect(canUnfitFromMember(s, "m-sec", "held")).toEqual({ ok: false, reason: "occupantInLoadout" });
    expect(() => unfitFromMember(s, "m-mar", "rifle")).toThrow(
      "unfitFromMember blocked: notWornByMember (member m-mar, piece rifle)"
    );
  });

  it("never mutates its input", () => {
    const s = state([piece("rifle", "memberWeapon", "pulseRifle", { fittedToMemberId: "m-sec" })]);
    const snapshot = structuredClone(s);
    unfitFromMember(s, "m-sec", "rifle");
    expect(s).toEqual(snapshot);
  });
});

describe("memberEquipment / memberPieceInSlot / memberSlotPieces", () => {
  it("read the member's worn pieces off fittedToMemberId", () => {
    const s = state([
      piece("rifle", "memberWeapon", "pulseRifle", { fittedToMemberId: "m-sec" }),
      piece("imp", "implant", "dermalWeave", { fittedToMemberId: "m-sec" }),
      piece("other", "memberArmor", "ballisticWeave", { fittedToMemberId: "m-mar" }),
      piece("spare", "memberArmor", "ballisticWeave"),
    ]);
    expect(memberEquipment(s, "m-sec").map((e) => e.id)).toEqual(["rifle", "imp"]);
    expect(memberPieceInSlot(s, "m-sec", "memberWeapon")?.id).toBe("rifle");
    expect(memberPieceInSlot(s, "m-sec", "memberArmor")).toBeNull();
    expect(memberPieceInSlot(s, "m-mar", "memberArmor")?.id).toBe("other");
    // Compile-time guard (enforced by npm run check): implant is a MULTI slot, so the singleton reader
    // refuses it at the type level; memberSlotPieces is the implant reader.
    // @ts-expect-error "implant" is excluded from memberPieceInSlot's slotType
    memberPieceInSlot(s, "m-sec", "implant");
  });

  it("memberSlotPieces indexes every slot type uniformly, in stable mint order, within capacity", () => {
    // Pool order deliberately differs from mint order (equip-12 before equip-3).
    let s = state([
      piece("equip-12", "implant", "reflexBooster"),
      piece("equip-3", "implant", "dermalWeave"),
      piece("equip-7", "memberWeapon", "pulseRifle", { fittedToMemberId: "m-mar" }),
    ]);
    s = fitToMember(s, "m-mar", "equip-12");
    s = fitToMember(s, "m-mar", "equip-3");
    const implants = memberSlotPieces(s, "m-mar", "implant");
    expect(implants.map((e) => e.id)).toEqual(["equip-3", "equip-12"]);
    const mar = s.awayMembers.find((m) => m.id === "m-mar")!;
    expect(implants.length).toBeLessThanOrEqual(memberSlotCapacity(mar, "implant"));
    expect(memberSlotPieces(s, "m-mar", "memberWeapon").map((e) => e.id)).toEqual(["equip-7"]);
    expect(memberSlotPieces(s, "m-mar", "memberArmor")).toEqual([]);
    // A targeted swap re-sorts by mint order: replacing equip-3 with equip-20 moves the survivor equip-12 to
    // index 0 and puts the newcomer last (deterministic, not position-stable).
    const swapped = fitToMember(
      { ...s, equipment: [...s.equipment, piece("equip-20", "implant", "targetingOptic")] },
      "m-mar",
      "equip-20",
      "equip-3"
    );
    expect(memberSlotPieces(swapped, "m-mar", "implant").map((e) => e.id)).toEqual(["equip-12", "equip-20"]);
  });

  it("memberSlotCapacity is implantSlotsFor for implants and 1 for singletons", () => {
    const mar = { race: "martian" as const };
    const earth = { race: "earthBorn" as const };
    expect(memberSlotCapacity(mar, "implant")).toBe(2);
    expect(memberSlotCapacity(earth, "implant")).toBe(1);
    expect(memberSlotCapacity(mar, "memberArmor")).toBe(1);
  });
});

// ===== salvage never takes a worn piece =====

describe("salvage and auto-salvage never take a member-worn piece", () => {
  it("manual salvage refuses a worn piece as fitted", () => {
    const s = state([piece("rifle", "memberWeapon", "pulseRifle", { fittedToMemberId: "m-sec" })]);
    const result = salvageEquipment(s, "rifle", () => 0.5);
    expect(result.ok).toBe(false);
    expect(result.next).toBe(s);
  });

  it("auto-salvage selects an identical spare but never the worn copy", () => {
    const s: GameState = {
      ...state([
        piece("worn", "memberWeapon", "pulseRifle", { fittedToMemberId: "m-sec", quality: 0 }),
        piece("spare", "memberWeapon", "pulseRifle", { quality: 0 }),
      ]),
      salvageConfirmQualities: [],
      autoSalvage: {
        enabled: true,
        qualities: [0, 1, 2, 3, 4, 5],
        duplicates: false,
        keepPerVariety: 1,
        rarities: { ...AUTO_SALVAGE_RARITIES_NONE },
        graceSeconds: AUTO_SALVAGE_GRACE_SECONDS_DEFAULT,
      },
    };
    const ids = selectAutoSalvageTargets(s, 1000).map((t) => (t.kind === "equipment" ? t.instanceId : t.kind));
    expect(ids).toContain("spare");
    expect(ids).not.toContain("worn");
  });
});

// ===== firing a member =====

describe("firing a member returns every worn piece", () => {
  it("returns armor, weapon, tool, implants and a unique Neural Backup to storage, then the Backup installs elsewhere", () => {
    const s = state(
      [
        piece("armor", "memberArmor", "ballisticWeave", { fittedToMemberId: "m-mar" }),
        piece("weapon", "memberWeapon", "pulseRifle", { fittedToMemberId: "m-mar" }),
        piece("tool", "memberTool", "medKit", { fittedToMemberId: "m-mar" }),
        piece("imp", "implant", "dermalWeave", { fittedToMemberId: "m-mar" }),
        piece("nb", "implant", "neuralBackup", { fittedToMemberId: "m-mar" }),
      ],
      4321
    );
    expect(canFitToMember(s, "m-sec", "nb")).toEqual({ ok: false, reason: "notSpare" });
    const fired = fireAwayMember(s, "m-mar");
    expect(fired.awayMembers.some((m) => m.id === "m-mar")).toBe(false);
    for (const id of ["armor", "weapon", "tool", "imp", "nb"]) {
      const e = byId(fired, id);
      expect(isSparePiece(e), id).toBe(true);
      expect(e.graceStartedAtGameSeconds, id).toBe(4321);
    }
    expect(canFitToMember(fired, "m-sec", "nb")).toEqual({ ok: true });
    const next = fitToMember(fired, "m-sec", "nb");
    expect(byId(next, "nb").fittedToMemberId).toBe("m-sec");
  });
});

// ===== item-side install list (S5-151) =====

describe("installTargetsFor", () => {
  it("lists every member, in roster order, with canFitToMember's verdict for member gear", () => {
    const s = onMission(
      state([
        piece("nb-worn", "implant", "neuralBackup", { fittedToMemberId: "m-mar" }),
        piece("rifle", "memberWeapon", "pulseRifle"),
        piece("nb", "implant", "neuralBackup"),
      ])
    );
    for (const pieceId of ["rifle", "nb"]) {
      const targets = installTargetsFor(s, pieceId);
      expect(targets.map((t) => (t.kind === "member" ? t.memberId : "SHIP"))).toEqual(
        s.awayMembers.map((m) => m.id)
      );
      for (const t of targets) {
        if (t.kind !== "member") throw new Error("member gear listed a ship");
        const gate = canFitToMember(s, t.memberId, pieceId);
        expect(t.ok).toBe(gate.ok);
        expect(t.reason).toBe(gate.ok ? undefined : gate.reason);
      }
    }
    // Spot-check the verdicts: the rifle suits the Security members off the locked ship only.
    const rifle = installTargetsFor(s, "rifle");
    expect(rifle.filter((t) => t.ok).map((t) => (t.kind === "member" ? t.memberId : ""))).toEqual(["m-mar", "m-bench"]);
  });

  it("lists every ship, in fleet order, with canFitEquipment's verdict for ship gear", () => {
    const s = onMission(state([piece("cargo", "cargoBay", undefined)]));
    const targets = installTargetsFor(s, "cargo");
    expect(targets.map((t) => (t.kind === "ship" ? t.shipId : "MEMBER"))).toEqual(["ship-a", "ship-b"]);
    for (const t of targets) {
      if (t.kind !== "ship") throw new Error("ship gear listed a member");
      const gate = canFitEquipment(s, t.shipId, "cargo");
      expect(t.ok).toBe(gate.ok);
      expect(t.reason).toBe(gate.ok ? undefined : gate.reason);
    }
    expect(targets.map((t) => t.ok)).toEqual([false, true]);
  });

  it("is empty for an unknown piece", () => {
    expect(installTargetsFor(state(), "nope")).toEqual([]);
  });

  it("never mutates its input", () => {
    const s = state([piece("rifle", "memberWeapon", "pulseRifle"), piece("cargo", "cargoBay", undefined)]);
    const snapshot = structuredClone(s);
    installTargetsFor(s, "rifle");
    installTargetsFor(s, "cargo");
    expect(s).toEqual(snapshot);
  });
});

// ===== player-facing text =====

describe("memberFitBlockText", () => {
  const reasons: MemberFitBlockReason[] = [
    "noInstance",
    "notMemberSlot",
    "queuedForSalvage",
    "committedToLoadout",
    "locked",
    "notSpare",
    "noMember",
    "onMission",
    "wrongTeam",
    "replaceTargetInvalid",
    "occupantInLoadout",
    "uniqueEquippedElsewhere",
    "implantSlotsFull",
    "notWornByMember",
  ];

  it("has a line for every reason, says install (never fit), and uses no dash substitutes", () => {
    for (const r of reasons) {
      const text = memberFitBlockText(r);
      expect(text.length, r).toBeGreaterThan(0);
      expect(text, r).not.toMatch(/\bfit/i);
      expect(text, r).not.toMatch(new RegExp("\u2014|-{2}"));
    }
  });
});

// ===== pieceWearableBy (Task 9 review M2) =====

describe("pieceWearableBy", () => {
  it("is true only for a member piece whose variety lists the squad", () => {
    expect(pieceWearableBy(piece("a", "memberWeapon", "pulseRifle"), "security")).toBe(true);
    expect(pieceWearableBy(piece("a", "memberWeapon", "pulseRifle"), "science")).toBe(false);
    expect(pieceWearableBy(piece("b", "implant", "dermalWeave"), "security")).toBe(true);
  });

  it("is false for ship gear, an unstamped member piece, and a retired variety key", () => {
    expect(pieceWearableBy(piece("c", "cargoBay", undefined), "security")).toBe(false);
    expect(pieceWearableBy(piece("d", "memberTool", undefined), "science")).toBe(false);
    expect(pieceWearableBy(piece("e", "memberTool", "retiredKey"), "science")).toBe(false);
  });

  it("agrees with canFitToMember's wrongTeam verdict for every member variety and squad", () => {
    const teams: AwayTeamType[] = ["security", "science"];
    for (const slot of ["memberArmor", "memberWeapon", "memberTool", "implant"] as const) {
      for (const v of EQUIPMENT_SLOTS[slot].varieties) {
        const p = piece("equip-1", slot, v.key);
        for (const t of teams) {
          const state: GameState = { ...freshState(), equipment: [p], awayMembers: [member("member-1", t, null)] };
          const gate = canFitToMember(state, "member-1", p.id);
          const wrongTeam = !gate.ok && gate.reason === "wrongTeam";
          expect(wrongTeam, `${slot}/${v.key}/${t}`).toBe(!pieceWearableBy(p, t));
        }
      }
    }
  });
});

// ===== memberWornIndex (Task 10 review: one pass for the roster view) =====

describe("memberWornIndex", () => {
  it("indexes every worn piece by member in mint order, matching the per-member queries", () => {
    const state: GameState = {
      ...freshState(),
      awayMembers: [member("member-1", "security", null, "martian"), member("member-2", "science", null)],
      equipment: [
        piece("equip-12", "implant", "dermalWeave", { fittedToMemberId: "member-1" }),
        piece("equip-3", "memberWeapon", "pulseRifle", { fittedToMemberId: "member-1" }),
        piece("equip-5", "implant", "reflexBooster", { fittedToMemberId: "member-1" }),
        piece("equip-7", "memberArmor", "fieldSuit", { fittedToMemberId: "member-2" }),
        piece("equip-8", "memberTool", "medKit"), // spare: indexed nowhere
      ],
    };
    const index = memberWornIndex(state);
    expect(index.get("member-1")!.map((p) => p.id)).toEqual(["equip-3", "equip-5", "equip-12"]);
    expect(index.get("member-2")!.map((p) => p.id)).toEqual(["equip-7"]);
    expect(index.has("member-3")).toBe(false);
    for (const m of state.awayMembers) {
      const worn = index.get(m.id) ?? [];
      expect(worn.filter((p) => p.slotType === "implant")).toEqual(memberSlotPieces(state, m.id, "implant"));
      for (const slot of ["memberArmor", "memberWeapon", "memberTool"] as const) {
        expect(worn.find((p) => p.slotType === slot) ?? null).toEqual(memberPieceInSlot(state, m.id, slot));
      }
    }
  });
});
