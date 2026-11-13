// CP-9 (user call 2026-11-02 "Add a slow auto-scroll (Recommended)"): the notable strip drifts gently on its own.
//
// A Svelte action over a horizontally scrolling strip. It moves the strip's OWN scrollLeft (nothing is cloned or
// re-laid-out, so there is no layout shift), drifting to the end, resting, drifting back, resting, and so on. It
// pauses on hover, on keyboard focus inside the strip and on touch (resuming a moment after), and it does not run
// at all while the game's Reduce motion setting is on, the strip does not overflow, the tab is hidden or the strip is
// offscreen. No frame is requested while paused, so a hidden or still strip costs nothing.
//
// The motion is the pure marqueeStep below (tested); the action only wires the browser events to it.

export const MARQUEE_PX_PER_SEC = 14;
export const MARQUEE_END_REST_MS = 1800;
export const MARQUEE_RESUME_MS = 1500;
// A frame gap longer than this (a stalled tab) is clamped, so the strip never jumps.
const MAX_FRAME_MS = 100;

export interface MarqueeState {
  pos: number; // the scroll offset in px, 0..max
  dir: 1 | -1;
  restMs: number; // time left resting at an end
}

// One frame of the drift. `max` is the strip's scroll range (scrollWidth - clientWidth); 0 or less means it does not overflow and
// stays at 0. Pure.
export function marqueeStep(s: MarqueeState, max: number, dtMs: number, pxPerSec = MARQUEE_PX_PER_SEC): MarqueeState {
  if (max <= 0) return { pos: 0, dir: 1, restMs: 0 };
  const dt = Math.max(0, Math.min(MAX_FRAME_MS, dtMs));
  const pos = Math.max(0, Math.min(max, s.pos));
  if (s.restMs > 0) return { pos, dir: s.dir, restMs: Math.max(0, s.restMs - dt) };
  const nextPos = pos + (s.dir * pxPerSec * dt) / 1000;
  if (nextPos >= max) return { pos: max, dir: -1, restMs: MARQUEE_END_REST_MS };
  if (nextPos <= 0) return { pos: 0, dir: 1, restMs: MARQUEE_END_REST_MS };
  return { pos: nextPos, dir: s.dir, restMs: 0 };
}

export interface MarqueeParams {
  still: boolean; // the game's Reduce motion setting
  key?: unknown; // anything whose change may change the strip's width (the card count)
  // Told whenever the drift is held by the player (hover, focus or touch on a strip that would otherwise move), so a
  // host can show a small "paused" tag (the Personnel notable band). Optional; the Complement strip passes none.
  onPaused?: (paused: boolean) => void;
}

export function marquee(node: HTMLElement, params: MarqueeParams) {
  let still = params.still;
  let onPaused = params.onPaused;
  let wasPaused = false;
  let s: MarqueeState = { pos: node.scrollLeft, dir: 1, restMs: MARQUEE_END_REST_MS };
  let raf = 0;
  let last = 0;
  let lastSet = node.scrollLeft;
  let hovered = false;
  let focused = false;
  let touchedUntil = 0;
  let onScreen = true;
  let resumeTimer: ReturnType<typeof setTimeout> | null = null;

  const range = () => node.scrollWidth - node.clientWidth;
  const hidden = () => typeof document !== "undefined" && document.hidden;
  const shouldRun = () => !still && !hovered && !focused && onScreen && !hidden() && performance.now() >= touchedUntil && range() > 1;

  function frame(now: number): void {
    raf = 0;
    if (!shouldRun()) return;
    // The player scrolled the strip by hand: carry on from there.
    if (Math.abs(node.scrollLeft - lastSet) > 1) s = { ...s, pos: node.scrollLeft };
    s = marqueeStep(s, range(), last === 0 ? 0 : now - last);
    last = now;
    node.scrollLeft = s.pos;
    lastSet = node.scrollLeft;
    raf = requestAnimationFrame(frame);
  }
  function sync(): void {
    const paused = !still && (hovered || focused || performance.now() < touchedUntil) && range() > 1;
    if (paused !== wasPaused) {
      wasPaused = paused;
      onPaused?.(paused);
    }
    if (shouldRun()) {
      if (raf === 0) {
        last = 0;
        lastSet = node.scrollLeft;
        raf = requestAnimationFrame(frame);
      }
    } else if (raf !== 0) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  }

  const onEnter = () => {
    hovered = true;
    sync();
  };
  const onLeave = () => {
    hovered = false;
    sync();
  };
  const onFocusIn = () => {
    focused = true;
    sync();
  };
  const onFocusOut = (e: FocusEvent) => {
    if (e.relatedTarget instanceof Node && node.contains(e.relatedTarget)) return;
    focused = false;
    sync();
  };
  const onTouch = () => {
    touchedUntil = performance.now() + MARQUEE_RESUME_MS;
    if (resumeTimer !== null) clearTimeout(resumeTimer);
    resumeTimer = setTimeout(() => {
      resumeTimer = null;
      sync();
    }, MARQUEE_RESUME_MS + 20);
    sync();
  };

  node.addEventListener("mouseenter", onEnter);
  node.addEventListener("mouseleave", onLeave);
  node.addEventListener("focusin", onFocusIn);
  node.addEventListener("focusout", onFocusOut);
  node.addEventListener("touchstart", onTouch, { passive: true });
  node.addEventListener("touchend", onTouch, { passive: true });
  document.addEventListener("visibilitychange", sync);
  const io =
    typeof IntersectionObserver === "function"
      ? new IntersectionObserver((entries) => {
          onScreen = entries.some((e) => e.isIntersecting);
          sync();
        })
      : null;
  io?.observe(node);
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => sync()) : null;
  ro?.observe(node);
  sync();

  return {
    update(next: MarqueeParams) {
      still = next.still;
      onPaused = next.onPaused;
      sync();
    },
    destroy() {
      // A track unmounted while paused must not leave its owner's "paused" state stuck on.
      if (wasPaused) onPaused?.(false);
      if (raf !== 0) cancelAnimationFrame(raf);
      if (resumeTimer !== null) clearTimeout(resumeTimer);
      node.removeEventListener("mouseenter", onEnter);
      node.removeEventListener("mouseleave", onLeave);
      node.removeEventListener("focusin", onFocusIn);
      node.removeEventListener("focusout", onFocusOut);
      node.removeEventListener("touchstart", onTouch);
      node.removeEventListener("touchend", onTouch);
      document.removeEventListener("visibilitychange", sync);
      io?.disconnect();
      ro?.disconnect();
    },
  };
}
