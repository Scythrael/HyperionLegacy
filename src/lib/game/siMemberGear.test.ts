// Quartermaster Standard-Issue MEMBER gear stats (0.14.0; model.ts STANDARD_ISSUE_MEMBER_GEAR): the rules.
//   - every issued member piece carries its slot-role lines, quality-less, the same on every piece;
//   - the lines are ones its variety can roll and its squad reads (everything wired), and the wiring registry has a
//     live entry per line (Prospecting's deferred with the squad);
//   - a full Security kit is the "about +15% squad power" slight upgrade the user asked for;
//   - crafted member gear out-points it at every crafting level, in every tier, for every variety and affix pick;
//   - a piece held since before the stats gains them on load (never weaker), idempotently, and nothing else is touched.

import { describe, expect, it } from "vitest";
import {
  BLUEPRINTS,
  EQUIPMENT_SLOTS,
  MEMBER_SLOT_TYPES,
  STANDARD_ISSUE_MEMBER_GEAR,
  STANDARD_ISSUE_MEMBER_SHARES,
  freshState,
  generateStandardIssue,
  isStandardIssueBaseline,
  standardIssueMemberLines,
  withStandardIssueMemberLines,
  type EquipmentInstance,
  type GameState,
} from "./model";
import { computeBudget, computeItemLevel, craftedItemLevelFloor, EQUIPMENT_ILEVEL_CAP_PER_TIER, generateEquipment, previewCraftOutcome } from "./itemgen";
import { requisitionEntriesFor, requisitionStandardIssue } from "./quartermaster";
import { GEAR_POINT_BUMP, pieceGroundPoints, snapshotMembers } from "./awayTeam";
import { memberRollableKeys, WIRING_REGISTRY } from "./wiring/registry";
import { deserialize, migrate, serialize, withStandardIssueMemberLinesV70 } from "./save";
import { onHull, withCrew } from "./firstRunsGoldens.fixture";
import { withSiMemberGearOff } from "./siMemberGearSwitch.fixture";

const unlocked = (): GameState => ({ ...freshState(), prospectingSquadsUnlocked: true });
const memberRows = () => requisitionEntriesFor(unlocked()).filter((e) => e.teamType !== null);
const total = (p: Pick<EquipmentInstance, "implicitStats" | "rolledStats">): number =>
  Object.values(pieceGroundPoints(p)).reduce((n, v) => n + (v ?? 0), 0);

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe("Standard-Issue member gear: the issued pieces", () => {
  it("every issued row carries its slot-role lines at the set's points (the Science Sidearm and Field Suit excepted)", () => {
    const issued = memberRows().map((e) => requisitionStandardIssue(unlocked(), e.slotType, e.teamType).minted!);
    expect(issued).toHaveLength(9);
    for (const piece of issued) {
      const variety = piece.moduleVariant!;
      const lines = standardIssueMemberLines(variety);
      if (variety === "sidearm" || variety === "fieldSuit") {
        // D26: Science never fights; their only rollable lines are inert until the line swap.
        expect(lines, variety).toEqual({});
        expect(total(piece), variety).toBe(0);
        continue;
      }
      expect(total(piece), variety).toBe(STANDARD_ISSUE_MEMBER_GEAR.points);
      for (const [stat, v] of Object.entries(lines)) expect(piece.implicitStats[stat], `${variety}:${stat}`).toBe(v);
      // Quality-less: no affixes, the quality-0 Standard floor, identical to a second issue.
      expect(piece.rolledStats).toEqual({});
      expect(piece.quality).toBe(0);
      expect(isStandardIssueBaseline(piece)).toBe(true);
    }
  });

  it("each share row sums to 1, names only lines its variety can roll, and the rounded lines sum to the points", () => {
    for (const slotType of MEMBER_SLOT_TYPES) {
      for (const v of EQUIPMENT_SLOTS[slotType].varieties) {
        const shares = STANDARD_ISSUE_MEMBER_SHARES[v.key];
        if (shares === undefined) continue;
        const sum = Object.values(shares).reduce((n, x) => n + (x ?? 0), 0);
        expect(sum, v.key).toBeCloseTo(1, 10);
        const rollable = memberRollableKeys(slotType, v);
        for (const stat of Object.keys(shares)) expect(rollable.has(stat), `${v.key}:${stat}`).toBe(true);
        expect(Object.values(standardIssueMemberLines(v.key)).reduce((n, x) => n + x, 0), v.key).toBe(STANDARD_ISSUE_MEMBER_GEAR.points);
      }
    }
  });

  it("every share row belongs to a variety the Quartermaster issues (no orphan rows)", () => {
    const issued = new Set(memberRows().map((e) => (e.mint.kind === "member" ? e.mint.varietyKey : "")));
    for (const key of Object.keys(STANDARD_ISSUE_MEMBER_SHARES)) expect(issued.has(key), key).toBe(true);
  });

  it("every Security and Science line is a LIVE wiring entry; Prospecting's are deferred with the squad", () => {
    for (const e of memberRows()) {
      if (e.mint.kind !== "member") continue;
      for (const stat of Object.keys(standardIssueMemberLines(e.mint.varietyKey))) {
        const entry = WIRING_REGISTRY.find((w) => w.id === `si:${e.teamType}:${e.mint.kind === "member" ? e.mint.varietyKey : ""}:${stat}`);
        expect(entry, `${e.key}:${stat}`).toBeDefined();
        expect(entry!.status.kind, `${e.key}:${stat}`).toBe(e.teamType === "prospecting" ? "deferred" : "live");
      }
    }
  });

  it("implants have no Standard-Issue floor (user: 'Implants X1/X2 depending on racial. Keep this as is.')", () => {
    expect(memberRows().some((e) => e.slotType === "implant")).toBe(false);
  });
});

describe("Standard-Issue member gear: the slight upgrade", () => {
  it("a full Security kit: +6% power, +2.4% accuracy, +17.5% armor, +17% HP per member; nothing switched off", () => {
    const s = withCrew(onHull("orion"), "rank1si");
    const sec = snapshotMembers(s, s.awayMembers.filter((m) => m.teamType === "security"));
    expect(sec).toHaveLength(6);
    for (const m of sec) {
      expect(m.groundStats.power).toBeCloseTo(6 * GEAR_POINT_BUMP.power, 10);
      expect(m.groundStats.accuracy).toBeCloseTo(6 * GEAR_POINT_BUMP.accuracy, 10);
      expect(m.groundStats.armor).toBeCloseTo(7 * GEAR_POINT_BUMP.armor, 10);
      expect(m.groundStats.hp).toBeCloseTo(17 * GEAR_POINT_BUMP.hp, 10);
    }
    withSiMemberGearOff(() => {
      const off = withCrew(onHull("orion"), "rank1si");
      for (const m of snapshotMembers(off, off.awayMembers.filter((x) => x.teamType === "security"))) {
        for (const v of Object.values(m.groundStats)) expect(v).toBe(0);
      }
    });
  });

  it("the Science kit's Flora Scanner adds organics yield and fieldwork on its tuned bodies", () => {
    const s = withCrew(onHull("orion"), "rank1si");
    const sci = snapshotMembers(s, s.awayMembers.filter((m) => m.teamType === "science"));
    for (const m of sci) {
      const tuned = (m.fieldwork ?? []).find((f) => f.planetTypes !== undefined);
      expect(tuned?.planetTypes).toEqual(["terrestrial", "ocean", "toxic"]);
      expect(tuned!.organicsYield).toBeGreaterThan(0);
      expect(tuned!.fieldwork).toBeGreaterThan(0);
    }
  });
});

describe("Standard-Issue member gear: crafted gear stays above it", () => {
  it("the crafted floor is the smallest item level whose weakest budget exceeds the points (7 at 12 points)", () => {
    const floor = craftedItemLevelFloor("memberWeapon")!;
    expect(floor).toBe(7);
    expect(computeBudget(floor, 0, 0)).toBeGreaterThan(STANDARD_ISSUE_MEMBER_GEAR.points);
    expect(computeBudget(floor - 1, 0, 0)).toBeLessThanOrEqual(STANDARD_ISSUE_MEMBER_GEAR.points);
    for (const slot of MEMBER_SLOT_TYPES) expect(craftedItemLevelFloor(slot)).toBe(floor);
    // Ship slots have no floor; switched off, member gear has none either.
    for (const slot of ["cargoBay", "hullPlating", "shieldEmitters", "weapon", "droneBay", "sensor"]) expect(craftedItemLevelFloor(slot)).toBeUndefined();
    withSiMemberGearOff(() => expect(craftedItemLevelFloor("memberWeapon")).toBeUndefined());
  });

  it("every crafting level in every tier mints member gear at or above the floor, never past the tier cap", () => {
    const floor = craftedItemLevelFloor("memberArmor")!;
    for (const tier of [1, 2, 3]) {
      const cap = tier * EQUIPMENT_ILEVEL_CAP_PER_TIER;
      for (let level = 1; level <= 80; level += 1) {
        const il = computeItemLevel({ craftingLevel: level, achievementBoost: 0, faTalentBonus: 0, itemTierCap: cap, floor });
        expect(il).toBeGreaterThanOrEqual(floor);
        expect(il).toBeLessThanOrEqual(cap);
        expect(il).toBe(Math.max(floor, Math.min(level, cap)));
      }
    }
  });

  it("the weakest crafted piece of EVERY member variety out-points EVERY issued piece, for every affix pick", () => {
    const floor = craftedItemLevelFloor("memberWeapon")!;
    const best = Math.max(...memberRows().map((e) => total(requisitionStandardIssue(unlocked(), e.slotType, e.teamType).minted!)));
    for (const slotType of MEMBER_SLOT_TYPES) {
      for (const v of EQUIPMENT_SLOTS[slotType].varieties) {
        if (!v.member) continue;
        for (let seed = 1; seed <= 64; seed += 1) {
          const piece = generateEquipment({
            slotType, varietyKey: v.key, blueprintKey: "test", iLevel: floor, quality: 0, rarity: "standard", ascension: "none",
            rng: lcg(seed * 2654435761), allocateId: () => "equip-1",
          });
          // A grenade's carry line is stored as one charge, not as its share of points (awayTeam.ts pieceTotalPoints):
          // such a piece carries at least the free set's effect points PLUS an extra charge per objective.
          const carry = (piece.implicitStats.groundCarryCapacity ?? 0) + (piece.rolledStats.groundCarryCapacity ?? 0);
          expect(total(piece) - carry, `${slotType}:${v.key} seed ${seed}`).toBeGreaterThanOrEqual(best);
          expect(total(piece), `${slotType}:${v.key} seed ${seed}`).toBeGreaterThan(best);
        }
      }
    }
  });

  it("the Fabricator preview of a member blueprint at crafting level 1 shows the floor item level", () => {
    const floor = craftedItemLevelFloor("memberWeapon")!;
    expect(previewCraftOutcome(BLUEPRINTS.pulseRifleBp, { craftingLevel: 1 })!.iLevel).toBe(floor);
    expect(previewCraftOutcome(BLUEPRINTS.pulseRifleBp, { craftingLevel: 12 })!.iLevel).toBe(12);
  });
});

describe("Standard-Issue member gear: pieces held before the stats", () => {
  const preChange = (): EquipmentInstance[] =>
    withSiMemberGearOff(() => [
      generateStandardIssue({ slotType: "memberWeapon", varietyKey: "pulseRifle", fittedToShipId: null, allocateId: () => "equip-1" }),
      generateStandardIssue({ slotType: "memberArmor", varietyKey: "ballisticWeave", fittedToShipId: null, allocateId: () => "equip-2" }),
      generateStandardIssue({ slotType: "memberWeapon", varietyKey: "sidearm", fittedToShipId: null, allocateId: () => "equip-3" }),
    ]);

  it("gain exactly the issued lines on load, never lose one, and a re-load is a no-op", () => {
    const [rifle, weave, sidearm] = preChange();
    expect(rifle.implicitStats).toEqual({ groundPower: 0, groundAccuracy: 0 });
    const s = { ...freshState(), equipment: [rifle, weave, sidearm] };
    const loaded = withStandardIssueMemberLinesV70(s);
    const fresh = (slotType: "memberWeapon" | "memberArmor", varietyKey: string, id: string) =>
      generateStandardIssue({ slotType, varietyKey, fittedToShipId: null, allocateId: () => id });
    expect(loaded.equipment[0]).toEqual(fresh("memberWeapon", "pulseRifle", "equip-1"));
    expect(loaded.equipment[1]).toEqual(fresh("memberArmor", "ballisticWeave", "equip-2"));
    expect(loaded.equipment[2]).toBe(sidearm); // no lines to gain: the same reference
    for (const [i, p] of loaded.equipment.entries()) {
      for (const [stat, v] of Object.entries(s.equipment[i].implicitStats)) expect(p.implicitStats[stat]).toBeGreaterThanOrEqual(v);
    }
    expect(withStandardIssueMemberLinesV70(loaded)).toBe(loaded);
  });

  it("through the real load path, worn or spare", () => {
    const [rifle] = preChange();
    const s = { ...freshState(), equipment: [{ ...rifle, fittedToMemberId: "member-1" }] };
    const file = deserialize(serialize(s, 1_000))!;
    const loaded = migrate(file, 0x2468ace);
    expect(loaded.equipment[0].implicitStats).toEqual({ groundPower: 6, groundAccuracy: 6 });
    expect(loaded.equipment[0].fittedToMemberId).toBe("member-1");
  });

  it("never touches a crafted, dev or ship piece", () => {
    const crafted = { ...preChange()[0], blueprintKey: "pulseRifleBp" };
    const radiant = { ...preChange()[0], rarity: "radiant" as const };
    const ship = generateStandardIssue({ slotType: "cargoBay", fittedToShipId: "ship-1", allocateId: () => "equip-9" });
    for (const p of [crafted, radiant, ship]) expect(withStandardIssueMemberLines(p)).toBe(p);
    const s = { ...freshState(), equipment: [crafted, radiant, ship] };
    expect(withStandardIssueMemberLinesV70(s)).toBe(s);
  });
});
