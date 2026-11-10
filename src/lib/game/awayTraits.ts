// E-CREW "Crew Made Real": the first-pass AWAY-TEAM TRAIT catalog (pure data, DORMANT).
//
// A recruit rolls a few traits at generation (awayTeam.ts awayRecruitCandidates); how many follows its
// rank (traitCountForRank). Each trait names the squad types it can roll for and carries one or more
// small TYPED effect descriptors. The descriptors are DATA ONLY for now: no resolver reads them yet. The
// member-power and expedition tasks (design sections 5.3 and 5.5) consume them later, so a descriptor's
// shape is the contract and its numbers are FIRST-PASS + TUNABLE.
//
// PLAYER TEXT: a trait's `description` is a FLAVOR line with no numbers. The numeric part is GENERATED
// from the effects (awayTraitEffectText), and traitDisplayText joins the two, so retuning a number can
// never leave a stale figure in the text.
//
// The names are the approved mockup's (docs/plans/2026-10-02-crew-made-real-e-crew-design.md, mockup
// section 2). The Prospecting traits are the Prospecting squads design's (2026-10-16 section 4): built, and
// HIDDEN with the squad (no Prospecting recruit appears until the per-save unlock, prospecting.ts).

import type { AwayTeamType, AwayTraitId, GambitStatusId } from "./model";
import type { AwayMemberStat } from "./awayTeam";
import { getPoiById, type ExpeditionPoiId } from "./expeditionContent";
import { GAMBIT_STATUSES, FIRST_AID_TRAINED_EFFECTIVENESS } from "./gambit";

// What a trait does, as a small closed union so a consumer switches on `kind` and the compiler flags a
// new kind it does not handle. Keep it minimal: a new kind is added only when a trait needs one. A
// `stat` bump stacks ADDITIVELY with every other same-stat bump (see AwayMemberStat in awayTeam.ts).
export type AwayTraitEffect =
  | { readonly kind: "stat"; readonly stat: AwayMemberStat; readonly value: number } // a percentage bump to one member stat
  | { readonly kind: "medic" } // MEDICAL TRAINING (D20): cure + heal allies in battle, use a Med Kit, trained first aid
  | { readonly kind: "firstStrike" } // acts first in the opening round
  | { readonly kind: "guard"; readonly allyHpBelow: number } // steps in front of an ally below this HP fraction
  | { readonly kind: "resistStatus"; readonly status: GambitStatusId; readonly value: number } // chance (0..1) to shrug it off
  | { readonly kind: "poiYield"; readonly pois: readonly ExpeditionPoiId[]; readonly value: number }; // better finds at these PoIs

export interface AwayTraitDef {
  readonly id: AwayTraitId;
  readonly label: string; // player-facing name (US English)
  readonly description: string; // a player-facing FLAVOR line, no numbers (US English)
  readonly teamTypes: readonly AwayTeamType[]; // the squads this trait can roll for
  readonly effects: readonly AwayTraitEffect[]; // one today; a list so a future trait can carry two
}

// The catalog, Security first, then Science, then Prospecting. Ids are stable save keys (members store them), so never
// rename one; retire a trait by leaving its row in place. FIRST-PASS + TUNABLE numbers.
export const AWAY_TRAITS: readonly AwayTraitDef[] = [
  // ===== Security =====
  {
    id: "steadyAim",
    label: "Steady Aim",
    description: "A careful, patient shot.",
    teamTypes: ["security"],
    effects: [{ kind: "stat", stat: "accuracy", value: 0.05 }],
  },
  {
    id: "breacher",
    label: "Breacher",
    description: "First through the door, and hits hard.",
    teamTypes: ["security"],
    effects: [{ kind: "stat", stat: "power", value: 0.08 }],
  },
  {
    id: "bulwark",
    label: "Bulwark",
    description: "Plants their feet in front of a hurt teammate.",
    teamTypes: ["security"],
    effects: [{ kind: "guard", allyHpBelow: 0.4 }],
  },
  {
    // D20 (user, 2026-10-06): the skill is MEDICAL TRAINING. The id stays "fieldMedic" (a stored save key);
    // only the player-facing label + description changed.
    id: "fieldMedic",
    label: "Medical Training",
    description: "Formally trained in field medicine.",
    teamTypes: ["security"],
    effects: [{ kind: "medic" }],
  },
  {
    id: "saboteur",
    label: "Saboteur",
    description: "Knows exactly where it hurts.",
    teamTypes: ["security"],
    effects: [{ kind: "stat", stat: "statusChance", value: 0.1 }],
  },
  {
    id: "quickDraw",
    label: "Quick Draw",
    description: "The fastest hands in the squad.",
    teamTypes: ["security"],
    effects: [{ kind: "firstStrike" }],
  },
  {
    id: "ironWill",
    label: "Iron Will",
    description: "Does not rattle.",
    teamTypes: ["security"],
    effects: [{ kind: "resistStatus", status: "fear", value: 0.5 }],
  },
  {
    id: "veteran",
    label: "Veteran",
    description: "Seen it all before.",
    teamTypes: ["security"],
    effects: [{ kind: "stat", stat: "armor", value: 0.08 }],
  },
  // ===== Science =====
  {
    id: "keenEye",
    label: "Keen Eye",
    description: "Spots what others miss.",
    teamTypes: ["science"],
    effects: [{ kind: "stat", stat: "relicFind", value: 0.05 }],
  },
  {
    id: "patientHands",
    label: "Patient Hands",
    description: "Careful work at old sites.",
    teamTypes: ["science"],
    effects: [{ kind: "poiYield", pois: ["ancientRuins", "crashedShip"], value: 0.1 }],
  },
  {
    id: "greenThumb",
    label: "Green Thumb",
    description: "At home among alien plants.",
    teamTypes: ["science"],
    effects: [{ kind: "poiYield", pois: ["xenoFloraBloom"], value: 0.15 }],
  },
  {
    id: "codebreaker",
    label: "Codebreaker",
    description: "Reads old locks like a book.",
    teamTypes: ["science"],
    effects: [{ kind: "poiYield", pois: ["buriedVault", "subterraneanCivilization"], value: 0.1 }],
  },
  {
    id: "deepSurvey",
    label: "Deep Survey",
    description: "Reads rock and heat for what lies below.",
    teamTypes: ["science"],
    effects: [{ kind: "poiYield", pois: ["mineralOutcrop", "geothermalChamber"], value: 0.1 }],
  },
  {
    // Shared with Prospecting (user 2026-10-16: "Hazard gear + Steady"). Adding a squad leaves the Science pool,
    // and so every Science roll, unchanged.
    id: "steady",
    label: "Steady",
    description: "Keeps a calm pace through rough ground.",
    teamTypes: ["science", "prospecting"],
    effects: [{ kind: "stat", stat: "hazardResist", value: 0.1 }],
  },
  // ===== Prospecting (built HIDDEN; design 2026-10-16 section 4, names kept by the user) =====
  // Existing effect kinds only. With Steady above, six traits cover the rank 7 and 8 draw of three.
  {
    id: "strongBack",
    label: "Strong Back",
    description: "Hauls more out of every seam.",
    teamTypes: ["prospecting"],
    effects: [{ kind: "stat", stat: "oreYield", value: 0.08 }],
  },
  {
    id: "assayersEye",
    label: "Assayer's Eye",
    description: "Knows good rock at a glance.",
    teamTypes: ["prospecting"],
    effects: [{ kind: "stat", stat: "oreGrade", value: 0.05 }],
  },
  {
    id: "tireless",
    label: "Tireless",
    description: "Keeps the drill turning.",
    teamTypes: ["prospecting"],
    effects: [{ kind: "stat", stat: "fieldwork", value: 0.08 }],
  },
  {
    id: "rockhound",
    label: "Rockhound",
    description: "Lives for an open seam.",
    teamTypes: ["prospecting"],
    effects: [{ kind: "poiYield", pois: ["mineralOutcrop"], value: 0.1 }],
  },
  {
    id: "deepVein",
    label: "Deep Vein",
    description: "Follows the ore underground.",
    teamTypes: ["prospecting"],
    effects: [{ kind: "poiYield", pois: ["caveNetwork", "geothermalChamber"], value: 0.1 }],
  },
];

// The traits a recruit of `teamType` can roll, in catalog order. Pure.
export function awayTraitsForTeam(teamType: AwayTeamType): AwayTraitDef[] {
  return AWAY_TRAITS.filter((t) => t.teamTypes.includes(teamType));
}

// Look a trait up by id. Undefined for an id the catalog no longer carries, so a reader of a stored
// member skips it rather than throwing. Pure.
export function getAwayTrait(id: AwayTraitId): AwayTraitDef | undefined {
  return AWAY_TRAITS.find((t) => t.id === id);
}

// D20: does this member have MEDICAL TRAINING (a trait carrying the medic effect)? The battle reads the same
// fact from the snapshot (gambit.ts buildRosterCombatants); the UI reads it here to say when a worn Med Kit
// cannot heal. An unknown trait id counts as nothing. Pure.
export function hasMedicalTraining(member: { readonly traits: readonly AwayTraitId[] }): boolean {
  return member.traits.some((id) => getAwayTrait(id)?.effects.some((e) => e.kind === "medic") === true);
}

// ===== Player text, generated from the effects =====

// Player-facing names for the member stats (US English), as they read after a "+5%".
const AWAY_STAT_TEXT: Record<AwayMemberStat, string> = {
  hp: "HP",
  power: "power",
  armor: "armor",
  accuracy: "accuracy",
  statusChance: "status chance",
  fieldwork: "fieldwork",
  relicFind: "relic chance",
  hazardResist: "hazard resistance",
  oreYield: "yield",
  oreGrade: "grade",
};

// A fraction as a percent, rounded to one decimal and printed without a trailing ".0" (0.05 => "5%",
// 0.075 => "7.5%", -0.05 => "-5%"). Rounding goes through tenths of a percent so float noise
// (0.07 * 100 = 7.000000000000001) never leaks into the text.
function pct(fraction: number): string {
  const tenths = Math.round(fraction * 1000);
  return `${tenths === 0 ? 0 : tenths / 10}%`;
}

// A signed percent for a bump: "+5%" for a gain, "-5%" for a penalty (never "+-5%"), "0%" for none.
function signedPct(fraction: number): string {
  const text = pct(fraction);
  return Math.round(fraction * 1000) > 0 ? `+${text}` : text;
}

// "A", "A and B", "A, B and C" (a short US English list, no serial comma).
function listText(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

// The player-facing line for ONE effect, numbers included (no trailing period). Pure.
export function awayTraitEffectText(effect: AwayTraitEffect): string {
  switch (effect.kind) {
    case "stat":
      return `${signedPct(effect.value)} ${AWAY_STAT_TEXT[effect.stat]}`;
    case "medic":
      return `Cures and heals allies in battle, can use a Med Kit, and gives ${signedPct(FIRST_AID_TRAINED_EFFECTIVENESS - 1)} first aid`;
    case "firstStrike":
      // Wiring WR-10 fix round (OC-F5, user 2026-11-10 "Shrug off stun/fear once"): gambit.ts resolveGroundBattle.
      return `Acts first on the opening round, and ignores ${GAMBIT_STATUSES.stun.label} and ${GAMBIT_STATUSES.fear.label} on their first turn after the enemies have acted`;
    case "guard":
      return `Takes hits meant for allies below ${pct(effect.allyHpBelow)} HP`;
    case "resistStatus":
      return `Resists ${GAMBIT_STATUSES[effect.status].label} (${pct(effect.value)})`;
    case "poiYield":
      return `${signedPct(effect.value)} yield at ${listText(effect.pois.map((id) => getPoiById(id)?.label ?? id))}`;
  }
}

// The full player-facing trait line: the flavor description, then each effect's generated text as its
// own sentence ("Seen it all before. +8% armor."). Pure.
export function traitDisplayText(trait: AwayTraitDef): string {
  return [trait.description, ...trait.effects.map((e) => `${awayTraitEffectText(e)}.`)].join(" ");
}
