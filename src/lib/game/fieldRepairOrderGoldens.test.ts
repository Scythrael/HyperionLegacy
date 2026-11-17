// OC-F14 (the player-ordered field repair; docs/plans/2026-10-15-wiring-registry-and-audit-plan.md, USER ANSWERS
// 2026-11-12): golden hashes captured on the code BEFORE the engine edit (on top of 08f2cac8). The fixtures
// (fieldRepairOrder.fixture.ts) are real Ground Ops runs on five systems, each read four ways: the dispatched record, the
// threshold repair run to the end, the player's ordered repair leg, and the ordered run to the end.
//
// The OC-F14 engine commit re-pins ONLY what OC-F14 moves (GOLDEN), each with its reason beside it, and proves the move
// with OC-F14 switched off (fieldRepairRulesSwitch.fixture.ts withRepairRulesOff): every fixture then reproduces its
// capture (BEFORE). The cancel is a new player action: no fixture gives it, so it moves no pin (fieldRepairOrder.test.ts).

import { describe, expect, it } from "vitest";
import { advanceExpedition } from "./expedition";
import { OCF14_FAR, OCF14_MIXED_SEEDS, OCF14_SEEDS, ocf14Damaged, ocf14Dispatch, ocf14Hash, ocf14Ordered, ocf14Run, ocf14Threshold } from "./fieldRepairOrder.fixture";
import { withRepairRulesOff } from "./fieldRepairRulesSwitch.fixture";
import { fieldRepairSeconds, IN_SYSTEM_LEG_SECONDS } from "./groundOps";
import { fixRoundAnswersOffForThisFile } from "./fixRoundAnswersSwitch.fixture";
import { crewModuleSiOffForThisFile } from "./crewModuleSiSwitch.fixture";

// Standard-Issue crew modules (0.14.0, user 2026-11-17 "free basic set, all ships"): this file's pins predate the
// free Sensor Suite, Bridge Module and Crew Quarters every ship now carries (their berths, officer lift, hull bonus
// and equipment ids), so the set is off here and the pins keep proving their own slice. The set itself is pinned in
// crewModuleStandardIssue.test.ts.
crewModuleSiOffForThisFile();

// Fix round answers Q3 (2026-11-17, "Yes, same every visit": a catalog-named system's bodies are drawn from its
// catalog id, the same every visit) moves this file's pins (the catalog-named systems its runs fly have other bodies).
// They predate it and are about another slice, so the file runs with it off (fixRoundAnswersSwitch.fixture.ts). Q3's
// own pins: expeditionFixRoundE.test.ts.
fixRoundAnswersOffForThisFile("catalogBodies");

// Captured on the code BEFORE the engine edit (08f2cac8).
const BEFORE_RUNS: Record<string, string[]> = {
  a6fe4: ["56a8a66f", "ef43d318", "6a2d31c7", "f68d67d7"],
  a6fee: ["a94515a0", "e2975756", "a4db2540", "90b4e40e"],
  a6ff2: ["510e2429", "65403f2f", "b97c40a0", "11049e0f"],
  a6fe5: ["206b66de", "36467efb", "54167841", "6a55dff3"],
  a6fe0: ["62ce42f1", "ab8bf61b", "97eb1fdc", "b2939471"],
};

// The pins today. Each move names its reason; every one returns to BEFORE with OC-F14 off (the describe below).
// The three mixed systems (a repair world and other bodies): the dispatched record carries the repair rules stamp
//   (repairRules), so the dispatch hash moves, and every later reading carries it.
//   - a6fe4 (toxic, frozen): the threshold repair strikes while the ship scans the toxic body. The old rule flew to the
//     frozen world (5m, 224 s on the ground, 5m back: 824 s); the faster is orbit (336 s), so the leg and the run move.
//     The order (48 damage, at the toxic body) is orbit too: 132 s against 688 s.
//   - a6fee (barren, arid): the threshold repair strikes at the arid world itself (ground 184 s beats orbit 276 s), so
//     its leg is the old one; the threshold hash moves by the stamp alone. The order at the barren body is orbit (132 s).
//   - a6ff2 (volcanic, gas giant, frozen): no threshold repair in this run (the stamp alone moves the hash); the order at
//     the volcanic body is orbit (132 s against 688 s).
// The worlds-only (a6fe5) and the no-world (a6fe0) systems carry no stamp: nothing moves (the choice cannot differ).
const GOLDEN_RUNS: Record<string, string[]> = {
  a6fe4: ["847893ac", "fc01f2ba", "e650d250", "1d74fbbf"],
  a6fee: ["eacca7ed", "744065b7", "79bc9060", "748d4505"],
  a6ff2: ["594795be", "3ce721f8", "19b3c86a", "3f5ad565"],
  a6fe5: BEFORE_RUNS.a6fe5,
  a6fe0: BEFORE_RUNS.a6fe0,
};

describe("OC-F14 goldens", () => {
  for (const seed of OCF14_SEEDS) {
    it(`run ${seed.toString(16)}`, { timeout: 120_000 }, () => expect(ocf14Run(seed)).toEqual(GOLDEN_RUNS[seed.toString(16)]));
  }
});

describe("OC-F14 off reproduces every capture (BEFORE)", () => {
  for (const seed of OCF14_SEEDS) {
    it(`run ${seed.toString(16)}`, { timeout: 120_000 }, () => expect(withRepairRulesOff(() => ocf14Run(seed))).toEqual(BEFORE_RUNS[seed.toString(16)]));
  }
});

describe("OC-F14: the moves are the faster choice", () => {
  it("only the mixed systems are stamped", () => {
    for (const seed of OCF14_SEEDS) {
      const mixed = (OCF14_MIXED_SEEDS as readonly number[]).includes(seed);
      expect(ocf14Dispatch(seed).exp.repairRules).toBe(mixed ? 1 : undefined);
    }
  });
  it("a6fe4's threshold repair: orbit (336 s) where the old rule flew to the frozen world (824 s)", () => {
    const run = (): ReturnType<typeof advanceExpedition> => {
      const { exp } = ocf14Dispatch(0xa6fe4);
      return advanceExpedition(ocf14Damaged(exp, ocf14Threshold(exp) - 1), OCF14_FAR);
    };
    const now = run().groundOps!.repairLegs![0];
    const old = withRepairRulesOff(run).groundOps!.repairLegs![0];
    expect(old.siteBodyIndex).toBe(1);
    expect(now.siteBodyIndex).toBeNull();
    expect(now.startsAt).toBe(old.startsAt);
    expect(now.hullRepaired).toBe(old.hullRepaired);
    expect(now.endsAt - now.startsAt).toBe(fieldRepairSeconds(now.hullRepaired, 0, false));
    expect(old.endsAt - old.startsAt).toBe(2 * IN_SYSTEM_LEG_SECONDS + fieldRepairSeconds(old.hullRepaired, 0, true));
    expect(now.endsAt - now.startsAt).toBeLessThan(old.endsAt - old.startsAt);
  });
  it("each mixed order: orbit, 2m 12s, where the old rule took 11m 28s", () => {
    for (const seed of OCF14_MIXED_SEEDS) {
      const now = ocf14Ordered(seed).exp.groundOps!.repairLegs![0];
      const old = withRepairRulesOff(() => ocf14Ordered(seed).exp.groundOps!.repairLegs![0]);
      expect([now.siteBodyIndex, now.endsAt - now.startsAt]).toEqual([null, 132]);
      expect(old.siteBodyIndex).not.toBeNull();
      expect(old.endsAt - old.startsAt).toBe(688);
    }
  });
});

// A run in flight at the update (dispatched before OC-F14: no repair rules stamp) replays byte-identically: a stamped
// dispatch with the stamp taken off advances exactly as the OC-F14-off dispatch does.
describe("OC-F14: a run dispatched before it replays byte-identically", () => {
  for (const seed of OCF14_MIXED_SEEDS) {
    it(`run ${seed.toString(16)}`, { timeout: 120_000 }, () => {
      const { exp } = ocf14Dispatch(seed);
      const { repairRules: _stamp, ...old } = exp;
      expect(ocf14Hash(old)).toBe(BEFORE_RUNS[seed.toString(16)][0]);
      expect(ocf14Hash(advanceExpedition(ocf14Damaged(old, ocf14Threshold(old) - 1), OCF14_FAR))).toBe(BEFORE_RUNS[seed.toString(16)][1]);
    });
  }
});
