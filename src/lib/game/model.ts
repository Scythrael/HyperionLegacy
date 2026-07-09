import Decimal from "break_infinity.js";

// Data model — tech spec §1 (Data Model).
// Phase 4 (docs/plans/2026-07-06-phase4-navigation-progression-overhaul-plan.md):
// the Generator Stack economy (and everything built on top of it -- Research,
// Specializations, the Skill Tree, both Prestige tiers) has been retired in
// favor of the mission-based economy (below), a Homeworld crafting system
// (RECIPES/craftRecipe), and a captain XP/leveling system (xp/level/statPoints
// on CaptainState, xpForNextLevel below; the XP-awarding and level-up logic
// itself lives in tick.ts's tickCaptainMission). Captain slot growth is now
// handled by the Homeworld Talent Tree's Fleet Logistics branch (below) via
// buyHomeworldTalent's unlockCaptainSlot effect -- the old level-gated
// CAPTAIN_SLOT_UNLOCKS table/unlockCaptainSlot() function it superseded were
// removed in docs/plans/2026-07-07-captain-homeworld-talent-trees-plan.md's
// Task 4.

// Only "resourcer" is real today. Modeled as a union (not a bare string) so
// Phase 3+'s combat-type ships slot in as a new literal without touching
// every existing call site that pattern-matches on this field.
export type ShipType = "resourcer";

export type LootMaterialKey = "commonOre" | "uncommonMaterial" | "rareMaterial";

// Superset of LootMaterialKey: the 3 mission-loot tiers plus the 2 new
// crafted-good tiers the Homeworld crafting system (RECIPES, below) produces.
// homePlanet.storage is keyed on this wider type -- both raw loot delivery
// (tick.ts's tick()) and crafting (tick.ts's craftRecipe()) read/write the
// SAME storage object, just different subsets of its keys.
export type HomePlanetMaterialKey = LootMaterialKey | "refinedMaterial" | "components";

export type MissionPhase = "ordersReceived" | "transitOut" | "extracting" | "transitBack" | "unloading";

// Named (not an inline union), matching this file's convention for every
// other small enum (ShipType, CaptainTalentBranch, HomeworldTalentBranch) --
// gives future consumers (e.g. a tier-badge component) something to import
// instead of re-typing the literal union.
export type MissionTier = "I" | "II" | "III" | "IV" | "V";

export interface MissionDef {
  label: string;
  transitOutTicks: number;
  transitBackTicks: number;
  unloadTicks: number;
  extractionRatePerTick: number; // total units/tick, regardless of which tier they land as
  cargoCapacity: number; // total units across all tiers; MUST divide evenly by extractionRatePerTick
  // for this launch's requiredTicksForPhase() to have no partial-final-tick
  // edge case -- see that function's comment below if this is ever violated.
  // Per-tick occurrence chances (0-1) checked in sequential, mutually
  // exclusive priority order -- rare first, then uncommon, then a guaranteed
  // common fallback (2026-07-08 Extraction Rework -- see the design doc).
  // Exactly one tier wins per tick; see tick.ts's rollExtractionTick for the
  // exact algorithm and rng() call order.
  uncommonChance: number;
  rareChance: number;
  // Display-only grouping -- drives which SubTabs tier a mission renders under
  // in the Fleet Operations tab (a follow-up UI feature). Has NO effect on
  // tick math whatsoever; purely a presentational label read by the UI layer.
  tier: MissionTier;
  // Flat Fleet Admiral XP awarded once per completed mission CYCLE (not per
  // tick, unlike extractionRatePerTick above) -- mirrors how captain XP is
  // awarded (see tick.ts's XP_PER_MISSION_CYCLE), but each mission has its
  // OWN value rather than one shared constant, so a longer/harder mission
  // can be worth more. This is only the FIRST of several planned Fleet
  // Admiral XP sources (2026-07-08 user note: crafting, talent purchases,
  // and a future talent-tree effect boosting this value are all planned
  // later) -- the values here and xpForNextFleetAdminLevel's curve below are
  // deliberately NOT calibrated as if missions alone must carry the full
  // weight of Fleet Admiral progression. Don't "fix" this later assuming
  // it's undertuned for mission-only play -- it's intentionally left room
  // for other income streams to stack on top.
  fleetAdminXpPerCycle: number;
  // Flat credits awarded once per completed mission CYCLE (not per tick),
  // same convention as fleetAdminXpPerCycle above -- each mission has its OWN
  // value rather than one shared constant. This is a launch placeholder,
  // not balance-tested, same spirit as this file's other tunable constants.
  creditsPerCycle: number;
}

// 2 missions at launch: a fast, safe ore run and a slower one with better
// rare-material odds. Add a new entry here (and nowhere else -- App.svelte's
// Missions panel iterates this object) if a 3rd mission is ever wanted.
// Both entries' cargoCapacity divides evenly by extractionRatePerTick (90/1
// = 90) -- keep this true for any future entry too, or update
// requiredTicksForPhase's extracting case to handle a smaller final tick.
export const MISSIONS: Record<"shortOreRun" | "longOreRun", MissionDef> = {
  shortOreRun: {
    label: "Short Ore Run",
    transitOutTicks: 25,
    transitBackTicks: 25,
    unloadTicks: 8,
    extractionRatePerTick: 1,
    cargoCapacity: 90,
    uncommonChance: 0.019, // was lootTable weight 19/1000 (1.9%)
    rareChance: 0.001, // was lootTable weight 1/1000 (0.1%)
    tier: "I",
    fleetAdminXpPerCycle: 1,
    creditsPerCycle: 10,
  },
  longOreRun: {
    label: "Long Ore Run",
    transitOutTicks: 70,
    transitBackTicks: 70,
    unloadTicks: 8,
    extractionRatePerTick: 1,
    cargoCapacity: 90,
    uncommonChance: 0.08, // was lootTable weight 80/1000 (8%)
    rareChance: 0.02, // was lootTable weight 20/1000 (2%)
    tier: "I",
    fleetAdminXpPerCycle: 2,
    creditsPerCycle: 20,
  },
};

export type MissionKey = keyof typeof MISSIONS;

export interface CaptainMissionState {
  missionKey: MissionKey;
  phase: MissionPhase;
  phaseProgressTicks: number; // continuous (can be fractional mid-tick) so multi-tick deltas land on exact phase boundaries
  cargo: Record<LootMaterialKey, Decimal>;
  recalled: boolean; // if true, ends the loop (mission -> null) after THIS cycle's unloading completes,
  // instead of auto-restarting at ordersReceived. Does not interrupt the current cycle mid-flight.
}

// How many ticks a phase requires before advancing to the next one.
// "extracting" is the one phase whose length isn't a literal field on
// MissionDef -- it's however many ticks it takes to extract cargoCapacity
// units at extractionRatePerTick units/tick. Rounds up, which only matters
// if cargoCapacity doesn't divide evenly by extractionRatePerTick (today's
// launch content avoids this; see the MISSIONS comment above).
export function requiredTicksForPhase(phase: MissionPhase, missionDef: MissionDef): number {
  switch (phase) {
    case "ordersReceived":
      return 1;
    case "transitOut":
      return missionDef.transitOutTicks;
    case "extracting":
      return Math.ceil(missionDef.cargoCapacity / missionDef.extractionRatePerTick);
    case "transitBack":
      return missionDef.transitBackTicks;
    case "unloading":
      return missionDef.unloadTicks;
  }
}

export interface CaptainState {
  id: number;
  label: string; // placeholder, e.g. "Captain 1" -- naming UI deferred per master doc §10.7
  shipType: ShipType;
  mission: CaptainMissionState | null; // null when idle (idle captains have no passive economy -- see tick.ts)
  xp: Decimal; // accumulated toward the NEXT level -- see xpForNextLevel() below; awarded in tick.ts's tickCaptainMission on cycle completion
  level: number; // starts at 1
  statPoints: number; // unspent, earned on level-up -- spent via buyHomeworldTalent's unlockCaptainSlot effect (tick.ts)
  unlockedCaptainTalents: CaptainTalentKey[]; // this captain's own purchased Captain Talent keys -- see buyCaptainTalent (tick.ts)
  spec: CaptainTalentBranch | null; // this captain's chosen Captain Specialization, if any -- null means no CAPTAIN_SPEC_BONUS entry applies yet (see that table below)
}

export interface GameState {
  captains: CaptainState[];
  tickDurationSeconds: number; // fleet-wide tick cadence -- every captain advances in lockstep on this single cadence (collapsed from a per-captain field during the UI Redesign; see docs/plans/2026-07-07-ui-redesign-design.md)
  gameTimeSeconds: number; // accumulated in-game seconds, fleet-wide, per tech spec §1
  homePlanet: { storage: Record<HomePlanetMaterialKey, Decimal> }; // fleet-wide mission loot + crafted goods, separate from any captain's own state
  unlockedHomeworldTalents: HomeworldTalentKey[]; // fleet-wide purchased Homeworld Talent keys -- see buyHomeworldTalent (tick.ts)
  fleetAdminXp: Decimal; // Fleet Admiral leveling -- see applyFleetAdminXp (tick.ts)
  fleetAdminLevel: number; // starts at 1
  adminPoints: number; // unspent, spent via buyHomeworldTalent (tick.ts)
  credits: Decimal;
}

export type RecipeKey = "refineUnobtainium" | "fabricateComponents";

export interface RecipeDef {
  label: string;
  inputs: Partial<Record<HomePlanetMaterialKey, Decimal>>;
  output: { key: HomePlanetMaterialKey; amount: Decimal };
}

// 2 recipes at launch, one per structure -- proves the crafting mechanic.
// Add entries here (and nowhere else -- App.svelte's Homeworld panels iterate
// this object) as the "fully fleshed out crafting system" grows later.
export const RECIPES: Record<RecipeKey, RecipeDef> = {
  refineUnobtainium: {
    label: "Refine Unobtainium Ore",
    inputs: { commonOre: new Decimal(10) },
    output: { key: "refinedMaterial", amount: new Decimal(1) },
  },
  fabricateComponents: {
    label: "Fabricate Components",
    inputs: { refinedMaterial: new Decimal(5) },
    output: { key: "components", amount: new Decimal(1) },
  },
};

// Open-ended (levels can climb indefinitely) -- a formula, not a finite table
// like HOMEWORLD_TALENTS' Fleet Logistics branch below (hand-tuned per entry).
export function xpForNextLevel(level: number): number {
  return 100 * level;
}

// Deliberately much steeper than a captain's own xpForNextLevel -- the
// intent (per design doc) is that Fleet Admiral levels lag well behind
// individual captain levels. A simple quadratic-ish curve achieves that
// without needing per-level hand-tuning (unlike a Fleet-Logistics-style
// finite talent table).
//
// 2026-07-08 (docs/plans/2026-07-08-fleet-admiral-xp-rework-plan.md):
// multiplier bumped from 500 to 2500 as part of switching Fleet Admiral XP
// from "recomputed as the sum of captain levels" (effectively frozen under
// realistic play -- confirmed live, see this plan's design doc) to
// "earned per completed mission cycle," mirroring captain XP. This value is
// a launch placeholder, same convention as MISSIONS/RECIPES/talent costs
// elsewhere in this codebase -- and per the user's own explicit note,
// deliberately NOT calibrated assuming mission XP is the only income source
// Fleet Admiral leveling will ever have (more sources are planned later).
export function xpForNextFleetAdminLevel(level: number): number {
  return 2500 * level * level;
}

// --- Captain & Homeworld Talent Trees (docs/plans/2026-07-07-captain-homeworld-talent-trees-plan.md) ---
// Two new data-driven tables, mirroring the exact conventions the (now-deleted)
// Skill Tree established -- branch/label/cost/requires (same-branch
// prerequisite) plus a typed effect. The old level-gated CAPTAIN_SLOT_UNLOCKS
// table and its unlockCaptainSlot() function (tick.ts) have been removed --
// Fleet Logistics below (via buyHomeworldTalent's unlockCaptainSlot effect)
// fully absorbed that mechanism's job as of Task 4.
// Radial Skill Web (docs/plans/2026-07-08-radial-skill-web-plan.md, Task 1)
// shrank this union from the old five-column linear model
// ("command"/"tactical"/"science"/"resourcefulness"/"diplomacy") to the three
// captain branches the radial web ships with. "command"/"diplomacy" are gone
// -- their old content is either dropped or re-homed onto the surviving
// branches by the Task 2 data rewrite. Anything still referencing the removed
// members (CAPTAIN_SPEC_BONUS, CAPTAIN_TALENTS entries, tick.ts) is expected to
// dangle until Tasks 2/5/7 clean it up; that intermediate breakage is by design.
export type CaptainTalentBranch = "resourcefulness" | "tactical" | "science";
export type HomeworldTalentBranch = "fleetLogistics" | "homelandDefense" | "citizenry" | "economy" | "industry";

export type CaptainTalentEffect =
  | { type: "commonYieldMult"; mult: number }
  | { type: "uncommonYieldMult"; mult: number }
  | { type: "uncommonChanceMult"; mult: number }
  | { type: "rareChanceMult"; mult: number }
  | { type: "bonusRollChance"; chance: number }
  | { type: "bonusRollChanceMult"; mult: number }
  // Radial Skill Web (Task 2): a genuinely-null gateway effect. Used by the
  // Tactician/Explorer hubs, which are "learn me first" seeds for branches
  // whose real mechanics (combat / a redefined science system) don't exist
  // yet. Chosen over a `commonYieldMult`/`mult: 0.0` placeholder because that
  // would render through describeCaptainTalentEffect as a misleading
  // "+0.0% Common Ore yield" line on a combat/science node -- a `none` member
  // renders honestly as "no bonus yet" instead. Carries no payload; the tick
  // economy (tick.ts) simply has nothing to apply for it. When those systems
  // land, the hub's effect changes to a real member and this stays available
  // for any future pure-gateway node.
  | { type: "none" };

// unlockCaptainSlot carries no gate beyond the node's own `cost` (adminPoints)
// -- Homeworld Talents are fleet-wide Fleet Admiral prestige, spent purely
// from the fleet's adminPoints pool, entirely independent of any individual
// captain's own level/statPoints (those only ever gate that captain's OWN
// Captain Talents, a completely separate tree/pool). The old CAPTAIN_SLOT_UNLOCKS
// mechanism this replaced WAS captain-scoped (atLevel/statPointCost/componentsCost),
// but that scoping was deliberately dropped, not carried forward, when Fleet
// Logistics absorbed the job in Task 4 -- confirmed with the user rather than
// left as unenforced vestigial fields.
export type HomeworldTalentEffect =
  | { type: "unlockCaptainSlot" }
  | { type: "rareYieldMult"; mult: number }
  | { type: "recipeBonusOutput"; recipeKey: RecipeKey; bonus: number }
  | { type: "passiveTrickle"; material: HomePlanetMaterialKey; perTick: number };

// Radial Skill Web (docs/plans/2026-07-08-radial-skill-web-plan.md, Task 1):
// the def shape moved from a linear `requires` prerequisite to a graph. The
// former `requires: <key> | null` field is REMOVED; adjacency now lives in
// `neighbors[]`, which is bidirectional by convention and drives BOTH the
// rendered connectors and the fog-of-war learnable rule (a node is learnable
// when it neighbors an owned node, seeded from the branch's `isHub`). `x`/`y`
// are web-space coordinates (branch hub at 0,0). Buy-gating switches from the
// old prerequisite check to this adjacency in Task 5.
export interface CaptainTalentDef {
  branch: CaptainTalentBranch;
  label: string;
  cost: number; // statPoints
  x: number;    // web-space coordinate; hub at (0,0)
  y: number;
  neighbors: CaptainTalentKey[]; // bidirectional by convention; drives BOTH connectors and fog-of-war
  isHub?: boolean;               // exactly one per branch; the fog-of-war seed (always visible, learn first)
  flavor: string;                // short narrative blurb -- surfaced in the talent-tree tooltips
}

export interface HomeworldTalentDef {
  branch: HomeworldTalentBranch;
  label: string;
  cost: number; // adminPoints
  x: number;
  y: number;
  neighbors: HomeworldTalentKey[];
  isHub?: boolean;
  flavor: string; // short narrative blurb -- surfaced in the talent-tree tooltips
}

// NOTE: effect lives on the *Def directly below via a second field, not nested
// inside CaptainTalentDef/HomeworldTalentDef above -- TypeScript can't express
// "this interface's shape depends on which union member `effect` is" cleanly
// without generics that would over-complicate a launch table this small, so
// each entry below is typed with an explicit inline `& { effect: ... }`.

// Radial Skill Web (docs/plans/2026-07-08-radial-skill-web-plan.md, Task 2):
// this table is now a radial GRAPH, not a set of linear prerequisite chains.
// Each entry carries hand-authored web-space coordinates (x/y, hub at 0,0) and
// a bidirectional `neighbors[]` adjacency list that drives BOTH the rendered
// connectors and the fog-of-war/buy-gating rule (a node is learnable once it
// neighbors an owned node; each branch is seeded by its single `isHub` node).
//
// Content this build ships (design §6.1-6.2 -- lean and honest):
//   - resourcefulness ("Prospector") is the ONE rich tree. Its hub plus the
//     re-homed ex-`command` extraction talents (Bulk -> Refined Extraction,
//     commonYieldMult/uncommonYieldMult -- extraction yield fits the salvage
//     theme) and the existing Keen Eye I/II + Lucky Strike I/II.
//   - tactical ("Tactician") and science ("Explorer") are a single gateway
//     hub each -- "learn me first" seeds for branches whose real mechanics
//     (combat / a redefined science system) don't exist yet. Their hubs carry
//     a `{ type: "none" }` effect (an honest "no bonus yet", NOT a misleading
//     0.0 yield placeholder) so they render correctly but grant nothing until
//     their systems land. No inert filler nodes are authored for them.
//
// `command`/`diplomacy` are GONE (removed with the old five-column model in
// Task 1); their content is either dropped (diplomacy) or re-homed onto
// resourcefulness (command's extraction talents). Coordinates below are the
// hand-authored placement -- tunable at the Task 12 device checkpoint, same
// launch-placeholder spirit as MISSIONS'/RECIPES' constants. Add entries here
// (and nowhere else -- App.svelte's Captain Talents panel iterates this object)
// when a branch's system is ready.
export type CaptainTalentKey =
  // resourcefulness ("Prospector") -- the rich tree
  | "prospectorHub"
  | "prospectorBulkExtraction" // ex-commandExtractionI
  | "prospectorRefinedExtraction" // ex-commandExtractionII
  | "prospectorKeenEyeI"
  | "prospectorKeenEyeII"
  | "prospectorLuckyStrikeI"
  | "prospectorLuckyStrikeII"
  // tactical ("Tactician") -- lean gateway stub until combat exists
  | "tacticianHub"
  // science ("Explorer") -- lean gateway stub until a science mechanic exists
  | "explorerHub";

export const CAPTAIN_TALENTS: Record<CaptainTalentKey, CaptainTalentDef & { effect: CaptainTalentEffect }> = {
  // --- resourcefulness ("Prospector") -----------------------------------
  prospectorHub: {
    branch: "resourcefulness",
    label: "Prospector's Instinct",
    cost: 1,
    x: 0,
    y: 0,
    isHub: true,
    neighbors: ["prospectorBulkExtraction", "prospectorKeenEyeI"],
    effect: { type: "commonYieldMult", mult: 0.05 },
    flavor: "The nose for value that separates a prospector from a tourist.",
  },
  prospectorBulkExtraction: {
    branch: "resourcefulness",
    label: "Bulk Extraction",
    cost: 2,
    x: -180,
    y: -120,
    neighbors: ["prospectorHub", "prospectorRefinedExtraction"],
    effect: { type: "commonYieldMult", mult: 0.1 }, // was extractionYieldMult, ex-command
    flavor:
      "Standard doctrine trades finesse for throughput -- pull more common ore per cycle, no questions asked.",
  },
  prospectorRefinedExtraction: {
    branch: "resourcefulness",
    label: "Refined Extraction",
    cost: 4,
    x: -320,
    y: -200,
    neighbors: ["prospectorBulkExtraction"],
    effect: { type: "uncommonYieldMult", mult: 0.15 }, // was extractionYieldMult, ex-command
    flavor:
      "Field engineers recalibrate the intake manifolds to favor uncommon deposits over raw volume.",
  },
  prospectorKeenEyeI: {
    branch: "resourcefulness",
    label: "Keen Eye I",
    cost: 2,
    x: 180,
    y: -120,
    neighbors: ["prospectorHub", "prospectorKeenEyeII"],
    effect: { type: "uncommonChanceMult", mult: 0.25 }, // was rareLootChanceMult
    flavor:
      "A trained eye catches what the sensors miss -- subtle mineral banding invisible to standard scans.",
  },
  prospectorKeenEyeII: {
    branch: "resourcefulness",
    label: "Keen Eye II",
    cost: 4,
    x: 320,
    y: -200,
    neighbors: ["prospectorKeenEyeI", "prospectorLuckyStrikeI"],
    effect: { type: "rareChanceMult", mult: 0.5 }, // was rareLootChanceMult
    flavor: "Years of fieldwork sharpen instinct into something the manuals can't teach.",
  },
  prospectorLuckyStrikeI: {
    branch: "resourcefulness",
    label: "Lucky Strike I",
    cost: 6,
    x: 300,
    y: 40,
    neighbors: ["prospectorKeenEyeII", "prospectorLuckyStrikeII"],
    effect: { type: "bonusRollChance", chance: 0.02 },
    flavor:
      "Some captains just have a feel for where the good ore sits. Call it luck; call it experience.",
  },
  prospectorLuckyStrikeII: {
    branch: "resourcefulness",
    label: "Lucky Strike II",
    cost: 8,
    x: 420,
    y: 120,
    neighbors: ["prospectorLuckyStrikeI"],
    effect: { type: "bonusRollChanceMult", mult: 1.0 },
    flavor: "When the feeling's right twice in a row, it stops being coincidence.",
  },
  // --- tactical ("Tactician") -- gateway hub only -----------------------
  tacticianHub: {
    branch: "tactical",
    label: "Combat Readiness",
    cost: 1,
    x: 0,
    y: 0,
    isHub: true,
    neighbors: [], // no content nodes yet -- grows when combat lands (design §6.2)
    effect: { type: "none" }, // pure gateway; no combat system to hang a real effect on yet
    flavor: "Discipline first. The rest of the doctrine comes when there's a war to fight.",
  },
  // --- science ("Explorer") -- gateway hub only -------------------------
  explorerHub: {
    branch: "science",
    label: "Survey Doctrine",
    cost: 1,
    x: 0,
    y: 0,
    isHub: true,
    neighbors: [], // no content nodes yet -- grows when a science mechanic lands
    effect: { type: "none" }, // pure gateway; no science system to hang a real effect on yet
    flavor: "Every uncharted system is a question. Answering it starts here.",
  },
};

// Innate bonus granted once a captain has this branch chosen as their spec
// (CaptainState.spec) -- separate from, and additive with, whatever they've
// bought in the talent tree itself. Deliberately Partial<...>: a branch with
// NO entry here is not yet selectable as a spec at all (tactical/science
// today -- their underlying systems, Combat/a redefined Science mechanic,
// don't exist yet, so there's nothing meaningful to grant a bonus FOR).
// Revives the Phase 1 "Captain Prestige panel + specialization picker"
// mechanic (retired during the Phase 4 Navigation/Progression Overhaul along
// with the old Generator Stack economy it was built on), now expressed
// against this newer Captain Talent tree instead.
//
// Radial Skill Web (Task 2): the `command` entry was dropped along with the
// command branch itself. resourcefulness ("Prospector") is the only branch
// with a real spec bonus at launch -- the sole selectable spec until tactical
// or science earns its own system (and thus its own spec bonus).
export const CAPTAIN_SPEC_BONUS: Partial<Record<CaptainTalentBranch, CaptainTalentEffect>> = {
  resourcefulness: { type: "bonusRollChance", chance: 0.01 },
};

// Fleet Logistics' 3 slot-unlock tiers below fully replace the old
// CAPTAIN_SLOT_UNLOCKS table/unlockCaptainSlot() mechanism, removed in Task 4.
// Homeland Defense and Citizenry are deliberately EMPTY, same reasoning as
// Tactical/Science/Diplomacy above (need Battlespace / a population system,
// neither exists yet). Costs below are launch placeholders, same as
// CAPTAIN_TALENTS' own -- not balance-tested.
export type HomeworldTalentKey =
  | "fleetLogisticsSlot1"
  | "fleetLogisticsSlot2"
  | "fleetLogisticsSlot3"
  | "fleetLogisticsYield"
  | "industryBonusOutput"
  | "economyTrickle";

export const HOMEWORLD_TALENTS: Record<HomeworldTalentKey, HomeworldTalentDef & { effect: HomeworldTalentEffect }> = {
  fleetLogisticsSlot1: {
    branch: "fleetLogistics",
    label: "Recruit Captain (2nd slot)",
    cost: 3,
    requires: null,
    effect: { type: "unlockCaptainSlot" },
    flavor: "Fleet Command approves a second commission -- the roster grows.",
  },
  fleetLogisticsSlot2: {
    branch: "fleetLogistics",
    label: "Recruit Captain (3rd slot)",
    cost: 5,
    requires: "fleetLogisticsSlot1",
    effect: { type: "unlockCaptainSlot" },
    flavor: "A third captain's chair, funded and ready. The fleet expands.",
  },
  fleetLogisticsSlot3: {
    branch: "fleetLogistics",
    label: "Recruit Captain (4th slot)",
    cost: 8,
    requires: "fleetLogisticsSlot2",
    effect: { type: "unlockCaptainSlot" },
    flavor: "Four commands under one banner -- logistics finally caught up with ambition.",
  },
  fleetLogisticsYield: {
    branch: "fleetLogistics",
    label: "Fleet Requisitions",
    cost: 4,
    requires: null,
    effect: { type: "rareYieldMult", mult: 0.05 }, // was fleetExtractionYieldMult
    flavor:
      "Standing orders redirect a share of every rare find straight back to the fleet's reserves.",
  },
  industryBonusOutput: {
    branch: "industry",
    label: "Tooling Upgrade",
    cost: 4,
    requires: null,
    effect: { type: "recipeBonusOutput", recipeKey: "fabricateComponents", bonus: 1 },
    flavor: "New jigs and fixtures on the fabrication line mean every batch stretches a little further.",
  },
  economyTrickle: {
    branch: "economy",
    label: "Trade Contacts",
    cost: 3,
    requires: null,
    effect: { type: "passiveTrickle", material: "commonOre", perTick: 1 },
    flavor:
      "A quiet arrangement with independent traders keeps a slow, steady trickle of ore flowing home.",
  },
};

// What a brand-new (or newly-unlocked) captain slot starts with. There is no
// more prestige to reset a captain THROUGH -- this is purely the baseline for
// a slot that has never been played.
export function freshCaptainStack(): Pick<
  CaptainState,
  "mission" | "xp" | "level" | "statPoints" | "unlockedCaptainTalents" | "spec"
> {
  return {
    mission: null,
    xp: new Decimal(0),
    level: 1,
    statPoints: 0,
    unlockedCaptainTalents: [],
    spec: null,
  };
}

// Generates `count` captains (ids 1..count) sharing the same freshCaptainStack()
// baseline. Used for: a brand-new save (freshState calls freshCaptains(1))
// and save migration (backfilling a never-played slot). NOTE: a slot unlock
// (tick.ts's buyHomeworldTalent, unlockCaptainSlot effect) does NOT call this
// function -- it inlines its own captain object using freshCaptainStack()
// directly, same as this function's loop body does below.
export function freshCaptains(count: number): CaptainState[] {
  const captains: CaptainState[] = [];
  for (let i = 1; i <= count; i++) {
    captains.push({
      id: i,
      label: `Captain ${i}`,
      shipType: "resourcer",
      ...freshCaptainStack(),
    });
  }
  return captains;
}

export function freshState(): GameState {
  return {
    captains: freshCaptains(1),
    tickDurationSeconds: 1,
    gameTimeSeconds: 0,
    homePlanet: {
      storage: {
        commonOre: new Decimal(0),
        uncommonMaterial: new Decimal(0),
        rareMaterial: new Decimal(0),
        refinedMaterial: new Decimal(0),
        components: new Decimal(0),
      },
    },
    unlockedHomeworldTalents: [],
    fleetAdminXp: new Decimal(0),
    fleetAdminLevel: 1,
    adminPoints: 0,
    credits: new Decimal(0),
  };
}
