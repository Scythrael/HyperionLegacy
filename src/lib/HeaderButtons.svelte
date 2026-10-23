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
  // when focus leaves it, and after Play, and focus returns to the Minigames button.
  //
  // The list is PORTALED to <body> (user, staging: it clipped under the content below the header):
  // the top bar is its own stacking context, so nothing inside it can rise above the page. On the
  // body, fixed under the button and re-placed on resize and scroll, it sits above every panel and
  // the bottom nav.
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
  let menu: HTMLElement | null = null;

  // Moves the list to <body> and keeps it anchored under the Minigames button.
  function floating(node: HTMLElement) {
    document.body.appendChild(node);
    const place = () => {
      const r = toggle?.getBoundingClientRect();
      if (!r) return;
      node.style.top = `${Math.round(r.bottom + 6)}px`;
      node.style.right = `${Math.max(8, Math.round(window.innerWidth - r.right))}px`;
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return {
      destroy() {
        window.removeEventListener("resize", place);
        window.removeEventListener("scroll", place, true);
        node.remove();
      },
    };
  }

  const inside = (n: Node | null) => n !== null && ((block?.contains(n) ?? false) || (menu?.contains(n) ?? false));

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

  // Focus leaving the block (Tab past the list) closes it.
  function onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (menuOpen && next instanceof Node && !inside(next)) closeMenu(false);
  }

  function onWindowPointerdown(event: PointerEvent): void {
    if (menuOpen && event.target instanceof Node && !inside(event.target)) closeMenu(false);
  }
</script>

<svelte:window on:keydown={onWindowKeydown} on:pointerdown={onWindowPointerdown} />

<div class="hb" class:hb-found={found} bind:this={block} on:focusout={onFocusOut}>
  <button type="button" class="hb-btn hb-help" aria-label="Help" title="Help" on:click={onHelp}>
    <Icon name="help" size={22} />
  </button>
  {#if found}
    <button
      type="button"
      class="hb-btn hb-minigames"
      aria-label="Minigames"
      title="Minigames"
      aria-expanded={menuOpen}
      aria-controls={menuOpen ? "hb-menu" : undefined}
      bind:this={toggle}
      on:click={() => (menuOpen ? closeMenu() : openMenu())}
    >
      <Icon name="controller" size={20} />
    </button>
  {/if}
  <!-- The half-height bar carries the word only: the gear glyph is for a square Settings button (full
       or quarter size, the future 2x2 block), user 2026-10-23 "remove the gear when the button is half
       of that space". -->
  <button type="button" class="hb-btn hb-settings" aria-label="Open settings" on:click={onSettings}>
    <span>SETTINGS</span>
  </button>
</div>

{#if found && menuOpen}
    <section class="hb-menu" id="hb-menu" aria-label="Minigames" bind:this={menu} use:floating on:focusout={onFocusOut}>
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

<style>
  /* Two equal rows (user, 2026-10-23: Settings takes HALF the height) and two columns that grow
     with the word SETTINGS if the text size goes up, so the word always sits inside the bar. */
  .hb {
    position: relative;
    display: grid;
    grid-template-columns: repeat(2, minmax(38px, auto));
    grid-template-rows: 30px 30px;
    gap: 4px;
  }
  /* Before the first find, Help spans the whole top row. */
  .hb:not(.hb-found) .hb-help {
    grid-column: 1 / -1;
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
    letter-spacing: 0.1em;
    line-height: 1;
    padding: 0 6px;
    white-space: nowrap;
  }
  /* On <body>, fixed under the button (floating), above every panel and the bottom nav; below the
     minigame overlay (2000) and the achievement popup (2100). */
  .hb-menu {
    position: fixed;
    z-index: 1900;
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
