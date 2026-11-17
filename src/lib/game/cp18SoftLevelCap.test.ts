// Complement CP-18 (the soft captain level cap, OC-23 "From level 30 (Recommended)"; plan
// docs/plans/2026-10-14-complement-and-acquisition-plan.md CP-18): the curve on both sides of the threshold, integer and
// Decimal safety at level 200, every consumer reading the one curve, an old save past the threshold, and parity across
// chunkings. The golden rows through the engine are cp18Goldens.test.ts.

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import { CAPTAIN_SOFT_CAP_GROWTH, CAPTAIN_SOFT_CAP_LEVEL, xpForNextLevel, type GameState } from "./model";
import { MAX_LEVEL_UPS_PER_TICK, foldXpLevelUps } from "./tick";
import { summarizeOfflineProgress } from "./offlineSummary";
import { captainCommandNotables } from "./captainNotables";
import { RETIRE_LEVEL_GATE, retireBlockReason, retireCaptain } from "./captainRetirement";
import { deserialize, migrate, serialize, SAVE_VERSION } from "./save";
import { HELP_TOPICS } from "../helpTopics";
import { CP18_BIG_AWARD_SECONDS, cp18BigAward, cp18Mission, threeCuts } from "./cp18Goldens.fixture";
import { cp16RetireReady } from "./cp16Goldens.fixture";
import { withoutCp18 } from "./cp18Switch.fixture";
import { WIRING_CAPTAIN_ID, captainOf, editCaptain, wiringBase } from "./wiring/probes";

// The curve's exact value: 300 * level * (27/25)^(level - 30), rounded half up, in whole numbers only.
function exactCost(level: number): bigint {
  const n = BigInt(level - CAPTAIN_SOFT_CAP_LEVEL);
  const num = 300n * BigInt(level) * 27n ** n;
  const den = 25n ** n;
  return (2n * num + den) / (2n * den);
}

describe("xpForNextLevel past the soft cap", () => {
  it("the agreed numbers", () => {
    expect(CAPTAIN_SOFT_CAP_LEVEL).toBe(30);
    expect(CAPTAIN_SOFT_CAP_GROWTH).toBe(1.08);
  });

  it("is 300 * level, byte for byte, up to and including the threshold", () => {
    for (let level = 1; level <= CAPTAIN_SOFT_CAP_LEVEL; level++) expect(xpForNextLevel(level)).toBe(300 * level);
    expect(xpForNextLevel(30)).toBe(9000);
  });

  it("past the threshold is 300 * level * 1.08^(level - 30): the real numbers, pinned", () => {
    expect(xpForNextLevel(31)).toBe(10044);
    expect(xpForNextLevel(40)).toBe(25907);
    expect(xpForNextLevel(50)).toBe(69914);
    expect(xpForNextLevel(100)).toBe(6558192);
    expect(xpForNextLevel(200)).toBe(28852914125);
  });

  it("the boundary is continuous: the threshold's cost is the plain curve's and the next is that level's plain cost x1.08", () => {
    expect(xpForNextLevel(CAPTAIN_SOFT_CAP_LEVEL + 1)).toBe(Math.round(300 * (CAPTAIN_SOFT_CAP_LEVEL + 1) * CAPTAIN_SOFT_CAP_GROWTH));
    expect(xpForNextLevel(CAPTAIN_SOFT_CAP_LEVEL + 1) / xpForNextLevel(CAPTAIN_SOFT_CAP_LEVEL)).toBeLessThan(1.15);
  });

  it("rises at every level, and never undercuts the old curve (so it can never grant a level the old one would not)", () => {
    for (let level = 1; level <= 400; level++) {
      expect(xpForNextLevel(level + 1)).toBeGreaterThan(xpForNextLevel(level));
      expect(xpForNextLevel(level)).toBeGreaterThanOrEqual(300 * level);
    }
  });

  it("is a safe whole number through level 266 and matches the exact rational there (no float exponent drift)", () => {
    for (let level = CAPTAIN_SOFT_CAP_LEVEL + 1; level <= 266; level++) {
      const cost = xpForNextLevel(level);
      expect(Number.isSafeInteger(cost), `level ${level}`).toBe(true);
      expect(BigInt(cost), `level ${level}`).toBe(exactCost(level));
    }
  });

  it("the same reading any number of times, in any order (the memo is invisible)", () => {
    const up = Array.from({ length: 300 }, (_, i) => xpForNextLevel(i + 1));
    const down = Array.from({ length: 300 }, (_, i) => xpForNextLevel(300 - i)).reverse();
    expect(down).toEqual(up);
  });

  it("never reaches Infinity or NaN: past what a double holds the price stays finite, so the level still comes (D23: no hard cap)", () => {
    for (const level of [1000, 5000, 9000, 9100, 20_000, 1e9, Number.MAX_SAFE_INTEGER]) {
      const cost = xpForNextLevel(level);
      expect(Number.isFinite(cost), `level ${level}`).toBe(true);
      expect(cost).toBeGreaterThan(0);
    }
    const past = 1e9;
    const up = foldXpLevelUps(new Decimal("1e400"), past, xpForNextLevel);
    expect(up.level).toBeGreaterThan(past);
    expect(up.levelUps).toBeLessThanOrEqual(MAX_LEVEL_UPS_PER_TICK);
  });
});

describe("the documented limits (model.ts xpForNextLevel ROUNDING, CEILING and PRECISION), pinned", () => {
  it("the last safe-integer cost is level 356 and the first Number.MAX_VALUE cost is level 9061", () => {
    let lastSafe = 0;
    let firstMax = 0;
    for (let level = CAPTAIN_SOFT_CAP_LEVEL + 1; level <= 10_000 && firstMax === 0; level++) {
      const cost = xpForNextLevel(level);
      if (Number.isSafeInteger(cost)) lastSafe = level;
      if (cost === Number.MAX_VALUE) firstMax = level;
    }
    expect(lastSafe).toBe(356);
    expect(firstMax).toBe(9061);
    expect(xpForNextLevel(9060)).toBeLessThan(Number.MAX_VALUE);
  });

  it("with whole XP an exact landing and one XP short hold through level 329, and first fail at 330", () => {
    const holds = (level: number) => {
      const cost = xpForNextLevel(level);
      const landed = foldXpLevelUps(new Decimal(cost), level, xpForNextLevel);
      const short = foldXpLevelUps(new Decimal(cost).minus(1), level, xpForNextLevel);
      return landed.level === level + 1 && landed.xp.eq(0) && short.level === level;
    };
    for (let level = CAPTAIN_SOFT_CAP_LEVEL + 1; level <= 329; level++) expect(holds(level), `level ${level}`).toBe(true);
    expect(holds(330)).toBe(false);
  });

  it("at the real x1.05 of one retirement, 1000 one-second awards and one lump agree to the byte through level 271; XP first drifts at 272 and the level first splits at 301", () => {
    const mult = 1.05;
    const cuts = (level: number) => {
      const start = new Decimal(xpForNextLevel(level)).minus(1050);
      let xp = start;
      let at = level;
      for (let i = 0; i < 1000; i++) {
        const up = foldXpLevelUps(xp.plus(new Decimal(1).times(1).times(mult)), at, xpForNextLevel);
        xp = up.xp;
        at = up.level;
      }
      const lump = foldXpLevelUps(start.plus(new Decimal(1).times(1000).times(mult)), level, xpForNextLevel);
      return { sameXp: xp.toString() === lump.xp.toString(), sameLevel: at === lump.level };
    };
    for (let level = CAPTAIN_SOFT_CAP_LEVEL + 1; level <= 271; level++) expect(cuts(level), `level ${level}`).toEqual({ sameXp: true, sameLevel: true });
    expect(cuts(272)).toEqual({ sameXp: false, sameLevel: true });
    for (let level = 272; level <= 300; level++) expect(cuts(level).sameLevel, `level ${level}`).toBe(true);
    expect(cuts(301).sameLevel).toBe(false);
  });
});

describe("Decimal XP at the size of the new costs", () => {
  it("through level 200 a stored XP exactly at the price levels up to zero left, and one XP short does not", () => {
    for (let level = CAPTAIN_SOFT_CAP_LEVEL + 1; level <= 200; level++) {
      const cost = xpForNextLevel(level);
      const landed = foldXpLevelUps(new Decimal(cost), level, xpForNextLevel);
      expect(landed.level, `level ${level}`).toBe(level + 1);
      expect(landed.xp.toNumber(), `level ${level}`).toBe(0);
      const short = foldXpLevelUps(new Decimal(cost - 1), level, xpForNextLevel);
      expect(short.level, `level ${level}`).toBe(level);
      // eq, not toNumber: Decimal's toNumber can show a last-digit float (a display read only; the fold compares Decimals).
      expect(short.xp.eq(cost - 1), `level ${level}`).toBe(true);
    }
  });

  it("at level 200 1 XP at a time and one lump land on the same bytes and level up on the same XP", () => {
    const cost = xpForNextLevel(200);
    const start = new Decimal(cost - 1000);
    let stepped = start;
    let level = 200;
    for (let i = 0; i < 1000; i++) {
      const up = foldXpLevelUps(stepped.plus(1), level, xpForNextLevel);
      stepped = up.xp;
      level = up.level;
    }
    const lump = foldXpLevelUps(start.plus(1000), 200, xpForNextLevel);
    expect(level).toBe(201);
    expect(lump.level).toBe(201);
    expect(stepped.toString()).toBe(lump.xp.toString());
  });

  it("a stored XP survives the save's string form at level 200", () => {
    const xp = new Decimal(xpForNextLevel(200) - 1);
    expect(new Decimal(JSON.parse(JSON.stringify(xp))).eq(xp)).toBe(true);
  });
});

describe("one curve for every consumer", () => {
  it("the While You Were Away row reconstructs the gross XP across levels past the threshold", () => {
    const before = editCaptain(wiringBase(), { level: 38, xp: new Decimal(100) });
    const earned = xpForNextLevel(38) + xpForNextLevel(39) + 500;
    const after = editCaptain(before, { level: 40, xp: new Decimal(100 + 500) });
    const row = summarizeOfflineProgress(before, after, 60).captainsProgressed[0];
    expect(row.levelsGained).toBe(2);
    expect(row.xpGained.toNumber()).toBe(earned);
  });

  it("the fold charges the curve across several levels past the threshold", () => {
    const award = xpForNextLevel(35) + xpForNextLevel(36) + xpForNextLevel(37) + 7;
    const up = foldXpLevelUps(new Decimal(award), 35, xpForNextLevel);
    expect(up).toMatchObject({ level: 38, levelUps: 3 });
    expect(up.xp.toNumber()).toBe(7);
  });

  it("a level milestone past the threshold is stamped at the second the curve reaches it, in every cut", () => {
    const short = 37;
    const start = cp18Mission(39, xpForNextLevel(39) - short);
    const cuts = threeCuts(start, 200);
    for (const s of [cuts.steps, cuts.oneCall, cuts.chunks]) {
      expect(captainOf(s).level).toBe(40);
      expect(captainCommandNotables(captainOf(s)).filter((n) => n.kind === "levelMilestone").map((n) => n.atGameSeconds)).toEqual([start.gameTimeSeconds + short]);
    }
  });

  it("the old curve would have stamped that milestone sooner: the switch is the only difference", () => {
    const start = cp18Mission(39, 300 * 39 - 37);
    expect(captainCommandNotables(captainOf(threeCuts(start, 200).oneCall)).length).toBe(0);
    expect(withoutCp18(() => captainCommandNotables(captainOf(threeCuts(start, 200).oneCall)).length)).toBe(1);
  });
});

describe("parity with a captain past the threshold", () => {
  const body = (s: GameState) => JSON.stringify({ captain: s.captains[0], stats: s.lifetimeStats });

  it("1 s steps == 997 s chunks == one call for a big award crossing many levels and milestones at a fractional rate", () => {
    const cuts = threeCuts(cp18BigAward(31, 0), CP18_BIG_AWARD_SECONDS);
    expect(captainOf(cuts.oneCall).level).toBeGreaterThan(40);
    expect(body(cuts.chunks)).toBe(body(cuts.steps));
    expect(body(cuts.oneCall)).toBe(body(cuts.steps));
  });

  it("the same at level 200, where the numbers are largest", () => {
    const cost = xpForNextLevel(200);
    const cuts = threeCuts(cp18BigAward(200, cost - 1000), CP18_BIG_AWARD_SECONDS);
    expect(captainOf(cuts.oneCall).level).toBe(201);
    expect(body(cuts.chunks)).toBe(body(cuts.steps));
    expect(body(cuts.oneCall)).toBe(body(cuts.steps));
  });

  it("the offline summary agrees with the live award", () => {
    const start = cp18BigAward(31, 0);
    const after = threeCuts(start, CP18_BIG_AWARD_SECONDS).oneCall;
    const row = summarizeOfflineProgress(start, after, CP18_BIG_AWARD_SECONDS).captainsProgressed[0];
    expect(row.levelsGained).toBe(captainOf(after).level - 31);
    expect(row.xpGained.toNumber()).toBeCloseTo(after.lifetimeStats.captainXpAwarded.minus(start.lifetimeStats.captainXpAwarded).toNumber(), 6);
  });
});

describe("an old save with a captain past the threshold", () => {
  // Level 60 holding what the old curve allowed: below the old 18000 price, all of it kept.
  const oldSave = (xp: number) => editCaptain(wiringBase(), { level: 60, statPoints: 7, xp: new Decimal(xp) });
  const loaded = (s: GameState) => {
    const raw = deserialize(serialize(s, 0, 0));
    expect(raw).not.toBeNull();
    return migrate(raw!);
  };

  it("keeps the level, the XP and the points on load; nothing is re-leveled and the version does not move", () => {
    const s = loaded(oldSave(17_999));
    expect(captainOf(s)).toMatchObject({ level: 60, statPoints: 7 });
    expect(captainOf(s).xp.toNumber()).toBe(17_999);
    expect(SAVE_VERSION).toBe(72); // the Standard-Issue crew modules took v72
  });

  it("its stored XP counts toward the new, larger price (the bar reads lower, nothing is lost)", () => {
    const s = cp18Mission(60, 17_999);
    const after = threeCuts(s, 10).steps;
    expect(captainOf(after).level).toBe(60);
    expect(captainOf(after).xp.toNumber()).toBe(18_009);
    expect(captainOf(after).xp.dividedBy(xpForNextLevel(60)).toNumber()).toBeLessThan(0.1);
  });

  it("a stored XP above the OLD price (only the fold's own carry could leave one) spends at the new price on the next award, no surprise levels", () => {
    const stored = xpForNextLevel(60) + xpForNextLevel(61) + 5;
    const s = cp18Mission(60, stored);
    const after = threeCuts(s, 1).steps;
    expect(captainOf(after).level).toBe(62);
    expect(captainOf(after).statPoints).toBe(captainOf(s).statPoints + 2);
    expect(captainOf(after).xp.toNumber()).toBe(6);
    // Above the old price but below the new one: no level at all.
    const between = cp18Mission(60, 20_000);
    expect(captainOf(threeCuts(between, 1).steps).level).toBe(60);
  });

  it("one talent point per level past the threshold, as below it", () => {
    const up = threeCuts(cp18BigAward(31, 0), CP18_BIG_AWARD_SECONDS).oneCall;
    expect(captainOf(up).statPoints - captainOf(cp18BigAward(31, 0)).statPoints).toBe(captainOf(up).level - 31);
  });
});

describe("retirement is unaffected", () => {
  it("the gate reads the level, below the threshold, and retiring from past it resets the same", () => {
    expect(RETIRE_LEVEL_GATE).toBeLessThanOrEqual(CAPTAIN_SOFT_CAP_LEVEL);
    const ready = editCaptain(cp16RetireReady(0), { level: 60, xp: new Decimal(1) });
    expect(retireBlockReason(ready, WIRING_CAPTAIN_ID)).toBeNull();
    expect(captainOf(retireCaptain(ready, WIRING_CAPTAIN_ID))).toMatchObject({ level: 1 });
    expect(captainOf(retireCaptain(ready, WIRING_CAPTAIN_ID)).xp.toNumber()).toBe(0);
  });
});

describe("Help is truthful", () => {
  const crew = HELP_TOPICS.find((t) => t.id === "crew")!;

  it("says levels never stop and that each level past the threshold costs more, in the engine's numbers", () => {
    expect(crew.body).toContain("Captain levels never stop");
    expect(crew.body).toContain(`past level ${CAPTAIN_SOFT_CAP_LEVEL}`);
    expect(crew.body).toContain(`${Math.round((CAPTAIN_SOFT_CAP_GROWTH - 1) * 100)}% more`);
  });

  it("nothing in Help claims a top captain level", () => {
    for (const t of HELP_TOPICS) expect(t.body, t.id).not.toMatch(/(max|maximum|top|highest) captain level|captain level cap/i);
  });
});
