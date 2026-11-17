<script lang="ts">
  // CatchUpOverlay: the progress window a long catch-up runs behind (HOTFIX 0.13.11.4, see
  // src/lib/game/catchUpRunner.ts). Shown only while an asynchronous catch-up is in flight; it blocks
  // the game underneath (App.svelte also makes the game inert) and reports real progress. It has no
  // controls: the catch-up cannot be skipped or canceled, and closing the tab is always safe (the
  // last save is untouched while it runs, so the next load simply catches up again).
  //
  // `failed` (never expected: a catch-up threw): the window stays up with one Reload button. Nothing
  // was paid and nothing is saved, so a reload catches up again from the last save.
  //
  // Portaled to <body> (the ActionModal idiom) so no transformed or clipped ancestor can trap it, and
  // drawn above every game layer (see the z-index note in the styles). Colors come from the theme tokens
  // only; the glyph is the shared SVG clock via Icon. Focus is trapped inside (focusTrap); Escape does
  // nothing, since there is nothing to close.
  import { onMount, tick } from "svelte";
  import Icon from "./ui/Icon.svelte";
  import { focusTrap } from "./focusTrap";
  import { catchUpPercent, type CatchUpView } from "./game/catchUpRunner";

  export let view: CatchUpView | null;
  export let failed = false;

  $: percent = view ? catchUpPercent(view) : 0;

  let dialog: HTMLDivElement;

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy() { node.remove(); } };
  }

  function reload(): void {
    window.location.reload();
  }

  // Focus moves onto the window (the game behind it is inert), so a screen reader lands on it. After a
  // tick: the window is portaled to <body> after it renders, and moving a node drops its focus.
  onMount(() => {
    void tick().then(() => dialog?.focus());
  });
</script>

<div class="cu-backdrop" use:portal>
  <div
    class="cu-dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="catch-up-title"
    aria-describedby="catch-up-detail"
    aria-busy={failed ? "false" : "true"}
    tabindex="-1"
    bind:this={dialog}
    use:focusTrap={() => {}}
  >
    <div class="cu-head">
      <span class="cu-glyph"><Icon name="clock" size={18} /></span>
      <span class="cu-title" id="catch-up-title">{failed ? "Catch-up failed" : "Catching up"}</span>
    </div>
    {#if failed}
      <p class="cu-detail" id="catch-up-detail">Catching up failed. Reload to try again.</p>
      <p class="cu-note">Your last save is safe. Nothing was saved while catching up.</p>
      <div class="cu-actions">
        <button class="cu-reload" type="button" on:click={reload}>Reload</button>
      </div>
    {:else if view}
      <p class="cu-detail" id="catch-up-detail">{view.detail}</p>
      <div class="cu-bar-row">
        <div
          class="cu-bar"
          role="progressbar"
          aria-label="Catch-up progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-valuetext="{percent} percent"
        >
          <span class="cu-fill" style="width: {percent}%"></span>
        </div>
        <span class="cu-percent" aria-hidden="true">{percent}%</span>
      </div>
      <p class="cu-note">Your progress is safe. If you close the game now, it catches up again next time.</p>
    {/if}
  </div>
</div>

<style>
  .cu-backdrop {
    position: fixed;
    inset: 0;
    /* Above every game layer and modal. Below only the Minigames list (1900), the minigame window (2000)
       and the toasts (2100), which the user placed above everything. The minigame is a separate game
       with its own save; the Enter Code window (the one place it writes into this game) is an
       ActionModal (1000), so it sits under this window, inert while it is up (catchUpGate.ts), and
       focus moves here. */
    z-index: 1850;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    background: rgba(4, 6, 10, 0.72);
  }
  .cu-dialog {
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
  .cu-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
  }
  .cu-glyph {
    display: inline-flex;
    color: var(--color-accent);
  }
  .cu-title {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--color-accent-bright);
  }
  .cu-detail {
    margin: 0 0 14px;
    font-size: var(--text-md);
    line-height: 1.4;
  }
  .cu-bar-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .cu-bar {
    flex: 1 1 auto;
    min-width: 0;
    height: 10px;
    overflow: hidden;
    background: rgba(var(--color-accent-rgb), 0.12);
    border: 1px solid rgba(var(--color-accent-rgb), 0.35);
    border-radius: var(--corner);
  }
  .cu-fill {
    display: block;
    height: 100%;
    background: var(--color-accent);
    transition: width 120ms linear;
  }
  @media (prefers-reduced-motion: reduce) {
    .cu-fill {
      transition: none;
    }
  }
  .cu-percent {
    flex: 0 0 auto;
    min-width: 4ch;
    text-align: right;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--color-text-primary);
  }
  .cu-note {
    margin: 12px 0 0;
    font-size: var(--text-xs);
    line-height: 1.4;
    color: var(--color-text-secondary);
  }
  .cu-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 14px;
  }
  .cu-reload {
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
  .cu-reload:hover {
    background: rgba(var(--color-accent-rgb), 0.26);
  }
  .cu-reload:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
</style>
