// CP-17 (E-CREW Task 30): the ship-screen roster picker's display decisions (shipRosterDisplay.ts): which rosters
// are offered, the unsaved-configuration warning condition, the status line, the default pick, and why Apply is
// disabled (the ship's own crew lock first, then the engine's gate for the pick).

import { describe, it, expect } from "vitest";
import { freshState } from "./game/model";
import type {
  CaptainMissionState,
  Expedition,
  GameState,
  NotableCrewMember,
  PersonnelRoster,
  SeniorStaffOfficer,
} from "./game/model";
import { emptyGroundTeams } from "./game/groundTeams";
import { applyRoster, canApplyRoster, rosterApplyGateText } from "./game/personnelRosters";
import {
  defaultShipRosterId,
  shipMatchesRoster,
  shipMatchingRosterId,
  shipRosterApplyBlock,
  shipRosterApplyWarns,
  shipRosterEmptyText,
  shipRosterOptions,
  shipRosterStatusText,
  shipSetupUnsaved,
} from "./shipRosterDisplay";

// === fixtures ===

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

function roster(id: string, patch: Partial<PersonnelRoster> = {}): PersonnelRoster {
  return {
    id,
    name: `Roster ${id}`,
    linkedLoadoutId: null,
    includePeople: true,
    seatAssignments: {},
    pinnedNotableCrew: [],
    ...patch,
  };
}

// ship-1 (freshState's hull, captain 1, idle) carries a pilot and notable-1; ship-2 is a parked freighter with a
// science officer and notable-2. officer-3 (operations) and notable-3 wait unassigned.
function fleet(rosters: PersonnelRoster[] = []): GameState {
  const base = freshState();
  return {
    ...base,
    ships: [
      base.ships[0],
      { id: "ship-2", typeKey: "generalFreighter", assignedCaptainId: null, groundTeams: emptyGroundTeams("generalFreighter") },
    ],
    officers: [officer("officer-1", "pilot", "ship-1"), officer("officer-2", "science", "ship-2"), officer("officer-3", "operations", null)],
    notableCrew: [notable("notable-1", "ship-1"), notable("notable-2", "ship-2"), notable("notable-3", null)],
    nextOfficerId: 4,
    personnelRosters: rosters,
    nextRosterId: rosters.length + 1,
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

function onMission(s: GameState): GameState {
  return { ...s, captains: s.captains.map((c) => (c.id === 1 ? { ...c, mission: activeMission() } : c)) };
}

function onExpedition(s: GameState, shipId: string): GameState {
  return { ...s, expeditions: [...s.expeditions, { id: `expedition-${shipId}`, shipId, phase: "transit" } as unknown as Expedition] };
}

// The roster that records ship-1 exactly as fleet() builds it.
const SHIP1 = roster("roster-1", { name: "Ship One", seatAssignments: { pilot: "officer-1" }, pinnedNotableCrew: ["notable-1"] });

// === offered rosters + empty state ===

describe("shipRosterOptions / shipRosterEmptyText", () => {
  it("offers every people-carrying roster in saved order and skips a roster without people (the facility disables those)", () => {
    const s = fleet([roster("roster-1", { name: "B" }), roster("roster-2", { name: "Gear", includePeople: false }), roster("roster-3", { name: "A" })]);
    expect(shipRosterOptions(s)).toEqual([
      { id: "roster-1", label: "B" },
      { id: "roster-3", label: "A" },
    ]);
    expect(shipRosterEmptyText(s)).toBeNull();
  });

  it("offers a roster whose linked loadout is for another hull (the facility enforces no hull filter)", () => {
    const s = fleet([roster("roster-1", { linkedLoadoutId: "loadout-x" })]);
    expect(shipRosterOptions(s).map((o) => o.id)).toEqual(["roster-1"]);
  });

  it("says there are no rosters, or that none carries people, pointing at the facility", () => {
    expect(shipRosterEmptyText(fleet())).toBe("No saved rosters yet. Build one in Facilities, Personnel Rosters.");
    expect(shipRosterEmptyText(fleet([roster("roster-1", { includePeople: false })]))).toMatch(
      /^No saved roster carries people yet\. Turn on Include Senior Staff & Complement/,
    );
  });
});

// === the warning condition ===

describe("shipSetupUnsaved: the ship's people differ from every saved roster", () => {
  it("is false when a roster records the ship's officers and notable crew exactly", () => {
    const s = fleet([roster("roster-0", { name: "Other" }), SHIP1]);
    expect(shipMatchesRoster(s, "ship-1", SHIP1)).toBe(true);
    expect(shipMatchingRosterId(s, "ship-1")).toBe("roster-1");
    expect(shipSetupUnsaved(s, "ship-1")).toBe(false);
  });

  it("is true when no roster matches: an extra officer, a missing pin, another notable, or no rosters at all", () => {
    expect(shipSetupUnsaved(fleet(), "ship-1")).toBe(true);
    const extraSeat = roster("roster-1", { seatAssignments: { pilot: "officer-1", operations: "officer-3" }, pinnedNotableCrew: ["notable-1"] });
    const noNotable = roster("roster-2", { seatAssignments: { pilot: "officer-1" } });
    const otherNotable = roster("roster-3", { seatAssignments: { pilot: "officer-1" }, pinnedNotableCrew: ["notable-1", "notable-3"] });
    const s = fleet([extraSeat, noNotable, otherNotable]);
    expect(shipMatchingRosterId(s, "ship-1")).toBeNull();
    expect(shipSetupUnsaved(s, "ship-1")).toBe(true);
  });

  it("reads notable pins as a set (priority order never decides a match)", () => {
    const s0 = fleet([roster("roster-1", { seatAssignments: { pilot: "officer-1" }, pinnedNotableCrew: ["notable-3", "notable-1"] })]);
    const s = { ...s0, notableCrew: s0.notableCrew.map((n) => (n.id === "notable-3" ? { ...n, assignedShipId: "ship-1" } : n)) };
    expect(shipSetupUnsaved(s, "ship-1")).toBe(false);
  });

  it("never matches a roster without people, even on an empty ship", () => {
    const gear = roster("roster-1", { includePeople: false });
    const s = fleet([gear]);
    expect(shipMatchesRoster(s, "ship-1", gear)).toBe(false);
    const empty = { ...s, officers: [], notableCrew: [] };
    expect(shipMatchesRoster(empty, "ship-1", gear)).toBe(false);
  });

  it("an empty ship has nothing to lose, so it never warns", () => {
    const s = { ...fleet([SHIP1]), officers: [], notableCrew: [] };
    expect(shipSetupUnsaved(s, "ship-1")).toBe(false);
    expect(shipRosterStatusText(s, "ship-1")).toBeNull();
  });

  it("reads a pin the engine would skip (a person no longer in the fleet) as no pin", () => {
    const stale = roster("roster-1", {
      seatAssignments: { pilot: "officer-1", medical: "officer-gone", operations: "officer-1" },
      pinnedNotableCrew: ["notable-1", "notable-gone"],
    });
    expect(shipSetupUnsaved(fleet([stale]), "ship-1")).toBe(false);
  });

  it("matches right after a clean apply of the roster (the warning does not repeat)", () => {
    const r = roster("roster-1", { seatAssignments: { pilot: "officer-1", operations: "officer-3" }, pinnedNotableCrew: ["notable-1", "notable-3"] });
    const s = fleet([r]);
    expect(shipSetupUnsaved(s, "ship-1")).toBe(true);
    const after = applyRoster(s, "roster-1", "ship-1");
    expect(after).not.toBe(s);
    expect(shipSetupUnsaved(after, "ship-1")).toBe(false);
    expect(shipMatchingRosterId(after, "ship-1")).toBe("roster-1");
  });
});

describe("shipRosterApplyWarns: Apply warns only when an unsaved setup would change", () => {
  it("warns when the setup is unsaved and the pick changes the ship's officers or notable crew", () => {
    const r = roster("roster-1", { seatAssignments: { operations: "officer-3" } });
    const s = fleet([r]);
    expect(shipSetupUnsaved(s, "ship-1")).toBe(true);
    expect(shipRosterApplyWarns(s, "ship-1", "roster-1")).toBe(true);
  });

  it("does not warn when a saved roster matches the ship (the setup is not lost)", () => {
    const other = roster("roster-2", { seatAssignments: { operations: "officer-3" } });
    const s = fleet([SHIP1, other]);
    expect(shipRosterApplyWarns(s, "ship-1", "roster-2")).toBe(false);
  });

  it("does not warn when the pick's people are already aboard (applying changes nothing here)", () => {
    // ship-1 has the pilot and notable-1 plus an extra operations officer, so no roster matches it, but this roster's
    // people are all aboard already.
    const r = roster("roster-1", { seatAssignments: { pilot: "officer-1" }, pinnedNotableCrew: ["notable-1"] });
    const s0 = fleet([r]);
    const s = { ...s0, officers: s0.officers.map((o) => (o.id === "officer-3" ? { ...o, assignedShipId: "ship-1" } : o)) };
    expect(shipSetupUnsaved(s, "ship-1")).toBe(true);
    expect(shipRosterApplyWarns(s, "ship-1", "roster-1")).toBe(false);
  });

  it("does not warn when the engine refuses the apply (the button is disabled anyway)", () => {
    const r = roster("roster-1", { seatAssignments: { operations: "officer-3" } });
    expect(shipRosterApplyWarns(onMission(fleet([r])), "ship-1", "roster-1")).toBe(false);
  });
});

// === status line + default pick ===

describe("shipRosterStatusText / defaultShipRosterId", () => {
  it("names the matched roster, or says the ship's people are saved in none", () => {
    expect(shipRosterStatusText(fleet([SHIP1]), "ship-1")).toBe("Current officers and notable crew match Ship One.");
    expect(shipRosterStatusText(fleet(), "ship-1")).toBe("Current officers and notable crew are not saved in any roster.");
  });

  it("defaults to the matched roster, else the first offered, else nothing", () => {
    expect(defaultShipRosterId(fleet([roster("roster-0"), SHIP1]), "ship-1")).toBe("roster-1");
    expect(defaultShipRosterId(fleet([roster("roster-g", { includePeople: false }), roster("roster-0")]), "ship-1")).toBe("roster-0");
    expect(defaultShipRosterId(fleet(), "ship-1")).toBe("");
  });
});

// === why Apply is disabled ===

describe("shipRosterApplyBlock: the disabled reason", () => {
  it("is null when the engine would apply the pick", () => {
    const s = fleet([SHIP1]);
    expect(canApplyRoster(s, "roster-1", "ship-1").ok).toBe(true);
    expect(shipRosterApplyBlock(s, "ship-1", "roster-1")).toBeNull();
  });

  it("names the ship's own crew lock (CP-6) whatever is picked, with the lock flag", () => {
    const s = fleet([SHIP1]);
    expect(shipRosterApplyBlock(onMission(s), "ship-1", "roster-1")).toEqual({
      text: "Ship is out on a mission: crew changes wait until it returns.",
      locked: true,
    });
    expect(shipRosterApplyBlock(onExpedition(s, "ship-1"), "ship-1", "")).toEqual({
      text: "Ship is on an expedition: crew changes wait until its expedition is claimed.",
      locked: true,
    });
  });

  it("names a pinned person aboard another ship that is out, from the engine gate", () => {
    const r = roster("roster-1", { seatAssignments: { science: "officer-2" } });
    const s = onExpedition(fleet([r]), "ship-2");
    const gate = canApplyRoster(s, "roster-1", "ship-1");
    expect(gate.ok).toBe(false);
    expect(shipRosterApplyBlock(s, "ship-1", "roster-1")).toEqual({
      text: `${rosterApplyGateText(s, gate)}: crew changes wait until its expedition is claimed.`,
      locked: true,
    });
  });

  it("asks for a pick, refuses a roster without people, and names a roster that is gone", () => {
    const s = fleet([roster("roster-g", { includePeople: false })]);
    expect(shipRosterApplyBlock(s, "ship-1", "")).toEqual({ text: "Choose a roster to apply.", locked: false });
    expect(shipRosterApplyBlock(s, "ship-1", "roster-g")).toEqual({ text: "This roster carries no people to apply.", locked: false });
    expect(shipRosterApplyBlock(s, "ship-1", "roster-gone")).toEqual({ text: "That roster no longer exists.", locked: false });
  });
});
