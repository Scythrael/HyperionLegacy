<script lang="ts">
  // ============================================================================
  // MuseumV2Panel.svelte: the Archive's MUSEUM v2 page (Relics v2 R2-8; the signed-off Relics v2 mockup, 2026-10-21
  // "as drawn": shelves by rarity band per tier, the hatched past-cap bar, culture samples under each type; R2-7's
  // exceptional set cards by tier with Roman numeral tabs).
  //
  // One region tier at a time (pills Tier I to Tier VII in the tier colors): the soft cap meter (identified relics of the
  // tier against 1,000; past it the extra count shows hatched and the regular game reads the snapshot), the tier's own
  // bonuses (what the engine reads), the general relics on band shelves with their culture samples, and the tier's
  // exceptional sets. Tier I also keeps its set ladder (MuseumPanel: Tier I veterans keep the v1 math, R2-4).
  // Pure display; every number is the engine's (relicsV2Display.ts).
  // ============================================================================

  import type { GameState, RegionTier } from "./game/model";
  import { REGION_TIER_LIST, RELIC_SOFT_CAP } from "./game/relics";
  import { regionTierNumeral } from "./game/galaxy";
  import Icon from "./ui/Icon.svelte";
  import MuseumPanel from "./MuseumPanel.svelte";
  import { bandColor, exceptionalPiecesHeld, generalCopiesTotal, museumTierView, regionTierColor, tierLabel } from "./relicsV2Display";

  export let state: GameState;

  let tier: RegionTier = 1;
  $: view = museumTierView(state, tier);
  $: general = generalCopiesTotal(state);
  $: pieces = exceptionalPiecesHeld(state);
  const fmt = (n: number) => n.toLocaleString("en-US");
</script>

<div class="mv">
  <div class="mv-sum">
    <span>General relics <b>{fmt(general)}</b></span>
    <span>Exceptional pieces <b>{pieces}</b> of 54</span>
  </div>
  <div class="mv-pills" role="group" aria-label="Region tier">
    {#each REGION_TIER_LIST as t (t)}
      <button type="button" style="color: {regionTierColor(t)};" aria-pressed={tier === t} on:click={() => (tier = t)}>Tier {regionTierNumeral(t)}</button>
    {/each}
  </div>

  <div class="mv-cap" style="--tc: {regionTierColor(tier)};">
    <div class="mv-cap-h">
      <b>{tierLabel(tier)} identified: <span class="mv-mono">{fmt(view.total)}</span> <span class="mv-dim">soft cap {fmt(RELIC_SOFT_CAP)}</span></b>
      {#if view.frozen}
        <span class="mv-chip warn"><Icon name="lock" size={12} /> Bonuses held at the cap snapshot</span>
      {:else}
        <span class="mv-chip">{fmt(view.untilCap)} until the cap</span>
      {/if}
    </div>
    <div class="mv-capbar" role="img" aria-label="{fmt(view.total)} of the {fmt(RELIC_SOFT_CAP)} soft cap">
      <span class="mv-fill" style="width: {view.fillPct}%;"></span>
      {#if view.overPct > 0}<span class="mv-over" style="left: {view.capPct}%; width: {view.overPct}%;"></span>{/if}
      <span class="mv-line" style="left: {view.capPct}%;"></span>
    </div>
    <p class="mv-dim">
      {#if view.frozen}
        {fmt(view.pastCap)} more counted past the cap. They keep counting and are shown, but the regular game reads the {fmt(RELIC_SOFT_CAP)} snapshot.
      {:else if tier === 1}
        Tier I bonuses come from each copy and the set ladder below. At {fmt(RELIC_SOFT_CAP)} this tier's bonuses are held for the regular game; the count keeps going.
      {:else}
        Each copy adds less than the one before (diminishing, never a wall). At {fmt(RELIC_SOFT_CAP)} this tier's bonuses are held for the regular game; the count keeps going.
      {/if}
    </p>
  </div>

  {#if view.bonuses.length > 0}
    <div>
      <h3 class="mv-h3">{tierLabel(tier)} museum bonuses</h3>
      <div class="mv-chips">
        {#each view.bonuses as b (b)}<span class="mv-chip">{b}</span>{/each}
      </div>
    </div>
  {/if}

  {#if view.total === 0}
    <p class="mv-dim">No {tierLabel(tier)} relics identified yet. {tierLabel(tier)} expeditions drop {tierLabel(tier)} blanks{#if tier > 1}, with better rarity odds than the tiers below{/if}.</p>
  {/if}

  {#each view.bands as b (b.band)}
    <div class="mv-band">
      <h3 class="mv-h3" style="color: {bandColor(b.band)};"><Icon name="relic" size={13} /> {b.label}</h3>
      <div class="mv-grid">
        {#each b.types as t (t.id)}
          <div class="mv-type" title={t.flavor}>
            <div class="mv-type-h">
              <span style="color: {bandColor(b.band)};"><Icon name={t.glyph} size={28} /></span>
              <span class="mv-type-n"><b>{t.label}</b><span class="mv-dim">{t.statText}</span></span>
              <span class="mv-count">{fmt(t.count)}</span>
            </div>
            {#if t.samples.length > 0}
              <details>
                <summary>Culture samples ({t.samples.length})</summary>
                <div class="mv-samples">
                  {#each t.samples as s (s.cultureId)}
                    <div class="mv-sample"><span>{s.name} <span class="mv-dim">{s.cultureName}</span></span><span class="mv-mono">{fmt(s.count)}</span></div>
                  {/each}
                </div>
              </details>
            {:else if t.count === 0}
              <p class="mv-dim">{t.opensAt !== null ? `Found in Tier ${regionTierNumeral(t.opensAt)}+ regions` : "None yet"}</p>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/each}

  <div class="mv-sets" style="--tc: {regionTierColor(tier)};">
    <h3 class="mv-h3"><span style="color: var(--tc);"><Icon name="exceptional" size={14} /></span> Exceptional sets, {tierLabel(tier)} <span class="mv-dim">({view.sets.length} set{view.sets.length === 1 ? "" : "s"}, pieces do not stack)</span></h3>
    {#each view.sets as s (s.id)}
      <div class="mv-set" title={s.flavor}>
        <div class="mv-set-h">
          <b>{s.label}</b>
          {#if s.complete}
            <span class="mv-chip ok"><Icon name="check" size={12} /> Complete</span>
          {:else}
            <span class="mv-chip">{s.held} / {s.size}</span>
          {/if}
        </div>
        <p class="mv-flavor">{s.flavor}</p>
        <div class="mv-pieces">
          {#each s.pieces as p (p.id)}
            <div class="mv-piece" class:missing={p.copies === 0} title={p.flavor ?? ""}>
              <span class="mv-piece-g"><Icon name="exceptional" size={20} /></span>
              <span>{p.label ?? "Not found yet"}</span>
              <span class="mv-dim">{p.statText}</span>
              {#if p.copies > 1}<span class="mv-chip">x{p.copies} (duplicates count, add no stat)</span>{/if}
            </div>
          {/each}
        </div>
        <p class="mv-full" class:on={s.complete}>Full set: <b>{s.fullSetText}</b>{s.complete ? " (active)" : ""}</p>
      </div>
    {/each}
  </div>

  {#if tier === 1}
    <div>
      <h3 class="mv-h3">Tier I set bonuses</h3>
      <MuseumPanel {state} />
    </div>
  {/if}
</div>

<style>
  .mv {
    display: grid;
    gap: 14px;
    container-type: inline-size;
  }
  .mv-sum {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }
  .mv-sum b {
    font-family: var(--font-mono);
    color: var(--color-text-primary);
  }
  .mv-pills {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .mv-pills button {
    border: 1px solid rgba(var(--color-accent-rgb), 0.2);
    background: transparent;
    border-radius: var(--corner);
    padding: 4px 10px;
    font-family: var(--font-display);
    font-size: var(--text-xs);
    cursor: pointer;
  }
  .mv-pills button[aria-pressed="true"] {
    border-color: currentColor;
    background: rgba(var(--color-accent-rgb), 0.08);
  }
  .mv-cap {
    display: grid;
    gap: 6px;
  }
  .mv-cap-h {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 6px;
    align-items: center;
    font-size: var(--text-sm);
    color: var(--color-text-primary);
  }
  .mv-capbar {
    position: relative;
    height: 12px;
    border-radius: var(--corner);
    background: rgba(var(--color-accent-rgb), 0.08);
    overflow: hidden;
  }
  .mv-fill {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--tc);
    opacity: 0.85;
  }
  .mv-over {
    position: absolute;
    top: 0;
    bottom: 0;
    background: repeating-linear-gradient(135deg, var(--tc) 0 4px, transparent 4px 8px);
    opacity: 0.6;
  }
  .mv-line {
    position: absolute;
    top: -2px;
    bottom: -2px;
    width: 2px;
    background: var(--color-text-primary);
  }
  .mv-dim {
    margin: 0;
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
    font-weight: normal;
  }
  .mv-mono {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
  }
  .mv-h3 {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    margin: 0 0 8px;
    font-family: var(--font-display);
    font-size: var(--text-xs);
    text-transform: uppercase;
    color: var(--color-text-secondary);
  }
  .mv-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .mv-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border: 1px solid rgba(var(--color-accent-rgb), 0.2);
    border-radius: var(--corner);
    padding: 1px 6px;
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
  }
  .mv-chip.warn {
    color: var(--color-warning);
    border-color: currentColor;
  }
  .mv-chip.ok {
    color: var(--color-success);
    border-color: currentColor;
  }
  .mv-grid {
    display: grid;
    gap: 8px;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr));
  }
  .mv-type {
    display: grid;
    gap: 6px;
    padding: 10px;
    border: 1px solid rgba(var(--color-accent-rgb), 0.16);
    border-radius: var(--corner);
    background: rgba(var(--color-accent-rgb), 0.04);
    min-width: 0;
  }
  .mv-type-h {
    display: flex;
    gap: 10px;
    align-items: center;
  }
  .mv-type-n {
    display: grid;
    min-width: 0;
    font-size: var(--text-xs);
    color: var(--color-text-primary);
  }
  .mv-count {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: var(--text-md);
    color: var(--color-text-primary);
  }
  details > summary {
    cursor: pointer;
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
  }
  .mv-samples {
    display: grid;
    gap: 3px;
    margin-top: 4px;
  }
  .mv-sample {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    font-size: var(--text-2xs);
    color: var(--color-text-primary);
  }
  .mv-sets {
    display: grid;
    gap: 10px;
  }
  .mv-set {
    display: grid;
    gap: 8px;
    padding: 10px;
    border: 1px solid rgba(var(--color-accent-rgb), 0.16);
    border-left: 3px solid var(--tc);
    border-radius: var(--corner);
  }
  .mv-set-h {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    align-items: center;
    color: var(--color-text-primary);
    font-size: var(--text-sm);
  }
  .mv-flavor {
    margin: 0;
    font-size: var(--text-2xs);
    font-style: italic;
    color: var(--color-text-secondary);
  }
  .mv-pieces {
    display: grid;
    gap: 6px;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 150px), 1fr));
  }
  .mv-piece {
    display: grid;
    gap: 3px;
    justify-items: start;
    padding: 8px;
    border: 1px solid rgba(var(--color-accent-rgb), 0.16);
    border-radius: var(--corner);
    font-size: var(--text-xs);
    color: var(--color-text-primary);
  }
  .mv-piece.missing {
    border-style: dashed;
    color: var(--color-text-dim);
  }
  .mv-piece-g {
    color: var(--tc);
    display: inline-flex;
  }
  .mv-piece.missing .mv-piece-g {
    color: var(--color-text-dim);
    opacity: 0.6;
  }
  .mv-full {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-dim);
  }
  .mv-full.on {
    color: var(--color-text-primary);
  }
</style>
