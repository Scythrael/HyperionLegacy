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
    filter: drop-shadow(0 0 8px rgba(var(--color-accent-rgb), 0.35));
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
     point), so its long (10px) edge runs parallel to the clip-path cut
     line rather than crossing it. That means the clip-path doesn't trim
     a small corner off each end — it slices along the bar's full length,
     cutting away the outer half of its 2px thickness and leaving roughly
     a 1px-wide visible line flush against the inside of the chamfer cut.
     This is expected and is why the bars read as thin accent lines rather
     than solid 2px bars. Don't widen these bars or change the 2px/6px
     offsets without re-deriving this against the 14px chamfer cut in
     .panel above — it's easy to shift the surviving sliver to the wrong
     side of the cut, or clip it away entirely. */
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
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    margin-bottom: 16px;
  }
  .dev-panel {
    border-color: rgba(251, 191, 36, 0.5);
  }
</style>
