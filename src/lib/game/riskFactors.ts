// Squads SQ-4 (docs/plans/2026-10-12-squads-and-subspace-telescope-design.md sections 4 and 5): RISK FACTORS,
// task NEEDS from risk, the DIFFICULTY rating and the RISK REWARD. Pure building blocks; nothing here advances a
// run. Reusable later for combat campaigns (user: "This system could also be reused for things like combat
// campaigns later on").
//
//   THE FACTORS (user-approved names and scale, #11): Combat risk, Fauna, Flora, Hazard, each None / Low /
//   Moderate / High / Extreme (0 to 4). Combat, Fauna and Flora are DRAWN per system from the region tier's
//   odds table (user-approved per-tier odds, #11), known enemy territory adds one step of combat ("If it's in a
//   known enemy territory, the combat risk is high", user), then per body a keyed jitter of -1 / 0 (30 / 70).
//   Fauna and Flora read None on worlds that cannot hold life (Flora also on Frozen). Hazard is the body's
//   existing hazard scalar, banded.
//   HOSTILE SITES (names approved for now, #12): an Enemy Colony from Tier III on a High (15%) or Extreme (30%)
//   combat body, an Enemy Fortification from Tier VI on an Extreme combat body (10%). The roll places a site on
//   the body; the site becomes a task only when the ship's DEPLOYED squads can field its needs and still keep a
//   Science squad (user #3: no softlock; hostileSiteFieldable).
//
// DETERMINISM: ONE salt, RISK_SALT, on the candidate's own seed. The system stream is makeRng(seed ^ RISK_SALT);
// body i's stream is keyed by its index. Every draw is made in a fixed order whether or not it is used, so the
// profile is a pure function of (seed, region, planet types). Because a candidate's seed IS the committed run's
// seed (E2c), the pre-launch reading and the run are the same draw: the forecast cannot lie.
//
// Module graph: model (types), combat/rng, diminishing. Imported by groundTasks.ts, groundFight.ts, groundOps.ts
// and expedition.ts; it imports none of them.

import type {
  BodyRiskGrades,
  ClearingSiteId,
  ExpeditionPlanetType,
  ExpeditionRiskProfile,
  GroundTaskNeeds,
  HostileSiteId,
  RegionTier,
  RiskGrade,
  SystemRiskGrades,
} from "./model";
import { makeRng, type Rng } from "./combat/rng";
import { diminishing } from "./diminishing";

export type { BodyRiskGrades, ClearingSiteId, ExpeditionRiskProfile, HostileSiteId, RegionTier, RiskGrade, SystemRiskGrades };

// ===== The scale and the factors (user #11) =====

export const RISK_GRADE_NAMES: readonly string[] = ["None", "Low", "Moderate", "High", "Extreme"];
export type RiskFactorId = "combat" | "fauna" | "flora" | "hazard";
export const RISK_FACTOR_NAMES: Readonly<Record<RiskFactorId, string>> = {
  combat: "Combat risk",
  fauna: "Fauna",
  flora: "Flora",
  hazard: "Hazard",
};
// The flavor line of each step Low..Extreme (design 5.1); None and Hazard carry no line.
const RISK_FLAVOR: Readonly<Record<"combat" | "fauna" | "flora", readonly string[]>> = {
  combat: ["Patrol traffic", "Hostile activity", "Enemy territory", "Enemy stronghold"],
  fauna: ["Benign life signs", "Territorial fauna", "Predators detected", "Apex predators"],
  flora: ["Sparse growth", "Dense growth", "Aggressive flora", "Toxic biosphere"],
};

// A grade's flavor line, or null (None, or the Hazard factor). Pure.
export function riskFlavor(factor: RiskFactorId, grade: RiskGrade): string | null {
  if (factor === "hazard" || grade === 0) return null;
  return RISK_FLAVOR[factor][grade - 1] ?? null;
}

// Clamp any number to a grade (whole, 0..4). Pure.
export function toRiskGrade(n: number): RiskGrade {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(4, Math.round(n))) as RiskGrade;
}

// ===== The region (Expedition Tiers G2-2: the candidate's own) =====

export interface ExpeditionRegion {
  tier: RegionTier;
  enemyTerritory: boolean;
}

// The region a candidate system lies in is the CANDIDATE'S (expedition.ts tierCandidateSystems, G2-2): the tier the
// console offered it in, and enemy territory when its bearing from the homeworld lies in that tier's fixed sector
// (galaxy.ts inEnemySector, user G8 "Fixed sectors on the map"). The pure previews take it as a parameter; this is
// their default, Tier I outside enemy territory (Tier I has no sector, so every Tier I candidate reads it).
export const TIER_I_REGION: Readonly<ExpeditionRegion> = { tier: 1, enemyTerritory: false };

// ===== The tier reward (user G16, 2026-10-16: "Haul x1 to x3.3 now (Recommended)") =====

// A run's haul (every objective's materials and credits) by its region tier; relic odds stay with Relics v2. Applied
// on the objective's own reward draws (groundTasks.ts taskFullHaul) for a run carrying its G2-2 region stamp
// (Expedition.region), so a Tier I run (x1) and every run dispatched before G2-2 roll exactly as before.
export const TIER_HAUL_MULT: Readonly<Record<RegionTier, number>> = { 1: 1, 2: 1.25, 3: 1.5, 4: 1.8, 5: 2.2, 6: 2.7, 7: 3.3 };

// The haul multiplier of a run's region (1 without one, or at an unknown tier). Pure.
export function tierHaulMult(region: { tier: RegionTier } | undefined): number {
  const m = region ? TIER_HAUL_MULT[region.tier] : undefined;
  return typeof m === "number" && Number.isFinite(m) && m > 0 ? m : 1;
}

// ===== The tier odds tables (user-approved, #11): weights None / Low / Moderate / High / Extreme, sum 100 =====

export interface RiskTierOdds {
  combat: readonly number[];
  life: readonly number[]; // Fauna and Flora share one table, drawn independently
}
export const RISK_TIER_ODDS: Readonly<Record<RegionTier, RiskTierOdds>> = {
  1: { combat: [60, 35, 5, 0, 0], life: [30, 50, 18, 2, 0] },
  2: { combat: [35, 40, 20, 5, 0], life: [20, 40, 30, 10, 0] },
  3: { combat: [15, 30, 35, 15, 5], life: [15, 30, 35, 15, 5] },
  4: { combat: [10, 25, 35, 22, 8], life: [10, 30, 35, 20, 5] },
  5: { combat: [5, 15, 30, 35, 15], life: [5, 20, 35, 30, 10] },
  6: { combat: [0, 10, 25, 40, 25], life: [5, 15, 30, 35, 15] },
  7: { combat: [0, 5, 15, 40, 40], life: [5, 10, 25, 35, 25] },
};
// Known enemy territory adds this many steps of combat (capped at Extreme).
export const ENEMY_TERRITORY_COMBAT_STEP = 1;
// The per-body jitter: each grade drops one step with this chance (out of 100) [PROPOSAL, design 5.2: 30 / 70].
export const BODY_JITTER_DOWN_PERCENT = 30;
// Worlds that cannot hold life: Fauna and Flora read None there; Flora also reads None on these (design 5.2).
export const LIFELESS_PLANET_TYPES: readonly ExpeditionPlanetType[] = ["barren", "volcanic", "gasGiant"];
export const FLORALESS_PLANET_TYPES: readonly ExpeditionPlanetType[] = ["frozen"];
// The Hazard bands (design 5.1): None below 0.15, Low below 0.3, Moderate below 0.5, High below 0.7, else Extreme.
export const RISK_HAZARD_BANDS: readonly number[] = [0.15, 0.3, 0.5, 0.7];

// The banded Hazard grade of a raw body hazard (NaN reads None). Pure.
export function hazardGrade(hazard: number): RiskGrade {
  if (!(hazard >= 0)) return 0;
  let g = 0;
  for (const edge of RISK_HAZARD_BANDS) if (hazard >= edge) g += 1;
  return g as RiskGrade;
}

// ===== Hostile sites (design 5.3; names approved for now, #12) =====

export interface HostileSiteRule {
  minTier: RegionTier;
  permilleByCombat: readonly number[]; // the body's chance (per 1000) by its combat grade None..Extreme
  fightPoints: number; // fixed: a hostile site is the fight itself
  needs: GroundTaskNeeds;
}
// Rolled fortification first, then colony; at most one site per body [PROPOSAL].
export const HOSTILE_SITE_RULES: Readonly<Record<HostileSiteId, HostileSiteRule>> = {
  enemyFortification: { minTier: 6, permilleByCombat: [0, 0, 0, 0, 100], fightPoints: 5, needs: { security: 4, science: 0 } },
  enemyColony: { minTier: 3, permilleByCombat: [0, 0, 0, 150, 300], fightPoints: 4, needs: { security: 2, science: 1 } },
};
const HOSTILE_ROLL_ORDER: readonly HostileSiteId[] = ["enemyFortification", "enemyColony"];

export function isHostileSiteId(id: string): id is HostileSiteId {
  return Object.prototype.hasOwnProperty.call(HOSTILE_SITE_RULES, id);
}

// Can the deployed squads field this site AND still keep a Science squad aboard (user #3: "without a science
// squad, you'd be unable to continue ... You could softlock it")? So the whole deployment covers the site's
// needs and holds at least one Science squad. Pure.
export function hostileSiteFieldable(site: HostileSiteId, deployed: GroundTaskNeeds): boolean {
  const needs = HOSTILE_SITE_RULES[site].needs;
  return deployed.security >= needs.security && deployed.science >= Math.max(1, needs.science);
}

// ===== Clearing tasks (Squads SQ-6 follow-up; user, 2026-10-13: Strike's role, "BOTH") =====

// Security-only work at a dangerous body: "Clear the Hostiles" where the COMBAT risk runs Moderate or worse,
// "Secure the Landing Zone" where the FAUNA does [PROPOSAL names]. Needs: Security only (no Science squad), so a
// Strike team takes one alone and a Survey team never can. Fight points: `baseFightPoints` + the body's combat
// mod (+ its fauna mod for the landing zone) + the hazard step, at least 1 (groundTasks.ts riskFightPointCount),
// so the needs read 1 Security squad up to 3 fights and 2 from 4 (generatedTaskNeeds; Tiers I and II cap it at 1,
// riskFactors.ts tierNeeds). The roll: one draw per kind on the body's risk stream, at the chance (per 1000) of
// its driver grade None..Extreme [PROVISIONAL numbers], so the practice tiers (combat mostly None / Low) rarely
// hold one and the dangerous tiers often do.
export interface ClearingSiteRule {
  driver: "combat" | "fauna";
  permilleByGrade: readonly number[];
  baseFightPoints: number;
}
export const CLEARING_SITE_RULES: Readonly<Record<ClearingSiteId, ClearingSiteRule>> = {
  clearHostiles: { driver: "combat", permilleByGrade: [0, 0, 300, 600, 900], baseFightPoints: 3 },
  secureLandingZone: { driver: "fauna", permilleByGrade: [0, 0, 200, 400, 700], baseFightPoints: 3 },
};
const CLEARING_ROLL_ORDER: readonly ClearingSiteId[] = ["clearHostiles", "secureLandingZone"];
// A clearing task always holds at least this many fight points (it IS the fight).
export const CLEARING_FIGHT_POINTS_MIN = 1;

export function isClearingSiteId(id: string): id is ClearingSiteId {
  return Object.prototype.hasOwnProperty.call(CLEARING_SITE_RULES, id);
}

// ===== Generation (RISK_SALT) =====

// The risk roll's stream salt: odd, distinct from every engine salt (salts.test.ts checks it).
export const RISK_SALT = 0x58f3a1c7;

// The system stream and body i's stream. Pure.
export function riskSystemSeed(seed: number): number {
  return (seed ^ RISK_SALT) >>> 0;
}
export function riskBodySeed(seed: number, bodyIndex: number): number {
  return (seed ^ RISK_SALT ^ Math.imul(bodyIndex + 1, 0x9e3779b9)) >>> 0;
}

// One weighted grade from a table (one integer draw over the weights' total). Pure (advances the rng).
function drawGrade(rng: Rng, weights: readonly number[]): RiskGrade {
  let total = 0;
  for (const w of weights) total += w;
  let roll = rng.nextInt(Math.max(1, total));
  for (let g = 0; g < weights.length; g += 1) {
    roll -= weights[g];
    if (roll < 0) return g as RiskGrade;
  }
  return (weights.length - 1) as RiskGrade;
}

// The system's grades for a region (three draws, combat then fauna then flora; enemy territory adds combat). Pure.
export function systemRiskGrades(seed: number, region: ExpeditionRegion): SystemRiskGrades {
  const odds = RISK_TIER_ODDS[region.tier] ?? RISK_TIER_ODDS[1];
  const rng = makeRng(riskSystemSeed(seed));
  const combat = drawGrade(rng, odds.combat);
  const fauna = drawGrade(rng, odds.life);
  const flora = drawGrade(rng, odds.life);
  return {
    combat: region.enemyTerritory ? toRiskGrade(combat + ENEMY_TERRITORY_COMBAT_STEP) : combat,
    fauna,
    flora,
  };
}

// One body's grades (see the header). Draws, always all seven in this order: the combat, fauna and flora jitters,
// the fortification and colony rolls, then (Squads SQ-6 follow-up, appended so the first five are untouched) the
// Clear the Hostiles and Secure the Landing Zone rolls. Pure.
export function bodyRiskGrades(
  seed: number,
  region: ExpeditionRegion,
  system: SystemRiskGrades,
  bodyIndex: number,
  body: { planetType: ExpeditionPlanetType; hazard: number },
): BodyRiskGrades {
  const rng = makeRng(riskBodySeed(seed, bodyIndex));
  const jitter = (g: RiskGrade): RiskGrade => (rng.chance(BODY_JITTER_DOWN_PERCENT, 100) ? toRiskGrade(g - 1) : g);
  const combat = jitter(system.combat);
  const fauna = jitter(system.fauna);
  const flora = jitter(system.flora);
  const lifeless = LIFELESS_PLANET_TYPES.includes(body.planetType);
  const out: BodyRiskGrades = {
    combat,
    fauna: lifeless ? 0 : fauna,
    flora: lifeless || FLORALESS_PLANET_TYPES.includes(body.planetType) ? 0 : flora,
    hazard: hazardGrade(body.hazard),
  };
  for (const site of HOSTILE_ROLL_ORDER) {
    const rule = HOSTILE_SITE_RULES[site];
    const hit = rng.chance(rule.permilleByCombat[combat] ?? 0, 1000);
    if (hit && out.site === undefined && region.tier >= rule.minTier) out.site = site;
  }
  const clearing: ClearingSiteId[] = [];
  for (const id of CLEARING_ROLL_ORDER) {
    const rule = CLEARING_SITE_RULES[id];
    if (rng.chance(rule.permilleByGrade[out[rule.driver]] ?? 0, 1000)) clearing.push(id);
  }
  if (clearing.length > 0) out.clearing = clearing;
  return out;
}

// ===== The difficulty tier (objective affixes, AF-1) =====

// The run's DIFFICULTY TIER (user 2026-10-14: "don't forget that we will have additional difficulty tiers on top of
// this in the future ... build anything that might be needed in the future to implement a difficulty system for
// this, but we're not focusing on higher difficulty tiers"). Every run is at the BASE tier today; affixes.ts keys its
// pools by (region tier, difficulty, difficulty tier), so a future tier is new pool data, not new plumbing. The
// profile's `difficultyTier` is also the AFFIX FLAG: a profile without it (every run dispatched before AF-1) stamps
// no affix.
export const BASE_DIFFICULTY_TIER = 1;

// The AFFIX CATALOG version (AF-2): which affixes a run's objectives may stamp. 1 = AF-1's catalog (Reinforcing
// only); 2 = AF-2's (adds Rocky Outcroppings). Every affix carries the version that introduced it (affixes.ts
// AffixDef.catalog) and a run stamps only from its own version, on that version's draw layout, so adding an affix
// never shifts a draw of a run dispatched before it. Bump it with every catalog addition.
export const AFFIX_CATALOG_VERSION = 2;
// The catalog an affix-aware run dispatched before AF-2 reads (its profile carries no version).
export const AF1_AFFIX_CATALOG = 1;

// The affix catalog version a risk profile stamps from: its stored version, else AF-1's. Pure.
export function runAffixCatalog(profile: Pick<ExpeditionRiskProfile, "affixCatalog"> | undefined): number {
  const v = profile?.affixCatalog;
  return typeof v === "number" && Number.isInteger(v) && v >= AF1_AFFIX_CATALOG ? v : AF1_AFFIX_CATALOG;
}

// The difficulty tier a risk profile carries, or null (a run dispatched before AF-1: no affixes). Pure.
export function runDifficultyTier(profile: Pick<ExpeditionRiskProfile, "difficultyTier"> | undefined): number | null {
  const d = profile?.difficultyTier;
  return typeof d === "number" && Number.isInteger(d) && d >= BASE_DIFFICULTY_TIER ? d : null;
}

// A whole system's risk: the run's profile (at the BASE difficulty tier: the affix flag, AF-1; on the current affix
// catalog, AF-2) and every body's grades, body order. Pure.
export function generateRiskProfile(
  seed: number,
  region: ExpeditionRegion,
  bodies: readonly { planetType: ExpeditionPlanetType; hazard: number }[],
): { profile: ExpeditionRiskProfile; bodies: BodyRiskGrades[] } {
  const system = systemRiskGrades(seed, region);
  return {
    profile: { version: 1, tier: region.tier, enemyTerritory: region.enemyTerritory, system, difficultyTier: BASE_DIFFICULTY_TIER, affixCatalog: AFFIX_CATALOG_VERSION },
    bodies: bodies.map((b, i) => bodyRiskGrades(seed, region, system, i, b)),
  };
}

// ===== How risk shapes a task (design 5.3) =====

// Fight point modifiers [PROPOSAL, design 5.3]: by the body's combat grade None..Extreme, and at LIFE sites by its
// fauna grade. The risk-aware count is clamped to [RISK_FIGHT_POINTS_MIN, FIGHT_POINTS_MAX]: the floor drops to 0
// so a calm site is pure survey work (groundTasks.ts riskFightPointCount).
export const COMBAT_FIGHT_MOD: readonly number[] = [-2, -1, 0, 1, 2];
export const FAUNA_FIGHT_MOD: readonly number[] = [-1, 0, 1, 1, 2];
export const RISK_FIGHT_POINTS_MIN = 0;
export const LIFE_SITES: readonly string[] = ["caveNetwork", "xenoFloraBloom", "subterraneanCivilization"];

// Needs from risk [PROPOSAL, design 3.2]: Security 0 with no fight points, 1 for 1 to 3, 2 for 4 or 5; Science 1
// at every fieldwork site, 2 at the big archaeology sites from Tier II ("going survey squad heavy makes sense",
// user). A hostile site's needs are its own (HOSTILE_SITE_RULES).
export const SECURITY_TWO_SQUADS_AT = 4;
export const SCIENCE_HEAVY_SITES: readonly string[] = ["ancientRuins", "buriedVault", "subterraneanCivilization"];
export const SCIENCE_HEAVY_MIN_TIER: RegionTier = 2;

// A risk-aware task's generated needs. Pure; a fresh object.
// A clearing task (CLEARING_SITE_RULES) needs Security only, at least one squad. Pure; a fresh object.
export function generatedTaskNeeds(poiId: string, fightPoints: number, tier: number): GroundTaskNeeds {
  if (isHostileSiteId(poiId)) return { ...HOSTILE_SITE_RULES[poiId].needs };
  if (isClearingSiteId(poiId)) return { security: fightPoints >= SECURITY_TWO_SQUADS_AT ? 2 : 1, science: 0 };
  const security = fightPoints <= 0 ? 0 : fightPoints >= SECURITY_TWO_SQUADS_AT ? 2 : 1;
  const science = SCIENCE_HEAVY_SITES.includes(poiId) && tier >= SCIENCE_HEAVY_MIN_TIER ? 2 : 1;
  return { security, science };
}

// SAFE TIERS ADAPT, LATER SKIP (user, 2026-10-13; replaces SQ-4's always-adapt cap): up to this tier a generated
// task never asks for more than ONE squad of each type (the "practice somewhere safer" zone), so nothing there is
// ever skipped (D18 guarantees a Security and a Science squad among the deployed teams). From the next tier on the
// generated needs stand as rolled, and a task the deployed squads cannot cover is SKIPPED at planning with the
// "Skipped ..." log line (left unfinished on the planet; the run goes on: no softlock), which is what makes the
// telescope's launch recommendation matter.
export const SAFE_NEEDS_MAX_TIER: RegionTier = 2;
export const SAFE_NEEDS_SQUADS_PER_TYPE = 1;

// The needs a risk-aware task is STAMPED with at `tier` (see above). Pure; a fresh object.
export function tierNeeds(raw: GroundTaskNeeds, tier: number): GroundTaskNeeds {
  if (tier > SAFE_NEEDS_MAX_TIER) return { security: raw.security, science: raw.science };
  return {
    security: Math.min(raw.security, SAFE_NEEDS_SQUADS_PER_TYPE),
    science: Math.min(raw.science, SAFE_NEEDS_SQUADS_PER_TYPE),
  };
}

// ===== Difficulty (design section 4) =====

// The five grades and their completion weights [PROPOSAL names and weights]: Simple 1, Standard 2, Challenging 3,
// Dangerous 5, Deadly 8 (a Deadly site moves the completion eight times as much as a Simple one).
export const DIFFICULTY_NAMES: readonly string[] = ["Simple", "Standard", "Challenging", "Dangerous", "Deadly"];
export const DIFFICULTY_WEIGHTS: readonly number[] = [1, 2, 3, 5, 8];
// The score edges: 0-1 Simple, 2-3 Standard, 4-5 Challenging, 6-7 Dangerous, 8+ Deadly.
export const DIFFICULTY_SCORE_EDGES: readonly number[] = [2, 4, 6, 8];

// The difficulty SCORE of a task (design section 4):
//   fightPoints + hazardBand (raw hazard: < 0.3 -> 0, < 0.6 -> 1, else 2)
//   + every squad beyond the first (needs.security + needs.science - 1, at least 0)
//   + floor(body combat grade / 2)
// `needs` are the site's GENERATED needs (what is involved), not the ship's capped stamp. Pure.
export function taskDifficultyScore(input: { fightPoints: number; hazard: number; needs: GroundTaskNeeds; combat: RiskGrade }): number {
  const hazardBand = !(input.hazard >= 0.3) ? 0 : input.hazard < 0.6 ? 1 : 2;
  const squads = Math.max(0, input.needs.security + input.needs.science - 1);
  return Math.max(0, input.fightPoints) + hazardBand + squads + Math.floor(input.combat / 2);
}

// The grade (1 Simple .. 5 Deadly) of a score. Pure.
export function difficultyGradeOf(score: number): number {
  let g = 1;
  for (const edge of DIFFICULTY_SCORE_EDGES) if (score >= edge) g += 1;
  return g;
}

// A stored grade as a whole 1..5, or null (absent or corrupt: an unrated task). Pure.
export function storedDifficulty(d: number | undefined): number | null {
  return typeof d === "number" && Number.isInteger(d) && d >= 1 && d <= DIFFICULTY_WEIGHTS.length ? d : null;
}

// A task's completion weight: its grade's weight, 1 for an unrated task (every run before SQ-4 weights evenly).
// Pure.
export function difficultyWeight(d: number | undefined): number {
  const g = storedDifficulty(d);
  return g === null ? 1 : DIFFICULTY_WEIGHTS[g - 1];
}

// "Challenging" for a grade, or null. Pure.
export function difficultyName(d: number | undefined): string | null {
  const g = storedDifficulty(d);
  return g === null ? null : DIFFICULTY_NAMES[g - 1];
}

// ===== The risk reward (user #6: "The greater the risk, the greater the reward") =====

// The bonus a task's difficulty adds to its haul (a multiplier on the haul, 1 + this) and to its relic find
// (added to the find bonus): RISK_REWARD_PER_WEIGHT per completion weight above Simple's, passed through the D23
// diminishing curve so it keeps growing with risk yet means less and less (never a cap). [PROVISIONAL numbers]:
// Simple +0%, Standard ~+9%, Challenging ~+17%, Dangerous ~+31%, Deadly ~+47%. 0 for an unrated task. Pure.
export const RISK_REWARD_PER_WEIGHT = 0.1;
export const RISK_REWARD_KNEE = 0.5;
export function riskRewardBonus(d: number | undefined): number {
  const g = storedDifficulty(d);
  if (g === null) return 0;
  return diminishing(RISK_REWARD_PER_WEIGHT * (DIFFICULTY_WEIGHTS[g - 1] - 1), RISK_REWARD_KNEE);
}

// ===== The unknown-risk ambush (user #5; SQ-3's hook) =====

// The chance an ambush strikes one attempt at a calm site (no fight points expected), by the body's worse of its
// combat and fauna grades None..Extreme [PROVISIONAL]. Capped per task by groundOps.ts SURVEY_AMBUSH_MAX_PER_TASK.
export const AMBUSH_CHANCE_BY_GRADE: readonly number[] = [0, 0.05, 0.1, 0.15, 0.2];
export function riskAmbushChance(risk: Pick<BodyRiskGrades, "combat" | "fauna">): number {
  return AMBUSH_CHANCE_BY_GRADE[toRiskGrade(Math.max(risk.combat, risk.fauna))] ?? 0;
}

// ===== Flora (design 5.3) =====

// Dense growth slows the dig: task work takes (1 + this x flora grade) as long [PROPOSAL 5%].
export const FLORA_WORK_SLOW_PER_GRADE = 0.05;
// Flora raises the Poison chance in that body's fights: per grade, this many permille on every guard's attack
// (added to a poisoning guard's own chance; a guard with no on-hit affliction gains a Poison one) [PROVISIONAL].
export const FLORA_POISON_PERMILLE_PER_GRADE = 50;
// A High or Extreme flora body draws Xeno-Flora Bloom sites more often: its pool weight times this, by grade
// [PROVISIONAL].
export const FLORA_BLOOM_WEIGHT_MULT: readonly number[] = [1, 1, 1, 2, 3];

// The flora grade a body presents (absent risk = 0, every run before SQ-4). Pure.
export function bodyFloraGrade(body: { risk?: Pick<BodyRiskGrades, "flora"> }): RiskGrade {
  return body.risk ? toRiskGrade(body.risk.flora) : 0;
}

// The flora slowdown multiplier on a body's task work (exactly 1 without flora). Pure.
export function floraWorkMult(body: { risk?: Pick<BodyRiskGrades, "flora"> }): number {
  const g = bodyFloraGrade(body);
  return g > 0 ? 1 + FLORA_WORK_SLOW_PER_GRADE * g : 1;
}

// ===== TASK CHAINS (user #14): HOOK ONLY, not built =====
// "That task could lead to a new task that could need a science team to explore a cache of rare relics stored by
// the enemies you just took out ... clearing out some fortifications and then unlocking new things that are
// hidden behind that." Completing a task may REVEAL a follow-up task. Not specified for SQ-4: this hook returns
// no follow-up today and nothing calls it. Its call site is groundOps.ts finishWork, where a task reaches 100%
// (marked there): the content pass adds the revealed task to the same body and plans it.
export function taskChainFollowUp(_completedPoiId: string): string | null {
  return null;
}
