<script lang="ts">
  import { onMount, afterUpdate } from "svelte";
  import Icon from "./ui/Icon.svelte";

  // badge (0.13.11): an optional short tag after the label, such as the Codes sub-tab's "NEW".
  // crewLock (CP-10, user pick 8 2026-11-02): the words of a crew lock on what the tab edits; the tab stays live and
  // wears a small SVG lock before its label (the panel says the same in its lock line). Not `locked`, which means a
  // tab that is not built yet.
  // viewLock (0.14.0 emoji sweep): the same small SVG lock on a LIVE tab that is view-only for another reason (a
  // captain committed to another prestige branch), its words in the title. It replaced a lock emoji in the label.
  export let tabs: { key: string; label: string; locked?: boolean; badge?: string; crewLock?: string; viewLock?: string }[];
  export let active: string;
  export let onSelect: (key: string) => void;

  // ⚠️ SCROLLABLE STRIP WITH OVERFLOW CARETS (0.13.5, user). The tab row already scrolled
  // (overflow-x + hidden scrollbar → drag / swipe / wheel all work), but a scroll strip with no
  // scrollbar has NO affordance that there is more off-screen. So: keep the gesture scroll, and add
  // a left/right caret that appears ONLY when the strip can scroll that way, and hides itself again
  // at each end. When every tab fits (the common case) there are no carets at all, so nothing is
  // added to the row. Reusable everywhere SubTabs is used, so it also covers future tab growth on
  // desktop, not just the phone.
  let scroller: HTMLDivElement | null = null;
  let canLeft = false;
  let canRight = false;

  function updateCarets(): void {
    if (!scroller) return;
    // 1px slack absorbs sub-pixel rounding so a caret does not flicker at the very ends.
    canLeft = scroller.scrollLeft > 1;
    canRight = scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 1;
  }
  function nudge(dir: -1 | 1): void {
    // Scroll by most of a viewport so a tap moves a meaningful chunk without overshooting the strip.
    scroller?.scrollBy({ left: dir * scroller.clientWidth * 0.8, behavior: "smooth" });
  }

  onMount(() => {
    updateCarets();
    // ResizeObserver catches the strip getting narrower/wider (viewport changes, layout shifts);
    // the scroll listener catches the position moving. afterUpdate (below) catches the tab LIST
    // changing (e.g. switching to a facility with more tabs), which changes scrollWidth.
    const ro = new ResizeObserver(updateCarets);
    if (scroller) ro.observe(scroller);
    return () => ro.disconnect();
  });
  afterUpdate(updateCarets);
</script>

<div class="sub-tabs-wrap">
  {#if canLeft}
    <button type="button" class="sub-tabs-caret" aria-label="Scroll tabs left" on:click={() => nudge(-1)}>
      <span aria-hidden="true">‹</span>
    </button>
  {/if}
  <div class="sub-tabs" bind:this={scroller} on:scroll={updateCarets}>
    {#each tabs as tab}
      <button
        class="sub-tab"
        class:active={active === tab.key}
        class:locked={tab.locked}
        aria-disabled={tab.locked ? true : undefined}
        title={tab.locked ? "Coming soon, not yet available" : tab.crewLock ?? tab.viewLock}
        on:click={() => {
          if (!tab.locked) onSelect(tab.key);
        }}
      >
        {#if tab.locked}<span class="sub-tab-lock"><Icon name="lock" size={11} /></span><span class="sub-tab-sr">Locked: </span>{/if}{#if tab.crewLock}<span class="sub-tab-lock"><Icon name="lock" size={11} /></span><span class="sub-tab-sr">Crew locked: </span>{/if}{#if tab.viewLock && !tab.crewLock}<span class="sub-tab-lock"><Icon name="lock" size={11} /></span><span class="sub-tab-sr">View only: </span>{/if}{tab.label}
        {#if tab.badge}<span class="sub-tab-badge">{tab.badge}</span>{/if}
      </button>
    {/each}
  </div>
  {#if canRight}
    <button type="button" class="sub-tabs-caret" aria-label="Scroll tabs right" on:click={() => nudge(1)}>
      <span aria-hidden="true">›</span>
    </button>
  {/if}
</div>

<style>
  /* The wrap is the flex-shrink:0 header row (was .sub-tabs' job); it holds the optional carets +
     the scroller. margin-bottom moved here so the gap below the strip is unchanged. */
  .sub-tabs-wrap {
    display: flex;
    align-items: stretch;
    gap: 2px;
    margin-bottom: 8px;
    flex-shrink: 0;
    min-width: 0;
  }
  /* flex-wrap changed to nowrap + overflow-x: auto (2026-07-07, mobile pass): on a narrow screen a
     row with several tabs no longer wraps to a second line (which fought with .tab-body's fixed-
     height flex column), it scrolls horizontally like a native mobile segmented-tab strip.
     Scrollbar hidden across engines (still fully scrollable via touch/wheel/drag). flex:1 1 auto +
     min-width:0 lets the strip take the space left by the carets and shrink to scroll rather than
     forcing the row wider. */
  .sub-tabs {
    display: flex;
    gap: 2px;
    flex: 1 1 auto;
    min-width: 0;
    flex-wrap: nowrap;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none; /* Firefox */
    -ms-overflow-style: none; /* old Edge/IE */
  }
  .sub-tabs::-webkit-scrollbar { display: none; } /* Chrome/Safari/most mobile browsers */
  /* The overflow carets. Same squared, accent-tinted chrome as a tab so they read as part of the
     strip, but clearly a control (a chevron, not a label). Only rendered while there is more to
     scroll in that direction. */
  .sub-tabs-caret {
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    width: 22px;
    background: rgba(var(--color-accent-rgb), 0.08);
    border: 1px solid rgba(var(--color-accent-rgb), 0.24);
    border-radius: var(--corner);
    color: var(--color-accent);
    font-size: var(--text-md);
    line-height: 1;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .sub-tabs-caret:hover { background: rgba(var(--color-accent-rgb), 0.16); }
  .sub-tabs-caret:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 1px; }
  /* Lighter/smaller variant of App.svelte's .captain-list-item, same flat, square-cornered "panel"
     look. flex-shrink:0 + white-space:nowrap keep every tab at its natural label width in the
     scrollable row, instead of the row's flex-shrink default squishing labels to illegibility. */
  .sub-tab {
    background: rgba(var(--color-accent-rgb), 0.05);
    border: 1px solid rgba(var(--color-accent-rgb), 0.16);
    padding: 6px 10px;
    color: var(--color-text-secondary);
    font-size: var(--text-xs);
    cursor: pointer;
    flex-shrink: 0;
    white-space: nowrap;
  }
  /* The optional badge (0.13.11): a small accent tag riding after the label. */
  .sub-tab-badge {
    margin-left: 2px;
    padding: 0 4px;
    border-radius: 1px;
    font-family: var(--font-display);
    font-size: var(--text-3xs);
    letter-spacing: 0.1em;
    color: var(--color-bg-deep);
    background: var(--color-accent);
    vertical-align: 1px;
  }
  /* CP-10: the crew lock mark (warning hue, the SVG lock), and its words for screen readers. */
  .sub-tab-lock {
    display: inline-flex;
    vertical-align: -1px;
    margin-right: 4px;
    color: var(--color-warning);
  }
  .sub-tab-sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
  .sub-tab.active {
    background: rgba(var(--color-accent-rgb), 0.14);
    color: var(--color-accent-bright);
    border-color: var(--color-accent);
  }
  /* Locked tabs: grayed + non-clickable. Uses aria-disabled (NOT native `disabled`) + a click guard
     so the tab stays hoverable and the "Coming soon" title tooltip actually appears (a disabled
     control fires no hover events), matching ConsoleTabs' locked-as-div treatment. */
  .sub-tab.locked {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .sub-tab.locked:hover {
    border-color: rgba(var(--color-accent-rgb), 0.3);
  }
</style>
