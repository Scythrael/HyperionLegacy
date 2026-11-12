<script lang="ts">
  // FieldRepairStrip.svelte: OC-F14's FIELD REPAIR strip (user answers 2026-11-12, mockup
  // docs/mockups/2026-11-11-field-repair-order-mockup.html Option A), under the Ship lane's track in
  // GroundTeamTimeline.svelte, in the approved Overtime strip's shape. The hull readout (shown whenever the hull is below
  // full), the one-tap "Order field repair" with its preview (where the ship will repair and how long, the faster of the
  // nearest repair world and orbit), the order's progress with a one-tap Cancel, the done line, and each refusal.
  //
  // POSTURE: pure presentation over fieldRepairStripDisplay.ts (tested). The order and the cancel go to the host
  // (App.svelte doOrderFieldRepair / doCancelFieldRepair: the pure engine, then save and log).

  import type { Expedition } from "./game/model";
  import { fieldRepairStripView } from "./fieldRepairStripDisplay";
  import Icon from "./ui/Icon.svelte";

  export let exp: Expedition;
  export let now: number;
  export let onOrder: () => void = () => {};
  export let onCancel: () => void = () => {};

  $: view = fieldRepairStripView(exp, now);
</script>

{#if view}
  <div class="fr" role="group" aria-label="Field repair">
    <div class="fr-row">
      <span class="fr-tag" class:off={view.tagOff}><Icon name="hullRepair" size={14} />Hull</span>
      {#if view.hull}
        <span class="hull" title={view.hull.title} role="img" aria-label={view.hull.title}>
          <i style="width: {view.hull.fillPct}%;"></i>
          <b style="left: {view.hull.markPct}%;"></b>
        </span>
      {/if}
      {#if view.numbersWide && view.numbersNarrow}
        <span class="fr-n wide">{#each view.numbersWide as p, i (i)}{#if p.bold}<b>{p.text}</b>{:else}{p.text}{/if}{/each}</span>
        <span class="fr-n narrow">{#each view.numbersNarrow as p, i (i)}{#if p.bold}<b>{p.text}</b>{:else}{p.text}{/if}{/each}</span>
      {/if}
      {#if view.order}
        <button type="button" class="fr-btn order" class:off={!view.order.enabled} disabled={!view.order.enabled} on:click={onOrder}>
          {#if view.order.glyph}<Icon name={view.order.glyph} size={14} />{/if}{view.order.text}
        </button>
      {/if}
      {#if view.chip}
        <span class="fr-btn chip {view.chip.tone}">{#if view.chip.glyph}<Icon name={view.chip.glyph} size={14} />{/if}{view.chip.text}</span>
      {/if}
      {#if view.cancel}
        <button type="button" class="fr-btn cancel" on:click={onCancel}><Icon name="close" size={14} />Cancel</button>
      {/if}
    </div>
    {#if view.progressPct !== null}
      <div class="fr-prog" role="progressbar" aria-label="Field repair leg" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(view.progressPct)}>
        <i style="width: {view.progressPct}%;"></i>
      </div>
    {/if}
    {#if view.whenWide && view.whenNarrow}
      <div class="fr-when wide">{#each view.whenWide as p, i (i)}{#if p.bold}<b>{p.text}</b>{:else}{p.text}{/if}{/each}</div>
      <div class="fr-when narrow">{#each view.whenNarrow as p, i (i)}{#if p.bold}<b>{p.text}</b>{:else}{p.text}{/if}{/each}</div>
    {/if}
    {#if view.dim}
      <div class="fr-dim">{view.dim}</div>
    {/if}
    {#if view.why}
      <div class="fr-why"><Icon name={view.why.glyph} size={12} /><span>{view.why.text}</span></div>
    {/if}
  </div>
{/if}

<style>
  /* The approved Overtime strip's shape (mockup .fr). */
  .fr {
    grid-column: 2;
    border: 1px solid rgba(var(--color-accent-rgb), 0.22);
    border-top: 1px dashed rgba(var(--color-accent-rgb), 0.28);
    padding: 7px 8px 8px;
    background: rgba(var(--color-accent-rgb), 0.03);
    display: grid;
    gap: 5px;
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
    min-width: 0;
  }
  .fr-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 7px;
  }
  .fr-tag {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--color-accent-bright);
    display: inline-flex;
    gap: 5px;
    align-items: center;
    white-space: nowrap;
  }
  .fr-tag.off {
    color: var(--color-text-dim);
  }
  .hull {
    position: relative;
    flex: 1 1 110px;
    min-width: 90px;
    height: 8px;
    background: var(--color-bg-mid);
    border: 1px solid rgba(var(--color-accent-rgb), 0.2);
    border-radius: var(--corner);
  }
  .hull i {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    background: var(--color-warning);
    opacity: 0.75;
  }
  .hull b {
    position: absolute;
    top: -3px;
    bottom: -3px;
    width: 0;
    border-left: 1px dashed var(--color-text-secondary);
  }
  .fr-n {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--color-text-dim);
    white-space: nowrap;
  }
  .fr-n b {
    color: var(--color-text-primary);
    font-weight: 400;
  }
  .fr-btn {
    font: inherit;
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--color-accent);
    background: rgba(var(--color-accent-rgb), 0.06);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--corner);
    padding: 3px 8px;
    min-height: 26px;
    display: inline-flex;
    gap: 5px;
    align-items: center;
    white-space: nowrap;
    cursor: pointer;
    box-sizing: border-box;
  }
  /* The first control on the row sits at its right end (the mockup's margin-left: auto); Cancel follows it. */
  .fr-btn.order,
  .fr-btn.chip {
    margin-left: auto;
  }
  .fr-btn:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
  .fr-btn.off {
    color: var(--color-text-dim);
    border-color: rgba(98, 133, 145, 0.45);
    border-style: dashed;
    background: transparent;
    cursor: default;
  }
  .fr-btn.going {
    color: var(--color-warning);
    border-color: rgba(var(--color-warning-rgb), 0.6);
    border-style: solid;
    background: rgba(var(--color-warning-rgb), 0.06);
    cursor: default;
  }
  .fr-btn.ok {
    color: var(--color-success);
    border-color: rgba(var(--color-success-rgb), 0.55);
    border-style: solid;
    background: transparent;
    cursor: default;
  }
  .fr-btn.chip {
    cursor: default;
  }
  .fr-when {
    color: var(--color-text-secondary);
  }
  .fr-when b {
    color: var(--color-text-primary);
    font-weight: 500;
    font-family: var(--font-mono);
    font-size: 10px;
  }
  .fr-dim {
    color: var(--color-text-dim);
    font-size: 9.5px;
  }
  .fr-why {
    display: flex;
    gap: 5px;
    align-items: flex-start;
    color: var(--color-text-secondary);
  }
  .fr-why :global(svg) {
    color: var(--color-text-dim);
    margin-top: 1px;
    flex: none;
  }
  .fr-prog {
    height: 4px;
    background: var(--color-bg-mid);
    border-radius: var(--corner);
    overflow: hidden;
  }
  .fr-prog i {
    display: block;
    height: 100%;
    background: var(--color-warning);
  }
  .narrow {
    display: none;
  }

  /* Phone (the lane stacks under 560 px, GO-M3): the strip spans the lane, the shorter numbers and words show, the
     button drops to its own row with a 32 px tap height, and the dim line is cut for space (as drawn). */
  @container (max-width: 560px) {
    .fr {
      grid-column: 1;
    }
    .wide {
      display: none;
    }
    .narrow {
      display: block;
    }
    .fr-n.narrow {
      display: inline;
    }
    .fr-btn {
      min-height: 32px;
    }
    .fr-btn.order,
    .fr-btn.chip {
      margin-left: 0;
    }
    .fr-btn.order,
    .fr-btn.chip,
    .fr-btn.cancel {
      order: 1;
    }
    .fr-row::after {
      content: "";
      order: 0;
      flex-basis: 100%;
      height: 0;
    }
    .fr-dim {
      display: none;
    }
  }
</style>
