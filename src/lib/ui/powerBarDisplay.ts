// powerBarDisplay.ts: E-MOD EM-10 (0.14.0, plan docs/plans/2026-10-17-material-lines-and-emod-plan.md section 4 EM-10).
// The Ship Systems POWER BAR and the MODULES ROW, as the signed-off mockup draws them (Relics, Refinery and Modules
// mockup, section C; user 2026-10-21 "I approve all 4 mockups as is"; picks: ONE power bar with the efficiency cut
// hatched and the surplus shaded, the over-budget flag on this screen, the spec utility as a tile in the Modules row).
//
//   "Power N / M"  N = the NET draw (after power efficiency), M = the output (hull base + Reactor Core + modules)
//   the bar        the net draw filled (warning colored when over), the efficiency cut hatched from the net draw up to
//                  the gross draw, the unused Reactor Core power shaded just below the output mark
//   the legend     Hull base, Reactor Core, Modules (only when a module adds power), Gross draw, Efficiency cut
//   the chip       "N headroom", or "Over budget by N" with the supply percent the next fight runs at (EM-3's
//                  overBudgetNotice().supplyPercent, the one reading the combat stamp freezes)
//
// Every number is read from the engine (shipPower.ts shipPowerBudget / overBudgetNotice, model.ts drive class draw), so
// the bar can never disagree with the install gate or the combat penalty. Pure presentation, node-testable (no Svelte
// harness); no game rules live here.

import type { EquipmentInstance } from "../game/model";
import { driveClassPowerDraw, equipmentStatMods, ftlDriveClass, moduleEffectScale, shipGearSetBonusLines, DRIVE_CLASS_POWER_DRAW_MULT } from "../game/model";
import type { OverBudgetNotice, ShipPowerBudget } from "../game/shipPower";
import { modulePowerOutput, pieceModuleDef } from "../game/shipModules";
import { GEAR_SETS, activeGearSetTiers } from "../game/gearSets";
import { tierNumeral } from "../game/galaxy";
import { CONDITION_FULL, pieceCondition } from "../game/gearWear";

const moduleScaleOf = (p: EquipmentInstance): number => moduleEffectScale(p.rarity, p.quality, p.ascension);

// One legend entry under the bar.
export interface PowerLegendItem {
  label: string;
  value: string;
}

export interface PowerBarView {
  output: number;
  net: number;
  gross: number;
  cut: number; // the efficiency cut: gross minus net (0 with no efficiency aboard)
  surplus: number; // unused Reactor Core power (shipPowerBudget.reactorSurplus)
  over: boolean;
  shortfall: number; // net minus output when over, else 0
  headroom: number; // output minus net when in budget, else 0
  headline: string; // "Power 84 / 130"
  chip: string; // "46 headroom" or "Over budget by 10, 81% strength"
  ariaLabel: string;
  legend: PowerLegendItem[];
  efficiencyText: string;
  // Bar geometry, each a percent of the bar's track (0 to 100).
  usedPct: number;
  cutLeftPct: number;
  cutPct: number;
  surplusLeftPct: number;
  surplusPct: number;
  outputMarkPct: number;
}

// The track is a little longer than the larger of the output and the gross draw (the mockup's 1.05), so the output
// mark and the hatched cut never sit flush on the end. Never zero, so a powerless hull still draws an empty bar.
const TRACK_HEADROOM = 1.05;

function pct(v: number, scale: number): number {
  return Math.max(0, Math.min(100, (v / scale) * 100));
}

// The power bar's view of `budget` (shipPowerBudget) and the ship's over-budget notice (null while in budget). Pure.
export function powerBarView(budget: ShipPowerBudget, notice: OverBudgetNotice | null): PowerBarView {
  const output = budget.output;
  const net = budget.draw;
  const gross = budget.grossDraw;
  const cut = Math.max(0, gross - net);
  const surplus = Math.max(0, budget.reactorSurplus);
  const over = budget.overBudget;
  const shortfall = over ? net - output : 0;
  const headroom = over ? 0 : output - net;
  const scale = Math.max(1, Math.max(output, gross) * TRACK_HEADROOM);
  const legend: PowerLegendItem[] = [
    { label: "Hull base", value: String(budget.baseOutput) },
    { label: "Reactor Core", value: `+${budget.reactorOutput}` },
  ];
  if (budget.moduleOutput > 0) legend.push({ label: "Modules", value: `+${budget.moduleOutput}` });
  legend.push({ label: "Gross draw", value: String(gross) });
  legend.push({ label: "Efficiency cut", value: cut > 0 ? `−${cut}` : "0" });
  const efficiencyText =
    cut > 0
      ? `Power efficiency cuts ${cut} off the draw`
      : budget.efficiency > 0
        ? "The power efficiency aboard is too small to cut a whole point of draw"
        : "No power efficiency aboard (Reactor Overdrive, Power Discipline or Martian crew)";
  // EM-3: the over-budget chip names the shortfall and the strength the ship fights at (the notice's own reading).
  const chip = over && notice !== null ? `${notice.chip}, ${notice.supplyPercent}% strength` : `${headroom} headroom`;
  return {
    output,
    net,
    gross,
    cut,
    surplus,
    over,
    shortfall,
    headroom,
    headline: `Power ${net} / ${output}`,
    chip,
    ariaLabel: `Net draw ${net} of ${output} output`,
    legend,
    efficiencyText,
    usedPct: pct(Math.min(net, scale), scale),
    cutLeftPct: pct(net, scale),
    cutPct: pct(cut, scale),
    surplusLeftPct: pct(output - surplus, scale),
    surplusPct: pct(surplus, scale),
    outputMarkPct: pct(output, scale),
  };
}

// The install compare for a MODULE candidate (EM-10 review): always its two power rows, plus every other sheet row
// whose delta is not zero (a Range row by the floored values it shows). A module's draw or output changes the Reactor
// Core surplus, which the drive rule (crewOverlay.ts gearSheetWithReactorDrive) turns into FTL Speed and Range, so
// those rows must show when they move. Pure.
export const MODULE_COMPARE_POWER_ROWS: ReadonlySet<string> = new Set(["Power Output", "Power Draw"]);
export function moduleCompareKeepsRow(row: { label: string; base: number; fitted: number; kind: "flat" | "pct" | "ly" }): boolean {
  if (MODULE_COMPARE_POWER_ROWS.has(row.label)) return true;
  if (row.kind === "ly") return Math.floor(row.fitted) !== Math.floor(row.base);
  return Math.abs(row.fitted - row.base) >= 1e-9;
}

// A multiplier row's change in points for the compare ("+35 pts", "-0.4 pts", "-0.04 pts"): whole points from 1 point
// up, finer below, so a small real change never reads as "+0 pts". Pure.
export function pointsDeltaText(delta: number): string {
  const pts = delta * 100;
  const a = Math.abs(pts);
  return `${pts > 0 ? "+" : ""}${pts.toFixed(a >= 1 ? 0 : a >= 0.1 ? 1 : 2)} pts`;
}

// A piece's own power draw as the budget counts it: an FTL drive at its drive class (EM-1, P5), every other piece its
// minted draw. Before the ship-wide powerDrawReduction lines (the budget's gross draw nets those). Pure.
export function piecePowerDraw(piece: Pick<EquipmentInstance, "slotType" | "powerDraw" | "blueprintKey">): number {
  return piece.slotType === "ftlDrive" ? driveClassPowerDraw(piece.powerDraw, ftlDriveClass(piece)) : piece.powerDraw;
}

// Drive classes read as Roman numerals through the one shared formatter (galaxy.ts tierNumeral).
export function driveClassNumeral(cls: number): string {
  return tierNumeral(cls);
}

// The FTL Drive tile's draw line (EM-10 "drive class draw on the FTL tile"): "Class I drive · draw 4", and for a
// Class II+ drive the multiplier that set it ("Class II drive · draw 7 (x1.6 per class above I)"). Pure.
export function driveDrawText(piece: Pick<EquipmentInstance, "slotType" | "powerDraw" | "blueprintKey">): string {
  const cls = ftlDriveClass(piece);
  const draw = piecePowerDraw(piece);
  const why = cls > 1 ? ` (x${DRIVE_CLASS_POWER_DRAW_MULT} per class above I)` : "";
  return `Class ${driveClassNumeral(cls)} drive · draw ${draw}${why}`;
}

// How much the power fold takes off the summed per-piece draws (the powerDrawReduction lines, a gear set's included, and
// the fold's clamp at 0), so the per-system draw list says where the rest of the gross draw went. Read from the fold
// itself (model.ts equipmentStatMods), so the strip always sums to the gross draw. Pure.
export function drawReductionTotal(pieces: readonly EquipmentInstance[]): number {
  let sum = 0;
  for (const p of pieces) sum += piecePowerDraw(p);
  return sum - equipmentStatMods(pieces as EquipmentInstance[]).totalPowerDraw;
}

// ============================================================================
// The Modules row
// ============================================================================

// One tile of the Modules row, in slot order: the Spec Utility first (the user's "spec utility as a tile in the
// Modules row"; it shares the hull's moduleSlots, user M1), then every installed module, then the empty slots.
export type ModuleRowTile =
  | { kind: "utility"; piece: EquipmentInstance }
  | { kind: "module"; piece: EquipmentInstance }
  | { kind: "empty"; index: number };

// The row for a ship with `moduleSlots` shared slots and `pieces` installed. `hasSpecUtilitySlot` from
// shipModules.ts hullHasSpecUtilitySlot (the one predicate): on a hull without the slot (the General Freighter) a
// stray utility fills nothing and shows no tile. A save can hold more than the cap (a cap retune); every installed
// piece still shows, and no empty tile is drawn then. Pure.
export function moduleRowTiles(
  pieces: readonly EquipmentInstance[],
  moduleSlots: number,
  hasSpecUtilitySlot: boolean,
): { tiles: ModuleRowTile[]; used: number; slots: number } {
  const tiles: ModuleRowTile[] = [];
  if (hasSpecUtilitySlot) for (const p of pieces) if (p.slotType === "specUtility") tiles.push({ kind: "utility", piece: p });
  for (const p of pieces) if (p.slotType === "module") tiles.push({ kind: "module", piece: p });
  const used = tiles.length;
  for (let i = used; i < moduleSlots; i++) tiles.push({ kind: "empty", index: i });
  return { tiles, used, slots: moduleSlots };
}

// The tile's short sub-line: "draw 8", and for a module that adds power "draw 0 · +8 power" (the mockup's tile), the
// output at this piece's scale exactly as the budget folds it (shipModules.ts modulePowerOutput). Pure.
export function moduleTileDrawText(piece: EquipmentInstance): string {
  const adds = piece.slotType === "module" ? modulePowerOutput([piece], moduleScaleOf) : 0;
  return adds > 0 ? `draw ${piece.powerDraw} · +${adds} power` : `draw ${piece.powerDraw}`;
}

// A piece's condition as a whole percent (gear wear: 100 = pristine), for the tile's condition bar. Pure.
export function pieceConditionPercent(piece: Pick<EquipmentInstance, "condition">): number {
  return Math.round((pieceCondition(piece) / CONDITION_FULL) * 100);
}

// The active MODULE sets on a ship (the Survey Pair), each as the mockup's line under the row: "Survey Pair 2 / 2" and
// what it gives ("+8% scan speed on expeditions."), the bonus read from the set engine at the pieces' scale (model.ts
// shipGearSetBonusLines, the reader the expedition dispatch uses). Empty with no complete module set. Pure.
export function activeModuleSetLines(pieces: readonly EquipmentInstance[]): { chip: string; text: string }[] {
  const tiers = activeGearSetTiers(pieces, "ship", undefined, moduleScaleOf);
  const lines = shipGearSetBonusLines(pieces as EquipmentInstance[]);
  const out: { chip: string; text: string }[] = [];
  for (const set of GEAR_SETS) {
    if (set.moduleSet !== true) continue;
    const tier = tiers.filter((t) => t.setId === set.id).sort((a, b) => b.pieces - a.pieces)[0];
    if (tier === undefined) continue;
    const bonus = Math.round((lines[tier.stat] ?? 0) * 1000) / 10;
    const what = tier.stat === "scanSpeedBonus" ? "scan speed on expeditions" : tier.stat;
    out.push({ chip: `${set.label} ${tier.pieces} / ${tier.pieces}`, text: `+${Number.isInteger(bonus) ? bonus.toFixed(0) : bonus.toFixed(1)}% ${what}.` });
  }
  return out;
}

// The category word on a module tile (the mockup's small caps line): the catalog category, or "Spec utility". Pure.
export function moduleTileCategory(piece: EquipmentInstance): string {
  if (piece.slotType === "specUtility") return "Spec utility";
  const def = pieceModuleDef(piece);
  if (def === undefined) return "Module";
  return def.category.charAt(0).toUpperCase() + def.category.slice(1);
}
