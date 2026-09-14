<script lang="ts">
  // PatchNotesPage: the public, full patch-notes page on the site, served at
  // /game/hl/patch-notes (see Root.svelte). Reached from the Landing page's
  // "Latest Updates" section, and linked to from the in-game Patch Notes tab and
  // (by hand) the Discord blurb, so this page is the canonical home for the full
  // notes as they grow past what a Discord post or the in-game tab wants to hold.
  //
  // Reuses the game's visual language exactly like Landing.svelte (shared
  // Starfield, app.css tokens, the Orbitron/Space Grotesk stack) and the one
  // shared PatchNotesEntry renderer, so the site and the game show identical notes.
  import Starfield from "./lib/Starfield.svelte";
  import PatchNotesEntry from "./lib/PatchNotesEntry.svelte";
  import { APP_VERSION, PATCH_NOTES } from "./lib/patchNotes";

  export let navigate: (to: string) => void;
</script>

<div class="pnp" data-theme="cyan">
  <Starfield />

  <main class="pnp-inner">
    <header class="pnp-head">
      <button class="pnp-back" on:click={() => navigate("/game/hl")}>&larr; Back</button>
      <h1 class="pnp-title">Patch Notes</h1>
      <span class="pnp-ver">v{APP_VERSION}</span>
    </header>

    <div class="pnp-list">
      {#each PATCH_NOTES as entry, i (i)}
        <section class="pnp-card">
          <PatchNotesEntry {entry} />
        </section>
      {/each}
    </div>

    <footer class="pnp-footer">
      <span>Hyperion Legacy</span>
      <span class="pnp-dot">&middot;</span>
      <span>prototype build v{APP_VERSION}</span>
    </footer>
  </main>
</div>

<style>
  .pnp {
    position: relative;
    min-height: 100vh;
    min-height: 100dvh;
    background: linear-gradient(180deg, var(--color-bg-deep) 0%, var(--color-bg-mid) 60%, #081018 100%);
    color: var(--color-text-primary);
    font-family: var(--font-body);
    overflow-x: hidden;
  }
  .pnp-inner {
    position: relative;
    z-index: 1;
    max-width: 820px;
    margin: 0 auto;
    padding: 40px 20px 60px;
  }
  .pnp-head {
    display: flex;
    align-items: baseline;
    gap: 16px;
    padding-bottom: 18px;
    margin-bottom: 28px;
    border-bottom: 1px solid var(--color-border-strong);
  }
  .pnp-back {
    font-family: var(--font-mono);
    font-size: 0.82rem;
    color: var(--color-text-secondary);
    background: var(--color-panel-bg);
    border: 1px solid var(--color-border);
    border-radius: var(--corner);
    padding: 7px 13px;
    cursor: pointer;
    transition: color 0.12s ease, border-color 0.12s ease;
  }
  .pnp-back:hover {
    color: var(--color-accent);
    border-color: var(--color-border-strong);
  }
  .pnp-title {
    font-family: var(--font-display);
    font-weight: 700;
    font-size: clamp(1.6rem, 5vw, 2.4rem);
    margin: 0;
    color: var(--color-text-primary);
  }
  .pnp-ver {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: 0.85rem;
    color: var(--color-accent);
  }

  .pnp-list {
    display: flex;
    flex-direction: column;
    gap: 40px;
  }
  /* Each release sits in a faint bordered card so a long history reads as
     distinct entries rather than one endless column. */
  .pnp-card {
    padding: 22px;
    border: 1px solid var(--color-border);
    border-radius: var(--corner);
    background: var(--color-panel-bg);
  }

  .pnp-footer {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 8px;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--color-text-dim);
    margin-top: 44px;
  }
  .pnp-dot {
    opacity: 0.6;
  }

  @media (max-width: 560px) {
    .pnp-card {
      padding: 16px 14px;
    }
    .pnp-inner {
      padding: 28px 14px 48px;
    }
  }
</style>
