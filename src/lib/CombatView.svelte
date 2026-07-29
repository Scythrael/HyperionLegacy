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
  // MODES. Log-Guided (default) is fully built here. Visual mode (the damage-pop
  // presentation over the ships) is the NEXT unit (Phase 12c): the toggle renders,
  // but Visual shows a "coming soon" placeholder. It is NOT built in this unit.
  // ============================================================================

  import { onDestroy, tick } from "svelte";
  import type { GameState, CaptainState } from "./game/model";
  import { SHIP_TYPES, FACTIONS } from "./game/model";
  import {
    replayPatrol,
    foldWaveSnapshots,
    type PatrolReplay,
  } from "./game/combat/patrolReplay";
  import { interpolateFlavor } from "./game/combat/flavor";
  import { squadronStatusSummary } from "./game/combat/drones";
  import { STATUS_EFFECT_DEFS } from "./game/combat/statusEffects";
  import type { CombatEvent, SystemConditionPip } from "./game/combat/types";
  import type { RangeBand, CombatPhase, CombatStance } from "./game/combat/positioning";
  import type { SystemCondition } from "./game/combat/durability";
  import {
    currentReplayWaveIndex,
    buildNameFor,
    rangeMarkerPercent,
    logLineClass,
    dronePips,
  } from "./game/combat/combatView";

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
    short: "Short band",
    medium: "Medium band",
    long: "Long band",
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

  // How long one round of the log lingers before the next is revealed (design
  // S16: "streams ~1 round/second live"). One knob, not a magic literal.
  const ROUND_MS = 1000;

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

  // The wave to display + its fold into per-round snapshots.
  $: waveIdx = replay.available
    ? currentReplayWaveIndex(missionNextWaveIndex, replay.waves.length)
    : null;
  $: wave = waveIdx !== null ? replay.waves[waveIdx] : null;
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
  // Tracks which wave the current stream belongs to. `undefined` (the initial
  // sentinel) differs from every real index AND from null, so the first reactive
  // run always kicks off a stream.
  let streamWaveKey: number | null | undefined = undefined;

  function stopTimer(): void {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  // (Re)start streaming a wave from round 0. A single-round (or empty) wave has
  // nothing to reveal over time, so it settles immediately with no timer.
  function startStream(max: number): void {
    stopTimer();
    revealedRound = 0;
    if (max <= 0) return;
    timer = setInterval(() => {
      revealedRound += 1;
      if (revealedRound >= max) stopTimer();
    }, ROUND_MS);
  }

  // Skip-to-end: settle the arena + log on the wave's final state at once.
  function skipToEnd(): void {
    stopTimer();
    revealedRound = maxRound;
  }

  // Restart the stream whenever the displayed wave changes (initial open, or the
  // live patrol advancing to a new wave while the view is open). Reads maxRound so
  // Svelte orders this after maxRound is computed for the new wave.
  $: {
    if (waveIdx !== streamWaveKey) {
      streamWaveKey = waveIdx;
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

  $: enemyName = wave && waveIdx !== null && wave.enemyLabels.length > 0 ? wave.enemyLabels[0] : "";
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
  interface LogLine {
    text: string;
    cls: string;
  }
  interface LogRound {
    round: number;
    lines: LogLine[];
  }
  function buildLogRounds(
    log: CombatEvent[] | undefined,
    binder: (id: string) => string,
  ): LogRound[] {
    if (!log) return [];
    // Bucket the flavored events by round in chronological order. Only events that
    // carry a flavor TEMPLATE are narration lines; display-only roundState events
    // (which drive the arena, not the text) carry none and are skipped.
    const byRound = new Map<number, LogLine[]>();
    for (const ev of log) {
      if (ev.flavor === undefined) continue;
      const line: LogLine = {
        text: interpolateFlavor(ev.flavor, ev, binder),
        cls: logLineClass(ev),
      };
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
  $: allLogRounds = buildLogRounds(wave?.log, nameFor);
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
  // Log-Guided is the built default; Visual is the Phase-12c stub (placeholder).
  let mode: "log" | "visual" = "log";

  // --- Auto-scroll the log to the newest revealed round -----------------------
  let logBody: HTMLDivElement | null = null;
  function scrollLogToBottom(): void {
    // Wait for the DOM to reflect the newly-revealed round, then pin to the bottom.
    void tick().then(() => {
      if (logBody) logBody.scrollTop = logBody.scrollHeight;
    });
  }
  // Re-pin whenever the revealed round advances (and only in the Log-Guided view,
  // where the log is on screen).
  $: if (mode === "log" && revealedRound >= 0 && logBody) scrollLogToBottom();
</script>

<!-- The bounded, internally-scrolling dialog surface (mirrors ShipSystemsPanel's
     .ss-dialog: an opaque surface so it stays legible on browsers without
     backdrop blur, and it owns its own scroll rather than growing the page). The
     host wraps this in the shared .modal-backdrop. -->
<div class="cv-dialog" role="document">
  {#if !replay.available || wave === null}
    <!-- Graceful unavailable state: not on a combat patrol, no ship, or a
         non-combat hull. The button should not be shown in that case, but the view
         still handles it rather than rendering a broken arena. -->
    <div class="cv-topbar">
      <div class="ctx">Combat View</div>
      <button class="cv-close" on:click={onClose} aria-label="Close">Close</button>
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
        {#if totalWaves > 0}<span class="wavepill">Wave {(waveIdx ?? 0) + 1} / {totalWaves}</span>{/if}
      </div>
      <div class="cv-topbar-right">
        <div class="mode" role="tablist" aria-label="Combat view mode">
          <button class:on={mode === "log"} on:click={() => (mode = "log")}>Log-Guided</button>
          <button class:on={mode === "visual"} on:click={() => (mode = "visual")}>Visual</button>
        </div>
        <button class="cv-close" on:click={onClose} aria-label="Close">Close</button>
      </div>
    </div>

    <!-- ARENA: player card | center (range + phase) | enemy card. -->
    <div class="arena">
      <!-- PLAYER -->
      <div class="ship">
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
              <span class="pip {effectPipClass(e.defId)}" title={effectPipTitle(e.defId, e.rank)}>{effectPipGlyph(e.defId)}</span>
            {/each}
          </div>
        {/if}

        {#if playerSystemPips.length > 0}
          <div class="piprow">
            <span class="lab">Ship systems</span>
            {#each playerSystemPips as sp (sp.pip.id)}
              <span class="pip {sp.pip.condition}" title={sp.label}></span>
            {/each}
          </div>
        {/if}

        {#if playerDroneSrc}
          {#each playerDroneSrc.drones as squadron (squadron.id)}
            <div class="piprow">
              <span class="lab">Drones ({squadron.model} squadron)</span>
              {#each dronePips(squadronStatusSummary(squadron)) as dp}
                <span class="pip {dp.cls}" title={dp.title}></span>
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
          <div class="bandnow">{rangeBand ? BAND_LABEL[rangeBand] : "—"}</div>
        </div>
        <div class="phase">
          <div class="lab">Phase</div>
          <div class="val">{phase ? PHASE_LABEL[phase] : "—"}</div>
        </div>
      </div>

      <!-- ENEMY -->
      <div class="ship enemy">
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
              <span class="pip {effectPipClass(e.defId)}" title={effectPipTitle(e.defId, e.rank)}>{effectPipGlyph(e.defId)}</span>
            {/each}
          </div>
        {/if}

        {#if enemySystemPips.length > 0}
          <div class="piprow">
            <span class="lab">Ship systems</span>
            {#each enemySystemPips as sp (sp.pip.id)}
              <span class="pip {sp.pip.condition}" title={sp.label}></span>
            {/each}
          </div>
        {/if}

        {#if enemyDroneSrc}
          {#each enemyDroneSrc.drones as squadron (squadron.id)}
            <div class="piprow">
              <span class="lab">Drones ({squadron.model} squadron)</span>
              {#each dronePips(squadronStatusSummary(squadron)) as dp}
                <span class="pip {dp.cls}" title={dp.title}></span>
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
              <div class="extra-row">
                <span class="extra-name">{wave && wave.enemyLabels[i + 1] ? wave.enemyLabels[i + 1] : "Hostile"}</span>
                <div class="bar ehull mini"><span style="width:{pct(foeHull, foe.hullMax)}%"></span></div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    <!-- LOG / VISUAL body. -->
    {#if mode === "log"}
      <div class="log">
        <div class="log-head">
          <span class="t">Combat log &middot; Log-Guided</span>
          <span class="log-head-right">
            {#if !settled}
              <button class="cv-skip" on:click={skipToEnd}>Skip to end</button>
            {/if}
            <span class="t dim">auto-scroll</span>
          </span>
        </div>
        <div class="log-body" bind:this={logBody}>
          {#each shownRounds as r (r.round)}
            <div class="rounddiv">=== Round {r.round + 1} ===</div>
            {#each r.lines as line, li (li)}
              <div class="ln {line.cls}">{line.text}</div>
            {/each}
          {/each}
          {#if shownRounds.length === 0}
            <div class="ln dim">No combat log for this wave.</div>
          {/if}
        </div>
      </div>
    {:else}
      <!-- VISUAL MODE STUB (Phase 12c). The damage-number pops over the ships are
           the NEXT unit; this placeholder keeps the toggle honest without faking
           that presentation. Do NOT build the damage-pop visual here. -->
      <div class="log">
        <div class="log-head"><span class="t">Combat view &middot; Visual</span></div>
        <div class="cv-visual-stub">
          Visual mode (family-styled damage pops over the ships) arrives in a later
          update. Switch to Log-Guided to watch the round-by-round combat log.
        </div>
      </div>
    {/if}
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
    width: min(1080px, 100%);
    max-height: calc(100vh - 40px);
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
    padding: 12px 16px;
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
  .cv-close,
  .cv-skip {
    background: transparent;
    border: 1px solid var(--color-border);
    border-radius: 8px;
    color: var(--color-text-secondary);
    font-size: 11.5px;
    padding: 6px 11px;
    cursor: pointer;
    letter-spacing: 0.04em;
  }
  .cv-close:hover,
  .cv-skip:hover {
    color: var(--color-accent-bright);
    border-color: var(--color-border-strong);
  }

  .cv-unavailable,
  .cv-visual-stub {
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
  }
  @media (max-width: 760px) {
    .arena {
      grid-template-columns: 1fr;
    }
    .center-col {
      order: 3;
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

  /* Log. */
  .log {
    border-top: 1px solid var(--color-border);
    padding: 14px 16px 16px;
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
  .log-head .t.dim {
    color: var(--color-text-dim);
  }
  .log-head-right {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .log-body {
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.75;
    max-height: 230px;
    overflow-y: auto;
    padding-right: 8px;
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
</style>
