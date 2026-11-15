// ftlRenderer.ts: the Faster Than Light warp-streak effect (0.14.0 Slice 5b), drawn on one 2D canvas.
//
// The effect is the signed-off mockup's (docs/plans/2026-10-29-background-settings-mockup.html):
// stars fly out from the center, each drawn as a streak from where it was a moment ago to where it is
// now, over a dark fill that leaves a short trail. Speed, Streak length, Stars and Brightness are the
// 1 to 10 sliders; Jump to warp is a short burst at 2.4x speed when it turns on; Still draws the field
// once as points and never asks for another frame.
//
// Cost, by construction (peace is the product, and a background must never cost the game):
//   - no per-frame allocation: star data lives in typed arrays sized once for MAX_STARS, colors are
//     a small table of prebuilt strings (one per palette bucket) and alpha rides globalAlpha;
//   - at most MAX_STARS stars and a device pixel ratio capped at MAX_DPR;
//   - at most about 60 frames a second whatever the display's refresh rate (motion is time-based,
//     so a 144 Hz screen and a 60 Hz screen show the same speed);
//   - stop() cancels the frame request (the component stops it while the tab is hidden).

import { paletteAt, type FtlSettings, type Rgb } from "./backgroundStyle";

export const MAX_STARS = 600;
export const MAX_DPR = 1.5;
// The mockup's frame steps, read as one 60 fps frame each.
const FRAME_MS = 1000 / 60;
// Draw no more often than this (a little under one 60 Hz frame, so a 60 Hz display never skips).
const MIN_FRAME_MS = FRAME_MS - 2;
const JUMP_FRAMES = 120;
const JUMP_HOLD_FRAMES = 30;
const JUMP_BOOST = 2.4;
const BUCKETS = 16;
const TAU = Math.PI * 2;
const FILL_RGB = "3, 5, 11";
const STILL_FILL = `rgb(${FILL_RGB})`;

// The mockup's star count: 80 plus 50 per Stars step, capped.
export function starCount(stars: number): number {
  return Math.min(MAX_STARS, 80 + stars * 50);
}

export function cappedDpr(dpr: number): number {
  return Math.min(MAX_DPR, Math.max(1, Number.isFinite(dpr) ? dpr : 1));
}

// What the renderer needs from the browser, injectable so tests run without a canvas.
export interface FtlEnv {
  requestFrame(cb: (now: number) => void): number;
  cancelFrame(id: number): void;
  random(): number;
}

export const BROWSER_ENV: FtlEnv = {
  requestFrame: (cb) => requestAnimationFrame(cb),
  cancelFrame: (id) => cancelAnimationFrame(id),
  random: () => Math.random(),
};

// The slice of CanvasRenderingContext2D the effect uses.
export type FtlContext = Pick<
  CanvasRenderingContext2D,
  "setTransform" | "fillRect" | "beginPath" | "moveTo" | "lineTo" | "stroke" | "arc" | "fill"
> & { fillStyle: string | CanvasGradient | CanvasPattern; strokeStyle: string | CanvasGradient | CanvasPattern; lineWidth: number; globalAlpha: number };

export class FtlRenderer {
  private readonly xs = new Float32Array(MAX_STARS);
  private readonly ys = new Float32Array(MAX_STARS);
  private readonly zs = new Float32Array(MAX_STARS);
  private readonly hue = new Uint8Array(MAX_STARS); // palette bucket
  private colors: string[] = ["rgb(240, 246, 255)"];
  private paletteKey = "";
  private fades: string[] = [];
  private count = 0;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private settings: FtlSettings;
  private still = false;
  private speed = 0.4;
  private jumpT = 0;
  private raf = 0;
  private running = false;
  private last = -1;

  constructor(
    private readonly ctx: FtlContext,
    settings: FtlSettings,
    palette: readonly Rgb[],
    private readonly env: FtlEnv = BROWSER_ENV,
  ) {
    this.settings = settings;
    this.setPalette(palette);
    // Fade fills for 1 to 4 frames' worth of time, prebuilt so a frame never builds a string.
    this.fades = [1, 2, 3, 4].map((f) => `rgba(${FILL_RGB}, ${this.fadeFor(f).toFixed(3)})`);
    this.rebuild();
  }

  get isRunning(): boolean {
    return this.running;
  }

  get starTotal(): number {
    return this.count;
  }

  // The canvas's CSS size and pixel ratio (the caller sizes the backing store).
  resize(cssW: number, cssH: number, dpr: number): void {
    this.w = cssW;
    this.h = cssH;
    this.dpr = dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!this.running) this.drawFrame(1);
  }

  // Same colors as now: nothing to do (the parent hands a fresh array on every game tick).
  setPalette(palette: readonly Rgb[]): void {
    const key = palette.map((c) => c.join(",")).join("|");
    if (key === this.paletteKey) return;
    this.paletteKey = key;
    const list: string[] = [];
    for (let i = 0; i < BUCKETS; i++) {
      const c = paletteAt(palette.length > 0 ? palette : [[240, 246, 255]], i / (BUCKETS - 1));
      list.push(`rgb(${c[0]}, ${c[1]}, ${c[2]})`);
    }
    this.colors = list;
    if (!this.running) this.drawFrame(1);
  }

  setSettings(settings: FtlSettings): void {
    const was = this.settings;
    if (
      settings.speed === was.speed &&
      settings.streakLength === was.streakLength &&
      settings.stars === was.stars &&
      settings.brightness === was.brightness
    ) {
      this.settings = settings;
      return;
    }
    const restar = starCount(settings.stars) !== this.count;
    this.settings = settings;
    this.fades = [1, 2, 3, 4].map((f) => `rgba(${FILL_RGB}, ${this.fadeFor(f).toFixed(3)})`);
    if (restar) this.rebuild();
    if (!this.running) this.drawFrame(1);
  }

  // Still: draw once as points, request no frames. Leaving Still starts the motion again.
  setStill(still: boolean): void {
    if (still === this.still) return;
    this.still = still;
    if (still) {
      this.stop();
      this.drawFrame(1);
    }
  }

  // Starts the motion (nothing in Still). `jump` plays the Jump to warp burst.
  start(jump: boolean): void {
    if (this.still) {
      this.drawFrame(1);
      return;
    }
    if (jump) this.jumpT = JUMP_FRAMES;
    if (this.running) return;
    this.running = true;
    this.last = -1;
    this.raf = this.env.requestFrame(this.tick);
  }

  stop(): void {
    if (this.running) this.env.cancelFrame(this.raf);
    this.running = false;
    this.raf = 0;
  }

  private fadeFor(frames: number): number {
    const trail = 0.15 + this.settings.streakLength * 0.06;
    const a = Math.max(0.12, 0.6 - trail * 0.6);
    return 1 - Math.pow(1 - a, frames);
  }

  private rebuild(): void {
    this.count = starCount(this.settings.stars);
    for (let i = 0; i < this.count; i++) this.spawn(i, true);
  }

  private spawn(i: number, fresh: boolean): void {
    const r = this.env.random;
    this.xs[i] = (r() - 0.5) * 2;
    this.ys[i] = (r() - 0.5) * 2;
    this.zs[i] = fresh ? r() : 1;
    this.hue[i] = Math.min(BUCKETS - 1, Math.floor(r() * BUCKETS));
  }

  private readonly tick = (now: number): void => {
    if (!this.running) return;
    this.raf = this.env.requestFrame(this.tick);
    if (this.last < 0) {
      this.last = now;
      this.drawFrame(1);
      return;
    }
    const dt = now - this.last;
    if (dt < MIN_FRAME_MS) return;
    this.last = now;
    // Long gaps (a hidden tab, a slow frame) advance at most 4 frames' worth, never a lurch.
    this.drawFrame(Math.min(4, Math.max(0.25, dt / FRAME_MS)));
  };

  // One frame, advanced by `f` mockup frames (1 at 60 fps).
  private drawFrame(f: number): void {
    const { ctx, w, h } = this;
    if (w <= 0 || h <= 0) return;
    const s = this.settings;
    const still = this.still || !this.running;
    const cx = w / 2;
    const cy = h / 2;
    const k = Math.max(w, h) * 0.3;
    const base = 0.4 + s.speed * 0.45;
    let target = base;
    if (!still && this.jumpT > 0) {
      this.jumpT -= f;
      target = this.jumpT > JUMP_HOLD_FRAMES ? base * JUMP_BOOST : base;
    }
    this.speed += (target - this.speed) * (1 - Math.pow(0.94, f));
    const speed = this.speed;
    // Re-apply the pixel-ratio scale every frame. A browser can reset the context while the tab sits in
    // the background (Android discards canvas state; resetting canvas.width does the same), which drops
    // the transform. Without this the frame drew into the top-left 1/dpr of the canvas, and streaks past
    // that edge were never faded again, building a solid band (user report 2026-11-15).
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = still ? STILL_FILL : this.fades[Math.min(3, Math.max(0, Math.round(f) - 1))];
    ctx.fillRect(0, 0, w, h);
    const bright = 0.35 + s.brightness * 0.065;
    const reach = 0.002 * speed * (2 + s.streakLength * 2.2);
    for (let i = 0; i < this.count; i++) {
      if (!still) this.zs[i] -= 0.0026 * speed * f;
      const z = this.zs[i];
      if (z <= 0.02) {
        this.spawn(i, false);
        continue;
      }
      const x = this.xs[i];
      const y = this.ys[i];
      const sx = cx + (x / z) * k;
      const sy = cy + (y / z) * k;
      if (sx < -60 || sx > w + 60 || sy < -60 || sy > h + 60) {
        this.spawn(i, false);
        continue;
      }
      const near = 1 - z;
      ctx.globalAlpha = Math.min(1, (0.2 + near * 0.95) * bright);
      const lw = 0.5 + near * 1.7;
      const color = this.colors[this.hue[i]];
      ctx.beginPath();
      if (still) {
        ctx.fillStyle = color;
        ctx.arc(sx, sy, lw * 0.6, 0, TAU);
        ctx.fill();
      } else {
        const lz = Math.min(1, z + reach);
        ctx.strokeStyle = color;
        ctx.lineWidth = lw;
        ctx.moveTo(cx + (x / lz) * k, cy + (y / lz) * k);
        ctx.lineTo(sx, sy);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }
}
