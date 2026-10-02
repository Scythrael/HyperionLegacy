<script lang="ts">
  // ============================================================================
  // AwayTeamPanel.svelte
  // E-CREW "Crew Made Real" Task 6 (approved mockup section 1, "A Ship's Away Team")
  //
  // The "Away Team" sub-tab of the ship-detail page (beside Loadout / Senior Staff / Complement):
  // one section per squad the hull fields (Security fights the random battles, Science does
  // fieldwork while scanning; a type with 0 slots, Prospecting today, never shows), each with its
  // named member cards and an open-slot card per free seat, then the Recruitment Board.
  //
  // POSTURE (mirrors SeniorStaffPanel / ComplementPanel):
  //   - PURE PRESENTATION + INTERACTION. Squad sizes, membership, implant slots, affinity and every
  //     crew gate come from the tested engine (game/awayTeam.ts); trait text is generated from the
  //     trait effects (game/awayTraits.ts). Fire / Move / Hire bubble UP to the host (App.svelte
  //     doFireAwayMember / doReassignAwayMember / doHireAwayMember), never mutating state here.
  //   - RESPONSIVE via container queries only: ONE DOM, the member grid reflows by the panel's own
  //     width. No isMobile branch, no separate mobile markup.
  //
  // NOT YET (later E-CREW tasks): gear cells read "Empty" until member gear lands (Stage 3), the
  // member stat line waits on member power (design 5.3), and injuries are only ever set by the
  // expedition claim (Task 16). The injury bar renders now if a member carries injuredUntilSeconds.
  // ============================================================================

  import { tick } from "svelte";
  import ActionModal from "./ActionModal.svelte";
  import RecruitmentBoard from "./RecruitmentBoard.svelte";
  import Icon from "./ui/Icon.svelte";
  import type { AwayMember, AwayTeamType, GameState } from "./game/model";
  import { AWAY_TEAM_TYPES, SHIP_TYPES } from "./game/model";
  import {
    AUGMENT_AFFINITY_RACES,
    awayCrewBlockText,
    canFireAwayMember,
    canReassignAwayMember,
    implantSlotsFor,
    membersInSquad,
    squadSlots,
  } from "./game/awayTeam";
  import type { AwayCrewGate } from "./game/awayTeam";
  import { getAwayTrait, traitDisplayText } from "./game/awayTraits";
  import { CREW_RANKS } from "./game/crewRank";
  import { CREW_RACES } from "./game/crewRaces";
  import type { IconName } from "./ui/icons";
  import { SQUAD_META, awaySpecLabel, awayShipName, awayCountdownText } from "./awayTeamDisplay";

  // --- Props ------------------------------------------------------------------
  export let state: GameState;
  export let shipId: string;
  // Hire a board candidate into a ship's squad (host: hireAwayMember).
  export let onHire: (candidateId: string, shipId: string) => void;
  // Fire a member (host: fireAwayMember; their gear returns to storage first). Confirmed below.
  export let onFire: (memberId: string) => void;
  // Move a member to another ship's squad of their own type (host: reassignAwayMember).
  export let onReassign: (memberId: string, shipId: string | null) => void;

  // --- Local UI state ---------------------------------------------------------
  let confirmFireId: string | null = null;
  let boardEl: HTMLElement | null = null;
  let lastShipId: string | null = null;
  $: if (shipId !== lastShipId) {
    lastShipId = shipId;
    confirmFireId = null;
  }

  // FIRST-PASS recovery base the injury bar scales against (design: 2h before Medical shortens it).
  // Task 16 owns the real duration; until a member stores when its recovery began, the bar shows the
  // share of this nominal span already recovered. PROVISIONAL, replaced when Task 16 lands.
  const NOMINAL_RECOVERY_SECONDS = 2 * 3600;

  // The three member gear slots, in the mockup's order. Gear lands in Stage 3, so each reads "Empty".
  const GEAR_SLOTS: { label: string; icon: IconName }[] = [
    { label: "Armor", icon: "armor" },
    { label: "Weapon", icon: "weaponHand" },
    { label: "Tool", icon: "tool" },
  ];

  interface MemberView {
    member: AwayMember;
    fire: AwayCrewGate;
    moveTargets: { shipId: string; label: string; gate: AwayCrewGate }[];
    injuredFor: number; // seconds of recovery left, 0 when ready
  }
  interface SquadView {
    teamType: AwayTeamType;
    slots: number;
    members: MemberView[];
    open: number;
  }

  // --- Derived reads ----------------------------------------------------------
  $: ship = state.ships.find((s) => s.id === shipId) ?? null;
  $: squads = ship ? buildSquads(state, shipId) : [];

  function buildSquads(s: GameState, id: string): SquadView[] {
    const host = s.ships.find((x) => x.id === id);
    if (!host) return [];
    const out: SquadView[] = [];
    for (const teamType of AWAY_TEAM_TYPES) {
      const slots = squadSlots(host.typeKey, teamType);
      if (slots === 0) continue; // a squad the hull does not field (Prospecting today)
      const members = membersInSquad(s, id, teamType).map((member) => ({
        member,
        fire: canFireAwayMember(s, member.id),
        moveTargets: s.ships
          .filter((x) => x.id !== id)
          .map((x) => ({
            shipId: x.id,
            label: `${awayShipName(x)} · ${SQUAD_META[teamType].short}`,
            gate: canReassignAwayMember(s, member.id, x.id),
          })),
        injuredFor: Math.max(0, (member.injuredUntilSeconds ?? 0) - s.gameTimeSeconds),
      }));
      out.push({ teamType, slots, members, open: Math.max(0, slots - members.length) });
    }
    return out;
  }

  // --- Display helpers --------------------------------------------------------
  function raceLabel(m: AwayMember): string {
    return CREW_RACES[m.race]?.label ?? m.race;
  }
  function traitChips(m: AwayMember): { id: string; label: string; full: string }[] {
    const out: { id: string; label: string; full: string }[] = [];
    for (const id of m.traits) {
      const def = getAwayTrait(id);
      if (def) out.push({ id, label: def.label, full: traitDisplayText(def) });
    }
    return out;
  }
  function recoveredPct(injuredFor: number): number {
    const left = Math.min(injuredFor, NOMINAL_RECOVERY_SECONDS);
    return Math.round((1 - left / NOMINAL_RECOVERY_SECONDS) * 100);
  }
  function gateText(gate: AwayCrewGate): string | undefined {
    return gate.ok ? undefined : awayCrewBlockText(gate.reason);
  }

  // --- Actions ----------------------------------------------------------------
  async function goToBoard(): Promise<void> {
    await tick();
    if (!boardEl) return;
    boardEl.scrollIntoView({ behavior: "smooth", block: "start" });
    const heading = boardEl.querySelector<HTMLElement>("#rboard-title");
    heading?.focus({ preventScroll: true });
  }
  function onMove(memberId: string, e: Event): void {
    const select = e.currentTarget as HTMLSelectElement;
    const target = select.value;
    select.value = ""; // the control is a one-shot picker; it always rests on its prompt
    if (target !== "") onReassign(memberId, target);
  }
  function confirmFire(): void {
    if (confirmFireId !== null) {
      onFire(confirmFireId);
      confirmFireId = null;
    }
  }
  $: fireTarget = confirmFireId !== null ? state.awayMembers.find((m) => m.id === confirmFireId) ?? null : null;
</script>

<div class="away">
  {#if ship === null}
    <div class="away-hint">Ship not found.</div>
  {:else}
    {#if squads.length === 0}
      <div class="away-hint">
        The {SHIP_TYPES[ship.typeKey]?.label ?? "ship"} fields no away team.
      </div>
    {/if}

    {#each squads as sq (sq.teamType)}
      {@const meta = SQUAD_META[sq.teamType]}
      <section class="squad {sq.teamType}">
        <div class="squad-h">
          <span class="squad-name"><Icon name={meta.icon} /> {meta.name}</span>
          <span class="squad-meta">{sq.members.length} of {sq.slots} · {meta.role}</span>
        </div>

        <div class="members">
          {#each sq.members as mv (mv.member.id)}
            {@const m = mv.member}
            <div class="mem" class:injured={mv.injuredFor > 0}>
              <div class="mem-top">
                <span class="mem-av"><Icon name={meta.icon} /></span>
                <div class="mem-idn">
                  <div class="mem-name">{m.name}</div>
                  <div class="mem-sub">{raceLabel(m)} · {CREW_RANKS[m.rank].label}</div>
                </div>
              </div>

              <div class="aw-chips">
                <span class="aw-chip spec">{awaySpecLabel(m.spec)}</span>
                {#each traitChips(m) as t (t.id)}
                  <span class="aw-chip" title={t.full}>{t.label}</span>
                {/each}
                {#if AUGMENT_AFFINITY_RACES.has(m.race)}
                  <span class="aw-chip aff" title="Augment affinity: a second implant slot">Augment affinity</span>
                {/if}
                {#if mv.injuredFor > 0}
                  <span class="aw-chip inj">Injured</span>
                {/if}
              </div>

              <div class="gear">
                {#each GEAR_SLOTS as g (g.label)}
                  <div class="gs none">
                    <div class="gs-k"><Icon name={g.icon} /> {g.label}</div>
                    <div class="gs-v">Empty</div>
                  </div>
                {/each}
              </div>

              <div class="imps">
                {#each Array(implantSlotsFor(m)) as _, i (i)}
                  <span class="imp open"><Icon name="implant" /> Implant</span>
                {/each}
              </div>

              {#if mv.injuredFor > 0}
                <div class="recov">
                  <Icon name="injury" />
                  <span class="recov-t">Recovering {awayCountdownText(mv.injuredFor)}</span>
                  <span class="recov-bar" aria-hidden="true"><i style="width:{recoveredPct(mv.injuredFor)}%"></i></span>
                </div>
              {/if}

              <div class="mem-acts">
                {#if mv.moveTargets.length > 0}
                  <select
                    class="mem-move"
                    aria-label="Move {m.name} to another ship"
                    value=""
                    on:change={(e) => onMove(m.id, e)}
                  >
                    <option value="" disabled>Move to...</option>
                    {#each mv.moveTargets as t (t.shipId)}
                      <option value={t.shipId} disabled={!t.gate.ok}>
                        {t.label}{t.gate.ok ? "" : ` (${gateText(t.gate)})`}
                      </option>
                    {/each}
                  </select>
                {/if}
                <button
                  type="button"
                  class="aw-btn danger"
                  disabled={!mv.fire.ok}
                  title={gateText(mv.fire) ?? `Fire ${m.name}`}
                  on:click={() => (confirmFireId = m.id)}
                >Fire</button>
              </div>
              {#if !mv.fire.ok}
                <div class="mem-why">{gateText(mv.fire)}</div>
              {/if}
            </div>
          {/each}

          {#each Array(sq.open) as _, i (i)}
            <button type="button" class="mem empty" on:click={goToBoard}>
              <span class="empty-glyph"><Icon name="recruit" size={22} /></span>
              <span>Open slot</span>
              <span class="empty-sub">Hire from the recruitment board</span>
            </button>
          {/each}
        </div>
      </section>
    {/each}

    <div class="away-board" bind:this={boardEl}>
      <RecruitmentBoard {state} {shipId} {onHire} />
    </div>
  {/if}
</div>

{#if fireTarget !== null}
  <ActionModal title="Fire Member" onClose={() => (confirmFireId = null)}>
    <p class="away-confirm">
      Fire <strong>{fireTarget.name}</strong> ({CREW_RANKS[fireTarget.rank].label}, {raceLabel(fireTarget)})?
      Their gear and implants go back to storage first, then they leave the fleet.
    </p>
    <svelte:fragment slot="footer">
      <button type="button" class="aw-btn" on:click={() => (confirmFireId = null)}>Cancel</button>
      <button type="button" class="aw-btn danger" on:click={confirmFire}>Fire</button>
    </svelte:fragment>
  </ActionModal>
{/if}

<style>
  /* The wrap is the container the member grid keys off, so the cards reflow by the panel's own width
     (the ship-detail body can be a narrow column on a wide screen). */
  .away {
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-width: 0;
  }
  .away-hint {
    font-size: var(--text-xs);
    color: var(--color-text-dim);
    font-style: italic;
    padding: 6px 0;
  }

  /* SQUAD: security wears the danger hue (it fights), science the accent (it studies). */
  .squad {
    --squad-hue: var(--color-accent-bright);
    min-width: 0;
  }
  .squad.security {
    --squad-hue: var(--color-danger);
  }
  .squad-h {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 10px;
    margin-bottom: 10px;
  }
  .squad-name {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-display);
    font-size: var(--text-md);
    letter-spacing: 0.03em;
    color: var(--squad-hue);
  }
  .squad-meta {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  /* minmax(0, 1fr): a bare 1fr / auto track would grow to the Move select's longest option and
     overflow a 375px phone. */
  .members {
    display: grid;
    gap: 10px;
    grid-template-columns: minmax(0, 1fr);
  }
  @container (min-width: 540px) {
    .members {
      grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
    }
  }

  .mem {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
    align-content: start;
    min-width: 0;
    padding: 10px;
    background: rgba(var(--color-accent-rgb), 0.05);
    border: 1px solid rgba(var(--color-accent-rgb), 0.16);
    border-radius: var(--corner);
  }
  .mem.injured {
    border-style: dashed;
    border-color: rgba(var(--color-warning-rgb), 0.55);
  }
  .mem.empty {
    place-items: center;
    align-content: center;
    min-height: 120px;
    gap: 3px;
    border-style: dashed;
    color: var(--color-text-dim);
    font-size: var(--text-xs);
    font-family: inherit;
    text-align: center;
    cursor: pointer;
  }
  .mem.empty:hover,
  .mem.empty:focus-visible {
    color: var(--color-accent-bright);
    border-color: var(--color-accent);
  }
  .empty-glyph {
    display: inline-flex;
  }
  .empty-sub {
    font-size: var(--text-2xs);
  }
  .mem-top {
    display: flex;
    gap: 9px;
    align-items: flex-start;
    min-width: 0;
  }
  .mem-av {
    flex: none;
    width: 34px;
    height: 34px;
    display: grid;
    place-items: center;
    font-size: var(--text-lg);
    color: var(--squad-hue);
    border: 1px solid rgba(var(--color-accent-rgb), 0.2);
    border-radius: var(--corner);
    background: rgba(var(--color-accent-rgb), 0.04);
  }
  .mem-idn {
    min-width: 0;
  }
  .mem-name {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--color-text-primary);
    overflow-wrap: anywhere;
  }
  .mem-sub {
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
  }

  .aw-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
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
    color: var(--color-text-primary);
    border-color: var(--squad-hue);
  }
  .aw-chip.aff {
    color: var(--color-accent-bright);
    border-color: rgba(var(--color-accent-rgb), 0.5);
  }
  .aw-chip.inj {
    color: var(--color-warning);
    border-color: rgba(var(--color-warning-rgb), 0.55);
  }

  /* GEAR: three cells, Armor / Weapon / Tool. Stays three-up at every width (cells ellipsize). */
  .gear {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 5px;
  }
  .gs {
    min-width: 0;
    padding: 5px 6px;
    border: 1px solid rgba(var(--color-accent-rgb), 0.12);
    border-radius: var(--corner);
    background: rgba(var(--color-accent-rgb), 0.03);
  }
  .gs-k {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: var(--text-3xs, var(--text-2xs));
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-text-dim);
  }
  .gs-v {
    font-size: var(--text-xs);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--color-text-primary);
  }
  .gs.none .gs-v {
    color: var(--color-text-dim);
  }

  .imps {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }
  .imp {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: var(--text-2xs);
    padding: 2px 8px;
    border-radius: var(--corner);
  }
  .imp.open {
    border: 1px dashed rgba(var(--color-accent-rgb), 0.3);
    color: var(--color-text-dim);
  }

  .recov {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--text-xs);
    color: var(--color-warning);
  }
  .recov-t {
    white-space: nowrap;
  }
  .recov-bar {
    flex: 1;
    height: 5px;
    overflow: hidden;
    border-radius: var(--corner);
    background: rgba(var(--color-warning-rgb), 0.15);
  }
  .recov-bar i {
    display: block;
    height: 100%;
    background: var(--color-warning);
  }

  .mem-acts {
    display: flex;
    gap: 6px;
    justify-content: flex-end;
    align-items: center;
    min-width: 0;
  }
  .mem-move {
    min-width: 0;
    flex: 1 1 auto;
    max-width: 100%;
    padding: 5px 6px;
    font-size: var(--text-xs);
    font-family: inherit;
    color: var(--color-text-secondary);
    background: var(--color-bg-mid);
    border: 1px solid rgba(var(--color-accent-rgb), 0.3);
    border-radius: var(--corner);
  }
  .mem-why {
    font-size: var(--text-2xs);
    color: var(--color-warning);
    text-align: right;
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
  .aw-btn:hover:not(:disabled) {
    color: var(--color-text-primary);
    border-color: var(--color-accent);
  }
  .aw-btn.danger {
    background: rgba(248, 113, 113, 0.1);
    border-color: rgba(248, 113, 113, 0.4);
    color: var(--color-danger, #f87171);
  }
  .aw-btn.danger:hover:not(:disabled) {
    background: rgba(248, 113, 113, 0.2);
  }
  .aw-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .away-confirm {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    line-height: 1.5;
  }
</style>
