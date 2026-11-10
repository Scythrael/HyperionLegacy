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
import { BLUEPRINTS, ITEMS, ancientEntriesDecodedMax, blueprintDecodeLocked, labTier } from "./game/model";
import { SPECIAL_BLUEPRINT_KEYS, SPECIAL_BLUEPRINT_TIER, type SpecialBlueprintKey } from "./game/specialBlueprints";
import { regionTierNumeral } from "./game/galaxy";
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
import { jobOvertimeStrip, jobRateText, type JobOvertimeStrip } from "./jobOvertimeDisplay";
import { processWorkFraction } from "./game/processSpeed";

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
  // OT-UI (the 2026-11-10 Overtime buttons mockup, approved): the study's Overtime rate chip ("1.25x", null at the
  // normal rate) and its strip (jobOvertimeDisplay.ts, in this row's own clock "12 min 40 s"; Paused with its reason
  // while auto-study is off; null where the engine hides it, a study's last tick).
  rateText: string | null;
  overtime: JobOvertimeStrip | null;
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
  // GG-7: the special blueprints (the signed-off v3 mockup section 4 cards) and the decode gate's line.
  specials: SpecialBlueprintCardView[];
  decodeGateText: string;
}

// The user (2026-10-23): no "Entries decoded so far" number until decoding does something a player sees. GG-7 authored
// the decode-gated special blueprints (model.ts GAS_GIANT_BLUEPRINTS), so the line is back on.
export const ANCIENT_DECODE_TEXT_LIVE = true;

// ===== GG-7: the special blueprint cards (v3 mockup section 4, "approve all 4 mockups as is" 2026-10-21) =====

export type SpecialBlueprintState = "locked" | "open" | "researching" | "researched";
export interface SpecialBlueprintCardView {
  key: SpecialBlueprintKey;
  name: string; // "Pressure-Forged Plating"
  text: string; // the mockup's line, then "Lab tier III."
  glyph: IconName; // its own glyph while locked; the discovery glyph once open; a check once researched
  state: SpecialBlueprintState;
  chipText: string; // "Entry 2" | "Unlocked: ready to research" | "Researching" | "Researched"
}

// The cards' lines (the mockup's words; the Resonance array's also names what it does, which the mockup left out).
const SPECIAL_TEXT: Readonly<Record<SpecialBlueprintKey, string>> = {
  pressureForgedPlatingBp: "Hull plating forged under crushing pressure.",
  ramscoopCollectorBp: "Boosts the nebula sweep: bigger, faster hauls. Never a gate.",
  resonanceSensorArrayBp: "A sensor array tuned by ancient records: richer canisters (more Augmented and Stellar) from gas giant studies.",
};
const SPECIAL_GLYPH: Readonly<Record<SpecialBlueprintKey, IconName>> = {
  pressureForgedPlatingBp: "armor",
  ramscoopCollectorBp: "nebula",
  resonanceSensorArrayBp: "telescope",
};

// The research refusal for a decode-gated blueprint (the Research list's reason line): the entries ONE culture needs.
// Pure.
export function decodeLockText(entries: number): string {
  const n = Math.max(1, Math.floor(entries));
  return `Decode ${n} ancient ${n === 1 ? "entry" : "entries"} of one culture first`;
}

// The three special blueprint cards, in the mockup's order. Pure.
export function specialBlueprintCards(state: Pick<GameState, "ancientDecoded" | "researchedBlueprints" | "activeProcesses">): SpecialBlueprintCardView[] {
  return SPECIAL_BLUEPRINT_KEYS.map((key) => {
    const bp = BLUEPRINTS[key];
    const name = (bp?.label ?? key).replace(/ Blueprint$/, "");
    const text = `${SPECIAL_TEXT[key]} Lab tier ${regionTierNumeral(SPECIAL_BLUEPRINT_TIER[key])}.`;
    const researched = state.researchedBlueprints.includes(key);
    const researching = state.activeProcesses.some((p) => p.effect.type === "unlockBlueprint" && p.effect.key === key);
    const locked = blueprintDecodeLocked(state, key);
    const st: SpecialBlueprintState = researched ? "researched" : researching ? "researching" : locked ? "locked" : "open";
    const chipText =
      st === "researched" ? "Researched" : st === "researching" ? "Researching" : st === "open" ? "Unlocked: ready to research" : `Entry ${bp?.requiresDecode ?? 1}`;
    const glyph: IconName = st === "researched" ? "check" : st === "locked" ? SPECIAL_GLYPH[key] : "discovery";
    return { key, name, text, glyph, state: st, chipText };
  });
}

// The decode gate in words. The count lives in the lane's ancient line (ancientText: the furthest culture's entries,
// the number each card's "Entry N" is read against). Pure.
export function decodeGateText(): string {
  return "Special blueprints open as one culture's entries are decoded: each locked card names the entry it waits on.";
}

// The entries the gate reads: the culture furthest along (model.ts ancientEntriesDecodedMax), never a sum over cultures,
// so "Entry 2" on a card opens exactly when this line reads 2. Pure.
export function ancientEntriesText(state: Pick<GameState, "ancientDecoded">): string {
  const best = ancientEntriesDecodedMax(state);
  return `Entries decoded by the furthest culture so far: ${best}.`;
}

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
      // OT-UI (user "Chip + no jump"): the WORK done, so an Overtime step never moves the bar (at the normal rate the
      // old (total - remaining) / total). The study's "of 20 min" stays its normal length, as the mockup reads.
      progressPct: Math.max(0, Math.min(100, (flight.durationTicks > 0 ? processWorkFraction(flight) : (total - flight.remainingTicks) / total) * 100)),
      rateText: jobRateText(flight),
      overtime: jobOvertimeStrip(state, flight, ticksText),
    };
  }
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
      ? `An Ancient Data Fragment is studied in this same lane; it decodes the next entry of the culture it came from instead of banking a boost. ${ancientEntriesText(state)}`
      : null,
    ...heldCap(state),
    specials: specialBlueprintCards(state),
    decodeGateText: decodeGateText(),
  };
}
