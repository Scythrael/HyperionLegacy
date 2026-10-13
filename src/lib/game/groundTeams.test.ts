// Ground Operations GO-1: the per-ship ground-team slot state (D25, plan section 2) and its pure readers.
// GO-2 adds the slotting actions, the crew-action sync and the deployable reader (dispatch still reads
// deployableMembers until GO-7b). Squads SQ-1 (SAVE v68): every hull fields 2 teams, each with a kind;
// the stored fixtures below are v68 Ground + Ground unless a test says otherwise.

import { afterEach, describe, expect, it } from "vitest";
import {
  freshState,
  SHIP_TYPES,
  type AwayMember,
  type AwayTeamType,
  type Expedition,
  type GameState,
  type GroundTeamKind,
  type ShipGroundTeam,
  type ShipInstance,
  type ShipTypeKey,
} from "./model";
import {
  awayRecruitCandidates,
  canHireAwayMember,
  fireAwayMember,
  hireAwayMember,
  reassignAwayMember,
} from "./awayTeam";
import {
  GROUND_SQUAD_TYPES,
  GROUND_TEAM_DEFAULT_NAMES,
  GROUND_TEAM_NAME_MAX,
  backfillV67ShipGroundTeams,
  canSetGroundTeamKind,
  canSlotMember,
  canSwapGroundMembers,
  canUnslotMember,
  deployableGroundTeams,
  emptyGroundTeams,
  groundDeployBlockText,
  groundSlotBlockText,
  groundSquadSize,
  groundTeamCount,
  groundTeamName,
  groundTeamShortLabel,
  groundTeamWaitText,
  groundWaitTeams,
  isWellFormedGroundTeamLoadout,
  isWellFormedShipGroundTeams,
  isWellFormedV67ShipGroundTeams,
  previewGroundTeamKind,
  renameGroundTeam,
  setGroundTeamHelp,
  setGroundTeamKind,
  shipGroundTeams,
  shipsWithMemberAutoSlotted,
  shipsWithMemberUnslotted,
  slotMember,
  swapGroundMembers,
  unslotMember,
  isWellFormedV68ShipGroundTeams,
  V67_GROUND_TEAM_COUNT,
  V68_GROUND_TEAM_COUNT,
  v67GroundTeamCount,
  v68ShipGroundTeamsFromV67,
} from "./groundTeams";
import { expeditionAwayTeamCheck } from "./expedition";
import { formatCountdown } from "./format";
import { plainAwayMember, registerSyntheticHull } from "./awayTeamTestFixtures";

const HULLS = Object.keys(SHIP_TYPES) as ShipTypeKey[];

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

// An empty GROUND team for the General Freighter (3 / 3), the shape of a team nobody is slotted into.
const emptyFreighterTeam = () => ({
  kind: "ground" as const,
  security: [null, null, null] as (string | null)[],
  science: [null, null, null] as (string | null)[],
  helpOthers: false,
});

describe("groundTeamCount / groundSquadSize (Squads SQ-1: a team is a PAIR of squads, groundSquads / 2 teams)", () => {
  it("is 2 on every hull (4 squads), with the squad sizes the hull lists", () => {
    for (const key of HULLS) {
      expect(groundTeamCount(key), key).toBe(2);
      expect(groundTeamCount(key), key).toBe(SHIP_TYPES[key].groundSquads / 2);
      // a squad's size is the hull's awayTeams entry size
      expect(groundSquadSize(key, "security"), key).toBe(SHIP_TYPES[key].awayTeams?.find((t) => t.teamType === "security")?.size);
      expect(groundSquadSize(key, "science"), key).toBe(SHIP_TYPES[key].awayTeams?.find((t) => t.teamType === "science")?.size);
    }
  });

  it("a synthetic hull with 6 squads fields 3 Ground teams with the entry's sizes", () => {
    const key = "syntheticTriple" as ShipTypeKey;
    cleanup = registerSyntheticHull(key, [
      { teamType: "security", size: 4, count: 3 },
      { teamType: "science", size: 2, count: 3 },
    ]);
    expect(SHIP_TYPES[key].groundSquads).toBe(6); // the fixture default: 2 x the Security count
    expect(groundTeamCount(key)).toBe(3);
    expect(groundSquadSize(key, "security")).toBe(4);
    expect(groundSquadSize(key, "science")).toBe(2);
    const teams = emptyGroundTeams(key);
    expect(teams).toHaveLength(3);
    for (const t of teams) {
      expect(t).toEqual({ kind: "ground", security: [null, null, null, null], science: [null, null], helpOthers: false });
    }
    // fresh arrays per team (never aliased)
    expect(teams[0].security).not.toBe(teams[1].security);
  });

  it("the team count reads groundSquads, not the awayTeams count", () => {
    const key = "syntheticSquadsOnly" as ShipTypeKey;
    cleanup = registerSyntheticHull(key, [
      { teamType: "security", size: 3, count: 1 },
      { teamType: "science", size: 3, count: 1 },
    ], 8);
    expect(groundTeamCount(key)).toBe(4);
    // the frozen v67 shape reads no hull data at all: a hull unknown at v67 fields no v67 team
    expect(v67GroundTeamCount(key)).toBe(0);
    expect(v67GroundTeamCount("generalFreighter")).toBe(V67_GROUND_TEAM_COUNT);
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
    expect(emptyGroundTeams(key)).toEqual([{ kind: "ground", security: [null, null], science: [], helpOthers: false }]);
  });

  it("emptyGroundTeams is Ground + Ground on every hull, with no pending flag", () => {
    for (const key of HULLS) {
      const teams = emptyGroundTeams(key);
      expect(teams.map((t) => t.kind), key).toEqual(["ground", "ground"]);
      expect(teams.some((t) => "kindPending" in t), key).toBe(false);
    }
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
    const teams = [{ ...emptyFreighterTeam(), name: "Red Squad" }, emptyFreighterTeam()];
    expect(groundTeamName(ship(teams), 0)).toBe("Red Squad");
    expect(groundTeamName(ship(teams), 1)).toBe("Bravo");
    const blank = [{ ...emptyFreighterTeam(), name: "   " }, emptyFreighterTeam()];
    expect(groundTeamName(ship(blank), 0)).toBe("Alpha");
  });

  it("short labels go by INDEX, even after a rename", () => {
    expect([0, 1, 2].map(groundTeamShortLabel)).toEqual(["A", "B", "C"]);
    expect(groundTeamShortLabel(3)).toBe("D");
  });
});

describe("shipGroundTeams (absent-safe reader, a NORMALIZED COPY since GO-2)", () => {
  it("returns an equal COPY of a well-formed stored value, never the stored arrays", () => {
    const groundTeams: ShipGroundTeam[] = [
      { kind: "ground", security: ["member-1", null, null], science: [null, null, null], helpOthers: true },
      { ...emptyFreighterTeam(), kindPending: true },
    ];
    const s: ShipInstance = { id: "ship-1", typeKey: "generalFreighter", assignedCaptainId: 1, groundTeams };
    const read = shipGroundTeams(s);
    expect(read).toEqual(groundTeams);
    expect(read).not.toBe(groundTeams);
    expect(read[0]).not.toBe(groundTeams[0]);
    expect(read[0].security).not.toBe(groundTeams[0].security);
    // a write to the copy never reaches the ship
    read[0].security[1] = "member-9";
    read[0].helpOthers = false;
    expect(groundTeams[0]).toEqual({ kind: "ground", security: ["member-1", null, null], science: [null, null, null], helpOthers: true });
  });

  it("reads an absent value as the hull's empty teams", () => {
    const s: ShipInstance = { id: "ship-9", typeKey: "destroyer", assignedCaptainId: null };
    expect(shipGroundTeams(s)).toEqual(emptyGroundTeams("destroyer"));
  });

  it("sizes slot lists to the hull (extra slots dropped, missing ones null) and the team count too", () => {
    const stored = [
      { name: "Red", kind: "ground", security: ["member-1", "member-2", "member-3", "member-4"], science: ["member-5"], helpOthers: true },
      { kind: "ground", security: ["member-6"], science: [], helpOthers: false },
      { kind: "ground", security: ["member-7"], science: [], helpOthers: false }, // a 3rd team the hull does not field
    ];
    const s = { id: "ship-1", typeKey: "generalFreighter", assignedCaptainId: 1, groundTeams: stored } as ShipInstance;
    expect(shipGroundTeams(s)).toEqual([
      { name: "Red", kind: "ground", security: ["member-1", "member-2", "member-3"], science: ["member-5", null, null], helpOthers: true },
      { kind: "ground", security: ["member-6", null, null], science: [null, null, null], helpOthers: false },
    ]);
  });

  it("a v67 team (no kind) reads as Ground; a missing second team reads as an empty Ground team", () => {
    const stored = [{ security: ["member-1", null, null], science: [null, null, null], helpOthers: false }];
    const s = { id: "ship-1", typeKey: "generalFreighter", assignedCaptainId: 1, groundTeams: stored } as unknown as ShipInstance;
    expect(shipGroundTeams(s)).toEqual([
      { kind: "ground", security: ["member-1", null, null], science: [null, null, null], helpOthers: false },
      emptyFreighterTeam(),
    ]);
  });

  it("sizes each team's slot lists by its KIND (Strike = 2 Security squads, Survey = 2 Science squads)", () => {
    const stored = [
      { kind: "strike", security: ["member-1", null, null, "member-4"], science: ["member-9"], helpOthers: false },
      { kind: "survey", security: ["member-2"], science: ["member-5", null, null, null, null, null, "member-x"], helpOthers: false },
    ];
    const s = { id: "ship-1", typeKey: "generalFreighter", assignedCaptainId: 1, groundTeams: stored } as ShipInstance;
    expect(shipGroundTeams(s)).toEqual([
      { kind: "strike", security: ["member-1", null, null, "member-4", null, null], science: [], helpOthers: false },
      { kind: "survey", security: [], science: ["member-5", null, null, null, null, null], helpOthers: false },
    ]);
  });

  it("reads malformed entries as empty (non-string ids, a non-object team, a non-boolean toggle, a bad name, a bad kind)", () => {
    const key = "syntheticPairRead" as ShipTypeKey;
    cleanup = registerSyntheticHull(key, [
      { teamType: "security", size: 2, count: 2 },
      { teamType: "science", size: 1, count: 2 },
    ]);
    const stored = [{ name: 7, kind: "elite", security: [3, "member-1"], science: "x", helpOthers: "yes", kindPending: "yes" }, null] as unknown;
    const s = { id: "ship-1", typeKey: key, assignedCaptainId: 1, groundTeams: stored } as ShipInstance;
    expect(shipGroundTeams(s)).toEqual([
      { kind: "ground", security: [null, "member-1"], science: [null], helpOthers: false },
      { kind: "ground", security: [null, null], science: [null], helpOthers: false },
    ]);
  });
});

describe("well-formedness guards (what the migrations keep)", () => {
  it("accepts the v68 shape, with or without a custom name or the pending flag", () => {
    expect(isWellFormedShipGroundTeams(emptyGroundTeams("generalFreighter"), "generalFreighter")).toBe(true);
    const named = [
      { name: "Red", kind: "ground", security: ["member-1", null, null], science: [null, "member-2", null], helpOthers: true },
      { ...emptyFreighterTeam(), kindPending: true },
    ];
    expect(isWellFormedShipGroundTeams(named, "generalFreighter")).toBe(true);
    const strikeSurvey = [
      { kind: "strike", security: [null, null, null, null, null, null], science: [], helpOthers: false },
      { kind: "survey", security: [], science: [null, null, null, null, null, null], helpOthers: false },
    ];
    expect(isWellFormedShipGroundTeams(strikeSurvey, "generalFreighter")).toBe(true);
  });

  it("rejects wrong team counts, a missing or unknown kind, kind-mismatched lengths, bad entries and non-arrays", () => {
    const ok = emptyFreighterTeam;
    expect(isWellFormedShipGroundTeams(undefined, "generalFreighter")).toBe(false);
    expect(isWellFormedShipGroundTeams("x", "generalFreighter")).toBe(false);
    expect(isWellFormedShipGroundTeams([], "generalFreighter")).toBe(false);
    expect(isWellFormedShipGroundTeams([ok()], "generalFreighter")).toBe(false); // the v67 count
    expect(isWellFormedShipGroundTeams([ok(), ok(), ok()], "generalFreighter")).toBe(false);
    const noKind = { ...ok() } as Record<string, unknown>;
    delete noKind.kind;
    expect(isWellFormedShipGroundTeams([noKind, ok()], "generalFreighter")).toBe(false);
    expect(isWellFormedShipGroundTeams([{ ...ok(), kind: "elite" }, ok()], "generalFreighter")).toBe(false);
    expect(isWellFormedShipGroundTeams([{ ...ok(), kind: "strike" }, ok()], "generalFreighter")).toBe(false); // Ground lengths
    expect(isWellFormedShipGroundTeams([{ ...ok(), security: [null, null] }, ok()], "generalFreighter")).toBe(false);
    expect(isWellFormedShipGroundTeams([{ ...ok(), science: [null, 7, null] }, ok()], "generalFreighter")).toBe(false);
    expect(isWellFormedShipGroundTeams([{ ...ok(), helpOthers: "yes" }, ok()], "generalFreighter")).toBe(false);
    expect(isWellFormedShipGroundTeams([{ ...ok(), name: 5 }, ok()], "generalFreighter")).toBe(false);
    expect(isWellFormedShipGroundTeams([{ ...ok(), kindPending: false }, ok()], "generalFreighter")).toBe(false);
    expect(isWellFormedShipGroundTeams([null, ok()], "generalFreighter")).toBe(false);
  });

  it("the FROZEN v67 guard keeps GO-1's shape: one team (the Security count), one squad of each type, no kind needed", () => {
    const v67 = () => ({ security: [null, null, null] as (string | null)[], science: [null, null, null] as (string | null)[], helpOthers: false });
    expect(v67GroundTeamCount("generalFreighter")).toBe(1);
    expect(isWellFormedV67ShipGroundTeams([v67()], "generalFreighter")).toBe(true);
    expect(isWellFormedV67ShipGroundTeams([{ ...v67(), name: "Red" }], "generalFreighter")).toBe(true);
    expect(isWellFormedV67ShipGroundTeams([v67(), v67()], "generalFreighter")).toBe(false);
    expect(isWellFormedV67ShipGroundTeams(emptyGroundTeams("generalFreighter"), "generalFreighter")).toBe(false);
    expect(isWellFormedV67ShipGroundTeams([{ ...v67(), security: [null, null] }], "generalFreighter")).toBe(false);
    expect(isWellFormedV67ShipGroundTeams([{ ...v67(), helpOthers: "yes" }], "generalFreighter")).toBe(false);
    expect(isWellFormedV67ShipGroundTeams([{ ...v67(), name: 5 }], "generalFreighter")).toBe(false);
    expect(isWellFormedV67ShipGroundTeams("x", "generalFreighter")).toBe(false);
  });

  it("accepts a well-formed ground team loadout (kind absent or known) and rejects the never-built per-type shape", () => {
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
    // SQ-1: GroundTeamLoadout.kind is optional (absent = Ground); a known kind passes, anything else fails
    expect(
      isWellFormedGroundTeamLoadout({ id: "squad-1", name: "Strike kit", kind: "strike", security: [kit, kit], science: [], checkedOutTo: null }),
    ).toBe(true);
    expect(
      isWellFormedGroundTeamLoadout({ id: "squad-1", name: "x", kind: "elite", security: [], science: [], checkedOutTo: null }),
    ).toBe(false);
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

describe("backfillV67ShipGroundTeams (the frozen v67 slot fill: hire order, the first N members)", () => {
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
    expect(backfillV67ShipGroundTeams(ship, members)).toEqual([
      { security: ["member-3", "member-5", "member-9"], science: ["member-4", "member-7", null], helpOthers: false },
    ]);
  });

  it("is FROZEN: one team at the v67 squad sizes whatever the live hull says; a hull unknown at v67 gets none", () => {
    const key = "syntheticPair" as ShipTypeKey;
    cleanup = registerSyntheticHull(key, [
      { teamType: "security", size: 2, count: 2 },
      { teamType: "science", size: 1, count: 2 },
    ]);
    const members = ["member-1", "member-2", "member-3", "member-4", "member-5"].map((id) =>
      plainAwayMember(id, "security", "ship-7"),
    );
    members.push(plainAwayMember("member-6", "science", "ship-7"));
    expect(backfillV67ShipGroundTeams({ id: "ship-7", typeKey: key }, members)).toEqual([]);
    // a Destroyer (4 / 3 at v67): one team, the frozen sizes
    expect(backfillV67ShipGroundTeams({ id: "ship-7", typeKey: "destroyer" }, members)).toEqual([
      { security: ["member-1", "member-2", "member-3", "member-4"], science: ["member-6", null, null], helpOthers: false },
    ]);
  });

  it("skips malformed member entries", () => {
    const ship: ShipInstance = { id: "ship-1", typeKey: "generalFreighter", assignedCaptainId: 1 };
    const members = [null, 7, { id: 3 }, plainAwayMember("member-2", "science", "ship-1")] as unknown[];
    expect(backfillV67ShipGroundTeams(ship, members)).toEqual([
      { security: [null, null, null], science: ["member-2", null, null], helpOthers: false },
    ]);
  });
});

describe("v68ShipGroundTeamsFromV67 (Squads SQ-1: the v67 -> v68 team upgrade)", () => {
  const v67Team = { name: "Red", security: ["member-3", "member-5", null], science: ["member-4", null, null], helpOthers: true };

  it("stamps each v67 team Ground (slots, name and help untouched) and appends an empty Ground pair", () => {
    const ship = { typeKey: "generalFreighter" as ShipTypeKey };
    expect(v68ShipGroundTeamsFromV67(ship, [v67Team], true)).toEqual([
      { ...v67Team, kind: "ground" },
      { ...emptyFreighterTeam(), kindPending: true },
    ]);
    // without markAdded the appended pair is a plain Ground team (a fresh ship's shape)
    expect(v68ShipGroundTeamsFromV67(ship, [v67Team], false)).toEqual([{ ...v67Team, kind: "ground" }, emptyFreighterTeam()]);
    // the result is v68 well-formed either way
    expect(isWellFormedShipGroundTeams(v68ShipGroundTeamsFromV67(ship, [v67Team], true), "generalFreighter")).toBe(true);
  });

  it("never moves a member and never aliases the input arrays", () => {
    const input = [{ ...v67Team, security: [...v67Team.security], science: [...v67Team.science] }];
    const out = v68ShipGroundTeamsFromV67({ typeKey: "generalFreighter" }, input, true);
    expect(out[0].security).toEqual(input[0].security);
    expect(out[0].security).not.toBe(input[0].security);
    expect(out[1].security.every((id) => id === null) && out[1].science.every((id) => id === null)).toBe(true);
  });

  it("is FROZEN: always 2 teams at the v68 squad sizes; an over-long v67 list keeps its first teams; a hull unknown at v68 gets none", () => {
    const key = "syntheticUpgradeTriple" as ShipTypeKey;
    cleanup = registerSyntheticHull(key, [
      { teamType: "security", size: 1, count: 3 },
      { teamType: "science", size: 1, count: 3 },
    ]);
    const t = (id: string) => ({ security: [id], science: [null], helpOthers: false });
    expect(v68ShipGroundTeamsFromV67({ typeKey: key }, [t("member-1"), t("member-2"), t("member-3")], true)).toEqual([]);
    const cut = v68ShipGroundTeamsFromV67({ typeKey: "generalFreighter" }, [t("member-1"), t("member-2"), t("member-3")], true);
    expect(cut).toHaveLength(V68_GROUND_TEAM_COUNT);
    expect(cut.some((x) => x.kindPending)).toBe(false);
    // the frozen v68 guard accepts exactly that shape on the hulls of the day
    const up = v68ShipGroundTeamsFromV67({ typeKey: "destroyer" }, [], true);
    expect(isWellFormedV68ShipGroundTeams(up, "destroyer")).toBe(true);
    expect(up.map((x) => [x.security.length, x.science.length])).toEqual([[4, 3], [4, 3]]);
    expect(isWellFormedV68ShipGroundTeams([], key)).toBe(true);
    expect(isWellFormedV68ShipGroundTeams(up, key)).toBe(false);
    expect(isWellFormedV68ShipGroundTeams([{ ...up[0], kind: "strike" }, up[1]], "destroyer")).toBe(false); // Ground lengths
    expect(isWellFormedV68ShipGroundTeams([{ ...up[0], kind: "strike", security: Array(8).fill(null), science: [] }, up[1]], "destroyer")).toBe(true);
  });
});

describe("freshState ground teams", () => {
  it("gives the starting ship well-formed, empty Ground + Ground teams (no pending prompt)", () => {
    const s = freshState();
    const ship = s.ships[0];
    expect(ship.groundTeams).toEqual(emptyGroundTeams(ship.typeKey));
    expect(ship.groundTeams).toEqual([emptyFreighterTeam(), emptyFreighterTeam()]);
    expect(isWellFormedShipGroundTeams(ship.groundTeams, ship.typeKey)).toBe(true);
    expect(s.squadLoadouts).toEqual([]);
  });
});

// ============================================================================
// GO-2: slotting engine + crew-action sync + the deployable reader
// ============================================================================

const EM_DASH = String.fromCharCode(0x2014);

// The GO-2 invariant, asserted after every action below: a member sits in at most one slot fleet-wide; a
// slot only holds a member aboard THAT ship with the matching team type; stored slot lists are hull-sized.
function assertSlotInvariants(state: GameState): void {
  const seen = new Set<string>();
  for (const ship of state.ships) {
    if (ship.groundTeams === undefined) continue;
    expect(isWellFormedShipGroundTeams(ship.groundTeams, ship.typeKey), `${ship.id} well-formed`).toBe(true);
    for (const team of ship.groundTeams) {
      for (const type of GROUND_SQUAD_TYPES) {
        for (const id of team[type]) {
          if (id === null) continue;
          expect(seen.has(id), `${id} sits in one slot`).toBe(false);
          seen.add(id);
          const m = state.awayMembers.find((x) => x.id === id);
          expect(m, `${id} is a member`).toBeDefined();
          expect(m?.assignedShipId, `${id} aboard ${ship.id}`).toBe(ship.id);
          expect(m?.teamType, `${id} type`).toBe(type);
        }
      }
    }
  }
}

const slotsOf = (state: GameState, shipId: string) => {
  const ship = state.ships.find((s) => s.id === shipId) as ShipInstance;
  return shipGroundTeams(ship);
};

const named = (id: string, teamType: AwayTeamType, shipId: string | null, name = `Member ${id}`): AwayMember => ({
  ...plainAwayMember(id, teamType, shipId as string),
  name,
});

// ship-1 (General Freighter, 3 + 3 slots per team, Ground + Ground): s1, s2 slotted Security in Alpha, s3
// aboard in the reserve, c1 slotted Science, p1 a Prospecting member aboard; Bravo empty. ship-2 (minted after
// v67, no groundTeams field): x1 Security.
function crewState(extra: Partial<GameState> = {}): GameState {
  const base = freshState();
  return {
    ...base,
    ships: [
      {
        ...base.ships[0],
        groundTeams: [
          { kind: "ground", security: ["member-1", "member-2", null], science: ["member-11", null, null], helpOthers: false },
          emptyFreighterTeam(),
        ],
      },
      { id: "ship-2", typeKey: "generalFreighter", assignedCaptainId: null },
    ],
    awayMembers: [
      named("member-1", "security", "ship-1"),
      named("member-2", "security", "ship-1", "Grokk"),
      named("member-3", "security", "ship-1"),
      named("member-11", "science", "ship-1"),
      named("member-21", "prospecting", "ship-1"),
      named("member-31", "security", "ship-2"),
      named("member-41", "security", null),
    ],
    nextAwayMemberId: 100,
    ...extra,
  };
}

// The same state with ship-1's crew locked (an expedition out: its members are busy on the run).
const locked = (state: GameState): GameState => ({
  ...state,
  expeditions: [{ shipId: "ship-1" } as unknown as Expedition],
});

describe("GO-2 canSlotMember / slotMember", () => {
  it("refuses with a reason, in order, and the action returns the SAME state", () => {
    const s = crewState();
    const cases: [Parameters<typeof canSlotMember>, string][] = [
      [[s, "ship-x", 0, "security", 2, "member-3"], "noShip"],
      [[locked(s), "ship-1", 0, "security", 2, "member-3"], "onMission"],
      [[s, "ship-1", 2, "security", 2, "member-3"], "noSuchTeam"],
      [[s, "ship-1", -1, "security", 2, "member-3"], "noSuchTeam"],
      [[s, "ship-1", 0.5, "security", 2, "member-3"], "noSuchTeam"],
      [[s, "ship-1", 0, "security", 3, "member-3"], "noSuchSlot"],
      [[s, "ship-1", 0, "security", -1, "member-3"], "noSuchSlot"],
      [[s, "ship-1", 0, "security", 2, "member-999"], "noMember"],
      [[s, "ship-1", 0, "security", 2, "member-31"], "wrongShip"],
      [[s, "ship-1", 0, "security", 2, "member-41"], "wrongShip"],
      [[s, "ship-1", 0, "security", 2, "member-11"], "wrongTeamType"],
      [[s, "ship-1", 0, "science", 1, "member-21"], "wrongTeamType"],
      [[s, "ship-1", 0, "security", 0, "member-1"], "alreadyThere"],
    ];
    for (const [args, reason] of cases) {
      expect(canSlotMember(...args), reason).toEqual({ ok: false, reason });
      expect(slotMember(...args), reason).toBe(args[0]);
    }
  });

  it("slots a reserve member into an empty slot", () => {
    const s = crewState();
    expect(canSlotMember(s, "ship-1", 0, "security", 2, "member-3")).toEqual({ ok: true });
    const next = slotMember(s, "ship-1", 0, "security", 2, "member-3");
    expect(slotsOf(next, "ship-1")[0].security).toEqual(["member-1", "member-2", "member-3"]);
    expect(next.awayMembers).toBe(s.awayMembers);
    assertSlotInvariants(next);
  });

  it("slotting onto an occupied slot unslots the occupant (still aboard, in the reserve)", () => {
    const s = crewState();
    const next = slotMember(s, "ship-1", 0, "security", 0, "member-3");
    expect(slotsOf(next, "ship-1")[0].security).toEqual(["member-3", "member-2", null]);
    expect(next.awayMembers.find((m) => m.id === "member-1")?.assignedShipId).toBe("ship-1");
    assertSlotInvariants(next);
  });

  it("moving a slotted member leaves their old slot empty", () => {
    const next = slotMember(crewState(), "ship-1", 0, "security", 2, "member-1");
    expect(slotsOf(next, "ship-1")[0].security).toEqual([null, "member-2", "member-1"]);
    assertSlotInvariants(next);
  });

  it("writes a ship minted without the field through the normalized copy", () => {
    const next = slotMember(crewState(), "ship-2", 0, "security", 1, "member-31");
    expect(next.ships[1].groundTeams).toEqual([
      { kind: "ground", security: [null, "member-31", null], science: [null, null, null], helpOthers: false },
      emptyFreighterTeam(),
    ]);
    assertSlotInvariants(next);
  });

  it("never mutates its input", () => {
    const s = crewState();
    const before = JSON.stringify(s);
    slotMember(s, "ship-1", 0, "security", 0, "member-3");
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe("GO-2 canUnslotMember / unslotMember", () => {
  it("unslots into the reserve", () => {
    const next = unslotMember(crewState(), "ship-1", "member-1");
    expect(slotsOf(next, "ship-1")[0].security).toEqual([null, "member-2", null]);
    expect(next.awayMembers.find((m) => m.id === "member-1")?.assignedShipId).toBe("ship-1");
    assertSlotInvariants(next);
  });

  it("refuses (SAME state): unknown ship, crew locked, unknown member, wrong ship, not slotted", () => {
    const s = crewState();
    const cases: [GameState, string, string, string][] = [
      [s, "ship-x", "member-1", "noShip"],
      [locked(s), "ship-1", "member-1", "onMission"],
      [s, "ship-1", "member-999", "noMember"],
      [s, "ship-1", "member-31", "wrongShip"],
      [s, "ship-1", "member-3", "notSlotted"],
    ];
    for (const [state, shipId, memberId, reason] of cases) {
      expect(canUnslotMember(state, shipId, memberId), reason).toEqual({ ok: false, reason });
      expect(unslotMember(state, shipId, memberId), reason).toBe(state);
    }
  });
});

describe("GO-2 canSwapGroundMembers / swapGroundMembers", () => {
  it("swaps two slotted members", () => {
    const next = swapGroundMembers(crewState(), "ship-1", "member-1", "member-2");
    expect(slotsOf(next, "ship-1")[0].security).toEqual(["member-2", "member-1", null]);
    assertSlotInvariants(next);
  });

  it("swaps a slotted member out for a reserve member (either order)", () => {
    for (const [a, b] of [["member-2", "member-3"], ["member-3", "member-2"]]) {
      const next = swapGroundMembers(crewState(), "ship-1", a, b);
      expect(slotsOf(next, "ship-1")[0].security).toEqual(["member-1", "member-3", null]);
      assertSlotInvariants(next);
    }
  });

  it("swaps across ground teams on one ship", () => {
    const key = "syntheticSwapPair" as ShipTypeKey;
    cleanup = registerSyntheticHull(key, [
      { teamType: "security", size: 1, count: 2 },
      { teamType: "science", size: 1, count: 2 },
    ]);
    const base = crewState();
    const s: GameState = {
      ...base,
      ships: [
        {
          id: "ship-1", typeKey: key, assignedCaptainId: 1,
          groundTeams: [
            { kind: "ground", security: ["member-1"], science: [null], helpOthers: false },
            { kind: "ground", security: ["member-2"], science: [null], helpOthers: false },
          ],
        },
      ],
      awayMembers: base.awayMembers.filter((m) => m.assignedShipId === "ship-1"),
    };
    const next = swapGroundMembers(s, "ship-1", "member-1", "member-2");
    expect(slotsOf(next, "ship-1").map((t) => t.security)).toEqual([["member-2"], ["member-1"]]);
    assertSlotInvariants(next);
  });

  it("refuses (SAME state) with a reason", () => {
    const s = crewState({
      awayMembers: [...crewState().awayMembers, named("member-4", "security", "ship-1")],
    });
    const cases: [GameState, string, string, string, string][] = [
      [s, "ship-x", "member-1", "member-2", "noShip"],
      [locked(s), "ship-1", "member-1", "member-2", "onMission"],
      [s, "ship-1", "member-1", "member-1", "alreadyThere"],
      [s, "ship-1", "member-999", "member-1", "noMember"],
      [s, "ship-1", "member-1", "member-999", "noMember"],
      [s, "ship-1", "member-1", "member-31", "wrongShip"],
      [s, "ship-1", "member-1", "member-11", "wrongTeamType"],
      [s, "ship-1", "member-3", "member-4", "notSlotted"],
    ];
    for (const [state, shipId, a, b, reason] of cases) {
      expect(canSwapGroundMembers(state, shipId, a, b), reason).toEqual({ ok: false, reason });
      expect(swapGroundMembers(state, shipId, a, b), reason).toBe(state);
    }
  });
});

describe("GO-2 renameGroundTeam (blank restores the default name)", () => {
  it("stores a trimmed name, cut to GROUND_TEAM_NAME_MAX", () => {
    const next = renameGroundTeam(crewState(), "ship-1", 0, "  Red Squad  ");
    expect(slotsOf(next, "ship-1")[0].name).toBe("Red Squad");
    expect(groundTeamName(next.ships[0], 0)).toBe("Red Squad");
    const long = renameGroundTeam(crewState(), "ship-1", 0, "x".repeat(40));
    expect(slotsOf(long, "ship-1")[0].name).toBe("x".repeat(GROUND_TEAM_NAME_MAX));
    expect(GROUND_TEAM_NAME_MAX).toBe(24);
    assertSlotInvariants(next);
  });

  it("blank, null, or the team's own default name clears it (Alpha again)", () => {
    const named1 = renameGroundTeam(crewState(), "ship-1", 0, "Red Squad");
    for (const clear of ["", "   ", null, "Alpha", " Alpha "]) {
      const next = renameGroundTeam(named1, "ship-1", 0, clear);
      expect(next).not.toBe(named1);
      expect("name" in next.ships[0].groundTeams![0]).toBe(false);
      expect(groundTeamName(next.ships[0], 0)).toBe("Alpha");
    }
  });

  it("returns the SAME state when nothing changes, or for an unknown ship / team", () => {
    const s = crewState();
    expect(renameGroundTeam(s, "ship-1", 0, "")).toBe(s);
    expect(renameGroundTeam(s, "ship-1", 0, "Alpha")).toBe(s);
    const named1 = renameGroundTeam(s, "ship-1", 0, "Red");
    expect(renameGroundTeam(named1, "ship-1", 0, " Red ")).toBe(named1);
    expect(renameGroundTeam(s, "ship-x", 0, "Red")).toBe(s);
    expect(renameGroundTeam(s, "ship-1", 2, "Red")).toBe(s);
    expect(renameGroundTeam(s, "ship-1", -1, "Red")).toBe(s);
  });

  it("is allowed while the ship is out (cosmetic) [PROVISIONAL]", () => {
    const s = locked(crewState());
    expect(groundTeamName(renameGroundTeam(s, "ship-1", 0, "Red").ships[0], 0)).toBe("Red");
  });
});

describe("GO-2 setGroundTeamHelp (the ship default for the next dispatch)", () => {
  it("sets and clears the toggle; an equal value is the SAME state", () => {
    const s = crewState();
    const on = setGroundTeamHelp(s, "ship-1", 0, true);
    expect(slotsOf(on, "ship-1")[0].helpOthers).toBe(true);
    expect(setGroundTeamHelp(on, "ship-1", 0, true)).toBe(on);
    expect(slotsOf(setGroundTeamHelp(on, "ship-1", 0, false), "ship-1")[0].helpOthers).toBe(false);
    expect(setGroundTeamHelp(s, "ship-1", 0, false)).toBe(s);
    assertSlotInvariants(on);
  });

  it("refuses (SAME state) for an unknown ship or team; allowed while the ship is out [PROVISIONAL]", () => {
    const s = crewState();
    expect(setGroundTeamHelp(s, "ship-x", 0, true)).toBe(s);
    expect(setGroundTeamHelp(s, "ship-1", 3, true)).toBe(s);
    expect(slotsOf(setGroundTeamHelp(locked(s), "ship-1", 0, true), "ship-1")[0].helpOthers).toBe(true);
  });
});

describe("GO-2 groundSlotBlockText", () => {
  it("has a clean line for every reason", () => {
    const reasons = [
      "noShip", "onMission", "noSuchTeam", "noSuchSlot", "noMember", "wrongShip", "wrongTeamType", "alreadyThere", "notSlotted",
      "noSuchKind", "sameKind", "needsBothTypes",
    ] as const;
    for (const r of reasons) {
      const text = groundSlotBlockText(r);
      expect(text.length, r).toBeGreaterThan(5);
      expect(text.includes(EM_DASH) || text.includes("--"), r).toBe(false);
    }
  });
});

describe("GO-2 crew sync: every arrival aboard auto-slots, every departure unslots", () => {
  const board = (state: GameState, teamType: AwayTeamType) => awayRecruitCandidates(state).filter((c) => c.teamType === teamType);

  it("hire auto-slots into the first empty slot of the matching squad", () => {
    let s = freshState();
    const sec = board(s, "security");
    const sci = board(s, "science");
    expect(sec.length).toBeGreaterThanOrEqual(2);
    expect(sci.length).toBeGreaterThanOrEqual(1);
    s = hireAwayMember(s, sec[0].id, "ship-1");
    s = hireAwayMember(s, sci[0].id, "ship-1");
    s = hireAwayMember(s, sec[1].id, "ship-1");
    expect(slotsOf(s, "ship-1")[0]).toEqual({
      kind: "ground",
      security: ["member-1", "member-3", null],
      science: ["member-2", null, null],
      helpOthers: false,
    });
    assertSlotInvariants(s);
  });

  it("hire fills a gap the player left (first empty slot, not the end)", () => {
    let s = freshState();
    const sec = board(s, "security");
    s = hireAwayMember(s, sec[0].id, "ship-1");
    s = hireAwayMember(s, sec[1].id, "ship-1");
    s = unslotMember(s, "ship-1", "member-1");
    expect(slotsOf(s, "ship-1")[0].security).toEqual([null, "member-2", null]);
    expect(sec.length).toBeGreaterThanOrEqual(3);
    s = hireAwayMember(s, sec[2].id, "ship-1");
    expect(slotsOf(s, "ship-1")[0].security).toEqual(["member-3", "member-2", null]);
    assertSlotInvariants(s);
  });

  it("hire onto a ship minted without groundTeams writes its normalized teams", () => {
    const base = freshState();
    let s: GameState = { ...base, ships: [...base.ships, { id: "ship-2", typeKey: "generalFreighter", assignedCaptainId: null }] };
    s = hireAwayMember(s, board(s, "science")[0].id, "ship-2");
    expect(s.ships[1].groundTeams).toEqual([
      { kind: "ground", security: [null, null, null], science: ["member-1", null, null], helpOthers: false },
      emptyFreighterTeam(),
    ]);
    assertSlotInvariants(s);
  });

  it("SQ-2: the hire cap follows the composition (6 Security slots + 3 berths on a Ground + Ground freighter); reserves count", () => {
    const s = crewState(); // ship-1 Security: member-1, member-2 slotted + member-3 in the reserve = 3 aboard
    const sec = awayRecruitCandidates(s).find((c) => c.teamType === "security");
    expect(sec).toBeDefined();
    const hired = hireAwayMember(s, sec!.id, "ship-1");
    expect(slotsOf(hired, "ship-1")[0].security).toEqual(["member-1", "member-2", "member-100"]); // Alpha's gap first
    assertSlotInvariants(hired);
    // 9 Security aboard (6 slots + 3 berths) is full; the reserve counts toward it
    const extra = ["member-4", "member-5", "member-6", "member-7", "member-8", "member-9"].map((id) => named(id, "security", "ship-1"));
    const full = crewState({ awayMembers: [...crewState().awayMembers, ...extra] });
    expect(canHireAwayMember(full, sec!.id, "ship-1")).toEqual({ ok: false, reason: "squadFull" });
    expect(hireAwayMember(full, sec!.id, "ship-1")).toBe(full);
    // one fewer and the hire goes through, into the empty Bravo slot first
    const room = crewState({ awayMembers: [...crewState().awayMembers, ...extra.slice(0, 5)] });
    const into = hireAwayMember(room, sec!.id, "ship-1");
    expect(slotsOf(into, "ship-1").flatMap((t) => t.security)).toContain("member-100");
    assertSlotInvariants(into);
  });

  it("fire unslots (no dangling id); firing a reserve member leaves the ships untouched", () => {
    const s = crewState();
    const fired = fireAwayMember(s, "member-2");
    expect(slotsOf(fired, "ship-1")[0].security).toEqual(["member-1", null, null]);
    assertSlotInvariants(fired);
    const firedReserve = fireAwayMember(s, "member-3");
    expect(firedReserve.ships).toBe(s.ships);
    assertSlotInvariants(firedReserve);
  });

  it("reassign unslots from the old ship and auto-slots on the new one", () => {
    const s = crewState();
    const moved = reassignAwayMember(s, "member-1", "ship-2");
    expect(slotsOf(moved, "ship-1")[0].security).toEqual([null, "member-2", null]);
    expect(slotsOf(moved, "ship-2")[0].security).toEqual(["member-1", null, null]);
    assertSlotInvariants(moved);
    // a reserve member moving away leaves ship-1's slots as they were
    const reserveMoved = reassignAwayMember(s, "member-3", "ship-2");
    expect(reserveMoved.ships[0]).toBe(s.ships[0]);
    expect(slotsOf(reserveMoved, "ship-2")[0].security).toEqual(["member-3", null, null]);
    assertSlotInvariants(reserveMoved);
  });

  it("bench unslots; unbench auto-slots into the first empty slot", () => {
    const s = crewState();
    const benched = reassignAwayMember(s, "member-1", null);
    expect(slotsOf(benched, "ship-1")[0].security).toEqual([null, "member-2", null]);
    assertSlotInvariants(benched);
    const back = reassignAwayMember(benched, "member-41", "ship-2");
    expect(slotsOf(back, "ship-2")[0].security).toEqual(["member-41", null, null]);
    // ship-1 now holds 2 Security aboard (member-2, member-3): unbenching member-1 fills slot 0 again
    const home = reassignAwayMember(benched, "member-1", "ship-1");
    expect(slotsOf(home, "ship-1")[0].security).toEqual(["member-1", "member-2", null]);
    assertSlotInvariants(home);
  });

  it("auto-slot goes to team 0 first, then team 1 (multi-team hull)", () => {
    const key = "syntheticAutoPair" as ShipTypeKey;
    cleanup = registerSyntheticHull(key, [
      { teamType: "security", size: 1, count: 2 },
      { teamType: "science", size: 1, count: 2 },
    ]);
    const base = freshState();
    let s: GameState = {
      ...base,
      ships: [...base.ships, { id: "ship-7", typeKey: key, assignedCaptainId: null }],
      awayMembers: [named("member-1", "security", null), named("member-2", "security", null), named("member-3", "security", null)],
      nextAwayMemberId: 4,
    };
    s = reassignAwayMember(s, "member-1", "ship-7");
    s = reassignAwayMember(s, "member-2", "ship-7");
    expect(slotsOf(s, "ship-7").map((t) => t.security)).toEqual([["member-1"], ["member-2"]]);
    s = fireAwayMember(s, "member-1");
    s = reassignAwayMember(s, "member-3", "ship-7");
    expect(slotsOf(s, "ship-7").map((t) => t.security)).toEqual([["member-3"], ["member-2"]]);
    assertSlotInvariants(s);
  });

  it("an arrival with no empty slot in ANY team stays aboard in the reserve (the primitive returns the SAME ships)", () => {
    const extra = ["member-4", "member-5", "member-6"].map((id) => named(id, "security", "ship-1"));
    let s = crewState({ awayMembers: [...crewState().awayMembers, ...extra] });
    s = slotMember(s, "ship-1", 0, "security", 2, "member-3");
    s = slotMember(s, "ship-1", 1, "security", 0, "member-4");
    s = slotMember(s, "ship-1", 1, "security", 1, "member-5");
    s = slotMember(s, "ship-1", 1, "security", 2, "member-6");
    const full = s.ships;
    expect(shipsWithMemberAutoSlotted(full, "ship-1", "member-9", "security", s.awayMembers)).toBe(full);
    expect(shipsWithMemberAutoSlotted(full, "ship-1", "member-21", "prospecting", s.awayMembers)).toBe(full);
    expect(shipsWithMemberAutoSlotted(full, "ship-x", "member-9", "science", s.awayMembers)).toBe(full);
    expect(shipsWithMemberUnslotted(full, "member-404", s.awayMembers)).toBe(full);
  });

  it("onMission refusals still return the SAME state", () => {
    const s = locked(crewState());
    expect(fireAwayMember(s, "member-1")).toBe(s);
    expect(reassignAwayMember(s, "member-1", "ship-2")).toBe(s);
  });
});

// A Ground team's empty Security / Science squad wait (Squads SQ-2: per squad, replacing needSecurity /
// needScience).
const SEC_EMPTY = { kind: "emptySquad", squadIndex: 0, teamType: "security", typeSquadIndex: 0, typeSquads: 1 } as const;
const SCI_EMPTY = { kind: "emptySquad", squadIndex: 1, teamType: "science", typeSquadIndex: 0, typeSquads: 1 } as const;

describe("GO-2 deployableGroundTeams (no automatic stand-ins: a not-ready member holds the team)", () => {
  const NOW = 10_000;
  const at = (state: GameState): GameState => ({ ...state, gameTimeSeconds: NOW });
  const injure = (state: GameState, id: string, until: number): GameState => ({
    ...state,
    awayMembers: state.awayMembers.map((m) => (m.id === id ? { ...m, injuredUntilSeconds: until } : m)),
  });

  it("every slotted member ready: the team deploys and the ship is ok", () => {
    const check = deployableGroundTeams(at(crewState()), "ship-1");
    expect(check.ok).toBe(true);
    expect(check.reason).toBeUndefined();
    expect(check.security).toBe(2);
    expect(check.science).toBe(1);
    expect(check.readyAtSeconds).toBe(NOW);
    const [alpha] = check.teams;
    expect(alpha.name).toBe("Alpha");
    expect(alpha.deploys).toBe(true);
    expect(alpha.waits).toEqual([]);
    expect(alpha.security.map((m) => m.id)).toEqual(["member-1", "member-2"]); // slot order, reserve left out
    expect(alpha.science.map((m) => m.id)).toEqual(["member-11"]);
    expect(groundDeployBlockText(check, NOW)).toBeNull();
  });

  it("an injured slotted member holds the team and says when they return; a ready reserve member does NOT stand in", () => {
    const s = injure(at(crewState()), "member-2", NOW + 12 * 60);
    const check = deployableGroundTeams(s, "ship-1");
    expect(check.ok).toBe(false);
    expect(check.reason).toBe("noTeamReady");
    expect(check.security).toBe(0);
    expect(check.readyAtSeconds).toBe(NOW + 720);
    const [alpha] = check.teams;
    expect(alpha.deploys).toBe(false);
    expect(alpha.security.map((m) => m.id)).toEqual(["member-1", "member-2"]); // member-3 (ready, reserve) is not pulled in
    expect(alpha.waits).toEqual([
      { kind: "injured", memberId: "member-2", memberName: "Grokk", teamType: "security", readyAtSeconds: NOW + 720, secondsLeft: 720 },
    ]);
    expect(alpha.readyAtSeconds).toBe(NOW + 720);
    expect(groundTeamWaitText(alpha.waits[0])).toBe("Grokk returns to duty in 12m");
    expect(groundDeployBlockText(check, NOW)).toBe("No ground team is ready: the first is ready in 12m");
    // the player swaps Grokk out by hand, and the team deploys
    const swapped = deployableGroundTeams(swapGroundMembers(s, "ship-1", "member-2", "member-3"), "ship-1");
    expect(swapped.ok).toBe(true);
    expect(swapped.teams[0].security.map((m) => m.id)).toEqual(["member-1", "member-3"]);
  });

  it("several injuries: the team is ready when the LAST returns; a recovery already over counts as ready", () => {
    let s = injure(at(crewState()), "member-1", NOW + 100);
    s = injure(s, "member-11", NOW + 3_600 + 60);
    s = injure(s, "member-2", NOW); // recovered exactly now
    const check = deployableGroundTeams(s, "ship-1");
    expect(check.teams[0].waits.map((w) => (w.kind === "injured" ? w.memberId : w.kind))).toEqual(["member-1", "member-11"]);
    expect(check.teams[0].readyAtSeconds).toBe(NOW + 3_660);
    expect(groundTeamWaitText(check.teams[0].waits[1])).toBe("Member member-11 returns to duty in 1h 1m");
  });

  it("a team with no Science member slotted waits on the player, not the clock", () => {
    const s = unslotMember(at(crewState()), "ship-1", "member-11");
    const check = deployableGroundTeams(s, "ship-1");
    expect(check.ok).toBe(false);
    expect(check.teams[0].waits).toEqual([SCI_EMPTY]);
    expect(check.teams[0].staffed).toBe(true);
    expect(check.teams[0].readyAtSeconds).toBeNull();
    expect(check.readyAtSeconds).toBeNull();
    expect(groundTeamWaitText(SCI_EMPTY)).toBe("Needs a Science member in a slot");
    expect(groundTeamWaitText(SEC_EMPTY)).toBe("Needs a Security member in a slot");
    expect(groundDeployBlockText(check, NOW)).toBe("No ground team is ready: slot at least 1 member into each squad of a team");
  });

  it("a ship minted without groundTeams reads as unstaffed teams", () => {
    const check = deployableGroundTeams(at(crewState()), "ship-2");
    expect(check.ok).toBe(false);
    expect(check.teams).toHaveLength(2);
    for (const t of check.teams) {
      expect(t.staffed).toBe(false);
      expect(t.waits).toEqual([SEC_EMPTY, SCI_EMPTY]);
    }
  });

  it("SQ-1 groundWaitTeams: a blocked dispatch lists the staffed teams, else the first team alone", () => {
    // Alpha staffed (Grokk injured), Bravo empty: only Alpha's waits are listed
    const blocked = deployableGroundTeams(injure(at(crewState()), "member-2", NOW + 60), "ship-1");
    expect(groundWaitTeams(blocked).map((t) => t.name)).toEqual(["Alpha"]);
    // nobody slotted anywhere (a ship minted without the field): Alpha alone says what to slot
    const empty = deployableGroundTeams(at(crewState()), "ship-2");
    expect(groundWaitTeams(empty).map((t) => t.name)).toEqual(["Alpha"]);
    expect(groundWaitTeams(empty)[0].waits).toEqual([SEC_EMPTY, SCI_EMPTY]);
    // both staffed: both listed
    const key = "syntheticWaitPair" as ShipTypeKey;
    cleanup = registerSyntheticHull(key, [
      { teamType: "security", size: 1, count: 2 },
      { teamType: "science", size: 1, count: 2 },
    ]);
    const s: GameState = {
      ...at(freshState()),
      ships: [{ id: "ship-7", typeKey: key, assignedCaptainId: null, groundTeams: [
        { kind: "ground", security: ["member-1"], science: [null], helpOthers: false },
        { kind: "ground", security: [null], science: ["member-2"], helpOthers: false },
      ] }],
      awayMembers: [named("member-1", "security", "ship-7"), named("member-2", "science", "ship-7")],
    };
    expect(groundWaitTeams(deployableGroundTeams(s, "ship-7")).map((t) => t.name)).toEqual(["Alpha", "Bravo"]);
    expect(groundWaitTeams({ teams: [] })).toEqual([]);
  });

  it("SQ-1: the empty second pair never deploys and never changes the ship's answer", () => {
    const check = deployableGroundTeams(at(crewState()), "ship-1");
    expect(check.teams.map((t) => [t.name, t.staffed, t.deploys])).toEqual([["Alpha", true, true], ["Bravo", false, false]]);
    expect(check.teams[1].readyAtSeconds).toBeNull();
    // the ship's totals and readiness are Alpha's alone
    expect([check.ok, check.security, check.science, check.readyAtSeconds]).toEqual([true, 2, 1, NOW]);
  });

  it("multi-team: a waiting Alpha does not hold a ready Bravo; the ship reports the soonest team", () => {
    const key = "syntheticDeployPair" as ShipTypeKey;
    cleanup = registerSyntheticHull(key, [
      { teamType: "security", size: 2, count: 2 },
      { teamType: "science", size: 1, count: 2 },
    ]);
    const members = [
      named("member-1", "security", "ship-7"),
      named("member-2", "security", "ship-7"),
      named("member-3", "science", "ship-7"),
      named("member-4", "science", "ship-7"),
    ];
    const base = at(freshState());
    let s: GameState = {
      ...base,
      ships: [
        {
          id: "ship-7", typeKey: key, assignedCaptainId: null,
          groundTeams: [
            { name: "Vanguard", kind: "ground", security: ["member-1", null], science: ["member-3"], helpOthers: false },
            { kind: "ground", security: ["member-2", null], science: ["member-4"], helpOthers: false },
          ],
        },
      ],
      awayMembers: members,
    };
    s = injure(s, "member-1", NOW + 100);
    const check = deployableGroundTeams(s, "ship-7");
    expect(check.ok).toBe(true);
    expect(check.teams.map((t) => [t.name, t.deploys])).toEqual([["Vanguard", false], ["Bravo", true]]);
    expect(check.security).toBe(1);
    expect(check.science).toBe(1);
    // both waiting: the ship can launch when the sooner team is back
    s = injure(s, "member-4", NOW + 50);
    const both = deployableGroundTeams(s, "ship-7");
    expect(both.ok).toBe(false);
    expect(both.readyAtSeconds).toBe(NOW + 50);
    expect(groundDeployBlockText(both, NOW)).toBe("No ground team is ready: the first is ready in 50s");
  });

  it("an unknown ship, and a hull with no ground teams, say why", () => {
    expect(deployableGroundTeams(crewState(), "ship-x")).toEqual({
      ok: false, reason: "noShip", teams: [], security: 0, science: 0, readyAtSeconds: null,
    });
    const key = "syntheticNoTeams" as ShipTypeKey;
    cleanup = registerSyntheticHull(key, undefined);
    const base = crewState();
    const s: GameState = { ...base, ships: [...base.ships, { id: "ship-9", typeKey: key, assignedCaptainId: null }] };
    const check = deployableGroundTeams(s, "ship-9");
    expect(check.reason).toBe("noGroundTeams");
    expect(groundDeployBlockText(check, 0)).toBe("This ship fields no ground teams");
    expect(groundDeployBlockText(deployableGroundTeams(s, "ship-x"), 0)).toBe("That ship is no longer in the fleet");
  });

  it("a slot naming an id that is not a member aboard with that type reads as empty (defensive)", () => {
    const base = at(crewState());
    const s: GameState = {
      ...base,
      ships: base.ships.map((sh) =>
        sh.id === "ship-1"
          ? { ...sh, groundTeams: [{ kind: "ground", security: ["member-404", "member-31", "member-11"], science: ["member-11", null, null], helpOthers: false }, emptyFreighterTeam()] }
          : sh,
      ),
    };
    const check = deployableGroundTeams(s, "ship-1");
    expect(check.teams[0].security).toEqual([]);
    expect(check.teams[0].waits).toEqual([SEC_EMPTY]);
  });

  it("GO-7b: the dispatch gate IS this reader: an unslotted ready member never stands in", () => {
    const s = unslotMember(unslotMember(at(crewState()), "ship-1", "member-1"), "ship-1", "member-11");
    const check = deployableGroundTeams(s, "ship-1");
    expect(check.ok).toBe(false);
    expect(expeditionAwayTeamCheck(s, s.ships[0])).toEqual({ ok: false, security: check.security, science: check.science, ground: check });
  });

  it("the reader is pure", () => {
    const s = injure(at(crewState()), "member-2", NOW + 5);
    const before = JSON.stringify(s);
    deployableGroundTeams(s, "ship-1");
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe("GO-2 formatCountdown (the shared seconds countdown)", () => {
  it("reads s / m / h m, minutes rounded up", () => {
    expect(formatCountdown(0)).toBe("0s");
    expect(formatCountdown(Number.NaN)).toBe("0s");
    expect(formatCountdown(35)).toBe("35s");
    expect(formatCountdown(720)).toBe("12m");
    expect(formatCountdown(721)).toBe("13m");
    expect(formatCountdown(7200)).toBe("2h");
  });
});

describe("GO-3 (GO-2 review b): write paths null out slot ids that do not name a member aboard", () => {
  // ship-1 Security holds only CORRUPT ids: a member who no longer exists, a member aboard ship-2, and a
  // Science member in a Security slot. Only member-11 (Science) and member-31 (ship-2) are members.
  const corrupt = (extra: Partial<GameState> = {}): GameState => {
    const base = freshState();
    return {
      ...base,
      ships: [
        {
          ...base.ships[0],
          groundTeams: [
            { kind: "ground", security: ["member-404", "member-31", "member-11"], science: ["member-11", "member-11", null], helpOthers: false },
            emptyFreighterTeam(),
          ],
        },
        {
          id: "ship-2", typeKey: "generalFreighter", assignedCaptainId: null,
          groundTeams: [{ kind: "ground", security: ["member-31", null, null], science: [null, null, null], helpOthers: false }, emptyFreighterTeam()],
        },
      ],
      awayMembers: [named("member-11", "science", "ship-1"), named("member-31", "security", "ship-2"), named("member-41", "security", null)],
      nextAwayMemberId: 100,
      ...extra,
    };
  };

  it("hire auto-slots into a corrupt slot instead of skipping it (and clears the rest)", () => {
    const s = corrupt();
    const sec = awayRecruitCandidates(s).find((c) => c.teamType === "security");
    expect(sec).toBeDefined();
    const next = hireAwayMember(s, sec!.id, "ship-1");
    expect(slotsOf(next, "ship-1")[0]).toEqual({
      kind: "ground",
      security: ["member-100", null, null],
      science: ["member-11", null, null], // the duplicate of member-11 is cleared too (first slot kept)
      helpOthers: false,
    });
    assertSlotInvariants(next);
  });

  it("reassign and unbench auto-slot into a corrupt slot", () => {
    const next = reassignAwayMember(corrupt(), "member-41", "ship-1");
    expect(slotsOf(next, "ship-1")[0].security).toEqual(["member-41", null, null]);
    assertSlotInvariants(next);
    const moved = reassignAwayMember(corrupt(), "member-31", "ship-1");
    expect(slotsOf(moved, "ship-2")[0].security).toEqual([null, null, null]);
    expect(slotsOf(moved, "ship-1")[0].security).toEqual(["member-31", null, null]);
    assertSlotInvariants(moved);
  });

  it("the unslot sync (fire / reassign away) also clears the ship's corrupt ids", () => {
    const fired = fireAwayMember(corrupt(), "member-11");
    expect(slotsOf(fired, "ship-1")[0]).toEqual(emptyFreighterTeam());
    assertSlotInvariants(fired);
  });

  it("the player actions write cleaned teams (slot, unslot, swap, rename, help)", () => {
    const s = corrupt({
      awayMembers: [...corrupt().awayMembers, named("member-1", "security", "ship-1"), named("member-2", "security", "ship-1")],
    });
    const slotted = slotMember(s, "ship-1", 0, "security", 2, "member-1");
    expect(slotsOf(slotted, "ship-1")[0].security).toEqual([null, null, "member-1"]);
    assertSlotInvariants(slotted);
    const dirty: GameState = {
      ...slotted,
      ships: [
        {
          ...slotted.ships[0],
          groundTeams: [{ kind: "ground", security: ["member-404", "member-2", "member-1"], science: [null, null, null], helpOthers: false }, emptyFreighterTeam()],
        },
        slotted.ships[1],
      ],
    };
    const unslotted = unslotMember(dirty, "ship-1", "member-1");
    expect(slotsOf(unslotted, "ship-1")[0].security).toEqual([null, "member-2", null]);
    assertSlotInvariants(unslotted);
    const swapped = swapGroundMembers(slotted, "ship-1", "member-1", "member-2");
    expect(slotsOf(swapped, "ship-1")[0].security).toEqual([null, null, "member-2"]);
    assertSlotInvariants(swapped);
    for (const next of [renameGroundTeam(s, "ship-1", 0, "Red"), setGroundTeamHelp(s, "ship-1", 0, true)]) {
      expect(slotsOf(next, "ship-1")[0].security).toEqual([null, null, null]);
      expect(slotsOf(next, "ship-1")[0].science).toEqual(["member-11", null, null]);
      assertSlotInvariants(next);
    }
  });

  it("a ship whose slots are all valid keeps them exactly (and the no-op primitives keep the SAME ships)", () => {
    const s = crewState();
    const next = slotMember(s, "ship-1", 0, "security", 2, "member-3");
    expect(slotsOf(next, "ship-1")[0].security).toEqual(["member-1", "member-2", "member-3"]);
    expect(slotsOf(next, "ship-1")[0].science).toEqual(["member-11", null, null]);
    const ships = next.ships;
    // member-1 is already slotted there: the primitive keeps the SAME ships
    expect(shipsWithMemberAutoSlotted(ships, "ship-1", "member-1", "security", next.awayMembers)).toBe(ships);
    // SQ-1: with Alpha's Security squad full, a new arrival lands in Bravo's first slot (team 0 first, then 1)
    const into = shipsWithMemberAutoSlotted(ships, "ship-1", "member-9", "security", next.awayMembers);
    expect(shipGroundTeams(into[0]).map((t) => t.security)).toEqual([["member-1", "member-2", "member-3"], ["member-9", null, null]]);
  });
});

describe("GO-3 (GO-2 review b): renameGroundTeam matches the default case-insensitively, cuts by code point", () => {
  it("the team's own default name in any case clears the custom name", () => {
    const named1 = renameGroundTeam(crewState(), "ship-1", 0, "Red Squad");
    for (const clear of ["ALPHA", "alpha", " aLpHa "]) {
      const next = renameGroundTeam(named1, "ship-1", 0, clear);
      expect("name" in next.ships[0].groundTeams![0], clear).toBe(false);
      expect(groundTeamName(next.ships[0], 0)).toBe("Alpha");
    }
    const s = crewState();
    expect(renameGroundTeam(s, "ship-1", 0, "alpha")).toBe(s);
    // another team's default is a custom name here
    expect(slotsOf(renameGroundTeam(s, "ship-1", 0, "bravo"), "ship-1")[0].name).toBe("bravo");
  });

  it("cuts to GROUND_TEAM_NAME_MAX code points, never splitting a surrogate pair", () => {
    const rocket = "\u{1F680}";
    const rockets = renameGroundTeam(crewState(), "ship-1", 0, rocket.repeat(30));
    const name = slotsOf(rockets, "ship-1")[0].name as string;
    expect(Array.from(name)).toHaveLength(GROUND_TEAM_NAME_MAX);
    expect(name).toBe(rocket.repeat(GROUND_TEAM_NAME_MAX));
    const mixed = slotsOf(renameGroundTeam(crewState(), "ship-1", 0, "x".repeat(23) + rocket + rocket), "ship-1")[0].name as string;
    expect(mixed).toBe("x".repeat(23) + rocket);
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(mixed)).toBe(false); // no lone high surrogate
  });
});

describe("GO-3 review: the gates read the CLEANED slots", () => {
  // ship-1: member-3 (Security, reserve) sits ONLY in a Science slot (a corrupt wrong-squad slot).
  const wrongSquad = (): GameState => {
    const base = crewState({ awayMembers: [...crewState().awayMembers, named("member-4", "security", "ship-1")] });
    return {
      ...base,
      ships: [
        { ...base.ships[0], groundTeams: [{ kind: "ground", security: ["member-1", "member-2", null], science: ["member-11", "member-3", null], helpOthers: false }, emptyFreighterTeam()] },
        base.ships[1],
      ],
    };
  };

  it("unslotting a member held only in a corrupt slot is a notSlotted refusal (SAME state, no throw)", () => {
    const s = wrongSquad();
    expect(canUnslotMember(s, "ship-1", "member-3")).toEqual({ ok: false, reason: "notSlotted" });
    expect(unslotMember(s, "ship-1", "member-3")).toBe(s);
  });

  it("swapping two members held only in corrupt slots / the reserve is a notSlotted refusal (SAME state)", () => {
    const s = wrongSquad();
    expect(canSwapGroundMembers(s, "ship-1", "member-3", "member-4")).toEqual({ ok: false, reason: "notSlotted" });
    expect(swapGroundMembers(s, "ship-1", "member-3", "member-4")).toBe(s);
  });

  it("slotting into a slot that holds a corrupt duplicate of the same member succeeds", () => {
    const base = crewState();
    const s: GameState = {
      ...base,
      ships: [
        { ...base.ships[0], groundTeams: [{ kind: "ground", security: ["member-1", "member-2", "member-1"], science: ["member-11", null, null], helpOthers: false }, emptyFreighterTeam()] },
        base.ships[1],
      ],
    };
    expect(canSlotMember(s, "ship-1", 0, "security", 2, "member-1")).toEqual({ ok: true });
    const next = slotMember(s, "ship-1", 0, "security", 2, "member-1");
    expect(slotsOf(next, "ship-1")[0].security).toEqual([null, "member-2", "member-1"]);
    assertSlotInvariants(next);
    // the member's valid (first) slot still reads alreadyThere
    expect(canSlotMember(s, "ship-1", 0, "security", 0, "member-1")).toEqual({ ok: false, reason: "alreadyThere" });
  });
});

// ============================================================================
// Squads SQ-2: team type change, per-squad deploy check
// ============================================================================

describe("SQ-2 setGroundTeamKind (design 2.6: kept members stay put, dropped squads go to the reserve, the new squad auto-fills)", () => {
  // ship-1 (General Freighter, 3 / 3): Alpha Ground with member-1, member-2 Security and member-11 Science;
  // member-3 (Security) and member-12, member-13 (Science) in the reserve; Bravo Ground, empty.
  const kindState = (): GameState =>
    crewState({
      awayMembers: [
        ...crewState().awayMembers,
        named("member-13", "science", "ship-1", "Vela"),
        named("member-12", "science", "ship-1", "Sho"),
      ],
    });

  it("Ground -> Strike: Security squad 1 stays in place, the new squad 2 fills from the Security reserve, Science goes to the reserve", () => {
    const s = kindState();
    expect(previewGroundTeamKind(s, "ship-1", 0, "strike")).toEqual({ ok: true, toReserve: ["member-11"], fromReserve: ["member-3"] });
    const next = setGroundTeamKind(s, "ship-1", 0, "strike");
    expect(slotsOf(next, "ship-1")[0]).toEqual({
      kind: "strike",
      security: ["member-1", "member-2", null, "member-3", null, null],
      science: [],
      helpOthers: false,
    });
    expect(slotsOf(next, "ship-1")[1]).toEqual(emptyFreighterTeam()); // Bravo untouched
    expect(next.awayMembers).toBe(s.awayMembers); // nobody leaves the ship
    assertSlotInvariants(next);
  });

  it("Ground -> Survey on Bravo (empty): the new Science squad fills from the reserve in HIRE order", () => {
    const s = kindState();
    const next = setGroundTeamKind(s, "ship-1", 1, "survey");
    expect(slotsOf(next, "ship-1")[1]).toEqual({ kind: "survey", security: [], science: [null, null, null, "member-12", "member-13", null], helpOthers: false });
    expect(previewGroundTeamKind(s, "ship-1", 1, "survey")).toEqual({ ok: true, toReserve: [], fromReserve: ["member-12", "member-13"] });
    assertSlotInvariants(next);
  });

  it("Strike -> Ground: squad 2 drops to the reserve, the new Science squad fills (name and help kept)", () => {
    let s = setGroundTeamKind(kindState(), "ship-1", 0, "strike");
    s = renameGroundTeam(setGroundTeamHelp(s, "ship-1", 0, true), "ship-1", 0, "Red");
    const next = setGroundTeamKind(s, "ship-1", 0, "ground");
    expect(slotsOf(next, "ship-1")[0]).toEqual({
      name: "Red",
      kind: "ground",
      security: ["member-1", "member-2", null],
      science: ["member-11", "member-12", "member-13"],
      helpOthers: true,
    });
    expect(previewGroundTeamKind(s, "ship-1", 0, "ground")).toEqual({
      ok: true, toReserve: ["member-3"], fromReserve: ["member-11", "member-12", "member-13"],
    });
    assertSlotInvariants(next);
  });

  it("refuses with a reason, in order, and returns the SAME state", () => {
    const s = kindState();
    const strikeAlpha = setGroundTeamKind(s, "ship-1", 0, "strike");
    const surveyAlpha = setGroundTeamKind(s, "ship-1", 0, "survey");
    const cases: [GameState, number, string, string][] = [
      [s, 0, "strike", "noShip"], // asked of ship-x below
      [locked(s), 0, "strike", "onMission"],
      [s, 2, "strike", "noSuchTeam"],
      [s, -1, "strike", "noSuchTeam"],
      [s, 0, "elite", "noSuchKind"],
      [s, 0, "ground", "sameKind"],
      [strikeAlpha, 1, "strike", "needsBothTypes"], // Strike + Strike: no Science squad
      [surveyAlpha, 1, "survey", "needsBothTypes"], // Survey + Survey: no Security squad
    ];
    for (const [state, team, kind, reason] of cases) {
      const shipId = reason === "noShip" ? "ship-x" : "ship-1";
      const k = kind as GroundTeamKind;
      expect(canSetGroundTeamKind(state, shipId, team, k), reason).toEqual({ ok: false, reason });
      expect(previewGroundTeamKind(state, shipId, team, k), reason).toEqual({ ok: false, reason });
      expect(setGroundTeamKind(state, shipId, team, k), reason).toBe(state);
    }
    expect(groundSlotBlockText("needsBothTypes")).toBe("A ship needs at least one Security squad and one Science squad");
    // Strike + Survey keeps one of each: allowed
    expect(canSetGroundTeamKind(strikeAlpha, "ship-1", 1, "survey")).toEqual({ ok: true });
  });

  it("clears kindPending: confirming the pending pair's own type is not a no-op, a second confirm is", () => {
    const base = kindState();
    const s: GameState = {
      ...base,
      ships: base.ships.map((sh) => (sh.id === "ship-1" ? { ...sh, groundTeams: [sh.groundTeams![0], { ...emptyFreighterTeam(), kindPending: true }] } : sh)),
    };
    const kept = setGroundTeamKind(s, "ship-1", 1, "ground"); // "Keep Ground"
    expect(kept).not.toBe(s);
    expect(slotsOf(kept, "ship-1")[1]).toEqual(emptyFreighterTeam());
    expect("kindPending" in kept.ships[0].groundTeams![1]).toBe(false);
    expect(setGroundTeamKind(kept, "ship-1", 1, "ground")).toBe(kept);
    const strike = setGroundTeamKind(s, "ship-1", 1, "strike");
    expect(slotsOf(strike, "ship-1")[1].kindPending).toBeUndefined();
    expect(slotsOf(strike, "ship-1")[1].security).toEqual([null, null, null, "member-3", null, null]);
  });

  it("over capacity is allowed (nobody is forced off); only hiring that type is refused", () => {
    // 9 Security aboard (6 slotted + 3 in the berths) and Alpha's Science; Bravo turns Survey: 3 Security slots
    const extra = ["member-4", "member-5", "member-6", "member-7", "member-8", "member-9"].map((id) => named(id, "security", "ship-1"));
    let s = crewState({ awayMembers: [...crewState().awayMembers, ...extra] });
    s = slotMember(s, "ship-1", 0, "security", 2, "member-3");
    s = slotMember(s, "ship-1", 1, "security", 0, "member-4");
    s = slotMember(s, "ship-1", 1, "security", 1, "member-5");
    s = slotMember(s, "ship-1", 1, "security", 2, "member-6");
    const next = setGroundTeamKind(s, "ship-1", 1, "survey");
    expect(next).not.toBe(s);
    expect(next.awayMembers).toBe(s.awayMembers);
    expect(previewGroundTeamKind(s, "ship-1", 1, "survey")).toEqual({ ok: true, toReserve: ["member-4", "member-5", "member-6"], fromReserve: [] });
    const sec = awayRecruitCandidates(next).find((c) => c.teamType === "security")!;
    expect(canHireAwayMember(next, sec.id, "ship-1")).toEqual({ ok: false, reason: "overCapacity" });
    const sci = awayRecruitCandidates(next).find((c) => c.teamType === "science")!;
    expect(canHireAwayMember(next, sci.id, "ship-1")).toEqual({ ok: true }); // 8 empty Science slots
    assertSlotInvariants(next);
  });

  it("works on a ship minted without groundTeams, and never mutates its input", () => {
    const s = crewState();
    const before = JSON.stringify(s);
    const next = setGroundTeamKind(s, "ship-2", 0, "strike");
    expect(slotsOf(next, "ship-2")[0].security).toEqual([null, null, null, "member-31", null, null]);
    setGroundTeamKind(s, "ship-1", 0, "strike");
    expect(JSON.stringify(s)).toBe(before);
    assertSlotInvariants(next);
  });

  it("hire and reassign auto-slot into the new squads (lowest team first)", () => {
    const strike = setGroundTeamKind(crewState(), "ship-2", 0, "strike"); // ship-2: Strike + Ground, member-31 in Alpha
    const moved = reassignAwayMember(strike, "member-41", "ship-2");
    expect(slotsOf(moved, "ship-2")[0].security).toEqual(["member-41", null, null, "member-31", null, null]);
    assertSlotInvariants(moved);
  });
});

describe("SQ-2 deployableGroundTeams per squad (no stand-ins; D18 across the deploying teams)", () => {
  const NOW = 10_000;
  const at = (state: GameState): GameState => ({ ...state, gameTimeSeconds: NOW });
  // ship-7 on a 1 / 1 synthetic hull with 2 teams of the given kinds, slotted as listed.
  const pairState = (teams: ShipGroundTeam[], members: AwayMember[]): GameState => {
    cleanup = registerSyntheticHull("syntheticSquadPair" as ShipTypeKey, [
      { teamType: "security", size: 1, count: 1 },
      { teamType: "science", size: 1, count: 1 },
    ], 4);
    return at({
      ...freshState(),
      ships: [{ id: "ship-7", typeKey: "syntheticSquadPair" as ShipTypeKey, assignedCaptainId: null, groundTeams: teams }],
      awayMembers: members,
    });
  };
  const sec = (id: string) => named(id, "security", "ship-7");
  const sci = (id: string) => named(id, "science", "ship-7");
  const strike = (a: string | null, b: string | null): ShipGroundTeam => ({ kind: "strike", security: [a, b], science: [], helpOthers: false });
  const survey = (a: string | null, b: string | null): ShipGroundTeam => ({ kind: "survey", security: [], science: [a, b], helpOthers: false });
  const ground = (a: string | null, b: string | null): ShipGroundTeam => ({ kind: "ground", security: [a], science: [b], helpOthers: false });
  const injure = (state: GameState, id: string, until: number): GameState => ({
    ...state,
    awayMembers: state.awayMembers.map((m) => (m.id === id ? { ...m, injuredUntilSeconds: until } : m)),
  });
  const fullStrikeSurvey = (): GameState =>
    pairState([strike("member-1", "member-2"), survey("member-3", "member-4")], [sec("member-1"), sec("member-2"), sci("member-3"), sci("member-4")]);

  it("Strike + Survey, both full: each team deploys and the ship meets D18 across them", () => {
    const check = deployableGroundTeams(fullStrikeSurvey(), "ship-7");
    expect(check.ok).toBe(true);
    expect([check.security, check.science]).toEqual([2, 2]);
    const [a, b] = check.teams;
    expect(a.kind).toBe("strike");
    expect(a.squads.map((q) => [q.index, q.teamType, q.members.map((m) => m.id)])).toEqual([
      [0, "security", ["member-1"]],
      [1, "security", ["member-2"]],
    ]);
    expect(b.squads.map((q) => [q.index, q.teamType, q.members.map((m) => m.id)])).toEqual([
      [0, "science", ["member-3"]],
      [1, "science", ["member-4"]],
    ]);
    expect(a.deploys && b.deploys).toBe(true);
  });

  it("a Strike team with its second squad empty does not deploy and says which squad", () => {
    const s = pairState([strike("member-1", null), ground("member-2", "member-3")], [sec("member-1"), sec("member-2"), sci("member-3")]);
    const check = deployableGroundTeams(s, "ship-7");
    const [a, b] = check.teams;
    expect(a.deploys).toBe(false);
    expect(a.waits).toEqual([{ kind: "emptySquad", squadIndex: 1, teamType: "security", typeSquadIndex: 1, typeSquads: 2 }]);
    expect(groundTeamWaitText(a.waits[0])).toBe("Security squad 2 needs a member in a slot");
    expect(a.readyAtSeconds).toBeNull();
    // Bravo (Ground) deploys alone and meets D18, so the ship launches without Alpha
    expect(b.deploys).toBe(true);
    expect(check.ok).toBe(true);
    expect([check.security, check.science]).toEqual([1, 1]);
  });

  it("a ready Strike team alone cannot launch: missingType Science, and the wait names when Science is back", () => {
    const s = injure(fullStrikeSurvey(), "member-4", NOW + 600);
    const check = deployableGroundTeams(s, "ship-7");
    expect(check.ok).toBe(false);
    expect(check.reason).toBe("missingType");
    expect(check.missingType).toBe("science");
    expect([check.security, check.science]).toEqual([2, 0]);
    expect(check.readyAtSeconds).toBe(NOW + 600);
    expect(groundDeployBlockText(check, NOW)).toBe("Nothing ready covers Science: ready in 10m");
    // no stand-in: a ready Science member in the reserve does not help
    const reserve: GameState = { ...s, awayMembers: [...s.awayMembers, sci("member-5")] };
    expect(deployableGroundTeams(reserve, "ship-7").ok).toBe(false);
    // the Survey team's second squad emptied: no wait gets there
    const empty: GameState = { ...s, ships: s.ships.map((sh) => ({ ...sh, groundTeams: [strike("member-1", "member-2"), survey("member-3", null)] })) };
    const blocked = deployableGroundTeams(empty, "ship-7");
    expect(blocked.reason).toBe("missingType");
    expect(blocked.readyAtSeconds).toBeNull();
    expect(groundDeployBlockText(blocked, NOW)).toBe("Nothing ready covers Science: a team with a Science squad must deploy too");
  });

  it("missingType Security mirrors it (the Survey team ready, the Strike team waiting)", () => {
    const check = deployableGroundTeams(injure(fullStrikeSurvey(), "member-2", NOW + 30), "ship-7");
    expect([check.reason, check.missingType, check.readyAtSeconds]).toEqual(["missingType", "security", NOW + 30]);
  });

  it("noTeamReady waits for the first time the ready teams cover BOTH types, not just the first team back", () => {
    const s = injure(injure(fullStrikeSurvey(), "member-1", NOW + 60), "member-3", NOW + 900);
    const check = deployableGroundTeams(s, "ship-7");
    expect(check.reason).toBe("noTeamReady");
    // the Strike team is back in 1m but launches nothing alone; the Survey team in 15m completes D18
    expect(check.readyAtSeconds).toBe(NOW + 900);
    expect(groundDeployBlockText(check, NOW)).toBe("No ground team is ready: the first is ready in 15m");
  });

  it("an injured member in any squad holds the whole team (no stand-ins)", () => {
    const s = injure(
      pairState([ground("member-1", "member-2"), strike("member-3", "member-4")], [sec("member-1"), sci("member-2"), sec("member-3"), sec("member-4")]),
      "member-4",
      NOW + 5,
    );
    const check = deployableGroundTeams(s, "ship-7");
    expect(check.teams[1].deploys).toBe(false);
    expect(check.teams[1].waits.map((w) => w.kind)).toEqual(["injured"]);
    expect(check.ok).toBe(true); // Alpha (Ground) alone meets D18
    expect([check.security, check.science]).toEqual([1, 1]);
  });
});
