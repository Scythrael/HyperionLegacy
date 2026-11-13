// Relics v2 R2-4 (docs/plans/2026-10-17-relics-v2-plan.md section 4 R2-4): the PRE-MUSEUM-MATH-V2 GOLDENS. Tests only,
// captured on the code BEFORE the R2-4 engine edit (on top of bc25a23). They pin what the Museum grants today, so the
// engine commit proves what it keeps and names what it moves:
//   1. TIER I VETERANS: museumBonuses over a grid of 256 Tier I records (0 to 300 copies per type) equals the v1 formula
//      (museumBonusesFromRecord) and hashes to its pre-R2-4 value. Same counts, same bonus: must NEVER move.
//   2. A Tier I veteran PAST the soft cap (1,700 Tier I copies, and the R2-0 "1000 of every relic" record), written as a
//      save, loaded and migrated: the bonus after the load equals the bonus before it. Must NEVER move.
//   3. Tier II to VII general copies and exceptional pieces: before R2-4 they added NO stat (R2-3 carry note: "Tier II+
//      general copies and exceptional pieces add no stat until R2-4's museum math reads them"). MOVED by the R2-4 engine
//      commit on purpose: they now act (the per-tier D23 curve; the exceptional flats). The pre-R2-4 capture was all
//      zeros (and Tier I only, for the mixed museum); the values below are the R2-4 pins.
// NEVER regenerate these from a later build. A slice that moves one names it and the reason in its commit.

import { describe, it, expect } from "vitest";
import { freshState, withGeneralMuseumRecord, type GameState, type MuseumV2, type RegionTierKey } from "./model";
import { EXCEPTIONAL_SETS, MUSEUM_STATS, RELICS, museumBonuses, museumBonusesFromRecord, type MuseumStat } from "./relics";
import { deserialize, migrate, serialize, type SaveFile } from "./save";
import { makeRng } from "./combat/rng";
import { hash } from "./firstRunsGoldens.fixture";
import { withoutThemeSwaps } from "./relicStatSwaps.fixture";

const ZERO = Object.fromEntries(MUSEUM_STATS.map((k) => [k, 0])) as Record<MuseumStat, number>;

// A deterministic Tier I record: each of the 17 types held with probability one half, 1 to 300 copies.
function veteranRecord(i: number): Record<string, number> {
  const rng = makeRng((0x5bd1e995 ^ Math.imul(i + 1, 0x9e3779b9)) >>> 0);
  const rec: Record<string, number> = {};
  for (const r of RELICS) if (rng.nextInt(2) === 1) rec[r.id] = 1 + rng.nextInt(300);
  return rec;
}

const withMuseumV2 = (m: MuseumV2): GameState => ({ ...freshState(), museumV2: m });

// The state as a save, through the real load path (serialize, deserialize, migrate).
function loadedState(s: GameState): GameState {
  const save = deserialize(serialize(s, 0)) as SaveFile;
  return migrate(save, 0x1357bdf1);
}

// ============================================================================
// 1. Tier I veterans
// ============================================================================
describe("R2-4 golden 1: Tier I veterans keep exactly today's bonus", () => {
  const grid = () => Array.from({ length: 256 }, (_, i) => veteranRecord(i));

  it("museumBonuses on every grid record equals the v1 formula on the same counts", () => {
    for (const rec of grid()) expect(museumBonuses(withGeneralMuseumRecord(freshState(), rec))).toEqual(museumBonusesFromRecord(rec));
  });

  it("the grid's bonuses hash to their pre-R2-4 value", () => {
    const out = grid().map((rec) => museumBonuses(withGeneralMuseumRecord(freshState(), rec)));
    expect(hash(out)).toBe("9f2645f5");
  });

  it("one readable veteran (grid record 0)", () => {
    const rec = veteranRecord(0);
    expect(rec).toEqual({
      ancientDriveCoil: 38,
      bioluminescentSeed: 250,
      flightRecorder: 84,
      glyphTablet: 286,
      hullRivet: 213,
      leviathanScale: 28,
      livingCrystal: 113,
      resonanceShard: 244,
      starChartFragment: 285,
    });
    expect(museumBonuses(withGeneralMuseumRecord(freshState(), rec))).toEqual({
      ...ZERO,
      cargoCapacity: 0.34500000000000003,
      craftingQuality: 0.025,
      researchSpeed: 0.8400000000000001,
      sensors: 0.391,
      transitSpeed: 0.02,
    });
  });
});

// ============================================================================
// 2. Tier I veterans past the soft cap, through a load
// ============================================================================
describe("R2-4 golden 2: a Tier I veteran past 1,000 copies keeps the same bonus through a load", () => {
  const over = { glyphTablet: 600, resonanceShard: 400, hullRivet: 300, sporeCapsule: 200, geodeCore: 100, captainsSigil: 60, tectonicKeystone: 40 };
  const all1000 = Object.fromEntries(RELICS.map((r) => [r.id, 1000]));

  it("1,700 Tier I copies: same counts, same bonus, before and after the load", () => {
    const before = withGeneralMuseumRecord(freshState(), over);
    const after = loadedState(before);
    expect(museumBonuses(before)).toEqual(museumBonusesFromRecord(over));
    expect(museumBonuses(after)).toEqual(museumBonuses(before));
    expect(museumBonuses(after)).toEqual({ ...ZERO, cargoCapacity: 0.36, miningYield: 0.14, researchSpeed: 1.025, sensors: 0.2 });
  });

  it("1,000 copies of every relic (R2-0 golden 5's record): same bonus after the load", () => {
    const before = withGeneralMuseumRecord(freshState(), all1000);
    expect(museumBonuses(loadedState(before))).toEqual(museumBonusesFromRecord(all1000));
  });
});

// ============================================================================
// 3. Tier II to VII copies and exceptional pieces (MOVED by R2-4 on purpose)
// ============================================================================
describe("R2-4 golden 3 (MOVED by R2-4): Tier II+ general copies and exceptional pieces now act", () => {
  const general = (n: number): MuseumV2["general"] => {
    const out: MuseumV2["general"] = {};
    for (let t = 2; t <= 7; t++) out[String(t) as RegionTierKey] = { glyphTablet: n, hullRivet: n, tectonicKeystone: n };
    return out;
  };
  const pieces = Object.fromEntries(EXCEPTIONAL_SETS.flatMap((s) => s.pieces.map((p) => [p.id, 1])));

  it("Tier II to VII copies alone (was: no stat)", () => {
    expect(museumBonuses(withMuseumV2({ general: general(25), exceptional: {}, frozen: {}, cultures: {}, culturesNamed: [], setsCompleted: [] }))).toEqual({ ...ZERO, cargoCapacity: 0.4745418956369287, hazardResist: 0.4745418956369287, researchSpeed: 0.4745418956369287 });
  });

  it("every exceptional piece held, every set complete (was: no stat)", () => {
    const sets = EXCEPTIONAL_SETS.map((s) => s.id);
    // MOVED by the four theme-matched stat swaps (user 2026-11-13): this pin is the pre-swap capture, reproduced with the
    // swaps switched off; the post-swap pin follows.
    expect(withoutThemeSwaps(() => museumBonuses(withMuseumV2({ general: {}, exceptional: pieces, frozen: {}, cultures: {}, culturesNamed: [], setsCompleted: sets })))).toEqual({
      researchSpeed: 0.55,
      craftingQuality: 0.85,
      relicFindChance: 1.42,
      cargoCapacity: 1.07,
      transitSpeed: 0.42000000000000004,
      salvageYield: 1.3599999999999999,
      sensors: 0.45999999999999996,
      scanSpeed: 1.8599999999999999,
      scienceTeamPower: 0.81,
      crewBonuses: 1.01,
      miningYield: 0.45999999999999996,
      rareMaterialChance: 1.6999999999999997,
      extractionSpeed: 0.35,
      hazardResist: 1.02,
    });
    // Post-swap: Guestbook craftingQuality to crewBonuses (+0.03), Keeper's Chair crewBonuses to craftingQuality (+0.13),
    // Wick and the Lightkeeper full set salvageYield to hazardResist (+0.07 +0.35), Plumb Line and the Deepcut full set
    // scienceTeamPower to extractionSpeed (+0.07 +0.35).
    expect(museumBonuses(withMuseumV2({ general: {}, exceptional: pieces, frozen: {}, cultures: {}, culturesNamed: [], setsCompleted: sets }))).toEqual({
      researchSpeed: 0.55,
      craftingQuality: 0.95,
      relicFindChance: 1.42,
      cargoCapacity: 1.07,
      transitSpeed: 0.42000000000000004,
      salvageYield: 0.9400000000000001,
      sensors: 0.45999999999999996,
      scanSpeed: 1.8599999999999999,
      scienceTeamPower: 0.39,
      crewBonuses: 0.91,
      miningYield: 0.45999999999999996,
      rareMaterialChance: 1.6999999999999997,
      extractionSpeed: 0.77,
      hazardResist: 1.44,
    });
  });

  it("a mixed museum (was: its Tier I record only)", () => {
    const tierOne = { glyphTablet: 12, hullRivet: 3 };
    const m: MuseumV2 = { general: { ...general(40), "1": tierOne }, exceptional: pieces, frozen: {}, cultures: {}, culturesNamed: [], setsCompleted: [] };
    expect(museumBonuses(withMuseumV2(m))).not.toEqual(museumBonusesFromRecord(tierOne));
    // MOVED by the four theme-matched stat swaps (user 2026-11-13): the pre-swap capture, swaps switched off; then the new pin.
    expect(withoutThemeSwaps(() => museumBonuses(withMuseumV2(m)))).toEqual({
      researchSpeed: 1.2690388824061252,
      craftingQuality: 0.85,
      relicFindChance: 1.42,
      cargoCapacity: 1.7800388824061253,
      transitSpeed: 0.42000000000000004,
      salvageYield: 1.3599999999999999,
      sensors: 0.45999999999999996,
      scanSpeed: 1.8599999999999999,
      scienceTeamPower: 0.81,
      crewBonuses: 1.01,
      miningYield: 0.45999999999999996,
      rareMaterialChance: 1.6999999999999997,
      extractionSpeed: 0.35,
      hazardResist: 1.7270388824061251,
    });
    // Post-swap: the same moves as the golden above (craftingQuality +0.10, crewBonuses -0.10, salvageYield -0.42,
    // hazardResist +0.42, scienceTeamPower -0.42, extractionSpeed +0.42); the curved tiers untouched.
    expect(museumBonuses(withMuseumV2(m))).toEqual({
      researchSpeed: 1.2690388824061252,
      craftingQuality: 0.95,
      relicFindChance: 1.42,
      cargoCapacity: 1.7800388824061253,
      transitSpeed: 0.42000000000000004,
      salvageYield: 0.9400000000000001,
      sensors: 0.45999999999999996,
      scanSpeed: 1.8599999999999999,
      scienceTeamPower: 0.39,
      crewBonuses: 0.91,
      miningYield: 0.45999999999999996,
      rareMaterialChance: 1.6999999999999997,
      extractionSpeed: 0.77,
      hazardResist: 2.1470388824061253,
    });
  });
});
