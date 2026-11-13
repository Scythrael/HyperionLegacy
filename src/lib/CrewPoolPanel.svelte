<script lang="ts">
  // ============================================================================
  // CrewPoolPanel.svelte
  // The CREW POOL tab of the Personnel Rosters facility (0.14.0 CP-10; signed mockup
  // docs/mockups/2026-11-02-cp10-transfer-picker-mockup.html section 3; user picks 2026-11-02: (6) the pool is its own
  // tab beside Rosters, (7) crew are taken from the pool only here, with "Send N to a ship...").
  // The pool was invisible before CP-10 (OC-10 "In Personnel Rosters"). It shows how many crew wait, the headcount per
  // division, the same Crew Groups table as a ship (minus Graduate, which happens aboard a ship), a Manifest, and the
  // transfer picker from the pool to a manual ship (OC-7). The pool has no cap of its own, but crew no berth in the fleet
  // can take move on to the Homeworld reserve (user 2026-11-12; homeworldReserve.ts), shown here as a count with one line.
  // HOMEWORLD RESERVE CONTROLS (user 2026-11-12 evening, docs/mockups/2026-11-12-homeworld-reserve-controls-mockup.html,
  // "A: section under the pool (Recommended)"): the reserve has its own collapsible section under the pool's table
  // (starts closed, remembers open or closed on this device), the same Crew Groups table, and ticked rows show "Send N to
  // a ship..." and "Recall N to the pool...", both opening the same transfer picker with the reserve as the source.
  // PURE PRESENTATION: the numbers are crewTransferDisplay.ts / complementTableDisplay.ts (tested); the move is the
  // host's onTransfer (App.svelte doTransferCrew). ONE DOM: container queries switch the phone layout.
  // ============================================================================
  import "./crewGroups.css";
  import type { CrewProfession, GameState } from "./game/model";
  import { CREW_PROFESSIONS } from "./game/commandStructure";
  import { CREW_POOL, HOMEWORLD_RESERVE, type CrewTransferEndpoint, type CrewTransferPick, type CrewTransferResult } from "./game/crewTransfer";
  import { MANIFEST_POOL_ID } from "./game/crewGraduation";
  import Icon from "./ui/Icon.svelte";
  import CrewGroupsTable from "./CrewGroupsTable.svelte";
  import CrewManifestModal from "./CrewManifestModal.svelte";
  import CrewTransferModal from "./CrewTransferModal.svelte";
  import { crewGroupRows } from "./complementTableDisplay";
  import { divisionStatsOf, fmtCount, poolDivisionStats, poolHeadcount } from "./crewTransferDisplay";
  import { homeworldReserveCount, homeworldReserveOf } from "./game/homeworldReserve";
  import { loadHomeworldReserveOpen, saveHomeworldReserveOpen } from "./homeworldReservePreference";
  import { tick as svelteTick } from "svelte";

  export let state: GameState;
  // Move crew from the pool to a ship (host: doTransferCrew).
  export let onTransfer: (from: CrewTransferEndpoint, to: CrewTransferEndpoint, picks: CrewTransferPick[]) => CrewTransferResult | null;
  // Switch a destination ship to manual crew (host: doSetComplementMode).
  export let onSetMode: (shipId: string, mode: "passive" | "active") => void;

  $: rows = crewGroupRows(state.crewPool);
  $: waiting = poolHeadcount(state);
  $: stats = poolDivisionStats(state, CREW_PROFESSIONS);
  $: reserve = homeworldReserveCount(state);
  $: reserveRows = crewGroupRows(homeworldReserveOf(state));
  $: reserveStats = divisionStatsOf(homeworldReserveOf(state), CREW_PROFESSIONS);

  let selected = new Set<string>();
  let division: CrewProfession | null = null;
  let manifestOpen = false;
  let transferKeys: string[] | null = null;

  function openTransfer(): void {
    const keys = rows.filter((r) => selected.has(r.key)).map((r) => r.key);
    if (keys.length > 0) transferKeys = keys;
  }
  function closeTransfer(moved: boolean): void {
    transferKeys = null;
    if (moved) selected = new Set();
  }

  // The Homeworld reserve section: closed at first, remembered per device.
  let reserveOpen = loadHomeworldReserveOpen();
  let reserveSelected = new Set<string>();
  let reserveDivision: CrewProfession | null = null;
  let reserveTransfer: { keys: string[]; startOn: "ship" | "pool" } | null = null;
  let reserveToggle: HTMLButtonElement | null = null;

  function setReserveOpen(open: boolean): void {
    reserveOpen = open;
    saveHomeworldReserveOpen(open);
  }
  // "Listed below.": open the section and bring it into view, focus on its toggle.
  async function showReserve(): Promise<void> {
    setReserveOpen(true);
    await svelteTick();
    reserveToggle?.scrollIntoView({ block: "nearest" });
    reserveToggle?.focus();
  }
  function openReserveTransfer(startOn: "ship" | "pool"): void {
    const keys = reserveRows.filter((r) => reserveSelected.has(r.key)).map((r) => r.key);
    if (keys.length > 0) reserveTransfer = { keys, startOn };
  }
  function closeReserveTransfer(moved: boolean): void {
    reserveTransfer = null;
    if (moved) reserveSelected = new Set();
  }
</script>

<div class="pool">
  <div class="pool-cap">
    <div class="pool-caprow">
      <span class="pool-bignum">{fmtCount(waiting)}<span class="pool-of"><span class="pool-wide">{` crew waiting · ${rows.length} ${rows.length === 1 ? "group" : "groups"}`}</span><span class="pool-narrow">{" waiting"}</span></span></span>
      <button type="button" class="cg-btn ghost sm" on:click={() => (manifestOpen = true)} disabled={waiting === 0}><Icon name="manifest" size={14} /> Manifest</button>
    </div>
    <div class="pool-note">
      <span class="pool-wide">Transports bring new crew here. Auto-crew ships fill from the pool: their specialty divisions first, then highest rank first, within their caps. Manual ships only take what you send them.</span>
      <span class="pool-narrow">Auto-crew ships fill from here. Manual ships take what you send.</span>
    </div>
    <!-- Homeworld reserve (user 2026-11-12): a count only (homeworldReserve.ts); the surplus no berth can take. -->
    <div class="pool-reserve">
      Homeworld reserve: <span class="pool-reserve-n">{fmtCount(reserve)}</span>
      <span class="pool-wide">· Crew no berth in your fleet can take move on to the Homeworld reserve, keeping their ranks and racials. Auto-crew ships draw from it when the pool cannot fill a berth.</span>
      {#if reserve > 0}
        <button type="button" class="cg-link pool-reserve-link" on:click={showReserve}><span class="pool-wide">Listed below.</span><span class="pool-narrow">· below</span></button>
      {/if}
    </div>
  </div>

  {#if waiting === 0}
    <div class="pool-empty">No crew are waiting. Transports bring new crew here over time, and crew you send back from a ship land here too.</div>
  {:else}
    <!-- The headcount per division: stat tiles on a wide panel, a sideways chip row (also the division filter) on a phone. -->
    <div class="pool-stats" aria-label="Crew waiting per division">
      {#each stats as st (st.profession)}
        <div class="pool-st">
          <div class="pool-st-k">{st.label}</div>
          <div class="pool-st-v">{fmtCount(st.count)}</div>
          <div class="pool-st-bar"><span style="width:{st.barPct}%"></span></div>
        </div>
      {/each}
    </div>
    <div class="cg-chiprow pool-statchips" role="group" aria-label="Filter the pool by division">
      <button type="button" class="cg-chip" class:on={division === null} aria-pressed={division === null} on:click={() => (division = null)}>All {fmtCount(waiting)}</button>
      {#each stats as st (st.profession)}
        <button type="button" class="cg-chip" class:on={division === st.profession} aria-pressed={division === st.profession} on:click={() => (division = st.profession)}>{st.label} <span class="cg-n">{fmtCount(st.count)}</span></button>
      {/each}
    </div>

    <CrewGroupsTable
      {rows}
      bind:selected
      bind:division
      resetKey="pool"
      ariaLabel="Crew groups in the pool"
      rowActions={false}
      footTail={`${fmtCount(waiting)} crew`}
    >
      <svelte:fragment slot="selbar" let:selection>
        <button type="button" class="cg-btn sm pri" title="Send the picked crew to a manual ship" on:click={openTransfer}
          ><Icon name="transfer" size={14} /><span>Send<span class="cg-wide-only">{` ${selection.crew.toLocaleString("en-US")} to a ship`}</span>...</span></button
        >
      </svelte:fragment>
    </CrewGroupsTable>
  {/if}

  <!-- The Homeworld reserve's own section (user 2026-11-12 evening, option A): closed at first; empty, it is one line. -->
  <section class="rsv" aria-labelledby="rsv-title">
    <div class="rsv-hd">
      <h3 class="rsv-t" id="rsv-title"><Icon name="home" size={15} /><span class="pool-wide">Homeworld reserve</span><span class="pool-narrow">Reserve</span></h3>
      <span class="rsv-n">{fmtCount(reserve)} <span>crew{#if reserve > 0}<span class="pool-wide">{` · ${reserveRows.length} ${reserveRows.length === 1 ? "group" : "groups"}`}</span>{/if}</span></span>
      {#if reserve > 0}
        <span class="rsv-spacer"></span>
        <button
          type="button"
          class="cg-btn ghost sm"
          bind:this={reserveToggle}
          aria-expanded={reserveOpen}
          aria-controls={reserveOpen ? "rsv-body" : undefined}
          on:click={() => setReserveOpen(!reserveOpen)}
          ><Icon name={reserveOpen ? "chevronUp" : "chevronDown"} size={14} /><span>{reserveOpen ? "Hide" : "Show"}<span class="pool-wide">{" groups"}</span></span></button
        >
      {/if}
    </div>
    {#if reserve === 0}
      <div class="rsv-note">Empty. Crew no berth in your fleet can take move here from the pool, keeping their ranks and racials.</div>
    {:else if reserveOpen}
      <div class="rsv-note">
        <span class="pool-wide">Crew no berth in your fleet can take, with their ranks and racials. Auto-crew ships draw from here on their own. Send groups to a manual ship, or recall them to the pool for a ship that can seat them.</span>
        <span class="pool-narrow">No berth in your fleet can take these. Auto-crew ships draw from here on their own.</span>
      </div>
      <div class="rsv-bd" id="rsv-body">
        <div class="cg-chiprow pool-statchips" role="group" aria-label="Filter the reserve by division">
          <button type="button" class="cg-chip" class:on={reserveDivision === null} aria-pressed={reserveDivision === null} on:click={() => (reserveDivision = null)}>All {fmtCount(reserve)}</button>
          {#each reserveStats as st (st.profession)}
            <button type="button" class="cg-chip" class:on={reserveDivision === st.profession} aria-pressed={reserveDivision === st.profession} on:click={() => (reserveDivision = st.profession)}>{st.label} <span class="cg-n">{fmtCount(st.count)}</span></button>
          {/each}
        </div>
        <CrewGroupsTable
          rows={reserveRows}
          bind:selected={reserveSelected}
          bind:division={reserveDivision}
          resetKey="reserve"
          ariaLabel="Crew groups in the Homeworld reserve"
          rowActions={false}
          footTail={`${fmtCount(reserve)} crew`}
        >
          <svelte:fragment slot="selbar" let:selection>
            <button type="button" class="cg-btn sm pri" title="Send the picked crew to a manual ship" on:click={() => openReserveTransfer("ship")}
              ><Icon name="transfer" size={14} /><span>Send<span class="cg-wide-only">{` ${selection.crew.toLocaleString("en-US")} to a ship`}</span>...</span></button
            >
            <button type="button" class="cg-btn sm" title="Recall the picked crew to the crew pool, as many as a berth in the fleet can seat" on:click={() => openReserveTransfer("pool")}
              ><Icon name="crewPool" size={14} /><span>Recall<span class="cg-wide-only">{` ${selection.crew.toLocaleString("en-US")} to the pool`}</span>...</span></button
            >
          </svelte:fragment>
        </CrewGroupsTable>
      </div>
    {/if}
  </section>
</div>

{#if reserveTransfer !== null}
  <CrewTransferModal
    {state}
    from={HOMEWORLD_RESERVE}
    keys={reserveTransfer.keys}
    startOn={reserveTransfer.startOn}
    {onTransfer}
    onSetManual={(id) => onSetMode(id, "active")}
    onClose={closeReserveTransfer}
  />
{/if}

{#if transferKeys !== null}
  <CrewTransferModal
    {state}
    from={CREW_POOL}
    keys={transferKeys}
    {onTransfer}
    onSetManual={(id) => onSetMode(id, "active")}
    onClose={closeTransfer}
  />
{/if}

{#if manifestOpen}
  <CrewManifestModal
    {state}
    endpoint={MANIFEST_POOL_ID}
    title="Manifest · Crew pool"
    subLine={`${fmtCount(waiting)} waiting`}
    note="Names are made up when you open this list and are never saved. A crew member keeps the same name while they stay in their group in the pool."
    emptyText="No crew of this division waiting."
    onClose={() => (manifestOpen = false)}
  />
{/if}

<style>
  .pool {
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .pool-cap {
    padding: 11px 12px;
    background: rgba(var(--color-accent-rgb), 0.05);
    border: 1px solid rgba(var(--color-accent-rgb), 0.16);
    border-radius: var(--corner);
  }
  .pool-caprow {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 4px;
  }
  .pool-bignum {
    font-family: var(--font-mono);
    font-size: var(--text-xl);
    color: var(--color-text-primary);
    font-variant-numeric: tabular-nums;
  }
  .pool-of {
    color: var(--color-text-dim);
    font-size: var(--text-sm);
  }
  .pool-note {
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
    font-family: var(--font-mono);
    line-height: 1.5;
  }
  .pool-reserve {
    margin-top: 6px;
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
    font-family: var(--font-mono);
    letter-spacing: 0.04em;
    line-height: 1.5;
  }
  .pool-reserve-n {
    color: var(--color-text-primary);
    font-variant-numeric: tabular-nums;
  }
  .pool-reserve-link {
    padding: 0;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    letter-spacing: 0.04em;
    text-decoration: underline dotted;
  }
  /* The Homeworld reserve section (the signed mockup's .rsv). */
  .rsv {
    border: 1px solid rgba(var(--color-accent-rgb), 0.22);
    border-radius: var(--corner);
    background: rgba(var(--color-accent-rgb), 0.025);
    min-width: 0;
  }
  .rsv-hd {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    padding: 10px 12px;
  }
  .rsv-t {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 10.5px;
    font-weight: 400;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--color-accent-bright);
    display: inline-flex;
    gap: 6px;
    align-items: center;
  }
  .rsv-t :global(svg) {
    color: var(--color-accent);
  }
  .rsv-n {
    font-family: var(--font-mono);
    font-size: var(--text-lg);
    color: var(--color-text-primary);
    font-variant-numeric: tabular-nums;
  }
  .rsv-n > span {
    font-size: var(--text-xs);
    color: var(--color-text-dim);
  }
  .rsv-spacer {
    flex: 1;
  }
  .rsv-note {
    padding: 0 12px 10px;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
    line-height: 1.5;
  }
  .rsv-bd {
    padding: 0 12px 12px;
    display: grid;
    gap: 8px;
    min-width: 0;
  }
  .pool-empty {
    font-size: var(--text-xs);
    color: var(--color-text-dim);
    font-style: italic;
    line-height: 1.5;
    padding: 10px 12px;
    background: rgba(var(--color-accent-rgb), 0.04);
    border: 1px dashed rgba(var(--color-accent-rgb), 0.2);
    border-radius: var(--corner);
  }
  .pool-stats {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 8px;
  }
  .pool-st {
    padding: 8px 10px;
    border: 1px solid rgba(var(--color-accent-rgb), 0.14);
    border-radius: var(--corner);
    background: rgba(var(--color-accent-rgb), 0.04);
    min-width: 0;
  }
  .pool-st-k {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--color-accent);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pool-st-v {
    font-family: var(--font-mono);
    font-size: var(--text-lg);
    color: var(--color-text-primary);
  }
  .pool-st-bar {
    height: 4px;
    background: rgba(255, 255, 255, 0.06);
    margin-top: 5px;
  }
  .pool-st-bar span {
    display: block;
    height: 100%;
    background: linear-gradient(90deg, var(--color-accent), var(--color-accent-bright));
  }
  .pool-statchips,
  .pool-narrow {
    display: none;
  }

  /* Phone-narrow: the division stats become one sideways chip row that also filters (the mockup's phone frame), the
     table's own division chips step aside, and the shorter words show. */
  @container (max-width: 700px) {
    .pool-wide,
    .pool-stats {
      display: none;
    }
    .pool-narrow {
      display: inline;
    }
    .pool-statchips {
      display: flex;
      flex-wrap: nowrap;
      overflow-x: auto;
      padding-bottom: 2px;
    }
    .pool-statchips .cg-n {
      display: inline;
    }
    .pool-bignum {
      font-size: var(--text-lg);
    }
    .pool :global(.cg-divrow) {
      display: none;
    }
  }
</style>
