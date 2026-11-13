<script lang="ts">
  // ============================================================================
  // CulturesPanel.svelte: the Research Lab's CULTURES tab (Relics v2 R2-7 lists the cultures, R2-8 the detail and the
  // name reveal; the signed-off Relics v2 mockup's Cultures panels, 2026-10-21 "as drawn").
  //
  // A list of every culture the fleet has met (its Roman numeral tier, the bare name once revealed or its "Culture K-17"
  // code, its study toward the name) beside the selected culture's detail: its study bar (points from identified finds
  // and from ancient data), its finds as their sample names, its source planets, its decoded ancient entries, and its lore
  // line once identified. Each row says where the culture's relics were found ("Found on LB-0412 c and 2 more", user
  // 2026-11-13 "First + count"); the detail lists every source planet. The panel is created each time the tab opens, so
  // the inline reveal card glows once only for a name revealed WHILE the tab stays open (a name revealed while it was
  // closed shows as already identified; the Identification tab's reveal card announced it). Reduced motion: no
  // animation. Pure display; no actions.
  // ============================================================================

  import type { GameState } from "./game/model";
  import { CULTURE_STUDY_POINTS } from "./game/relics";
  import Icon from "./ui/Icon.svelte";
  import { cultureDetail, cultureRows, regionTierColor, tierLabel } from "./relicsV2Display";
  import { regionTierNumeral } from "./game/galaxy";

  export let state: GameState;

  $: rows = cultureRows(state);
  let selected: string | null = null;
  // The names already seen by this panel instance: a name revealed after this is the reveal moment.
  let seen: Set<string> | null = null;
  let justRevealed: string | null = null;
  $: {
    const named = state.museumV2.culturesNamed;
    if (seen === null) seen = new Set(named);
    else {
      const fresh = named.filter((id) => !seen!.has(id));
      if (fresh.length > 0) {
        justRevealed = fresh[fresh.length - 1];
        selected = justRevealed;
        seen = new Set(named);
      }
    }
  }
  $: if (rows.length > 0 && (selected === null || !rows.some((r) => r.id === selected))) selected = rows[0].id;
  $: detail = selected !== null ? cultureDetail(state, selected) : null;

  function pick(id: string) {
    selected = id;
    justRevealed = null;
  }
</script>

<div class="cu-wrap">
  <p class="cu-lead">
    A relic's culture is set by the planet it was found on; several planets can share one culture. +1 study point per identified find, plus ancient data from the gas giant study. The name appears at {CULTURE_STUDY_POINTS}.
  </p>
  {#if rows.length === 0}
    <p class="cu-empty">No cultures met yet. Identify a relic and the culture that made it appears here.</p>
  {:else}
    <div class="cu">
      <div class="cu-list">
        {#each rows as r (r.id)}
          <button type="button" class="cu-row" aria-pressed={selected === r.id} on:click={() => pick(r.id)}>
            <b class="cu-row-n">{r.name}</b>
            <span class="cu-row-t" style="color: {regionTierColor(r.tier)};">{regionTierNumeral(r.tier)}</span>
            <span class="cu-bar"><span class="cu-bar-fill" style="width: {Math.min(100, (r.points / CULTURE_STUDY_POINTS) * 100)}%;"></span></span>
            <span class="cu-row-p">{r.named ? "identified" : `${Math.min(r.points, CULTURE_STUDY_POINTS)} / ${CULTURE_STUDY_POINTS}`}</span>
            {#if r.foundOn}<span class="cu-row-f">{r.foundOn}</span>{/if}
          </button>
        {/each}
      </div>

      {#if detail}
        <div class="cu-detail" aria-live="polite">
          <div class="cu-dh">
            <b class="cu-dt">{detail.title}</b>
            <span class="cu-chip" style="color: {regionTierColor(detail.tier)};">{tierLabel(detail.tier)}</span>
          </div>
          <p class="cu-dim">
            {#if detail.named}Identified. Once known as Culture {detail.code}.{:else}Not yet identified. Every relic from its planets reads as a Relic Sample until it is.{/if}
          </p>
          {#if detail.named && justRevealed === detail.id}
            <div class="cu-reveal">
              <span class="cu-glow"><Icon name="discovery" size={40} /></span>
              <span class="cu-dim">Culture {detail.code} identified</span>
              <span class="cu-reveal-name">{detail.title}</span>
              <span class="cu-dim">Every relic of theirs now reads with its real name.</span>
            </div>
          {/if}
          {#if detail.lore}<p class="cu-lore">{detail.lore}</p>{/if}

          <div class="cu-sec">
            <div class="cu-sec-h"><span>Study</span><span class="cu-mono">{Math.min(detail.points, CULTURE_STUDY_POINTS)} / {CULTURE_STUDY_POINTS}</span></div>
            <span class="cu-bar wide"><span class="cu-bar-fill" style="width: {Math.min(100, (detail.points / CULTURE_STUDY_POINTS) * 100)}%;"></span></span>
            <p class="cu-dim">
              {detail.fromFinds} from identified finds · {detail.fromData} from ancient data{#if !detail.named}{" · "}{detail.toGo} more to reveal the name{/if}
            </p>
          </div>

          <div class="cu-sec">
            <div class="cu-sec-h"><span>Finds</span></div>
            {#if detail.finds.length === 0}
              <p class="cu-dim">No relics of theirs identified yet.</p>
            {:else}
              {#each detail.finds as f (f.typeId)}
                <div class="cu-find">
                  <span class="cu-find-n"><Icon name={f.glyph} size={14} /> {f.name}{#if !detail.named}{" "}<span class="cu-dim">({f.typeLabel})</span>{/if}</span>
                  <span class="cu-mono">x{f.count}</span>
                </div>
              {/each}
            {/if}
          </div>

          {#if detail.planets.length > 0}
            <div class="cu-sec">
              <div class="cu-sec-h"><span>Found on</span><span class="cu-mono">{detail.planets.length} {detail.planets.length === 1 ? "planet" : "planets"}</span></div>
              <ul class="cu-planets">
                {#each detail.planets as p (p)}<li>{p}</li>{/each}
              </ul>
            </div>
          {/if}

          {#if detail.decoded > 0}
            <div class="cu-sec">
              <div class="cu-sec-h"><span>Ancient data</span></div>
              <p class="cu-dim">{detail.decoded} ancient {detail.decoded === 1 ? "entry" : "entries"} decoded from this culture's data (Data study tab).</p>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .cu-wrap {
    container-type: inline-size;
    display: grid;
    gap: 10px;
  }
  .cu-lead,
  .cu-dim,
  .cu-empty {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-dim);
    line-height: 1.5;
  }
  .cu-empty {
    padding: 10px;
    border: 1px dashed rgba(var(--color-accent-rgb), 0.24);
    border-radius: var(--corner);
  }
  .cu {
    display: grid;
    gap: 12px;
    grid-template-columns: minmax(0, 1fr);
  }
  @container (min-width: 700px) {
    .cu {
      grid-template-columns: minmax(0, 280px) minmax(0, 1fr);
      align-items: start;
    }
  }
  .cu-list {
    display: grid;
    gap: 6px;
  }
  .cu-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 3px 8px;
    width: 100%;
    text-align: left;
    padding: 8px 10px;
    background: none;
    border: 1px solid rgba(var(--color-accent-rgb), 0.18);
    border-radius: var(--corner);
    color: var(--color-text-primary);
    cursor: pointer;
    font-size: var(--text-xs);
  }
  .cu-row[aria-pressed="true"] {
    border-color: var(--color-accent);
    background: rgba(var(--color-accent-rgb), 0.06);
  }
  .cu-row-t {
    font-family: var(--font-mono);
  }
  .cu-row-f {
    grid-column: 1 / -1;
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
  }
  .cu-planets {
    margin: 0;
    padding-left: 18px;
    display: grid;
    gap: 2px;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--color-text-primary);
  }
  .cu-row-p {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
    text-align: right;
  }
  .cu-bar {
    display: block;
    height: 4px;
    border-radius: 2px;
    background: rgba(var(--color-accent-rgb), 0.14);
    overflow: hidden;
    align-self: center;
  }
  .cu-bar.wide {
    height: 7px;
  }
  .cu-bar-fill {
    display: block;
    height: 100%;
    background: var(--color-accent);
  }
  .cu-detail {
    display: grid;
    gap: 10px;
    padding: 12px;
    min-width: 0;
    border: 1px solid rgba(var(--color-accent-rgb), 0.14);
    border-radius: var(--corner);
    background: rgba(var(--color-accent-rgb), 0.04);
  }
  .cu-dh {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }
  .cu-dt {
    font-family: var(--font-display);
    font-size: var(--text-lg);
    color: var(--color-text-primary);
  }
  .cu-chip {
    font-size: var(--text-2xs);
    border: 1px solid currentColor;
    border-radius: var(--corner);
    padding: 1px 6px;
  }
  .cu-lore {
    margin: 0;
    font-size: var(--text-xs);
    font-style: italic;
    color: var(--color-text-secondary);
  }
  .cu-reveal {
    display: grid;
    justify-items: center;
    gap: 6px;
    text-align: center;
    padding: 14px;
    border: 1px solid rgba(var(--color-warning-rgb), 0.6);
    border-radius: var(--corner);
    background: rgba(var(--color-warning-rgb), 0.06);
  }
  .cu-glow {
    color: var(--color-warning);
    display: inline-flex;
    animation: cu-glow 1400ms ease-out both;
  }
  .cu-reveal-name {
    font-family: var(--font-display);
    font-size: var(--text-xl);
    color: var(--color-text-primary);
    animation: cu-rise 900ms ease-out both;
  }
  @keyframes cu-glow {
    0% {
      transform: scale(0.6);
      opacity: 0;
    }
    60% {
      transform: scale(1.15);
      opacity: 1;
    }
    100% {
      transform: scale(1);
    }
  }
  @keyframes cu-rise {
    from {
      opacity: 0;
      letter-spacing: 0.4em;
      filter: blur(4px);
    }
    to {
      opacity: 1;
      letter-spacing: 0.04em;
      filter: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .cu-glow,
    .cu-reveal-name {
      animation: none;
    }
  }
  .cu-sec {
    display: grid;
    gap: 4px;
  }
  .cu-sec-h {
    display: flex;
    justify-content: space-between;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-text-secondary);
  }
  .cu-mono {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--color-text-primary);
  }
  .cu-find {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    font-size: var(--text-xs);
    color: var(--color-text-primary);
  }
  .cu-find-n {
    display: inline-flex;
    gap: 5px;
    align-items: center;
    min-width: 0;
    flex-wrap: wrap;
  }
</style>
