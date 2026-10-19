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
  textColor: string; // the face text: the band color, lifted toward white until it reads at WCAG AA (below)
  glow: boolean; // the Impossible tier's static red glow (user 2026-10-14: emphasize it)
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
    textColor: readableChipText(a.colorHex),
    glow: a.tier === "impossible",
    text: full ? a.name : a.shortName,
    title: full ? null : a.name,
    range: a.fuzzyRange,
    voice: a.voice,
    ariaLabel: `${context}: ${a.name}. ${a.fuzzyRange}. ${a.voice}`,
  };
}

// ===== Chip text contrast (GO-10 review minor, user 2026-10-14) =====
//
// The band ramp is literal hex on a dark panel in every theme. The darker bands (Extreme, Impossible) drawn
// as text over their own 16% wash fall short of WCAG AA (4.5:1), and chips are reused small. The border and
// the dot keep the band color; the TEXT is the band color mixed toward white just enough to reach the target.
// The bright bands come back unchanged.

// The resolved panel background (--color-panel-bg over --color-bg-deep, app.css: #0a141e), the lightest
// surface a chip sits on, and the chip's wash share (ThreatChip.svelte `color-mix(... 16%, transparent)`).
export const CHIP_PANEL_BG = "#0a141e";
export const CHIP_WASH_SHARE = 0.16;
// AA is 4.5:1; the target keeps a little margin for a card's own faint accent tint.
export const CHIP_TEXT_MIN_CONTRAST = 4.8;

function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function rgbHex(rgb: readonly number[]): string {
  return `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}
// `a` mixed toward `b` by share t (0 = a, 1 = b), per channel. Pure.
export function mixHex(a: string, b: string, t: number): string {
  const x = hexRgb(a);
  const y = hexRgb(b);
  return rgbHex(x.map((c, i) => c * (1 - t) + y[i] * t));
}
function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function luminance(hex: string): number {
  const [r, g, b] = hexRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
// WCAG 2.1 contrast ratio of two hex colors. Pure.
export function contrastRatio(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
// The chip's own background: the band's wash over the panel. Pure.
export function chipBackground(bandHex: string): string {
  return mixHex(CHIP_PANEL_BG, bandHex, CHIP_WASH_SHARE);
}
// The band color lifted toward white in 5% steps until it meets CHIP_TEXT_MIN_CONTRAST on its chip. Pure.
export function readableChipText(bandHex: string): string {
  const bg = chipBackground(bandHex);
  for (let step = 0; step <= 20; step += 1) {
    const text = mixHex(bandHex, "#ffffff", step / 20);
    if (contrastRatio(text, bg) >= CHIP_TEXT_MIN_CONTRAST) return text;
  }
  return "#ffffff";
}

// The glyph per team kind (Squads design 2.1: Strike = Security + Security, Survey = Science + Science,
// Ground = one of each). Exhaustive, so a new kind without a glyph is a compile error.
export const TEAM_KIND_GLYPHS: Record<GroundTeamKind, IconName> = {
  ground: "groundTeam",
  strike: "strikeTeam",
  survey: "surveyTeam",
  // Prospecting squads (HIDDEN kinds, never rendered while locked): the existing ore glyph [PROVISIONAL]. Their
  // own paired emblems (mockup + the 16 / 28 / 56 px SVG review) land with the visible Prospecting UI.
  claim: "ore",
  dig: "ore",
};

// The smallest size a team kind glyph renders at (GO-10 review: the paired emblems blur below it). A small
// badge shows the letter alone; its caller shows the kind as visible text beside it.
export const TEAM_KIND_GLYPH_MIN_PX = 20;

export interface TeamBadgeView {
  letter: string; // A / B / C by position (groundTeamShortLabel: never changes on a rename)
  glyph: IconName | null; // the team kind glyph, when a kind was given and the badge is md (never below 20 px)
  ariaLabel: string; // "Alpha, Strike team" / "Team A"
}

// One team badge's display: the letter by INDEX (user 9b.7), the kind glyph only on a md badge (at
// TEAM_KIND_GLYPH_MIN_PX; a sm badge is the letter alone), and an accessible name built from the team's
// display name when the caller has it. The badge carries no title tooltip: callers show the team's name and
// kind as visible text. Pure.
export function teamBadgeView(
  index: number,
  kind?: GroundTeamKind | null,
  name?: string | null,
  size: "md" | "sm" = "md",
): TeamBadgeView {
  const letter = groundTeamShortLabel(index);
  const who = name && name.trim() ? name.trim() : `Team ${letter}`;
  return {
    letter,
    glyph: kind && size === "md" ? TEAM_KIND_GLYPHS[kind] : null,
    ariaLabel: kind ? `${who}, ${teamKindLabel(kind)}` : who,
  };
}
