// WR-2 (0.14.0, plan docs/plans/2026-10-15-wiring-registry-and-audit-plan.md section 4 WR-2): THE SIMULATED
// PLAYER. The user (capture 2026-10-15 section 5): "simulate a player playing the game and speccing into things
// like a player normally would, in order to make absolutely sure that everything we've built so far includes no
// broken wiring or placeholders that don't actually function."
//
// A pure, headless driver: from freshState and a seed it plays a named policy (policies.ts) through the action
// layer (actions.ts, the same engine functions the App's handlers call) and advances time with the REAL offline
// path, tick() (one economyTick per whole tick, exactly what a returning player's catch-up runs; the live loop
// steps the same economyTick once per tick). The player looks at the game every `decisionSeconds`; between looks
// the time is advanced in one tick() call, in 997 s chunks, or one second at a time (the three must agree: the
// offline == live parity the tests assert).
//
// Why not one economyTick(state, span) per hour (the plan's "a simulated hour is one call"): measured on this
// branch, a single economyTick over 3,600 s of a Short Ore Run credits 60 and hauls 176 Titanium Ore where 3,600
// one-second ticks credit 720 and haul 2,119. economyTick is closed-form only per tick; tick() is the closed-form
// span (WR-2 carry note).
//
// Deterministic: the economy draws come from a seeded LCG (never Math.random), no wall clock is read, and every
// report field is a pure function of (policy, options). The sim never touches a real save.

import Decimal from "break_infinity.js";
import type { Expedition, GameState } from "../model";
import { tick } from "../tick";
import { itemTotal } from "../inventory";
import { groundOpsStuckTaskIds } from "../groundOps";
import { fnv, isShipEventSetback } from "../firstRunsGoldens.fixture";
import {
  SIM_CAPTAIN_ID,
  SIM_SHIP_ID,
  buyCheapestCaptainTalents,
  buyCheapestHomeworldTalents,
  claim,
  dispatchMission,
  dispatchPatrol,
  fieldWeakestCrew,
  hireFromBoard,
  kitCrewFromQuartermaster,
  launchExpedition,
  newGameState,
  recall,
  startCheapestFacilityRung,
  type ActionResult,
} from "./actions";
import type { SimPhase, SimPolicy } from "./policies";

// ============================================================================
// Seeds and time
// ============================================================================

// The economy's draws: the SF-0 fixtures' LCG, seeded per run.
export function simRng(seed: number): () => number {
  let s = (seed ^ 0x51a7e5) >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export const ADVANCE_MODES = ["one", "chunk997", "step1"] as const;
export type AdvanceMode = (typeof ADVANCE_MODES)[number];

// Advance `seconds` of game time through tick(): one call, 997 s chunks, or 1 s calls (the live cadence).
export function advance(state: GameState, seconds: number, rng: () => number, mode: AdvanceMode): GameState {
  if (mode === "one") return tick(seconds, state, rng);
  const step = mode === "chunk997" ? 997 : 1;
  let s = state;
  for (let left = seconds; left > 0; left -= step) s = tick(Math.min(step, left), s, rng);
  return s;
}

// ============================================================================
// The report
// ============================================================================

export interface SimLogEntry {
  readonly at: number; // simulated seconds since the start
  readonly action: string;
  readonly ok: boolean;
  readonly reason?: string;
}

export interface GatherRecord {
  readonly mission: string;
  readonly refusal: string | null;
  readonly deliveries: number;
  readonly firstDeliverySeconds: number | null; // from dispatch
  readonly defeat: boolean; // a gathering run ended in a defeat (it never should)
}

export interface PatrolRecord {
  readonly patrol: string;
  readonly refusal: string | null;
  readonly won: boolean | null; // null: never ended inside the horizon
  readonly endReason: string | null;
  readonly repairSeconds: number | null; // a lost hull's time in the Shipyard, null when not damaged or unrepaired
  // The battle as last seen in flight (the player watches a patrol second by second): waves and the pools left.
  readonly wavesWon: number;
  readonly wavesLost: number;
  readonly hullLeft: number;
  readonly shieldLeft: number;
}

export type ExpeditionEnd = "complete" | "stalled" | "inFlight";

export interface ExpeditionRecord {
  readonly id: string;
  readonly candidate: number;
  readonly shakedown: boolean;
  readonly launchedAt: number;
  readonly end: ExpeditionEnd;
  readonly endedAt: number | null; // complete (or declared stalled) at
  readonly phase: string;
  readonly objectivesDone: number;
  readonly objectivesTotal: number;
  readonly lostFights: number;
  readonly sentBack: number;
  readonly stuckSites: readonly string[];
  readonly hullDamage: number;
  readonly setbacks: number;
  readonly boardingLoss: number;
  readonly claimed: boolean;
  readonly findings: number;
  readonly injuries: number;
  readonly timeline: string; // a digest of the run's ground steps, ship legs, scan events and log (how it went)
}

// Safe First Runs OC-1 ("Finish 100%, no setbacks"): every objective completes, no lost fights, no hull damage,
// no ship-event setbacks. `reasons` names every way the run fell short (empty when safe).
export interface FirstExpeditionVerdict {
  readonly verdict: "safe" | "completedWithSetbacks" | "stalled" | "inFlight" | "notLaunched";
  readonly safe: boolean;
  readonly reasons: readonly string[];
}

export interface SimReport {
  readonly policy: string;
  readonly seed: number;
  readonly horizonSeconds: number;
  readonly endedAtSeconds: number;
  readonly advance: AdvanceMode;
  readonly actions: readonly SimLogEntry[];
  readonly gather: GatherRecord | null;
  readonly patrol: PatrolRecord | null;
  readonly expeditions: readonly ExpeditionRecord[];
  readonly expeditionRefusal: string | null;
  readonly firstExpedition: FirstExpeditionVerdict;
  // Flat outcome metrics (what a choice can move): the ablation compares these.
  readonly metrics: Readonly<Record<string, number>>;
}

export interface SimRunOptions {
  readonly seed: number;
  readonly horizonSeconds?: number;
  readonly decisionSeconds?: number;
  readonly advance?: AdvanceMode;
}

// ============================================================================
// The start
// ============================================================================

// The policy's starting save: the App's new game (App.svelte starts every new game as
// installMissingCombatBaselines(freshState()): a bare freshState freighter carries no weapons, shields or plating
// and loses its first Sweep in 10 ticks), then the hull, the crew, the kit, and the scripted choices. Pure.
export function simStartState(policy: SimPolicy): { state: GameState; log: SimLogEntry[] } {
  const log: SimLogEntry[] = [];
  const note = (action: string, r: ActionResult): GameState => {
    log.push({ at: 0, action, ok: r.ok, ...(r.reason ? { reason: r.reason } : {}) });
    return r.next;
  };
  let s = newGameState(policy.start.hull);
  if (policy.start.crew === "weakest") s = note("fieldWeakestCrew", fieldWeakestCrew(s));
  if (policy.start.crew === "board") {
    s = note("hire:security", hireFromBoard(s, "security", true));
    s = note("hire:science", hireFromBoard(s, "science", true));
  }
  if (policy.start.kit) s = note("quartermasterKit", kitCrewFromQuartermaster(s));
  for (const c of policy.choices) s = c.apply(s);
  return { state: s, log };
}

// ============================================================================
// The driver
// ============================================================================

interface Cursor {
  phase: number;
  stage: "start" | "flying" | "recalling" | "repair" | "done";
  since: number; // when the stage began
  expeditionId: string | null;
  lastDone: number;
  lastProgressAt: number;
  launched: number;
}

const tasksOf = (exp: Expedition) => exp.bodies.flatMap((b) => b.activities);

function expeditionSnapshot(exp: Expedition): Omit<ExpeditionRecord, "id" | "candidate" | "launchedAt" | "end" | "endedAt" | "claimed" | "findings" | "injuries"> {
  const tasks = tasksOf(exp);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const events = exp.scanEvents ?? [];
  return {
    shakedown: exp.shakedown === true,
    phase: exp.phase,
    objectivesDone: tasks.filter((t) => t.done).length,
    objectivesTotal: tasks.length,
    lostFights: (exp.groundOps?.history ?? []).filter((r) => r.outcome === "loss").length,
    sentBack: tasks.reduce((n, t) => n + (t.sentBack ?? 0), 0),
    stuckSites: groundOpsStuckTaskIds(exp).map((id) => byId.get(id)?.poiId ?? id),
    hullDamage: exp.groundOps?.hullDamage ?? 0,
    setbacks: events.filter(isShipEventSetback).length,
    boardingLoss: events.reduce((n, e) => n + (e.boarding?.creditsLost ?? 0), 0),
    timeline: fnv(JSON.stringify([exp.groundOps?.history ?? [], exp.groundOps?.shipLegs ?? [], exp.groundOps?.repairLegs ?? [], events, exp.groundOps?.log ?? []])),
  };
}

const shipOf = (s: GameState) => s.ships.find((x) => x.id === SIM_SHIP_ID);
const captainOf = (s: GameState) => s.captains.find((c) => c.id === SIM_CAPTAIN_ID);

// Play `policy` from its start for the horizon. Pure and deterministic.
export function simulate(policy: SimPolicy, opts: SimRunOptions): SimReport {
  const horizon = opts.horizonSeconds ?? policy.horizonSeconds;
  const decision = opts.decisionSeconds ?? policy.decisionSeconds;
  const mode = opts.advance ?? "one";
  const rng = simRng(opts.seed);
  const start = simStartState(policy);
  let s = start.state;
  const log: SimLogEntry[] = [...start.log];
  const act = (t: number, action: string, r: ActionResult): ActionResult => {
    log.push({ at: t, action, ok: r.ok, ...(r.reason ? { reason: r.reason } : {}) });
    if (r.ok) s = r.next;
    return r;
  };

  let gather: GatherRecord | null = null;
  let gatherStart = 0;
  let firstDelivery: number | null = null;
  let patrol: PatrolRecord | null = null;
  let expeditionRefusal: string | null = null;
  const expeditions: ExpeditionRecord[] = [];
  const cur: Cursor = { phase: 0, stage: "start", since: 0, expeditionId: null, lastDone: 0, lastProgressAt: 0, launched: 0 };
  const next = (t: number): void => {
    cur.phase += 1;
    cur.stage = "start";
    cur.since = t;
  };

  // One look at the game: spend, then play the current phase. Returns false once every phase is done.
  const decide = (t: number): boolean => {
    if (policy.talents === "cheapest") {
      const c = buyCheapestCaptainTalents(s);
      for (const b of c.bought) log.push({ at: t, action: `buy:${b}`, ok: true });
      const h = buyCheapestHomeworldTalents(c.next);
      for (const b of h.bought) log.push({ at: t, action: `buy:${b}`, ok: true });
      s = h.next;
    }
    if (policy.facilities === "cheapest") {
      const f = startCheapestFacilityRung(s);
      if (f.started) log.push({ at: t, action: `facility:${f.started}`, ok: true });
      s = f.next;
    }
    for (let guard = 0; guard < 8; guard++) {
      const phase: SimPhase | undefined = policy.phases[cur.phase];
      if (!phase) return false;
      const before = `${cur.phase}:${cur.stage}`;
      stepPhase(phase, t);
      if (`${cur.phase}:${cur.stage}` === before) return true; // waiting on the game
    }
    return true;
  };

  const stepPhase = (phase: SimPhase, t: number): void => {
    const captain = captainOf(s);
    const ship = shipOf(s);
    if (phase.kind === "gather") {
      const delivered = Number(s.lifetimeStats.missionsCompleted[phase.mission] ?? 0);
      if (cur.stage === "start") {
        const r = act(t, `dispatch:${phase.mission}`, dispatchMission(s, phase.mission));
        gather = { mission: phase.mission, refusal: r.ok ? null : (r.reason ?? "refused"), deliveries: 0, firstDeliverySeconds: null, defeat: false };
        if (!r.ok) return next(t);
        gatherStart = t;
        cur.stage = "flying";
        cur.since = t;
        return;
      }
      if (delivered > 0 && firstDelivery === null) firstDelivery = t - gatherStart;
      if (cur.stage === "flying") {
        if (captain?.mission === null) return void (cur.stage = "recalling"); // stopped on its own (fuel, cargo cap)
        if (t - cur.since >= phase.seconds) {
          act(t, "recall", recall(s));
          cur.stage = "recalling";
        }
        return;
      }
      if (cur.stage === "recalling" && captainOf(s)?.mission === null) {
        gather = {
          ...gather!,
          deliveries: delivered,
          firstDeliverySeconds: firstDelivery,
          defeat: s.completionLog.some((e) => e.patrolEndReason === "defeat"),
        };
        return next(t);
      }
      return;
    }
    if (phase.kind === "patrol") {
      if (cur.stage === "start") {
        const r = act(t, `patrol:${phase.patrol}`, dispatchPatrol(s, phase.patrol, phase.stance, false));
        patrol = { patrol: phase.patrol, refusal: r.ok ? null : (r.reason ?? "refused"), won: null, endReason: null, repairSeconds: null, wavesWon: 0, wavesLost: 0, hullLeft: 0, shieldLeft: 0 };
        if (!r.ok) return next(t);
        cur.stage = "flying";
        cur.since = t;
        return;
      }
      if (cur.stage === "flying" && captain?.mission?.kind === "patrol") {
        const m = captain.mission;
        patrol = { ...patrol!, wavesWon: m.wavesWon, wavesLost: m.wavesLost, hullLeft: m.playerHull, shieldLeft: m.playerShield };
        return;
      }
      if (cur.stage === "flying" && captain?.mission === null) {
        const last = [...s.completionLog].reverse().find((e) => e.kind === "patrolRun");
        const damaged = ship?.damaged === true;
        patrol = { ...patrol!, won: !damaged, endReason: last?.patrolEndReason ?? null };
        if (!damaged) return next(t);
        cur.stage = "repair";
        cur.since = t;
        return;
      }
      if (cur.stage === "repair" && ship?.damaged !== true) {
        patrol = { ...patrol!, repairSeconds: t - cur.since };
        return next(t);
      }
      return;
    }
    // expedition
    if (cur.stage === "start") {
      if (ship?.damaged === true) return; // the Shipyard has it; launch once repaired
      const r = launchExpedition(s, opts.seed + cur.launched);
      log.push({ at: t, action: "launchExpedition", ok: r.ok, ...(r.reason ? { reason: r.reason } : {}) });
      if (!r.ok) {
        if (expeditions.length === 0) expeditionRefusal = r.reason ?? "refused";
        cur.stage = "done";
        return next(t);
      }
      s = r.next;
      const exp = s.expeditions.find((e) => e.id === r.expeditionId)!;
      expeditions.push({ id: exp.id, candidate: (opts.seed + cur.launched) % 3, launchedAt: t, end: "inFlight", endedAt: null, claimed: false, findings: 0, injuries: 0, ...expeditionSnapshot(exp) });
      cur.launched += 1;
      cur.expeditionId = exp.id;
      cur.lastDone = 0;
      cur.lastProgressAt = t;
      cur.stage = "flying";
      cur.since = t;
      return;
    }
    if (cur.stage === "flying") {
      const exp = s.expeditions.find((e) => e.id === cur.expeditionId);
      const idx = expeditions.length - 1;
      if (!exp) return next(t);
      const snap = expeditionSnapshot(exp);
      expeditions[idx] = { ...expeditions[idx], ...snap };
      if (exp.phase === "complete") {
        const c = claim(s, exp.id);
        log.push({ at: t, action: "claim", ok: c.ok, ...(c.reason ? { reason: c.reason } : {}) });
        if (c.ok) s = c.next;
        expeditions[idx] = { ...expeditions[idx], end: "complete", endedAt: t, claimed: c.ok, findings: c.findings ?? 0, injuries: c.injuries ?? 0 };
        if (phase.repeat) {
          cur.stage = "start";
          return;
        }
        return next(t);
      }
      if (snap.objectivesDone !== cur.lastDone) {
        cur.lastDone = snap.objectivesDone;
        cur.lastProgressAt = t;
      }
      if (snap.stuckSites.length > 0 && t - cur.lastProgressAt >= phase.stallSeconds) {
        expeditions[idx] = { ...expeditions[idx], end: "stalled", endedAt: t };
        return next(t);
      }
    }
  };

  let t = 0;
  let playing = true;
  while (t < horizon) {
    playing = decide(t);
    if (!playing) break;
    // A patrol in flight is watched every second (its waves resolve in about a minute).
    const watching = captainOf(s)?.mission?.kind === "patrol";
    const span = Math.min(watching ? 1 : decision, horizon - t);
    s = advance(s, span, rng, mode);
    t += span;
  }
  if (playing) decide(t); // the last look at the horizon (records what finished in the final span)

  return {
    policy: policy.name,
    seed: opts.seed,
    horizonSeconds: horizon,
    endedAtSeconds: t,
    advance: mode,
    actions: log,
    gather,
    patrol,
    expeditions,
    expeditionRefusal,
    firstExpedition: firstExpeditionVerdict(expeditions[0], expeditionRefusal),
    metrics: outcomeMetrics(s, gather, patrol, expeditions),
  };
}

export function firstExpeditionVerdict(first: ExpeditionRecord | undefined, refusal: string | null): FirstExpeditionVerdict {
  if (!first) return { verdict: "notLaunched", safe: false, reasons: [`not launched: ${refusal ?? "the policy never reached it"}`] };
  const reasons: string[] = [];
  if (first.end !== "complete") {
    reasons.push(
      `${first.end === "stalled" ? "stalled" : "still in flight at the horizon"}: ${first.objectivesDone}/${first.objectivesTotal} objectives done` +
        (first.stuckSites.length > 0 ? `, stuck on ${first.stuckSites.join(", ")}` : ""),
    );
  } else if (first.objectivesDone < first.objectivesTotal) {
    reasons.push(`completed with ${first.objectivesTotal - first.objectivesDone} objectives undone`);
  }
  if (first.lostFights > 0) reasons.push(`${first.lostFights} lost fights`);
  if (first.hullDamage > 0) reasons.push(`${first.hullDamage} hull damage`);
  if (first.setbacks > 0) reasons.push(`${first.setbacks} ship-event setbacks`);
  if (first.boardingLoss > 0) reasons.push(`${first.boardingLoss} credits lost to boarders`);
  const safe = reasons.length === 0;
  const verdict = safe ? "safe" : first.end === "complete" ? "completedWithSetbacks" : first.end;
  return { verdict, safe, reasons };
}

// ============================================================================
// Outcome metrics
// ============================================================================

const r6 = (x: number): number => Math.round(x * 1e6) / 1e6;
const num = (d: Decimal | number | undefined): number => (d === undefined ? 0 : typeof d === "number" ? d : d.toNumber());

// Everything a choice can move that the player gets: resources, progression, mission, patrol and expedition
// outcomes, relics found, injuries. NOT the choice's own footprint (an owned talent, a seated officer, a worn piece,
// a museum record, a complement bucket), so a choice moves a metric only through what the game does with it.
export function outcomeMetrics(
  s: GameState,
  gather: GatherRecord | null,
  patrol: PatrolRecord | null,
  expeditions: readonly ExpeditionRecord[],
): Record<string, number> {
  const m: Record<string, number> = {};
  m["credits"] = r6(num(s.credits));
  m["fuel"] = r6(num(s.fuel));
  for (const key of Object.keys(s.inventory).sort()) {
    const v = r6(num(itemTotal(s.inventory, key)));
    if (v !== 0) m[`item:${key}`] = v;
  }
  const cap = captainOf(s);
  m["captain:level"] = cap?.level ?? 0;
  m["captain:xp"] = r6(num(cap?.xp));
  m["fleetAdmin:level"] = s.fleetAdminLevel;
  m["lifetime:creditsEarned"] = r6(num(s.lifetimeStats.creditsEarned));
  m["lifetime:captainXp"] = r6(num(s.lifetimeStats.captainXpAwarded));
  m["lifetime:fleetAdminXp"] = r6(num(s.lifetimeStats.fleetAdminXpAwarded));
  for (const [k, v] of Object.entries(s.lifetimeStats.itemsGathered).sort()) m[`gathered:${k}`] = r6(num(v));
  for (const [k, v] of Object.entries(s.lifetimeStats.missionsCompleted).sort()) m[`completed:${k}`] = r6(num(v));
  m["gather:deliveries"] = gather?.deliveries ?? 0;
  m["gather:firstDeliverySeconds"] = gather?.firstDeliverySeconds ?? -1;
  m["patrol:won"] = patrol?.won === null || patrol === null ? -1 : patrol.won ? 1 : 0;
  m["patrol:repairSeconds"] = patrol?.repairSeconds ?? -1;
  m["patrol:wavesWon"] = patrol?.wavesWon ?? -1;
  m["patrol:wavesLost"] = patrol?.wavesLost ?? -1;
  m["patrol:hullLeft"] = r6(patrol?.hullLeft ?? -1);
  m["patrol:shieldLeft"] = r6(patrol?.shieldLeft ?? -1);
  const ship = shipOf(s);
  m["ship:repairDamage"] = r6(ship?.repairDamage ?? 0);
  m["expeditions:launched"] = expeditions.length;
  m["expeditions:completed"] = expeditions.filter((e) => e.end === "complete").length;
  expeditions.forEach((e, i) => {
    const p = `expedition${i + 1}:`;
    m[`${p}objectivesDone`] = e.objectivesDone;
    m[`${p}objectivesTotal`] = e.objectivesTotal;
    m[`${p}lostFights`] = e.lostFights;
    m[`${p}sentBack`] = e.sentBack;
    m[`${p}stuck`] = e.stuckSites.length;
    m[`${p}hullDamage`] = r6(e.hullDamage);
    m[`${p}setbacks`] = e.setbacks;
    m[`${p}boardingLoss`] = r6(e.boardingLoss);
    m[`${p}endedAt`] = e.endedAt ?? -1;
    m[`${p}findings`] = e.findings;
    m[`${p}injuries`] = e.injuries;
    m[`${p}timeline`] = parseInt(e.timeline, 16);
  });
  m["relics:vault"] = s.relicVault.length;
  m["crew:injured"] = s.awayMembers.filter((x) => (x.injuredUntilSeconds ?? 0) > s.gameTimeSeconds).length;
  return m;
}

// The metric keys whose values differ between two reports (a key present in one only counts). Sorted.
export function movedMetrics(a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => a[k] !== b[k]).sort();
}
