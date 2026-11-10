// ============================================================================
// floatingTip.ts
// Author: Claude (Opus 4.8) | 2026-08-25
//
// Shared PURE clamp geometry for JS-positioned floating tooltips. Both the Ship
// Systems panel (equipment cards) and the Combat View (pip tooltips) render ONE
// fixed-position wrapper and need it kept fully inside the viewport regardless of
// which anchor it opens from: centered on the anchor, clamped horizontally, and
// preferring ABOVE the anchor with a flip BELOW (then a final vertical clamp) when
// there is no room above.
//
// This module owns ONLY the arithmetic. Measuring the anchor + the tooltip, the
// await-tick reveal, and the reflow-on-scroll wiring stay in each component (they
// touch the DOM and the component's own state). Extracting the math here means the
// two callers share ONE clamp implementation and it is trivially unit-testable
// without a DOM.
//
// The math began as a verbatim lift of ShipSystemsPanel.positionTip's inline computation
// (prefer-above / flip-below / clamp). Gear wear step 5 (2026-11-09) added the side
// placement so a tall card never covers its own anchor when there is room elsewhere, plus
// the prefer / align options so the Armory card shares this one implementation.
// ============================================================================

// The anchor's viewport rectangle. A DOMRect satisfies this shape, so callers can
// pass a getBoundingClientRect() result directly. Only the four fields the clamp
// reads are required.
export interface FloatingTipAnchorRect {
  // Left edge of the anchor, in viewport (client) pixels.
  left: number;
  // Top edge of the anchor, in viewport (client) pixels.
  top: number;
  // Bottom edge of the anchor, in viewport (client) pixels.
  bottom: number;
  // Anchor width, in pixels (used to center the tooltip over the anchor).
  width: number;
}

// The inputs to one clamp computation. All measurements are already taken by the
// caller (this function reads nothing from the DOM).
export interface FloatingTipInput {
  // The anchor element's measured viewport rectangle.
  anchorRect: FloatingTipAnchorRect;
  // The tooltip's measured width / height, in pixels (read AFTER any CSS max-height
  // cap, so the returned top already fits the capped element inside the margins).
  tipWidth: number;
  tipHeight: number;
  // The current viewport size, in pixels.
  viewportW: number;
  viewportH: number;
  // Minimum gap kept from any viewport edge, in pixels.
  margin: number;
  // Gap between the anchor and the tooltip, in pixels.
  gap: number;
  // Which vertical side to try first. Default "above" (the panel / combat / away team cards);
  // the Armory card opens "below" its item name.
  prefer?: "above" | "below";
  // Horizontal alignment for an above / below placement. Default "center" on the anchor;
  // "start" aligns the card's left edge with the anchor's (the Armory card).
  align?: "center" | "start";
}

// The resolved fixed-position coordinates, in viewport pixels.
export interface FloatingTipPosition {
  left: number;
  top: number;
}

// ---------------------------------------------------------------------------
// clampFloatingTip: resolve the fixed-position left/top for a floating tooltip.
//
// Placement order (gear wear step 5 fix, 2026-11-09): the card must NEVER cover its own
// anchor when the viewport has room anywhere else. A card over its own trigger steals the
// pointer from the trigger, which is what made the tall gear card flicker (close and reopen)
// on a mid-screen tile. So:
//   1. The preferred vertical side (ABOVE by default, BELOW when prefer is "below"), if the
//      whole card fits there.
//   2. The other vertical side, if it fits.
//   3. Beside the anchor: RIGHT, then LEFT, if the whole card width fits there. The card is
//      vertically centered on the anchor and clamped into the viewport (it may extend past
//      the anchor's top or bottom, but never overlaps it horizontally).
//   4. No room anywhere: the legacy clamp (keep whichever vertical side fits, else clamp into
//      the visible band). The card may then overlap its anchor; the host's hover wiring keeps
//      that state stable (one event family on anchor + card, see ShipSystemsPanel).
// Horizontal for the vertical placements: centered on the anchor (or start-aligned to its
//   left edge when align is "start"), then clamped so neither edge leaves the viewport.
//
// PURE: no DOM reads, no side effects. Same inputs -> same output.
// ---------------------------------------------------------------------------
export function clampFloatingTip(input: FloatingTipInput): FloatingTipPosition {
  const { anchorRect, tipWidth, tipHeight, viewportW, viewportH, margin, gap } = input;
  const prefer = input.prefer ?? "above";
  const anchorRight = anchorRect.left + anchorRect.width;

  // Horizontal for an above / below placement: center (or start-align) on the anchor, then
  // clamp so neither edge leaves the viewport.
  let hLeft = input.align === "start" ? anchorRect.left : anchorRect.left + anchorRect.width / 2 - tipWidth / 2;
  hLeft = Math.max(margin, Math.min(hLeft, viewportW - tipWidth - margin));

  const aboveTop = anchorRect.top - tipHeight - gap;
  const belowTop = anchorRect.bottom + gap;
  const fitsAbove = aboveTop >= margin;
  const fitsBelow = belowTop + tipHeight <= viewportH - margin;
  const clampV = (t: number): number => Math.max(margin, Math.min(t, viewportH - tipHeight - margin));

  // 1 + 2: a vertical side that fits the whole card, preferred side first.
  const sides: Array<"above" | "below"> = prefer === "below" ? ["below", "above"] : ["above", "below"];
  for (const side of sides) {
    if (side === "above" && fitsAbove) return { left: hLeft, top: aboveTop };
    if (side === "below" && fitsBelow) return { left: hLeft, top: belowTop };
  }

  // 3: beside the anchor (right, then left), vertically centered on it and clamped.
  const sideTop = clampV(anchorRect.top + (anchorRect.bottom - anchorRect.top) / 2 - tipHeight / 2);
  const rightLeft = anchorRight + gap;
  if (rightLeft + tipWidth <= viewportW - margin) return { left: rightLeft, top: sideTop };
  const leftLeft = anchorRect.left - gap - tipWidth;
  if (leftLeft >= margin) return { left: leftLeft, top: sideTop };

  // 4: no room anywhere. The legacy clamp (identical for both preferences): neither vertical
  // side fits, so pin the card into the visible band from the top.
  return { left: hLeft, top: clampV(Math.min(aboveTop, viewportH - tipHeight - margin)) };
}
