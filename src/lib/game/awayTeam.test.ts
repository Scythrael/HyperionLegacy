// E-CREW: tests for the away-team engine (awayTeam.ts). Covers the per-ship-type squad sizes
// (design section 5.2) and the derived recruit board (section 5.1: determinism, window steps, squad /
// spec / trait / rank / race rolls, augment affinity). Nothing here exercises the tick or the UI (the engine is not wired in yet).

import { describe, it, expect } from "vitest";
import { freshState, SHIP_TYPES, SENIOR_STAFF_ROSTER_BASE } from "./model";
import type { AwayMember, AwayTeamType, GameState, ShipTypeKey } from "./model";
import {
  squadSlots,
  membersInSquad,
  squadHasRoom,
  traitCountForRank,
  AUGMENT_AFFINITY_RACES,
  implantSlotsFor,
  specsFor,
  awayRecruitCandidates,
} from "./awayTeam";
import { getAwayTrait } from "./awayTraits";
import { buffCountForRank, CREW_RANK_ORDER } from "./crewRank";
import { CREW_RACE_IDS } from "./crewRaces";
import { OFFICER_ROSTER_WINDOW_SECONDS, seniorStaffCandidates } from "./seniorStaff";

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

// --- Task 4: traits + the derived recruit board ------------------------------

// A fresh state at a given game time / recruit seed / board size.
function boardState(opts: { gameTimeSeconds?: number; seed?: number; rosterSize?: number } = {}): GameState {
  const base = freshState();
  return {
    ...base,
    gameTimeSeconds: opts.gameTimeSeconds ?? 0,
    awayRecruitSeed: opts.seed ?? base.awayRecruitSeed,
    seniorStaffRosterSize: opts.rosterSize ?? base.seniorStaffRosterSize,
  };
}

describe("traitCountForRank / implantSlotsFor / specsFor", () => {
  it("trait count follows the complement buff-count ladder", () => {
    for (const rank of CREW_RANK_ORDER) expect(traitCountForRank(rank)).toBe(buffCountForRank(rank));
  });

  it("Martian and Stheni carry augment affinity (2 implant slots); everyone else 1", () => {
    expect(AUGMENT_AFFINITY_RACES.has("martian")).toBe(true);
    expect(AUGMENT_AFFINITY_RACES.has("stheni")).toBe(true);
    for (const race of CREW_RACE_IDS) {
      const expected = race === "martian" || race === "stheni" ? 2 : 1;
      expect(implantSlotsFor({ ...member("member-1", "security", null), race }), race).toBe(expected);
    }
  });

  it("each squad type has its own spec set; prospecting has none yet", () => {
    expect(specsFor("security")).toEqual(["offense", "defense", "debuff"]);
    expect(specsFor("science")).toEqual(["archaeology", "xenobiology", "geology", "cryptography"]);
    expect(specsFor("prospecting")).toEqual([]);
  });
});

describe("awayRecruitCandidates (derived board)", () => {
  it("is deterministic: same state, same board", () => {
    const s = boardState({ gameTimeSeconds: 12_345 });
    expect(awayRecruitCandidates(s)).toEqual(awayRecruitCandidates(s));
    expect(awayRecruitCandidates(s)).toEqual(awayRecruitCandidates({ ...s, gameTimeSeconds: 12_999 })); // same window
  });

  it("sizes the board from the shared seniorStaffRosterSize, defaulting to the base", () => {
    expect(awayRecruitCandidates(boardState())).toHaveLength(SENIOR_STAFF_ROSTER_BASE);
    expect(awayRecruitCandidates(boardState({ rosterSize: 4 }))).toHaveLength(4);
    const { seniorStaffRosterSize: _drop, ...noSize } = boardState();
    expect(awayRecruitCandidates(noSize as GameState)).toHaveLength(SENIOR_STAFF_ROSTER_BASE);
  });

  it("changes when the roster window steps, and when the seed changes", () => {
    const a = awayRecruitCandidates(boardState({ gameTimeSeconds: 0 }));
    const b = awayRecruitCandidates(boardState({ gameTimeSeconds: OFFICER_ROSTER_WINDOW_SECONDS }));
    const c = awayRecruitCandidates(boardState({ seed: 12345 }));
    expect(b.map((m) => m.name)).not.toEqual(a.map((m) => m.name));
    expect(c.map((m) => m.name)).not.toEqual(a.map((m) => m.name));
  });

  it("ids candidates by window and slot, unassigned", () => {
    const board = awayRecruitCandidates(boardState({ gameTimeSeconds: OFFICER_ROSTER_WINDOW_SECONDS * 7 }));
    board.forEach((m, slot) => {
      expect(m.id).toBe(`away-candidate-7-${slot}`);
      expect(m.assignedShipId).toBeNull();
    });
  });

  it("differs from the officer board (its own seed + mix)", () => {
    const s = boardState();
    expect(awayRecruitCandidates(s).map((m) => m.name)).not.toEqual(seniorStaffCandidates(s).map((o) => o.name));
  });

  // Many windows of candidates, for the distribution checks below.
  const many = Array.from({ length: 300 }, (_, w) =>
    awayRecruitCandidates(boardState({ gameTimeSeconds: w * OFFICER_ROSTER_WINDOW_SECONDS })),
  ).flat();

  it("never rolls prospecting; both real squads appear; spec matches the squad", () => {
    const types = new Set(many.map((m) => m.teamType));
    expect(types.has("prospecting")).toBe(false);
    expect(types.has("security")).toBe(true);
    expect(types.has("science")).toBe(true);
    for (const m of many) expect(specsFor(m.teamType), m.id).toContain(m.spec);
  });

  it("rolls distinct, team-appropriate traits, as many as the rank allows", () => {
    for (const m of many) {
      expect(m.traits, m.id).toHaveLength(traitCountForRank(m.rank));
      expect(new Set(m.traits).size, m.id).toBe(m.traits.length);
      for (const id of m.traits) expect(getAwayTrait(id)?.teamTypes, `${m.id} ${id}`).toContain(m.teamType);
    }
  });

  it("rolls race from the crew race list and rank on the 8-tier ladder, weighted low", () => {
    const counts = new Map<number, number>();
    for (const m of many) {
      expect(CREW_RACE_IDS).toContain(m.race);
      expect(CREW_RANK_ORDER).toContain(m.rank);
      counts.set(m.rank, (counts.get(m.rank) ?? 0) + 1);
    }
    expect(counts.get(1) ?? 0).toBeGreaterThan(counts.get(4) ?? 0);
    expect(counts.get(4) ?? 0).toBeGreaterThan(counts.get(8) ?? 0);
    expect(counts.get(8) ?? 0).toBeGreaterThan(0); // the top rank is rare but reachable
  });
});
