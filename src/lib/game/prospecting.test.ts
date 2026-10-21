// Prospecting squads (0.14.0, built HIDDEN): design docs/plans/2026-10-16-prospecting-squads-design.md section 10.
// The locked half (nothing a player sees moves) is pinned by prospectingHidden.golden.test.ts; this file proves the
// build itself works once the per-save flag is set, and that every hidden gate refuses while it is not. QA access is
// TESTS ONLY (user 2026-10-16): there is no Debug toggle.

import { describe, expect, it } from "vitest";
import {
  EQUIPMENT_SLOTS,
  MEMBER_SLOT_TYPES,
  SHIP_TYPES,
  freshState,
  memberVariety,
  type AwayMember,
  type EquipmentInstance,
  type GameState,
  type GroundTeamKind,
  type MemberSlotType,
  type ShipGroundTeam,
  type ShipTypeKey,
} from "./model";
import {
  GEAR_POINT_BUMP,
  awayRecruitCandidates,
  canHireAwayMember,
  hireAwayMember,
  shipCrewRoom,
  shipSquadSlots,
  snapshotAwayRoster,
  snapshotMember,
  specsFor,
} from "./awayTeam";
import { awayTraitsForTeam, getAwayTrait, traitDisplayText, AWAY_TRAITS } from "./awayTraits";
import {
  ALL_GROUND_TEAM_KINDS,
  GROUND_TEAM_KINDS,
  compositionLabel,
  compositionSquads,
  isValidComposition,
  shipCrewCapacity,
  teamKindName,
  validCompositions,
} from "./groundComposition";
import {
  applyComposition,
  canSetGroundTeamKind,
  groundSlotBlockText,
  isWellFormedShipGroundTeams,
  planComposition,
  setGroundTeamKind,
  shipGroundTeams,
  slotMember,
  unslotMember,
} from "./groundTeams";
import { pieceWearableBy } from "./memberEquipment";
import { REQUISITION_ENTRIES, canRequisition, requisitionEntriesFor, requisitionStandardIssue } from "./quartermaster";
import { diminishing } from "./diminishing";
import {
  DIG_SAFETY_KNEE,
  PROSPECTING_BLUEPRINTS,
  PROSPECTING_BOARD_SLOTS,
  PROSPECTING_SPEC_BASE,
  PROSPECTING_USES,
  prospectingCrewStats,
  squadTypeUnlocked,
  unlockProspectingSquads,
} from "./prospecting";
import { SAVE_VERSION, deserialize, migrate, serialize } from "./save";
import { memberWearersText } from "../awayGearDisplay";
import { WIRING_REGISTRY } from "./wiring/registry";
import { rankMagnitudeFactor } from "./crewRank";

const locked = (): GameState => freshState();
const unlocked = (): GameState => unlockProspectingSquads(freshState());

function member(id: string, teamType: AwayMember["teamType"], extra: Partial<AwayMember> = {}): AwayMember {
  return {
    id,
    teamType,
    spec: teamType === "prospecting" ? "excavation" : teamType === "science" ? "geology" : "offense",
    name: `Member ${id}`,
    race: "earthBorn",
    gender: "female",
    rank: 1,
    traits: [],
    assignedShipId: "ship-1",
    ...extra,
  };
}

function piece(id: string, slotType: MemberSlotType, variety: string, wearer: string | null, lines: Record<string, number>): EquipmentInstance {
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
    fittedToShipId: null,
    fittedToMemberId: wearer,
  };
}

// The prospecting-only varieties (the eight the squad wears alone; the Hazard Suit and Environmental Adaptation are shared).
const PROSPECTING_ONLY = MEMBER_SLOT_TYPES.flatMap((slotType) =>
  EQUIPMENT_SLOTS[slotType].varieties
    .filter((v) => v.member?.teamTypes.length === 1 && v.member.teamTypes[0] === "prospecting")
    .map((v) => ({ slotType, key: v.key })),
);

describe("the unlock (design section 8)", () => {
  it("is absent on a fresh save (locked); Security and Science are always unlocked", () => {
    const s = locked();
    expect(s.prospectingSquadsUnlocked).toBeUndefined();
    expect(squadTypeUnlocked(s, "prospecting")).toBe(false);
    expect(squadTypeUnlocked(s, "security")).toBe(true);
    expect(squadTypeUnlocked(s, "science")).toBe(true);
  });

  it("unlockProspectingSquads sets the per-save flag and is idempotent (same ref)", () => {
    const u = unlocked();
    expect(u.prospectingSquadsUnlocked).toBe(true);
    expect(squadTypeUnlocked(u, "prospecting")).toBe(true);
    expect(unlockProspectingSquads(u)).toBe(u);
  });
});

describe("specs and traits (design sections 2 and 4)", () => {
  it("three roles in a fixed order, each lifting what the user named", () => {
    expect(specsFor("prospecting")).toEqual(["excavation", "drilling", "assaying"]);
    expect(PROSPECTING_SPEC_BASE.excavation).toEqual({ oreYield: 0.15, fieldwork: 0, hazardResist: 0, oreGrade: 0 });
    expect(PROSPECTING_SPEC_BASE.drilling).toEqual({ oreYield: 0, fieldwork: 0.1, hazardResist: 0.1, oreGrade: 0 });
    expect(PROSPECTING_SPEC_BASE.assaying).toEqual({ oreYield: 0, fieldwork: 0, hazardResist: 0, oreGrade: 0.1 });
  });

  it("trait ids stay unique; Steady rolls for Science AND Prospecting; the five new traits are Prospecting-only", () => {
    const ids = AWAY_TRAITS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(awayTraitsForTeam("science").map((t) => t.id)).toContain("steady");
    expect(awayTraitsForTeam("prospecting").map((t) => t.id)).toContain("steady");
    for (const id of ["strongBack", "assayersEye", "tireless", "rockhound", "deepVein"]) {
      expect(getAwayTrait(id)?.teamTypes).toEqual(["prospecting"]);
    }
  });

  it("trait text is generated from the effects (no hand-typed numbers in the flavor)", () => {
    expect(traitDisplayText(getAwayTrait("strongBack")!)).toBe("Hauls more out of every seam. +8% yield.");
    expect(traitDisplayText(getAwayTrait("assayersEye")!)).toBe("Knows good rock at a glance. +5% grade.");
    expect(traitDisplayText(getAwayTrait("deepVein")!)).toBe("Follows the ore underground. +10% yield at Cave Network and Geothermal Chamber.");
    for (const t of awayTraitsForTeam("prospecting")) expect(t.description).not.toMatch(/[0-9]/);
  });
});

describe("the recruit board's separate Prospecting slots (user: Separate board slots)", () => {
  const seeds = [freshState().awayRecruitSeed, 1, 2, 0xdeadbeef];

  it("locked: no Prospecting candidate on any board", () => {
    for (const seed of seeds) {
      for (let w = 0; w < 30; w += 1) {
        const board = awayRecruitCandidates({ ...locked(), awayRecruitSeed: seed, gameTimeSeconds: w * 3600 });
        expect(board.some((c) => c.teamType === "prospecting")).toBe(false);
      }
    }
  });

  it("unlocked: the shared slots are untouched and PROSPECTING_BOARD_SLOTS Prospecting candidates follow them", () => {
    for (const seed of seeds) {
      for (let w = 0; w < 30; w += 1) {
        const base = { awayRecruitSeed: seed, gameTimeSeconds: w * 3600 };
        const before = awayRecruitCandidates({ ...locked(), ...base });
        const after = awayRecruitCandidates({ ...unlocked(), ...base });
        expect(after.slice(0, before.length)).toEqual(before);
        const extra = after.slice(before.length);
        expect(extra).toHaveLength(PROSPECTING_BOARD_SLOTS);
        extra.forEach((c, k) => {
          expect(c.teamType).toBe("prospecting");
          expect(c.id).toBe(`away-candidate-p-${w}-${k}`);
          expect(specsFor("prospecting")).toContain(c.spec);
          const pool = awayTraitsForTeam("prospecting").map((t) => t.id);
          for (const t of c.traits) expect(pool).toContain(t);
          expect(new Set(c.traits).size).toBe(c.traits.length);
        });
      }
    }
  });

  it("every role appears over many rolls, and the board is deterministic", () => {
    const specs = new Set<string>();
    for (let w = 0; w < 200; w += 1) {
      for (const c of awayRecruitCandidates({ ...unlocked(), gameTimeSeconds: w * 3600 })) if (c.teamType === "prospecting") specs.add(c.spec);
    }
    expect([...specs].sort()).toEqual(["assaying", "drilling", "excavation"]);
    const s = { ...unlocked(), gameTimeSeconds: 12_345 };
    expect(awayRecruitCandidates(s)).toEqual(awayRecruitCandidates(s));
  });
});

describe("gear rules (design section 5)", () => {
  it("eight Prospecting-only varieties; none rolls a combat or relic line (D26)", () => {
    expect(PROSPECTING_ONLY.map((v) => v.key).sort()).toEqual(
      ["assayScanner", "excavatorSuit", "myoLiftFrame", "oreSenseOptic", "plasmaCutter", "rockBreaker", "samplingLance", "seismicMapper"],
    );
    const banned = new Set(["groundHp", "groundPower", "groundArmor", "groundAccuracy", "groundStatusChance", "groundStatusResist", "groundRelicFind"]);
    for (const { slotType, key } of PROSPECTING_ONLY) {
      const v = memberVariety(slotType, key)!;
      expect(v.implicitStats, key).toBeDefined();
      expect(v.affixPool, key).toBeDefined();
      for (const stat of [...v.implicitStats!, ...v.affixPool!.map((a) => a.stat), ...Object.keys(v.statRatios)]) expect(banned.has(stat), `${key} ${stat}`).toBe(false);
      expect(v.member.weaponRange, key).toBeUndefined(); // never fights
      expect(v.member.groundEffect, key).toBeUndefined();
    }
  });

  it("Security and Science cannot install a Prospecting-only piece and vice versa; the shared hazard pieces install on both", () => {
    for (const { slotType, key } of PROSPECTING_ONLY) {
      const p = { slotType, moduleVariant: key };
      expect(pieceWearableBy(p, "prospecting"), key).toBe(true);
      expect(pieceWearableBy(p, "security"), key).toBe(false);
      expect(pieceWearableBy(p, "science"), key).toBe(false);
    }
    expect(pieceWearableBy({ slotType: "memberWeapon", moduleVariant: "pulseRifle" }, "prospecting")).toBe(false);
    expect(pieceWearableBy({ slotType: "memberTool", moduleVariant: "coreDrill" }, "prospecting")).toBe(false);
    for (const [slotType, key] of [["memberArmor", "hazardSuit"], ["implant", "environmentalAdaptation"]] as const) {
      expect(pieceWearableBy({ slotType, moduleVariant: key }, "science")).toBe(true);
      expect(pieceWearableBy({ slotType, moduleVariant: key }, "prospecting")).toBe(true);
    }
  });

  it("the worn-by line names only unlocked squads", () => {
    const suit = { slotType: "memberArmor" as const, moduleVariant: "hazardSuit" };
    expect(memberWearersText(suit)).toBe("Science only");
    expect(memberWearersText(suit, locked())).toBe("Science only");
    expect(memberWearersText(suit, unlocked())).toBe("Science or Prospecting");
    const cutter = { slotType: "memberWeapon" as const, moduleVariant: "plasmaCutter" };
    expect(memberWearersText(cutter, locked())).toBe("");
    expect(memberWearersText(cutter, unlocked())).toBe("Prospecting only");
  });

  it("the hidden blueprints: one per Prospecting-only variety, tier 1 for the Standard-Issue three, existing materials, kept out of BLUEPRINTS", async () => {
    const { BLUEPRINTS, ITEMS } = await import("./model");
    const bps = Object.values(PROSPECTING_BLUEPRINTS);
    expect(bps.map((bp) => bp.equipmentOutput!.varietyKey).sort()).toEqual(PROSPECTING_ONLY.map((v) => v.key).sort());
    for (const bp of bps) {
      const v = PROSPECTING_ONLY.find((x) => x.key === bp.equipmentOutput!.varietyKey)!;
      expect(bp.key).toBe(`${v.key}Bp`);
      expect(bp.equipmentOutput!.slotType).toBe(v.slotType);
      expect(bp.key in BLUEPRINTS, bp.key).toBe(false);
      for (const itemId of Object.keys(bp.recipe.inputs)) expect(ITEMS[itemId], `${bp.key} ${itemId}`).toBeDefined();
      expect(bp.tier).toBe(["plasmaCutter", "excavatorSuit", "assayScanner"].includes(v.key) ? 1 : 2);
    }
  });
});

describe("the Quartermaster's Standard-Issue Prospecting rows (design section 5)", () => {
  it("locked: no Prospecting row anywhere and a Prospecting requisition refuses", () => {
    expect(REQUISITION_ENTRIES.some((e) => e.teamType === "prospecting")).toBe(false);
    expect(requisitionEntriesFor(locked())).toBe(REQUISITION_ENTRIES);
    for (const slot of ["memberWeapon", "memberArmor", "memberTool"] as const) {
      expect(canRequisition(locked(), slot, "prospecting")).toEqual({ ok: false, reason: "noBaselineForSlot" });
      expect(requisitionStandardIssue(locked(), slot, "prospecting").next).toEqual(locked());
    }
  });

  it("unlocked: Weapon, Armor and Tool rows naming the cutter, the work suit and the assay kit, by slot role", () => {
    const rows = requisitionEntriesFor(unlocked()).filter((e) => e.teamType === "prospecting");
    expect(rows.map((e) => [e.slotType, e.mint.kind === "member" ? e.mint.varietyKey : null])).toEqual([
      ["memberArmor", "excavatorSuit"],
      ["memberWeapon", "plasmaCutter"],
      ["memberTool", "assayScanner"],
    ]);
    expect(rows.map((e) => e.issuedName)).toEqual(["Standard-Issue Excavator Suit", "Standard-Issue Plasma Cutter", "Standard-Issue Assay Scanner"]);
    // Primary line first, FIELD second (the Standard-Issue stats decision: each piece's role lines are its signature).
    expect(memberVariety("memberWeapon", "plasmaCutter")!.implicitStats).toEqual(["groundOreYield", "groundFieldwork"]);
    expect(memberVariety("memberArmor", "excavatorSuit")!.implicitStats).toEqual(["groundHazardResist", "groundFieldwork"]);
    expect(memberVariety("memberTool", "assayScanner")!.implicitStats).toEqual(["groundOreGrade", "groundFieldwork"]);
  });

  it("unlocked: a requisition mints a Standard-Issue Plasma Cutter a Prospecting member can install", () => {
    const r = requisitionStandardIssue(unlocked(), "memberWeapon", "prospecting");
    expect(r.reason).toBeNull();
    expect(r.minted!.moduleVariant).toBe("plasmaCutter");
    expect(r.minted!.blueprintKey).toBeNull();
    expect(Object.keys(r.minted!.implicitStats)).toEqual(["groundOreYield", "groundFieldwork"]);
    expect(pieceWearableBy(r.minted!, "prospecting")).toBe(true);
    expect(canRequisition(r.next, "memberWeapon", "prospecting")).toEqual({ ok: false, reason: "alreadyHoldingOne" });
  });
});

describe("the roster snapshot (design section 3, the golden-neutral rule)", () => {
  it("a Prospecting member's YIELD and GRADE convert at GEAR_POINT_BUMP and stack with traits", () => {
    const m = member("member-1", "prospecting", { traits: ["strongBack", "assayersEye", "steady"] });
    const snap = snapshotMember(m, [
      piece("equip-1", "memberWeapon", "plasmaCutter", m.id, { groundOreYield: 10, groundFieldwork: 4 }),
      piece("equip-2", "memberTool", "assayScanner", m.id, { groundOreGrade: 6 }),
    ]);
    expect(snap.groundStats.oreYield).toBeCloseTo(10 * GEAR_POINT_BUMP.oreYield + 0.08, 12);
    expect(snap.groundStats.oreGrade).toBeCloseTo(6 * GEAR_POINT_BUMP.oreGrade + 0.05, 12);
    expect(snap.groundStats.fieldwork).toBeCloseTo(4 * GEAR_POINT_BUMP.fieldwork, 12);
    expect(snap.groundStats.hazardResist).toBeCloseTo(0.1, 12);
    expect(snap.gambit).toEqual([]); // never fights: no default program
  });

  it("a Security or Science snapshot never carries an oreYield or oreGrade key", () => {
    const sec = snapshotMember(member("member-2", "security"), [piece("equip-3", "memberWeapon", "pulseRifle", "member-2", { groundPower: 5 })]);
    const sci = snapshotMember(member("member-3", "science"), [piece("equip-4", "memberArmor", "hazardSuit", "member-3", { groundHazardResist: 5 })]);
    for (const snap of [sec, sci]) {
      expect("oreYield" in snap.groundStats).toBe(false);
      expect("oreGrade" in snap.groundStats).toBe(false);
    }
  });

  it("prospectingCrewStats: role base + gear + traits + site traits, rank-scaled; other squads skipped (the seam all three uses read)", () => {
    expect(PROSPECTING_USES).toEqual(["quest", "mineralSite", "miningMission"]);
    const digger = snapshotMember(member("member-1", "prospecting", { spec: "excavation", rank: 4, traits: ["rockhound"] }), [
      piece("equip-1", "memberWeapon", "plasmaCutter", "member-1", { groundOreYield: 10 }),
    ]);
    const guard = snapshotMember(member("member-2", "security"), []);
    const rf = rankMagnitudeFactor(4);
    const plain = prospectingCrewStats([digger, guard]);
    expect(plain.oreYield).toBeCloseTo((0.15 + 10 * GEAR_POINT_BUMP.oreYield) * rf, 12);
    const atOutcrop = prospectingCrewStats([digger, guard], "mineralOutcrop");
    expect(atOutcrop.oreYield).toBeCloseTo((0.15 + 10 * GEAR_POINT_BUMP.oreYield + 0.1) * rf, 12);
    expect(prospectingCrewStats([guard])).toEqual({ oreYield: 0, oreGrade: 0, fieldwork: 0, hazardResist: 0, digSafety: 0 });
  });

  it("dig safety (user 2026-10-19): a Prospecting wearer's Hazard Suit ARM and HP, rank-scaled, through the D23 curve, never capped", () => {
    const suited = (id: string, rank: AwayMember["rank"], armor: number, hp: number) =>
      snapshotMember(member(id, "prospecting", { rank }), [piece(`equip-${id}`, "memberArmor", "hazardSuit", id, { groundArmor: armor, groundHp: hp })]);
    const a = suited("member-1", 3, 8, 6);
    const raw = (8 * GEAR_POINT_BUMP.armor + 6 * GEAR_POINT_BUMP.hp) * rankMagnitudeFactor(3);
    expect(prospectingCrewStats([a]).digSafety).toBeCloseTo(diminishing(raw, DIG_SAFETY_KNEE), 12);
    // Below the raw sum (diminishing), more is always more, and there is no ceiling.
    expect(prospectingCrewStats([a]).digSafety).toBeLessThan(raw);
    let last = 0;
    for (const pts of [10, 100, 1000, 10000]) {
      const v = prospectingCrewStats([suited("member-9", 1, pts, pts)]).digSafety;
      expect(v).toBeGreaterThan(last);
      last = v;
    }
    expect(last).toBeGreaterThan(10);
    // A Security guard's armor never counts (they guard; they do not dig).
    const guard = snapshotMember(member("member-2", "security"), [piece("equip-g", "memberArmor", "assaultHardsuit", "member-2", { groundArmor: 50 })]);
    expect(prospectingCrewStats([guard]).digSafety).toBe(0);
    expect(prospectingCrewStats([a, guard]).digSafety).toBeCloseTo(prospectingCrewStats([a]).digSafety, 12);
  });
});

// ===== team slots and kinds (design section 6) =====

const FREIGHTER: ShipTypeKey = "generalFreighter";

function withTeams(s: GameState, teams: ShipGroundTeam[], members: AwayMember[] = []): GameState {
  return { ...s, ships: [{ ...s.ships[0], typeKey: FREIGHTER, groundTeams: teams }], awayMembers: members };
}

describe("team kinds: Claim and Dig (design section 6)", () => {
  it("the visible kind list is unchanged; Claim and Dig name 1 Security + 1 Prospecting and 2 Prospecting", () => {
    expect(GROUND_TEAM_KINDS).toEqual(["ground", "strike", "survey"]);
    expect(ALL_GROUND_TEAM_KINDS).toEqual(["ground", "strike", "survey", "claim", "dig"]);
    expect(compositionSquads(["claim"])).toEqual({ security: 1, science: 0, prospecting: 1 });
    expect(compositionSquads(["dig"])).toEqual({ security: 0, science: 0, prospecting: 2 });
    expect(compositionSquads(["ground", "strike"])).toEqual({ security: 3, science: 1 }); // no prospecting key
    expect(teamKindName("claim")).toBe("Claim");
    expect(teamKindName("dig")).toBe("Dig");
    expect(compositionLabel(["claim", "ground"])).toBe("Ground + Claim");
  });

  it("locked compositions are exactly today's; unlocked adds Ground + Claim, Ground + Dig, Survey + Claim only", () => {
    const key = (c: GroundTeamKind[]) => [...c].sort().join("+");
    for (const h of Object.keys(SHIP_TYPES) as ShipTypeKey[]) {
      const before = validCompositions(h);
      expect(before.every((c) => c.every((k) => GROUND_TEAM_KINDS.includes(k)))).toBe(true);
      const after = validCompositions(h, { prospecting: true }).map(key);
      const was = new Set(before.map(key));
      for (const k of was) expect(after).toContain(k);
      if (before.length === 0) continue;
      expect(after.filter((k) => !was.has(k)).sort()).toEqual(["claim+ground", "claim+survey", "dig+ground"]);
    }
    for (const bad of [["strike", "dig"], ["claim", "claim"], ["survey", "dig"]] as GroundTeamKind[][]) expect(isValidComposition(bad)).toBe(false);
  });

  it("crew capacity counts three types; a visible composition keeps its exact shape", () => {
    expect(shipCrewCapacity(FREIGHTER, ["ground", "claim"])).toEqual({ security: 6, science: 3, prospecting: 3, reserveBerths: 3, total: 15 });
    expect(shipCrewCapacity(FREIGHTER, ["ground", "dig"])).toEqual({ security: 3, science: 3, prospecting: 6, reserveBerths: 3, total: 15 });
    expect(shipCrewCapacity(FREIGHTER, ["ground", "ground"])).toEqual({ security: 6, science: 6, reserveBerths: 3, total: 15 });
  });

  it("locked: setGroundTeamKind, planComposition and applyComposition refuse Claim and Dig (kindLocked)", () => {
    const s = locked();
    for (const kind of ["claim", "dig"] as const) {
      expect(canSetGroundTeamKind(s, "ship-1", 1, kind)).toEqual({ ok: false, reason: "kindLocked" });
      expect(setGroundTeamKind(s, "ship-1", 1, kind)).toBe(s);
    }
    expect(planComposition(s, "ship-1", ["ground", "claim"])).toEqual({ ok: false, reason: "kindLocked" });
    expect(applyComposition(s, "ship-1", ["ground", "claim"])).toBe(s);
    expect(groundSlotBlockText("kindLocked")).toBe("Not available yet");
  });

  it("locked: a Prospecting hire refuses noSquad on a Ground + Ground ship", () => {
    const s = unlockProspectingSquads(locked());
    const c = awayRecruitCandidates(s).find((x) => x.teamType === "prospecting")!;
    expect(canHireAwayMember(s, c.id, "ship-1")).toEqual({ ok: false, reason: "noSquad" });
    expect(shipSquadSlots(s.ships[0], "prospecting")).toBe(0);
  });

  it("unlocked: Bravo becomes a Claim team, a Prospecting recruit hires into its Prospecting slot, and back to Ground drops them to the reserve", () => {
    const s0 = unlocked();
    const s1 = setGroundTeamKind(s0, "ship-1", 1, "claim");
    expect(s1).not.toBe(s0);
    const bravo = shipGroundTeams(s1.ships[0])[1];
    expect(bravo.kind).toBe("claim");
    expect(bravo.security).toHaveLength(3);
    expect(bravo.science).toHaveLength(0);
    expect(bravo.prospecting).toEqual([null, null, null]);
    expect(shipSquadSlots(s1.ships[0], "prospecting")).toBe(3);

    const c = awayRecruitCandidates(s1).find((x) => x.teamType === "prospecting")!;
    expect(canHireAwayMember(s1, c.id, "ship-1")).toEqual({ ok: true });
    const s2 = hireAwayMember(s1, c.id, "ship-1");
    const hired = s2.awayMembers[s2.awayMembers.length - 1];
    expect(hired.teamType).toBe("prospecting");
    expect(shipGroundTeams(s2.ships[0])[1].prospecting).toEqual([hired.id, null, null]);
    expect(awayRecruitCandidates(s2).some((x) => x.id === c.id)).toBe(false); // left the board
    expect(shipCrewRoom(s2, s2.ships[0]).aboard).toEqual({ security: 0, science: 0, prospecting: 1 });

    // Slot moves within the Prospecting squad, and unslot to the reserve.
    const moved = slotMember(s2, "ship-1", 1, "prospecting", 2, hired.id);
    expect(shipGroundTeams(moved.ships[0])[1].prospecting).toEqual([null, null, hired.id]);
    const benched = unslotMember(moved, "ship-1", hired.id);
    expect(shipGroundTeams(benched.ships[0])[1].prospecting).toEqual([null, null, null]);

    // Back to Ground: the Prospecting list goes away and the member waits in the reserve (still aboard).
    const s3 = setGroundTeamKind(s2, "ship-1", 1, "ground");
    const ground = shipGroundTeams(s3.ships[0])[1];
    expect("prospecting" in ground).toBe(false);
    expect(s3.awayMembers.find((m) => m.id === hired.id)!.assignedShipId).toBe("ship-1");
  });

  it("Prospecting slots never join an expedition crew (the roster snapshot reads Security and Science only)", () => {
    const s = withTeams(
      unlocked(),
      [
        { kind: "ground", security: ["member-1", null, null], science: ["member-2", null, null], helpOthers: false },
        { kind: "claim", security: [null, null, null], science: [], prospecting: ["member-3", null, null], helpOthers: false },
      ],
      [member("member-1", "security"), member("member-2", "science"), member("member-3", "prospecting")],
    );
    expect(Object.keys(snapshotAwayRoster(s, s.ships[0]))).toEqual(["security", "science"]);
  });
});

describe("save (design section 7): optional fields only, no bump", () => {
  it("SAVE_VERSION is unchanged (70) and a fresh save has no Prospecting field", () => {
    expect(SAVE_VERSION).toBe(70);
    expect("prospectingSquadsUnlocked" in freshState()).toBe(false);
  });

  it("a save holding the flag, a Prospecting member, its gear and a Claim team round-trips", () => {
    const s = withTeams(
      unlocked(),
      [
        { kind: "ground", security: [null, null, null], science: [null, null, null], helpOthers: false },
        { kind: "claim", security: [null, null, null], science: [], prospecting: ["member-3", null, null], helpOthers: false },
      ],
      [member("member-3", "prospecting", { spec: "assaying", traits: ["deepVein"] })],
    );
    const withGear = { ...s, equipment: [...s.equipment, piece("equip-77", "memberTool", "assayScanner", "member-3", { groundOreGrade: 4 })] };
    const back = migrate(deserialize(serialize(withGear, 1))!);
    expect(back.prospectingSquadsUnlocked).toBe(true);
    expect(back.awayMembers).toEqual(withGear.awayMembers);
    expect(back.ships[0].groundTeams).toEqual(withGear.ships[0].groundTeams);
    expect(back.equipment.find((e) => e.id === "equip-77")).toEqual(withGear.equipment.find((e) => e.id === "equip-77"));
    expect(isWellFormedShipGroundTeams(back.ships[0].groundTeams, FREIGHTER)).toBe(true);
  });

  it("the shape guard: a Claim team needs its Prospecting list; a Ground team must not carry one", () => {
    const ground = { kind: "ground", security: [null, null, null], science: [null, null, null], helpOthers: false };
    expect(isWellFormedShipGroundTeams([ground, { kind: "claim", security: [null, null, null], science: [], helpOthers: false }], FREIGHTER)).toBe(false);
    expect(isWellFormedShipGroundTeams([ground, { ...ground, prospecting: [null, null, null] }], FREIGHTER)).toBe(false);
    expect(isWellFormedShipGroundTeams([ground, { kind: "dig", security: [], science: [], prospecting: [null, null, null, null, null, null], helpOthers: false }], FREIGHTER)).toBe(true);
  });
});

describe("wiring (design section 8): every Prospecting source is deferred to the quests patch", () => {
  const deferred = (id: string) => {
    const e = WIRING_REGISTRY.find((x) => x.id === id);
    expect(e, id).toBeDefined();
    expect(e!.status.kind, id).toBe("deferred");
    if (e!.status.kind === "deferred") expect(e!.status.owner, id).toBe("prospecting quests patch");
  };

  it("the squad type, the unlock, the board slots, the kinds, the Standard-Issue rows, Steady's reach and the shared hazard gear", () => {
    for (const id of [
      "away:audit:prospectingTeam",
      "away:audit:prospectingUnlock",
      "away:audit:prospectingBoardSlots",
      "away:audit:prospectingTeamKinds",
      "away:audit:prospectingStandardIssue",
      "away:audit:steadyProspecting",
      "away:audit:sharedHazardGear",
      "away:audit:prospectingDigSafety",
    ]) deferred(id);
    // The D26 review (user 2026-10-21) dropped ARM / HP from the Hazard Suit's rolls, so it no longer registers them for
    // any squad; the dig-safety reading itself stays (prospectingCrewStats reads any ARM / HP a Prospecting member
    // carries, e.g. on a Hazard Suit crafted before the review: prospecting digSafety test above).
    for (const team of ["science", "prospecting"]) {
      for (const key of ["groundArmor", "groundHp"]) expect(WIRING_REGISTRY.some((x) => x.id === `gear:${team}:hazardSuit:${key}`), `${team} ${key}`).toBe(false);
    }
  });

  it("the role bases, the hidden blueprints, the three later uses, the five traits and every Prospecting gear line", () => {
    for (const spec of specsFor("prospecting")) deferred(`away:PROSPECTING_SPEC_BASE:${spec}`);
    for (const key of Object.keys(PROSPECTING_BLUEPRINTS)) deferred(`facility:PROSPECTING_BLUEPRINTS:${key}`);
    for (const use of PROSPECTING_USES) deferred(`away:PROSPECTING_USES:${use}`);
    for (const id of ["strongBack", "assayersEye", "tireless", "rockhound", "deepVein"]) deferred(`away:AWAY_TRAITS:${id}`);
    const lines = WIRING_REGISTRY.filter((e) => e.id.startsWith("gear:prospecting:"));
    // 25 before the D26 review dropped the Hazard Suit's ARM / HP.
    expect(lines).toHaveLength(23);
    for (const e of lines) deferred(e.id);
    // Steady keeps its live Science entry.
    expect(WIRING_REGISTRY.find((e) => e.id === "away:AWAY_TRAITS:steady")!.status.kind).toBe("live");
  });
});
