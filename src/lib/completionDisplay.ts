// completionDisplay.ts: the display decisions behind COMPLETION TRACKING (0.14.0; docs/plans/2026-11-13-completion-
// tracking-design.md and the approved mockup docs/mockups/2026-11-13-completion-tracking-mockup.html, the user's eleven
// answers). Every number is read from the engine's one completion function (game/completion.ts systemCompletion), so
// the console, the Resume card, the candidate cards, the telescope map and the Survey Log can never disagree:
//   - the console's compact system line "Bodies 2/3 · Objectives 3/5 · 63%" with a small ring (Q7 A), each body's line
//     ("Scanned · Objectives 3/3 · 100%"), the badge beside the system name at 100%;
//   - the Resume card's one number "Completion 40% · Bodies 1/3 · Objectives 1/2" (Q9 A);
//   - a candidate card's "Visited: N%" or the badge (Q2 B);
//   - the claim card's line at 100% (Q10 B);
//   - the telescope map's green arc per region badge and its key line (Q6 B);
//   - the Systems section at the top of the Survey Log tab, grouped by tier (Q8 A), starting at the update (Q5 A),
//     an abandoned system marked (Q11 A).
// Player text says "objective", Roman numerals for tiers, US English. No game rule lives here.

import type { RegionTier } from "./game/model";
import type { BodyCompletion, SystemCompletion, SystemRow } from "./game/completion";
import { regionCompletionTally } from "./game/completion";
import { REGION_TIER_NAMES, regionTierNumeral } from "./game/galaxy";

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

// ===== The ring (the console line's small ring, r 6 on a 16 px box) =====
export const COMPLETION_RING_R = 6;
const RING_C = 2 * Math.PI * COMPLETION_RING_R;

// The stroke dash of a ring filled to `percent` ("23.6 37.7"). Pure.
export function ringDash(percent: number, r: number = COMPLETION_RING_R): string {
  const c = 2 * Math.PI * r;
  return `${((c * Math.max(0, Math.min(100, percent))) / 100).toFixed(1)} ${c.toFixed(1)}`;
}

// The skipped note (" · 1 skipped"), "" without one.
const skippedText = (n: number): string => (n > 0 ? ` · ${n} skipped` : "");

export interface CompletionLineView {
  bodiesText: string; // "2/3"
  objectivesText: string; // "3/5" (with " · 1 skipped")
  percentText: string; // "63%"
  ringDash: string;
  complete: boolean;
  ariaLabel: string; // "Completion 63%: 2 of 3 bodies scanned, 3 of 5 objectives done"
}

// The console's compact system line (Q7 A). Pure.
export function completionLineView(c: SystemCompletion): CompletionLineView {
  const skipped = c.objectivesSkipped > 0 ? `, ${c.objectivesSkipped} skipped` : "";
  return {
    bodiesText: `${c.bodiesScanned}/${c.bodies}`,
    objectivesText: `${c.objectivesDone}/${c.objectives}${skippedText(c.objectivesSkipped)}`,
    percentText: `${c.percent}%`,
    ringDash: ringDash(c.percent),
    complete: c.complete,
    ariaLabel: `Completion ${c.percent}%: ${c.bodiesScanned} of ${c.bodies} ${plural(c.bodies, "body", "bodies")} scanned, ${c.objectivesDone} of ${c.objectives} ${plural(c.objectives, "objective", "objectives")} done${skipped}`,
  };
}

// A body card's completion line (the mockup's note under section 2). Pure.
export function bodyCompletionText(b: BodyCompletion): string {
  if (!b.scanned) return "Not scanned yet · objectives appear when the scan ends · 0%";
  if (b.objectives === 0) return "Scanned · No objectives · 100%";
  return `Scanned · Objectives ${b.done}/${b.objectives}${skippedText(b.skipped)} · ${b.percent}%`;
}

// The claim card's line at 100% (Q10 B, verbatim), else null. Pure.
export function claimCompletionText(systemName: string, c: SystemCompletion): string | null {
  return c.complete ? `${systemName} completed: every body scanned, every objective done.` : null;
}

// The Resume card's one number (Q9 A): "40% · Bodies 1/3 · Objectives 1/2". Pure.
export function resumeCompletionText(c: SystemCompletion): string {
  return `${c.percent}% · Bodies ${c.bodiesScanned}/${c.bodies} · Objectives ${c.objectivesDone}/${c.objectives}${skippedText(c.objectivesSkipped)}`;
}

// A candidate card's visited mark (Q2 B): the badge when completed, else "Visited: N%"; null when never visited. Pure.
export function visitedChip(c: SystemCompletion | null): { complete: boolean; text: string } | null {
  if (!c) return null;
  return c.complete ? { complete: true, text: "Completed" } : { complete: false, text: `Visited: ${c.percent}%` };
}

// ===== The Survey Log's Systems section (Q8 A) =====

export type SystemsSort = "tier" | "completion" | "newest";
export const SYSTEMS_SORTS: readonly { id: SystemsSort; label: string }[] = [
  { id: "tier", label: "By tier" },
  { id: "completion", label: "By completion" },
  { id: "newest", label: "Newest first" },
];
export const SYSTEMS_FOOT = "Listed from this update on. Systems claimed before it left no record.";
export const SYSTEMS_EMPTY = "No system visited since this update yet. Systems appear here once an expedition reaches one.";

export interface SystemRowView {
  id: string;
  name: string;
  realStar: boolean;
  enemyTerritory: boolean;
  tierText: string; // "Tier II"
  bodiesText: string; // "2/3"
  objectivesText: string; // "3/5"
  skippedText: string | null; // "2 skipped"
  percent: number;
  complete: boolean;
  stateText: string | null; // "Under way" / "In Resume" / "Abandoned"
  stateKind: "underWay" | "inResume" | "abandoned" | null;
}

export interface SystemsGroupView {
  key: string;
  heading: string; // "Tier II · Orion Arm"
  countText: string; // "2 systems · 1 completed"
  rows: SystemRowView[];
}

export interface SystemsSectionView {
  visited: number;
  completed: number;
  groups: SystemsGroupView[]; // one per tier (By tier), or one flat group
  empty: boolean;
}

const STATE_TEXT = { underWay: "Under way", inResume: "In Resume", abandoned: "Abandoned" } as const;

function rowView(r: SystemRow): SystemRowView {
  const c = r.completion;
  return {
    id: r.systemId,
    name: r.systemName,
    realStar: r.realStar,
    enemyTerritory: r.enemyTerritory,
    tierText: `Tier ${regionTierNumeral(r.tier)}`,
    bodiesText: `${c.bodiesScanned}/${c.bodies}`,
    objectivesText: `${c.objectivesDone}/${c.objectives}`,
    skippedText: c.objectivesSkipped > 0 ? `${c.objectivesSkipped} skipped` : null,
    percent: c.percent,
    complete: c.complete,
    stateText: r.state ? STATE_TEXT[r.state] : null,
    stateKind: r.state,
  };
}

const byName = (a: SystemRow, b: SystemRow): number => (a.systemName < b.systemName ? -1 : a.systemName > b.systemName ? 1 : a.systemId < b.systemId ? -1 : a.systemId > b.systemId ? 1 : 0);
const byCompletion = (a: SystemRow, b: SystemRow): number => b.completion.percent - a.completion.percent || b.at - a.at || byName(a, b);
const byNewest = (a: SystemRow, b: SystemRow): number => b.at - a.at || byName(a, b);

// The section: grouped by tier, nearest tier first (each group by completion, then name), or flat by completion or
// newest first. Pure.
export function systemsSectionView(rows: readonly SystemRow[], sort: SystemsSort): SystemsSectionView {
  const completed = rows.filter((r) => r.completion.complete).length;
  let groups: SystemsGroupView[];
  if (sort === "tier") {
    const tiers = [...new Set(rows.map((r) => r.tier))].sort((a, b) => a - b);
    groups = tiers.map((t) => {
      const list = rows.filter((r) => r.tier === t).sort((a, b) => b.completion.percent - a.completion.percent || byName(a, b));
      const done = list.filter((r) => r.completion.complete).length;
      return {
        key: `tier-${t}`,
        heading: `Tier ${regionTierNumeral(t)} · ${REGION_TIER_NAMES[t]}`,
        countText: `${list.length} ${plural(list.length, "system", "systems")} · ${done} completed`,
        rows: list.map(rowView),
      };
    });
  } else {
    const list = [...rows].sort(sort === "completion" ? byCompletion : byNewest);
    groups = list.length > 0 ? [{ key: sort, heading: "", countText: "", rows: list.map(rowView) }] : [];
  }
  return { visited: rows.length, completed, groups, empty: rows.length === 0 };
}

export function isSystemsSort(v: unknown): v is SystemsSort {
  return v === "tier" || v === "completion" || v === "newest";
}

// ===== The telescope map's region arcs (Q6 B) =====

// The arc sits outside the badge with a gap (badge r 10): its radius.
export const REGION_ARC_R = 12.5;
export const REGION_ARC_STROKE = 2;

export interface RegionArcView {
  tier: RegionTier;
  x: number;
  y: number;
  r: number;
  dash: string | null; // null: nothing completed yet (the track alone)
  charted: number;
  completed: number;
}

export interface MapCompletionView {
  arcs: RegionArcView[];
  keyText: Map<RegionTier, string>; // "5 charted · 3 completed"
  legend: string | null; // null until a system is charted
  ariaSentence: string;
}

export const MAP_COMPLETION_LEGEND = "Green arc: the share of a region's charted systems you have completed.";

// The arcs on the map's badges and the key's lines, from the Systems rows. Pure.
export function mapCompletionView(badges: readonly { tier: RegionTier; x: number; y: number }[], rows: readonly SystemRow[]): MapCompletionView {
  const tally = regionCompletionTally(rows);
  const arcs: RegionArcView[] = [];
  const keyText = new Map<RegionTier, string>();
  for (const b of badges) {
    const t = tally.get(b.tier);
    if (!t) continue;
    arcs.push({ tier: b.tier, x: b.x, y: b.y, r: REGION_ARC_R, dash: t.completed > 0 ? ringDash((100 * t.completed) / t.charted, REGION_ARC_R) : null, charted: t.charted, completed: t.completed });
    keyText.set(b.tier, `${t.charted} charted · ${t.completed} completed`);
  }
  return {
    arcs,
    keyText,
    legend: arcs.length > 0 ? MAP_COMPLETION_LEGEND : null,
    ariaSentence: arcs.length > 0 ? "Green arcs show the share of each region's charted systems you have completed." : "",
  };
}

// For the slice labels (telescopeCardDisplay.ts telescopeMapEnemyView): the badges with an arc are one obstacle with it.
export function arcObstacleRadius(): number {
  return REGION_ARC_R + REGION_ARC_STROKE / 2;
}

// The ring's circumference (the console ring's track).
export const COMPLETION_RING_C = RING_C;
