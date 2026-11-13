<script lang="ts">
  // ============================================================================
  // RelicStudyPanel.svelte: the Research Lab's IDENTIFICATION tab (Relics v2 R2-7; replaces the E4c Relics sub-tab).
  //
  // The signed-off Relics v2 mockup (2026-10-21, "as drawn"), its Identification and Just identified panels: the lanes
  // (Lab I 1, III 2, V 3, VII 4; a locked lane names the Lab tier that opens it), the QUEUE in order with move up, move
  // down and remove, "Queue all" for every blank still waiting in the vault, the unqueued blanks each with Queue, the
  // inline REVEAL card for the latest identification, and the recent identifications.
  //
  // POSTURE: pure presentation. Every number comes from relicsV2Display.ts (the engine's own readers); every action
  // bubbles up to App.svelte (queueRelicStudy / queueAllRelicStudies / unqueueRelicStudy / moveRelicQueueEntry, then
  // pushLog and doSave). A queued blank starts the moment a lane frees, also while away (the engine's queue chain), so
  // Queue is the one verb: with a lane free it starts at once.
  //
  // RESPONSIVE by container query (one DOM, no isMobile JS): stacked on a phone (the reveal first when there is one),
  // side by side from 769 px. Every graphic is SVG through <Icon>.
  // ============================================================================

  import type { GameState } from "./game/model";
  import { relicStudySlotCount, relicStudiesInFlight } from "./game/tick";
  import Icon from "./ui/Icon.svelte";
  import {
    bandColor,
    blankSourceText,
    blankTitle,
    identificationLanes,
    identificationQueue,
    labLabel,
    laneStepsText,
    minutesText,
    queueClearTicks,
    recentIdentifications,
    unqueuedBlanks,
    type RelicRevealV2,
  } from "./relicsV2Display";
  import { relicBandOf } from "./game/relics";
  import { relicStudyDurationFor } from "./game/tick";

  export let state: GameState;
  export let reveal: RelicRevealV2 | null = null;
  export let onQueue: (tokenId: string) => void;
  export let onQueueAll: () => void;
  export let onUnqueue: (tokenId: string) => void;
  export let onMove: (tokenId: string, direction: -1 | 1) => void;
  export let onViewMuseum: () => void;
  export let onDismissReveal: () => void;
  export let formatRemaining: (remainingTicks: number, totalTicks: number) => string;

  $: lanes = identificationLanes(state);
  $: openLanes = relicStudySlotCount(state);
  $: busy = relicStudiesInFlight(state).length;
  $: lab = labLabel(state);
  $: queue = identificationQueue(state);
  $: waiting = unqueuedBlanks(state);
  $: clearTicks = queueClearTicks(queue, Math.max(1, openLanes), lanes.reduce((n, l) => n + (l.kind === "busy" ? l.remainingTicks ?? 0 : 0), 0));
  $: recent = recentIdentifications(state, 6);
</script>

<div class="id-wrap">
  <div class="id" class:has-reveal={reveal !== null}>
    <section class="id-card id-main">
      <!-- One heading (the panel's IDENTIFICATION title, as the mockup): the card opens on the Lab and lane chip. -->
      <div class="id-h">
        <span class="id-chip">{lab ?? "No Research Lab"} · {busy} of {openLanes} {openLanes === 1 ? "lane" : "lanes"}</span>
      </div>
      <p class="id-rule">
        Free. Each blank takes 10 minutes times its rarity (standard 10 min, augmented 15, stellar 20, radiant 30), shortened by research speed. Any Lab level identifies any tier. Lanes: {laneStepsText()}.
      </p>
      {#if openLanes === 0}
        <p class="id-gate"><Icon name="warning" size={13} /> Identification needs the Research Lab. Build it to start identifying relics.</p>
      {/if}

      <div class="id-lanes">
        {#each lanes as l (l.index)}
          {#if l.kind === "busy"}
            <div class="id-lane">
              <div class="id-lane-top"><span class="id-dim">Lane {l.index}</span><span style="color: {bandColor(l.band ?? 'standard')};"><Icon name="relic" size={18} /></span></div>
              <b class="id-lane-t">{l.title}</b>
              <span class="id-dim">from {l.source}</span>
              <span class="id-bar" role="img" aria-label="{Math.round(l.pct ?? 0)}% done"><span class="id-bar-fill" style="width: {l.pct}%;"></span></span>
              <span class="id-mono">{formatRemaining(l.remainingTicks ?? 0, l.durationTicks ?? 0)}</span>
            </div>
          {:else if l.kind === "free"}
            <div class="id-lane free">
              <div class="id-lane-top"><span class="id-dim">Lane {l.index}</span></div>
              <span class="id-dim">Free: the next queued blank starts here.</span>
            </div>
          {:else}
            <div class="id-lane locked">
              <span><Icon name="lock" size={16} /></span>
              <b class="id-lane-t">Lane {l.index}</b>
              <span class="id-dim">Opens at {l.opensAt}</span>
            </div>
          {/if}
        {/each}
      </div>

      <div class="id-sec">
        <div class="id-sec-h">
          <span class="id-sec-t">Queue ({queue.length}{#if queue.length > 0}, about {minutesText(clearTicks, state.tickDurationSeconds)}{/if})</span>
          <button type="button" class="id-btn" disabled={waiting.length === 0} on:click={onQueueAll}><Icon name="queue" size={13} /> Queue all {waiting.length}</button>
        </div>
        {#if queue.length === 0}
          <p class="id-empty">Nothing queued. Queue blanks and each starts the moment a lane frees, also while you are away.</p>
        {:else}
          {#each queue as q, i (q.token.id)}
            <div class="id-row">
              <span style="color: {bandColor(q.band)};"><Icon name="relic" size={18} /></span>
              <span class="id-row-t">
                <b>{q.title}</b>
                <span class="id-dim">from {q.source} · {minutesText(q.durationTicks, state.tickDurationSeconds)} · free</span>
              </span>
              <span class="id-row-a">
                <button type="button" class="id-btn sm" aria-label="Move up" disabled={i === 0} on:click={() => onMove(q.token.id, -1)}><Icon name="chevronUp" size={13} /></button>
                <button type="button" class="id-btn sm" aria-label="Move down" disabled={i === queue.length - 1} on:click={() => onMove(q.token.id, 1)}><Icon name="chevronDown" size={13} /></button>
                <button type="button" class="id-btn sm" aria-label="Remove from queue" on:click={() => onUnqueue(q.token.id)}><Icon name="close" size={13} /></button>
              </span>
            </div>
          {/each}
        {/if}
        {#if queue.length > 0}<p class="id-foot">The next queued blank starts the moment a lane frees, also while you are away.</p>{/if}
      </div>

      <div class="id-sec">
        <div class="id-sec-h"><span class="id-sec-t">Unidentified blanks ({waiting.length})</span></div>
        {#if waiting.length === 0}
          <p class="id-empty">No blanks waiting. Away teams recover them on expeditions; Short-Range Missions find one now and then, too.</p>
        {:else}
          {#each waiting as t (t.id)}
            <div class="id-row">
              <span style="color: {bandColor(relicBandOf(t.tier))};"><Icon name="relic" size={18} /></span>
              <span class="id-row-t">
                <b>{blankTitle(t)}</b>
                <span class="id-dim">from {blankSourceText(t)} · {minutesText(relicStudyDurationFor(state, state.museumV2, t), state.tickDurationSeconds)}</span>
              </span>
              <span class="id-row-a">
                <button type="button" class="id-btn" disabled={openLanes === 0} on:click={() => onQueue(t.id)}><Icon name="queue" size={13} /> Queue</button>
              </span>
            </div>
          {/each}
        {/if}
      </div>
    </section>

    <section class="id-card id-side" aria-live="polite">
      <div class="id-h">
        <span class="id-glyph"><Icon name="discovery" size={16} /></span>
        <span class="id-title">Just identified</span>
        {#if reveal}
          <button type="button" class="id-x" on:click={onDismissReveal}><Icon name="close" size={13} title="Dismiss" /></button>
        {/if}
      </div>
      {#if reveal}
        {#key reveal.recordId}
          <div class="id-reveal" class:exc={reveal.kind === "exceptional"} style="--rc: {reveal.color};">
            <div class="id-reveal-head">
              <span class="id-reveal-glyph"><Icon name={reveal.glyph} size={34} /></span>
              <span class="id-reveal-names">
                <b class="id-reveal-name">{reveal.title}</b>
                <span class="id-dim">{reveal.subtitle}</span>
              </span>
            </div>
            <p class="id-reveal-flavor">{reveal.flavor}</p>
            <p class="id-reveal-line">{reveal.effect}</p>
            {#if reveal.progress}<p class="id-reveal-line">{reveal.progress}</p>{/if}
            {#if reveal.cultureRevealed}
              <div class="id-culture-reveal">
                <span class="id-glow"><Icon name="discovery" size={22} /></span>
                <span>A culture is identified: <b>{reveal.cultureRevealed}</b>. Every find of theirs now reads with its real name.</span>
              </div>
            {/if}
            {#if reveal.firstFind}
              <div class="id-first">
                <span class="id-first-h"><Icon name="discovery" size={12} /> First find</span>
                <span>The first {reveal.title} your fleet has identified.</span>
                {#each reveal.researchUnlocked as project (project)}
                  <span class="id-first-r"><Icon name="research" size={12} /> Research unlocked: <b>{project}</b></span>
                {/each}
              </div>
            {/if}
            <button type="button" class="id-btn" on:click={onViewMuseum}><Icon name="museum" size={13} /> View in Museum</button>
          </div>
        {/key}
      {:else}
        <p class="id-empty">Nothing identified yet this session. Queue a blank and its identity is revealed here the moment the study completes.</p>
      {/if}

      {#if recent.length > 0}
        <div class="id-sec">
          <div class="id-sec-h"><span class="id-sec-t">Recent identifications</span></div>
          {#each recent as r (r.recordId)}
            <div class="id-recent"><span class:id-exc={r.exceptional}><Icon name={r.glyph} size={14} /></span> {r.label}</div>
          {/each}
        </div>
      {/if}
    </section>
  </div>
</div>

<style>
  .id-wrap {
    container-type: inline-size;
  }
  .id {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: "main" "side";
    gap: 12px;
  }
  .id.has-reveal {
    grid-template-areas: "side" "main";
  }
  .id-main {
    grid-area: main;
  }
  .id-side {
    grid-area: side;
  }
  @container (min-width: 769px) {
    .id,
    .id.has-reveal {
      grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
      grid-template-areas: "main side";
      align-items: start;
    }
  }
  .id-card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    min-width: 0;
    background: rgba(var(--color-accent-rgb), 0.04);
    border: 1px solid rgba(var(--color-accent-rgb), 0.14);
    border-radius: var(--corner);
  }
  .id-h {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    padding-bottom: 8px;
    border-bottom: 1px solid rgba(var(--color-accent-rgb), 0.12);
  }
  .id-glyph {
    color: var(--color-accent-bright);
    display: inline-flex;
  }
  .id-title {
    font-family: var(--font-display);
    font-size: var(--text-md);
    color: var(--color-text-primary);
  }
  .id-chip {
    margin-left: auto;
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
    border: 1px solid rgba(var(--color-accent-rgb), 0.2);
    border-radius: var(--corner);
    padding: 1px 6px;
  }
  .id-x {
    margin-left: auto;
    display: inline-flex;
    padding: 3px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--corner);
    color: var(--color-text-dim);
    cursor: pointer;
  }
  .id-rule,
  .id-empty,
  .id-foot,
  .id-gate {
    margin: 0;
    font-size: var(--text-xs);
    line-height: 1.5;
    color: var(--color-text-dim);
  }
  .id-empty {
    padding: 10px;
    border: 1px dashed rgba(var(--color-accent-rgb), 0.24);
    border-radius: var(--corner);
  }
  .id-gate {
    color: var(--color-warning);
  }
  .id-lanes {
    display: grid;
    gap: 8px;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 150px), 1fr));
  }
  .id-lane {
    display: grid;
    gap: 4px;
    padding: 8px;
    border: 1px solid rgba(var(--color-accent-rgb), 0.18);
    border-radius: var(--corner);
    font-size: var(--text-xs);
    min-width: 0;
  }
  .id-lane.free {
    border-style: dashed;
  }
  .id-lane.locked {
    border-style: dashed;
    color: var(--color-text-dim);
  }
  .id-lane-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .id-lane-t {
    color: var(--color-text-primary);
    font-weight: 600;
  }
  .id-dim {
    color: var(--color-text-dim);
    font-size: var(--text-2xs);
  }
  .id-mono {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
  }
  .id-bar {
    display: block;
    height: 6px;
    border-radius: 3px;
    background: rgba(var(--color-accent-rgb), 0.14);
    overflow: hidden;
  }
  .id-bar-fill {
    display: block;
    height: 100%;
    background: var(--color-accent);
  }
  .id-sec {
    display: grid;
    gap: 4px;
  }
  .id-sec-h {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }
  .id-sec-t {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-text-secondary);
  }
  .id-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 4px 10px;
    align-items: center;
    padding: 7px 0;
    border-top: 1px solid rgba(var(--color-accent-rgb), 0.1);
    font-size: var(--text-xs);
  }
  .id-row-t {
    display: grid;
    min-width: 0;
    color: var(--color-text-primary);
  }
  .id-row-a {
    display: flex;
    gap: 3px;
  }
  .id-btn {
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
    white-space: nowrap;
  }
  .id-btn.sm {
    padding: 4px 6px;
  }
  .id-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .id-reveal {
    display: grid;
    gap: 6px;
    padding: 10px;
    border: 1px solid rgba(var(--color-accent-rgb), 0.2);
    border-radius: var(--corner);
    border-left: 3px solid var(--rc);
  }
  .id-reveal-head {
    display: flex;
    gap: 10px;
    align-items: center;
  }
  .id-reveal-glyph {
    color: var(--rc);
    display: inline-flex;
  }
  .id-reveal-names {
    display: grid;
    min-width: 0;
  }
  .id-reveal-name {
    font-family: var(--font-display);
    font-size: var(--text-lg);
    color: var(--color-text-primary);
  }
  .id-reveal-flavor {
    margin: 0;
    font-size: var(--text-xs);
    font-style: italic;
    color: var(--color-text-secondary);
    line-height: 1.5;
  }
  .id-reveal-line {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-primary);
  }
  .id-culture-reveal {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 8px 10px;
    border: 1px solid rgba(var(--color-warning-rgb), 0.5);
    background: rgba(var(--color-warning-rgb), 0.08);
    border-radius: var(--corner);
    font-size: var(--text-xs);
    color: var(--color-text-primary);
  }
  .id-glow {
    color: var(--color-warning);
    display: inline-flex;
    animation: id-glow 1400ms ease-out both;
  }
  @keyframes id-glow {
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
  @media (prefers-reduced-motion: reduce) {
    .id-glow {
      animation: none;
    }
  }
  .id-first {
    display: grid;
    gap: 3px;
    padding: 8px 10px;
    border-radius: var(--corner);
    border: 1px solid rgba(var(--color-warning-rgb), 0.5);
    background: rgba(var(--color-warning-rgb), 0.08);
    font-size: var(--text-xs);
    color: var(--color-text-primary);
  }
  .id-first-h {
    display: inline-flex;
    gap: 5px;
    align-items: center;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-warning);
  }
  .id-first-r b {
    color: var(--color-success);
  }
  .id-recent {
    display: flex;
    gap: 6px;
    align-items: center;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }
  .id-exc {
    color: var(--color-warning);
  }
</style>
