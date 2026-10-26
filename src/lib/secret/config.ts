// config.ts: every tunable number and every line of copy in the secret game (0.13.11).
//
// Design: docs/plans/2026-10-22-hotfix-0.13.11-secret-generator-design.md. The STRUCTURE is the
// user's (cascade, ten bonus, Overclock, three prestige layers, skills, milestones, finale at
// e777,777, long achievement at e1,000,000). The NUMBERS are the builder's, tuned by the steady
// player simulation (sim.ts, pinned by sim.test.ts). Change a number here and the pacing test
// tells you whether the planned playtime still holds.
//
// Player-facing copy below: 0.13.11 copy approved 2026-10-22, 0.13.11.1 copy approved 2026-10-23.

import type { Achievement } from "../achievements";

// ---------------------------------------------------------------------------
// Generators (the cascade: Tier I makes Ore, every higher tier makes the tier below)
// ---------------------------------------------------------------------------

export const TIER_COUNT = 8;
export const BASE_TIERS_OPEN = 4;

export interface TierDef {
  numeral: string;
  name: string;
  flavor: string; // one joke line under the name
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

// Captain Points earned = CP_SCALE x gainMultiplier^CAPTAIN_BEND x (exponent / 60)^k. Each point
// speeds the stack: multiplier (1 + CP)^CP_POW, unbounded, concave (D23: diminishing returns, never
// a cap). 0.13.11.1 curve round (user: "make the captain feel more useful without speeding the
// game up", picked "Q3", then "Ship PC 0.5"): CP_POW 0.195 to 0.4875, so doubling your points is
// x1.40 instead of x1.145. CAPTAIN_BEND = 0.195 / 0.4875 pays for it: the gain curve, the Dream Point
// boost on Captain gains and Captain's Compound are bent by it, so each doubling needs more growth
// and Captain resets come less often, each one bigger. The scale (0.5 x 186^0.4) keeps the pace
// about level. The bonus a save's points gave before is kept exactly (state.ts converts them once).
export const CP_POW_BEFORE_CURVE_ROUND = 0.195;
export const CP_POW = 0.4875;
export const CAPTAIN_BEND = CP_POW_BEFORE_CURVE_ROUND / CP_POW; // 0.4
export const CP_SCALE = 0.5 * Math.pow(186, CAPTAIN_BEND);
// Augment Points earned = AP_SCALE x gainMultiplier x (exponent / 308). Multiplier (1 + AP)^AP_POW.
export const AP_SCALE = 40;
export const AP_POW = 0.178;
// Dream Points earned = DP_SCALE x (exponent / 10,000). Each multiplies the Captain and Augment
// Points earned per prestige: gainMultiplier = (1 + DP)^DP_POW.
export const DP_SCALE = 11900;
export const DP_POW = 0.24;

// 0.13.11.1 retune (user: "Retune so default is best"): each layer earns
// scale x (peak exponent / threshold)^k, k under 1 (engine.ts gainExponent). From the finale on,
// Fleet Prestige uses k = 1 and Captain Prestige CP_K_AFTER_FINALE (the 0.13.11 k = 1, bent by
// CAPTAIN_BEND); Dream Points keep DP_K. [PROVISIONAL] values, measured in the plan's pacing results.
export const CP_K = 0.6 * CAPTAIN_BEND; // 0.24
export const CP_K_AFTER_FINALE = CAPTAIN_BEND; // 0.4
export const AP_K = 0.55;
export const DP_K = 0.7;

// 0.13.11.1 curve round (user: "adjust the curve of the game a little to make things take a little
// while longer overall", picked "Ship PC 0.5"): from the first Prestigeception on, the whole game
// runs at 1 / 1.15 speed, live and offline alike (engine.ts stepMut). Before it, nothing changes, so
// the first evening (first Captain, first Fleet) plays exactly as before.
export const GAME_PACE_AFTER_FIRST_PC = 1 / 1.15;

export const HEAD_START_LOG10 = 10; // Head Start begins resets with 1e10 Ore
export const OVERDRIVE_POWER = 1.05; // Overdrive: Ore production ^1.05

// ---------------------------------------------------------------------------
// The finale and after: identity up to e777,777, then a concave curve (it slows, never stops).
// effective = FINALE + SOFT_SCALE x ((1 + (raw - FINALE) / SOFT_SCALE)^SOFT_BETA - 1) / SOFT_BETA
// ---------------------------------------------------------------------------

export const FINALE_EXPONENT = 777777;
export const LONG_EXPONENT = 1000000;
export const SOFT_SCALE = 66; // 0.13.11.1 retune: 58 before (e1,000,000 back to about a month)
export const SOFT_BETA = 0.5;

// ---------------------------------------------------------------------------
// The e1,000,000 upgrades (0.13.11.1). Four upgrades unlock when the best Ore reaches e1,000,000.
// Each has a level cap shown as "X / Y" (user-approved exception to D23, 2026-10-23). Level n
// (counting from 0) costs Ore at the effective exponent priceBase x priceRatio^n. All four are
// kept through every prestige. At level 0 every effect is exactly 1, so nothing before
// e1,000,000 moves. [PROVISIONAL] numbers, set by the pacing sim.
// ---------------------------------------------------------------------------

// 0.13.11.1 content pacing (user: "Stagger the upgrades", "More upgrades", minigame Upgrades tab
// only, "About 4 months"): each upgrade wakes up at its own best-Ore exponent (unlockAt), so the
// average player gets a new one every few weeks from e1,000,000 (day 32) to about day 92, and
// e10,000,000 near day 120. The upgrades multiply together, so the first ones wake close together
// (each alone barely moves the climb). Three late ones added. Names, flavor and numbers
// [PROPOSAL] / [PROVISIONAL] (plan, pacing results).
export type UpgradeId = "ocOverclocker" | "tenfoldTuner" | "captainsCompound" | "lucidDreaming" | "turboEncabulator" | "overdriveOverdrive" | "singularitySharpener";

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  flavor: string;
  effect: string; // the plain-language line beside the level
  cap: number;
  unlockAt: number; // effective exponent of the best Ore that wakes it up
  priceBase: number; // effective exponent of level 0's price
  priceRatio: number; // each level's price exponent is this times the last
  step: number; // the size of one level's effect (see engine.ts)
}

export const UPGRADES_AT = 1000000; // e1,000,000 Ore (best ever) wakes the first one (and the tab)

export const UPGRADES: readonly UpgradeDef[] = [
  { id: "ocOverclocker", name: "Overclock Overclocker", flavor: "It overclocks your overclock. That is the whole upgrade.", effect: "each Overclock level counts more", cap: 25, unlockAt: 1000000, priceBase: 1000000, priceRatio: 1.0844, step: 0.88 },
  { id: "tenfoldTuner", name: "Tenfold Tuner", flavor: "Tightens the tens. Loosens the laws of arithmetic.", effect: "each ten bonus doubles a little harder", cap: 10, unlockAt: 1350000, priceBase: 1350000, priceRatio: 1.1583, step: 0.055 },
  { id: "captainsCompound", name: "Captain's Compound", flavor: "Interest on interest on interest. The bank has questions.", effect: "your Captain and Augment Points count as more", cap: 10, unlockAt: 1200000, priceBase: 1200000, priceRatio: 1.115, step: 4.95 },
  { id: "lucidDreaming", name: "Lucid Dreaming", flavor: "You can steer the dream now. You steered it toward more Ore.", effect: "Dream Points hit harder: they speed up the whole stack too", cap: 10, unlockAt: 1500000, priceBase: 1500000, priceRatio: 1.0874, step: 0.01485 },
  { id: "turboEncabulator", name: "Turbo Encabulator", flavor: "Nobody knows how it works. Nobody needs to. It works.", effect: "the whole stack runs faster", cap: 10, unlockAt: 1800000, priceBase: 1800000, priceRatio: 1.0563, step: 1.1 },
  { id: "overdriveOverdrive", name: "Overdrive Overdrive", flavor: "Overdrive, but it also drives over itself. Please wear a helmet.", effect: "with the Overdrive skill, Ore production rises to a higher power", cap: 10, unlockAt: 2400000, priceBase: 2400000, priceRatio: 1.0345, step: 0.011 },
  { id: "singularitySharpener", name: "Singularity Sharpener", flavor: "A sharper singularity. Do not ask what it was before.", effect: "the Singularity Engine makes more", cap: 10, unlockAt: 3400000, priceBase: 3400000, priceRatio: 1.016, step: 1.1 },
];

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
// Additions beyond the mockup's six (kept by the user, 2026-10-22): Auto Overclock, Auto Fleet Prestige, Auto
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
  | "long"
  | "e2m"
  | "e3m"
  | "e5m"
  | "e7m"
  | "starfall";

export interface MilestoneDef {
  id: MilestoneId;
  name: string;
  detail: string;
  how: string; // the requirement line on the achievement popup
  flavor?: string; // optional popup joke
  reward?: string; // the popup's green line; default: recorded for a future update
  achievement?: boolean; // the named goals, flagged for the later rewards patch
}

// 0.13.11.1: the new final stop. Its reward is real now: the Starfall theme style (themeStyle.ts).
export const STARFALL_EXPONENT = 10000000;
// Past e10,000,000 a second bend (engine.ts endSoften; user: "Slow it after e10M"): effective =
// 10,000,000 + END_SOFT_SCALE x ((1 + over / END_SOFT_SCALE)^END_SOFT_BETA - 1) / END_SOFT_BETA. It
// slows, never stops. [PROVISIONAL] measured in the plan's pacing results.
export const END_SOFT_SCALE = 20000;
export const END_SOFT_BETA = 0.5;

export const MILESTONES: readonly MilestoneDef[] = [
  { id: "firstCaptain", name: "Number Go Up", detail: "Your first Captain Prestige", how: "Do your first Captain Prestige.", flavor: "Promoted. Your old stack has been demolished with honors." },
  { id: "googol", name: "A Respectable Googol", detail: "1e100 Ore", how: "Reach 1e100 Ore.", flavor: "One googol. Somewhere, a mathematician is very proud of you." },
  { id: "firstFleet", name: "Fleet Week", detail: "Your first Fleet Prestige", how: "Do your first Fleet Prestige." },
  { id: "e1000", name: "A Thousand Zeros, Give or Take", detail: "e1,000 Ore", how: "Reach e1,000 Ore." },
  { id: "singularity", name: "Do Not Look Directly at It", detail: "Build a Singularity Engine", how: "Own a Singularity Engine.", flavor: "We said not to look. You looked." },
  { id: "firstPc", name: "Prestiged Your Prestige", detail: "Your first Prestigeception", how: "Do your first Prestigeception." },
  { id: "turbo", name: "Turbo Button Enjoyer", detail: "Overclock level 10,000", how: "Reach Overclock level 10,000." },
  { id: "e100k", name: "Running Low on Zeros", detail: "e100,000 Ore", how: "Reach e100,000 Ore." },
  { id: "allSkills", name: "Fully Automated Luxury Mining", detail: "Own every skill", how: "Learn every skill." },
  { id: "finale", name: "Seven Sevens Short of Seven", detail: "e777,777 Ore, the special unlock", how: "Reach e777,777 Ore.", achievement: true },
  { id: "long", name: "Forever Is a Long Time", detail: "e1,000,000 Ore", how: "Reach e1,000,000 Ore.", flavor: "A new upgrade just woke up. More are stirring.", achievement: true },
  // 0.13.11.1 content pacing (user: "More milestones"): a beat every few weeks on the way to
  // e10,000,000. Names and flavor [PROPOSAL].
  { id: "e2m", name: "Forever, Twice", detail: "e2,000,000 Ore", how: "Reach e2,000,000 Ore.", flavor: "Forever, but twice. Still not finished." },
  { id: "e3m", name: "Third Time's the Charm", detail: "e3,000,000 Ore", how: "Reach e3,000,000 Ore.", flavor: "It was not the charm. Keep going." },
  { id: "e5m", name: "Halfway to Too Big", detail: "e5,000,000 Ore", how: "Reach e5,000,000 Ore.", flavor: "The numbers have started to look nervous." },
  { id: "e7m", name: "Seven Sevens, Fully Grown", detail: "e7,777,777 Ore", how: "Reach e7,777,777 Ore.", flavor: "The sevens from the finale grew up. They send their regards." },
  { id: "starfall", name: "The Numbers Got Too Big", detail: "e10,000,000 Ore, the Starfall theme", how: "Reach e10,000,000 Ore.", flavor: "You ran out of room for zeros, so we gave you stars.", reward: "Reward: the Starfall theme, live now in Settings › UI", achievement: true },
];

export const REWARD_RECORDED_LINE = "Reward: recorded for a future update";

// The achievement popup for a milestone (design section 5).
export function milestoneAchievement(id: MilestoneId): Achievement {
  const m = MILESTONES.find((d) => d.id === id)!;
  return { id: `secret:${id}`, title: m.name, requirement: m.how, flavor: m.flavor, reward: m.reward ?? REWARD_RECORDED_LINE };
}

export const TURBO_LEVEL = 10000;

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

export const COPY = {
  title: "HYPERION LEGACY v0.0000001a",
  listName: "Hyperion Legacy v0.0000001a", // in the Minigames list and the code window
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
  longAfter: "New upgrades keep waking up on the way to e10,000,000. Your stack keeps climbing in the meantime.", // [PROPOSAL] 0.13.11.1 content pacing
  rewardRecorded: "Reward recorded",
  rewardLater: "Reward arrives in a future update",
  // 0.13.11.1
  overclockFlavor: "The red button. Pressing it is the whole plan.",
  upgradesNote: "Congratulations, you unlocked the overclock overclocker! Kidding. Horses are extinct in the future, so there are none left to beat for this joke.", // user copy, verbatim
  upgradesLocked: "Unlocks later",
  allSkillsLearned: "All learned", // the Fleet card's Skill Points row; the cutoff is explained in Help
  // The Fleet card once every skill is learned (no Skill Point any more).
  fleetBlurbAllSkills: "The big reset. Trade your Captain Points for Augment Points. New generators unlock as your Fleet count grows. The admiral would like a word, and the word is \"more\".",
  needsOverdrive: "Needs the Overdrive skill",
  maxed: "Maxed",
  starfallRewardLater: "Reward: the Starfall theme",
  starfallRewardDone: "Starfall theme unlocked",
} as const;

// The [?] Help view (0.13.11.1, design section 4): the rules in plain language, same voice as the
// rest of the game. It names no locked content (that stays "???" until reachable).
export const HELP_SECTIONS: readonly { title: string; body: string }[] = [
  { title: "THE STACK", body: "Mining Lasers make Ore. Every higher generator makes the one below it: Refineries make Mining Lasers, Fabricators make Refineries, and so on up the stack. Ore buys everything. It is generators all the way down." },
  { title: "THE TEN BONUS", body: "Every 10 of a generator you buy doubles its output. Owning them is nice; buying them is what counts." },
  { title: "OVERCLOCK AND UPGRADES", body: "Overclock lives in the Upgrades tab. It speeds up the whole stack by ×1.125 per level, and the levels multiply. Its price follows your income, so waiting never makes it cheaper. Much later, a few more upgrades wake up there. Each one has a level cap, shown as X / Y." },
  { title: "THREE KINDS OF PRESTIGE", body: "Captain Prestige resets your stack for Captain Points, and every point makes the stack faster. Fleet Prestige resets that too, for Augment Points, a Skill Point and new generators. Prestigeception resets everything below it for Dream Points, which make every Captain and Augment Point you earn count for more. Yes, it is prestige all the way down as well." },
  { title: "THE FINE PRINT", body: "Augment Points speed up the whole stack the way Captain Points do, and only a Prestigeception takes them away. Dream Points are never taken away: they make every Captain and Augment Point you earn count for more. A Fleet Prestige uses up the climb that paid for it, so a Prestigeception needs a fresh climb to e10,000 Ore after one. New generators unlock at 1, 2, 3 and 6 lifetime Fleet Prestiges. Legal read this paragraph twice and then asked to be reset too." },
  { title: "SKILLS", body: "Skill Points come from Fleet Prestige. Skills do the clicking for you: auto-buyers, automatic prestiges at a target you set, a head start and more. Once every skill is learned, Fleet Prestige stops paying Skill Points; any you saved stay yours. The late game is mostly watching numbers go up, which is the point." },
  { title: "MILESTONES", body: "Milestones appear as you get close to them, and each one is recorded with the date you reached it. Most rewards arrive in a future update; the last one pays out right away. You will know it when you see it." },
  { title: "TIME AWAY", body: "The stack keeps running while this window is closed and while the game is closed. Come back whenever you like. It does the work; you take the credit. Not those credits." },
];
