# Hyperion Legacy (working title: Fleet Admiral) - Master Design Document

*Comprehensive design skeleton consolidated from the full design conversation. Replaces the earlier version. Treat this as a living document; everything in it is subject to revision as the prototype reveals what actually works.*

---

## Table of Contents

1. Elevator Pitch
2. Core Concept
3. Four-Layer Architecture
4. Committed Systems (in the game)
5. Open Design Work (still needs answers)
6. Design Principles
7. Considered and Rejected (with reasoning)
8. Parking Lot (salvageable ideas)
9. Tech Notes
10. Next Steps
11. Glossary

---

## 1. Elevator Pitch

A browser-based incremental idle game where the player is a fleet admiral. Captains (the parallel "characters" in the Idleon sense) each command a ship, manage a crew, and can be dispatched on missions. The game is structured as a campaign of sectors, each culminating in a fleet-scale boss encounter that the player must build their fleet to defeat. Between battles, the player runs an incremental economy of mining, processing, research, and crew development. The campaign has an actual end.

One-line differentiator: *"Like Idleon, but you're fighting a war sector by sector, with no predatory monetization, and the game has an ending."*

---

## 2. Core Concept

### The Player Role
The player is the **fleet admiral**. Strategic, not tactical. The player does not personally pilot ships or mine asteroids. The player decides which captains do what, allocates fleet-wide resources, manages research priorities, and chooses how to deploy the fleet across the campaign.

### The Hierarchy of Actors
Four layers, each with a clear role. No layer is passive. No layer is redundant.

1. **Player (fleet admiral).** Strategic. Allocates captains, sets priorities, makes campaign-level decisions.
2. **Captains.** The parallel "characters" of the game. Each one has identity, traits, specializations, and a ship they command. The unit of player attention. Dispatchable to missions.
3. **Ships.** The platforms captains command. Each ship has modules, crew slots, and capacity limits. Upgradeable, eventually swappable, specializable.
4. **Crew.** The workforce of each ship. Operate modules, perform tasks, gain skills. Crew labor is what makes the ship actually produce, fight, or research.

### The Campaign Spine
The game is structured as a **campaign of sectors**. Each sector is a region with its own resources, mission content, and threats. Each sector culminates in a **fleet-scale boss encounter** that requires the player's fleet to be prepared (composition, ship upgrades, crew development, augments). Clearing a sector unlocks the next one.

The campaign has an actual ending. The game is finishable. Estimated target playtime: 40 to 60 hours to first completion, with NG+ possible.

### The Engine
Underneath the captain/ship/crew framing is a standard incremental generator stack. Things produce things. Things compound. Numbers scale exponentially. This is non-negotiable; it is what makes the genre work. Familiarity in the engine, distinctiveness in the layers above it. The stack is not monolithic; it is distributed across captains, ships, and research tracks, producing many parallel small stacks rather than one giant one (similar to Melvor, Idleon, NGU).

---

## 3. Four-Layer Architecture (Time Scales)

The game runs at four interlocking time scales. Each layer feeds the next.

### 3.1 Tick Layer (seconds)
Passive gathering and production. Ships gather resources, crew operate modules, research progresses. This runs continuously including offline. Cadence: continuous, with visible updates every few seconds.

### 3.2 Mission Layer (minutes)
Active opt-in dispatches. The player sends a captain (and their ship) on a timed mission with risk/reward. Missions return spoils unavailable from passive play. This is where active engagement lives. Cadence: 5 to 30 minutes per mission.

### 3.3 Sector Progression (hours)
The medium-term loop. Build up the fleet within a sector. Develop captains. Research. Accumulate resources. Hit the readiness threshold. Boss encounter. Advance. Cadence: 1 to 5 hours per sector in the early game, longer later.

### 3.4 Campaign Arc (the long game)
The full game arc. From starter sector to campaign conclusion. The reason all the other layers exist. Cadence: 40 to 60 hours total.

---

## 4. Committed Systems

These are decisions that are locked in. Everything here should appear in the game.

### 4.1 Generator Stack Engine
The core mechanical loop. Familiar incremental pattern: lower-tier producers produce higher-tier outputs, exponential cost scaling, prestige resets unlock permanent advancement. Distributed across captains, ships, and research rather than a single monolithic stack.

### 4.2 Captains as Parallel Characters
- Captains are named, persistent characters with identity (traits, specializations, augment builds).
- Each captain commands one ship at a time.
- Captains can be reassigned between ships as the fleet grows.
- New captains are recruited or earned through campaign progression.
- The captain roster is the primary unit of player attention.

### 4.3 Ships as Platforms
- Ships provide capacity, slots, and passive systems (cargo, crew slots, module slots, hull, basic life support).
- Ships do not act on their own. Crew operate ships. Ships are platforms.
- Ships are upgradeable (modules) and eventually swappable for larger or specialized vessels.
- Different ships specialize in different roles (mining, science, combat, exploration).

### 4.4 Crew
- Crew slots are determined by ship size.
- Crew specialize into roles (mining, engineering, science, gunnery, piloting, medical, etc.).
- Crew gain skills over time through performing their roles.
- Crew are augmentable (cybernetics) for capability boosts.
- Crew identity is lighter than captain identity. They are specialists, not full RPG characters.

### 4.5 Resource Economy
Three resource tiers plus an energy substrate:

**Common matter.** Stone, common metals, basic minerals. Auto-stockpiled freely at base. No cargo footprint.

**Rare matter.** Rare alloys, exotic minerals. Cargo-bound. Required for advanced crafting.

**Energy.** Derived currency, manufactured by converting matter. Storage is very large but finite (no literal infinity; preserve the lever for late-game upgrades). Uses: ship system upkeep, research funding, synthesis, crafting feedstock.

**Relics.** Unique salvage finds. Cannot be synthesized. Cannot be researched into existence. The true scarcity tier. Each one ideally has a unique effect (blueprint, captain trait unlock, ship part, lore fragment). Natural home for narrative content.

### 4.6 The Cargo Overflow Rule (Keystone Mechanic)
Cargo holds rare materials only. Common materials stockpile freely at base. **When cargo fills, newly gathered rare materials auto-deconstruct to energy** rather than being lost.

This single rule does heavy structural work:
- Solves the overnight idle problem (nothing is ever wasted).
- Punishes long idle softly (you keep energy, you lose the materials themselves).
- Keeps cargo upgrades meaningful (bigger cargo means more rare materials preserved as materials).
- Creates emergent late-game strategy (deliberately farm overflow when energy is the bottleneck).

### 4.7 Synthesis
Energy can manufacture materials at a cost. Slower than finding them naturally but always available. Functions as a fallback path so bad luck never hard-stalls progression. Synthesis cost is the designer's primary scarcity dial.

### 4.8 Research
Energy-powered research (themed as a futuristic hadron collider or similar). **Discovers new materials that did not previously exist.** Discoveries unlock new crafting recipes and feed into synthesis. Research paths can be specialized, biasing toward particular material families. Allows for RNG-driven excitement without the RNG feeling cheap because the inputs (energy) are player-accumulated.

This is also a real differentiator. Most incrementals have fixed content trees. Research-generated content means no two players have exactly the same late game.

### 4.9 Missions
Active opt-in content. Captains and their ships dispatched on timed missions with risk/reward profiles. Mission types include exploration, salvage, mining, trade routes, intercept/raid, and others.

- Different mission types favor different ship configs and crew compositions.
- Same underlying tick math across types; flavor and rewards differ.
- Combat-style missions treat enemy defeats as resource gathering (drops loot), not as real-time action minigames.
- Mission duration is bounded by something meaningful (resource consumption, mission objective completion), not arbitrary timers.

The raider / trader / resourcer fantasy lives here, through build-driven mission selection. Same game, different builds excel at different mission types.

### 4.10 Augments / Cybernetics
The active character progression layer. Applied primarily to captains (and secondarily to crew). Originally considered as the primary prestige system but reclassified as a skill-tree-style progression layer.

- Augments form a tree per captain (and possibly per crew member).
- Fed by mission spoils and rare currency.
- Augments unlock **capabilities**, not just stat boosts. (See Design Principles section.)
- Augments enable new ship-level behaviors, sector access, and mission types.

### 4.11 Two-Tier Prestige System

**Tier 1: Captain Augmentation Resets.** When a captain hits their current capability ceiling, the player can perform a "tier 1 prestige" that resets their progression but raises their cap, unlocks new augment options, or enables new specializations. Cadence: hours.

**Tier 2: Ship Promotion / Fleet Expansion.** When a captain has outgrown their ship, the player retires the ship under their command (it continues to run autonomously at reduced efficiency as part of the standing fleet) and the captain receives a new, larger or more specialized vessel. Over time the fleet grows organically from the player's own retired vessels. Cadence: long arc (real hours to days of play).

### 4.12 Campaign Structure
- Sectors are unlocked sequentially (with possible optional side sectors).
- Each sector has its own resources, mission content, and threats.
- Each sector culminates in a boss encounter requiring fleet readiness.
- Defeating the boss unlocks the next sector.
- The final sector has a campaign-ending boss / event.

### 4.13 Hostile Encounters / Pirates
Pirates and hostile NPCs treated as either:
- Content gates (cannot enter Sector X without Y defense rating), or
- Avoidable obstacles when the player has prepared.

Not implemented as a passive tax on idle gains. Threats matter as decisions, or they should not exist.

### 4.14 Achievements

Achievements are a first-class system, not a bolt-on. This game is being built to serve completionist and collector players; the achievement system must be numerous, varied, and integrated with meaningful rewards from day one.

**Scale target.** 300 to 600 total achievements across the lifetime of the campaign, mixing:
- 100 to 200 handcrafted meaningful achievements with specific triggers and rewards.
- 200 to 400 tiered auto-generated achievements (Bronze/Silver/Gold on quantity-based accomplishments like "gather X of Y material").

**Categories.** Achievements are grouped for browsing and completion tracking:
- **Progression** — reaching milestones (fleet size, sector count, prestige tiers, boss defeats).
- **Discovery** — finding materials, relics, captain types, ship classes, hidden sectors.
- **Mastery** — completing content under specific conditions (no losses, low fleet size, time limits, specific compositions).
- **Completion** — full clears of specific content types (all missions in a sector, all research paths in a family).
- **Curiosity** — trying unusual strategies (deploying only exploration captains, using specific rare modules, unconventional builds).
- **Persistence** — accumulated activity (total playtime, total missions, total resources gathered).
- **Meta** — achievements about achievements (earn 25 in a category, earn 100 total, complete all categories).
- **Hidden** — secrets the player discovers by playing. Invisible in the list until earned, but their existence (as unnamed slots) is visible.

**Reward types.** Mixed intentionally to prevent any single approach from dominating:
- **Small additive bonuses** (0.1% to 1% each; cumulative but hard-capped globally per bonus type to prevent runaway compounding).
- **Content unlocks** (new captain traits, ship class blueprints, palette variants, portrait options, mission types).
- **Milestone rewards** at every 25th achievement in a category and every 100th overall (larger unlocks, meta-cosmetics, ships named in-lore after the player).
- **No reward at all** for a meaningful percentage (satisfies pride without diluting mechanical rewards). Some achievements exist purely as "I did that."

**Retroactive tracking.** When new achievements are added in updates, existing saves get credit for anything they have already accomplished. Requires save state to be examinable against new achievement conditions on load. See technical spec for implementation details.

**Visibility rules.**
- Standard achievements: name, description, progress, and condition all visible before earning.
- Hidden achievements: name displays as "???" and description is hidden until earned. Existence of the hidden slot is visible so players know they exist and can chase them.

**Unlock feedback.** Earning an achievement is a legible moment. Notification appears with achievement name, category, and reward. Optional sound. Entry in a recent-earnings log. Never dismiss unlock events silently. This is one of the small moments idle games need to feel satisfying.

### 4.15 Collectables & Compendium

The game already has multiple collectable systems: relics, discovered materials, research unlocks, captain types encountered, ship blueprints. The **Compendium** unifies these into a single completion-focused view. This is the completionist's home screen.

**The Compendium view.** A dedicated UI showing all collectable categories with progress at a glance:
- Relics: X of Y discovered
- Materials: X of Y discovered
- Ship Classes: X of Y unlocked or commanded
- Captain Types: X of Y encountered
- Codex Entries: X of Y unlocked
- Achievement Categories: X of Y with 100% completion
- Sectors: X of Y cleared
- Bosses Defeated: X of Y

Each category browsable in detail. Each entry has lore text, discovery timestamp, and relevant mechanical details.

**Collectable categories:**

- **Relics.** Unique items found through salvage. Each has a unique mechanical effect and lore fragment. See 4.5.
- **Materials.** Every discovered material family gets an entry. Includes starter materials and research-discovered ones. See 4.8.
- **Ship Classes.** Every ship hull the player has commanded or blueprint they have unlocked. Populated as ships are built or blueprints acquired.
- **Captain Types.** Every specialization / trait combination the player has recruited. Populated as captains are recruited.
- **Codex Entries.** Discovered lore about the world, enemies, factions, phenomena. Populated by research, discovery, and campaign events. Absorbs the earlier concept of a lore compendium (previously parking lot item 8.F.1, now promoted).
- **Boss Encounters.** Each boss faced. Includes statistics: fleet composition used, time taken, ships lost, first-clear date. Bosses can be revisited via NG+ or specific mission types for additional completion tracking (fastest clear, no-loss clear, etc.).

**Retroactive population.** Same rule as achievements: when the Compendium expands in updates, existing saves get credit for anything already earned.

**Compendium as a hub.** The Compendium is not just a passive display. From any entry, the player can navigate to related content: "Where did I find this relic" jumps to the sector view; "Which captain has this trait" opens the captain roster filtered to that trait. The Compendium is the connective tissue for the game's late-game content.

**No mechanical bonuses from the Compendium itself.** Individual collectables can have mechanical effects (relics grant abilities, materials enable crafting), but the Compendium view itself is pure information architecture. Completing sections does not grant global bonuses; those come from the achievement system, which is a separate layer. This separation keeps the two systems clean.

---

## 5. Open Design Work

These are the remaining structural questions that need to be answered before or during prototyping. They are real gaps, not just polish issues.

### 5.1 Boss Encounter Mechanics (HIGHEST PRIORITY)
The campaign spine depends on these. Questions:
- Real-time tactical or auto-resolved on fleet stats?
- Player decisions during the fight, or only before?
- Outcome deterministic given preparation, or variance involved?
- Battle duration: 30 seconds, 5 minutes, 20 minutes?
- Can you lose? What happens if you do (retry, setback, permanent consequence)?

**Recommended starting point:** Auto-resolved based on fleet composition and stats, with pre-battle setup decisions that matter (formation, ship assignments, tactical doctrine, captain selection), and a short visual playout of 30 seconds to a few minutes. Reference patterns: Crusaders of the Lost Idols (formation-based), Loop Hero (prep is everything, fight is the consequence).

### 5.2 Campaign Scope
- How many sectors total?
- Linear, branching, or open?
- Optional side sectors?
- New Game Plus structure?

**Recommended for hobby project:** Linear with optional side sectors. Easier to design, easier to pace, easier to finish. 8 to 12 main sectors as a working target.

### 5.3 Enemy Identity / Faction
The player is fighting *something*. Even one sentence of identity is enough to anchor the design. Placeholders are fine. Candidates:
- Hostile alien species
- Rogue AI fleets
- Pirate confederations
- Eldritch interlopers
- Precursor remnants reactivating
- A rival fleet of the same species
- Combination (sector 1 is pirates, sector 4 is aliens, etc.)

### 5.4 Captain Progression Definition
If captains are the parallel actors, they need progression that's *theirs*, distinct from their ship's.
- Skills tree per captain
- Traits (innate, possibly randomized at recruit)
- Specializations (warfare, science, exploration, logistics, etc.)
- Possibly a light personality system
- Augment slots and progression
- Visible identity (name, portrait, history)

### 5.5 Driving Force / "Why" (REQUIRES A DECISION)
The game needs a one-sentence answer to "why is the player doing any of this." Candidates from the conversation:

1. **Frontier expansion** — humanity colonizes a fraction of space; the fleet pushes the boundary outward.
2. **The long search** — Earth is lost; searching the galaxy for habitable worlds, survivors, or a specific something.
3. **The slow gathering threat** — something is coming; the fleet is being built for the moment of confrontation.
4. **Reconstruction** — civilization collapsed; rebuilding the network of human presence in space.
5. **The trail of someone** — following a trail (precursor civilization, missing fleet, person); each sector reveals more of the story.
6. **Pure ascension** — started as a working captain, will die a fleet admiral; the arc itself is the point.

**Leaning recommendation:** somewhere between #2 (the long search) and #3 (the gathering threat). Both give the game a destination, justify parallel progression mechanically, create natural endpoints, and let research-generated content carry real narrative weight.

### 5.6 Material Family Taxonomy
Materials should group into families (not be tracked individually). How many families, named how, with what properties. Open.

### 5.7 Specific UI Shape
Open. The interface needs to display captains, ships, crew, missions, research, and the campaign map. The shape of all of this is undesigned.

### 5.8 Energy Storage Tech Naming
"Zero-point" is cliche. Pick a name with internal consistency. Defer to late in design.

### 5.9 Prestige Visibility Mechanics
The three components of prestige feel (visible completion, visible diminishing returns, visible next thing) need specific UI/mechanic implementations. See Design Principles section.

---

## 6. Design Principles (Hold the Line)

These are the meta-rules that emerged from the design process. Defend against future feature creep by checking new ideas against this list.

### 6.1 One Core Loop, Playstyle Modifiers on Top
Do not build three games. Trader / raider / resourcer fantasies live in build and mission choices, not separate gameplay modes.

### 6.2 Active Play Rewards Better, Passive Still Progresses
Both playstyles are valid. Active is faster. Pure idle never reaches the absolute maximum efficiency, but also never feels punished.

### 6.3 Avoid "Infinite" Anything as a Baseline
Use very large but finite. The cap is what makes future upgrades meaningful. "I will just make this one thing infinite" is the decision that flattens late-game progression six months later.

### 6.4 Material Families, Not Individual Material Accounting
Inventory clarity matters more than realism. Players should glance and understand.

### 6.5 Old Tiers Stay Relevant or Auto-Convert Cleanly
No vestigial inventory clog. Either low tiers remain useful for something, or they auto-deconvert into the current tier's substrate.

### 6.6 Numbers Should Be Readable at a Glance
No spreadsheet-required optimization unless deliberately courting that audience.

### 6.7 Augments Unlock Capabilities, Not Just Stat Boosts
A "+15% production speed" augment is mechanically dead. A "Pressure Tolerance: enables operation in deep-mantle and high-gravity sectors" augment opens content. Lean hard on capability gates rather than numerical boosts. Stat boosts are fine in moderation but capability unlocks are what make prestige feel meaningful.

### 6.8 Walls Are Only Motivating If the Player Can See Them
Three components must be simultaneously visible at the prestige moment:
- **Visible completion** (caps reached, sectors exhausted, slots maxed).
- **Visible diminishing returns** (upgrade costs visibly absurd, production rates flatlining).
- **Visible next thing** (locked content with clear unlock requirements).

If any of the three is missing, the wall feels like boredom rather than challenge.

### 6.9 Familiar Engine, Distinctive Layers
The generator stack is familiar. That is correct. Differentiation lives in the layers above the engine and in how those layers tie back into the engine. Do not try to make the stack itself unique.

### 6.10 Frame vs Engine
Every design decision should ask: does this serve the *frame* (admiral, fleet, campaign, the war) or just the *engine* (numbers, optimization)? Decisions that serve both are great. Decisions that only serve the engine are okay if load-bearing. Decisions that break the frame should be rejected even if mechanically efficient.

Example: "+10% production speed" upgrade serves engine only. "Train your engineers in advanced fabrication techniques (+10% production speed)" serves both. Trivial implementation difference. Huge difference over thousands of upgrade purchases.

### 6.11 The Game Has an Ending
This is a real design constraint, not a vague preference. It means:
- No infinite scaling currencies.
- No prestige layers added forever (two tiers, then the game ends).
- No "post-game" busywork. When the story ends, the game ends, with optional NG+.

### 6.12 No Predatory Monetization
This is a hobby project so monetization is not currently in scope. If it ever is, no F2P walls, no gacha, no premium currency that gates content, no time-skips for cash. The Idleon-style structure can be built without the Idleon-style business model.

---

## 7. Considered and Rejected (with reasoning)

Captured so these don't re-litigate themselves later.

### 7.1 PHP + MySQL as the Tech Stack
Rejected. Not because PHP is bad (it has matured significantly), but because for an idle game with no immediate backend needs, frontend-heavy TypeScript with localStorage is closer to the metal. Reconsider if a real backend becomes necessary.

### 7.2 Real-Time Multiplayer
Rejected for v1. Would change the entire architecture (Node + WebSockets or Elixir/Phoenix). Hobby scope cannot support it. Possibly revisit if the game ever gets a v2 with cooperative or competitive multiplayer.

### 7.3 Three Separate Gameplay Loops (Resourcer / Trader / Raider as Classes)
Rejected. Too much design surface for a one-person project. Replaced with one core loop and build-driven specialization through missions.

### 7.4 Cargo Cap as a Hard Mission Timer
Rejected. Broke overnight idle (a core appeal of the genre). Replaced with the overflow-to-energy rule.

### 7.5 Fuel-as-Jump-Cost for Sector Progression
Rejected. Created the wrong kind of wall. Players solve fuel walls with patience, not capability. Time gates punish engagement without creating decisions. Replaced with capability-based sector gates (Pressure Tolerance, Radiation Shielding, etc.).

### 7.6 Soft Caps with Overflow Penalty (cargo full = 20% rate)
Rejected. Soft caps frustrate idle players. The "losing partial rewards" feeling is psychologically worse than a hard cap. Players feel like the game is taking from them.

### 7.7 Matter Reclamation as Default Mechanic
Rejected. Would have deleted the cargo system rather than augmenting it. Reserved as a possible mid-game module or build branch (see Parking Lot).

### 7.8 Cybernetics as Primary Prestige Reset
Rejected. Wrong cadence (too granular for a reset event). Moved to skill-tree role. Ship promotion is the primary prestige now, augment investment is the active progression layer.

### 7.9 Universal Infinite Storage
Rejected. Removes design levers needed for late-game progression. Use very large but finite.

### 7.10 Player as Direct Captain (Direction 1: Collapse the Abstraction)
Rejected. Conflicted with the fleet-commander progression. If the player is personally piloting in tier 1, promoting them to fleet admiral in tier 2 is a demotion from the protagonist role. Replaced with the captains-as-characters model where the player is always the admiral.

### 7.11 Hands-On Captain with Personal Action (Direction 2)
Rejected for the same reason as 7.10. Broke the second prestige tier.

### 7.12 RPG-Style Crew Identity / Attachment
Partially rejected. Captains have light identity (traits, names, specializations). Crew do not have full RPG-character treatment. Players in incrementals form attachment to systems they have grown, not to characters per se. The captain layer carries the identity weight; the crew layer is specialization without deep characterization.

### 7.13 "Zero-Point Module" Naming
Rejected. Cliched. Defer naming, then pick something with internal consistency that does not echo Stargate / Half-Life / etc.

### 7.14 Endless Game / No Ending
Rejected. The game has an ending. NG+ is acceptable, infinite scaling is not.

---

## 8. Parking Lot & Candidate Additions

*Ideas not currently in the committed list. Organized into priority groups so you can pick and choose what to integrate and when. Nothing here is committed. Promote items into Section 4 (Committed Systems) when you decide they belong.*

---

### 8.A Priority Candidates (Recommended for Next Design Pass)

These four are structurally load-bearing. Each addresses a specific gap or risk in the current design. Strong candidates for promotion to committed after evaluation.

#### 8.A.1 Fleet Composition at Boss Encounters
The current design has ships and captains but no strong concept of *fleet shape*. Boss encounters become more interesting if composition matters, not just total power. At boss time, the player selects a subset of ships and captains, arranges them in formation or role assignments, and different bosses favor different compositions. A boss weak to sustained fire favors artillery ships. A boss with high burst damage needs tanks in front. A boss summoning swarms needs point-defense platforms.

This makes the fleet meaningfully different from "more ships equals win." Ship promotion (tier 2 prestige) becomes more interesting because retired ships become tactical pieces, not just increments. Reference patterns: X-COM squad composition, FTL crew management.

Keep minimal for v1: perhaps 3 to 5 ship roles, 3 to 5 formation slots. Expand if it feels good in play.

#### 8.A.2 Sector Modifiers / Environmental Hazards
Each sector gets one or two *environmental modifiers* that shape play within it beyond just different resources. Radiation belt (crew take damage over time, forcing rotation). Gravitational anomalies (missions take longer). Ancient signal interference (research impaired, missions have less info). Rich mineral density (mining faster but attracts pirates). Nebula (defense buffs against ranged but hides threats). Ionization storms (energy systems degrade).

Solves the "every sector is the same with different numbers" risk. Gives each sector a *feel*. Interacts naturally with capability gates (specific modifiers require specific augments or ship modules). Broadens and formalizes earlier parking-lot idea 8.D.11.

Design 8 to 10 total modifiers, mix across sectors so combinations produce variety with less individual design work.

#### 8.A.3 Emergency Events / Opportunity Windows
Randomly-timed events that appear only if the player is actively watching. Distress signal (90 second window). Rare asteroid in a passing orbit (3 minutes). Pirate convoy briefly vulnerable to interception. Anomalous energy reading. Present players who respond within the window get meaningful rewards (captain trait unlock, rare drop, research boost, relic). Absent players lose nothing they were entitled to.

This is *the* mechanic that keeps active players engaged in incrementals. Real reward for presence without punishing absence. Cookie Clicker's golden cookies are the canonical version; every successful incremental with active retention has some version. Probably the highest-value single addition on this whole list.

Critical constraint: no penalty for missing. Pure upside only.

#### 8.A.4 Manual Scanning / Prospecting
While the player is present, they can manually run scanning operations that reveal high-yield resource nodes, hidden anomalies, or unexplored sub-sectors. Passive scanning happens too, but slower. The player who checks in and spends five minutes actively scanning finds three good nodes; the pure idler finds one over the same period through passive scanning.

Fits the game specifically because checking in becomes meaningful without busywork. Scanning is *interesting* active engagement because each scan produces new information, not just a number tick. Ties into your existing sector systems.

---

### 8.B Additional Structural Candidates

Ideas that reinforce existing systems rather than adding new pillars. Lower priority than 8.A but worth considering. Each addresses a specific texture the current design could use more of.

#### 8.B.1 Captain Relationship / Synergy Layer
Captains who serve together across missions or in the same fleet develop *relationships* (rivalry, mentorship, trust, friction) that affect performance. A captain who mentored a younger one gives them a bonus when they serve on the same mission. Rivals get a small buff when directly competing but suffer when forced to cooperate. Adds emergent narrative without requiring written narrative; players generate their own stories through play. Expands earlier parking-lot idea 8.D.6.

Small version first: three or four relationship states, minor mechanical effect. Grow if it earns expansion.

#### 8.B.2 Passive Fleet Activities Between Bosses
Retired ships assigned to standing orders that produce meaningful outputs. Patrol duty reduces pirate incidents. Trade routes generate slow income of a specific rare resource. Long-range scouting reveals information about upcoming sectors. Fleet becomes a *network of operations*, not just a roster. Gives ship promotion (tier 2 prestige) immediate payoff.

Low-attention (set an order, forget it, adjust occasionally). Right cognitive weight for a between-sessions layer.

#### 8.B.3 Research Paths That Unlock Ship or Captain Classes
Research doesn't just unlock materials; some paths unlock new ship hulls or new captain specializations. "Unlock the Corvette hull, enabling high-speed intercept missions." "Unlock the Xenolinguist specialization, enabling communication with certain factions." Turns research into a content-unlock system. Creates genuine build divergence between players.

#### 8.B.4 First Captain Legacy Arc
The starting captain gets a specific role in the game's spine. Eventually becomes the fleet's flagship captain, or retires to become an advisor NPC, or is lost in a mid-game event motivating a later sector. Provides emotional throughline without requiring a full narrative system. One captain, one arc, one payoff. Don't try to make every captain narratively significant.

#### 8.B.5 Hall of Records / Fleet History Log
Passive system, low implementation cost, big cumulative payoff. Log significant events: which captain led which boss victory, which ships were lost, which sectors were cleared and when, biggest resource haul, longest mission, first discovery of each material family. Browsable "annals of the fleet" screen.

Players in long games form attachment to their own history. A log makes that history visible. Creates screenshotable moments (how word-of-mouth for niche incrementals spreads). One of the highest ROI additions for effort spent.

#### 8.B.6 Cosmetic Distinctions from Accomplishments
Earned visual markers: a ship that survived a specific boss encounter gets a scarred hull texture. A captain who reached max augment tier gets a distinct portrait treatment. A cleared campaign yields a flagship pennant. Purely visual, no mechanical effect. The "trophy shelf" instinct that drives long engagement.

For hobby art budget: text tags rather than art variations. "Veteran of Sector 4." "Discovered Halcyon Crystal." Same effect, no art cost.

#### 8.B.7 Difficulty Rating Predictions
Every mission shows estimated difficulty based on current fleet capabilities. Green / Yellow / Red. Same for bosses: predicted fleet outcome based on preparedness. Removes guesswork. Rewards preparation by making it legible. Lets players deliberately punch above their weight if they want to gamble, without flying blind.

---

### 8.C Additional Active Engagement Options

Beyond the priority items in 8.A. Additional patterns for keeping engaged players busy during long-push phases. Bounded by rate limits or optional-only structure. All follow the "no penalty for missing" principle.

#### 8.C.1 Manual Mining / Rate-Limited Active Extraction
Manual laser operation that produces resources faster than passive extraction, bounded by a heat/cooldown mechanic. Overheats after 30 seconds, needs a minute to cool. Active play produces maybe 20 percent extra during check-ins; cannot sustain indefinitely. Genre-standard pattern (Cookie Clicker's big cookie, Universal Paperclips' initial clicking).

#### 8.C.2 Optional Mission Piloting Minigame
Missions auto-resolve by default. Optional active piloting yields 25 to 50 percent more spoils. Lightweight minigame (hazard navigation, targeting, dodging), two to five minutes. Never required. Reference: Melvor's combat, Idleon's station minigames.

#### 8.C.3 Research Puzzle Minigame
Optional puzzle layer within research. Chemistry-alignment puzzle or spatial arrangement puzzle. Success biases research outcomes toward better materials or shorter completion. Failure falls back to standard results. Fits research fiction (intellectual work) without requiring engagement.

#### 8.C.4 Captain Training Sessions
Between missions, captains gain skills passively at a slow rate. Optional active training session for a specific captain: two to five minute focused activity giving a meaningful skill boost. Short tactical scenario or resource management puzzle. Creates a reason to interact with individual captains during downtime.

#### 8.C.5 Prep-Phase Challenge Missions
Optional missions between boss encounters with escalating difficulty scaled to fleet power. Beat a piracy stronghold. Survive a five-wave defensive scenario. Unique rewards: captain trait rerolls, unique augments, cosmetic distinctions, relic guarantees. Productive use of engaged time during preparation phases. Natural difficulty ramp letting players self-select their engagement level.

#### 8.C.6 Fleet Strategic Planning / Route Optimization
Meta-layer minigame during downtime. Plan fleet deployment patterns on a map. Draw routes between sectors, allocate ships to patrol paths, optimize logistics. Plan runs autonomously afterward, generating small persistent bonuses. Fits the fleet-admiral frame perfectly. Real design complexity; likely a v2 concern.

---

### 8.D Original Parking Lot Items

Earlier ideas retained for reference. Some remain viable; some have been superseded or absorbed by items above. Cross-references noted where relevant.

#### 8.D.1 Matter Reclamation as a Mid-Game Module
Originally considered as a default mechanic and rejected. Could return as an unlockable mid-to-late game module that converts cargo to energy at a meaningful efficiency, available as a build choice that trades cargo flexibility for energy throughput. Specific build branch, not universal.

#### 8.D.2 Resource Degradation / Node Exhaustion
The idea that starter-sector nodes deplete over time, making the early game eventually unproductive regardless of grind. Was considered as a forcing function for prestige. Rejected as the primary mechanism (felt punitive) but could appear as a specific node type in late-game sectors where "depleted" gameplay creates a different rhythm.

#### 8.D.3 Captain Traits / Personality System
A captain could have innate traits (Ambitious, Cautious, Lucky, Veteran, Reckless, etc.) randomly assigned at recruitment. Traits could affect mission outcomes, ship preferences, augment compatibility. Would add roguelike-ish replayability and meaningful character-tier decisions without requiring full RPG depth. Related to but distinct from 8.B.1 Relationships. Defer until core loop is proven.

#### 8.D.4 Synthesis Probability Tuning Per Captain
A captain's research specialization could affect synthesis outcomes (rates, probabilities, byproducts). Ties captain identity to a system that affects the whole fleet.

#### 8.D.5 Mid-Mission Decisions / Light Interactive Events
Missions could have occasional decision points (intercept a distress signal? push deeper or return? engage the pirate convoy?) that add active engagement without becoming an action game. Partially overlaps with 8.A.3 Emergency Events but focused on within-mission choices rather than world-level events.

#### 8.D.6 Cross-Captain Synergies
Superseded and expanded by 8.B.1 Captain Relationship / Synergy Layer.

#### 8.D.7 Captain Death / Mortality
Captains could be lost in missions (very rarely, or only in specific high-risk scenarios). Adds emotional weight to captain investment. Could be controversial; some players hate permadeath in idle games. Consider as an optional mode rather than default.

#### 8.D.8 NG+ Mode
Post-completion replay with carried-over advantages and harder content. Standard for finishable games. Defer until v1 ships.

#### 8.D.9 Lore Through Relics
Relics each carry a fragment of narrative. Collecting them assembles a deeper story over the campaign. Optional content for narratively-engaged players. Tie to the chosen driving force.

#### 8.D.10 Captain Recruitment Variety
Captains could be recruited in different ways: standard hire, rescued from a mission, defected from an enemy faction, found in a relic. Each gives a different starting trait or specialization. Adds flavor and motivates exploration.

#### 8.D.11 Sector-Specific Mechanics
Broadened and formalized as 8.A.2 Sector Modifiers. Retained here as reference to earlier framing.

#### 8.D.12 Faction System
If multiple enemy factions exist across the campaign, they could have distinct mechanics, weaknesses, and rewards. Could also include neutral or friendly factions for trade and quest content. Consider only if scope allows.

#### 8.D.13 Drone / Carrier Vessel Mechanic
Originally floated early in the conversation. Carrier ship with cargo holds and drones, where drones do the actual gathering while the carrier serves as platform. Could work as a specific late-game ship type rather than a core mechanic.

#### 8.D.14 Visual Battle Playout
For boss encounters: a watchable visualization of the battle even if outcome is deterministic. Adds payoff to long preparation. Reference Idle Wizard's spell animations or AdCap's cinematics. Polish phase item.

#### 8.D.15 Difficulty / Pacing Settings
Player-selectable game pace (chill, standard, hardcore) that affects prestige requirements and progression curves. Could broaden audience. Nail standard difficulty first.

---

### 8.E Operational Tracking (Short-Term Development Practices)

Not game features. Development-practice items to hold in mind from day one of coding, because they get much harder to retrofit later.

#### 8.E.1 Save Format Versioning
Put a version number in the save from the first commit. Write a migration function stub even if empty. Retrofitting versioning after saves exist in the wild is genuinely miserable.

#### 8.E.2 Offline Progression as Closed-Form Math
Any tick math with compounding, capacity caps, or state transitions needs to be expressible as a closed-form calculation, not just a loop. Test early with unit tests verifying "one big jump equals many small ticks."

#### 8.E.3 Debug / Cheat Panel from Day One
Build immediately after save/load. Grant resources, unlock content, skip time. Without this you'll only ever playtest the first hour. Retrofitting cheats onto a mature codebase is annoying.

#### 8.E.4 Single Number Formatting Function
Decide early how you display large numbers (47.28T, 4.728e13, 47.28 trillion, named tiers). Wrap in one function used everywhere. Never call `.toString()` on numbers for display. Switching later means updating every UI element.

#### 8.E.5 Playtest Action Logs
When playtesting, log every action with timestamps. Ten minutes of logs reveals more about game rhythm than an hour of reflection.

#### 8.E.6 External Playtester Lined Up Early
You cannot playtest your own incremental. Find one person who will play the prototype and tell you the truth. First playtest happens the moment there's a playable core loop, ugly UI and all.

#### 8.E.7 KNOWN_ISSUES.md and CUT_FOR_SCOPE.md
Explicit lists of shadow items. Prevents "wait, where was I?" friction after gaps. When features get deferred, write down why, so they don't get relitigated later.

#### 8.E.8 Two-Line Session Log
After each development session, write two sentences: what you worked on, what's next. Highest-value habit for hobby projects. Removes the biggest friction that kills projects during breaks.

#### 8.E.9 Genre Study List
Deliberate study of adjacent games with a designer's hat on. Suggested: Antimatter Dimensions (prestige layer design), Melvor Idle (parallel skills, idle/active balance), Universal Paperclips (tight narrative arc with incremental engine).

#### 8.E.10 Working Title vs Real Name
"Fleet Admiral" was the working title, not the game's real name. **Decided: the game is now named Hyperion Legacy.**

#### 8.E.11 Commitment Date for Prototype Start
Give yourself an explicit trigger: "I will start writing prototype code on [date] regardless of whether I feel ready." The design will keep expanding indefinitely otherwise. Design refinement past this point yields less than building would.

---

### 8.F Additional Content and Texture Ideas

Ideas that emerged from reviewing the design doc as a whole. These add texture, ownership, and completionist hooks without adding new mechanical pillars. Consider these last after core loop is proven.

#### 8.F.1 Codex / Discovered Lore Compendium
**PROMOTED to committed system 4.15 Collectables & Compendium.** Retained here for reference to the original framing. The Compendium now absorbs this concept as one of its collectable categories (Codex Entries) rather than existing as a standalone feature.

#### 8.F.2 Achievement System with Small Mechanical Rewards
**PROMOTED to committed system 4.14 Achievements.** Retained here for reference. The committed version is significantly expanded in scope (300 to 600 achievements, eight categories, mixed reward types).

#### 8.F.3 Player-Assignable Ship Names
Free identity. Costs almost nothing to implement, adds huge amounts of personal attachment. Ships you named yourself feel more yours than "Ship 03." When you retire the *SS Determination* to promote its captain to your fleet, that's memorable. Lets players lean into whatever tone they want (military, silly, thematic, personal). Default-name generator for players who don't want to name manually.

#### 8.F.4 Salvage Yard / Ship Decommissioning Alternative
When retiring a ship for tier-2 prestige, the current design promotes a captain to run it as fleet standing. Add an alternative path: dismantle the ship in the salvage yard for high-tier materials that fund the new ship's initial modules. Two viable paths for retired ships: patrol asset (existing design) or resource injection (new option). Adds strategic choice. Gives the player agency over which specific ships become fleet standing versus which fund future construction. Particularly valuable in the mid-game when the fleet is small and the player might not yet want every retired ship in permanent rotation.

#### 8.F.5 Boss Encounter Pre-Fight Simulator
Before committing to a boss fight, run a simulated encounter that shows likely outcome without consequences. Costs some energy per simulation, or requires a specific research unlock ("predictive combat models"). Removes the "did I bring the right fleet" anxiety without removing the challenge. Extends 8.B.7 Difficulty Predictions with a specific mechanic. Especially valuable in a game where boss preparation takes hours; blind-charging and losing feels much worse than losing a battle you knew was likely. Player can iterate on fleet composition against the simulator before committing.

#### 8.F.6 Retroactive Application of Late-Game Unlocks
When the player unlocks something significant (a new augment tier, a research breakthrough, a ship-wide upgrade), it applies retroactively to all existing ships and captains where relevant. Never "you must re-purchase this per ship." This is a QoL choice that dramatically improves late-game feel. Genre-standard among well-designed incrementals; commonly missed by hobby developers who then wonder why their late game feels grindy. Design your systems from the start with retroactivity in mind, because retrofitting it is annoying.

#### 8.F.7 Ship Logs / Voyage Records
Each ship keeps a lightweight log of major events during its service: bosses defeated, sectors cleared, notable discoveries, close calls, casualties averted. When retiring the ship, the player can browse its "career highlights." Adds emotional weight to promotion without requiring RPG-style characters or written narrative. Complements 8.B.5 Hall of Records at the individual-ship scope rather than the fleet-wide scope. Each ship becomes a small story the player generated by playing.

#### 8.F.8 Weekly Rotating Sector Events
Once per real-time week, a special event appears in one of the player's accessible sectors, offering unique rewards for that period. Rich Deposit Week (mining rates spiked). Pirate Uprising Week (combat missions yield extra spoils). Ancient Signal Week (research chance boosted). Salvage Cascade (rare drops elevated). Creates a low-key check-in incentive without daily-login guilt. Distinct from 8.A.3 Emergency Events in cadence and scale: those are minute-to-minute active-play rewards; this is a weekly rhythm layer. Absent players lose nothing they were entitled to.

#### 8.F.9 Late-Game Resource Sinks
Past a certain campaign progression point, unlock permanent monuments or investments that consume vast quantities of resources for lasting fleet-wide bonuses. "Dedicated Research Institute" (permanent +10% research speed, costs 1M energy). "Veterans' Hall" (all future captains start with +1 augment slot, costs enormous relic count). "Cartographer's Guild" (all sectors scanned +50% faster, costs a huge material investment). Solves the "late-game resources overflow with nothing meaningful to spend on" problem. Also gives late-game players goals beyond the campaign progression itself.

#### 8.F.10 Captain Voice Lines / Log Snippets
Small text snippets that appear based on captain personality or ongoing situation. "Captain Voss: 'Mining operations are efficient today.'" "Captain Reyes: 'The sector's readings are anomalous. Recommend caution.'" Adds flavor without narrative burden. Draws from a small pool per personality type (10 to 20 lines per personality). Could tie to 8.D.3 Captain Traits if implemented. Cheap way to give the fleet personality without writing a story.

#### 8.F.11 Cross-Ship Resource Transfer
The player can manually transfer resources between ships (or, more likely, between ships and the central base). Creates logistics decisions: send the mining ship's cargo home before dispatching it on a long mission, or leave it and let overflow-to-energy handle it? Small mechanic, but it makes the fleet feel like a network rather than isolated instances. Low implementation cost, high texture yield.

#### 8.F.12 Milestone Cutscenes / Story Beats
For a campaign with an ending, the campaign should *feel* like it has an ending. Between sectors (or at key story beats), show a brief text-based cutscene: a paragraph of narration, maybe a captain reporting in, maybe an enemy transmission. Not full narrative, just punctuation. Marks the emotional beats of the campaign. Extremely cheap to implement (text and a modal), high emotional yield. Distinct from 8.B.4 First Captain Legacy Arc, which is one specific character's arc; this is the campaign's overall dramatic rhythm.

---

## 9. Tech Notes

### 9.1 Confirmed Genre
Browser-based incremental idle game with active mission layer. Single-player. No real-time multiplayer.

### 9.2 Recommended Stack (Tentative)
- **TypeScript** for the frontend. The math gets hairy fast (compounding multipliers, prestige resets, equipment modifiers stacking on stat modifiers). Types catch bugs before they cost hours of debugging.
- **Svelte or React** for UI. Svelte is the lighter, more reactive choice and arguably the better fit. React is the safer "more tutorials available" choice. Either works.
- **break_infinity.js or decimal.js** for big number handling. Non-optional. JavaScript Number maxes around 9 quadrillion; idle games blow past that fast. break_infinity.js was built for Antimatter Dimensions and is the genre standard.
- **LZ-string** for save compression. Saves balloon; compress before writing.
- **IndexedDB** for save storage once non-trivial. localStorage is fine for v1 prototype.
- **No backend for v1.** Add cloud save / leaderboards later via Node + Postgres if scope warrants. Skip PHP.

### 9.3 Scope Reality Check
This is a hobby project for one person. The full design as documented is genuinely large for solo scope. Realistic minimum viable prototype is dramatically smaller (see Next Steps). The full feature set is a multi-year hobby project at hobby cadence. Plan accordingly.

### 9.4 Development Tooling

Tooling is not optional for incrementals. The best incremental developers spend at least a third of their coding time on tools like the ones below. Not because they love writing tools, but because tuning an incremental without them is impossible. You will change one number, wait 20 minutes to see the effect, discover the number is wrong, change it again, wait another 20 minutes, and quickly conclude you would rather stop working on the game entirely. Front-loading tool investment is one of the highest-ROI moves in solo game development.

All of the below should be wrapped in a `DEV_MODE` flag (compile-time env variable, URL parameter like `?dev=1`, or equivalent). Never ship a build with these enabled by default. Players who find debug tools either exploit them and break their own experience or feel the game is cheap.

Priority ordering below is roughly when to build each item during development.

#### 9.4.1 Speed Multiplier (Build First)
A global game-time multiplier decoupled from wall-time. Tick function takes a delta-time parameter. At 100x, pass `100 * realSecondsElapsed` as the delta. Game math advances as if that much time passed, in one calculation.

Not "run the game loop faster." That produces different results due to floating-point drift and murders framerate. Requires tick math to be closed-form rather than iterative, which is also what makes offline progression correct. The closed-form requirement pays off twice: once for offline, once for time acceleration.

Named presets rather than a raw slider:
- **Real-time (1x)**: normal play.
- **Playtest (10x)**: fast enough to feel flow, slow enough to observe.
- **Balance-check (100x)**: watch a full progression phase in minutes.
- **Torture-test (1000x+)**: catch numerical stability issues at extreme scales.
- **Frozen (0x)**: pause for inspection without interference.

Everything else depends on this working. Build first.

#### 9.4.2 Debug Panel with Resource Grants
Buttons and number inputs (not a typed-command console). Grant arbitrary amounts of any resource. Unlock any research. Complete any augment. Promote any captain. Advance to any sector.

This is what turns "play to test" into "test to test." Without it, you will only playtest the first hour of your game because that is all you can reach in a reasonable dev cycle.

#### 9.4.3 Bookmarks / Save States
Save the current game state as a named slot in localStorage or IndexedDB. Load it later. Dropdown to switch between them. Delete-when-obsolete affordance. Multiple concurrent bookmarks per project.

Save "just before boss 3," tweak a number, jump back, test again. Without bookmarks you are either replaying (slow) or manipulating variables directly (error-prone).

#### 9.4.4 Live-Editable Balance Constants
Expose your key game constants through a runtime-editable panel (dat.gui, leva, or similar). Change mining rate multiplier from 1.0 to 1.5 without stopping the game. See the effect immediately. Save configs you like as presets.

Not everything needs to be live-editable. Just the numbers you are actively tuning. Rotate what is exposed as tuning focus shifts.

#### 9.4.5 Number-Curve Visualizer
Any exponential curve (upgrade costs, production rates, cap growth) should be plottable, not just experienced through play. A tab showing cost of upgrade N versus tier N for tiers 1 through 30. Chart.js or equivalent, an afternoon of work.

Immediately reveals whether curves are too flat, too steep, or have discontinuities somewhere unexpected. You will refer to these plots more than you expect once they exist.

#### 9.4.6 Event Logging
Every meaningful game event gets logged with a timestamp: purchase, prestige, mission completion, boss encounter, augment install, sector unlock. Not for debugging bugs; for debugging *feel*.

After a playtest session, review the log for:
- Purchases per minute
- Time between prestiges
- Time spent with nothing available to buy
- Resource curve shape over time

Numeric answers to "was this session engaging" beat pure gut feel, especially for A/B comparing balance changes. Cheap to add anytime; add as soon as there is anything worth logging.

#### 9.4.7 Automated Progression Tests (Greedy-Buy Simulator)
The tooling item most hobby devs skip and later regret. A script that simulates a "reasonable player" running the game at 10000x or faster. Greedy-buys the best available upgrade every tick (highest ratio of expected benefit to cost). Logs state every hour of simulated time.

Run after every balance change. If simulated player prestiges at hour 8 instead of hour 4, you know immediately without playing yourself. If resource curves go vertical at some point, you have a runaway compounding bug. If nothing happens for six simulated hours, you have a stall.

Does not need to be sophisticated. A greedy heuristic is enough to catch most balance disasters. This is a lightweight version of what strategy game studios do with balance simulations, adapted to solo scope.

#### 9.4.8 Scenario Snapshots
Canonical test states you keep around permanently, distinct from ad-hoc bookmarks. Suggested starting set:
- Fresh game, tutorial complete
- Early game, one prestige done
- Mid game, three sectors cleared
- Late game, boss 8 preparation
- Endgame, fleet complete

Load each in turn after balance changes to check how the game feels at that stage. Manual regression test suite for game feel rather than for correctness. Add new snapshots when you find yourself repeatedly recreating a specific state.

#### 9.4.9 Instant Offline Simulation
Button that runs the offline progression calculation as if the game had been closed for N hours (input field). Shows before/after diff of all state.

Also serves as a math correctness check: run 1x for one minute, note state, reset, offline-simulate one minute. States should match. Divergence means the offline math is bugged. Catches production-only bugs during dev, before players hit them.

#### 9.4.10 Campaign Speedrun Mode
Automated end-to-end test that plays through the entire campaign at maximum speed using a scripted strategy. Reports total playtime plus per-sector timing.

If intended playtime is 40 to 60 hours and the speedrun says 12 hours or 200 hours, something is off. Immediate signal about whole-arc pacing without you having to actually play. More effort to build than other items here but huge dividends late in development when you are trying to get pacing right across the whole campaign.

Build this last, once the core loop and boss mechanics are stable enough that "scripted strategy" is a meaningful concept.

### 9.5 Deployment Infrastructure (Vercel)

Vercel is the recommended deployment platform for this project. Free tier is generous, workflow is optimized for solo developers, and the Git integration enables the preview environment workflow that makes iterative playtesting practical. Everything below is available at zero cost at hobby scale.

#### 9.5.1 Initial Setup

1. Create a Vercel account (free) at vercel.com. Sign in with GitHub, GitLab, or Bitbucket for painless auth.
2. Create a repository for the project on your chosen Git provider. GitHub recommended for the ecosystem.
3. In Vercel dashboard, "Add New Project" → select your repo. Vercel auto-detects the framework (Svelte, Next, Vite, etc.) and configures the build.
4. First deploy happens automatically. Production URL will be something like `yourproject.vercel.app`.
5. Configure a custom domain later if desired (Vercel offers free `.dev` domains via their registrar, or bring your own).

Total setup time: 15 to 30 minutes.

#### 9.5.2 Branch-Based Deployment Workflow (The Killer Feature)

The core workflow that makes this platform valuable:

- **`main` branch = production.** Auto-deploys to your production URL.
- **Any other branch = preview.** Auto-deploys to a unique URL specific to that branch.

Example workflow:
1. Create a branch: `git checkout -b boss-mechanic-experiment`.
2. Make changes, commit, push.
3. Vercel automatically builds and deploys the branch.
4. You get a URL like `boss-mechanic-experiment-yourproject.vercel.app`.
5. Share the URL with a playtester. They give feedback. You iterate on the branch.
6. Merge to main when ready, or delete the branch if the experiment doesn't work.

Playtesters never need to install anything. Zero-friction distribution. This is probably the single biggest workflow improvement over older solo game dev practices.

#### 9.5.3 Environment Variables

For dev-only features (like the `DEV_MODE` flag from 9.4):
- In Vercel dashboard: Settings → Environment Variables.
- Different values for Production, Preview, and Development environments separately.
- **Recommended:** `DEV_MODE=true` for Preview only, `DEV_MODE=false` for Production. This way branch previews have debug tools available; the production URL does not. You can play with cheats on a preview URL and still ship a clean production build.

For future backend needs: API keys and secrets go here, never in the repo.

#### 9.5.4 Analytics (Vercel Web Analytics)

Vercel offers built-in analytics that is privacy-respecting (no cookies, no PII) and does not require a consent banner. Free tier gives basic pageview and session data (sessions, unique visitors, top referrers, top pages).

Recommendation for this project: enable Vercel Analytics from day one for baseline "how many people are playing" data. Skip more elaborate analytics (Google Analytics, Mixpanel, etc.) unless a specific question demands it. Deeper telemetry can come later; see general note in earlier discussion about not over-investing in analytics for a hobby project.

#### 9.5.5 Serverless Functions (For Future Backend Needs)

Vercel can run serverless functions as `/api/` routes in your project. Useful later for:
- Cloud save sync (save state stored centrally so users can play across devices).
- Leaderboards or shared statistics.
- Version-check endpoint (client checks whether it has the latest build).
- Bug report intake (players submit save files with descriptions).

Not needed for v1 (localStorage is fine). Worth knowing exists for later.

Limits to be aware of:
- 10 second timeout on Hobby (free) tier.
- 60 second timeout on Pro tier.
- Not for long-running processes. If you need those (background workers, complex simulations server-side), use a real backend elsewhere (Fly, Railway, Render).

#### 9.5.6 Preview URL Persistence

Vercel keeps every preview deploy indefinitely (until you delete the branch and its associated deployments). This is genuinely useful:
- Share a specific version with a playtester by linking to a specific deploy URL. That version stays live even if you keep making changes on the branch.
- Compare two versions side-by-side by opening both in browser tabs.
- Roll back instantly by re-promoting an older deployment from the dashboard.

Useful pattern: after a significant playtest, note down the deploy URL that was tested. Weeks later you can revisit that exact state if needed.

#### 9.5.7 Bandwidth and Traffic Limits

Free tier (Hobby):
- 100 GB bandwidth per month (generous; handles thousands of players downloading the game once each).
- 100 GB-hours of serverless function execution (irrelevant if you have no backend).
- Unlimited deployments.
- Unlimited team members on Hobby tier are not allowed (project must be personal), which matters only if you eventually collaborate.

For a client-heavy idle game where users download assets once and everything else is client-side, you will not hit these limits at hobby scale. If you do hit them, congratulations, you have a hit; upgrade to Pro.

#### 9.5.8 Common Gotchas

- **`vercel.json` for custom routing.** Usually not needed for modern frameworks. If you find yourself editing it repeatedly, there is often a better way through framework config.
- **Framework preset detection.** Occasionally Vercel guesses wrong. Set the framework preset explicitly in project settings if the build fails or does something weird.
- **Node version.** Default is usually fine. If you use a specific Node version locally, set the same version in project settings to avoid "works on my machine" bugs.
- **Preview deploys can appear stale.** If a branch's URL shows old code, check that the latest push actually triggered a deploy. Force-pushed or amended commits occasionally do not trigger rebuilds. Manual redeploy from the dashboard fixes it.
- **Custom domains and DNS.** If you use a custom domain, DNS propagation takes minutes to hours. Not a problem, just be aware. Vercel's dashboard shows propagation status clearly.
- **Preview URLs are unlisted but not private by default.** Anyone with the URL can view. If you need actual privacy (e.g. for pre-release playtesting with an audience you strictly control), Vercel offers password protection at the Pro tier. For hobby scope, unlisted URLs are usually sufficient.

#### 9.5.9 Recommended Project Structure

For a Vercel-deployed idle game:
- `/src/` your game code (organized by feature/system).
- `/public/` static assets (icons, sounds, sprites, favicon).
- `/api/` serverless functions (empty for v1, populated later if needed).
- `/tests/` Vitest test files.
- `README.md` at minimum, how to build and run locally.
- `.env.local` local env vars, gitignored.
- `.env.example` template for env vars, checked in.
- `vercel.json` only if you need it (usually you don't).

#### 9.5.10 Alternatives (For Reference)

Not recommended over Vercel for this project, but worth knowing:
- **Netlify.** Essentially equivalent. Fine if you happen to prefer their DX. Pick one and don't spend more than 30 minutes deciding.
- **Cloudflare Pages.** More generous free tier bandwidth. Slightly less polished for modern frameworks. Good backup option if Vercel policies change.
- **GitHub Pages.** Free and simple but no preview environments. Fine as an *additional* home for the production build (deploy to both), not as a replacement.
- **itch.io.** For public game distribution once the game is playable. Complements Vercel rather than replacing it. Vercel hosts the game; itch.io is where you list it for people to find. Also gives you a comments/feedback surface for playtesters that Vercel doesn't provide.

#### 9.5.11 Recommended Full Setup Sequence

For getting started from zero:
1. Create GitHub repo. Empty is fine.
2. Sign up for Vercel using GitHub auth.
3. Import the empty repo as a new Vercel project. Accept defaults for framework detection.
4. Locally: scaffold your framework of choice (`npm create svelte@latest .` or `npm create vite@latest .`).
5. Add a placeholder page ("Hello Hyperion Legacy"). Commit and push.
6. Watch Vercel deploy automatically. Visit the URL. Confirm it works.
7. Set the `DEV_MODE=true` environment variable for Preview environments only.
8. Create a `develop` branch. Push a change. Confirm the preview URL works.
9. Start building.

At this point you have: production URL, working preview URLs per branch, environment variable separation, and a working Git-to-deploy pipeline. Total time: an afternoon.

### 9.6 Visual Design & UI Direction

The game is primarily text-based, but the visual presentation should be distinctive. Target aesthetic: **glassy, translucent, sci-fi holographic**. Think of the visual language of high-end sci-fi UI (Destiny menus, Mass Effect's Codex, The Expanse's ship displays, Star Citizen's mobiGlas) applied to what is functionally a text-based idle game. The game reads as text; it *looks* like a fleet admiral's command console.

This is not a decorative choice. Idle games live and die on how satisfying the UI feels moment to moment. A text-based game with beautiful UI feels premium. The same game with default HTML styling feels amateur. The visual identity carries a huge fraction of the perceived quality.

#### 9.6.1 Core Aesthetic Principles

- **Dark backgrounds.** Not pure black; deep navy, deep charcoal, or slightly desaturated dark blue. Pure black feels harsh; near-black with a slight hue feels intentional.
- **Translucent glass panels.** UI elements are frosted-glass overlays, not solid opaque boxes. Backdrop blur behind panels. Semi-transparent so the background gradient or particles show through subtly.
- **Thin bright borders.** Cyan, teal, or pale blue border strokes on panels, usually 1 to 2 pixels. These are the "hologram edges" that define the sci-fi look.
- **Soft glow / bloom effects.** Interactive elements have a subtle luminescence. Buttons glow gently on hover. Numbers that just increased pulse briefly. Not flashy; just enough to feel alive.
- **Monospace or geometric sans-serif for data.** Numbers, resource counts, timers, coordinates: monospace font for that command-console feel. Body text can be a clean geometric sans (Inter, Manrope, Space Grotesk) for readability.
- **Restrained color palette.** Cyan/teal as the primary accent, with sparing use of amber (warnings), red (danger), and green (success). Do not let the palette bloom into a rainbow.
- **Ambient motion.** Very subtle background animations. A slow parallax starfield, drifting nebula gradients, or occasional glinting particles. Motion should be so slow it's barely conscious. Never distracting.
- **Text is first-class.** Since the game is text-driven, treat typography as art. Generous line-height, clear hierarchy, well-tuned font sizes, deliberate use of weight and letter-spacing.

#### 9.6.2 Concrete CSS Techniques

- **`backdrop-filter: blur(N px);`** is the single most important CSS property for this aesthetic. Combined with semi-transparent backgrounds (`background: rgba(20, 40, 60, 0.4)`), it produces the frosted glass effect. Widely supported in modern browsers.
- **CSS gradients for panel edges.** A subtle linear gradient border (via `border-image` or a pseudo-element) that goes from bright cyan to transparent gives panels a "cut from light" feel.
- **`box-shadow` with color, not just black.** `box-shadow: 0 0 20px rgba(100, 200, 255, 0.3)` produces a cyan glow rather than a mundane drop shadow.
- **`text-shadow` for glow effects on important text.** Sparingly. Numbers that just increased, headings, boss health values.
- **CSS custom properties for the palette.** Define your colors once as CSS variables (`--color-accent-primary`, `--color-panel-bg`, etc.) and reference them everywhere. Changing the theme becomes a five-minute exercise instead of a rewrite.
- **Reduced motion respect.** `@media (prefers-reduced-motion: reduce)` should disable ambient animations for accessibility. Add this from day one; retrofitting it is a slog.

#### 9.6.3 Recommended Fonts

Free/open source options that fit the aesthetic:
- **Inter** (Google Fonts) — clean geometric sans, excellent for body text.
- **Space Grotesk** (Google Fonts) — slightly more character than Inter, still sci-fi neutral.
- **JetBrains Mono** or **Fira Code** — monospace options for data displays, HUD elements, coordinates.
- **Orbitron** (Google Fonts) — extremely sci-fi, use *sparingly* for headings only. Overuse turns into cliche.
- **Rajdhani** (Google Fonts) — HUD-style semi-condensed sans, works well for interface labels.

Pair one body font (Inter or Space Grotesk) with one mono (JetBrains Mono) and optionally one display font (Orbitron or Rajdhani for major headings only). Three fonts maximum.

#### 9.6.4 Icon Approach

- **Lucide** (open source, MIT licensed) or **Phosphor** (open source, MIT licensed) for general UI icons. Clean, consistent, tree-shakable.
- **Custom SVG for sci-fi specific icons.** Ship silhouettes, faction badges, ship class markers. These are hard to source generically; you'll probably need to make or commission them.
- **Avoid raster icons.** SVG scales cleanly and can be styled via CSS (color, glow effects). Raster locks you to fixed sizes and styles.

#### 9.6.5 Ambient Background Options

Options for the "not just a flat dark canvas" background:
- **CSS-only:** layered radial gradients producing a soft nebula effect. Zero performance cost. Good default.
- **Canvas starfield:** a lightweight canvas with a few hundred drifting stars at multiple depths (parallax). Cheap to implement, effective.
- **Three.js/WebGL scene:** a rendered starfield with more depth (nebula, distant ships passing, subtle particle effects). More effort but higher production value. Consider as a late polish item, not v1.
- **Static image with subtle parallax:** a good sci-fi background image with slight mouse-parallax reactivity. Cheapest to look great; requires finding or making the image.

Start with CSS gradients for the prototype. Upgrade if it feels flat.

#### 9.6.6 Recommended UI Framework Compatibility

The aesthetic works in any modern frontend framework, but some considerations:
- **Tailwind CSS.** Fine for this aesthetic. Use arbitrary values liberally (`bg-[rgba(20,40,60,0.4)]`, `backdrop-blur-md`). Keep component classes semantic to avoid unreadable JSX.
- **CSS-in-JS (styled-components, Emotion).** Also fine. Slightly more overhead but cleaner theming.
- **Plain CSS with CSS variables.** Perfectly viable. Sometimes the most readable option for a small project.
- **DaisyUI, shadcn/ui, or similar component libraries.** Will fight you. These have their own aesthetics baked in and skinning them to look glassy-holographic is often more work than starting from scratch. Skip.

#### 9.6.7 Animation Principles

- **Ease timings, don't linear.** `ease-out` for elements arriving, `ease-in` for elements leaving. Never `linear` except for continuous ambient motion.
- **Fast for interactive feedback, slow for ambient.** UI response animations should be 150-250 ms. Ambient background motion should be 5-30 seconds per cycle.
- **Framer Motion** (React) or **svelte/motion** or **auto-animate** for declarative animations. Hand-rolling CSS keyframes is fine for small stuff; use a library once the animation logic gets nontrivial.
- **Number changes should animate.** When a resource ticks up, animate the change (a small pulse, a rolling counter, a brief glow). This is a huge part of what makes idle games feel *satisfying* to watch. `react-countup` or equivalent handles the rolling-number case cleanly.

#### 9.6.8 Reference Games for Visual Inspiration

Not to copy, but to study for what works:
- **Cultist Simulator** — text-heavy UI treated as art. Extreme end of "text as visual identity."
- **FTL: Faster Than Light** — sci-fi minimalist UI, effective use of color coding.
- **Frostpunk** — HUD elements integrated with theme.
- **Universal Paperclips** — proof that pure text can carry a huge amount of atmosphere.
- **Destiny 2 menus** — the reference point for glassy holographic UI at the AAA end.
- **Mass Effect Codex screens** — text-heavy content presented as premium UI.

Play or watch footage of a few of these with the aesthetic-lens on. Note specifically: how much text density, how much whitespace, how loud the color accents are, how much motion.

#### 9.6.9 Accessibility Considerations

Do not skip these; they cost almost nothing and matter to real players:
- **Sufficient contrast.** Cyan-on-dark can look great and fail WCAG contrast standards. Check with a contrast checker. Aim for AA minimum.
- **Text scaling.** UI should work at 125% and 150% browser zoom without breaking.
- **Color is not the only signal.** Do not encode "danger" purely as "red." Include an icon, a label, or a pattern too.
- **`prefers-reduced-motion` respected.** Already noted above.
- **Keyboard navigation.** Idle games often become mouse-heavy. Ensure at least the primary actions have keyboard equivalents.

#### 9.6.10 Scope Warning

The aesthetic described here is genuinely achievable for one person, but it takes real work. A quick estimate: expect the first "acceptable" version of your UI to take 20 to 40 hours of focused work beyond just implementing the mechanics. The "pretty" version takes longer.

Two failure modes to avoid:
1. **Building the UI first, before the mechanics work.** Pretty menus for a broken game. Do the mechanics first with ugly UI, then polish.
2. **Never polishing at all.** The prototype UI is meant to be replaced. If you're still shipping placeholder Tailwind defaults six months in, the game will feel amateur no matter how good the mechanics are.

Middle path: build mechanics with utilitarian but not embarrassing UI (basic dark theme, readable fonts, no glassmorphism yet). Once the core loop is fun, invest a dedicated polish pass on visuals before wider playtesting. That way, the UI you show to real playtesters is the UI that represents the game's intended identity, not a placeholder that leaves the wrong impression.

---

## 10. Next Steps

In order of usefulness.

### 10.1 Pick a Driving Force
Section 5.5. Just pick one. Can change later. Even a placeholder unlocks the rest of the design.

### 10.2 Sketch a First Session Walkthrough
Minute by minute. New player opens the game for the first time. What do they see at 30 seconds, 5 minutes, 1 hour, 1 day? If there is a gap where the answer is "and then somehow they are engaged," that gap is the next design problem to solve. Surfaces structural problems faster than any other exercise.

### 10.3 Design the Boss Encounter Mechanic
Section 5.1. This is the single most important piece of undesigned content because the entire campaign spine depends on it.

### 10.4 Define 10 Example Augments
Force yourself to make each one unlock a *capability* rather than boost a *number*. If you can't do it, that's information about whether the capability-gate principle holds. If you can, you have your first content list.

### 10.5 Build the Smallest Possible Prototype
Two days of code, maximum. Scope:
- One captain
- One ship
- One resource type
- Three module slots
- A simple generator stack (mine produces ore, refiner produces ingots, fabricator produces components, etc.)
- One prestige reset
- No missions yet
- No research yet
- No boss yet

Play it. Notice what you feel. The thing actually missing from your design will reveal itself ten times faster from playing a bad prototype than from talking about a good one.

### 10.6 Iterate from the Prototype
Add one system at a time. Missions next. Then research. Then a second captain. Then boss encounter prototype. Each addition gets playtested before the next addition.

### 10.7 Defer Polish, Lore, Naming, and Art
Until the core loop is proven fun. Placeholder names and ugly UI are fine for the entire prototype phase.

---

## 11. Glossary

- **Tick layer.** Continuous passive gathering/production. Runs at all times including offline.
- **Mission layer.** Active opt-in dispatches with timed objectives and risk/reward.
- **Sector.** A region of space with its own resources, missions, and threats. Culminates in a boss encounter.
- **Campaign.** The full sequence of sectors from start to ending.
- **Captain.** A named, persistent character who commands a ship. The parallel "character" unit.
- **Crew.** Workforce of a ship. Specialized roles. Lighter identity than captains.
- **Ship.** Platform a captain commands. Provides capacity and slots, does not act on its own.
- **Module.** Upgradeable component of a ship (cargo hold, mining laser, research bay, etc.).
- **Augment / Cybernetic.** Persistent upgrade applied to a captain (and/or crew). Unlocks capabilities.
- **Common matter.** Auto-stockpiled basic resources. No cargo footprint.
- **Rare matter.** Cargo-bound advanced resources. Required for crafting.
- **Energy.** Derived currency from converting matter. Very large finite storage.
- **Relic.** Unique salvage find. Cannot be synthesized or researched. Carries narrative or unique effects.
- **Synthesis.** Converting energy back into materials at a cost.
- **Overflow rule.** When cargo is full, new rare matter auto-converts to energy.
- **Tier 1 prestige.** Captain augmentation reset / cap raise.
- **Tier 2 prestige.** Ship promotion / fleet expansion.
- **Boss encounter.** Fleet-scale battle that ends a sector and gates progression.
- **Driving force.** The one-sentence answer to why the player is doing any of this.
- **Frame vs Engine.** Frame is what the game feels like it is *about*. Engine is the mechanical loop underneath. Both matter; they serve different purposes.
- **Generator stack.** The compounding production chain underneath the game (things producing things producing things).
- **NG+.** New Game Plus, post-completion replay mode.

---

*End of master design document.*
