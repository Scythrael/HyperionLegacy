// Relics v2 R2-2 (docs/plans/2026-10-17-relics-v2-plan.md section 4 R2-2): blanks by tier, sources, hooks.
//   - Tier I is byte-identical (the R2-0 grid through the stamped path); the chance never reads the tier.
//   - The tier tables are honored over 10,000 seeds per tier, and each tier shifts weight up the table.
//   - The haul multiplier and the blank tier never move the relic chance (user call 13 "Better rarity only").
//   - A blank's culture is a pure, stable derivation (body-tied for a new run, id-derived for an old token).
//   - The three hooks (short-range drops, the planet completion roll, the general pick for a blank with no set) are
//     deterministic and do what the user's answers say; the grant hook's relic kinds round-trip a save.

import { describe, it, expect } from "vitest";
import { freshState, RELIC_DEFAULT_SEED, type EquipmentRarity, type GameState, type RegionTier, type RelicVaultToken } from "./model";
import { CULTURE_ROSTER, RELIC_BAND_ODDS, RELIC_BANDS, RELIC_SETS, RELIC_TYPES, getRelicTypeById, relicBandOf, relicStudySeed, relicTypesInBand } from "./relics";
import {
  RELIC_BLANK_WEIGHTS,
  RELIC_BLANKS_VERSION,
  SHORT_RANGE_RELIC_RATE_MULT,
  EXPEDITION_RELIC_BLANKS_PER_HOUR,
  cultureForBody,
  generalTypeWeight,
  identifyGeneralRelic,
  legacyTokenCultureId,
  planetCompletionRelicBlank,
  relicBlankCeiling,
  relicBlankStamp,
  rollBlankRarity,
  rollCompletionRelicBlank,
  rollShortRangeRelicBlanks,
  shortRangeRelicMicrosPerHour,
  vaultTokenCultureId,
  vaultTokenRegionTier,
  vaultTokenSource,
  withRelicBlanks,
} from "./relicBlanks";
import { relicTierCeiling, rollRelicToken, taskRelicSeed } from "./gambit";
import { taskFullHaul } from "./groundTasks";
import { makeExpeditionSeed, startExpedition } from "./expedition";
import { economyTick, identifyStudiedRelic, tick } from "./tick";
import { startV1RelicStudy } from "./relicStudyV1.fixture";
import { canGrant, grant } from "./processSpeed";
import { deserialize, migrate, serialize, type SaveFile } from "./save";
import { makeRng } from "./combat/rng";
import { onHull, withCrew } from "./firstRunsGoldens.fixture";
import { asExpeditionVeteran } from "./awayTeamTestFixtures";
import { R2_2_ADDED_ENTRY_IDS } from "./relicBlanks.fixture";
import { WIRING_REGISTRY } from "./wiring/registry";

const TIERS: readonly RegionTier[] = [1, 2, 3, 4, 5, 6, 7];
const LADDER: readonly EquipmentRarity[] = ["standard", "augmented", "stellar", "radiant"];

describe("R2-2: the blank rarity table per tier", () => {
  it("Tier I is the relic roll's ladder exactly; the table shares the band odds' shift (Tier IV and VII as documented)", () => {
    expect(RELIC_BLANK_WEIGHTS[1].map((r) => [r.tier, r.weight, r.quality])).toEqual([
      ["standard", 1000, 0],
      ["augmented", 300, 1],
      ["stellar", 40, 3],
      ["radiant", 5, 4],
    ]);
    expect(RELIC_BLANK_WEIGHTS[4].map((r) => r.weight)).toEqual([667, 350, 80, 35]);
    expect(RELIC_BLANK_WEIGHTS[7].map((r) => r.weight)).toEqual([333, 350, 124, 85]);
    for (const tier of TIERS) {
      const row = RELIC_BLANK_WEIGHTS[tier];
      expect(row.map((r) => r.tier)).toEqual(LADDER);
      for (const r of row) expect(Number.isInteger(r.weight) && r.weight > 0, `${tier} ${r.tier}`).toBe(true);
      // The weight follows the standard blank's band row, scaled from Tier I.
      for (const r of row) {
        const band = relicBandOf(r.tier);
        const one = RELIC_BLANK_WEIGHTS[1].find((x) => x.tier === r.tier)!.weight;
        expect(r.weight).toBe(Math.max(1, Math.round((one * RELIC_BAND_ODDS[tier].standard[band]) / RELIC_BAND_ODDS[1].standard[band])));
      }
    }
  });

  it("each tier up shifts weight up the table: the commons' share never grows, the radiant share never shrinks", () => {
    const share = (tier: RegionTier, i: number) => RELIC_BLANK_WEIGHTS[tier][i].weight / RELIC_BLANK_WEIGHTS[tier].reduce((a, r) => a + r.weight, 0);
    for (let t = 1; t < 7; t++) {
      const a = t as RegionTier;
      const b = (t + 1) as RegionTier;
      expect(share(b, 0)).toBeLessThan(share(a, 0));
      expect(share(b, 3)).toBeGreaterThanOrEqual(share(a, 3));
    }
  });

  it("the tables are honored over 10,000 seeds per tier (full ladder), within tolerance", () => {
    const N = 10_000;
    for (const tier of TIERS) {
      const counts = [0, 0, 0, 0];
      for (let s = 1; s <= N; s++) counts[LADDER.indexOf(rollBlankRarity(makeRng(Math.imul(s, 0x9e3779b1) >>> 0), tier, 3).tier)]++;
      const total = RELIC_BLANK_WEIGHTS[tier].reduce((a, r) => a + r.weight, 0);
      RELIC_BLANK_WEIGHTS[tier].forEach((r, i) => {
        const p = r.weight / total;
        const tol = 4 * Math.sqrt((p * (1 - p)) / N) + 0.002;
        expect(Math.abs(counts[i] / N - p), `Tier ${tier} ${r.tier}`).toBeLessThan(tol);
      });
    }
  });

  it("the hazard ceiling still caps the ladder (one formula: gambit's relicTierCeiling reads relicBlankCeiling)", () => {
    for (const hazard of [0, 0.1, 0.2, 0.5, 0.9, 1]) for (const lift of [undefined, 0, 1, 2.7]) expect(relicTierCeiling(hazard, lift)).toBe(relicBlankCeiling(hazard, lift));
    for (let s = 1; s <= 500; s++) expect(rollBlankRarity(makeRng(s), 7, 0).tier).toBe("standard");
  });
});

describe("R2-2: rollRelicToken with a blank stamp", () => {
  const POIS = [...RELIC_SETS.map((s) => s.sources[0]), "notAPoi"];
  const HAZARDS = [0, 0.1, 0.35, 0.65, 1];
  const strip = (t: ReturnType<typeof rollRelicToken>) => {
    if (!t) return t;
    const { regionTier: _r, cultureId: _c, ...rest } = t;
    return rest;
  };

  it("Tier I: the R2-0 grid through the stamped path equals the unstamped roll (plus the stamp, appended last)", () => {
    for (let seed = 1; seed <= 64; seed++) {
      for (const hazard of HAZARDS) {
        for (const poi of POIS) {
          for (const captain of [undefined, { relicFindMult: 1.1, relicTierLift: 1, relicStudySpeed: 0.08 }]) {
            const s = Math.imul(seed, 0x9e3779b1) >>> 0;
            const plain = rollRelicToken(s, hazard, poi, `r-${seed}`, 0.25, captain);
            const stamped = rollRelicToken(s, hazard, poi, `r-${seed}`, 0.25, captain, { tier: 1, cultureId: "culture-t1-3" });
            expect(strip(stamped)).toEqual(plain);
            if (stamped) expect(Object.entries(stamped).slice(-2)).toEqual([["regionTier", 1], ["cultureId", "culture-t1-3"]]);
          }
        }
      }
    }
  });

  it("the chance never reads the tier: the same seeds hit at every tier", () => {
    for (let seed = 1; seed <= 400; seed++) {
      for (const hazard of HAZARDS) {
        const hits = TIERS.map((tier) => rollRelicToken(seed, hazard, "buriedVault", "r", 0, undefined, { tier, cultureId: CULTURE_ROSTER[tier][0] }) !== null);
        expect(new Set(hits).size, `${seed} ${hazard}`).toBe(1);
      }
    }
  });

  it("the haul multiplier never touches the relic roll: Tier VII's haul is bigger, its relic stream is the same", () => {
    const exp = { seed: 0x1234567, roster: undefined, scienceStrength: 1 };
    const t1 = taskFullHaul({ ...exp, region: { tier: 1 } }, [], { planetType: "terrestrial", hazard: 0.4 }, "buriedVault", 3);
    const t7 = taskFullHaul({ ...exp, region: { tier: 7 } }, [], { planetType: "terrestrial", hazard: 0.4 }, "buriedVault", 3);
    expect(t7.credits).toBeGreaterThan(t1.credits);
    // The relic seed is keyed by the run seed and the task index only; the region is not an input.
    expect(taskRelicSeed({ seed: exp.seed }, 3)).toBe(taskRelicSeed({ seed: exp.seed }, 3));
  });

  it("a tier above I rolls rarer on average (the same chance)", () => {
    const mean = (tier: RegionTier) => {
      let sum = 0;
      let n = 0;
      for (let seed = 1; seed <= 4000; seed++) {
        const t = rollRelicToken(seed, 1, "buriedVault", "r", 0, undefined, { tier, cultureId: "c" });
        if (t) {
          sum += LADDER.indexOf(t.tier);
          n++;
        }
      }
      return sum / n;
    };
    expect(mean(4)).toBeGreaterThan(mean(1));
    expect(mean(7)).toBeGreaterThan(mean(4));
  });
});

describe("R2-2: the blank stamp and cultures", () => {
  it("cultureForBody is pure, stable, in the tier's roster, and spreads over the roster", () => {
    for (const tier of TIERS) {
      const seen = new Set<string>();
      for (let b = 0; b < 200; b++) {
        const c = cultureForBody(0xabcdef, b, tier);
        expect(cultureForBody(0xabcdef, b, tier)).toBe(c);
        expect(CULTURE_ROSTER[tier]).toContain(c);
        seen.add(c);
      }
      expect(seen.size).toBe(CULTURE_ROSTER[tier].length);
    }
    // Pinned (a stored token relies on it never changing).
    expect([0, 1, 2, 3].map((b) => cultureForBody(0x1234567, b, 1))).toEqual(["culture-t1-2", "culture-t1-3", "culture-t1-6", "culture-t1-3"]);
    expect(["expedition-3-relic-a", "expedition-3-relic-b"].map((id) => legacyTokenCultureId(RELIC_DEFAULT_SEED, id))).toEqual(["culture-t1-3", "culture-t1-6"]);
  });

  it("relicBlankStamp: none without the flag; the region tier (else the risk tier) and the body's culture with it", () => {
    const base = { seed: 77, region: undefined, risk: undefined };
    expect(relicBlankStamp(base, 0)).toBeUndefined();
    const flagged = { ...base, relicBlanks: { version: RELIC_BLANKS_VERSION } };
    expect(relicBlankStamp(flagged, 2)).toEqual({ tier: 1, cultureId: cultureForBody(77, 2, 1) });
    const r5 = { ...flagged, region: { version: 1 as const, tier: 5 as RegionTier, enemyTerritory: false, bearing: 0, distanceLy: 9 } };
    expect(relicBlankStamp(r5, 0)).toEqual({ tier: 5, cultureId: cultureForBody(77, 0, 5) });
  });

  it("a new dispatch carries the flag", () => {
    const s = asExpeditionVeteran(withCrew(onHull("eir", makeExpeditionSeed(0x2468ace, 11)), "rank6"));
    const res = startExpedition(s, "ship-1", 1, "cand-1-0");
    expect(res.success).toBe(true);
    expect(res.expedition!.relicBlanks).toEqual({ version: RELIC_BLANKS_VERSION });
  });

  it("an old vault token reads Tier I, an expedition source and a culture derived from its id; a stamped one reads its stamps", () => {
    const old: RelicVaultToken = { id: "expedition-3-relic-a", tier: "stellar", quality: 3, setId: "xenobiology", poiId: "xenoFloraBloom" };
    const s = freshState();
    expect(vaultTokenRegionTier(old)).toBe(1);
    expect(vaultTokenSource(old)).toBe("expedition");
    expect(vaultTokenCultureId(s, old)).toBe(legacyTokenCultureId(RELIC_DEFAULT_SEED, old.id, 1));
    expect(CULTURE_ROSTER[1]).toContain(vaultTokenCultureId(s, old));
    expect(vaultTokenCultureId(s, old)).toBe(vaultTokenCultureId(s, { ...old }));
    const stamped: RelicVaultToken = { ...old, regionTier: 3, cultureId: "culture-t3-2", source: "completion" };
    expect([vaultTokenRegionTier(stamped), vaultTokenCultureId(s, stamped), vaultTokenSource(stamped)]).toEqual([3, "culture-t3-2", "completion"]);
  });
});

describe("R2-2 hook: short-range relic drops (G1-5)", () => {
  it("the rate is the user's: Tier I 0.08x and Tier II 0.15x of the expedition rate, per hour", () => {
    expect(SHORT_RANGE_RELIC_RATE_MULT).toEqual({ 1: 0.08, 2: 0.15 });
    expect(shortRangeRelicMicrosPerHour(1)).toBe(Math.round(1e6 * EXPEDITION_RELIC_BLANKS_PER_HOUR * 0.08));
    expect(shortRangeRelicMicrosPerHour(2)).toBe(Math.round(1e6 * EXPEDITION_RELIC_BLANKS_PER_HOUR * 0.15));
  });

  it("deterministic; each blank is Tier I, the lowest rarity, from a short-range mission, with no site", () => {
    let any = 0;
    for (let s = 1; s <= 3000; s++) {
      const a = rollShortRangeRelicBlanks(s, 2, 36_000, `sr-${s}`);
      expect(rollShortRangeRelicBlanks(s, 2, 36_000, `sr-${s}`)).toEqual(a);
      for (const t of a) {
        any++;
        expect(t).toEqual({ id: t.id, tier: "standard", quality: 0, regionTier: 1, cultureId: t.cultureId, source: "shortRange" });
        expect(CULTURE_ROSTER[1]).toContain(t.cultureId);
        expect(t.setId).toBeUndefined();
        expect(t.poiId).toBeUndefined();
      }
    }
    expect(any).toBeGreaterThan(0);
  });

  it("the expected rate per hour holds over a seed batch at each tier (rare)", () => {
    const N = 20_000;
    for (const tier of [1, 2] as const) {
      let n = 0;
      for (let s = 1; s <= N; s++) n += rollShortRangeRelicBlanks(Math.imul(s, 0x85ebca6b) >>> 0, tier, 3600, "x").length;
      const p = shortRangeRelicMicrosPerHour(tier) / 1e6;
      expect(Math.abs(n / N - p), `tier ${tier}`).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / N));
    }
  });

  it("a short run repeated fast earns no more per hour than a long one", () => {
    // The expectation is linear in the time: ten 6-minute cycles expect exactly one hour's blanks.
    const N = 20_000;
    let short = 0;
    let long = 0;
    for (let s = 1; s <= N; s++) {
      for (let k = 0; k < 10; k++) short += rollShortRangeRelicBlanks((s * 16 + k) >>> 0, 1, 360, "x").length;
      long += rollShortRangeRelicBlanks((s * 16 + 15) >>> 0, 1, 3600, "x").length;
    }
    const p = shortRangeRelicMicrosPerHour(1) / 1e6;
    expect(Math.abs(short / N - p)).toBeLessThan(4 * Math.sqrt(p / N));
    expect(Math.abs(long / N - p)).toBeLessThan(4 * Math.sqrt(p / N));
    // A cycle longer than a whole blank's worth always pays the whole part.
    const huge = (1e6 / shortRangeRelicMicrosPerHour(1)) * 3600 * 2;
    for (let s = 1; s <= 50; s++) expect(rollShortRangeRelicBlanks(s, 1, huge, "x").length).toBeGreaterThanOrEqual(2);
    expect(rollShortRangeRelicBlanks(1, 1, 0, "x")).toEqual([]);
  });
});

describe("R2-2 hook: the planet 100% completion roll (G7)", () => {
  it("one extra blank, one rarity step up from the tier's roll on the body's hazard", () => {
    for (let s = 1; s <= 2000; s++) {
      for (const tier of [1, 4, 7] as RegionTier[]) {
        const hazard = (s % 11) / 10;
        const t = rollCompletionRelicBlank(s, tier, hazard, `c-${s}`, "culture-t1-1");
        expect(rollCompletionRelicBlank(s, tier, hazard, `c-${s}`, "culture-t1-1")).toEqual(t);
        const base = rollBlankRarity(makeRng((s ^ 0x7d4e9b13) >>> 0), tier, relicBlankCeiling(hazard));
        const i = LADDER.indexOf(base.tier);
        expect(t.tier).toBe(LADDER[Math.min(3, i + 1)]);
        expect(t.quality).toBe(RELIC_BLANK_WEIGHTS[tier][Math.min(3, i + 1)].quality);
        expect([t.regionTier, t.source, t.cultureId, t.setId, t.poiId]).toEqual([tier, "completion", "culture-t1-1", undefined, undefined]);
      }
    }
  });

  it("planetCompletionRelicBlank reads the run's tier, the body's hazard and culture", () => {
    const exp = {
      id: "expedition-9",
      seed: 0x5eed,
      region: { version: 1 as const, tier: 3 as RegionTier, enemyTerritory: false, bearing: 0, distanceLy: 30 },
      risk: undefined,
      bodies: [{ id: "body-1", hazard: 0.2 }, { id: "body-2", hazard: 1 }] as never,
    };
    const t = planetCompletionRelicBlank(exp, 1)!;
    expect(t.id).toBe("expedition-9-relic-complete-body-2");
    expect(t.regionTier).toBe(3);
    expect(t.cultureId).toBe(cultureForBody(0x5eed, 1, 3));
    expect(LADDER.indexOf(t.tier)).toBeGreaterThanOrEqual(1); // one step up: never standard
    expect(planetCompletionRelicBlank(exp, 5)).toBeNull();
  });
});

describe("R2-2: a blank with no set identifies over the general pool", () => {
  it("deterministic; the band follows RELIC_BAND_ODDS; every type is in its band", () => {
    const N = 10_000;
    for (const tier of [1, 7] as RegionTier[]) {
      const counts: Record<string, number> = {};
      for (let s = 1; s <= N; s++) {
        const id = identifyGeneralRelic(tier, "standard", undefined, s);
        expect(identifyGeneralRelic(tier, "standard", undefined, s)).toBe(id);
        const band = getRelicTypeById(id)!.band;
        counts[band] = (counts[band] ?? 0) + 1;
      }
      const row = RELIC_BAND_ODDS[tier].standard;
      const total = RELIC_BANDS.reduce((a, b) => a + row[b], 0);
      for (const b of RELIC_BANDS) {
        const p = row[b] / total;
        expect(Math.abs((counts[b] ?? 0) / N - p), `${tier} ${b}`).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / N) + 0.002);
      }
    }
  });

  it("the site bias doubles the old set's types (user call 17)", () => {
    expect(generalTypeWeight(getRelicTypeById("geodeCore")!, "deepEarth")).toBe(2 * getRelicTypeById("geodeCore")!.weight);
    expect(generalTypeWeight(getRelicTypeById("glyphTablet")!, "deepEarth")).toBe(getRelicTypeById("glyphTablet")!.weight);
    expect(generalTypeWeight(getRelicTypeById("geodeCore")!, null)).toBe(getRelicTypeById("geodeCore")!.weight);
    // Over many seeds, a Deep Earth site's standard reveals favor Geode Core (2 of 5 weight units in the band).
    const N = 10_000;
    let geode = 0;
    let std = 0;
    for (let s = 1; s <= N; s++) {
      const id = identifyGeneralRelic(1, "standard", "caveNetwork", s);
      if (getRelicTypeById(id)!.band === "standard") {
        std++;
        if (id === "geodeCore") geode++;
      }
    }
    const p = 2 / (relicTypesInBand("standard").length + 1);
    expect(Math.abs(geode / std - p)).toBeLessThan(0.03);
    expect(RELIC_TYPES.length).toBe(17);
  });

  // R2-3: a v1 study (one in flight at the update); a NEW study identifies through identification v2 (relicIdentify.ts).
  it("a setless blank's v1 study identifies through it, deposits a copy and its first find (offline == live)", () => {
    const token: RelicVaultToken = { id: "sr-1-relic-0", tier: "standard", quality: 0, regionTier: 1, cultureId: "culture-t1-2", source: "shortRange" };
    const s0: GameState = withRelicBlanks(freshState(), [token]);
    expect(s0.relicVault.map((t) => t.id)).toEqual(["sr-1-relic-0"]);
    const started = startV1RelicStudy(s0, token.id);
    expect(started.started).toBe(true);
    const proc = started.next.activeProcesses.find((p) => p.kind === "relicStudy")!;
    const effect = proc.effect as { type: "identifyRelic"; token: RelicVaultToken; studyIndex: number };
    const expected = identifyGeneralRelic(1, "standard", undefined, relicStudySeed(started.next.relicSeed ?? RELIC_DEFAULT_SEED, effect.studyIndex, token.id));
    expect(identifyStudiedRelic(started.next, effect.token, effect.studyIndex)).toBe(expected);
    const span = proc.remainingTicks + 5;
    const offline = tick(span, started.next, () => 0);
    let live = started.next;
    for (let i = 0; i < span; i++) live = economyTick(live, 1, () => 0);
    expect(offline.museumV2.general["1"]?.[expected]).toBe(1);
    expect(offline.relicDiscovered).toContain(expected);
    expect({ m: live.museumV2, d: live.relicDiscovered }).toEqual({ m: offline.museumV2, d: offline.relicDiscovered });
  });
});

describe("R2-2: the grant hook's relic kinds (unused until the tutorial patch)", () => {
  it("a general relic by type and tier, and the first Tier I exceptional piece, with the log line; round-trips a save", () => {
    const s = freshState();
    const r = grant(s, { relics: [{ kind: "general", typeId: "glyphTablet", tier: 1, count: 2 }, { kind: "general", typeId: "heartOfTheArchive", tier: 2, count: 1 }, { kind: "firstExceptional" }] }, "Tutorial complete");
    expect(r.granted).toBe(true);
    expect(r.logLine).toBe("Tutorial complete. Received 2 Tier I Glyph Tablet relics, 1 Tier II Heart of the Archive relic and an exceptional relic.");
    expect(r.next.museumV2.general).toEqual({ "1": { glyphTablet: 2 }, "2": { heartOfTheArchive: 1 } });
    expect(r.next.museumV2.exceptional).toEqual({ "exc-t1-a-p1": 1 });
    expect(r.next.relicDiscovered).toEqual(["glyphTablet", "heartOfTheArchive", "exc-t1-a-p1"]);
    // A second first-exceptional grant takes the next missing piece; once every Tier I piece is held it is refused.
    const r2 = grant(r.next, { relics: [{ kind: "firstExceptional" }] }, "Again");
    expect(r2.next.museumV2.exceptional).toEqual({ "exc-t1-a-p1": 1, "exc-t1-a-p2": 1 });
    expect(canGrant(r2.next, { relics: [{ kind: "firstExceptional" }] })).toEqual({ ok: false, reason: "relicHeld" });
    expect(canGrant(s, { relics: [{ kind: "firstExceptional" }, { kind: "firstExceptional" }, { kind: "firstExceptional" }] })).toEqual({ ok: false, reason: "relicHeld" });
    // Save round trip.
    const loaded = migrate(deserialize(serialize(r2.next, 0)) as SaveFile, 1);
    expect({ m: loaded.museumV2, d: loaded.relicDiscovered }).toEqual({ m: r2.next.museumV2, d: r2.next.relicDiscovered });
  });

  it("refuses an unknown type, a bad tier, a bad count; a relic-only bundle is not empty", () => {
    const s = freshState();
    expect(canGrant(s, { relics: [{ kind: "general", typeId: "nope", tier: 1, count: 1 }] })).toEqual({ ok: false, reason: "unknownRelic" });
    expect(canGrant(s, { relics: [{ kind: "general", typeId: "glyphTablet", tier: 9 as RegionTier, count: 1 }] })).toEqual({ ok: false, reason: "unknownRelic" });
    expect(canGrant(s, { relics: [{ kind: "general", typeId: "glyphTablet", tier: 1, count: 0 }] })).toEqual({ ok: false, reason: "badAmount" });
    expect(canGrant(s, { relics: [] })).toEqual({ ok: false, reason: "empty" });
    expect(canGrant(s, { relics: [{ kind: "general", typeId: "glyphTablet", tier: 1, count: 1 }] })).toEqual({ ok: true });
    const r = grant(s, { relics: [{ kind: "general", typeId: "nope", tier: 1, count: 1 }] }, "x");
    expect(r.next).toBe(s);
  });
});

describe("R2-2: the wiring registry additions (every registry pin holds them apart)", () => {
  it("the five audit rows, each with its status and owner", () => {
    expect(
      WIRING_REGISTRY.filter((e) => R2_2_ADDED_ENTRY_IDS.has(e.id)).map((e) => `${e.id}|${e.status.kind}|${e.status.kind === "pending" ? e.status.owner : ""}`),
    ).toEqual([
      "relic:audit:blankTiers|pending|G2-6 (the region picker: G2-2 built every tier's candidates, the console offers Tier I until then)",
      "relic:audit:blankCulture|pending|Relics v2 R2-6 (cultures: study points and the name reveal)",
      "relic:audit:shortRangeBlanks|live|",
      "relic:audit:completionBlank|pending|G7 (calls the hook when a planet is fully completed)",
      "relic:audit:generalPick|pending|Relics v2 R2-3 follow-up (retire the v1 setless branch of identifyStudiedRelic: identification v2, relic:audit:identifyV2, studies every new blank, G1-5's short-range blanks included, so no study reaches this pick)",
    ]);
  });
});