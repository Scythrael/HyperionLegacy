// OC-F14 (the player-ordered field repair; docs/plans/2026-10-15-wiring-registry-and-audit-plan.md, USER ANSWERS
// 2026-11-12): golden hashes captured on the code BEFORE the engine edit (on top of 08f2cac8). The fixtures
// (fieldRepairOrder.fixture.ts) are real Ground Ops runs on five systems, each read four ways: the dispatched record, the
// threshold repair run to the end, the player's ordered repair leg, and the ordered run to the end.

import { describe, expect, it } from "vitest";
import { OCF14_SEEDS, ocf14Run } from "./fieldRepairOrder.fixture";

// Captured on the code BEFORE the engine edit (08f2cac8).
const BEFORE_RUNS: Record<string, string[]> = {
  a6fe4: ["56a8a66f", "ef43d318", "6a2d31c7", "f68d67d7"],
  a6fee: ["a94515a0", "e2975756", "a4db2540", "90b4e40e"],
  a6ff2: ["510e2429", "65403f2f", "b97c40a0", "11049e0f"],
  a6fe5: ["206b66de", "36467efb", "54167841", "6a55dff3"],
  a6fe0: ["62ce42f1", "ab8bf61b", "97eb1fdc", "b2939471"],
};

describe("OC-F14 goldens", () => {
  for (const seed of OCF14_SEEDS) {
    it(`run ${seed.toString(16)}`, { timeout: 120_000 }, () => expect(ocf14Run(seed)).toEqual(BEFORE_RUNS[seed.toString(16)]));
  }
});
