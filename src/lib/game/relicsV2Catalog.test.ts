// Relics v2 R2-1 (docs/plans/2026-10-17-relics-v2-plan.md section 4 R2-1): the v2 CATALOG, the Museum v2 DATA MODEL
// and the v69 -> v70 MIGRATION step, all dormant. The R2-0 goldens (relicsV2Goldens.test.ts) prove nothing moved.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  emptyMuseumV2,
  freshState,
  generalMuseumRecord,
  museumV2WithGeneral,
  withGeneralMuseumRecord,
  type GameState,
  type RegionTier,
} from "./model";
import {
  CULTURE_ROSTER,
  CULTURE_STUDY_POINTS,
  CULTURES_PER_TIER,
  EXCEPTIONAL_FULL_SET_MULT,
  EXCEPTIONAL_PER_100K,
  EXCEPTIONAL_PER_100K_TIER_I,
  EXCEPTIONAL_PIECE_VALUE,
  EXCEPTIONAL_SET_SIZES,
  EXCEPTIONAL_SETS,
  MUSEUM_STATS,
  RELIC_BAND_ODDS,
  RELIC_BAND_ODDS_ANCHORS,
  RELIC_BANDS,
  RELIC_RARITY_WEIGHTS_BY_TIER,
  RELIC_SETS,
  RELIC_SITE_BIAS_MULT,
  RELIC_SOFT_CAP,
  RELIC_TYPE_STATS,
  RELIC_TYPES,
  RELICS,
  exceptionalSetLetter,
  exceptionalSetsOfTier,
  getExceptionalPieceById,
  getExceptionalSetById,
  getRelicTypeById,
  museumBonuses,
  museumBonusesFromRecord,
  museumTierCurveBonuses,
  relicBandOf,
  relicTypesInBand,
  type MuseumStat,
  type RelicBand,
} from "./relics";
import { deserialize, migrate, serialize, sanitizeV70MuseumV2Counts, withMuseumV2V70, SAVE_VERSION, type SaveFile } from "./save";
import { startRelicStudy } from "./tick";
import { withV1Museum } from "./firstRunsGoldens.fixture";

const TIERS: readonly RegionTier[] = [1, 2, 3, 4, 5, 6, 7];

// ============================================================================
describe("R2-1 catalog: the general pool is today's 17 relics by band (user call 1)", () => {
  it("17 types, the v1 ids, names and flavors in the v1 order, ids unique", () => {
    expect(RELIC_TYPES.map((t) => t.id)).toEqual(RELICS.map((r) => r.id));
    expect(RELIC_TYPES.map((t) => [t.label, t.flavor])).toEqual(RELICS.map((r) => [r.label, r.flavor]));
    expect(new Set(RELIC_TYPES.map((t) => t.id)).size).toBe(17);
    for (const t of RELIC_TYPES) expect(getRelicTypeById(t.id)).toBe(t);
    expect(getRelicTypeById("nope")).toBeUndefined();
  });

  it("the bands are 4 / 5 / 4 / 4 (standard / augmented / stellar / radiant), every band non-empty", () => {
    expect(RELIC_BANDS.map((b) => relicTypesInBand(b).length)).toEqual([4, 5, 4, 4]);
    expect(relicTypesInBand("standard").map((t) => t.id)).toEqual(["glyphTablet", "hullRivet", "sporeCapsule", "geodeCore"]);
    expect(relicTypesInBand("radiant").map((t) => t.id)).toEqual(["heartOfTheArchive", "captainsSigil", "livingCrystal", "tectonicKeystone"]);
  });

  it("weights are positive integers; the site bias doubles (user call 17)", () => {
    for (const t of RELIC_TYPES) {
      expect(Number.isInteger(t.weight)).toBe(true);
      expect(t.weight).toBeGreaterThan(0);
    }
    expect(RELIC_SITE_BIAS_MULT).toBe(2);
  });

  it("every type's stats are Museum stats, shares sum to 1, and all 14 Museum stats are fed", () => {
    const fed = new Set<MuseumStat>();
    for (const t of RELIC_TYPES) {
      expect(t.stats.length).toBeGreaterThan(0);
      expect(t.stats.reduce((a, s) => a + s.share, 0)).toBeCloseTo(1, 12);
      for (const s of t.stats) {
        expect(MUSEUM_STATS).toContain(s.stat);
        fed.add(s.stat);
      }
    }
    expect([...fed].sort()).toEqual([...MUSEUM_STATS].sort());
  });

  it("RELIC_TYPE_STATS (user-approved 2026-10-20) is the plan's rule: index 1 = the set's per-copy stat, index k = its k-piece stat", () => {
    const rule: Record<string, { stat: MuseumStat; share: number }[]> = {};
    for (const set of RELIC_SETS) {
      set.relicIds.forEach((id, i) => {
        if (i === 0) rule[id] = [{ stat: set.perCopyStat, share: 1 }];
        else {
          const tier = set.tiers.find((t) => t.pieces === i + 1)!;
          rule[id] = tier.stats.map((stat) => ({ stat, share: 1 / tier.stats.length }));
        }
      });
    }
    expect(RELIC_TYPE_STATS).toEqual(rule);
    // Each type keeps its old set for the site bias.
    for (const t of RELIC_TYPES) expect(RELIC_SETS.find((s) => s.id === t.siteSet)!.relicIds).toContain(t.id);
  });

  it("a blank's band folds its rarity the way identifyRelic does", () => {
    expect(relicBandOf("derelict")).toBe("standard");
    expect(relicBandOf("standard")).toBe("standard");
    expect(relicBandOf("augmented")).toBe("augmented");
    expect(relicBandOf("stellar")).toBe("stellar");
    expect(relicBandOf("radiant")).toBe("radiant");
    expect(relicBandOf("luminous")).toBe("radiant");
    expect(relicBandOf("constellar")).toBe("radiant");
  });
});

// ============================================================================
describe("R2-1 catalog: band odds per region tier (user call 13: better rarity only)", () => {
  const row = (tier: RegionTier, blank: RelicBand) => RELIC_BAND_ODDS[tier][blank];
  const asList = (r: Readonly<Record<RelicBand, number>>) => RELIC_BANDS.map((b) => r[b]);

  it("Tier I is today's identification skew exactly", () => {
    for (const blank of RELIC_BANDS) {
      const w = RELIC_RARITY_WEIGHTS_BY_TIER[blank];
      expect(asList(row(1, blank))).toEqual([w.common, w.uncommon, w.rare, w.capstone]);
    }
  });

  it("Tiers IV and VII are the anchor rows; the plan's given rows are exact", () => {
    for (const blank of RELIC_BANDS) {
      expect(asList(row(4, blank))).toEqual([...RELIC_BAND_ODDS_ANCHORS[4][blank]]);
      expect(asList(row(7, blank))).toEqual([...RELIC_BAND_ODDS_ANCHORS[7][blank]]);
    }
    expect(asList(row(4, "standard"))).toEqual([40, 35, 18, 7]);
    expect(asList(row(7, "standard"))).toEqual([20, 35, 28, 17]);
    expect(asList(row(7, "radiant"))).toEqual([0, 10, 40, 50]);
  });

  it("the tiers between interpolate linearly, rounded (Tier II standard 53 / 32 / 12 / 3)", () => {
    expect(asList(row(2, "standard"))).toEqual([53, 32, 12, 3]);
    expect(asList(row(3, "standard"))).toEqual([47, 33, 15, 5]);
    expect(asList(row(5, "standard"))).toEqual([33, 35, 21, 10]);
    expect(asList(row(6, "standard"))).toEqual([27, 35, 25, 14]);
  });

  it("every row is non-negative integers with a positive total; the radiant share never falls and the standard share never rises up the tiers", () => {
    for (const blank of RELIC_BANDS) {
      let lastRadiant = -1;
      let lastStandard = 2;
      for (const tier of TIERS) {
        const list = asList(row(tier, blank));
        const total = list.reduce((a, b) => a + b, 0);
        expect(total).toBeGreaterThan(0);
        for (const w of list) {
          expect(Number.isInteger(w)).toBe(true);
          expect(w).toBeGreaterThanOrEqual(0);
        }
        expect(list[3] / total).toBeGreaterThanOrEqual(lastRadiant);
        expect(list[0] / total).toBeLessThanOrEqual(lastStandard);
        lastRadiant = list[3] / total;
        lastStandard = list[0] / total;
      }
    }
  });
});

// ============================================================================
describe("R2-1 catalog: exceptional relics (user calls 5, 6, 7)", () => {
  it("odds: Tier I 0.25% to 1.5% per 100,000, x1.25 per tier, integers", () => {
    expect(EXCEPTIONAL_PER_100K_TIER_I).toEqual({ standard: 250, augmented: 500, stellar: 1000, radiant: 1500 });
    expect(EXCEPTIONAL_PER_100K[1]).toEqual(EXCEPTIONAL_PER_100K_TIER_I);
    expect(EXCEPTIONAL_PER_100K[2]).toEqual({ standard: 313, augmented: 625, stellar: 1250, radiant: 1875 });
    expect(EXCEPTIONAL_PER_100K[7]).toEqual({ standard: 954, augmented: 1907, stellar: 3815, radiant: 5722 });
    for (const tier of TIERS) {
      for (const band of RELIC_BANDS) {
        expect(Number.isInteger(EXCEPTIONAL_PER_100K[tier][band])).toBe(true);
        if (tier > 1) expect(EXCEPTIONAL_PER_100K[tier][band]).toBeGreaterThan(EXCEPTIONAL_PER_100K[(tier - 1) as RegionTier][band]);
      }
    }
  });

  it("growing sets: 14 sets, 54 pieces, I one of 2 ... VII three of 5", () => {
    expect(EXCEPTIONAL_SET_SIZES).toEqual({ 1: [2], 2: [3], 3: [3, 3], 4: [4, 4], 5: [4, 4], 6: [4, 4, 4], 7: [5, 5, 5] });
    expect(EXCEPTIONAL_SETS).toHaveLength(14);
    expect(EXCEPTIONAL_SETS.reduce((n, s) => n + s.pieces.length, 0)).toBe(54);
    for (const tier of TIERS) expect(exceptionalSetsOfTier(tier).map((s) => s.pieces.length)).toEqual([...EXCEPTIONAL_SET_SIZES[tier]]);
  });

  it("stable ids, unique across sets, pieces and general types; lookups resolve", () => {
    const ids = [...EXCEPTIONAL_SETS.map((s) => s.id), ...EXCEPTIONAL_SETS.flatMap((s) => s.pieces.map((p) => p.id)), ...RELIC_TYPES.map((t) => t.id)];
    expect(new Set(ids).size).toBe(ids.length);
    expect(EXCEPTIONAL_SETS[0].id).toBe("exc-t1-a");
    expect(EXCEPTIONAL_SETS[0].pieces.map((p) => p.id)).toEqual(["exc-t1-a-p1", "exc-t1-a-p2"]);
    expect(EXCEPTIONAL_SETS.at(-1)!.id).toBe("exc-t7-c");
    for (const set of EXCEPTIONAL_SETS) {
      expect(getExceptionalSetById(set.id)).toBe(set);
      for (const p of set.pieces) {
        expect(getExceptionalPieceById(p.id)).toBe(p);
        expect(p.setId).toBe(set.id);
      }
    }
  });

  it("set letters are derived: a fourth set in a tier is \"d\", never \"undefined\"; out of range throws", () => {
    expect([0, 1, 2, 3, 25].map(exceptionalSetLetter)).toEqual(["a", "b", "c", "d", "z"]);
    for (const bad of [-1, 26, 1.5, Number.NaN]) expect(() => exceptionalSetLetter(bad)).toThrow();
    for (const set of EXCEPTIONAL_SETS) {
      expect(set.id).toMatch(/^exc-t[1-7]-[a-z]$/);
      for (const p of set.pieces) expect(p.id).not.toContain("undefined");
    }
  });

  // MOVED by R2-5 (the user's 2026-11-13 "Approve all" on the name sheet): the labels were [PROPOSAL] placeholders until
  // the sign-off; every name, flavor line and stat now reads exactly as the approved sheet has it (Part A, then the
  // approved homage lines for the Keelsong and Ember Court sets, with the Ember Court Banner renamed the Teapot). Read
  // from the sheet itself, so the catalog cannot drift from what the user approved.
  it("every name, flavor line and stat is the approved sheet's (R2-5; no invented content)", () => {
    const sheet = readFileSync("docs/plans/2026-11-02-relic-name-sheets-DRAFT.md", "utf8").split("\r").join("");
    const homageAt = sheet.indexOf("## HOMAGE DRAFT");
    const partA = sheet.slice(sheet.indexOf("## Part A"), sheet.indexOf("## Part B"));
    const rows = new Map<string, { name: string; stat: string; flavor: string }>();
    for (const m of partA.matchAll(/^\| (exc-t\d-[a-z](?:-p\d)?) \| ([^|]+) \| ([^|]+) \| (.+) \|$/gm)) {
      rows.set(m[1], { name: m[2].trim(), stat: m[3].trim().replace(/^full set: /, ""), flavor: m[4].trim() });
    }
    const homage = sheet.slice(homageAt, sheet.indexOf("### USER ANSWERS (2026-11-13) on the homage drafts"));
    for (const m of homage.matchAll(/^\| (exc-t\d-[a-z](?:-p\d)?) \| ([^|]+) \| (.+) \|$/gm)) rows.get(m[1])!.flavor = m[3].trim();
    // FINAL Ember Court: the Banner becomes the Teapot with its approved line (same id and stat).
    const teapot = /\*\*Ember Court Teapot\*\* \(stat crewBonuses, same id\): "([^"]+)"/.exec(sheet.replace(/\n {2}/g, " "))!;
    rows.set("exc-t5-b-p1", { name: "Ember Court Teapot", stat: "crewBonuses", flavor: teapot[1] });
    expect(rows.size).toBe(14 + 54);
    // MOVED by the four theme-matched stat swaps (user 2026-11-13 "Approve the 4 swaps"): the stat is the APPROVED table's
    // proposed column (its "current" column is Part A's, checked to agree).
    const approved = sheet.slice(sheet.indexOf("## APPROVED (2026-11-13): theme-matched piece stats"));
    let swapped = 0;
    for (const m of approved.matchAll(/^\| (exc-t\d-[a-z](?:-p\d)?) \| [^|]+ \| ([^|]+) \| ([^|]+) \| .+ \|$/gm)) {
      const row = rows.get(m[1])!;
      expect(m[2].trim(), m[1]).toBe(row.stat);
      const next = m[3].trim().replace(/\*/g, "");
      if (next !== row.stat) swapped++;
      row.stat = next;
    }
    expect(swapped).toBe(4 + 2); // four pieces and the two full sets that follow them
    for (const set of EXCEPTIONAL_SETS) {
      expect({ name: set.label, stat: set.fullSet[0].stat, flavor: set.flavor }).toEqual(rows.get(set.id));
      for (const p of set.pieces) expect({ name: p.label, stat: p.stat, flavor: p.flavor }).toEqual(rows.get(p.id));
    }
    for (const text of EXCEPTIONAL_SETS.flatMap((s) => [s.label, s.flavor, ...s.pieces.flatMap((p) => [p.label, p.flavor])])) {
      expect(text).not.toMatch(/PROPOSAL|—|--/);
    }
  });

  it("the approved values (2026-10-20): a piece is +3% at Tier I rising to +15% at Tier VII; a full set is five pieces; every stat a Museum stat, all 14 fed", () => {
    expect(EXCEPTIONAL_PIECE_VALUE).toEqual({ 1: 0.03, 2: 0.05, 3: 0.07, 4: 0.09, 5: 0.11, 6: 0.13, 7: 0.15 });
    const fed = new Set<MuseumStat>();
    for (const set of EXCEPTIONAL_SETS) {
      for (const p of set.pieces) {
        expect(p.value).toBe(EXCEPTIONAL_PIECE_VALUE[set.tier]);
        expect(MUSEUM_STATS).toContain(p.stat);
        fed.add(p.stat);
      }
      expect(set.fullSet).toEqual([{ stat: set.pieces[0].stat, value: EXCEPTIONAL_PIECE_VALUE[set.tier] * EXCEPTIONAL_FULL_SET_MULT }]);
    }
    expect(fed.size).toBe(MUSEUM_STATS.length);
  });
});

// ============================================================================
describe("R2-1 catalog: soft cap and cultures (user calls 3, 9, 10)", () => {
  it("the soft cap is 1000 per tier; a culture is named at 10 study points", () => {
    expect(RELIC_SOFT_CAP).toBe(1000);
    expect(CULTURE_STUDY_POINTS).toBe(10);
  });

  it("42 cultures, 6 per tier, stable placeholder ids only (the names await the sign-off sheet)", () => {
    expect(CULTURES_PER_TIER).toBe(6);
    const all = TIERS.flatMap((t) => CULTURE_ROSTER[t]);
    expect(all).toHaveLength(42);
    expect(new Set(all).size).toBe(42);
    for (const t of TIERS) for (const id of CULTURE_ROSTER[t]) expect(id).toMatch(new RegExp(`^culture-t${t}-[1-6]$`));
  });
});

// ============================================================================
describe("R2-1 data model: the Museum v2 record", () => {
  it("freshState seeds the empty record in the v1 museum's key position", () => {
    const s = freshState();
    expect(s.museumV2).toEqual({ general: {}, exceptional: {}, frozen: {}, cultures: {}, culturesNamed: [], setsCompleted: [] });
    expect("relicMuseum" in s).toBe(false);
    const keys = Object.keys(s);
    expect(keys[keys.indexOf("museumV2") - 1]).toBe("relicVault");
    expect(keys[keys.indexOf("museumV2") + 1]).toBe("relicDiscovered");
    expect(emptyMuseumV2()).not.toBe(emptyMuseumV2()); // a new object every call
  });

  it("generalMuseumRecord reads Tier I by default; an absent record or tier reads empty", () => {
    const s = withGeneralMuseumRecord(freshState(), { hullRivet: 2 });
    expect(generalMuseumRecord(s)).toEqual({ hullRivet: 2 });
    expect(generalMuseumRecord(s, 3)).toEqual({});
    expect(generalMuseumRecord({})).toEqual({});
    expect(generalMuseumRecord(withGeneralMuseumRecord(s, { geodeCore: 5 }, 4), 4)).toEqual({ geodeCore: 5 });
  });

  it("museumV2WithGeneral keeps every other tier and part, copies the record, and keeps key positions", () => {
    const base = { ...emptyMuseumV2(), general: { "2": { geodeCore: 1 } }, exceptional: { "exc-t1-a-p1": 1 }, culturesNamed: ["culture-t1-1"] };
    const rec = { hullRivet: 3 };
    const out = museumV2WithGeneral(base, rec);
    expect(out).toEqual({ ...base, general: { "2": { geodeCore: 1 }, "1": { hullRivet: 3 } } });
    expect(out.general["1"]).not.toBe(rec);
    expect(Object.keys(out)).toEqual(Object.keys(base));
    expect(museumV2WithGeneral(undefined, rec)).toEqual({ ...emptyMuseumV2(), general: { "1": { hullRivet: 3 } } });
  });

  it("museumBonuses reads the Tier I general record through the v1 math", () => {
    const rec = { glyphTablet: 45, resonanceShard: 41, starChartFragment: 22, precursorLens: 18, geodeCore: 10, magmaPearl: 10 };
    expect(museumBonuses(withGeneralMuseumRecord(freshState(), rec))).toEqual(museumBonusesFromRecord(rec));
    // R2-4 (moved on purpose): copies at another tier count through that tier's D23 curve (museum math v2).
    expect(museumBonuses(withGeneralMuseumRecord(freshState(), rec, 2))).toEqual(museumTierCurveBonuses(rec, 2));
  });
});

// ============================================================================
describe("R2-1 migration: MIGRATIONS[69] moves the v1 museum into museumV2.general[\"1\"]", () => {
  const V1_MUSEUM = { glyphTablet: 12, resonanceShard: 11, hullRivet: 3, geodeCore: 1 };
  const ENTROPY = 0x13572468;
  const asV69 = (s: GameState): SaveFile => ({ ...(deserialize(serialize(withV1Museum(s), 0)) as SaveFile), version: 69 });

  it("SAVE_VERSION stays 70", () => {
    expect(SAVE_VERSION).toBe(72); // E5-1 took v71 (the board evacuation stamp); this feature added no bump; the Standard-Issue crew modules took v72
  });

  it("the museum moves, relicMuseum is gone, the registry, vault and in-flight study are untouched, the bonuses identical", () => {
    const held = startRelicStudy(
      {
        ...withGeneralMuseumRecord(freshState(), V1_MUSEUM),
        relicVault: [
          { id: "t-a", tier: "stellar", quality: 3, setId: "xenobiology", poiId: "xenoFloraBloom" },
          { id: "t-b", tier: "standard", quality: 1, setId: "precursor", poiId: "ancientRuins" },
        ],
        relicDiscovered: ["glyphTablet", "resonanceShard", "hullRivet", "geodeCore"],
      },
      "t-a",
    ).next;
    const save = asV69(held);
    expect((save.state as unknown as Record<string, unknown>).relicMuseum).toEqual(V1_MUSEUM);
    expect("museumV2" in save.state).toBe(false);
    const m = migrate(save, ENTROPY);
    expect("relicMuseum" in m).toBe(false);
    expect(m.museumV2).toEqual({ ...emptyMuseumV2(), general: { "1": V1_MUSEUM } });
    expect(m.relicDiscovered).toEqual(["glyphTablet", "resonanceShard", "hullRivet", "geodeCore"]);
    expect(m.relicVault).toEqual(held.relicVault);
    expect(m.activeProcesses.filter((p) => p.kind === "relicStudy")).toEqual(held.activeProcesses.filter((p) => p.kind === "relicStudy"));
    expect(museumBonuses(m)).toEqual(museumBonusesFromRecord(V1_MUSEUM));
  });

  it("fresh == migrated: a save with no relics lands on freshState's record, in the same key position", () => {
    const m = migrate(asV69(freshState()), ENTROPY);
    expect(m.museumV2).toEqual(freshState().museumV2);
    const keys = Object.keys(m);
    expect(keys.filter((k) => k === "museumV2" || k === "relicMuseum")).toEqual(["museumV2"]);
    expect(keys[keys.indexOf("museumV2") - 1]).toBe("relicVault");
    expect(keys[keys.indexOf("museumV2") + 1]).toBe("relicDiscovered");
  });

  it("idempotent: the step's own output is returned as the same reference; a fresh state too", () => {
    const once = withMuseumV2V70({ a: 1, relicMuseum: { hullRivet: 2 }, b: 2 });
    expect(once).toEqual({ a: 1, museumV2: { ...emptyMuseumV2(), general: { "1": { hullRivet: 2 } } }, b: 2 });
    expect(Object.keys(once)).toEqual(["a", "museumV2", "b"]);
    expect(withMuseumV2V70(once)).toBe(once);
    const fresh = freshState();
    expect(withMuseumV2V70(fresh)).toBe(fresh);
  });

  it("every load: a save ALREADY at v70 that still holds the v1 museum (a build before R2-1) moves it too", () => {
    const s = asV69(withGeneralMuseumRecord(freshState(), { hullRivet: 4 }));
    const m = migrate({ ...s, version: 70 }, ENTROPY);
    expect("relicMuseum" in m).toBe(false);
    expect(generalMuseumRecord(m)).toEqual({ hullRivet: 4 });
  });

  it("every load sanitizes the counts inside a loaded museumV2 to non-negative integers; a clean record is the same reference", () => {
    const dirty = {
      ...emptyMuseumV2(),
      general: { "1": { hullRivet: 2.9, geodeCore: -1, sporeCapsule: Number.NaN, glyphTablet: 0, x: "3" }, "2": 7, "3": { magmaPearl: 4 } },
      frozen: { "1": { hullRivet: Infinity } },
      exceptional: { "exc-t1-a-p1": 1.5, "exc-t1-a-p2": -2 },
      cultures: { "culture-t1-1": { points: 3.7, finds: { hullRivet: 1, geodeCore: -3 } }, "culture-t1-2": { points: -1, finds: [] }, bad: 5 },
    };
    const cleaned = sanitizeV70MuseumV2Counts(dirty);
    expect(cleaned).toEqual({
      ...emptyMuseumV2(),
      general: { "1": { hullRivet: 2, glyphTablet: 0 }, "3": { magmaPearl: 4 } },
      frozen: { "1": {} },
      exceptional: { "exc-t1-a-p1": 1 },
      cultures: { "culture-t1-1": { points: 3, finds: { hullRivet: 1 } }, "culture-t1-2": { points: 0, finds: {} } },
    });
    expect(sanitizeV70MuseumV2Counts(cleaned)).toBe(cleaned);
    expect(cleaned.general["3"]).toBe(dirty.general["3"]); // a clean tier keeps its reference
    // Through the step and through a real load (a v70 save, the every-load call).
    const s = { ...freshState(), museumV2: dirty } as unknown as GameState;
    const stepped = withMuseumV2V70(s);
    expect(stepped.museumV2).toEqual(cleaned);
    expect(Object.keys(stepped)).toEqual(Object.keys(s));
    const loaded = migrate({ ...(deserialize(serialize(s, 0)) as SaveFile), version: 70 }, ENTROPY);
    expect(generalMuseumRecord(loaded)).toEqual({ hullRivet: 2, glyphTablet: 0 });
    expect(loaded.museumV2.exceptional).toEqual({ "exc-t1-a-p1": 1 });
    const fine = withGeneralMuseumRecord(freshState(), { hullRivet: 3 });
    expect(withMuseumV2V70(fine)).toBe(fine);
  });

  it("hardened: junk passes through, bad counts are dropped or floored, a malformed record is replaced, both fields add", () => {
    expect(withMuseumV2V70(null)).toBe(null);
    expect(withMuseumV2V70(7)).toBe(7);
    expect(withMuseumV2V70({ relicMuseum: { a: 2.7, b: -1, c: Number.NaN, d: "5", e: 0 } }).museumV2.general).toEqual({ "1": { a: 2 } });
    expect(withMuseumV2V70({ relicMuseum: [1, 2] }).museumV2).toEqual(emptyMuseumV2());
    expect(withMuseumV2V70({ relicMuseum: {} }).museumV2).toEqual(emptyMuseumV2());
    expect(withMuseumV2V70({ museumV2: { general: [] } }).museumV2).toEqual(emptyMuseumV2());
    const both = withMuseumV2V70({ museumV2: { ...emptyMuseumV2(), general: { "1": { hullRivet: 1 }, "2": { geodeCore: 1 } } }, x: 0, relicMuseum: { hullRivet: 2, sporeCapsule: 1 } });
    expect(both.museumV2.general).toEqual({ "1": { hullRivet: 3, sporeCapsule: 1 }, "2": { geodeCore: 1 } });
    expect(Object.keys(both)).toEqual(["museumV2", "x"]);
  });
});
