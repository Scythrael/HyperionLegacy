// floatingTip.test.ts: the shared floating-card placement (gear wear step 5 fix, 2026-11-09).
// The tall gear card (about 506 px at 1280x800) used to be clamped over its own mid-screen tile,
// which stole the pointer from the tile and made the card close and reopen. These pin the
// placement order: preferred vertical side, other vertical side, right, left, then the legacy clamp.
import { describe, expect, it } from "vitest";
import { clampFloatingTip, type FloatingTipAnchorRect } from "./floatingTip";

const VW = 1280;
const VH = 800;
const M = 8;
const G = 8;

function rect(left: number, top: number, width: number, height: number): FloatingTipAnchorRect {
  return { left, top, width, bottom: top + height };
}
function overlaps(a: FloatingTipAnchorRect, l: number, t: number, w: number, h: number): boolean {
  const aRight = a.left + a.width;
  return l < aRight && l + w > a.left && t < a.bottom && t + h > a.top;
}

describe("clampFloatingTip", () => {
  it("keeps the short card above its anchor, centered (unchanged behavior)", () => {
    const a = rect(600, 400, 80, 40);
    const p = clampFloatingTip({ anchorRect: a, tipWidth: 244, tipHeight: 200, viewportW: VW, viewportH: VH, margin: M, gap: G });
    expect(p).toEqual({ left: 600 + 40 - 122, top: 400 - 200 - G });
  });

  it("flips below when above has no room (unchanged behavior)", () => {
    const a = rect(600, 60, 80, 40);
    const p = clampFloatingTip({ anchorRect: a, tipWidth: 244, tipHeight: 200, viewportW: VW, viewportH: VH, margin: M, gap: G });
    expect(p.top).toBe(100 + G);
  });

  it("puts a tall card beside a mid-screen tile instead of over it", () => {
    const a = rect(500, 300, 90, 60);
    const p = clampFloatingTip({ anchorRect: a, tipWidth: 244, tipHeight: 506, viewportW: VW, viewportH: VH, margin: M, gap: G });
    expect(p.left).toBe(590 + G);
    expect(overlaps(a, p.left, p.top, 244, 506)).toBe(false);
    expect(p.top).toBeGreaterThanOrEqual(M);
    expect(p.top + 506).toBeLessThanOrEqual(VH - M);
  });

  it("uses the left side when the right side has no room", () => {
    const a = rect(1100, 300, 90, 60);
    const p = clampFloatingTip({ anchorRect: a, tipWidth: 244, tipHeight: 506, viewportW: VW, viewportH: VH, margin: M, gap: G });
    expect(p.left).toBe(1100 - G - 244);
    expect(overlaps(a, p.left, p.top, 244, 506)).toBe(false);
  });

  it("falls back to the legacy clamp when there is no room anywhere (a phone)", () => {
    const a = rect(20, 300, 335, 60);
    const p = clampFloatingTip({ anchorRect: a, tipWidth: 359, tipHeight: 506, viewportW: 375, viewportH: 812, margin: M, gap: G });
    expect(p.left).toBe(M);
    expect(p.top).toBe(M);
  });

  it("prefer below + align start opens under the anchor's left edge (the Armory card)", () => {
    const a = rect(300, 200, 180, 30);
    const p = clampFloatingTip({ anchorRect: a, tipWidth: 320, tipHeight: 300, viewportW: VW, viewportH: VH, margin: M, gap: 6, prefer: "below", align: "start" });
    expect(p).toEqual({ left: 300, top: 236 });
  });

  it("prefer below flips above when below has no room", () => {
    const a = rect(300, 600, 180, 30);
    const p = clampFloatingTip({ anchorRect: a, tipWidth: 320, tipHeight: 300, viewportW: VW, viewportH: VH, margin: M, gap: 6, prefer: "below", align: "start" });
    expect(p.top).toBe(600 - 300 - 6);
  });
});
