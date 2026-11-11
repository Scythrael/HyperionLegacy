// Wiring WR-10 (docs/plans/2026-10-15-wiring-registry-and-audit-plan.md section 4 WR-10, its OC-F user answers): golden
// hashes captured on the code BEFORE the engine edit (on top of 5339682). The fixtures (wr10.fixture.ts) are real Ground
// Ops runs whose squad carries a Neural Backup wearer, a medic who falls back when hurt and a rank 8 Science member with
// fieldwork gear; that squad's task fights at two caster sites and one without, with their display logs; and two recruit
// hires, with the fresh account pair and with one the player changed.
//
// The WR-10 wiring commit re-pins ONLY what WR-10 moves (GOLDEN), each with its reason beside it, and proves the move with
// WR-10 switched off (wr10Switch.fixture.ts withWr10Off): every fixture then reproduces its capture (BEFORE).

// The ordering determinism slice (canonicalOrder.ts: `discovered` and the lifetime tally maps kept in canonical order)
// came after every pin here: the file runs with it off (orderingSwitch.fixture.ts), so its pins keep proving their own
// slice (orderingGoldens.test.ts pins the order move and proves it moved order only).
import { canonicalOrderOffForThisFile } from "./orderingSwitch.fixture";
canonicalOrderOffForThisFile();
// Ordering determinism part 2 (canonicalOrder.ts: inventory keys and a call's completion log in one order) came after every pin here, traced order-only: the file runs with it off (ordering2Switch.fixture.ts).
import { ordering2OffForThisFile } from "./ordering2Switch.fixture";
ordering2OffForThisFile();
import { describe, expect, it } from "vitest";
// WR-8b (enemy torpedoes) came after every pin here: the file runs with it off (enemyTorpedoSwitch.fixture.ts), so its
// pins keep proving their own slice (enemyTorpedoGoldens.test.ts pins what WR-8b moved, enemyTorpedoes.test.ts proves it).
import { enemyTorpedoesOffForThisFile } from "./enemyTorpedoSwitch.fixture";
enemyTorpedoesOffForThisFile();
import { advanceExpedition } from "./expedition";
import { WR10_FIGHT_POIS, WR10_SEEDS, wr10Dispatch, wr10FightHash, wr10Hash, wr10Hires, wr10Run } from "./wr10.fixture";
import { withWr10Off } from "./wr10Switch.fixture";
import { mergeWithBuiltInDefault } from "./memberGambits";
import { gambitPresetPrograms } from "./gambit";

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

// The pins today. Each move names its reason; every one returns to BEFORE with WR-10 off (the last describe below).
// Runs: the dispatched record carries the away rules stamp (awayRules), so every dispatch hash moves. The done and claim
//   hashes move with it: the rank 8 Science member's fieldwork gear now counts x1.35 (OC-F7), so every objective's pace and
//   haul shift, and the squad's fights run under the away rules (Neural Backup waits for its wearer, a falling-back medic
//   is Shielded for the round, a caster's hits may Corrode).
// Fights: the enemy fortification's guard fields a caster and the fights are hard enough that the medic falls back and
//   members go down, so its hash moves (Neural Backup rolls for the wearer: 3 rolls against 1, the falling-back medic is
//   Shielded, the caster carries a Corroded; seed 7 is now lost). Xeno-Flora Bloom (a caster that dies before it lands a
//   hit) and Ancient Ruins (no caster) do not move: nobody falls back or goes down there, so the rules never act.
// Hires: the save whose account pair runs Decapitate hires its Security member with that program (OC-F12); the fresh
//   save's hires are unchanged.
const GOLDEN_RUNS: Record<string, string[]> = {
  "1234": ["cf93601", "bc5d2821", "c2cdae61"],
  "3c3c": ["67722c38", "f54c52", "739b5279"],
  "5e5e": ["12adf5bf", "3aa8db38", "c741c836"],
  bebe: ["69fc79bf", "be493208", "72c4d6f2"],
  cfcf: ["f9be4ba1", "bc7ee1f1", "4c1e88ab"],
};
// The fix round (user answers 2026-11-10) re-pinned two more, each traced below ("the fix round's moves"):
// - enemyFortification 5502e0e5 to 67e64e5b: OC-F9 "Scale with the ramp". The fixture run is the first ramped run (curve
//   position 0, so its odds ramp is 0), where the casters' Corroded chance is now 0: the caster carries no Corroded and
//   draws no roll. With the odds ramp lifted to full (the enemy curve untouched) the fights read 5502e0e5 again.
// - hires custom 50ece9e5 to e24ce9f: OC-F12 "Merge with built-in". The Decapitate hire's copy now carries the built-in
//   cure, heal, brace and grenade rules ahead of the Decapitate rules (memberGambits.ts mergeWithBuiltInDefault).
// Saboteur (OC-F4) and Quick Draw (OC-F5) move no pin here: no fixture member has a status chance or Quick Draw (their
// unit tests are in wr10.test.ts).
const FIX_ROUND_BEFORE = { enemyFortification: "5502e0e5", custom: "50ece9e5" };
const GOLDEN_FIGHTS: Record<string, string> = { ...BEFORE_FIGHTS, enemyFortification: "67e64e5b" };
const GOLDEN_HIRES = { plain: BEFORE_HIRES.plain, custom: "e24ce9f" };

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

describe("WR-10: the fix round's moves", () => {
  it("enemyFortification: with the odds ramp lifted to full, the fights read the pre-fix-round pin", () => {
    const { exp } = wr10Dispatch(0x1234);
    const stamp = exp.difficulty as { ramp: number };
    expect(stamp.ramp).toBe(0);
    const full = { ...exp, difficulty: { ...(exp.difficulty as object), oddsRamp: 1 } } as typeof exp;
    expect(wr10FightHash(full, "enemyFortification")).toBe(FIX_ROUND_BEFORE.enemyFortification);
    expect(wr10FightHash(exp, "enemyFortification")).toBe(GOLDEN_FIGHTS.enemyFortification);
  });
  it("hires: the custom hire is the Decapitate copy merged with the built-in default", () => {
    const sec = wr10Hires(true).awayMembers.find((m) => m.teamType === "security")!;
    expect(sec.gambit).toEqual(mergeWithBuiltInDefault(gambitPresetPrograms("decapitate")!.security));
    // The hire without the merge (the Decapitate copy as WR-10 first gave it) hashes to the pre-fix-round pin.
    const unmerged = wr10Hires(true).awayMembers.map((m) => (m.teamType === "security" ? { ...m, gambit: gambitPresetPrograms("decapitate")!.security } : m));
    expect(wr10Hash(unmerged)).toBe(FIX_ROUND_BEFORE.custom);
  });
});

describe("WR-10 off reproduces every capture (BEFORE)", () => {
  for (const seed of WR10_SEEDS) {
    it(`run ${seed.toString(16)}`, { timeout: 120_000 }, () => expect(withWr10Off(() => wr10Run(seed).out)).toEqual(BEFORE_RUNS[seed.toString(16)]));
  }
  for (const poi of WR10_FIGHT_POIS) it(`fights at ${poi}`, () => expect(withWr10Off(() => wr10FightHash(wr10Dispatch(0x1234).exp, poi))).toBe(BEFORE_FIGHTS[poi]));
  it("hires", () => {
    expect(withWr10Off(() => wr10Hash(wr10Hires(false).awayMembers))).toBe(BEFORE_HIRES.plain);
    expect(withWr10Off(() => wr10Hash(wr10Hires(true).awayMembers))).toBe(BEFORE_HIRES.custom);
  });
});

// A run in flight at the update (dispatched before WR-10: no away rules stamp) replays byte-identically: a stamped
// dispatch with the stamp taken off advances and claims exactly as the WR-10-off dispatch does.
describe("WR-10: a run dispatched before it replays byte-identically", () => {
  for (const seed of WR10_SEEDS) {
    it(`run ${seed.toString(16)}`, { timeout: 120_000 }, () => {
      const { exp } = wr10Dispatch(seed);
      const { awayRules: _stamp, ...old } = exp;
      const offExp = withWr10Off(() => wr10Dispatch(seed).exp);
      expect(wr10Hash(old)).toBe(wr10Hash(offExp));
      expect(wr10Hash(advanceExpedition(old, 2_000_000))).toBe(BEFORE_RUNS[seed.toString(16)][1]);
    });
  }
});