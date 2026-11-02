// E-MOD EM-10 (0.14.0): the Ship Systems Power bar and Modules row view models (powerBarDisplay.ts), the module card's
// "when it acts" line (moduleEffectText.ts) and the Help topic "Power and modules". Every number shown must be the
// engine's: the bar reads shipPowerBudget, the chip reads overBudgetNotice().supplyPercent, the FTL tile reads the drive
// class draw the power fold uses.

import { describe, expect, it } from "vitest";
import { BLUEPRINTS, DRIVE_CLASS_BLUEPRINTS, DRIVE_CLASS_POWER_DRAW_MULT, EQUIPMENT_SLOTS, SHIP_TYPES, equipmentStatMods, freshState, type EquipmentInstance, type GameState } from "../game/model";
import { gearSheetWithReactorDrive } from "../game/crewOverlay";
import { equipmentIcon, equipmentSvgIcon, varietySvgIcon } from "../EquipmentTooltip.svelte";
import { ICON_PATHS } from "./icons";
import { ICON_SEMANTICS } from "./iconPacks";
import { equippedFor, fittedInSlot } from "../game/equipment";
import { overBudgetNotice, shipPowerBudget } from "../game/shipPower";
import { POWER_SUPPLY_FLOOR_PERCENT, powerSupplyPercent } from "../game/combat/power";
import { UNIVERSAL_MODULES, hullHasSpecUtilitySlot, universalModuleDef } from "../game/shipModules";
import { mintTestModule } from "../game/shipModulesTest.fixture";
import { HELP_TOPICS } from "../helpTopics";
import {
  activeModuleSetLines,
  drawReductionTotal,
  driveDrawText,
  moduleCompareKeepsRow,
  moduleRowTiles,
  moduleTileCategory,
  pointsDeltaText,
  moduleTileDrawText,
  pieceConditionPercent,
  piecePowerDraw,
  powerBarView,
} from "./powerBarDisplay";
import { MODULE_CARD_NOTE, moduleWhenText, pieceModuleLines } from "./moduleEffectText";

const SHIP = "ship-1";
const def = (id: string) => universalModuleDef(id)!;
// Put `pieces` aboard SHIP directly (no gate): the over-budget fixture is a state the gate never builds by an install
// (P2: a ship gets there only by losing power), so it is staged by hand.
function aboard(s: GameState, pieces: EquipmentInstance[]): GameState {
  return { ...s, equipment: [...s.equipment, ...pieces.map((p) => ({ ...p, fittedToShipId: SHIP }))] };
}

describe("powerBarView (the signed-off mockup's one bar)", () => {
  it("reads the budget exactly: Power net / output, the legend sums to the output, headroom in budget", () => {
    const s = freshState();
    const b = shipPowerBudget(s, SHIP);
    const v = powerBarView(b, overBudgetNotice(s, SHIP));
    expect(v.headline).toBe(`Power ${b.draw} / ${b.output}`);
    expect(v.over).toBe(false);
    expect(v.chip).toBe(`${b.output - b.draw} headroom`);
    expect(v.legend.map((l) => l.label)).toEqual(["Hull base", "Reactor Core", "Gross draw", "Efficiency cut"]);
    expect(Number(v.legend[0].value) + Number(v.legend[1].value.replace("+", ""))).toBe(b.output);
    expect(v.legend[2].value).toBe(String(b.grossDraw));
    expect(v.cut).toBe(0);
    expect(v.efficiencyText).toMatch(/^No power efficiency aboard/);
    // geometry stays on the track
    for (const n of [v.usedPct, v.cutLeftPct, v.cutPct, v.surplusLeftPct, v.surplusPct, v.outputMarkPct]) {
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(100);
    }
    expect(v.outputMarkPct).toBeLessThan(100);
  });

  it("a power module shows in the legend as Modules and lifts the output", () => {
    const s = aboard(freshState(), [mintTestModule(def("auxiliaryCapacitor"), "standard", 0, "pb-cap")]);
    const b = shipPowerBudget(s, SHIP);
    const v = powerBarView(b, null);
    expect(b.moduleOutput).toBeGreaterThan(0);
    expect(v.legend.find((l) => l.label === "Modules")?.value).toBe(`+${b.moduleOutput}`);
    expect(v.headline).toBe(`Power ${b.draw} / ${b.baseOutput + b.reactorOutput + b.moduleOutput}`);
  });

  it("over budget: the chip names the shortfall and the supply percent the fight runs at (EM-3's reading)", () => {
    const heavy = { ...mintTestModule(def("arcDischarger"), "standard", 0, "pb-heavy"), powerDraw: 400 };
    const s = aboard(freshState(), [heavy]);
    const b = shipPowerBudget(s, SHIP);
    const n = overBudgetNotice(s, SHIP);
    expect(b.overBudget).toBe(true);
    expect(n).not.toBeNull();
    const v = powerBarView(b, n);
    expect(v.over).toBe(true);
    expect(v.shortfall).toBe(b.draw - b.output);
    expect(v.headroom).toBe(0);
    expect(n!.supplyPercent).toBe(powerSupplyPercent(b.output, b.draw));
    expect(v.chip).toBe(`Over budget by ${b.draw - b.output}, ${n!.supplyPercent}% strength`);
    expect(n!.supplyPercent).toBeGreaterThanOrEqual(POWER_SUPPLY_FLOOR_PERCENT);
    // the net draw fills the whole track when it passes the output; the output mark sits inside it
    expect(v.outputMarkPct).toBeLessThan(v.usedPct);
  });

  it("the hatched cut is gross minus net, shaded surplus is the budget's reactor surplus", () => {
    const b = { ...shipPowerBudget(freshState(), SHIP), grossDraw: 60, draw: 50, output: 80, reactorOutput: 30, reactorSurplus: 30 };
    const v = powerBarView(b, null);
    expect(v.cut).toBe(10);
    expect(v.legend.find((l) => l.label === "Efficiency cut")?.value).toBe("−10");
    expect(v.efficiencyText).toBe("Power efficiency cuts 10 off the draw");
    expect(v.surplus).toBe(30);
    expect(v.surplusLeftPct + v.surplusPct).toBeCloseTo(v.outputMarkPct, 9);
    expect(v.cutLeftPct).toBeCloseTo(v.usedPct, 9);
  });
});

describe("the FTL tile's drive class draw", () => {
  it("Class I reads the piece's own draw; Class II and up read the x1.6 per class draw the power fold sums", () => {
    const s = freshState();
    const drive = fittedInSlot(s, SHIP, "ftlDrive")!;
    expect(driveDrawText(drive)).toBe(`Class I drive · draw ${drive.powerDraw}`);
    const classTwo = DRIVE_CLASS_BLUEPRINTS.find((bp) => bp.driveClass === 2)!;
    const classed = { ...drive, id: "pb-c2", blueprintKey: classTwo.key, powerDraw: 5 };
    expect(BLUEPRINTS[classTwo.key]).toBeDefined();
    const draw = piecePowerDraw(classed);
    expect(draw).toBe(Math.ceil(5 * DRIVE_CLASS_POWER_DRAW_MULT - 1e-9));
    expect(draw).toBe(equipmentStatMods([classed]).totalPowerDraw);
    expect(driveDrawText(classed)).toBe(`Class II drive · draw ${draw} (x${DRIVE_CLASS_POWER_DRAW_MULT} per class above I)`);
  });

  it("the per-system draws plus the reductions account for the whole gross draw", () => {
    const s = freshState();
    const pieces = equippedFor(s, SHIP);
    const sum = pieces.reduce((n, p) => n + piecePowerDraw(p), 0);
    expect(Math.max(0, sum - drawReductionTotal(pieces))).toBe(shipPowerBudget(s, SHIP).grossDraw);
  });
});

describe("moduleRowTiles (the Spec Utility first, then modules, then empty slots)", () => {
  it("a specialized hull shows its Spec Utility as the first tile and counts it", () => {
    const util = { ...mintTestModule(def("structuralBracing"), "standard", 0, "pb-u"), slotType: "specUtility" as const };
    const a = mintTestModule(def("arcDischarger"), "standard", 0, "pb-a");
    const row = moduleRowTiles([a, util], 3, true);
    expect(row.tiles.map((t) => t.kind)).toEqual(["utility", "module", "empty"]);
    expect(row.used).toBe(2);
    expect(row.slots).toBe(3);
    expect(moduleTileCategory(util)).toBe("Spec utility");
    expect(moduleTileCategory(a)).toBe("Proc");
  });

  it("the Freighter (no Spec Utility slot) shows no utility tile and keeps its one slot free", () => {
    expect(hullHasSpecUtilitySlot(SHIP_TYPES.generalFreighter.spec)).toBe(false);
    const s = freshState();
    const row = moduleRowTiles(equippedFor(s, SHIP), SHIP_TYPES.generalFreighter.moduleSlots, false);
    expect(row.used).toBe(0);
    expect(row.tiles).toEqual(Array.from({ length: SHIP_TYPES.generalFreighter.moduleSlots }, (_, i) => ({ kind: "empty", index: i })));
  });

  it("a save over the cap still shows every piece and draws no empty tile", () => {
    const pieces = ["arcDischarger", "shieldSurge", "prospectorsEcho"].map((id, i) => mintTestModule(def(id), "standard", 0, `pb-o${i}`));
    const row = moduleRowTiles(pieces, 2, true);
    expect(row.tiles.every((t) => t.kind === "module")).toBe(true);
    expect(row.used).toBe(3);
  });

  it("tile lines: the draw, a capacitor's output at its scale, the condition percent, the active Survey Pair", () => {
    const cap = mintTestModule(def("auxiliaryCapacitor"), "standard", 0, "pb-c");
    expect(moduleTileDrawText(cap)).toBe(`draw ${cap.powerDraw} · +${shipPowerBudget(aboard(freshState(), [cap]), SHIP).moduleOutput} power`);
    const arc = mintTestModule(def("arcDischarger"), "standard", 0, "pb-arc");
    expect(moduleTileDrawText(arc)).toBe(`draw ${arc.powerDraw}`);
    expect(pieceConditionPercent(arc)).toBe(100);
    expect(pieceConditionPercent({ condition: 925 })).toBe(93);
    const lba = { ...mintTestModule(def("longBaselineArray"), "standard", 0, "pb-l"), fittedToShipId: SHIP };
    const sig = { ...mintTestModule(def("signalIntegrator"), "standard", 0, "pb-s"), fittedToShipId: SHIP };
    expect(activeModuleSetLines([lba])).toEqual([]);
    expect(activeModuleSetLines([lba, sig])).toEqual([{ chip: "Survey Pair 2 / 2", text: "+8% scan speed on expeditions." }]);
  });
});

describe("the module card's trigger in plain words (EM-10)", () => {
  it("every roster module says when it acts, follows the text rules, and the card carries draw and the note", () => {
    const expected: Record<string, string> = {
      auxiliaryCapacitor: "Always on, everywhere the ship goes.",
      structuralBracing: "Always on in combat.",
      arcDischarger: "Acts each time the ship takes a hit in combat.",
      prospectorsEcho: "Acts on each delivered extraction cycle of a captain mission.",
      lastStandProtocol: "Acts in combat while the ship's hull is below 25%.",
      shieldSurge: "Acts in combat once the ship's hull falls below 50%.",
      longBaselineArray: "Acts on expeditions while both pieces of its pair are installed on the same ship.",
      signalIntegrator: "Acts on expeditions while both pieces of its pair are installed on the same ship.",
      // Gas Giant Study GG-7: the Ramscoop Collector (a special blueprint).
      ramscoopCollector: "Acts on each expedition's nebula sweep.",
      // E-MOD EM-8: the Precursor Lens (the Special).
      precursorLens: "Acts on each body an expedition scans.",
    };
    for (const d of UNIVERSAL_MODULES) {
      expect(moduleWhenText(d), d.id).toBe(expected[d.id]);
      const lines = pieceModuleLines(mintTestModule(d, "standard", 0, `pb-w-${d.id}`))!;
      expect(lines.when).toBe(expected[d.id]);
      expect(lines.draw).toMatch(/^Power draw \d+/);
      for (const t of [lines.when, lines.draw, MODULE_CARD_NOTE]) {
        expect(t).not.toMatch(/—|–|-{2}/);
        expect(t).not.toMatch(/\b(fit|fits|fitting|fitted)\b/i);
      }
    }
  });
});

describe("EM-10 review fixes", () => {
  // A weightless, powerful crafted core on the starting Freighter, whose systems already use the hull's own power (the
  // systems draw the hull's power first): the core's unused power is what speeds the drive.
  function strongCore(): GameState {
    const s = freshState();
    const core = fittedInSlot(s, SHIP, "reactorCore")!;
    const bay = fittedInSlot(s, SHIP, "cargoBay")!;
    const strong = { ...core, blueprintKey: "highOutputCoreBp", implicitStats: { powerOutput: 150 }, rolledStats: {}, mass: 0 };
    const hungry = { ...bay, powerDraw: SHIP_TYPES.generalFreighter.basePowerOutput };
    return { ...s, equipment: s.equipment.map((e) => (e.id === core.id ? strong : e.id === bay.id ? hungry : e)) };
  }

  it("1. a module's draw can slow the drive, and the module compare keeps the moved FTL Speed row", () => {
    const s = strongCore();
    const ship = s.ships.find((x) => x.id === SHIP)!;
    const pieces = equippedFor(s, SHIP);
    const surge = { ...mintTestModule(def("shieldSurge"), "standard", 0, "rf-surge"), fittedToShipId: SHIP };
    const before = gearSheetWithReactorDrive(ship, pieces);
    const after = gearSheetWithReactorDrive(ship, [...pieces, surge]);
    expect(after.transitSpeedMult).toBeLessThan(before.transitSpeedMult);
    expect(moduleCompareKeepsRow({ label: "FTL Speed", base: before.transitSpeedMult, fitted: after.transitSpeedMult, kind: "pct" })).toBe(true);
    // power rows always, an unmoved row never, Range by its floored values
    expect(moduleCompareKeepsRow({ label: "Power Draw", base: 5, fitted: 5, kind: "flat" })).toBe(true);
    expect(moduleCompareKeepsRow({ label: "Cargo Capacity", base: 60, fitted: 60, kind: "flat" })).toBe(false);
    expect(moduleCompareKeepsRow({ label: "Range", base: 75.2, fitted: 75.9, kind: "ly" })).toBe(false);
    expect(moduleCompareKeepsRow({ label: "Range", base: 75.2, fitted: 74.9, kind: "ly" })).toBe(true);
    // a small real change never reads as "+0 pts"
    const pts = pointsDeltaText(after.transitSpeedMult - before.transitSpeedMult);
    expect(pts).toMatch(/^-\d/);
    expect(pts).not.toBe("-0 pts");
    expect(pointsDeltaText(0.35)).toBe("+35 pts");
    expect(pointsDeltaText(-0.004)).toBe("-0.4 pts");
  });

  it("4. the card's power line reads the engine's own output fold (the bar's number)", () => {
    for (const [rarity, q] of [["standard", 0], ["radiant", 3], ["augmented", 5]] as const) {
      const cap = mintTestModule(def("auxiliaryCapacitor"), rarity, q, `rf-cap-${rarity}`);
      const adds = shipPowerBudget(aboard(freshState(), [cap]), SHIP).moduleOutput;
      expect(pieceModuleLines(cap)!.draw).toBe(`Power draw ${cap.powerDraw}, adds ${adds} power`);
    }
  });

  it("5. the draw reduction is the fold's own (set lines and the clamp at 0 included)", () => {
    const s = freshState();
    const pieces = equippedFor(s, SHIP).map((p, i) => (i === 0 ? { ...p, rolledStats: { ...p.rolledStats, powerDrawReduction: 999 } } : p));
    const sum = pieces.reduce((n, p) => n + piecePowerDraw(p), 0);
    expect(sum - drawReductionTotal(pieces)).toBe(equipmentStatMods(pieces).totalPowerDraw);
    expect(equipmentStatMods(pieces).totalPowerDraw).toBe(0);
  });

  it("6. a worn module's card names its condition; a pristine one does not", () => {
    const arc = mintTestModule(def("arcDischarger"), "standard", 0, "rf-arc");
    expect(pieceModuleLines(arc)!.condition).toBeNull();
    expect(pieceModuleLines({ ...arc, condition: 920 })!.condition).toMatch(/^Condition 92%\./);
  });

  it("2. every Spec Utility variety draws an SVG glyph (never an emoji), classified for packs", () => {
    for (const v of EQUIPMENT_SLOTS.specUtility.varieties) {
      const ic = varietySvgIcon(v.key);
      expect(ic, v.key).not.toBeNull();
      expect(ICON_PATHS[ic!], v.key).toBeDefined();
      expect(ICON_SEMANTICS[ic!], v.key).toBe("subject");
      const piece = { ...fittedInSlot(freshState(), SHIP, "specUtility")!, moduleVariant: v.key };
      expect(equipmentIcon(piece), v.key).toBe("");
      expect(equipmentSvgIcon(piece), v.key).toBe(ic);
    }
  });
});

describe("Help topic: Power and modules", () => {
  it("exists, reads its numbers from the engine, and names where each piece of the UI lives", () => {
    const t = HELP_TOPICS.find((x) => x.id === "powerAndModules");
    expect(t?.title).toBe("Power and modules");
    const b = t!.body;
    expect(b).toContain(`x${DRIVE_CLASS_POWER_DRAW_MULT}`);
    expect(b).toContain(`never below ${POWER_SUPPLY_FLOOR_PERCENT}%`);
    for (const words of ["Power bar", "Modules row", "Install on...", "one preset rule", "Spec Utility", "Fabricator", "Logistics"]) expect(b).toContain(words);
    expect(HELP_TOPICS.find((x) => x.id === "shipSystems")!.body).toContain("Power and modules topic");
  });
});
