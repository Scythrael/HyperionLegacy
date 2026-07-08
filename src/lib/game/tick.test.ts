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
import { freshState, freshCaptains, MISSIONS, RECIPES, type CaptainMissionState } from "./model";

function missionCaptain(missionKey: "shortOreRun" | "longOreRun" = "shortOreRun"): CaptainMissionState {
  return {
    missionKey,
    phase: "ordersReceived",
    phaseProgressTicks: 0,
    cargo: { commonOre: 0, uncommonMaterial: 0, rareMaterial: 0 },
    recalled: false,
  };
}

// A constant (non-stateful) rng returning 0 on every call. Under the OLD
// weighted-pick mechanism this meant "always land on the first (commonOre)
// bucket" -- hence the old name ALWAYS_MIN_ROLL. Under the NEW independent
// per-tier mechanism (2026-07-07 Loot Tier Rework), 0 instead passes BOTH
// occurrence checks (0 < uncommonChance, 0 < rareChance) AND lands the
// uncommon amount-roll on its lowest bucket (0 < 0.75 -> baseAmount 1) --
// i.e. EVERY roll now delivers uncommon=1 and rare=1 (each subtracted from
// extractionRatePerTick), not pure commonOre. Renamed to reflect that: this
// is the constant that always produces the MINIMUM roll on every occurrence
// check and amount check, not a "commonOre-only" constant anymore. Still a
// constant (not stateful) rng, so the closed-form "one big jump equals many
// small ticks" guarantee (which only requires an rng that behaves the SAME
// on every call, regardless of call count) is unaffected by this rename.
const ALWAYS_MIN_ROLL = () => 0;

describe("tickCaptainMission — closed-form requirement", () => {
  it("one big jump equals many small ticks, across multiple phase transitions", () => {
    const base = freshCaptains(1)[0];
    base.mission = missionCaptain("shortOreRun");
    // shortOreRun total ticks per cycle: 1 (orders) + 3 (out) + 10 (extract) + 3 (back) + 1 (unload) = 18.
    // 40 ticksElapsed crosses more than one full cycle (auto-repeat).
    const bigJump = tickCaptainMission(40, base, ALWAYS_MIN_ROLL);

    let steppedCaptain = base;
    const steppedDelta = { commonOre: 0, uncommonMaterial: 0, rareMaterial: 0 };
    for (let i = 0; i < 400; i++) {
      const result = tickCaptainMission(0.1, steppedCaptain, ALWAYS_MIN_ROLL);
      steppedCaptain = result.captain;
      steppedDelta.commonOre += result.homePlanetDelta.commonOre;
      steppedDelta.uncommonMaterial += result.homePlanetDelta.uncommonMaterial;
      steppedDelta.rareMaterial += result.homePlanetDelta.rareMaterial;
    }

    expect(bigJump.captain.mission).toEqual(steppedCaptain.mission);
    expect(bigJump.homePlanetDelta).toEqual(steppedDelta);
  });

  it("zero or negative ticksElapsed is a no-op", () => {
    const base = freshCaptains(1)[0];
    base.mission = missionCaptain();
    const result = tickCaptainMission(0, base, ALWAYS_MIN_ROLL);
    expect(result.captain).toBe(base);
    expect(result.homePlanetDelta).toEqual({ commonOre: 0, uncommonMaterial: 0, rareMaterial: 0 });
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
    base.mission = missionCaptain(); // shortOreRun: 1+3+10+3+1 = 18 ticks for one full cycle
    const { captain, homePlanetDelta } = tickCaptainMission(17.9, base, ALWAYS_MIN_ROLL);
    expect(captain.mission!.phase).toBe("unloading");
    expect(captain.mission!.phaseProgressTicks).toBeCloseTo(0.9, 6);
    expect(homePlanetDelta).toEqual({ commonOre: 0, uncommonMaterial: 0, rareMaterial: 0 }); // not unloaded yet
  });
});

describe("tickCaptainMission — extraction loot rolls", () => {
  // shortOreRun: extractionRatePerTick 10, uncommonChance 0.019, rareChance 0.001.
  // A constant rng of 0.5 fails BOTH occurrence checks every roll (hand-verify:
  // 0.5 < 0.019? no. 0.5 < 0.001? no.) -- nothing but commonOre ever occurs.
  const NOTHING_OCCURS = () => 0.5;

  it("rolls loot once per whole tick crossed during extracting, adding extractionRatePerTick units each time", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain(), phase: "extracting", phaseProgressTicks: 0 };
    // 3.5 ticks of extracting crosses whole boundaries 1, 2, 3 -- 3 rolls. Neither
    // occurrence check ever passes (see NOTHING_OCCURS above), so every roll is
    // pure commonOre: 3 * 10 = 30.
    const { captain } = tickCaptainMission(3.5, base, NOTHING_OCCURS);
    expect(captain.mission!.cargo.commonOre).toBe(30);
    expect(captain.mission!.cargo.uncommonMaterial).toBe(0);
    expect(captain.mission!.cargo.rareMaterial).toBe(0);
    expect(captain.mission!.phaseProgressTicks).toBeCloseTo(3.5, 6);
  });

  it("a large jump resolves every extraction tick's loot roll, not just the last one", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain(), phase: "extracting", phaseProgressTicks: 0 };
    // Exactly 10 ticks completes extracting (cargoCapacity 100 / rate 10) -- 10 rolls, all
    // commonOre under NOTHING_OCCURS: 10 * 10 = 100.
    const { captain } = tickCaptainMission(10, base, NOTHING_OCCURS);
    expect(captain.mission!.cargo.commonOre).toBe(100);
    expect(captain.mission!.phase).toBe("transitBack"); // extracting completed, advanced
  });

  it("neither tier occurs: pure commonOre at the unmodified extractionRatePerTick", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain(), phase: "extracting", phaseProgressTicks: 0 };
    // Hand-trace (shortOreRun, 1 roll): call 1 (uncommon occurrence) 0.5 < 0.019? no.
    // call 2 (rare occurrence) 0.5 < 0.001? no. commonAmount = max(0, 10-0-0)*(1+0) = 10.
    const { captain } = tickCaptainMission(1, base, NOTHING_OCCURS);
    expect(captain.mission!.cargo.commonOre).toBe(10);
    expect(captain.mission!.cargo.uncommonMaterial).toBe(0);
    expect(captain.mission!.cargo.rareMaterial).toBe(0);
  });

  it("both tiers occur in the same tick, at their minimum amounts", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain(), phase: "extracting", phaseProgressTicks: 0 };
    // A constant rng of 0 passes every occurrence check AND lands the amount roll on
    // its lowest bucket. Hand-trace (shortOreRun, 1 roll, 3 rng() calls in fixed order):
    //   call 1 (uncommon occurrence): 0 < 0.019 -> true, uncommon occurs.
    //   call 2 (uncommon amount roll): 0 < 0.75 -> baseAmount 1 -> uncommonAmount = 1 * (1+0) = 1.
    //   call 3 (rare occurrence): 0 < 0.001 -> true, rare occurs -> rareAmount = 1 * (1+0) = 1.
    //   commonAmount = max(0, 10 - 1 - 1) * (1+0) = 8.
    // Matches the design doc's own worked example exactly (8 common, 1 uncommon, 1 rare).
    const { captain } = tickCaptainMission(1, base, ALWAYS_MIN_ROLL);
    expect(captain.mission!.cargo.commonOre).toBe(8);
    expect(captain.mission!.cargo.uncommonMaterial).toBe(1);
    expect(captain.mission!.cargo.rareMaterial).toBe(1);
  });

  it("uncommon amount can land on bucket 2 or 3 of the 75/20/5 distribution", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain(), phase: "extracting", phaseProgressTicks: 0 };
    // Occurrence chance is always small (<=8% for either mission) while the amount-roll
    // thresholds are 0.75/0.95 -- no single CONSTANT rng value can pass the (small-value-
    // needing) occurrence check AND land the amount roll on bucket 2 or 3 (large-value-
    // needing), since occurrence and amount draw from the SAME rng() call sequence. This
    // is the ONE test in this file that uses a small STATEFUL sequence rng instead of a
    // constant one, confined here deliberately -- a stateful rng risks breaking the
    // closed-form "one big jump equals many small ticks" guarantee if used anywhere that
    // guarantee actually matters (e.g. multi-roll/multi-call tests elsewhere in this file),
    // so every OTHER test keeps using a constant rng.
    let calls = 0;
    const rng = () => {
      calls++;
      return calls === 1 ? 0 : 0.8;
    };
    // Hand-trace (shortOreRun, 1 roll):
    //   call 1 (uncommon occurrence): returns 0 -> 0 < 0.019 -> true, uncommon occurs.
    //   call 2 (uncommon amount roll): returns 0.8 -> 0.8 < 0.75? no. 0.8 < 0.95? yes ->
    //     baseAmount 2 -> uncommonAmount = 2 * (1+0) = 2.
    //   call 3 (rare occurrence): returns 0.8 (calls is now 3, still not the first call) ->
    //     0.8 < 0.001? no -> rare does NOT occur.
    //   commonAmount = max(0, 10 - 2 - 0) * (1+0) = 8.
    const { captain } = tickCaptainMission(1, base, rng);
    expect(captain.mission!.cargo.commonOre).toBe(8);
    expect(captain.mission!.cargo.uncommonMaterial).toBe(2);
    expect(captain.mission!.cargo.rareMaterial).toBe(0);
  });

  it("omitting the bonuses arg behaves exactly as before (defaults to no bonus)", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain(), phase: "extracting", phaseProgressTicks: 0 };
    const { captain } = tickCaptainMission(1, base, NOTHING_OCCURS); // no 4th arg at all
    expect(captain.mission!.cargo.commonOre).toBe(10); // unmodified extractionRatePerTick
    expect(captain.mission!.cargo.uncommonMaterial).toBe(0);
    expect(captain.mission!.cargo.rareMaterial).toBe(0);
  });

  it("commonYieldMult scales only the leftover commonOre amount, not occurrence", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain(), phase: "extracting", phaseProgressTicks: 0 };
    // NOTHING_OCCURS (0.5) fails both occurrence checks regardless of commonYieldMult
    // (that bonus doesn't touch either chance) -- commonAmount = max(0, 10-0-0) * (1+0.25) = 12.5.
    const { captain } = tickCaptainMission(1, base, NOTHING_OCCURS, { commonYieldMult: 0.25 });
    expect(captain.mission!.cargo.commonOre).toBe(12.5);
    expect(captain.mission!.cargo.uncommonMaterial).toBe(0);
    expect(captain.mission!.cargo.rareMaterial).toBe(0);
  });

  it("uncommonYieldMult scales only uncommon's rolled amount, when uncommon actually occurred", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain(), phase: "extracting", phaseProgressTicks: 0 };
    // A constant rng of 0.01 (shortOreRun, uncommonChance 0.019, rareChance 0.001):
    //   call 1 (uncommon occurrence): 0.01 < 0.019 -> true, uncommon occurs.
    //   call 2 (uncommon amount roll): 0.01 < 0.75 -> baseAmount 1 -> uncommonAmount = 1 * (1+0.5) = 1.5.
    //   call 3 (rare occurrence): 0.01 < 0.001? no -> rare does NOT occur -> rareAmount = 0.
    //   commonAmount = max(0, 10 - 1.5 - 0) * (1+0) = 8.5.
    const rng = () => 0.01;
    const { captain } = tickCaptainMission(1, base, rng, { uncommonYieldMult: 0.5 });
    expect(captain.mission!.cargo.uncommonMaterial).toBe(1.5);
    expect(captain.mission!.cargo.rareMaterial).toBe(0);
    expect(captain.mission!.cargo.commonOre).toBe(8.5);
  });

  it("rareYieldMult scales only rare's rolled amount, when rare actually occurred", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain(), phase: "extracting", phaseProgressTicks: 0 };
    // A constant rng of 0.0005 (shortOreRun, uncommonChance 0.019, rareChance 0.001):
    //   call 1 (uncommon occurrence): 0.0005 < 0.019 -> true, uncommon occurs.
    //   call 2 (uncommon amount roll): 0.0005 < 0.75 -> baseAmount 1 -> uncommonAmount = 1 * (1+0) = 1
    //     (uncommonYieldMult defaults to 0 here -- only rareYieldMult is set on this call).
    //   call 3 (rare occurrence): 0.0005 < 0.001 -> true, rare occurs -> rareAmount = 1 * (1+0.4) = 1.4.
    //   commonAmount = max(0, 10 - 1 - 1.4) * (1+0) = 7.6.
    // uncommonMaterial staying at the UNSCALED baseline of 1 (not affected by rareYieldMult)
    // is exactly what proves rareYieldMult only scales rare's own tier.
    const rng = () => 0.0005;
    const { captain } = tickCaptainMission(1, base, rng, { rareYieldMult: 0.4 });
    expect(captain.mission!.cargo.uncommonMaterial).toBe(1);
    expect(captain.mission!.cargo.rareMaterial).toBe(1.4);
    expect(captain.mission!.cargo.commonOre).toBe(7.6);
  });

  it("uncommonChanceMult shifts a borderline rng value across the uncommon occurrence threshold", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain("longOreRun"), phase: "extracting", phaseProgressTicks: 0 };
    // longOreRun: uncommonChance 0.08, rareChance 0.02. A constant rng of 0.1 is used for
    // EVERY call (occurrence AND amount-roll, when reached).
    // Unboosted: call 1 (uncommon occurrence) 0.1 < 0.08? no -> uncommon does NOT occur,
    //   so there's no amount-roll call (that call only happens conditionally, inside the
    //   occurrence check's if-block) -- the VERY NEXT rng() call is call 2, rare
    //   occurrence: 0.1 < 0.02? no -> rare does NOT occur either.
    //   commonAmount = max(0, 10-0-0)*(1+0) = 10.
    const fixedRoll = () => 0.1;
    const unboosted = tickCaptainMission(1, base, fixedRoll);
    expect(unboosted.captain.mission!.cargo.commonOre).toBe(10);
    expect(unboosted.captain.mission!.cargo.uncommonMaterial).toBe(0);

    // Boosted: effectiveUncommonChance = 0.08 * (1 + 1) = 0.16. call 1: 0.1 < 0.16 -> true,
    //   uncommon occurs. call 2 (amount roll): 0.1 < 0.75 -> baseAmount 1 -> uncommonAmount
    //   = 1 * (1+0) = 1 (uncommonYieldMult defaults to 0). call 3 (rare occurrence):
    //   rareChanceMult is NOT set on this call, so effectiveRareChance stays 0.02 ->
    //   0.1 < 0.02? no -> rare does NOT occur. commonAmount = max(0, 10-1-0)*(1+0) = 9.
    // Same rng() value throughout, different outcome, purely because uncommonChanceMult
    // pushed the effective chance past 0.1.
    const boosted = tickCaptainMission(1, base, fixedRoll, { uncommonChanceMult: 1 });
    expect(boosted.captain.mission!.cargo.uncommonMaterial).toBe(1);
    expect(boosted.captain.mission!.cargo.commonOre).toBe(9);
  });

  it("rareChanceMult shifts a borderline rng value across the rare occurrence threshold", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain("longOreRun"), phase: "extracting", phaseProgressTicks: 0 };
    // longOreRun: uncommonChance 0.08, rareChance 0.02. A constant rng of 0.09 is used for
    // EVERY call. 0.09 >= 0.08 fails the uncommon occurrence check in BOTH the unboosted and
    // boosted case below (uncommonChanceMult is never set on either call), so uncommon never
    // occurs either way -- this isolates the rare-tier effect cleanly.
    // Unboosted: call 1 (uncommon occurrence) 0.09 < 0.08? no. call 2 (rare occurrence)
    //   0.09 < 0.02? no -> rare does NOT occur. commonAmount = max(0, 10-0-0)*(1+0) = 10.
    const fixedRoll = () => 0.09;
    const unboosted = tickCaptainMission(1, base, fixedRoll);
    expect(unboosted.captain.mission!.cargo.rareMaterial).toBe(0);
    expect(unboosted.captain.mission!.cargo.commonOre).toBe(10);

    // Boosted: effectiveRareChance = 0.02 * (1 + 4) = 0.1. call 1 (uncommon occurrence):
    //   0.09 < 0.08? no -> uncommon does NOT occur (unaffected -- rareChanceMult doesn't
    //   touch uncommonChance). call 2 (rare occurrence): 0.09 < 0.1 -> true, rare occurs ->
    //   rareAmount = 1 * (1+0) = 1 (rareYieldMult defaults to 0 on this call).
    //   commonAmount = max(0, 10-0-1)*(1+0) = 9.
    const boosted = tickCaptainMission(1, base, fixedRoll, { rareChanceMult: 4 });
    expect(boosted.captain.mission!.cargo.rareMaterial).toBe(1);
    expect(boosted.captain.mission!.cargo.commonOre).toBe(9);
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
    base.mission.cargo = { commonOre: 90, uncommonMaterial: 8, rareMaterial: 2 };
    const { captain, homePlanetDelta } = tickCaptainMission(1, base, ALWAYS_MIN_ROLL); // 1 tick completes unloadTicks=1

    expect(homePlanetDelta).toEqual({ commonOre: 90, uncommonMaterial: 8, rareMaterial: 2 });
    expect(captain.mission!.phase).toBe("ordersReceived"); // auto-repeated
    expect(captain.mission!.phaseProgressTicks).toBe(0);
    expect(captain.mission!.cargo).toEqual({ commonOre: 0, uncommonMaterial: 0, rareMaterial: 0 }); // reset
    expect(captain.mission!.recalled).toBe(false);
  });

  it("completing a full cycle WHILE recalled ends the mission (mission becomes null)", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain(), phase: "unloading", phaseProgressTicks: 0, recalled: true };
    base.mission.cargo = { commonOre: 50, uncommonMaterial: 0, rareMaterial: 0 };
    const { captain, homePlanetDelta } = tickCaptainMission(1, base, ALWAYS_MIN_ROLL);

    expect(homePlanetDelta).toEqual({ commonOre: 50, uncommonMaterial: 0, rareMaterial: 0 });
    expect(captain.mission).toBe(null);
  });

  it("a big jump can complete multiple full auto-repeat cycles, accumulating homePlanetDelta across all of them", () => {
    const base = freshCaptains(1)[0];
    base.mission = missionCaptain(); // shortOreRun, 18 ticks/cycle
    const { captain, homePlanetDelta } = tickCaptainMission(36, base, ALWAYS_MIN_ROLL); // exactly 2 full cycles

    // Each cycle's extracting phase is 10 whole-tick rolls (cargoCapacity 100 / rate 10).
    // Under ALWAYS_MIN_ROLL (rng() constant 0), EVERY roll delivers commonOre 8,
    // uncommonMaterial 1, rareMaterial 1 (see the "both tiers occur, minimum amounts"
    // hand-trace above) -- NOT pure commonOre, unlike the old mutually-exclusive
    // mechanism this replaced. Per cycle: 10 rolls * {8, 1, 1} = {80, 10, 10}.
    // 2 cycles = {160, 20, 20}.
    expect(homePlanetDelta).toEqual({ commonOre: 160, uncommonMaterial: 20, rareMaterial: 20 });
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
    expect(captain.xp).toBe(0);
    expect(captain.level).toBe(1);
  });

  it("awards XP once when exactly one cycle completes", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain(), phase: "unloading", phaseProgressTicks: 0 };
    const { captain } = tickCaptainMission(1, base, ALWAYS_MIN_ROLL); // 1 tick completes unloadTicks=1
    expect(captain.xp).toBe(50);
    expect(captain.level).toBe(1); // 50 < xpForNextLevel(1)=100, no level-up yet
  });

  it("levels up and grants a stat point when accumulated XP crosses the threshold", () => {
    const base = freshCaptains(1)[0];
    base.mission = { ...missionCaptain(), phase: "unloading", phaseProgressTicks: 0 };
    base.xp = 60; // + this cycle's 50 = 110, crosses xpForNextLevel(1)=100
    const { captain } = tickCaptainMission(1, base, ALWAYS_MIN_ROLL);
    expect(captain.level).toBe(2);
    expect(captain.xp).toBe(10); // 110 - 100
    expect(captain.statPoints).toBe(1);
  });

  it("a big jump completing multiple cycles awards XP for EACH cycle, resolving multiple level-ups if crossed", () => {
    const base = freshCaptains(1)[0];
    base.mission = missionCaptain(); // shortOreRun, 18 ticks/cycle
    const { captain } = tickCaptainMission(36, base, ALWAYS_MIN_ROLL); // exactly 2 full cycles -> 2 * 50 = 100 XP
    expect(captain.xp).toBe(0); // 100 XP exactly hits xpForNextLevel(1)=100 -> levels to 2 with 0 leftover
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
      cargo: { commonOre: 0, uncommonMaterial: 0, rareMaterial: 0 },
      recalled: false,
    };
    const result = tick(10, state);
    expect(result.gameTimeSeconds).toBe(10);
  });

  it("mission loot aggregates across all captains on missions into state.homePlanet.storage in one tick() call", () => {
    // Hand-traced against tickCaptainMission's CURRENT implementation (tick.ts):
    //
    // Captain 0: phase "extracting", phaseProgressTicks: 0. state.tickDurationSeconds=10, deltaSeconds=10
    // -> ticksElapsed = 1. requiredTicks for "extracting" (shortOreRun) = ceil(100/10) = 10.
    // ticksLeftInPhase = 10 - 0 = 10; ticksToApply = min(1, 10) = 1. Epsilon-snap check:
    // |0 + 1 - 10| = 9, not < 1e-9, so ticksToApply stays 1. fromWhole = floor(0) = 0,
    // toWhole = floor(0+1) = 1 -> 1 loot roll, cargo gains 10 units (some tier, rng-dependent).
    // phaseProgressTicks becomes 1, remaining becomes 0. 1 < 10, so phase does NOT complete this
    // tick -- captain 0 stays in "extracting", nothing delivered to homePlanetDelta.
    //
    // Captain 1: phase "extracting", phaseProgressTicks: 9, cargo.commonOre: 90 (pre-seeded, as if
    // 9 prior whole-tick rolls all landed commonOre). Same ticksElapsed = 1. ticksLeftInPhase =
    // 10 - 9 = 1; ticksToApply = min(1, 1) = 1. Epsilon-snap check: |9 + 1 - 10| = 0 < 1e-9 -- true,
    // so ticksToApply recomputed as 10 - 9 = 1 (unchanged, no drift here since these are whole
    // numbers). fromWhole = floor(9) = 9, toWhole = floor(9+1) = 10 -> 1 loot roll, cargo.commonOre
    // becomes 100. phaseProgressTicks becomes 10, which equals requiredTicks (10) -- extracting
    // phase COMPLETES. MISSION_PHASE_ORDER.indexOf("extracting") = 2, nextIndex = 3 ->
    // "transitBack" (not the last phase, "unloading"), so captain 1 advances to "transitBack" with
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
      cargo: { commonOre: 0, uncommonMaterial: 0, rareMaterial: 0 },
      recalled: false,
    };
    state.captains[1].mission = {
      missionKey: "shortOreRun",
      phase: "extracting",
      phaseProgressTicks: 9,
      cargo: { commonOre: 90, uncommonMaterial: 0, rareMaterial: 0 },
      recalled: false,
    };

    const result = tick(10, state);

    // Captain 0 gained exactly 1 roll's worth (10 units, tier rng-dependent) of onboard cargo.
    const cap0CargoTotal =
      result.captains[0].mission!.cargo.commonOre +
      result.captains[0].mission!.cargo.uncommonMaterial +
      result.captains[0].mission!.cargo.rareMaterial;
    expect(cap0CargoTotal).toBe(10);
    expect(result.captains[0].mission!.phase).toBe("extracting");

    // Captain 1 completed extracting (10/10 ticks), advanced to transitBack, final cargo 100 --
    // asserted as a tier-agnostic total since the final roll's tier is rng-dependent (unmocked
    // Math.random here, same reasoning as captain 0's total check above).
    const cap1CargoTotal =
      result.captains[1].mission!.cargo.commonOre +
      result.captains[1].mission!.cargo.uncommonMaterial +
      result.captains[1].mission!.cargo.rareMaterial;
    expect(cap1CargoTotal).toBe(100);
    expect(result.captains[1].mission!.phase).toBe("transitBack");
    expect(result.captains[1].mission!.phaseProgressTicks).toBe(0);

    // Neither captain reached "unloading" this tick -- nothing delivered home yet.
    // Full 5-key shape (Task 5 widened homePlanet.storage to include the crafted-good
    // tiers) since tick() spreads the existing storage forward untouched -- a 3-key
    // expected literal would fail toEqual's strict key-set comparison against the
    // actual 5-key result, even though every value is still correctly 0.
    expect(result.homePlanet.storage).toEqual({
      commonOre: 0,
      uncommonMaterial: 0,
      rareMaterial: 0,
      refinedMaterial: 0,
      components: 0,
    });
  });

  it("delivers cargo to state.homePlanet.storage, added to existing totals, when a mission's cycle completes this tick", () => {
    // Hand-traced: phase "unloading" with unloadTicks=1 (shortOreRun), phaseProgressTicks: 0.
    // deltaSeconds=10, state.tickDurationSeconds=10 -> ticksElapsed=1. requiredTicks("unloading")=1.
    // ticksLeftInPhase = 1 - 0 = 1; ticksToApply = min(1,1) = 1. Not "extracting", so no loot roll
    // in this step. phaseProgressTicks becomes 1, remaining becomes 0. 1 >= requiredTicks(1) ->
    // phase completes. MISSION_PHASE_ORDER.indexOf("unloading") = 4 (last), nextIndex = 5 >=
    // length(5) -- cycle complete: cargo {commonOre:70, uncommonMaterial:20, rareMaterial:10} is
    // added to homePlanetDelta, then (recalled: false) mission auto-repeats to "ordersReceived"
    // with phaseProgressTicks 0 and fresh empty cargo.
    //
    // state.homePlanet.storage starts pre-seeded at {commonOre:5, uncommonMaterial:1, rareMaterial:0}
    // (simulating a PRIOR delivery already sitting in storage) to prove this tick's delta is ADDED
    // to existing totals, not overwriting them: expected result = {75, 21, 10}.
    const state = freshState();
    state.homePlanet.storage = { commonOre: 5, uncommonMaterial: 1, rareMaterial: 0, refinedMaterial: 0, components: 0 };
    state.captains[0].mission = {
      missionKey: "shortOreRun",
      phase: "unloading",
      phaseProgressTicks: 0,
      cargo: { commonOre: 70, uncommonMaterial: 20, rareMaterial: 10 },
      recalled: false,
    };

    const result = tick(10, state);

    expect(result.homePlanet.storage).toEqual({
      commonOre: 75,
      uncommonMaterial: 21,
      rareMaterial: 10,
      refinedMaterial: 0,
      components: 0,
    });
    expect(result.captains[0].mission!.phase).toBe("ordersReceived"); // auto-repeated
    expect(result.captains[0].mission!.phaseProgressTicks).toBe(0);
    expect(result.captains[0].mission!.cargo).toEqual({ commonOre: 0, uncommonMaterial: 0, rareMaterial: 0 });
  });
});

describe("tick() — Homeworld/Captain Talent effects wired into extraction and passive production", () => {
  // IMPORTANT (2026-07-07 Loot Tier Rework): under the OLD mechanism, the single
  // extractionYieldMult effect scaled the ENTIRE per-roll amount, so the total units
  // delivered per tick genuinely changed with the bonus -- a "total delivered" assertion
  // was a valid, deterministic way to test it even with tick()'s unmockable Math.random.
  // Under the NEW mechanism this is NO LONGER true for uncommonYieldMult/rareYieldMult:
  // rollExtractionTick computes commonAmount = max(0, extractionRatePerTick - uncommonAmount
  // - rareAmount) * (1 + commonYieldMult) -- whatever gets carved out for uncommon/rare
  // (yield-scaled or not) is SUBTRACTED from extractionRatePerTick before being added back
  // in, so total = extractionRatePerTick * (1 + commonYieldMult) EXACTLY, independent of
  // uncommonYieldMult/rareYieldMult (hand-verify: base rate 10, uncommon rolls amount 2
  // scaled by +50% to 3, rare doesn't occur -> common = 10-3-0 = 7, total = 7+3+0 = 10,
  // same as if uncommonYieldMult were 0). ONLY commonYieldMult (Captain Talent only, per
  // Task 1 -- no Homeworld Talent produces it) changes the deterministic total. So:
  // - The "total delivered" pattern below is used ONLY for commonYieldMult (Captain Talent).
  // - fleetLogisticsYield/rareYieldMult (Homeworld Talent) wiring is instead verified via
  //   the composition-invariant test further below, which holds regardless of which tier's
  //   occurrence rng fires and is unaffected by this same total-conservation property.
  //
  // CORRECTNESS NOTE on the two commonYieldMult tests below: the "total = rate * (1 +
  // commonYieldMult) EXACTLY" identity only holds when commonYieldMult is 0 (see the
  // general formula: total = rate*(1+commonYieldMult) - k*commonYieldMult, where k is
  // the carved-out uncommon+rare amount for that roll). With commonYieldMult=0.1 and an
  // uncontrolled real Math.random(), shortOreRun's tiny but nonzero uncommonChance/
  // rareChance (0.019/0.001) mean k > 0 on ~2% of rolls, which would make these two
  // tests spuriously fail toBeCloseTo(11, 6) roughly 1 run in 50. Math.random is mocked
  // to a fixed 0.5 (same value as this file's NOTHING_OCCURS constant, which fails both
  // occurrence checks for shortOreRun) to force k=0 and make the total genuinely
  // deterministic, matching what the assertion actually claims.
  it("commandExtractionI (Captain Talent, commonYieldMult) boosts a mission captain's extraction via tick()", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const state = freshState();
      state.captains[0].unlockedCaptainTalents = ["commandExtractionI"]; // +0.1 commonYieldMult
      state.captains[0].mission = { ...missionCaptain(), phase: "extracting", phaseProgressTicks: 0 };

      const result = tick(10, state); // tickDurationSeconds=10 -> ticksElapsed=1 -> 1 roll

      // Math.random mocked to 0.5 forces k=0 (neither tier occurs, see the note above),
      // making commonYieldMult scale the total deterministically: extractionRatePerTick
      // 10 * (1 + 0.1) = 11.
      const totalDelivered =
        result.captains[0].mission!.cargo.commonOre +
        result.captains[0].mission!.cargo.uncommonMaterial +
        result.captains[0].mission!.cargo.rareMaterial;
      expect(totalDelivered).toBeCloseTo(11, 6);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it("fleetLogisticsYield (Homeworld Talent, rareYieldMult) is wired through tick() without breaking the per-tick total invariant", () => {
    const state = freshState();
    state.unlockedHomeworldTalents = ["fleetLogisticsYield"]; // +0.05 rareYieldMult, fleet-wide
    state.captains[0].mission = { ...missionCaptain(), phase: "extracting", phaseProgressTicks: 0 };

    const result = tick(10, state); // 1 roll, real Math.random -- which tier occurs is rng-dependent

    // rareYieldMult only rescales rare's OWN rolled amount (when rare actually occurs
    // this roll) -- it does NOT change the deterministic per-tick total (see this
    // describe block's opening comment for the algebraic proof). So the only thing
    // provably assertable here without an rng override is that the total invariant
    // still holds with fleetLogisticsYield unlocked and wired in -- proving tick()
    // is correctly building the bonuses object and passing it through (a broken
    // wiring that fed rareYieldMult into commonYieldMult BY MISTAKE, for example,
    // would break this exact invariant, since commonYieldMult IS the one bonus that
    // changes the total).
    const totalDelivered =
      result.captains[0].mission!.cargo.commonOre +
      result.captains[0].mission!.cargo.uncommonMaterial +
      result.captains[0].mission!.cargo.rareMaterial;
    expect(totalDelivered).toBeCloseTo(10, 6); // extractionRatePerTick unmodified (commonYieldMult is 0 here)
  });

  it("commandExtractionI (Captain Talent) and a Homeworld Talent's rareYieldMult both wire through tick() without interfering with each other", () => {
    // Math.random mocked to 0.5 for the same reason as the commonYieldMult-only test
    // above: k must be forced to 0 for the total to be provably deterministic (see the
    // correctness note above this describe block's first commonYieldMult test).
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const state = freshState();
      state.unlockedHomeworldTalents = ["fleetLogisticsYield"]; // +0.05 rareYieldMult (does not affect total)
      state.captains[0].unlockedCaptainTalents = ["commandExtractionI"]; // +0.1 commonYieldMult (does affect total)
      state.captains[0].mission = { ...missionCaptain(), phase: "extracting", phaseProgressTicks: 0 };

      const result = tick(10, state);

      // Total delivered is governed ONLY by commonYieldMult (see this describe block's
      // opening comment) -- rareYieldMult being simultaneously active must not change
      // this number: extractionRatePerTick 10 * (1 + 0.1) = 11, same as the
      // commonYieldMult-only test above, proving the two bonus types don't cross-
      // contaminate each other when both are wired through tick() at once.
      const totalDelivered =
        result.captains[0].mission!.cargo.commonOre +
        result.captains[0].mission!.cargo.uncommonMaterial +
        result.captains[0].mission!.cargo.rareMaterial;
      expect(totalDelivered).toBeCloseTo(11, 6);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it("passiveTrickle (Homeworld Talent economyTrickle) adds material even with every captain idle", () => {
    const state = freshState();
    state.unlockedHomeworldTalents = ["economyTrickle"]; // commonOre, perTick: 1
    // freshState's single captain is idle (mission: null) by default -- no mission math
    // should run at all, isolating this test to the passive-trickle path.

    const result = tick(10, state); // ticksElapsed = 10/10 = 1 -> 1 * perTick(1) = 1

    expect(result.homePlanet.storage.commonOre).toBe(1);
  });

  it("passiveTrickle scales linearly with ticksElapsed (closed-form, not a per-tick loop)", () => {
    const state = freshState();
    state.unlockedHomeworldTalents = ["economyTrickle"];

    const result = tick(35, state); // ticksElapsed = 35/10 = 3.5 -> 3.5 * 1 = 3.5

    expect(result.homePlanet.storage.commonOre).toBeCloseTo(3.5, 6);
  });

  it("with no unlocked Homeworld Talents, extraction and passive production are unaffected (regression guard)", () => {
    const state = freshState();
    state.captains[0].mission = { ...missionCaptain(), phase: "extracting", phaseProgressTicks: 0 };

    const result = tick(10, state);

    const totalDelivered =
      result.captains[0].mission!.cargo.commonOre +
      result.captains[0].mission!.cargo.uncommonMaterial +
      result.captains[0].mission!.cargo.rareMaterial;
    expect(totalDelivered).toBe(10); // unmodified extractionRatePerTick, exactly one roll
    expect(result.homePlanet.storage.commonOre).toBe(0); // no passive trickle
  });
});

describe("dispatchCaptainOnMission", () => {
  it("dispatches an idle captain, setting their initial mission state exactly", () => {
    const state = freshState(); // captains[0].mission is null (idle)
    const { next, success } = dispatchCaptainOnMission(state, 1, "shortOreRun");

    expect(success).toBe(true);
    expect(next.captains[0].mission).toEqual({
      missionKey: "shortOreRun",
      phase: "ordersReceived",
      phaseProgressTicks: 0,
      cargo: { commonOre: 0, uncommonMaterial: 0, rareMaterial: 0 },
      recalled: false,
    });
  });

  it("leaves the rest of the captain and the rest of state untouched", () => {
    // Setup uses xp/level/statPoints (the current CaptainState fields) rather than the
    // removed Generator-Stack fields (modules/resources/augmentPoints) this test used
    // pre-Phase-4 -- same intent (prove dispatchCaptainOnMission only touches `mission`),
    // updated to the post-Task-2 CaptainState/GameState shape.
    const state = freshState();
    state.captains[0].level = 4;
    state.captains[0].xp = 250;
    state.captains[0].statPoints = 3;
    state.homePlanet.storage.commonOre = 42;

    const { next } = dispatchCaptainOnMission(state, 1, "shortOreRun");
    expect(next.captains[0].level).toBe(4);
    expect(next.captains[0].xp).toBe(250);
    expect(next.captains[0].statPoints).toBe(3);
    expect(next.homePlanet.storage.commonOre).toBe(42);
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
      cargo: { commonOre: 40, uncommonMaterial: 5, rareMaterial: 0 },
      recalled: false,
    };

    const { next, success } = recallCaptain(state, 1);
    expect(success).toBe(true);
    expect(next.captains[0].mission).toEqual({
      missionKey: "shortOreRun",
      phase: "extracting",
      phaseProgressTicks: 4.5,
      cargo: { commonOre: 40, uncommonMaterial: 5, rareMaterial: 0 },
      recalled: true, // only this field flips
    });
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
    state.homePlanet.storage.commonOre = 25;
    const { next, success } = craftRecipe(state, "refineUnobtainium");
    expect(success).toBe(true);
    expect(next.homePlanet.storage.commonOre).toBe(15);
    expect(next.homePlanet.storage.refinedMaterial).toBe(1);
  });

  it("fails (same state reference) when inputs are insufficient", () => {
    const state = freshState(); // commonOre: 0
    const { next, success } = craftRecipe(state, "refineUnobtainium");
    expect(success).toBe(false);
    expect(next).toBe(state);
  });

  it("supports multi-input recipes, deducting every input listed", () => {
    const state = freshState();
    state.homePlanet.storage.refinedMaterial = 12;
    const { next, success } = craftRecipe(state, "fabricateComponents");
    expect(success).toBe(true);
    expect(next.homePlanet.storage.refinedMaterial).toBe(7);
    expect(next.homePlanet.storage.components).toBe(1);
  });

  it("recipeBonusOutput (Homeworld Talent) adds a FLAT bonus to the matching recipe's output, not a multiplier", () => {
    const state = freshState();
    state.unlockedHomeworldTalents = ["industryBonusOutput"]; // recipeKey: fabricateComponents, bonus: 1
    state.homePlanet.storage.refinedMaterial = 5;
    const { next, success } = craftRecipe(state, "fabricateComponents");
    expect(success).toBe(true);
    expect(next.homePlanet.storage.components).toBe(2); // base output 1 + flat bonus 1
  });

  it("recipeBonusOutput does NOT apply to a different recipe than the one it names", () => {
    const state = freshState();
    state.unlockedHomeworldTalents = ["industryBonusOutput"]; // targets fabricateComponents only
    state.homePlanet.storage.commonOre = 10;
    const { next, success } = craftRecipe(state, "refineUnobtainium");
    expect(success).toBe(true);
    expect(next.homePlanet.storage.refinedMaterial).toBe(1); // unmodified base output
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
    expect(result.fleetAdminXp).toBe(100);
    expect(result.fleetAdminLevel).toBe(1);
    expect(result.adminPoints).toBe(0);
  });

  it("resolves exactly one level-up and carries the remainder forward, mirroring captain XP's subtract-and-carry shape", () => {
    // xpForNextFleetAdminLevel(1) = 2500. Starting fleetAdminXp at 2000, delta
    // 600 -> xp = 2600. 2600 >= 2500 -> level 2, xp -= 2500 -> xp = 100.
    // xpForNextFleetAdminLevel(2) = 2500*4 = 10000. 100 >= 10000? No -- loop stops.
    const state = freshState();
    state.fleetAdminXp = 2000;
    const result = applyFleetAdminXp(state, 600);
    expect(result.fleetAdminLevel).toBe(2);
    expect(result.fleetAdminXp).toBe(100);
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
    expect(result.fleetAdminXp).toBe(500);
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
    // be left over.
    expect(result.fleetAdminXp).toBeGreaterThan(0);
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
    expect(afterSecondCall.fleetAdminXp).toBeLessThan(backloggedXp);
  });
});
