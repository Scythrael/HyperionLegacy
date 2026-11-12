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
  // with the charted-anomaly marker, per-body scan cards, the Ground Ops queues, timelines and
  // cards, a findings tally, Claim). (Wiring OC-G1 deleted the legacy run's activity readout and
  // battle logs with the legacy path.)
  // ============================================================================

  import type { GameState, Expedition, CaptainState, GroundTeamKind } from "./game/model";
  import { SHIP_TYPES } from "./game/model";
  import {
    expeditionCandidates,
    expeditionScanFraction,
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
  import { deriveAwayTeam } from "./game/gambit";
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
  // GO-15: each body's scan track (ship-event pips with outcome and pause, supply caches)
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
    arrayCharacterLine,
    candidateRegionText,
    createInputCache,
    dispatchGateLine,
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
  // Field Kits FKR-9 (the signed-off packing mockup, USER ANSWERS 2026-10-20): per-member packing at dispatch with the
  // per-team Quartermaster top-up, the in-run supplies readout (card line + detail table) and the claim's kit line.
  // Every display decision is in fieldKitsDisplay.ts (tested); the pack and the toggle route to the host's do* handlers.
  import { claimKitsView, dispatchPackView, runCardLine, runSuppliesView, steppedPack, type PackSourceView } from "./fieldKitsDisplay";
  import type { FieldKitId } from "./game/fieldKits";
  // Expedition Tiers G2-6 (the signed-off dispatch console mockup, user 2026-10-21 "approve as is"): the region picker
  // (Tier I to VII tabs, the small map as the alternative), the candidate and resume cards, the launch bar and the
  // recall confirm. Every display decision is in expeditionConsoleDisplay.ts (tested); recall and abandon route to the
  // host's do* handlers.
  import type { RegionTier } from "./game/model";
  import {
    candidateCardView,
    candidatesHeading,
    consoleDefaultTier,
    isTrainingDispatch,
    launchBarView,
    lockedTierView,
    nextTier,
    preselectCandidateId,
    recallClaimView,
    recallConfirmView,
    recalledStepperView,
    regionMapView,
    regionTabsView,
    resumeCardsView,
    shipPropulsionView,
    tierFactsView,
    trainingRunNote,
    type CandidateCardView,
  } from "./expeditionConsoleDisplay";
  import { loadLastExpeditionTier, loadRegionMapOpen, saveLastExpeditionTier, saveRegionMapOpen } from "./expeditionConsolePreference";
  // Safe first runs SF-6: the "Training run" chip and its line, verbatim (user 2026-10-27, call 12), and the run's stamp.
  import { TRAINING_EXPEDITION_LINE } from "./trainingRunDisplay";
  import TrainingRunChip from "./TrainingRunChip.svelte";
  import { isTrainingRun } from "./game/enemyRanks";
  import { recallBlockText, recallPreview } from "./game/expedition";
  // Gas Giant Study GG-6 (the signed-off v3 mockup, user 2026-10-21 "approve as is"): each orbital body's study row, the
  // system's nebula row, the study summary chips, and under the timelines the ship holding orbit, the ship legs with the
  // return forecast, the gas giant body card and the study results. Display decisions in gasGiantStudyDisplay.ts
  // (tested); nothing here acts (the ship always runs the study).
  import { nebulaRowView, studyBodyView, studySummaryChips } from "./gasGiantStudyDisplay";
  import StudyChips from "./StudyChips.svelte";
  import StudyRunPanel from "./StudyRunPanel.svelte";

  // --- Props ------------------------------------------------------------------
  // `state` is the whole GameState (read-only here). The callbacks route every side effect
  // back to the host so persistence + logging happen exactly once, in App.svelte.
  export let state: GameState;
  // Launch: dispatch the chosen ship + its captain on the chosen candidate, with the anomaly
  // opt-in. Host: startExpedition -> doSave -> pushLog.
  // G2-6: returns true when the expedition launched (the console then remembers the region).
  export let onStart: (shipId: string, captainId: number, candidateId: string, anomalyOptIn: boolean) => boolean | void;
  // Claim: collect a COMPLETE expedition's findings. Host: claimExpedition -> doSave -> pushLog.
  export let onClaim: (expeditionId: string) => void;
  // Squads SQ-7 section 7.2: "Set composition" on the telescope's recommendation. Host: applyComposition -> doSave ->
  // pushLog (doApplyComposition).
  export let onSetComposition: (shipId: string, kinds: GroundTeamKind[]) => void = () => {};
  // GO-13: a live queue edit (assign, reorder, skip, re-queue, Default plan, Auto-assign). Host: editGroundOps ->
  // doSave -> pushLog (doEditGroundOps); returns null when applied, else the refusal in plain words.
  export let onEditGroundOps: (expeditionId: string, edit: GroundOpsEdit) => string | null = () => null;
  // Field Kits FKR-9: a member's pack preference (kit -> count; null = back to the default) and a team's "Top up from the
  // Quartermaster at launch" toggle. Host: setMemberPack / setGroundTeamTopUp -> doSave -> pushLog (doSetMemberPack,
  // doSetTeamTopUp). Both shape the NEXT dispatch only.
  export let onSetMemberPack: (shipId: string, teamIndex: number, memberId: string, pack: Partial<Record<FieldKitId, number>> | null) => void = () => {};
  export let onSetTeamTopUp: (shipId: string, teamIndex: number, on: boolean) => void = () => {};
  // Expedition Tiers G2-6: recall a run home (after its one confirm) and let a resumable system go (after its one
  // confirm). Host: recallExpedition / abandonHeldSystem -> doSave -> pushLog (doRecallExpedition, doAbandonHeldSystem).
  export let onRecall: (expeditionId: string) => void = () => {};
  // OC-F14 (user 2026-11-12, Option A): the field repair strip's one-tap order and cancel on the Ship lane. Host:
  // orderFieldRepair / cancelFieldRepair -> doSave -> pushLog (doOrderFieldRepair, doCancelFieldRepair).
  export let onOrderRepair: (expeditionId: string) => void = () => {};
  export let onCancelRepair: (expeditionId: string) => void = () => {};
  export let onAbandonHeld: (heldId: string) => void = () => {};

  // --- Local UI state ---------------------------------------------------------
  // The ship whose console is open. null until the first eligible ship defaults in below.
  let chosenShipId: string | null = null;
  // The candidate target the player has selected in the dispatch view (before Launch).
  let selectedCandidateId: string | null = null;
  // The dispatch-time anomaly-chart opt-in (default ON: chart an anomaly if sensors flag one).
  let anomalyOptIn = true;
  // The blind launch confirm (user #7: "this is truly unknown territory. Are you sure you wish to go?") is open.
  let confirmBlind = false;
  // G2-6: the region tab the player picked (null = the zero-click default: the region last launched to when this ship
  // can attempt it), the remembered region, whether the small map is open, and the recall / abandon confirms.
  let pickedTier: RegionTier | null = null;
  let rememberedTier: RegionTier | null = loadLastExpeditionTier();
  let mapOpen = loadRegionMapOpen();
  let confirmRecall = false;
  let abandonId: string | null = null;

  // --- Static display metadata ------------------------------------------------
  const HAZARD_LABEL: Record<HazardTier, string> = {
    low: "Low",
    lowMedium: "Low-Med",
    medium: "Medium",
    high: "High",
    veryHigh: "Very High",
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
  // G2-6: the REGION PICKER (user G11 "Region, then 3 nearest"; the signed-off mockup's tabs). A new ship opens on the
  // zero-click default again.
  let tierShipId: string | null = null;
  $: if (chosenShipId !== tierShipId) {
    tierShipId = chosenShipId;
    pickedTier = null;
    // A confirm opened for another ship never reopens on its own later (review fix).
    confirmRecall = false;
    abandonId = null;
  }
  $: tabs = chosenShip && !chosenExpedition ? regionTabsView(state, chosenShip) : [];
  $: activeTier = pickedTier ?? consoleDefaultTier(tabs, rememberedTier);
  $: activeTab = tabs.find((t) => t.tier === activeTier) ?? null;
  $: tierReady = activeTab?.ready === true;
  $: facts = chosenShip && !chosenExpedition ? tierFactsView(state, activeTier) : null;
  $: propulsion = chosenShip && !chosenExpedition ? shipPropulsionView(state, chosenShip, activeTier) : null;
  $: lockedView = chosenShip && activeTab && !activeTab.ready ? lockedTierView(state, chosenShip, activeTier, activeTab.gates) : null;
  $: regionMap = mapOpen && chosenShip && !chosenExpedition ? regionMapView(state, chosenShip, tabs, activeTier) : null;
  // G2-2: nearest first. A locked tier offers no candidates (its panel previews them dimmed instead).
  $: candidates = chosenShip && !chosenExpedition && tierReady ? nearestFirst(expeditionCandidates(state, chosenShip.id, activeTier)) : [];
  $: scopeLevel = telescopeLevel(state);
  // The card rows (transit at this ship's drive, the reach bar, the gates), from the engine (expeditionConsoleDisplay.ts).
  $: cards = chosenShip ? candidates.map((c) => candidateCardView(state, chosenShip!, c, scopeLevel)) : [];
  $: cardOf = new Map<string, CandidateCardView>(cards.map((c) => [c.id, c]));
  // G2-5 / G2-6 (user G12): the region's resumable systems, at the top of its own region. A LOCKED region lists them
  // too (dimmed, with the gate this ship fails, Abandon still offered), so its tab's resume count always has its cards.
  $: resumeCards = chosenShip && !chosenExpedition ? resumeCardsView(state, chosenShip, activeTier) : [];
  $: pickableResumes = tierReady ? resumeCards : [];
  // Default / repair the selected candidate when the list (or ship, or region) changes: the nearest this ship can
  // launch to (the zero-click path), else the nearest.
  $: if ((cards.length > 0 || pickableResumes.length > 0) && (selectedCandidateId === null || (!cardOf.has(selectedCandidateId) && !pickableResumes.some((r) => r.id === selectedCandidateId)))) {
    selectedCandidateId = preselectCandidateId(cards) ?? pickableResumes[0]?.id ?? null;
  }
  $: selectedCandidate = candidates.find((c) => c.id === selectedCandidateId) ?? null;
  $: selectedResume = pickableResumes.find((r) => r.id === selectedCandidateId) ?? null;
  $: launchBar = launchBarView(
    selectedResume
      ? { name: selectedResume.name, outboundSeconds: selectedResume.outboundSeconds, resume: true }
      : selectedCandidate && cardOf.get(selectedCandidate.id)
        ? { name: selectedCandidate.systemName, outboundSeconds: cardOf.get(selectedCandidate.id)!.outboundSeconds, resume: false }
        : null,
  );
  $: trainingNote = chosenShip && !chosenExpedition && tierReady && activeTier === 1 && isTrainingDispatch(state, chosenShip, 1) ? trainingRunNote(state, shipName(chosenShip.id)) : null;
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
  // Expedition Tiers G2-4 (D18): the propulsion gates startExpedition enforces (explorer hull, drive class, frontier
  // sensors, reach), so Launch is off with the reason shown. Null when they pass (expeditionDispatchDisplay.ts).
  $: gateLine = chosenShip && !chosenExpedition ? dispatchGateLine(state, chosenShip, selectedCandidateId) : null;
  // Ground Ops (GO-7b, user 2026-10-12): no automatic stand-ins, so the block lists what each ground team waits on
  // ("Alpha: Grokk returns to duty in 12m"). Squads SQ-1: groundWaitTeams leaves out a team nobody is slotted
  // into (every hull fields 2 teams now; the empty pair would only add noise).
  // GO-12: the dispatch strip, one row per ground team: who WILL deploy (ready counts) and who will NOT (why, with
  // the time left), plus the ship-level reason when it cannot launch.
  $: teamsView = chosenTeamCheck ? dispatchTeamsView(chosenTeamCheck.ground, now) : null;

  // SQ-7 section 7.2: the selected candidate's telescope block (the telescope level, scopeLevel, is read above).
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
  $: legFraction = chosenExpedition ? expeditionPhaseFraction(chosenExpedition, now) : 0;
  $: anomalyMarker = chosenExpedition ? expeditionAnomalyMarkerFraction(chosenExpedition) : null;
  // GO-14 (a flagged run): the task progress cards and the medical bay cards, recomputed per tick (time left).
  $: taskCards = chosenExpedition?.groundOps ? taskCardsView(chosenExpedition, chosenShip, now) : null;
  $: bayCards = chosenExpedition?.groundOps ? bayCardsView(chosenExpedition, chosenShip, now, state.awayMembers) : [];
  // GG-6: the study summary chips and the nebula row of the run in view.
  $: studyChipRow = chosenExpedition ? studySummaryChips(chosenExpedition) : [];
  $: nebRow = chosenExpedition ? nebulaRowView(chosenExpedition, now) : null;
  // GO-15: the scan tracks' key row (only the kinds this run shows).
  $: scanKey = chosenExpedition ? scanTrackKey(chosenExpedition) : null;
  // Field Kits FKR-9: the dispatch pack screen (null while kits are not live in runs), the run's supplies readout per
  // team and the claim's kit line (a Field Kits run only).
  $: packView = chosenShip && !chosenExpedition ? dispatchPackView(state, chosenShip.id) : null;
  $: supplies = chosenExpedition ? runSuppliesView(chosenExpedition, chosenShip, state.awayMembers) : [];
  $: claimKits = chosenExpedition && chosenExpedition.phase === "complete" ? claimKitsView(chosenExpedition) : null;
  // G2-6 (user G13): Recall is offered while the run is out (transit, scanning, activities; the stored phase is current
  // every tick); its one confirm reads the engine's recallPreview live. A recalled run's stepper and claim lines.
  $: canRecall = chosenExpedition !== null && (chosenExpedition.phase === "transit" || chosenExpedition.phase === "scanning" || chosenExpedition.phase === "activities");
  $: recallView = confirmRecall && chosenExpedition ? recallConfirmView(state, chosenExpedition, shipName(chosenExpedition.shipId)) : null;
  $: recallRefusal = confirmRecall && chosenExpedition && recallView === null ? (() => { const r = recallPreview(state, chosenExpedition!.id); return r.ok ? null : recallBlockText(r.reason); })() : null;
  $: recalledSteps = chosenExpedition ? recalledStepperView(chosenExpedition, now) : null;
  $: recallClaim = chosenExpedition ? recallClaimView(state, chosenExpedition) : null;
  // The resume card the abandon confirm names.
  // The card it names went away (abandoned, launched, another region): the confirm closes for good.
  function dropStaleAbandon(list: readonly { id: string }[]): void {
    if (abandonId !== null && !list.some((r) => r.id === abandonId)) abandonId = null;
  }
  $: dropStaleAbandon(resumeCards);
  $: abandonCard = abandonId !== null ? resumeCards.find((r) => r.id === abandonId) ?? null : null;

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
  // --- Actions (all route to the host) ----------------------------------------
  // Field Kits FKR-9: one stepper press on a member's pack, and the source chip's Reset.
  function stepPack(teamIndex: number, memberId: string, pack: Partial<Record<FieldKitId, number>>, kit: FieldKitId, delta: number): void {
    if (!chosenShip) return;
    onSetMemberPack(chosenShip.id, teamIndex, memberId, steppedPack(pack, kit, delta));
  }
  function resetPack(teamIndex: number, memberId: string, source: PackSourceView): void {
    if (!chosenShip || source.kind !== "edited") return;
    onSetMemberPack(chosenShip.id, teamIndex, memberId, source.resetPack);
  }
  // Launch: a BLIND candidate (beyond the telescope's range) asks first (user #7); any other launches at once.
  // G2-6: a resumed system launches the same way (its id is "held-<expeditionId>"); it was charted before, so it never
  // asks the blind confirm.
  function launch(): void {
    if (!chosenShip || (!selectedCandidate && !selectedResume) || !chosenCaptain) return;
    if (selectedCandidate && selectedCandidate.telescope.blind) {
      confirmBlind = true;
      return;
    }
    commitLaunch();
  }
  function commitLaunch(): void {
    confirmBlind = false;
    const id = selectedResume?.id ?? selectedCandidate?.id ?? null;
    if (!chosenShip || id === null || !chosenCaptain) return;
    const launched = onStart(chosenShip.id, chosenCaptain.id, id, anomalyOptIn);
    // G2-6 (the zero-click path): the console opens on this region next time, once the launch went out.
    if (launched === true) {
      rememberedTier = activeTier;
      saveLastExpeditionTier(activeTier);
    }
    // The host reassigns state; the chosen ship now has an active expedition and this view swaps to
    // in-progress on the next reactive pass. Reset the dispatch-only local toggles for the next dispatch.
    selectedCandidateId = null;
    pickedTier = null;
    anomalyOptIn = true;
  }
  // G2-6: the region picker. A tab or a map badge opens its region; the arrow keys move along the tabs (and focus).
  function pickTier(tier: RegionTier): void {
    pickedTier = tier;
  }
  async function tabKey(e: KeyboardEvent, tier: RegionTier): Promise<void> {
    const to = nextTier(tier, e.key);
    if (to === null) return;
    e.preventDefault();
    pickTier(to);
    await tick();
    document.getElementById(`exp-tab-${to}`)?.focus();
  }
  function badgeKey(e: KeyboardEvent, tier: RegionTier): void {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    pickTier(tier);
  }
  function toggleMap(): void {
    mapOpen = !mapOpen;
    saveRegionMapOpen(mapOpen);
  }
  // The launch bar's "Edit packs": the Field Kits pack panel below (unchanged), scrolled to and focused.
  let packsEl: HTMLElement | null = null;
  function goToPacks(): void {
    packsEl?.scrollIntoView({ block: "start", behavior: "smooth" });
    packsEl?.focus({ preventScroll: true });
  }
  // G2-6 (user G13): the recall's one confirm, then the host's handler.
  function commitRecall(): void {
    const exp = chosenExpedition;
    confirmRecall = false;
    if (exp) onRecall(exp.id);
  }
  function commitAbandon(): void {
    const id = abandonId;
    abandonId = null;
    if (id !== null) onAbandonHeld(id);
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
              {exp.phase === "complete" ? "Findings ready" : exp.recall ? "Recalled · flying home" : `On expedition · ${exp.phase === "activities" ? activitiesPhaseLabel(exp).toLowerCase() : exp.phase}`}
            {:else if expeditionShipDamaged(state, s)}
              Repair first
            {:else}
              Ready to dispatch
            {/if}
          </span>
          {#if exp && exp.phase === "activities"}
            {@const card = runCardLine(exp, s)}
            {#if card && card.teams.length > 0}
              <!-- Field Kits FKR-9 ("Both"): the one-line supplies summary on the expedition card. -->
              <span class="fk-card">
                {#each card.teams as t (t.index)}
                  <span><Icon name="kitFirstAid" size={12} /> {t.text}</span>
                  {#if t.charges > 0}<span><Icon name="grenade" size={12} /> {t.charges} charge{t.charges === 1 ? "" : "s"}</span>{/if}
                {/each}
                {#if card.chip}<span class="fk-rank"><Icon name={card.chip.glyph} size={12} /> {card.chip.text}</span>{/if}
              </span>
            {/if}
          {/if}
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
            <!-- Safe first runs SF-6: the run view carries the training run's chip and line (its stamp). -->
            {#if isTrainingRun(exp)}<TrainingRunChip line={TRAINING_EXPEDITION_LINE} />{/if}
          </div>
          {#if exp.phase === "complete"}
            <button type="button" class="exp-btn primary" on:click={() => onClaim(exp.id)}>Claim findings</button>
          {:else if canRecall}
            <!-- G2-6 (user G13): one confirm names the return time and what stops; never a paid speed-up. -->
            <button type="button" class="exp-btn quiet" on:click={() => (confirmRecall = true)}><Icon name="recall" size={14} /> Recall</button>
          {/if}
        </div>

        <!-- PHASE STEPPER (G2-6: a recalled run shows the phases it cut and "Recalled" on its way home) -->
        <div class="exp-stepper" class:recalled={recalledSteps !== null}>
          {#each PHASE_STEPS as step, i (step.key)}
            {@const st = stepState(step.key, exp.phase)}
            {@const rs = recalledSteps ? recalledSteps.steps[i] : null}
            <div
              class="exp-step"
              class:done={rs ? rs === "done" : st === "done"}
              class:active={rs ? false : st === "active"}
              class:cut={rs === "cut"}
              class:recalled={rs === "recalled"}
            >
              <span class="exp-step-dot" aria-hidden="true">
                {#if rs === "recalled"}<Icon name="recall" size={12} />{:else if rs === "cut"}{i + 1}{:else if (rs ?? st) === "done"}<Icon name="check" size={12} />{:else}{i + 1}{/if}
              </span>
              <span class="exp-step-label">
                {#if rs === "recalled" && recalledSteps}{recalledSteps.returnText}{:else}{step.key === "activities" ? activitiesPhaseLabel(exp) : step.label}{#if rs === "cut"}<span class="exp-sr"> (cut short by the recall)</span>{/if}{/if}
              </span>
            </div>
            {#if i < PHASE_STEPS.length - 1}
              <span class="exp-step-link" class:done={rs ? rs === "done" : stepState(step.key, exp.phase) === "done"} class:cut={rs === "cut"} aria-hidden="true"></span>
            {/if}
          {/each}
        </div>
        {#if exp.recall && exp.phase === "return"}
          <div class="exp-recalled-note"><Icon name="recall" size={13} /> Flying home. Recalled runs claim like any other.</div>
        {/if}

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
                  {exp.anomalyCharted ? (exp.siteRules === 1 ? "Anomaly charted: a detour was added, and its small haul comes home with the run." : "Anomaly charted: a detour was added.") : "Anomaly check passed: nothing charted."}
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
        {#if studyChipRow.length > 0}
          <!-- GG-6: the study summary (the v3 mockup's chip row): bodies, ship studies, the nebula sweep, no squad needed. -->
          <StudyChips chips={studyChipRow} label="Ship studies" />
        {/if}
        <div class="exp-bodies">
          {#each exp.bodies as body, bi (body.id)}
            {@const frac = body.scanTotal > 0 ? body.scanProgress / body.scanTotal : 0}
            {@const track = scanTrackView(exp, bi)}
            {@const study = studyBodyView(exp, bi, now)}
            <div class="exp-body-card" class:orb={study !== null}>
              <div class="exp-body-top">
                <span class="exp-body-type">
                  {#if study}
                    <span class="exp-body-let">{study.letter}</span> {study.name} <span class="exp-body-mass">{study.massText}</span>
                  {:else}
                    {planetLabel(body.planetType)}
                    {#if isOrbital(body.planetType)}<span class="exp-body-flag">orbital ops</span>{/if}
                  {/if}
                </span>
                <span class="exp-body-haz">{hazardLabelFor(body.planetType)} hazard</span>
              </div>
              {#if study}<StudyChips chips={study.chips} label="{study.name} study" />{/if}
              {#if track}
                <ScanTrack {track} idBase="scan-{exp.id}-{bi}" />
              {:else}
                <div class="exp-bar slim">
                  <div class="exp-bar-fill" style="width: {pct(frac)}%; background: {scanColor(frac)};"></div>
                </div>
              {/if}
              <div class="exp-body-scanpct">{pct(frac)}% scanned</div>
              {#if study}
                <!-- GG-6: an orbital body has no ground finds; its study chips above say so. -->
              {:else if body.discoveries.length > 0}
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
          {#if nebRow}
            <!-- GG-4 / GG-6: the system's nebula, a system feature swept after the bodies (dashed, as drawn). -->
            <div class="exp-body-card neb">
              <div class="exp-body-top">
                <span class="exp-body-type"><Icon name="nebula" size={20} /> {nebRow.name} <span class="exp-body-mass">{nebRow.sub}</span></span>
              </div>
              <StudyChips chips={nebRow.chips} label="{nebRow.name} sweep" />
            </div>
          {/if}
        </div>

        <!-- GO-13: the per-planet TASK QUEUES (a flagged run only): reassign, reorder, skip, re-queue, Default plan,
             Auto-assign, per-team odds, the stuck flag with its Skip. -->
        {#if exp.groundOps}
          <GroundTaskQueue {exp} ship={chosenShip} {now} onEdit={(edit) => onEditGroundOps(exp.id, edit)} />

          <!-- GO-14: each team's timeline and the ship's lane, the medical bay cards, the task progress cards. -->
          <GroundTeamTimeline {exp} ship={chosenShip} {now} onOrderRepair={() => onOrderRepair(exp.id)} onCancelRepair={() => onCancelRepair(exp.id)} />
          <!-- GG-6: the ship holding orbit, the ship legs and forecast, the gas giant body card, the study results. -->
          <StudyRunPanel {exp} ship={chosenShip} {now} {state} />
          {#each supplies as sv (sv.index)}
            <!-- Field Kits FKR-9 ("Both"): the team's supplies, under its timeline: free set left, extras and grenade
                 charges left, each member's condition with its bay time; the objective's final fight rank. -->
            <section class="fk-run" aria-label={sv.title}>
              <div class="fk-run-head">
                <span class="exp-section-tag">{sv.title}</span>
                <span class="fk-obj">{sv.objectiveText}</span>
                {#if sv.chip}<span class="fk-rank"><Icon name={sv.chip.glyph} size={12} /> {sv.chip.text}</span>{/if}
              </div>
              <div class="fk-colhead" aria-hidden="true"><span>Member</span><span>Free set left</span><span>Extras · charges</span><span>Condition</span></div>
              <div class="fk-rows">
                {#each sv.rows as r (r.id)}
                  <div class="fk-row">
                    <span class="fk-who">
                      <Icon name={r.glyph} size={16} /> {r.name}
                      {#if r.medic}<span class="fk-medmark"><Icon name="medBay" size={12} title="Medical Training" /></span>{/if}
                    </span>
                    <span class="fk-cell"><span class="fk-lbl">Free</span><span class="fk-free-n"><Icon name="kitFirstAid" size={12} /> {r.freeLeft} of {r.freeTotal}</span></span>
                    <span class="fk-cell">
                      <span class="fk-lbl">Extras</span>
                      {#each r.extras as e (e.kit)}<span title={e.label}><Icon name={e.glyph} size={12} /> {e.left} of {e.packed}</span>{/each}
                      {#if r.charges}
                        <span>
                          <Icon name="grenade" size={12} />
                          <span class="fk-pips" role="img" aria-label="{r.charges.left} of {r.charges.total} charges">{#each Array(r.charges.total) as _, pi (pi)}<i class:off={pi >= r.charges.left}></i>{/each}</span>
                          {r.charges.left} of {r.charges.total}
                        </span>
                      {/if}
                      {#if r.fuseNote}<span class="fk-dim">{r.fuseNote}</span>{/if}
                      {#if r.toolNote}<span class="fk-dim">{r.toolNote}</span>{/if}
                      {#if r.extras.length === 0 && !r.charges && !r.toolNote}<span class="fk-dim">None packed</span>{/if}
                    </span>
                    <span class="fk-cell fk-cond">
                      <span class="fk-lbl">Condition</span>
                      {#if r.conditions.length === 0}
                        {r.healthText}
                      {:else}
                        {#each r.conditions as c (c.key)}
                          <span>{#if c.glyph}<Icon name={c.glyph} size={12} />{/if} {c.text}{#if c.bayText}<span class="fk-bay"> · {c.bayText}</span>{/if}</span>
                        {/each}
                      {/if}
                    </span>
                  </div>
                {/each}
              </div>
              <div class="fk-refresh"><Icon name="reload" size={16} /> <span>{sv.refreshText}</span></div>
            </section>
          {/each}
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
            <div class="exp-note">Battles auto-resolve: each Security member runs their own tactical protocols, or the built-in default. After every objective the team returns to the ship to offload, recover in the medical bay and reload; a lost objective keeps its progress and is retried after the bay.</div>
          {/if}
        {/if}

        <!-- FINDINGS TALLY -->
        <div class="exp-findings">
          <span class="exp-findings-count">{exp.findings.length}</span>
          <span class="exp-findings-label">findings gathered</span>
          {#if exp.anomalyCharted}<span class="exp-chip anomaly">+ charted anomaly</span>{/if}
        </div>
        {#if recallClaim}
          <!-- G2-6: a recalled run home claims like any other; the card says what the recall left (Resume, or a candidate). -->
          <div class="exp-recall-claim">
            <strong><Icon name="recall" size={14} /> {recallClaim.heading}</strong>
            <span>{recallClaim.text}</span>
            {#if recallClaim.resumeChip}<span class="exp-chip resume"><Icon name="resume" size={11} /> {recallClaim.resumeChip}</span>{/if}
          </div>
        {/if}
        {#if claimKits}
          <!-- Field Kits FKR-9: the claim's kit line, after the haul. -->
          <div class="fk-claim">
            <span class="fk-home"><Icon name="home" size={16} /> {claimKits.homeText}</span>
            <span class="fk-claim-sub">{claimKits.subText}</span>
          </div>
        {/if}
      </div>
    {:else if chosenShip}
      <!-- ============================ DISPATCH ============================ -->
      <div class="exp-body">
        <div class="exp-hdr">
          <div class="exp-hdr-main">
            <span class="exp-hdr-system">Dispatch · {shipName(chosenShip.id)}</span>
            <span class="exp-hdr-sub">
              {hullLabel(chosenShip.id)}{#if chosenCaptain} · {chosenCaptain.label}{/if} · Sensors {chosenSensors}{#if propulsion}
                · <span class="exp-hdr-glyph"><Icon name="drive" size={12} /> {propulsion.driveText}</span> · <span class="exp-hdr-glyph"><Icon name="reach" size={12} /> {propulsion.reachText}</span>{/if}
            </span>
          </div>
          {#if propulsion}<span class="exp-hdr-home">{propulsion.homeworldText}</span>{/if}
        </div>

        <!-- G2-6 REGION PICKER (the signed-off mockup section 1): seven tabs, Roman numerals, each Ready or its first unmet
             gate in words; the arrow keys move along them. The small map below is the alternative picker. -->
        <div class="exp-tabs" role="tablist" aria-label="Regions">
          {#each tabs as t (t.tier)}
            <button
              type="button"
              role="tab"
              id="exp-tab-{t.tier}"
              class="exp-tab"
              class:locked={!t.ready}
              aria-selected={t.tier === activeTier}
              aria-controls="exp-tabpanel"
              aria-label={t.ariaLabel}
              tabindex={t.tier === activeTier ? 0 : -1}
              on:click={() => pickTier(t.tier)}
              on:keydown={(e) => tabKey(e, t.tier)}
            >
              <span class="exp-tab-num" aria-hidden="true">{t.numeral}</span>
              <span class="exp-tab-name" aria-hidden="true">{t.label}</span>
              <span class="exp-tab-state" aria-hidden="true">
                <Icon name={t.ready ? "check" : "lock"} size={11} />
                <span>{t.stateText}</span>
                {#if t.resumeCount > 0}<span class="exp-tab-res"><Icon name="resume" size={11} /> {t.resumeCount}</span>{/if}
              </span>
            </button>
          {/each}
        </div>
        <div class="exp-map-tools">
          <button type="button" class="exp-link" aria-expanded={mapOpen} aria-controls="exp-region-map" on:click={toggleMap}>
            <Icon name="telescope" size={12} /> {mapOpen ? "Hide the map" : "Pick on the map"}
          </button>
        </div>
        {#if regionMap}
          {@const m = regionMap}
          <!-- G2-6: the alternative picker, the approved telescope map look. Tapping a badge opens its region above. -->
          <div class="exp-map" id="exp-region-map">
            <svg class="exp-map-svg" viewBox={m.viewBox} role="group" aria-label={m.ariaLabel}>
              <path class="exp-map-disk" d={m.diskPath} />
              {#each m.armPaths as d, ai (ai)}<path class="exp-map-arm" class:minor={ai === m.armPaths.length - 1} {d} />{/each}
              <path class="exp-map-bulge" d={m.bulgePath} />
              <circle class="exp-map-core" cx={m.core.x} cy={m.core.y} r="3.5" />
              <circle class="exp-map-ring" cx={m.home.x} cy={m.home.y} r={m.reachR} />
              <circle class="exp-map-home" cx={m.home.x} cy={m.home.y} r="4" />
              {#each m.badges as b (b.tier)}
                <g
                  class="exp-map-badge"
                  class:locked={b.locked}
                  class:sel={b.selected}
                  role="button"
                  tabindex="0"
                  aria-label={b.ariaLabel}
                  aria-pressed={b.selected}
                  on:click={() => pickTier(b.tier)}
                  on:keydown={(e) => badgeKey(e, b.tier)}
                >
                  <circle cx={b.x} cy={b.y} r={m.badgeR} />
                  <text x={b.x} y={b.y + 3} text-anchor="middle">{b.numeral}</text>
                </g>
              {/each}
              <text class="exp-map-label" x={m.homeLabel.x} y={m.homeLabel.y}>{m.homeLabel.text}</text>
              <text class="exp-map-label small" x={m.coreLabel.x} y={m.coreLabel.y} text-anchor="middle">{m.coreLabel.text}</text>
            </svg>
            <div class="exp-map-legend">{m.legend}</div>
          </div>
        {/if}

        <div class="exp-tabpanel" role="tabpanel" id="exp-tabpanel" aria-labelledby="exp-tab-{activeTier}">
          {#if facts}
            <div class="exp-facts">
              <span class="exp-chip">{facts.bandText}</span>
              <span class="exp-chip"><Icon name="clock" size={11} /> {facts.timeText}</span>
              <span class="exp-chip">{facts.bodiesText}</span>
              <span class="exp-chip">{facts.haulText}</span>
              <span class="exp-chip"><Icon name="telescope" size={11} /> {facts.telescopeText}</span>
            </div>
          {/if}

          {#if lockedView}
            <!-- G2-6: a LOCKED tier (the mockup's locked panel): every gate, met or not, and a dimmed preview of its
                 three nearest systems (not selectable). Its resumable systems still sit on top (review fix): dimmed, with
                 the gate this ship fails, and Abandon still offered. -->
            {#if resumeCards.length > 0}
              <div class="exp-section-tag"><Icon name="resume" size={12} /> Open to resume</div>
              <div class="exp-cards">
                {#each resumeCards as r (r.id)}
                  <div class="exp-resume-wrap">
                    <div class="exp-target resume locked">
                      <span class="exp-target-top">
                        <span class="exp-target-name">{r.name}</span>
                        <span class="exp-chip resume"><Icon name="resume" size={11} /> Resume</span>
                        {#if r.realStar}<span class="exp-chip star">Real star</span>{/if}
                      </span>
                      <span class="exp-target-region">{r.whereText}</span>
                      <span class="exp-rows">
                        <span class="exp-row-k">Charted</span>
                        <span class="exp-row-v">
                          <span class="exp-reach" aria-hidden="true"><i style="width: {r.percent}%;"></i></span>
                          <span class="exp-row-small">{r.chartedText}</span>
                        </span>
                        <span class="exp-row-k">Objectives</span>
                        <span class="exp-row-v">{r.objectivesText}</span>
                      </span>
                      {#if r.reasonText}<span class="exp-target-reason"><Icon name="lock" size={13} /> {r.reasonText}</span>{/if}
                    </div>
                    <div class="exp-resume-foot">
                      Stays open until finished or abandoned. This ship cannot resume it yet; any explorer that meets the gates can.
                      <button type="button" class="exp-link" on:click={() => (abandonId = r.id)}>{r.abandonLabel}</button>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
            <div class="exp-locked">
              <div class="exp-locked-gates">
                <div class="exp-locked-head"><Icon name="lock" size={14} /> {lockedView.heading}</div>
                <ul class="exp-gatelist">
                  {#each lockedView.rows as row (row.key)}
                    <li class={row.status}>
                      <span class="exp-gatelist-glyph"><Icon name={row.glyph} size={16} /></span>
                      <span>
                        {row.title}{#if row.status !== "info"}<span class="exp-sr">{row.status === "met" ? " (met)" : " (not met)"}</span>{/if}
                        <small>{row.detail}</small>
                      </span>
                    </li>
                  {/each}
                </ul>
              </div>
              <div class="exp-locked-peek">
                <div class="exp-locked-head">{lockedView.peekHeading}</div>
                <ul class="exp-peek" aria-label="Preview, not selectable">
                  {#each lockedView.peek as p, pi (pi)}<li><span>{p.name}</span><span>{p.distanceText}</span></li>{/each}
                </ul>
                <div class="exp-note">{lockedView.peekNote}</div>
              </div>
            </div>
          {:else}
            {#if trainingNote}<div class="exp-note exp-training-note">{trainingNote}</div>{/if}

        <div class="exp-dispatch">
          <!-- TARGET CANDIDATES (G2-6: resumable systems first, then the region's nearest, then the launch bar and the
               selected system's Subspace Telescope block) -->
          <div class="exp-targets">
            {#if resumeCards.length > 0}
              <div class="exp-section-tag"><Icon name="resume" size={12} /> Open to resume</div>
              <div class="exp-cards">
                {#each resumeCards as r (r.id)}
                  <div class="exp-resume-wrap">
                    <button
                      type="button"
                      class="exp-target resume"
                      class:active={selectedCandidateId === r.id}
                      aria-pressed={selectedCandidateId === r.id}
                      on:click={() => (selectedCandidateId = r.id)}
                    >
                      <span class="exp-target-top">
                        <span class="exp-target-name">{r.name}</span>
                        <span class="exp-chip resume"><Icon name="resume" size={11} /> Resume</span>
                        {#if r.realStar}<span class="exp-chip star">Real star</span>{/if}
                      </span>
                      <span class="exp-target-region">{r.whereText}</span>
                      <span class="exp-rows">
                        <span class="exp-row-k">Charted</span>
                        <span class="exp-row-v">
                          <span class="exp-reach" aria-hidden="true"><i style="width: {r.percent}%;"></i></span>
                          <span class="exp-row-small">{r.chartedText}</span>
                        </span>
                        <span class="exp-row-k">Objectives</span>
                        <span class="exp-row-v">{r.objectivesText}</span>
                        <span class="exp-row-k"><Icon name="clock" size={12} /> Transit</span>
                        <span class="exp-row-v">{r.transitText}<span class="exp-row-small">The trip is flown again. Any explorer can resume it.</span></span>
                      </span>
                      {#if r.reasonText}<span class="exp-target-reason"><Icon name="warning" size={13} /> {r.reasonText}</span>{/if}
                      <span class="exp-row-small"><Icon name="chevronRight" size={11} /> Select to resume</span>
                    </button>
                    <div class="exp-resume-foot">
                      Stays open until finished or abandoned.
                      <button type="button" class="exp-link" on:click={() => (abandonId = r.id)}>{r.abandonLabel}</button>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
            <div class="exp-section-tag">{candidatesHeading(candidates.length)}</div>
            <div class="exp-cards">
              {#each candidates as cand (cand.id)}
                {@const fk = cand.foreknowledge}
                {@const tel = cand.telescope}
                {@const card = cardOf.get(cand.id)}
                <button
                  type="button"
                  class="exp-target"
                  class:active={selectedCandidateId === cand.id}
                  aria-pressed={selectedCandidateId === cand.id}
                  on:click={() => (selectedCandidateId = cand.id)}
                >
                  <span class="exp-target-top">
                    <span class="exp-target-name">{cand.systemName}</span>
                    {#if card?.realStar}<span class="exp-chip star">Real star</span>{/if}
                    {#if card?.enemyTerritory}<span class="exp-chip enemy" title="Known enemy territory: combat risk one step higher"><Icon name="riskCombat" size={11} /> Enemy territory</span>{/if}
                    {#if card?.trainingRun}<TrainingRunChip title={TRAINING_EXPEDITION_LINE} />{/if}
                    {#if card && !card.reach.met}<span class="exp-chip warn"><Icon name="reach" size={11} /> Out of reach</span>{/if}
                    {#if tel.blind}
                      <!-- SQ-7 7.2: a blind candidate shows only its name, region, distance and this chip. -->
                      <span class="exp-chip blind"><Icon name="blindLaunch" size={12} /> Blind launch</span>
                    {:else if !fk.inRange}
                      <span class="exp-chip scope"><Icon name="telescope" size={12} /> {tel.detailName}</span>
                      <span class="exp-chip range">Beyond sensor range</span>
                    {:else}
                      <span class="exp-chip scope"><Icon name="telescope" size={12} /> {tel.detailName}</span>
                      <!-- E4c: name WHICH relic sets the system's would-be discoveries source (the engine's
                           relicSets projection, canonical set order) instead of a bare "Relic signature". Revealed
                           at the same sensor threshold; an empty list (no relic-bearing PoI) shows no chip. -->
                      {#if fk.relicSets && fk.relicSets.length > 0}
                        <span class="exp-chip relic"><Icon name="relic" size={11} /> Relics: {fk.relicSets.map(relicSetShortLabel).join(", ")}</span>
                      {/if}
                    {/if}
                  </span>
                  <span class="exp-target-region">{candidateRegionText(tel)} from your homeworld</span>
                  {#if card}
                    <span class="exp-rows">
                      <span class="exp-row-k"><Icon name="clock" size={12} /> Transit</span>
                      <span class="exp-row-v">{card.transitText}</span>
                      <span class="exp-row-k">Bodies</span>
                      <span class="exp-row-v">
                        {#if fk.inRange && fk.bodies}
                          <span class="exp-target-bodies">
                            {#each fk.bodies as b, i}
                              <span class="exp-target-body">
                                {#if b.planetType}
                                  {planetLabel(b.planetType)}{#if b.hazard !== null} · {hazardLabelFor(b.planetType)} hazard{/if}
                                {:else}
                                  Body {i + 1} · unresolved
                                {/if}
                              </span>
                            {/each}
                          </span>
                        {:else if !fk.inRange && !tel.blind}
                          <span class="exp-target-hidden">Contents hidden. A stronger sensor array reveals more.</span>
                          {#if sensorSplitHint(tel, fk)}
                            <!-- GO-12 review minor: the telescope still reads this system's risk; only the contents are hidden. -->
                            <span class="exp-target-hint">{sensorSplitHint(tel, fk)}</span>
                          {/if}
                        {:else}
                          <span class="exp-target-hidden">Unknown until the ship arrives.</span>
                        {/if}
                      </span>
                      {#if card.risk}
                        <span class="exp-row-k">Risk</span>
                        <span class="exp-row-v exp-riskrow">
                          {#each card.risk as f (f.id)}<span class:hi={f.high} title="{f.label}: {f.gradeName}"><Icon name={f.glyph} size={12} /> {f.gradeText}</span>{/each}
                        </span>
                      {/if}
                      <span class="exp-row-k"><Icon name="reach" size={12} /> Reach</span>
                      <span class="exp-row-v">
                        <span class="exp-reach" class:over={!card.reach.met} aria-hidden="true">
                          <i style="width: {card.reach.fillPercent}%;"></i>
                          {#if card.reach.markPercent !== null}<b style="left: {card.reach.markPercent}%;"></b>{/if}
                        </span>
                        <span class="exp-row-small">{card.reach.text}{#if card.reach.met} <span class="exp-met"><Icon name="check" size={11} /> in reach</span>{/if}</span>
                      </span>
                      <span class="exp-row-k">Gates</span>
                      <span class="exp-row-v exp-gates">
                        <span class:exp-met={card.gatesText.driveMet} class:exp-unmet={!card.gatesText.driveMet}><Icon name={card.gatesText.driveMet ? "check" : "lock"} size={11} /> {card.gatesText.drive}</span>
                        {#if card.gatesText.sensors !== null}<span class:exp-met={card.gatesText.sensorsMet} class:exp-unmet={!card.gatesText.sensorsMet}><Icon name={card.gatesText.sensorsMet ? "check" : "lock"} size={11} /> {card.gatesText.sensors}</span>{/if}
                      </span>
                    </span>
                    {#if card.reasonText}<span class="exp-target-reason"><Icon name="warning" size={13} /> {card.reasonText}</span>{/if}
                  {/if}
                </button>
              {/each}
            </div>

            <!-- G2-6: LAUNCH in a bar under the candidates (the signed-off mockup): the selection, the kits line with a
                 link to the unchanged pack panel, every reason Launch is off, and the button. -->
            <div class="exp-launchbar">
              <div class="exp-launch-sel">
                <strong>{launchBar.selectedText}</strong>
                {#if packView && packView.teams.length > 0}
                  <span class="exp-launch-kits">
                    <span><Icon name="kitFirstAid" size={13} /> Field kits: {packView.summaryText}</span>
                    <span class="fk-ready"><Icon name="check" size={12} /> {packView.readyText}</span>
                    <button type="button" class="exp-link" on:click={goToPacks}>Edit packs</button>
                  </span>
                {/if}
                {#if shipRepairLine !== null}
                  <div class="exp-block" role="status">
                    {expeditionDispatchBlockText("shipDamaged")}.
                    <span class="exp-block-counts">{shipRepairLine}.</span>
                  </div>
                {/if}
                {#if gateLine !== null}
                  <!-- G2-4 (D18): the propulsion gate Launch is off for, shown, not only in the hover title. -->
                  <div class="exp-block" role="status">{gateLine}</div>
                {/if}
                {#if needsAwayTeam && teamsView?.blockText}
                  <!-- D18 + GO-12: the ship-level reason Launch is off (not only in a hover title); each team's own wait,
                       with the time left, is in the Ground teams strip. -->
                  <div class="exp-block" role="status">
                    {teamsView.blockText}
                    <span class="exp-block-counts">{teamsView.blockHint}</span>
                  </div>
                {/if}
              </div>
              <button
                type="button"
                class="exp-btn primary exp-launch-btn"
                disabled={(!selectedCandidate && !selectedResume) || !chosenCaptain || needsAwayTeam || shipRepairLine !== null || gateLine !== null}
                title={!chosenCaptain
                  ? expeditionDispatchBlockText("captainNotAssigned")
                  : shipRepairLine !== null
                    ? `${expeditionDispatchBlockText("shipDamaged")}. ${shipRepairLine}`
                  : gateLine !== null
                    ? gateLine
                  : !selectedCandidate && !selectedResume
                    ? expeditionDispatchBlockText("noSuchCandidate")
                    : needsAwayTeam
                      ? teamsView?.blockText ?? expeditionDispatchBlockText("needsAwayTeam")
                      : selectedResume
                        ? "Resume: fly back and pick up where you left off"
                        : selectedCandidate?.telescope.blind
                          ? "Launch blind: asks you to confirm first"
                          : "Launch the expedition"}
                on:click={launch}
              >{#if launchBar.resume}<Icon name="resume" size={14} /> {/if}{launchBar.buttonText}</button>
            </div>

            {#if selectedCandidate && selectedBlock}
              {@const cand = selectedCandidate}
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
                      {#if block.studyChips.length > 0}<StudyChips chips={block.studyChips} label="Ship studies" />{/if}
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
          </div>

          <!-- SETUP RAIL: scanning array, ground teams, anomaly opt-in -->
          <div class="exp-setup">
            <div class="exp-section-tag">Scanning array</div>
            <div class="exp-setup-block">
              {#if chosenArray}
                <div class="exp-array-name">{chosenArray.def.label}</div>
                <div class="exp-array-char">{arrayCharacterLine(chosenArray.def.kind)}</div>
              {:else}
                <div class="exp-array-name dim">No sensor array installed</div>
                <div class="exp-array-char">Scanning runs at the base rate. A sensor array (Ships tab) changes how fast you scan and how much each world turns up, and its sensors see farther.</div>
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
                <span class="exp-team-role">Fights during objectives. Each member runs their own tactical protocols, or the built-in default (no automatic kit use).</span>
              </div>
              <div class="exp-team">
                <span class="exp-team-name">Science<span class="exp-team-str">{chosenAwayTeam ? strengthBand(chosenAwayTeam.scienceStrength) : "-"}</span></span>
                <span class="exp-team-role">Does the objective fieldwork and never fights.</span>
              </div>
              {#if packView}
                <div class="exp-team">
                  <span class="exp-team-name">Field kits<span class="exp-team-str">{packView.summaryText}</span></span>
                  <span class="exp-team-role">Packed per member below; the free set refills every objective.</span>
                </div>
              {:else}
                <div class="exp-team">
                  <span class="exp-team-name">Team kit<span class="exp-team-str">{chosenAwayTeam ? chosenAwayTeam.teamKit : "-"}</span></span>
                  <span class="exp-team-role">Per-battle cure/stim consumables carried by the away team.</span>
                </div>
              {/if}
            </div>
            <div class="exp-note">
              {#if packView}Hire, slot and swap Security and Science members on the ship's Away Team tab; the ship's crew (Security / Science / support) adds strength, and its Medical and Operations crew add to the free set. The teams, their programs and their packs are snapshotted at launch.{:else}Hire, slot and swap Security and Science members on the ship's Away Team tab; the ship's crew (Security / Science / support) adds strength and team kit. The teams and their programs are snapshotted at launch.{/if}
            </div>

            <div class="exp-section-tag">Anomaly chart</div>
            <label class="exp-toggle">
              <input type="checkbox" bind:checked={anomalyOptIn} />
              <span class="exp-toggle-text">
                Chart an anomaly if sensors detect one en route
                <span class="exp-toggle-note">Adds transit time; a charted anomaly brings home a small haul, and better sensors chart one more often.</span>
              </span>
            </label>
          </div>
        </div>
          {/if}
        </div>

        {#if packView && !lockedView}
          <!-- Field Kits FKR-9: PACK PER MEMBER (the signed-off mockup section 1). Pre-filled, so the zero-click path is
               just Launch. One stepper per kit per member; the per-team top-up toggle and the Warehouse stock in the
               side rail. Nothing here blocks Launch. -->
          <section class="fk" id="exp-packs" aria-label="Field kits" tabindex="-1" bind:this={packsEl}>
            <div class="exp-section-tag">Field kits · pack per member</div>
            <div class="fk-free">
              <Icon name="kitFirstAid" size={16} />
              <div>
                <strong>{packView.free.text}</strong> {packView.free.detail}
                <small>{packView.free.note}</small>
              </div>
            </div>
            <div class="fk-cols">
              <div class="fk-main">
                {#each packView.teams as team (team.index)}
                  <div class="fk-team">
                    <div class="fk-team-head">
                      <TeamBadge index={team.index} kind={team.kind} name={team.name} />
                      <div class="fk-team-id">
                        <div class="fk-team-name">{team.name}</div>
                        <div class="fk-team-kind">{team.kindText}</div>
                      </div>
                      <span class="fk-summary"><Icon name="warehouse" size={12} /> {team.summaryText}</span>
                    </div>
                    <div class="fk-members">
                      {#each team.members as m (m.id)}
                        <article class="fk-mem" aria-label={m.name}>
                          <div class="fk-mem-head">
                            <span class="fk-role"><Icon name={m.glyph} size={16} /></span>
                            <div class="fk-mem-id">
                              <div class="fk-mem-name">
                                {m.name}
                                {#if m.medic}<span class="fk-medtag"><Icon name="medBay" size={12} /> Medical Training</span>{/if}
                              </div>
                              <div class="fk-mem-spec">{m.specText}</div>
                              <div class="fk-src">
                                {#if m.source.kind === "edited"}
                                  {@const src = m.source}
                                  <span class="fk-chip edited">Edited</span>
                                  <button type="button" class="fk-link" on:click={() => resetPack(team.index, m.id, src)}>{src.resetLabel}</button>
                                {:else}
                                  <span class="fk-chip">{m.source.text}</span>
                                {/if}
                              </div>
                            </div>
                          </div>
                          <div class="fk-tool">
                            <Icon name={m.tool.glyph} size={16} />
                            <span class="fk-tool-name">{m.tool.name}</span>
                            {#if m.tool.base > 0}
                              <span class="fk-pips" aria-hidden="true">{#each Array(m.tool.base) as _, pi (pi)}<i></i>{/each}{#each Array(m.tool.carry) as _, ci (ci)}<i class="carry"></i>{/each}</span>
                            {/if}
                            {#if m.tool.chargesText}<span>{m.tool.chargesText}</span>{/if}
                            <span class="fk-tool-note">{m.tool.note}</span>
                            {#if m.tool.fuseText}<span class="fk-tool-note">{m.tool.fuseText}</span>{/if}
                          </div>
                          <div class="fk-kits">
                            <div class="fk-kit">
                              <Icon name="kitFirstAid" size={16} />
                              <span class="fk-kit-name">First Aid Kit ×{m.free}<span class="fk-kit-note">Free set, every objective</span></span>
                              <span class="fk-freechip">Included</span>
                            </div>
                            {#each m.kits as k (k.kit)}
                              <div class="fk-kit">
                                <Icon name={k.glyph} size={16} />
                                <span class="fk-kit-name">{k.label}<span class="fk-kit-note" class:short={k.quiet}>{k.note}</span></span>
                                <span class="fk-step" role="group" aria-label="{k.label} extras for {m.name}">
                                  <!-- aria-disabled, not disabled: a button that disables itself at 0 or 9 drops keyboard focus to
                                       the page; this one keeps focus and the press is a no-op (steppedPack clamps). -->
                                  <button type="button" aria-label="One fewer {k.label} for {m.name}" aria-disabled={!k.canLess} on:click={() => k.canLess && stepPack(team.index, m.id, m.pack, k.kit, -1)}>&minus;</button>
                                  <output aria-live="polite">{k.want}</output>
                                  <button type="button" aria-label="One more {k.label} for {m.name}" aria-disabled={!k.canMore} on:click={() => k.canMore && stepPack(team.index, m.id, m.pack, k.kit, 1)}>+</button>
                                </span>
                              </div>
                            {/each}
                          </div>
                          {#if m.noUseText}
                            <div class="fk-nouse"><Icon name="medBay" size={12} /> <span>{m.noUseText}</span></div>
                          {/if}
                        </article>
                      {/each}
                    </div>
                    {#if team.scienceNote}
                      <div class="fk-ghost"><Icon name="research" size={14} /> <span>{team.scienceNote}</span></div>
                    {/if}
                  </div>
                {/each}
                {#each packView.ghosts as g (g.index)}
                  <div class="fk-ghost"><Icon name="team" size={14} /> <span>{g.text}</span></div>
                {/each}
              </div>

              <aside class="fk-side">
                {#each packView.teams as team (team.index)}
                  <div class="fk-panel">
                    <label class="fk-switch">
                      <input
                        type="checkbox"
                        role="switch"
                        checked={team.topUp}
                        on:change={(e) => chosenShip && onSetTeamTopUp(chosenShip.id, team.index, e.currentTarget.checked)}
                      />
                      <span class="fk-track" aria-hidden="true"></span>
                      <span class="fk-sw-text">
                        {#if packView.teams.length > 1}<span class="fk-sw-team">{team.name}</span>{/if}
                        Top up from the Quartermaster at launch
                        <small>{team.topUpNote}</small>
                      </span>
                    </label>
                    <div class="fk-preview" class:on={team.preview.on} aria-live="polite">
                      {team.preview.text}
                      {#if team.preview.costText}<span class="fk-cost"><Icon name="credits" size={12} /> {team.preview.costText}</span>{/if}
                    </div>
                  </div>
                {/each}
                <div class="fk-panel">
                  <div class="exp-section-tag">Warehouse stock</div>
                  <ul class="fk-stock">
                    {#each packView.stock as st (st.kit)}
                      <li><Icon name={st.glyph} size={16} /><span>{st.label}</span><span class="fk-n">{st.text}</span></li>
                    {/each}
                  </ul>
                  <div class="fk-foot">{packView.stockNote}</div>
                </div>
              </aside>
            </div>
          </section>
        {/if}
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

{#if confirmRecall && chosenExpedition}
  <!-- G2-6 (user G13 "One confirm"): the return time, what stops and whether the system stays open, read live from the
       engine's recallPreview. Keep going is the default focus (the safe answer). No paid speed-up (no Overtime). -->
  <ActionModal title={recallView ? recallView.title : "Recall"} onClose={() => (confirmRecall = false)}>
    <div class="exp-recall-confirm">
      {#if recallView}
        <p><Icon name="recall" size={16} /> <strong>{recallView.line}</strong></p>
        <ul>
          {#each recallView.stops as line, li (li)}<li>{line}</li>{/each}
        </ul>
      {:else if recallRefusal}
        <p>{recallRefusal}.</p>
      {/if}
    </div>
    <svelte:fragment slot="footer">
      <button type="button" class="exp-btn" use:focusSafe on:click={() => (confirmRecall = false)}>{recallView ? recallView.keepText : "Close"}</button>
      {#if recallView}
        <button type="button" class="exp-btn primary" on:click={commitRecall}><Icon name="recall" size={14} /> {recallView.recallText}</button>
      {/if}
    </svelte:fragment>
  </ActionModal>
{/if}

{#if abandonCard}
  <!-- G2-6 (user G12 "Until finished" or abandoned): letting a resumable system go asks once. -->
  <ActionModal title={abandonCard.abandonLabel} onClose={() => (abandonId = null)}>
    <p class="exp-abandon-text">{abandonCard.abandonConfirm}</p>
    <svelte:fragment slot="footer">
      <button type="button" class="exp-btn" use:focusSafe on:click={() => (abandonId = null)}>Keep it</button>
      <button type="button" class="exp-btn primary" on:click={commitAbandon}>Abandon</button>
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
  /* GG-6 (v3 mockup): an orbital body's card wears the stronger line; the nebula's is dashed. */
  .exp-body-card.orb {
    border-color: rgba(var(--color-accent-rgb), 0.4);
  }
  .exp-body-card.neb {
    border-style: dashed;
  }
  .exp-body-type {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .exp-body-let {
    font-family: var(--font-display);
    color: var(--color-accent-bright);
  }
  .exp-body-mass {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
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

  /* ===== Field Kits FKR-9 (the signed-off packing mockup). One DOM: the pack screen stacks on a narrow container and
     lays the members beside a 300 px side rail on a wide one (the console's own container query). ===== */
  .fk {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding-top: 12px;
    border-top: 1px solid rgba(var(--color-accent-rgb), 0.14);
  }
  .fk-ready {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    margin-top: 3px;
    font-size: var(--text-xs);
    color: var(--color-success);
  }
  .fk-free {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 9px 11px;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    border-radius: var(--corner);
    background: color-mix(in srgb, var(--color-success) 8%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-success) 30%, transparent);
  }
  .fk-free > :global(svg) {
    color: var(--color-success);
    flex: none;
    margin-top: 1px;
  }
  .fk-free strong {
    color: var(--color-text-primary);
    font-weight: 600;
  }
  .fk-free small {
    display: block;
    margin-top: 2px;
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
  }
  .fk-cols {
    display: grid;
    gap: 12px;
  }
  .fk-main,
  .fk-side {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
  }
  @container (min-width: 769px) {
    .fk-cols {
      grid-template-columns: minmax(0, 1fr) 300px;
      align-items: start;
    }
  }
  .fk-team {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .fk-team-head {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px 10px;
  }
  .fk-team-id {
    min-width: 0;
  }
  .fk-team-name {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--color-text-primary);
  }
  .fk-team-kind {
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
  }
  .fk-summary {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
  }
  .fk-members {
    display: grid;
    gap: 8px;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr));
  }
  .fk-mem {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
    padding: 9px 11px;
    background: rgba(var(--color-accent-rgb), 0.04);
    border: 1px solid rgba(var(--color-accent-rgb), 0.18);
    border-radius: var(--corner);
  }
  .fk-mem-head {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .fk-role {
    flex: none;
    width: 30px;
    height: 30px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    color: var(--color-accent);
    border: 1px solid rgba(var(--color-accent-rgb), 0.4);
  }
  .fk-mem-id {
    min-width: 0;
    flex: 1;
  }
  .fk-mem-name {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 5px;
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--color-text-primary);
  }
  .fk-medtag {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 0 6px;
    font-size: var(--text-2xs);
    font-weight: 500;
    color: var(--color-success);
    border: 1px solid color-mix(in srgb, var(--color-success) 40%, transparent);
    border-radius: 999px;
  }
  .fk-mem-spec {
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
  }
  .fk-src {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 6px;
    margin-top: 3px;
    font-size: var(--text-2xs);
  }
  .fk-chip {
    padding: 1px 7px;
    border-radius: 999px;
    background: rgba(var(--color-accent-rgb), 0.12);
    color: var(--color-accent-bright);
  }
  .fk-chip.edited {
    background: rgba(var(--color-accent-rgb), 0.06);
    color: var(--color-text-secondary);
  }
  .fk-link {
    padding: 4px 2px;
    background: none;
    border: 0;
    color: var(--color-accent);
    font: inherit;
    text-decoration: underline;
    text-underline-offset: 2px;
    cursor: pointer;
  }
  .fk-tool {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 8px;
    padding: 6px 8px;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    background: rgba(var(--color-accent-rgb), 0.06);
    border-radius: var(--corner);
  }
  .fk-tool-name {
    font-weight: 500;
    color: var(--color-text-primary);
  }
  .fk-tool-note {
    width: 100%;
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
  }
  .fk-pips {
    display: inline-flex;
    gap: 3px;
    vertical-align: middle;
  }
  .fk-pips i {
    width: 8px;
    height: 8px;
    border: 1px solid var(--color-accent);
    border-radius: 1px;
    background: var(--color-accent);
  }
  .fk-pips i.carry {
    background: transparent;
    border-style: dashed;
  }
  .fk-pips i.off {
    background: transparent;
    border-color: var(--color-text-dim);
  }
  .fk-kits {
    display: grid;
    gap: 4px;
  }
  .fk-kit {
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    min-height: 32px;
    color: var(--color-accent);
  }
  .fk-kit-name {
    font-size: var(--text-xs);
    color: var(--color-text-primary);
  }
  .fk-kit-note {
    display: block;
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
  }
  .fk-kit-note.short {
    color: var(--color-accent-bright);
  }
  .fk-freechip {
    padding: 1px 7px;
    font-size: var(--text-2xs);
    white-space: nowrap;
    color: var(--color-success);
    border: 1px solid color-mix(in srgb, var(--color-success) 40%, transparent);
    border-radius: 999px;
  }
  .fk-step {
    display: inline-flex;
    align-items: center;
    border: 1px solid rgba(var(--color-accent-rgb), 0.4);
    border-radius: var(--corner);
  }
  .fk-step button {
    width: 32px;
    height: 30px;
    display: grid;
    place-items: center;
    background: none;
    border: 0;
    color: var(--color-accent);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }
  .fk-step button[aria-disabled="true"] {
    color: var(--color-text-dim);
    opacity: 0.5;
    cursor: default;
  }
  .fk-step output {
    min-width: 22px;
    text-align: center;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-primary);
  }
  .fk-nouse {
    display: flex;
    gap: 6px;
    align-items: flex-start;
    padding-top: 6px;
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
    border-top: 1px dashed rgba(var(--color-accent-rgb), 0.2);
  }
  .fk-ghost {
    display: flex;
    gap: 6px;
    align-items: flex-start;
    padding: 9px 11px;
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
    border: 1px dashed rgba(var(--color-accent-rgb), 0.2);
    border-radius: var(--corner);
  }
  .fk-panel {
    padding: 10px 11px;
    background: rgba(var(--color-accent-rgb), 0.05);
    border: 1px solid rgba(var(--color-accent-rgb), 0.14);
    border-radius: var(--corner);
  }
  .fk-switch {
    position: relative;
    display: flex;
    align-items: flex-start;
    gap: 10px;
    cursor: pointer;
  }
  .fk-switch input {
    position: absolute;
    opacity: 0;
    width: 1px;
    height: 1px;
  }
  .fk-track {
    flex: none;
    position: relative;
    width: 34px;
    height: 18px;
    margin-top: 1px;
    border-radius: 999px;
    border: 1px solid rgba(var(--color-accent-rgb), 0.4);
    background: rgba(var(--color-accent-rgb), 0.06);
    transition: background 0.15s;
  }
  .fk-track::after {
    content: "";
    position: absolute;
    top: 2px;
    left: 2px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--color-text-dim);
    transition: transform 0.15s, background 0.15s;
  }
  .fk-switch input:checked + .fk-track {
    background: rgba(var(--color-accent-rgb), 0.35);
  }
  .fk-switch input:checked + .fk-track::after {
    transform: translateX(16px);
    background: var(--color-accent);
  }
  .fk-switch input:focus-visible + .fk-track,
  .fk-step button:focus-visible,
  .fk-link:focus-visible {
    outline: 2px solid var(--color-accent-bright);
    outline-offset: 2px;
  }
  .fk-sw-text {
    font-size: var(--text-xs);
    font-weight: 500;
    color: var(--color-text-primary);
  }
  .fk-sw-team {
    display: block;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--color-accent-bright);
  }
  .fk-sw-text small {
    display: block;
    font-weight: 400;
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
  }
  .fk-preview {
    margin-top: 9px;
    padding: 7px 9px;
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
    border-left: 2px solid rgba(var(--color-accent-rgb), 0.4);
  }
  .fk-preview.on {
    border-left-color: var(--color-accent);
  }
  .fk-cost {
    display: flex;
    align-items: center;
    gap: 5px;
    margin-top: 4px;
    font-family: var(--font-mono);
    color: var(--color-text-primary);
  }
  .fk-stock {
    list-style: none;
    margin: 8px 0 0;
    padding: 0;
    display: grid;
    gap: 4px;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }
  .fk-stock li {
    display: grid;
    grid-template-columns: 18px 1fr auto;
    align-items: center;
    gap: 8px;
  }
  .fk-stock li > :global(svg) {
    color: var(--color-accent);
  }
  .fk-n {
    font-family: var(--font-mono);
  }
  .fk-foot {
    margin-top: 8px;
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
  }

  /* In the run: the card line on the ship picker, the supplies table under the timeline, the claim line. */
  .fk-card {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 10px;
    margin-top: 3px;
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
  }
  .fk-card > span {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .fk-rank {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 7px;
    font-size: var(--text-2xs);
    white-space: nowrap;
    color: var(--color-accent-bright);
    border: 1px solid rgba(var(--color-accent-rgb), 0.35);
    border-radius: 999px;
  }
  .fk-run {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 11px;
    background: rgba(var(--color-accent-rgb), 0.04);
    border: 1px solid rgba(var(--color-accent-rgb), 0.14);
    border-radius: var(--corner);
  }
  .fk-run-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
  }
  .fk-obj {
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--color-text-primary);
  }
  .fk-colhead {
    display: none;
  }
  .fk-rows {
    display: grid;
    gap: 6px;
  }
  .fk-row {
    display: grid;
    grid-template-columns: 1fr;
    gap: 4px;
    padding: 7px 10px;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    background: rgba(var(--color-accent-rgb), 0.03);
    border: 1px solid rgba(var(--color-accent-rgb), 0.14);
    border-radius: var(--corner);
  }
  .fk-who {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    font-weight: 500;
    color: var(--color-text-primary);
  }
  .fk-medmark {
    display: inline-flex;
    color: var(--color-success);
  }
  .fk-cell {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;
    min-width: 0;
  }
  .fk-cell > span {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  .fk-lbl {
    font-size: var(--text-3xs, 10px);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-text-dim);
    margin-right: 4px;
  }
  .fk-free-n {
    color: var(--color-success);
  }
  .fk-dim,
  .fk-bay {
    color: var(--color-text-dim);
  }
  .fk-refresh {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    font-size: var(--text-2xs);
    color: var(--color-text-secondary);
  }
  .fk-refresh > :global(svg) {
    flex: none;
    color: var(--color-success);
  }
  @container (min-width: 769px) {
    .fk-colhead {
      display: grid;
      grid-template-columns: 150px repeat(3, minmax(0, 1fr));
      gap: 10px;
      padding: 0 10px 2px;
      font-size: var(--text-3xs, 10px);
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--color-text-dim);
    }
    .fk-row {
      grid-template-columns: 150px repeat(3, minmax(0, 1fr));
      gap: 10px;
      align-items: center;
    }
    /* The column labels stay for screen readers (the visual column head is aria-hidden): visually hidden, not gone. */
    .fk-lbl {
      position: absolute;
      width: 1px;
      height: 1px;
      margin: -1px;
      padding: 0;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
      border: 0;
    }
  }
  .fk-claim {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 14px;
    padding: 9px 11px;
    font-size: var(--text-xs);
    border: 1px solid rgba(var(--color-accent-rgb), 0.14);
    border-radius: var(--corner);
  }
  .fk-home {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-weight: 500;
    color: var(--color-success);
  }
  .fk-claim-sub {
    width: 100%;
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
  }
  @media (prefers-reduced-motion: reduce) {
    .fk-track,
    .fk-track::after {
      transition: none;
    }
  }

  /* ===== Expedition Tiers G2-6: the dispatch console (the signed-off mockup). One DOM; the container queries split it. */
  .exp-sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  .exp-hdr {
    flex-wrap: wrap;
  }
  .exp-hdr-glyph {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  .exp-hdr-home {
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
  }
  .exp-btn.quiet {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: none;
    color: var(--color-text-secondary);
  }
  .exp-link {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-accent-bright);
    text-decoration: underline;
    font-size: var(--text-xs);
    cursor: pointer;
  }

  /* The region tabs: two across in a narrow container, seven across from 769 px. */
  .exp-tabs {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px;
  }
  .exp-tab {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 2px 8px;
    align-items: center;
    padding: 8px;
    min-width: 0;
    text-align: left;
    color: var(--color-text-secondary);
    background: rgba(var(--color-accent-rgb), 0.04);
    border: 1px solid rgba(var(--color-accent-rgb), 0.16);
    border-radius: var(--corner);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .exp-tab:hover {
    border-color: rgba(var(--color-accent-rgb), 0.4);
  }
  .exp-tab[aria-selected="true"] {
    border-color: var(--color-accent);
    background: rgba(var(--color-accent-rgb), 0.12);
    box-shadow: inset 0 -2px 0 var(--color-accent);
  }
  .exp-tab-num {
    grid-row: span 2;
    display: grid;
    place-items: center;
    min-width: 34px;
    height: 24px;
    padding: 0 4px;
    box-sizing: border-box;
    border: 1px solid var(--color-accent);
    border-radius: 12px;
    color: var(--color-accent-bright);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 700;
  }
  .exp-tab.locked .exp-tab-num {
    border-style: dashed;
    border-color: var(--color-text-dim);
    color: var(--color-text-dim);
  }
  .exp-tab-name {
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--color-text-primary);
    overflow-wrap: anywhere;
  }
  .exp-tab-state {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 3px 4px;
    font-size: var(--text-2xs);
    color: var(--color-success);
    overflow-wrap: anywhere;
  }
  .exp-tab.locked .exp-tab-state {
    color: var(--color-text-secondary);
  }
  .exp-tab-res {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    color: var(--color-accent-bright);
  }
  @container (min-width: 769px) {
    .exp-tabs {
      grid-template-columns: repeat(7, minmax(0, 1fr));
    }
  }

  /* The small region map (the alternative picker). */
  .exp-map-tools {
    display: flex;
    justify-content: flex-end;
  }
  .exp-map {
    max-width: 340px;
    width: 100%;
    margin: 0 auto;
  }
  .exp-map-svg {
    display: block;
    width: 100%;
    height: auto;
  }
  .exp-map-disk {
    fill: rgba(var(--color-accent-rgb), 0.04);
    stroke: rgba(var(--color-accent-rgb), 0.2);
  }
  .exp-map-arm {
    fill: none;
    stroke: var(--color-text-dim);
    stroke-width: 7;
    stroke-linecap: round;
    opacity: 0.24;
  }
  .exp-map-arm.minor {
    stroke-width: 4;
  }
  .exp-map-bulge {
    fill: rgba(var(--color-warning-rgb), 0.18);
  }
  .exp-map-core {
    fill: var(--color-warning);
  }
  .exp-map-ring {
    fill: rgba(var(--color-accent-rgb), 0.08);
    stroke: var(--color-accent);
    stroke-width: 1.4;
  }
  .exp-map-home {
    fill: var(--color-accent);
    stroke: var(--color-bg-deep);
    stroke-width: 1.5;
  }
  .exp-map-badge {
    cursor: pointer;
  }
  .exp-map-badge circle {
    fill: var(--color-bg-deep);
    stroke: var(--color-accent);
    stroke-width: 1.4;
  }
  .exp-map-badge text {
    fill: var(--color-accent-bright);
    font: 700 8.5px var(--font-mono, monospace);
  }
  .exp-map-badge.locked circle {
    stroke: var(--color-text-dim);
    stroke-dasharray: 2.5 2;
  }
  .exp-map-badge.locked text {
    fill: var(--color-text-dim);
  }
  .exp-map-badge.sel circle {
    stroke-width: 3;
  }
  .exp-map-badge:focus-visible {
    outline: none;
  }
  .exp-map-badge:focus-visible circle {
    stroke: var(--color-warning);
    stroke-width: 3;
  }
  .exp-map-label {
    fill: var(--color-text-secondary);
    font: 600 10px system-ui, sans-serif;
    paint-order: stroke;
    stroke: var(--color-bg-deep);
    stroke-width: 3px;
  }
  .exp-map-label.small {
    font-size: 9px;
    fill: var(--color-text-dim);
  }
  .exp-map-legend {
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
    text-align: center;
  }

  /* The tab panel: the tier's facts, then the locked panel or the cards. */
  .exp-tabpanel {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
  }
  .exp-facts {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .exp-facts .exp-chip,
  .exp-target-top .exp-chip {
    white-space: normal;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .exp-training-note {
    font-style: normal;
    font-size: var(--text-xs);
    border-left: 2px solid var(--color-success);
    padding-left: 8px;
  }
  .exp-locked {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
  }
  @container (min-width: 769px) {
    .exp-locked {
      grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
    }
  }
  .exp-locked-gates,
  .exp-locked-peek {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  .exp-locked-head {
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-display);
    font-size: var(--text-sm);
    color: var(--color-text-primary);
  }
  .exp-gatelist,
  .exp-peek {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  .exp-gatelist li {
    display: grid;
    grid-template-columns: 20px minmax(0, 1fr);
    gap: 6px;
    font-size: var(--text-sm);
    color: var(--color-text-primary);
  }
  .exp-gatelist small {
    display: block;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }
  .exp-gatelist-glyph {
    color: var(--color-text-dim);
  }
  .exp-gatelist .met .exp-gatelist-glyph {
    color: var(--color-success);
  }
  .exp-gatelist .unmet .exp-gatelist-glyph {
    color: var(--color-warning);
  }
  .exp-peek li {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 8px;
    border: 1px dashed rgba(var(--color-accent-rgb), 0.22);
    border-radius: var(--corner);
    color: var(--color-text-dim);
    font-size: var(--text-xs);
    min-width: 0;
    overflow-wrap: anywhere;
  }

  /* The candidate and resume cards: a wrapping grid (three across on a wide console, one at 375 px). */
  .exp-cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 210px), 1fr));
    gap: 8px;
  }
  .exp-target {
    min-width: 0;
  }
  .exp-target.resume {
    border-style: dashed;
    border-color: var(--color-accent);
  }
  .exp-resume-wrap {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .exp-resume-foot {
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
  }
  .exp-chip.star,
  .exp-chip.resume {
    background: none;
    border: 1px solid var(--color-accent);
    color: var(--color-accent-bright);
  }
  .exp-chip.enemy {
    background: none;
    border: 1px dashed var(--color-danger);
    color: var(--color-danger);
  }
  .exp-chip.warn {
    background: none;
    border: 1px solid var(--color-warning);
    color: var(--color-warning);
  }
  .exp-rows {
    display: grid;
    grid-template-columns: 76px minmax(0, 1fr);
    gap: 4px 8px;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    min-width: 0;
  }
  .exp-row-k {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--color-text-dim);
  }
  .exp-row-v {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .exp-row-small {
    font-size: var(--text-2xs);
    color: var(--color-text-dim);
  }
  .exp-riskrow {
    flex-direction: row;
    flex-wrap: wrap;
    gap: 2px 8px;
  }
  .exp-riskrow span {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  .exp-riskrow .hi {
    color: var(--color-warning);
    font-weight: 600;
  }
  .exp-gates {
    flex-direction: row;
    flex-wrap: wrap;
    gap: 2px 10px;
  }
  .exp-gates span,
  .exp-met {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  .exp-met {
    color: var(--color-success);
  }
  .exp-unmet {
    color: var(--color-warning);
  }
  /* The reach bar (the mockup's section 4): filled to the round trip's share of the reach; past it, hatched full with
     the reach marked (shape, not only color). */
  .exp-reach {
    position: relative;
    display: block;
    height: 8px;
    margin: 3px 0 2px;
    border: 1px solid rgba(var(--color-accent-rgb), 0.4);
    border-radius: var(--corner);
    background: var(--color-bg-deep);
    overflow: hidden;
  }
  .exp-reach i {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--color-accent);
  }
  .exp-reach.over i {
    background: repeating-linear-gradient(45deg, var(--color-warning) 0 4px, transparent 4px 7px);
  }
  .exp-reach b {
    position: absolute;
    top: -2px;
    bottom: -2px;
    width: 2px;
    background: var(--color-text-primary);
  }
  .exp-target-reason {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    font-size: var(--text-xs);
    color: var(--color-warning);
  }

  /* The launch bar under the candidates. */
  .exp-launchbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 14px;
    padding: 10px;
    border: 1px solid rgba(var(--color-accent-rgb), 0.4);
    border-radius: var(--corner);
    background: rgba(var(--color-accent-rgb), 0.06);
  }
  .exp-launch-sel {
    display: grid;
    gap: 4px;
    min-width: 0;
    flex: 1 1 220px;
    font-size: var(--text-sm);
    color: var(--color-text-primary);
    overflow-wrap: anywhere;
  }
  .exp-launch-kits {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 10px;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }
  .exp-launch-kits span {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .exp-launch-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  /* The recalled stepper, the flying-home line, the claim card and the confirms. */
  .exp-step.cut {
    color: var(--color-text-dim);
    text-decoration: line-through;
  }
  .exp-step.cut .exp-step-dot {
    border-style: dashed;
    background: none;
  }
  .exp-step-link.cut {
    background: repeating-linear-gradient(90deg, rgba(var(--color-accent-rgb), 0.3) 0 3px, transparent 3px 6px);
  }
  .exp-step.recalled {
    color: var(--color-warning);
    font-weight: 600;
    /* "Recalled · home in 12h 30m" wraps inside the stepper at 375 px rather than pushing it sideways. */
    min-width: 0;
  }
  .exp-step.recalled .exp-step-label {
    overflow-wrap: anywhere;
  }
  /* A recalled run's stepper (review fix): every step may shrink and its label wrap, so "Recalled · home in 2d 4h" fits
     a 375 px console without pushing the row sideways. */
  .exp-stepper.recalled .exp-step {
    min-width: 0;
    flex: 0 1 auto;
  }
  .exp-stepper.recalled .exp-step.recalled {
    flex: 1 1 auto;
  }
  .exp-stepper.recalled .exp-step-label {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  /* A resume card on a locked region: dimmed, not selectable (its gate line says why); Abandon stays below it. */
  .exp-target.resume.locked {
    opacity: 0.7;
    cursor: default;
  }
  .exp-target.resume.locked:hover {
    border-color: var(--color-accent);
  }
  .exp-step.recalled .exp-step-dot {
    border-color: var(--color-warning);
    color: var(--color-warning);
  }
  .exp-recalled-note,
  .exp-recall-claim {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }
  .exp-recall-claim {
    padding: 8px 10px;
    border: 1px solid rgba(var(--color-accent-rgb), 0.3);
    border-radius: var(--corner);
  }
  .exp-recall-claim strong {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    color: var(--color-text-primary);
  }
  .exp-recall-confirm p {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    margin: 0 0 6px;
  }
  .exp-recall-confirm ul {
    margin: 6px 0;
    padding-left: 18px;
    font-size: var(--text-sm);
  }
  .exp-abandon-text {
    margin: 0;
  }
</style>
