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
// any wave math. It imports deriveWaveSeed + the two wave salts from the live loop
// (tick.ts) and calls the same generateEnemyWave / resolveBattle / patrolWave leaves,
// so there is one source of truth for "how a wave resolves". The ORCHESTRATION the
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
} from "../model";
import {
  combatHullTypeOf,
  defaultDronesForHull,
  type CombatHullType,
  type CombatShipStats,
} from "./bridge";
import type { CombatStance } from "./positioning";
import { buildPatrolPlayerCombatant, regenPatrolShield } from "./patrolWave";
import { generateEnemyWaveDetailed } from "./enemyWave";
import { resolveBattle } from "./resolveBattle";
import { replenishDrones } from "./droneDefense";
import { PIRATE_HULLS, type PirateHullId } from "./enemyHulls";
import type { Combatant, CombatEvent, BattleOutcome } from "./types";
import type { DroneSquadron } from "./drones";
import { planWaveSchedule } from "./waveSchedule";
// The wave-seed derivation + its two salts + the schedule params live with the live
// loop (tick.ts). Importing them (rather than re-declaring) is the WHOLE POINT: the
// replay derives every enemy/battle seed with the identical inputs the live loop used,
// so the two cannot drift. tick.ts does NOT import this module, so there is no cycle.
import {
  deriveWaveSeed,
  patrolWaveParams,
  WAVE_ENEMY_SEED_SALT,
  WAVE_BATTLE_SEED_SALT,
} from "../tick";

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

  // The wave schedule: a pure function of the master seed + def params, IDENTICAL to
  // the array freshPatrolMission persisted at dispatch (same call), so the replay's
  // wave ticks match the live cycle's exactly.
  const waveTicks = planWaveSchedule(masterSeed, patrolWaveParams(def));

  // Carry-state, seeded from the caller. startDrones is deep-cloned so the between-wave
  // recovery (which mutates drone state in place) never touches the caller's array.
  let carryHull = input.startHull;
  let carryShield = input.startShield;
  let carryDrones = input.startDrones.map(cloneSquadron);

  const waves: PatrolReplayWave[] = [];
  let wavesWon = 0;
  let defeated = false;

  // The previous wave's route tick, so the inter-wave recovery count is the number of
  // NON-wave whole route ticks strictly between two waves. 0 before the first wave (the
  // pre-first-wave transit ticks apply recovery from a full pool, a harmless no-op).
  let prevWaveTick = 0;

  for (let waveIndex = 0; waveIndex < waveTicks.length; waveIndex++) {
    const routeTick = waveTicks[waveIndex];

    // BETWEEN-WAVE RECOVERY (design S14). The live loop applies shield-regen +
    // replenishDrones on EVERY non-wave whole route tick; between wave (i-1) and wave i
    // that is exactly (routeTick - prevWaveTick - 1) ticks. Apply the SAME per-tick
    // recovery that many times so the carry-state entering this wave is byte-identical.
    const recoveryTicks = routeTick - prevWaveTick - 1;
    for (let r = 0; r < recoveryTicks; r++) {
      carryShield = regenPatrolShield(stats.shieldCapacity, carryShield, stats.shieldRecharge);
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
      carryHull,
      carryShield,
      carryDrones,
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

  // The FULL initial carry-state (mirrors freshPatrolMission): full hull, full shield,
  // and the hull's default drone screen keyed to the master seed (a carrier's Attack
  // squadron; empty for a non-carrier). These are freshly built, so no input is shared.
  const startDrones = defaultDronesForHull(hullType, `patrol-${mission.masterSeed}-p`);

  const resolved = resolvePatrolWaves({
    playerId: ship.id,
    stats: shipDef,
    hullType,
    stance: mission.stance,
    masterSeed: mission.masterSeed,
    factionId: mission.factionId,
    def,
    startHull: shipDef.hullIntegrity,
    startShield: shipDef.shieldCapacity,
    startDrones,
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
// carries -- per-combatant hull / shield (from each event's hullAfter / shieldAfter)
// and active status effects (from effectApplied / dot applications and droneCleanse
// removals). It does NOT invent anything the stream does not provide.
//
// ⚠️ WHAT THE STREAM CANNOT FEED (reported honestly, NOT fabricated here): the current
// CombatEvent shape carries no position/range/band, no phase (detection -> intercept ->
// weapons-ready -> firing) marker, no absolute per-squadron drone pip counts
// (online/disrupted/refabricating -- only incremental engage/restore signals exist),
// and no per-system durability condition (the sim defers durability rolls). Those arena
// elements must come from elsewhere (the wave's playerStart/enemyStart/playerEnd/enemyEnd
// combatants give drone start/end summaries via squadronStatusSummary) or await a later
// unit that emits them. This fold deliberately omits them rather than guessing.
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
  // effectApplied / dot applications; removed on droneCleanse. See the expiry caveat
  // below.
  effects: SnapshotEffect[];
}

// One active status effect on a combatant at a round (the pip + tooltip data).
export interface SnapshotEffect {
  defId: string;
  rank: number;
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
  // cleanse removes it cleanly.
  const effects = new Map<string, Map<string, number>>();

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

    // Cleanse removal: a support drone stripped a disruption off its owner.
    if (ev.type === "droneCleanse" && ev.effectDefId && ev.targetId) {
      effects.get(ev.targetId)?.delete(ev.effectDefId);
    }
  };

  // Fold round by round, emitting one snapshot per round from 0..maxRound. If the log is
  // empty and no baseline was given, this yields a single round-0 snapshot with no
  // combatants (graceful, not a throw).
  const snapshots: RoundSnapshot[] = [];
  for (let round = 0; round <= maxRound; round++) {
    for (const ev of byRound.get(round) ?? []) applyEvent(ev);
    snapshots.push(snapshotOf(round, hull, shield, effects));
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
): RoundSnapshot {
  // The union of every id seen in any map (a combatant may appear via hull-only,
  // shield-only, or effect-only events).
  const ids = new Set<string>([...hull.keys(), ...shield.keys(), ...effects.keys()]);
  const combatants: Record<string, CombatantSnapshot> = {};
  for (const id of ids) {
    const effMap = effects.get(id);
    combatants[id] = {
      id,
      hull: hull.has(id) ? hull.get(id)! : null,
      shield: shield.has(id) ? shield.get(id)! : null,
      effects: effMap
        ? [...effMap.entries()].map(([defId, rank]) => ({ defId, rank }))
        : [],
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
  };
}
