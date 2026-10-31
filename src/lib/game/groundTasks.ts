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

import type { BodyRiskGrades, Expedition, ExpeditionActivity, ExpeditionBody, ExpeditionRegionStamp, SnapshotMember } from "./model";
import { poiMaterialMult, surfaceWorkMult, type ExpeditionPoiId } from "./expeditionContent";
import { fieldworkEffect, fieldworkHazardResist, fieldworkSpeedMult } from "./fieldwork";
import { resistedHazard } from "./relics";
import { rollHaul, taskRewardSeed } from "./gambit";
import {
  CLEARING_FIGHT_POINTS_MIN,
  CLEARING_SITE_RULES,
  COMBAT_FIGHT_MOD,
  FAUNA_FIGHT_MOD,
  HOSTILE_SITE_RULES,
  LIFE_SITES,
  RISK_FIGHT_POINTS_MIN,
  floraWorkMult,
  isClearingSiteId,
  isHostileSiteId,
  tierHaulMult,
  toRiskGrade,
} from "./riskFactors";

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

// Squads SQ-4 (design 5.3): the RISK-AWARE count for a task on a body carrying risk grades:
//   clamp(table + combatMod + lifeMod + hazardStep, RISK_FIGHT_POINTS_MIN (0), FIGHT_POINTS_MAX)
// combatMod by the body's combat grade, lifeMod by its fauna grade at a life site (riskFactors.ts), hazardStep as
// fightPointCount. The floor is 0, so a calm site is pure survey work (no Security needed). A HOSTILE SITE holds
// its own fixed count (riskFactors.ts HOSTILE_SITE_RULES). Pure.
export function riskFightPointCount(poiId: string, hazard: number, risk: Pick<BodyRiskGrades, "combat" | "fauna">): number {
  if (isHostileSiteId(poiId)) return HOSTILE_SITE_RULES[poiId].fightPoints;
  // Squads SQ-6 follow-up: a CLEARING task (its base, the combat mod, the fauna mod for the landing zone, the
  // hazard step), at least CLEARING_FIGHT_POINTS_MIN.
  if (isClearingSiteId(poiId)) {
    const rule = CLEARING_SITE_RULES[poiId];
    const fauna = rule.driver === "fauna" ? (FAUNA_FIGHT_MOD[toRiskGrade(risk.fauna)] ?? 0) : 0;
    const n = rule.baseFightPoints + (COMBAT_FIGHT_MOD[toRiskGrade(risk.combat)] ?? 0) + fauna + (hazard >= FIGHT_POINTS_HAZARD_STEP ? 1 : 0);
    return Math.min(FIGHT_POINTS_MAX, Math.max(CLEARING_FIGHT_POINTS_MIN, n));
  }
  const table = FIGHT_POINTS_BY_POI as Readonly<Record<string, number>>;
  const base = Object.prototype.hasOwnProperty.call(table, poiId) ? table[poiId] : FIGHT_POINTS_DEFAULT;
  const combatMod = COMBAT_FIGHT_MOD[toRiskGrade(risk.combat)] ?? 0;
  const lifeMod = LIFE_SITES.includes(poiId) ? (FAUNA_FIGHT_MOD[toRiskGrade(risk.fauna)] ?? 0) : 0;
  const count = base + combatMod + lifeMod + (hazard >= FIGHT_POINTS_HAZARD_STEP ? 1 : 0);
  return Math.min(FIGHT_POINTS_MAX, Math.max(RISK_FIGHT_POINTS_MIN, count));
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
// (a repeat id is skipped). An id not in the pool is skipped. Exported (GO-5) so the task fight builds its
// Security squad by the same rule (groundFight.ts). Pure.
export function teamSnapshotMembers<T>(
  pool: readonly SnapshotMember[] | undefined,
  teams: readonly T[],
  ids: (team: T) => readonly string[],
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
  exp: Pick<Expedition, "roster" | "scienceStrength" | "museumSciencePower">,
  teams: readonly GroundTaskTeam[],
): Pick<Expedition, "roster" | "scienceStrength" | "museumSciencePower"> {
  let share = 0;
  for (const team of teams) share += Math.max(0, team.scienceShare);
  return {
    roster: { security: [], science: teamSnapshotMembers(exp.roster?.science, teams, (t) => t.scienceIds) },
    scienceStrength: (exp.scienceStrength ?? 0) * share,
    // Wiring WR-11 (OC-H1): the Museum's Science team power on the members is a per-member factor, not a pool share.
    ...(exp.museumSciencePower !== undefined ? { museumSciencePower: exp.museumSciencePower } : {}),
  };
}

// The Security members' own hazard resist, summed (the Assault Hardsuit's groundHazardResist line, plus
// any trait resist on a Security member; D26: "less planet-hazard slowdown on task work"). Read off each
// snapshot's converted groundStats.hazardResist. Never negative. Pure.
export function taskSecurityHazardResist(exp: Pick<Expedition, "roster">, teams: readonly GroundTaskTeam[]): number {
  let total = 0;
  for (const m of teamSnapshotMembers(exp.roster?.security, teams, (t) => t.securityIds)) total += m.groundStats.hazardResist ?? 0;
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
// A work STEP lasts (to - from) of this (GO-7b). Squads SQ-4: a body with FLORA (risk-aware runs only) slows the
// dig by riskFactors.ts floraWorkMult (exactly 1 without it, so every other body is unchanged). Pure (reads the
// stored run only).
export function taskWorkSeconds(
  exp: Pick<Expedition, "roster" | "scienceStrength" | "hazardResist" | "museumSciencePower" | "siteRules">,
  teams: readonly GroundTaskTeam[],
  body: Pick<ExpeditionBody, "planetType" | "hazard" | "risk">,
  poiId?: string,
): number {
  const run = taskFieldworkRun(exp, teams);
  const rawSpeed = fieldworkSpeedMult(run, body.planetType);
  // NaN guard (GO-4 review): a corrupt stored value must never stall the timeline with a NaN step length. A
  // pace that is not a positive finite number reads as the bare pace (1); a resist that is not a positive
  // number reads as none (resistedHazard already treats NaN that way); a hazard that is not a finite number
  // >= 0 after resist reads as calm (no slowdown). So the result is always a whole number >= 1.
  const speed = rawSpeed > 0 && Number.isFinite(rawSpeed) ? rawSpeed : 1;
  const teamResist = fieldworkHazardResist(run, body.planetType) + taskSecurityHazardResist(exp, teams);
  const museumResist = exp.hazardResist ?? 0;
  const resist = teamResist > 0 ? museumResist + teamResist : museumResist;
  const presented = resistedHazard(body.hazard, resist);
  const hazardSlow = 1 + (presented > 0 && Number.isFinite(presented) ? presented : 0) * TASK_HAZARD_PENALTY;
  const flora = floraWorkMult(body);
  const base = flora === 1 ? (ACTIVITY_SECONDS / speed) * hazardSlow : (ACTIVITY_SECONDS / speed) * hazardSlow * flora;
  // Wiring WR-11 (OC-G6 "Model Ocean only"): surface work on an Ocean world is slower on a run stamped with the site
  // rules (expeditionContent.ts surfaceWorkMult; exactly 1 otherwise, so the time is the one before WR-11).
  const surface = surfaceWorkMult(exp, body.planetType, poiId);
  const secs = surface === 1 ? base : base * surface;
  return Math.max(TASK_MIN_WORK_SECONDS, Math.round(secs));
}

// ===== The task's full haul (the reused legacy reward stream) =====

// A task's FULL material + credit haul, rolled ONCE on the task's keyed reward stream (gambit.ts
// taskRewardSeed: the SAME key the legacy resolver uses for this flat index), on the body's RAW hazard
// (resisting a world's danger makes the work easier, not the find poorer), scaled by the yieldMult of the
// team set banking it. segmentHaul splits it across the task's segments. For one team holding the whole
// roster it equals the legacy win haul exactly. Squads SQ-4 (user #6, "The greater the risk, the greater the
// reward"): `riskBonus` (riskFactors.ts riskRewardBonus of the task's difficulty) scales the haul by (1 + it) on
// the SAME draws; 0, every unrated task, leaves the roll exactly as before. Expedition Tiers G2-2 (user G16): the
// tier of the run's region stamp (Expedition.region, written since G2-2) multiplies it too (riskFactors.ts
// tierHaulMult: Tier I x1); a run without the stamp (dispatched before G2-2) rolls exactly as before. Pure.
export function taskFullHaul(
  exp: Pick<Expedition, "seed" | "roster" | "scienceStrength" | "museumSciencePower" | "siteRules" | "groundOutputShare"> & { region?: Pick<ExpeditionRegionStamp, "tier"> },
  teams: readonly GroundTaskTeam[],
  body: Pick<ExpeditionBody, "planetType" | "hazard">,
  poiId: string,
  flatIndex: number,
  riskBonus: number = 0,
): TaskHaul {
  const yieldMult = fieldworkEffect(taskFieldworkRun(exp, teams), body.planetType, poiId).yieldMult;
  const risked = riskBonus > 0 && Number.isFinite(riskBonus) ? yieldMult * (1 + riskBonus) : yieldMult;
  const tier = tierHaulMult(exp.region);
  const tiered = tier !== 1 ? risked * tier : risked;
  // Wiring WR-9 (OC-E9): Command Presence, frozen on the run, grows the objective's haul (absent = unchanged).
  const output = exp.groundOutputShare;
  const scale = output !== undefined && output > 0 && Number.isFinite(output) ? tiered * (1 + output) : tiered;
  // Wiring WR-11 (OC-G4): a site that names more materials hauls more of them on a run stamped with the site rules.
  return rollHaul(taskRewardSeed(exp, flatIndex), body.planetType, body.hazard, scale, poiMaterialMult(exp, poiId));
}
