// Safe first runs SF-7 (docs/plans/2026-10-15-safe-first-runs-plan.md section 4 SF-7): golden hashes of a save's FIRST
// gathering run under the gear wear engine, captured on the code BEFORE the SF-7 edit (the SF-0 / CP-0 pattern).
//
// Why: the user locked (capture 2026-10-15, section 7) that the safe first runs cover "captain missions (first gathering
// run and first combat mission)", and answered (gear wear OC-W9, 2026-10-16, "No wear on training", restated by the user
// 2026-11-02: no gear wear on safe first runs or tutorials). Before SF-7 the expedition training run, the training
// patrol cycle and a short-range template's training cycle took no wear, but the save's first gathering delivery wore
// the ship like any other. SF-7 is expected to move ONLY the `fresh:*` rows below (named in GOLDEN when re-pinned);
// `veteran:*` (a save that already delivered a gathering cycle) must stay byte-identical.
//
//   fresh:<key>   : a fresh save's freighter dispatched on `key` (Repeat), 3,600 economyTick seconds in 1 s steps: the
//                   dispatch record, then at 1,200 / 2,400 / 3,600 s the ship's piece conditions and the state hash.
//   veteran:<key> : the same run on a save whose lifetime record already holds one delivered gathering cycle.

import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import Decimal from "break_infinity.js";
import { MISSIONS, freshState, type GameState, type MissionKey } from "./model";
import { dispatchCaptainOnMission, economyTick } from "./tick";
import { hash, stateHash } from "./firstRunsGoldens.fixture";
import { pieceCondition } from "./gearWear";

const CAPTURE = Boolean(process.env.SF7_CAPTURE);

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function levelled(s: GameState): GameState {
  return { ...s, captains: s.captains.map((c) => ({ ...c, level: 10 })) };
}

// A save that already delivered one gathering cycle (any MISSIONS key): not its first gathering run.
export function gatheringVeteran(s: GameState): GameState {
  return { ...s, lifetimeStats: { ...s.lifetimeStats, missionsCompleted: { ...s.lifetimeStats.missionsCompleted, shortOreRun: new Decimal(1) } } };
}

const conditions = (s: GameState): string =>
  s.equipment
    .filter((e) => e.fittedToShipId === "ship-1")
    .map((e) => `${e.slotType}:${pieceCondition(e)}`)
    .join(",");

export function gatheringRun(s0: GameState, key: MissionKey): string[] {
  const r = dispatchCaptainOnMission(levelled(s0), 1, key);
  expect(r.success, `${key}: ${r.reason}`).toBe(true);
  const out = [hash(r.next.captains[0].mission)];
  let s = r.next;
  const rng = lcg(0x5f07);
  for (const mark of [1200, 2400, 3600]) {
    for (let i = 0; i < 1200; i++) s = economyTick(s, 1, rng);
    out.push(`${mark}:${conditions(s)}`, `${mark}:${stateHash(s)}`);
  }
  return out;
}

// The missions a fresh save's freighter can fly at captain level 10 (every MISSIONS key it dispatches).
export const GATHERING_KEYS: readonly MissionKey[] = (Object.keys(MISSIONS) as MissionKey[]).filter(
  (k) => dispatchCaptainOnMission(levelled(freshState()), 1, k).success,
);

// Captured on a9b3de6 (feat head) BEFORE the SF-7 edit.
const GOLDEN: Record<string, string[]> = {
  "fresh:localFuelRun": ["77804d73","1200:cargoBay:951,ftlDrive:1000,reactorCore:987,specUtility:951","1200:c180d071","2400:cargoBay:916,ftlDrive:1000,reactorCore:978,specUtility:916","2400:6c7700c3","3600:cargoBay:888,ftlDrive:1000,reactorCore:970,specUtility:888","3600:e79e193b"],
  "veteran:localFuelRun": ["77804d73","1200:cargoBay:951,ftlDrive:1000,reactorCore:987,specUtility:951","1200:b6e3aee7","2400:cargoBay:916,ftlDrive:1000,reactorCore:978,specUtility:916","2400:47781701","3600:cargoBay:888,ftlDrive:1000,reactorCore:970,specUtility:888","3600:7753cd75"],
  "fresh:shortOreRun": ["a0f89ec2","1200:cargoBay:977,ftlDrive:995,reactorCore:985,specUtility:977","1200:5fbd73e7","2400:cargoBay:961,ftlDrive:995,reactorCore:977,specUtility:961","2400:6f5a3662","3600:cargoBay:945,ftlDrive:995,reactorCore:969,specUtility:945","3600:b01c386"],
  "veteran:shortOreRun": ["a0f89ec2","1200:cargoBay:977,ftlDrive:995,reactorCore:985,specUtility:977","1200:c1122ae2","2400:cargoBay:961,ftlDrive:995,reactorCore:977,specUtility:961","2400:baeb1617","3600:cargoBay:945,ftlDrive:995,reactorCore:969,specUtility:945","3600:ccf478c3"],
  "fresh:longOreRun": ["bd383776","1200:cargoBay:992,ftlDrive:965,reactorCore:975,specUtility:992","1200:6d2d131d","2400:cargoBay:992,ftlDrive:944,reactorCore:960,specUtility:992","2400:240e994d","3600:cargoBay:992,ftlDrive:926,reactorCore:949,specUtility:992","3600:7e83d61d"],
  "veteran:longOreRun": ["bd383776","1200:cargoBay:992,ftlDrive:965,reactorCore:975,specUtility:992","1200:e41aca87","2400:cargoBay:992,ftlDrive:944,reactorCore:960,specUtility:992","2400:21ba9c53","3600:cargoBay:992,ftlDrive:926,reactorCore:949,specUtility:992","3600:138d11f3"],
  "fresh:salvageWreckage": ["fa78484f","1200:cargoBay:988,ftlDrive:982,reactorCore:976,specUtility:988","1200:766dd61d","2400:cargoBay:984,ftlDrive:972,reactorCore:960,specUtility:984","2400:60996c11","3600:cargoBay:979,ftlDrive:960,reactorCore:945,specUtility:979","3600:e07ef7ab"],
  "veteran:salvageWreckage": ["fa78484f","1200:cargoBay:988,ftlDrive:982,reactorCore:976,specUtility:988","1200:e3a8b6b7","2400:cargoBay:984,ftlDrive:972,reactorCore:960,specUtility:984","2400:e56d6477","3600:cargoBay:979,ftlDrive:960,reactorCore:945,specUtility:979","3600:2965e21"],
  "fresh:forageFlora": ["28b8807b","1200:cargoBay:991,ftlDrive:976,reactorCore:981,specUtility:991","1200:300184d4","2400:cargoBay:991,ftlDrive:958,reactorCore:969,specUtility:991","2400:16d2caab","3600:cargoBay:991,ftlDrive:945,reactorCore:957,specUtility:991","3600:1272f29"],
  "veteran:forageFlora": ["28b8807b","1200:cargoBay:991,ftlDrive:976,reactorCore:981,specUtility:991","1200:6f86a36a","2400:cargoBay:991,ftlDrive:958,reactorCore:969,specUtility:991","2400:bf57e861","3600:cargoBay:991,ftlDrive:945,reactorCore:957,specUtility:991","3600:39699ffb"],
  "fresh:surveyMineralAnomaly": ["91b3e0c0","1200:cargoBay:992,ftlDrive:961,reactorCore:973,specUtility:992","1200:2c1aa3f","2400:cargoBay:992,ftlDrive:938,reactorCore:958,specUtility:992","2400:e7b21305","3600:cargoBay:992,ftlDrive:914,reactorCore:943,specUtility:992","3600:8e14d340"],
  "veteran:surveyMineralAnomaly": ["91b3e0c0","1200:cargoBay:992,ftlDrive:961,reactorCore:973,specUtility:992","1200:f16c6c79","2400:cargoBay:992,ftlDrive:938,reactorCore:958,specUtility:992","2400:c5721943","3600:cargoBay:992,ftlDrive:914,reactorCore:943,specUtility:992","3600:1ef6d006"],
  "fresh:surveyStellarPhenomena": ["7f9da665","1200:cargoBay:992,ftlDrive:956,reactorCore:971,specUtility:992","1200:12a12e4a","2400:cargoBay:992,ftlDrive:929,reactorCore:956,specUtility:992","2400:f774d967","3600:cargoBay:992,ftlDrive:906,reactorCore:942,specUtility:992","3600:fbbe19e1"],
  "veteran:surveyStellarPhenomena": ["7f9da665","1200:cargoBay:992,ftlDrive:956,reactorCore:971,specUtility:992","1200:7ab748f4","2400:cargoBay:992,ftlDrive:929,reactorCore:956,specUtility:992","2400:e967fa5d","3600:cargoBay:992,ftlDrive:906,reactorCore:942,specUtility:992","3600:869f3bbf"],
  "fresh:frontierSupplyRun": ["58c67fe2","1200:cargoBay:1000,ftlDrive:1000,reactorCore:1000,specUtility:1000","1200:daa3c4c8","2400:cargoBay:1000,ftlDrive:1000,reactorCore:1000,specUtility:1000","2400:11a39da1","3600:cargoBay:1000,ftlDrive:1000,reactorCore:1000,specUtility:1000","3600:8e65081b"],
  "veteran:frontierSupplyRun": ["58c67fe2","1200:cargoBay:1000,ftlDrive:1000,reactorCore:1000,specUtility:1000","1200:9415c37e","2400:cargoBay:1000,ftlDrive:1000,reactorCore:1000,specUtility:1000","2400:998d0e9","3600:cargoBay:1000,ftlDrive:1000,reactorCore:1000,specUtility:1000","3600:a6401d03"],
  "fresh:colonySupplyLift": ["2554357","1200:cargoBay:1000,ftlDrive:1000,reactorCore:1000,specUtility:1000","1200:6e90a322","2400:cargoBay:1000,ftlDrive:1000,reactorCore:1000,specUtility:1000","2400:420cfc98","3600:cargoBay:1000,ftlDrive:1000,reactorCore:1000,specUtility:1000","3600:b6051f40"],
  "veteran:colonySupplyLift": ["2554357","1200:cargoBay:1000,ftlDrive:1000,reactorCore:1000,specUtility:1000","1200:a147f0c","2400:cargoBay:1000,ftlDrive:1000,reactorCore:1000,specUtility:1000","2400:757017e6","3600:cargoBay:1000,ftlDrive:1000,reactorCore:1000,specUtility:1000","3600:b2ddc6b6"],
  "fresh:cometIceHarvest": ["93a660a3","1200:cargoBay:986,ftlDrive:986,reactorCore:980,specUtility:986","1200:d65f9e48","2400:cargoBay:979,ftlDrive:979,reactorCore:966,specUtility:979","2400:6eb236a5","3600:cargoBay:972,ftlDrive:972,reactorCore:952,specUtility:972","3600:b1f41f4b"],
  "veteran:cometIceHarvest": ["93a660a3","1200:cargoBay:986,ftlDrive:986,reactorCore:980,specUtility:986","1200:c61d611a","2400:cargoBay:979,ftlDrive:979,reactorCore:966,specUtility:979","2400:d4e1b68f","3600:cargoBay:972,ftlDrive:972,reactorCore:952,specUtility:972","3600:bbb8cd39"],
};

describe("SF-7 goldens: the first gathering run under gear wear (captured before SF-7)", () => {
  it("the fixture flies several gathering missions (vacuity guard)", () => {
    expect(GATHERING_KEYS.length).toBeGreaterThanOrEqual(3);
  });
  const captured: Record<string, string[]> = {};
  for (const key of GATHERING_KEYS) {
    it(`fresh:${key}`, () => {
      const v = gatheringRun(freshState(), key);
      captured[`fresh:${key}`] = v;
      if (!CAPTURE) expect(v).toEqual(GOLDEN[`fresh:${key}`]);
    });
    it(`veteran:${key}`, () => {
      const v = gatheringRun(gatheringVeteran(freshState()), key);
      captured[`veteran:${key}`] = v;
      if (!CAPTURE) expect(v).toEqual(GOLDEN[`veteran:${key}`]);
    });
  }
  it("writes", () => {
    if (CAPTURE) writeFileSync(process.env.SF7_CAPTURE!, JSON.stringify(captured, null, 2));
  });
});
