<script lang="ts">
  // ============================================================================
  // CrewTransferModal.svelte
  // The CREW TRANSFER picker (0.14.0 CP-10; signed mockup docs/mockups/2026-11-02-cp10-transfer-picker-mockup.html
  // sections 1 and 2; user picks 2026-11-02):
  //   (1) where to: a card for the crew pool and every other ship, each with its room, mode and lock, unpickable ones
  //       saying why right there (an auto-crew card offers "Switch ... to manual", OC-7 "Manual ships only");
  //   (2) asking for more than there is room for is allowed: each row warns, and the button says how many will move;
  //   (3) each row has minus, the count (type to set it), plus and ALL;
  //   (4) after Transfer the modal stays open and shows the result row by row (Transfer more, Done);
  //   (5) on a phone it is two steps, where to and then how many (one DOM: the steps are container-query states).
  // If the SOURCE ship is on auto-crew the picker opens on the same "Switch to manual" line instead of the lists.
  // HOMEWORLD RESERVE (user 2026-11-12 evening, docs/mockups/2026-11-12-homeworld-reserve-controls-mockup.html): the same
  // picker with the reserve as the source. Send starts on the first ship with room, Recall on the crew pool (startOn);
  // auto-crew ships are listed with a note, not pickable; a Send (from the reserve or the pool) that moves pool crew out at
  // the next tick warns first.
  // PURE PRESENTATION: every number is crewTransferDisplay.ts (an engine preview, tested); the move itself is the
  // host's onTransfer (App.svelte doTransferCrew: crewTransfer.ts transferCrew, state = next, log, save).
  // ============================================================================
  import "./crewGroups.css";
  import type { GameState } from "./game/model";
  import { HOMEWORLD_RESERVE, type CrewTransferEndpoint, type CrewTransferPick, type CrewTransferResult } from "./game/crewTransfer";
  import ActionModal from "./ActionModal.svelte";
  import Icon from "./ui/Icon.svelte";
  import {
    availableAt,
    clampPickCount,
    defaultDestination,
    endpointName,
    endpointPhrase,
    fmtCount,
    initialTransferPicks,
    picksAfterTransfer,
    transferDestinations,
    transferPreview,
    transferResultView,
    transferSourceBlock,
    type TransferResultView,
  } from "./crewTransferDisplay";

  export let state: GameState;
  // Where the crew come from: a ship id, "pool", or "reserve" (the Homeworld reserve).
  export let from: CrewTransferEndpoint;
  // Which card the picker starts on: "ship" = the first ship with room (the reserve's Send), "pool" = the crew pool (the
  // reserve's Recall); null = the first pickable card.
  export let startOn: "ship" | "pool" | null = null;
  // The picked groups' keys (crew.ts signatureKey), whole groups to start.
  export let keys: readonly string[];
  // Run the transfer (host: doTransferCrew). Returns the engine's result (moved 0 / a refusal included), or null.
  export let onTransfer: (from: CrewTransferEndpoint, to: CrewTransferEndpoint, picks: CrewTransferPick[]) => CrewTransferResult | null;
  // Switch a ship to manual crew (host: doSetComplementMode(shipId, "active")).
  export let onSetManual: (shipId: string) => void;
  // Close the picker; `moved` says whether any transfer went through (the host clears its selection then).
  export let onClose: (moved: boolean) => void;

  let picks: CrewTransferPick[] = initialTransferPicks(state, from, keys);
  let to: CrewTransferEndpoint | null = null;
  let step: 1 | 2 = 1;
  let result: { view: TransferResultView; raw: CrewTransferResult } | null = null;
  let movedAny = false;

  $: fromName = endpointName(state, from);
  $: sourceBlock = transferSourceBlock(state, from);
  $: cards = transferDestinations(state, from);
  // Start on the first pickable card; keep the player's pick while it stays in the list.
  $: if (to === null || !cards.some((c) => c.id === to)) to = defaultDestination(cards, startOn);
  $: toCard = cards.find((c) => c.id === to) ?? null;
  $: toPickable = toCard !== null && toCard.pickable;
  $: preview = transferPreview(state, from, toPickable ? to : null, picks);
  $: pickedCrew = picks.reduce((n, p) => n + p.count, 0);
  $: pickedGroups = preview.rows.length;
  $: canTransfer = toPickable && preview.willMove > 0 && sourceBlock === null;
  $: recalling = from === HOMEWORLD_RESERVE && toCard !== null && toCard.kind === "pool";

  function choose(id: CrewTransferEndpoint, pickable: boolean): void {
    if (pickable) to = id;
  }
  function onCardKey(e: KeyboardEvent, id: CrewTransferEndpoint, pickable: boolean): void {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(id, pickable);
    }
  }
  function setCount(key: string, value: number): void {
    const available = availableAt(state, from, key);
    picks = picks.map((p) => (p.signatureKey === key ? { ...p, count: clampPickCount(value, available) } : p));
  }
  function onCountInput(key: string, e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    setCount(key, Number(input.value));
    // A typed value past what the group has (or not a number) snaps back to the kept count.
    input.value = String(countOf(key));
  }
  // Switch an auto-crew destination to manual, then pick it (it becomes pickable once the host saves the switch).
  function switchAndPick(shipId: string): void {
    onSetManual(shipId);
    to = shipId;
  }
  function countOf(key: string): number {
    return picks.find((p) => p.signatureKey === key)?.count ?? 0;
  }

  function doTransfer(): void {
    if (!canTransfer || to === null) return;
    const before = state;
    const sent = picks.filter((p) => p.count >= 1);
    const res = onTransfer(from, to, sent);
    if (res === null) return;
    if (res.moved > 0) movedAny = true;
    result = { view: transferResultView(before, from, to, res), raw: res };
  }
  function transferMore(): void {
    if (result === null) return;
    picks = picksAfterTransfer(state, from, result.raw);
    result = null;
    step = 1;
  }
  function close(): void {
    onClose(movedAny);
  }
</script>

<ActionModal title={result === null ? `Transfer crew from ${endpointPhrase(state, from)}` : "Transfer done"} wide={result === null} onClose={close}>
  {#if result !== null}
    <!-- (4) The result, row by row. Nobody is ever lost: what had no room stays where it was. -->
    <div class="tm-result" role="status">
      <div class="tm-rh"><Icon name="check" size={14} /> {result.view.heading}</div>
      {#each result.view.rows as r (r.key)}
        <div class="tm-rl" class:short={r.short}><span>{r.label}</span><b>{fmtCount(r.moved)} of {fmtCount(r.requested)}</b></div>
        {#if r.why}<div class="tm-rwhy">{r.why}</div>{/if}
      {/each}
    </div>
    <p class="tm-rfoot">{result.view.footer}</p>
  {:else if sourceBlock !== null}
    <!-- The source cannot give right now: auto-crew (offer the switch) or a lock (the words). -->
    <p class="tm-warn"><Icon name={sourceBlock.kind === "locked" ? "lock" : "warning"} size={14} /> <span>{sourceBlock.text}.</span></p>
    {#if sourceBlock.kind === "autoCrew"}
      <button type="button" class="cg-btn sm" on:click={() => onSetManual(from)}>Switch {fromName} to manual</button>
    {/if}
  {:else}
    <div class="tm" class:s1={step === 1} class:s2={step === 2}>
      <div class="tm-sub tm-wide-only">{pickedGroups} {pickedGroups === 1 ? "group" : "groups"} · {fmtCount(pickedCrew)} crew picked</div>
      <!-- The phone's step line (the wide picker shows both columns at once). -->
      <div class="tm-stepline tm-narrow-only">
        {#if step === 1}<span>Transfer {fmtCount(pickedCrew)} crew</span><span class="tm-of">1 of 2</span>
        {:else}<span>To {toCard?.name ?? ""}</span><span class="tm-of">2 of 2</span>{/if}
      </div>
      <div class="tm-split">
        <div class="tm-dests" role="radiogroup" aria-label="Send to">
          <div class="tm-colh">Send to</div>
          {#each cards as c (c.id)}
            <div
              class="tm-dest"
              class:on={to === c.id}
              class:off={!c.pickable && !c.canSwitchToManual}
              role="radio"
              aria-checked={to === c.id}
              aria-disabled={!c.pickable}
              tabindex={c.pickable ? 0 : -1}
              on:click={() => choose(c.id, c.pickable)}
              on:keydown={(e) => onCardKey(e, c.id, c.pickable)}
            >
              <span class="tm-radio" aria-hidden="true"></span>
              <span class="tm-dn">
                <Icon name={c.kind === "pool" ? "crewPool" : "ship"} size={13} />
                <span>{c.name}</span>
                {#if c.hullLabel && c.hullLabel !== c.name}<span class="tm-badge tm-wide-only">{c.hullLabel}</span>{/if}
                {#if c.status === "locked"}
                  <span class="tm-badge lock"><Icon name="lock" size={10} /><span class="tm-wide-only">crew&nbsp;</span>locked</span>
                {:else if c.mode === "manual"}
                  <span class="tm-badge ok">manual</span>
                {:else if c.mode === "auto"}
                  <span class="tm-badge"><span class="tm-wide-only">auto-crew</span><span class="tm-narrow-only">auto</span></span>
                {/if}
              </span>
              {#if c.line}<span class="tm-ds"><span class="tm-wide-only">{c.line}</span><span class="tm-narrow-only">{c.shortLine}</span></span>{/if}
              {#if c.warn}
                <span class="tm-dw"><Icon name={c.status === "locked" ? "lock" : "warning"} size={12} /><span><span class="tm-wide-only">{c.warn}</span><span class="tm-narrow-only">{c.shortWarn}</span></span></span>
              {/if}
              {#if c.info}
                <span class="tm-di"><Icon name="info" size={12} /><span><span class="tm-wide-only">{c.info}</span><span class="tm-narrow-only">{c.shortInfo}</span></span></span>
              {/if}
              {#if c.canSwitchToManual}
                <span class="tm-da">
                  <button type="button" class="cg-btn sm" on:click|stopPropagation={() => switchAndPick(String(c.id))}><span class="tm-wide-only">{`Switch ${c.name} to manual`}</span><span class="tm-narrow-only">Switch to manual</span></button>
                </span>
              {/if}
            </div>
          {/each}
        </div>

        <div class="tm-picks">
          <div class="tm-colh tm-wide-only">Crew to move{toPickable && toCard ? (toCard.kind === "pool" ? " · room in the pool" : ` · room aboard ${toCard.name}`) : ""}</div>
          <div class="tm-rows">
            {#each preview.rows as r (r.key)}
              <div class="tm-pick">
                <div class="tm-pinfo">
                  <div class="tm-pn"><span class="tm-wide-only">{r.name}</span><span class="tm-narrow-only">{r.shortName}</span></div>
                  <div class="tm-ps">{r.rankLabel}<span class="tm-wide-only">{" · "}<span class="cg-rarity" style="color: var(--rarity-{r.rarity})"><i></i>{r.rarityLabel}</span></span>{" · "}<span class="tm-of">{r.availableText}</span></div>
                  {#if r.buffsText}<div class="tm-pb">{r.buffsText}</div>{/if}
                </div>
                <span class="tm-step" role="group" aria-label={`How many of the ${r.name} to move`}>
                  <button type="button" aria-label="One less" disabled={r.count <= 0} on:click={() => setCount(r.key, countOf(r.key) - 1)}><Icon name="minus" size={13} /></button>
                  <input
                    class="tm-v"
                    type="number"
                    inputmode="numeric"
                    min="0"
                    max={r.available}
                    value={r.count}
                    aria-label={`Crew of the ${r.name} to move`}
                    on:change={(e) => onCountInput(r.key, e)}
                  />
                  <button type="button" aria-label="One more" disabled={r.count >= r.available} on:click={() => setCount(r.key, countOf(r.key) + 1)}><Icon name="plus" size={13} /></button>
                  <button type="button" class="tm-mx" disabled={r.count >= r.available} on:click={() => setCount(r.key, r.available)}>ALL</button>
                </span>
                {#if r.note === "short"}
                  <div class="tm-pw"><Icon name="warning" size={12} /><span><span class="tm-wide-only">{r.noteText}</span><span class="tm-narrow-only">{r.shortNoteText}</span></span></div>
                {:else if r.note === "ok"}
                  <div class="tm-pf tm-wide-only"><Icon name="check" size={12} /><span>{r.noteText}</span></div>
                {/if}
              </div>
            {/each}
          </div>
          {#if preview.gateText}
            <p class="tm-warn"><Icon name="warning" size={14} /> <span>{preview.gateText}</span></p>
          {/if}
          <div class="tm-sum"><span class="tm-wide-only">{preview.summary}</span><span class="tm-narrow-only">{preview.shortSummary}</span></div>
          {#if preview.swapWarning}
            <!-- "Warn first" (user 2026-11-12): pool crew this Send leaves without a berth move to the reserve next tick. -->
            <p class="tm-heads" role="note"><Icon name="warning" size={14} /> <span><span class="tm-wide-only">{preview.swapWarning}</span><span class="tm-narrow-only">{preview.shortSwapWarning}</span></span></p>
          {/if}
        </div>
      </div>
    </div>
  {/if}

  <svelte:fragment slot="footer">
    {#if result !== null}
      <button type="button" class="cg-btn ghost tm-fbtn" on:click={transferMore}>Transfer more</button>
      <button type="button" class="cg-btn pri tm-fbtn" on:click={close}>Done</button>
    {:else}
      <button type="button" class="cg-btn ghost tm-fbtn" class:tm-hide-narrow={step === 2} on:click={close}>Cancel</button>
      <button type="button" class="cg-btn ghost tm-fbtn tm-narrow-only" class:tm-hide-narrow={step === 1} on:click={() => (step = 1)}><Icon name="chevronLeft" size={14} /> Back</button>
      <button type="button" class="cg-btn pri tm-fbtn tm-narrow-only" class:tm-hide-narrow={step === 2} disabled={!toPickable || sourceBlock !== null} on:click={() => (step = 2)}>Next</button>
      <button type="button" class="cg-btn pri tm-fbtn" class:tm-hide-narrow={step === 1} disabled={!canTransfer} on:click={doTransfer}><Icon name={recalling ? "crewPool" : "transfer"} size={14} /> {preview.buttonLabel}</button>
    {/if}
  </svelte:fragment>
</ActionModal>

<style>
  .tm {
    display: grid;
    gap: 8px;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }
  .tm-sub {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
  }
  .tm-split {
    display: grid;
    grid-template-columns: 330px minmax(0, 1fr);
    gap: 14px;
    align-items: start;
  }
  .tm-colh {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-accent-bright);
    margin-bottom: 6px;
  }
  .tm-dests {
    display: grid;
    gap: 6px;
    align-content: start;
  }
  .tm-dests .tm-colh {
    margin-bottom: 0;
  }
  .tm-dest {
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr);
    gap: 2px 8px;
    padding: 8px 10px;
    border: 1px solid var(--color-border);
    border-radius: var(--corner);
    background: rgba(var(--color-accent-rgb), 0.03);
    cursor: pointer;
    text-align: left;
  }
  .tm-dest[aria-disabled="true"] {
    cursor: default;
  }
  .tm-dest.on {
    border-color: var(--color-accent-bright);
    background: rgba(var(--color-accent-rgb), 0.1);
  }
  .tm-dest.off {
    opacity: 0.6;
    border-style: dashed;
  }
  .tm-dest:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 1px;
  }
  .tm-radio {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 1px solid var(--color-border-strong);
    margin-top: 2px;
    display: inline-block;
  }
  .tm-dest.on .tm-radio {
    border-color: var(--color-accent-bright);
    box-shadow: inset 0 0 0 3px var(--color-bg-mid);
    background: var(--color-accent-bright);
  }
  .tm-dn {
    font-weight: 600;
    font-size: var(--text-xs);
    color: var(--color-text-primary);
    display: flex;
    gap: 6px;
    align-items: center;
    flex-wrap: wrap;
    min-width: 0;
  }
  .tm-ds {
    grid-column: 2;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
  }
  .tm-dw {
    grid-column: 2;
    font-size: var(--text-2xs);
    color: var(--color-warning);
    display: flex;
    gap: 5px;
    align-items: flex-start;
  }
  .tm-da {
    grid-column: 2;
    margin-top: 4px;
  }
  .tm-di {
    grid-column: 2;
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
    display: flex;
    gap: 5px;
    align-items: flex-start;
  }
  .tm-heads {
    margin: 8px 0 0;
    padding: 7px 10px;
    font-size: var(--text-xs);
    color: var(--color-warning);
    border: 1px dashed rgba(var(--color-warning-rgb, 251, 191, 36), 0.5);
    border-radius: var(--corner);
    background: rgba(var(--color-warning-rgb, 251, 191, 36), 0.05);
    display: flex;
    gap: 6px;
    align-items: flex-start;
  }
  .tm-badge {
    font-family: var(--font-mono);
    font-size: var(--text-3xs, 9.5px);
    letter-spacing: 0.08em;
    padding: 1px 5px;
    border-radius: var(--corner);
    border: 1px solid var(--color-border);
    color: var(--color-text-secondary);
    text-transform: uppercase;
    font-weight: 400;
    display: inline-flex;
    gap: 3px;
    align-items: center;
  }
  .tm-badge.lock {
    color: var(--color-warning);
    border-color: rgba(var(--color-warning-rgb, 251, 191, 36), 0.5);
  }
  .tm-badge.ok {
    color: var(--color-success);
    border-color: rgba(52, 211, 153, 0.45);
  }
  .tm-rows {
    border: 1px solid rgba(var(--color-accent-rgb), 0.16);
    border-radius: var(--corner);
    background: rgba(var(--color-accent-rgb), 0.03);
  }
  .tm-pick {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 4px 10px;
    padding: 8px 10px;
    border-bottom: 1px solid rgba(var(--color-accent-rgb), 0.08);
    align-items: center;
  }
  .tm-pick:last-child {
    border-bottom: 0;
  }
  .tm-pinfo {
    min-width: 0;
  }
  .tm-pn {
    font-weight: 600;
    font-size: var(--text-xs);
    color: var(--color-text-primary);
  }
  .tm-ps {
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
  }
  .tm-pb {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
  }
  .tm-of {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
  }
  .tm-pw,
  .tm-pf {
    grid-column: 1 / 3;
    font-size: var(--text-2xs);
    display: flex;
    gap: 5px;
    align-items: flex-start;
  }
  .tm-pw {
    color: var(--color-warning);
  }
  .tm-pf {
    color: var(--color-success);
  }
  .tm-step {
    display: inline-flex;
    align-items: stretch;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--corner);
    overflow: hidden;
  }
  .tm-step button {
    min-width: 30px;
    height: 30px;
    display: inline-grid;
    place-items: center;
    background: transparent;
    border: 0;
    color: var(--color-accent);
    cursor: pointer;
    padding: 0;
  }
  .tm-step button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .tm-step .tm-mx {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    letter-spacing: 0.06em;
    padding: 0 8px;
    border-left: 1px solid var(--color-border);
  }
  .tm-v {
    width: 48px;
    height: 30px;
    text-align: center;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-primary);
    border: 0;
    border-left: 1px solid var(--color-border);
    border-right: 1px solid var(--color-border);
    background: rgba(0, 0, 0, 0.25);
    border-radius: 0;
    -moz-appearance: textfield;
    appearance: textfield;
  }
  .tm-v::-webkit-outer-spin-button,
  .tm-v::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  .tm-sum {
    margin-top: 10px;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    padding: 8px 10px;
    border: 1px solid var(--color-border);
    border-radius: var(--corner);
    background: rgba(0, 0, 0, 0.2);
  }
  .tm-warn {
    margin: 8px 0;
    color: var(--color-warning);
    display: flex;
    gap: 6px;
    align-items: flex-start;
    font-size: var(--text-xs);
  }
  .tm-result {
    border: 1px solid rgba(52, 211, 153, 0.5);
    background: rgba(52, 211, 153, 0.06);
    border-radius: var(--corner);
    padding: 10px 12px;
    display: grid;
    gap: 6px;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }
  .tm-rh {
    color: var(--color-success);
    font-weight: 600;
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .tm-rl {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
  }
  .tm-rl b {
    color: var(--color-text-primary);
  }
  .tm-rl.short b {
    color: var(--color-warning);
  }
  .tm-rwhy {
    font-size: var(--text-2xs);
    color: var(--color-warning);
  }
  .tm-rfoot {
    margin: 10px 0 0;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }
  .tm-stepline {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-text-primary);
  }
  .tm-narrow-only {
    display: none;
  }

  /* (5) The phone picker: two steps in one DOM. The dialog is the container (ActionModal .am-dialog). */
  @container (max-width: 700px) {
    .tm-wide-only {
      display: none;
    }
    .tm-narrow-only {
      display: inline;
    }
    .tm-stepline.tm-narrow-only {
      display: flex;
    }
    .tm-fbtn.tm-narrow-only {
      display: inline-flex;
    }
    .tm-hide-narrow,
    .tm-fbtn.tm-hide-narrow {
      display: none;
    }
    .tm-split {
      grid-template-columns: minmax(0, 1fr);
    }
    .tm.s1 .tm-picks,
    .tm.s2 .tm-dests {
      display: none;
    }
    .tm-fbtn {
      flex: 1;
      justify-content: center;
    }
    .tm-pick {
      grid-template-columns: minmax(0, 1fr) auto;
    }
    .tm-sum {
      margin-top: 8px;
    }
  }
</style>
