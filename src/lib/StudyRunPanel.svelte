<script lang="ts">
  // StudyRunPanel.svelte: the GAS GIANT STUDY part of a running expedition (0.14.0, Gas Giant Study GG-6; the signed-off
  // v3 mockup sections 1 and 2, "approve as is" 2026-10-21), under the team timelines: the "ship holding orbit" card
  // (what the ship studies, the time left, the probe and the Science fieldwork pace, the pickups waiting), the ship legs
  // card with the return forecast, the gas giant body card per orbital body, and each finished study's haul.
  //
  // POSTURE: pure presentation over gasGiantStudyDisplay.ts (tested). Nothing here acts: the ship always runs the
  // study (user call 3), so the screen only reports. One DOM, a container query puts the two top cards side by side.

  import type { Expedition, GameState, ShipInstance } from "./game/model";
  import { flaggedScanTimeline } from "./game/expedition";
  import { giantCardsView, studyLegsView, studyResultsView, studyShipCardView } from "./gasGiantStudyDisplay";
  import GasGiantCard from "./GasGiantCard.svelte";
  import StudyChips from "./StudyChips.svelte";
  import Icon from "./ui/Icon.svelte";

  export let exp: Expedition;
  export let ship: ShipInstance | null = null;
  export let now: number;
  export let state: GameState;

  const nameOf = (id: string): string | null => state.awayMembers.find((m) => m.id === id)?.name ?? null;
  $: card = studyShipCardView(exp, ship, now, nameOf);
  $: legs = studyLegsView(exp, ship, now, flaggedScanTimeline);
  // The body cards read only the frozen run (its profile, roster and region), so they are built once per run.
  $: giants = giantCardsView(exp);
  $: results = studyResultsView(exp);
</script>

{#if card || legs || giants.length > 0 || results.length > 0}
  <section class="sr" aria-label="Gas giant study">
    {#if card || legs}
      <div class="sr-top">
        {#if card}
          <div class="sr-card">
            <div class="sr-row"><Icon name="ship" size={24} /><b>{card.title}</b></div>
            <p class="sr-muted">{card.lead} <b class="sr-ink">{card.left}</b> {card.tail}</p>
            <StudyChips chips={card.chips} />
            {#each card.waits as w, i (i)}<p class="sr-dim">{w}</p>{/each}
          </div>
        {/if}
        {#if legs}
          <div class="sr-card">
            <h4 class="sr-h">Ship legs</h4>
            <ol class="sr-legs">
              {#each legs.rows as r (r.key)}
                <li class:current={r.current}>
                  {#if r.study}<b>{r.label}</b>{:else}{r.label}{/if}
                  <span class="sr-mono">{r.when}</span>{#if r.then}, {r.then}{/if}
                </li>
              {/each}
            </ol>
            {#if legs.forecast}<p class="sr-dim">{legs.forecast}</p>{/if}
          </div>
        {/if}
      </div>
    {/if}

    {#if giants.length > 0}
      <div class="sr-card">
        <h4 class="sr-h">Gas giant body card <span class="sr-dim sr-inline">mass is its own number; heavier means harsher gravity and a deeper, richer dive</span></h4>
        <GasGiantCard cards={giants} idBase="gg-{exp.id}" />
      </div>
    {/if}

    {#if results.length > 0}
      <div class="sr-card">
        <h4 class="sr-h">Study results</h4>
        <ul class="sr-results">
          {#each results as r (r.key)}
            <li>
              <span class="sr-where">{r.where}</span>
              <span class="sr-finds">
                {#each r.canisters as c (c.id)}<span class="sr-find"><Icon name={c.glyph} size={12} /> {c.label} x{c.qty}</span>{/each}
                {#each r.extras as x, i (i)}<span class="sr-find">{x}</span>{/each}
              </span>
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  </section>
{/if}

<style>
  .sr {
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
  }
  .sr-top {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
  }
  @container (min-width: 720px) {
    .sr-top {
      grid-template-columns: 1.3fr 1fr;
    }
  }
  .sr-card {
    padding: 12px;
    min-width: 0;
    border: 1px solid rgba(var(--color-accent-rgb), 0.16);
    border-radius: var(--corner);
    background: rgba(var(--color-accent-rgb), 0.04);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .sr-row {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--color-text-primary);
    font-size: var(--text-sm);
  }
  .sr-h {
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--text-xs);
    letter-spacing: 0.06em;
    color: var(--color-text-primary);
  }
  .sr-inline {
    font-family: var(--font-body, inherit);
    letter-spacing: 0;
    font-weight: normal;
  }
  .sr-muted {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }
  .sr-ink {
    color: var(--color-text-primary);
  }
  .sr-dim {
    margin: 0;
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
  }
  .sr-mono {
    font-family: var(--font-mono);
  }
  .sr-legs {
    margin: 0;
    padding-left: 18px;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    display: grid;
    gap: 2px;
  }
  .sr-legs b {
    color: var(--color-text-primary);
    font-weight: 600;
  }
  .sr-legs li.current {
    color: var(--color-accent-bright);
  }
  .sr-results {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  .sr-results li {
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-size: var(--text-xs);
  }
  .sr-where {
    color: var(--color-text-primary);
  }
  .sr-finds {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .sr-find {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 6px;
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
    border: 1px solid rgba(var(--color-accent-rgb), 0.18);
    border-radius: var(--corner);
  }
</style>
