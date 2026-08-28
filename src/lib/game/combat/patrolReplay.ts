// ============================================================================
// combat/patrolReplay.ts -- DISPLAY-ONLY deterministic patrol replay + per-round
// snapshot fold (Combat 0.13.0, Phase 12b-1)
//
// WHAT THIS IS (and, just as importantly, what it is NOT):
// A "watch the combat" UI needs the full per-wave event stream of a patrol so it can
// render the battle. This module regenerates that stream ON DEMAND from the patrol's
// PERSISTED master seed + the ship's loadout + the initial full-hull state, exactly
// the "a battle's log COULD be regenerated later" capability the design calls for
// (Section 17). It is a PURE, READ-ONLY reproduction: it reruns each wave through the
// SAME deterministic leaves the live tick loop uses (deriveWaveSeed with the SAME
// salts, generateEnemyWave, the shared player-combatant + shield-regen leaves in
// patrolWave.ts, resolveBattle, replenishDrones), so the replay's outcomes are
// BYTE-IDENTICAL to what the live loop resolved.
//
// HARD CONTRACT -- DISPLAY ONLY:
//   - It MUST NOT mutate GameState, the captain, the mission, the ship, or ANY input.
//   - It does NOT award loot / XP, does NOT advance progress, does NOT touch fuel /
//     credits, does NOT flag the ship damaged. It only READS the persisted seed +
//     loadout and returns a fresh, self-contained data structure the UI renders.
//   - It runs resolveBattle with generateLog:true (the flavored event stream). That
//     touches ONLY the cosmetic RNG stream, which by construction cannot change the
//     OUTCOME (Phase 12a proved the isolation), so the outcome still equals the live
//     loop's generateLog:false resolution (the parity gate the tests enforce).
//
// PARITY IS STRUCTURAL, NOT COINCIDENTAL: this module deliberately does NOT re-derive
// any wave math. It imports deriveWaveSeed + the two wave salts from the shared combat/
// leaf (waveSeed.ts, which the live loop ALSO imports) and calls the same generateEnemyWave
// / resolveBattle / patrolWave leaves, so there is one source of truth for "how a wave
// resolves" and this display module never imports UP into tick.ts. The ORCHESTRATION the
// live loop wraps around those leaves (limp-home, relaunch, fuel, credits, rewards)
// is irrelevant to a display replay and is intentionally NOT reproduced here: a replay
// shows ONE patrol cycle's waves from full hull, which is exactly the fight the player
// wants to watch.
// ============================================================================

import {
  SHIP_TYPES,
  PATROLS,
  type GameState,
  type CaptainState,
  type PatrolDef,
  type PatrolKey,
  type PatrolSystemDurability,
  type EquipmentInstance,
} from "../model";
// Combat 1.0 (Unit 1.4): the SAME fitted-gear query the live tick loop uses (equippedFor), so the
// display replay derives the player's installed combat gear byte-identically to the real fight and
// the two combatants cannot drift. equipment.ts imports only model, so this is a clean down-import
// (no cycle: it never reaches back into this combat leaf).
import { equippedFor } from "../equipment";
import {
  combatHullTypeOf,
  installedDronesForPatrol,
  defaultSystemDurabilityForHull,
  foldedPlayerDefense,
  type CombatHullType,
  type CombatShipStats,
} from "./bridge";
import type { CombatStance } from "./positioning";
import {
  buildPatrolPlayerCombatant,
  regenPatrolShield,
  capturePlayerSystemDurability,
} from "./patrolWave";
import { generateEnemyWaveDetailed } from "./enemyWave";
import { resolveBattle } from "./resolveBattle";
import { replenishDrones } from "./droneDefense";
import { PIRATE_HULLS, type PirateHullId } from "./enemyHulls";
import type {
  Combatant,
  CombatEvent,
  BattleOutcome,
  SystemConditionPip,
} from "./types";
import type { RangeBand, CombatPhase } from "./positioning";
import type { DroneSquadron } from "./drones";
// The schedule params mapper + the schedule generator both live in the waveSchedule
// leaf; the per-wave seed derivation + its two salts live in the waveSeed leaf. Importing
// them (rather than re-declaring) is the WHOLE POINT: the replay derives every enemy/battle
// seed with the identical inputs the live loop used, so the two cannot drift. These are
// combat/ LEAVES: this display module imports DOWN into them, never UP into the live loop
// (tick.ts). tick.ts imports the SAME leaves, so there is one source of truth and no cycle.
import { planWaveSchedule, patrolWaveParams } from "./waveSchedule";
import {
  deriveWaveSeed,
  WAVE_ENEMY_SEED_SALT,
  WAVE_BATTLE_SEED_SALT,
} from "./waveSeed";

// ---------------------------------------------------------------------------
// PUBLIC RESULT SHAPES.
// ---------------------------------------------------------------------------

// One replayed wave, everything the combat view needs to render it.
export interface PatrolReplayWave {
  // 0-based wave index (the enemy/battle seeds derive off this + the master seed).
  waveIndex: number;
  // The absolute route tick this wave fires at (from the persisted wave schedule).
  routeTick: number;
  // The picked pirate hull id per enemy (stable ids; UI icon keys), aligned to the
  // enemyStart / enemyEnd arrays by index.
  enemyHullIds: PirateHullId[];
  // The player-facing enemy hull NAMES (PIRATE_HULLS[id].name), the composition
  // readout for the combat view. Aligned by index to enemyHullIds.
  enemyLabels: string[];
  // The flavored structured event stream for this wave (generateLog:true). The UI
  // folds this (see foldWaveSnapshots) or streams it round-by-round.
  log: CombatEvent[];
  // The resolved battle outcome (winner / reason / rounds).
  outcome: BattleOutcome;
  // The player combatant at wave START (hull/shield/drones/statusEffects the UI reads
  // for the opening arena state). A private clone: safe to keep + mutate.
  playerStart: Combatant;
  // The player combatant AFTER the wave (surviving hull/shield/drones). undefined only
  // in the defensive case the sim returned no player (never in normal play).
  playerEnd: Combatant | undefined;
  // The enemy team at wave START, one Combatant per enemy (aligned to the hull id/label
  // arrays). Private clones.
  enemyStart: Combatant[];
  // The enemy team AFTER the wave (final hull/alive state for the arena). Private clones.
  enemyEnd: Combatant[];
  // True iff the player WON this wave, using the EXACT live-loop win test (objective
  // named "player" AND the player is actually alive with hull > 0). A false here is the
  // wave the live loop would switch into limp-home on; no later waves are replayed.
  playerWon: boolean;
}

// The full replay of one patrol cycle.
export interface PatrolReplay {
  // False when the captain is not on a patrol, flies no ship, or flies a non-combat
  // hull. The waves array is empty and the tallies are 0 in that case.
  available: boolean;
  // Echoed patrol identity (present only when available), handy for the UI header.
  patrolKey?: PatrolKey;
  factionId?: string;
  masterSeed?: number;
  stance?: CombatStance;
  // Every wave the cycle fights, in order. Ends early (before the schedule's last wave)
  // if the player is defeated, mirroring the live loop switching to limp-home.
  waves: PatrolReplayWave[];
  // How many waves the player won (== waves.length on a clean full-clear; == the index
  // of the lost wave on a defeat).
  wavesWon: number;
  // True iff the player lost a wave (the live loop would limp the ship home + flag it
  // damaged). No loot/XP/damage is applied here regardless: this is display only.
  defeated: boolean;
  // The player's carry hull after the last resolved wave (post-battle; hull never
  // regenerates between waves). On a defeat this is the surviving hull at the loss.
  finalPlayerHull: number;
  // The player's carry shield after the last resolved wave (post-battle, before any
  // trailing transit-back regen, which does not feed another battle).
  finalPlayerShield: number;
}

// ---------------------------------------------------------------------------
// LOW-LEVEL WAVE RESOLVER (exported for tests + reuse).
//
// Resolves every wave of one patrol cycle from a fully-resolved input set + a STARTING
// carry-state, returning the per-wave records + the terminal tallies. replayPatrol
// (below) is the thin public wrapper that fills these inputs from a captain-on-patrol
// with the FULL-hull start the design specifies; this lower level takes the start
// carry-state explicitly so a test can drive a guaranteed-defeat wave (e.g. a near-dead
// starting hull) with the SAME code path, exactly as the live tick loop's own tests do.
//
// PURITY: clones the starting drones on entry and carries only private clones forward,
// so no input array is ever mutated. resolveBattle clones its participants internally
// too, so nothing the caller passes is touched.
// ---------------------------------------------------------------------------
export interface ResolvePatrolWavesInput {
  // The player combatant's stable id (the ShipInstance id in normal play), so the
  // replay's turn order matches the live loop's.
  playerId: string;
  // The ship's combat stats (a SHIP_TYPES entry structurally satisfies this).
  stats: CombatShipStats;
  // The combat hull class (drives default weapons + a carrier's drone screen).
  hullType: CombatHullType;
  // The player's combat stance for every wave.
  stance: CombatStance;
  // Combat 1.0 (Unit 1.4): the ship's INSTALLED combat gear (equippedFor off the SAME GameState the
  // live loop reads), passed to buildPatrolPlayerCombatant so the replayed player combatant reads
  // the same real weapons + shield + hull + defenses the live fight did (byte-identical parity).
  // OPTIONAL: absent falls back to the hull-default build (used by the low-level resolvePatrolWaves
  // tests), which for a Standard-Issue set is byte-identical to the geared build. The public
  // replayPatrol wrapper always passes the ship's real gear.
  installedGear?: EquipmentInstance[];
  // The persisted master seed every wave's enemy/battle seed derives from.
  masterSeed: number;
  // The faction id, forming each wave's enemy id prefix (`${factionId}-w${waveIndex}`),
  // which must match the live loop exactly (enemy ids feed the sim's turn-order sort).
  factionId: string;
  // The patrol def (hull pool, enemy-count band, and the wave-schedule params).
  def: PatrolDef;
  // The player's STARTING carry hull (full-hull in normal replay).
  startHull: number;
  // The player's STARTING carry shield (full in normal replay).
  startShield: number;
  // The player's STARTING drone squadrons (a carrier's screen; empty otherwise). Cloned
  // on entry, never mutated.
  startDrones: DroneSquadron[];
  // The player's STARTING per-system durability (Phase 12b Unit B2). FULL in the normal
  // replayPatrol path (a cycle opens with no wear). Carried wave-to-wave here the SAME way
  // the live loop carries it, so the replay's accumulating wear stays byte-identical to the
  // real fight (and the combat view's durability pips cannot drift). Read-only, never mutated.
  startSystemDurability: PatrolSystemDurability;
}

export interface ResolvePatrolWavesResult {
  waves: PatrolReplayWave[];
  wavesWon: number;
  defeated: boolean;
  finalPlayerHull: number;
  finalPlayerShield: number;
}

export function resolvePatrolWaves(input: ResolvePatrolWavesInput): ResolvePatrolWavesResult {
  const { playerId, stats, hullType, stance, masterSeed, factionId, def } = input;

  // Combat-defense BLOCKER fix (2026-08-27): the FOLDED shield cap + recharge for the between-wave
  // regen below, derived from the SAME installed-gear fold the wave combatant fights with
  // (foldedPlayerDefense -> shipToCombatant), NOT the raw authored SHIP_TYPES stats. A crafted emitter
  // recharges above authored cap, so clamping the regen to authored stripped it away. The live tick
  // loop folds the identical value (tick.ts foldedDefense), keeping the two paths byte-identical. For a
  // Standard-Issue set (or the low-level tests' absent gear) this folds to the authored stats exactly,
  // so no existing replay/parity outcome moves.
  const foldedDefense = foldedPlayerDefense(stats, input.installedGear);

  // The wave schedule: a pure function of the master seed + def params, IDENTICAL to
  // the array freshPatrolMission persisted at dispatch (same call), so the replay's
  // wave ticks match the live cycle's exactly.
  const waveTicks = planWaveSchedule(masterSeed, patrolWaveParams(def));

  // Carry-state, seeded from the caller. startDrones is deep-cloned so the between-wave
  // recovery (which mutates drone state in place) never touches the caller's array.
  let carryHull = input.startHull;
  let carryShield = input.startShield;
  let carryDrones = input.startDrones.map(cloneSquadron);
  // Per-system durability carry-state (Phase 12b Unit B2). A shallow copy on entry (its arrays
  // are re-created wholesale by capturePlayerSystemDurability each wave, never mutated in place),
  // so the caller's input object is never touched (purity).
  let carrySystemDurability: PatrolSystemDurability = {
    weapons: [...input.startSystemDurability.weapons],
    reactor: input.startSystemDurability.reactor,
    ftl: input.startSystemDurability.ftl,
  };

  const waves: PatrolReplayWave[] = [];
  let wavesWon = 0;
  let defeated = false;

  // The previous wave's route tick, so the inter-wave recovery count is the number of
  // NON-wave whole route ticks strictly between two waves. 0 before the first wave, so the
  // pre-first-wave transit ticks (routeTick[0] - 0 - 1 of them) also apply the per-tick
  // recovery below. In the public replayPatrol path the start pools are already FULL, so
  // that pre-wave-0 shield regen is a no-op; in the low-level resolvePatrolWaves path a
  // caller may pass a DAMAGED start (e.g. the defeat-path test), and then this pre-wave-0
  // regen genuinely applies -- correctly, because the live loop likewise regenerates on
  // those same pre-first-wave transit ticks.
  let prevWaveTick = 0;

  for (let waveIndex = 0; waveIndex < waveTicks.length; waveIndex++) {
    const routeTick = waveTicks[waveIndex];

    // BETWEEN-WAVE RECOVERY (design S14). The live loop applies shield-regen +
    // replenishDrones on EVERY non-wave whole route tick; between wave (i-1) and wave i
    // that is exactly (routeTick - prevWaveTick - 1) ticks. Apply the SAME per-tick
    // recovery that many times so the carry-state entering this wave is byte-identical.
    const recoveryTicks = routeTick - prevWaveTick - 1;
    for (let r = 0; r < recoveryTicks; r++) {
      carryShield = regenPatrolShield(foldedDefense.shieldMax, carryShield, foldedDefense.shieldRecharge);
      for (const squadron of carryDrones) {
        replenishDrones(squadron, squadron.droneReplenishRate);
      }
    }

    // PLAYER combatant from the carry-state, via the SHARED leaf the live loop uses.
    const player = buildPatrolPlayerCombatant({
      playerId,
      stats,
      hullType,
      stance,
      // Unit 1.4: the same installed gear the live loop passes, so the combatants match byte-for-byte.
      installedGear: input.installedGear,
      carryHull,
      carryShield,
      carryDrones,
      // Phase 12b Unit B2: apply the accumulated per-system durability, exactly as the live
      // loop does (same shared leaf), so the replayed wave opens with the same wear the real
      // fight had (parity), and Degraded/Offline pips in the combat view are truthful.
      carrySystemDurability,
    });

    // ENEMY team + labels, from the ENEMY-salt derivation with the SAME idPrefix the
    // live loop uses. generateEnemyWaveDetailed produces the identical enemy Combatant[]
    // generateEnemyWave would (it delegates here), plus the picked hull ids for labels.
    const { enemies, hullIds } = generateEnemyWaveDetailed(
      deriveWaveSeed(masterSeed, waveIndex, WAVE_ENEMY_SEED_SALT),
      {
        hullPool: def.hullPool,
        enemyCountMin: def.enemyCountMin,
        enemyCountMax: def.enemyCountMax,
        idPrefix: `${factionId}-w${waveIndex}`,
      },
    );

    // Snapshot the START state before the battle. resolveBattle does NOT mutate its
    // inputs (it clones internally), but we clone anyway so the returned record is a
    // fully independent, stable object the UI can hold onto.
    const playerStart = cloneCombatant(player);
    const enemyStart = enemies.map(cloneCombatant);

    // BATTLE with the BATTLE-salt derivation (distinct from the enemy seed) and
    // generateLog:true for the flavored stream. The outcome is byte-identical to the
    // live loop's generateLog:false resolution (cosmetic-stream isolation).
    const { outcome, log, finalCombatants } = resolveBattle(
      { combatants: [player, ...enemies] },
      deriveWaveSeed(masterSeed, waveIndex, WAVE_BATTLE_SEED_SALT),
      { generateLog: true },
    );

    // Read the player + enemies out of the id-SORTED finalCombatants BY ID (never by
    // index). finalCombatants members are the sim's private clones (safe to keep).
    const playerEnd = finalCombatants.find((c) => c.id === playerId);
    const enemyEnd = finalCombatants.filter((c) => c.id !== playerId);

    // The EXACT live-loop win test: the objective named "player" AND the player is
    // actually alive with hull > 0 (a cap-tiebreak "player" with a dead player, or a
    // missing player, is a loss).
    const playerWon =
      outcome.winner === "player" &&
      playerEnd !== undefined &&
      playerEnd.alive &&
      playerEnd.hull > 0;

    waves.push({
      waveIndex,
      routeTick,
      enemyHullIds: hullIds,
      enemyLabels: hullIds.map((id) => PIRATE_HULLS[id].name),
      log,
      outcome,
      playerStart,
      // Clone playerEnd into the record so carrying the live playerEnd forward (and the
      // next gap's in-place recovery on its drones) cannot retroactively mutate this
      // wave's recorded end-state.
      playerEnd: playerEnd ? cloneCombatant(playerEnd) : undefined,
      enemyStart,
      enemyEnd: enemyEnd.map(cloneCombatant),
      playerWon,
    });

    if (playerWon) {
      wavesWon += 1;
      // Carry the surviving hull/shield/drones forward (attrition). playerEnd is the
      // sim's private clone; recovery mutates its drones next gap, not the record's.
      carryHull = playerEnd!.hull;
      carryShield = playerEnd!.shield;
      carryDrones = playerEnd!.drones;
      // Carry the post-battle per-system durability forward (Phase 12b Unit B2), via the SAME
      // capture leaf the live loop uses, so the wear entering the next replayed wave matches the
      // real fight exactly. A fresh object (never a mutation of the input), keeping purity.
      carrySystemDurability = capturePlayerSystemDurability(playerEnd!);
    } else {
      // DEFEAT: the live loop switches to limp-home here and fights NO further waves, so
      // the replay stops too. Record the surviving hull for the terminal readout.
      defeated = true;
      carryHull = playerEnd ? playerEnd.hull : carryHull;
      carryShield = playerEnd ? playerEnd.shield : carryShield;
      break;
    }

    prevWaveTick = routeTick;
  }

  return {
    waves,
    wavesWon,
    defeated,
    finalPlayerHull: carryHull,
    finalPlayerShield: carryShield,
  };
}

// ---------------------------------------------------------------------------
// PUBLIC ENTRY: replay a captain's CURRENT patrol from full hull.
//
// Reads (never writes) the captain's mission + assigned ship, reconstructs the FULL
// initial carry-state the cycle started from (the design's "initial full-hull state"),
// and resolves every wave. Returns { available:false } (empty) when the captain is not
// on a patrol, flies no ship, or flies a non-combat hull.
//
// Note (parity with the live cycle): the replay reconstructs from the CURRENT mission's
// persisted masterSeed + full hull. Within one cycle the masterSeed is invariant (it
// only changes on a relaunch, which begins a new cycle), so this shows exactly the
// waves of the patrol currently in flight, from its opening.
// ---------------------------------------------------------------------------
export function replayPatrol(state: GameState, captain: CaptainState): PatrolReplay {
  const mission = captain.mission;
  if (mission === null || mission.kind !== "patrol") return unavailableReplay();

  // The captain's assigned hull (assignedCaptainId is the single source of truth).
  const ship = state.ships.find((s) => s.assignedCaptainId === captain.id);
  if (!ship) return unavailableReplay();

  // A patrol requires a combat hull; a non-combat hull (or unknown key) is unavailable.
  const hullType = combatHullTypeOf(ship.typeKey);
  if (hullType === null) return unavailableReplay();

  const shipDef = SHIP_TYPES[ship.typeKey];
  const def = PATROLS[mission.patrolKey];

  // The ship's INSTALLED combat gear, read the SAME way the live tick loop reads it (equippedFor off
  // this GameState). Resolved ONCE and used for BOTH the player combatant's weapons/shield/hull/defenses
  // (Unit 1.4) AND the initial drone carry-state (Unit 2.3b) below, so the replay's two drone-seeding
  // and combatant-building reads can never drift from each other or from the live fight.
  const installedGear = equippedFor(state, ship.id);

  // The FULL initial carry-state (mirrors freshPatrolMission exactly): full hull, full shield, and the
  // drones the ship's INSTALLED droneBay pods field, keyed to the master seed (Unit 2.3b). Built from
  // the SAME installedDronesForPatrol + idPrefix the live seed uses, so a crafted pod's squadron shows
  // in the replay identically to the real patrol; a Standard-Issue carrier is byte-identical to the old
  // default-screen seed. Freshly built, so no input is shared.
  const startDrones = installedDronesForPatrol(installedGear, `patrol-${mission.masterSeed}-p`);

  // Combat-defense BLOCKER fix (2026-08-27): the FULL hull/shield start pools folded from the ship's
  // INSTALLED gear (the SAME pool the wave combatant fights with, and the SAME seed freshPatrolMission
  // uses live), NOT the raw authored SHIP_TYPES stats. A Standard-Issue set folds to the authored stats
  // exactly, so an SI replay is byte-identical to before; a crafted-plated/emitter ship now opens the
  // replay at its real folded pools, matching the live cycle it is reproducing.
  const startDefense = foldedPlayerDefense(shipDef, installedGear);

  const resolved = resolvePatrolWaves({
    playerId: ship.id,
    stats: shipDef,
    hullType,
    stance: mission.stance,
    // Unit 1.4: the ship's installed combat gear (resolved once above), so the replayed player
    // combatant matches the real fight byte-for-byte.
    installedGear,
    masterSeed: mission.masterSeed,
    factionId: mission.factionId,
    def,
    startHull: startDefense.hullMax,
    startShield: startDefense.shieldMax,
    startDrones,
    // FULL system durability at the cycle's opening (Phase 12b Unit B2): the replay reconstructs
    // from the initial no-wear state, exactly as freshPatrolMission seeded the live cycle, so
    // both accumulate identical wear across the waves.
    startSystemDurability: defaultSystemDurabilityForHull(hullType, shipDef, installedGear),
  });

  return {
    available: true,
    patrolKey: mission.patrolKey,
    factionId: mission.factionId,
    masterSeed: mission.masterSeed,
    stance: mission.stance,
    ...resolved,
  };
}

// The empty replay for a captain that has no patrol to watch. Its own function so the
// three early-return sites above share one shape (and a future field is added once).
function unavailableReplay(): PatrolReplay {
  return {
    available: false,
    waves: [],
    wavesWon: 0,
    defeated: false,
    finalPlayerHull: 0,
    finalPlayerShield: 0,
  };
}

// ---------------------------------------------------------------------------
// PER-ROUND SNAPSHOT FOLD.
//
// The combat view renders the arena round-by-round. This folds one wave's CombatEvent[]
// into an ordered list of per-round snapshots: applying every event with round <= N
// yields the arena state AT round N. It reads ONLY what the event stream genuinely
// carries: per-combatant hull / shield (from each event's hullAfter / shieldAfter),
// active status effects (from effectApplied / dot applications, removed on droneCleanse
// AND effectExpired), and the per-round range / band / phase readout (from Phase 12b's
// "roundState" events). It does NOT invent anything the stream does not provide.
//
// ⚠️ WHAT THE STREAM CANNOT FEED (reported honestly, NOT fabricated here): the event
// stream still carries no absolute per-squadron drone pip counts (online/disrupted/
// refabricating, only incremental engage/restore signals exist). Those arena elements
// must come from elsewhere (the wave's playerStart/enemyStart/playerEnd/enemyEnd
// combatants give drone start/end summaries via squadronStatusSummary) or await a later
// unit that emits them. This fold deliberately omits them rather than guessing.
//
// PER-SYSTEM DURABILITY CONDITION (now fed, Phase 12b Unit B1): the sim emits each
// living combatant's ship-system condition pips (each weapon + reactor + ftl, as
// Nominal/Degraded/Disrupted/Offline) on its DISPLAY-ONLY "roundState" events. The fold
// carries the latest set per combatant, so the combat view can render per-system pips.
//
// STATUS-EFFECT EXPIRY (now handled in Phase 12b): the sim emits a DISPLAY-ONLY
// "effectExpired" event when an effect's timer runs out and it is removed (the natural-
// expiry path, distinct from a droneCleanse). The fold consumes it, dropping the pip on
// expiry, so a status pip no longer lingers past its real duration. (An effect pip never
// moved hull/shield, which come from each event's hullAfter/shieldAfter, so this only
// corrects the pip display, it never touched the arena bars.)
// ---------------------------------------------------------------------------

// One combatant's rendered state at a given round.
export interface CombatantSnapshot {
  // The combatant id (matches the ids in the wave's combatants).
  id: string;
  // Last-known hull for this combatant up to this round, or null if the log (and the
  // optional baseline) never carried a hull value for it yet.
  hull: number | null;
  // Last-known shield up to this round, or null if never carried yet.
  shield: number | null;
  // The active status effects on this combatant, each with its latest rank. Built from
  // effectApplied / dot applications; removed on droneCleanse AND on effectExpired (an
  // effect's timer running out). See the fold header: pips now drop on real expiry, so
  // one no longer lingers past its duration.
  effects: SnapshotEffect[];
  // The combatant's engagement RANGE readout at this round (Phase 12b "roundState"):
  // its distance to its current target + the derived band, for the combat view's range
  // track + band label. null until a roundState event for this combatant has been folded
  // (e.g. a combatant seeded only from the baseline before round 0's readout).
  range: SnapshotRange | null;
  // The combatant's engagement PHASE at this round (detection -> intercept ->
  // weapons-ready -> firing), for the phase narration line. null until a roundState
  // event for this combatant has been folded.
  phase: CombatPhase | null;
  // The combatant's ship-system condition pips at this round (each weapon + reactor +
  // ftl, Phase 12b Unit B1), for the combat view's per-system pip row. null until a
  // roundState event carrying them has been folded for this combatant.
  systemConditions: SystemConditionPip[] | null;
}

// One active status effect on a combatant at a round (the pip + tooltip data).
export interface SnapshotEffect {
  defId: string;
  rank: number;
}

// A combatant's range readout at a round: the raw 1D distance to its current target
// plus the band that distance falls in (short / medium / long). Both come straight off
// the sim's "roundState" event (Phase 12b), which derives the band via positioning.ts
// bandFor (the single source of truth for the thresholds).
export interface SnapshotRange {
  distance: number;
  band: RangeBand;
}

// The arena state at one round: every combatant that has appeared, keyed by id.
export interface RoundSnapshot {
  // The 1-second round index this snapshot represents (0-based).
  round: number;
  // Per-combatant state, keyed by combatant id.
  combatants: Record<string, CombatantSnapshot>;
}

export function foldWaveSnapshots(
  log: CombatEvent[],
  // Optional baseline: the wave's starting combatants (playerStart + enemyStart), used
  // to seed round-0 hull/shield/effects so a combatant that is never TARGETED still
  // renders its opening pools. Omit and the fold shows only combatants that appear as an
  // event target (graceful degradation -- a combatant with no events simply has no row
  // until one references it).
  initial?: Combatant[],
): RoundSnapshot[] {
  // Running state, mutated as events apply in round order.
  const hull = new Map<string, number>();
  const shield = new Map<string, number>();
  // id -> (defId -> rank). A nested map so an effect's rank updates in place and a
  // cleanse / expiry removes it cleanly.
  const effects = new Map<string, Map<string, number>>();
  // id -> the combatant's latest range readout (distance + band), from roundState.
  const range = new Map<string, SnapshotRange>();
  // id -> the combatant's latest engagement phase, from roundState.
  const phase = new Map<string, CombatPhase>();
  // id -> the combatant's latest ship-system condition pips, from roundState (B1).
  const systemConditions = new Map<string, SystemConditionPip[]>();

  // Seed the baseline from the starting combatants (real start state, not invented).
  if (initial) {
    for (const c of initial) {
      hull.set(c.id, c.hull);
      shield.set(c.id, c.shield);
      if (c.statusEffects.length > 0) {
        const m = new Map<string, number>();
        for (const e of c.statusEffects) m.set(e.defId, e.rank);
        effects.set(c.id, m);
      }
    }
  }

  // Bucket events by round so we can fold in strict round order (the log is emitted
  // chronologically, and each event already carries its round, including the per-round
  // aggregated dot lines which are stamped with the round they summarize).
  const byRound = new Map<number, CombatEvent[]>();
  let maxRound = 0;
  for (const ev of log) {
    maxRound = Math.max(maxRound, ev.round);
    const bucket = byRound.get(ev.round);
    if (bucket) bucket.push(ev);
    else byRound.set(ev.round, [ev]);
  }

  // Apply one event to the running state. Only fields the stream genuinely carries move
  // state; everything else is ignored (no fabrication).
  const applyEvent = (ev: CombatEvent): void => {
    if (ev.targetId !== undefined) {
      // hullAfter / shieldAfter are the TARGET's post-event pools (present on shot,
      // evade, dot, drone-volley, ambush, support events). Reflect/counter events carry
      // damage but no after-value, so they do not move the folded pool (a known, minor
      // limitation noted in the header).
      if (ev.hullAfter !== undefined) hull.set(ev.targetId, ev.hullAfter);
      if (ev.shieldAfter !== undefined) shield.set(ev.targetId, ev.shieldAfter);
    }

    // Status-effect application: effectApplied (a weapon landed a disruption/DoT) and dot
    // (a per-round DoT tick line) both carry the def id + rank on the afflicted target.
    if ((ev.type === "effectApplied" || ev.type === "dot") && ev.effectDefId && ev.targetId) {
      const m = effects.get(ev.targetId) ?? new Map<string, number>();
      m.set(ev.effectDefId, ev.effectRank ?? 1);
      effects.set(ev.targetId, m);
    }

    // NOTE: effect REMOVALS (droneCleanse / effectExpired) are NOT applied here. They run
    // in a SECOND pass per round (applyRemoval below) so a round-N removal wins over that
    // same round's aggregated `dot` line. The dot line is flushed at the round N+1 boundary
    // but stamped round N, so within the bucket it can TRAIL the effectExpired event; a
    // single-pass fold would let the trailing dot re-add the pip the expiry just dropped
    // (the DoT pip over-report). Two passes make the end-of-round-N snapshot correct.

    // Per-round arena readout (Phase 12b "roundState"): the actor's range (distance +
    // band) and engagement phase. Keyed by the ACTOR (the ship the readout is for), which
    // the event carries in actorId. Graceful on absent fields (an old log without
    // roundState simply never sets these, leaving range/phase null).
    if (ev.type === "roundState" && ev.actorId) {
      if (ev.distance !== undefined && ev.band !== undefined) {
        range.set(ev.actorId, { distance: ev.distance, band: ev.band });
      }
      if (ev.phase !== undefined) phase.set(ev.actorId, ev.phase);
      // Ship-system condition pips (Phase 12b Unit B1). Copy the array into a fresh
      // list so a later round's readout cannot retroactively mutate an earlier one.
      if (ev.systemConditions !== undefined) {
        systemConditions.set(
          ev.actorId,
          ev.systemConditions.map((p) => ({ ...p })),
        );
      }
    }
  };

  // SECOND-PASS applier: effect removals only (a support-drone cleanse OR a natural expiry,
  // Phase 12b). Run AFTER every addition in the same round (see the note in applyEvent) so a
  // round-N expiry/cleanse strips the pip even when that round's trailing `dot` line re-adds
  // it. This is what actually fixes the DoT pip over-report (a pip lingering past its real
  // duration); a single-pass, event-order fold does not, because the aggregated dot line is
  // stamped round N but ordered after the effectExpired within the bucket.
  const applyRemoval = (ev: CombatEvent): void => {
    if (
      (ev.type === "droneCleanse" || ev.type === "effectExpired") &&
      ev.effectDefId &&
      ev.targetId
    ) {
      effects.get(ev.targetId)?.delete(ev.effectDefId);
    }
  };

  // Fold round by round, emitting one snapshot per round from 0..maxRound. If the log is
  // empty and no baseline was given, this yields a single round-0 snapshot with no
  // combatants (graceful, not a throw). Two passes per round: additions first, then removals,
  // so an expiry wins over its own round's final dot line (see applyRemoval).
  const snapshots: RoundSnapshot[] = [];
  for (let round = 0; round <= maxRound; round++) {
    const bucket = byRound.get(round) ?? [];
    for (const ev of bucket) applyEvent(ev);
    for (const ev of bucket) applyRemoval(ev);
    snapshots.push(
      snapshotOf(round, hull, shield, effects, range, phase, systemConditions),
    );
  }
  return snapshots;
}

// Build a RoundSnapshot from the current running maps (a deep copy so later rounds do
// not retroactively mutate an already-emitted snapshot).
function snapshotOf(
  round: number,
  hull: Map<string, number>,
  shield: Map<string, number>,
  effects: Map<string, Map<string, number>>,
  range: Map<string, SnapshotRange>,
  phase: Map<string, CombatPhase>,
  systemConditions: Map<string, SystemConditionPip[]>,
): RoundSnapshot {
  // The union of every id seen in any map (a combatant may appear via hull-only,
  // shield-only, effect-only, or roundState-only events).
  const ids = new Set<string>([
    ...hull.keys(),
    ...shield.keys(),
    ...effects.keys(),
    ...range.keys(),
    ...phase.keys(),
    ...systemConditions.keys(),
  ]);
  const combatants: Record<string, CombatantSnapshot> = {};
  for (const id of ids) {
    const effMap = effects.get(id);
    const pips = systemConditions.get(id);
    combatants[id] = {
      id,
      hull: hull.has(id) ? hull.get(id)! : null,
      shield: shield.has(id) ? shield.get(id)! : null,
      effects: effMap
        ? [...effMap.entries()].map(([defId, rank]) => ({ defId, rank }))
        : [],
      // range/band + phase are per-combatant (from its roundState events); null until
      // one has been folded (e.g. a baseline-only combatant before round 0's readout).
      range: range.has(id) ? { ...range.get(id)! } : null,
      phase: phase.has(id) ? phase.get(id)! : null,
      // Ship-system condition pips (Phase 12b Unit B1); copied so a later round cannot
      // retroactively mutate this snapshot. null until a roundState carrying them folds.
      systemConditions: pips ? pips.map((p) => ({ ...p })) : null,
    };
  }
  return { round, combatants };
}

// ---------------------------------------------------------------------------
// LOCAL DEEP-CLONE HELPERS. Combatants + squadrons are plain data, so a spread per
// nested level is a full clone. Kept private (mirrors resolveBattle's cloneParticipants
// intent) so the replay hands back fully independent, mutation-safe records.
// ---------------------------------------------------------------------------

function cloneSquadron(squadron: DroneSquadron): DroneSquadron {
  return { ...squadron, drones: squadron.drones.map((d) => ({ ...d })) };
}

function cloneCombatant(c: Combatant): Combatant {
  return {
    ...c,
    weapons: c.weapons.map((w) => ({ ...w, effectSlots: [...w.effectSlots] })),
    statusEffects: c.statusEffects.map((e) => ({ ...e })),
    damageResist: { ...c.damageResist },
    disruptionResist: { ...c.disruptionResist },
    drones: c.drones.map(cloneSquadron),
    // Phase 12b Unit B1: fresh reactor + ftl so a snapshot record is fully independent
    // (mirrors the weapon clone above). Undefined stays undefined.
    reactor: c.reactor !== undefined ? { ...c.reactor } : undefined,
    ftl: c.ftl !== undefined ? { ...c.ftl } : undefined,
  };
}
