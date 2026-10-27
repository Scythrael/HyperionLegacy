// materialLinesDisplay.ts: the Material Lines LEGIBILITY readouts (0.14.0 ML-7; plan
// docs/plans/2026-10-17-material-lines-and-emod-plan.md section 4 ML-7 and the ML-4 carry note's "For ML-7" list).
// The signed-off Refinery mockup (section B of the Relics + Refinery + Modules sheet, user 2026-10-21 "I approve all
// 4 mockups as is"; recorded picks in docs/plans/2026-10-19-merge-batch-answers.md): the Refinery grouped by material
// line (compounds sit with their main raw's line; no "more recipes" note), per-quality stock chips always visible, and
// a craft order's "This order uses" per-quality breakdown with the "Carried quality: average X = QN, then the roll"
// readout. "Use best materials" starts lowest-first every time the form opens (ML-4 built that).
//
// POSTURE: pure presentation, node-testable. NO RULE LIVES HERE. Every quality number is the engine's own walk:
// drawQualityTally / removeItemLowestFirst / removeItemHighestFirst (inventory.ts) and carriedQuality
// (materialQuality.ts), the exact calls startProcess makes, so a readout can never disagree with the job it
// describes (materialLinesDisplay.test.ts starts the real job and compares its stamped inputQuality).

import Decimal from "break_infinity.js";
import { ITEMS, MISSIONS, REFINE_RECIPES, refineRecipeOffered } from "../game/model";
import { QUALITY_TIERS, drawQualityTally, itemTotal, removeItemHighestFirst, removeItemLowestFirst } from "../game/inventory";
import { CARRY_AVERAGE_EPSILON, carriedQuality } from "../game/materialQuality";
import type { IconName } from "./icons";

// ---------------------------------------------------------------------------------------------------------------
// Per-quality stock
// ---------------------------------------------------------------------------------------------------------------

export interface QualityChip {
  quality: number;
  amount: Decimal;
}

// The quality buckets of `item` that hold stock, lowest first (the mockup's "Q0 40 · Q1 6 · Q3 2" chips). Empty
// when nothing is held. Pure.
export function qualityChips(inv: Record<string, Decimal[]>, item: string): QualityChip[] {
  const buckets = inv[item] ?? [];
  const chips: QualityChip[] = [];
  for (let q = 0; q < Math.min(buckets.length, QUALITY_TIERS); q++) {
    if (buckets[q] && buckets[q].gt(0)) chips.push({ quality: q, amount: buckets[q] });
  }
  return chips;
}

// ---------------------------------------------------------------------------------------------------------------
// Refinery material lines
// ---------------------------------------------------------------------------------------------------------------

// One material line as the signed-off mockup draws it: a name, a glyph (existing icons.ts glyphs only), the missions
// its raws come from (MISSIONS keys, so a renamed mission renames here), and the raws that belong to it. A recipe
// joins the line of its MAIN raw (merge-batch pick: "compounds with their main raw's line"), so Cobalt Coil
// (Cobalt Ore + Titanium Ingot) sits under Heavy metals and Photonic Gel (Wafer + Volatile Resin) under Organic.
export interface RefineryLineDef {
  key: string;
  label: string;
  icon: IconName;
  missions: readonly (keyof typeof MISSIONS)[];
  raws: readonly string[];
}

export const REFINERY_LINES: readonly RefineryLineDef[] = [
  { key: "structural", label: "Structural", icon: "ingot", missions: ["shortOreRun"], raws: ["commonOre", "uncommonMaterial", "rareMaterial"] },
  { key: "heavyMetals", label: "Heavy metals", icon: "ore", missions: ["longOreRun", "surveyMineralAnomaly"], raws: ["ferriteOre", "cobaltOre", "osmiumOre", "denseOre"] },
  { key: "recoveredTech", label: "Recovered tech", icon: "salvage", missions: ["salvageWreckage"], raws: ["scrapAlloy", "salvagedCircuitry"] },
  { key: "organic", label: "Organic", icon: "riskFlora", missions: ["forageFlora"], raws: ["fibrousBiomass", "volatileResin", "exoticSporeCluster"] },
  { key: "volatiles", label: "Volatiles", icon: "gasCanister", missions: ["cometIceHarvest"], raws: ["deuteriumIce"] },
];

// The catch-all for a future recipe whose main raw no line names yet, so a new recipe is never hidden by the
// grouping (materialLinesDisplay.test.ts holds every recipe offered today to a named line).
export const OTHER_REFINERY_LINE: RefineryLineDef = { key: "other", label: "Other", icon: "refinery", missions: [], raws: [] };

// An item some refine recipe produces (a refined good), as opposed to a raw.
function isRefineOutput(itemId: string): boolean {
  return Object.values(REFINE_RECIPES).some((r) => r.output.itemId === itemId);
}

// A recipe's main raw: its largest raw input (an input no refine recipe produces); ties keep the recipe's own input
// order. Null when every input is itself refined. Pure.
export function recipeMainRaw(recipeKey: string): string | null {
  const recipe = REFINE_RECIPES[recipeKey];
  if (!recipe) return null;
  let best: string | null = null;
  for (const [itemId, amount] of Object.entries(recipe.input)) {
    if (isRefineOutput(itemId)) continue;
    if (best === null || amount.gt(recipe.input[best])) best = itemId;
  }
  return best;
}

// The line a recipe is listed under. Pure.
export function recipeLine(recipeKey: string): RefineryLineDef {
  const raw = recipeMainRaw(recipeKey);
  return REFINERY_LINES.find((l) => raw !== null && l.raws.includes(raw)) ?? OTHER_REFINERY_LINE;
}

export interface RefineryLineView {
  def: RefineryLineDef;
  // The mission labels the line's raws come from ("Lunar Mine Contract, Survey Mineral Anomaly").
  sources: string;
  // The raws the line's recipes take, in recipe order, each once (refined inputs such as Titanium Ingot are listed
  // under their own recipe's line instead).
  raws: string[];
  recipes: string[];
}

// The Refinery's grouped list: every OFFERED recipe (refineRecipeOffered, the one check the dropdown and the line
// engine read) under its line, lines in the mockup's order, empty lines dropped. Pure.
export function refineryLineViews(): RefineryLineView[] {
  const offered = Object.keys(REFINE_RECIPES).filter(refineRecipeOffered);
  const views: RefineryLineView[] = [];
  for (const def of [...REFINERY_LINES, OTHER_REFINERY_LINE]) {
    const recipes = offered.filter((k) => recipeLine(k).key === def.key);
    if (recipes.length === 0) continue;
    const raws: string[] = [];
    for (const k of recipes) {
      for (const itemId of Object.keys(REFINE_RECIPES[k].input)) {
        if (!isRefineOutput(itemId) && !raws.includes(itemId)) raws.push(itemId);
      }
    }
    const sources = def.missions.map((m) => MISSIONS[m]?.label).filter((l): l is string => typeof l === "string").join(", ");
    views.push({ def, sources, raws, recipes });
  }
  return views;
}

// A recipe row's formula, as the mockup words it: "3 Cobalt Ore + 1 Titanium Ingot into 1". Pure.
export function recipeFormula(recipeKey: string): string {
  const recipe = REFINE_RECIPES[recipeKey];
  if (!recipe) return "";
  const ins = Object.entries(recipe.input).map(([id, n]) => `${n.toString()} ${ITEMS[id]?.label ?? id}`);
  return `${ins.join(" + ")} into ${recipe.output.amount.toString()}`;
}

// ---------------------------------------------------------------------------------------------------------------
// A craft order's quality preview
// ---------------------------------------------------------------------------------------------------------------

export interface OrderInputUse {
  itemId: string;
  need: Decimal;
  // The buckets the order draws, in the order it draws them (lowest first, or highest first with the switch).
  used: QualityChip[];
  // Units the order cannot cover today (it would wait for them): measured against FREE stock when the caller gives
  // it (the configurator's REQUIRES "Free" figure: stock other lines and queued orders have not reserved), else
  // against the stock in hand.
  short: Decimal;
}

export interface OrderQualityPreview {
  inputs: OrderInputUse[];
  // The FIRST run's unit-weighted average quality and its carried quality (what the next job started stamps).
  firstAverage: number;
  firstCarried: number;
  // The carried quality of the last run the stock in hand can cover. Lowest-first only climbs and best-first only
  // falls as stock is used, so those runs all carry a quality between the first and this one.
  lastCarried: number;
  runs: number;
  // True when any input is short (see OrderInputUse.short).
  anyShort: boolean;
}

// The walk of `amount` of `item` from `inv`, bucket by bucket, exactly as removeItemLowestFirst /
// removeItemHighestFirst take it. ⚠️ KEEP IN STEP WITH drawQualityTally and removeItem* (inventory.ts): this is the
// same loop, kept here only because it reports the buckets rather than their sum; the engine-match tests in
// materialLinesDisplay.test.ts fail if the two ever walk differently. Pure.
function walk(inv: Record<string, Decimal[]>, item: string, amount: Decimal, highestFirst: boolean): { used: QualityChip[]; short: Decimal } {
  const buckets = inv[item] ?? [];
  const used: QualityChip[] = [];
  let remaining = amount;
  for (let i = 0; i < buckets.length; i++) {
    if (remaining.lte(0)) break;
    const quality = highestFirst ? buckets.length - 1 - i : i;
    const available = buckets[quality];
    if (!available || available.lte(0)) continue;
    const take = available.gte(remaining) ? remaining : available;
    used.push({ quality, amount: take });
    remaining = remaining.minus(take);
  }
  return { used, short: remaining.gt(0) ? remaining : new Decimal(0) };
}

// One run's tally on `inv`: the same per-input drawQualityTally sum startProcess makes for a refine or stackable
// fabricate job. Pure.
function runTally(inv: Record<string, Decimal[]>, perRun: Record<string, Decimal>, highestFirst: boolean): { units: Decimal; qualityUnits: Decimal } {
  let units = new Decimal(0);
  let qualityUnits = new Decimal(0);
  for (const itemId of Object.keys(perRun)) {
    const t = drawQualityTally(inv, itemId, perRun[itemId], highestFirst);
    units = units.plus(t.units);
    qualityUnits = qualityUnits.plus(t.qualityUnits);
  }
  return { units, qualityUnits };
}

// What an order of `runs` runs of `perRun` would draw from `inv` today, and the quality it carries. Each run is its
// own job (a line starts one job per run), so the carried quality is per run: the first run's is what the next job
// stamps, the last coverable run's bounds the rest. Assumes nothing else draws the same stock meanwhile (another
// running line can shift which buckets are left; the form says so). `free` (optional) is each input's free stock,
// the configurator's REQUIRES "Free" figure, so "short" agrees with the disabled Start button. Pure.
export function orderQualityPreview(
  inv: Record<string, Decimal[]>,
  perRun: Record<string, Decimal>,
  runs: number,
  highestFirst: boolean,
  free?: Readonly<Record<string, Decimal>>
): OrderQualityPreview {
  // The configurator's quantity field can be empty or fractional mid-edit; the buttons read it as at least one run.
  const n = Number.isFinite(runs) ? Math.max(1, Math.floor(runs)) : 1;
  const ids = Object.keys(perRun);
  const inputs: OrderInputUse[] = ids.map((itemId) => {
    const need = perRun[itemId].times(n);
    const w = walk(inv, itemId, need, highestFirst);
    const avail = free?.[itemId];
    const freeShort = avail !== undefined && need.gt(avail) ? need.minus(Decimal.max(avail, 0)) : new Decimal(0);
    return { itemId, need, used: w.used, short: Decimal.max(w.short, freeShort) };
  });
  const first = runTally(inv, perRun, highestFirst);
  const firstAverage = first.units.gt(0) ? first.qualityUnits.div(first.units).toNumber() : 0;
  // The last run the stock in hand covers (never past it: removing more than is held would drive bucket 0 negative
  // and read as a quality drop that lowest-first can never make).
  let coverable = n;
  for (const itemId of ids) {
    if (perRun[itemId].gt(0)) coverable = Math.min(coverable, Math.floor(itemTotal(inv, itemId).div(perRun[itemId]).toNumber()));
  }
  let lastCarried = carriedQuality(first);
  if (coverable > 1) {
    let before = inv;
    for (const itemId of ids) {
      const spent = perRun[itemId].times(coverable - 1);
      before = highestFirst ? removeItemHighestFirst(before, itemId, spent) : removeItemLowestFirst(before, itemId, spent);
    }
    lastCarried = carriedQuality(runTally(before, perRun, highestFirst));
  }
  const anyShort = inputs.some((u) => u.short.gt(0));
  return { inputs, firstAverage, firstCarried: carriedQuality(first), lastCarried, runs: n, anyShort };
}

// The average as the readout prints it: two decimals, rounded DOWN with the engine's own epsilon
// (CARRY_AVERAGE_EPSILON, the one carriedQuality adds before its floor), so the shown figure never rounds up past the
// rung it floors to ("1.99 = Q1", never "2.00 = Q1"). Pure.
export function averageText(avg: number): string {
  return (Math.floor((avg + CARRY_AVERAGE_EPSILON) * 100) / 100).toFixed(2);
}

// The "Carried quality" readout: "average 1.50 = Q1, then the roll". Pure.
export function carriedQualityText(p: Pick<OrderQualityPreview, "firstAverage" | "firstCarried">): string {
  return `average ${averageText(p.firstAverage)} = Q${p.firstCarried}, then the roll`;
}

// The note under the readout when other orders draw the same stock first (the queue's form, or an input another line
// or a queued order holds part of): the readout is worked out as if the order started now.
export const CONTENDED_STOCK_NOTE = "Other orders draw from this stock first, so the carried quality may differ when this order starts.";

// The order form's stock context, from the SAME allocation reads its REQUIRES box shows (freeItem / allocatedItem,
// passed in so this stays free of the allocation module): each input's free stock, and whether other orders draw the
// stock first (the queue's form, or any input partly held by another line or a queued order). Pure.
export function orderStockContext(
  perRun: Record<string, Decimal>,
  freeOf: (itemId: string) => Decimal,
  allocatedOf: (itemId: string) => Decimal,
  queueForm: boolean
): { free: Record<string, Decimal>; contended: boolean } {
  const free: Record<string, Decimal> = {};
  let held = false;
  for (const itemId of Object.keys(perRun)) {
    free[itemId] = freeOf(itemId);
    if (allocatedOf(itemId).gt(0)) held = true;
  }
  return { free, contended: queueForm || held };
}

// The note under it when an order's runs carry different qualities (null when every run carries the same): runs are
// separate jobs, so a long order on mixed stock drifts as it spends. Null too while the order is short: its later
// runs wait for stock that does not exist yet, so no quality can be promised for them. Pure.
export function laterRunsText(p: Pick<OrderQualityPreview, "firstCarried" | "lastCarried" | "runs" | "anyShort">): string | null {
  if (p.anyShort || p.runs <= 1 || p.lastCarried === p.firstCarried) return null;
  return p.lastCarried > p.firstCarried
    ? `Each run carries its own average: later runs climb to Q${p.lastCarried} as the low stock runs out.`
    : `Each run carries its own average: later runs drop to Q${p.lastCarried} as the best stock runs out.`;
}
