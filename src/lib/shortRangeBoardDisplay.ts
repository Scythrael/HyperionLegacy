// shortRangeBoardDisplay.ts: the display decisions behind the Short-Range board (0.14.0 G1-6, docs/plans/
// 2026-10-17-short-range-missions-plan.md G1-6, the signed-off board mockup https://claude.ai/artifact/HhEA9ARvKjjfAhbnZBSdg3
// and docs/plans/2026-10-19-merge-batch-answers.md "Mockup sign-off": every open question resolved AS DRAWN).
//
// WHY a .ts beside ShortRangePanel.svelte: this repo has no Svelte component test harness, so every choice worth
// gating lives here as a pure function over the tested engine (shortRange.ts, shortRangeBoard.ts, shortRangeCycle.ts),
// and the component only draws it:
//   - the board: one card per slot (a free slot with its next roll, the six sheet bars against the best ready
//     captain's ship and a one-tap Send, user 2026-10-21 "Pre-pick + one-tap Send"; a running or waiting slot with its
//     cycle timeline; a locked slot with its Mission Control upgrade),
//   - the dispatch popup: the captain + hull picker, the per-category refusal text (shortRangeBlockText) and the cost
//     preview,
//   - the collapsed job types list (user "Collapsed on the board"), and
//   - the calm waiting line Home and the Overview show (user "Yes, calm status line"; it reads the engine's own
//     departure gate, shortRangeDepartureHold, so the words and the engine never disagree).
// No game rule lives here: every gate, roll, plan, reward and hold is read from the engine. No clock formatting either
// (the component formats ticks with the player's own preference).

import Decimal from "break_infinity.js";
import { MISSIONS, MISSION_CONTROL_BOARD_RUNGS, SHORT_RANGE_PHASE_LABEL, shipDisplayLabel, type CaptainState, type GameState, type MissionKey, type ShipInstance, type ShortRangePhase } from "./game/model";
import {
  SHORT_RANGE_CATEGORIES,
  SHORT_RANGE_SHEETS,
  SHORT_RANGE_TEMPLATES,
  SHORT_RANGE_TEMPLATE_KEYS,
  SHORT_RANGE_TUTORIAL_TICKS_SCALE,
  drawShortRangeJobAt,
  meetsSheet,
  shortRangeBoardSeed,
  shortRangeCycleReward,
  shortRangeCyclePlan,
  shortRangeDestinationLabel,
  shortRangeDrawVersion,
  shortRangePhenomenonLabel,
  shortRangeRollSeed,
  shortRangeShipEngineering,
  shortRangeShipRatings,
  shortRangeSpanShare,
  shortRangeTemplateUses,
  type ShortRangeCategory,
  type ShortRangeRoll,
  type ShortRangeSlotRef,
  type ShortRangeTemplateKey,
  type ShortRangeTier,
} from "./game/shortRange";
import {
  SHORT_RANGE_BASE_SLOT_TIERS,
  canDispatchShortRange,
  shortRangeBlockText,
  shortRangeBoardSlots,
  shortRangeNextCycle,
  shortRangeSlotOccupant,
  shortRangeSlotPreview,
  type ShortRangeDispatchBlockReason,
} from "./game/shortRangeBoard";
import { shortRangeDropOffMargin, shortRangeLoadToPay, shortRangePhaseTicks, shortRangeWaitText, type ShortRangeDepartureHold, type ShortRangeWaitText } from "./game/shortRangeCycle";
import { effectiveShipStats, shipMissionOutputBonus } from "./game/crewOverlay";
import { captainTransportTerms } from "./game/captainSecondaryEffects";
import { missionPhaseStatus } from "./game/berths";
import { materialAtCap } from "./game/tick";
import { RAMP_MAX_TIER, runCountsOf, runDifficultyAt, runRamp } from "./game/runDifficulty";
import { formatNumber } from "./game/format";
import { refugeeShortRangePlan } from "./game/refugeeBuffs";
import type { IconName } from "./ui/icons";

// ===== vocabulary =====

// Each job's glyph (the mockup's picks: Prisoner Transport reuses the Security shield; Comm Booster Build is the new
// relay mast). Every value is an icons.ts name, classified in ICON_SEMANTICS.
export const SHORT_RANGE_TEMPLATE_ICON: Readonly<Record<ShortRangeTemplateKey, IconName>> = {
  refugeeRelocation: "team",
  supplyDropOff: "offload",
  supplyPickup: "reload",
  phenomenonSurvey: "discovery",
  telescopeRepair: "telescope",
  commBoosterBuild: "commBooster",
  prisonerTransport: "security",
  // E5-2: the people come home. [PROVISIONAL] (E5-5/E5-6 own the board's look)
  evacuation: "home",
};

export interface ShortRangeCategoryView {
  label: string;
  short: string; // the label in a "Uses: ..." list
  icon: IconName;
  unit: string;
  decimals: number; // the ship's value is shown to this many places (the crew ratings are fractional)
}

// The six sheet categories as the board names them (the mockup's labels and glyphs).
export const SHORT_RANGE_CATEGORY_VIEW: Readonly<Record<ShortRangeCategory, ShortRangeCategoryView>> = {
  range: { label: "Range (round trip)", short: "Range", icon: "ship", unit: " ly", decimals: 0 },
  cargo: { label: "Cargo", short: "Cargo", icon: "supplyCache", unit: "", decimals: 0 },
  guests: { label: "Guest quarters", short: "Guest quarters", icon: "guestWing", unit: "", decimals: 0 },
  sensors: { label: "Sensors", short: "Sensors", icon: "study", unit: "", decimals: 0 },
  engineering: { label: "Engineering crew rating", short: "Engineering crew rating", icon: "tool", unit: "", decimals: 1 },
  security: { label: "Security crew rating", short: "Security crew rating", icon: "security", unit: "", decimals: 1 },
};

// Where the sheet line sits on a bar's track (the mockup's tick at 70%): a ship exactly at the sheet fills to it, and
// the 30% past it shows headroom.
export const SHORT_RANGE_SHEET_MARK = 0.7;

// The one way in for each short category (the mockup's hint line under a free slot nobody can take yet). Slot and
// module names are the game's own (EQUIPMENT_SLOTS labels and the Guest Wing variety).
export const SHORT_RANGE_WAY_IN: Readonly<Record<ShortRangeCategory, string>> = {
  range: "a faster or longer-range FTL Drive, or a Fuel Depot upgrade",
  cargo: "a bigger Cargo Bay",
  guests: "a Guest Wing in the Crew Quarters Module",
  sensors: "any Sensor Array",
  engineering: "more Engineering crew aboard",
  security: "more Security crew aboard",
};

// [PROVISIONAL] How the board pre-picks the captain it compares a free slot against (user 2026-10-21 "Pre-pick +
// one-tap Send" picked WHETHER, not WHICH): among the ready captains, the one whose ship clears the sheet by the widest
// margin (its smallest value / sheet ratio over the six categories is the highest); ties go to the lowest captain id.
// The ONE place the rule is named; shortRangeBestReady reads it.
export const SHORT_RANGE_PREPICK_RULE = "widestMargin" as const;

const TIER_NUMERAL: Readonly<Record<ShortRangeTier, string>> = { 1: "I", 2: "II" };
export function shortRangeTierNumeral(tier: ShortRangeTier): string {
  return TIER_NUMERAL[tier];
}

// G1-7: the training run and the slow start in the player's words, every number read from the engine (the share of
// each range a job of that type may reach, shortRangeSpanShare over runRamp; the tutorial length hook). The board's
// job types note and the Help topic both print it, so the two can never disagree with each other or the engine. The
// anchors are the user's SF4 runs (2, 6 and 9); the run where a job first reaches its full range is found, not typed
// (the SF-3 review moved it from run 11 to run 12, which the board's old typed note had missed).
export function shortRangeRunShare(run: number, tier: ShortRangeTier = RAMP_MAX_TIER as ShortRangeTier): number {
  if (run <= 1) return 0; // the training run: the smallest job
  return shortRangeSpanShare({ firstRun: false, ramp: runRamp(run - 2, tier) });
}
export function shortRangeFullSizeRun(tier: ShortRangeTier = RAMP_MAX_TIER as ShortRangeTier): number {
  let run = 2;
  while (shortRangeRunShare(run, tier) < 1 && run < 1000) run += 1;
  return run;
}
const sharePct = (run: number): string => `${Math.round(shortRangeRunShare(run) * 100)}%`;
const RAMP_TIERS = (Object.keys(SHORT_RANGE_SHEETS).map(Number) as ShortRangeTier[]).filter((t) => t <= RAMP_MAX_TIER);
const FULL_TIERS = (Object.keys(SHORT_RANGE_SHEETS).map(Number) as ShortRangeTier[]).filter((t) => t > RAMP_MAX_TIER);
const tierWords = (tiers: readonly ShortRangeTier[]): string => tiers.map((t) => `Tier ${TIER_NUMERAL[t]}`).join(" and ");
export const SHORT_RANGE_TRAINING_NOTE =
  `Every job type's first run is a training run: the smallest job, no gear wear, ${SHORT_RANGE_TUTORIAL_TICKS_SCALE === 1 ? "normal length" : SHORT_RANGE_TUTORIAL_TICKS_SCALE < 1 ? "a shorter trip" : "a longer trip"}. ` +
  `After it, ${tierWords(RAMP_TIERS)} jobs grow on the slow start (run 2 at ${sharePct(2)}, run 6 about ${sharePct(6)}, run 9 about ${sharePct(9)}, full from run ${shortRangeFullSizeRun()}).` +
  (FULL_TIERS.length > 0 ? ` ${tierWords(FULL_TIERS)} jobs are full size from the start.` : "");

// A whole or fractional value as the board prints it. Pure.
function fmt(value: number, decimals: number): string {
  return decimals > 0 ? value.toFixed(decimals) : formatNumber(Math.floor(value));
}

// ===== bars =====

export interface ShortRangeBarView {
  category: ShortRangeCategory;
  label: string;
  icon: IconName;
  haveText: string; // the ship's value
  needText: string; // the sheet's value
  short: boolean; // amber: the ship falls short (Range by the reach gate itself, as the dispatch gate decides)
  used: boolean; // bold: this job uses it; the rest are on standby, still required
  fill: number; // 0..1 of the track (the sheet line is at SHORT_RANGE_SHEET_MARK)
}

// The six bars of `tier`'s sheet against `ship`, the categories `uses` highlighted. Pure.
export function shortRangeBars(state: GameState, ship: ShipInstance, tier: ShortRangeTier, uses: readonly ShortRangeCategory[]): ShortRangeBarView[] {
  const ratings = shortRangeShipRatings(state, ship, tier);
  const short = new Set(meetsSheet(state, ship, tier).short);
  const sheet = SHORT_RANGE_SHEETS[tier];
  return SHORT_RANGE_CATEGORIES.map((c) => {
    const v = SHORT_RANGE_CATEGORY_VIEW[c];
    const have = Math.max(0, ratings[c]);
    const need = sheet[c];
    return {
      category: c,
      label: v.label,
      icon: v.icon,
      haveText: `${fmt(have, v.decimals)}${v.unit}`,
      needText: `${fmt(need, 0)}${v.unit}`,
      short: short.has(c),
      used: uses.includes(c),
      fill: need > 0 ? Math.min(1, (have / need) * SHORT_RANGE_SHEET_MARK) : 1,
    };
  });
}

// A tier's sheet as one line (a locked slot's card). Pure.
export function shortRangeSheetText(tier: ShortRangeTier): string {
  const s = SHORT_RANGE_SHEETS[tier];
  return `Tier ${TIER_NUMERAL[tier]} sheet: ${s.range} ly, Cargo ${s.cargo}, Guest quarters ${s.guests}, Sensors ${s.sensors}, Engineering ${s.engineering}, Security ${s.security}`;
}

// ===== the job =====

export interface ShortRangeJobView {
  template: ShortRangeTemplateKey;
  label: string;
  icon: IconName;
  line: string; // what, where, how far ("41 refugees to Body III, temperate world, 29 ly out")
  flavor: string | null; // a survey's phenomenon
  training: boolean; // the "Training run" chip
  rampChip: string | null; // the slow start's position on a Tier I roll, null at full size
}

function lowerFirst(s: string): string {
  return s.length > 0 ? s[0].toLowerCase() + s.slice(1) : s;
}

// The job's one line, worded per template. Pure.
export function shortRangeJobLine(roll: ShortRangeRoll): string {
  const dest = shortRangeDestinationLabel(roll);
  const out = `${roll.distanceLy} ly out`;
  switch (roll.template) {
    case "refugeeRelocation":
      return `${roll.guests ?? 0} refugees to ${dest}, ${out}`;
    case "prisonerTransport":
      return `${roll.guests ?? 0} prisoners to ${dest}, ${out}`;
    case "supplyDropOff":
      return `${roll.units ?? 0} units of supplies to ${dest}, ${out}`;
    case "supplyPickup":
      return `${roll.units ?? 0} units of supplies from ${dest}, ${out}`;
    case "phenomenonSurvey":
      return `A ${roll.scan ?? 0} point scan ${lowerFirst(dest)}, ${out}`;
    case "telescopeRepair":
      return `${roll.units ?? 0} units of parts to the telescope at ${dest}, ${out}`;
    case "commBoosterBuild":
      return `${roll.units ?? 0} units of components to the relay at ${dest}, ${out}`;
    case "evacuation":
      return `${roll.guests ?? 0} people to bring out of ${dest}, ${out}`;
  }
}

// The slow start chip of a roll: a Tier I roll after the training run, below full size. Pure.
export function shortRangeRampChip(roll: Pick<ShortRangeRoll, "difficulty" | "tier">): string | null {
  if (roll.difficulty.firstRun) return null;
  const share = shortRangeSpanShare(roll.difficulty);
  return share >= 1 ? null : `Slow start: size up to ${Math.round(share * 100)}%`;
}

export function shortRangeJobView(roll: ShortRangeRoll): ShortRangeJobView {
  return {
    template: roll.template,
    label: SHORT_RANGE_TEMPLATES[roll.template].label,
    icon: SHORT_RANGE_TEMPLATE_ICON[roll.template],
    line: shortRangeJobLine(roll),
    flavor: shortRangePhenomenonLabel(roll),
    training: roll.difficulty.firstRun,
    rampChip: shortRangeRampChip(roll),
  };
}

// ===== the job types list =====

export interface ShortRangeTypeRow {
  template: ShortRangeTemplateKey;
  label: string;
  icon: IconName;
  status: string; // "Training run next", "Run 6, size up to 54%", "Full size"
  training: boolean;
  uses: { category: ShortRangeCategory; label: string; icon: IconName }[];
}

// The collapsed job types list (user 2026-10-21 "Collapsed on the board"): each template, where its slow start stands
// at Tier I (the next run's number is its cycle starts + 1, the training run being run 1; its size share reads the
// completed count, SF5) and the categories it uses. Pure.
export function shortRangeTypeRows(state: GameState): ShortRangeTypeRow[] {
  const counts = runCountsOf(state);
  return SHORT_RANGE_TEMPLATE_KEYS.map((k) => {
    const c = counts.shortRange[k] ?? { dispatched: 0, completed: 0 };
    const training = c.dispatched === 0;
    // The Tier I stamp the next roll of this template would read (the board's own roll rule).
    const share = training ? 0 : shortRangeSpanShare(rollStampAtTierI(state, k));
    const status = training ? "Training run next" : share >= 1 ? "Full size" : `Run ${c.dispatched + 1}, size up to ${Math.round(share * 100)}%`;
    return {
      template: k,
      label: SHORT_RANGE_TEMPLATES[k].label,
      icon: SHORT_RANGE_TEMPLATE_ICON[k],
      status,
      training,
      uses: shortRangeTemplateUses(k).map((u) => ({ category: u, label: SHORT_RANGE_CATEGORY_VIEW[u].short, icon: SHORT_RANGE_CATEGORY_VIEW[u].icon })),
    };
  });
}

function rollStampAtTierI(state: GameState, template: ShortRangeTemplateKey) {
  return runDifficultyAt(state, "shortRange", 1, template);
}

// ===== captains: the pre-pick and the picker =====

function shipOfCaptain(state: GameState, captainId: number): ShipInstance | null {
  return state.ships.find((s) => s.assignedCaptainId === captainId) ?? null;
}

// The ship's smallest value / sheet ratio over the six categories (the pre-pick's margin). Pure.
function sheetMargin(state: GameState, ship: ShipInstance, tier: ShortRangeTier): number {
  const r = shortRangeShipRatings(state, ship, tier);
  const sheet = SHORT_RANGE_SHEETS[tier];
  return Math.min(...SHORT_RANGE_CATEGORIES.map((c) => (sheet[c] > 0 ? r[c] / sheet[c] : Infinity)));
}

// The captain the board pre-picks for `slotId` (SHORT_RANGE_PREPICK_RULE), or null when no ready captain meets the
// sheet. Pure.
export function shortRangeBestReady(state: GameState, slotId: number): number | null {
  const slot = shortRangeBoardSlots(state).find((s) => s.id === slotId);
  if (!slot) return null;
  let best: { id: number; margin: number } | null = null;
  for (const c of state.captains) {
    if (!canDispatchShortRange(state, c.id, slotId).ok) continue;
    const ship = shipOfCaptain(state, c.id);
    if (!ship) continue;
    const margin = sheetMargin(state, ship, slot.tier);
    if (best === null || margin > best.margin || (margin === best.margin && c.id < best.id)) best = { id: c.id, margin };
  }
  return best?.id ?? null;
}

// The captain a free slot that nobody can take yet compares against: an idle captain with a sound ship that falls
// short only in sheet categories, the fewest short categories first, then the widest margin, then the lowest id. Null
// when there is none (every captain busy, shipless or in repair). Pure.
function closestCandidate(state: GameState, slot: ShortRangeSlotRef): number | null {
  let best: { id: number; short: number; margin: number } | null = null;
  for (const c of state.captains) {
    const gate = canDispatchShortRange(state, c.id, slot.id);
    if (gate.ok || !(SHORT_RANGE_CATEGORIES as readonly string[]).includes(gate.reason)) continue;
    const ship = shipOfCaptain(state, c.id)!;
    const short = gate.short.length;
    const margin = sheetMargin(state, ship, slot.tier);
    if (best === null || short < best.short || (short === best.short && (margin > best.margin || (margin === best.margin && c.id < best.id)))) best = { id: c.id, short, margin };
  }
  return best?.id ?? null;
}

export interface ShortRangeCompare {
  captainId: number;
  captainLabel: string;
  shipLabel: string;
  ready: boolean; // true: the best ready match (one-tap Send); false: the closest, no ready captain meets the sheet
  bars: ShortRangeBarView[];
  shortLines: string[]; // shortRangeBlockText per short category
  wayIn: string | null; // "One way in: ..." for the short categories
}

// A free slot's comparison ship (the pre-pick, else the closest), or null when no captain can even be compared. Pure.
export function shortRangeCompare(state: GameState, slot: ShortRangeSlotRef, roll: ShortRangeRoll): ShortRangeCompare | null {
  const ready = shortRangeBestReady(state, slot.id);
  const id = ready ?? closestCandidate(state, slot);
  if (id === null) return null;
  const captain = state.captains.find((c) => c.id === id)!;
  const ship = shipOfCaptain(state, id)!;
  const short = meetsSheet(state, ship, slot.tier).short;
  return {
    captainId: id,
    captainLabel: captain.label,
    shipLabel: shipDisplayLabel(state, ship),
    ready: ready !== null,
    bars: shortRangeBars(state, ship, slot.tier, shortRangeTemplateUses(roll.template)),
    shortLines: short.map((c) => shortRangeBlockText(c)),
    wayIn: short.length === 0 ? null : `One way in: ${joinList(short.map((c) => SHORT_RANGE_WAY_IN[c]))}.`,
  };
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export type ShortRangePickerKind = "ready" | "short" | "blocked";

export interface ShortRangePickerRow {
  captainId: number;
  label: string; // "Captain 2, Eir 2" (the hull, when there is one)
  kind: ShortRangePickerKind; // ready (green), short (amber, still selectable to read its bars), blocked (disabled)
  why: string; // "Ready, best match" / "Short: Guest quarters, Sensors" / the refusal text
  best: boolean;
}

// The popup's captain + hull picker (the same captains the captain-mission picker lists, with this slot's verdict):
// the ready captains first (the pre-pick at the top), then the ones short of the sheet, then the ones that cannot fly
// at all (busy, no ship, in repair, crew locked). Pure.
export function shortRangePickerRows(state: GameState, slotId: number): ShortRangePickerRow[] {
  const best = shortRangeBestReady(state, slotId);
  const rows = state.captains.map((c): ShortRangePickerRow & { order: number } => {
    const ship = shipOfCaptain(state, c.id);
    const label = ship ? `${c.label}, ${shipDisplayLabel(state, ship)}` : c.label;
    const gate = canDispatchShortRange(state, c.id, slotId);
    if (gate.ok) return { captainId: c.id, label, kind: "ready", why: c.id === best ? "Ready, best match" : "Ready", best: c.id === best, order: c.id === best ? 0 : 1 };
    if ((SHORT_RANGE_CATEGORIES as readonly string[]).includes(gate.reason)) {
      return { captainId: c.id, label, kind: "short", why: `Short: ${gate.short.map((k) => SHORT_RANGE_CATEGORY_VIEW[k].label).join(", ")}`, best: false, order: 2 };
    }
    return { captainId: c.id, label, kind: "blocked", why: blockedWhy(state, c, gate.reason), best: false, order: 3 };
  });
  return rows.sort((a, b) => a.order - b.order || a.captainId - b.captainId).map(({ order: _o, ...r }) => r);
}

function blockedWhy(state: GameState, captain: CaptainState, reason: ShortRangeDispatchBlockReason): string {
  const text = shortRangeBlockText(reason);
  const m = captain.mission;
  if (reason === "busy" && m !== null && m.kind === "shortRange") return `${text} (flying Slot ${m.slotId + 1})`;
  return text;
}

// ===== the dispatch popup's verdict and cost preview =====

export interface ShortRangeCostPreview {
  training: boolean;
  loadNow: number; // credits this job pays as it leaves home (a drop-off's load), 0 otherwise
  creditsThisJob: number; // about what this job pays on delivery (the earned part; a drop-off's load comes back too)
  captainXpThisJob: number; // per-active-tick XP over the cycle
  cycleTicks: number;
  dropOffLoad: [number, number]; // a later Supply Drop-off's load span at this tier, the captain's discount applied
  marginPct: number; // the drop-off margin, the captain's Trade bonus applied
  creditsPerHour: number; // at full size, this ship on this slot (the next 48 cycles' rolls at full strength)
}

// What one delivered cycle of `roll` pays this captain and ship: the job's credits (a drop-off's margin after the
// captain's Trade bonus, plus the discount saved) times the ship's mission output share; the engine's own rules
// (shortRangeCycle.ts). Pure.
function cycleCredits(state: GameState, captain: CaptainState, ship: ShipInstance, roll: ShortRangeRoll): number {
  const stats = effectiveShipStats(state, ship);
  const base = shortRangeCycleReward(roll, stats);
  const terms = captainTransportTerms(captain);
  let earned = base.credits;
  if (SHORT_RANGE_TEMPLATES[roll.template].reward.kind === "supplyLoop") {
    earned = shortRangeDropOffMargin(roll, base.loadCost, terms.marginBonus) + (base.loadCost - shortRangeLoadToPay(roll, captain));
  }
  return earned * (1 + Math.max(0, shipMissionOutputBonus(state, ship)));
}

// The number of the slot's coming cycles the per-hour estimate samples.
const PER_HOUR_SAMPLE = 48;

// The popup's cost preview for `captainId` flying `slot`'s next roll, or null when the captain cannot be found or has
// no ship. Pure (the per-hour estimate draws the slot's own roll streams, never the economy's).
export function shortRangeCostPreview(state: GameState, captainId: number, slot: ShortRangeSlotRef): ShortRangeCostPreview | null {
  const captain = state.captains.find((c) => c.id === captainId);
  const ship = shipOfCaptain(state, captainId);
  if (!captain || !ship) return null;
  const stats = effectiveShipStats(state, ship);
  const eng = shortRangeShipEngineering(state, ship);
  const roll = shortRangeSlotPreview(state, slot);
  // E5-4: the preview re-plans the cycle as the cycle start will (Mission Control's refugee buff folded in).
  const plan = refugeeShortRangePlan(state, shortRangeCyclePlan(roll, stats, eng));
  const reward = shortRangeCycleReward(roll, stats);
  const terms = captainTransportTerms(captain);
  const drop = SHORT_RANGE_TEMPLATES.supplyDropOff;
  const dropReward = drop.reward.kind === "supplyLoop" ? drop.reward : null;
  const units = drop.rolls[slot.tier].units ?? [0, 0];
  const cost = dropReward ? dropReward.supplyCostPerUnit[slot.tier] : 0;
  const discount = 1 - Math.max(0, terms.supplyDiscount);
  // Full size: the slot's next cycles drawn at full strength (no training run, the whole span), this ship's stats.
  const seed = shortRangeBoardSeed(state);
  const from = shortRangeNextCycle(state, slot.id);
  let credits = 0;
  let ticks = 0;
  for (let i = 0; i < PER_HOUR_SAMPLE; i++) {
    const s = shortRangeRollSeed(seed, slot.id, from + i);
    // E5-2: on the slot's own draw version at that cycle, so the estimate samples the jobs the board will roll.
    const r = drawShortRangeJobAt(s, slot, from + i, () => ({ version: 1, firstRun: false, ramp: 1, tier: slot.tier }), shortRangeDrawVersion(state, slot.id, from + i));
    credits += cycleCredits(state, captain, ship, r);
    ticks += refugeeShortRangePlan(state, shortRangeCyclePlan(r, stats, eng)).totalTicks;
  }
  const secondsPerTick = state.tickDurationSeconds > 0 ? state.tickDurationSeconds : 1;
  return {
    training: roll.difficulty.firstRun,
    loadNow: shortRangeLoadToPay(roll, captain),
    creditsThisJob: Math.round(cycleCredits(state, captain, ship, roll)),
    captainXpThisJob: reward.captainXpPerTick * Math.ceil(plan.totalTicks),
    cycleTicks: plan.totalTicks,
    dropOffLoad: [Math.round(units[0] * cost * discount), Math.round(units[1] * cost * discount)],
    marginPct: Math.round((dropReward ? dropReward.margin : 0) * (1 + Math.max(0, terms.marginBonus)) * 1000) / 10,
    creditsPerHour: ticks > 0 ? Math.round(((credits / (ticks * secondsPerTick)) * 3600) / 10) * 10 : 0,
  };
}

export interface ShortRangeVerdict {
  ok: boolean;
  title: string | null; // "Captain 3 cannot take this slot yet:"
  lines: string[]; // shortRangeBlockText for the reason, or one per short category
}

// The popup's verdict for the picked captain: ok, or every reason in the dispatch gate's own words. Pure.
export function shortRangeVerdict(state: GameState, captainId: number, slotId: number): ShortRangeVerdict {
  const gate = canDispatchShortRange(state, captainId, slotId);
  if (gate.ok) return { ok: true, title: null, lines: [] };
  const captain = state.captains.find((c) => c.id === captainId);
  const lines = gate.short.length > 0 ? gate.short.map((c) => shortRangeBlockText(c)) : [shortRangeBlockText(gate.reason)];
  return { ok: false, title: `${captain?.label ?? "This captain"} cannot take this slot yet:`, lines };
}

// ===== a run in progress =====

export const SHORT_RANGE_PHASES: readonly ShortRangePhase[] = ["transitOut", "onSite", "transitBack", "unloading"];

export interface ShortRangeRunView {
  captainId: number;
  captainLabel: string;
  shipLabel: string;
  slotId: number;
  tier: ShortRangeTier;
  job: ShortRangeJobView;
  cycleNumber: number; // this run's cycle, 1-based
  phaseIndex: number;
  phases: { label: string; ticks: number; done: number }[]; // the cycle timeline (done: 0..1 of that phase)
  phaseLabel: string; // missionPhaseStatus: the same words Home shows, a transit berth hold included
  phaseRemainingTicks: number;
  cycleRemainingTicks: number; // until the cycle docks and the next job re-rolls
  recalled: boolean; // Repeat off: this cycle is the last
  hold: ShortRangeDepartureHold | null; // waiting at home (the engine's departure gate)
  holdText: string | null; // the card's full waiting text
  holdLine: string | null; // the calm one-line status (Home, the Overview)
  // G1-5 review follow-up: the quiet line naming the unidentified relics this run has found so far (they are already in
  // the vault), or null before its first find (and on a run dispatched before G1-5).
  relicLine: string | null;
}

// The run's waiting words, read through the engine's own departure gate (null when it has left or leaves next tick).
// Pure.
export function shortRangeRunWait(state: GameState, captain: CaptainState): ShortRangeWaitText | null {
  const m = captain.mission;
  if (m === null || m.kind !== "shortRange") return null;
  return shortRangeWaitText(m, captain, Math.max(0, state.credits.toNumber()), (id) => materialAtCap(state, id));
}

// The board card, the Overview row and the Home row of one captain's short-range run, or null when the captain is not
// flying one. Pure.
export function shortRangeRunView(state: GameState, captain: CaptainState): ShortRangeRunView | null {
  const m = captain.mission;
  if (m === null || m.kind !== "shortRange") return null;
  const ship = shipOfCaptain(state, captain.id);
  const phaseIndex = SHORT_RANGE_PHASES.indexOf(m.phase);
  const plan = m.plan;
  const lengths = [plan.transitOutTicks, plan.onSiteTicks, plan.transitBackTicks, plan.unloadTicks];
  const phases = SHORT_RANGE_PHASES.map((p, i) => ({
    label: SHORT_RANGE_PHASE_LABEL[p],
    ticks: lengths[i],
    done: i < phaseIndex ? 1 : i === phaseIndex && lengths[i] > 0 ? Math.min(1, m.phaseProgressTicks / lengths[i]) : 0,
  }));
  const phaseRemainingTicks = Math.max(0, Math.ceil(shortRangePhaseTicks(m) - m.phaseProgressTicks));
  const later = lengths.slice(phaseIndex + 1).reduce((a, b) => a + b, 0);
  const wait = shortRangeRunWait(state, captain);
  return {
    captainId: captain.id,
    captainLabel: captain.label,
    shipLabel: ship ? shipDisplayLabel(state, ship) : "no ship",
    slotId: m.slotId,
    tier: m.roll.tier,
    job: shortRangeJobView(m.roll),
    cycleNumber: (m.cyclesThisRun ?? 0) + 1,
    phaseIndex,
    phases,
    phaseLabel: missionPhaseStatus(state, captain),
    phaseRemainingTicks,
    cycleRemainingTicks: phaseRemainingTicks + later,
    recalled: m.recalled,
    hold: wait?.hold ?? null,
    holdText: wait?.text ?? null,
    holdLine: wait?.line ?? null,
    relicLine: shortRangeRelicLine(m.relicsThisRun ?? 0),
  };
}

// G1-5 review follow-up: the board card's quiet line for a run's relic finds so far. Pure.
export function shortRangeRelicLine(found: number): string | null {
  if (!Number.isFinite(found) || found <= 0) return null;
  return `Found ${found} unidentified relic${found === 1 ? "" : "s"} this run, in the vault.`;
}

// The calm one-line status of a run (Home's in-progress row, user 2026-10-21 "Yes, calm status line"): the waiting
// line while it waits at home, else its phase (the berth hold's words included) and its cycle. Pure.
export function shortRangeStatusLine(state: GameState, captain: CaptainState): string {
  const v = shortRangeRunView(state, captain);
  if (v === null) return "";
  if (v.holdLine !== null) return v.holdLine;
  return `${v.phaseLabel}, cycle ${v.cycleNumber}${v.recalled ? ", last cycle" : ""}`;
}

// ===== the board =====

export interface ShortRangeGateRow {
  label: string;
  have: number;
  need: number;
}

export type ShortRangeSlotCard =
  | { kind: "free"; slotId: number; tier: ShortRangeTier; job: ShortRangeJobView; compare: ShortRangeCompare | null; sheetText: string }
  | { kind: "run"; slotId: number; tier: ShortRangeTier; run: ShortRangeRunView }
  | { kind: "locked"; slotId: number; tier: ShortRangeTier; level: number; credits: number; durationTicks: number; gate: ShortRangeGateRow[]; sheetText: string };

export interface ShortRangeBoardView {
  missionControlLevel: number;
  openSlots: number;
  totalSlots: number;
  headline: string; // "Mission Control level 2: 3 of 4 slots open"
  cards: ShortRangeSlotCard[];
}

function decimalToNumber(v: unknown): number {
  if (v instanceof Decimal) return v.toNumber();
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

// The whole board: every open slot (free with its next roll, or the run flying it), then every slot a Mission Control
// upgrade still has to open (its level, cost and any completion gate). Pure.
export function shortRangeBoardView(state: GameState): ShortRangeBoardView {
  const slots = shortRangeBoardSlots(state);
  const raw = state.facilities?.missionControl?.level;
  const level = typeof raw === "number" && Number.isFinite(raw) ? Math.floor(raw) : 0;
  const cards: ShortRangeSlotCard[] = slots.map((slot) => {
    const occupant = shortRangeSlotOccupant(state, slot.id);
    const run = occupant ? shortRangeRunView(state, occupant) : null;
    if (run !== null) return { kind: "run", slotId: slot.id, tier: slot.tier, run };
    const roll = shortRangeSlotPreview(state, slot);
    return { kind: "free", slotId: slot.id, tier: slot.tier, job: shortRangeJobView(roll), compare: shortRangeCompare(state, slot, roll), sheetText: shortRangeSheetText(slot.tier) };
  });
  const completed = state.lifetimeStats?.missionsCompleted ?? {};
  MISSION_CONTROL_BOARD_RUNGS.forEach((rung, i) => {
    const opensAt = i + 2;
    if (level >= opensAt || !("addShortRangeSlot" in rung.effect)) return;
    const tier = rung.effect.addShortRangeSlot;
    const gate = Object.entries(rung.requiresMissionCompletions ?? {}).map(([k, need]) => ({
      label: MISSIONS[k as MissionKey]?.label ?? k,
      have: Math.floor(decimalToNumber(completed[k])),
      need: need as number,
    }));
    cards.push({
      kind: "locked",
      slotId: SHORT_RANGE_BASE_SLOT_TIERS.length + i,
      tier,
      level: opensAt,
      credits: decimalToNumber(rung.credits),
      durationTicks: rung.durationTicks,
      gate,
      sheetText: shortRangeSheetText(tier),
    });
  });
  const total = SHORT_RANGE_BASE_SLOT_TIERS.length + MISSION_CONTROL_BOARD_RUNGS.length;
  return {
    missionControlLevel: level,
    openSlots: slots.length,
    totalSlots: total,
    headline: `Mission Control level ${level}: ${slots.length} of ${total} slots open`,
    cards,
  };
}

// The Mission Control upgrade card's "what this rung does" line for a board rung ("Opens Short-Range slot 3, Tier
// II"), or null for any other rung. `slotNumber` is the 1-based board position the rung opens. Pure.
export function missionControlRungSlotText(rungEffect: unknown, slotNumber: number): string | null {
  if (!rungEffect || typeof rungEffect !== "object" || !("addShortRangeSlot" in rungEffect)) return null;
  const tier = (rungEffect as { addShortRangeSlot: ShortRangeTier }).addShortRangeSlot;
  return `Opens Short-Range slot ${slotNumber} (Tier ${TIER_NUMERAL[tier]})`;
}
