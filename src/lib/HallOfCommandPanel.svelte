<script lang="ts">
  // HallOfCommandPanel.svelte: the Archive's HALL OF COMMAND subsection (0.14.0 Complement CP-16, OC-22; the CP-16
  // notables answer, user 2026-11-06). One card per retired captain, newest first: the name, the level they retired
  // at, which of the slot's retirements it was, the missions they flew and the in-game day, then their notable moments
  // with the day of each. The caller hides the subsection until the first entry exists.
  //
  // POSTURE: pure presentation over hallOfCommandDisplay.ts (hallOfCommandRows; tested). One DOM; a container query puts
  // the cards two across from 720 px of panel width. On a phone each card is full width, its facts wrap under the name
  // and each notable keeps its day on the right of its line.
  //
  // ACCESSIBILITY: the Archive carries no heading levels (its panel titles are plain text), so a card's name is a styled
  // span, not a heading out of sequence; the list and its items carry the structure. The "final" chip is read after a
  // hidden comma ("Retirement 5 of 5, final").

  import type { HallOfCommandRow } from "./hallOfCommandDisplay";

  export let rows: readonly HallOfCommandRow[];
</script>

<div class="hoc-wrap">
  <ul class="hoc" aria-label="Retired captains">
    {#each rows as row (row.key)}
      <li class="hoc-card">
        <div class="hoc-head">
          <span class="hoc-name">{row.name}</span>
          <span class="hoc-day">{row.retiredOn}</span>
        </div>
        <div class="hoc-facts">
          <span>{row.level}</span>
          <span>{row.retirement}{#if row.final}<span class="hoc-sr">, </span><span class="hoc-final">final</span>{/if}</span>
          <span>{row.missions}</span>
        </div>
        {#if row.notables.length > 0}
          <ol class="hoc-notables" aria-label="Notable moments of {row.name}'s command">
            {#each row.notables as n (n.key)}
              <li><span class="hoc-label">{n.label}</span><span class="hoc-nday">{n.day}</span></li>
            {/each}
          </ol>
        {:else}
          <p class="hoc-none">No notable moments recorded.</p>
        {/if}
      </li>
    {/each}
  </ul>
</div>

<style>
  .hoc-wrap {
    container-type: inline-size;
  }
  .hoc {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 10px;
  }
  @container (min-width: 720px) {
    .hoc {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  .hoc-card {
    position: relative; /* the hidden comma's containing block */
    min-width: 0;
    border: 1px solid var(--color-border);
    border-radius: var(--corner);
    background: rgba(0, 0, 0, 0.2);
    padding: 10px 12px;
  }
  .hoc-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }
  .hoc-name {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
    font-family: var(--font-display);
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--color-text-primary);
  }
  .hoc-day {
    flex: 0 0 auto;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-dim);
  }
  .hoc-facts {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 12px;
    margin-top: 4px;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }
  /* Read by assistive tech, hidden on screen (the standard clip-rect idiom). */
  .hoc-sr {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  .hoc-final {
    margin-left: 6px;
    padding: 0 5px;
    border: 1px solid var(--color-border);
    border-radius: var(--corner);
    font-size: var(--text-xs);
    color: var(--color-text-primary);
  }
  .hoc-notables {
    list-style: none;
    margin: 8px 0 0;
    padding: 8px 0 0;
    border-top: 1px solid var(--color-border);
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .hoc-notables li {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    font-size: var(--text-xs);
  }
  .hoc-label {
    min-width: 0;
    overflow-wrap: anywhere;
    color: var(--color-text-primary);
  }
  .hoc-nday {
    flex: 0 0 auto;
    font-family: var(--font-mono);
    color: var(--color-text-dim);
  }
  .hoc-none {
    margin: 8px 0 0;
    font-size: var(--text-xs);
    color: var(--color-text-dim);
  }
</style>
