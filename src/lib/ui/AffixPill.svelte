<script lang="ts">
  // AffixPill.svelte: one objective AFFIX as a pill (0.14.0, objective affixes UI step).
  //
  // User: "the affix should have a color coding that makes this obvious to the player at a glance. So the pill ...
  // will be color coded with green/yellow/red." Green positive, yellow neutral, red negative (theme tokens
  // --color-success / --color-warning / --color-danger, so the colorblind palette follows), and the alignment is
  // WRITTEN on the pill too ("Negative"), so color is never the only signal. The label carries the rank
  // ("Reinforcing III"); the affix's short line opens in the shared HelpTip bubble (hover, tap or keyboard focus).
  // Display decisions: objectiveAffixDisplay.ts affixPillView (tested).

  import HelpTip from "../HelpTip.svelte";
  import type { AffixPillView } from "../objectiveAffixDisplay";

  export let pill: AffixPillView;
</script>

<HelpTip label={pill.label} text={pill.tooltip} buttonLabel={pill.ariaLabel}>
  <span class="affix-pill c-{pill.color}">
    <span class="affix-pill-align">{pill.alignment}</span>
    <span class="affix-pill-name">{pill.label}</span>
  </span>
  <span slot="tip" class="affix-tip">
    <span class="affix-tip-name">{pill.label} · {pill.alignment}</span>
    <span>{pill.tooltip}</span>
  </span>
</HelpTip>

<style>
  .affix-pill {
    --affix-color: var(--color-danger);
    display: inline-flex;
    align-items: stretch;
    min-width: 0;
    border: 1px solid var(--affix-color);
    border-radius: 999px;
    overflow: hidden;
    font-size: var(--text-xs);
    line-height: 1.3;
    white-space: nowrap;
  }
  .affix-pill.c-green {
    --affix-color: var(--color-success);
  }
  .affix-pill.c-yellow {
    --affix-color: var(--color-warning);
  }
  .affix-pill.c-red {
    --affix-color: var(--color-danger);
  }
  .affix-pill-align {
    padding: 1px 6px;
    background: var(--affix-color);
    color: var(--color-bg-deep);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .affix-pill-name {
    padding: 1px 8px 1px 6px;
    background: color-mix(in srgb, var(--affix-color) 14%, transparent);
    color: var(--color-text-primary);
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .affix-tip {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .affix-tip-name {
    font-weight: 600;
    color: var(--color-text-primary);
  }
</style>
