<script lang="ts">
  // OvertimeRateChip.svelte (OT-UI, 0.14.0; user 2026-11-10 "Chip + no jump", "Rate chip only" on Command Home): the
  // Overtime glyph and the job's rate ("1.25x", "1.5x", "1.75x") on a sped-up job's time line. Bar colors stay as they
  // are; the chip is the only marker. The host renders it only when a step was bought (jobRateText is not null).
  import Icon from "./ui/Icon.svelte";

  export let rate: string;
</script>

<span class="ot-rate" title={`Overtime: ${rate} the normal rate`} aria-label={`Overtime, ${rate} the normal rate`}><Icon name="overtime" size={11} />{rate}</span>

<style>
  .ot-rate {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex: none;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--color-accent-bright);
    border: 1px solid rgba(var(--color-accent-rgb), 0.35);
    background: rgba(var(--color-accent-rgb), 0.06);
    border-radius: var(--corner, 2px);
    padding: 0 5px;
    line-height: 16px;
    white-space: nowrap;
  }
</style>
