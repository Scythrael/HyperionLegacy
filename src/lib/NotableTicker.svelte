<script lang="ts">
  // ============================================================================
  // NotableTicker.svelte: the fleet-wide NOTABLE CREW band under the Personnel tab row (0.14.0).
  //
  // Signed mockup docs/mockups/2026-11-12-personnel-notable-ticker-mockup.html, option A; the user's answers
  // 2026-11-12 (docs/plans/2026-10-14-complement-and-acquisition-plan.md "USER ANSWERS (2026-11-12 afternoon)"):
  //   - Motion "A: drift": the strip drifts like the ship's Complement strip (the same ui/marquee.ts action), pauses
  //     on hover, keyboard focus or touch (a small "paused" tag shows), and never moves with Reduce motion on.
  //   - Placement "Under the tab row", on every Personnel tab; it sits outside .tab-scroll-area so it never scrolls.
  //   - Entry: name, rank, division, ship or "Unassigned", the star when favorited; favorites first, then the rest
  //     (notableTickerDisplay.ts says the order).
  //   - Tap: opens the notable's record card in place (an ActionModal: Escape, the X or the backdrop close it, focus
  //     returns to the entry). The card has the favorite star, Open Complement for a notable aboard, and Send back and
  //     Retire through the SAME host actions and the SAME Retire confirm (NotableRetireModal.svelte) as the ship's
  //     Complement strip.
  //   - Empty: a one-line hint saying how crew become notable.
  //   - All: the band's All button lists everyone, still, grouped by ship, Unassigned last; a row opens the record.
  // Notable crew have no titles or milestones in the engine, so none are shown. UI only: every decision is in
  // notableTickerDisplay.ts (tested); every action routes to App.svelte.
  //
  // RESPONSIVE: one DOM; the band is its own inline-size container, so below 520 px the label shrinks to the glyph
  // and the count, All becomes an icon, and the tap height grows to 34 px. Nothing scrolls sideways but the strip.
  // ============================================================================

  import { tick } from "svelte";
  import type { GameState } from "./game/model";
  import { NOTABLE_CREW_CAP } from "./game/model";
  import { canRetireNotable, canSendBackNotable, retireGateText, sendBackGateText } from "./game/crewGraduation";
  import ActionModal from "./ActionModal.svelte";
  import NotableRetireModal from "./NotableRetireModal.svelte";
  import Icon from "./ui/Icon.svelte";
  import { marquee } from "./ui/marquee";
  import {
    NOTABLE_RETIRE_TITLE,
    NOTABLE_SEND_BACK_TITLE,
    NOTABLE_TICKER_EMPTY_HINT,
    UNASSIGNED_LABEL,
    notableAllGroups,
    notableRecordView,
    notableTickerCount,
    notableTickerEntries,
  } from "./notableTickerDisplay";
  import "./crewGroups.css";

  export let state: GameState;
  // The game's Reduce motion setting: the strip stays still while it is on.
  export let reducedMotion = false;
  // The same host handlers the ship's Complement strip uses (App.svelte doToggleNotableFavorite, doSendBackNotable,
  // doRetireNotable), and the jump to a ship's Complement tab.
  export let onToggleFavorite: (notableId: string) => void;
  export let onSendBack: (notableId: string) => void;
  export let onRetire: (notableId: string) => void;
  export let onOpenComplement: (shipId: string) => void;

  $: entries = notableTickerEntries(state);
  $: count = notableTickerCount(state);
  $: allGroups = allOpen ? notableAllGroups(entries) : [];

  let paused = false;
  let bandEl: HTMLElement;

  // The record card (by id, so it follows the live state: Send back turns it to Unassigned, Retire closes it).
  let recordId: string | null = null;
  $: record = recordId === null ? null : notableRecordView(state, recordId);
  $: sendGate = record === null ? null : canSendBackNotable(state, record.id);
  $: retireGate = record === null ? null : canRetireNotable(state, record.id);
  // The crew lock's words (the ship is out), shown on the card since a phone has no hover text.
  $: lockText =
    record === null || retireGate === null || retireGate.ok
      ? undefined
      : retireGateText(state, record.id, retireGate);

  let allOpen = false;
  let retireId: string | null = null;

  function openRecord(id: string): void {
    recordId = id;
  }
  function closeRecord(): void {
    recordId = null;
  }
  function openComplement(shipId: string): void {
    recordId = null;
    allOpen = false;
    onOpenComplement(shipId);
  }
  async function confirmRetire(): Promise<void> {
    if (retireId === null) return;
    onRetire(retireId);
    retireId = null;
    recordId = null;
    // The retired notable's entry is gone, so focus cannot go back to it: hand it to the All list's dialog when it is
    // open (its focus trap only holds focus that is inside it), otherwise to the band.
    await tick();
    if (allOpen) {
      const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-label^="All notable crew"]');
      const first = dialog?.querySelector<HTMLElement>('button, [href], [tabindex]:not([tabindex="-1"])');
      (first ?? dialog)?.focus();
    } else if (!bandEl.contains(document.activeElement)) bandEl.focus();
  }
  // Send back keeps the card open (it now reads Unassigned); the button it was pressed on goes away, so focus moves to
  // the star to stay inside the card.
  let favEl: HTMLButtonElement | null = null;
  async function sendBack(id: string): Promise<void> {
    onSendBack(id);
    await tick();
    favEl?.focus();
  }
  function sendBackTitle(id: string, s: GameState): string {
    return sendBackGateText(s, id, canSendBackNotable(s, id)) ?? NOTABLE_SEND_BACK_TITLE;
  }
  function retireTitle(id: string, s: GameState): string {
    return retireGateText(s, id, canRetireNotable(s, id)) ?? NOTABLE_RETIRE_TITLE;
  }
</script>

<section class="nt-wrap" aria-label="Notable crew" tabindex="-1" bind:this={bandEl}>
  <div class="nt" class:is-paused={paused && !reducedMotion}>
    <span class="nt-lbl" title={count.title}>
      <Icon name="graduate" size={15} />
      <span class="w">Notable crew</span>
      <b class:cap={count.atCap}>{count.text}</b>
    </span>
    {#if entries.length === 0}
      <span class="nt-empty">{NOTABLE_TICKER_EMPTY_HINT}</span>
    {:else}
      <div
        class="nt-track"
        role="group"
        aria-label="Notable crew, favorites first"
        use:marquee={{ still: reducedMotion, key: entries.length, onPaused: (p) => (paused = p) }}
      >
        {#each entries as e (e.id)}
          <button type="button" class="ne" aria-label={e.ariaLabel} title={`Open ${e.name}'s record`} on:click={() => openRecord(e.id)}>
            <span class="l1">
              {#if e.favorite}<span class="fav"><Icon name="star" size={12} /></span>{/if}
              <span class="nm">{e.name}</span>
            </span>
            <span class="l2">
              <span class="meta">{e.rankLabel} · {e.divisionLabel}</span>
              {#if e.shipId === null}
                <span class="sp un">{UNASSIGNED_LABEL}</span>
              {:else}
                <span class="sp"><Icon name="ship" size={10} />{e.shipLabel}</span>
              {/if}
            </span>
          </button>
        {/each}
      </div>
      <button type="button" class="nt-btn all-btn" aria-label="All notable crew" title="All notable crew" on:click={() => (allOpen = true)}>
        <Icon name="manifest" size={14} /><span class="w">All</span>
      </button>
      <span class="nt-paused" aria-hidden="true"><Icon name="pause" size={9} />paused</span>
    {/if}
  </div>
</section>

{#if allOpen}
  <!-- The All list: everyone, still, grouped by ship, Unassigned last; a row opens the record over it. -->
  <ActionModal title={`Notable crew · ${count.text}`} ariaLabel={`All notable crew, ${count.count} of ${NOTABLE_CREW_CAP}`} onClose={() => (allOpen = false)}>
    <div class="all">
      {#each allGroups as g (g.key)}
        <div class="all-grp"><span>{g.label}</span><span>{g.entries.length}</span></div>
        {#each g.entries as e (e.id)}
          <button type="button" class="all-row" aria-label={e.ariaLabel} on:click={() => openRecord(e.id)}>
            <span class="fav">{#if e.favorite}<Icon name="star" size={12} />{/if}</span>
            <span class="all-nm"><b>{e.name}</b> <span class="meta">{e.rankLabel} · {e.divisionLabel}</span></span>
            <span class="meta all-org">{e.originLabel}</span>
          </button>
        {/each}
      {/each}
    </div>
  </ActionModal>
{/if}

{#if record !== null}
  <!-- The record card: read from the engine; the star, Open Complement, Send back and Retire are the existing actions. -->
  <ActionModal title="Notable crew" ariaLabel={`Notable crew record: ${record.name}`} onClose={closeRecord}>
    <div class="rec">
      <div class="rec-nm">
        <span>{record.name}</span>
        <button
          type="button"
          class="rec-fav"
          bind:this={favEl}
          class:on={record.favorite}
          aria-label="Toggle favorite"
          aria-pressed={record.favorite}
          title={record.favorite ? "Favorited" : "Favorite this crew member"}
          on:click={() => onToggleFavorite(record?.id ?? "")}
        ><Icon name="star" size={16} /></button>
      </div>
      <div class="rec-sub">{record.subLine}</div>
      <div class="cg-buffchips">
        {#each record.buffs as c, ci (ci)}
          <span class="cg-bf {c.kind}" title={c.title}>{#if c.kind === "exclusive"}<Icon name="diamond" size={11} />{/if}{c.label}</span>
        {/each}
      </div>
      {#if record.shipId !== null}
        <div class="rec-where"><Icon name="ship" size={14} /> <span>Aboard <b>{record.shipLabel}</b></span></div>
      {:else}
        <div class="rec-where"><span class="sp un">{UNASSIGNED_LABEL}</span> <span>Not aboard a ship</span></div>
        <div class="rec-note">
          <Icon name="info" size={12} />
          <span>A Personnel roster that pins this crew member can seat them on a ship when it is applied (Facilities, Personnel Rosters).</span>
        </div>
      {/if}
      {#if lockText !== undefined}
        <p class="rec-warn"><Icon name="warning" size={14} /> <span>{lockText}.</span></p>
      {/if}
    </div>
    <svelte:fragment slot="footer">
      {#if record.shipId !== null}
        <button type="button" class="cg-btn ghost rec-fbtn" on:click={() => record?.shipId && openComplement(record.shipId)}>Open Complement</button>
        <button
          type="button"
          class="cg-btn ghost rec-fbtn"
          disabled={sendGate === null || !sendGate.ok}
          title={sendBackTitle(record.id, state)}
          on:click={() => record && sendBack(record.id)}
        >Send back</button>
      {/if}
      <button
        type="button"
        class="cg-btn ghost rec-fbtn"
        disabled={retireGate === null || !retireGate.ok}
        title={retireTitle(record.id, state)}
        on:click={() => (retireId = record?.id ?? null)}
      >Retire</button>
    </svelte:fragment>
  </ActionModal>
{/if}

{#if retireId !== null}
  <NotableRetireModal {state} notableId={retireId} onConfirm={confirmRetire} onClose={() => (retireId = null)} />
{/if}

<style>
  /* THE BAND (mockup .nt): a sibling of ConsoleTabs, never scrolls with the page. */
  .nt-wrap {
    flex: 0 0 auto;
    container-type: inline-size;
    min-width: 0;
    margin: 0 0 8px;
    outline: none;
  }
  .nt {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 38px;
    padding: 3px 4px 3px 9px;
    border: 1px solid rgba(var(--color-accent-rgb), 0.16);
    background: rgba(var(--color-accent-rgb), 0.035);
    border-radius: var(--corner);
    min-width: 0;
  }
  .nt-lbl {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-text-dim);
    white-space: nowrap;
  }
  .nt-lbl :global(svg) {
    color: var(--color-accent);
  }
  .nt-lbl b {
    color: var(--color-text-secondary);
    font-weight: 400;
    letter-spacing: 0;
  }
  .nt-lbl b.cap {
    color: var(--color-warning);
  }
  .nt-track {
    flex: 1;
    min-width: 0;
    display: flex;
    gap: 6px;
    overflow-x: auto;
    scrollbar-width: none;
    -webkit-mask-image: linear-gradient(90deg, transparent, #000 14px, #000 calc(100% - 14px), transparent);
    mask-image: linear-gradient(90deg, transparent, #000 14px, #000 calc(100% - 14px), transparent);
    padding: 0 10px;
  }
  .nt-track::-webkit-scrollbar {
    display: none;
  }
  .ne {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    min-height: 30px;
    padding: 2px 9px 2px 8px;
    font: inherit;
    font-size: var(--text-sm);
    color: var(--color-text-primary);
    background: rgba(var(--color-accent-rgb), 0.05);
    border: 1px solid rgba(var(--color-accent-rgb), 0.16);
    border-left: 2px solid var(--color-accent);
    border-radius: var(--corner);
    white-space: nowrap;
    cursor: pointer;
    text-align: left;
  }
  .ne:hover,
  .ne:focus-visible {
    border-color: var(--color-accent);
    background: rgba(var(--color-accent-rgb), 0.12);
    outline: none;
  }
  .l1,
  .l2 {
    display: inline-flex;
    gap: 6px;
    align-items: center;
  }
  .fav {
    display: inline-flex;
    color: var(--color-warning);
  }
  .fav :global(svg) {
    fill: currentColor;
  }
  .nm {
    font-weight: 600;
  }
  .meta {
    color: var(--color-text-secondary);
    font-size: var(--text-xs);
  }
  .sp {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--color-accent-bright);
    border: 1px solid rgba(var(--color-accent-rgb), 0.3);
    padding: 0 5px;
    line-height: 17px;
    border-radius: var(--corner);
    white-space: nowrap;
  }
  .sp.un {
    color: var(--color-text-dim);
    border-style: dashed;
    border-color: rgba(98, 133, 145, 0.6);
  }
  .nt-btn {
    flex: none;
    font: inherit;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--color-accent);
    background: rgba(var(--color-accent-rgb), 0.06);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--corner);
    min-height: 30px;
    padding: 0 9px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    cursor: pointer;
    white-space: nowrap;
  }
  .nt-btn:hover,
  .nt-btn:focus-visible {
    border-color: var(--color-accent-bright);
    color: var(--color-accent-bright);
  }
  .nt-paused {
    position: absolute;
    right: 6px;
    top: -9px;
    font-family: var(--font-mono);
    font-size: var(--text-3xs, 9px);
    color: var(--color-text-dim);
    background: var(--color-bg-mid);
    border: 1px solid var(--color-border);
    padding: 0 5px;
    display: none;
    align-items: center;
    gap: 3px;
  }
  .nt.is-paused .nt-paused {
    display: inline-flex;
  }
  .nt-empty {
    flex: 1;
    min-width: 0;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    padding: 0 6px;
  }

  /* Phone widths: the label shrinks to the glyph and the count, All is an icon, 34 px tap height. */
  @container (max-width: 520px) {
    .nt {
      min-height: 42px;
      padding-left: 7px;
      gap: 6px;
    }
    .ne,
    .nt-btn {
      min-height: 34px;
    }
    .w {
      display: none;
    }
    .all-btn {
      width: 32px;
      padding: 0;
      justify-content: center;
    }
  }

  /* THE RECORD CARD (mockup .rec) */
  .rec {
    display: grid;
    gap: 9px;
  }
  .rec-nm {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    font-size: var(--text-lg, 15px);
    font-weight: 600;
    color: var(--color-text-primary);
  }
  .rec-fav {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 32px;
    min-height: 32px;
    background: none;
    border: 1px solid transparent;
    border-radius: var(--corner);
    color: var(--color-text-dim);
    cursor: pointer;
  }
  .rec-fav.on {
    color: var(--color-warning);
  }
  .rec-fav.on :global(svg) {
    fill: currentColor;
  }
  .rec-fav:hover,
  .rec-fav:focus-visible {
    color: var(--color-warning);
    border-color: var(--color-border);
  }
  .rec-sub {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }
  .rec-where {
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }
  .rec-where b {
    color: var(--color-text-primary);
    font-weight: 600;
  }
  .rec-note {
    font-size: var(--text-xs);
    color: var(--color-text-dim);
    display: flex;
    gap: 6px;
    align-items: flex-start;
  }
  .rec-note :global(svg) {
    margin-top: 2px;
    flex: none;
  }
  .rec-warn {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-warning);
    display: flex;
    gap: 6px;
    align-items: flex-start;
  }
  @container (max-width: 700px) {
    .rec-fbtn {
      flex: 1;
      justify-content: center;
    }
  }

  /* THE ALL LIST (mockup .all) */
  .all {
    display: grid;
  }
  .all-grp {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--color-text-dim);
    display: flex;
    justify-content: space-between;
    border-bottom: 1px solid var(--color-border);
    padding: 8px 0 3px;
  }
  .all-row {
    display: grid;
    grid-template-columns: 14px minmax(0, 1fr) auto;
    gap: 8px;
    align-items: center;
    font: inherit;
    font-size: var(--text-sm);
    color: var(--color-text-primary);
    text-align: left;
    background: none;
    border: none;
    border-bottom: 1px dashed rgba(var(--color-accent-rgb), 0.1);
    padding: 6px 0;
    min-height: 34px;
    cursor: pointer;
  }
  .all-row:hover,
  .all-row:focus-visible {
    background: rgba(var(--color-accent-rgb), 0.08);
    outline: none;
  }
  .all-nm {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .all-nm b {
    font-weight: 600;
  }
</style>
