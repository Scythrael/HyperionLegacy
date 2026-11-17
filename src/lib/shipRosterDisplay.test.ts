// CP-17 (E-CREW Task 30): the ship-screen roster picker's display decisions (shipRosterDisplay.ts): which rosters
// are offered, the unsaved-configuration warning condition, who an apply pulls off other ships, the status line, the
// default pick, the hull-mismatch line, and why Apply is disabled (the ship's own crew lock first, then the engine's
// gate for the pick).

import { describe, it, expect } from "vitest";
import { freshState, shipDisplayLabel, SHIP_TYPES } from "./game/model";
import type {
  CaptainMissionState,
  CrewBucket,
  Expedition,
  GameState,
  Loadout,
  NotableCrewMember,
  PersonnelRoster,
  SeniorStaffOfficer,
  ShipTypeKey,
} from "./game/model";
import { divisionCap } from "./game/commandStructure";
import { emptyGroundTeams } from "./game/groundTeams";
import { applyRoster, canApplyRoster, rosterApplyGateText } from "./game/personnelRosters";
import {
  defaultShipRosterId,
  ROSTER_PULL_TITLE,
  rosterApplyPulls,
  rosterApplyRefusal,
  rosterPullLine,
  rosterPullsLogText,
  shipMatchesRoster,
  shipMatchingRosterId,
  shipRosterApplyBlock,
  shipRosterApplyConfirm,
  shipRosterApplyWarns,
  shipRosterBlockLine,
  shipRosterEmptyText,
  shipRosterGearLine,
  shipRosterOptions,
  shipRosterStatusText,
  shipSetupUnsaved,
} from "./shipRosterDisplay";
import { crewModuleSiOffForThisFile } from "./game/crewModuleSiSwitch.fixture";

// Standard-Issue crew modules (0.14.0, user 2026-11-17 "free basic set, all ships"): this file's pins predate the
// free Sensor Suite, Bridge Module and Crew Quarters every ship now carries (their berths, officer lift, hull bonus
// and equipment ids), so the set is off here and the pins keep proving their own slice. The set itself is pinned in
// crewModuleStandardIssue.test.ts.
crewModuleSiOffForThisFile();

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

// fleet() plus officer-4, a second pilot waiting unassigned: pinning it evicts officer-1 from ship-1's pilot seat.
function withSecondPilot(rosters: PersonnelRoster[]): GameState {
  const s = fleet(rosters);
  return { ...s, officers: [...s.officers, officer("officer-4", "pilot", null)], nextOfficerId: 5 };
}

// fleet() with ship-1's security division full once notable-1 is counted, so a security pin not aboard cannot land.
function securityFull(rosters: PersonnelRoster[]): GameState {
  const s = fleet(rosters);
  const bulk: CrewBucket = { profession: "security", rarity: "standard", rank: 1, race: "earthBorn", buff1Id: "sec.boarding", buff2Id: null, count: divisionCap("generalFreighter", "security") - 1 };
  return { ...s, ships: s.ships.map((x) => (x.id === "ship-1" ? { ...x, complement: { buckets: [bulk], mode: "active" as const } } : x)) };
}

function loadout(id: string, shipTypeKey: ShipTypeKey, checkedOutToShipId: string | null = null): Loadout {
  return { id, name: `Loadout ${id}`, shipTypeKey, slots: {}, checkedOutToShipId };
}

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

describe("shipRosterApplyWarns: Apply warns only when something on an unsaved ship is really lost", () => {
  it("does not warn on a purely additive apply: an empty seat filled and a notable added take no one off the ship", () => {
    const r = roster("roster-1", { seatAssignments: { operations: "officer-3" }, pinnedNotableCrew: ["notable-3"] });
    const s = fleet([r]);
    expect(shipSetupUnsaved(s, "ship-1")).toBe(true);
    expect(shipRosterApplyWarns(s, "ship-1", "roster-1")).toBe(false);
  });

  it("warns when a pinned officer replaces a seated one, and the seated officer really is unseated", () => {
    const r = roster("roster-1", { seatAssignments: { pilot: "officer-4" } });
    const s = withSecondPilot([r]);
    expect(shipSetupUnsaved(s, "ship-1")).toBe(true);
    expect(shipRosterApplyWarns(s, "ship-1", "roster-1")).toBe(true);
    const after = applyRoster(s, "roster-1", "ship-1");
    expect(after.officers.find((o) => o.id === "officer-1")!.assignedShipId).toBeNull();
    expect(after.officers.find((o) => o.id === "officer-4")!.assignedShipId).toBe("ship-1");
  });

  it("does not warn when a saved roster matches the ship, even if the pick evicts (the setup can be applied back)", () => {
    const other = roster("roster-2", { seatAssignments: { pilot: "officer-4" } });
    const s = withSecondPilot([SHIP1, other]);
    expect(shipRosterApplyWarns(s, "ship-1", "roster-2")).toBe(false);
  });

  it("does not warn for a roster blank against an occupied seat: that seat keeps its officer", () => {
    const r = roster("roster-1", { seatAssignments: { operations: "officer-3" } });
    const s = fleet([r]);
    expect(shipMatchesRoster(s, "ship-1", r)).toBe(false);
    expect(shipRosterApplyWarns(s, "ship-1", "roster-1")).toBe(false);
    expect(applyRoster(s, "roster-1", "ship-1").officers.find((o) => o.id === "officer-1")!.assignedShipId).toBe("ship-1");
  });

  it("the engine takes no notable crew and no bulk off the target ship (why only a seat can be lost)", () => {
    const bulk: CrewBucket = { profession: "security", rarity: "standard", rank: 1, race: "earthBorn", buff1Id: "sec.boarding", buff2Id: null, count: 2 };
    const r = roster("roster-1", { seatAssignments: { pilot: "officer-4" }, pinnedNotableCrew: ["notable-3"] });
    const s0 = withSecondPilot([r]);
    const s = { ...s0, ships: s0.ships.map((x) => (x.id === "ship-1" ? { ...x, complement: { buckets: [bulk], mode: "active" as const } } : x)) };
    const after = applyRoster(s, "roster-1", "ship-1");
    expect(after.notableCrew.find((n) => n.id === "notable-1")!.assignedShipId).toBe("ship-1");
    expect(after.ships[0].complement!.buckets).toEqual([bulk]);
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

// === who an apply pulls off other ships ===

describe("rosterApplyPulls / shipRosterApplyConfirm: anyone pulled off another ship is named before Apply", () => {
  it("names a pinned officer and a pinned notable serving on another idle ship, with that ship, as the engine moves them", () => {
    const r = roster("roster-1", { seatAssignments: { science: "officer-2" }, pinnedNotableCrew: ["notable-2"] });
    const s = fleet([r]);
    const from = shipDisplayLabel(s, s.ships[1]);
    expect(rosterApplyPulls(s, "roster-1", "ship-1")).toEqual([
      { id: "officer-2", name: "Officer officer-2", fromShipId: "ship-2", fromShipLabel: from },
      { id: "notable-2", name: "Notable notable-2", fromShipId: "ship-2", fromShipLabel: from },
    ]);
    const after = applyRoster(s, "roster-1", "ship-1");
    expect(after.officers.find((o) => o.id === "officer-2")!.assignedShipId).toBe("ship-1");
    expect(after.notableCrew.find((n) => n.id === "notable-2")!.assignedShipId).toBe("ship-1");
  });

  it("asks even when nothing is lost on this ship (a saved ship, an empty seat filled), under the pull title", () => {
    const pull = roster("roster-2", { seatAssignments: { science: "officer-2" } });
    const s = fleet([SHIP1, pull]);
    expect(shipRosterApplyWarns(s, "ship-1", "roster-2")).toBe(false);
    const step = shipRosterApplyConfirm(s, "ship-1", "roster-2");
    expect(step?.title).toBe(ROSTER_PULL_TITLE);
    expect(step?.unsaved).toBe(false);
    expect(step?.pulls.map((p) => p.id)).toEqual(["officer-2"]);
  });

  it("combines the unsaved warning and the pull into one step when both apply", () => {
    const r = roster("roster-1", { seatAssignments: { pilot: "officer-5" } });
    const s0 = fleet([r]);
    const s = { ...s0, officers: [...s0.officers, officer("officer-5", "pilot", "ship-2")], nextOfficerId: 6 };
    const step = shipRosterApplyConfirm(s, "ship-1", "roster-1");
    expect(step?.title).toBe("Unsaved Configuration");
    expect(step?.unsaved).toBe(true);
    expect(step?.pulls.map((p) => p.id)).toEqual(["officer-5"]);
  });

  it("the unsaved warning alone has no pulls; an apply with neither opens no step", () => {
    const evict = roster("roster-1", { seatAssignments: { pilot: "officer-4" } });
    const additive = roster("roster-2", { seatAssignments: { operations: "officer-3" }, pinnedNotableCrew: ["notable-3"] });
    const s = withSecondPilot([evict, additive]);
    expect(shipRosterApplyConfirm(s, "ship-1", "roster-1")).toEqual({ title: "Unsaved Configuration", unsaved: true, pulls: [] });
    expect(shipRosterApplyConfirm(s, "ship-1", "roster-2")).toBeNull();
    expect(rosterApplyPulls(s, "roster-2", "ship-1")).toEqual([]);
  });

  it("does not list someone already aboard, or a notable the caps keep off this ship (the engine leaves it there)", () => {
    const r = roster("roster-1", { seatAssignments: { pilot: "officer-1" }, pinnedNotableCrew: ["notable-1", "notable-2"] });
    const s = securityFull([r]);
    expect(rosterApplyPulls(s, "roster-1", "ship-1")).toEqual([]);
    expect(applyRoster(s, "roster-1", "ship-1").notableCrew.find((n) => n.id === "notable-2")!.assignedShipId).toBe("ship-2");
  });

  it("lists no one for a refused apply (the target ship out, or the pin's ship out)", () => {
    const r = roster("roster-1", { seatAssignments: { science: "officer-2" } });
    expect(rosterApplyPulls(onMission(fleet([r])), "roster-1", "ship-1")).toEqual([]);
    expect(shipRosterApplyConfirm(onMission(fleet([r])), "ship-1", "roster-1")).toBeNull();
    expect(rosterApplyPulls(onExpedition(fleet([r]), "ship-2"), "roster-1", "ship-1")).toEqual([]);
  });

  it("the same person pinned in two rosters: the second apply on that ship pulls no one; from another ship it pulls them back", () => {
    const a = roster("roster-1", { name: "A", seatAssignments: { science: "officer-2" } });
    const b = roster("roster-2", { name: "B", seatAssignments: { science: "officer-2" } });
    const s = fleet([a, b]);
    const after = applyRoster(s, "roster-1", "ship-1");
    expect(rosterApplyPulls(after, "roster-2", "ship-1")).toEqual([]);
    expect(rosterApplyPulls(after, "roster-2", "ship-2").map((p) => [p.id, p.fromShipId])).toEqual([["officer-2", "ship-1"]]);
  });

  it("writes the confirm line and the log line naming each person and the ship they left", () => {
    const pulls = [
      { id: "officer-2", name: "Ann", fromShipId: "ship-2", fromShipLabel: "Dawn" },
      { id: "notable-2", name: "Bo", fromShipId: "ship-3", fromShipLabel: "Dusk" },
    ];
    expect(rosterPullLine(pulls[0])).toBe("Ann, from Dawn");
    expect(rosterPullsLogText("Alpha", pulls)).toBe('Roster "Alpha" pulled Ann from Dawn, Bo from Dusk.');
  });
});

// === the same person pinned in two rosters ===

describe("two rosters that pin the same people", () => {
  it("names the first in saved order, and applying the other changes nothing here, so no step opens", () => {
    const twin = roster("roster-2", { name: "Twin", seatAssignments: { pilot: "officer-1" }, pinnedNotableCrew: ["notable-1"] });
    const s = fleet([SHIP1, twin]);
    expect(shipMatchingRosterId(s, "ship-1")).toBe("roster-1");
    expect(shipRosterStatusText(s, "ship-1")).toBe("Current officers and notable crew match Ship One.");
    expect(shipRosterApplyConfirm(s, "ship-1", "roster-2")).toBeNull();
  });
});

// === a clean apply that skipped a pin at a cap ===

describe("a pin the ship's caps keep out", () => {
  const capped = roster("roster-1", { name: "Capped", seatAssignments: { pilot: "officer-1" }, pinnedNotableCrew: ["notable-1", "notable-3"] });

  it("still reads as this roster's people, saying so, because applying it again would change nothing", () => {
    const s = securityFull([capped]);
    const after = applyRoster(s, "roster-1", "ship-1");
    expect(after.notableCrew.find((n) => n.id === "notable-3")!.assignedShipId ?? null).toBeNull();
    expect(shipMatchingRosterId(after, "ship-1")).toBe("roster-1");
    expect(shipSetupUnsaved(after, "ship-1")).toBe(false);
    expect(shipRosterStatusText(after, "ship-1")).toBe("Current officers and notable crew match Capped, as far as this ship's caps allow.");
  });

  it("prefers an exact match over a capped one, whatever the saved order", () => {
    const exact = roster("roster-2", { name: "Exact", seatAssignments: { pilot: "officer-1" }, pinnedNotableCrew: ["notable-1"] });
    const s = securityFull([capped, exact]);
    expect(shipMatchingRosterId(s, "ship-1")).toBe("roster-2");
    expect(shipRosterStatusText(s, "ship-1")).toBe("Current officers and notable crew match Exact.");
  });

  it("is no match with room for the pin, or while the ship is locked (a refused apply proves nothing)", () => {
    expect(shipMatchingRosterId(fleet([capped]), "ship-1")).toBeNull();
    expect(shipMatchingRosterId(onMission(securityFull([capped])), "ship-1")).toBeNull();
  });
});

// === the hull-mismatch line ===

describe("shipRosterGearLine: a linked loadout for another hull stays in the Armory", () => {
  function linked(lo: Loadout, patch: Partial<PersonnelRoster> = {}): GameState {
    return { ...fleet([roster("roster-1", { linkedLoadoutId: lo.id, ...patch })]), loadouts: [lo] };
  }

  it("says so when the loadout is free and pinned to another hull; the engine lands the people and leaves the gear", () => {
    const s = linked(loadout("loadout-1", "prospectorMiner"), { seatAssignments: { operations: "officer-3" } });
    expect(shipRosterGearLine(s, "ship-1", "roster-1")).toBe("Gear stays in the Armory: this loadout is for a Prospector.");
    const after = applyRoster(s, "roster-1", "ship-1");
    expect(after.officers.find((o) => o.id === "officer-3")!.assignedShipId).toBe("ship-1");
    expect(after.loadouts[0].checkedOutToShipId).toBeNull();
  });

  it("uses the right article for the hull's name", () => {
    const key = (Object.keys(SHIP_TYPES) as ShipTypeKey[]).find((k) => SHIP_TYPES[k].label === "Aurora")!;
    expect(shipRosterGearLine(linked(loadout("loadout-1", key)), "ship-1", "roster-1")).toBe("Gear stays in the Armory: this loadout is for an Aurora.");
  });

  it("is silent when the hull matches (the engine checks the loadout out)", () => {
    const s = linked(loadout("loadout-1", "generalFreighter"));
    expect(shipRosterGearLine(s, "ship-1", "roster-1")).toBeNull();
    expect(applyRoster(s, "roster-1", "ship-1").loadouts[0].checkedOutToShipId).toBe("ship-1");
  });

  it("is silent when another ship wears it: it stays on that ship, not in the Armory", () => {
    const s = linked(loadout("loadout-1", "prospectorMiner", "ship-2"));
    expect(shipRosterGearLine(s, "ship-1", "roster-1")).toBeNull();
    expect(applyRoster(s, "roster-1", "ship-1").loadouts[0].checkedOutToShipId).toBe("ship-2");
  });

  it("is silent with no link, a loadout that is gone, a gear-only roster, an unknown ship, or a refused apply", () => {
    const lo = loadout("loadout-1", "prospectorMiner");
    expect(shipRosterGearLine(fleet([roster("roster-1")]), "ship-1", "roster-1")).toBeNull();
    expect(shipRosterGearLine({ ...linked(lo), loadouts: [] }, "ship-1", "roster-1")).toBeNull();
    expect(shipRosterGearLine(linked(lo, { includePeople: false }), "ship-1", "roster-1")).toBeNull();
    expect(shipRosterGearLine(linked(lo), "ship-gone", "roster-1")).toBeNull();
    expect(shipRosterGearLine(onMission(linked(lo)), "ship-1", "roster-1")).toBeNull();
    expect(shipRosterGearLine(linked(lo), "ship-1", "")).toBeNull();
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

describe("shipRosterBlockLine: the ship's own lock is stated once, by the pane", () => {
  it("prints no line for the ship's own lock, though Apply stays blocked with the reason", () => {
    const s = onMission(fleet([SHIP1]));
    expect(shipRosterBlockLine(s, "ship-1", "roster-1")).toBeNull();
    expect(shipRosterApplyBlock(s, "ship-1", "roster-1")?.locked).toBe(true);
  });

  it("still prints a pinned person's lock on another ship, which no pane states", () => {
    const s = onExpedition(fleet([roster("roster-1", { seatAssignments: { science: "officer-2" } })]), "ship-2");
    expect(shipRosterBlockLine(s, "ship-1", "roster-1")).toEqual(shipRosterApplyBlock(s, "ship-1", "roster-1"));
    expect(shipRosterBlockLine(s, "ship-1", "roster-1")).not.toBeNull();
  });
});

// The facility's Apply reads this: its words must stay what the facility printed itself before CP-17.
describe("rosterApplyRefusal: the facility's gate words", () => {
  it("is null when the gate is open, including a gear-only roster (the facility has no line for that)", () => {
    expect(rosterApplyRefusal(fleet([SHIP1]), "roster-1", "ship-1")).toBeNull();
    expect(rosterApplyRefusal(fleet([roster("roster-1", { includePeople: false })]), "roster-1", "ship-1")).toBeNull();
  });

  it("gives the bare reason for the title and the full line, as the gate text plus the lock's duration", () => {
    const s = onMission(fleet([SHIP1]));
    expect(rosterApplyRefusal(s, "roster-1", "ship-1")).toEqual({
      why: "Ship is out on a mission",
      text: "Ship is out on a mission: crew changes wait until it returns.",
      locked: true,
    });
    const pin = onExpedition(fleet([roster("roster-1", { seatAssignments: { science: "officer-2" } })]), "ship-2");
    const gate = canApplyRoster(pin, "roster-1", "ship-1");
    expect(rosterApplyRefusal(pin, "roster-1", "ship-1")).toEqual({
      why: rosterApplyGateText(pin, gate),
      text: `${rosterApplyGateText(pin, gate)}: crew changes wait until its expedition is claimed.`,
      locked: true,
    });
  });

  it("has no lock glyph or duration for a roster or ship that is gone", () => {
    const s = fleet([SHIP1]);
    expect(rosterApplyRefusal(s, "roster-gone", "ship-1")).toEqual({ why: "That roster no longer exists", text: "That roster no longer exists.", locked: false });
    expect(rosterApplyRefusal(s, "roster-1", "ship-gone")).toEqual({ why: "That ship is no longer in the fleet", text: "That ship is no longer in the fleet.", locked: false });
  });
});
