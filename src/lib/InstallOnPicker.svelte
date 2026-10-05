<script lang="ts">
  // ============================================================================
  // InstallOnPicker.svelte: the item-side "Install on..." picker (E-CREW 0.14.0 Task 10, S5-151).
  //
  // Opened from a SPARE in Logistics (Ship Equipment lists ships, Away-Team Gear lists crew members). The
  // rows come from installOnPicker.ts (buildInstallOnRows), built ONCE by the host when the picker opens.
  // Every target is listed; a refused one is disabled with its gate's reason as visible text tied by
  // aria-describedby, and a member whose implant slots are full offers a Swap per worn implant instead.
  // PURE PRESENTATION: a click bubbles up (onInstallShip / onInstallMember); the host re-runs the real
  // gate, installs, logs and closes. One DOM; the shared ActionModal shell is the bottom sheet on a phone
  // and the centered dialog on desktop.
  // ============================================================================
  import ActionModal from "./ActionModal.svelte";
  import type { EquipmentInstance } from "./game/model";
  import { isMemberSlotType } from "./game/model";
  import type { InstallOnRow } from "./installOnPicker";

  export let piece: EquipmentInstance;
  // The piece's player-facing name (the host's one namer, systemSalvageName).
  export let name: string;
  export let rows: InstallOnRow[];
  export let onInstallShip: (shipId: string) => void;
  // replacingInstanceId names the worn implant a targeted swap sends back to storage.
  export let onInstallMember: (memberId: string, replacingInstanceId?: string) => void;
  export let onClose: () => void;

  $: forMember = isMemberSlotType(piece.slotType);
</script>

<ActionModal title={`Install · ${name}`} ariaLabel={`Install ${name} on`} {onClose}>
  <p class="iot-lead">
    {forMember
      ? `Choose the crew member to wear the ${name}. Installing over a piece they already wear sends that piece back to storage.`
      : `Choose the ship to install the ${name} on. Installing over a system it already has sends that system back to storage.`}
  </p>
  {#if rows.length === 0}
    <p class="iot-lead">{forMember ? "No away-team members yet. Hire one from a ship's Away Team tab." : "No ships in the fleet."}</p>
  {:else}
    <div class="iot-list">
      {#each rows as row (row.key)}
        {@const whyId = `iot-why-${row.kind}-${row.targetId}`}
        <div class="iot-row" class:blocked={!row.ok}>
          <div class="iot-text">
            <span class="iot-name">{row.label}</span>
            {#if row.sub}<span class="iot-sub">{row.sub}</span>{/if}
            {#if !row.ok}<span class="iot-why" id={whyId}>{row.reason}</span>{/if}
          </div>
          {#if row.replace.length === 0}
            <button
              type="button"
              class="iot-btn"
              disabled={!row.ok}
              aria-describedby={row.ok ? undefined : whyId}
              aria-label={`Install ${name} on ${row.label}`}
              on:click={() => (row.kind === "ship" ? onInstallShip(row.targetId) : onInstallMember(row.targetId))}
            >Install</button>
          {/if}
        </div>
        {#each row.replace as rep (rep.id)}
          {@const repWhy = `iot-why-rep-${row.targetId}-${rep.id}`}
          <div class="iot-row iot-rep" class:blocked={!rep.ok}>
            <div class="iot-text">
              <span class="iot-sub">Replace {rep.name}</span>
              {#if !rep.ok}<span class="iot-why" id={repWhy}>{rep.reason}</span>{/if}
            </div>
            <button
              type="button"
              class="iot-btn"
              disabled={!rep.ok}
              aria-describedby={rep.ok ? undefined : repWhy}
              aria-label={`Swap ${rep.name} for ${name} on ${row.label}`}
              on:click={() => onInstallMember(row.targetId, rep.id)}
            >Swap</button>
          </div>
        {/each}
      {/each}
    </div>
  {/if}
  <svelte:fragment slot="footer">
    <button type="button" class="iot-cancel" on:click={onClose}>Cancel</button>
  </svelte:fragment>
</ActionModal>

<style>
  .iot-lead {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    line-height: 1.45;
    margin: 0 0 10px;
  }
  .iot-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  /* One target row: its text (name, sub-line, and the refusal reason when blocked) and its button. A
     Replace row (an implant swap) indents under its member. min-width 0 so a 375px phone never scrolls. */
  .iot-row {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    padding: 7px 9px;
    border: 1px solid rgba(var(--color-accent-rgb), 0.16);
    border-radius: var(--corner);
    background: rgba(var(--color-accent-rgb), 0.04);
  }
  .iot-row.blocked {
    opacity: 0.8;
  }
  .iot-rep {
    margin-left: 18px;
    border-style: dashed;
  }
  .iot-text {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .iot-name {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--color-text-primary);
    overflow-wrap: anywhere;
  }
  .iot-sub {
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
    overflow-wrap: anywhere;
  }
  .iot-why {
    font-size: var(--text-2xs);
    color: var(--color-warning);
  }
  /* The App's .buy-btn look (its styles are scoped to App.svelte), so the picker reads the same. */
  .iot-btn {
    flex: 0 0 auto;
    white-space: nowrap;
    background: rgba(var(--color-accent-rgb), 0.15);
    border: 1px solid var(--color-border-strong);
    padding: 8px 10px;
    color: var(--color-accent-bright);
    font-size: var(--text-sm);
    font-family: var(--font-mono);
    cursor: pointer;
  }
  .iot-btn:hover:not(:disabled) {
    border-color: var(--color-accent);
  }
  /* A refused target: faded fill and border with the AA-safe --color-text-disabled label (never a
     whole-button opacity, which would drop the label below 4.5:1, the 0.13.5 disabled-contrast fix). */
  .iot-btn:disabled {
    background: rgba(var(--color-accent-rgb), 0.03);
    border-color: rgba(var(--color-accent-rgb), 0.15);
    color: var(--color-text-disabled);
    cursor: not-allowed;
  }
  .iot-cancel {
    padding: 6px 12px;
    font-size: var(--text-sm);
    font-family: inherit;
    background: rgba(var(--color-accent-rgb), 0.06);
    border: 1px solid rgba(var(--color-accent-rgb), 0.3);
    border-radius: var(--corner);
    color: var(--color-text-secondary);
    cursor: pointer;
  }
  .iot-cancel:hover {
    color: var(--color-text-primary);
    border-color: var(--color-accent);
  }
  .iot-btn:focus-visible,
  .iot-cancel:focus-visible {
    outline: 1px solid var(--color-accent);
    outline-offset: 2px;
  }
</style>
