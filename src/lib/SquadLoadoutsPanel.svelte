<script lang="ts">
  // ============================================================================
  // SquadLoadoutsPanel.svelte
  // Ground Operations GO-17 UI half (0.14.0): the Armory's "Squad Loadouts" tab, beside Ship Loadouts.
  // Built from the approved squad loadouts mockup (user S14 "All as proposed"):
  //   - the shared count (ship + squad loadouts draw from ONE cap, armory.ts loadoutsUsed), filter chips by
  //     team type, and one card per loadout: kind chip (glyph + word), per-slot kit summary, the status
  //     ("Worn by Kestrel · Alpha" / "In the locker · N pieces"), Check in / Put on a team / Rename / Delete;
  //   - "Save a team's gear": ship + team pickers, a name (default team name + type), and a per-slot preview
  //     table that scrolls inside its own box; an empty slot saves an empty kit;
  //   - "Put it on a team": only teams of the loadout's own type are enabled, the others are disabled WITH
  //     the reason as text; the install report lists what went on and what was skipped and why (never forced;
  //     an empty slot leaves its kit in the locker).
  // A worn loadout whose team no longer matches (ship gone, team type changed) still lists, says why, and
  // keeps its Check in, the way back. Every action refuses while a ship involved is out (crew lock); the lock
  // reason shows as text beside the disabled control.
  //
  // POSTURE (mirrors PersonnelRostersPanel / AwayTeamPanel): PURE PRESENTATION. Every display decision is in
  // squadLoadoutDisplay.ts (tested); every write bubbles up to an App.svelte do* handler over the pure
  // armory.ts action, which returns the engine result so this panel can show the report. Responsive by
  // container queries, ONE DOM: on a narrow panel the cards stack and each kit list folds after two slots
  // behind a "Show all" toggle.
  //
  // FIELD KITS HOOK: SquadLoadoutKit.consumables (Task 16b's Squad Kit slot) stays HIDDEN here. Field Kits now
  // uses per-member kits; when it ships, a kit row gains its consumables line in kitSlotView.
  // ============================================================================

  import { tick } from "svelte";
  import Icon from "./ui/Icon.svelte";
  import TeamBadge from "./ui/TeamBadge.svelte";
  import { TEAM_KIND_GLYPHS } from "./ui/groundOpsAtoms";
  import type { GameState } from "./game/model";
  import type { GroundLoadoutResult } from "./game/armory";
  import {
    SQUAD_KIND_FILTERS,
    applyReportView,
    applyTargets,
    armoryCountText,
    createReportView,
    defaultSquadLoadoutName,
    emptyListText,
    savePreview,
    saveShipOptions,
    squadLoadoutCards,
    type LoadoutReportView,
    type SquadKindFilter,
  } from "./squadLoadoutDisplay";

  // --- Props ------------------------------------------------------------------
  export let state: GameState;
  // The Away Team "Loadouts" shortcut: open Save with this ship and team picked. A new nonce reopens it.
  export let preset: { shipId: string; teamIndex: number; nonce: number } | null = null;
  // Host handlers (App.svelte do*), each over the pure armory.ts action. Create / apply return the engine
  // result (the report reads it); check-in returns whether it went through.
  export let onCreate: (shipId: string, teamIndex: number, name: string) => GroundLoadoutResult;
  export let onApply: (loadoutId: string, shipId: string, teamIndex: number) => GroundLoadoutResult;
  export let onCheckIn: (loadoutId: string) => boolean;
  export let onRename: (loadoutId: string, name: string) => void;
  export let onDelete: (loadoutId: string) => void;

  // --- Local UI state ---------------------------------------------------------
  let filter: SquadKindFilter = "all";
  let mode: "list" | "save" | "apply" = "list";
  let saveShipId: string | null = null;
  let saveTeamIndex = 0;
  let nameDraft = "";
  let nameTouched = false;
  let applyId: string | null = null;
  let applyPick: string | null = null; // "ship-1:0"
  let report: LoadoutReportView | null = null;
  let renamingId: string | null = null;
  let renameDraft = "";
  let deletePendingId: string | null = null;
  let openCards: Record<string, boolean> = {};
  let sectionHead: HTMLElement | null = null;
  let reportEl: HTMLElement | null = null;
  let lastNonce: number | null = null;

  // --- Derived reads ----------------------------------------------------------
  $: cards = squadLoadoutCards(state, filter);
  $: shipOptions = saveShipOptions(state);
  // The picked ship, falling back to the first one when the pick left the fleet (or none was made).
  $: saveShip = shipOptions.find((o) => o.shipId === saveShipId) ?? shipOptions[0] ?? null;
  $: saveTeam = saveShip?.teams.some((t) => t.teamIndex === saveTeamIndex) ? saveTeamIndex : 0;
  $: preview = mode === "save" && saveShip !== null ? savePreview(state, saveShip.shipId, saveTeam) : null;
  $: applyLoadout = applyId === null ? null : (state.squadLoadouts ?? []).find((l) => l.id === applyId) ?? null;
  $: targets = mode === "apply" && applyId !== null ? applyTargets(state, applyId) : [];
  $: picked = targets.find((t) => t.key === applyPick && !t.disabled) ?? null;

  // The shortcut from a ship's Away Team card.
  $: if (preset !== null && preset.nonce !== lastNonce) {
    lastNonce = preset.nonce;
    void openSave(preset.shipId, preset.teamIndex);
  }

  // Keep the default name in step with the picked team until the player types their own.
  $: if (mode === "save" && saveShip !== null && !nameTouched) nameDraft = defaultSquadLoadoutName(state, saveShip.shipId, saveTeam);

  async function focusSection(): Promise<void> {
    await tick();
    sectionHead?.focus();
  }
  async function focusReport(): Promise<void> {
    await tick();
    reportEl?.focus();
  }

  async function openSave(shipId: string | null = null, teamIndex = 0): Promise<void> {
    mode = "save";
    report = null;
    saveShipId = shipId ?? shipOptions[0]?.shipId ?? null;
    saveTeamIndex = teamIndex;
    nameTouched = false;
    await focusSection();
  }
  function pickShip(shipId: string): void {
    saveShipId = shipId;
    saveTeamIndex = 0;
  }
  function closeSection(): void {
    mode = "list";
    applyId = null;
    applyPick = null;
  }
  async function save(): Promise<void> {
    if (saveShip === null || preview === null || !preview.gate.ok) return;
    const r = onCreate(saveShip.shipId, saveTeam, nameDraft);
    if (!r.ok) return;
    report = createReportView(r.next, r.loadoutId, r.pieces, r.skipped);
    closeSection();
    await focusReport();
  }
  async function openApply(loadoutId: string): Promise<void> {
    mode = "apply";
    report = null;
    applyId = loadoutId;
    applyPick = null;
    await focusSection();
  }
  async function apply(): Promise<void> {
    if (applyId === null || picked === null) return;
    const id = applyId;
    const r = onApply(id, picked.shipId, picked.teamIndex);
    if (!r.ok) return;
    report = applyReportView(r.next, id, picked.shipId, picked.teamIndex, r.pieces, r.skipped);
    closeSection();
    await focusReport();
  }
  function checkIn(loadoutId: string): void {
    if (onCheckIn(loadoutId)) report = null;
  }
  function startRename(id: string, name: string): void {
    renamingId = id;
    renameDraft = name;
    deletePendingId = null;
  }
  function endRename(save: boolean): void {
    if (save && renamingId !== null && renameDraft.trim() !== "") onRename(renamingId, renameDraft);
    renamingId = null;
  }
  function confirmDelete(id: string): void {
    onDelete(id);
    deletePendingId = null;
  }
</script>

<div class="sl">
  <div class="sl-bar">
    <div class="sl-chips" role="group" aria-label="Filter by team type">
      {#each SQUAD_KIND_FILTERS as f (f.key)}
        <button type="button" class="sl-chip" aria-pressed={filter === f.key} on:click={() => (filter = f.key)}>{f.label}</button>
      {/each}
    </div>
    <span class="sl-count">{armoryCountText(state)}</span>
    <button type="button" class="sl-btn primary" on:click={() => openSave()}><Icon name="saveSet" /> Save a team's gear</button>
  </div>

  {#if report !== null}
    <div class="sl-report" role="status" tabindex="-1" bind:this={reportEl}>
      <div class="sl-report-h">
        <h4><Icon name={report.noSkips ? "check" : "skipped"} /> {report.title}</h4>
        <button type="button" class="sl-btn" on:click={() => (report = null)}>Close</button>
      </div>
      {#if report.lines.length > 0}
        <ul>
          {#each report.lines as line, i (i)}
            <li class:ok={line.ok} class:skip={!line.ok}>
              <Icon name={line.ok ? "check" : "skipped"} />
              <span>{line.text}{#if line.reason}<span class="sl-reason">{line.reason}</span>{/if}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}

  {#if mode === "save"}
    <section class="sl-section" aria-labelledby="sl-save-h">
      <h3 class="sl-section-h" id="sl-save-h" tabindex="-1" bind:this={sectionHead}>Save a team's gear</h3>
      {#if shipOptions.length === 0}
        <p class="sl-note">No ship in the fleet fields a ground team yet.</p>
        <div class="sl-actions"><button type="button" class="sl-btn" on:click={closeSection}>Cancel</button></div>
      {:else}
        <div class="sl-two">
          <div class="sl-col">
            <div class="sl-field">
              <span class="sl-field-t" id="sl-ship-t">Ship</span>
              <div class="sl-picks" role="group" aria-labelledby="sl-ship-t">
                {#each shipOptions as o (o.shipId)}
                  <button type="button" class="sl-pick" aria-pressed={saveShip?.shipId === o.shipId} on:click={() => pickShip(o.shipId)}>
                    <Icon name="ship" /> {o.label}
                  </button>
                {/each}
              </div>
            </div>
            {#if saveShip !== null}
              <div class="sl-field">
                <span class="sl-field-t" id="sl-team-t">Ground team</span>
                <div class="sl-picks" role="group" aria-labelledby="sl-team-t">
                  {#each saveShip.teams as t (t.teamIndex)}
                    <button type="button" class="sl-pick" aria-pressed={saveTeam === t.teamIndex} on:click={() => (saveTeamIndex = t.teamIndex)}>
                      <TeamBadge index={t.teamIndex} name={t.name} size="sm" />
                      <span class="sl-pick-t">{t.name}<small>{t.summary}</small></span>
                    </button>
                  {/each}
                </div>
              </div>
            {/if}
            <label class="sl-field">
              <span class="sl-field-t">Name</span>
              <input class="sl-input" type="text" bind:value={nameDraft} on:input={() => (nameTouched = true)} />
              <span class="sl-hint">Default name: team name + type.</span>
            </label>
            {#if preview !== null && !preview.gate.ok}
              <div class="sl-why" id="sl-save-why">
                <Icon name="lock" />
                <span>{preview.gate.reason}.</span>
              </div>
              {#if preview.gate.wornLoadoutId !== null}
                {@const wornId = preview.gate.wornLoadoutId}
                {@const wornCard = cards.find((c) => c.id === wornId) ?? squadLoadoutCards(state).find((c) => c.id === wornId)}
                <div class="sl-actions">
                  <button
                    type="button"
                    class="sl-btn"
                    disabled={wornCard?.checkIn?.ok === false}
                    aria-describedby={wornCard?.checkIn?.ok === false ? "sl-worn-why" : undefined}
                    on:click={() => checkIn(wornId)}
                  ><Icon name="checkIn" /> Check in "{preview.gate.wornLoadoutName}"</button>
                </div>
                {#if wornCard?.checkIn && !wornCard.checkIn.ok}
                  <p class="sl-why" id="sl-worn-why"><Icon name="lock" /> {wornCard.checkIn.reason}</p>
                {/if}
              {/if}
            {/if}
            <div class="sl-actions">
              <button
                type="button"
                class="sl-btn primary"
                disabled={preview === null || !preview.gate.ok}
                aria-describedby={preview !== null && !preview.gate.ok ? "sl-save-why" : undefined}
                on:click={save}
              ><Icon name="saveSet" /> {preview?.saveLabel ?? "Save loadout"}</button>
              <button type="button" class="sl-btn" on:click={closeSection}>Cancel</button>
            </div>
          </div>
          <div class="sl-col">
            {#if preview !== null}
              <!-- svelte-ignore a11y_no_noninteractive_tabindex, INTENTIONAL: the table scrolls sideways inside this box on a phone, so the box takes focus to let a keyboard user scroll it (the scrollable-region pattern), with a visible focus ring. -->
              <div class="sl-tablewrap" role="region" aria-label="What gets saved" tabindex="0">
                <table>
                  <thead>
                    <tr><th scope="col">Slot</th><th scope="col">Member now</th><th scope="col">Armor</th><th scope="col">Weapon</th><th scope="col">Tool</th><th scope="col">Implants</th></tr>
                  </thead>
                  <tbody>
                    {#each preview.rows as row (`${row.teamType}-${row.slotIndex}`)}
                      <tr>
                        <th scope="row">{row.label}</th>
                        <td class:empty={row.member === null}>{row.member ?? "empty slot"}</td>
                        <td class:empty={row.armor === null}>{row.armor ?? "none"}</td>
                        <td class:empty={row.weapon === null}>{row.weapon ?? "none"}</td>
                        <td class:empty={row.tool === null}>{row.tool ?? "none"}</td>
                        <td>{row.implants}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
              <p class="sl-note">
                {preview.pieces} piece{preview.pieces === 1 ? "" : "s"} saved. An empty slot saves an <b>empty kit</b>. Saved pieces are
                committed to the loadout, the same rule as ship loadouts, and the team keeps wearing them.
              </p>
              {#if preview.skipped.length > 0}
                <ul class="sl-skips">
                  {#each preview.skipped as sk, i (i)}
                    <li><Icon name="skipped" /> <span>{sk.label} · {sk.piece}<span class="sl-reason">{sk.reason}</span></span></li>
                  {/each}
                </ul>
              {/if}
            {/if}
          </div>
        </div>
      {/if}
    </section>
  {/if}

  {#if mode === "apply" && applyLoadout !== null}
    <section class="sl-section" aria-labelledby="sl-apply-h">
      <h3 class="sl-section-h" id="sl-apply-h" tabindex="-1" bind:this={sectionHead}>Put "{applyLoadout.name}" on a team</h3>
      <div class="sl-picks sl-targets" role="group" aria-label="Ground teams">
        {#each targets as t (t.key)}
          <button
            type="button"
            class="sl-pick"
            aria-pressed={applyPick === t.key}
            disabled={t.disabled}
            on:click={() => (applyPick = t.key)}
          >
            <TeamBadge index={t.teamIndex} name={t.title} size="sm" />
            <span class="sl-pick-t">{t.title}<small class:off={t.disabled}>{#if t.disabled}<Icon name="lock" /> {/if}{t.sub}</small></span>
          </button>
        {/each}
      </div>
      {#if targets.length === 0}
        <p class="sl-note">No ship in the fleet fields a ground team yet.</p>
      {/if}
      <p class="sl-note">
        It installs every piece it can, in slot order, and reports what it skipped and why; it never forces a piece. A member's own gear
        goes to Armory storage only in the slots this set fills; a slot the set leaves empty keeps what they wear.
      </p>
      <div class="sl-actions">
        <button type="button" class="sl-btn primary" disabled={picked === null} on:click={apply}>
          <Icon name="checkOut" /> {picked === null ? "Pick a team" : `Put it on ${picked.title}`}
        </button>
        <button type="button" class="sl-btn" on:click={closeSection}>Cancel</button>
      </div>
    </section>
  {/if}

  {#if cards.length === 0}
    <div class="sl-empty"><Icon name="locker" size={28} /><p>{emptyListText(state, filter)}</p></div>
  {:else}
    <div class="sl-grid">
      {#each cards as c (c.id)}
        <article class="sl-card" class:worn={c.worn} class:open={openCards[c.id] === true} aria-labelledby="sl-card-{c.id}">
          <div class="sl-card-h">
            {#if renamingId === c.id}
              <form class="sl-rename" on:submit|preventDefault={() => endRename(true)}>
                <label class="sl-sr" for="sl-name-{c.id}">New name for {c.name}</label>
                <input id="sl-name-{c.id}" class="sl-input" type="text" bind:value={renameDraft} />
                <button type="submit" class="sl-btn">Save</button>
                <button type="button" class="sl-btn" on:click={() => endRename(false)}>Cancel</button>
              </form>
            {:else}
              <h3 class="sl-card-name" id="sl-card-{c.id}">{c.name}</h3>
            {/if}
            <span class="sl-kind"><Icon name={TEAM_KIND_GLYPHS[c.kind]} size={20} /> {c.kindName}</span>
          </div>
          <div class="sl-status" class:worn={c.worn}>
            <Icon name={c.worn ? "checkOut" : "locker"} /> {c.status}
          </div>
          {#if c.stale !== null}
            <p class="sl-why"><Icon name="warning" /> {c.stale}</p>
          {/if}
          <ul class="sl-slots" id="sl-slots-{c.id}">
            {#each c.slots as k, i (`${k.teamType}-${k.slotIndex}`)}
              <li class="sl-slot" class:fold={i >= 2} class:empty={k.empty}>
                <span class="sl-slot-who {k.teamType}">{k.label}</span>
                <span class="sl-slot-gear">{k.gear}{#if k.extra} <i>{k.extra}</i>{/if}</span>
              </li>
            {/each}
          </ul>
          {#if c.slots.length > 2}
            <button
              type="button"
              class="sl-fold-btn"
              aria-expanded={openCards[c.id] === true}
              aria-controls="sl-slots-{c.id}"
              on:click={() => (openCards = { ...openCards, [c.id]: !openCards[c.id] })}
            >{openCards[c.id] ? "Show fewer" : `Show all (${c.slots.length - 2} more)`}</button>
          {/if}
          {#if deletePendingId === c.id}
            <div class="sl-confirm" role="group" aria-label="Delete {c.name}">
              <p>Delete "{c.name}"? Its pieces go back to storage, so nothing is destroyed.</p>
              <div class="sl-actions">
                <button type="button" class="sl-btn danger" on:click={() => confirmDelete(c.id)}>Delete</button>
                <button type="button" class="sl-btn" on:click={() => (deletePendingId = null)}>Cancel</button>
              </div>
            </div>
          {:else}
            <div class="sl-actions">
              {#if c.worn}
                <button
                  type="button"
                  class="sl-btn"
                  disabled={c.checkIn?.ok === false}
                  aria-describedby={c.checkIn?.ok === false ? `sl-ci-why-${c.id}` : undefined}
                  on:click={() => checkIn(c.id)}
                ><Icon name="checkIn" /> Check in</button>
              {:else}
                <button type="button" class="sl-btn primary" on:click={() => openApply(c.id)}><Icon name="checkOut" /> Put on a team</button>
              {/if}
              {#if renamingId !== c.id}
                <button type="button" class="sl-btn" aria-label="Rename {c.name}" on:click={() => startRename(c.id, c.name)}>Rename</button>
              {/if}
              {#if !c.worn}
                <button type="button" class="sl-btn" aria-label="Delete {c.name}" on:click={() => { deletePendingId = c.id; renamingId = null; }}>Delete</button>
              {/if}
            </div>
            {#if c.checkIn && !c.checkIn.ok}
              <p class="sl-why" id="sl-ci-why-{c.id}"><Icon name="lock" /> {c.checkIn.reason}</p>
            {/if}
          {/if}
        </article>
      {/each}
    </div>
  {/if}
  <p class="sl-note">
    <b>Worn</b>: a team wears the set right now (like a checked-out ship loadout). <b>In the locker</b>: the pieces rest in the
    loadout, committed, so they cannot be sold, salvaged or installed elsewhere until you delete it or put it on a team.
  </p>
</div>

<style>
  .sl {
    container-type: inline-size;
    container-name: sl;
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-width: 0;
  }
  .sl-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
  }
  .sl-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .sl-chip {
    padding: 3px 10px;
    font-size: var(--text-xs);
    border-radius: 999px;
    border: 1px solid var(--color-border);
    background: transparent;
    color: var(--color-text-secondary);
    cursor: pointer;
  }
  .sl-chip[aria-pressed="true"] {
    color: var(--color-text-primary);
    border-color: var(--color-accent);
    background: rgba(var(--color-accent-rgb), 0.12);
    font-weight: 600;
  }
  .sl-count {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }
  .sl-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 12px;
    font-size: var(--text-xs);
    background: rgba(var(--color-accent-rgb), 0.08);
    border: 1px solid rgba(var(--color-accent-rgb), 0.3);
    border-radius: var(--corner);
    color: var(--color-text-secondary);
    cursor: pointer;
    white-space: nowrap;
  }
  .sl-btn:hover:not(:disabled) {
    color: var(--color-text-primary);
    border-color: var(--color-accent);
  }
  .sl-btn.primary {
    background: rgba(var(--color-accent-rgb), 0.18);
    border-color: var(--color-accent);
    color: var(--color-text-primary);
  }
  .sl-btn.danger {
    background: color-mix(in srgb, var(--color-danger) 10%, transparent);
    border-color: color-mix(in srgb, var(--color-danger) 40%, transparent);
    color: var(--color-danger);
  }
  .sl-btn:disabled,
  .sl-pick:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .sl-btn:focus-visible,
  .sl-chip:focus-visible,
  .sl-pick:focus-visible,
  .sl-fold-btn:focus-visible,
  .sl-input:focus-visible,
  .sl-tablewrap:focus-visible,
  .sl-section-h:focus-visible,
  .sl-report:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }

  .sl-report,
  .sl-section,
  .sl-card {
    min-width: 0;
    padding: 12px;
    background: rgba(var(--color-accent-rgb), 0.04);
    border: 1px solid var(--color-border);
    border-radius: var(--corner);
  }
  .sl-report {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .sl-report-h {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
  }
  .sl-report h4 {
    margin: 0;
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: var(--text-sm);
    color: var(--color-text-primary);
  }
  .sl-report ul,
  .sl-skips {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 6px;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }
  .sl-report li,
  .sl-skips li {
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr);
    gap: 6px;
    align-items: start;
  }
  .sl-report li.ok :global(.fa-icon) {
    color: var(--color-success);
  }
  .sl-report li.skip :global(.fa-icon),
  .sl-skips :global(.fa-icon) {
    color: var(--color-warning);
  }
  .sl-reason {
    display: block;
    color: var(--color-text-dim);
  }

  .sl-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .sl-section-h {
    margin: 0;
    font-family: var(--font-display);
    font-weight: normal;
    font-size: var(--text-md);
    color: var(--color-text-primary);
  }
  .sl-two {
    display: grid;
    gap: 14px;
    grid-template-columns: minmax(0, 1fr);
  }
  @container sl (min-width: 820px) {
    .sl-two {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr);
    }
  }
  .sl-col {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
  }
  .sl-field {
    display: flex;
    flex-direction: column;
    gap: 5px;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }
  .sl-field-t {
    font-weight: 600;
    color: var(--color-text-primary);
    font-size: var(--text-sm);
  }
  .sl-hint {
    color: var(--color-text-dim);
  }
  .sl-input {
    min-width: 0;
    padding: 6px 10px;
    font-size: var(--text-sm);
    background: var(--color-bg-deep, var(--color-bg-mid));
    color: var(--color-text-primary);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--corner);
  }
  .sl-picks {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .sl-targets {
    flex-direction: column;
    align-items: stretch;
  }
  .sl-pick {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    text-align: left;
    font-size: var(--text-sm);
    background: transparent;
    color: var(--color-text-secondary);
    border: 1px solid var(--color-border);
    border-radius: var(--corner);
    cursor: pointer;
    min-width: 0;
  }
  .sl-pick[aria-pressed="true"] {
    border-color: var(--color-accent);
    background: rgba(var(--color-accent-rgb), 0.12);
    color: var(--color-text-primary);
    font-weight: 600;
  }
  .sl-pick-t {
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .sl-pick-t small {
    font-size: var(--text-2xs);
    font-weight: normal;
    color: var(--color-text-dim);
  }
  .sl-pick-t small.off {
    color: var(--color-warning);
  }
  .sl-why {
    margin: 0;
    display: flex;
    gap: 6px;
    align-items: flex-start;
    font-size: var(--text-xs);
    color: var(--color-warning);
    line-height: 1.45;
  }
  .sl-note {
    margin: 0;
    padding: 2px 0 2px 10px;
    border-left: 3px solid var(--color-border);
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    line-height: 1.45;
  }
  .sl-note b {
    color: var(--color-text-primary);
  }
  .sl-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  /* The save preview: the TABLE scrolls inside its own box, so the page never scrolls sideways. */
  .sl-tablewrap {
    max-width: 100%;
    overflow-x: auto;
    border: 1px solid var(--color-border);
    border-radius: var(--corner);
  }
  .sl-tablewrap table {
    border-collapse: collapse;
    width: 100%;
    min-width: 520px;
    font-size: var(--text-xs);
  }
  .sl-tablewrap th,
  .sl-tablewrap td {
    text-align: left;
    padding: 6px 10px;
    border-bottom: 1px solid var(--color-border);
    vertical-align: top;
    color: var(--color-text-secondary);
  }
  .sl-tablewrap thead th {
    font-size: var(--text-2xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-text-dim);
    background: rgba(var(--color-accent-rgb), 0.06);
  }
  .sl-tablewrap tbody th {
    font-weight: 600;
    color: var(--color-text-primary);
    white-space: nowrap;
  }
  .sl-tablewrap tr:last-child th,
  .sl-tablewrap tr:last-child td {
    border-bottom: 0;
  }
  .sl-tablewrap td.empty {
    color: var(--color-text-dim);
    font-style: italic;
  }

  .sl-empty {
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--color-text-dim);
    font-size: var(--text-sm);
  }
  .sl-empty p {
    margin: 0;
  }
  .sl-grid {
    display: grid;
    gap: 12px;
    grid-template-columns: repeat(auto-fill, minmax(min(300px, 100%), 1fr));
  }
  .sl-card {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .sl-card.worn {
    border-color: color-mix(in srgb, var(--color-accent) 55%, var(--color-border));
  }
  .sl-card-h {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .sl-card-name {
    margin: 0;
    font-family: var(--font-display);
    font-weight: normal;
    font-size: var(--text-md);
    color: var(--color-text-primary);
    overflow-wrap: anywhere;
    min-width: 0;
  }
  .sl-kind {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 1px 7px;
    font-size: var(--text-2xs);
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--color-text-secondary);
    border: 1px solid var(--color-border);
    border-radius: var(--corner);
  }
  .sl-status {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }
  .sl-status.worn {
    color: var(--color-accent);
  }
  .sl-slots {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 4px;
    font-size: var(--text-xs);
  }
  .sl-slot {
    display: grid;
    grid-template-columns: 76px minmax(0, 1fr);
    gap: 8px;
    align-items: baseline;
  }
  .sl-slot-who {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
  }
  /* The squad type is in the label's WORD; the swatch only echoes it (color is never the only signal). */
  .sl-slot-who::before {
    content: "";
    width: 7px;
    height: 7px;
    flex: none;
    border-radius: 2px;
    background: var(--color-danger);
  }
  .sl-slot-who.science::before {
    border-radius: 50%;
    background: var(--color-accent-bright);
  }
  .sl-slot-gear {
    color: var(--color-text-secondary);
    overflow-wrap: anywhere;
  }
  .sl-slot.empty .sl-slot-gear,
  .sl-slot-gear i {
    font-style: normal;
    color: var(--color-text-dim);
  }
  .sl-slot-gear i {
    margin-left: 6px;
  }
  .sl-fold-btn {
    display: none;
    align-self: flex-start;
    padding: 0;
    background: none;
    border: 0;
    color: var(--color-accent);
    font-size: var(--text-xs);
    cursor: pointer;
    text-decoration: underline;
  }
  /* Phones: each kit list folds after two slots behind "Show all", so a long list of loadouts stays scannable. */
  @container sl (max-width: 520px) {
    .sl-card:not(.open) .sl-slot.fold {
      display: none;
    }
    .sl-fold-btn {
      display: inline;
    }
    .sl-count {
      margin-left: 0;
      flex-basis: 100%;
      order: -1;
    }
  }
  .sl-rename {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    flex: 1 1 200px;
    min-width: 0;
  }
  .sl-rename .sl-input {
    flex: 1 1 140px;
  }
  .sl-confirm p {
    margin: 0 0 8px;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }
  .sl-sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
</style>
