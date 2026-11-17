// RARITY READINESS RR-1 (docs/plans/2026-10-23-rarity-readiness-plan.md, Review Focus 2): a rarity or ascension string
// this build does not know (a hand-edited save, a corrupt value, a save from a newer build) must never produce NaN or a
// crash. Two layers: TOTAL readers (every switch over the ladder has a Standard reading for anything else, every
// arithmetic reader guards non-finite input) and a value normalization that runs on EVERY load (no SAVE_VERSION bump).
// Valid values pass through unchanged, so the RR-0 LIVE goldens hold.

import { describe, expect, it } from "vitest";
import {
  EQUIPMENT_RARITY_LADDER,
  EQUIPMENT_SLOTS,
  RARITY_LOAD_FALLBACK,
  equipmentRarityLabel,
  freshState,
  isEquipmentAscension,
  isEquipmentRarity,
  moduleEffectScale,
  normalizeEquipmentAscension,
  normalizeEquipmentRarity,
  rarityIndex,
  salvageDurationTicks,
  type EquipmentInstance,
  type EquipmentRarity,
} from "./model";
import {
  affixCount,
  computeBudget,
  craftedDefensiveImplicit,
  generateDronePod,
  generateEquipment,
  generateWeapon,
} from "./itemgen";
import { itemScore } from "./archive";
import { sortRolledPieces } from "./inspectSort";
import { crewRarityMultiplier } from "./crewRarity";
import { relicBandOf, relicStudyDurationTicks } from "./relics";
import { SAVE_VERSION, deserialize, migrate, serialize, withNormalizedGearRaritiesV70 } from "./save";

// Every junk shape a save could present in a rarity or ascension field.
const JUNK: unknown[] = ["mythic", "", "  ", "RADIANT!", "constructor", "__proto__", "toString", 7, 0, -1, NaN, null, undefined, {}, [], true];
const junk = (x: unknown) => x as EquipmentRarity;

function cargo(rarity: unknown, ascension: unknown, id: string): EquipmentInstance {
  const piece = generateEquipment({
    slotType: "cargoBay",
    varietyKey: EQUIPMENT_SLOTS.cargoBay.varieties[0].key,
    blueprintKey: null,
    iLevel: 20,
    quality: 3,
    rarity: "stellar",
    ascension: "none",
    rng: () => 0.5,
    allocateId: () => id,
  });
  return { ...piece, rarity: rarity as EquipmentRarity, ascension: ascension as EquipmentInstance["ascension"] };
}

describe("RR-1: the rarity and ascension vocabulary normalizes", () => {
  it("passes every known band and ascension through unchanged", () => {
    for (const r of EQUIPMENT_RARITY_LADDER) {
      expect(isEquipmentRarity(r)).toBe(true);
      expect(normalizeEquipmentRarity(r)).toBe(r);
    }
    for (const a of ["none", "nova", "celestial"]) {
      expect(isEquipmentAscension(a)).toBe(true);
      expect(normalizeEquipmentAscension(a)).toBe(a);
    }
  });

  it("reads case and whitespace variants as the band they spell", () => {
    expect(normalizeEquipmentRarity("Radiant")).toBe("radiant");
    expect(normalizeEquipmentRarity(" stellar ")).toBe("stellar");
    expect(normalizeEquipmentRarity("LUMINOUS")).toBe("luminous");
    expect(normalizeEquipmentAscension("Nova")).toBe("nova");
    expect(normalizeEquipmentAscension(" CELESTIAL")).toBe("celestial");
  });

  it("reads anything else as the Standard-Issue floor and no ascension", () => {
    expect(RARITY_LOAD_FALLBACK).toBe("standard");
    for (const x of JUNK) {
      expect(isEquipmentRarity(x), String(x)).toBe(false);
      expect(normalizeEquipmentRarity(x), String(x)).toBe("standard");
      expect(normalizeEquipmentAscension(x), String(x)).toBe("none");
    }
  });
});

describe("RR-1: every rarity reader is total (no NaN, no crash)", () => {
  it("rarityIndex, affixCount, the label, the module scale and the crew multiplier give the Standard reading", () => {
    for (const x of JUNK) {
      const r = junk(x);
      expect(rarityIndex(r), String(x)).toBe(rarityIndex("standard"));
      let draws = 0;
      expect(affixCount(r, () => (draws++, 0.5)), String(x)).toBe(affixCount("standard", () => 0.5));
      expect(draws, String(x)).toBe(0);
      expect(typeof equipmentRarityLabel(r)).toBe("string");
      expect(Number.isFinite(moduleEffectScale(r, 3))).toBe(true);
      expect(crewRarityMultiplier(r)).toBe(crewRarityMultiplier("standard"));
      expect(relicStudyDurationTicks(r)).toBe(relicStudyDurationTicks("standard"));
      expect(relicBandOf(r)).toBe("standard");
    }
  });

  it("computeBudget and the defensive curves stay finite for non-finite input", () => {
    const bad = [NaN, Infinity, -Infinity, undefined as unknown as number];
    for (const b of bad) {
      expect(Number.isFinite(computeBudget(b, 3, 2))).toBe(true);
      expect(Number.isFinite(computeBudget(20, b, 2))).toBe(true);
      expect(Number.isFinite(computeBudget(20, 3, b))).toBe(true);
      expect(Number.isFinite(craftedDefensiveImplicit(94, 1, b, 3, 2))).toBe(true);
      expect(Number.isFinite(craftedDefensiveImplicit(94, 1, 20, b, 2))).toBe(true);
      expect(Number.isFinite(craftedDefensiveImplicit(94, 1, 20, 3, b))).toBe(true);
      expect(Number.isFinite(moduleEffectScale("radiant", b))).toBe(true);
    }
    // a non-finite rarity index reads as Standard's
    expect(computeBudget(20, 3, NaN)).toBe(computeBudget(20, 3, rarityIndex("standard")));
  });

  it("every generator mints finite lines for a junk rarity", () => {
    for (const x of JUNK) {
      const r = junk(x);
      const pieces = [
        generateEquipment({ slotType: "hullPlating", varietyKey: EQUIPMENT_SLOTS.hullPlating.varieties[0].key, blueprintKey: null, iLevel: 20, quality: 3, rarity: r, ascension: "none", rng: () => 0.3, allocateId: () => "e" }),
        generateWeapon({ weaponType: "autocannon", blueprintKey: null, iLevel: 20, quality: 3, rarity: r, ascension: "none", rng: () => 0.3, allocateId: () => "e" }),
        generateDronePod({ droneRole: "attack", blueprintKey: null, iLevel: 20, quality: 3, rarity: r, ascension: "none", rng: () => 0.3, allocateId: () => "e" }),
      ];
      for (const p of pieces) {
        for (const v of [...Object.values(p.implicitStats), ...Object.values(p.rolledStats)]) expect(Number.isFinite(v), `${String(x)} ${p.slotType}`).toBe(true);
      }
    }
  });

  it("the Archive score, the salvage duration and the reveal sort stay finite and total", () => {
    const pieces = JUNK.map((x, i) => cargo(x, "none", `equip-${i + 1}`));
    for (const p of pieces) {
      expect(Number.isFinite(itemScore(p))).toBe(true);
      expect(Number.isFinite(salvageDurationTicks({ kind: "equipment", iLevel: p.iLevel, quality: p.quality, rarity: p.rarity, tier: 1 }))).toBe(true);
    }
    expect(Number.isFinite(itemScore({ rarity: "radiant", quality: NaN, iLevel: 20 }))).toBe(true);
    expect(Number.isFinite(itemScore({ rarity: "radiant", quality: 3, iLevel: undefined as unknown as number }))).toBe(true);
    const sorted = sortRolledPieces([cargo("radiant", "none", "equip-a"), ...pieces, cargo("augmented", "none", "equip-b")]);
    expect(sorted[0].id).toBe("equip-a");
    expect(sorted).toHaveLength(pieces.length + 2);
  });
});

describe("RR-1: rarity normalization on every load", () => {
  it("a save with junk rarities and ascensions loads with known values everywhere (state.equipment)", () => {
    const base = freshState();
    const bad = [cargo("Radiant", "Nova", "equip-90"), cargo("mythic", "supernova", "equip-91"), cargo(7, null, "equip-92")];
    const noAscension = { ...cargo("augmented", "none", "equip-93") } as Partial<EquipmentInstance>;
    delete noAscension.ascension;
    const state = { ...base, equipment: [...base.equipment, ...bad, noAscension as EquipmentInstance] };
    const save = deserialize(serialize(state, 1_700_000_000_000, 1_700_000_000_000));
    expect(save).not.toBeNull();
    const loaded = migrate(save!, 1);
    const byId = (id: string) => loaded.equipment.find((e) => e.id === id)!;
    expect([byId("equip-90").rarity, byId("equip-90").ascension]).toEqual(["radiant", "nova"]);
    expect([byId("equip-91").rarity, byId("equip-91").ascension]).toEqual(["standard", "none"]);
    expect([byId("equip-92").rarity, byId("equip-92").ascension]).toEqual(["standard", "none"]);
    expect([byId("equip-93").rarity, byId("equip-93").ascension]).toEqual(["augmented", "none"]);
    for (const e of loaded.equipment) {
      expect(isEquipmentRarity(e.rarity), e.id).toBe(true);
      expect(isEquipmentAscension(e.ascension), e.id).toBe(true);
      expect(Number.isFinite(itemScore(e))).toBe(true);
    }
    expect(SAVE_VERSION).toBe(72); // E5-1 took v71 (the board evacuation stamp); this feature added no bump; the Standard-Issue crew modules took v72
  });

  it("normalizes an in-flight expedition's frozen battle gear, leaving the rest of the run alone", () => {
    const good = cargo("stellar", "none", "equip-1");
    const run = { id: "expedition-1", phase: "transit", groundOps: { version: 1, shipEventProfile: { evasion: 0, battle: { hullType: "orion", installedGear: [good, cargo("Mythic", 3, "equip-2")] } } } };
    const out = withNormalizedGearRaritiesV70({ equipment: [], expeditions: [run] });
    const gear = out.expeditions[0].groundOps.shipEventProfile.battle.installedGear;
    expect(gear[0]).toBe(good); // a clean piece keeps its reference
    expect([gear[1].rarity, gear[1].ascension]).toEqual(["standard", "none"]);
    expect(out.expeditions[0].phase).toBe("transit");
    expect(out.expeditions[0].groundOps.shipEventProfile.evasion).toBe(0);
  });

  it("is the identity (the SAME reference) on a clean save, and idempotent", () => {
    const s = freshState();
    expect(withNormalizedGearRaritiesV70(s)).toBe(s);
    const dirty = { ...s, equipment: [...s.equipment, cargo("Stellar", "none", "equip-77")] };
    const once = withNormalizedGearRaritiesV70(dirty);
    expect(once).not.toBe(dirty);
    expect(withNormalizedGearRaritiesV70(once)).toBe(once);
  });

  it("passes non-object shapes and junk entries through without throwing", () => {
    expect(withNormalizedGearRaritiesV70(null)).toBe(null);
    expect(withNormalizedGearRaritiesV70(5)).toBe(5);
    const odd = { equipment: "not a list", expeditions: [null, 3, { groundOps: null }] };
    expect(withNormalizedGearRaritiesV70(odd)).toBe(odd);
    const mixed = { equipment: [null, 4, "x"] };
    expect(withNormalizedGearRaritiesV70(mixed)).toBe(mixed);
  });
});
