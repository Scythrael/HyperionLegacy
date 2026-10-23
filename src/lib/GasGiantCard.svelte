<script lang="ts">
  // GasGiantCard.svelte: the GAS GIANT BODY CARD of a study run (0.14.0, Gas Giant Study GG-6; the signed-off v3
  // mockup section 2, "approve as is" 2026-10-21): a tab per orbital body, then the giant's portrait and feature, its
  // physics ("mass is its own number"), how close it came to becoming a star, the canister band odds, the pressure
  // column (the probe's dive depth against the 1995 Galileo probe's 22 bar), the probe rows (crush rating, depth factor,
  // study time, ancient data odds), the haul forecast and the chance per canister.
  //
  // POSTURE: pure presentation over gasGiantStudyDisplay.ts giantCardView (tested). The tabs are a real tablist (arrow
  // keys move between them). One DOM, a container query lays the three columns side by side from 820 px; stacked below.

  import type { GiantCardView } from "./gasGiantStudyDisplay";
  import GiantArt from "./GiantArt.svelte";
  import StarBar from "./StarBar.svelte";
  import Icon from "./ui/Icon.svelte";

  export let cards: GiantCardView[];
  // A unique prefix (one card set per run).
  export let idBase: string;

  let selected = 0;
  $: if (selected >= cards.length) selected = 0;
  $: card = cards[selected] ?? null;

  const tabEls: HTMLButtonElement[] = [];
  function onKey(e: KeyboardEvent, i: number): void {
    let to = -1;
    if (e.key === "ArrowRight") to = (i + 1) % cards.length;
    else if (e.key === "ArrowLeft") to = (i - 1 + cards.length) % cards.length;
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = cards.length - 1;
    if (to < 0) return;
    e.preventDefault();
    selected = to;
    tabEls[to]?.focus();
  }

  // The column's drawing: y from the fraction down the column (the mockup's 250 unit tall column from y 18).
  const colY = (frac: number): number => 18 + frac * 250;
</script>

{#if card}
  <section class="gg-wrap" aria-label="Gas giant body card">
    {#if cards.length > 1}
      <div class="gg-tabs" role="tablist" aria-label="Gas giants of this system">
        {#each cards as c, i (c.bodyIndex)}
          <button
            type="button"
            role="tab"
            id="{idBase}-tab-{i}"
            aria-selected={i === selected}
            aria-controls="{idBase}-panel"
            tabindex={i === selected ? 0 : -1}
            bind:this={tabEls[i]}
            on:click={() => (selected = i)}
            on:keydown={(e) => onKey(e, i)}
          >{c.tabLabel}</button>
        {/each}
      </div>
    {/if}
    <div class="gg" id="{idBase}-panel" role={cards.length > 1 ? "tabpanel" : undefined} aria-labelledby={cards.length > 1 ? `${idBase}-tab-${selected}` : undefined}>
      <div class="gg-art">
        <GiantArt giant={card.art} label={card.name} idBase="{idBase}-art-{card.bodyIndex}" />
        <div class="gg-dim gg-center">{card.feature}</div>
      </div>

      <div class="gg-col">
        <div class="gg-dim">{card.designation}</div>
        <h4 class="gg-name">{card.name}</h4>
        <dl class="gg-kv">
          {#each card.kv as row (row.label)}
            <dt>{row.label}</dt>
            <dd class:mono={row.mono}>{row.value}</dd>
          {/each}
        </dl>
        <h4 class="gg-h">How close to a star</h4>
        <StarBar star={card.star} />
        <h4 class="gg-h">Canister band</h4>
        <div class="gg-bar" role="img" aria-label="Canister band odds: {card.bandsText}">
          {#each card.bands as b (b.band)}<i class="b-{b.band}" style="width: {b.pct}%;"></i>{/each}
        </div>
        <div class="gg-dim mono">{card.bandsText}</div>
      </div>

      <div class="gg-col">
        <h4 class="gg-h">Dive depth vs crush rating</h4>
        <svg class="gg-colsvg" viewBox="0 0 340 280" role="img" aria-label={card.column.ariaLabel}>
          <defs>
            <linearGradient id="{idBase}-cg-{card.bodyIndex}" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color={card.art.palette[0]} stop-opacity=".5" />
              <stop offset="1" stop-color={card.art.palette[3]} stop-opacity=".9" />
            </linearGradient>
          </defs>
          <rect x="52" y="18" width="120" height="250" fill="url(#{idBase}-cg-{card.bodyIndex})" rx="2" />
          {#each card.column.ticks as t (t.label)}
            <text x="46" y={colY(t.frac) + 3} font-size="9" text-anchor="end" fill="currentColor" opacity=".6">{t.label}</text>
          {/each}
          {#each card.column.layers as l (l.label)}
            <line x1="52" x2="172" y1={colY(l.frac)} y2={colY(l.frac)} stroke="currentColor" stroke-opacity=".35" stroke-dasharray="3 3" />
            <text x="178" y={colY(l.frac) + 4} font-size="10" fill="currentColor" opacity=".8">{l.label}</text>
          {/each}
          <line class="gg-warn-stroke" x1="52" x2="172" y1={colY(card.column.galileoFrac)} y2={colY(card.column.galileoFrac)} stroke-width="1.5" />
          <text class="gg-warn-fill" x="178" y={colY(card.column.galileoFrac) + 4} font-size="10">Galileo, 1995: 22 bar</text>
          {#if card.column.diveFrac !== null}
            <line class="gg-acc-stroke" x1="52" x2="172" y1={colY(card.column.diveFrac)} y2={colY(card.column.diveFrac)} stroke-width="2.5" />
            <g class="gg-acc-stroke" transform="translate(96 {colY(card.column.diveFrac) - 20})" fill="none" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
              <path d="M7 11a5 5 0 0 1 10 0v3H7z M5 14h14l-2.5 3.5h-9z M12 6V3" />
            </g>
            <text class="gg-acc-fill" x="178" y={colY(card.column.diveFrac) + 4} font-size="10.5" font-weight="700">{card.column.diveText}</text>
          {/if}
        </svg>
        <dl class="gg-probe">
          {#each card.probeRows as row (row.label)}
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          {/each}
        </dl>
        <h4 class="gg-h">Canister haul forecast</h4>
        <p class="gg-haul"><b class="mono">{card.haulText}</b> <span class="gg-dim">{card.haulNote}</span></p>
        <div class="gg-odds">
          {#each card.odds as o (o.id)}
            <span class="t-{o.band}" aria-hidden="true"><Icon name={o.glyph} size={16} /></span>
            <span>{o.name} <span class="gg-dim">{o.bandText}</span></span>
            <span class="mono">{o.chanceText}</span>
          {/each}
        </div>
        <p class="gg-dim">{card.oddsNote}</p>
      </div>
    </div>
  </section>
{/if}

<style>
  .gg-wrap {
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
  }
  .gg-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .gg-tabs button {
    font: inherit;
    font-size: var(--text-xs);
    min-height: 28px;
    padding: 4px 10px;
    background: transparent;
    color: var(--color-text-secondary);
    border: 1px solid rgba(var(--color-accent-rgb), 0.25);
    border-radius: var(--corner);
    cursor: pointer;
  }
  .gg-tabs button[aria-selected="true"] {
    background: var(--color-accent);
    border-color: var(--color-accent);
    color: var(--color-bg-deep);
  }
  .gg-tabs button:focus-visible {
    outline: 2px solid var(--color-accent-bright);
    outline-offset: 2px;
  }
  .gg {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 14px;
  }
  @container (min-width: 820px) {
    .gg {
      grid-template-columns: 200px minmax(0, 1fr) minmax(0, 1fr);
    }
  }
  .gg-art {
    display: grid;
    justify-items: center;
    align-content: start;
    gap: 6px;
  }
  .gg-center {
    text-align: center;
  }
  .gg-col {
    min-width: 0;
  }
  .gg-name {
    margin: 2px 0 0;
    font-family: var(--font-display);
    font-size: var(--text-sm);
    color: var(--color-text-primary);
  }
  .gg-h {
    margin: 10px 0 4px;
    font-family: var(--font-display);
    font-size: var(--text-xs);
    letter-spacing: 0.06em;
    color: var(--color-text-primary);
  }
  .gg-dim {
    font-size: var(--text-xs);
    color: var(--color-text-dim);
    margin: 0;
  }
  .mono {
    font-family: var(--font-mono);
  }
  .gg-kv,
  .gg-probe {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 3px 12px;
    margin: 8px 0;
    font-size: var(--text-xs);
  }
  .gg-probe {
    grid-template-columns: 112px minmax(0, 1fr);
  }
  .gg-kv dt,
  .gg-probe dt {
    color: var(--color-text-secondary);
  }
  .gg-kv dd,
  .gg-probe dd {
    margin: 0;
    color: var(--color-text-primary);
    overflow-wrap: anywhere;
  }
  .gg-bar {
    display: flex;
    height: 10px;
    margin-top: 6px;
    border-radius: var(--corner);
    overflow: hidden;
    border: 1px solid rgba(var(--color-accent-rgb), 0.2);
  }
  .gg-bar i {
    display: block;
    height: 100%;
  }
  .b-standard { background: var(--rarity-standard); }
  .b-augmented { background: var(--rarity-augmented); }
  .b-stellar { background: var(--rarity-stellar); }
  .b-radiant { background: var(--rarity-radiant); }
  .t-standard { color: var(--rarity-standard); }
  .t-augmented { color: var(--rarity-augmented); }
  .t-stellar { color: var(--rarity-stellar); }
  /* The radiant violet is lifted toward white for text and glyphs on the dark panel (the mockup's radiant ink). */
  .t-radiant { color: color-mix(in srgb, var(--rarity-radiant) 65%, #fff); }
  .gg-colsvg {
    width: 100%;
    height: auto;
    max-height: 300px;
    color: var(--color-text-secondary);
  }
  .gg-warn-stroke { stroke: var(--color-warning); }
  .gg-warn-fill { fill: var(--color-warning); }
  .gg-acc-stroke { stroke: var(--color-accent-bright); }
  .gg-acc-fill { fill: var(--color-accent-bright); }
  .gg-haul {
    margin: 0;
    font-size: var(--text-sm);
  }
  .gg-odds {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 3px 8px;
    align-items: center;
    font-size: var(--text-xs);
    margin: 8px 0;
  }
</style>
