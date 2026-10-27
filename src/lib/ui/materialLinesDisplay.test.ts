// Material Lines ML-7 (0.14.0; plan docs/plans/2026-10-17-material-lines-and-emod-plan.md section 4 ML-7): the
// legibility readouts. Display only, so the load-bearing claim is that every number equals what the engine really
// does: the "Carried quality" readout is the stamped inputQuality of the job actually started, and "This order uses"
// is the stock the order actually draws, lowest first and best first, on mixed-quality stock.

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import { MISSIONS, REFINE_RECIPES, refineRecipeOffered, type GameState } from "../game/model";
import { economyTick, startLine } from "../game/tick";
import { lineInputsPerIteration } from "../game/allocation";
import { QUALITY_TIERS, getBucket } from "../game/inventory";
import { craftStateQ } from "../game/materialQualityGoldens.fixture";
import { HELP_TOPICS } from "../helpTopics";
import {
  OTHER_REFINERY_LINE,
  REFINERY_LINES,
  averageText,
  carriedQualityText,
  laterRunsText,
  orderQualityPreview,
  qualityChips,
  recipeFormula,
  recipeLine,
  refineryLineViews,
} from "./materialLinesDisplay";

const D = (n: number) => new Decimal(n);
// The usual quality roll lands Q0, so outputs never feed back into the stock under test.
const NO_ROLL = () => 0.999999;

describe("ML-7 per-quality stock chips", () => {
  it("lists only the buckets that hold stock, lowest first", () => {
    const inv = { ore: [D(40), D(0), D(6), D(0), D(2)] };
    expect(qualityChips(inv, "ore").map((c) => `Q${c.quality} ${c.amount.toString()}`)).toEqual(["Q0 40", "Q2 6", "Q4 2"]);
    expect(qualityChips(inv, "absent")).toEqual([]);
    expect(qualityChips({ ore: [D(0)] }, "ore")).toEqual([]);
  });
});

describe("ML-7 the Refinery grouped by material line", () => {
  const offered = Object.keys(REFINE_RECIPES).filter(refineRecipeOffered);
  const views = refineryLineViews();

  it("lists every offered recipe exactly once, and none falls into the catch-all", () => {
    const listed = views.flatMap((v) => v.recipes);
    expect([...listed].sort()).toEqual([...offered].sort());
    expect(new Set(listed).size).toBe(listed.length);
    expect(views.some((v) => v.def.key === OTHER_REFINERY_LINE.key)).toBe(false);
    expect(offered.length).toBeGreaterThanOrEqual(12); // "2 recipes become 12" (more since ML-2 and GG-1)
  });

  it("keeps the mockup's line order, names and glyphs", () => {
    expect(views.map((v) => v.def.label)).toEqual(["Structural", "Heavy metals", "Recovered tech", "Organic", "Volatiles"]);
    expect(REFINERY_LINES.map((l) => l.icon)).toEqual(["ingot", "ore", "salvage", "riskFlora", "gasCanister"]);
  });

  it("puts each compound with its main raw's line (merge-batch pick)", () => {
    expect(recipeLine("synthCobaltCoil").key).toBe("heavyMetals");
    expect(recipeLine("synthOsmiumPlate").key).toBe("heavyMetals");
    expect(recipeLine("synthPhotonicGel").key).toBe("organic");
    expect(recipeLine("synthBiocatalyst").key).toBe("organic");
    expect(recipeLine("refineCommonOre").key).toBe("structural");
    expect(recipeLine("refineIridiumCatalyst").key).toBe("structural");
    expect(recipeLine("refineReclaimedCircuit").key).toBe("recoveredTech");
    expect(recipeLine("refineDeuteriumCanister").key).toBe("volatiles");
  });

  it("lists a line's raws (not its refined inputs) and names real missions as sources", () => {
    const heavy = views.find((v) => v.def.key === "heavyMetals")!;
    expect(heavy.raws).toEqual(["ferriteOre", "cobaltOre", "osmiumOre"]);
    expect(heavy.sources).toBe(`${MISSIONS.longOreRun.label}, ${MISSIONS.surveyMineralAnomaly.label}`);
    for (const l of REFINERY_LINES) for (const m of l.missions) expect(MISSIONS[m], m).toBeDefined();
  });

  it("words a recipe row as the mockup does", () => {
    expect(recipeFormula("synthCobaltCoil")).toBe("3 Cobalt Ore + 1 Titanium Ingot into 1");
    expect(recipeFormula("refineCommonOre")).toBe("20 Titanium Ore into 1");
  });
});

// Starts the real line, steps it to the end, and records the stamped inputQuality of every job it started (absent =
// 0) plus the stock it drew, bucket by bucket.
function runOrder(stock: Record<string, number[]>, recipeKey: string, runs: number, best: boolean): { stamps: number[]; drawn: Record<string, string[]> } {
  const s0 = craftStateQ(stock, []);
  const r = startLine(s0, "refine", recipeKey, { kind: "batch", remaining: runs }, best ? "best" : undefined);
  expect(r.started).toBe(true);
  const seen = new Map<string, number>();
  let s: GameState = r.next;
  for (let i = 0; i < runs * 40 + 5; i++) {
    s = economyTick(s, 1, NO_ROLL);
    for (const p of s.activeProcesses) {
      if (p.lineId !== undefined && !seen.has(p.id) && p.effect.type === "addItem") seen.set(p.id, p.effect.inputQuality ?? 0);
    }
  }
  const drawn: Record<string, string[]> = {};
  for (const itemId of Object.keys(REFINE_RECIPES[recipeKey].input)) {
    drawn[itemId] = [];
    for (let q = 0; q < QUALITY_TIERS; q++) {
      const d = getBucket(s0.inventory, itemId, q).minus(getBucket(s.inventory, itemId, q));
      if (d.gt(0)) drawn[itemId].push(`Q${q} ${d.toString()}`);
    }
  }
  const stamps = [...seen.entries()].sort((a, b) => Number(a[0].slice(5)) - Number(b[0].slice(5))).map((e) => e[1]);
  return { stamps, drawn };
}

describe("ML-7 the order readout equals what the engine does", () => {
  const cases: { name: string; stock: Record<string, number[]>; recipe: string; runs: number }[] = [
    { name: "one input, mixed stock", stock: { commonOre: [30, 0, 25, 0, 30] }, recipe: "refineCommonOre", runs: 4 },
    { name: "two inputs (a compound), mixed stock", stock: { cobaltOre: [4, 3, 5], titaniumIngot: [1, 0, 0, 3] }, recipe: "synthCobaltCoil", runs: 4 },
    { name: "a single run", stock: { cobaltOre: [2, 0, 4], titaniumIngot: [1, 1] }, recipe: "synthCobaltCoil", runs: 1 },
  ];
  for (const c of cases) {
    for (const best of [false, true]) {
      it(`${c.name}, ${best ? "best first" : "lowest first"}: carried quality and the breakdown match the started jobs`, () => {
        const s0 = craftStateQ(c.stock, []);
        const perRun = lineInputsPerIteration({ id: "", kind: "refine", recipeKey: c.recipe, remaining: 0, mode: { kind: "continuous" } });
        const preview = orderQualityPreview(s0.inventory, perRun, c.runs, best);
        const real = runOrder(c.stock, c.recipe, c.runs, best);
        expect(real.stamps.length).toBe(c.runs);
        // The readout's Carried quality is the first started job's stamp; the last run's bound is the last job's.
        expect(real.stamps[0]).toBe(preview.firstCarried);
        expect(real.stamps[real.stamps.length - 1]).toBe(preview.lastCarried);
        const lo = Math.min(preview.firstCarried, preview.lastCarried);
        const hi = Math.max(preview.firstCarried, preview.lastCarried);
        for (const q of real.stamps) expect(q >= lo && q <= hi).toBe(true);
        // This order uses: exactly the buckets the whole order drew.
        for (const use of preview.inputs) {
          expect(use.short.toString()).toBe("0");
          expect([...use.used].sort((a, b) => a.quality - b.quality).map((u) => `Q${u.quality} ${u.amount.toString()}`)).toEqual(real.drawn[use.itemId]);
        }
      });
    }
  }

  it("draws in the switch's order and flags stock it cannot cover", () => {
    const inv = { commonOre: [D(30), D(0), D(25)] };
    const per = { commonOre: D(20) };
    const low = orderQualityPreview(inv, per, 3, false);
    expect(low.inputs[0].used.map((u) => `Q${u.quality} ${u.amount.toString()}`)).toEqual(["Q0 30", "Q2 25"]);
    expect(low.inputs[0].short.toString()).toBe("5");
    const best = orderQualityPreview(inv, per, 1, true);
    expect(best.inputs[0].used.map((u) => `Q${u.quality} ${u.amount.toString()}`)).toEqual(["Q2 20"]);
    expect(carriedQualityText(best)).toBe("average 2.00 = Q2, then the roll");
  });

  it("reads an empty or fractional quantity field as one run", () => {
    const inv = { commonOre: [D(40)] };
    expect(orderQualityPreview(inv, { commonOre: D(20) }, Number.NaN, false).runs).toBe(1);
    expect(orderQualityPreview(inv, { commonOre: D(20) }, 2.7, false).runs).toBe(2);
  });
});

describe("ML-7 readout words", () => {
  it("prints the average rounded down, so it never shows past its rung", () => {
    expect(averageText(1.996)).toBe("1.99");
    expect(averageText(2)).toBe("2.00");
    expect(averageText(0)).toBe("0.00");
    expect(carriedQualityText({ firstAverage: 1.5, firstCarried: 1 })).toBe("average 1.50 = Q1, then the roll");
  });

  it("notes later runs only when they carry a different quality", () => {
    expect(laterRunsText({ firstCarried: 1, lastCarried: 1, runs: 5 })).toBeNull();
    expect(laterRunsText({ firstCarried: 0, lastCarried: 2, runs: 1 })).toBeNull();
    expect(laterRunsText({ firstCarried: 0, lastCarried: 2, runs: 4 })).toBe("Each run carries its own average: later runs climb to Q2 as the low stock runs out.");
    expect(laterRunsText({ firstCarried: 3, lastCarried: 1, runs: 4 })).toBe("Each run carries its own average: later runs drop to Q1 as the best stock runs out.");
  });
});

describe("ML-7 Help topic", () => {
  it("explains material lines and quality, true to the build", () => {
    const t = HELP_TOPICS.find((x) => x.id === "materialQuality");
    expect(t?.title).toBe("Material lines and quality");
    const b = t!.body;
    for (const l of REFINERY_LINES) expect(b).toContain(l.label);
    expect(b).toContain("Use best materials");
    expect(b).toContain("This order uses");
    expect(b).toContain("Carried quality");
    // The example it gives is the grouping's own answer.
    expect(b).toContain("Cobalt Coil under Heavy metals");
    expect(recipeLine("synthCobaltCoil").label).toBe("Heavy metals");
    // ML-5 is not built: the manual must not promise quality on fabricated equipment.
    expect(b).toContain("Fabricated equipment does not take on the quality of its materials");
    expect(/—|-{2}/.test(b)).toBe(false);
  });
});
