// Ground Operations 0.14.0 (GO-4, D25 + D26): the GROUND TASK MODEL. Pure building blocks the timeline
// engine (GO-7b) reads; nothing here advances a run.
//
//   - FIGHT POINTS (user 9b.2): a task's progress bar holds a few fight points, their count set by the
//     SITE'S THREAT (the PoI, plus one on a hazardous world). Security must win a fight to pass its point.
//   - SEGMENTS (user 9b.1): the points cut the bar into fightPoints.length + 1 segments. A finished segment
//     banks its share of the task's haul, kept on a loss (progress persists, so a segment is never earned
//     twice); the relic rolls only when the task reaches 100% (GO-7b).
//   - WORK TIME (D25 + D26): a task's full work seconds for the team set working it: the Science fieldwork
//     pace divides it, the body's hazard slows it, and the team's hazard resist (the Science party's
//     fieldwork resist PLUS the Security members' own resist, the Assault Hardsuit line) cuts that slowdown.
//
// DETERMINISM: no new RNG draws. The only roll here is the task's full haul (taskFullHaul), on the SAME
// keyed reward stream the legacy resolver uses (gambit.ts taskRewardSeed), so one task keeps one reward
// roll whichever engine resolves it. Module graph: model, fieldwork, relics, gambit; never expedition.ts
// (expedition.ts imports this module for ACTIVITY_SECONDS, and GO-7's groundOps.ts sits between them).

import type { Expedition, ExpeditionActivity, ExpeditionBody, SnapshotMember } from "./model";
import type { ExpeditionPoiId } from "./expeditionContent";
import { fieldworkEffect, fieldworkHazardResist, fieldworkSpeedMult } from "./fieldwork";
import { resistedHazard } from "./relics";
import { rollHaul, taskRewardSeed } from "./gambit";

// ===== Work time base =====

// The base work time of ONE ground task for a bare party (no Science fieldwork, a calm world). Moved here
// from expedition.ts at GO-4 (expedition.ts re-exports it unchanged) so this module never imports
// expedition.ts. The legacy activities phase (expedition.ts activityDurationSeconds) reads the same value.
export const ACTIVITY_SECONDS = 600; // ~10 min IRL per ground-team task

// ===== Fight points (user 9b.2) =====

// Fight points per site, by the site's threat. FIRST-PASS TUNABLE (the mockup GO-M2 values where shown).
// Exhaustive over the PoI catalog (a Record over ExpeditionPoiId), so a new PoI is a compile error until
// it is rated here.
export const FIGHT_POINTS_BY_POI: Readonly<Record<ExpeditionPoiId, number>> = {
  mineralOutcrop: 1,
  caveNetwork: 2,
  ancientRuins: 2,
  xenoFloraBloom: 2,
  crashedShip: 3,
  geothermalChamber: 3,
  buriedVault: 3,
  derelictOutpost: 4,
  subterraneanCivilization: 4,
};
export const FIGHT_POINTS_DEFAULT = 2; // a PoI id the table does not rate (an old or unknown id)
export const FIGHT_POINTS_HAZARD_STEP = 0.6; // a body at or above this hazard adds one fight point
export const FIGHT_POINTS_MIN = 1;
export const FIGHT_POINTS_MAX = 5;

// How many fight points a task at `poiId` holds on a body of `hazard` (the caller passes the body's RAW
// hazard: the site's danger, not what a resist makes of it). The table value (FIGHT_POINTS_DEFAULT for an
// unrated id) plus one at hazard >= FIGHT_POINTS_HAZARD_STEP, clamped to [FIGHT_POINTS_MIN,
// FIGHT_POINTS_MAX]. A NaN hazard adds nothing. Pure.
export function fightPointCount(poiId: string, hazard: number): number {
  const table = FIGHT_POINTS_BY_POI as Readonly<Record<string, number>>;
  const base = Object.prototype.hasOwnProperty.call(table, poiId) ? table[poiId] : FIGHT_POINTS_DEFAULT;
  const count = base + (hazard >= FIGHT_POINTS_HAZARD_STEP ? 1 : 0);
  return Math.min(FIGHT_POINTS_MAX, Math.max(FIGHT_POINTS_MIN, count));
}

// The fight points of an n-point task as progress fractions: evenly spaced k / (n + 1), k = 1..n, so every
// segment is the same length (the mockup GO-M4 bar shows 3 points at 25 / 50 / 75%). Ascending, each in
// (0, 1). [] for n < 1 or a non-integer n. Returns a fresh array. Pure.
export function fightPointFractions(n: number): number[] {
  if (!Number.isInteger(n) || n < 1) return [];
  const out: number[] = [];
  for (let k = 1; k <= n; k += 1) out.push(k / (n + 1));
  return out;
}

// ===== Segments (user 9b.1) =====

// The number of segments on a task's bar: one more than its fight points (a task with no stamped fight
// points, a legacy activity, is one segment). Pure.
export function segmentCount(task: Pick<ExpeditionActivity, "fightPoints">): number {
  return (task.fightPoints?.length ?? 0) + 1;
}

export interface TaskHaul {
  materials: Record<string, number>;
  credits: number;
}

// One whole-number share of `total` for segment s of N: floor(total * (s + 1) / N) - floor(total * s / N).
// The shares of s = 0..N-1 telescope to exactly `total` (no unit lost or minted), and each differs from
// total / N by less than 1.
function segmentShare(total: number, N: number, s: number): number {
  return Math.floor((total * (s + 1)) / N) - Math.floor((total * s) / N);
}

// Segment s's share (0-based) of a task's FULL haul split exactly across N segments: every material and the
// credits split by segmentShare, so the N segment hauls sum to the full haul exactly. A material whose
// share is 0 is left out of the record (a segment finding never lists a zero line). An out-of-range s, or N
// not a whole number >= 1, is an empty haul. Returns fresh data. Pure.
export function segmentHaul(full: TaskHaul, N: number, s: number): TaskHaul {
  if (!Number.isInteger(N) || N < 1 || !Number.isInteger(s) || s < 0 || s >= N) return { materials: {}, credits: 0 };
  const materials: Record<string, number> = {};
  for (const [itemId, qty] of Object.entries(full.materials)) {
    const share = segmentShare(qty, N, s);
    if (share !== 0) materials[itemId] = share;
  }
  return { materials, credits: segmentShare(full.credits, N, s) };
}

// ===== The team set working a task =====

// What the task readers need from ONE ground team: its members (ids in exp.roster, slot order) and its share
// of the ship's Science crew layer (GO-7a freezes it as GroundOpsFactors.scienceShare; 1 with one team, so
// every crew-layer read equals the legacy run's). GO-7b passes each GroundTeamRun with its share.
export interface GroundTaskTeam {
  securityIds: readonly string[];
  scienceIds: readonly string[];
  scienceShare: number;
}

// The snapshot members of `pool` named by the teams' ids, team order then slot order, each member once
// (a repeat id is skipped). An id not in the pool is skipped. Pure.
function teamMembers(
  pool: readonly SnapshotMember[] | undefined,
  teams: readonly GroundTaskTeam[],
  ids: (team: GroundTaskTeam) => readonly string[],
): SnapshotMember[] {
  const byId = new Map<string, SnapshotMember>();
  for (const m of pool ?? []) if (!byId.has(m.memberId)) byId.set(m.memberId, m);
  const seen = new Set<string>();
  const out: SnapshotMember[] = [];
  for (const team of teams) {
    for (const id of ids(team)) {
      const m = byId.get(id);
      if (!m || seen.has(id)) continue;
      seen.add(id);
      out.push(m);
    }
  }
  return out;
}

// The team set's FIELDWORK RUN: the shape the unchanged fieldwork.ts readers take. Science = the teams'
// Science members (a multi-team task sums its parties' fieldwork); scienceStrength = the run's frozen
// Science crew layer times the teams' summed share (each share clamped at 0). Security stays empty: the
// fieldwork readers never read it (Science does the fieldwork, design D2). Pure; fresh arrays.
export function taskFieldworkRun(
  exp: Pick<Expedition, "roster" | "scienceStrength">,
  teams: readonly GroundTaskTeam[],
): Pick<Expedition, "roster" | "scienceStrength"> {
  let share = 0;
  for (const team of teams) share += Math.max(0, team.scienceShare);
  return {
    roster: { security: [], science: teamMembers(exp.roster?.science, teams, (t) => t.scienceIds) },
    scienceStrength: (exp.scienceStrength ?? 0) * share,
  };
}

// The Security members' own hazard resist, summed (the Assault Hardsuit's groundHazardResist line, plus
// any trait resist on a Security member; D26: "less planet-hazard slowdown on task work"). Read off each
// snapshot's converted groundStats.hazardResist. Never negative. Pure.
export function taskSecurityHazardResist(exp: Pick<Expedition, "roster">, teams: readonly GroundTaskTeam[]): number {
  let total = 0;
  for (const m of teamMembers(exp.roster?.security, teams, (t) => t.securityIds)) total += m.groundStats.hazardResist ?? 0;
  return Math.max(0, total);
}

// The team set's hazard resist on `body`: the Science party's fieldwork resist on the body's planet type
// plus the Security members' own resist. Never negative. Pure.
export function taskTeamHazardResist(
  exp: Pick<Expedition, "roster" | "scienceStrength">,
  teams: readonly GroundTaskTeam[],
  body: Pick<ExpeditionBody, "planetType">,
): number {
  return fieldworkHazardResist(taskFieldworkRun(exp, teams), body.planetType) + taskSecurityHazardResist(exp, teams);
}

// ===== Work time (D25 + D26) =====

// How much a hazardous world slows task work: a hazard-1.0 body (after resist) takes (1 + this) times as
// long. [PROVISIONAL, Q10] mirrors the scan's SCAN_HAZARD_PENALTY (expedition.ts).
export const TASK_HAZARD_PENALTY = 0.5;
// D23: the pace has no cap, so a task is floored at 1 second (never a zero-length task).
export const TASK_MIN_WORK_SECONDS = 1;

// A task's FULL work seconds (0% to 100%) on `body` for the team set `teams`:
//   ACTIVITY_SECONDS / fieldworkSpeedMult(teamRun, planetType)
//     * (1 + resistedHazard(hazard, museumResist + teamHazardResist) * TASK_HAZARD_PENALTY)
// rounded to whole seconds, floored at TASK_MIN_WORK_SECONDS. museumResist = exp.hazardResist (the frozen
// museum + gear resist); teamHazardResist = taskTeamHazardResist (Science fieldwork resist + the Security
// Assault Hardsuit line). resistedHazard bounds the summed resist, so the slowdown never goes below 1. On a
// hazard-0 body with one team holding the whole roster this is exactly the legacy activityDurationSeconds.
// A work STEP lasts (to - from) of this (GO-7b). Pure (reads the stored run only).
export function taskWorkSeconds(
  exp: Pick<Expedition, "roster" | "scienceStrength" | "hazardResist">,
  teams: readonly GroundTaskTeam[],
  body: Pick<ExpeditionBody, "planetType" | "hazard">,
): number {
  const run = taskFieldworkRun(exp, teams);
  const speed = fieldworkSpeedMult(run, body.planetType);
  const teamResist = fieldworkHazardResist(run, body.planetType) + taskSecurityHazardResist(exp, teams);
  const museumResist = exp.hazardResist ?? 0;
  const resist = teamResist > 0 ? museumResist + teamResist : museumResist;
  const hazardSlow = 1 + Math.max(0, resistedHazard(body.hazard, resist)) * TASK_HAZARD_PENALTY;
  return Math.max(TASK_MIN_WORK_SECONDS, Math.round((ACTIVITY_SECONDS / speed) * hazardSlow));
}

// ===== The task's full haul (the reused legacy reward stream) =====

// A task's FULL material + credit haul, rolled ONCE on the task's keyed reward stream (gambit.ts
// taskRewardSeed: the SAME key the legacy resolver uses for this flat index), on the body's RAW hazard
// (resisting a world's danger makes the work easier, not the find poorer), scaled by the yieldMult of the
// team set banking it. segmentHaul splits it across the task's segments. For one team holding the whole
// roster it equals the legacy win haul exactly. Pure.
export function taskFullHaul(
  exp: Pick<Expedition, "seed" | "roster" | "scienceStrength">,
  teams: readonly GroundTaskTeam[],
  body: Pick<ExpeditionBody, "planetType" | "hazard">,
  poiId: string,
  flatIndex: number,
): TaskHaul {
  const yieldMult = fieldworkEffect(taskFieldworkRun(exp, teams), body.planetType, poiId).yieldMult;
  return rollHaul(taskRewardSeed(exp, flatIndex), body.planetType, body.hazard, yieldMult);
}
