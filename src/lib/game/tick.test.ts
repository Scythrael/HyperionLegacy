import { describe, it, expect, vi } from "vitest";
import {
  tick,
  tickCaptainMission,
  dispatchCaptainOnMission,
  recallCaptain,
  assignShipToCaptain,
  buyShip,
  craftRecipe,
  buyCaptainTalent,
  buyHomeworldTalent,
  respecCaptainTalents,
  respecHomeworldTalents,
  chooseCaptainSpec,
  applyFleetAdminXp,
  captainCommonYieldMult,
  captainUncommonYieldMult,
  captainUncommonChanceMult,
  captainRareChanceMult,
  fleetRareYieldMult,
  captainBonusRollChance,
  captainBonusRollChanceMult,
  captainSpecBonusRollChance,
  xpPerTick,
} from "./tick";
import Decimal from "break_infinity.js";
import { freshState, freshCaptains, MISSIONS, RECIPES, shipDerivedStats, type CaptainMissionState } from "./model";

function missionCaptain(missionKey: "shortOreRun" | "longOreRun" = "shortOreRun"): CaptainMissionState {
  return {
    missionKey,
    phase: "ordersReceived",
    phaseProgressTicks: 0,
    cargo: { commonOre: new Decimal(0), uncommonMaterial: new Decimal(0), rareMaterial: new Decimal(0) },
    recalled: false,
  };
}

// A constant (non-stateful) rng returning 0 on every call. Its meaning has
// changed TWICE across this codebase's history:
//   - Under the ORIGINAL mechanic: "always land on the first (commonOre)
//     bucket" -- the original reason for the name ALWAYS_MIN_ROLL.
//   - Under the (now-replaced) independent-per-tier mechanic: 0 passed BOTH
//     occurrence checks AND landed the uncommon amount-roll on its lowest
//     bucket, so every roll delivered uncommon=1 AND rare=1 simultaneously.
//   - Under THIS (2026-07-08 Extraction Rework) sequential mutually-exclusive
//     mechanic: rare is checked FIRST, and 0 passes ANY positive rareChance
//     check (0 < rareChance is true for both missions) -- so rng()=0 now
//     means RARE WINS OUTRIGHT ON THE VERY FIRST rng() CALL, every single
//     time. Uncommon and common are never even reached; only 1 rng() call
//     happens per roll, not 2 or 3. commonOre and uncommonMaterial are both
//     exactly 0 on every roll under this constant now (mutual exclusivity).
// Kept the same name across all three meanings since it's still, in every
// version, "the constant that always produces the rng() value most favorable
// to the earliest-checked/lowest-numbered tier or bucket" -- still a constant
// (not stateful) rng, so the closed-form "one big jump equals many small
// ticks" guarantee (which only requires an rng that behaves the SAME on
// every call, regardless of call count) is unaffected.
const ALWAYS_MIN_ROLL = () => 0;

describe("tickCaptainMission — closed-form requirement", () => {
  it("one big jump equals many small ticks, across multiple phase transitions", () => {
    const base = freshCaptains(1)[0];
    base.mission = missionCaptain("shortOreRun");
    // shortOreRun total ticks per cycle: 1 (orders) + 25 (out) + 90 (extract) + 25 (back) + 8 (unload) = 149.
    // 320 ticksElapsed crosses more than one full cycle (auto-repeat, 320 > 2*149=298).
    const bigJump = tickCaptainMission(320, base, ALWAYS_MIN_ROLL);

    let steppedCaptain = base;
    // Decimal, not a plain-number literal accumulator -- mirrors homePlanetDelta's own
    // Decimal shape so the .plus() accumulation below stays in Decimal-land throughout,
    // same "accumulate locally, apply once" pattern tick.ts itself uses.
    let steppedDelta = { commonOre: new Decimal(0), uncommonMaterial: new Decimal(0), rareMaterial: new Decimal(0) };
    for (let i = 0; i < 3200; i++) {
      const result = tickCaptainMission(0.1, steppedCaptain, ALWAYS_MIN_ROLL);
      steppedCaptain = result.captain;
      steppedDelta = {
        commonOre: steppedDelta.commonOre.plus(result.homePlanetDelta.commonOre),
        uncommonMaterial: steppedDelta.uncommonMaterial.plus(result.homePlanetDelta.uncommonMaterial),
        rareMaterial: steppedDelta.rareMaterial.plus(result.homePlanetDelta.rareMaterial),
      };
    }

    // Per-key .equals() checks (not .toEqual()) for both the mission's cargo (Decimal)
    // and homePlanetDelta -- established codebase convention (see save.test.ts's
    // Decimal-vs-Decimal comparisons) even when BOTH sides are real Decimal instances,
    // since toEqual's structural comparison isn't guaranteed reliable across Decimal's
    // internal mantissa/exponent representation. The non-Decimal mission fields
    // (phase, phaseProgressTicks, recalled, missionKey) are still plain toEqual-safe.
    expect(bigJump.captain.mission!.phase).toBe(steppedCaptain.mission!.phase);
    expect(bigJump.captain.mission!.phaseProgressTicks).toBeCloseTo(steppedCaptain.mission!.phaseProgressTicks, 6);
    expect(bigJump.captain.mission!.recalled).toBe(steppedCaptain.mission!.recalled);
    expect(bigJump.captain.mission!.missionKey).toBe(steppedCaptain.mission!.missionKey);
    expect(bigJump.captain.mission!.cargo.commonOre.equals(steppedCaptain.mission!.cargo.commonOre)).toBe(true);
    expect(
      bigJump.captain.mission!.cargo.uncommonMaterial.equals(steppedCaptain.mission!.cargo.uncommonMaterial)
    ).toBe(true);
    expect(bigJump.captain.mission!.cargo.rareMaterial.equals(steppedCaptain.mission!.cargo.rareMaterial)).toBe(true);
    expect(bigJump.homePlanetDelta.commonOre.equals(steppedDelta.commonOre)).toBe(true);
    expect(bigJump.homePlanetDelta.uncommonMaterial.equals(steppedDelta.uncommonMaterial)).toBe(true);
    expect(bigJump.homePlanetDelta.rareMaterial.equals(steppedDelta.rareMaterial)).toBe(true);
  });

  // Task 4 (captain XP -> per-tick accrual) CRITICAL parity test. Captain XP is
  // now earned per WHOLE tick the mission advances (not a lump per completed
  // cycle), so xp/level/statPoints must survive chunking exactly like cargo does
  // above. Stepped in SINGLE (1-tick) increments -- integer step size, so each
  // step advances exactly one whole tick and the closed-form whole-tick counter
  // increments by clean integers on both paths (no fractional-XP drift). The
  // subtract-threshold level-up loop is path-independent when the per-call cap
  // isn't hit, so resolving level-ups incrementally (320 small calls) must land
  // the SAME final level/statPoints/leftover-xp as one lump award (the big call).
  it("captain xp / level / statPoints: one big jump equals many single ticks (per-tick accrual)", () => {
    const base = freshCaptains(1)[0]; // xp 0, level 1, statPoints 0
    base.mission = missionCaptain("shortOreRun");
    // 320 whole ticks of rate-1 XP = 320 XP. xpForNextLevel(1)=300 (Task 4 curve),
    // so exactly one level-up: level 1->2, statPoints 0->1, xp 320-300 = 20 left.
    const bigJump = tickCaptainMission(320, base, ALWAYS_MIN_ROLL);

    let steppedCaptain = base;
    for (let i = 0; i < 320; i++) {
      steppedCaptain = tickCaptainMission(1, steppedCaptain, ALWAYS_MIN_ROLL).captain;
    }

    // The three XP-derived fields must agree across chunking (the whole point).
    expect(bigJump.captain.xp.equals(steppedCaptain.xp)).toBe(true);
    expect(bigJump.captain.level).toBe(steppedCaptain.level);
    expect(bigJump.captain.statPoints).toBe(steppedCaptain.statPoints);
    // Absolute values too, so the test also pins the exact expected numbers, not
    // just internal consistency between the two paths.
    expect(bigJump.captain.xp.equals(20)).toBe(true);
    expect(bigJump.captain.level).toBe(2);
    expect(bigJump.captain.statPoints).toBe(1);
  });

  it("zero or negative ticksElapsed is a no-op", () => {
    const base = freshCaptains(1)[0];
    base.mission = missionCaptain();
    const result = tickCaptainMission(0, base, ALWAYS_MIN_ROLL);
    expect(result.captain).toBe(base);
    expect(result.homePlanetDelta.commonOre.equals(0)).toBe(true);
    expect(result.homePlanetDelta.uncommonMaterial.equals(0)).toBe(true);
    expect(result.homePlanetDelta.rareMaterial.equals(0)).toBe(true);
  });

  it("a captain with no active mission is returned unchanged", () => {
    const base = freshCaptains(1)[0]; // mission: null
    const result = tickCaptainMission(100, base, ALWAYS_MIN_ROLL);
    expect(result.captain).toBe(base);
  });
});

describe("tickCaptainMission — phase progression", () => {
  it("advances phaseProgressTicks within ordersReceived without completing it", () => {
    const base = freshCaptains(1)[0];
    base.mission = missionCaptain();
    const { captain } = tickCaptainMission(0.5, base, ALWAYS_MIN_ROLL);
    expect(captain.mission!.phase).toBe("ordersReceived");
    expect(captain.mission!.phaseProgressTicks).toBeCloseTo(0.5, 6);
  });

  it("completes ordersReceived (1 tick) and moves into transitOut", () => {
    const base = freshCaptains(1)[0];
    base.mission = missionCaptain();
    const { captain } = tickCaptainMission(1, base, ALWAYS_MIN_ROLL);
    expect(captain.mission!.phase).toBe("transitOut");
    expect(captain.mission!.phaseProgressTicks).toBe(0);
  });

  it("carries leftover ticks into the next phase in the same call", () => {
    const base = freshCaptains(1)[0];
    base.mission = missionCaptain();
    // 1.5 ticks: completes the 1-tick ordersReceived phase, carries 0.5 into transitOut.
    const { captain } = tickCaptainMission(1.5, base, ALWAYS_MIN_ROLL);
    expect(captain.mission!.phase).toBe("transitOut");
    expect(captain.mission!.phaseProgressTicks).toBeCloseTo(0.5, 6);
  });

  it("advances all the way through extracting, transitBack, and unloading in one big call", () => {
    const base = freshCaptains(1)[0];
    base.mission = missionCaptain(); // shortOreRun: 1+25+90+25+8 = 149 ticks for one full cycle
    const { captain, homePlanetDelta } = tickCaptainMission(141.9, base, ALWAYS_MIN_ROLL);
    expect(captain.mission!.phase).toBe("unloading");
    expect(captain.mission!.phaseProgressTicks).toBeCloseTo(0.9, 6);
    // not unloaded yet -- per-key .equals(), not .toEqual() against a plain-number literal.
    expect(homePlanetDelta.commonOre.equals(0)).toBe(true);
    expect(homePlanetDelta.uncommonMaterial.equals(0)).toBe(true);
    expect(homePlanetDelta.rareMaterial.equals(0)).toBe(true);
  });
});

describe("tickCaptainMission — extraction loot rolls", () => {
  // shortOreRun: extractionRatePerTick 1, uncommonChance 0.019, rareChance 0.001.
  // A constant rng of 0.5 fails BOTH occurrence checks every roll (hand-verify:
  // rare check first: 0.5 < 0.001? no. uncommon check second: 0.5 < 0.019? no.) --
  // nothing but commonOre ever occurs.
  const NOTHING_OCCURS = () => 0.5;

  it("rolls loot once per whole tick crossed during extracting, adding extractionRatePerTick units each time", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain(), phase: "extracting", phaseProgressTicks: 0 };
    // 3.5 ticks of extracting crosses whole boundaries 1, 2, 3 -- 3 rolls. Neither
    // occurrence check ever passes (see NOTHING_OCCURS above), so every roll is
    // pure commonOre at the full per-tick base amount: 3 * 1 = 3.
    const { captain } = tickCaptainMission(3.5, base, NOTHING_OCCURS);
    expect(captain.mission!.cargo.commonOre.equals(3)).toBe(true);
    expect(captain.mission!.cargo.uncommonMaterial.equals(0)).toBe(true);
    expect(captain.mission!.cargo.rareMaterial.equals(0)).toBe(true);
    expect(captain.mission!.phaseProgressTicks).toBeCloseTo(3.5, 6);
  });

  it("a large jump resolves every extraction tick's loot roll, not just the last one", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain(), phase: "extracting", phaseProgressTicks: 0 };
    // Exactly 90 ticks completes extracting (cargoCapacity 90 / rate 1) -- 90 rolls, all
    // commonOre under NOTHING_OCCURS, each delivering the full base amount: 90 * 1 = 90.
    const { captain } = tickCaptainMission(90, base, NOTHING_OCCURS);
    expect(captain.mission!.cargo.commonOre.equals(90)).toBe(true);
    expect(captain.mission!.phase).toBe("transitBack"); // extracting completed, advanced
  });

  it("neither tier occurs: pure commonOre at the unmodified extractionRatePerTick", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain(), phase: "extracting", phaseProgressTicks: 0 };
    // Hand-trace (shortOreRun, 1 roll, NEW check order -- rare is checked FIRST, then
    // uncommon, then common wins by default):
    //   call 1 (rare occurrence): 0.5 < 0.001? no -> rare does NOT occur.
    //   call 2 (uncommon occurrence): 0.5 < 0.019? no -> uncommon does NOT occur.
    //   common wins by default (no roll needed): commonAmount = extractionRatePerTick 1 * (1+0) = 1.
    const { captain } = tickCaptainMission(1, base, NOTHING_OCCURS);
    expect(captain.mission!.cargo.commonOre.equals(1)).toBe(true);
    expect(captain.mission!.cargo.uncommonMaterial.equals(0)).toBe(true);
    expect(captain.mission!.cargo.rareMaterial.equals(0)).toBe(true);
  });

  it("ALWAYS_MIN_ROLL (rng=0) always lands on rare first, since 0 passes any positive rare-chance check", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain(), phase: "extracting", phaseProgressTicks: 0 };
    // A constant rng of 0 passes the VERY FIRST check every time, for any mission with a
    // positive rareChance -- rare wins immediately, only 1 rng() call is ever made, and
    // uncommon/common are never even reached. Hand-trace (shortOreRun, 1 roll):
    //   call 1 (rare occurrence): 0 < 0.001 -> true, rare occurs and wins outright.
    //   rareAmount = extractionRatePerTick 1 * (1+0) = 1. No further rng() calls happen.
    const { captain } = tickCaptainMission(1, base, ALWAYS_MIN_ROLL);
    expect(captain.mission!.cargo.rareMaterial.equals(1)).toBe(true);
    expect(captain.mission!.cargo.commonOre.equals(0)).toBe(true);
    expect(captain.mission!.cargo.uncommonMaterial.equals(0)).toBe(true);
  });

  it("omitting the bonuses arg behaves exactly as before (defaults to no bonus)", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain(), phase: "extracting", phaseProgressTicks: 0 };
    const { captain } = tickCaptainMission(1, base, NOTHING_OCCURS); // no 4th arg at all
    expect(captain.mission!.cargo.commonOre.equals(1)).toBe(true); // unmodified extractionRatePerTick
    expect(captain.mission!.cargo.uncommonMaterial.equals(0)).toBe(true);
    expect(captain.mission!.cargo.rareMaterial.equals(0)).toBe(true);
  });

  it("commonYieldMult scales the common tier's full amount when it wins, not whether it wins", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain(), phase: "extracting", phaseProgressTicks: 0 };
    // NOTHING_OCCURS (0.5) fails both occurrence checks regardless of commonYieldMult
    // (that bonus doesn't touch either chance) -- common wins by default, and its FULL
    // base amount is scaled: commonAmount = extractionRatePerTick 1 * (1+0.25) = 1.25.
    const { captain } = tickCaptainMission(1, base, NOTHING_OCCURS, { commonYieldMult: 0.25 });
    expect(captain.mission!.cargo.commonOre.equals(1.25)).toBe(true);
    expect(captain.mission!.cargo.uncommonMaterial.equals(0)).toBe(true);
    expect(captain.mission!.cargo.rareMaterial.equals(0)).toBe(true);
  });

  it("uncommonYieldMult scales only uncommon's rolled amount, when uncommon actually occurred", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain(), phase: "extracting", phaseProgressTicks: 0 };
    // A constant rng of 0.01 (shortOreRun, rareChance 0.001, uncommonChance 0.019). NEW
    // check order -- rare first, then uncommon:
    //   call 1 (rare occurrence): 0.01 < 0.001? no -> rare does NOT occur.
    //   call 2 (uncommon occurrence): 0.01 < 0.019 -> true, uncommon occurs and wins outright.
    //   uncommonAmount = extractionRatePerTick 1 * (1+0.5) = 1.5.
    // Mutual exclusivity means commonOre and rareMaterial are BOTH exactly 0 here -- the
    // winning tier gets the full amount, the other two tiers get nothing this roll.
    const rng = () => 0.01;
    const { captain } = tickCaptainMission(1, base, rng, { uncommonYieldMult: 0.5 });
    expect(captain.mission!.cargo.uncommonMaterial.equals(1.5)).toBe(true);
    expect(captain.mission!.cargo.commonOre.equals(0)).toBe(true);
    expect(captain.mission!.cargo.rareMaterial.equals(0)).toBe(true);
  });

  it("rareYieldMult scales only rare's rolled amount, when rare actually occurred", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain(), phase: "extracting", phaseProgressTicks: 0 };
    // A constant rng of 0.0005 (shortOreRun, rareChance 0.001). Rare is checked FIRST:
    //   call 1 (rare occurrence): 0.0005 < 0.001 -> true, rare occurs and wins outright.
    //   rareAmount = extractionRatePerTick 1 * (1+0.4) = 1.4. Only 1 rng() call happens --
    //   uncommon is never even checked, since rare already won.
    // uncommonMaterial and commonOre landing at exactly 0 (not some scaled/leftover value)
    // is exactly what proves rareYieldMult only scales rare's own tier, and that mutual
    // exclusivity holds -- the other two tiers get nothing when rare wins.
    const rng = () => 0.0005;
    const { captain } = tickCaptainMission(1, base, rng, { rareYieldMult: 0.4 });
    expect(captain.mission!.cargo.rareMaterial.equals(1.4)).toBe(true);
    expect(captain.mission!.cargo.uncommonMaterial.equals(0)).toBe(true);
    expect(captain.mission!.cargo.commonOre.equals(0)).toBe(true);
  });

  it("uncommonChanceMult shifts a borderline rng value across the uncommon occurrence threshold", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain("longOreRun"), phase: "extracting", phaseProgressTicks: 0 };
    // longOreRun: rareChance 0.02, uncommonChance 0.08. A constant rng of 0.1 is used for
    // EVERY call. NEW check order -- rare first, then uncommon, then common by default.
    // Unboosted: call 1 (rare occurrence) 0.1 < 0.02? no -> rare does NOT occur.
    //   call 2 (uncommon occurrence) 0.1 < 0.08? no -> uncommon does NOT occur either.
    //   common wins by default: commonAmount = extractionRatePerTick 1 * (1+0) = 1.
    const fixedRoll = () => 0.1;
    const unboosted = tickCaptainMission(1, base, fixedRoll);
    expect(unboosted.captain.mission!.cargo.commonOre.equals(1)).toBe(true);
    expect(unboosted.captain.mission!.cargo.uncommonMaterial.equals(0)).toBe(true);

    // Boosted: effectiveUncommonChance = 0.08 * (1 + 1) = 0.16. rareChanceMult is NOT set
    // on this call, so effectiveRareChance stays 0.02. call 1 (rare occurrence): 0.1 < 0.02?
    // no -> rare does NOT occur. call 2 (uncommon occurrence): 0.1 < 0.16 -> true, uncommon
    // occurs and wins outright. uncommonAmount = 1 * (1+0) = 1 (uncommonYieldMult defaults
    // to 0). Same rng() value throughout, different outcome, purely because
    // uncommonChanceMult pushed the effective chance past 0.1. commonOre is exactly 0 here
    // (mutual exclusivity), not a leftover-subtraction value.
    const boosted = tickCaptainMission(1, base, fixedRoll, { uncommonChanceMult: 1 });
    expect(boosted.captain.mission!.cargo.uncommonMaterial.equals(1)).toBe(true);
    expect(boosted.captain.mission!.cargo.commonOre.equals(0)).toBe(true);
  });

  it("rareChanceMult shifts a borderline rng value across the rare occurrence threshold", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain("longOreRun"), phase: "extracting", phaseProgressTicks: 0 };
    // longOreRun: rareChance 0.02, uncommonChance 0.08. A constant rng of 0.09 is used for
    // EVERY call. 0.09 >= 0.08 fails the uncommon occurrence check in BOTH the unboosted and
    // boosted case below (uncommonChanceMult is never set on either call).
    // Unboosted: call 1 (rare occurrence) 0.09 < 0.02? no -> rare does NOT occur. call 2
    //   (uncommon occurrence) 0.09 < 0.08? no -> uncommon does NOT occur either. common
    //   wins by default: commonAmount = extractionRatePerTick 1 * (1+0) = 1.
    const fixedRoll = () => 0.09;
    const unboosted = tickCaptainMission(1, base, fixedRoll);
    expect(unboosted.captain.mission!.cargo.rareMaterial.equals(0)).toBe(true);
    expect(unboosted.captain.mission!.cargo.commonOre.equals(1)).toBe(true);

    // Boosted: effectiveRareChance = 0.02 * (1 + 4) = 0.1. Rare is checked FIRST: call 1
    //   (rare occurrence): 0.09 < 0.1 -> true, rare occurs and wins outright -- uncommon is
    //   NEVER checked this time (differs from the old mechanic, which checked uncommon
    //   first regardless of rare's outcome). rareAmount = extractionRatePerTick 1 * (1+0) = 1
    //   (rareYieldMult defaults to 0 on this call). commonOre and uncommonMaterial are both
    //   exactly 0 (mutual exclusivity).
    const boosted = tickCaptainMission(1, base, fixedRoll, { rareChanceMult: 4 });
    expect(boosted.captain.mission!.cargo.rareMaterial.equals(1)).toBe(true);
    expect(boosted.captain.mission!.cargo.commonOre.equals(0)).toBe(true);
    expect(boosted.captain.mission!.cargo.uncommonMaterial.equals(0)).toBe(true);
  });
});

describe("tickCaptainMission — bonus roll (Resourcefulness Lucky Strike)", () => {
  it("bonus trigger check fails: only the primary roll's delta is added, no extra rng() calls consumed", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain(), phase: "extracting", phaseProgressTicks: 0 };
    // shortOreRun, rng constant 0.5: primary rare/uncommon both fail (0.5 < 0.001? no, 0.5 < 0.019? no)
    // -> common wins, amount 1. Bonus trigger: effectiveBonusRollChance = 0.02*(1+0) = 0.02, 0.5 < 0.02?
    // no -> bonus never fires. Total: commonOre 1, uncommon/rare both 0.
    const { captain } = tickCaptainMission(1, base, () => 0.5, { bonusRollChance: 0.02 });
    expect(captain.mission!.cargo.commonOre.equals(1)).toBe(true);
    expect(captain.mission!.cargo.uncommonMaterial.equals(0)).toBe(true);
    expect(captain.mission!.cargo.rareMaterial.equals(0)).toBe(true);
  });

  it("bonus trigger fires and its own mini-sequence lands on rare", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain(), phase: "extracting", phaseProgressTicks: 0 };
    // A constant rng of 0.0005 (shortOreRun rareChance 0.001): primary roll call 1 (rare) -- 0.0005 <
    // 0.001 -> true, primary rare wins, amount 1, only 1 rng() call for the primary. Bonus trigger check
    // (call 2): effectiveBonusRollChance = 0.02*(1+0) = 0.02, 0.0005 < 0.02 -> true, bonus fires. Bonus
    // mini-sequence call 3 (rare): 0.0005 < 0.001 -> true, bonus ALSO lands rare, amount 1. Total:
    // rareMaterial = 1 (primary) + 1 (bonus) = 2, commonOre/uncommonMaterial both 0.
    const { captain } = tickCaptainMission(1, base, () => 0.0005, { bonusRollChance: 0.02 });
    expect(captain.mission!.cargo.rareMaterial.equals(2)).toBe(true);
    expect(captain.mission!.cargo.commonOre.equals(0)).toBe(true);
    expect(captain.mission!.cargo.uncommonMaterial.equals(0)).toBe(true);
  });

  it("bonus trigger fires and its own mini-sequence lands on uncommon", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain(), phase: "extracting", phaseProgressTicks: 0 };
    // A constant rng of 0.01 (shortOreRun rareChance 0.001, uncommonChance 0.019): primary roll -- rare
    // 0.01 < 0.001? no. uncommon 0.01 < 0.019? yes -> primary uncommon wins, amount 1 (2 rng() calls).
    // Bonus trigger (call 3): 0.01 < 0.02 -> true, fires. Bonus mini-sequence -- rare (call 4) 0.01 <
    // 0.001? no. uncommon (call 5) 0.01 < 0.019? yes -> bonus ALSO lands uncommon, amount 1. Total:
    // uncommonMaterial = 1 (primary) + 1 (bonus) = 2, commonOre/rareMaterial both 0.
    const { captain } = tickCaptainMission(1, base, () => 0.01, { bonusRollChance: 0.02 });
    expect(captain.mission!.cargo.uncommonMaterial.equals(2)).toBe(true);
    expect(captain.mission!.cargo.commonOre.equals(0)).toBe(true);
    expect(captain.mission!.cargo.rareMaterial.equals(0)).toBe(true);
  });

  it("bonus trigger fires, its rare/uncommon checks both miss, and its 30% common check HITS", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain(), phase: "extracting", phaseProgressTicks: 0 };
    // A stateful rng sequence: primary roll (calls 1-2) both fail shortOreRun's rare (0.001) and uncommon
    // (0.019) checks using 0.5 -> primary common wins, amount 1. Bonus trigger (call 3) uses 0.02 (a
    // value comfortably below the 0.05 chance passed in) -> fires. Bonus mini-sequence: rare (call 4)
    // 0.5 fails, uncommon (call 5) 0.5 fails, common-30% check (call 6) uses 0.2 -> 0.2 < 0.3 -> true,
    // bonus lands common too. Total: commonOre = 1 (primary) + 1 (bonus) = 2.
    const values = [0.5, 0.5, 0.02, 0.5, 0.5, 0.2];
    let i = 0;
    const rng = () => values[i++];
    const { captain } = tickCaptainMission(1, base, rng, { bonusRollChance: 0.05 });
    expect(captain.mission!.cargo.commonOre.equals(2)).toBe(true);
    expect(captain.mission!.cargo.uncommonMaterial.equals(0)).toBe(true);
    expect(captain.mission!.cargo.rareMaterial.equals(0)).toBe(true);
  });

  it("bonus trigger fires but all 3 of its own checks miss: bonus delta is zero, only the primary's amount is delivered", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain(), phase: "extracting", phaseProgressTicks: 0 };
    // Same 6-call shape as the previous test, but the final common-30% check uses 0.9 (fails: 0.9 < 0.3?
    // no) -- all 3 of the bonus's own checks miss, so the bonus roll contributes NOTHING this tick.
    const values = [0.5, 0.5, 0.02, 0.5, 0.5, 0.9];
    let i = 0;
    const rng = () => values[i++];
    const { captain } = tickCaptainMission(1, base, rng, { bonusRollChance: 0.05 });
    expect(captain.mission!.cargo.commonOre.equals(1)).toBe(true); // primary only, bonus delivered 0
    expect(captain.mission!.cargo.uncommonMaterial.equals(0)).toBe(true);
    expect(captain.mission!.cargo.rareMaterial.equals(0)).toBe(true);
  });

  it("no bonus-roll talents unlocked: bonusRollChance/bonusRollChanceMult default to 0, bonus check never fires regardless of rng", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain(), phase: "extracting", phaseProgressTicks: 0 };
    // rng constant 0 -- would trigger EVERY check if any chance were nonzero (0 < any positive chance is
    // always true). With no bonuses arg at all, bonusRollChance/bonusRollChanceMult both resolve to 0 via
    // the ?? 0 fallback, so effectiveBonusRollChance is exactly 0, and 0 < 0 is false -- bonus never
    // fires even under the most favorable possible rng. Primary roll (rare checked first) DOES fire:
    // rare wins on rng()=0 (matches the existing ALWAYS_MIN_ROLL test in the primary describe block).
    const { captain } = tickCaptainMission(1, base, ALWAYS_MIN_ROLL);
    expect(captain.mission!.cargo.rareMaterial.equals(1)).toBe(true); // primary only
    expect(captain.mission!.cargo.commonOre.equals(0)).toBe(true);
    expect(captain.mission!.cargo.uncommonMaterial.equals(0)).toBe(true);
  });

  // Task 2c (Talent Tree Visual Redesign, Captain Specialization) -- regression
  // guard for the exact correctness trap this task's design doc calls out:
  // captainSpecBonusRollChance's +0.01 MUST be added AFTER
  // bonusRollChance*(1+bonusRollChanceMult) is computed, not folded into
  // bonusRollChance beforehand. With both prospectorLuckyStrikeI/II
  // unlocked (bonusRollChance 0.02, bonusRollChanceMult 1.0) and
  // spec:"resourcefulness" (specBonusRollChance 0.01), the CORRECT effective
  // bonus-trigger chance is 0.02*(1+1.0) + 0.01 = 0.05 exactly. A WRONG
  // implementation that instead folded 0.01 into the base before scaling would
  // compute (0.02+0.01)*(1+1.0) = 0.06 instead -- a full 0.01 higher, which
  // these two tests below would catch by using an rng value that sits between
  // the two candidate boundaries.
  //
  // Hand-traced call order (both tests below), from the live tick.ts source
  // (tickCaptainMission's extracting-phase loop body):
  //   call 1: rollExtractionTick's rare check      -- rng() < effectiveRareChance
  //   call 2: rollExtractionTick's uncommon check  -- rng() < effectiveUncommonChance
  //   call 3: bonus-roll TRIGGER check             -- rng() < effectiveBonusRollChance
  //   (only if call 3 passes:)
  //   call 4: rollBonusExtractionTick's rare check     -- rng() < effectiveRareChance
  //   call 5: rollBonusExtractionTick's uncommon check -- rng() < effectiveUncommonChance
  //   call 6: rollBonusExtractionTick's common 30% check -- rng() < BONUS_ROLL_COMMON_CHANCE (0.3)
  //
  // Both prospectorKeenEyeI/II are ALSO unlocked in this captain's
  // setup below (uncommonChanceMult 0.25, rareChanceMult 0.5), per the design
  // doc's own scenario -- this only affects calls 1/2/4/5's thresholds, not
  // the trigger check at call 3, but it's included here to keep the setup
  // identical to the design doc's stated regression scenario:
  //   effectiveRareChance     = shortOreRun.rareChance 0.001 * (1+0.5)  = 0.0015
  //   effectiveUncommonChance = shortOreRun.uncommonChance 0.019 * (1+0.25) = 0.02375
  // A constant rng of 0.0499 or 0.0501 clears BOTH of those thresholds easily
  // (both are comfortably under 0.04), so calls 1 and 2 fail identically in
  // both tests below regardless of which side of 0.05 the constant sits on --
  // isolating the boundary check to call 3 alone, exactly as intended.
  it("resourcefulness spec + both Lucky Strike talents combine to exactly 0.05, not 0.06 (regression guard for the spec-bonus scaling order) -- BELOW the boundary fires the bonus", () => {
    const base = freshCaptains(1)[0];
    base.spec = "resourcefulness";
    base.unlockedCaptainTalents = [
      "prospectorKeenEyeI",
      "prospectorKeenEyeII",
      "prospectorLuckyStrikeI",
      "prospectorLuckyStrikeII",
    ];
    base.mission = { ...missionCaptain(), phase: "extracting", phaseProgressTicks: 0 };
    const bonuses = {
      uncommonChanceMult: captainUncommonChanceMult(base), // 0.25
      rareChanceMult: captainRareChanceMult(base), // 0.5
      bonusRollChance: captainBonusRollChance(base), // 0.02
      bonusRollChanceMult: captainBonusRollChanceMult(base), // 1.0
      specBonusRollChance: captainSpecBonusRollChance(base), // 0.01 (spec:"resourcefulness")
    };
    // A single constant of 0.0499 for every call:
    //   call 1 (rare, 0.0015 threshold): 0.0499 < 0.0015? no.
    //   call 2 (uncommon, 0.02375 threshold): 0.0499 < 0.02375? no -> primary common wins, commonOre += 1.
    //   call 3 (bonus trigger, TRUE threshold 0.02*(1+1.0)+0.01 = 0.05): 0.0499 < 0.05 -> YES, bonus fires.
    //   call 4 (bonus rare, 0.0015): 0.0499 < 0.0015? no.
    //   call 5 (bonus uncommon, 0.02375): 0.0499 < 0.02375? no.
    //   call 6 (bonus common 30%): 0.0499 < 0.3 -> YES, bonus lands common too, commonOre += 1.
    // Total: commonOre = 1 (primary) + 1 (bonus) = 2. If the WRONG (folded-in,
    // 0.06 threshold) implementation were in place instead, call 3's check
    // would be 0.0499 < 0.06 -- ALSO true, so this test alone can't distinguish
    // 0.05 from 0.06; the companion "ABOVE the boundary" test right below
    // is what actually proves the boundary sits at 0.05, not 0.06 or anything else.
    const { captain } = tickCaptainMission(1, base, () => 0.0499, bonuses);
    expect(captain.mission!.cargo.commonOre.equals(2)).toBe(true);
    expect(captain.mission!.cargo.uncommonMaterial.equals(0)).toBe(true);
    expect(captain.mission!.cargo.rareMaterial.equals(0)).toBe(true);
  });

  it("resourcefulness spec + both Lucky Strike talents combine to exactly 0.05, not 0.06 (regression guard for the spec-bonus scaling order) -- ABOVE the boundary does NOT fire the bonus", () => {
    const base = freshCaptains(1)[0];
    base.spec = "resourcefulness";
    base.unlockedCaptainTalents = [
      "prospectorKeenEyeI",
      "prospectorKeenEyeII",
      "prospectorLuckyStrikeI",
      "prospectorLuckyStrikeII",
    ];
    base.mission = { ...missionCaptain(), phase: "extracting", phaseProgressTicks: 0 };
    const bonuses = {
      uncommonChanceMult: captainUncommonChanceMult(base),
      rareChanceMult: captainRareChanceMult(base),
      bonusRollChance: captainBonusRollChance(base),
      bonusRollChanceMult: captainBonusRollChanceMult(base),
      specBonusRollChance: captainSpecBonusRollChance(base),
    };
    // Same constant-rng approach, but 0.0501 this time:
    //   call 1 (rare, 0.0015): 0.0501 < 0.0015? no.
    //   call 2 (uncommon, 0.02375): 0.0501 < 0.02375? no -> primary common wins, commonOre += 1.
    //   call 3 (bonus trigger, TRUE threshold 0.05): 0.0501 < 0.05? NO -- bonus does NOT fire.
    //   (no further rng() calls happen -- the bonus mini-sequence is only
    //   entered if call 3 passes.)
    // Total: commonOre = 1 (primary only). This is the test that actually
    // proves the boundary sits at 0.05 and not 0.06 -- a WRONG (folded-in)
    // implementation using a 0.06 threshold would have call 3 evaluate
    // 0.0501 < 0.06 -> TRUE, firing the bonus and producing commonOre = 2
    // instead, failing this assertion.
    const { captain } = tickCaptainMission(1, base, () => 0.0501, bonuses);
    expect(captain.mission!.cargo.commonOre.equals(1)).toBe(true);
    expect(captain.mission!.cargo.uncommonMaterial.equals(0)).toBe(true);
    expect(captain.mission!.cargo.rareMaterial.equals(0)).toBe(true);
  });

  // Task 2c: confirms spec:null (no Captain Specialization chosen) is
  // BYTE-FOR-BYTE identical to this whole feature's pre-existing behavior --
  // the same captain/talent setup as the two regression-guard tests directly
  // above, but with spec left at its default null, so specBonusRollChance
  // resolves to 0 (see captainSpecBonusRollChance's own "else 0" branch).
  // effectiveBonusRollChance is then exactly 0.02*(1+1.0) + 0 = 0.04 -- the
  // OLD (pre-Captain-Specialization) value -- not 0.05. Reusing the SAME
  // 0.0499 constant as the "BELOW the boundary" test above (which fired the
  // bonus at the 0.05 threshold) but here the bonus must NOT fire, since
  // 0.0499 is ABOVE this test's 0.04 threshold -- the sharpest possible
  // contrast between "spec chosen" and "spec: null" using one identical rng
  // value.
  it("spec: null leaves the effective bonus-roll chance at the pre-spec value (0.04, not 0.05)", () => {
    const base = freshCaptains(1)[0];
    // base.spec is already null by freshCaptains' own default -- left
    // unset here deliberately, not explicitly reassigned, so this test also
    // documents that null is the baseline rather than something a caller
    // must remember to reset.
    base.unlockedCaptainTalents = [
      "prospectorKeenEyeI",
      "prospectorKeenEyeII",
      "prospectorLuckyStrikeI",
      "prospectorLuckyStrikeII",
    ];
    base.mission = { ...missionCaptain(), phase: "extracting", phaseProgressTicks: 0 };
    const bonuses = {
      uncommonChanceMult: captainUncommonChanceMult(base),
      rareChanceMult: captainRareChanceMult(base),
      bonusRollChance: captainBonusRollChance(base), // 0.02
      bonusRollChanceMult: captainBonusRollChanceMult(base), // 1.0
      specBonusRollChance: captainSpecBonusRollChance(base), // 0 -- spec is null
    };
    // call 1 (rare, 0.0015): 0.0499 < 0.0015? no.
    // call 2 (uncommon, 0.02375): 0.0499 < 0.02375? no -> primary common wins, commonOre += 1.
    // call 3 (bonus trigger, TRUE threshold here 0.02*(1+1.0)+0 = 0.04): 0.0499 < 0.04?
    //   NO -- bonus does NOT fire (0.0499 is above 0.04, even though it's below 0.05).
    // Total: commonOre = 1 (primary only) -- proving the pre-spec ceiling is 0.04,
    // not 0.05, for this exact same talent configuration.
    const { captain } = tickCaptainMission(1, base, () => 0.0499, bonuses);
    expect(captain.mission!.cargo.commonOre.equals(1)).toBe(true);
    expect(captain.mission!.cargo.uncommonMaterial.equals(0)).toBe(true);
    expect(captain.mission!.cargo.rareMaterial.equals(0)).toBe(true);
  });
});

describe("captainCommonYieldMult / captainUncommonYieldMult / captainUncommonChanceMult / captainRareChanceMult / fleetRareYieldMult", () => {
  it("captainCommonYieldMult is 0 for a captain with no unlocked talents", () => {
    const captain = freshCaptains(1)[0];
    expect(captainCommonYieldMult(captain)).toBe(0);
  });

  it("captainCommonYieldMult reads prospectorBulkExtraction's mult when unlocked (Bulk Extraction)", () => {
    const captain = freshCaptains(1)[0];
    captain.unlockedCaptainTalents = ["prospectorBulkExtraction"];
    expect(captainCommonYieldMult(captain)).toBeCloseTo(0.1, 6);
  });

  it("captainCommonYieldMult ignores unlocked talents of OTHER effect types", () => {
    const captain = freshCaptains(1)[0];
    // prospectorRefinedExtraction/prospectorKeenEyeI/II are uncommonYieldMult,
    // uncommonChanceMult, and rareChanceMult respectively -- none is commonYieldMult.
    // Set directly on unlockedCaptainTalents (bypassing buyCaptainTalent's own
    // adjacency validation) purely to exercise this helper's effect-type filter.
    captain.unlockedCaptainTalents = ["prospectorRefinedExtraction", "prospectorKeenEyeI", "prospectorKeenEyeII"];
    expect(captainCommonYieldMult(captain)).toBe(0);
  });

  it("captainUncommonYieldMult is 0 for a captain with no unlocked talents", () => {
    const captain = freshCaptains(1)[0];
    expect(captainUncommonYieldMult(captain)).toBe(0);
  });

  it("captainUncommonYieldMult reads prospectorRefinedExtraction's mult when unlocked (Refined Extraction)", () => {
    const captain = freshCaptains(1)[0];
    // prospectorRefinedExtraction neighbors prospectorBulkExtraction in the radial
    // web, but this helper only reads unlockedCaptainTalents -- set directly rather
    // than going through buyCaptainTalent's own adjacency validation.
    captain.unlockedCaptainTalents = ["prospectorRefinedExtraction"];
    expect(captainUncommonYieldMult(captain)).toBeCloseTo(0.15, 6);
  });

  it("captainUncommonChanceMult is 0 for a captain with no unlocked talents", () => {
    const captain = freshCaptains(1)[0];
    expect(captainUncommonChanceMult(captain)).toBe(0);
  });

  it("captainUncommonChanceMult reads prospectorKeenEyeI's mult when unlocked (Keen Eye I)", () => {
    const captain = freshCaptains(1)[0];
    captain.unlockedCaptainTalents = ["prospectorKeenEyeI"];
    expect(captainUncommonChanceMult(captain)).toBeCloseTo(0.25, 6);
  });

  it("captainRareChanceMult is 0 for a captain with no unlocked talents", () => {
    const captain = freshCaptains(1)[0];
    expect(captainRareChanceMult(captain)).toBe(0);
  });

  it("captainRareChanceMult reads prospectorKeenEyeII's mult when unlocked (Keen Eye II)", () => {
    const captain = freshCaptains(1)[0];
    captain.unlockedCaptainTalents = ["prospectorKeenEyeII"];
    expect(captainRareChanceMult(captain)).toBeCloseTo(0.5, 6);
  });

  it("fleetRareYieldMult is 0 with no unlocked Homeworld Talents", () => {
    const state = freshState();
    expect(fleetRareYieldMult(state)).toBe(0);
  });

  it("fleetRareYieldMult reads fleetLogisticsYield's mult when unlocked (Fleet Requisitions)", () => {
    const state = freshState();
    state.unlockedHomeworldTalents = ["fleetLogisticsYield"];
    expect(fleetRareYieldMult(state)).toBeCloseTo(0.05, 6);
  });

  it("captainBonusRollChance sums bonusRollChance across unlocked talents", () => {
    const captain = freshCaptains(1)[0];
    expect(captainBonusRollChance(captain)).toBe(0);
    captain.unlockedCaptainTalents = ["prospectorLuckyStrikeI"];
    expect(captainBonusRollChance(captain)).toBe(0.02);
  });

  it("captainBonusRollChanceMult sums bonusRollChanceMult across unlocked talents", () => {
    const captain = freshCaptains(1)[0];
    expect(captainBonusRollChanceMult(captain)).toBe(0);
    captain.unlockedCaptainTalents = ["prospectorLuckyStrikeII"];
    expect(captainBonusRollChanceMult(captain)).toBe(1.0);
  });

  // Task 2c (Talent Tree Visual Redesign, Captain Specialization): direct
  // unit coverage for captainSpecBonusRollChance itself, independent of the
  // talent tree -- CAPTAIN_SPEC_BONUS.resourcefulness's flat +0.01 grant only
  // applies when captain.spec === "resourcefulness" exactly; every other spec
  // value (tactical/science, which have no CAPTAIN_SPEC_BONUS entry at all yet)
  // and null (no spec chosen) both yield 0 here.
  it("captainSpecBonusRollChance returns 0.01 for spec:resourcefulness, else 0", () => {
    const captain = freshCaptains(1)[0];
    expect(captainSpecBonusRollChance(captain)).toBe(0);
    captain.spec = "resourcefulness";
    expect(captainSpecBonusRollChance(captain)).toBe(0.01);
    captain.spec = "tactical";
    expect(captainSpecBonusRollChance(captain)).toBe(0);
    captain.spec = null;
    expect(captainSpecBonusRollChance(captain)).toBe(0);
  });

  // Radial Skill Web (Task 7): the test that used to sit here --
  // "captainCommonYieldMult includes the command spec's +0.05, independent of
  // talent-tree nodes" -- was REMOVED, not re-pointed. Its whole purpose was
  // the CAPTAIN_SPEC_BONUS.command fold-in inside captainCommonYieldMult, and
  // both the `command` branch/spec and that fold-in were deleted in Task 2/7.
  // There is no equivalent commonYieldMult spec bonus to re-point it at (the
  // surviving `resourcefulness` spec bonus is a bonusRollChance grant, already
  // covered by captainSpecBonusRollChance's own test above), so re-pointing
  // would have invented coverage for behavior that no longer exists.
});

// Progression Pacing Rework (Task 3, docs/plans/2026-07-11-progression-pacing-
// rework-*): xpPerTick is the SHARED per-tick XP RATE helper that Task 4
// (captain XP accrual) and Task 5 (Fleet Admiral XP) will both consume. Today
// it returns the mission's flat BASE_XP_PER_TICK (both missions = 1) unchanged,
// because there are NO XP-boosting captain talents or global buffs yet -- the
// `captain`/`state` params are the reserved multiplier-seam hooks (see
// xpPerTick's own comment in tick.ts for exactly where a future XP-mult plugs
// in). Mirrors the "no unlocked talents" mult-helper tests directly above:
// a fresh captain with an empty talent set must see the unmodified base rate.
describe("xpPerTick — per-tick XP rate", () => {
  it("returns the base rate (1) for shortOreRun with a captain that has no talents", () => {
    const captain = freshCaptains(1)[0]; // fresh -> unlockedCaptainTalents: [], spec: null
    expect(xpPerTick("shortOreRun", captain)).toBe(1);
  });

  it("returns the base rate (1) for longOreRun with a captain that has no talents", () => {
    const captain = freshCaptains(1)[0];
    expect(xpPerTick("longOreRun", captain)).toBe(1);
  });
});

describe("tickCaptainMission — cycle completion, auto-repeat, and recall", () => {
  it("completing a full cycle (not recalled) delivers cargo to homePlanetDelta and restarts at ordersReceived", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain(), phase: "unloading", phaseProgressTicks: 0 };
    base.mission.cargo = {
      commonOre: new Decimal(90),
      uncommonMaterial: new Decimal(8),
      rareMaterial: new Decimal(2),
    };
    const { captain, homePlanetDelta } = tickCaptainMission(8, base, ALWAYS_MIN_ROLL); // 8 ticks completes unloadTicks=8

    expect(homePlanetDelta.commonOre.equals(90)).toBe(true);
    expect(homePlanetDelta.uncommonMaterial.equals(8)).toBe(true);
    expect(homePlanetDelta.rareMaterial.equals(2)).toBe(true);
    expect(captain.mission!.phase).toBe("ordersReceived"); // auto-repeated
    expect(captain.mission!.phaseProgressTicks).toBe(0);
    // reset -- per-key .equals(), not .toEqual() against a plain-number literal.
    expect(captain.mission!.cargo.commonOre.equals(0)).toBe(true);
    expect(captain.mission!.cargo.uncommonMaterial.equals(0)).toBe(true);
    expect(captain.mission!.cargo.rareMaterial.equals(0)).toBe(true);
    expect(captain.mission!.recalled).toBe(false);
  });

  it("completing a full cycle WHILE recalled ends the mission (mission becomes null)", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain(), phase: "unloading", phaseProgressTicks: 0, recalled: true };
    base.mission.cargo = { commonOre: new Decimal(50), uncommonMaterial: new Decimal(0), rareMaterial: new Decimal(0) };
    const { captain, homePlanetDelta } = tickCaptainMission(8, base, ALWAYS_MIN_ROLL); // 8 ticks completes unloadTicks=8

    expect(homePlanetDelta.commonOre.equals(50)).toBe(true);
    expect(homePlanetDelta.uncommonMaterial.equals(0)).toBe(true);
    expect(homePlanetDelta.rareMaterial.equals(0)).toBe(true);
    expect(captain.mission).toBe(null);
  });

  it("a big jump can complete multiple full auto-repeat cycles, accumulating homePlanetDelta across all of them", () => {
    const base = freshCaptains(1)[0];
    base.mission = missionCaptain(); // shortOreRun, 149 ticks/cycle
    const { captain, homePlanetDelta } = tickCaptainMission(298, base, ALWAYS_MIN_ROLL); // exactly 2 full cycles (2*149)

    // Each cycle's extracting phase is 90 whole-tick rolls (cargoCapacity 90 / rate 1).
    // Under ALWAYS_MIN_ROLL (rng() constant 0), rare is checked FIRST every roll and 0
    // passes any positive rareChance check -- so EVERY roll delivers rareMaterial 1 (the
    // full extractionRatePerTick base amount, unscaled), and commonOre/uncommonMaterial
    // are both 0 for every roll (mutual exclusivity; see the "ALWAYS_MIN_ROLL always
    // lands on rare first" hand-trace above). Per cycle: 90 rolls * 1 rareMaterial = 90
    // rare, 0 common, 0 uncommon. 2 cycles = 180 rare, 0 common, 0 uncommon.
    expect(homePlanetDelta.commonOre.equals(0)).toBe(true);
    expect(homePlanetDelta.uncommonMaterial.equals(0)).toBe(true);
    expect(homePlanetDelta.rareMaterial.equals(180)).toBe(true);
    expect(captain.mission!.phase).toBe("ordersReceived"); // mid-3rd-cycle-start, not recalled
    expect(captain.mission!.phaseProgressTicks).toBe(0);
  });

  it("recall takes effect at the end of the CURRENT cycle, not immediately", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain(), phase: "extracting", phaseProgressTicks: 5, recalled: true };
    // 3 more ticks: still mid-extraction, far from completing the cycle -- recalled flag is inert until unloading finishes.
    const { captain } = tickCaptainMission(3, base, ALWAYS_MIN_ROLL);
    expect(captain.mission).not.toBe(null);
    expect(captain.mission!.phase).toBe("extracting");
    expect(captain.mission!.phaseProgressTicks).toBeCloseTo(8, 6);
  });
});

describe("tickCaptainMission — accrues captain XP per active tick", () => {
  // Task 4 replaced the old lump-per-completed-cycle award (xp += 50 on each
  // cycle) with PER-WHOLE-TICK accrual: the captain earns xpPerTick(missionKey)
  // (= BASE_XP_PER_TICK.shortOreRun = 1) for every whole tick the mission
  // advances this call, in ANY phase. Awarded on whole-tick boundaries (like the
  // loot rolls) so the accrual is closed-form/chunk-invariant.
  it("accrues XP per whole tick advanced even when NO cycle completes (proves tick-based, not lump-per-cycle)", () => {
    const base = freshCaptains(1)[0]; // xp 0, level 1, statPoints 0
    base.mission = missionCaptain(); // shortOreRun, 149 ticks/cycle -- 50 ticks completes NO cycle
    const { captain } = tickCaptainMission(50, base, ALWAYS_MIN_ROLL);
    // 50 whole ticks advanced (orders 1 + transitOut 25 + 24 into extracting) at
    // rate 1 = 50 XP. Under the OLD lump mechanic this would be 0 (no cycle done).
    expect(captain.xp.equals(50)).toBe(true);
    expect(captain.level).toBe(1); // 50 < xpForNextLevel(1)=300, no level-up yet
    expect(captain.statPoints).toBe(0); // unchanged -- no level-up occurred
  });

  it("accrues NO XP for a sub-whole (partial) tick until it completes a whole tick", () => {
    const base = freshCaptains(1)[0];
    base.mission = missionCaptain();
    const { captain } = tickCaptainMission(0.5, base, ALWAYS_MIN_ROLL); // 0.5 < 1 whole tick
    expect(captain.xp.equals(0)).toBe(true); // floor(0.5) - floor(0) = 0 whole ticks crossed
    expect(captain.level).toBe(1);
    expect(captain.statPoints).toBe(0);
  });

  it("levels up and grants a stat point when accrued XP crosses the 300xlevel threshold", () => {
    const base = freshCaptains(1)[0];
    base.mission = missionCaptain(); // shortOreRun, 149 ticks/cycle
    // 300 whole ticks (2 full cycles = 298 + 2 more) at rate 1 = 300 XP, which
    // exactly hits xpForNextLevel(1)=300 -> level 1->2 with 0 XP left over.
    const { captain } = tickCaptainMission(300, base, ALWAYS_MIN_ROLL);
    expect(captain.level).toBe(2);
    expect(captain.xp.equals(0)).toBe(true); // 300 - 300 = 0 leftover
    expect(captain.statPoints).toBe(1);
  });

  it("resolves multiple level-ups from one call's accrual (subtract-threshold carry-forward)", () => {
    const base = freshCaptains(1)[0];
    base.mission = missionCaptain(); // shortOreRun, 149 ticks/cycle
    // 900 whole ticks (6 full cycles = 894 + 6 more) = 900 XP. Level-up loop:
    //   900 >= 300 (thr level 1) -> xp 600, level 2
    //   600 >= 600 (thr level 2) -> xp 0,   level 3
    //   0   <  900 (thr level 3) -> stop
    // Final: level 3, xp 0, statPoints 2.
    const { captain } = tickCaptainMission(900, base, ALWAYS_MIN_ROLL);
    expect(captain.level).toBe(3);
    expect(captain.xp.equals(0)).toBe(true);
    expect(captain.statPoints).toBe(2);
  });
});

describe("tickCaptainMission — awards credits on cycle completion", () => {
  it("awards creditsDelta 0 when no cycle completes (partial ticksElapsed)", () => {
    const base = freshCaptains(1)[0];
    base.mission = missionCaptain(); // mid-cycle, phaseProgressTicks 0, far from completing
    const { creditsDelta } = tickCaptainMission(0.5, base, ALWAYS_MIN_ROLL);
    expect(creditsDelta).toBe(0);
  });

  it("awards creditsDelta 0 when the captain has no mission at all", () => {
    const base = freshCaptains(1)[0]; // freshCaptainStack's baseline -- mission is null (idle)
    const { creditsDelta } = tickCaptainMission(50, base, ALWAYS_MIN_ROLL);
    expect(creditsDelta).toBe(0);
  });

  it("awards creditsDelta 10 (MISSIONS.shortOreRun.creditsPerCycle) for exactly one completed shortOreRun cycle", () => {
    // Hand-traced against the LIVE MISSIONS.shortOreRun values (model.ts) via requiredTicksForPhase:
    // ordersReceived=1, transitOut=25, extracting=ceil(cargoCapacity 90 / extractionRatePerTick 1)=90,
    // transitBack=25, unloading=8. Total ticks for exactly 1 full cycle = 1+25+90+25+8 = 149 --
    // matches missionCaptain()'s own "149 ticks/cycle" comment used elsewhere in this file (e.g. the
    // "a big jump can complete multiple full auto-repeat cycles" test above).
    const base = freshCaptains(1)[0];
    base.mission = missionCaptain(); // shortOreRun, starts at ordersReceived, phaseProgressTicks 0
    const { creditsDelta } = tickCaptainMission(149, base, ALWAYS_MIN_ROLL);
    expect(creditsDelta).toBe(MISSIONS.shortOreRun.creditsPerCycle); // 10
  });

  it("awards creditsDelta 20 (MISSIONS.longOreRun.creditsPerCycle) for exactly one completed longOreRun cycle", () => {
    // Hand-traced against the LIVE MISSIONS.longOreRun values (model.ts) via requiredTicksForPhase:
    // ordersReceived=1, transitOut=70, extracting=ceil(cargoCapacity 90 / extractionRatePerTick 1)=90,
    // transitBack=70, unloading=8. Total ticks for exactly 1 full cycle = 1+70+90+70+8 = 239.
    const base = freshCaptains(1)[0];
    base.mission = missionCaptain("longOreRun"); // starts at ordersReceived, phaseProgressTicks 0
    const { creditsDelta } = tickCaptainMission(239, base, ALWAYS_MIN_ROLL);
    expect(creditsDelta).toBe(MISSIONS.longOreRun.creditsPerCycle); // 20
  });
});

describe("tickCaptainMission — accrues Fleet Admiral XP per active tick (Task 5)", () => {
  // Task 5 replaced the old lump-per-completed-cycle FA award
  // (fleetAdminXpDelta += missionDef.fleetAdminXpPerCycle on each finished cycle)
  // with PER-WHOLE-TICK accrual, mirroring captain XP (Task 4): the fleet earns
  // fleetAdminXpPerTick (= 1 for both launch missions) for every whole tick the
  // mission advances this call, in ANY phase, awarded once after the loop off the
  // SAME wholeTicksElapsed counter captain XP uses.
  it("accrues fleetAdminXpDelta per whole tick advanced even when NO cycle completes (proves per-tick, not per-cycle)", () => {
    const base = freshCaptains(1)[0];
    base.mission = missionCaptain(); // shortOreRun, 149 ticks/cycle -- 50 ticks completes NO cycle
    const { fleetAdminXpDelta } = tickCaptainMission(50, base, ALWAYS_MIN_ROLL);
    // 50 whole ticks advanced (orders 1 + transitOut 25 + 24 into extracting) at
    // fleetAdminXpPerTick 1 = 50. Under the OLD per-cycle mechanic this would be 0
    // (no cycle done in 50 of the 149 ticks a full cycle needs) -- so this asserts
    // the accrual is per-tick AND independent of cycle completion.
    expect(fleetAdminXpDelta).toBe(50);
  });

  it("accrues NO fleetAdminXpDelta for a sub-whole (partial) tick until it completes a whole tick", () => {
    const base = freshCaptains(1)[0];
    base.mission = missionCaptain();
    const { fleetAdminXpDelta } = tickCaptainMission(0.5, base, ALWAYS_MIN_ROLL); // 0.5 < 1 whole tick
    expect(fleetAdminXpDelta).toBe(0); // floor(0.5) - floor(0) = 0 whole ticks crossed
  });

  // Closed-form parity for the FA delta, mirroring the captain-XP parity test in
  // the "closed-form requirement" describe above: one big call must equal the sum
  // of many single-tick calls. Stepped in SINGLE (1-tick) integer increments, so
  // each step advances exactly one whole tick and the rate-1 integer product
  // carries no fractional drift on either path.
  it("closed-form parity: one big call's fleetAdminXpDelta equals the sum of many single-tick calls", () => {
    const base = freshCaptains(1)[0];
    base.mission = missionCaptain("shortOreRun");
    // 320 whole ticks of rate-1 FA XP = 320. (320 > 2*149=298, so this also spans
    // multiple auto-repeat cycles -- FA XP no longer cares about cycle count, only
    // whole ticks advanced, which is the whole behavior change under test.)
    const bigJump = tickCaptainMission(320, base, ALWAYS_MIN_ROLL);

    let steppedCaptain = base;
    let steppedFaDelta = 0;
    for (let i = 0; i < 320; i++) {
      const result = tickCaptainMission(1, steppedCaptain, ALWAYS_MIN_ROLL);
      steppedCaptain = result.captain;
      steppedFaDelta += result.fleetAdminXpDelta;
    }

    expect(bigJump.fleetAdminXpDelta).toBe(steppedFaDelta); // paths agree (the whole point)
    expect(bigJump.fleetAdminXpDelta).toBe(320); // and pin the exact expected number
    expect(steppedFaDelta).toBe(320);
  });
});

describe("tickCaptainMission / tick() — accrues mission-side lifetime stats (Task 6)", () => {
  // Task 6 (Progression Pacing Rework): tickCaptainMission now returns a
  // lifetimeStatsDelta (itemsGathered + missionsCompleted maps, plus 3 Decimal
  // scalars), and tick() folds it into state.lifetimeStats. This ADDS tracking
  // alongside the existing XP/loot/credit accrual -- it must not change any of
  // those existing values (asserted implicitly here: the same 149-tick cycle
  // still delivers the same loot/credits/XP it always did). itemsGathered mirrors
  // the loot delivered into homePlanetDelta; missionsCompleted counts completed
  // cycles; creditsEarned/captainXpAwarded/fleetAdminXpAwarded mirror creditsDelta
  // / the GROSS captain XP awarded this call / the FA XP awarded this call.

  it("one full shortOreRun cycle via tick(): missionsCompleted +1, itemsGathered mirrors delivered loot, credits/XP scalars pinned", () => {
    // Force every extraction roll onto rare (rng()=0 => rare wins outright -- see
    // ALWAYS_MIN_ROLL's comment above) so the delivered loot is deterministic: 90
    // extracting ticks * 1 unit = 90 rareMaterial, 0 common, 0 uncommon, and NO
    // bonus rolls (bonusRollChance is 0 with no talents). tick() calls Math.random
    // directly (it does NOT take a passed-in rng), so it is mocked here rather than
    // threaded in the way tickCaptainMission's own tests pass ALWAYS_MIN_ROLL.
    const rngSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const state = freshState(); // 1 captain + a generalFreighter (cargo 90 / 1.0x / 1.0x == the base mission geometry, so the cycle is 149 ticks)
      state.captains[0].mission = missionCaptain("shortOreRun");
      // shortOreRun cycle = 1 + 25 + 90 + 25 + 8 = 149 ticks; tickDurationSeconds is
      // 1 by fresh default, so 149 seconds advances EXACTLY one full cycle (unloading
      // completes and auto-repeats to ordersReceived/0). 149 whole ticks => 149 gross
      // captain XP + 149 FA XP at rate 1.
      const result = tick(149, state);

      // missionsCompleted: exactly one shortOreRun cycle finished this call.
      expect(result.lifetimeStats.missionsCompleted.shortOreRun.equals(1)).toBe(true);

      // itemsGathered MIRRORS the loot delivered into homePlanet.storage. freshState
      // starts storage all-zero and has no passiveTrickle, so the storage delta IS
      // the delivered mission loot -- itemsGathered must equal it key-for-key.
      expect(result.lifetimeStats.itemsGathered.rareMaterial.equals(90)).toBe(true);
      expect(result.lifetimeStats.itemsGathered.commonOre.equals(0)).toBe(true);
      expect(result.lifetimeStats.itemsGathered.uncommonMaterial.equals(0)).toBe(true);
      expect(result.lifetimeStats.itemsGathered.rareMaterial.equals(result.homePlanet.storage.rareMaterial)).toBe(true);
      expect(result.lifetimeStats.itemsGathered.commonOre.equals(result.homePlanet.storage.commonOre)).toBe(true);
      expect(
        result.lifetimeStats.itemsGathered.uncommonMaterial.equals(result.homePlanet.storage.uncommonMaterial)
      ).toBe(true);

      // creditsEarned mirrors creditsDelta: one completed cycle == creditsPerCycle (10).
      expect(result.lifetimeStats.creditsEarned.equals(MISSIONS.shortOreRun.creditsPerCycle)).toBe(true); // 10

      // captainXpAwarded / fleetAdminXpAwarded == GROSS awarded this call = rate 1 * 149 whole ticks.
      expect(result.lifetimeStats.captainXpAwarded.equals(149)).toBe(true);
      expect(result.lifetimeStats.fleetAdminXpAwarded.equals(149)).toBe(true);

      // YAGNI: missions do NOT populate itemsRefined/itemsCrafted (no refinery/
      // fabricator produces here) -- they stay empty.
      expect(result.lifetimeStats.itemsRefined).toEqual({});
      expect(result.lifetimeStats.itemsCrafted).toEqual({});
    } finally {
      rngSpy.mockRestore();
    }
  });

  it("closed-form parity: one big call's lifetimeStatsDelta equals the sum of many single-tick calls", () => {
    const base = freshCaptains(1)[0];
    base.mission = missionCaptain("shortOreRun");
    // 320 ticks: 2 full cycles (298) + 22 into the 3rd (orders + partial transitOut
    // only -- no 3rd extraction). Under ALWAYS_MIN_ROLL every extraction roll is
    // rare, so 2 completed cycles deliver 2 * 90 = 180 rareMaterial, 0 common/uncommon.
    const bigJump = tickCaptainMission(320, base, ALWAYS_MIN_ROLL);

    let steppedCaptain = base;
    let steppedRare = new Decimal(0);
    let steppedCommon = new Decimal(0);
    let steppedUncommon = new Decimal(0);
    let steppedMissions = new Decimal(0);
    let steppedCredits = new Decimal(0);
    let steppedCapXp = new Decimal(0);
    let steppedFaXp = new Decimal(0);
    for (let i = 0; i < 320; i++) {
      const r = tickCaptainMission(1, steppedCaptain, ALWAYS_MIN_ROLL);
      steppedCaptain = r.captain;
      const d = r.lifetimeStatsDelta;
      // itemsGathered always carries all 3 loot keys (mirrors homePlanetDelta); the
      // ?? on missionsCompleted guards the sparse map (absent on non-completion ticks).
      steppedRare = steppedRare.plus(d.itemsGathered.rareMaterial);
      steppedCommon = steppedCommon.plus(d.itemsGathered.commonOre);
      steppedUncommon = steppedUncommon.plus(d.itemsGathered.uncommonMaterial);
      steppedMissions = steppedMissions.plus(d.missionsCompleted.shortOreRun ?? new Decimal(0));
      steppedCredits = steppedCredits.plus(d.creditsEarned);
      steppedCapXp = steppedCapXp.plus(d.captainXpAwarded);
      steppedFaXp = steppedFaXp.plus(d.fleetAdminXpAwarded);
    }

    // Big call agrees with the stepped sum, per field -- the closed-form guarantee.
    expect(bigJump.lifetimeStatsDelta.itemsGathered.rareMaterial.equals(steppedRare)).toBe(true);
    expect(bigJump.lifetimeStatsDelta.itemsGathered.commonOre.equals(steppedCommon)).toBe(true);
    expect(bigJump.lifetimeStatsDelta.itemsGathered.uncommonMaterial.equals(steppedUncommon)).toBe(true);
    expect(bigJump.lifetimeStatsDelta.missionsCompleted.shortOreRun.equals(steppedMissions)).toBe(true);
    expect(bigJump.lifetimeStatsDelta.creditsEarned.equals(steppedCredits)).toBe(true);
    expect(bigJump.lifetimeStatsDelta.captainXpAwarded.equals(steppedCapXp)).toBe(true);
    expect(bigJump.lifetimeStatsDelta.fleetAdminXpAwarded.equals(steppedFaXp)).toBe(true);

    // And pin the exact expected absolute numbers, not just internal consistency.
    expect(bigJump.lifetimeStatsDelta.itemsGathered.rareMaterial.equals(180)).toBe(true); // 2 cycles * 90
    expect(bigJump.lifetimeStatsDelta.itemsGathered.commonOre.equals(0)).toBe(true);
    expect(bigJump.lifetimeStatsDelta.itemsGathered.uncommonMaterial.equals(0)).toBe(true);
    expect(bigJump.lifetimeStatsDelta.missionsCompleted.shortOreRun.equals(2)).toBe(true);
    expect(bigJump.lifetimeStatsDelta.creditsEarned.equals(20)).toBe(true); // 2 * creditsPerCycle 10
    expect(bigJump.lifetimeStatsDelta.captainXpAwarded.equals(320)).toBe(true); // GROSS: rate 1 * 320 whole ticks
    expect(bigJump.lifetimeStatsDelta.fleetAdminXpAwarded.equals(320)).toBe(true);

    // captainXpAwarded is the GROSS award, NOT the captain's post-level-up xp: 320
    // XP crosses xpForNextLevel(1)=300, so the captain's own xp lands at 20 (level 2)
    // while captainXpAwarded stays the full 320 granted -- proving it's the lifetime
    // "XP awarded" figure, not the leftover current xp.
    expect(bigJump.captain.xp.equals(20)).toBe(true);
    expect(bigJump.captain.level).toBe(2);
  });
});

describe("tick() — Fleet Admiral XP stacks across active captains (Task 5)", () => {
  // Stacking falls out for free: tick() already sums every captain's returned
  // fleetAdminXpDelta fleet-wide before handing the total to applyFleetAdminXp.
  // With FA now per-tick, N captains each on an active mission contribute N FA
  // XP/tick combined, with no stacking-specific code. This test proves that sum.
  it("two captains each on a mission over N ticks accrue 2*N fleet-admin XP", () => {
    const state = freshState();
    state.captains = freshCaptains(2); // both idle by default -- dispatch both below
    state.captains[0].mission = missionCaptain("shortOreRun");
    state.captains[1].mission = missionCaptain("shortOreRun");
    // N = 100 ticks (tickDurationSeconds 1 by fresh default -> ticksElapsed = 100).
    // Each captain advances 100 whole ticks -> 100 FA XP each -> 200 summed.
    // xpForNextFleetAdminLevel(1) = 2500*1*1 = 2500, and 200 < 2500, so NO FA
    // level-up occurs -- state.fleetAdminXp holds the full earned total directly
    // (no threshold subtraction to reason around; N chosen deliberately for this).
    const result = tick(100, state);
    expect(result.fleetAdminXp.equals(200)).toBe(true); // 2 captains * 100 ticks * rate 1
    expect(result.fleetAdminLevel).toBe(1); // 200 < 2500 -> no level-up
    expect(result.adminPoints).toBe(0); // unchanged -- no level-up granted a point
  });
});

describe("tick() — idle captains do nothing, mission captains route through tickCaptainMission", () => {
  it("an idle captain (mission: null) is returned completely unchanged", () => {
    const state = freshState(); // captains[0].mission is null (idle) -- freshCaptainStack's baseline
    const before = state.captains[0];

    const result = tick(10, state);

    // tick()'s map callback for an idle captain is `if (captain.mission === null) return captain;`
    // -- it returns the EXACT SAME object reference for that captain, not a copy, since there's
    // nothing left to compute for an idle captain. So `toBe` (reference equality) is the correct,
    // stronger assertion here -- not just `toEqual` (structural equality) -- and is a direct check
    // that the implementation takes the early-return branch rather than reconstructing the object.
    expect(result.captains[0]).toBe(before);
    // Field-by-field as a second, independent check (belt-and-suspenders -- if a future change
    // swaps the early return for a shallow copy, this still passes while the toBe above would catch it).
    expect(result.captains[0].id).toBe(before.id);
    expect(result.captains[0].label).toBe(before.label);
    expect(result.captains[0].mission).toBe(before.mission);
    expect(result.captains[0].xp).toBe(before.xp);
    expect(result.captains[0].level).toBe(before.level);
    expect(result.captains[0].statPoints).toBe(before.statPoints);
  });

  it("gameTimeSeconds advances exactly once per call, not once per captain", () => {
    const state = freshState();
    state.captains = freshCaptains(3); // 3 idle captains -- proves the advance isn't per-captain
    const result = tick(10, state);
    expect(result.gameTimeSeconds).toBe(10);
  });

  it("zero delta is still a no-op (returns the same state reference)", () => {
    const state = freshState();
    const result = tick(0, state);
    expect(result).toBe(state);
  });

  it("gameTimeSeconds still advances by deltaSeconds exactly once, even with mission captains present", () => {
    const state = freshState();
    state.captains = freshCaptains(2);
    state.captains[0].mission = {
      missionKey: "shortOreRun",
      phase: "ordersReceived",
      phaseProgressTicks: 0,
      cargo: { commonOre: new Decimal(0), uncommonMaterial: new Decimal(0), rareMaterial: new Decimal(0) },
      recalled: false,
    };
    const result = tick(10, state);
    expect(result.gameTimeSeconds).toBe(10);
  });

  it("mission loot aggregates across all captains on missions into state.homePlanet.storage in one tick() call", () => {
    // Hand-traced against tickCaptainMission's CURRENT implementation (tick.ts):
    //
    // Captain 0: phase "extracting", phaseProgressTicks: 0. state.tickDurationSeconds=1 (fresh
    // default, post-rebalance), deltaSeconds=1 -> ticksElapsed = 1. requiredTicks for "extracting"
    // (shortOreRun) = ceil(cargoCapacity 90 / extractionRatePerTick 1) = 90. ticksLeftInPhase =
    // 90 - 0 = 90; ticksToApply = min(1, 90) = 1. Epsilon-snap check: |0 + 1 - 90| = 89, not <
    // 1e-9, so ticksToApply stays 1. fromWhole = floor(0) = 0, toWhole = floor(0+1) = 1 -> 1 loot
    // roll, cargo gains 1 unit (some tier, rng-dependent, but exactly 1 unit total no matter which
    // tier wins under this sequential mutually-exclusive mechanic -- see rollExtractionTick's own
    // comment). phaseProgressTicks becomes 1, remaining becomes 0. 1 < 90, so phase does NOT
    // complete this tick -- captain 0 stays in "extracting", nothing delivered to homePlanetDelta.
    //
    // Captain 1: phase "extracting", phaseProgressTicks: 89, cargo.commonOre: 89 (pre-seeded, as if
    // 89 prior whole-tick rolls all landed commonOre) -- exactly 1 tick away from completing the
    // 90-tick "extracting" phase. Same ticksElapsed = 1. ticksLeftInPhase = 90 - 89 = 1; ticksToApply
    // = min(1, 1) = 1. Epsilon-snap check: |89 + 1 - 90| = 0 < 1e-9 -- true, so ticksToApply
    // recomputed as 90 - 89 = 1 (unchanged, no drift here since these are whole numbers). fromWhole =
    // floor(89) = 89, toWhole = floor(89+1) = 90 -> 1 loot roll, cargo total becomes 90 (89 pre-seeded
    // + 1 more roll). phaseProgressTicks becomes 90, which equals requiredTicks (90) -- extracting
    // phase COMPLETES. MISSION_PHASE_ORDER.indexOf("extracting") = 2, nextIndex = 3 -> "transitBack"
    // (not the last phase, "unloading"), so captain 1 advances to "transitBack" with
    // phaseProgressTicks reset to 0. Still no delivery to homePlanetDelta -- that only happens when
    // "unloading" itself completes, which neither captain reaches this tick.
    //
    // So: state.homePlanet.storage must be UNCHANGED (still all zero) after this single tick() call,
    // even though both captains' onboard cargo grew. This is the "in transit, not yet delivered"
    // distinction the design doc draws between a captain's own mission.cargo and homePlanet.storage.
    const state = freshState();
    state.captains = freshCaptains(2);
    state.captains[0].mission = {
      missionKey: "shortOreRun",
      phase: "extracting",
      phaseProgressTicks: 0,
      cargo: { commonOre: new Decimal(0), uncommonMaterial: new Decimal(0), rareMaterial: new Decimal(0) },
      recalled: false,
    };
    state.captains[1].mission = {
      missionKey: "shortOreRun",
      phase: "extracting",
      phaseProgressTicks: 89,
      cargo: { commonOre: new Decimal(89), uncommonMaterial: new Decimal(0), rareMaterial: new Decimal(0) },
      recalled: false,
    };

    const result = tick(1, state);

    // Captain 0 gained exactly 1 roll's worth (1 unit, tier rng-dependent) of onboard cargo.
    // .plus() chain (not +) since these are Decimal fields -- .equals() (not toBe) on the
    // resulting Decimal, same reasoning as every other Decimal-field assertion in this file.
    const cap0CargoTotal = result.captains[0].mission!.cargo.commonOre
      .plus(result.captains[0].mission!.cargo.uncommonMaterial)
      .plus(result.captains[0].mission!.cargo.rareMaterial);
    expect(cap0CargoTotal.equals(1)).toBe(true);
    expect(result.captains[0].mission!.phase).toBe("extracting");

    // Captain 1 completed extracting (90/90 ticks), advanced to transitBack, final cargo 90 --
    // asserted as a tier-agnostic total since the final roll's tier is rng-dependent (unmocked
    // Math.random here, same reasoning as captain 0's total check above).
    const cap1CargoTotal = result.captains[1].mission!.cargo.commonOre
      .plus(result.captains[1].mission!.cargo.uncommonMaterial)
      .plus(result.captains[1].mission!.cargo.rareMaterial);
    expect(cap1CargoTotal.equals(90)).toBe(true);
    expect(result.captains[1].mission!.phase).toBe("transitBack");
    expect(result.captains[1].mission!.phaseProgressTicks).toBe(0);

    // Neither captain reached "unloading" this tick -- nothing delivered home yet.
    // Full 5-key shape (Task 5 widened homePlanet.storage to include the crafted-good
    // tiers) -- per-key .equals() (not .toEqual against a plain-number-literal object),
    // since homePlanet.storage's values are real Decimal instances.
    expect(result.homePlanet.storage.commonOre.equals(0)).toBe(true);
    expect(result.homePlanet.storage.uncommonMaterial.equals(0)).toBe(true);
    expect(result.homePlanet.storage.rareMaterial.equals(0)).toBe(true);
    expect(result.homePlanet.storage.refinedMaterial.equals(0)).toBe(true);
    expect(result.homePlanet.storage.components.equals(0)).toBe(true);
  });

  it("delivers cargo to state.homePlanet.storage, added to existing totals, when a mission's cycle completes this tick", () => {
    // Hand-traced: phase "unloading" with unloadTicks=8 (shortOreRun), phaseProgressTicks: 0.
    // deltaSeconds=8, state.tickDurationSeconds=1 (fresh default, post-rebalance) -> ticksElapsed=8.
    // requiredTicks("unloading")=8. ticksLeftInPhase = 8 - 0 = 8; ticksToApply = min(8,8) = 8. Not
    // "extracting", so no loot roll in this step. phaseProgressTicks becomes 8, remaining becomes 0.
    // 8 >= requiredTicks(8) -> phase completes. MISSION_PHASE_ORDER.indexOf("unloading") = 4 (last),
    // nextIndex = 5 >= length(5) -- cycle complete: cargo {commonOre:70, uncommonMaterial:20,
    // rareMaterial:10} is added to homePlanetDelta, then (recalled: false) mission auto-repeats to
    // "ordersReceived" with phaseProgressTicks 0 and fresh empty cargo.
    //
    // state.homePlanet.storage starts pre-seeded at {commonOre:5, uncommonMaterial:1, rareMaterial:0}
    // (simulating a PRIOR delivery already sitting in storage) to prove this tick's delta is ADDED
    // to existing totals, not overwriting them: expected result = {75, 21, 10}.
    const state = freshState();
    state.homePlanet.storage = {
      commonOre: new Decimal(5),
      uncommonMaterial: new Decimal(1),
      rareMaterial: new Decimal(0),
      refinedMaterial: new Decimal(0),
      components: new Decimal(0),
    };
    state.captains[0].mission = {
      missionKey: "shortOreRun",
      phase: "unloading",
      phaseProgressTicks: 0,
      cargo: { commonOre: new Decimal(70), uncommonMaterial: new Decimal(20), rareMaterial: new Decimal(10) },
      recalled: false,
    };

    const result = tick(8, state);

    // Per-key .equals(), not .toEqual() against a plain-number-literal object -- homePlanet.storage
    // values are real Decimal instances.
    expect(result.homePlanet.storage.commonOre.equals(75)).toBe(true);
    expect(result.homePlanet.storage.uncommonMaterial.equals(21)).toBe(true);
    expect(result.homePlanet.storage.rareMaterial.equals(10)).toBe(true);
    expect(result.homePlanet.storage.refinedMaterial.equals(0)).toBe(true);
    expect(result.homePlanet.storage.components.equals(0)).toBe(true);
    expect(result.captains[0].mission!.phase).toBe("ordersReceived"); // auto-repeated
    expect(result.captains[0].mission!.phaseProgressTicks).toBe(0);
    expect(result.captains[0].mission!.cargo.commonOre.equals(0)).toBe(true);
    expect(result.captains[0].mission!.cargo.uncommonMaterial.equals(0)).toBe(true);
    expect(result.captains[0].mission!.cargo.rareMaterial.equals(0)).toBe(true);
  });

  it("adds MISSIONS.shortOreRun.creditsPerCycle to state.credits when a mission's cycle completes this tick", () => {
    // Same hand-trace as the "delivers cargo to state.homePlanet.storage..." test immediately above --
    // phase "unloading" with unloadTicks=8 (shortOreRun), phaseProgressTicks: 0. deltaSeconds=8,
    // state.tickDurationSeconds=1 (fresh default) -> ticksElapsed=8 -> exactly completes the
    // unloading phase (8 >= requiredTicks(8)) -- cycle completes, creditsDelta accumulates
    // missionDef.creditsPerCycle (10 for shortOreRun) exactly once.
    //
    // state.credits starts pre-seeded at 5 (freshState()'s own default is Decimal(0); seeded to a
    // non-zero value here) to prove this tick's creditsDelta is ADDED via .plus(), not overwriting
    // existing credits: expected result = 5 + 10 = 15.
    const state = freshState();
    state.credits = new Decimal(5);
    state.captains[0].mission = {
      missionKey: "shortOreRun",
      phase: "unloading",
      phaseProgressTicks: 0,
      cargo: { commonOre: new Decimal(70), uncommonMaterial: new Decimal(20), rareMaterial: new Decimal(10) },
      recalled: false,
    };

    const result = tick(8, state);

    expect(result.credits.equals(15)).toBe(true); // 5 pre-seeded + 10 creditsPerCycle
  });
});

describe("tick() — Homeworld/Captain Talent effects wired into extraction and passive production", () => {
  // IMPORTANT (2026-07-08 Extraction Rework): under the mechanism this replaces, the
  // uncommon/rare tiers were capped at small flat bucket amounts (1-3 units) regardless
  // of the mission's actual per-tick rate, and whatever those tiers rolled was SUBTRACTED
  // from extractionRatePerTick before commonOre absorbed the leftover -- so
  // total = extractionRatePerTick * (1 + commonYieldMult) EXACTLY, independent of
  // uncommonYieldMult/rareYieldMult, and ONLY commonYieldMult (Captain Talent only, no
  // Homeworld Talent produces it) changed the deterministic per-tick total.
  //
  // Under THIS sequential mutually-exclusive mechanism, that's no longer the general
  // case: whichever tier wins the roll receives the FULL extractionRatePerTick base
  // amount, scaled by ITS OWN yieldMult -- so if rare wins, total =
  // extractionRatePerTick * (1 + rareYieldMult), not extractionRatePerTick unmodified.
  // The "total = rate * (1 + winning tier's own yieldMult)" identity now holds for
  // WHICHEVER tier wins, not just common -- so:
  // - The two commonYieldMult tests below force Math.random to a fixed 0.5, which fails
  //   BOTH occurrence checks for shortOreRun (0.5 < 0.001? no. 0.5 < 0.019? no.), so
  //   common is GUARANTEED to win and the total is provably
  //   extractionRatePerTick * (1 + commonYieldMult).
  // - The fleetLogisticsYield/rareYieldMult test below instead forces Math.random to a
  //   fixed value comfortably below shortOreRun's rareChance (0.001), so RARE is
  //   GUARANTEED to win instead, and the total is provably
  //   extractionRatePerTick * (1 + rareYieldMult) -- a more precise test than the old
  //   composition-invariant version, which could no longer prove anything meaningful
  //   once the invariant it relied on stopped holding universally.
  it("prospectorBulkExtraction (Captain Talent, commonYieldMult) boosts a mission captain's extraction via tick()", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const state = freshState();
      state.captains[0].unlockedCaptainTalents = ["prospectorBulkExtraction"]; // +0.1 commonYieldMult
      state.captains[0].mission = { ...missionCaptain(), phase: "extracting", phaseProgressTicks: 0 };

      const result = tick(1, state); // tickDurationSeconds=1 (fresh default) -> ticksElapsed=1 for deltaSeconds=1 -> 1 roll

      // Math.random mocked to 0.5 fails both occurrence checks (rare: 0.5<0.001? no;
      // uncommon: 0.5<0.019? no), so common wins outright and receives commonYieldMult:
      // extractionRatePerTick 1 * (1 + 0.1) = 1.1.
      // .plus() chain (Decimal), not + -- .toNumber() before toBeCloseTo since that
      // matcher needs a plain-number operand, not a Decimal instance.
      const totalDelivered = result.captains[0].mission!.cargo.commonOre
        .plus(result.captains[0].mission!.cargo.uncommonMaterial)
        .plus(result.captains[0].mission!.cargo.rareMaterial);
      expect(totalDelivered.toNumber()).toBeCloseTo(1.1, 6);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it("fleetLogisticsYield (Homeworld Talent, rareYieldMult) is wired through tick() without breaking the per-tick total invariant", () => {
    // Math.random mocked to a fixed value comfortably below shortOreRun's rareChance
    // (0.001) so RARE is GUARANTEED to win on the very first occurrence check, making
    // rareYieldMult's effect on the delivered total fully deterministic instead of
    // rng-dependent. fleetLogisticsYield's actual mult (read from HOMEWORLD_TALENTS in
    // model.ts) is 0.05.
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.0001);
    try {
      const state = freshState();
      state.unlockedHomeworldTalents = ["fleetLogisticsYield"]; // +0.05 rareYieldMult, fleet-wide
      state.captains[0].mission = { ...missionCaptain(), phase: "extracting", phaseProgressTicks: 0 };

      const result = tick(1, state); // 1 roll; 0.0001 < rareChance 0.001 -> rare wins on the first check

      // Rare wins outright and receives its own rareYieldMult: extractionRatePerTick 1 *
      // (1 + 0.05) = 1.05. Mutual exclusivity means commonOre and uncommonMaterial are
      // BOTH exactly 0 here -- this is a MORE precise assertion than a tier-agnostic
      // total, since it also proves fleetLogisticsYield's bonus landed on the correct
      // tier (rareMaterial) and nowhere else.
      expect(result.captains[0].mission!.cargo.rareMaterial.toNumber()).toBeCloseTo(1.05, 6);
      expect(result.captains[0].mission!.cargo.commonOre.equals(0)).toBe(true);
      expect(result.captains[0].mission!.cargo.uncommonMaterial.equals(0)).toBe(true);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it("prospectorBulkExtraction (Captain Talent) and a Homeworld Talent's rareYieldMult both wire through tick() without interfering with each other", () => {
    // Math.random mocked to 0.5 for the same reason as the commonYieldMult-only test
    // above: this forces common to win outright (both occurrence checks fail), so
    // fleetLogisticsYield's rareYieldMult never even gets a chance to apply this roll --
    // proving the two bonus types are wired independently and don't cross-contaminate.
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const state = freshState();
      state.unlockedHomeworldTalents = ["fleetLogisticsYield"]; // +0.05 rareYieldMult (inert this roll -- rare never occurs)
      state.captains[0].unlockedCaptainTalents = ["prospectorBulkExtraction"]; // +0.1 commonYieldMult (does affect the total)
      state.captains[0].mission = { ...missionCaptain(), phase: "extracting", phaseProgressTicks: 0 };

      const result = tick(1, state);

      // Common wins (0.5 fails both occurrence checks) and receives ONLY its own
      // commonYieldMult: extractionRatePerTick 1 * (1 + 0.1) = 1.1, same as the
      // commonYieldMult-only test above -- proving fleetLogisticsYield being
      // simultaneously unlocked doesn't change this number.
      const totalDelivered = result.captains[0].mission!.cargo.commonOre
        .plus(result.captains[0].mission!.cargo.uncommonMaterial)
        .plus(result.captains[0].mission!.cargo.rareMaterial);
      expect(totalDelivered.toNumber()).toBeCloseTo(1.1, 6);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it("passiveTrickle (Homeworld Talent economyTrickle) adds material even with every captain idle", () => {
    const state = freshState();
    state.unlockedHomeworldTalents = ["economyTrickle"]; // commonOre, perTick: 1
    // freshState's single captain is idle (mission: null) by default -- no mission math
    // should run at all, isolating this test to the passive-trickle path.

    const result = tick(1, state); // ticksElapsed = 1/1 = 1 -> 1 * perTick(1) = 1

    expect(result.homePlanet.storage.commonOre.equals(1)).toBe(true);
  });

  it("passiveTrickle scales linearly with ticksElapsed (closed-form, not a per-tick loop)", () => {
    const state = freshState();
    state.unlockedHomeworldTalents = ["economyTrickle"];

    const result = tick(3.5, state); // ticksElapsed = 3.5/1 = 3.5

    expect(result.homePlanet.storage.commonOre.toNumber()).toBeCloseTo(3.5, 6);
  });

  it("with no unlocked Homeworld Talents, extraction and passive production are unaffected (regression guard)", () => {
    const state = freshState();
    state.captains[0].mission = { ...missionCaptain(), phase: "extracting", phaseProgressTicks: 0 };

    const result = tick(1, state);

    const totalDelivered = result.captains[0].mission!.cargo.commonOre
      .plus(result.captains[0].mission!.cargo.uncommonMaterial)
      .plus(result.captains[0].mission!.cargo.rareMaterial);
    // With no unlocked Homeworld Talents, all yield-mults are 0 -- whichever tier wins
    // this roll (rng-dependent, unmocked Math.random) still delivers EXACTLY
    // extractionRatePerTick (1), unscaled. The "total = rate * (1 + winning tier's own
    // yieldMult)" identity holds regardless of which tier wins when every mult is 0.
    expect(totalDelivered.equals(1)).toBe(true); // unmodified extractionRatePerTick, exactly one roll
    expect(result.homePlanet.storage.commonOre.equals(0)).toBe(true); // no passive trickle
  });
});

describe("dispatchCaptainOnMission", () => {
  it("dispatches an idle captain, setting their initial mission state exactly", () => {
    const state = freshState(); // captains[0].mission is null (idle)
    const { next, success } = dispatchCaptainOnMission(state, 1, "shortOreRun");

    expect(success).toBe(true);
    // Per-field checks (not one .toEqual() against a plain-number-literal cargo object) --
    // cargo's values are real Decimal instances.
    expect(next.captains[0].mission!.missionKey).toBe("shortOreRun");
    expect(next.captains[0].mission!.phase).toBe("ordersReceived");
    expect(next.captains[0].mission!.phaseProgressTicks).toBe(0);
    expect(next.captains[0].mission!.cargo.commonOre.equals(0)).toBe(true);
    expect(next.captains[0].mission!.cargo.uncommonMaterial.equals(0)).toBe(true);
    expect(next.captains[0].mission!.cargo.rareMaterial.equals(0)).toBe(true);
    expect(next.captains[0].mission!.recalled).toBe(false);
  });

  it("leaves the rest of the captain and the rest of state untouched", () => {
    // Setup uses xp/level/statPoints (the current CaptainState fields) rather than the
    // removed Generator-Stack fields (modules/resources/augmentPoints) this test used
    // pre-Phase-4 -- same intent (prove dispatchCaptainOnMission only touches `mission`),
    // updated to the post-Task-2 CaptainState/GameState shape.
    const state = freshState();
    state.captains[0].level = 4;
    state.captains[0].xp = new Decimal(250); // xp is Decimal -- new Decimal(...), not a plain-number assignment
    state.captains[0].statPoints = 3;
    state.homePlanet.storage.commonOre = new Decimal(42); // storage is Decimal too

    const { next } = dispatchCaptainOnMission(state, 1, "shortOreRun");
    expect(next.captains[0].level).toBe(4);
    expect(next.captains[0].xp.equals(250)).toBe(true);
    expect(next.captains[0].statPoints).toBe(3);
    expect(next.homePlanet.storage.commonOre.equals(42)).toBe(true);
  });

  it("fails if the captain is already on a mission (same state reference, unchanged)", () => {
    const state = freshState();
    const { next: dispatched } = dispatchCaptainOnMission(state, 1, "shortOreRun");

    const { next, success } = dispatchCaptainOnMission(dispatched, 1, "longOreRun");
    expect(success).toBe(false);
    expect(next).toBe(dispatched); // same reference, not a fresh copy
    expect(next.captains[0].mission!.missionKey).toBe("shortOreRun"); // unchanged, not overwritten
  });

  it("fails if no captain has the given id, rather than throwing (same state reference, unchanged)", () => {
    const state = freshState();
    const { next, success } = dispatchCaptainOnMission(state, 999, "shortOreRun");
    expect(success).toBe(false);
    expect(next).toBe(state);
  });
});

describe("recallCaptain", () => {
  it("sets recalled: true on the EXISTING mission object without resetting phase/progress/cargo", () => {
    const state = freshState();
    state.captains[0].mission = {
      missionKey: "shortOreRun",
      phase: "extracting",
      phaseProgressTicks: 4.5,
      cargo: { commonOre: new Decimal(40), uncommonMaterial: new Decimal(5), rareMaterial: new Decimal(0) },
      recalled: false,
    };

    const { next, success } = recallCaptain(state, 1);
    expect(success).toBe(true);
    // Per-field checks (not one .toEqual()) -- cargo's values are real Decimal instances.
    expect(next.captains[0].mission!.missionKey).toBe("shortOreRun");
    expect(next.captains[0].mission!.phase).toBe("extracting");
    expect(next.captains[0].mission!.phaseProgressTicks).toBe(4.5);
    expect(next.captains[0].mission!.cargo.commonOre.equals(40)).toBe(true);
    expect(next.captains[0].mission!.cargo.uncommonMaterial.equals(5)).toBe(true);
    expect(next.captains[0].mission!.cargo.rareMaterial.equals(0)).toBe(true);
    expect(next.captains[0].mission!.recalled).toBe(true); // only this field flips
  });

  it("fails if the captain has no active mission (same state reference, unchanged)", () => {
    const state = freshState(); // mission: null
    const { next, success } = recallCaptain(state, 1);
    expect(success).toBe(false);
    expect(next).toBe(state);
  });

  it("fails if no captain has the given id, rather than throwing", () => {
    const state = freshState();
    const { next, success } = recallCaptain(state, 999);
    expect(success).toBe(false);
    expect(next).toBe(state);
  });
});

describe("craftRecipe", () => {
  it("succeeds when inputs are sufficient: deducts inputs, adds output", () => {
    const state = freshState();
    state.homePlanet.storage.commonOre = new Decimal(25);
    const { next, success } = craftRecipe(state, "refineUnobtainium");
    expect(success).toBe(true);
    expect(next.homePlanet.storage.commonOre.equals(15)).toBe(true);
    expect(next.homePlanet.storage.refinedMaterial.equals(1)).toBe(true);
  });

  it("fails (same state reference) when inputs are insufficient", () => {
    const state = freshState(); // commonOre: 0
    const { next, success } = craftRecipe(state, "refineUnobtainium");
    expect(success).toBe(false);
    expect(next).toBe(state);
  });

  it("supports multi-input recipes, deducting every input listed", () => {
    const state = freshState();
    state.homePlanet.storage.refinedMaterial = new Decimal(12);
    const { next, success } = craftRecipe(state, "fabricateComponents");
    expect(success).toBe(true);
    expect(next.homePlanet.storage.refinedMaterial.equals(7)).toBe(true);
    expect(next.homePlanet.storage.components.equals(1)).toBe(true);
  });

  it("recipeBonusOutput (Homeworld Talent) adds a FLAT bonus to the matching recipe's output, not a multiplier", () => {
    const state = freshState();
    state.unlockedHomeworldTalents = ["industryBonusOutput"]; // recipeKey: fabricateComponents, bonus: 1
    state.homePlanet.storage.refinedMaterial = new Decimal(5);
    const { next, success } = craftRecipe(state, "fabricateComponents");
    expect(success).toBe(true);
    expect(next.homePlanet.storage.components.equals(2)).toBe(true); // base output 1 + flat bonus 1
  });

  it("recipeBonusOutput does NOT apply to a different recipe than the one it names", () => {
    const state = freshState();
    state.unlockedHomeworldTalents = ["industryBonusOutput"]; // targets fabricateComponents only
    state.homePlanet.storage.commonOre = new Decimal(10);
    const { next, success } = craftRecipe(state, "refineUnobtainium");
    expect(success).toBe(true);
    expect(next.homePlanet.storage.refinedMaterial.equals(1)).toBe(true); // unmodified base output
  });
});

// Radial Skill Web (Task 5): buy-gating moved from the old single-parent
// `requires` chain to graph adjacency. A node is learnable iff it is a hub OR
// at least one of its neighbors is already owned -- the exact rule
// computeVisibleTalents (talentWeb.ts) uses for fog-of-war, so what the UI
// shows as learnable is exactly what buy allows. Keys/costs below are the LIVE
// radial CAPTAIN_TALENTS/HOMEWORLD_TALENTS tables (model.ts), not the old
// command/resourcefulnessRareChance keys these tests used pre-rewrite:
//   prospectorHub          isHub, cost 1, neighbors incl. prospectorBulkExtraction
//   prospectorBulkExtraction  cost 2, neighbors incl. prospectorHub (NOT a hub)
//   fleetLogisticsHub      isHub, cost 1, neighbors incl. fleetLogisticsSlot1
//   fleetLogisticsSlot1    cost 3, unlockCaptainSlot, neighbors incl. fleetLogisticsHub
describe("buyCaptainTalent", () => {
  it("gates on adjacency, not requires: hub buyable from empty; non-adjacent fails; adjacent-to-owned then succeeds", () => {
    let state = freshState();
    state.captains[0].statPoints = 10; // ample -- isolate the adjacency gate from the cost gate

    // prospectorBulkExtraction is NOT a hub and no neighbor is owned yet -> fail.
    const nonAdjacent = buyCaptainTalent(state, 1, "prospectorBulkExtraction");
    expect(nonAdjacent.success).toBe(false);
    expect(nonAdjacent.next).toBe(state); // same state reference on failure

    // prospectorHub is a hub -> always buyable from an empty unlocked set.
    const hub = buyCaptainTalent(state, 1, "prospectorHub");
    expect(hub.success).toBe(true);
    expect(hub.next.captains[0].unlockedCaptainTalents).toEqual(["prospectorHub"]);
    state = hub.next;

    // Now prospectorHub (a neighbor of prospectorBulkExtraction) is owned -> buyable.
    const adjacent = buyCaptainTalent(state, 1, "prospectorBulkExtraction");
    expect(adjacent.success).toBe(true);
    expect(adjacent.next.captains[0].unlockedCaptainTalents).toEqual([
      "prospectorHub",
      "prospectorBulkExtraction",
    ]);
  });

  it("succeeds on a hub when affordable, deducts statPoints, records the unlock", () => {
    const state = freshState();
    state.captains[0].statPoints = 1; // prospectorHub costs exactly 1
    const { next, success } = buyCaptainTalent(state, 1, "prospectorHub");
    expect(success).toBe(true);
    expect(next.captains[0].statPoints).toBe(0);
    expect(next.captains[0].unlockedCaptainTalents).toEqual(["prospectorHub"]);
  });

  it("fails (same state reference) if already unlocked", () => {
    const state = freshState();
    state.captains[0].statPoints = 10;
    const { next: dispatched } = buyCaptainTalent(state, 1, "prospectorHub");
    const { next, success } = buyCaptainTalent(dispatched, 1, "prospectorHub");
    expect(success).toBe(false);
    expect(next).toBe(dispatched);
  });

  it("fails if statPoints are insufficient (even for a learnable node)", () => {
    const state = freshState();
    state.captains[0].statPoints = 0; // prospectorHub costs 1; adjacency gate passes (hub), cost gate fails
    const { next, success } = buyCaptainTalent(state, 1, "prospectorHub");
    expect(success).toBe(false);
    expect(next).toBe(state);
  });
});

describe("buyHomeworldTalent", () => {
  it("gates on adjacency, not requires: hub buyable from empty; non-adjacent fails; adjacent-to-owned then succeeds", () => {
    let state = freshState();
    state.adminPoints = 10; // ample -- isolate the adjacency gate from the cost gate

    // fleetLogisticsSlot1 is NOT a hub and no neighbor is owned yet -> fail.
    const nonAdjacent = buyHomeworldTalent(state, "fleetLogisticsSlot1");
    expect(nonAdjacent.success).toBe(false);
    expect(nonAdjacent.next).toBe(state); // same state reference on failure

    // fleetLogisticsHub is a hub -> always buyable from an empty unlocked set.
    const hub = buyHomeworldTalent(state, "fleetLogisticsHub");
    expect(hub.success).toBe(true);
    expect(hub.next.unlockedHomeworldTalents).toEqual(["fleetLogisticsHub"]);
    state = hub.next;

    // Now fleetLogisticsHub (a neighbor of fleetLogisticsSlot1) is owned -> buyable.
    const adjacent = buyHomeworldTalent(state, "fleetLogisticsSlot1");
    expect(adjacent.success).toBe(true);
    expect(adjacent.next.unlockedHomeworldTalents).toEqual([
      "fleetLogisticsHub",
      "fleetLogisticsSlot1",
    ]);
  });

  it("succeeds for a non-slot node when adjacent+affordable: deducts adminPoints, records the unlock", () => {
    const state = freshState();
    state.adminPoints = 10;
    // fleetLogisticsYield is a neighbor of fleetLogisticsHub; own the hub first.
    const withHub = buyHomeworldTalent(state, "fleetLogisticsHub").next; // hub cost 1
    const { next, success } = buyHomeworldTalent(withHub, "fleetLogisticsYield"); // cost 4
    expect(success).toBe(true);
    expect(next.adminPoints).toBe(10 - 1 - 4);
    expect(next.unlockedHomeworldTalents).toEqual(["fleetLogisticsHub", "fleetLogisticsYield"]);
  });

  it("succeeds for an unlockCaptainSlot node: also appends a new captain (side-effect intact)", () => {
    const state = freshState();
    state.adminPoints = 10;
    const withHub = buyHomeworldTalent(state, "fleetLogisticsHub").next; // hub cost 1, makes slot1 learnable
    const { next, success } = buyHomeworldTalent(withHub, "fleetLogisticsSlot1"); // cost 3, unlockCaptainSlot
    expect(success).toBe(true);
    expect(next.captains).toHaveLength(2);
    expect(next.captains[1].id).toBe(2);
  });

  it("unlockCaptainSlot also grants + assigns a Freighter to the new captain (always-has-a-ship invariant), bumps nextShipId, and the captain carries no shipType", () => {
    const state = freshState();
    state.adminPoints = 10;
    const originalNextShipId = state.nextShipId; // freshState() -> 2 ("ship-1" already taken)
    const withHub = buyHomeworldTalent(state, "fleetLogisticsHub").next; // hub cost 1, makes slot1 learnable
    const { next, success } = buyHomeworldTalent(withHub, "fleetLogisticsSlot1"); // cost 3, unlockCaptainSlot -> captain id 2
    expect(success).toBe(true);

    // A ship was appended, assigned to the newly-unlocked captain (id 2), typed
    // generalFreighter, with the id minted from the PRE-bump nextShipId.
    const newShip = next.ships.find((s) => s.assignedCaptainId === 2);
    expect(newShip).toBeDefined();
    expect(newShip!.typeKey).toBe("generalFreighter");
    expect(newShip!.id).toBe(`ship-${originalNextShipId}`);

    // nextShipId advanced by exactly 1 (2 -> 3), monotonic id source consumed.
    expect(next.nextShipId).toBe(originalNextShipId + 1);

    // The new captain no longer owns a hull -- shipType was removed entirely
    // (captain/ship separation). Not "resourcer", not any value: absent.
    expect("shipType" in next.captains[1]).toBe(false);

    // Invariant: every captain has exactly one assigned ship in next.ships.
    for (const captain of next.captains) {
      const assigned = next.ships.filter((s) => s.assignedCaptainId === captain.id);
      expect(assigned).toHaveLength(1);
    }
  });

  it("fails if adminPoints are insufficient (even for a learnable node)", () => {
    const state = freshState();
    state.adminPoints = 0; // fleetLogisticsHub costs 1; adjacency gate passes (hub), cost gate fails
    const { next, success } = buyHomeworldTalent(state, "fleetLogisticsHub");
    expect(success).toBe(false);
    expect(next).toBe(state);
  });

  it("fails (same state reference) if already unlocked", () => {
    const state = freshState();
    state.adminPoints = 10;
    const { next: dispatched } = buyHomeworldTalent(state, "fleetLogisticsHub");
    const { next, success } = buyHomeworldTalent(dispatched, "fleetLogisticsHub");
    expect(success).toBe(false);
    expect(next).toBe(dispatched);
  });
});

describe("respecCaptainTalents / respecHomeworldTalents", () => {
  // Task 8 (Talent Tree Visual Redesign) -- coverage for Task 7's
  // respecCaptainTalents/respecHomeworldTalents, added to tick.ts in commits
  // fc4f317/da9b7f1. Every cost below is hand-verified against the LIVE
  // CAPTAIN_TALENTS/HOMEWORLD_TALENTS tables in model.ts (not transcribed
  // blindly): prospectorBulkExtraction.cost=2, prospectorRefinedExtraction.cost=4,
  // fleetLogisticsSlot1.cost=3 (effect.type: "unlockCaptainSlot" --
  // never refunded/removed), fleetLogisticsYield.cost=4 (effect.type:
  // "rareYieldMult" -- a normal refundable node). RESPEC_COST_CREDITS is 50
  // (tick.ts, same constant both respec functions share).

  it("respecCaptainTalents refunds the exact statPoints cost sum of every unlocked talent, clears the list, and deducts flat 50 credits", () => {
    const state = freshState();
    state.credits = new Decimal(50); // exactly the flat RESPEC_COST_CREDITS
    state.captains[0].unlockedCaptainTalents = ["prospectorBulkExtraction", "prospectorRefinedExtraction"];
    state.captains[0].statPoints = 0;
    // Refund = prospectorBulkExtraction.cost 2 + prospectorRefinedExtraction.cost 4 = 6.
    const { next, success } = respecCaptainTalents(state, 1);
    expect(success).toBe(true);
    expect(next.captains[0].statPoints).toBe(6);
    expect(next.captains[0].unlockedCaptainTalents).toEqual([]);
    expect(next.credits.equals(0)).toBe(true); // 50 - 50
  });

  it("respecCaptainTalents fails (same state reference) when credits are one short of RESPEC_COST_CREDITS", () => {
    const state = freshState();
    state.credits = new Decimal(49); // one below the flat 50 cost
    state.captains[0].unlockedCaptainTalents = ["prospectorBulkExtraction"];
    const { next, success } = respecCaptainTalents(state, 1);
    expect(success).toBe(false);
    expect(next).toBe(state); // reference identity, not just structural equality
  });

  it("respecCaptainTalents fails (same state reference) for a captainId that doesn't exist", () => {
    const state = freshState();
    state.credits = new Decimal(50);
    const { next, success } = respecCaptainTalents(state, 999);
    expect(success).toBe(false);
    expect(next).toBe(state);
  });

  it("respecHomeworldTalents refunds only non-unlockCaptainSlot nodes, leaving slot nodes unlocked and un-refunded", () => {
    const state = freshState();
    state.credits = new Decimal(50);
    state.adminPoints = 0;
    // fleetLogisticsSlot1: effect.type "unlockCaptainSlot" -- must survive, must NOT be refunded.
    // fleetLogisticsYield: effect.type "rareYieldMult" -- a normal node, must be refunded (cost 4) and removed.
    state.unlockedHomeworldTalents = ["fleetLogisticsSlot1", "fleetLogisticsYield"];
    const { next, success } = respecHomeworldTalents(state);
    expect(success).toBe(true);
    expect(next.adminPoints).toBe(4); // fleetLogisticsYield's cost only -- the slot node contributes 0
    expect(next.unlockedHomeworldTalents).toEqual(["fleetLogisticsSlot1"]); // slot key survives, non-slot key removed
    expect(next.credits.equals(0)).toBe(true); // 50 - 50
  });

  it("respecHomeworldTalents fails (same state reference) when credits are one short of RESPEC_COST_CREDITS", () => {
    const state = freshState();
    state.credits = new Decimal(49); // one below the flat 50 cost
    state.unlockedHomeworldTalents = ["fleetLogisticsYield"];
    const { next, success } = respecHomeworldTalents(state);
    expect(success).toBe(false);
    expect(next).toBe(state);
  });

  it("respecCaptainTalents with an explicit newSpec argument sets the new spec atomically with the talent wipe", () => {
    const state = freshState();
    state.credits = new Decimal(50);
    state.captains[0].spec = "tactical";
    state.captains[0].unlockedCaptainTalents = ["prospectorBulkExtraction", "prospectorRefinedExtraction"]; // refund = 2+4 = 6
    state.captains[0].statPoints = 0;
    const { next, success } = respecCaptainTalents(state, 1, "resourcefulness");
    expect(success).toBe(true);
    expect(next.captains[0].spec).toBe("resourcefulness");
    expect(next.captains[0].unlockedCaptainTalents).toEqual([]);
    expect(next.captains[0].statPoints).toBe(6);
  });

  it("respecCaptainTalents with the 3rd arg omitted entirely leaves the captain's current spec UNCHANGED", () => {
    const state = freshState();
    state.credits = new Decimal(50);
    state.captains[0].spec = "resourcefulness";
    state.captains[0].unlockedCaptainTalents = ["prospectorBulkExtraction", "prospectorRefinedExtraction"]; // refund = 2+4 = 6
    state.captains[0].statPoints = 0;
    // Only 2 args -- newSpec is genuinely omitted (not passed as `undefined` explicitly), exercising the
    // `newSpec === undefined ? captain.spec : newSpec` branch's "omitted" path, not just its "undefined" path.
    const { next, success } = respecCaptainTalents(state, 1);
    expect(success).toBe(true);
    expect(next.captains[0].spec).toBe("resourcefulness"); // unchanged from before the respec
    expect(next.captains[0].unlockedCaptainTalents).toEqual([]);
    expect(next.captains[0].statPoints).toBe(6);
  });

  it("respecCaptainTalents with an explicit null newSpec CLEARS the captain's current spec (distinct from omitting the arg)", () => {
    const state = freshState();
    state.credits = new Decimal(50);
    state.captains[0].spec = "resourcefulness";
    state.captains[0].unlockedCaptainTalents = ["prospectorBulkExtraction", "prospectorRefinedExtraction"]; // refund = 2+4 = 6
    state.captains[0].statPoints = 0;
    // Explicit `null` must be preserved, not collapsed into "keep current spec" -- this is exactly why
    // respecCaptainTalents's implementation uses a strict `=== undefined` check rather than `newSpec ?? captain.spec`
    // (the `??` form would also replace an explicit null with captain.spec, indistinguishable from omitting the arg).
    const { next, success } = respecCaptainTalents(state, 1, null);
    expect(success).toBe(true);
    expect(next.captains[0].spec).toBe(null); // cleared, not left at "resourcefulness"
    expect(next.captains[0].unlockedCaptainTalents).toEqual([]);
    expect(next.captains[0].statPoints).toBe(6);
  });
});

describe("chooseCaptainSpec", () => {
  // Task 14 (Radial Skill Web) -- coverage for the FREE first-pick spec setter
  // added to tick.ts. The rule under test: it succeeds ONLY from spec === null
  // (free, no cost/point change); a captain that already has a spec must go
  // through respecCaptainTalents(..., null) instead, so chooseCaptainSpec
  // itself refuses. freshState()'s single captain starts at spec: null,
  // statPoints: 0 (freshCaptainStack baseline), credits: Decimal(0).

  it("sets the spec (and succeeds) when the captain's spec is currently null, for FREE (no credit or statPoint change)", () => {
    const state = freshState();
    state.credits = new Decimal(50); // deliberately affordable-for-a-respec, to prove NONE of it is spent here
    state.captains[0].statPoints = 7; // arbitrary non-baseline value, to prove it's untouched
    expect(state.captains[0].spec).toBe(null); // precondition: the free-pick path
    const { next, success } = chooseCaptainSpec(state, 1, "resourcefulness");
    expect(success).toBe(true);
    expect(next.captains[0].spec).toBe("resourcefulness");
    expect(next.captains[0].statPoints).toBe(7); // unchanged -- free pick, no point cost
    expect(next.credits.equals(50)).toBe(true); // unchanged -- free pick, no credit cost
  });

  it("fails (same state reference) when the captain already has a spec set -- changing an established spec must go through respec, not this", () => {
    const state = freshState();
    state.captains[0].spec = "tactical"; // already chosen -- the free pick is no longer available
    const { next, success } = chooseCaptainSpec(state, 1, "resourcefulness");
    expect(success).toBe(false);
    expect(next).toBe(state); // reference identity, not just structural equality
    expect(state.captains[0].spec).toBe("tactical"); // untouched -- the change was refused, not applied
  });

  it("fails (same state reference) for a captainId that doesn't exist", () => {
    const state = freshState();
    const { next, success } = chooseCaptainSpec(state, 999, "resourcefulness");
    expect(success).toBe(false);
    expect(next).toBe(state);
  });
});

describe("applyFleetAdminXp", () => {
  it("is a no-op (same state reference) when the delta is zero or negative", () => {
    const state = freshState();
    const result = applyFleetAdminXp(state, 0);
    expect(result).toBe(state);
    const resultNegative = applyFleetAdminXp(state, -5);
    expect(resultNegative).toBe(state);
  });

  it("adds the delta to fleetAdminXp when no level-up threshold is crossed", () => {
    // xpForNextFleetAdminLevel(1) = 2500 * 1 * 1 = 2500. A delta of 100 stays
    // well under that -- no level-up, xp just accumulates.
    const state = freshState();
    const result = applyFleetAdminXp(state, 100);
    expect(result.fleetAdminXp.equals(100)).toBe(true);
    expect(result.fleetAdminLevel).toBe(1);
    expect(result.adminPoints).toBe(0);
  });

  it("resolves exactly one level-up and carries the remainder forward, mirroring captain XP's subtract-and-carry shape", () => {
    // xpForNextFleetAdminLevel(1) = 2500. Starting fleetAdminXp at 2000, delta
    // 600 -> xp = 2600. 2600 >= 2500 -> level 2, xp -= 2500 -> xp = 100.
    // xpForNextFleetAdminLevel(2) = 2500*4 = 10000. 100 >= 10000? No -- loop stops.
    const state = freshState();
    state.fleetAdminXp = new Decimal(2000); // fleetAdminXp is Decimal -- new Decimal(...), not a plain-number assignment
    const result = applyFleetAdminXp(state, 600);
    expect(result.fleetAdminLevel).toBe(2);
    expect(result.fleetAdminXp.equals(100)).toBe(true);
    expect(result.adminPoints).toBe(1);
  });

  it("a large single delta resolves every level-up crossed, not just one", () => {
    // Hand-traced: fleetAdminXp starts 0, delta 13000.
    // xpForNextFleetAdminLevel(1)=2500: 13000>=2500 -> level 2, xp=10500.
    // xpForNextFleetAdminLevel(2)=10000: 10500>=10000 -> level 3, xp=500.
    // xpForNextFleetAdminLevel(3)=22500: 500>=22500? No -- loop stops.
    // Final: level 3, xp 500, adminPoints 2.
    const state = freshState();
    const result = applyFleetAdminXp(state, 13000);
    expect(result.fleetAdminLevel).toBe(3);
    expect(result.fleetAdminXp.equals(500)).toBe(true);
    expect(result.adminPoints).toBe(2);
  });

  it("caps at MAX_LEVEL_UPS_PER_TICK level-ups per call, leaving the remainder unresolved rather than looping unboundedly", () => {
    // Can't hand-trace 10,000 individual level-up steps one by one -- instead,
    // construct a delta PROVABLY large enough to require MORE than
    // MAX_LEVEL_UPS_PER_TICK (10,000) level-ups to fully resolve if uncapped,
    // using the closed-form sum of xpForNextFleetAdminLevel's quadratic
    // thresholds: sum_{k=1}^{n} 2500*k^2 = 2500 * n*(n+1)*(2n+1)/6 is the
    // EXACT total XP needed to go from level 1 through exactly n level-ups
    // (level 1 -> level n+1). A naive "10,001 * 2500" delta (linear
    // reasoning applied to a QUADRATIC curve) is nowhere near enough --
    // verified by direct calculation before writing this test: the true sum
    // for 10,000 level-ups is 833,458,337,500,000, not merely 25,002,500.
    // Adding ONE MORE full threshold's worth on top of the exact
    // 10,000-level-up sum guarantees the delta requires at least one level-up
    // beyond what the cap allows, if the cap weren't there.
    const sumOfSquaresTo = (n: number) => (n * (n + 1) * (2 * n + 1)) / 6;
    const xpForExactly10000LevelUps = 2500 * sumOfSquaresTo(10_000); // 833,458,337,500,000
    const oneMoreThreshold = 2500 * 10_001 * 10_001; // xpForNextFleetAdminLevel(10001)
    const delta = xpForExactly10000LevelUps + oneMoreThreshold;

    const result = applyFleetAdminXp(freshState(), delta);

    // Uncapped, this delta would resolve AT LEAST 10,001 level-ups (level 1 ->
    // 10,002 or beyond). WITH the cap, at most MAX_LEVEL_UPS_PER_TICK (10,000)
    // level-ups can happen in this one call -- fleetAdminLevel started at 1,
    // so it can reach AT MOST level 10,001, never higher, no matter how much
    // XP the delta represents.
    expect(result.fleetAdminLevel).toBeLessThanOrEqual(10_001);
    expect(result.adminPoints).toBeLessThanOrEqual(10_000);
    // The cap stopping the loop mid-resolution (not the loop naturally
    // running out of xp to consume) means a meaningful amount of xp must
    // remain unconsumed -- this delta was deliberately built to have MORE
    // than the exact resolving sum, so some remainder greater than 0 must
    // be left over. .toNumber() first -- toBeGreaterThan needs a plain-number
    // operand, Decimal has no meaning to that matcher directly.
    expect(result.fleetAdminXp.toNumber()).toBeGreaterThan(0);
  });

  it("a backlog left over from a capped call keeps draining on a LATER call even with a zero delta, not just a call that also brings fresh XP", () => {
    // Found during this branch's final holistic review: an early-return keyed
    // ONLY on `fleetAdminXpDelta <= 0` would freeze a capped backlog forever
    // on every subsequent delta-0 poll (the overwhelmingly common case in
    // live play) -- contradicting this function's own stated intent that
    // leftover XP "keeps resolving on the NEXT tick() call." Reusing the same
    // exact backlog-construction math as the cap test above (833,708,387,502,500
    // total XP, guaranteed to require 10,001+ level-ups if uncapped) to first
    // produce a genuinely capped, backlogged state, then confirm a SECOND
    // call with delta=0 keeps draining it rather than returning the identical
    // stuck state.
    const sumOfSquaresTo = (n: number) => (n * (n + 1) * (2 * n + 1)) / 6;
    const xpForExactly10000LevelUps = 2500 * sumOfSquaresTo(10_000);
    const oneMoreThreshold = 2500 * 10_001 * 10_001;
    const delta = xpForExactly10000LevelUps + oneMoreThreshold;

    const afterFirstCappedCall = applyFleetAdminXp(freshState(), delta);
    expect(afterFirstCappedCall.adminPoints).toBe(10_000); // confirms the cap was genuinely hit, not coincidentally under it
    const backloggedXp = afterFirstCappedCall.fleetAdminXp;

    const afterSecondCall = applyFleetAdminXp(afterFirstCappedCall, 0);
    // A stale/broken guard (checking only fleetAdminXpDelta <= 0) would return
    // the SAME reference here, leaving fleetAdminLevel/adminPoints/fleetAdminXp
    // completely unchanged forever. The fixed guard checks for a remaining
    // backlog too, so this second call -- despite delta being 0 -- must make
    // real progress: MORE level-ups resolved, adminPoints increased further,
    // and the leftover xp reduced from what it was after the first call.
    expect(afterSecondCall).not.toBe(afterFirstCappedCall);
    expect(afterSecondCall.adminPoints).toBeGreaterThan(10_000);
    expect(afterSecondCall.fleetAdminLevel).toBeGreaterThan(afterFirstCappedCall.fleetAdminLevel);
    // .toNumber() on both sides -- toBeLessThan needs plain-number operands, and
    // backloggedXp is a captured Decimal reference from afterFirstCappedCall above.
    expect(afterSecondCall.fleetAdminXp.toNumber()).toBeLessThan(backloggedXp.toNumber());
  });
});

// ---------------------------------------------------------------------------
// Ships — Stats Foundation, Task 6: the assigned ship's three derived stats
// (cargoCapacity, transitSpeedMult, extractionYieldMult) threaded into
// tickCaptainMission via its optional 5th param `shipStats`. Two invariants
// under test:
//   1. Passing shipStats = null (or omitting the 5th arg entirely) reproduces
//      today's exact behavior -- the ship path is strictly additive, never a
//      silent change to no-ship callers.
//   2. The CLOSED-FORM guarantee (one big ticksElapsed == many small ones
//      summing to the same total) survives the ship modifier. This holds for
//      the SAME structural reason the existing `bonuses` constant does: the
//      ship's effect is baked into `missionDef` (via effectiveMissionDef) and
//      into `resolvedBonuses` ONCE, before the while loop, so it's constant
//      across the whole call regardless of how the call was chunked.
// A helper mirrors shipDerivedStats' real input shape (a ShipInstance) so these
// tests exercise the production projection, not a hand-built stub.
// ---------------------------------------------------------------------------
describe("tickCaptainMission — assigned ship stats (Task 6)", () => {
  // Builds a ShipDerivedStats the same way production will: from a real
  // ShipInstance run through shipDerivedStats. assignedCaptainId is irrelevant
  // to tickCaptainMission (it never reads assignment -- Task 3 removed that);
  // null is fine and matches a parked-but-projected hull.
  const shipStatsFor = (typeKey: "prospectorHauler" | "prospectorRunner" | "prospectorMiner") =>
    shipDerivedStats({ id: "h", typeKey, assignedCaptainId: null });

  it("passing shipStats = null behaves EXACTLY as omitting the 5th arg (backward-compat)", () => {
    // Two captains seeded identically, mid-mission on shortOreRun, so the call
    // actually exercises phase progression + an extraction stretch (not just a
    // no-op). ALWAYS_MIN_ROLL keeps rng constant so both paths roll identically.
    const baseA = freshCaptains(1)[0];
    baseA.mission = { ...missionCaptain("shortOreRun"), phase: "extracting", phaseProgressTicks: 0 };
    const baseB = freshCaptains(1)[0];
    baseB.mission = { ...missionCaptain("shortOreRun"), phase: "extracting", phaseProgressTicks: 0 };

    // Path 1: no 5th arg at all (the pre-Task-6 call shape every existing site uses).
    const noArg = tickCaptainMission(50, baseA, ALWAYS_MIN_ROLL, {});
    // Path 2: explicit null 5th arg (the new default, spelled out).
    const nullArg = tickCaptainMission(50, baseB, ALWAYS_MIN_ROLL, {}, null);

    // toEqual across the whole returned mission is safe here: with ALWAYS_MIN_ROLL
    // (rare wins every roll), commonOre/uncommonMaterial are exactly Decimal(0) on
    // both paths, and the only non-zero cargo (rareMaterial) is built by the SAME
    // sequence of .plus() ops on both -- structurally identical Decimals, not just
    // numerically equal, so toEqual holds. If this ever gets brittle, drop to the
    // per-key .equals() shape used elsewhere in this file.
    expect(nullArg.captain.mission).toEqual(noArg.captain.mission);
    expect(nullArg.captain.xp.equals(noArg.captain.xp)).toBe(true);
    expect(nullArg.captain.level).toBe(noArg.captain.level);
    expect(nullArg.captain.statPoints).toBe(noArg.captain.statPoints);
    expect(nullArg.fleetAdminXpDelta).toBe(noArg.fleetAdminXpDelta);
    expect(nullArg.creditsDelta).toBe(noArg.creditsDelta);
    expect(nullArg.homePlanetDelta.commonOre.equals(noArg.homePlanetDelta.commonOre)).toBe(true);
    expect(nullArg.homePlanetDelta.uncommonMaterial.equals(noArg.homePlanetDelta.uncommonMaterial)).toBe(true);
    expect(nullArg.homePlanetDelta.rareMaterial.equals(noArg.homePlanetDelta.rareMaterial)).toBe(true);
  });

  // The CRITICAL test. Mirrors the primary "one big jump equals many small
  // ticks" closed-form test, but passes a real ship's stats on BOTH the big
  // call and every small step. Run for two hulls with DIFFERENT transit/cargo
  // so the assertion exercises the ship-modified phase geometry, not just the
  // base one:
  //   - HAULER: cargo 180 (extract phase 180 ticks, not 90), transit 0.8
  //     (transitOut/Back ceil(25/0.8)=32 ticks, not 25) -> full cycle
  //     1+32+180+32+8 = 253 ticks.
  //   - RUNNER: cargo 60 (extract 60), transit 1.5 (ceil(25/1.5)=17) -> full
  //     cycle 1+17+60+17+8 = 103 ticks.
  // Because effectiveMissionDef is computed ONCE per call (constant across the
  // whole while loop), the big call and the small-step chain see the SAME
  // requiredTicksForPhase values for every phase -- exactly the property that
  // makes the base closed-form test pass, now with ship-scaled thresholds.
  const closedFormForShip = (
    typeKey: "prospectorHauler" | "prospectorRunner",
    bigTicks: number,
    steps: number
  ) => {
    const ship = shipStatsFor(typeKey);
    const base = freshCaptains(1)[0];
    base.mission = missionCaptain("shortOreRun");

    const bigJump = tickCaptainMission(bigTicks, base, ALWAYS_MIN_ROLL, {}, ship);

    let steppedCaptain = base;
    let steppedDelta = { commonOre: new Decimal(0), uncommonMaterial: new Decimal(0), rareMaterial: new Decimal(0) };
    const stepSize = bigTicks / steps;
    for (let i = 0; i < steps; i++) {
      const result = tickCaptainMission(stepSize, steppedCaptain, ALWAYS_MIN_ROLL, {}, ship);
      steppedCaptain = result.captain;
      steppedDelta = {
        commonOre: steppedDelta.commonOre.plus(result.homePlanetDelta.commonOre),
        uncommonMaterial: steppedDelta.uncommonMaterial.plus(result.homePlanetDelta.uncommonMaterial),
        rareMaterial: steppedDelta.rareMaterial.plus(result.homePlanetDelta.rareMaterial),
      };
    }

    // Same per-key .equals()/toBeCloseTo shape as the base closed-form test.
    expect(bigJump.captain.mission!.phase).toBe(steppedCaptain.mission!.phase);
    expect(bigJump.captain.mission!.phaseProgressTicks).toBeCloseTo(steppedCaptain.mission!.phaseProgressTicks, 6);
    expect(bigJump.captain.mission!.recalled).toBe(steppedCaptain.mission!.recalled);
    expect(bigJump.captain.mission!.missionKey).toBe(steppedCaptain.mission!.missionKey);
    expect(bigJump.captain.mission!.cargo.commonOre.equals(steppedCaptain.mission!.cargo.commonOre)).toBe(true);
    expect(bigJump.captain.mission!.cargo.uncommonMaterial.equals(steppedCaptain.mission!.cargo.uncommonMaterial)).toBe(
      true
    );
    expect(bigJump.captain.mission!.cargo.rareMaterial.equals(steppedCaptain.mission!.cargo.rareMaterial)).toBe(true);
    // xp / level carried by the captain must agree across chunking too.
    expect(bigJump.captain.xp.equals(steppedCaptain.xp)).toBe(true);
    expect(bigJump.captain.level).toBe(steppedCaptain.level);
    expect(bigJump.homePlanetDelta.commonOre.equals(steppedDelta.commonOre)).toBe(true);
    expect(bigJump.homePlanetDelta.uncommonMaterial.equals(steppedDelta.uncommonMaterial)).toBe(true);
    expect(bigJump.homePlanetDelta.rareMaterial.equals(steppedDelta.rareMaterial)).toBe(true);
  };

  it("CLOSED-FORM holds with a HAULER (cargo 180 / transit 0.8) as shipStats", () => {
    // 560 ticks crosses more than 2 full hauler cycles (2*253=506). 5600 steps
    // of 0.1 each sum to the same 560 -- same step granularity as the base test.
    closedFormForShip("prospectorHauler", 560, 5600);
  });

  it("CLOSED-FORM holds with a RUNNER (cargo 60 / transit 1.5) as shipStats", () => {
    // 230 ticks crosses more than 2 full runner cycles (2*103=206). 2300 steps
    // of 0.1 each sum to the same 230.
    closedFormForShip("prospectorRunner", 230, 2300);
  });

  it("MINER's extractionYieldMult (1.35) scales one extracting tick's common yield to 1.35x the null baseline", () => {
    // rng constant 0.5: for shortOreRun (rareChance 0.001, uncommonChance 0.019)
    // both occurrence checks fail (0.5 < 0.001? no; 0.5 < 0.019? no), so common
    // wins by default every roll. That isolates extractionYieldMult's effect on
    // the common tier's amount: null path yields baseAmount*(1+0)=1 per extracting
    // tick; miner path folds yieldMult-1 = 0.35 into commonYieldMult, so
    // baseAmount*(1+0.35)=1.35 per tick. Ratio is exactly 1.35.
    const COMMON_WINS = () => 0.5;

    const baseNull = freshCaptains(1)[0];
    baseNull.mission = { ...missionCaptain("shortOreRun"), phase: "extracting", phaseProgressTicks: 0 };
    const nullResult = tickCaptainMission(1, baseNull, COMMON_WINS, {}, null);

    const baseMiner = freshCaptains(1)[0];
    baseMiner.mission = { ...missionCaptain("shortOreRun"), phase: "extracting", phaseProgressTicks: 0 };
    const minerResult = tickCaptainMission(1, baseMiner, COMMON_WINS, {}, shipStatsFor("prospectorMiner"));

    // Absolute values first (proves the exact amounts, not just the ratio):
    expect(nullResult.captain.mission!.cargo.commonOre.equals(1)).toBe(true);
    expect(minerResult.captain.mission!.cargo.commonOre.equals(1.35)).toBe(true);
    // Then the 1.35x relationship the task calls out explicitly:
    const nullCommon = nullResult.captain.mission!.cargo.commonOre;
    const minerCommon = minerResult.captain.mission!.cargo.commonOre;
    expect(minerCommon.equals(nullCommon.times(1.35))).toBe(true);
    // Miner leaves cargoCapacity 90 / transit 1.0 unchanged, so nothing but the
    // common AMOUNT should differ -- uncommon/rare stay at 0 on both paths.
    expect(minerResult.captain.mission!.cargo.uncommonMaterial.equals(0)).toBe(true);
    expect(minerResult.captain.mission!.cargo.rareMaterial.equals(0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Task 7: tick() resolves each captain's assigned ship and passes its stats
// into tickCaptainMission. This is the INTEGRATION point -- Task 6 taught
// tickCaptainMission to ACCEPT a 5th shipStats arg, but only tick() knows which
// hull a captain flies (via GameState.ships[].assignedCaptainId). These tests
// prove the fleet loop looks the ship up and threads its stats through, so a
// captain's assigned hull actually changes their mission math end-to-end.
//
// NOTE ON RNG: unlike the Task 6 tickCaptainMission tests, tick() calls
// tickCaptainMission with Math.random internally (not an injectable rng), so
// these assertions are deliberately built on rng-INDEPENDENT quantities:
//   - which PHASE a captain is in after N ticks (pure function of transit/cargo
//     geometry, no rng), and
//   - the TOTAL units delivered to homePlanet.storage on cycle completion. Each
//     whole extracting tick adds exactly 1 unit total across tiers (the tier is
//     rng-chosen, but the count is not -- see rollExtractionTick's mutual-
//     exclusivity comment), so a completed cycle delivers exactly cargoCapacity
//     units regardless of how Math.random split them across tiers.
// ---------------------------------------------------------------------------
describe("tick() — applies each captain's assigned-ship stats to their mission", () => {
  // Sum of the three loot tiers in homePlanet.storage -- the rng-independent
  // "total units delivered" quantity the traces below rely on.
  const totalHomeLoot = (state: ReturnType<typeof freshState>) => {
    const s = state.homePlanet.storage;
    return s.commonOre.plus(s.uncommonMaterial).plus(s.rareMaterial);
  };

  // Put freshState()'s single captain (id 1) on a fresh shortOreRun, at the very
  // start of the cycle (ordersReceived / 0). freshState seeds exactly one hull
  // (ship-1, generalFreighter, assignedCaptainId: 1) -- so out of the box this
  // captain flies the Freighter, which is the pre-ship-wiring implicit baseline
  // (transit 1.0 / cargo 90 / yield 1.0 == effectiveMissionDef no-op).
  const stateOnShortOreRun = () => {
    const state = freshState();
    state.captains[0].mission = {
      missionKey: "shortOreRun",
      phase: "ordersReceived",
      phaseProgressTicks: 0,
      cargo: { commonOre: new Decimal(0), uncommonMaterial: new Decimal(0), rareMaterial: new Decimal(0) },
      recalled: false,
    };
    return state;
  };

  it("a RUNNER-assigned captain is FURTHER ALONG than a FREIGHTER-assigned captain for the same elapsed time", () => {
    // tickDurationSeconds = 1 (fresh default), so deltaSeconds == ticksElapsed.
    // Run both for 103 ticks -- chosen because that is EXACTLY one full RUNNER
    // cycle, so the runner's lead is unmissable (it completes and delivers,
    // while the freighter has not even finished its first extraction).
    //
    // Cycle geometry (shortOreRun base: orders 1, transitOut/Back 25 each,
    // extract = ceil(cargoCapacity/1) ticks, unload 8):
    //   FREIGHTER (transit 1.0, cargo 90): 1 + 25 + 90 + 25 + 8 = 149 ticks/cycle.
    //     Cumulative boundaries: orders done @1, transitOut done @26, extracting
    //     done @116. At 103 ticks the freighter is STILL in "extracting", at
    //     progress 103 - 26 = 77 of 90 -> ZERO cycles completed -> ZERO loot
    //     delivered to homePlanet (loot only lands on unload completion).
    //   RUNNER (transit 1.5, cargo 60): transitOut/Back = ceil(25/1.5) = 17 each,
    //     extract = 60. 1 + 17 + 60 + 17 + 8 = 103 ticks/cycle. At 103 ticks the
    //     runner completes EXACTLY one cycle and auto-repeats -> back at
    //     "ordersReceived", having delivered a full 60-unit haul to homePlanet.
    const DELTA = 103;

    // Case A: baseline -- the seeded Freighter stays assigned to captain 1.
    const stateA = stateOnShortOreRun();
    const resultA = tick(DELTA, stateA);

    // Case B: swap captain 1's hull to a Runner by mutating the seeded ship's
    // typeKey (cleaner than adding a second ship + re-parking -- assignment is
    // unchanged, only the hull type differs, isolating the stat effect).
    const stateB = stateOnShortOreRun();
    stateB.ships[0].typeKey = "prospectorRunner";
    const resultB = tick(DELTA, stateB);

    // Runner completed a cycle and is back at the start; freighter is mid-extract.
    expect(resultA.captains[0].mission!.phase).toBe("extracting");
    expect(resultA.captains[0].mission!.phaseProgressTicks).toBeCloseTo(77, 6);
    expect(resultB.captains[0].mission!.phase).toBe("ordersReceived");

    // The decisive rng-independent proof: the runner delivered a full haul; the
    // freighter delivered nothing. Freighter delivered EXACTLY 0 (no cycle done);
    // runner delivered EXACTLY 60 (one completed cycle == its cargoCapacity).
    expect(totalHomeLoot(resultA).equals(0)).toBe(true);
    expect(totalHomeLoot(resultB).equals(60)).toBe(true);
    // ...and, stated as the task frames it, runner strictly further along.
    expect(totalHomeLoot(resultB).greaterThan(totalHomeLoot(resultA))).toBe(true);

    // Cycle completion also awards fleet XP + credits (shortOreRun: 1 XP, 10 cr
    // per cycle) -- another independent confirmation the runner completed and
    // the freighter did not.
    expect(resultB.fleetAdminXp.greaterThan(resultA.fleetAdminXp)).toBe(true);
    expect(resultB.credits.equals(10)).toBe(true);
    expect(resultA.credits.equals(0)).toBe(true);
  });

  it("with the seeded FREIGHTER (transit 1.0 / cargo 90 / yield 1.0), tick() matches the pre-ship-wiring baseline", () => {
    // The Freighter's stats are all identity (effectiveMissionDef is a no-op for
    // transit 1.0 / cargo 90 == shortOreRun's own base cargo). So passing its
    // shipStats must produce the SAME phase geometry as passing null (the old
    // implicit "no ship" behavior). We verify by checking the exact phase the
    // Freighter captain lands in after a 103-tick run -- computed purely from the
    // 149-tick base cycle, no ship modifier involved.
    //
    // At 103 ticks: orders done @1, transitOut done @26, so extracting progress
    // = 103 - 26 = 77 of 90 -> phase "extracting", phaseProgressTicks 77. This is
    // identical to what tick() produced BEFORE ship stats were wired in (the
    // Freighter == today's implicit ship), which is the whole point of seeding it
    // as the universal grandfathered hull.
    const state = stateOnShortOreRun();
    const result = tick(103, state);

    expect(result.captains[0].mission!.phase).toBe("extracting");
    expect(result.captains[0].mission!.phaseProgressTicks).toBeCloseTo(77, 6);
    // No cycle completed within 103 < 149 ticks -> no loot, no XP, no credits.
    expect(totalHomeLoot(result).equals(0)).toBe(true);
    expect(result.fleetAdminXp.equals(0)).toBe(true);
    expect(result.credits.equals(0)).toBe(true);
  });
});

describe("assignShipToCaptain", () => {
  // Build a 2-captain / 2-ship fleet directly on top of freshState(), the same
  // "start from freshState(), then overwrite the fields this test cares about"
  // idiom every other action-function test in this file uses (see
  // dispatchCaptainOnMission / recallCaptain above). freshState() already seeds
  // captain 1 flying "ship-1"; each test below layers a second captain and a
  // second parked ship on top so the swap/lock/in-use cases have something to
  // act on. captain 1's mission stays null (idle) unless a test explicitly sets
  // it, matching freshCaptainStack's baseline.
  function twoShipFleet() {
    const state = freshState();
    state.captains = freshCaptains(2); // captains 1 and 2, both idle (mission: null)
    // Explicit, hand-built 2-ship layout: captain 1 flies ship-1, ship-2 parked.
    state.ships = [
      { id: "ship-1", typeKey: "generalFreighter", assignedCaptainId: 1 },
      { id: "ship-2", typeKey: "generalFreighter", assignedCaptainId: null },
    ];
    return state;
  }

  it("swaps: assigns the target ship and auto-parks the captain's previous (different) hull", () => {
    // captain 1 flies ship-1; ship-2 is parked. Assigning ship-2 to captain 1
    // moves them onto ship-2 and parks ship-1 (assignedCaptainId -> null).
    const state = twoShipFleet();
    const { next, success } = assignShipToCaptain(state, 1, "ship-2");

    expect(success).toBe(true);
    const ship1 = next.ships.find((s) => s.id === "ship-1")!;
    const ship2 = next.ships.find((s) => s.id === "ship-2")!;
    expect(ship2.assignedCaptainId).toBe(1); // target now flown by captain 1
    expect(ship1.assignedCaptainId).toBe(null); // previous hull auto-parked
  });

  it("self-reassign is a harmless no-op: the captain keeps the ship they already fly (NOT parked)", () => {
    // ORDERING GUARD TEST. captain 1 flies ship-1. Re-assigning ship-1 to
    // captain 1 must leave ship-1 STILL assigned to captain 1 -- it must NOT be
    // nulled. This is the case the .map() ordering exists to protect: the target
    // branch (s.id === shipId) runs first and wins, so the "park the old hull"
    // branch never sees ship-1 as a *different* old hull to park.
    const state = twoShipFleet();
    const { next, success } = assignShipToCaptain(state, 1, "ship-1");

    expect(success).toBe(true);
    const ship1 = next.ships.find((s) => s.id === "ship-1")!;
    expect(ship1.assignedCaptainId).toBe(1); // STILL captain 1's -- not parked
  });

  it("fails (same state reference) if the captain is on a mission -- hull can't change mid-cycle", () => {
    // The on-mission lock is load-bearing for the closed-form guarantee: a hull
    // that changed mid-mission would invalidate effectiveMissionDef's per-cycle
    // stability. captain 1 has a live mission -> assignment must refuse.
    const state = twoShipFleet();
    state.captains[0].mission = {
      missionKey: "shortOreRun",
      phase: "extracting",
      phaseProgressTicks: 4,
      cargo: { commonOre: new Decimal(0), uncommonMaterial: new Decimal(0), rareMaterial: new Decimal(0) },
      recalled: false,
    };

    const { next, success } = assignShipToCaptain(state, 1, "ship-2");
    expect(success).toBe(false);
    expect(next).toBe(state); // same reference, unchanged
  });

  it("fails (same state reference) if the target ship is assigned to a DIFFERENT captain", () => {
    // ship-2 is flown by captain 2. captain 1 cannot poach it -- assignment
    // refuses rather than stealing another captain's hull.
    const state = twoShipFleet();
    state.ships[1] = { id: "ship-2", typeKey: "generalFreighter", assignedCaptainId: 2 };

    const { next, success } = assignShipToCaptain(state, 1, "ship-2");
    expect(success).toBe(false);
    expect(next).toBe(state); // same reference, unchanged
  });

  it("fails (same state reference) if the captain or the ship does not exist", () => {
    const state = twoShipFleet();

    const missingCaptain = assignShipToCaptain(state, 999, "ship-2");
    expect(missingCaptain.success).toBe(false);
    expect(missingCaptain.next).toBe(state); // same reference

    const missingShip = assignShipToCaptain(state, 1, "ship-999");
    expect(missingShip.success).toBe(false);
    expect(missingShip.next).toBe(state); // same reference
  });
});

describe("buyShip", () => {
  // Same "start from freshState(), then overwrite only the fields this test
  // cares about" idiom every other action-function test in this file uses.
  // freshState() seeds credits Decimal(0), one ship ("ship-1"),
  // shipStorageCapacity 8, nextShipId 2 -- each test below overrides the
  // subset it depends on. The `!def.cost` (not-purchasable) guard inside
  // buyShip is NOT tested here: all 4 current SHIP_TYPES hulls have a non-null
  // cost, so that branch is unreachable with any real ShipTypeKey. It is
  // forward-defensive for future Research-gated non-purchasable hulls and
  // cannot be exercised without hacking a fake null-cost type into the model,
  // which the task explicitly forbids -- so it is left untested by design.
  it("buys a hull when affordable and under storage cap: appends a PARKED ship, deducts credits, bumps nextShipId", () => {
    // credits 500 seeded (freshState default is 0); prospectorHauler costs 150.
    // freshState has 1 ship, cap 8 (under cap), nextShipId 2 -- so the new ship
    // takes id "ship-2" and nextShipId advances to 3. New ship is parked
    // (assignedCaptainId null); credits land at 500 - 150 = 350.
    const state = freshState();
    state.credits = new Decimal(500);

    const { next, success } = buyShip(state, "prospectorHauler");

    expect(success).toBe(true);
    expect(next.ships.length).toBe(state.ships.length + 1); // one more hull than before
    const bought = next.ships[next.ships.length - 1];
    expect(bought).toEqual({ id: "ship-2", typeKey: "prospectorHauler", assignedCaptainId: null });
    expect(next.credits.equals(350)).toBe(true); // 500 - 150, via Decimal .minus
    expect(next.nextShipId).toBe(3); // 2 -> 3, monotonic id source bumped
  });

  it("fails (same state reference) when storage is at capacity", () => {
    // Fill ships up to shipStorageCapacity so the cap guard fires BEFORE the
    // affordability check -- credits are set high enough that only the cap can
    // be the cause of failure.
    const state = freshState();
    state.credits = new Decimal(500);
    state.shipStorageCapacity = 2;
    state.ships = [
      { id: "ship-1", typeKey: "generalFreighter", assignedCaptainId: 1 },
      { id: "ship-2", typeKey: "generalFreighter", assignedCaptainId: null },
    ]; // length 2 === shipStorageCapacity 2 -> full

    const { next, success } = buyShip(state, "prospectorHauler");
    expect(success).toBe(false);
    expect(next).toBe(state); // same reference, unchanged
  });

  it("fails (same state reference) when credits are insufficient", () => {
    // credits 10 < prospectorHauler cost 150; under cap, so the affordability
    // guard is the sole cause of failure.
    const state = freshState();
    state.credits = new Decimal(10);

    const { next, success } = buyShip(state, "prospectorHauler");
    expect(success).toBe(false);
    expect(next).toBe(state); // same reference, unchanged
  });
});
