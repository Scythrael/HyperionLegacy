import { describe, it, expect, vi } from "vitest";
import {
  tick,
  tickCaptainMission,
  dispatchCaptainOnMission,
  recallCaptain,
  craftRecipe,
  buyCaptainTalent,
  buyHomeworldTalent,
  applyFleetAdminXp,
  captainCommonYieldMult,
  captainUncommonYieldMult,
  captainUncommonChanceMult,
  captainRareChanceMult,
  fleetRareYieldMult,
} from "./tick";
import Decimal from "break_infinity.js";
import { freshState, freshCaptains, MISSIONS, RECIPES, type CaptainMissionState } from "./model";

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

describe("captainCommonYieldMult / captainUncommonYieldMult / captainUncommonChanceMult / captainRareChanceMult / fleetRareYieldMult", () => {
  it("captainCommonYieldMult is 0 for a captain with no unlocked talents", () => {
    const captain = freshCaptains(1)[0];
    expect(captainCommonYieldMult(captain)).toBe(0);
  });

  it("captainCommonYieldMult reads commandExtractionI's mult when unlocked (Bulk Extraction)", () => {
    const captain = freshCaptains(1)[0];
    captain.unlockedCaptainTalents = ["commandExtractionI"];
    expect(captainCommonYieldMult(captain)).toBeCloseTo(0.1, 6);
  });

  it("captainCommonYieldMult ignores unlocked talents of OTHER effect types", () => {
    const captain = freshCaptains(1)[0];
    // commandExtractionII/resourcefulnessRareChanceI/II are uncommonYieldMult,
    // uncommonChanceMult, and rareChanceMult respectively -- none is commonYieldMult.
    // Set directly on unlockedCaptainTalents (bypassing buyCaptainTalent's own
    // requires-chain validation) purely to exercise this helper's effect-type filter.
    captain.unlockedCaptainTalents = ["commandExtractionII", "resourcefulnessRareChanceI", "resourcefulnessRareChanceII"];
    expect(captainCommonYieldMult(captain)).toBe(0);
  });

  it("captainUncommonYieldMult is 0 for a captain with no unlocked talents", () => {
    const captain = freshCaptains(1)[0];
    expect(captainUncommonYieldMult(captain)).toBe(0);
  });

  it("captainUncommonYieldMult reads commandExtractionII's mult when unlocked (Refined Extraction)", () => {
    const captain = freshCaptains(1)[0];
    // commandExtractionII requires commandExtractionI per its `requires` field, but this
    // helper only reads unlockedCaptainTalents -- set directly rather than going through
    // buyCaptainTalent's own prerequisite-chain validation.
    captain.unlockedCaptainTalents = ["commandExtractionII"];
    expect(captainUncommonYieldMult(captain)).toBeCloseTo(0.15, 6);
  });

  it("captainUncommonChanceMult is 0 for a captain with no unlocked talents", () => {
    const captain = freshCaptains(1)[0];
    expect(captainUncommonChanceMult(captain)).toBe(0);
  });

  it("captainUncommonChanceMult reads resourcefulnessRareChanceI's mult when unlocked (Keen Eye I)", () => {
    const captain = freshCaptains(1)[0];
    captain.unlockedCaptainTalents = ["resourcefulnessRareChanceI"];
    expect(captainUncommonChanceMult(captain)).toBeCloseTo(0.25, 6);
  });

  it("captainRareChanceMult is 0 for a captain with no unlocked talents", () => {
    const captain = freshCaptains(1)[0];
    expect(captainRareChanceMult(captain)).toBe(0);
  });

  it("captainRareChanceMult reads resourcefulnessRareChanceII's mult when unlocked (Keen Eye II)", () => {
    const captain = freshCaptains(1)[0];
    captain.unlockedCaptainTalents = ["resourcefulnessRareChanceII"];
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

describe("tickCaptainMission — awards XP on cycle completion", () => {
  it("awards no XP when no cycle completes", () => {
    const base = freshCaptains(1)[0];
    base.mission = missionCaptain(); // mid-cycle, phaseProgressTicks 0, far from completing
    const { captain } = tickCaptainMission(0.5, base, ALWAYS_MIN_ROLL);
    expect(captain.xp.equals(0)).toBe(true);
    expect(captain.level).toBe(1);
  });

  it("awards XP once when exactly one cycle completes", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain(), phase: "unloading", phaseProgressTicks: 0 };
    const { captain } = tickCaptainMission(8, base, ALWAYS_MIN_ROLL); // 8 ticks completes unloadTicks=8
    expect(captain.xp.equals(50)).toBe(true);
    expect(captain.level).toBe(1); // 50 < xpForNextLevel(1)=100, no level-up yet
  });

  it("levels up and grants a stat point when accumulated XP crosses the threshold", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain(), phase: "unloading", phaseProgressTicks: 0 };
    base.xp = new Decimal(60); // + this cycle's 50 = 110, crosses xpForNextLevel(1)=100
    const { captain } = tickCaptainMission(8, base, ALWAYS_MIN_ROLL); // 8 ticks completes unloadTicks=8
    expect(captain.level).toBe(2);
    expect(captain.xp.equals(10)).toBe(true); // 110 - 100
    expect(captain.statPoints).toBe(1);
  });

  it("a big jump completing multiple cycles awards XP for EACH cycle, resolving multiple level-ups if crossed", () => {
    const base = freshCaptains(1)[0];
    base.mission = missionCaptain(); // shortOreRun, 149 ticks/cycle
    const { captain } = tickCaptainMission(298, base, ALWAYS_MIN_ROLL); // exactly 2 full cycles (2*149) -> 2 * 50 = 100 XP
    expect(captain.xp.equals(0)).toBe(true); // 100 XP exactly hits xpForNextLevel(1)=100 -> levels to 2 with 0 leftover
    expect(captain.level).toBe(2);
    expect(captain.statPoints).toBe(1);
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
    expect(result.captains[0].shipType).toBe(before.shipType);
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
  it("commandExtractionI (Captain Talent, commonYieldMult) boosts a mission captain's extraction via tick()", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const state = freshState();
      state.captains[0].unlockedCaptainTalents = ["commandExtractionI"]; // +0.1 commonYieldMult
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

  it("commandExtractionI (Captain Talent) and a Homeworld Talent's rareYieldMult both wire through tick() without interfering with each other", () => {
    // Math.random mocked to 0.5 for the same reason as the commonYieldMult-only test
    // above: this forces common to win outright (both occurrence checks fail), so
    // fleetLogisticsYield's rareYieldMult never even gets a chance to apply this roll --
    // proving the two bonus types are wired independently and don't cross-contaminate.
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const state = freshState();
      state.unlockedHomeworldTalents = ["fleetLogisticsYield"]; // +0.05 rareYieldMult (inert this roll -- rare never occurs)
      state.captains[0].unlockedCaptainTalents = ["commandExtractionI"]; // +0.1 commonYieldMult (does affect the total)
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

describe("buyCaptainTalent", () => {
  it("succeeds when affordable and prerequisite met, deducts statPoints, records the unlock", () => {
    const state = freshState();
    state.captains[0].statPoints = 2;
    const { next, success } = buyCaptainTalent(state, 1, "commandExtractionI");
    expect(success).toBe(true);
    expect(next.captains[0].statPoints).toBe(0);
    expect(next.captains[0].unlockedCaptainTalents).toEqual(["commandExtractionI"]);
  });

  it("fails (same state reference) if already unlocked", () => {
    const state = freshState();
    state.captains[0].statPoints = 10;
    const { next: dispatched } = buyCaptainTalent(state, 1, "commandExtractionI");
    const { next, success } = buyCaptainTalent(dispatched, 1, "commandExtractionI");
    expect(success).toBe(false);
    expect(next).toBe(dispatched);
  });

  it("fails if the prerequisite isn't unlocked yet", () => {
    const state = freshState();
    state.captains[0].statPoints = 10;
    const { next, success } = buyCaptainTalent(state, 1, "commandExtractionII");
    expect(success).toBe(false);
    expect(next).toBe(state);
  });

  it("fails if statPoints are insufficient", () => {
    const state = freshState();
    state.captains[0].statPoints = 1; // costs 2
    const { next, success } = buyCaptainTalent(state, 1, "commandExtractionI");
    expect(success).toBe(false);
    expect(next).toBe(state);
  });
});

describe("buyHomeworldTalent", () => {
  it("succeeds for a non-slot node: deducts adminPoints, records the unlock", () => {
    const state = freshState();
    state.adminPoints = 4;
    const { next, success } = buyHomeworldTalent(state, "industryBonusOutput");
    expect(success).toBe(true);
    expect(next.adminPoints).toBe(0);
    expect(next.unlockedHomeworldTalents).toEqual(["industryBonusOutput"]);
  });

  it("succeeds for an unlockCaptainSlot node: also appends a new captain", () => {
    const state = freshState();
    state.adminPoints = 3;
    const { next, success } = buyHomeworldTalent(state, "fleetLogisticsSlot1");
    expect(success).toBe(true);
    expect(next.captains).toHaveLength(2);
    expect(next.captains[1].id).toBe(2);
  });

  it("fails if adminPoints are insufficient", () => {
    const state = freshState();
    state.adminPoints = 2; // costs 3
    const { next, success } = buyHomeworldTalent(state, "fleetLogisticsSlot1");
    expect(success).toBe(false);
    expect(next).toBe(state);
  });

  it("fails (same state reference) if already unlocked", () => {
    const state = freshState();
    state.adminPoints = 10;
    const { next: dispatched } = buyHomeworldTalent(state, "industryBonusOutput");
    const { next, success } = buyHomeworldTalent(dispatched, "industryBonusOutput");
    expect(success).toBe(false);
    expect(next).toBe(dispatched);
  });

  it("fails if the prerequisite isn't unlocked yet", () => {
    const state = freshState();
    state.adminPoints = 10;
    const { next, success } = buyHomeworldTalent(state, "fleetLogisticsSlot2"); // requires fleetLogisticsSlot1
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
