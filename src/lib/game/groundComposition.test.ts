// Squads redesign SQ-1 (docs/plans/2026-10-12-squads-and-subspace-telescope-design.md sections 2.1 to 2.4 and
// the user answers): every hull fields 4 SQUADS grouped into 2 TEAMS of 2 squads; a team's KIND is Strike
// (2 Security), Survey (2 Science) or Ground (1 + 1); a ship keeps at least one Security and one Science
// squad (user: "Always require one of each type minimum"). Plus the BACKUP ROSTER constant (user follow-up:
// a fixed crew per ship plus about 2 reserve berths aboard, count PROVISIONAL).

import { afterEach, describe, expect, it } from "vitest";
import { SHIP_TYPES, type GroundTeamKind, type ShipInstance, type ShipTypeKey } from "./model";
import {
  DEFAULT_GROUND_TEAM_KIND,
  GROUND_RESERVE_BERTHS,
  GROUND_TEAM_KINDS,
  compositionLabel,
  compositionSquads,
  groundSquadsOf,
  isGroundTeamKind,
  isValidComposition,
  reserveBerthsUsed,
  scienceSquadsOf,
  securitySquadsOf,
  shipComposition,
  shipCrewCapacity,
  shipReserveBerths,
  shipTeamKinds,
  squadsOfType,
  teamKindLabel,
  teamKindName,
  teamSlotCount,
  validCompositions,
} from "./groundComposition";
import { groundSquadSize, groundTeamCount } from "./groundTeams";
import { registerSyntheticHull } from "./awayTeamTestFixtures";

const HULLS = Object.keys(SHIP_TYPES) as ShipTypeKey[];

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

describe("hull data: every hull fields 4 squads = 2 teams (user: DOUBLE EVERY HULL)", () => {
  it("every SHIP_TYPES hull lists groundSquads 4, an EVEN number (an odd value is a data error)", () => {
    for (const key of HULLS) {
      expect(groundSquadsOf(key), key).toBe(4);
      expect(SHIP_TYPES[key].groundSquads % 2, key).toBe(0);
      expect(groundTeamCount(key), key).toBe(2);
    }
  });

  it("an unknown hull fields 0 squads and 0 teams", () => {
    expect(groundSquadsOf("noSuchHull" as ShipTypeKey)).toBe(0);
    expect(groundTeamCount("noSuchHull" as ShipTypeKey)).toBe(0);
  });
});

describe("team kinds (user names: Strike = 2 Security, Survey = 2 Science, Ground = 1 + 1)", () => {
  it("lists the three kinds, Ground the default", () => {
    expect(GROUND_TEAM_KINDS).toEqual(["ground", "strike", "survey"]);
    expect(DEFAULT_GROUND_TEAM_KIND).toBe("ground");
    for (const k of GROUND_TEAM_KINDS) expect(isGroundTeamKind(k)).toBe(true);
    for (const bad of ["Ground", "", "prospecting", null, undefined, 2, {}]) expect(isGroundTeamKind(bad)).toBe(false);
  });

  it("squad counts per kind always sum to 2 (a team is a PAIR of squads)", () => {
    expect([securitySquadsOf("ground"), scienceSquadsOf("ground")]).toEqual([1, 1]);
    expect([securitySquadsOf("strike"), scienceSquadsOf("strike")]).toEqual([2, 0]);
    expect([securitySquadsOf("survey"), scienceSquadsOf("survey")]).toEqual([0, 2]);
    for (const k of GROUND_TEAM_KINDS) {
      expect(squadsOfType(k, "security") + squadsOfType(k, "science"), k).toBe(2);
      expect(squadsOfType(k, "security")).toBe(securitySquadsOf(k));
      expect(squadsOfType(k, "science")).toBe(scienceSquadsOf(k));
    }
  });

  it("names and labels", () => {
    expect(GROUND_TEAM_KINDS.map(teamKindName)).toEqual(["Ground", "Strike", "Survey"]);
    expect(GROUND_TEAM_KINDS.map(teamKindLabel)).toEqual(["Ground team", "Strike team", "Survey team"]);
  });

  it("slot lists are sized by kind: squads of the type x the hull's squad size", () => {
    // General Freighter 3 / 3, Destroyer 4 / 3 (the hull's per-type squad size, unchanged)
    expect(teamSlotCount("generalFreighter", "ground", "security")).toBe(3);
    expect(teamSlotCount("generalFreighter", "ground", "science")).toBe(3);
    expect(teamSlotCount("generalFreighter", "strike", "security")).toBe(6);
    expect(teamSlotCount("generalFreighter", "strike", "science")).toBe(0);
    expect(teamSlotCount("generalFreighter", "survey", "security")).toBe(0);
    expect(teamSlotCount("generalFreighter", "survey", "science")).toBe(6);
    expect(teamSlotCount("destroyer", "strike", "security")).toBe(2 * groundSquadSize("destroyer", "security"));
    expect(teamSlotCount("destroyer", "survey", "science")).toBe(2 * groundSquadSize("destroyer", "science"));
  });
});

describe("compositions under the one-of-each minimum (user: 'Always require one of each type minimum')", () => {
  const ALL_PAIRS: [GroundTeamKind, GroundTeamKind][] = GROUND_TEAM_KINDS.flatMap((a) =>
    GROUND_TEAM_KINDS.map((b) => [a, b] as [GroundTeamKind, GroundTeamKind]),
  );

  it("all 9 ordered pairs on a 4-squad hull: only Strike + Strike and Survey + Survey are refused", () => {
    for (const pair of ALL_PAIRS) {
      const refused = (pair[0] === "strike" && pair[1] === "strike") || (pair[0] === "survey" && pair[1] === "survey");
      expect(isValidComposition(pair), pair.join("+")).toBe(!refused);
    }
  });

  it("squad totals match the design table", () => {
    expect(compositionSquads(["ground", "ground"])).toEqual({ security: 2, science: 2 });
    expect(compositionSquads(["strike", "survey"])).toEqual({ security: 2, science: 2 });
    expect(compositionSquads(["strike", "ground"])).toEqual({ security: 3, science: 1 });
    expect(compositionSquads(["survey", "ground"])).toEqual({ security: 1, science: 3 });
    expect(compositionSquads(["strike", "strike"])).toEqual({ security: 4, science: 0 });
    expect(compositionSquads(["survey", "survey"])).toEqual({ security: 0, science: 4 });
    expect(compositionSquads([])).toEqual({ security: 0, science: 0 });
  });

  it("an empty list or an unknown kind is never valid", () => {
    expect(isValidComposition([])).toBe(false);
    expect(isValidComposition(["ground", "nope" as GroundTeamKind])).toBe(false);
  });

  it("a 4-squad hull has exactly four valid compositions, Ground + Ground first (the default)", () => {
    for (const key of HULLS) {
      const valid = validCompositions(key);
      expect(valid.map(compositionLabel), key).toEqual([
        "Ground + Ground",
        "Strike + Ground",
        "Survey + Ground",
        "Strike + Survey",
      ]);
      for (const c of valid) expect(isValidComposition(c)).toBe(true);
      // a 4-squad hull fields at most 3 Security squads (design 2.4 consequence)
      expect(Math.max(...valid.map((c) => compositionSquads(c).security))).toBe(3);
    }
  });

  it("validCompositions scales with the team count; 0 or 1 teams have no choice", () => {
    expect(validCompositions("noSuchHull" as ShipTypeKey)).toEqual([]);
    const one = "syntheticOneTeam" as ShipTypeKey;
    cleanup = registerSyntheticHull(one, [
      { teamType: "security", size: 3, count: 1 },
      { teamType: "science", size: 3, count: 1 },
    ], 2);
    expect(validCompositions(one)).toEqual([["ground"]]);
    cleanup();
    const three = "syntheticSixSquads" as ShipTypeKey;
    cleanup = registerSyntheticHull(three, [
      { teamType: "security", size: 3, count: 1 },
      { teamType: "science", size: 3, count: 1 },
    ], 6);
    const valid = validCompositions(three);
    // multisets of 3 kinds = 10; refused: SSS-strike and SSS-survey
    expect(valid).toHaveLength(8);
    expect(valid[0]).toEqual(["ground", "ground", "ground"]);
    expect(valid.map(compositionLabel)).toContain("Strike + Strike + Survey");
  });

  it("labels read Strike, then Survey, then Ground, whatever the team order", () => {
    expect(compositionLabel(["ground", "strike"])).toBe("Strike + Ground");
    expect(compositionLabel(["strike", "ground"])).toBe("Strike + Ground");
    expect(compositionLabel(["survey", "strike"])).toBe("Strike + Survey");
    expect(compositionLabel(["ground", "survey"])).toBe("Survey + Ground");
    expect(compositionLabel([])).toBe("");
  });
});

describe("shipTeamKinds / shipComposition (absent-safe reads of the stored kinds)", () => {
  const ship = (groundTeams?: unknown): ShipInstance =>
    ({ id: "ship-1", typeKey: "generalFreighter", assignedCaptainId: 1, ...(groundTeams === undefined ? {} : { groundTeams }) }) as ShipInstance;

  it("a ship without teams reads as Ground + Ground", () => {
    expect(shipTeamKinds(ship())).toEqual(["ground", "ground"]);
    expect(shipComposition(ship())).toEqual({ security: 2, science: 2 });
  });

  it("reads each stored kind; a missing or unknown kind reads as Ground; sized to the hull's team count", () => {
    expect(shipTeamKinds(ship([{ kind: "strike" }, { kind: "survey" }]))).toEqual(["strike", "survey"]);
    expect(shipTeamKinds(ship([{ kind: "strike" }, { kind: "bogus" }]))).toEqual(["strike", "ground"]);
    expect(shipTeamKinds(ship([{ kind: "strike" }]))).toEqual(["strike", "ground"]);
    expect(shipTeamKinds(ship([{ kind: "survey" }, { kind: "strike" }, { kind: "strike" }]))).toEqual(["survey", "strike"]);
    expect(shipTeamKinds(ship("corrupt"))).toEqual(["ground", "ground"]);
    expect(shipTeamKinds(ship([null, 7]))).toEqual(["ground", "ground"]);
    expect(shipComposition(ship([{ kind: "strike" }, { kind: "ground" }]))).toEqual({ security: 3, science: 1 });
  });
});

describe("the backup roster (user follow-up: a fixed crew per ship plus ~2 reserve berths, PROVISIONAL)", () => {
  it("one named constant, 2 berths per ship that fields ground teams", () => {
    expect(GROUND_RESERVE_BERTHS).toBe(2);
    for (const key of HULLS) expect(shipReserveBerths(key), key).toBe(GROUND_RESERVE_BERTHS);
    expect(shipReserveBerths("noSuchHull" as ShipTypeKey)).toBe(0);
  });

  it("the fixed crew follows the composition: slots per type plus the shared reserve berths", () => {
    // General Freighter 3 / 3
    expect(shipCrewCapacity("generalFreighter", ["ground", "ground"])).toEqual({
      security: 6, science: 6, reserveBerths: 2, total: 14,
    });
    expect(shipCrewCapacity("generalFreighter", ["strike", "ground"])).toEqual({
      security: 9, science: 3, reserveBerths: 2, total: 14,
    });
    expect(shipCrewCapacity("generalFreighter", ["survey", "ground"])).toEqual({
      security: 3, science: 9, reserveBerths: 2, total: 14,
    });
    // every valid composition of a hull holds the SAME fixed crew (4 squads + the berths) when sizes match
    const totals = validCompositions("generalFreighter").map((c) => shipCrewCapacity("generalFreighter", c).total);
    expect(new Set(totals).size).toBe(1);
  });

  it("reserve berths used = the members of each type past that type's slots, summed", () => {
    const cap = shipCrewCapacity("generalFreighter", ["strike", "ground"]); // 9 Security / 3 Science slots
    expect(reserveBerthsUsed({ security: 9, science: 3 }, cap)).toBe(0);
    expect(reserveBerthsUsed({ security: 4, science: 3 }, cap)).toBe(0); // empty slots are not berths
    expect(reserveBerthsUsed({ security: 9, science: 5 }, cap)).toBe(2); // the two extra Science fill the berths
    expect(reserveBerthsUsed({ security: 10, science: 5 }, cap)).toBe(3); // over the berths (the caller decides)
  });
});
