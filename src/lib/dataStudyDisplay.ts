// dataStudyDisplay.ts: the display decisions of the Research Lab's DATA STUDY tab (0.14.0, Gas Giant Study GG-6; plan
// docs/plans/2026-10-17-gas-giant-study-plan.md; the signed-off v3 mockup section 3, "approve as is" 2026-10-21: its own
// Research Lab tab, oldest held data first, auto-study when idle with a pause switch, the banked boosts table).
//
// WHY a .ts beside the panel: this repo has no Svelte component test harness, so every choice worth gating (the lane
// line, the countdown words, the paused state, the queue's grouping, the log lines, the boost percents) lives here as
// pure functions over GameState, and DataStudyPanel.svelte only draws them.
//
// DISPLAY ONLY. Every number is the engine's (dataStudy.ts: heldDataQueue, dataStudiesInFlight, dataStudyLaneCount,
// dataStudyPaused, researchBoostsBanked, researchBoostSpeed; the completion log the resolver writes). The one action
// the tab offers, the auto-study switch, routes to the host's do* handler over dataStudy.ts setDataStudyPaused, which
// never refuses (the same state when nothing changes), so the switch is always offered once the lane exists.

import type { CompletionLogEntry, GameState } from "./game/model";
import { BLUEPRINTS, ITEMS, labTier } from "./game/model";
import {
  DATA_STUDY_ITEM_IDS,
  DATA_STUDY_RECIPE_PERMILLE,
  DATA_STUDY_TICKS,
  RESEARCH_BOOST_PER,
  dataStudiesInFlight,
  dataStudyLaneCount,
  dataStudyPaused,
  heldDataQueue,
  researchBoostSpeed,
  researchBoostsBanked,
  researchFamilyOf,
  researchFamilyOfDataItem,
} from "./game/dataStudy";
import { ANCIENT_DATA_FRAGMENT_ID, RESEARCH_DATA_ITEM, RESEARCH_FAMILIES, type ResearchFamily } from "./game/gasGiantContent";
import { researchDataIcon } from "./ui/gasStudyIcons";
import { stockFill } from "./stockFillDisplay";
import { formatNumber } from "./game/format";
import type { IconName } from "./ui/icons";

// ===== Words =====

// "12 min 40 s", "20 min", "45 s" (one tick is one second at the default cadence). Pure.
export function ticksText(ticks: number): string {
  const s = Math.max(0, Math.ceil(Number.isFinite(ticks) ? ticks : 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m === 0) return `${r} s`;
  return r === 0 ? `${m} min` : `${m} min ${r} s`;
}

// A research family's name ("Propulsion", "Hull Design"), read off its data item's label. Pure.
export function familyLabel(family: ResearchFamily): string {
  const label = ITEMS[RESEARCH_DATA_ITEM[family]]?.label ?? family;
  return label.replace(/ Data$/, "");
}

function itemLabel(itemId: string): string {
  return ITEMS[itemId]?.label ?? itemId;
}

function glyphOf(itemId: string): IconName {
  return researchDataIcon(itemId) ?? "researchData";
}

// The boost a family's next project gets from `n` banked boosts, as the tab prints it ("+12% speed", "none"). Pure.
export function boostText(n: number): string {
  return n > 0 ? `+${Math.round(researchBoostSpeed(n) * 100)}% speed` : "none";
}

// ===== The tab =====

export interface DataStudyCurrentView {
  itemId: string;
  name: string; // "Propulsion Data"
  glyph: IconName;
  etaText: string; // "12 min 40 s left of 20 min" | "Paused, 12 min 40 s left of 20 min"
  progressPct: number;
}
export interface DataStudyQueueRow {
  key: string;
  itemId: string;
  name: string;
  glyph: IconName;
  count: number;
  heldText: string | null; // GG-6 review: this type's whole stock against its own cap, "400 / 500"
  full: boolean;
}
export interface DataStudyBoostRow {
  family: ResearchFamily;
  label: string;
  banked: number;
  nextText: string; // "+22% speed" | "none"
}
export interface DataStudyView {
  open: boolean; // the lane exists (Research Lab Level I and up)
  closedText: string | null;
  laneText: string; // "Lane 1 of 1"
  labLevelText: string; // "Lab level 1"
  paused: boolean;
  switchText: string; // "Auto-study on" | "Paused"
  current: DataStudyCurrentView | null;
  idleText: string | null; // "Idle: no held data" and the line under it
  idleSub: string | null;
  note: string;
  queue: DataStudyQueueRow[];
  queueEmptyText: string;
  log: string[];
  boosts: DataStudyBoostRow[];
  boostNote: string;
  ancientText: string | null; // hidden until GG-7 makes decoding visible (ANCIENT_DECODE_TEXT_LIVE)
  fullWarnings: string[]; // one per data type at its warehouse cap
}

// The user (2026-10-23): no "Entries decoded so far" number until decoding does something a player sees (GG-7 authors
// the decode-gated blueprints). The lane still decodes; the line returns with GG-7.
export const ANCIENT_DECODE_TEXT_LIVE = false;

export const DATA_STUDY_NOTE_ON = "When the lane is idle it starts the next held data on its own. Pause holds the queue; nothing is lost.";
export const DATA_STUDY_NOTE_PAUSED = "Paused: held data waits in the queue, nothing is lost. Turn it back on to resume.";

// The held queue in study order, consecutive units of the same item folded into one row ("Sensors Data x2"). Pure.
export function dataQueueRows(state: GameState): DataStudyQueueRow[] {
  const rows: DataStudyQueueRow[] = [];
  for (const e of heldDataQueue(state)) {
    const last = rows[rows.length - 1];
    if (last && last.itemId === e.itemId) {
      last.count += 1;
      continue;
    }
    const fill = stockFill(state as GameState, e.itemId);
    rows.push({
      key: `${rows.length}-${e.itemId}`,
      itemId: e.itemId,
      name: itemLabel(e.itemId),
      glyph: glyphOf(e.itemId),
      count: 1,
      heldText: fill.cap === null ? null : `${formatNumber(fill.held)} / ${formatNumber(fill.cap)}`,
      full: fill.full,
    });
  }
  return rows;
}

// One completed data study in words (the completion log's "dataStudy" entry: the recipe it learned, else the item it
// studied). Pure.
export function dataStudyLogLine(entry: Pick<CompletionLogEntry, "kind" | "reward" | "subjectKey">): string | null {
  if (entry.kind !== "dataStudy" || entry.subjectKey === null) return null;
  if (entry.reward === "blueprint") {
    const bp = BLUEPRINTS[entry.subjectKey];
    const family = bp ? researchFamilyOf(bp) : null;
    const name = bp?.label ?? entry.subjectKey;
    return `${family ? `${familyLabel(family)} Data` : "Research data"} study done: boost banked, and a recipe learned (${Math.round(DATA_STUDY_RECIPE_PERMILLE / 10)}% chance): ${name}.`;
  }
  if (entry.subjectKey === ANCIENT_DATA_FRAGMENT_ID) return "Ancient Data Fragment studied: the next entry of its culture decoded.";
  const family = researchFamilyOfDataItem(entry.subjectKey);
  return family ? `${familyLabel(family)} Data study done: boost banked.` : `${itemLabel(entry.subjectKey)} studied.`;
}

// The tab's recent log, newest first (at most `limit`). Pure.
export function dataStudyLog(state: Pick<GameState, "completionLog">, limit = 3): string[] {
  const out: string[] = [];
  for (let i = state.completionLog.length - 1; i >= 0 && out.length < limit; i -= 1) {
    const line = dataStudyLogLine(state.completionLog[i]);
    if (line) out.push(line);
  }
  return out;
}

// The banked boosts table: every family, its banked count and what its next project gets. Pure.
export function boostRows(state: Pick<GameState, "researchBoosts">): DataStudyBoostRow[] {
  return RESEARCH_FAMILIES.map((family) => {
    const banked = researchBoostsBanked(state, family);
    return { family, label: familyLabel(family), banked, nextText: boostText(banked) };
  });
}

// The ancient entries decoded so far, over every culture. Pure.
export function ancientDecodedTotal(state: Pick<GameState, "ancientDecoded">): number {
  let n = 0;
  for (const v of Object.values(state.ancientDecoded ?? {})) if (typeof v === "number" && v > 0) n += Math.floor(v);
  return n;
}

// The held research data against its warehouse cap (the user, 2026-10-23: research data keeps the cap for now, and the
// Data study tab shows it). The cap is PER TYPE (each type's own warehouse shelf), so each queue row shows its type's
// stock against it ("400 / 500", dataQueueRows), and a type at its cap warns that more of it coming home is not kept
// (the claim clamps at the cap). Pure.
export function heldCap(state: GameState): { fullWarnings: string[] } {
  const fullWarnings: string[] = [];
  for (const id of DATA_STUDY_ITEM_IDS) {
    const f = stockFill(state, id);
    if (f.full && f.cap !== null) fullWarnings.push(`${itemLabel(id)} is full (cap ${formatNumber(f.cap)}): more of it coming home is not kept.`);
  }
  return { fullWarnings };
}

// The whole Data study tab. Pure.
export function dataStudyView(state: GameState): DataStudyView {
  const lanes = dataStudyLaneCount(state);
  const paused = dataStudyPaused(state);
  const flight = dataStudiesInFlight(state)[0] ?? null;
  const queue = dataQueueRows(state);
  let current: DataStudyCurrentView | null = null;
  if (flight && flight.effect.type === "studyData") {
    const id = flight.effect.itemId;
    const total = flight.durationTicks > 0 ? flight.durationTicks : DATA_STUDY_TICKS;
    current = {
      itemId: id,
      name: itemLabel(id),
      glyph: glyphOf(id),
      etaText: `${paused ? "Paused, " : ""}${ticksText(flight.remainingTicks)} left of ${ticksText(total)}`,
      progressPct: Math.max(0, Math.min(100, ((total - flight.remainingTicks) / total) * 100)),
    };
  }
  const decoded = ancientDecodedTotal(state);
  const boostPct = Math.round(RESEARCH_BOOST_PER * 100);
  return {
    open: lanes > 0,
    closedText: lanes > 0 ? null : "The data study lane opens with the Research Lab (Level 1).",
    laneText: `Lane ${Math.min(1, lanes)} of ${lanes}`,
    labLevelText: `Lab level ${labTier(state)}`,
    paused,
    // GG-6 review: the switch's name is a stable "Auto-study" (its label); its state reads on aria-checked and this word.
    switchText: paused ? "paused" : "on",
    current,
    // GG-6 review: on, with data held and nothing started yet (the lane starts it on the next tick).
    idleText: current ? null : queue.length > 0 ? (paused ? "Paused: held data waits" : "Starting the next held data") : "Idle: no held data",
    idleSub: current ? null : queue.length > 0 ? (paused ? "Turn auto-study back on to start the next one." : "The lane starts it on its own.") : "The next data returned starts on its own.",
    note: paused ? DATA_STUDY_NOTE_PAUSED : DATA_STUDY_NOTE_ON,
    queue,
    queueEmptyText: "Nothing held",
    log: dataStudyLog(state),
    boosts: boostRows(state),
    boostNote: `Each finished study banks one boost for its family. Your next project in that family uses them all: +${boostPct}% speed for one, stacking on the diminishing curve, never capped.`,
    ancientText: ANCIENT_DECODE_TEXT_LIVE
      ? `An Ancient Data Fragment is studied in this same lane; it decodes the next entry of the culture it came from instead of banking a boost. Entries decoded so far: ${decoded}.`
      : null,
    ...heldCap(state),
  };
}
