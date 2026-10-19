<script lang="ts">
  // ============================================================================
  // ExpeditionPanel.svelte
  // Author: Claude (Opus 4.8) | Exploration 0.14.0 phase E2c (Expedition Console)
  //
  // The player-facing EXPEDITION CONSOLE, rendered as the headline "Expeditions"
  // section of the Exploration Ops tab (above Survey Missions / Supply & Transport
  // Runs). It realizes the approved "Expedition Console" mockup (2026-09-30): pick a
  // ship, read a sensor-gated FOREKNOWLEDGE preview of candidate frontier systems,
  // dispatch, then track the Transit -> Scanning -> Activities -> Return run.
  //
  // POSTURE (mirrors SeniorStaffPanel / ComplementPanel / ShipSystemsPanel exactly):
  //   - PURE PRESENTATION + INTERACTION. It READS live state through the already-tested
  //     expedition.ts engine (expeditionCandidates / the phase-progress readers) + the
  //     sensor + content catalogs. It NEVER reimplements game logic and NEVER mutates
  //     state: Launch + Claim bubble UP to the host (App.svelte) via callbacks, which
  //     run the pure engine fns + doSave + pushLog in one place. When the host reassigns
  //     `state`, every derived value below recomputes.
  //   - RESPONSIVE the ShipSystemsPanel / SeniorStaffPanel way: ONE shared DOM tree, split
  //     by CSS only. The outer wrap is a container-query context (container-type:
  //     inline-size); a NARROW container (<= 768px) stacks the dispatch layout in one
  //     column, a WIDE container (>= 769px) lays the candidate list + the setup rail side
  //     by side. There is NO isMobile JS branch and no separate mobile/desktop markup. It
  //     works at 375px.
  //
  // SCOPE (E2c): the dispatch console (ship picker, sensor-gated candidate targets, the
  // installed scanning-array readout, a DISPLAY-ONLY Science + Security ground-team strip,
  // the anomaly-chart opt-in, Launch) + the in-progress view (phase stepper, transit bar
  // with the charted-anomaly marker, per-body scan cards, the activity list, a findings
  // tally, Claim). The away-team GAMBIT combat that resolves activities is E3 (this panel
  // only shows the activities the placeholder resolver completes); relics are E4.
  // ============================================================================

  import type { GameState, Expedition, ExpeditionBody, ExpeditionActivity, ExpeditionFinding, CaptainState, GroundTeamKind } from "./game/model";
  import { SHIP_TYPES, ITEMS } from "./game/model";
  import {
    expeditionCandidates,
    expeditionScanFraction,
    expeditionActivitiesDone,
    expeditionActivitiesTotal,
    expeditionPhaseFraction,
    expeditionAnomalyMarkerFraction,
    expeditionAwayTeamCheck,
    expeditionDispatchBlockText,
    expeditionLaunchView,
    expeditionShipDamaged,
    expeditionShipRepairText,
    orphanExpeditions,
    type ExpeditionCandidate,
  } from "./game/expedition";
  import { activityFindingId, deriveAwayTeam, deriveExpeditionActivityLog, deriveScanEncounterLog, type GambitLogEvent } from "./game/gambit";
  import type { GroundOpsEdit } from "./game/groundOps";
  // GO-13 + Squads SQ-7 section 7.3: the per-planet task queue screen (queues, per-team odds, task cards, the stuck
  // flag and its Skip). Its display decisions are in groundTaskQueueDisplay.ts (tested).
  import GroundTaskQueue from "./GroundTaskQueue.svelte";
  // GO-14: the team timelines (each team's steps and the ship's legs), the task progress cards and the medical bay
  // cards of a flagged run; they replace the GO-7b activity readout. Display decisions in
  // groundOpsTimelineDisplay.ts (tested).
  import GroundTeamTimeline from "./GroundTeamTimeline.svelte";
  import GroundTaskCard from "./GroundTaskCard.svelte";
  import GroundBayCard from "./GroundBayCard.svelte";
  import { activitiesPhaseLabel, bayCardsView, taskCardsView } from "./groundOpsTimelineDisplay";
  // GO-15: each body's scan track (ship-event pips with outcome and pause, supply caches, a legacy run's ground battles)
  // and its log lines. Display decisions in scanTrackDisplay.ts (tested).
  import ScanTrack from "./ScanTrack.svelte";
  import { scanTrackKey, scanTrackView } from "./scanTrackDisplay";
  // GO-12 + Squads SQ-7 section 7.2: the dispatch strip (which ground teams deploy) and the Subspace Telescope block.
  // Every display decision is in expeditionDispatchDisplay.ts (tested); the expensive launch view (recommendation,
  // forecast) is read only for the EXPANDED candidate and only when its inputs change (launchViewInputs).
  import {
    BLIND_LAUNCH_DETAIL,
    BLIND_LAUNCH_TITLE,
    BLIND_LAUNCH_WARNING,
    RISK_METER_STEPS,
    candidateRegionText,
    createInputCache,
    dispatchTeamsView,
    expandedLaunchView,
    launchViewInputs,
    nearestFirst,
    runRegionText,
    sensorSplitHint,
    telescopeBlockView,
    type ExpandedLaunchView,
  } from "./expeditionDispatchDisplay";
  import { telescopeLevel } from "./game/telescope";
  import { tick } from "svelte";
  import ActionModal from "./ActionModal.svelte";
  import TeamBadge from "./ui/TeamBadge.svelte";
  import ThreatChip from "./ui/ThreatChip.svelte";
  import AffixPill from "./ui/AffixPill.svelte";
  import { installedSensorArray } from "./game/sensorArrays";
  import { effectiveShipStats } from "./game/crewOverlay";
  import { getPlanetTypeById, groundSiteLabel } from "./game/expeditionContent";
  import type { HazardTier } from "./game/expeditionContent";
  // E4c: relic glyphs + set names come from the ONE UI-side relic vocabulary (every graphic is SVG).
  import Icon from "./ui/Icon.svelte";
  import { relicSetShortLabel } from "./ui/relicIcons";

  // --- Props ------------------------------------------------------------------
  // `state` is the whole GameState (read-only here). The callbacks route every side effect
  // back to the host so persistence + logging happen exactly once, in App.svelte.
  export let state: GameState;
  // Launch: dispatch the chosen ship + its captain on the chosen candidate, with the anomaly
  // opt-in. Host: startExpedition -> doSave -> pushLog.
  export let onStart: (shipId: string, captainId: number, candidateId: string, anomalyOptIn: boolean) => void;
  // Claim: collect a COMPLETE expedition's findings. Host: claimExpedition -> doSave -> pushLog.
  export let onClaim: (expeditionId: string) => void;
  // Squads SQ-7 section 7.2: "Set composition" on the telescope's recommendation. Host: applyComposition -> doSave ->
  // pushLog (doApplyComposition).
  export let onSetComposition: (shipId: string, kinds: GroundTeamKind[]) => void = () => {};
  // GO-13: a live queue edit (assign, reorder, skip, re-queue, Default plan, Auto-assign). Host: editGroundOps ->
  // doSave -> pushLog (doEditGroundOps); returns null when applied, else the refusal in plain words.
  export let onEditGroundOps: (expeditionId: string, edit: GroundOpsEdit) => string | null = () => null;

  // --- Local UI state ---------------------------------------------------------
  // The ship whose console is open. null until the first eligible ship defaults in below.
  let chosenShipId: string | null = null;
  // The candidate target the player has selected in the dispatch view (before Launch).
  let selectedCandidateId: string | null = null;
  // The dispatch-time anomaly-chart opt-in (default ON: chart an anomaly if sensors flag one).
  let anomalyOptIn = true;
  // The blind launch confirm (user #7: "this is truly unknown territory. Are you sure you wish to go?") is open.
  let confirmBlind = false;

  // --- Static display metadata ------------------------------------------------
  const HAZARD_LABEL: Record<HazardTier, string> = {
    low: "Low",
    lowMedium: "Low-Med",
    medium: "Medium",
    high: "High",
    veryHigh: "Very High",
  };
  // The scanning array's one-line CHARACTER (from its kind), shown read-only in dispatch.
  const ARRAY_CHARACTER: Record<string, string> = {
    wide: "Wide-beam: wider coverage per pass, better surface-landmark odds.",
    focused: "Focused-beam: faster cadence, higher underground-PoI odds.",
    balanced: "Balanced: an even mix of coverage and cadence.",
  };
  const PHASE_STEPS: { key: Expedition["phase"]; label: string }[] = [
    { key: "transit", label: "Transit" },
    { key: "scanning", label: "Scanning" },
    { key: "activities", label: "Activities" },
    { key: "return", label: "Return" },
  ];
  const PHASE_ORDER: Expedition["phase"][] = ["transit", "scanning", "activities", "return", "complete"];

  // --- Derived reads ----------------------------------------------------------
  $: now = state.gameTimeSeconds;

  // shipId -> its active expedition (at most one per ship).
  // CP-6 review: GHOST runs whose ship is no longer in the fleet (salvaged before CP-6). The ship picker cannot
  // list them, so they get their own rows: Claim once complete (findings deposit, the away team unlocks).
  $: ghostExpeditions = orphanExpeditions(state);
  $: expeditionByShip = (() => {
    const map = new Map<string, Expedition>();
    for (const e of state.expeditions) map.set(e.shipId, e);
    return map;
  })();

  // The captain flying a ship (or null if parked), by the assignment authority.
  function captainOf(shipId: string): CaptainState | null {
    const ship = state.ships.find((s) => s.id === shipId);
    if (!ship || ship.assignedCaptainId === null) return null;
    return state.captains.find((c) => c.id === ship.assignedCaptainId) ?? null;
  }

  // A ship is LISTED for dispatch when it has an assigned, IDLE captain (no mission) and no active expedition.
  // Explorer hulls shine (higher base sensors -> more foreknowledge), but any assigned idle ship may go. GO-12 (the
  // GO-8 review rule, user 2026-10-14 "Must be repaired first"): a damaged ship, or one in a Shipyard repair bay, is
  // listed too, with Launch off and the repair line saying when it is ready (it used to vanish from the console,
  // which hid the reason).
  $: dispatchableShips = state.ships.filter((s) => {
    if (expeditionByShip.has(s.id)) return false;
    const cap = captainOf(s.id);
    return cap !== null && cap.mission === null;
  });
  // Ships currently ON an expedition (tracked in the console alongside dispatchable ones).
  $: expeditionShips = state.ships.filter((s) => expeditionByShip.has(s.id));
  // The console's ship picker list: active expeditions first (the headline), then dispatch-ready ships.
  $: consoleShips = [...expeditionShips, ...dispatchableShips];

  // Default / repair the chosen ship: keep the current pick if still eligible, else fall to the first.
  $: if (consoleShips.length > 0 && (chosenShipId === null || !consoleShips.some((s) => s.id === chosenShipId))) {
    chosenShipId = consoleShips[0].id;
  }
  $: if (consoleShips.length === 0 && chosenShipId !== null) {
    chosenShipId = null;
  }

  $: chosenShip = chosenShipId ? state.ships.find((s) => s.id === chosenShipId) ?? null : null;
  $: chosenExpedition = chosenShipId ? expeditionByShip.get(chosenShipId) ?? null : null;

  // DISPATCH-view derives (only meaningful when the chosen ship has no active expedition).
  // G2-2: nearest first (user G11, "Region, then 3 nearest"); the region picker is G2-6, so Tier I for now.
  $: candidates = chosenShip && !chosenExpedition ? nearestFirst(expeditionCandidates(state, chosenShip.id)) : [];
  // Default / repair the selected candidate when the list (or ship) changes.
  $: if (candidates.length > 0 && (selectedCandidateId === null || !candidates.some((c) => c.id === selectedCandidateId))) {
    selectedCandidateId = candidates[0].id;
  }
  $: selectedCandidate = candidates.find((c) => c.id === selectedCandidateId) ?? null;
  $: chosenArray = chosenShip ? installedSensorArray(state, chosenShip) : null;
  $: chosenSensors = chosenShip ? Math.round(effectiveShipStats(state, chosenShip).sensors) : 0;
  $: chosenCaptain = chosenShipId ? captainOf(chosenShipId) : null;
  // The away team the chosen ship would send: its crew layer (deriveAwayTeam) plus the ready named members
  // (chosenTeamCheck below), shown at dispatch so the player sees WHO they are sending before launch. D19:
  // each Security member fights with their own program, else the built-in default (no automatic kit use).
  $: chosenAwayTeam = chosenShip && !chosenExpedition ? deriveAwayTeam(state, chosenShip) : null;
  // D18 (user, 2026-10-06): the MINIMUM AWAY TEAM gate, the same pure check startExpedition enforces, so the
  // Launch button can never offer a dispatch the engine would refuse. Null outside the dispatch view.
  $: chosenTeamCheck = chosenShip && !chosenExpedition ? expeditionAwayTeamCheck(state, chosenShip) : null;
  $: needsAwayTeam = chosenTeamCheck !== null && !chosenTeamCheck.ok;
  // Ground Ops GO-8 review (user, 2026-10-14: "Must be repaired first", the patrol rule): a damaged ship, or one in a
  // Shipyard repair bay, cannot launch; the line says when it is ready. Null when it can launch.
  $: shipRepairLine = chosenShip && !chosenExpedition ? expeditionShipRepairText(state, chosenShip) : null;
  // Ground Ops (GO-7b, user 2026-10-12): no automatic stand-ins, so the block lists what each ground team waits on
  // ("Alpha: Grokk returns to duty in 12m"). Squads SQ-1: groundWaitTeams leaves out a team nobody is slotted
  // into (every hull fields 2 teams now; the empty pair would only add noise).
  // GO-12: the dispatch strip, one row per ground team: who WILL deploy (ready counts) and who will NOT (why, with
  // the time left), plus the ship-level reason when it cannot launch.
  $: teamsView = chosenTeamCheck ? dispatchTeamsView(chosenTeamCheck.ground, now) : null;

  // SQ-7 section 7.2: the telescope level (the blind range line) and the selected candidate's telescope block.
  $: scopeLevel = telescopeLevel(state);
  $: selectedBlock = selectedCandidate ? telescopeBlockView(selectedCandidate, scopeLevel) : null;
  // The LAZY launch view (recommendation + forecast): only for the expanded (selected) candidate, only from detail 4,
  // and only when an input that shapes it changes (expeditionDispatchDisplay.ts launchViewInputs), so a tick that just
  // moves time never re-reads it. The engine memoizes too; this keeps the panel from even asking.
  const launchCache = createInputCache<ExpandedLaunchView>();
  $: deploySig = chosenTeamCheck ? chosenTeamCheck.ground.teams.map((t) => t.deploys) : [];
  $: expanded =
    chosenShip && selectedCandidate && selectedBlock?.wantsLaunchView
      ? launchCache.get(launchViewInputs(state, chosenShip.id, selectedCandidate, deploySig), () =>
          expandedLaunchView(state, chosenShip!.id, selectedCandidate!, expeditionLaunchView),
        )
      : null;
  // How many times the panel has built the launch view (data-launch-view-computes on the telescope block): the dev
  // preview's check that opening a card computes it once, not on every tick.
  $: launchViewComputes = expanded === undefined ? 0 : launchCache.computes();

  // IN-PROGRESS-view derives.
  $: scanPct = chosenExpedition ? Math.round(expeditionScanFraction(chosenExpedition) * 100) : 0;
  $: activitiesDone = chosenExpedition ? expeditionActivitiesDone(chosenExpedition) : 0;
  $: activitiesTotal = chosenExpedition ? expeditionActivitiesTotal(chosenExpedition) : 0;
  $: legFraction = chosenExpedition ? expeditionPhaseFraction(chosenExpedition, now) : 0;
  $: anomalyMarker = chosenExpedition ? expeditionAnomalyMarkerFraction(chosenExpedition) : null;
  // GO-14 (a flagged run): the task progress cards and the medical bay cards, recomputed per tick (time left).
  $: taskCards = chosenExpedition?.groundOps ? taskCardsView(chosenExpedition, chosenShip, now) : null;
  $: bayCards = chosenExpedition?.groundOps ? bayCardsView(chosenExpedition, chosenShip, now, state.awayMembers) : [];
  // GO-15: the scan tracks' key row (only the kinds this run shows).
  $: scanKey = chosenExpedition ? scanTrackKey(chosenExpedition) : null;

  // --- Display helpers --------------------------------------------------------
  function shipName(shipId: string): string {
    const ship = state.ships.find((s) => s.id === shipId);
    if (!ship) return shipId;
    return ship.name ?? SHIP_TYPES[ship.typeKey]?.label ?? shipId;
  }
  function hullLabel(shipId: string): string {
    const ship = state.ships.find((s) => s.id === shipId);
    return ship ? SHIP_TYPES[ship.typeKey]?.label ?? "" : "";
  }
  function planetLabel(id: string): string {
    return getPlanetTypeById(id)?.label ?? id;
  }
  function hazardLabelFor(planetTypeId: string): string {
    const tier = getPlanetTypeById(planetTypeId)?.hazardTier;
    return tier ? HAZARD_LABEL[tier] : "";
  }
  function poiLabel(id: string): string {
    return groundSiteLabel(id) ?? id;
  }
  function isOrbital(planetTypeId: string): boolean {
    return getPlanetTypeById(planetTypeId)?.orbitalOnly === true;
  }
  // A per-body scan meter hue: low (dim) -> mid (accent) -> high (success).
  function scanColor(frac: number): string {
    if (frac >= 0.999) return "var(--color-success)";
    if (frac >= 0.5) return "var(--color-accent-bright)";
    return "var(--color-accent)";
  }
  // The label under a phase step: where this step sits relative to the expedition's current phase.
  function stepState(step: Expedition["phase"], current: Expedition["phase"]): "done" | "active" | "todo" {
    if (current === "complete") return "done";
    const si = PHASE_ORDER.indexOf(step);
    const ci = PHASE_ORDER.indexOf(current);
    if (si < ci) return "done";
    if (si === ci) return "active";
    return "todo";
  }
  // A whole percent for a fraction.
  function pct(frac: number): number {
    return Math.round(Math.max(0, Math.min(1, frac)) * 100);
  }
  // A coarse readable band for an away-team strength scalar (deriveAwayTeam returns unit-ish scalars).
  function strengthBand(v: number): string {
    if (v <= 0) return "Minimal";
    if (v < 8) return "Light";
    if (v < 20) return "Standard";
    if (v < 40) return "Strong";
    return "Elite";
  }
  function itemLabel(id: string): string {
    return ITEMS[id]?.label ?? id;
  }
  function rarityLabel(tier: string): string {
    return tier.charAt(0).toUpperCase() + tier.slice(1);
  }

  // --- Battle readout (E3b) ---------------------------------------------------
  // The activity's stored finding (materials/credits/relic/evacuated), matched by the resolver's stable
  // finding id. Present exactly when the activity is done (the resolver flips done + appends the finding
  // together), so `done` <=> a finding exists.
  // A legacy run only: a Ground Ops run's task cards sum their offloaded batches (groundOpsTimelineDisplay.ts).
  function findingFor(exp: Expedition, activity: ExpeditionActivity): ExpeditionFinding | null {
    const id = activityFindingId(exp, activity.id);
    return exp.findings.find((f) => f.id === id) ?? null;
  }
  // The activity's stable FLAT index across bodies (== the resolver's globalIndex), needed to re-derive its
  // deterministic battle log.
  function activityGlobalIndex(exp: Expedition, activityId: string): number {
    let seen = 0;
    for (const body of exp.bodies) {
      for (const act of body.activities) {
        if (act.id === activityId) return seen;
        seen++;
      }
    }
    return -1;
  }

  // Expanded battle logs: activity id -> its re-derived (TRANSIENT, never persisted) round-event list. The
  // log is a PURE deterministic re-derivation from the stored expedition seed (deriveExpeditionActivityLog),
  // computed LAZILY on expand and cached here; it lives entirely in local UI state and is never written to
  // the save, so it stays out of the parity deep-equal by construction.
  let expandedLogs: Record<string, GambitLogEvent[]> = {};
  // Activities whose re-derived outcome disagrees with the STORED finding (a battle fought by an earlier
  // version of the engine, e.g. the pre-D18 stand-in team): their log would tell the wrong story, so the
  // readout shows a neutral line instead.
  let staleLogs: Record<string, boolean> = {};
  function toggleLog(exp: Expedition, body: ExpeditionBody, activity: ExpeditionActivity): void {
    if (expandedLogs[activity.id]) {
      const next = { ...expandedLogs };
      delete next[activity.id];
      expandedLogs = next;
      return;
    }
    const gi = activityGlobalIndex(exp, activity.id);
    const derived = gi >= 0 ? deriveExpeditionActivityLog(exp, body, activity, gi) : null;
    const stored = findingFor(exp, activity);
    const stale = derived !== null && stored !== null && (derived.outcome === "evacuated") !== (stored.evacuated === true);
    staleLogs = { ...staleLogs, [activity.id]: stale };
    expandedLogs = { ...expandedLogs, [activity.id]: derived?.events ?? [] };
  }

  // --- Battle-log line formatting (display-only) ------------------------------
  const ROLE_NAME: Record<string, string> = {
    security: "Security",
    science: "Science",
    bruiser: "Bruiser",
    striker: "Striker",
    healer: "Healer",
    caster: "Caster",
    swarm: "Swarm",
  };
  const EVENT_VERB: Record<string, string> = {
    attack: "attacks",
    suppress: "suppresses",
    taunt: "taunts",
    execute: "executes",
    brace: "braces",
    cure: "cures",
    aidHeal: "heals",
    shieldAlly: "shields",
    analyze: "analyzes",
    secureObjective: "secures the objective",
    takeCover: "takes cover",
    useItem: "uses a kit on",
    fallBack: "falls back",
    hold: "holds",
    flashGrenade: "throws a flash grenade at",
  };
  function roleName(role: string): string {
    return ROLE_NAME[role] ?? role;
  }
  function eventLine(ev: GambitLogEvent): string {
    const who = `${ev.side === "enemy" ? "Enemy " : ""}${roleName(ev.role)}`;
    if (ev.action === "hold") return `${who} holds`;
    // E-CREW Task 16: the Neural Backup roll on the first ally downed (hpDelta = the HP they came back with).
    if (ev.action === "neuralBackup") {
      const ally = roleName(ev.targetRole ?? "security");
      return ev.missed ? `Neural Backup fails to revive ${ally}` : `Neural Backup revives ${ally}: +${ev.hpDelta ?? 0} HP`;
    }
    const verb = EVENT_VERB[ev.action] ?? ev.action;
    let line = `${who} ${verb}`;
    if (ev.targetRole) line += ` ${ev.targetSide === "enemy" ? "enemy " : ""}${roleName(ev.targetRole)}`;
    const tail: string[] = [];
    if (ev.missed) tail.push("miss");
    else if (ev.hpDelta && ev.hpDelta < 0) tail.push(`${ev.hpDelta} HP`);
    else if (ev.hpDelta && ev.hpDelta > 0) tail.push(`+${ev.hpDelta} HP`);
    if (ev.statusApplied) tail.push("affliction applied");
    if (ev.statusCleared) tail.push("cleansed");
    if (ev.downed) tail.push("DOWNED");
    return tail.length ? `${line}: ${tail.join(", ")}` : line;
  }

  // GO-15: a legacy run's ground battle at a scan step, as round log lines (re-derived on demand, never stored).
  function scanBattleLines(exp: Expedition, bodyIndex: number, step: number): { key: string; text: string; round: boolean; enemy: boolean; down: boolean }[] {
    const log = deriveScanEncounterLog(exp, bodyIndex, step);
    if (!log) return [];
    const lines: { key: string; text: string; round: boolean; enemy: boolean; down: boolean }[] = [];
    log.events.forEach((ev, i) => {
      if (i === 0 || log.events[i - 1].round !== ev.round) lines.push({ key: `r${i}`, text: `Round ${ev.round}`, round: true, enemy: false, down: false });
      lines.push({ key: `e${i}`, text: eventLine(ev), round: false, enemy: ev.side === "enemy", down: ev.downed === true });
    });
    return lines;
  }

  // --- Actions (all route to the host) ----------------------------------------
  // Launch: a BLIND candidate (beyond the telescope's range) asks first (user #7); any other launches at once.
  function launch(): void {
    if (!chosenShip || !selectedCandidate || !chosenCaptain) return;
    if (selectedCandidate.telescope.blind) {
      confirmBlind = true;
      return;
    }
    commitLaunch();
  }
  function commitLaunch(): void {
    confirmBlind = false;
    if (!chosenShip || !selectedCandidate || !chosenCaptain) return;
    onStart(chosenShip.id, chosenCaptain.id, selectedCandidate.id, anomalyOptIn);
    // The host reassigns state; the chosen ship now has an active expedition and this view swaps to
    // in-progress on the next reactive pass. Reset the dispatch-only local toggles for the next dispatch.
    selectedCandidateId = null;
    anomalyOptIn = true;
  }
  // The recommendation's headline, where focus lands after "Set composition" (the button itself goes away once the
  // ship fields the mix, which would otherwise drop focus to the page).
  let recHeadEl: HTMLElement | null = null;
  async function setComposition(kinds: GroundTeamKind[]): Promise<void> {
    if (!chosenShip) return;
    onSetComposition(chosenShip.id, kinds);
    await tick();
    recHeadEl?.focus();
  }
  // The blind confirm's default focus is Cancel (the safe answer). Deferred a microtask so it lands after the
  // ActionModal portal and its focusTrap (which focuses the first control only when focus is not already inside).
  function focusSafe(node: HTMLElement) {
    queueMicrotask(() => {
      if (node.isConnected) node.focus();
    });
  }
</script>

<div class="exp">
  {#each ghostExpeditions as g (g.id)}
    <div class="exp-ghost">
      <span class="exp-ghost-text">
        <strong>{g.systemName}</strong> · Ship no longer in the fleet ·
        {g.phase === "complete" ? "Findings ready" : "Still on its way home"}
      </span>
      {#if g.phase === "complete"}
        <button type="button" class="exp-btn primary" on:click={() => onClaim(g.id)}>Claim findings</button>
      {/if}
    </div>
  {/each}
  {#if consoleShips.length === 0}
    <!-- Additive-neutral early game: nothing to dispatch, nothing in flight. -->
    <div class="exp-empty">
      No ship is ready for an expedition. Assign a captain to an idle ship (Ships tab), then dispatch it
      here to explore the frontier.
    </div>
  {:else}
    <!-- SHIP PICKER: active expeditions + dispatch-ready ships. The console body below follows the pick. -->
    <div class="exp-ships" role="tablist" aria-label="Expedition ships">
      {#each consoleShips as s (s.id)}
        {@const exp = expeditionByShip.get(s.id) ?? null}
        <button
          type="button"
          class="exp-ship"
          class:active={chosenShipId === s.id}
          class:flying={exp !== null}
          role="tab"
          aria-selected={chosenShipId === s.id}
          on:click={() => (chosenShipId = s.id)}
        >
          <span class="exp-ship-name">{shipName(s.id)}</span>
          <span class="exp-ship-status">
            {#if exp}
              {exp.phase === "complete" ? "Findings ready" : `On expedition · ${exp.phase === "activities" ? activitiesPhaseLabel(exp).toLowerCase() : exp.phase}`}
            {:else if expeditionShipDamaged(state, s)}
              Repair first
            {:else}
              Ready to dispatch
            {/if}
          </span>
        </button>
      {/each}
    </div>

    {#if chosenShip && chosenExpedition}
      <!-- ========================= IN-PROGRESS ========================= -->
      {@const exp = chosenExpedition}
      <div class="exp-body">
        <div class="exp-hdr">
          <div class="exp-hdr-main">
            <span class="exp-hdr-system">{exp.systemName}</span>
            <span class="exp-hdr-sub">
              {shipName(exp.shipId)}{#if chosenCaptain} · {chosenCaptain.label}{/if}{#if exp.shakedown} · shakedown run{/if}
            </span>
            {#if runRegionText(exp)}<span class="exp-hdr-sub">{runRegionText(exp)}</span>{/if}
          </div>
          {#if exp.phase === "complete"}
            <button type="button" class="exp-btn primary" on:click={() => onClaim(exp.id)}>Claim findings</button>
          {/if}
        </div>

        <!-- PHASE STEPPER -->
        <div class="exp-stepper">
          {#each PHASE_STEPS as step, i (step.key)}
            {@const st = stepState(step.key, exp.phase)}
            <div class="exp-step" class:done={st === "done"} class:active={st === "active"}>
              <span class="exp-step-dot" aria-hidden="true">{st === "done" ? "✓" : i + 1}</span>
              <span class="exp-step-label">{step.key === "activities" ? activitiesPhaseLabel(exp) : step.label}</span>
            </div>
            {#if i < PHASE_STEPS.length - 1}
              <span class="exp-step-link" class:done={stepState(step.key, exp.phase) === "done"} aria-hidden="true"></span>
            {/if}
          {/each}
        </div>

        <!-- TRANSIT / RETURN leg bar (with the charted-anomaly marker on the outbound leg) -->
        {#if exp.phase === "transit" || exp.phase === "return"}
          <div class="exp-leg">
            <div class="exp-leg-top">
              <span>{exp.phase === "transit" ? "Outbound transit" : "Return transit"}</span>
              <span>{pct(legFraction)}%</span>
            </div>
            <div class="exp-bar">
              <div class="exp-bar-fill" style="width: {pct(legFraction)}%;"></div>
              {#if exp.phase === "transit" && anomalyMarker !== null}
                <div class="exp-bar-marker" style="left: {pct(anomalyMarker)}%;" title="Anomaly-chart check"></div>
              {/if}
            </div>
            {#if exp.phase === "transit" && anomalyMarker !== null}
              <div class="exp-leg-note">
                {#if exp.anomalyResolved}
                  {exp.anomalyCharted ? "Anomaly charted: a detour was added and logged a finding." : "Anomaly check passed: nothing charted."}
                {:else}
                  Anomaly-chart opt-in active: sensors will check for an anomaly at the marker.
                {/if}
              </div>
            {/if}
          </div>
        {/if}

        <!-- PER-BODY SCAN CARDS -->
        <div class="exp-section-tag">System scan · {scanPct}%</div>
        {#if scanKey && scanKey.entries.length > 0}
          <!-- GO-15: the scan tracks' key row (SVG glyphs, the words beside them). -->
          <div class="exp-scan-key" role="group" aria-label="Scan event key">
            {#each scanKey.entries as entry (entry.glyph)}
              <span class="exp-scan-key-one"><Icon name={entry.glyph} size={12} /> {entry.text}</span>
            {/each}
            {#if scanKey.costNote}<span class="exp-scan-key-note">{scanKey.costNote}</span>{/if}
          </div>
        {/if}
        <div class="exp-bodies">
          {#each exp.bodies as body, bi (body.id)}
            {@const frac = body.scanTotal > 0 ? body.scanProgress / body.scanTotal : 0}
            {@const track = scanTrackView(exp, bi)}
            <div class="exp-body-card">
              <div class="exp-body-top">
                <span class="exp-body-type">
                  {planetLabel(body.planetType)}
                  {#if isOrbital(body.planetType)}<span class="exp-body-flag">orbital ops</span>{/if}
                </span>
                <span class="exp-body-haz">{hazardLabelFor(body.planetType)} hazard</span>
              </div>
              {#if track}
                <ScanTrack {track} idBase="scan-{exp.id}-{bi}" battleLines={(step) => scanBattleLines(exp, bi, step)} />
              {:else}
                <div class="exp-bar slim">
                  <div class="exp-bar-fill" style="width: {pct(frac)}%; background: {scanColor(frac)};"></div>
                </div>
              {/if}
              <div class="exp-body-scanpct">{pct(frac)}% scanned</div>
              {#if body.discoveries.length > 0}
                <div class="exp-body-pois">
                  {#each body.discoveries as d (d.id)}
                    <span class="exp-poi" class:underground={d.kind === "underground"}>{poiLabel(d.poiId)}</span>
                  {/each}
                </div>
              {:else}
                <div class="exp-body-pois dim">{frac >= 0.999 ? "No discoveries" : "Awaiting scan"}</div>
              {/if}
            </div>
          {/each}
        </div>

        <!-- GO-13: the per-planet TASK QUEUES (a flagged run only): reassign, reorder, skip, re-queue, Default plan,
             Auto-assign, per-team odds, the stuck flag with its Skip. -->
        {#if exp.groundOps}
          <GroundTaskQueue {exp} ship={chosenShip} {now} onEdit={(edit) => onEditGroundOps(exp.id, edit)} />

          <!-- GO-14: each team's timeline and the ship's lane, the medical bay cards, the task progress cards. -->
          <GroundTeamTimeline {exp} ship={chosenShip} {now} />
          {#if bayCards.length > 0}
            <div class="exp-cards">
              {#each bayCards as card (card.teamIndex)}<GroundBayCard {card} />{/each}
            </div>
          {/if}
          {#if taskCards && taskCards.total > 0}
            <div class="exp-section-tag">Objective progress · {taskCards.done} of {taskCards.total} done</div>
            {#if taskCards.cards.length === 0}
              <div class="exp-note">No objective started yet: the queues above show what each team takes first.</div>
            {:else}
              <div class="exp-cards">
                {#each taskCards.cards as card (card.id)}<GroundTaskCard {card} />{/each}
              </div>
            {/if}
            <div class="exp-note">Battles auto-resolve: each Security member runs their own gambit program, or the built-in default. After every objective the team returns to the ship to offload, recover in the medical bay and reload; a lost objective keeps its progress and is retried after the bay.</div>
          {/if}
        {:else if activitiesTotal > 0}
          <!-- ACTIVITY BATTLE READOUT (a legacy run): each resolved away-team task shows its OUTCOME (secured vs
               evacuated) + the finding it yielded (materials / credits / an unidentified relic), with an
               expandable, re-derived round log so the player can see their gambits at work and tune them. -->
          <div class="exp-section-tag">Away-team activities · {activitiesDone}/{activitiesTotal}</div>
          <div class="exp-acts">
            {#each exp.bodies as body (body.id)}
              {#each body.activities as act (act.id)}
                {@const finding = findingFor(exp, act)}
                <div class="exp-act-card" class:done={act.done}>
                  <div class="exp-act-head">
                    <span class="exp-act-check" aria-hidden="true">{act.done ? "✓" : "○"}</span>
                    <span class="exp-act-label">{poiLabel(act.poiId)}</span>
                    <span class="exp-act-body">{planetLabel(body.planetType)}{#if isOrbital(body.planetType)} · satellite{/if}</span>
                    {#if act.done && finding}
                      {#if finding.evacuated}
                        <span class="exp-chip evac">Evacuated</span>
                      {:else}
                        <span class="exp-chip secured">Secured</span>
                      {/if}
                    {:else}
                      <span class="exp-chip range">Pending</span>
                    {/if}
                  </div>
                  {#if act.done && finding}
                    <div class="exp-act-finds">
                      {#each Object.entries(finding.materials ?? {}) as [itemId, qty]}
                        <span class="exp-find-chip">{itemLabel(itemId)} ×{qty}</span>
                      {/each}
                      {#if (finding.credits ?? 0) > 0}
                        <span class="exp-find-chip credits">{finding.credits} credits</span>
                      {/if}
                      {#if finding.relic}
                        <!-- E4c: the unidentified-relic glyph (SVG, ui/relicIcons.ts vocabulary), never an emoji. -->
                        <span class="exp-find-chip relic"><Icon name="relic" size={11} /> Unidentified relic · {rarityLabel(finding.relic.tier)}</span>
                      {/if}
                    </div>
                    <button type="button" class="exp-log-toggle" on:click={() => toggleLog(exp, body, act)}>
                      {expandedLogs[act.id] ? "Hide battle log" : "View battle log"}
                    </button>
                    {#if expandedLogs[act.id]}
                      <div class="exp-log">
                        {#if staleLogs[act.id]}
                          <div class="exp-log-line dim">Battle record from an earlier version.</div>
                        {:else if expandedLogs[act.id].length === 0 && finding.evacuated}
                          <!-- D18: an expedition launched before the minimum-team rule, with no Security member,
                               fields no team, so its tasks evacuate without a fight. -->
                          <div class="exp-log-line dim">No combat: no Security member was deployed, so the team withdrew with a partial haul.</div>
                        {:else if expandedLogs[act.id].length === 0}
                          <div class="exp-log-line dim">No combat: the team secured the site unopposed.</div>
                        {:else}
                          {#each expandedLogs[act.id] as ev, li (li)}
                            {#if li === 0 || expandedLogs[act.id][li - 1].round !== ev.round}
                              <div class="exp-log-round">Round {ev.round}</div>
                            {/if}
                            <div class="exp-log-line" class:enemy={ev.side === "enemy"} class:down={ev.downed}>
                              {eventLine(ev)}
                            </div>
                          {/each}
                        {/if}
                      </div>
                    {/if}
                  {/if}
                </div>
              {/each}
            {/each}
          </div>
          <div class="exp-note">Battles auto-resolve: each Security member runs their own gambit program, or the built-in default. Lost objectives evacuate with a reduced haul.</div>
        {/if}

        <!-- FINDINGS TALLY -->
        <div class="exp-findings">
          <span class="exp-findings-count">{exp.findings.length}</span>
          <span class="exp-findings-label">findings gathered</span>
          {#if exp.anomalyCharted}<span class="exp-chip anomaly">+ charted anomaly</span>{/if}
        </div>
      </div>
    {:else if chosenShip}
      <!-- ============================ DISPATCH ============================ -->
      <div class="exp-body">
        <div class="exp-hdr">
          <div class="exp-hdr-main">
            <span class="exp-hdr-system">Dispatch · {shipName(chosenShip.id)}</span>
            <span class="exp-hdr-sub">
              {hullLabel(chosenShip.id)}{#if chosenCaptain} · {chosenCaptain.label}{/if} · Sensors {chosenSensors}
            </span>
          </div>
          <button
            type="button"
            class="exp-btn primary"
            disabled={!selectedCandidate || !chosenCaptain || needsAwayTeam || shipRepairLine !== null}
            title={!chosenCaptain
              ? expeditionDispatchBlockText("captainNotAssigned")
              : shipRepairLine !== null
                ? `${expeditionDispatchBlockText("shipDamaged")}. ${shipRepairLine}`
              : !selectedCandidate
                ? expeditionDispatchBlockText("noSuchCandidate")
                : needsAwayTeam
                  ? teamsView?.blockText ?? expeditionDispatchBlockText("needsAwayTeam")
                  : selectedCandidate.telescope.blind
                    ? "Launch blind: asks you to confirm first"
                    : "Launch the expedition"}
            on:click={launch}
          >Launch</button>
        </div>
        {#if shipRepairLine !== null}
          <div class="exp-block" role="status">
            {expeditionDispatchBlockText("shipDamaged")}.
            <span class="exp-block-counts">{shipRepairLine}.</span>
          </div>
        {/if}
        {#if needsAwayTeam && teamsView?.blockText}
          <!-- D18 + GO-12: the ship-level reason Launch is off (not only in a hover title); each team's own wait, with
               the time left, is in the Ground teams strip below. -->
          <div class="exp-block" role="status">
            {teamsView.blockText}
            <span class="exp-block-counts">{teamsView.blockHint}</span>
          </div>
        {/if}

        <div class="exp-dispatch">
          <!-- TARGET CANDIDATES with sensor-gated FOREKNOWLEDGE -->
          <div class="exp-targets">
            <div class="exp-section-tag">Candidate targets</div>
            {#each candidates as cand (cand.id)}
              {@const fk = cand.foreknowledge}
              {@const tel = cand.telescope}
              <button
                type="button"
                class="exp-target"
                class:active={selectedCandidateId === cand.id}
                aria-pressed={selectedCandidateId === cand.id}
                on:click={() => (selectedCandidateId = cand.id)}
              >
                <div class="exp-target-top">
                  <span class="exp-target-name">{cand.systemName}</span>
                  {#if tel.blind}
                    <!-- SQ-7 7.2: a blind candidate shows only its name, region, distance and this chip. -->
                    <span class="exp-chip blind"><Icon name="blindLaunch" size={12} /> Blind launch</span>
                  {:else if !fk.inRange}
                    <span class="exp-chip scope"><Icon name="telescope" size={12} /> {tel.detailName}</span>
                    <span class="exp-chip range">Beyond sensor range</span>
                  {:else}
                    <span class="exp-chip scope"><Icon name="telescope" size={12} /> {tel.detailName}</span>
                    <span class="exp-chip">{fk.bodyCount} {fk.bodyCount === 1 ? "body" : "bodies"}</span>
                    <!-- E4c: name WHICH relic sets the system's would-be discoveries source (the engine's
                         relicSets projection, canonical set order) instead of a bare "Relic signature". Revealed
                         at the same sensor threshold; an empty list (no relic-bearing PoI) shows no chip. -->
                    {#if fk.relicSets && fk.relicSets.length > 0}
                      <span class="exp-chip relic"><Icon name="relic" size={11} /> Relics: {fk.relicSets.map(relicSetShortLabel).join(", ")}</span>
                    {/if}
                  {/if}
                </div>
                <div class="exp-target-region">{candidateRegionText(tel)}</div>
                {#if fk.inRange && fk.bodies}
                  <div class="exp-target-bodies">
                    {#each fk.bodies as b, i}
                      <span class="exp-target-body">
                        {#if b.planetType}
                          {planetLabel(b.planetType)}{#if b.hazard !== null} · {hazardLabelFor(b.planetType)} hazard{/if}
                        {:else}
                          Body {i + 1} · unresolved
                        {/if}
                      </span>
                    {/each}
                  </div>
                {:else if !fk.inRange && !tel.blind}
                  <div class="exp-target-hidden">Contents hidden. A stronger sensor array reveals more.</div>
                  {#if sensorSplitHint(tel, fk)}
                    <!-- GO-12 review minor: the telescope still reads this system's risk; only the contents are hidden. -->
                    <div class="exp-target-hint">{sensorSplitHint(tel, fk)}</div>
                  {/if}
                {/if}
              </button>
              {#if selectedCandidateId === cand.id && selectedBlock}
                {@const block = selectedBlock}
                <!-- SQ-7 section 7.2: the SUBSPACE TELESCOPE block, under the selected candidate's foreknowledge. -->
                <section class="exp-scope" class:blind={block.blind} aria-label="Subspace Telescope: {cand.systemName}" data-launch-view-computes={launchViewComputes}>
                  <div class="exp-scope-head">
                    <span class="exp-scope-title"><Icon name="telescope" size={16} /> Subspace Telescope</span>
                    {#if block.blind}
                      <span class="exp-chip blind"><Icon name="blindLaunch" size={12} /> {block.chipText}</span>
                    {:else}
                      <span class="exp-chip scope">{block.chipText}</span>
                    {/if}
                  </div>
                  {#if block.blind}
                    <div class="exp-scope-note">{block.rangeText}</div>
                  {:else}
                    {#if block.liftText}<div class="exp-scope-note">{block.liftText}</div>{/if}
                    {#if block.enemyTerritory}
                      <div class="exp-scope-flag"><Icon name="warning" size={14} /> Known enemy territory</div>
                    {/if}
                    <!-- The four risk factors: glyph, name + flavor, a 5-step meter, the grade. Every row shares one fixed
                         meter column and one fixed grade column, so the grades line up (user, mockup section 3). -->
                    <ul class="exp-risks">
                      {#each block.factors as f (f.id)}
                        <li class="exp-risk" aria-label={f.ariaLabel}>
                          <span class="exp-risk-glyph" aria-hidden="true"><Icon name={f.glyph} size={16} /></span>
                          <span class="exp-risk-text" aria-hidden="true">
                            <span class="exp-risk-label">{f.label}</span>
                            {#if f.flavor}<span class="exp-risk-flavor">{f.flavor}</span>{/if}
                          </span>
                          <span class="exp-meter" aria-hidden="true" style={f.color ? `--risk-color: ${f.color};` : undefined}>
                            {#if f.grade !== null}
                              {#each Array(RISK_METER_STEPS) as _, i (i)}<i class:on={i < f.lit}></i>{/each}
                            {/if}
                          </span>
                          <span class="exp-risk-grade" class:dim={f.grade === null && !f.present} aria-hidden="true">{f.gradeName}</span>
                        </li>
                      {/each}
                    </ul>
                    {#if block.bodies}
                      <div class="exp-scope-sub">Per body</div>
                      {#if block.demandText}<div class="exp-scope-demand">{block.demandText}</div>{/if}
                      <div class="exp-scope-bodies">
                        {#each block.bodies as b, bi (bi)}
                          <div class="exp-scope-body">
                            <span class="exp-scope-body-name">{b.label}</span>
                            {#each b.grades as g (g.id)}
                              <span class="exp-scope-gr"><span>{g.label}</span><span>{g.gradeName}</span></span>
                            {/each}
                          </div>
                        {/each}
                      </div>
                    {/if}
                    {#if expanded?.recommendation}
                      {@const r = expanded.recommendation}
                      {@const act = r.action}
                      <div class="exp-rec">
                        <div class="exp-rec-kicker">Recommendation</div>
                        <div class="exp-rec-head" tabindex="-1" bind:this={recHeadEl}><Icon name="groundTeam" size={20} /> <span>{r.headline}</span></div>
                        <div class="exp-rec-reason">{r.reason}</div>
                        {#if r.unfinishedText}<div class="exp-rec-warn">{r.unfinishedText}</div>{/if}
                        {#if r.stillUnfinishedText}<div class="exp-rec-warn">{r.stillUnfinishedText}</div>{/if}
                        {#if r.riskyFightsText}<div class="exp-rec-warn">{r.riskyFightsText}</div>{/if}
                        <div class="exp-rec-row"><span class="exp-chip">{r.currentText}</span></div>
                        {#if act}
                          <div class="exp-rec-moves" id="exp-rec-moves-{cand.id}">
                            {#each act.moves as m, mi (mi)}<span>{m}</span>{/each}
                            {#if act.overCapacity}<span class="warn">{act.overCapacity}</span>{/if}
                          </div>
                          <button
                            type="button"
                            class="exp-btn primary exp-rec-btn"
                            aria-describedby="exp-rec-moves-{cand.id}"
                            on:click={() => setComposition(act.kinds)}
                          >{act.label}</button>
                        {:else if r.actionBlocked}
                          <div class="exp-rec-warn">{r.actionBlocked}</div>
                        {/if}
                      </div>
                    {/if}
                    {#if expanded?.forecast}
                      {@const fc = expanded.forecast}
                      <div class="exp-forecast">
                        <div><span class="exp-forecast-lead">{fc.lead}:</span> {fc.tasksText}.{#if fc.unfinishedText} {fc.unfinishedText}{/if}</div>
                        {#if fc.hardestText}
                          <div class="exp-forecast-hard">
                            <span>{fc.hardestText}</span>
                            {#if fc.threat}<ThreatChip assessment={fc.threat} full context="Forecast odds" />{/if}
                            {#each fc.affixPills as pill (pill.key)}<AffixPill {pill} />{/each}
                          </div>
                        {/if}
                        {#if fc.note}<div class="exp-forecast-note">{fc.note}.</div>{/if}
                      </div>
                    {/if}
                    {#if block.nextNote}<div class="exp-scope-note">{block.nextNote}</div>{/if}
                  {/if}
                </section>
              {/if}
            {/each}
          </div>

          <!-- SETUP RAIL: scanning array, ground teams, anomaly opt-in -->
          <div class="exp-setup">
            <div class="exp-section-tag">Scanning array</div>
            <div class="exp-setup-block">
              {#if chosenArray}
                <div class="exp-array-name">{chosenArray.def.label}</div>
                <div class="exp-array-char">{ARRAY_CHARACTER[chosenArray.def.kind] ?? ""}</div>
              {:else}
                <div class="exp-array-name dim">No sensor array installed</div>
                <div class="exp-array-char">Scanning runs at the base rate. Install a sensor array (Ships tab) to scan faster and see farther.</div>
              {/if}
            </div>

            <!-- GO-12: the ground teams this launch sends. Each that WILL deploy (badge, name, kind, ready counts) and each
                 that will NOT, with why and the time left. Nobody stands in: the player swaps members by hand. -->
            {#if teamsView}
              <div class="exp-section-tag">Ground teams · {teamsView.summary}</div>
              <ul class="exp-gteams">
                {#each teamsView.rows as row (row.index)}
                  <li class="exp-gteam {row.status}">
                    <TeamBadge index={row.index} kind={row.kind} name={row.name} />
                    <div class="exp-gteam-main">
                      <div class="exp-gteam-top">
                        <span class="exp-gteam-name">{row.name}</span>
                        <span class="exp-gteam-kind">{row.kindLabel}</span>
                      </div>
                      <div class="exp-gteam-status">
                        <Icon name={row.status === "deploys" ? "check" : row.status === "waits" ? "clock" : "team"} size={13} />
                        {row.statusText}
                      </div>
                      {#if row.countsText}<div class="exp-gteam-counts">{row.countsText}</div>{/if}
                      {#each row.waits as w, wi (wi)}<div class="exp-gteam-wait">{w}</div>{/each}
                    </div>
                  </li>
                {/each}
              </ul>
            {/if}

            <div class="exp-section-tag">Away team strength</div>
            <div class="exp-teams">
              <div class="exp-team">
                <span class="exp-team-name">Security<span class="exp-team-str">{chosenAwayTeam ? strengthBand(chosenAwayTeam.securityStrength) : "-"}</span></span>
                <span class="exp-team-role">Fights during objectives. Each member runs their own gambit program, or the built-in default (no automatic kit use).</span>
              </div>
              <div class="exp-team">
                <span class="exp-team-name">Science<span class="exp-team-str">{chosenAwayTeam ? strengthBand(chosenAwayTeam.scienceStrength) : "-"}</span></span>
                <span class="exp-team-role">Does the objective fieldwork and never fights.</span>
              </div>
              <div class="exp-team">
                <span class="exp-team-name">Team kit<span class="exp-team-str">{chosenAwayTeam ? chosenAwayTeam.teamKit : "-"}</span></span>
                <span class="exp-team-role">Per-battle cure/stim consumables carried by the away team.</span>
              </div>
            </div>
            <div class="exp-note">Hire, slot and swap Security and Science members on the ship's Away Team tab; the ship's crew (Security / Science / support) adds strength and team kit. The teams and their programs are snapshotted at launch.</div>

            <div class="exp-section-tag">Anomaly chart</div>
            <label class="exp-toggle">
              <input type="checkbox" bind:checked={anomalyOptIn} />
              <span class="exp-toggle-text">
                Chart an anomaly if sensors detect one en route
                <span class="exp-toggle-note">Adds transit time but yields an extra finding.</span>
              </span>
            </label>
          </div>
        </div>
      </div>
    {/if}
  {/if}
</div>

{#if confirmBlind && selectedCandidate}
  <!-- SQ-7 + user #7: a BLIND launch asks first. Cancel is the default focus (the safe answer). -->
  <ActionModal title={BLIND_LAUNCH_TITLE} ariaLabel="{BLIND_LAUNCH_TITLE}: {selectedCandidate.systemName}" onClose={() => (confirmBlind = false)}>
    <div class="exp-blind-confirm">
      <p class="exp-blind-warn"><Icon name="blindLaunch" size={18} /> <strong>{BLIND_LAUNCH_WARNING}</strong></p>
      <p>{selectedCandidate.systemName} · {candidateRegionText(selectedCandidate.telescope)} from your homeworld.</p>
      <p class="exp-blind-detail">{BLIND_LAUNCH_DETAIL}</p>
    </div>
    <svelte:fragment slot="footer">
      <button type="button" class="exp-btn" use:focusSafe on:click={() => (confirmBlind = false)}>Cancel</button>
      <button type="button" class="exp-btn primary" on:click={commitLaunch}>Launch blind</button>
    </svelte:fragment>
  </ActionModal>
{/if}

<style>
  /* CONTAINER-QUERY layout (mirrors SeniorStaffPanel / ShipSystemsPanel). The wrap is the container the
     queries key off, so the console responds to its OWN width, not the viewport. */
  .exp {
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  /* CP-6 review: a ghost run (its ship is gone) waiting to be claimed. */
  .exp-ghost {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 12px;
    margin-bottom: 10px;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    border: 1px solid rgba(var(--color-accent-rgb), 0.3);
    border-radius: var(--corner);
  }
  .exp-ghost-text {
    min-width: 0;
  }
  .exp-empty {
    font-size: var(--text-sm);
    color: var(--color-text-dim);
    padding: 12px;
    border: 1px dashed rgba(var(--color-accent-rgb), 0.24);
    border-radius: var(--corner);
    line-height: 1.5;
  }

  /* SHIP PICKER: a wrapping row of ship chips. */
  .exp-ships {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .exp-ship {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: 7px 11px;
    text-align: left;
    background: rgba(var(--color-accent-rgb), 0.05);
    border: 1px solid rgba(var(--color-accent-rgb), 0.16);
    border-radius: var(--corner);
    color: var(--color-text-secondary);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .exp-ship:hover {
    border-color: rgba(var(--color-accent-rgb), 0.4);
  }
  .exp-ship.flying {
    background: rgba(var(--color-accent-rgb), 0.09);
  }
  .exp-ship.active {
    border-color: var(--color-accent);
    background: rgba(var(--color-accent-rgb), 0.14);
  }
  .exp-ship-name {
    font-size: var(--text-sm);
    color: var(--color-text-primary);
  }
  .exp-ship-status {
    font-size: var(--text-2xs);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--color-text-dim);
  }

  /* BODY (shared by dispatch + in-progress). */
  .exp-body {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px;
    background: rgba(var(--color-accent-rgb), 0.04);
    border: 1px solid rgba(var(--color-accent-rgb), 0.14);
    border-radius: var(--corner);
  }
  .exp-hdr {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
  }
  .exp-hdr-main {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .exp-hdr-system {
    font-family: var(--font-display);
    font-size: var(--text-lg);
    color: var(--color-text-primary);
  }
  .exp-hdr-sub {
    font-size: var(--text-2xs);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--color-text-dim);
  }

  .exp-section-tag {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-accent-bright);
  }

  /* BUTTONS */
  .exp-btn {
    padding: 7px 14px;
    border-radius: var(--corner);
    border: 1px solid rgba(var(--color-accent-rgb), 0.4);
    background: rgba(var(--color-accent-rgb), 0.1);
    color: var(--color-text-primary);
    font-size: var(--text-sm);
    cursor: pointer;
    white-space: nowrap;
    -webkit-tap-highlight-color: transparent;
  }
  .exp-btn.primary {
    background: var(--color-accent);
    border-color: var(--color-accent);
    color: var(--color-bg-deep);
  }
  .exp-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* STEPPER */
  .exp-stepper {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .exp-step {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--color-text-dim);
  }
  .exp-step-dot {
    width: calc(20px * var(--ui-scale));
    height: calc(20px * var(--ui-scale));
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: var(--text-2xs);
    border: 1px solid rgba(var(--color-accent-rgb), 0.3);
    background: rgba(var(--color-accent-rgb), 0.06);
    flex: 0 0 auto;
  }
  .exp-step-label {
    font-size: var(--text-xs);
  }
  .exp-step.active {
    color: var(--color-text-primary);
  }
  .exp-step.active .exp-step-dot {
    border-color: var(--color-accent);
    background: var(--color-accent);
    color: var(--color-bg-deep);
  }
  .exp-step.done {
    color: var(--color-success);
  }
  .exp-step.done .exp-step-dot {
    border-color: var(--color-success);
    color: var(--color-success);
  }
  .exp-step-link {
    flex: 1 1 6px;
    height: 2px;
    min-width: 6px;
    background: rgba(var(--color-accent-rgb), 0.2);
    border-radius: 2px;
  }
  .exp-step-link.done {
    background: var(--color-success);
  }

  /* PROGRESS BARS (leg + per-body scan) */
  .exp-leg {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .exp-leg-top {
    display: flex;
    justify-content: space-between;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }
  .exp-bar {
    position: relative;
    height: calc(10px * var(--ui-scale));
    background: rgba(var(--color-accent-rgb), 0.1);
    border-radius: 999px;
    overflow: hidden;
  }
  .exp-bar.slim {
    height: calc(7px * var(--ui-scale));
  }
  .exp-bar-fill {
    height: 100%;
    background: var(--color-accent);
    border-radius: 999px;
    transition: width 0.3s ease;
  }
  .exp-bar-marker {
    position: absolute;
    top: -2px;
    bottom: -2px;
    width: 2px;
    background: var(--color-warning);
    /* overflow:hidden on the bar clips the marker to the track height, which is fine (it still reads). */
  }
  .exp-leg-note {
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
    line-height: 1.4;
  }

  /* PER-BODY SCAN CARDS */
  /* GO-15: the scan tracks' key row. */
  .exp-scan-key {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
  }
  .exp-scan-key-one {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .exp-scan-key-note {
    flex-basis: 100%;
  }
  .exp-bodies {
    display: grid;
    grid-template-columns: 1fr;
    gap: 8px;
  }
  .exp-body-card {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 9px 10px;
    background: rgba(var(--color-accent-rgb), 0.05);
    border: 1px solid rgba(var(--color-accent-rgb), 0.14);
    border-radius: var(--corner);
  }
  .exp-body-top {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
  }
  .exp-body-type {
    font-size: var(--text-sm);
    color: var(--color-text-primary);
  }
  .exp-body-flag {
    font-size: calc(9px * var(--ui-scale));
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-accent-bright);
    margin-left: 6px;
  }
  .exp-body-haz {
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
  }
  .exp-body-scanpct {
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
  }
  .exp-body-pois {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .exp-body-pois.dim {
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
    font-style: italic;
  }
  .exp-poi {
    font-size: var(--text-2xs);
    padding: 1px 7px;
    border-radius: 999px;
    background: rgba(var(--color-accent-rgb), 0.14);
    color: var(--color-accent-bright);
  }
  .exp-poi.underground {
    background: rgba(var(--color-warning-rgb, 200, 150, 60), 0.16);
    color: var(--color-warning);
  }

  /* ACTIVITY LIST */
  /* GO-14: the bay cards and the task progress cards, one column on a phone, two or three wide. */
  .exp-cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
    gap: 10px;
  }
  .exp-acts {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .exp-act-check {
    color: var(--color-text-dim);
    flex: 0 0 auto;
  }
  .exp-act-card.done .exp-act-check {
    color: var(--color-success);
  }
  .exp-act-label {
    flex: 1 1 auto;
    min-width: 0;
  }
  .exp-act-body {
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
    white-space: nowrap;
  }
  .exp-note {
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
    font-style: italic;
  }
  /* D18: the dispatch refusal line (Launch is disabled until the minimum away team is aboard). */
  .exp-block {
    font-size: var(--text-xs);
    line-height: 1.4;
    padding: 8px 10px;
    border-radius: 6px;
    border: 1px solid rgba(var(--color-warning-rgb, 200, 150, 60), 0.45);
    background: rgba(var(--color-warning-rgb, 200, 150, 60), 0.12);
    color: var(--color-warning);
  }
  .exp-block-counts {
    display: block;
    margin-top: 2px;
    color: var(--color-text-secondary);
  }

  /* AWAY-TEAM STRENGTH badge (dispatch) */
  .exp-team-str {
    float: right;
    font-size: var(--text-2xs);
    padding: 0 8px;
    border-radius: 999px;
    background: rgba(var(--color-accent-rgb), 0.16);
    color: var(--color-accent-bright);
  }

  /* ACTIVITY BATTLE READOUT cards (in-progress) */
  .exp-act-card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 10px;
    border-radius: var(--corner);
    background: rgba(var(--color-accent-rgb), 0.04);
    border: 1px solid rgba(var(--color-accent-rgb), 0.12);
  }
  .exp-act-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }
  .exp-act-card.done .exp-act-head {
    color: var(--color-text-primary);
  }
  .exp-act-finds {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .exp-find-chip {
    font-size: var(--text-2xs);
    padding: 1px 8px;
    border-radius: 999px;
    background: rgba(var(--color-accent-rgb), 0.1);
    color: var(--color-text-secondary);
  }
  .exp-find-chip.credits {
    color: var(--color-accent-bright);
  }
  .exp-find-chip.relic {
    background: var(--color-accent);
    color: var(--color-bg-deep);
  }
  .exp-chip.secured {
    background: rgba(var(--color-success-rgb, 90, 190, 120), 0.18);
    color: var(--color-success);
    margin-left: auto;
  }
  .exp-chip.evac {
    background: rgba(var(--color-warning-rgb, 200, 150, 60), 0.18);
    color: var(--color-warning);
    margin-left: auto;
  }
  .exp-log-toggle {
    align-self: flex-start;
    padding: 3px 10px;
    font-size: var(--text-2xs);
    color: var(--color-accent-bright);
    background: rgba(var(--color-accent-rgb), 0.08);
    border: 1px solid rgba(var(--color-accent-rgb), 0.2);
    border-radius: 999px;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .exp-log-toggle:hover {
    border-color: rgba(var(--color-accent-rgb), 0.45);
  }
  .exp-log {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 240px;
    overflow-y: auto;
    padding: 8px;
    border-radius: var(--corner);
    background: rgba(0, 0, 0, 0.18);
    border: 1px solid rgba(var(--color-accent-rgb), 0.12);
  }
  .exp-log-round {
    font-family: var(--font-mono);
    font-size: calc(9px * var(--ui-scale));
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--color-accent-bright);
    margin-top: 4px;
  }
  .exp-log-round:first-child {
    margin-top: 0;
  }
  .exp-log-line {
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
    line-height: 1.4;
  }
  .exp-log-line.enemy {
    color: var(--color-text-dim);
  }
  .exp-log-line.down {
    color: var(--color-warning);
  }
  .exp-log-line.dim {
    color: var(--color-text-dim);
    font-style: italic;
  }

  /* FINDINGS TALLY */
  .exp-findings {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding-top: 4px;
    border-top: 1px solid rgba(var(--color-accent-rgb), 0.12);
  }
  .exp-findings-count {
    font-family: var(--font-display);
    font-size: var(--text-xl);
    color: var(--color-accent-bright);
  }
  .exp-findings-label {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  /* DISPATCH LAYOUT: stacked on a narrow container, two columns on a wide one. */
  .exp-dispatch {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .exp-targets,
  .exp-setup {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }
  @container (min-width: 769px) {
    .exp-dispatch {
      flex-direction: row;
      align-items: flex-start;
    }
    .exp-targets {
      flex: 1 1 58%;
    }
    .exp-setup {
      flex: 1 1 42%;
    }
  }

  .exp-target {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 9px 11px;
    text-align: left;
    background: rgba(var(--color-accent-rgb), 0.05);
    border: 1px solid rgba(var(--color-accent-rgb), 0.16);
    border-radius: var(--corner);
    color: var(--color-text-secondary);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .exp-target:hover {
    border-color: rgba(var(--color-accent-rgb), 0.4);
  }
  .exp-target.active {
    border-color: var(--color-accent);
    background: rgba(var(--color-accent-rgb), 0.12);
  }
  .exp-target-top {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .exp-target-name {
    font-size: var(--text-md);
    color: var(--color-text-primary);
    margin-right: auto;
  }
  .exp-target-bodies {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }
  .exp-target-body {
    font-size: var(--text-2xs);
    padding: 1px 7px;
    border-radius: 999px;
    background: rgba(var(--color-accent-rgb), 0.1);
    color: var(--color-text-secondary);
  }
  .exp-target-hidden {
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
    font-style: italic;
  }
  .exp-target-hint {
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
  }

  /* CHIPS */
  .exp-chip {
    font-size: var(--text-2xs);
    padding: 1px 8px;
    border-radius: 999px;
    background: rgba(var(--color-accent-rgb), 0.16);
    color: var(--color-accent-bright);
    white-space: nowrap;
  }
  .exp-chip.range {
    background: rgba(var(--color-accent-rgb), 0.08);
    color: var(--color-text-dim);
  }
  .exp-chip.relic {
    background: var(--color-accent);
    color: var(--color-bg-deep);
    /* E4c: the named-sets chip can run long (up to four set names), so it may wrap on a phone. */
    white-space: normal;
  }
  .exp-chip.anomaly {
    background: rgba(var(--color-warning-rgb, 200, 150, 60), 0.18);
    color: var(--color-warning);
  }

  /* SETUP RAIL blocks */
  .exp-setup-block {
    padding: 9px 11px;
    background: rgba(var(--color-accent-rgb), 0.05);
    border: 1px solid rgba(var(--color-accent-rgb), 0.14);
    border-radius: var(--corner);
  }
  .exp-array-name {
    font-size: var(--text-sm);
    color: var(--color-text-primary);
  }
  .exp-array-name.dim {
    color: var(--color-text-dim);
  }
  .exp-array-char {
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
    line-height: 1.4;
    margin-top: 3px;
  }
  .exp-teams {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .exp-team {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 7px 10px;
    background: rgba(var(--color-accent-rgb), 0.05);
    border: 1px solid rgba(var(--color-accent-rgb), 0.14);
    border-radius: var(--corner);
  }
  .exp-team-name {
    font-size: var(--text-sm);
    color: var(--color-text-primary);
  }
  .exp-team-role {
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
    line-height: 1.4;
  }
  .exp-toggle {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 9px 11px;
    background: rgba(var(--color-accent-rgb), 0.05);
    border: 1px solid rgba(var(--color-accent-rgb), 0.14);
    border-radius: var(--corner);
    cursor: pointer;
  }
  .exp-toggle input {
    margin-top: 2px;
    flex: 0 0 auto;
    accent-color: var(--color-accent);
  }
  .exp-toggle-text {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .exp-toggle-note {
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
  }
  /* GO-12: the GROUND TEAMS strip (dispatch): one row per team, a badge, then its status and waits. */
  .exp-gteams {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .exp-gteam {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 8px 10px;
    background: rgba(var(--color-accent-rgb), 0.05);
    border: 1px solid rgba(var(--color-accent-rgb), 0.14);
    border-radius: var(--corner);
  }
  .exp-gteam.deploys {
    border-color: rgba(var(--color-accent-rgb), 0.4);
  }
  .exp-gteam.waits {
    border-color: rgba(var(--color-warning-rgb), 0.45);
  }
  .exp-gteam-main {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .exp-gteam-top {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 6px;
  }
  .exp-gteam-name {
    font-size: var(--text-sm);
    color: var(--color-text-primary);
  }
  .exp-gteam-kind {
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
  }
  .exp-gteam-status {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }
  .exp-gteam.deploys .exp-gteam-status {
    color: var(--color-success);
  }
  .exp-gteam.waits .exp-gteam-status {
    color: var(--color-warning);
  }
  .exp-gteam-counts {
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
  }
  .exp-gteam-wait {
    font-size: var(--text-2xs);
    color: var(--color-warning);
    line-height: 1.4;
  }

  /* SQ-7 7.2: the candidate's region line and the telescope chips. */
  .exp-target-region {
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
  }
  .exp-chip.scope,
  .exp-chip.blind {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .exp-chip.blind {
    background: rgba(var(--color-warning-rgb), 0.16);
    color: var(--color-warning);
  }

  /* SQ-7 7.2: the SUBSPACE TELESCOPE block under the selected candidate. */
  .exp-scope {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: -4px;
    padding: 10px 11px;
    background: rgba(var(--color-accent-rgb), 0.04);
    border: 1px solid var(--color-accent);
    border-top-style: dashed;
    border-radius: var(--corner);
    min-width: 0;
  }
  .exp-scope.blind {
    border-color: rgba(var(--color-warning-rgb), 0.55);
  }
  .exp-scope-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }
  .exp-scope-title {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-display);
    font-size: var(--text-sm);
    color: var(--color-text-primary);
  }
  .exp-scope-note {
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
    line-height: 1.45;
  }
  .exp-scope-flag {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: var(--text-xs);
    color: var(--color-danger);
  }
  /* The factor rows: glyph | name + flavor | meter | grade. The meter and grade columns are FIXED widths on every
     row, so the grade labels align in one column (user, mockup section 3). */
  .exp-risks {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .exp-risk {
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr) calc(76px * var(--ui-scale)) 9ch;
    align-items: center;
    gap: 8px;
    padding: 6px 0;
    border-bottom: 1px solid rgba(var(--color-accent-rgb), 0.1);
  }
  .exp-risk:last-child {
    border-bottom: 0;
  }
  .exp-risk-glyph {
    display: inline-flex;
    color: var(--color-text-secondary);
  }
  .exp-risk-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .exp-risk-label {
    font-size: var(--text-xs);
    color: var(--color-text-primary);
  }
  .exp-risk-flavor {
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
    overflow-wrap: anywhere;
  }
  .exp-meter {
    display: flex;
    gap: 3px;
  }
  .exp-meter i {
    flex: 1 1 0;
    height: calc(8px * var(--ui-scale));
    border-radius: 2px;
    background: rgba(var(--color-accent-rgb), 0.08);
    border: 1px solid rgba(var(--color-accent-rgb), 0.22);
  }
  .exp-meter i.on {
    background: var(--risk-color);
    border-color: var(--risk-color);
  }
  .exp-risk-grade {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--color-text-primary);
    white-space: nowrap;
  }
  .exp-risk-grade.dim {
    color: var(--color-text-dim);
  }
  .exp-scope-sub {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--color-accent-bright);
  }
  .exp-scope-demand {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    line-height: 1.4;
  }
  .exp-scope-bodies {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 118px), 1fr));
    gap: 6px;
  }
  .exp-scope-body {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 6px 8px;
    font-size: var(--text-2xs);
    background: rgba(var(--color-accent-rgb), 0.05);
    border: 1px solid rgba(var(--color-accent-rgb), 0.12);
    border-radius: var(--corner);
    min-width: 0;
  }
  .exp-scope-body-name {
    font-size: var(--text-xs);
    color: var(--color-text-primary);
    margin-bottom: 2px;
  }
  .exp-scope-gr {
    display: flex;
    justify-content: space-between;
    gap: 6px;
    color: var(--color-text-secondary);
  }
  .exp-scope-gr > span:first-child {
    color: var(--color-text-dim);
  }
  /* The recommendation box (detail 4). */
  .exp-rec {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 9px 11px;
    border: 1px solid rgba(var(--color-accent-rgb), 0.5);
    background: rgba(var(--color-accent-rgb), 0.08);
    border-radius: var(--corner);
  }
  .exp-rec-kicker {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--color-text-dim);
  }
  .exp-rec-head:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
  .exp-rec-head {
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-display);
    font-size: var(--text-md);
    color: var(--color-text-primary);
  }
  .exp-rec-reason {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    line-height: 1.45;
  }
  .exp-rec-warn {
    font-size: var(--text-xs);
    color: var(--color-warning);
    line-height: 1.45;
  }
  .exp-rec-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .exp-rec-moves {
    display: flex;
    flex-direction: column;
    gap: 1px;
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
    line-height: 1.45;
  }
  .exp-rec-moves .warn {
    color: var(--color-warning);
  }
  .exp-rec-btn {
    align-self: flex-start;
    white-space: normal;
    text-align: left;
  }
  /* The forecast line (detail 5). */
  .exp-forecast {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 2px 0 2px 10px;
    border-left: 2px solid var(--color-accent);
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    line-height: 1.45;
  }
  .exp-forecast-lead {
    color: var(--color-text-primary);
  }
  .exp-forecast-hard {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .exp-forecast-note {
    color: var(--color-text-dim);
  }
  /* The blind launch confirm (inside ActionModal). */
  .exp-blind-confirm {
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    line-height: 1.5;
  }
  .exp-blind-confirm p {
    margin: 0;
  }
  .exp-blind-warn {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    color: var(--color-warning);
  }
  .exp-blind-detail {
    font-size: var(--text-xs);
    color: var(--color-text-dim);
  }
</style>
