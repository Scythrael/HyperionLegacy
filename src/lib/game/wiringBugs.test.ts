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
  type AwayMember,
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
import { effectiveMissionDef, withGeneralMuseumRecord } from "./model";
import { addItemQuality, itemTotal } from "./inventory";
import { expeditionCandidates, startExpedition } from "./expedition";
import { asPreFieldKitsDispatch, plainAwayMember, withMinimumAwayTeam, withSlottedAwayTeams } from "./awayTeamTestFixtures";
import { REQUISITION_CATALOGUE } from "./quartermaster";
import { seatOfficer, withFacilityLevel } from "./wiring/probes";
import { PATROLS } from "./model";
import { dispatchCaptainOnPatrol, tick } from "./tick";
import { advanceExpedition, claimExpedition } from "./expedition";
import { canPromoteOfficer } from "./seniorStaff";
import { FUEL_DEPOT_REACH_PER_RUNG } from "./model";
import { fleetReachBonus, shipRangeLightYears, shipReachDef, shipReachesRoundTrip } from "./tick";
import * as tickModule from "./tick";
import { installMissingCombatBaselines } from "./tick";
import { equippedFor } from "./equipment";
import { combatHullTypeOf, shipToCombatant } from "./combat/bridge";
import { generateEnemyWave } from "./combat/enemyWave";
import { resolveBattle } from "./combat/resolveBattle";

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
    const s: GameState = withGeneralMuseumRecord(freshState(), { geodeCore: 10, magmaPearl: 10 });
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

// ===== B14 / OC-I4: turn order by side, then input order =====

describe("B14: a battle's turn order is by side, then input order, never by id spelling", () => {
  const fight = (prefix: string) => {
    const s = installMissingCombatBaselines({ ...freshState(), ships: freshState().ships.map((sh) => ({ ...sh, typeKey: "destroyer" as ShipTypeKey })) });
    const player = shipToCombatant({ id: "ship-1", team: "player", stats: SHIP_TYPES.destroyer, hullType: combatHullTypeOf("destroyer")!, installedGear: equippedFor(s, "ship-1") });
    const enemies = generateEnemyWave(0x5eed, { hullPool: ["raider", "marauder"], enemyCountMin: 2, enemyCountMax: 2, idPrefix: prefix });
    const { outcome, finalCombatants } = resolveBattle({ combatants: [player, ...enemies] }, 0xbad5eed);
    return {
      order: finalCombatants.map((c) => c.team),
      summary: JSON.stringify({ outcome, hulls: finalCombatants.map((c) => [c.team, c.hull, c.shield, c.alive]) }),
    };
  };

  it("the same fight reads the same whichever way the enemy ids spell", () => {
    expect(fight("aaa").summary).toBe(fight("zzz").summary);
  });

  it("the player side acts first (OC-I4: player, then enemies, each in input order)", () => {
    expect(fight("aaa").order).toEqual(["player", "enemy", "enemy"]);
  });
});

// ===== B4 / OC-E10: the promotion counters count =====

describe("B4: officer promotion counters are fed (OC-E10), starting at 0", () => {
  const officerOf = (s: GameState) => s.officers.find((o) => o.assignedShipId === "ship-1")!;

  it("crewHours: the officer's ship's hours out on a run (a mission)", () => {
    const s0 = seatOfficer(rich(freshState()), "operations", ["ops.cargoExpand"]);
    expect(officerOf(s0).promotionCounters?.crewHours ?? 0).toBe(0);
    const r = dispatchCaptainOnMission(s0, 1, "shortOreRun");
    let s = r.next;
    const rng = lcg(3);
    for (let i = 0; i < 3600; i++) s = economyTick(s, 1, rng);
    expect(officerOf(s).promotionCounters?.crewHours ?? 0).toBeCloseTo(1, 9);
    // An idle ship's officer gains nothing.
    let idle = s0;
    for (let i = 0; i < 600; i++) idle = economyTick(idle, 1, rng);
    expect(officerOf(idle).promotionCounters?.crewHours ?? 0).toBe(0);
  });

  it("crewHours: offline equals live (one call, 997 s chunks, 1 s ticks)", () => {
    const s0 = dispatchCaptainOnMission(seatOfficer(rich(freshState()), "operations", ["ops.cargoExpand"]), 1, "shortOreRun").next;
    const one = tick(1994, s0, () => 0.5);
    let chunked = s0;
    for (let i = 0; i < 2; i++) chunked = tick(997, chunked, () => 0.5);
    let live = s0;
    for (let i = 0; i < 1994; i++) live = tick(1, live, () => 0.5);
    expect(officerOf(one).promotionCounters).toEqual(officerOf(chunked).promotionCounters);
    expect(officerOf(one).promotionCounters).toEqual(officerOf(live).promotionCounters);
  });

  it("shipsDestroyed: every enemy a patrol destroys", () => {
    const s0 = seatOfficer(installMissingCombatBaselines(rich({ ...freshState(), ships: freshState().ships.map((sh) => ({ ...sh, typeKey: "destroyer" as ShipTypeKey })) })), "tactical", ["tac.weaponCommand"]);
    const r = dispatchCaptainOnPatrol(s0, 1, "crimsonReaverSweep", "balanced", false);
    expect(r.success).toBe(true);
    let s = r.next;
    let waves = 0;
    for (let i = 0; i < 2000 && s.captains[0].mission !== null; i++) {
      s = economyTick(s, 1, () => 0.5);
      const m = s.captains[0].mission;
      if (m && m.kind === "patrol") waves = m.wavesWon;
    }
    expect(waves).toBeGreaterThan(0);
    // The Sweep fields one enemy per wave (PATROLS enemyCountMin == enemyCountMax == 1), every won wave a kill.
    expect(PATROLS.crimsonReaverSweep.enemyCountMax).toBe(1);
    expect(officerOf(s).promotionCounters?.shipsDestroyed).toBe(waves);
  });

  it("personnelAchievement and shipsDestroyed at an expedition's claim: objectives done and ship battles won", () => {
    // The wiringGoldens expedition fixture (a squad that finishes its run).
    const squad: AwayMember[] = [
      { ...plainAwayMember("member-1", "security", "ship-1"), rank: 3 },
      { ...plainAwayMember("member-2", "security", "ship-1"), rank: 2, traits: ["fieldMedic"] },
      plainAwayMember("member-11", "science", "ship-1"),
    ];
    const s0 = seatOfficer(withSlottedAwayTeams({ ...freshState(), awayMembers: squad, nextAwayMemberId: 100, expeditionSeed: 0x1234 }), "science", ["sci.discovery"]);
    const res = asPreFieldKitsDispatch(startExpedition(s0, "ship-1", 1, expeditionCandidates(s0, "ship-1")[0].id));
    const done = advanceExpedition(res.expedition!, 2_000_000);
    expect(done.phase).toBe("complete");
    const claim = claimExpedition({ ...res.next, expeditions: [done], gameTimeSeconds: 2_000_000 }, done.id);
    expect(claim.success).toBe(true);
    const objectives = done.bodies.flatMap((b) => b.activities).filter((a) => a.done).length;
    const shipWins = (done.scanEvents ?? []).filter((e) => e.kind === "shipEvent" && e.outcome === "win").length;
    expect(objectives).toBeGreaterThan(0);
    const counters = officerOf(claim.next).promotionCounters ?? {};
    expect(counters.personnelAchievement ?? 0).toBe(objectives);
    expect(counters.shipsDestroyed ?? 0).toBe(shipWins);
  });

  it("a cadet who meets every row of its checklist can promote", () => {
    const s0 = seatOfficer(freshState(), "operations", ["ops.cargoExpand"]);
    const o = { ...officerOf(s0), rank: "cadet" as const, missionsCompleted: 10, promotionCounters: { crewHours: 50 } };
    expect(canPromoteOfficer(o)).toBe(true);
    expect(canPromoteOfficer({ ...o, promotionCounters: { crewHours: 49.5 } })).toBe(false);
  });
});

// ===== OC-C1 / B5: the Fuel Depot becomes the fleet reach track; the fuel stockpile and Buy Fuel are retired =====

describe("OC-C1: every Fuel Depot level adds to the whole fleet's reach", () => {
  it("fleetReachBonus sums the built rungs; no rung, no bonus", () => {
    const rung = FUEL_DEPOT_REACH_PER_RUNG;
    expect(fleetReachBonus(freshState())).toBe(0);
    expect(fleetReachBonus(withFacilityLevel(freshState(), "fuelStorage", 3))).toBeCloseTo(3 * rung, 12);
    const top = FACILITIES.fuelStorage.upgrades.length;
    expect(fleetReachBonus(withFacilityLevel(freshState(), "fuelStorage", top))).toBeCloseTo(top * rung, 12);
    for (const up of FACILITIES.fuelStorage.upgrades) expect(up.effect).toEqual({ fleetReachBonus: rung });
  });

  it("the range readout and the dispatch gate both grow by the bonus, for every ship", () => {
    const base = freshState();
    const built = withFacilityLevel(base, "fuelStorage", 4);
    const bonus = fleetReachBonus(built);
    expect(shipRangeLightYears(built, built.ships[0])).toBeCloseTo(shipRangeLightYears(base, base.ships[0]) * (1 + bonus), 9);
    // A round trip just past the bare reach: refused bare, allowed with the Depot built.
    const def = shipReachDef(base, base.ships[0]);
    const legs = Math.floor((def.fuelCapacity * (1 + def.engineEfficiency)) / 2) + 1;
    expect(shipReachesRoundTrip(base, base.ships[0], legs, legs)).toBe(false);
    expect(shipReachesRoundTrip(built, built.ships[0], legs, legs)).toBe(true);
  });

  it("the fuel stockpile and Buy Fuel are gone", () => {
    expect("fuel" in freshState()).toBe(false);
    expect("buyFuel" in tickModule).toBe(false);
    expect("fuelCap" in tickModule).toBe(false);
  });
});
