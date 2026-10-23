<script lang="ts">
  // StarBar.svelte: "how close it came to becoming a star" (D22; the signed-off v3 mockup): a log-scale bar in Jupiter
  // masses with the deuterium line (13) and the fusion line (about 78), the giant's pin, and the sentence under it.
  // Pure presentation over gasGiantStudyDisplay.ts starBarView (tested). The bar is one labeled image; the sentence
  // says everything in words.

  import type { StarBarView } from "./gasGiantStudyDisplay";

  export let star: StarBarView;
</script>

<div class="sb" role="img" aria-label={star.ariaLabel}>
  <span class="sb-ln" style="left: {star.deuteriumLinePct}%;"><span>13</span></span>
  <span class="sb-ln r" style="left: {star.fusionLinePct}%;"><span>78</span></span>
  <span class="sb-pin" style="left: calc({star.pinPct}% - 1px);"></span>
  {#each star.ticks as t (t.label)}<span class="sb-tk" style="left: {t.pct}%;">{t.label}</span>{/each}
</div>
<p class="sb-text">
  <span class="sb-mono">{star.deuteriumText}</span> of the deuterium line (13 Jupiter masses), <span class="sb-mono">{star.fusionText}</span> of the
  fusion line (about 78, a true star). Log scale, in Jupiter masses. {star.verdict}
</p>

<style>
  .sb {
    position: relative;
    height: 12px;
    margin: 22px 8px 18px;
    background: linear-gradient(90deg, var(--color-bg-mid), color-mix(in srgb, var(--color-warning) 45%, var(--color-bg-mid)));
    border: 1px solid rgba(var(--color-accent-rgb), 0.2);
    border-radius: var(--corner);
  }
  .sb-pin {
    position: absolute;
    top: -4px;
    width: 3px;
    height: 18px;
    background: var(--color-accent-bright);
  }
  .sb-ln {
    position: absolute;
    top: -18px;
    bottom: -16px;
    border-left: 1px dashed var(--color-text-secondary);
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
  }
  .sb-ln span {
    position: absolute;
    top: 0;
    left: 4px;
    white-space: nowrap;
  }
  .sb-ln.r span {
    left: auto;
    right: 4px;
  }
  .sb-tk {
    position: absolute;
    bottom: -16px;
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
    transform: translateX(-50%);
  }
  .sb-text {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-dim);
  }
  .sb-mono {
    font-family: var(--font-mono);
    color: var(--color-text-secondary);
  }
</style>
