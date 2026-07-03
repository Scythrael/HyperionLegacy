<script lang="ts">
  let className = "";
  export { className as class };
</script>

<section class="panel {className}">
  <slot />
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
</style>
