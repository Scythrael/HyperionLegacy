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

  // The explanation. This is the SAME text that used to sit under the control: the point is to
  // unclutter the row, not to explain less.
  export let text: string;
  // Names the control this explains, so the button is not just an anonymous "?" to a screen reader.
  export let label: string;

  let open = false;
  let bubble: HTMLDivElement | null = null;
  let flip = false;

  async function show(): Promise<void> {
    open = true;
    flip = false;
    // Measure AFTER the bubble is in the DOM: a hidden element has no box to measure.
    await svelteTick();
    if (!bubble) return;
    const rect = bubble.getBoundingClientRect();
    if (rect.bottom > window.innerHeight - 8) flip = true;
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
</script>

<!-- The document listener is what makes "tap anywhere else to dismiss" work on touch, where there
     is no pointerleave to rely on. -->
<svelte:document on:click={hide} />

<span class="help-anchor">
  <button
    type="button"
    class="help-btn"
    aria-label={`What does "${label}" do?`}
    aria-expanded={open}
    on:click={toggle}
    on:mouseenter={() => void show()}
    on:focus={() => void show()}
    on:blur={hide}
  >?</button>
  {#if open}
    <div class="help-bubble" class:help-bubble-flip={flip} bind:this={bubble} role="note">
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
    position: absolute;
    z-index: 30;
    /* Opens BELOW-LEFT of the row rather than over it, so it never covers the control it is
       describing. That is the one real cost of floating instead of pushing, and placement is the
       whole of the fix. */
    top: calc(100% + 6px);
    left: 0;
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
  .help-bubble-flip {
    top: auto;
    bottom: calc(100% + 6px);
  }
</style>
