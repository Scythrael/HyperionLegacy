<script context="module" lang="ts">
  // A unique id per section on the page (the Hide button's aria-controls).
  let nextSectionId = 0;
</script>

<script lang="ts">
  // SystemsSection.svelte: the SYSTEMS section at the top of the Archive's Survey Log tab (0.14.0 completion tracking;
  // the approved 2026-11-13 mockup, user Q8 "A: top of the Survey Log"). Every visited system with its completion, one row
  // per system at its best % (Q2 B): name (Real star, Enemy territory), Bodies, Objectives (skipped ones noted), the %
  // bar, and a state (Under way, In Resume, Abandoned; nothing once claimed). The badge and "Completed" stand in for the
  // bar's number at 100%. Grouped by tier with Roman numerals, nearest tier first, each group counting its systems and
  // completions; "By completion" and "Newest first" flatten the list (remembered per viewer). Starts open, with Hide.
  // The list starts at the update (Q5 A) and its foot says so.
  //
  // POSTURE: pure presentation over completionDisplay.ts systemsSectionView (tested), reading game/completion.ts
  // systemRows. One DOM: a container query lays each row out as a table row from 620 px of panel width, a card under it.

  import type { SystemRow } from "./game/completion";
  import { SYSTEMS_EMPTY, SYSTEMS_FOOT, SYSTEMS_SORTS, systemsSectionView, type SystemsSort } from "./completionDisplay";
  import { loadSystemsOpen, loadSystemsSort, saveSystemsOpen, saveSystemsSort } from "./completionPreference";
  import Icon from "./ui/Icon.svelte";

  export let rows: readonly SystemRow[];

  let sort: SystemsSort = loadSystemsSort();
  let open = loadSystemsOpen();
  $: view = systemsSectionView(rows, sort);

  function pickSort(s: SystemsSort): void {
    sort = s;
    saveSystemsSort(s);
  }
  function toggle(): void {
    open = !open;
    saveSystemsOpen(open);
  }
  const bodyId = `sy-body-${nextSectionId++}`;
</script>

<section class="sy" aria-label="Systems">
  <div class="sy-hd">
    <h4 class="sy-t"><Icon name="systemComplete" size={16} /> Systems</h4>
    <span class="sy-n"><b>{view.visited}</b> visited · <span class="ok"><Icon name="systemComplete" size={12} /> <b>{view.completed}</b> completed</span></span>
    <span class="spacer"></span>
    <button type="button" class="sy-hide" aria-expanded={open} aria-controls={bodyId} on:click={toggle}>
      <Icon name={open ? "chevronUp" : "chevronDown"} size={12} />
      {open ? "Hide" : "Show"}
    </button>
  </div>
  {#if open}
    <div class="sy-body" id={bodyId}>
      {#if view.empty}
        <p class="sy-empty">{SYSTEMS_EMPTY}</p>
      {:else}
        <div class="sy-tools" role="group" aria-label="Sort systems">
          <span class="lbl"><Icon name="sort" size={12} /> Sort</span>
          <span class="seg">
            {#each SYSTEMS_SORTS as s (s.id)}
              <button type="button" aria-pressed={sort === s.id} class:on={sort === s.id} on:click={() => pickSort(s.id)}>{s.label}</button>
            {/each}
          </span>
        </div>
        {#each view.groups as g (g.key)}
          <div class="sy-group">
            {#if g.heading}<h5 class="sy-gh">{g.heading} <span class="sy-count">{g.countText}</span></h5>{/if}
            <div class="sy-colhead" aria-hidden="true"><span>System</span><span>Bodies</span><span>Objectives</span><span>Completion</span><span>State</span></div>
            <ul class="sy-rows">
              {#each g.rows as r (r.id)}
                <li class="sy-row" class:done={r.complete}>
                  <span class="nm">
                    <span class="nm-t">{r.name}</span>
                    {#if r.realStar}<span class="chip star">Real star</span>{/if}
                    {#if r.enemyTerritory}<span class="chip enemy">Enemy territory</span>{/if}
                    {#if sort !== "tier"}<span class="sy-tier">{r.tierText}</span>{/if}
                  </span>
                  <span class="cell"><span class="k">Bodies</span> <span class="mono">{r.bodiesText}</span></span>
                  <span class="cell"><span class="k">Objectives</span> <span class="mono">{r.objectivesText}</span>{#if r.skippedText}<span class="sk"> · {r.skippedText}</span>{/if}</span>
                  <span class="cell pbar" class:done={r.complete}>
                    <span class="k">Completion</span>
                    <i aria-hidden="true"><b style="width: {r.percent}%;"></b></i>
                    {#if r.complete}
                      <span class="sy-done"><Icon name="systemComplete" size={12} /> Completed</span>
                    {:else}
                      <span class="v">{r.percent}%</span>
                    {/if}
                  </span>
                  <span class="cell st">
                    {#if r.stateKind === "inResume"}
                      <span class="st-chip res"><Icon name="resume" size={11} /> {r.stateText}</span>
                    {:else if r.stateText}
                      <span class="st-chip {r.stateKind}">{r.stateText}</span>
                    {/if}
                  </span>
                </li>
              {/each}
            </ul>
          </div>
        {/each}
      {/if}
      <p class="sy-foot">{SYSTEMS_FOOT}</p>
    </div>
  {/if}
</section>

<style>
  .sy {
    container-type: inline-size;
    border: 1px dashed rgba(var(--color-accent-rgb), 0.25);
    border-radius: var(--corner, 6px);
    padding: 10px 12px;
    margin-bottom: 14px;
  }
  .sy-hd {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 12px;
  }
  .sy-t {
    margin: 0;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-display);
    font-size: var(--text-sm);
    letter-spacing: 0.04em;
    color: var(--color-text-primary);
  }
  .sy-n {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }
  .sy-n b {
    font-family: var(--font-mono);
    color: var(--color-text-primary);
  }
  .ok {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--color-success);
  }
  .sy-n .ok b {
    color: inherit;
  }
  .spacer {
    flex: 1 1 auto;
  }
  .sy-hide {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 32px;
    padding: 2px 10px;
    font-size: var(--text-xs);
    background: none;
    border: 1px solid var(--color-border);
    border-radius: 999px;
    color: var(--color-text-secondary);
    cursor: pointer;
  }
  .sy-body {
    margin-top: 8px;
  }
  .sy-empty,
  .sy-foot {
    margin: 8px 0 0;
    font-size: var(--text-xs);
    color: var(--color-text-dim);
  }
  .sy-tools {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    margin-bottom: 8px;
  }
  .lbl {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: var(--text-xs);
    color: var(--color-text-dim);
  }
  .seg {
    display: inline-flex;
    flex-wrap: wrap;
    border: 1px solid var(--color-border);
    border-radius: 999px;
    overflow: hidden;
  }
  .seg button {
    min-height: 32px;
    padding: 2px 10px;
    font-size: var(--text-xs);
    background: none;
    border: none;
    color: var(--color-text-secondary);
    cursor: pointer;
  }
  .seg button.on {
    background: rgba(var(--color-accent-rgb), 0.18);
    color: var(--color-accent-bright);
  }
  .sy-group + .sy-group {
    margin-top: 10px;
  }
  .sy-gh {
    margin: 0 0 4px;
    font-family: var(--font-display);
    font-size: var(--text-xs);
    letter-spacing: 0.04em;
    color: var(--color-text-primary);
  }
  .sy-count {
    font-family: var(--font-mono);
    color: var(--color-text-dim);
    margin-left: 4px;
    font-weight: 400;
    /* Review (375 px): the count wraps as one unit under the heading, never mid-phrase ("1 / completed"). */
    display: inline-block;
    white-space: nowrap;
  }
  .sy-rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  /* A phone: each system is a card. */
  .sy-colhead {
    display: none;
  }
  .sy-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 4px 10px;
    padding: 8px 10px;
    border: 1px solid var(--color-border);
    border-radius: var(--corner, 6px);
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    min-width: 0;
  }
  .sy-row.done {
    border-color: rgba(52, 211, 153, 0.45);
  }
  .nm {
    grid-column: 1 / -1;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 6px;
    color: var(--color-text-primary);
    min-width: 0;
  }
  .nm-t {
    overflow-wrap: anywhere;
  }
  .sy-tier {
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
  }
  .chip {
    font-size: var(--text-2xs);
    padding: 0 7px;
    border-radius: 999px;
    white-space: nowrap;
  }
  .chip.star {
    border: 1px solid var(--color-accent);
    color: var(--color-accent-bright);
  }
  .chip.enemy {
    border: 1px dashed var(--color-danger);
    color: var(--color-danger);
  }
  .cell {
    min-width: 0;
  }
  .k {
    color: var(--color-text-dim);
  }
  .mono {
    font-family: var(--font-mono);
    color: var(--color-text-primary);
  }
  .sk {
    color: var(--color-text-dim);
  }
  .pbar {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .pbar i {
    flex: 1 1 auto;
    height: 6px;
    border-radius: 3px;
    background: rgba(var(--color-accent-rgb), 0.14);
    overflow: hidden;
    display: block;
    min-width: 40px;
  }
  .pbar i b {
    display: block;
    height: 100%;
    background: var(--color-accent);
  }
  .pbar.done i b {
    background: var(--color-success);
  }
  .v {
    font-family: var(--font-mono);
    color: var(--color-text-primary);
    min-width: 3.5ch;
    text-align: right;
  }
  .sy-done {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--color-success);
    white-space: nowrap;
  }
  .st {
    grid-column: 1 / -1;
  }
  .st:empty {
    display: none;
  }
  .st-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: var(--text-2xs);
    padding: 1px 8px;
    border-radius: 999px;
    border: 1px solid var(--color-border);
    color: var(--color-text-secondary);
    white-space: nowrap;
  }
  .st-chip.underWay {
    border-color: var(--color-accent);
    color: var(--color-accent-bright);
  }
  .st-chip.res {
    border-color: var(--color-accent);
    color: var(--color-accent-bright);
  }
  .st-chip.abandoned {
    border-style: dashed;
    color: var(--color-text-dim);
  }
  /* Wide panel: one table row per system, the column heads above each group, the in-cell labels for screen readers. */
  @container (min-width: 620px) {
    .sy-colhead {
      display: grid;
      grid-template-columns: 28% 10% 18% 30% 14%;
      padding: 0 10px 2px;
      font-size: var(--text-2xs);
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--color-text-dim);
    }
    .sy-rows {
      gap: 0;
    }
    .sy-row {
      grid-template-columns: 28% 10% 18% 30% 14%;
      gap: 0;
      align-items: center;
      border: none;
      border-top: 1px solid var(--color-border);
      border-radius: 0;
      padding: 6px 10px;
    }
    .sy-row.done {
      border-color: var(--color-border);
    }
    .nm,
    .pbar,
    .st {
      grid-column: auto;
    }
    .st:empty {
      display: block;
    }
    .k {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }
    .pbar {
      padding-right: 12px;
    }
  }
</style>
