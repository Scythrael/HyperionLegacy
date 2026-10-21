// Reactor fuel ladder + Cometary Ice Harvest + reactor tech foundation (0.14.0, capture
// docs/plans/2026-10-21-reactor-fuel-and-recipe-realism-capture.md sections 1 to 6): GOLDENS FIRST, captured before
// any engine edit. What this slice may move, and what it must not:
//   1. recipes   : every Reactor Core blueprint's inputs as they stand before the fuel ladder.
//   2. inspect   : the piece each Reactor Core blank rolls (a crafted reactor's roll never reads its recipe).
//   3. salvage   : what one salvage of each crafted Reactor Core gives back at fixed band draws.
//   4. power     : the EM-1 power budget of every hull with its Standard-Issue core and with each crafted core.
//   5. missions  : the mission catalog's keys and each def, and every mission flown from dispatch for 300 seconds
//                  (an in-flight mission must stay byte-identical).
// Test-only.

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import { BLUEPRINTS, MISSIONS, SHIP_TYPES, freshState, type GameState, type MissionKey, type ShipTypeKey } from "./model";
import { canDispatch, dispatchCaptainOnMission, economyTick, inspectBlank } from "./tick";
import { salvageEquipment } from "./salvage";
import { shipPowerBudget } from "./shipPower";
import { hash, onHull, stateHash } from "./firstRunsGoldens.fixture";

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

describe("RX-0 goldens: reactor recipes, crafted reactors, power budget and the mission catalog", () => {
  it("recipes: every Reactor Core blueprint and its inputs", () => {
    pin("recipes", REACTOR_BPS.map((k) => [k, BLUEPRINTS[k].tier, BLUEPRINTS[k].equipmentOutput!.varietyKey, BLUEPRINTS[k].recipe.inputs]));
  });

  it("inspect: the piece each Reactor Core blank rolls", () => {
    pin("inspect", REACTOR_BPS.map((k) => [k, hash(inspected(k).equipment.at(-1))]));
  });

  it("salvage: one salvage of each crafted Reactor Core at four band draws", () => {
    pin(
      "salvage",
      REACTOR_BPS.map((k) => {
        const s = inspected(k);
        const id = s.equipment.at(-1)!.id;
        return [k, BANDS.map((band) => {
          const r = salvageEquipment(s, id, () => band);
          return r.ok ? r.recovered : r.reason;
        })];
      }),
    );
  });

  it("power: every hull's budget with its Standard-Issue core and with each crafted core", () => {
    pin("power", HULLS.map((hull) => [hull, hash([powerRow(onHull(hull)), ...REACTOR_BPS.map((k) => powerRow(withCraftedCore(hull, k)))])]));
  });

  it("missions: the catalog's keys and each def", () => {
    pin("missionKeys", Object.keys(MISSIONS));
    pin("missionDefs", (Object.keys(MISSIONS) as MissionKey[]).map((k) => [k, hash(MISSIONS[k])]));
  });

  it("missions: every mission flown from dispatch for 300 seconds on a General Freighter", () => {
    pin("flown", (Object.keys(MISSIONS) as MissionKey[]).map((k) => [k, flown(k)]));
  });
});
