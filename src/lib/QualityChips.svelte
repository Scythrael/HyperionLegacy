<script lang="ts">
  // QualityChips.svelte: a material's stock split by quality, as small chips ("Q0 40", "Q1 6"), from the signed-off
  // Refinery mockup (0.14.0 ML-7, user 2026-10-21 "approve as is"; per-quality chips always visible). Q0 reads in the
  // secondary text color, Q1 and up in the accent, so the good stock stands out. Pure presentation over
  // materialLinesDisplay.ts (qualityChips / orderQualityPreview); renders nothing for an empty list.
  import type { QualityChip } from "./ui/materialLinesDisplay";
  import { formatNumber } from "./game/format";

  export let chips: readonly QualityChip[];
  // Names the group for assistive tech ("Titanium Ore by quality").
  export let label: string;
  // "x" before the amount: the order breakdown's "Q0 x30" (units taken) rather than a stock count.
  export let times = false;
</script>

{#if chips.length > 0}
  <span class="qc" role="group" aria-label={label}>
    {#each chips as c (c.quality)}
      <span class="qc-chip" class:hi={c.quality > 0}>Q{c.quality} {times ? "x" : ""}{formatNumber(c.amount)}</span>
    {/each}
  </span>
{/if}

<style>
  .qc { display: inline-flex; flex-wrap: wrap; gap: 3px; vertical-align: middle; }
  .qc-chip {
    font-family: var(--font-mono);
    font-size: calc(10.5px * var(--ui-scale, 1));
    line-height: 1.5;
    padding: 0 4px;
    border: 1px solid var(--color-border);
    border-radius: var(--corner);
    color: var(--color-text-secondary);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .qc-chip.hi { color: var(--color-accent-bright); border-color: var(--color-border-strong); }
</style>
