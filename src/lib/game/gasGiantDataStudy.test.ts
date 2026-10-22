// Gas Giant Study GG-5 (plan docs/plans/2026-10-17-gas-giant-study-plan.md section 4 GG-5): the Research Lab's DATA
// STUDY LANE. User calls 8 "Auto when idle" (with a pause toggle), 9 "+12% per boost on the next project of the family,
// D23 stacking; 5% recipe chance", 10 "One lane" (the Ancient Data Fragment decodes the next entry), 12 (20 minutes); the
// signed-off v3 mockup, as drawn: oldest held data first, decode the next entry of the fragment's OWN culture.

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import {
  BLUEPRINTS,
  DRIVE_CLASS_BLUEPRINTS,
  FIELD_KITS_HIDDEN_BLUEPRINTS,
  RESEARCH_FACILITY_KEY,
  RELIC_DEFAULT_SEED,
  blueprintDecodeLocked,
  blueprintResearchable,
  freshState,
  type BlueprintDef,
  type Expedition,
  type ExpeditionFinding,
  type GameState,
} from "./model";
import { canResearch, economyTick, museumResearchDurationTicks, resolveProcesses, startRelicStudy, startResearch, tick } from "./tick";
import { depositExpeditionFindings } from "./expedition";
import { addItemQuality, itemTotal } from "./inventory";
import { ANCIENT_DATA_FRAGMENT_ID, RESEARCH_DATA_ITEM, RESEARCH_FAMILIES, type ResearchFamily } from "./gasGiantContent";
import {
  DATA_STUDY_LANES,
  DATA_STUDY_RECIPE_PERMILLE,
  DATA_STUDY_TICKS,
  RESEARCH_BOOST_PER,
  dataArrivals,
  dataStudiesInFlight,
  dataStudyLaneCount,
  dataStudyRecipeCandidates,
  feedCultureData,
  fragmentCultureOf,
  heldDataQueue,
  legacyFragmentCulture,
  researchBoostSpeed,
  researchFamilyOf,
  rollDataStudyRecipe,
  setDataStudyPaused,
} from "./dataStudy";
import { cultureForBody } from "./relicBlanks";
import { CULTURE_ROSTER } from "./relics";
import { canBuyOvertime } from "./processSpeed";
import { PROSPECTING_BLUEPRINTS } from "./prospecting";

const T0 = 100_000;
const rng = () => 0.5;

// A save at Lab `level` holding `units` of each item in `items` (no arrival entries: held "from before GG-5").
function lab(level = 1, items: Record<string, number> = {}): GameState {
  const base = freshState();
  let inventory = base.inventory;
  for (const [id, n] of Object.entries(items)) inventory = addItemQuality(inventory, id, new Decimal(n), 0);
  return { ...base, gameTimeSeconds: T0, credits: new Decimal(1e12), inventory, facilities: { ...base.facilities, [RESEARCH_FACILITY_KEY]: { level } } };
}
function step(s: GameState, n: number): GameState {
  let out = s;
  for (let i = 0; i < n; i++) out = economyTick(out, 1, rng);
  return out;
}
const held = (s: GameState, id: string) => itemTotal(s.inventory, id).toNumber();
const PROP = RESEARCH_DATA_ITEM.propulsion;
const DEF = RESEARCH_DATA_ITEM.defense;

describe("GG-5 research families (call 9: the six plus Materials and Sensors)", () => {
  const all: BlueprintDef[] = [...Object.values(BLUEPRINTS), ...Object.values(FIELD_KITS_HIDDEN_BLUEPRINTS), ...DRIVE_CLASS_BLUEPRINTS, ...Object.values(PROSPECTING_BLUEPRINTS)];

  it("every blueprint maps to exactly one family", () => {
    for (const bp of all) expect(RESEARCH_FAMILIES, bp.key).toContain(researchFamilyOf(bp));
  });

  it("every family has a blueprint the Lab offers today", () => {
    const seen = new Set(Object.values(BLUEPRINTS).map((bp) => researchFamilyOf(bp)));
    for (const f of RESEARCH_FAMILIES) expect(seen.has(f), f).toBe(true);
  });

  it("reads the output: drives propel, hull unlocks are hull design, a field kit is field gear, a component is materials", () => {
    expect(researchFamilyOf(BLUEPRINTS.balancedDriveBp)).toBe("propulsion");
    expect(researchFamilyOf(BLUEPRINTS.battleshipHullBp)).toBe("hullDesign");
    expect(researchFamilyOf(BLUEPRINTS.firstAidKitBp)).toBe("field");
    expect(researchFamilyOf(BLUEPRINTS.frameSegmentBp)).toBe("materials");
    expect(researchFamilyOf(BLUEPRINTS.plasmaBp)).toBe("weapons");
    expect(researchFamilyOf(BLUEPRINTS.surveyRigBp)).toBe("sensors");
    expect(researchFamilyOf(BLUEPRINTS.balancedEmitterBp)).toBe("defense");
    expect(researchFamilyOf(BLUEPRINTS.balancedCoreBp)).toBe("systems");
  });
});

describe("GG-5 banked boosts (call 9: +12% each, D23 stacking, never capped)", () => {
  it("one boost is exactly +12%; more stack concave and unbounded", () => {
    expect(researchBoostSpeed(0)).toBe(0);
    expect(researchBoostSpeed(1)).toBeCloseTo(RESEARCH_BOOST_PER, 12);
    let prev = 0;
    let prevGain = Infinity;
    for (let n = 1; n <= 40; n++) {
      const v = researchBoostSpeed(n);
      expect(v).toBeGreaterThan(prev);
      expect(v - prev).toBeLessThan(prevGain + 1e-12);
      prevGain = v - prev;
      prev = v;
    }
    expect(researchBoostSpeed(400)).toBeGreaterThan(researchBoostSpeed(100) * 1.5);
  });

  it("the next project of the family uses every banked boost, with the museum's speed, and spends only that family's", () => {
    const key = "balancedDriveBp";
    const ready: GameState = { ...lab(9), researchBoosts: { propulsion: 3, weapons: 1 } };
    const plain = startResearch({ ...ready, researchBoosts: undefined }, key);
    const boosted = startResearch(ready, key);
    expect(boosted.started).toBe(true);
    const ticks = (r: typeof plain) => r.next.activeProcesses[r.next.activeProcesses.length - 1].remainingTicks;
    expect(ticks(boosted)).toBe(museumResearchDurationTicks(ticks(plain), researchBoostSpeed(3)));
    expect(ticks(boosted)).toBeLessThan(ticks(plain));
    expect(boosted.next.researchBoosts).toEqual({ weapons: 1 });
    // The last family's boosts spent: the key goes.
    const last = startResearch({ ...ready, researchBoosts: { propulsion: 1 } }, key);
    expect("researchBoosts" in last.next).toBe(false);
    // No boost of the family: the state and the duration exactly as before.
    const other = startResearch({ ...lab(9), researchBoosts: { weapons: 2 } }, key);
    expect(ticks(other)).toBe(ticks(plain));
    expect(other.next.researchBoosts).toEqual({ weapons: 2 });
  });
});

describe("GG-5 the lane (call 8: auto when idle, with a pause toggle)", () => {
  it("starts the oldest held item at once, studies it for 20 minutes, banks its boost, then the next", () => {
    let s = step(lab(1, { [PROP]: 1, [DEF]: 1 }), 1);
    const running = dataStudiesInFlight(s);
    expect(running).toHaveLength(1);
    expect(running[0].durationTicks).toBe(DATA_STUDY_TICKS);
    expect(running[0].effect).toMatchObject({ type: "studyData", itemId: PROP, studyIndex: 1 });
    expect(held(s, PROP)).toBe(0); // consumed at start
    s = step(s, DATA_STUDY_TICKS);
    expect(s.researchBoosts).toEqual({ propulsion: 1 });
    expect(dataStudiesInFlight(s)[0].effect).toMatchObject({ itemId: DEF, studyIndex: 2 });
    s = step(s, DATA_STUDY_TICKS);
    expect(s.researchBoosts).toEqual({ propulsion: 1, defense: 1 });
    expect(dataStudiesInFlight(s)).toHaveLength(0);
    expect(s.dataStudyIndex).toBe(3);
  });

  it("needs the Lab: no lane at Level 0, one lane from Level I (as drawn)", () => {
    expect(dataStudyLaneCount(lab(0))).toBe(0);
    expect(dataStudyLaneCount(lab(1))).toBe(DATA_STUDY_LANES);
    expect(dataStudyLaneCount(lab(7))).toBe(DATA_STUDY_LANES);
    expect(dataStudiesInFlight(step(lab(0, { [PROP]: 2 }), 5))).toHaveLength(0);
    expect(dataStudiesInFlight(step(lab(3, { [PROP]: 2 }), 5))).toHaveLength(1);
  });

  it("paused: nothing starts, the running study waits; on again it resumes where it was", () => {
    const started = step(lab(1, { [PROP]: 2 }), 100);
    const paused = setDataStudyPaused(started, true);
    expect(paused.dataStudyPaused).toBe(true);
    const later = step(paused, 3 * DATA_STUDY_TICKS);
    expect(dataStudiesInFlight(later)[0].remainingTicks).toBe(dataStudiesInFlight(started)[0].remainingTicks);
    expect(later.researchBoosts).toBeUndefined();
    expect(held(later, PROP)).toBe(1);
    const on = setDataStudyPaused(later, false);
    expect("dataStudyPaused" in on).toBe(false);
    expect(setDataStudyPaused(on, false)).toBe(on);
    const done = step(on, DATA_STUDY_TICKS);
    expect(done.researchBoosts).toEqual({ propulsion: 1 });
    // A paused lane with nothing running starts nothing.
    const idle = setDataStudyPaused(lab(1, { [PROP]: 1 }), true);
    expect(dataStudiesInFlight(step(idle, 10))).toHaveLength(0);
  });

  it("runs beside blueprint research and relic identification (its own lane)", () => {
    let s = lab(9, { [PROP]: 1 });
    // Fill every research slot.
    for (const key of Object.keys(BLUEPRINTS)) {
      const r = startResearch(s, key);
      if (r.reason === "noSlot") break;
      s = r.next;
    }
    const token = { id: "t1", tier: "standard" as const, quality: 0, setId: "precursor" as const, poiId: "ancientRuins" };
    s = startRelicStudy({ ...s, relicVault: [token] }, "t1").next;
    const free = Object.keys(BLUEPRINTS).find((k) => !s.activeProcesses.some((p) => p.effect.type === "unlockBlueprint" && p.effect.key === k))!;
    expect(canResearch(s, free)).toEqual({ ok: false, reason: "noSlot" });
    s = step(s, 1);
    expect(dataStudiesInFlight(s)).toHaveLength(1);
  });

  it("offline == live: one span, two halves and second steps land the same state", () => {
    const start = lab(1, { [PROP]: 2, [ANCIENT_DATA_FRAGMENT_ID]: 1, [RESEARCH_DATA_ITEM.field]: 1 });
    const one = tick(5000, start, rng);
    const halves = tick(2500, tick(2500, start, rng), rng);
    expect(halves).toEqual(one);
    expect(step(start, 5000)).toEqual(one);
  });

  it("Overtime covers a data study (plan GG-5: data studies are research jobs)", () => {
    const s = step(lab(1, { [PROP]: 1 }), 1);
    const p = dataStudiesInFlight(s)[0];
    expect(canBuyOvertime(s, { kind: "process", id: p.id }).ok).toBe(true);
  });

  it("Overtime is refused on a paused study (it is not counting down) and offered again once it resumes", () => {
    const s = step(lab(1, { [PROP]: 1 }), 1);
    const p = dataStudiesInFlight(s)[0];
    const paused = setDataStudyPaused(s, true);
    expect(canBuyOvertime(paused, { kind: "process", id: p.id })).toEqual({ ok: false, reason: "paused" });
    expect(canBuyOvertime(setDataStudyPaused(paused, false), { kind: "process", id: p.id }).ok).toBe(true);
  });
});

describe("GG-5 oldest held data first (as drawn)", () => {
  const exp = { id: "expedition-9", seed: 4242, region: { version: 1 as const, tier: 2 as const, enemyTerritory: false, bearing: 0, distanceLy: 500 } } as Pick<Expedition, "id" | "seed" | "region" | "risk">;
  const finding = (id: string, materials: Record<string, number>): ExpeditionFinding => ({ id, source: "study", materials });

  it("a claim appends one arrival entry per unit, in finding order; a fragment carries its body's culture", () => {
    const findings = [finding("expedition-9-find-study-2", { hydrogenCanister: 5, [DEF]: 1, [ANCIENT_DATA_FRAGMENT_ID]: 1 }), finding("expedition-9-find-nebula", { [PROP]: 1 })];
    const s = depositExpeditionFindings(lab(1), findings, exp);
    expect(s.dataStudyHeld).toEqual([{ itemId: DEF }, { itemId: ANCIENT_DATA_FRAGMENT_ID, cultureId: cultureForBody(4242, 2, 2) }, { itemId: PROP }]);
    expect(CULTURE_ROSTER[2]).toContain(s.dataStudyHeld![1].cultureId);
    expect(heldDataQueue(s).map((e) => e.itemId)).toEqual([DEF, ANCIENT_DATA_FRAGMENT_ID, PROP]);
    // No data in the findings: no key.
    expect("dataStudyHeld" in depositExpeditionFindings(lab(1), [finding("x", { hydrogenCanister: 2 })], exp)).toBe(false);
  });

  it("units held with no entry are the oldest; entries the inventory no longer covers are skipped and pruned", () => {
    const s: GameState = { ...lab(1, { [PROP]: 2, [DEF]: 1 }), dataStudyHeld: [{ itemId: RESEARCH_DATA_ITEM.field }, { itemId: PROP }] };
    // Propulsion: 2 held, 1 entry -> 1 with no entry (oldest); Defense: 1 held, none queued; Field: 0 held (skipped).
    expect(heldDataQueue(s).map((e) => e.itemId)).toEqual([PROP, DEF, PROP]);
    const a = step(s, 1);
    expect(dataStudiesInFlight(a)[0].effect).toMatchObject({ itemId: PROP });
    // The stale Field entry was pruned; the Propulsion entry still waits.
    expect(a.dataStudyHeld).toEqual([{ itemId: PROP }]);
    const b = step(a, DATA_STUDY_TICKS);
    expect(dataStudiesInFlight(b)[0].effect).toMatchObject({ itemId: DEF });
    const c = step(b, DATA_STUDY_TICKS);
    expect(dataStudiesInFlight(c)[0].effect).toMatchObject({ itemId: PROP });
    expect("dataStudyHeld" in c).toBe(false);
  });

  it("a fragment of a finding with no body falls back to the legacy hash (deterministic)", () => {
    const c = fragmentCultureOf(exp, { id: "expedition-9-find-3" }, RELIC_DEFAULT_SEED);
    expect(c).toBe(fragmentCultureOf(exp, { id: "expedition-9-find-3" }, RELIC_DEFAULT_SEED));
    expect(dataArrivals([finding("z", { [ANCIENT_DATA_FRAGMENT_ID]: 2 })], undefined, 7)).toHaveLength(2);
  });
});

describe("GG-5 learning a recipe (call 9: 5%)", () => {
  it("rolls deterministically on the study's own stream, near 5% over many studies, never without a candidate", () => {
    let hits = 0;
    for (let i = 1; i <= 8000; i++) {
      const r = rollDataStudyRecipe(RELIC_DEFAULT_SEED, i, ["a", "b", "c"]);
      expect(r).toBe(rollDataStudyRecipe(RELIC_DEFAULT_SEED, i, ["a", "b", "c"]));
      if (r !== null) hits += 1;
      expect(rollDataStudyRecipe(RELIC_DEFAULT_SEED, i, [])).toBeNull();
    }
    expect(Math.abs(hits / 8000 - DATA_STUDY_RECIPE_PERMILLE / 1000)).toBeLessThan(0.01);
  });

  it("candidates: the family's blueprints at or below the Lab's tier, not researched and not in research", () => {
    const view = (level: number, researched: string[] = []) => ({ researchedBlueprints: researched, labTier: level, relicDiscovered: [], ancientDecoded: undefined, activeProcesses: [] });
    const t1 = dataStudyRecipeCandidates(view(1), "propulsion");
    expect(t1.length).toBeGreaterThan(0);
    for (const k of t1) {
      expect(BLUEPRINTS[k].tier).toBeLessThanOrEqual(1);
      expect(researchFamilyOf(BLUEPRINTS[k])).toBe("propulsion");
    }
    expect(dataStudyRecipeCandidates(view(7), "propulsion").length).toBeGreaterThan(t1.length);
    expect(dataStudyRecipeCandidates(view(1, t1), "propulsion")).toEqual([]);
  });

  it("a study whose roll hits grants that blueprint as researched, and its record names it", () => {
    // Find a study index whose recipe roll hits at the default relic seed.
    let index = 1;
    while (rollDataStudyRecipe(RELIC_DEFAULT_SEED, index, ["x"]) === null) index += 1;
    const s: GameState = {
      ...lab(1),
      activeProcesses: [{ id: "proc-1", kind: "dataStudy", remainingTicks: 1, durationTicks: DATA_STUDY_TICKS, effect: { type: "studyData", itemId: PROP, studyIndex: index } }],
      nextProcessId: 2,
    };
    const out = resolveProcesses(s, 1, rng, 5).next;
    const candidates = dataStudyRecipeCandidates({ researchedBlueprints: s.researchedBlueprints, labTier: 1, relicDiscovered: [], ancientDecoded: undefined, activeProcesses: s.activeProcesses }, "propulsion");
    const learned = rollDataStudyRecipe(RELIC_DEFAULT_SEED, index, candidates)!;
    expect(learned).not.toBeNull();
    expect(out.researchedBlueprints).toContain(learned);
    expect(out.researchBoosts).toEqual({ propulsion: 1 });
    expect(out.completionLog[out.completionLog.length - 1]).toMatchObject({ kind: "dataStudy", reward: "blueprint", subjectKey: learned });
  });
});

describe("GG-5 the Ancient Data Fragment (call 10: decodes the next entry of its own culture)", () => {
  it("decodes the culture's next entry and gives it a study point; no boost", () => {
    const cultureId = CULTURE_ROSTER[3][1];
    const s: GameState = { ...lab(1, { [ANCIENT_DATA_FRAGMENT_ID]: 2 }), dataStudyHeld: [{ itemId: ANCIENT_DATA_FRAGMENT_ID, cultureId }, { itemId: ANCIENT_DATA_FRAGMENT_ID, cultureId }] };
    const one = step(s, DATA_STUDY_TICKS + 1);
    expect(one.ancientDecoded).toEqual({ [cultureId]: 1 });
    expect(one.museumV2.cultures[cultureId]).toEqual({ points: 1, finds: {} });
    expect(one.researchBoosts).toBeUndefined();
    const two = step(one, DATA_STUDY_TICKS);
    expect(two.ancientDecoded).toEqual({ [cultureId]: 2 });
    expect(two.museumV2.cultures[cultureId].points).toBe(2);
  });

  it("a fragment held from before GG-5 decodes a culture read off a pure hash", () => {
    const s = step(lab(1, { [ANCIENT_DATA_FRAGMENT_ID]: 1 }), DATA_STUDY_TICKS + 1);
    const c = legacyFragmentCulture(lab(1), 1);
    expect(s.ancientDecoded).toEqual({ [c]: 1 });
  });

  it("the culture seam keeps a culture's finds and every other part of the Museum", () => {
    const m = feedCultureData({ ...freshState().museumV2, cultures: { k: { points: 4, finds: { glyph: 2 } } } }, "k", 1);
    expect(m.cultures.k).toEqual({ points: 5, finds: { glyph: 2 } });
    expect(feedCultureData(m, "new", 1).cultures.new).toEqual({ points: 1, finds: {} });
  });

  it("decoded entries open a decode-gated blueprint (the GG-7 seam), refused as `undecoded` until then", () => {
    const key = "frameSegmentBp";
    const original = BLUEPRINTS[key];
    try {
      BLUEPRINTS[key] = { ...original, requiresDecode: 2 };
      const s = lab(9);
      expect(blueprintDecodeLocked(s, key)).toBe(true);
      expect(canResearch(s, key)).toEqual({ ok: false, reason: "undecoded" });
      expect(blueprintResearchable(s, key)).toBe(false);
      const one = { ...s, ancientDecoded: { a: 1, b: 1 } };
      expect(canResearch(one, key)).toEqual({ ok: false, reason: "undecoded" });
      const two = { ...s, ancientDecoded: { a: 2 } };
      expect(canResearch(two, key)).toEqual({ ok: true });
      expect(blueprintResearchable(two, key)).toBe(true);
    } finally {
      BLUEPRINTS[key] = original;
    }
    // Every blueprint today is ungated.
    for (const k of Object.keys(BLUEPRINTS)) expect(blueprintDecodeLocked(lab(9), k), k).toBe(false);
  });
});

describe("GG-5 byte identity without data", () => {
  it("a save holding no research data steps exactly as before (no new key)", () => {
    const s = lab(1, { commonOre: 5 });
    const after = step(s, 50);
    for (const k of ["dataStudyHeld", "dataStudyIndex", "researchBoosts", "ancientDecoded", "dataStudyPaused"]) expect(k in after, k).toBe(false);
  });

  it("every family's data item banks its own family's boost", () => {
    for (const f of RESEARCH_FAMILIES as readonly ResearchFamily[]) {
      const s = step(lab(1, { [RESEARCH_DATA_ITEM[f]]: 1 }), DATA_STUDY_TICKS + 1);
      expect(s.researchBoosts, f).toEqual({ [f]: 1 });
    }
  });
});
