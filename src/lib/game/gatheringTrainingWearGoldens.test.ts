// Safe first runs SF-7 (docs/plans/2026-10-15-safe-first-runs-plan.md section 4 SF-7): golden hashes of a save's FIRST
// gathering run under the gear wear engine, captured on the code BEFORE the SF-7 edit (the SF-0 / CP-0 pattern), then
// the SF-7 rule itself (its moves re-pinned in AFTER, its proof below; the switch: gatheringTrainingSwitch.fixture.ts).
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

// The ordering determinism slice (canonicalOrder.ts: `discovered` and the lifetime tally maps kept in canonical order)
// came after every pin here: the file runs with it off (orderingSwitch.fixture.ts), so its pins keep proving their own
// slice (orderingGoldens.test.ts pins the order move and proves it moved order only).
import { canonicalOrderOffForThisFile } from "./orderingSwitch.fixture";
canonicalOrderOffForThisFile();
import { describe, expect, it } from "vitest";
import { cp16OffForThisFile } from "./cp16Switch.fixture";
// Complement CP-16 (the Hall of Command) came after every pin here: the file runs with the slice off, so its pins
// keep proving their own slice (cp16Goldens.test.ts pins what CP-16 moved: the missions counter, the notables and
// the Hall of Command entry).
cp16OffForThisFile();
import { writeFileSync } from "node:fs";
import Decimal from "break_infinity.js";
import { MISSIONS, freshState, type GameState, type MissionKey } from "./model";
import { dispatchCaptainOnMission, economyTick, recallCaptain, tick } from "./tick";
import { hash, stateHash } from "./firstRunsGoldens.fixture";
import { pieceCondition } from "./gearWear";
import { gatheringTrainingStamp } from "./gearWearEngine";
import { withGatheringTrainingOff } from "./gatheringTrainingSwitch.fixture";

const CAPTURE = Boolean(import.meta.env.SF7_CAPTURE);

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

// RE-PINNED BY SF-7 (the one move, on purpose): every `fresh:<key>` row. The save's first gathering run is marked at
// dispatch (its dispatch record gains `gearWear.training`), its first delivered cycle wears nothing, and every later
// cycle wears as before, so each condition line reads one cycle's wear less (the state hashes follow). With the switch
// off every fresh row reproduces GOLDEN above; `veteran:*` is unchanged with the switch on.
const AFTER: Record<string, string[]> = {
  "fresh:localFuelRun": ["88517fde","1200:cargoBay:955,ftlDrive:1000,reactorCore:988,specUtility:955","1200:85d790f8","2400:cargoBay:919,ftlDrive:1000,reactorCore:979,specUtility:919","2400:209c1bc4","3600:cargoBay:890,ftlDrive:1000,reactorCore:971,specUtility:890","3600:d49c34fc"],
  "fresh:shortOreRun": ["a56128bd","1200:cargoBay:979,ftlDrive:995,reactorCore:986,specUtility:979","1200:314c66a1","2400:cargoBay:963,ftlDrive:995,reactorCore:978,specUtility:963","2400:129cb51a","3600:cargoBay:947,ftlDrive:995,reactorCore:970,specUtility:947","3600:ff887d67"],
  "fresh:longOreRun": ["85816bc1","1200:cargoBay:992,ftlDrive:970,reactorCore:978,specUtility:992","1200:b16b98dc","2400:cargoBay:992,ftlDrive:948,reactorCore:963,specUtility:992","2400:c5b04352","3600:cargoBay:992,ftlDrive:929,reactorCore:951,specUtility:992","3600:e8356d22"],
  "fresh:salvageWreckage": ["9d51f93a","1200:cargoBay:989,ftlDrive:984,reactorCore:979,specUtility:989","1200:5650fd06","2400:cargoBay:985,ftlDrive:974,reactorCore:963,specUtility:985","2400:9a1b21d6","3600:cargoBay:980,ftlDrive:962,reactorCore:947,specUtility:980","3600:a9ed35c9"],
  "fresh:forageFlora": ["1ccc6916","1200:cargoBay:991,ftlDrive:979,reactorCore:983,specUtility:991","1200:73450ca6","2400:cargoBay:991,ftlDrive:961,reactorCore:971,specUtility:991","2400:dacb559e","3600:cargoBay:991,ftlDrive:947,reactorCore:959,specUtility:991","3600:bcad3d7f"],
  "fresh:surveyMineralAnomaly": ["eb52323","1200:cargoBay:992,ftlDrive:968,reactorCore:977,specUtility:992","1200:a9042a2f","2400:cargoBay:992,ftlDrive:943,reactorCore:961,specUtility:992","2400:63a26de7","3600:cargoBay:992,ftlDrive:918,reactorCore:946,specUtility:992","3600:bf1171ad"],
  "fresh:surveyStellarPhenomena": ["ed4c8a30","1200:cargoBay:992,ftlDrive:964,reactorCore:976,specUtility:992","1200:4aac38b","2400:cargoBay:992,ftlDrive:935,reactorCore:959,specUtility:992","2400:4a7dded4","3600:cargoBay:992,ftlDrive:912,reactorCore:946,specUtility:992","3600:6a38601"],
  "fresh:frontierSupplyRun": ["c6c33a5d","1200:cargoBay:1000,ftlDrive:1000,reactorCore:1000,specUtility:1000","1200:7db27c55","2400:cargoBay:1000,ftlDrive:1000,reactorCore:1000,specUtility:1000","2400:9d0a6866","3600:cargoBay:1000,ftlDrive:1000,reactorCore:1000,specUtility:1000","3600:37ff11b2"],
  "fresh:colonySupplyLift": ["67766ad2","1200:cargoBay:1000,ftlDrive:1000,reactorCore:1000,specUtility:1000","1200:4196ac97","2400:cargoBay:1000,ftlDrive:1000,reactorCore:1000,specUtility:1000","2400:9bce7b59","3600:cargoBay:1000,ftlDrive:1000,reactorCore:1000,specUtility:1000","3600:36d2df1b"],
  "fresh:cometIceHarvest": ["d2932e6e","1200:cargoBay:987,ftlDrive:987,reactorCore:982,specUtility:987","1200:cbe31dcc","2400:cargoBay:980,ftlDrive:980,reactorCore:968,specUtility:980","2400:4111c6df","3600:cargoBay:973,ftlDrive:973,reactorCore:954,specUtility:973","3600:9ee2da49"],
};

const at = (s: GameState): string => conditions(s);
const marked = (s: GameState): boolean => s.captains.some((c) => c.mission !== null && c.mission.kind === "extraction" && c.mission.gearWear?.training === 1);
const deliveries = (s: GameState): number =>
  Object.keys(MISSIONS).reduce((n, k) => n + Number(String(s.lifetimeStats.missionsCompleted[k] ?? 0)), 0);

describe("SF-7 goldens: the first gathering run under gear wear", () => {
  it("the fixture flies several gathering missions (vacuity guard)", () => {
    expect(GATHERING_KEYS.length).toBeGreaterThanOrEqual(3);
  });
  const captured: Record<string, string[]> = {};
  for (const key of GATHERING_KEYS) {
    it(`before: fresh:${key} and veteran:${key} reproduce their pre-SF-7 capture with the switch off`, () => {
      expect(withGatheringTrainingOff(() => gatheringRun(freshState(), key))).toEqual(GOLDEN[`fresh:${key}`]);
      expect(withGatheringTrainingOff(() => gatheringRun(gatheringVeteran(freshState()), key))).toEqual(GOLDEN[`veteran:${key}`]);
    });
    it(`veteran:${key} is unchanged by SF-7`, () => {
      expect(gatheringRun(gatheringVeteran(freshState()), key)).toEqual(GOLDEN[`veteran:${key}`]);
    });
    it(`fresh:${key} (re-pinned by SF-7)`, () => {
      const v = gatheringRun(freshState(), key);
      captured[`fresh:${key}`] = v;
      if (!CAPTURE) expect(v).toEqual(AFTER[`fresh:${key}`]);
    });
  }
  it("writes", () => {
    if (CAPTURE) writeFileSync(String(import.meta.env.SF7_CAPTURE), JSON.stringify(captured, null, 2));
  });
});

describe("SF-7: the first gathering run takes no gear wear (user OC-W9 \"No wear on training\")", () => {
  const PRISTINE = (s: GameState) => s.equipment.filter((e) => e.fittedToShipId === "ship-1").every((e) => e.condition === undefined);

  it("on every mission: pristine through the first delivery, worn from the second, and the mark is gone after the first", () => {
    for (const key of GATHERING_KEYS) {
      // Credits so a transport run is funded (an unfunded transport cycle idles and delivers nothing).
      const r = dispatchCaptainOnMission(levelled({ ...freshState(), credits: new Decimal(1_000_000) }), 1, key);
      expect(marked(r.next), key).toBe(true);
      let s = r.next;
      let i = 0;
      while (deliveries(s) < 1 && i < 20_000) {
        s = economyTick(s, 1, () => 0.5);
        i += 1;
      }
      expect(deliveries(s), key).toBe(1);
      expect(PRISTINE(s), `${key}: ${at(s)}`).toBe(true);
      expect(marked(s), key).toBe(false);
      while (deliveries(s) < 2 && i < 40_000) {
        s = economyTick(s, 1, () => 0.5);
        i += 1;
      }
      expect(deliveries(s), key).toBe(2);
      expect(PRISTINE(s), key).toBe(false);
    }
  });

  it("the veteran's first delivery wears (the vacuity guard: the rule is what kept the fresh run pristine)", () => {
    let s = dispatchCaptainOnMission(levelled(gatheringVeteran(freshState())), 1, "shortOreRun").next;
    expect(marked(s)).toBe(false);
    const start = deliveries(s);
    while (deliveries(s) === start) s = economyTick(s, 1, () => 0.5);
    expect(PRISTINE(s)).toBe(false);
  });

  // A captain mission draws its transit berths from a per-call budget, so its offline proof is tick() (the catch-up,
  // gearWearEngine.test.ts precedent), never one long economyTick call; the mark is written at dispatch only.
  it("offline == live: tick() (the offline catch-up) equals the live 1 s steps through the training delivery and after", () => {
    for (const key of GATHERING_KEYS) {
      const s0 = dispatchCaptainOnMission(levelled(freshState()), 1, key).next;
      const rng = () => 0.5;
      let steps = s0;
      for (let t = 0; t < 3600; t++) steps = economyTick(steps, 1, rng);
      const offline = tick(3600, s0, rng);
      expect(offline.equipment, key).toEqual(steps.equipment);
      expect(stateHash(offline), key).toBe(stateHash(steps));
    }
  });

  it("one training run at a time; a veteran or a wear-less build is never marked", () => {
    const fresh = freshState();
    const stamp = { version: 1 as const };
    expect(gatheringTrainingStamp(fresh, stamp)).toEqual({ version: 1, training: 1 });
    expect(gatheringTrainingStamp(fresh, undefined)).toBeUndefined();
    expect(gatheringTrainingStamp(gatheringVeteran(fresh), stamp)).toBe(stamp);
    const flying = dispatchCaptainOnMission(levelled(fresh), 1, "shortOreRun").next;
    expect(marked(flying)).toBe(true);
    expect(gatheringTrainingStamp(flying, stamp)).toBe(stamp);
    expect(withGatheringTrainingOff(() => gatheringTrainingStamp(fresh, stamp))).toBe(stamp);
  });

  // The real recall (tick.ts recallCaptain) flies the ship home and the unload counts as a delivery, even with an empty
  // hold, so the recalled run uses up the training delivery itself (pristine) and the next dispatch is not marked.
  it("a recalled training run spends the exemption itself: it flies home, its delivery wears nothing, the next run is not marked", () => {
    const stamp = { version: 1 as const };
    let s = recallCaptain(dispatchCaptainOnMission(levelled(freshState()), 1, "shortOreRun").next, 1).next;
    expect(marked(s)).toBe(true);
    let i = 0;
    while (s.captains[0].mission !== null && i < 20_000) {
      s = economyTick(s, 1, () => 0.5);
      i += 1;
    }
    expect(s.captains[0].mission).toBeNull();
    expect(deliveries(s)).toBe(1);
    expect(PRISTINE(s)).toBe(true);
    expect(gatheringTrainingStamp(s, stamp)).toBe(stamp);
  });

  // The one case the mark passes on: a recalled transport whose cycle idles unfunded delivers nothing.
  it("a recalled transport that idles unfunded delivers nothing, so the next dispatch is the marked training run", () => {
    const key = (Object.keys(MISSIONS) as MissionKey[]).find((k) => MISSIONS[k].missionType === "transport");
    expect(key).toBeDefined();
    const stamp = { version: 1 as const };
    const r = dispatchCaptainOnMission(levelled(freshState()), 1, key as MissionKey);
    expect(r.success, r.reason).toBe(true);
    let s = recallCaptain({ ...r.next, credits: new Decimal(0) }, 1).next;
    let i = 0;
    while (s.captains[0].mission !== null && i < 40_000) {
      s = economyTick(s, 1, () => 0.5);
      i += 1;
    }
    expect(s.captains[0].mission).toBeNull();
    expect(deliveries(s)).toBe(0);
    expect(gatheringTrainingStamp(s, stamp)).toEqual({ version: 1, training: 1 });
  });

  it("a run dispatched before SF-7 (unmarked) flies on byte-identical to the pre-SF-7 game", () => {
    const key = GATHERING_KEYS[0];
    const old = withGatheringTrainingOff(() => dispatchCaptainOnMission(levelled(freshState()), 1, key).next);
    expect(marked(old)).toBe(false);
    const rng = () => 0.5;
    expect(stateHash(economyTick(old, 3600, rng))).toBe(withGatheringTrainingOff(() => stateHash(economyTick(old, 3600, rng))));
  });
});
