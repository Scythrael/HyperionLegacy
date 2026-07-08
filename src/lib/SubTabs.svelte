<script lang="ts">
  export let tabs: { key: string; label: string; locked?: boolean }[];
  export let active: string;
  export let onSelect: (key: string) => void;
</script>

<div class="sub-tabs">
  {#each tabs as tab}
    <button
      class="sub-tab"
      class:active={active === tab.key}
      class:locked={tab.locked}
      disabled={tab.locked}
      title={tab.locked ? "Coming soon — not yet available" : undefined}
      on:click={() => {
        if (!tab.locked) onSelect(tab.key);
      }}
    >
      {#if tab.locked}🔒 {/if}{tab.label}
    </button>
  {/each}
</div>

<style>
  /* flex-wrap changed to nowrap + overflow-x: auto (2026-07-07, mobile pass)
     -- on a narrow screen a row with several tabs plus 2 locked "Coming
     Soon!" slots no longer wraps to a second line (which fought with
     .tab-body's fixed-height flex column), it scrolls horizontally instead,
     like a native mobile segmented-tab strip. Scrollbar hidden across
     engines (still fully scrollable via touch/wheel/drag, just no visible
     track) to match the same treatment given to .tab-scroll-area. */
  .sub-tabs {
    display: flex;
    gap: 2px;
    margin-bottom: 14px;
    flex-wrap: nowrap;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none; /* Firefox */
    -ms-overflow-style: none; /* old Edge/IE */
  }
  .sub-tabs::-webkit-scrollbar { display: none; } /* Chrome/Safari/most mobile browsers */
  /* Lighter/smaller variant of App.svelte's .captain-list-item -- same flat,
     square-cornered "panel" look (2026-07-07 button-style pass), scaled down
     since this can appear multiple times per screen (unlike the single
     top-level bottom nav). The thin 2px gap above reveals the background
     behind, reading as a segmented banner rather than one solid strip.
     flex-shrink:0 + white-space:nowrap keep every tab at its natural label
     width in the now-scrollable row above, instead of the row's flex-shrink
     default squishing labels down to illegibility before it ever scrolls. */
  .sub-tab {
    background: rgba(var(--color-accent-rgb), 0.05);
    border: 1px solid rgba(var(--color-accent-rgb), 0.16);
    padding: 6px 10px;
    color: var(--color-text-secondary);
    font-size: 11px;
    cursor: pointer;
    flex-shrink: 0;
    white-space: nowrap;
  }
  .sub-tab.active {
    background: rgba(var(--color-accent-rgb), 0.14);
    color: var(--color-accent-bright);
    border-color: var(--color-accent);
  }
  /* Locked tabs: grayed (same opacity:0.5 convention App.svelte's own
     .skill-node.locked/.module-card.locked already use), non-clickable
     (native `disabled` on the <button> -- the `if (!tab.locked)` guard in
     the click handler above is redundant belt-and-suspenders, since a
     disabled button never fires click at all, kept for clarity/defense in
     depth). Still hoverable -- disabled buttons keep responding to :hover
     and `title` tooltips in every real browser, so the subtle border
     brighten below acknowledges the hover without implying it's clickable. */
  .sub-tab.locked {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .sub-tab.locked:hover {
    border-color: rgba(var(--color-accent-rgb), 0.3);
  }
</style>
