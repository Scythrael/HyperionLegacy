<script lang="ts">
  // ============================================================================
  // AwayTeamPanel.svelte
  // E-CREW "Crew Made Real" Task 6 (approved mockup section 1, "A Ship's Away Team")
  //
  // The "Away Team" sub-tab of the ship-detail page (beside Loadout / Senior Staff / Complement):
  // GROUND TEAMS first (Ground Operations GO-11 + Squads SQ-7 section 7.1, mockups GO-M1 and the squads
  // mockup section 1): the composition block, one card per ground team (badge, name + Rename, the Ground /
  // Strike / Survey picker with refused options and their reasons, kind-sized squad slots with Swap /
  // Unslot and an empty-slot picker, the deploy status, the "help other teams" default), then the reserve
  // ("Aboard, not slotted"). Security fights during tasks, Science does the task fieldwork, scanning is
  // ship-side. Every display decision is in groundTeamDisplay.ts (tested); every write routes to an
  // App.svelte do* handler. While the ship is out, slot and type writes are locked with the engine's reason
  // (rename and the help default stay live, as the engine allows).
  // Then the CREW ABOARD roster: one section per squad type the hull fields (a type with 0 slots,
  // Prospecting today, never shows), each with its named member cards (gear, Move, Fire) and an open-slot
  // card per free seat, then the Recruitment Board.
  //
  // POSTURE (mirrors SeniorStaffPanel / ComplementPanel):
  //   - PURE PRESENTATION + INTERACTION. Squad sizes, membership, implant slots, affinity and every
  //     crew gate come from the tested engine (game/awayTeam.ts); trait text is generated from the
  //     trait effects (game/awayTraits.ts). Fire / Move / Hire bubble UP to the host (App.svelte
  //     doFireAwayMember / doReassignAwayMember / doHireAwayMember), never mutating state here.
  //   - EXPLICIT ACTIONS ONLY. A select never acts on change (on Windows Chromium the arrow keys on a
  //     closed select fire change, WCAG 3.2.2): Move is a pick plus a Move button, like the board's
  //     pick plus Hire. After Fire or Move, focus lands on the squad heading the card left.
  //   - GEAR (E-CREW Task 10): each Armor / Weapon / Tool cell and each implant chip is a button that
  //     opens the INSTALL FLOW for that slot: the ship install modal's pattern on the shared ActionModal
  //     shell (bottom sheet on a phone, centered on desktop): an Installed banner with Uninstall, the
  //     member's compatible spares, and a per-stat compare with the Install / Swap commit. Every control
  //     is gated by memberEquipment.ts (canFitToMember / canUnfitFromMember) and, when refused, shows the
  //     gate's reason as visible text tied by aria-describedby. Install / Uninstall bubble UP to the host
  //     (App.svelte doInstallOnMember / doUninstallFromMember). Hovering or focusing a worn piece shows its
  //     EquipmentTooltip (display only).
  //   - RESPONSIVE via container queries only: ONE DOM, the member grid reflows by the panel's own
  //     width. No isMobile branch, no separate mobile markup.
  //
  // NOT YET (later E-CREW tasks): the member stat line waits on member power (design 5.3). Injuries
  // are set by the expedition claim (Task 16, injuries.ts): an injured member shows the Injured chip and
  // a recovery bar measured against that injury's own span (injuryRecoveredFraction). The compare is a
  // plain per-stat sum of the two pieces (member power has no fold yet); a member-level compare-preview
  // helper can replace it when power lands.
  // ============================================================================

  import { onDestroy, tick } from "svelte";
  import ActionModal from "./ActionModal.svelte";
  import Toggle from "./Toggle.svelte";
  import TeamBadge from "./ui/TeamBadge.svelte";
  import { TEAM_KIND_GLYPHS } from "./ui/groundOpsAtoms";
  import RecruitmentBoard from "./RecruitmentBoard.svelte";
  import EquipmentTooltip, { equipmentRarityColor, statLabel } from "./EquipmentTooltip.svelte";
  import Icon from "./ui/Icon.svelte";
  import type { AwayMember, AwayTeamType, EquipmentInstance, GameState, GroundTeamKind, MemberSlotType } from "./game/model";
  import { GROUND_TEAM_NAME_MAX, type GroundSquadType } from "./game/groundTeams";
  import {
    GROUND_TEAMS_INTRO,
    RESERVE_CAP_NOTE,
    RESERVE_INTRO,
    SQUAD_TYPE_NAME,
    compositionSummary,
    crewRoomText,
    groundTeamsPanelView,
    kindChangeView,
    overCapacityText,
    slotPickCandidates,
  } from "./groundTeamDisplay";
  import type { GroundSlotView, GroundTeamCardView } from "./groundTeamDisplay";
  import { AWAY_TEAM_TYPES, SHIP_TYPES, isSparePiece } from "./game/model";
  import {
    canFitToMember,
    canUnfitFromMember,
    memberFitBlockText,
    memberPieceInSlot,
    memberSlotCapacity,
    memberWornIndex,
    pieceWearableBy,
  } from "./game/memberEquipment";
  import type { MemberFitGate } from "./game/memberEquipment";
  import {
    MEMBER_GEAR_CELLS,
    MEMBER_SLOT_META,
    fmtGearStat,
    UNIQUE_SELF_TEXT_GEAR_MODAL,
    isUniqueEquippedPiece,
    memberCompareRows,
    memberFitReasonText,
    memberGradeText,
    memberPieceName,
    untrainedGearNote,
  } from "./awayGearDisplay";
  import { clampFloatingTip } from "./floatingTip";
  import HelpTip from "./HelpTip.svelte";
  import {
    AUGMENT_AFFINITY_RACES,
    awayCrewBlockText,
    canFireAwayMember,
    canReassignAwayMember,
    membersInSquad,
    shipSquadSlots,
  } from "./game/awayTeam";
  import type { AwayCrewGate } from "./game/awayTeam";
  import { getAwayTrait, traitDisplayText } from "./game/awayTraits";
  import { injuryRecoveredFraction } from "./game/injuries";
  import { CREW_RANKS } from "./game/crewRank";
  import {
    SQUAD_META,
    AUGMENT_AFFINITY_TEXT,
    UNIQUE_TAG_TEXT,
    awaySpecDescription,
    awaySpecLabel,
    awayRaceLabel,
    awayTargetLabel,
    awayCountdownText,
    pickedMoveTarget,
  } from "./awayTeamDisplay";

  // --- Props ------------------------------------------------------------------
  export let state: GameState;
  export let shipId: string;
  // Hire a board candidate into a ship's squad (host: hireAwayMember).
  export let onHire: (candidateId: string, shipId: string) => void;
  // Fire a member (host: fireAwayMember; their gear returns to storage first). Confirmed below.
  export let onFire: (memberId: string) => void;
  // Move a member to another ship's squad of their own type (host: reassignAwayMember).
  export let onReassign: (memberId: string, shipId: string | null) => void;
  // Install a spare piece on a member (host: fitToMember). replacingInstanceId names the worn implant a
  // targeted swap sends back to storage; a singleton slot swaps its occupant without it.
  export let onInstall: (memberId: string, pieceId: string, replacingInstanceId?: string) => void;
  // Uninstall a worn piece back to storage (host: unfitFromMember).
  export let onUninstall: (memberId: string, pieceId: string) => void;
  // GROUND TEAMS (GO-11 + SQ-7 7.1). Each routes to an App.svelte do* handler over the pure groundTeams.ts
  // action (slotMember / unslotMember / swapGroundMembers / renameGroundTeam / setGroundTeamHelp /
  // setGroundTeamKind); the panel never mutates state and every control reads the same gates.
  export let onSlot: (shipId: string, teamIndex: number, teamType: GroundSquadType, slotIndex: number, memberId: string) => void;
  export let onUnslot: (shipId: string, memberId: string) => void;
  export let onSwap: (shipId: string, memberIdA: string, memberIdB: string) => void;
  export let onRenameTeam: (shipId: string, teamIndex: number, name: string | null) => void;
  export let onSetTeamHelp: (shipId: string, teamIndex: number, on: boolean) => void;
  export let onSetTeamKind: (shipId: string, teamIndex: number, kind: GroundTeamKind) => void;

  // --- Local UI state ---------------------------------------------------------
  let confirmFireId: string | null = null;
  // The ship picked in each member's Move selector (member id -> ship id). Picking only records it;
  // the Move button acts.
  let movePick: Record<string, string> = {};
  let boardEl: HTMLElement | null = null;
  let board: { focusHeading: () => void } | null = null;
  // Each squad's heading, the focus target after a Fire or Move takes a card away.
  let squadHeadings: Partial<Record<AwayTeamType, HTMLElement>> = {};
  let lastShipId: string | null = null;
  // Gear (Task 10): the open slot's install flow (whose, which slot, and for an implant chip the worn
  // implant it replaces; null = an open implant slot), the spare picked for its compare, and the worn
  // piece whose tooltip is showing. Declared here, above the ship-change reset that clears them.
  let gearPick: { memberId: string; slot: MemberSlotType; implantId: string | null } | null = null;
  let candidateId: string | null = null;
  let tip: { piece: EquipmentInstance; el: HTMLElement } | null = null;
  // Ground teams (GO-11): the kind picked in each team's radio group (applied only by its Change button, the
  // explicit-action posture), the team being renamed with its draft, and the open slot picker with its pick.
  let kindPick: Record<number, GroundTeamKind> = {};
  let renaming: number | null = null;
  let renameDraft = "";
  let slotPick: { teamIndex: number; teamType: GroundSquadType; slotIndex: number; occupant: AwayMember | null; label: string } | null =
    null;
  let slotPickId: string | null = null;
  $: if (shipId !== lastShipId) {
    lastShipId = shipId;
    kindPick = {};
    renaming = null;
    slotPick = null;
    slotPickId = null;
    confirmFireId = null;
    movePick = {};
    gearPick = null;
    candidateId = null;
    tip = null;
  }

  interface MemberView {
    member: AwayMember;
    fire: AwayCrewGate;
    moveTargets: { shipId: string; label: string; gate: AwayCrewGate }[];
    injuredFor: number; // seconds of recovery left, 0 when ready
    recoveredPct: number; // Task 16: the share of THIS injury already recovered, 0..100 (the recovery bar)
    // The worn piece per singleton cell (Armor, Weapon, Tool in MEMBER_GEAR_CELLS order), null = empty.
    gear: { slot: Exclude<MemberSlotType, "implant">; piece: EquipmentInstance | null }[];
    implants: EquipmentInstance[]; // worn implants, memberSlotPieces order
    implantOpen: number; // free implant slots (memberSlotCapacity minus worn)
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
    // ONE pass over the pool for every member's worn pieces (this rebuilds on every state change, i.e.
    // every tick), rather than a scan per member per slot.
    const worn = memberWornIndex(s);
    const out: SquadView[] = [];
    for (const teamType of AWAY_TEAM_TYPES) {
      const slots = shipSquadSlots(host, teamType); // Squads SQ-2: the composition's slots of this type
      if (slots === 0) continue; // a squad the hull does not field (Prospecting today)
      const members = membersInSquad(s, id, teamType).map((member) => ({
        member,
        fire: canFireAwayMember(s, member.id),
        moveTargets: s.ships
          .filter((x) => x.id !== id)
          .map((x) => ({
            shipId: x.id,
            label: awayTargetLabel(x, teamType),
            gate: canReassignAwayMember(s, member.id, x.id),
          })),
        injuredFor: Math.max(0, (member.injuredUntilSeconds ?? 0) - s.gameTimeSeconds),
        recoveredPct: Math.round(injuryRecoveredFraction(member, s.gameTimeSeconds) * 100),
        ...gearView(member, worn.get(member.id) ?? []),
      }));
      out.push({ teamType, slots, members, open: Math.max(0, slots - members.length) });
    }
    return out;
  }

  // A member's cells + implant chips from their worn list (memberWornIndex, already in mint order).
  function gearView(
    member: AwayMember,
    worn: EquipmentInstance[]
  ): Pick<MemberView, "gear" | "implants" | "implantOpen"> {
    const implants = worn.filter((p) => p.slotType === "implant");
    return {
      gear: MEMBER_GEAR_CELLS.map((slot) => ({ slot, piece: worn.find((p) => p.slotType === slot) ?? null })),
      implants,
      implantOpen: Math.max(0, memberSlotCapacity(member, "implant") - implants.length),
    };
  }

  // --- Ground teams (GO-11 + SQ-7 section 7.1) ----------------------------------
  $: gv = ship ? groundTeamsPanelView(state, shipId) : null;
  // The pending kind pick per team, dropped once it matches what the team already is (no change left).
  $: if (gv !== null) {
    let stale = false;
    for (const key of Object.keys(kindPick)) {
      const t = gv.teams[Number(key)];
      if (!t || (kindPick[Number(key)] === t.kind && !t.pending)) stale = true;
    }
    if (stale) {
      const next: Record<number, GroundTeamKind> = {};
      for (const [key, kind] of Object.entries(kindPick)) {
        const t = gv.teams[Number(key)];
        if (t && !(kind === t.kind && !t.pending)) next[Number(key)] = kind;
      }
      kindPick = next;
    }
  }
  function pickedKind(t: GroundTeamCardView, picks: Record<number, GroundTeamKind>): GroundTeamKind {
    return picks[t.index] ?? t.kind;
  }
  // A pick that changes nothing (the team's own kind, prompt already confirmed) clears the pick.
  function chooseKind(t: GroundTeamCardView, kind: GroundTeamKind): void {
    const next = { ...kindPick };
    if (kind === t.kind) delete next[t.index];
    else next[t.index] = kind;
    kindPick = next;
  }
  // Roving radio group (arrow keys / Home / End move the pick among the enabled options; nothing applies
  // until the Change button, WCAG 3.2.2).
  function onKindKey(t: GroundTeamCardView, e: KeyboardEvent): void {
    const enabled = t.options.filter((o) => !o.disabled).map((o) => o.kind);
    if (enabled.length === 0) return;
    const at = Math.max(0, enabled.indexOf(pickedKind(t, kindPick)));
    let to: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") to = (at + 1) % enabled.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") to = (at + enabled.length - 1) % enabled.length;
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = enabled.length - 1;
    if (to === null) return;
    e.preventDefault();
    chooseKind(t, enabled[to]);
    void focusKind(t.index, enabled[to]);
  }
  async function focusKind(teamIndex: number, kind: GroundTeamKind): Promise<void> {
    await tick();
    document.querySelector<HTMLElement>(`[data-kind-ship="${shipId}"][data-kind-team="${teamIndex}"][data-kind="${kind}"]`)?.focus();
  }
  async function applyKind(t: GroundTeamCardView, kind: GroundTeamKind): Promise<void> {
    onSetTeamKind(shipId, t.index, kind);
    const next = { ...kindPick };
    delete next[t.index];
    kindPick = next;
    await tick(); // read the team's kind AFTER the host applied (or refused) the change
    await focusKind(t.index, gv?.teams[t.index]?.kind ?? kind);
  }
  function cancelKind(t: GroundTeamCardView): void {
    const next = { ...kindPick };
    delete next[t.index];
    kindPick = next;
    void focusKind(t.index, t.kind);
  }

  // Rename (allowed while the ship is out: cosmetic). Blank or the default name clears the custom name.
  let renameButtons: Record<number, HTMLButtonElement> = {};
  let renameInput: HTMLInputElement | null = null;
  async function startRename(t: GroundTeamCardView): Promise<void> {
    renaming = t.index;
    renameDraft = t.renamed ? t.name : "";
    await tick();
    renameInput?.focus();
    renameInput?.select();
  }
  async function endRename(teamIndex: number, save: boolean): Promise<void> {
    if (save) onRenameTeam(shipId, teamIndex, renameDraft.trim() === "" ? null : renameDraft);
    renaming = null;
    await tick();
    renameButtons[teamIndex]?.focus();
  }
  function onRenameKey(teamIndex: number, e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      void endRename(teamIndex, false);
    }
  }

  // Slots: unslot in place; an empty slot opens the picker on the reserve, a filled one on the reserve plus
  // the members slotted elsewhere (a swap). Focus returns to the slot afterward.
  function slotKey(teamIndex: number, teamType: GroundSquadType, slotIndex: number): string {
    return `${shipId}:${teamIndex}:${teamType}:${slotIndex}`;
  }
  async function focusSlot(teamIndex: number, teamType: GroundSquadType, slotIndex: number): Promise<void> {
    await tick();
    const key = slotKey(teamIndex, teamType, slotIndex);
    document.querySelector<HTMLElement>(`[data-slot-key="${key}"]`)?.focus();
  }
  function unslot(teamIndex: number, sl: GroundSlotView): void {
    if (sl.member === null) return;
    onUnslot(shipId, sl.member.id);
    void focusSlot(teamIndex, sl.teamType, sl.slotIndex);
  }
  function openSlotPicker(t: GroundTeamCardView, sqLabel: string, sl: GroundSlotView): void {
    slotPickId = null;
    slotPick = {
      teamIndex: t.index,
      teamType: sl.teamType,
      slotIndex: sl.slotIndex,
      occupant: sl.member,
      label: `${t.name}, ${sqLabel}`,
    };
  }
  function closeSlotPicker(): void {
    const pick = slotPick;
    slotPick = null;
    slotPickId = null;
    if (pick !== null) void focusSlot(pick.teamIndex, pick.teamType, pick.slotIndex);
  }
  function commitSlotPick(): void {
    if (slotPick === null || slotPickId === null) return;
    if (slotPick.occupant === null) onSlot(shipId, slotPick.teamIndex, slotPick.teamType, slotPick.slotIndex, slotPickId);
    else onSwap(shipId, slotPick.occupant.id, slotPickId);
    closeSlotPicker();
  }
  function boardFromPicker(): void {
    slotPick = null;
    slotPickId = null;
    void tick().then(goToBoard);
  }
  $: pickCandidates =
    slotPick !== null ? slotPickCandidates(state, shipId, slotPick.teamType, slotPick.occupant?.id ?? null, slotPick.occupant !== null) : [];
  $: pickChosen = slotPickId !== null ? pickCandidates.find((c) => c.member.id === slotPickId) ?? null : null;

  // --- Display helpers --------------------------------------------------------
  function traitChips(m: AwayMember): { id: string; label: string; full: string }[] {
    const out: { id: string; label: string; full: string }[] = [];
    for (const id of m.traits) {
      const def = getAwayTrait(id);
      if (def) out.push({ id, label: def.label, full: traitDisplayText(def) });
    }
    return out;
  }
  function gateText(gate: AwayCrewGate): string | undefined {
    return gate.ok ? undefined : awayCrewBlockText(gate.reason);
  }

  // --- Actions ----------------------------------------------------------------
  // Jump to the board. The jump is instant (no smooth behavior requested), so it never animates.
  function goToBoard(): void {
    boardEl?.scrollIntoView({ block: "start" });
    board?.focusHeading();
  }
  function onPickMove(memberId: string, e: Event): void {
    movePick = { ...movePick, [memberId]: (e.currentTarget as HTMLSelectElement).value };
  }
  // Move, then (only when the move actually happened, i.e. the member left this ship) send focus to
  // the squad heading the card left. On a refusal the card stays and focus stays where it was.
  async function move(mv: MemberView, picks: Record<string, string>): Promise<void> {
    const target = pickedMoveTarget(mv.moveTargets, picks[mv.member.id]);
    if (target === null) return;
    const id = mv.member.id;
    onReassign(id, target.shipId);
    await tick();
    if (state.awayMembers.find((m) => m.id === id)?.assignedShipId === shipId) return; // refused
    const rest = { ...movePick };
    delete rest[id];
    movePick = rest;
    squadHeadings[mv.member.teamType]?.focus({ preventScroll: true });
  }
  // Fire (confirmed), then focus the squad heading only if the member is really gone.
  async function confirmFire(): Promise<void> {
    if (confirmFireId === null) return;
    const id = confirmFireId;
    const member = state.awayMembers.find((m) => m.id === id);
    onFire(id);
    confirmFireId = null;
    await tick();
    if (member && !state.awayMembers.some((m) => m.id === id)) {
      squadHeadings[member.teamType]?.focus({ preventScroll: true });
    }
  }
  $: fireTarget = confirmFireId !== null ? state.awayMembers.find((m) => m.id === confirmFireId) ?? null : null;

  // --- Gear: the install flow (E-CREW Task 10) ---------------------------------
  // The open slot: whose, which slot, and (implants only) the worn implant being replaced. A singleton
  // slot reads its occupant live (memberPieceInSlot), so the banner is never stale; an implant chip
  // names its implant, null for an open implant slot. The candidate is the spare picked for the compare.
  function openGear(memberId: string, slot: MemberSlotType, implantId: string | null): void {
    tip = null;
    candidateId = null;
    gearPick = { memberId, slot, implantId };
  }
  // Close the flow. The dialog hands focus back to its trigger, but an install, swap or uninstall can
  // remove that trigger (an implant chip is keyed by its implant), so settleFocus lands focus on a stable
  // target instead of <body>. The returning focus must not re-pop the cell tooltip (suppressFocusTip).
  function closeGear(): void {
    const pick = gearPick;
    gearPick = null;
    candidateId = null;
    suppressFocusTip = true;
    void settleFocus(pick);
  }
  async function settleFocus(pick: { memberId: string; slot: MemberSlotType } | null): Promise<void> {
    await tick();
    const active = document.activeElement;
    if (pick !== null && (active === null || active === document.body || !active.isConnected)) {
      // The member's cell for that slot (for an implant, their first implant chip, worn or open), else
      // the heading of the squad they are in.
      const cell = document.querySelector<HTMLElement>(
        `[data-gear-member="${pick.memberId}"][data-gear-slot="${pick.slot}"]`
      );
      const member = state.awayMembers.find((m) => m.id === pick.memberId);
      (cell ?? (member ? squadHeadings[member.teamType] : undefined))?.focus();
    }
    suppressFocusTip = false;
  }

  // Narrow dialog (the list and the compare drill, see the .gm-flow container queries): picking a spare
  // hides the list, so focus moves to the commit button (or Back when the commit is refused); Back returns
  // focus to the spare that was picked. On a wide dialog both panes stay visible and focus stays put.
  let gmListEl: HTMLDivElement | null = null;
  let gmBackEl: HTMLButtonElement | null = null;
  let gmCommitEl: HTMLButtonElement | null = null;
  async function pickCandidate(id: string): Promise<void> {
    candidateId = id;
    await tick();
    if (gmListEl !== null && gmListEl.offsetParent === null) {
      (gmCommitEl !== null && !gmCommitEl.disabled ? gmCommitEl : gmBackEl)?.focus();
    }
  }
  async function backToList(): Promise<void> {
    const prev = candidateId;
    candidateId = null;
    await tick();
    if (prev !== null) gmListEl?.querySelector<HTMLElement>(`[data-spare-id="${prev}"]`)?.focus();
  }

  interface GearFlow {
    member: AwayMember;
    slot: MemberSlotType;
    label: string;
    installed: EquipmentInstance | null;
    replacingId: string | undefined; // passed to the gate + install: the named implant on an implant swap
    uninstall: MemberFitGate | null; // null when nothing is installed
    // why: the refusal as player text ("" when ok). uniqueWhy (Task 11): the row's visible unique line, set
    // ONLY when a unique refusal resolved to specific text (the other wearer named, or "Already wears one"
    // on the wearer's own flow), so the generic fallback never renders in that line. null otherwise.
    spares: { piece: EquipmentInstance; gate: MemberFitGate; why: string; uniqueWhy: string | null }[];
  }
  // Everything the open flow shows, re-derived from state (so a tick, a salvage or an install elsewhere
  // can never leave it stale). Spares: free pieces of this slot THIS member's squad may wear (other
  // squads' gear is not listed at all, it could never install here), favorites first, then the higher
  // item level. Each carries its gate, so a locked or queued spare stays listed, disabled, with why.
  function buildGearFlow(s: GameState, pick: typeof gearPick): GearFlow | null {
    if (pick === null) return null;
    const member = s.awayMembers.find((m) => m.id === pick.memberId);
    if (!member) return null;
    const slot = pick.slot;
    const installed =
      slot === "implant"
        ? pick.implantId !== null
          ? s.equipment.find((e) => e.id === pick.implantId && e.fittedToMemberId === member.id) ?? null
          : null
        : memberPieceInSlot(s, member.id, slot);
    const replacingId = slot === "implant" && installed !== null ? installed.id : undefined;
    const spares = s.equipment
      .filter((p) => isSparePiece(p) && p.slotType === slot && pieceWearableBy(p, member.teamType))
      .sort((a, b) => Number(b.favorite === true) - Number(a.favorite === true) || b.iLevel - a.iLevel)
      .map((piece) => {
        const gate = canFitToMember(s, member.id, piece.id, replacingId);
        const why = gate.ok ? "" : memberFitReasonText(s, piece.id, gate.reason, member.id, UNIQUE_SELF_TEXT_GEAR_MODAL);
        const uniqueWhy =
          !gate.ok && gate.reason === "uniqueEquippedElsewhere" && why !== memberFitBlockText(gate.reason) ? why : null;
        return { piece, gate, why, uniqueWhy };
      });
    return {
      member,
      slot,
      label: MEMBER_SLOT_META[slot].label,
      installed,
      replacingId,
      uninstall: installed !== null ? canUnfitFromMember(s, member.id, installed.id) : null,
      spares,
    };
  }
  $: flow = buildGearFlow(state, gearPick);
  // A worn implant that left (swapped or uninstalled elsewhere) closes its flow rather than silently
  // turning it into an install into some other slot.
  $: if (gearPick !== null && (flow === null || (gearPick.implantId !== null && flow.installed === null))) closeGear();
  $: candidate = flow !== null && candidateId !== null ? flow.spares.find((x) => x.piece.id === candidateId) ?? null : null;
  $: compareRows = flow !== null && candidate !== null ? memberCompareRows(flow.installed, candidate.piece) : [];

  // The name a narrow gear cell shows: the variety alone ("Pulse Rifle"), since a cell is a third of a
  // phone-width card and "Standard-Issue " would ellipsize every baseline to the same text. The full name
  // stays in the cell's accessible name, its tooltip and the install flow.
  function cellName(p: EquipmentInstance): string {
    return memberPieceName(p).replace(/^Standard-Issue /, "");
  }
  function gateWhy(gate: MemberFitGate | null): string | undefined {
    return gate === null || gate.ok ? undefined : memberFitBlockText(gate.reason);
  }
  function installCandidate(f: GearFlow, pieceId: string): void {
    onInstall(f.member.id, pieceId, f.replacingId);
    closeGear();
  }
  function uninstallInstalled(f: GearFlow): void {
    if (f.installed === null) return;
    onUninstall(f.member.id, f.installed.id);
    closeGear();
  }

  // --- Gear: the hover / focus tooltip (display only) ---------------------------
  // One fixed-position EquipmentTooltip, portaled to <body> so no ancestor's overflow or transform can
  // clip or offset it, placed by the shared clampFloatingTip math (prefer above, flip below, clamp).
  // Rendered invisible for one frame, measured, then shown, so it never flashes at the wrong spot.
  // pointer-events: none (it holds no controls; the cell's own click opens the install flow).
  // Escape dismisses it; a scroll or resize (which move the anchor) hides it. Those three listeners are
  // attached only while a tip is open. Focus returning to a cell as a dialog closes does not re-pop it.
  let tipEl: HTMLDivElement | null = null;
  let tipLeft = 0;
  let tipTop = 0;
  let tipVisible = false;
  let tipListening = false;
  let suppressFocusTip = false;
  async function showTip(piece: EquipmentInstance | null, el: HTMLElement): Promise<void> {
    if (piece === null || gearPick !== null) return;
    tip = { piece, el };
    tipVisible = false;
    listenWhileTip(true);
    await tick();
    placeTip();
  }
  function onCellFocus(piece: EquipmentInstance | null, el: HTMLElement): void {
    if (suppressFocusTip) {
      suppressFocusTip = false;
      return;
    }
    void showTip(piece, el);
  }
  function hideTip(): void {
    tip = null;
    tipVisible = false;
    listenWhileTip(false);
  }
  function onTipKey(e: KeyboardEvent): void {
    if (e.key === "Escape") hideTip();
  }
  function listenWhileTip(on: boolean): void {
    if (on === tipListening) return;
    tipListening = on;
    if (on) {
      window.addEventListener("scroll", hideTip, true);
      window.addEventListener("resize", hideTip);
      window.addEventListener("keydown", onTipKey);
    } else {
      window.removeEventListener("scroll", hideTip, true);
      window.removeEventListener("resize", hideTip);
      window.removeEventListener("keydown", onTipKey);
    }
  }
  function placeTip(): void {
    if (tip === null || tipEl === null) return;
    const { left, top } = clampFloatingTip({
      anchorRect: tip.el.getBoundingClientRect(),
      tipWidth: tipEl.offsetWidth,
      tipHeight: tipEl.offsetHeight,
      viewportW: window.innerWidth,
      viewportH: window.innerHeight,
      margin: 8,
      gap: 8,
    });
    tipLeft = left;
    tipTop = top;
    tipVisible = true;
  }
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
  }
  onDestroy(() => listenWhileTip(false));
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

    {#if gv !== null && gv.teams.length > 0}
      {@const lockId = `gt-lock-${shipId}`}
      <!-- GROUND TEAMS (GO-11, mockup GO-M1; composition picker SQ-7 section 7.1). -->
      <section class="gt" aria-labelledby="gt-h-{shipId}">
        <div class="gt-head">
          <h3 class="gt-title" id="gt-h-{shipId}"><Icon name="groundTeam" size={20} /> Ground teams</h3>
          <p class="gt-intro">{GROUND_TEAMS_INTRO}</p>
        </div>
        {#if gv.locked}
          <p class="gt-lock" id={lockId}>
            <Icon name="lock" /> {gv.lockText}: slots and team types are locked until it returns. Renaming and the help setting still work.
          </p>
        {/if}

        <div class="gt-comp">
          <div class="gt-comp-top">
            <div>
              <div class="gt-comp-title">Composition</div>
              <div class="gt-comp-sum">{gv.compositionLabel}: {compositionSummary(gv.securitySquads, gv.scienceSquads)}</div>
            </div>
            <div class="gt-pips" aria-hidden="true">
              {#each gv.pips as team, ti (ti)}
                <span class="gt-pip-pair">
                  {#each team as type, qi (qi)}
                    <span class="gt-pip {type}"><Icon name={SQUAD_META[type].icon} size={16} /></span>
                  {/each}
                </span>
              {/each}
            </div>
          </div>
          <div class="gt-rule" class:ok={gv.valid}>
            <Icon name={gv.valid ? "check" : "close"} /> At least one Security and one Science squad{gv.valid ? "" : ": not met"}
          </div>
          <div class="gt-room">Aboard / slots: {crewRoomText(gv.room)}</div>
          {#if overCapacityText(gv.room) !== null}
            <p class="gt-over"><Icon name="warning" /> {overCapacityText(gv.room)}</p>
          {/if}
        </div>

        <div class="gt-teams">
          {#each gv.teams as t (t.index)}
            {@const pick = pickedKind(t, kindPick)}
            {@const change = kindPick[t.index] !== undefined ? kindChangeView(state, shipId, t.index, kindPick[t.index]) : null}
            {@const reasons = t.options.filter((o) => o.reason !== null)}
            <article class="gt-team" aria-labelledby="gt-team-{shipId}-{t.index}">
              <div class="gt-team-h">
                <TeamBadge index={t.index} kind={t.kind} name={t.name} />
                <div class="gt-team-id">
                  {#if renaming === t.index}
                    <form class="gt-rename" on:submit|preventDefault={() => endRename(t.index, true)}>
                      <label class="gt-sr" for="gt-name-{shipId}-{t.index}">Name for team {t.defaultName}</label>
                      <input
                        id="gt-name-{shipId}-{t.index}"
                        class="gt-input"
                        type="text"
                        maxlength={GROUND_TEAM_NAME_MAX}
                        placeholder={t.defaultName}
                        bind:value={renameDraft}
                        bind:this={renameInput}
                        on:keydown={(e) => onRenameKey(t.index, e)}
                      />
                      <button type="submit" class="aw-btn">Save</button>
                      <button type="button" class="aw-btn" on:click={() => endRename(t.index, false)}>Cancel</button>
                    </form>
                    <div class="gt-hint">Leave it blank to use {t.defaultName}.</div>
                  {:else}
                    <h4 class="gt-team-name" id="gt-team-{shipId}-{t.index}">{t.name}</h4>
                  {/if}
                  <div class="gt-kind-label">{t.kindLabel}</div>
                </div>
                {#if t.pending}
                  <span class="gt-pending"><Icon name="flag" /> Pick a type</span>
                {/if}
                {#if renaming !== t.index}
                  <button
                    type="button"
                    class="aw-btn"
                    aria-label="Rename {t.name}"
                    bind:this={renameButtons[t.index]}
                    on:click={() => startRename(t)}
                  >Rename</button>
                {/if}
              </div>

              <div
                class="gt-kinds"
                role="radiogroup"
                aria-label="{t.name} team type"
                aria-describedby={gv.locked ? lockId : reasons.length > 0 ? `gt-why-${shipId}-${t.index}` : undefined}
              >
                {#each t.options as o (o.kind)}
                  <button
                    type="button"
                    role="radio"
                    class="gt-kind"
                    aria-checked={pick === o.kind}
                    tabindex={pick === o.kind ? 0 : -1}
                    disabled={o.disabled || gv.locked}
                    data-kind-ship={shipId}
                    data-kind-team={t.index}
                    data-kind={o.kind}
                    on:click={() => chooseKind(t, o.kind)}
                    on:keydown={(e) => onKindKey(t, e)}
                  ><Icon name={TEAM_KIND_GLYPHS[o.kind]} size={20} /> {o.name}</button>
                {/each}
              </div>
              {#if reasons.length > 0}
                <div class="gt-why" id="gt-why-{shipId}-{t.index}">
                  {#each reasons as o (o.kind)}<div>{o.reason}</div>{/each}
                </div>
              {/if}

              {#if t.pending && change === null}
                <div class="gt-prompt">
                  <span>{t.name} works as a {t.kindLabel} until you pick its type.</span>
                  <button
                    type="button"
                    class="aw-btn primary"
                    disabled={gv.locked}
                    aria-describedby={gv.locked ? lockId : undefined}
                    on:click={() => applyKind(t, t.kind)}
                  >Keep {t.options.find((o) => o.kind === t.kind)?.name ?? "Ground"}</button>
                </div>
              {/if}

              {#if change !== null && kindPick[t.index] !== undefined}
                {@const to = kindPick[t.index]}
                {@const toName = t.options.find((o) => o.kind === to)?.name ?? to}
                <div class="gt-change" role="group" aria-label="Change {t.name} to {toName}">
                  {#if change.ok}
                    <p class="gt-change-line">Change {t.name} to {toName}? {change.moves}</p>
                    {#if change.overCapacity !== null}
                      <!-- Two short lines (GO-11 review): stacked on a narrow card, one sentence run on a wide one. -->
                      <p class="gt-change-line gt-over-line"><span class="gt-over-part">{change.overCapacity[0]}</span> <span class="gt-over-part">{change.overCapacity[1]}</span></p>
                    {/if}
                    <div class="gt-change-acts">
                      <button
                        type="button"
                        class="aw-btn primary"
                        disabled={gv.locked}
                        aria-describedby={gv.locked ? lockId : undefined}
                        on:click={() => applyKind(t, to)}
                      >Change to {toName}</button>
                      <button type="button" class="aw-btn" on:click={() => cancelKind(t)}>Cancel</button>
                    </div>
                  {:else}
                    <p class="gt-change-line gt-over-line">{change.reason}</p>
                    <div class="gt-change-acts">
                      <button type="button" class="aw-btn" on:click={() => cancelKind(t)}>Cancel</button>
                    </div>
                  {/if}
                </div>
              {/if}

              {#each t.squads as sq (`${sq.teamType}-${sq.typeSquadIndex}`)}
                <div class="gt-squad {sq.teamType}">
                  <div class="gt-squad-lbl"><Icon name={SQUAD_META[sq.teamType].icon} /> {sq.label}</div>
                  <div class="gt-slots" style="--gt-cols: {Math.min(4, sq.slots.length)};">
                    {#each sq.slots as sl, j (sl.slotIndex)}
                      {#if sl.member !== null}
                        {@const m = sl.member}
                        <div class="gt-slot filled" class:injured={sl.readyInSeconds > 0}>
                          <span class="gt-slot-name">{m.name}</span>
                          <span class="gt-slot-sub">{awaySpecLabel(m.spec)} · {CREW_RANKS[m.rank].label}</span>
                          {#if sl.readyInSeconds > 0}
                            <span class="gt-slot-wait"><Icon name="injury" /> Back in {awayCountdownText(sl.readyInSeconds)}</span>
                          {/if}
                          <span class="gt-slot-acts">
                            <button
                              type="button"
                              class="gt-mini"
                              disabled={gv.locked}
                              aria-describedby={gv.locked ? lockId : undefined}
                              aria-label="Swap {m.name} ({t.name}, {sq.label})"
                              data-slot-key={slotKey(t.index, sl.teamType, sl.slotIndex)}
                              on:click={() => openSlotPicker(t, sq.label, sl)}
                            >Swap</button>
                            <button
                              type="button"
                              class="gt-mini"
                              disabled={gv.locked}
                              aria-describedby={gv.locked ? lockId : undefined}
                              aria-label="Unslot {m.name} to the reserve"
                              on:click={() => unslot(t.index, sl)}
                            >Unslot</button>
                          </span>
                        </div>
                      {:else}
                        <button
                          type="button"
                          class="gt-slot empty"
                          disabled={gv.locked}
                          aria-describedby={gv.locked ? lockId : undefined}
                          aria-label="Empty slot {j + 1}, {t.name} {sq.label}. Slot a member"
                          data-slot-key={slotKey(t.index, sl.teamType, sl.slotIndex)}
                          on:click={() => openSlotPicker(t, sq.label, sl)}
                        >
                          <span>Empty slot</span>
                          <span class="gt-slot-sub">Slot a member</span>
                        </button>
                      {/if}
                    {/each}
                  </div>
                </div>
              {/each}

              <div class="gt-status" class:ready={t.deploys}>
                {#if t.deploys}
                  <Icon name="check" /> Ready to deploy
                {:else if !t.staffed}
                  Stays aboard: nobody is slotted.
                {:else}
                  <span class="gt-status-h">Will not deploy yet:</span>
                  {#each t.waits as w, wi (wi)}<span class="gt-status-w">{w}</span>{/each}
                {/if}
              </div>

              <div class="gt-help">
                <Toggle
                  checked={t.helpOthers}
                  label="When done, help other teams ({t.name})"
                  on:change={(e) => onSetTeamHelp(shipId, t.index, e.detail)}
                />
                <span class="gt-help-t">When done, help other teams <span class="gt-help-sub">(from the next launch)</span></span>
              </div>
            </article>
          {/each}
        </div>

        <div class="gt-reserve">
          <h4 class="gt-res-h">Aboard, not slotted</h4>
          <p class="gt-res-p">{RESERVE_INTRO} Reserve berths in use: {gv.room.berthsUsed} of {gv.room.capacity.reserveBerths}.</p>
          {#if gv.reserve.length === 0}
            <p class="gt-res-p gt-dim">Nobody is in the reserve.</p>
          {:else}
            <ul class="gt-res-list">
              {#each gv.reserve as m (m.id)}
                <li class="gt-res-m">
                  <Icon name={SQUAD_META[m.teamType].icon} />
                  <span class="gt-res-name">{m.name}</span>
                  <span class="gt-res-sub">{SQUAD_META[m.teamType].short} · {awaySpecLabel(m.spec)} · {CREW_RANKS[m.rank].label}</span>
                </li>
              {/each}
            </ul>
            <p class="gt-res-p gt-dim">{RESERVE_CAP_NOTE}</p>
          {/if}
        </div>
      </section>

      <div class="gt-head">
        <h3 class="gt-title">Crew aboard</h3>
        <p class="gt-intro">Gear, moves and hiring for everyone aboard, slotted or in the reserve.</p>
      </div>
    {/if}

    {#each squads as sq (sq.teamType)}
      {@const meta = SQUAD_META[sq.teamType]}
      <section class="squad {sq.teamType}" aria-labelledby="away-squad-{shipId}-{sq.teamType}">
        <div class="squad-h">
          <h4
            class="squad-name"
            id="away-squad-{shipId}-{sq.teamType}"
            tabindex="-1"
            bind:this={squadHeadings[sq.teamType]}
          ><Icon name={meta.icon} /> {meta.name}</h4>
          <span class="squad-meta">{sq.members.length} aboard for {sq.slots} slots · {meta.role}</span>
        </div>

        <div class="members">
          {#each sq.members as mv (mv.member.id)}
            {@const m = mv.member}
            {@const whyId = `away-why-${m.id}`}
            {@const moveTo = pickedMoveTarget(mv.moveTargets, movePick[m.id])}
            <div class="mem" class:injured={mv.injuredFor > 0}>
              <div class="mem-top">
                <span class="mem-av"><Icon name={meta.icon} /></span>
                <div class="mem-idn">
                  <div class="mem-name">{m.name}</div>
                  <div class="mem-sub">{awayRaceLabel(m.race)} · {CREW_RANKS[m.rank].label}</div>
                </div>
              </div>

              <!-- Each chip explains itself on hover / tap / keyboard focus (the shared HelpTip, chip mode). -->
              <div class="aw-chips">
                <HelpTip label={awaySpecLabel(m.spec)} text={awaySpecDescription(m.spec)}
                  ><span class="aw-chip spec">{awaySpecLabel(m.spec)}</span></HelpTip
                >
                {#each traitChips(m) as t (t.id)}
                  <HelpTip label={t.label} text={t.full}><span class="aw-chip">{t.label}</span></HelpTip>
                {/each}
                {#if AUGMENT_AFFINITY_RACES.has(m.race)}
                  <HelpTip label="Augment affinity" text={AUGMENT_AFFINITY_TEXT}
                    ><span class="aw-chip aff">Augment affinity</span></HelpTip
                  >
                {/if}
                {#if mv.injuredFor > 0}
                  <span class="aw-chip inj">Injured</span>
                {/if}
              </div>

              <!-- GEAR (Task 10): each cell opens its slot's install flow. A worn piece shows its name in
                   its rarity color, with its tooltip on hover / focus; the third line names the action. -->
              <div class="gear">
                {#each mv.gear as g (g.slot)}
                  {@const meta = MEMBER_SLOT_META[g.slot]}
                  <!-- D20: a Med Kit on a member without Medical Training cannot heal; say so on the cell. -->
                  {@const trainNote = g.piece !== null ? untrainedGearNote(g.piece, m) : null}
                  <button
                    type="button"
                    class="gs"
                    class:none={g.piece === null}
                    style={g.piece !== null ? `--gs-rc: ${equipmentRarityColor(g.piece.rarity)};` : undefined}
                    aria-label={g.piece !== null
                      ? `${meta.label}: ${memberPieceName(g.piece)}.${trainNote !== null ? ` ${trainNote}.` : ""} Swap or uninstall`
                      : `${meta.label}: empty. Install`}
                    data-gear-member={m.id}
                    data-gear-slot={g.slot}
                    on:click={() => openGear(m.id, g.slot, null)}
                    on:mouseenter={(e) => showTip(g.piece, e.currentTarget)}
                    on:mouseleave={hideTip}
                    on:focus={(e) => onCellFocus(g.piece, e.currentTarget)}
                    on:blur={hideTip}
                  >
                    <span class="gs-k"><Icon name={meta.icon} /> {meta.label}</span>
                    <span class="gs-v">{g.piece !== null ? cellName(g.piece) : "Empty"}</span>
                    {#if trainNote !== null}<span class="gs-note" aria-hidden="true">Needs Medical Training</span>{/if}
                    <span class="gs-a" aria-hidden="true">{g.piece !== null ? "Swap" : "Install"}</span>
                  </button>
                {/each}
              </div>

              <div class="imps">
                {#each mv.implants as imp (imp.id)}
                  <button
                    type="button"
                    class="imp worn"
                    style="--gs-rc: {equipmentRarityColor(imp.rarity)};"
                    aria-label={`Implant: ${memberPieceName(imp)}${isUniqueEquippedPiece(imp) ? ", unique" : ""}. Swap or uninstall`}
                    data-gear-member={m.id}
                    data-gear-slot="implant"
                    on:click={() => openGear(m.id, "implant", imp.id)}
                    on:mouseenter={(e) => showTip(imp, e.currentTarget)}
                    on:mouseleave={hideTip}
                    on:focus={(e) => onCellFocus(imp, e.currentTarget)}
                    on:blur={hideTip}
                  ><Icon name="implant" /> {memberPieceName(imp)}{#if isUniqueEquippedPiece(imp)}<span class="uniq-tag" aria-hidden="true">Unique</span>{/if}</button>
                {/each}
                {#each Array(mv.implantOpen) as _, i (i)}
                  <button
                    type="button"
                    class="imp open"
                    aria-label="Empty implant slot. Install"
                    data-gear-member={m.id}
                    data-gear-slot="implant"
                    on:click={() => openGear(m.id, "implant", null)}
                  ><Icon name="implant" /> Implant</button>
                {/each}
              </div>

              {#if mv.injuredFor > 0}
                <div class="recov">
                  <Icon name="injury" />
                  <span class="recov-t">Recovering {awayCountdownText(mv.injuredFor)}</span>
                  <span class="recov-bar" aria-hidden="true"><i style="width:{mv.recoveredPct}%"></i></span>
                </div>
              {/if}

              <div class="mem-acts">
                {#if mv.moveTargets.length > 0}
                  <select
                    class="mem-move"
                    aria-label="Ship to move {m.name} to"
                    value={moveTo?.shipId ?? ""}
                    on:change={(e) => onPickMove(m.id, e)}
                  >
                    <option value="" disabled>Move to...</option>
                    {#each mv.moveTargets as t (t.shipId)}
                      <option value={t.shipId} disabled={!t.gate.ok}>
                        {t.label}{t.gate.ok ? "" : ` (${gateText(t.gate)})`}
                      </option>
                    {/each}
                  </select>
                  <button
                    type="button"
                    class="aw-btn"
                    disabled={moveTo === null}
                    aria-label="Move {m.name}"
                    title={moveTo === null ? "Pick a ship to move to first" : `Move ${m.name} to ${moveTo.label}`}
                    on:click={() => move(mv, movePick)}
                  >Move</button>
                {/if}
                <button
                  type="button"
                  class="aw-btn danger"
                  disabled={!mv.fire.ok}
                  aria-label="Fire {m.name}"
                  aria-describedby={mv.fire.ok ? undefined : whyId}
                  title={gateText(mv.fire) ?? `Fire ${m.name}`}
                  on:click={() => (confirmFireId = m.id)}
                >Fire</button>
              </div>
              {#if !mv.fire.ok}
                <div class="mem-why" id={whyId}>{gateText(mv.fire)}</div>
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
      <RecruitmentBoard bind:this={board} {state} {shipId} {onHire} />
    </div>
  {/if}
</div>

{#if fireTarget !== null}
  <ActionModal title="Fire Member" onClose={() => (confirmFireId = null)}>
    <p class="away-confirm">
      Fire <strong>{fireTarget.name}</strong> ({CREW_RANKS[fireTarget.rank].label}, {awayRaceLabel(fireTarget.race)})?
      Their gear and implants go back to storage first, then they leave the fleet.
    </p>
    <svelte:fragment slot="footer">
      <button type="button" class="aw-btn" on:click={() => (confirmFireId = null)}>Cancel</button>
      <button type="button" class="aw-btn danger" on:click={confirmFire}>Fire</button>
    </svelte:fragment>
  </ActionModal>
{/if}

<!-- SLOT PICKER (GO-11): pick a member, then Slot / Swap. An empty slot lists the reserve of its type; a filled
     slot also lists that type's members slotted elsewhere (a swap moves them here and the occupant there). -->
{#if slotPick !== null}
  {@const sp = slotPick}
  {@const typeName = SQUAD_TYPE_NAME[sp.teamType]}
  <ActionModal
    title={sp.occupant !== null ? `Swap ${sp.occupant.name}` : "Slot a member"}
    ariaLabel={sp.occupant !== null ? `Swap ${sp.occupant.name}, ${sp.label}` : `Slot a member into ${sp.label}`}
    onClose={closeSlotPicker}
  >
    <p class="gm-who">{sp.label}, slot {sp.slotIndex + 1}</p>
    {#if pickCandidates.length === 0}
      <p class="gm-note">
        {sp.occupant !== null
          ? `No other ${typeName} member is aboard to swap with.`
          : `No ${typeName} member is in the reserve. Unslot one from another team, or hire one from the recruitment board.`}
      </p>
      {#if sp.occupant === null}
        <button type="button" class="aw-btn gt-board-btn" on:click={boardFromPicker}>Go to the recruitment board</button>
      {/if}
    {:else}
      <div class="gm-list gt-pick-list">
        {#each pickCandidates as c (c.member.id)}
          <button
            type="button"
            class="gm-spare"
            class:sel={slotPickId === c.member.id}
            aria-pressed={slotPickId === c.member.id}
            on:click={() => (slotPickId = c.member.id)}
          >
            <span class="gm-ic"><Icon name={SQUAD_META[c.member.teamType].icon} /></span>
            <span class="gm-text">
              <span class="gm-name">{c.member.name}</span>
              <span class="gm-sub">{awaySpecLabel(c.member.spec)} · {CREW_RANKS[c.member.rank].label} · {awayRaceLabel(c.member.race)}</span>
              <span class="gm-sub">{c.where === null ? "In the reserve" : `Slotted: ${c.where}`}</span>
              {#if c.readyInSeconds > 0}
                <span class="gm-sub gm-wearer">Recovering: back in {awayCountdownText(c.readyInSeconds)}. The team waits for them.</span>
              {/if}
            </span>
          </button>
        {/each}
      </div>
    {/if}
    <svelte:fragment slot="footer">
      <button type="button" class="aw-btn" on:click={closeSlotPicker}>Cancel</button>
      {#if pickCandidates.length > 0}
        <button type="button" class="aw-btn primary" disabled={pickChosen === null} on:click={commitSlotPick}
          >{sp.occupant !== null
            ? pickChosen !== null
              ? `Swap with ${pickChosen.member.name}`
              : "Swap"
            : pickChosen !== null
              ? `Slot ${pickChosen.member.name}`
              : "Slot"}</button
        >
      {/if}
    </svelte:fragment>
  </ActionModal>
{/if}

<!-- GEAR INSTALL FLOW (Task 10): the ship install modal's structure on the shared ActionModal shell.
     1. INSTALLED banner, with Uninstall (disabled with its reason when the gate refuses).
     2. Master-detail: the member's compatible spares + the per-stat compare with the Install / Swap
        commit. On a narrow dialog it drills (list, then compare, Back returns); on a wide one the two
        sit side by side (container queries on the dialog, which is an inline-size container). -->
{#if flow !== null}
  {@const f = flow}
  {@const verb = f.installed !== null ? "Swap" : "Install"}
  {@const uninstallWhy = gateWhy(f.uninstall)}
  <ActionModal title={`${verb} · ${f.label}`} ariaLabel={`${verb} ${f.label} for ${f.member.name}`} onClose={closeGear}>
    <p class="gm-who">{f.member.name} · {SQUAD_META[f.member.teamType].name}</p>
    <div class="gm-installed">
      <span class="gm-tag">Installed</span>
      {#if f.installed !== null}
        <span class="gm-text">
          <span class="gm-name" style="color: {equipmentRarityColor(f.installed.rarity)};">{memberPieceName(f.installed)}{#if isUniqueEquippedPiece(f.installed)}<HelpTip label="Unique" text={UNIQUE_TAG_TEXT}><span class="uniq-tag">Unique</span></HelpTip>{/if}</span>
          <span class="gm-sub">{memberGradeText(f.installed, true)}</span>
          {#if untrainedGearNote(f.installed, f.member) !== null}<span class="gm-sub gm-train">{untrainedGearNote(f.installed, f.member)}</span>{/if}
        </span>
        <button
          type="button"
          class="aw-btn"
          disabled={uninstallWhy !== undefined}
          aria-describedby={uninstallWhy !== undefined ? "gm-uninstall-why" : undefined}
          on:click={() => uninstallInstalled(f)}
        >Uninstall</button>
      {:else}
        <span class="gm-text"><span class="gm-name gm-dim">Nothing installed</span></span>
      {/if}
    </div>
    {#if uninstallWhy !== undefined}
      <div class="mem-why" id="gm-uninstall-why">{uninstallWhy}</div>
    {/if}

    {#if f.spares.length === 0}
      <p class="gm-note">
        No spare {f.slot === "implant" ? "implants" : f.label.toLowerCase()} for the {SQUAD_META[f.member.teamType].short} squad in storage.
        {f.slot === "implant"
          ? "Craft one at the Fabricator."
          : "Requisition Standard-Issue kit at the Quartermaster, or craft one at the Fabricator."}
      </p>
    {:else}
      <div class="gm-flow" class:has-candidate={candidate !== null}>
        <div class="gm-list" bind:this={gmListEl}>
          {#each f.spares as sp (sp.piece.id)}
            <button
              type="button"
              class="gm-spare"
              class:sel={candidateId === sp.piece.id}
              class:blocked={!sp.gate.ok}
              aria-pressed={candidateId === sp.piece.id}
              aria-label={`${memberPieceName(sp.piece)}${isUniqueEquippedPiece(sp.piece) ? ", unique" : ""}: ${memberGradeText(sp.piece, true)}.${sp.gate.ok ? "" : ` Cannot install: ${sp.why}.`} Compare.`}
              data-spare-id={sp.piece.id}
              on:click={() => pickCandidate(sp.piece.id)}
            >
              <span class="gm-ic" style="color: {equipmentRarityColor(sp.piece.rarity)};"><Icon name={MEMBER_SLOT_META[f.slot].icon} /></span>
              <span class="gm-text">
                <span class="gm-name" style="color: {equipmentRarityColor(sp.piece.rarity)};">{memberPieceName(sp.piece)}{#if isUniqueEquippedPiece(sp.piece)}<span class="uniq-tag" aria-hidden="true">Unique</span>{/if}</span>
                <span class="gm-sub">{memberGradeText(sp.piece, true)}</span>
                {#if sp.uniqueWhy !== null}<span class="gm-sub gm-wearer">{sp.uniqueWhy}</span>{/if}
                {#if untrainedGearNote(sp.piece, f.member) !== null}<span class="gm-sub gm-train">{untrainedGearNote(sp.piece, f.member)}</span>{/if}
              </span>
              {#if !sp.gate.ok}<span class="gm-blocked">Blocked</span>{/if}
            </button>
          {/each}
        </div>

        <div class="gm-compare">
          {#if candidate !== null}
            {@const why = candidate.gate.ok ? undefined : candidate.why}
            <div class="gm-compare-head">
              <button type="button" class="aw-btn gm-back" bind:this={gmBackEl} on:click={backToList} aria-label="Back to the spare list">Back</button>
              <span class="gm-compare-title">Comparison</span>
            </div>
            <div class="gm-compare-name" style="color: {equipmentRarityColor(candidate.piece.rarity)};">{memberPieceName(candidate.piece)}</div>
            {#if compareRows.length === 0}
              <p class="gm-note">Neither piece carries a stat line.</p>
            {:else}
              <div class="gm-rows">
                {#each compareRows as row (row.key)}
                  <div class="gm-row">
                    <span class="gm-k">{statLabel(row.key)}</span>
                    <span class="gm-v">
                      {fmtGearStat(row.current)} &rarr;
                      <span class:up={row.delta > 0} class:down={row.delta < 0}>{fmtGearStat(row.candidate)}</span>
                      {#if row.delta !== 0}<small class:up={row.delta > 0} class:down={row.delta < 0}>({fmtGearStat(row.delta)})</small>{/if}
                    </span>
                  </div>
                {/each}
              </div>
            {/if}
            <button
              type="button"
              class="aw-btn gm-commit"
              bind:this={gmCommitEl}
              disabled={why !== undefined}
              aria-describedby={why !== undefined ? "gm-commit-why" : undefined}
              on:click={() => installCandidate(f, candidate.piece.id)}
            >{verb}</button>
            {#if why !== undefined}
              <div class="mem-why" id="gm-commit-why">{why}</div>
            {/if}
          {:else}
            <p class="gm-note">Select a piece to compare it with what is installed.</p>
          {/if}
        </div>
      </div>
    {/if}
    <svelte:fragment slot="footer">
      <button type="button" class="aw-btn" on:click={closeGear}>Cancel</button>
    </svelte:fragment>
  </ActionModal>
{/if}

<!-- The worn-piece tooltip (display only): portaled + clamped, see showTip. -->
{#if tip !== null}
  <div
    class="gm-tip"
    role="tooltip"
    use:portal
    bind:this={tipEl}
    style="left: {tipLeft}px; top: {tipTop}px; visibility: {tipVisible ? 'visible' : 'hidden'};"
  >
    <EquipmentTooltip piece={tip.piece} />
  </div>
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
    margin: 0;
    font-weight: normal;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-display);
    font-size: var(--text-md);
    letter-spacing: 0.03em;
    color: var(--squad-hue);
  }
  .squad-name:focus {
    outline: none;
  }
  .squad-name:focus-visible {
    outline: 1px solid var(--color-accent);
    outline-offset: 3px;
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
  /* Same chip look as the board's (each component scopes its own); the spec border is the squad hue. */
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
  /* A cell is a BUTTON (it opens the slot's install flow): bare-button chrome so it reads as the
     mockup's cell, a worn piece tints its border with its rarity (--gs-rc), hover / focus lift it. */
  .gs {
    --gs-rc: rgba(var(--color-accent-rgb), 0.12);
    display: flex;
    flex-direction: column;
    align-items: stretch;
    min-width: 0;
    padding: 5px 6px;
    border: 1px solid rgba(var(--color-accent-rgb), 0.12);
    border-left: 2px solid var(--gs-rc);
    border-radius: var(--corner);
    background: rgba(var(--color-accent-rgb), 0.03);
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }
  .gs:hover,
  .gs:focus-visible {
    border-color: var(--color-accent);
    background: rgba(var(--color-accent-rgb), 0.08);
  }
  .gs:focus-visible {
    outline: 1px solid var(--color-accent);
    outline-offset: 1px;
  }
  .gs-a {
    font-size: var(--text-3xs);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--color-accent-bright);
  }
  .gs-k {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: var(--text-3xs);
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
  .gs:not(.none) .gs-v {
    color: var(--gs-rc);
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
    max-width: 100%;
    min-width: 0;
    font: inherit;
    font-size: var(--text-2xs);
    padding: 2px 8px;
    border-radius: var(--corner);
    background: none;
    cursor: pointer;
    overflow-wrap: anywhere;
    text-align: left;
  }
  .imp.open {
    border: 1px dashed rgba(var(--color-accent-rgb), 0.3);
    color: var(--color-text-dim);
  }
  .imp.worn {
    border: 1px solid var(--gs-rc);
    color: var(--gs-rc);
    background: rgba(var(--color-accent-rgb), 0.05);
  }
  .imp:hover,
  .imp:focus-visible {
    border-color: var(--color-accent);
    color: var(--color-accent-bright);
  }
  .imp:focus-visible {
    outline: 1px solid var(--color-accent);
    outline-offset: 1px;
  }

  /* --- The gear install flow (inside ActionModal; its dialog is an inline-size container) --- */
  .gm-who {
    margin: 0 0 8px;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }
  .gm-installed {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    padding: 8px 10px;
    margin-bottom: 6px;
    border: 1px solid rgba(var(--color-accent-rgb), 0.25);
    border-radius: var(--corner);
    background: rgba(var(--color-accent-rgb), 0.06);
  }
  .gm-tag {
    flex: none;
    font-size: var(--text-3xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--color-accent-bright);
  }
  .gm-text {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .gm-name {
    font-size: var(--text-sm);
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .gm-dim {
    color: var(--color-text-dim);
    font-weight: normal;
  }
  .gm-sub {
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
  }
  /* D20: the muted "Needs Medical Training" note on a Med Kit for an untrained member. */
  .gm-train,
  .gs-note {
    color: var(--color-text-dim);
    font-style: italic;
  }
  .gs-note {
    font-size: var(--text-2xs);
  }
  .gm-note {
    margin: 10px 0 0;
    font-size: var(--text-xs);
    color: var(--color-text-dim);
    line-height: 1.45;
  }
  .gm-flow {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 10px;
  }
  .gm-list,
  .gm-compare {
    min-width: 0;
  }
  @container (max-width: 439px) {
    .gm-flow:not(.has-candidate) .gm-compare {
      display: none;
    }
    .gm-flow.has-candidate .gm-list {
      display: none;
    }
  }
  @container (min-width: 440px) {
    .gm-flow {
      flex-direction: row;
      align-items: flex-start;
    }
    .gm-list {
      flex: 0 0 46%;
    }
    .gm-compare {
      flex: 1;
    }
    .gm-back {
      display: none;
    }
  }
  .gm-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 300px;
    overflow-y: auto;
  }
  .gm-spare {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    font: inherit;
    color: inherit;
    text-align: left;
    background: rgba(var(--color-accent-rgb), 0.04);
    border: 1px solid rgba(var(--color-accent-rgb), 0.18);
    border-radius: var(--corner);
    cursor: pointer;
  }
  .gm-spare:hover,
  .gm-spare:focus-visible {
    border-color: var(--color-accent);
  }
  .gm-spare:focus-visible {
    outline: 1px solid var(--color-accent);
    outline-offset: 1px;
  }
  .gm-spare.sel {
    border-color: var(--color-accent);
    box-shadow: 0 0 0 1px var(--color-accent);
    background: rgba(var(--color-accent-rgb), 0.12);
  }
  .gm-spare.blocked {
    opacity: 0.65;
  }
  .gm-ic {
    flex: none;
    display: inline-flex;
    font-size: var(--text-lg);
  }
  /* Task 11: the small "Unique" tag on a unique-equipped piece (Neural Backup: one worn in the whole fleet),
     the Logistics Locked tag's look (text in a thin accent border), sized to sit inline after a name. */
  .uniq-tag {
    display: inline-block;
    margin-left: 6px;
    padding: 0 5px;
    font-size: var(--text-3xs);
    font-weight: 400;
    letter-spacing: 0.04em;
    vertical-align: middle;
    border: 1px solid rgba(var(--color-accent-rgb), 0.3);
    border-radius: var(--corner);
    color: var(--color-text-secondary);
  }
  .gm-wearer {
    color: var(--color-warning);
  }
  .gm-blocked {
    flex: none;
    margin-left: auto;
    font-size: var(--text-3xs);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--color-warning);
  }
  .gm-compare-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }
  .gm-compare-title {
    font-size: var(--text-3xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--color-text-secondary);
  }
  .gm-compare-name {
    font-size: var(--text-sm);
    font-weight: 600;
    margin-bottom: 6px;
    overflow-wrap: anywhere;
  }
  .gm-rows {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 10px;
  }
  .gm-row {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    font-size: var(--text-xs);
  }
  .gm-k {
    color: var(--color-text-secondary);
  }
  .gm-v {
    font-family: var(--font-mono);
    color: var(--color-text-primary);
    white-space: nowrap;
  }
  .gm-v .up {
    color: var(--color-success);
  }
  .gm-v .down {
    color: var(--color-danger);
  }
  .gm-commit {
    width: 100%;
  }
  /* The worn-piece tooltip: fixed, portaled to <body>, opaque backing, never interactive. Wider than
     the ship board's 244px wrapper because member names run longer ("Standard-Issue Pulse Rifle") and
     the card's name line ellipsizes; the card itself is unchanged, only its host is wider. */
  .gm-tip {
    position: fixed;
    z-index: 900;
    width: 300px;
    max-width: calc(100vw - 16px);
    max-height: calc(100vh - 16px);
    overflow: hidden;
    pointer-events: none;
    background: var(--color-bg-deep);
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
  /* Danger tints derive from the token (color-mix, the App.svelte precedent) so the colorblind-safe
     palette re-hues them too. */
  .aw-btn.danger {
    background: color-mix(in srgb, var(--color-danger) 10%, transparent);
    border-color: color-mix(in srgb, var(--color-danger) 40%, transparent);
    color: var(--color-danger);
  }
  .aw-btn.danger:hover:not(:disabled) {
    background: color-mix(in srgb, var(--color-danger) 20%, transparent);
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
  .aw-btn.primary {
    background: rgba(var(--color-accent-rgb), 0.18);
    border-color: var(--color-accent);
    color: var(--color-text-primary);
  }
  .aw-btn:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }

  /* --- GROUND TEAMS (GO-11 + SQ-7 7.1; mockup GO-M1) ------------------------------------------------ */
  .gt {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
  }
  .gt-head {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .gt-title {
    margin: 0;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-display);
    font-weight: normal;
    font-size: var(--text-lg);
    letter-spacing: 0.03em;
    color: var(--color-text-primary);
  }
  .gt-intro {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    line-height: 1.45;
  }
  .gt-lock {
    margin: 0;
    display: flex;
    gap: 6px;
    align-items: center;
    font-size: var(--text-xs);
    color: var(--color-warning);
  }
  .gt-comp,
  .gt-team,
  .gt-reserve {
    min-width: 0;
    padding: 12px;
    background: rgba(var(--color-accent-rgb), 0.04);
    border: 1px solid var(--color-border);
    border-radius: var(--corner);
  }
  .gt-comp {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .gt-comp-top {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: 8px 14px;
  }
  .gt-comp-title {
    font-family: var(--font-display);
    font-size: var(--text-md);
    color: var(--color-text-primary);
  }
  .gt-comp-sum,
  .gt-room {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }
  .gt-pips {
    display: flex;
    gap: 10px;
  }
  .gt-pip-pair {
    display: flex;
    gap: 4px;
  }
  .gt-pip {
    width: 26px;
    height: 26px;
    display: grid;
    place-items: center;
    border-radius: var(--corner);
    border: 1px solid color-mix(in srgb, var(--pip-hue) 55%, transparent);
    background: color-mix(in srgb, var(--pip-hue) 18%, transparent);
    color: var(--pip-hue);
  }
  .gt-pip.security {
    --pip-hue: var(--color-danger);
  }
  .gt-pip.science {
    --pip-hue: var(--color-accent-bright);
  }
  .gt-rule {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: var(--text-xs);
    color: var(--color-danger);
  }
  .gt-rule.ok {
    color: var(--color-success);
  }
  .gt-over {
    margin: 0;
    display: flex;
    gap: 6px;
    align-items: flex-start;
    font-size: var(--text-xs);
    color: var(--color-warning);
    line-height: 1.45;
  }

  .gt-teams {
    display: grid;
    gap: 12px;
    grid-template-columns: minmax(0, 1fr);
  }
  @container (min-width: 700px) {
    .gt-teams {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  .gt-team {
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .gt-team-h {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 10px;
  }
  .gt-team-id {
    flex: 1 1 140px;
    min-width: 0;
  }
  .gt-team-name {
    margin: 0;
    font-family: var(--font-display);
    font-weight: normal;
    font-size: var(--text-md);
    color: var(--color-text-primary);
    overflow-wrap: anywhere;
  }
  .gt-kind-label,
  .gt-hint {
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
  }
  .gt-pending {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 8px;
    font-size: var(--text-2xs);
    font-weight: 600;
    color: var(--color-warning);
    border: 1px solid rgba(var(--color-warning-rgb), 0.55);
    border-radius: var(--corner);
    white-space: nowrap;
  }
  .gt-rename {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }
  .gt-input {
    flex: 1 1 140px;
    min-width: 0;
    padding: 5px 7px;
    font: inherit;
    font-size: var(--text-sm);
    color: var(--color-text-primary);
    background: var(--color-bg-mid);
    border: 1px solid rgba(var(--color-accent-rgb), 0.4);
    border-radius: var(--corner);
  }
  .gt-input:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 1px;
  }
  .gt-sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }

  /* Segmented Ground / Strike / Survey radio group. */
  .gt-kinds {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    border: 1px solid var(--color-border-strong);
    border-radius: var(--corner);
    overflow: hidden;
  }
  .gt-kind {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    min-width: 0;
    min-height: 36px;
    padding: 5px 4px;
    font: inherit;
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--color-text-secondary);
    background: var(--color-bg-mid);
    border: 0;
    border-right: 1px solid var(--color-border-strong);
    cursor: pointer;
  }
  .gt-kind:last-child {
    border-right: 0;
  }
  .gt-kind[aria-checked="true"] {
    background: rgba(var(--color-accent-rgb), 0.2);
    color: var(--color-text-primary);
    box-shadow: inset 0 -2px 0 var(--color-accent);
  }
  .gt-kind:hover:not(:disabled) {
    color: var(--color-text-primary);
  }
  /* Refused option: dim and struck through (not the accent-tinted disabled token, which reads as picked);
     the reason sits below the group as visible text. */
  .gt-kind:disabled {
    cursor: not-allowed;
    color: var(--color-text-dim);
    background: transparent;
    text-decoration: line-through;
  }
  /* Locked while the ship is out: the team's own kind still reads as the picked one. */
  .gt-kind[aria-checked="true"]:disabled {
    background: rgba(var(--color-accent-rgb), 0.12);
    color: var(--color-text-secondary);
    text-decoration: none;
  }
  .gt-kind:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: -2px;
  }
  .gt-why {
    font-size: var(--text-2xs);
    color: var(--color-warning);
    line-height: 1.45;
  }
  .gt-prompt,
  .gt-change {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 10px;
    font-size: var(--text-xs);
    color: var(--color-text-primary);
    border: 1px solid rgba(var(--color-warning-rgb), 0.5);
    background: rgba(var(--color-warning-rgb), 0.07);
    border-radius: var(--corner);
  }
  .gt-prompt {
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
  }
  .gt-change-line {
    margin: 0;
    line-height: 1.45;
  }
  .gt-over-line {
    color: var(--color-warning);
  }
  /* The over-capacity preview's two sentences: one line each on a narrow card (GO-11 review). */
  @container (max-width: 439px) {
    .gt-over-part {
      display: block;
    }
  }
  .gt-change-acts {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .gt-squad {
    --squad-hue: var(--color-accent-bright);
  }
  .gt-squad.security {
    --squad-hue: var(--color-danger);
  }
  .gt-squad-lbl {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 6px;
    font-size: var(--text-2xs);
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--squad-hue);
  }
  /* Two columns on a narrow card (GO-M1: 2 at a 375px phone), the squad's size from a wider one. */
  .gt-slots {
    display: grid;
    gap: 6px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  @container (min-width: 420px) {
    .gt-slots {
      grid-template-columns: repeat(var(--gt-cols, 3), minmax(0, 1fr));
    }
  }
  .gt-slot {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    min-height: 64px;
    padding: 6px 8px;
    font: inherit;
    font-size: var(--text-xs);
    text-align: left;
    color: var(--color-text-primary);
    background: var(--color-bg-mid);
    border: 1px solid rgba(var(--color-accent-rgb), 0.22);
    border-left: 2px solid var(--squad-hue);
    border-radius: var(--corner);
    overflow-wrap: anywhere;
  }
  .gt-slot.injured {
    border-style: dashed;
    border-left-style: solid;
    border-color: rgba(var(--color-warning-rgb), 0.55);
  }
  .gt-slot.empty {
    align-items: center;
    justify-content: center;
    text-align: center;
    color: var(--color-text-dim);
    border: 1px dashed rgba(var(--color-accent-rgb), 0.35);
    background: transparent;
    cursor: pointer;
  }
  .gt-slot.empty:hover:not(:disabled),
  .gt-slot.empty:focus-visible {
    color: var(--color-accent-bright);
    border-color: var(--color-accent);
  }
  .gt-slot.empty:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 1px;
  }
  .gt-slot.empty:disabled {
    cursor: not-allowed;
  }
  .gt-slot-name {
    font-weight: 600;
    font-size: var(--text-sm);
  }
  .gt-slot-sub {
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
  }
  .gt-slot.empty .gt-slot-sub {
    color: inherit;
  }
  .gt-slot-wait {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: var(--text-2xs);
    color: var(--color-warning);
  }
  .gt-slot-acts {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: auto;
    padding-top: 4px;
  }
  .gt-mini {
    flex: 1 1 auto;
    min-height: 26px;
    padding: 2px 6px;
    font: inherit;
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
    background: rgba(var(--color-accent-rgb), 0.08);
    border: 1px solid rgba(var(--color-accent-rgb), 0.3);
    border-radius: var(--corner);
    cursor: pointer;
  }
  .gt-mini:hover:not(:disabled) {
    color: var(--color-text-primary);
    border-color: var(--color-accent);
  }
  .gt-mini:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 1px;
  }
  .gt-mini:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .gt-status {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }
  .gt-status.ready {
    color: var(--color-success);
  }
  .gt-status-h {
    color: var(--color-warning);
  }
  .gt-status-w {
    color: var(--color-text-primary);
  }
  .gt-help {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }
  .gt-help-sub {
    color: var(--color-text-dim);
  }
  .gt-reserve {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .gt-res-h {
    margin: 0;
    font-family: var(--font-display);
    font-weight: normal;
    font-size: var(--text-md);
    color: var(--color-text-primary);
  }
  .gt-res-p {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    line-height: 1.45;
  }
  .gt-dim {
    color: var(--color-text-dim);
  }
  .gt-res-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .gt-res-m {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px 8px;
    font-size: var(--text-xs);
    color: var(--color-text-primary);
  }
  .gt-res-name {
    font-weight: 600;
  }
  .gt-res-sub {
    color: var(--color-text-secondary);
    font-size: var(--text-2xs);
  }
  .gt-pick-list {
    margin-top: 6px;
  }
  .gt-board-btn {
    margin-top: 8px;
  }
</style>
