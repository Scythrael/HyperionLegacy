<script lang="ts">
  // TabHandoffOverlay: one game tab at a time (HOTFIX 0.13.11.5, ledger PF-3, src/lib/tabGuard.ts).
  //
  // mode "claiming": this tab is waiting (at most about a second) for an older game tab to hand over its latest
  //   save, so the game underneath is covered and a fresh-looking game never flashes up.
  // mode "retired": a newer tab took the game. This tab has stopped for good (it no longer runs or saves), and
  //   says so calmly. "Play here instead" reloads, which makes this the newest tab, so the game moves back here
  //   with all its progress (the other tab retires the same way).
  // mode "olderTab": a tab still running an OLDER build of the game (from before this fix, so it has no guard) wrote
  //   over the save. This tab has already saved its own progress back; the window asks the player to close that tab.
  //   "Got it" closes the window (dispatches "dismiss"); it comes back if the older tab writes again.
  //
  // Portaled to <body> and styled like CatchUpOverlay (same layer, theme tokens only, SVG icon). Focus is trapped
  // inside; Escape does nothing, since there is nothing to close.
  import { createEventDispatcher, onMount, tick } from "svelte";
  import Icon from "./ui/Icon.svelte";
  import { focusTrap } from "./focusTrap";

  export let mode: "claiming" | "retired" | "olderTab";

  const dispatch = createEventDispatcher<{ dismiss: void }>();

  let dialog: HTMLDivElement;

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy() { node.remove(); } };
  }

  function playHere(): void {
    window.location.reload();
  }

  onMount(() => {
    void tick().then(() => dialog?.focus());
  });
</script>

<div class="th-backdrop" class:th-opaque={mode === "claiming"} use:portal>
  <div
    class="th-dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="tab-handoff-title"
    aria-describedby="tab-handoff-detail"
    aria-busy={mode === "claiming" ? "true" : "false"}
    tabindex="-1"
    bind:this={dialog}
    use:focusTrap={() => {}}
  >
    <div class="th-head">
      <span class="th-glyph"><Icon name={mode === "claiming" ? "clock" : mode === "olderTab" ? "warning" : "ship"} size={18} /></span>
      <span class="th-title" id="tab-handoff-title">{mode === "claiming" ? "Opening your fleet" : mode === "olderTab" ? "Another game tab is open" : "Playing in another tab"}</span>
    </div>
    {#if mode === "claiming"}
      <p class="th-detail" id="tab-handoff-detail">Your game is open in another tab. Moving it here with all its progress.</p>
    {:else if mode === "olderTab"}
      <p class="th-detail" id="tab-handoff-detail">Another tab is running an older version of the game and saved over your progress. This tab has put your progress back.</p>
      <p class="th-note">Please close the other game tab, or reload it to update it, so it cannot save over this one again.</p>
      <div class="th-actions">
        <button class="th-btn" type="button" on:click={() => dispatch("dismiss")}>Got it</button>
      </div>
    {:else}
      <p class="th-detail" id="tab-handoff-detail">Your fleet moved to the tab you opened most recently, with all its progress. You can close this one.</p>
      <p class="th-note">The game runs in one tab at a time, so two tabs can never overwrite each other's progress.</p>
      <div class="th-actions">
        <button class="th-btn" type="button" on:click={playHere}>Play here instead</button>
      </div>
    {/if}
  </div>
</div>

<style>
  .th-backdrop {
    position: fixed;
    inset: 0;
    /* The catch-up window's layer (CatchUpOverlay): above every game layer and modal. */
    z-index: 1850;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    background: rgba(4, 6, 10, 0.72);
  }
  /* While claiming, the game behind has not loaded yet (a fresh-looking default state): hide it completely. */
  .th-opaque {
    background: var(--color-bg-deep, #04060a);
  }
  .th-dialog {
    width: 100%;
    max-width: 420px;
    box-sizing: border-box;
    padding: 16px;
    background: var(--color-bg-mid);
    border: 1px solid rgba(var(--color-accent-rgb), 0.4);
    border-radius: var(--corner);
    box-shadow: 0 18px 50px rgba(0, 0, 0, 0.6);
    color: var(--color-text-primary);
    outline: none;
  }
  .th-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
  }
  .th-glyph {
    display: inline-flex;
    color: var(--color-accent);
  }
  .th-title {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--color-accent-bright);
  }
  .th-detail {
    margin: 0;
    font-size: var(--text-md);
    line-height: 1.4;
  }
  .th-note {
    margin: 12px 0 0;
    font-size: var(--text-xs);
    line-height: 1.4;
    color: var(--color-text-secondary);
  }
  .th-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 14px;
  }
  .th-btn {
    min-height: 36px;
    padding: 6px 16px;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    letter-spacing: 0.06em;
    color: var(--color-text-primary);
    background: rgba(var(--color-accent-rgb), 0.16);
    border: 1px solid rgba(var(--color-accent-rgb), 0.5);
    border-radius: var(--corner);
    cursor: pointer;
  }
  .th-btn:hover {
    background: rgba(var(--color-accent-rgb), 0.26);
  }
  .th-btn:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
</style>
