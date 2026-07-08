# Suggestions / Future Ideas

Ideas raised during development that aren't being built right now. Captured here so they survive
past the conversation they were mentioned in (Ops-style "write it down so you don't relitigate it" —
see KNOWN_ISSUES.md for actual bugs/gaps; this file is for not-yet-scoped future features).

- **Sector Space (Shipyard/Starbase).** Shelved mid-brainstorm in favor of the Captain & Homeworld
  Talent Trees. Shipyard would plausibly center on upgrading a captain's existing Vector-Fall Engine
  (reducing mission transit ticks) rather than building new ship hulls, given captains and ships are
  1:1 today. Starbase's whole described purpose (damaged/taken offline before a homeworld can be
  bombarded) needs Battlespace to exist first — fully deferred until then.

- **Loot-rarity-range rework.** Real bug in the already-shipped mission-loot system (Phase 3a):
  currently, rolling a non-common tier on an extraction tick awards the FULL tick's units (10) to
  that tier. Intended behavior: roll a min/max quantity within the rolled tier instead (e.g. 1-3
  units of uncommon), with the remainder defaulting to common ore. Touches `MISSIONS`' loot table
  shape (needs a range, not just a weight) and the extraction logic inside the delicate, closed-form
  `tickCaptainMission`. Deserves its own careful pass, not a quick patch.

- **Missing Components/Refined Material display.** The HOME PLANET panel only shows 3 of the 5
  `HomePlanetMaterialKey` storage keys — `refinedMaterial`/`components` (added in Phase 4's crafting
  system) never display anywhere in the UI.

- **Full-width panels.** Let panels use the full screen width instead of today's `max-width: 720px`
  constraint. (The rest of this old entry — moving stats to the top, a persistent captain info pane —
  is being addressed by the 2026-07-07 UI Redesign; see `docs/plans/2026-07-07-ui-redesign-design.md`.)

- **Inventory tab (under Homeworld).** Shows every item/material the fleet has, categorized into
  sub-tabs, with a search box to filter down to what you're looking for.

- **Player Stats / Achievements / Completion panel.** A "percentage of game completion" tracker
  spanning achievements count, upgrade totals, captain levels/talent-tree completion, and inventory
  milestones (e.g. "collect 1,000,000 Unobtainium Ore, lifetime" counts as complete for that item —
  once hit, it's permanent, never lost even if the resource is later spent). Tabbed by section
  (Inventory, Homeworld, Sector Space, Missions — e.g. "complete a given mission 1,000,000 times"),
  each with its own progress bar and medal tiers (bronze/silver/gold/higher) per completion level.
  Medals spend on bonuses, cosmetic skins, themes.

- **Clerk-based auth (Vercel) + multiplayer.** Login via Clerk, plus multiplayer capabilities: chat,
  PvP, cloud saves. An entirely different category of work (backend/auth/networking) from everything
  built so far, which is 100% client-side. Its own dedicated design whenever it's picked up.

- **Crew system.** Ships (today, 1:1 with captains) gain a crew of individuals with varying roles,
  tiers, and races. Different races carry different racial bonuses; a crew member's role/seat
  contributes to a specific ship system (e.g. a Weapons Officer specializing in a given weapon type).
  The "weapons"/combat angle depends on Battlespace existing first, similar to Tactical/Homeland
  Defense in the Talent Trees — likely needs its own scoping pass on which roles matter before combat
  exists (e.g. an Engineering seat could plausibly buff the Vector-Fall Engine or crafting today,
  independent of combat) versus which roles are pure Battlespace stubs until then.

- **Ship types, ship-switching, and ship-type-gated mission categories.** Deferred from the
  2026-07-07 UI Redesign's Fleet Operations tab. Today `ShipType` is only ever `"resourcer"`, with no
  switching mechanic and no second type. The eventual feature: additional ship types (e.g.
  "destroyer"), a way for a captain to switch which ship they pilot, and new mission categories
  (e.g. "Patrol") gated on the piloting captain's current ship type — Fleet Operations' mission-first
  layout was deliberately built so this only needs a filter/category change later, not a UI rework.
  Confirmed again during the 2026-07-07 Fleet Operations Mission UI design: the captain-selection
  popup (docs/plans/2026-07-07-fleet-operations-mission-ui-design.md) is the exact spot ship
  selection will plug into once this lands — Ships & Crew is the agreed-on next big feature after
  this mission-UI pass.

- **"Fleet Captain's" / "Fleet Operations" nav-tab label distinction.** Code review flagged during the
  2026-07-07 UI Redesign: both bottom-nav labels render as 10px, uppercase, letter-spaced text and
  share the same first word ("Fleet"), which could make them harder to tell apart at a glance,
  especially on a small screen. Not a bug — a copy/visual-design tweak — worth a pass (e.g. distinct
  leading words, an icon per tab, or a stronger visual differentiator) once there's real usage/feedback
  to design against, rather than guessing at a fix now.

- **Accordion-style Patch Notes.** User request, 2026-07-07, right after the Patch Notes sub-tab
  shipped as a flat list: eventually convert PATCH_NOTES from a flat list into an accordion, one
  entry per version, collapsed by default except the current/newest version (expanded), each entry
  showing bullet points broken out by category (features / balance changes / additions / etc.)
  instead of a single summary sentence. Not built yet — today's list is a single-sentence-per-version
  flat list, fine while there are only 4 entries, but the user explicitly flagged it "will fill up
  pretty quickly."

- **Selectable background styles.** User request, 2026-07-07: an Options setting to switch the
  ambient `Starfield` background between multiple looks -- the current gentle twinkle/drift, a
  "moving at sub-light speed" starfield (stars streaking past as if the fleet is underway), and a
  Star Trek-style warp effect (streaking light-speed jump). More styles (wormhole, etc.) are expected
  to be added later, so whatever implements this should make adding a new background style easy
  (e.g. a small registry/union type rather than hardcoded branching), not a one-off special case per
  style. Not scoped yet -- purely a future idea, no design decisions made.

- **Talent trees as an actual visual tree, with tooltips.** User request, 2026-07-07: both talent
  trees (Captain Talents and Homeworld Talents) currently render as a flat list of nodes per branch
  (`.skill-node` rows, no visual connections between prerequisite/dependent nodes) with only a
  label and a cost/status line -- there's no visual tree/link structure showing which node unlocks
  which, and no tooltip explaining what a node's effect actually does in plain language (the
  `CaptainTalentEffect`/`HomeworldTalentEffect` types and their numbers are visible only in code,
  not in the UI). The user's own words: "right now, it's hard to tell what the talents actually
  do." Future polish pass, not scoped yet -- would need: (1) an actual tree/link rendering (lines or
  connectors between a node and its `requires` prerequisite, not just an unlabeled flat list), and
  (2) a human-readable description per effect type/value shown on hover, likely requiring a new
  "flavor text" field per talent entry in `CAPTAIN_TALENTS`/`HOMEWORLD_TALENTS` (model.ts) rather
  than deriving text from the raw effect union at render time.

- **Battlespace's 4 real modes (multiplayer-dependent).** User request, 2026-07-07: Battlespace
  (currently a single "Coming Soon" placeholder tab) is eventually meant to hold 4 distinct game
  modes, shown as 4 locked placeholder options for now (built alongside the Fleet Operations Mission
  UI pass -- see docs/plans/2026-07-07-fleet-operations-mission-ui-plan.md):
  - **Fleet Skirmishes** -- PvE combat against small pre-set ship groupings, using the player's own
    saved fleet presets.
  - **Campaign** -- see the dedicated entry below, fleshed out considerably beyond "scripted PvE
    content" since the user expanded on it 2026-07-07.
  - **Fleet Exercises** -- PvP combat maneuvers against other players. Requires multiplayer.
  - **Invasion mode** -- sector-space defense followed by planetary bombardment and ground troops;
    does not capture the planet, but yields loot/prizes. Also wants a leaderboard tied to this mode.
  None of these have any design work done yet -- pure future direction. Fleet Exercises, Invasion,
  and the leaderboard all depend on real-time multiplayer (which itself depends on a backend +
  WebSockets/similar, explicitly rejected for v1 in the master design doc, section 7.2) and a chat
  system, neither of which exist. Fleet Skirmishes and Campaign are PvE-only and don't share that
  dependency, so they could in principle be designed/built independently of the multiplayer work.

- **Story Campaign mode (fleshed out 2026-07-07, expands on the Campaign bullet above).** The
  user's own vision, considerably more developed than the original one-line "scripted PvE content"
  note:
  - Campaign is meant to be **the first Battlespace option to unlock**, and Battlespace itself is
    meant to be **the first tab** a new player unlocks (after onboarding -- see the tutorial-system
    entry below), i.e. Campaign is the intended on-ramp into the game's harder content, not a
    late-game unlock.
  - Structure: **story beats** interspersed with **battles of increasing difficulty**, grouped into
    **chapters**. Each chapter culminates in a big fight against a "big baddie" -- the player's
    fleet vs. a wave or two of regular enemies, then a capital-ship boss, and potentially planetary
    defenses and/or a bombardment/invasion sequence in the same chapter-capping encounter.
  - Campaign is explicitly meant to **teach and gate**: story-driven pacing is used deliberately to
    make sure players understand a system before being thrown at harder content ("these will not be
    easy") -- i.e. Campaign doubles as a structured tutorial/onboarding ramp for the OTHER Battlespace
    modes (Fleet Skirmishes, Fleet Exercises, Invasion), which unlock as their Campaign equivalent is
    completed, not available from the start.
  - **Difficulty tiers: Tier I through Tier X**, each clearable independently, each with its own
    reward set -- i.e. Campaign isn't a one-time linear playthrough, it's replayable at escalating
    tiers for better rewards, conceptually similar to how Fleet Operations' own Tier I-V mission
    difficulty tiers work (docs/plans/2026-07-07-fleet-operations-mission-ui-plan.md), but for
    story/boss content instead of resource missions.
  - No design work started -- this depends on the entire Boss Encounter Mechanic being designed
    first (master design doc, section 5.1, flagged there as "HIGHEST PRIORITY" unresolved design
    work), plus real ship/crew/combat systems that don't exist yet.

- **Tutorial system with an in-game assistant character.** User idea, 2026-07-07: an assistant
  character (some kind of AI/aide/XO figure) walks a new player around the Homeworld and the "desk
  terminal" interface (the game's own framing device -- the player is playing this game AS the
  admiral's desk terminal, an in-fiction justification for the whole UI). Multiple short tutorials
  covering different systems, run before Battlespace (and specifically Campaign, see above) ever
  unlocks. Specific presentation details from the user's own description:
  - **Dialogue boxes with a background blur** behind them when they appear (same
    `backdrop-filter: blur(...)` glass-panel language the rest of the UI already uses for Panels/
    modals -- this would likely reuse that existing visual idiom rather than invent a new one).
  - **Spotlight-style guided steps**: the rest of the screen darkens/dims except for a lit-up
    highlight around whatever specific element the player needs to click next, to physically walk
    them through performing the action being taught (not just describing it in text).
  No design work started -- purely a future onboarding-polish idea, would need its own brainstorm
  once the systems it's meant to introduce (Homeworld, missions, Battlespace/Campaign) are far
  enough along to actually tutorialize.
