<script lang="ts">
  // TelescopeMap.svelte: the Subspace Telescope card's GALAXY MAP (0.14.0, Squads SQ-7 section 7.4; the approved
  // squads-telescope mockup's map). Centered on the homeworld: the galactic disk, its arms, the bulge and the core,
  // the seven regions badged I to VII, the current range ring (solid) and the next level's ring (dashed). Below it,
  // the legend and the region key say the same in words, so color is never the only signal. Pure presentation over
  // telescopeCardDisplay.ts telescopeMapView (tested); the SVG is one image with a summarizing accessible name.

  import type { TelescopeMapView } from "./telescopeCardDisplay";

  export let map: TelescopeMapView;
</script>

<div class="tm">
  <svg class="tm-svg" viewBox={map.viewBox} role="img" aria-label={map.ariaLabel}>
    <path class="tm-disk" d={map.diskPath} />
    {#each map.armPaths as d, i}
      <path class="tm-arm" class:minor={i === map.armPaths.length - 1} d={d} />
    {/each}
    <path class="tm-bulge" d={map.bulgePath} />
    <circle class="tm-core" cx={map.core.x} cy={map.core.y} r="3.5" />
    {#if map.nextRingR !== null}
      <circle class="tm-ring next" cx={map.home.x} cy={map.home.y} r={map.nextRingR} />
    {/if}
    <circle class="tm-ring" cx={map.home.x} cy={map.home.y} r={map.ringR} />
    <circle class="tm-home" cx={map.home.x} cy={map.home.y} r="4" />
    {#each map.badges as b (b.tier)}
      <g class="tm-badge" class:in={b.reached}>
        <circle cx={b.x} cy={b.y} r="10" />
        <text x={b.x} y={b.y + 3} text-anchor="middle">{b.numeral}</text>
      </g>
    {/each}
    <text class="tm-label" x={map.home.x + 8} y={map.home.y - 8}>Homeworld</text>
    <text class="tm-label small" x={map.core.x + 14} y={map.core.y - 10}>Galactic Core</text>
  </svg>

  <ul class="tm-legend">
    <li><span class="tm-key solid" aria-hidden="true"></span>{map.legend[0]}</li>
    <li>{#if map.nextRingR !== null}<span class="tm-key dashed" aria-hidden="true"></span>{/if}{map.legend[1]}</li>
  </ul>
  <ul class="tm-regions" aria-label="Regions">
    {#each map.badges as b (b.tier)}
      <li class:in={b.reached}>
        <span class="tm-num" aria-hidden="true">{b.numeral}</span>
        <span class="tm-name">{b.name}</span>
        <span class="tm-state">{b.reached ? "In range" : "Beyond range"}</span>
      </li>
    {/each}
  </ul>
</div>

<style>
  .tm { min-width: 0; }
  .tm-svg { width: 100%; height: auto; max-width: 440px; display: block; margin: 6px auto 0; }
  .tm-disk { fill: rgba(var(--color-accent-rgb), 0.04); stroke: var(--color-border); stroke-width: 1; }
  .tm-arm { fill: none; stroke: var(--color-text-dim); stroke-width: 7; stroke-linecap: round; opacity: 0.24; }
  .tm-arm.minor { stroke-width: 4; }
  .tm-bulge { fill: rgba(var(--color-warning-rgb), 0.18); }
  .tm-core { fill: var(--color-warning); }
  .tm-home { fill: var(--color-accent); stroke: var(--color-bg-deep); stroke-width: 1.5; }
  .tm-ring { fill: rgba(var(--color-accent-rgb), 0.08); stroke: var(--color-accent); stroke-width: 1.6; }
  .tm-ring.next { fill: none; stroke: var(--color-warning); stroke-dasharray: 4 4; stroke-width: 1.3; }
  /* A reached badge is solid and accented; an unreached one is dashed and dim (shape, not only color). */
  .tm-badge circle { fill: var(--color-bg-deep); stroke: var(--color-text-dim); stroke-width: 1.3; stroke-dasharray: 2.5 2; }
  .tm-badge text { fill: var(--color-text-dim); font: 700 8.5px var(--font-mono, monospace); }
  .tm-badge.in circle { stroke: var(--color-accent); stroke-dasharray: none; }
  .tm-badge.in text { fill: var(--color-accent); }
  .tm-label { fill: var(--color-text-secondary); font: 600 10px system-ui, sans-serif; paint-order: stroke; stroke: var(--color-bg-deep); stroke-width: 3px; }
  .tm-label.small { font-size: 9px; fill: var(--color-text-dim); font-weight: 500; }

  .tm-legend { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 3px; font-size: var(--text-xs, 12px); color: var(--color-text-secondary); }
  .tm-legend li { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .tm-key { flex: 0 0 22px; height: 0; border-top: 2px solid var(--color-accent); }
  .tm-key.dashed { border-top: 2px dashed var(--color-warning); }

  .tm-regions { list-style: none; margin: 8px 0 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 190px), 1fr)); gap: 4px 12px; font-size: var(--text-xs, 12px); }
  .tm-regions li { display: grid; grid-template-columns: 26px minmax(0, 1fr) auto; align-items: center; gap: 6px; color: var(--color-text-dim); min-width: 0; }
  .tm-regions li.in { color: var(--color-text-primary); }
  .tm-num { display: inline-grid; place-items: center; width: 22px; height: 18px; border-radius: 9px; border: 1px dashed var(--color-text-dim); font: 700 10px var(--font-mono, monospace); }
  .tm-regions li.in .tm-num { border: 1px solid var(--color-accent); color: var(--color-accent); }
  .tm-name { overflow-wrap: anywhere; }
  .tm-state { font-size: var(--text-2xs, 11px); }
</style>
