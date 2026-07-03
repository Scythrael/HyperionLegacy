// Data model — tech spec §1 (Data Model) and §3 (Generator Stack Structure).
// Flat entity store, ID-referenced. Prototype scope: one ship's module stack,
// no captains/crew/sectors yet — those are Section 10.6 iteration items.

export type ResourceKey = "ore" | "ingots" | "components";
export type ModuleKey = "miner" | "refinery" | "fabricator";

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
};

export const RESOURCE_ORDER: ResourceKey[] = ["ore", "ingots", "components"];
export const RESOURCE_LABEL: Record<ResourceKey, string> = {
  ore: "Common Ore",
  ingots: "Refined Ingots",
  components: "Components",
};

export interface GameState {
  resources: Record<ResourceKey, number>;
  modules: Record<ModuleKey, number>;
  lifetimeComponents: number;
  augmentPoints: number;
  prestigeCount: number;
  gameTimeSeconds: number; // accumulated in-game seconds, per tech spec §1
  tickDurationSeconds: number; // length of one tick-bar cycle; shrinks via future bonuses
}

export function freshState(): GameState {
  return {
    resources: { ore: 0, ingots: 0, components: 0 },
    modules: { miner: 1, refinery: 0, fabricator: 0 },
    lifetimeComponents: 0,
    augmentPoints: 0,
    prestigeCount: 0,
    gameTimeSeconds: 0,
    tickDurationSeconds: 10,
  };
}

export function costFor(moduleKey: ModuleKey, count: number): number {
  const m = MODULES[moduleKey];
  return Math.ceil(m.baseCost * Math.pow(m.costMult, count));
}

// Layer 4 (prestige-persistent) per tech spec §3. The only layer implemented
// so far — crew/captain/fleet layers arrive as those entities are built.
export function globalMultiplier(state: GameState): number {
  return 1 + state.augmentPoints * 0.1;
}
