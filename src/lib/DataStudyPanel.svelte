<script lang="ts">
  // DataStudyPanel.svelte: the Research Lab's DATA STUDY tab (0.14.0, Gas Giant Study GG-6; the signed-off v3 mockup
  // section 3, "approve as is" 2026-10-21). Left card: the lane ("Lane 1 of 1", the Lab level), the auto-study switch,
  // the study under way with its countdown and bar, the held data in study order (oldest first, as drawn) and the last
  // few finished studies. Right card: the banked boosts per family and what each family's next project gets.
  // GG-7: below both, the SPECIAL BLUEPRINTS (the v3 mockup section 4 cards: each one's glyph, name, line and Lab tier,
  // and its state chip: the entry it waits on, "Unlocked: ready to research", researching, researched) with the decode
  // gate's line. The mockup draws them in a Cultures tab that waits on the culture names (R2-8), so they sit here.
  //
  // POSTURE: pure presentation over dataStudyDisplay.ts (tested). The switch bubbles up through onSetPaused to the
  // host's do* handler (App.svelte doSetDataStudyPaused: dataStudy.ts setDataStudyPaused, pushLog, doSave). One DOM,
  // CSS breakpoints only (a container query stacks the cards below 820 px of panel width); works at 375 px.

  import type { DataStudyView } from "./dataStudyDisplay";
  import Icon from "./ui/Icon.svelte";
  import JobOvertimeStrip from "./JobOvertimeStrip.svelte";
  import OvertimeRateChip from "./OvertimeRateChip.svelte";

  export let view: DataStudyView;
  // Turn auto-study off (true) or back on (false).
  export let onSetPaused: (paused: boolean) => void;
  // OT-UI (user 2026-11-10 "One tap, always visible"): buys the next Overtime step on the study under way (App's
  // buyJobOvertime). Absent = the strip shows its state but no button.
  export let onBuyOvertime: ((processId: string) => void) | undefined = undefined;
</script>

<div class="ds-wrap">
  {#if !view.open}
    <p class="ds-closed">{view.closedText}</p>
  {:else}
    <div class="ds">
      <section class="ds-card" aria-labelledby="ds-lane-h">
        <div class="ds-head">
          <h3 id="ds-lane-h" class="ds-h">{view.laneText} <span class="ds-dim">{view.labLevelText}</span></h3>
          <button
            type="button"
            class="ds-switch"
            role="switch"
            aria-checked={!view.paused}
            aria-labelledby="ds-switch-label"
            on:click={() => onSetPaused(!view.paused)}
          >
            <span class="ds-knob" class:off={view.paused} aria-hidden="true"></span>
            {#if view.paused}<Icon name="pause" size={14} />{/if}
            <span id="ds-switch-label">Auto-study</span>
            <span aria-hidden="true">{view.switchText}</span>
          </button>
        </div>

        <div class="ds-cur">
          <span class="ds-cur-glyph" aria-hidden="true"><Icon name={view.current ? view.current.glyph : "researchData"} size={28} /></span>
          <div class="ds-cur-words">
            {#if view.current}
              <b>{view.current.name}</b>
              <span class="ds-dim ds-eta">{#if view.current.rateText}<OvertimeRateChip rate={view.current.rateText} />{/if}{view.current.etaText}</span>
            {:else}
              <b>{view.idleText}</b>
              <span class="ds-dim">{view.idleSub}</span>
            {/if}
          </div>
        </div>
        <div
          class="ds-prog"
          role="progressbar"
          aria-label="Data study progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(view.current ? view.current.progressPct : 0)}
        >
          <i style="width: {view.current ? view.current.progressPct : 0}%;" class:paused={view.paused}></i>
        </div>
        {#if view.current?.overtime}<JobOvertimeStrip strip={view.current.overtime} onBuy={onBuyOvertime} />{/if}
        <p class="ds-dim ds-note">{view.note}</p>
        {#each view.fullWarnings as w, i (i)}<p class="ds-full">{w}</p>{/each}

        <h3 class="ds-h ds-sub">Held data, next first</h3>
        <ul class="ds-q">
          {#each view.queue as row (row.key)}
            <li class:full={row.full}>
              <Icon name={row.glyph} size={16} /> <span>{row.name}</span>
              <span class="ds-ct">x{row.count}</span>
              {#if row.heldText}<span class="ds-held" title="Held of this type / its warehouse cap">{row.heldText}{#if row.full} full{/if}</span>{/if}
            </li>
          {:else}
            <li class="ds-dim">{view.queueEmptyText}</li>
          {/each}
        </ul>
        {#if view.log.length > 0}
          <ul class="ds-log" aria-label="Recent data studies">
            {#each view.log as line, i (i)}<li>{line}</li>{/each}
          </ul>
        {/if}
      </section>

      <section class="ds-card" aria-labelledby="ds-boost-h">
        <h3 id="ds-boost-h" class="ds-h">Banked boosts</h3>
        <p class="ds-dim">{view.boostNote}</p>
        <table class="ds-boosts">
          <thead>
            <tr><th scope="col">Family</th><th scope="col">Banked</th><th scope="col">Next project</th></tr>
          </thead>
          <tbody>
            {#each view.boosts as b (b.family)}
              <tr class:zero={b.banked === 0}>
                <th scope="row">{b.label}</th>
                <td class="ds-mono">{b.banked}</td>
                <td class="ds-mono">{b.nextText}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if view.ancientText}<p class="ds-dim ds-note">{view.ancientText}</p>{/if}
      </section>

      <section class="ds-card ds-specials" aria-labelledby="ds-sp-h">
        <h3 id="ds-sp-h" class="ds-h">Special blueprints</h3>
        <p class="ds-dim ds-note">{view.decodeGateText}</p>
        <ul class="ds-bps">
          {#each view.specials as sp (sp.key)}
            <li class="ds-bp" class:open={sp.state === "open"} class:done={sp.state === "researched" || sp.state === "researching"}>
              <div class="ds-bp-row">
                <span class="ds-bp-glyph" class:ok={sp.state !== "locked"} aria-hidden="true"><Icon name={sp.glyph} size={28} /></span>
                <b>{sp.name}</b>
              </div>
              <p class="ds-bp-text">{sp.text}</p>
              <span class="ds-chip" class:ok={sp.state !== "locked"}>
                {#if sp.state === "locked"}<Icon name="lock" size={14} />{/if}
                {sp.chipText}
              </span>
            </li>
          {/each}
        </ul>
      </section>
    </div>
  {/if}
</div>

<style>
  .ds-wrap {
    container-type: inline-size;
  }
  .ds {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
  }
  @container (min-width: 820px) {
    .ds {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      align-items: start;
    }
  }
  .ds-closed {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }
  .ds-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    min-width: 0;
    background: rgba(var(--color-accent-rgb), 0.04);
    border: 1px solid rgba(var(--color-accent-rgb), 0.14);
    border-radius: var(--corner);
  }
  .ds-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .ds-h {
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--text-sm);
    letter-spacing: 0.06em;
    color: var(--color-text-primary);
  }
  .ds-sub {
    margin-top: 6px;
  }
  .ds-dim {
    font-family: var(--font-body, inherit);
    letter-spacing: 0;
    font-size: var(--text-xs);
    color: var(--color-text-dim);
  }
  .ds-note {
    margin: 0;
  }
  .ds-full {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-danger);
  }
  .ds-switch {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 32px;
    padding: 4px 10px;
    font: inherit;
    font-size: var(--text-xs);
    color: var(--color-text-primary);
    background: transparent;
    border: 1px solid rgba(var(--color-accent-rgb), 0.4);
    border-radius: var(--corner);
    cursor: pointer;
  }
  .ds-switch:focus-visible {
    outline: 2px solid var(--color-accent-bright);
    outline-offset: 2px;
  }
  .ds-knob {
    position: relative;
    width: 30px;
    height: 16px;
    border-radius: 8px;
    background: var(--color-success);
    flex: none;
  }
  .ds-knob::after {
    content: "";
    position: absolute;
    top: 2px;
    left: 16px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--color-bg-deep);
    transition: left 0.15s;
  }
  .ds-knob.off {
    background: var(--color-text-dim);
  }
  .ds-knob.off::after {
    left: 2px;
  }
  .ds-cur {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 4px;
  }
  .ds-cur-glyph {
    display: inline-flex;
    color: var(--color-accent-bright);
  }
  .ds-cur-words {
    display: flex;
    flex-direction: column;
    min-width: 0;
    font-size: var(--text-sm);
  }
  /* OT-UI: the rate chip leads the study's time line. */
  .ds-eta {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .ds-prog {
    height: 8px;
    background: var(--color-bg-mid);
    border: 1px solid rgba(var(--color-accent-rgb), 0.2);
    border-radius: var(--corner);
    overflow: hidden;
  }
  .ds-prog i {
    display: block;
    height: 100%;
    background: var(--color-accent-bright);
  }
  .ds-prog i.paused {
    background: var(--color-text-dim);
  }
  .ds-q,
  .ds-log {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 4px;
  }
  .ds-q li {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: var(--text-xs);
    padding: 4px 6px;
    border: 1px solid rgba(var(--color-accent-rgb), 0.14);
    border-radius: var(--corner);
    color: var(--color-text-primary);
  }
  .ds-held {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
  }
  .ds-q li.full .ds-held {
    color: var(--color-danger);
  }
  .ds-ct {
    margin-left: auto;
    font-family: var(--font-mono);
    color: var(--color-text-secondary);
  }
  .ds-log li {
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
    padding-left: 10px;
    border-left: 2px solid rgba(var(--color-accent-rgb), 0.25);
  }
  .ds-boosts {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-xs);
  }
  .ds-boosts th,
  .ds-boosts td {
    text-align: left;
    padding: 3px 6px 3px 0;
  }
  .ds-boosts thead th {
    font-size: var(--text-2xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-text-dim);
    font-weight: normal;
  }
  .ds-boosts tbody th {
    font-weight: normal;
    color: var(--color-text-primary);
  }
  .ds-boosts tr.zero th,
  .ds-boosts tr.zero td {
    color: var(--color-text-dim);
  }
  .ds-mono {
    font-family: var(--font-mono);
  }
  .ds-specials {
    grid-column: 1 / -1;
  }
  .ds-bps {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 8px;
    grid-template-columns: minmax(0, 1fr);
  }
  @container (min-width: 640px) {
    .ds-bps {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
  .ds-bp {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    padding: 10px;
    min-width: 0;
    font-size: var(--text-xs);
    border: 1px solid rgba(var(--color-accent-rgb), 0.18);
    border-radius: var(--corner);
    color: var(--color-text-primary);
  }
  .ds-bp.open,
  .ds-bp.done {
    border-color: var(--color-success);
  }
  .ds-bp-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .ds-bp-glyph {
    display: inline-flex;
    color: var(--color-text-secondary);
  }
  .ds-bp-glyph.ok {
    color: var(--color-success);
  }
  .ds-bp-text {
    margin: 0;
    color: var(--color-text-secondary);
  }
  .ds-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
    border: 1px solid rgba(var(--color-accent-rgb), 0.3);
    border-radius: var(--corner);
  }
  .ds-chip.ok {
    color: var(--color-success);
    border-color: var(--color-success);
  }
  @media (prefers-reduced-motion: reduce) {
    .ds-knob::after {
      transition: none;
    }
  }
</style>
