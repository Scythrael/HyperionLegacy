<script lang="ts">
  // CraftQualityPreview.svelte: a craft order's "This order uses" per-quality breakdown and its "Carried quality"
  // readout (0.14.0 ML-7; the signed-off Refinery mockup's order panel, user 2026-10-21 "approve as is"). It sits
  // under the "Use best materials" switch on the Refinery's configurator and on the Fabricator's for a stackable
  // output (equipment carries no quality until ML-5, so the parent shows this only where a job really carries it).
  //
  // POSTURE: pure presentation over materialLinesDisplay.ts orderQualityPreview, which walks the stock with the
  // engine's own drawQualityTally / removeItem* / carriedQuality calls. The carried figure is the NEXT job's: each run
  // of an order is its own job and stamps its own average (materialLinesDisplay.test.ts starts the real job and
  // compares its stamped inputQuality).
  import type Decimal from "break_infinity.js";
  import { ITEMS } from "./game/model";
  import { formatNumber } from "./game/format";
  import { CONTENDED_STOCK_NOTE, averageText, laterRunsText, orderQualityPreview } from "./ui/materialLinesDisplay";
  import QualityChips from "./QualityChips.svelte";
  import Icon from "./ui/Icon.svelte";

  export let inventory: Record<string, Decimal[]>;
  // One run's inputs (lineInputsPerIteration, the map the line engine hands startProcess).
  export let perRun: Record<string, Decimal>;
  export let runs: number;
  // The "Use best materials" switch.
  export let best: boolean;
  // Each input's FREE stock (the REQUIRES "Free" figure), so "short" agrees with the disabled Start button.
  export let free: Readonly<Record<string, Decimal>> | undefined = undefined;
  // True when other orders draw this stock first: the form is the queue's, or another line or queued order holds some
  // of an input. The readout is "if started now", so it then says the carried quality may differ.
  export let contended = false;

  $: preview = orderQualityPreview(inventory, perRun, runs, best, free);
  $: later = laterRunsText(preview);
</script>

<div class="cqp">
  <div class="cqp-hd">
    <span class="cqp-h"><Icon name="warehouse" size={12} /> THIS ORDER USES</span>
    <span class="cqp-rule"></span>
  </div>
  {#each preview.inputs as use (use.itemId)}
    <div class="cqp-row">
      <span>{formatNumber(use.need)} {ITEMS[use.itemId]?.label ?? use.itemId}</span>
      <span class="cqp-take">
        <QualityChips chips={use.used} times label="{ITEMS[use.itemId]?.label ?? use.itemId} used by quality" />
        {#if use.short.gt(0)}<span class="cqp-short">short {formatNumber(use.short)}</span>{/if}
      </span>
    </div>
  {/each}
  <div class="cqp-row cqp-carried">
    <span>Carried quality</span>
    <!-- carriedQualityText(preview), with the rung in bold as the mockup draws it. -->
    <span class="cqp-v">average {averageText(preview.firstAverage)} = <b>Q{preview.firstCarried}</b>, then the roll</span>
  </div>
  {#if later}
    <p class="cqp-note">{later}</p>
  {/if}
  {#if contended}
    <p class="cqp-note">{CONTENDED_STOCK_NOTE}</p>
  {/if}
</div>

<style>
  .cqp { margin-top: 8px; display: grid; gap: 5px; min-width: 0; }
  .cqp-hd { display: flex; align-items: center; gap: 8px; }
  .cqp-h {
    font-family: var(--font-display);
    font-size: var(--text-xs);
    letter-spacing: 0.09em;
    color: var(--color-text-secondary);
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .cqp-rule { flex: 1; height: 1px; background: var(--color-border); }
  .cqp-row {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: 3px 10px;
    font-size: calc(11px * var(--ui-scale, 1));
    color: var(--color-text-primary);
  }
  .cqp-take { display: inline-flex; flex-wrap: wrap; gap: 3px; justify-content: flex-end; }
  .cqp-short {
    font-family: var(--font-mono);
    font-size: calc(10.5px * var(--ui-scale, 1));
    padding: 0 4px;
    border: 1px solid var(--color-danger);
    border-radius: var(--corner);
    color: var(--color-danger);
  }
  .cqp-carried { margin-top: 2px; }
  .cqp-v { font-family: var(--font-mono); color: var(--color-text-primary); }
  .cqp-note { margin: 0; font-size: calc(10.5px * var(--ui-scale, 1)); line-height: 1.4; color: var(--color-text-secondary); }
</style>
