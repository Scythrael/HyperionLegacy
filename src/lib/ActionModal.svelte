<script lang="ts">
  // ActionModal: the ONE shared shell for every action modal (0.13.6 standardization, approved
  // mock docs/plans/2026-09-16-action-modal-mock.html). Bottom sheet on mobile, centered card on
  // desktop, over a click-to-dismiss backdrop, with a sticky header (title + close X), a scrolling
  // body (default slot), and an OPTIONAL sticky footer (named "footer" slot) for actions. Focus is
  // trapped inside (Escape + the X + a backdrop tap all close via onClose).
  //
  // Extracted from the 0.13.2 install-flow modal (ShipSystemsPanel's .ss-modal-backdrop / .ss-picker),
  // which is the reference implementation. The Options gear popup is DELIBERATELY not migrated here.
  import { focusTrap } from "./focusTrap";

  export let title: string;
  export let onClose: () => void;
  // The dialog's accessible name; defaults to the visible title.
  export let ariaLabel: string = title;

  // Portal to <body> so the modal escapes any transformed / overflow-clipped ancestor (the same
  // reason the install flow portals). Safe on destroy whether or not Svelte already detached it.
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy() { node.remove(); } };
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<!-- INTENTIONAL: the backdrop is a presentation dimmer whose only job is click-to-dismiss; keyboard
     users dismiss with Escape (the focusTrap on the dialog) or the header close button, and every
     real control lives inside the dialog. -->
<div class="am-backdrop" use:portal on:click|self={onClose}>
  <div class="am-dialog" role="dialog" aria-modal="true" aria-label={ariaLabel} use:focusTrap={onClose}>
    <div class="am-head">
      <span class="am-title">{title}</span>
      <button class="am-close" on:click={onClose} aria-label="Close">&times;</button>
    </div>
    <div class="am-body">
      <slot />
    </div>
    {#if $$slots.footer}
      <div class="am-foot"><slot name="footer" /></div>
    {/if}
  </div>
</div>

<style>
  .am-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    align-items: flex-end; /* mobile: sheet anchored to the bottom */
    justify-content: center;
    background: rgba(4, 6, 10, 0.66);
  }
  .am-dialog {
    width: 100%;
    max-height: 88vh;
    display: flex;
    flex-direction: column;
    overflow: hidden; /* the body scrolls; head + foot stay pinned */
    background: var(--color-bg-mid);
    border: 1px solid rgba(var(--color-accent-rgb), 0.4);
    border-radius: var(--corner) var(--corner) 0 0; /* rounded top edge for the sheet */
    box-shadow: 0 -10px 40px rgba(0, 0, 0, 0.6);
    container-type: inline-size; /* master-detail content (e.g. the install flow) queries THIS width */
  }
  @media (min-width: 700px) {
    .am-backdrop { align-items: center; padding: 24px; }
    .am-dialog {
      max-width: 540px;
      max-height: 85vh;
      border-radius: var(--corner);
      box-shadow: 0 18px 50px rgba(0, 0, 0, 0.6);
    }
  }
  .am-head {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px;
    background: var(--color-bg-mid);
    border-bottom: 1px solid rgba(var(--color-accent-rgb), 0.15);
  }
  .am-title {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--color-accent-bright);
  }
  .am-close {
    margin-left: auto;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--text-xl);
    line-height: 1;
    cursor: pointer;
    background: rgba(var(--color-accent-rgb), 0.08);
    border: 1px solid rgba(var(--color-accent-rgb), 0.35);
    color: var(--color-text-secondary);
    border-radius: var(--corner);
    flex: 0 0 auto;
  }
  .am-close:hover {
    color: var(--color-text-primary);
    border-color: var(--color-accent);
  }
  .am-body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding: 12px;
    /* Clear the mobile browser's bottom chrome so the last row is not tucked behind it (only when
       there is no footer; the footer clears it otherwise). 0 on desktop. */
    padding-bottom: max(12px, env(safe-area-inset-bottom, 0px));
  }
  .am-foot {
    flex: 0 0 auto;
    display: flex;
    gap: 10px;
    justify-content: flex-end;
    padding: 10px 12px;
    padding-bottom: max(10px, env(safe-area-inset-bottom, 0px));
    background: var(--color-bg-mid);
    border-top: 1px solid rgba(var(--color-accent-rgb), 0.15);
  }
</style>
