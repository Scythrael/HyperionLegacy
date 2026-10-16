// WR-4 (0.14.0, plan docs/plans/2026-10-15-wiring-registry-and-audit-plan.md section 2.13 and section 4 WR-4):
// one test per bug and seam the slice fixes, each written to FAIL on the code before its fix.

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import {
  BLUEPRINTS,
  FACILITIES,
  ITEMS,
  MISSIONS,
  REFINE_RECIPES,
  SHIP_TYPES,
  freshState,
  type CaptainMissionState,
  type GameState,
  type ShipTypeKey,
} from "./model";
import {
  canBuildFacilityUpgrade,
  canDispatch,
  describeCaptainTalentEffect,
  describeHomeworldTalentEffect,
  dispatchCaptainOnMission,
  economyTick,
  missionDropChances,
  processShipRepairs,
  tierCap,
} from "./tick";
import * as utilityGear from "./utilityGear";
import * as shipLoadout from "./shipLoadout";
import { buildShipRoster } from "./shipRoster";
import { berthEtaTicks } from "./berths";
import { effectiveShipStats } from "./crewOverlay";
import { effectiveMissionDef } from "./model";
import { addItemQuality, itemTotal } from "./inventory";
import { expeditionCandidates, startExpedition } from "./expedition";
import { withMinimumAwayTeam } from "./awayTeamTestFixtures";
import { REQUISITION_CATALOGUE } from "./quartermaster";
import { withFacilityLevel } from "./wiring/probes";

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const rich = (s: GameState): GameState => ({ ...s, credits: new Decimal(1_000_000), captains: s.captains.map((c) => ({ ...c, level: 10 })) });

// ===== B1: the requiresResearch rung gate =====

describe("B1: a rung's requiresResearch gate checks the researched blueprint", () => {
  const KEY = "wr4ResearchGatedFacility";
  const withGatedFacility = <T,>(fn: () => T): T => {
    (FACILITIES as Record<string, unknown>)[KEY] = {
      label: "Gated",
      upgrades: [{ materials: {}, durationTicks: 1, effect: { addRefineSlots: 1 }, requiresResearch: ["frameSegmentBp"] }],
    };
    try {
      return fn();
    } finally {
      delete (FACILITIES as Record<string, unknown>)[KEY];
    }
  };

  it("refuses until the blueprint is researched, naming it, then allows", () => {
    withGatedFacility(() => {
      const s = freshState();
      expect(canBuildFacilityUpgrade(s, KEY)).toEqual({ ok: false, reason: `Requires research: ${BLUEPRINTS.frameSegmentBp.label}` });
      expect(canBuildFacilityUpgrade({ ...s, researchedBlueprints: [...s.researchedBlueprints, "frameSegmentBp"] }, KEY)).toEqual({ ok: true });
    });
  });
});

// ===== B2 / OC-I3: transports launch at the ore cap =====

describe("B2: a full Titanium Ore warehouse never blocks a supply run", () => {
  const atCap = (): GameState => {
    const s = rich(freshState());
    return { ...s, inventory: addItemQuality(s.inventory, "commonOre", tierCap(s, 1), 0) };
  };
  it("both transports dispatch at the ore cap; an ore run still stops", () => {
    const s = atCap();
    expect(canDispatch(s, 1, "frontierSupplyRun")).toEqual({ ok: true });
    expect(canDispatch(s, 1, "colonySupplyLift")).toEqual({ ok: true });
    expect(canDispatch(s, 1, "shortOreRun")).toEqual({ ok: false, reason: "materialAtCap" });
  });
  it("a supply run dispatched at the cap keeps running and earns its margin", () => {
    const r = dispatchCaptainOnMission(atCap(), 1, "frontierSupplyRun");
    expect(r.success).toBe(true);
    let s = r.next;
    const rng = lcg(7);
    for (let i = 0; i < 400; i++) s = economyTick(s, 1, rng);
    expect(s.captains[0].mission).not.toBeNull();
    expect(s.credits.gt(r.next.credits)).toBe(true);
  });
});

// ===== B8: the utility gear hard caps =====

describe("B8: the utility suites have no hard cap (D23)", () => {
  it("utilityGear.ts exports no *_MAX cap", () => {
    expect(Object.keys(utilityGear).filter((k) => k.endsWith("_MAX"))).toEqual([]);
  });
});

// ===== B19: the roster shows expeditions and repairs =====

describe("B19: the ship roster names an expedition and a repair", () => {
  const rowOf = (s: GameState) =>
    buildShipRoster(s, { sortKey: "name", filterKey: "all", searchText: "", favorites: new Set() }).groups.flatMap((g) => g.rows).find((r) => r.id === "ship-1")!;

  it("a ship on an expedition reads expedition, not idle", () => {
    const s = withMinimumAwayTeam(freshState());
    const res = startExpedition(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id);
    expect(res.success).toBe(true);
    expect(rowOf(res.next).status).toBe("expedition");
  });

  it("a ship under Shipyard repair reads repairing", () => {
    const base = freshState();
    const s = processShipRepairs({ ...base, ships: base.ships.map((sh) => ({ ...sh, typeKey: "destroyer" as ShipTypeKey, damaged: true, repairDamage: 100 })) });
    expect(s.activeProcesses.some((p) => p.kind === "shipRepair")).toBe(true);
    expect(rowOf(s).status).toBe("repairing");
  });
});

// ===== B20: display drift =====

describe("B20: the berth ETA and the dispatch popup's rare chance follow the engine", () => {
  it("the berth ETA covers a big hold's real unload, not the raw mission unloadTicks", () => {
    const base = freshState();
    const hull: ShipTypeKey = "prospectorHauler";
    const n = 3;
    const def = MISSIONS.shortOreRun;
    const captains = Array.from({ length: n }, (_, i) => ({ ...base.captains[0], id: i + 1, label: `C${i + 1}`, mission: null as CaptainMissionState | null }));
    const ships = Array.from({ length: n }, (_, i) => ({ id: `ship-${i + 1}`, typeKey: hull, assignedCaptainId: i + 1 }));
    let s: GameState = { ...base, captains, ships, shipStorageCapacity: Math.max(base.shipStorageCapacity, n) };
    const effective = effectiveMissionDef(def, effectiveShipStats(s, s.ships[0]));
    expect(effective.unloadTicks).toBeGreaterThan(def.unloadTicks); // the fixture really is a big hold
    s = {
      ...s,
      captains: s.captains.map((c) => ({
        ...c,
        mission: { kind: "extraction", missionKey: "shortOreRun", phase: "transitBack", phaseProgressTicks: effective.transitBackTicks, cargo: { commonOre: new Decimal(0), uncommonMaterial: new Decimal(0), rareMaterial: new Decimal(0) }, recalled: false } as CaptainMissionState,
      })),
    };
    expect(berthEtaTicks(s, 3)).toBeGreaterThanOrEqual(effective.unloadTicks);
  });

  it("the popup's drop chances are the engine's: the museum rare-material chance counts", () => {
    // Two Deep Earth relics, ten copies each: the set's 2-piece tier is the museum rare-material chance.
    const s: GameState = { ...freshState(), relicMuseum: { geodeCore: 10, magmaPearl: 10 } };
    const raw = MISSIONS.surveyMineralAnomaly.rareChance;
    const chances = missionDropChances(s, s.captains[0], "surveyMineralAnomaly");
    expect(chances.uncommon).toBeCloseTo(MISSIONS.surveyMineralAnomaly.uncommonChance, 12);
    expect(chances.rare).toBeGreaterThan(raw);
    expect(missionDropChances(freshState(), freshState().captains[0], "surveyMineralAnomaly").rare).toBeCloseTo(raw, 12);
  });
});

// ===== B24: false player text =====

describe("B24: talent and blurb text says what the engine does", () => {
  it("the primary talents name the tier, not Titanium Ore (they lift every mission's tier)", () => {
    const text = describeCaptainTalentEffect({ type: "commonYieldMult", mult: 0.05 });
    expect(text).not.toContain(ITEMS.commonOre.label);
    expect(text).toContain("common");
  });
  it("the economy trickle names the material, not its raw key", () => {
    const text = describeHomeworldTalentEffect({ type: "passiveTrickle", material: "commonOre", perTick: 1 });
    expect(text).toContain(ITEMS.commonOre.label);
    expect(text).not.toContain("commonOre");
  });
  it("the FTL Drive baseline blurb says range, not fuel burn", () => {
    expect(REQUISITION_CATALOGUE.ftlDrive?.blurb).not.toContain("fuel burn");
  });
});

// ===== retired fields =====

describe("WR-4 retired fields are gone", () => {
  it("ShipTypeDef.cost and awayTeams[].count no longer exist on any hull", () => {
    for (const [key, def] of Object.entries(SHIP_TYPES)) {
      expect("cost" in def, key).toBe(false);
      for (const t of def.awayTeams ?? []) expect("count" in t, `${key}:${t.teamType}`).toBe(false);
    }
  });
  it("shipLoadout.compareInstall is gone (it had no caller)", () => {
    expect("compareInstall" in shipLoadout).toBe(false);
  });
});

// ===== OC-C2 / B7: a Dense Ore source =====

describe("OC-C2: Dense Ore has a source, so Warehouse T2 past its first rung is reachable", () => {
  it("the Lunar Mine Contract's uncommon strike is Dense Ore", () => {
    expect(MISSIONS.longOreRun.lootTable.uncommon).toBe("denseOre");
  });
  it("a Lunar Mine run delivers Dense Ore", () => {
    const r = dispatchCaptainOnMission(rich(freshState()), 1, "longOreRun");
    let s = r.next;
    const rng = lcg(0x10a1);
    for (let i = 0; i < 3000; i++) s = economyTick(s, 1, rng);
    expect(itemTotal(s.inventory, "denseOre").gt(0)).toBe(true);
  });
  it("Warehouse T2's Dense Ore rung builds once the ore is in stock", () => {
    const s0 = withFacilityLevel(freshState(), "warehouseT2", 1);
    const cost = FACILITIES.warehouseT2.upgrades[1].materials.denseOre!;
    const stocked = { ...s0, inventory: addItemQuality(s0.inventory, "denseOre", cost, 0) };
    expect(canBuildFacilityUpgrade(stocked, "warehouseT2")).toEqual({ ok: true });
  });
});

// ===== OC-C3 / B6: Refinery recipes for Reclaimed Alloy and Purified Biomass =====

describe("OC-C3: Reclaimed Alloy and Purified Biomass are refined and consumed", () => {
  const recipeFor = (item: string) => Object.values(REFINE_RECIPES).find((r) => r.output.itemId === item);
  it("Scrap Alloy refines into Reclaimed Alloy; Fibrous Biomass into Purified Biomass", () => {
    expect(Object.keys(recipeFor("reclaimedAlloy")?.input ?? {})).toEqual(["scrapAlloy"]);
    expect(Object.keys(recipeFor("purifiedBiomass")?.input ?? {})).toEqual(["fibrousBiomass"]);
  });
  it("each is an input to an existing Fabricator recipe", () => {
    const consumers = (item: string) => Object.values(BLUEPRINTS).filter((b) => (b.recipe.inputs[item] ?? 0) > 0).map((b) => b.key);
    expect(consumers("reclaimedAlloy").length).toBeGreaterThan(0);
    expect(consumers("purifiedBiomass").length).toBeGreaterThan(0);
  });
});
