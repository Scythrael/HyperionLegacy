<script lang="ts">
  // TeamBadge.svelte: a ground team's A / B / C badge (0.14.0, Ground Operations GO-10; the GO-M1 mockup's
  // `.badge`). The letter is by POSITION (groundTeamShortLabel), so it never changes when a team is
  // renamed; pass `kind` to add the team kind glyph (Strike / Survey / Ground, Squads design 2.1).
  //
  // Used by the slotting cards (GO-11), the dispatch strip (GO-12), the queue's odds columns (GO-13) and the
  // timelines / task cards (GO-14). Display decisions live in groundOpsAtoms.ts teamBadgeView (tested).

  import Icon from "./Icon.svelte";
  import { teamBadgeView } from "./groundOpsAtoms";
  import type { GroundTeamKind } from "../game/model";

  /** The team's position on its ship (0 = Alpha = A). */
  export let index: number;
  /** The team's kind; when given, its glyph sits beside the letter. */
  export let kind: GroundTeamKind | null = null;
  /** The team's display name (groundTeamName), for the accessible name. */
  export let name: string | null = null;
  /** "sm" for a table header or a timeline lane. */
  export let size: "md" | "sm" = "md";

  $: view = teamBadgeView(index, kind, name);
</script>

<span class="team-badge" class:sm={size === "sm"} class:with-kind={view.glyph !== null} role="img" aria-label={view.ariaLabel} title={view.ariaLabel}>
  <span class="team-badge-letter" aria-hidden="true">{view.letter}</span>
  {#if view.glyph}<span class="team-badge-kind" aria-hidden="true"><Icon name={view.glyph} /></span>{/if}
</span>

<style>
  /* GO-M1 `.badge`: a square tile, display font, accent letter on the deep background with a hairline
     border. The app's single corner token (squared UI) instead of the mockup's 8px radius. */
  .team-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    flex: none;
    min-width: 30px;
    height: 30px;
    padding: 0 6px;
    box-sizing: border-box;
    background: var(--color-bg-mid);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--corner);
    color: var(--color-accent);
    font-family: var(--font-display);
    font-weight: 700;
    font-size: var(--text-md);
    line-height: 1;
  }
  .team-badge.sm {
    min-width: 22px;
    height: 22px;
    padding: 0 4px;
    gap: 3px;
    font-size: var(--text-xs);
  }
  .team-badge-kind {
    display: inline-flex;
    font-size: 1.15em;
    color: var(--color-text-secondary);
  }
</style>
