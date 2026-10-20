// G1-2 (Short-Range Missions, docs/plans/2026-10-17-short-range-missions-plan.md sections 3.2 to 3.7 and both USER
// ANSWERS sections): the PURE engine of a short-range mission. The template catalog, the requirement sheets, the roll,
// the training and slow-start rules, the cycle plan and the per-cycle reward. No board, dispatch, cycle loop or UI here
// (G1-3 to G1-6 build on these; shortRangeBoard.ts, G1-3, is the board and dispatch), so every existing run is
// untouched.
//
// What the user decided (2026-10-17 and 2026-10-19):
// - The WHOLE JOB re-rolls each run: a slot can draw any template every cycle (call 1).
// - ONE requirement sheet per tier covering ALL categories, judged against the picked ship (call 3), so a ship that
//   meets it once can take every roll: a roll never exceeds its sheet in any category (property-tested).
// - SIX categories: Range, Cargo, Guest quarters, Sensors, Engineering (the ship's Engineering crew strength as a
//   rating, call 4) and Security (the ship's Security crew strength as a rating, added for Prisoner Transport; small
//   at Tier I so a normally crewed ship passes).
// - SEVEN templates: the six of plan section 3.2 (labels kept, call 17) plus Prisoner Transport, which reads Guest
//   quarters + Security and pays about 20% more credits per hour than Refugee Relocation, still in the band.
// - After the training run, Tier I rolls grow on the slow-start curve (SF4: run 2 at 35%, run 6 about 54%, run 9
//   about 80%, full from run 11); no failure ever (call 9). Tier II rolls the full range from its first run (SF6).
// - The training run (the first roll of each template per save) is the template's smallest roll, carries the
//   "Training run" chip (its stamp's firstRun), no wear (G1-4 reads the stamp) and normal length through the tutorial
//   hook (call 10, SHORT_RANGE_TUTORIAL_TICKS_SCALE).
// - Destinations are generated with placeholder designations now; charted planets join later (call 12).
// - Rewards follow the mockup table at about 1,000 to 1,300 credits per hour at base (call 13). Relics are G1-5.
//
// Determinism: one roll = makeRng(shortRangeRollSeed(...)) with a FIXED draw layout (six draws, whatever the template),
// never the shared economy stream; whole-unit rounding draws from its own SHORT_RANGE_ROUNDING_SALT stream. Every
// number a roll, plan or reward returns is a pure function of its inputs.

import { makeRng, type Rng } from "./combat/rng";
import {
  FULL_HOLD_FRACTION,
  fullHoldUnloadTicksFor,
  outboundLegTicks,
  returnLegTicks,
  scaledUnloadTicks,
  type GameState,
  type RunDifficultyStamp,
  type ShipDerivedStats,
  type ShipInstance,
} from "./model";
import { LY_PER_TICK } from "./fuel";
import { rampEnemyScale, runDifficultyAt } from "./runDifficulty";
import { effectiveShipStats } from "./crewOverlay";
import { shipDivisionStrength } from "./gambit";
import { SURVEY_SENSOR_YIELD_COEFF, shipReachesRoundTrip, shipTripRangeLightYears } from "./tick";

// ===== vocabulary =====

// The template keys (stored in saves: runCounts.shortRange and the mission arm), in the FROZEN draw order the roll's
// first draw indexes. "prisonerTransport": the user named the job and approved the key (2026-10-20 "Approve").
export type ShortRangeTemplateKey =
  | "refugeeRelocation"
  | "supplyDropOff"
  | "supplyPickup"
  | "phenomenonSurvey"
  | "telescopeRepair"
  | "commBoosterBuild"
  | "prisonerTransport";
export const SHORT_RANGE_TEMPLATE_KEYS: readonly ShortRangeTemplateKey[] = [
  "refugeeRelocation",
  "supplyDropOff",
  "supplyPickup",
  "phenomenonSurvey",
  "telescopeRepair",
  "commBoosterBuild",
  "prisonerTransport",
];

// The sheet categories (call 4 plus Security).
export type ShortRangeCategory = "range" | "cargo" | "guests" | "sensors" | "engineering" | "security";
export const SHORT_RANGE_CATEGORIES: readonly ShortRangeCategory[] = ["range", "cargo", "guests", "sensors", "engineering", "security"];

export type ShortRangeTier = 1 | 2;

// An inclusive whole-number span a roll draws from.
export type ShortRangeSpan = readonly [lo: number, hi: number];

// What one template rolls at one tier: the one-way distance (whole lightyears) and the sizes the job uses. Exactly one
// PRIMARY size (guests: people aboard; units: cargo carried; scan: the Sensors the scan needs) and at most one
// SECONDARY size (engineering or security: the rating the job needs).
export interface ShortRangeSpans {
  distanceLy: ShortRangeSpan;
  guests?: ShortRangeSpan;
  units?: ShortRangeSpan;
  scan?: ShortRangeSpan;
  engineering?: ShortRangeSpan;
  security?: ShortRangeSpan;
}

// The on-site work: "passengers" (people disembark), "offload" / "load" (goods leave or join the hold), each scaled by
// its headcount or units like a mission unload; "scan" (ticks per scan point, shortened by Sensors) and "work" (ticks
// per Engineering point, shortened by the Engineering rating). homeUnload "goods": the hold comes home full of the
// job's units and unloads like a mission; "none": the short home turnaround only.
export interface ShortRangeWorkDef {
  site: "passengers" | "offload" | "load" | "scan" | "work";
  siteTicks: number;
  homeUnload: "goods" | "none";
}

// What one delivered cycle pays (call 13, the mockup table), plus the per-active-tick XP (integer rates: the
// closed-form parity trap, MissionDef.fleetAdminXpPerTick).
//   passengers : credits per person per lightyear (one way), by tier
//   supplyLoop : the supply-run loop: a load cost of units x supplyCostPerUnit is spent and returned plus the margin
//   pickup     : credits per unit by tier, plus the units themselves as `material` to the Warehouse
//   survey     : credits per scan point by tier, plus scan x unitsPerScan of `material`, scaled by today's survey
//                sensor yield rule (1 + sensors x SURVEY_SENSOR_YIELD_COEFF)
//   contract   : flat credits by tier
export type ShortRangeRewardDef = (
  | { kind: "passengers"; creditsPerPersonLy: Readonly<Record<ShortRangeTier, number>> }
  | { kind: "supplyLoop"; supplyCostPerUnit: Readonly<Record<ShortRangeTier, number>>; margin: number }
  | { kind: "pickup"; creditsPerUnit: Readonly<Record<ShortRangeTier, number>>; material: string }
  | { kind: "survey"; creditsPerScan: Readonly<Record<ShortRangeTier, number>>; material: string; unitsPerScan: number }
  | { kind: "contract"; credits: Readonly<Record<ShortRangeTier, number>> }
) & { captainXpPerTick: Readonly<Record<ShortRangeTier, number>>; fleetAdminXpPerTick: number };

// Which designation list a template's destination draws from (display only).
export type ShortRangeDestinationKind = "surface" | "lagrange" | "relay" | "nearby";

export interface ShortRangeTemplateDef {
  key: ShortRangeTemplateKey;
  label: string;
  destinations: ShortRangeDestinationKind;
  rolls: Readonly<Record<ShortRangeTier, ShortRangeSpans>>;
  work: ShortRangeWorkDef;
  reward: ShortRangeRewardDef;
}

// ===== the catalog (numbers approved by the user 2026-10-20; labels from plan 3.2, kept by call 17) =====

// Distances are the game's real lightyears: the mockup's 30 to 90 and 60 to 130 times LY_PER_TICK (0.5), which keeps
// the mockup's transit ticks exactly and lets a General Freighter's real 100 ly reach pass Tier I as it did there.
const TIER_I_DISTANCE: ShortRangeSpan = [15, 45];
const TIER_II_DISTANCE: ShortRangeSpan = [30, 65];
// XP per active tick: the people and contract jobs pay captain XP (the mockup's rows), the goods and survey jobs pay
// in materials instead.
const XP_JOB = { captainXpPerTick: { 1: 2, 2: 3 }, fleetAdminXpPerTick: 1 } as const;
const XP_GOODS = { captainXpPerTick: { 1: 1, 2: 2 }, fleetAdminXpPerTick: 1 } as const;

// Every number here in one named constant (user 2026-10-20 "Approve": prisoner groups 20 to 40 at Tier I and 40 to 70
// at Tier II; Supply Pickup pays Titanium Ore, commonOre; Phenomenon Survey pays Iridium Ore, rareMaterial).
export const SHORT_RANGE_TEMPLATES: Readonly<Record<ShortRangeTemplateKey, ShortRangeTemplateDef>> = {
  refugeeRelocation: {
    key: "refugeeRelocation",
    label: "Refugee Relocation",
    destinations: "surface",
    rolls: { 1: { distanceLy: TIER_I_DISTANCE, guests: [30, 60] }, 2: { distanceLy: TIER_II_DISTANCE, guests: [60, 100] } },
    work: { site: "passengers", siteTicks: 16, homeUnload: "none" },
    reward: { kind: "passengers", creditsPerPersonLy: { 1: 0.0285, 2: 0.016 }, ...XP_JOB },
  },
  supplyDropOff: {
    key: "supplyDropOff",
    label: "Supply Drop-off",
    destinations: "surface",
    rolls: { 1: { distanceLy: TIER_I_DISTANCE, units: [40, 90] }, 2: { distanceLy: TIER_II_DISTANCE, units: [90, 150] } },
    work: { site: "offload", siteTicks: 10, homeUnload: "none" },
    reward: { kind: "supplyLoop", supplyCostPerUnit: { 1: 3, 2: 3 }, margin: 0.2, ...XP_GOODS },
  },
  supplyPickup: {
    key: "supplyPickup",
    label: "Supply Pickup",
    destinations: "surface",
    rolls: { 1: { distanceLy: TIER_I_DISTANCE, units: [40, 90] }, 2: { distanceLy: TIER_II_DISTANCE, units: [90, 150] } },
    work: { site: "load", siteTicks: 10, homeUnload: "goods" },
    reward: { kind: "pickup", creditsPerUnit: { 1: 0.6, 2: 0.55 }, material: "commonOre", ...XP_GOODS },
  },
  phenomenonSurvey: {
    key: "phenomenonSurvey",
    label: "Phenomenon Survey",
    destinations: "nearby",
    rolls: { 1: { distanceLy: TIER_I_DISTANCE, scan: [6, 10] }, 2: { distanceLy: TIER_II_DISTANCE, scan: [14, 20] } },
    work: { site: "scan", siteTicks: 6, homeUnload: "none" },
    reward: { kind: "survey", creditsPerScan: { 1: 6, 2: 4.4 }, material: "rareMaterial", unitsPerScan: 0.5, ...XP_GOODS },
  },
  telescopeRepair: {
    key: "telescopeRepair",
    label: "Telescope Repair",
    destinations: "lagrange",
    rolls: {
      1: { distanceLy: TIER_I_DISTANCE, units: [20, 40], engineering: [2, 3] },
      2: { distanceLy: TIER_II_DISTANCE, units: [40, 80], engineering: [4, 5] },
    },
    work: { site: "work", siteTicks: 25, homeUnload: "none" },
    reward: { kind: "contract", credits: { 1: 50, 2: 80 }, ...XP_JOB },
  },
  commBoosterBuild: {
    key: "commBoosterBuild",
    label: "Comm Booster Build",
    destinations: "relay",
    rolls: {
      1: { distanceLy: TIER_I_DISTANCE, units: [50, 90], engineering: [2, 3] },
      2: { distanceLy: TIER_II_DISTANCE, units: [100, 150], engineering: [4, 5] },
    },
    work: { site: "work", siteTicks: 30, homeUnload: "none" },
    reward: { kind: "contract", credits: { 1: 52, 2: 82 }, ...XP_JOB },
  },
  prisonerTransport: {
    key: "prisonerTransport",
    label: "Prisoner Transport",
    destinations: "surface",
    rolls: {
      1: { distanceLy: TIER_I_DISTANCE, guests: [20, 40], security: [1, 1] },
      2: { distanceLy: TIER_II_DISTANCE, guests: [40, 70], security: [3, 4] },
    },
    work: { site: "passengers", siteTicks: 20, homeUnload: "none" },
    reward: { kind: "passengers", creditsPerPersonLy: { 1: 0.0504, 2: 0.0275 }, ...XP_JOB },
  },
};

// The requirement sheet per tier (call 3: one per tier, every category; user 2026-10-20: Range "90 / 130 ly" real
// light-years, round trip; Security 1 at Tier I and 4 at Tier II "Approve"). Range is the round trip in lightyears;
// Engineering and Security are crew ratings (shortRangeCrewRating). Each sheet sits at or above every roll its
// templates can make (the contract below), and is exactly the largest of them.
export const SHORT_RANGE_SHEETS: Readonly<Record<ShortRangeTier, Readonly<Record<ShortRangeCategory, number>>>> = {
  1: { range: 90, cargo: 90, guests: 60, sensors: 10, engineering: 3, security: 1 },
  2: { range: 130, cargo: 150, guests: 100, sensors: 20, engineering: 5, security: 4 },
};

// The crew rating curve (D23: concave, unbounded; user 2026-10-20 "Approve"): rating = perDoubling x log2(1 + strength /
// referenceStrength), so each doubling of a division's crew strength adds about `perDoubling`. A General Freighter's
// usual crew (5 Engineering, 1 or 2 Security) rates about 3.7 Engineering and 1.2 to 2.1 Security: Tier I's 3 and 1.
export const SHORT_RANGE_CREW_RATING = { perDoubling: 2, referenceStrength: 2 } as const;

// The cycle's work rules (one named constant; user 2026-10-20 "Approve"): the home turnaround's base ticks (the mission unload
// base, scaled by what comes home), and the Sensors and Engineering references the scan and the work divide by
// (1 + rating / reference), a D23 curve that never reaches zero.
export const SHORT_RANGE_WORK = { homeUnloadTicks: 8, sensorsReference: 20, engineeringReference: 4 } as const;

// The tutorial hook (call 10, the shakedown precedent): the training run's transit legs are scaled by this. EQUAL to
// the normal length for now (user: "a separate TUTORIAL duration constant set EQUAL to the normal one").
export const SHORT_RANGE_TUTORIAL_TICKS_SCALE = 1;

// ===== destinations and flavor (display only): the mockup's placeholder designations and phenomenon names (call 12,
// user 2026-10-20 "Approve"); flavor from the mockup =====

export const SHORT_RANGE_DESTINATIONS: Readonly<Record<ShortRangeDestinationKind, readonly string[]>> = {
  surface: ["Body II, desert world", "Body III, temperate world", "Body IV b, ice moon", "Body V a, ocean moon"],
  lagrange: ["Body III, L2 point", "Body IV, L2 point", "Body VI, L2 point"],
  relay: ["Body V, L4 trojan point", "Body III, L5 trojan point", "Body VI, high relay orbit"],
  nearby: ["Near Body V", "Near Body VI", "Near the outer belt"],
};

export const SHORT_RANGE_PHENOMENA: readonly string[] = [
  "Comet at perihelion",
  "Magnetar flare echo",
  "Interstellar object flyby",
  "Gas giant aurora",
  "Pulsar glitch",
];

// ===== seeds and salts =====

export const SHORT_RANGE_BOARD_SALT = 0x51a7e0b5;
export const SHORT_RANGE_ROLL_SALT = 0x2f6c9d83;
export const SHORT_RANGE_ROUNDING_SALT = 0x7d3b16e9;
// The board seed of a save with no stored homeworld (the EXPEDITION_DEFAULT_SEED precedent).
export const SHORT_RANGE_DEFAULT_SEED = 0x0c1a55e5;
// The slot mix in the roll seed (odd, so distinct slots land on distinct streams).
const SLOT_MIX = 0x9e3779b1;

// The board's seed: derived, never stored (plan 3.6). Pure.
export function shortRangeBoardSeed(state: Pick<GameState, "homeworld">): number {
  return state.homeworld ? (state.homeworld.seed ^ SHORT_RANGE_BOARD_SALT) >>> 0 : SHORT_RANGE_DEFAULT_SEED;
}

// The seed of one slot's roll at one cycle (plan 3.5). Pure.
export function shortRangeRollSeed(boardSeed: number, slotId: number, cycleIndex: number): number {
  return (boardSeed ^ SHORT_RANGE_ROLL_SALT ^ Math.imul(slotId, SLOT_MIX) ^ cycleIndex) >>> 0;
}

// ===== the roll =====

// One rolled job, frozen on the mission at the cycle start (offline == live by construction). The sizes a template
// does not use are absent.
export interface ShortRangeRoll {
  version: 1;
  seed: number; // this roll's stream seed (the rounding stream keys off it)
  slotId: number;
  cycleIndex: number;
  template: ShortRangeTemplateKey;
  tier: ShortRangeTier;
  destinationIndex: number;
  distanceLy: number; // one way, whole lightyears
  guests?: number;
  units?: number;
  scan?: number;
  engineering?: number;
  security?: number;
  flavorIndex: number;
  difficulty: RunDifficultyStamp; // firstRun = the training run ("Training run" chip, no wear)
}

export interface ShortRangeSlotRef {
  id: number;
  tier: ShortRangeTier;
}

// The share of each span a roll may reach under `stamp`: none on the training run (its smallest roll), else the
// slow-start curve's strength (runDifficulty.ts: RAMP_FLOOR 0.35 on run 2 to full from run 11 at Tier I; full at
// Tier II, whose stamp reads ramp 1). Pure.
export function shortRangeSpanShare(stamp: Pick<RunDifficultyStamp, "firstRun" | "ramp">): number {
  return stamp.firstRun ? 0 : rampEnemyScale(stamp.ramp);
}

// The highest value a span can roll at `share` (monotone in share, never above the span). Pure.
export function spanTop(span: ShortRangeSpan, share: number): number {
  const [lo, hi] = span;
  return lo + Math.round((hi - lo) * Math.min(1, Math.max(0, share)));
}

// The roll from an explicit stream: SIX draws, always in this order, whatever the template (a template change never
// shifts a later draw): template, destination, distance, primary size, secondary size (drawn and discarded when the
// template has none), flavor. `stampOf` gives the template's difficulty stamp (the training run and the curve). Pure
// with respect to the passed rng.
export function drawShortRangeJob(
  rng: Rng,
  seed: number,
  slot: ShortRangeSlotRef,
  cycleIndex: number,
  stampOf: (template: ShortRangeTemplateKey) => RunDifficultyStamp,
): ShortRangeRoll {
  const template = SHORT_RANGE_TEMPLATE_KEYS[rng.nextInt(SHORT_RANGE_TEMPLATE_KEYS.length)];
  const def = SHORT_RANGE_TEMPLATES[template];
  const spans = def.rolls[slot.tier];
  const difficulty = stampOf(template);
  const share = shortRangeSpanShare(difficulty);
  const draw = (span: ShortRangeSpan): number => rng.nextRange(span[0], spanTop(span, share));
  const destinationIndex = rng.nextInt(SHORT_RANGE_DESTINATIONS[def.destinations].length);
  const distanceLy = draw(spans.distanceLy);
  const sizes: Pick<ShortRangeRoll, "guests" | "units" | "scan" | "engineering" | "security"> = {};
  const primaryKey = PRIMARY_SIZES.find((k) => spans[k] !== undefined);
  const primarySpan = primaryKey ? spans[primaryKey] : undefined;
  if (!primaryKey || !primarySpan) throw new Error(`short-range template ${template} has no primary size`);
  sizes[primaryKey] = draw(primarySpan);
  const secondaryKey = SECONDARY_SIZES.find((k) => spans[k] !== undefined);
  const secondarySpan = secondaryKey ? spans[secondaryKey] : undefined;
  if (secondaryKey && secondarySpan) sizes[secondaryKey] = draw(secondarySpan);
  else rng.next(); // the fixed layout: the secondary draw is spent even when the template has none
  const flavorIndex = rng.nextInt(SHORT_RANGE_PHENOMENA.length);
  return { version: 1, seed, slotId: slot.id, cycleIndex, template, tier: slot.tier, destinationIndex, distanceLy, ...sizes, flavorIndex, difficulty };
}

// The size keys, in the order a template's spans are searched (each template has exactly one primary).
const PRIMARY_SIZES = ["guests", "units", "scan"] as const;
const SECONDARY_SIZES = ["engineering", "security"] as const;

// A slot's roll at `cycleIndex` (the board shows the next one before dispatch): the template's training run and curve
// position read from the save's per-template counters (runDifficultyAt "shortRange", keyed by template). Pure.
export function rollShortRangeJob(
  state: GameState,
  slot: ShortRangeSlotRef,
  cycleIndex: number,
  boardSeed: number = shortRangeBoardSeed(state),
): ShortRangeRoll {
  const seed = shortRangeRollSeed(boardSeed, slot.id, cycleIndex);
  return drawShortRangeJob(makeRng(seed), seed, slot, cycleIndex, (template) => runDifficultyAt(state, "shortRange", slot.tier, template));
}

// Whether a roll is a template's training run (the "Training run" chip, no wear). Pure.
export function isTrainingRoll(roll: Pick<ShortRangeRoll, "difficulty">): boolean {
  return roll.difficulty.firstRun;
}

// What a roll asks of the ship, per category it uses (Range is the round trip). Pure.
export function shortRangeRollUses(roll: ShortRangeRoll): Partial<Record<ShortRangeCategory, number>> {
  const out: Partial<Record<ShortRangeCategory, number>> = { range: roll.distanceLy * 2 };
  if (roll.guests !== undefined) out.guests = roll.guests;
  if (roll.units !== undefined) out.cargo = roll.units;
  if (roll.scan !== undefined) out.sensors = roll.scan;
  if (roll.engineering !== undefined) out.engineering = roll.engineering;
  if (roll.security !== undefined) out.security = roll.security;
  return out;
}

// The categories a template uses (the board highlights them; the rest are on standby, still required). Pure.
export function shortRangeTemplateUses(key: ShortRangeTemplateKey): ShortRangeCategory[] {
  const spans = SHORT_RANGE_TEMPLATES[key].rolls[1];
  const out: ShortRangeCategory[] = ["range"];
  if (spans.units) out.push("cargo");
  if (spans.guests) out.push("guests");
  if (spans.scan) out.push("sensors");
  if (spans.engineering) out.push("engineering");
  if (spans.security) out.push("security");
  return out;
}

// The destination's placeholder designation and, for a survey, the phenomenon. Display only. Pure.
export function shortRangeDestinationLabel(roll: Pick<ShortRangeRoll, "template" | "destinationIndex">): string {
  const list = SHORT_RANGE_DESTINATIONS[SHORT_RANGE_TEMPLATES[roll.template].destinations];
  return list[roll.destinationIndex] ?? list[0];
}
export function shortRangePhenomenonLabel(roll: Pick<ShortRangeRoll, "template" | "flavorIndex">): string | null {
  return roll.template === "phenomenonSurvey" ? SHORT_RANGE_PHENOMENA[roll.flavorIndex] ?? SHORT_RANGE_PHENOMENA[0] : null;
}

// ===== the sheet =====

// A division's crew strength as a rating (SHORT_RANGE_CREW_RATING). 0 for no crew. Pure.
export function shortRangeCrewRating(strength: number): number {
  if (!(strength > 0)) return 0;
  return SHORT_RANGE_CREW_RATING.perDoubling * Math.log2(1 + strength / SHORT_RANGE_CREW_RATING.referenceStrength);
}

// A tier sheet's round trip as two transit legs, in ticks (the reach gate's unit). Pure.
export function shortRangeSheetLegTicks(tier: ShortRangeTier): number {
  return Math.ceil(SHORT_RANGE_SHEETS[tier].range / 2 / LY_PER_TICK);
}

// The ship's Engineering crew rating (the sheet's Engineering row and the cycle plan's repair or build speed). Pure.
export function shortRangeShipEngineering(state: GameState, ship: ShipInstance): number {
  return shortRangeCrewRating(shipDivisionStrength(state, ship, "engineering"));
}

// The picked ship's value in every category, against `tier`'s sheet: Range is the reach on the sheet's round trip
// (shipTripRangeLightYears, gear and the long-haul ramp included); Cargo, Guest quarters and Sensors are its effective
// stats; Engineering and Security its crew ratings. Pure.
export function shortRangeShipRatings(state: GameState, ship: ShipInstance, tier: ShortRangeTier): Record<ShortRangeCategory, number> {
  const stats = effectiveShipStats(state, ship);
  return {
    range: shipTripRangeLightYears(state, ship, shortRangeSheetLegTicks(tier) * 2),
    cargo: stats.cargoCapacity,
    guests: stats.colonistCapacity ?? 0,
    sensors: stats.sensors,
    engineering: shortRangeShipEngineering(state, ship),
    security: shortRangeCrewRating(shipDivisionStrength(state, ship, "security")),
  };
}

export interface ShortRangeSheetCheck {
  ok: boolean;
  short: ShortRangeCategory[]; // the categories the ship falls short in, in SHORT_RANGE_CATEGORIES order
}

// Whether `ship` meets `tier`'s sheet, and where it falls short. Range goes through the reach gate itself
// (shipReachesRoundTrip, the captain-mission seam); every other category compares its rating. Pure.
export function meetsSheet(state: GameState, ship: ShipInstance, tier: ShortRangeTier): ShortRangeSheetCheck {
  const sheet = SHORT_RANGE_SHEETS[tier];
  const ratings = shortRangeShipRatings(state, ship, tier);
  const legs = shortRangeSheetLegTicks(tier);
  const short = SHORT_RANGE_CATEGORIES.filter((c) => (c === "range" ? !shipReachesRoundTrip(state, ship, legs, legs) : ratings[c] < sheet[c]));
  return { ok: short.length === 0, short };
}

// ===== the cycle plan =====

export interface ShortRangeCyclePlan {
  transitOutTicks: number;
  onSiteTicks: number;
  transitBackTicks: number;
  unloadTicks: number; // at home (it occupies a transit berth on the captain-mission rules, call 18)
  totalTicks: number;
}

// A goods step's length: the mission unload fold for `units` (cargo-scaled, crew-shortened), then the Operations
// Integrity full-hold fold when the units fill the hold to FULL_HOLD_FRACTION. Pure.
function goodsTicks(baseTicks: number, units: number, stats: ShipDerivedStats): number {
  const ticks = scaledUnloadTicks(baseTicks, units, stats);
  const full = stats.cargoCapacity > 0 && units / stats.cargoCapacity >= FULL_HOLD_FRACTION ? fullHoldUnloadTicksFor(ticks, stats) : undefined;
  return full ?? ticks;
}

// One cycle's phases for `roll` flown by a ship with `stats` (effectiveShipStats) and `engineeringRating`
// (shortRangeShipRatings). Transit is the distance over LY_PER_TICK each way, through the SAME folds as a captain
// mission (model.ts effectiveMissionDef's helpers: Fast Departure out, the Flight Deck Constitution ramp or Fast
// Return back); the on-site job and the home turnaround use the mission unload fold (crew unloadSpeedMult, cargo
// scaling, the full-hold fold for goods). A scan divides by (1 + sensors / reference), a repair or build by
// (1 + engineering / reference). The training run's legs read the tutorial scale. One helper, so the gate, the loop
// and every readout agree. Pure.
export function shortRangeCyclePlan(
  roll: ShortRangeRoll,
  stats: ShipDerivedStats,
  engineeringRating: number,
  tutorialScale: number = SHORT_RANGE_TUTORIAL_TICKS_SCALE,
): ShortRangeCyclePlan {
  const work = SHORT_RANGE_TEMPLATES[roll.template].work;
  const plainLeg = Math.ceil(roll.distanceLy / LY_PER_TICK);
  const leg = roll.difficulty.firstRun ? Math.max(1, Math.ceil(plainLeg * tutorialScale)) : plainLeg;
  const transitOutTicks = outboundLegTicks(leg, stats);
  let onSiteTicks: number;
  switch (work.site) {
    case "passengers":
      onSiteTicks = scaledUnloadTicks(work.siteTicks, roll.guests ?? 0, stats);
      break;
    case "offload":
    case "load":
      onSiteTicks = goodsTicks(work.siteTicks, roll.units ?? 0, stats);
      break;
    case "scan":
      onSiteTicks = Math.max(1, Math.ceil((work.siteTicks * (roll.scan ?? 0)) / (1 + Math.max(0, stats.sensors) / SHORT_RANGE_WORK.sensorsReference)));
      break;
    case "work":
      onSiteTicks = Math.max(1, Math.ceil((work.siteTicks * (roll.engineering ?? 0)) / (1 + Math.max(0, engineeringRating) / SHORT_RANGE_WORK.engineeringReference)));
      break;
  }
  const transitBackTicks = returnLegTicks(leg, stats, transitOutTicks + onSiteTicks);
  const unloadTicks =
    work.homeUnload === "goods" ? goodsTicks(SHORT_RANGE_WORK.homeUnloadTicks, roll.units ?? 0, stats) : scaledUnloadTicks(SHORT_RANGE_WORK.homeUnloadTicks, 0, stats);
  return { transitOutTicks, onSiteTicks, transitBackTicks, unloadTicks, totalTicks: transitOutTicks + onSiteTicks + transitBackTicks + unloadTicks };
}

// ===== the reward =====

export interface ShortRangeCycleReward {
  credits: number; // whole credits paid on the delivered cycle
  loadCost: number; // a drop-off's working capital: spent at the cycle start, returned on delivery (0 otherwise)
  materials: Readonly<Record<string, number>>; // whole units to the Warehouse
  captainXpPerTick: number; // integer, per active tick
  fleetAdminXpPerTick: number; // integer, per active tick
}

// A whole number from `x`: its floor, plus one with the fractional part's chance (one draw). Pure w.r.t. the rng.
function wholeUnits(x: number, rng: Rng): number {
  const whole = Math.floor(x);
  return whole + (rng.next() < x - whole ? 1 : 0);
}

// What one delivered cycle of `roll` pays a ship with `stats` (call 13). Credits round to whole credits; a fractional
// material amount rounds on the roll's own SHORT_RANGE_ROUNDING_SALT stream (one draw), so the reward is a pure
// function of the roll and the ship. Pure.
export function shortRangeCycleReward(roll: ShortRangeRoll, stats: ShipDerivedStats): ShortRangeCycleReward {
  const reward = SHORT_RANGE_TEMPLATES[roll.template].reward;
  const xp = { captainXpPerTick: reward.captainXpPerTick[roll.tier], fleetAdminXpPerTick: reward.fleetAdminXpPerTick };
  const units = roll.units ?? 0;
  switch (reward.kind) {
    case "passengers":
      return { credits: Math.round(reward.creditsPerPersonLy[roll.tier] * (roll.guests ?? 0) * roll.distanceLy), loadCost: 0, materials: {}, ...xp };
    case "supplyLoop": {
      const loadCost = units * reward.supplyCostPerUnit[roll.tier];
      return { credits: Math.round(loadCost * reward.margin), loadCost, materials: {}, ...xp };
    }
    case "pickup":
      return { credits: Math.round(reward.creditsPerUnit[roll.tier] * units), loadCost: 0, materials: { [reward.material]: units }, ...xp };
    case "survey": {
      const scan = roll.scan ?? 0;
      const rng = makeRng((roll.seed ^ SHORT_RANGE_ROUNDING_SALT) >>> 0);
      const yieldUnits = wholeUnits(scan * reward.unitsPerScan * (1 + Math.max(0, stats.sensors) * SURVEY_SENSOR_YIELD_COEFF), rng);
      return { credits: Math.round(reward.creditsPerScan[roll.tier] * scan), loadCost: 0, materials: yieldUnits > 0 ? { [reward.material]: yieldUnits } : {}, ...xp };
    }
    case "contract":
      return { credits: reward.credits[roll.tier], loadCost: 0, materials: {}, ...xp };
  }
}
