// Ground Operations GO-7a: the dispatch snapshot for ground teams (written, not yet read).

import { afterEach, describe, expect, it } from "vitest";
import {
  freshState,
  type AwayMember,
  type GameState,
  type SeniorStaffOfficer,
  type ShipGroundTeam,
  type ShipInstance,
  type ShipTypeKey,
} from "./model";
import {
  EFFICIENT_STOWAGE_RELOAD,
  NEUTRAL_SHIP_EVENT_PROFILE,
  groundOpsBayCare,
  groundReloadMult,
  snapshotAwayRosterForTeams,
  snapshotGroundOps,
} from "./groundOps";
import { snapshotAwayRoster } from "./awayTeam";
import { shipInjuryFactors } from "./injuries";
import { bayCareFrom } from "./medicalBay";
import { effectiveShipStats, shipCrewContribution } from "./crewOverlay";
import { CREW_STAT_KEYS } from "./crewBuffs";
import { startExpedition, expeditionCandidates } from "./expedition";
import { plainAwayMember, registerSyntheticHull } from "./awayTeamTestFixtures";

const NOW = 50_000;
const NO_FACETS = {};

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

const member = (id: string, teamType: AwayMember["teamType"], shipId = "ship-1", over: Partial<AwayMember> = {}): AwayMember => ({
  ...plainAwayMember(id, teamType, shipId),
  ...over,
});

// ship-1 (General Freighter) with the given slots in Alpha and members; Bravo (Squads SQ-1: every hull fields
// 2 teams) stays empty, so it never deploys.
function oneTeam(team: Partial<ShipGroundTeam>, members: AwayMember[], extra: Partial<ShipInstance> = {}): GameState {
  const base = freshState();
  const slots: ShipGroundTeam = { kind: "ground", security: [null, null, null], science: [null, null, null], helpOthers: false, ...team };
  const bravo: ShipGroundTeam = { kind: "ground", security: [null, null, null], science: [null, null, null], helpOthers: false };
  return {
    ...base,
    gameTimeSeconds: NOW,
    ships: [{ ...base.ships[0], groundTeams: [slots, bravo], ...extra }],
    awayMembers: members,
    nextAwayMemberId: 100,
  };
}

const basic = (): GameState =>
  oneTeam({ security: ["member-1", "member-2", null], science: ["member-11", null, null] }, [
    member("member-1", "security"),
    member("member-2", "security"),
    member("member-11", "science"),
  ]);

const ship1 = (s: GameState): ShipInstance => s.ships[0];

const medic = (shipId = "ship-1"): SeniorStaffOfficer => ({
  id: "officer-1",
  seat: "medical",
  name: "Doc",
  race: "earthBorn",
  gender: "nonbinary",
  rank: "ensign",
  bonuses: [{ id: "med.recovery", magnitude: 0.1 }, { id: "med.fleetTriage", magnitude: 0.15 }],
  missionsCompleted: 0,
  assignedShipId: shipId,
});

// A crew complement with Medical (Reduced Crew Losses) and Operations (Rapid Loadout, Efficient Unloading).
const crewed = (count = 20): Partial<ShipInstance> => ({
  complement: {
    mode: "passive",
    buckets: [
      { profession: "medical", rarity: "standard", rank: 3, race: "earthBorn", buff1Id: "med.reducedLosses", buff2Id: null, count },
      { profession: "operations", rarity: "standard", rank: 3, race: "earthBorn", buff1Id: "ops.loadSpeed", buff2Id: "ops.unloadSpeed", count },
    ],
  },
});

const withTalents = (s: GameState, talents: string[]): GameState => ({
  ...s,
  captains: s.captains.map((c) => (c.id === ship1(s).assignedCaptainId ? { ...c, unlockedSecondaryTalents: talents as typeof c.unlockedSecondaryTalents } : c)),
});

describe("GO-7a snapshotGroundOps: one ground team", () => {
  it("writes the deploying team idle with its slot-order ids, an empty queue and fresh trip state", () => {
    const s = oneTeam({ security: [null, "member-2", "member-1"], science: ["member-11", null, null] }, [
      member("member-1", "security"),
      member("member-2", "security"),
      member("member-11", "science"),
    ]);
    const snap = snapshotGroundOps(s, ship1(s), NO_FACETS);
    expect(snap.teams).toEqual([
      {
        index: 0,
        securityIds: ["member-2", "member-1"], // slot order, not hire order
        scienceIds: ["member-11"],
        helpOthers: false,
        queue: [],
        step: "idle",
        stepStartedAt: NOW,
        stepEndsAt: null,
        skippedBorrowed: [],
        downedThisTask: [],
        conditions: {},
        bayEnds: {},
      },
    ]);
    // GO-7b's per-task carry starts absent (everyone at full HP)
    expect("carry" in snap.teams[0]).toBe(false);
  });

  it("one team holds the whole crew layer: both shares are [1]", () => {
    const snap = snapshotGroundOps(basic(), ship1(basic()), NO_FACETS);
    expect(snap.factors.securityShare).toEqual([1]);
    expect(snap.factors.scienceShare).toEqual([1]);
  });

  it("helpOthers comes from the ship's team", () => {
    const s = oneTeam({ security: ["member-1", null, null], science: ["member-11", null, null], helpOthers: true }, [
      member("member-1", "security"),
      member("member-11", "science"),
    ]);
    expect(snapshotGroundOps(s, ship1(s), NO_FACETS).teams[0].helpOthers).toBe(true);
  });

  it("a team with ANY not-ready slotted member does not deploy (no stand-ins); a ready reserve member is ignored", () => {
    const s = oneTeam({ security: ["member-1", "member-2", null], science: ["member-11", null, null] }, [
      member("member-1", "security"),
      member("member-2", "security", "ship-1", { injuredUntilSeconds: NOW + 60 }),
      member("member-3", "security"), // aboard, unslotted, ready
      member("member-11", "science"),
    ]);
    const snap = snapshotGroundOps(s, ship1(s), NO_FACETS);
    expect(snap.teams).toEqual([]);
    expect(snap.factors.securityShare).toEqual([]);
    expect(snap.factors.scienceShare).toEqual([]);
    // once the injury is over, the same slots deploy
    const later = { ...s, gameTimeSeconds: NOW + 60 };
    expect(snapshotGroundOps(later, ship1(later), NO_FACETS).teams.map((t) => t.securityIds)).toEqual([["member-1", "member-2"]]);
  });

  it("carries the NEUTRAL ship-event profile as a fresh copy", () => {
    const snap = snapshotGroundOps(basic(), ship1(basic()), NO_FACETS);
    expect(snap.shipEventProfile).toEqual(NEUTRAL_SHIP_EVENT_PROFILE);
    expect(snap.shipEventProfile).not.toBe(NEUTRAL_SHIP_EVENT_PROFILE);
    expect(Object.isFrozen(NEUTRAL_SHIP_EVENT_PROFILE)).toBe(true);
  });

  it("is pure: same input, deep-equal output; the input state is untouched", () => {
    const s = basic();
    const before = JSON.stringify(s);
    expect(snapshotGroundOps(s, ship1(s), NO_FACETS)).toEqual(snapshotGroundOps(s, ship1(s), NO_FACETS));
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe("GO-7a snapshotGroundOps: several ground teams (synthetic 3-team hull)", () => {
  const KEY = "syntheticOpsTriple" as ShipTypeKey;
  const triple = (overMembers: Record<string, Partial<AwayMember>> = {}): GameState => {
    cleanup = registerSyntheticHull(KEY, [
      { teamType: "security", size: 2, count: 3 },
      { teamType: "science", size: 2, count: 3 },
    ]);
    const base = freshState();
    const ids: [string, AwayMember["teamType"]][] = [
      ["member-1", "security"], ["member-2", "security"], ["member-3", "security"], ["member-4", "security"],
      ["member-11", "science"], ["member-12", "science"], ["member-13", "science"], ["member-14", "science"],
    ];
    return {
      ...base,
      gameTimeSeconds: NOW,
      ships: [
        {
          id: "ship-7", typeKey: KEY, assignedCaptainId: null,
          groundTeams: [
            { kind: "ground", security: ["member-1", "member-2"], science: ["member-11", null], helpOthers: false },
            { name: "Night Shift", kind: "ground", security: ["member-3", null], science: ["member-12", null], helpOthers: true },
            { kind: "ground", security: [null, "member-4"], science: ["member-13", "member-14"], helpOthers: false },
          ],
        },
      ],
      awayMembers: ids.map(([id, t]) => member(id, t, "ship-7", overMembers[id])),
    };
  };

  it("each deployed team's share is its squad size over every deployed squad; the shares sum to 1", () => {
    const s = triple();
    const snap = snapshotGroundOps(s, s.ships[0], NO_FACETS);
    expect(snap.teams.map((t) => [t.index, t.securityIds, t.scienceIds, t.helpOthers])).toEqual([
      [0, ["member-1", "member-2"], ["member-11"], false],
      [1, ["member-3"], ["member-12"], true],
      [2, ["member-4"], ["member-13", "member-14"], false],
    ]);
    expect(snap.factors.securityShare).toEqual([0.5, 0.25, 0.25]);
    expect(snap.factors.scienceShare).toEqual([0.25, 0.25, 0.5]);
    expect(snap.factors.securityShare.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(snap.factors.scienceShare.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });

  it("a team missing a ready Science member is left out, and the shares split over the teams that deploy", () => {
    const s = triple({ "member-12": { injuredUntilSeconds: NOW + 600 } });
    const snap = snapshotGroundOps(s, s.ships[0], NO_FACETS);
    expect(snap.teams.map((t) => t.index)).toEqual([0, 2]);
    expect(snap.factors.securityShare).toEqual([2 / 3, 1 / 3]);
    expect(snap.factors.scienceShare).toEqual([1 / 3, 2 / 3]);
    // the union roster leaves the held team's members aboard
    const roster = snapshotAwayRosterForTeams(s, s.ships[0], snap.teams);
    expect(roster.security.map((m) => m.memberId)).toEqual(["member-1", "member-2", "member-4"]);
    expect(roster.science.map((m) => m.memberId)).toEqual(["member-11", "member-13", "member-14"]);
  });
});

describe("GO-7a frozen factors", () => {
  it("a bare ship: no care, no bonus multipliers", () => {
    const s = basic();
    expect(snapshotGroundOps(s, ship1(s), NO_FACETS).factors).toEqual({
      medicalShare: 0,
      rapidRecoveryShare: 0,
      officerFacetShare: 0,
      injurySteady: 0,
      offloadMult: 1,
      reloadMult: 1,
      securityShare: [1],
      scienceShare: [1],
    });
  });

  it("match the live readers at dispatch (shipInjuryFactors, bayCareFrom, unloadSpeedMult, crew.loadSpeed)", () => {
    const b = basic();
    const s: GameState = { ...b, ships: [{ ...ship1(b), ...crewed() }], officers: [medic()] };
    const ship = ship1(s);
    const facets = { recoveryTurnaround: 0.1, quickRecovery: 0.2, injurySteady: 0.05 };
    const f = snapshotGroundOps(s, ship, facets).factors;
    const live = shipInjuryFactors(s, ship);
    expect(live.medicalShare).toBeGreaterThan(0);
    expect(live.rapidRecoveryShare).toBeCloseTo(0.1);
    expect(f.medicalShare).toBe(live.medicalShare);
    expect(f.rapidRecoveryShare).toBe(live.rapidRecoveryShare);
    expect(f.officerFacetShare).toBeCloseTo(0.3, 12);
    expect(f.injurySteady).toBe(0.05);
    // the bay mapping is bayCareFrom's, read back off the frozen factors
    expect(groundOpsBayCare(f)).toEqual(bayCareFrom(live, facets));
    const unload = effectiveShipStats(s, ship).unloadSpeedMult;
    expect(unload).toBeGreaterThan(1);
    expect(f.offloadMult).toBe(unload);
    const loadSpeed = shipCrewContribution(s, ship)[CREW_STAT_KEYS.loadSpeed];
    expect(loadSpeed).toBeGreaterThan(0);
    expect(f.reloadMult).toBe(1 + loadSpeed);
  });

  it("do not change when the ship's officers, crew or captain change after dispatch", () => {
    const b = basic();
    const s = withTalents({ ...b, ships: [{ ...ship1(b), ...crewed() }], officers: [medic()] }, ["logistics1", "logistics2", "logistics3", "logistics4"]);
    const snap = snapshotGroundOps(s, ship1(s), { recoveryTurnaround: 0.1 });
    const frozen = structuredClone(snap);
    // the bridge, the complement and the captain all change mid-run
    const changed = withTalents({ ...s, ships: [{ ...ship1(s), complement: { mode: "passive", buckets: [] } }], officers: [] }, []);
    const fresh = snapshotGroundOps(changed, ship1(changed), NO_FACETS).factors;
    expect(fresh.medicalShare).toBe(0);
    expect(fresh.rapidRecoveryShare).toBe(0);
    expect(fresh.reloadMult).toBe(1);
    expect(fresh.offloadMult).toBe(1);
    expect(snap).toEqual(frozen); // the dispatch record never moved
    expect(snap.factors.rapidRecoveryShare).toBeCloseTo(0.1);
    expect(snap.factors.reloadMult).toBeGreaterThan(1 + EFFICIENT_STOWAGE_RELOAD);
  });

  it("reloadMult rises with Rapid Loadout (crew.loadSpeed) and with Efficient Stowage (logistics4, +0.08)", () => {
    expect(EFFICIENT_STOWAGE_RELOAD).toBe(0.08);
    const b = basic();
    expect(groundReloadMult(b, ship1(b))).toBe(1);
    const small = { ...b, ships: [{ ...ship1(b), ...crewed(5) }] };
    const big = { ...b, ships: [{ ...ship1(b), ...crewed(40) }] };
    expect(groundReloadMult(small, ship1(small))).toBeGreaterThan(1);
    expect(groundReloadMult(big, ship1(big))).toBeGreaterThan(groundReloadMult(small, ship1(small)));
    const stowed = withTalents(b, ["logistics1", "logistics2", "logistics3", "logistics4"]);
    expect(groundReloadMult(stowed, ship1(stowed))).toBeCloseTo(1.08, 12);
    expect(snapshotGroundOps(stowed, ship1(stowed), NO_FACETS).factors.reloadMult).toBeCloseTo(1.08, 12);
    const both = withTalents(big, ["logistics1", "logistics2", "logistics3", "logistics4"]);
    expect(groundReloadMult(both, ship1(both))).toBeCloseTo(groundReloadMult(big, ship1(big)) + 0.08, 12);
  });

  it("only logistics4 on the ship's ASSIGNED captain counts (Rapid Turnaround is not wired, Q22)", () => {
    const b = basic();
    const turnaround = withTalents(b, ["logistics1", "logistics2", "logistics3"]);
    expect(groundReloadMult(turnaround, ship1(turnaround))).toBe(1);
    const stowed = withTalents(b, ["logistics1", "logistics2", "logistics3", "logistics4"]);
    const parked = { ...stowed, ships: [{ ...ship1(stowed), assignedCaptainId: null }] };
    expect(groundReloadMult(parked, ship1(parked))).toBe(1);
  });
});

describe("GO-7a snapshotAwayRosterForTeams (the union roster)", () => {
  it("one team slotted in hire order equals today's snapshotAwayRoster", () => {
    const s = basic();
    const snap = snapshotGroundOps(s, ship1(s), NO_FACETS);
    expect(snapshotAwayRosterForTeams(s, ship1(s), snap.teams)).toEqual(snapshotAwayRoster(s, ship1(s)));
  });

  it("follows team then slot order, and skips ids that are not aboard, of the wrong type, or repeated", () => {
    const s = oneTeam({}, [
      member("member-1", "security"),
      member("member-2", "security"),
      member("member-5", "security", "ship-2"),
      member("member-11", "science"),
      member("member-12", "science"),
    ]);
    const roster = snapshotAwayRosterForTeams(s, ship1(s), [
      { securityIds: ["member-2", "member-11", "member-404"], scienceIds: ["member-12"] },
      { securityIds: ["member-1", "member-2", "member-5"], scienceIds: ["member-11", "member-12"] },
    ]);
    expect(roster.security.map((m) => m.memberId)).toEqual(["member-2", "member-1"]);
    expect(roster.science.map((m) => m.memberId)).toEqual(["member-12", "member-11"]);
  });

  it("returns fresh data (no live references)", () => {
    const s = basic();
    const a = snapshotAwayRosterForTeams(s, ship1(s), snapshotGroundOps(s, ship1(s), NO_FACETS).teams);
    a.security[0].traits.push("x" as never);
    const b = snapshotAwayRosterForTeams(s, ship1(s), snapshotGroundOps(s, ship1(s), NO_FACETS).teams);
    expect(b.security[0].traits).toEqual([]);
    expect(s.awayMembers[0].traits).toEqual([]);
  });
});

describe("GO-7b: startExpedition writes the ground ops record (the flag)", () => {
  it("the stored record is the dispatch snapshot plus an empty timeline, and the roster is the teams' union", () => {
    const s = basic();
    const candidate = expeditionCandidates(s, "ship-1")[0];
    const res = startExpedition(s, "ship-1", ship1(s).assignedCaptainId as number, candidate.id);
    expect(res.success).toBe(true);
    const exp = res.expedition!;
    const snap = snapshotGroundOps(s, ship1(s), exp);
    expect(exp.groundOps).toEqual({ version: 1, ...snap, editCount: 0, history: [], shipLegs: [] });
    expect(exp.roster).toEqual(snapshotAwayRosterForTeams(s, ship1(s), snap.teams));
  });
});
