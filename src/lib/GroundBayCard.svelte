<script lang="ts">
  // GroundBayCard.svelte: one ground team's MEDICAL BAY card (0.14.0, Ground Operations GO-14, mockup GO-M4 right).
  // A bar per condition (members with the same condition and time share one), its cure time, ailment / injury /
  // health, Stoneskin marked on an Ossir member's injuries; everything heals at once, so the bay time is the
  // longest bar (highlighted). Shown while the team carries its conditions home and through its bay. Pure
  // presentation over groundOpsTimelineDisplay.ts bayCardView (tested).

  import { BAY_CARD_NOTE, type BayCardView } from "./groundOpsTimelineDisplay";
  import Icon from "./ui/Icon.svelte";
  import TeamBadge from "./ui/TeamBadge.svelte";

  export let card: BayCardView;
</script>

<article class="gbc" aria-label={card.title}>
  <div class="gbc-top">
    <span class="gbc-glyph" aria-hidden="true"><Icon name="medBay" size={18} /></span>
    <TeamBadge index={card.teamIndex} name={card.name} size="sm" />
    <span class="gbc-title">{card.title}</span>
    <span class="gbc-status" class:on={card.inBay}>{card.statusText}</span>
  </div>
  <p class="gbc-lede">{BAY_CARD_NOTE}</p>
  <ul class="gbc-rows">
    {#each card.rows as row (row.key)}
      <li class="gbc-row" class:long={row.longest}>
        <span class="gbc-cond">
          <span class="gbc-cond-name">{row.label}</span>
          <span class="gbc-who">{row.who}</span>
        </span>
        <span class="gbc-meter" aria-hidden="true"><i style="width: {row.widthPct}%;"></i></span>
        <span class="gbc-time">{row.timeText}</span>
      </li>
    {/each}
  </ul>
  <p class="gbc-total">{card.bayText}</p>
  {#if card.stoneskinNote}<p class="gbc-note">{card.stoneskinNote}</p>{/if}
  {#if card.careText}<p class="gbc-note">{card.careText}</p>{/if}
</article>

<style>
  .gbc {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px;
    min-width: 0;
    border: 1px solid color-mix(in srgb, var(--color-success) 40%, transparent);
    border-radius: var(--corner);
    background: color-mix(in srgb, var(--color-success) 5%, transparent);
  }
  .gbc-top {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .gbc-glyph {
    display: inline-flex;
    color: var(--color-success);
  }
  .gbc-title {
    font-family: var(--font-display);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--color-text-primary);
  }
  .gbc-status {
    margin-left: auto;
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
  }
  .gbc-status.on {
    color: var(--color-success);
  }
  .gbc-lede,
  .gbc-total,
  .gbc-note {
    margin: 0;
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
  }
  .gbc-total {
    color: var(--color-text-primary);
    font-weight: 600;
  }
  .gbc-rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .gbc-row {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(50px, 1fr) 64px;
    gap: 8px;
    align-items: center;
    font-size: var(--text-xs);
  }
  .gbc-cond {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .gbc-cond-name {
    color: var(--color-text-primary);
  }
  .gbc-who {
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
    overflow-wrap: anywhere;
  }
  .gbc-meter {
    height: 8px;
    border-radius: 4px;
    background: var(--color-bg-mid);
    border: 1px solid rgba(var(--color-accent-rgb), 0.12);
    overflow: hidden;
  }
  .gbc-meter i {
    display: block;
    height: 100%;
    background: var(--color-success);
  }
  .gbc-row.long .gbc-meter i {
    background: var(--color-warning);
  }
  .gbc-row.long .gbc-time {
    color: var(--color-warning);
    font-weight: 600;
  }
  .gbc-time {
    font-family: var(--font-mono);
    text-align: right;
    color: var(--color-text-secondary);
  }
</style>
