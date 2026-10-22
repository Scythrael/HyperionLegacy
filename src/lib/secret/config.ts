// config.ts: every tunable number and every line of copy in the secret game (0.13.11).
//
// Design: docs/plans/2026-10-22-hotfix-0.13.11-secret-generator-design.md. The STRUCTURE is the
// user's (cascade, ten bonus, Overclock, three prestige layers, skills, milestones, finale at
// e777,777, long achievement at e1,000,000). The NUMBERS are the builder's, tuned by the steady
// player simulation (sim.ts, pinned by sim.test.ts). Change a number here and the pacing test
// tells you whether the planned playtime still holds.
//
// All player-facing copy below is [PROPOSAL] copy the user may rewrite.

// ---------------------------------------------------------------------------
// Generators (the cascade: Tier I makes Ore, every higher tier makes the tier below)
// ---------------------------------------------------------------------------

export const TIER_COUNT = 8;
export const BASE_TIERS_OPEN = 4;

export interface TierDef {
  numeral: string;
  name: string;
  flavor: string; // [PROPOSAL] one joke line under the name
  makes: string; // what it produces, as the row's subtitle
  baseCostLog10: number; // log10 of the first unit's Ore price
  costStepLog10: number; // log10 of the price factor at every ten bought
  baseRate: number; // units of the tier below per second, per owned unit, before multipliers
  unlockFleet: number; // lifetime Fleet Prestiges needed (0 = open from the start)
}

export const TIERS: readonly TierDef[] = [
  { numeral: "I", name: "Mining Laser", flavor: "Points at rocks. Rocks become Ore.", makes: "makes Ore", baseCostLog10: 1, costStepLog10: 3, baseRate: 1, unlockFleet: 0 },
  { numeral: "II", name: "Refinery", flavor: "Refines raw ambition into more Mining Lasers.", makes: "makes Mining Lasers", baseCostLog10: 2, costStepLog10: 4, baseRate: 0.4, unlockFleet: 0 },
  { numeral: "III", name: "Fabricator", flavor: "Prints Refineries. Mostly on purpose.", makes: "makes Refineries", baseCostLog10: 4, costStepLog10: 5, baseRate: 0.12, unlockFleet: 0 },
  { numeral: "IV", name: "Synthesizer", flavor: "Synthesizes Fabricators from alloys and optimism.", makes: "makes Fabricators", baseCostLog10: 6, costStepLog10: 6, baseRate: 0.04, unlockFleet: 0 },
  { numeral: "V", name: "Fusion Forge", flavor: "Squeezes atoms together until Synthesizers come out.", makes: "makes Synthesizers", baseCostLog10: 15, costStepLog10: 8, baseRate: 0.012, unlockFleet: 1 },
  { numeral: "VI", name: "Graviton Press", flavor: "Applies gentle, overwhelming pressure.", makes: "makes Fusion Forges", baseCostLog10: 30, costStepLog10: 10, baseRate: 0.004, unlockFleet: 2 },
  { numeral: "VII", name: "Quantum Loom", flavor: "Weaves Graviton Presses in several places at once.", makes: "makes Graviton Presses", baseCostLog10: 50, costStepLog10: 12, baseRate: 0.0012, unlockFleet: 3 },
  { numeral: "VIII", name: "Singularity Engine", flavor: "Please do not look directly at the paperwork.", makes: "makes Quantum Looms", baseCostLog10: 80, costStepLog10: 15, baseRate: 0.0004, unlockFleet: 6 },
];

// Every ten bought multiplies that tier's output by this ("the ten bonus").
export const TEN_BONUS = 2;
export const TEN_BONUS_SKILL = 2.2;

export const START_ORE = 10;

// ---------------------------------------------------------------------------
// Overclock: x1.125 to all production per level, a repeatable Ore purchase whose price rises with
// your income. One level costs OC_SECONDS seconds of last second's Ore income, divided by the
// prestige multiplier, flat within one purchase, never below a geometric floor. This keeps the
// in-run climb steady over real time (what makes days of pacing, and fair offline catch-up,
// possible) and the floor stops "buy Overclock right after a reset, while income is tiny".
// ---------------------------------------------------------------------------

export const OC_FACTOR = 1.125;
export const OC_SECONDS = 1.84;
export const OC_FLOOR_BASE = 10;
export const OC_FLOOR_STEP = 1.2;
// Auto Overclock spends at most this share of Ore per step (the rest goes to the generators).
export const OC_AUTO_SHARE = 0.5;

// ---------------------------------------------------------------------------
// Prestige layers. Thresholds are log10(Ore) on the effective scale.
// ---------------------------------------------------------------------------

export const CAPTAIN_AT = 60; // 1e60 Ore
export const FLEET_AT = Math.log10(1.8) + 308; // 1.8e308 Ore
export const PRESTIGECEPTION_AT = 10000; // e10,000 Ore

// Captain Points earned = CP_SCALE x gainMultiplier x (exponent / 60). Each point speeds the stack:
// multiplier (1 + CP)^CP_POW, unbounded, concave (D23: diminishing returns, never a cap).
export const CP_SCALE = 186;
export const CP_POW = 0.2;
// Augment Points earned = AP_SCALE x gainMultiplier x (exponent / 308). Multiplier (1 + AP)^AP_POW.
export const AP_SCALE = 40;
export const AP_POW = 0.178;
// Dream Points earned = DP_SCALE x (exponent / 10,000). Each multiplies the Captain and Augment
// Points earned per prestige: gainMultiplier = (1 + DP)^DP_POW.
export const DP_SCALE = 11900;
export const DP_POW = 0.24;

export const HEAD_START_LOG10 = 10; // Head Start begins resets with 1e10 Ore
export const OVERDRIVE_POWER = 1.05; // Overdrive: Ore production ^1.05

// ---------------------------------------------------------------------------
// The finale and after: identity up to e777,777, then a concave curve (it slows, never stops).
// effective = FINALE + SOFT_SCALE x ((1 + (raw - FINALE) / SOFT_SCALE)^SOFT_BETA - 1) / SOFT_BETA
// ---------------------------------------------------------------------------

export const FINALE_EXPONENT = 777777;
export const LONG_EXPONENT = 1000000;
export const SOFT_SCALE = 36;
export const SOFT_BETA = 0.5;

// ---------------------------------------------------------------------------
// Skills (Skill Points come from Fleet Prestige, one each; kept through every reset)
// ---------------------------------------------------------------------------

export type SkillId =
  | "autoOverclock"
  | "autoBuyLow"
  | "autoCaptain"
  | "autoFleet"
  | "autoPc"
  | "headStart"
  | "tenBonus"
  | "autoBuyHigh"
  | "overdrive";

export interface SkillDef {
  id: SkillId;
  name: string;
  blurb: string;
  cost: number;
  requires?: SkillId;
  auto?: boolean; // has an on/off switch
}

// Display order is also the order the steady player buys them in the simulation.
// [PROPOSAL] additions beyond the mockup's six: Auto Overclock, Auto Fleet Prestige, Auto
// Prestigeception (the design allows up to four more of the same kinds).
export const SKILLS: readonly SkillDef[] = [
  { id: "autoOverclock", name: "Auto Overclock", blurb: "Buys Overclock for you", cost: 1, auto: true },
  { id: "autoBuyLow", name: "Auto-buy I to IV", blurb: "Buys Max for you", cost: 1, auto: true },
  { id: "autoCaptain", name: "Auto Captain Prestige", blurb: "At a target you set", cost: 1, auto: true },
  { id: "autoFleet", name: "Auto Fleet Prestige", blurb: "At a target you set", cost: 1, auto: true },
  { id: "autoPc", name: "Auto Prestigeception", blurb: "At a target you set", cost: 2, auto: true },
  { id: "headStart", name: "Head Start", blurb: "Begin resets with 1e10 Ore", cost: 1 },
  { id: "tenBonus", name: "Ten Bonus ×2.2", blurb: "Each ten is worth more", cost: 2 },
  { id: "autoBuyHigh", name: "Auto-buy V to VIII", blurb: "Needs Auto-buy I to IV", cost: 2, requires: "autoBuyLow", auto: true },
  { id: "overdrive", name: "Overdrive", blurb: "Ore production ^1.05", cost: 3 },
];

// Auto prestige fires when the gain is at least this percent of what you already have.
export const AUTO_TARGET_CHOICES: readonly number[] = [10, 25, 50, 100, 200, 500, 1000];
export const AUTO_TARGET_DEFAULT = 100;

// ---------------------------------------------------------------------------
// Milestones: recorded now (with the real date), paid by a later patch (answer 8: back pay).
// ---------------------------------------------------------------------------

export type MilestoneId =
  | "firstCaptain"
  | "googol"
  | "firstFleet"
  | "e1000"
  | "singularity"
  | "firstPc"
  | "turbo"
  | "e100k"
  | "allSkills"
  | "finale"
  | "long";

export interface MilestoneDef {
  id: MilestoneId;
  name: string; // [PROPOSAL]
  detail: string;
  achievement?: boolean; // the two named goals, flagged for the later rewards patch
}

export const MILESTONES: readonly MilestoneDef[] = [
  { id: "firstCaptain", name: "Number Go Up", detail: "Your first Captain Prestige" },
  { id: "googol", name: "A Respectable Googol", detail: "1e100 Ore" },
  { id: "firstFleet", name: "Fleet Week", detail: "Your first Fleet Prestige" },
  { id: "e1000", name: "A Thousand Zeros, Give or Take", detail: "e1,000 Ore" },
  { id: "singularity", name: "Do Not Look Directly at It", detail: "Build a Singularity Engine" },
  { id: "firstPc", name: "Prestiged Your Prestige", detail: "Your first Prestigeception" },
  { id: "turbo", name: "Turbo Button Enjoyer", detail: "Overclock level 10,000" },
  { id: "e100k", name: "Running Low on Zeros", detail: "e100,000 Ore" },
  { id: "allSkills", name: "Fully Automated Luxury Mining", detail: "Own every skill" },
  { id: "finale", name: "Seven Sevens Short of Seven", detail: "e777,777 Ore, the special unlock", achievement: true },
  { id: "long", name: "Forever Is a Long Time", detail: "e1,000,000 Ore", achievement: true },
];

export const TURBO_LEVEL = 10000;

// ---------------------------------------------------------------------------
// Copy [PROPOSAL]
// ---------------------------------------------------------------------------

export const COPY = {
  title: "HYPERION LEGACY v0.0000001a",
  subtitle: "The original, with extra zeros.",
  footer: "It keeps running while it's closed, and while the game is closed.",
  captainBlurb: "The small reset. Your stack and Ore start over; Captain Points stay, and every one of them makes the whole stack run a little faster. Promotion by controlled demolition.",
  fleetBlurb: "The big reset. Trade your Captain Points for Augment Points and a Skill Point. New generators unlock as your Fleet count grows. The admiral would like a word, and the word is \"more\".",
  pcBlurb: "We heard you like prestige, so we put a prestige in your prestige. Now you can prestige your prestige while you prestige.",
  finaleTitle: "SEVEN SEVENS SHORT OF SEVEN",
  finaleBody: "You beat the very first version of Hyperion Legacy. It took us a while too.",
  finaleAfter: "The special unlock is recorded for a future update. The numbers keep going if you do; they just take their time now.",
  longTitle: "FOREVER IS A LONG TIME",
  longBody: "e1,000,000 Ore. That was the long way around, and you took it.",
  longAfter: "More is coming in a later update. Your stack keeps climbing in the meantime.",
  rewardRecorded: "Reward recorded",
  rewardLater: "Reward arrives in a future update",
} as const;
