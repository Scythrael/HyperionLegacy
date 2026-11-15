<script lang="ts">
  // FasterThanLight: the canvas host for the warp-streak background (ftlRenderer.ts). Used twice: behind
  // the whole game (Background.svelte) and as the live preview in the Configure window.
  //
  // It owns the canvas size (the backing store follows the element, the pixel ratio capped), stops the
  // motion while the tab is hidden or `paused`, and draws once as points when `still` (reduced motion).
  import { onDestroy, onMount } from "svelte";
  import { FtlRenderer, cappedDpr } from "./ftlRenderer";
  import type { FtlSettings, Rgb } from "./backgroundStyle";

  export let settings: FtlSettings;
  export let palette: readonly Rgb[];
  export let still: boolean = false;
  export let paused: boolean = false;
  // Bump to replay the Jump to warp burst (the Configure window does when Jump is switched on).
  export let jumpToken: number = 0;

  let canvas: HTMLCanvasElement;
  let renderer: FtlRenderer | null = null;
  let observer: ResizeObserver | null = null;
  let hidden = false;
  let seenJump = jumpToken;

  function sizeCanvas(): void {
    if (!renderer || !canvas) return;
    const r = canvas.getBoundingClientRect();
    const dpr = cappedDpr(window.devicePixelRatio || 1);
    const bw = Math.max(1, Math.round(r.width * dpr));
    const bh = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    renderer.resize(r.width, r.height, dpr);
  }

  function run(jump: boolean): void {
    if (!renderer) return;
    if (paused || hidden) renderer.stop();
    else renderer.start(jump);
  }

  function onVisibility(): void {
    hidden = document.visibilityState === "hidden";
    // Back from the background: re-measure (the viewport may have changed while hidden) before moving.
    if (!hidden) sizeCanvas();
    run(false);
  }

  // The browser rebuilt a discarded canvas (blank, default state): size it again and redraw.
  function onContextRestored(): void {
    sizeCanvas();
    run(false);
  }

  onMount(() => {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;
    renderer = new FtlRenderer(ctx, settings, palette);
    renderer.setStill(still);
    hidden = document.visibilityState === "hidden";
    sizeCanvas();
    if (typeof ResizeObserver === "function") {
      observer = new ResizeObserver(() => sizeCanvas());
      observer.observe(canvas);
    } else {
      window.addEventListener("resize", sizeCanvas);
    }
    document.addEventListener("visibilitychange", onVisibility);
    canvas.addEventListener("contextrestored", onContextRestored);
    run(settings.jumpOnStart);
  });

  onDestroy(() => {
    renderer?.stop();
    renderer = null;
    observer?.disconnect();
    canvas?.removeEventListener("contextrestored", onContextRestored);
    if (typeof window !== "undefined") {
      window.removeEventListener("resize", sizeCanvas);
      document.removeEventListener("visibilitychange", onVisibility);
    }
  });

  $: if (renderer) renderer.setSettings(settings);
  $: if (renderer) renderer.setPalette(palette);
  $: if (renderer) {
    renderer.setStill(still);
    run(false);
  }
  $: if (renderer) {
    // paused flips: stop or resume (no burst on resume)
    void paused;
    run(false);
  }
  $: if (renderer && jumpToken !== seenJump) {
    seenJump = jumpToken;
    run(true);
  }
</script>

<!-- Decoration: the Configure window labels its preview box instead. -->
<canvas bind:this={canvas} class="ftl-canvas" aria-hidden="true"></canvas>

<style>
  .ftl-canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
    pointer-events: none;
  }
</style>
