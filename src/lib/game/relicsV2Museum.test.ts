// Relics v2 R2-4 (docs/plans/2026-10-17-relics-v2-plan.md section 4 R2-4): museum math v2. Engine only.
//   Tier I keeps the v1 math (every veteran keeps exactly its bonus: relicsV2MuseumGoldens.test.ts goldens 1 and 2);
//   Tiers II to VII run the same types through the D23 curve, scaled per tier (call 2); exceptional pieces and full sets
//   add flat values once (call 7); the soft cap snapshots a tier at 1000 identified relics (calls 3 and 4).

import { describe, it, expect } from "vitest";
import { emptyMuseumV2, freshState, withGeneralMuseumRecord, type GameState, type MuseumV2, type RegionTier, type RelicVaultToken } from "./model";
import {
  museumBeyondTierIBonuses,
  museumTierCurveBonuses,
  EXCEPTIONAL_FULL_SET_MULT,
  EXCEPTIONAL_PIECE_VALUE,
  EXCEPTIONAL_SETS,
  MUSEUM_STATS,
  MUSEUM_V2_KNEE,
  MUSEUM_V2_PER_COPY,
  RELIC_SOFT_CAP,
  RELIC_TYPES,
  SOFT_CAP_FREEZES_EXCEPTIONAL,
  exceptionalPieceTier,
  museumActiveRecord,
  museumBonuses,
  museumBonusesFromMuseum,
  museumBonusesFromRecord,
  museumDepositExceptional,
  museumDepositGeneral,
  museumTierFrozen,
  museumTierTotal,
  withSoftCapSnapshot,
  type CurvedRegionTier,
  type MuseumStat,
} from "./relics";
import { diminishing } from "./diminishing";
import { applyRelicIdentification } from "./relicIdentify";
import { grant } from "./processSpeed";
import { economyTick, queueAllRelicStudies, tick } from "./tick";
import { deserialize, migrate, serialize, withSoftCapSnapshotV70, type SaveFile } from "./save";
import { WIRING_REGISTRY } from "./wiring/registry";
import { withV1Museum } from "./firstRunsGoldens.fixture";
import { R2_4_ADDED_ENTRY_IDS, R2_4_FLIPPED_BEFORE } from "./relicMuseumV2.fixture";

const ZERO = Object.fromEntries(MUSEUM_STATS.map((k) => [k, 0])) as Record<MuseumStat, number>;
const CURVED: readonly CurvedRegionTier[] = [2, 3, 4, 5, 6, 7];
const withTier = (tier: RegionTier, rec: Record<string, number>): MuseumV2 => ({ ...emptyMuseumV2(), general: { [String(tier)]: rec } });
const cargoAt = (tier: RegionTier, n: number): number => museumBonusesFromMuseum(withTier(tier, { hullRivet: n })).cargoCapacity;

describe("R2-4 museum math v2: the curve", () => {
  it("an empty museum is all zeros (the additive-neutral seam)", () => {
    expect(museumBonusesFromMuseum(emptyMuseumV2())).toEqual(ZERO);
    expect(museumBonusesFromMuseum(undefined)).toEqual(ZERO);
    expect(museumBonuses(freshState())).toEqual(ZERO);
  });

  it("Tier I reads the v1 math exactly; Tiers II to VII read diminishing(copies x share x PER_COPY[tier], knee)", () => {
    const rec = { glyphTablet: 30, heartOfTheArchive: 8, hullRivet: 12 };
    expect(museumBonusesFromMuseum(withTier(1, rec))).toEqual(museumBonusesFromRecord(rec));
    for (const tier of CURVED) {
      const b = museumBonusesFromMuseum(withTier(tier, rec));
      const per = MUSEUM_V2_PER_COPY[tier];
      expect(b.researchSpeed).toBeCloseTo(diminishing((30 + 8 * 0.5) * per, MUSEUM_V2_KNEE), 15);
      expect(b.craftingQuality).toBeCloseTo(diminishing(8 * 0.5 * per, MUSEUM_V2_KNEE), 15);
      expect(b.cargoCapacity).toBeCloseTo(diminishing(12 * per, MUSEUM_V2_KNEE), 15);
    }
  });

  it("monotone and concave per tier above I: every copy helps, each a little less", () => {
    for (const tier of CURVED) {
      let prevValue = 0;
      let prevGain = Infinity;
      for (let n = 1; n <= 3000; n += 1) {
        const v = cargoAt(tier, n);
        const gain = v - prevValue;
        expect(gain, `Tier ${tier} copy ${n}`).toBeGreaterThan(0);
        expect(gain, `Tier ${tier} copy ${n}`).toBeLessThanOrEqual(prevGain + 1e-15);
        prevValue = v;
        prevGain = gain;
      }
    }
  });

  it("higher tiers are worth more per copy (same types, scaled per tier)", () => {
    for (let i = 1; i < CURVED.length; i++) expect(cargoAt(CURVED[i], 10)).toBeGreaterThan(cargoAt(CURVED[i - 1], 10));
    expect(cargoAt(2, 10)).toBeGreaterThan(cargoAt(1, 10));
  });

  it("a farmed tier's next copy is worth less than an early copy one tier up", () => {
    // Tier I farmed past every ladder rung: its next Hull Rivet adds the v1 per-copy 0.001 only.
    expect(cargoAt(1, 501) - cargoAt(1, 500)).toBeLessThan(cargoAt(2, 1) - cargoAt(2, 0));
    for (let i = 0; i + 1 < CURVED.length; i++) {
      const farmed = cargoAt(CURVED[i], 501) - cargoAt(CURVED[i], 500);
      const early = cargoAt(CURVED[i + 1], 1);
      expect(farmed, `Tier ${CURVED[i]} farmed vs Tier ${CURVED[i + 1]} early`).toBeLessThan(early);
    }
  });

  it("every Museum stat is fed by a general type at every curved tier", () => {
    const fed = new Set(RELIC_TYPES.flatMap((t) => t.stats.map((s) => s.stat)));
    expect([...fed].sort()).toEqual([...MUSEUM_STATS].sort());
    for (const tier of CURVED) {
      const all = museumBonusesFromMuseum(withTier(tier, Object.fromEntries(RELIC_TYPES.map((t) => [t.id, 1]))));
      for (const stat of MUSEUM_STATS) expect(all[stat], `Tier ${tier} ${stat}`).toBeGreaterThan(0);
    }
  });

  it("tiers add up: two tiers' copies are the sum of each alone", () => {
    const both: MuseumV2 = { ...emptyMuseumV2(), general: { "1": { hullRivet: 7 }, "3": { hullRivet: 40 } } };
    expect(museumBonusesFromMuseum(both).cargoCapacity).toBeCloseTo(cargoAt(1, 7) + cargoAt(3, 40), 15);
  });
});

describe("R2-4 museum math v2: exceptional pieces and full sets", () => {
  it("a piece adds its value once; a duplicate adds nothing (call 7)", () => {
    for (const set of EXCEPTIONAL_SETS) {
      const p = set.pieces[0];
      const one = museumBonusesFromMuseum({ ...emptyMuseumV2(), exceptional: { [p.id]: 1 } });
      const three = museumBonusesFromMuseum({ ...emptyMuseumV2(), exceptional: { [p.id]: 3 } });
      expect(one).toEqual({ ...ZERO, [p.stat]: p.value });
      expect(three).toEqual(one);
      expect(p.value).toBe(EXCEPTIONAL_PIECE_VALUE[set.tier]);
    }
  });

  it("a full set adds 5x one piece on top of its pieces, Tier I +3% to Tier VII +15% per piece", () => {
    expect(EXCEPTIONAL_PIECE_VALUE[1]).toBe(0.03);
    expect(EXCEPTIONAL_PIECE_VALUE[7]).toBe(0.15);
    for (const set of EXCEPTIONAL_SETS) {
      const all = museumBonusesFromMuseum({ ...emptyMuseumV2(), exceptional: Object.fromEntries(set.pieces.map((p) => [p.id, 1])) });
      const short = museumBonusesFromMuseum({ ...emptyMuseumV2(), exceptional: Object.fromEntries(set.pieces.slice(0, -1).map((p) => [p.id, 1])) });
      const fullStat = set.fullSet[0].stat;
      const lastStat = set.pieces[set.pieces.length - 1].stat;
      expect(lastStat).not.toBe(fullStat);
      expect(all[fullStat] - short[fullStat]).toBeCloseTo(EXCEPTIONAL_PIECE_VALUE[set.tier] * EXCEPTIONAL_FULL_SET_MULT, 12);
    }
  });

  it("pieces add on top of the general curve", () => {
    const p = EXCEPTIONAL_SETS[0].pieces[0];
    const base = withTier(2, { hullRivet: 20 });
    const withPiece = { ...base, exceptional: { [p.id]: 1 } };
    const a = museumBonusesFromMuseum(base);
    const b = museumBonusesFromMuseum(withPiece);
    expect(b[p.stat] - a[p.stat]).toBeCloseTo(p.value, 12);
  });
});

describe("R2-4 the soft cap (calls 3 and 4)", () => {
  const deposit = (m: MuseumV2, tier: RegionTier, n: number, typeId = "hullRivet"): MuseumV2 => {
    let cur = m;
    for (let i = 0; i < n; i++) cur = museumDepositGeneral(cur, tier, typeId, 1);
    return cur;
  };

  it("a tier's total counts its general and exceptional copies, duplicates included", () => {
    const piece = EXCEPTIONAL_SETS.find((s) => s.tier === 2)!.pieces[0].id;
    const m: MuseumV2 = { ...withTier(2, { hullRivet: 10, geodeCore: 5 }), exceptional: { [piece]: 3, "exc-t1-a-p1": 2 } };
    expect(exceptionalPieceTier(piece)).toBe(2);
    expect(museumTierTotal(m, 2)).toBe(18);
    expect(museumTierTotal(m, 1)).toBe(2);
  });

  it("the snapshot is exact at the cap and stable past it; the counts keep growing (and show)", () => {
    for (const tier of [1, 2, 7] as const) {
      const below = deposit(emptyMuseumV2(), tier, RELIC_SOFT_CAP - 1);
      expect(museumTierFrozen(below, tier)).toBe(false);
      const at = museumDepositGeneral(below, tier, "geodeCore", 1);
      expect(museumTierFrozen(at, tier)).toBe(true);
      expect(at.frozen[String(tier) as "1"]).toEqual({ hullRivet: RELIC_SOFT_CAP - 1, geodeCore: 1 });
      const past = deposit(at, tier, 500);
      expect(museumTierTotal(past, tier)).toBe(RELIC_SOFT_CAP + 500);
      expect(past.frozen).toEqual(at.frozen);
      expect(museumBonusesFromMuseum(past)).toEqual(museumBonusesFromMuseum(at));
      expect(museumActiveRecord(past, tier)).toEqual(at.frozen[String(tier) as "1"]);
      // Another tier keeps growing.
      const other: RegionTier = tier === 7 ? 6 : ((tier + 1) as RegionTier);
      expect(museumBonusesFromMuseum(deposit(past, other, 5)).cargoCapacity).toBeGreaterThan(museumBonusesFromMuseum(past).cargoCapacity);
    }
  });

  it("a multi-copy grant that crosses the cap snapshots exactly the cap", () => {
    const m = museumDepositGeneral(deposit(emptyMuseumV2(), 3, 990), 3, "glyphTablet", 25);
    expect(m.frozen["3"]).toEqual({ hullRivet: 990, glyphTablet: 10 });
    expect(m.general["3"]).toEqual({ hullRivet: 990, glyphTablet: 25 });
    // Exceptional copies count toward the total, so they take their share of the cap.
    const piece = EXCEPTIONAL_SETS.find((s) => s.tier === 3)!.pieces[0].id;
    const withPiece = museumDepositExceptional(museumDepositExceptional(deposit(emptyMuseumV2(), 3, 990), piece), piece);
    const crossed = museumDepositGeneral(withPiece, 3, "glyphTablet", 25);
    expect(crossed.frozen["3"]).toEqual({ hullRivet: 990, glyphTablet: 8, [piece]: 2 });
  });

  it("an exceptional deposit can reach the cap; pieces found after the freeze still act (SOFT_CAP_FREEZES_EXCEPTIONAL false)", () => {
    expect(SOFT_CAP_FREEZES_EXCEPTIONAL).toBe(false);
    const set = EXCEPTIONAL_SETS.find((s) => s.tier === 2)!;
    const atCap = museumDepositExceptional(deposit(emptyMuseumV2(), 2, RELIC_SOFT_CAP - 1), set.pieces[0].id);
    expect(museumTierFrozen(atCap, 2)).toBe(true);
    const later = museumDepositExceptional(atCap, set.pieces[1].id);
    const p = set.pieces[1];
    expect(museumBonusesFromMuseum(later)[p.stat] - museumBonusesFromMuseum(atCap)[p.stat]).toBeCloseTo(p.value, 12);
  });

  it("withSoftCapSnapshot is the same reference when nothing is due, and snapshots any tier already past the cap", () => {
    const m = withTier(2, { hullRivet: 12 });
    expect(withSoftCapSnapshot(m)).toBe(m);
    const big = withTier(4, { hullRivet: 1500 });
    const snapped = withSoftCapSnapshot(big);
    expect(snapped.frozen["4"]).toEqual({ hullRivet: 1500 });
    expect(withSoftCapSnapshot(snapped)).toBe(snapped);
  });

  it("every deposit path checks the cap: identification, the grant seam, a v1 study", () => {
    // Identification v2 (applyRelicIdentification): one copy from the cap.
    const near = deposit(emptyMuseumV2(), 2, RELIC_SOFT_CAP - 1);
    const idd = applyRelicIdentification(near, [], { kind: "general", tier: 2, typeId: "geodeCore" }, null);
    expect(museumTierFrozen(idd.museum, 2)).toBe(true);
    // The grant seam: a Tier I grant of 1,200 Glyph Tablets freezes Tier I at exactly 1,000.
    const g = grant(freshState(), { relics: [{ kind: "general", typeId: "glyphTablet", tier: 1, count: 1200 }] }, "Test");
    expect(g.granted).toBe(true);
    expect(g.next.museumV2.frozen["1"]).toEqual({ glyphTablet: RELIC_SOFT_CAP });
    expect(g.next.museumV2.general["1"]).toEqual({ glyphTablet: 1200 });
    expect(museumBonuses(g.next)).toEqual(museumBonusesFromRecord({ glyphTablet: RELIC_SOFT_CAP }));
  });

  it("offline == live across the cap: a study chain that crosses it lands the same Museum", () => {
    const vault: RelicVaultToken[] = Array.from({ length: 4 }, (_, i) => ({ id: `cap-${i}`, tier: "standard", quality: 0 }));
    const seed = (): GameState => queueAllRelicStudies({ ...withGeneralMuseumRecord(freshState(), { hullRivet: RELIC_SOFT_CAP - 2 }), relicVault: vault }).next;
    const span = 4 * 600 + 50;
    const offline = tick(span, seed(), () => 0);
    let live = seed();
    for (let i = 0; i < span; i++) live = economyTick(live, 1, () => 0);
    expect(offline.museumV2).toEqual(live.museumV2);
    expect(museumTierFrozen(offline.museumV2, 1)).toBe(true);
    expect(museumTierTotal(offline.museumV2, 1)).toBeGreaterThanOrEqual(RELIC_SOFT_CAP + 1);
  });
});

describe("R2-4 load: a veteran already past the cap (MIGRATIONS[69] step 6 and every load)", () => {
  const over = { glyphTablet: 700, hullRivet: 600 };

  it("withSoftCapSnapshotV70 snapshots the tier at its current counts, matching the engine's own snapshot", () => {
    const s = withGeneralMuseumRecord(freshState(), over);
    const out = withSoftCapSnapshotV70(s);
    expect(out.museumV2.frozen).toEqual({ "1": over });
    expect(out.museumV2).toEqual(withSoftCapSnapshot(s.museumV2));
    expect(withSoftCapSnapshotV70(out)).toBe(out);
  });

  it("is the same reference for a fresh save and for a museum under the cap; tolerates odd shapes", () => {
    const fresh = freshState();
    expect(withSoftCapSnapshotV70(fresh)).toBe(fresh);
    const small = withGeneralMuseumRecord(freshState(), { hullRivet: 999 });
    expect(withSoftCapSnapshotV70(small)).toBe(small);
    expect(withSoftCapSnapshotV70(null)).toBe(null);
    const odd = { museumV2: 3 };
    expect(withSoftCapSnapshotV70(odd)).toBe(odd);
  });

  it("counts exceptional copies by the tier in their id", () => {
    const piece = EXCEPTIONAL_SETS.find((s) => s.tier === 5)!.pieces[0].id;
    const s: GameState = { ...freshState(), museumV2: { ...withTier(5, { hullRivet: 997 }), exceptional: { [piece]: 3 } } };
    expect(withSoftCapSnapshotV70(s).museumV2.frozen).toEqual({ "5": { hullRivet: 997, [piece]: 3 } });
  });

  it("a v70 save past the cap loads with the same bonus, and further copies add nothing", () => {
    const s = withGeneralMuseumRecord(freshState(), over);
    const loaded = migrate(deserialize(serialize(s, 0)) as SaveFile, 0x2468ace1);
    expect(museumBonuses(loaded)).toEqual(museumBonusesFromRecord(over));
    const more = { ...loaded, museumV2: museumDepositGeneral(loaded.museumV2, 1, "hullRivet", 50) };
    expect(museumBonuses(more)).toEqual(museumBonuses(loaded));
  });

  it("a v69 save holding the old relicMuseum past the cap migrates through MIGRATIONS[69] with its snapshot and the same bonus", () => {
    const s = withGeneralMuseumRecord(freshState(), over);
    const v69 = { ...(deserialize(serialize(withV1Museum(s), 0)) as SaveFile), version: 69 };
    expect("relicMuseum" in (v69.state as unknown as Record<string, unknown>)).toBe(true);
    const loaded = migrate(v69, 0x2468ace1);
    expect("relicMuseum" in (loaded as unknown as Record<string, unknown>)).toBe(false);
    expect(loaded.museumV2.general["1"]).toEqual(over);
    expect(loaded.museumV2.frozen).toEqual({ "1": over });
    expect(museumBonuses(loaded)).toEqual(museumBonusesFromRecord(over));
    // The every-load pass leaves it as it is (idempotent), and a second load lands the same museum.
    expect(withSoftCapSnapshotV70(loaded)).toBe(loaded);
    expect(migrate(deserialize(serialize(loaded, 0)) as SaveFile, 0x2468ace1).museumV2).toEqual(loaded.museumV2);
  });
});

describe("R2-4 the Museum page's line beyond the Tier I sets (museumBeyondTierIBonuses)", () => {
  it("is zero for a Tier I museum (frozen or not), the curve for a higher tier, a piece's flat value for a piece", () => {
    expect(museumBeyondTierIBonuses(withGeneralMuseumRecord(freshState(), { glyphTablet: 700, hullRivet: 600 }).museumV2)).toEqual(museumBonusesFromMuseum(undefined));
    const rec = { glyphTablet: 40, hullRivet: 9 };
    expect(museumBeyondTierIBonuses(withTier(3, rec))).toEqual(museumTierCurveBonuses(rec, 3));
    const piece = EXCEPTIONAL_SETS[0].pieces[0];
    const withPiece = museumDepositExceptional(withGeneralMuseumRecord(freshState(), { glyphTablet: 5 }).museumV2, piece.id);
    expect(museumBeyondTierIBonuses(withPiece)[piece.stat]).toBeCloseTo(piece.value, 12);
  });
});

describe("R2-4 wiring: the registry move", () => {
  it("adds one per-copy entry per tier above I and the soft cap row, all live", () => {
    expect(WIRING_REGISTRY.filter((e) => R2_4_ADDED_ENTRY_IDS.has(e.id)).map((e) => `${e.id}|${e.status.kind}`)).toEqual([
      "relic:MUSEUM_V2_PER_COPY:2|live",
      "relic:MUSEUM_V2_PER_COPY:3|live",
      "relic:MUSEUM_V2_PER_COPY:4|live",
      "relic:MUSEUM_V2_PER_COPY:5|live",
      "relic:MUSEUM_V2_PER_COPY:6|live",
      "relic:MUSEUM_V2_PER_COPY:7|live",
      "relic:audit:softCap|live",
    ]);
  });

  it("flips every general type and every exceptional piece and full set live (17 + 54 + 14)", () => {
    expect(R2_4_FLIPPED_BEFORE.size).toBe(17 + 54 + 14);
    const flipped = WIRING_REGISTRY.filter((e) => R2_4_FLIPPED_BEFORE.has(e.id));
    expect(flipped).toHaveLength(R2_4_FLIPPED_BEFORE.size);
    for (const e of flipped) {
      expect(e.status.kind, e.id).toBe("live");
      expect(e.contexts, e.id).toEqual(["fleet"]);
      expect(e.probe?.startsWith("museum:"), e.id).toBe(true);
    }
  });
});
