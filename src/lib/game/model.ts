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
}

export interface GameState {
  captains: CaptainState[];
  augmentPoints: number; // fleet-wide, from Fleet Prestige
  prestigeCount: number; // fleet-wide Fleet Prestige count
  gameTimeSeconds: number; // accumulated in-game seconds, fleet-wide, per tech spec §1
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
  "resources" | "modules" | "research" | "lifetimeComponents" | "tickDurationSeconds"
> {
  return {
    resources: { ore: 0, ingots: 0, components: 0, alloys: 0 },
    modules: { miner: 1, refinery: 0, fabricator: 0, synthesizer: 0 },
    research: { alloySynthesis: { started: false, progressSeconds: 0, completed: false } },
    lifetimeComponents: 0,
    tickDurationSeconds: 10,
  };
}

// The starting 2-captain roster for both a brand-new save (freshState) and a
// post-Fleet-Prestige reset. Captain 1 gets the shared reset baseline (1 free
// miner); Captain 2 starts from an entirely empty stack -- deliberately
// asymmetric, since Captain 2 is a slot that has never been played before,
// not a captain being reset. See docs/plans/2026-07-03-captain-ship-design.md.
export function freshCaptains(): CaptainState[] {
  return [
    {
      id: 1,
      label: "Captain 1",
      shipType: "resourcer",
      ...freshCaptainStack(),
      captainPoints: 0,
      captainPrestigeCount: 0,
      specialization: null,
    },
    {
      id: 2,
      label: "Captain 2",
      shipType: "resourcer",
      // Spreads the same shared baseline as Captain 1, then overrides modules
      // back to all-zero -- a never-played slot gets no head start. Sharing
      // freshCaptainStack() here (instead of a fully separate hand-written
      // literal) means any new CaptainState field added to that helper is
      // guaranteed identical for both captains unless explicitly overridden,
      // rather than relying on two literals staying in sync by hand.
      ...freshCaptainStack(),
      modules: { miner: 0, refinery: 0, fabricator: 0, synthesizer: 0 },
      captainPoints: 0,
      captainPrestigeCount: 0,
      specialization: null,
    },
  ];
}

export function freshState(): GameState {
  return {
    captains: freshCaptains(),
    augmentPoints: 0,
    prestigeCount: 0,
    gameTimeSeconds: 0,
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
