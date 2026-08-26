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
// The math is a VERBATIM lift of ShipSystemsPanel.positionTip's original inline
// computation (prefer-above / flip-below / clamp), so the panel tooltip keeps its
// exact behavior after the refactor.
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
}

// The resolved fixed-position coordinates, in viewport pixels.
export interface FloatingTipPosition {
  left: number;
  top: number;
}

// ---------------------------------------------------------------------------
// clampFloatingTip: resolve the fixed-position left/top for a floating tooltip.
//
// Horizontal: center the tooltip on the anchor, then clamp so neither edge leaves
//   the viewport (margin on each side).
// Vertical: prefer ABOVE the anchor. If that clips the top, flip BELOW; if below
//   also clips the bottom, keep whichever fits and clamp into the visible band.
//   A final Math.max/Math.min pins the result inside the top/bottom margins.
//
// PURE: no DOM reads, no side effects. Same inputs -> same output.
// ---------------------------------------------------------------------------
export function clampFloatingTip(input: FloatingTipInput): FloatingTipPosition {
  const { anchorRect, tipWidth, tipHeight, viewportW, viewportH, margin, gap } = input;

  // Horizontal: center on the anchor, then clamp so neither edge leaves the viewport.
  let left = anchorRect.left + anchorRect.width / 2 - tipWidth / 2;
  left = Math.max(margin, Math.min(left, viewportW - tipWidth - margin));

  // Vertical: prefer ABOVE the anchor. If it would clip the top, flip BELOW; if below
  // also clips the bottom, keep whichever fits and clamp into the visible band.
  let top = anchorRect.top - tipHeight - gap;
  if (top < margin) {
    const below = anchorRect.bottom + gap;
    top = below + tipHeight <= viewportH - margin ? below : Math.min(top, viewportH - tipHeight - margin);
  }
  top = Math.max(margin, Math.min(top, viewportH - tipHeight - margin));

  return { left, top };
}
