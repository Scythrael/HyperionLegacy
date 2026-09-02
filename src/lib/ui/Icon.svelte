<script lang="ts">
  // Icon.svelte: the one place an inline SVG icon is drawn (0.13.3 Unit 4.1).
  //
  // WHY a component instead of inline <svg> per call site: the design-system
  // decision (2026-09-01) moves content icons from emoji to inline stroke SVG
  // gradually, surface by surface. Without a shared component that migration
  // turns into dozens of hand-copied <svg> blocks in App.svelte, each free to
  // drift in viewBox, stroke width or a11y handling. Here the geometry is data
  // (icons.ts) and the wrapper is fixed, so every icon in the game is the same
  // weight and answers to the theme the same way.
  //
  // THEME AWARENESS is the whole point of stroke="currentColor": the glyph
  // takes the color of the text it sits in, so an icon inside a dimmed row, an
  // amber needs-you row and an accent-bright active tab all just work, in both
  // themes, with no per-theme icon variants. Nothing here sets a color.
  //
  // USAGE (no surface is migrated by this unit, per the migration policy, so
  // this is the reference example):
  //
  //   import Icon from "./lib/ui/Icon.svelte";
  //
  //   <!-- Decorative: the visible word already says "Queue", so the glyph is
  //        aria-hidden and a screen reader announces "Queue" exactly once. -->
  //   <span class="row-label"><Icon name="queue" /> Queue</span>
  //
  //   <!-- Meaningful: an icon-only button, so the glyph carries the name. -->
  //   <button on:click={moveUp}><Icon name="chevronUp" title="Move up" /></button>
  //
  //   <!-- Sized: pass a number for px, or any CSS length string. -->
  //   <Icon name="warning" size={14} />
  //
  // NOT here on purpose: no `class` passthrough. App.svelte's styles are
  // scoped, so a class handed down from there would not match anything without
  // a :global escape hatch, which is a trap worth not shipping. Layout belongs
  // to a wrapper element at the call site; this component only draws.

  import { ICON_PATHS, iconA11y, type IconName } from "./icons";

  /** Which glyph to draw. Typed against the icons.ts key set, so a typo fails the build. */
  export let name: IconName;

  /**
   * Rendered size. A number is treated as px; a string is passed through as a
   * CSS length. Default 1em so an icon scales with whatever type size its row
   * uses, which matters because the 0.13.5 readability pass re-tunes the global
   * type scale and an em-sized icon follows it for free.
   */
  export let size: string | number = "1em";

  /**
   * Accessible name. OMIT for the common case (an icon beside a visible text
   * label), which renders the glyph decorative. Pass a name only when the icon
   * alone carries the meaning, such as an icon-only queue control.
   */
  export let title: string | undefined = undefined;

  // Legacy reactive statements ($:), matching this codebase's Svelte 5 legacy
  // mode. No runes anywhere in this repo.
  $: sizeAttr = typeof size === "number" ? `${size}px` : size;
  $: a11y = iconA11y(title);
  $: paths = ICON_PATHS[name];
</script>

<!-- Attribute set is deliberately identical to the 0.13.2 nav icons in
     App.svelte (viewBox 0 0 24 24, fill none, stroke currentColor, round caps
     and joins) so a content icon and a nav icon read as one family. The only
     difference is stroke-width 1.75 (the nav row uses 1.8 at a fixed 20px);
     1.75 is the design's stated content weight and holds up better at 1em.
     focusable="false" keeps old Edge/IE-era engines from putting the <svg> in
     the tab order, which they otherwise do even when it is aria-hidden. -->
<svg
  class="fa-icon"
  viewBox="0 0 24 24"
  width={sizeAttr}
  height={sizeAttr}
  fill="none"
  stroke="currentColor"
  stroke-width="1.75"
  stroke-linecap="round"
  stroke-linejoin="round"
  focusable="false"
  role={a11y.role}
  aria-hidden={a11y.ariaHidden}
  aria-label={a11y.ariaLabel}
>
  <!-- The <title> is what actually voices the label in most screen readers;
       aria-label above is the belt-and-braces half. Rendered only when the
       caller asked for a labelled icon. -->
  {#if a11y.ariaLabel}<title>{a11y.ariaLabel}</title>{/if}
  {#each paths as d}<path {d} />{/each}
</svg>

<style>
  /* Alignment only, no color and no motion (nothing here animates, so there is
     nothing for prefers-reduced-motion to opt out of).
     - inline-block + a small negative vertical-align sits the glyph on the text
       baseline instead of hanging below it, which is how it looks right beside
       a label.
     - flex-shrink: 0 stops the icon being squeezed to nothing when it is a flex
       child in a dense row, the exact situation the queue rows create. */
  .fa-icon {
    display: inline-block;
    vertical-align: -0.15em;
    flex-shrink: 0;
  }
</style>
