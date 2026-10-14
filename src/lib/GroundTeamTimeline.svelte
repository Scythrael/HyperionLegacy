<script lang="ts">
  // GroundTeamTimeline.svelte: the TEAM TIMELINES of a running Ground Operations window (0.14.0, Ground Operations
  // GO-14, mockup GO-M3), inside the expedition's in-progress view.
  //
  // One lane per deployed team (TeamBadge + kind + what it is doing now, with the time left), its steps drawn on a
  // shared time axis (deploy, work, fight, wipe, return, offload, medical bay, reload, idle; a step a player's edit
  // stopped is hatched), then the SHIP's lane (each body's scan, the scan pauses ship events caused, recovery legs
  // including shared pickups, field repairs, holding station), and the key. "Recent" shows the last few steps of
  // every lane; "Whole run" the window from its start. Each lane's step list is a disclosure, so every step can be
  // read in words (keyboard and screen readers; the track itself is one image with a summary name).
  //
  // POSTURE: pure presentation over groundOpsTimelineDisplay.ts (tested). History is DISPLAY ONLY: resolution
  // never reads it.

  import type { Expedition, ShipInstance } from "./game/model";
  import { flaggedScanTimeline } from "./game/expedition";
  import { LANE_KEY, SHIP_KEY, STOPPED_KEY_TEXT, timelineView, type TimelineMode } from "./groundOpsTimelineDisplay";
  import Icon from "./ui/Icon.svelte";
  import TeamBadge from "./ui/TeamBadge.svelte";

  /** The run (the stored record; the tick keeps it current). */
  export let exp: Expedition;
  /** Its ship (team names), when still known. */
  export let ship: ShipInstance | null = null;
  /** Game time now. */
  export let now: number;

  let mode: TimelineMode = "recent";
  $: view = timelineView(exp, ship, now, mode, flaggedScanTimeline);
</script>

<section class="gt" aria-label="Ground team timelines">
  <div class="gt-head">
    <span class="gt-tag">Ground operations · team timelines</span>
    {#if view}
      <div class="gt-mode" role="group" aria-label="Timeline span">
        <button type="button" class="gt-mode-btn" aria-pressed={mode === "recent"} on:click={() => (mode = "recent")}>Recent</button>
        <button type="button" class="gt-mode-btn" aria-pressed={mode === "whole"} on:click={() => (mode = "whole")}>Whole run</button>
      </div>
    {/if}
  </div>

  {#if !view}
    <div class="gt-note">The teams start once the ship begins its scan; each body's tasks open when its scan finishes.</div>
  {:else}
    <div class="gt-lanes">
      <div class="gt-axis" aria-hidden="true">
        <span class="gt-axis-spacer"></span>
        <span class="gt-axis-ends"><span>{view.axis.startText}</span><span>{view.axis.endText}</span></span>
      </div>

      {#each view.lanes as lane (lane.index)}
        <div class="gt-lane">
          <div class="gt-lane-id">
            <TeamBadge index={lane.index} kind={lane.kind} name={lane.name} />
            <div class="gt-lane-words">
              <span class="gt-lane-name">{lane.name} <span class="gt-lane-kind">{lane.kindName} team</span></span>
              <span class="gt-lane-now">{lane.nowText}</span>
            </div>
          </div>
          <div class="gt-track" role="img" aria-label={lane.ariaLabel}>
            {#each lane.segments as seg (seg.key)}
              <span
                class="gt-seg c-{seg.category}"
                class:current={seg.current}
                class:stopped={seg.stopped}
                class:lost={seg.lost}
                style="left: {seg.leftPct}%; width: {seg.widthPct}%;"
                title={seg.detail}
              >
                {#if seg.showGlyph}<Icon name={seg.glyph} size={12} />{/if}
                {#if seg.showLabel}<span class="gt-seg-label">{seg.label}</span>{/if}
              </span>
            {/each}
          </div>
          <details class="gt-steps">
            <summary>{lane.name}'s steps ({lane.steps.length})</summary>
            <ol>
              {#each lane.steps as st (st.key)}
                <li class:current={st.current}><span class="gt-step-when">{st.when}</span> {st.text}</li>
              {/each}
            </ol>
          </details>
        </div>
      {/each}

      <div class="gt-lane ship">
        <div class="gt-lane-id">
          <span class="gt-ship-badge" aria-hidden="true"><Icon name="ship" size={16} /></span>
          <div class="gt-lane-words">
            <span class="gt-lane-name">Ship</span>
            <span class="gt-lane-now">{view.ship.nowText}</span>
          </div>
        </div>
        <div class="gt-track" role="img" aria-label={view.ship.ariaLabel}>
          {#each view.ship.segments as seg (seg.key)}
            <span
              class="gt-seg c-{seg.category}"
              class:current={seg.current}
              style="left: {seg.leftPct}%; width: {seg.widthPct}%;"
              title={seg.detail}
            >
              {#if seg.showGlyph}<Icon name={seg.glyph} size={12} />{/if}
              {#if seg.showLabel}<span class="gt-seg-label">{seg.label}</span>{/if}
            </span>
          {/each}
        </div>
        <details class="gt-steps">
          <summary>Ship's steps ({view.ship.steps.length})</summary>
          <ol>
            {#each view.ship.steps as st (st.key)}
              <li class:current={st.current}><span class="gt-step-when">{st.when}</span> {st.text}</li>
            {/each}
          </ol>
        </details>
      </div>
    </div>

    <!-- The key row (GO-M3): team steps, then the ship's. -->
    <ul class="gt-key" aria-label="Timeline key">
      {#each LANE_KEY as k (k.category)}
        <li><i class="gt-swatch c-{k.category}" aria-hidden="true"></i><Icon name={k.glyph} size={12} />{k.text}</li>
      {/each}
      {#if view.hasStopped}
        <li><i class="gt-swatch stopped" aria-hidden="true"></i>{STOPPED_KEY_TEXT}</li>
      {/if}
      {#each SHIP_KEY as k (k.category)}
        <li><i class="gt-swatch c-{k.category}" aria-hidden="true"></i><Icon name={k.glyph} size={12} />{k.text}</li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  /* GO-M3 segment colors as theme tokens: every lane color mixes a theme color, so both themes follow. */
  .gt {
    --lane-work: color-mix(in srgb, var(--color-accent-bright) 32%, transparent);
    --lane-fight: color-mix(in srgb, var(--color-danger) 38%, transparent);
    --lane-wipe: color-mix(in srgb, var(--color-danger) 72%, transparent);
    --lane-travel: color-mix(in srgb, var(--color-text-dim) 30%, transparent);
    --lane-load: color-mix(in srgb, var(--color-warning) 30%, transparent);
    --lane-bay: color-mix(in srgb, var(--color-success) 34%, transparent);
    --lane-idle: transparent;
    --lane-staging: color-mix(in srgb, var(--color-accent) 14%, transparent);
    --lane-scan: color-mix(in srgb, var(--color-accent) 20%, transparent);
    --lane-hold: color-mix(in srgb, var(--color-text-dim) 12%, transparent);
    --lane-pause: color-mix(in srgb, var(--color-danger) 30%, transparent);
    --lane-leg: color-mix(in srgb, var(--color-text-secondary) 42%, transparent);
    --lane-repair: color-mix(in srgb, var(--color-warning) 55%, transparent);
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
  }
  .gt-head {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }
  .gt-tag {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-text-dim);
  }
  .gt-note {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    border-left: 2px solid rgba(var(--color-accent-rgb), 0.3);
    padding: 2px 0 2px 10px;
  }
  .gt-mode {
    display: inline-flex;
    border: 1px solid rgba(var(--color-accent-rgb), 0.35);
    border-radius: var(--corner);
    overflow: hidden;
  }
  .gt-mode-btn {
    padding: 4px 10px;
    border: 0;
    background: transparent;
    color: var(--color-text-secondary);
    font-family: inherit;
    font-size: var(--text-xs);
    cursor: pointer;
  }
  .gt-mode-btn[aria-pressed="true"] {
    background: rgba(var(--color-accent-rgb), 0.18);
    color: var(--color-text-primary);
  }
  .gt-mode-btn:focus-visible,
  .gt-steps summary:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }

  .gt-lanes {
    display: flex;
    flex-direction: column;
    padding: 4px 10px;
    border: 1px solid rgba(var(--color-accent-rgb), 0.16);
    border-radius: var(--corner);
    background: rgba(var(--color-accent-rgb), 0.03);
  }
  .gt-axis,
  .gt-lane {
    display: grid;
    grid-template-columns: minmax(150px, 210px) minmax(0, 1fr);
    column-gap: 12px;
    align-items: center;
  }
  .gt-axis {
    padding-top: 6px;
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
  }
  .gt-axis-ends {
    display: flex;
    justify-content: space-between;
  }
  .gt-lane {
    padding: 8px 0;
    border-bottom: 1px solid rgba(var(--color-accent-rgb), 0.1);
    row-gap: 4px;
  }
  .gt-lane:last-child {
    border-bottom: 0;
  }
  .gt-lane-id {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .gt-lane-words {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .gt-lane-name {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--color-text-primary);
  }
  .gt-lane-kind {
    font-weight: normal;
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
  }
  .gt-lane-now {
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
  }
  .gt-ship-badge {
    display: inline-grid;
    place-items: center;
    width: 30px;
    height: 30px;
    flex: none;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--corner);
    background: var(--color-bg-mid);
    color: var(--color-text-secondary);
  }

  .gt-track {
    position: relative;
    height: 28px;
    border: 1px solid rgba(var(--color-accent-rgb), 0.2);
    border-radius: var(--corner);
    background: var(--color-bg-mid);
    overflow: hidden;
  }
  .gt-seg {
    position: absolute;
    top: 0;
    bottom: 0;
    min-width: 2px;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 3px;
    overflow: hidden;
    white-space: nowrap;
    font-size: var(--text-2xs);
    color: var(--color-text-primary);
    border-right: 1px solid color-mix(in srgb, var(--color-bg-deep) 60%, transparent);
  }
  .gt-seg-label {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .gt-seg.current {
    box-shadow: inset 0 0 0 2px var(--color-accent-bright);
  }
  .gt-seg.lost {
    box-shadow: inset 0 0 0 1px var(--color-danger);
  }
  .gt-seg.stopped,
  .gt-swatch.stopped {
    background-image: repeating-linear-gradient(135deg, transparent 0 4px, color-mix(in srgb, var(--color-text-primary) 35%, transparent) 4px 6px);
  }
  .gt-swatch.stopped {
    border: 1px solid var(--color-text-dim);
  }
  .c-work { background-color: var(--lane-work); }
  .c-fight { background-color: var(--lane-fight); }
  .c-wipe { background-color: var(--lane-wipe); }
  .c-travel { background-color: var(--lane-travel); }
  .c-load { background-color: var(--lane-load); }
  .c-bay { background-color: var(--lane-bay); }
  .c-idle { background-color: var(--lane-idle); color: var(--color-text-dim); }
  .c-staging { background-color: var(--lane-staging); }
  .c-scan { background-color: var(--lane-scan); }
  .c-hold { background-color: var(--lane-hold); color: var(--color-text-dim); }
  .c-pause { background-color: var(--lane-pause); }
  .c-leg { background-color: var(--lane-leg); }
  .c-repair { background-color: var(--lane-repair); }

  .gt-steps {
    grid-column: 2;
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
  }
  .gt-steps summary {
    cursor: pointer;
    color: var(--color-text-dim);
    width: fit-content;
  }
  .gt-steps ol {
    margin: 4px 0 0;
    padding-left: 18px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 220px;
    overflow-y: auto;
  }
  .gt-steps li.current {
    color: var(--color-accent-bright);
  }
  .gt-step-when {
    font-family: var(--font-mono);
    color: var(--color-text-dim);
  }

  .gt-key {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
  }
  .gt-key li {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .gt-swatch {
    display: inline-block;
    width: 14px;
    height: 10px;
    border-radius: 2px;
    border: 1px solid rgba(var(--color-accent-rgb), 0.25);
  }

  /* Narrow: the lane's name sits above its track (GO-M3 phone rule). */
  @container (max-width: 560px) {
    .gt-axis,
    .gt-lane {
      grid-template-columns: minmax(0, 1fr);
    }
    .gt-axis-spacer {
      display: none;
    }
    .gt-steps {
      grid-column: 1;
    }
  }
</style>
