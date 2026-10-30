<script lang="ts">
  // Background: what sits behind the whole game (0.14.0 Slice 5b, the background visualization track).
  // Default renders today's backdrop, the ambient Starfield, exactly as before. Faster Than Light
  // renders the warp streaks with a readability guard: a soft scrim over the canvas here, and nearly
  // opaque panels from app.css (data-background on the root, backgroundStyle.ts applyBackground).
  import Starfield from "./Starfield.svelte";
  import FasterThanLight from "./FasterThanLight.svelte";
  import type { BackgroundId, FtlSettings, Rgb } from "./backgroundStyle";

  export let id: BackgroundId;
  export let settings: FtlSettings;
  export let palette: readonly Rgb[];
  export let still: boolean = false;
  export let paused: boolean = false;
</script>

{#if id === "fasterThanLight"}
  <div class="bg-layer" aria-hidden="true">
    <FasterThanLight {settings} {palette} {still} {paused} />
    <div class="bg-guard"></div>
  </div>
{:else}
  <Starfield />
{/if}

<style>
  .bg-layer {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }
  /* The readability guard: dims the streaks a little everywhere, a little more toward the edges where
     the header and the tab bar sit, so loose text never fights the motion. Static, so it costs nothing
     per frame. */
  .bg-guard {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(ellipse at center, rgba(3, 5, 11, 0) 35%, rgba(3, 5, 11, 0.35) 100%),
      rgba(3, 5, 11, 0.22);
  }
</style>
