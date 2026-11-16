// Gas Giant Study GG-1 (0.14.0; plan docs/plans/2026-10-17-gas-giant-study-plan.md section 4 GG-1): the content
// layer and its items, DATA ONLY. Pinned here:
//   - the fifteen items (six Gas Storage Canisters, eight research data items, the Ancient Data Fragment): unique,
//     the user's names, a hint and flavor each, the band on every canister and on nothing else
//   - the giant classes (Sudarsky I to V, Ice Giant, Brown Dwarf) and the four nebula kinds: band odds summing to 100,
//     integer weights and mass bands, the display names, and physics spot checks (one Jupiter mass reads Jupiter)
//   - the Deuterium Canister recipe through the real Refinery line, and each canister's Quartermaster sale
//   - the user's "everything wired" rule: every item has a live consumer or a GG-owned reserve, a live source or a
//     pending GG source (kept off the warehouse shelves), and every new registry entry is pinned with its status
//   - the Galileo-Class Probe relabel keeps its id and ratios

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import { BLUEPRINTS, EQUIPMENT_SLOTS, GAS_CANISTER_SELL_VALUE, ITEMS, REFINE_RECIPES, freshState, refineRecipeOffered, type GameState } from "./model";
import {
  ANCIENT_DATA_FRAGMENT_ID,
  DEPTH_FACTOR_EXPONENT,
  DEUTERIUM_BURNING_MILLI_J,
  GAS_CANISTER_IDS,
  GAS_STUDY_SOURCE_OWNER,
  GAS_STUDY_SOURCE_PENDING,
  GAS_STUDY_USES,
  GIANT_CLASSES,
  HYDROGEN_FUSION_MILLI_J,
  ITEM_BANDS,
  JUPITER_DENSITY_G_CM3,
  NEBULA_KINDS,
  RESEARCH_DATA_ITEM,
  RESEARCH_FAMILIES,
  canistersInBand,
  gasStudyItemIds,
  gasStudySourcePending,
  giantClassById,
  giantClassDisplayName,
  giantPhysics,
  nebulaKindById,
  starProgress,
  type BandOdds,
} from "./gasGiantContent";
import { economyTick, startLine } from "./tick";
import { addItemQuality, itemTotal } from "./inventory";
import { sellItem } from "./quartermaster";
import { WIRING_REGISTRY } from "./wiring/registry";
import { GG1_ADDED_ENTRY_IDS } from "./gasStudyGoldens.fixture";
import { DATA_STUDY_ITEM_IDS } from "./dataStudy";
import { effectFieldsOf } from "./wiring/fieldRoles";

const sum = (o: BandOdds): number => ITEM_BANDS.reduce((n, b) => n + o[b], 0);
// An em dash (0x2014), an en dash (0x2013) or a double hyphen: built from code points so this file holds none.
const TEXT_RULES = new RegExp(`${String.fromCharCode(0x2014)}|${String.fromCharCode(0x2013)}|-{2}`);

describe("GG-1 items: the canisters, the research data and the fragment", () => {
  const ids = gasStudyItemIds();

  it("fifteen unique items, each a real ITEMS row in its category, tier 1, with a hint and flavor", () => {
    expect(ids).toHaveLength(15);
    expect(new Set(ids).size).toBe(15);
    for (const id of ids) {
      const def = ITEMS[id];
      expect(def, id).toBeDefined();
      expect(def.category, id).toBe((GAS_CANISTER_IDS as readonly string[]).includes(id) ? "gasCanister" : "researchData");
      expect(def.tier, id).toBe(1);
      expect(def.unlockHint.length, id).toBeGreaterThan(0);
      expect(def.flavor.length, id).toBeGreaterThan(0);
      expect(`${def.label} ${def.unlockHint} ${def.flavor}`, id).not.toMatch(TEXT_RULES);
    }
  });

  it("the user's names: the canister mapping (call 5), the data families (call 9) and the fragment (call 10)", () => {
    expect(GAS_CANISTER_IDS.map((id) => ITEMS[id].label)).toEqual([
      "Hydrogen Canister",
      "Methane Canister",
      "Ammonia Canister",
      "Deuterium Canister",
      "Helium-3 Canister",
      "Antimatter Containment Cell",
    ]);
    expect(RESEARCH_FAMILIES.map((f) => ITEMS[RESEARCH_DATA_ITEM[f]].label)).toEqual([
      "Propulsion Data",
      "Defense Data",
      "Weapons Data",
      "Systems Data",
      "Field Data",
      "Hull Design Data",
      "Materials Data",
      "Sensors Data",
    ]);
    expect(ITEMS[ANCIENT_DATA_FRAGMENT_ID].label).toBe("Ancient Data Fragment");
  });

  it("the bands: 2 Standard, 2 Augmented, 1 Stellar, 1 Radiant, and no other item carries one", () => {
    expect(ITEM_BANDS).toEqual(["standard", "augmented", "stellar", "radiant"]);
    expect(canistersInBand("standard")).toEqual(["hydrogenCanister", "methaneCanister"]);
    expect(canistersInBand("augmented")).toEqual(["ammoniaCanister", "deuteriumCanister"]);
    expect(canistersInBand("stellar")).toEqual(["helium3Canister"]);
    expect(canistersInBand("radiant")).toEqual(["antimatterCell"]);
    for (const [id, def] of Object.entries(ITEMS)) expect(def.band !== undefined, id).toBe(def.category === "gasCanister");
  });

  it("is not seeded into a fresh save", () => {
    const fresh = freshState();
    for (const id of ids) {
      expect(Object.keys(fresh.inventory), id).not.toContain(id);
      expect(fresh.discovered, id).not.toContain(id);
    }
  });
});

describe("GG-1 everything wired: a consumer or a GG reserve, a source or a pending GG source", () => {
  it("every canister sells at the Quartermaster for its value; none is reserved", () => {
    for (const id of GAS_CANISTER_IDS) {
      expect(ITEMS[id].sellValue, id).toBe(GAS_CANISTER_SELL_VALUE[id]);
      expect(ITEMS[id].reserved, id).toBeUndefined();
      const held: GameState = { ...freshState(), inventory: addItemQuality(freshState().inventory, id, new Decimal(3), 0) };
      const r = sellItem(held, id, new Decimal(2));
      expect(r.ok, id).toBe(true);
      if (r.ok) {
        expect(r.credited.toString(), id).toBe(String(2 * GAS_CANISTER_SELL_VALUE[id]));
        expect(itemTotal(r.next.inventory, id).toString(), id).toBe("1");
      }
    }
  });

  // GG-5 built the lab lane and dropped the reserves in the same commit (dataStudy.ts studies every one).
  it("every research data item and the fragment is studied by GG-5's lab lane (no reserve left), not sellable", () => {
    for (const id of [...RESEARCH_FAMILIES.map((f) => RESEARCH_DATA_ITEM[f]), ANCIENT_DATA_FRAGMENT_ID]) {
      expect(ITEMS[id].reserved, id).toBeUndefined();
      expect(DATA_STUDY_ITEM_IDS, id).toContain(id);
      expect(ITEMS[id].sellValue, id).toBeUndefined();
    }
  });

  it("since GG-3 every study item has a source (the ship's study of a gas giant): none waits", () => {
    expect(GAS_STUDY_SOURCE_OWNER).toMatch(/^GG-3 /);
    expect([...GAS_STUDY_SOURCE_PENDING]).toEqual([]);
    for (const id of gasStudyItemIds()) expect(gasStudySourcePending(id), id).toBe(false);
    expect(gasStudySourcePending("commonOre")).toBe(false);
    // The source is the study reward's own registry entry, live since GG-3.
    expect(WIRING_REGISTRY.find((e) => e.id === "expedition:GAS_STUDY_USES:studyReward")?.status).toEqual({ kind: "live" });
  });

  it("every effect field of every class and kind has its pending entry (an unmapped field fails here, never a fallback)", () => {
    for (const [catalog, defs] of [["GIANT_CLASSES", GIANT_CLASSES], ["NEBULA_KINDS", NEBULA_KINDS]] as const) {
      for (const def of defs) {
        for (const field of effectFieldsOf(catalog)) {
          const e = WIRING_REGISTRY.find((w) => w.source.catalog === catalog && w.source.key === `${def.id}:${field}`);
          expect(e, `${catalog} ${def.id} ${field}`).toBeDefined();
          if (e?.status.kind === "pending") expect(e.status.owner, `${catalog} ${def.id} ${field}`).toMatch(/^GG-[2-7] /);
        }
      }
    }
  });

  it("every study use is owned by a GG slice", () => {
    for (const [use, owner] of Object.entries(GAS_STUDY_USES)) expect(owner, use).toMatch(/^GG-[2-7] /);
  });

  // The study uses a built engine slice has taken live (GG-2: the class roll; GG-3: the study reward and the probe
  // dive; GG-4: the nebula sweep, which reads every nebula kind's two fields), and the class fields they read.
  // GG-5: the lab lane, which consumes every research data item (their reserve rows flip live in place).
  // GG-6 review: the user's pickup pause (2026-10-23) is a study use too, live with its probe.
  const BUILT_USES: ReadonlySet<string> = new Set(["classRoll", "studyReward", "probeDive", "nebulaSweep", "labLane", "pickupPause", "canisterRecipes"]);
  const CLASS_FIELD_USE: Readonly<Record<string, string>> = {
    weight: "classRoll",
    massMinMilliJ: "classRoll",
    massMaxMilliJ: "classRoll",
    radiusModel: "probeDive",
    inflation: "probeDive",
    bandOdds: "studyReward",
    itemWeights: "studyReward",
  };
  const builtLive = (e: (typeof WIRING_REGISTRY)[number]): boolean =>
    (e.source.catalog === "GAS_STUDY_USES" && BUILT_USES.has(e.source.key)) ||
    (e.source.catalog === "GIANT_CLASSES" && BUILT_USES.has(CLASS_FIELD_USE[e.source.key.split(":")[1]] ?? "")) ||
    (e.source.catalog === "NEBULA_KINDS" && BUILT_USES.has("nebulaSweep")) ||
    (e.source.catalog === "DATA_STUDY" && e.source.key.startsWith("consume:") && BUILT_USES.has("labLane"));

  it("the registry: GG-1's additions, each with its status (pending on its GG slice, or live for the sale, the recipe and a built slice's)", () => {
    const added = WIRING_REGISTRY.filter((e) => GG1_ADDED_ENTRY_IDS.has(e.id));
    // 6 uses + 7 classes x 7 effect fields + 4 kinds x 2 + 6 sell values + 9 reserves + 1 recipe (the GG-6 pickup pause
    // use is held apart as an engine addition, gasStudyGoldens.fixture.ts GG6_PICKUP_PAUSE_ENTRY_ID)
    expect(added).toHaveLength(6 + 49 + 8 + 6 + 9 + 1);
    for (const e of added) {
      const live = e.source.key.endsWith(":sellValue") || e.source.catalog === "REFINE_RECIPES" || builtLive(e);
      if (live) expect(e.status.kind, e.id).toBe("live");
      else {
        expect(e.status.kind, e.id).toBe("pending");
        if (e.status.kind === "pending") expect(e.status.owner, e.id).toMatch(/^GG-[2-7] /);
      }
    }
  });
});

describe("GG-1 the Deuterium Canister recipe (Deuterium Ice x10)", () => {
  it("is offered, and the real Refinery line consumes exactly its ice and makes one canister", () => {
    const key = "refineDeuteriumCanister";
    const r0 = REFINE_RECIPES[key];
    expect(Object.fromEntries(Object.entries(r0.input).map(([id, n]) => [id, n.toString()]))).toEqual({ deuteriumIce: "10" });
    expect(r0.output.itemId).toBe("deuteriumCanister");
    expect(r0.output.amount.toString()).toBe("1");
    expect(refineRecipeOffered(key)).toBe(true);
    const base = freshState();
    const ready: GameState = { ...base, inventory: addItemQuality(base.inventory, "deuteriumIce", new Decimal(10), 0), facilities: { ...base.facilities, refinery: { level: 1 } } };
    const r = startLine(ready, "refine", key, { kind: "batch", remaining: 1 });
    expect(r.started).toBe(true);
    let s = r.next;
    for (let i = 0; i < r0.durationTicks + 2; i++) s = economyTick(s, 1, () => 0.99);
    expect(itemTotal(s.inventory, "deuteriumIce").toString()).toBe("0");
    expect(itemTotal(s.inventory, "deuteriumCanister").toString()).toBe("1");
    expect(s.discovered).toContain("deuteriumCanister");
  });

  it("the canister sells above the ice it took (no loss on the refine)", () => {
    expect(GAS_CANISTER_SELL_VALUE.deuteriumCanister).toBeGreaterThan(10 * (ITEMS.deuteriumIce.sellValue ?? 0));
  });

  // FR-C lane 1 I1 (user 2026-11-13/14, "Price near input value"): ice to canister to Sell paid about 60x the planned early
  // income (450 cr for 40 cr of ice). The canister now sells for its ice value plus a small refining margin.
  it("the canister sells near the ice it took (input value plus a small margin, never a money run)", () => {
    const iceIn = REFINE_RECIPES.refineDeuteriumCanister.input.deuteriumIce.toNumber() * (ITEMS.deuteriumIce.sellValue ?? 0);
    expect(GAS_CANISTER_SELL_VALUE.deuteriumCanister).toBeLessThanOrEqual(1.5 * iceIn);
    expect(ITEMS.deuteriumCanister.sellValue).toBe(GAS_CANISTER_SELL_VALUE.deuteriumCanister);
  });
});

describe("GG-1 giant classes (call 1: by name + Sudarsky) and nebula kinds (call 2)", () => {
  it("seven classes and four kinds, unique ids, readable by id", () => {
    expect(GIANT_CLASSES.map((c) => c.id)).toEqual(["sudarskyI", "sudarskyII", "sudarskyIII", "sudarskyIV", "sudarskyV", "iceGiant", "brownDwarf"]);
    expect(NEBULA_KINDS.map((k) => k.id)).toEqual(["molecularCloud", "emissionNebula", "planetaryNebula", "supernovaRemnant"]);
    for (const c of GIANT_CLASSES) expect(giantClassById(c.id)).toBe(c);
    for (const k of NEBULA_KINDS) expect(nebulaKindById(k.id)).toBe(k);
  });

  it("shown by name, the Sudarsky numeral after it (never 'Class')", () => {
    expect(GIANT_CLASSES.map(giantClassDisplayName)).toEqual([
      "Ammonia-cloud giant, Sudarsky I",
      "Water-cloud giant, Sudarsky II",
      "Cloudless giant, Sudarsky III",
      "Alkali-metal giant, Sudarsky IV",
      "Silicate-cloud giant, Sudarsky V",
      "Ice giant",
      "Brown dwarf",
    ]);
  });

  it("every class and kind: band odds sum to 100, integer weights, positive item weights; a nebula never rolls Radiant", () => {
    for (const def of [...GIANT_CLASSES, ...NEBULA_KINDS]) {
      expect(sum(def.bandOdds), def.id).toBe(100);
      for (const b of ITEM_BANDS) expect(Number.isInteger(def.bandOdds[b]) && def.bandOdds[b] >= 0, `${def.id} ${b}`).toBe(true);
      for (const id of GAS_CANISTER_IDS) expect(Number.isInteger(def.itemWeights[id]) && def.itemWeights[id] > 0, `${def.id} ${id}`).toBe(true);
      expect(`${def.name} ${def.example} ${def.gases} ${def.feature}`, def.id).not.toMatch(TEXT_RULES);
    }
    for (const k of NEBULA_KINDS) expect(k.bandOdds.radiant, k.id).toBe(0);
    for (const c of GIANT_CLASSES) expect(c.bandOdds.radiant, c.id).toBeGreaterThan(0);
  });

  it("every class: an integer weight and an integer milli-Jupiter mass band; planets stop at the deuterium line", () => {
    for (const c of GIANT_CLASSES) {
      expect(Number.isInteger(c.weight) && c.weight > 0, c.id).toBe(true);
      expect(Number.isInteger(c.massMinMilliJ) && Number.isInteger(c.massMaxMilliJ), c.id).toBe(true);
      expect(c.massMinMilliJ, c.id).toBeLessThan(c.massMaxMilliJ);
      if (c.id === "brownDwarf") {
        expect(c.massMinMilliJ).toBe(DEUTERIUM_BURNING_MILLI_J);
        expect(c.massMaxMilliJ).toBe(HYDROGEN_FUSION_MILLI_J);
      } else expect(c.massMaxMilliJ, c.id).toBeLessThanOrEqual(DEUTERIUM_BURNING_MILLI_J);
    }
  });
});

describe("GG-1 derived physics (pure)", () => {
  const cls = (id: Parameters<typeof giantClassById>[0]) => giantClassById(id)!;

  it("one Jupiter mass on a cold giant reads Jupiter: radius 1, density ~1.33 g/cm3, gravity 1, depth factor 1", () => {
    const p = giantPhysics(cls("sudarskyI"), 1000);
    expect(p.radiusRj).toBeCloseTo(1, 6);
    expect(p.densityGcm3).toBeCloseTo(JUPITER_DENSITY_G_CM3, 6);
    expect(p.densityGcm3).toBeCloseTo(1.33, 2);
    expect(p.gravityRel).toBeCloseTo(1, 6);
    expect(p.depthFactor).toBeCloseTo(1, 6);
  });

  it("Saturn and Neptune land near the real numbers; a brown dwarf shrinks as it gets heavier", () => {
    const saturn = giantPhysics(cls("sudarskyI"), 299);
    expect(saturn.radiusRj).toBeCloseTo(0.84, 2);
    expect(saturn.densityGcm3).toBeGreaterThan(0.6);
    expect(saturn.densityGcm3).toBeLessThan(0.75); // Saturn would float: 0.69
    const neptune = giantPhysics(cls("iceGiant"), 54);
    expect(neptune.radiusRj).toBeGreaterThan(0.34);
    expect(neptune.radiusRj).toBeLessThan(0.37);
    expect(neptune.densityGcm3).toBeGreaterThan(1.4);
    expect(neptune.densityGcm3).toBeLessThan(1.8);
    const light = giantPhysics(cls("brownDwarf"), 13_000);
    const heavy = giantPhysics(cls("brownDwarf"), 75_000);
    expect(light.radiusRj).toBeCloseTo(1, 6);
    expect(heavy.radiusRj).toBeCloseTo(0.8, 6);
    expect(heavy.gravityRel).toBeGreaterThan(light.gravityRel);
  });

  it("heat puffs a hot giant up (lower density at the same mass), and the depth factor is gravity to its exponent", () => {
    const cold = giantPhysics(cls("sudarskyI"), 2000);
    const hot = giantPhysics(cls("sudarskyV"), 2000);
    expect(hot.radiusRj).toBeGreaterThan(cold.radiusRj);
    expect(hot.densityGcm3).toBeLessThan(cold.densityGcm3);
    for (const p of [cold, hot]) expect(p.depthFactor).toBeCloseTo(Math.pow(p.gravityRel, DEPTH_FACTOR_EXPONENT), 9);
  });

  it("how close it got to becoming a star: the 13 and ~78 Jupiter-mass lines", () => {
    expect(starProgress(1000).deuteriumShare).toBeCloseTo(1 / 13, 9);
    expect(starProgress(DEUTERIUM_BURNING_MILLI_J).deuteriumShare).toBe(1);
    expect(starProgress(HYDROGEN_FUSION_MILLI_J).fusionShare).toBe(1);
  });
});

describe("GG-1 the Galileo-Class Probe (the Atmo Probe relabeled, id and ratios kept)", () => {
  it("keeps the id atmoProbe, its gas giant tuning and its ratios; only the names change", () => {
    const v = EQUIPMENT_SLOTS.memberTool.varieties.find((x) => x.key === "atmoProbe");
    expect(v?.label).toBe("Galileo-Class Probe");
    expect(v?.member?.planetTypes).toEqual(["gasGiant"]);
    expect(v?.statRatios).toEqual({ groundFieldwork: 0.6, groundHazardResist: 0.3, groundRelicFind: 0.1 });
    expect(BLUEPRINTS.atmoProbeBp.label).toBe("Galileo-Class Probe Blueprint");
    expect(BLUEPRINTS.atmoProbeBp.equipmentOutput).toEqual({ slotType: "memberTool", varietyKey: "atmoProbe" });
    expect(BLUEPRINTS.atmoProbeBp.flavor).not.toMatch(TEXT_RULES);
  });
});
