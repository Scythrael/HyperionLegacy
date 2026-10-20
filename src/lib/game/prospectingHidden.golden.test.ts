// Prospecting squads (0.14.0, built HIDDEN; design docs/plans/2026-10-16-prospecting-squads-design.md section 10
// tests 1, 6, 7, 8 and 9): golden hashes captured on the code BEFORE any Prospecting edit (the CP-0 / FK-3 / SF-0
// pattern). While the per-save unlock flag is unset, nothing a player can see may move: the recruit board, the
// Quartermaster rows, the team compositions and crew caps of every hull, a fresh save, the Security and Science
// specs and trait pools, the "worn by" line of every Security or Science piece, and a Security and a Science
// member's roster snapshot. Re-pin one ONLY in a commit that names the move and why.

import { describe, expect, it } from "vitest";
import {
  EQUIPMENT_SLOTS,
  MEMBER_SLOT_TYPES,
  SHIP_TYPES,
  freshState,
  type AwayMember,
  type EquipmentInstance,
  type GameState,
  type MemberSlotType,
  type ShipTypeKey,
} from "./model";
import { awayRecruitCandidates, snapshotMember, specsFor } from "./awayTeam";
import { awayTraitsForTeam } from "./awayTraits";
import { REQUISITION_ENTRIES } from "./quartermaster";
import { shipCrewCapacity, shipReserveBerths, validCompositions } from "./groundComposition";
import { emptyGroundTeams } from "./groundTeams";
import { memberWearersText } from "../awayGearDisplay";
import { hash, withV1Museum } from "./firstRunsGoldens.fixture";

// Captured at 5f9342a (feat/crew-0.14.0's tip), before any Prospecting edit.
const PINS: Readonly<Record<string, string>> = {
  board: "6d57605d",
  requisition: "5420862c",
  compositions: "cab1e00d",
  freshState: "4b350e4b",
  specs: "eed66c56",
  traits: "1cf84bcf",
  wearers: "aed78fbc",
  snapshot: "d02149ce",
};

function pin(name: string, value: unknown): void {
  expect(PINS[name], `no pin named ${name}`).toBeDefined();
  expect(hash(value), name).toBe(PINS[name]);
}

const SEEDS = [freshState().awayRecruitSeed, 1, 2, 0xdeadbeef, 12345];
const WINDOWS = Array.from({ length: 20 }, (_, i) => i);
const SIZES = [10, 14];
const HULLS = Object.keys(SHIP_TYPES) as ShipTypeKey[];

function boardState(seed: number, window: number, size: number): GameState {
  return { ...freshState(), awayRecruitSeed: seed, gameTimeSeconds: window * 3600 + 17, seniorStaffRosterSize: size };
}

function piece(id: string, slotType: MemberSlotType, variety: string, wearer: string, lines: Record<string, number>): EquipmentInstance {
  return {
    id,
    slotType,
    moduleVariant: variety,
    rarity: "standard",
    ascension: "none",
    quality: 0,
    iLevel: 10,
    blueprintKey: "bp-test",
    implicitStats: { ...lines },
    rolledStats: {},
    mass: 0,
    powerDraw: 0,
    durabilityMax: 100,
    durability: 100,
    fittedToShipId: null,
    fittedToMemberId: wearer,
  };
}

function member(id: string, teamType: "security" | "science", traits: string[]): AwayMember {
  return {
    id,
    teamType,
    spec: teamType === "science" ? "geology" : "offense",
    name: `Member ${id}`,
    race: "ossir",
    gender: "female",
    rank: 4,
    traits,
    assignedShipId: "ship-1",
  };
}

describe("Prospecting hidden: nothing a player can see moves while the unlock flag is unset", () => {
  it("the recruit board over five seeds, twenty windows and two board sizes", () => {
    const boards = SEEDS.flatMap((seed) => WINDOWS.flatMap((w) => SIZES.map((size) => awayRecruitCandidates(boardState(seed, w, size)))));
    expect(boards.flat().every((c) => c.teamType === "security" || c.teamType === "science")).toBe(true);
    pin("board", boards);
  });

  it("the Quartermaster rows", () => {
    pin("requisition", REQUISITION_ENTRIES);
  });

  it("every hull's valid compositions, crew capacity per composition, reserve berths and empty teams", () => {
    pin(
      "compositions",
      HULLS.map((h) => ({
        h,
        comps: validCompositions(h).map((c) => ({ c, cap: shipCrewCapacity(h, c) })),
        berths: shipReserveBerths(h),
        teams: emptyGroundTeams(h),
      })),
    );
  });

  it("a fresh save", () => {
    pin("freshState", withV1Museum(freshState())); // R2-1: the museum in its v1 form, as captured
  });

  it("the Security and Science specs and trait pools", () => {
    pin("specs", { security: specsFor("security"), science: specsFor("science") });
    // What a roll and the trait text read (id, name, flavor, effects). Steady's teamTypes gains Prospecting by
    // design (section 4), which leaves the Science pool, and so every Science roll, unchanged.
    const pool = (t: "security" | "science") => awayTraitsForTeam(t).map(({ id, label, description, effects }) => ({ id, label, description, effects }));
    pin("traits", { security: pool("security"), science: pool("science") });
  });

  it("the worn-by line of every Security or Science piece", () => {
    const lines: string[] = [];
    for (const slotType of MEMBER_SLOT_TYPES) {
      for (const v of EQUIPMENT_SLOTS[slotType].varieties) {
        const teams = v.member?.teamTypes ?? [];
        if (!teams.includes("security") && !teams.includes("science")) continue;
        lines.push(`${slotType}:${v.key}:${memberWearersText({ slotType, moduleVariant: v.key })}`);
      }
    }
    pin("wearers", lines);
  });

  it("a Security and a Science member's roster snapshot (gear on every line, traits)", () => {
    const sec = member("member-1", "security", ["steadyAim", "fieldMedic", "ironWill"]);
    const sci = member("member-2", "science", ["steady", "deepSurvey", "keenEye"]);
    const secWorn = [
      piece("equip-1", "memberWeapon", "pulseRifle", sec.id, { groundPower: 12, groundAccuracy: 9 }),
      piece("equip-2", "memberArmor", "assaultHardsuit", sec.id, { groundArmor: 8, groundHp: 7, groundHazardResist: 3 }),
      piece("equip-3", "memberTool", "medKit", sec.id, { groundHp: 10 }),
      piece("equip-4", "implant", "toxinFilters", sec.id, { groundStatusResist: 6 }),
    ];
    const sciWorn = [
      piece("equip-5", "memberWeapon", "sidearm", sci.id, { groundPower: 4 }),
      piece("equip-6", "memberArmor", "hazardSuit", sci.id, { groundHazardResist: 11 }),
      piece("equip-7", "memberTool", "coreDrill", sci.id, { groundFieldwork: 9, groundRelicFind: 5 }),
      piece("equip-8", "implant", "environmentalAdaptation", sci.id, { groundHazardResist: 7, groundFieldwork: 2 }),
    ];
    pin("snapshot", [snapshotMember(sec, secWorn), snapshotMember(sci, sciWorn)]);
  });
});
