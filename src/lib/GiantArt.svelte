<script lang="ts">
  // GiantArt.svelte: the SVG portrait of a gas giant or a nebula (0.14.0, Gas Giant Study GG-6; the signed-off v3
  // mockup's banded planet, the Survey Log's nebula cloud). Drawing only: the palette comes from gasGiantStudyDisplay.ts
  // (GIANT_ART, NEBULA_ART). A labeled image (role img) so a screen reader hears what it shows.

  import type { GiantArt } from "./gasGiantStudyDisplay";

  export let giant: GiantArt | null = null;
  export let nebula: readonly [string, string, string] | null = null;
  export let label: string;
  // A unique id prefix (the clip path and gradient ids must not collide when two portraits share a page).
  export let idBase: string;
</script>

{#if giant}
  <svg class="ga" viewBox="0 0 160 160" role="img" aria-label={label}>
    <defs>
      <clipPath id="{idBase}-cp"><circle cx="80" cy="80" r="64" /></clipPath>
      <radialGradient id="{idBase}-sh" cx="35%" cy="35%" r="75%">
        <stop offset="0" stop-color="#fff" stop-opacity=".12" />
        <stop offset=".7" stop-color="#000" stop-opacity=".1" />
        <stop offset="1" stop-color="#000" stop-opacity=".6" />
      </radialGradient>
    </defs>
    <g clip-path="url(#{idBase}-cp)">
      {#each giant.palette as color, i (i)}
        <rect x="0" y={16 + i * 25.6} width="160" height="26" fill={color} />
      {/each}
      {#if giant.spot}<ellipse cx="104" cy="98" rx="15" ry="8" fill={giant.spot} opacity=".85" />{/if}
      <circle cx="80" cy="80" r="64" fill="url(#{idBase}-sh)" />
    </g>
    {#if giant.aurora}<ellipse cx="80" cy="22" rx="30" ry="6" fill="none" stroke="#f0a0ff" stroke-width="2" opacity=".7" />{/if}
    <circle cx="80" cy="80" r="64" fill="none" stroke="currentColor" stroke-opacity=".25" />
  </svg>
{:else if nebula}
  <svg class="ga" viewBox="0 0 160 160" role="img" aria-label={label}>
    <defs>
      <radialGradient id="{idBase}-n0" cx="50%" cy="50%" r="50%">
        <stop offset="0" stop-color={nebula[0]} stop-opacity=".9" />
        <stop offset="1" stop-color={nebula[0]} stop-opacity="0" />
      </radialGradient>
      <radialGradient id="{idBase}-n1" cx="50%" cy="50%" r="50%">
        <stop offset="0" stop-color={nebula[1]} stop-opacity=".8" />
        <stop offset="1" stop-color={nebula[1]} stop-opacity="0" />
      </radialGradient>
      <radialGradient id="{idBase}-n2" cx="50%" cy="50%" r="50%">
        <stop offset="0" stop-color={nebula[2]} stop-opacity=".85" />
        <stop offset="1" stop-color={nebula[2]} stop-opacity="0" />
      </radialGradient>
    </defs>
    <ellipse cx="70" cy="78" rx="62" ry="44" fill="url(#{idBase}-n0)" />
    <ellipse cx="96" cy="66" rx="44" ry="34" fill="url(#{idBase}-n1)" />
    <ellipse cx="78" cy="102" rx="50" ry="26" fill="url(#{idBase}-n2)" />
    <circle cx="84" cy="74" r="2.2" fill="#fff" opacity=".9" />
    <circle cx="52" cy="58" r="1.2" fill="#fff" opacity=".7" />
    <circle cx="112" cy="104" r="1.4" fill="#fff" opacity=".7" />
  </svg>
{/if}

<style>
  .ga {
    width: 100%;
    max-width: 180px;
    height: auto;
    color: var(--color-text-secondary);
  }
</style>
