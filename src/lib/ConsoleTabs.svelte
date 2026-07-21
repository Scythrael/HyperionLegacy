<script lang="ts">
  // ConsoleTabs, the 0.12.0 "Console" nav primitive (user-refined 2026-07-21).
  //
  // A horizontally SCROLLING top-tab row that every perspective (Home / Personnel /
  // Facilities / Logistics / Operations) reuses. The selected tab GLOWS to mark
  // where you are; the selected tab's page renders (by the parent) IN PLACE below
  // this row. The row is STICKY so page content never scrolls up over it, its
  // scrollbar is HIDDEN, and when there is more to scroll it shows a small
  // button-shaped "slice" on that edge (a chevron) that also scrolls when tapped.
  // Those slices only appear when the row actually overflows, so on desktop (where
  // the tabs fit) they never show.
  //
  // Props: `tabs` (each { key, label, locked? }), `active` (the selected key), and
  // `onSelect` (called with a tab's key when tapped; locked tabs never call it).
  import { onMount } from "svelte";

  export let tabs: { key: string; label: string; locked?: boolean }[] = [];
  export let active: string;
  export let onSelect: (key: string) => void;

  // The scroll viewport element + whether each edge can scroll further. Both flags
  // drive the edge slices; recomputed on scroll, on resize, and when `tabs` change.
  let scroller: HTMLDivElement;
  let canLeft = false;
  let canRight = false;

  function updateEdges(): void {
    if (!scroller) return;
    // A 1px slack absorbs sub-pixel rounding so a fully-scrolled row does not
    // flicker a phantom slice.
    canLeft = scroller.scrollLeft > 1;
    canRight = scroller.scrollLeft < scroller.scrollWidth - scroller.clientWidth - 1;
  }

  // Tap a slice to scroll roughly one viewport-worth toward that edge.
  function nudge(direction: number): void {
    if (!scroller) return;
    scroller.scrollBy({ left: direction * scroller.clientWidth * 0.7, behavior: "smooth" });
  }

  onMount(() => {
    updateEdges();
    // ResizeObserver catches width changes (rotation, desktop resize) so the
    // slices appear/disappear as overflow starts/stops without a scroll event.
    const ro = new ResizeObserver(() => updateEdges());
    ro.observe(scroller);
    return () => ro.disconnect();
  });

  // Recheck after the tab set changes (a perspective may reveal/hide tabs), on the
  // next frame so the DOM has laid out the new widths first.
  $: if (tabs && typeof requestAnimationFrame !== "undefined") requestAnimationFrame(updateEdges);
</script>

<div class="ctabs-wrap">
  {#if canLeft}
    <button class="ctabs-slice left" on:click={() => nudge(-1)} aria-label="Scroll tabs left">&lsaquo;</button>
  {/if}

  <div class="ctabs" bind:this={scroller} on:scroll={updateEdges}>
    {#each tabs as t (t.key)}
      {#if t.locked}
        <div class="ctab locked" title="Coming soon, not yet available">🔒 {t.label}</div>
      {:else}
        <button class="ctab" class:active={active === t.key} on:click={() => onSelect(t.key)}>{t.label}</button>
      {/if}
    {/each}
  </div>

  {#if canRight}
    <button class="ctabs-slice right" on:click={() => nudge(1)} aria-label="Scroll tabs right">&rsaquo;</button>
  {/if}
</div>

<style>
  /* Sticky so the row stays pinned while the page below scrolls (fixes the page
     covering the tabs). Opaque background because Brave disables backdrop-filter,
     scrolled content must not show through. position: sticky also establishes the
     containing block the absolutely-positioned edge slices anchor to. */
  .ctabs-wrap {
    position: sticky;
    top: 0;
    z-index: 2;
    background: var(--color-bg);
    padding-bottom: 12px;
    margin-bottom: 4px;
  }
  /* The scroll viewport. Scrollbar hidden across engines; the edge slices are the
     scroll affordance instead. */
  .ctabs {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    scrollbar-width: none;
    -ms-overflow-style: none;
  }
  .ctabs::-webkit-scrollbar { display: none; }

  .ctab {
    flex: 0 0 auto;
    background: rgba(var(--color-accent-rgb), 0.06);
    border: 1px solid rgba(var(--color-accent-rgb), 0.2);
    border-radius: 8px;
    padding: 9px 16px;
    color: var(--color-text-secondary);
    font-size: 13px;
    letter-spacing: 0.04em;
    white-space: nowrap;
    cursor: pointer;
  }
  .ctab:hover:not(.locked):not(.active) {
    background: rgba(var(--color-accent-rgb), 0.15);
    color: var(--color-accent-bright);
    border-color: var(--color-accent);
  }
  /* The selected tab GLOWS (user 2026-07-21): accent border + text plus a soft
     accent halo, all from the theme accent token so it tracks the active theme. */
  .ctab.active {
    color: var(--color-accent-bright);
    border-color: var(--color-accent);
    background: rgba(var(--color-accent-rgb), 0.15);
    box-shadow: 0 0 10px rgba(var(--color-accent-rgb), 0.45), inset 0 0 7px rgba(var(--color-accent-rgb), 0.12);
  }
  /* Reserved meta tabs, inert (same honest "coming soon" role as the System /
     Battlespace locked slots). */
  .ctab.locked {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Edge slice: a narrow button-shaped sliver over the scrollable edge, shown only
     when that edge can scroll (so it never appears on desktop where the row fits).
     The gradient fades the tabs behind it so it reads as "there is more this way",
     the chevron says which way, and tapping it scrolls. */
  .ctabs-slice {
    position: absolute;
    top: 0;
    bottom: 12px;
    width: 34px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    color: var(--color-accent-bright);
    font-size: 18px;
    cursor: pointer;
    z-index: 1;
  }
  .ctabs-slice.left {
    left: 0;
    justify-content: flex-start;
    padding-left: 3px;
    background: linear-gradient(90deg, var(--color-bg) 45%, transparent);
  }
  .ctabs-slice.right {
    right: 0;
    justify-content: flex-end;
    padding-right: 3px;
    background: linear-gradient(270deg, var(--color-bg) 45%, transparent);
  }
</style>
