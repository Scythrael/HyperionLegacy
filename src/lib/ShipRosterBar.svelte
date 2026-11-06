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
  //   - When the ship's officers and notable crew match no saved roster (and the pick would change them), Apply
  //     first opens the unsaved configuration warning (ActionModal, Cancel / Apply anyway), the facility's
  //     Unsaved Name pattern.
  //   - Disabled with the reason while the ship is crew-locked (CP-6) or the pick is refused by the engine.
  //   - No saved roster that carries people: a truthful empty line pointing at the facility.
  // Every decision is a pure function in shipRosterDisplay.ts (tested); this file only presents them.
  // RESPONSIVE: one DOM; the select takes the row's free width and the row wraps on a narrow screen.
  // ============================================================================

  import ActionModal from "./ActionModal.svelte";
  import Icon from "./ui/Icon.svelte";
  import type { GameState } from "./game/model";
  import {
    defaultShipRosterId,
    shipRosterApplyBlock,
    shipRosterEmptyText,
    shipRosterOptions,
    shipRosterStatusText,
    shipRosterApplyWarns,
  } from "./shipRosterDisplay";

  export let state: GameState;
  export let shipId: string;
  // Apply a roster to this ship (host: doApplyRoster).
  export let onApplyRoster: (rosterId: string, shipId: string) => void;

  // The picked roster id ("" = nothing offered). Reset to the default when the ship changes, or when the pick
  // stops being offered (deleted, or its people were turned off in the facility).
  let pickId = "";
  let lastShipId: string | null = null;
  let confirmOpen = false;

  $: options = shipRosterOptions(state);
  $: if (shipId !== lastShipId || (pickId !== "" && !options.some((o) => o.id === pickId)) || (pickId === "" && options.length > 0)) {
    lastShipId = shipId;
    pickId = defaultShipRosterId(state, shipId);
    confirmOpen = false;
  }
  $: emptyText = shipRosterEmptyText(state);
  $: statusText = shipRosterStatusText(state, shipId);
  $: block = shipRosterApplyBlock(state, shipId, pickId);
  $: pickName = options.find((o) => o.id === pickId)?.label ?? "";

  function requestApply(): void {
    if (block !== null || pickId === "") return;
    if (shipRosterApplyWarns(state, shipId, pickId)) {
      confirmOpen = true;
      return;
    }
    onApplyRoster(pickId, shipId);
  }
  function confirmApply(): void {
    confirmOpen = false;
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
    {#if block !== null && pickId !== ""}
      <p class="srb-lock" role="note">{#if block.locked}<Icon name="lock" /> {/if}{block.text}</p>
    {:else if statusText !== null}
      <p class="srb-status">{statusText}</p>
    {/if}
  {/if}
</div>

{#if confirmOpen}
  <ActionModal title="Unsaved Configuration" onClose={() => (confirmOpen = false)}>
    <p class="srb-confirm-text">
      This ship's current configuration is unsaved: no saved roster matches its officers and notable crew.
      Applying <strong>{pickName}</strong> will lose it. Apply anyway?
    </p>
    <p class="srb-confirm-note">
      No one is dismissed: an officer moved out of a seat waits unassigned, and crew already aboard stay.
    </p>
    <svelte:fragment slot="footer">
      <button type="button" class="srb-btn plain" on:click={() => (confirmOpen = false)}>Cancel</button>
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
</style>
