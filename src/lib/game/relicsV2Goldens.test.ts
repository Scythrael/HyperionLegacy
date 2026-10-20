// Relics v2 R2-0 (docs/plans/2026-10-17-relics-v2-plan.md section 4 R2-0): the PRE-RELICS-V2 GOLDENS. Tests only,
// captured on the code BEFORE any Relics v2 engine edit (on top of a9caa06). They pin today's relic behavior so every
// later slice proves what it moves and what it keeps:
//   1. identifyRelic over a grid (4 sets x 4 token rarities x 64 seeds), plus the reserved rarities' fold.
//   2. rollRelicToken over a grid (seeds x hazards x PoIs x find bonus x captain) AND over the Tier I fixture runs
//      the G2-0 goldens use (expeditionTiersGoldens.fixture.ts PRE_G2_STORED_RUNS, run to completion).
//   3. depositExpeditionFindings' vault output.
//   4. relicStudyDurationTicks per rarity and museumResearchDurationTicks over a grid.
//   5. museumBonusesFromRecord on five fixture records (empty, one copy, a full set, a ladder level, 1000 copies).
//   6. A v69 save holding a vault, a museum and an in-flight study, migrated and ticked to completion, hashed
//      through stateHash (one call == 1 s steps).
// NEVER regenerate these from a later build. A slice that moves one names it and the reason in its commit.

import { describe, it, expect } from "vitest";
import { freshState, generalMuseumRecord, withGeneralMuseumRecord, RELIC_DEFAULT_SEED, type EquipmentRarity, type Expedition, type ExpeditionFinding, type GameState, type RelicSetId } from "./model";
import { MUSEUM_STATS, RELIC_SETS, RELICS, identifyRelic, museumBonusesFromRecord, relicStudyDurationTicks, relicStudySeed } from "./relics";
import { rollRelicToken } from "./gambit";
import { advanceExpedition, depositExpeditionFindings } from "./expedition";
import { economyTick, museumResearchDurationTicks, startRelicStudy, tick } from "./tick";
import { deserialize, migrate, serialize, type SaveFile } from "./save";
import { PRE_G2_STORED_RUNS } from "./expeditionTiersGoldens.fixture";
import { hash, stateHash, withV1Museum } from "./firstRunsGoldens.fixture";

const SETS: readonly RelicSetId[] = ["precursor", "shipwright", "xenobiology", "deepEarth"];
const TOKEN_RARITIES: readonly EquipmentRarity[] = ["standard", "augmented", "stellar", "radiant"];

// ============================================================================
// 1. identifyRelic
// ============================================================================
describe("R2-0 golden 1: identifyRelic over 4 sets x 4 rarities x 64 seeds", () => {
  const grid = (): string[] => {
    const out: string[] = [];
    for (const set of SETS) {
      for (const tier of TOKEN_RARITIES) {
        for (let i = 0; i < 64; i++) out.push(identifyRelic(set, tier, relicStudySeed(RELIC_DEFAULT_SEED, i + 1, `golden-${i}`)) ?? "null");
      }
    }
    return out;
  };

  it("the whole grid hashes to its pre-v2 value", () => {
    const g = grid();
    expect(g).toHaveLength(4 * 4 * 64);
    expect(hash(g)).toBe("2c48268");
  });

  it("one readable cell: Precursor standard tokens, the 64 seeds' reveal counts", () => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < 64; i++) {
      const id = identifyRelic("precursor", "standard", relicStudySeed(RELIC_DEFAULT_SEED, i + 1, `golden-${i}`))!;
      counts[id] = (counts[id] ?? 0) + 1;
    }
    expect(counts).toEqual({ glyphTablet: 40, resonanceShard: 8, starChartFragment: 11, precursorLens: 3, heartOfTheArchive: 2 });
  });

  it("the reserved rarities fold: derelict reads standard, luminous and constellar read radiant", () => {
    for (const set of SETS) {
      for (let i = 0; i < 64; i++) {
        const seed = relicStudySeed(RELIC_DEFAULT_SEED, i + 1, `golden-${i}`);
        expect(identifyRelic(set, "derelict", seed)).toBe(identifyRelic(set, "standard", seed));
        expect(identifyRelic(set, "luminous", seed)).toBe(identifyRelic(set, "radiant", seed));
        expect(identifyRelic(set, "constellar", seed)).toBe(identifyRelic(set, "radiant", seed));
      }
    }
  });
});

// ============================================================================
// 2. rollRelicToken
// ============================================================================
describe("R2-0 golden 2: rollRelicToken", () => {
  // One relic-bearing PoI per set, plus one that bears none.
  const POIS = [...RELIC_SETS.map((s) => s.sources[0]), "notAPoi"];
  const HAZARDS = [0, 0.1, 0.35, 0.65, 1];
  const BONUSES = [0, 0.25];
  const CAPTAINS = [undefined, { relicFindMult: 1.1, relicTierLift: 1, relicStudySpeed: 0.08 }];

  it("a grid of 64 seeds x 5 hazards x 5 PoIs x 2 find bonuses x 2 captains hashes to its pre-v2 value", () => {
    const out: unknown[] = [];
    let hits = 0;
    for (let seed = 1; seed <= 64; seed++) {
      for (const hazard of HAZARDS) {
        for (const poi of POIS) {
          for (const bonus of BONUSES) {
            for (const captain of CAPTAINS) {
              const t = rollRelicToken(Math.imul(seed, 0x9e3779b1) >>> 0, hazard, poi, `r-${seed}`, bonus, captain);
              if (t) hits++;
              out.push(t);
            }
          }
        }
      }
    }
    expect(hits).toBe(2920);
    expect(hash(out)).toBe("2f6173d5");
  });

  it("the G2-0 Tier I fixture runs, run to completion: their relic findings", () => {
    const relicFindings = (exp: Expedition) =>
      advanceExpedition(exp, 100_000 + 2_000_000)
        .findings.filter((f) => f.relic)
        .map((f) => ({ poiId: f.poiId, relic: f.relic }));
    const flagged = relicFindings(PRE_G2_STORED_RUNS.flagged as Expedition);
    const legacy = relicFindings(PRE_G2_STORED_RUNS.legacy as Expedition);
    const tok = (id: string, tier: EquipmentRarity, quality: number) => ({ id: `expedition-2-relic-expedition-2-body-1-act-${id}`, tier, quality, unidentified: true });
    expect({ flagged, legacy }).toEqual({
      flagged: [
        { poiId: "mineralOutcrop", relic: tok("4", "augmented", 1) },
        { poiId: "geothermalChamber", relic: tok("1", "standard", 0) },
        { poiId: "crashedShip", relic: tok("8", "standard", 0) },
        { poiId: "derelictOutpost", relic: tok("2", "standard", 0) },
        { poiId: "derelictOutpost", relic: tok("0", "standard", 0) },
        { poiId: "subterraneanCivilization", relic: tok("5", "standard", 0) },
      ],
      legacy: [],
    });
  });
});

// ============================================================================
// 3. depositExpeditionFindings
// ============================================================================
describe("R2-0 golden 3: depositExpeditionFindings' vault output", () => {
  it("every relic-bearing source PoI, a Preservationist token and a non-bearing PoI", () => {
    const findings: ExpeditionFinding[] = [];
    let n = 0;
    for (const set of RELIC_SETS) {
      for (const poiId of set.sources) {
        n++;
        findings.push({
          id: `exp-find-${n}`,
          source: "activity",
          poiId,
          relic: { id: `exp-relic-${n}`, tier: TOKEN_RARITIES[n % 4], quality: n % 5, unidentified: true, ...(n === 3 ? { studySpeed: 0.08 } : {}) },
        });
      }
    }
    findings.push({ id: "exp-find-x", source: "activity", poiId: "notAPoi", relic: { id: "exp-relic-x", tier: "radiant", quality: 4, unidentified: true } });
    const base: GameState = { ...freshState(), relicVault: [{ id: "old", tier: "stellar", quality: 2, setId: "deepEarth", poiId: "caveNetwork" }] };
    const out = depositExpeditionFindings(base, findings);
    expect(out.relicVault).toEqual([
      { id: "old", tier: "stellar", quality: 2, setId: "deepEarth", poiId: "caveNetwork" },
      { id: "exp-relic-1", tier: "augmented", quality: 1, setId: "precursor", poiId: "subterraneanCivilization" },
      { id: "exp-relic-2", tier: "stellar", quality: 2, setId: "precursor", poiId: "buriedVault" },
      { id: "exp-relic-3", tier: "radiant", quality: 3, setId: "precursor", poiId: "ancientRuins", studySpeed: 0.08 },
      { id: "exp-relic-4", tier: "standard", quality: 4, setId: "shipwright", poiId: "crashedShip" },
      { id: "exp-relic-5", tier: "augmented", quality: 0, setId: "shipwright", poiId: "derelictOutpost" },
      { id: "exp-relic-6", tier: "stellar", quality: 1, setId: "xenobiology", poiId: "xenoFloraBloom" },
      { id: "exp-relic-7", tier: "radiant", quality: 2, setId: "deepEarth", poiId: "caveNetwork" },
      { id: "exp-relic-8", tier: "standard", quality: 3, setId: "deepEarth", poiId: "geothermalChamber" },
      { id: "exp-relic-9", tier: "augmented", quality: 4, setId: "deepEarth", poiId: "mineralOutcrop" },
    ]);
  });
});

// ============================================================================
// 4. durations
// ============================================================================
describe("R2-0 golden 4: study durations", () => {
  it("relicStudyDurationTicks per rarity", () => {
    const all: EquipmentRarity[] = ["derelict", "standard", "augmented", "stellar", "radiant", "luminous", "constellar"];
    expect(all.map((r) => relicStudyDurationTicks(r))).toEqual([600, 600, 900, 1200, 1800, 1800, 1800]);
  });

  it("museumResearchDurationTicks over bases x bonuses", () => {
    const out: number[] = [];
    for (const base of [0, 1, 600, 900, 1800, 7200]) for (const bonus of [-0.1, 0, 0.001, 0.05, 0.126, 1, Number.NaN]) out.push(museumResearchDurationTicks(base, bonus));
    expect(out).toEqual([
      0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 600, 600, 600, 572, 533, 300, 600, 900, 900, 900, 858, 800, 450, 900, 1800, 1800, 1799, 1715,
      1599, 900, 1800, 7200, 7200, 7193, 6858, 6395, 3600, 7200,
    ]);
  });
});

// ============================================================================
// 5. museumBonusesFromRecord
// ============================================================================
describe("R2-0 golden 5: museumBonusesFromRecord on five fixture records", () => {
  const all = (n: number) => Object.fromEntries(RELICS.map((r) => [r.id, n]));
  const precursor = RELIC_SETS.find((s) => s.id === "precursor")!;
  const zero = Object.fromEntries(MUSEUM_STATS.map((k) => [k, 0]));
  it("empty", () => {
    expect(museumBonusesFromRecord({})).toEqual(zero);
  });
  it("one copy", () => {
    expect(museumBonusesFromRecord({ hullRivet: 1 })).toEqual({ ...zero, cargoCapacity: 0.001 });
  });
  it("a full set (every relic of every set held once)", () => {
    expect(museumBonusesFromRecord(all(1))).toEqual({ ...zero, researchSpeed: 0.005, cargoCapacity: 0.004, sensors: 0.004, miningYield: 0.004 });
  });
  it("a ladder level (the Precursor set at 20 copies, Deep Earth at 10)", () => {
    const rec = { ...Object.fromEntries(precursor.relicIds.map((id) => [id, 20])), geodeCore: 10, magmaPearl: 10, deepVeinCompass: 10, tectonicKeystone: 10 };
    expect(museumBonusesFromRecord(rec)).toEqual({
      ...zero,
      researchSpeed: 0.13,
      craftingQuality: 0.03,
      relicFindChance: 0.01,
      miningYield: 0.04,
      rareMaterialChance: 0.005,
      extractionSpeed: 0.005,
      hazardResist: 0.005,
    });
  });
  it("1000 copies of every relic", () => {
    expect(museumBonusesFromRecord(all(1000))).toEqual({
      researchSpeed: 5.075,
      craftingQuality: 0.07500000000000001,
      relicFindChance: 0.025,
      cargoCapacity: 4.025,
      transitSpeed: 0.025,
      salvageYield: 0.025,
      sensors: 4,
      scanSpeed: 0.025,
      scienceTeamPower: 0.025,
      crewBonuses: 0.025,
      miningYield: 4,
      rareMaterialChance: 0.025,
      extractionSpeed: 0.025,
      hazardResist: 0.025,
    });
  });
});

// ============================================================================
// 6. a v69 save with a vault, a museum and an in-flight study
// ============================================================================
describe("R2-0 golden 6: a v69 relic save, migrated and ticked to completion", () => {
  const ENTROPY = 0x2468ace1;
  // The state a save held: two vault tokens, a museum with copies, a first-find registry, one study in flight.
  const held = (): GameState => {
    const s: GameState = {
      ...withGeneralMuseumRecord(freshState(), { glyphTablet: 12, resonanceShard: 11, hullRivet: 3, geodeCore: 1 }),
      relicVault: [
        { id: "expedition-3-relic-a", tier: "stellar", quality: 3, setId: "xenobiology", poiId: "xenoFloraBloom" },
        { id: "expedition-3-relic-b", tier: "standard", quality: 1, setId: "precursor", poiId: "ancientRuins" },
      ],
      relicDiscovered: ["glyphTablet", "resonanceShard", "hullRivet", "geodeCore"],
      nextRelicStudyIndex: 5,
    };
    const started = startRelicStudy(s, "expedition-3-relic-a");
    expect(started.started).toBe(true);
    return started.next;
  };
  // R2-1: the save a pre-R2-1 build wrote holds the v1 `relicMuseum` (withV1Museum writes it at the record's place).
  const loaded = (): GameState => {
    const save = deserialize(serialize(withV1Museum(held()), 0)) as SaveFile;
    expect((save.state as unknown as Record<string, unknown>).relicMuseum).toEqual({ glyphTablet: 12, resonanceShard: 11, hullRivet: 3, geodeCore: 1 });
    return migrate({ ...save, version: 69 }, ENTROPY);
  };

  it("the migrated save, the study's duration, and the state after it completes", () => {
    const s = loaded();
    const proc = s.activeProcesses.find((p) => p.kind === "relicStudy")!;
    expect(proc.remainingTicks).toBe(1168);
    expect(stateHash(s)).toBe("b276466f");
    const done = tick(proc.remainingTicks + 10, s, () => 0);
    expect(done.activeProcesses.some((p) => p.kind === "relicStudy")).toBe(false);
    expect({ museum: generalMuseumRecord(done), discovered: done.relicDiscovered, vault: done.relicVault.map((t) => t.id) }).toEqual({
      museum: { glyphTablet: 12, resonanceShard: 11, hullRivet: 3, geodeCore: 1, sporeCapsule: 1 },
      discovered: ["glyphTablet", "resonanceShard", "hullRivet", "geodeCore", "sporeCapsule"],
      vault: ["expedition-3-relic-b"],
    });
    expect(stateHash(done)).toBe("eb9930b");
  });

  it("offline == live: one call equals 1 s steps", () => {
    const s = loaded();
    const span = s.activeProcesses.find((p) => p.kind === "relicStudy")!.remainingTicks + 10;
    const offline = tick(span, s, () => 0);
    let live = s;
    for (let i = 0; i < span; i++) live = economyTick(live, 1, () => 0);
    expect({ m: live.museumV2, d: live.relicDiscovered, p: live.activeProcesses }).toEqual({ m: offline.museumV2, d: offline.relicDiscovered, p: offline.activeProcesses });
  });
});
