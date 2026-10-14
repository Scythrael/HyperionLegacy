// groundOpsAtoms.ts: the display decisions behind ThreatChip.svelte and TeamBadge.svelte (0.14.0, Ground
// Operations GO-10).
//
// WHY a .ts beside the components: this repo has no Svelte component test harness (icons.ts makes the
// same call for <Icon>), so the choices worth gating (which name a chip shows, what a screen reader hears,
// which glyph marks a team kind) live here as pure functions and the components only draw them.

import type { ThreatAssessment } from "../game/combat/threatAssessment";
import type { GroundTeamKind } from "../game/model";
import { teamKindLabel } from "../game/groundComposition";
import { groundTeamShortLabel } from "../game/groundTeams";
import type { IconName } from "./icons";

// The fields a threat chip reads. A Pick, so a caller can hand over a full ThreatAssessment or a memoized
// copy without the chip caring which.
export type ThreatChipInput = Pick<ThreatAssessment, "tier" | "name" | "shortName" | "colorHex" | "fuzzyRange" | "voice">;

export interface ThreatChipView {
  glyph: IconName; // always the SVG tier dot (standing rule: never emoji)
  color: string; // the tier's literal band color (threatAssessment.ts COLORS: the same in every theme)
  text: string; // what the chip face shows
  title: string | null; // the full tier name as the bubble's first line, only when the face shows the short one
  range: string; // the coarse odds phrase
  voice: string; // the tactical officer's line
  ariaLabel: string; // the trigger's accessible name: the whole readout, so nothing is hover-only
}

// One threat chip's display. `full` shows the full tier name on the face (the patrol card, which has the
// room); the default shows the short name (GO-6 `shortName`, for a table cell) and moves the full name into
// the bubble. `context` prefixes the accessible name ("Threat Assessment", "Team A odds"). Pure.
export function threatChipView(a: ThreatChipInput, full = false, context = "Threat Assessment"): ThreatChipView {
  return {
    glyph: "threatDot",
    color: a.colorHex,
    text: full ? a.name : a.shortName,
    title: full ? null : a.name,
    range: a.fuzzyRange,
    voice: a.voice,
    ariaLabel: `${context}: ${a.name}. ${a.fuzzyRange}. ${a.voice}`,
  };
}

// The glyph per team kind (Squads design 2.1: Strike = Security + Security, Survey = Science + Science,
// Ground = one of each). Exhaustive, so a new kind without a glyph is a compile error.
export const TEAM_KIND_GLYPHS: Record<GroundTeamKind, IconName> = {
  ground: "groundTeam",
  strike: "strikeTeam",
  survey: "surveyTeam",
};

export interface TeamBadgeView {
  letter: string; // A / B / C by position (groundTeamShortLabel: never changes on a rename)
  glyph: IconName | null; // the team kind glyph, when a kind was given
  ariaLabel: string; // "Alpha, Strike team" / "Team A"
}

// One team badge's display: the letter by INDEX (user 9b.7), optionally the kind glyph, and an accessible
// name built from the team's display name when the caller has it. Pure.
export function teamBadgeView(index: number, kind?: GroundTeamKind | null, name?: string | null): TeamBadgeView {
  const letter = groundTeamShortLabel(index);
  const who = name && name.trim() ? name.trim() : `Team ${letter}`;
  return {
    letter,
    glyph: kind ? TEAM_KIND_GLYPHS[kind] : null,
    ariaLabel: kind ? `${who}, ${teamKindLabel(kind)}` : who,
  };
}
