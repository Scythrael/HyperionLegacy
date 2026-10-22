// Material Lines ML-4 (0.14.0; plan docs/plans/2026-10-17-material-lines-and-emod-plan.md section 4 ML-4): quality
// carries into crafts. L5 "Toggle, lowest-first default": a per-order "Use best materials" switch. L6 "Weighted
// average + climb": a job stamps the unit-weighted average quality it consumed, floored, and its output lands at
// min(5, carried + the usual quality roll).

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import { REFINE_RECIPES, type GameState } from "./model";
import { economyTick, enqueueOrder, startLine, startProcess } from "./tick";
import { allocatedItem, freeItem } from "./allocation";
import { drawQualityTally, getBucket, itemTotal, removeItemHighestFirst, removeItemLowestFirst } from "./inventory";
import { MAX_MATERIAL_QUALITY, carriedQuality, craftOutputQuality } from "./materialQuality";
import { countedLcg, craftStateQ, lineQ, steppedQ } from "./materialQualityGoldens.fixture";
import { bestMaterialsNote } from "../ui/materialQualityText";

const D = (n: number) => new Decimal(n);
const buckets = (s: GameState, item: string): string[] => (s.inventory[item] ?? []).map((b) => b.toString());
// Draws pinned at 0.999999: the usual quality roll lands Q0, so the output's bucket is the carried quality alone.
const NO_ROLL = () => 0.999999;

describe("ML-4 spending stock (L5)", () => {
  it("highest-first drains the top bucket first and spills down", () => {
    const inv = { ore: [D(5), D(0), D(3), D(4)] };
    expect(removeItemHighestFirst(inv, "ore", D(6)).ore.map(String)).toEqual(["5", "0", "1", "0"]);
    expect(removeItemLowestFirst(inv, "ore", D(6)).ore.map(String)).toEqual(["0", "0", "2", "4"]);
  });

  it("the quality tally walks exactly the buckets each draw takes", () => {
    const inv = { ore: [D(5), D(0), D(3), D(4)] };
    expect(drawQualityTally(inv, "ore", D(6), true).qualityUnits.toString()).toBe(String(4 * 3 + 2 * 2));
    expect(drawQualityTally(inv, "ore", D(6), false).qualityUnits.toString()).toBe(String(5 * 0 + 1 * 2));
    expect(drawQualityTally(inv, "ore", D(6), false).units.toString()).toBe("6");
  });

  it("the switch note reads as the signed-off mockup words it", () => {
    expect(bestMaterialsNote(false)).toBe("Off: lowest quality first, so your good stock is saved.");
    expect(bestMaterialsNote(true)).toBe("Highest quality first. Carries more quality into the output.");
  });
});

describe("ML-4 the carry formula (L6)", () => {
  it("is the unit-weighted average, rounded down", () => {
    expect(carriedQuality({ units: D(4), qualityUnits: D(6) })).toBe(1); // 1.5
    expect(carriedQuality({ units: D(4), qualityUnits: D(8) })).toBe(2); // exactly 2
    expect(carriedQuality({ units: D(0), qualityUnits: D(0) })).toBe(0);
    expect(carriedQuality({ units: D(1), qualityUnits: D(9) })).toBe(MAX_MATERIAL_QUALITY);
  });

  it("adds the usual roll, Q5 at most, and an absent carry is the roll itself", () => {
    expect(craftOutputQuality(undefined, 3)).toBe(3);
    expect(craftOutputQuality(2, 0)).toBe(2);
    expect(craftOutputQuality(2, 1)).toBe(3);
    expect(craftOutputQuality(4, 3)).toBe(MAX_MATERIAL_QUALITY);
  });

  it("a multi-input job stamps the average over every input it consumed", () => {
    const s = craftStateQ({ cobaltOre: [0, 0, 3], titaniumIngot: [1] }, []);
    const r = REFINE_RECIPES.synthCobaltCoil;
    const { next, started } = startProcess(s, "refineJob", r.input, r.durationTicks, { type: "addItem", itemId: r.output.itemId, amount: r.output.amount });
    expect(started).toBe(true);
    // (3 x 2 + 1 x 0) / 4 = 1.5, so Q1.
    expect(next.activeProcesses[0].effect).toMatchObject({ type: "addItem", inputQuality: 1 });
  });

  it("only refine and fabricate jobs that deposit a stackable output stamp; Q0 stock stamps nothing", () => {
    const s = craftStateQ({ commonOre: [40] }, []);
    const r = REFINE_RECIPES.refineCommonOre;
    const q0 = startProcess(s, "refineJob", r.input, r.durationTicks, { type: "addItem", itemId: r.output.itemId, amount: r.output.amount }).next;
    expect("inputQuality" in q0.activeProcesses[0].effect).toBe(false);
    const hi = craftStateQ({ commonOre: [0, 40] }, []);
    const upgrade = startProcess(hi, "facilityUpgrade", { commonOre: D(20) }, 10, { type: "addItem", itemId: "titaniumIngot", amount: D(1) }).next;
    expect("inputQuality" in upgrade.activeProcesses[0].effect).toBe(false);
    const blank = startProcess(hi, "fabricateJob", { commonOre: D(20) }, 10, { type: "addBlank", blueprintKey: "yieldRigBp" }).next;
    expect("inputQuality" in blank.activeProcesses[0].effect).toBe(false);
  });
});

describe("ML-4 crafts", () => {
  it("a lowest-first line on Q2 stock lands its output at Q2 (then the roll)", () => {
    const s0 = lineQ(craftStateQ({ commonOre: [0, 0, 40] }, []), "refine", "refineCommonOre", { kind: "batch", remaining: 2 });
    let s = s0;
    for (let i = 0; i < 40; i++) s = economyTick(s, 1, NO_ROLL);
    expect(buckets(s, "titaniumIngot")).toEqual(["0", "0", "2"]);
  });

  it("a best-first line on mixed stock carries the good stock; lowest-first keeps it", () => {
    const stock = { commonOre: [40, 0, 20] };
    const run = (best: boolean): GameState => {
      const r = startLine(craftStateQ(stock, []), "refine", "refineCommonOre", { kind: "batch", remaining: 1 }, best ? "best" : undefined);
      expect(r.started).toBe(true);
      let s = r.next;
      for (let i = 0; i < 30; i++) s = economyTick(s, 1, NO_ROLL);
      return s;
    };
    const low = run(false);
    expect(buckets(low, "commonOre")).toEqual(["20", "0", "20"]);
    expect(getBucket(low.inventory, "titaniumIngot", 0).toString()).toBe("1");
    const best = run(true);
    expect(buckets(best, "commonOre")).toEqual(["40", "0", "0"]);
    expect(getBucket(best.inventory, "titaniumIngot", 2).toString()).toBe("1");
  });

  it("a best-first line on Q2 stock lands at Q2 or more with the real roll", () => {
    const r = startLine(craftStateQ({ commonOre: [100, 0, 100] }, []), "refine", "refineCommonOre", { kind: "batch", remaining: 5 }, "best");
    const { state } = steppedQ(r.next, 100, 0x77);
    expect(itemTotal(state.inventory, "titaniumIngot").toString()).toBe("5");
    expect(getBucket(state.inventory, "titaniumIngot", 0).toString()).toBe("0");
    expect(getBucket(state.inventory, "titaniumIngot", 1).toString()).toBe("0");
  });

  it("the switch never moves the shared draw count", () => {
    const draws = (best: boolean): number => {
      const r = startLine(craftStateQ({ commonOre: [60, 0, 60] }, []), "refine", "refineCommonOre", { kind: "batch", remaining: 4 }, best ? "best" : undefined);
      const c = countedLcg(0x99);
      let s = r.next;
      for (let i = 0; i < 80; i++) s = economyTick(s, 1, c.rng);
      return c.draws();
    };
    expect(draws(true)).toBe(draws(false));
  });

  it("a job without a carried quality (in flight before ML-4) lands at the roll alone", () => {
    const s0 = craftStateQ({ commonOre: [0, 0, 20] }, []);
    const r = REFINE_RECIPES.refineCommonOre;
    const started = startProcess(s0, "refineJob", r.input, r.durationTicks, { type: "addItem", itemId: r.output.itemId, amount: r.output.amount }).next;
    const legacy: GameState = { ...started, activeProcesses: started.activeProcesses.map((p) => ({ ...p, effect: { type: "addItem", itemId: r.output.itemId, amount: r.output.amount } })) };
    let s = legacy;
    for (let i = 0; i < 20; i++) s = economyTick(s, 1, NO_ROLL);
    expect(buckets(s, "titaniumIngot")).toEqual(["1"]);
  });
});

describe("ML-4 the order switch through lines and the queue", () => {
  it("a line started without the switch carries no field and drains lowest first (unchanged)", () => {
    const s0 = craftStateQ({ commonOre: [20, 20] }, []);
    const r = startLine(s0, "refine", "refineCommonOre", { kind: "batch", remaining: 1 });
    expect("materialPreference" in r.next.refineLines[0]).toBe(false);
    const stepped = economyTick(r.next, 1, NO_ROLL);
    expect(buckets(stepped, "commonOre")).toEqual(["0", "20"]);
  });

  it("the switch rides a queued order onto its promoted line", () => {
    const q = enqueueOrder(craftStateQ({ commonOre: [20, 0, 20] }, []), "refinery", {
      type: "craftLine",
      kind: "refine",
      recipeKey: "refineCommonOre",
      mode: { kind: "batch", remaining: 1 },
      materialPreference: "best",
    });
    expect(q.queued).toBe(true);
    const s = economyTick(q.next, 1, NO_ROLL);
    expect(s.refineLines[0]?.materialPreference).toBe("best");
    expect(buckets(s, "commonOre")).toEqual(["20", "0", "0"]);
    expect(s.activeProcesses[0].effect).toMatchObject({ inputQuality: 2 });
  });

  it("reservation stays total-based: the switch changes no allocation", () => {
    const s0 = craftStateQ({ commonOre: [40, 0, 40] }, []);
    const low = startLine(s0, "refine", "refineCommonOre", { kind: "batch", remaining: 3 }).next;
    const best = startLine(s0, "refine", "refineCommonOre", { kind: "batch", remaining: 3 }, "best").next;
    for (const s of [low, best]) {
      expect(allocatedItem(s.refineLines, s.processQueue, "commonOre", s.craftOrders ?? []).toString()).toBe("60");
      expect(freeItem(s.inventory, s.refineLines, s.processQueue, "commonOre").toString()).toBe("20");
    }
  });
});
