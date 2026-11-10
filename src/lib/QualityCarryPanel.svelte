<script lang="ts">
  // QualityCarryPanel.svelte: the Refinery's "Quality carries into crafts" explainer (0.14.0 ML-7; the signed-off
  // Refinery mockup's panel under the order form, TRIMMED per the user 2026-10-26 "Trimmed panel now (Recommended)"
  // while only raw quality carried). ML-5 (quality blanks) restores the other half: equipment blanks keep their
  // quality, and the mockup's Sprint Drive step. Both examples are real recipes run through the order form's own
  // preview (materialLinesDisplay.ts carryExample / blankCarryExample, tested against the started jobs).
  import { BLANK_CARRY_RULE_TEXT, CARRY_RULE_TEXT, blankCarryExample, carryExample } from "./ui/materialLinesDisplay";
  import Icon from "./ui/Icon.svelte";

  // Static content (a recipe table), so computed once.
  const ex = carryExample();
  const bx = blankCarryExample();
</script>

<div class="qcp">
  <div class="qcp-flow">
    {#each ex.inputs as step, i (step)}
      {#if i > 0}<span class="qcp-plus" aria-hidden="true">+</span>{/if}
      <span class="qcp-step">{step}</span>
    {/each}
    <span class="qcp-arrow"><Icon name="chevronRight" size={12} /></span>
    <span class="qcp-step">{ex.output}</span>
  </div>
  <p class="qcp-rule">{CARRY_RULE_TEXT}</p>
  <div class="qcp-take">
    <div class="qcp-row"><span>{ex.outputLabel} order uses</span><span class="qcp-v">{ex.uses}</span></div>
    <div class="qcp-row"><span>Carried quality</span><span class="qcp-v">{ex.carried}</span></div>
  </div>

  <div class="qcp-flow">
    {#each bx.inputs as step, i (step)}
      {#if i > 0}<span class="qcp-plus" aria-hidden="true">+</span>{/if}
      <span class="qcp-step">{step}</span>
    {/each}
    <span class="qcp-arrow"><Icon name="chevronRight" size={12} /></span>
    <span class="qcp-step">{bx.blank}</span>
    <span class="qcp-arrow"><Icon name="chevronRight" size={12} /></span>
    <span class="qcp-step">{bx.piece}</span>
  </div>
  <p class="qcp-rule">{BLANK_CARRY_RULE_TEXT}</p>
  <div class="qcp-take">
    <div class="qcp-row"><span>{bx.outputLabel} order uses</span><span class="qcp-v">{bx.uses}</span></div>
    <div class="qcp-row"><span>Carried quality</span><span class="qcp-v">{bx.carried}</span></div>
  </div>
</div>

<style>
  .qcp { display: grid; gap: 8px; min-width: 0; }
  .qcp-flow { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: var(--text-xs); color: var(--color-text-primary); }
  .qcp-step { border: 1px solid var(--color-border); border-radius: var(--corner); padding: 3px 7px; background: var(--color-panel-bg-strong); }
  .qcp-plus { color: var(--color-text-dim); }
  .qcp-arrow { display: inline-flex; color: var(--color-text-dim); }
  .qcp-rule { margin: 0; font-size: var(--text-xs); line-height: 1.45; color: var(--color-text-secondary); }
  .qcp-take { display: grid; gap: 4px; }
  .qcp-row { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 2px 10px; font-size: calc(11px * var(--ui-scale, 1)); color: var(--color-text-primary); }
  .qcp-v { font-family: var(--font-mono); }
</style>
