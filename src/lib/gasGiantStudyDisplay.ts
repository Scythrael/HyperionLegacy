// gasGiantStudyDisplay.ts: the display decisions of the GAS GIANT STUDY screens (0.14.0, E-CREW Task 15b, slice GG-6;
// plan docs/plans/2026-10-17-gas-giant-study-plan.md, the signed-off v3 mockup "approve as is", 2026-10-21):
//   - section 1, the expedition's scan section: each orbital body's study row (its class and mass, "Orbital: no ground
//     objectives", the ship study time, the Galileo dive, its state), the system's nebula row, the "ship holding orbit"
//     card, the ship legs card with its return forecast, and the launch preview's study chips;
//   - section 2, the gas giant body card: the physics, "how close to a star", the canister band, the dive depth against
//     the crush rating, the probe rows, the haul forecast and the chance per canister;
//   - the study results (each finished study's haul) and the claim log line;
//   - the Survey Log (the Archive tab): entries grouped by class with counts, and the entry card.
//
// WHY a .ts beside the components: this repo has no Svelte component test harness, so every choice worth gating lives
// here as pure functions over the stored run and the content tables, and the components only draw them.
//
// DISPLAY ONLY. Every number is read off the engine (gasGiantStudy.ts, gasGiantContent.ts, fieldwork.ts, groundOps.ts);
// nothing here changes a rule or writes to the run. The two display-only tables (GIANT_ART, NEBULA_ART: the palettes of
// the SVG art and each class's cloud decks on the pressure column) and the crush rating's bar scale
// (GALILEO_CRUSH_BAR_PER_RATING) feed drawings and words only.

import type { Expedition, ExpeditionFinding, GroundStudyLeg, ItemBand, ShipInstance, SurveyLogEntry } from "./game/model";
import { ITEMS, BLUEPRINTS, REFINE_RECIPES } from "./game/model";
import {
  ANCIENT_DATA_FRAGMENT_ID,
  GAS_CANISTER_IDS,
  GIANT_CLASSES,
  ITEM_BANDS,
  NEBULA_KINDS,
  canistersInBand,
  giantClassById,
  giantClassDisplayName,
  giantPhysics,
  nebulaKindById,
  starProgress,
  type BandOdds,
  type CanisterWeights,
  type GasCanisterId,
  type GiantClassDef,
  type GiantClassId,
  type NebulaKindDef,
  type NebulaKindId,
} from "./game/gasGiantContent";
import {
  STUDY_BASE_SECONDS,
  STUDY_CANISTERS_MAX,
  STUDY_CANISTERS_MIN,
  STUDY_RESEARCH_DATA_PERMILLE,
  STUDY_SURVEY_READOUT_PERMILLE,
  ancientFragmentPermille,
  bodyGiantProfile,
  giantDepthFactor,
  isStudyBody,
  nebulaCanisterRange,
  nebulaSweepSeconds,
  studyBandOdds,
  studyCanisterRange,
  studyProbe,
  studySeconds,
  sweepsNebula,
} from "./game/gasGiantStudy";
import { fieldworkSpeedMult } from "./game/fieldwork";
import { tierHaulMult } from "./game/riskFactors";
import { RETURN_SECONDS, groundShipPosition } from "./game/groundOps";
import { regionTierNumeral } from "./game/galaxy";
import { bodyDesignation, runTeamName } from "./groundTaskQueueDisplay";
import type { IconName } from "./ui/icons";

// ============================================================================
// Small words
// ============================================================================

// A span of seconds in the study screens' words (the v3 mockup's "18 min", "2 h", "1 h 13 min", "45 s"): whole
// minutes, rounded. Pure.
export function minText(seconds: number): string {
  const s = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0));
  if (s < 60) return `${s} s`;
  const total = Math.round(s / 60);
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

// The time left until `end`, rounded UP to the minute ("9 min left"); seconds under a minute. Pure.
export function minLeftText(end: number, now: number): string {
  const left = Math.ceil(end - now);
  if (left <= 0) return "ending now";
  if (left < 60) return `${left} s left`;
  return `${minText(Math.ceil(left / 60) * 60)} left`;
}

// A time since the window opened as the legs list writes it ("0:55", "1:13", "12:04"). Pure.
export function clockText(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${m < 10 ? "0" : ""}${m}`;
}

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
function countWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

// A percent as the study screens print it: whole from 1% up, one decimal from 0.1%, two below ("18%", "0.4%",
// "0.07%"). Pure.
export function percentText(pct: number): string {
  const p = Math.max(0, Number.isFinite(pct) ? pct : 0);
  if (p >= 1) return `${Math.round(p)}%`;
  if (p >= 0.1) return `${Math.round(p * 10) / 10}%`;
  return `${Math.round(p * 100) / 100}%`;
}

// A per-mille chance as a percent, one decimal at most ("4%", "1.5%"). Pure.
export function permilleText(permille: number): string {
  return `${Math.round(Math.max(0, permille)) / 10}%`;
}

const BAND_NAMES: Readonly<Record<ItemBand, string>> = { standard: "Standard", augmented: "Augmented", stellar: "Stellar", radiant: "Radiant" };
export function bandName(band: ItemBand): string {
  return BAND_NAMES[band];
}

// ============================================================================
// Mass and physics words
// ============================================================================

// Earth masses in one Jupiter mass (the ice giant's mass line adds "about 17 Earth masses").
export const EARTH_MASSES_PER_JUPITER = 317.8;

// "2.40 Jupiter masses", "0.052 Jupiter masses (about 17 Earth masses)", "31.0 Jupiter masses". Pure.
export function massText(massMilliJ: number): string {
  const m = massMilliJ / 1000;
  if (m < 0.1) return `${m.toFixed(3)} Jupiter masses (about ${Math.round(m * EARTH_MASSES_PER_JUPITER)} Earth masses)`;
  if (m < 10) return `${m.toFixed(2)} Jupiter masses`;
  return `${m.toFixed(1)} Jupiter masses`;
}

// The mass alone, short ("2.40 Jupiter masses" without the Earth note), for the body row. Pure.
export function massShortText(massMilliJ: number): string {
  const m = massMilliJ / 1000;
  return `${m < 0.1 ? m.toFixed(3) : m < 10 ? m.toFixed(2) : m.toFixed(1)} Jupiter masses`;
}

// ============================================================================
// "How close to a star" (D22): the star bar
// ============================================================================

// The bar's log scale, in Jupiter masses (the mockup's 0.01 to 100).
export const STAR_BAR_MIN_MJ = 0.01;
export const STAR_BAR_MAX_MJ = 100;

// Where `mj` Jupiter masses sits on the bar, 0 to 100. Pure.
export function starBarPct(mj: number): number {
  const lo = Math.log10(STAR_BAR_MIN_MJ);
  const hi = Math.log10(STAR_BAR_MAX_MJ);
  const v = Math.log10(Math.max(1e-9, mj));
  return Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
}

const FRACTION_WORDS: readonly (readonly [number, string])[] = [
  [2, "half the way"],
  [3, "a third of the way"],
  [4, "a quarter of the way"],
  [5, "a fifth of the way"],
  [6, "a sixth of the way"],
  [8, "an eighth of the way"],
  [10, "a tenth of the way"],
  [12, "a twelfth of the way"],
  [15, "a fifteenth of the way"],
  [20, "a twentieth of the way"],
];
// Below this share of the deuterium line the verdict reads "Nowhere near a star."
export const STAR_VERDICT_NEAR_SHARE = 0.05;

// The verdict line under the bar. Pure.
export function starVerdict(massMilliJ: number): string {
  const { deuteriumShare } = starProgress(massMilliJ);
  if (deuteriumShare >= 1) return "It crossed the first line: it burned deuterium, briefly, but never became a true star.";
  if (deuteriumShare < STAR_VERDICT_NEAR_SHARE) return "Nowhere near a star.";
  const inv = 1 / deuteriumShare;
  let best = FRACTION_WORDS[0];
  for (const f of FRACTION_WORDS) if (Math.abs(f[0] - inv) < Math.abs(best[0] - inv)) best = f;
  return `About ${best[1]} to burning deuterium.`;
}

export interface StarBarView {
  pinPct: number;
  deuteriumLinePct: number;
  fusionLinePct: number;
  ticks: { label: string; pct: number }[];
  deuteriumText: string; // "18%"
  fusionText: string; // "3%"
  verdict: string;
  ariaLabel: string;
}

// The star bar of a giant of `massMilliJ`. Pure.
export function starBarView(massMilliJ: number): StarBarView {
  const { deuteriumShare, fusionShare } = starProgress(massMilliJ);
  const deuteriumText = percentText(deuteriumShare * 100);
  const fusionText = percentText(fusionShare * 100);
  return {
    pinPct: starBarPct(massMilliJ / 1000),
    deuteriumLinePct: starBarPct(13),
    fusionLinePct: starBarPct(78),
    ticks: [0.01, 0.1, 1, 10].map((m) => ({ label: String(m), pct: starBarPct(m) })),
    deuteriumText,
    fusionText,
    verdict: starVerdict(massMilliJ),
    ariaLabel: `How close it came to becoming a star: ${massShortText(massMilliJ)}, ${deuteriumText} of the deuterium line and ${fusionText} of the fusion line.`,
  };
}

// ============================================================================
// The art tables (display only)
// ============================================================================

// Each class's SVG palette (five bands, top to bottom), an optional storm spot and aurora, and its cloud decks on the
// pressure column (bar, label). The Sudarsky I, ice giant and brown dwarf rows are the signed-off v3 mockup's; the
// other four classes follow the same science (their palettes from their known colors: a white water-cloud world, an
// azure cloudless sky, a charcoal alkali-metal giant, a red-glowing silicate one).
export interface GiantArt {
  palette: readonly [string, string, string, string, string];
  spot?: string;
  aurora?: true;
  layers: readonly (readonly [number, string])[];
}
export const GIANT_ART: Readonly<Record<GiantClassId, GiantArt>> = {
  sudarskyI: {
    palette: ["#e9d6b4", "#c99a6b", "#f1e4cc", "#b07a4f", "#e3c9a0"],
    spot: "#b5523a",
    layers: [
      [0.7, "Ammonia ice clouds"],
      [2, "Ammonium hydrosulfide clouds"],
      [6, "Water clouds"],
    ],
  },
  sudarskyII: {
    palette: ["#f4f6f8", "#dbe3ec", "#ffffff", "#c9d5e2", "#eef2f6"],
    layers: [
      [1, "Water ice clouds"],
      [10, "Deep water clouds"],
    ],
  },
  sudarskyIII: {
    palette: ["#5a8fd8", "#4a7fcc", "#6b9fe0", "#3f73bf", "#5687d2"],
    layers: [[100, "Clear sky down to a deep haze"]],
  },
  sudarskyIV: {
    palette: ["#2d2a2e", "#3a3438", "#252226", "#433b3f", "#302b2f"],
    layers: [
      [1, "Sodium and potassium vapor"],
      [100, "Silicate cloud deck, deep"],
    ],
  },
  sudarskyV: {
    palette: ["#7a2e1f", "#a3422a", "#5e2318", "#c05a35", "#8a3524"],
    layers: [
      [0.5, "Silicate clouds"],
      [10, "Iron clouds"],
    ],
  },
  iceGiant: {
    palette: ["#7fd3e6", "#5fb7d6", "#8fe0ee", "#4fa0c8", "#79c9e0"],
    layers: [
      [1.5, "Methane ice clouds"],
      [8, "Hydrogen sulfide clouds"],
      [200, "Water and ammonia, deep"],
    ],
  },
  brownDwarf: {
    palette: ["#6b2a3a", "#8a3446", "#5a2232", "#9c4152", "#73303f"],
    aurora: true,
    layers: [
      [3, "Upper haze"],
      [30, "Silicate cloud deck"],
      [200, "Iron cloud deck"],
    ],
  },
};
// Each nebula kind's three cloud colors (the Survey Log's nebula art).
export const NEBULA_ART: Readonly<Record<NebulaKindId, readonly [string, string, string]>> = {
  molecularCloud: ["#3b3f52", "#5b5168", "#2a2d3a"],
  emissionNebula: ["#e0607e", "#f29bb0", "#9b3d6a"],
  planetaryNebula: ["#4fc3c7", "#8be0d0", "#2f7f9a"],
  supernovaRemnant: ["#f0a35a", "#7fb2f0", "#c8506a"],
};

// ============================================================================
// The pressure column: dive depth against the crush rating
// ============================================================================

// The crush rating's bar scale (the signed-off v3 mockup's arithmetic: the reference Galileo-Class Probe, rating 1,
// is "90 bar at Jupiter gravity", and it dives to 90 x the giant's depth factor, e.g. "~128 bar" at x1.42). Words and
// drawing only: the engine's dive bonus reads the same rating x depth factor product (gasGiantStudy.ts studyDiveBonus).
export const GALILEO_CRUSH_BAR_PER_RATING = 90;
// The real Galileo probe of 1995 reached about 22 bar in Jupiter (the column's reference line).
export const GALILEO_1995_BAR = 22;
// The column's scale: log bar from about 0.3 to 1,000 bar.
export const COLUMN_MIN_LOG = -0.5;
export const COLUMN_SPAN_LOG = 3.5;
export const COLUMN_MAX_BAR = 1000;

// Where `bar` sits down the column, 0 (top) to 1 (bottom). Pure.
export function columnFrac(bar: number): number {
  const v = Math.log10(Math.max(1e-6, Math.min(COLUMN_MAX_BAR, bar)));
  return Math.max(0, Math.min(1, (v - COLUMN_MIN_LOG) / COLUMN_SPAN_LOG));
}

// ============================================================================
// Chips
// ============================================================================

export type StudyChipTone = "plain" | "acc" | "ok" | "warn";
export interface StudyChip {
  text: string;
  tone: StudyChipTone;
  glyph: IconName | null;
}
function chip(text: string, tone: StudyChipTone = "plain", glyph: IconName | null = null): StudyChip {
  return { text, tone, glyph };
}

// ============================================================================
// Section 1: the study rows in the scan section
// ============================================================================

// "paused": the user's pickup pause (2026-10-23), the ship left the study to fly a pickup and will resume it.
export type StudyState = "queued" | "studying" | "paused" | "studied";

// The pause of `leg` under way at `now`, or null. Pure.
export function studyPauseAt(leg: Pick<GroundStudyLeg, "pauses">, now: number): { from: number; to: number } | null {
  return (leg.pauses ?? []).find((p) => p.from <= now && now < p.to) ?? null;
}

function legOf(exp: Pick<Expedition, "groundOps">, bodyIndex: number): GroundStudyLeg | undefined {
  return exp.groundOps?.studyLegs?.find((l) => l.bodyIndex === bodyIndex && l.nebula !== 1);
}
function sweepLegOf(exp: Pick<Expedition, "groundOps">): GroundStudyLeg | undefined {
  return exp.groundOps?.studyLegs?.find((l) => l.nebula === 1);
}
function legState(leg: GroundStudyLeg | undefined, now: number): StudyState {
  if (!leg) return "queued";
  if (leg.done || now >= leg.endsAt) return "studied";
  if (now < leg.startsAt) return "queued";
  return studyPauseAt(leg, now) ? "paused" : "studying";
}

// "Resumed after a pickup, progress kept" while a study runs again after a pause; null otherwise. Pure.
function resumedChip(leg: GroundStudyLeg | undefined, state: StudyState): StudyChip | null {
  if (!leg || state !== "studying") return null;
  const n = leg.pauses?.length ?? 0;
  return n === 0 ? null : chip(n === 1 ? "Resumed after a pickup, progress kept" : `Resumed after ${n} pickups, progress kept`, "plain", "check");
}

// The class def of an orbital body's frozen profile. Pure.
function classOf(exp: Pick<Expedition, "seed" | "bodies">, bodyIndex: number): { def: GiantClassDef; massMilliJ: number } {
  const p = bodyGiantProfile(exp, bodyIndex);
  return { def: giantClassById(p.classId) ?? GIANT_CLASSES[0], massMilliJ: p.massMilliJ };
}

export interface StudyBodyView {
  bodyIndex: number;
  letter: string;
  name: string; // "Ammonia-cloud giant, Sudarsky I"
  massText: string; // "2.40 Jupiter masses"
  state: StudyState;
  chips: StudyChip[];
}

// The study row of body `bodyIndex` (section 1, "d: Ammonia-cloud giant, Sudarsky I"), or null when it is not a study
// body of this run (every body of a run dispatched before GG-2, and every body with a surface). Pure.
export function studyBodyView(exp: Expedition, bodyIndex: number, now: number): StudyBodyView | null {
  const body = exp.bodies[bodyIndex];
  if (!body || !isStudyBody(exp, body)) return null;
  const { def, massMilliJ } = classOf(exp, bodyIndex);
  const leg = legOf(exp, bodyIndex);
  const state: StudyState = body.studied === true && !leg ? "studied" : legState(leg, now);
  const seconds = leg ? leg.endsAt - leg.startsAt : studySeconds(exp, body);
  const chips: StudyChip[] = [chip("Orbital: no ground objectives", "acc"), chip(`Ship study ${minText(seconds)}`, "acc", "research")];
  if (studyProbe(exp)) chips.push(chip("Galileo dive", "plain", "galileoProbe"));
  if (body.studied === true && !leg) chips.push(chip("Studied on an earlier trip", "ok", "check"));
  else if (state === "paused") chips.push(chip("Paused for a pickup", "warn", "pause"));
  else if (state === "studying") chips.push(chip("Studying now", "warn", "clock"), ...[resumedChip(leg, state)].filter((c): c is StudyChip => c !== null));
  else if (state === "studied") chips.push(chip("Studied", "ok", "check"));
  else chips.push(chip("Queued"));
  return { bodyIndex, letter: bodyDesignation(exp, bodyIndex), name: giantClassDisplayName(def), massText: massShortText(massMilliJ), state, chips };
}

// The lowest to highest band a kind's canisters can roll in ("Standard to Stellar canisters"). Pure.
export function bandRangeText(odds: BandOdds): string {
  const on = ITEM_BANDS.filter((b) => (odds[b] ?? 0) > 0);
  if (on.length === 0) return "No canisters";
  if (on.length === 1) return `${bandName(on[0])} canisters`;
  return `${bandName(on[0])} to ${bandName(on[on.length - 1])} canisters`;
}

export interface NebulaRowView {
  name: string; // "Emission nebula"
  sub: string;
  state: StudyState;
  chips: StudyChip[];
}

// The system's nebula row (section 1, a dashed row after the bodies), or null without one. Pure.
export function nebulaRowView(exp: Expedition, now: number): NebulaRowView | null {
  if (!exp.nebula) return null;
  const kind = nebulaKindById(exp.nebula.kindId) ?? NEBULA_KINDS[0];
  const leg = sweepLegOf(exp);
  const earlier = exp.nebula.swept === 1;
  const state: StudyState = earlier ? "studied" : legState(leg, now);
  // GG-7: the run's own sweep length (a Ramscoop Collector the run froze shortens it).
  const chips: StudyChip[] = [chip(`Nebula sweep ${minText(nebulaSweepSeconds(exp))}`, "acc", "nebula"), chip("No probe used"), chip(bandRangeText(kind.bandOdds))];
  if (earlier) chips.push(chip("Swept on an earlier trip", "ok", "check"));
  else if (state === "paused") chips.push(chip("Paused for a pickup", "warn", "pause"));
  else if (state === "studying") chips.push(chip("Sweeping now", "warn", "clock"), ...[resumedChip(leg, state)].filter((c): c is StudyChip => c !== null));
  else if (state === "studied") chips.push(chip("Swept", "ok", "check"));
  else chips.push(chip("Queued"));
  return { name: kind.name, sub: "system feature, swept after the bodies", state, chips };
}

// The run's study summary chips (section 1's top row, the launch preview's words): the bodies, the ship studies, the
// nebula sweep and "Studies need no squad". Empty on a run with neither. Pure.
// GG-6 review: a resumed run counts only what this trip still studies (a giant studied on an earlier trip and an
// already swept nebula are left out), and the mockup's "N ground objectives" chip shows once every body is scanned (the
// count is known only then).
export function studySummaryChips(exp: Pick<Expedition, "bodies" | "study" | "nebula">): StudyChip[] {
  const studies = exp.bodies.filter((b) => isStudyBody(exp, b) && b.studied !== true).length;
  const sweep = sweepsNebula(exp);
  if (studies === 0 && !sweep) return [];
  const out: StudyChip[] = [chip(plural(exp.bodies.length, "body", "bodies"))];
  if (exp.bodies.every((b) => b.scanned)) {
    const objectives = exp.bodies.reduce((a, b) => a + b.activities.length, 0);
    out.push(chip(plural(objectives, "ground objective", "ground objectives")));
  }
  if (studies > 0) out.push(chip(plural(studies, "ship study", "ship studies")));
  if (sweep) out.push(chip("1 nebula sweep"));
  out.push(chip("Studies need no squad", "ok"));
  return out;
}

// The launch preview's study chips from the telescope demand (detail 3, Per body). Empty when the system holds no
// study. Pure.
export function demandStudyChips(d: { shipStudies?: number; nebulaSweep?: 1 } | null): StudyChip[] {
  if (!d) return [];
  const studies = d.shipStudies ?? 0;
  if (studies === 0 && d.nebulaSweep !== 1) return [];
  const out: StudyChip[] = [];
  if (studies > 0) out.push(chip(plural(studies, "ship study", "ship studies"), "plain", "giant"));
  if (d.nebulaSweep === 1) out.push(chip("1 nebula sweep", "plain", "nebula"));
  out.push(chip("Studies need no squad", "ok"));
  return out;
}

// ============================================================================
// Section 1: the ship holding orbit
// ============================================================================

export interface StudyShipCardView {
  title: string; // "Ship holding orbit at OR-2817 d"
  lead: string; // "Studying the Ammonia-cloud giant."
  left: string; // "9 min left"
  tail: string; // "(study ends 1:13 into ground operations). The scan clock is paused while ..."
  chips: StudyChip[];
  waits: string[]; // "Survey team is heading back from b. Pickup waits for the ship: 9 min."
}

// The teams whose shuttle waits for leg `leg` (an ordinary return that docks at its end, longer than a shuttle). Pure.
function teamsWaitingOn(exp: Expedition, leg: GroundStudyLeg): number[] {
  const ops = exp.groundOps;
  if (!ops) return [];
  const out: number[] = [];
  for (const t of ops.teams) {
    if (t.step !== "return" || t.stepEndsAt !== leg.endsAt) continue;
    if (ops.shipLegs.some((l) => l.arrivesAt === t.stepEndsAt && (l.teamIndices ?? [l.teamIndex]).includes(t.index))) continue;
    if (t.stepEndsAt - t.stepStartedAt <= RETURN_SECONDS) continue;
    out.push(t.index);
  }
  return out;
}

// The body letter a team is coming back from (its objective's body), or null. Pure.
function teamBodyLetter(exp: Expedition, taskId: string | undefined): string | null {
  if (taskId === undefined) return null;
  const i = exp.bodies.findIndex((b) => b.activities.some((a) => a.id === taskId));
  return i >= 0 ? bodyDesignation(exp, i) : null;
}

// The "ship holding orbit" card while the ship is on a study or the nebula sweep, else null. `memberName` names the
// probe's diver (the away member's name). Pure.
export function studyShipCardView(
  exp: Expedition,
  ship: ShipInstance | null | undefined,
  now: number,
  memberName: (memberId: string) => string | null,
): StudyShipCardView | null {
  const ops = exp.groundOps;
  if (!ops || ops.endedAt !== undefined) return null;
  const pos = groundShipPosition(exp, now);
  if (pos.kind === "recovery" && pos.leg.studyPause === 1) return pausedCardView(exp, ship, now, pos.leg);
  if (pos.kind !== "study") return null;
  const leg = pos.leg;
  // GG-6 review: a resumed run's startedAt sits its clock skip before the window opened.
  const start = (ops.startedAt ?? leg.startsAt) + (ops.scanClockSkip ?? 0);
  const ends = clockText(leg.endsAt - start);
  const scanNote = leg.scanBodyIndex !== null ? "The scan clock is paused while the ship holds orbit; teams keep working." : "Every body is scanned; teams keep working.";
  const waits = teamsWaitingOn(exp, leg).map((ti) => {
    const team = ops.teams.find((t) => t.index === ti);
    const from = team ? teamBodyLetter(exp, team.taskId) : null;
    return `${runTeamName(ship, ti)} ${from ? `is heading back from ${from}` : "is heading back"}. Pickup waits for the ship: ${minText(Math.ceil((leg.endsAt - now) / 60) * 60)}.`;
  });
  if (leg.nebula === 1) {
    const kind = exp.nebula ? nebulaKindById(exp.nebula.kindId) : undefined;
    const name = kind ? kind.name.toLowerCase() : "nebula";
    return {
      title: `Ship sweeping the ${name}`,
      lead: `Sweeping the ${name} with the ship's collectors.`,
      left: minLeftText(leg.endsAt, now),
      tail: `(the sweep ends ${ends} into ground operations). ${scanNote}`,
      chips: [chip("No probe used"), chip(bandRangeText((kind ?? NEBULA_KINDS[0]).bandOdds))],
      waits,
    };
  }
  const { def } = classOf(exp, leg.bodyIndex);
  const body = exp.bodies[leg.bodyIndex];
  const chips: StudyChip[] = [];
  const probe = studyProbe(exp);
  if (probe) {
    const who = memberName(probe.memberId);
    chips.push(chip(`Galileo-Class Probe${who ? `, ${who} (Science)` : ""}`, "plain", "galileoProbe"));
  } else chips.push(chip("No Galileo-Class Probe aboard: studying from orbit"));
  const pace = body ? fieldworkSpeedMult(exp, body.planetType) : 1;
  if (pace !== 1) chips.push(chip(`Fieldwork x${pace.toFixed(2)}`));
  return {
    title: `Ship holding orbit at ${exp.systemName} ${bodyDesignation(exp, leg.bodyIndex)}`,
    lead: `Studying the ${def.name}.`,
    left: minLeftText(leg.endsAt, now),
    tail: `(study ends ${ends} into ground operations). ${scanNote}`,
    chips,
    waits,
  };
}

// The user's pickup pause (2026-10-23): the card while the ship has left its study (or the sweep) to fly a pickup:
// who it collects, when it arrives or is back, and how much of the study is left when it resumes. Pure.
function pausedCardView(exp: Expedition, ship: ShipInstance | null | undefined, now: number, pickup: { startsAt: number; arrivesAt: number; endsAt: number; bodyIndex: number; teamIndex: number; teamIndices?: number[]; pickup?: 1 }): StudyShipCardView | null {
  const study = (exp.groundOps?.studyLegs ?? []).find((l) => (l.pauses ?? []).some((p) => p.from === pickup.startsAt));
  if (!study) return null;
  const sweep = study.nebula === 1;
  const kind = sweep && exp.nebula ? nebulaKindById(exp.nebula.kindId) : undefined;
  const what = sweep ? `sweep of the ${kind ? kind.name.toLowerCase() : "nebula"}` : `study of the ${classOf(exp, study.bodyIndex).def.name}`;
  const who = (pickup.teamIndices ?? [pickup.teamIndex]).map((i) => runTeamName(ship, i)).join(" and ");
  const later = (study.pauses ?? []).filter((p) => p.from >= pickup.endsAt).reduce((a, p) => a + (p.to - p.from), 0);
  const remaining = Math.max(0, study.endsAt - pickup.endsAt - later);
  const flying = now < pickup.arrivesAt;
  return {
    title: `${sweep ? "Sweep" : "Study"} paused for a pickup`,
    lead: `The ship left its ${what} to collect ${who} at ${bodyDesignation(exp, pickup.bodyIndex)}.`,
    left: flying ? `arrives in ${minText(Math.ceil((pickup.arrivesAt - now) / 60) * 60)}` : `back in ${minText(Math.ceil((pickup.endsAt - now) / 60) * 60)}`,
    tail: `It resumes where it left off: ${minText(remaining)} of the ${sweep ? "sweep" : "study"} remain, nothing lost.`,
    chips: [chip("Paused for a pickup", "warn", "pause"), chip("Progress kept", "ok", "check")],
    waits: [],
  };
}

// ============================================================================
// Section 1: the ship legs and the return forecast
// ============================================================================

export interface StudyLegRow {
  key: string;
  label: string; // "Scan b, c, d", "Study d", "Nebula sweep"
  study: boolean; // a study or the sweep (drawn bold)
  when: string; // "0:00 to 0:55", "from 1:13, under way", "after its scan, about 18 min"
  then: string | null; // "then pick up Survey team"
  current: boolean;
}
export interface StudyLegsView {
  rows: StudyLegRow[];
  forecast: string;
}

export type StudyScanReader = (exp: Expedition) => { bodies: { bodyIndex: number; startsAt: number; endsAt: number | null }[] };

// The teams a finished or running study picked up at its end (a shuttle that waited for it). Pure.
function pickedUpAt(exp: Expedition, leg: GroundStudyLeg): number[] {
  const ops = exp.groundOps;
  if (!ops) return [];
  const out = new Set<number>(teamsWaitingOn(exp, leg));
  for (const r of ops.history) {
    if (r.step !== "return" || r.recovered || r.stopped || r.endedAt !== leg.endsAt) continue;
    if (r.endedAt - r.startedAt <= RETURN_SECONDS) continue;
    out.add(r.teamIndex);
  }
  return [...out].sort((a, b) => a - b);
}

// What a study row adds after its times: the user's pickup pauses ("paused 1:40 to 1:50 for a pickup") and the
// teams an old run's waiting shuttles boarded at its end ("then pick up Alpha"). Null with neither. Pure.
function legThen(leg: GroundStudyLeg, picked: string[], start: number): string | null {
  const parts = (leg.pauses ?? []).map((p) => `paused ${clockText(p.from - start)} to ${clockText(p.to - start)} for a pickup`);
  if (picked.length > 0) parts.push(`then pick up ${picked.join(" and ")}`);
  return parts.length > 0 ? parts.join("; ") : null;
}

// The canisters the run's studies and sweep can return, and the forecast line ("On return (forecast): 15 to 31
// canisters from the two studies, 30 to 60 from the sweep, research data at 40% per study, a Survey Log readout at
// 15%."). Every number is the engine's (studyCanisterRange, nebulaCanisterRange, the two odds). Pure.
export function studyForecastText(exp: Expedition): string {
  const parts: string[] = [];
  let lo = 0;
  let hi = 0;
  let n = 0;
  exp.bodies.forEach((b, i) => {
    if (!isStudyBody(exp, b) || b.studied === true) return;
    const [a, z] = studyCanisterRange(exp, i);
    lo += a;
    hi += z;
    n += 1;
  });
  if (n > 0) parts.push(`${lo} to ${hi} canisters from the ${n === 1 ? "study" : `${countWord(n)} studies`}`);
  if (sweepsNebula(exp)) {
    const [a, z] = nebulaCanisterRange(exp);
    parts.push(n > 0 ? `${a} to ${z} from the sweep` : `${a} to ${z} canisters from the sweep`);
  }
  if (parts.length === 0) return "";
  parts.push(`research data at ${permilleText(STUDY_RESEARCH_DATA_PERMILLE)} per study`, `a Survey Log readout at ${permilleText(STUDY_SURVEY_READOUT_PERMILLE)}`);
  return `On return (forecast): ${parts.join(", ")}.`;
}

// The ship legs card (section 1, right): the scans (consecutive ones merged), each study with the teams it picks up,
// the nebula sweep, and what is still to come; then the return forecast. Null on a run with no study and no sweep.
// `scan` is expedition.ts flaggedScanTimeline (passed in so this module never imports the engine's expedition.ts). Pure.
export function studyLegsView(exp: Expedition, ship: ShipInstance | null | undefined, now: number, scan: StudyScanReader): StudyLegsView | null {
  const ops = exp.groundOps;
  const hasStudy = exp.bodies.some((b) => isStudyBody(exp, b));
  if (!ops || ops.startedAt === undefined || (!hasStudy && !exp.nebula)) return null;
  const start = ops.startedAt + (ops.scanClockSkip ?? 0);
  const legs = (ops.studyLegs ?? []).slice().sort((a, b) => a.startsAt - b.startsAt);
  // Scan spans, each started after any study it overlaps at its start.
  type Item = { kind: "scan"; letters: string[]; from: number; to: number | null } | { kind: "study"; leg: GroundStudyLeg };
  const items: Item[] = [];
  const spans = scan(exp).bodies.map((s) => {
    let from = s.startsAt;
    for (const l of legs) if (l.startsAt <= from && from < l.endsAt) from = l.endsAt;
    return { ...s, startsAt: from };
  });
  const timeline: ({ at: number; scan: (typeof spans)[number] } | { at: number; leg: GroundStudyLeg })[] = [
    ...spans.map((s) => ({ at: s.startsAt, scan: s })),
    ...legs.map((l) => ({ at: l.startsAt, leg: l })),
  ].sort((a, b) => a.at - b.at || ("leg" in a ? 1 : 0) - ("leg" in b ? 1 : 0));
  for (const t of timeline) {
    if ("leg" in t) {
      items.push({ kind: "study", leg: t.leg });
      continue;
    }
    const last = items[items.length - 1];
    const letter = bodyDesignation(exp, t.scan.bodyIndex);
    if (last && last.kind === "scan" && last.to !== null) {
      last.letters.push(letter);
      last.to = t.scan.endsAt;
    } else items.push({ kind: "scan", letters: [letter], from: t.scan.startsAt, to: t.scan.endsAt });
  }
  const rows: StudyLegRow[] = items.map((it, k) => {
    if (it.kind === "scan") {
      const label = `Scan ${it.letters.join(", ")}`;
      return {
        key: `scan-${k}`,
        label,
        study: false,
        when: it.to === null ? `from ${clockText(it.from - start)}, under way` : `${clockText(it.from - start)} to ${clockText(it.to - start)}`,
        then: null,
        current: it.to === null && ops.endedAt === undefined && groundShipPosition(exp, now).kind === "scanning",
      };
    }
    const leg = it.leg;
    const teams = pickedUpAt(exp, leg);
    const current = leg.startsAt <= now && now < leg.endsAt && !leg.done;
    return {
      key: leg.nebula === 1 ? "sweep" : `study-${leg.bodyIndex}`,
      label: leg.nebula === 1 ? "Nebula sweep" : `Study ${bodyDesignation(exp, leg.bodyIndex)}`,
      study: true,
      when: current ? `${clockText(leg.startsAt - start)} to ${clockText(leg.endsAt - start)}, under way` : `${clockText(leg.startsAt - start)} to ${clockText(leg.endsAt - start)}`,
      then: legThen(leg, teams.map((i) => runTeamName(ship, i)), start),
      current,
    };
  });
  // What is still to come: the scans not started, the studies not stored yet, the sweep.
  const scanned = new Set(spans.map((s) => s.bodyIndex));
  const ahead = exp.bodies.map((_, i) => i).filter((i) => !scanned.has(i) && i >= (exp.resume?.scannedBodies ?? 0));
  if (ahead.length > 0) rows.push({ key: "scan-ahead", label: `Scan ${ahead.map((i) => bodyDesignation(exp, i)).join(", ")}`, study: false, when: "next", then: null, current: false });
  exp.bodies.forEach((b, i) => {
    if (!isStudyBody(exp, b) || b.studied === true || legOf(exp, i)) return;
    rows.push({ key: `study-${i}-ahead`, label: `Study ${bodyDesignation(exp, i)}`, study: true, when: `after its scan, about ${minText(studySeconds(exp, b))}`, then: null, current: false });
  });
  if (sweepsNebula(exp) && !sweepLegOf(exp)) {
    rows.push({ key: "sweep-ahead", label: "Nebula sweep", study: true, when: `after the last body, ${minText(nebulaSweepSeconds(exp))}`, then: null, current: false });
  }
  return { rows, forecast: studyForecastText(exp) };
}

// ============================================================================
// Section 2: the gas giant body card
// ============================================================================

export interface GiantOddsRow {
  id: GasCanisterId;
  name: string; // "Hydrogen"
  band: ItemBand;
  bandText: string; // "standard"
  glyph: IconName;
  chanceText: string; // "49.5%"
}
export interface GiantCardView {
  bodyIndex: number;
  tabLabel: string; // "d: Ammonia-cloud giant"
  designation: string; // "OR-2817 d"
  name: string; // "Ammonia-cloud giant, Sudarsky I"
  classId: GiantClassId;
  art: GiantArt;
  feature: string;
  kv: { label: string; value: string; mono: boolean }[];
  star: StarBarView;
  bands: { band: ItemBand; pct: number; name: string }[];
  bandsText: string; // "Standard 66% · Augmented 26% · Stellar 6% · Radiant 2%"
  column: {
    layers: { frac: number; label: string }[];
    ticks: { frac: number; label: string }[];
    galileoFrac: number;
    diveFrac: number | null;
    diveText: string | null; // "Dive depth ~128 bar"
    ariaLabel: string;
  };
  probeRows: { label: string; value: string }[];
  haulText: string; // "8 to 17 canisters"
  haulNote: string; // "with the Galileo dive; 5 to 10 from orbit only"
  odds: GiantOddsRow[];
  oddsNote: string;
}

const CANISTER_SHORT: Readonly<Record<GasCanisterId, string>> = {
  hydrogenCanister: "Hydrogen",
  methaneCanister: "Methane",
  ammoniaCanister: "Ammonia",
  deuteriumCanister: "Deuterium",
  helium3Canister: "Helium-3",
  antimatterCell: "Antimatter cell",
};

// The chance one canister is each gas: its band's odds x its weight within the band. Pure.
export function canisterChances(odds: BandOdds, weights: CanisterWeights): Record<GasCanisterId, number> {
  const out = {} as Record<GasCanisterId, number>;
  const total = ITEM_BANDS.reduce((a, b) => a + Math.max(0, odds[b]), 0) || 1;
  for (const band of ITEM_BANDS) {
    const ids = canistersInBand(band);
    const sum = ids.reduce((a, id) => a + Math.max(0, weights[id]), 0);
    for (const id of ids) out[id] = sum > 0 ? (Math.max(0, odds[band]) / total) * (Math.max(0, weights[id]) / sum) * 100 : 0;
  }
  for (const id of GAS_CANISTER_IDS) out[id] ??= 0;
  return out;
}

// The bands of an odds row with their percents, and the line under the bar. Pure.
export function bandBarView(odds: BandOdds): { bands: { band: ItemBand; pct: number; name: string }[]; text: string } {
  const bands = ITEM_BANDS.map((band) => ({ band, pct: Math.max(0, odds[band]), name: bandName(band) }));
  return { bands, text: bands.map((b) => `${b.name} ${b.pct}%`).join(" · ") };
}

// The canister haul from orbit only (no probe): the base range x the tier haul. Pure.
export function orbitCanisterRange(exp: Pick<Expedition, "region">): [number, number] {
  const scale = tierHaulMult(exp.region);
  return [Math.floor(STUDY_CANISTERS_MIN * scale), Math.ceil(STUDY_CANISTERS_MAX * scale)];
}

// The body card of orbital body `bodyIndex` (section 2), or null when it is not a study body. Pure.
export function giantCardView(exp: Expedition, bodyIndex: number): GiantCardView | null {
  const body = exp.bodies[bodyIndex];
  if (!body || !isStudyBody(exp, body)) return null;
  const profile = bodyGiantProfile(exp, bodyIndex);
  const def = giantClassById(profile.classId) ?? GIANT_CLASSES[0];
  const phys = giantPhysics(def, profile.massMilliJ);
  const depth = giantDepthFactor(profile);
  const probe = studyProbe(exp);
  const letter = bodyDesignation(exp, bodyIndex);
  const art = GIANT_ART[def.id];
  // GG-7: the run's own band odds (a Resonance Sensor Array the run froze lifts them).
  const bandOdds = studyBandOdds(exp, def);
  const band = bandBarView(bandOdds);
  // The column.
  const crushBar = probe ? GALILEO_CRUSH_BAR_PER_RATING * probe.diveRating : null;
  const diveBar = crushBar !== null ? crushBar * depth : null;
  const ticks = [1, 10, 100, 1000].map((b) => ({ frac: columnFrac(b), label: `${b.toLocaleString("en-US")} bar` }));
  // The probe rows.
  const seconds = studySeconds(exp, body);
  const pace = fieldworkSpeedMult(exp, body.planetType);
  const studyWho = probe ? "with Science crew and probe" : "with Science crew";
  const studyTime = pace === 1 ? `${minText(STUDY_BASE_SECONDS)} (no Science fieldwork aboard to speed it)` : `${minText(STUDY_BASE_SECONDS)} base, ${minText(seconds)} ${studyWho} (fieldwork line)`;
  const without = ancientFragmentPermille(exp, 0);
  const ancient = probe
    ? `Fragment ${permilleText(ancientFragmentPermille(exp, probe.relicRating))} with probe, ${permilleText(without)} without (relic find line)`
    : `Fragment ${permilleText(without)} from orbit; a Galileo-Class Probe's relic find line raises it`;
  const probeRows = [
    { label: "Crush rating", value: crushBar !== null ? `${Math.round(crushBar)} bar at Jupiter gravity (hazard resist line)` : "No Galileo-Class Probe aboard: no dive" },
    { label: "Depth factor", value: `x${depth.toFixed(2)} from gravity` },
    { label: "Study time", value: studyTime },
    { label: "Ancient data", value: ancient },
  ];
  const [dlo, dhi] = studyCanisterRange(exp, bodyIndex);
  const [olo, ohi] = orbitCanisterRange(exp);
  const chances = canisterChances(bandOdds, def.itemWeights);
  const odds: GiantOddsRow[] = GAS_CANISTER_IDS.map((id) => ({
    id,
    name: CANISTER_SHORT[id],
    band: ITEMS[id]?.band ?? "standard",
    bandText: ITEMS[id]?.band ?? "standard",
    glyph: id === "antimatterCell" ? "antimatterCell" : "gasCanister",
    chanceText: `${Math.round(chances[id] * 10) / 10}%`,
  }));
  return {
    bodyIndex,
    tabLabel: `${letter}: ${def.name}`,
    designation: `${exp.systemName} ${letter}`,
    name: giantClassDisplayName(def),
    classId: def.id,
    art,
    feature: `${def.feature}.`,
    kv: [
      { label: "Mass", value: massText(profile.massMilliJ), mono: true },
      { label: "Radius", value: `${phys.radiusRj.toFixed(2)} Jupiter radii`, mono: true },
      { label: "Density", value: `${phys.densityGcm3.toFixed(2)} g/cm3 (water is 1)`, mono: true },
      { label: "Gravity", value: `${phys.gravityRel.toFixed(2)} x Jupiter, cloud tops`, mono: true },
      { label: "Temperature", value: def.temperature, mono: false },
      { label: "Like", value: def.example, mono: false },
    ],
    star: starBarView(profile.massMilliJ),
    bands: band.bands,
    bandsText: band.text,
    column: {
      layers: art.layers.map(([bar, label]) => ({ frac: columnFrac(bar), label })),
      ticks,
      galileoFrac: columnFrac(GALILEO_1995_BAR),
      diveFrac: diveBar !== null ? columnFrac(diveBar) : null,
      // GG-6 review: the drawn line stops at the column's floor (columnFrac clamps); the words print the real depth,
      // which keeps growing with a better probe (D23, never capped).
      diveText: diveBar !== null ? `Dive depth ~${Math.round(diveBar).toLocaleString("en-US")} bar` : null,
      ariaLabel:
        diveBar !== null
          ? `Pressure column: the probe dives to about ${Math.round(diveBar)} bar; the 1995 Galileo probe reached ${GALILEO_1995_BAR} bar.`
          : `Pressure column: no probe dives; the 1995 Galileo probe reached ${GALILEO_1995_BAR} bar.`,
    },
    probeRows,
    haulText: probe ? `${dlo} to ${dhi} canisters` : `${olo} to ${ohi} canisters`,
    haulNote: probe ? `with the Galileo dive; ${olo} to ${ohi} from orbit only` : "from orbit only (a Galileo-Class Probe dives for more)",
    odds,
    oddsNote: `Chance per canister. Plus, rolled apart: research data ${permilleText(STUDY_RESEARCH_DATA_PERMILLE)}, Survey Log readout ${permilleText(STUDY_SURVEY_READOUT_PERMILLE)}.`,
  };
}

// The body cards of a run's study bodies, body order. Pure.
export function giantCardsView(exp: Expedition): GiantCardView[] {
  const out: GiantCardView[] = [];
  exp.bodies.forEach((_, i) => {
    const v = giantCardView(exp, i);
    if (v) out.push(v);
  });
  return out;
}

// ============================================================================
// Study results (each finished study's haul) and the claim line
// ============================================================================

export interface StudyResultRow {
  key: string;
  where: string; // "OR-2817 d, Ammonia-cloud giant" | "Emission nebula sweep"
  canisters: { id: string; label: string; qty: number; glyph: IconName }[];
  extras: string[]; // "Propulsion Data x1 (to the Research Lab)", "Ancient Data Fragment x1", "Survey Log readout"
}

function isStudyFinding(f: ExpeditionFinding): boolean {
  return f.source === "study";
}

// The haul of every finished study and sweep of `exp`, finding order. Pure.
export function studyResultsView(exp: Pick<Expedition, "id" | "findings" | "bodies" | "seed" | "systemName" | "region" | "nebula">): StudyResultRow[] {
  const out: StudyResultRow[] = [];
  const prefix = `${exp.id}-find-study-`;
  for (const f of exp.findings) {
    if (!isStudyFinding(f)) continue;
    let where = "Ship study";
    if (f.id === `${exp.id}-find-nebula`) {
      const kind = exp.nebula ? nebulaKindById(exp.nebula.kindId) : undefined;
      where = `${kind ? kind.name : "Nebula"} sweep`;
    } else if (f.id.startsWith(prefix)) {
      const i = Number(f.id.slice(prefix.length));
      if (Number.isInteger(i) && exp.bodies[i]) {
        const p = bodyGiantProfile(exp, i);
        where = `${exp.systemName} ${bodyDesignation(exp, i)}, ${giantClassById(p.classId)?.name ?? "giant"}`;
      }
    }
    const canisters: StudyResultRow["canisters"] = [];
    const extras: string[] = [];
    for (const [id, qty] of Object.entries(f.materials ?? {})) {
      if (!(qty > 0)) continue;
      if ((GAS_CANISTER_IDS as readonly string[]).includes(id)) canisters.push({ id, label: ITEMS[id]?.label ?? id, qty, glyph: id === "antimatterCell" ? "antimatterCell" : "gasCanister" });
      else extras.push(`${ITEMS[id]?.label ?? id} x${qty}${id === ANCIENT_DATA_FRAGMENT_ID || ITEMS[id]?.category === "researchData" ? " (to the Research Lab)" : ""}`);
    }
    if (f.survey) extras.push("Survey Log readout");
    out.push({ key: f.id, where, canisters, extras });
  }
  return out;
}

// The claim's study line for the log, or null when the claim held no study. GG-6 review: the "Findings claimed" line
// already lists every canister and data item, so this line only says what the studies were and where the data goes:
// "Ship studies: 2 gas giants and 1 nebula sweep; research data goes to the Research Lab's Data study tab; 1 Survey Log
// readout." The readout clause appears only while the Survey Log tab is live (SURVEY_LOG_LIVE). Pure.
export function studyClaimLine(findings: readonly ExpeditionFinding[]): string | null {
  const studies = findings.filter(isStudyFinding);
  if (studies.length === 0) return null;
  const sweeps = studies.filter((f) => f.id.endsWith("-find-nebula")).length;
  const giants = studies.length - sweeps;
  const what: string[] = [];
  if (giants > 0) what.push(plural(giants, "gas giant", "gas giants"));
  if (sweeps > 0) what.push(plural(sweeps, "nebula sweep", "nebula sweeps"));
  const parts = [what.join(" and ")];
  const data = studies.some((f) => Object.entries(f.materials ?? {}).some(([id, q]) => q > 0 && ITEMS[id]?.category === "researchData"));
  if (data) parts.push("research data goes to the Research Lab's Data study tab");
  const readouts = studies.filter((f) => f.survey).length;
  if (SURVEY_LOG_LIVE && readouts > 0) parts.push(plural(readouts, "Survey Log readout", "Survey Log readouts"));
  return `Ship studies: ${parts.join("; ")}.`;
}

// ============================================================================
// The Gas Storage Canisters shelf (warehouse section 5)
// ============================================================================

export interface CanisterDetailView {
  id: GasCanisterId;
  label: string;
  band: ItemBand;
  bandText: string;
  flavor: string;
  source: string; // "Gas giant study, nebula sweep, Refinery: Deuterium Ice x10 to 1 canister"
  usedIn: string; // the blueprints whose recipe takes it, or "Sold at the Quartermaster for now"
  sellValue: number | null;
  refinery: string | null; // "Refinery: Deuterium Ice x10 to Deuterium Canister x1"
}

// Can any nebula kind's sweep return this canister (its band has odds and it has weight)? Pure.
function nebulaYields(id: GasCanisterId): boolean {
  const band = ITEMS[id]?.band;
  if (!band) return false;
  return NEBULA_KINDS.some((k: NebulaKindDef) => (k.bandOdds[band] ?? 0) > 0 && (k.itemWeights[id] ?? 0) > 0);
}

// The canister's detail card: its source (read off the class and kind tables and the Refinery recipes), what uses it
// (read off every blueprint recipe), and its sell value. Pure.
export function canisterDetailView(id: GasCanisterId): CanisterDetailView {
  const item = ITEMS[id];
  const sources = ["Gas giant study"];
  if (nebulaYields(id)) sources.push("nebula sweep");
  let refinery: string | null = null;
  for (const r of Object.values(REFINE_RECIPES)) {
    if (r.output.itemId !== id) continue;
    const ins = Object.entries(r.input).map(([iid, amt]) => `${ITEMS[iid]?.label ?? iid} x${amt.toString()}`);
    refinery = `Refinery: ${ins.join(", ")} to ${item?.label ?? id} x${r.output.amount.toString()}`;
    sources.push(`Refinery: ${ins.join(", ")} to 1 canister`);
  }
  const users = Object.values(BLUEPRINTS)
    .filter((bp) => (bp.recipe?.inputs?.[id] ?? 0) > 0)
    .map((bp) => bp.label);
  const source = id === "antimatterCell" ? "Gas giant study only (nebulae hold none)" : sources.join(", ");
  return {
    id,
    label: item?.label ?? id,
    band: item?.band ?? "standard",
    bandText: item?.band ?? "standard",
    flavor: item?.flavor ?? "",
    source,
    usedIn: users.length > 0 ? users.join(", ") : "No recipe takes it yet; it sells at the Quartermaster",
    sellValue: item?.sellValue ?? null,
    refinery,
  };
}

// ============================================================================
// The Survey Log (the Archive tab)
// ============================================================================

export interface SurveyGroupView {
  key: string; // the class or kind id
  label: string; // "Ammonia-cloud giant, Sudarsky I" | "Emission nebula"
  count: number;
  entries: { id: string; label: string; first: boolean }[]; // newest first
}

// Expedition Tiers G2-7 (user 2026-11-02, "Quiet derelict field (Recommended)": "Many old, unmarked hulls drift in loose
// formation; the crew holds a moment of silence. Unnamed and original ... no franchise names, no named ships or
// people."): the derelict field's words, the user's own, nothing added.
export const DERELICT_FIELD_NAME = "Derelict field";
export const DERELICT_FIELD_KV: readonly { label: string; value: string }[] = [
  { label: "Hulls", value: "Many, old and unmarked" },
  { label: "Drift", value: "In loose formation" },
];
export const DERELICT_FIELD_NOTE = "The crew held a moment of silence.";

// The claim's log line when the claim wrote the derelict field's entry (the Survey Log gained its derelict entry),
// else null. Pure.
export function derelictClaimLine(before: readonly SurveyLogEntry[] | undefined, after: readonly SurveyLogEntry[] | undefined): string | null {
  if ((before ?? []).some((e) => e.kind === "derelict")) return null;
  const entry = (after ?? []).find((e) => e.kind === "derelict");
  if (!entry) return null;
  return `${entry.systemName}: many old, unmarked hulls drift in loose formation. The crew held a moment of silence.${SURVEY_LOG_LIVE ? " Logged in the Survey Log." : ""}`;
}

// The Survey Log's groups: giants by class (GIANT_CLASSES order), then nebulae by kind, each with its count and its
// entries newest first; only groups with an entry. `first` marks each group's oldest entry ("first of its class"). Pure.
export function surveyLogGroups(entries: readonly SurveyLogEntry[]): SurveyGroupView[] {
  const groups: SurveyGroupView[] = [];
  const add = (key: string, label: string, list: SurveyLogEntry[]) => {
    if (list.length === 0) return;
    const sorted = [...list].sort((a, b) => b.at - a.at);
    const oldest = sorted[sorted.length - 1];
    groups.push({
      key,
      label,
      count: list.length,
      entries: sorted.map((e) => ({ id: e.id, label: e.kind === "giant" ? e.bodyName : e.systemName, first: e === oldest })),
    });
  };
  for (const c of GIANT_CLASSES) add(c.id, giantClassDisplayName(c), entries.filter((e) => e.kind === "giant" && e.classId === c.id));
  for (const k of NEBULA_KINDS) add(k.id, k.name, entries.filter((e) => e.kind === "nebula" && e.kindId === k.id));
  // Expedition Tiers G2-7: the derelict field (the Wolf 359 nod), after the nebulae. It is written once per save, so it
  // is never marked "first of its class".
  add("derelict", DERELICT_FIELD_NAME, entries.filter((e) => e.kind === "derelict"));
  const last = groups[groups.length - 1];
  if (last?.key === "derelict") for (const e of last.entries) e.first = false;
  return groups;
}

// The stellar life cycle a nebula entry sits on (NEBULA_KINDS stage 0 to 3).
export const NEBULA_STAGES = ["Nursery", "Young stars", "Dying sun-like star", "Exploded giant star"] as const;

export interface SurveyEntryView {
  id: string;
  title: string; // "OR-2817 d" | "OR-2817"
  subtitle: string; // "Ammonia-cloud giant, Sudarsky I · Tier II"
  first: boolean;
  kind: "giant" | "nebula" | "derelict";
  classId: GiantClassId | null;
  kindId: NebulaKindId | null;
  art: GiantArt | null;
  nebulaArt: readonly [string, string, string] | null;
  kv: { label: string; value: string; mono: boolean }[];
  star: StarBarView | null;
  stage: number | null; // the nebula's life-cycle stage
  stageNote: string | null;
  derelict: boolean; // G2-7: draw the derelict field's portrait (GiantArt's third drawing)
  note: string | null; // G2-7: the derelict field's closing line
}

// The entry card of `entry` (every number derived from its stored class and mass). Pure.
export function surveyEntryView(entry: SurveyLogEntry, all: readonly SurveyLogEntry[]): SurveyEntryView {
  const tier = `Tier ${regionTierNumeral(entry.tier)}`;
  if (entry.kind === "derelict") {
    return {
      id: entry.id,
      title: entry.systemName,
      subtitle: `${DERELICT_FIELD_NAME} · ${tier}`,
      first: false,
      kind: "derelict",
      classId: null,
      kindId: null,
      art: null,
      nebulaArt: null,
      kv: DERELICT_FIELD_KV.map((r) => ({ ...r, mono: false })),
      star: null,
      stage: null,
      stageNote: null,
      derelict: true,
      note: DERELICT_FIELD_NOTE,
    };
  }
  if (entry.kind === "giant") {
    const def = giantClassById(entry.classId) ?? GIANT_CLASSES[0];
    const phys = giantPhysics(def, entry.massMilliJ);
    const same = all.filter((e) => e.kind === "giant" && e.classId === entry.classId);
    const first = same.length > 0 && [...same].sort((a, b) => a.at - b.at)[0].id === entry.id;
    return {
      id: entry.id,
      title: entry.bodyName,
      subtitle: `${giantClassDisplayName(def)} · ${tier}`,
      first,
      kind: "giant",
      classId: def.id,
      kindId: null,
      art: GIANT_ART[def.id],
      nebulaArt: null,
      kv: [
        { label: "Mass", value: massText(entry.massMilliJ), mono: true },
        { label: "Radius", value: `${phys.radiusRj.toFixed(2)} Jupiter radii`, mono: true },
        { label: "Density", value: `${phys.densityGcm3.toFixed(2)} g/cm3 (water is 1)`, mono: true },
        { label: "Gravity", value: `${phys.gravityRel.toFixed(2)} x Jupiter, cloud tops`, mono: true },
        { label: "Main gases", value: def.gases, mono: false },
        { label: "Feature", value: `${def.feature}.`, mono: false },
      ],
      star: starBarView(entry.massMilliJ),
      stage: null,
      stageNote: null,
      derelict: false,
      note: null,
    };
  }
  const kind = nebulaKindById(entry.kindId) ?? NEBULA_KINDS[0];
  const same = all.filter((e) => e.kind === "nebula" && e.kindId === entry.kindId);
  const first = same.length > 0 && [...same].sort((a, b) => a.at - b.at)[0].id === entry.id;
  return {
    id: entry.id,
    title: entry.systemName,
    subtitle: `${kind.name} · ${tier}`,
    first,
    kind: "nebula",
    classId: null,
    kindId: kind.id,
    art: null,
    nebulaArt: NEBULA_ART[kind.id],
    kv: [
      { label: "Main gases", value: kind.gases, mono: false },
      { label: "Feature", value: `${kind.feature}.`, mono: false },
      { label: "Like", value: kind.example, mono: false },
    ],
    star: null,
    stage: kind.stage,
    stageNote: "Supernova and planetary nebula debris seeds the next molecular cloud, and the cycle starts again.",
    derelict: false,
    note: null,
  };
}

// The user (2026-10-23): the Survey Log needs its own mockup sign-off before it ships. Signed off 2026-10-27 ("Approve
// as built", with the selected card shown first on a phone), so the tab is live. The switch stays so the Archive tab
// list and the claim line read one place (archiveSubTabs, studyClaimLine).
export const SURVEY_LOG_LIVE = true;

// The Archive's sub-tabs in order: the Survey Log only while SURVEY_LOG_LIVE. Pure.
export type ArchiveSubTabKey = "archive" | "museum" | "surveyLog";
export function archiveSubTabs(live: boolean = SURVEY_LOG_LIVE): { key: ArchiveSubTabKey; label: string }[] {
  const tabs: { key: ArchiveSubTabKey; label: string }[] = [
    { key: "archive", label: "Archive" },
    { key: "museum", label: "Museum" },
  ];
  if (live) tabs.push({ key: "surveyLog", label: "Survey Log" });
  return tabs;
}

// The Survey Log's empty line (every readout is the study's 15% roll).
export const SURVEY_LOG_EMPTY = `No readouts yet. A ship's study of a gas giant or a nebula sweep writes an entry ${permilleText(STUDY_SURVEY_READOUT_PERMILLE)} of the time.`;

// The Survey Log's help line (the odds read from the engine's constant).
export const SURVEY_LOG_HELP = `When a ship studies a gas giant or sweeps a nebula, a Survey Log readout comes home ${permilleText(STUDY_SURVEY_READOUT_PERMILLE)} of the time. Each entry keeps the body's class and mass, so you can compare every giant you have studied.`;

// ============================================================================
// The warehouse
// ============================================================================

// Does the warehouse shelve this item? Research data does not (the signed-off v3 mockup, as drawn: "no research-data
// warehouse shelf"; it lives in the Research Lab's Data study tab), so its catalog counts leave it out. Pure.
export function onWarehouseShelf(itemId: string): boolean {
  return ITEMS[itemId]?.category !== "researchData";
}
