<script lang="ts">
  // ============================================================================
  // RefugeesPanel.svelte
  // E5 Refugee Posts, slice E5-6 (plan docs/plans/2026-11-02-refugee-posts-e5-plan.md; the signed mockup
  // docs/mockups/2026-11-02-e5-refugee-posts-mockup.html section 3, calls 8 A, 9 A and 10 A as drawn).
  //
  // The Personnel "Refugees" tab: everyone at home. The header counts, the calm line (the slowing-arrivals clause in
  // words only, never a chance), the Show filter and the Sort, then one row per person with their best post.
  // "Post..." / "Move..." opens the facility chooser (the shared RefugeePostPicker in person mode: every facility
  // sorted by what this person would give there, a full facility offering a swap). PURE PRESENTATION over
  // refugeesTabView (refugeeDisplay.ts); the one action bubbles up to App.svelte (onPost).
  // ONE DOM: the rows are a table-like grid on a wide container and stacked cards below 640px (a container query).
  // ============================================================================

  import type { GameState } from "./game/model";
  import type { RefugeeFacilityKey } from "./game/refugees";
  import Icon from "./ui/Icon.svelte";
  import RefugeePortrait from "./ui/RefugeePortrait.svelte";
  import RefugeePostPicker from "./RefugeePostPicker.svelte";
  import { REFUGEE_BACKGROUND_ICONS, REFUGEE_ECHO_MARK_LABEL, refugeesTabView, type RefugeesTabFilter, type RefugeesTabSort } from "./refugeeDisplay";

  export let state: GameState;
  export let onPost: (refugeeId: number, facility: RefugeeFacilityKey, replaceId?: number) => void;
  // E5-7: opens the Help center on the Refugees topic (App.svelte openHelpTopic); without a host handler no link is drawn.
  export let onOpenHelp: ((topicId: string) => void) | undefined = undefined;

  let filter: RefugeesTabFilter = "waiting";
  let sort: RefugeesTabSort = "skill";
  let pickerFor: number | null = null;

  $: view = refugeesTabView(state, filter, sort);

  const SORTS: { key: RefugeesTabSort; label: string }[] = [
    { key: "skill", label: "Skill" },
    { key: "background", label: "Background" },
    { key: "arrived", label: "Arrived" },
  ];
</script>

<div class="rfp">
  <div class="rfp-stats">
    <div class="rfp-st"><div class="rfp-k">Waiting</div><div class="rfp-v">{view.waiting}</div></div>
    <div class="rfp-st"><div class="rfp-k">Posted</div><div class="rfp-v">{view.posted}</div></div>
    <div class="rfp-st"><div class="rfp-k">Open posts</div><div class="rfp-v">{view.openPosts} <small>of {view.totalPosts}</small></div></div>
  </div>

  <div class="rfp-calm"><Icon name="refugeeArrival" size={18} /><span><span class="rfp-long">{view.calm}</span><span class="rfp-short">{view.calmShort}</span></span></div>

  <div class="rfp-tools">
    <div class="rfp-group" role="group" aria-label="Show">
      <span class="rfp-lbl">Show</span>
      <button type="button" class="rfp-chip" class:on={filter === "waiting"} aria-pressed={filter === "waiting"} on:click={() => (filter = "waiting")}>Waiting {view.waiting}</button>
      <button type="button" class="rfp-chip" class:on={filter === "posted"} aria-pressed={filter === "posted"} on:click={() => (filter = "posted")}>Posted {view.posted}</button>
      <button type="button" class="rfp-chip" class:on={filter === "everyone"} aria-pressed={filter === "everyone"} on:click={() => (filter = "everyone")}>Everyone {view.everyone}</button>
    </div>
    <div class="rfp-group" role="group" aria-label="Sort">
      <span class="rfp-lbl">Sort</span>
      {#each SORTS as s (s.key)}
        <button type="button" class="rfp-chip" class:on={sort === s.key} aria-pressed={sort === s.key} on:click={() => (sort = s.key)}>{#if sort === s.key}<Icon name="sort" size={12} />{/if}{s.label}</button>
      {/each}
    </div>
  </div>

  {#if view.emptyText !== null}
    <p class="rfp-empty">{view.emptyText}</p>
  {:else}
    <div class="rfp-table" role="table" aria-label="Refugees">
      <div class="rfp-row rfp-headrow" role="row">
        <span role="columnheader">Refugee</span>
        <span role="columnheader">Background</span>
        <span role="columnheader" class="rfp-num" class:sorted={sort === "skill"}>Skill</span>
        <span role="columnheader">Origin</span>
        <span role="columnheader">{filter === "posted" ? "Post" : "Best post"}</span>
        <span role="columnheader"><span class="rfp-sr">Action</span></span>
      </div>
      {#each view.rows as r (r.id)}
        <div class="rfp-row" class:echo={r.echo} role="row">
          <span class="rfp-who" role="cell"><RefugeePortrait hair={r.portrait.hair} palette={r.portrait.palette} size={28} /><span class="rfp-nm"><b>{r.name}</b>{#if r.echo}<span class="rfp-echo"><Icon name="refugeeEcho" size={13} title={REFUGEE_ECHO_MARK_LABEL} /></span>{/if}</span></span>
          <span class="rfp-bg" role="cell"><Icon name={REFUGEE_BACKGROUND_ICONS[r.background]} size={13} />{r.backgroundLabel}</span>
          <span class="rfp-num rfp-skill" role="cell"><span class="rfp-short">skill&nbsp;</span>{r.skill}</span>
          <span class="rfp-origin" role="cell">{r.originText}<span class="rfp-short">&nbsp;· <span class:ok={r.bestGood}>{r.bestShort}</span></span></span>
          <span class="rfp-best" role="cell">{#if r.bestLabel}<span class="rfp-bestlbl">{r.bestLabel}</span>{/if}<span class:ok={r.bestGood} class:dim={!r.bestGood}>{r.bestText}</span></span>
          <span class="rfp-act" role="cell">
            <button type="button" class="rfp-btn" class:pri={r.primary} aria-label="{r.actionLabel.replace('...', '')} {r.name}" on:click={() => (pickerFor = r.id)}>{r.actionLabel}</button>
          </span>
          {#if r.flavor}<span class="rfp-flavor" role="cell">{r.flavor}</span>{/if}
        </div>
      {/each}
    </div>
    <p class="rfp-note">"Post..." opens a facility chooser: every facility with a post, sorted by what this person would give there. A full facility can still be picked, to swap with someone already posted. Moving is free, any time.</p>
  {/if}
  {#if onOpenHelp}<button type="button" class="rfp-help" on:click={() => onOpenHelp?.("refugees")}>How refugees work <Icon name="chevronRight" size={14} /></button>{/if}
</div>

{#if pickerFor !== null}
  <RefugeePostPicker {state} mode={{ kind: "person", refugeeId: pickerFor }} {onPost} onClose={() => (pickerFor = null)} />
{/if}

<style>
  .rfp { display: grid; gap: 12px; container-type: inline-size; min-width: 0; font-size: var(--text-sm); color: var(--color-text-secondary); }
  .rfp-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
  .rfp-st { border: 1px solid rgba(var(--color-accent-rgb), 0.2); border-radius: var(--corner); background: rgba(var(--color-accent-rgb), 0.04); padding: 8px 12px; min-width: 0; }
  .rfp-k { font-family: var(--font-mono); font-size: var(--text-2xs); letter-spacing: 0.1em; text-transform: uppercase; color: var(--color-text-dim); }
  .rfp-v { font-family: var(--font-mono); font-size: var(--text-xl); color: var(--color-text-primary); }
  .rfp-v small { font-size: var(--text-xs); color: var(--color-text-dim); }
  .rfp-calm { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border: 1px solid rgba(52, 211, 153, 0.3); border-radius: var(--corner); background: rgba(52, 211, 153, 0.05); color: var(--color-text-secondary); }
  .rfp-calm :global(svg) { color: var(--color-success); flex: 0 0 auto; margin-top: 1px; }
  .rfp-help { justify-self: start; font: inherit; font-size: var(--text-sm); display: inline-flex; gap: 4px; align-items: center; min-height: 32px; padding: 4px 10px; color: var(--color-accent); background: transparent; border: 1px solid var(--color-border); border-radius: var(--corner); cursor: pointer; }
  .rfp-help:hover { border-color: var(--color-accent-bright); }
  .rfp-help:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
  .rfp-tools { display: flex; flex-wrap: wrap; gap: 8px 18px; align-items: center; justify-content: space-between; }
  .rfp-group { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .rfp-lbl { font-family: var(--font-mono); font-size: var(--text-2xs); letter-spacing: 0.1em; text-transform: uppercase; color: var(--color-text-dim); }
  .rfp-chip { font: inherit; font-family: var(--font-mono); font-size: var(--text-xs); padding: 4px 9px; min-height: 32px; border: 1px solid var(--color-border); border-radius: var(--corner); background: transparent; color: var(--color-text-secondary); cursor: pointer; display: inline-flex; gap: 5px; align-items: center; }
  .rfp-chip.on { color: var(--color-text-primary); border-color: var(--color-accent-bright); background: rgba(var(--color-accent-rgb), 0.14); }
  .rfp-chip:hover, .rfp-btn:hover { border-color: var(--color-accent-bright); }
  .rfp-chip:focus-visible, .rfp-btn:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
  .rfp-table { border: 1px solid rgba(var(--color-accent-rgb), 0.16); border-radius: var(--corner); background: rgba(var(--color-accent-rgb), 0.03); min-width: 0; }
  .rfp-row { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 0.9fr) 52px minmax(0, 1.2fr) minmax(0, 1.5fr) auto; gap: 4px 12px; align-items: center; padding: 7px 12px; border-bottom: 1px solid rgba(var(--color-accent-rgb), 0.08); }
  .rfp-row:last-child { border-bottom: 0; }
  .rfp-headrow { font-family: var(--font-mono); font-size: var(--text-2xs); letter-spacing: 0.1em; text-transform: uppercase; color: var(--color-text-dim); padding-top: 6px; padding-bottom: 6px; }
  .rfp-headrow .sorted { color: var(--color-accent-bright); }
  .rfp-who { display: flex; gap: 8px; align-items: center; min-width: 0; color: var(--color-text-primary); }
  /* The name ellipsizes on its own; an echo's mark sits outside it, so a long name never clips the mark. */
  .rfp-nm { display: flex; align-items: center; gap: 5px; min-width: 0; }
  .rfp-who b { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  /* E5-6b: an echo's shared mark beside their name, and their own flavor line across the row under it. */
  .rfp-echo { display: inline-flex; flex: none; color: var(--color-accent-bright); }
  .rfp-flavor { grid-column: 1 / -1; padding-left: 36px; font-size: var(--text-xs); font-style: italic; color: var(--color-text-secondary); overflow-wrap: anywhere; }
  .rfp-bg { display: inline-flex; gap: 4px; align-items: center; white-space: nowrap; min-width: 0; }
  .rfp-bg :global(svg) { color: var(--color-accent); }
  .rfp-num { text-align: right; }
  .rfp-skill { font-family: var(--font-mono); color: var(--color-text-primary); }
  .rfp-origin { font-family: var(--font-mono); font-size: var(--text-2xs); color: var(--color-text-dim); min-width: 0; }
  .rfp-best { font-size: var(--text-xs); color: var(--color-text-primary); min-width: 0; }
  .rfp-bestlbl { margin-right: 6px; }
  .rfp-best .ok { color: var(--color-success); font-family: var(--font-mono); }
  .rfp-best .dim { color: var(--color-text-dim); font-family: var(--font-mono); }
  .rfp-btn { font: inherit; font-size: var(--text-sm); color: var(--color-accent); background: rgba(var(--color-accent-rgb), 0.06); border: 1px solid var(--color-border-strong); border-radius: var(--corner); padding: 3px 10px; min-height: 32px; cursor: pointer; white-space: nowrap; }
  .rfp-btn.pri { background: rgba(var(--color-accent-rgb), 0.18); color: var(--color-text-primary); }
  .rfp-empty { margin: 0; padding: 10px 12px; color: var(--color-text-dim); border: 1px dashed var(--color-border); border-radius: var(--corner); }
  .rfp-note { margin: 0; font-size: var(--text-xs); color: var(--color-text-dim); }
  .rfp-short { display: none; }
  .rfp-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

  /* The phone layout (mockup section 3 phone frame): one card per person, the name and Post... on the first line, the
     trade and skill under it, then origin and best post on one dim line. */
  @container (max-width: 640px) {
    .rfp-long { display: none; }
    .rfp-short { display: inline; }
    .rfp-headrow { display: none; }
    .rfp-stats { display: none; }
    .rfp-row { grid-template-columns: 30px auto auto minmax(0, 1fr) auto; grid-template-areas: "pt nm nm nm act" "pt bg sk . act" "pt or or or or"; gap: 2px 8px; padding: 8px 10px; }
    .rfp-who { display: contents; }
    .rfp-who > :global(svg) { grid-area: pt; align-self: start; }
    .rfp-nm { grid-area: nm; }
    .rfp-bg { grid-area: bg; font-size: var(--text-xs); }
    .rfp-skill { grid-area: sk; text-align: left; font-size: var(--text-xs); }
    .rfp-skill .rfp-short { color: var(--color-text-dim); }
    .rfp-origin { grid-area: or; }
    .rfp-origin .ok { color: var(--color-success); }
    .rfp-best { display: none; }
    .rfp-act { grid-area: act; }
    .rfp-row.echo { grid-template-areas: "pt nm nm nm act" "pt bg sk . act" "pt or or or or" "pt fl fl fl fl"; }
    .rfp-flavor { grid-area: fl; padding-left: 0; }
  }
</style>
