# Hyperion Legacy (working title: Fleet Admiral) - Technical Specification

*Companion document to `fleet_admiral_master_design.md`. Where the design doc answers "what is the game," this document answers "how is the code organized." Both live alongside each other in the project.*

*This spec covers foundational technical decisions that are expensive to change later. Content, mechanics, balance numbers, and features live in the design doc. Data models, engine architecture, save format, and tick semantics live here.*

*Every section has a **Decision** field with the current best answer. Decisions can change during prototyping, but changes should be deliberate and dated.*

---

## Table of Contents

1. Data Model
2. Tick Loop and Time Semantics
3. Generator Stack Structure
4. Capability System
5. Prestige State Categories
6. Save File Format Contract
7. Fleet Scope and Scaling
8. Campaign Gating Model
9. Monetization Strategy
10. Change Log

---

## 1. Data Model

### Purpose
Defines the core entities of the game and their relationships. Every mechanic in the design doc translates to operations on this data. Getting this wrong makes everything else harder.

### Entities

**Player.** Singleton. Represents the fleet admiral.
- Global fleet-level resources (energy, currency pools)
- Global research state
- Global unlocks (capabilities, achievements)
- Currently-selected active view

**Captain.** Persistent named characters.
- Stable unique ID
- Name (default generated, player-editable)
- Traits (innate, assigned at creation)
- Specialization
- Skill values per skill category
- Augment tree state
- Assigned ship ID (nullable if between assignments)
- Career log entries
- Recruitment date / provenance

**Ship.** Persistent vessel entities.
- Stable unique ID
- Name (player-editable)
- Class / hull type
- Module slots and installed modules
- Crew slots and assigned crew IDs
- Cargo state (matter inventory)
- Assigned captain ID (nullable when in dry dock)
- Ship log entries
- Status (active, retired-to-fleet, decommissioned, in-mission)

**Crew.** Individual specialists on ships.
- Stable unique ID
- Name (auto-generated, less identity than captains)
- Specialization role
- Skill level per role
- Augment state (lighter than captains)
- Assigned ship ID (nullable)

**Module.** Ship components.
- Stable unique ID
- Type (mining laser, cargo hold, research bay, etc.)
- Tier
- State (installed on ship X, or in storage)
- Currently active operation, if any

**Sector.** Campaign locations.
- Stable ID (probably sequential: sector_1, sector_2, etc.)
- Unlocked / cleared / current status
- Resources available
- Modifiers active in this sector
- Boss encounter definition
- Mission templates available

**Mission.** Both templates and instances.
- Template: static definition of a mission type
- Instance: an active dispatched mission (captain ID, ship ID, start time, expected completion time, current progress)

**Research Project.** Research state.
- Template: what can be researched
- Instance: currently-in-progress research (energy allocated, completion progress)

**Relic.** Unique discoveries.
- Stable unique ID
- Type
- Discovered timestamp
- Effect data
- Lore text

**Achievement.** Both templates and instance state.
- Stable unique ID (string, kebab-case: `first-boss-defeated`, `mining-master-bronze`)
- Category (enum: progression, discovery, mastery, completion, curiosity, persistence, meta, hidden)
- Tier (nullable: bronze / silver / gold, or null for one-of-a-kind)
- Display name (may be `???` if hidden and unearned)
- Description (may be hidden if unearned)
- Trigger condition (structured data describing what fires it)
- Progress state (for tiered achievements: current value vs threshold)
- Reward specification (data describing what unlocks on earn)
- Earned state (boolean + `earned_at` game-time-seconds, nullable)
- Hidden flag (boolean)

**Collectable Entry.** Entries in the Compendium beyond Relics (which have their own entity above).
- Stable unique ID
- Type (enum: material, ship_class, captain_type, codex_entry, boss_encounter, sector_completion)
- Display name
- Lore / description text
- Discovery condition
- Discovered state (boolean + `discovered_at` game-time-seconds, nullable)
- Optional mechanical effect (rare; most collectables are pure information)
- Additional type-specific fields (e.g. boss encounters track composition-used, fastest-clear, no-loss-clear separately)

### Key Relationship Decisions

**Captains have stable IDs and can be reassigned between ships.**
Reassigning a captain is a reference update, not an ownership transfer. The captain object doesn't move; only the `assigned_ship_id` field on the captain and the `assigned_captain_id` field on the ship change.

**Ships own their modules and crew as references.**
A module or crew member has an `assigned_ship_id`. When a ship is decommissioned, its modules and crew return to a pool (or are lost, per design decision, see design doc 8.F.4). Not deep-copied into the ship's state.

**Time is tracked in accumulated game-seconds from campaign start.**
Not wall-clock timestamps. Not tick counts. Accumulated game-seconds. This makes math clean (elapsed time is `now - start`) and makes save/load resilient to system clock changes.

**All entity references are by ID, not by direct object nesting.**
The save file has flat collections of each entity type. References between entities are ID strings. This keeps the save format sane and makes retroactive updates trivial (find entity by ID, mutate, done).

**Achievement and Collectable definitions live in game data, not the save.**
The save only stores earned/discovered state (progress values, timestamps, earned booleans). The actual achievement and collectable definitions (names, descriptions, conditions, rewards) live in code or in a static data file bundled with the build. This is what makes retroactive tracking possible: new achievements added in an update are new entries in the data file, and existing saves can be checked against the new definitions on load.

### Decision
Use a flat entity store keyed by type and ID:
```
gameState = {
  player: { ... },
  captains: { captain_1: {...}, captain_2: {...}, ... },
  ships: { ship_1: {...}, ship_2: {...}, ... },
  crew: { crew_1: {...}, ... },
  modules: { module_1: {...}, ... },
  sectors: { sector_1: {...}, ... },
  activeMissions: { mission_inst_1: {...}, ... },
  activeResearch: { research_inst_1: {...}, ... },
  relics: { relic_1: {...}, ... },
  achievements: { "first-boss-defeated": { earned: true, earned_at: 3600 }, ... },
  collectables: { "material-veridium": { discovered: true, discovered_at: 7200 }, ... },
}
```
Cross-references are always by ID string. Never nest entities inside other entities' state. Achievement and collectable state entries only hold per-save progress; the definitions themselves are loaded from bundled game data at runtime.

### Achievement Trigger Architecture

Achievements are event-driven. During normal game logic, semantic events fire with payload data:
- `bossDefeated` (payload: bossId, fleetComposition, timeToDefeat, shipsLost, ...)
- `sectorCleared` (payload: sectorId, timeToClaim, missionsCompleted, ...)
- `materialDiscovered` (payload: materialId, source, ...)
- `captainRecruited` (payload: captainId, traits, source, ...)
- `prestigePerformed` (payload: tier, currency_generated, ...)
- `missionCompleted` (payload: missionId, success, spoils, ...)
- (many more; grows organically)

The achievement system subscribes to these events and checks conditions on every fire. Efficient: only achievements whose conditions match the event type are checked.

Progress-based (tiered) achievements maintain running counters. Each event that matches increments the counter; if counter crosses a threshold, tier is awarded.

**Retroactive check on save load.** When a save is loaded (especially after an update that added new achievements), the system:
1. Iterates all defined achievements.
2. For each unearned achievement, examines the save state to see if the condition is already satisfied by existing accumulated data.
3. Awards any achievements that qualify.
4. Achievements that require *events* rather than *state* (e.g. "defeat boss X without losing a ship") cannot be retroactively awarded from stored state alone; these are marked as "eligible from future play only" in the code, with the definition making this explicit.

This is why the data model tracks state (materials discovered, sectors cleared, etc.) rather than only firing events: state can be examined retroactively, events cannot be re-fired.

### Compendium Navigation

The Compendium view is a projection over the entity store, not its own state. Rendering the Compendium:
1. Group entities by type (materials, ship classes, boss encounters, etc.).
2. For each entity, look up the corresponding collectable/relic/achievement state.
3. Display progress counts (`X of Y`) computed from the counts of state entries per category.
4. Support navigation: clicking a Compendium entry opens a detail view; clicking "source" jumps to the relevant sector/captain/mission.

No separate Compendium state is stored in the save. Everything is derived from primary game state.

---

## 2. Tick Loop and Time Semantics

### Purpose
Defines what "one second of gameplay" means in code. Determines how offline progression works, how the debug speed multiplier works, and how mission timing is computed.

### Concepts

**Wall time.** Real-world time. `Date.now()`. Only used for computing elapsed durations.

**Game time.** Accumulated seconds since campaign start. Advances at wall-time-rate × speed-multiplier. All game logic is in game-time.

**Tick.** A discrete update pass. Not equivalent to one game-second; a tick can compute any elapsed duration via delta-time.

**Tick rate.** How often the game recomputes state. Nominal: 10 Hz during active play (100ms per tick).

**Delta.** Elapsed game-seconds since the last tick. On every tick, delta = `(current wall time - last tick wall time) × speed multiplier`.

### Tick Function Signature
```
function tick(deltaSeconds: number, gameState: State): State
```
Pure function. Takes current state and elapsed seconds, returns new state. Must produce identical results whether called with `delta=100` once or `delta=1` a hundred times. This is the closed-form requirement.

### Event Model
Continuous state changes (resource accumulation, research progress) advance smoothly with delta.

Discrete events (mission completion, augment install, sector clear) are queued and processed at tick boundaries. Events have an `at_game_time` field. On each tick, the loop processes all events with `at_game_time <= current game time` in order.

### Offline Handling
When the game loads a save:
1. Compute wall-time delta since save.
2. Multiply by pending time-multiplier (may include offline efficiency reductions, capped max offline time, etc.).
3. Call `tick(delta, savedState)` once with the full delta.

This works because tick is closed-form. Offline is just a very large delta.

### Speed Multiplier
A global variable, default 1.0. Modifies the effective delta per tick:
```
delta = (wallTime - lastWallTime) * speedMultiplier
```
No changes to game logic needed. Speed becomes: 0 = paused, 1 = real-time, 100 = 100x faster.

### Decisions
- Tick rate: 10 Hz active, single-shot on load for offline.
- Delta is a floating-point number of game-seconds.
- All tick logic is closed-form.
- Events are queued with target game-time and drained on tick boundaries.
- Speed multiplier modifies delta, not tick rate.

---

## 3. Generator Stack Structure

### Purpose
Defines how the incremental generator engine maps onto captain / ship / crew entities. The design doc says the stack is "distributed"; this section pins down what that means concretely.

### The Layered Production Model

**Layer 0: Modules produce base resources.**
A mining laser module produces `matter_common` at some base rate per game-second. A refinery module transforms `matter_common` into `matter_refined`. Etc.

**Layer 1: Crew skill modifies module output.**
A module operated by high-skilled crew produces at (1 + crew_skill_bonus) × base_rate. Crew are the multiplier on modules.

**Layer 2: Captain traits modify ship-wide output.**
Captains provide ship-wide multipliers or capabilities. An "Efficient" captain gives their ship +10% production across all modules. A "Scientific" captain enables research modules to be installed.

**Layer 3: Fleet-wide upgrades stack over everything.**
Research unlocks, achievement bonuses, monument bonuses (design doc 8.F.9) apply as global multipliers across the fleet.

**Layer 4: Prestige-persistent bonuses.**
Tier 1 prestige currency spent on permanent upgrades applies at this layer.

### Production Formula
For any produced resource on any ship at any moment:
```
rate = base_module_rate
     * (1 + sum_of_crew_bonuses)
     * (1 + sum_of_captain_bonuses)
     * (1 + sum_of_fleet_bonuses)
     * (1 + sum_of_prestige_bonuses)
```

Additive within layer, multiplicative across layers. This prevents runaway compounding within a layer while allowing meaningful stacking across layers.

### Compounding via Purchases
The "generator stack" pattern (things that produce things) manifests as:
- Buy a new module (produces resources).
- Buy a new crew member (multiplies module output).
- Recruit a new captain (enables new module types and ship-wide bonuses).
- Acquire a new ship (multiplies fleet capacity, essentially another parallel stack).
- Research a new tier (unlocks better modules).

Each of these is a purchase decision with exponentially scaling cost. Each unlocks either a new production line or a new multiplier on existing lines.

### Decisions
- Production is layered: module × crew × captain × fleet × prestige.
- Within a layer, bonuses add. Across layers, they multiply.
- New content (modules, crew, captains, ships, research tiers) is what the player "buys." Each has exponential cost scaling.
- The stack is not one giant number; it is many parallel small stacks (one per ship, plus research, plus fleet) that all interact through the formula above.

---

## 4. Capability System

### Purpose
Design principle 6.7 says augments should unlock capabilities. This section defines what a capability is as data and how it gates content.

### Concept
A **capability** is a named string that can be held by a captain, ship, or the fleet as a whole. Capabilities are binary (held or not held). They gate content: sectors, missions, and boss encounters can declare capability requirements that must be satisfied for the content to be accessed.

### Capability Names
Simple string identifiers. Suggested convention: `<category>.<specific>`, e.g.:
- `piloting.deep_space`
- `piloting.high_gravity`
- `piloting.stealth`
- `science.xenobiology`
- `science.cryptography`
- `combat.point_defense`
- `combat.electronic_warfare`
- `survival.radiation_shielding`
- `survival.pressure_tolerance`

### Capability Holders
- **Captain capabilities** come from augments and specializations. Each augment can grant one or more capabilities.
- **Ship capabilities** come from installed modules. A pressure-hardened hull grants `survival.pressure_tolerance` at the ship level.
- **Fleet capabilities** come from research and achievements. Certain research unlocks apply across the fleet.

### Requirement Resolution
A content unlock (sector, mission, boss) declares required capabilities. The check is satisfied if for each required capability, at least one accessible entity (dispatched captain + their ship + the fleet) holds it.

```
canAccess(content, captain, ship, fleet) =
  all(required in content.requirements:
    required in captain.capabilities
    or required in ship.capabilities
    or required in fleet.capabilities)
```

Capabilities do not stack or have levels. They are either held or not. Numerical bonuses (rate boosts, damage bonuses) are separate from capabilities and live in the production formula.

### Decisions
- Capabilities are string identifiers, binary (held or not).
- Held at three levels: captain, ship, fleet.
- Requirements resolved by checking presence across all three levels.
- Naming convention: `category.specific`.
- Numerical bonuses are separate from capabilities.

---

## 5. Prestige State Categories

### Purpose
Prestige is one of the most balance-sensitive systems in an idle game. This section defines what resets, what persists, and what currency is generated at each prestige tier.

### State Categorization
Every piece of game state falls into one of five categories:

**Category A: Session-only.**
UI selections, active screen, dismissed notifications. Not saved, not persisted, obviously not affected by prestige. Reset on page load.

**Category B: Reset every prestige (both tiers).**
Current session resources (unspent common matter, current cargo contents, current in-progress missions). These are consumed by the prestige act.

**Category C: Reset on Tier 1 prestige, persist through Tier 2.**
Captain-specific: current skill levels, current augment slate on the prestiging captain. Tier 1 is the captain's reset; it wipes their personal progression to enable a higher cap.

**Category D: Persist through Tier 1, reset only on Tier 2.**
Ship-specific: modules installed, ship-level upgrades. Tier 2 is the ship's reset; it retires the ship (moving it to fleet-standing status per design 4.11) and starts fresh.

**Category E: Never reset.**
Player-level state: fleet roster, campaign progress, sector unlocks, research completed, achievements, hall of records, codex entries, relics found, prestige currency accumulated. These are the persistent accomplishments.

### Prestige Currency Yields
Explicit formulas will require balance tuning. For now, the *shape* is:
- Tier 1 prestige yield scales with captain's terminal skill level.
- Tier 2 prestige yield scales with ship's terminal module tier plus captain's accumulated tier-1 count.
- Yields are always positive (never zero) but curve is aggressive: doubling your progression before prestige should yield roughly √2 more currency, not 2x. This prevents "just grind longer for exponentially more" degeneration.

### Currency Types
- **Augment Points**: from Tier 1. Spent on captain augment tree.
- **Fleet Points**: from Tier 2. Spent on fleet-wide permanent unlocks and new ship class access.
- **Both are separate currencies.** Not interchangeable. This preserves the strategic weight of each prestige tier.

### Decisions
- Five categorization tiers (A-E) determine reset semantics.
- Every game state field is assigned to exactly one category during implementation.
- Tier 1 = captain reset (Category B and C wipe).
- Tier 2 = ship reset + fleet promotion (Category B, C, D wipe on the prestiging entity only).
- Two distinct prestige currencies. Yields curved to prevent over-grinding.

---

## 6. Save File Format Contract

### Purpose
The save file is the contract with the player. Every state change during development that affects save shape adds burden to migration. Get the format right early.

### Storage Location
- **Development / v1**: `localStorage` under key `fleet_admiral_save`.
- **Once saves exceed ~1MB compressed**: migrate to IndexedDB.
- **Later**: optional cloud sync via Vercel serverless function to a remote store.

### Format
JSON serialized then LZ-string compressed. Base64 encoded for portability (allows copy-paste sharing for debug purposes).

### Top-Level Shape
```json
{
  "version": 1,
  "created_at": 1704067200,
  "last_saved_at": 1704153600,
  "game_time_seconds": 3600,
  "state": { ... }
}
```

- `version`: integer, incremented on schema change.
- `created_at`, `last_saved_at`: Unix epoch seconds, wall-time.
- `game_time_seconds`: accumulated in-game seconds since campaign start.
- `state`: full game state (as per Section 1 data model).

### Migration Policy
- Each version bump ships with a migration function: `migrate_v1_to_v2(state)`.
- Loading a save runs migrations in sequence: `state@v1 → migrate_v1_to_v2 → state@v2 → migrate_v2_to_v3 → ...` up to current version.
- Migrations are pure functions. No side effects. Deterministic output.
- Saves older than 5 versions may be dropped from support with a clear warning to the player. In practice, migrations should never be so complex that this is required, but the policy exists.
- Corrupt saves (invalid JSON after decompression, missing required fields, version too new for this build) produce a specific error state with option to export the raw save data for support.

### Save Frequency
- Autosave every 30 seconds during active play.
- Save on any significant event (prestige, ship promotion, boss victory, sector unlock).
- Save on page unload (`beforeunload` event) with best-effort synchronous write.
- Manual save button in UI for player control.

### Save Slots
- v1: single save slot.
- Future: multiple slots (up to 3 for user, unlimited for dev mode). Slot management UI.
- Cloud saves treated as a separate slot from local.

### Decisions
- JSON + LZ-string + Base64.
- Version integer, migrations chained.
- Autosave every 30 seconds + on events + on unload.
- Corrupt save handling: preserve raw data, offer export, do not silently discard.

---

## 7. Fleet Scope and Scaling

### Purpose
Determines the target size of the fleet at various campaign points, which drives UI design, balance math, and player mental model.

### Progression Curve

**Sector 1 (game start):** 1 ship, 1 captain. Tutorial-ish scale. Player learns the core loop with a single actor.

**Sectors 2-3:** Still 1 ship as active. Tier 1 prestige loops introduce augmentation as the primary progression. Maybe 1-2 additional crew members recruited.

**Sector 4 (first Tier 2 prestige available):** 2 ships. First retired ship enters fleet-standing status. Player begins managing a small fleet.

**Sectors 5-7:** Growing to 4-5 ships. Boss encounters begin to require fleet composition decisions. Passive fleet activities (design doc 8.B.2) become relevant here.

**Sectors 8-10 (campaign endgame):** 6-8 ships. Complex boss compositions. Fleet identity solidified. Some ships specialized to the point of near-uselessness outside their role.

**Post-campaign / NG+:** Fleet caps at 8-10 ships. Additional ships are diminishing returns; the game does not scale to 30-ship fleets. The design intent is for each ship to remain a meaningful individual entity.

### Fleet Cap Rationale
Idle games with unbounded scaling become spreadsheet management. A capped fleet of 8-10 ships keeps each ship visually distinct on-screen, keeps captain roster manageable in memory, and preserves the individual-attachment mechanic the design relies on.

### Decisions
- Soft cap at 8-10 ships for the endgame.
- Progression is not linear; most sectors add 0-1 ships, with a couple of jumps.
- Excess ships past the cap are decommissioned or salvaged, not stockpiled.

---

## 8. Campaign Gating Model

### Purpose
Determines whether the player can over-prepare in a sector, or whether each sector has a hard ceiling. This is a foundational design choice with balance implications.

### Model: Soft Gates with Diminishing Returns

The player *can* stay in a sector after clearing its boss and continue accumulating resources. However, returns diminish sharply:

- Passive resource generation in a cleared sector continues at 100% for the first ~2 hours after clear.
- After that, generation rates decay by 50% every subsequent 2 hours until they bottom out at ~10% of peak.
- Rare drops and relics have a fixed count per sector; once discovered, they cannot be re-farmed.
- Boss rewards are one-time.

This lets players who want to stay in a sector do so without punishment, but prevents the "grind Sector 1 for 40 hours to steamroll Sector 2" degenerate strategy.

### Sector Unlock Gates
Sectors are gated by:
- **Capability requirements** (see Section 4).
- **Campaign progression** (the boss of the previous sector must be defeated).
- **Fleet size minimum** in some cases (later sectors require the fleet to have grown).

Sectors are *not* gated by resource cost alone. Players cannot buy their way past a sector; they must satisfy capability requirements.

### Boss Difficulty Scaling
Each boss has a "target fleet readiness" that the balance math targets. If the player is above the target, the fight is easier (but never trivial due to composition requirements). If below, the fight is possible but risky. If far below, the pre-fight simulator (design doc 8.F.5) will indicate low win probability.

Bosses do not level-scale with the player. A boss's stats are fixed at design time. This means the player's preparation directly translates to boss encounter results, which is what makes preparation feel meaningful.

### Decisions
- Sectors have soft gates: over-preparation is allowed but sharply diminishing.
- Rare drops per sector are one-time (no infinite farming).
- Sectors gated by capabilities and campaign progression, not resource cost.
- Bosses are fixed-difficulty at design time. Preparation is the player's variable.

---

## 9. Monetization Strategy

### Purpose
Non-predatory monetization for a hobby project. Goal: cover hosting costs and possibly generate meaningful supplemental income without exploiting players or degrading the game experience. This section documents all viable options with honest tradeoffs so a decision can be made after the game demonstrates traction. Do not implement any of this until v1 has shipped and has an audience.

### 9.1 Realistic Revenue Expectations

Non-predatory models generate modest revenue. That is the honest tradeoff for not exploiting players.

- **Pure donation**: ~1-3% of active players donate anything. Average $5-15.
- **One-time purchase**: ~5-15% conversion depending on perceived value.
- **Cosmetic paid options**: 1-10% depending on quality and integration.
- **Paid expansions post-launch**: variable but potentially significant with a devoted audience.

Frame expectations correctly: covering hosting plus modest supplemental income is realistic. Getting rich is not. If the game finds a genuine audience of thousands of engaged players, meaningful supplemental income becomes possible. Below that, hosting-cost-only is the honest expectation.

### 9.2 Model Options

Five viable models. Each has different ethical, practical, and implementation tradeoffs. Two are flagged as preferred candidates for this project.

#### 9.2.1 Pay-Once, Own-Forever (Premium)
Develop game to a complete state. Release at small fixed price ($5-15). Players buy once, own forever. No in-game purchases.

**Pros:** Cleanest possible model. No perverse incentives to make the game worse. No ongoing monetization design work. Buyers are self-selected fans who wanted the game.

**Cons:** All revenue happens at purchase; no long tail. Requires a "finished" state to sell. Store platform revenue cut (Steam 30%, itch.io 10% default). Marketing burden falls entirely on developer.

**Best fit for:** games with clear endings and marketable identity. This game has an explicit ending, so this is a natural fit. Could be released alongside a free demo version.

#### 9.2.2 Optional Supporter's Edition (PREFERRED CANDIDATE)
Game free forever with complete campaign. Optional one-time purchase ($5-10) grants:
- Cloud save sync across devices
- Additional save slots (base: 1, supporter: 3-5)
- Optional "Supporter" flag in codex or profile view
- Player's name added to in-game supporters roster (opt-in only)
- Access to all future palette/theme packs at no additional cost

**Pros:** No content gated behind purchase. Purchase is genuinely optional and non-essential. Cloud sync is legitimately valuable and worth paying for. Supporter recognition adds emotional value without exploiting. Aligns with project ethics.

**Cons:** Conversion typically 2-8%. Requires cloud save infrastructure investment. Ongoing hosting cost grows with player count (though slowly at hobby scale).

**Best fit for:** projects prioritizing ethics with a real value exchange. Fits this project's architecture cleanly given the localStorage + Vercel serverless direction already established.

#### 9.2.3 Pure Donation (Ko-fi / Buy Me a Coffee / GitHub Sponsors / Patreon)
Game free forever. Prominent-but-non-intrusive donation link connects to a third-party platform. Donations are one-time or recurring at donor's choice. Nothing changes in the game for donors (optional thank-you email or credits inclusion).

**Pros:** Zero design or infrastructure burden on the developer. No conversion optimization required. Ethically cleanest option.

**Cons:** Lowest conversion of any model. Depends entirely on player generosity, which skews low for indie games. Best used *alongside* another model, not as the sole revenue path.

**Best fit for:** any project as an additive option. Costs nothing to include. Should be present regardless of what primary model is chosen.

#### 9.2.4 Paid Content Expansions (post-v1)
Base game free (or one-time purchase). Optional post-launch expansions add new sectors, campaigns, ship classes, or enemy factions. Each expansion is a small one-time purchase ($3-10).

**Pros:** Rewards ongoing development directly. Players who love the game and want more content can pay for more. No pressure on non-paying players; the base game remains complete.

**Cons:** Only viable if the base game has an audience already. Requires ongoing content development commitment. If the developer burns out or loses interest, expansions stop and this revenue path dies.

**Best fit for:** post-launch year 2+, not v1. Best combined with another model. Consider only after the game has proven it has an audience worth serving.

#### 9.2.5 Palette / Theme / Interface Packs (PREFERRED CANDIDATE)
Sell cosmetic UI variations as low-cost packs ($1-3 each, bundle for $5-8). Natural variation points given the game's visual identity:

- **Palette packs**: default cyan; alternatives could include amber-warm, green-military, purple-void, red-alert, monochrome.
- **Interface style packs**: default glassy holographic; alternatives could include minimalist flat, baroque ornate, retro-CRT scanline, industrial utilitarian.
- **Background effect packs**: default starfield; alternatives could include drifting nebula, deep-space void, wormhole streaks, planetary orbit views.

**Pros:** Aligns with the game's visual investment. Modular; new packs can be added over time as small releases. Player is expressing themselves through choice rather than being manipulated. Non-gameplay-affecting so no balance concerns.

**Cons:** Requires theme/palette abstraction in CSS from day one (very cheap if built early, painful to retrofit later). Requires actual design work per pack.

**Best fit for:** projects with strong visual identity that supports variation. This project qualifies given the aesthetic direction in the design doc Section 9.6.

#### 9.2.6 Charity Packs (FUTURE-FUTURE CONSIDERATION)

Special limited-run cosmetic packs where 100% of revenue (minus payment processor fees and any legally required taxes) is donated to a named charity. Distinct from all other monetization options: this is not for the developer, it is for the world.

**How it works.**
- Announced pack with specific contents (portraits, ship skins, unique captain naming rights, exclusive palettes, or thematically-linked cosmetics).
- Announced charity partner with clear identification and mission.
- Pack sold at fixed price ($5-25 typical range) for a fixed period (a month, a quarter, or a milestone-tied event).
- After the sale period closes, receipts and totals are published in-game and publicly.
- Contents remain owned by purchasers forever; only the sale period is time-bound.

**What makes this specifically distinctive:**
Most games that donate to charity do so as one-off marketing events. Ongoing integrated charity packs as a permanent alternate monetization tier is genuinely rare. It signals to potential players that the game's monetization exists partly to fund things the developer cares about, not solely to fund the developer. That signal is a real trust differentiator.

**Design constraints for this to work ethically:**
- **Transparency is the mechanic.** In-game display of charity packs sold, cumulative amount donated per partner, receipts publicly linkable. Without transparency the pattern collapses into "trust me it went somewhere," which is not credible.
- **Pack content must be legitimately valuable.** Charity is not a substitute for value. If the pack is empty and the pitch is "well, it goes to charity," conversion will be poor. The pack must be *worth buying on its own* with the charitable donation as the sweetener.
- **Choose charities carefully.** Any named charity alienates some fraction of the audience. Broadly acceptable options for indie game audiences tend to include: mental health advocacy, environmental groups, disaster relief funds, medical research foundations, educational access nonprofits. Rotate over time to keep things fresh and to avoid the perception of promoting one cause exclusively.
- **The math must be clear.** "100% minus processor fees" is precise and defensible. "Most of it" is not. Publish the exact math for each pack post-sale.

**Practical infrastructure requirements:**

- **Legal/accounting.** Business-donation-to-charity involves tax implications and requires clear documentation. Depending on jurisdiction and volume, may require CPA involvement or specific business structure. Not blocking, but budget the time when this becomes relevant.
- **Third-party platforms exist.** Services like Tiltify or Humble Bundle's donation platform handle the mechanical distribution and public reporting at their own fee (adds to the "minus fees" total). Trades convenience for a slightly smaller charity contribution.
- **Direct donation is possible.** Some charities have donor-advised fund options that reduce administrative overhead. Investigate options once volume warrants it.

**Timing.**
This is a v2+ concept, or later. Prerequisites:
- Game has a real audience (thousands of engaged players minimum for donations to be meaningful, not just symbolic).
- Base monetization (Supporter's Edition, palette packs) is running smoothly.
- Legal/accounting infrastructure for business donations is in place.
- A charity partner or rotation is identified with clear alignment.

**Positioning.**
Charity packs are additive to the other monetization tiers, not a replacement. The full picture becomes:
- Free game (base)
- Supporter's Edition (personal benefit, funds the game)
- Palette / theme packs (cosmetic, funds the game)
- Charity packs (cosmetic, funds the world)
- Donation link (direct support, funds the developer)

Each tier serves a distinct value proposition. Together they cover a wide range of player intentions without any tier being predatory or pressuring.

**Volume caveat.**
For charity packs to be meaningful rather than symbolic, they need real volume. If a pack raises $50, that is fine but not moving the needle for the named charity. For this reason, charity packs are best deployed once the game has proven audience traction. Prematurely deploying them yields a nice gesture with negligible actual impact.

### 9.3 What to Avoid

For clarity, ethical no-go zones:

- **Gacha / lootbox mechanics.** Obvious no.
- **Time-skip purchases.** Turns waiting from a feature into a punishment monetized for relief. Toxic.
- **Pay-to-win in any form.** Obvious no.
- **Energy / stamina limits refillable by paying.** Turns your idle game into an F2P mobile clone.
- **Consumables requiring repeat purchase.** Pressures ongoing spending.
- **FOMO events with real-money purchase pressure.** Turns the game into a job.
- **Ads (in-game, video, banner).** Not strictly predatory but degrades experience and cheapens the game's identity.
- **Data harvesting for third-party sale.** This monetizes players rather than the game itself. Ethically worse than most predatory mechanics.

### 9.4 Recommended Combined Approach

Combine three models for practical robustness. This is the approach that best fits stated project preferences (Models 2 and 5 flagged, ethical constraints in place).

1. **Free base game.** Full campaign, full core loop, no artificial limits. Every mechanic is accessible without paying.
2. **Optional Supporter's Edition purchase** ($5-10, Model 9.2.2) providing cloud save, additional slots, recognition, and future palette pack access.
3. **Palette / theme pack purchases** ($1-3 each, Model 9.2.5) with all packs included free for Supporter's Edition owners.
4. **Prominent-but-not-obnoxious donation link** for players who want to give more without a formal transaction (Model 9.2.3). Ko-fi is a good default choice.

This combination:
- Gates zero content
- Creates no ongoing spending pressure
- Provides genuine value to purchasers (cloud sync, cosmetics, recognition)
- Scales linearly with audience through legitimate value exchange
- Requires minimal ongoing monetization design work
- Aligns with project ethics

### 9.5 Implementation Requirements

Specific technical infrastructure needed to support the recommended combined approach. Do not build any of this in v1; this section documents what will be needed later.

#### 9.5.1 Payment Processing
- **Primary option: Stripe.** ~2.9% + $0.30 per transaction. Handles international currencies, refunds, subscription management if needed. Developer handles VAT/GST compliance.
- **Alternative: Paddle.** Higher fee (~5-8%) but handles all tax and VAT compliance globally as merchant of record. Worth the premium for a solo developer who wants to skip international tax paperwork.

**Recommendation:** Paddle for solo developer sanity unless volume makes Stripe's savings meaningful (typically not until well past hobby scale).

#### 9.5.2 License / Entitlement Verification
After payment, the player receives a license key or their account is flagged as supporter. On game load, the client verifies entitlement against a Vercel serverless function. Entitlement is cached in localStorage with occasional re-verification.

Do not over-engineer anti-piracy. Players who won't pay $5 will not be converted by DRM. Rely on the honor system plus basic verification. Making paying customers feel trusted is worth more than making non-paying users pay.

#### 9.5.3 Account System (Required for Supporter's Edition)
Cloud save requires accounts. Recommended: email + magic link (send a login link, no passwords to manage).

**Options:**
- **Supabase Auth.** Generous free tier, includes database and auth in one platform.
- **Clerk.** Polished DX, free tier suitable for small projects.
- **Auth0.** Enterprise-grade, free tier is limited.
- **Roll your own with Vercel + a magic link library.** Cheapest but most work.

**Recommendation:** Supabase for combined auth + storage. Free tier easily supports thousands of accounts.

#### 9.5.4 Cloud Save Storage
Save size is small (compressed JSON, typically under 100KB per save). Storage costs are trivial at hobby scale.

**Options:**
- **Supabase Postgres.** Free tier includes 500MB. Sufficient for tens of thousands of saves.
- **Vercel KV** (Redis). Fast reads. Free tier is small but adequate for early scale.
- **Cloudflare KV.** Generous free tier, slightly slower reads. Fine for save data.

**Recommendation:** Supabase Postgres if using Supabase Auth (single platform is simpler). Otherwise Cloudflare KV.

#### 9.5.5 Legal Requirements
Once money changes hands:

- **Terms of Service.** Template-based is fine. Cover refunds, acceptable use, developer liability limits.
- **Privacy Policy.** Required by law in most jurisdictions. Must be accurate about what data you collect (auth email, save data, transaction data).
- **Refund Policy.** 14-day EU consumer protection minimum. State clearly.
- **Cookie / consent banner.** Only required if you use tracking cookies. Vercel Analytics + magic-link auth do not require this.
- **Tax registration.** Depends on jurisdiction and volume. Paddle handles this if used; otherwise you handle it yourself once revenue thresholds are crossed.

Not glamorous but not skippable. Budget half a day to set up templates when the time comes.

### 9.6 Timing / Sequencing

Monetization is a v1.5+ concern, not a v1 concern.

- **v1.0 (initial launch):** Free game only. Optional donation link. No accounts, no cloud save, no purchases. Focus is proving the game is fun and finding an audience.
- **v1.1-v1.5 (post-launch, if game has traction):** Add account system, cloud save, Supporter's Edition purchase. This is when the paid tier actually gets built.
- **v1.5+ (established audience):** Consider palette packs. First pack could be included with Supporter's Edition as launch content.
- **v2.0+ (mature project):** Consider expansion content if audience remains engaged and there is capacity to develop more.
- **Never:** treat monetization as a v1 launch blocker. If the game is not fun for free, it will not be fun for paying customers.

### 9.7 Architectural Preparation for Monetization

Even though monetization is deferred, some technical decisions made now enable it later without refactor pain. These are cheap in v1 and painful to retrofit later.

- **Theme / palette abstraction in CSS from day one.** All colors defined as CSS custom properties. Even if only one palette ships in v1, the abstraction lets palette packs be added later without touching component code. Referenced in design doc Section 9.6.2.
- **Save format has a nullable `user_id` field from v1.** Populated later when accounts exist. Migration from anonymous local save to authenticated cloud save becomes trivial rather than a schema rewrite.
- **Feature flags in code from day one.** `if (features.cloudSave) { ... }`. Even if all flags are false in v1, the structural pattern is in place for later flipping.
- **Auth-touching code isolated behind an interface.** In v1, the "auth service" always returns "no user." Later, swap the implementation to a real auth provider without touching consumers. Standard dependency injection pattern.
- **License / entitlement check hook.** A single `checkEntitlements()` function called on game load. In v1, always returns "free tier only." Later, this becomes the integration point for the license verification.

These five preparations cost almost nothing during v1 development. They save potentially weeks of refactoring when monetization goes live. Build them in from the start.

### 9.8 Distribution Channels

Where the game actually reaches players. Choice of channel affects monetization mechanics.

- **Direct via Vercel-hosted URL.** Complete control. No platform cut. Requires you to handle marketing, discovery, payment integration entirely. Best for the free version.
- **itch.io.** Indie-friendly. Default 10% revenue share (adjustable, including 0%). Built-in comments/community. Good discovery for hobby games. Fine for both free and paid distribution.
- **Steam.** 30% revenue cut. High barrier to entry ($100 fee). Massive potential audience. Not appropriate until the game is polished and marketable.
- **Newgrounds, Kongregate, similar portals.** Legacy audiences, mostly not worth the effort in current market.

**Recommendation:** Vercel-hosted free version as the canonical home. Mirror on itch.io for discoverability. Consider Steam only if the game grows significantly beyond hobby audience.

---

## 10. Change Log

*Every meaningful revision to this document should be logged here with a date and one-line description.*

- **[Initial creation date]**: Document created. Captures foundational decisions extracted from design doc audit.

---

*End of technical specification.*
