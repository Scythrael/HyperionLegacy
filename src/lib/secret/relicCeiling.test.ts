// relicCeiling.test.ts: 0.14.0 prestige redesign Slice 5a, the relic ceiling (design 3.5 and 3.6; user 2026-10-27:
// "All of the bonuses that the relics provide to the minigame will all combine together to be equivalent to a 2.5x
// increase when reaching the asymptotic limit"; 2026-10-29: near the limit at a full Tier VII collection). Every one
// of the 17 types counts; the combined fraction is 0 relic-free, rises with every copy, never reaches 1; the plateau
// (where the climb past e10,000,000 bends) is e10,000,000 x (1 + 1.5 F); the e25,000,000 prize stays "???".
import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import { freshSecretState, type SecretState } from "./state";
import { relicCeilingFraction as fractionOf, relicBoostsFromWeighted, relicWeightedCopies, relicBoostsFromMuseum } from "./relicBoosts";
import { relicCeilingFraction, relicPlateau, effectiveExponent, stateExponent, checkMilestonesMut, milestoneVisible, pow10, unsoftenExponent } from "./engine";
import { RELIC_BOOSTS, RELIC_CEILING_MULT, RELIC_CEILING_AT_FULL_TIER_VII, STARFALL_EXPONENT, SECRET_PRIZE_EXPONENT, E20M_EXPONENT, MILESTONES, HELP_SECTIONS, milestoneAchievement } from "./config";
import { typicalMuseum, heavyMuseum, fullTierSevenMuseum, fullTierSevenBoosts, typicalBoosts, heavyBoosts } from "./relicCollections";
import { RELIC_TYPE_FIRST_TIER } from "../game/relics";
import { report } from "./testReport";

const each = (n: number): Record<string, number> => Object.fromEntries(RELIC_BOOSTS.map((d) => [d.relicId, n]));

describe("the combined relic fraction", () => {
  it("is 0 with no relics, rises with every type's copies, and never reaches 1", () => {
    expect(fractionOf({})).toBe(0);
    for (const d of RELIC_BOOSTS) {
      let last = fractionOf({});
      for (const n of [1, 10, 100, 1000, 1e5, 1e9]) {
        const f = fractionOf({ [d.relicId]: n });
        expect(f, `${d.relicId} at ${n}`).toBeGreaterThan(last);
        last = f;
      }
    }
    expect(fractionOf(each(1e12))).toBeLessThan(1);
  });

  it("all 17 types count, each the same share of the whole", () => {
    expect(RELIC_BOOSTS.length).toBe(17);
    for (const d of RELIC_BOOSTS) expect(fractionOf({ [d.relicId]: 1e15 }), d.relicId).toBeCloseTo(1 / 17, 6);
  });

  it("sits near the limit at a full Tier VII collection, and right on it at 10,000 of every type", () => {
    const full = fractionOf(relicWeightedCopies(fullTierSevenMuseum()));
    expect(full).toBeCloseTo(RELIC_CEILING_AT_FULL_TIER_VII, 2);
    expect(fractionOf(each(10000))).toBeGreaterThan(0.99);
  });

  it("is snapshotted with the levers, and a snapshot with more copies never has a lower plateau (Review Focus 5)", () => {
    const small = relicBoostsFromWeighted(each(10))!;
    const big = relicBoostsFromWeighted(each(100))!;
    expect(small.ceiling).toBeGreaterThan(0);
    expect(big.ceiling!).toBeGreaterThan(small.ceiling!);
    const a = freshSecretState(0);
    const b = freshSecretState(0);
    a.relicBoosts = small;
    b.relicBoosts = big;
    expect(relicPlateau(b)).toBeGreaterThan(relicPlateau(a));
  });
});

describe("the plateau", () => {
  it("is exactly e10,000,000 relic-free, the very same arithmetic", () => {
    const s = freshSecretState(0);
    expect(relicCeilingFraction(s)).toBe(0);
    expect(relicPlateau(s)).toBe(STARFALL_EXPONENT);
    for (const e of [5e6, 1e7, 1.2e7, 3e7]) {
      const raw = pow10(unsoftenExponent(e));
      expect(stateExponent(s, raw)).toBe(effectiveExponent(raw));
    }
  });

  it("moves the bend past e10,000,000 up to e25,000,000 at the limit, and nothing at or below e10,000,000", () => {
    const s = freshSecretState(0);
    s.relicBoosts = fullTierSevenBoosts();
    const plateau = relicPlateau(s);
    expect(plateau).toBeCloseTo(STARFALL_EXPONENT * (1 + (RELIC_CEILING_MULT - 1) * relicCeilingFraction(s)), 6);
    expect(plateau).toBeLessThan(STARFALL_EXPONENT * RELIC_CEILING_MULT);
    for (const e of [1e6, 9e6, 1e7]) {
      const raw = pow10(unsoftenExponent(e));
      expect(stateExponent(s, raw)).toBeCloseTo(effectiveExponent(raw), 6);
    }
    // past e10,000,000 the same raw Ore is worth more, up to the plateau where the bend starts
    const raw = pow10(unsoftenExponent(1.5e7, plateau));
    expect(stateExponent(s, raw)).toBeCloseTo(1.5e7, 3);
    expect(effectiveExponent(raw)).toBeLessThan(1.5e7);
  });

  it("the plateau table (reported)", () => {
    const row = (label: string, boosts: SecretState["relicBoosts"]) => {
      const s = freshSecretState(0);
      s.relicBoosts = boosts;
      report(`[ceiling] ${label}: F ${relicCeilingFraction(s).toFixed(4)}, plateau e${Math.round(relicPlateau(s)).toLocaleString("en-US")}`);
    };
    row("relic-free", undefined);
    row("typical", typicalBoosts());
    row("heavy", heavyBoosts());
    row("full Tier VII", fullTierSevenBoosts());
    row("10,000 of every type", relicBoostsFromWeighted(each(10000)));
    row("the limit", relicBoostsFromWeighted(each(1e15)));
  });
});

describe("the collections follow the tier stagger", () => {
  const types = (m: ReturnType<typeof typicalMuseum>) => Object.keys(relicWeightedCopies(m));
  it("a typical Tier I collection holds only the four Tier I types; the heavy one only types open by Tier III", () => {
    expect(types(typicalMuseum()).sort()).toEqual(Object.keys(RELIC_TYPE_FIRST_TIER).filter((id) => RELIC_TYPE_FIRST_TIER[id] === 1).sort());
    for (const id of types(heavyMuseum())) expect(RELIC_TYPE_FIRST_TIER[id], id).toBeLessThanOrEqual(3);
    expect(types(fullTierSevenMuseum()).length).toBe(17);
    expect(relicBoostsFromMuseum(typicalMuseum())!.ceiling).toBeGreaterThan(0);
  });
});

describe("the late milestones (design 3.5)", () => {
  it("e20,000,000 shows after e10,000,000; the e25,000,000 prize stays ??? in every view until reached", () => {
    const s = freshSecretState(0);
    s.milestones.starfall = 1;
    expect(milestoneVisible(s, "e20m")).toBe(true);
    s.milestones.e20m = 2;
    expect(milestoneVisible(s, "e25m")).toBe(false);
    const prize = MILESTONES.find((m) => m.id === "e25m")!;
    expect(prize.secret).toBe(true);
    expect(prize.rewardHook).toBe("fasterThanLight");
    s.bestOre = pow10(unsoftenExponent(SECRET_PRIZE_EXPONENT, relicPlateau(s)) + 1);
    s.relicBoosts = undefined;
    const t: SecretState = { ...s, bestOre: new Decimal(0).add(pow10(unsoftenExponent(SECRET_PRIZE_EXPONENT) + 1)) };
    checkMilestonesMut(t, 3);
    expect(t.milestones.e25m).toBe(3);
    expect(milestoneVisible(t, "e25m")).toBe(true);
    expect(milestoneAchievement("e25m").title).toBe(prize.name);
    expect(E20M_EXPONENT).toBe(20000000);
  });

  it("Help never hints at the prize", () => {
    for (const h of HELP_SECTIONS) {
      expect(h.body).not.toMatch(/25,000,000|e25|Faster Than Light|warp/i);
    }
  });
});
