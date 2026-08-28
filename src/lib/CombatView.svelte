<script lang="ts">
  // ============================================================================
  // CombatView.svelte
  // Author: Claude (Opus 4.8) | 2026-07-27
  //
  // The player-facing "watch the combat" screen, opened from the View Combat Log
  // button on an in-flight patrol (Combat 0.13.0, Phase 12b Unit C). It renders
  // the approved combat-view mockup (docs mockup, sign-off passed): a top bar, a
  // three-column ARENA (player card | range + phase | enemy card) and a scrolling
  // Log-Guided combat log, styled with the shared console theme.
  //
  // DISPLAY ONLY, NO GAME STATE. This component NEVER mutates GameState. It reads
  // a PURE, deterministic replay of the captain's current patrol (replayPatrol,
  // patrolReplay.ts), folds one wave's structured event stream into per-round
  // snapshots (foldWaveSnapshots), and STREAMS those rounds ~1 per second so the
  // arena bars / pips / range / phase advance round by round and the log fills in.
  // Opening or closing the view touches nothing in the game; it is safe to open
  // on any patrol at any time. All the non-trivial "which data" decisions live in
  // the pure, unit-tested helpers in game/combat/combatView.ts.
  //
  // WHICH WAVE IS SHOWN. The live tick loop resolves each wave instantly at its
  // route tick, so there is no true mid-wave moment: the view shows the patrol's
  // CURRENT wave, which is the most-recently-resolved wave (or the first, upcoming
  // wave before any has resolved). See currentReplayWaveIndex. As the live patrol
  // advances to a new wave while the view is open, the stream re-targets to it.
  //
  // MODES. Log-Guided (default) streams the round-by-round text log. Visual mode (Phase
  // 12c) plays the SAME streamed replay as animated damage POPS + family-tinted tracers
  // over the arena ships (see the VISUAL MODE FX DRIVER below). Both are display-only.
  // ============================================================================

  import { onDestroy, onMount, afterUpdate, tick } from "svelte";
  import type { GameState, CaptainState, EquipmentInstance } from "./game/model";
  import { SHIP_TYPES, FACTIONS } from "./game/model";
  import { fittedInSlot } from "./game/equipment";
  // The reusable rarity-bordered equipment card (0.11.0 Phase D). The reactor / ftl
  // system-condition tooltips embed it for the PLAYER ship's installed piece.
  import EquipmentTooltip from "./EquipmentTooltip.svelte";
  import {
    replayPatrol,
    foldWaveSnapshots,
    type PatrolReplay,
    type PatrolReplayWave,
  } from "./game/combat/patrolReplay";
  import { interpolateFlavor } from "./game/combat/flavor";
  import { squadronStatusSummary } from "./game/combat/drones";
  import type { DroneSquadron, DroneRole, SquadronStatusSummary } from "./game/combat/drones";
  import { STATUS_EFFECT_DEFS, effectDefinition } from "./game/combat/statusEffects";
  // Shared PURE viewport-clamp math (prefer-above / flip-below / clamp), the same helper
  // the Ship Systems panel uses. The pip tooltips below render ONE floating wrapper and
  // defer the geometry to this; measuring + await-tick + reflow stay local (see below).
  import { clampFloatingTip } from "./floatingTip";
  import type { CombatEvent, SystemConditionPip } from "./game/combat/types";
  import type { RangeBand, CombatPhase, CombatStance } from "./game/combat/positioning";
  import type { SystemCondition } from "./game/combat/durability";
  import { systemConditionEffect } from "./game/combat/durability";
  import {
    currentReplayWaveIndex,
    buildNameFor,
    rangeMarkerPercent,
    logLineClass,
    dronePips,
    logSpeedToMs,
    targetEnemyId,
    enemyWaveTally,
    simplifiedLogTokens,
    visualBeatsForRound,
    type LogSpeed,
    type SimplifiedToken,
    type VisualBeat,
  } from "./game/combat/combatView";
  // Combat-log DISPLAY preferences (Combat 0.13.0). localStorage-backed, loaded once
  // per open into plain `let` state below (the same idiom App.svelte uses for its
  // options). They drive the log STYLE, damage COLORS, stream SPEED, and AUTO-SCROLL;
  // the panel's own inline controls for these moved to the Options settings screen.
  import {
    loadCombatLogStyle,
    loadCombatDamageColors,
    loadCombatLogSpeed,
    loadCombatAutoScroll,
  } from "./combatLogPreference";

  // --- Props ------------------------------------------------------------------
  // `state` + `captain` are read-only inputs; the replay is regenerated from them
  // (never mutating either). onClose bubbles the close request to the host, which
  // owns the modal open/close state.
  export let state: GameState;
  export let captain: CaptainState;
  export let onClose: () => void;

  // --- Static display label maps ---------------------------------------------
  // Small, self-describing lookups (Omega 9: rule-based, readable at a glance) so
  // the enum values from the sim render as player-facing words.
  const BAND_LABEL: Record<RangeBand, string> = {
    short: "Short",
    medium: "Medium",
    long: "Long",
  };
  const PHASE_LABEL: Record<CombatPhase, string> = {
    detection: "Detection",
    intercept: "Intercept",
    weaponsReady: "Weapons ready",
    firing: "Firing",
  };
  const STANCE_LABEL: Record<CombatStance, string> = {
    aggressive: "Aggressive",
    balanced: "Balanced",
    standoff: "Standoff",
  };

  // ==========================================================================
  // COMBAT-LOG PREFERENCES (Combat 0.13.0). Loaded ONCE at open from localStorage
  // into plain `let` state. The controls that used to live in this panel (log speed,
  // auto-scroll) now live in the Options settings screen; the panel reads the saved
  // choices instead. Loading into plain state (not a reactive `$:` and not a store
  // subscription with side effects) keeps the HARD reactivity contract below intact:
  // these values feed pure derivations + the gated afterUpdate scroll, never a
  // reactive statement that writes the DOM or calls tick(). A change made in Options
  // is picked up the next time this view opens (the component remounts per open).
  // ==========================================================================
  // How long one round of the log lingers before the next is revealed (Fast 1s /
  // Slow 5s). logSpeedToMs is the single source of truth for the mapping (design S16:
  // "streams ~1 round/second live" is the Fast default). The pref values ("fast" /
  // "slow") line up with the LogSpeed type, so the saved choice drives the timer
  // directly. Read once here; the stream reads it via logSpeedToMs on each (re)start.
  let logSpeed: LogSpeed = loadCombatLogSpeed();
  // Log line STYLE: "default" flavor narration vs "simplified" plain damage reporting.
  let combatLogStyle = loadCombatLogStyle();
  // Damage COLORS: tint the Simplified log's shield-damage numbers vs hull-damage
  // numbers (accessibility). Applied at render, only to the tagged number tokens.
  let combatDamageColors = loadCombatDamageColors();
  // AUTO-SCROLL: pin the log to the newest revealed round (gates the afterUpdate hook).
  let combatAutoScroll = loadCombatAutoScroll();

  // ==========================================================================
  // REPLAY (memoized). replayPatrol is a pure, read-only reproduction of the
  // captain's current patrol from its persisted seed. Within one patrol cycle the
  // master seed is invariant, so we recompute ONLY when it changes (rather than on
  // every per-tick `state` reassignment while the modal is open), keeping the view
  // cheap. cachedSeed being null covers "captain not on a patrol".
  // ==========================================================================
  let cachedReplay: PatrolReplay | null = null;
  let cachedSeed: number | null = null;
  function memoReplay(s: GameState, c: CaptainState): PatrolReplay {
    const seed = c.mission !== null && c.mission.kind === "patrol" ? c.mission.masterSeed : null;
    if (cachedReplay !== null && cachedSeed === seed) return cachedReplay;
    cachedSeed = seed;
    cachedReplay = replayPatrol(s, c);
    return cachedReplay;
  }
  // Reactive so the replay recomputes if state/captain change identity; memoReplay
  // still short-circuits to the cached value whenever the seed is unchanged.
  $: replay = memoReplay(state, captain);

  // The live mission's wave pointer + schedule length, for the current-wave pick
  // and the "Wave X / Y" pill. 0-length when not on a patrol (guarded below).
  $: missionNextWaveIndex =
    captain.mission !== null && captain.mission.kind === "patrol"
      ? captain.mission.nextWaveIndex
      : 0;
  $: totalWaves =
    captain.mission !== null && captain.mission.kind === "patrol"
      ? captain.mission.waveTicks.length
      : 0;

  // The LIVE wave index the patrol is currently on (advances / relaunches in the
  // background while this view is open).
  $: waveIdx = replay.available
    ? currentReplayWaveIndex(missionNextWaveIndex, replay.waves.length)
    : null;

  // ==========================================================================
  // WATCHED-WAVE FREEZE (Combat 0.13.0 streaming fix).
  //
  // WHY: the round counter was stuck on "Round 1". The view chased the LIVE patrol,
  // so `wave` (and every derivation off it) swapped whenever the background patrol
  // advanced a wave or relaunched, which RESET the reveal stream back to round 0.
  // At the Slow (5s) log speed that reset beat round 2 every cycle, so the counter
  // never progressed. The fix: FREEZE the battle being watched, play it fully round
  // by round, and advance to a newer battle ONLY once the current one has settled.
  //
  // The live-derived wave (swaps under us) and a stable identity for it, so we can
  // tell a genuinely DIFFERENT battle apart from the per-tick object churn (memoReplay
  // returns a fresh replay object on each `state` reassignment). liveKey is null when
  // there is no identifiable live wave (no seed / no wave), which the capture guards on.
  // ==========================================================================
  $: liveWave =
    replay.available && waveIdx !== null ? (replay.waves[waveIdx] ?? null) : null;
  $: liveKey =
    liveWave !== null && replay.masterSeed !== undefined && waveIdx !== null
      ? `${replay.masterSeed}:${waveIdx}`
      : null;

  // The FROZEN watched battle: plain `let` state, written ONLY by the guarded capture
  // block below (never a live derivation), and held UNCHANGED while it streams so every
  // downstream derivation reads one stable battle from round 1 to round N.
  let watchedWave: PatrolReplayWave | null = null;
  let watchedKey: string | null = null;

  // `wave` is now the FROZEN watched wave (NOT the live one), so ALL the display
  // derivations below (snapshots, nameFor, playerSnap, bars, pips) advance round by
  // round and never rewind when the background patrol moves on.
  $: wave = watchedWave;

  // CAPTURE (FIRST OPEN ONLY). Adopt the live battle as the watched battle the FIRST time
  // there is anything to watch (watchedKey === null). Advancing to LATER battles is handled
  // by advanceWatchedIfReady (below), NOT here.
  //
  // ⚠️ WHY THIS IS SPLIT (and does NOT read `settled`). A single block gated on
  // `settled && liveKey !== watchedKey` (the natural shape) both READS `settled` and WRITES
  // `watchedWave`. `settled` is downstream of `watchedWave` (settled <- maxRound <- snapshots
  // <- wave <- watchedWave), so that block closes a reactive cycle the Svelte 5 compiler
  // REJECTS ("reactive_declaration_cycle"), even though the logic itself converges. The fix
  // is to keep first-open capture free of any `settled` / `maxRound` read, and to do the
  // "advance once finished" completion read INSIDE a plain function (advanceWatchedIfReady),
  // where it is invisible to the compiler's cycle analysis. Runtime behavior is unchanged.
  //
  // Converges: once watchedKey is set non-null, the guard (watchedKey === null) is false on
  // every re-run, so this block writes nothing further. No loop.
  $: {
    if (watchedKey === null && liveWave !== null && liveKey !== null) {
      watchedKey = liveKey;
      watchedWave = liveWave;
    }
  }

  // Seed the fold with the wave's starting combatants so a combatant that is never
  // targeted still renders its opening pools (patrolReplay.ts fold contract).
  $: snapshots = wave ? foldWaveSnapshots(wave.log, [wave.playerStart, ...wave.enemyStart]) : [];
  $: maxRound = snapshots.length > 0 ? snapshots.length - 1 : 0;

  // ==========================================================================
  // STREAMING. Reveal one round of the log per ROUND_MS, advancing the arena to
  // that round's snapshot. The interval is the ONLY timer; it is cleared on
  // completion, on a wave change, on skip-to-end, and on unmount (no leak).
  // ==========================================================================
  let revealedRound = 0; // highest round index currently revealed
  let timer: ReturnType<typeof setInterval> | null = null;
  // Tracks which WATCHED battle the current stream belongs to (its watchedKey). The
  // `undefined` initial sentinel differs from every real key AND from null, so the
  // first reactive run always kicks off a stream.
  let streamKey: string | null | undefined = undefined;

  function stopTimer(): void {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  // Create (or re-create) the reveal interval at the CURRENT speed, revealing one
  // round per tick until the wave's final round. It does NOT reset revealedRound, so
  // it is reused both to start a wave (after revealedRound is zeroed) and to re-cadence
  // an in-flight stream when the speed toggle flips, WITHOUT rewinding. It reads the
  // live maxRound + logSpeed each call, so a later wave-change / speed-change is always
  // current. No-op once already settled (nothing left to reveal).
  function createTimer(): void {
    stopTimer();
    if (revealedRound >= maxRound) return;
    timer = setInterval(() => {
      revealedRound += 1;
      if (revealedRound >= maxRound) {
        stopTimer();
        // The watched battle just finished streaming. If the live patrol advanced past it
        // WHILE it was streaming, switch to the current live battle now (only now that this
        // one has fully played, and only ever FORWARD, so the log never rewinds mid-battle).
        advanceWatchedIfReady();
      }
    }, logSpeedToMs(logSpeed));
  }

  // (Re)start streaming a wave from round 0. A single-round (or empty) wave has
  // nothing to reveal over time, so it settles immediately with no timer.
  function startStream(max: number): void {
    stopTimer();
    revealedRound = 0;
    if (max <= 0) return;
    createTimer();
  }

  // Advance the FROZEN watched battle to the current live battle, but ONLY once the watched
  // battle has fully streamed (revealedRound >= maxRound) AND the live patrol has genuinely
  // moved to a DIFFERENT battle (liveKey !== watchedKey). This is the auto-advance that lets
  // the view roll on to the patrol's newer battle after the current one finishes.
  //
  // ⚠️ It deliberately reads the completion state (revealedRound / maxRound) INSIDE this
  // plain function rather than in a reactive `$:`: a reactive block that referenced maxRound
  // here while writing watchedWave would rebuild the wave -> watchedWave -> snapshots ->
  // maxRound cycle the Svelte compiler rejects. Inside a function those reads are invisible
  // to the compiler's dependency analysis, so the auto-advance stays cycle-free.
  //
  // Converges: after it sets watchedKey = liveKey, any re-run finds liveKey === watchedKey
  // and the guard is false, so it writes nothing more. Capturing here restarts the stream,
  // but the restart does not re-trigger the caller below (which depends only on liveKey,
  // unchanged by the restart), so there is no loop.
  function advanceWatchedIfReady(): void {
    if (
      revealedRound >= maxRound &&
      liveWave !== null &&
      liveKey !== null &&
      liveKey !== watchedKey
    ) {
      watchedKey = liveKey;
      watchedWave = liveWave;
    }
  }

  // Re-run the auto-advance whenever the live patrol moves to a different battle (liveKey
  // changes). If the watched battle is already finished, advanceWatchedIfReady switches to
  // the live one immediately; if it is still streaming, the guard holds until the timer's
  // own completion call (above) fires. This statement depends ONLY on liveKey (never on
  // maxRound / watchedWave), which is exactly what keeps it out of the rejected cycle.
  $: liveKey, advanceWatchedIfReady();

  // STREAM DRIVER. Restart the reveal from round 0 ONLY when the WATCHED battle
  // changes (first-open capture, or advanceWatchedIfReady rolling on to a newer battle
  // once the current one finished). Keyed on watchedKey, NOT the live waveIdx, so a background
  // patrol advance never rewinds the battle currently on screen. Reads maxRound so
  // Svelte orders this AFTER maxRound recomputes for the newly-watched wave.
  //
  // Converges: startStream sets revealedRound = 0 but does NOT change watchedKey, so
  // after this runs streamKey === watchedKey and the guard is false on the immediate
  // re-run. (revealedRound advancing afterward is the async timer, not a reactive write.)
  $: {
    if (watchedKey !== streamKey) {
      streamKey = watchedKey;
      startStream(maxRound);
    }
  }

  // True once the stream has reached the wave's final round (arena + log settled).
  $: settled = revealedRound >= maxRound;

  onDestroy(stopTimer);

  // ==========================================================================
  // DISPLAY DERIVATIONS. All pure reads off the replay + the current snapshot.
  // ==========================================================================
  $: playerName = captain.label;
  // The player ship's class label (e.g. "Battleship"), read the SAME way the
  // patrol card does (assignedCaptainId is the single source of truth).
  $: playerShip = state.ships.find((s) => s.assignedCaptainId === captain.id) ?? null;
  $: shipClassLabel = playerShip ? SHIP_TYPES[playerShip.typeKey].label : "";
  $: faction = replay.factionId ? FACTIONS[replay.factionId] ?? null : null;
  $: stanceLabel = STANCE_LABEL[replay.stance ?? "balanced"];

  // The snapshot at the currently-revealed round (clamped for safety).
  $: snap = snapshots.length > 0 ? snapshots[Math.min(revealedRound, maxRound)] : null;

  // The featured enemy: the first enemy of the wave. Current patrol content fields
  // exactly one enemy per wave (single-enemy waves), matching the single enemy
  // card in the mockup. A future multi-enemy wave surfaces the extras in a compact
  // "additional hostiles" strip below the card rather than faking them away.
  $: enemyFeatured = wave && wave.enemyStart.length > 0 ? wave.enemyStart[0] : null;
  $: extraEnemies = wave ? wave.enemyStart.slice(1) : [];

  $: playerSnap = snap && wave ? snap.combatants[wave.playerStart.id] ?? null : null;
  $: enemySnap = snap && enemyFeatured ? snap.combatants[enemyFeatured.id] ?? null : null;

  // Player bars: prefer the folded snapshot value, falling back to the wave start
  // pool before the first snapshot exists.
  $: playerHull = playerSnap?.hull ?? (wave ? wave.playerStart.hull : 0);
  $: playerHullMax = wave ? wave.playerStart.hullMax : 0;
  $: playerShield = playerSnap?.shield ?? (wave ? wave.playerStart.shield : 0);
  $: playerShieldMax = wave ? wave.playerStart.shieldMax : 0;

  // Reads the FROZEN wave directly (the old `waveIdx !== null` guard was for the live
  // wave; `wave` being non-null is now the validity check, so it cannot go stale).
  $: enemyName = wave && wave.enemyLabels.length > 0 ? wave.enemyLabels[0] : "";
  $: enemyHull = enemySnap?.hull ?? (enemyFeatured ? enemyFeatured.hull : 0);
  $: enemyHullMax = enemyFeatured ? enemyFeatured.hullMax : 0;
  $: enemyShield = enemySnap?.shield ?? (enemyFeatured ? enemyFeatured.shield : 0);
  $: enemyShieldMax = enemyFeatured ? enemyFeatured.shieldMax : 0;

  // Center column: the player's range readout + engagement phase for this round.
  $: rangeBand = playerSnap?.range?.band ?? null;
  $: rangeDistance = playerSnap?.range?.distance ?? null;
  $: phase = playerSnap?.phase ?? null;
  // Marker percent from the real distance; a neutral mid-track default before a
  // roundState readout has been folded.
  $: markerPct = rangeDistance !== null ? rangeMarkerPercent(rangeDistance) : 50;

  // Drone squadrons: the fold does NOT carry per-round drone pip counts (a known
  // limitation documented in patrolReplay.ts), so we read them straight off a wave
  // combatant via squadronStatusSummary: the START squadron while streaming, the
  // END squadron once settled. Carriers field a screen; other hulls field none.
  $: playerDroneSrc = wave ? (settled && wave.playerEnd ? wave.playerEnd : wave.playerStart) : null;
  $: enemyDroneSrc = enemyFeatured
    ? (settled && wave && wave.enemyEnd[0] ? wave.enemyEnd[0] : enemyFeatured)
    : null;

  // The id -> name binder the flavor render step needs (player name + enemy hull
  // labels). Rebuilt per wave.
  $: nameFor = wave
    ? buildNameFor(
        wave.playerStart.id,
        playerName,
        wave.enemyStart.map((c) => c.id),
        wave.enemyLabels,
      )
    : (id: string) => id;

  // The full log grouped by round (every round's flavored lines), computed once
  // per wave; the template renders only rounds up to revealedRound.
  //
  // Each line is a small STRUCTURED token list (SimplifiedToken[]) rather than a raw
  // string, so the template renders it via ordinary Svelte markup (never {@html}): a
  // captain's user-editable name is escaped by Svelte, and the damage-color option can
  // tint ONLY the shield/hull number tokens. Both styles share the same token shape:
  //   - "default"   -> the interpolated flavor line wrapped as one plain text token.
  //   - "simplified"-> the distilled plain-damage tokens (with tagged number runs).
  interface LogLine {
    tokens: SimplifiedToken[];
    cls: string;
  }
  interface LogRound {
    round: number;
    lines: LogLine[];
  }
  function buildLogRounds(
    log: CombatEvent[] | undefined,
    binder: (id: string) => string,
    style: "default" | "simplified",
  ): LogRound[] {
    if (!log) return [];
    // Bucket the flavored events by round in chronological order. Only events that
    // carry a flavor TEMPLATE are narration lines; display-only roundState events
    // (which drive the arena, not the text) carry none and are skipped. Both styles
    // key off this SAME set of events, so switching style never adds or drops a line.
    const byRound = new Map<number, LogLine[]>();
    for (const ev of log) {
      if (ev.flavor === undefined) continue;
      const tokens: SimplifiedToken[] =
        style === "simplified"
          ? simplifiedLogTokens(ev, binder)
          : [{ text: interpolateFlavor(ev.flavor, ev, binder), kind: "text" }];
      const line: LogLine = { tokens, cls: logLineClass(ev) };
      const bucket = byRound.get(ev.round);
      if (bucket) bucket.push(line);
      else byRound.set(ev.round, [line]);
    }
    // Emit in ascending round order.
    const rounds: LogRound[] = [];
    for (const round of [...byRound.keys()].sort((a, b) => a - b)) {
      rounds.push({ round, lines: byRound.get(round)! });
    }
    return rounds;
  }
  // Reactive read of the style pref (a plain value read, NO side effect), so if the
  // pref ever changes while mounted the log rebuilds; normally it is fixed per open.
  $: allLogRounds = buildLogRounds(wave?.log, nameFor, combatLogStyle);
  $: shownRounds = allLogRounds.filter((r) => r.round <= revealedRound);

  // --- Status-effect + system-condition pip presentation ----------------------
  // Rank suffix mirrors flavor.ts (rank 1 renders nothing; 2/3 render II/III).
  function rankSuffix(rank: number): string {
    if (rank <= 1) return "";
    if (rank === 2) return " II";
    if (rank === 3) return " III";
    return ` ${rank}`;
  }
  // A status effect's pip style class, from its def kind (dot -> red DoT pip,
  // debuff -> amber disruption pip, buff -> green buff pip).
  function effectPipClass(defId: string): string {
    const kind = STATUS_EFFECT_DEFS[defId]?.kind;
    if (kind === "dot") return "dot";
    if (kind === "buff") return "buff";
    return "debuff";
  }
  // A short glyph for the pip face: a flame for DoTs, an up-chevron for buffs, and
  // the disruption's initial letter otherwise (matching the mockup's T / C pips).
  function effectPipGlyph(defId: string): string {
    const def = STATUS_EFFECT_DEFS[defId];
    if (def?.kind === "dot") return "\u{1F525}"; // fire
    if (def?.kind === "buff") return "▲"; // up-triangle
    const name = def?.displayName ?? defId;
    return name.charAt(0).toUpperCase();
  }
  function effectPipTitle(defId: string, rank: number): string {
    const def = STATUS_EFFECT_DEFS[defId];
    const name = def?.displayName ?? defId;
    const kindWord = def?.kind === "dot" ? "damage over time" : def?.kind === "buff" ? "buff" : "disruption";
    return `${name}${rankSuffix(rank)} (${kindWord})`;
  }

  // A durable system's pip class is simply its four-state condition.
  const CONDITION_LABEL: Record<SystemCondition, string> = {
    nominal: "Nominal",
    degraded: "Degraded",
    disrupted: "Disrupted",
    offline: "Offline",
  };
  // Build a stable, human label per system pip. Weapons are numbered in the order
  // they appear (Weapon 1, Weapon 2, ...); the reactor + ftl are named directly.
  function systemPipLabels(pips: SystemConditionPip[] | null): { pip: SystemConditionPip; label: string }[] {
    if (!pips) return [];
    let weaponN = 0;
    return pips.map((pip) => {
      let base: string;
      if (pip.kind === "weapon") {
        weaponN += 1;
        base = `Weapon ${weaponN}`;
      } else if (pip.kind === "reactor") {
        base = "Reactor";
      } else {
        base = "FTL";
      }
      return { pip, label: `${base}: ${CONDITION_LABEL[pip.condition]}` };
    });
  }
  $: playerSystemPips = systemPipLabels(playerSnap?.systemConditions ?? null);
  $: enemySystemPips = systemPipLabels(enemySnap?.systemConditions ?? null);

  // ==========================================================================
  // HOVER + PIN PIP TOOLTIPS (Combat 0.13.0). Every pip (status effect, ship-system
  // condition, drone) shows a rich info card with that pip's content: an effect's flavor
  // + mechanical definition, a system's live combat effect (plus the equipment card for
  // the PLAYER's reactor / ftl), or a drone squadron's full stat card.
  //
  // TWO WAYS TO OPEN, one visible card:
  //   - HOVER (desktop, hover-capable pointers only): mouseenter opens the pip's
  //     tooltip, mouseleave closes it again. This is the transient, no-commitment view.
  //   - PIN (click / tap / Enter / Space): togglePip PINS the tooltip open so it stays
  //     through a mouseleave. A pinned pip closes on re-click, on pinning another pip,
  //     or via the outside-click / Escape close. Tap is the ONLY open path on touch
  //     devices (no hover), so pin doubles as the mobile show/hide.
  //
  // FLOATING PRESENTATION (mirrors ShipSystemsPanel's EquipmentTooltip): instead of the
  // old in-flow reveal, ONE fixed-position wrapper (.cv-tip-float below) is rendered for
  // the open pip and its coordinates are computed from the anchor pip's rect + the card's
  // measured size + the viewport (via the shared clampFloatingTip: center, clamp, prefer-
  // above, flip-below). The wrapper is position:fixed, so it escapes the arena / log
  // clipping and stays fully on screen. selectedPipKey is the single "which card is open"
  // key the wrapper reads; tipData carries WHAT to render; tipAnchor is the pip element we
  // measure against; tipLeft / tipTop / tipVisible are the resolved placement.
  //
  // tipPinned records whether the open card was pinned (so hover in/out leaves it alone)
  // versus merely hovered (so mouseleave dismisses it). hoverCapable gates the hover path
  // off on touch so a tap never races a synthetic hover; the pin path is always live.
  //
  // ⚠️ FREEZE-SAFETY (this component hard-froze once on a reactive tick loop). Every var
  // here is a PLAIN `let` written ONLY by the pointer / keydown handlers below, NEVER by a
  // reactive `$:`. The DOM is measured ONLY inside the open handler (openPipTip, after a
  // single awaited tick) and inside reflowPipTip (a scroll / resize listener), never in a
  // `$:`, so nothing here can re-enter Svelte's flush loop. The scroll / resize listeners
  // are the only added listeners and are torn down on destroy (below). A stale key after a
  // wave change simply matches no pip and the wrapper does not render.
  // ==========================================================================
  // The key of the single open pip tooltip, or null when none is open. Keys are built
  // by pipKey() and are unique per side + kind + id, so only one tooltip is ever open.
  let selectedPipKey: string | null = null;
  // True when the visible tooltip was PINNED by a click / tap / keyboard (so hover
  // in/out does not disturb it); false when it is only a transient hover preview.
  let tipPinned = false;

  // WHAT the floating card should render for the open pip. A small discriminated union so
  // the single wrapper can switch on `kind` and dispatch to the matching snippet. Set by
  // the open handlers from data already in the pip's each-block scope (no sim / stream
  // read: pure view state). null when nothing is open.
  type PipTipData =
    | { kind: "effect"; defId: string; rank: number }
    | {
        kind: "system";
        sysKind: "weapon" | "reactor" | "ftl";
        label: string;
        condition: SystemCondition;
        piece: EquipmentInstance | null;
      }
    | { kind: "drone"; squadron: DroneSquadron };
  let tipData: PipTipData | null = null;

  // The pip element the open card is anchored to (measured for placement). Set in the open
  // handler synchronously (before any await), so it never reads a nulled event.currentTarget.
  let tipAnchor: HTMLElement | null = null;
  // The floating wrapper element (bound in the template), measured for its own size.
  let tipFloatEl: HTMLDivElement | undefined;
  // Resolved fixed-position placement + a first-frame invisibility gate (rendered hidden
  // for one frame so it can be MEASURED, then positioned + shown, never flashing at 0,0).
  let tipLeft = 0;
  let tipTop = 0;
  let tipVisible = false;
  // Clamp margins (mirror ShipSystemsPanel): min gap from a viewport edge + gap to the pip.
  const TIP_MARGIN = 8;
  const TIP_GAP = 8;

  // Whether this pointer supports true hover (desktop mouse) vs touch. Gates the hover
  // open/close so a touch tap relies solely on the pin path and never double-fires with a
  // synthetic mouseenter. Guarded for SSR / jsdom (no window / no matchMedia -> false).
  const hoverCapable =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(hover: hover)").matches;

  // Build a stable, unique key for one pip. `scope` distinguishes the player row from
  // each enemy row ("p", "e0", "e1", ...) so the same def id on two ships never collides.
  function pipKey(scope: string, kind: string, id: string): string {
    return `${scope}:${kind}:${id}`;
  }

  // OPEN the floating card for a pip: record which pip + what to render + the anchor, then
  // render invisibly for ONE frame (tipVisible false), await the tick, measure + place +
  // show. The single DOM-measuring path (plus reflowPipTip); kept out of any `$:` so it
  // cannot re-enter the flush loop (freeze-safety). Shared by the hover and pin paths.
  async function openPipTip(key: string, data: PipTipData, anchor: HTMLElement): Promise<void> {
    selectedPipKey = key;
    tipData = data;
    tipAnchor = anchor;
    tipVisible = false;
    await tick();
    positionPipTip();
  }

  // Measure the anchor pip + the (max-height-capped) card and resolve the fixed placement
  // via the shared pure clamp. Reads the DOM but writes only plain lets (no reactive read).
  function positionPipTip(): void {
    if (!tipAnchor || !tipFloatEl) return;
    const { left, top } = clampFloatingTip({
      anchorRect: tipAnchor.getBoundingClientRect(),
      tipWidth: tipFloatEl.offsetWidth,
      tipHeight: tipFloatEl.offsetHeight,
      viewportW: window.innerWidth,
      viewportH: window.innerHeight,
      margin: TIP_MARGIN,
      gap: TIP_GAP,
    });
    tipLeft = left;
    tipTop = top;
    tipVisible = true;
  }

  // Keep the fixed card glued to its pip as the dialog / window scrolls or resizes
  // (capture:true catches the inner scroll, which does not bubble to window). Measures
  // only while a card is open. Registered in onMount, removed in onDestroy (below).
  function reflowPipTip(): void {
    if (selectedPipKey !== null && tipData) positionPipTip();
  }

  // PIN toggle (click / tap / keyboard). Pinning the already-pinned pip closes it;
  // pinning any other pip (or a pip currently only hovered) pins that one instead.
  function togglePip(event: Event, key: string, data: PipTipData): void {
    if (selectedPipKey === key && tipPinned) {
      // Re-activating the pinned pip dismisses it.
      closeTip();
    } else {
      // Pin this pip open (switching the pin off any other pip, and promoting a mere
      // hover of this pip into a committed pin). Read the anchor synchronously here.
      tipPinned = true;
      void openPipTip(key, data, event.currentTarget as HTMLElement);
    }
  }

  // HOVER open (mouseenter). Transient preview: show this pip's tooltip. Skipped on touch
  // pointers (hoverCapable false) and while a pip is PINNED, so hovering elsewhere never
  // steals a pinned panel.
  function onPipEnter(event: Event, key: string, data: PipTipData): void {
    if (!hoverCapable || tipPinned) return;
    void openPipTip(key, data, event.currentTarget as HTMLElement);
  }

  // HOVER close (mouseleave). Clears the transient preview when the pointer leaves the pip
  // that opened it. Skipped on touch and while pinned (a pinned panel survives mouseleave).
  // The selectedPipKey === key guard avoids clobbering a panel that a fast enter->leave on a
  // neighbor already re-pointed at a different pip.
  function onPipLeave(key: string): void {
    if (!hoverCapable || tipPinned) return;
    if (selectedPipKey === key) {
      selectedPipKey = null;
      tipData = null;
      tipVisible = false;
    }
  }

  // Keyboard activation for a pip (it is a role="button" span, so Enter / Space must
  // act like a click). It PINS via togglePip. stopPropagation keeps the key event from
  // also reaching the enclosing mobile row button (which would collapse the row).
  function onPipKeydown(event: KeyboardEvent, key: string, data: PipTipData): void {
    if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      event.stopPropagation();
      togglePip(event, key, data);
    }
  }

  // Close the open tooltip (pin or hover). Bound to a window click (any click NOT on a pip,
  // since pips stopPropagation) and to Escape, so "re-click / click elsewhere / Escape" all
  // dismiss and also drop the pin.
  function closeTip(): void {
    if (selectedPipKey !== null) {
      selectedPipKey = null;
      tipPinned = false;
      tipData = null;
      tipVisible = false;
    }
  }
  function onWindowKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    // Escape ownership. When a pip tooltip is pinned/open, Escape's job is to dismiss
    // JUST that tooltip, not the whole Combat View. This listener runs in the CAPTURE
    // phase (see the |capture modifier on svelte:window below), so it sees Escape BEFORE
    // the modal-backdrop's focusTrap does. Stopping propagation here (only while a tip is
    // actually open) keeps that trap from ALSO firing closeCombatView on the same
    // keypress. A plain bubble-phase stopPropagation could not do this: the focusTrap
    // lives on the modal-backdrop, a DESCENDANT of window, so in the bubble phase it
    // fires first and the view is already closing before a window handler runs. When no
    // tooltip is open there is nothing to consume, so Escape falls through to the trap
    // and closes the view as before.
    if (selectedPipKey === null) return;
    event.preventDefault();
    event.stopPropagation();
    closeTip();
  }

  // Reflow the floating pip card on scroll (capture) + resize while it is open, and tear
  // the listeners down on destroy (the only listeners this tooltip layer adds).
  onMount(() => {
    window.addEventListener("scroll", reflowPipTip, true);
    window.addEventListener("resize", reflowPipTip);
  });
  onDestroy(() => {
    window.removeEventListener("scroll", reflowPipTip, true);
    window.removeEventListener("resize", reflowPipTip);
  });

  // ==========================================================================
  // DRONE SQUADRON CARD helpers (the floating drone tooltip). All PURE, reading only the
  // squadron's REAL fields (drones.ts): no shield, no debuff list exist on the model, so
  // the card shows the squadron's actual kit (status / hull / offense / defense) instead
  // of inventing those. See the droneCard snippet + the mockup for the layout.
  // ==========================================================================
  // Role display name + accent color (matches the Ship Systems DRONES readout: attack
  // danger / defense accent / support success), driving the card's badge + top border.
  function droneRoleName(role: DroneRole): string {
    if (role === "attack") return "Attack";
    if (role === "defense") return "Defense";
    return "Support";
  }
  function droneRoleColor(role: DroneRole): string {
    if (role === "attack") return "var(--color-danger)";
    if (role === "defense") return "var(--color-accent-bright)";
    return "var(--color-success)";
  }
  // Auto-assigned behavior mode display name (drones.ts DroneMode).
  function droneModeName(mode: string): string {
    if (mode === "assault") return "Assault";
    if (mode === "guard") return "Guard";
    if (mode === "utility") return "Utility";
    return mode;
  }
  // A static, factual one-line descriptor of each role's documented combat identity
  // (drones.ts S8: attack closes to strike, defense deflects / reflects, support repairs /
  // replenishes). A UI label keyed by the real `role` field, like CONDITION_LABEL, NOT a
  // data field invented on the squadron.
  const DRONE_ROLE_FLAVOR: Record<DroneRole, string> = {
    attack: "Fast strike drones that swarm the nearest threat.",
    defense: "Guardian drones that deflect and reflect fire aimed at the carrier.",
    support: "Utility drones that repair the carrier hull and replenish the screen.",
  };
  // Fire rate label from the firing cooldown (deci-seconds -> seconds, one decimal), e.g.
  // 20 deci-sec -> "2.0". Shown as "1 / <secs>s" (one volley per cooldown period).
  function droneFireRate(deciSec: number): string {
    return (deciSec / 10).toFixed(1);
  }
  // The per-status "condition" split for the card (e.g. "3 online, 1 disrupted"), built
  // from the same summary the pips use. Today squadronStatusSummary folds every drone into
  // online / disrupted / refabricating, so those three always sum to total and `destroyed`
  // computes to 0: the "N destroyed" chip is LATENT, kept for a future separate destroyed
  // state (a killed drone currently folds into refabricating). Empty -> a single "none".
  function squadronConditionParts(summary: SquadronStatusSummary): { txt: string; cls: string }[] {
    const destroyed = Math.max(
      0,
      summary.total - summary.online - summary.disrupted - summary.refabricating,
    );
    const parts: { txt: string; cls: string }[] = [];
    if (summary.online > 0) parts.push({ txt: `${summary.online} online`, cls: "cv-ok" });
    if (summary.disrupted > 0) parts.push({ txt: `${summary.disrupted} disrupted`, cls: "cv-warn" });
    if (summary.refabricating > 0)
      parts.push({ txt: `${summary.refabricating} refabricating`, cls: "cv-dim" });
    if (destroyed > 0) parts.push({ txt: `${destroyed} destroyed`, cls: "cv-dim" });
    if (parts.length === 0) parts.push({ txt: "none", cls: "cv-dim" });
    return parts;
  }
  // Forward-compat typed-optional view of a squadron: defensive-drone SHIELDS are a
  // PLANNED addition (design S8 defense identity) that the model does not carry yet. The
  // card reads `shield` through this cast so the Shield row compiles today (undefined ->
  // not rendered) and appears with ZERO rework the day the real field lands.
  type SquadronMaybeShield = DroneSquadron & { shield?: number };

  // The PLAYER ship's installed reactor + ftl pieces, resolved off the equipment pool
  // by slot (fittedInSlot is a pure filter). The reactor / ftl system-condition tooltips
  // embed the EquipmentTooltip card for these; null (no piece installed, e.g. a bridged
  // enemy or a hand-edited save) falls back to the condition-effect line only. Pure reads
  // with NO side effect, so they are reactivity-safe.
  $: playerReactorPiece = playerShip ? fittedInSlot(state, playerShip.id, "reactorCore") : null;
  $: playerFtlPiece = playerShip ? fittedInSlot(state, playerShip.id, "ftlDrive") : null;

  // The equipment piece to embed for a PLAYER system pip: the reactor / ftl installed
  // piece, or null for weapons (no installable gear yet) and any non-player pip. Weapons
  // and enemy systems therefore show the condition-effect sentence ONLY.
  function equipPieceForSystemPip(
    isPlayer: boolean,
    kind: "weapon" | "reactor" | "ftl",
  ): EquipmentInstance | null {
    if (!isPlayer) return null;
    if (kind === "reactor") return playerReactorPiece;
    if (kind === "ftl") return playerFtlPiece;
    return null;
  }

  // ==========================================================================
  // MOBILE ROSTER DERIVATIONS (narrow-screen layout). The mobile block renders a
  // compact row PER enemy (the desktop arena features only the first + lists the
  // rest), so it needs the whole wave's enemy list plus two pure roll-ups: which
  // living enemy the sim is focus-firing (the TARGET marker) and the living/down
  // split for the "Enemy Wave (N) / K down" header. Both read the SAME snapshot the
  // arena does, so the two layouts never diverge. All pure (combatView.ts helpers).
  // ==========================================================================
  $: waveEnemies = wave ? wave.enemyStart : [];
  $: currentTargetId = wave ? targetEnemyId(wave.enemyStart, snap) : null;
  $: waveTally = wave ? enemyWaveTally(wave.enemyStart, snap) : { living: 0, down: 0 };
  // The player row's stable id, so the tap-expand toggle can key the player row the
  // same way it keys each enemy row (by combatant id).
  $: playerRowId = wave ? wave.playerStart.id : "player";

  // Tap-to-expand state for the mobile roster: the id of the single expanded row, or
  // null when all rows are collapsed. PLAIN state toggled ONLY by the row click
  // handler below, never a reactive side effect (HARD reactivity contract: a $: with
  // a side effect in this perpetually-recomputing component risks the flush loop that
  // once froze the tab). A stale id after a wave change simply matches no row and the
  // row shows collapsed, so no reset side effect is needed.
  let expandedId: string | null = null;
  function toggleExpanded(id: string): void {
    expandedId = expandedId === id ? null : id;
  }
  // The drone source for one enemy row's expanded detail: the END squadron once the
  // wave has settled, else the START squadron (mirrors the desktop enemyDroneSrc rule,
  // per enemy). Pure lookup, safe to call from markup.
  function enemyDroneSource(index: number) {
    if (!wave) return null;
    const end = settled ? wave.enemyEnd[index] : undefined;
    return end ?? wave.enemyStart[index] ?? null;
  }

  // --- Bar width helpers ------------------------------------------------------
  // Percentage width for a bar, clamped 0..100 and guarded against a 0 max.
  function pct(value: number, max: number): number {
    if (max <= 0) return 0;
    const p = (value / max) * 100;
    return p < 0 ? 0 : p > 100 ? 100 : p;
  }
  // Round a pool value for the "X / Y" readout (hull/shield are integers in the
  // sim, but a defensive round keeps the readout clean if one ever carries a float).
  function num(v: number): string {
    return String(Math.round(v));
  }

  // --- Mode toggle ------------------------------------------------------------
  // Log-Guided is the built default; Visual (Phase 12c) plays animated damage POPS
  // over the shared arena ships instead of the scrolling text log (see the FX driver
  // + overlay below). Both modes read the SAME streamed replay; Visual is display-only.
  let mode: "log" | "visual" = "log";

  // The most-recently-revealed round's log lines, for the calm "recent events" caption
  // under the Visual arena (fills the space the text log occupies in Log-Guided, so the
  // locked dialog height does not bounce between modes). Pure read of the already-derived
  // shownRounds; no side effect.
  $: latestVisualRound = shownRounds.length > 0 ? shownRounds[shownRounds.length - 1] : null;

  // --- Auto-scroll the log to the newest revealed round -----------------------
  // afterUpdate runs AFTER the DOM reflects each update, so pinning the log to the
  // bottom here needs no tick() and, crucially, creates NO reactive dependency.
  // The previous version was a reactive `$:` that called tick(): in this component
  // the display derivations (memoReplay / foldWaveSnapshots / buildNameFor) return
  // FRESH objects every flush, so the component is perpetually "dirty", and a
  // reactive tick() drove Svelte's flush-until-stable into a synchronous infinite
  // loop the instant the streamed round advanced (revealedRound was the trigger),
  // hard-freezing the tab. A lifecycle hook cannot re-enter reactivity, so it
  // cannot loop.
  // Gated on the combatAutoScroll pref (Combat 0.13.0): when the player turns
  // auto-scroll off in Options, the log holds position instead of being pinned to the
  // newest round, so they can read back without being yanked to the bottom. Still a
  // lifecycle hook (never a reactive statement), so it cannot re-enter the flush loop.
  let logBody: HTMLDivElement | null = null;
  afterUpdate(() => {
    if (mode === "log" && combatAutoScroll && logBody) logBody.scrollTop = logBody.scrollHeight;
  });

  // ==========================================================================
  // VISUAL MODE FX DRIVER (Combat 0.13.0, Phase 12c). Animated damage-number pops +
  // family-tinted tracers over the arena ships, driven off the SAME streamed replay
  // the log uses. Display-only: it reads state and writes DOM, never the sim.
  //
  // ⚠️ FREEZE-SAFETY (a reactive-tick loop hard-froze this component once). ALL the
  // pop/tracer DOM work is driven IMPERATIVELY from the afterUpdate lifecycle hook
  // below, exactly like the auto-scroll hook above. There is NO reactive `$:` that
  // writes the DOM, measures an element, or schedules a beat, and NOTHING here calls
  // tick(). The driver's bookkeeping (lastVisualizedRound / lastVisualKey / visualActive
  // + the timer/handle/dimmed arrays) is plain state used ONLY inside this hook and its
  // helper functions, never referenced by the template or a `$:`. Because Svelte only
  // makes a variable reactive when the template or a reactive statement reads it, these
  // assignments do NOT invalidate the component, so the hook cannot re-enter the flush
  // loop that a reactive tick() once drove into an infinite synchronous freeze.
  //
  // WHY POPS ARE NEUTRAL WITH RED EXCEPTIONS. The approved design reserves color for the
  // exceptional: a normal hit pops in the neutral text color, and ONLY a crit or a kill
  // ("destroyed") renders red (a crit also slightly larger). Damage TYPE (shield vs hull)
  // is deliberately NOT color-coded here (the Simplified log already conveys it); pop
  // color means "something notable happened", not "which pool was hit".
  // ==========================================================================
  // Tracer tint per weapon family (design P12c). particle green, kinetic grey, ew (and
  // any family not listed, the "thermal/other" bucket) warm orange. Mirrors the swatch
  // colors in the Visual legend markup below.
  const TRACER_TINT: Record<string, string> = {
    particle: "#1D9E75",
    kinetic: "#888780",
    ew: "#D85A30",
  };
  const TRACER_TINT_DEFAULT = "#D85A30"; // drones + any unmapped/absent family
  function tracerColor(beat: VisualBeat): string {
    if (beat.family !== undefined && TRACER_TINT[beat.family] !== undefined) {
      return TRACER_TINT[beat.family];
    }
    return TRACER_TINT_DEFAULT;
  }

  // Beat timing (ms). Beats within a round are STAGGERED so a busy round reads clearly,
  // while staying well inside the 1s Fast round cadence. The tracer travels first, then
  // the pop lands and floats up + fades.
  const BEAT_STAGGER_MS = 180; // gap between successive beats in one round
  const TRACER_MS = 220; // tracer travel time (matches the CSS transition)
  const POP_MS = 850; // pop float + fade lifetime (matches the CSS transition)
  const POP_STATIC_MS = 700; // reduced-motion pop lifetime (appears, then clears)

  // Bound element handles (bind:this in the markup). dialogEl is the positioning frame
  // (a pop/tracer position = target rect minus dialog rect); fxLayer is the absolutely
  // positioned overlay the pops/tracers are appended into.
  let dialogEl: HTMLDivElement | null = null;
  let fxLayer: HTMLDivElement | null = null;

  // Freeze-safe bookkeeping (plain, NON-reactive: read/written only here). lastVisualizedRound
  // is the highest round already played; lastVisualKey is the watched battle those pops belong
  // to; visualActive tracks whether the last hook run was in visual mode (so we can detect
  // switching INTO visual and re-sync instead of retro-playing the backlog).
  let lastVisualizedRound = -1;
  let lastVisualKey: string | null | undefined = undefined;
  let visualActive = false;
  // Every pending setTimeout, rAF handle, and imperatively-dimmed ship card, so the leak
  // hunt stays clean: all are torn down on leaving visual mode and on destroy.
  let popTimers: ReturnType<typeof setTimeout>[] = [];
  let rafHandles: number[] = [];
  let dimmedEls: HTMLElement[] = [];

  // prefers-reduced-motion: skip the moving tracer + the float animation (the pop just
  // appears briefly then clears), so the presentation stays accessible.
  function prefersReducedMotion(): boolean {
    return (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  // Find the VISIBLE element for a combatant id. The desktop arena and the mobile roster
  // both carry data-cid anchors but only ONE layout is shown (the other is display:none),
  // so we pick the anchor whose offsetParent is non-null (the laid-out one). Compares the
  // attribute value directly (no CSS selector) so an id with odd characters cannot break
  // the query. Returns null when nothing visible matches (the caller then SKIPS that beat).
  function visibleElementFor(cid: string): HTMLElement | null {
    if (dialogEl === null) return null;
    const nodes = dialogEl.querySelectorAll<HTMLElement>("[data-cid]");
    for (const node of nodes) {
      if (node.getAttribute("data-cid") === cid && node.offsetParent !== null) return node;
    }
    return null;
  }

  // The top-center anchor point of an element, in fxLayer coordinates: the element's
  // client rect minus the FX layer's client rect (the pops/tracers are children of the FX
  // layer, so its box is their coordinate origin). Used for both the pop position and the
  // tracer endpoints, so a pop overlays the right ship in EITHER layout.
  function anchorPoint(el: HTMLElement, frameRect: DOMRect): { x: number; y: number } {
    const r = el.getBoundingClientRect();
    return {
      x: r.left - frameRect.left + r.width / 2,
      // A little below the card top so the pop sits over the ship, not its label.
      y: r.top - frameRect.top + Math.min(r.height * 0.35, 54),
    };
  }

  // Create one damage pop at (x, y). Neutral by default; red for a crit or a kill (color
  // reserved for the exceptional). Under reduced motion it appears then clears with no
  // float; otherwise it floats up + fades via the CSS transition, triggered on the next
  // frame so the transition actually runs from the base state.
  function spawnPop(beat: VisualBeat, x: number, y: number, reduced: boolean): void {
    if (fxLayer === null) return;
    const el = document.createElement("div");
    el.className = "cv-pop";
    if (beat.kind === "destroyed") {
      el.classList.add("kill");
      el.textContent = "destroyed";
    } else if (beat.kind === "evade") {
      el.classList.add("evade");
      el.textContent = "evade";
    } else {
      const amount = beat.amount ?? 0;
      if (beat.crit) {
        el.classList.add("crit");
        el.textContent = `crit -${amount}`;
      } else {
        el.textContent = `-${amount}`;
      }
    }
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    fxLayer.appendChild(el);

    if (reduced) {
      // No float: show the static pop, then remove it.
      popTimers.push(setTimeout(() => el.remove(), POP_STATIC_MS));
      return;
    }
    // Force a synchronous style/layout flush so the browser COMMITS the pop's initial
    // opacity:1 (from .cv-pop) before we add `.rise` on the next frame. Without this, the
    // append and the rAF class-add coalesce before the first paint, so the opacity
    // transition has no prior value to animate from and the pop jumps straight to opacity 0
    // (invisible) instead of fading in view. (The tracer survives the same coalescing
    // because it stays a visible dot at its destination even with its travel skipped; a pop
    // that jumps to opacity 0 does not.) Reading offsetWidth is the standard reflow trigger.
    void el.offsetWidth;
    // Trigger the rise+fade on the next frame (so the transition runs), then remove.
    rafHandles.push(
      requestAnimationFrame(() => {
        el.classList.add("rise");
      }),
    );
    popTimers.push(setTimeout(() => el.remove(), POP_MS));
  }

  // Create one family-tinted tracer dot that travels from (x0, y0) to (x1, y1). The CSS
  // holds the transition; setting the destination on the next frame runs the travel.
  function spawnTracer(x0: number, y0: number, x1: number, y1: number, color: string): void {
    if (fxLayer === null) return;
    const dot = document.createElement("div");
    dot.className = "cv-tracer";
    dot.style.background = color;
    dot.style.color = color; // drives the glow (box-shadow uses currentColor)
    dot.style.left = `${x0}px`;
    dot.style.top = `${y0}px`;
    fxLayer.appendChild(dot);
    // Commit the start position before moving it, so the travel transition actually runs
    // (same reflow trigger + reason as spawnPop; without it the dot jumps to its endpoint).
    void dot.offsetWidth;
    rafHandles.push(
      requestAnimationFrame(() => {
        dot.style.left = `${x1}px`;
        dot.style.top = `${y1}px`;
      }),
    );
    popTimers.push(setTimeout(() => dot.remove(), TRACER_MS + 60));
  }

  // Dim a destroyed ship's card (imperative class on the Svelte-managed element). Svelte's
  // class directives only touch the specific classes they manage, so this extra class
  // survives re-renders; it is cleared on every FX teardown so a reused DOM node never
  // stays dimmed into a later battle.
  function dimShip(el: HTMLElement): void {
    if (el.classList.contains("cv-dimmed")) return;
    el.classList.add("cv-dimmed");
    dimmedEls.push(el);
  }

  // Play ONE beat: the tracer (only when the beat has an actor AND motion is allowed),
  // then the pop over the target. A beat whose target is not currently visible is SKIPPED
  // (never throws). A destroyed beat also dims the target card.
  function playBeat(beat: VisualBeat, reduced: boolean): void {
    if (dialogEl === null || fxLayer === null) return;
    const targetEl = visibleElementFor(beat.toId);
    if (targetEl === null) return; // not laid out in the current layout: skip quietly
    const frameRect = fxLayer.getBoundingClientRect();
    const to = anchorPoint(targetEl, frameRect);

    // Tracer first, if there is an attacker and motion is allowed. The tracer leads the
    // pop by its travel time so the number lands as the shot arrives.
    let popDelay = 0;
    if (!reduced && beat.fromId !== undefined) {
      const fromEl = visibleElementFor(beat.fromId);
      if (fromEl !== null) {
        const from = anchorPoint(fromEl, frameRect);
        spawnTracer(from.x, from.y, to.x, to.y, tracerColor(beat));
        popDelay = TRACER_MS;
      }
    }

    if (beat.kind === "destroyed") dimShip(targetEl);

    if (popDelay > 0) {
      popTimers.push(setTimeout(() => spawnPop(beat, to.x, to.y, reduced), popDelay));
    } else {
      spawnPop(beat, to.x, to.y, reduced);
    }
  }

  // Play every beat of a round, staggered so a busy round reads clearly. Reads the pure
  // visualBeatsForRound mapping off the frozen wave's log (the SAME events the text log
  // reads), so the pops and the log can never disagree about what happened.
  function playRound(round: number): void {
    if (wave === null) return;
    const beats = visualBeatsForRound(wave.log, round);
    if (beats.length === 0) return;
    const reduced = prefersReducedMotion();
    let i = 0;
    for (const beat of beats) {
      const delay = i * BEAT_STAGGER_MS;
      if (delay === 0) {
        playBeat(beat, reduced);
      } else {
        popTimers.push(setTimeout(() => playBeat(beat, reduced), delay));
      }
      i += 1;
    }
  }

  // Tear down all pending FX: cancel every scheduled beat/removal timer + rAF, empty the
  // overlay, and un-dim any dimmed cards. Called on leaving visual mode, on a battle change,
  // and on destroy, so no timer or DOM node leaks.
  function clearVisualFx(): void {
    for (const t of popTimers) clearTimeout(t);
    popTimers = [];
    for (const h of rafHandles) cancelAnimationFrame(h);
    rafHandles = [];
    if (fxLayer !== null) fxLayer.replaceChildren();
    for (const el of dimmedEls) el.classList.remove("cv-dimmed");
    dimmedEls = [];
  }

  // THE DRIVER. A sibling of the auto-scroll hook: a lifecycle afterUpdate (never a `$:`),
  // so it reads settled DOM and cannot re-enter reactivity. On each run:
  //   - Not in visual mode: if we just LEFT visual, tear down pending FX once, then idle.
  //   - Entering visual (first time or re-entered) OR the watched battle changed: RE-SYNC
  //     the cursor to the CURRENT revealedRound (and clear stale FX) so entering mid-stream
  //     pops only NEWLY revealed rounds, never the whole backlog at once.
  //   - Otherwise: play each round newly revealed since last time (lastVisualizedRound+1 ..
  //     revealedRound), then advance the cursor.
  afterUpdate(() => {
    if (mode !== "visual") {
      if (visualActive) {
        visualActive = false;
        clearVisualFx();
      }
      return;
    }
    if (!visualActive || watchedKey !== lastVisualKey) {
      // Just entered visual, or the frozen battle rolled over. Clear stale FX + re-sync the
      // cursor, then FALL THROUGH to the play block so a fresh battle's opener still shows.
      const freshBattle = watchedKey !== lastVisualKey;
      visualActive = true;
      lastVisualKey = watchedKey;
      clearVisualFx();
      // Fresh battle: start the cursor one BEFORE the current round so the OPENING salvo
      // (round 0, on a battle watched from its start) pops instead of being skipped. Re-
      // entering visual on the SAME battle mid-stream: sync to the current round so the
      // already-seen backlog is not re-popped all at once.
      lastVisualizedRound = freshBattle ? revealedRound - 1 : revealedRound;
    }
    if (revealedRound > lastVisualizedRound) {
      for (let r = lastVisualizedRound + 1; r <= revealedRound; r++) playRound(r);
      lastVisualizedRound = revealedRound;
    }
  });

  // Tear down any pending FX timers/nodes on unmount (the streaming timer is stopped by the
  // existing onDestroy(stopTimer) above; this is the FX-layer counterpart).
  onDestroy(clearVisualFx);
</script>

<!-- Window-level dismiss for the pip tooltips: Escape closes the open tooltip, and any
     click that is NOT on a pip (pips stopPropagation) also closes it ("re-click / click
     elsewhere / Escape all dismiss"). Both are plain event handlers, never reactive, so
     they cannot re-enter the flush loop (freeze-safety). -->
<svelte:window on:keydown|capture={onWindowKeydown} on:click={closeTip} />

<!-- ==========================================================================
     PIP TOOLTIP SNIPPETS (Combat 0.13.0). One reusable card per pip kind. Defined once
     and {@render}ed from the SINGLE floating wrapper (.cv-tip-float, near the end of the
     dialog) based on the open pip's tipData, so every pip location (desktop arena + mobile
     roster, player + enemy) shares ONE card renderer and the content lives in one place.
     The cards carry no interactive controls, so a click anywhere inside one bubbles to the
     window dismiss handler and simply closes it. All display-only.
     ========================================================================== -->
{#snippet effectTip(defId: string, rank: number)}
  <div class="cv-tip" role="status">
    <div class="cv-tip-hd">
      <span class="pip {effectPipClass(defId)}">{effectPipGlyph(defId)}</span>
      <span class="cv-tip-title">{effectPipTitle(defId, rank)}</span>
    </div>
    {#if STATUS_EFFECT_DEFS[defId]?.flavor}
      <div class="cv-tip-flavor">{STATUS_EFFECT_DEFS[defId].flavor}</div>
    {/if}
    {#if effectDefinition(defId, rank)}
      <div class="cv-tip-def">{effectDefinition(defId, rank)}</div>
    {/if}
  </div>
{/snippet}

{#snippet systemTip(
  kind: "weapon" | "reactor" | "ftl",
  label: string,
  condition: SystemCondition,
  piece: EquipmentInstance | null,
)}
  <div class="cv-tip" role="status">
    <div class="cv-tip-hd">
      <span class="pip {condition}"></span>
      <span class="cv-tip-title">{label}</span>
    </div>
    <div class="cv-tip-def">{systemConditionEffect(kind, condition)}</div>
    {#if piece}
      <!-- The player's installed reactor / ftl gear card (weapons + enemy systems pass
           null, so they show the condition effect only). -->
      <div class="cv-tip-card"><EquipmentTooltip {piece} /></div>
    {/if}
  </div>
{/snippet}

<!-- DRONE SQUADRON CARD. A custom stat card per squadron (the mockup's hero), showing only
     REAL squadron fields: identity (model / role / mode), Status (alive + per-status split
     + per-drone hull), Offense (damage / accuracy / fire rate), an alternate Support block
     for support squadrons (hull repair + replenish), and Defense (intercept / reflect /
     evasion, plus smart-reflect for defense). The role tints the badge + top border. -->
{#snippet droneCard(squadron: DroneSquadron)}
  {@const summary = squadronStatusSummary(squadron)}
  {@const parts = squadronConditionParts(summary)}
  {@const offensive = squadron.yieldMin > 0 || squadron.yieldMax > 0}
  {@const maybeShield = (squadron as SquadronMaybeShield).shield}
  <div class="cv-tip cv-dcard" role="status" style="--cv-role: {droneRoleColor(squadron.role)}">
    <div class="cv-tip-hd">
      <span class="cv-tip-title">{squadron.model} Squadron</span>
      <span class="cv-tip-badge">{droneRoleName(squadron.role)}</span>
    </div>
    <div class="cv-tip-sub">{droneRoleName(squadron.role)} drones &middot; {droneModeName(squadron.mode)} mode</div>
    <div class="cv-tip-flavor">{DRONE_ROLE_FLAVOR[squadron.role]}</div>

    <div class="cv-tip-sec">Status</div>
    <div class="cv-tip-row"><span class="k">Squadron</span><span class="v">{summary.alive} alive of {summary.total}</span></div>
    <div class="cv-tip-row"><span class="k">Condition</span><span class="v">{#each parts as p, i}{#if i > 0}, {/if}<span class={p.cls}>{p.txt}</span>{/each}</span></div>
    <div class="cv-tip-row"><span class="k">Hull (per drone)</span><span class="v">{squadron.droneHp}</span></div>

    {#if offensive}
      <div class="cv-tip-sec">Offense</div>
      <div class="cv-tip-row"><span class="k">Damage</span><span class="v">{squadron.yieldMin}-{squadron.yieldMax}</span></div>
      <div class="cv-tip-row"><span class="k">Accuracy</span><span class="v">{squadron.accuracy}%</span></div>
      <div class="cv-tip-row"><span class="k">Fire rate</span><span class="v">1 / {droneFireRate(squadron.attackCooldownDeciSec)}s</span></div>
    {/if}

    {#if squadron.role === "support"}
      <div class="cv-tip-sec">Support</div>
      <div class="cv-tip-row"><span class="k">Hull repair</span><span class="v">{squadron.supportHullRepair} / pulse</span></div>
      <div class="cv-tip-row"><span class="k">Replenish</span><span class="v">{squadron.droneReplenishRate} / s</span></div>
    {/if}

    <div class="cv-tip-sec">Defense</div>
    <div class="cv-tip-row"><span class="k">Intercept</span><span class="v">{squadron.interceptChance}%</span></div>
    <div class="cv-tip-row"><span class="k">Reflect</span><span class="v">{squadron.reflectChance}%</span></div>
    <div class="cv-tip-row"><span class="k">Evasion</span><span class="v">{squadron.evasion}%</span></div>
    {#if squadron.role === "defense"}
      <div class="cv-tip-row"><span class="k">Smart reflect</span><span class="v">{squadron.smartReflect ? "On" : "Off"}</span></div>
    {/if}
    <!-- FORWARD-COMPAT: defensive-drone shields are a PLANNED addition (design S8 defense
         identity). The squadron model carries no `shield` field yet, so it is read through
         the SquadronMaybeShield typed-optional cast: this row renders with ZERO rework the
         day the real field lands, and today (undefined) it simply does not render. -->
    {#if maybeShield !== undefined && maybeShield !== null}
      <div class="cv-tip-row"><span class="k">Shield</span><span class="v">{maybeShield}</span></div>
    {:else}
      <div class="cv-tip-noshield">No shield: drones are hull-only.</div>
    {/if}
  </div>
{/snippet}

<!-- The bounded, internally-scrolling dialog surface (mirrors ShipSystemsPanel's
     .ss-dialog: an opaque surface so it stays legible on browsers without
     backdrop blur, and it owns its own scroll rather than growing the page). The
     host wraps this in the shared .modal-backdrop. -->
<div class="cv-dialog" role="document" bind:this={dialogEl}>
  <!-- Close: a window-style X pinned to the top-right CORNER of the panel (absolute,
       positioned against .cv-dialog), shown in BOTH the available and unavailable
       states. Sits above the top bar via z-index; the top bar reserves right padding
       so its content never slides under it. -->
  <button class="cv-close" on:click={onClose} aria-label="Close">✕</button>
  {#if !replay.available || wave === null}
    <!-- Graceful unavailable state: not on a combat patrol, no ship, or a
         non-combat hull. The button should not be shown in that case, but the view
         still handles it rather than rendering a broken arena. -->
    <div class="cv-topbar">
      <div class="ctx">Combat View</div>
    </div>
    <div class="cv-unavailable">
      There is no combat to watch right now. This captain is not on an active combat patrol.
    </div>
  {:else}
    <!-- TOP BAR: captain + ship class vs faction, the wave pill, the mode toggle. -->
    <div class="cv-topbar">
      <div class="ctx">
        <b>{playerName}</b>{#if shipClassLabel} &middot; {shipClassLabel}{/if}
        {#if faction}&nbsp;vs&nbsp;<b class="foe-name">{faction.name}</b>{/if}
        {#if totalWaves > 0}<span class="wavepill">Wave {(watchedWave?.waveIndex ?? 0) + 1} / {totalWaves}</span>{/if}
      </div>
      <div class="cv-topbar-right">
        <!-- The panel now holds only the Mode toggle + Close. The log-stream speed,
             style, damage colors, and auto-scroll are Options settings (Combat 0.13.0). -->
        <div class="mode" role="tablist" aria-label="Combat view mode">
          <button class:on={mode === "log"} on:click={() => (mode = "log")}>Log-Guided</button>
          <button class:on={mode === "visual"} on:click={() => (mode = "visual")}>Visual</button>
        </div>
      </div>
    </div>

    <!-- ARENA: player card | center (range + phase) | enemy card. -->
    <div class="arena">
      <!-- PLAYER -->
      <!-- data-cid anchors this card to the player combatant id so a Visual-mode beat's
           fromId/toId can locate it (see visibleElementFor). The mobile player row carries
           the SAME id; only the laid-out one is targeted. -->
      <div class="ship" data-cid={wave.playerStart.id}>
        <div class="ship-head">
          <div class="portrait">{"\u{1F6E1}️"}</div>
          <div>
            <div class="ship-name">{playerName}</div>
            <div class="ship-class">{shipClassLabel}{#if shipClassLabel} &middot; {/if}{stanceLabel} stance</div>
          </div>
        </div>
        <div class="bar-row">
          <div class="bl"><span>Hull</span><span class="bv">{num(playerHull)} / {num(playerHullMax)}</span></div>
          <div class="bar hull"><span style="width:{pct(playerHull, playerHullMax)}%"></span></div>
        </div>
        <div class="bar-row">
          <div class="bl"><span>Shield</span><span class="bv">{num(playerShield)} / {num(playerShieldMax)}</span></div>
          <div class="bar shield"><span style="width:{pct(playerShield, playerShieldMax)}%"></span></div>
        </div>

        {#if playerSnap && playerSnap.effects.length > 0}
          <div class="piprow">
            <span class="lab">Status effects</span>
            {#each playerSnap.effects as e (e.defId)}
              {@const key = pipKey("p", "eff", e.defId)}{@const tip = { kind: "effect", defId: e.defId, rank: e.rank } as PipTipData}
              <span class="pip {effectPipClass(e.defId)}" class:cv-pip-open={selectedPipKey === key}
                role="button" tabindex="0"
                aria-pressed={selectedPipKey === key}
                aria-label={effectPipTitle(e.defId, e.rank)}
                title={effectPipTitle(e.defId, e.rank)}
                on:click|stopPropagation={(ev) => togglePip(ev, key, tip)}
                on:mouseenter={(ev) => onPipEnter(ev, key, tip)}
                on:mouseleave={() => onPipLeave(key)}
                on:keydown={(ev) => onPipKeydown(ev, key, tip)}
              >{effectPipGlyph(e.defId)}</span>
            {/each}
          </div>
        {/if}

        {#if playerSystemPips.length > 0}
          <div class="piprow">
            <span class="lab">Ship systems</span>
            {#each playerSystemPips as sp (sp.pip.id)}
              {@const key = pipKey("p", "sys", sp.pip.id)}{@const tip = { kind: "system", sysKind: sp.pip.kind, label: sp.label, condition: sp.pip.condition, piece: equipPieceForSystemPip(true, sp.pip.kind) } as PipTipData}
              <span class="pip {sp.pip.condition}" class:cv-pip-open={selectedPipKey === key}
                role="button" tabindex="0"
                aria-pressed={selectedPipKey === key}
                aria-label={sp.label}
                title={sp.label}
                on:click|stopPropagation={(ev) => togglePip(ev, key, tip)}
                on:mouseenter={(ev) => onPipEnter(ev, key, tip)}
                on:mouseleave={() => onPipLeave(key)}
                on:keydown={(ev) => onPipKeydown(ev, key, tip)}
              ></span>
            {/each}
          </div>
        {/if}

        {#if playerDroneSrc}
          {#each playerDroneSrc.drones as squadron (squadron.id)}
            <div class="piprow">
              <span class="lab">Drones ({squadron.model} squadron)</span>
              {#each dronePips(squadronStatusSummary(squadron)) as dp, di}
                {@const key = pipKey("p", `drn-${squadron.id}`, String(di))}{@const tip = { kind: "drone", squadron } as PipTipData}
                <span class="pip {dp.cls}" class:cv-pip-open={selectedPipKey === key}
                  role="button" tabindex="0"
                  aria-pressed={selectedPipKey === key}
                  aria-label={dp.title}
                  title={dp.title}
                  on:click|stopPropagation={(ev) => togglePip(ev, key, tip)}
                  on:mouseenter={(ev) => onPipEnter(ev, key, tip)}
                  on:mouseleave={() => onPipLeave(key)}
                  on:keydown={(ev) => onPipKeydown(ev, key, tip)}
                ></span>
              {/each}
            </div>
          {/each}
        {/if}
      </div>

      <!-- CENTER: range track + current band, then the phase narration. -->
      <div class="center-col">
        <div class="rangebox">
          <div class="lab">Range</div>
          <div class="rangetrack">
            <div class="marker" style="left:{markerPct}%" title="current distance"></div>
          </div>
          <div class="rangelabels"><span>Short</span><span>Med</span><span>Long</span></div>
          <div class="bandnow">{rangeBand ? BAND_LABEL[rangeBand] : "..."}</div>
        </div>
        <div class="phase">
          <div class="lab">Phase</div>
          <div class="val">{phase ? PHASE_LABEL[phase] : "..."}</div>
        </div>
      </div>

      <!-- ENEMY -->
      <!-- data-cid = the featured enemy id (the Visual-mode pop/tracer anchor). -->
      <div class="ship enemy" data-cid={enemyFeatured?.id}>
        <div class="ship-head">
          <div class="portrait">{"☠️"}</div>
          <div>
            <div class="ship-name">{enemyName}</div>
            <div class="ship-class">{faction ? faction.name : "Hostile"}</div>
          </div>
        </div>
        <div class="bar-row">
          <div class="bl"><span>Hull</span><span class="bv">{num(enemyHull)} / {num(enemyHullMax)}</span></div>
          <div class="bar ehull"><span style="width:{pct(enemyHull, enemyHullMax)}%"></span></div>
        </div>
        <div class="bar-row">
          <div class="bl"><span>Shield</span><span class="bv">{num(enemyShield)} / {num(enemyShieldMax)}</span></div>
          <div class="bar eshield"><span style="width:{pct(enemyShield, enemyShieldMax)}%"></span></div>
        </div>

        {#if enemySnap && enemySnap.effects.length > 0}
          <div class="piprow">
            <span class="lab">Status effects</span>
            {#each enemySnap.effects as e (e.defId)}
              {@const key = pipKey("e0", "eff", e.defId)}{@const tip = { kind: "effect", defId: e.defId, rank: e.rank } as PipTipData}
              <span class="pip {effectPipClass(e.defId)}" class:cv-pip-open={selectedPipKey === key}
                role="button" tabindex="0"
                aria-pressed={selectedPipKey === key}
                aria-label={effectPipTitle(e.defId, e.rank)}
                title={effectPipTitle(e.defId, e.rank)}
                on:click|stopPropagation={(ev) => togglePip(ev, key, tip)}
                on:mouseenter={(ev) => onPipEnter(ev, key, tip)}
                on:mouseleave={() => onPipLeave(key)}
                on:keydown={(ev) => onPipKeydown(ev, key, tip)}
              >{effectPipGlyph(e.defId)}</span>
            {/each}
          </div>
        {/if}

        {#if enemySystemPips.length > 0}
          <div class="piprow">
            <span class="lab">Ship systems</span>
            {#each enemySystemPips as sp (sp.pip.id)}
              {@const key = pipKey("e0", "sys", sp.pip.id)}{@const tip = { kind: "system", sysKind: sp.pip.kind, label: sp.label, condition: sp.pip.condition, piece: null } as PipTipData}
              <span class="pip {sp.pip.condition}" class:cv-pip-open={selectedPipKey === key}
                role="button" tabindex="0"
                aria-pressed={selectedPipKey === key}
                aria-label={sp.label}
                title={sp.label}
                on:click|stopPropagation={(ev) => togglePip(ev, key, tip)}
                on:mouseenter={(ev) => onPipEnter(ev, key, tip)}
                on:mouseleave={() => onPipLeave(key)}
                on:keydown={(ev) => onPipKeydown(ev, key, tip)}
              ></span>
            {/each}
          </div>
        {/if}

        {#if enemyDroneSrc}
          {#each enemyDroneSrc.drones as squadron (squadron.id)}
            <div class="piprow">
              <span class="lab">Drones ({squadron.model} squadron)</span>
              {#each dronePips(squadronStatusSummary(squadron)) as dp, di}
                {@const key = pipKey("e0", `drn-${squadron.id}`, String(di))}{@const tip = { kind: "drone", squadron } as PipTipData}
                <span class="pip {dp.cls}" class:cv-pip-open={selectedPipKey === key}
                  role="button" tabindex="0"
                  aria-pressed={selectedPipKey === key}
                  aria-label={dp.title}
                  title={dp.title}
                  on:click|stopPropagation={(ev) => togglePip(ev, key, tip)}
                  on:mouseenter={(ev) => onPipEnter(ev, key, tip)}
                  on:mouseleave={() => onPipLeave(key)}
                  on:keydown={(ev) => onPipKeydown(ev, key, tip)}
                ></span>
              {/each}
            </div>
          {/each}
        {/if}

        {#if extraEnemies.length > 0}
          <!-- Additional hostiles in a multi-enemy wave (no current patrol content
               fields more than one, but this surfaces them honestly rather than
               dropping them). Compact hull bars keyed off the current snapshot. -->
          <div class="extra-enemies">
            <div class="lab">Additional hostiles</div>
            {#each extraEnemies as foe, i (foe.id)}
              {@const foeSnap = snap ? snap.combatants[foe.id] ?? null : null}
              {@const foeHull = foeSnap?.hull ?? foe.hull}
              <div class="extra-row" data-cid={foe.id}>
                <span class="extra-name">{wave && wave.enemyLabels[i + 1] ? wave.enemyLabels[i + 1] : "Hostile"}</span>
                <div class="bar ehull mini"><span style="width:{pct(foeHull, foe.hullMax)}%"></span></div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    <!-- MOBILE LAYOUT (narrow screens only; hidden on desktop via CSS, where the
         .arena above is shown instead). Purpose-built per the approved mockup: a
         pinned status band (range + band + phase, always visible without scrolling)
         and a compact roster of tappable rows grouped by side. It reads the SAME
         reactive vars the desktop arena does, so the two never diverge. -->
    <div class="cv-mobile">
      <!-- STATUS BAND: range track + current band + engagement phase, pinned under
           the controls so the phase is always on screen (the original complaint). -->
      <div class="cvm-status">
        <div class="cvm-block">
          <span class="cvm-lab">Range</span>
          <div class="cvm-rangetrack">
            <div class="cvm-marker" style="left:{markerPct}%" title="current distance"></div>
          </div>
          <div class="cvm-rangelabels"><span>Short</span><span>Med</span><span>Long</span></div>
        </div>
        <div class="cvm-block">
          <span class="cvm-lab">Weapons Range</span>
          <span class="cvm-band">{rangeBand ? BAND_LABEL[rangeBand] : "..."}</span>
        </div>
        <div class="cvm-block">
          <span class="cvm-lab">Phase</span>
          <span class="cvm-phase">{phase ? PHASE_LABEL[phase] : "..."}</span>
        </div>
      </div>

      <!-- ROSTER: compact rows grouped by side. Each row is a <button> so it is
           keyboard-operable (tap / Enter / Space) and reports its expanded state. -->
      <div class="cvm-roster">
        <!-- YOUR SHIP -->
        <div class="cvm-side-lab"><span>Your Ship</span><span class="cvm-hint">tap a row for detail</span></div>
        <button
          type="button"
          class="cvm-row"
          data-cid={playerRowId}
          class:expanded={expandedId === playerRowId}
          on:click={() => toggleExpanded(playerRowId)}
          aria-expanded={expandedId === playerRowId}
        >
          <div class="cvm-ico">{"\u{1F6E1}️"}</div>
          <div class="cvm-main">
            <div class="cvm-name">{playerName}</div>
            <div class="cvm-sub">{shipClassLabel}{#if shipClassLabel} &middot; {/if}{stanceLabel}</div>
            <div class="cvm-mbars">
              <div class="cvm-mbar hull"><span style="width:{pct(playerHull, playerHullMax)}%"></span></div>
              <div class="cvm-mbar shield"><span style="width:{pct(playerShield, playerShieldMax)}%"></span></div>
            </div>
          </div>
          <div class="cvm-vals">{num(playerHull)}/{num(playerHullMax)}<br /><span class="s">{num(playerShield)}/{num(playerShieldMax)}</span></div>
          {#if expandedId === playerRowId}
            <div class="cvm-detail">
              {#if playerSystemPips.length > 0}
                <div class="cvm-drow">
                  <span class="cvm-dl">Systems</span>
                  <span class="cvm-mini">
                    {#each playerSystemPips as sp (sp.pip.id)}
                      {@const key = pipKey("p", "sys", sp.pip.id)}{@const tip = { kind: "system", sysKind: sp.pip.kind, label: sp.label, condition: sp.pip.condition, piece: equipPieceForSystemPip(true, sp.pip.kind) } as PipTipData}
                      <span class="cvm-pipinfo" class:cv-chip-open={selectedPipKey === key}
                        role="button" tabindex="0"
                        aria-pressed={selectedPipKey === key}
                        aria-label={sp.label}
                        on:click|stopPropagation={(ev) => togglePip(ev, key, tip)}
                        on:mouseenter={(ev) => onPipEnter(ev, key, tip)}
                        on:mouseleave={() => onPipLeave(key)}
                        on:keydown={(ev) => onPipKeydown(ev, key, tip)}
                      ><span class="pip {sp.pip.condition}"></span></span>
                    {/each}
                  </span>
                </div>
              {/if}
              <div class="cvm-drow">
                <span class="cvm-dl">Effects</span>
                <span class="cvm-mini">
                  {#if playerSnap && playerSnap.effects.length > 0}
                    {#each playerSnap.effects as e (e.defId)}
                      {@const key = pipKey("p", "eff", e.defId)}{@const tip = { kind: "effect", defId: e.defId, rank: e.rank } as PipTipData}
                      <span class="cvm-pipinfo" class:cv-chip-open={selectedPipKey === key}
                        role="button" tabindex="0"
                        aria-pressed={selectedPipKey === key}
                        aria-label={effectPipTitle(e.defId, e.rank)}
                        on:click|stopPropagation={(ev) => togglePip(ev, key, tip)}
                        on:mouseenter={(ev) => onPipEnter(ev, key, tip)}
                        on:mouseleave={() => onPipLeave(key)}
                        on:keydown={(ev) => onPipKeydown(ev, key, tip)}
                      ><span class="pip {effectPipClass(e.defId)}">{effectPipGlyph(e.defId)}</span></span>
                    {/each}
                  {:else}
                    <span class="cvm-none">none</span>
                  {/if}
                </span>
              </div>
              {#if playerDroneSrc}
                {#each playerDroneSrc.drones as squadron (squadron.id)}
                  <div class="cvm-drow">
                    <span class="cvm-dl">{squadron.model}</span>
                    <span class="cvm-mini">
                      {#each dronePips(squadronStatusSummary(squadron)) as dp, di}
                        {@const key = pipKey("p", `drn-${squadron.id}`, String(di))}{@const tip = { kind: "drone", squadron } as PipTipData}
                        <span class="cvm-pipinfo" class:cv-chip-open={selectedPipKey === key}
                          role="button" tabindex="0"
                          aria-pressed={selectedPipKey === key}
                          aria-label={dp.title}
                          on:click|stopPropagation={(ev) => togglePip(ev, key, tip)}
                          on:mouseenter={(ev) => onPipEnter(ev, key, tip)}
                          on:mouseleave={() => onPipLeave(key)}
                          on:keydown={(ev) => onPipKeydown(ev, key, tip)}
                        ><span class="pip {dp.cls}"></span></span>
                      {/each}
                    </span>
                  </div>
                {/each}
              {/if}
            </div>
          {/if}
        </button>

        <!-- ENEMY WAVE (all enemies as compact rows; scales to N). -->
        <div class="cvm-side-lab foe">
          <span>Enemy Wave &middot; {waveTally.living}</span>
          {#if waveTally.down > 0}<span class="cvm-hint">{waveTally.down} down</span>{/if}
        </div>
        {#each waveEnemies as enemy, i (enemy.id)}
          {@const es = snap ? snap.combatants[enemy.id] ?? null : null}
          {@const eHull = es?.hull ?? enemy.hull}
          {@const eShield = es?.shield ?? enemy.shield}
          {@const destroyed = eHull <= 0}
          {@const isTarget = enemy.id === currentTargetId}
          {@const eLabel = wave && wave.enemyLabels[i] ? wave.enemyLabels[i] : "Hostile"}
          {@const ePips = systemPipLabels(es?.systemConditions ?? null)}
          {@const eDroneSrc = enemyDroneSource(i)}
          <button
            type="button"
            class="cvm-row foe"
            data-cid={enemy.id}
            class:target={isTarget}
            class:destroyed
            on:click={() => toggleExpanded(enemy.id)}
            aria-expanded={expandedId === enemy.id}
          >
            <div class="cvm-ico">{destroyed ? "\u{1F480}" : "☠️"}</div>
            <div class="cvm-main">
              <div class="cvm-name">
                <span class="cvm-nametext">{eLabel}</span>
                {#if isTarget && !destroyed}<span class="cvm-tgt">TARGET</span>{/if}
              </div>
              <div class="cvm-sub">{destroyed ? "destroyed" : faction ? faction.name : "Hostile"}</div>
              {#if !destroyed}
                <div class="cvm-mbars">
                  <div class="cvm-mbar ehull"><span style="width:{pct(eHull, enemy.hullMax)}%"></span></div>
                  <div class="cvm-mbar eshield"><span style="width:{pct(eShield, enemy.shieldMax)}%"></span></div>
                </div>
              {/if}
            </div>
            <div class="cvm-vals">
              {num(eHull)}/{num(enemy.hullMax)}{#if !destroyed}<br /><span class="s">{num(eShield)}/{num(enemy.shieldMax)}</span>{/if}
            </div>
            {#if expandedId === enemy.id && !destroyed}
              <div class="cvm-detail">
                {#if ePips.length > 0}
                  <div class="cvm-drow">
                    <span class="cvm-dl">Systems</span>
                    <span class="cvm-mini">
                      {#each ePips as sp (sp.pip.id)}
                        {@const key = pipKey(`e${i}`, "sys", sp.pip.id)}{@const tip = { kind: "system", sysKind: sp.pip.kind, label: sp.label, condition: sp.pip.condition, piece: null } as PipTipData}
                        <span class="cvm-pipinfo" class:cv-chip-open={selectedPipKey === key}
                          role="button" tabindex="0"
                          aria-pressed={selectedPipKey === key}
                          aria-label={sp.label}
                          on:click|stopPropagation={(ev) => togglePip(ev, key, tip)}
                          on:mouseenter={(ev) => onPipEnter(ev, key, tip)}
                          on:mouseleave={() => onPipLeave(key)}
                          on:keydown={(ev) => onPipKeydown(ev, key, tip)}
                        ><span class="pip {sp.pip.condition}"></span></span>
                      {/each}
                    </span>
                  </div>
                {/if}
                <div class="cvm-drow">
                  <span class="cvm-dl">Effects</span>
                  <span class="cvm-mini">
                    {#if es && es.effects.length > 0}
                      {#each es.effects as e (e.defId)}
                        {@const key = pipKey(`e${i}`, "eff", e.defId)}{@const tip = { kind: "effect", defId: e.defId, rank: e.rank } as PipTipData}
                        <span class="cvm-pipinfo" class:cv-chip-open={selectedPipKey === key}
                          role="button" tabindex="0"
                          aria-pressed={selectedPipKey === key}
                          aria-label={effectPipTitle(e.defId, e.rank)}
                          on:click|stopPropagation={(ev) => togglePip(ev, key, tip)}
                          on:mouseenter={(ev) => onPipEnter(ev, key, tip)}
                          on:mouseleave={() => onPipLeave(key)}
                          on:keydown={(ev) => onPipKeydown(ev, key, tip)}
                        ><span class="pip {effectPipClass(e.defId)}">{effectPipGlyph(e.defId)}</span></span>
                      {/each}
                    {:else}
                      <span class="cvm-none">none</span>
                    {/if}
                  </span>
                </div>
                {#if eDroneSrc}
                  {#each eDroneSrc.drones as squadron (squadron.id)}
                    <div class="cvm-drow">
                      <span class="cvm-dl">{squadron.model}</span>
                      <span class="cvm-mini">
                        {#each dronePips(squadronStatusSummary(squadron)) as dp, di}
                          {@const key = pipKey(`e${i}`, `drn-${squadron.id}`, String(di))}{@const tip = { kind: "drone", squadron } as PipTipData}
                          <span class="cvm-pipinfo" class:cv-chip-open={selectedPipKey === key}
                            role="button" tabindex="0"
                            aria-pressed={selectedPipKey === key}
                            aria-label={dp.title}
                            on:click|stopPropagation={(ev) => togglePip(ev, key, tip)}
                            on:mouseenter={(ev) => onPipEnter(ev, key, tip)}
                            on:mouseleave={() => onPipLeave(key)}
                            on:keydown={(ev) => onPipKeydown(ev, key, tip)}
                          ><span class="pip {dp.cls}"></span></span>
                        {/each}
                      </span>
                    </div>
                  {/each}
                {/if}
              </div>
            {/if}
          </button>
        {/each}
      </div>
    </div>

    <!-- VISUAL-MODE FX OVERLAY. One absolutely-positioned, pointer-events:none layer over
         the whole dialog. It is ALWAYS in the DOM (empty in Log-Guided, so invisible) and
         the imperative FX driver appends pops/tracers into it, positioned via the ships'
         data-cid anchors. Kept outside the mode `{#if}` so it never remounts on a toggle
         and the driver can tear it down on leaving Visual. -->
    <div class="cv-fx-layer" bind:this={fxLayer} aria-hidden="true"></div>

    <!-- LOG / VISUAL body. -->
    {#if mode === "log"}
      <div class="log">
        <div class="log-head">
          <span class="t">Combat log</span>
        </div>
        <div class="log-body" bind:this={logBody}>
          {#each shownRounds as r (r.round)}
            <div class="rounddiv">=== Round {r.round + 1} ===</div>
            {#each r.lines as line, li (li)}
              <!-- Render the line's tokens as plain Svelte markup (never {@html}), so
                   user-editable captain names are escaped. With the damage-color option
                   on, shield-damage numbers tint accent (blue/cyan) and hull-damage
                   numbers tint warning (orange); off, every token renders as plain text. -->
              <div class="ln {line.cls}"
                >{#each line.tokens as tk}{#if combatDamageColors && tk.kind === "shield"}<span class="dmg-shield">{tk.text}</span>{:else if combatDamageColors && tk.kind === "hull"}<span class="dmg-hull">{tk.text}</span>{:else}{tk.text}{/if}{/each}</div>
            {/each}
          {/each}
          {#if shownRounds.length === 0}
            <div class="ln dim">No combat log for this wave.</div>
          {/if}
        </div>
      </div>
    {:else}
      <!-- VISUAL MODE BODY (Phase 12c). The arena above is shared, so the animated pops
           play over its ships from the FX overlay; this body is the calm footer. It reuses
           the .log frame (flex:1) so it occupies the SAME space the text log does and the
           locked dialog height never bounces between modes. Top: the most recent round's
           events as a quiet caption (no damage colors, so the space reads calm). Bottom: a
           compact legend + the current phase / round. -->
      <div class="log cv-visual">
        <div class="log-head">
          <span class="t">Combat view &middot; Visual</span>
          <span class="cv-vround">{phase ? PHASE_LABEL[phase] : "..."} &middot; Round {Math.min(revealedRound, maxRound) + 1}</span>
        </div>
        <div class="cv-vcaption">
          {#if latestVisualRound}
            {#each latestVisualRound.lines as line, li (li)}
              <div class="cv-vcap-ln {line.cls}">{#each line.tokens as tk}{tk.text}{/each}</div>
            {/each}
          {:else}
            <div class="cv-vcap-ln dim">Damage pops play over the ships as the battle streams.</div>
          {/if}
        </div>
        <!-- LEGEND: -N normal, crit / kill in red, tracer tint = weapon family. The swatch
             colors mirror TRACER_TINT in the script (particle green / kinetic grey / ew +
             other orange). -->
        <div class="cv-vlegend">
          <span class="cv-vl-item"><b class="cv-vl-num">-N</b> damage</span>
          <span class="cv-vl-item"><b class="cv-vl-num crit">crit</b> / <b class="cv-vl-num crit">kill</b> in red</span>
          <span class="cv-vl-item">
            <span class="cv-vl-swatch" style="background:#1D9E75"></span>
            <span class="cv-vl-swatch" style="background:#888780"></span>
            <span class="cv-vl-swatch" style="background:#D85A30"></span>
            tracer tint = weapon family
          </span>
        </div>
      </div>
    {/if}
  {/if}

  <!-- SINGLE FLOATING PIP TOOLTIP. One fixed-position, viewport-clamped wrapper rendered
       for the open pip (selectedPipKey + tipData), dispatching to the matching card snippet
       by kind. position:fixed escapes the arena / log clipping; it lives inside .cv-dialog
       so it shares the modal-backdrop stacking context and sits above the arena / log via
       z-index. Measured after an awaited tick (see openPipTip) and reflowed on scroll /
       resize; hidden for the first frame so it never flashes at 0,0. -->
  {#if selectedPipKey !== null && tipData}
    <div
      class="cv-tip-float"
      bind:this={tipFloatEl}
      role="tooltip"
      style="left: {tipLeft}px; top: {tipTop}px; visibility: {tipVisible ? 'visible' : 'hidden'}"
    >
      {#if tipData.kind === "effect"}
        {@render effectTip(tipData.defId, tipData.rank)}
      {:else if tipData.kind === "system"}
        {@render systemTip(tipData.sysKind, tipData.label, tipData.condition, tipData.piece)}
      {:else}
        {@render droneCard(tipData.squadron)}
      {/if}
    </div>
  {/if}
</div>

<style>
  /* The combat view mirrors the approved mockup, built on the shared console
     theme variables (app.css). Every color is a theme var or a literal that
     matches a theme var's value (the danger/warning rgba tints on the enemy card
     + pips), so the view stays consistent with the rest of the console and reads
     correctly across the app's theme palettes. No em dashes / no "--" as
     punctuation in comments; CSS custom properties (var(--x)) are exempt. */

  .cv-dialog {
    position: relative; /* positioning context for the corner close (below) */
    width: min(1080px, 100%);
    /* LOCKED HEIGHT (Combat 0.13.0): a stable frame that does NOT grow/shrink as the
       log streams in. Capped to the viewport on short screens. The arena keeps its
       natural size at top; the log fills + scrolls the remaining space (see .log +
       .log-body below), so the dialog stops resizing/bouncing as content changes. */
    height: min(760px, calc(100vh - 40px)); /* fallback for browsers without dvh */
    /* dvh = the DYNAMIC (currently-visible) viewport, so the panel fits the space the
       mobile browser + Android system nav bar actually leave visible. Plain 100vh is the
       LARGE viewport (counts the area behind that UI), which pushed the log's bottom under
       the on-screen nav bar. */
    height: min(760px, calc(100dvh - 40px));
    display: flex;
    flex-direction: column;
    background:
      radial-gradient(900px 500px at 50% -10%, rgba(var(--color-accent-rgb), 0.06), transparent 60%),
      var(--color-bg-deep);
    border: 1px solid var(--color-border);
    border-radius: 14px;
    overflow: hidden;
    color: var(--color-text-primary);
  }

  /* Top bar. */
  .cv-topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    /* Extra RIGHT padding reserves the top-right corner for the absolute .cv-close, so
       the mode toggle / ctx never slide under it. */
    padding: 12px 52px 12px 16px;
    border-bottom: 1px solid var(--color-border);
    background: rgba(var(--color-accent-rgb), 0.04);
    flex-wrap: wrap;
  }
  .cv-topbar .ctx {
    font-size: 12.5px;
    color: var(--color-text-secondary);
  }
  .cv-topbar .ctx b {
    color: var(--color-text-primary);
  }
  .cv-topbar .ctx b.foe-name {
    color: var(--color-danger);
  }
  .wavepill {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--color-warning);
    border: 1px solid rgba(251, 191, 36, 0.4);
    border-radius: 999px;
    padding: 2px 9px;
    margin-left: 8px;
    white-space: nowrap;
  }
  .cv-topbar-right {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .mode {
    display: flex;
    border: 1px solid var(--color-border);
    border-radius: 8px;
    overflow: hidden;
  }
  .mode button {
    background: transparent;
    border: 0;
    border-right: 1px solid var(--color-border);
    color: var(--color-text-secondary);
    font-family: var(--font-body, inherit);
    font-size: 11.5px;
    padding: 6px 11px;
    cursor: pointer;
    letter-spacing: 0.04em;
  }
  .mode button:last-child {
    border-right: 0;
  }
  .mode button.on {
    background: rgba(var(--color-accent-rgb), 0.14);
    color: var(--color-accent-bright);
    font-weight: 600;
  }
  .cv-close {
    /* Square X icon pinned to the panel's top-right CORNER (window-style), above the
       top bar. The top bar reserves matching right padding so nothing slides under it. */
    position: absolute;
    top: 10px;
    right: 10px;
    z-index: 5;
    width: 30px;
    height: 30px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 1px solid var(--color-border);
    border-radius: 8px;
    color: var(--color-text-secondary);
    font-size: 16px;
    line-height: 1;
    padding: 0;
    cursor: pointer;
  }
  .cv-close:hover {
    color: var(--color-accent-bright);
    border-color: var(--color-border-strong);
  }

  .cv-unavailable {
    padding: 28px 20px;
    color: var(--color-text-secondary);
    font-size: 13px;
    line-height: 1.6;
    text-align: center;
  }

  /* Arena. */
  .arena {
    display: grid;
    grid-template-columns: 1fr 150px 1fr;
    gap: 14px;
    padding: 16px;
    align-items: start;
    overflow-y: auto;
    /* Keep the arena at its natural height inside the locked-height dialog, but let it
       shrink + scroll (rather than force the dialog to grow) on a short viewport, so
       the log still gets its own scrollable frame below. */
    min-height: 0;
  }
  /* RESPONSIVE SWITCH. The desktop arena is the default; the mobile block is hidden
     until the viewport narrows past 760px, at which point the arena hides and the
     purpose-built mobile layout takes over. Both read the same reactive vars, so this
     is a pure presentation swap with no data divergence. Desktop styling above is
     left exactly as-is (Rule 15: do not restructure working desktop layout). */
  .cv-mobile {
    display: none;
  }
  @media (max-width: 760px) {
    .arena {
      display: none;
    }
    .cv-mobile {
      display: flex;
      flex-direction: column;
      min-height: 0;
    }
    /* On mobile the log fills the remaining height and scrolls internally, rather
       than the desktop's fixed 230px cap, so the log (the reading focus) owns the
       space left under the pinned status band + roster. */
    .log {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .log-body {
      max-height: none;
      flex: 1;
    }
  }
  .ship {
    border: 1px solid var(--color-border);
    border-radius: 11px;
    padding: 12px;
    background: var(--color-bg-deep);
  }
  .ship.enemy {
    border-color: rgba(248, 113, 113, 0.28);
  }
  .ship-head {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px;
  }
  .portrait {
    width: 46px;
    height: 46px;
    border-radius: 9px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 26px;
    border: 1px solid var(--color-border);
    background: rgba(var(--color-accent-rgb), 0.06);
    flex-shrink: 0;
  }
  .ship.enemy .portrait {
    border-color: rgba(248, 113, 113, 0.35);
    background: rgba(248, 113, 113, 0.06);
  }
  .ship-name {
    font-family: var(--font-display);
    font-size: 14px;
  }
  .ship-class {
    font-size: 11px;
    color: var(--color-text-secondary);
  }
  .ship.enemy .ship-class {
    color: var(--color-danger);
  }

  .bar-row {
    margin-bottom: 8px;
  }
  .bar-row .bl {
    display: flex;
    justify-content: space-between;
    font-size: 9.5px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--color-text-dim);
    margin-bottom: 3px;
  }
  .bar-row .bl .bv {
    font-family: var(--font-mono);
    color: var(--color-text-secondary);
  }
  .bar {
    height: 9px;
    border-radius: 5px;
    background: rgba(255, 255, 255, 0.06);
    overflow: hidden;
    border: 1px solid var(--color-border);
  }
  .bar > span {
    display: block;
    height: 100%;
    border-radius: 5px;
  }
  .bar.hull > span {
    background: linear-gradient(90deg, #34d399, #67e8f9);
  }
  .bar.shield > span {
    background: linear-gradient(90deg, #67e8f9, #8ff0e0);
  }
  .bar.ehull > span {
    background: linear-gradient(90deg, #f87171, #fbbf24);
  }
  .bar.eshield > span {
    background: linear-gradient(90deg, #fbbf24, #fde68a);
  }
  .bar.mini {
    height: 6px;
  }

  .piprow {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
    flex-wrap: wrap;
  }
  .piprow .lab {
    font-size: 9px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-text-dim);
    width: 100%;
    margin-bottom: -2px;
  }
  .pip {
    width: 15px;
    height: 15px;
    border-radius: 3px;
    border: 1px solid var(--color-border);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 9px;
    font-family: var(--font-mono);
    position: relative;
  }
  /* Status-effect pips. */
  .pip.dot {
    background: rgba(248, 113, 113, 0.16);
    border-color: rgba(248, 113, 113, 0.5);
    color: #fca5a5;
  }
  .pip.debuff {
    background: rgba(251, 191, 36, 0.14);
    border-color: rgba(251, 191, 36, 0.5);
    color: #fcd34d;
  }
  .pip.buff {
    background: rgba(52, 211, 153, 0.14);
    border-color: rgba(52, 211, 153, 0.5);
    color: #6ee7b7;
  }
  /* Ship-system condition pips. */
  .pip.nominal {
    background: rgba(52, 211, 153, 0.12);
    border-color: rgba(52, 211, 153, 0.45);
  }
  .pip.degraded {
    background: rgba(251, 191, 36, 0.12);
    border-color: rgba(251, 191, 36, 0.45);
  }
  .pip.disrupted {
    background: rgba(248, 113, 113, 0.12);
    border-color: rgba(248, 113, 113, 0.45);
  }
  .pip.offline {
    background: rgba(90, 122, 133, 0.18);
    border-color: var(--color-text-dim);
    color: var(--color-text-dim);
  }
  /* Drone squadron pips. */
  .pip.online {
    background: rgba(103, 232, 249, 0.14);
    border-color: var(--color-border-strong);
    color: var(--color-accent-bright);
  }
  .pip.refab {
    background: rgba(90, 122, 133, 0.16);
    border-color: var(--color-text-dim);
    color: var(--color-text-dim);
  }

  /* ==========================================================================
     HOVER / TAP PIP TOOLTIPS (Combat 0.13.0). A pip (desktop) or a labeled chip
     (mobile .cvm-pipinfo) becomes a role="button" trigger; the open one gets an
     accent ring, and the rich .cv-tip card renders in the SINGLE floating wrapper
     (.cv-tip-float below) positioned over the pip. Styled with the shared console
     theme vars. See the .cv-tip-float clamp note for the position:fixed dependency.
     ========================================================================== */
  /* Interactive affordance on the trigger pip / chip. Only the role="button" ones
     get a pointer + focus ring (the decorative inner .pip in a mobile chip does not). */
  .pip[role="button"],
  .cvm-pipinfo[role="button"] {
    cursor: pointer;
  }
  .pip[role="button"]:focus-visible,
  .cvm-pipinfo[role="button"]:focus-visible {
    outline: 2px solid var(--color-accent-bright);
    outline-offset: 2px;
  }
  /* The open trigger: a soft accent ring so it is clear which pip the panel belongs to. */
  .pip.cv-pip-open {
    box-shadow: 0 0 0 2px rgba(var(--color-accent-rgb), 0.55);
  }
  .cvm-pipinfo.cv-chip-open {
    color: var(--color-text-primary);
    text-shadow: 0 0 6px rgba(var(--color-accent-rgb), 0.4);
  }

  /* ---- Floating pip tooltip wrapper (mirrors ShipSystemsPanel's .ss-tip-float) ----
     CLAMP DEPENDENCY: left/top are VIEWPORT coordinates (see positionPipTip), which line
     up with this position:fixed element only while the host .modal-backdrop stays a full-
     viewport, origin (0,0), untransformed fixed element (its backdrop-filter makes it the
     containing block for position:fixed), and .cv-dialog carries no transform/filter of
     its own. A very tall card is capped by max-height and, because offsetHeight is read
     AFTER that cap, the vertical clamp already fits the card inside the top/bottom margins.
     overflow-y:auto owns the card's scroll so a tall card never clips off-screen; the
     wrapper carries the opaque backing + drop shadow (the inner card's shadow is dropped
     to avoid it being clipped by this overflow). z-index sits it above the arena / log. */
  .cv-tip-float {
    position: fixed;
    z-index: 60;
    width: min(280px, calc(100vw - 16px));
    max-height: calc(100vh - 16px);
    overflow-y: auto;
    pointer-events: auto;
    border-radius: 8px;
    background: var(--color-bg-deep);
    box-shadow: 0 14px 40px rgba(0, 0, 0, 0.55);
  }

  /* The tooltip card itself. width:100% fills the fixed wrapper. Opaque bordered surface
     (no blur) so it reads solid on Brave, matching the arena cards. */
  .cv-tip {
    width: 100%;
    box-sizing: border-box;
    padding: 9px 11px;
    border: 1px solid var(--color-border-strong, var(--color-border));
    border-radius: 8px;
    background: var(--color-bg-deep);
    text-align: left;
    /* The mobile chips normalize to a small line-height; reset so the card text is
       comfortable regardless of which container it renders in. */
    line-height: 1.45;
  }
  .cv-tip-hd {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-bottom: 5px;
  }
  /* The header badge reuses the shared .pip look (kind class for effects, the four-
     state condition class for systems), so the panel's badge matches its pip. */
  .cv-tip-hd .pip {
    flex-shrink: 0;
  }
  .cv-tip-title {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--color-text-primary);
  }
  .cv-tip-flavor {
    font-style: italic;
    font-size: 11.5px;
    color: var(--color-text-secondary);
    margin-bottom: 4px;
  }
  .cv-tip-def {
    font-size: 12px;
    color: var(--color-text-primary);
  }
  /* The embedded equipment card (player reactor / ftl). A little top gap; the card
     brings its own rarity border, so no extra chrome here. */
  .cv-tip-card {
    margin-top: 8px;
  }

  /* ---- Drone squadron card (the custom stat card). The role tints the top border +
     badge via the inline --cv-role custom property set on the card. ---- */
  .cv-dcard {
    border-top: 3px solid var(--cv-role, var(--color-accent-bright));
  }
  /* Role badge, pushed to the right of the header via margin-left:auto. */
  .cv-tip-badge {
    margin-left: auto;
    flex-shrink: 0;
    font-size: 9px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 2px 6px;
    border-radius: 5px;
    color: var(--cv-role, var(--color-accent-bright));
    background: color-mix(in srgb, var(--cv-role, var(--color-accent-bright)) 20%, transparent);
  }
  /* Small mono-ish subtitle (role drones + mode). */
  .cv-tip-sub {
    font-size: 10.5px;
    color: var(--color-text-dim);
    margin: 2px 0 6px;
  }
  /* Section divider label (Status / Offense / Support / Defense). */
  .cv-tip-sec {
    font-size: 9px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--color-text-dim);
    margin: 8px 0 3px;
    border-top: 1px solid var(--color-border);
    padding-top: 6px;
  }
  /* One key/value stat row. */
  .cv-tip-row {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    font-size: 11.5px;
    padding: 1.5px 0;
  }
  .cv-tip-row .k {
    color: var(--color-text-secondary);
  }
  .cv-tip-row .v {
    color: var(--color-text-primary);
    text-align: right;
  }
  /* Condition-split value tints (online / disrupted / refabricating + destroyed). */
  .cv-tip-row .v .cv-ok {
    color: var(--color-success);
  }
  .cv-tip-row .v .cv-warn {
    color: var(--color-warning);
  }
  .cv-tip-row .v .cv-dim {
    color: var(--color-text-dim);
  }
  /* The "no shield" footnote (drones are hull-only; hidden the day a shield field lands). */
  .cv-tip-noshield {
    font-size: 10px;
    color: var(--color-text-dim);
    margin-top: 7px;
    border-top: 1px dashed var(--color-border);
    padding-top: 6px;
  }

  .extra-enemies {
    margin-top: 12px;
    border-top: 1px dashed var(--color-border);
    padding-top: 8px;
  }
  .extra-enemies .lab {
    font-size: 9px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-text-dim);
    margin-bottom: 6px;
  }
  .extra-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 5px;
  }
  .extra-name {
    font-size: 10px;
    color: var(--color-text-secondary);
    min-width: 84px;
  }
  .extra-row .bar {
    flex: 1;
  }

  .center-col {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding-top: 8px;
  }
  .rangebox {
    width: 100%;
    text-align: center;
  }
  .rangebox .lab {
    font-size: 9px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--color-text-dim);
    margin-bottom: 6px;
  }
  .rangetrack {
    position: relative;
    height: 6px;
    border-radius: 4px;
    background: linear-gradient(90deg, rgba(var(--color-accent-rgb), 0.06), rgba(var(--color-accent-rgb), 0.22));
    border: 1px solid var(--color-border);
  }
  .rangetrack .marker {
    position: absolute;
    top: -4px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--color-accent);
    box-shadow: 0 0 8px rgba(var(--color-accent-rgb), 0.7);
    transform: translateX(-50%);
    transition: left 0.4s ease;
  }
  .rangelabels {
    display: flex;
    justify-content: space-between;
    font-size: 8.5px;
    letter-spacing: 0.08em;
    color: var(--color-text-dim);
    margin-top: 4px;
    text-transform: uppercase;
  }
  .bandnow {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--color-accent-bright);
    margin-top: 8px;
  }
  .phase {
    text-align: center;
  }
  .phase .lab {
    font-size: 9px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--color-text-dim);
  }
  .phase .val {
    font-family: var(--font-display);
    font-size: 12px;
    color: var(--color-warning);
    margin-top: 3px;
    letter-spacing: 0.06em;
  }

  /* Log. Fills the fixed frame under the arena and owns its own scroll (the log-body
     scrolls internally), so the locked-height dialog never grows as rounds stream in.
     This flex-column behavior is shared by desktop + mobile (the mobile media query
     below restates it for the narrow layout). */
  .log {
    border-top: 1px solid var(--color-border);
    padding: 14px 16px 16px;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .log-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
    gap: 10px;
  }
  .log-head .t {
    font-size: 10px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--color-text-secondary);
  }
  .log-body {
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.75;
    overflow-y: auto;
    padding-right: 8px;
    /* Fill the fixed frame left under the arena (see the locked .cv-dialog height +
       the flex .log below), so the log scrolls INTERNALLY from the first line rather
       than growing the dialog as rounds stream in (the bounce this cleanup removes). */
    flex: 1;
    min-height: 0;
  }
  /* Damage-color option (Combat 0.13.0): tint the Simplified log's shield-damage
     numbers vs hull-damage numbers so the two read apart at a glance (accessibility).
     Applied only to the tagged number tokens; the surrounding text is unchanged. */
  .dmg-shield {
    color: var(--color-accent);
    font-weight: 600;
  }
  .dmg-hull {
    color: var(--color-warning);
    font-weight: 600;
  }
  .rounddiv {
    color: var(--color-text-dim);
    letter-spacing: 0.1em;
    margin: 10px 0 4px;
    border-bottom: 1px dashed var(--color-border);
    padding-bottom: 3px;
  }
  .rounddiv:first-child {
    margin-top: 0;
  }
  .ln {
    color: var(--color-text-secondary);
  }
  .ln.dim {
    color: var(--color-text-dim);
  }
  /* Per-event line styling (matches the mockup's log CSS). A crit line gets a
     trailing CRIT tag; a kill line reads success-green; an evade is dim italic. */
  .ln.crit {
    font-weight: 700;
    color: var(--color-text-primary);
  }
  .ln.crit::after {
    content: " CRIT";
    color: var(--color-warning);
    font-size: 10px;
    letter-spacing: 0.1em;
  }
  .ln.dot {
    color: #fca5a5;
  }
  .ln.destroy {
    color: var(--color-success);
  }
  .ln.evade {
    color: var(--color-text-dim);
    font-style: italic;
  }
  .ln.atten {
    color: var(--color-accent);
  }

  /* ==========================================================================
     MOBILE LAYOUT (cvm- prefix). Namespaced so nothing here can bleed into the
     desktop arena rules above. Mirrors the approved mobile mockup: a pinned status
     band, then compact tappable rows. All colors are theme vars or literals that
     match a theme var's value (the same danger/warning tints the desktop arena +
     pips use), keeping the two layouts visually consistent.
     ========================================================================== */

  /* STATUS BAND: range track + band + phase, always visible under the controls. */
  .cvm-status {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 9px 14px;
    border-bottom: 1px solid var(--color-border);
    background: var(--color-bg-mid, var(--color-bg-deep));
  }
  .cvm-block {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .cvm-lab {
    font-size: 8px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--color-text-dim);
  }
  .cvm-rangetrack {
    position: relative;
    width: 120px;
    height: 6px;
    border-radius: 4px;
    background: linear-gradient(90deg, rgba(var(--color-accent-rgb), 0.08), rgba(var(--color-accent-rgb), 0.24));
    border: 1px solid var(--color-border);
  }
  .cvm-marker {
    position: absolute;
    top: -4px;
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: var(--color-accent);
    box-shadow: 0 0 7px rgba(var(--color-accent-rgb), 0.7);
    transform: translateX(-50%);
    transition: left 0.4s ease;
  }
  .cvm-rangelabels {
    display: flex;
    justify-content: space-between;
    width: 120px;
    font-size: 7.5px;
    letter-spacing: 0.06em;
    color: var(--color-text-dim);
    text-transform: uppercase;
  }
  .cvm-band {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--color-accent-bright);
  }
  .cvm-phase {
    font-family: var(--font-display);
    font-size: 12px;
    color: var(--color-warning);
    letter-spacing: 0.05em;
  }

  /* ROSTER: grouped, compact rows. */
  .cvm-roster {
    border-bottom: 1px solid var(--color-border);
  }
  .cvm-side-lab {
    font-size: 8.5px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--color-text-dim);
    padding: 8px 14px 4px;
    display: flex;
    justify-content: space-between;
  }
  .cvm-side-lab.foe {
    color: var(--color-danger);
  }
  .cvm-side-lab .cvm-hint {
    color: var(--color-text-dim);
    font-weight: 400;
  }

  /* A row is a <button> reset to a slim grid: icon | body | values, with an
     expanded detail block spanning the full width when opened. */
  .cvm-row {
    display: grid;
    grid-template-columns: 30px 1fr auto;
    gap: 9px;
    align-items: center;
    width: 100%;
    text-align: left;
    padding: 7px 14px;
    border: 0;
    border-top: 1px solid rgba(var(--color-accent-rgb), 0.06);
    background: rgba(var(--color-accent-rgb), 0.03);
    color: var(--color-text-primary);
    font-family: inherit;
    cursor: pointer;
  }
  .cvm-row:hover {
    background: rgba(var(--color-accent-rgb), 0.06);
  }
  .cvm-row.foe {
    background: rgba(248, 113, 113, 0.05);
  }
  .cvm-row.foe:hover {
    background: rgba(248, 113, 113, 0.08);
  }
  /* The focus-fire target gets a warning spine on its leading edge. */
  .cvm-row.target {
    box-shadow: inset 3px 0 0 var(--color-warning);
  }
  .cvm-row.expanded {
    background: rgba(var(--color-accent-rgb), 0.07);
  }
  .cvm-row.destroyed {
    opacity: 0.5;
    cursor: default;
  }
  .cvm-ico {
    width: 30px;
    height: 30px;
    border-radius: 7px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 17px;
    border: 1px solid var(--color-border);
    background: rgba(var(--color-accent-rgb), 0.06);
  }
  .cvm-row.foe .cvm-ico {
    border-color: rgba(248, 113, 113, 0.3);
    background: rgba(248, 113, 113, 0.06);
  }
  .cvm-main {
    min-width: 0;
  }
  .cvm-name {
    font-size: 12.5px;
    color: var(--color-text-primary);
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .cvm-row.foe .cvm-name {
    color: #fca5a5;
  }
  .cvm-row.destroyed .cvm-nametext {
    text-decoration: line-through;
  }
  .cvm-tgt {
    font-size: 8px;
    color: var(--color-warning);
    border: 1px solid rgba(251, 191, 36, 0.5);
    border-radius: 4px;
    padding: 0 4px;
    letter-spacing: 0.08em;
  }
  .cvm-sub {
    font-size: 9.5px;
    color: var(--color-text-dim);
    margin-top: 1px;
  }
  /* Stacked micro-bars: hull over shield. */
  .cvm-mbars {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-top: 4px;
  }
  .cvm-mbar {
    position: relative;
    height: 6px;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--color-border);
    overflow: hidden;
  }
  .cvm-mbar > span {
    display: block;
    height: 100%;
    border-radius: 3px;
  }
  .cvm-mbar.hull > span {
    background: linear-gradient(90deg, #34d399, #67e8f9);
  }
  .cvm-mbar.shield > span {
    background: linear-gradient(90deg, #67e8f9, #8ff0e0);
  }
  .cvm-mbar.ehull > span {
    background: linear-gradient(90deg, #f87171, #fbbf24);
  }
  .cvm-mbar.eshield > span {
    background: linear-gradient(90deg, #fbbf24, #fde68a);
  }
  .cvm-vals {
    text-align: right;
    font-family: var(--font-mono);
    font-size: 9.5px;
    color: var(--color-text-secondary);
    line-height: 1.5;
    white-space: nowrap;
    align-self: start;
  }
  .cvm-vals .s {
    color: var(--color-text-dim);
  }

  /* Expanded detail: system + effect + drone pip rows, spanning the full row. */
  .cvm-detail {
    grid-column: 1 / -1;
    padding: 8px 2px 2px;
    border-top: 1px dashed var(--color-border);
    margin-top: 6px;
  }
  .cvm-drow {
    display: flex;
    gap: 7px;
    align-items: center;
    margin-bottom: 6px;
  }
  .cvm-drow:last-child {
    margin-bottom: 0;
  }
  .cvm-dl {
    font-size: 8px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-text-dim);
    width: 66px;
    flex-shrink: 0;
  }
  /* Mobile-only detail pip lists. On touch there is no hover, so each pip is paired
     with its label text inline (see .cvm-pipinfo). The chips stack in a column so a
     long label like "Weapon 1: Degraded" reads on its own line without truncating. */
  .cvm-mini {
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  /* One tappable pip chip: just the small colored pip / effect glyph (no inline text). Its
     info opens in the .cv-tip panel on tap, which is flex 0 0 100% so it wraps onto its own
     full-width line below the horizontal pip row (the tooltip appears under the row). */
  .cvm-pipinfo {
    display: inline-flex;
    align-items: center;
    cursor: pointer;
    flex-shrink: 0;
  }
  .cvm-pipinfo .pip {
    flex-shrink: 0;
  }
  .cvm-none {
    font-size: 9px;
    color: var(--color-text-dim);
  }

  /* ==========================================================================
     VISUAL MODE FX (Combat 0.13.0, Phase 12c). The pops + tracers are created
     IMPERATIVELY in JS (document.createElement) by the afterUpdate driver, so they
     are NOT Svelte-managed and Svelte's scoped-style hashing does not reach them.
     Their rules are therefore written as `.cv-fx-layer :global(.cv-pop)` etc: the
     scoped `.cv-fx-layer` parent (a real template element) carries the component hash
     and `:global(...)` matches the JS-created child inside it. Pops are NEUTRAL by
     default; only a crit or a kill is red (color reserved for the exceptional), and a
     crit is slightly larger. prefers-reduced-motion is honored in the driver (it skips
     the moving tracer + the float), so no motion-only styling is required here.
     ========================================================================== */
  .cv-fx-layer {
    position: absolute;
    inset: 0;
    pointer-events: none; /* never intercepts clicks (close button / toggles stay live) */
    overflow: hidden;
    z-index: 4; /* above the arena, below the .cv-close (z-index 5) */
  }
  /* Base pop: a mono number centered on its anchor point, floating up + fading via the
     transition. The `.rise` class (added on the next frame) is what actually animates it. */
  .cv-fx-layer :global(.cv-pop) {
    position: absolute;
    transform: translate(-50%, -50%);
    font-family: var(--font-mono);
    font-size: 13px;
    font-weight: 700;
    color: var(--color-text-primary); /* NEUTRAL default (the common case) */
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.85);
    white-space: nowrap;
    opacity: 1;
    will-change: transform, opacity;
    transition: transform 0.8s ease-out, opacity 0.8s ease-out;
  }
  .cv-fx-layer :global(.cv-pop.rise) {
    transform: translate(-50%, -150%);
    opacity: 0;
  }
  /* CRIT: red + larger (the two exceptional cues, together). */
  .cv-fx-layer :global(.cv-pop.crit) {
    font-size: 18px;
    color: #e24b4a;
  }
  /* KILL ("destroyed"): red, with a hair of letter-spacing so the word reads. */
  .cv-fx-layer :global(.cv-pop.kill) {
    color: #e24b4a;
    font-size: 13px;
    letter-spacing: 0.06em;
  }
  /* EVADE: a subtle, quiet neutral note (kept understated per the design). */
  .cv-fx-layer :global(.cv-pop.evade) {
    color: var(--color-text-dim);
    font-weight: 600;
    font-size: 11px;
    font-style: italic;
  }
  /* Tracer: a small dot that travels attacker -> target. The family tint is set inline
     (JS) as both background + color, so the glow (currentColor) matches the tint. */
  .cv-fx-layer :global(.cv-tracer) {
    position: absolute;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    transform: translate(-50%, -50%);
    box-shadow: 0 0 6px currentColor;
    transition: left 0.22s linear, top 0.22s linear;
  }
  /* A destroyed ship's card is dimmed imperatively (class added in JS, cleared on FX
     teardown). Scoped under the hashed .cv-dialog so it stays local to this component. */
  .cv-dialog :global(.cv-dimmed) {
    opacity: 0.45;
    transition: opacity 0.3s ease;
  }

  /* VISUAL-MODE FOOTER. Reuses the .log frame (flex:1) so it fills the same space the
     text log does (stable dialog height across modes). A quiet recent-events caption on
     top, a compact legend pinned at the bottom. */
  .cv-vround {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.08em;
    color: var(--color-warning);
  }
  .cv-vcaption {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    font-family: var(--font-mono);
    font-size: 11.5px;
    line-height: 1.7;
    color: var(--color-text-dim);
    padding-right: 8px;
  }
  /* The caption keeps the log's per-line accents but muted (this is a calm recap, not the
     primary read), so a crit/kill line is still recognizable at a glance. */
  .cv-vcap-ln.crit {
    color: var(--color-text-secondary);
    font-weight: 600;
  }
  .cv-vcap-ln.destroy {
    color: var(--color-success);
  }
  .cv-vcap-ln.dot {
    color: #fca5a5;
  }
  .cv-vlegend {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 16px;
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--color-border);
    font-size: 10px;
    letter-spacing: 0.04em;
    color: var(--color-text-dim);
  }
  .cv-vl-item {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .cv-vl-num {
    font-family: var(--font-mono);
    color: var(--color-text-primary);
    font-weight: 700;
  }
  .cv-vl-num.crit {
    color: #e24b4a;
  }
  .cv-vl-swatch {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    display: inline-block;
  }
</style>
