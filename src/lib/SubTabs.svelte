<script lang="ts">
  export let tabs: { key: string; label: string }[];
  export let active: string;
  export let onSelect: (key: string) => void;
</script>

<div class="sub-tabs">
  {#each tabs as tab}
    <button class="sub-tab" class:active={active === tab.key} on:click={() => onSelect(tab.key)}>
      {tab.label}
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
</style>
