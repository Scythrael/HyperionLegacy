<script lang="ts">
  // ============================================================================
  // SeniorStaffPanel.svelte
  // Author: Claude (Opus 4.8) | Crew 0.14.0 phase 4a (Senior Staff UI)
  //
  // The player-facing SENIOR STAFF management screen for ONE selected ship, the
  // "Senior Staff" sub-tab of the ship-detail page (sibling to the Loadout board /
  // ShipSystemsPanel and the coming-soon Complement tab). It mirrors ShipSystemsPanel's
  // posture exactly:
  //   - PURE PRESENTATION + INTERACTION. It READS live state through the already-tested
  //     Senior Staff engine (seniorStaff.ts: officerInSeat / seniorStaffCandidates /
  //     canPromoteOfficer / officerPromotionObjectives / officerRacialBonus / rank helpers)
  //     and the bonus + race catalogs. It never reimplements game logic and never mutates
  //     state directly: Hire / Assign / Reassign / Dismiss / Promote bubble UP to the host
  //     (App.svelte) via callbacks, which run the pure engine fns + doSave + pushLog in one
  //     place. When the host reassigns `state`, every derived value below recomputes.
  //   - RESPONSIVE the ShipSystemsPanel way: ONE shared DOM tree, split by CSS only. The
  //     outer wrap is a container-query context (container-type: inline-size); a narrow
  //     container DRILLS (seat grid -> selected seat's detail, Back returns) while a wide
  //     container lays the grid + detail SIDE BY SIDE. There is NO isMobile JS branch and
  //     no separate mobile/desktop markup.
  //
  // SCOPE (phase 4a): the 7 typed bridge seats, a filled seat's officer detail (rank ladder,
  // provided stats, the four officer stat bars (E-CREW Task 19), the objective-gated promotion
  // checklist, Reassign / Dismiss), and an
  // empty seat's fill options (already-hired unassigned officers of that seat type -> Assign,
  // plus the deterministic candidate roster filtered to that seat -> Hire). Complement + the
  // Stats/rosters/prestige surfaces are OTHER phases.
  // ============================================================================

  import ActionModal from "./ActionModal.svelte";
  import HelpTip from "./HelpTip.svelte";
  import type { GameState, SeniorStaffOfficer, SeniorStaffSeat, OfficerBonus, OfficerRank, OfficerStats } from "./game/model";
  import {
    SENIOR_STAFF_SEATS,
    OFFICER_RANK_ORDER,
    OFFICER_STAT_KEYS,
    OFFICER_STAT_INFO,
    OFFICER_STAT_ROLL_MAX,
    OFFICER_PROMOTION_STAT_POINTS,
    officerRankLabel,
    officerInSeat,
    officerStats,
    seniorStaffCandidates,
    canPromoteOfficer,
    officerPromotionObjectives,
    officerRacialBonus,
    canAssignOfficer,
    canFireOfficer,
    canHireOfficerToSeat,
    canUnassignOfficer,
    officerBlockText,
    type OfficerGate,
  } from "./game/seniorStaff";
  import { crewLockReason, crewLockReasonText, crewLockTextAmong, crewLockUntilText } from "./game/crewLock";
  import Icon from "./ui/Icon.svelte";
  import { getSeniorStaffBonusById } from "./game/seniorStaffBonuses";
  import { CREW_RACES } from "./game/crewRaces";
  import { TRANSIT_SPEED_KEY } from "./game/crewBuffs";
  import { officerStatTooltip } from "./game/officerStats";

  // --- Props ------------------------------------------------------------------
  // `state` is the whole GameState (read-only here); `shipId` selects the ship whose bridge
  // this panel staffs. The callbacks route every side effect back to the host so persistence
  // + logging happen exactly once, in App.svelte (mirrors ShipSystemsPanel's onInstall etc.).
  export let state: GameState;
  export let shipId: string;
  // Hire a candidate off the roster straight into this seat (host: hireOfficer then
  // assignOfficerToShip). The candidate id + the seat it was rolled for.
  export let onHire: (candidateId: string, seat: SeniorStaffSeat) => void;
  // Assign an ALREADY-HIRED but unassigned officer into this ship's matching seat.
  export let onAssign: (officerId: string, shipId: string) => void;
  // Free an officer from this ship's seat (unassign). It stays hired + becomes available to
  // assign from any ship's Senior Staff pane, which is how a cross-ship reassignment is done
  // without a ship picker this phase.
  export let onReassign: (officerId: string) => void;
  // Dismiss (fire) a hired officer for good. Confirmed via ActionModal below.
  export let onDismiss: (officerId: string) => void;
  // Promote an officer one rank (host: promoteOfficer + splice back). Only offered when the
  // objective checklist is fully met (canPromoteOfficer); the button is disabled otherwise.
  export let onPromote: (officerId: string) => void;
  // Toggle a seated officer's `favorite` curation flag (host: toggleOfficerFavorite + doSave).
  // Cosmetic: it drives sorting/pinning affordances + the roster builder, nothing mechanical.
  export let onToggleFavorite: (officerId: string) => void;

  // --- Local UI state ---------------------------------------------------------
  // The seat currently drilled into (its detail is shown). null = the seat grid (the
  // master view). Reset whenever the panel switches ships so nothing stale carries over.
  let selectedSeat: SeniorStaffSeat | null = null;
  // The officer pending a Dismiss confirm (its id), or null when the confirm modal is closed.
  let confirmDismissId: string | null = null;

  let lastShipId: string | null = null;
  $: if (shipId !== lastShipId) {
    lastShipId = shipId;
    selectedSeat = null;
    confirmDismissId = null;
  }

  // --- Static seat metadata ---------------------------------------------------
  // Display label per typed bridge seat (US English). SENIOR_STAFF_SEATS is the canonical
  // order (matches the SeniorStaffSeat union); this only names them.
  const SEAT_LABEL: Record<SeniorStaffSeat, string> = {
    executive: "Executive Officer",
    pilot: "Pilot",
    operations: "Operations",
    science: "Science",
    tactical: "Tactical",
    medical: "Medical",
    engineering: "Engineering",
  };

  // E-CREW Task 19 (D13, mockup 7b): each officer HEADS a department, and its four stats are facets of
  // how that department performs aboard the ship. E-CREW Task 21: the tooltip text is built by the engine
  // (officerStats.ts officerStatTooltip, derived from DEPARTMENT_OF_SEAT, the one mapping the facets use), so
  // a tooltip can never name a department or an effect the engine does not apply.

  // --- Derived reads ----------------------------------------------------------
  $: ship = state.ships.find((s) => s.id === shipId) ?? null;

  // The per-seat occupant map for THIS ship, precomputed as a real reactive so the tiles'
  // dependency on `state` is visible to the compiler (reading officerInSeat() inline in the
  // template would hide it and go stale after a hire/assign, the same trap ShipSystemsPanel's
  // fittedBySlot note documents). officerInSeat returns undefined for an empty seat.
  $: seatOccupant = (() => {
    const map: Partial<Record<SeniorStaffSeat, SeniorStaffOfficer | undefined>> = {};
    for (const seat of SENIOR_STAFF_SEATS) {
      map[seat] = ship ? officerInSeat(state, shipId, seat) : undefined;
    }
    return map;
  })();

  // CP-6: the one crew lock. While this ship is out (a captain mission, or an expedition until it is
  // claimed) every allocation control (Hire, Assign, Reassign, Dismiss) is disabled with the reason shown;
  // promotion and favorites stay live. The engine gates refuse the same actions (seniorStaff.ts can*).
  $: lockReason = ship ? crewLockReason(state, shipId) : null;
  $: lockText = lockReason === null ? null : crewLockReasonText(lockReason);
  // A refusal's player text; a crew lock reads the accurate words for the FIRST locked ship among the ones
  // the action touches (the officer's own ship, then this one). undefined when open.
  function gateWhy(gate: OfficerGate, shipIds: readonly (string | null)[]): string | undefined {
    if (gate.ok) return undefined;
    return gate.reason === "onMission"
      ? crewLockTextAmong(state, shipIds) ?? officerBlockText(gate.reason)
      : officerBlockText(gate.reason);
  }

  // The officer sitting the currently-drilled seat (null when the seat is empty or none drilled).
  $: selectedOfficer = selectedSeat ? seatOccupant[selectedSeat] ?? null : null;

  // Fill options for an EMPTY drilled seat, split into two groups:
  //   available: officers already hired but unassigned, matching this seat type (-> Assign)
  //   candidates: the deterministic recruit roster filtered to this seat type (-> Hire)
  $: availableOfficers =
    selectedSeat && !selectedOfficer
      ? state.officers.filter((o) => o.assignedShipId === null && o.seat === selectedSeat)
      : [];
  $: seatCandidates =
    selectedSeat && !selectedOfficer
      ? seniorStaffCandidates(state).filter((c) => c.seat === selectedSeat)
      : [];

  // The drilled officer's promotion checklist (live progress rows) + whether it can promote.
  // Empty rows at the top rank (commander): nothing to promote into.
  $: promotionRows = selectedOfficer ? officerPromotionObjectives(selectedOfficer) : [];
  $: canPromote = selectedOfficer ? canPromoteOfficer(selectedOfficer) : false;
  $: atTopRank = selectedOfficer !== null && promotionRows.length === 0;

  // --- Display helpers --------------------------------------------------------
  // An officer's two rolled bonuses as {label, pct} rows, resolving each id against the
  // catalog. magnitude is already rank-scaled on the officer; shown as a whole-percent lift.
  function bonusRows(officer: SeniorStaffOfficer): { label: string; pct: string }[] {
    return officer.bonuses.map((b: OfficerBonus) => {
      const def = getSeniorStaffBonusById(b.id);
      return { label: def?.label ?? b.id, pct: fmtPct(b.magnitude) };
    });
  }
  // The officer's inherited racial bonus as a {label, pct} row. statKey is a "crew.xxx" key;
  // humanize it for display (the racial has no catalog label of its own). The Spacer's is the ship's
  // sweeping transit speed key (0.14.0), whose name reads "Transit Time Cut", so it gets its label here.
  function racialRow(officer: SeniorStaffOfficer): { label: string; pct: string } {
    const rb = officerRacialBonus(officer);
    return { label: rb.statKey === TRANSIT_SPEED_KEY ? "Transit Speed" : humanizeStatKey(rb.statKey), pct: fmtPct(rb.magnitude) };
  }
  // Race display label (CREW_RACES catalog).
  function raceLabel(officer: SeniorStaffOfficer): string {
    return CREW_RACES[officer.race]?.label ?? officer.race;
  }
  // A fractional magnitude (e.g. 0.06) as a signed whole-percent, e.g. "+6%".
  function fmtPct(magnitude: number): string {
    return `+${Math.round(magnitude * 100)}%`;
  }
  // "crew.surveyAptitude" -> "Survey Aptitude" (strip the namespace, split camelCase, title case).
  function humanizeStatKey(key: string): string {
    const bare = key.includes(".") ? key.slice(key.indexOf(".") + 1) : key;
    const spaced = bare.replace(/([a-z])([A-Z])/g, "$1 $2");
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  }
  // The four stat rows for an officer (readers fall back to the neutral line when it carries none).
  // `pct` is the bar fill against the 1..20 roll range; promotions can push a stat past 20, which simply
  // fills the bar.
  function statRows(
    officer: SeniorStaffOfficer,
  ): { key: keyof OfficerStats; label: string; abbr: string; value: number; pct: number; tip: string }[] {
    const stats = officerStats(officer);
    return OFFICER_STAT_KEYS.map((key) => ({
      key,
      label: OFFICER_STAT_INFO[key].label,
      abbr: OFFICER_STAT_INFO[key].abbr,
      value: stats[key],
      pct: Math.max(0, Math.min(100, (stats[key] / OFFICER_STAT_ROLL_MAX) * 100)),
      tip: statTip(key, officer.seat),
    }));
  }
  // One stat's tooltip, worded for the department this officer heads (officerStats.ts).
  function statTip(key: keyof OfficerStats, seat: SeniorStaffSeat): string {
    return officerStatTooltip(key, seat);
  }
  // The block-level explainer behind the Stats "?".
  const STATS_TIP =
    "Each officer heads a department, and these four stats shape how that department performs aboard the ship. " +
    `They roll 1 to ${OFFICER_STAT_ROLL_MAX} when the candidate appears, and each promotion adds ${OFFICER_PROMOTION_STAT_POINTS} to the two highest. ` +
    "Officer stats never affect away teams on a planet.";

  // Where a rank sits on the ladder relative to the officer's current rank:
  // "done" (already reached), "current" (the officer's rank now), "future" (not yet).
  function rankState(rank: OfficerRank, current: OfficerRank): "done" | "current" | "future" {
    const ri = OFFICER_RANK_ORDER.indexOf(rank);
    const ci = OFFICER_RANK_ORDER.indexOf(current);
    if (ri === ci) return "current";
    return ri < ci ? "done" : "future";
  }

  // --- Actions (all route to the host) ----------------------------------------
  function selectSeat(seat: SeniorStaffSeat): void {
    selectedSeat = seat;
  }
  function backToGrid(): void {
    selectedSeat = null;
  }
  function requestDismiss(officerId: string): void {
    confirmDismissId = officerId;
  }
  function confirmDismiss(): void {
    if (confirmDismissId !== null) {
      onDismiss(confirmDismissId);
      confirmDismissId = null;
      // The seat this officer sat is now empty; the detail re-derives to the fill view.
    }
  }
  $: dismissTarget =
    confirmDismissId !== null ? state.officers.find((o) => o.id === confirmDismissId) ?? null : null;
</script>

<div class="sstaff" class:drilled={selectedSeat !== null}>
  <!-- MASTER: the 7 typed bridge seats as tiles. On a wide container this column stays beside
       the detail; on a narrow container it is the whole view until a seat is drilled. -->
  <div class="sstaff-seats">
    {#if lockReason !== null}
      <p class="sstaff-lock" role="note">
        <Icon name="lock" /> {lockText}: officers on this ship cannot be hired, assigned, reassigned or dismissed {crewLockUntilText(lockReason)}. Promotion and favorites still work.
      </p>
    {/if}
    <div class="sstaff-section-tag">Bridge Seats</div>
    <div class="sstaff-seat-grid">
      {#each SENIOR_STAFF_SEATS as seat (seat)}
        {@const occ = seatOccupant[seat]}
        <button
          type="button"
          class="sstaff-seat"
          class:filled={occ}
          class:active={selectedSeat === seat}
          on:click={() => selectSeat(seat)}
        >
          <span class="sstaff-seat-name">{SEAT_LABEL[seat]}</span>
          {#if occ}
            <span class="sstaff-seat-officer">{occ.name}</span>
            <span class="sstaff-seat-meta">
              <span class="sstaff-pip">{officerRankLabel(occ.rank)}</span>
              <span class="sstaff-race">{raceLabel(occ)}</span>
            </span>
          {:else}
            <span class="sstaff-seat-empty">Empty</span>
          {/if}
        </button>
      {/each}
    </div>
  </div>

  <!-- DETAIL: the drilled seat. A filled seat shows the officer dossier; an empty seat shows
       the fill options. On a narrow container a Back control returns to the grid. -->
  <div class="sstaff-detail">
    {#if selectedSeat === null}
      <div class="sstaff-empty-hint">Select a bridge seat to review or staff its officer.</div>
    {:else}
      <button type="button" class="sstaff-back" on:click={backToGrid}>
        <span aria-hidden="true">←</span> Seats
      </button>
      <div class="sstaff-detail-title">{SEAT_LABEL[selectedSeat]}</div>

      {#if selectedOfficer}
        {@const officer = selectedOfficer}
        {@const reassignWhy = gateWhy(canUnassignOfficer(state, officer.id), [officer.assignedShipId])}
        {@const dismissWhy = gateWhy(canFireOfficer(state, officer.id), [officer.assignedShipId])}
        <!-- OFFICER DOSSIER -->
        <div class="sstaff-dossier">
          <div class="sstaff-officer-hdr">
            <div class="sstaff-officer-idn">
              <span class="sstaff-officer-name">{officer.name}</span>
              <span class="sstaff-officer-sub">{officerRankLabel(officer.rank)} · {raceLabel(officer)}</span>
            </div>
            <button
              type="button"
              class="sstaff-fav"
              class:on={officer.favorite}
              aria-label="Toggle favorite"
              aria-pressed={officer.favorite === true}
              title={officer.favorite ? "Favorited" : "Favorite this officer"}
              on:click={() => onToggleFavorite(officer.id)}
            >{officer.favorite ? "★" : "☆"}</button>
          </div>

          <!-- RANK LADDER (Cadet -> Commander) -->
          <div class="sstaff-block">
            <div class="sstaff-block-tag">Rank</div>
            <div class="sstaff-ladder">
              {#each OFFICER_RANK_ORDER as rank (rank)}
                {@const rs = rankState(rank, officer.rank)}
                <span class="sstaff-rung" class:done={rs === "done"} class:current={rs === "current"}>
                  {officerRankLabel(rank)}
                </span>
              {/each}
            </div>
          </div>

          <!-- PROVIDED STATS (two bonuses + racial) -->
          <div class="sstaff-block">
            <div class="sstaff-block-tag">Provides</div>
            <div class="sstaff-stat-list">
              {#each bonusRows(officer) as row}
                <div class="sstaff-stat-row">
                  <span class="sstaff-stat-label">{row.label}</span>
                  <span class="sstaff-stat-val">{row.pct}</span>
                </div>
              {/each}
              <div class="sstaff-stat-row racial">
                <span class="sstaff-stat-label">{racialRow(officer).label} <span class="sstaff-stat-note">(racial)</span></span>
                <span class="sstaff-stat-val">{racialRow(officer).pct}</span>
              </div>
            </div>
          </div>

          <!-- OFFICER STATS (E-CREW Task 19, mockup 7b). Each label explains itself on hover / tap /
               keyboard focus (the shared HelpTip, chip mode); the "?" explains the block. -->
          <div class="sstaff-block">
            <div class="sstaff-block-tag sstaff-tag-row">
              <span>Stats</span>
              <HelpTip label="Officer stats" text={STATS_TIP} />
            </div>
            <div class="sstaff-bars">
              {#each statRows(officer) as row (row.key)}
                <div class="sstaff-bar-row">
                  <HelpTip label={row.label} text={row.tip}><span class="sstaff-bar-label">{row.label}</span></HelpTip>
                  <div class="sstaff-bar" aria-hidden="true">
                    <i style="width:{row.pct}%"></i>
                    <span class="sstaff-bar-mid"></span>
                  </div>
                  <span class="sstaff-bar-val">{row.value}</span>
                </div>
              {/each}
            </div>
          </div>

          <!-- PROMOTION CHECKLIST -->
          <div class="sstaff-block">
            <div class="sstaff-block-tag">Promotion</div>
            {#if atTopRank}
              <div class="sstaff-toprank">Commander: highest rank reached.</div>
            {:else}
              <div class="sstaff-objectives">
                {#each promotionRows as row}
                  <div class="sstaff-obj" class:met={row.met}>
                    <span class="sstaff-obj-check" aria-hidden="true">{row.met ? "✓" : "○"}</span>
                    <span class="sstaff-obj-label">{row.objective.label}</span>
                    <span class="sstaff-obj-prog">{Math.floor(Math.min(row.current, row.objective.target))}/{row.objective.target}</span>
                  </div>
                {/each}
              </div>
              <button
                type="button"
                class="sstaff-btn primary"
                disabled={!canPromote}
                title={canPromote ? "Promote this officer" : "Complete every objective to promote"}
                on:click={() => onPromote(officer.id)}
              >
                Promote to {officerRankLabel(OFFICER_RANK_ORDER[OFFICER_RANK_ORDER.indexOf(officer.rank) + 1])}
              </button>
            {/if}
          </div>

          <!-- SEAT ACTIONS (CP-6: disabled with the reason while the ship is crew-locked) -->
          <div class="sstaff-actions">
            <button
              type="button"
              class="sstaff-btn"
              disabled={reassignWhy !== undefined}
              title={reassignWhy ?? "Free this seat; the officer stays hired"}
              on:click={() => onReassign(officer.id)}
            >
              Reassign
            </button>
            <button
              type="button"
              class="sstaff-btn danger"
              disabled={dismissWhy !== undefined}
              title={dismissWhy ?? "Dismiss this officer from the fleet"}
              on:click={() => requestDismiss(officer.id)}
            >
              Dismiss
            </button>
          </div>
          {#if reassignWhy !== undefined || dismissWhy !== undefined}
            <div class="sstaff-why">{reassignWhy ?? dismissWhy}</div>
          {/if}
        </div>
      {:else}
        <!-- EMPTY SEAT: fill options -->
        {#if availableOfficers.length > 0}
          <div class="sstaff-block">
            <div class="sstaff-block-tag">Available Officers</div>
            <div class="sstaff-cand-list">
              {#each availableOfficers as officer (officer.id)}
              {@const assignWhy = gateWhy(canAssignOfficer(state, officer.id, shipId), [officer.assignedShipId, shipId])}
                <div class="sstaff-cand">
                  <div class="sstaff-cand-info">
                    <span class="sstaff-cand-name">{officer.name}</span>
                    <span class="sstaff-cand-meta">{officerRankLabel(officer.rank)} · {raceLabel(officer)}</span>
                    <div class="sstaff-cand-bonuses">
                      {#each bonusRows(officer) as row}
                        <span class="sstaff-chip">{row.label} {row.pct}</span>
                      {/each}
                    </div>
                    <div class="sstaff-cand-stats">
                      {#each statRows(officer) as row (row.key)}
                        <HelpTip label={row.label} text={row.tip}
                          ><span class="sstaff-stat-chip">{row.abbr} <b>{row.value}</b></span></HelpTip
                        >
                      {/each}
                    </div>
                  </div>
                  <div class="sstaff-cand-act">
                    <button
                      type="button"
                      class="sstaff-btn primary"
                      disabled={assignWhy !== undefined}
                      title={assignWhy ?? "Assign this officer to the seat"}
                      on:click={() => onAssign(officer.id, shipId)}
                    >
                      Assign
                    </button>
                    {#if assignWhy !== undefined}<span class="sstaff-why">{assignWhy}</span>{/if}
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {/if}

        <div class="sstaff-block">
          <div class="sstaff-block-tag">Recruit</div>
          {#if seatCandidates.length === 0}
            <div class="sstaff-empty-hint">No {SEAT_LABEL[selectedSeat]} candidates on the current roster.</div>
          {:else}
            <div class="sstaff-cand-list">
              {#each seatCandidates as candidate (candidate.id)}
              {@const hireWhy = gateWhy(canHireOfficerToSeat(state, candidate.id, shipId), [shipId])}
                <div class="sstaff-cand">
                  <div class="sstaff-cand-info">
                    <span class="sstaff-cand-name">{candidate.name}</span>
                    <span class="sstaff-cand-meta">{officerRankLabel(candidate.rank)} · {raceLabel(candidate)}</span>
                    <div class="sstaff-cand-bonuses">
                      {#each bonusRows(candidate) as row}
                        <span class="sstaff-chip">{row.label} {row.pct}</span>
                      {/each}
                    </div>
                    <div class="sstaff-cand-stats">
                      {#each statRows(candidate) as row (row.key)}
                        <HelpTip label={row.label} text={row.tip}
                          ><span class="sstaff-stat-chip">{row.abbr} <b>{row.value}</b></span></HelpTip
                        >
                      {/each}
                    </div>
                  </div>
                  <div class="sstaff-cand-act">
                    <button
                      type="button"
                      class="sstaff-btn primary"
                      disabled={hireWhy !== undefined}
                      title={hireWhy ?? "Hire this candidate into the seat"}
                      on:click={() => onHire(candidate.id, candidate.seat)}
                    >
                      Hire
                    </button>
                    {#if hireWhy !== undefined}<span class="sstaff-why">{hireWhy}</span>{/if}
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    {/if}
  </div>
</div>

{#if dismissTarget !== null}
  <ActionModal title="Dismiss Officer" onClose={() => (confirmDismissId = null)}>
    <p class="sstaff-confirm-text">
      Dismiss <strong>{dismissTarget.name}</strong> ({officerRankLabel(dismissTarget.rank)}
      {raceLabel(dismissTarget)})? This frees their seat and removes them from the fleet for good.
    </p>
    <svelte:fragment slot="footer">
      <button type="button" class="sstaff-btn" on:click={() => (confirmDismissId = null)}>Cancel</button>
      <button type="button" class="sstaff-btn danger" on:click={confirmDismiss}>Dismiss</button>
    </svelte:fragment>
  </ActionModal>
{/if}

<style>
  /* CONTAINER-QUERY MASTER-DETAIL (mirrors ShipSystemsPanel's .ss-flow). The wrap is the
     container the queries key off, so the layout responds to the panel's OWN width, not the
     viewport (the ship-detail body can be a narrow column on a wide screen). DEFAULT + the
     container-query fallback: a single column with both regions stacked. */
  .sstaff {
    container-type: inline-size;
    display: flex;
    /* CP-6 follow-up: a container query can only style the container's DESCENDANTS, never .sstaff itself,
       so the old "flex-direction: row" inside the wide query never applied (stacked at 1280 px). The row
       wraps instead: both regions take a full line by default (stacked), and the wide query below sizes
       them to share one line. */
    flex-flow: row wrap;
    align-items: flex-start;
    gap: 12px;
  }
  .sstaff-seats,
  .sstaff-detail {
    flex: 1 1 100%;
    min-width: 0;
  }
  /* NARROW container: DRILL. Show the seat grid until a seat is drilled, then swap to the
     detail (its Back control returns). One shared reactive (.drilled) gates which shows, so
     there is no matchMedia fork and no duplicated markup. */
  @container (max-width: 519px) {
    .sstaff.drilled .sstaff-seats {
      display: none;
    }
    .sstaff:not(.drilled) .sstaff-detail {
      display: none;
    }
  }
  /* WIDE container: seat grid + detail side by side, both always present. The Back control
     is hidden (there is nothing to go back FROM; the grid is right there). The ".sstaff" prefix
     outranks the base .sstaff-back rule further down, which otherwise wins on source order. */
  @container (min-width: 520px) {
    .sstaff-seats {
      flex: 0 0 calc(46% - 6px);
    }
    .sstaff-detail {
      flex: 1 1 0;
    }
    .sstaff .sstaff-back {
      display: none;
    }
  }

  .sstaff-section-tag,
  .sstaff-block-tag {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-accent-bright);
    margin-bottom: 8px;
  }

  /* SEAT GRID: a two-up tile grid on wide, single column when very cramped. */
  .sstaff-seat-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 8px;
  }
  .sstaff-seat {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 3px;
    padding: 9px 10px;
    text-align: left;
    background: rgba(var(--color-accent-rgb), 0.05);
    border: 1px solid rgba(var(--color-accent-rgb), 0.16);
    border-radius: var(--corner);
    color: var(--color-text-secondary);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .sstaff-seat:hover {
    border-color: rgba(var(--color-accent-rgb), 0.4);
  }
  .sstaff-seat.filled {
    background: rgba(var(--color-accent-rgb), 0.09);
  }
  .sstaff-seat.active {
    border-color: var(--color-accent);
    background: rgba(var(--color-accent-rgb), 0.14);
  }
  .sstaff-seat-name {
    font-size: var(--text-2xs);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--color-text-dim);
  }
  .sstaff-seat-officer {
    font-size: var(--text-sm);
    color: var(--color-text-primary);
  }
  .sstaff-seat-empty {
    font-size: var(--text-xs);
    color: var(--color-text-dim);
    font-style: italic;
  }
  .sstaff-seat-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
  }
  .sstaff-pip {
    font-size: calc(9px * var(--ui-scale));
    padding: 1px 5px;
    border-radius: var(--corner);
    background: rgba(var(--color-accent-rgb), 0.16);
    color: var(--color-accent-bright);
  }
  .sstaff-race {
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
  }

  /* DETAIL */
  .sstaff-back {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 8px;
    padding: 4px 8px;
    font-size: var(--text-xs);
    background: rgba(var(--color-accent-rgb), 0.08);
    border: 1px solid rgba(var(--color-accent-rgb), 0.24);
    border-radius: var(--corner);
    color: var(--color-accent);
    cursor: pointer;
  }
  .sstaff-back:hover,
  .sstaff-back:focus-visible {
    background: rgba(var(--color-accent-rgb), 0.16);
  }
  .sstaff-detail-title {
    font-size: var(--text-md);
    color: var(--color-text-primary);
    margin-bottom: 10px;
  }
  .sstaff-empty-hint {
    font-size: var(--text-xs);
    color: var(--color-text-dim);
    font-style: italic;
    padding: 6px 0;
  }

  .sstaff-officer-hdr {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 10px;
  }
  .sstaff-officer-idn {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .sstaff-fav {
    flex: 0 0 auto;
    background: none;
    border: none;
    padding: 0 2px;
    line-height: 1;
    font-size: var(--text-lg);
    color: var(--color-text-dim);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .sstaff-fav.on {
    color: var(--color-warning, #fbbf24);
  }
  .sstaff-fav:hover,
  .sstaff-fav:focus-visible {
    color: var(--color-warning, #fbbf24);
  }
  .sstaff-officer-name {
    font-size: var(--text-lg);
    color: var(--color-accent-bright);
  }
  .sstaff-officer-sub {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .sstaff-block {
    padding: 10px;
    margin-bottom: 10px;
    background: rgba(var(--color-accent-rgb), 0.04);
    border: 1px solid rgba(var(--color-accent-rgb), 0.14);
  }

  /* RANK LADDER */
  .sstaff-ladder {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
  }
  .sstaff-rung {
    font-size: calc(9px * var(--ui-scale));
    padding: 2px 6px;
    border-radius: var(--corner);
    border: 1px solid rgba(var(--color-accent-rgb), 0.16);
    color: var(--color-text-dim);
  }
  .sstaff-rung.done {
    color: var(--color-text-secondary);
    border-color: rgba(var(--color-accent-rgb), 0.3);
  }
  .sstaff-rung.current {
    color: var(--color-bg-deep, #04060a);
    background: var(--color-accent);
    border-color: var(--color-accent);
  }

  /* STAT ROWS */
  .sstaff-stat-list {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .sstaff-stat-row {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    font-size: var(--text-xs);
  }
  .sstaff-stat-label {
    color: var(--color-text-secondary);
  }
  .sstaff-stat-note {
    color: var(--color-text-dim);
    font-size: var(--text-2xs);
  }
  .sstaff-stat-val {
    color: var(--color-success);
    font-family: var(--font-mono);
  }
  .sstaff-stat-row.racial .sstaff-stat-val {
    color: var(--color-accent-bright);
  }

  /* OFFICER STATS (E-CREW Task 19): label | bar | value, the mockup 7b layout. The faint tick at the
     bar's midpoint marks 10, the average roll. */
  .sstaff-tag-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .sstaff-bars {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }
  .sstaff-bar-row {
    display: grid;
    grid-template-columns: minmax(84px, 110px) 1fr 28px;
    gap: 9px;
    align-items: center;
    font-size: var(--text-xs);
  }
  .sstaff-bar-label {
    color: var(--color-text-secondary);
    border-bottom: 1px dotted rgba(var(--color-accent-rgb), 0.45);
  }
  .sstaff-bar {
    position: relative;
    height: 7px;
    border-radius: 4px;
    background: rgba(var(--color-accent-rgb), 0.1);
    overflow: hidden;
  }
  .sstaff-bar i {
    display: block;
    height: 100%;
    background: var(--color-accent);
  }
  .sstaff-bar-mid {
    position: absolute;
    left: 50%;
    top: 0;
    bottom: 0;
    width: 1px;
    background: rgba(var(--color-accent-rgb), 0.45);
  }
  .sstaff-bar-val {
    font-family: var(--font-mono);
    color: var(--color-text-primary);
    text-align: right;
  }
  .sstaff-cand-stats {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 2px;
  }
  .sstaff-stat-chip {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-family: var(--font-mono);
    font-size: calc(9px * var(--ui-scale));
    padding: 1px 5px;
    border-radius: var(--corner);
    border: 1px solid rgba(var(--color-accent-rgb), 0.18);
    color: var(--color-text-dim);
  }
  .sstaff-stat-chip b {
    color: var(--color-text-primary);
    font-weight: 600;
  }
  /* Touch: a ~24px tap target per chip (taller chip, roomier gaps) so a finger opens the right tooltip,
     while the chip text stays the same compact size. Mouse layouts keep the slim chip. */
  @media (pointer: coarse) {
    .sstaff-cand-stats {
      gap: 6px;
    }
    .sstaff-stat-chip {
      min-height: 24px;
      padding: 2px 8px;
    }
  }

  /* PROMOTION */
  .sstaff-objectives {
    display: flex;
    flex-direction: column;
    gap: 5px;
    margin-bottom: 10px;
  }
  .sstaff-obj {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: var(--text-xs);
    color: var(--color-text-dim);
  }
  .sstaff-obj.met {
    color: var(--color-text-secondary);
  }
  .sstaff-obj-check {
    flex: 0 0 auto;
    color: var(--color-text-dim);
  }
  .sstaff-obj.met .sstaff-obj-check {
    color: var(--color-success);
  }
  .sstaff-obj-label {
    flex: 1 1 auto;
  }
  .sstaff-obj-prog {
    flex: 0 0 auto;
    font-family: var(--font-mono);
    color: var(--color-text-secondary);
  }
  .sstaff-toprank {
    font-size: var(--text-xs);
    color: var(--color-accent-bright);
  }

  /* CANDIDATE / AVAILABLE LISTS */
  .sstaff-cand-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .sstaff-cand {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 9px;
    background: rgba(var(--color-accent-rgb), 0.05);
    border: 1px solid rgba(var(--color-accent-rgb), 0.16);
  }
  .sstaff-cand-info {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
    flex: 1 1 auto;
  }
  .sstaff-cand-name {
    font-size: var(--text-sm);
    color: var(--color-text-primary);
  }
  .sstaff-cand-meta {
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
  }
  .sstaff-cand-bonuses {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 2px;
  }
  .sstaff-chip {
    font-size: calc(9px * var(--ui-scale));
    padding: 1px 5px;
    border-radius: var(--corner);
    background: rgba(var(--color-accent-rgb), 0.1);
    color: var(--color-text-secondary);
  }

  /* BUTTONS + ACTIONS */
  .sstaff-actions {
    display: flex;
    gap: 8px;
  }
  .sstaff-btn {
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
  .sstaff-btn:hover:not(:disabled) {
    color: var(--color-text-primary);
    border-color: var(--color-accent);
  }
  .sstaff-btn.primary {
    background: rgba(var(--color-accent-rgb), 0.16);
    color: var(--color-accent-bright);
    border-color: var(--color-accent);
  }
  .sstaff-btn.danger {
    background: rgba(248, 113, 113, 0.1);
    border-color: rgba(248, 113, 113, 0.4);
    color: var(--color-danger, #f87171);
  }
  .sstaff-btn.danger:hover:not(:disabled) {
    background: rgba(248, 113, 113, 0.2);
  }
  .sstaff-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  /* CP-6: the crew lock line (warning hue + the lock glyph + words, so color is never the only signal) and
     the reason under a disabled allocation control. */
  .sstaff-lock {
    margin: 0 0 10px;
    display: flex;
    gap: 6px;
    align-items: flex-start;
    font-size: var(--text-xs);
    line-height: 1.4;
    color: var(--color-warning);
  }
  .sstaff-why {
    font-size: var(--text-2xs);
    color: var(--color-warning);
    margin-top: 4px;
  }
  .sstaff-cand-act {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    flex: 0 0 auto;
    max-width: 45%;
    text-align: right;
  }
  .sstaff-confirm-text {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    line-height: 1.5;
  }
</style>
