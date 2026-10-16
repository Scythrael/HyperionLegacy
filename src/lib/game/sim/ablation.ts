// WR-2 (0.14.0): CHOICE ABLATION. For every player choice the wiring registry lists (a talent node, an officer
// bonus, a complement buff, a gear line, a module, a facility rung, a relic or museum record, a trait or racial),
// play the same policy twice from the same seed, once with the choice and once without it, and report which
// outcome metrics moved. The user's test (capture 2026-10-15 section 5): "if you spec into something that provides
// 8% to a stat, it provides that 8%"; WR-1's sensitivity tests prove the 8% at its seam, this proves the seam
// reaches something the player gets.
//
// Verdicts:
//   moves    : at least one outcome metric differs (listed).
//   seamOnly : no outcome moved, but the registry's own seam probe reads differently on the sim's save (the value
//              is computed and shown, it changes nothing in this play: "only moves display").
//   dead     : neither an outcome nor the seam moved.
//   noChange : the choice's transform leaves the sim's save byte-identical (content data marked on a fixture, or a
//              source the sim's save already has), so there is nothing to compare.
//   skipped  : the transform or the run threw (the reason is recorded).
// A dead or seamOnly LIVE entry is not automatically a bug: the policy may never reach its context (it never
// salvages, crafts or researches). `exercised` says whether any claimed context is one the policy plays.
//
// Pure and deterministic; the runs are cached by their start state, so every choice that does not change the
// "without" side shares one baseline run.

import type { GameState } from "../model";
import { WIRING_REGISTRY, homeContextOf, type WiringEntry } from "../wiring/registry";
import { readProbe, type ContextId } from "../wiring/probes";
import { movedMetrics, simStartState, simulate, type SimReport, type SimRunOptions } from "./simPlayer";
import { ALL_AUTO, scripted, type SimPolicy } from "./policies";

// The registry catalogs that are a PLAYER CHOICE (something a save owns because the player picked it). Content
// data (hull, mission, patrol, enemy, planet, PoI, affix, weapon and status definitions, loot pools, recipes) and
// the audit rows (seams with no source yet) are not choices: the sensitivity level covers them.
export const SIM_CHOICE_CATALOGS: ReadonlySet<string> = new Set([
  "CAPTAIN_TALENTS",
  "CAPTAIN_SPEC_BONUS",
  "SECONDARY_CAPTAIN_TALENTS",
  "CAPTAIN_PROGRESSION",
  "HOMEWORLD_TALENTS",
  "SENIOR_STAFF_BONUSES",
  "OFFICER_STAT_FACETS",
  "CREW_PROFESSION_BUFFS",
  "SECOND_LEVEL_EXCLUSIVE",
  "CREW_RACES",
  "CREW_RARITY_MULTIPLIER",
  "CREW_RANKS",
  "EQUIPMENT_SLOTS.member",
  "AWAY_TRAITS",
  "MEMBER_GROUND_EFFECTS",
  "MEMBER_PERKS",
  "GAMBIT_PROGRAMS",
  "FACILITIES",
  "EQUIPMENT_STORAGE_RUNGS",
  "SHIP_DOCKS_RUNGS",
  "TRANSIT_BERTH_RUNGS",
  "SUBSPACE_TELESCOPE_LEVELS",
  "SHIP_GEAR_LINES",
  "QUARTERS_MODULES",
  "BRIDGE_MODULES",
  "SENSOR_ARRAYS",
  "MUSEUM_STATS",
  "RELIC_SETS",
  "RELICS",
]);

// The contexts the allAuto and newcomer policies actually play (a gathering run, a patrol and its repair, Ground
// Operations expeditions with their ship events, fights, fieldwork and injuries, captain and fleet progression).
export const SIM_EXERCISED_CONTEXTS: ReadonlySet<ContextId> = new Set<ContextId>([
  "sheet",
  "mission:extraction",
  "patrol",
  "expedition:groundOps",
  "shipEvent",
  "ground",
  "ground:noInflict",
  "fieldwork",
  "medbay",
  "fleet",
  "captain",
]);

// The Shipyard context is played ONLY for repair (a lost patrol's hull): never a build, a bay or a dock. So an entry
// whose claimed context is "shipyard" counts as exercised only when its seam is a repair reading.
export const SIM_SHIPYARD_REPAIR_PROBES: ReadonlySet<string> = new Set(["repairTicks", "officerRepairBonus", "turnaround", "dcRepairReduction"]);

function contextExercised(e: WiringEntry, c: ContextId): boolean {
  if (c === "shipyard") return e.probe !== undefined && SIM_SHIPYARD_REPAIR_PROBES.has(e.probe);
  return SIM_EXERCISED_CONTEXTS.has(c);
}

export function isSimChoice(e: WiringEntry): boolean {
  return SIM_CHOICE_CATALOGS.has(e.source.catalog) && e.notApplicable === undefined;
}

// Every registry entry the ablation plays (in registry order).
export function simChoiceEntries(): WiringEntry[] {
  return WIRING_REGISTRY.filter(isSimChoice);
}

export type ChoiceVerdictKind = "moves" | "seamOnly" | "dead" | "noChange" | "skipped";

export interface ChoiceVerdict {
  readonly id: string;
  readonly system: string;
  readonly catalog: string;
  readonly status: WiringEntry["status"]["kind"];
  readonly verdict: ChoiceVerdictKind;
  readonly moved: readonly string[]; // outcome metrics that differed (union over the seeds)
  readonly seam: { readonly off: number; readonly on: number } | null;
  readonly exercised: boolean; // a claimed context is one the policy plays
  // A surprise worth a look: a pending entry that moves an outcome (flip its status?) or a live entry with an
  // exercised context that moves nothing.
  readonly surprise: boolean;
  readonly note?: string;
}

export interface AblationReport {
  readonly policy: string;
  readonly seeds: readonly number[];
  readonly horizonSeconds: number;
  readonly runs: number; // simulations actually played (after the cache)
  readonly verdicts: readonly ChoiceVerdict[];
  readonly counts: Readonly<Record<ChoiceVerdictKind, number>>;
}

const key = (s: GameState): string => JSON.stringify(s);

function seamOf(e: WiringEntry, off: GameState, on: GameState): { off: number; on: number } | null {
  if (!e.probe) return null;
  try {
    const ctx: ContextId = e.contexts[0] ?? homeContextOf(e.probe);
    return { off: readProbe(e.probe, off, ctx), on: readProbe(e.probe, on, ctx) };
  } catch {
    return null; // the seam needs the wiring fixture's own setup (a run in flight, a combat frame)
  }
}

// Ablate `entries` under `policy` over `seeds`. `horizonSeconds` overrides the policy's horizon.
export function ablateChoices(
  entries: readonly WiringEntry[],
  opts: { policy?: SimPolicy; seeds: readonly number[]; horizonSeconds?: number },
): AblationReport {
  const policy = opts.policy ?? ALL_AUTO;
  const cache = new Map<string, SimReport>();
  let runs = 0;
  const play = (p: SimPolicy, seed: number): SimReport => {
    const k = `${seed}|${key(simStartState(p).state)}`;
    const hit = cache.get(k);
    if (hit) return hit;
    const runOpts: SimRunOptions = { seed, ...(opts.horizonSeconds === undefined ? {} : { horizonSeconds: opts.horizonSeconds }) };
    const r = simulate(p, runOpts);
    runs += 1;
    cache.set(k, r);
    return r;
  };
  const base = simStartState(policy).state;
  const verdicts: ChoiceVerdict[] = [];
  for (const e of entries) {
    const head = { id: e.id, system: e.system, catalog: e.source.catalog, status: e.status.kind };
    const exercised = e.contexts.some((c) => contextExercised(e, c));
    let offStart: GameState;
    let onStart: GameState;
    try {
      offStart = e.off(base);
      onStart = e.on(base);
    } catch (err) {
      verdicts.push({ ...head, verdict: "skipped", moved: [], seam: null, exercised, surprise: false, note: `transform threw: ${String(err)}` });
      continue;
    }
    if (key(offStart) === key(onStart)) {
      verdicts.push({ ...head, verdict: "noChange", moved: [], seam: null, exercised, surprise: false, note: "the transform leaves the sim's save unchanged" });
      continue;
    }
    const seam = seamOf(e, offStart, onStart);
    const moved = new Set<string>();
    try {
      for (const seed of opts.seeds) {
        const without = play(scripted([{ id: `without:${e.id}`, apply: e.off }], policy), seed);
        const withIt = play(scripted([{ id: e.id, apply: e.on }], policy), seed);
        for (const m of movedMetrics(without.metrics, withIt.metrics)) moved.add(m);
      }
    } catch (err) {
      verdicts.push({ ...head, verdict: "skipped", moved: [], seam, exercised, surprise: false, note: `run threw: ${String(err)}` });
      continue;
    }
    const seamMoved = seam !== null && Math.abs(seam.on - seam.off) > 1e-12;
    const verdict: ChoiceVerdictKind = moved.size > 0 ? "moves" : seamMoved ? "seamOnly" : "dead";
    // A wholly pending source (no live contexts) that moves an outcome, or a live source in a played context that
    // moves nothing.
    const whollyPending = e.status.kind === "pending" && e.status.contexts === undefined;
    const surprise = (whollyPending && verdict === "moves") || (e.status.kind === "live" && exercised && verdict === "dead");
    verdicts.push({ ...head, verdict, moved: [...moved].sort(), seam, exercised, surprise });
  }
  const counts: Record<ChoiceVerdictKind, number> = { moves: 0, seamOnly: 0, dead: 0, noChange: 0, skipped: 0 };
  for (const v of verdicts) counts[v.verdict] += 1;
  return { policy: policy.name, seeds: [...opts.seeds], horizonSeconds: opts.horizonSeconds ?? policy.horizonSeconds, runs, verdicts, counts };
}

// A readable summary of an ablation (the gated sweep prints it): the counts, then every choice that moves nothing
// (dead, then seamOnly) and every surprise, one line each. Pure.
export function ablationSummary(r: AblationReport): string[] {
  const lines = [`ablation ${r.policy} seeds ${r.seeds.join(",")} horizon ${r.horizonSeconds} s: ${r.runs} runs, ${JSON.stringify(r.counts)}`];
  const line = (v: ChoiceVerdict): string =>
    `${v.verdict} ${v.status}${v.exercised ? "" : " (context not played)"}${v.surprise ? " SURPRISE" : ""} ${v.id}` +
    (v.moved.length > 0 ? ` moved ${v.moved.join(",")}` : "") +
    (v.seam ? ` seam ${v.seam.off} to ${v.seam.on}` : "") +
    (v.note ? ` (${v.note})` : "");
  for (const kind of ["dead", "seamOnly", "skipped", "noChange"] as const) for (const v of r.verdicts) if (v.verdict === kind) lines.push(line(v));
  for (const v of r.verdicts) if (v.surprise && v.verdict === "moves") lines.push(line(v));
  return lines;
}
