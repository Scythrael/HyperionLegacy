<script lang="ts">
  let className = "";
  export { className as class };
</script>

<section class="panel {className}">
  <slot />
  <span class="corner corner-tl" aria-hidden="true"></span>
  <span class="corner corner-tr" aria-hidden="true"></span>
  <span class="corner corner-bl" aria-hidden="true"></span>
  <span class="corner corner-br" aria-hidden="true"></span>
</section>

<style>
  .panel {
    position: relative;
    padding: 16px;
    background: var(--color-panel-bg);
    backdrop-filter: blur(10px);
    border: 1px solid var(--color-border);
    filter: drop-shadow(0 0 8px rgba(103, 232, 249, 0.35));
    clip-path: polygon(
      14px 0,
      calc(100% - 14px) 0,
      100% 14px,
      100% calc(100% - 14px),
      calc(100% - 14px) 100%,
      14px 100%,
      0 calc(100% - 14px),
      0 14px
    );
  }
  .corner {
    position: absolute;
    width: 12px;
    height: 2px;
    background: var(--color-accent-bright);
    pointer-events: none;
  }
  /* Each bar is centered on its chamfer cut's midpoint and rotated around
     its own center (no transform-origin override — default center is the
     point) so it stays inside the .panel clip-path with only ~0.6px of
     margin at width:10px. Don't widen these bars or shrink the 2px/6px
     offsets without re-deriving the margin against the 14px chamfer cut
     in .panel above — it's easy to push a corner back outside the
     clip-path and have it silently disappear. */
  .corner-tl {
    top: 6px;
    left: 2px;
    width: 10px;
    transform: rotate(-45deg);
  }
  .corner-tr {
    top: 6px;
    right: 2px;
    width: 10px;
    transform: rotate(45deg);
  }
  .corner-bl {
    bottom: 6px;
    left: 2px;
    width: 10px;
    transform: rotate(45deg);
  }
  .corner-br {
    bottom: 6px;
    right: 2px;
    width: 10px;
    transform: rotate(-45deg);
  }
</style>
