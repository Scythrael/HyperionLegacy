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
// by construction. Imports only model types/data and the content catalog (no engine module, no cycle).
//
// THE MODEL (FIRST-PASS TUNABLE, every coefficient below):
//   Per Science member m on a body of planet type P, at PoI X:
//     fw_m, relic_m, haz_m, org_m, vault_m = the sum of m's snapshot fieldwork SOURCES that apply on P
//       (the untuned source always; a planet-tuned tool's source only when P is in its planetTypes)
//     spec_m  = SPEC_POI_YIELD when m's spec favors X (SCIENCE_SPEC_POIS), else 0
//     trait_m = the summed value of m's poiYield effects that list X
//   Team (STACKING RULE: same-kind bumps ADD):
//     F          = sum(fw_m) + scienceStrength * SCIENCE_STRENGTH_FIELDWORK   (the crew layer)
//     speedMult  = min(FIELDWORK_SPEED_MAX_MULT, 1 + FIELDWORK_SPEED_PER_BUMP * F)
//     yieldMult  = 1 + FIELDWORK_YIELD_PER_BUMP * F + sum(spec_m) + sum(trait_m)
//                    + (X in ORGANICS_POIS ? sum(org_m) : 0) + (X in VAULT_POIS ? sum(vault_m) : 0)
//     relicFind  = sum(relic_m)                       (multiplies the relic chance by 1 + bonus, with the
//                                                      museum + gear + crew rare find; gambit.ts)
//     hazardResist = sum(haz_m)                       (added to the museum + gear resist for the scan slow)
// A bare member (no gear, no traits, a spec that does not favor X) adds nothing, so today's haul and pace
// are the baseline a Science party improves on, never a penalty for bringing someone.
// NEUTRALITY: no Science member (an expedition launched before D18, or a dev run with an empty Science
// squad) is NEUTRAL_FIELDWORK: speed 1, yield 1, relic 0, hazard 0, so the run resolves exactly as before
// (scienceStrength is NOT read without a party: it had no effect before Task 15).

import type { Expedition, ScienceSpec, SnapshotMember } from "./model";
import type { ExpeditionPoiId } from "./expeditionContent";

// ===== The spec -> PoI mapping (one exhaustive partition of the PoI catalog) =====
//
// Each Science spec FAVORS a set of PoIs; a member whose spec favors the task's PoI raises that task's
// yield. Every PoI is favored by exactly one spec (a test asserts the partition). Chosen to match the spec
// tooltips (awayTeamDisplay.ts) and the Science trait catalog's groupings (awayTraits.ts):
//   archaeology : "ancient ruins and lost civilizations" plus the crashed ship (old sites, the Patient
//                 Hands grouping): ancientRuins, crashedShip, subterraneanCivilization
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
// The fastest a party can work (a task never drops below ACTIVITY_SECONDS / this).
export const FIELDWORK_SPEED_MAX_MULT = 3;
// The crew layer: each point of the snapshotted scienceStrength (Science division + science/medical
// officers, times the museum's scienceTeamPower) adds this to F. 20 strength = +20% fieldwork.
export const SCIENCE_STRENGTH_FIELDWORK = 0.01;

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
export function memberFieldworkOnBody(member: SnapshotMember, planetType: string): MemberFieldwork {
  const out: MemberFieldwork = { fieldwork: 0, relicFind: 0, hazardResist: 0, organicsYield: 0, vaultYield: 0 };
  if (!member.fieldwork) {
    out.fieldwork = member.groundStats.fieldwork ?? 0;
    out.relicFind = member.groundStats.relicFind ?? 0;
    out.hazardResist = member.groundStats.hazardResist ?? 0;
    return out;
  }
  for (const src of member.fieldwork) {
    if (src.planetTypes && !src.planetTypes.includes(planetType as never)) continue;
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

// The Science party's effect on one task: a body of `planetType`, PoI `poiId` (see THE MODEL above).
// Neutral without a Science member. Returns a fresh object. Pure.
export function fieldworkEffect(
  exp: Pick<Expedition, "roster" | "scienceStrength">,
  planetType: string,
  poiId: string
): FieldworkEffect {
  const party = exp.roster?.science ?? [];
  if (party.length === 0) return { ...NEUTRAL_FIELDWORK };
  let F = 0;
  let relicFind = 0;
  let hazardResist = 0;
  let poiBonus = 0;
  const organics = (ORGANICS_POIS as readonly string[]).includes(poiId);
  const vault = (VAULT_POIS as readonly string[]).includes(poiId);
  for (const m of party) {
    const fw = memberFieldworkOnBody(m, planetType);
    F += fw.fieldwork;
    relicFind += fw.relicFind;
    hazardResist += fw.hazardResist;
    if (organics) poiBonus += fw.organicsYield;
    if (vault) poiBonus += fw.vaultYield;
    if (specFavorsPoi(m.spec, poiId)) poiBonus += SPEC_POI_YIELD;
    for (const e of m.effects) if (e.kind === "poiYield" && e.pois.includes(poiId)) poiBonus += e.value;
  }
  F += Math.max(0, exp.scienceStrength ?? 0) * SCIENCE_STRENGTH_FIELDWORK;
  return {
    speedMult: Math.min(FIELDWORK_SPEED_MAX_MULT, Math.max(1, 1 + FIELDWORK_SPEED_PER_BUMP * F)),
    yieldMult: Math.max(1, 1 + FIELDWORK_YIELD_PER_BUMP * F + poiBonus),
    relicFind: Math.max(0, relicFind),
    hazardResist: Math.max(0, hazardResist),
  };
}

// The party's hazard resist on a body of `planetType` (the PoI does not matter for it). 0 without a party.
// Pure.
export function fieldworkHazardResist(exp: Pick<Expedition, "roster" | "scienceStrength">, planetType: string): number {
  const party = exp.roster?.science ?? [];
  if (party.length === 0) return 0;
  let total = 0;
  for (const m of party) total += memberFieldworkOnBody(m, planetType).hazardResist;
  return Math.max(0, total);
}
