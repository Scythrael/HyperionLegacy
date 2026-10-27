<script lang="ts">
  // Safe first runs SF-6: the ONE "Training run" chip (the approved text, trainingRunDisplay.ts), with its optional line
  // beside it. Used by the expedition dispatch card (chip only, the line as its title), the run view, the patrol
  // dispatch card and its popup (chip and line). The glyph is the shared `check` SVG (icons.ts).
  import Icon from "./ui/Icon.svelte";
  import { TRAINING_RUN_CHIP } from "./trainingRunDisplay";

  // The line shown beside the chip (none: the chip alone).
  export let line: string | null = null;
  // The chip's hover / tap title (the chip-only placement carries its line here).
  export let title: string | null = null;
</script>

{#if line}
  <span class="train-line"><span class="train-chip" title={title ?? undefined}><Icon name="check" size={11} /> {TRAINING_RUN_CHIP}</span> {line}</span>
{:else}
  <span class="train-chip" title={title ?? undefined}><Icon name="check" size={11} /> {TRAINING_RUN_CHIP}</span>
{/if}

<style>
  .train-line {
    display: block;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    overflow-wrap: anywhere;
  }
  .train-chip {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: var(--text-2xs);
    padding: 1px 8px;
    border-radius: 999px;
    border: 1px solid var(--color-success);
    color: var(--color-success);
    white-space: nowrap;
  }
  .train-line .train-chip {
    margin-right: 4px;
  }
</style>
