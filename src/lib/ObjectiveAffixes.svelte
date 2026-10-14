<script lang="ts">
  // ObjectiveAffixes.svelte: an objective's AFFIX pills and its ALERT state, on the objective cards of the queue
  // screen and the progress cards (0.14.0, objective affixes UI step).
  //
  // The pills (AffixPill.svelte: green / yellow / red with the alignment written on, the rank in the label, the
  // short line in a HelpTip), then, while the objective is on ALERT (Reinforcing), its level, the Heightened Senses
  // stacks, the extra enemies and when it clears. Once the alert pushes the objective to IMPOSSIBLE it is held (the
  // failsafe): the line reads the live countdown "Impossible: resets in 24m 3s" in the Impossible tier's crimson
  // with its static glow (user 2026-10-14; no animation, so nothing for reduced motion). Pure presentation over
  // objectiveAffixDisplay.ts (tested); `view` is recomputed by the caller every tick, so the countdown ticks.

  import type { ObjectiveAffixesView } from "./objectiveAffixDisplay";
  import { IMPOSSIBLE_HEX } from "./objectiveAffixDisplay";
  import Icon from "./ui/Icon.svelte";
  import AffixPill from "./ui/AffixPill.svelte";

  export let view: ObjectiveAffixesView;
</script>

<div class="oa">
  {#if view.pills.length > 0}
    <div class="oa-pills" role="list" aria-label="Affixes">
      {#each view.pills as pill (pill.key)}
        <span role="listitem"><AffixPill {pill} /></span>
      {/each}
    </div>
  {/if}
  {#if view.alert}
    <div class="oa-alert" class:held={view.alert.held} style="--impossible: {IMPOSSIBLE_HEX};">
      <div class="oa-alert-head"><Icon name="warning" size={12} /> {view.alert.headline}</div>
      <div class="oa-alert-line">{view.alert.effects}{#if view.alert.ratingText}. {view.alert.ratingText}{/if}.</div>
      <div class="oa-alert-line dim">{view.alert.resetText}{view.alert.held ? "" : "."}</div>
    </div>
  {/if}
</div>

<style>
  .oa {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }
  .oa-pills {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    min-width: 0;
  }
  .oa-alert {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 4px 7px;
    border: 1px solid color-mix(in srgb, var(--color-danger) 55%, transparent);
    border-left-width: 3px;
    border-radius: var(--corner);
    background: color-mix(in srgb, var(--color-danger) 8%, transparent);
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
    white-space: normal;
  }
  .oa-alert-head {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--color-danger);
  }
  .oa-alert-line.dim {
    color: var(--color-text-dim);
  }
  /* Impossible (the failsafe): the threat ramp's crimson with a STATIC glow, as on the Impossible threat chip. */
  .oa-alert.held {
    border-color: var(--impossible);
    background: color-mix(in srgb, var(--impossible) 12%, transparent);
    box-shadow:
      0 0 6px color-mix(in srgb, var(--impossible) 60%, transparent),
      inset 0 0 4px color-mix(in srgb, var(--impossible) 30%, transparent);
  }
  .oa-alert.held .oa-alert-head {
    color: color-mix(in srgb, var(--impossible) 70%, #ffffff);
  }
</style>
