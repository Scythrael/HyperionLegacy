<script lang="ts">
  const stars = Array.from({ length: 80 }, () => ({
    x: Math.random() * 100,
    y: Math.random() * 100,
    s: Math.random() * 1.6 + 0.4,
    d: Math.random() * 25 + 20,
  }));
</script>

<div class="starfield" aria-hidden="true">
  {#each stars as star}
    <div
      class="star"
      style="left:{star.x}%; top:{star.y}%; width:{star.s}px; height:{star.s}px; animation-duration:{star.d}s;"
    ></div>
  {/each}
</div>

<style>
  .starfield {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }
  .star {
    position: absolute;
    border-radius: 50%;
    /* Default ambient starfield only: a subtle per-theme tint so the background
       meshes with the chosen theme (see --color-starfield in app.css). Future
       selectable background styles (sub-light streak, warp) must set their OWN
       fixed colors here instead, not this token. */
    background: var(--color-starfield);
    opacity: 0.5;
    animation-name: drift;
    animation-timing-function: linear;
    animation-iteration-count: infinite;
  }
  @keyframes drift {
    from { transform: translateY(0px); }
    to { transform: translateY(-40px); }
  }
</style>
