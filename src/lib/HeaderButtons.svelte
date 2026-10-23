<script lang="ts">
  // HeaderButtons: the button block where the gear used to be (0.13.11.1, design section 3,
  // mockup frame 3b).
  //
  // Before any minigame is found: Help [?] fills the top half and Settings is a half-height bar
  // underneath. After the first find: Help shrinks to a square, the Minigames button (controller)
  // appears to its right and opens a small list with a Play button per minigame. Settings stays the
  // bar. (A future fourth button would make a 2x2 grid; not now.)
  //
  // Help opens the existing Help center, Settings opens the System window, Play opens the minigame.
  // Every control is a real button with a label; the list closes on Escape, on a click outside it,
  // and after Play, and focus returns to the Minigames button.
  import { tick } from "svelte";
  import Icon from "./ui/Icon.svelte";

  export let found: boolean;
  export let minigameTitle: string;
  export let minigameStatus: string;
  export let onHelp: () => void;
  export let onSettings: () => void;
  export let onPlay: () => void;

  let menuOpen = false;
  let block: HTMLDivElement | null = null;
  let toggle: HTMLButtonElement | null = null;
  let playButton: HTMLButtonElement | null = null;

  async function openMenu(): Promise<void> {
    menuOpen = true;
    await tick();
    playButton?.focus();
  }

  function closeMenu(returnFocus = true): void {
    if (!menuOpen) return;
    menuOpen = false;
    if (returnFocus) toggle?.focus();
  }

  function play(): void {
    closeMenu(false);
    onPlay();
  }

  function onWindowKeydown(event: KeyboardEvent): void {
    if (menuOpen && event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
    }
  }

  function onWindowPointerdown(event: PointerEvent): void {
    if (menuOpen && block && event.target instanceof Node && !block.contains(event.target)) closeMenu(false);
  }
</script>

<svelte:window on:keydown={onWindowKeydown} on:pointerdown={onWindowPointerdown} />

<div class="hb" class:hb-found={found} bind:this={block}>
  <button type="button" class="hb-btn hb-help" aria-label="Help" title="Help" on:click={onHelp}>
    <Icon name="help" size={18} />
  </button>
  {#if found}
    <button
      type="button"
      class="hb-btn hb-minigames"
      aria-label="Minigames"
      title="Minigames"
      aria-haspopup="true"
      aria-expanded={menuOpen}
      aria-controls="hb-menu"
      bind:this={toggle}
      on:click={() => (menuOpen ? closeMenu() : openMenu())}
    >
      <Icon name="controller" size={20} />
    </button>
  {/if}
  <button type="button" class="hb-btn hb-settings" aria-label="Open settings" on:click={onSettings}>
    <Icon name="gear" size={11} /><span>SETTINGS</span>
  </button>

  {#if found && menuOpen}
    <section class="hb-menu" id="hb-menu" aria-label="Minigames">
      <div class="hb-menu-title">MINIGAMES</div>
      <div class="hb-game">
        <div class="hb-game-text">
          <b>{minigameTitle}</b>
          <span>{minigameStatus}</span>
        </div>
        <button type="button" class="hb-play" bind:this={playButton} on:click={play} aria-label={`Play ${minigameTitle}`}>Play</button>
      </div>
    </section>
  {/if}
</div>

<style>
  .hb {
    position: relative;
    display: grid;
    grid-template-columns: 76px;
    grid-template-rows: 36px 18px;
    gap: 4px;
  }
  .hb.hb-found {
    grid-template-columns: 36px 36px;
  }
  .hb-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 0;
    color: var(--color-accent);
    background: var(--color-panel-bg-strong);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--corner);
    cursor: pointer;
  }
  .hb-btn:hover {
    background: rgba(var(--color-accent-rgb), 0.16);
  }
  .hb-btn:focus-visible,
  .hb-play:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
  .hb-minigames[aria-expanded="true"] {
    border-color: var(--color-accent);
    box-shadow: 0 0 0 2px rgba(var(--color-accent-rgb), 0.25);
  }
  /* The half-height bar: the whole bar is the button, full width of the block. */
  .hb-settings {
    grid-column: 1 / -1;
    font-family: var(--font-display);
    font-size: var(--text-3xs);
    letter-spacing: 0.14em;
  }
  .hb-menu {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 30;
    width: min(260px, calc(100vw - 32px));
    display: grid;
    gap: 6px;
    padding: 8px;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--corner);
    background: linear-gradient(rgba(var(--color-accent-rgb), 0.06), rgba(var(--color-accent-rgb), 0.06)), var(--color-bg-mid);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
  }
  .hb-menu-title {
    font-family: var(--font-display);
    font-size: var(--text-2xs);
    letter-spacing: 0.16em;
    color: var(--color-accent);
  }
  .hb-game {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 8px;
    border: 1px solid var(--color-border);
    border-radius: var(--corner);
    background: rgba(0, 0, 0, 0.2);
  }
  .hb-game-text {
    min-width: 0;
    flex: 1;
  }
  .hb-game-text b {
    display: block;
    font-weight: 600;
    font-size: var(--text-sm);
    color: var(--color-text-primary);
    overflow-wrap: anywhere;
  }
  .hb-game-text span {
    display: block;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }
  .hb-play {
    min-height: 36px;
    padding: 4px 12px;
    font-family: var(--font-body);
    font-size: var(--text-sm);
    color: var(--color-text-primary);
    background: rgba(var(--color-accent-rgb), 0.18);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--corner);
    cursor: pointer;
  }
</style>
