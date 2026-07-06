// Data model — tech spec §1 (Data Model) and §3 (Generator Stack Structure).
// Phase 1 of the captain/ship feature (docs/plans/2026-07-03-captain-ship-design.md):
// the single flat stack is now N independent per-captain stacks. Fleet-wide
// fields (augmentPoints, prestigeCount, gameTimeSeconds) stay on GameState;
// everything else moves into CaptainState.

export type ResourceKey = "ore" | "ingots" | "components" | "alloys";
export type ModuleKey = "miner" | "refinery" | "fabricator" | "synthesizer";

export interface ModuleDef {
  label: string;
  resource: ResourceKey;
  baseRate: number; // units per second at count=1, multiplier=1
  baseCost: number; // cost of the first purchase (count 0 -> 1)
  costMult: number; // exponential cost scaling per tech spec §3
  unit: string;
}

export const MODULES: Record<ModuleKey, ModuleDef> = {
  miner: { label: "Mining Laser", resource: "ore", baseRate: 1, baseCost: 10, costMult: 1.15, unit: "ore/s" },
  refinery: { label: "Refinery", resource: "ingots", baseRate: 0.4, baseCost: 60, costMult: 1.17, unit: "ingots/s" },
  fabricator: { label: "Fabricator", resource: "components", baseRate: 0.12, baseCost: 400, costMult: 1.2, unit: "components/s" },
  synthesizer: { label: "Synthesizer", resource: "alloys", baseRate: 0.04, baseCost: 2500, costMult: 1.22, unit: "alloys/s" },
};

export const RESOURCE_ORDER: ResourceKey[] = ["ore", "ingots", "components", "alloys"];
export const RESOURCE_LABEL: Record<ResourceKey, string> = {
  ore: "Common Ore",
  ingots: "Refined Ingots",
  components: "Components",
  alloys: "Alloys",
};

export type ResearchKey = "alloySynthesis";

export interface ResearchState {
  started: boolean;
  progressSeconds: number;
  completed: boolean;
}

export interface ResearchProjectDef {
  label: string;
  costComponents: number;
  durationSeconds: number;
}

export const RESEARCH_PROJECTS: Record<ResearchKey, ResearchProjectDef> = {
  alloySynthesis: { label: "Alloy Synthesis", costComponents: 500, durationSeconds: 180 },
};

// Only "resourcer" is real today. Modeled as a union (not a bare string) so
// Phase 3+'s combat-type ships slot in as a new literal without touching
// every existing call site that pattern-matches on this field.
export type ShipType = "resourcer";

export type SpecializationKey = "mining" | "refining" | "fabrication";

export interface SpecializationDef {
  label: string;
  resource: ResourceKey;
  bonusMult: number; // e.g. 0.25 for +25% to the matching module's production
}

// Exactly 3 at launch, one per base resource. Alloys/Synthesizer intentionally
// excluded -- it's still gated behind research, so a specialization for it
// would be dead weight for most of a captain's early life. Add a 4th entry
// here (and nowhere else -- App.svelte's picker iterates this object) if a
// synthesis specialization is ever wanted.
export const SPECIALIZATIONS: Record<SpecializationKey, SpecializationDef> = {
  mining: { label: "Mining Specialist", resource: "ore", bonusMult: 0.25 },
  refining: { label: "Refining Specialist", resource: "ingots", bonusMult: 0.25 },
  fabrication: { label: "Fabrication Specialist", resource: "components", bonusMult: 0.25 },
};

export type SkillBranchKey = "command" | "research";

export type SkillNodeKey = "commandRank1" | "commandRank2" | "commandRank3" | "researchAlloySynthesisSpeed";

export type SkillNodeEffect =
  | { type: "unlockCaptainSlot" }
  | { type: "researchSpeedMult"; researchKey: ResearchKey; mult: number };

export interface SkillNodeDef {
  branch: SkillBranchKey;
  label: string;
  costSkillPoints: number;
  requires: SkillNodeKey | null; // prerequisite node in the SAME branch; null means no prerequisite
  effect: SkillNodeEffect;
}

// 3 Command ranks (unlock captain slots 2/3/4, increasing cost) + 1 Research
// node (a one-time Alloy Synthesis speed buff). Add a new entry here (and
// nowhere else -- App.svelte's panel iterates this object grouped by
// `branch`) if a new node is ever wanted; SKILL_TREE.test.ts's "launch set"
// tests will need updating to match whatever the new set looks like.
export const SKILL_TREE: Record<SkillNodeKey, SkillNodeDef> = {
  commandRank1: {
    branch: "command",
    label: "Recruit Captain (2nd slot)",
    costSkillPoints: 1,
    requires: null,
    effect: { type: "unlockCaptainSlot" },
  },
  commandRank2: {
    branch: "command",
    label: "Recruit Captain (3rd slot)",
    costSkillPoints: 2,
    requires: "commandRank1",
    effect: { type: "unlockCaptainSlot" },
  },
  commandRank3: {
    branch: "command",
    label: "Recruit Captain (4th slot)",
    costSkillPoints: 3,
    requires: "commandRank2",
    effect: { type: "unlockCaptainSlot" },
  },
  researchAlloySynthesisSpeed: {
    branch: "research",
    label: "Synthesis Efficiency",
    costSkillPoints: 1,
    requires: null,
    effect: { type: "researchSpeedMult", researchKey: "alloySynthesis", mult: 0.75 },
  },
};

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
  phaseProgressTicks: number; // continuous (can be fractional mid-tick), like research's progressSeconds
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
  resources: Record<ResourceKey, number>;
  modules: Record<ModuleKey, number>;
  research: Record<ResearchKey, ResearchState>;
  lifetimeComponents: number;
  tickDurationSeconds: number; // this captain's own tick-bar cycle length; cadences can diverge between captains
  captainPoints: number; // earned via THIS captain's own prestige (captainPrestige)
  captainPrestigeCount: number;
  specialization: SpecializationKey | null;
  mission: CaptainMissionState | null; // null when idle/running their normal Generator Stack economy
}

export interface GameState {
  captains: CaptainState[];
  augmentPoints: number; // fleet-wide, from Fleet Prestige
  prestigeCount: number; // fleet-wide Fleet Prestige count
  gameTimeSeconds: number; // accumulated in-game seconds, fleet-wide, per tech spec §1
  skillPoints: number; // unspent, fleet-wide -- earned 1 per Fleet Prestige, never reset by it
  unlockedSkillNodes: SkillNodeKey[]; // fleet-wide, persistent, never reset by Fleet Prestige
  homePlanet: { storage: Record<LootMaterialKey, number> }; // fleet-wide, separate from any captain's own resources
}

// The baseline BOTH prestige tiers reset a captain's stack to: 1 free Mining
// Laser, everything else zeroed. This is the same floor the old single-stack
// prestige() has always reset to (freshState() always gave 1 free miner) --
// prestiging is "start this captain's economy over with a small foothold,"
// not "erase them back to before they existed." Only a captain slot that has
// NEVER been played (Captain 2 in a brand-new/migrated save, before its first
// captainPrestige) starts with zero modules instead -- see freshCaptains().
//
// NOTE for whoever adds a 12th CaptainState field: this Pick<> list is what
// BOTH prestige tiers reset. It is not compiler-checked against "everything
// captainPrestige/prestige should reset" -- a new field silently keeps
// whatever the pre-reset captain had unless you also add it here on purpose.
export function freshCaptainStack(): Pick<
  CaptainState,
  "resources" | "modules" | "research" | "lifetimeComponents" | "tickDurationSeconds" | "mission"
> {
  return {
    resources: { ore: 0, ingots: 0, components: 0, alloys: 0 },
    modules: { miner: 1, refinery: 0, fabricator: 0, synthesizer: 0 },
    research: { alloySynthesis: { started: false, progressSeconds: 0, completed: false } },
    lifetimeComponents: 0,
    tickDurationSeconds: 10,
    mission: null, // both prestige tiers cancel any active mission as part of the reset -- see tick.ts
  };
}

// Generates `count` captains (ids 1..count) sharing the same reset baseline
// (1 free miner) -- see the softlock regression note on freshCaptainStack()
// above. Used for: a brand-new save (freshState calls freshCaptains(1) --
// Phase 2's Command branch is now how the roster grows past 1), a
// post-Fleet-Prestige reset (freshCaptains(captainSlotCount(state)) in
// tick.ts, so earned slot count survives the reset), and save migration
// (backfilling a never-played slot at the real v4->v5 migration's shape).
export function freshCaptains(count: number): CaptainState[] {
  const captains: CaptainState[] = [];
  for (let i = 1; i <= count; i++) {
    captains.push({
      id: i,
      label: `Captain ${i}`,
      shipType: "resourcer",
      ...freshCaptainStack(),
      captainPoints: 0,
      captainPrestigeCount: 0,
      specialization: null,
    });
  }
  return captains;
}

export function freshState(): GameState {
  return {
    captains: freshCaptains(1),
    augmentPoints: 0,
    prestigeCount: 0,
    gameTimeSeconds: 0,
    skillPoints: 0,
    unlockedSkillNodes: [],
    homePlanet: { storage: { commonOre: 0, uncommonMaterial: 0, rareMaterial: 0 } },
  };
}

export function costFor(moduleKey: ModuleKey, count: number): number {
  const m = MODULES[moduleKey];
  return Math.ceil(m.baseCost * Math.pow(m.costMult, count));
}

// Only one gated module/resource exists right now (Synthesizer/alloys, behind
// Alloy Synthesis research). If a second gated module is ever added, this
// needs a real lookup instead of a single hardcoded key check. Per-captain as
// of Phase 1: each captain's OWN research state gates THEIR OWN Synthesizer.
export function isModuleUnlocked(key: ModuleKey, captain: CaptainState): boolean {
  if (key === "synthesizer") return captain.research.alloySynthesis.completed;
  return true;
}

export function isResourceUnlocked(key: ResourceKey, captain: CaptainState): boolean {
  if (key === "alloys") return captain.research.alloySynthesis.completed;
  return true;
}

// Fleet-wide multiplier, from Fleet Prestige's augmentPoints. Applies equally
// to every captain's production.
export function globalMultiplier(state: GameState): number {
  return 1 + state.augmentPoints * 0.1;
}

// Summed lifetime components across every captain -- the gate Fleet Prestige
// checks (tick.ts's prestige()) and the exact figure App.svelte's Fleet
// Prestige panel previews. Shared here so the two can never drift apart if
// this formula ever changes (e.g. a future weighting or cap).
export function fleetLifetimeComponents(state: GameState): number {
  return state.captains.reduce((sum, c) => sum + c.lifetimeComponents, 0);
}

// 1 (the floor every save starts with) + however many "unlockCaptainSlot"
// Command nodes have been bought. This is what BOTH a mid-game slot
// purchase (tick.ts's buySkillNode) and a Fleet Prestige reset
// (tick.ts's prestige, via freshCaptains(captainSlotCount(state))) treat as
// "how many captains should exist" -- fixes the Phase-1 gap where Fleet
// Prestige always collapsed the roster back to a hardcoded 2 regardless of
// what had actually been earned.
export function captainSlotCount(state: GameState): number {
  return (
    1 +
    state.unlockedSkillNodes.filter((key) => SKILL_TREE[key].effect.type === "unlockCaptainSlot").length
  );
}

// Product of every unlocked researchSpeedMult node's mult targeting this
// researchKey (1 if none apply). Fleet-wide, computed once per tick() call
// (see tick.ts) and applied identically to every captain's copy of that
// research project, same "compute once, apply everywhere" shape as
// globalMultiplier.
export function researchDurationMult(state: GameState, researchKey: ResearchKey): number {
  let mult = 1;
  for (const nodeKey of state.unlockedSkillNodes) {
    const effect = SKILL_TREE[nodeKey].effect;
    if (effect.type === "researchSpeedMult" && effect.researchKey === researchKey) {
      mult *= effect.mult;
    }
  }
  return mult;
}

// Per-captain multiplier, from that captain's OWN captainPrestige history.
// Same shape as globalMultiplier, deliberately -- a captain's own prestige
// track is a smaller, faster echo of the fleet-wide one.
export function captainMultiplier(captain: CaptainState): number {
  return 1 + captain.captainPoints * 0.1;
}

// 1 + bonusMult if this captain has a specialization matching the given
// resource, else 1. A captain with no specialization (specialization: null)
// always returns 1 for every resource.
export function specializationMultiplier(captain: CaptainState, resource: ResourceKey): number {
  if (!captain.specialization) return 1;
  const spec = SPECIALIZATIONS[captain.specialization];
  return spec.resource === resource ? 1 + spec.bonusMult : 1;
}
