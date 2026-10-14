<script lang="ts">
  // ThreatChip.svelte: one threat tier as a chip (0.14.0, Ground Operations GO-10).
  //
  // The tier's band color, the SVG tier dot and its name; the full name, the coarse odds phrase and the
  // tactical officer's line open in the shared HelpTip bubble (hover, tap or keyboard focus, portaled so no
  // card clips it). NO emoji: this replaced the patrol chip's emoji (standing rule: graphics are SVG).
  //
  // Used by the patrol card and dispatch popup (full name on the face) and, from GO-13 on, by the per-team
  // odds cells (short name). The display decisions live in groundOpsAtoms.ts threatChipView (tested).
  //
  // Color: the band ramp is LITERAL hex (threatAssessment.ts COLORS), the same in every theme by design;
  // the chip only washes it behind the text. Only the surrounding chrome follows the theme.

  import HelpTip from "../HelpTip.svelte";
  import Icon from "./Icon.svelte";
  import { threatChipView, type ThreatChipInput } from "./groundOpsAtoms";

  /** The tier to show (a ThreatAssessment, or any object with its display fields). */
  export let assessment: ThreatChipInput;
  /** Show the full tier name on the face ("A Worthy Adversary"); default is the short name ("Worthy"). */
  export let full = false;
  /** Prefix of the accessible name, e.g. "Threat Assessment" or "Team A odds". */
  export let context = "Threat Assessment";
  /** "sm" for a dense table cell. */
  export let size: "md" | "sm" = "md";
  /** Caps the chip's width (any CSS length); a longer name ellipsizes and stays whole in the bubble. */
  export let maxWidth: string | undefined = undefined;

  $: view = threatChipView(assessment, full, context);
</script>

<HelpTip label={view.text} text={`${view.range}. ${view.voice}`} buttonLabel={view.ariaLabel}>
  <span
    class="threat-chip"
    class:sm={size === "sm"}
    class:glow={view.glow}
    style="--threat-color: {view.color}; --threat-text: {view.textColor};{maxWidth ? ` max-width: ${maxWidth};` : ''}"
  >
    <span class="threat-chip-dot"><Icon name={view.glyph} /></span>
    <span class="threat-chip-name">{view.text}</span>
  </span>
  <span slot="tip" class="threat-tip">
    {#if view.title}<span class="threat-tip-name">{view.title}</span>{/if}
    <span class="threat-tip-range">{view.range}</span>
    <span class="threat-tip-voice">{view.voice}</span>
  </span>
</HelpTip>

<style>
  /* The chip look the patrol card had (App.svelte .threat-chip, 0.13 Combat 1.0 Unit 2.4): band-color
     border and dot over a faint wash of the same color. The TEXT is --threat-text: the band color lifted
     toward white just enough for WCAG AA on the wash (groundOpsAtoms.ts readableChipText; the darker bands
     need it, the bright ones come back unchanged). */
  .threat-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding: 3px 9px;
    border: 1px solid var(--threat-color);
    background: color-mix(in srgb, var(--threat-color) 16%, transparent);
    color: var(--threat-text, var(--threat-color));
    font-size: var(--text-sm);
    font-weight: 600;
    line-height: 1.3;
    white-space: nowrap;
    border-radius: var(--corner);
  }
  .threat-chip.sm {
    gap: 4px;
    padding: 1px 7px;
    font-size: var(--text-xs);
  }
  .threat-chip-dot {
    display: inline-flex;
    flex: none;
    font-size: 1.1em;
    color: var(--threat-color);
  }
  /* Impossible (user 2026-10-14: emphasize it): a static red glow, no animation, so reduced motion needs
     nothing extra. */
  .threat-chip.glow {
    box-shadow:
      0 0 6px color-mix(in srgb, var(--threat-color) 70%, transparent),
      inset 0 0 4px color-mix(in srgb, var(--threat-color) 35%, transparent);
  }
  .threat-chip-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .threat-tip {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .threat-tip-name {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--color-text-primary);
  }
  .threat-tip-range {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--color-text-primary);
  }
  .threat-tip-voice {
    font-size: var(--text-sm);
    font-style: italic;
    color: var(--color-text-secondary);
  }
</style>
