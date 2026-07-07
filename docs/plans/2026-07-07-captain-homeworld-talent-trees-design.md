# Captain & Homeworld Talent Trees — Design

## Context

This is the next phase for "Hyperion Legacy" (fleet-admiral repo), picked up after Phase 4 (Navigation
Restructuring & Progression Overhaul) shipped. Phase 4 explicitly deferred "the full talent/equipment
system for captains" and "a separate 'Fleet Admiral' meta-progression layer, if one turns out to be
wanted at all" — this design is that system, now that it's wanted.

Two parallel talent trees, one per progression entity:

- **Captain Talents** (per captain, 5 branches: Command, Tactical, Science, Resourcefulness,
  Diplomacy) — spent from a captain's existing `statPoints` (already earned via mission-cycle
  completion, shipped in Phase 4).
- **Homeworld Talents** (fleet-wide, 5 branches: Fleet Logistics, Homeland Defense, Citizenry,
  Economy, Industry) — spent from a new fleet-wide `adminPoints` pool, earned via a new Fleet Admiral
  leveling system.

Of the 10 branches, only 5 get real launch content this pass: **Command** and **Resourcefulness**
(captain side), **Fleet Logistics**, **Industry**, and **Economy** (homeworld side). The other 5
(Tactical, Science, Diplomacy, Homeland Defense, Citizenry) are stubs — visible in the UI so the
tree's overall shape is in place, but with zero nodes, since each depends on a system that doesn't
exist yet (combat, a new Science mechanic, population/planet-economy) and deserves its own dedicated
design later.

## Data model

Two new tables in `model.ts`, mirroring the exact conventions the (now-deleted) Skill Tree
established — `branch`, `label`, `cost`, `requires` (same-branch prerequisite), and a typed `effect`:

```ts
export type CaptainTalentBranch = "command" | "tactical" | "science" | "resourcefulness" | "diplomacy";
export type HomeworldTalentBranch = "fleetLogistics" | "homelandDefense" | "citizenry" | "economy" | "industry";

export type CaptainTalentEffect =
  | { type: "extractionYieldMult"; mult: number }
  | { type: "rareLootChanceMult"; mult: number };

export type HomeworldTalentEffect =
  | { type: "unlockCaptainSlot" }
  | { type: "fleetExtractionYieldMult"; mult: number }
  | { type: "recipeBonusOutput"; recipeKey: RecipeKey; bonus: number }
  | { type: "passiveTrickle"; material: HomePlanetMaterialKey; perTick: number };

export interface CaptainTalentDef {
  branch: CaptainTalentBranch;
  label: string;
  cost: number; // statPoints
  requires: CaptainTalentKey | null;
  effect: CaptainTalentEffect;
}

export interface HomeworldTalentDef {
  branch: HomeworldTalentBranch;
  label: string;
  cost: number; // adminPoints
  requires: HomeworldTalentKey | null;
  effect: HomeworldTalentEffect;
}
```

`CAPTAIN_TALENTS`/`HOMEWORLD_TALENTS` are `Record<Key, Def>` tables, same shape as `MISSIONS`/`RECIPES`.
Stub branches simply have zero entries in either table for now — the UI iterates branches (a fixed
5-item list per tree), not table entries, so an empty branch still renders as a labeled column with
nothing in it, rather than not appearing at all.

## Captain Talents — launch content (Command, Resourcefulness)

- **Command**: `extractionYieldMult` — boosts this captain's own extraction rate on missions (stacks
  with the mission's base `extractionRatePerTick`). "Better crew discipline, more ore per run."
- **Resourcefulness**: `rareLootChanceMult` — boosts this captain's odds of hitting uncommon/rare
  tiers on a loot roll. Pairs naturally with the separately-planned loot-rarity-range rework (rolling
  a min/max quantity per tier instead of a flat 10 units) — this talent's effect slots into whatever
  the reworked `rollLootTable`-equivalent ends up looking like, without needing to be redesigned
  itself once that lands.

Both are single-rank-or-a-short-chain launch nodes (2-3 ranks each, escalating cost) — exact numbers
are launch placeholders, same spirit as `MISSIONS`'/`RECIPES`' own tunable constants.

## Homeworld Talents — launch content (Fleet Logistics, Industry, Economy)

- **Fleet Logistics**: absorbs `CAPTAIN_SLOT_UNLOCKS` wholesale — the existing 3-tier slot-unlock
  table moves here as `unlockCaptainSlot` effect nodes (same level-requirement-free logic, but now
  costs `adminPoints` instead of a captain's own level/statPoints/Components combo). The old
  `unlockCaptainSlot()` function's level-gate and per-captain Components cost go away; slot-unlocking
  becomes purely an Admiral-pool purchase. Also gets one `fleetExtractionYieldMult` node — a
  fleet-wide version of Command's captain-level buff, applying to every captain at once.
- **Industry**: `recipeBonusOutput` — direct buffs to `craftRecipe()`, e.g. a node granting +1 bonus
  output per craft on a specific recipe. Matches the user's own framing ("buffs for refineries,
  fabrication").
- **Economy**: `passiveTrickle` — a small passive drip of `commonOre` into `homePlanet.storage` every
  tick, independent of missions. Explicitly the thinnest of the five launch branches (the user
  themselves wasn't sure what Economy should do) — treated as provisional, likely to be revisited once
  there's a clearer idea of what "economy" means for this game.

## Fleet Admiral leveling

`GameState` gains `fleetAdminXp: number`, `fleetAdminLevel: number`, `adminPoints: number`. A new
function recomputes Fleet Admiral XP from the sum of every captain's current `level`, checked once per
`tick()` call (and once per live-loop poll, mirroring how captain-mission XP is already checked in two
places). The level curve is deliberately much steeper than a captain's own (`xpForNextLevel`) — the
user's own framing ("level-50 captains, level 3-4 Admiral") — using the same `while (xp >=
xpForNextLevel) { ... level += 1; adminPoints += 1; }` shape already proven for captain leveling, so a
big jump (e.g. several captains leveling up between polls) resolves every Admiral level-up crossed in
one pass, not just the first.

## UI

Captain Talents render per-captain (Fleet Ops tab, alongside the existing Captain Leveling panel) —
5 columns/sections, one per branch, each showing its nodes (or "Not yet available" for a stub branch)
with buy buttons gated on `statPoints >= cost` and `requires` being already-owned. Homeworld Talents
render fleet-wide (Homeworld tab) in the same 5-branch layout, gated on `adminPoints`.

## Save migration

v9 -> v10: `CaptainState` gains `unlockedCaptainTalents: CaptainTalentKey[]` (empty on migration).
`GameState` gains `unlockedHomeworldTalents: HomeworldTalentKey[]` (empty), `fleetAdminXp`/
`fleetAdminLevel`/`adminPoints` (0/1/0). `CAPTAIN_SLOT_UNLOCKS`-based slot state doesn't need migrating
— slot count is still just `captains.length`, unaffected by where the unlock mechanism lives.

## Testing

- Both talent tables: launch-set sanity checks (non-empty branches have valid cost/effect shapes,
  stub branches genuinely have zero entries).
- A generic `buyCaptainTalent`/`buyHomeworldTalent` function per tree: same-state-reference-on-failure
  convention (insufficient points, prerequisite not met, already owned), successful purchase deducts
  cost and records the unlock.
- Fleet Admiral XP recompute: closed-form check mirroring captain leveling's own test (a big jump in
  aggregate captain levels resolves every Admiral level-up crossed, not just one).
- Manual-only (Node unavailable): the 5-branch UI layout for both trees, including empty-branch
  rendering.

## Explicitly deferred

- Diplomacy, Tactical, Science, Homeland Defense, Citizenry content — each needs its own system first
  (a defined captain-vs-captain or captain-vs-environment interaction for Diplomacy/Tactical, a
  redefined Science mechanic now that Research is gone, Homeland Defense once Battlespace exists,
  population/planet-economy for Citizenry).
- An achievements system — a new XP/points source mentioned in passing, not designed.
- The loot-rarity-range rework (rolling a min/max quantity per tier instead of a flat 10 units per
  roll) — a real bug fix to the already-shipped mission-loot system, queued as its own follow-up.
- The missing Components/Refined Material display on the Home Planet panel — a real bug, queued as
  its own follow-up.
- Header/layout changes (captain level bar to the top, smaller Fleet Admiral header panel, full-width
  panels) — UI polish, queued as its own follow-up.
- Sector Space (Shipyard/Starbase) — shelved earlier this session, still shelved.
- Clerk-based auth + multiplayer (chat, PvP, cloud saves) — a future idea, an entirely different
  category of work (backend/auth/networking) from everything built so far.
