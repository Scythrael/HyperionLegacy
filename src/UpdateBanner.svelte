<script lang="ts">
  // UpdateBanner.svelte, dismissible "a new version is available" banner.
  //
  // Shows ONLY when the updateDetector poller flips `updateAvailable` to true
  // (a newer version.json id was seen than the one this tab booted with). It sits
  // as a fixed overlay across the very top of the viewport (mounted once in
  // Root.svelte) so it never disturbs App.svelte's hard 100dvh flex-column
  // layout, see Root.svelte's mount comment for why fixed (not in-flow).
  //
  // Three actions:
  //   Export save, downloads a raw save backup. Deliberately does NOT dismiss
  //                  the banner (a player exporting a backup still wants the
  //                  refresh prompt to stay put until they actually refresh).
  //   Refresh    , reloads the page to pick up the new build.
  //   Dismiss (x), snoozes via dismissUpdate(); the poller re-surfaces later.
  //
  // Visual recipe mirrors src/lib/Panel.svelte's frosted-glass panel and uses
  // ONLY theme CSS variables so it recolors with the player's chosen theme.
  import { updateAvailable, dismissUpdate } from "./lib/updateDetector";
  import { downloadRawSave } from "./lib/game/save";
</script>

{#if $updateAvailable}
  <div class="update-banner">
    <div class="banner-inner">
      <!-- Message block: leading icon + two lines of copy. flex:1 so it takes
           the remaining width on desktop and the whole width when stacked. -->
      <div class="msg">
        <svg class="lead-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <!-- Simple inline rocket (no icon-font dependency); currentColor = accent. -->
          <path
            d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <path
            d="M12 15l-3-3a22 22 0 0 1 8-10c1.5 0 3 0 4 1 1 1 1 2.5 1 4a22 22 0 0 1-10 8z"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <path
            d="M9 12H4s.5-1.9 2-3c1.03-.75 3-.75 3-.75M12 15v5s1.9-.5 3-2c.75-1.03.75-3 .75-3"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <div class="text">
          <div class="title">A new version of Hyperion Legacy is available</div>
          <div class="subline">Refresh to get the latest fixes. Your progress auto-saves.</div>
        </div>
      </div>

      <!-- Action buttons. On narrow widths this whole group drops to its own
           row beneath the message (see the max-width:560px media query). -->
      <div class="actions">
        <button class="btn ghost" on:click={() => downloadRawSave()}>
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          Export save
        </button>
        <button class="btn cta" on:click={() => location.reload()}>
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M20 11a8 8 0 1 0-.9 3.7M20 5v6h-6"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          Refresh
        </button>
      </div>

      <!-- Dismiss lives at the top-right corner (absolutely positioned) so it is
           reachable in BOTH the single-row and the stacked layout. -->
      <button class="dismiss" aria-label="Dismiss" on:click={() => dismissUpdate()}>
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M6 6l12 12M18 6L6 18"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
          />
        </svg>
      </button>
    </div>
  </div>
{/if}

<style>
  /* Fixed overlay across the top of the viewport. Because it is `fixed` and has
     no `fixed` descendants of its own, the backdrop-filter containing-block trap
     documented in RadialWeb.svelte does not apply here. `viewport-fit=cover`
     (index.html) means we honor the iOS safe-area top inset. */
  .update-banner {
    /* Normal-flow top strip: a flex child of Root's .app-shell, so it takes real
       layout space and PUSHES the app down instead of overlaying it, it never
       covers the game's header/top bar. Renders nothing when there's no update, so
       it has zero footprint until needed. Full-bleed (no side inset). Honors the
       iOS safe-area top inset (index.html sets viewport-fit=cover). */
    flex: 0 0 auto;
    padding: env(safe-area-inset-top) 0 0;
  }

  /* Full-width top bar. The game's top bar sits directly BEHIND this fixed banner,
     so the background MUST be opaque: --color-panel-bg alone is only 0.32 alpha,
     and Brave (and some mobile browsers) drop backdrop-filter entirely, so relying
     on blur to hide what's behind fails, the game text bleeds through. We stack
     the accent-tinted panel-bg OVER an opaque --color-bg-mid so nothing shows
     through on ANY browser, and keep blur(10px) as a frost bonus where honored. */
  .banner-inner {
    position: relative;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    /* Extra right padding reserves space for the absolutely-positioned dismiss. */
    padding: 11px 44px 11px 14px;
    background: linear-gradient(var(--color-panel-bg), var(--color-panel-bg)), var(--color-bg-mid);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border-bottom: 1px solid var(--color-border-strong);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
  }

  /* Message: icon + text. min-width:0 lets the text ellipsis/wrap instead of
     forcing the flex item wider than its container. */
  .msg {
    display: flex;
    align-items: center;
    gap: 12px;
    flex: 1 1 auto;
    min-width: 0;
  }
  .lead-icon {
    flex: 0 0 auto;
    width: 22px;
    height: 22px;
    color: var(--color-accent);
  }
  .text {
    min-width: 0;
  }
  .title {
    font-size: 14px;
    font-weight: 500;
    color: var(--color-text-primary);
  }
  .subline {
    font-size: 12px;
    color: var(--color-text-secondary);
    margin-top: 2px;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 0 0 auto;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: inherit;
    font-size: 13px;
    border-radius: 6px;
    padding: 7px 12px;
    cursor: pointer;
    white-space: nowrap;
  }
  .btn svg {
    width: 16px;
    height: 16px;
  }
  /* Export save: transparent fill, strong border, primary text. */
  .ghost {
    background: transparent;
    border: 1px solid var(--color-border-strong);
    color: var(--color-text-primary);
  }
  /* Refresh CTA: accent fill. Accent is always a bright/light color, so dark
     near-black text (--color-bg-deep) gives readable contrast on every theme. */
  .cta {
    background: var(--color-accent);
    border: 1px solid var(--color-accent);
    color: var(--color-bg-deep);
    font-weight: 500;
    padding: 7px 14px;
  }

  .dismiss {
    position: absolute;
    top: 8px;
    right: 8px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 6px;
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--color-text-secondary);
  }
  .dismiss svg {
    width: 18px;
    height: 18px;
  }
  .dismiss:hover {
    color: var(--color-text-primary);
  }

  /* NARROW: below the breakpoint a single flex row squished the copy to one word
     per line (the mockup's failure mode). Force the message and the actions each
     to a full-width row so the copy stays readable and the buttons sit on their
     OWN row at the bottom. The dismiss stays pinned top-right in both layouts. */
  @media (max-width: 560px) {
    .msg {
      flex: 1 1 100%;
    }
    .actions {
      flex: 1 1 100%;
      justify-content: flex-end;
    }
  }
</style>
