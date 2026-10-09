import { describe, it, expect } from "vitest";
import {
  SENIOR_STAFF_BONUSES,
  seniorStaffBonusesForSeat,
  getSeniorStaffBonusById,
  OFFICER_BONUS_TIER_WEIGHTS,
  bonusRollWeight,
} from "./seniorStaffBonuses";
import type { SeniorStaffSeat } from "./model";

const SEATS: SeniorStaffSeat[] = [
  "executive",
  "pilot",
  "operations",
  "science",
  "tactical",
  "medical",
  "engineering",
];

describe("seniorStaffBonuses: catalog", () => {
  it("has globally unique ids", () => {
    const ids = SENIOR_STAFF_BONUSES.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every bonus a positive magnitude, a stat key, a label, and a description", () => {
    for (const b of SENIOR_STAFF_BONUSES) {
      expect(b.magnitude).toBeGreaterThan(0);
      expect(b.statKey.length).toBeGreaterThan(0);
      expect(b.label.length).toBeGreaterThan(0);
      expect(b.description.length).toBeGreaterThan(0);
    }
  });

  it("uses larger sweeping magnitudes than the tiny per-head complement buffs (>= 0.04)", () => {
    for (const b of SENIOR_STAFF_BONUSES) {
      expect(b.magnitude).toBeGreaterThanOrEqual(0.04);
    }
  });
});

describe("seniorStaffBonuses: seat readers", () => {
  it("returns each seat's own bonuses plus the seat-agnostic 'any' ones", () => {
    const anyCount = SENIOR_STAFF_BONUSES.filter((b) => b.seat === "any").length;
    expect(anyCount).toBeGreaterThan(0);
    for (const seat of SEATS) {
      const rollable = seniorStaffBonusesForSeat(seat);
      expect(rollable.length).toBeGreaterThan(0);
      // Every returned bonus is either this seat's or an "any" bonus.
      for (const b of rollable) expect(b.seat === seat || b.seat === "any").toBe(true);
      // The "any" bonuses are always included.
      expect(rollable.filter((b) => b.seat === "any").length).toBe(anyCount);
    }
  });

  it("getSeniorStaffBonusById resolves a real id and returns undefined otherwise", () => {
    const first = SENIOR_STAFF_BONUSES[0];
    expect(getSeniorStaffBonusById(first.id)).toEqual(first);
    expect(getSeniorStaffBonusById("no.such.bonus")).toBeUndefined();
  });
});

// ===== E-CREW Task 19 (S4-C03): some officer bonuses roll far rarer than others =====
describe("seniorStaffBonuses: weighted roll tiers", () => {
  it("weights the four tiers common 6, uncommon 3, rare 2, very rare 1", () => {
    expect(OFFICER_BONUS_TIER_WEIGHTS).toEqual({ common: 6, uncommon: 3, rare: 2, veryRare: 1 });
  });

  it("assigns every bonus the tier from the Crew Made Real mockup (section 7 Roll column)", () => {
    const tiers = Object.fromEntries(SENIOR_STAFF_BONUSES.map((b) => [b.id, b.rollTier]));
    expect(tiers).toEqual({
      "xo.commandOutput": "rare",
      "xo.moraleAnchor": "uncommon",
      "pilot.transitCut": "common",
      "pilot.evasion": "uncommon",
      "ops.unloadSurge": "common",
      "ops.cargoExpand": "common",
      "sci.yieldSurge": "common",
      "sci.discovery": "rare",
      "tac.weaponCommand": "uncommon",
      "tac.shieldCommand": "uncommon",
      "med.fleetTriage": "uncommon",
      "med.recovery": "uncommon",
      "eng.overdrive": "uncommon",
      "eng.rangeMaster": "common",
      "any.inspiringLeader": "veryRare",
      "any.veteranInstincts": "rare",
    });
  });

  it("bonusRollWeight reads the tier weight", () => {
    expect(bonusRollWeight(getSeniorStaffBonusById("pilot.transitCut")!)).toBe(6);
    expect(bonusRollWeight(getSeniorStaffBonusById("pilot.evasion")!)).toBe(3);
    expect(bonusRollWeight(getSeniorStaffBonusById("any.veteranInstincts")!)).toBe(2);
    expect(bonusRollWeight(getSeniorStaffBonusById("any.inspiringLeader")!)).toBe(1);
  });
});
