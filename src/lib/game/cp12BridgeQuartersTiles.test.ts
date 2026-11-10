// Complement CP-12 (plan docs/plans/2026-10-14-complement-and-acquisition-plan.md CP-12, Task 28 UI; mockup CMR-9): the
// Bridge Module and Crew Quarters install tiles, and the sensor slot renamed to Sensor Suite (OC-25, display only).
import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import { BLUEPRINTS, EQUIPMENT_SLOTS, type GameState } from "./model";
import { effectiveShipStats } from "./crewOverlay";
import { quartersCapacityBonus } from "./crewModules";
import { fittedInSlot, unfitEquipmentInstance } from "./equipment";
import { inspectBlank } from "./tick";
import { deserialize, migrate, serialize } from "./save";
import { CREW_MODULE_TILE_SLOTS, SHIP_SYSTEM_TILES, hasShipSystemTile, installFromShipSystemTile } from "./shipSystemTiles";
import { seatOfficer, shipOf, wiringBase, WIRING_SHIP_ID } from "./wiring/probes";
import { WIRING_REGISTRY } from "./wiring/registry";
import { fabricateKeyGroups, fabricatorGroupOf, researchSectionOf, RESEARCH_SECTION_LABEL, RESEARCH_SECTION_ORDER } from "../awayGearDisplay";
import { equipmentIcon, equipmentSvgIcon, varietySvgIcon } from "../EquipmentTooltip.svelte";
import { ICON_PATHS, ICON_NAMES } from "../ui/icons";
import { ICON_SEMANTICS } from "../ui/iconPacks";
import { liftPercentText, shipSystemTileLine } from "../crewModuleTileDisplay";

// One blank of `key` inspected (the Fabricator's own mint): the state and the spare's id.
function crafted(s: GameState, key: string): { state: GameState; id: string } {
  const held: GameState = { ...s, blanks: { ...s.blanks, [key]: [new Decimal(1)] } };
  const after = inspectBlank(held, key);
  const piece = after.equipment.find((e) => !held.equipment.some((x) => x.id === e.id));
  if (piece === undefined) throw new Error(`no mint for ${key}`);
  return { state: after, id: piece.id };
}

describe("CP-12: the Ships tab's Systems tiles", () => {
  it("draws Sensor Suite, Bridge Module and Crew Quarters after the economy tiles (the mockup's order)", () => {
    expect(SHIP_SYSTEM_TILES.map((t) => t.slotType)).toEqual(["cargoBay", "ftlDrive", "reactorCore", "specUtility", "sensor", "bridge", "quarters"]);
    expect(SHIP_SYSTEM_TILES.slice(4).map((t) => t.label)).toEqual(["Sensor Suite", "Bridge Module", "Crew Quarters"]);
    expect(CREW_MODULE_TILE_SLOTS).toEqual(["bridge", "quarters"]);
    expect(hasShipSystemTile("bridge") && hasShipSystemTile("quarters") && hasShipSystemTile("sensor")).toBe(true);
    expect(hasShipSystemTile("weapon")).toBe(false);
  });

  it("a crafted Balanced Command installs from the Bridge Module tile and lifts the seated officer's line", () => {
    const base = seatOfficer(wiringBase("generalFreighter"), "operations", ["ops.cargoExpand"]);
    const { state, id } = crafted(base, "balancedCommandBp");
    const after = installFromShipSystemTile(state, WIRING_SHIP_ID, "bridge", id);
    expect(fittedInSlot(after, WIRING_SHIP_ID, "bridge")?.id).toBe(id);
    expect(effectiveShipStats(after, shipOf(after)).cargoCapacity).toBeGreaterThan(effectiveShipStats(state, shipOf(state)).cargoCapacity);
  });

  it("a crafted Utilitarian Quarters installs from the Crew Quarters tile and adds berths; uninstalling leaves the slot EMPTY", () => {
    const { state, id } = crafted(wiringBase("aurora"), "utilitarianQuartersBp");
    const on = installFromShipSystemTile(state, WIRING_SHIP_ID, "quarters", id);
    expect(quartersCapacityBonus(on, shipOf(on))).toBeGreaterThanOrEqual(12);
    const off = unfitEquipmentInstance(on, WIRING_SHIP_ID, id);
    expect(fittedInSlot(off, WIRING_SHIP_ID, "quarters")).toBeNull();
    expect(off.equipment.find((e) => e.id === id)?.fittedToShipId).toBeNull();
    expect(quartersCapacityBonus(off, shipOf(off))).toBe(0);
  });

  it("refuses (same state) a piece of another slot and a slot with no tile", () => {
    const { state, id } = crafted(wiringBase("aurora"), "balancedCommandBp");
    expect(installFromShipSystemTile(state, WIRING_SHIP_ID, "quarters", id)).toBe(state);
    expect(installFromShipSystemTile(state, WIRING_SHIP_ID, "weapon", id)).toBe(state);
    expect(installFromShipSystemTile(state, WIRING_SHIP_ID, "bridge", "no-such-piece")).toBe(state);
  });

  it("the obtainable row is live, measured through the tile list", () => {
    const row = WIRING_REGISTRY.find((e) => e.id === "ship:EQUIPMENT_SLOTS:bridge+quarters:obtainable")!;
    expect(row.status).toEqual({ kind: "live" });
    expect(row.probe).toBe("fillableBerths");
    const base = row.base();
    expect(row.on(base)).not.toBe(base);
  });
});

describe("CP-12: Sensor Suite (OC-25, display text only)", () => {
  it("names the slot Sensor Suite; the slot type and every array key are unchanged", () => {
    expect(EQUIPMENT_SLOTS.sensor.slotType).toBe("sensor");
    expect(EQUIPMENT_SLOTS.sensor.label).toBe("Sensor Suite");
    expect(EQUIPMENT_SLOTS.sensor.varieties.map((v) => v.key)).toEqual(["sensorWideBeam", "sensorFocusedBeam", "sensorBalanced", "sensorBioResonance", "sensorResonance"]);
    for (const bp of Object.values(BLUEPRINTS)) {
      if (bp.equipmentOutput?.slotType !== "sensor" || bp.unlockHint === undefined) continue;
      expect(bp.unlockHint, bp.key).not.toContain("Sensor Array slot");
    }
  });

  it("a save never stores the slot's name, so old saves are untouched (cp12Goldens pins the bytes)", () => {
    const { state, id } = crafted(wiringBase("aurora"), "wideBeamArrayBp");
    const s = installFromShipSystemTile(state, WIRING_SHIP_ID, "sensor", id);
    expect(fittedInSlot(s, WIRING_SHIP_ID, "sensor")?.id).toBe(id);
    const loaded = deserialize(serialize(s, 0, 0));
    expect(loaded).not.toBeNull();
    const json = JSON.stringify(loaded);
    expect(json).not.toContain("Sensor Suite");
    expect(json).not.toContain("Sensor Array");
    expect(migrate(loaded!).equipment.find((e) => e.id === id)?.moduleVariant).toBe("sensorWideBeam");
  });
});

describe("CP-12: the Fabricator's Crew Modules group", () => {
  it("files every bridge and quarters blueprint under Crew Modules; arrays stay Ship Systems", () => {
    for (const bp of Object.values(BLUEPRINTS)) {
      const slot = bp.equipmentOutput?.slotType;
      if (slot === "bridge" || slot === "quarters") expect(fabricatorGroupOf(bp), bp.key).toBe("crewModule");
      if (slot === "sensor") expect(fabricatorGroupOf(bp), bp.key).toBe("ship");
    }
    for (const tier of [1, 2, 3]) {
      const group = fabricateKeyGroups(Object.values(BLUEPRINTS), tier).find((g) => g.key === "crewModule");
      const expected = Object.values(BLUEPRINTS)
        .filter((bp) => bp.tier === tier && !bp.unlockOnly && (bp.equipmentOutput?.slotType === "bridge" || bp.equipmentOutput?.slotType === "quarters"))
        .map((bp) => bp.key);
      expect(expected.length, `tier ${tier}`).toBeGreaterThan(0);
      expect(group?.label, `tier ${tier}`).toBe("Crew Modules");
      expect(group?.keys, `tier ${tier}`).toEqual(expected);
    }
  });
});

describe("CP-12: the tile's variant line (mockup CMR-9)", () => {
  const piece = (slotType: string, moduleVariant: string, extra: Record<string, unknown> = {}) => ({
    id: "p", rarity: "standard", ascension: "none", quality: 0, iLevel: 6, blueprintKey: null, implicitStats: {}, rolledStats: {}, mass: 0, powerDraw: 0,
    durabilityMax: 100, fittedToShipId: WIRING_SHIP_ID, slotType, moduleVariant, ...extra,
  }) as unknown as GameState["equipment"][number];

  it("formats a lift with its sign and at most one decimal", () => {
    expect(liftPercentText(1.1)).toBe("+10%");
    expect(liftPercentText(0.95)).toBe("-5%");
    expect(liftPercentText(1.104)).toBe("+10.4%");
    expect(liftPercentText(1 + 0.15 * 0.85)).toBe("+12.8%"); // the Flag Command's Cadet lift, half up despite the float
  });

  it("names a sensor array, and what each crew module does on this hull", () => {
    const s = wiringBase("aurora");
    const ship = shipOf(s);
    expect(shipSystemTileLine(s, ship, piece("sensor", "sensorWideBeam"))).toBe("Wide-Beam Array");
    expect(shipSystemTileLine(s, ship, piece("bridge", "bridgeBalancedCommand"))).toBe("Balanced Command · every officer +10%");
    expect(shipSystemTileLine(s, ship, piece("bridge", "bridgeFocusedCommand"))).toBe("Focused Command · this hull's Science, Medical and Engineering officers +30%");
    const freighter = shipOf(wiringBase("generalFreighter"));
    expect(shipSystemTileLine(s, freighter, piece("bridge", "bridgeFocusedCommand"))).toBe("Focused Command · this hull's Operations, Pilot and Executive officers +30%");
    expect(shipSystemTileLine(s, ship, piece("bridge", "bridgeFlagCommand"))).toBe("Flag Command · officers +15% at Ensign (+12.8% as a Cadet), more at higher ranks");
    expect(shipSystemTileLine(s, ship, piece("quarters", "quartersUtilitarian"))).toBe("Utilitarian Quarters · +12 crew berths · every division +10%");
    expect(shipSystemTileLine(s, ship, piece("quarters", "quartersSecurityWing"))).toBe("Security Quarters · +6 crew berths · Security +50%, other divisions -10%");
    expect(shipSystemTileLine(s, ship, piece("quarters", "quartersElite"))).toBe("Elite Quarters · no added berths · every division +40%");
    expect(shipSystemTileLine(s, ship, piece("cargoBay", "balancedHold"))).toBeNull();
  });

  it("text rules: no em dash, no double hyphen, never 'fit'", () => {
    const s = wiringBase("aurora");
    const ship = shipOf(s);
    for (const slot of ["bridge", "quarters", "sensor"] as const) {
      for (const v of EQUIPMENT_SLOTS[slot].varieties) {
        const line = shipSystemTileLine(s, ship, piece(slot, v.key)) ?? "";
        expect(line, v.key).not.toMatch(/—|--|\bfit/i);
        expect(line.length, v.key).toBeGreaterThan(0);
      }
    }
  });
});

describe("CP-12 fix round: Research's Crew Modules section (signed mockup CMR-9, user 2026-11-04)", () => {
  it("files every bridge and quarters blueprint under a Crew Modules section after the main list; arrays stay in the main list", () => {
    expect(RESEARCH_SECTION_ORDER.indexOf("crewModule")).toBe(RESEARCH_SECTION_ORDER.indexOf("main") + 1);
    expect(RESEARCH_SECTION_LABEL.crewModule).toBe("Crew Modules");
    let crewModules = 0;
    for (const bp of Object.values(BLUEPRINTS)) {
      const slot = bp.equipmentOutput?.slotType;
      if (!bp.unlockOnly && (slot === "bridge" || slot === "quarters")) {
        crewModules += 1;
        expect(researchSectionOf(bp), bp.key).toBe("crewModule");
      }
      if (slot === "sensor") expect(researchSectionOf(bp), bp.key).toBe("main");
    }
    expect(crewModules).toBeGreaterThan(10);
  });
});

describe("CP-12 fix round: every crew module, sensor and module piece draws its own SVG glyph (never an emoji)", () => {
  const SLOTS = ["bridge", "quarters", "sensor", "module"] as const;
  const piece = (slotType: string, moduleVariant: string) =>
    ({ id: "p", rarity: "standard", ascension: "none", quality: 0, iLevel: 1, blueprintKey: null, implicitStats: {}, rolledStats: {}, mass: 0, powerDraw: 0, durabilityMax: 100, fittedToShipId: null, slotType, moduleVariant }) as unknown as GameState["equipment"][number];

  it("every variety of the bridge, quarters, sensor and module slots resolves to a classified SVG glyph", () => {
    for (const slot of SLOTS) {
      for (const v of EQUIPMENT_SLOTS[slot].varieties) {
        const ic = equipmentSvgIcon(piece(slot, v.key));
        expect(ic, `${slot}:${v.key}`).not.toBeNull();
        expect(ICON_PATHS[ic!], v.key).toBeDefined();
        expect(ICON_SEMANTICS[ic!], v.key).toBe("subject");
        expect(equipmentIcon(piece(slot, v.key)), v.key).toBe("");
      }
    }
    // Every blueprint that makes one draws SVG too (its Research and Fabricator cards).
    for (const bp of Object.values(BLUEPRINTS)) {
      const out = bp.equipmentOutput;
      if (out === undefined || !(SLOTS as readonly string[]).includes(out.slotType)) continue;
      expect(varietySvgIcon(out.varietyKey ?? null, out.slotType), bp.key).not.toBeNull();
    }
  });

  it("the sensor slot has an SVG fallback: an unmapped sensor variety draws the Sensor Suite glyph, never the satellite emoji", () => {
    expect(equipmentSvgIcon(piece("sensor", "notAnArrayYet"))).toBe("sensorArray");
    expect(equipmentIcon(piece("sensor", "notAnArrayYet"))).toBe("");
    expect(varietySvgIcon(null, "sensor")).toBe("sensorArray");
  });

  it("each array variety has its own glyph, apart from each other, the slot glyph and every relic's glyph", () => {
    const own = EQUIPMENT_SLOTS.sensor.varieties.map((v) => varietySvgIcon(v.key, "sensor")!);
    expect(new Set(own).size).toBe(own.length);
    for (const ic of own) {
      expect(ic).not.toBe("sensorArray");
      expect(ic.startsWith("relic"), ic).toBe(false);
    }
    expect(varietySvgIcon("sensorBioResonance", "sensor")).not.toBe("relicLeviathanScale");
    // No other icon draws the same paths (a renamed copy would pass the name check above).
    for (const ic of own) {
      const body = JSON.stringify(ICON_PATHS[ic]);
      for (const other of ICON_NAMES) if (other !== ic) expect(JSON.stringify(ICON_PATHS[other]), `${ic} vs ${other}`).not.toBe(body);
    }
  });
});
