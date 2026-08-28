<script lang="ts">
  // SavePersistWarning.svelte: the loud, NON-dismissable "your progress is not
  // saving to this device" banner.
  //
  // Shows ONLY when the savePersistFailed store is true, which App.svelte's doSave
  // flips the instant a localStorage write returns false (a blocked or full store,
  // common on mobile: Safari Private Browsing, "block site data", a quota-exceeded
  // store). Before this existed, doSave discarded that boolean, so a failing store
  // was completely silent: progress lived only in memory until a reload discarded
  // everything since the last successful write (this is exactly how a renamed,
  // leveled captain vanished). The store clears itself back to false the moment a
  // write succeeds again, so the banner is self-healing.
  //
  // DESIGN CALLS (locked with the user):
  //   - Banner, not a modal: warns loudly without freezing play.
  //   - NO dismiss control: the only way to make it go away is to genuinely resolve
  //     the situation (export a backup, free storage). Letting a player swipe away a
  //     "you are losing progress" warning is a footgun that defeats the point. It
  //     auto-clears when saves recover, so it is never permanently stuck.
  //
  // The "Export save" button routes through exportLiveSaveNow (savePersist.ts), which
  // invokes App's registered exporter (downloadLiveSave). That serializes the CURRENT
  // in-memory state DIRECTLY, bypassing the blocked/stale localStorage the ordinary
  // "Export save" (downloadRawSave) reads, so it captures the player's real progress.
  //
  // Visual recipe mirrors UpdateBanner.svelte (frosted, opaque-backed panel, theme
  // variables only) but is danger-toned (--color-danger) to read as a warning.
  //
  // No em dashes / no "--" as punctuation (project rule): commas, periods, parens only.
  import { savePersistFailed, exportLiveSaveNow } from "./lib/savePersist";

  // One-shot feedback after an Export click, so the action is never silent (the file
  // download itself is browser-chrome the player may not notice). null = not yet
  // clicked, true = the export ran, false = it failed (serialize threw, extremely
  // unlikely). Reset to null whenever the banner is (re)shown is unnecessary: the
  // banner unmounts when savePersistFailed clears, so a fresh mount starts at null.
  let exportOutcome: boolean | null = null;

  function handleExport(): void {
    exportOutcome = exportLiveSaveNow();
  }
</script>

{#if $savePersistFailed}
  <div class="save-warning">
    <div class="banner-inner">
      <!-- Message block: leading warning icon + two lines of copy. -->
      <div class="msg">
        <svg class="lead-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <!-- Warning triangle with exclamation; currentColor = danger. -->
          <path
            d="M12 3.5 2.5 20h19L12 3.5z"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <path d="M12 10v4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
          <circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="currentColor" stroke-width="0.9" />
        </svg>
        <div class="text">
          <div class="title">Your progress isn't saving to this device</div>
          <div class="subline">
            Storage may be full or blocked. Export your save now so you don't lose it.
            {#if exportOutcome === true}
              <span class="export-ok">Save exported.</span>
            {:else if exportOutcome === false}
              <span class="export-fail">Export failed, please try again.</span>
            {/if}
          </div>
        </div>
      </div>

      <!-- Action: a single prominent Export button. No dismiss (see header). -->
      <div class="actions">
        <button class="btn cta" on:click={handleExport}>
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
      </div>
    </div>
  </div>
{/if}

<style>
  /* Normal-flow top strip: a flex child of Root's .app-shell (mounted alongside
     UpdateBanner), so it takes real layout space and PUSHES the app down instead of
     overlaying it. Renders nothing when saves are fine, so zero footprint until
     needed. Honors the iOS safe-area top inset (index.html sets viewport-fit=cover). */
  .save-warning {
    flex: 0 0 auto;
    padding: env(safe-area-inset-top) 0 0;
  }

  /* Full-width bar. The game's top bar can sit directly behind it, so the background
     MUST be opaque: we stack the accent-tinted panel-bg OVER an opaque --color-bg-mid
     so nothing bleeds through on any browser (Brave and some mobile browsers drop
     backdrop-filter entirely), keeping blur as a frost bonus where honored. The
     danger-colored top-and-bottom borders mark it as a warning, not a routine notice. */
  .banner-inner {
    position: relative;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    padding: 11px 14px;
    background: linear-gradient(var(--color-panel-bg), var(--color-panel-bg)), var(--color-bg-mid);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border-top: 2px solid var(--color-danger);
    border-bottom: 2px solid var(--color-danger);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
  }

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
    color: var(--color-danger);
  }
  .text {
    min-width: 0;
  }
  .title {
    font-size: 14px;
    font-weight: 600;
    color: var(--color-text-primary);
  }
  .subline {
    font-size: 12px;
    color: var(--color-text-secondary);
    margin-top: 2px;
  }
  /* Inline export feedback, colored by outcome (success token vs danger token). */
  .export-ok {
    color: var(--color-success);
    font-weight: 600;
  }
  .export-fail {
    color: var(--color-danger);
    font-weight: 600;
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
    padding: 7px 14px;
    cursor: pointer;
    white-space: nowrap;
  }
  .btn svg {
    width: 16px;
    height: 16px;
  }
  /* Export CTA: accent fill (the positive, actionable escape hatch against the red
     warning frame). Accent is always a bright/light color, so dark near-black text
     (--color-bg-deep) gives readable contrast on every theme. */
  .cta {
    background: var(--color-accent);
    border: 1px solid var(--color-accent);
    color: var(--color-bg-deep);
    font-weight: 500;
  }

  /* NARROW: below the breakpoint, force the message and the actions each to a
     full-width row so the copy stays readable and the button sits on its own row. */
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
