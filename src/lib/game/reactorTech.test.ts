// Reactor fuel ladder + Cometary Ice Harvest + reactor tech foundation (0.14.0; capture
// docs/plans/2026-10-21-reactor-fuel-and-recipe-realism-capture.md): every Reactor Core recipe takes its tier's fuel
// canister, today's cores all burn Deuterium and none can be blocked (the comet run brings the ice in), the tech
// tiers are data (a fourth tier needs no redesign), and the hull tier power requirement is a seam the EM-1 power budget
// reads (none active in 0.14.0).

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import {
  BLUEPRINTS,
  DEFAULT_EQUIPMENT_VARIETY,
  EQUIPMENT_SLOTS,
  ITEMS,
  MISSIONS,
  REFINE_RECIPES,
  SHIP_TYPES,
  refineRecipeOffered,
  freshState,
  type GameState,
  type ShipTypeKey,
} from "./model";
import {
  HULL_TIER_REACTOR_REQUIREMENT,
  REACTOR_FUEL_LADDER,
  REACTOR_TECH_TIERS,
  REACTOR_VARIETY_TECH,
  meetsReactorRequirement,
  reactorCoreFuel,
  reactorFuelRung,
  requiredReactorTech,
  type ReactorTechId,
} from "./reactorTech";
import { canDispatch, canFabricate, dispatchCaptainOnMission, economyTick, inspectBlank, startFabricateJob } from "./tick";
import { shipPowerBudget, reactorPieceTech } from "./shipPower";
import { onHull } from "./firstRunsGoldens.fixture";
import { heldOf, holding, withFacilityLevel } from "./wiring/probes";
import { readProbe } from "./wiring/probes";
import { WIRING_REGISTRY } from "./wiring/registry";
import { missionIcon } from "../ui/missionIcons";
import { ICON_PATHS } from "../ui/icons";
import { ICON_SEMANTICS } from "../ui/iconPacks";

const CORES = Object.keys(BLUEPRINTS).filter((k) => BLUEPRINTS[k].equipmentOutput?.slotType === "reactorCore");
const HULLS = Object.keys(SHIP_TYPES) as ShipTypeKey[];
const FUEL_ITEMS = new Set(REACTOR_TECH_TIERS.flatMap((t) => t.fuelLadder.flatMap((r) => Object.keys(r.fuel))));

// A Fabricator at the blueprint's tier, the blueprint researched, holding its recipe's inputs (`without` left out).
function readyToCraft(bp: string, without?: string): GameState {
  const def = BLUEPRINTS[bp];
  let s: GameState = { ...withFacilityLevel(freshState(), "fabricator", Math.max(1, def.tier)), researchedBlueprints: [bp] };
  for (const [item, qty] of Object.entries(def.recipe.inputs)) if (item !== without) s = holding(s, item, new Decimal(qty));
  return s;
}

describe("the reactor fuel ladder: every Reactor Core recipe takes its tier's fuel canister", () => {
  it("there are Reactor Core blueprints, and every one carries exactly its ladder fuel, after its other inputs", () => {
    expect(CORES.sort()).toEqual(["balancedCoreBp", "efficientCoreBp", "highOutputCoreBp"]);
    for (const bp of CORES) {
      const def = BLUEPRINTS[bp];
      const fuel = reactorCoreFuel(def.equipmentOutput!.varietyKey, def.tier);
      const keys = Object.keys(def.recipe.inputs);
      const fuelKeys = Object.keys(fuel);
      expect(fuelKeys.length, bp).toBeGreaterThan(0);
      // The fuel sits last, so every older input keeps its place (salvage rounds per input in recipe order).
      expect(keys.slice(keys.length - fuelKeys.length), bp).toEqual(fuelKeys);
      for (const f of fuelKeys) expect(def.recipe.inputs[f], `${bp} ${f}`).toBe(fuel[f]);
      // No other input is a fuel item (the fuel comes from the ladder only).
      for (const k of keys.slice(0, keys.length - fuelKeys.length)) expect(FUEL_ITEMS.has(k), `${bp} ${k}`).toBe(false);
    }
  });

  it("the user's counts (audit Group A): Balanced 1, Efficient 1, High-Output 2 Deuterium Canisters", () => {
    expect(BLUEPRINTS.balancedCoreBp.recipe.inputs.deuteriumCanister).toBe(1);
    expect(BLUEPRINTS.efficientCoreBp.recipe.inputs.deuteriumCanister).toBe(1);
    expect(BLUEPRINTS.highOutputCoreBp.recipe.inputs.deuteriumCanister).toBe(2);
  });

  it("the ladder (audit 4.3): fusion on Deuterium only; Helium-3 and cells only in the higher tech tiers", () => {
    expect([1, 2, 3, 7].map((tier) => reactorFuelRung("fusion", tier).fuel)).toEqual([
      { deuteriumCanister: 1 },
      { deuteriumCanister: 2 },
      { deuteriumCanister: 3 },
      { deuteriumCanister: 3 },
    ]);
    // Helium-3 goes in no fusion core (audit Group A call 3: "reactors take it in the balancing patch").
    for (const r of REACTOR_FUEL_LADDER.fusion) expect(Object.keys(r.fuel)).toEqual(["deuteriumCanister"]);
    expect(Object.keys(reactorFuelRung("deuteriumHelium3Fusion", 5).fuel).sort()).toEqual(["deuteriumCanister", "helium3Canister"]);
    expect(Object.keys(reactorFuelRung("antimatterCatalyzedFusion", 6).fuel).sort()).toEqual(["antimatterCell", "helium3Canister"]);
    expect(Object.keys(reactorFuelRung("antimatter", 7).fuel)).toEqual(["antimatterCell"]);
  });

  it("nothing is blocked today: every core is a tier I or II fusion core, so every one burns Deuterium", () => {
    for (const bp of CORES) {
      expect(BLUEPRINTS[bp].tier, bp).toBeLessThanOrEqual(4);
      expect(REACTOR_VARIETY_TECH[BLUEPRINTS[bp].equipmentOutput!.varietyKey], bp).toBe("fusion");
      expect(Object.keys(BLUEPRINTS[bp].recipe.inputs), bp).toContain("deuteriumCanister");
      expect(Object.keys(BLUEPRINTS[bp].recipe.inputs), bp).not.toContain("helium3Canister");
    }
  });

  // The no-wall walker for the reactor fuel (audit Group A call 2: the Cometary Ice Harvest is open from day one, like
  // the Local Asteroid and Lunar Mine runs, so the anchor Balanced Core never walls): every fuel canister a Reactor Core
  // recipe takes is refined from an item a mission open on a FRESH save delivers, with no captain level or hold gate.
  it("no wall: every Reactor Core fuel refines from the drop of a mission a fresh save can fly at once", () => {
    const fresh = freshState();
    const dayOne = (Object.keys(MISSIONS) as (keyof typeof MISSIONS)[]).filter(
      (k) => k !== "localFuelRun" && MISSIONS[k].unlockLevel <= 1 && MISSIONS[k].requiresCaptainLevel === undefined && MISSIONS[k].requiresCargoCapacity === undefined && canDispatch(fresh, 1, k).ok,
    );
    expect(dayOne).toEqual(expect.arrayContaining(["shortOreRun", "longOreRun", "cometIceHarvest"]));
    const dayOneDrops = new Set(dayOne.flatMap((k) => Object.values(MISSIONS[k].lootTable)));
    for (const bp of CORES) {
      for (const fuel of Object.keys(BLUEPRINTS[bp].recipe.inputs).filter((k) => FUEL_ITEMS.has(k))) {
        // The refine must be one the Refinery OFFERS (refineRecipeOffered: its output leads somewhere), not just exist.
        const refines = Object.entries(REFINE_RECIPES).filter(([key, r]) => r.output.itemId === fuel && refineRecipeOffered(key));
        expect(refines.length, `${bp} ${fuel}: an offered refine`).toBeGreaterThan(0);
        expect(refines.some(([, r]) => Object.keys(r.input).every((i) => dayOneDrops.has(i))), `${bp} ${fuel}`).toBe(true);
      }
    }
  });

  it("the Deuterium chain has a live source: the comet run's ice refines 10:1 into the canister", () => {
    const refine = Object.entries(REFINE_RECIPES).find(([, r]) => r.output.itemId === "deuteriumCanister");
    expect(refine).toBeDefined();
    expect(Object.keys(refine![1].input)).toEqual(["deuteriumIce"]);
    expect(Number(refine![1].input.deuteriumIce)).toBe(10);
    const sources = Object.entries(MISSIONS).filter(([k, m]) => k !== "localFuelRun" && Object.values(m.lootTable).includes("deuteriumIce"));
    expect(sources.map(([k]) => k)).toEqual(["cometIceHarvest"]);
  });

  it("a craft without its fuel canister is refused for lack of materials, and with it the canister is spent", () => {
    for (const bp of CORES) {
      expect(canFabricate(readyToCraft(bp, "deuteriumCanister"), bp), bp).toEqual({ ok: false, reason: "materials" });
      const ready = readyToCraft(bp);
      expect(canFabricate(ready, bp).ok, bp).toBe(true);
      const r = startFabricateJob(ready, bp);
      expect(r.started, bp).toBe(true);
      expect(heldOf(r.next, "deuteriumCanister"), bp).toBe(0);
      expect(readProbe(`content:reactorFuel:${bp}:deuteriumCanister`, freshState(), "craft"), bp).toBe(BLUEPRINTS[bp].recipe.inputs.deuteriumCanister);
    }
  });

  it("every fuel item is a real Gas Storage Canister item", () => {
    for (const id of FUEL_ITEMS) {
      expect(ITEMS[id], id).toBeDefined();
      expect(ITEMS[id].category, id).toBe("gasCanister");
    }
  });

  it("an already crafted reactor is untouched: its roll and its power never read the recipe", () => {
    // The piece a blank rolls is keyed by the save's inspect seed and the blueprint key only (reactorFuelGoldens pins it).
    for (const bp of CORES) {
      const a = inspectBlank({ ...freshState(), blanks: { [bp]: new Decimal(1) } }, bp).equipment.at(-1)!;
      expect(a.blueprintKey).toBe(bp);
      expect(reactorPieceTech(a)).toBe("fusion");
    }
  });
});

describe("the reactor tech tiers are data", () => {
  it("fusion, Deuterium-Helium-3 fusion, antimatter-catalyzed fusion, antimatter, in rank order, each with a fuel ladder", () => {
    expect(REACTOR_TECH_TIERS.map((t) => t.id)).toEqual(["fusion", "deuteriumHelium3Fusion", "antimatterCatalyzedFusion", "antimatter"]);
    expect(REACTOR_TECH_TIERS.map((t) => t.rank)).toEqual([1, 2, 3, 4]);
    for (const t of REACTOR_TECH_TIERS) {
      expect(t.fuelLadder.length, t.id).toBeGreaterThan(0);
      expect(t.fuelLadder[0].fromBlueprintTier, t.id).toBe(1);
      for (let i = 1; i < t.fuelLadder.length; i += 1) expect(t.fuelLadder[i].fromBlueprintTier).toBeGreaterThan(t.fuelLadder[i - 1].fromBlueprintTier);
      expect(t.science.length, t.id).toBeGreaterThan(10);
    }
  });

  it("every Reactor Core variety is tagged with a tech tier (all fusion today), the Standard-Issue core included", () => {
    expect(Object.keys(REACTOR_VARIETY_TECH).sort()).toEqual(EQUIPMENT_SLOTS.reactorCore.varieties.map((v) => v.key).sort());
    for (const v of Object.keys(REACTOR_VARIETY_TECH)) expect(REACTOR_VARIETY_TECH[v]).toBe("fusion");
    expect(REACTOR_VARIETY_TECH[DEFAULT_EQUIPMENT_VARIETY.reactorCore]).toBe("fusion");
  });

  it("a requirement is met by its own rank or higher, never by no reactor; no requirement is always met", () => {
    const ids = REACTOR_TECH_TIERS.map((t) => t.id);
    for (const req of ids) {
      for (const have of ids) {
        const rank = (id: ReactorTechId) => REACTOR_TECH_TIERS.find((t) => t.id === id)!.rank;
        expect(meetsReactorRequirement(have, req), `${have} vs ${req}`).toBe(rank(have) >= rank(req));
      }
      expect(meetsReactorRequirement(null, req)).toBe(false);
      expect(meetsReactorRequirement(req, null)).toBe(true);
    }
    expect(meetsReactorRequirement(null, null)).toBe(true);
  });
});

describe("the hull tier power generation requirement seam (balancing patch)", () => {
  it("no requirement is active in 0.14.0: every hull tier reads none", () => {
    expect(Object.keys(HULL_TIER_REACTOR_REQUIREMENT)).toEqual([]);
    for (let tier = 1; tier <= 7; tier += 1) expect(requiredReactorTech(tier)).toBeNull();
  });

  it("a row holds from its tier up until a higher row raises it", () => {
    const table = { 3: "fusion", 7: "antimatter" } as const;
    expect(requiredReactorTech(2, table)).toBeNull();
    expect(requiredReactorTech(3, table)).toBe("fusion");
    expect(requiredReactorTech(6, table)).toBe("fusion");
    expect(requiredReactorTech(7, table)).toBe("antimatter");
    expect(requiredReactorTech(8, table)).toBe("antimatter");
  });

  it("the EM-1 power budget names the installed tech and the requirement, and meets it on every ship today", () => {
    for (const hull of HULLS) {
      const s = onHull(hull);
      const b = shipPowerBudget(s, "ship-1");
      expect(b.reactorTech, hull).toBe("fusion"); // the Standard-Issue core
      expect(b.requiredReactorTech, hull).toBeNull();
      expect(b.reactorTechMet, hull).toBe(true);
      // With the Reactor Core uninstalled (the slot allows empty) the ship has no reactor tech.
      const bare = { ...s, equipment: s.equipment.filter((e) => !(e.fittedToShipId === "ship-1" && e.slotType === "reactorCore")) };
      expect(shipPowerBudget(bare, "ship-1").reactorTech, hull).toBeNull();
      expect(shipPowerBudget(bare, "ship-1").reactorTechMet, hull).toBe(true);
    }
  });

  it("through the seam, a requirement on the hull's tier reads in the budget (the balancing patch's hook)", () => {
    const s = onHull("battleship");
    const tier = SHIP_TYPES.battleship.tier;
    const antimatter = shipPowerBudget(s, "ship-1", undefined, { [tier]: "antimatter" });
    expect(antimatter.requiredReactorTech).toBe("antimatter");
    expect(antimatter.reactorTechMet).toBe(false);
    const fusion = shipPowerBudget(s, "ship-1", undefined, { [tier]: "fusion" });
    expect(fusion.reactorTechMet).toBe(true);
    // A requirement above the hull's tier does not reach it.
    expect(shipPowerBudget(s, "ship-1", undefined, { [tier + 1]: "antimatter" }).requiredReactorTech).toBeNull();
    // The seam is registered (a seam built now for the balancing patch, never a release blocker).
    const seam = WIRING_REGISTRY.find((e) => e.id === "ship:SHIP_SEAMS:hullReactorRequirement");
    expect(seam?.status).toMatchObject({ kind: "seam", owner: "balancing patch" });
  });
});

describe("the wiring registry: the fuel ladder's live rungs, the pending Helium-3 rung and the balancing patch seams", () => {
  it("each rung and variety tag carries its status (no pending entry: nothing here blocks the release)", () => {
    const status = (id: string) => WIRING_REGISTRY.find((e) => e.id === id)?.status.kind;
    expect(status("facility:REACTOR_TECH_TIERS:fusion:fuel:0")).toBe("live");
    expect(status("facility:REACTOR_TECH_TIERS:fusion:fuel:1")).toBe("live");
    expect(status("facility:REACTOR_TECH_TIERS:fusion:fuel:2")).toBe("seam");
    expect(status("facility:REACTOR_TECH_TIERS:deuteriumHelium3Fusion:fuel:0")).toBe("seam");
    expect(status("facility:REACTOR_TECH_TIERS:antimatterCatalyzedFusion:fuel:0")).toBe("seam");
    expect(status("facility:REACTOR_TECH_TIERS:antimatter:fuel:0")).toBe("seam");
    for (const v of Object.keys(REACTOR_VARIETY_TECH)) expect(status(`facility:REACTOR_VARIETY_TECH:${v}`), v).toBe("live");
  });
});

describe("the Cometary Ice Harvest", () => {
  it("dispatches from a fresh save on the starting freighter and delivers Deuterium Ice enough for canisters", () => {
    const s0 = freshState();
    expect(canDispatch(s0, 1, "cometIceHarvest")).toEqual({ ok: true });
    let s = dispatchCaptainOnMission(s0, 1, "cometIceHarvest").next;
    let ticks = 0;
    while (!(s.lifetimeStats.missionsCompleted.cometIceHarvest?.gt(0) ?? false)) {
      s = economyTick(s, 1, () => 0.5);
      ticks += 1;
      if (ticks > 2000) throw new Error("never delivered");
    }
    // rng 0.5 misses both strikes, so the whole hold (the hull's: 90 on the starting freighter) is ice.
    expect(heldOf(s, "deuteriumIce")).toBe(SHIP_TYPES.generalFreighter.cargoCapacity);
    expect(heldOf(s, "deuteriumIce")).toBeGreaterThanOrEqual(10);
    // Gathering cannot be lost: the captain keeps flying (auto-repeat).
    expect(s.captains[0].mission).not.toBeNull();
  });

  it("strikes Titanium Ore and Iridium Ore on its uncommon and rare rolls", () => {
    const s0 = dispatchCaptainOnMission(freshState(), 1, "cometIceHarvest").next;
    let s = s0;
    let ticks = 0;
    // A low roll lands every extraction tick on the rare tier (Iridium); then a mid-low roll on the uncommon (Titanium).
    while (!(s.lifetimeStats.missionsCompleted.cometIceHarvest?.gt(0) ?? false)) {
      s = economyTick(s, 1, () => 0.001);
      if ((ticks += 1) > 2000) throw new Error("never delivered");
    }
    expect(heldOf(s, "rareMaterial")).toBeGreaterThan(0);
    s = s0;
    ticks = 0;
    while (!(s.lifetimeStats.missionsCompleted.cometIceHarvest?.gt(0) ?? false)) {
      s = economyTick(s, 1, () => 0.2);
      if ((ticks += 1) > 2000) throw new Error("never delivered");
    }
    expect(heldOf(s, "commonOre")).toBeGreaterThan(0);
    expect(heldOf(s, "rareMaterial")).toBe(0);
  });

  it("wears its own SVG comet glyph (icons.ts + ICON_SEMANTICS), never emoji", () => {
    const name = missionIcon("cometIceHarvest");
    expect(name).toBe("comet");
    expect(ICON_PATHS.comet.length).toBeGreaterThan(0);
    expect(ICON_SEMANTICS.comet).toBe("subject");
    expect(missionIcon("shortOreRun")).toBeNull();
  });
});
