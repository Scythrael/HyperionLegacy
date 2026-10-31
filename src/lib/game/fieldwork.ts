// E-CREW "Crew Made Real" Task 15: FIELDWORK FROM SCIENCE MEMBERS (design D2, sections 5.4 and 5.5).
//
// Security fights; SCIENCE does the fieldwork. This module turns the expedition's frozen Science roster
// (Expedition.roster.science, snapshotted at dispatch by awayTeam.ts snapshotAwayRoster) into the three
// fieldwork levers the expedition engine reads:
//   - SPEED   (expedition.ts activityDurationSeconds): how long one ground task takes;
//   - YIELD   (gambit.ts resolveExpeditionActivity): the haul multiplier (materials + credits);
//   - RELIC   (gambit.ts activityRelicFindBonus): a lift on the relic chance;
// plus HAZARD (expedition.ts scanRatePerSecond): the party's hazard resistance, which cuts the scan's
// hazard slowdown on a hostile body (the Hazard Suit's "hazard slow cut").
//
// PURE + DETERMINISTIC: every function reads only the stored expedition (the roster snapshot and the
// snapshotted scienceStrength), never live state, and draws no random number, so offline == live holds
// by construction. Imports only model types/data, the content catalog and the pure diminishing.ts leaf
// (no engine module, no cycle).
//
// THE MODEL (FIRST-PASS TUNABLE, every coefficient below):
//   Per Science member m on a body of planet type P, at PoI X:
//     fw_m, relic_m, haz_m, org_m, vault_m = the sum of m's snapshot fieldwork SOURCES that apply on P
//       (the untuned source always; a planet-tuned tool's source only when P is in its planetTypes)
//     spec_m  = SPEC_POI_YIELD when m's spec favors X (SCIENCE_SPEC_POIS), else 0
//     trait_m = the summed value of m's poiYield effects that list X
//   Team (STACKING RULE: same-kind bumps ADD; D23: DIMINISHING RETURNS, never a cap, diminishing.ts):
//     crew       = diminishing(scienceStrength * SCIENCE_STRENGTH_FIELDWORK, CREW_FIELDWORK_KNEE)
//     F          = sum(fw_m) + crew                                            (crew = the crew layer)
//     speedMult  = 1 + diminishing(FIELDWORK_SPEED_PER_BUMP * F, FIELDWORK_SPEED_KNEE)   (fieldworkSpeedMult)
//     bonus      = FIELDWORK_YIELD_PER_BUMP * F + sum(spec_m) + sum(trait_m)
//                    + (X in ORGANICS_POIS ? sum(org_m) : 0) + (X in VAULT_POIS ? sum(vault_m) : 0)
//     yieldMult  = 1 + diminishing(bonus, FIELDWORK_YIELD_KNEE)
//     relicFind  = sum(relic_m)                       (multiplies the relic chance by 1 + bonus, with the
//                                                      museum + gear + crew rare find; gambit.ts)
//     hazardResist = sum(haz_m)                       (added to the museum + gear resist for the scan slow)
// A bare member (no gear, no traits, a spec that does not favor X) adds nothing, so today's haul and pace
// are the baseline a Science party improves on, never a penalty for bringing someone.
// NEUTRALITY: no Science member (an expedition launched before D18, or a dev run with an empty Science
// squad) is NEUTRAL_FIELDWORK: speed 1, yield 1, relic 0, hazard 0, so the run resolves exactly as before
// (scienceStrength is NOT read without a party: it had no effect before Task 15). The curve is exactly 0
// at 0, so a party with no bonus is still speed 1, yield 1.
//
// D23 DIMINISHING RETURNS (Task 15a, user 2026-10-08): "as you get more, they mean less and less", with no
// ceiling. Three curves (diminishing.ts, the sqrt form: nearly 1:1 far below its knee, about 73% of the value
// AT the knee, unbounded past it):
//   - the CREW LAYER passes CREW_FIELDWORK_KNEE before it joins F, so a big ship's Science division no
//     longer buries the party (it shapes the pace too, through F);
//   - the TOTAL yield bonus passes FIELDWORK_YIELD_KNEE, so stacking everything also diminishes;
//   - the PACE bonus passes FIELDWORK_SPEED_KNEE (user 2026-10-08, "curve please!"): the old 3x speed cap
//     is gone, so more fieldwork always quickens a task a little more.
// Relic odds and hazard resist are not curved here.
// WORKED TABLE (yield bonus, and the pace multiplier, on an arid body at a mineral outcrop). "Party" = two
// geologists (a spec match each), each wearing an iLevel 15 Standard Field Suit and Core Drill rolled from
// the real catalog (raw bonus +66%: +30% from the two spec matches, the rest from about 0.72 F of gear):
//     case                          before: yield / pace      after D23: yield / pace
//     crew 20 alone                       +10.0% / 1.10           +9.1% / 1.09
//     crew 100 alone                      +50.0% / 1.50          +34.9% / 1.34
//     crew 225 alone (tier-2 explorer)   +112.5% / 2.13          +61.4% / 1.61
//     crew 500 alone                     +250.0% / 3.00          +98.9% / 1.99
//     party alone                         +66.0% / 1.36          +57.7% / 1.33
//     party + crew 225                   +178.5% / 2.49         +107.7% / 1.88
//     two spec matches only               +30.0% / 1.00          +28.0% / 1.00
// So the tier-2 crew alone is comparable to (about 1.06x) a well-geared party instead of 1.7x it, the
// party keeps about 80% of its value on top of that crew, and a total of +30% or less keeps over 90%.
// (Gear F itself is not curved before it joins F; the pace and yield totals are.)
// In-flight runs resolve under the curve (a pure function of the stored Expedition; no save migration).

import type { Expedition, ExpeditionPlanetType, ScienceSpec, SnapshotMember } from "./model";
import type { ExpeditionPoiId } from "./expeditionContent";
import { diminishing } from "./diminishing";

// ===== The spec -> PoI mapping (one exhaustive partition of the PoI catalog) =====
//
// Each Science spec FAVORS a set of PoIs; a member whose spec favors the task's PoI raises that task's
// yield. Every PoI is favored by exactly one spec (a test asserts the partition). Chosen to match the spec
// tooltips (awayTeamDisplay.ts) and the Science trait catalog's groupings (awayTraits.ts):
//   archaeology : "ancient ruins, old wrecks and lost civilizations": ancientRuins, crashedShip,
//                 subterraneanCivilization (the Patient Hands trait groups the ruins and the wreck too)
//   xenobiology : "alien life and plant blooms": xenoFloraBloom
//   geology     : "rock, minerals and deep caves": mineralOutcrop, caveNetwork, geothermalChamber
//   cryptography: "old codes, locks and sealed vaults": buriedVault, derelictOutpost (its data and locked
//                 systems)
// EXHAUSTIVE over ScienceSpec (a Record), so a new Science spec is a compile error until it is mapped.
export const SCIENCE_SPEC_POIS: Readonly<Record<ScienceSpec, readonly ExpeditionPoiId[]>> = {
  archaeology: ["ancientRuins", "crashedShip", "subterraneanCivilization"],
  xenobiology: ["xenoFloraBloom"],
  geology: ["mineralOutcrop", "caveNetwork", "geothermalChamber"],
  cryptography: ["buriedVault", "derelictOutpost"],
};

// The two FIND FAMILIES the gear yield lines point at (model.ts MEMBER_GROUND_STAT_KEYS): organics (Flora
// Scanner, Bio-Analyzer) at the living bloom; vaults (Decryptor, Cipher Wetware) at "vaults and
// civilization sites".
export const ORGANICS_POIS: readonly ExpeditionPoiId[] = ["xenoFloraBloom"];
export const VAULT_POIS: readonly ExpeditionPoiId[] = ["buriedVault", "subterraneanCivilization"];

// ===== Coefficients (FIRST-PASS TUNABLE) =====

// A member whose spec favors the task's PoI adds this to the yield multiplier (+15%, in line with the
// Green Thumb trait). Two matching members stack.
export const SPEC_POI_YIELD = 0.15;
// The share of the team fieldwork bump F that becomes yield and speed. Half each: an iLevel 10 Field Suit
// (~10 fieldwork points, +10%) makes the party's tasks ~5% richer and ~5% quicker.
export const FIELDWORK_YIELD_PER_BUMP = 0.5;
export const FIELDWORK_SPEED_PER_BUMP = 0.5;
// The pace bonus's knee (D23, replacing the old 3x cap, user 2026-10-08): a +36% pace keeps about 92% of
// itself, a +100% about 83%, and there is no ceiling (expedition.ts floors a task at 1 second).
export const FIELDWORK_SPEED_KNEE = 2;
// The crew layer: each point of the snapshotted scienceStrength (Science division + science/medical
// officers, times the museum's scienceTeamPower) adds this to F BEFORE the crew curve. 20 strength = a raw
// +20% fieldwork (about +18.6% after the curve).
export const SCIENCE_STRENGTH_FIELDWORK = 0.01;
// D23: the crew layer's knee, in F units (1.2 = 120 Science strength). At 120 strength the crew layer keeps
// about 73% of its raw value; a small crew keeps nearly all of it; a huge one keeps growing. FIRST-PASS
// TUNABLE.
export const CREW_FIELDWORK_KNEE = 1.2;
// D23: the knee of the TOTAL yield bonus (yieldMult - 1), so +200%. A +30% total keeps about 93%; at +200%
// it keeps about 73%; past it the haul keeps growing. FIRST-PASS TUNABLE.
export const FIELDWORK_YIELD_KNEE = 2;

// ===== Readers =====

// One member's fieldwork on a body: the sum of its snapshot sources that apply on `planetType`. A snapshot
// from before Task 15 (no sources) reads its groundStats untuned, with no yield lines. Pure.
export interface MemberFieldwork {
  fieldwork: number;
  relicFind: number;
  hazardResist: number;
  organicsYield: number;
  vaultYield: number;
}
export function memberFieldworkOnBody(member: SnapshotMember, planetType: ExpeditionPlanetType): MemberFieldwork {
  const out: MemberFieldwork = { fieldwork: 0, relicFind: 0, hazardResist: 0, organicsYield: 0, vaultYield: 0 };
  if (!member.fieldwork) {
    out.fieldwork = member.groundStats.fieldwork ?? 0;
    out.relicFind = member.groundStats.relicFind ?? 0;
    out.hazardResist = member.groundStats.hazardResist ?? 0;
    return out;
  }
  for (const src of member.fieldwork) {
    if (src.planetTypes && !src.planetTypes.includes(planetType)) continue;
    out.fieldwork += src.fieldwork;
    out.relicFind += src.relicFind;
    out.hazardResist += src.hazardResist;
    out.organicsYield += src.organicsYield;
    out.vaultYield += src.vaultYield;
  }
  return out;
}

// What the Science party does for ONE task (or, for speed and hazard, one body).
export interface FieldworkEffect {
  speedMult: number; // divides the task's duration (>= 1)
  yieldMult: number; // multiplies the task's haul (>= 1)
  relicFind: number; // added to the relic find bonus (the chance multiplies by 1 + bonus)
  hazardResist: number; // added to the scan's hazard resist on this body
}

export const NEUTRAL_FIELDWORK: Readonly<FieldworkEffect> = { speedMult: 1, yieldMult: 1, relicFind: 0, hazardResist: 0 };

// Does this member's spec favor the PoI? A Security spec favors nothing. Pure.
export function specFavorsPoi(spec: string, poiId: string): boolean {
  const pois = (SCIENCE_SPEC_POIS as Readonly<Record<string, readonly string[]>>)[spec];
  return pois !== undefined && pois.includes(poiId);
}

// What the fieldwork readers need from the stored expedition.
type FieldworkRun = Pick<Expedition, "roster" | "scienceStrength" | "museumSciencePower">;

// Wiring WR-11 (OC-H1 "Members too"): the factor on each named Science member's own fieldwork (its fw_m in THE MODEL):
// 1 + the Museum's Science team power frozen at dispatch (Expedition.museumSciencePower), 1 without it. The crew layer
// already carries the same power through scienceStrength. Pure.
export function memberFieldworkScale(exp: Pick<Expedition, "museumSciencePower">): number {
  const p = exp.museumSciencePower;
  return p !== undefined && p > 0 && Number.isFinite(p) ? 1 + p : 1;
}

// The crew layer's contribution to F: the snapshotted scienceStrength through the D23 crew curve. Pure.
function crewFieldwork(exp: FieldworkRun): number {
  return diminishing(Math.max(0, exp.scienceStrength ?? 0) * SCIENCE_STRENGTH_FIELDWORK, CREW_FIELDWORK_KNEE);
}

// F to the pace multiplier, on the D23 pace curve (no cap). The ONE place the speed math lives.
function speedMultFromF(F: number): number {
  return 1 + diminishing(FIELDWORK_SPEED_PER_BUMP * F, FIELDWORK_SPEED_KNEE);
}

// The Science party's pace on a body of `planetType` (the PoI never changes it): exactly fieldworkEffect's
// speedMult at any PoI, without assembling the rest of the effect. 1 without a Science member. Pure.
export function fieldworkSpeedMult(exp: FieldworkRun, planetType: ExpeditionPlanetType): number {
  const party = exp.roster?.science ?? [];
  if (party.length === 0) return 1;
  return speedMultFromF(memberFieldworkTotal(exp, planetType) + crewFieldwork(exp));
}

// The named Science members' own fieldwork on a body of `planetType` (the sum of fw_m in THE MODEL), each x the Museum's
// Science team power frozen on the run (WR-11, OC-H1: memberFieldworkScale). 0 without a party. Pure (the pace reads it;
// fieldworkEffect sums the same terms in the same order; the wiring probe reads it).
export function memberFieldworkTotal(exp: FieldworkRun, planetType: ExpeditionPlanetType): number {
  const party = exp.roster?.science ?? [];
  const scale = memberFieldworkScale(exp);
  let F = 0;
  for (const m of party) F += scale === 1 ? memberFieldworkOnBody(m, planetType).fieldwork : memberFieldworkOnBody(m, planetType).fieldwork * scale;
  return F;
}

// The Science party's effect on one task: a body of `planetType`, PoI `poiId` (see THE MODEL above).
// Neutral without a Science member. Returns a fresh object. Pure.
export function fieldworkEffect(exp: FieldworkRun, planetType: ExpeditionPlanetType, poiId: string): FieldworkEffect {
  const party = exp.roster?.science ?? [];
  if (party.length === 0) return { ...NEUTRAL_FIELDWORK };
  let F = 0;
  let relicFind = 0;
  let hazardResist = 0;
  let poiBonus = 0;
  const organics = (ORGANICS_POIS as readonly string[]).includes(poiId);
  const vault = (VAULT_POIS as readonly string[]).includes(poiId);
  const scale = memberFieldworkScale(exp);
  for (const m of party) {
    const fw = memberFieldworkOnBody(m, planetType);
    F += scale === 1 ? fw.fieldwork : fw.fieldwork * scale;
    relicFind += fw.relicFind;
    hazardResist += fw.hazardResist;
    if (organics) poiBonus += fw.organicsYield;
    if (vault) poiBonus += fw.vaultYield;
    if (specFavorsPoi(m.spec, poiId)) poiBonus += SPEC_POI_YIELD;
    for (const e of m.effects) if (e.kind === "poiYield" && e.pois.includes(poiId)) poiBonus += e.value;
  }
  // The same additions, in the same order, as fieldworkSpeedMult, so the two speeds agree bit for bit.
  F += crewFieldwork(exp);
  return {
    speedMult: speedMultFromF(F),
    // D23: the whole bonus diminishes (0 or less stays 0, so the multiplier is never below 1).
    yieldMult: 1 + diminishing(FIELDWORK_YIELD_PER_BUMP * F + poiBonus, FIELDWORK_YIELD_KNEE),
    relicFind: Math.max(0, relicFind),
    hazardResist: Math.max(0, hazardResist),
  };
}

// The party's hazard resist on a body of `planetType` (the PoI does not matter for it). 0 without a party.
// Pure.
export function fieldworkHazardResist(exp: FieldworkRun, planetType: ExpeditionPlanetType): number {
  const party = exp.roster?.science ?? [];
  if (party.length === 0) return 0;
  let total = 0;
  for (const m of party) total += memberFieldworkOnBody(m, planetType).hazardResist;
  return Math.max(0, total);
}
