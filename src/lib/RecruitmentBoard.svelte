<script context="module" lang="ts">
  // A per-instance suffix for the heading id, so two boards on one page could never share an id.
  let boardInstanceCount = 0;
</script>

<script lang="ts">
  // ============================================================================
  // RecruitmentBoard.svelte
  // E-CREW "Crew Made Real" Task 6 (approved mockup section 2, "Recruiting Members")
  //
  // The away-team RECRUITMENT BOARD: the derived hourly candidate board (awayTeam.ts
  // awayRecruitCandidates), each candidate with a ship selector and a Hire button. It mirrors the
  // Senior Staff panel's posture:
  //   - PURE PRESENTATION + INTERACTION. The board, the per-ship hire gates, the refresh countdown
  //     and the block-reason text all come from the tested engine (awayRecruitCandidates /
  //     hireTargetsForCandidate / awayBoardSecondsToRefresh / awayCrewBlockText). Hire bubbles UP to
  //     the host (App.svelte doHireAwayMember: pure engine fn, pushLog, doSave), so nothing here
  //     mutates state. Picking a ship in the selector only records the pick; Hire acts.
  //   - RESPONSIVE via a container query on the card grid only (one DOM, no isMobile branch).
  //
  // It lives INSIDE the Away Team tab (the officer candidate roster likewise lives inside its own
  // Senior Staff tab), and the selector defaults to the ship whose tab is open whenever that ship
  // can take the candidate, so the common case is one tap.
  // ============================================================================

  import { tick } from "svelte";
  import Icon from "./ui/Icon.svelte";
  import type { AwayMember, GameState } from "./game/model";
  import {
    AUGMENT_AFFINITY_RACES,
    awayBoardSecondsToRefresh,
    awayCrewBlockText,
    awayRecruitCandidates,
    hireTargetsForCandidate,
    implantSlotsFor,
    shipCrewLocked,
  } from "./game/awayTeam";
  import type { AwayCrewBlockReason } from "./game/awayTeam";
  import { getAwayTrait, awayTraitEffectText, traitDisplayText } from "./game/awayTraits";
  import { officerRosterWindowIndex } from "./game/seniorStaff";
  import { CREW_RANKS } from "./game/crewRank";
  import {
    SQUAD_META,
    awaySpecLabel,
    rankTier,
    awayRaceLabel,
    awayTargetLabel,
    awayCountdownText,
  } from "./awayTeamDisplay";

  // --- Props ------------------------------------------------------------------
  export let state: GameState;
  // The ship whose Away Team tab hosts the board: the default hire target when it can take a recruit.
  export let shipId: string;
  // Hire a candidate into a ship's squad of the candidate's team type (host: hireAwayMember).
  export let onHire: (candidateId: string, shipId: string) => void;

  const headingId = `rboard-title-${++boardInstanceCount}`;
  let headingEl: HTMLElement | null = null;

  // Move focus to the board heading without scrolling (the host scrolls first when it needs to). The
  // Away Team panel calls this from an open-slot card; the board calls it after a Hire, whose card
  // leaves the board and would otherwise drop focus to the page.
  export function focusHeading(): void {
    headingEl?.focus({ preventScroll: true });
  }

  // --- Local UI state ---------------------------------------------------------
  // The ship the player picked per candidate (candidate id -> ship id). A pick that is no longer a
  // valid target falls back to the default below. Cleared whenever the board window rolls over, so
  // picks for candidates that are gone never pile up.
  let picked: Record<string, string> = {};
  let lastWindow: number | null = null;
  $: windowIndex = officerRosterWindowIndex(state);
  $: if (windowIndex !== lastWindow) {
    lastWindow = windowIndex;
    picked = {};
  }

  interface TargetRow {
    shipId: string;
    label: string;
    ok: boolean;
    reason?: AwayCrewBlockReason;
  }
  interface CandidateRow {
    candidate: AwayMember;
    targets: TargetRow[];
    chosen: TargetRow | null;
  }

  // --- Derived reads ----------------------------------------------------------
  $: secondsToRefresh = awayBoardSecondsToRefresh(state);

  // Every candidate with its hire targets and the chosen one, MEMOIZED: the host reassigns `state`
  // on every tick poll, and rebuilding the board (and every candidate's per-ship gates) each time is
  // wasted work. The rows depend only on the board inputs (window, seed, board size), who is hired
  // where (the awayMembers ref, replaced by every hire / fire / move), each ship's name, hull and crew
  // lock (folded into a small string, because the ships / captains / expeditions refs churn on ticks
  // while the facts the gates read rarely change), the host ship and the picks.
  let memoKey = "";
  let memoMembers: AwayMember[] | null = null;
  let memoPicks: Record<string, string> | null = null;
  let memoRows: CandidateRow[] = [];
  $: rows = rowsFor(state, shipId, picked);

  function rowsFor(s: GameState, hostShipId: string, picks: Record<string, string>): CandidateRow[] {
    const shipsKey = s.ships
      .map((x) => `${x.id}:${x.name ?? ""}:${x.typeKey}:${shipCrewLocked(s, x.id) ? 1 : 0}`)
      .join(",");
    const key = `${officerRosterWindowIndex(s)}|${s.awayRecruitSeed}|${s.seniorStaffRosterSize}|${hostShipId}|${shipsKey}`;
    if (key === memoKey && s.awayMembers === memoMembers && picks === memoPicks) return memoRows;
    memoKey = key;
    memoMembers = s.awayMembers;
    memoPicks = picks;
    memoRows = buildRows(s, hostShipId, picks);
    return memoRows;
  }

  // One awayRecruitCandidates call for the whole board; each candidate's targets reuse it.
  function buildRows(s: GameState, hostShipId: string, picks: Record<string, string>): CandidateRow[] {
    return awayRecruitCandidates(s).map((candidate) => {
      const targets: TargetRow[] = hireTargetsForCandidate(s, candidate).map((t) => {
        const ship = s.ships.find((x) => x.id === t.shipId);
        const label = ship ? awayTargetLabel(ship, candidate.teamType) : t.shipId;
        return { shipId: t.shipId, label, ok: t.ok, reason: t.reason };
      });
      const pick = targets.find((t) => t.shipId === picks[candidate.id] && t.ok);
      const host = targets.find((t) => t.shipId === hostShipId && t.ok);
      const firstOk = targets.find((t) => t.ok);
      const fallback = targets.find((t) => t.shipId === hostShipId) ?? targets[0] ?? null;
      return { candidate, targets, chosen: pick ?? host ?? firstOk ?? fallback };
    });
  }

  // --- Display helpers --------------------------------------------------------
  // One trait as {label, effect, full}: the bold name, its generated effect text, and the full line
  // (flavor + effects) for the tooltip. An id the catalog no longer carries is skipped.
  function traitRows(m: AwayMember): { id: string; label: string; effect: string; full: string }[] {
    const out: { id: string; label: string; effect: string; full: string }[] = [];
    for (const id of m.traits) {
      const def = getAwayTrait(id);
      if (!def) continue;
      out.push({
        id,
        label: def.label,
        effect: def.effects.map((e) => awayTraitEffectText(e)).join(". "),
        full: traitDisplayText(def),
      });
    }
    return out;
  }
  function optionText(t: TargetRow): string {
    return t.ok || t.reason === undefined ? t.label : `${t.label} (${awayCrewBlockText(t.reason)})`;
  }
  // The visible reason a candidate cannot be hired right now, or null when Hire is live.
  function whyText(row: CandidateRow): string | null {
    if (row.chosen === null) return "No ship can take this recruit";
    if (row.chosen.ok || row.chosen.reason === undefined) return null;
    return awayCrewBlockText(row.chosen.reason);
  }

  function onPick(candidateId: string, e: Event): void {
    const value = (e.currentTarget as HTMLSelectElement).value;
    picked = { ...picked, [candidateId]: value };
  }
  // Hire, then (only when the hire actually happened, i.e. a member now carries this candidate's id
  // in hiredFrom) focus the heading, since the card leaves the board. On a refusal focus stays put.
  async function hire(row: CandidateRow): Promise<void> {
    if (row.chosen === null || !row.chosen.ok) return;
    const id = row.candidate.id;
    onHire(id, row.chosen.shipId);
    await tick();
    if (state.awayMembers.some((m) => m.hiredFrom === id)) focusHeading();
  }
</script>

<section class="rboard" aria-labelledby={headingId}>
  <div class="rboard-head">
    <span class="rboard-glyph"><Icon name="recruit" /></span>
    <h3 class="rboard-title" id={headingId} tabindex="-1" bind:this={headingEl}>Recruitment Board</h3>
    <span class="rboard-tag" title="The board refreshes every hour">
      <Icon name="clock" /> refreshes in {awayCountdownText(secondsToRefresh)}
    </span>
  </div>

  {#if rows.length === 0}
    <div class="rboard-empty">Everyone on this board has been hired. A fresh board arrives with the next refresh.</div>
  {:else}
    <div class="rboard-cands">
      {#each rows as row (row.candidate.id)}
        {@const c = row.candidate}
        {@const meta = SQUAD_META[c.teamType]}
        {@const why = whyText(row)}
        {@const whyId = `${headingId}-why-${c.id}`}
        <div class="rcand">
          <div class="rcand-name">{c.name}</div>
          <div class="rcand-row">
            <span class="rcand-rank rk-{rankTier(c.rank)}">{CREW_RANKS[c.rank].label}</span>
            <span class="aw-chip">{awayRaceLabel(c.race)}</span>
            <span class="aw-chip spec {c.teamType}"><Icon name={meta.icon} /> {meta.short} · {awaySpecLabel(c.spec)}</span>
            {#if AUGMENT_AFFINITY_RACES.has(c.race)}
              <span class="aw-chip aff" title="Augment affinity: a second implant slot">Augment affinity</span>
            {/if}
          </div>
          <div class="rcand-traits">
            {#each traitRows(c) as t (t.id)}
              <span class="rcand-trait" title={t.full}><b>{t.label}</b>: {t.effect}.</span>
            {/each}
          </div>
          <div class="rcand-foot">
            <span class="rcand-slots"><Icon name="implant" /> Implant slots: {implantSlotsFor(c)}</span>
            <span class="rcand-hire">
              <select
                class="rcand-select"
                aria-label="Hire {c.name} into"
                aria-describedby={why !== null ? whyId : undefined}
                value={row.chosen?.shipId ?? ""}
                on:change={(e) => onPick(c.id, e)}
              >
                {#each row.targets as t (t.shipId)}
                  <option value={t.shipId} disabled={!t.ok}>{optionText(t)}</option>
                {/each}
              </select>
              <button
                type="button"
                class="aw-btn primary"
                disabled={why !== null}
                aria-label="Hire {c.name}"
                aria-describedby={why !== null ? whyId : undefined}
                title={why ?? `Hire into ${row.chosen?.label ?? ""}`}
                on:click={() => hire(row)}
              >Hire</button>
            </span>
          </div>
          {#if why !== null}
            <div class="rcand-why" id={whyId}>{why}</div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
  <p class="rboard-hint">
    Rank sets how many traits a recruit carries, and it never levels. Firing a member returns their gear
    and implants to storage first.
  </p>
</section>

<style>
  .rboard {
    container-type: inline-size;
    padding: 12px;
    background: rgba(var(--color-accent-rgb), 0.04);
    border: 1px solid rgba(var(--color-accent-rgb), 0.16);
    border-radius: var(--corner);
    min-width: 0;
  }
  .rboard-head {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 10px;
  }
  .rboard-glyph {
    display: inline-flex;
    color: var(--color-accent);
    font-size: var(--text-lg);
  }
  .rboard-title {
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--text-md);
    letter-spacing: 0.04em;
    color: var(--color-text-primary);
  }
  /* Programmatic focus (after a Hire, or from an open-slot card) shows no ring after a mouse click,
     but a keyboard user gets a visible cue on the heading focus lands on. */
  .rboard-title:focus {
    outline: none;
  }
  .rboard-title:focus-visible {
    outline: 1px solid var(--color-accent);
    outline-offset: 3px;
  }
  .rboard-tag {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
    padding: 2px 7px;
    border: 1px solid rgba(var(--color-accent-rgb), 0.2);
    border-radius: var(--corner);
  }
  .rboard-empty {
    font-size: var(--text-xs);
    color: var(--color-text-dim);
    font-style: italic;
    padding: 6px 0;
  }

  /* minmax(0, 1fr) everywhere a track holds a select: a bare 1fr / auto track grows to the select's
     longest option ("Ship · Security (Ship is out on a mission)") and overflows a 375px phone. */
  .rboard-cands {
    display: grid;
    gap: 10px;
    grid-template-columns: minmax(0, 1fr);
  }
  @container (min-width: 560px) {
    .rboard-cands {
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    }
  }
  .rcand {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 7px;
    padding: 10px;
    min-width: 0;
    background: rgba(var(--color-accent-rgb), 0.05);
    border: 1px solid rgba(var(--color-accent-rgb), 0.16);
    border-radius: var(--corner);
  }
  .rcand-name {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--color-text-primary);
  }
  .rcand-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 5px;
  }
  .rcand-rank {
    font-family: var(--font-display);
    font-size: var(--text-xs);
    letter-spacing: 0.03em;
  }
  /* The rare find. Not --color-warning: that amber already means "blocked" in the reason lines. */
  .rk-hi {
    color: var(--rarity-constellar);
  }
  .rk-mid {
    color: var(--rarity-stellar);
  }
  .rk-lo {
    color: var(--color-text-secondary);
  }
  .rcand-traits {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }
  .rcand-trait b {
    color: var(--color-text-primary);
    font-weight: 600;
  }
  .rcand-foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .rcand-slots {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
  }
  .rcand-hire {
    margin-left: auto;
    display: flex;
    gap: 6px;
    min-width: 0;
    max-width: 100%;
  }
  .rcand-select {
    min-width: 0;
    max-width: 100%;
    flex: 1 1 auto;
    padding: 5px 6px;
    font-size: var(--text-xs);
    font-family: inherit;
    color: var(--color-text-primary);
    background: var(--color-bg-mid);
    border: 1px solid rgba(var(--color-accent-rgb), 0.3);
    border-radius: var(--corner);
  }
  .rcand-why {
    font-size: var(--text-2xs);
    color: var(--color-warning);
  }
  .rboard-hint {
    margin: 10px 0 0;
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
  }

  /* Shared chip + button look, kept identical to AwayTeamPanel's (each component scopes its own). The
     spec chip's border is the squad hue: set per squad type here, per squad section in the panel. */
  .aw-chip {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: var(--text-2xs);
    padding: 1px 6px;
    border-radius: var(--corner);
    border: 1px solid rgba(var(--color-accent-rgb), 0.18);
    background: rgba(var(--color-accent-rgb), 0.06);
    color: var(--color-text-secondary);
    white-space: nowrap;
  }
  .aw-chip.spec {
    --squad-hue: var(--color-accent-bright);
    color: var(--color-text-primary);
    border-color: var(--squad-hue);
  }
  .aw-chip.spec.security {
    --squad-hue: var(--color-danger);
  }
  .aw-chip.aff {
    color: var(--color-accent-bright);
    border-color: rgba(var(--color-accent-rgb), 0.5);
  }
  .aw-btn {
    flex: 0 0 auto;
    padding: 5px 12px;
    font-size: var(--text-xs);
    background: rgba(var(--color-accent-rgb), 0.08);
    border: 1px solid rgba(var(--color-accent-rgb), 0.3);
    border-radius: var(--corner);
    color: var(--color-text-secondary);
    cursor: pointer;
    white-space: nowrap;
  }
  .aw-btn.primary {
    background: rgba(var(--color-accent-rgb), 0.16);
    color: var(--color-accent-bright);
    border-color: var(--color-accent);
  }
  .aw-btn:hover:not(:disabled) {
    color: var(--color-text-primary);
    border-color: var(--color-accent);
  }
  .aw-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
</style>
