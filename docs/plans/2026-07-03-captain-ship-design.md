# Multi-Captain Stacks + Two-Tier Prestige — Design (Phase 1)

## Context and scope mismatch

The master design doc (`docs/projectdocs/fleet_admiral_master_design.md`) envisions captains as
persistent named characters, each commanding a ship with its own crew, dispatchable on missions,
with a skill-tree-style Augments layer (§4.10), a two-tier prestige system (§4.11: Tier 1 =
captain reset, Tier 2 = ship promotion/fleet expansion), and a campaign of sectors culminating in
fleet-composition boss encounters (§4.12, §5.1). None of that infrastructure exists yet — the
current prototype (as of the just-shipped Research feature) is a single implicit, unnamed
production pool: 4 resources, 4 modules, one research project, one prestige tier, one tick
cadence.

Per this project's established practice (the Research feature was scoped down from its own much
larger full-vision section the same way), this design intentionally builds only a right-sized
slice: **multiple independent captain stacks, each developed and prestiged separately**, without
the skill tree, missions, combat, or ship-type variety the full vision eventually wants.

The full "captain + ship" ambition is being delivered in phases:
- **Phase 1 (this design):** Multi-captain stacks, each an independent copy of the existing
  economy, plus a two-tier prestige system (per-captain reset + specialization choice, and a
  fleet-wide reset that also collapses the captain roster).
- **Phase 2 (future, separate design):** A fleet-wide skill tree (Skill Points, a Command branch
  that unlocks additional captain slots, a Research branch with a concrete buff node).
- **Phase 3+ (future, undesigned):** Combat-type ships, missions, boss encounters — all explicitly
  deferred since combat mechanics are still an open design question even in the master doc
  (§5.1, "HIGHEST PRIORITY").

## Architecture

`GameState` splits into fleet-wide fields and a `captains` array. Fleet-wide fields
(`augmentPoints`, `prestigeCount`, `gameTimeSeconds`) are shared across the whole save. Everything
that today lives at the top level of `GameState` — `resources`, `modules`, `research`,
`lifetimeComponents`, `tickDurationSeconds` — moves into a new `CaptainState`, one per entry in
`captains: CaptainState[]`.

The existing per-stack production and research-progress logic (currently the body of `tick()`) is
extracted into a pure `tickCaptainStack(deltaSeconds, captainState, fleetMult): CaptainState`
function — the same tested math, just scoped to one captain instead of the whole state. `tick()`
becomes a thin loop that calls this once per captain plus advances the fleet-wide
`gameTimeSeconds`.

```ts
export type ShipType = "resourcer"; // only real value for now; modeled as a union for Phase 3+

export type SpecializationKey = "mining" | "refining" | "fabrication";

export interface SpecializationDef {
  label: string;
  resource: ResourceKey;
  bonusMult: number; // e.g. 0.25 for +25%
}

export const SPECIALIZATIONS: Record<SpecializationKey, SpecializationDef> = {
  mining: { label: "Mining Specialist", resource: "ore", bonusMult: 0.25 },
  refining: { label: "Refining Specialist", resource: "ingots", bonusMult: 0.25 },
  fabrication: { label: "Fabrication Specialist", resource: "components", bonusMult: 0.25 },
};

export interface CaptainState {
  id: number;
  label: string; // placeholder, e.g. "Captain 1" — naming deferred per §10.7
  shipType: ShipType;
  resources: Record<ResourceKey, number>;
  modules: Record<ModuleKey, number>;
  research: Record<ResearchKey, ResearchState>;
  lifetimeComponents: number;
  tickDurationSeconds: number;
  captainPoints: number; // earned via this captain's own prestige
  captainPrestigeCount: number;
  specialization: SpecializationKey | null;
}

export interface GameState {
  captains: CaptainState[];
  augmentPoints: number;
  prestigeCount: number;
  gameTimeSeconds: number;
}
```

## Tick semantics

Each captain has its own `tickDurationSeconds` and its own cycle progress — cadences can diverge
between captains. The live loop in `App.svelte` (currently one `setInterval(100ms)` tracking a
single `barCycleStart`) becomes a loop over all captains each poll, checking each captain's own
progress and firing `tickCaptainStack` independently whenever that captain's own cycle completes.
`gameTimeSeconds` advances continuously off real elapsed time, decoupled from any individual
captain's cadence.

Offline catch-up applies the same real-elapsed-seconds delta directly to every captain's stack via
`tickCaptainStack(offlineSeconds, captainState, fleetMult)`, bypassing cycle-bucketing entirely —
same pattern as today's single `tick(offlineSeconds, state)` call, just looped per captain. This
preserves the closed-form invariant per captain (one big jump == many small ticks), since each
captain's stack update remains independent and stateless-per-call.

Per-captain production formula:

```
rate = m.baseRate * count * fleetMult * captainMult * specMult * deltaSeconds

fleetMult   = 1 + augmentPoints * 0.1                                  // fleet-wide, unchanged shape
captainMult = 1 + captainState.captainPoints * 0.1                     // per-captain, same shape
specMult    = (specialization active && matches this module's resource) ? 1 + bonusMult : 1
```

All three multipliers are recomputed fresh from current state on every call — no path-dependent
state — so the closed-form guarantee holds for the whole `tick()` output, not just the parts that
existed before this feature.

Research stays per-captain: since `research` now lives inside `CaptainState`, each captain must
independently complete Alloy Synthesis to unlock Synthesizer/alloys for their own stack. "Each has
to be developed separately" — no shared unlock leakage between captains.

## Two-tier prestige

**Captain Prestige** (per captain). Gate: `sqrt(captainState.lifetimeComponents)` — same formula
as today's single prestige, scoped to one captain's `lifetimeComponents`. On success: resets that
captain's `resources`/`modules`/`research`/`lifetimeComponents`/`tickDurationSeconds` to defaults,
keeps `id`/`label`/`shipType`, adds the gained amount to `captainPoints`, increments
`captainPrestigeCount`. Choosing a specialization is part of the action itself — the player picks
one of the three `SPECIALIZATIONS` as part of triggering Captain Prestige, so respeccing a captain
is simply prestiging that captain again with a different pick.

**Fleet Prestige** (existing `prestige()`, extended). Gate: `sqrt()` of *combined*
`lifetimeComponents` summed across all captains. On success: grants fleet-wide `augmentPoints`
(unchanged formula/behavior) and increments `prestigeCount`, but now also collapses the entire
`captains` array back to the starting 2-captain state (Captain 1 with the head-start Mining Laser,
fresh Captain 2) — wiping every captain's specialization, `captainPoints`, individual prestige
count, and stack progress along with it. This is deliberately the more severe reset: it's the
"admiral" tier, not the "captain" tier. (Phase 2's skill tree will make "re-unlock captains" a real
consequence again; for now, the roster always collapses back to the fixed starting 2 since that's
the only shape Phase 1 knows about.)

## UI

A tab strip above the panel stack lets the player switch which captain's panels
(Resources/Tick/Generator Stack/Research) are shown. Each captain's tab gains a new "Captain
Prestige" panel: projected `captainPoints` gain, current specialization/points, and — once
eligible — a 3-button specialization picker that triggers the reset.

The existing fleet-wide Prestige panel moves outside the tabs (shown once, not per-captain), and
its copy is updated to state plainly that it resets the whole captain roster back to 2, not just
that one captain's stack.

The Log panel stays a single shared fleed feed, but entries get prefixed with the originating
captain's label (e.g. `[Captain 2] Research started: Alloy Synthesis`) since multiple captains can
now act and progress concurrently.

## Migration (v4 → v5)

A new `MIGRATIONS[4]` entry: takes the existing top-level `resources`/`modules`/`research`/
`lifetimeComponents`/`tickDurationSeconds` (today's single implicit stack, preserved verbatim —
including any already-completed research) and moves it into `captains[0]` with
`id: 1`, `label: "Captain 1"`, `shipType: "resourcer"`, `captainPoints: 0`,
`captainPrestigeCount: 0`, `specialization: null`. A fresh `captains[1]` (`id: 2`,
`label: "Captain 2"`, completely empty stack) is added alongside it. The old top-level fields are
removed from the migrated `GameState` shape.

A brand-new save (`freshState()`) starts with the same 2-captain shape directly — Captain 1 with
today's existing head start (1 free Mining Laser), Captain 2 starting from scratch — so new and
returning players see the same starting shape.

## Testing

- `tickCaptainStack` closed-form property: one big jump == many small ticks, for a captain with
  modules owned, research in progress, and a non-null specialization active (extending the
  existing "one big jump" test pattern to cover the new specialization multiplier).
- Captain Prestige: gate at `lifetimeComponents` threshold, reset behavior, specialization
  assignment, `captainPoints` accumulation across repeated captain prestiges.
- Fleet Prestige: gate at *combined* `lifetimeComponents`, full roster collapse back to the
  starting 2-captain shape, `augmentPoints`/`prestigeCount` carried forward.
- Migration: a genuine pre-Phase-1 save (missing `captains` entirely, with the old top-level
  shape) correctly becomes a 2-captain `v5` state with Captain 1's progress preserved intact.
  Chain this through the full v1→v5 migration path (mirroring the v1→v4 chained test already
  established for the Research hotfix), not just an isolated v4→v5 step.
- UI/markup portions (tabs, per-captain panels, specialization picker): manual-review-only, no
  automated test, consistent with every prior UI task this session (Node.js/npm remains
  unavailable in this environment).

## Explicitly out of scope for Phase 1

- The fleet-wide skill tree, Skill Points, and captain-slot unlocking (Phase 2).
- Ship-type selection UI (only `"resourcer"` exists; the field is modeled for future extension but
  has no picker yet).
- Combat-type ships, missions, boss encounters (Phase 3+, pending the combat design question in
  §5.1 actually being answered).
- More than 3 specializations, or specializations affecting anything besides a flat production
  multiplier on one resource.
- Any cross-captain interaction (trading resources between captains, shared module counts, etc).
- Captain naming/portrait/flavor UI (placeholder labels only, per §10.7).
