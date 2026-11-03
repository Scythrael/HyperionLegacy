<script lang="ts">
  // ============================================================================
  // CrewManifestModal.svelte
  // The read-only, paged MANIFEST (CP-9, signed mockup docs/mockups/2026-11-02-cp9-complement-manifest-mockup.html
  // section 4): a ship's notables first (their saved names), then one row per crew member with a generated name, a
  // division filter and a pager. Names are generated for the page in view only (complementTableDisplay.ts
  // manifestView) and never saved. Shared since CP-10 by the ship's Complement tab and the crew pool tab ("The pool
  // has a Manifest too, built the way section 4 of the CP-9 mockup settles", CP-10 mockup section 3).
  // ============================================================================
  import "./crewGroups.css";
  import type { CrewProfession, GameState } from "./game/model";
  import { CREW_PROFESSIONS } from "./game/commandStructure";
  import ActionModal from "./ActionModal.svelte";
  import Icon from "./ui/Icon.svelte";
  import { DIVISION_LABEL, manifestView, pagerItems } from "./complementTableDisplay";

  export let state: GameState;
  // A ship id, or "pool" (crewGraduation.ts MANIFEST_POOL_ID) for the crew pool.
  export let endpoint: string;
  export let title: string;
  export let subLine: string;
  export let note: string;
  export let emptyText: string;
  export let onClose: () => void;

  let manifestPage = 0;
  let manifestDivision: CrewProfession | null = null;
  $: manifest = manifestView(state, endpoint, manifestPage, manifestDivision);
  $: pager = pagerItems(manifest.page, manifest.pageCount);
  let mfList: HTMLDivElement | null = null;
  function setManifestDivision(d: CrewProfession | null): void {
    manifestDivision = d;
    goManifestPage(0);
  }
  // Turn the page and start it at its top row.
  function goManifestPage(p: number): void {
    manifestPage = p;
    if (mfList) mfList.scrollTop = 0;
  }
</script>

<ActionModal {title} wide {onClose}>
  <div class="mf">
    <div class="mf-sub">{subLine}</div>
    <div class="cg-chiprow mf-chips" role="group" aria-label="Filter the manifest by division">
      <span class="cg-lbl">Division</span>
      <button type="button" class="cg-chip" class:on={manifestDivision === null} aria-pressed={manifestDivision === null} on:click={() => setManifestDivision(null)}>All</button>
      {#each CREW_PROFESSIONS as p (p)}
        <button type="button" class="cg-chip" class:on={manifestDivision === p} aria-pressed={manifestDivision === p} on:click={() => setManifestDivision(p)}>{DIVISION_LABEL[p]}</button>
      {/each}
    </div>
    <div class="mf-list" bind:this={mfList} role="table" aria-label="Crew manifest">
      <div class="mf-row mf-h" role="row">
        <span role="columnheader">#</span><span role="columnheader">Name</span><span role="columnheader">Rank</span><span role="columnheader">Division</span><span role="columnheader">Origin</span><span role="columnheader">Rarity</span><span role="columnheader">Buffs (shared by the group)</span>
      </div>
      {#if manifest.notables.length > 0}
        <div class="mf-grp" role="row"><span>Notable crew · saved names</span><span>{manifest.notables.length}</span></div>
        {#each manifest.notables as n (n.id)}
          <div class="mf-row mf-not" role="row">
            <span class="mf-i"><Icon name="star" size={12} title="Notable" /></span>
            <span class="mf-n"><b>{n.name}</b></span>
            <span class="mf-rank">{n.rankLabel}</span>
            <span class="mf-div">{n.divisionLabel}</span>
            <span class="mf-org">{n.originLabel}</span>
            <span class="mf-rar"><span class="cg-rarity" style="color: var(--rarity-{n.rarity})"><i></i>{n.rarityLabel}</span></span>
            <span class="mf-s">{n.divisionLabel} · {n.originLabel} · {n.rarityLabel}</span>
            <span class="mf-buffs cg-buffchips">
              {#each n.buffs as c, ci (ci)}<span class="cg-bf {c.kind}" title={c.title}>{#if c.kind === "exclusive"}<Icon name="diamond" size={11} />{/if}{c.label}</span>{/each}
            </span>
          </div>
        {/each}
      {/if}
      {#each manifest.lines as l, li (li)}
        {#if l.kind === "group"}
          <div class="mf-grp" role="row"><span>{l.title} · {l.rankLabel}</span><span>{l.count}</span></div>
        {:else}
          <div class="mf-row" role="row">
            <span class="mf-i">{l.number}</span>
            <span class="mf-n">{l.name}</span>
            <span class="mf-rank">{l.rankLabel}</span>
            <span class="mf-div">{l.divisionLabel}</span>
            <span class="mf-org">{l.originLabel}</span>
            <span class="mf-rar"><span class="cg-rarity" style="color: var(--rarity-{l.rarity})"><i></i>{l.rarityLabel}</span></span>
            <span class="mf-s">{l.buffs.map((c) => c.label).join(" · ")}</span>
            <span class="mf-buffs cg-buffchips">
              {#each l.buffs as c, ci (ci)}<span class="cg-bf {c.kind}" title={c.title}>{#if c.kind === "exclusive"}<Icon name="diamond" size={11} />{/if}{c.label}</span>{/each}
            </span>
          </div>
        {/if}
      {/each}
      {#if manifest.total === 0 && manifest.notables.length === 0}
        <div class="mf-empty">{emptyText}</div>
      {/if}
    </div>
    <div class="mf-foot">
      <span>{#if manifest.total > 0}Rows {manifest.from} to {manifest.to} of {manifest.total} crew{:else}No rows{/if}{manifest.notableTotal > 0 ? " · notables listed first" : ""}</span>
      {#if manifest.pageCount > 1}
        <span class="mf-pager">
          <button type="button" class="mf-pg" disabled={manifest.page === 0} aria-label="Previous page" on:click={() => goManifestPage(manifest.page - 1)}><Icon name="chevronLeft" size={14} /></button>
          {#each pager as it, pi (pi)}
            {#if it === "gap"}
              <span class="mf-pg mf-gap mf-wide-only">...</span>
            {:else}
              <button type="button" class="mf-pg mf-wide-only" class:on={it === manifest.page} aria-current={it === manifest.page ? "page" : undefined} on:click={() => goManifestPage(it)}>{it + 1}</button>
            {/if}
          {/each}
          <span class="mf-pg mf-narrow-only">{manifest.page + 1} / {manifest.pageCount}</span>
          <button type="button" class="mf-pg" disabled={manifest.page >= manifest.pageCount - 1} aria-label="Next page" on:click={() => goManifestPage(manifest.page + 1)}><Icon name="chevronRight" size={14} /></button>
        </span>
      {/if}
    </div>
    <p class="mf-note">{note}</p>
  </div>
</ActionModal>

<style>
  /* CP-9: THE MANIFEST (one paged list; compact rows on a phone) */
  .mf {
    display: grid;
    gap: 8px;
  }
  .mf-sub {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
  }
  /* The list scrolls inside itself so the pager under it stays in view (the mockup's list box and footer). */
  .mf-list {
    border: 1px solid rgba(var(--color-accent-rgb), 0.16);
    border-radius: var(--corner);
    background: rgba(var(--color-accent-rgb), 0.03);
    max-height: min(58vh, 560px);
    overflow-y: auto;
  }
  .mf-row {
    display: grid;
    grid-template-columns: 40px minmax(140px, 1.3fr) 150px 92px 96px 90px minmax(0, 2fr);
    gap: 8px;
    align-items: center;
    padding: 6px 10px;
    border-bottom: 1px solid rgba(var(--color-accent-rgb), 0.07);
    font-size: var(--text-xs);
  }
  .mf-row > span {
    min-width: 0;
  }
  .mf-h {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--color-accent-bright);
    border-bottom: 1px solid var(--color-border);
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--color-bg-mid);
  }
  .mf-grp {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 10px;
    background: rgba(var(--color-accent-rgb), 0.05);
    border-bottom: 1px solid rgba(var(--color-accent-rgb), 0.07);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--color-text-secondary);
  }
  .mf-not {
    background: rgba(var(--color-warning-rgb, 251, 191, 36), 0.05);
  }
  .mf-not .mf-i {
    color: var(--color-warning);
  }
  .mf-not .mf-i :global(svg) {
    fill: currentColor;
  }
  .mf-not b {
    font-weight: 600;
  }
  .mf-i {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
  }
  .mf-s {
    display: none;
  }
  .mf-empty {
    padding: 10px;
    font-size: var(--text-xs);
    color: var(--color-text-dim);
    font-style: italic;
    line-height: 1.5;
  }
  .mf-foot {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
  }
  .mf-pager {
    display: inline-flex;
    gap: 4px;
    align-items: center;
    flex-wrap: wrap;
  }
  .mf-pg {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    min-width: 30px;
    height: 30px;
    padding: 0 6px;
    display: inline-grid;
    place-items: center;
    border: 1px solid var(--color-border);
    border-radius: var(--corner);
    background: transparent;
    color: var(--color-text-secondary);
    cursor: pointer;
  }
  .mf-pg.on {
    border-color: var(--color-accent-bright);
    color: var(--color-text-primary);
    background: rgba(var(--color-accent-rgb), 0.14);
  }
  .mf-pg:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .mf-gap {
    border-color: transparent;
    cursor: default;
  }
  .mf-narrow-only {
    display: none;
  }
  .mf-note {
    margin: 0;
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
  }
  /* The manifest's dialog is its own container (ActionModal .am-dialog): a phone gets compact two-line rows. */
  @container (max-width: 700px) {
    .mf-chips {
      display: flex;
      flex-wrap: nowrap;
      overflow-x: auto;
      padding-bottom: 2px;
    }
    .mf-chips .cg-lbl {
      display: none;
    }
    .mf-h {
      display: none;
    }
    .mf-row {
      grid-template-columns: 34px minmax(0, 1fr) auto;
      gap: 2px 8px;
      padding: 7px 10px;
    }
    .mf-n { font-size: var(--text-sm); }
    .mf-rank,
    .mf-div,
    .mf-org,
    .mf-buffs {
      display: none;
    }
    .mf-s {
      display: block;
      grid-column: 2 / 4;
      font-size: var(--text-2xs);
      color: var(--color-text-secondary);
    }
    .mf-not .mf-rar,
    .mf-wide-only {
      display: none;
    }
    .mf-narrow-only {
      display: inline-grid;
    }
  }
</style>
