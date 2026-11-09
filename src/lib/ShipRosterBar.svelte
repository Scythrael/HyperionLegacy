<script lang="ts">
  // ============================================================================
  // ShipRosterBar.svelte
  // 0.14.0 Complement CP-17 (E-CREW Task 30): the roster picker on a ship's personnel screen.
  //
  // Crew spec: a ship's personnel config is saveable as a named ROSTER, "with a DROPDOWN to load one from the
  // ship's personnel screen", and "If the current roster is UNSAVED and the player tries to switch rosters, WARN
  // that the current configuration is unsaved and will be lost on swap." It sits above the Senior Staff and
  // Complement panes of the ship page.
  //
  //   - A select of saved rosters plus an Apply button. Picking in the select never acts; only Apply does.
  //   - Apply runs the host's onApplyRoster, App's doApplyRoster (the same handler the Personnel Rosters
  //     facility uses), so the linked loadout travels and every refusal is logged exactly as from there.
  //   - One confirm step before Apply (ActionModal, Cancel / Apply anyway, the facility's Unsaved Name pattern) when
  //     either applies, both in the same popup: the ship's officers and notable crew match no saved roster and the
  //     pick would really take an officer out of a seat, or the pick would pull someone off another ship (named, with
  //     that ship). An apply that only adds people from the pool or the unassigned never asks.
  //   - Disabled with the reason while the ship is crew-locked (CP-6) or the pick is refused by the engine. The ship's
  //     own lock is stated by the pane below (and Apply's title), never twice on screen.
  //   - A linked loadout for another hull: a short line says the gear stays in the Armory, before Apply.
  //   - No saved roster that carries people: a truthful empty line pointing at the facility.
  // Every decision is a pure function in shipRosterDisplay.ts (tested); this file only presents them.
  // RESPONSIVE: one DOM; the select takes the row's free width and the row wraps on a narrow screen.
  // ============================================================================

  import ActionModal from "./ActionModal.svelte";
  import Icon from "./ui/Icon.svelte";
  import type { GameState } from "./game/model";
  import {
    defaultShipRosterId,
    rosterPullLine,
    shipRosterApplyBlock,
    shipRosterApplyConfirm,
    shipRosterBlockLine,
    shipRosterEmptyText,
    shipRosterGearLine,
    shipRosterOptions,
    shipRosterStatusText,
    type ShipRosterConfirm,
  } from "./shipRosterDisplay";

  export let state: GameState;
  export let shipId: string;
  // Apply a roster to this ship (host: doApplyRoster).
  export let onApplyRoster: (rosterId: string, shipId: string) => void;

  // The picked roster id ("" = nothing offered). Reset to the default when the ship changes, or when the pick
  // stops being offered (deleted, or its people were turned off in the facility).
  let pickId = "";
  let lastShipId: string | null = null;
  // The open confirm step (null = closed).
  let confirmStep: ShipRosterConfirm | null = null;

  $: options = shipRosterOptions(state);
  $: if (shipId !== lastShipId || (pickId !== "" && !options.some((o) => o.id === pickId)) || (pickId === "" && options.length > 0)) {
    lastShipId = shipId;
    pickId = defaultShipRosterId(state, shipId);
    confirmStep = null;
  }
  $: emptyText = shipRosterEmptyText(state);
  $: statusText = shipRosterStatusText(state, shipId);
  $: block = shipRosterApplyBlock(state, shipId, pickId);
  $: blockLine = shipRosterBlockLine(state, shipId, pickId);
  $: gearLine = shipRosterGearLine(state, shipId, pickId);
  // A lock that arrives while the confirm step is open closes it: "Apply anyway" could only do nothing.
  $: if (block !== null) confirmStep = null;
  $: pickName = options.find((o) => o.id === pickId)?.label ?? "";

  function requestApply(): void {
    if (block !== null || pickId === "") return;
    confirmStep = shipRosterApplyConfirm(state, shipId, pickId);
    if (confirmStep === null) onApplyRoster(pickId, shipId);
  }
  function confirmApply(): void {
    confirmStep = null;
    if (block === null && pickId !== "") onApplyRoster(pickId, shipId);
  }
</script>

<div class="srb">
  <div class="srb-tag">Personnel Roster</div>
  {#if emptyText !== null}
    <div class="srb-empty">{emptyText}</div>
  {:else}
    <div class="srb-row">
      <select bind:value={pickId} aria-label="Saved roster to apply to this ship">
        {#each options as o (o.id)}
          <option value={o.id}>{o.label}</option>
        {/each}
      </select>
      <button
        type="button"
        class="srb-btn"
        disabled={block !== null}
        title={block?.text ?? "Apply this roster to the ship"}
        on:click={requestApply}
      >
        Apply
      </button>
    </div>
    {#if blockLine !== null}
      <p class="srb-lock" role="note">{#if blockLine.locked}<Icon name="lock" /> {/if}{blockLine.text}</p>
    {:else if statusText !== null}
      <p class="srb-status">{statusText}</p>
    {/if}
    {#if gearLine !== null}
      <p class="srb-lock" role="note">{gearLine}</p>
    {/if}
  {/if}
</div>

{#if confirmStep !== null}
  <ActionModal title={confirmStep.title} onClose={() => (confirmStep = null)}>
    {#if confirmStep.unsaved}
      <p class="srb-confirm-text">
        This ship's current configuration is unsaved: no saved roster matches its officers and notable crew.
        Applying <strong>{pickName}</strong> will lose it.
      </p>
      <p class="srb-confirm-note">
        No one is dismissed: an officer moved out of a seat waits unassigned, and crew already aboard stay.
      </p>
    {/if}
    {#if confirmStep.pulls.length > 0}
      <p class="srb-confirm-text">Applying <strong>{pickName}</strong> pulls these people to this ship:</p>
      <ul class="srb-confirm-pulls">
        {#each confirmStep.pulls as pull (pull.id)}
          <li>{rosterPullLine(pull)}</li>
        {/each}
      </ul>
    {/if}
    <p class="srb-confirm-text">Apply anyway?</p>
    <svelte:fragment slot="footer">
      <button type="button" class="srb-btn plain" on:click={() => (confirmStep = null)}>Cancel</button>
      <button type="button" class="srb-btn danger" on:click={confirmApply}>Apply anyway</button>
    </svelte:fragment>
  </ActionModal>
{/if}

<style>
  .srb {
    margin: 0 0 12px;
    padding: 10px 12px;
    background: rgba(var(--color-accent-rgb), 0.04);
    border: 1px solid rgba(var(--color-accent-rgb), 0.14);
    border-radius: var(--corner);
    min-width: 0;
  }
  .srb-tag {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-text-dim);
    margin-bottom: 6px;
  }
  .srb-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .srb-row select {
    flex: 1 1 180px;
    min-width: 0;
    font-family: var(--font-body, inherit);
    font-size: var(--text-sm);
    color: var(--color-text-primary);
    background: var(--color-bg-mid, #0a1120);
    border: 1px solid var(--color-border-strong, rgba(var(--color-accent-rgb), 0.4));
    border-radius: var(--corner);
    padding: 6px 9px;
    min-height: 36px;
  }
  .srb-btn {
    flex: 0 0 auto;
    min-height: 36px;
    padding: 6px 14px;
    font-size: var(--text-xs);
    background: rgba(var(--color-accent-rgb), 0.16);
    border: 1px solid var(--color-accent);
    border-radius: var(--corner);
    color: var(--color-accent-bright);
    cursor: pointer;
    white-space: nowrap;
  }
  .srb-btn:hover:not(:disabled) {
    color: var(--color-text-primary);
  }
  .srb-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .srb-btn.plain {
    background: rgba(var(--color-accent-rgb), 0.08);
    border-color: rgba(var(--color-accent-rgb), 0.3);
    color: var(--color-text-secondary);
  }
  .srb-btn.danger {
    background: rgba(248, 113, 113, 0.1);
    border-color: rgba(248, 113, 113, 0.4);
    color: var(--color-danger, #f87171);
  }
  .srb-btn.danger:hover {
    background: rgba(248, 113, 113, 0.2);
  }
  .srb-lock {
    margin: 6px 0 0;
    display: flex;
    gap: 6px;
    align-items: flex-start;
    font-size: var(--text-xs);
    line-height: 1.4;
    color: var(--color-warning);
  }
  .srb-status,
  .srb-empty {
    margin: 6px 0 0;
    font-size: var(--text-xs);
    line-height: 1.4;
    color: var(--color-text-dim);
  }
  .srb-empty {
    margin: 0;
    font-style: italic;
  }
  .srb-confirm-text,
  .srb-confirm-note {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    line-height: 1.5;
  }
  .srb-confirm-note {
    font-size: var(--text-xs);
    color: var(--color-text-dim);
  }
  .srb-confirm-pulls {
    margin: 0 0 8px;
    padding-left: 18px;
    font-size: var(--text-sm);
    color: var(--color-text-primary);
    line-height: 1.5;
  }
</style>
