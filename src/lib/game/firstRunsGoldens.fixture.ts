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
//   rank1si : rank1, every member wearing the Quartermaster's free Standard-Issue Armor, Weapon and Tool (the user's
//             2026-10-16 "full team + Quartermaster Standard-Issue set"), drawn and installed through the real
//             requisition and install transforms. Not in CREW_NAMES (the SF-0 tables predate it).
// Never imported by app code.

import { freshState, type AwayMember, type Expedition, type GameState, type ShipTypeKey } from "./model";
import { installMissingCombatBaselines } from "./tick";
import { awayRecruitCandidates, hireAwayMember } from "./awayTeam";
import { groundOpsStuckTaskIds } from "./groundOps";
import { plainAwayMember, withSlottedAwayTeams } from "./awayTeamTestFixtures";
import { requisitionStandardIssue } from "./quartermaster";
import { canFitToMember, fitToMember } from "./memberEquipment";

export function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

// GEAR WEAR (0.14.0, design 2026-10-16 section 6): the JSON every golden hashes, with the retired per-piece
// `durability` put back. The field never dropped (every mint wrote durability = durabilityMax right after
// durabilityMax, and nothing lowered it); gear wear deletes it (per-mille `condition` replaces it, absent = pristine).
// For any EquipmentInstance-shaped object (durabilityMax + implicitStats) with no `durability` AND no `condition`,
// the replacer writes `durability: durabilityMax` back in its old place, so a pristine piece serializes exactly as it
// did before the swap and every golden captured before it keeps proving that nothing else moved (the stateHash /
// withoutRunCounts precedent). A no-op on a piece that still carries the field. A WORN piece (a `condition`) is left
// as it is, so real wear moves a golden. Pure.
//
// Material Lines ML-5 (quality blanks): the same for the blank store (`blanks`), now quality-bucketed. A blueprint
// holding Q0 blanks only (a one-bucket array, the shape every pre-ML-5 blank migrates to and every Q0 craft writes)
// serializes as the flat count it was before, so a golden captured before ML-5 keeps proving nothing else moved. A
// blank at Q1 or higher (two buckets or more) is left as its array, so real quality moves a golden.
function goldenReplacer(this: unknown, key: string, value: unknown): unknown {
  if (key === "blanks" && value && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.some(([, b]) => Array.isArray(b) && b.length === 1)) {
      return Object.fromEntries(entries.map(([k, b]) => [k, Array.isArray(b) && b.length === 1 ? b[0] : b]));
    }
    return value;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const v = value as Record<string, unknown>;
  if (!("durabilityMax" in v) || !("implicitStats" in v) || "durability" in v || "condition" in v) return value;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) {
    out[k] = x;
    if (k === "durabilityMax") out.durability = x;
  }
  return out;
}
export function goldenJson(v: unknown): string {
  return JSON.stringify(v, goldenReplacer);
}

export const hash = (v: unknown): string => fnv(goldenJson(v));

// The whole state hashed WITHOUT the fields later slices add on purpose: SF-1's run counters (`runCounts`, plan
// section 3.3) and G2-1's stored `homeworld` (the G2-0 withoutG2State precedent). A no-op today; it keeps every
// whole-state golden byte-identical across those additions, so only a real behavior change moves one. Pure.
// E5-1: and without the board's evacuation stamp the v70 -> v71 step writes on an old save.
// Complement CP-19: and without the Personnel Rosters track at its pre-granted Level 1 (withoutPreGrantedRostersTrack).
// Completion tracking (0.14.0): and without the system records and the hidden ledger (withoutCompletionTracking).
export function stateHash(state: GameState): string {
  const rest = { ...withoutCompletionTracking(withoutPreGrantedRostersTrack(withoutEvacuationStamp(withV1Museum(state)))) } as Record<string, unknown>;
  delete rest.runCounts;
  delete rest.homeworld;
  return hash(rest);
}

// E5-1 (Refugee Posts): a state without the short-range board's evacuation stamp (`shortRangeBoard.evacuationFrom`),
// which the v70 -> v71 step writes ONCE on an old save, so every whole-state golden of a migrated old save keeps
// proving that nothing ELSE moved. The stamp is taken off; a board left with an empty cursor is one the step created
// on a save that had none (the engine writes the cursor only on a delivery, never empty), so it goes too. Any other
// value is returned as it is. Pure: a shallow copy.
export function withoutEvacuationStamp<T>(value: T): T {
  const board = (value as { shortRangeBoard?: { evacuationFrom?: unknown; nextCycle?: object } } | null)?.shortRangeBoard;
  if (!board || typeof board !== "object" || board.evacuationFrom === undefined) return value;
  const { shortRangeBoard: _board, ...rest } = value as Record<string, unknown>;
  const { evacuationFrom: _stamp, ...boardRest } = board;
  const emptyCursor = !boardRest.nextCycle || Object.keys(boardRest.nextCycle).length === 0;
  if (emptyCursor) return rest as T;
  return { ...(value as object), shortRangeBoard: boardRest } as T;
}

// Complement CP-19 (the Personnel Rosters track): a state without `facilities.personnelRosters` while it is exactly the
// pre-granted Level 1 every new game and every loaded save now carries (freshState, the v70 -> v71 step, every load).
// Level 1 adds nothing to either candidate board, so every whole-state golden captured before CP-19 keeps proving that
// nothing ELSE moved (the withoutEvacuationStamp precedent). Any other level (a bought rung) is returned as it is, so a
// real board change moves the golden; cp19Goldens.test.ts pins the raw key itself. Pure: a shallow copy.
export function withoutPreGrantedRostersTrack<T>(value: T): T {
  const facilities = (value as { facilities?: Record<string, unknown> } | null)?.facilities;
  if (!facilities || typeof facilities !== "object") return value;
  const track = facilities.personnelRosters as { level?: unknown } | undefined;
  if (!track || typeof track !== "object" || Object.keys(track).length !== 1 || track.level !== 1) return value;
  const { personnelRosters: _track, ...rest } = facilities;
  return { ...(value as object), facilities: rest } as T;
}

// Relics v2 R2-1: a state with its Museum v2 record shown in the v1 form every whole-state golden captured before
// R2-1 holds: `museumV2` replaced, AT ITS KEY POSITION, by `relicMuseum` = its Tier I general record (where the
// v69 -> v70 step moved the v1 copies). Only when the record holds nothing a v1 museum could not (no tier but I, no
// exceptional piece, frozen snapshot, culture or completed set); any real v2 data is returned as it is, so it moves the
// golden. Also how a test writes the save a pre-R2-1 build wrote (v69). Pure: a shallow copy.
export function withV1Museum<T>(value: T): T {
  if (!value || typeof value !== "object" || !("museumV2" in value)) return value;
  const m = (value as { museumV2?: unknown }).museumV2 as Record<string, unknown> | undefined;
  const empty = (x: unknown) => !!x && typeof x === "object" && Object.keys(x).length === 0;
  const general = (m?.general ?? {}) as Record<string, unknown>;
  const v1Only =
    !!m &&
    Object.keys(general).every((k) => k === "1") &&
    empty(m.exceptional) &&
    empty(m.frozen) &&
    empty(m.cultures) &&
    empty(m.culturesNamed) &&
    empty(m.setsCompleted);
  if (!v1Only) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === "museumV2") out.relicMuseum = general["1"] ?? {};
    else out[k] = v;
  }
  return out as T;
}

// Completion tracking (0.14.0, docs/plans/2026-11-13-completion-tracking-design.md): a value WITHOUT the two keys the
// slice adds on purpose, the system records (`systemRecords`, written at every claim of a run that charted something and
// at an abandon) and the hidden chat-event ledger (`notableEvents`, a system completed at its claim, a relic set
// completed at its study). Both are optional and absent before their first write, so dropping them gives back the
// state the same call made before the slice (the runCounts precedent below). completionTrackingGoldens.test.ts pins both
// keys themselves and shows, with COMPLETION_TRACKING_SWITCH off, that every capture returns; any other key is left as it
// is, so a real behavior change still moves a golden. Pure: a shallow copy.
// The planet roll (user 2026-11-13 "Planet roll + system badge", written with the record): the completion blanks it put
// in the vault (source "completion", which nothing else ever writes) come off too, so the vault reads as before the
// roll; completionRollGoldens.test.ts pins them (and shows, with COMPLETION_ROLL_SWITCH off, that every capture returns).
export function withoutCompletionTracking<T>(value: T): T {
  if (!value || typeof value !== "object" || !("systemRecords" in value || "notableEvents" in value)) return value;
  const rest = { ...value } as Record<string, unknown>;
  delete rest.systemRecords;
  delete rest.notableEvents;
  const vault = rest.relicVault;
  if (Array.isArray(vault) && vault.some((t) => t && t.source === "completion")) rest.relicVault = vault.filter((t) => !(t && t.source === "completion"));
  return rest as T;
}

// SF-1: a value WITHOUT the run counters (`runCounts`, runDifficulty.ts): freshState seeds them, a claim and a patrol
// dispatch or won route write them. Every whole-state golden captured before SF-1 hashes through this, so it keeps
// proving that nothing else moved (the stateHash precedent above). Any other value is returned as it is. Pure: a
// shallow copy.
// Relics v2 R2-1: it also shows the Museum v2 record in its v1 form (withV1Museum above), for the same reason: every
// whole-state golden that hashes through it was captured with the v1 `relicMuseum`.
// Complement CP-19: and without the Personnel Rosters track at its pre-granted Level 1 (withoutPreGrantedRostersTrack).
// Completion tracking: and without the system records and the hidden ledger (withoutCompletionTracking).
export function withoutRunCounts<T>(input: T): T {
  return withoutCompletionTracking(withoutRunCountsKeepingCompletion(input));
}

// withoutRunCounts with the completion tracking keys KEPT: what completionTrackingGoldens.test.ts hashes, since those
// two keys are exactly what its pins prove moved (and returned with the slice switched off). Pure: a shallow copy.
export function withoutRunCountsKeepingCompletion<T>(input: T): T {
  const value = withoutPreGrantedRostersTrack(withV1Museum(input));
  if (!value || typeof value !== "object" || !("runCounts" in value)) return value;
  const rest = { ...value } as Record<string, unknown>;
  delete rest.runCounts;
  return rest as T;
}

// G1-1 (Short-Range Missions): a ship stat sheet WITHOUT guest quarters (the optional `colonistCapacity` G1-1 makes
// live: the transport hulls' base berths and every guest line). Every sheet golden captured before G1-1 hashes through
// this, so it keeps proving that no OTHER stat moved; the guest quarters values have their own pins
// (shortRangeGoldens.test.ts `guests:*`). Any other value is returned as it is. Pure: a shallow copy.
export function withoutGuests<T>(stats: T): T {
  if (!stats || typeof stats !== "object" || !("colonistCapacity" in stats)) return stats;
  const rest = { ...stats } as Record<string, unknown>;
  delete rest.colonistCapacity;
  return rest as T;
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

export type CrewName = "d18" | "board2" | "board10" | "rank1" | "rank3" | "rank6" | "rank1si";
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

// The Quartermaster's free Standard-Issue Armor, Weapon and Tool for every member aboard, each drawn through
// requisitionStandardIssue and installed with fitToMember (the sim's kitCrewFromQuartermaster, inlined here so the
// golden fixtures do not import the sim). Throws on any refusal. Pure.
export function withStandardIssueKit(state: GameState): GameState {
  let s = state;
  for (const member of state.awayMembers) {
    for (const slot of ["memberArmor", "memberWeapon", "memberTool"] as const) {
      const req = requisitionStandardIssue(s, slot, member.teamType);
      if (!req.minted) throw new Error(`requisition refused: ${slot} for ${member.id} (${req.reason})`);
      const gate = canFitToMember(req.next, member.id, req.minted.id);
      if (!gate.ok) throw new Error(`install refused: ${slot} on ${member.id} (${gate.reason})`);
      s = fitToMember(req.next, member.id, req.minted.id);
    }
  }
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
    case "rank1si":
      return withStandardIssueKit(rankCrew(state, 1));
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
