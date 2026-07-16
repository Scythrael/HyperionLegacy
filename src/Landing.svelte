<script lang="ts">
  // Landing.svelte -- the public marketing page served at "/" (see Root.svelte).
  //
  // Deliberately reuses the GAME's visual language so the site reads as part of
  // the product, not a separate brochure: the shared Panel.svelte chamfered
  // panel, the app.css --color-* theme tokens, and the Orbitron/Space Grotesk
  // font stack. Nothing here touches game state -- it only renders copy, links,
  // and the latest patch notes, then hands control to the game via navigate().
  //
  // Props:
  //   navigate(to) -- Root.svelte's SPA push-state helper. The Play button
  //   calls navigate("/game/hl/play") to boot the game without a full page reload.
  import Panel from "./lib/Panel.svelte";
  import Starfield from "./lib/Starfield.svelte";
  import { APP_VERSION, PATCH_NOTES } from "./lib/patchNotes";

  export let navigate: (to: string) => void;

  // Show only the newest 2-3 releases as a "what's new" strip. PATCH_NOTES is
  // newest-first, so slicing the head gives the most recent entries. Summaries
  // in the source are long-form; the strip trims them to a readable teaser so
  // the landing stays scannable (full text still lives in the in-game tab).
  const NEWS_TEASER_MAX = 180;
  const latestNotes = PATCH_NOTES.slice(0, 3).map((note) => ({
    version: note.version,
    teaser:
      note.summary.length > NEWS_TEASER_MAX
        ? note.summary.slice(0, NEWS_TEASER_MAX).trimEnd() + "…"
        : note.summary,
  }));

  function handlePlay() {
    navigate("/game/hl/play");
  }
</script>

<div class="landing" data-theme="cyan">
  <Starfield />

  <main class="landing-inner">
    <!-- HERO -------------------------------------------------------------- -->
    <section class="hero">
      <div class="hero-eyebrow">FLEET COMMAND // IDLE</div>
      <h1 class="hero-title">Hyperion Legacy</h1>
      <!-- TAGLINE (flagged for user approval) -->
      <p class="hero-tagline">
        Command a fleet across the dark &mdash; dispatch captains, mine the
        sector, and build your way to the stars, even while you sleep.
      </p>

      <div class="hero-actions">
        <button class="btn-play" on:click={handlePlay}>
          <span class="btn-play-label">Play Now</span>
          <span class="btn-play-arrow">&rarr;</span>
        </button>
      </div>

      <!-- LINKS ROW: community links; room reserved for future socials. -->
      <div class="links-row" aria-label="Community links">
        <a
          class="link-chip"
          href="https://discord.gg/rcY7uqchTC"
          target="_blank"
          rel="noopener noreferrer"
        >
          <span class="link-chip-label">Discord</span>
        </a>
      </div>
    </section>

    <!-- BLURB ------------------------------------------------------------- -->
    <!-- BLURB COPY (flagged for user approval) -->
    <section class="blurb">
      <Panel>
        <p class="blurb-text">
          Hyperion Legacy is a fleet-management idle game. Dispatch captains on
          missions across the sector, grow a self-sufficient homeworld economy,
          and work your way up to building starships of your own &mdash;
          progress ticks onward whether you're watching or away.
        </p>
      </Panel>
    </section>

    <!-- PATCH-NOTES STRIP ------------------------------------------------- -->
    <section class="news">
      <div class="news-head">
        <h2 class="news-title">Latest Updates</h2>
        <span class="news-version">v{APP_VERSION}</span>
      </div>

      <div class="news-grid">
        {#each latestNotes as note}
          <Panel class="news-card">
            <div class="news-card-version">{note.version}</div>
            <p class="news-card-teaser">{note.teaser}</p>
          </Panel>
        {/each}
      </div>
    </section>

    <footer class="landing-footer">
      <span>Hyperion Legacy</span>
      <span class="footer-dot">&middot;</span>
      <span>prototype build v{APP_VERSION}</span>
    </footer>
  </main>
</div>

<style>
  /* The landing owns the full viewport and centers a single readable column.
     Background gradient mirrors app.css's body so the page and the game share
     the same deep-space backdrop even before the game mounts. */
  .landing {
    position: relative;
    min-height: 100vh;
    min-height: 100dvh;
    background: linear-gradient(
      180deg,
      var(--color-bg-deep) 0%,
      var(--color-bg-mid) 60%,
      #081018 100%
    );
    color: var(--color-text-primary);
    font-family: var(--font-body);
    overflow-x: hidden;
  }

  .landing-inner {
    position: relative; /* sits above the fixed Starfield canvas */
    z-index: 1;
    max-width: 960px;
    margin: 0 auto;
    padding: 48px 20px 40px;
    display: flex;
    flex-direction: column;
    gap: 44px;
  }

  /* --- HERO ---------------------------------------------------------------- */
  .hero {
    text-align: center;
    padding-top: 28px;
  }

  .hero-eyebrow {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    letter-spacing: 0.32em;
    color: var(--color-text-dim);
    margin-bottom: 18px;
  }

  .hero-title {
    font-family: var(--font-display);
    font-weight: 700;
    font-size: clamp(2.6rem, 8vw, 5rem);
    line-height: 1.02;
    margin: 0;
    color: var(--color-accent);
    text-shadow: 0 0 28px rgba(var(--color-accent-rgb), 0.45);
  }

  .hero-tagline {
    max-width: 620px;
    margin: 20px auto 0;
    font-size: clamp(1rem, 2.4vw, 1.25rem);
    line-height: 1.5;
    color: var(--color-text-secondary);
  }

  .hero-actions {
    margin-top: 34px;
  }

  /* Prominent primary CTA -- filled accent slab with the game's chamfer-free
     flat style (matches the post-0.9.0 flatter panel direction). */
  .btn-play {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    padding: 15px 38px;
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 1.05rem;
    letter-spacing: 0.08em;
    color: var(--color-bg-deep);
    background: var(--color-accent);
    border: 1px solid var(--color-accent-bright);
    cursor: pointer;
    transition:
      transform 0.12s ease,
      box-shadow 0.12s ease,
      background 0.12s ease;
    box-shadow: 0 0 24px rgba(var(--color-accent-rgb), 0.35);
  }
  .btn-play:hover {
    background: var(--color-accent-bright);
    transform: translateY(-2px);
    box-shadow: 0 0 34px rgba(var(--color-accent-rgb), 0.55);
  }
  .btn-play:active {
    transform: translateY(0);
  }
  .btn-play-arrow {
    font-size: 1.2rem;
    transition: transform 0.12s ease;
  }
  .btn-play:hover .btn-play-arrow {
    transform: translateX(4px);
  }

  /* --- LINKS ROW ----------------------------------------------------------- */
  .links-row {
    margin-top: 30px;
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    justify-content: center;
  }

  .link-chip {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 9px 16px;
    font-family: var(--font-mono);
    font-size: 0.82rem;
    border: 1px solid var(--color-border);
    background: var(--color-panel-bg);
  }
  .link-chip {
    color: var(--color-text-secondary);
    text-decoration: none;
    transition:
      color 0.12s ease,
      border-color 0.12s ease;
  }
  .link-chip:hover {
    color: var(--color-accent);
    border-color: var(--color-border-strong);
  }

  /* --- BLURB --------------------------------------------------------------- */
  .blurb-text {
    margin: 0;
    font-size: 1.02rem;
    line-height: 1.6;
    color: var(--color-text-primary);
    text-align: center;
  }

  /* --- NEWS / PATCH NOTES -------------------------------------------------- */
  .news-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 16px;
  }
  .news-title {
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 1.35rem;
    margin: 0;
    color: var(--color-text-primary);
  }
  .news-version {
    font-family: var(--font-mono);
    font-size: 0.85rem;
    color: var(--color-accent);
  }

  .news-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 14px;
  }
  /* :global -- .news-card is passed to Panel.svelte, which renders it on a
     child <section>; the class lands outside this component's scope, so the
     scoped selector wouldn't reach it without :global. */
  .news-grid :global(.news-card) {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .news-card-version {
    font-family: var(--font-mono);
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--color-accent);
  }
  .news-card-teaser {
    margin: 0;
    font-size: 0.9rem;
    line-height: 1.5;
    color: var(--color-text-secondary);
  }

  /* --- FOOTER -------------------------------------------------------------- */
  .landing-footer {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 8px;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--color-text-dim);
    padding-top: 8px;
  }
  .footer-dot {
    opacity: 0.6;
  }

  /* --- RESPONSIVE ---------------------------------------------------------- */
  @media (max-width: 720px) {
    .news-grid {
      grid-template-columns: 1fr;
    }
    .landing-inner {
      gap: 36px;
      padding: 32px 16px 32px;
    }
  }
</style>
