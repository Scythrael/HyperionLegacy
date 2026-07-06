# Home Planet & Mission Expeditions — Design (Phase 3a)

## Context

This is "Phase 3a" of the Captain/Ship feature, following Phase 1 (per-captain stacks, two-tier
prestige) and Phase 2 (fleet-wide skill tree, unlockable captain slots), both shipped. It grew out
of a single idea — "captains should travel to mine ore, fill a cargo hold, and bring it home" — that
expanded during brainstorming into three previously-separate, previously-deferred systems fusing
together: the **Mission layer** (§3.2 of the master design doc, an entire undesigned game-time
scale), a new **Home Planet** storage entity, and a **tiered loot table** for mission rewards.

Given the size, this was deliberately split in two:
- **Phase 3a (this design):** Home Planet storage + a general, data-driven mission engine + the
  full travel/cargo/loot loop, proven with 2 ore-family missions.
- **Phase 3b (separate, future, not designed yet):** a salvage-family mission, its repair mechanic,
  and a new Energy resource for converting unwanted cargo.

A real architectural tension surfaced and was resolved deliberately, not by accident: the master
design doc's original vocabulary (Glossary) already distinguishes **Common matter** ("auto-
stockpiled freely at base, no cargo footprint" — today's actual ore/ingots/components/alloys) from
**Rare matter** ("cargo-bound... required for advanced crafting"). This feature does NOT retrofit
the existing 4 resources into a cargo/travel model — those stay exactly as they are, still instant,
still auto-stockpiled via each captain's own Generator Stack. Mission loot is an entirely separate,
new material family (Common Ore / Uncommon Material / Rare Material, per mission), stored in a new
fleet-wide pool, matching the master doc's original "rare matter is cargo-bound, common matter isn't"
split rather than reinventing it.

## Home Planet storage

A new fleet-wide field on `GameState`: `homePlanet: { storage: Record<LootMaterialKey, number> }`.
Completely separate from any captain's own `resources` — mission loot lands here, never in the
dispatching captain's personal economy. This is genuinely new state, not a UI relabeling of
Fleet Prestige or the Skill Tree (both of which are untouched by this feature).

## Missions replace a captain's Generator Stack for their duration

A captain does one thing at a time. Dispatching them on a mission pauses their normal module-based
production (miner/refinery/fabricator/synthesizer) entirely — their "stack" reflects mission
progress instead until they return, at which point their normal economy resumes untouched (same
resources/modules/research they left with, just frozen in time while away). This mirrors how future
mission types (combat patrols, science surveys — see Future Directions) are expected to work the
same way: a mission of any kind is an alternate activity that temporarily replaces whatever a
captain would otherwise be doing.

## Mission engine (general, data-driven)

```ts
export type MissionKey = "shortOreRun" | "longOreRun";

export type LootMaterialKey = "commonOre" | "uncommonMaterial" | "rareMaterial";

export interface LootTableEntry {
  material: LootMaterialKey;
  weight: number; // out of the table's total weight
}

export interface MissionDef {
  label: string;
  transitOutTicks: number;
  transitBackTicks: number;
  unloadTicks: number;
  extractionRatePerTick: number; // total units/tick, regardless of which tier they land as
  cargoCapacity: number; // total units across all tiers; extraction ends once this is hit
  lootTable: LootTableEntry[];
}

export const MISSIONS: Record<MissionKey, MissionDef> = {
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
```

All numeric values above (tick counts, extraction rate, cargo capacity, loot weights) are launch
placeholders, explicitly adjustable during balance passes — same convention as Research's 500-cost/
180s-duration and the Skill Tree's 1/2/3 SP costs when those were first designed.

## The loop (per-captain mission state machine)

A captain's `CaptainState` gains a `mission: CaptainMissionState | null` field:

```ts
export type MissionPhase = "ordersReceived" | "transitOut" | "extracting" | "transitBack" | "unloading";

export interface CaptainMissionState {
  missionKey: MissionKey;
  phase: MissionPhase;
  phaseProgressTicks: number; // ticks elapsed in the CURRENT phase
  cargo: Record<LootMaterialKey, number>; // accumulated during extraction, cleared on unload
}
```

Dispatching a captain (only possible when `mission` is `null`) sets `mission` to
`{ missionKey, phase: "ordersReceived", phaseProgressTicks: 0, cargo: {commonOre:0, uncommonMaterial:0, rareMaterial:0} }`.
Each tick advances `phaseProgressTicks`; once it reaches that phase's tick count (1 for
`ordersReceived`, `transitOutTicks` for `transitOut`, etc.), the state machine moves to the next
phase and resets `phaseProgressTicks` to 0. During `extracting`, each tick draws
`extractionRatePerTick` units from the mission's weighted loot table and adds them to `cargo`,
continuing until `cargoCapacity` is reached (which may end the extraction phase early, before
`phaseProgressTicks` would otherwise imply — capacity is the actual gate, not a fixed tick count).
On completing `unloading`, `cargo`'s contents are added to `homePlanet.storage`, `cargo` is reset,
and `mission` becomes `null` — the captain is idle again, ready for a new mission or a return to
their normal economy.

## UI

A per-captain "MISSIONS" panel (dispatch is a per-captain choice) — shows the 2 available missions
with a dispatch button when idle, or the current phase + progress when a mission is active. A new
fleet-wide "HOME PLANET" panel shows banked storage totals (Common Ore / Uncommon Material / Rare
Material quantities).

## Testing

- `MISSIONS`/loot-table shape and weight-sum sanity checks.
- The per-tick state machine: phase transitions fire at the right tick counts, extraction correctly
  gates on `cargoCapacity` (not a fixed tick count), loot draws are weighted correctly, unloading
  correctly transfers cargo into `homePlanet.storage` and clears the captain's `mission` field.
- A captain's normal Generator Stack truly does not produce anything while `mission` is non-null
  (re-verify against `tickCaptainStack`'s existing production loop — extending it to skip production
  entirely for a captain currently on a mission).
- Closed-form consideration: this introduces genuinely NEW stateful, phase-transition logic
  (unlike every prior tick-based system, which was a single continuous accrual) — the closed-form
  "one big jump equals many small ticks" invariant needs to be re-examined specifically for mission
  state, since phase transitions are discrete events, not continuous accrual. This is flagged here
  as a first-order design/implementation risk for the plan to address explicitly, not assumed safe
  by default.

## Explicitly deferred (Phase 3b and beyond — not designed yet)

- **Phase 3b:** the salvage-family mission (different loot pool: scrap/fried electronics/etc.), its
  repair mechanic at Home Planet, and a new Energy resource (gained by choosing to discard/convert
  excess common-tier cargo mid-mission rather than carry it home).
- Shipyard, ship types beyond "resourcer," lightspeed-engine-based variable travel time (today's
  transit ticks are fixed per mission, not derived from equipment).
- A trading post / converting materials to a universal currency.
- Science-vessel long-duration exploration/survey missions (rare artifacts, alien-civilization buffs).
- Combat patrol missions, orbital bombardment / PvP (ship destruction, homeworld defense structures
  offsetting bombardment risk) — explicitly described as needing its own design, with ship
  destruction/PvE-opt-in mechanics still completely unresolved.
- A broader navigation restructuring into five top-level areas — **Homeworld** (structures:
  defense/offense, fleet-wide upgrades), **Sector Space** (Shipyard: build/repair/upgrade ships;
  Starbase, tied to the bombardment mechanic above — has to be damaged/taken offline before a
  homeworld can be bombarded; Fleet Operations, where the mission-dispatch interface described in
  this design would eventually live), **Fleet** (today's captain tabs), a future **PvP** tab, and
  **System** (options/stats, today's gear-icon overlay). This Phase 3a design does NOT introduce any
  new top-level navigation — the Missions and Home Planet panels slot into the existing single-page
  panel-stack layout, same as every other panel added this session. The five-tab structure is
  captured here so it isn't lost, to be picked up when Shipyard/PvP/Homeworld structures are
  actually designed.
