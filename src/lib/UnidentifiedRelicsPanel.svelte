<script lang="ts">
  // ============================================================================
  // UnidentifiedRelicsPanel.svelte: the Warehouse's UNIDENTIFIED RELICS row (Relics v2 R2-7; the user's datadump
  // "Unidentified Relics as the row in warehouse", plan section 4 R2-7: the tier by rarity matrix).
  //
  // Every blank in the vault, counted by region tier (rows, Roman numerals in the tier colors) and rarity band (columns
  // in the rarity colors), with a total; Identify jumps to the Research Lab's Identification tab. Pure display.
  // ============================================================================

  import type { GameState } from "./game/model";
  import { RELIC_BANDS } from "./game/relics";
  import { regionTierNumeral } from "./game/galaxy";
  import Icon from "./ui/Icon.svelte";
  import { BAND_LABEL, bandColor, regionTierColor, vaultMatrix } from "./relicsV2Display";

  export let state: GameState;
  export let onIdentify: () => void;

  $: m = vaultMatrix(state.relicVault ?? []);
</script>

<div class="ur">
  <div class="ur-h">
    <span class="ur-g"><Icon name="relic" size={16} /></span>
    <span class="ur-t">Unidentified Relics</span>
    <span class="ur-n">{m.total}</span>
    <button type="button" class="ur-btn" on:click={onIdentify}><Icon name="study" size={13} /> Identify</button>
  </div>
  {#if m.total === 0}
    <p class="ur-empty">No unidentified relics. Expeditions bring them home as blanks; identify them at the Research Lab.</p>
  {:else}
    <div class="ur-scroll">
      <!-- Rarity rows by region tier columns (only the tiers holding a blank), so seven tiers still fit at 375 px. -->
      <table class="ur-table">
        <thead>
          <tr>
            <th scope="col">Rarity</th>
            {#each m.rows as r (r.tier)}<th scope="col" style="color: {regionTierColor(r.tier)};" title="Tier {regionTierNumeral(r.tier)}"><span class="ur-sr">Tier </span>{regionTierNumeral(r.tier)}</th>{/each}
            <th scope="col">Total</th>
          </tr>
        </thead>
        <tbody>
          {#each RELIC_BANDS as b (b)}
            <tr>
              <th scope="row" style="color: {bandColor(b)};">{BAND_LABEL[b]}</th>
              {#each m.rows as r (r.tier)}<td class:zero={r.counts[b] === 0}>{r.counts[b]}</td>{/each}
              <td class="ur-tot" class:zero={m.bandTotals[b] === 0}>{m.bandTotals[b]}</td>
            </tr>
          {/each}
          <tr>
            <th scope="row">Total</th>
            {#each m.rows as r (r.tier)}<td class="ur-tot">{r.total}</td>{/each}
            <td class="ur-tot">{m.total}</td>
          </tr>
        </tbody>
      </table>
    </div>
  {/if}
</div>

<style>
  .ur {
    display: grid;
    gap: 8px;
  }
  .ur-h {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .ur-g {
    color: var(--color-accent-bright);
    display: inline-flex;
  }
  .ur-t {
    font-family: var(--font-display);
    font-size: var(--text-md);
    color: var(--color-text-primary);
  }
  .ur-n {
    font-family: var(--font-mono);
    color: var(--color-text-secondary);
  }
  .ur-btn {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 5px 10px;
    border-radius: var(--corner);
    border: 1px solid rgba(var(--color-accent-rgb), 0.4);
    background: rgba(var(--color-accent-rgb), 0.1);
    color: var(--color-text-primary);
    font-size: var(--text-xs);
    cursor: pointer;
  }
  .ur-empty {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-dim);
  }
  .ur-scroll {
    overflow-x: auto;
  }
  .ur-table {
    border-collapse: collapse;
    width: 100%;
    font-size: var(--text-xs);
    font-family: var(--font-mono);
  }
  .ur-table th,
  .ur-table td {
    padding: 5px 8px;
    text-align: right;
    border-bottom: 1px solid rgba(var(--color-accent-rgb), 0.1);
  }
  .ur-table th:first-child {
    text-align: left;
  }
  .ur-table thead th {
    font-size: var(--text-2xs);
    font-weight: 600;
  }
  .ur-table td {
    color: var(--color-text-primary);
  }
  .ur-table td.zero {
    color: var(--color-text-dim);
  }
  /* Read by screen readers only: a bare numeral header says "Tier II". */
  .ur-sr {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }
  .ur-tot {
    font-weight: 600;
  }
</style>
