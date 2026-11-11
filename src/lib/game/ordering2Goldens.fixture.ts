// ORDERING DETERMINISM PART 2 GOLDENS (docs/plans/2026-10-22-roadmap-and-release-gates.md, "Ordering determinism slice
// BUILT (2026-11-11)", its "Still open" note): the runs whose ORDER differed between chunkings while every value matched,
// captured on feat 29993f09 BEFORE part 2 (ORDERING2_PINS_PRE).
//
// Each row is the whole state (stateHash), the key order of `inventory`, and the completion log as `id:kind:subject`
// entries, so a pin that moves names what moved. Every run is taken three ways: in 1 s steps (the live game, and the
// offline catch-up `tick`), in one economyTick call, and in 997 s chunks.
//   patrol      : Dispatch Once on a Destroyer to its end (new inventory keys met in another order by the steps).
//   twoCaptains : captain 1 on a Lunar Mine Contract and captain 2 on a Local Asteroid run for 1000 s (the part 1 run).
//   salvage     : the part 1 salvage run: a material salvage completing at second 5 beside the patrol (the recovered
//                 item gains its inventory key after the patrol's loot in one call, before it in 1 s steps).
//   relics      : four relic studies at Lab VII started longest first (array order is the reverse of completion order),
//                 so one call logs them in array order and 1 s steps in completion order.
//   processes   : five processes in array order 9, 7, 6, 4 and 3 ticks from done (two upgrades, two refine jobs adding
//                 new inventory keys, a relic study): the log and the inventory keys, met in array order by one call.
//   oldSave     : the two captains on a save whose inventory is in first-seen order (keys an older build wrote).
//
// TEST-ONLY (imported by *.test.ts files only).

import Decimal from "break_infinity.js";
import { freshState, type GameState, type RelicVaultToken, type TimedProcess } from "./model";
import { startRelicStudy } from "./tick";
import { cp16PatrolStart, patrolSecondsToEnd, steppedBy } from "./cp16Goldens.fixture";
import { stateHash } from "./firstRunsGoldens.fixture";
import { twoCaptainsStart } from "./orderingGoldens.fixture";

// The view a row is read through (the identity, or ordering2Switch.fixture.ts asOrdering2 for the trace).
let view: (s: GameState) => GameState = (s) => s;
function row(raw: GameState): string[] {
  const s = view(raw);
  return [
    stateHash(s),
    Object.keys(s.inventory).join(","),
    s.completionLog.map((e) => `${e.id}:${e.kind}:${e.subjectKey ?? ""}`).join(","),
  ];
}

// The part 1 salvage run: a held Damaged Weapon System salvaged (done at second 5) beside the patrol.
export function salvageStart(): { s0: GameState; n: number } {
  const job: TimedProcess = {
    id: "proc-salvage",
    kind: "salvageJob",
    remainingTicks: 5,
    durationTicks: 5,
    effect: { type: "salvageResolve", target: { kind: "material", itemId: "damagedWeaponSystem" } },
  };
  const patrol = cp16PatrolStart();
  const s0: GameState = {
    ...patrol,
    inventory: { ...patrol.inventory, damagedWeaponSystem: [new Decimal(3)] },
    activeProcesses: [...patrol.activeProcesses, job],
  };
  return { s0, n: patrolSecondsToEnd(patrol) };
}

// Four relic studies at Lab VII, started longest first (the orderingParity.test.ts run).
export function relicsStart(): { s0: GameState; n: number } {
  const rarities = ["radiant", "stellar", "augmented", "standard"] as const;
  const vault: RelicVaultToken[] = rarities.map((tier, i) => ({ id: `vault-${i}`, tier, quality: 0, ...(i % 2 === 0 ? {} : { regionTier: 7 as const }) }));
  let s: GameState = { ...freshState(1), facilities: { ...freshState(1).facilities, research: { level: 7 } }, relicVault: vault, relicQueue: [] };
  for (const t of vault) {
    const r = startRelicStudy(s, t.id);
    if (!r.started) throw new Error(`ordering2 goldens: relic study ${t.id} did not start`);
    s = r.next;
  }
  return { s0: s, n: Math.max(...s.activeProcesses.map((p) => p.remainingTicks)) + 5 };
}

// Five processes whose array order is the reverse of their completion order: a Salvage Bay upgrade (9), a refine job
// adding Titanium Ingot (7), a relic study (6), a refine job adding Polysilicate Wafer (4), a Research Lab upgrade (3).
export function processesStart(): { s0: GameState; n: number } {
  const base: GameState = {
    ...freshState(1),
    facilities: { ...freshState(1).facilities, research: { level: 1 } },
    relicVault: [{ id: "vault-p", tier: "standard", quality: 0 }],
    relicQueue: [],
  };
  const started = startRelicStudy(base, "vault-p");
  if (!started.started) throw new Error("ordering2 goldens: the process run's relic study did not start");
  const study = started.next.activeProcesses.find((p) => p.kind === "relicStudy")!;
  const refine = (id: string, itemId: string, remainingTicks: number): TimedProcess => ({
    id,
    kind: "refineJob",
    remainingTicks,
    durationTicks: remainingTicks,
    effect: { type: "addItem", itemId, amount: new Decimal(2) },
  });
  const activeProcesses: TimedProcess[] = [
    { id: "proc-900", kind: "facilityUpgrade", remainingTicks: 9, durationTicks: 9, effect: { type: "facilityLevelUp", facility: "salvageBay" } },
    refine("proc-901", "titaniumIngot", 7),
    { ...study, remainingTicks: 6 },
    refine("proc-902", "polysilicateWafer", 4),
    { id: "proc-903", kind: "facilityUpgrade", remainingTicks: 3, durationTicks: 3, effect: { type: "facilityLevelUp", facility: "research" } },
  ];
  return { s0: { ...started.next, activeProcesses }, n: 12 };
}

// The two captains on a save an older build wrote: inventory keys in the order they were first met (not canonical).
export function oldSaveStart(): GameState {
  const base = twoCaptainsStart();
  return {
    ...base,
    inventory: { titaniumIngot: [new Decimal(4)], deuteriumIce: [new Decimal(2)], ...base.inventory },
  };
}

export function ordering2Rows(through: (s: GameState) => GameState = (s) => s): Record<string, unknown> {
  view = through;
  const got: Record<string, unknown> = {};
  const three = (name: string, s0: GameState, n: number): void => {
    got[`${name}:steps`] = row(steppedBy(s0, n, 1));
    got[`${name}:oneCall`] = row(steppedBy(s0, n, n));
    got[`${name}:chunks`] = row(steppedBy(s0, n, 997));
  };
  const patrol = cp16PatrolStart();
  three("patrol", patrol, patrolSecondsToEnd(patrol));
  three("twoCaptains", twoCaptainsStart(), 1000);
  const salvage = salvageStart();
  three("salvage", salvage.s0, salvage.n);
  const relics = relicsStart();
  three("relics", relics.s0, relics.n);
  const processes = processesStart();
  three("processes", processes.s0, processes.n);
  three("oldSave", oldSaveStart(), 1000);
  view = (s) => s;
  return got;
}

// Captured on feat 29993f09, before part 2.
export const ORDERING2_PINS_PRE: Record<string, unknown> = {
  "patrol:steps": ["12f48ea7","commonOre,uncommonMaterial,rareMaterial,intactReactorCore,powerCoupling,titaniumIngot","done-1:patrolRun:crimsonReaverSweep"],
  "patrol:oneCall": ["12f48ea7","commonOre,uncommonMaterial,rareMaterial,intactReactorCore,powerCoupling,titaniumIngot","done-1:patrolRun:crimsonReaverSweep"],
  "patrol:chunks": ["12f48ea7","commonOre,uncommonMaterial,rareMaterial,intactReactorCore,powerCoupling,titaniumIngot","done-1:patrolRun:crimsonReaverSweep"],
  "twoCaptains:steps": ["42d9cdf8","commonOre,uncommonMaterial,rareMaterial,ferriteOre,denseOre,osmiumOre",""],
  "twoCaptains:oneCall": ["42d9cdf8","commonOre,uncommonMaterial,rareMaterial,ferriteOre,denseOre,osmiumOre",""],
  "twoCaptains:chunks": ["42d9cdf8","commonOre,uncommonMaterial,rareMaterial,ferriteOre,denseOre,osmiumOre",""],
  "salvage:steps": ["6105338f","commonOre,uncommonMaterial,rareMaterial,damagedWeaponSystem,intactReactorCore,powerCoupling,polysilicateWafer,titaniumIngot","done-1:salvageJob:damagedWeaponSystem,done-2:patrolRun:crimsonReaverSweep"],
  "salvage:oneCall": ["2e12f97f","commonOre,uncommonMaterial,rareMaterial,damagedWeaponSystem,intactReactorCore,powerCoupling,titaniumIngot,polysilicateWafer","done-1:salvageJob:damagedWeaponSystem,done-2:patrolRun:crimsonReaverSweep"],
  "salvage:chunks": ["2e12f97f","commonOre,uncommonMaterial,rareMaterial,damagedWeaponSystem,intactReactorCore,powerCoupling,titaniumIngot,polysilicateWafer","done-1:salvageJob:damagedWeaponSystem,done-2:patrolRun:crimsonReaverSweep"],
  "relics:steps": ["aa5e06ef","commonOre,uncommonMaterial,rareMaterial","done-1:relicStudy:hullRivet,done-2:relicStudy:resonanceShard,done-3:relicStudy:flightRecorder,done-4:relicStudy:starChartFragment"],
  "relics:oneCall": ["3480c77b","commonOre,uncommonMaterial,rareMaterial","done-1:relicStudy:starChartFragment,done-2:relicStudy:flightRecorder,done-3:relicStudy:resonanceShard,done-4:relicStudy:hullRivet"],
  "relics:chunks": ["2fc27e19","commonOre,uncommonMaterial,rareMaterial","done-1:relicStudy:resonanceShard,done-2:relicStudy:hullRivet,done-3:relicStudy:starChartFragment,done-4:relicStudy:flightRecorder"],
  "processes:steps": ["f0bd4c7d","commonOre,uncommonMaterial,rareMaterial,polysilicateWafer,titaniumIngot","done-1:facilityUpgrade:research,done-2:refineJob:polysilicateWafer,done-3:relicStudy:resonanceShard,done-4:refineJob:titaniumIngot,done-5:facilityUpgrade:salvageBay"],
  "processes:oneCall": ["f3c03f4d","commonOre,uncommonMaterial,rareMaterial,titaniumIngot,polysilicateWafer","done-1:facilityUpgrade:salvageBay,done-2:refineJob:titaniumIngot,done-3:relicStudy:resonanceShard,done-4:refineJob:polysilicateWafer,done-5:facilityUpgrade:research"],
  "processes:chunks": ["f3c03f4d","commonOre,uncommonMaterial,rareMaterial,titaniumIngot,polysilicateWafer","done-1:facilityUpgrade:salvageBay,done-2:refineJob:titaniumIngot,done-3:relicStudy:resonanceShard,done-4:refineJob:polysilicateWafer,done-5:facilityUpgrade:research"],
  "oldSave:steps": ["67c3c219","titaniumIngot,deuteriumIce,commonOre,uncommonMaterial,rareMaterial,ferriteOre,denseOre,osmiumOre",""],
  "oldSave:oneCall": ["67c3c219","titaniumIngot,deuteriumIce,commonOre,uncommonMaterial,rareMaterial,ferriteOre,denseOre,osmiumOre",""],
  "oldSave:chunks": ["67c3c219","titaniumIngot,deuteriumIce,commonOre,uncommonMaterial,rareMaterial,ferriteOre,denseOre,osmiumOre",""],
};
