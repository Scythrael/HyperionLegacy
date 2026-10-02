// E-CREW: tests for the away-team engine (awayTeam.ts). Covers the per-ship-type squad sizes
// (design section 5.2). Nothing here exercises the tick or the UI (the engine is not wired in yet).

import { describe, it, expect } from "vitest";
import { freshState, SHIP_TYPES } from "./model";
import type { AwayMember, AwayTeamType, GameState, ShipTypeKey } from "./model";
import { squadSlots, membersInSquad, squadHasRoom } from "./awayTeam";

// --- fixtures ---------------------------------------------------------------

// A minimal hired member on `shipId`'s `teamType` squad. Only the fields the squad readers look at
// matter; the rest are plausible placeholders.
function member(id: string, teamType: AwayTeamType, shipId: string | null): AwayMember {
  return {
    id,
    teamType,
    spec: teamType === "science" ? "geology" : "offense",
    name: `Member ${id}`,
    race: "earthBorn",
    gender: "female",
    rank: 1,
    traits: [],
    assignedShipId: shipId,
  };
}

// A fresh state whose ships are copies of the starting hull, re-ided and re-typed as asked.
function stateWithShips(ships: { id: string; typeKey: ShipTypeKey }[], members: AwayMember[] = []): GameState {
  const base = freshState();
  return {
    ...base,
    ships: ships.map((s) => ({ ...base.ships[0], id: s.id, typeKey: s.typeKey, assignedCaptainId: null })),
    awayMembers: members,
  };
}

const ALL_TYPE_KEYS = Object.keys(SHIP_TYPES) as ShipTypeKey[];

// --- Task 3: squad sizes ----------------------------------------------------

describe("squadSlots (design section 5.2)", () => {
  it("Eir fields 4 Security and 4 Science", () => {
    expect(squadSlots("eir", "security")).toBe(4);
    expect(squadSlots("eir", "science")).toBe(4);
  });

  it("Destroyer fields 4 Security and 3 Science", () => {
    expect(squadSlots("destroyer", "security")).toBe(4);
    expect(squadSlots("destroyer", "science")).toBe(3);
  });

  it("Orion fields 3 Security and 4 Science", () => {
    expect(squadSlots("orion", "security")).toBe(3);
    expect(squadSlots("orion", "science")).toBe(4);
  });

  it("matches the whole design table", () => {
    const table: Record<ShipTypeKey, [number, number]> = {
      generalFreighter: [3, 3],
      prospectorHauler: [3, 3],
      prospectorRunner: [3, 3],
      prospectorMiner: [3, 3],
      destroyer: [4, 3],
      battleship: [4, 3],
      carrier: [4, 3],
      orion: [3, 4],
      aurora: [3, 4],
      eir: [4, 4],
    };
    for (const key of ALL_TYPE_KEYS) {
      expect([squadSlots(key, "security"), squadSlots(key, "science")], key).toEqual(table[key]);
    }
  });

  it("prospecting is wired on every hull but never fielded (0 slots)", () => {
    for (const key of ALL_TYPE_KEYS) {
      expect(squadSlots(key, "prospecting"), key).toBe(0);
      expect(SHIP_TYPES[key].awayTeams?.some((t) => t.teamType === "prospecting"), key).toBe(true);
    }
  });

  it("every ship type lists a Security and a Science squad", () => {
    for (const key of ALL_TYPE_KEYS) {
      const teams = SHIP_TYPES[key].awayTeams ?? [];
      expect(teams.some((t) => t.teamType === "security" && t.count >= 1), key).toBe(true);
      expect(teams.some((t) => t.teamType === "science" && t.count >= 1), key).toBe(true);
    }
  });

  it("a hull with no awayTeams data returns 0", () => {
    const saved = SHIP_TYPES.eir.awayTeams;
    try {
      delete SHIP_TYPES.eir.awayTeams;
      expect(squadSlots("eir", "security")).toBe(0);
      expect(squadSlots("eir", "science")).toBe(0);
    } finally {
      SHIP_TYPES.eir.awayTeams = saved;
    }
  });

  it("an unknown type key returns 0 rather than throwing", () => {
    expect(squadSlots("noSuchHull" as ShipTypeKey, "security")).toBe(0);
  });
});

describe("membersInSquad / squadHasRoom", () => {
  it("lists only the members on that ship's matching squad", () => {
    const s = stateWithShips(
      [
        { id: "ship-a", typeKey: "destroyer" },
        { id: "ship-b", typeKey: "destroyer" },
      ],
      [
        member("member-1", "security", "ship-a"),
        member("member-2", "science", "ship-a"),
        member("member-3", "security", "ship-b"),
        member("member-4", "security", null),
      ],
    );
    expect(membersInSquad(s, "ship-a", "security").map((m) => m.id)).toEqual(["member-1"]);
    expect(membersInSquad(s, "ship-a", "science").map((m) => m.id)).toEqual(["member-2"]);
    expect(membersInSquad(s, "ship-b", "science")).toEqual([]);
  });

  it("has room until the squad reaches its size, then refuses", () => {
    const three = [1, 2, 3].map((n) => member(`member-${n}`, "science", "ship-a"));
    const s = stateWithShips([{ id: "ship-a", typeKey: "destroyer" }], three); // Destroyer Science = 3
    expect(squadHasRoom(s, "ship-a", "science")).toBe(false);
    expect(squadHasRoom(s, "ship-a", "security")).toBe(true);
    const two = stateWithShips([{ id: "ship-a", typeKey: "destroyer" }], three.slice(0, 2));
    expect(squadHasRoom(two, "ship-a", "science")).toBe(true);
  });

  it("never has room on a prospecting squad, or on a ship that does not exist", () => {
    const s = stateWithShips([{ id: "ship-a", typeKey: "eir" }]);
    expect(squadHasRoom(s, "ship-a", "prospecting")).toBe(false);
    expect(squadHasRoom(s, "ship-missing", "security")).toBe(false);
  });
});
