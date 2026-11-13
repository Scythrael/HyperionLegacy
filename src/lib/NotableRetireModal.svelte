<script lang="ts">
  // NotableRetireModal.svelte: the ONE Retire confirm for a notable crew member (CP-9, user call 2026-11-02 "Allow
  // Retire"). Moved out of ComplementPanel.svelte unchanged so the ship's Complement strip and the Personnel notable
  // band (NotableTicker.svelte, user answer 2026-11-12 "Offer Send back + Retire") ask the very same question. No
  // penalty; it frees a notable slot. The words and the gate are crewGraduation.ts canRetireNotable / retireGateText;
  // Retire routes to the host (App.svelte doRetireNotable).
  import type { GameState } from "./game/model";
  import { NOTABLE_CREW_CAP } from "./game/model";
  import { canRetireNotable, retireGateText } from "./game/crewGraduation";
  import ActionModal from "./ActionModal.svelte";
  import Icon from "./ui/Icon.svelte";
  import "./crewGroups.css";

  export let state: GameState;
  export let notableId: string;
  export let onConfirm: () => void;
  export let onClose: () => void;

  $: target = state.notableCrew.find((n) => n.id === notableId) ?? null;
  $: block = retireGateText(state, notableId, canRetireNotable(state, notableId));
  $: fleetNotables = state.notableCrew.length;
  // The notable's own ship: a missing complement reads as Auto-crew, the way the Complement tab reads it.
  $: shipId = target?.assignedShipId ?? null;
  $: ship = shipId === null ? null : (state.ships.find((s) => s.id === shipId) ?? null);
  $: autoCrewOn = (ship?.complement?.mode ?? "passive") === "passive";
</script>

{#if target !== null}
  <ActionModal title="Retire a notable" {onClose}>
    <div class="gm">
      <p class="gm-lead">Retire <b>{target.name}</b>? They leave the fleet with your thanks.</p>
      <div class="gm-delta">Notables in the fleet <s>{fleetNotables}</s> &rarr; <b>{fleetNotables - 1}</b> / {NOTABLE_CREW_CAP}</div>
      {#if block !== undefined}
        <p class="gm-warn"><Icon name="warning" size={14} /> <span>{block}.</span></p>
      {:else}
        <p class="gm-note">No penalty. {shipId === null ? "They are not aboard a ship." : autoCrewOn ? "Their berth aboard opens, and auto-crew refills it from the pool." : "Their berth aboard opens."} This cannot be undone.</p>
      {/if}
    </div>
    <svelte:fragment slot="footer">
      <button type="button" class="cg-btn ghost gm-fbtn" on:click={onClose}>Cancel</button>
      <button type="button" class="cg-btn pri gm-fbtn" disabled={block !== undefined} on:click={onConfirm}>Retire</button>
    </svelte:fragment>
  </ActionModal>
{/if}

<style>
  /* The confirm's body, as the Complement tab's Graduate and Retire sheets draw it. */
  .gm {
    display: grid;
    gap: 10px;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }
  .gm b {
    color: var(--color-text-primary);
    font-weight: 600;
  }
  .gm-lead,
  .gm-note {
    margin: 0;
    line-height: 1.45;
  }
  .gm-delta {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }
  .gm-delta s {
    color: var(--color-text-dim);
  }
  .gm-warn {
    margin: 0;
    color: var(--color-warning);
    display: flex;
    gap: 6px;
    align-items: flex-start;
  }
  /* The two buttons share the width on a phone (the bottom sheet). */
  @container (max-width: 700px) {
    .gm-fbtn {
      flex: 1;
      justify-content: center;
    }
  }
</style>
