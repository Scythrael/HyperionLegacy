<script context="module" lang="ts">
  // A unique hatch pattern id per map on the page (pattern ids are document-wide).
  let nextMapId = 0;
</script>

<script lang="ts">
  // TelescopeMap.svelte: the Subspace Telescope card's GALAXY MAP (0.14.0, Squads SQ-7 section 7.4; the approved
  // squads-telescope mockup's map). Centered on the homeworld: the galactic disk, its arms, the bulge and the core,
  // the seven regions badged I to VII, the current range ring (solid) and the next level's ring (dashed). Below it,
  // the legend and the region key say the same in words, so color is never the only signal. Pure presentation over
  // telescopeCardDisplay.ts telescopeMapView (tested); the SVG is one image with a summarizing accessible name.
  // Expedition Tiers G2-7 (the approved 2026-11-09 shading mockup): the enemy territory sectors the telescope reaches,
  // a thin hatch with a dashed edge under the rings and badges (telescopeMapEnemyView, tested), a legend line, "part
  // enemy" on the key's rows and one sentence in the accessible name. Quiet on purpose: no red fill, no pulse.

  import type { TelescopeMapEnemyView, TelescopeMapView } from "./telescopeCardDisplay";

  export let map: TelescopeMapView;
  export let enemy: TelescopeMapEnemyView | null = null;

  const hatchId = `tm-hatch-${nextMapId++}`;
  $: sectors = enemy?.sectors ?? [];
  $: ariaLabel = enemy?.ariaSentence ? `${map.ariaLabel} ${enemy.ariaSentence}` : map.ariaLabel;
</script>

<div class="tm">
  <svg class="tm-svg" viewBox={map.viewBox} role="img" aria-label={ariaLabel}>
    {#if sectors.length > 0}
      <defs>
        <pattern id={hatchId} patternUnits="userSpaceOnUse" width="4.5" height="4.5" patternTransform="rotate(45)">
          <rect width="4.5" height="4.5" fill="rgba(248, 113, 113, 0.06)" />
          <line x1="0" y1="0" x2="0" y2="4.5" stroke="rgba(248, 113, 113, 0.5)" stroke-width="1" />
        </pattern>
      </defs>
    {/if}
    <path class="tm-disk" d={map.diskPath} />
    {#each map.armPaths as d, i}
      <path class="tm-arm" class:minor={i === map.armPaths.length - 1} d={d} />
    {/each}
    <path class="tm-bulge" d={map.bulgePath} />
    <circle class="tm-core" cx={map.core.x} cy={map.core.y} r="3.5" />
    <circle class="tm-ring-fill" cx={map.home.x} cy={map.home.y} r={map.ringR} />
    {#each sectors as s (s.tier)}
      <path class="tm-enemy" fill="url(#{hatchId})" d={s.path} />
    {/each}
    {#if map.nextRingR !== null}
      <circle class="tm-ring next" cx={map.home.x} cy={map.home.y} r={map.nextRingR} />
    {/if}
    <circle class="tm-ring" cx={map.home.x} cy={map.home.y} r={map.ringR} />
    <circle class="tm-home" cx={map.home.x} cy={map.home.y} r="4" />
    {#each map.badges as b (b.tier)}
      <g class="tm-badge" class:in={b.reached}>
        <circle cx={b.x} cy={b.y} r={map.badgeR} />
        <text x={b.x} y={b.y + 3} text-anchor="middle">{b.numeral}</text>
      </g>
    {/each}
    <!-- G2-9 (user 2026-11-11 "Label + point inward"): each hatched slice names its tier (III and IV share a ring). -->
    {#each sectors as s (s.tier)}
      <text class="tm-enemy-label" x={s.label.x} y={s.label.y} text-anchor={s.label.anchor} font-size={s.label.size}>{s.label.text}</text>
    {/each}
    <text class="tm-label" x={map.homeLabel.x} y={map.homeLabel.y} text-anchor={map.homeLabel.anchor}>{map.homeLabel.text}</text>
    <text class="tm-label small" x={map.coreLabel.x} y={map.coreLabel.y} text-anchor={map.coreLabel.anchor}>{map.coreLabel.text}</text>
  </svg>

  <ul class="tm-legend">
    <li><span class="tm-key solid" aria-hidden="true"></span>{map.legend[0]}</li>
    <li>{#if map.nextRingR !== null}<span class="tm-key dashed" aria-hidden="true"></span>{/if}{map.legend[1]}</li>
    {#if enemy?.legend}
      <li><span class="tm-key hatch" aria-hidden="true"></span>{enemy.legend}</li>
    {/if}
  </ul>
  <ul class="tm-regions" aria-label="Regions">
    {#each map.badges as b (b.tier)}
      <li class:in={b.reached}>
        <span class="tm-num" aria-hidden="true">{b.numeral}</span>
        <span class="tm-name"
          >{b.name}{#if enemy?.tiers.includes(b.tier)}{" "}<span class="tm-part"><span class="tm-key hatch sm" aria-hidden="true"></span>part enemy</span>{/if}</span
        >
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
  .tm-ring { fill: none; stroke: var(--color-accent); stroke-width: 1.6; }
  .tm-ring-fill { fill: rgba(var(--color-accent-rgb), 0.08); stroke: none; }
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
  /* Enemy territory (G2-7): a thin hatch in the danger hue at low strength with a dashed edge, no pulse. */
  .tm-enemy { stroke: rgba(248, 113, 113, 0.45); stroke-width: 0.8; stroke-dasharray: 2 2; }
  /* G2-9: the slice's tier numeral, small, in the danger hue with a halo so it reads over the hatch and the arms. */
  .tm-enemy-label { fill: var(--color-danger); font-weight: 700; font-family: var(--font-mono, monospace); paint-order: stroke; stroke: var(--color-bg-deep); stroke-width: 2.5px; stroke-linejoin: round; pointer-events: none; }
  .tm-key.hatch { height: 10px; border: 1px dashed rgba(248, 113, 113, 0.55); background: repeating-linear-gradient(45deg, rgba(248, 113, 113, 0.5) 0 1px, rgba(248, 113, 113, 0.06) 1px 4px); }
  .tm-key.hatch.sm { flex: 0 0 12px; width: 12px; height: 8px; display: inline-block; vertical-align: -1px; }
  .tm-part { font-size: var(--text-2xs, 11px); color: var(--color-text-secondary); white-space: nowrap; margin-left: 4px; display: inline-flex; gap: 4px; align-items: center; }

  .tm-regions { list-style: none; margin: 8px 0 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 190px), 1fr)); gap: 4px 12px; font-size: var(--text-xs, 12px); }
  .tm-regions li { display: grid; grid-template-columns: 34px minmax(0, 1fr) auto; align-items: center; gap: 6px; color: var(--color-text-dim); min-width: 0; }
  .tm-regions li.in { color: var(--color-text-primary); }
  .tm-num { display: inline-grid; place-items: center; min-width: 30px; height: 18px; padding: 0 4px; box-sizing: border-box; border-radius: 9px; border: 1px dashed var(--color-text-dim); font: 700 10px var(--font-mono, monospace); }
  .tm-regions li.in .tm-num { border: 1px solid var(--color-accent); color: var(--color-accent); }
  .tm-name { overflow-wrap: anywhere; }
  .tm-state { font-size: var(--text-2xs, 11px); }
</style>
