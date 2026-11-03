<script lang="ts">
  // ============================================================================
  // CrewGroupsTable.svelte
  // The CREW GROUPS table: sort and division chips, one row per bucket with a tick box, every buff as a chip, the
  // selection bar, and "Show more". Drawn by the ship's Complement tab (CP-9, with "Graduate one" on each row and
  // Transfer in the selection bar) and by the crew pool tab in Personnel Rosters (CP-10, no row action, "Send N to a
  // ship..." in the selection bar; signed mockup docs/mockups/2026-11-02-cp10-transfer-picker-mockup.html section 3:
  // "Same table as the ship's Crew Groups, minus Graduate").
  //   - PURE PRESENTATION: every decision (rows, sorts, filter counts, the selection summary) is the tested
  //     complementTableDisplay.ts. The host owns the selection (bind:selected) and the actions (slots).
  //   - ONE DOM: a table on a wide panel, cards and a sticky bottom selection bar under 700 px of container width
  //     (crewGroups.css container queries, keyed off the host panel).
  // ============================================================================
  import "./crewGroups.css";
  import type { CrewProfession } from "./game/model";
  import { CREW_PROFESSIONS } from "./game/commandStructure";
  import Icon from "./ui/Icon.svelte";
  import {
    DIVISION_LABEL,
    GROUP_PAGE_STEP,
    GROUP_SORTS,
    divisionGroupCounts,
    filterCrewGroups,
    headerTickState,
    selectionSummary,
    sortCrewGroups,
    type CrewGroupRow,
    type GroupSort,
  } from "./complementTableDisplay";

  // Every group of the endpoint (the ship's bulk complement, or the crew pool).
  export let rows: CrewGroupRow[];
  // The ticked groups' keys (the host reads them to open Transfer).
  export let selected: Set<string> = new Set();
  // Changing this resets the sort, the filter, the paging and the selection (the host opened another ship).
  export let resetKey: string = "";
  // The division filter (null = all), bindable so the pool's division stats can set it.
  export let division: CrewProfession | null = null;
  // The words after "Showing X of Y groups · " in the foot ("768 crew aboard", "1,284 crew").
  export let footTail: string = "";
  // The table's accessible name.
  export let ariaLabel: string = "Crew groups";
  // Whether rows carry an action column (the ship's "Graduate one").
  export let rowActions: boolean = true;
  // Shown in place of the chips when there are no groups (the tools slot still shows).
  export let emptyText: string = "";

  let sort: GroupSort = "rank";
  let shown = GROUP_PAGE_STEP;
  let seenReset = resetKey;
  $: if (resetKey !== seenReset) {
    seenReset = resetKey;
    sort = "rank";
    division = null;
    shown = GROUP_PAGE_STEP;
    selected = new Set();
  }
  // A division change from any source (these chips, or the pool's phone chips through the binding) resets the paging.
  let seenDivision = division;
  $: if (division !== seenDivision) {
    seenDivision = division;
    shown = GROUP_PAGE_STEP;
  }

  $: divisionCounts = divisionGroupCounts(rows);
  $: viewRows = sortCrewGroups(filterCrewGroups(rows, division), sort);
  $: shownRows = viewRows.slice(0, shown);
  $: selection = selectionSummary(rows, selected);
  $: headerTick = headerTickState(viewRows, selected);

  function setDivision(d: CrewProfession | null): void {
    division = d;
    shown = GROUP_PAGE_STEP;
  }
  function toggleRow(key: string): void {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    selected = next;
  }
  function toggleAllInView(): void {
    const next = new Set(selected);
    if (headerTick === "all") for (const r of viewRows) next.delete(r.key);
    else for (const r of viewRows) next.add(r.key);
    selected = next;
  }
  function clearSelection(): void {
    selected = new Set();
  }
</script>

<div class="cg-tools">
  {#if rows.length > 0}
    <div class="cg-chiprow cg-sortrow" role="group" aria-label="Sort crew groups">
      <span class="cg-lbl"><Icon name="sort" size={13} /> Sort</span>
      {#each GROUP_SORTS as so (so.id)}
        <button type="button" class="cg-chip" class:on={sort === so.id} aria-pressed={sort === so.id} on:click={() => (sort = so.id)}>{so.label}</button>
      {/each}
    </div>
    <div class="cg-chiprow cg-divrow" role="group" aria-label="Filter crew groups by division">
      <span class="cg-lbl">Division</span>
      <button type="button" class="cg-chip" class:on={division === null} aria-pressed={division === null} on:click={() => setDivision(null)}>All <span class="cg-n">{divisionCounts.all}</span></button>
      {#each CREW_PROFESSIONS as p (p)}
        <button type="button" class="cg-chip" class:on={division === p} aria-pressed={division === p} on:click={() => setDivision(p)}>{DIVISION_LABEL[p]} <span class="cg-n">{divisionCounts.byDivision[p]}</span></button>
      {/each}
    </div>
  {:else if emptyText}
    <span class="cg-onlynotables">{emptyText}</span>
  {/if}
  <slot name="tools" />
</div>

{#if rows.length > 0}
  <div class="cg-wrap">
    <div class="cg-table" class:cg-noact={!rowActions} role="table" aria-label={ariaLabel}>
      <div class="cg-row cg-head" role="row">
        <span class="cg-c cg-tick" role="columnheader">
          <button
            type="button"
            role="checkbox"
            class="cg-cb"
            class:on={headerTick === "all"}
            class:mixed={headerTick === "some"}
            aria-checked={headerTick === "all" ? "true" : headerTick === "some" ? "mixed" : "false"}
            aria-label={headerTick === "all" ? "Untick every group shown" : "Tick every group shown"}
            on:click={toggleAllInView}
          >{#if headerTick === "all"}<Icon name="check" size={11} />{:else if headerTick === "some"}<span class="cg-cb-dash" aria-hidden="true"></span>{/if}</button>
        </span>
        <span class="cg-c cg-name" role="columnheader">Group</span>
        <span class="cg-c cg-div" role="columnheader" class:sorted={sort === "division"}>Division</span>
        <span class="cg-c cg-rank" role="columnheader" class:sorted={sort === "rank"}>Rank</span>
        <span class="cg-c cg-rar" role="columnheader" class:sorted={sort === "rarity"}>Rarity</span>
        <span class="cg-c cg-buffs" role="columnheader">Buffs</span>
        <span class="cg-c cg-count" role="columnheader" class:sorted={sort === "count"}>Count</span>
        {#if rowActions}<span class="cg-c cg-act" role="columnheader"><span class="cg-sr">Actions</span></span>{/if}
      </div>
      {#each shownRows as r (r.key)}
        <div class="cg-row" class:sel={selected.has(r.key)} role="row">
          <span class="cg-c cg-tick" role="cell">
            <button
              type="button"
              class="cg-cb"
              class:on={selected.has(r.key)}
              aria-pressed={selected.has(r.key)}
              aria-label={`Select the ${r.name}`}
              on:click={() => toggleRow(r.key)}
            >{#if selected.has(r.key)}<Icon name="check" size={11} />{/if}</button>
          </span>
          <span class="cg-c cg-name" role="cell"><b>{r.name}</b></span>
          <span class="cg-c cg-meta" role="cell">{r.rankLabel} · <span class="cg-rarity" style="color: var(--rarity-{r.rarity})"><i></i>{r.rarityLabel}</span></span>
          <span class="cg-c cg-div" role="cell">{r.divisionLabel}</span>
          <span class="cg-c cg-rank" role="cell">{r.rankLabel}</span>
          <span class="cg-c cg-rar" role="cell"><span class="cg-rarity" style="color: var(--rarity-{r.rarity})"><i></i>{r.rarityLabel}</span></span>
          <span class="cg-c cg-buffs" role="cell">
            {#each r.buffs as c, ci (ci)}
              <span class="cg-bf {c.kind}" title={c.title}>{#if c.kind === "exclusive"}<Icon name="diamond" size={11} />{/if}{c.label}</span>
            {/each}
          </span>
          <span class="cg-c cg-count" role="cell">{r.count.toLocaleString("en-US")}<span class="cg-count-u">crew</span></span>
          {#if rowActions}
            <span class="cg-c cg-act" role="cell"><slot name="act" row={r} isSelected={selected.has(r.key)} /></span>
          {/if}
        </div>
      {/each}
    </div>
    <div class="cg-foot">
      <span>Showing {shownRows.length} of {viewRows.length} groups{footTail ? ` · ${footTail}` : ""}</span>
      {#if viewRows.length > shownRows.length}
        <button type="button" class="cg-link" on:click={() => (shown += GROUP_PAGE_STEP)}>Show {Math.min(GROUP_PAGE_STEP, viewRows.length - shownRows.length)} more</button>
      {/if}
    </div>
    {#if selection.groups > 0}
      <!-- The selection bar: at the top of the table on a wide panel, sticky at the bottom on a phone. -->
      <div class="cg-selbar" role="status">
        <span class="cg-cb on" aria-hidden="true"><Icon name="check" size={11} /></span>
        <span><b>{selection.groups}</b> {selection.groups === 1 ? "group" : "groups"}<span class="cg-wide-only">{" selected"}</span> · <b>{selection.crew.toLocaleString("en-US")}</b> crew</span>
        <slot name="selbar" {selection} />
        <span class="cg-spacer"></span>
        <button type="button" class="cg-btn sm ghost" on:click={clearSelection}>Clear</button>
      </div>
    {/if}
  </div>
{/if}
