// ftlRenderer.test.ts: 0.14.0 Slice 5b, the Faster Than Light renderer's cost and motion contract, run on a fake
// canvas: Still requests no frames, stop cancels, the frame rate is capped, the star count and pixel ratio are
// capped, and colors and settings that did not change cost nothing.
import { describe, it, expect } from "vitest";
import { FtlRenderer, MAX_STARS, MAX_DPR, starCount, cappedDpr, type FtlContext, type FtlEnv } from "./ftlRenderer";
import { FTL_DEFAULTS, SLIDER_MAX, type FtlSettings } from "./backgroundStyle";

function fakeCtx() {
  const calls = { fillRect: 0, stroke: 0, fill: 0, arc: 0 };
  const ctx: FtlContext = {
    setTransform: () => {},
    fillRect: () => void (calls.fillRect += 1),
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => void (calls.stroke += 1),
    arc: () => void (calls.arc += 1),
    fill: () => void (calls.fill += 1),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
  };
  return { ctx, calls };
}

function fakeEnv() {
  const queue: ((now: number) => void)[] = [];
  let requested = 0;
  let cancelled = 0;
  let seed = 7;
  const env: FtlEnv = {
    requestFrame: (cb) => {
      requested += 1;
      queue.push(cb);
      return requested;
    },
    cancelFrame: () => void (cancelled += 1),
    // a small deterministic generator, so a star spread is the same every run
    random: () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    },
  };
  const frame = (now: number) => {
    const cb = queue.shift();
    cb?.(now);
  };
  return { env, frame, get requested() { return requested; }, get cancelled() { return cancelled; } };
}

const set = (p: Partial<FtlSettings>): FtlSettings => ({ ...FTL_DEFAULTS, ...p });

describe("caps", () => {
  it("star count follows the mockup (80 + 50 per step) and never passes the cap", () => {
    expect(starCount(1)).toBe(130);
    expect(starCount(5)).toBe(330);
    expect(starCount(SLIDER_MAX)).toBe(580);
    expect(starCount(1000)).toBe(MAX_STARS);
  });

  it("the pixel ratio is capped (a 3x phone draws at 1.5x)", () => {
    expect(MAX_DPR).toBe(1.5);
    expect(cappedDpr(3)).toBe(1.5);
    expect(cappedDpr(1)).toBe(1);
    expect(cappedDpr(Number.NaN)).toBe(1);
  });
});

describe("Still and reduced motion", () => {
  it("Still draws the field once as points and never requests a frame", () => {
    const { ctx, calls } = fakeCtx();
    const e = fakeEnv();
    const r = new FtlRenderer(ctx, FTL_DEFAULTS, [[255, 255, 255]], e.env);
    r.setStill(true);
    r.resize(800, 600, 1);
    r.start(true);
    expect(e.requested).toBe(0);
    expect(r.isRunning).toBe(false);
    expect(calls.stroke).toBe(0);
    expect(calls.arc).toBeGreaterThan(0);
  });

  it("switching Still on while moving stops the frames", () => {
    const { ctx } = fakeCtx();
    const e = fakeEnv();
    const r = new FtlRenderer(ctx, FTL_DEFAULTS, [[255, 255, 255]], e.env);
    r.resize(800, 600, 1);
    r.start(false);
    expect(r.isRunning).toBe(true);
    r.setStill(true);
    expect(r.isRunning).toBe(false);
    expect(e.cancelled).toBe(1);
  });
});

describe("motion", () => {
  it("streaks are strokes; stop cancels the frame request (the hidden-tab pause)", () => {
    const { ctx, calls } = fakeCtx();
    const e = fakeEnv();
    const r = new FtlRenderer(ctx, FTL_DEFAULTS, [[255, 255, 255]], e.env);
    r.resize(800, 600, 1);
    r.start(true);
    e.frame(0);
    e.frame(17);
    expect(calls.stroke).toBeGreaterThan(0);
    r.stop();
    expect(r.isRunning).toBe(false);
    expect(e.cancelled).toBe(1);
  });

  it("draws at most about 60 times a second on a fast display", () => {
    const { ctx, calls } = fakeCtx();
    const e = fakeEnv();
    const r = new FtlRenderer(ctx, FTL_DEFAULTS, [[255, 255, 255]], e.env);
    r.resize(800, 600, 1);
    r.start(false);
    const before = calls.fillRect;
    // one second at 144 Hz
    for (let i = 0; i <= 144; i++) e.frame(i * (1000 / 144));
    const drawn = calls.fillRect - before;
    expect(drawn).toBeLessThanOrEqual(61);
    expect(drawn).toBeGreaterThan(30);
  });

  it("the Stars setting changes the field, up to the cap", () => {
    const { ctx } = fakeCtx();
    const r = new FtlRenderer(ctx, set({ stars: 1 }), [[255, 255, 255]], fakeEnv().env);
    expect(r.starTotal).toBe(130);
    r.setSettings(set({ stars: 10 }));
    expect(r.starTotal).toBe(580);
  });

  it("unchanged colors and settings cost nothing (the game tick hands fresh objects every second)", () => {
    const { ctx, calls } = fakeCtx();
    const r = new FtlRenderer(ctx, FTL_DEFAULTS, [[1, 2, 3]], fakeEnv().env);
    r.resize(800, 600, 1);
    const drawn = calls.fillRect;
    r.setPalette([[1, 2, 3]]);
    r.setSettings({ ...FTL_DEFAULTS });
    expect(calls.fillRect).toBe(drawn);
    r.setPalette([[3, 2, 1]]);
    expect(calls.fillRect).toBe(drawn + 1);
  });
});

// User report 2026-11-15 (staging, Android, after the tab sat in the background): a solid magenta band at two
// thirds of the screen. The browser had reset the canvas context, dropping the pixel-ratio transform; frames then
// drew into the top-left 1/dpr only and streaks past that edge never faded. Every frame now re-applies the scale.
describe("context reset in the background", () => {
  it("every drawn frame applies the pixel-ratio scale before it paints, even after the context lost it", () => {
    const { ctx } = fakeCtx();
    let scale = 1;
    const log: string[] = [];
    ctx.setTransform = ((a: number) => {
      scale = a;
      log.push(`t${a}`);
    }) as FtlContext["setTransform"];
    const fill = ctx.fillRect;
    ctx.fillRect = (...args: Parameters<FtlContext["fillRect"]>) => {
      log.push(`f@${scale}`);
      fill(...args);
    };
    const e = fakeEnv();
    const r = new FtlRenderer(ctx, FTL_DEFAULTS, [[255, 0, 255]], e.env);
    r.resize(400, 800, 1.5);
    r.start(false);
    e.frame(0);
    // the browser discards and restores the canvas: its transform is back to identity
    scale = 1;
    log.length = 0;
    e.frame(17);
    e.frame(34);
    const fills = log.filter((x) => x.startsWith("f@"));
    expect(fills.length).toBe(2);
    expect(fills.every((x) => x === "f@1.5")).toBe(true);
  });
});
