// ============================================================================
// uiPrimitives.test.ts
// 0.13.5. Source-level guards for the two controls the settings redesign is built on.
//
// ⚠️ THESE ARE DELIBERATELY STRUCTURAL, NOT BEHAVIOURAL, and the distinction is worth stating so
// nobody mistakes them for more than they are. There is no DOM test harness in this project, so a
// behavioural test would mean introducing one for two components. What CAN be checked without it is
// the set of properties that are easy to delete by accident and impossible to notice by eye:
// whether the toggle is still a real switch, whether it still has a focus ring, and whether the
// help affordance still opens on TAP and not only on hover.
//
// Every one of those is an ACCESSIBILITY property, which is exactly the class that regresses
// silently: the control keeps working for whoever is testing it with a mouse.
// ============================================================================

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const TOGGLE = readFileSync("src/lib/Toggle.svelte", "utf-8");
const HELPTIP = readFileSync("src/lib/HelpTip.svelte", "utf-8");

describe("Toggle: the square on/off switch", () => {
  it("reads real files, so the checks below are not vacuous", () => {
    expect(TOGGLE.length).toBeGreaterThan(500);
    expect(HELPTIP.length).toBeGreaterThan(500);
  });

  it("⚠️ is a real switch: a <button> with role=switch and aria-checked", () => {
    // A styled <div> would be unreachable by keyboard and invisible to a screen reader. The theme
    // picker this release replaced had exactly that defect; shipping its replacement with the same
    // one would be absurd.
    expect(TOGGLE).toContain('role="switch"');
    expect(TOGGLE).toMatch(/aria-checked=\{checked\}/);
    expect(TOGGLE).toMatch(/<button/);
  });

  it("⚠️ claims the SPACE key, which a <button> does not handle for free", () => {
    // Enter activates a button natively; Space scrolls the page instead. A native checkbox gives
    // both, so a switch built on a button has to add the missing half back.
    expect(TOGGLE).toMatch(/on:keydown/);
    expect(TOGGLE).toMatch(/event\.key === " "/);
    expect(TOGGLE).toMatch(/preventDefault\(\)/);
  });

  it("⚠️ has a VISIBLE focus ring, or the keyboard support is theoretical", () => {
    expect(TOGGLE).toMatch(/:focus-visible/);
    expect(TOGGLE).toMatch(/outline:/);
  });

  it("⚠️ the OFF knob uses the dim token, NEVER --color-text-disabled", () => {
    // THE SUBTLE ONE. "Greyed out a bit" reads as the disabled token, and it is the wrong token: an
    // OFF toggle is fully interactive, while --color-text-disabled means "you cannot use this". It
    // also sits at the AA floor by design, which is fine for text nobody needs to read carefully
    // and wrong for a knob the player is about to click.
    // ⚠️ Scoped to the STYLE block, not the whole file: the component's header comment names
    // --color-text-disabled precisely to explain why it is the wrong token here, and a whole-file
    // check would fail on that explanation. Checking the stylesheet is what the rule is actually
    // about, and it means the reasoning can stay written down where the next reader will find it.
    const css = TOGGLE.slice(TOGGLE.indexOf("<style>"));
    expect(css).toContain("var(--color-text-dim)");
    expect(css).not.toContain("--color-text-disabled");
  });

  it("glows through the ACCENT token, so it follows the theme rather than a literal", () => {
    expect(TOGGLE).toMatch(/box-shadow:[\s\S]*var\(--color-accent-rgb\)/);
  });

  it("⚠️ DISPATCHES a change event instead of self-mutating, or the parent never hears the click", () => {
    // THE BUG THIS GUARDS. The first Toggle did `checked = !checked` internally and bound the
    // button click to that, so `on:click` on the <Toggle> component was never forwarded, the
    // parent's handler never ran, and clicking did nothing (no state change, no save). It must
    // dispatch so the controlling parent updates and persists.
    expect(TOGGLE).toMatch(/createEventDispatcher/);
    expect(TOGGLE).toMatch(/dispatch\("change"/);
    // ⚠️ Not asserting the ABSENCE of `checked = !checked`, because the header comment names it to
    // explain the old bug; the dispatch check above is the real proof the fix is in place.
  });

  it("carries a required accessible name", () => {
    expect(TOGGLE).toMatch(/export let label: string/);
    expect(TOGGLE).toMatch(/aria-label=\{label\}/);
  });
});

describe("HelpTip: the ? explanation", () => {
  it("⚠️ opens on TAP as well as hover, because hover does not exist on a phone", () => {
    // The load-bearing case in this file. A hover-only help affordance hides every explanation in
    // the settings screen from the primary platform, and it would still look perfect to anyone
    // testing with a mouse. Tap opens via on:click={toggle}; hover opens via on:pointerenter.
    expect(HELPTIP).toMatch(/on:click=\{toggle\}/);
    expect(HELPTIP).toMatch(/on:pointerenter=\{hoverShow\}/);
  });

  it("⚠️ opens on the FIRST tap (touch), not the second", () => {
    // THE BUG THIS GUARDS (user report 2026-09-13). A touch tap also focuses the button, so the old
    // on:focus={show} opened the bubble and the SAME tap's on:click={toggle} closed it again -> the
    // first tap flashed nothing. The fix is the warehouse-tooltip idiom: hover is gated to a real
    // mouse pointer, and focus-to-show only fires for keyboard focus, so a tap is driven SOLELY by
    // the click toggle. Both gates must stay, or the two-tap bug returns.
    expect(HELPTIP).toMatch(/pointerType === "mouse"/);
    expect(HELPTIP).toMatch(/matches\(":focus-visible"\)/);
  });

  it("is reachable and dismissable by keyboard", () => {
    expect(HELPTIP).toMatch(/on:focus/);
    expect(HELPTIP).toMatch(/on:blur/);
    expect(HELPTIP).toMatch(/:focus-visible/);
  });

  it("⚠️ flips above the row when the bubble would fall below the fold", () => {
    // Help you have to scroll to find is worse than none, because you do not know it is there.
    expect(HELPTIP).toMatch(/getBoundingClientRect/);
    expect(HELPTIP).toMatch(/window\.innerHeight/);
    expect(HELPTIP).toMatch(/flipUp/);
  });

  it("⚠️ CLOSES on hover-out (on:pointerleave), or tooltips pile up and never disappear", () => {
    // THE BUG THIS GUARDS. The button opens on hover but must also close on hover-out, or hovering
    // across a settings screen opens a tooltip per row and none go away. hoverHide is the mouse-gated
    // pointerleave handler (a touch pointerleave is ignored, same as hoverShow).
    expect(HELPTIP).toMatch(/on:pointerleave=\{hoverHide\}/);
  });

  it("⚠️ PORTALS to document.body so a transformed/scrolling ancestor cannot mis-anchor or bury it", () => {
    // Fixed positioning alone rendered the bubble mid-screen and UNDER the modal panes, because
    // the modal subtree became the containing block for fixed and trapped its stacking. Portaling
    // to body escapes both.
    expect(HELPTIP).toMatch(/use:portal/);
    expect(HELPTIP).toMatch(/document\.body\.appendChild/);
  });

  it("⚠️ is FIXED-positioned so an ancestor's overflow cannot clip it", () => {
    // THE BUG THIS GUARDS. The bubble was position:absolute inside the anchor, so the Settings
    // modal's overflow-y:auto scroll body chopped a tooltip on a section's last row. Fixed
    // positioning is measured from the viewport and escapes every ancestor's overflow.
    expect(HELPTIP).toMatch(/position:\s*fixed/);
  });

  it("measures AFTER showing, since a hidden element has no height", () => {
    // The ordering bug this would otherwise have: measuring a display:none element returns zeroes,
    // so the flip would never trigger and the check above would pass while doing nothing.
    const showBody = HELPTIP.slice(HELPTIP.indexOf("async function show"), HELPTIP.indexOf("function hide"));
    expect(showBody).toMatch(/open = true/);
    expect(showBody).toMatch(/await svelteTick\(\)/);
    expect(showBody.indexOf("open = true")).toBeLessThan(showBody.indexOf("getBoundingClientRect"));
  });

  it("⚠️ paints an OPAQUE surface rather than the near-transparent panel token", () => {
    // --color-panel-bg-strong is rgba(accent, 0.06). A bubble painted with it shows the settings
    // list through itself, which is unreadable on precisely the dense screens that need help most.
    expect(HELPTIP).toMatch(/var\(--color-bg-mid\)/);
    // And no backdrop-filter: Brave disables it, which is why the dialogs avoid it too.
    expect(HELPTIP).not.toMatch(/backdrop-filter:\s*blur/);
  });
});
