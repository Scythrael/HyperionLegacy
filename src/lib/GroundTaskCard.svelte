<script lang="ts">
  // GroundTaskCard.svelte: one objective's PROGRESS card on a running Ground Operations window (0.14.0, Ground Operations
  // GO-14, mockup GO-M4 left): name, state chip ("In progress", "Paused: Alpha in the med bay", "Done", "Skipped"),
  // the crew's badges, the progress bar with a pip per fight point (won, under way, lost or wiped here: the bar
  // holds at the point after a wipe and the retry resumes there), the cleared / held point, the haul banked vs
  // offloaded, notes (an ambush retreat, a surprise fight, reinforcements, an edit's stop), the affix pills and the
  // alert (objective affixes: Reinforcing; "Impossible: resets in 24m" while held) and the haul offloaded so far.
  // Replaces the GO-7b activity readout. Pure presentation over groundOpsTimelineDisplay.ts taskCardView (tested).

  import type { TaskCardView } from "./groundOpsTimelineDisplay";
  import ObjectiveAffixes from "./ObjectiveAffixes.svelte";
  import Icon from "./ui/Icon.svelte";
  import TeamBadge from "./ui/TeamBadge.svelte";

  export let card: TaskCardView;

  function tierLabel(tier: string): string {
    return tier.charAt(0).toUpperCase() + tier.slice(1);
  }
</script>

<article class="gtc s-{card.state}" aria-label="{card.name}, {card.stateText}">
  <div class="gtc-top">
    <div class="gtc-id">
      <span class="gtc-name">{card.name}</span>
      <span class="gtc-where">{card.where}</span>
    </div>
    <span class="gtc-chip s-{card.state}">{card.stateText}</span>
  </div>

  {#if card.flavor}<div class="gtc-flavor">{card.flavor}</div>{/if}

  {#if card.affixes}<ObjectiveAffixes view={card.affixes} />{/if}

  {#if card.crew.length > 0}
    <div class="gtc-crew">
      {#each card.crew as c (c.index)}
        <span class="gtc-crew-one"><TeamBadge index={c.index} name={c.name} size="sm" /> {c.name}</span>
      {/each}
    </div>
  {/if}

  <div class="gtc-bar" role="img" aria-label={card.barLabel}>
    <div class="gtc-fill" style="width: {card.progressPct}%;"></div>
    {#each card.pips as pip, i (i)}
      <span class="gtc-pip p-{pip.state}" style="left: {pip.at}%;" title={pip.label}></span>
    {/each}
  </div>
  <div class="gtc-point">{card.progressPct}% · {card.pointText}</div>
  <div class="gtc-haul-line">{card.haulText}.</div>

  {#if card.notes.length > 0}
    <ul class="gtc-notes">
      {#each card.notes as note (note)}<li>{note}</li>{/each}
    </ul>
  {/if}

  {#if card.haul}
    <div class="gtc-finds" aria-label="Offloaded so far">
      {#each card.haul.materials as m (m.id)}<span class="gtc-find">{m.label} x{m.qty}</span>{/each}
      {#if card.haul.credits > 0}<span class="gtc-find credits">{card.haul.credits} credits</span>{/if}
      {#if card.haul.relicTier}<span class="gtc-find relic"><Icon name="relic" size={11} /> Unidentified relic · {tierLabel(card.haul.relicTier)}</span>{/if}
    </div>
  {/if}
</article>

<style>
  .gtc {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px;
    min-width: 0;
    border: 1px solid rgba(var(--color-accent-rgb), 0.16);
    border-radius: var(--corner);
    background: rgba(var(--color-accent-rgb), 0.03);
  }
  .gtc.s-inProgress {
    border-color: rgba(var(--color-accent-rgb), 0.45);
  }
  .gtc-flavor {
    font-size: var(--text-2xs);
    font-style: italic;
    color: var(--color-text-secondary);
    overflow-wrap: anywhere;
  }
  .gtc-top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 8px;
  }
  .gtc-id {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .gtc-name {
    font-family: var(--font-display);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--color-text-primary);
  }
  .gtc-where {
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
  }
  .gtc-chip {
    flex: none;
    max-width: 60%;
    text-align: right;
    font-size: var(--text-2xs);
    letter-spacing: 0.04em;
    padding: 1px 8px;
    border-radius: 999px;
    border: 1px solid rgba(var(--color-accent-rgb), 0.3);
    color: var(--color-text-secondary);
  }
  .gtc-chip.s-inProgress {
    color: var(--color-accent-bright);
    border-color: var(--color-accent);
  }
  .gtc-chip.s-paused {
    color: var(--color-warning);
    border-color: var(--color-warning);
  }
  .gtc-chip.s-done {
    color: var(--color-success);
    border-color: var(--color-success);
  }
  .gtc-chip.s-skipped {
    color: var(--color-text-dim);
  }
  .gtc-crew {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
  }
  .gtc-crew-one {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  /* GO-M4 `.pbar`: the fill, a pip per fight point (won green, pending red, lost / wiped marked). */
  .gtc-bar {
    position: relative;
    height: 12px;
    margin: 6px 0 2px;
    border-radius: 6px;
    background: var(--color-bg-mid);
    border: 1px solid rgba(var(--color-accent-rgb), 0.15);
  }
  .gtc-fill {
    position: absolute;
    inset: 0 auto 0 0;
    border-radius: 6px;
    background: linear-gradient(90deg, var(--color-accent-bright), var(--color-accent));
  }
  .gtc-pip {
    position: absolute;
    top: -5px;
    width: 4px;
    height: 20px;
    border-radius: 2px;
    transform: translateX(-50%);
    background: var(--color-danger);
    box-shadow: 0 0 0 1px var(--color-bg-deep);
  }
  .gtc-pip.p-won {
    background: var(--color-success);
  }
  .gtc-pip.p-fighting {
    background: var(--color-warning);
  }
  .gtc-pip.p-lost,
  .gtc-pip.p-wiped {
    width: 8px;
    background: repeating-linear-gradient(0deg, var(--color-danger) 0 3px, var(--color-bg-deep) 3px 5px);
    box-shadow: 0 0 0 1px var(--color-danger);
  }
  .gtc-point,
  .gtc-haul-line {
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
  }
  .gtc-notes {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: var(--text-2xs);
    color: var(--color-warning);
  }
  .gtc-notes li {
    border-left: 2px solid color-mix(in srgb, var(--color-warning) 60%, transparent);
    padding-left: 6px;
  }
  .gtc-finds {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }
  .gtc-find {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 7px;
    border-radius: var(--corner);
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
    border: 1px solid rgba(var(--color-accent-rgb), 0.2);
  }
  .gtc-find.credits {
    color: var(--color-warning);
  }
  .gtc-find.relic {
    color: var(--color-accent-bright);
  }
</style>
