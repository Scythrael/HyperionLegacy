<script lang="ts">
  // StudyChips.svelte: a row of the gas giant study's chips (0.14.0 GG-6; the v3 mockup's chip row: plain, accent,
  // ok and warning tones, each with an optional SVG glyph). Tone is never the only signal: every chip says its state
  // in words. Pure presentation over gasGiantStudyDisplay.ts StudyChip.

  import type { StudyChip } from "./gasGiantStudyDisplay";
  import Icon from "./ui/Icon.svelte";

  export let chips: StudyChip[];
  export let label: string | null = null;
</script>

<div class="sc-row" role={label ? "group" : undefined} aria-label={label ?? undefined}>
  {#each chips as c, i (i)}
    <span class="sc t-{c.tone}">{#if c.glyph}<Icon name={c.glyph} size={14} />{/if}{c.text}</span>
  {/each}
</div>

<style>
  .sc-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    min-width: 0;
  }
  .sc {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    max-width: 100%;
    font-size: var(--text-2xs);
    padding: 2px 8px;
    border: 1px solid rgba(var(--color-accent-rgb), 0.2);
    border-radius: var(--corner);
    background: rgba(var(--color-accent-rgb), 0.06);
    color: var(--color-text-secondary);
    overflow-wrap: anywhere;
  }
  .sc.t-acc {
    color: var(--color-accent-bright);
    border-color: rgba(var(--color-accent-rgb), 0.45);
  }
  .sc.t-ok {
    color: var(--color-success);
    border-color: currentColor;
  }
  .sc.t-warn {
    color: var(--color-warning);
    border-color: currentColor;
  }
</style>
