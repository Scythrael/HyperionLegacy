// E-CREW "Crew Made Real": the first-pass AWAY-TEAM TRAIT catalog (pure data, DORMANT).
//
// A recruit rolls a few traits at generation (awayTeam.ts awayRecruitCandidates); how many follows its
// rank (traitCountForRank). Each trait names the squad types it can roll for and carries a small TYPED
// effect descriptor. The descriptors are DATA ONLY for now: no resolver reads them yet. The member-power
// and expedition tasks (design sections 5.3 and 5.5) consume them later, so a descriptor's shape is the
// contract and its numbers are FIRST-PASS + TUNABLE.
//
// The names are the approved mockup's (docs/plans/2026-10-02-crew-made-real-e-crew-design.md, mockup
// section 2). Prospecting rolls no traits yet: the squad is wired only and nobody is ever recruited into it.

import type { AwayTeamType, AwayTraitId, GambitStatusId } from "./model";
import type { ExpeditionPoiId } from "./expeditionContent";

// A member stat a trait can raise, as a FRACTION of the member's own value (0.05 = +5%). The Security
// stats match the member card's HP / PWR / ARM / ACC line; the Science ones its FIELD / RELIC / HAZ line,
// plus statusChance for the Debuff spec's afflictions.
export type AwayMemberStat =
  | "hp"
  | "power"
  | "armor"
  | "accuracy"
  | "statusChance"
  | "fieldwork"
  | "relicFind"
  | "hazardResist";

// What a trait does, as a small closed union so a consumer switches on `kind` and the compiler flags a
// new kind it does not handle. Keep it minimal: a new kind is added only when a trait needs one.
export type AwayTraitEffect =
  | { kind: "stat"; stat: AwayMemberStat; value: number } // a flat percentage bump to one member stat
  | { kind: "medic" } // can cure an ally's afflictions in a ground battle (design section 10: curing from Security)
  | { kind: "firstStrike" } // acts first in the opening round
  | { kind: "guard"; allyHpBelow: number } // steps in front of an ally below this HP fraction
  | { kind: "resistStatus"; status: GambitStatusId; value: number } // chance (0..1) to shrug the status off
  | { kind: "poiYield"; pois: ExpeditionPoiId[]; value: number }; // better finds at these points of interest

export interface AwayTraitDef {
  id: AwayTraitId;
  label: string; // player-facing name (US English)
  description: string; // one player-facing line (US English)
  teamTypes: AwayTeamType[]; // the squads this trait can roll for
  effect: AwayTraitEffect;
}

// The catalog, Security first, then Science. Ids are stable save keys (members store them), so never
// rename one; retire a trait by leaving its row in place. FIRST-PASS + TUNABLE numbers.
export const AWAY_TRAITS: readonly AwayTraitDef[] = [
  // ===== Security =====
  {
    id: "steadyAim",
    label: "Steady Aim",
    description: "A careful shot. +5% accuracy.",
    teamTypes: ["security"],
    effect: { kind: "stat", stat: "accuracy", value: 0.05 },
  },
  {
    id: "breacher",
    label: "Breacher",
    description: "First through the door and hits hard. +8% power.",
    teamTypes: ["security"],
    effect: { kind: "stat", stat: "power", value: 0.08 },
  },
  {
    id: "bulwark",
    label: "Bulwark",
    description: "Takes hits meant for allies below 40% HP.",
    teamTypes: ["security"],
    effect: { kind: "guard", allyHpBelow: 0.4 },
  },
  {
    id: "fieldMedic",
    label: "Field Medic",
    description: "Can cure an ally's afflictions in battle.",
    teamTypes: ["security"],
    effect: { kind: "medic" },
  },
  {
    id: "saboteur",
    label: "Saboteur",
    description: "Afflictions land more often. +10% status chance.",
    teamTypes: ["security"],
    effect: { kind: "stat", stat: "statusChance", value: 0.1 },
  },
  {
    id: "quickDraw",
    label: "Quick Draw",
    description: "Acts first on the opening round.",
    teamTypes: ["security"],
    effect: { kind: "firstStrike" },
  },
  {
    id: "ironWill",
    label: "Iron Will",
    description: "Resists Fear.",
    teamTypes: ["security"],
    effect: { kind: "resistStatus", status: "fear", value: 0.5 },
  },
  {
    id: "veteran",
    label: "Veteran",
    description: "Seen it all before. +8% armor.",
    teamTypes: ["security"],
    effect: { kind: "stat", stat: "armor", value: 0.08 },
  },
  // ===== Science =====
  {
    id: "keenEye",
    label: "Keen Eye",
    description: "Spots what others miss. +5% relic chance.",
    teamTypes: ["science"],
    effect: { kind: "stat", stat: "relicFind", value: 0.05 },
  },
  {
    id: "patientHands",
    label: "Patient Hands",
    description: "Better finds at Ancient Ruins and Crashed Ships.",
    teamTypes: ["science"],
    effect: { kind: "poiYield", pois: ["ancientRuins", "crashedShip"], value: 0.1 },
  },
  {
    id: "greenThumb",
    label: "Green Thumb",
    description: "More organics and samples from Xeno-Flora Blooms.",
    teamTypes: ["science"],
    effect: { kind: "poiYield", pois: ["xenoFloraBloom"], value: 0.15 },
  },
  {
    id: "codebreaker",
    label: "Codebreaker",
    description: "Better finds at Buried Vaults and Subterranean Civilizations.",
    teamTypes: ["science"],
    effect: { kind: "poiYield", pois: ["buriedVault", "subterraneanCivilization"], value: 0.1 },
  },
  {
    id: "deepSurvey",
    label: "Deep Survey",
    description: "Better finds at Mineral Outcrops and Geothermal Chambers.",
    teamTypes: ["science"],
    effect: { kind: "poiYield", pois: ["mineralOutcrop", "geothermalChamber"], value: 0.1 },
  },
  {
    id: "steady",
    label: "Steady",
    description: "Hazards slow this member less.",
    teamTypes: ["science"],
    effect: { kind: "stat", stat: "hazardResist", value: 0.1 },
  },
];

// The traits a recruit of `teamType` can roll, in catalog order (empty for Prospecting today). Pure.
export function awayTraitsForTeam(teamType: AwayTeamType): AwayTraitDef[] {
  return AWAY_TRAITS.filter((t) => t.teamTypes.includes(teamType));
}

// Look a trait up by id. Undefined for an id the catalog no longer carries, so a reader of a stored
// member skips it rather than throwing. Pure.
export function getAwayTrait(id: AwayTraitId): AwayTraitDef | undefined {
  return AWAY_TRAITS.find((t) => t.id === id);
}
