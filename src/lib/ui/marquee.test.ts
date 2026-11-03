// CP-9: the notable strip's drift (marquee.ts marqueeStep): it moves at the set speed, rests at each end, turns
// around, stays at 0 when the strip does not overflow, and clamps a stalled frame so it never jumps.
import { describe, it, expect } from "vitest";
import { MARQUEE_END_REST_MS, MARQUEE_PX_PER_SEC, marqueeStep, type MarqueeState } from "./marquee";

const go: MarqueeState = { pos: 0, dir: 1, restMs: 0 };

describe("CP-9 marquee drift", () => {
  it("moves at the set speed", () => {
    expect(marqueeStep(go, 500, 50).pos).toBeCloseTo((MARQUEE_PX_PER_SEC * 50) / 1000);
  });

  it("rests at the far end, then drifts back", () => {
    let s = marqueeStep({ pos: 99.9, dir: 1, restMs: 0 }, 100, 50);
    expect(s).toEqual({ pos: 100, dir: -1, restMs: MARQUEE_END_REST_MS });
    s = marqueeStep(s, 100, 50);
    expect(s.pos).toBe(100);
    s = { ...s, restMs: 0 };
    expect(marqueeStep(s, 100, 50).pos).toBeLessThan(100);
  });

  it("rests at the start, then drifts forward again", () => {
    expect(marqueeStep({ pos: 0.1, dir: -1, restMs: 0 }, 100, 50)).toEqual({ pos: 0, dir: 1, restMs: MARQUEE_END_REST_MS });
  });

  it("stays at 0 when the strip does not overflow", () => {
    expect(marqueeStep({ pos: 30, dir: -1, restMs: 0 }, 0, 50)).toEqual({ pos: 0, dir: 1, restMs: 0 });
  });

  it("clamps a stalled frame and a range that shrank", () => {
    expect(marqueeStep(go, 500, 10_000).pos).toBeCloseTo((MARQUEE_PX_PER_SEC * 100) / 1000);
    expect(marqueeStep({ pos: 400, dir: -1, restMs: 10 }, 200, 16).pos).toBe(200);
  });
});
