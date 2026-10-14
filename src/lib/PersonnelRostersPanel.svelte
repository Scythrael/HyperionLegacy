<script lang="ts">
  // ============================================================================
  // PersonnelRostersPanel.svelte
  // Author: Claude (Opus 4.8) | Crew 0.14.0 phase 4d (Personnel Rosters facility UI)
  //
  // The player-facing PERSONNEL ROSTERS facility screen: saved, named PEOPLE loadouts
  // (the personnel counterpart to an Armory Loadout, which saves GEAR). A roster pins
  // officers by seat + notable crew in a reorderable PRIORITY order, optionally links to
  // an Armory loadout for exact caps + gear, and is APPLIED to a ship (the priority list
  // fills each rank up to cap, then randoms auto-fill the rest, not persisted). It mirrors
  // SeniorStaffPanel / ComplementPanel's posture exactly:
  //   - PURE PRESENTATION + INTERACTION. It READS live state (state.personnelRosters,
  //     state.loadouts, state.officers, state.notableCrew) and never reimplements game
  //     logic or mutates state directly. Every side effect bubbles UP to the host
  //     (App.svelte) via callbacks that run the pure personnelRosters.ts engine fns +
  //     doSave + pushLog in one place. When the host reassigns `state`, every derived
  //     value below recomputes.
  //   - RESPONSIVE via CSS CONTAINER-QUERIES ONLY (the ShipSystemsPanel way): ONE shared
  //     DOM tree. The outer wrap is a container-query context (container-type: inline-size);
  //     a wide container lays the saved-rosters LIST beside the EDITOR, a narrow one stacks
  //     them. The pool sub-grid collapses the same way. There is NO isMobile JS branch.
  //
  // EDITING MODEL: the roster's structural fields (loadout link, include-people, seat
  // assignments, pinned notables + their order) are edited LIVE, each control routing to a
  // per-field do* handler that persists immediately (the game's norm: installs, favorites,
  // etc. all live). The NAME is the one DEFERRED field: it edits a local draft committed by
  // the Update button (ActionModal confirm). That deferred name is what the dirty flag +
  // the unsaved-swap warning track (selecting a different roster while the typed name is
  // uncommitted raises a Discard / Cancel modal). Save New mints a fresh roster; Delete
  // removes one (ActionModal confirm); Apply lands the selected roster's people on a ship.
  //
  // COMPLEMENT PRIORITY MODEL (user 2026-09-24): officers pin by SEAT, notable crew pin by
  // id in a reorderable PRIORITY list; the fungible BULK complement is not individually
  // pinnable and simply auto-fills to cap honoring the pins on apply.
  // ============================================================================

  import ActionModal from "./ActionModal.svelte";
  import type {
    GameState,
    PersonnelRoster,
    SeniorStaffOfficer,
    NotableCrewMember,
    SeniorStaffSeat,
    Loadout,
  } from "./game/model";
  import { SHIP_TYPES } from "./game/model";
  import { SENIOR_STAFF_SEATS, officerRankLabel } from "./game/seniorStaff";
  import { crewRankLabel } from "./game/crewRank";
  import { complementTotalCap } from "./game/commandStructure";
  import { CREW_RACES } from "./game/crewRaces";

  // --- Props ------------------------------------------------------------------
  // `state` is the whole GameState (read-only here). Every callback routes a mutation back
  // to the host's do* handlers (pure personnelRosters.ts engine + doSave + pushLog).
  export let state: GameState;
  // Save New: mint a fresh roster from the given fields (host: createRoster).
  export let onCreateRoster: (opts: {
    name: string;
    linkedLoadoutId: string | null;
    includePeople: boolean;
  }) => void;
  // Update: commit the deferred name to a saved roster (host: updateRoster, name patch).
  export let onUpdateRoster: (rosterId: string, patch: { name: string }) => void;
  // Delete a saved roster (host: deleteRoster). Confirmed via ActionModal.
  export let onDeleteRoster: (rosterId: string) => void;
  // Set / clear the Armory-loadout link (host: setLinkedLoadout).
  export let onSetLoadout: (rosterId: string, linkedLoadoutId: string | null) => void;
  // Toggle whether the roster carries Senior Staff + Complement (host: setIncludePeople).
  export let onSetIncludePeople: (rosterId: string, includePeople: boolean) => void;
  // Pin / clear the officer for a seat (host: assignSeat). officerId null clears the seat.
  export let onAssignSeat: (
    rosterId: string,
    seat: SeniorStaffSeat,
    officerId: string | null,
  ) => void;
  // Pin a notable to the roster at lowest priority (host: pinNotable).
  export let onPinNotable: (rosterId: string, notableId: string) => void;
  // Unpin a notable (host: unpinNotable).
  export let onUnpinNotable: (rosterId: string, notableId: string) => void;
  // Move a pinned notable one step up / down in priority (host: moveNotableUp / moveNotableDown).
  export let onReorderNotable: (rosterId: string, notableId: string, dir: "up" | "down") => void;
  // Apply the roster's people to a ship (host: applyRoster).
  export let onApplyRoster: (rosterId: string, shipId: string) => void;
  // Toggle a bridge officer's / notable crew member's `favorite` curation flag (host:
  // toggleOfficerFavorite / toggleNotableFavorite + doSave). Cosmetic: nothing mechanical reads it;
  // it curates the sort/pin affordances the builder surfaces.
  export let onToggleOfficerFavorite: (officerId: string) => void;
  export let onToggleNotableFavorite: (notableId: string) => void;

  // --- Local UI state ---------------------------------------------------------
  // The selected saved roster's id (null = nothing selected / build a new one).
  let selectedId: string | null = null;
  // The name text input's live value (DEFERRED: committed via Update). Kept in sync with the
  // selected roster's saved name whenever the selection changes (the guard block below).
  let draftName = "";
  // The Apply target ship id.
  let applyShipId = "";
  // Modal drivers.
  let confirmUpdate = false; // Update confirm open
  let confirmDeleteId: string | null = null; // roster pending a Delete confirm
  let pendingSwapId: string | null = null; // roster the user tried to switch to while dirty

  // After a Save New, auto-select the newest roster once state carries it. Holds the roster
  // count captured at create time; the reactive below selects the appended roster when the
  // count grows past it (createRoster appends, so the newest is the last entry).
  let selectNewestFrom: number | null = null;

  // --- Selection sync ---------------------------------------------------------
  $: rosters = state.personnelRosters;
  $: selectedRoster = selectedId !== null ? rosters.find((r) => r.id === selectedId) ?? null : null;

  // Reset the deferred name + default the Apply ship whenever the SELECTED roster changes
  // (mirrors SeniorStaffPanel's lastShipId guard, so nothing stale carries across a switch).
  let lastSelectedId: string | null = null;
  $: if (selectedId !== lastSelectedId) {
    lastSelectedId = selectedId;
    draftName = selectedRoster?.name ?? "";
    applyShipId = defaultApplyShipId(selectedRoster);
  }

  // Auto-select the roster Save New just appended once it lands in state.
  $: if (selectNewestFrom !== null && rosters.length > selectNewestFrom) {
    selectedId = rosters[rosters.length - 1].id;
    selectNewestFrom = null;
  }

  // The linked loadout's checked-out ship (if any) is the natural Apply default; else the
  // first ship in the fleet. Pure.
  function defaultApplyShipId(roster: PersonnelRoster | null): string {
    if (roster?.linkedLoadoutId) {
      const lo = state.loadouts.find((l) => l.id === roster.linkedLoadoutId);
      if (lo?.checkedOutToShipId) return lo.checkedOutToShipId;
    }
    return state.ships[0]?.id ?? "";
  }

  // DIRTY = a saved roster is selected and its typed name differs from the saved one (the
  // only deferred field). Drives the Update button's enabled state + the unsaved-swap warning.
  $: dirty = selectedRoster !== null && draftName.trim() !== "" && draftName.trim() !== selectedRoster.name;

  // --- Static display metadata ------------------------------------------------
  const SEAT_LABEL: Record<SeniorStaffSeat, string> = {
    executive: "Executive Officer",
    pilot: "Pilot",
    operations: "Operations",
    science: "Science",
    tactical: "Tactical",
    medical: "Medical",
    engineering: "Engineering",
  };

  // --- Derived reads ----------------------------------------------------------
  // Every officer, indexed by id (seat rows resolve the pinned id to a name/rank/favorite).
  $: officerById = new Map<string, SeniorStaffOfficer>(state.officers.map((o) => [o.id, o]));
  // Every notable, indexed by id (the priority list resolves pinned ids to records).
  $: notableById = new Map<string, NotableCrewMember>(state.notableCrew.map((n) => [n.id, n]));

  // Officers assignable to each seat (the seat is TYPED; only matching officers may fill it).
  function officersForSeat(seat: SeniorStaffSeat): SeniorStaffOfficer[] {
    return state.officers.filter((o) => o.seat === seat);
  }

  // The selected roster's pinned notables, resolved to records IN PRIORITY ORDER (a missing
  // id is skipped safely, mirroring the engine's skip-on-missing posture).
  $: pinnedNotables =
    selectedRoster && selectedRoster.includePeople
      ? selectedRoster.pinnedNotableCrew
          .map((id) => notableById.get(id))
          .filter((n): n is NotableCrewMember => n !== undefined)
      : [];

  // The available notable pool = notables NOT already pinned to this roster (add candidates).
  $: notablePool =
    selectedRoster && selectedRoster.includePeople
      ? state.notableCrew.filter((n) => !selectedRoster!.pinnedNotableCrew.includes(n.id))
      : [];

  // The linked loadout record (or null when unlinked / dangling).
  $: linkedLoadout =
    selectedRoster?.linkedLoadoutId != null
      ? state.loadouts.find((l) => l.id === selectedRoster!.linkedLoadoutId) ?? null
      : null;

  // --- Display helpers --------------------------------------------------------
  function raceLabel(race: string): string {
    return CREW_RACES[race as keyof typeof CREW_RACES]?.label ?? race;
  }
  function shipTypeLabel(key: string): string {
    return SHIP_TYPES[key as keyof typeof SHIP_TYPES]?.label ?? key;
  }
  // A loadout's committed-systems count (a compact gear summary for the loadout card).
  function committedSystemCount(lo: Loadout): number {
    return Object.values(lo.slots).filter((v) => v !== null).length;
  }
  function shipLabel(shipId: string): string {
    const ship = state.ships.find((s) => s.id === shipId);
    if (!ship) return shipId;
    return ship.name ?? shipTypeLabel(ship.typeKey);
  }

  // --- Actions (route to the host / manage local UI state) --------------------
  // Select a roster row. If the deferred name is dirty, intercept with the unsaved-swap
  // warning instead of switching immediately.
  function selectRoster(id: string): void {
    if (id === selectedId) return;
    if (dirty) {
      pendingSwapId = id;
      return;
    }
    selectedId = id;
  }
  function confirmSwap(): void {
    if (pendingSwapId !== null) {
      selectedId = pendingSwapId; // the selection guard resets draftName to the saved name
      pendingSwapId = null;
    }
  }
  function cancelSwap(): void {
    pendingSwapId = null;
  }

  function saveNew(): void {
    // Mint a fresh roster from the typed name (or a default) as a portable, people-carrying
    // roster to then build up live. Capture the count so the reactive selects it on arrival.
    selectNewestFrom = rosters.length;
    onCreateRoster({
      name: draftName.trim() || "New Roster",
      linkedLoadoutId: null,
      includePeople: true,
    });
  }
  function requestUpdate(): void {
    if (selectedRoster !== null && dirty) confirmUpdate = true;
  }
  function doConfirmUpdate(): void {
    if (selectedRoster !== null) onUpdateRoster(selectedRoster.id, { name: draftName.trim() });
    confirmUpdate = false;
  }
  function requestDelete(): void {
    if (selectedRoster !== null) confirmDeleteId = selectedRoster.id;
  }
  function doConfirmDelete(): void {
    if (confirmDeleteId !== null) {
      onDeleteRoster(confirmDeleteId);
      if (selectedId === confirmDeleteId) selectedId = null;
      confirmDeleteId = null;
    }
  }

  // Link checkbox: on -> link the first available loadout (or leave the select to refine);
  // off -> clear the link. The select refines which loadout while linked.
  function toggleLink(on: boolean): void {
    if (selectedRoster === null) return;
    if (on) {
      const first = state.loadouts[0];
      onSetLoadout(selectedRoster.id, first ? first.id : null);
    } else {
      onSetLoadout(selectedRoster.id, null);
    }
  }
  function setLoadout(loadoutId: string): void {
    if (selectedRoster === null) return;
    onSetLoadout(selectedRoster.id, loadoutId || null);
  }
  function setIncludePeople(on: boolean): void {
    if (selectedRoster !== null) onSetIncludePeople(selectedRoster.id, on);
  }
  function assignSeat(seat: SeniorStaffSeat, officerId: string): void {
    if (selectedRoster !== null) onAssignSeat(selectedRoster.id, seat, officerId || null);
  }
  function pinNotable(notableId: string): void {
    if (selectedRoster !== null) onPinNotable(selectedRoster.id, notableId);
  }
  function unpinNotable(notableId: string): void {
    if (selectedRoster !== null) onUnpinNotable(selectedRoster.id, notableId);
  }
  function moveNotable(notableId: string, dir: "up" | "down"): void {
    if (selectedRoster !== null) onReorderNotable(selectedRoster.id, notableId, dir);
  }
  function applyToShip(): void {
    if (selectedRoster !== null && applyShipId) onApplyRoster(selectedRoster.id, applyShipId);
  }

  // The pending-swap modal needs the target roster's name for the message.
  $: swapTargetName =
    pendingSwapId !== null ? rosters.find((r) => r.id === pendingSwapId)?.name ?? "" : "";
  $: deleteTargetName =
    confirmDeleteId !== null ? rosters.find((r) => r.id === confirmDeleteId)?.name ?? "" : "";
</script>

<div class="pr">
  <!-- LEFT: the saved-rosters list + the row of Save New / Update / Delete controls. -->
  <div class="pr-list">
    <div class="pr-section-tag">Saved Rosters</div>
    {#if rosters.length === 0}
      <div class="pr-empty-hint">No rosters yet. Save New starts one.</div>
    {:else}
      <div class="pr-list-rows">
        {#each rosters as r (r.id)}
          {@const linkedLo = r.linkedLoadoutId != null ? state.loadouts.find((l) => l.id === r.linkedLoadoutId) : null}
          <button
            type="button"
            class="pr-item"
            class:active={selectedId === r.id}
            on:click={() => selectRoster(r.id)}
          >
            <span class="pr-item-main">
              <span class="pr-item-name">{r.name}</span>
              <span class="pr-item-link">
                {r.linkedLoadoutId != null
                  ? (linkedLo ? linkedLo.name : "linked loadout (missing)")
                  : "portable / no link"}
              </span>
            </span>
            <span class="pr-badge">{r.includePeople ? "+ people" : "loadout only"}</span>
          </button>
        {/each}
      </div>
    {/if}
    <div class="pr-rowbtns">
      <button type="button" class="pr-btn primary" on:click={saveNew}>Save New</button>
      <button type="button" class="pr-btn" disabled={!dirty} on:click={requestUpdate}>Update</button>
      <button type="button" class="pr-btn danger" disabled={selectedRoster === null} on:click={requestDelete}>
        Delete
      </button>
    </div>
  </div>

  <!-- RIGHT: the editor for the selected roster. -->
  <div class="pr-editor">
    {#if selectedRoster === null}
      <div class="pr-empty-hint">
        Select a roster to edit it, or press Save New to start one. A roster saves a ship's PEOPLE
        (bridge officers + notable crew, in priority order); a linked Armory loadout adds its ship +
        gear + exact caps.
      </div>
    {:else}
      {@const roster = selectedRoster}
      <div class="pr-section-tag">
        <span>Edit Roster</span>
        {#if dirty}<span class="pr-unsaved">unsaved name</span>{/if}
      </div>

      <!-- NAME (deferred: committed by Update) -->
      <div class="pr-field">
        <label for="pr-name">Roster name</label>
        <input id="pr-name" type="text" bind:value={draftName} placeholder="Roster name" />
      </div>

      <!-- LINK an Armory loadout -->
      <label class="pr-chk">
        <input
          type="checkbox"
          checked={roster.linkedLoadoutId != null}
          on:change={(e) => toggleLink(e.currentTarget.checked)}
        />
        Link an Armory loadout (exact caps + gear travel with it)
      </label>

      {#if roster.linkedLoadoutId != null}
        <div class="pr-field">
          <label for="pr-loadout">Armory loadout</label>
          {#if state.loadouts.length === 0}
            <div class="pr-empty-hint">No Armory loadouts exist yet. Build one in the Armory first.</div>
          {:else}
            <select id="pr-loadout" value={roster.linkedLoadoutId} on:change={(e) => setLoadout(e.currentTarget.value)}>
              {#each state.loadouts as lo (lo.id)}
                <option value={lo.id}>{lo.name} ({shipTypeLabel(lo.shipTypeKey)})</option>
              {/each}
            </select>
          {/if}
          {#if linkedLoadout}
            <div class="pr-loadout-card">
              <div class="pr-loadout-h">
                <span class="pr-loadout-t">{shipTypeLabel(linkedLoadout.shipTypeKey)}</span>
                <span class="pr-loadout-cap">{complementTotalCap(linkedLoadout.shipTypeKey, 0)} base berths</span>
              </div>
              <div class="pr-loadout-gear">
                {committedSystemCount(linkedLoadout)} system{committedSystemCount(linkedLoadout) === 1 ? "" : "s"} committed{linkedLoadout.checkedOutToShipId
                  ? ` · in use: ${shipLabel(linkedLoadout.checkedOutToShipId)}`
                  : " · available"}
              </div>
            </div>
          {/if}
        </div>
      {:else}
        <div class="pr-loadout-card portable">
          <div class="pr-loadout-h">
            <span class="pr-loadout-t">Portable roster</span>
            <span class="pr-loadout-cap">no link</span>
          </div>
          <div class="pr-loadout-gear">
            Capped by whichever hull you apply it to. Its per-rank caps come from that ship.
          </div>
        </div>
      {/if}

      <!-- INCLUDE Senior Staff & Complement -->
      <label class="pr-chk">
        <input
          type="checkbox"
          checked={roster.includePeople}
          on:change={(e) => setIncludePeople(e.currentTarget.checked)}
        />
        Include Senior Staff &amp; Complement
      </label>

      {#if roster.includePeople}
        <!-- SENIOR STAFF SEATS: each seat picks an officer of its type (or empty). -->
        <div class="pr-block-tag">Senior Staff seats</div>
        <div class="pr-seats">
          {#each SENIOR_STAFF_SEATS as seat (seat)}
            {@const assignedId = roster.seatAssignments[seat] ?? ""}
            {@const assigned = assignedId ? officerById.get(assignedId) : undefined}
            {@const options = officersForSeat(seat)}
            <div class="pr-seat">
              <span class="pr-seat-name">
                {SEAT_LABEL[seat]}
                {#if assigned}
                  <button
                    type="button"
                    class="pr-star"
                    class:on={assigned.favorite}
                    aria-label="Toggle favorite"
                    aria-pressed={assigned.favorite === true}
                    title={assigned.favorite ? "Favorited" : "Favorite this officer"}
                    on:click={() => onToggleOfficerFavorite(assigned.id)}
                  >{assigned.favorite ? "★" : "☆"}</button>
                {/if}
              </span>
              <select
                value={assignedId}
                aria-label={`${SEAT_LABEL[seat]} officer`}
                on:change={(e) => assignSeat(seat, e.currentTarget.value)}
              >
                <option value="">— empty —</option>
                {#each options as o (o.id)}
                  <option value={o.id}>{o.name} · {officerRankLabel(o.rank)}</option>
                {/each}
              </select>
            </div>
          {/each}
        </div>

        <!-- CREW PRIORITY ORDER: the pinned notable-crew list, reorderable. -->
        <div class="pr-block-tag">
          Crew priority order
          <span class="pr-block-hint">{pinnedNotables.length} pinned</span>
        </div>
        {#if pinnedNotables.length === 0}
          <div class="pr-empty-hint">No crew pinned yet: add from the pool below.</div>
        {:else}
          <div class="pr-plist">
            {#each pinnedNotables as n, i (n.id)}
              <div class="pr-pentry">
                <span class="pr-posn">#{i + 1}</span>
                <span class="pr-pin">
                  <span class="pr-pin-name">
                    {n.name}<button
                      type="button"
                      class="pr-star"
                      class:on={n.favorite}
                      aria-label="Toggle favorite"
                      aria-pressed={n.favorite === true}
                      title={n.favorite ? "Favorited" : "Favorite this crew member"}
                      on:click={() => onToggleNotableFavorite(n.id)}
                    >{n.favorite ? "★" : "☆"}</button>
                  </span>
                  <span class="pr-pin-sub">{crewRankLabel(n.rank)} · {raceLabel(n.race)}</span>
                </span>
                <span class="pr-reorder">
                  <button
                    type="button"
                    aria-label={`Move ${n.name} up`}
                    disabled={i === 0}
                    on:click={() => moveNotable(n.id, "up")}
                  >▲</button>
                  <button
                    type="button"
                    aria-label={`Move ${n.name} down`}
                    disabled={i === pinnedNotables.length - 1}
                    on:click={() => moveNotable(n.id, "down")}
                  >▼</button>
                </span>
                <button type="button" class="pr-mini" on:click={() => unpinNotable(n.id)}>remove</button>
              </div>
            {/each}
          </div>
        {/if}

        <!-- AVAILABLE POOL: notable crew not yet pinned -> Add. -->
        <div class="pr-pool">
          <div class="pr-block-tag">Available pool</div>
          {#if notablePool.length === 0}
            <div class="pr-empty-hint">No more notable crew to add.</div>
          {:else}
            <div class="pr-pool-rows">
              {#each notablePool as n (n.id)}
                <div class="pr-pcrew">
                  <button
                    type="button"
                    class="pr-star"
                    class:on={n.favorite}
                    aria-label="Toggle favorite"
                    aria-pressed={n.favorite === true}
                    title={n.favorite ? "Favorited" : "Favorite this crew member"}
                    on:click={() => onToggleNotableFavorite(n.id)}
                  >{n.favorite ? "★" : "☆"}</button>
                  <span class="pr-pin">
                    <span class="pr-pin-name">{n.name}</span>
                    <span class="pr-pin-sub">{crewRankLabel(n.rank)} · {raceLabel(n.race)}</span>
                  </span>
                  <button type="button" class="pr-mini" on:click={() => pinNotable(n.id)}>add ↓</button>
                </div>
              {/each}
            </div>
          {/if}
        </div>

        <p class="pr-fillnote">
          Applying this roster assigns the priority list <b>in order</b>, filling each rank up to the
          ship's cap. The remaining berths <b>auto-fill with random crew</b> on use and are <b>not</b>
          written back to the saved roster.
        </p>
      {:else}
        <div class="pr-empty-hint">
          People not included: this roster only carries the ship + equipment loadout link.
        </div>
      {/if}

      <!-- APPLY to a ship -->
      <div class="pr-apply">
        <div class="pr-block-tag">Apply to ship</div>
        {#if state.ships.length === 0}
          <div class="pr-empty-hint">No ships in the fleet to apply to yet.</div>
        {:else}
          <div class="pr-apply-row">
            <select bind:value={applyShipId} aria-label="Apply target ship">
              {#each state.ships as s (s.id)}
                <option value={s.id}>{s.name ?? shipTypeLabel(s.typeKey)}</option>
              {/each}
            </select>
            <button
              type="button"
              class="pr-btn primary"
              disabled={!applyShipId || !roster.includePeople}
              title={roster.includePeople ? "Apply this roster's people to the ship" : "This roster carries no people to apply"}
              on:click={applyToShip}
            >
              Apply
            </button>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>

<!-- UPDATE confirm -->
{#if confirmUpdate && selectedRoster !== null}
  <ActionModal title="Update Roster" onClose={() => (confirmUpdate = false)}>
    <p class="pr-confirm-text">
      Save the name <strong>{draftName.trim()}</strong> to this roster? Its officers, crew, and links
      are already saved.
    </p>
    <svelte:fragment slot="footer">
      <button type="button" class="pr-btn" on:click={() => (confirmUpdate = false)}>Cancel</button>
      <button type="button" class="pr-btn primary" on:click={doConfirmUpdate}>Update</button>
    </svelte:fragment>
  </ActionModal>
{/if}

<!-- DELETE confirm -->
{#if confirmDeleteId !== null}
  <ActionModal title="Delete Roster" onClose={() => (confirmDeleteId = null)}>
    <p class="pr-confirm-text">
      Delete the roster <strong>{deleteTargetName}</strong>? This removes the saved personnel
      configuration. Ships already crewed from it keep their crew.
    </p>
    <svelte:fragment slot="footer">
      <button type="button" class="pr-btn" on:click={() => (confirmDeleteId = null)}>Cancel</button>
      <button type="button" class="pr-btn danger" on:click={doConfirmDelete}>Delete</button>
    </svelte:fragment>
  </ActionModal>
{/if}

<!-- UNSAVED-SWAP warning -->
{#if pendingSwapId !== null}
  <ActionModal title="Unsaved Name" onClose={cancelSwap}>
    <p class="pr-confirm-text">
      This roster's name has an unsaved change. Switching to <strong>{swapTargetName}</strong> will
      discard the typed name. Discard it?
    </p>
    <svelte:fragment slot="footer">
      <button type="button" class="pr-btn" on:click={cancelSwap}>Cancel</button>
      <button type="button" class="pr-btn danger" on:click={confirmSwap}>Discard</button>
    </svelte:fragment>
  </ActionModal>
{/if}

<style>
  /* CONTAINER-QUERY MASTER-DETAIL (mirrors ShipSystemsPanel / SeniorStaffPanel / ComplementPanel).
     The wrap is the container the queries key off, so the layout responds to the panel's OWN width,
     not the viewport. DEFAULT: a single stacked column. */
  .pr {
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .pr-list,
  .pr-editor {
    min-width: 0;
    padding: 12px;
    background: rgba(var(--color-accent-rgb), 0.04);
    border: 1px solid rgba(var(--color-accent-rgb), 0.14);
    border-radius: var(--corner);
  }
  /* WIDE container: the saved-rosters list beside the editor (the mockup's .rgrid 1fr / 1.3fr). */
  @container (min-width: 640px) {
    .pr {
      flex-direction: row;
      align-items: flex-start;
    }
    .pr-list {
      flex: 0 0 34%;
    }
    .pr-editor {
      flex: 1 1 auto;
    }
  }

  .pr-section-tag,
  .pr-block-tag {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-accent-bright);
    margin-bottom: 8px;
  }
  .pr-block-tag {
    margin-top: 12px;
    color: var(--color-text-dim);
  }
  .pr-block-hint {
    color: var(--color-text-dim);
    letter-spacing: 0.02em;
    text-transform: none;
  }
  .pr-unsaved {
    color: var(--color-warning, #fbbf24);
    letter-spacing: 0.04em;
    text-transform: none;
  }

  /* SAVED-ROSTERS LIST */
  .pr-list-rows {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .pr-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 9px;
    text-align: left;
    background: rgba(var(--color-accent-rgb), 0.05);
    border: 1px solid rgba(var(--color-accent-rgb), 0.16);
    border-radius: var(--corner);
    color: var(--color-text-secondary);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .pr-item:hover {
    border-color: rgba(var(--color-accent-rgb), 0.4);
  }
  .pr-item.active {
    border-color: var(--color-accent);
    background: rgba(var(--color-accent-rgb), 0.14);
  }
  .pr-item-main {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .pr-item-name {
    font-size: var(--text-sm);
    color: var(--color-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pr-item-link {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pr-badge {
    flex: 0 0 auto;
    font-family: var(--font-mono);
    font-size: calc(9px * var(--ui-scale));
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--color-text-dim);
    border: 1px solid rgba(var(--color-accent-rgb), 0.2);
    padding: 1px 5px;
    border-radius: var(--corner);
  }
  .pr-rowbtns {
    display: flex;
    gap: 6px;
    margin-top: 10px;
    flex-wrap: wrap;
  }

  /* FIELDS */
  .pr-field {
    margin-bottom: 11px;
  }
  .pr-field label {
    display: block;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-text-dim);
    margin-bottom: 4px;
  }
  .pr-field input[type="text"],
  .pr-field select,
  .pr-seat select,
  .pr-apply-row select {
    width: 100%;
    font-family: var(--font-body, inherit);
    font-size: var(--text-sm);
    color: var(--color-text-primary);
    background: var(--color-bg-mid, #0a1120);
    border: 1px solid var(--color-border-strong, rgba(var(--color-accent-rgb), 0.4));
    border-radius: var(--corner);
    padding: 6px 9px;
  }
  .pr-chk {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 11px;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    cursor: pointer;
  }
  .pr-chk input {
    width: 16px;
    height: 16px;
    accent-color: var(--color-accent);
    flex: 0 0 auto;
  }

  /* LOADOUT CARD */
  .pr-loadout-card {
    margin-bottom: 11px;
    padding: 9px 10px;
    background: rgba(var(--color-accent-rgb), 0.06);
    border: 1px solid var(--color-border-strong, rgba(var(--color-accent-rgb), 0.4));
    border-radius: var(--corner);
    font-size: var(--text-xs);
  }
  .pr-loadout-card.portable {
    border-style: dashed;
  }
  .pr-loadout-h {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
  }
  .pr-loadout-t {
    color: var(--color-text-primary);
    font-weight: 600;
  }
  .pr-loadout-cap {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--color-accent);
  }
  .pr-loadout-gear {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
    margin-top: 5px;
  }

  /* SEAT ASSIGNMENTS */
  .pr-seats {
    display: grid;
    grid-template-columns: 1fr;
    gap: 8px;
  }
  @container (min-width: 460px) {
    .pr-seats {
      grid-template-columns: 1fr 1fr;
    }
  }
  .pr-seat {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .pr-seat-name {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--color-text-dim);
    display: flex;
    align-items: center;
    gap: 5px;
  }

  /* PRIORITY LIST */
  .pr-plist {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .pr-pentry,
  .pr-pcrew {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    background: rgba(var(--color-accent-rgb), 0.05);
    border: 1px solid rgba(var(--color-accent-rgb), 0.16);
    border-radius: var(--corner);
    font-size: var(--text-xs);
  }
  .pr-posn {
    flex: 0 0 auto;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--color-accent);
    border: 1px solid var(--color-border-strong, rgba(var(--color-accent-rgb), 0.4));
    border-radius: var(--corner);
    padding: 1px 4px;
    min-width: 26px;
    text-align: center;
  }
  .pr-pin {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .pr-pin-name {
    color: var(--color-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pr-pin-sub {
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
  }
  .pr-reorder {
    display: flex;
    flex-direction: column;
    gap: 1px;
    flex: 0 0 auto;
  }
  .pr-reorder button {
    font-size: calc(8px * var(--ui-scale));
    line-height: 1;
    color: var(--color-text-secondary);
    background: none;
    border: 1px solid rgba(var(--color-accent-rgb), 0.2);
    border-radius: 1px;
    cursor: pointer;
    padding: 2px 5px;
  }
  .pr-reorder button:hover:not(:disabled) {
    color: var(--color-accent);
    border-color: var(--color-accent);
  }
  .pr-reorder button:disabled {
    opacity: 0.3;
    cursor: default;
  }
  .pr-mini {
    flex: 0 0 auto;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--color-accent);
    background: none;
    border: 1px solid rgba(var(--color-accent-rgb), 0.24);
    border-radius: var(--corner);
    padding: 3px 7px;
    cursor: pointer;
  }
  .pr-mini:hover {
    background: rgba(var(--color-accent-rgb), 0.12);
  }

  /* AVAILABLE POOL */
  .pr-pool {
    margin-top: 4px;
  }
  .pr-pool-rows {
    display: grid;
    grid-template-columns: 1fr;
    gap: 5px;
  }
  @container (min-width: 520px) {
    .pr-pool-rows {
      grid-template-columns: 1fr 1fr;
    }
  }

  .pr-star {
    flex: 0 0 auto;
    background: none;
    border: none;
    padding: 0 2px;
    line-height: 1;
    color: var(--color-text-dim);
    font-size: var(--text-xs);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .pr-star.on {
    color: var(--color-warning, #fbbf24);
  }
  .pr-star:hover,
  .pr-star:focus-visible {
    color: var(--color-warning, #fbbf24);
  }

  .pr-fillnote {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
    line-height: 1.55;
    margin: 12px 0 0;
    padding-top: 10px;
    border-top: 1px dashed rgba(var(--color-accent-rgb), 0.3);
  }
  .pr-fillnote b {
    color: var(--color-accent-bright);
  }

  /* APPLY */
  .pr-apply {
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px solid rgba(var(--color-accent-rgb), 0.14);
  }
  .pr-apply-row {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .pr-apply-row select {
    flex: 1 1 auto;
  }

  /* BUTTONS */
  .pr-btn {
    flex: 0 0 auto;
    padding: 6px 12px;
    font-size: var(--text-xs);
    background: rgba(var(--color-accent-rgb), 0.08);
    border: 1px solid rgba(var(--color-accent-rgb), 0.3);
    border-radius: var(--corner);
    color: var(--color-text-secondary);
    cursor: pointer;
    white-space: nowrap;
  }
  .pr-btn:hover:not(:disabled) {
    color: var(--color-text-primary);
    border-color: var(--color-accent);
  }
  .pr-btn.primary {
    background: rgba(var(--color-accent-rgb), 0.16);
    color: var(--color-accent-bright);
    border-color: var(--color-accent);
  }
  .pr-btn.danger {
    background: rgba(248, 113, 113, 0.1);
    border-color: rgba(248, 113, 113, 0.4);
    color: var(--color-danger, #f87171);
  }
  .pr-btn.danger:hover:not(:disabled) {
    background: rgba(248, 113, 113, 0.2);
  }
  .pr-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  /* HINTS + MODAL TEXT */
  .pr-empty-hint {
    font-size: var(--text-xs);
    color: var(--color-text-dim);
    font-style: italic;
    line-height: 1.5;
    padding: 4px 0;
  }
  .pr-confirm-text {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    line-height: 1.5;
  }
</style>
