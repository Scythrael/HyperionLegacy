// Reactor fuel ladder + Cometary Ice Harvest + reactor tech foundation (0.14.0, capture
// docs/plans/2026-10-21-reactor-fuel-and-recipe-realism-capture.md sections 1 to 6): GOLDENS FIRST, captured before
// any engine edit (GOLDEN), then the slice's moves, each held apart and explained (AFTER). What this slice may move,
// and what it must not:
//   1. recipes   : every Reactor Core blueprint's inputs as they stand before the fuel ladder.
//   2. inspect   : the piece each Reactor Core blank rolls (a crafted reactor's roll never reads its recipe).
//   3. salvage   : what one salvage of each crafted Reactor Core gives back at fixed band draws.
//   4. power     : the EM-1 power budget of every hull with its Standard-Issue core and with each crafted core.
//   5. missions  : the mission catalog's keys and each def, and every mission flown from dispatch for 300 seconds
//                  (an in-flight mission must stay byte-identical).
//
// MOVED BY the slice (each move proven to be its only one):
//   recipes  : every Reactor Core recipe gains its fuel canister, appended LAST (Deuterium Canisters, the user's 1 / 1 / 2:
//              Balanced and Efficient one each, High-Output two). Dropping the fuel reproduces the capture.
//   salvage  : a salvaged crafted core can give back part of its canister too (salvage refunds every recipe input);
//              the older lines draw first, so dropping the canister column reproduces the capture exactly.
//   missions : the Cometary Ice Harvest is appended to the catalog; every earlier key, def and flown run is unchanged.
// UNCHANGED: every inspected piece, every hull's power budget (the EM-1 fields; the three tech fields are new and
// read fusion / none / met on every ship), and every earlier mission flown from dispatch (in-flight byte-identical).
// Test-only.

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import { BLUEPRINTS, MISSIONS, SHIP_TYPES, freshState, type GameState, type MissionKey, type ShipTypeKey } from "./model";
import { canDispatch, dispatchCaptainOnMission, economyTick, inspectBlank } from "./tick";
import { salvageEquipment } from "./salvage";
import { shipPowerBudget } from "./shipPower";
import { hash, onHull, stateHash } from "./firstRunsGoldens.fixture";
import { PRE_RX_MISSION_KEYS, RX_ADDED_ENTRY_IDS, RX_NEW_MISSIONS } from "./reactorFuelGoldens.fixture";
import { reactorCoreFuel } from "./reactorTech";
import { WIRING_REGISTRY } from "./wiring/registry";
import { shipReachesRoundTrip, shipTripRangeLightYears } from "./tick";

const HULLS = Object.keys(SHIP_TYPES) as ShipTypeKey[];
const REACTOR_BPS = Object.keys(BLUEPRINTS).filter((k) => BLUEPRINTS[k].equipmentOutput?.slotType === "reactorCore");
const BANDS = [0, 0.15, 0.5, 0.95];
const POWER_KEYS = ["output", "draw", "remaining", "overBudget", "baseOutput", "reactorOutput", "grossDraw", "efficiency", "reactorSurplus"] as const;

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// The piece a blank of `bp` rolls on a fresh save (inspect seed 0).
function inspected(bp: string): GameState {
  return inspectBlank({ ...freshState(), blanks: { [bp]: new Decimal(1) } }, bp);
}

// The budget's fields as EM-1 shipped them.
function powerRow(s: GameState): Record<string, unknown> {
  const b = shipPowerBudget(s, "ship-1") as unknown as Record<string, unknown>;
  return Object.fromEntries(POWER_KEYS.map((k) => [k, b[k]]));
}

// ship-1 on `hull` with its Standard-Issue reactor swapped for the piece a blank of `bp` rolls.
function withCraftedCore(hull: ShipTypeKey, bp: string): GameState {
  const base = onHull(hull);
  const rolled = inspected(bp).equipment.at(-1)!;
  const piece = { ...rolled, id: "golden-core", fittedToShipId: "ship-1" };
  return { ...base, equipment: [...base.equipment.filter((e) => !(e.fittedToShipId === "ship-1" && e.slotType === "reactorCore")), piece] };
}

const MAX_UNLOCK = Math.max(...Object.values(MISSIONS).map((m) => m.unlockLevel));

function flown(key: MissionKey): string {
  const b = onHull("generalFreighter");
  const s0: GameState = {
    ...b,
    captains: b.captains.map((c) => ({ ...c, level: 10 })),
    facilities: { ...b.facilities, missionControl: { ...b.facilities.missionControl, level: MAX_UNLOCK } },
  };
  const gate = canDispatch(s0, 1, key);
  if (!gate.ok) return `refused:${gate.reason}`;
  const r = dispatchCaptainOnMission(s0, 1, key);
  let s = r.next;
  const rng = lcg(0x2e7c);
  for (let t = 0; t < 300; t += 1) s = economyTick(s, 1, rng);
  return stateHash(s);
}

function pin(key: string, value: unknown): void {
  expect(value, key).toEqual(GOLDEN[key]);
}

// Captured on feat/crew-0.14.0 at c6e1d52, before the slice's engine edits.
const GOLDEN: Record<string, unknown> = {
  recipes: [["highOutputCoreBp",2,"highOutputCore",{"powerCoupling":3,"structuralAssembly":1}],["efficientCoreBp",1,"efficientCore",{"powerCoupling":2,"polysilicateWafer":3}],["balancedCoreBp",1,"balancedCore",{"powerCoupling":2,"polysilicateWafer":2,"titaniumIngot":1}]],
  inspect: [["highOutputCoreBp","23013b42"],["efficientCoreBp","ba4705a9"],["balancedCoreBp","34d5843f"]],
  salvage: [["highOutputCoreBp",[{"powerCoupling":1,"structuralAssembly":0},{"powerCoupling":0,"structuralAssembly":0},{"powerCoupling":1,"structuralAssembly":1},{"powerCoupling":1,"structuralAssembly":1}]],["efficientCoreBp",[{"powerCoupling":1,"polysilicateWafer":0},{"powerCoupling":0,"polysilicateWafer":1},{"powerCoupling":1,"polysilicateWafer":1},{"powerCoupling":1,"polysilicateWafer":1}]],["balancedCoreBp",[{"powerCoupling":1,"polysilicateWafer":0,"titaniumIngot":0},{"powerCoupling":0,"polysilicateWafer":0,"titaniumIngot":0},{"powerCoupling":1,"polysilicateWafer":1,"titaniumIngot":0},{"powerCoupling":1,"polysilicateWafer":1,"titaniumIngot":0}]]],
  power: [["generalFreighter","fd083983"],["prospectorHauler","fd083983"],["prospectorRunner","c9da9c7f"],["prospectorMiner","c9da9c7f"],["destroyer","62948be1"],["battleship","56e84c59"],["carrier","2a2f2c49"],["orion","99f14c35"],["aurora","1c9695e1"],["eir","4b26ee79"]],
  missionKeys: ["localFuelRun","shortOreRun","longOreRun","salvageWreckage","forageFlora","surveyMineralAnomaly","surveyStellarPhenomena","frontierSupplyRun","colonySupplyLift"],
  missionDefs: [["localFuelRun","95eca885"],["shortOreRun","81fafc31"],["longOreRun","13c04489"],["salvageWreckage","3a0dc738"],["forageFlora","da688ac9"],["surveyMineralAnomaly","e7f18c96"],["surveyStellarPhenomena","a1d89678"],["frontierSupplyRun","7d8bc8d"],["colonySupplyLift","314130f2"]],
  flown: [["localFuelRun","38a9647d"],["shortOreRun","4cf0e210"],["longOreRun","ee9cd2b0"],["salvageWreckage","640f5e37"],["forageFlora","a4e6283f"],["surveyMineralAnomaly","def4b1e7"],["surveyStellarPhenomena","f5f2bc68"],["frontierSupplyRun","2ab8d7ce"],["colonySupplyLift","c0083713"]],
};

// The slice's own additions, pinned after the engine edits.
const AFTER: Record<string, unknown> = {
  // The canister each salvage gives back at band draws 0, 0.15, 0.5 and 0.95 (chance-rounded through the private
  // stream after the older lines; the High-Output Core's recipe holds two).
  salvageCanister: [["highOutputCoreBp", [0, 0, 1, 1]], ["efficientCoreBp", [0, 0, 0, 0]], ["balancedCoreBp", [0, 0, 1, 1]]],
  cometDef: "31fd381",
  cometFlown: "da44f5b7",
  // Every hull reaches the 80-tick round trip and may fly it (no captain level or hold gate): hull, reaches, range
  // on this trip (LY), the dispatch gate.
  cometReach: [
    ["generalFreighter", true, 100, "ok"], ["prospectorHauler", true, 92, "ok"], ["prospectorRunner", true, 75, "ok"],
    ["prospectorMiner", true, 87.5, "ok"], ["destroyer", true, 78, "ok"], ["battleship", true, 94.5, "ok"],
    ["carrier", true, 93.50000000000001, "ok"], ["orion", true, 229.50000000000003, "ok"], ["aurora", true, 224, "ok"],
    ["eir", true, 195, "ok"],
  ],
  // The mission's per-field rows (its cargoCapacity pending on WR-11 like every mission's: the hull hold overwrites it),
  // the fuel rungs (fusion tiers I and II live, the larger fusion cores and the three higher tech tiers seams for the
  // balancing patch), the variety tags (live) and the hull requirement seam.
  registryAdded: [
    "mission:MISSIONS:cometIceHarvest:transitOutTicks|live",
    "mission:MISSIONS:cometIceHarvest:transitBackTicks|live",
    "mission:MISSIONS:cometIceHarvest:unloadTicks|live",
    "mission:MISSIONS:cometIceHarvest:extractionRatePerTick|live",
    "mission:MISSIONS:cometIceHarvest:rareChance|live",
    "mission:MISSIONS:cometIceHarvest:uncommonChance|live",
    "mission:MISSIONS:cometIceHarvest:fleetAdminXpPerTick|live",
    "mission:MISSIONS:cometIceHarvest:creditsPerCycle|live",
    "mission:MISSIONS:cometIceHarvest:lootTable|live",
    "mission:MISSIONS:cometIceHarvest:unlockLevel|live",
    "mission:MISSIONS:cometIceHarvest:primaryMaterial|live",
    "mission:MISSIONS:cometIceHarvest:cargoCapacity|pending",
    "facility:REACTOR_TECH_TIERS:fusion:fuel:0|live",
    "facility:REACTOR_TECH_TIERS:fusion:fuel:1|live",
    "facility:REACTOR_TECH_TIERS:fusion:fuel:2|seam",
    "facility:REACTOR_TECH_TIERS:deuteriumHelium3Fusion:fuel:0|seam",
    "facility:REACTOR_TECH_TIERS:antimatterCatalyzedFusion:fuel:0|seam",
    "facility:REACTOR_TECH_TIERS:antimatter:fuel:0|seam",
    "facility:REACTOR_VARIETY_TECH:highOutputCore|live",
    "facility:REACTOR_VARIETY_TECH:efficientCore|live",
    "facility:REACTOR_VARIETY_TECH:balancedCore|live",
    "ship:SHIP_SEAMS:hullReactorRequirement|seam",
  ],
};

function salvageRows(): [string, (Record<string, number> | string)[]][] {
  return REACTOR_BPS.map((k) => {
    const s = inspected(k);
    const id = s.equipment.at(-1)!.id;
    return [k, BANDS.map((band) => {
      const r = salvageEquipment(s, id, () => band);
      return r.ok ? r.recovered : r.reason;
    })];
  });
}

const withoutKey = (o: Record<string, number>, key: string): Record<string, number> => Object.fromEntries(Object.entries(o).filter(([k]) => k !== key));

describe("RX-0 goldens: reactor recipes, crafted reactors, power budget and the mission catalog", () => {
  it("recipes: every Reactor Core recipe is the capture plus its ladder fuel, appended last", () => {
    const now = REACTOR_BPS.map((k) => [k, BLUEPRINTS[k].tier, BLUEPRINTS[k].equipmentOutput!.varietyKey, BLUEPRINTS[k].recipe.inputs] as const);
    const captured = GOLDEN.recipes as [string, number, string, Record<string, number>][];
    expect(now.map(([k, tier, variety]) => [k, tier, variety])).toEqual(captured.map(([k, tier, variety]) => [k, tier, variety]));
    now.forEach(([k, tier, variety, inputs], i) => {
      const fuel = reactorCoreFuel(variety, tier);
      expect(fuel, k).toEqual({ deuteriumCanister: tier === 2 ? 2 : 1 }); // audit Group A: 1 / 1 / 2
      expect(Object.entries(inputs), k).toEqual(Object.entries({ ...captured[i][3], ...fuel }));
    });
  });

  it("inspect: the piece each Reactor Core blank rolls (unchanged)", () => {
    pin("inspect", REACTOR_BPS.map((k) => [k, hash(inspected(k).equipment.at(-1))]));
  });

  it("salvage: the capture with the canister column dropped, and the canister column itself", () => {
    const rows = salvageRows();
    expect(rows.map(([k, bands]) => [k, bands.map((b) => (typeof b === "string" ? b : withoutKey(b, "deuteriumCanister")))])).toEqual(GOLDEN.salvage);
    expect(rows.map(([k, bands]) => [k, bands.map((b) => (typeof b === "string" ? b : b.deuteriumCanister))])).toEqual(AFTER.salvageCanister);
  });

  it("power: every hull's EM-1 budget unchanged, and the tech fields fusion / none / met on every ship", () => {
    pin("power", HULLS.map((hull) => [hull, hash([powerRow(onHull(hull)), ...REACTOR_BPS.map((k) => powerRow(withCraftedCore(hull, k)))])]));
    for (const hull of HULLS) {
      for (const s of [onHull(hull), ...REACTOR_BPS.map((k) => withCraftedCore(hull, k))]) {
        const b = shipPowerBudget(s, "ship-1");
        expect([b.reactorTech, b.requiredReactorTech, b.reactorTechMet], hull).toEqual(["fusion", null, true]);
      }
    }
  });

  it("missions: the capture's keys and defs unchanged, the Cometary Ice Harvest appended", () => {
    expect(PRE_RX_MISSION_KEYS).toEqual(GOLDEN.missionKeys);
    expect(Object.keys(MISSIONS)).toEqual([...(GOLDEN.missionKeys as string[]), ...RX_NEW_MISSIONS]);
    expect(PRE_RX_MISSION_KEYS.map((k) => [k, hash(MISSIONS[k])])).toEqual(GOLDEN.missionDefs);
    expect(hash(MISSIONS.cometIceHarvest)).toBe(AFTER.cometDef);
  });

  it("missions: every earlier mission flown from dispatch for 300 seconds is unchanged; the comet run pinned", () => {
    expect(PRE_RX_MISSION_KEYS.map((k) => [k, flown(k)])).toEqual(GOLDEN.flown);
    expect(flown("cometIceHarvest")).toBe(AFTER.cometFlown);
  });

  it("missions: the Cometary Ice Harvest's reach and gate on every hull (the rows the reach goldens hold apart)", () => {
    const rows = HULLS.map((hull) => {
      const s = onHull(hull);
      const ship = s.ships.find((sh) => sh.id === "ship-1")!;
      const m = MISSIONS.cometIceHarvest;
      const gate = canDispatch(s, 1, "cometIceHarvest");
      return [hull, shipReachesRoundTrip(s, ship, m.transitOutTicks, m.transitBackTicks), shipTripRangeLightYears(s, ship, m.transitOutTicks + m.transitBackTicks), gate.ok ? "ok" : gate.reason];
    });
    expect(rows).toEqual(AFTER.cometReach);
  });

  it("registry: the entries the slice adds, with their statuses (every registry pin holds them apart)", () => {
    expect(WIRING_REGISTRY.filter((e) => RX_ADDED_ENTRY_IDS.has(e.id)).map((e) => `${e.id}|${e.status.kind}`)).toEqual(AFTER.registryAdded);
  });
});
