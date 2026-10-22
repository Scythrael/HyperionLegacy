// Squads SQ-6 (docs/plans/2026-10-12-squads-and-subspace-telescope-design.md sections 6.3 and 6.5): the LAUNCH
// RECOMMENDATION and the pieces of the telescope's reading that read the system's TASKS. Pure; display only.
//
// The user (3c): "the scans become refined enough to be able to determine details like 'yeah, you need more
// strike teams than science teams for this one' where you even potentially get a recommendation on the
// expedition card on what to launch with. So you don't run the risk of mis-speccing to get there and suddenly
// wind up with a poorly made team."
//
//   THE TASK PREVIEW (SystemTaskPreview, built by expedition.ts systemTaskPreview from the candidate's seed on the
//   run's own discovery and stamping path): every task the system holds with the needs the run STAMPS
//   (riskFactors.ts tierNeeds: at most one squad of each type at Tiers I and II; as rolled from Tier III) and its
//   difficulty. Every hostile site the risk roll placed is listed; the run reveals one only when the deployed
//   squads field it, so a composition that cannot field it leaves it behind.
//   DETAIL GATING (design 6.3, gateLaunchView): Per body (3) adds the TASK DEMAND line, Recommendation (4) the
//   RECOMMENDATION, Forecast (5) the FORECAST. Below a level its piece is never computed, so it can never leak.
//   THE RECOMMENDATION (design 6.5): rank the hull's valid compositions by
//     1. COVERAGE: the difficulty-weighted share of the tasks some crew of the composition covers;
//     2. SOLO SHARE: the weighted share ONE team of it covers alone (solo tasks run in parallel);
//     3. BALANCE: the composition's Security share of its squads closest to the system's Security demand (the
//        weighted share of required squads that are Security);
//     4. the FEWEST squads changed from the ship's current composition;
//     5. Ground + Ground.
//   THEN THE ODDS, ONLY WHEN THE FIGHTS ARE RISKY (user, 2026-10-13): the winner's fight odds (the threat band of
//   the weighted mean clear rate of the crews its plan would send on the previewed fights) are read; when they fall
//   below ODDS_RISKY_BELOW ("A Worthy Adversary"), the covering mix (the same coverage) with the best band strictly
//   above the winner's takes its place (ties: the ranking's order). The simplest mix stays whenever the fights are
//   not risky; only the winner's odds are read then (one simulated launch). The odds weigh in only from Tier III
//   (beyond riskFactors.ts SAFE_NEEDS_MAX_TIER): at Tiers I and II the ranking above stands, no launch simulated.
//   Output: the best composition, a headline and a one-line reason, and what the CURRENT composition would leave
//   unfinished (only possible from Tier III: tierNeeds keeps Tiers I and II fieldable by every valid
//   composition). Applying it is groundTeams.ts applyComposition (SQ-7's "Set composition").
//   All text here is [PROPOSAL] wording.
//
// Module graph: model (types), groundComposition, riskFactors, telescope (TELESCOPE_DETAIL), expeditionContent
// (labels), combat/threatAssessment (a type). Imported by expedition.ts and the UI; it imports neither.

import type { BodyRiskGrades, GroundTaskNeeds, GroundTeamKind, RegionTier, ShipTypeKey } from "./model";
import { compositionLabel, compositionSquads, securitySquadsOf, squadsOfType, validCompositions } from "./groundComposition";
import { DIFFICULTY_NAMES, SAFE_NEEDS_MAX_TIER, difficultyWeight, hostileSiteFieldable, isHostileSiteId } from "./riskFactors";
import { TELESCOPE_DETAIL, type SystemTelescopeReading } from "./telescope";
import { groundSiteLabel } from "./expeditionContent";
import type { NebulaKindId } from "./gasGiantContent";
import { THREAT_TIER_ORDER, threatAssessment, type ThreatAssessment, type ThreatTier } from "./combat/threatAssessment";

// ===== The task preview =====

export interface PreviewTask {
  bodyIndex: number;
  poiId: string; // a discovery PoI or a hostile site id
  hostile: boolean; // a hostile site (revealed only when the deployed squads field it)
  fightPoints: number;
  needs: GroundTaskNeeds; // as the run stamps them (tierNeeds; a hostile site keeps its own)
  difficulty: number; // 1 Simple .. 5 Deadly
}

export interface SystemTaskPreview {
  tier: RegionTier;
  enemyTerritory: boolean;
  bodies: BodyRiskGrades[];
  tasks: PreviewTask[]; // body order, then discovery order
  // Gas Giant Study GG-2: the ORBITAL bodies the ship studies (body indices, ascending): no ground objective and no
  // squad need there. Written only when the system holds one, so every other preview keeps its exact shape.
  studies?: number[];
  // Gas Giant Study GG-4: the system's NEBULA (the ship sweeps it after the bodies; no squad). Written only when the
  // system holds one.
  nebula?: NebulaKindId;
}

// The preview as THIS HULL can meet it (SQ-6 review Minor 1): a hostile site no valid composition of the hull can
// field never appears in its runs (the scan reveals one only when the deployed squads field it), so it is dropped
// from the demand, the recommendation and the forecast. Every other task stays. Pure; a fresh object.
export function previewForHull(preview: SystemTaskPreview, typeKey: ShipTypeKey): SystemTaskPreview {
  const fleets = validCompositions(typeKey).map(compositionSquads);
  return {
    ...preview,
    tasks: preview.tasks.filter((t) => !t.hostile || !isHostileSiteId(t.poiId) || fleets.some((sq) => hostileSiteFieldable(t.poiId as "enemyColony", sq))),
  };
}

// ===== Small readers =====

const EPS = 1e-9;

function weightOf(task: Pick<PreviewTask, "difficulty">): number {
  return difficultyWeight(task.difficulty);
}

function covers(squads: GroundTaskNeeds, needs: GroundTaskNeeds): boolean {
  return squads.security >= needs.security && squads.science >= needs.science;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function squadsText(n: number, type: "Security" | "Science"): string {
  return plural(n, `${type} squad`, `${type} squads`);
}

function taskLabel(poiId: string): string {
  return groundSiteLabel(poiId) ?? "An objective";
}

// ===== The detail 3 task demand (design 6.3 "Per body") =====

export interface TaskDemand {
  bodies: number;
  securityBodies: number; // bodies holding at least one task that needs a Security squad
  tasks: number;
  noSecurityTasks: number; // survey work: no Security squad needed
  twoSecurityTasks: number; // tasks needing 2 or more Security squads
  twoScienceTasks: number; // tasks needing 2 or more Science squads
  maxSecurity: number;
  maxScience: number;
  // Gas Giant Study GG-2: the ship studies the system holds (one per orbital body; no squad needed). Written only when
  // there is one.
  shipStudies?: number;
  // GG-4: the nebula sweep the system holds (no squad needed). Written only when there is one.
  nebulaSweep?: 1;
}

export function taskDemand(preview: SystemTaskPreview): TaskDemand {
  const securityBodies = new Set<number>();
  let maxSecurity = 0;
  let maxScience = 0;
  for (const t of preview.tasks) {
    if (t.needs.security > 0) securityBodies.add(t.bodyIndex);
    maxSecurity = Math.max(maxSecurity, t.needs.security);
    maxScience = Math.max(maxScience, t.needs.science);
  }
  return {
    bodies: preview.bodies.length,
    securityBodies: securityBodies.size,
    tasks: preview.tasks.length,
    noSecurityTasks: preview.tasks.filter((t) => t.needs.security === 0).length,
    twoSecurityTasks: preview.tasks.filter((t) => t.needs.security >= 2).length,
    twoScienceTasks: preview.tasks.filter((t) => t.needs.science >= 2).length,
    maxSecurity,
    maxScience,
    ...(preview.studies && preview.studies.length > 0 ? { shipStudies: preview.studies.length } : {}),
    ...(preview.nebula ? { nebulaSweep: 1 as const } : {}),
  };
}

// "Security work on 3 of 5 bodies; 2 objectives need 2 Science squads" (design 6.3; player-facing text says
// "objective", user 2026-10-14). Pure.
export function taskDemandText(d: TaskDemand): string {
  const parts: string[] = [];
  parts.push(
    d.securityBodies === 0
      ? `No Security work expected on ${plural(d.bodies, "body", "bodies")}`
      : `Security work on ${d.securityBodies} of ${plural(d.bodies, "body", "bodies")}`,
  );
  const heavy = (n: number, max: number, type: "Security" | "Science"): string =>
    `${plural(n, "objective needs", "objectives need")} 2${max > 2 ? " or more" : ""} ${type} squads`;
  if (d.twoSecurityTasks > 0) parts.push(heavy(d.twoSecurityTasks, d.maxSecurity, "Security"));
  if (d.twoScienceTasks > 0) parts.push(heavy(d.twoScienceTasks, d.maxScience, "Science"));
  // Gas Giant Study GG-2 (mockup v3 "Studies need no squad").
  // GG-4 (mockup v3 "2 ship studies · 1 nebula sweep · Studies need no squad").
  const studies = d.shipStudies !== undefined && d.shipStudies > 0 ? plural(d.shipStudies, "ship study", "ship studies") : null;
  const sweep = d.nebulaSweep === 1 ? "1 nebula sweep" : null;
  if (studies || sweep) parts.push(`${[studies, sweep].filter((s) => s !== null).join(" and ")}, no squad needed`);
  return parts.join("; ");
}

// ===== Scoring one composition (design 6.5 step 2) =====

// The difficulty-weighted squads the tasks require: Security and in all. Pure.
function weightedNeeds(preview: SystemTaskPreview): { security: number; total: number } {
  let security = 0;
  let total = 0;
  for (const t of preview.tasks) {
    const w = weightOf(t);
    security += w * t.needs.security;
    total += w * (t.needs.security + t.needs.science);
  }
  return { security, total };
}

// The system's Security demand: the difficulty-weighted share of required squads that are Security (0.5 when the
// tasks require nothing). Pure.
export function securityDemand(preview: SystemTaskPreview): number {
  const w = weightedNeeds(preview);
  return w.total > 0 ? w.security / w.total : 0.5;
}

// Every ordering of a short list (team counts are 2 today). Pure.
function permutations<T>(list: readonly T[]): T[][] {
  if (list.length <= 1) return [[...list]];
  const out: T[][] = [];
  list.forEach((item, i) => {
    for (const rest of permutations([...list.slice(0, i), ...list.slice(i + 1)])) out.push([item, ...rest]);
  });
  return out;
}

// The fewest squads changed turning composition `from` into `to`, over every matching of the teams (team order
// never matters; Ground -> Strike changes 1 squad, Strike -> Survey 2). Pure.
export function compositionChanges(from: readonly GroundTeamKind[], to: readonly GroundTeamKind[]): number {
  if (from.length !== to.length) return 2 * Math.max(from.length, to.length);
  let best = Infinity;
  for (const p of permutations(to)) {
    let n = 0;
    p.forEach((kind, i) => {
      n += Math.abs(securitySquadsOf(kind) - securitySquadsOf(from[i]));
    });
    best = Math.min(best, n);
  }
  return best;
}

export interface UnfinishedTask {
  bodyIndex: number;
  poiId: string;
  label: string;
  needs: GroundTaskNeeds;
  text: string; // "Enemy Colony needs 2 Security squads" (the types the composition falls short on)
}

function unfinishedOf(task: PreviewTask, squads: GroundTaskNeeds): UnfinishedTask {
  const label = taskLabel(task.poiId);
  const short: string[] = [];
  if (task.needs.security > squads.security) short.push(squadsText(task.needs.security, "Security"));
  if (task.needs.science > squads.science) short.push(squadsText(task.needs.science, "Science"));
  return { bodyIndex: task.bodyIndex, poiId: task.poiId, label, needs: { ...task.needs }, text: `${label} needs ${short.join(" and ")}` };
}

// The tasks no crew of composition `kinds` covers (its squads summed fall short), in task order. Pure.
export function unfinishedTasksUnder(preview: SystemTaskPreview, kinds: readonly GroundTeamKind[]): UnfinishedTask[] {
  const squads = compositionSquads(kinds);
  return preview.tasks.filter((t) => !covers(squads, t.needs)).map((t) => unfinishedOf(t, squads));
}

export interface CompositionScore {
  kinds: GroundTeamKind[];
  label: string;
  coverage: number; // 0..1, difficulty-weighted
  solo: number; // 0..1, difficulty-weighted
  securityShare: number; // the composition's Security squads / its squads
  balanceGap: number; // |securityShare - securityDemand|
  changes: number; // squads changed from the current composition
  unfinished: UnfinishedTask[];
  soloTasks: number; // tasks one team covers alone (a count, for the reason line)
  fightOdds: number | null; // the weighted mean clear rate of the planned crews on the fights (null: unknown)
  oddsTier: ThreatTier | null; // its threat band
  oddsName: string | null; // the band's name ("Likely Victory")
}

// The weighted mean clear rate of composition `kinds` on the previewed fights (expedition.ts
// compositionFightOdds builds it from the planned crews), or null when unknown. Display only.
export type FightOddsOf = (kinds: readonly GroundTeamKind[]) => number | null;

// The threat band a mean clear rate reads as (the patrol card's seven tiers). Pure.
function oddsBand(odds: number): ThreatAssessment {
  const samples = 1000;
  return threatAssessment(Math.round(Math.max(0, Math.min(1, odds)) * samples), samples);
}

// One composition's scores against the preview (design 6.5 step 2). Pure.
export function scoreComposition(
  preview: SystemTaskPreview,
  kinds: readonly GroundTeamKind[],
  current: readonly GroundTeamKind[],
  fightOdds: number | null = null,
): CompositionScore {
  const squads = compositionSquads(kinds);
  const teams = kinds.map((k) => ({ security: squadsOfType(k, "security"), science: squadsOfType(k, "science") }));
  let total = 0;
  let covered = 0;
  let solo = 0;
  let soloTasks = 0;
  for (const t of preview.tasks) {
    const w = weightOf(t);
    total += w;
    if (covers(squads, t.needs)) covered += w;
    if (teams.some((q) => covers(q, t.needs))) {
      solo += w;
      soloTasks += 1;
    }
  }
  const allSquads = squads.security + squads.science;
  const securityShare = allSquads > 0 ? squads.security / allSquads : 0;
  return {
    kinds: [...kinds],
    label: compositionLabel(kinds),
    coverage: total > 0 ? covered / total : 1,
    solo: total > 0 ? solo / total : 1,
    securityShare,
    // Nothing required: the balance favors no composition (the ship keeps what it has).
    balanceGap: weightedNeeds(preview).total > 0 ? Math.abs(securityShare - securityDemand(preview)) : 0,
    changes: compositionChanges(current, kinds),
    unfinished: unfinishedTasksUnder(preview, kinds),
    soloTasks,
    fightOdds,
    oddsTier: fightOdds === null ? null : oddsBand(fightOdds).tier,
    oddsName: fightOdds === null ? null : oddsBand(fightOdds).name,
  };
}

// ONLY WHEN FIGHTS ARE RISKY (user, 2026-10-13): the odds are weighed only when the ranking's winner reads BELOW
// this band on the previewed fights. The user's value ("A Worthy Adversary"), not a placeholder.
export const ODDS_RISKY_BELOW: ThreatTier = "worthy";

// A band's place, best first (Guaranteed Victory 0 .. Impossible 6). Pure.
function bandRank(tier: ThreatTier): number {
  return THREAT_TIER_ORDER.indexOf(tier);
}

// Do odds in this band read risky (below ODDS_RISKY_BELOW)? Pure.
export function oddsAreRisky(tier: ThreatTier): boolean {
  return bandRank(tier) > bandRank(ODDS_RISKY_BELOW);
}

// a before b? (design 6.5 step 3). Pure.
function ranksAhead(a: CompositionScore, b: CompositionScore, groundGround: string): number {
  if (Math.abs(a.coverage - b.coverage) > EPS) return b.coverage - a.coverage;
  if (Math.abs(a.solo - b.solo) > EPS) return b.solo - a.solo;
  if (Math.abs(a.balanceGap - b.balanceGap) > EPS) return a.balanceGap - b.balanceGap;
  if (a.changes !== b.changes) return a.changes - b.changes;
  return (a.label === groundGround ? 0 : 1) - (b.label === groundGround ? 0 : 1);
}

// The hull's valid compositions, best first (design 6.5 steps 1 to 3; the final tie keeps validCompositions'
// order). Pure.
export function rankCompositions(preview: SystemTaskPreview, typeKey: ShipTypeKey, current: readonly GroundTeamKind[]): CompositionScore[] {
  const comps = validCompositions(typeKey);
  const groundGround = compositionLabel(comps[0] ?? []);
  return comps
    .map((kinds, i) => ({ score: scoreComposition(preview, kinds, current), i }))
    .sort((a, b) => ranksAhead(a.score, b.score, groundGround) || a.i - b.i)
    .map(({ score }) => score);
}

// ===== The recommendation (design 6.5 step 4) =====

export interface LaunchRecommendation {
  kinds: GroundTeamKind[]; // the best composition (validCompositions order)
  label: string; // "Strike + Ground"
  current: GroundTeamKind[]; // the ship's composition now
  currentLabel: string;
  isCurrent: boolean; // the ship already fields it (no change asked)
  headline: string; // "Launch with Strike + Ground" / "Your Ground + Ground suits this system."
  reason: string; // one line
  unfinished: UnfinishedTask[]; // what the CURRENT composition would leave unfinished
  unfinishedText: string | null;
  stillUnfinished: UnfinishedTask[]; // what even the recommended composition leaves (nothing on the hull covers it)
  stillUnfinishedText: string | null;
  oddsDecided: boolean; // the ranking's winner read risky and a covering mix with better odds took its place
  riskyFightsText: string | null; // the winner reads risky and no covering mix reads better
  ranked: CompositionScore[]; // the final order; fightOdds are filled only where they were read
}

// Security heavy above this demand, survey heavy below its mirror, else even [PROPOSAL].
const DEMAND_LEAN = 0.05;
// A body with combat at or above this reads "Enemy territory" (riskFactors.ts RISK_FLAVOR combat High).
const ENEMY_TERRITORY_GRADE = 3;
// At most this many unfinished tasks are named in one line; the rest read "and N more".
const NAMED_UNFINISHED = 3;

function listUnfinished(list: readonly UnfinishedTask[]): string {
  const named = list.slice(0, NAMED_UNFINISHED).map((t) => t.text);
  const more = list.length - named.length;
  return more > 0 ? `${named.join("; ")}; and ${more} more` : named.join("; ");
}

// The system in one line, by its Security demand (the balance reason, and the reason when the current
// composition already suits it). Pure.
function demandLine(preview: SystemTaskPreview): string {
  const d = taskDemand(preview);
  const demand = securityDemand(preview);
  if (d.tasks === 0) return "No ground objectives expected.";
  if (demand > 0.5 + DEMAND_LEAN) {
    const enemy = preview.bodies.filter((b) => b.combat >= ENEMY_TERRITORY_GRADE).length;
    const head = enemy > 0 ? `Enemy territory on ${enemy} of ${plural(d.bodies, "body", "bodies")}` : `Security work on ${d.securityBodies} of ${plural(d.bodies, "body", "bodies")}`;
    const tail = d.twoSecurityTasks > 0 ? `; ${plural(d.twoSecurityTasks, "objective needs", "objectives need")} 2${d.maxSecurity > 2 ? " or more" : ""} Security squads` : "";
    return `${head}${tail}.`;
  }
  if (demand < 0.5 - DEMAND_LEAN) {
    const facts: string[] = [];
    if (d.noSecurityTasks > 0) facts.push(`${d.noSecurityTasks} of ${plural(d.tasks, "objective needs", "objectives need")} no Security squad`);
    if (d.twoScienceTasks > 0) facts.push(`${plural(d.twoScienceTasks, "objective needs", "objectives need")} 2 Science squads`);
    const head = d.noSecurityTasks * 2 > d.tasks ? "Mostly survey work" : "More survey work than Security work";
    return `${head}: ${facts.join("; ")}.`;
  }
  return `Security and survey work in even measure on ${plural(d.bodies, "body", "bodies")}.`;
}

// The reason the best composition beats the current one: the first criterion that tells them apart. Pure.
function reasonOver(preview: SystemTaskPreview, best: CompositionScore, current: CompositionScore): string {
  if (Math.abs(best.coverage - current.coverage) > EPS) {
    const n = Math.max(1, current.unfinished.length - best.unfinished.length);
    return `Covers ${plural(n, "objective", "objectives")} your ${current.label} would leave unfinished.`;
  }
  if (Math.abs(best.solo - current.solo) > EPS) {
    return `One team can take ${best.soloTasks} of ${plural(preview.tasks.length, "objective", "objectives")} alone (your ${current.label}: ${current.soloTasks}).`;
  }
  return demandLine(preview);
}

// The recommendation for a system (design 6.5), or null for a hull with no valid composition. `current` = the
// ship's team kinds (groundComposition.ts shipTeamKinds); `oddsOf` = the fight odds reader, called LAZILY: the
// winner's odds first, the other covering mixes' only when the winner reads risky (absent: no odds step). Pure
// (given a pure reader).
export function recommendLaunch(
  preview: SystemTaskPreview,
  typeKey: ShipTypeKey,
  current: readonly GroundTeamKind[],
  oddsOf?: FightOddsOf,
): LaunchRecommendation | null {
  let ranked = rankCompositions(preview, typeKey, current);
  if (ranked.length === 0) return null;
  let oddsDecided = false;
  let riskyFightsText: string | null = null;
  let oddsReason: string | null = null;
  // Follow-up 3 (user: "Tiers I and II stay simple"): the odds weigh in only beyond the safe tiers (riskFactors.ts
  // SAFE_NEEDS_MAX_TIER, the same boundary as tierNeeds, so the two never drift apart). At Tiers I and II the
  // reader is never called: the pure ranking stands and no launch is simulated.
  if (oddsOf && preview.tier > SAFE_NEEDS_MAX_TIER) {
    const withOdds = (r: CompositionScore): CompositionScore => scoreComposition(preview, r.kinds, current, oddsOf(r.kinds));
    const top = withOdds(ranked[0]);
    ranked = [top, ...ranked.slice(1)];
    if (top.oddsTier !== null && oddsAreRisky(top.oddsTier)) {
      let pick: CompositionScore | null = null;
      ranked = ranked.map((r, i) => {
        if (i === 0 || Math.abs(r.coverage - top.coverage) > EPS) return r;
        const scored = withOdds(r);
        if (scored.oddsTier !== null && bandRank(scored.oddsTier) < bandRank(top.oddsTier!)) {
          if (pick === null || bandRank(scored.oddsTier) < bandRank(pick.oddsTier!)) pick = scored;
        }
        return scored;
      });
      const chosen = pick as CompositionScore | null;
      if (chosen) {
        oddsDecided = true;
        ranked = [chosen, ...ranked.filter((r) => r !== chosen)];
        oddsReason = `Risky fights: ${top.changes === 0 ? "your " : ""}${top.label} reads ${top.oddsName}; ${chosen.label} reads ${chosen.oddsName}.`;
      } else {
        riskyFightsText = `The fights read risky (${top.oddsName}) and no mix on this hull reads better.`;
      }
    }
  }
  const best = ranked[0];
  const isCurrent = best.changes === 0;
  const same = ranked.find((r) => r.changes === 0);
  const now = same ?? scoreComposition(preview, current, current);
  const currentLabel = compositionLabel(current);
  const unfinished = now.unfinished;
  const still = best.unfinished;
  return {
    kinds: [...best.kinds],
    label: best.label,
    current: [...current],
    currentLabel,
    isCurrent,
    headline: isCurrent ? `Your ${currentLabel} suits this system.` : `Launch with ${best.label}`,
    reason: oddsReason ?? (isCurrent ? demandLine(preview) : reasonOver(preview, best, now)),
    unfinished,
    unfinishedText:
      unfinished.length === 0 ? null : `${currentLabel} would leave ${plural(unfinished.length, "objective", "objectives")} unfinished: ${listUnfinished(unfinished)}.`,
    stillUnfinished: still,
    stillUnfinishedText:
      still.length === 0
        ? null
        : `Nothing on this hull covers every objective: ${listUnfinished(still)}. ${still.length === 1 ? "It" : "They"} will be left unfinished.`,
    oddsDecided,
    riskyFightsText,
    ranked,
  };
}

// ===== The forecast (design 6.3 "Forecast"; built by expedition.ts launchForecast) =====

export interface ForecastHardestTask {
  bodyIndex: number;
  poiId: string;
  label: string;
  difficulty: number;
  difficultyName: string;
  fightPoints: number;
  crew: number[]; // the team indices the plan would send
}

export interface LaunchForecast {
  kinds: GroundTeamKind[]; // the composition forecast (the recommendation's when it can be set)
  label: string;
  teamsDeployed: number; // the teams that would deploy if the ship launched now
  tasks: number; // tasks the run would work
  byDifficulty: number[]; // of those, per grade, index 0 Simple .. 4 Deadly
  unfinished: number; // tasks it would leave unfinished (skipped, or a hostile site it cannot field)
  hardest: ForecastHardestTask | null; // the hardest task with a fight, or null when no task has one
  threat: ThreatAssessment | null; // the odds band of the crew the plan would send on it
  note: string | null; // why there is no threat read ("No ground team is ready to launch")
  // Gas Giant Study GG-2: the ship studies the run would make (one per orbital body; never a squad's work, never
  // unfinished). Written only when there is one.
  studies?: number;
  // GG-4: the nebula the ship would sweep after the bodies (never a squad's work). Written only when there is one.
  nebula?: NebulaKindId;
}

// "7 objectives: 3 Simple, 2 Standard, 2 Challenging" (zero grades left out). Pure.
export function forecastTasksText(f: Pick<LaunchForecast, "tasks" | "byDifficulty">): string {
  const parts = f.byDifficulty.map((n, i) => (n > 0 ? `${n} ${DIFFICULTY_NAMES[i]}` : null)).filter((s): s is string => s !== null);
  return parts.length > 0 ? `${plural(f.tasks, "objective", "objectives")}: ${parts.join(", ")}` : "No ground objectives expected";
}

// ===== The detail gate (design 6.3) =====

export interface LaunchView {
  demand: TaskDemand | null; // Per body (3) and up
  recommendation: LaunchRecommendation | null; // Recommendation (4) and up
  forecast: LaunchForecast | null; // Forecast (5)
}

// The telescope block of an expedition candidate (expedition.ts ExpeditionCandidate.telescope): the SQ-5 reading plus
// the task demand (Per body and up), gated by the reading's `detail`. The recommendation and the forecast are asked
// for separately (expedition.ts expeditionLaunchView), so the candidate list never simulates a launch.
export interface CandidateTelescopeReading extends SystemTelescopeReading {
  demand: TaskDemand | null;
}

export interface LaunchViewSources {
  preview: () => SystemTaskPreview;
  recommend: (preview: SystemTaskPreview) => LaunchRecommendation | null;
  forecast: (preview: SystemTaskPreview, recommendation: LaunchRecommendation | null) => LaunchForecast | null;
}

// What `detail` shows of the system's tasks. The sources are called ONLY at the levels that show them, so a
// lower level never computes (and so can never carry) a higher level's piece. Pure (given pure sources).
export function gateLaunchView(detail: number, src: LaunchViewSources): LaunchView {
  if (!(detail >= TELESCOPE_DETAIL.perBody)) return { demand: null, recommendation: null, forecast: null };
  const preview = src.preview();
  const recommendation = detail >= TELESCOPE_DETAIL.recommendation ? src.recommend(preview) : null;
  return {
    demand: taskDemand(preview),
    recommendation,
    forecast: detail >= TELESCOPE_DETAIL.forecast ? src.forecast(preview, recommendation) : null,
  };
}
