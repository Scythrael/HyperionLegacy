<script lang="ts">
  // ============================================================================
  // ShortRangePanel.svelte
  // Short-Range Missions 0.14.0, slice G1-6 (docs/plans/2026-10-17-short-range-missions-plan.md G1-6)
  //
  // The Operations "Short-Range" tab: the BOARD of mission slots, built to the signed-off mockup
  // (https://claude.ai/artifact/HhEA9ARvKjjfAhbnZBSdg3; user 2026-10-21 "I approve all 4 mockups as is", every open
  // question resolved as drawn: pre-pick + one-tap Send, waiting slots as a calm status, the job types list collapsed
  // on the board, the Repeat toggle on by default).
  //
  // POSTURE (the ExpeditionPanel / ShipSystemsPanel way):
  //   - PURE PRESENTATION. Every decision (which captain is pre-picked, every bar, every refusal, the waiting words,
  //     the cost preview) is a tested pure function in shortRangeBoardDisplay.ts over the engine; this component only
  //     draws it. Actions bubble UP to App.svelte (onDispatch / onRecall / onSetRepeat), whose do* handlers run the
  //     pure engine function, guard on the same reference, then pushLog + doSave.
  //   - ONE DOM, CSS breakpoints only: the card grid is two columns in a wide container and one below 720px; the
  //     dispatch popup's picker sits beside its sheet in the wide modal and stacks on a phone. Works at 375px.
  // ============================================================================

  import { shipDisplayLabel, type GameState } from "./game/model";
  import { formatClock, formatNumber } from "./game/format";
  import ActionModal from "./ActionModal.svelte";
  import Toggle from "./Toggle.svelte";
  import Icon from "./ui/Icon.svelte";
  import {
    shortRangeBoardView,
    shortRangeTypeRows,
    shortRangePickerRows,
    shortRangeBars,
    shortRangeVerdict,
    shortRangeCostPreview,
    shortRangeBestReady,
    shortRangeJobView,
    shortRangeTierNumeral,
    type ShortRangeJobView,
    type ShortRangeBarView,
    type ShortRangeRunView,
  } from "./shortRangeBoardDisplay";
  import { shortRangeBoardSlots, shortRangeSlotPreview } from "./game/shortRangeBoard";
  import { shortRangeTemplateUses } from "./game/shortRange";

  export let state: GameState;
  export let showTickCounts: boolean = false;
  export let onDispatch: (captainId: number, slotId: number, repeat: boolean) => void;
  export let onRecall: (captainId: number) => void;
  export let onSetRepeat: (captainId: number, repeat: boolean) => void;
  export let onOpenMissionControl: () => void;

  $: board = shortRangeBoardView(state);
  $: typeRows = shortRangeTypeRows(state);
  $: sec = state.tickDurationSeconds > 0 ? state.tickDurationSeconds : 1;

  // A tick span as the player reads it (the app's clock, with the tick count when they asked for it).
  function span(ticks: number, s: number, showTicks: boolean): string {
    const clock = formatClock(ticks, s);
    return showTicks ? `${Math.max(0, Math.ceil(ticks))} ticks (${clock})` : clock;
  }

  // ===== the dispatch popup =====
  let popupSlotId: number | null = null;
  let popupCaptainId: number | null = null;
  let popupRepeat = true;

  function openPopup(slotId: number, captainId: number | null) {
    popupSlotId = slotId;
    popupCaptainId = captainId ?? shortRangeBestReady(state, slotId);
    popupRepeat = true; // user 2026-10-21 "Keep it, on by default"
  }
  function closePopup() {
    popupSlotId = null;
    popupCaptainId = null;
  }
  function sendFromPopup() {
    if (popupSlotId === null || popupCaptainId === null) return;
    onDispatch(popupCaptainId, popupSlotId, popupRepeat);
    closePopup();
  }

  $: popupSlot = popupSlotId !== null ? shortRangeBoardSlots(state).find((s) => s.id === popupSlotId) ?? null : null;
  // A slot taken while the popup was open (or one that closed) closes the popup rather than dispatching blind.
  $: if (popupSlotId !== null && (popupSlot === null || board.cards.find((c) => c.slotId === popupSlotId)?.kind !== "free")) closePopup();
  $: pickerRows = popupSlot !== null ? shortRangePickerRows(state, popupSlot.id) : [];
  $: popupRoll = popupSlot !== null ? shortRangeSlotPreview(state, popupSlot) : null;
  $: popupJob = popupRoll !== null ? shortRangeJobView(popupRoll) : null;
  $: popupShip = popupCaptainId !== null ? state.ships.find((s) => s.assignedCaptainId === popupCaptainId) ?? null : null;
  $: popupCaptain = popupCaptainId !== null ? state.captains.find((c) => c.id === popupCaptainId) ?? null : null;
  $: popupBars = popupSlot !== null && popupShip !== null && popupRoll !== null ? shortRangeBars(state, popupShip, popupSlot.tier, shortRangeTemplateUses(popupRoll.template)) : [];
  $: popupVerdict = popupSlot !== null && popupCaptainId !== null ? shortRangeVerdict(state, popupCaptainId, popupSlot.id) : null;
  $: popupCost = popupSlot !== null && popupCaptainId !== null && popupVerdict?.ok ? shortRangeCostPreview(state, popupCaptainId, popupSlot) : null;
</script>

<!-- One sheet bar: label (bold when this job uses it, "standby" otherwise), value / sheet, the track with the sheet tick. -->
{#snippet bar(b: ShortRangeBarView)}
  <div class="sr-bar" class:used={b.used}>
    <span class="sr-bar-lbl"><Icon name={b.icon} size={14} /><span>{b.label}{#if !b.used} <span class="sr-standby">standby</span>{/if}</span></span>
    <span class="sr-bar-val" class:short={b.short}>{b.haveText} / {b.needText}{#if b.short} short{/if}</span>
    <span class="sr-track" aria-hidden="true"><span class="sr-fill" class:short={b.short} style="width:{b.fill * 100}%"></span><span class="sr-need"></span></span>
  </div>
{/snippet}

<!-- The job a slot has drawn: glyph, name, its line, a survey's phenomenon, the training and slow-start chips. -->
{#snippet jobBlock(job: ShortRangeJobView)}
  <div class="sr-job">
    <div class="sr-glyph" aria-hidden="true"><Icon name={job.icon} size={26} /></div>
    <div class="sr-job-text">
      <div class="sr-jobname">{job.label}</div>
      <div class="sr-sec">{job.line}</div>
      {#if job.flavor}<div class="sr-dim sr-xs">{job.flavor}</div>{/if}
      {#if job.training || job.rampChip}
        <div class="sr-chips">
          {#if job.training}<span class="sr-chip train"><Icon name="check" size={12} />Training run</span>{/if}
          {#if job.rampChip}<span class="sr-chip">{job.rampChip}</span>{/if}
        </div>
      {/if}
    </div>
  </div>
{/snippet}

{#snippet slotHead(slotId: number, tier: 1 | 2)}
  <div class="sr-slothead"><span>SLOT {slotId + 1}</span><span class="sr-tier">TIER {shortRangeTierNumeral(tier)}</span></div>
{/snippet}

<!-- A run on a slot: running (the cycle timeline) or waiting at home (a calm status, never a warning). -->
{#snippet runCard(slotId: number, tier: 1 | 2, run: ShortRangeRunView)}
  <article class="sr-card">
    {@render slotHead(slotId, tier)}
    {@render jobBlock(run.job)}
    {#if run.hold !== null}
      <div class="sr-chips"><span class="sr-chip wait"><Icon name="home" size={12} />Waiting at home</span></div>
      <div class="sr-waitbox">{run.holdText}</div>
    {:else}
      <div class="sr-timeline" aria-hidden="true">
        {#each run.phases as p, i}
          <span class:cur={i === run.phaseIndex} style="flex:{Math.max(1, p.ticks)}"><b style="width:{p.done * 100}%"></b></span>
        {/each}
      </div>
      <div class="sr-tlabels" aria-hidden="true">
        {#each run.phases as p, i}
          <span class:cur={i === run.phaseIndex} style="flex:{Math.max(1, p.ticks)}">{p.label}</span>
        {/each}
      </div>
    {/if}
    <dl class="sr-kv">
      <dt>Flown by</dt><dd>{run.captainLabel}, {run.shipLabel}</dd>
      <dt>Cycle</dt><dd>{run.cycleNumber} this run</dd>
      {#if run.hold === null}
        <dt>Phase</dt><dd>{run.phaseLabel}, {span(run.phaseRemainingTicks, sec, showTickCounts)} left</dd>
        <dt>Next re-roll</dt><dd>{#if run.recalled}none: this is the last cycle{:else}in {span(run.cycleRemainingTicks, sec, showTickCounts)}, when it docks{/if}</dd>
      {/if}
    </dl>
    <div class="sr-btnrow">
      <span class="sr-toggle"><Toggle checked={!run.recalled} label="Repeat until recalled" on:change={(e) => onSetRepeat(run.captainId, e.detail)} />Repeat</span>
      <span class="sr-spacer"></span>
      {#if run.recalled && run.hold === null}
        <span class="sr-dim sr-xs">Stops after this cycle</span>
      {:else}
        <button type="button" class="sr-btn ghost" on:click={() => onRecall(run.captainId)}>Recall</button>
      {/if}
    </div>
    {#if run.hold !== null}
      <p class="sr-dim sr-xs">It has not left yet, so Recall ends the run now and spends nothing.</p>
    {:else if !run.recalled}
      <p class="sr-dim sr-xs">Recall finishes this cycle, then the ship docks and the captain is free.</p>
    {/if}
  </article>
{/snippet}

<div class="sr">
  <div class="sr-boardhead">
    <div>
      <h2 class="sr-h2">Short-Range Missions</h2>
      <p class="sr-note">Each slot runs on its own until you recall it. The whole job re-rolls every cycle, so a ship that meets the slot's sheet can take any job it draws. Nothing here can fail.</p>
    </div>
    <p class="sr-dim sr-xs">{board.headline}</p>
  </div>
  <div class="sr-legend">
    <span><Icon name="check" size={12} /> green: meets the sheet</span><span>amber: short</span><span>bold: used by this job</span><span>standby: not used by this job, still required</span><span>tick: the sheet line</span>
  </div>

  <div class="sr-grid">
    {#each board.cards as card (card.slotId)}
      {#if card.kind === "run"}
        {@render runCard(card.slotId, card.tier, card.run)}
      {:else if card.kind === "free"}
        <article class="sr-card">
          {@render slotHead(card.slotId, card.tier)}
          {@render jobBlock(card.job)}
          {#if card.compare !== null}
            <p class="sr-sec">Compared with <b>{card.compare.captainLabel}, {card.compare.shipLabel}</b> ({card.compare.ready ? "best ready match" : "no ready captain meets this sheet yet"}).</p>
            <div class="sr-bars">
              {#each card.compare.bars as b (b.category)}{@render bar(b)}{/each}
            </div>
            {#if !card.compare.ready}
              <div class="sr-waitbox">{card.compare.shortLines.join(". ")}.{#if card.compare.wayIn}<br /><span class="sr-dim">{card.compare.wayIn}</span>{/if}</div>
            {/if}
          {:else}
            <p class="sr-sec">No idle captain with a sound ship right now.</p>
            <p class="sr-dim sr-xs">{card.sheetText}</p>
          {/if}
          <div class="sr-btnrow">
            {#if card.compare !== null && card.compare.ready}
              {@const cmp = card.compare}
              <button type="button" class="sr-btn" on:click={() => onDispatch(cmp.captainId, card.slotId, true)}><Icon name="ship" size={14} />Send {cmp.captainLabel}</button>
            {:else}
              <button type="button" class="sr-btn" disabled>Send</button>
            {/if}
            <button type="button" class="sr-btn ghost" on:click={() => openPopup(card.slotId, card.compare?.captainId ?? null)}>Choose captain</button>
          </div>
          <p class="sr-dim sr-xs">Next job shown. It re-rolls each cycle; every roll stays inside this sheet.</p>
        </article>
      {:else}
        <article class="sr-card locked">
          {@render slotHead(card.slotId, card.tier)}
          <div class="sr-job">
            <div class="sr-glyph" aria-hidden="true"><Icon name="lock" size={24} /></div>
            <div class="sr-job-text">
              <div class="sr-jobname">Opens at Mission Control level {card.level}</div>
              <div class="sr-sec">Upgrade: {formatNumber(card.credits)} credits, {span(card.durationTicks, sec, showTickCounts)}. Adds a Tier {shortRangeTierNumeral(card.tier)} slot ({card.sheetText}).</div>
            </div>
          </div>
          {#if card.gate.length > 0}
            <div class="sr-gate">
              <span>Needs {card.gate[0].need} completions each of:</span>
              {#each card.gate as g (g.label)}
                <span>{g.label} <span class="sr-mono sr-dim">{formatNumber(Math.min(g.have, g.need))} / {formatNumber(g.need)}</span></span>
                <span class="sr-mini" aria-hidden="true"><b style="width:{Math.min(100, (g.have / Math.max(1, g.need)) * 100)}%"></b></span>
              {/each}
            </div>
          {/if}
          <div class="sr-btnrow">
            <button type="button" class="sr-btn ghost" on:click={onOpenMissionControl}>Go to Mission Control <Icon name="chevronRight" size={14} /></button>
          </div>
        </article>
      {/if}
    {/each}
  </div>

  <details class="sr-types">
    <summary>Job types this board can draw ({typeRows.length})</summary>
    {#each typeRows as t (t.template)}
      <div class="sr-trow">
        <span class="sr-accent" aria-hidden="true"><Icon name={t.icon} size={18} /></span>
        <b>{t.label}</b>
        <span class="sr-chip" class:train={t.training}>{t.status}</span>
        <span class="sr-uses">Uses: {#each t.uses as u, i (u.category)}<Icon name={u.icon} size={13} /> {u.label}{i < t.uses.length - 1 ? ", " : ""}{/each}</span>
      </div>
    {/each}
    <p class="sr-note">Every job type's first run is a training run: the smallest job, no gear wear, normal length. After it, Tier I jobs grow on the slow start (run 2 at 35%, run 6 about 54%, run 9 about 80%, full from run 11). Tier II jobs are full size from the start.</p>
  </details>
</div>

{#if popupSlot !== null && popupJob !== null}
  <ActionModal title="Dispatch to Slot {popupSlot.id + 1}, Tier {shortRangeTierNumeral(popupSlot.tier)}" onClose={closePopup} wide>
    <div class="sr-dlg">
      <div>
        {@render jobBlock(popupJob)}
        <p class="sr-dim sr-xs sr-picker-h">CAPTAIN AND HULL</p>
        <ul class="sr-picker">
          {#each pickerRows as r (r.captainId)}
            <li>
              <button type="button" aria-pressed={r.captainId === popupCaptainId} disabled={r.kind === "blocked"} on:click={() => (popupCaptainId = r.captainId)}>
                <Icon name={r.kind === "blocked" ? "clock" : "ship"} size={16} />
                <span class="sr-who">{r.label}</span>
                <span class="sr-why" class:ok={r.kind === "ready"} class:short={r.kind === "short"}>{r.why}</span>
              </button>
            </li>
          {:else}
            <li class="sr-dim sr-xs">No captains in the fleet.</li>
          {/each}
        </ul>
      </div>
      <div class="sr-dlg-side">
        {#if popupCaptain !== null}
          <div>
            <h3 class="sr-h3">{popupCaptain.label}{#if popupShip}, {shipDisplayLabel(state, popupShip)}{:else} (no ship){/if}</h3>
            <p class="sr-dim sr-xs">Tier {shortRangeTierNumeral(popupSlot.tier)} sheet against this ship</p>
          </div>
          {#if popupBars.length > 0}
            <div class="sr-bars">{#each popupBars as b (b.category)}{@render bar(b)}{/each}</div>
          {/if}
          {#if popupVerdict !== null && !popupVerdict.ok}
            <div class="sr-refuse">
              <b>{popupVerdict.title}</b>
              <ul>{#each popupVerdict.lines as line}<li>{line}</li>{/each}</ul>
              <span class="sr-dim">Every job on a slot needs the whole sheet, so once a ship meets it, it can take any job the slot draws.</span>
            </div>
          {:else if popupCost !== null}
            <div class="sr-cost">
              <b>Cost preview</b>
              <span>This job: {popupCost.training ? "training run, " : ""}{popupCost.loadNow > 0 ? `a ${formatNumber(Math.round(popupCost.loadNow))} credit load paid as it leaves` : "no load cost"}. Pays about {formatNumber(popupCost.creditsThisJob)} credits and {formatNumber(popupCost.captainXpThisJob)} captain XP; about {span(popupCost.cycleTicks, sec, showTickCounts)} per cycle.</span>
              <span>Later jobs: no upkeep. If a Supply Drop-off is drawn, its {formatNumber(popupCost.dropOffLoad[0])} to {formatNumber(popupCost.dropOffLoad[1])} credit load is paid as the cycle leaves and comes back with a {popupCost.marginPct}% margin. Short on credits, it waits at home and leaves on its own.</span>
              <span class="sr-dim">At full size this ship earns about {formatNumber(popupCost.creditsPerHour)} credits per hour on this slot.</span>
            </div>
          {/if}
        {:else}
          <p class="sr-sec">Pick a captain to compare their ship with this slot's sheet.</p>
        {/if}
        <span class="sr-toggle"><Toggle checked={popupRepeat} label="Repeat until recalled" on:change={(e) => (popupRepeat = e.detail)} />Repeat until recalled</span>
      </div>
    </div>
    <svelte:fragment slot="footer">
      <button type="button" class="sr-btn ghost" on:click={closePopup}>Cancel</button>
      {#if popupCaptain !== null && popupVerdict?.ok}
        <button type="button" class="sr-btn" on:click={sendFromPopup}><Icon name="ship" size={14} />Send {popupCaptain.label}</button>
      {:else}
        <button type="button" class="sr-btn" disabled>Send</button>
      {/if}
    </svelte:fragment>
  </ActionModal>
{/if}

<style>
  .sr {
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .sr-boardhead {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 16px;
    align-items: baseline;
    justify-content: space-between;
  }
  .sr-h2 {
    font-family: var(--font-display);
    font-size: var(--text-lg);
    letter-spacing: 0.04em;
    margin: 0;
  }
  .sr-h3 {
    font-family: var(--font-display);
    font-size: var(--text-sm);
    letter-spacing: 0.04em;
    margin: 0;
  }
  .sr-note {
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
    max-width: 72ch;
    margin: 4px 0;
  }
  .sr-dim { color: var(--color-text-dim); }
  .sr-sec { color: var(--color-text-secondary); font-size: var(--text-sm); margin: 0; }
  .sr-xs { font-size: var(--text-xs); margin: 0; }
  .sr-mono { font-family: var(--font-mono); }
  .sr-accent { color: var(--color-accent); display: inline-flex; }
  .sr-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    font-size: var(--text-xs);
    color: var(--color-text-dim);
  }

  /* The board: one column on a phone, two in a wide container (the mockup's grid). */
  .sr-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
  }
  @container (min-width: 720px) {
    .sr-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  .sr-card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
    padding: 14px;
    background: var(--color-panel-bg);
    border: 1px solid var(--color-border);
    border-radius: var(--corner);
  }
  .sr-card.locked {
    border-style: dashed;
    color: var(--color-text-secondary);
  }
  .sr-slothead {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    font: 500 var(--text-xs) var(--font-display);
    letter-spacing: 0.08em;
    color: var(--color-text-secondary);
  }
  .sr-tier {
    padding: 2px 6px;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--corner);
    color: var(--color-accent);
  }
  .sr-job { display: flex; gap: 12px; align-items: flex-start; }
  .sr-job-text { min-width: 0; }
  .sr-glyph {
    width: 48px;
    height: 48px;
    flex: none;
    display: grid;
    place-items: center;
    color: var(--color-accent);
    background: rgba(var(--color-accent-rgb), 0.06);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--corner);
  }
  .sr-jobname { font-weight: 600; font-size: var(--text-lg); }
  .sr-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
  .sr-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: var(--text-xs);
    padding: 2px 7px;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--corner);
    color: var(--color-text-secondary);
  }
  .sr-chip.train { border-color: var(--color-success); color: var(--color-success); }
  .sr-chip.wait { color: var(--color-text-primary); }

  /* Sheet bars: label + value on one line, the track under both; the sheet tick at 70% (SHORT_RANGE_SHEET_MARK). */
  .sr-bars { display: grid; gap: 7px; }
  .sr-bar {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 2px 8px;
    align-items: center;
    font-size: var(--text-sm);
  }
  .sr-bar-lbl { display: flex; gap: 6px; align-items: center; min-width: 0; color: var(--color-text-secondary); }
  .sr-bar.used .sr-bar-lbl { color: var(--color-text-primary); font-weight: 600; }
  .sr-bar-val { font-family: var(--font-mono); font-size: var(--text-xs); white-space: nowrap; }
  .sr-bar-val.short { color: var(--color-warning); }
  .sr-standby { font-size: var(--text-2xs); color: var(--color-text-dim); font-weight: 400; }
  .sr-track {
    grid-column: 1 / -1;
    position: relative;
    height: 6px;
    background: rgba(var(--color-accent-rgb), 0.08);
    border-radius: var(--corner);
  }
  .sr-fill {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--color-success);
    border-radius: var(--corner);
    opacity: 0.85;
  }
  .sr-bar:not(.used) .sr-fill { opacity: 0.4; }
  .sr-fill.short { background: var(--color-warning); }
  .sr-need {
    position: absolute;
    top: -3px;
    bottom: -3px;
    left: 70%;
    width: 2px;
    background: var(--color-text-primary);
    opacity: 0.55;
  }

  .sr-btnrow { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .sr-spacer { flex: 1; }
  .sr-btn {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    font: 600 var(--text-sm) var(--font-body);
    padding: 8px 14px;
    min-height: 36px;
    color: var(--color-accent);
    background: rgba(var(--color-accent-rgb), 0.16);
    border: 1px solid var(--color-accent);
    border-radius: var(--corner);
    cursor: pointer;
  }
  .sr-btn.ghost {
    background: none;
    border-color: var(--color-border-strong);
    color: var(--color-text-secondary);
  }
  .sr-btn:disabled { opacity: 0.55; cursor: not-allowed; }
  .sr-toggle {
    display: inline-flex;
    gap: 8px;
    align-items: center;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .sr-timeline { display: flex; gap: 2px; height: 8px; }
  .sr-timeline span {
    position: relative;
    overflow: hidden;
    background: rgba(var(--color-accent-rgb), 0.12);
    border-radius: var(--corner);
  }
  .sr-timeline span b { position: absolute; inset: 0 auto 0 0; background: var(--color-accent); }
  .sr-tlabels { display: flex; gap: 2px; font-size: var(--text-2xs); color: var(--color-text-dim); }
  .sr-tlabels span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sr-tlabels .cur { color: var(--color-accent); }
  @media (prefers-reduced-motion: no-preference) {
    .sr-timeline .cur b { animation: sr-pulse 2.4s ease-in-out infinite; }
    @keyframes sr-pulse { 50% { opacity: 0.65; } }
  }
  .sr-kv {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 3px 12px;
    font-size: var(--text-sm);
    margin: 0;
  }
  .sr-kv dt { color: var(--color-text-dim); }
  .sr-kv dd { margin: 0; }
  .sr-waitbox {
    border-left: 2px solid var(--color-border-strong);
    padding: 6px 10px;
    background: rgba(var(--color-accent-rgb), 0.05);
    font-size: var(--text-sm);
  }
  .sr-gate { display: grid; gap: 6px; font-size: var(--text-sm); }
  .sr-mini { height: 4px; position: relative; background: rgba(var(--color-accent-rgb), 0.1); border-radius: var(--corner); }
  .sr-mini b { position: absolute; inset: 0 auto 0 0; background: var(--color-accent); opacity: 0.7; }

  .sr-types summary { cursor: pointer; font: 500 var(--text-sm) var(--font-body); color: var(--color-text-secondary); }
  .sr-trow {
    display: grid;
    grid-template-columns: 22px minmax(0, 1fr) auto;
    gap: 4px 10px;
    align-items: center;
    padding: 6px 0;
    border-top: 1px solid var(--color-border);
    font-size: var(--text-sm);
  }
  .sr-uses {
    grid-column: 2 / -1;
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
    color: var(--color-text-dim);
  }

  /* The dispatch popup: the picker beside the sheet in the wide modal, stacked on a phone. */
  .sr-dlg {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
  }
  @container (min-width: 720px) {
    .sr-dlg { grid-template-columns: minmax(0, 300px) minmax(0, 1fr); }
  }
  .sr-dlg-side { display: grid; gap: 12px; align-content: start; min-width: 0; }
  .sr-picker-h { margin-top: 10px; letter-spacing: 0.06em; }
  .sr-picker { display: grid; gap: 6px; margin: 8px 0 0; padding: 0; list-style: none; }
  .sr-picker button {
    width: 100%;
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr);
    gap: 2px 8px;
    padding: 8px 10px;
    text-align: left;
    font: inherit;
    color: var(--color-text-primary);
    background: none;
    border: 1px solid var(--color-border);
    border-radius: var(--corner);
    cursor: pointer;
  }
  .sr-picker button[aria-pressed="true"] { border-color: var(--color-accent); background: rgba(var(--color-accent-rgb), 0.08); }
  .sr-picker button:disabled { opacity: 0.6; cursor: not-allowed; }
  .sr-who { font-weight: 600; min-width: 0; }
  .sr-why { grid-column: 2; font-size: var(--text-xs); color: var(--color-text-secondary); }
  .sr-why.ok { color: var(--color-success); }
  .sr-why.short { color: var(--color-warning); }
  .sr-refuse {
    border-left: 2px solid var(--color-warning);
    padding: 8px 10px;
    background: rgba(var(--color-warning-rgb), 0.06);
    font-size: var(--text-sm);
  }
  .sr-refuse ul { margin: 4px 0 4px 18px; padding: 0; }
  .sr-cost { display: grid; gap: 4px; font-size: var(--text-sm); }

  @media (max-width: 420px) {
    .sr-glyph { width: 40px; height: 40px; }
    .sr-btn { padding: 8px 10px; }
  }
</style>
