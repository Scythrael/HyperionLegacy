// CP-6 (docs/plans/2026-10-14-complement-and-acquisition-plan.md, source decision 11, SUGGESTIONS 151:
// "Crew-allocation settings LOCK when a mission starts (can't change mid-mission)"): ONE crew lock for every
// crew change while a ship is out. crewLockReason says WHY a ship is locked (a captain mission or an expedition,
// including one complete but not yet claimed) and agrees with shipCrewLocked, the one predicate. Every
// crew-changing action refuses with a typed reason (same reference) while the ship involved is locked, and
// works again after the ship returns or the expedition is claimed. Promotion, renaming and favoriting stay
// allowed (they change no allocation).
import { describe, it, expect } from "vitest";
import { freshState } from "./model";
import type {
  CaptainMissionState,
  CaptainState,
  Expedition,
  GameState,
  NotableCrewMember,
  PersonnelRoster,
  SeniorStaffOfficer,
} from "./model";
import {
  canSetComplementMode,
  complementModeBlockText,
  crewLockReason,
  crewLockReasonText,
  crewLockText,
  crewLockTextAmong,
  crewLockUntilText,
  setComplementMode,
  shipCrewLocked,
} from "./crewLock";
import { shipCrewLocked as reexportedLock } from "./awayTeam";
import {
  assignOfficerToShip,
  canAssignOfficer,
  canFireOfficer,
  canHireOfficerToSeat,
  canUnassignOfficer,
  fireOfficer,
  hireOfficerToSeat,
  officerBlockText,
  seniorStaffCandidates,
  toggleOfficerFavorite,
  unassignOfficer,
  promoteOfficer,
} from "./seniorStaff";
import { applyRoster, canApplyRoster, rosterApplyBlockText, rosterApplyGateText, toggleNotableFavorite } from "./personnelRosters";
import { canRetireCaptain, retireBlockReason, retireBlockText, retireCaptain, RETIRE_LEVEL_GATE } from "./captainRetirement";
import { canReassignAwayMember, reassignAwayMember } from "./awayTeam";
import { plainAwayMember } from "./awayTeamTestFixtures";
import { emptyGroundTeams } from "./groundTeams";
import { renameShip } from "./tick";

// --- fixtures ---------------------------------------------------------------

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

function officer(id: string, seat: SeniorStaffOfficer["seat"], shipId: string | null): SeniorStaffOfficer {
  return {
    id,
    seat,
    name: `Officer ${id}`,
    race: "earthBorn",
    gender: "female",
    rank: "ensign",
    bonuses: [{ id: "b1", magnitude: 1 }, { id: "b2", magnitude: 2 }],
    missionsCompleted: 0,
    assignedShipId: shipId,
  };
}

function notable(id: string, shipId: string | null): NotableCrewMember {
  return {
    id,
    profession: "security",
    rarity: "standard",
    rank: 1,
    race: "earthBorn",
    buff1Id: "sec.boarding",
    buff2Id: null,
    name: `Notable ${id}`,
    gender: "male",
    assignedShipId: shipId,
  };
}

// ship-1 (freshState's hull, captain 1, idle) and ship-2 (a parked freighter). Officers: a pilot on ship-1, a
// science officer on ship-2, an unassigned operations officer. One notable on ship-2, one unassigned.
function fleet(): GameState {
  const base = freshState();
  return {
    ...base,
    ships: [
      base.ships[0],
      { id: "ship-2", typeKey: "generalFreighter", assignedCaptainId: null, groundTeams: emptyGroundTeams("generalFreighter") },
    ],
    officers: [officer("officer-1", "pilot", "ship-1"), officer("officer-2", "science", "ship-2"), officer("officer-3", "operations", null)],
    notableCrew: [notable("notable-1", "ship-2"), notable("notable-2", null)],
    nextOfficerId: 4,
  };
}

// ship-1's captain out on a mission.
function onMission(s: GameState): GameState {
  return { ...s, captains: s.captains.map((c) => (c.id === 1 ? { ...c, mission: activeMission() } : c)) };
}

// `shipId` on an expedition (the lock reads only the record's ship id; a phase is set for readability).
function onExpedition(s: GameState, shipId: string, phase: Expedition["phase"] = "transit"): GameState {
  return { ...s, expeditions: [...s.expeditions, { id: `expedition-${shipId}`, shipId, phase } as unknown as Expedition] };
}

// --- the one lock -------------------------------------------------------------

describe("crewLockReason: why a ship is locked, agreeing with shipCrewLocked (CP-6)", () => {
  it("null when free, onMission for a flying captain, onExpedition in flight or complete but unclaimed", () => {
    const s = fleet();
    expect(crewLockReason(s, "ship-1")).toBeNull();
    expect(crewLockReason(onMission(s), "ship-1")).toBe("onMission");
    expect(crewLockReason(onMission(s), "ship-2")).toBeNull();
    expect(crewLockReason(onExpedition(s, "ship-2"), "ship-2")).toBe("onExpedition");
    expect(crewLockReason(onExpedition(s, "ship-2", "complete"), "ship-2")).toBe("onExpedition");
    expect(crewLockReason(s, "ship-missing")).toBeNull();
  });

  it("a captain mission wins over an expedition on the same hull (recall is the first step)", () => {
    expect(crewLockReason(onExpedition(onMission(fleet()), "ship-1"), "ship-1")).toBe("onMission");
  });

  it("is non-null exactly when shipCrewLocked is true (one source of truth, re-exported from awayTeam)", () => {
    const states = [fleet(), onMission(fleet()), onExpedition(fleet(), "ship-2"), onExpedition(onMission(fleet()), "ship-2")];
    for (const s of states) {
      for (const id of ["ship-1", "ship-2", "ship-missing"]) {
        expect(crewLockReason(s, id) !== null).toBe(shipCrewLocked(s, id));
        expect(reexportedLock(s, id)).toBe(shipCrewLocked(s, id));
      }
    }
  });

  it("player text: the accurate words, plus how long the lock lasts", () => {
    expect(crewLockReasonText("onMission")).toBe("Ship is out on a mission");
    expect(crewLockReasonText("onExpedition")).toBe("Ship is on an expedition");
    expect(crewLockText(fleet(), "ship-1")).toBeNull();
    expect(crewLockText(onMission(fleet()), "ship-1")).toBe("Ship is out on a mission");
    expect(crewLockText(onExpedition(fleet(), "ship-2"), "ship-2")).toBe("Ship is on an expedition");
    expect(crewLockUntilText("onMission")).toBe("until it returns");
    expect(crewLockUntilText("onExpedition")).toBe("until its expedition is claimed");
  });

  it("crewLockTextAmong names the first locked ship among the ones involved", () => {
    const s = onExpedition(onMission(fleet()), "ship-2");
    expect(crewLockTextAmong(s, [null, "ship-2", "ship-1"])).toBe("Ship is on an expedition");
    expect(crewLockTextAmong(s, ["ship-1", "ship-2"])).toBe("Ship is out on a mission");
    expect(crewLockTextAmong(fleet(), ["ship-1", "ship-2", undefined])).toBeNull();
  });
});

// --- officers -----------------------------------------------------------------

describe("officer actions refuse while a ship involved is locked (CP-6)", () => {
  it("hire-to-seat: refuses on a locked ship (same ref, nothing hired), works when free", () => {
    for (const locked of [onMission(fleet()), onExpedition(fleet(), "ship-1")]) {
      const cand = seniorStaffCandidates(locked).find((c) => c.seat !== "pilot")!;
      expect(canHireOfficerToSeat(locked, cand.id, "ship-1")).toEqual({ ok: false, reason: "onMission" });
      expect(hireOfficerToSeat(locked, cand.id, "ship-1")).toBe(locked);
    }
    const s = fleet();
    const cand = seniorStaffCandidates(s).find((c) => c.seat !== "pilot")!;
    expect(canHireOfficerToSeat(s, cand.id, "ship-1")).toEqual({ ok: true });
    const next = hireOfficerToSeat(s, cand.id, "ship-1");
    const hired = next.officers[next.officers.length - 1];
    expect(hired.id).toBe("officer-4");
    expect(hired.assignedShipId).toBe("ship-1");
    expect(next.nextOfficerId).toBe(5);
  });

  it("hire-to-seat: an occupied seat or a stale candidate refuses atomically (no hire without a seat)", () => {
    const s = fleet();
    const pilot = seniorStaffCandidates(s).find((c) => c.seat === "pilot");
    if (pilot) {
      expect(canHireOfficerToSeat(s, pilot.id, "ship-1")).toEqual({ ok: false, reason: "seatTaken" });
      expect(hireOfficerToSeat(s, pilot.id, "ship-1")).toBe(s);
    }
    expect(canHireOfficerToSeat(s, "candidate-nope", "ship-1")).toEqual({ ok: false, reason: "noCandidate" });
    expect(canHireOfficerToSeat(s, seniorStaffCandidates(s)[0].id, "ship-nope")).toEqual({ ok: false, reason: "noShip" });
  });

  it("assign: refuses onto a locked ship, and away from a locked ship", () => {
    const onto = onExpedition(fleet(), "ship-1");
    expect(canAssignOfficer(onto, "officer-3", "ship-1")).toEqual({ ok: false, reason: "onMission" });
    expect(assignOfficerToShip(onto, "officer-3", "ship-1")).toBe(onto);
    const away = onExpedition(fleet(), "ship-2");
    expect(canAssignOfficer(away, "officer-2", "ship-1")).toEqual({ ok: false, reason: "onMission" });
    expect(assignOfficerToShip(away, "officer-2", "ship-1")).toBe(away);
    // Free: both go through.
    const s = fleet();
    expect(canAssignOfficer(s, "officer-3", "ship-1")).toEqual({ ok: true });
    expect(assignOfficerToShip(s, "officer-3", "ship-1").officers.find((o) => o.id === "officer-3")?.assignedShipId).toBe("ship-1");
    expect(assignOfficerToShip(s, "officer-2", "ship-1").officers.find((o) => o.id === "officer-2")?.assignedShipId).toBe("ship-1");
  });

  it("assign keeps its old refusals as typed reasons", () => {
    const s = { ...fleet(), officers: [...fleet().officers, officer("officer-9", "pilot", null)] };
    expect(canAssignOfficer(s, "officer-9", "ship-1")).toEqual({ ok: false, reason: "seatTaken" });
    expect(canAssignOfficer(s, "officer-nope", "ship-1")).toEqual({ ok: false, reason: "noOfficer" });
    expect(canAssignOfficer(s, "officer-9", "ship-nope")).toEqual({ ok: false, reason: "noShip" });
  });

  it("unassign and fire: refuse while the officer's ship is locked, work after it returns", () => {
    const locked = onMission(fleet());
    expect(canUnassignOfficer(locked, "officer-1")).toEqual({ ok: false, reason: "onMission" });
    expect(unassignOfficer(locked, "officer-1")).toBe(locked);
    expect(canFireOfficer(locked, "officer-1")).toEqual({ ok: false, reason: "onMission" });
    expect(fireOfficer(locked, "officer-1")).toBe(locked);
    // The other ship's officer and the unassigned one are untouched by ship-1's lock.
    expect(canFireOfficer(locked, "officer-2")).toEqual({ ok: true });
    expect(canFireOfficer(locked, "officer-3")).toEqual({ ok: true });
    // Back home: both go through.
    const s = fleet();
    expect(unassignOfficer(s, "officer-1").officers.find((o) => o.id === "officer-1")?.assignedShipId).toBeNull();
    expect(fireOfficer(s, "officer-1").officers.some((o) => o.id === "officer-1")).toBe(false);
  });

  it("an unknown officer refuses with noOfficer, same ref", () => {
    const s = fleet();
    expect(canFireOfficer(s, "officer-nope")).toEqual({ ok: false, reason: "noOfficer" });
    expect(fireOfficer(s, "officer-nope")).toBe(s);
    expect(unassignOfficer(s, "officer-nope")).toBe(s);
  });

  it("every officer refusal has player text (exhaustive)", () => {
    expect(officerBlockText("noCandidate")).toBe("No longer on the board");
    expect(officerBlockText("noOfficer")).toBe("No longer in the fleet");
    expect(officerBlockText("noShip")).toBe("That ship is no longer in the fleet");
    expect(officerBlockText("seatTaken")).toBe("That seat is already filled");
    expect(officerBlockText("onMission")).toBe("Ship is out on a mission");
  });

  it("promotion and favoriting stay allowed on a locked ship", () => {
    const locked = onExpedition(onMission(fleet()), "ship-2");
    const fav = toggleOfficerFavorite(locked, "officer-1");
    expect(fav).not.toBe(locked);
    expect(fav.officers.find((o) => o.id === "officer-1")?.favorite).toBe(true);
    expect(toggleNotableFavorite(locked, "notable-1")).not.toBe(locked);
    // promoteOfficer is officer-level (no state), so the lock cannot reach it; the App handler splices it in.
    const ready = { ...locked.officers[0], missionsCompleted: 1_000_000 };
    expect(() => promoteOfficer(ready)).not.toThrow();
    // Renaming the ship is not a crew change either.
    expect(renameShip(locked, "ship-1", "Hopeful")).not.toBe(locked);
  });
});

// --- rosters ------------------------------------------------------------------

function roster(patch: Partial<PersonnelRoster> = {}): PersonnelRoster {
  return {
    id: "roster-1",
    name: "Away Crew",
    linkedLoadoutId: null,
    includePeople: true,
    seatAssignments: {},
    pinnedNotableCrew: [],
    ...patch,
  };
}

function withRoster(s: GameState, r: PersonnelRoster): GameState {
  return { ...s, personnelRosters: [r], nextRosterId: 2 };
}

describe("applyRoster refuses whole while a ship involved is locked (CP-6)", () => {
  it("a locked target ship refuses (same ref), even for a gear-only roster", () => {
    for (const r of [roster({ seatAssignments: { operations: "officer-3" } }), roster({ includePeople: false })]) {
      const locked = withRoster(onExpedition(fleet(), "ship-1"), r);
      expect(canApplyRoster(locked, "roster-1", "ship-1")).toEqual({ ok: false, reason: "onMission", lockedShipId: "ship-1" });
      expect(applyRoster(locked, "roster-1", "ship-1")).toBe(locked);
    }
  });

  it("a pinned officer aboard a locked ship refuses the whole apply (no partial landing)", () => {
    const r = roster({ seatAssignments: { science: "officer-2", operations: "officer-3" } });
    const locked = withRoster(onExpedition(fleet(), "ship-2"), r);
    expect(canApplyRoster(locked, "roster-1", "ship-1")).toEqual({ ok: false, reason: "pinnedAboardLockedShip", lockedShipId: "ship-2" });
    const next = applyRoster(locked, "roster-1", "ship-1");
    expect(next).toBe(locked);
    expect(next.officers.find((o) => o.id === "officer-3")?.assignedShipId).toBeNull(); // the free pin did not land
  });

  it("a pinned notable aboard a locked ship refuses the whole apply", () => {
    const r = roster({ pinnedNotableCrew: ["notable-2", "notable-1"] });
    const locked = withRoster(onExpedition(fleet(), "ship-2"), r);
    expect(canApplyRoster(locked, "roster-1", "ship-1")).toEqual({ ok: false, reason: "pinnedAboardLockedShip", lockedShipId: "ship-2" });
    expect(applyRoster(locked, "roster-1", "ship-1")).toBe(locked);
  });

  it("a gear-only roster ignores its pins (it applies no people)", () => {
    const r = roster({ includePeople: false, seatAssignments: { science: "officer-2" } });
    const s = withRoster(onExpedition(fleet(), "ship-2"), r);
    expect(canApplyRoster(s, "roster-1", "ship-1")).toEqual({ ok: true });
  });

  it("works once everything involved is free, and keeps noRoster / noShip refusals", () => {
    const r = roster({ seatAssignments: { science: "officer-2", operations: "officer-3" }, pinnedNotableCrew: ["notable-1"] });
    const s = withRoster(fleet(), r);
    expect(canApplyRoster(s, "roster-1", "ship-1")).toEqual({ ok: true });
    const next = applyRoster(s, "roster-1", "ship-1");
    expect(next.officers.find((o) => o.id === "officer-2")?.assignedShipId).toBe("ship-1");
    expect(next.officers.find((o) => o.id === "officer-3")?.assignedShipId).toBe("ship-1");
    expect(canApplyRoster(s, "roster-nope", "ship-1")).toEqual({ ok: false, reason: "noRoster" });
    expect(canApplyRoster(s, "roster-1", "ship-nope")).toEqual({ ok: false, reason: "noShip" });
  });

  it("player text names the real lock", () => {
    expect(rosterApplyBlockText("noRoster")).toBe("That roster no longer exists");
    expect(rosterApplyBlockText("noShip")).toBe("That ship is no longer in the fleet");
    expect(rosterApplyBlockText("onMission")).toBe("Ship is out on a mission");
    expect(rosterApplyBlockText("pinnedAboardLockedShip")).toBe("A pinned officer or crew member is aboard a ship that is out");
    const r = roster({ seatAssignments: { science: "officer-2" } });
    const exp = withRoster(onExpedition(fleet(), "ship-2"), r);
    expect(rosterApplyGateText(exp, canApplyRoster(exp, "roster-1", "ship-1"))).toBe(
      "A pinned officer or crew member is aboard a ship on an expedition",
    );
    expect(rosterApplyGateText(exp, canApplyRoster(exp, "roster-1", "ship-2"))).toBe("Ship is on an expedition");
    const flying = withRoster(onMission(fleet()), roster({ seatAssignments: { pilot: "officer-1" } }));
    expect(rosterApplyGateText(flying, canApplyRoster(flying, "roster-1", "ship-2"))).toBe(
      "A pinned officer or crew member is aboard a ship out on a mission",
    );
    expect(rosterApplyGateText(exp, { ok: true })).toBeUndefined();
  });
});

// --- captain retirement -------------------------------------------------------

function retireReady(): GameState {
  const base = fleet();
  const captain: CaptainState = { ...base.captains[0], level: RETIRE_LEVEL_GATE, mission: null, retirements: 0 };
  return {
    ...base,
    captains: [captain, ...base.captains.slice(1)],
    officers: [...base.officers, officer("officer-xo", "executive", "ship-1")],
  };
}

describe("captain retirement refuses while the captain's ship is crew-locked (CP-6)", () => {
  it("an expedition on the captain's ship refuses (the XO is out on the run)", () => {
    const s = onExpedition(retireReady(), "ship-1");
    expect(retireBlockReason(s, 1)).toBe("shipOnExpedition");
    expect(canRetireCaptain(s, 1)).toBe(false);
    expect(retireCaptain(s, 1)).toBe(s);
  });

  it("a complete but unclaimed expedition still refuses; another ship's expedition does not", () => {
    expect(retireBlockReason(onExpedition(retireReady(), "ship-1", "complete"), 1)).toBe("shipOnExpedition");
    expect(retireBlockReason(onExpedition(retireReady(), "ship-2"), 1)).toBeNull();
  });

  it("keeps the old guard order as typed reasons", () => {
    const s = retireReady();
    expect(retireBlockReason(s, 1)).toBeNull();
    expect(retireBlockReason(s, 999)).toBe("noCaptain");
    const low = { ...s, captains: s.captains.map((c) => (c.id === 1 ? { ...c, level: 3 } : c)) };
    expect(retireBlockReason(low, 1)).toBe("belowLevel");
    const capped = { ...s, captains: s.captains.map((c) => (c.id === 1 ? { ...c, retirements: 5 } : c)) };
    expect(retireBlockReason(capped, 1)).toBe("lockedIn");
    expect(retireBlockReason(onMission(s), 1)).toBe("notIdle");
    const noXo = { ...s, officers: s.officers.filter((o) => o.id !== "officer-xo") };
    expect(retireBlockReason(noXo, 1)).toBe("noSuccessor");
  });

  it("every refusal has player text (exhaustive)", () => {
    expect(retireBlockText("noCaptain", 1)).toBe("No such captain.");
    expect(retireBlockText("belowLevel", 7)).toBe(`Reach level ${RETIRE_LEVEL_GATE} to retire (currently level 7).`);
    expect(retireBlockText("lockedIn", 30)).toBe("This captaincy is locked in: no retirements remain.");
    expect(retireBlockText("notIdle", 30)).toBe("Recall this captain first, retirement needs an idle captain.");
    expect(retireBlockText("shipOnExpedition", 30)).toBe("This captain's ship is on an expedition: claim it first.");
    expect(retireBlockText("noSuccessor", 30)).toBe("Seat an Executive officer (XO) aboard this captain's ship to succeed them.");
  });
});

// --- complement mode ----------------------------------------------------------

describe("the complement mode toggle refuses on a locked ship (CP-6)", () => {
  it("refuses with onMission (same ref) on a mission or an expedition; works when free", () => {
    for (const locked of [onMission(fleet()), onExpedition(fleet(), "ship-1")]) {
      expect(canSetComplementMode(locked, "ship-1", "active")).toEqual({ ok: false, reason: "onMission" });
      expect(setComplementMode(locked, "ship-1", "active")).toBe(locked);
    }
    const s = fleet();
    expect(canSetComplementMode(s, "ship-1", "active")).toEqual({ ok: true });
    const next = setComplementMode(s, "ship-1", "active");
    expect(next.ships[0].complement?.mode).toBe("active");
    expect(setComplementMode(next, "ship-1", "passive").ships[0].complement?.mode).toBe("passive");
  });

  it("keeps the old no-ops as typed refusals, and a fresh hull materializes an empty complement", () => {
    const s = fleet();
    const bare = { ...s, ships: s.ships.map((x) => (x.id === "ship-2" ? { ...x, complement: undefined } : x)) };
    expect(canSetComplementMode(bare, "ship-2", "passive")).toEqual({ ok: false, reason: "unchanged" });
    expect(setComplementMode(bare, "ship-2", "passive")).toBe(bare);
    expect(setComplementMode(bare, "ship-2", "active").ships[1].complement).toEqual({ buckets: [], mode: "active" });
    expect(canSetComplementMode(s, "ship-nope", "active")).toEqual({ ok: false, reason: "noShip" });
    expect(complementModeBlockText("noShip")).toBe("That ship is no longer in the fleet");
    expect(complementModeBlockText("unchanged")).toBe("Already set");
    expect(complementModeBlockText("onMission")).toBe("Ship is out on a mission");
  });
});

// --- away members (already locked; verified here) -----------------------------

describe("away member reassign already refuses on an expedition (CP-6 verify)", () => {
  it("leaving or joining a ship on an expedition refuses, same ref", () => {
    const s: GameState = { ...fleet(), awayMembers: [plainAwayMember("member-1", "security", "ship-2"), { ...plainAwayMember("member-2", "security", "ship-1"), assignedShipId: null }] };
    const exp = onExpedition(s, "ship-2");
    expect(canReassignAwayMember(exp, "member-1", "ship-1")).toEqual({ ok: false, reason: "onMission" });
    expect(reassignAwayMember(exp, "member-1", "ship-1")).toBe(exp);
    expect(canReassignAwayMember(exp, "member-2", "ship-2")).toEqual({ ok: false, reason: "onMission" });
    expect(reassignAwayMember(exp, "member-2", "ship-2")).toBe(exp);
  });
});
