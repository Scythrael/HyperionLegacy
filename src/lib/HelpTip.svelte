<script lang="ts">
  // ============================================================================
  // HelpTip: the `?` button and its floating explanation. 0.13.5, from the approved mockup.
  //
  // WHY IT EXISTS. Every setting used to carry its description as a permanent paragraph under the
  // control. That is honest but noisy: a screen of twenty settings became a wall of prose, and the
  // user asked for the explanations to move behind a `?` so the list stays scannable.
  //
  // ⚠️ HOVER *AND* TAP, NEVER HOVER ALONE. Hover does not exist on a phone, and the phone is this
  // game's primary platform, so a hover-only affordance would hide every explanation in the
  // settings screen from most players. Pointer devices open it on hover (and on keyboard focus);
  // touch devices open it on tap; a tap anywhere else closes it.
  //
  // ⚠️ AND IT FLIPS ABOVE THE ROW WHEN IT WOULD FALL BELOW THE FOLD. A help bubble you have to
  // scroll to reach is worse than no help at all, because you do not know it is there. The flip is
  // measured after showing, because a hidden element has no height to measure.
  //
  // ⚠️ DISPLAY-ONLY, per the project's standing tooltip rule: it explains, it never carries an
  // action. Anything actionable lives on a stable button in the row itself.
  // ============================================================================

  import { tick as svelteTick } from "svelte";

  // ⚠️ PORTAL TO document.body (added 2026-09-13, second tooltip fix). Fixed positioning alone was
  // not enough: inside the Settings modal the bubble still rendered mid-screen and UNDER the panes.
  // The cause is that the modal subtree has a transformed/scrolling ancestor, which (a) becomes the
  // containing block for `position: fixed`, so viewport coords from getBoundingClientRect land in
  // the wrong place, and (b) traps the bubble's stacking so a high z-index cannot lift it over its
  // own modal's panels. Moving the node to <body> removes it from that ancestor entirely: fixed is
  // viewport-relative again, and it stacks above everything as a top-level element.
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        if (node.parentNode) node.parentNode.removeChild(node);
      },
    };
  }

  // The explanation. This is the SAME text that used to sit under the control: the point is to
  // unclutter the row, not to explain less.
  export let text: string;
  // Names the control this explains, so the button is not just an anonymous "?" to a screen reader.
  export let label: string;

  let open = false;
  let btn: HTMLButtonElement | null = null;
  let bubble: HTMLDivElement | null = null;
  // Inline position, set in show(). ⚠️ FIXED positioning, not absolute-within-the-anchor.
  let bubbleStyle = "";

  // ⚠️ WHY FIXED, NOT ABSOLUTE (fixed 2026-09-13, user report). The bubble used to be
  // position:absolute inside .help-anchor, which meant an ancestor with overflow clipping cut it
  // off. In the Settings window it lives inside .system-modal-body { overflow-y: auto }, so a
  // tooltip on the last row of a section was chopped by the scroll boundary and bled into the next
  // panel. position:fixed is measured from the viewport and escapes every ancestor's overflow, so
  // it can never be clipped by the modal. It also still flips ABOVE when there is no room below.
  //
  // Tradeoff accepted: a fixed bubble does not scroll with the content. That is fine here because
  // the tooltip is transient (opens on hover/focus, closes on leave/tap-away), so it is never open
  // long enough to detach from its row.
  async function show(): Promise<void> {
    open = true;
    bubbleStyle = "";
    await svelteTick();
    if (!btn || !bubble) return;
    const b = btn.getBoundingClientRect();
    const bubbleH = bubble.offsetHeight;
    const bubbleW = bubble.offsetWidth;
    // Below-left of the button by default; flip above if it would run past the viewport bottom.
    const below = b.bottom + 6;
    const flipUp = below + bubbleH > window.innerHeight - 8;
    const top = flipUp ? b.top - bubbleH - 6 : below;
    // Clamp horizontally so a bubble near the right edge does not spill off-screen.
    let left = b.left;
    if (left + bubbleW > window.innerWidth - 8) left = window.innerWidth - 8 - bubbleW;
    if (left < 8) left = 8;
    bubbleStyle = `top:${Math.max(8, top)}px; left:${left}px;`;
  }

  function hide(): void {
    open = false;
  }

  function toggle(event: MouseEvent): void {
    // Stops the document-level closer below from immediately undoing a tap that just opened it.
    event.stopPropagation();
    if (open) hide();
    else void show();
  }

  // ⚠️ TOUCH TWO-TAP FIX (2026-09-13, user report: "have to tap twice to get it to appear").
  // A touch tap ALSO focuses the button, so the old on:focus={show} opened the bubble and then the
  // SAME tap's on:click={toggle} saw it open and closed it again -> the first tap flashed nothing.
  // The fix is the one the warehouse tile tooltip already uses: drive HOVER off pointer events
  // gated to pointerType "mouse" (a touch pointerenter is ignored), and only show on focus when it
  // is KEYBOARD focus (:focus-visible, which browsers suppress for pointer/touch). Touch is then
  // driven solely by the on:click toggle -> one tap opens.
  function hoverShow(event: PointerEvent): void {
    if (event.pointerType === "mouse") void show();
  }
  function hoverHide(event: PointerEvent): void {
    if (event.pointerType === "mouse") hide();
  }
  function focusShow(event: FocusEvent): void {
    const el = event.currentTarget as HTMLElement | null;
    if (el && el.matches(":focus-visible")) void show();
  }
</script>

<!-- The document listener is what makes "tap anywhere else to dismiss" work on touch, where there
     is no pointerleave to rely on. -->
<svelte:document on:click={hide} />

<span class="help-anchor">
  <button
    type="button"
    class="help-btn"
    bind:this={btn}
    aria-label={`What does "${label}" do?`}
    aria-expanded={open}
    on:click={toggle}
    on:pointerenter={hoverShow}
    on:pointerleave={hoverHide}
    on:focus={focusShow}
    on:blur={hide}
  >?</button>
  {#if open}
    <div class="help-bubble" use:portal style={bubbleStyle} bind:this={bubble} role="note">
      {text}
    </div>
  {/if}
</span>

<style>
  .help-anchor {
    position: relative;
    display: inline-flex;
    align-items: center;
  }
  .help-btn {
    width: 17px;
    height: 17px;
    flex: none;
    border-radius: 50%;
    border: 1px solid var(--color-border-strong);
    background: none;
    color: var(--color-accent);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    font-weight: 600;
    line-height: 1;
    cursor: pointer;
    padding: 0;
    display: grid;
    place-items: center;
  }
  .help-btn:hover,
  .help-btn[aria-expanded="true"] {
    background: rgba(var(--color-accent-rgb), 0.18);
  }
  .help-btn:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
  .help-bubble {
    /* ⚠️ FIXED, positioned from JS (see show()), so no ancestor overflow can clip it. top/left are
       set inline. */
    position: fixed;
    /* Above the modal backdrop (100) and drop-icon tooltips (110); it lives on <body> now. */
    z-index: 1000;
    width: max-content;
    max-width: min(280px, 70vw);
    /* ⚠️ GENUINELY OPAQUE, via the same idiom the Ship Systems dialog uses: an accent tint layered
       over a SOLID background token. --color-panel-bg-strong alone is rgba(accent, 0.06), i.e.
       almost entirely transparent, so a bubble painted with it would show the settings list through
       itself, which is unreadable on exactly the dense screens that need help text most. Avoids
       backdrop-filter deliberately (Brave disables it), same reason the dialogs do. */
    background:
      linear-gradient(rgba(var(--color-accent-rgb), 0.06), rgba(var(--color-accent-rgb), 0.06)),
      var(--color-bg-mid);
    border: 1px solid var(--color-border-strong);
    border-left: 2px solid var(--color-accent);
    box-shadow: 0 8px 22px rgba(0, 0, 0, 0.6);
    padding: var(--space-3) var(--space-4);
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    line-height: 1.5;
    text-align: left;
  }
</style>
