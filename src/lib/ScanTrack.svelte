<script lang="ts">
  // ScanTrack.svelte: one body's SCAN TRACK (0.14.0, Ground Operations GO-15, the EC-M section 5 layout): the rail
  // filled to the scanned share, a pip per recorded scan event (ship events, supply caches; a legacy run's ground
  // battles) at its step, and the log lines in plain words. A pip is a button: it marks its log line (and a screen
  // reader hears the whole outcome from its name). A legacy ground battle's line offers its re-derived battle log.
  // Pure presentation over scanTrackDisplay.ts scanTrackView (tested).

  import type { ScanTrackView } from "./scanTrackDisplay";
  import Icon from "./ui/Icon.svelte";

  export let track: ScanTrackView;
  // A unique prefix for the log line ids (one track per body).
  export let idBase: string;
  // A legacy ground battle's round log, read on demand (gambit.ts deriveScanEncounterLog through the panel).
  export let battleLines: (step: number) => { key: string; text: string; round: boolean; enemy: boolean; down: boolean }[] = () => [];

  let selected: string | null = null;
  let openLogs: Record<string, ReturnType<typeof battleLines>> = {};

  function toggleLog(key: string, step: number): void {
    if (openLogs[key]) {
      const next = { ...openLogs };
      delete next[key];
      openLogs = next;
      return;
    }
    openLogs = { ...openLogs, [key]: battleLines(step) };
  }
</script>

<div class="st">
  <div class="st-track">
    <div class="st-rail" role="img" aria-label={track.ariaLabel}>
      <div class="st-fill" style="width: {track.scannedPct}%;"></div>
    </div>
    {#each track.pips as pip (pip.key)}
      <button
        type="button"
        class="st-pip t-{pip.tone}"
        class:on={selected === pip.key}
        style="left: {pip.posPct}%;"
        aria-label={pip.ariaLabel}
        aria-pressed={selected === pip.key}
        aria-controls="{idBase}-{pip.key}"
        title={pip.title}
        on:click={() => (selected = selected === pip.key ? null : pip.key)}
      >
        <Icon name={pip.glyph} size={12} />
      </button>
    {/each}
  </div>

  {#if track.pips.length > 0}
    <ol class="st-log" aria-label="Scan events">
      {#each track.pips as pip (pip.key)}
        <li id="{idBase}-{pip.key}" class="st-line t-{pip.tone}" class:on={selected === pip.key}>
          <span class="st-at">{pip.atText}</span>
          <span class="st-text">
            <span class="st-glyph" aria-hidden="true"><Icon name={pip.glyph} size={12} /></span>
            {pip.sentence}
            {#if pip.battleLog}
              <button type="button" class="st-log-toggle" aria-expanded={openLogs[pip.key] !== undefined} on:click={() => toggleLog(pip.key, pip.step)}>
                {openLogs[pip.key] ? "Hide battle log" : "View battle log"}
              </button>
              {#if openLogs[pip.key]}
                <span class="st-battle">
                  {#if openLogs[pip.key].length === 0}
                    <span class="st-battle-line dim">No battle record for this step.</span>
                  {:else}
                    {#each openLogs[pip.key] as line (line.key)}
                      <span class="st-battle-line" class:round={line.round} class:enemy={line.enemy} class:down={line.down}>{line.text}</span>
                    {/each}
                  {/if}
                </span>
              {/if}
            {/if}
          </span>
        </li>
      {/each}
    </ol>
  {:else if track.emptyText}
    <div class="st-empty">{track.emptyText}</div>
  {/if}
</div>

<style>
  .st {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  /* The pips sit on the rail; the side margins keep a pip at 10% or 90% inside the card. */
  .st-track {
    position: relative;
    height: 26px;
    margin: 0 12px;
  }
  .st-rail {
    position: absolute;
    left: 0;
    right: 0;
    top: 11px;
    height: 4px;
    border-radius: 3px;
    background: rgba(var(--color-accent-rgb), 0.16);
    overflow: hidden;
  }
  .st-fill {
    height: 100%;
    background: var(--color-accent-bright);
  }
  .st-pip {
    position: absolute;
    top: 1px;
    /* 24 px: the minimum pointer target. */
    width: 24px;
    height: 24px;
    margin-left: -12px;
    padding: 0;
    border-radius: 50%;
    display: grid;
    place-items: center;
    cursor: pointer;
    background: var(--color-bg-deep, #0a0e17);
    border: 1.5px solid currentColor;
  }
  .st-pip.t-good {
    color: var(--color-success);
  }
  /* A costly outcome: the warning color AND a dashed ring (never color alone). */
  .st-pip.t-bad {
    color: var(--color-warning);
    border-style: dashed;
  }
  .st-pip.on {
    box-shadow: 0 0 0 2px rgba(var(--color-accent-rgb), 0.55);
  }
  .st-pip:focus-visible,
  .st-log-toggle:focus-visible {
    outline: 2px solid var(--color-accent-bright);
    outline-offset: 2px;
  }

  .st-log {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 4px;
  }
  .st-line {
    display: grid;
    grid-template-columns: 3.2em minmax(0, 1fr);
    gap: 6px;
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
    line-height: 1.4;
    padding: 2px 4px;
    border-radius: 4px;
    border-left: 2px solid transparent;
  }
  .st-line.on {
    background: rgba(var(--color-accent-rgb), 0.1);
    border-left-color: var(--color-accent-bright);
  }
  .st-at {
    font-variant-numeric: tabular-nums;
    color: var(--color-text-dim);
  }
  .st-text {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .st-glyph {
    display: inline-flex;
    vertical-align: -2px;
    margin-right: 2px;
  }
  .st-line.t-good .st-glyph {
    color: var(--color-success);
  }
  .st-line.t-bad .st-glyph {
    color: var(--color-warning);
  }
  .st-log-toggle {
    display: inline-block;
    margin-left: 4px;
    padding: 0 6px;
    font: inherit;
    font-size: var(--text-2xs);
    color: var(--color-accent-bright);
    background: transparent;
    border: 1px solid rgba(var(--color-accent-rgb), 0.35);
    border-radius: 4px;
    cursor: pointer;
  }
  .st-battle {
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin-top: 4px;
    padding: 4px 6px;
    border-left: 2px solid rgba(var(--color-accent-rgb), 0.3);
  }
  .st-battle-line {
    color: var(--color-text-secondary);
  }
  .st-battle-line.round {
    color: var(--color-text-dim);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-top: 2px;
  }
  .st-battle-line.enemy {
    color: var(--color-text-dim);
  }
  .st-battle-line.down {
    color: var(--color-warning);
  }
  .st-battle-line.dim {
    font-style: italic;
    color: var(--color-text-dim);
  }
  .st-empty {
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
    font-style: italic;
  }
</style>
