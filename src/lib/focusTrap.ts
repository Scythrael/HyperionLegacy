// focusTrap.ts
// Author: Claude (Opus 4.8), 2026-07-17
// Shared Svelte `use:` action that makes a modal dialog keyboard-accessible.
//
// WHY this exists: every modal in App.svelte shares the .modal-backdrop +
// Panel.modal-dialog pattern, but none of them trapped keyboard focus, closed
// on Escape, or restored focus to the trigger afterward. A keyboard-only user
// could Tab straight out of the modal into the page behind the backdrop, which
// is both a usability and an accessibility (WCAG 2.4.3 / 2.1.2) failure. Fixing
// it once here, then applying `use:focusTrap` to every modal backdrop, keeps the
// behavior identical across all modals instead of re-implemented per modal.
//
// Contract for the host component:
//   - The action does NOT close the modal itself. On Escape it calls the
//     supplied `onEscape` callback, and the component decides what "close" means
//     (so Escape runs the exact same close path as that modal's Cancel button,
//     and never bypasses a gate such as the delete modal's typed-DELETE check).
//   - Focus is moved into the node on mount and restored to the previously
//     focused element (the trigger) on destroy.
//
// This only ever runs in the browser (a modal mounts client-side), so
// `document` / `window` are always present here; no SSR guard is needed.

import type { Action } from "svelte/action";

// The set of natively-focusable elements we consider "tabbable" inside a modal.
// Mirrors the common focus-trap selector: links with href, enabled form
// controls, and anything with a non-negative explicit tabindex. Elements with
// tabindex="-1" are programmatically focusable but NOT part of the Tab order, so
// they are excluded here on purpose.
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

// getFocusable
// Returns the node's Tab-order focusable descendants, in document order.
// Kept as a tiny standalone helper so the Tab-wrap logic below reads clearly
// and so the selector lives in exactly one place.
function getFocusable(node: HTMLElement): HTMLElement[] {
  return Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

// focusTrap
// Svelte action. Usage: <div class="modal-backdrop" use:focusTrap={onClose}>...</div>
// The parameter is the modal's own close handler, invoked when the user presses
// Escape. The action wires a keydown listener for Tab wrapping + Escape, moves
// focus inside on mount, and restores it on destroy.
export const focusTrap: Action<HTMLElement, () => void> = (node, onEscape) => {
  // Remember the element that had focus when the modal opened (usually the
  // button that triggered it), so we can hand focus back on close.
  const trigger = document.activeElement as HTMLElement | null;

  // The current Escape handler. Held in a mutable local so Svelte's `update`
  // lifecycle can swap in a new callback without re-binding the listener.
  let handleEscape = onEscape;

  // Move focus into the modal on mount: the first focusable child, or the node
  // itself (made programmatically focusable) if the modal has no focusable
  // controls. Focusing the node keeps the Tab trap anchored inside the dialog.
  const focusables = getFocusable(node);
  if (focusables.length > 0) {
    focusables[0].focus();
  } else {
    node.setAttribute("tabindex", "-1");
    node.focus();
  }

  // onKeydown
  // Handles the two keys a trapped modal cares about:
  //   - Escape: delegate to the component's close handler (never close here).
  //   - Tab / Shift+Tab: keep focus inside the node by wrapping from last->first
  //     (Tab) and first->last (Shift+Tab). The focusable set is re-read on every
  //     keypress so it stays correct even if the modal's contents changed (e.g.
  //     a button became enabled/disabled since mount).
  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      handleEscape();
      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    const current = getFocusable(node);
    if (current.length === 0) {
      // Nothing focusable inside: keep focus pinned on the node itself.
      event.preventDefault();
      node.focus();
      return;
    }

    const first = current[0];
    const last = current[current.length - 1];
    const active = document.activeElement;

    if (event.shiftKey) {
      // Shift+Tab off the first element wraps to the last.
      if (active === first || !node.contains(active)) {
        event.preventDefault();
        last.focus();
      }
    } else {
      // Tab off the last element wraps to the first.
      if (active === last || !node.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  node.addEventListener("keydown", onKeydown);

  return {
    // Svelte calls this when `use:focusTrap={...}` is passed a new value, so a
    // component that recreates its close handler still gets the latest one.
    update(nextOnEscape: () => void): void {
      handleEscape = nextOnEscape;
    },
    // On close, remove the listener and hand focus back to the trigger if it is
    // still in the DOM (it may have been removed, e.g. after a save reset).
    destroy(): void {
      node.removeEventListener("keydown", onKeydown);
      if (trigger && typeof trigger.focus === "function" && document.contains(trigger)) {
        trigger.focus();
      }
    },
  };
};
