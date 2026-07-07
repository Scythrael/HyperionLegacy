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

export interface LootTableEntry {
  material: LootMaterialKey;
  weight: number; // out of the table's total weight
}

export type MissionPhase = "ordersReceived" | "transitOut" | "extracting" | "transitBack" | "unloading";

export interface MissionDef {
  label: string;
  transitOutTicks: number;
  transitBackTicks: number;
  unloadTicks: number;
  extractionRatePerTick: number; // total units/tick, regardless of which tier they land as
  cargoCapacity: number; // total units across all tiers; MUST divide evenly by extractionRatePerTick
  // for this launch's requiredTicksForPhase() to have no partial-final-tick
  // edge case -- see that function's comment below if this is ever violated.
  lootTable: LootTableEntry[];
}

// 2 missions at launch: a fast, safe ore run and a slower one with better
// rare-material odds. Add a new entry here (and nowhere else -- App.svelte's
// Missions panel iterates this object) if a 3rd mission is ever wanted.
// Both entries' cargoCapacity divides evenly by extractionRatePerTick (100/10
// = 10) -- keep this true for any future entry too, or update
// requiredTicksForPhase's extracting case to handle a smaller final tick.
export const MISSIONS: Record<"shortOreRun" | "longOreRun", MissionDef> = {
  shortOreRun: {
    label: "Short Ore Run",
    transitOutTicks: 3,
    transitBackTicks: 3,
    unloadTicks: 1,
    extractionRatePerTick: 10,
    cargoCapacity: 100,
    lootTable: [
      { material: "commonOre", weight: 980 },
      { material: "uncommonMaterial", weight: 19 },
      { material: "rareMaterial", weight: 1 },
    ],
  },
  longOreRun: {
    label: "Long Ore Run",
    transitOutTicks: 8,
    transitBackTicks: 8,
    unloadTicks: 1,
    extractionRatePerTick: 10,
    cargoCapacity: 100,
    lootTable: [
      { material: "commonOre", weight: 900 },
      { material: "uncommonMaterial", weight: 80 },
      { material: "rareMaterial", weight: 20 },
    ],
  },
};

export type MissionKey = keyof typeof MISSIONS;

export interface CaptainMissionState {
  missionKey: MissionKey;
  phase: MissionPhase;
  phaseProgressTicks: number; // continuous (can be fractional mid-tick) so multi-tick deltas land on exact phase boundaries
  cargo: Record<LootMaterialKey, number>;
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

// Weighted random pick from a loot table. `rng` defaults to Math.random for
// real gameplay; tests inject a fixed value to hit a specific tier
// deterministically (see model.test.ts's "rollLootTable" tests for the exact
// boundary behavior this produces). Walks entries in the table's own order,
// accumulating weight, and picks the first entry whose cumulative weight
// STRICTLY EXCEEDS `rng() * totalWeight` -- this (not `>=`) is what keeps
// each entry's actual probability mass equal to its stated weight; a
// non-strict comparison would silently shift one unit of probability mass
// from each entry to the next one in the table.
//
// Assumes `lootTable` is non-empty with positive weights -- true of every
// MISSIONS entry today. An empty table (or one summing to 0) would fall
// through the loop and crash on `lootTable[-1].material` below, rather than
// silently misbehaving -- not reachable through any current code path, but
// worth knowing if a future mission is ever defined with a malformed table.
export function rollLootTable(lootTable: LootTableEntry[], rng: () => number = Math.random): LootMaterialKey {
  const totalWeight = lootTable.reduce((sum, entry) => sum + entry.weight, 0);
  const roll = rng() * totalWeight;
  let cumulative = 0;
  for (const entry of lootTable) {
    cumulative += entry.weight;
    if (roll < cumulative) return entry.material;
  }
  return lootTable[lootTable.length - 1].material; // floating-point fallback, should be unreachable
}

export interface CaptainState {
  id: number;
  label: string; // placeholder, e.g. "Captain 1" -- naming UI deferred per master doc §10.7
  shipType: ShipType;
  tickDurationSeconds: number; // this captain's own tick-bar cycle length; cadences can diverge between captains
  mission: CaptainMissionState | null; // null when idle (idle captains have no passive economy -- see tick.ts)
  xp: number; // accumulated toward the NEXT level -- see xpForNextLevel() below; awarded in tick.ts's tickCaptainMission on cycle completion
  level: number; // starts at 1
  statPoints: number; // unspent, earned on level-up -- spent via buyHomeworldTalent's unlockCaptainSlot effect (tick.ts)
  unlockedCaptainTalents: CaptainTalentKey[]; // this captain's own purchased Captain Talent keys -- see buyCaptainTalent (tick.ts)
}

export interface GameState {
  captains: CaptainState[];
  gameTimeSeconds: number; // accumulated in-game seconds, fleet-wide, per tech spec §1
  homePlanet: { storage: Record<HomePlanetMaterialKey, number> }; // fleet-wide mission loot + crafted goods, separate from any captain's own state
  unlockedHomeworldTalents: HomeworldTalentKey[]; // fleet-wide purchased Homeworld Talent keys -- see buyHomeworldTalent (tick.ts)
  fleetAdminXp: number; // Fleet Admiral leveling -- see recomputeFleetAdmin (tick.ts)
  fleetAdminLevel: number; // starts at 1
  adminPoints: number; // unspent, spent via buyHomeworldTalent (tick.ts)
}

export type RecipeKey = "refineUnobtainium" | "fabricateComponents";

export interface RecipeDef {
  label: string;
  inputs: Partial<Record<HomePlanetMaterialKey, number>>;
  output: { key: HomePlanetMaterialKey; amount: number };
}

// 2 recipes at launch, one per structure -- proves the crafting mechanic.
// Add entries here (and nowhere else -- App.svelte's Homeworld panels iterate
// this object) as the "fully fleshed out crafting system" grows later.
export const RECIPES: Record<RecipeKey, RecipeDef> = {
  refineUnobtainium: {
    label: "Refine Unobtainium Ore",
    inputs: { commonOre: 10 },
    output: { key: "refinedMaterial", amount: 1 },
  },
  fabricateComponents: {
    label: "Fabricate Components",
    inputs: { refinedMaterial: 5 },
    output: { key: "components", amount: 1 },
  },
};

// Open-ended (levels can climb indefinitely) -- a formula, not a finite table
// like HOMEWORLD_TALENTS' Fleet Logistics branch below (hand-tuned per entry).
export function xpForNextLevel(level: number): number {
  return 100 * level;
}

// Deliberately much steeper than a captain's own xpForNextLevel -- the
// intent (per design doc) is "level-50 captains might only mean a level 3-4
// Fleet Admiral." A simple quadratic-ish curve achieves that without needing
// per-level hand-tuning (unlike a Fleet-Logistics-style finite talent table).
//
// CAUTION (found during Task 3 hand-tracing, not corrected here without
// approval -- see this task's session report): with today's fleet cap of 4
// captains (1 starting + 3 Fleet Logistics slot-unlock tiers), the
// design doc's own worked example doesn't actually hold under this formula.
// xpForNextFleetAdminLevel(1) = 500, but 4 captains all at level 50 only sum
// to 200 -- short of even the FIRST Fleet Admiral level-up. Reaching Admiral
// level 3-4 (cumulative sum 2500-7000) is not reachable by any realistic
// captain-level sum under the current 4-captain cap. The formula is
// implemented here exactly as the plan specifies; the mismatch against the
// design doc's own framing is a balance question for a follow-up task, not
// something silently patched here.
export function xpForNextFleetAdminLevel(level: number): number {
  return 500 * level * level;
}

// --- Captain & Homeworld Talent Trees (docs/plans/2026-07-07-captain-homeworld-talent-trees-plan.md) ---
// Two new data-driven tables, mirroring the exact conventions the (now-deleted)
// Skill Tree established -- branch/label/cost/requires (same-branch
// prerequisite) plus a typed effect. The old level-gated CAPTAIN_SLOT_UNLOCKS
// table and its unlockCaptainSlot() function (tick.ts) have been removed --
// Fleet Logistics below (via buyHomeworldTalent's unlockCaptainSlot effect)
// fully absorbed that mechanism's job as of Task 4.
export type CaptainTalentBranch = "command" | "tactical" | "science" | "resourcefulness" | "diplomacy";
export type HomeworldTalentBranch = "fleetLogistics" | "homelandDefense" | "citizenry" | "economy" | "industry";

export type CaptainTalentEffect =
  | { type: "extractionYieldMult"; mult: number }
  | { type: "rareLootChanceMult"; mult: number };

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
  | { type: "fleetExtractionYieldMult"; mult: number }
  | { type: "recipeBonusOutput"; recipeKey: RecipeKey; bonus: number }
  | { type: "passiveTrickle"; material: HomePlanetMaterialKey; perTick: number };

export interface CaptainTalentDef {
  branch: CaptainTalentBranch;
  label: string;
  cost: number; // statPoints
  requires: CaptainTalentKey | null; // same-branch prerequisite, same convention as the old Skill Tree
}

export interface HomeworldTalentDef {
  branch: HomeworldTalentBranch;
  label: string;
  cost: number; // adminPoints
  requires: HomeworldTalentKey | null;
}

// NOTE: effect lives on the *Def directly below via a second field, not nested
// inside CaptainTalentDef/HomeworldTalentDef above -- TypeScript can't express
// "this interface's shape depends on which union member `effect` is" cleanly
// without generics that would over-complicate a launch table this small, so
// each entry below is typed with an explicit inline `& { effect: ... }`.

// Only Command and Resourcefulness get real launch content. Tactical, Science,
// and Diplomacy are deliberately EMPTY (zero entries with that branch) --
// each depends on a system that doesn't exist yet (combat, a redefined
// Science mechanic). The UI iterates the fixed 5-branch list, not this
// table's keys, so an empty branch still renders as a labeled column with
// nothing in it. Add entries here (and nowhere else -- App.svelte's Captain
// Talents panel iterates this object) when a branch's system is ready.
// Costs below are launch placeholders, not balance-tested, same spirit as
// MISSIONS'/RECIPES' own tunable constants.
export type CaptainTalentKey =
  | "commandExtractionI"
  | "commandExtractionII"
  | "resourcefulnessRareChanceI"
  | "resourcefulnessRareChanceII";

export const CAPTAIN_TALENTS: Record<CaptainTalentKey, CaptainTalentDef & { effect: CaptainTalentEffect }> = {
  commandExtractionI: {
    branch: "command",
    label: "Command Efficiency I",
    cost: 2,
    requires: null,
    effect: { type: "extractionYieldMult", mult: 0.1 },
  },
  commandExtractionII: {
    branch: "command",
    label: "Command Efficiency II",
    cost: 4,
    requires: "commandExtractionI",
    effect: { type: "extractionYieldMult", mult: 0.15 },
  },
  resourcefulnessRareChanceI: {
    branch: "resourcefulness",
    label: "Keen Eye I",
    cost: 2,
    requires: null,
    effect: { type: "rareLootChanceMult", mult: 0.25 },
  },
  resourcefulnessRareChanceII: {
    branch: "resourcefulness",
    label: "Keen Eye II",
    cost: 4,
    requires: "resourcefulnessRareChanceI",
    effect: { type: "rareLootChanceMult", mult: 0.5 },
  },
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
  },
  fleetLogisticsSlot2: {
    branch: "fleetLogistics",
    label: "Recruit Captain (3rd slot)",
    cost: 5,
    requires: "fleetLogisticsSlot1",
    effect: { type: "unlockCaptainSlot" },
  },
  fleetLogisticsSlot3: {
    branch: "fleetLogistics",
    label: "Recruit Captain (4th slot)",
    cost: 8,
    requires: "fleetLogisticsSlot2",
    effect: { type: "unlockCaptainSlot" },
  },
  fleetLogisticsYield: {
    branch: "fleetLogistics",
    label: "Fleet Requisitions",
    cost: 4,
    requires: null,
    effect: { type: "fleetExtractionYieldMult", mult: 0.05 },
  },
  industryBonusOutput: {
    branch: "industry",
    label: "Tooling Upgrade",
    cost: 4,
    requires: null,
    effect: { type: "recipeBonusOutput", recipeKey: "fabricateComponents", bonus: 1 },
  },
  economyTrickle: {
    branch: "economy",
    label: "Trade Contacts",
    cost: 3,
    requires: null,
    effect: { type: "passiveTrickle", material: "commonOre", perTick: 1 },
  },
};

// What a brand-new (or newly-unlocked) captain slot starts with. There is no
// more prestige to reset a captain THROUGH -- this is purely the baseline for
// a slot that has never been played.
export function freshCaptainStack(): Pick<
  CaptainState,
  "tickDurationSeconds" | "mission" | "xp" | "level" | "statPoints" | "unlockedCaptainTalents"
> {
  return {
    tickDurationSeconds: 10,
    mission: null,
    xp: 0,
    level: 1,
    statPoints: 0,
    unlockedCaptainTalents: [],
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
    gameTimeSeconds: 0,
    homePlanet: { storage: { commonOre: 0, uncommonMaterial: 0, rareMaterial: 0, refinedMaterial: 0, components: 0 } },
    unlockedHomeworldTalents: [],
    fleetAdminXp: 0,
    fleetAdminLevel: 1,
    adminPoints: 0,
  };
}
