// Data model — tech spec §1 (Data Model).
// Phase 4 (docs/plans/2026-07-06-phase4-navigation-progression-overhaul-plan.md):
// the Generator Stack economy (and everything built on top of it -- Research,
// Specializations, the Skill Tree, both Prestige tiers) has been retired in
// favor of the mission-based economy (below), a Homeworld crafting system
// (RECIPES/craftRecipe), and a captain XP/leveling system (xp/level/statPoints
// on CaptainState, xpForNextLevel/CAPTAIN_SLOT_UNLOCKS below; the XP-awarding
// and level-up logic itself lives in tick.ts's tickCaptainMission).

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
  statPoints: number; // unspent, earned on level-up -- spent via unlockCaptainSlot() (tick.ts)
}

export interface GameState {
  captains: CaptainState[];
  gameTimeSeconds: number; // accumulated in-game seconds, fleet-wide, per tech spec §1
  homePlanet: { storage: Record<HomePlanetMaterialKey, number> }; // fleet-wide mission loot + crafted goods, separate from any captain's own state
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

// Open-ended (levels can climb indefinitely) -- a formula, not a table, unlike
// CAPTAIN_SLOT_UNLOCKS below (which is finite and worth hand-tuning per entry).
export function xpForNextLevel(level: number): number {
  return 100 * level;
}

export interface CaptainSlotUnlockDef {
  atLevel: number; // the unlocking captain must be at least this level
  statPointCost: number; // deducted from the unlocking captain's OWN statPoints
  componentsCost: number; // deducted from the shared, fleet-wide homePlanet.storage.components
}

// Ordered by slot number (index 0 = the 2nd captain slot, since slot 1 always
// exists). Small and hand-tunable on purpose -- unlike level count, there are
// only ever a few of these, so a table you can eyeball beats a formula you'd
// have to reverse-engineer. Add entries here (and nowhere else -- tick.ts's
// unlockCaptainSlot reads this by index, App.svelte's leveling panel iterates
// it for display) for a 5th+ slot later.
export const CAPTAIN_SLOT_UNLOCKS: CaptainSlotUnlockDef[] = [
  { atLevel: 3, statPointCost: 2, componentsCost: 5 },
  { atLevel: 6, statPointCost: 4, componentsCost: 15 },
  { atLevel: 10, statPointCost: 6, componentsCost: 40 },
];

// What a brand-new (or newly-unlocked) captain slot starts with. There is no
// more prestige to reset a captain THROUGH -- this is purely the baseline for
// a slot that has never been played.
export function freshCaptainStack(): Pick<CaptainState, "tickDurationSeconds" | "mission" | "xp" | "level" | "statPoints"> {
  return {
    tickDurationSeconds: 10,
    mission: null,
    xp: 0,
    level: 1,
    statPoints: 0,
  };
}

// Generates `count` captains (ids 1..count) sharing the same freshCaptainStack()
// baseline. Used for: a brand-new save (freshState calls freshCaptains(1)),
// a slot unlock (tick.ts's unlockCaptainSlot), and save migration (backfilling
// a never-played slot).
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
  };
}
