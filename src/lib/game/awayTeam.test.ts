// E-CREW: tests for the away-team engine (awayTeam.ts). Covers the per-ship-type squad sizes
// (design section 5.2) and the derived recruit board (section 5.1: determinism, window steps, squad /
// spec / trait / rank / race rolls, augment affinity), plus hire / fire / reassign with the crew lock
// and their typed block reasons. Nothing here exercises the tick or the UI (the engine is not wired in
// yet).

import { beforeAll, describe, it, expect } from "vitest";
import { emptyGroundTeams, freshState, groundSquadSize, isSparePiece, SHIP_TYPES, SENIOR_STAFF_ROSTER_BASE } from "./model";
import { setGroundTeamKind } from "./groundTeams";
import { registerSyntheticHull } from "./awayTeamTestFixtures";
import type { AwayMember, AwayTeamType, CaptainMissionState, EquipmentInstance, GameState, ShipTypeKey } from "./model";
import {
  shipSquadSlots,
  shipCrewRoom,
  deployableMembers,
  membersInSquad,
  squadHasRoom,
  traitCountForRank,
  AUGMENT_AFFINITY_RACES,
  implantSlotsFor,
  specsFor,
  awayRecruitCandidates,
  shipCrewLocked,
  hireAwayMember,
  fireAwayMember,
  reassignAwayMember,
  canHireAwayMember,
  canFireAwayMember,
  canReassignAwayMember,
  hireTargetsFor,
  awayCrewBlockText,
  hireTargetsForCandidate,
  awayBoardSecondsToRefresh,
  type AwayCrewBlockReason,
} from "./awayTeam";
import { getAwayTrait } from "./awayTraits";
import { buffCountForRank, CREW_RANK_ORDER } from "./crewRank";
import { CREW_RACE_IDS } from "./crewRaces";
import { OFFICER_ROSTER_WINDOW_SECONDS, seniorStaffCandidates } from "./seniorStaff";

// ===== fixtures =====

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

// `n` Science members (member-1 ..) aboard `shipId`. A Ground + Ground Destroyer (4 / 3) holds 6 Science
// slots plus 4 shared reserve berths (one squad's worth), so 10 Science fill it when no Security sits in
// the reserve (Squads SQ-2).
function scientists(n: number, shipId: string | null, from = 1): AwayMember[] {
  return Array.from({ length: n }, (_, i) => member(`member-${from + i}`, "science", shipId));
}

// ===== Task 3: squad sizes =====

describe("squad sizes (design section 5.2) and shipSquadSlots (Squads SQ-2: the composition's slots)", () => {
  // A ship of `typeKey` with its fresh (Ground + Ground) teams.
  const ship = (typeKey: ShipTypeKey) => ({ typeKey, groundTeams: emptyGroundTeams(typeKey) });

  it("matches the whole design table of squad sizes", () => {
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
      expect([groundSquadSize(key, "security"), groundSquadSize(key, "science")], key).toEqual(table[key]);
      // Ground + Ground: two squads of each type
      expect([shipSquadSlots(ship(key), "security"), shipSquadSlots(ship(key), "science")], key).toEqual([2 * table[key][0], 2 * table[key][1]]);
    }
  });

  it("follows the composition: Strike + Ground on a Destroyer (4 / 3) is 12 Security / 3 Science slots", () => {
    const strike = { typeKey: "destroyer" as ShipTypeKey, groundTeams: [{ kind: "strike" as const, security: [], science: [], helpOthers: false }] };
    expect(shipSquadSlots(strike, "security")).toBe(12);
    expect(shipSquadSlots(strike, "science")).toBe(3);
    // a ship minted without teams reads as Ground + Ground
    expect(shipSquadSlots({ typeKey: "eir" }, "security")).toBe(8);
  });

  it("prospecting is wired on every hull but never fielded (0 slots)", () => {
    for (const key of ALL_TYPE_KEYS) {
      expect(shipSquadSlots(ship(key), "prospecting"), key).toBe(0);
      expect(SHIP_TYPES[key].awayTeams?.some((t) => t.teamType === "prospecting"), key).toBe(true);
    }
  });

  it("every ship type lists a Security and a Science squad size", () => {
    for (const key of ALL_TYPE_KEYS) {
      expect(groundSquadSize(key, "security"), key).toBeGreaterThanOrEqual(1);
      expect(groundSquadSize(key, "science"), key).toBeGreaterThanOrEqual(1);
    }
  });

  it("an unknown type key returns 0 rather than throwing", () => {
    expect(shipSquadSlots({ typeKey: "noSuchHull" as ShipTypeKey }, "security")).toBe(0);
  });

  // WR-4 retired the live awayTeams[].count field; `count` survives only as the synthetic-hull fixture's shorthand
  // (awayTeamTestFixtures.ts), so this pins that an explicit groundSquads wins over it and it reaches no cap.
  it("ONE authority (SQ-1 review): groundSquads alone sets the team count (the fixture count reaches no cap)", () => {
    const key = "syntheticCountIgnored" as ShipTypeKey;
    const cleanup = registerSyntheticHull(key, [
      { teamType: "security", size: 3, count: 7 },
      { teamType: "science", size: 2, count: 0 },
    ], 4);
    try {
      const host = { typeKey: key, groundTeams: emptyGroundTeams(key) };
      expect(host.groundTeams).toHaveLength(2); // groundSquads 4 = 2 teams, whatever count says
      expect(shipSquadSlots(host, "security")).toBe(6); // size x Security squads in Ground + Ground
      expect(shipSquadSlots(host, "science")).toBe(4); // count 0 does not zero it
      const s = stateWithShips([{ id: "ship-a", typeKey: key }], [member("member-1", "science", "ship-a")]);
      expect(squadHasRoom(s, "ship-a", "science")).toBe(true);
      expect(deployableMembers(s, s.ships[0], "science").map((m) => m.id)).toEqual(["member-1"]);
    } finally {
      cleanup();
    }
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

  it("has room until the composition's slots AND the shared reserve berths are full, then refuses", () => {
    // Destroyer (4 / 3), Ground + Ground: 6 Science slots + 4 berths (one squad's worth: the larger size)
    const ten = scientists(10, "ship-a");
    const s = stateWithShips([{ id: "ship-a", typeKey: "destroyer" }], ten);
    expect(squadHasRoom(s, "ship-a", "science")).toBe(false);
    expect(squadHasRoom(s, "ship-a", "security")).toBe(true); // 8 empty Security slots
    const nine = stateWithShips([{ id: "ship-a", typeKey: "destroyer" }], ten.slice(0, 9));
    expect(squadHasRoom(nine, "ship-a", "science")).toBe(true);
    expect(shipCrewRoom(s, s.ships[0])).toEqual({
      capacity: { security: 8, science: 6, reserveBerths: 4, total: 18 },
      aboard: { security: 0, science: 10 },
      berthsUsed: 4,
    });
  });

  it("the berths are SHARED: Security in the reserve leaves fewer berths for Science", () => {
    const crew = [...scientists(8, "ship-a"), ...[21, 22, 23, 24, 25, 26, 27, 28, 29, 30].map((n) => member(`member-${n}`, "security", "ship-a"))];
    // 8 Science (2 over the 6 slots) + 10 Security (2 over the 8 slots) = all 4 berths used
    const s = stateWithShips([{ id: "ship-a", typeKey: "destroyer" }], crew);
    expect(shipCrewRoom(s, s.ships[0]).berthsUsed).toBe(4);
    expect(squadHasRoom(s, "ship-a", "science")).toBe(false);
    expect(squadHasRoom(s, "ship-a", "security")).toBe(false);
  });

  it("never has room on a prospecting squad, or on a ship that does not exist", () => {
    const s = stateWithShips([{ id: "ship-a", typeKey: "eir" }]);
    expect(squadHasRoom(s, "ship-a", "prospecting")).toBe(false);
    expect(squadHasRoom(s, "ship-missing", "security")).toBe(false);
  });
});

// ===== Task 4: traits + the derived recruit board =====

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

  // Many windows of candidates, for the distribution checks below. Built once, lazily, in beforeAll so
  // the work only runs when this block does.
  let many: AwayMember[] = [];
  beforeAll(() => {
    many = Array.from({ length: 300 }, (_, w) =>
      awayRecruitCandidates(boardState({ gameTimeSeconds: w * OFFICER_ROSTER_WINDOW_SECONDS })),
    ).flat();
  });

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

// ===== Task 5: hire / fire / reassign =====

// A minimal active extraction mission: mission !== null is all onMissionLock reads. cargo's required-key
// Record is satisfied with a cast; nothing here reads it.
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

// A loose equipment piece (only the location fields matter to these tests).
function piece(id: string, overrides: Partial<EquipmentInstance> = {}): EquipmentInstance {
  return {
    id,
    slotType: "cargoBay",
    rarity: "standard",
    ascension: "none",
    quality: 0,
    iLevel: 1,
    blueprintKey: null,
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

// Two idle Destroyers (4 Security / 3 Science): ship-a is flown by captain 1, ship-b is parked.
function hireState(members: AwayMember[] = []): GameState {
  const base = freshState();
  return {
    ...base,
    gameTimeSeconds: 0,
    ships: [
      { ...base.ships[0], id: "ship-a", typeKey: "destroyer", assignedCaptainId: 1 },
      { ...base.ships[0], id: "ship-b", typeKey: "destroyer", assignedCaptainId: null },
    ],
    captains: base.captains.map((c) => (c.id === 1 ? { ...c, mission: null } : c)),
    awayMembers: members,
    nextAwayMemberId: members.length + 1,
  };
}

// Put captain 1 (ship-a's captain) on an active mission, which crew-locks ship-a.
function onMission(s: GameState): GameState {
  return { ...s, captains: s.captains.map((c) => (c.id === 1 ? { ...c, mission: activeMission() } : c)) };
}

// The first board candidate of the given squad type.
function candidateOf(s: GameState, teamType: AwayTeamType): AwayMember {
  const c = awayRecruitCandidates(s).find((m) => m.teamType === teamType);
  if (!c) throw new Error(`no ${teamType} candidate on the fixture board`);
  return c;
}

describe("shipCrewLocked", () => {
  it("is false for an idle or parked ship, true while its captain is on a mission", () => {
    const s = hireState();
    expect(shipCrewLocked(s, "ship-a")).toBe(false);
    expect(shipCrewLocked(s, "ship-b")).toBe(false);
    expect(shipCrewLocked(onMission(s), "ship-a")).toBe(true);
    expect(shipCrewLocked(onMission(s), "ship-b")).toBe(false);
  });

  it("is true while the ship is out on an expedition (the away team is deployed)", () => {
    const s = hireState();
    const withExpedition = { ...s, expeditions: [{ shipId: "ship-b" } as GameState["expeditions"][number]] };
    expect(shipCrewLocked(withExpedition, "ship-b")).toBe(true);
    expect(shipCrewLocked(withExpedition, "ship-a")).toBe(false);
  });

  it("is false for a ship that does not exist (nothing to protect)", () => {
    expect(shipCrewLocked(hireState(), "ship-missing")).toBe(false);
  });
});

describe("hireAwayMember", () => {
  it("copies the candidate into the ship's squad with a fresh member id", () => {
    const s = hireState();
    const cand = candidateOf(s, "security");
    const next = hireAwayMember(s, cand.id, "ship-a");
    expect(next).not.toBe(s);
    expect(next.awayMembers).toHaveLength(1);
    const hired = next.awayMembers[0];
    expect(hired).toMatchObject({
      id: "member-1",
      assignedShipId: "ship-a",
      hiredFrom: cand.id,
      name: cand.name,
      teamType: cand.teamType,
      spec: cand.spec,
      rank: cand.rank,
      traits: cand.traits,
    });
    expect(next.nextAwayMemberId).toBe(2);
    expect(membersInSquad(next, "ship-a", "security")).toHaveLength(1);
    expect(s.awayMembers).toEqual([]); // input untouched
  });

  it("fills the slots and the reserve berths, then refuses with the same state ref once it is full", () => {
    // Destroyer Ground + Ground: 6 Science slots + 4 berths. Seed it full, then try to hire an 11th scientist.
    const s = hireState(scientists(10, "ship-a"));
    const cand = candidateOf(s, "science");
    expect(hireAwayMember(s, cand.id, "ship-a")).toBe(s);
    // The same candidate still fits the other Destroyer.
    expect(hireAwayMember(s, cand.id, "ship-b").awayMembers).toHaveLength(11);
  });

  it("hires one by one: the slots fill first (auto-slot), then the reserve berths, then it refuses", () => {
    let s = hireState(scientists(7, "ship-a", 100)); // 7 aboard: the 6 slots plus 1 berth
    const board = awayRecruitCandidates(s).filter((c) => c.teamType === "science");
    expect(board.length).toBeGreaterThanOrEqual(4); // the fixture board has enough to overfill
    for (const c of board.slice(0, 3)) s = hireAwayMember(s, c.id, "ship-a");
    expect(membersInSquad(s, "ship-a", "science")).toHaveLength(10);
    expect(squadHasRoom(s, "ship-a", "science")).toBe(false);
    expect(hireAwayMember(s, board[3].id, "ship-a")).toBe(s);
  });

  it("the cap follows the composition: a Strike + Ground Destroyer holds 12 + 4 Security, 3 + 4 Science", () => {
    const strike = (state: GameState): GameState => setGroundTeamKind(state, "ship-a", 1, "strike");
    const sec = Array.from({ length: 16 }, (_, i) => member(`member-${i + 1}`, "security", "ship-a"));
    const full = strike(hireState(sec));
    expect(full.ships[0].groundTeams?.[1].kind).toBe("strike");
    expect(squadHasRoom(full, "ship-a", "security")).toBe(false);
    expect(squadHasRoom(strike(hireState(sec.slice(0, 15))), "ship-a", "security")).toBe(true);
    // Science: 3 slots; the 4 berths are free, so 7 Science fit
    expect(squadHasRoom(strike(hireState(scientists(6, "ship-a"))), "ship-a", "science")).toBe(true);
    expect(squadHasRoom(strike(hireState(scientists(7, "ship-a"))), "ship-a", "science")).toBe(false);
  });

  it("OVER CAPACITY after a type change: nobody leaves, the over-full type cannot hire, the other still can", () => {
    // A Ground + Ground Destroyer with 10 Science (6 slotted, 4 in the berths); Bravo turns Strike: 3 Science
    // slots, so 7 of the 10 sit in the reserve against 4 berths
    let s = hireState(scientists(10, "ship-a"));
    s = { ...s, ships: s.ships.map((sh) => (sh.id === "ship-a" ? { ...sh, groundTeams: emptyGroundTeams("destroyer") } : sh)) };
    const changed = setGroundTeamKind(s, "ship-a", 1, "strike");
    expect(changed).not.toBe(s);
    expect(changed.awayMembers).toBe(s.awayMembers); // nobody leaves the ship
    expect(shipCrewRoom(changed, changed.ships[0]).berthsUsed).toBe(7);
    const sci = candidateOf(changed, "science");
    expect(canHireAwayMember(changed, sci.id, "ship-a")).toEqual({ ok: false, reason: "overCapacity" });
    // Security has 12 empty slots: hiring it is fine (it fills a slot, never a berth)
    expect(canHireAwayMember(changed, candidateOf(changed, "security").id, "ship-a")).toEqual({ ok: true });
  });

  it("refuses a candidate not on the current board, and a ship that does not exist", () => {
    const s = hireState();
    expect(hireAwayMember(s, "away-candidate-999-0", "ship-a")).toBe(s);
    expect(hireAwayMember(s, candidateOf(s, "security").id, "ship-missing")).toBe(s);
  });

  it("refuses while the ship is crew-locked", () => {
    const s = onMission(hireState());
    expect(hireAwayMember(s, candidateOf(s, "security").id, "ship-a")).toBe(s);
  });

  it("refuses hiring the same candidate twice, and drops them from the board", () => {
    const s = hireState();
    const cand = candidateOf(s, "security");
    const once = hireAwayMember(s, cand.id, "ship-a");
    expect(awayRecruitCandidates(once).some((c) => c.id === cand.id)).toBe(false);
    expect(hireAwayMember(once, cand.id, "ship-a")).toBe(once);
    expect(hireAwayMember(once, cand.id, "ship-b")).toBe(once);
  });
});

describe("fireAwayMember", () => {
  it("returns the member's gear to storage first, then removes the member", () => {
    const s: GameState = {
      ...hireState([member("member-1", "security", "ship-a"), member("member-2", "security", "ship-a")]),
      equipment: [
        piece("armor-1", { fittedToMemberId: "member-1" }),
        piece("implant-1", { fittedToMemberId: "member-1" }),
        piece("other-1", { fittedToMemberId: "member-2" }),
        piece("ship-gear", { fittedToShipId: "ship-a" }),
      ],
    };
    const next = fireAwayMember(s, "member-1");
    expect(next.awayMembers.map((x) => x.id)).toEqual(["member-2"]);
    expect(next.equipment.some((e) => e.fittedToMemberId === "member-1")).toBe(false);
    for (const id of ["armor-1", "implant-1"]) {
      const e = next.equipment.find((x) => x.id === id)!;
      expect(e.fittedToMemberId).toBeNull();
      expect(isSparePiece(e)).toBe(true);
    }
    expect(next.equipment.find((x) => x.id === "other-1")!.fittedToMemberId).toBe("member-2");
    expect(next.equipment.find((x) => x.id === "ship-gear")!.fittedToShipId).toBe("ship-a");
    expect(s.equipment.find((x) => x.id === "armor-1")!.fittedToMemberId).toBe("member-1"); // input untouched
  });

  it("refuses (same ref) while the member's ship is crew-locked, and for an unknown id", () => {
    const s = hireState([member("member-1", "security", "ship-a")]);
    const locked = onMission(s);
    expect(fireAwayMember(locked, "member-1")).toBe(locked);
    expect(fireAwayMember(s, "member-404")).toBe(s);
  });

  it("can fire an unassigned member", () => {
    const s = hireState([member("member-1", "science", null)]);
    expect(fireAwayMember(s, "member-1").awayMembers).toEqual([]);
  });
});

describe("reassignAwayMember", () => {
  it("moves a member to another ship's matching squad", () => {
    const s = hireState([member("member-1", "science", "ship-a")]);
    const next = reassignAwayMember(s, "member-1", "ship-b");
    expect(next.awayMembers[0].assignedShipId).toBe("ship-b");
    expect(membersInSquad(next, "ship-a", "science")).toEqual([]);
    expect(membersInSquad(next, "ship-b", "science")).toHaveLength(1);
  });

  it("refuses (same ref) when the target ship's slots and berths are full", () => {
    const fullB = scientists(10, "ship-b", 2);
    const s = hireState([member("member-1", "science", "ship-a"), ...fullB]);
    expect(reassignAwayMember(s, "member-1", "ship-b")).toBe(s);
  });

  it("refuses (same ref) when either ship is crew-locked", () => {
    const fromLocked = onMission(hireState([member("member-1", "science", "ship-a")]));
    expect(reassignAwayMember(fromLocked, "member-1", "ship-b")).toBe(fromLocked);
    expect(reassignAwayMember(fromLocked, "member-1", null)).toBe(fromLocked);
    const toLocked = onMission(hireState([member("member-1", "science", "ship-b")]));
    expect(reassignAwayMember(toLocked, "member-1", "ship-a")).toBe(toLocked);
  });

  it("unassigns with null, and assigns an unassigned member into a squad", () => {
    const s = hireState([member("member-1", "security", "ship-a")]);
    const benched = reassignAwayMember(s, "member-1", null);
    expect(benched.awayMembers[0].assignedShipId).toBeNull();
    expect(reassignAwayMember(benched, "member-1", "ship-b").awayMembers[0].assignedShipId).toBe("ship-b");
  });

  it("is a same-ref no-op for an unknown member, an unknown ship, or the ship it is already on", () => {
    const s = hireState([member("member-1", "security", "ship-a")]);
    expect(reassignAwayMember(s, "member-404", "ship-b")).toBe(s);
    expect(reassignAwayMember(s, "member-1", "ship-missing")).toBe(s);
    expect(reassignAwayMember(s, "member-1", "ship-a")).toBe(s);
    const benched = reassignAwayMember(s, "member-1", null);
    expect(reassignAwayMember(benched, "member-1", null)).toBe(benched);
  });
});

// ===== Typed block reasons (the canFitEquipment / canRequisition gate pattern) =====

describe("canHireAwayMember", () => {
  it("returns each block reason, and ok when the hire would go through", () => {
    const s = hireState();
    const sci = candidateOf(s, "science");
    expect(canHireAwayMember(s, sci.id, "ship-a")).toEqual({ ok: true });
    expect(canHireAwayMember(s, "away-candidate-999-0", "ship-a")).toEqual({ ok: false, reason: "noCandidate" });
    expect(canHireAwayMember(s, sci.id, "ship-missing")).toEqual({ ok: false, reason: "noShip" });
    expect(canHireAwayMember(onMission(s), sci.id, "ship-a")).toEqual({ ok: false, reason: "onMission" });
    const full = hireState(scientists(10, "ship-a"));
    expect(canHireAwayMember(full, candidateOf(full, "science").id, "ship-a")).toEqual({
      ok: false,
      reason: "squadFull",
    });
  });
});

describe("canFireAwayMember", () => {
  it("returns noMember, onMission, and ok", () => {
    const s = hireState([member("member-1", "security", "ship-a")]);
    expect(canFireAwayMember(s, "member-1")).toEqual({ ok: true });
    expect(canFireAwayMember(s, "member-404")).toEqual({ ok: false, reason: "noMember" });
    expect(canFireAwayMember(onMission(s), "member-1")).toEqual({ ok: false, reason: "onMission" });
  });
});

describe("canReassignAwayMember", () => {
  it("returns each block reason, and ok when the move would go through", () => {
    const s = hireState([member("member-1", "science", "ship-a")]);
    expect(canReassignAwayMember(s, "member-1", "ship-b")).toEqual({ ok: true });
    expect(canReassignAwayMember(s, "member-1", null)).toEqual({ ok: true });
    expect(canReassignAwayMember(s, "member-404", "ship-b")).toEqual({ ok: false, reason: "noMember" });
    expect(canReassignAwayMember(s, "member-1", "ship-a")).toEqual({ ok: false, reason: "alreadyThere" });
    expect(canReassignAwayMember(s, "member-1", "ship-missing")).toEqual({ ok: false, reason: "noShip" });
    expect(canReassignAwayMember(onMission(s), "member-1", "ship-b")).toEqual({ ok: false, reason: "onMission" });
    const fullB = hireState([member("member-1", "science", "ship-a"), ...scientists(10, "ship-b", 2)]);
    expect(canReassignAwayMember(fullB, "member-1", "ship-b")).toEqual({ ok: false, reason: "squadFull" });
  });

  it("reports onMission for a locked TARGET ship too", () => {
    const s = onMission(hireState([member("member-1", "science", "ship-b")]));
    expect(canReassignAwayMember(s, "member-1", "ship-a")).toEqual({ ok: false, reason: "onMission" });
  });
});

describe("hireTargetsFor", () => {
  it("lists every ship with whether the candidate can be hired there and why not", () => {
    const s = onMission(hireState());
    const cand = candidateOf(s, "security");
    expect(hireTargetsFor(s, cand.id)).toEqual([
      { shipId: "ship-a", ok: false, reason: "onMission" },
      { shipId: "ship-b", ok: true },
    ]);
  });

  it("marks every ship noCandidate for a candidate not on the board", () => {
    const s = hireState();
    expect(hireTargetsFor(s, "away-candidate-999-0")).toEqual([
      { shipId: "ship-a", ok: false, reason: "noCandidate" },
      { shipId: "ship-b", ok: false, reason: "noCandidate" },
    ]);
  });
});

describe("awayCrewBlockText", () => {
  it("maps every block reason to clean, non-empty player text", () => {
    // Typed as a Record so a new reason is a compile error here too, not just in the switch.
    const all: Record<AwayCrewBlockReason, true> = {
      noCandidate: true,
      noMember: true,
      noShip: true,
      onMission: true,
      noSquad: true,
      squadFull: true,
      overCapacity: true,
      alreadyThere: true,
    };
    const texts = (Object.keys(all) as AwayCrewBlockReason[]).map((r) => awayCrewBlockText(r));
    for (const t of texts) {
      expect(t.trim().length).toBeGreaterThan(0);
      expect(t).not.toContain(String.fromCharCode(0x2014));
      expect(t).not.toMatch(/-{2}/);
    }
    expect(new Set(texts).size).toBe(texts.length);
    expect(awayCrewBlockText("squadFull")).toBe("No open slot or reserve berth");
    expect(awayCrewBlockText("overCapacity")).toBe("Reserve is over capacity");
    expect(awayCrewBlockText("onMission")).toBe("Ship is out on a mission");
    expect(awayCrewBlockText("noCandidate")).toBe("No longer on the board");
    expect(awayCrewBlockText("alreadyThere")).toBe("Already on this ship");
  });
});

describe("hire paths agree", () => {
  it("hireTargetsFor and hireAwayMember agree with canHireAwayMember per ship", () => {
    // ship-a's Science is full (Destroyer: 6 slots + 4 berths), so the science candidates block there and not on ship-b.
    const s = hireState(scientists(10, "ship-a"));
    const seen = new Set<string>();
    for (const cand of awayRecruitCandidates(s)) {
      const targets = hireTargetsFor(s, cand.id);
      for (const t of targets) {
        const gate = canHireAwayMember(s, cand.id, t.shipId);
        seen.add(gate.ok ? "ok" : gate.reason);
        expect(t.ok).toBe(gate.ok);
        if (!gate.ok) expect(t.reason).toBe(gate.reason);
        const next = hireAwayMember(s, cand.id, t.shipId);
        expect(next === s).toBe(!gate.ok);
      }
    }
    expect(seen.has("ok")).toBe(true);
    expect(seen.has("squadFull")).toBe(true);
  });
});

describe("hireTargetsForCandidate", () => {
  it("equals hireTargetsFor for every board candidate, and for an unknown one", () => {
    const s = onMission(hireState(scientists(10, "ship-b")));
    for (const cand of awayRecruitCandidates(s)) {
      expect(hireTargetsForCandidate(s, cand)).toEqual(hireTargetsFor(s, cand.id));
    }
    expect(hireTargetsForCandidate(s, undefined)).toEqual(hireTargetsFor(s, "away-candidate-999-0"));
  });
});

describe("noSquad", () => {
  it("refuses a move into a squad type the target hull fields none of, never as squadFull", () => {
    // A prospecting member (wired only: every hull lists it with 0 slots) cannot join any ship.
    const s = hireState([member("member-1", "prospecting", null)]);
    expect(canReassignAwayMember(s, "member-1", "ship-a")).toEqual({ ok: false, reason: "noSquad" });
    expect(reassignAwayMember(s, "member-1", "ship-a")).toBe(s);
    expect(awayCrewBlockText("noSquad")).not.toBe(awayCrewBlockText("squadFull"));
  });
});

describe("awayBoardSecondsToRefresh", () => {
  it("counts down to the next officer roster window", () => {
    const at = (t: number) => awayBoardSecondsToRefresh({ ...freshState(), gameTimeSeconds: t });
    expect(at(0)).toBe(OFFICER_ROSTER_WINDOW_SECONDS);
    expect(at(1)).toBe(OFFICER_ROSTER_WINDOW_SECONDS - 1);
    expect(at(OFFICER_ROSTER_WINDOW_SECONDS - 0.5)).toBe(0.5);
    expect(at(OFFICER_ROSTER_WINDOW_SECONDS)).toBe(OFFICER_ROSTER_WINDOW_SECONDS);
    expect(at(OFFICER_ROSTER_WINDOW_SECONDS * 3 + 600)).toBe(OFFICER_ROSTER_WINDOW_SECONDS - 600);
  });
});
