<script lang="ts">
  // ============================================================================
  // SettingRow: ONE settings control, with its label and its explanation.
  // 0.13.5 Phase 1 (the options reorg).
  //
  // WHY THIS EXISTS. Every setting in the old Options panel was hand-written as the same three
  // things: a `.dev-row` wrapper, a `<label>` carrying an INLINE `style="display: inline-flex;
  // align-items: center; gap: 6px;"`, and a `.prestige-text` paragraph underneath. That shape was
  // repeated for every toggle, which means:
  //   - the inline style was copy-pasted per row, so no token could ever reach it;
  //   - the classes are MISNAMED for what they do (`.dev-row` is not a dev row, and
  //     `.prestige-text` has nothing to do with prestige), which is how a reader learns the wrong
  //     thing about the markup;
  //   - a new setting meant copying markup rather than declaring one.
  //
  // ⚠️ THIS IS DELIBERATELY NOT A GENERIC "FORM FIELD" COMPONENT. It knows about exactly one
  // layout, the one the options screens use, and takes its control as a slot so a checkbox, a
  // select, or a row of buttons all fit without this file learning about any of them. Generalising
  // it further would be inventing requirements: there is one settings screen.
  //
  // Every size and colour here reads a TOKEN (0.13.5's type scale), so this component is the first
  // real consumer of the token layer and proves the scale works before phase 5 converts the rest.
  // ============================================================================

  // The control's name, as the player reads it.
  export let label: string;
  // What it does, in plain language. Always present: a setting whose effect is not explained is a
  // setting nobody dares touch, which is the discoverability problem this reorg exists to fix.
  export let description: string;
  // When true, the label and description are rendered but the row is visibly de-emphasised. Used
  // for a setting that exists but cannot currently be changed (a locked feature, an unmet
  // prerequisite). Reads the AA-compliant disabled token rather than an ad-hoc alpha.
  export let disabled: boolean = false;
</script>

<div class="setting-row" class:setting-row-disabled={disabled}>
  <div class="setting-control">
    <span class="setting-label">{label}</span>
    <span class="setting-widget"><slot /></span>
  </div>
  <p class="setting-description">{description}</p>
</div>

<style>
  .setting-row {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-4) 0;
    border-bottom: 1px solid var(--color-border);
  }
  /* The last row in a group carries no rule, so a group does not end with a dangling line. */
  .setting-row:last-child {
    border-bottom: none;
  }
  .setting-control {
    display: flex;
    align-items: center;
    justify-content: space-between;
    /* ⚠️ WRAPS ON PURPOSE. A long label beside a wide control (the combat-log speed buttons, a
       theme dropdown) overflows a narrow phone otherwise, which is the exact class of bug that
       pushed a timestamp off the screen in 0.13.3.1. */
    flex-wrap: wrap;
    gap: var(--space-3) var(--space-5);
  }
  .setting-label {
    font-size: var(--text-md);
    color: var(--color-text-primary);
    font-weight: 600;
  }
  .setting-widget {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
  }
  .setting-description {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    margin: 0;
    /* Keeps an explanation readable rather than letting it stretch across a monitor. Uses the
       release's own reading-width token so it moves with everything else in phase 4. */
    max-width: var(--max-reading-width);
  }
  .setting-row-disabled .setting-label,
  .setting-row-disabled .setting-description {
    color: var(--color-text-disabled);
  }
</style>
