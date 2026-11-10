// Quartermaster Standard-Issue MEMBER gear stats (0.14.0; model.ts STANDARD_ISSUE_MEMBER_POINTS): the rules.
//   - every issued member piece carries its slot-role lines, quality-less, the same on every piece;
//   - the lines are ones its variety can roll and its squad reads (everything wired), and the wiring registry has a
//     live entry per line (Prospecting's deferred with the squad);
//   - a full Security kit is the "about +15% squad power" slight upgrade the user asked for;
//   - the crafted budget floor (user 2026-10-21 "Floor the stat budget"): crafted member gear always rolls at least the
//     free set's total and each signature line at least the free piece's value, at every level, in every tier, for
//     every variety and affix pick, with its item level untouched;
//   - the D26 line swap (user 2026-10-21 "Give them Science lines"): the Sidearm, Field Suit and Hazard Suit roll only
//     Science lines, and pieces crafted before have their dead lines remapped on load;
//   - a piece held since before the stats gains them on load (raised, never lowered), idempotently, and a dev-minted
//     blueprint-less piece is never treated as one.

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import {
  BLUEPRINTS,
  EQUIPMENT_SLOTS,
  MEMBER_GROUND_STAT_KEYS,
  MEMBER_SLOT_TYPES,
  SCIENCE_LINE_REMAP,
  STANDARD_ISSUE_ILEVEL,
  STANDARD_ISSUE_MEMBER_POINTS,
  STANDARD_ISSUE_MEMBER_SHARES,
  freshState,
  generateStandardIssue,
  isStandardIssueMemberPiece,
  standardIssueMemberLines,
  standardIssueMemberTotal,
  withScienceLineSwap,
  withStandardIssueMemberLines,
  type EquipmentInstance,
  type GameState,
} from "./model";
import { computeItemLevel, EQUIPMENT_ILEVEL_CAP_PER_TIER, generateEquipment, previewCraftOutcome } from "./itemgen";
import { requisitionEntriesFor, requisitionStandardIssue } from "./quartermaster";
import { GEAR_POINT_BUMP, pieceGroundPoints, snapshotMembers } from "./awayTeam";
import { inspectBlank } from "./tick";
import { craftedItemLevelReadout } from "./craftingProgress";
import { memberRollableKeys, WIRING_REGISTRY } from "./wiring/registry";
import { deserialize, migrate, serialize, withStandardIssueMemberLinesV70 } from "./save";
import { onHull, withCrew } from "./firstRunsGoldens.fixture";
import { withSiMemberGearOff } from "./siMemberGearSwitch.fixture";

const unlocked = (): GameState => ({ ...freshState(), prospectingSquadsUnlocked: true });
const memberRows = () => requisitionEntriesFor(unlocked()).filter((e) => e.teamType !== null);
const varietyOf = (e: ReturnType<typeof memberRows>[number]): string => (e.mint.kind === "member" ? e.mint.varietyKey : "");
// Effect points: a grenade's carry line is a charge count, not points (awayTeam.ts pieceTotalPoints).
const points = (p: Pick<EquipmentInstance, "implicitStats" | "rolledStats">): number =>
  Object.entries(pieceGroundPoints(p)).reduce((n, [k, v]) => (k === "groundCarryCapacity" ? n : n + (v ?? 0)), 0);
const SCIENCE_DEAD = ["groundPower", "groundAccuracy", "groundStatusChance", "groundArmor", "groundHp"];

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe("Standard-Issue member gear: the issued pieces", () => {
  it("every issued row carries its slot-role lines at the set's points, quality-less", () => {
    const issued = memberRows().map((e) => requisitionStandardIssue(unlocked(), e.slotType, e.teamType).minted!);
    expect(issued).toHaveLength(9);
    for (const piece of issued) {
      const variety = piece.moduleVariant!;
      expect(points(piece), variety).toBe(STANDARD_ISSUE_MEMBER_POINTS);
      for (const [stat, v] of Object.entries(standardIssueMemberLines(variety))) expect(piece.implicitStats[stat], `${variety}:${stat}`).toBe(v);
      expect(piece.rolledStats).toEqual({});
      expect(piece.quality).toBe(0);
      expect(piece.iLevel).toBe(STANDARD_ISSUE_ILEVEL);
      expect(isStandardIssueMemberPiece(piece)).toBe(true);
    }
    expect(standardIssueMemberTotal()).toBe(STANDARD_ISSUE_MEMBER_POINTS);
  });

  it("each share row sums to 1, names only lines its variety can roll, and the rounded lines sum to the points", () => {
    for (const slotType of MEMBER_SLOT_TYPES) {
      for (const v of EQUIPMENT_SLOTS[slotType].varieties) {
        const shares = STANDARD_ISSUE_MEMBER_SHARES[v.key];
        if (shares === undefined) continue;
        expect(Object.values(shares).reduce((n, x) => n + (x ?? 0), 0), v.key).toBeCloseTo(1, 10);
        const rollable = memberRollableKeys(slotType, v);
        for (const stat of Object.keys(shares)) expect(rollable.has(stat), `${v.key}:${stat}`).toBe(true);
        expect(Object.values(standardIssueMemberLines(v.key)).reduce((n, x) => n + x, 0), v.key).toBe(STANDARD_ISSUE_MEMBER_POINTS);
      }
    }
  });

  it("the share table is exactly the issued varieties (no orphan rows, no issued piece without one)", () => {
    expect(Object.keys(STANDARD_ISSUE_MEMBER_SHARES).sort()).toEqual(memberRows().map(varietyOf).sort());
  });

  it("every Security and Science line is a LIVE wiring entry; Prospecting's are deferred with the squad", () => {
    for (const e of memberRows()) {
      for (const stat of Object.keys(standardIssueMemberLines(varietyOf(e)))) {
        const entry = WIRING_REGISTRY.find((w) => w.id === `si:${e.teamType}:${varietyOf(e)}:${stat}`);
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

  it("the Science kit: Sidearm relic find + fieldwork, Field Suit fieldwork + hazard resist, Flora Scanner on its bodies", () => {
    const s = withCrew(onHull("orion"), "rank1si");
    for (const m of snapshotMembers(s, s.awayMembers.filter((x) => x.teamType === "science"))) {
      // Untuned (Sidearm + Field Suit): relic find 6, fieldwork 6 + 6, hazard resist 6.
      expect(m.groundStats.relicFind).toBeCloseTo(6 * GEAR_POINT_BUMP.relicFind, 10);
      expect(m.groundStats.hazardResist).toBeCloseTo(6 * GEAR_POINT_BUMP.hazardResist, 10);
      expect(m.groundStats.fieldwork).toBeCloseTo(18 * GEAR_POINT_BUMP.fieldwork, 10);
      const tuned = (m.fieldwork ?? []).find((f) => f.planetTypes !== undefined);
      expect(tuned?.planetTypes).toEqual(["terrestrial", "ocean", "toxic"]);
      expect(tuned!.organicsYield).toBeGreaterThan(0);
    }
  });
});

describe("Standard-Issue member gear: the crafted budget floor", () => {
  const MEMBER_VARIETIES = MEMBER_SLOT_TYPES.flatMap((slotType) => EQUIPMENT_SLOTS[slotType].varieties.filter((v) => v.member).map((v) => [slotType, v.key] as const));

  it("every crafted member piece, at every item level, carries at least the free total and each signature line at least the free value", () => {
    const total = standardIssueMemberTotal();
    for (const [slotType, key] of MEMBER_VARIETIES) {
      const free = standardIssueMemberLines(key);
      for (const iLevel of [1, 2, 3, 5, 6, 7, 10, 20, 40]) {
        for (let seed = 1; seed <= 24; seed += 1) {
          const piece = generateEquipment({
            slotType, varietyKey: key, blueprintKey: "test", iLevel, quality: 0, rarity: "standard", ascension: "none",
            rng: lcg(seed * 2654435761), allocateId: () => "equip-1",
          });
          expect(piece.iLevel).toBe(iLevel); // the floor never touches the item level
          expect(points(piece), `${key} iL${iLevel} seed ${seed}`).toBeGreaterThanOrEqual(total);
          for (const stat of Object.keys(piece.implicitStats)) {
            if (free[stat] !== undefined) expect(piece.implicitStats[stat], `${key}:${stat} iL${iLevel}`).toBeGreaterThanOrEqual(free[stat]);
          }
        }
      }
    }
  });

  it("the floor only lifts a weak roll: a high-level craft is the roll it always was, and a blueprint-less piece is never floored", () => {
    const at = (iLevel: number, blueprintKey: string | null) =>
      generateEquipment({ slotType: "memberWeapon", varietyKey: "pulseRifle", blueprintKey, iLevel, quality: 0, rarity: "standard", ascension: "none", rng: lcg(7), allocateId: () => "e" });
    expect(at(20, "pulseRifleBp")).toEqual(withSiMemberGearOff(() => at(20, "pulseRifleBp")));
    expect(points(at(1, null))).toBeLessThan(STANDARD_ISSUE_MEMBER_POINTS);
    expect(points(at(1, "pulseRifleBp"))).toBeGreaterThanOrEqual(STANDARD_ISSUE_MEMBER_POINTS);
    // The same draws, either way: the next value off the stream after the mint is identical.
    const rngA = lcg(99);
    const rngB = lcg(99);
    generateEquipment({ slotType: "memberWeapon", varietyKey: "pulseRifle", blueprintKey: "x", iLevel: 1, quality: 0, rarity: "standard", ascension: "none", rng: rngA, allocateId: () => "e" });
    withSiMemberGearOff(() => generateEquipment({ slotType: "memberWeapon", varietyKey: "pulseRifle", blueprintKey: "x", iLevel: 1, quality: 0, rarity: "standard", ascension: "none", rng: rngB, allocateId: () => "e" }));
    expect(rngA()).toBe(rngB());
  });

  it("the Fabricator's own mint at crafting level 1: item level 1, the floored lines", () => {
    const base = freshState();
    const s: GameState = { ...base, craftingLevel: 1, blanks: { ...base.blanks, pulseRifleBp: [new Decimal(1)] } };
    const next = inspectBlank(s, "pulseRifleBp");
    const piece = next.equipment[next.equipment.length - 1];
    expect(piece.iLevel).toBe(1);
    expect(points(piece)).toBeGreaterThanOrEqual(STANDARD_ISSUE_MEMBER_POINTS);
    expect(piece.implicitStats.groundPower).toBeGreaterThanOrEqual(6);
    expect(piece.implicitStats.groundAccuracy).toBeGreaterThanOrEqual(6);
  });

  it("the preview agrees with the mint (low corner exact) and the crafting readouts agree with each other", () => {
    for (const [, key] of MEMBER_VARIETIES) {
      const bp = Object.values(BLUEPRINTS).find((b) => b.equipmentOutput?.varietyKey === key);
      if (!bp) continue;
      for (const level of [1, 4, 12]) {
        const preview = previewCraftOutcome(bp, { craftingLevel: level })!;
        const iLevel = computeItemLevel({ craftingLevel: level, achievementBoost: 0, faTalentBonus: 0, itemTierCap: bp.tier * EQUIPMENT_ILEVEL_CAP_PER_TIER });
        expect(preview.iLevel, key).toBe(iLevel);
        expect(craftedItemLevelReadout({ craftingLevel: level, blueprintTier: bp.tier }).iLevel, key).toBe(preview.iLevel);
        // The low corner (Quality 0 Standard) is never below any real Quality 0 Standard roll's signature lines.
        const mins = Object.fromEntries(preview.implicit.map((r) => [r.stat, r.min]));
        for (let seed = 1; seed <= 12; seed += 1) {
          const piece = generateEquipment({
            slotType: bp.equipmentOutput!.slotType, varietyKey: key, blueprintKey: bp.key, iLevel, quality: 0, rarity: "standard", ascension: "none",
            rng: lcg(seed * 40503), allocateId: () => "e",
          });
          for (const [stat, min] of Object.entries(mins)) expect(piece.implicitStats[stat], `${key}:${stat} L${level}`).toBeGreaterThanOrEqual(min);
        }
        for (const r of preview.implicit) expect(r.max, `${key}:${r.stat}`).toBeGreaterThanOrEqual(r.min);
      }
    }
  });
});

describe("the D26 line swap: Science gear rolls Science lines", () => {
  it("the Sidearm, Field Suit and Hazard Suit roll no combat line; the Hazard Suit only hazard resist", () => {
    const keys = (slot: (typeof MEMBER_SLOT_TYPES)[number], key: string) => [...memberRollableKeys(slot, EQUIPMENT_SLOTS[slot].varieties.find((v) => v.key === key)!)].sort();
    expect(keys("memberWeapon", "sidearm")).toEqual(["groundFieldwork", "groundRelicFind"]);
    expect(keys("memberArmor", "fieldSuit")).toEqual(["groundFieldwork", "groundHazardResist"]);
    expect(keys("memberArmor", "hazardSuit")).toEqual(["groundHazardResist"]);
    for (const id of ["sidearm", "fieldSuit"]) {
      for (const stat of ["groundFieldwork", "groundRelicFind", "groundHazardResist"]) {
        const entry = WIRING_REGISTRY.find((w) => w.id === `gear:science:${id}:${stat}`);
        if (entry) expect(entry.status.kind, `${id}:${stat}`).toBe("live");
      }
    }
    expect(WIRING_REGISTRY.filter((w) => w.id.startsWith("gear:science:") && w.status.kind !== "live").map((w) => w.id)).toEqual([]);
  });

  it("a piece crafted before the swap has its dead lines moved, points for points, and a re-load is a no-op", () => {
    const sidearm = withSiMemberGearOff(() =>
      generateEquipment({ slotType: "memberWeapon", varietyKey: "sidearm", blueprintKey: "sidearmBp", iLevel: 20, quality: 2, rarity: "augmented", ascension: "none", rng: lcg(5), allocateId: () => "e1" }),
    );
    const suit = withSiMemberGearOff(() =>
      generateEquipment({ slotType: "memberArmor", varietyKey: "fieldSuit", blueprintKey: "fieldSuitBp", iLevel: 20, quality: 1, rarity: "standard", ascension: "none", rng: lcg(9), allocateId: () => "e2" }),
    );
    for (const old of [sidearm, suit]) {
      const before = points(old);
      const swapped = withScienceLineSwap(old);
      expect(swapped).not.toBe(old);
      expect(points(swapped)).toBe(before);
      for (const k of SCIENCE_DEAD) expect(pieceGroundPoints(swapped)[k as (typeof MEMBER_GROUND_STAT_KEYS)[number]], k).toBeUndefined();
      const remap = SCIENCE_LINE_REMAP[old.moduleVariant!];
      for (const [from, to] of Object.entries(remap)) {
        if ((old.implicitStats[from] ?? 0) > 0) expect(swapped.implicitStats[to]).toBeGreaterThanOrEqual(old.implicitStats[from]);
      }
      expect(withScienceLineSwap(swapped)).toBe(swapped);
    }
    // Nothing else is touched: a Security rifle, a Hazard Suit (its old ARM / HP still feed Prospecting dig safety).
    const rifle = generateEquipment({ slotType: "memberWeapon", varietyKey: "pulseRifle", blueprintKey: "x", iLevel: 10, quality: 0, rarity: "standard", ascension: "none", rng: lcg(3), allocateId: () => "e3" });
    expect(withScienceLineSwap(rifle)).toBe(rifle);
    const hazard = withSiMemberGearOff(() =>
      generateEquipment({ slotType: "memberArmor", varietyKey: "hazardSuit", blueprintKey: "hazardSuitBp", iLevel: 20, quality: 0, rarity: "standard", ascension: "none", rng: lcg(11), allocateId: () => "e4" }),
    );
    expect(withScienceLineSwap(hazard)).toBe(hazard);
  });
});

describe("Standard-Issue member gear: pieces held before the stats", () => {
  const preChange = (): EquipmentInstance[] =>
    withSiMemberGearOff(() => [
      generateStandardIssue({ slotType: "memberWeapon", varietyKey: "pulseRifle", fittedToShipId: null, allocateId: () => "equip-1" }),
      generateStandardIssue({ slotType: "memberArmor", varietyKey: "ballisticWeave", fittedToShipId: null, allocateId: () => "equip-2" }),
      generateStandardIssue({ slotType: "memberWeapon", varietyKey: "sidearm", fittedToShipId: null, allocateId: () => "equip-3" }),
    ]);

  it("gain the issued lines on load (the Sidearm through the swap first), never lose one, and a re-load is a no-op", () => {
    const [rifle, weave, sidearm] = preChange();
    expect(rifle.implicitStats).toEqual({ groundPower: 0, groundAccuracy: 0 });
    expect(sidearm.implicitStats).toEqual({ groundPower: 0 });
    const s = { ...freshState(), equipment: [rifle, weave, sidearm] };
    const loaded = withStandardIssueMemberLinesV70(s);
    expect(loaded.equipment[0].implicitStats).toEqual({ groundPower: 6, groundAccuracy: 6 });
    expect(loaded.equipment[1].implicitStats).toEqual({ groundArmor: 7, groundHp: 5 });
    expect(loaded.equipment[2].implicitStats).toEqual({ groundFieldwork: 6, groundRelicFind: 6 });
    for (const [i, p] of loaded.equipment.entries()) {
      for (const [stat, v] of Object.entries(withScienceLineSwap(s.equipment[i]).implicitStats)) expect(p.implicitStats[stat]).toBeGreaterThanOrEqual(v);
    }
    expect(withStandardIssueMemberLinesV70(loaded)).toBe(loaded);
  });

  it("raises only: a line already above the catalog keeps its value", () => {
    const [rifle] = preChange();
    const high = { ...rifle, implicitStats: { groundPower: 9, groundAccuracy: 0 } };
    expect(withStandardIssueMemberLines(high).implicitStats).toEqual({ groundPower: 9, groundAccuracy: 6 });
    const above = { ...rifle, implicitStats: { groundPower: 9, groundAccuracy: 8 } };
    expect(withStandardIssueMemberLines(above)).toBe(above);
  });

  it("through the real load path, worn or spare", () => {
    const [rifle] = preChange();
    const s = { ...freshState(), equipment: [{ ...rifle, fittedToMemberId: "member-1" }] };
    const loaded = migrate(deserialize(serialize(s, 1_000))!, 0x2468ace);
    expect(loaded.equipment[0].implicitStats).toEqual({ groundPower: 6, groundAccuracy: 6 });
    expect(loaded.equipment[0].fittedToMemberId).toBe("member-1");
  });

  it("never re-stats a crafted, dev, test or ship piece", () => {
    const [rifle] = preChange();
    const crafted = { ...rifle, blueprintKey: "pulseRifleBp" };
    const radiant = { ...rifle, rarity: "radiant" as const };
    // A dev-minted standard, blueprint-less piece: any other item level, quality or a rolled line is not free gear.
    const devLevel = { ...rifle, iLevel: 10 };
    const devQuality = { ...rifle, quality: 2 };
    const devRolled = { ...rifle, rolledStats: { groundPower: 3 } };
    const ship = generateStandardIssue({ slotType: "cargoBay", fittedToShipId: "ship-1", allocateId: () => "equip-9" });
    for (const p of [crafted, radiant, devLevel, devQuality, devRolled, ship]) expect(withStandardIssueMemberLines(p)).toBe(p);
    const s = { ...freshState(), equipment: [crafted, radiant, devLevel, devQuality, devRolled, ship] };
    expect(withStandardIssueMemberLinesV70(s)).toBe(s);
  });
});
