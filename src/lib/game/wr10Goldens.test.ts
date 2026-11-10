// Wiring WR-10 (docs/plans/2026-10-15-wiring-registry-and-audit-plan.md section 4 WR-10, its OC-F user answers): golden
// hashes captured on the code BEFORE the engine edit (on top of 5339682). The fixtures (wr10.fixture.ts) are real Ground
// Ops runs whose squad carries a Neural Backup wearer, a medic who falls back when hurt and a rank 8 Science member with
// fieldwork gear; that squad's task fights at two caster sites and one without, with their display logs; and two recruit
// hires, with the fresh account pair and with one the player changed.
//
// The WR-10 wiring commit re-pins ONLY what WR-10 moves (GOLDEN), each with its reason beside it, and proves the move with
// WR-10 switched off (wr10Switch.fixture.ts withWr10Off): every fixture then reproduces its capture (BEFORE).

import { describe, expect, it } from "vitest";
import { WR10_FIGHT_POIS, WR10_SEEDS, wr10Dispatch, wr10FightHash, wr10Hash, wr10Hires, wr10Run } from "./wr10.fixture";

// Captured on the code BEFORE the engine edit (5339682).
const BEFORE_RUNS: Record<string, string[]> = {
  "1234": ["f3483387", "6109d1e", "d9ade4f8"],
  "3c3c": ["cd3a975e", "632cfe48", "5ddb1dd5"],
  "5e5e": ["d5791779", "b083aa48", "634613c"],
  bebe: ["87534885", "3a21a38", "96091217"],
  cfcf: ["760e19c3", "98235995", "70c7e8b5"],
};
const BEFORE_FIGHTS: Record<string, string> = {
  xenoFloraBloom: "6c60d22d",
  enemyFortification: "399b59ac",
  ancientRuins: "b191984e",
};
const BEFORE_HIRES = { plain: "85b1e0a6", custom: "85b1e0a6" };

const GOLDEN_RUNS: Record<string, string[]> = BEFORE_RUNS;
const GOLDEN_FIGHTS: Record<string, string> = BEFORE_FIGHTS;
const GOLDEN_HIRES = BEFORE_HIRES;

describe("WR-10 goldens", () => {
  for (const seed of WR10_SEEDS) {
    it(`run ${seed.toString(16)}`, { timeout: 120_000 }, () => expect(wr10Run(seed).out).toEqual(GOLDEN_RUNS[seed.toString(16)]));
  }
  for (const poi of WR10_FIGHT_POIS) it(`fights at ${poi}`, () => expect(wr10FightHash(wr10Dispatch(0x1234).exp, poi)).toBe(GOLDEN_FIGHTS[poi]));
  it("hires", () => {
    expect(wr10Hash(wr10Hires(false).awayMembers)).toBe(GOLDEN_HIRES.plain);
    expect(wr10Hash(wr10Hires(true).awayMembers)).toBe(GOLDEN_HIRES.custom);
  });
});
