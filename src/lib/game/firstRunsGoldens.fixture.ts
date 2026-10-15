// TEST-ONLY helpers for the Safe First Runs SF-0 goldens (docs/plans/2026-10-15-safe-first-runs-plan.md section 4
// SF-0), shared by firstRunsGoldens.test.ts and firstRunsGoldens.sweep.test.ts. They rebuild the plan's section 2.5
// method EXACTLY (the section 2.5 A and B tables reproduce number for number): freshState, ship-1 retyped to the hull
// with its Standard-Issue gear (installMissingCombatBaselines), no complement, no officers, nothing edited after
// dispatch, the run advanced in ONE call to 3,000,000 s. Crews:
//   d18     : the D18 minimum (1 Security + 1 Science, rank 1, no traits, no gear), slotted into team 0.
//   board2  : the fresh recruit board's first Security and first Science candidate, hired (auto-slotted, GO-2).
//   board10 : all ten fresh board candidates hired.
//   rankR   : 6 Security + 6 Science members of rank R, slotted across both teams in hire order (team 0 first, to
//             its squad sizes: an Eir's 4-seat Security squads take 4 + 2).
// Never imported by app code.

import { freshState, type AwayMember, type Expedition, type GameState, type ShipTypeKey } from "./model";
import { installMissingCombatBaselines } from "./tick";
import { awayRecruitCandidates, hireAwayMember } from "./awayTeam";
import { groundOpsStuckTaskIds } from "./groundOps";
import { plainAwayMember, withSlottedAwayTeams } from "./awayTeamTestFixtures";

export function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

export const hash = (v: unknown): string => fnv(JSON.stringify(v));

// The whole state hashed WITHOUT the fields later slices add on purpose: SF-1's run counters (`runCounts`, plan
// section 3.3) and G2-1's stored `homeworld` (the G2-0 withoutG2State precedent). A no-op today; it keeps every
// whole-state golden byte-identical across those additions, so only a real behavior change moves one. Pure.
export function stateHash(state: GameState): string {
  const rest = { ...state } as Record<string, unknown>;
  delete rest.runCounts;
  delete rest.homeworld;
  return hash(rest);
}

// The measurement gate: the pure measurement tables (the 60-seed sweep, the 200-seed win tables, the forecast bands,
// the readable outcome lines) run only with SF_SWEEP set or under `npm run test:sweep` (vitest in mode "sweep"); the
// default run keeps every real pin.
export const SWEEP: boolean = Boolean(import.meta.env.SF_SWEEP) || import.meta.env.MODE === "sweep";

// The section 2.5 horizon: a run that has not reached return or complete by then is STALLED (an objective held and
// flagged, retried forever until a manual Skip).
export const SWEEP_END = 3_000_000;

export const VAULT_SITES: ReadonlySet<string> = new Set(["buriedVault", "subterraneanCivilization"]);

// freshState with ship-1 retyped to `hull` and its combat Standard Issue seeded (an economy hull: a no-op).
// `expeditionSeed` replaces the save's (undefined keeps freshState's EXPEDITION_DEFAULT_SEED). Pure.
export function onHull(hull: ShipTypeKey, expeditionSeed?: number): GameState {
  const base = freshState();
  return installMissingCombatBaselines({
    ...base,
    ...(expeditionSeed === undefined ? {} : { expeditionSeed }),
    ships: base.ships.map((s) => (s.id === "ship-1" ? { ...s, typeKey: hull } : s)),
  });
}

export type CrewName = "d18" | "board2" | "board10" | "rank1" | "rank3" | "rank6";
export const CREW_NAMES: readonly CrewName[] = ["d18", "board2", "board10", "rank1", "rank3", "rank6"];

function rankCrew(state: GameState, rank: number): GameState {
  const m = (id: string, t: AwayMember["teamType"]): AwayMember => ({ ...plainAwayMember(id, t, "ship-1"), rank: rank as AwayMember["rank"] });
  const sec = [1, 2, 3, 4, 5, 6].map((i) => m(`member-${i}`, "security"));
  const sci = [11, 12, 13, 14, 15, 16].map((i) => m(`member-${i}`, "science"));
  return withSlottedAwayTeams({ ...state, awayMembers: [...sec, ...sci], nextAwayMemberId: 100 }, 2);
}

function boardCrew(state: GameState, all: boolean): GameState {
  const board = awayRecruitCandidates(state);
  const picks = all ? board : [board.find((c) => c.teamType === "security")!, board.find((c) => c.teamType === "science")!];
  let s = state;
  for (const c of picks) s = hireAwayMember(s, c.id, "ship-1");
  if (s.awayMembers.length !== picks.length) throw new Error("a board hire was refused");
  return s;
}

// `state` with the named crew aboard ship-1 (see the header). Pure.
export function withCrew(state: GameState, crew: CrewName): GameState {
  switch (crew) {
    case "d18":
      return withSlottedAwayTeams({ ...state, awayMembers: [plainAwayMember("member-1", "security", "ship-1"), plainAwayMember("member-2", "science", "ship-1")], nextAwayMemberId: 100 });
    case "board2":
      return boardCrew(state, false);
    case "board10":
      return boardCrew(state, true);
    case "rank1":
      return rankCrew(state, 1);
    case "rank3":
      return rankCrew(state, 3);
    case "rank6":
      return rankCrew(state, 6);
  }
}

// A ship event that went against the player: a failed check or a lost ship battle, a scan pause, hull wear, or a
// boarding the crew did not repel (section 2.5's "ship-event setback").
export function isShipEventSetback(e: NonNullable<Expedition["scanEvents"]>[number]): boolean {
  if (e.kind !== "shipEvent") return false;
  return e.outcome === "fail" || e.outcome === "loss" || (e.pauseSeconds ?? 0) > 0 || (e.hullWear ?? 0) > 0 || (e.boarding !== undefined && !e.boarding.repelled);
}

// The section 2.5 outcome of a finished (or stalled) run, as numbers. `lostFights` counts the lost fight steps on
// the teams' timelines (GROUND_HISTORY_CAP keeps the newest 200 per team, so a long stall counts its last 200);
// `sentBack` sums every objective's send-backs (the full stall count). Pure.
export interface RunOutcome {
  phase: string;
  stalled: boolean;
  objectives: string; // "done/total"
  lostFights: number;
  sentBack: number;
  stuck: string[]; // the poiId of every stuck objective
  hullDamage: number;
  setbacks: number;
  boardingLoss: number; // credits taken by boardings
  vaultSites: number;
}

export function runOutcome(done: Expedition): RunOutcome {
  const tasks = done.bodies.flatMap((b) => b.activities);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const events = done.scanEvents ?? [];
  return {
    phase: done.phase,
    stalled: done.phase !== "return" && done.phase !== "complete",
    objectives: `${tasks.filter((t) => t.done).length}/${tasks.length}`,
    lostFights: (done.groundOps?.history ?? []).filter((r) => r.outcome === "loss").length,
    sentBack: tasks.reduce((n, t) => n + (t.sentBack ?? 0), 0),
    stuck: groundOpsStuckTaskIds(done).map((id) => byId.get(id)!.poiId),
    hullDamage: done.groundOps?.hullDamage ?? 0,
    setbacks: events.filter(isShipEventSetback).length,
    boardingLoss: events.reduce((n, e) => n + (e.boarding?.creditsLost ?? 0), 0),
    vaultSites: tasks.filter((t) => VAULT_SITES.has(t.poiId)).length,
  };
}
