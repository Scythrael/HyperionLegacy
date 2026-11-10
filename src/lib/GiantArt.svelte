<script lang="ts">
  // GiantArt.svelte: the SVG portrait of a gas giant, a nebula or the Wolf 359 derelict field (0.14.0, Gas Giant Study
  // GG-6; the signed-off v3 mockup's banded planet, the Survey Log's nebula cloud; Expedition Tiers G2-7's derelict
  // field). Drawing only: the giant and nebula palettes come from gasGiantStudyDisplay.ts (GIANT_ART, NEBULA_ART); the
  // derelict portrait has ONE fixed palette written inline below (its dim red star's glow, the hulls' tones), since
  // there is only one derelict field. A labeled image (role img) so a screen reader hears what it shows.

  import type { GiantArt } from "./gasGiantStudyDisplay";

  export let giant: GiantArt | null = null;
  export let nebula: readonly [string, string, string] | null = null;
  export let label: string;
  // A unique id prefix (the clip path and gradient ids must not collide when two portraits share a page).
  export let idBase: string;
  // Expedition Tiers G2-7 (user 2026-11-02, the Wolf 359 nod): the derelict field. Old, unmarked hulls drifting in loose
  // formation beside a dim red star. Plain generic hulls (a long body, a tapered bow, no markings), never a known ship.
  export let derelict = false;

  // One plain hull in local units (bow to the right), and where each one drifts: x, y, heading in degrees, scale.
  // Roughly one heading, loosely spaced, one hull broken in two.
  const HULL = "M-15 -3 L9 -3 L16 0 L9 3 L-15 3 L-17 1.5 L-17 -1.5 Z";
  const DRIFT: readonly (readonly [number, number, number, number])[] = [
    [44, 62, -18, 1.25],
    [86, 50, -22, 1.05],
    [118, 74, -15, 0.9],
    [58, 98, -24, 1.0],
    [100, 104, -12, 1.15],
    [36, 132, -20, 0.8],
    [132, 128, -26, 0.75],
  ];
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
{:else if derelict}
  <svg class="ga" viewBox="0 0 160 160" role="img" aria-label={label}>
    <defs>
      <radialGradient id="{idBase}-dw" cx="50%" cy="50%" r="50%">
        <stop offset="0" stop-color="#ff8a5c" stop-opacity=".95" />
        <stop offset=".25" stop-color="#d0583c" stop-opacity=".6" />
        <stop offset="1" stop-color="#d0583c" stop-opacity="0" />
      </radialGradient>
    </defs>
    <circle cx="132" cy="26" r="26" fill="url(#{idBase}-dw)" />
    <circle cx="132" cy="26" r="4" fill="#ffb08a" />
    <circle cx="22" cy="30" r="1.1" fill="#fff" opacity=".6" />
    <circle cx="70" cy="18" r="0.9" fill="#fff" opacity=".5" />
    <circle cx="146" cy="96" r="1" fill="#fff" opacity=".5" />
    <circle cx="16" cy="88" r="0.9" fill="#fff" opacity=".45" />
    <circle cx="84" cy="146" r="1.1" fill="#fff" opacity=".5" />
    {#each DRIFT as [x, y, a, s], i (i)}
      {#if i === 3}
        <!-- the broken hull: bow and stern drifting a little apart -->
        <g transform="translate({x} {y}) rotate({a}) scale({s})">
          <path d="M-15 -3 L-3 -3 L-5 0 L-2 3 L-15 3 L-17 1.5 L-17 -1.5 Z" fill="#5d6670" stroke="currentColor" stroke-opacity=".45" stroke-width=".8" />
          <path d="M2 -4 L9 -4 L16 -1 L9 2 L4 2 L1 -1 Z" fill="#5d6670" stroke="currentColor" stroke-opacity=".45" stroke-width=".8" transform="rotate(8)" />
        </g>
      {:else}
        <g transform="translate({x} {y}) rotate({a}) scale({s})">
          <path d={HULL} fill="#5d6670" stroke="currentColor" stroke-opacity=".45" stroke-width=".8" />
          <line x1="-11" y1="0" x2="6" y2="0" stroke="#000" stroke-opacity=".35" stroke-width="1" />
        </g>
      {/if}
    {/each}
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
