import { describe, it, expect } from "vitest";
import { tick, prestige } from "./tick";
import { freshState } from "./model";

describe("tick — closed-form requirement", () => {
  it("one big jump equals many small ticks", () => {
    const base = freshState();
    base.modules.miner = 5;
    base.modules.refinery = 2;
    base.modules.fabricator = 1;
    base.augmentPoints = 3;

    const bigJump = tick(3600, base);

    let stepped = base;
    for (let i = 0; i < 36000; i++) {
      stepped = tick(0.1, stepped);
    }

    expect(bigJump.resources.ore).toBeCloseTo(stepped.resources.ore, 6);
    expect(bigJump.resources.ingots).toBeCloseTo(stepped.resources.ingots, 6);
    expect(bigJump.resources.components).toBeCloseTo(stepped.resources.components, 6);
    expect(bigJump.gameTimeSeconds).toBeCloseTo(stepped.gameTimeSeconds, 6);
  });

  it("zero delta is a no-op", () => {
    const base = freshState();
    base.modules.miner = 3;
    const result = tick(0, base);
    expect(result).toBe(base);
  });

  it("production scales linearly with the global multiplier", () => {
    const base = freshState();
    base.modules.miner = 1;
    const noBonus = tick(10, { ...base, augmentPoints: 0 });
    const withBonus = tick(10, { ...base, augmentPoints: 10 }); // multiplier = 2x
    expect(withBonus.resources.ore).toBeCloseTo(noBonus.resources.ore * 2, 6);
  });
});

describe("prestige — tickDurationSeconds persistence", () => {
  it("carries tickDurationSeconds forward through a prestige reset", () => {
    const base = freshState();
    base.modules.fabricator = 5;
    base.lifetimeComponents = 100; // sqrt(100) = 10 Augment Points, so prestige actually fires
    base.tickDurationSeconds = 7; // simulate a future bonus having shortened it

    const { next } = prestige(base);
    expect(next.tickDurationSeconds).toBe(7);
  });
});

describe("prestige — lifetimeComponents resets (regression)", () => {
  it("resets lifetimeComponents to 0 after a successful prestige", () => {
    const base = freshState();
    base.lifetimeComponents = 100; // sqrt(100) = 10 Augment Points

    const { next, gained } = prestige(base);
    expect(gained).toBe(10);
    expect(next.lifetimeComponents).toBe(0);
  });

  it("yields nothing on a second immediate prestige with no new components produced", () => {
    const base = freshState();
    base.lifetimeComponents = 100;

    const { next: afterFirst } = prestige(base);
    const { gained: secondGain } = prestige(afterFirst);

    expect(secondGain).toBe(0);
  });
});
