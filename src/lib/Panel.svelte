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
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
  }
  .dev-panel {
    border-color: rgba(251, 191, 36, 0.5);
  }
</style>
