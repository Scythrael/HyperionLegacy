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
  .sub-tabs { display: flex; gap: 6px; margin-bottom: 14px; flex-wrap: wrap; }
  /* Lighter/smaller variant of App.svelte's .captain-tab -- same visual
     language (rounded pill, accent-tinted background/border), scaled down
     since this can appear multiple times per screen (unlike the single
     top-level bottom nav). */
  .sub-tab {
    background: rgba(var(--color-accent-rgb), 0.05);
    border: 1px solid rgba(var(--color-accent-rgb), 0.16);
    border-radius: 6px;
    padding: 6px 10px;
    color: var(--color-text-secondary);
    font-size: 11px;
    cursor: pointer;
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
