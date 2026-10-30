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
// 0.14.0 combined pacing retune: CP_K 0.6 x CAPTAIN_BEND (0.24) to 0.45 x CAPTAIN_BEND (0.18). With the
// automations free at milestones the first days ran fast (finale 3.1 days average, optimal 3.1 under its
// 3.5); smaller Captain gains before the finale slow only the climb to it (0.20: 3.8 / 3.6 days; 0.18:
// 4.2 / 4.1) and leave e1,000,000 and e10,000,000 where they were. Review round (the player's own first
// Prestigeception, PC_BAR_RATIO 3): 0.525 x CAPTAIN_BEND (0.21), the finale back in its bands (average 3.62 days,
// +1 h 3.09, optimal 3.51, casual 5.62; at 0.20 the +1 h run took 5.02, at 0.22 the optimal player 3.40). [PROVISIONAL]
// Slice 5a retune (user 2026-10-29: "Pay at the bar", "All 49 points before e10M"): PC_BAR_RATIO 3 to 2 and
// 0.53 x CAPTAIN_BEND (0.212), the finale at 3.76 days average, 3.60 optimal (band floor 3.5), 4.8 casual
// (0.55: 3.56 average but 3.43 optimal; 0.45: 4.31 average). [PROVISIONAL]
export const CP_K = 0.53 * CAPTAIN_BEND; // 0.212
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
// 0.14.0: the combined retune moved this to 63 at PC_BAR_RATIO 2; the review round's PC_BAR_RATIO 3 (fewer
// Prestigeceptions, so fewer resets of the climb) needed the shipped 66 again for e10,000,000 near day 120. Slice 5a
// retune (pay at the bar, PC_BAR_RATIO 2, CP_K 0.53 x CAPTAIN_BEND): 63, e10,000,000 on day 118.1 (61 gave 122.9 but
// put simStretch's coarse shortcut 8% off the shipping catch-up, 62 7.7%; 63 1.9%, 64 2.0%, 65 1.5%).
// [PROVISIONAL]
export const SOFT_SCALE = 63;
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
// Relic boosts (0.14.0, Relics v2 R2-10; plan docs/plans/2026-10-17-relics-v2-plan.md, USER ANSWERS
// 2026-10-22 and 2026-10-26). Every identified relic in the MAIN game's Museum gives this game one
// small multiplier, one lever per relic type (the user's 17-row table, "Approve as drafted"). Per
// type: weighted copies = regular copies + RELIC_PAST_CAP_WEIGHT x copies past that tier's 1,000 soft
// cap, then boost = 1 + perCopy x diminishing(weighted, knee) on the shared D23 curve: no cap, no
// compounding (user correction 2026-10-22). Two-way stays "Only via milestones": nothing here ever
// multiplies the main game. The boosts reach the engine as a snapshot on the state (relicBoosts,
// never saved), read from the main save at open and on every main save (runtime.ts).
// ---------------------------------------------------------------------------

export type RelicLever =
  | "tier1" | "tier2" | "tier3" | "tier4" | "tier5" | "tier6" | "tier7" | "tier8"
  | "overclock" | "stack" | "tenBonus" | "captain" | "augment" | "fleet" | "dream" | "allSmall" | "allBig";

// The multiplier per lever (a missing lever is exactly 1), plus `ceiling`, the combined relic ceiling fraction in
// [0, 1) (relicBoosts.ts relicCeilingFraction; missing means 0). A plain readonly record: engine.ts reads it.
export type RelicBoosts = Readonly<Partial<Record<RelicLever | "ceiling", number>>>;

// 0.14.0 relic ceiling (prestige redesign Slice 5a, design 3.6; user 2026-10-27: "All of the bonuses that the relics
// provide to the minigame will all combine together to be equivalent to a 2.5x increase when reaching the asymptotic
// limit"). Every identified copy of every one of the 17 types moves one combined fraction F toward 1 (never there):
// F = the mean over the 17 types of w / (w + ceilingKnee), w the type's weighted copies. The reachable exponent's
// plateau (where the climb past e10,000,000 bends, engine relicPlateau) is e10,000,000 x (1 + (RELIC_CEILING_MULT -
// 1) x F): e10,000,000 without relics, e25,000,000 at the limit. Asymptotic, a minigame-only exception to D23 (user,
// 2026-10-27: "Yes. Keep it that way."). The plateau only moves the bend past e10,000,000, so nothing at or below
// e10,000,000 moves; the gentle early boost stays the levers' (RELIC_BOOSTS perCopy and knee).
export const RELIC_CEILING_MULT = 2.5;
// [PROVISIONAL] F at a full Tier VII collection (1,000 identified in every tier, I to VII, each tier's staggered mix;
// user 2026-10-29: "near the limit at a full Tier VII collection"): each type's ceilingKnee is its weighted copies
// there x (1 - this) / this, so every type sits at this share of its own way there.
export const RELIC_CEILING_AT_FULL_TIER_VII = 0.9;

// The tier levers, by tier index (Mining Laser first).
export const RELIC_TIER_LEVERS: readonly RelicLever[] = ["tier1", "tier2", "tier3", "tier4", "tier5", "tier6", "tier7", "tier8"];

// User answer 3 (2026-10-26, "5x (Recommended)"): a copy past its tier's 1,000 soft cap counts 5x.
export const RELIC_PAST_CAP_WEIGHT = 5;

export interface RelicBoostDef {
  relicId: string; // the main game's general relic type id (relics.ts RELIC_TYPES; a test pins the match)
  lever: RelicLever;
  boosts: string; // what it boosts, for the Stats list (tier levers name their generator there instead)
  perCopy: number; // A: the boost's growth per weighted copy far below the knee
  knee: number; // the D23 knee, in weighted copies
  ceilingKnee: number; // the relic ceiling's knee, in weighted copies (see RELIC_CEILING_MULT) [PROVISIONAL]
}

// [PROVISIONAL] every perCopy (A) and knee below: the user picked "Gentle" (about 10 to 20% faster to
// each goal for a typical 0.14.0 collection; relic-free players keep the shipped bands); the numbers
// are the builder's, tuned by the pacing sims (simRelics*.test.ts pins both). Each A is set so the
// TYPICAL collection (relicCollections.ts: about 208 Tier I relics, weighted copies standard 29,
// augmented 12, stellar 6, radiant 1 per type) lands on its row's target below. The knees sit well
// under those counts (standard 10, augmented 4, stellar 2, radiant 0.5), so more copies grow on the
// curve's square-root reach: forty times the copies is about six times the bonus part, never a cap.
// The pacing: the climb is path-dependent (a Prestigeception that lands just before a goal costs a
// day), so most of the speed comes from Ancient Drive Coil's game clock, which compresses the whole
// game evenly, and the other levers stay small. The mapping is the user's table. "Fleet Points"
// (Resonance Shard) has no currency of its own in this game: read as the Fleet layer's reward on the
// stack (Augment Points count as more, the way Captain's Compound counts them), so it never doubles
// Glyph Tablet's Augment Points earned (user 2026-10-27: "Augment Points count more", kept). The
// amounts and knees stay [PROVISIONAL] for the 0.16.0 balancing pass.
// 0.14.0 Slice 5a: the per-row "typical" targets below were set on the collection with every type open. Under the tier
// stagger a typical first-weeks collection is Tier I, four types (Glyph Tablet, Spore Capsule, Geode Core, Resonance
// Shard), so it holds only those levers: average player on the shipping catch-up 3.65 / 30.56 / 117.86 days against
// 3.62 / 32.95 / 124.93 relic-free (x1.01 / 0.93 / 0.94), short of the Gentle 10 to 20%. Slice 5a retune (user
// 2026-10-29: "Pay at the bar", then tune the relic levers to Gentle): with the Prestigeception ladder fixed, the four
// Tier I levers (Geode Core, Spore Capsule, Glyph Tablet, Resonance Shard) at x6.5 their old perCopy put the typical
// collection at x0.890 / 0.851 / 0.876 (average), 0.872 / 0.849 / 0.857 (optimal), 0.940 / 0.859 / 0.865 (casual) on
// the shipping catch-up. x7 measured 0.881 / 0.843 / 0.874 but put simRelicsStretch's coarse shortcut 3.7% off the
// shipping catch-up (6: 2.6%, 6.5: 1.9%, 7.5: 3.1%, 8: 10.1%). The ceiling knees
// are unchanged, so the plateau table is too.
// ceilingKnee [PROVISIONAL]: each type's weighted copies in the full Tier VII collection (relicCollections.ts
// fullTierSevenMuseum, the tier stagger's mix) x (1 - RELIC_CEILING_AT_FULL_TIER_VII) / RELIC_CEILING_AT_FULL_TIER_VII,
// so a full Tier VII collection sits at F = 0.9 (plateau e23,500,000) and 10,000 of every type at F above 0.99.
export const RELIC_BOOSTS: readonly RelicBoostDef[] = [
  // Each row's "x" note is what it gave the old all-types typical collection. The typical Tier I collection (Slice 5a)
  // holds only the four Tier I types, at x6.5 their old perCopy: Mining Laser and Fusion Forge x1.39, Augment Points
  // earned x1.31, Augment Points counting x1.93; every other row gives it nothing.
  // all-types typical x1.05 each generator row
  { relicId: "geodeCore", lever: "tier1", boosts: "Mining Laser output", perCopy: 0.0202, knee: 10, ceilingKnee: 122.8 },
  { relicId: "magmaPearl", lever: "tier2", boosts: "Refinery output", perCopy: 0.0076, knee: 4, ceilingKnee: 6.889 },
  { relicId: "deepVeinCompass", lever: "tier3", boosts: "Fabricator output", perCopy: 0.0152, knee: 2, ceilingKnee: 24 },
  { relicId: "tectonicKeystone", lever: "tier4", boosts: "Synthesizer output", perCopy: 0.0809, knee: 0.5, ceilingKnee: 4.667 },
  { relicId: "sporeCapsule", lever: "tier5", boosts: "Fusion Forge output", perCopy: 0.0202, knee: 10, ceilingKnee: 122.8 },
  { relicId: "bioluminescentSeed", lever: "tier6", boosts: "Graviton Press output", perCopy: 0.0076, knee: 4, ceilingKnee: 53.11 },
  { relicId: "leviathanScale", lever: "tier7", boosts: "Quantum Loom output", perCopy: 0.0152, knee: 2, ceilingKnee: 5.556 },
  { relicId: "livingCrystal", lever: "tier8", boosts: "Singularity Engine output", perCopy: 0.0809, knee: 0.5, ceilingKnee: 7.889 },
  // all-types typical x1.02 (each level counts as 1.02 levels)
  { relicId: "flightRecorder", lever: "overclock", boosts: "each Overclock level counts more", perCopy: 0.00304, knee: 4, ceilingKnee: 53.11 },
  // all-types typical x1.15 on the game clock
  { relicId: "ancientDriveCoil", lever: "stack", boosts: "the whole stack runs faster", perCopy: 0.0456, knee: 2, ceilingKnee: 34.22 },
  // all-types typical x1.005 on the ten bonus factor (2 becomes 2.01)
  { relicId: "hullRivet", lever: "tenBonus", boosts: "each ten bonus is a little stronger", perCopy: 0.000311, knee: 10, ceilingKnee: 11.67 },
  // all-types typical x1.04 each points row
  { relicId: "captainsSigil", lever: "captain", boosts: "Captain Points earned", perCopy: 0.0647, knee: 0.5, ceilingKnee: 12 },
  { relicId: "glyphTablet", lever: "augment", boosts: "Augment Points earned", perCopy: 0.0162, knee: 10, ceilingKnee: 122.8 },
  { relicId: "resonanceShard", lever: "fleet", boosts: "your Augment Points count as more", perCopy: 0.0395, knee: 4, ceilingKnee: 104.4 },
  { relicId: "starChartFragment", lever: "dream", boosts: "Dream Points earned", perCopy: 0.00608, knee: 4, ceilingKnee: 41.56 },
  // all-types typical x1.03 and x1.05 on every generator
  { relicId: "precursorLens", lever: "allSmall", boosts: "every generator", perCopy: 0.00911, knee: 2, ceilingKnee: 52.67 },
  { relicId: "heartOfTheArchive", lever: "allBig", boosts: "every generator, radiantly", perCopy: 0.0809, knee: 0.5, ceilingKnee: 2 },
];

// The Stats line for a generator boost while that generator is still locked (it stays "???").
export const RELIC_LOCKED_TIER_TEXT = "an undiscovered generator";

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
  { id: "autoPc", name: "Auto Prestigeception", blurb: "The moment you reach the bar", cost: 2, auto: true },
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
  | "secondFleet"
  | "e1000"
  | "e10k"
  | "singularity"
  | "firstPc"
  | "pcRegular"
  | "turbo"
  | "e100k"
  | "allSkills"
  | "finale"
  | "long"
  | "e2m"
  | "e3m"
  | "e5m"
  | "e7m"
  | "starfall"
  | "e20m"
  | "e25m";

export interface MilestoneDef {
  id: MilestoneId;
  name: string;
  detail: string;
  how: string; // the requirement line on the achievement popup
  flavor?: string; // optional popup joke
  reward?: string; // the popup's green line; default: recorded for a future update
  achievement?: boolean; // the named goals, flagged for the later rewards patch
  // 0.14.0 Slice 5a: name, detail and reward stay "???" in every view until reached, never hinted (design 3.5).
  secret?: boolean;
  // The prize a later slice wires to this milestone (Slice 5b builds the Faster Than Light background).
  rewardHook?: "fasterThanLight";
}

// 0.13.11.1: the new final stop. Its reward is real now: the Starfall theme style (themeStyle.ts).
export const STARFALL_EXPONENT = 10000000;
// Past e10,000,000 a second bend (engine.ts endSoften; user: "Slow it after e10M"): effective =
// 10,000,000 + END_SOFT_SCALE x ((1 + over / END_SOFT_SCALE)^END_SOFT_BETA - 1) / END_SOFT_BETA. It
// slows, never stops. [PROVISIONAL] measured in the plan's pacing results.
export const END_SOFT_SCALE = 20000;
export const END_SOFT_BETA = 0.5;

// Prestigeceptions for the "pcRegular" milestone (Auto Skill Allocation, user pick 2026-10-28: "at 4
// Prestigeceptions") [PROVISIONAL]. At PC_BAR_RATIO 2 (Slice 5a retune) the 4th comes at the e621,000 bar,
// shortly before the finale.
export const AUTO_SKILLS_PC_COUNT = 4;

// 0.14.0 prestige redesign Slice 3: the three automation beats (secondFleet, e10k, pcRegular; names and
// flavor [PROPOSAL], approved 2026-10-27; Auto Captain at "Fleet Week, the Sequel" picked by the user
// 2026-10-28) joined the live list, and "Fully Automated Luxury Mining" moved to "every skill maxed"
// (design 3.2 [PROPOSAL], approved). A milestone that unlocks an automation needs no reward field: its
// popup and list line name the automation (milestoneRewardLine reads AUTOMATION_UNLOCKS).
export const MILESTONES: readonly MilestoneDef[] = [
  { id: "firstCaptain", name: "Number Go Up", detail: "Your first Captain Prestige", how: "Do your first Captain Prestige.", flavor: "Promoted. Your old stack has been demolished with honors." },
  { id: "googol", name: "A Respectable Googol", detail: "1e100 Ore", how: "Reach 1e100 Ore.", flavor: "One googol. Somewhere, a mathematician is very proud of you." },
  { id: "firstFleet", name: "Fleet Week", detail: "Your first Fleet Prestige", how: "Do your first Fleet Prestige." },
  { id: "secondFleet", name: "Fleet Week, the Sequel", detail: "Your second Fleet Prestige", how: "Do your second Fleet Prestige.", flavor: "Same fleet, new paint. The Captains have learned to promote themselves." },
  { id: "e1000", name: "A Thousand Zeros, Give or Take", detail: "e1,000 Ore", how: "Reach e1,000 Ore." },
  { id: "e10k", name: "Ten Thousand Zeros, Roughly", detail: "e10,000 Ore", how: "Reach e10,000 Ore.", flavor: "The fleet can admiral itself now. Please supervise anyway." },
  { id: "singularity", name: "Do Not Look Directly at It", detail: "Build a Singularity Engine", how: "Own a Singularity Engine.", flavor: "We said not to look. You looked." },
  { id: "firstPc", name: "Prestiged Your Prestige", detail: "Your first Prestigeception", how: "Do your first Prestigeception." },
  { id: "pcRegular", name: "Frequent Dreamer", detail: `${AUTO_SKILLS_PC_COUNT} Prestigeceptions`, how: `Do ${AUTO_SKILLS_PC_COUNT} Prestigeceptions.`, flavor: "You have spent so many Skill Points in your sleep that your sleep now spends them for you." },
  { id: "turbo", name: "Turbo Button Enjoyer", detail: "Overclock level 10,000", how: "Reach Overclock level 10,000." },
  { id: "e100k", name: "Running Low on Zeros", detail: "e100,000 Ore", how: "Reach e100,000 Ore." },
  { id: "allSkills", name: "Fully Automated Luxury Mining", detail: "Every skill maxed", how: "Max out every skill." },
  { id: "finale", name: "Seven Sevens Short of Seven", detail: "e777,777 Ore, the special unlock", how: "Reach e777,777 Ore.", achievement: true },
  { id: "long", name: "Forever Is a Long Time", detail: "e1,000,000 Ore", how: "Reach e1,000,000 Ore.", flavor: "A new upgrade just woke up. More are stirring.", achievement: true },
  // 0.13.11.1 content pacing (user: "More milestones"): a beat every few weeks on the way to
  // e10,000,000. Names and flavor [PROPOSAL].
  { id: "e2m", name: "Forever, Twice", detail: "e2,000,000 Ore", how: "Reach e2,000,000 Ore.", flavor: "Forever, but twice. Still not finished." },
  { id: "e3m", name: "Third Time's the Charm", detail: "e3,000,000 Ore", how: "Reach e3,000,000 Ore.", flavor: "It was not the charm. Keep going." },
  { id: "e5m", name: "Halfway to Too Big", detail: "e5,000,000 Ore", how: "Reach e5,000,000 Ore.", flavor: "The numbers have started to look nervous." },
  { id: "e7m", name: "Seven Sevens, Fully Grown", detail: "e7,777,777 Ore", how: "Reach e7,777,777 Ore.", flavor: "The sevens from the finale grew up. They send their regards." },
  { id: "starfall", name: "The Numbers Got Too Big", detail: "e10,000,000 Ore, the Starfall theme", how: "Reach e10,000,000 Ore.", flavor: "You ran out of room for zeros, so we gave you stars.", reward: "Reward: the Starfall theme, live now in Settings › UI", achievement: true },
  // 0.14.0 Slice 5a (design 3.5, approved as proposals 2026-10-27): the beat past e10,000,000 and the secret prize.
  // Names and flavor [PROPOSAL]; the e25,000,000 prize is the Faster Than Light background (user 2026-10-29), built in
  // Slice 5b; its reward line [PROPOSAL].
  { id: "e20m", name: "The Numbers Got Even Bigger", detail: "e20,000,000 Ore", how: "Reach e20,000,000 Ore.", flavor: "The stars have asked for a bigger sky. We are looking into it." },
  { id: "e25m", name: "The Sky Is Showing Off", detail: "e25,000,000 Ore", how: "Reach e25,000,000 Ore.", flavor: "You ran out of zeros, then stars, so the sky started moving.", reward: "Reward: the Faster Than Light background", achievement: true, secret: true, rewardHook: "fasterThanLight" },
];

export const REWARD_RECORDED_LINE = "Reward: recorded for a future update";

// The automation a milestone unlocks, if any (AUTOMATION_UNLOCKS read backward).
export function automationUnlockedBy(id: MilestoneId): AutomationId | undefined {
  return AUTOMATION_IDS.find((a) => AUTOMATION_UNLOCKS[a] === id);
}

// The popup's green line for an automation unlock (the signed-off mockup,
// docs/plans/2026-10-28-automation-skills-mockup.html: "Reward: Auto Captain Prestige unlocked. Find it on
// the Automation tab."). The Automation tab itself lands with the redesign's UI slice, in the same release.
export const AUTOMATION_TAB_POINTER = "Find it on the Automation tab.";
export function automationRewardLine(id: AutomationId): string {
  return `Reward: ${AUTOMATION_NAMES[id]} unlocked. ${AUTOMATION_TAB_POINTER}`;
}

// User 2026-10-28 ("Mystery popup"): Auto Prestigeception unlocks at "A Respectable Googol", before the player
// has seen a Prestigeception, so it stays a secret: its popup gives this line (user's words) and every view
// shows it as ??? until the milestone named here is recorded (engine automationRevealed).
export const MYSTERY_AUTOMATIONS: Readonly<Partial<Record<AutomationId, MilestoneId>>> = { autoPc: "firstPc" };
export const MYSTERY_REWARD_LINE = "Reward: a new automation, for later. You'll know it when you see it.";
// The Milestones list's reward column for it while it is a secret [PROPOSAL].
export const MYSTERY_LIST_LINE = { reached: "A new automation, for later", ahead: "Unlocks a new automation" } as const;

// The reward line a milestone shows: its own, else the automation it unlocks (the mystery line for a secret
// one), else recorded for later.
export function milestoneRewardLine(id: MilestoneId): string {
  const m = MILESTONES.find((d) => d.id === id)!;
  if (m.reward !== undefined) return m.reward;
  const auto = automationUnlockedBy(id);
  if (auto === undefined) return REWARD_RECORDED_LINE;
  return MYSTERY_AUTOMATIONS[auto] !== undefined ? MYSTERY_REWARD_LINE : automationRewardLine(auto);
}

// The achievement popup for a milestone (design section 5).
export function milestoneAchievement(id: MilestoneId): Achievement {
  const m = MILESTONES.find((d) => d.id === id)!;
  return { id: `secret:${id}`, title: m.name, requirement: m.how, flavor: m.flavor, reward: milestoneRewardLine(id) };
}

export const TURBO_LEVEL = 10000;

// ---------------------------------------------------------------------------
// 0.14.0 prestige redesign. Design docs/plans/2026-10-27-minigame-prestige-
// redesign-design.md (approved 2026-10-27, answers 2026-10-28), plan docs/plans/2026-10-27-minigame-
// prestige-redesign-plan.md. Slice 1 added the data; Slice 2 made the two bar ratios live (the rest is
// not read by the engine yet). Later slices wire it: the rising bars (Slice 2), the automations at
// milestones and the Automation tab (Slice 3), the leveled skills and the Skill Point schedule
// (Slice 4), the late milestones (Slice 5). Every number here is [PROVISIONAL] (set by the pacing
// sims in those slices) and every new name or line of copy is [PROPOSAL] unless a comment says the
// user named it.
// ---------------------------------------------------------------------------

// 3.1 Rising bars [PROVISIONAL], live since Slice 2 (engine fleetBarExponent / pcBarExponent). Each bar
// sits where the climb pays RATIO times the points that layer has already paid and you still hold (the
// Augment Points since the last Prestigeception for a Fleet, every Dream Point for a Prestigeception), so
// it rises with every prestige of its layer and sits exactly where players prestige (Slice 2 review, user
// "Make them bite"). At RATIO 1 the bar is the line the default 100% automatic target already follows:
// relic-free pacing is unchanged to the second, the bar decides every Fleet and Prestigeception for the
// 100% target, for lower targets and by hand, and only targets above 100% ask for more.
// Measured and rejected (average player, finale / e1M / e10M in days, against 4.88 / 32.35 / 119.15): a
// RATIO above 1 moves the whole curve chaotically (1.001: 4.87 / 32.41 / 127.63; 1.05: 4.89 / 33.38 /
// 106.23, optimal e1M 63.66; 1.25: finale 6.18), because the Prestigeception that lands near e1,000,000
// resets a long climb; a bar that tracks the last prestige's peak (x2.1 per payout) bit every time but
// took e10M to 146 days; Fleet-count ladders (Slice 2's x1.18 per Fleet, or x2.2 per payout) stop biting
// after the finale, where one big payout puts the holdings far above the ladder.
// 0.14.0 combined pacing retune (Slices 2 to 4): PC_BAR_RATIO 1 to 2, so each Prestigeception must pay
// twice the Dream Points already held. The Prestigeception climbs then sit about x4.8 apart (at 1 they
// were x2.7 apart, so one always landed within a step of e1,000,000 or e10,000,000 and reset weeks of
// climbing: e10,000,000 104 to 166 days across check-ins shifted -2 to +3 hours on the Slice 3 engine).
// Measured on the way (earlier skill sets): at 2.5 a climb could still land near a goal (e10,000,000 20 days
// apart between check-in shifts); 3 and above leave four or fewer Prestigeceptions before e10,000,000.
// The bars still decide (sim.ts simulateBite). FLEET_BAR_RATIO stays 1. [PROVISIONAL]
// Review round, 2 to 3: with the first Prestigeception the player's own (user 2026-10-29 "Granted OFF until
// revealed") it lands at whatever exponent the check-in finds (e10,000 to about e18,500), and every later one
// moves with it. At 2 the third climb sat at x62 of the first, right across the finale and e1,000,000 (e10,000,000
// 112.7 to 131.6 days across check-ins shifted -2 to +3 hours, the 200% target beating the default by half a day);
// at 3 the climbs sit at x4.8, x35 and x250 of the first, below the finale, between e1,000,000 and e10,000,000 and
// past it whatever the first: 115.2 to 123.0 days. Four Prestigeceptions to e10,000,000 (five at 2).
export const FLEET_BAR_RATIO = 1;
// Slice 5a retune, 3 to 2 (user 2026-10-29: "Pay at the bar", "All 49 points before e10M"). A Prestigeception now
// pays its bar's Dream Points however far past it the climb went (engine prestigeceptionGain), so the player's own
// first one pays the same 11,900 wherever the check-in finds it and the ladder is fixed again: each bar pays
// RATIO x what you hold, so the climbs sit at e10,000, e26,900, e129,000, e621,000 and e2,990,000
// (then e14,400,000; Lucid Planning lowers the later ones a little), clear of the finale, e1,000,000 and e10,000,000, and a relic collection never moves them
// (Star Chart Fragment scales the payout and the bar alike). Five Prestigeceptions to e10,000,000 (the gate lift at
// the 5th), every one of the 49 Skill Points by about day 98 (average). At 3 the fifth came past e10,000,000 (at
// e18,300,000); 2.5 puts it at e7,950,000, right before the goal. Measured (with SOFT_SCALE 63): the average player 3.76 / 32.10 /
// 118.06 days, optimal 3.60 / 32.03 / 120.22, casual 4.81 / 32.50 / 120.61; the 5th Prestigeception about day 90.
// [PROVISIONAL]
export const PC_BAR_RATIO = 2;

// 3.2 Automations. Each one unlocks at a milestone (user: "Only have the automations at the milestone
// levels"), never for Skill Points. The six that are skills today keep their ids; autoSkills
// (auto-skill allocation, user 2026-10-28) and autoUpgrades (auto-buy for the e1,000,000 Upgrades tab)
// are new. Both spend cheapest first, round-robin: QoL only, never optimal play (user 2026-10-28).
export type AutomationId =
  | "autoOverclock"
  | "autoBuyLow"
  | "autoBuyHigh"
  | "autoCaptain"
  | "autoFleet"
  | "autoPc"
  | "autoSkills"
  | "autoUpgrades";

export const AUTOMATION_IDS: readonly AutomationId[] = ["autoOverclock", "autoBuyLow", "autoBuyHigh", "autoCaptain", "autoFleet", "autoPc", "autoSkills", "autoUpgrades"];

// The Automation tab's names. The first six are today's skill names; the last two [PROPOSAL].
export const AUTOMATION_NAMES: Readonly<Record<AutomationId, string>> = {
  autoOverclock: "Auto Overclock",
  autoBuyLow: "Auto-buy I to IV",
  autoBuyHigh: "Auto-buy V to VIII",
  autoCaptain: "Auto Captain Prestige",
  autoFleet: "Auto Fleet Prestige",
  autoPc: "Auto Prestigeception",
  autoSkills: "Auto Skill Allocation",
  autoUpgrades: "Auto-buy Upgrades",
};

// How much an automation buys at a time (user 2026-10-28: "Buy 1 at a time. Buy maximum. Buy 10.").
export type AutomationBuy = "1" | "10" | "max";
export const AUTOMATION_BUY_CHOICES: readonly AutomationBuy[] = ["1", "10", "max"];
// [PROPOSAL] defaults, only for the automations that buy something (the three prestige automations
// keep their target setting instead and have no entry): "max" for Overclock and the generator
// auto-buys (today's behavior), "1" for skills and upgrades.
export const AUTOMATION_BUY_DEFAULT: Readonly<Partial<Record<AutomationId, AutomationBuy>>> = {
  autoOverclock: "max",
  autoBuyLow: "max",
  autoBuyHigh: "max",
  autoSkills: "1",
  autoUpgrades: "1",
};

// Every milestone id a gate may name (the late milestones went live with Slice 5a).
export type AnyMilestoneId = MilestoneId;

export const E20M_EXPONENT = 20000000;
// The secret prize (design 3.5): "???" until reached, never hinted in Help.
export const SECRET_PRIZE_EXPONENT = 25000000;

// [PROVISIONAL] Auto-buy V to VIII's milestone, the design table's "Do Not Look Directly at It" (own a
// Singularity Engine), kept in one constant as the mapping the Slice 3 sim nudges first (user 2026-10-28:
// "the sim may nudge one and reports it"; the choice goes to the user). OPEN: no single nudge holds the
// relic-free bands on both the pinned run and the hour-later run (average player, finale / e1,000,000 /
// e10,000,000 in days; bands 3 to 5 / 28 to 37 / 110 to 130). Here 4.31 / 48.67 / 137.20 (a
// Prestigeception at e949,000 on day 21 restarts the climb just short of e1,000,000) and 5.37 / 32.23 /
// 110.53 an hour later. At "A Respectable Googol" 4.52 / 31.59 / 108.92 and 4.28 / 31.62 / 135.73; at
// "Turbo Button Enjoyer" 4.52 / 31.59 / 104.94 and 4.29 / 31.63 / 123.88; Auto Prestigeception before the
// first Prestigeception (any early milestone) 4.47 / 31.54 / 105.13 and 4.50 / 31.57 / 105.17.
export const AUTO_BUY_HIGH_MILESTONE: MilestoneId = "singularity";

// [PROVISIONAL] Auto Prestigeception's milestone: the combined pacing retune's one mapping nudge (design 3.2
// [PROPOSAL] "Prestiged Your Prestige", the first Prestigeception; user 2026-10-28: "the sim may nudge one
// and reports it"). Granted at "A Respectable Googol" (1e100 Ore, about 1.4 h in), before the player has seen a
// Prestigeception, so it stays a secret (MYSTERY_AUTOMATIONS, user 2026-10-28 "Mystery popup") and is granted
// switched OFF (user 2026-10-29 "Granted OFF until revealed"): the first Prestigeception is always the player's
// own, then it shows itself for the player to switch on. (It was first nudged here to fire the first one at
// e10,000 for everyone; the review call made that the player's, and PC_BAR_RATIO 3 now keeps the later ones
// clear of the goals instead.)
export const AUTO_PC_MILESTONE: MilestoneId = "googol";

// Which milestone unlocks each automation (design 3.2 table, [PROPOSAL] for the beats the user did not
// name; plan update 2026-10-28 for the last two; user picks 2026-10-28: Auto Captain at a second Fleet
// Prestige, Auto Fleet at e10,000 Ore, Auto Skill Allocation at 4 Prestigeceptions, Auto-buy Upgrades at
// e2,000,000). Live since Slice 3: engine checkMilestonesMut grants each one once its milestone is
// recorded (switch on, target 100%, buy amount AUTOMATION_BUY_DEFAULT, all by their missing defaults).
export const AUTOMATION_UNLOCKS: Readonly<Record<AutomationId, MilestoneId>> = {
  autoOverclock: "firstFleet", // "Fleet Week"
  autoBuyLow: "e1000", // "A Thousand Zeros, Give or Take"
  autoCaptain: "secondFleet", // "Fleet Week, the Sequel"
  autoFleet: "e10k", // "Ten Thousand Zeros, Roughly"
  autoPc: AUTO_PC_MILESTONE, // [PROVISIONAL] sim nudge, see AUTO_PC_MILESTONE
  autoBuyHigh: AUTO_BUY_HIGH_MILESTONE, // [PROVISIONAL] sim nudge, see AUTO_BUY_HIGH_MILESTONE
  autoUpgrades: "e2m", // "Forever, Twice"
  autoSkills: "pcRegular", // "Frequent Dreamer"
};

// The Skills tab's one-line blurb for the two automations that were never skills [PROPOSAL] (the
// Automation tab, Slice 7 after the user's mockup sign-off, replaces these rows).
export const NEW_AUTOMATION_BLURBS: Readonly<Partial<Record<AutomationId, string>>> = {
  autoSkills: "Spends Skill Points, cheapest first",
  autoUpgrades: "Buys upgrade levels, cheapest first",
};

export function isAutomationId(id: string): id is AutomationId {
  return (AUTOMATION_IDS as readonly string[]).includes(id);
}

// 3.3 Leveled skills (Skill Points), live since Slice 4. The six names approved by the user 2026-10-27
// ("Approve, six skills"); flavor [PROPOSAL]; caps, costs, steps and gates [PROVISIONAL], set by the
// combined Slice 2 + 3 + 4 pacing retune. Level n (counting from 0) costs costBase + costStep x n Skill
// Points. A skill's strength is step x level x its scale factor, (1 + count)^SKILL_SCALE_POW of its
// scalesOff count: exactly 1 at a count of 0, only ever growing, concave (design 3.3; D23, no cap on
// the factor). Skills are kept through every reset; only buying a level waits for its gate.
export type LeveledSkillId = "headStart" | "tenfoldTraining" | "overdrive" | "captainsAcademy" | "fleetLogistics" | "lucidPlanning";

export type SkillScaleCount =
  | "lifetimeFleets" // fleetTotal
  | "captainSinceFleet" // Captain Prestiges in the current Fleet
  | "lifetimePcs" // pcCount
  | "fleetCount"; // Fleet Prestiges in the current Prestigeception

// When a skill can be bought (user 2026-10-28): alongside an automation milestone, or at a count of
// prestiges in a layer ("current" since that layer's last reset, or "lifetime"), so a reset cannot
// rush back to full power. From SKILL_GATE_LIFT_PC lifetime Prestigeceptions on, every skill opened
// once is available from the start of each climb.
export type SkillGate =
  | { milestone: AnyMilestoneId }
  | { prestiges: { layer: "captain" | "fleet" | "pc"; count: number; scope: "current" | "lifetime" } };

// [PROVISIONAL] 6 before the retune, 5 at PC_BAR_RATIO 2. Slice 5a retune (user 2026-10-29 "All 49 points before
// e10M"): back at PC_BAR_RATIO 2 with pay at the bar, the 5th Prestigeception is the e2,990,000 bar, well before
// e10,000,000.
export const SKILL_GATE_LIFT_PC = 5;

// The scale factor's power: (1 + count)^SKILL_SCALE_POW (design 3.3: exactly 1 at a count of 0, concave,
// growing, never capped). [PROVISIONAL] 0.1 (x1.43 from 35 lifetime Fleets, x1.17 from 4 Prestigeceptions);
// 0.17 made every skill too strong (e10,000,000 on day 59 with nothing else changed).
export const SKILL_SCALE_POW = 0.1;

export interface LeveledSkillDef {
  id: LeveledSkillId;
  name: string;
  flavor: string;
  effect: string; // the plain-language line beside the level
  cap: number;
  costBase: number; // Skill Points for level 1
  costStep: number; // each further level costs this many more
  step: number; // one level's effect, before the scale factor (unit per skill, in effect)
  scalesOff: SkillScaleCount;
  availableAt: SkillGate;
  // The 0.13.11.2 skill this one replaces, and the level that gives exactly its effect (Slice 6
  // converts an owned one to that level, its cost counted as spent).
  replaces?: { skill: SkillId; level: number };
}

// The combined pacing retune [PROVISIONAL] (Slice 1 started at 79 points: Head Start 3, Tenfold Training 5 at
// 0.1, Overdrive 4 at 0.025, the three new skills 5 / 5 / 4 at 0.1; that maxed every skill by day 56 with
// e10,000,000 on day 59). Most Fleets come in the first days (about 29 by day 5) and few late (one every few
// days after day 75), so most points arrive early: the early levels are small (Tenfold Training and Overdrive
// reach today's x2.2 and ^1.05 at level 4 of 5, Head Start's 1e10 at level 1 of 2) and the new skills give a
// little each (+5% a level). The costs total 49 (user 2026-10-28: skill sizes "OK"). Slice 5a retune (PC_BAR_RATIO
// 2, pay at the bar): the average player earns the 49th about day 98, the optimal player day 94, the casual day
// 94.6, all before e10,000,000 (user 2026-10-29: "All 49 points before e10M").
export const LEVELED_SKILLS: readonly LeveledSkillDef[] = [
  // step: log10 of the starting Ore per level (level 1 = 1e10, today's Head Start)
  { id: "headStart", name: "Head Start", flavor: "Why start from nothing when you can start from slightly less nothing?", effect: "resets begin with more Ore", cap: 2, costBase: 1, costStep: 1, step: HEAD_START_LOG10, scalesOff: "lifetimeFleets", availableAt: { milestone: "firstFleet" }, replaces: { skill: "headStart", level: 1 } },
  // step: added to the ten bonus factor per level (2 + 4 x 0.05 = 2.2, today's Ten Bonus x2.2)
  { id: "tenfoldTraining", name: "Tenfold Training", flavor: "Practice makes tens. Tens make more tens.", effect: "each ten bonus a little stronger", cap: 5, costBase: 1, costStep: 1, step: 0.05, scalesOff: "captainSinceFleet", availableAt: { milestone: "e1000" }, replaces: { skill: "tenBonus", level: 4 } },
  // step: added to the Ore production power per level (1 + 4 x 0.0125 = ^1.05, today's Overdrive)
  { id: "overdrive", name: "Overdrive", flavor: "Past the red line there is another red line. It is also fine.", effect: "Ore production to a higher power", cap: 5, costBase: 1, costStep: 1, step: 0.0125, scalesOff: "lifetimePcs", availableAt: { milestone: "firstPc" }, replaces: { skill: "overdrive", level: 4 } },
  // step: Captain Points earned x (1 + step x level)
  { id: "captainsAcademy", name: "Captain's Academy", flavor: "Graduates promote faster. Most of them even know which end of the ship is the front.", effect: "more Captain Points per Captain Prestige", cap: 3, costBase: 1, costStep: 1, step: 0.05, scalesOff: "lifetimeFleets", availableAt: { prestiges: { layer: "fleet", count: 2, scope: "current" } } },
  // step: Augment Points earned x (1 + step x level). Player name "Fleet Requisitions" (user pick
  // 2026-10-28: the main game's Homeworld talent branch keeps "Fleet Logistics"); the code id stays.
  { id: "fleetLogistics", name: "Fleet Requisitions", flavor: "Spreadsheets, but for warships. The admiral finds them deeply soothing.", effect: "more Augment Points per Fleet Prestige", cap: 3, costBase: 1, costStep: 1, step: 0.05, scalesOff: "fleetCount", availableAt: { prestiges: { layer: "fleet", count: 5, scope: "current" } } },
  // step: Dream Points earned x (1 + step x level)
  { id: "lucidPlanning", name: "Lucid Planning", flavor: "You planned this in a dream. The dream had a whiteboard.", effect: "more Dream Points per Prestigeception", cap: 2, costBase: 1, costStep: 2, step: 0.05, scalesOff: "lifetimePcs", availableAt: { prestiges: { layer: "pc", count: 2, scope: "lifetime" } } },
];

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th"}`;
}

const GATE_LAYER_NAMES = { captain: "Captain Prestige", fleet: "Fleet Prestige", pc: "Prestigeception" } as const;
// "this ..." for a current count: the layer whose reset clears it.
const GATE_CURRENT_SCOPE = { captain: " this Fleet", fleet: " this Prestigeception", pc: "" } as const;

// A gated skill's line, saying exactly when it opens (the signed-off mockup: "Opens at your 5th Fleet
// Prestige this Prestigeception (now 3)."). milestoneName is the gate milestone's name once it is
// visible, else "???"; now is the gate's count today (engine skillGateCount).
export function skillGateLine(gate: SkillGate, now: number, milestoneName: string): string {
  if ("milestone" in gate) return `Opens at ${milestoneName}.`;
  const { layer, count, scope } = gate.prestiges;
  return `Opens at your ${ordinal(count)} ${GATE_LAYER_NAMES[layer]}${scope === "current" ? GATE_CURRENT_SCOPE[layer] : ""} (now ${now}).`;
}

// The note under the skill list (the signed-off mockup).
export function skillGateLiftLine(): string {
  return `From your ${ordinal(SKILL_GATE_LIFT_PC)} Prestigeception on, every skill you have opened before is open from the start of each climb.`;
}

// What a skill's strength (engine skillStrength: step x level x scale factor) does, in words
// [PROPOSAL wording, after the mockup's sample rows].
export function skillEffectLine(id: LeveledSkillId, strength: number): string {
  const pct = (x: number) => `+${Math.round(x * 100)}%`;
  switch (id) {
    case "headStart":
      return `Resets begin with 1e${Math.round(strength > 0 ? strength : Math.log10(START_ORE))} Ore`;
    case "tenfoldTraining":
      return `Each ten bonus ×${(TEN_BONUS + strength).toFixed(2)}`;
    case "overdrive":
      return `Ore production ^${(1 + strength).toFixed(3)}`;
    case "captainsAcademy":
      return `Captain Points earned ${pct(strength)}`;
    case "fleetLogistics":
      return `Augment Points earned ${pct(strength)}`;
    case "lucidPlanning":
      return `Dream Points earned ${pct(strength)}`;
  }
}

// The scale chip: "×1.40 from your 6 lifetime Fleet Prestiges" (mockup).
const SCALE_COUNT_NAMES: Readonly<Record<SkillScaleCount, [string, string]>> = {
  lifetimeFleets: ["lifetime Fleet Prestige", "lifetime Fleet Prestiges"],
  captainSinceFleet: ["Captain Prestige this Fleet", "Captain Prestiges this Fleet"],
  lifetimePcs: ["Prestigeception", "Prestigeceptions"],
  fleetCount: ["Fleet Prestige this Prestigeception", "Fleet Prestiges this Prestigeception"],
};
export function skillScaleLine(scalesOff: SkillScaleCount, count: number, factor: number): string {
  const [one, many] = SCALE_COUNT_NAMES[scalesOff];
  return `×${factor.toFixed(2)} from your ${count} ${count === 1 ? one : many}`;
}

// 3.4 Skill Points per Fleet Prestige by LIFETIME Fleet count, front-loaded (user: "increase the total
// skill points we get for the first few fleet prestiges"). The first Fleet pays the first entry, and so
// on; past the end of the list every Fleet pays the last entry. Earning stops exactly when the points
// held cover every level still to buy (engine doFleetMut), so the schedule's lifetime total equals the
// cost of maxing every skill and no point is ever stranded (design 3.4, plan Review Focus 4). [PROVISIONAL]
export const SKILL_POINT_SCHEDULE: readonly number[] = [3, 3, 2, 2, 1];

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

export const COPY = {
  title: "HYPERION LEGACY v0.0000001a",
  listName: "Hyperion Legacy v0.0000001a", // in the Minigames list and the code window
  subtitle: "The original, with extra zeros.",
  footer: "It keeps running while it's closed, and while the game is closed.",
  captainBlurb: "The small reset. Your stack and Ore start over; Captain Points stay, and every one of them makes the whole stack run a little faster. Promotion by controlled demolition.",
  fleetBlurb: "The big reset. Trade your Captain Points for Augment Points and Skill Points. New generators unlock as your Fleet count grows. The admiral would like a word, and the word is \"more\".",
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
  // 0.14.0 rising bars (design 3.1, [PROPOSAL] wording approved 2026-10-27): the Fleet card once the
  // Fleet bar is above the Prestigeception bar (by design the signal to Prestigeception).
  pcFirst: "Prestigeception first",
  // 0.14.0 Slice 3 [PROPOSAL]: an automation's Skills row before its milestone, followed by the
  // milestone's name once that milestone is visible ("???" before).
  automationLockedPrefix: "Unlocks at",
  // 0.14.0 [PROPOSAL]: the Auto Captain row while it holds for Auto-buy I to IV (engine autoCaptainWaiting).
  autoCaptainWaiting: "Waiting for Auto-buy I to IV",
} as const;

// The Milestones list's reward column for a milestone that unlocks an automation [PROPOSAL]; revealed false
// for a secret one not shown yet (engine automationRevealed).
export function automationListLine(id: AutomationId, reached: boolean, revealed = true): string {
  if (!revealed) return reached ? MYSTERY_LIST_LINE.reached : MYSTERY_LIST_LINE.ahead;
  return reached ? `${AUTOMATION_NAMES[id]} unlocked` : `Unlocks ${AUTOMATION_NAMES[id]}`;
}

// The [?] Help view (0.13.11.1, design section 4): the rules in plain language, same voice as the
// rest of the game. It names no locked content (that stays "???" until reachable).
export const HELP_SECTIONS: readonly { title: string; body: string }[] = [
  { title: "THE STACK", body: "Mining Lasers make Ore. Every higher generator makes the one below it: Refineries make Mining Lasers, Fabricators make Refineries, and so on up the stack. Ore buys everything. It is generators all the way down." },
  { title: "THE TEN BONUS", body: "Every 10 of a generator you buy doubles its output. Owning them is nice; buying them is what counts." },
  { title: "OVERCLOCK AND UPGRADES", body: "Overclock lives in the Upgrades tab. It speeds up the whole stack by ×1.125 per level, and the levels multiply. Its price follows your income, so waiting never makes it cheaper. Much later, a few more upgrades wake up there. Each one has a level cap, shown as X / Y." },
  { title: "THREE KINDS OF PRESTIGE", body: "Captain Prestige resets your stack for Captain Points, and every point makes the stack faster. Fleet Prestige resets that too, for Augment Points, new generators and Skill Points (more for your first few, then one each, until you can max every skill). Prestigeception resets everything below it for Dream Points, which make every Captain and Augment Point you earn count for more. Yes, it is prestige all the way down as well." },
  { title: "THE FINE PRINT", body: "Augment Points speed up the whole stack the way Captain Points do, and only a Prestigeception takes them away. Dream Points are never taken away: they make every Captain and Augment Point you earn count for more. A Fleet Prestige uses up the climb that paid for it, so a Prestigeception needs a fresh climb to e10,000 Ore after one. A Prestigeception pays what its bar is worth however far past the bar you climb, so waiting earns nothing extra. New generators unlock at 1, 2, 3 and 6 lifetime Fleet Prestiges. Legal read this paragraph twice and then asked to be reset too." },
  // 0.14.0 Slices 3 and 4: automations moved from Skill Points to milestones, and the skills took levels
  // (short factual fixes; Slice 7 rewrites this section and THE FINE PRINT for the whole redesign).
  { title: "SKILLS", body: "Skill Points come from Fleet Prestige, more for your first few, and buy skill levels: a head start, a stronger ten bonus and more. Each level costs a little more than the last, each skill grows with a prestige count, and some open later in the climb (each one says when). The automations that do the clicking for you (auto-buyers, Captain and Fleet Prestige at a target you set, Prestigeception the moment you reach its bar) unlock at milestones instead, and each milestone says which one it unlocks (Auto Captain Prestige waits until Auto-buy I to IV is on, so a reset never leaves a stack nothing rebuilds). Once your Skill Points cover every level left, Fleet Prestige stops paying Skill Points; any you saved stay yours. The late game is mostly watching numbers go up, which is the point." },
  { title: "MILESTONES", body: "Milestones appear as you get close to them, and each one is recorded with the date you reached it. Many of them unlock an automation the moment you reach them (the popup says which, or keeps it a surprise); most other rewards arrive in a future update, and the last one pays out right away. You will know it when you see it." },
  { title: "RELIC BOOSTS", body: "The relics in your Museum, out in the real game, hum at this old build. Each kind boosts one thing in here (Stats lists them), and every copy helps a little less than the one before. Copies past a tier's 1,000 count five times over. Nothing in here ever flows back out, apart from a certain smugness." },
  { title: "TIME AWAY", body: "The stack keeps running while this window is closed and while the game is closed. Come back whenever you like. It does the work; you take the credit. Not those credits." },
];
