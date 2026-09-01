// focusOnMount.ts
// Author: Claude (Opus 4.8), 2026-09-01
// Shared Svelte `use:` action that moves keyboard focus onto a node when it mounts.
//
// WHY this exists (0.13.2 Ships tab, Unit 7 a11y): the Ships tab drill-down is NOT a
// modal (it is a full-view swap: the roster grid unmounts, the ship page mounts, and
// back again). focusTrap is the wrong tool for a non-modal view, and the plan is explicit:
// do NOT build a focus trap here, the modal is gone. But without help, tapping a roster
// row unmounts the row button and leaves focus on document.body (WCAG 2.4.3 focus-order
// failure). This action gives us the two small, correct moves we need instead:
//   1. On OPEN: apply it to the ship page's back control so focus lands on a real control
//      in the newly-revealed view rather than vanishing to <body>.
//   2. On CLOSE (return to grid): apply it, gated by `when`, to the row the player came
//      FROM, so focus returns to its origin. The `onFocused` callback lets the host clear
//      its "restore to this row" marker the instant it is consumed, so a later, unrelated
//      remount of that same row (e.g. a favorite toggle reshuffling groups) never re-steals
//      focus. Passing no params (the back-control case) always focuses on mount.
//
// CONTRACT / deliberate non-behaviors:
//   - Focus happens ONCE, on mount. `update` is a no-op on purpose: Svelte keeps keyed
//     rows mounted and merely updates them each tick, so re-running focus on data changes
//     would yank focus away mid-interaction. Mount is the only correct moment.
//   - `when === false` skips focusing entirely (the non-origin rows on a grid return).
//   - This only ever runs in the browser (these surfaces mount client-side), so `document`
//     is always present; no SSR guard is needed.
//
// No em dashes / no "--" as punctuation (project rule): commas, periods, parens only.

import type { Action } from "svelte/action";

// The optional parameter bag. Omitting it (or passing nothing) means "focus on mount,
// unconditionally", which is the back-control case. Supplying `when` gates the focus, and
// `onFocused` is invoked immediately after a successful focus so the host can reset its
// one-shot restore marker.
export interface FocusOnMountParams {
  when?: boolean;
  onFocused?: () => void;
}

export const focusOnMount: Action<HTMLElement, FocusOnMountParams | undefined> = (
  node,
  params,
) => {
  // Default `when` to true so a param-less use (the back control) always focuses.
  const enabled = params?.when ?? true;
  if (enabled) {
    node.focus();
    params?.onFocused?.();
  }
  return {
    // Intentionally empty: focus is a mount-time action only (see the header note).
    update() {},
    destroy() {},
  };
};
