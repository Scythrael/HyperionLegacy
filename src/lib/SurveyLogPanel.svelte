<script lang="ts">
  // SurveyLogPanel.svelte: the Archive's SURVEY LOG tab (0.14.0, Gas Giant Study GG-6; plan section 4 GG-6 "the Survey
  // Log Archive tab, grouped by class with counts"; the user's Lore home, 2026-10-08: "a new Survey Log tab in the
  // Archive"). Each ship study or nebula sweep whose readout hit (15%) wrote an entry at the claim. The list groups the
  // entries by giant class and nebula kind with counts; the card shows the selected entry: its portrait, its physics,
  // and for a giant how close it came to becoming a star (the v3 mockup's star bar), for a nebula where it sits in a
  // star's life cycle.
  //
  // POSTURE: pure presentation over gasGiantStudyDisplay.ts (surveyLogGroups, surveyEntryView; tested). Every number
  // derives from the entry's stored class and mass. One DOM; a container query puts the list beside the card from
  // 760 px of panel width. Narrower (a phone), the selected card comes FIRST and picking an entry scrolls back up to
  // it (the user's sign-off, 2026-10-27: "Card on top"), so a long log never leaves the card far below.

  import type { SurveyLogEntry } from "./game/model";
  import { NEBULA_STAGES, SURVEY_LOG_EMPTY, surveyEntryView, surveyLogGroups } from "./gasGiantStudyDisplay";
  import GiantArt from "./GiantArt.svelte";
  import StarBar from "./StarBar.svelte";

  export let entries: readonly SurveyLogEntry[];

  $: groups = surveyLogGroups(entries);
  let selectedId: string | null = null;
  // Default (and repair) the selection: the newest entry.
  $: if (entries.length > 0 && (selectedId === null || !entries.some((e) => e.id === selectedId))) {
    selectedId = [...entries].sort((a, b) => b.at - a.at)[0].id;
  }
  $: selected = entries.find((e) => e.id === selectedId) ?? null;
  $: card = selected ? surveyEntryView(selected, entries) : null;

  let wrap: HTMLDivElement | null = null;
  let cardEl: HTMLElement | null = null;
  // The list sits beside the card from this panel width (the container query below); under it the card is on top.
  const SIDE_BY_SIDE_PX = 760;

  function pick(id: string): void {
    selectedId = id;
    if (!wrap || !cardEl || wrap.clientWidth >= SIDE_BY_SIDE_PX) return;
    if (cardEl.getBoundingClientRect().top >= 0) return; // already in view
    const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    cardEl.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
  }
</script>

<div class="sl-wrap" bind:this={wrap}>
  {#if entries.length === 0}
    <p class="sl-empty">{SURVEY_LOG_EMPTY}</p>
  {:else}
    <div class="sl">
      <nav class="sl-list" aria-label="Survey Log entries">
        {#each groups as g (g.key)}
          <div class="sl-group">
            <h4 class="sl-gh">{g.label} <span class="sl-count">{g.count}</span></h4>
            <ul>
              {#each g.entries as e (e.id)}
                <li>
                  <button type="button" aria-pressed={e.id === selectedId} on:click={() => pick(e.id)}>
                    {e.label}{#if e.first}<span class="sl-first">first</span>{/if}
                  </button>
                </li>
              {/each}
            </ul>
          </div>
        {/each}
      </nav>

      {#if card}
        <article class="sl-card" aria-live="polite" bind:this={cardEl}>
          <div class="sl-head">
            <div class="sl-art">
              <GiantArt giant={card.art} nebula={card.nebulaArt} derelict={card.derelict} label={card.subtitle} idBase="sl-{card.id}" />
            </div>
            <div class="sl-words">
              <h4 class="sl-title">{card.title}</h4>
              <div class="sl-sub">{card.subtitle}{#if card.first}{" · "}<span class="sl-firstword">first of its class</span>{/if}</div>
              <dl class="sl-kv">
                {#each card.kv as row (row.label)}
                  <dt>{row.label}</dt>
                  <dd class:mono={row.mono}>{row.value}</dd>
                {/each}
              </dl>
              {#if card.note}<p class="sl-note">{card.note}</p>{/if}
            </div>
          </div>
          {#if card.star}
            <h4 class="sl-h">How close it came to becoming a star</h4>
            <StarBar star={card.star} />
          {:else if card.stage !== null}
            <h4 class="sl-h">Where it sits in a star's life cycle</h4>
            <ol class="sl-cycle" aria-label="Stellar life cycle">
              {#each NEBULA_STAGES as stage, i (stage)}
                <li class:on={i === card.stage} aria-current={i === card.stage ? "step" : undefined}>{stage}</li>
              {/each}
            </ol>
            {#if card.stageNote}<p class="sl-dim">{card.stageNote}</p>{/if}
          {/if}
        </article>
      {/if}
    </div>
  {/if}
</div>

<style>
  .sl-wrap {
    container-type: inline-size;
  }
  .sl-empty {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }
  .sl {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
  }
  /* One column (a phone): the selected card first, the list under it. */
  .sl-card {
    order: -1;
    scroll-margin-top: 8px;
  }
  @container (min-width: 760px) {
    .sl {
      grid-template-columns: 260px minmax(0, 1fr);
      align-items: start;
    }
    .sl-card {
      order: 0;
    }
  }
  .sl-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
  }
  .sl-gh {
    margin: 0 0 4px;
    font-family: var(--font-display);
    font-size: var(--text-xs);
    letter-spacing: 0.04em;
    color: var(--color-text-primary);
  }
  .sl-count {
    font-family: var(--font-mono);
    color: var(--color-text-dim);
    margin-left: 4px;
  }
  .sl-group ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .sl-group button {
    font: inherit;
    font-size: var(--text-xs);
    min-height: 28px;
    padding: 3px 8px;
    color: var(--color-text-secondary);
    background: transparent;
    border: 1px solid rgba(var(--color-accent-rgb), 0.22);
    border-radius: var(--corner);
    cursor: pointer;
    display: inline-flex;
    gap: 6px;
    align-items: center;
  }
  .sl-group button[aria-pressed="true"] {
    color: var(--color-text-primary);
    border-color: var(--color-accent-bright);
    background: rgba(var(--color-accent-rgb), 0.1);
  }
  .sl-group button:focus-visible {
    outline: 2px solid var(--color-accent-bright);
    outline-offset: 2px;
  }
  .sl-first {
    font-size: var(--text-2xs);
    color: var(--color-warning);
  }
  .sl-card {
    padding: 12px;
    min-width: 0;
    border: 1px solid rgba(var(--color-accent-rgb), 0.16);
    border-radius: var(--corner);
    background: rgba(var(--color-accent-rgb), 0.04);
  }
  .sl-head {
    display: grid;
    grid-template-columns: minmax(0, 120px) minmax(0, 1fr);
    gap: 12px;
    align-items: start;
  }
  .sl-art {
    display: grid;
    justify-items: center;
  }
  .sl-words {
    min-width: 0;
  }
  .sl-title {
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--text-sm);
    color: var(--color-text-primary);
  }
  .sl-sub {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }
  .sl-firstword {
    color: var(--color-warning);
  }
  .sl-kv {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 3px 12px;
    margin: 8px 0 0;
    font-size: var(--text-xs);
  }
  .sl-kv dt {
    color: var(--color-text-secondary);
  }
  .sl-kv dd {
    margin: 0;
    color: var(--color-text-primary);
    overflow-wrap: anywhere;
  }
  .mono {
    font-family: var(--font-mono);
  }
  .sl-note {
    margin: 8px 0 0;
    font-size: var(--text-xs);
    font-style: italic;
    color: var(--color-text-secondary);
  }
  .sl-h {
    margin: 12px 0 4px;
    font-family: var(--font-display);
    font-size: var(--text-xs);
    letter-spacing: 0.06em;
    color: var(--color-text-primary);
  }
  .sl-cycle {
    list-style: none;
    margin: 6px 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 4px;
  }
  @container (min-width: 560px) {
    .sl-cycle {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }
  .sl-cycle li {
    font-size: var(--text-2xs);
    padding: 4px 6px;
    text-align: center;
    color: var(--color-text-dim);
    border: 1px solid rgba(var(--color-accent-rgb), 0.16);
    border-radius: var(--corner);
  }
  .sl-cycle li.on {
    color: var(--color-text-primary);
    border-color: var(--color-accent-bright);
    background: rgba(var(--color-accent-rgb), 0.12);
    font-weight: 600;
  }
  .sl-dim {
    margin: 0;
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
  }
</style>
