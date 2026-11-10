<script lang="ts">
  // JobOvertimeStrip.svelte (OT-UI, 0.14.0): the Overtime strip docked under a running job's progress row, the
  // 2026-11-10 Overtime buttons mockup (approved: "One tap, always visible"). The same look as the gear card's strip
  // (EquipmentTooltip.svelte .et-ot, the house pattern): the tag, pips 0 to 3, the step count and rate, the one-tap
  // button with the exact next-step cost, the new time, the dim pricing line, the reason when it is off, and "At its
  // fastest" at the top. POSTURE: pure presentation over jobOvertimeDisplay.ts jobOvertimeStrip (tested); the tap
  // bubbles up through onBuy to the host (App.svelte buyJobOvertime: the engine's buy, save and log).

  import type { JobOvertimeStrip } from "./jobOvertimeDisplay";
  import Icon from "./ui/Icon.svelte";

  export let strip: JobOvertimeStrip;
  // Buys the next step on the job. Absent = the strip shows its state but no button (a host that cannot buy).
  export let onBuy: ((processId: string) => void) | undefined = undefined;
</script>

<div class="jo" data-ot-state={strip.state}>
  <div class="jo-row">
    <span class="jo-tag" class:off={strip.state === "paused"}><Icon name="overtime" /> Overtime</span>
    <span class="jo-pips" title={`${strip.steps} of ${strip.maxSteps} steps`} aria-label={`${strip.steps} of ${strip.maxSteps} Overtime steps`}>
      {#each Array(strip.maxSteps) as _, i (i)}<i class:on={i < strip.steps}></i>{/each}
    </span>
    <span class="jo-n">{#if strip.steps > 0}<b>{strip.steps} of {strip.maxSteps}</b> · {strip.rateText}{:else}0 of {strip.maxSteps}{/if}</span>
    {#if strip.state === "max"}
      <span class="jo-max"><Icon name="check" /> At its fastest</span>
    {:else if strip.state === "buy" && onBuy}
      <button type="button" class="jo-btn" on:click={() => onBuy?.(strip.processId)}>{strip.button}</button>
    {:else}
      <span class="jo-btn off" aria-disabled="true">{strip.button}</span>
    {/if}
  </div>
  {#if strip.why}
    <div class="jo-why"><Icon name="info" /> <span>{strip.why}</span></div>
  {/if}
  {#if strip.when}
    <div class="jo-when">{strip.when.lead} <b>{strip.when.time}</b>{#if strip.when.was}{" instead of "}<s>{strip.when.was}</s>{/if}.</div>
  {/if}
  {#if strip.note}
    <div class="jo-dim">{strip.note}{#if strip.noteTail}<span class="jo-tail">{strip.noteTail}</span>.{/if}</div>
  {/if}
</div>

<style>
  /* The gear card's strip (EquipmentTooltip.svelte .et-ot), docked under a job row: one border family. */
  .jo {
    display: grid;
    gap: 5px;
    margin-top: 6px;
    padding: 7px 8px 8px;
    border: 1px solid rgba(var(--color-accent-rgb), 0.22);
    border-top: 1px dashed rgba(var(--color-accent-rgb), 0.28);
    background: rgba(var(--color-accent-rgb), 0.03);
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
    min-width: 0;
  }
  .jo-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 7px;
  }
  .jo-tag {
    display: inline-flex;
    gap: 5px;
    align-items: center;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--color-accent-bright);
  }
  .jo-tag.off {
    color: var(--color-text-dim);
  }
  .jo-pips {
    display: inline-flex;
    gap: 3px;
    align-items: center;
  }
  .jo-pips i {
    width: 9px;
    height: 5px;
    border: 1px solid rgba(var(--color-accent-rgb), 0.5);
    border-radius: 1px;
  }
  .jo-pips i.on {
    background: var(--color-accent);
    border-color: var(--color-accent);
  }
  .jo-n {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
    white-space: nowrap;
  }
  .jo-n b {
    color: var(--color-text-primary);
    font-weight: 400;
  }
  .jo-btn {
    margin-left: auto;
    min-height: 26px;
    padding: 3px 8px;
    display: inline-flex;
    gap: 5px;
    align-items: center;
    white-space: nowrap;
    font: inherit;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--color-accent);
    background: rgba(var(--color-accent-rgb), 0.06);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--corner, 2px);
    cursor: pointer;
  }
  .jo-btn:hover:not(.off) {
    background: rgba(var(--color-accent-rgb), 0.14);
  }
  .jo-btn.off {
    cursor: default;
    color: var(--color-text-dim);
    border-color: rgba(98, 133, 145, 0.45);
    border-style: dashed;
    background: transparent;
  }
  .jo-max {
    margin-left: auto;
    display: inline-flex;
    gap: 4px;
    align-items: center;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--color-success);
  }
  .jo-when b {
    color: var(--color-text-primary);
    font-weight: 500;
    font-family: var(--font-mono);
  }
  .jo-when s {
    color: var(--color-text-dim);
  }
  .jo-dim {
    color: var(--color-text-dim);
    font-size: var(--text-3xs);
  }
  .jo-why {
    display: flex;
    gap: 5px;
    align-items: flex-start;
  }
  /* Phone: a 32 px tap height, and the pricing line drops its long-form clause (the mockup's phone frames). */
  @media (max-width: 600px) {
    .jo-btn {
      min-height: 32px;
    }
    .jo-tail {
      display: none;
    }
  }
</style>
