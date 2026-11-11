// ORDERING DETERMINISM GOLDENS (docs/plans/2026-10-22-roadmap-and-release-gates.md, "Ordering wrinkles found by CP-14 /
// CP-16 parity tests"): the runs whose ORDER differed between chunkings while every value matched, captured on feat
// 2c66d749 BEFORE the slice (ORDERING_PINS_PRE).
//
// Each row is the whole state (stateHash), the codex's `discovered` list as it stands, and the key order of the four
// lifetime tally maps (itemsGathered | itemsRefined | itemsCrafted | missionsCompleted), so a pin that moves names what
// moved. Every run is taken three ways: in 1 s steps (the live game, and the offline catch-up `tick`), in one
// economyTick call, and in 997 s chunks.
//   patrol       : Dispatch Once on a Destroyer to its end (three finds: the steps meet them in another order).
//   shortRange   : an Eir's first short-range run (900 s; two finds).
//   twoCaptains  : captain 1 on a Lunar Mine Contract and captain 2 on a Local Asteroid run for 1000 s: captain 2's
//                  first delivery comes first in time, captain 1 comes first in a call's captain loop.
//   offline      : the same two captains four hours on: the offline catch-up (`tick`), 1 s steps and 97 s chunks. Not one
//                  call or 997 s chunks: one economyTick call spends one transit berth budget (the EM-4 precedent, at
//                  most 10 claims with every rung), so a span that brings more ships home than that differs in VALUES
//                  between chunkings by design; 97 s chunks stay within it (the emodEm4.test.ts precedent).
//
// TEST-ONLY (imported by *.test.ts files only).

import type { CaptainState, GameState } from "./model";
import { dispatchCaptainOnMission, tick } from "./tick";
import { cp16PatrolStart, cp16ShortRangeStart, patrolSecondsToEnd, steppedBy } from "./cp16Goldens.fixture";
import { stateHash } from "./firstRunsGoldens.fixture";
import { WIRING_CAPTAIN_ID, shipOf, wiringBase } from "./wiring/probes";

const RNG = (): number => 0.5;
export const OFFLINE_SECONDS = 4 * 3600;

const keysOf = (m: Record<string, unknown>): string => Object.keys(m).join(",");
function row(s: GameState): string[] {
  const t = s.lifetimeStats;
  return [
    stateHash(s),
    s.discovered.join(","),
    [keysOf(t.itemsGathered), keysOf(t.itemsRefined), keysOf(t.itemsCrafted), keysOf(t.missionsCompleted)].join(" | "),
  ];
}

// A second captain (id 2) flying a copy of ship-1 (ship-2) and its installed gear (the cp16HallOfCommand.test.ts shape).
export function withSecondCaptain(s: GameState): GameState {
  const c1 = s.captains.find((c) => c.id === WIRING_CAPTAIN_ID)!;
  const c2: CaptainState = { ...c1, id: 2, label: "Captain 2", mission: null };
  const ship2 = { ...shipOf(s), id: "ship-2", assignedCaptainId: 2 };
  const gear2 = s.equipment.filter((e) => e.fittedToShipId === "ship-1").map((e) => ({ ...e, id: `${e.id}-2`, fittedToShipId: "ship-2" }));
  return { ...s, captains: [...s.captains, c2], ships: [...s.ships, ship2], equipment: [...s.equipment, ...gear2] };
}

// Captain 1 on a Lunar Mine Contract (the longer cycle), captain 2 on a Local Asteroid run.
export function twoCaptainsStart(): GameState {
  const one = dispatchCaptainOnMission(withSecondCaptain({ ...wiringBase(), transitBerthCapacity: 8 }), WIRING_CAPTAIN_ID, "longOreRun");
  if (!one.success) throw new Error(`ordering goldens: captain 1: ${one.reason}`);
  const two = dispatchCaptainOnMission(one.next, 2, "shortOreRun");
  if (!two.success) throw new Error(`ordering goldens: captain 2: ${two.reason}`);
  return two.next;
}

export function orderingRows(): Record<string, unknown> {
  const got: Record<string, unknown> = {};
  const three = (name: string, s0: GameState, n: number): void => {
    got[`${name}:steps`] = row(steppedBy(s0, n, 1));
    got[`${name}:oneCall`] = row(steppedBy(s0, n, n));
    got[`${name}:chunks`] = row(steppedBy(s0, n, 997));
  };
  const patrol = cp16PatrolStart();
  three("patrol", patrol, patrolSecondsToEnd(patrol));
  three("shortRange", cp16ShortRangeStart(0), 900);
  const two = twoCaptainsStart();
  three("twoCaptains", two, 1000);
  got["offline:tick"] = row(tick(OFFLINE_SECONDS, two, RNG));
  got["offline:steps"] = row(steppedBy(two, OFFLINE_SECONDS, 1));
  got["offline:chunks97"] = row(steppedBy(two, OFFLINE_SECONDS, 97));
  return got;
}

// Captured on feat 2c66d749, before the slice.
export const ORDERING_PINS_PRE: Record<string, unknown> = {
  "patrol:steps": ["a4d32d1b", "intactReactorCore,powerCoupling,commonOre,titaniumIngot", "intactReactorCore,powerCoupling,titaniumIngot,commonOre |  |  | crimsonReaverSweep"],
  "patrol:oneCall": ["c76eab1f", "commonOre,intactReactorCore,powerCoupling,titaniumIngot", "intactReactorCore,powerCoupling,titaniumIngot,commonOre |  |  | crimsonReaverSweep"],
  "patrol:chunks": ["c76eab1f", "commonOre,intactReactorCore,powerCoupling,titaniumIngot", "intactReactorCore,powerCoupling,titaniumIngot,commonOre |  |  | crimsonReaverSweep"],
  "shortRange:steps": ["b00f4dc1", "rareMaterial,commonOre", "rareMaterial,commonOre |  |  | shortRange:supplyDropOff,shortRange:phenomenonSurvey,shortRange:commBoosterBuild,shortRange:telescopeRepair,shortRange:prisonerTransport,shortRange:supplyPickup,shortRange:refugeeRelocation"],
  "shortRange:oneCall": ["f8058e03", "commonOre,rareMaterial", "rareMaterial,commonOre |  |  | shortRange:supplyDropOff,shortRange:phenomenonSurvey,shortRange:commBoosterBuild,shortRange:telescopeRepair,shortRange:prisonerTransport,shortRange:supplyPickup,shortRange:refugeeRelocation"],
  "shortRange:chunks": ["f8058e03", "commonOre,rareMaterial", "rareMaterial,commonOre |  |  | shortRange:supplyDropOff,shortRange:phenomenonSurvey,shortRange:commBoosterBuild,shortRange:telescopeRepair,shortRange:prisonerTransport,shortRange:supplyPickup,shortRange:refugeeRelocation"],
  "twoCaptains:steps": ["b7ef4670", "commonOre,ferriteOre", "commonOre,uncommonMaterial,rareMaterial,ferriteOre,denseOre,osmiumOre |  |  | shortOreRun,longOreRun"],
  "twoCaptains:oneCall": ["12a5e56a", "commonOre,ferriteOre", "commonOre,uncommonMaterial,rareMaterial,ferriteOre,denseOre,osmiumOre |  |  | longOreRun,shortOreRun"],
  "twoCaptains:chunks": ["12a5e56a", "commonOre,ferriteOre", "commonOre,uncommonMaterial,rareMaterial,ferriteOre,denseOre,osmiumOre |  |  | longOreRun,shortOreRun"],
  "offline:tick": ["a6290cc3", "commonOre,ferriteOre", "commonOre,uncommonMaterial,rareMaterial,ferriteOre,denseOre,osmiumOre |  |  | shortOreRun,longOreRun"],
  "offline:steps": ["a6290cc3", "commonOre,ferriteOre", "commonOre,uncommonMaterial,rareMaterial,ferriteOre,denseOre,osmiumOre |  |  | shortOreRun,longOreRun"],
  "offline:chunks97": ["a6290cc3", "commonOre,ferriteOre", "commonOre,uncommonMaterial,rareMaterial,ferriteOre,denseOre,osmiumOre |  |  | shortOreRun,longOreRun"],
};
