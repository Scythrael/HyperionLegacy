// objectiveAffixDisplay.ts: the display decisions of an objective's AFFIXES and its ALERT (0.14.0, objective
// affixes UI step; docs/plans/2026-10-14-objective-affixes-capture.md).
//
// WHY a .ts beside the components: this repo has no Svelte component test harness, so every choice worth gating
// (a pill's words and color, what a screen reader hears, when the alert line shows, the Impossible countdown) lives
// here as pure functions over the engine's readers (affixes.ts), and AffixPill.svelte / ObjectiveAffixes.svelte
// only draw them. No rule lives here: ranks, alignments, the alert, its escalation, the rating and the failsafe are
// all affixes.ts.
//
// THE PILL (user: "the affix should have a color coding that makes this obvious to the player at a glance. So the
// pill ... will be color coded with green/yellow/red"): one per affix, green positive, yellow neutral, red
// negative (affixes.ts affixColorClass), and the alignment is also WRITTEN on the pill ("Negative"), so color is
// never the only signal. Its label carries the rank ("Reinforcing III"); its tooltip is the affix's short line.
//
// THE ALERT (Reinforcing): while an objective is on alert, its level, the Heightened Senses stacks and the extra
// enemies per fight, the raised rating and when the alert clears. Once the alert has pushed the objective to
// IMPOSSIBLE it is HELD (the failsafe): the line becomes the user's countdown ("how long before the objective
// returns to normal difficulty"), "Impossible: resets in 24m", from objectiveHeldUntil.

import type { ExpeditionActivity, ObjectiveAffix } from "./game/model";
import {
  AFFIX_ALIGNMENT_NAMES,
  AFFIX_DEFS,
  HEIGHTENED_SENSES_NAME,
  IMPOSSIBLE_DIFFICULTY_NAME,
  affixPill,
  alertLevelAt,
  alertResetsAt,
  escalationAt,
  objectiveDifficultyAt,
  objectiveHeldUntil,
  validAffixes,
  type AffixColor,
} from "./game/affixes";
import { threatAssessment } from "./game/combat/threatAssessment";

// The Impossible tier's color (the threat ramp's crimson, user 2026-10-14: brighter, with a static glow). Read from
// the ramp itself (zero wins is always Impossible), so the two never drift apart.
export const IMPOSSIBLE_HEX = threatAssessment(0, 1).colorHex;

// ===== Pills =====

export interface AffixPillView {
  key: string; // stable per instance: "reinforcing-3-negative"
  label: string; // "Reinforcing III"
  color: AffixColor; // green / yellow / red (the pill's class)
  alignment: string; // "Negative": written on the pill too (never color alone)
  tooltip: string; // the affix's short line
  ariaLabel: string; // the trigger's accessible name: the whole pill, so nothing is hover-only
}

// One affix instance as a pill. Pure.
export function affixPillView(a: ObjectiveAffix): AffixPillView {
  const p = affixPill(a);
  return {
    key: `${a.id}-${a.rank}-${a.alignment}`,
    label: p.label,
    color: p.color,
    alignment: p.alignment,
    tooltip: p.tooltip,
    ariaLabel: `${p.label}, ${p.alignment.toLowerCase()} affix. ${p.tooltip}`,
  };
}

// A pill for an affix the telescope can name before its rank is rolled (a Deadly combat objective always carries
// Reinforcing): the name and alignment only, no rank. Null for an unknown id or one with several alignments. Pure.
export function affixNamePill(id: keyof typeof AFFIX_DEFS, why: string): AffixPillView | null {
  const def = AFFIX_DEFS[id];
  if (!def || def.alignments.length !== 1) return null;
  const alignment = def.alignments[0];
  const name = AFFIX_ALIGNMENT_NAMES[alignment];
  return {
    key: `${id}-any-${alignment}`,
    label: def.name,
    color: affixPill({ id, rank: 1, alignment }).color,
    alignment: name,
    tooltip: why,
    ariaLabel: `${def.name}, ${name.toLowerCase()} affix. ${why}`,
  };
}

// ===== The alert =====

export interface ObjectiveAlertView {
  level: number;
  held: boolean; // Impossible: no crew starts it until the reset (the failsafe)
  headline: string; // "On alert (level 2)" | "Impossible: resets in 24m 3s"
  effects: string; // "2 more enemies per fight, Heightened Senses x2 (+34% enemy damage)"
  ratingText: string | null; // "Rating raised to Deadly" (null when the rating is unrated)
  resetText: string; // "The alert clears in 36m 12s" | what the failsafe does while held
}

// A span of whole seconds in plain words: "45s", "6m", "6m 12s", "1h 12m" (the same words as the timelines,
// groundOpsTimelineDisplay.ts spanText; kept here so this module imports none of the screen modules). Pure.
function spanWords(seconds: number): string {
  const s = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0));
  if (s < 60) return `${s}s`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return r === 0 ? `${m}m` : `${m}m ${r}s`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

// A countdown in plain words, rounded UP to the second ("24m 3s"); "now" at or past it. Pure.
export function countdownText(until: number, now: number): string {
  const left = Math.ceil(until - now);
  return left > 0 ? spanWords(left) : "now";
}

// The objective's alert at `now`, or null when it is not on alert. Pure.
export function objectiveAlertView(task: Pick<ExpeditionActivity, "affixes" | "alert" | "difficulty" | "difficultyScore">, now: number): ObjectiveAlertView | null {
  const level = alertLevelAt(task, now);
  const resetsAt = alertResetsAt(task);
  if (level <= 0 || resetsAt === null) return null;
  const esc = escalationAt(level);
  const bonus = Math.round((esc.damageMult - 1) * 100);
  const enemies = esc.extraEnemies === 1 ? "1 more enemy per fight" : `${esc.extraEnemies} more enemies per fight`;
  const effects = `${enemies}, ${HEIGHTENED_SENSES_NAME} x${level} (+${bonus}% enemy damage)`;
  const rating = objectiveDifficultyAt(task, now);
  const heldUntil = objectiveHeldUntil(task, now);
  const held = heldUntil !== null;
  const left = countdownText(held ? heldUntil : resetsAt, now);
  const headline = held ? `${IMPOSSIBLE_DIFFICULTY_NAME}: resets in ${left}` : `On alert (level ${level})`;
  const ratingText = rating === null ? null : held ? null : `Rating raised to ${rating.name}`;
  const resetText = held
    ? "Your teams move on and come back when the alert resets: the threat appears to have retreated, and the objective returns to normal difficulty."
    : `The alert clears in ${left}`;
  return {
    level,
    held,
    headline,
    effects,
    ratingText,
    resetText,
  };
}

// ===== The block on an objective card =====

export interface ObjectiveAffixesView {
  pills: AffixPillView[];
  alert: ObjectiveAlertView | null;
}

// Everything the affix block of an objective card shows, or null when there is nothing (no affix, no alert). Pure.
export function objectiveAffixesView(task: Pick<ExpeditionActivity, "affixes" | "alert" | "difficulty" | "difficultyScore">, now: number): ObjectiveAffixesView | null {
  const pills = validAffixes(task.affixes).map(affixPillView);
  const alert = objectiveAlertView(task, now);
  return pills.length === 0 && alert === null ? null : { pills, alert };
}

// The Reinforcing pill beside the forecast's hardest fight when it is a Deadly COMBAT objective (Reinforcing is
// required there; its rank rolls when the body's scan finishes). Null otherwise. Pure.
export const DEADLY_REINFORCING_NOTE = "Deadly combat objectives always carry Reinforcing; its rank rolls when the body's scan finishes.";
export function forecastAffixPills(hardest: { difficulty: number; fightPoints: number } | null): AffixPillView[] {
  const from = AFFIX_DEFS.reinforcing.requiredFromDifficulty;
  if (!hardest || from === undefined || hardest.difficulty < from || hardest.fightPoints <= 0) return [];
  const pill = affixNamePill("reinforcing", DEADLY_REINFORCING_NOTE);
  return pill ? [pill] : [];
}
