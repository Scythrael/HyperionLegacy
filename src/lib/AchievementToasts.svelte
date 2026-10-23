<script lang="ts">
  // AchievementToasts: the achievement popup (0.13.11.1, design section 5, mockup frame 8).
  //
  // Mounted ONCE at the top of App, above the minigame overlay, so a popup shows over the minigame
  // when it is open and over the main game when it is not. One at a time from the queue
  // (achievements.ts): it slides in, stays about four seconds (paused while the pointer or focus is
  // on it, so nobody is rushed), then fades; a tap, click, Enter or Space dismisses it at once.
  // The wrapper is a polite live region, so a screen reader hears it without losing its place.
  // Motion only when the player has not asked for less (the OS setting or the in-game toggle).
  import { onDestroy } from "svelte";
  import { achievementQueue, dismissAchievement, ACHIEVEMENT_SHOW_MS, type Achievement } from "./achievements";

  const FADE_MS = 300;

  $: current = $achievementQueue[0] as Achievement | undefined;

  let shownId: string | null = null;
  let leaving = false;
  let paused = false;
  let remaining = ACHIEVEMENT_SHOW_MS;
  let startedAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function clearTimer(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function finish(): void {
    clearTimer();
    const id = shownId;
    leaving = false;
    if (id !== null) dismissAchievement(id);
  }

  function schedule(): void {
    clearTimer();
    if (paused || shownId === null) return;
    startedAt = Date.now();
    timer = setTimeout(() => {
      leaving = true;
      timer = setTimeout(finish, FADE_MS);
    }, Math.max(0, remaining - FADE_MS));
  }

  $: if ((current?.id ?? null) !== shownId) {
    shownId = current?.id ?? null;
    leaving = false;
    remaining = ACHIEVEMENT_SHOW_MS;
    schedule();
  }

  function pause(): void {
    if (paused || leaving) return;
    paused = true;
    remaining = Math.max(FADE_MS, remaining - (Date.now() - startedAt));
    clearTimer();
  }

  function resume(): void {
    if (!paused) return;
    paused = false;
    schedule();
  }

  onDestroy(clearTimer);
</script>

<div class="ach-host" role="status" aria-live="polite" aria-atomic="true">
  {#if current}
    {#key current.id}
      <button
        type="button"
        class="ach"
        class:leaving
        title="Dismiss"
        on:click={finish}
        on:pointerenter={pause}
        on:pointerleave={resume}
        on:focus={pause}
        on:blur={resume}
      >
        <span class="ach-title">Achievement obtained: {current.title}</span>
        <span class="ach-req">{current.requirement}</span>
        {#if current.flavor}<span class="ach-flavor">"{current.flavor}"</span>{/if}
        <span class="ach-reward">{current.reward}</span>
      </button>
    {/key}
  {/if}
</div>

<style>
  .ach-host {
    position: fixed;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    width: min(420px, calc(100% - 32px));
    z-index: 2100;
    pointer-events: none;
  }
  .ach {
    pointer-events: auto;
    display: grid;
    gap: 3px;
    width: 100%;
    text-align: left;
    padding: 10px 12px;
    border: 1px solid color-mix(in srgb, var(--color-success) 50%, transparent);
    border-radius: var(--corner);
    background: color-mix(in srgb, var(--color-bg-mid) 96%, transparent);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    color: var(--color-text-primary);
    font-family: var(--font-body);
    cursor: pointer;
  }
  .ach:focus-visible {
    outline: 2px solid var(--color-accent-bright);
    outline-offset: 2px;
  }
  .ach.leaving {
    opacity: 0;
  }
  .ach-title {
    font-family: var(--font-display);
    font-size: var(--text-sm);
    letter-spacing: 0.08em;
    color: var(--color-accent-bright);
  }
  .ach-req {
    font-size: var(--text-sm);
  }
  .ach-flavor {
    font-size: var(--text-sm);
    font-style: italic;
    color: var(--color-text-secondary);
  }
  .ach-reward {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--color-success);
  }
  /* Motion only when welcome: the OS setting (this query) AND the in-game toggle (the root attribute). */
  @media (prefers-reduced-motion: no-preference) {
    :global(:root:not([data-reduced-motion="on"])) .ach {
      animation: ach-in 0.3s ease-out;
      transition: opacity 0.3s ease-in;
    }
    @keyframes ach-in {
      from {
        transform: translateY(-14px);
        opacity: 0;
      }
    }
  }
</style>
