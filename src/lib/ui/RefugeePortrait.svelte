<script lang="ts">
  // RefugeePortrait.svelte: a refugee's face (E5-5, the signed mockup docs/mockups/2026-11-02-e5-refugee-posts-mockup.html).
  // A simple SVG silhouette, not the officer art (plan Global Constraints): one head and shoulders under one of four
  // hair shapes (RefugeeRecord.portrait.hair), colored by one of eight palettes (portrait.palette). Decorative: the
  // person's name always sits beside it, so the image is aria-hidden.

  export let hair: number = 0;
  export let palette: number = 0;
  export let size: number = 34;

  // The eight color sets, as drawn in the mockup (.p1 to .p8): backdrop, skin, hair, clothing.
  const PALETTES: readonly { bg: string; skin: string; hair: string; cloth: string }[] = [
    { bg: "#12304a", skin: "#c99a76", hair: "#2b1b14", cloth: "#2f7f8f" },
    { bg: "#24203f", skin: "#8a5a3c", hair: "#0e0d12", cloth: "#6f5bb5" },
    { bg: "#13352c", skin: "#e3bf9f", hair: "#b88a3c", cloth: "#3a8f6e" },
    { bg: "#3a2418", skin: "#6b4430", hair: "#d9d4cc", cloth: "#a66a3a" },
    { bg: "#1a2c3c", skin: "#d6a985", hair: "#7a2e1e", cloth: "#4f86c6" },
    { bg: "#2c2a17", skin: "#b07d5a", hair: "#3d3a33", cloth: "#9a8b3a" },
    { bg: "#301a2a", skin: "#f0cfb2", hair: "#1d1d24", cloth: "#a24f78" },
    { bg: "#172636", skin: "#9c6a4c", hair: "#5c5c64", cloth: "#5a7a8a" },
  ];

  $: p = PALETTES[((Math.floor(palette) % 8) + 8) % 8];
  $: h = ((Math.floor(hair) % 4) + 4) % 4;
</script>

<svg class="rp" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
  <rect width="32" height="32" fill={p.bg} />
  <path d="M5 32c0-6.5 4.8-10 11-10s11 3.5 11 10z" fill={p.cloth} />
  {#if h === 1}
    <!-- Long hair, behind the face. -->
    <path d="M9.6 12.5c0-5 2.9-7.5 6.4-7.5s6.4 2.5 6.4 7.5v8.5c-1 .6-1.8.8-2.4.8V14H12v7.8c-.6 0-1.4-.2-2.4-.8z" fill={p.hair} />
  {/if}
  <path d="M13.5 19h5v4h-5z" fill={p.skin} />
  <ellipse cx="16" cy={h === 1 ? 13.8 : 13.5} rx={h === 1 ? 5.2 : 5.6} ry={h === 1 ? 6.2 : 6.4} fill={p.skin} />
  {#if h === 0}
    <!-- Short crop. -->
    <path d="M10.2 13c-.4-5 2.5-7.6 5.8-7.6s6.3 2.4 5.8 7.6c-1-2.6-3-3.6-5.8-3.6s-4.8 1-5.8 3.6z" fill={p.hair} />
  {:else if h === 1}
    <path d="M10.6 12c.8-3.4 3-5 5.4-5s4.8 1.6 5.4 5c-1.8-1.6-3.6-2.2-5.4-2.2s-3.6.6-5.4 2.2z" fill={p.hair} />
  {:else if h === 2}
    <!-- A top knot. -->
    <circle cx="16" cy="6.2" r="3" fill={p.hair} />
    <path d="M10.4 12.4c.4-3.8 2.8-5.2 5.6-5.2s5.2 1.4 5.6 5.2c-1.6-1.4-3.4-2-5.6-2s-4 .6-5.6 2z" fill={p.hair} />
  {:else}
    <!-- A beard and a short crop. -->
    <path d="M11.2 16.4c1.2 3.2 2.8 4.4 4.8 4.4s3.6-1.2 4.8-4.4c.4 3.4-1.6 5.6-4.8 5.6s-5.2-2.2-4.8-5.6z" fill={p.hair} />
    <path d="M10.6 11.2c.6-3 2.6-4.6 5.4-4.6s4.8 1.6 5.4 4.6c-1.8-.8-3.6-1.2-5.4-1.2s-3.6.4-5.4 1.2z" fill={p.hair} />
  {/if}
</svg>

<style>
  .rp {
    display: block;
    flex: 0 0 auto;
    border-radius: var(--corner);
    border: 1px solid rgba(var(--color-accent-rgb), 0.3);
    box-sizing: border-box;
  }
</style>
