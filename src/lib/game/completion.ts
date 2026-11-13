// ============================================================================
// completion.ts: COMPLETION TRACKING (0.14.0; docs/plans/2026-11-13-completion-tracking-design.md, the user's answers
// and the approved mockup docs/mockups/2026-11-13-completion-tracking-mockup.html). E-CREW plan G7 (per-planet and
// per-system completion %, D25: "You get your % completion of the system, and you move on from there.") and G4 (the
// chat-event ledger, hidden until chat lands).
//
// THE RULE (user Q1 "B: each body an equal share"): every body is one equal share of its system. A body's scan is half
// its share and its objectives split the other half; a body with no objectives is whole once scanned; a body not yet
// scanned counts nothing (a half-scanned body too: "Bodies 2/3" counts finished scans). Objectives exist only after a
// body's scan, and a body's share never shrinks when they appear, so the % never dips.
//   - A SKIPPED objective counts as done (user Q3 "B").
//   - A gas giant's ship STUDY is its body's objective; the system's NEBULA SWEEP is one objective of the system (user Q4
//     "A"). Under equal body shares the sweep is weighed as one more equal share of the system (whole when swept), since
//     it belongs to no body (user 2026-11-13, after the build: "One body's share (Recommended)"); it is known at
//     dispatch, so the % still never dips.
//   - 100% means every body scanned and every objective done (or skipped): only then `complete`. A system short of it
//     never rounds up to 100 (99 at most).
//
// THE REWARDS (user 2026-11-13 "Planet roll + system badge (Recommended)", correcting the first build's "no reward"):
//   - THE PLANET ROLL: each body that reaches 100% pays the 2026-10-09 bonus relic roll ONCE (Relics v2 G2 call 11, the
//     relics engine's hook relicBlanks.ts planetCompletionRelicBlank: one extra blank, one rarity step above the body's
//     own roll, at the run's region tier, with the body's culture). WHERE IT FIRES: at the record's write, the CLAIM of the
//     run that finished the body (or the ABANDON of its Resume system), because the engine resolves a visit's rewards at
//     its claim (every relic find reaches the vault there, expedition.ts depositExpeditionFindings) and a claim is one
//     player action at one instant, so the roll never depends on how time was chunked (one economyTick == 997 s chunks
//     == 1 s steps). A recalled run whose system is held to Resume pays nothing at its claim (it writes no record): its
//     finished bodies wait in the held record and pay at the resumed run's claim, or at the abandon (a body that reached
//     100% is never lost). ONCE PER BODY, EVER: the record keeps the bodies that paid (SystemRecord.bodiesRolled, by
//     index) through every later write, whichever visit's counts are kept (best % kept), so a revisit never pays twice.
//   - THE SYSTEM BADGE: the whole system at 100% wears the Completed badge, gets the claim card's line and the ledger's
//     "system completed" event (no relic: the rolls are per planet).
//
// ONE pure function (systemCompletion) computes the % from a tally of counts, and a live run, a held Resume system and a
// stored record each give their tally (runCompletionTally, heldCompletionTally, recordTally), so the console, the
// telescope map and the Survey Log can never disagree. The % is never stored. Nothing reads it for an effect (user: "no
// stat reward, no grind pressure"): only the displays, the ledger and the planet roll above.
//
// The save change is GameState.systemRecords (one record per system, written at a claim and at an abandon) and
// GameState.notableEvents (the hidden ledger, notableEvents.ts: this slice's "system completed" kind beside the Relics v2
// slice's "relic set completed"). Both optional and appended, no SAVE_VERSION bump. Deterministic: a record is written by
// a player action at an instant (never by chunked time), so one economyTick == 997 s chunks == 1 s steps.
// ============================================================================

import {
  COMPLETION_ROLL_SWITCH,
  COMPLETION_TRACKING_SWITCH,
  type CompletionBodyTally,
  type Expedition,
  type GameState,
  type HeldSystem,
  type RegionTier,
  type RelicVaultToken,
  type SystemRecord,
} from "./model";
import { isStudyBody, nebulaStampFor, studyStampFor } from "./gasGiantStudy";
import { inCanonicalKeyOrder } from "./canonicalOrder";
import { famousSystem } from "./starCatalog";
import { systemCompletedEvent, withNotableEvents } from "./notableEvents";
import { RELIC_PLANET_STAMP_SWITCH, newRunRelicBlanksFlag, planetCompletionRelicBlank, relicPlanetName } from "./relicBlanks";

export type { CompletionBodyTally };

// The counts a completion is computed from. `nebula` null: the system has none.
export interface CompletionTally {
  bodies: readonly CompletionBodyTally[];
  nebula: { done: boolean } | null;
}

export interface BodyCompletion extends CompletionBodyTally {
  percent: number;
  complete: boolean;
}

export interface SystemCompletion {
  bodies: number;
  bodiesScanned: number;
  objectives: number; // found so far: every scanned body's, plus the nebula sweep
  objectivesDone: number; // done (skipped ones not included)
  objectivesSkipped: number;
  percent: number; // whole percent, 100 only when complete
  complete: boolean;
  bodyLines: BodyCompletion[];
}

// A share in [0, 1] as a whole percent: 100 only when complete, else at most 99. Pure.
function wholePercent(share: number, complete: boolean): number {
  if (complete) return 100;
  return Math.max(0, Math.min(99, Math.round(share * 100)));
}

// One body's share of the system in [0, 1] and whether it is complete. Pure.
function bodyShare(b: CompletionBodyTally): { share: number; complete: boolean } {
  if (!b.scanned) return { share: 0, complete: false };
  if (b.objectives <= 0) return { share: 1, complete: true };
  const cleared = Math.min(b.objectives, b.done + b.skipped);
  return { share: 0.5 + (0.5 * cleared) / b.objectives, complete: cleared >= b.objectives };
}

// THE completion of a tally (the one function every surface reads). Pure.
export function systemCompletion(t: CompletionTally): SystemCompletion {
  let sum = 0;
  let allComplete = t.bodies.length > 0;
  let bodiesScanned = 0;
  let objectives = 0;
  let objectivesDone = 0;
  let objectivesSkipped = 0;
  const bodyLines: BodyCompletion[] = t.bodies.map((b) => {
    const s = bodyShare(b);
    sum += s.share;
    if (!s.complete) allComplete = false;
    if (b.scanned) {
      bodiesScanned += 1;
      objectives += b.objectives;
      objectivesDone += b.done;
      objectivesSkipped += b.skipped;
    }
    return { ...b, percent: wholePercent(s.share, s.complete), complete: s.complete };
  });
  let units = t.bodies.length;
  if (t.nebula) {
    units += 1;
    objectives += 1;
    if (t.nebula.done) {
      sum += 1;
      objectivesDone += 1;
    } else allComplete = false;
  }
  const share = units > 0 ? sum / units : 0;
  return { bodies: t.bodies.length, bodiesScanned, objectives, objectivesDone, objectivesSkipped, percent: wholePercent(share, allComplete), complete: allComplete, bodyLines };
}

// ===== The three tallies =====

// A live run's tally: every body as it stands (its scan latch, its objectives' done and skipped flags, its study on a
// study run), and the nebula sweep when the run has one. Pure.
// A not-done objective counts as SKIPPED when it is skipped, or when it was skipped before a recall and waits in the
// queue again (a resumed run's `resume.skipped`, a held system's `skipped`: the review fix, user Q3 "count as done",
// so a recall never lowers the %).
export function runCompletionTally(exp: Pick<Expedition, "bodies" | "study" | "nebula" | "groundOps"> & { resume?: { skipped?: readonly string[] } }): CompletionTally {
  const legs = exp.groundOps?.studyLegs ?? [];
  const carried = new Set(exp.resume?.skipped ?? []);
  const bodies = exp.bodies.map((b, i): CompletionBodyTally => {
    if (!b.scanned) return { scanned: false, objectives: 0, done: 0, skipped: 0 };
    let objectives = b.activities.length;
    let done = 0;
    let skipped = 0;
    for (const a of b.activities) {
      if (a.done) done += 1;
      else if (a.status === "skipped" || carried.has(a.id)) skipped += 1;
    }
    if (isStudyBody(exp, b)) {
      objectives += 1;
      if (b.studied === true || legs.some((l) => l.nebula !== 1 && l.bodyIndex === i && l.done === true)) done += 1;
    }
    return { scanned: true, objectives, done, skipped };
  });
  const nebula = exp.nebula === undefined ? null : { done: exp.nebula.swept === 1 || legs.some((l) => l.nebula === 1 && l.done === true) };
  return { bodies, nebula };
}

// A held Resume system's tally: its kept bodies, read exactly as the resumed run will read them (the study flag and the
// nebula the resumed dispatch stamps from the held record, expedition.ts startExpedition). Pure.
export function heldCompletionTally(h: Pick<HeldSystem, "bodies" | "seed" | "systemId" | "region" | "risk" | "nebulaSwept" | "skipped">): CompletionTally {
  const bodies = h.bodies ?? [];
  const drawn = nebulaStampFor(h.seed, h.risk?.tier ?? h.region.tier, h.systemId);
  return runCompletionTally({
    bodies,
    study: studyStampFor(bodies),
    nebula: drawn ? { ...drawn, ...(h.nebulaSwept === true ? { swept: 1 as const } : {}) } : undefined,
    groundOps: undefined,
    resume: { skipped: h.skipped ?? [] },
  });
}

// A stored record's tally. Pure.
export function recordTally(r: Pick<SystemRecord, "bodies" | "nebula">): CompletionTally {
  return { bodies: r.bodies, nebula: r.nebula ?? null };
}

export const runCompletion = (exp: Pick<Expedition, "bodies" | "study" | "nebula" | "groundOps"> & { resume?: { skipped?: readonly string[] } }): SystemCompletion => systemCompletion(runCompletionTally(exp));
export const heldCompletion = (h: HeldSystem): SystemCompletion => systemCompletion(heldCompletionTally(h));
export const recordCompletion = (r: SystemRecord): SystemCompletion => systemCompletion(recordTally(r));

// ===== The records (GameState.systemRecords) =====

function recordOf(
  src: { systemId: string; systemName: string; region?: Expedition["region"]; fromExpeditionId: string },
  tally: CompletionTally,
  at: number,
  abandoned: boolean,
): SystemRecord {
  return {
    version: 1,
    systemId: src.systemId,
    systemName: src.systemName,
    tier: src.region?.tier ?? 1,
    ...(src.region ? { region: { ...src.region } } : {}),
    at,
    fromExpeditionId: src.fromExpeditionId,
    bodies: tally.bodies.map((b) => ({ ...b })),
    ...(tally.nebula ? { nebula: { done: tally.nebula.done } } : {}),
    ...(abandoned ? { abandoned: true as const } : {}),
  };
}

// The record a claim of `exp` at `at` writes. Pure.
export function runSystemRecord(exp: Expedition, at: number): SystemRecord {
  return recordOf({ systemId: exp.targetSystemId, systemName: exp.systemName, region: exp.region, fromExpeditionId: exp.id }, runCompletionTally(exp), at, false);
}

// The record an abandon of Resume system `h` at `at` writes (marked abandoned). Pure.
export function abandonedSystemRecord(h: HeldSystem, at: number): SystemRecord {
  return recordOf({ systemId: h.systemId, systemName: h.systemName, region: h.region, fromExpeditionId: h.fromExpeditionId }, heldCompletionTally(h), at, true);
}

// Does a new record replace the kept one (user Q2 "one row, best % kept")? A higher %, or the same % from a visit that
// was not abandoned. Pure.
function replaces(next: SystemRecord, kept: SystemRecord | undefined): boolean {
  if (!kept) return true;
  const a = recordCompletion(next).percent;
  const b = recordCompletion(kept).percent;
  return a > b || (a === b && next.abandoned !== true);
}

// The records with `rec` kept (or not: the best % stays), in canonical key order, and the bodies of `rolled` added to
// the system's paid bodies (SystemRecord.bodiesRolled) on whichever record is kept: a planet roll is remembered even
// when the visit that paid it does not keep the best %. The SAME object when nothing changes. Pure.
export function withSystemRecord(records: Readonly<Record<string, SystemRecord>> | undefined, rec: SystemRecord, rolled: readonly number[] = []): Record<string, SystemRecord> {
  const base = records ?? {};
  const kept = base[rec.systemId];
  const paid = [...new Set([...(kept?.bodiesRolled ?? []), ...(rec.bodiesRolled ?? []), ...rolled])].sort((a, b) => a - b);
  const stamp = (r: SystemRecord): SystemRecord => (paid.length > 0 ? { ...r, bodiesRolled: paid } : r);
  if (replaces(rec, kept)) return inCanonicalKeyOrder({ ...base, [rec.systemId]: stamp(rec) });
  if (kept && paid.length > (kept.bodiesRolled ?? []).length) return inCanonicalKeyOrder({ ...base, [rec.systemId]: stamp(kept) });
  return base as Record<string, SystemRecord>;
}

// ===== The planet roll (user 2026-11-13 "Planet roll + system badge") =====

// The bodies (by index) of `tally` at 100% whose roll has not paid for the system yet (`kept`'s bodiesRolled). Pure.
export function bodiesToRoll(tally: CompletionTally, kept: Pick<SystemRecord, "bodiesRolled"> | undefined): number[] {
  const paid = new Set(kept?.bodiesRolled ?? []);
  const out: number[] = [];
  systemCompletion(tally).bodyLines.forEach((b, i) => {
    if (b.complete && !paid.has(i)) out.push(i);
  });
  return out;
}

// The run a planet roll reads: the claimed run, or (an abandon) the Resume system as its resumed run would fly it (the
// held seed, region, risk and bodies; a resumed dispatch stamps today's relic blanks flag, expedition.ts startExpedition),
// with the run id the held record names.
export type PlanetRollRun = Pick<Expedition, "id" | "seed" | "region" | "risk" | "bodies" | "relicBlanks" | "systemName">;

// The completion blanks of `indices` (one per body, relicBlanks.ts planetCompletionRelicBlank), each stamped with its
// source planet's name (display only, the relic slice's RELIC_PLANET_STAMP_SWITCH rule), in body order. Pure.
export function planetRollTokens(run: PlanetRollRun, indices: readonly number[]): RelicVaultToken[] {
  const out: RelicVaultToken[] = [];
  for (const i of indices) {
    const t = planetCompletionRelicBlank(run, i);
    if (!t) continue;
    out.push(RELIC_PLANET_STAMP_SWITCH.on && run.systemName !== "" ? { ...t, planet: relicPlanetName(run, i) } : t);
  }
  return out;
}

// A record's write with its planet rolls: the record kept (best %), the newly 100% bodies paid into the vault (appended
// after everything else there) and remembered on the record. Pure.
function writeRecord(state: GameState, rec: SystemRecord, tally: CompletionTally, run: PlanetRollRun): GameState {
  const roll = COMPLETION_ROLL_SWITCH.live ? bodiesToRoll(tally, state.systemRecords?.[rec.systemId]) : [];
  const tokens = planetRollTokens(run, roll);
  const records = withSystemRecord(state.systemRecords, rec, tokens.length > 0 ? roll : []);
  if (records === state.systemRecords && tokens.length === 0) return state;
  return { ...state, systemRecords: records, ...(tokens.length > 0 ? { relicVault: [...state.relicVault, ...tokens] } : {}) };
}

// A CLAIM's writes (expedition.ts claimExpedition): the system's record, the planet roll of every body newly at 100%
// and, at 100%, the ledger's "system completed" event. A recalled run whose system is held (Resume: it is listed live
// from the held record and recorded, and its bodies rolled, when it is finished or abandoned; a candidate again: nothing
// was charted) writes nothing, nor does a recalled run that charted nothing. The SAME state when nothing is written (and
// always with the switch off). Pure.
export function withClaimRecord(state: GameState, exp: Expedition, at: number): GameState {
  if (!COMPLETION_TRACKING_SWITCH.live) return state;
  if (exp.recall && (exp.recall.held !== undefined || !exp.bodies.some((b) => b.scanned))) return state;
  const rec = runSystemRecord(exp, at);
  const written = writeRecord(state, rec, runCompletionTally(exp), exp);
  const complete = recordCompletion(rec).complete;
  const events = complete ? withNotableEvents(state.notableEvents, [systemCompletedEvent(rec, at)]) : state.notableEvents;
  if (written === state && events === state.notableEvents) return state;
  return { ...written, ...(events !== undefined ? { notableEvents: events } : {}) };
}

// An ABANDON's writes (expedition.ts abandonHeldSystem): the Resume system's record at the % it reached, marked
// abandoned (user Q11 "keep its row, marked"), and the planet roll of every body it brought to 100% that has not paid.
// Pure.
export function withAbandonRecord(state: GameState, h: HeldSystem, at: number): GameState {
  if (!COMPLETION_TRACKING_SWITCH.live) return state;
  const run: PlanetRollRun = { id: h.fromExpeditionId, seed: h.seed, region: h.region, risk: h.risk, bodies: h.bodies ?? [], relicBlanks: newRunRelicBlanksFlag(), systemName: h.systemName };
  return writeRecord(state, abandonedSystemRecord(h, at), heldCompletionTally(h), run);
}

// The planet roll's blanks a claim or an abandon put in the vault (the tokens `after` holds past `before`'s vault, each
// of source "completion"), for the log. Pure.
export function planetRollsPaid(before: Pick<GameState, "relicVault">, after: Pick<GameState, "relicVault">): RelicVaultToken[] {
  return after.relicVault.slice(before.relicVault.length).filter((t) => t.source === "completion");
}

// ===== The Systems list (the Survey Log's section, the map's arcs, a candidate's "Visited") =====

export type SystemRowState = "underWay" | "inResume" | "abandoned" | null;

export interface SystemRow {
  systemId: string;
  systemName: string;
  tier: RegionTier;
  realStar: boolean;
  enemyTerritory: boolean;
  completion: SystemCompletion;
  state: SystemRowState;
  at: number; // for "Newest first": a run under way is now, a Resume system its hold, a record its write
}

// Every visited system, ONE row per system (user Q2): the records, the Resume systems and the runs out (under way, or
// home and not yet claimed), each system at its best completion. Its state: under way while a run is out to it, in
// Resume while it is held, else "abandoned" when its kept record says so. Sorted by system id (callers sort for show).
// Pure.
export function systemRows(state: Pick<GameState, "systemRecords" | "heldSystems" | "expeditions" | "gameTimeSeconds">): SystemRow[] {
  const rows = new Map<string, SystemRow>();
  const put = (row: SystemRow, priority: boolean): void => {
    const was = rows.get(row.systemId);
    if (!was) {
      rows.set(row.systemId, row);
      return;
    }
    const best = row.completion.percent > was.completion.percent ? row.completion : was.completion;
    rows.set(row.systemId, { ...(priority ? row : was), completion: best, at: Math.max(row.at, was.at) });
  };
  for (const rec of Object.values(state.systemRecords ?? {})) {
    put(
      {
        systemId: rec.systemId,
        systemName: rec.systemName,
        tier: rec.tier,
        realStar: famousSystem(rec.systemId) !== undefined,
        enemyTerritory: rec.region?.enemyTerritory === true,
        completion: recordCompletion(rec),
        state: rec.abandoned ? "abandoned" : null,
        at: rec.at,
      },
      false,
    );
  }
  for (const h of state.heldSystems ?? []) {
    if (h.kind !== "resume") continue;
    put({ systemId: h.systemId, systemName: h.systemName, tier: h.region.tier, realStar: h.famousId !== null, enemyTerritory: h.region.enemyTerritory, completion: heldCompletion(h), state: "inResume", at: h.heldAt }, true);
  }
  for (const exp of state.expeditions ?? []) {
    // A recalled run flying home whose system was held (Resume: the held record's row; a candidate again: nothing was
    // charted) is not a run out to it. A recalled run with nothing left to hold (every body and objective finished) keeps
    // its row, under way, until its claim writes the record (the same rule as withClaimRecord).
    if (exp.recall && (exp.recall.held !== undefined || !exp.bodies.some((b) => b.scanned))) continue;
    put(
      {
        systemId: exp.targetSystemId,
        systemName: exp.systemName,
        tier: exp.region?.tier ?? 1,
        realStar: famousSystem(exp.targetSystemId) !== undefined,
        enemyTerritory: exp.region?.enemyTerritory === true,
        completion: runCompletion(exp),
        state: "underWay",
        at: state.gameTimeSeconds,
      },
      true,
    );
  }
  return [...rows.values()].sort((a, b) => (a.systemId < b.systemId ? -1 : a.systemId > b.systemId ? 1 : 0));
}

// A system's best completion so far (a candidate card's "Visited"), or null when it was never visited. Pure.
export function visitedCompletion(state: Pick<GameState, "systemRecords" | "heldSystems" | "expeditions" | "gameTimeSeconds">, systemId: string): SystemCompletion | null {
  return systemRows(state).find((r) => r.systemId === systemId)?.completion ?? null;
}

// Per region tier: how many systems are charted (listed) and how many are completed (the map's arcs and key). Pure.
export function regionCompletionTally(rows: readonly SystemRow[]): Map<RegionTier, { charted: number; completed: number }> {
  const out = new Map<RegionTier, { charted: number; completed: number }>();
  for (const r of rows) {
    const t = out.get(r.tier) ?? { charted: 0, completed: 0 };
    out.set(r.tier, { charted: t.charted + 1, completed: t.completed + (r.completion.complete ? 1 : 0) });
  }
  return out;
}
