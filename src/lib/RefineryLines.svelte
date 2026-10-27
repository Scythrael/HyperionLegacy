<script lang="ts">
  // RefineryLines.svelte: the Refinery's recipes grouped by MATERIAL LINE (0.14.0 ML-7; the signed-off Refinery mockup,
  // user 2026-10-21 "I approve all 4 mockups as is"). Each line is a collapsible box: its name, glyph and source
  // missions, its raws (each expands to its per-quality stock), then one row per recipe with the formula, the stock in
  // hand split by quality, and an Order button that opens the production configurator on that recipe. Compounds sit
  // with their main raw's line; there is no "more recipes" note (recorded picks, merge-batch answers 2026-10-21).
  //
  // POSTURE: pure presentation over materialLinesDisplay.ts (refineryLineViews, qualityChips, recipeFormula), tested
  // in node. Ordering is the parent's (onOrder); nothing here starts a job.
  import type { GameState } from "./game/model";
  import { ITEMS, REFINE_RECIPES } from "./game/model";
  import { itemTotal } from "./game/inventory";
  import { formatNumber } from "./game/format";
  import { qualityChips, recipeFormula, refineryLineViews } from "./ui/materialLinesDisplay";
  import QualityChips from "./QualityChips.svelte";
  import Icon from "./ui/Icon.svelte";

  export let state: GameState;
  // Opens the configurator on a recipe. Disabled (with `orderBlockedText` as the reason) while the Refinery is unbuilt.
  export let onOrder: (recipeKey: string) => void;
  export let canOrder = true;
  export let orderBlockedText = "";
  // The recipe's job length as the console words durations ("00:20", or "20 ticks (00:20)").
  export let durationOf: (recipeKey: string) => string = () => "";

  // Static content (recipe tables), so computed once.
  const lines = refineryLineViews();
  const label = (id: string): string => ITEMS[id]?.label ?? id;
</script>

<div class="rl">
  {#each lines as line (line.def.key)}
    {@const recipeWord = line.recipes.length === 1 ? "recipe" : "recipes"}
    <details class="rl-line" open>
      <summary class="rl-head">
        <span class="rl-glyph"><Icon name={line.def.icon} size={16} /></span>
        <b class="rl-name">{line.def.label}</b>
        {#if line.sources}<span class="rl-src">{line.sources}</span>{/if}
        <span class="rl-count">{line.recipes.length} {recipeWord}</span>
      </summary>
      <div class="rl-raws">
        {#each line.raws as raw (raw)}
          {@const chips = qualityChips(state.inventory, raw)}
          <details class="rl-raw">
            <summary>{label(raw)} <b class="rl-num">{formatNumber(itemTotal(state.inventory, raw))}</b></summary>
            {#if chips.length > 0}
              <QualityChips {chips} label="{label(raw)} by quality" />
            {:else}
              <span class="rl-none">None in stock</span>
            {/if}
          </details>
        {/each}
      </div>
      {#each line.recipes as key (key)}
        {@const out = REFINE_RECIPES[key].output.itemId}
        {@const dur = durationOf(key)}
        <div class="rl-recipe">
          <div class="rl-what">
            <b>{label(out)}</b>
            <div class="rl-formula">{recipeFormula(key)}{dur ? ` · ${dur}` : ""}</div>
          </div>
          <div class="rl-stock">
            In stock <b class="rl-num">{formatNumber(itemTotal(state.inventory, out))}</b>
            <QualityChips chips={qualityChips(state.inventory, out)} label="{label(out)} by quality" />
          </div>
          <button
            type="button"
            class="rl-order"
            disabled={!canOrder}
            title={canOrder ? undefined : orderBlockedText}
            aria-label="Order {label(out)}"
            on:click={() => onOrder(key)}
          ><Icon name="refinery" size={12} /> Order</button>
        </div>
      {/each}
    </details>
  {/each}
  {#if !canOrder && orderBlockedText}
    <p class="rl-note">{orderBlockedText}</p>
  {/if}
</div>

<style>
  .rl { display: grid; gap: 10px; min-width: 0; container-type: inline-size; }
  .rl-line { border: 1px solid var(--color-border); border-radius: var(--corner); background: var(--color-panel-bg-strong); min-width: 0; }
  .rl-line > summary { list-style: none; cursor: pointer; }
  .rl-line > summary::-webkit-details-marker { display: none; }
  .rl-head { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; padding: 9px 11px; color: var(--color-text-primary); font-size: var(--text-sm); }
  .rl-head::before { content: "+"; color: var(--color-accent); font-family: var(--font-mono); width: 0.8em; }
  .rl-line[open] > .rl-head::before { content: "\2212"; }
  .rl-line[open] > .rl-head { border-bottom: 1px solid var(--color-border); }
  .rl-glyph { color: var(--color-accent); display: inline-flex; }
  .rl-src { font-size: var(--text-xs); color: var(--color-text-secondary); }
  .rl-count { margin-left: auto; font-size: var(--text-xs); color: var(--color-text-dim); }
  .rl-raws { padding: 7px 11px; display: grid; gap: 3px; font-size: var(--text-xs); }
  .rl-raw > summary { list-style: none; cursor: pointer; color: var(--color-text-secondary); }
  .rl-raw > summary::-webkit-details-marker { display: none; }
  .rl-raw > summary::before { content: "+ "; color: var(--color-accent); font-family: var(--font-mono); }
  .rl-raw[open] > summary::before { content: "\2212  "; }
  .rl-raw[open] { padding-bottom: 3px; }
  .rl-raw[open] > :global(.qc), .rl-raw[open] > .rl-none { margin: 3px 0 0 14px; }
  .rl-none { display: inline-block; color: var(--color-text-dim); }
  .rl-num { color: var(--color-text-primary); font-variant-numeric: tabular-nums; }
  .rl-recipe { display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; padding: 9px 11px; border-top: 1px solid var(--color-border); align-items: center; }
  .rl-raws + .rl-recipe { border-top: 1px solid var(--color-border); }
  .rl-what { min-width: 0; font-size: var(--text-sm); color: var(--color-text-primary); }
  .rl-formula { font-size: var(--text-xs); color: var(--color-text-secondary); margin-top: 1px; }
  .rl-stock { font-size: var(--text-xs); color: var(--color-text-secondary); display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; }
  .rl-order {
    justify-self: start;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: rgba(var(--color-accent-rgb), 0.15);
    border: 1px solid var(--color-border-strong);
    padding: 5px 9px;
    color: var(--color-accent-bright);
    font-size: var(--text-xs);
    font-family: var(--font-mono);
    cursor: pointer;
  }
  .rl-order:disabled { cursor: not-allowed; opacity: 0.6; }
  .rl-note { margin: 0; font-size: var(--text-xs); color: var(--color-text-secondary); }
  /* Wide rows put the stock beside the name and the button at the end, as the mockup draws them; narrow rows stack
     (the button sits under the stock). A container query, because the list's own column decides, not the window. */
  @container (min-width: 560px) {
    .rl-recipe { grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr) auto; }
    .rl-order { justify-self: end; }
  }
</style>
