<script lang="ts">
  // GasCanisterShelf.svelte: the warehouse Materials tab's GAS STORAGE CANISTERS section (0.14.0, Gas Giant Study GG-6;
  // the signed-off v3 mockup section 5, "approve as is" 2026-10-21; the user's category name, 2026-10-08): a tile per
  // canister with its band's color edge, glyph, name, band and count, and the selected canister's detail card (held,
  // where it comes from, what uses it, what it sells for, the Refinery recipe). The five gases share one glyph, the
  // antimatter cell has its own (user 2026-10-21).
  //
  // GG-6 review: each tile carries the warehouse grid's fill (percent and bar) and its red full state, and the detail
  // card says "Full (cap N)": the claim clamps at the cap, so a full shelf must never look roomy (stockFillDisplay.ts).
  //
  // POSTURE: pure presentation over gasGiantStudyDisplay.ts canisterDetailView (tested; its sources and uses are read
  // off the content tables and every blueprint recipe). Selling stays the Quartermaster's. One DOM; the tile grid goes
  // 2, 3 and 6 across with the panel's width.

  import type { GameState } from "./game/model";
  import { GAS_CANISTER_IDS, type GasCanisterId } from "./game/gasGiantContent";
  import { stockFill } from "./stockFillDisplay";
  import { ITEMS } from "./game/model";
  import { canisterDetailView } from "./gasGiantStudyDisplay";
  import { GAS_CANISTER_ICON } from "./ui/gasStudyIcons";
  import Icon from "./ui/Icon.svelte";
  // The same number format as every other warehouse count.
  import { formatNumber } from "./game/format";

  export let state: GameState;
  // Only the canisters of the selected warehouse tier (all six are tier 1 today).
  export let ids: readonly string[] = GAS_CANISTER_IDS;

  $: shown = GAS_CANISTER_IDS.filter((id) => ids.includes(id));
  let selected: GasCanisterId = "deuteriumCanister";
  $: if (!shown.includes(selected) && shown.length > 0) selected = shown[0];
  $: detail = canisterDetailView(selected);
  $: discovered = state.discovered.includes(selected);
  $: fill = stockFill(state, selected);
</script>

{#if shown.length > 0}
  <div class="gc-wrap">
    <div class="gc-shelf" role="group" aria-label="Gas Storage Canisters">
      {#each shown as id (id)}
        {@const item = ITEMS[id]}
        {@const known = state.discovered.includes(id)}
        {@const f = stockFill(state, id)}
        <button
          type="button"
          class="gc-tile b-{item?.band ?? 'standard'}"
          class:full={f.full}
          aria-pressed={id === selected}
          aria-controls="gc-detail"
          on:click={() => (selected = id)}
        >
          <span class="gc-glyph t-{item?.band ?? 'standard'}" aria-hidden="true"><Icon name={GAS_CANISTER_ICON[id]} size={28} /></span>
          <span class="gc-nm">{item?.label ?? id}</span>
          <span class="gc-band t-{item?.band ?? 'standard'}">{item?.band ?? "standard"}</span>
          <span class="gc-ct">{known ? `x${formatNumber(f.held)}` : "Not found yet"}</span>
          {#if known && f.cap !== null}
            <span class="gc-fillrow">
              <span class="gc-fill" aria-hidden="true"><i style="width: {f.pct}%;"></i></span>
              <span class="gc-pct">{f.full ? "Full" : `${f.pct}%`}</span>
            </span>
          {/if}
        </button>
      {/each}
    </div>
    <div class="gc-detail" id="gc-detail" aria-live="polite">
      <div class="gc-row">
        <span class="t-{detail.band}" aria-hidden="true"><Icon name={GAS_CANISTER_ICON[detail.id]} size={40} /></span>
        <div>
          <b>{detail.label}</b> <span class="gc-chip t-{detail.band}">{detail.bandText}</span>
          <div class="gc-muted">{discovered ? detail.flavor : ITEMS[detail.id]?.unlockHint ?? ""}</div>
        </div>
      </div>
      <dl class="gc-kv">
        <dt>Held</dt>
        <dd class="mono">{formatNumber(fill.held)}{#if fill.cap !== null} / {formatNumber(fill.cap)}{/if}</dd>
        {#if fill.full && fill.cap !== null}
          <dt>Shelf</dt>
          <dd class="gc-full">Full (cap {formatNumber(fill.cap)}): canisters past the cap are not kept. Expand the Warehouse.</dd>
        {/if}
        <dt>Source</dt>
        <dd>{detail.source}</dd>
        <dt>Used in</dt>
        <dd>{detail.usedIn}</dd>
        {#if detail.sellValue !== null}
          <dt>Sells for</dt>
          <dd class="mono"><Icon name="credits" size={14} /> {detail.sellValue.toLocaleString("en-US")} each</dd>
        {/if}
      </dl>
      {#if detail.refinery}
        <div class="gc-row"><span class="gc-chip"><Icon name="refinery" size={14} /> {detail.refinery}</span></div>
      {/if}
      <p class="gc-dim">The five gases share one canister glyph for now; the cell has its own.</p>
    </div>
  </div>
{/if}

<style>
  .gc-wrap {
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .gc-shelf {
    display: grid;
    gap: 8px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  @container (min-width: 640px) {
    .gc-shelf {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
  @container (min-width: 980px) {
    .gc-shelf {
      grid-template-columns: repeat(6, minmax(0, 1fr));
    }
  }
  .gc-tile {
    font: inherit;
    text-align: left;
    color: var(--color-text-primary);
    background: rgba(var(--color-accent-rgb), 0.05);
    border: 1px solid rgba(var(--color-accent-rgb), 0.18);
    border-left-width: 3px;
    border-radius: var(--corner);
    padding: 10px;
    cursor: pointer;
    display: grid;
    gap: 4px;
    min-width: 0;
  }
  .gc-tile[aria-pressed="true"] {
    border-color: var(--color-accent-bright);
  }
  .gc-tile:focus-visible {
    outline: 2px solid var(--color-accent-bright);
    outline-offset: 2px;
  }
  .gc-tile.full {
    border-color: var(--color-danger);
  }
  .gc-fillrow {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .gc-fill {
    flex: 1;
    height: 4px;
    border-radius: 2px;
    background: rgba(var(--color-accent-rgb), 0.14);
    overflow: hidden;
  }
  .gc-fill i {
    display: block;
    height: 100%;
    background: var(--color-accent-bright);
  }
  .gc-tile.full .gc-fill i {
    background: var(--color-danger);
  }
  .gc-pct {
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    color: var(--color-text-secondary);
  }
  .gc-tile.full .gc-pct,
  .gc-full {
    color: var(--color-danger);
  }
  .gc-tile.b-standard { border-left-color: var(--rarity-standard); }
  .gc-tile.b-augmented { border-left-color: var(--rarity-augmented); }
  .gc-tile.b-stellar { border-left-color: var(--rarity-stellar); }
  .gc-tile.b-radiant { border-left-color: var(--rarity-radiant); }
  .t-standard { color: var(--rarity-standard); }
  .t-augmented { color: var(--rarity-augmented); }
  .t-stellar { color: var(--rarity-stellar); }
  .t-radiant { color: color-mix(in srgb, var(--rarity-radiant) 65%, #fff); }
  .gc-glyph {
    display: inline-flex;
  }
  .gc-nm {
    font-size: var(--text-xs);
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .gc-band {
    font-size: var(--text-2xs);
    text-transform: capitalize;
  }
  .gc-ct {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }
  .gc-detail {
    padding: 12px;
    border: 1px solid rgba(var(--color-accent-rgb), 0.16);
    border-radius: var(--corner);
    background: rgba(var(--color-accent-rgb), 0.04);
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  .gc-row {
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;
    min-width: 0;
  }
  .gc-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: var(--text-2xs);
    padding: 2px 8px;
    border: 1px solid rgba(var(--color-accent-rgb), 0.2);
    border-radius: var(--corner);
    text-transform: capitalize;
    max-width: 100%;
    overflow-wrap: anywhere;
  }
  .gc-row > .gc-chip {
    text-transform: none;
  }
  .gc-muted {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }
  .gc-kv {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 3px 12px;
    margin: 4px 0;
    font-size: var(--text-xs);
  }
  .gc-kv dt {
    color: var(--color-text-secondary);
  }
  .gc-kv dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .mono {
    font-family: var(--font-mono);
  }
  .gc-dim {
    margin: 0;
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
  }
</style>
