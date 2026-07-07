// Data model — tech spec §1 (Data Model).
// Phase 4 (docs/plans/2026-07-06-phase4-navigation-progression-overhaul-plan.md):
// the Generator Stack economy (and everything built on top of it -- Research,
// Specializations, the Skill Tree, both Prestige tiers) has been retired in
// favor of the mission-based economy (below) plus a Homeworld crafting system
// (added in a later task) and a captain XP/leveling system (bare fields added
// below; the logic that uses them lands in a later task).

// Only "resourcer" is real today. Modeled as a union (not a bare string) so
// Phase 3+'s combat-type ships slot in as a new literal without touching
// every existing call site that pattern-matches on this field.
export type ShipType = "resourcer";

export type LootMaterialKey = "commonOre" | "uncommonMaterial" | "rareMaterial";

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
  xp: number; // accumulated toward the NEXT level -- see xpForNextLevel() (added in a later task)
  level: number; // starts at 1
  statPoints: number; // unspent, earned on level-up -- spent via unlockCaptainSlot() (later task, tick.ts)
}

export interface GameState {
  captains: CaptainState[];
  gameTimeSeconds: number; // accumulated in-game seconds, fleet-wide, per tech spec §1
  homePlanet: { storage: Record<LootMaterialKey, number> }; // fleet-wide mission loot, separate from any captain's own state
}

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
// a slot unlock (tick.ts's unlockCaptainSlot, added in a later task), and
// save migration (backfilling a never-played slot).
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
    homePlanet: { storage: { commonOre: 0, uncommonMaterial: 0, rareMaterial: 0 } },
  };
}
