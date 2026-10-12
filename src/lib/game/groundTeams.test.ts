// Ground Operations GO-1: the per-ship ground-team slot state (D25, plan section 2) and its pure readers.
// Nothing in the engine reads these yet (GO-2 slots members, GO-7 dispatches by slot).

import { afterEach, describe, expect, it } from "vitest";
import { freshState, SHIP_TYPES, type ShipInstance, type ShipTypeKey } from "./model";
import { squadSlots } from "./awayTeam";
import {
  GROUND_TEAM_DEFAULT_NAMES,
  backfillShipGroundTeams,
  emptyGroundTeams,
  groundSquadSize,
  groundTeamCount,
  groundTeamName,
  groundTeamShortLabel,
  isWellFormedGroundTeamLoadout,
  isWellFormedShipGroundTeams,
  shipGroundTeams,
} from "./groundTeams";
import { plainAwayMember, registerSyntheticHull } from "./awayTeamTestFixtures";

const HULLS = Object.keys(SHIP_TYPES) as ShipTypeKey[];

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

describe("groundTeamCount / groundSquadSize (D25: one ground team = a Security squad + a Science squad)", () => {
  it("is 1 on every hull today, with the squad sizes the hull lists", () => {
    for (const key of HULLS) {
      expect(groundTeamCount(key), key).toBe(1);
      // count 1, so a team's squad size is the hull's whole squad capacity
      expect(groundSquadSize(key, "security"), key).toBe(squadSlots(key, "security"));
      expect(groundSquadSize(key, "science"), key).toBe(squadSlots(key, "science"));
    }
  });

  it("a synthetic hull with count 3 fields 3 teams with the entry's sizes", () => {
    const key = "syntheticTriple" as ShipTypeKey;
    cleanup = registerSyntheticHull(key, [
      { teamType: "security", size: 4, count: 3 },
      { teamType: "science", size: 2, count: 3 },
    ]);
    expect(groundTeamCount(key)).toBe(3);
    expect(groundSquadSize(key, "security")).toBe(4);
    expect(groundSquadSize(key, "science")).toBe(2);
    const teams = emptyGroundTeams(key);
    expect(teams).toHaveLength(3);
    for (const t of teams) {
      expect(t).toEqual({ security: [null, null, null, null], science: [null, null], helpOthers: false });
    }
    // fresh arrays per team (never aliased)
    expect(teams[0].security).not.toBe(teams[1].security);
  });

  it("a hull missing awayTeams (or an unknown key) fields 0 teams", () => {
    const key = "syntheticBare" as ShipTypeKey;
    cleanup = registerSyntheticHull(key, undefined);
    expect(groundTeamCount(key)).toBe(0);
    expect(groundSquadSize(key, "security")).toBe(0);
    expect(emptyGroundTeams(key)).toEqual([]);
    expect(groundTeamCount("noSuchHull" as ShipTypeKey)).toBe(0);
    expect(emptyGroundTeams("noSuchHull" as ShipTypeKey)).toEqual([]);
  });

  it("a hull with Security but no Science entry gets empty Science slot lists", () => {
    const key = "syntheticNoScience" as ShipTypeKey;
    cleanup = registerSyntheticHull(key, [{ teamType: "security", size: 2, count: 1 }]);
    expect(emptyGroundTeams(key)).toEqual([{ security: [null, null], science: [], helpOthers: false }]);
  });
});

describe("ground team names (user 9b.7: Alpha / Bravo / Charlie, renameable; short A / B / C)", () => {
  const ship = (groundTeams?: ShipInstance["groundTeams"]): ShipInstance => ({
    id: "ship-1",
    typeKey: "generalFreighter",
    assignedCaptainId: 1,
    ...(groundTeams ? { groundTeams } : {}),
  });

  it("defaults by index", () => {
    expect(GROUND_TEAM_DEFAULT_NAMES).toEqual(["Alpha", "Bravo", "Charlie"]);
    const s = ship();
    expect(groundTeamName(s, 0)).toBe("Alpha");
    expect(groundTeamName(s, 1)).toBe("Bravo");
    expect(groundTeamName(s, 2)).toBe("Charlie");
    expect(groundTeamName(s, 3)).toBe("Team 4");
  });

  it("a custom name wins; a blank one reads as the default", () => {
    const teams = [
      { name: "Red Squad", security: [null, null, null], science: [null, null, null], helpOthers: false },
    ];
    expect(groundTeamName(ship(teams), 0)).toBe("Red Squad");
    const blank = [{ name: "   ", security: [null, null, null], science: [null, null, null], helpOthers: false }];
    expect(groundTeamName(ship(blank), 0)).toBe("Alpha");
  });

  it("short labels go by INDEX, even after a rename", () => {
    expect([0, 1, 2].map(groundTeamShortLabel)).toEqual(["A", "B", "C"]);
    expect(groundTeamShortLabel(3)).toBe("D");
  });
});

describe("shipGroundTeams (absent-safe reader)", () => {
  it("returns the stored value when present", () => {
    const groundTeams = [{ security: ["member-1", null, null], science: [null, null, null], helpOthers: true }];
    const s: ShipInstance = { id: "ship-1", typeKey: "generalFreighter", assignedCaptainId: 1, groundTeams };
    expect(shipGroundTeams(s)).toBe(groundTeams);
  });

  it("reads an absent value as the hull's empty teams", () => {
    const s: ShipInstance = { id: "ship-9", typeKey: "destroyer", assignedCaptainId: null };
    expect(shipGroundTeams(s)).toEqual(emptyGroundTeams("destroyer"));
  });
});

describe("well-formedness guards (what the v66 -> v67 migration keeps)", () => {
  it("accepts the hull-sized shape, with or without a custom name", () => {
    expect(isWellFormedShipGroundTeams(emptyGroundTeams("generalFreighter"), "generalFreighter")).toBe(true);
    const named = [{ name: "Red", security: ["member-1", null, null], science: [null, "member-2", null], helpOthers: true }];
    expect(isWellFormedShipGroundTeams(named, "generalFreighter")).toBe(true);
  });

  it("rejects wrong team counts, wrong slot lengths, bad entries and non-arrays", () => {
    const ok = () => ({ security: [null, null, null] as (string | null)[], science: [null, null, null] as (string | null)[], helpOthers: false });
    expect(isWellFormedShipGroundTeams(undefined, "generalFreighter")).toBe(false);
    expect(isWellFormedShipGroundTeams("x", "generalFreighter")).toBe(false);
    expect(isWellFormedShipGroundTeams([], "generalFreighter")).toBe(false);
    expect(isWellFormedShipGroundTeams([ok(), ok()], "generalFreighter")).toBe(false);
    expect(isWellFormedShipGroundTeams([{ ...ok(), security: [null, null] }], "generalFreighter")).toBe(false);
    expect(isWellFormedShipGroundTeams([{ ...ok(), science: [null, 7, null] }], "generalFreighter")).toBe(false);
    expect(isWellFormedShipGroundTeams([{ ...ok(), helpOthers: "yes" }], "generalFreighter")).toBe(false);
    expect(isWellFormedShipGroundTeams([{ ...ok(), name: 5 }], "generalFreighter")).toBe(false);
    expect(isWellFormedShipGroundTeams([null], "generalFreighter")).toBe(false);
  });

  it("accepts a well-formed ground team loadout and rejects the never-built per-type shape", () => {
    const kit = { armor: null, weapon: "equip-1", tool: null, implants: [] };
    expect(
      isWellFormedGroundTeamLoadout({ id: "squad-1", name: "Alpha kit", security: [kit], science: [], checkedOutTo: null }),
    ).toBe(true);
    expect(
      isWellFormedGroundTeamLoadout({
        id: "squad-1", name: "Alpha kit", security: [kit], science: [kit],
        checkedOutTo: { shipId: "ship-1", teamIndex: 0 },
      }),
    ).toBe(true);
    // The old Task 2 SquadLoadout shape (per team TYPE): never created by any build
    expect(
      isWellFormedGroundTeamLoadout({ id: "squad-1", name: "Survey", teamType: "science", kits: [kit], checkedOutToShipId: null }),
    ).toBe(false);
    expect(
      isWellFormedGroundTeamLoadout({ id: "squad-1", name: "x", security: [{ ...kit, implants: [3] }], science: [], checkedOutTo: null }),
    ).toBe(false);
    expect(
      isWellFormedGroundTeamLoadout({ id: "squad-1", name: "x", security: [], science: [], checkedOutTo: { shipId: "ship-1" } }),
    ).toBe(false);
    expect(isWellFormedGroundTeamLoadout(null)).toBe(false);
  });
});

describe("backfillShipGroundTeams (the v67 slot fill: hire order, today's first N members)", () => {
  it("fills Security and Science slots by hire order, injured included; overflow stays unslotted", () => {
    const ship: ShipInstance = { id: "ship-1", typeKey: "generalFreighter", assignedCaptainId: 1 };
    const members = [
      plainAwayMember("member-9", "security", "ship-1"),
      { ...plainAwayMember("member-3", "security", "ship-1"), injuredUntilSeconds: 99_999 },
      plainAwayMember("member-12", "security", "ship-1"),
      plainAwayMember("member-5", "security", "ship-1"),
      plainAwayMember("member-7", "science", "ship-1"),
      plainAwayMember("member-4", "science", "ship-1"),
      plainAwayMember("member-1", "security", "ship-2"), // another ship
      plainAwayMember("member-2", "science", null as unknown as string), // unassigned
      plainAwayMember("member-6", "prospecting", "ship-1"), // no ground squad of this type
    ];
    expect(backfillShipGroundTeams(ship, members)).toEqual([
      { security: ["member-3", "member-5", "member-9"], science: ["member-4", "member-7", null], helpOthers: false },
    ]);
  });

  it("fills team 0 first, then team 1, ...", () => {
    const key = "syntheticPair" as ShipTypeKey;
    cleanup = registerSyntheticHull(key, [
      { teamType: "security", size: 2, count: 2 },
      { teamType: "science", size: 1, count: 2 },
    ]);
    const ship: ShipInstance = { id: "ship-7", typeKey: key, assignedCaptainId: null };
    const members = ["member-1", "member-2", "member-3", "member-4", "member-5"].map((id) =>
      plainAwayMember(id, "security", "ship-7"),
    );
    members.push(plainAwayMember("member-6", "science", "ship-7"));
    expect(backfillShipGroundTeams(ship, members)).toEqual([
      { security: ["member-1", "member-2"], science: ["member-6"], helpOthers: false },
      { security: ["member-3", "member-4"], science: [null], helpOthers: false },
    ]);
  });

  it("skips malformed member entries", () => {
    const ship: ShipInstance = { id: "ship-1", typeKey: "generalFreighter", assignedCaptainId: 1 };
    const members = [null, 7, { id: 3 }, plainAwayMember("member-2", "science", "ship-1")] as unknown[];
    expect(backfillShipGroundTeams(ship, members)).toEqual([
      { security: [null, null, null], science: ["member-2", null, null], helpOthers: false },
    ]);
  });
});

describe("freshState ground teams", () => {
  it("gives the starting ship well-formed, empty ground teams", () => {
    const s = freshState();
    const ship = s.ships[0];
    expect(ship.groundTeams).toEqual(emptyGroundTeams(ship.typeKey));
    expect(isWellFormedShipGroundTeams(ship.groundTeams, ship.typeKey)).toBe(true);
    expect(s.squadLoadouts).toEqual([]);
  });
});
