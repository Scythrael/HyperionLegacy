# Navigation Restructuring & Progression Overhaul — Design (Phase 4)

## Context

This is "Phase 4" of Hyperion Legacy's development, following Phase 1 (per-captain stacks, two-tier
prestige), Phase 2 (fleet-wide skill tree), and Phase 3a (Home Planet storage + mission engine), all
shipped. It was explicitly flagged during Phase 3a's own brainstorm as "the very next phase after
Phase 3a ships," and grew, during this brainstorm, from "let's add tab navigation" into a full
architectural cutover: the game's entire resource-production model is changing from "each captain
runs their own passive Generator Stack" to "captains fly missions to gather raw materials, which
feed a fleet-wide crafting economy at the Home Planet."

This is deliberately one continuous design covering several dependent systems, not several small
ones, because the systems genuinely depend on each other: the Generator Stack's removal is *why*
Research, the Skill Tree, and both Prestige tiers all need to be retired at the same time (all three
were built on top of the Generator Stack, and have nothing left to operate on once it's gone).

Also settled during this session, purely as lore/naming to carry forward consistently: the game's
FTL travel is now canonically the **Vector-Fall Engine** — a gravimetric propulsion system using a
push (antigravity repulsion field) + pull (a "Vector Singularity," a hyper-dense gravity well) to
put a ship into continuous, directed freefall rather than accelerating or teleporting. This is not a
mechanic built in this phase — it's flavor text for future Shipyard/engine-upgrade UI — but it's
worth carrying into any Sector Space/Shipyard copy written from here on, since it deliberately
implies multi-tick transit (falling the whole time, not blinking there) and a natural upgrade path
(a stronger field/denser singularity = faster fall = fewer transit ticks).

## Navigation shell

Five bottom tabs, switched via a single `activeTab` state variable and conditional rendering — no
router library. This project has never had one and doesn't need deep-linking or browser history for
a single-page idle game; introducing one now would be new complexity with no corresponding need.

- **Homeworld** — structures. This phase: a Refinery panel, a Fabrication panel, and the existing
  Home Planet storage panel (relocated here from its current fleet-wide spot). Future: defense/
  offense structures, tied to the deferred Battlespace tab.
- **Sector Space** — a placeholder tab this phase ("Shipyard & Starbase coming soon"). Eventually
  houses the Shipyard (build/repair/upgrade ships) and the Starbase (tied to a future orbital-
  bombardment mechanic).
- **Fleet Ops** — the existing captain tabs, the existing Missions panel, and a new Captain Leveling
  panel (replaces the retired Captain Prestige panel).
- **Battlespace** — a placeholder tab this phase ("PvP and PvE operations will live here"). Chosen as
  a single combined name for what were previously separate "PvP tab" and unnamed PvE-adjacent
  ideas, since both are fundamentally fleet-wide combat operations.
- **System** — the existing Options overlay content (theme picker, delete-save), relocated here, plus
  a new small "Export Save" action (download the current save as a JSON file).

## What's being fully retired this phase

The Generator Stack (`modules: {miner, refinery, fabricator, synthesizer}`, and the four resources it
produced — `ore`/`ingots`/`components`/`alloys`, all per-captain) is removed entirely. Captains no
longer run an independent passive economy of any kind; their only "economy" going forward is
mission dispatch.

Three systems built entirely on top of the Generator Stack are retired alongside it, since none of
them have anything left to operate on:

- **Research** (the `alloySynthesis` project and its duration-scaling machinery).
- **Skill Tree** (`skillPoints`, `unlockedSkillNodes`, the `SKILL_TREE` table, its research-speed
  buff, and its Command-branch captain-slot unlocking — the last of these is directly superseded by
  the new level-based captain-slot system below, not just orphaned).
- **Both Prestige tiers** (`captainPrestige`, fleet-wide `prestige`, `augmentPoints`, `prestigeCount`,
  `captainPoints`, `captainPrestigeCount`). A captain's `specialization` (today, purely a Generator
  Stack production multiplier) retires with them — a mission-flavored version of "specialization" is
  a natural piece of the future full talent system, not something this phase tries to preserve in a
  now-meaningless form.

This is the largest single removal of shipped mechanics this project has done. It's a deliberate,
explicit trade: these systems don't degrade gracefully into "a smaller version of themselves" once
their foundation is gone, so keeping any of them running in a half-working state would be worse than
retiring them cleanly and replacing their *purpose* (progression, a use for accumulated points, a
sense of restarting-with-benefits) with the new leveling system below.

## Homeworld structures — the crafting chain

Mission loot (today's `commonOre`/`uncommonMaterial`/`rareMaterial`, landing in `homePlanet.storage`
exactly as Phase 3a built it) becomes the sole raw material source. It's displayed to the player
using flavor naming ("Unobtainium Ore" for the common tier, etc.) — the underlying data key
(`commonOre`) is unchanged; this is a display-label change only, not a data rename, to avoid an
unnecessary migration.

Two new fleet-wide structures, each with exactly one recipe at launch (this phase proves the crafting
mechanic; a richer recipe list is explicit future work, not attempted now):

- **Refinery**: consumes N Unobtainium Ore → produces M **Refined Material** (a new resource).
- **Fabrication**: consumes N Refined Material → produces M **Components** (the name is reused now
  that the old per-captain Components no longer exists).

Both recipes are manual-craft-button only this phase (the player clicks Craft, if they have enough
input it's consumed and the output is produced). An auto-craft toggle is a near-term, separate
follow-up, not bundled into this phase.

Recipes are defined in a new data-driven `RECIPES` table, mirroring the established pattern used for
`MISSIONS` and (formerly) `SKILL_TREE`/`RESEARCH_PROJECTS`: each entry declares its input material
requirements and its output, and one generic `craftRecipe()` function validates, deducts, and
produces — the same function serves every recipe, so growing Fabrication into the "fully fleshed
out crafting system" the player wants eventually is a matter of adding table entries, not new engine
work.

## Captain leveling + slot unlocks

Each captain gains XP when one of their mission cycles completes (the existing "unloading phase
finishes, cargo delivered" event from Phase 3a — no new tracking needed, just a new side effect on
an event that already exists). XP-to-next-level grows with a simple formula rather than a hand-tuned
table, since level count is open-ended. Leveling up grants stat points.

A new, small, hand-tunable table — `CAPTAIN_SLOT_UNLOCKS` — replaces the Skill Tree's Command branch
as the mechanism for growing the fleet. Each entry names a level threshold, a stat-point cost, and a
Components cost for unlocking that slot. Any captain who has reached the required level can spend
their own stat points, together with the shared Components cost, to unlock the next slot — this
keeps the "spend points earned through play, plus crafted materials, to grow the fleet" loop
entirely within systems this phase already builds, rather than introducing a fourth currency.

The full talent/equipment system (spending stat points on per-captain gear/traits beyond slot
unlocks) and any separate "Fleet Admiral" meta-progression layer are explicitly deferred — this
phase ships just enough of the leveling loop (XP, levels, stat points, slot unlocks) to keep the
existing multi-captain mechanic alive and give players something to work toward, without designing
a system the project isn't ready to commit to yet.

## Save migration

This will be the largest migration this project has written (v8 → v9) — the first to *remove* fields
rather than only add them. This is lower-risk than it sounds: an old save's now-unused fields
(`modules`, `resources`, `research`, `skillPoints`, `unlockedSkillNodes`, `augmentPoints`,
`prestigeCount`, `captainPoints`, `captainPrestigeCount`, `specialization`) don't need to be actively
stripped — once the `CaptainState`/`GameState` interfaces stop declaring them, nothing in the
codebase reads them anymore, and their stale presence in an old JSON blob is inert, harmless dead
data, not a runtime hazard. The migration's real job is backfilling the NEW required fields (`xp`,
`level`, `statPoints` per captain; new fleet-wide `refinedMaterial`/`components` pools) — same shape
of work as every prior migration, just paired with fields quietly aging out rather than being added.

## Testing

- The new `RECIPES` table and `craftRecipe()`: input-sufficiency validation, correct deduction,
  correct production, and a same-state-reference-on-failure guard (matching every other buy/action
  function's established convention).
- Captain leveling: XP awarded on mission-cycle completion (verify it fires from the existing
  `tickCaptainMission` completion path, not a new one), the level-up curve's correctness, stat-point
  accrual, and `CAPTAIN_SLOT_UNLOCKS`' threshold/cost gating (including the same-state-reference-on-
  failure convention).
- The v8→v9 migration: a genuine v8-shaped fixture (hand-written literal, not built via `freshState()`
  since that shape is moving on) confirming new fields backfill correctly and old fields are
  harmlessly ignored (not actively stripped, per the design above). Extend the chained v1→v8 test to
  v1→v9.
- Manual-only (Node unavailable, no UI test runner): the tab-switching shell itself, and confirming
  each relocated panel renders identically in its new tab as it did in the old single-column layout.

## Explicitly deferred (future phases, not designed yet)

- Auto-craft toggle for Refinery/Fabrication (near-term fast-follow once manual crafting is proven).
- Shipyard and Starbase content for Sector Space.
- PvP/PvE content for Battlespace (and the orbital-bombardment mechanic tying Starbase to it).
- The full talent/equipment system for captains (gear, traits, beyond slot unlocks).
- A separate "Fleet Admiral" meta-progression layer, if one turns out to be wanted at all.
- Per-mission-location material variety with rarity tiers/colors (white/green/blue/etc.) — this phase
  keeps the existing single common/uncommon/rare material family exactly as Phase 3a built it.
- Home Planet storage capacity + upgrades (already deferred from Phase 3a, still not picked up).
