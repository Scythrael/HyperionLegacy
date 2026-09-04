# Suggestions / Future Ideas

Ideas raised during development that aren't being built right now. Captured here so they survive
past the conversation they were mentioned in (Ops-style "write it down so you don't relitigate it" —
see KNOWN_ISSUES.md for actual bugs/gaps; this file is for not-yet-scoped future features).

- **NEXT (0.11.0) is DESIGNED (user 2026-07-17).** The equipment feature grew, during brainstorm, into a
  full ship-equipment + combat + crew + exploration vision. It is captured in two docs:
  `docs/plans/2026-07-17-ship-equipment-combat-epic-design.md` (the whole vocabulary) and
  `docs/plans/2026-07-17-equipment-0.11.0-design.md` (the buildable non-combat slice that ships as 0.11.0).
  0.11.0 = the equipment instance/affix/quality engine + 4 live slots (Cargo, FTL Drive, Reactor, Prospecting
  Rig) + Standard-Issue + crafted Standard-to-Radiant gear + Crafting Level/iLevel + the 0-5 Quality axis +
  cargo-as-true-cap + storage/salvage + Mass/Power budgets + migration + mockup-gated UI, with the full stat
  vocabulary (including the 9 combat weapons) DEFINED so 0.12.0 plugs in cleanly. Next step: writing-plans.

- **0.12.0 = COMBAT (user 2026-07-17), designed as vocabulary in the epic doc above.** Ships the weapon/shield/
  hull/thruster/cockpit/quarters/sensor slots, the 3 weapon families (Particle / Kinetic / Electronic Warfare)
  with a +10/0/-10 triangle, the 9 first-pass weapons (Particle: Plasma/Graviton/Voltaic; Kinetic: Railgun/
  Autocannon/Concussion Torpedo; EW: Point-Defense/EMP Cannon/Tachyon Burst Emitter), the System Disruptions
  pool (ranked, quality/rarity-scaled), range bands + phase-driven multi-ship encounters, two-tier combat
  (Battle Power auto-resolve for mission combat, Battlespace for tactical), Battle Rating + Engagement Forecast,
  difficulty Ranks I-X with the death/durability table, Dispatch Once/Repeat, and Battlespace folded into
  Operations (freeing the leftmost tab for a Dashboard). HARD PREREQUISITE before captain death: migrate
  captains to a monotonic id counter (see the captain-id entry below).

- **0.12.0+ future bites (logged from the 2026-07-17 brainstorm; full detail in the epic doc):** the tabled
  weapons (Ion, Laser, Neutron, Hyperon, Mass Driver + Breaching Lance, Seeker Torpedo, Flak Cannon, Microwave
  Emitter, Signal Jammer, Proximity Cluster Mines, Viral Lance); rarities above Radiant (Luminous/Constellar
  legendary + Nova/Celestial ascension + the ~18-set content pipeline); the **Crew & Command** epic (stats
  Strength/Integrity/Cunning/Constitution, stations, Recruiter's Office, traits, Senior Staff, promotion ranks,
  the prestige/retire loop); the **Exploration + discovery-gated Research** system (day-long Explorer missions,
  study/translation facility, discovery-prerequisite research, artifact set bonuses); the **module** system
  (stat-stick + active ability); **Wargames** async-ante PvP; the **play-simulator** for balancing the
  compounding item-gen math; sci-fi system names (Kepler's Reach, Tycho Verge, Cygnus Gate, Erebus Deep,
  Halcyon Drift, Meridian Cradle, Vesper Hollow, Oberon Span, Calliope Reach, Nyx Threshold, Sable Expanse,
  Requiem Belt, Auric Shoals, Thessaly Run, Lyra's Wake, Cinder Marches, Ossuary Field, Dhole's Crossing).

- **ACTIVE PLAY / FLEET ADMIRAL FLAGSHIP, the "2.0" major expansion (user 2026-07-18, NORTH-STAR, deepest deep-future).** The user is explicit: this is NOT a foundational system and NOT a bite-sized patch. It is the FIRST EXPANSION, a 2.0-level overhaul, F2P (never charged for), built LAST. It is the active-play SOUL of the game layered on top of the idle core. Concept: the Fleet Admiral (today an abstract level + adminPoints source) becomes the PLAYER'S AVATAR. You "leave the homeworld" and take command of your own personal FLAGSHIP (the 11th ship, distinct from the 10-captain fleet). Riker's TNG-finale line ("the best part of being an admiral is you choose your own ship"). The flagship uses the SAME Ship Systems foundation built in 0.11.0, PLUS mode-exclusive slots/bonuses balanced around ACTIVE play. Structure:
  - THREE active modes = THREE flagship capital-ship types (not 9): Science (the exploration minigame), Tactical (combat "Engagements"), Prospecting (active resource). You build all three (Dreadnought plus 2 more capital-class names, a capital-ship tier); hop onto whichever mode you want to play. (Dev's own setup: Enterprise / Defiant / Voyager.)
  - IDLE plus ACTIVE COEXIST: idle the 10-captain fleet, board the flagship on a weekend or after work to actively play. Neither loop punishes the other. This is the idle-plus-active holy grail.
  - STAKES: the flagship CANNOT be destroyed (a built-in escape system, lose a battle and you escape, the Fleet Admiral never dies), but CREW can be injured/die, and your CAPTAINS can still lose ships and die at high difficulty. Immortal admiral anchor, mortal fleet, makes Tier X permadeath land harder.
  - SCIENCE active mode (this FOLDS IN the earlier standalone "Science minigame" idea, do NOT log that separately): an idle/active TOGGLE (idle for a fraction of rewards, or flip active and the minigame unlocks at the mission's ground-presence beat). A randomly-generated overhead grid EXPLORATION map (fog-of-war reveal, arrow-key movement, XCX FrontierNav map as visual inspiration, NOT a copy). Random encounters resolve into turn-based away-team combat (Attack/Defend/Tech/Item). The AWAY TEAM is crew assigned to away-team slots (a party selector separate from ship-crew stations; no impact on ship ops). Rewards: enemy drops PLUS full-map-exploration bonuses (extra item/currency/reward boost).
  - TACTICAL active mode ("Engagements"): face waves of enemy ships of varying difficulty/scale on your flagship. And when the idle fleet is free, YOU LEAD THE FLEET INTO BATTLE, this is where PvE BATTLESPACE events live (flagship plus fleet-scale combat, same I to X difficulty ladder).
  - ENGAGEMENT ENGINE: rotating holidays plus rotating EVENTS with active-play-exclusive rewards, achievements, collectables (example event: enemy strike groups sighted in our territory, board the Defiant, clear the sector).
  - PREREQUISITES (why it is last): the Crew system, a turn-based/tactical COMBAT engine, the minigames, Battlespace, and an events system. Design it whole when its prerequisites are near; build it as the 2.0 expansion. It is the north-star that gives all the combat/crew/exploration vocabulary a reason to be played ACTIVELY.

- **HELP tab: Systems Encyclopedia plus Beginner's Tutorial (user 2026-07-18, wants it SOON, recommended next after 0.11.0).** A HELP category in the System rail (always available, NOT locked). Two parts: a readable, ordered "how to play" BEGINNER'S TUTORIAL (structured the way the future interactive tutorial will step through it), and a SYSTEMS ENCYCLOPEDIA (per-system reference: missions, refining, fabrication, fuel, ships, Ship Systems, etc.). Explicitly the INTERIM home until the full interactive spotlight-guided assistant tutorial ships (that tutorial is the separate deep-future entry; this is the low-cost near-term stopgap that delivers most of its value). LIVING DOC: "update HELP" joins the definition-of-done for every feature going forward, same as patch notes, so the docs never drift. Low-risk (content plus a simple readable tab, no engine work, barely mockup-gated).

- **Sector Space (Shipyard/Starbase).** Shelved mid-brainstorm in favor of the Captain & Homeworld
  Talent Trees. Shipyard would plausibly center on upgrading a captain's existing Vector-Fall Engine
  (reducing mission transit ticks) rather than building new ship hulls, given captains and ships are
  1:1 today. Starbase's whole described purpose (damaged/taken offline before a homeworld can be
  bombarded) needs Battlespace to exist first — fully deferred until then.

- **HOUSE UI PATTERN — all facilities use the left-rail + per-facility SubTabs layout (LOCKED, user
  2026-07-11).** The Phase 1 Refinery panel's layout (a left rail of facilities mirroring the captain
  list + top SubTabs: Overview / Upgrades / …, itself mirroring the Fleet Captain's tab) is the
  standard for EVERY facility in BOTH domains. Structure decision (user chose, don't re-litigate):
  KEEP the standalone **Facilities** tab (homeworld facilities: Refinery now; Warehouse / Fabricator /
  Research later) AND give the **Sector Space** tab the SAME layout for ITS facilities (Shipyard /
  Starbase, with today's ship-construct UI folded in as a facility). Stays at 7 bottom-nav tabs (user
  accepted the crowding rather than collapse Facilities into Homeworld/Sector Space). NOT built now,
  and deliberately so: (1) Sector Space's real facilities (Shipyard/Starbase) are Phase 5 — building an
  empty facility rail now = placeholder tiers, which the user has consistently ruled out; (2)
  retrofitting the SHIPPED, device-signed-off ship-construct UI into a facility rail is an
  Anti-Regression touch on working code and is MOCKUP-GATED (how ship-construct maps onto a facility's
  Overview/sub-tabs is a real layout decision, not a restyle); (3) it must not be bolted onto the
  frozen, merge-gated Phase 1 branch. PLAN: Phase 5 (Starbase/Shipyard) builds Sector Space into this
  layout natively with real facilities; the "fold existing ship-construct into the rail" retrofit rides
  that phase (or a dedicated mockup-gated UI-consistency pass), whichever the user picks then.

- **ALL 7 tabs adopt the rail + SubTabs layout (user 2026-07-11 — extends the house-pattern above).** User
  chose FULL uniformity: every bottom-nav tab uses the left-rail + per-entity SubTabs structure, not only
  facility tabs. Grounded reality in App.svelte: **5 of 7 already conform** — Command (the original),
  Facilities, Sector Space (rail w/ locked structures), Operations (rail visual + SubTabs), and Battlespace
  (locked-rail stub: Skirmishes/Campaign/Exercises/Invasion, fills when combat ships). The **two real gaps**:
  **Homeworld** (SubTabs, no rail) and **System** (settings, SubTabs). KEY DISTINCTION preserved (don't lose
  it): the rail *layout* is universal, but the *locked/unlock* gating applies ONLY where there's real
  progression — so **System's rail = a STATIC settings-category nav (Options / Appearance / Save Data / Patch
  Notes / Debug), NO 🔒 / earned gating** (settings aren't unlocked; OS/Discord-style left nav). Retrofitting
  Homeworld + System is a dedicated **mockup-gated "Tab Layout Unification" pass** — its own feature, built
  AFTER Phase 1 merges, NOT on the frozen merge-gated Phase 1 branch, and NOT started until sketches exist
  ([[feedback_visual_ui_needs_mockup]]). ⚠️ OPEN QUESTION for the Homeworld sketch: since homeworld FACILITIES
  now live in the standalone Facilities tab, what entities fill HOMEWORLD's rail (its non-facility
  structures/sections/overview)? — the user must sketch this before it can be built.

- **Patch-notes / "What's New" as collapsible accordions (user 2026-07-14).** Render the version
  update history as per-version accordion sections (collapsed by default, newest auto-expanded) instead
  of the current flat newest-first list in `PATCH_NOTES`. Motivation: the list keeps growing and now
  carries duplicate version numbers across the pre/post-reset history (two 0.8.0 entries, earlier
  0.6.0/0.7.0 collisions) — accordions make it scannable and let stale entries collapse out of the way,
  and would let a version's notes be shown once at its own header rather than relitigated. Natural home
  is the System-rail **Patch Notes** settings category from the Tab Layout Unification entry above; could
  ride that mockup-gated pass or a smaller standalone one. Not scoped/built yet — folds in at an
  applicable UI pass ([[feedback_visual_ui_needs_mockup]]).

- **Multiplayer chat: titles, selectable icons, name colors.** User idea, 2026-07-08. Once multiplayer
  chat exists, players should be able to set a custom title (the user's own example: "Executive Officer
  of Radishes"), a selectable chat icon sourced from unlocked achievements/donation tiers/dev-or-mod
  status (so at a glance, a dev/mod badge, or a supporter's donation-tier icon, is visible to everyone
  who wants to show it), and a name color option. Purely cosmetic/social, not gameplay-affecting. Not
  scoped yet: the actual achievement/donation-tier system this would source icons from doesn't exist —
  this depends on Multiplayer existing first (see the roadmap note below), which itself depends on
  Combat shipping first per the user's own stated sequencing.

- **Multiplayer investigation (auth, chat, cloud saving) — after Combat.** User idea, 2026-07-08: once
  Combat missions are implemented (the 4th item in the existing roadmap note below), start investigating
  Multiplayer, with authentication, chat, and cloud saving as the foundational first pieces (in that
  order of foundational-ness, not necessarily build order). Not scoped at all yet — purely a "this comes
  after Combat" placeholder for a future brainstorming session.
  **UPDATE (2026-07-13): multiplayer is a CONFIRMED LAUNCH feature** — the game goes live WITH it. Still
  POST-COMBAT in build order (combat -> multiplayer -> launch), but no longer just "investigate." Includes
  login, cloud save, and chat. **This makes the item-authenticity salted-hash ID a REAL feature, not
  client-side theater** — with one hard requirement: it MUST be SERVER-authoritative. A client-generated
  deterministic hash (even salted) is forgeable, because the algorithm + salt ship in the JS bundle and any
  user can read them. The correct design: the SERVER mints the hash when an item drops (using a secret the
  client never sees) and validates it on every sync; the client only carries an opaque token it cannot
  reproduce. For non-stacking equipment (future content, its Warehouse tabs reserved in Phase 2), give each
  instance a UNIQUE instance id NOW (for referencing, like ShipInstance.id) + a reserved `integrity` field,
  architected so the server becomes the minting/validating authority when the multiplayer backend lands.

- **Cargo capacity as a real ship stat.** User idea, 2026-07-08, from the Extraction Rework
  brainstorming: today `cargoCapacity` is a flat `MissionDef` constant; once the Ships feature (see
  roadmap note below) exists, it should become a per-ship stat instead, with each mission requiring a
  *minimum* cargo capacity to undertake it (e.g. "requires 125 ft³ of space, 100 ticks guarantees ~100
  ore and then some"). Since the new single-roll extraction mechanic (built 2026-07-08, see
  `docs/plans/...extraction-rework...`) no longer caps uncommon/rare amounts, actual returned cargo is
  now naturally variable (a lucky run can exceed the nominal guaranteed total) — the ship's required
  minimum capacity needs headroom above the guaranteed baseline to avoid ever losing overflow material.
  Not built now: `cargoCapacity` stays a mission-level constant until Ships exists; future ship bonuses
  would layer on top the same way captain/homeworld talent bonuses already do, without touching
  `MISSIONS` itself, so this doesn't block the retrofit.

- **Third mission type: "farming efficiency" run.** User idea, 2026-07-08, same brainstorming session.
  Unlike Short/Long Ore Run (fixed deterministic tick count, meaningful XP per run), this type has no
  transit-out/unloading phases and runs until the ship's cargo hold is completely full (so a 300k-cargo
  ship stays out proportionally longer) — trading much lower XP-per-run for maximum resource-per-real-
  time efficiency. Deliberately NOT built as part of the Extraction Rework: every other mission today
  has a *fixed, deterministic* tick count, which is exactly what lets a huge offline-catchup jump
  resolve in one closed-form calculation instead of simulating tick-by-tick (see `tickCaptainMission`'s
  own "MUST be closed-form" comment in `tick.ts`). A mission whose duration is an RNG-dependent stopping
  time (stop when cargo happens to fill) breaks that guarantee for this mission type specifically and
  needs its own dedicated design pass — not a small addition to the existing two mission types.

- **Roadmap note (user's stated sequence, 2026-07-08, not a commitment to exact order/timing):** after
  the current Extraction Rework, the next planned major features, in the user's own rough order: (1)
  finish out the Talent tree foundations, (2) Ships (stats, per-ship cargo capacity, etc. — see the two
  entries directly above), (3) Ship building (requires Homeworld upgrades to unlock a Shipyard,
  material-refining chains, crafting ship components/equipment/modules, docking space and construction-
  bay upgrades, and ship equips), (4) Combat missions. Captured here as directional context for future
  brainstorming sessions, not a locked spec — each of these still needs its own full brainstorm/design
  pass when its turn comes.

- **Variable/configurable tick-bar fill rate.** User idea, 2026-07-08, floated during the Tick
  Granularity Rebalance brainstorming (`tickDurationSeconds` 10→1): let the header tick-bar's visual
  fill cadence be configurable (e.g. default 1 tick per fill, with an option for "10 ticks per fill"
  or removing it entirely), decoupling the bar's visual pace from the underlying tick math. Deferred
  in favor of a simple on/off "Enable Tick Bar" toggle (shipped) — a bar representing N>1 ticks per
  fill risks visually disagreeing with each mission's own "N ticks remaining" readout, and there was
  no need to design a more elaborate control before observing how the plain 1-second-cycling bar
  actually reads in practice. Revisit only if the on/off toggle turns out not to be enough.

- **Future online-only tick-speed buff (global buff/purchase, 25%/50% cut).** User idea, 2026-07-08:
  a planned future global buff (given out or purchasable) that temporarily reduces effective tick
  duration by 25% or 50%, deliberately affecting ONLY active/online play, never offline catch-up
  (the user explicitly wants to avoid the balance complexity of an offline-affecting speed buff).
  Confirmed already architecturally compatible with no code changes needed: the existing `speed`
  multiplier in `src/App.svelte` is runtime-only (never persisted to the save, never touches
  `state.tickDurationSeconds`), and offline catch-up always computes from real elapsed wall-clock time
  regardless of what `speed` was set to while away — a future buff hooks into that exact same
  runtime-only lever. Not built; just confirmed compatible during the Tick Granularity Rebalance design.

- **Ship loss / escape pods as a combat consequence.** User idea, 2026-07-08: when Battlespace/combat
  exists, the user is on the fence about whether ship destruction should be a real possibility, and
  explicitly does NOT want captain death as a mechanic. If ships can be destroyed, the crew should
  plausibly end up in escape pods rather than simply being killed off alongside the ship — user wants
  this "weighed and considered accordingly" once combat is actually being designed, not decided now.
  Not scoped yet: what escape pods actually mean mechanically (a captain surviving but losing their
  ship/equipment? a rescue mission to recover them? some recovery cost/delay before they can crew a
  new ship?), and whether this should be a difficulty-mode toggle (e.g. "standard" mode preventing ship
  destruction entirely vs. a harder mode allowing it).

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
  (3) **Respeccing** -- User request, 2026-07-07 (said this "will 100% need implementation... sometime
  soon"): a way to reset a captain's Captain Talents (or the fleet's Homeworld Talents) and refund
  the spent statPoints/adminPoints so they can be re-allocated differently. Not scoped yet -- needs
  its own design pass covering at minimum: full reset only vs. picking individual nodes to refund,
  whether prerequisite chains complicate partial refunds (can't refund a prerequisite while a
  dependent node is still owned), and whether respeccing costs anything or is free.

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

- **Redemption codes.** User idea, 2026-07-07: an admin-entered code system for giveaways --
  anniversary events, promo goodies, etc. The player enters a code in-game and receives whatever
  reward that code grants. Not scoped yet -- would need at minimum: a code -> reward-grant mapping
  (probably a small data table, similar in spirit to `RECIPES`/`MISSIONS`), a way to prevent the SAME
  code being redeemed twice by the same save (a `redeemedCodes: string[]` on `GameState`, most
  likely, needing its own save migration), and a decision on whether codes expire/are single-use
  globally (impossible to enforce client-side-only without a backend) or are just per-save
  single-use (achievable with the current no-backend architecture).

- **In-game dev/admin panel tied to a user account (multiplayer-era).** User idea, 2026-07-07: once
  real user accounts and multiplayer exist, there should be an in-game admin panel (gated to the
  developer's own account) for handling things live -- moderation, granting the redemption-code
  rewards above, etc. Explicitly "an idea for far later" -- depends entirely on the multiplayer/
  backend/account-system work landing first (none of which exists yet; see the master design doc's
  section 7.2, real-time multiplayer explicitly rejected for v1).

- **Header redesign: portrait + inline XP bar + one-line tick bar.** User idea, 2026-07-07, with an
  exact ASCII mockup:
  ```
  [                    }  PlayerName - Level 1
  [                    }  Exp: [      ]-----------------]  10/100 [10.00%]
  [                    }

  TICK: [                                                                                       ] 2.1s
  ```
  A portrait placeholder on the far left (reusing the `.mission-portrait-frame` theme-aware
  placeholder pattern from the Fleet Operations Mission UI, once that ships), with two lines to its
  right: "{name} - Level {N}" and an inline "Exp: [bar] {current}/{max} [{percent}%]" (today's XP bar
  is stacked UNDER the "Fleet Admiral · Level N" line, not inline next to a label like this). Below
  that, a full-width "TICK: [bar] {seconds}s" row -- bar and elapsed time on the SAME line (today
  the tick bar's seconds readout sits on its own line below the bar).

  **Real open design work, not a quick add-on** (flagged rather than silently assumed, since the
  user suggested folding this into "the final task" of the in-flight Loot Tier Rework -- this is
  bigger than that plan's actual final task, which is docs-only):
  - There is no "Fleet Admiral Name" field anywhere in `GameState` today -- only `fleetAdminLevel`/
    `fleetAdminXp`/`adminPoints` (numeric progression, no name string). "PlayerName" in the mockup
    needs a new field (plus, presumably, somewhere for the player to actually SET that name --
    an input, likely in Options) and its own save migration.
  - Whose portrait is it? The mockup says "a portrait for your captain," but the Fleet Admiral
    level/XP bar is fleet-wide, not scoped to any one captain -- worth clarifying whether this is
    the currently-active captain (Fleet Captain's tab selection), a dedicated "admiral" persona
    portrait unrelated to any specific captain, or something else. No portrait ART exists anywhere
    in the game yet either way (same "placeholder now, real art later" situation as the mission
    cards).
  Not scoped yet -- needs its own brainstorm before a design/plan, given the new data field and the
  whose-portrait question above.

- **Landing Party missions.** User idea, 2026-07-07: a new mission type/category built around
  outfitting a team for planet-side (surface) adventures, distinct from today's ship-based ore-run
  missions. Could plausibly fit as its own new Fleet Operations mission category (alongside
  Resource-Gathering, Patrol Missions, Surveying, Long-Term Exploration -- see
  docs/plans/2026-07-07-fleet-operations-mission-ui-plan.md) or as content living under one of the
  existing locked categories (Surveying reads closest in spirit). "Outfitting a team" specifically
  means **item/equipment slots for the boarding party** -- a loadout system, not just picking which
  captain/crew go. The user explicitly flagged this same equipment-slot mechanic will ALSO be needed
  for Battlespace's Invasion mode (see the "Battlespace's 4 real modes" entry above -- "sector-space
  defense followed by planetary bombardment and ground troops"), i.e. troops landing during PvP would
  reuse the same item-slot system as PvE Landing Party missions -- worth designing this as one shared
  mechanic rather than two separate ones when the time comes. Not scoped yet -- no design work done
  on the actual slot count, equipment types/tiers, where equipment comes from (crafting? loot drops?),
  or how it interacts with a captain's existing Captain Talents.

- **Stats page / total played time (online + offline).** User idea, 2026-07-08: "I would also like to
  make sure that the stats page shows the total played time both online and offline... I love the
  stats and numbers." There is no dedicated "Stats" tab/panel anywhere in the game today. The
  underlying data mostly already exists -- `GameState.gameTimeSeconds` already accumulates across
  BOTH the live 100ms poll loop (`App.svelte`'s `setInterval`) and offline catch-up (the one-time
  `tick()` call at load) -- but nothing currently displays it anywhere. Not scoped yet: whether this
  becomes its own new tab, a section added to the existing Options/System sub-tab, or something else;
  whether "online vs. offline" needs to be tracked as two SEPARATE running totals (would need a new
  field, since `gameTimeSeconds` today is a single combined counter) or whether just showing the one
  combined total satisfies the request; and whether other stats (missions completed, total ore mined,
  captains recruited, etc.) should live on the same page once it exists.

- **Reputation system.** User idea, 2026-07-08: gate mission access on a fleet-wide reputation stat.
  Bad reputation opens up its own content (piracy, contraband smuggling missions) but also has real
  downsides -- periodic "bounty hunter" events that can trigger mission failure if the player isn't
  equipped to deal with them. Good reputation has its own (unspecified) perks. Not scoped yet: the
  actual reputation scale/range, how reputation is gained/lost (mission choices? specific mission
  types? both?), what "equipped to deal with" a bounty hunter event actually means mechanically --
  this may want to share the same equipment-slot/loadout mechanic already logged above for Landing
  Party missions and Battlespace's Invasion mode, worth checking when that gets designed -- what the
  good-reputation perks specifically are, and whether reputation is a single fleet-wide number or
  something more granular (per-faction?).

- **Offline-gains "welcome back" summary screen.** User idea, 2026-07-08: a proper popup/screen on
  load showing what happened while away -- time elapsed, XP gained, resources collected, missions
  completed, and (future) ships destroyed once combat exists. Today's offline handling
  (`src/App.svelte`, the one-time `tick(offlineSeconds, loadedSave.state)` call at load) only produces
  a single log line ("Welcome back. Advanced Ns offline.") -- no resource/XP/mission-count deltas are
  captured or surfaced anywhere. Related to the already-logged "stats page" idea above (both want
  before/after deltas across the offline catch-up), but distinct: this is a one-time on-load modal,
  not a persistent page. Not scoped yet: would need `tick()`'s offline call to return (or the caller to
  diff) a summary of what changed -- resources gained per material, XP gained, mission cycles completed
  during the catch-up -- none of which is currently tracked/returned separately from the final state.

- **Ambient background audio option.** User idea, 2026-07-08: an ambient soundscape toggle/option
  (space station hum, starship system noises, a few alternate loop choices) to play quietly in the
  background. Explicitly NOT scoped yet: the user still needs to source a licensed-for-free-use audio
  track (or several, if multiple ambience options are offered) before this can be built -- this is
  purely a placeholder for the feature idea, not a licensing/sourcing task for me to do. Once a track
  exists, likely lands as a new entry in the Options panel (`src/App.svelte`'s existing options/theme
  UI, alongside the theme picker) with a volume/mute control and probably an HTML5 `<audio loop>`
  element gated behind a user-initiated interaction (browsers block autoplay-with-sound until the user
  has interacted with the page at least once) -- worth checking that constraint when this gets designed.

- **Themed art via inline SVG in Svelte.** User idea, 2026-07-08: character portraits, mission
  thumbnails, and general iconography built as inline SVG rather than raster images, so the artwork can
  use `currentColor`/`var(--accent)`-style references into the existing `app.css` theme-token system
  (the same 6-preset custom-property scheme the chamfered-panel/corner-accent styling already reads
  from) and re-skin automatically whenever the player switches themes. Not scoped yet -- no target list
  of which UI elements get art first (captain portraits vs. mission-preview thumbnails vs. talent-node
  icons), no actual vector artwork drafted. Best suited to icons/simple thematic accents rather than
  complex illustration, given hand-authoring SVG paths takes meaningfully longer than sourcing images.

- **Homeworld Market (sell resources for credits).** User idea, 2026-07-08, surfaced during the Talent
  Tree Visual Redesign brainstorm: a market/trading UI on the Homeworld where existing resources
  (commonOre/uncommonMaterial/rareMaterial, and eventually refined goods) can be sold for the new
  `credits` currency introduced by that same branch (currently only earned via `creditsPerCycle` on
  mission completion). Not scoped yet -- no exchange-rate design, no UI location decided (likely a new
  Homeworld sub-tab), no decision on whether prices are fixed or fluctuate. Explicitly deferred so it
  doesn't block the talent-tree work, which only needs credits to exist as a currency, not a full
  economy around it.

- **Broader credits economy: Auction House + Bank, credit loss on death.** User idea, 2026-07-08,
  mentioned while discussing the respec-cost mechanic: an Auction House (presumably a player-to-player
  or NPC trading venue, distinct from the simpler Homeworld Market above), plus a Bank that protects
  credits from being lost -- implying some future "death"/failure-state mechanic that would otherwise
  wipe on-hand credits, with banked credits surviving it. Also implies the 50-credit respec cost is a
  placeholder that will need rebalancing once this broader economy exists ("that cost will eventually
  have to change though... once the economy is balanced out"). Nothing here is scoped -- no death/failure
  mechanic exists in the game today, no Auction House design, no Bank UI/mechanic. A significant future
  economy pass, well beyond the current Talent Tree Visual Redesign branch.

- **Radial Skill Web — deferred v1 refinements.** Logged 2026-07-08 during the Radial Skill Web design
  (`docs/plans/2026-07-08-radial-skill-web-design.md`). The v1 build is deliberately pan-only,
  hand-authored, single-elbow, lean-content; these were explicitly scoped out to keep an untestable
  (no browser on this machine) gesture/spatial build tractable:
  - **Zoom** — pinch-to-zoom on mobile, scroll-wheel / ± buttons on desktop. Deferred because
    fog-of-war keeps little on screen at once (zoom rarely needed), and a scale-transform layer would
    have to make elbow connectors + node hitboxes behave at every zoom level — all unverifiable here.
    Its own feature if it turns out to be missed.
  - **Pan momentum / inertia** — flick-to-glide after a drag release. Adds a physics/animation loop
    that can't be feel-tested on this machine.
  - **Smart obstacle-avoiding connector routing** — v1 uses simple single-elbow L-paths and relies on
    hand-placed coordinates routing cleanly; a real orthogonal graph router (A\*/channel routing that
    avoids crossing other nodes) is a genuinely hard diagramming problem, only worth it if manual
    placement stops scaling.
  - **Auto-recenter on newly-learned node** — v1 does nothing when a freshly-revealed node appears off
    the current pan viewport (it's adjacent to the just-clicked node, so it's nearby). Gently panning
    the camera to it is a feel-check better decided on a real device.
  - **The "lots of talents" density expansion + effect wiring** — the mockup's ~40-node density per
    tree, plus wiring the currently-inert talent effects (see `KNOWN_ISSUES.md`), grown per spec as
    each underlying system ships (combat/Battlespace → Tactician, a redefined Science mechanic →
    Explorer, etc.). The v1 framework supports adding nodes without touching rendering, so this is
    pure content/wiring work later, not a re-architecture.

- **Radial Skill Web tooltip — focus trap / restore (a11y).** Logged 2026-07-08 (Task 11 code review).
  The RadialWeb node tooltip is a portaled `role="dialog" aria-modal="true"` overlay, but it does NOT
  move keyboard focus into the dialog on open, restore focus to the originating node on close, or trap
  Tab within the dialog — so the `aria-modal` claim currently overstates the DOM behavior, and a
  keyboard user can Tab into the obscured content behind the backdrop. Escape-to-close works. Deferred
  from v1 (deliberately, alongside the other Checkpoint-A interaction polish); worth a focused a11y
  pass that adds focus-move-on-open, focus-restore-on-close, and a real focus trap to back the
  `aria-modal` attribute. Low risk (Escape already dismisses), but easy to forget once the visual pass
  "looks done."

- **North-star UI aesthetic: "futuristic console/touch display."** User's stated overall aesthetic goal
  (2026-07-08): the whole game should feel like you're operating a futuristic sci-fi console/touch
  display, with the UI's motifs reinforcing that diegetically. The Radial Skill Web's glowing nodes +
  directional energy-pulse links are a first expression of it. Concrete near-term wants folded under
  this: **panel fade in/out transitions on navigation** (a shared, reusable transition applied to every
  tab/panel change, not one-off per screen), and glow/pulse motifs reused elsewhere. Explicitly a
  FUTURE dedicated UI-refinement pass, NOT to be built piecemeal now — the user wants to finish
  foundational (gameplay-system) features first and then run a deliberate UI-polish flow that pulls the
  UI-tweak entries out of THIS file (this entry, the tooltip focus-trap a11y entry above, and others)
  and addresses them together, with input from Claude on additional "sell the console aesthetic" ideas
  at that time. Capture UI/aesthetic ideas here as they come up rather than chasing them mid-foundation.

- **Emissive edge-glow on panels/buttons (UI-wide).** User brainstorm, 2026-07-08, under the
  "futuristic console" north-star above: give panels, buttons, and similar UI surfaces a slight glow
  that extends the element's accent/border colour outward from its edge AND melds inward with the
  element's own fill colouring — so each surface reads as emissive "lit hardware" rather than a flat
  card. A global surface treatment (touches the shared Panel/button styling, not one screen), so it
  belongs in the dedicated UI-aesthetic pass, NOT built piecemeal mid-feature. Pairs naturally with
  the glow/pulse motifs already introduced by the Radial Skill Web. Floated as a "maybe" — capture,
  revisit in the UI-refinement flow.

- **"Library" / "Archive" tab -- account-wide stats / achievements / completion home.** User idea,
  2026-07-09: a dedicated top-level tab (working name "Library" or "Archive") that HOUSES the
  account-wide, cross-run meta content -- the achievements + "% game completion" tracker (see the
  "Player Stats / Achievements / Completion panel" and "Stats page / total played time" entries above)
  plus other whole-account stat-based things. It's the container/home those already-logged
  stat/achievement/medal ideas would live in, not a separate mechanic -- when that system is built, give
  it this tab. Not scoped: which specific stats/sections, the exact label ("Library" vs "Archive"), tab
  placement.

- **Ground combat + a multi-stage Battlespace assault flow.** User idea, 2026-07-09: a future
  ground-combat layer with a NEW set of characters (distinct from ship captains) who have their OWN spec
  system -- offense / defense / debuff-oriented specs, etc. -- organized into garrisons / platoons for
  ground assaults. Ties into the planned multi-stage battle sequence: Sector Space (with the Starbase)
  -> planetary defenses -> landing on the planet for ground combat. Would share systems with the
  already-logged "Battlespace's 4 real modes" (esp. Invasion: "sector-space defense followed by
  planetary bombardment and ground troops"), the "Landing Party missions" equipment-slot/loadout idea,
  and the "Crew system" (races/roles) entries above -- design the ground-troop + loadout pieces as shared
  mechanics when the time comes. Deep future: depends on Combat/Battlespace, Ships, and the Starbase all
  existing first. Not scoped -- pure direction.

- **Crew leveling, augmentation/cybernetics, and ship crew capacity.** User idea, 2026-07-09, raised
  during the Ships: Stats Foundation build -- extends the "Crew system" entry above, now with the ship
  system explicitly in mind:
  - **Crew leveling + rank-up:** crew members gain levels (roughly 1-10) and can rank up; the buff their
    role/seat provides IMPROVES with level/rank -- a leveled crew member is worth more than a fresh one
    (same "level your bench" incentive the Crew-station and Holocore ideas share). Needs a per-crew
    level/rank field + a curve, whenever the Crew system is actually built.
  - **Augmentation / cybernetics:** a NEW crafted item class, unlocked via Research (see the Research
    engine designed alongside the ships-stats-foundation feature, `docs/plans/2026-07-09-ships-stats-
    foundation-design.md`) and crafted, then installed on INDIVIDUAL crew members via their OWN per-crew
    equip slots (distinct from ship modules/equipment). Each augment gives a SMALL bonus to the SHIP the
    crew member is posted on -- so crew augmentation is a third bonus layer stacking on top of captain
    talents + ship modules/equipment. Reuses the Research + crafting chains rather than inventing a new
    unlock path.
  - **Ship crew capacity + maximum capacity:** ships gain a crew-capacity stat (how many crew can be
    posted, feeding the augment/role bonuses) AND a maximum-capacity stat (total bodies carried). Some
    FUTURE mission types would gate on capacity -- evacuation / transport / colony-settling missions
    selected by a captain would require a minimum crew and/or max capacity (e.g. "settling a colony
    needs N colonists of transport capacity"). Ties into the deferred "Landing Party missions" loadout
    idea and the Medical-transport Explorer hull bucket (crew-landing) documented in the ships-stats-
    foundation design. When the Crew system is built, add `crewCapacity`/`maxCapacity` as forward
    `ShipTypeDef` buckets, the same way `moduleSlots`/`equipmentSlots` were carried forward in that
    feature.
  - All deep-future: depends on the Crew system, Research, crafting, and the ship module/equipment
    framework all existing first. Not scoped -- captured so it isn't relitigated.

- **Ship salvage / sell.** Raised during the Ships: Stats Foundation build (2026-07-09): a way to salvage a
  hull for a PARTIAL return of its crafting materials (roughly ~60%, deliberately not 100% so building and
  scrapping isn't a wash), or sell it outright for `credits` -- both a way to free up ship-storage-capacity
  slots and to recover some value from a hull you no longer want. Depends on the crafting/Research economy
  (the going-forward acquisition method is a resource-cost build action, deferred). Logged in the design
  doc's deferred list (`docs/plans/2026-07-09-ships-stats-foundation-design.md`). Not scoped -- no salvage-
  rate, sell-price, or UI decisions made.

- **Ship storage-capacity growth.** Ships: Stats Foundation (2026-07-09): `shipStorageCapacity` starts at 8
  and is a FIXED cap this pass -- there's no in-game way to raise it yet. A future Sector Space / Starbase
  upgrade should grow it (the user's stated forward target is roughly ~50-100 eventually). Documented forward
  in the design doc; the cap field already exists, so this is a growth-mechanic add later, not a data-model
  change.

- **`minCargoRequired` mission gate.** Ships: Stats Foundation (2026-07-09): a forward `MissionDef` field
  letting a mission require a captain's hull to have at least a minimum cargo capacity to undertake it (the
  same "requires N ft^3 of hold" idea already logged in the older "Cargo capacity as a real ship stat" entry
  above, now with ships actually existing). Cheap to add -- a single optional field plus one eligibility
  check -- and unused until some mission actually sets it. Noted in the design doc's deferred list.

- **The 6 deferred hull buckets + ship modules/equipment/reactor + Research.** Pointer entry: this pass ships
  4 real hulls (General Freighter + 3 Prospector: Hauler/Runner/Prospector). The full 10-hull roster adds 6
  more documented-but-unbuilt buckets -- Tactician: Destroyer (glass cannon) / Battleship (tank) / Carrier;
  Explorer: Cruiser (long-haul + diplomacy) / Survey vessel / Medical transport (crew-landing) -- with
  Explorer/science hulls deliberately carrying MORE module slots as their identity. Alongside them: the ship
  **modules / equipment / reactor-core** framework (buckets already baked inert into `ShipTypeDef`/`Ship`),
  and the **Research** unlock engine that gates better ships/modules/tiers. All documented in the forward-
  compat section of `docs/plans/2026-07-09-ships-stats-foundation-design.md`. Research is the intended NEXT
  feature -- it's the ship-upgrade engine. (History note in that doc: this Research is NOT a revert of the
  Phase-4-cut generator-stack Research; see the doc's "History note" section.)

- **Captain-id scheme is length-derived (pre-existing, flagged during Ships Task 10 review).**
  `buyHomeworldTalent`'s `unlockCaptainSlot` effect computes a new captain's id as
  `nextId = state.captains.length + 1`. This is safe ONLY while the `captains` array is strictly append-only
  (which it is today -- there's no captain-removal or reorder mechanic anywhere). If a captain-REMOVAL or
  reorder feature is ever added, this will silently collide ids (delete captain 2 of 3, unlock a slot, and
  the "new" captain reuses an existing id). Fix BEFORE adding any such feature: switch captains to a
  monotonic id counter, exactly like the ships feature already did with `nextShipId`. Not a bug today --
  a latent trap gated on a feature that doesn't exist yet.

- **Unify the two mission-tick code paths (root-cause refactor).** Flagged by the Ships: Stats Foundation
  holistic review (2026-07-09). There are currently TWO copies of the per-captain mission-advancement math:
  the canonical `tick()` in `tick.ts` (used for offline catch-up + the dev simulate button), and a
  hand-maintained DUPLICATE inside `App.svelte`'s live `setInterval` poll (which drives the animated
  progress bars during normal play). Every change to `tickCaptainMission`'s inputs must be mirrored into
  BOTH, and the live copy keeps drifting: it already dropped the resourcefulness bonus-roll fields (5-field
  vs 8-field `bonuses` -- see KNOWN_ISSUES.md), and the ships feature initially dropped ship stats there too
  (fixed in `9fc67a6`). This is the SECOND stat category to fall through the same crack, so per Omega-10
  (Root Cause Protocol) the durable fix is to have the live loop CALL `tick()` (or a shared per-captain
  helper) rather than re-derive the math -- then the live path and offline path can never diverge again.
  Non-trivial: the live loop also handles per-poll animated progress, `anyFired`/copy-on-write semantics,
  and log emission, so it needs a careful pass to extract the shared math without losing the live-progress
  behavior. Its own focused refactor + device-check, not a mid-feature change -- but it's the real fix for a
  recurring class of "live loop drifted from `tick()`" bugs.

- **Save-file integrity / anti-tamper (with an important security caveat).** User idea, 2026-07-09: encrypt
  or sign the localStorage save (today it's just `LZString`-compressed base64 JSON -- trivially editable in
  devtools) to stop malicious actors tampering, since the game is eventually meant to be multiplayer. WORTH
  DOING for what it can actually do -- but the caveat matters and was flagged at capture time so it isn't
  built with false expectations:
  - **Client-side encryption/signing is tamper-RESISTANCE, not tamper-PROOFING.** Whatever key + algorithm
    encrypts the save ships INSIDE the client bundle, so a determined attacker extracts the key, decrypts,
    edits, and re-encrypts/re-signs. Obfuscation deters CASUAL cheating (devtools save-editing) and can
    detect corruption, but it cannot stop a motivated attacker -- the client fundamentally can't keep a
    secret from the machine running it.
  - **The real multiplayer-fairness answer is SERVER-AUTHORITATIVE state**: the server runs or bounds-checks
    the economy so a tampered client can't inject impossible values into anything that affects OTHER players
    (leaderboards, PvP, shared economy). HMAC-signing saves with a key held ONLY on the server is the middle
    ground, but that -- by definition -- requires the backend to do the signing/validating. So the anti-cheat-
    for-multiplayer goal is DOWNSTREAM of the backend/auth/cloud-save work already logged in the "Clerk-based
    auth (Vercel) + multiplayer" entry above; it is not solvable client-side alone.
  - Practical split: (a) local encryption/signature + corruption detection is a fine SINGLE-PLAYER integrity /
    casual-deterrent measure buildable anytime (relates to the corrupt-save-handling gap in KNOWN_ISSUES);
    (b) actual multiplayer anti-cheat waits for the server-authoritative backend. Don't conflate the two, and
    don't let (a) create a false sense of (b). Not scoped -- no crypto scheme, key-management, or
    server-validation design chosen.

- **Daily reward campaigns (daily-login rewards).** User idea, 2026-07-09: a daily-reward / login-streak
  system granting escalating rewards for consecutive days played -- credits (the user's example: 50 credits),
  materials, and eventually cosmetics/other goodies. Standard idle-game retention mechanic. Caveat (same
  family as the save-anti-tamper and redemption-codes notes above): a purely CLIENT-SIDE daily reset -- one
  that checks the local `Date` -- is trivially gamed by advancing the system clock, so a robust version needs
  a TRUSTED SERVER TIME SOURCE, downstream of the backend/auth work (see the "Clerk-based auth + multiplayer"
  entry). A client-only version is a fine casual first pass IF you accept the clock-cheese and don't let it
  grant anything multiplayer-competitive. Not scoped: the reward tier table, streak-based vs plain-calendar-
  day, missed-day/catch-up rules, and where it surfaces (likely a modal on load, sharing the same on-load-
  modal slot as the offline "welcome back" summary idea). Ties into: the credits economy, redemption codes,
  the offline welcome-back modal, and the future account/backend system.

- **Cargo & progression redesign (dedicated brainstorm — cargo-as-true-cap + mission cargo requirements).**
  Surfaced during the Ships: Stats Foundation playtest (2026-07-09): a Freighter (cargo 90) returned 94 total.
  Root cause (not a code bug -- the shipped design): `cargoCapacity` drives the extraction-phase LENGTH
  (`ceil(cargoCapacity / extractionRatePerTick)`), it is NOT a hard cap on returned cargo. So per-tick yield
  talents + the (now-live, post-bonus-roll-fix) resourcefulness bonus-roll push totals above nominal cargo.
  The user wants (a) cargo to be a REAL hold cap, and (b) missions to REQUIRE a minimum cargo/progress level
  to undertake (a real progression gate), BOTH "designed thoughtfully so it's not gimmicky." These are one
  mechanic -- brainstorm them TOGETHER, not piecemeal. This entry supersedes/absorbs the older terse
  "`minCargoRequired` mission gate" and the "Cargo capacity as a real ship stat" (headroom-above-baseline)
  entries above.
  - **Cargo as a true hold cap (the 94>90 fix).** Recommended direction, closed-form-SAFE: DECOUPLE the
    mission's guaranteed haul (which drives extraction length) from the ship's `cargoCapacity` (a hold cap
    with HEADROOM above the mission's base haul), then CLAMP total returned cargo at the ship cap. Then
    bonus-roll/lucky overflow lands up to the cap -- a Hauler (180) keeps big lucky hauls, a Runner (60) can
    OVERFLOW its small hold and lose the excess (a real, intuitive tradeoff), and a hull can never return
    more than its hold. This also turns cargo from the current "throughput-neutral" weak stat into a
    meaningful one, and changes the Hauler's identity from "longer runs" to "bigger hold" (arguably more
    intuitive). AVOID: (i) plain clamp at today's cargo=extraction-target -- base already fills the hold, so
    it just DELETES all bonus-roll loot (neuters Lucky Strike); (ii) the literal "stop extracting + return
    home early when the hold fills" -- that's an RNG-dependent stopping time that BREAKS the closed-form
    offline-catchup guarantee (it's the separately-deferred "farming efficiency run" mission type).
  - **Mission cargo requirements / progression gating** (the old `minCargoRequired` idea, now with a
    progression-gating purpose): missions require a minimum hull cargo -- or a broader progress level -- to
    undertake, gating advancement to harder content so the player has to build up first. Design the gate to
    feel like earned progression, not an arbitrary number wall.
  - Deliberately DEFERRED to its own brainstorm/design pass (user: "brainstorm later so it's not gimmicky").
    The current ships-foundation branch ships with cargo-as-extraction-length AS-IS (the 94>90 behavior
    stays until this redesign); this is the immediate fast-follow, not a blocker for the foundation.

- **Completions + Achievements + Relics + 100% Completion tracker (user, 2026-07-11) — consumers of the
  Lifetime Stats being reserved NOW.** These are DEFERRED future features; the ONLY thing being built now
  (folded into the Progression Pacing Rework + Phase 1 migration) is the `lifetimeStats` data layer they
  read, because lifetime totals CANNOT be back-derived (you spend/consume materials, so current inventory
  can't reconstruct "total ever refined") — not counting from now = every current player's history lost on
  launch. The consumers themselves back-compute from the stats on launch (a player already at 1M refined
  gets their tiers retroactively), so they need NO now-work beyond the counters.
  - **Completions:** per-item lifetime-total milestones (e.g. 100k / 1M / 10B / 100T / 1Qu — user wary of
    pushing thresholds too high) award tiers (bronze/silver/…). Each item gets its OWN permanent per-item
    completion bonus per tier hit. Example: refine 100k polysilicate → T1/bronze → +5% chance to yield a
    second bar free (no mats); each further tier adds +5% ADDITIVE. ⚠️ That free-output-chance is a
    bonus-output RNG hook on the crafting engine — must resolve in BULK for offline batches (same
    closed-form concern as the resourcefulness bonus-roll); Phase 1's timed-engine reserves this seam
    (mirrors the existing `recipeBonusOutput` seam in `craftRecipe`).
  - **Achievements:** unlock at the same milestone points; award a tiered **commendation** currency
    (bronze/silver/gold/platinum/diamond/…). Commendations are **tier-locked**: diamond commendations
    spend only on diamond-tier achievement bonuses, etc. Storage (a `commendations` per-tier balance +
    spent tracking) is added when Achievements ships — back-computed from lifetimeStats, so not needed now.
  - **100% Completion tracker:** a % across MANY dimensions — milestones hit, all upgrades owned,
    everything unlocked, all **relics** collected (relics = a NEW future collectible system, undesigned),
    etc. KEY distinction: most of these are CURRENT-STATE facts (owned upgrades, unlocks, relics) that the
    tracker just READS from the save when it ships — no now-counter, nothing lost. Only the cumulative
    lifetime totals need reserving now. ⚠️ Edge case to decide per-system: LOSABLE things where "ever
    owned" matters (respec-able talents already; sellable ships/relics floated) — if completion counts
    "ever owned each" rather than "currently own all," reserve an "ever-owned" set for those. Rec:
    "currently own" semantics unless a permanent-credit-on-first-acquire is explicitly wanted.
  - See the older "Player Stats / Achievements / Completion panel", "Stats page / total played time", and
    "Library/Archive tab" entries above — that tab is the eventual HOME for all of this.

- **Consolidate the whole-tick floor-boundary device in `tickCaptainMission` (deferred, low priority).**
  Flagged during the Progression Pacing Rework Task 4 build/review (2026-07-11). Captain-XP accrual counts
  whole ticks crossed with `Math.floor(progress + applied) - Math.floor(progress)`, computed just before
  the phase-progress advance in `tick.ts`. The `extracting` loot-roll block a few lines below recomputes the
  IDENTICAL expression (as `fromWhole`/`toWhole`/`rollsThisStep`) to decide how many extraction rolls to do.
  Two copies of the same closed-form device now sit in the same loop. Deliberately NOT consolidated inline:
  hoisting a single shared local up out of both would mean editing the delicate, closed-form, do-not-touch
  loot block — out of scope for a captain-XP-only change (Anti-Regression / One-Fix-One-Concern). The two
  extra `Math.floor` calls per iteration are negligible. Revisit ONLY if that loot block is ever refactored
  for another reason — at that point, fold both into one shared `wholeTicksCrossed(progress, applied)` helper
  (or a single hoisted local) so the XP count and the loot-roll count can never silently drift apart.

- **Per-slot Fleet-Admiral-level tooltip hint (captain-slot unlock UX).** Flagged during the Progression
  Pacing Rework (Session 27), which added FA-level "wall breaker" requirements (L1/L5/L25) to captain slots
  2/3/4 on top of the existing Fleet Logistics talent cost. Today the slot node's tooltip shows a GENERIC
  Fleet-Logistics hint, not the specific FA level THAT slot needs. Better UX: derive the exact required FA
  level from the mapped slot node at render time and show it in the tooltip (e.g. "Requires Fleet Admiral
  Level 5") — specific and never-stale, since it reads straight from the node's own requirement rather than
  a hand-written string that could drift if the walls are retuned (see the KNOWN_ISSUES entry noting L1/L5/L25
  are tunable starting values). Pure future UX polish, not scoped now: just a copy/derivation tweak on the
  RadialWeb tooltip, no data-model change.

- **[RESOLVED 2026-07-11] Facility-upgrade concurrency let you skip upgrade rungs (level-stacking exploit).**
  Flagged AND fixed during Phase 1 Task 10 (facility framework, `startFacilityUpgrade`/`canBuildFacilityUpgrade`
  in tick.ts). The concern: because a facility's `level` only bumps at process COMPLETION, an unrestricted
  "materials-only" concurrency gate let `canBuildFacilityUpgrade` keep reading the SAME `upgrades[currentLevel]`
  rung while a build was mid-flight — so a player could start the cheap level 0→1 build TWICE and land at
  level 2, SKIPPING level 1→2's higher cost + `requiresFleetAdminLevel`/`requiresHomeworldTalents` gates.
  RESOLUTION (coordinator decision, 2026-07-11): "unlimited concurrency" was only ever meant across DIFFERENT
  facilities (and refine jobs, which parallelize by slot), not stacking the SAME facility's sequential rungs.
  `canBuildFacilityUpgrade` now has a SEQUENTIAL-PER-FACILITY gate — if any active process is a
  `facilityUpgrade` whose `effect.facility === facilityKey`, it returns `{ ok:false, reason:"Upgrade already
  in progress" }`. The in-flight rung must complete (bumping `level`, advancing to the next rung) before the
  next is buildable, so every rung's real cost/gates are paid in order. The gate keys ONLY on
  `effect.facility === facilityKey`, so distinct-facility concurrency is untouched, and refine jobs (kind
  `refineJob`) are never matched. Covered by facility.test.ts (blocks a second same-facility start, re-opens
  after completion; a distinct facility is not blocked).

- **Refinery batch/continuous refine ORDERS — the count-N + continuous auto-repeat with per-iteration
  atomic deduct + closed-form offline-bulk (design §6).** Deferred from Phase 1 Task 11 (single manual
  jobs shipped first) as the highest-complexity, no-typecheck-risk piece — do next, ideally with Node
  for the real test run. Task 11 shipped ONLY single manual refine jobs: `startRefineJob` starts exactly
  ONE `refineJob` process per call (one slot, one iteration). The deferred order system makes a slot run
  an ORDER, not a single job: enter a **count N** (loop N iterations, then idle) OR set it **continuous**
  (repeat until toggled off). Each iteration deducts its inputs at ITS OWN start (per-iteration atomic,
  design §4) and produces one output before the next begins — so only the actively-running iteration is
  reserved, never the whole batch. **Material exhaustion:** if the next iteration can't afford its inputs,
  the order pauses (idle) and auto-resumes when materials are available again (recommended — needs a cheap
  per-tick affordability recheck on idle orders); alternative is a hard-stop needing manual restart (decide
  in design). **Offline resolution stays closed-form:** iterations over elapsed E =
  `min(remainingCount, floor(E / durationTicks), min over each input of floor(available / perIteration))`,
  then bulk-apply (deduct iterations×inputs, add iterations×output, award iterations×`durationTicks` FA XP,
  and increment `lifetimeStats.itemsRefined` by iterations×output) — deterministic, no per-tick simulation.
  This is the biggest closed-form-math risk in the epic and the one most in need of a REAL test run (Node),
  so it was split out from the shippable single-job core rather than bundled into a no-typecheck build.

- **Fabricator build-to-target auto-chain (Option 3, deferred — user 2026-07-16).** Deferred from the
  Fabricator brainstorm (`docs/plans/2026-07-16-fabricator-design.md`) in favor of the Refinery-style
  order/slot mechanic (Option 1). The idea: instead of the player manually crafting intermediates then
  the final component, they set a TARGET ("I want N `structuralAssembly`") and the Fabricator computes the
  whole blueprint dependency chain (e.g. `structuralAssembly` needs 2 `frameSegment` + 1 `powerCoupling` +
  refined mats) and auto-crafts the intermediates first, then the assembly — anticipating ship
  bills-of-materials for the future Shipyard. Notably more complex than the flat per-blueprint order UX
  (recursive BOM expansion, a multi-stage order queue, and offline-bulk resolution across a DAG of crafts
  rather than a single recipe), and a different UX from the Refinery — so it's a follow-up, not the first
  Fabricator pass. Build the flat order system first; layer auto-chain on top once components have a real
  sink (Shipyard) and the BOM shapes are known.

- **QUEUEING BUILD ORDERS + AUTOMATION (umbrella idea, user 2026-09-01; FUTURE, NOT SCHEDULED, FORM TBD).**
  User: "An idea for the future. I'm not sure if I will implement it, or when I do, in what form. Queueing
  build orders / automation." This is the general umbrella over several facets ALREADY logged as separate
  entries: the Refinery batch/continuous ORDERS + the Fabricator build-to-target auto-chain (both above),
  the salvage-as-timed-QUEUE + its shared order engine, and the auto-salvage RULES (all ~lines 1004-1007).
  What it ADDS beyond those: extend queueing to **BUILD orders that are currently one-at-a-time**, i.e.
  FACILITY UPGRADES (one in-flight per facility today, gated by `canBuildFacilityUpgrade`) and SHIP BUILDS
  (per shipyard bay) — let the player line up "upgrade Refinery to L5" or "build 3 frigates" and have each
  auto-start the next when the running one completes. Plus a general AUTOMATION layer (opt-in rules that
  auto-queue when conditions are met), of which auto-salvage is the first instance.
  - **Why (fits the core value):** automation is the ultimate click-reducer; it is squarely
    [[feedback_build_ease_of_use_sell_peace]] (fewer clicks, no babysitting, background progress).
  - **Design landmines to settle when picked up (do NOT hand-wave):**
    1. **Reservation timing.** Reserve materials/credits at QUEUE time (safe, but locks resources) or at
       each item's START time (flexible, but a queued item can find itself unaffordable)? The existing gates
       are reservation-aware; a multi-item queue must pick a policy and show it, or a queued build silently
       stalls. The refinery-orders entry already leans "per-iteration atomic deduct at each start + pause
       + auto-resume on affordability"; keep that pattern for consistency.
    2. **Parity-safe auto-start-next.** Offline == live is a hard invariant (resolveProcesses/tick). Any
       "when process A completes, auto-start process B" MUST happen INSIDE the shared resolveProcesses path
       (and resolve closed-form across long offline gaps), never in a UI-only handler, or offline and live
       diverge and the parity suite breaks.
    3. **Peace test.** Automation is PRO-peace ONLY while it is opt-in, default-off, clearly shown, and
       never spends resources the player was hoarding or makes a surprise irreversible move (respects the
       [[feedback_build_ease_of_use_sell_peace]] "chosen, recoverable risk" refinement). An always-on rule
       that quietly drains credits is a peace violation.
    4. **Share ONE order/queue engine** across refinery, fabricator, salvage, facility upgrades, and ship
       builds rather than a bespoke queue per facility (the salvage entry already calls for this). The build
       order across the 0.13.x cluster is: shared order engine first, then per-facility UIs, then automation
       rules on top.
  Given the crafting-side facets are already slated for the 0.13.3 crafting overhaul, the BUILD-order +
  general-automation extension is a natural POST-0.13.3 follow-up (or its own later .x), but explicitly
  left unscheduled/form-TBD per the user.

- **Re-wire the industry Homeworld-talent branch to buff the new Fabricator (2026-07-16, from Fabricator
  Task F5).** Retiring the legacy `RECIPES` instant-craft (F5) orphaned the `recipeBonusOutput` talent
  effect, which only ever buffed the legacy `fabricateComponents` craft. Its two industry-branch nodes
  (`industryHub`, `industryBonusOutput`) were retargeted to the existing `{ type: "none" }` "No bonus yet"
  placeholder (nodes/graph/spent points preserved — talents store by key, no migration) rather than
  deleted. So today those two nodes are honestly inert. The natural re-wire: a NEW talent effect giving a
  bonus-output CHANCE on Fabricator crafts (thematically perfect for an "industry" branch). ⚠️ NOT a
  trivial add — a bonus-output RNG hook on the craft engine MUST resolve in BULK for offline batches (the
  exact closed-form concern the resourcefulness bonus-roll had incidents over, and the same
  Completions "free-output-chance" seam already reserved elsewhere in this file). Do it as its own careful
  task with an offline-parity test. Until then the industry branch reads "No bonus yet" (consistent with
  the Homeland Defense / Citizenry placeholder hubs).

- **Play-simulator / progression-pacing model for balancing (user 2026-07-16 — PARK for the balancing
  phase).** A tool that simulates the player experience and reports how long it takes to reach each
  milestone (specific unlocks/upgrades, one after another) — e.g. "Warehouse T2 @ ~40m, Research Lab @ ~2h,
  first Fabricator craft @ ~5h, ...". Explicitly a FUTURE project for the proper balancing phase, not now.
  **Why this game is unusually well-suited (and the recommended shape):** the economy is already CLOSED-FORM
  and offline-parity-proven — `tick()`/`economyTick` (tick.ts) is a pure deterministic state-advance. So the
  sim is NOT a from-scratch build; it's a HEADLESS harness that drives the existing engine (no rendering,
  millions of ticks in ms). Recommended flavor: (1) a **deterministic policy sim** — a headless script that
  plays via a *player-policy model* (heuristic: keep captains on missions, refine/craft toward the next
  gate, buy the cheapest next unlock, research in order), stepping economyTick and logging the tick each
  milestone is hit → a timeline, diff-able across balance changes; (2) a **Monte-Carlo overlay** for the
  loot RNG → p50/p90 time-to-milestone distributions. **The hard/real-project part** is the player-policy
  model (what a reasonable player does, in what order) + instrumenting the milestone list — the engine and
  offline-parity come for free. Preferred over a standalone spreadsheet/closed-form model precisely BECAUSE
  the exact engine already exists (a spreadsheet would re-derive it and drift from the real code). Needs its
  own brainstorm/design pass when the balancing phase starts: the policy heuristic, the milestone registry,
  the output format (timeline / distribution), and where it lives (a headless `npm run sim` script reusing
  the game modules). Ties into: the device-checkpoint tuning notes scattered across KNOWN_ISSUES (craft
  durations, tier costs, slot rungs, FA-XP curve) — the sim is how those get calibrated coherently instead
  of one-at-a-time.

- **Unify ALL material consumers on the `free` allocation model (2026-07-16, from the Crafting Allocation Redesign
  holistic review).** The Phase-4b redesign introduced `free = total − reserved` (reserved = Σ active craft lines'
  `remaining × inputs`, in `allocation.ts`), but deliberately scoped it to craft-LINE starts + the affordable-now
  quantity cap + the item tooltip + fuel. Other material consumers still read RAW `inventory[item]`: notably
  `canBuildFacilityUpgrade`/`startFacilityUpgrade` (consume `commonOre`/`refinedMaterial`, which overlap refine-line
  inputs — see the KNOWN_ISSUES entry), and eventually the **Shipyard** (consumes components — which overlap
  fabricate-line outputs, and once ship-builds reserve materials the same double-reserve question arises), and any
  future material-costed Research. The clean unification: a single `spendGate(state, itemId, amount)` /
  reserve-aware consume that every material spender routes through, checking `freeItem` (strictly ≤ raw, so it only
  ever tightens). ⚠️ Do it as one coherent pass so the "reserved materials are protected" promise holds everywhere,
  NOT piecemeal — and it's the natural thing to settle WHEN the Shipyard lands (the next new consumer), since that's
  when the question stops being theoretical. Until then, facility upgrades can quietly spend reserved ore (no
  corruption/softlock, just a stalled line — documented in KNOWN_ISSUES).

- **Away Missions — randomly-generated dungeon crawls with turn-based combat (user 2026-07-16, TABLE for down
  the line).** A new active game MODE: you send crew on an **Away Mission** (gated by **away-mission slots** that
  come from the [[Crew system]] — the crew on board fill these slots), which drops you into a **randomly-generated
  dungeon** you navigate room-to-room by clicking directional arrows / hitting the cursor keys. Rooms contain a
  proper **turn-based RPG battle system** (user is explicit: turn-based, "the only good one haha") and yield
  **potentially great item rewards** (feeds the equipment/loot economy). Deep future — depends on the Crew system
  existing (slots + who you send + their stats), plus a from-scratch **turn-based combat engine**, a **dungeon
  generator**, and room-navigation UI + a **loot table** system.
  - **Cross-links (design as a shared family when the time comes):** the equipment/loadout mechanic overlaps the
    logged **Landing Party missions** (item slots for a planet-side team) and **Battlespace Invasion** (ground
    troops); the fighters overlap the **Ground combat** entry (ground characters with offense/defense/debuff specs,
    garrisons/platoons). Away Missions are plausibly the PvE, single-player expression of that same ground-combat +
    loadout family — build the turn-based-combat engine + equipment slots ONCE and reuse across Away Missions /
    Landing Party / Invasion, not three times.
  - **⚠️ Architectural flag (important):** unlike EVERYTHING built so far, a dungeon crawl is **active, interactive,
    session-based play** — it does NOT fit the game's closed-form / offline-tickable model (you can't advance a
    click-through-rooms turn-based fight during offline catch-up). So Away Missions are something you actively DO in
    a session, a mini-game bolted onto the idle loop, with its own real-time-ish state that pauses when you leave —
    a genuinely different interaction paradigm from the tick economy. Worth deciding early how an in-progress away
    mission interacts with the offline model (freeze/resume? abandon? a soft time limit?). Its own full brainstorm
    when the Crew system + a combat engine are on the table.

- **Game Dashboard / Command Home -- the default landing screen (user 2026-07-16, LIVING entry -- update as
  systems ship).** A single at-a-glance hub that is the DEFAULT tab the player lands on, aggregating "all the neat
  stuff in one place." This likely SUPERSEDES / fills the emptied Homeworld Overview placeholder (the legacy
  inventory panel was removed in Fabricator F5, leaving Overview as a deliberate "fleshed out later" shell), or
  becomes its own top-level default tab. Sections the user named:
  - **Current statuses** -- fleet/economy at a glance (credits, fuel + the fuel-runway readout, active missions,
    active craft lines, FA level/XP, etc.).
  - **Game news** -- the latest patch notes / what's-new strip (already sourced from `patchNotes.ts`).
  - **Current situation with QUICK-NAV** -- surfaces what needs attention (e.g. which facilities are IDLE -- free
    refine/fabricate slots, an unused research/fuel slot) and lets you CLICK straight through to that facility's
    screen. Idle-detection is derivable from current state today (refineLines/fabricateLines vs slot counts,
    research/fuel activity, captains not on missions); the click-through needs nav hooks into the tab/facility rail.
  - **Player Score** -- a COMPOSITE number from achievements + % completion + other game stats. ⚠️ This section is
    DOWNSTREAM of systems that don't exist yet (see the logged "Player Stats / Achievements / Completion panel",
    "Completions + Achievements + Relics + 100% Completion tracker", "Stats page / total played time", and
    "Library/Archive tab" entries -- all fed by the `lifetimeStats` layer already being reserved). Early dashboard
    versions show the score sections that CAN be computed and grow the composite as those systems land.
  - **Default-landing / layout change:** making this the tab you START on is a navigation + layout change (today the
    game lands elsewhere), and a proper dashboard grid differs from the current facility-panel layout -- a QOL/UI
    pass, explicitly "for later." MOCKUP-GATED when built ([[feedback_visual_ui_needs_mockup]]) -- a dashboard grid
    is exactly the spatial-layout class of work that needs a sketch first.
  - **Nature:** a LIVING aggregator -- each new system (Shipyard, Crew, Combat, achievements...) adds its own status
    widget/quick-nav here, so this entry gets revisited/expanded as the roadmap progresses, not built once. Ties to:
    the offline "welcome back" summary (current-situation deltas), the credits/stats economy, and the whole
    stats/achievements/completion family above.

- **Tab restructure: fold Battlespace INTO Operations, and put the Dashboard first (user 2026-07-16).** Two connected
  moves. (1) **Condense Battlespace into Operations** as its own SECTION, separate from the Missions section -- the 4
  Battlespace modes (Fleet Skirmishes / Campaign / Fleet Exercises / Invasion -- see the "Battlespace's 4 real modes"
  entry above) are genuinely "operations," just COMBAT ones vs resource missions, so Operations becomes "what your
  fleet does = Missions | Battlespace." This retires the standalone Battlespace bottom-nav tab and FREES a tab slot.
  ⚠️ When built: combat is a big system, so its section needs its own sub-nav for the 4 modes (a peer to the Missions
  section), not a cramped afterthought. (2) **That freed slot → the Dashboard as the FRONT / DEFAULT tab** -- the
  whole-game-state overview (see the "Game Dashboard / Command Home" entry directly above) becomes the first thing you
  land on. **Tab NAME -- open (user unsure):** it's the whole-game-state overview / default landing. Candidates floated
  2026-07-16: **Bridge** (recommended -- diegetic "oversee the fleet from the bridge," short, sci-fi), **Overview**
  (plain/clear), **Flagship**, **Sitrep**/**Situation** (status-report flavor). ⚠️ AVOID "Command" -- already the
  captains/admiral tab (would need renaming to reuse). Both moves are QOL/layout, MOCKUP-GATED
  ([[feedback_visual_ui_needs_mockup]]), and land whenever the Dashboard + (for the Battlespace fold) Combat are built.

- **✅ SHIPPED in 0.10.1 (2026-07-17).** Built as the update-detector: per-build `__BUILD_ID__` + emitted
  `version.json` (poller in `src/lib/updateDetector.ts`, banner `src/UpdateBanner.svelte`, mounted in Root).
  Dismissible frosted banner with Export save / Refresh / snooze (~3h re-nag). See
  `docs/plans/2026-07-17-update-detector-design.md`. Original entry kept below for the record.
- **"New version available — refresh" detection (user 2026-07-16, candidate for early 0.11.0 or a quick
  standalone patch).** Detect a fresh deploy CLIENT-SIDE and prompt the player to refresh, so they get updates
  (and bug fixes) without manually reloading a stale build. Directly reinforces the "refresh to recover if stuck"
  safety net (the recall-on-cap fix + chained save migrations mean a reload recalls any stuck captain AND migrates
  the save forward — a refresh is always safe + recovers). **Approach (simple, NO service worker):** emit a
  build-version marker at build time (reuse `APP_VERSION`, or a build hash / small `version.json` written by the
  build), have the running client POLL it every few minutes (cache-busted fetch), and when the fetched version
  differs from the one the client BOOTED with → show a **dismissible banner "A new version is available — Refresh"**
  (optionally auto-reload after a grace period). ⚠️ Prefer a friendly BANNER over a hard forced reload; the game
  auto-saves so a reload is data-safe, but a prompt is nicer than yanking the page mid-action. Low-risk, high-value,
  small — a good early pickup. Ties to the deploy cadence: every staging→prod (or staging) push produces a new build
  the poll would catch.

- **Shipyard: show a ship's default stats BEFORE building (user 2026-07-21).** In the Shipyard build
  view, wherever a ship's Build button appears, show that ship's DEFAULT stats in the same section so the
  player sees what they are getting before committing to build. Must apply to ALL ship types, present and
  future, so it reads from the hull/ship stat definitions (already exist, ships/stats foundation) rather
  than being hardcoded per ship. Purpose: informed build decisions before spending. Scope: a build-panel
  presentation addition, no economy change; reuse the 0.11.0 Ship Systems stat vocabulary and the
  EquipmentTooltip stat-display patterns for consistency. Likely small and lightly mockup-gated. Not
  scheduled yet; a good candidate near a Shipyard or ship-stats pass.

- **Full FA-XP / economy balance pass (future, user 2026-07-21).** The 0.12.1 curve (base-750
  quadratic + substantial finite-source FA XP) is a TEMPORARY unblock so players can reach
  content gates (e.g. Shipyard needs FA level 3) without a multi-day grind. The REAL balance
  comes once talents are built out and the economy is fleshed. Known future intents: RESEARCH
  upgrades should eventually grant LOTS of FA XP; ship construction gets real timers (tier-1
  hulls ~20 min, everything above much longer, likely ~6 hours for the first tier-2), which
  reshapes the FA/crafting income curve. Revisit the curve base + per-source awards then.

- **Recent-events log on the Home overview (user 2026-07-21).** The Home > Overview page (a
  bare welcome placeholder today) should host a small "recent events" log surfacing only the
  IMPORTANT beats over a play session: a research completed, a facility/storage/docks upgrade
  finished, a ship finished construction, etc. Short, scannable, most-recent-first. Ties into
  the timed-process completion events (resolveProcesses) and the ship-build/research completions.

- **Save-game NUKE / server-side version gate (user 2026-07-21, PRE-BALANCE-PATCH REQUIREMENT).**
  Before the real balance patch starts, we need a way to invalidate all existing saves so testing
  starts clean: announce "in 24 hours all saves are nuked and old saves will no longer load," and
  once live, a save whose game-version predates the cutoff is REFUSED on load. ⚠️ The version-cutoff
  check MUST be SERVER-SIDE so it cannot be trivially poked/edited client-side (a client-only check
  in the SPA is defeatable). This needs backend support the game does not have yet (currently a
  static client-side SPA on crystalisoft.com; /version.json is a static file, not a validator), so
  it depends on standing up a small server-side endpoint (min-viable-save-version) the client checks
  on load and refuses below. NOT needed yet; build it just before the balance patch begins.

- **SVG animated battle screen -> future "2.0 active-play combat" mode (user 2026-07-21).** A little
  battle viewport: combatant icons moving around, weapons firing with PER-WEAPON-TYPE graphics
  (each weapon type its own visual), last-one-standing wins. Deferred DELIBERATELY out of the
  0.13.0 combat feature: regular combat ships as a headless deterministic AUTO-RESOLVE (compute
  outcome + rewards, no animation). This visualization belongs to a later "active play" mode where
  the player is present and engaged, not idle. Feasibility (confirmed): SVG is a great fit for a
  handful of entities (Svelte binds reactive state -> SVG nodes; per-weapon graphics = small SVG
  components; themes off existing tokens; RadialWeb is SVG precedent). The ONLY hard requirement to
  keep 2.0 cheap: 0.13.0's combat resolver stays DETERMINISTIC + SEEDED (required for offline parity
  anyway) and its outcome is structured enough that a future replay layer can plug in. The animation
  is then a pure cosmetic REPLAY of a seeded event log, never the source of truth (same "presentation
  is a projection of the sim" pattern as fuel-runway / XP parity). Do NOT build any event-log or
  animation machinery in 0.13.0; just do not paint the resolver into a corner.

- **Faction Reputation system -> future, post-combat (user 2026-07-22).** Reputation per faction; low rep triggers escalating consequences:
  - **Severe (very low rep):** a BOUNTY is placed on you and your CAPTAIN can be destroyed (captain-specific death -> ties to the future captain-death + crew-promotion turnover; needs the monotonic captain-id counter combat is already adding). A **Diplomacy spec** could grant account-wide reputation-gain bonuses.
  - **Moderate (bad but not worst, the user's FAVORITE):** that faction's LAW ENFORCEMENT randomly attacks you during their missions. Lose the fight -> you're hauled in and INCARCERATED for X ticks scaled by rep level; serving it RAISES your rep. Player should get an option to SURRENDER or make REPARATIONS instead of fighting. On capture: ship IMPOUNDED + captain in PRISON for a duration (up to ~a day if rep is bad enough).
  Depends on: factions, the Diplomacy spec, captain death, and the reputation axis itself. All future; capture the hooks (faction ids, a rep scalar) opportunistically but build none of it in 0.13.0.

- **Celestial-class ship naming: apex = "Jupiter-class" (user 2026-07-23).** The Celestial line of ship
  classes has its apex/flagship tier named **Jupiter-class**, named after the user's "best boy himself"
  (his dog Jupiter). A hard, sentimental naming lock for the top of the Celestial scheme when the full
  ship roster / class-naming themes are built out (see the ship-class-naming notes and the apex-class
  ideas in docs/plans/2026-07-18-ship-class-naming-notes.md). Not needed for 0.13.0 combat v1 (which
  ships destroyer/battleship/carrier as first-pass hulls), but LOCK Jupiter-class = Celestial apex for
  the future naming pass.

- **Renamable ships (user 2026-07-29, "add into combat too", does NOT have to be now).** Let the player christen individual ship hulls with a custom name (navy-style, e.g. "USS Enterprise"), mirroring the captain-rename feature. Ships today have NO per-instance name: `ShipInstance` is identified by type + id and displayed only via `SHIP_TYPES[typeKey].label`. Needs: an optional `customName` field on `ShipInstance`; a rename UI (Drydock/Shipyard, reuse the captain-Rename-panel idiom); a `validateShipName` chokepoint mirroring `validateCaptainName` (length/charset/trim + in-house profanity blocklist, the same server-moderation seam for 0.14.0); and surfacing the name in the **combat view** (the player combatant currently uses the CAPTAIN name via `nameFor`, so a christened ship name would read even better in the arena + log), plus the fleet/Drydock lists and dispatch cards. Slot during "the rest of the [combat] process" (P13/P14 polish, or alongside weapons-as-gear ship customization). Pairs thematically with captain identity (combat Phase 1). Expected small: a model field + a UI panel + a validation chokepoint; use an optional/absent-default `customName` to avoid a SAVE_VERSION bump (or bump + backfill if a required field is cleaner).

- **Easter-egg encounter + achievement: "Hack the Gibson" (user 2026-07-29, for later; Hackers 1995 reference).** A RARE combat encounter against a ship with "Gibson" in its name (the film's supercomputer). GATING: only a ship carrying a system-HACK MODULE (a module/weapon that inflicts a disruption) on a combat mission of CERTAIN TYPES can roll the rare "Gibson" encounter. The Gibson has an INNATE higher disruption-RESIST (it is hard to hack). If the player's hack module SUCCESSFULLY lands its disruption on the Gibson, unlock the achievement **"Hack the Gibson"**, flavor: *"While you didn't hack a planet, you're still zero-cool enough in my book."* (the "Zero Cool" handle from the film). The achievement LIKELY grants a small permanent disruption-success-chance bonus (an achievement-reward, same idiom as the planned +iLevel-to-crafted-projects achievements). DEPENDS ON: hack modules / disruption-inflicting weapons (the EW/disruption system exists in 0.13.0, S5, so the mechanic is partly there); NAMED/RARE encounter rolls (faction/encounter content, future); the ACHIEVEMENT system + achievement-reward hooks; and encounter-gating by installed-module + mission-type. All future; ties to the disruption system (S5) and the difficulty/encounter + achievements roadmap.

- **Accessibility + theming options roadmap (user 2026-07-29).** The Options screen grows into a real accessibility + theming hub. Confirmed direction:
  - **Accessibility options (priority, always FREE):** the 0.13.0 combat-log options (Simplified log style + damage-type color-coding) are the FIRST bricks. Eventual **high-contrast mode** + "many other options". Build the combat-log-options section EXTENSIBLE so these slot in.
  - **Pride themes, included FREE for anyone (explicit user value, NOT a paid option):** a **Trans pride** theme and an **LGBT pride** theme. Inclusivity is a deliberate product stance; do not paywall identity or accessibility.
  - **Paid tier = specialty COSMETIC layouts** (eventual): custom layouts adding special GLOWS + TRANSITIONS + effects. This is the monetization surface (cosmetic flair), kept SEPARATE from accessibility + pride, which stay free. Ties to [[project_fleet_admiral_online_strategy]] (cosmetics-fund-indies monetization; entitlement-gating only needed once selling).

- **EXPLORATION system (user 2026-07-29, FUTURE, after combat + online are done).** A per-mission completion-percent exploration layer where each run is made unique by some fun per-mission mechanic (exact "fun way" TBD). Starts with THREE mission types:
  1. **Local Survey** = short-range planetary gathering for ORGANIC components. Likely folds into a Forager/Prospector-spec update (planned: make Prospector more unique).
  2. **Full Planetary Survey** = a multi-task planet-completion setup (below).
  3. **Long-Range Exploration** = long travel distances; exploration ships carry MASSIVE fuel. Feeds the "unknown relics" system (below).
  - **Travel is symmetric + real-time:** flying to the system is part of the mission; RECALL means travelling back. If the trip out is 3000 ticks, you don't get the captain back for 3000 ticks of return. On arrival you begin exploring the planet.
  - **Planetary completion:** every survey reveals a TINY cumulative percent of the planet (e.g. +0.002% each). Most surveys yield very little: some survey data, maybe organic components, sometimes a lead toward a crafting/research RECIPE discovery.
  - **Per-planet task structure** (a science team's studies, each awarding different things): mineral surveys, flora surveys, other studies, and ARCHAEOLOGICAL surveys. A UI screen shows the collection (totals, bonuses, set-bonus levels).
  - **TWO DISTINCT COLLECTIBLE SYSTEMS:**
    - **ARTIFACTS (from planetary archaeological surveys).** Each planet/set has an ordered roster of artifact types with rarities (early game: 3 = common/uncommon/rare; late game example: 6 types). Archaeological finds are GATED by planetary completion % (example: uncommon unlocks at 35% planet completion, rare at 75%); once unlocked you keep finding until a per-type MAX. Each artifact gives TWO reward layers:
      - (a) **Per-copy passive:** each copy found adds a tiny stat (e.g. +0.001 to some stat), stacking with every copy.
      - (b) **RELIC BONUSES (nested set bonuses that LEVEL UP).** Owning enough DISTINCT artifact types unlocks nested set tiers: a K-piece "Relic Bonus" for K = 2..N (2-piece, 3-piece, ... up to N-piece), each K-piece requiring artifacts 1..K. Each Relic Bonus tier LEVELS UP as you accumulate COPIES on a DOUBLING threshold ladder (example: 10 / 20 / 40 / 80 / 160 copies -> successive levels), and each level adds its per-level bonus ADDITIVELY (e.g. base 0.005/level: at the level-2 threshold the 2-piece bonus gives 0.010). **BOTTLENECK RULE (the crux):** a Relic Bonus tier's level = the level supported by its LEAST-collected required artifact. Worked example: with 160 copies of artifacts 1-5 but only 159 of artifact 6, every tier through the 5-piece is at the 160-copy level, but the 6-piece tier is bottlenecked by artifact 6 (159 < 160) and stays one level below (needs 160 of ALL its required artifacts, including artifact 6). ⚠️ **PIN AT DESIGN TIME:** the exact leveling CURVE + how a tier's level scales with its size (the user's worked-example level numbers like "set 2 = level 8, set 3 = level 4" were loose/inconsistent placeholders; the doubling-copy-ladder + least-collected-bottleneck are the firm concepts, the precise numbers are not).
    - **UNKNOWN RELICS (from long-range exploration; SEPARATE from artifacts).** A FIXED roster (set numbers), each with a set find-chance. Instead of stacking set bonuses, you RESEARCH each unknown relic to unlock things: crafting RECIPES, powerful bonuses, etc. (a discovery/tech-unlock collectible, not an accumulation one).
  - **Reuse opportunity:** the artifact Relic-Bonus set system parallels the deferred equipment set-bonus hooks (setId / set tiers / chase affixes noted in the combat deferred list); share infra where it fits. Ties to Prospector/Forager rework, crafting + research (recipe discovery), and the captain-travel/recall model. Build NONE of it until combat + online ship.

- **OFFLINE MODEL: two modes (team decision, user 2026-07-30).** The offline question resolved to TWO modes, OPTION 1 default + OPTION 2 opt-in.
  - **Option 1 (DEFAULT): passive offline progression + a "While You Were Away" summary.** This is the current model + P13. The summary content (refined per the user's spec, being built now as a P13 refinement): missions completed BROKEN DOWN BY TYPE (combat, gathering, etc.); Fleet Admiral EXP gained (+ levels); per-captain EXP gained shown as a shortened int (e.g. "10M") plus levels gained (+N), in compact rows that fit all captains (the user's stated worry: fitting 10 captains); and all items received shown as the item ICON + the number gained.
  - **Option 2 (OPT-IN, NOT built, FAST-FOLLOW candidate): BONUS TICKS.** Instead of passive offline progression, when enabled the player ACCRUES a pool of bonus ticks while away (starts at 50% of offline time, FA upgrades add ~+5%/level up to ~75%). The player ACTIVATES the pool on demand to accelerate ACTIVE play via a TICK MULTIPLIER (FA upgrades grant higher multipliers, e.g. x10): with x10 active, each real tick counts as 10 ticks and 9 are drained from the pool, so a long timed job (a 6h ship build) finishes in a fraction of the real time. UI: a bonus-tick pool readout + a multiplier selector + the FA upgrades that grow the accrual rate + the max multiplier.
  - **⚠️ WHY OPTION 2 IS THE ELEGANT COST-SAVER (resolves the earlier concern):** it needs NO offline battle/economy SIMULATION on load, offline just banks a pool number (`pool += secondsAway * rate`, trivial). The acceleration is spent as LIVE, accelerated ticks on the SAME code path as normal play, so it PRESERVES determinism + offline==live + the deterministic-sim-as-anti-cheat/server-revalidation foundation that Option 1's full-sim also has but at real processing cost. So Option 2 gets the processing savings the user wanted WITHOUT giving up the invariant, better than the "bound/cap the sim" middle path I proposed. Option 1 (default) should still get an OFFLINE CAP (the long-noted KNOWN_ISSUES gap) so its full-sim cost is bounded for the default case.
  - **SCOPE:** Option 1 refinement ships with 0.13.0 (P13). Option 2 (Bonus Ticks) is a substantial economy feature (pool + multipliers + FA upgrades + UI), best as a FAST-FOLLOW after 0.13.0, pending the user's call on timing.

- **Per-ITEM material icons (tentative, user 2026-07-30).** Materials currently render a per-CATEGORY glyph (all ores = the same rock, all refined = the same crystal, via `warehouseCategoryGlyph`), not a distinct icon per item. The offline recap + the Warehouse show icon + label so items stay distinguishable. FUTURE: give each material its own icon so titanium vs cobalt vs osmium read at a glance without the label. Tentative ("maybe"), low priority; would touch the Warehouse tiles + the offline-summary rows + anywhere else category glyphs stand in for items.

- **"Original game" MINIGAME (user 2026-07-31, future).** A pop-up window (opened like the Options/modal panels) where the player can play the ORIGINAL version of this game, the classic incremental with all the original generator stacks and everything, WHILE the main game ticks in the background. It earns its own rewards: as you hit new SCORE TIERS you gain points, and you spend those points on GAME BONUSES (buffs to the main game). So it is an optional side-loop / active-play mini-idle nested inside the main idle. Its own design pass whenever it is picked up (the original-game mechanics + the score-tier reward curve + which main-game bonuses the points buy). Downstream of the current combat + online work.

- **Defensive-drone SHIELDS (user 2026-08-21, future combat-content).** Give SHIELDS EXCLUSIVELY to DEFENSE-role drones (attack + support drones stay hull-only, matching the current no-shield-on-drones model). The reflect defense (and possibly the other deflect defenses) only work WHILE the shield is active; once the shield is depleted the drone reverts to hull-only with no reflect and still takes a hit and is destroyed the way drones do now (the shield is a buffer + enabler, NOT invincibility). THE TRADEOFF (the whole point): shielding tech is bulky, heavy, and power-hungry compared to a drone's other needs, so a shielded defensive drone carries WEAK or NO weapons. That means you cannot stack pure defensive drones and turtle: with little or no offense of their own, an all-defensive screen forces you to rely on the ship's own weaponry. Prevents a strictly-better all-defensive build. FORWARD-COMPAT already in place: the combat pip DRONE tooltip (built 2026-08-21) guards a conditional "Shield" row on the (not-yet-existing) squadron shield field, so when the field lands the tooltip surfaces it with zero rework. Downstream of combat 1.0; its own small design + balance pass (shield magnitude, recharge, the reflect-gating rule, the weapon nerf, the lore) when picked up.

- **Salvage as a TIMED, QUEUEABLE process (the "crafting treatment") (user 2026-08-26, RIGHT-AFTER-COMBAT candidate).** Give salvage the same treatment as fabrication/refining: instead of an instant action, a salvage job becomes a TIMED background process at the Salvage Bay. The lowest-level salvage takes about 5 seconds; higher level / quality / rarity scales the time up (curve TBD). The player can QUEUE multiple salvage jobs and let them tick away in the background at the Salvage Bay, like the Fabricator build queue, rather than confirming each one instantly. SHARE INFRA (do not build a bespoke salvage timer): this is the same shape as the deferred "Refinery batch/continuous refine ORDERS" entry + the Fabricator queue (a timed process, per-iteration atomic deduct, closed-form offline-bulk resolution, pause/resume on material or storage limits), so reuse that order/queue engine. Reconcile with the current instant-salvage path and the per-quality salvageConfirmPreference (the confirm dialog becomes "add to the salvage queue"). Likely wants: a Salvage Bay queue readout + per-job progress; a salvage-bay slot count for parallel jobs, possibly upgradeable like Shipyard bays; and batch-select-to-queue. Pairs naturally with an auto-salvage-rules QoL (auto-queue anything at or below quality X, or duplicates). Right-after-combat candidate; downstream of the combat 1.0 debut.

- **0.13.x POST-COMBAT QoL SERIES (user-approved 2026-08-26; SPLIT into incremental point releases 2026-08-31).** ⚠️ CADENCE (user 2026-08-31): originally scoped as one 0.13.1 bundle, now shipped as SMALL INCREMENTAL RELEASES to get value out faster with smaller, safer, easier-to-roll-back, delta-QA'd releases (directly resolves the "0.13.1 is ballooning" scope worry). Shape (REORDERED 2026-08-31, live tooltip bug prioritized the Ships work ahead of crafting): **0.13.1 = Home mission-control dashboard**; **0.13.2 = SHIPS-TAB REDESIGN** (was crafting; the display-only-tooltips + Ships-tab + nav-icons + comparison-equip effort, see its own entry, jumped ahead because it fixes a LIVE prod bug); **0.13.3 = CRAFTING overhaul** (user 2026-08-31, kept strictly CRAFTING-ORIENTED, aim for one neat chunk, splittable if it balloons): the crafting LEVELS / iLevel-computation redesign [see the computeItemLevel entry below] + improvement of the crafting system as a whole + SALVAGE made a QUEUED timed process like the other crafting facilities [the salvage-as-timed-queue entry + its shared refinery/fabricator order engine] + AUTO-SALVAGE RULES (user moved it here 2026-08-31: it is part of the crafting system, the "black sheep" but crafting-oriented). BUILD ORDER: do the salvage-queue + shared order engine in the FIRST bit, so the crafting release can peel into two if it grows. Then **LATER releases** for the NON-crafting QoL (loadout presets, tooltip system, etc.) in TBD order, until 0.14.0 (online) dev begins. ⚠️ ALSO (user 2026-08-31): some planned 0.14.x ONLINE GROUNDWORK may be rolled out earlier in the 0.13.x line if it makes sense to have in place before online (e.g. the item-`origin` field, the legitimacy / anti-cheat bones, the dev/analytics panel, see [[project_fleet_admiral_online_strategy]]). ⚠️ the CRAFTING release (now 0.13.3) is a coherent theme but meatier than a tiny point release (iLevel redesign is a crafting-progression rebalance); watch size, split if it balloons (that is what the incremental cadence is for). Big features (0.14.0+) stay LARGER releases, not split. Per-release convention: own branch `feat/<item>-0.13.x`, APP_VERSION bump, short patch-notes entry + Discord post, delta-QA. Discipline: keep each release genuinely small + focused (one coherent thing); do not let a "small" release balloon. Theme: ease-of-use, fewer clicks, zero new friction (build ease-of-use, sell peace, never stress). Members: (1) salvage-as-timed-queued + its shared refinery/fabricator ORDER engine (both above); (2) AUTO-SALVAGE RULES (below); (3) Salvage Bay slots + speed upgrade (part of the salvage entry); (4) PATCH-NOTES ACCORDION (the existing collapsible-version-history suggestion, now GREENLIT for this patch); (5) PER-ITEM material icons (the existing suggestion); (6) LOADOUT PRESETS / bulk-install (below). NOTE: the update-available banner is ALREADY implemented, so it is NOT part of this bundle (its older SUGGESTIONS entry is effectively done). Build order: the shared order engine first (salvage + refinery both ride it), then the salvage UI + auto-rules, then the independent QoL (accordion, icons, presets).

- **0.13.x ROADMAP = a TAB-BY-TAB sweep of the console, one perspective per point release (user 2026-09-01).** ⭐ **THE SERIES RULE (user, near-verbatim): "if it touches that tab, it goes into that particular patch. Fixes, UI/UX changes, feature additions and changes."** Each point release OWNS its tab COMPLETELY: bug fixes for that tab, its UI/UX redesign, AND any feature additions/changes belonging to it, all shipped together rather than scattered across releases. That is why 0.13.3 sweeps up ALL crafting work (queue engine, salvage, iLevel, UX). When triaging any new item, the first question is "which tab does this belong to?" and it goes to that tab's patch. The organizing spine for the whole series: each 0.13.x cleans up one console perspective (the design-system-accretion / UI-readiness discipline made concrete as a cadence). Confirmed sequence:
  - **0.13.1 = HOME** (overview mission-control dashboard). ✅ SHIPPED (prod, APP_VERSION 0.13.1).
  - **0.13.2 = SHIPS tab** (the redesign + display-only tooltips). 🔨 IN PROGRESS (branch feat/ships-tab-0.13.2).
  - **0.13.3 = FACILITIES tab** ("the crafting fun"): crafting levels / iLevel redesign + salvage changes + the universal talent-gated QUEUE engine (crafting/salvage UI slice) + the whole-system crafting UX/UI pass. See the crafting entries below.
  - **0.13.4 = OPERATIONS tab** (+ possibly LOGISTICS lumped in). User expects Ops to need FEW changes, likely just READABILITY + ease-of-navigation, not a big rework. So IF nothing substantial surfaces for either, LUMP any Ops + Logistics tidy-ups into the SAME 0.13.4 patch (two light perspectives, one release). Revisit if either grows.
  - **0.13.5 = OPTIONS / SYSTEM overhaul + ACCESSIBILITY PASS (user 2026-09-01 EXPANDED this).** Two halves: (A) the options-menu reorg (proper SUBTABS, replace the little color-blot theme swatches with real DROPDOWNS for theme + other settings, general grouping/cleanup of the currently-messy menu; INCLUDES organizing the DEV PANEL + PREPARING it to be spun out into its own dedicated system in 0.14.0, ties to [[project_fleet_admiral_online_strategy]]); AND (B) an ACCESSIBILITY PASS folded in here (user: "turn it more into an accessibility pass ... the options menu is already planned, it is the perfect one to do it in"). (B) = TWO things: (B1) IMPLEMENT READABILITY: the global type-scale + visual-hierarchy + contrast fixes from the external UX review below (bigger fonts, a real hierarchy, WebAIM-AA contrast, a max reading width) applied GLOBALLY via theme/type tokens so it sweeps EVERY screen at once (including everything built at the current small scale in 0.13.2/0.13.3/0.13.4); ⚠️ **DESKTOP AS A FIRST-CLASS TARGET (user 2026-09-01, the ROOT CAUSE of the "too small / spans full width" review points):** the app is currently mobile-first and DESKTOP is just that layout scaled up, which reads small + wonky + edge-to-edge. The readability pass must DESIGN AROUND DESKTOP specifically, with real breakpoints (a larger desktop type scale, a constrained max reading width so rows do not span the whole monitor, desktop-appropriate density / multi-column where it helps), NOT a mobile layout stretched. This is compatible with the "ONE responsive design, no per-platform code paths" rule ([[feedback_visual_ui_needs_mockup]] / earlier 0.13.2 call): ONE codebase with PROPER breakpoints for both mobile and desktop, not two code paths and not mobile-only-that-scales. Mockup-first for the desktop treatment. **PRESERVE MOBILE 100% + a DISTINCT DESKTOP DESIGN + a FORCE-MOBILE OPTION (user 2026-09-01 refinement):** keep the current mobile design philosophy + implementation EXACTLY as-is (it "works incredibly well," do NOT lose it), and add a design SPECIFIC to desktop that scales things appropriately, so desktop is a first-class treatment rather than the mobile layout stretched. TWO first-class treatments. ALSO add a PERSPECTIVE / VIEW option (lives in the new Options/Accessibility area) that lets a user FORCE the MOBILE perspective on desktop, for anyone on a smaller/narrow window or who simply prefers the compact layout. ⚠️ IMPLEMENTATION (CORRECTED per user 2026-09-01, supersedes the earlier "shared components + breakpoint" phrasing): the user's HARD requirement is that a change to one platform's design must NOT impact the other, AND desktop must be able to grow layouts/features that do not translate to mobile at all. So SEPARATE the PRESENTATION, SHARE the LOGIC: the game logic + state + pure derivations (the "brains": models like shipRoster.ts/shipLoadout.ts, stores, tick/economy) stay SHARED; the mobile and desktop LAYOUTS are SEPARATE view components (the "faces"). A desktop layout edit then physically cannot reach mobile; desktop can add views mobile lacks; the only thing NOT duplicated is the logic (which must never fork anyway). The FORCE-MOBILE option = render the mobile view component on a wide screen. This is the best-practice reading of the user's "don't let one change hit both platforms" + "plan desktop-only changes." TRADEOFF (accepted): two presentation layers = more UI to maintain, and anything wanted on BOTH is built in both views or a shared sub-component opted into deliberately; worth it for the isolation + desktop freedom. NOTE: this is an ARCHITECTURAL direction for the 0.13.5 pass and future UI (design-system-accretion should yield shared-logic + per-platform-view). 0.13.2 ships as-is now (its one-component responsive UI is fine for this release); the platform split happens in/after the 0.13.5 readability+desktop pass. Mockup-first for each platform. ⚠️ PARITY NUANCE (user 2026-09-01): differentiate the PRESENTATION, not the capability. The 0.13.5 desktop pass SHOULD make a few desktop-specific changes (richer, uses its space, fixes "too clean/too small") while mobile stays compact, BUT neither platform may feel like it is "missing out on some feature or look": keep FEATURE + POLISH parity, two well-tailored suits not a premium-vs-budget tier. LONG-TERM DRIVER: the online version is meant to ship as a NATIVE APP-STORE WRAPPER (must be excellent on mobile AND good on PC), which is why mobile is a first-class product and the split is worth its cost (see [[project_fleet_admiral_online_strategy]]). (B2) a NEW "Accessibility" TAB in the reorganized options menu with common a11y OPTIONS: candidates = a TEXT / UI-SCALE control, a reduced-motion toggle, a high-contrast mode, colorblind-friendly palette options, a dyslexia-friendly font option, etc. (curate the set at design time; "start implementing some common accessibility options," so it can grow over time). ⚠️ SEQUENCING CONSEQUENCE: because the readability pass now lives at 0.13.5 (later), 0.13.2/0.13.3/0.13.4 are built at the CURRENT small px scale and 0.13.5's global token pass RE-TUNES them all in one sweep. This is the user's chosen order (accessibility gets a coherent home) and is consistent with "do the global pass once." Watch scope: the a11y pass makes 0.13.5 meatier than a pure menu reorg, split if it balloons.
  - ⭐ **(B3) A "GAMEPLAY OPTIONS" TAB in the same 0.13.5 reorg (user 2026-09-01).** Alongside the Accessibility tab, the reorganized options menu needs a GAMEPLAY section that centralizes the player-facing behavior settings the 0.13.x releases have been accumulating in scattered places. Known members so far: the per-quality SALVAGE CONFIRM preference (moving into the save in 0.13.3), the AUTO-SALVAGE rules (0.13.3), the refine-confirm preference, the `showTickCounts` tick-vs-time display toggle, and the FORCE-MOBILE perspective option (which may sit here or under Accessibility). ⚠️ DESIGN CONSEQUENCE (why this matters beyond tidiness): a setting that the SIMULATION reads (auto-salvage rules, salvage confirm) must live in the SAVE, not localStorage, or the tick cannot see it offline and offline stops matching live (this is exactly the conflict the 0.13.3 plan surfaced and the user resolved by moving it into the save). So: gameplay options = save-side; device/display preferences (theme, UI scale, reduced motion) = localStorage-side. Use that split as the rule when sorting settings into the new tabs, and have 0.13.3 build its new prefs save-side so 0.13.5 only has to SURFACE them centrally rather than re-home them.
  - ⭐ **OPTIONS TAB STRUCTURE = grouped by INTENT (user 2026-09-01): "options should be easy to sus out based on the tab selection and what you want to do."** The player finds a setting by asking what they are trying to change. Known tabs so far: **VISUAL** (theme selection, and it needs its own tab because of the eventual addition of different BACKGROUND VISUALIZATIONS and similar cosmetic options), **GAMEPLAY** (the save-side behavior settings, see B3 above), **ACCESSIBILITY** (B2: UI/text scale, reduced motion, high contrast, colorblind palettes, dyslexia font, possibly the force-mobile perspective). PLUS any further tabs that make sense from the options we HAVE and the ones planned content will ADD: candidates to check at design time include ONLINE / ACCOUNT (0.14.0 connectivity, cloud save, chat, leaderboards, referral), NOTIFICATIONS, EXPLORATION (0.15.0), AUDIO (if sound ever lands), and the DEV panel (which 0.13.5 organizes and preps to spin out in 0.14.0). ⚠️ At 0.13.5 design time, INVENTORY the existing settings first (they are currently scattered: theme swatches, tick-bar toggle, showTickCounts, refine confirm, salvage confirm, combat-log options from 0.13.0, save/export/import, debug) and sort every one of them into an intent tab, rather than designing tabs in the abstract. Then walk this SUGGESTIONS file for PLANNED features that will need settings so the structure has room for them instead of being retrofitted.
  - ⚠️ **STILL UNSLOTTED in this tab-by-tab spine:** the standardized 6-template TOOLTIP SYSTEM epic (0.13.2 only makes tooltips display-only; the full templated system needs a home) and LOADOUT PRESETS / bulk-install. Neither obviously belongs in the 0.13.4 (Ops/Logistics tidy) or 0.13.5 (Options) tab-cleanups, so they need their own point release(s) or to be folded where they fit; decide placement as the series progresses. Big features (0.14.0 online) stay LARGER, not split into this cadence.
  - Per-release convention unchanged: own branch feat/<item>-0.13.x, APP_VERSION bump, short patch-notes + Discord post, delta-QA. The UI-READINESS CHECKPOINT (below) runs between the tab-cleanups where useful.

- **CASCADING ATTENTION DOTS: nav tab AND the specific sub-item, same behavior (user 2026-09-01, from 0.13.2 QA).** 0.13.2 Unit 6 shipped attention dots on the BOTTOM-NAV tabs only (e.g. Facilities lights when a facility upgrade is available). User: the dot should ALSO appear on the specific SUB-ITEM that carries the actionable thing (e.g. the Shipyard/"Spacedock" card WITHIN the Facilities dashboard, not just the Facilities tab), with the SAME appear/disappear behavior. So attention should cascade: perspective tab -> the exact sub-item. The SIGNAL already exists per sub-item (e.g. canBuildFacilityUpgrade per facility). RECOMMENDATION (scope discipline, [[feedback_push_back_on_scope]]): implement each perspective's sub-item dots AS PART OF that perspective's own cleanup, since we are rebuilding that screen anyway: Facilities cards in 0.13.3, Operations sub-tabs in 0.13.4, etc. NOT retrofitted into the 0.13.2 Ships release (which would reach into the Facilities screen mid-Ships-release and get re-touched a release later). ✅ USER AGREED 2026-09-01: add sub-item dots to each tab AS THAT TAB GETS ITS PATCH in the 0.13.x series (it is a per-tab task on the tab-by-tab roadmap, not a one-off).

- **✅ 0.13.3 SCOPE LOCKED (user 2026-09-01): "if it involves crafting, it is included."** 0.13.3 = the FULL crafting release: (a) the universal talent-gated QUEUE engine exposed on the crafting facilities, (b) SALVAGE made a queued timed process + AUTO-SALVAGE rules, (c) the CRAFTING LEVEL / iLevel redesign, (d) the whole-system crafting UX/UI pass, plus the under-the-hood work to make it all hold together. This deliberately reunites work that was originally one big 0.13.1 bundle before the series was split. ⚠️ SIZE: this is the largest release in the 0.13.x line; build it in GATED PHASES inside the release so later phases can peel into 0.13.4 if it grows (the incremental cadence exists for exactly that).
  - ⭐ **CRAFTING-LEVEL CURVE INTENT (user, near-verbatim, the sharpest design constraint):** crafting level drives crafted-equipment iLevel, and **ALL crafting contributes to it, not just equipment**. The curve should be **fairly gentle at first, then scale pretty hard over time**, "because you'll want to create lots and lots of things." The explicit failure to avoid: **"refining thousands of bars" must NOT boost iLevel so much that you are overpowered.** So high-volume, low-value crafting (bulk refining) must not out-earn meaningful crafting.
  - ⚠️ **CODE REALITY TO DESIGN AGAINST (from the 2026-09-01 map, verify before building):** crafting XP today is **TIME-proportional, not item-count-proportional**: `craftingXpDelta += CRAFTING_XP_PER_DURATION_TICK (=2) * durationTicks` per completing job, awarded for `refineJob | fabricateJob | shipBuild` via the exhaustive `PROCESS_XP_AWARDS` table (tick.ts ~691). That already blunts spam somewhat (bulk refining costs real time), BUT it means a long cheap job earns the same as a long valuable one, and a QUEUE (0.13.3's own feature) makes bulk crafting far easier to sustain, which PUSHES ON THIS EXACT BALANCE. ✅ DECIDED (user 2026-09-01): XP gains a RECIPE VALUE/TIER WEIGHT, i.e. XP = time x a per-recipe weight, so refining a bar earns less than fabricating a component or building a ship. This targets the bulk-refining problem AT THE SOURCE, with the gentle-then-steep level curve as the second layer. (Rejected: purely time-based + curve only; per-recipe diminishing returns [risked feeling punishing, against the peace rule]; tier weight + a per-source soft cap [most tuning surface].) Still to design: the actual weight values per tier/recipe kind and the craftingXpForNext curve shape. And the `craftingXpForNext(level)` curve shape for "gentle then steep". ⚠️ Whatever is chosen must keep the closed-form offline==live guarantee (XP is summed in resolveProcesses).
  - iLevel formula today: `computeItemLevel = min(craftingLevel + achievementBoost + faTalentBonus, itemTierCap)` (itemgen.ts ~185), with `achievementBoost`/`faTalentBonus` HARDCODED to 0 at all three mint sites (tick.ts ~6865/6899/6931) and `itemTierCap = bp.tier * EQUIPMENT_ILEVEL_CAP_PER_TIER (=20)`. The hooks exist; the redesign decides what feeds them and how the tier cap interacts with a steeper crafting curve.

- **✅ REGRESSION AUDIT OF THE SHIPPED REDESIGNS (2026-09-01): Home 0.13.1 and Ships 0.13.2 dropped NOTHING important.** Home's diff was essentially pure-additive (2108 insertions / 41 deletions); the ONLY removed UI was the "pick a tab above" Overview placeholder the dashboard existed to replace, and the Help + Statistics blocks were verified BYTE-IDENTICAL. Ships preserved every old affordance (Assign Captain with all 3 states + both disabled reasons, Salvage with its on-mission lock + last-ship softlock guard, rename, repair, drone bays); a set-comparison of every stat-row label returned EMPTY IN BOTH DIRECTIONS (zero stat rows lost or added), only the old spare-tile grid class disappeared (replaced by the picker), and the retired ShipSystemsPanel modal has ZERO orphaned call sites. TWO minor items found:
  1. **Roster status condensed (probably deliberate, low priority).** Old ship cards printed the specific activity ("On mission, Lunar Mine Contract" / "On patrol, {patrol}"); the new roster rows print the generic SHIP_STATUS_LABEL ("Gathering" / "On patrol"). MITIGATED: the specific name still appears one level down on the ship page (`shipStatusLabel`). Reads as a density tradeoff (the row already carries name, class, captain, status, Battle Rating, and the attention flag). Decide whether to restore specificity in the roster row or keep the condensation.
  2. ⚠️ **LOST NAVIGATION CONTEXT (the one genuine accidental side effect, worth fixing).** Before 0.13.2, the captain page's "Ship Systems" opened the panel as a MODAL over the captain page, so closing it returned the player to that captain in place. Now it NAVIGATES to the Ships tab, and both the `< Ships` back control and the panel's close land on the ships ROSTER, so there is no way back to the captain you came from. No capability lost, but the return path is gone. FIX SHAPE: remember the origin when the captain-page shortcut navigates (e.g. a `shipsReturnTo` marker) and have back/close return there instead of the roster. Small; slot into 0.13.3 or a tidy-up patch.

- **DESIGN-SYSTEM DECISIONS (user 2026-09-01, from the UI-readiness checkpoint after Home 0.13.1 + Ships 0.13.2).** The checkpoint found the two done tabs strongly consistent in CONCEPT (Panel/title, full-surface tint not left-stripes, amber = needs-you, display-only tooltips with actions on stable buttons, the portal modal, pure tested view-models, single-sourced routing) with drift only in TECHNIQUE. Two forks were resolved so a third tab does not fork them again:
  1. ✅ **TINT TECHNIQUE = `color-mix(in srgb, var(--color-X) N%, transparent)`** (Home's approach) is the STANDARD, not `rgba(var(--color-X-rgb), N)` over an opaque `--color-bg-mid` (Ships' approach). Rationale: the backdrop/starfield shows through so panels feel layered, and it is theme-portable without needing a `-rgb` triplet token per color. ⚠️ Ships' rows + the `--color-warning-rgb` token added for them are now the OUTLIER: convert them when Ships is next touched (NOT a regression-worthy standalone patch), and use color-mix for all NEW work starting 0.13.3.
  2. ✅ **ICONS: MOVE TO SVG OVER TIME.** Content icons (items, materials, recipes, rows) migrate from emoji to inline stroke SVG (theme-aware via `currentColor`, consistent across OSes), matching the nav icons. NEW icons in 0.13.3+ should be SVG; existing emoji (`HOME_ICON_GLYPH`, the roster 🚀, loadout-board tiles, warehouse/material glyphs) migrate GRADUALLY as each surface is touched. ⚠️ This implies an icon set / shared `<Icon>` component is needed: spec it as part of 0.13.3 (crafting introduces many item/recipe icons) so the migration has a home rather than accreting one-off inline paths.
  - Remaining checkpoint findings (NOT yet decided, low urgency): Ships' empty-state text reuses the success-GREEN `.research-status` class so "No ships match your search" reads as success (looks like a small real bug, worth a neutral/dim empty-state idiom); Ships lacks the roster/group COUNTS Home shows everywhere; Home's navigable rows have a `>` chevron and Ships' do not; section-header styling differs (Home `.home-sec-hd` display-font + count pill + rule vs Ships' lighter group label); type sizes differ (Home 10-11.5px vs Ships 13px) which should be folded into the 0.13.5 readability pass rather than patched piecemeal; amber is semantically overloaded (needs-you signal AND the hull bar AND the kinetic weapon-family dot); tint alphas and type sizes have no shared scale token yet.

- **STANDARDIZE THE "ACTION MODAL" PATTERN (user 2026-09-01, PENDING a validation test).** The 0.13.2 install flow was rebuilt as a MODAL popup over a dimmed board (mobile = bottom sheet, desktop = centered popup; dismiss via backdrop click / Escape+focusTrap / header X; content unchanged). Built locally in ShipSystemsPanel.svelte (`.ss-modal-backdrop` + `.ss-picker` panel + the shared `focusTrap` action). ⚠️ USER WANTS TO TEST FIRST: whether a bottom-anchored modal on MOBILE is generally better received than a centered one, BEFORE committing to it. IF validated, then STANDARDIZE this pattern (extract it into a shared modal/`<Modal>` component: responsive bottom-sheet-on-mobile / centered-on-desktop, backdrop+focusTrap, sticky header+X) and apply it to ALL similar ACTION modals that pop up the same way (install flow, confirms, pickers, etc.). ⚠️ EXPLICIT EXCLUSION (user): NOT the OPTIONS / System (gear-portrait) popup, and by extension the other existing `.modal-backdrop`/Panel.modal-dialog menus stay as they are unless separately decided. This is design-system-accretion (extract the reusable component once the shape is proven) and fits the 0.13.5 desktop/mobile presentation pass. Do NOT extract/standardize until the user confirms the mobile bottom-vs-center call from testing. NOTE: the Ships tab (0.13.2) already has its sub-level attention as per-ship amber roster FLAGS (nav dot -> roster flag, trail complete); consider unifying flag-vs-dot to ONE visual vocabulary during the design pass so "attention" looks identical everywhere. Not a 0.13.2 blocker. User may choose to pull a focused sub-dots pass forward if desired.

- **⭐ EXTERNAL UX/UI REVIEW (professional designer, via user 2026-09-01) - a GLOBAL design-language pass, mostly NOT tab-specific.** A UX/UI dev (the user's workplace app designer) annotated the LIVE 0.13.1 Home screen. STRONG SIGNAL: she independently flagged "the overall UI is too small," which the USER had ALSO said in the same screenshot, so two independent parties converged on it unprompted. Her points, grouped:
  - **QUICK FIXES / bugs (small, shippable soon, candidates for a near-term patch since 0.13.1 is LIVE on prod):**
    1. **Tick bar stops ~80%** (never visually reaches the end). CONFIRMED a real bug: the fill is `width: {globalTickProgress * 100}%` (App.svelte ~5254), so `globalTickProgress` is not reaching 1.0 before the cycle resets. Targeted fix (investigate the poll/reset cadence: 100ms poll + barSeconds floored at 1s in the onMount tick loop).
    2. **Tick bar reads as "panic"**: too bright + fast for a BACKGROUND element, "constantly pulling my attention." De-emphasize (dimmer / less-saturated fill, calmer motion) unless the strong pull is intentional. Decide its intended role first.
    3. **Disabled-state contrast too low** (the COMING SOON / locked chips): "likely not enough contrast, hard for anyone with visual issues," "just a bit too dark." Bump the disabled/locked token toward WebAIM AA (https://webaim.org/resources/contrastchecker/). a11y fix, applies wherever disabled/locked styling is used.
  - **BIG / GLOBAL (a dedicated readability + hierarchy pass, NOT per-tab):**
    4. **Type scale too small app-wide**: "fonts a bit too small, I have to get really close at 100% on desktop." The font STYLE fits the theme (keep it), the SIZE is the problem. Bump the base type scale.
    5. **Flat hierarchy**: "everything on the page has the same hierarchy, I have no idea what is more important." Establish a real typographic/visual hierarchy (a dominant element, then descending emphasis, like P1 > P2 > body), so each screen has a clear focal point.
    6. **Full-width spanning**: "you don't want UI elements spanning the full screen width, it makes the user scan back and forth." Introduce a max reading/content width (or columns) so rows do not stretch edge-to-edge on wide desktop.
    7. **Nav / overall emphasis**: she "didn't notice the bottom nav until told"; the nav is clear once seen but the whole UI reads too small/low-emphasis. Ties to (4)/(5).
  - **RECOMMENDATION (Claude, for the user to steer):** points 4-7 are GLOBAL (type-scale + hierarchy + width tokens + emphasis) and should be done ONCE as a dedicated "readability & visual-hierarchy pass" (theme/type tokens + a type scale), NOT piecemeal per tab (piecemeal would look inconsistent across the tab-by-tab sweep). Sequence it so the remaining tab-cleanups INHERIT the new scale (i.e. do the global pass EARLY, or make it the substance of the UI-READINESS CHECKPOINT). Points 1-3 are small and independent and could ship in a near-term patch (1 is a live-prod bug). ⚠️ INTERACTION WITH 0.13.2 (in flight): the ships UI uses hardcoded px sizes matching the CURRENT app scale, so it will need re-visiting when the global type scale changes; either finish 0.13.2 on the current scale and sweep it with everything else in the global pass (recommended, avoids a moving target mid-build), or hold and bump the scale first. User to decide sequencing. Screenshot annotations preserved in this entry. ✅ **RESOLVED (user 2026-09-01): points 4-7 (the global readability/hierarchy/contrast pass) land in 0.13.5, reframed as an ACCESSIBILITY PASS (readability applied globally via tokens + a new Accessibility options tab), see the 0.13.5 roadmap line above.** 0.13.2 finishes on the current scale and gets swept by the 0.13.5 global pass. Points 1-3 (tick-bar 80% bug + de-emphasis, disabled contrast) ALL land in 0.13.5 too (user 2026-09-01 chose WAIT-for-0.13.5 for the tick-bar 80% bug rather than a near-term hotfix, so all three tick-bar/contrast items ship together in the a11y pass as one coherent visual update; the 80% bug stays live on prod until then, accepted). NET: the ENTIRE external UX review (points 1-7) is now folded into the 0.13.5 accessibility pass. Pairs with [[feedback_build_ease_of_use_sell_peace]] (readable = ease-of-use) and the design-system-accretion discipline.

- **0.13.3 CRAFTING = TREAT IT AS A WHOLE-SYSTEM UX/UI OVERHAUL, not just levels + salvage (user 2026-09-01).** When 0.13.3 comes up, scope it as improving the crafting experience AS A WHOLE, not only the mechanical pieces already listed (crafting levels / iLevel redesign, salvage-as-queued, auto-salvage). The user explicitly wants to "take the opportunity to do more to crafting as a whole ... perhaps improve the UX/UI for crafting as a whole." So the 0.13.3 design phase should audit the Refinery + Fabricator + Research + Salvage Bay screens for the same ease-of-use pass the Ships tab got (fewer clicks, clearer at-a-glance state, queue/order legibility, display-only-tooltips-actions-on-buttons consistency, the design-system-accretion components reused), on top of the mechanics. ⚠️ Watch scope: the mechanics ALONE (iLevel redesign is a progression rebalance) already make 0.13.3 meatier than a tiny point release; adding a UX/UI sweep could balloon it, so at design time decide what UX is in-release vs a fast-follow, and split 0.13.3 if it grows (the incremental cadence explicitly allows peeling it). Pairs with [[feedback_build_ease_of_use_sell_peace]] and the UI-READINESS CHECKPOINT (which happens right before 0.13.3 and is the natural place to spot which crafting screens need the work). Both ships and crafting "need doing right" (user); keeping them as separate releases is confirmed.

- **0.13.3 CRAFTING: TALENT-GATED JOB QUEUES per facility (user 2026-09-01, SETTLED / firm requirement, not a maybe).** On top of the crafting level changes + salvage changes, 0.13.3 WILL let the player set up QUEUES on crafting/salvage facilities, with the number of queued jobs gated by FLEET ADMIRAL TALENTS. Fiction/rationale (user, verbatim flavor): "RAM is expensive, after all" - queue depth is a scarce resource you invest talent points to expand, so queueing is a progression REWARD, never a free default. Model: a facility runs its current job; talenting into the relevant node grants ADDITIONAL queued-behind slots. User's concrete example: a fully-worked-up Salvage Bay could run a current salvage job for 10k of one item AND, if specced, 1 or 2 MORE queued jobs for OTHER salvageable items, so the player lines up different targets and walks away. Applies across the crafting facilities (Salvager, Refinery, Fabricator, ...). ⚠️ DESIGN QUESTIONS to settle at 0.13.3 design time: (a) is the talent-granted queue depth PER-FACILITY (each facility gains the extra slots) or a SHARED pool the player allocates? user's "queue jobs for each" reads per-facility; confirm. (b) does the CURRENT/active job count as slot 1, or is the active job always free and talents add only the queued-behind slots? (c) which talent branch/nodes (a new Fleet Admiral logistics/industry node, tiers granting +1 / +2 / ... queue slots); reconcile with the existing FA talent tree. (d) offline resolution of a multi-job queue must stay closed-form + parity-safe (each job resolves in order, per-iteration atomic, no per-tick sim), reusing the shared refinery/fabricator/salvage ORDER engine (see the salvage-as-timed-queue entry + the queueing-build-orders umbrella). This is the CRAFTING-facility slice of queueing; the separate [[queueing build orders + automation]] umbrella (facility-upgrade + ship-build queues) stays a later/post-0.13.3 item. Talent-gated depth pairs with [[feedback_build_ease_of_use_sell_peace]] (opt-in, adds convenience, never forces friction).

- **QUEUES ARE UNIVERSAL: ONE talent-gated queue engine across EVERY timed-process facility (user 2026-09-01, "we're already doing this, might as well do this across the board").** Supersedes the "crafting-facility slice only" framing above and CONVERGES the crafting-queues idea with the [[queueing build orders + automation]] umbrella into a SINGLE design: the same talent-gated job queue applies to ALL timed jobs, not just crafting/salvage: research projects, ship builds, facility upgrades, fuel refining, refine + fabricate, etc. WHY this is natural (not a bolt-on): the game already runs every timed job through ONE uniform model, `state.activeProcesses: TimedProcess[]` with `TimedProcessKind` = refineJob | facilityUpgrade | fuelRefineJob | researchProject | fabricateJob | shipBuild | equipmentStorageUpgrade | docksExpansion | shipRepair, so a universal queue sits on top of that existing model rather than a bespoke queue per facility. Design the engine UNIVERSAL from the start (every process kind can be queued behind the running one, talent-gated depth, closed-form parity-safe offline resolution job-by-job). ⚠️ **RELEASE SCOPING (push-back-on-scope, [[feedback_push_back_on_scope]]):** universal queues across every facility is a BIG feature and would balloon 0.13.3 (already crafting levels + salvage + crafting queues + a crafting UX pass). RECOMMENDATION (user to decide at 0.13.3 design time): build the universal ENGINE once, expose the queue UI on the CRAFTING/SALVAGE facilities in 0.13.3 (proving the engine on the release that needs it), then extend the same engine's UI to the remaining facilities (research / ship builds / facility upgrades / fuel) as staged fast-follows, so no single release balloons. The ENGINE is universal by design; the UI ROLLOUT is staged. Confirm in-release-vs-fast-follow split when 0.13.3 is designed.
- **Auto-salvage RULES (user-approved 2026-08-26, 0.13.1 bundle).** Rules that auto-QUEUE salvage so it clears loot clutter hands-off: auto-queue anything at or below a chosen quality tier, and/or auto-queue duplicates. Turns the salvage queue from more-clicks into fewer-clicks. Pairs with the salvage-timed-queue and the existing per-quality salvageConfirmPreference. Never destroys protected/needed gear (respects the current safeguards).
- **Gear LOADOUT PRESETS / bulk-install (user-approved 2026-08-26, 0.13.1 bundle).** Save a ship's gear loadout (combat + economy slots) as a named preset and re-apply it to a hull in ONE action (bulk-install from spares, respecting hardpoint/bay caps and spare availability, skipping what is not owned). Now that every hull has a full slate of slots, kitting out a fresh hull should be one tap, not a dozen. Pure ease-of-use QoL for the new gear system.
- **HOME MISSION-CONTROL DASHBOARD (user 2026-08-28, COMMITTED TO 0.13.1 for new-player onboarding; sized as a mini-epic so build MVP-first; SUPERSEDES the earlier "fleet ops-status tab" framing).** Elevate the Home section into an at-a-glance dashboard of EVERYTHING happening across the game, all in one place: active missions (combat patrols + gathering), research projects, and all crafting queues (refining, fabrication, ship building), plus idle-slot prompts. The Combat Patrols and Gathering Missions tabs (and other setup menus) then slim to pure PICKERS. Grew this session out of a smaller "ops-status tab in Operations" idea, which this ABSORBS.
  - **CORE VALUE (the design principle): surface what is IDLE / needs a decision, not just "show everything".** A wall of status is noise; the dashboard's job is to make "what do I do next" obvious. Idle captain, empty research slot, free fabricator/refinery/shipyard bay = tap-to-act prompts at the TOP; anything RUNNING = a passive progress line below. Hierarchy = attention-first, progress-second. This is the ease-of-use / sell-peace value made concrete (never hunt through tabs for the idle thing).
  - **ARCHITECTURE = CONFIRMED route-and-launch (user clarified 2026-08-28; embedding explicitly REJECTED).** The dashboard NEVER rebuilds a setup / crafting UI. Every actionable item is a SHORTCUT: tap it and you land in the EXISTING tab (e.g. the Refinery tab) with its existing UI + functionality to make your selection ("my bars are done, tap -> refining tab -> pick the next order"). It is a status view plus a jump-shortcut, so the player sees what is running / idle at a glance and acts without zooming tab-to-tab. (Confirms option (a) from the prior framing; (b) embed-the-pickers is off the table.)
  - **FUNCTION 1, read-only status of EVERYTHING (compact):** relocate the captain-progress portion of the Operations panel here (who is doing what), and do the same for research (current project + time remaining) and ALL crafting queues (refining / fabrication / shipbuilding / etc: current item + quantity + time remaining + a COMPACT progress bar IF it fits without eating space). Each row streamlined SMALLER than its source panel but just as informative, because the dashboard packs a lot and will eventually SHARE vertical space with a future chat panel (slides / expands from under the Home / Logistics menu buttons; TENTATIVE, may change), so it must stay space-efficient and shrink / scroll gracefully.
  - **FUNCTION 2, idle detection + shortcut (never a rebuilt UI):** an idle activity is flagged (indicator / message) with a button that jumps to its real build / setup tab; LOCKED slots for not-yet-unlocked features are shown too (discoverability of what is ahead). TONE (sell-peace value): frame idle as "ready for your next order / opportunity", NOT an alarm that reads as failure. A subtle red light is fine; avoid a stressful red-alert feel that turns the cockpit into a list of nagging chores.
  - **DRY / foundations:** function 1 is literally RELOCATING existing status displays, so EXTRACT one shared compact in-progress-row component (icon + what + time-left + mini-bar) and reuse it on BOTH Home and the source panels. One source of truth for how a running mission / research / craft is drawn, so the two can never drift.
  - **REDUNDANCY / CONSOLIDATION (settle before build):** if Home is the aggregate dashboard, do NOT also add a status tab in Operations. That would leave THREE homes for captain status (Home aggregate, Personnel->Captain Roster per-captain identity, and the dropped ops-panel). Pick TWO: Home = aggregate + launcher; Roster = per-captain identity/management; drop the separate ops-status tab. The selection tabs still slim to pure pickers (the part worth keeping from the original idea).
  - **SCOPE (user COMMITTED to 0.13.1, 2026-08-28, overriding the earlier "its own .x" flag; rationale: it helps NEW PLAYERS in the interim after the combat 1.0 debut, a "what do I do next" board is one of the best onboarding aids there is).** It is still a big surface (missions + research + refining + fabrication + shipbuilding + idle-detection + deep-links, live-updating, dense-on-mobile) landing in an ALREADY-loaded 0.13.1 (tooltip system + salvage-queue + auto-salvage + presets + accordion + icons). RECOMMENDATION so it ships without stalling the release: build MVP-FIRST, the onboarding-critical core (compact status of all running activity + idle flags + jump-shortcuts for the core systems) in the first cut, defer richer polish (progress bars everywhere, locked-slot previews, chat-coexistence tuning) to fast-follows within the bundle. Mockup -> design doc -> build still applies.
  - **PERF note:** a dashboard subscribing to every mission + research + all crafting queues re-rendering each tick is a lot of reactive DOM on the Svelte 5 legacy `$:` model; derive a compact summary model and update efficiently rather than re-rendering the whole panel every tick.
  - **BUILD NOTE:** dense live dashboard on a phone = exactly the spatial layout the mockup-first rule exists for. MOCKUP (dashboard + slimmed pickers, desktop + mobile) BEFORE any code.
  - **NEEDS-YOUR-ORDERS = COUNTER + CYCLING TICKER + EXPAND (user 2026-08-31, 0.13.1 Unit 6).** To stay compact as attention items grow, the section shows a COUNTER ("N need your attention") + a gently-cycling TICKER (rotates through the items every tick or two) that is DISPLAY-ONLY (awareness, not a tap target, because a moving tap target is the same failure mode as the vanishing tooltip). TAP the ticker/counter -> EXPANDS the full list of STATIONARY action buttons to pick one directly. Reduced-motion pauses the cycle (static count + list). Amber tone.
  - **AGGREGATE AVAILABLE-UPGRADE PROMPT (user 2026-08-31, 0.13.1 Unit 2 extension).** Surface AVAILABLE facility upgrades (a level-up the player can START now, not one in progress, which already shows in In-Progress) as ONE aggregate prompt "N facility upgrades ready" routed to Facilities, reusing the real canBuildFacilityUpgrade gate (the same one the Build button reads). Aggregate (not per-facility) to avoid clutter at a progressed player's scale. Root cause of the user's "upgrades missing" report: the upgrade was AVAILABLE (Build button), not in-flight, and idle-PRODUCTION was surfaced but idle-UPGRADE-AVAILABLE was not.
  - **NAV TAB ATTENTION DOTS (user 2026-08-31; 0.13.2, ride the nav rework).** A gentle glowing dot on a bottom-nav tab when something in that bucket needs attention. DERIVES FROM THE SAME MODEL as the dashboard (buildNeedsOrders -> each prompt's jumpTarget -> its nav bucket), so the dots + the Home modal are AUTOMATICALLY in sync and clear live as the player acts (zero extra bookkeeping). Destination buckets only (Operations / Facilities), NOT a Home meta-dot (Home is where the details live). Amber, gentle glow, reduced-motion-aware. SEQUENCING: build WITH the 0.13.2 nav overhaul (icons + Ships tab) so the nav is touched once + the dots pair with the icons; 0.13.1's on-Home modal already gives the awareness meanwhile.
  - **UI-READINESS CHECKPOINT before 0.13.3 (user 2026-08-31).** After the dashboard (0.13.1) + ships-tab + nav overhaul (0.13.2), PAUSE and review the OTHER tabs (Personnel, Logistics, the facility consoles) for consistency / user-friendliness before piling crafting on. If clean, proceed to 0.13.3. This is the deliberate checkpoint that STOPS the reactive-overhaul-every-few-patches cycle (pairs with the design-system-accretion note).
  - **FUTURE EXTENSION, PINNED GOAL TARGETS (user 2026-08-31; downstream of ACHIEVEMENTS existing, NOT now):** let the player SELECT up to 5 achievement + up to 5 completion targets to PIN, and the dashboard tracks live progress on each (an "Objectives / working toward" section). This is the long-term-DIRECTION complement to the board's short-term activity view: "what is running / idle" + "what am I working toward" in one hub. Slots into the dashboard's existing section structure. BLOCKED on the achievements + completion systems (currently coming-soon reserved features); a "when those land" item.
- **"What should I do next?" progression ADVISOR (user 2026-08-28; FUTURE + UNCERTAIN, POLL-IT-FIRST; dashboard-adjacent).** A dashboard function that suggests a next step from current player state. User is deliberately unsure (may be unnecessary, may be too handholdy) and wants to POLL it in-game before committing. Carry this analysis into that decision:
  - **ANTI-HANDHOLD levers (what decides helpful vs patronizing):** (1) PULL not push, a button pressed WHEN stuck, never an always-on nag that plays the game for you; (2) NUDGE not prescribe, surface a possibility they may have missed ("idle refining + plenty of ore, you could refine"), do NOT rank the one true move (an oracle flattens the game into following instructions).
  - **DISTINCT FROM the idle-dashboard (the key insight):** the committed Home dashboard already answers "what should I do next" for the MID game (idle captains / research / crafting + jump-buttons). The advisor's UNIQUE value is what the dashboard CANNOT show: EARLY-game / progression-PATH hints ("you can afford your 2nd captain", "research X unlocks Y", "you are 200 titanium from the docks expansion that unblocks your fleet"). Its real audience is NEW / stuck players, narrower than "what next" broadly, same onboarding motive as the dashboard. Framed this narrowly it is far more defensible than a general next-move oracle.
  - **BUILD REALISM:** a GOOD engine needs the progression graph / a priority model encoded; a BAD one gives obvious advice ("gather more") and trains players to ignore it (worse than none). Realistic build = a CURATED rule-based priority list the designer authors (`if state matches condition -> suggest S`, evaluated top-down, show first 1-2), transparent + tunable + scales by adding rules, reflects the intended progression, NOT a black-box optimizer (fits the explainability value).
  - **POLL CANDIDATE (user instinct, endorsed):** demand is a genuine unknown that player data settles better than speculation, and it double-serves by revealing whether next-step confusion is an actual pain point worth solving. Route through the in-game POLL system (participation-reward path, GDPR-clean, NOT the consent path, see [[project_fleet_admiral_online_strategy]] and the privacy/polls notes). Gate the build decision on the poll signal.
  - **TONE (sell-peace):** calm, optional "here is a thought", never a pushy optimizer that manufactures not-optimal-play FOMO / anxiety.

- **Quickswap / loadout-preset SCOPE + auto-unequip-on-drydock (user 2026-08-26; refines the 0.13.1 loadout-presets entry).** Questions to settle before building presets: (a) AUTO-UNEQUIP when a ship returns to drydock? Only sensible if COUPLED with one-tap restore (auto-unequip frees the gear for reuse, a preset re-applies it on deploy). Auto-unequip WITHOUT a painless restore is pure friction and violates the sell-peace value, so decide it together with quickswap, not separately. (b) SCOPE: captain-centric (the preset follows the captain), ship-centric (per individual ship), or ship-CLASS-centric (one preset per class that applies to any ship of that class, since e.g. destroyers are upgraded versions of one another). (c) SNAPSHOT vs TEMPLATE: a ship-level preset can be a SNAPSHOT of specific installed instances (re-install these exact pieces), but a class-level preset must be a TEMPLATE keyed by gear TYPE/role (pull the best-available matching gear from the spare pool on apply), since it spans multiple ships. Template is richer and lower-friction (auto-pull) but more logic. DRIVING USE CASE: ROLE builds, e.g. a battleship "solo DPS" build vs a "team tank" build, swapped in one tap. LEAN (for discussion, not decided): class-level ROLE templates applied to a ship; captain-centric feels awkward because captains move between ships. Resolve when 0.13.1 presets are designed.
- **Threat/taunt weapon role + class CAPSTONE weapons (user 2026-08-26; FUTURE, downstream of MULTI-SHIP / group combat, currently deferred Tier B).** For future group combat: a THREAT-generation weapon role so a tank ship can pull enemy aggro off its group. Pointless in solo missions, imperative in multi-group. ANTI-META design (the user's key instinct, and it is the right one): do NOT make threat a stackable generic weapon, that homogenizes into "every tank runs 4x threat-cannon." Instead give each combat class a signature CAPSTONE weapon (equip-only-ONE, class-specific) and let the CAPSTONE carry the threat-generation boost (e.g. the battleship's capstone). Threat then comes from a single limited slot you build AROUND, which preserves build diversity and gives the class a tank IDENTITY instead of a copy-paste meta. Adds new weapon type(s) to the roster. Log for the weapon-roster + fleet-combat design; build order is after multi-ship combat exists.

- **iLevel calculation redesign: crafting-level range + variance talent (user 2026-08-26; fold into 0.13.1).** Refine computeItemLevel (currently `iLevel = min(craftingLevel + achievementBoost + faTalentBonus, blueprintTier*20)`, all boosts 0 today). Proposed model, all CRAFTING-LEVEL driven (explicitly NOT FA level, the-more-you-craft-the-better): the crafting level sets a CAP (level 1 -> cap 10; +2 per level, so cap = 8 + 2*level), and a crafted item ROLLS an iLevel in a RANGE below the cap (level 1 -> roll in ~[6, 10], width ~4-5). A crafting TALENT tightens that range by 25% per point (4 points = 0 range = you always craft at the cap, e.g. always iL 10 at level 1). Talent + achievement iLevel bonuses are FLAT ADDITIVE on top of the level-based roll (compute the level-based value first, THEN add the flat bonuses). OPEN FORKS to settle at design: (1) does the blueprintTier*20 cap STAY as an outer ceiling, or is iLevel now purely crafting-level-driven (which changes what recipe TIER means, a tier-1 recipe would scale with crafting level like any other)? (2) the iLevel ROLL adds a THIRD variance axis on top of the existing quality + rarity rolls, so early crafts get swingy: keep the variance-reduction talent EARLY-accessible so it does not read as RNG frustration (the sell-peace value). (3) +2/level is LINEAR (crafting level 50 -> cap ~108); confirm that curve or make it accelerate at high levels. Needs new crafting-talent-tree hooks (the range-reduction talent + flat-iLevel talents/achievements), which may not exist yet, so this is a crafting-progression rebalance, a touch meatier than pure QoL, but it fits the 0.13.1 post-combat bucket.

- **PRE-CRAFT STAT PREVIEW (user 2026-08-31; 0.13.2 crafting, COUPLED to the iLevel redesign above).** Before crafting a SHIP or a SHIP SYSTEM, let the player VIEW its stats first, so they never craft blind. Two halves: (a) **Ships = deterministic**: a hull's stats come from its SHIP_TYPES entry (no roll), so the Shipyard build screen just shows the known hull stats before the Build button. Simple, arguably shippable on its own. (b) **Ship systems = rolled**: a crafted system rolls (quality + rarity + iLevel), so the preview must show a RANGE ("shield cap 280 to 340"), not a fixed number. That range IS the roll range the [[iLevel calculation redesign]] entry above is redefining, so the two are the SAME computation from two sides, design + build them TOGETHER, not bolted on. LOVELY SYNERGY: the variance-reduction talent (from that redesign) would VISIBLY narrow the previewed range (280-340 tightens to 310-330 as points go in), making an otherwise-invisible talent tangible + rewarding. UI = mostly REUSE: the game already renders equipment stats (EquipmentTooltip, preserve-unchanged) + ship stats (Ship Systems panel), so the preview is those SAME displays in a "before you craft" mode, with rolled fields shown as ranges instead of fixed values. Needs itemgen to expose its per-stat roll bounds (min/max) as a pure computation (the redesign defines those bounds anyway). Ease-of-use win: compare "is this worth crafting?" before spending materials, no more craft-to-find-out.

- **Warehouse floating tooltips + inline salvage (user 2026-08-26; 0.13.1 QoL / consistency).** Apply the shared floating-tooltip treatment (floatingTip.ts, built for the ship-systems panel + combat pips) to the WAREHOUSE "Ship Systems" / system-bay item tiles: tapping or hovering an item shows a floating, viewport-clamped EquipmentTooltip near the cursor, replacing the current click-to-select-then-inline-card pattern. Put a SALVAGE / DESTROY button INSIDE that tooltip with the full existing salvage logic (crafted -> salvage for materials; Standard-Issue baseline -> Destroy for zero, per salvage.ts), so the player salvages from where they SEE the items instead of only in the separate Salvage Bay facility. Consistency goal: the floating tooltip becomes the ONE item-detail pattern everywhere items are shown (panel, combat, warehouse). Reuses floatingTip.ts + EquipmentTooltip (preserve-unchanged) + salvage.ts. Pairs with the salvage-as-timed-queued entry. Downstream of the combat 1.0 debut. ⚠️ SUPERSEDED-IN-PART (user 2026-08-31): a SALVAGE/DESTROY button INSIDE the tooltip now conflicts with the TOOLTIPS-ARE-DISPLAY-ONLY principle (entry below). Keep the GOAL (salvage from where you see the items) but the action must be a real BUTTON on a stable surface (the tile, or a selection bar), NOT inside the hover tooltip.

- **SHIPS TAB + DISPLAY-ONLY TOOLTIPS + NAV ICONS (user 2026-08-31; triggered by a LIVE prod bug).** ROOT CAUSE of the reported bug: the equipment tooltip VANISHES when the player moves to click Install/Uninstall, especially when ZOOMED (reproducible). The ShipSystemsPanel ALREADY has the textbook interactive-hover-tooltip fix (grace-delay hide + tap-to-pin, ShipSystemsPanel.svelte ~184-211) and it STILL breaks at zoom (the floating measure-flip-clamp positioning is fragile at non-100% zoom, so the hover-bridge the grace-delay relies on misaligns). Standard fix already in place AND still broken = the PATTERN is at its limit; patching the geometry further is whack-a-mole (Omega 16 anti-thrash). THE FIX is a design change, three parts:
  1. **TOOLTIPS ARE DISPLAY-ONLY (global principle, user-locked 2026-08-31).** A hover tooltip that also holds ACTIONS is fragile everywhere (diagonal + zoom). Every tooltip becomes informational; every action becomes a real BUTTON on a stable surface. Kills this whole bug class permanently. Supersedes the salvage-in-tooltip mechanism above. EquipmentTooltip 'preserve-unchanged' is COMPATIBLE (it stays a display tooltip; only the ACTIONS leave it).
  2. **SHIPS = a 6th bottom-nav tab (top-level).** Ship management currently lives BURIED under Logistics (Ships / Ship Equipment); promote it to a first-class, SCALABLE screen: a sortable/filterable list or grid of every hull, tap one -> its equip view (paper-doll + spares list, install/uninstall as BUTTONS). Scales to 50+ ships (the current per-captain flow does not) and declutters Logistics. Natural home for the future ship roster + the 0.13.2 ship crafting.
  3. **NAV SVG ICONS** (needed because 6 tabs cramps a 375px phone, ~62px/tab, so text shrinks or wraps): add SVG icons (currentColor so they THEME-recolor + stay crisp, NOT emoji) to all bottom-nav tabs; keep the label as the aria-label even if the visible text shrinks/drops (a11y). 6 icon tabs is a comfortable mobile pattern (about the practical bottom-bar ceiling).
  MOCKUP-FIRST (spatial + it is the NAV): mock the icon'd 6-tab bar (desktop + phone) AND the Ships screen before any code. SEQUENCING: finish 0.13.1 (Home dashboard) FIRST; this is its own effort (its own 0.13.x, or folded with the 0.13.2 ships/crafting work). ⚠️ PROD-RELIEF question OPEN (user to decide): a small ROBUST click-to-pin interim (click a tile -> tooltip pins open -> the action button is always reachable) shipped as a HOTFIX off main for relief while the redesign is built, VS letting the intermittent zoom bug ride until the Ships tab lands.
  - **✅ RESOLVED 2026-08-31: this is 0.13.2** (own release, after the 0.13.1 dashboard, before 0.13.3 crafting). NO interim hotfix, the intermittent zoom bug rides until 0.13.2 ships (user chose to hold ALL tooltip changes for the redesign).
  - **EQUIP-SCREEN DESIGN (user 2026-08-31, MOCKUP-FIRST): drill-down, not popups.** Open Ships -> a fleet STATUS overview (ship total vs max berths/docks, etc). The ship LIST is like today, but tapping a ship HIDES the list and brings up the FULL ship stats/equip screen (the paper-doll, full-screen, NOT a popup). On it: HOVER an equipped item -> its stats (DISPLAY-ONLY, no install/uninstall in the tooltip). TAP a slot -> a COMPARISON view in 3 parts: [ the CURRENTLY-equipped item | an empty slot that FILLS with your candidate | the selectable installable equips below ]. Tap a candidate -> the empty slot populates + shows a SIDE-BY-SIDE stat diff (green up / red down per stat, exactly what you gain/lose) + an INSTALL button. Every action is a real button on a stable surface. Maybe shrink how equip slots display in the status view (smaller footprint), TBD at mockup. COMPACTNESS is the hard part (the 3-way current/candidate/selection on a 375px phone): settle it in the mockup, likely desktop = horizontal row, mobile = stacked (comparison card on top, selection strip below).
  - **PLATFORM: prefer ONE RESPONSIVE design** (same pieces, layout adapts by breakpoint) over two platform-specific UIs (two code paths DRIFT, we just got bitten by that with the phase-label maps + the tooltip). Split to per-platform only as a LAST resort if the mockup proves one layout cannot serve both.
  - **META (user 2026-08-31): the "UI overhaul every few patches" pattern.** Cheap fix (do this): EXTRACT reusable patterns from each UI patch into NAMED shared components (drill-down screen, display-only tooltip, comparison card, icon nav) so a de-facto design system ACCRETES from the patches themselves, tapering the overhauls, WITHOUT stopping for a big design-system epic (that heavy epic is the logged skinning-engine entry, deferred). Build the system incrementally, do not overhaul reactively.

- **Standardized tooltip system: 6 presentation templates, 1 structured payload (user 2026-08-26; ROLLED INTO 0.13.1 with the rest of the post-combat QoL bundle, mockup-first).** "Settle tooltips once and for all." Interim fix already shipped (staging 8a17a7a): the economy-baseline note now wraps instead of clipping on mobile; this epic is the permanent replacement, batched into 0.13.1 alongside salvage-timed-queue, auto-salvage rules, patch-notes accordion, per-item icons, loadout presets, warehouse floating tooltips, and the iLevel redesign. A Tooltips section in Options with TWO dropdowns: Desktop Tooltips {Compact, Normal, Verbose} and Mobile Tooltips {Compact, Normal, Verbose}. Both DEFAULT to Normal. Platform is auto-detected (`matchMedia("(hover: none) and (pointer: coarse)")` -> mobile, else desktop) with the setting as manual override for edge cases (touchscreen laptop). Every tooltip in the game is standardized onto this: call sites pass ONE payload, and (active platform x its density setting) dictates what renders.

  ARCHITECTURE (the maintainable shape, agreed after one correction): the axes do DIFFERENT jobs.
  - **6 presentation templates = density x platform.** These are SIX genuinely distinct layouts/interactions, NOT width tweaks of three. Verbose-mobile may restructure vs Verbose-desktop: more compact in areas, collapse a section behind a tap, reflow to a bottom sheet, abbreviate labels to reclaim real-estate. Each cell is real design work; there is no shortcut around designing all six.
  - **1 structured payload = the DATA source of truth** (e.g. `{name, badges, headlineStat, metaLine, statLines[], signature, flavor, comparison, action}`). Authored ONCE per tooltip. This is the single-source guardrail: LAYOUT diverges freely across the six cells, DATA never does, so no two cells can disagree on a fact (a stat value, iLevel, name).
  - **1 density projection** = which fields are eligible at Compact/Normal/Verbose. Shared logic.
  - **Shared atoms** (StatLine, QualityBadge, MetaLine, ActionFooter, FlavorBlock, ComparisonBlock) authored once each; the six templates are THIN arrangements of those atoms. Keeps six templates from becoming 6x maintenance.

  DENSITY RUBRIC (equipment tooltip as the test case): Compact = name + quality badge + iLevel + headline/slot-signature stat + action ("which one is this, is it better, what do I do"). Normal (default) = today's tooltip (adds grade/type meta line + full stat lines). Verbose = Normal + flavor + comparison-vs-currently-installed + affix tiers / mechanic explanations. The ACTION FOOTER (Install/Uninstall/baseline-note) is NEVER dropped at any density on any platform (that was the mobile bug that kicked this off: footer unreachable/clipped).

  OPEN DECISIONS to settle at design time: (1) two-dropdown STORAGE: save-backed (both dropdowns meaningful on every device, rides cross-device) vs localStorage device-local (show only the active platform's dropdown, simpler, configure each device once). (2) EquipmentTooltip PRESERVE FENCE: it is effectively the Normal-Desktop cell today; to share atoms across all six this epic likely EXTRACTS atoms FROM it (touches it), so this may be the moment the preserve constraint lifts, with user say-so. Alternative: freeze it as the Normal-Desktop renderer and build the other five beside it. (3) the interaction model (tap-pin, 275ms grace delay, hover-follow, viewport clamping via floatingTip.ts) moves INTO the platform layer so call sites only pass a payload, that is most of the standardization payoff.

  BUILD ORDER: part of the 0.13.1 bundle (after the combat 1.0 prod promotion), do NOT tangle into the 1.0 debut. First artifact = a 6-CELL MOCKUP grid (Compact/Normal/Verbose x Mobile/Desktop, same equipment piece in every cell) to settle what each cell does with the space, per the mockup-first rule, BEFORE any code. Then design doc, then build. Pairs with the warehouse-floating-tooltips entry (that becomes one consumer of the standardized system).

- **Item `origin` / provenance field (user 2026-08-26; foundation in 0.14.0 with online).** ROOT FIX for the data-loss bug class just patched: items have no stored provenance, so code INFERS "is this a disposable Standard-Issue floor?" from `blueprintKey === null`, which also matches dev-granted radiant gear and silently deleted it. Add an explicit `origin` field to EquipmentInstance: `"standardIssue" | "crafted" | "loot" | "dev"` (extensible). Then baseline detection is EXACT (`origin === "standardIssue"`) instead of a fragile heuristic, and dev/injected items are self-identifying for anti-cheat. Interim guard shipped 7609c74: `isStandardIssueBaseline(piece)` = `blueprintKey === null && rarity === "standard"` (a real baseline is always standard-rarity; radiant dev items can never match). The origin field SUPERSEDES that predicate once it lands. Schema change -> SAVE_VERSION bump + a migration that backfills origin (blueprintKey null + rarity standard -> "standardIssue", else "crafted"; dev/loot as applicable). PAIRS with the crypto-legitimacy system below (origin is one of the signed attributes).

- **Cryptographic item-legitimacy + "nuke wave" anti-cheat (user 2026-08-26; 0.14.0+ online, BONES-FIRST even if not fully live).** Server-authoritative item signing so injected/tampered/illegitimate items can be detected and purged WITH A FULL REPORT (never silently, the lesson from the data-loss bug this session). DESIGN as described by the user: (1) AUTH via Clerk (or equivalent) through Vercel -> each character gets a unique UUID in an online portal. (2) Every item stores a SIGNATURE/key derived from: the MAKER (creator's user UUID), a PRIVATE/server key, the user's unique ID, and the item's SETTINGS/attributes (its full stat/rarity/origin payload). HMAC-style: sig = HMAC(serverPrivateKey, canonical(maker + ownerId + itemAttributes)). (3) A dev-panel "NUKE WAVE" button: REGENERATE the private key, then for every item RECOMPUTE its expected signature from (maker, private key, owner id, item settings); scan all items; if an item's stored signature does not validate -> DESTROY it AND SEND A FULL REPORT TO THE DEV (maker, owner, every attribute of the item) so it can be investigated. Detects hand-edited/injected items that carry no valid server signature.
  ⚠️ DESIGN GUARDRAILS to settle at build (sparring notes): (a) the signing key MUST live SERVER-SIDE only, never shipped to the client, or players forge signatures, this is exactly the "authoritative economy is the hard retrofit" seam in [[project_fleet_admiral_online_strategy]]. (b) CANONICALIZATION: item attributes must serialize deterministically (stable key order, fixed number formats) so the same item always hashes identically. (c) KEY ROTATION order: "regenerate the private key" invalidates ALL old signatures, so the flow must RE-SIGN every KNOWN-LEGIT item under the new key BEFORE (or as part of) the nuke scan, or recompute-from-source-of-truth so only genuinely-unsigned/mismatched items nuke, else legit gear gets caught. (d) REPORT-FIRST, never silent: the full-detail report is the core requirement (this whole session's lesson: a heuristic that deletes without reporting is how players lose everything unknowingly). Consider a DRY-RUN mode (report what WOULD nuke without destroying) before any live purge. (e) BONES-FIRST for 0.14.0 (user call): even if server validation + Clerk + live nuke are not fully implemented, lay the foundation now, the `origin` field, an item `signature` field, deterministic canonicalization, and a stubbed validation hook, so the live system slots in later without a data reshape. Depends on the online BaaS + authoritative-economy work.

- **Pre-debut FULL-CODEBASE line-by-line audit (user 2026-08-26; HARD GATE before the Combat 1.0 prod promotion, reaffirmed after the data-loss bug).** Before the patch goes live, a very thorough, careful, A-to-Z, line-by-line bug check of the ENTIRE codebase, not just the combat diff. The user has stated this as the plan both before and after this session's bugs. This is a BLOCKING pre-promotion step: the mobile-tooltip / allow-empty / data-loss sequence proved that latent issues (a fragile `blueprintKey === null` heuristic silently deleting items) hide outside the obvious diff. Scope: every silent-deletion / data-mutation path (migrations, salvage, fit/unfit, tick mutations, cap clamps), every heuristic that classifies items/ships/state, every `filter`/`splice`/destructive map on persisted arrays, save/load round-trips, and the offline==live parity surface. Deliver findings as a triaged report; fix criticals before promotion. Consider running it as a multi-agent audit workflow (the user has ultracode/workflow tooling). Prod stays untouched at e282614 until this passes.

- **Player choice: keep vs discard displaced STARTER (Standard-Issue) gear on install (user 2026-08-26; 0.13.1 QoL preference).** Context: install-over now POOLS the displaced Standard-Issue baseline (never destroys it), the safe no-auto-delete default shipped 776180a, so installing a crafted reactor over the starter core leaves the starter core as a recoverable spare. User: "It's only the starter gear. Which we should give the player the choice to decide upon." Add a PREFERENCE (mirrors the existing salvageConfirmPreference localStorage pattern): "When I install over a Standard-Issue baseline: [Keep it as a spare (default) | Auto-discard it]". DEFAULT = Keep (no data loss, the current safe behavior); the opt-in Auto-discard is for players who want zero starter-gear clutter (the worthless +0 floors) without manual Salvage-Bay trips. ⚠️ Only ever applies to GENUINE Standard-Issue baselines (isStandardIssueBaseline: blueprintKey null AND rarity standard), NEVER crafted/dev/loot gear, which is always kept. Pairs with the 0.13.1 auto-salvage rules + warehouse-inline-salvage bundle. Keep the "no silent deletion" principle: even Auto-discard is an explicit player-chosen setting, shown, not a hidden default.

- **ROADMAP MARKERS post-Combat-1.0 (user 2026-08-26).** After the 0.13.x combat/QoL line: **0.15.0 (likely) = the ENTIRE exploration systems set** (a full feature patch; user leans toward this being 0.15.0). **0.16.0 (likely) = a DEDICATED BALANCE PATCH: balance EVERYTHING at once** - every random-chance mechanic (rarity/quality/iLevel rolls, salvage yields, loot, threat forecast variance), every TIME-gate (research/craft/refine/repair/upgrade durations), every cost/material sink, combat tuning (enemy scalars, crafted-vs-baseline power curves, the shield/plating recipes just added at first-pass values), and the T-I..T-X difficulty tiers. TREAT AS FIRST-PASS-TUNABLE until then: new content (e.g. the 6 shield/plating blueprints df53dd5, the drone/weapon ROLE_TEMPLATE + WEAPON_DEF stat lines, the showcase-patrol difficulty) ships with placeholder numbers and is explicitly deferred to this pass, so do NOT hand-tune piecemeal before 0.16.0 unless something is broken (not just unbalanced). Order/numbers not final (user: "most likely 0.16.0"); capture as intent, confirm before scheduling.

- **0.16.0 BALANCE: crafted-defense-vs-Standard-Issue-floor CURVE (structural, user 2026-08-26).** The defensive slots are structurally unlike offense: a FREE Standard-Issue shield/plating baseline carries the hull's ENTIRE authored defense (flat: freighter shield 200, destroyer shield 300 / hull 480), while a CRAFTED defensive implicit scales LINEARLY off item level. Crafted defense therefore only overtakes the flat SI floor above a crossover iLevel. INTERIM FIX shipped 47e81b9 (CRAFTED_DEFENSE_IMPLICIT_MULT 4 -> 10) pulled the crossover from ~iLvl 60 (unreachable: the shield/plating blueprints are tier 1-2, iLevel caps at blueprintTier*20 = 40, Research Lab caps at level 2) down to ~iLvl 14-24 (reachable). But this is a ONE-LEVER band-aid on a multi-lever problem. The 0.16.0 pass should decide the crafted-defense progression HOLISTICALLY across ALL the interacting levers: (1) CRAFTED_DEFENSE_IMPLICIT_MULT magnitude; (2) the per-tier iLevel cap (EQUIPMENT_ILEVEL_CAP_PER_TIER=20) and whether defensive gear should have a different/decoupled cap; (3) the blueprint TIER gating vs the Research-Lab-level-2 ceiling (defensive gear can only ever be tier<=2 today, so iLvl<=40, so it can NEVER reach the "very tanky iLvl 200+" endgame the 2.5a comment envisioned, a mismatch to resolve); (4) the FLAT SI-floor magnitudes themselves (currently = each hull's full authored defense from Unit 1.4's behavior-preserving fold, a LARGE flat number that is the whole reason crafted defense starts underwater); (5) whether the crossover should differ per hull (freighter 200 vs destroyer 300 vs future capital hulls). Decide the intended shape (e.g. SI = a modest floor + crafted scales cleanly above it, vs SI = full hull defense + crafted is a sidegrade) rather than chasing one constant. Interim numbers (mult 10, tiers 1-2, the 6 recipe costs) are ALL placeholders until then.

- **RENAME: Hyperion Legacy -> "The First Cause" (TFC) (user 2026-08-27; 0.13.1, AFTER combat 1.0 ships).** The game's new name is **The First Cause** (ties into the DT / First Cause lore, see [[project_fleet_admiral_first_cause_dt]]). PLAYER-FACING first: the main LANDING PAGE title + banner (Landing.svelte), the browser `<title>` (index.html), and the prototype tab title "Hyperion Legacy [prototype]". Broader sweep (17 files carry the current name): package.json + package-lock name, Root.svelte, UpdateBanner.svelte, README.md, docs/projectdocs (technical spec, master design), several docs/plans. ⚠️ DO NOT touch `SAVE_KEY` ("fleet_admiral_save") or the localStorage keys, renaming them would orphan every existing save. ⚠️ CLARIFY BEFORE DOING: "the folder from HL to TFC" -- confirm exactly which folder/path the user means (the repo dir `fleet-admiral`? a served route `/hl/` -> `/tfc/`? a build-output folder?); the memory notes a `/hl/` -> `/tfc/` path rename. Deferred to 0.13.1; do NOT start until combat 1.0 is out the door.

- **SKINNABLE UI / theming ENGINE (user 2026-08-27; FOUNDATION seedable in 0.13.1, full ENGINE a later dedicated epic 0.14.x+, monetization tie-in).** User goal: make the game's UI itself skinnable (not just colors, which CSS tokens already handle), so that themes with translucency, layered backgrounds, decorative frames / "caps on the outside of a div" (corner brackets, edge glows), blur, panel treatments, etc. "snap into place" and a designer adjusts the SKIN'S ELEMENTS, not the UI code. Intent: design skins, snap them in, later sell them online to support the game.
  ⚠️ SCOPE READ (sparring): this is a skinning ENGINE, not more CSS. Too big for 0.13.1 as a whole (already a loaded QoL + tooltip-system release). BUT the FOUNDATION is the same separation-of-concerns 0.13.1 is already doing:
  - The standardized-tooltip epic (already 0.13.1) IS this principle in miniature: separate CONTENT (payload) from PRESENTATION (templates). Skinning = the same separation at whole-UI scale: STRUCTURE (DOM + logic) vs SKIN (visual chrome).
  - PREREQUISITE = a DESIGN-SYSTEM PRIMITIVE LAYER: extract the repeated UI patterns (Panel, Card, Button, Modal, Frame, Tile) into a few reusable, TOKENIZED components with skinnable "surfaces". Today styling is bespoke per component, so a skin would fight every file; once chrome lives in a primitive layer, a skin is JUST restyling the primitives + supplying decoration assets. Good architecture regardless (DRY UI) and the seam the engine plugs into.
  - "Caps on the outside of a div" = a DECORATIVE-OVERLAY system: a Frame primitive renders skin-defined corners/edges via pseudo-elements or a skin-provided overlay slot, so any panel gets HUD brackets / edge glows without touching its code.
  RECOMMENDED SCOPE: (1) 0.13.1 foundation, aligned with the under-the-hood work already there: EXPAND the token set beyond color (translucency, background layers, frame/border treatments, blur, elevation) and start migrating components onto a small design-system primitive layer AS THEY ARE TOUCHED for the tooltip epic + warehouse work. No engine yet, just stop hardcoding chrome so the surface a skin must hit shrinks + standardizes. (2) Later dedicated epic (0.14.x+, tied to online/monetization): the actual engine, a SKIN PACKAGE FORMAT (tokens + assets + config bundle), a runtime skin loader + switcher, the decorative-overlay system, and eventually a skin STORE with server-gated ENTITLEMENTS. Cosmetics are the ideal monetization vector (need entitlement checks, NOT anti-cheat, so low-risk to sell), ties to [[project_fleet_admiral_online_strategy]]. NET GUIDANCE: do NOT build the engine in 0.13.1, but let 0.13.1's UI work BUILD TOWARD it (tokenize chrome, standardize primitives) so the engine snaps onto a clean surface later instead of forcing a refactor.

- **SKINNABLE-UI SEQUENCING vs 0.14.0/online (user 2026-08-27, sparring resolved): do NOT bundle the skinning engine into 0.14.0.** Split the idea: the skinning ENGINE (primitive layer, chrome token expansion, skin package format, runtime loader/switcher, decorative overlays) is 100% CLIENT-SIDE, zero online dependency; only the skin STORE (buy + entitle a skin) needs online. So online is a prerequisite for SELLING skins, not for the engine. Bundling into 0.14.0 is a trap not a shortcut: the under-the-hood work for online (auth/BaaS/cloud-saves/authoritative-economy seams) and for skinning (UI primitives + chrome tokens) BARELY OVERLAP (different layers), so bundling saves no work and just stacks two large independent architectural changes into one release (harder to test, longer, mutual blocking risk). RECOMMENDED SEQUENCE: (1) 0.14.0 = ONLINE-ONLY, focused (BaaS/auth/entitlement foundation, resist widening). (2) Skinning engine + store = its OWN dedicated release AFTER online, so the store leans on the entitlement layer 0.14.0 built and engine+monetization land together (engine could ship standalone earlier with free/bundled skins if wanted, but since the point is monetization, land them together post-online). (3) FOUNDATION keeps accreting from 0.13.1 (tokenize chrome, standardize primitives as UI is touched for the tooltip epic + warehouse work) so the engine snaps onto a clean surface later, not a refactor. Refines the prior skinnable-UI entry above.

- **ROADMAP LINES 0.13.1 / 0.14.0 / 0.14.1 (user 2026-08-27, sparring resolved). DO NOT fold 0.13.1 into 0.14.0.** 0.14.0 = ONLINE, focused: account creation, ONE-TIME-FILE save import that LOCKS OUT after use (migrates a local save to an account once; the lockout kills save-duping into online, a smart anti-dupe onboarding), online chat. "Under the hood" was hiding TWO different things that need NOT move together: (a) the standardized TOOLTIP epic is actually PLAYER-FACING QoL (better tooltips both form factors), belongs with the QoL work; (b) the SKINNING foundation->engine is the real under-the-hood GUI redesign (chrome tokens + primitive layer + decorative overlays), the piece to defer. RECOMMENDED: **0.13.1 = QoL bundle + tooltip epic** (player-facing, online-independent, ships on its own timeline; the tooltip epic incidentally seeds the skinning foundation for free); **0.14.0 = online-only** (do not widen); **0.14.1 = the GUI/skinning redesign** (foundation->engine, then the skin store) as a POINT RELEASE AFTER online, so the store leans on 0.14.0's entitlement layer and engine+monetization land together (user's own instinct). Rationale for NOT merging: a QoL+online mega-release is a two-headed drop, far harder to test/ship than three focused releases. Refines the two skinnable-UI entries above.

- **0.16.0 BALANCE: item budgeting + the multiplicative-amplification COMPOUNDING (user 2026-08-27, observed in QA).** After the combat-defense rework, defensive stats compound in a way the old ADDITIVE design never had: shield recharge folds as `emitter.shieldRecharge * (1 + innateShieldRechargeMult)`, and `emitter.shieldRecharge` is ITSELF the crafted floored curve (CRAFTED_DEFENSE_RECHARGE_BASE 3 + 0.2/level, quality/rarity compounded) PLUS any rolled recharge AFFIX. So the hull's innate MULTIPLIER amplifies base AND affix together: a well-rolled emitter on an amplifying hull stacks multiplicatively over additively. OBSERVED: an iL8 crafted item took a freighter's shield regen from ~10 to ~33/s (user's read: innate slot amplification + rolled primaries both hitting the same number). Same shape applies to shieldCapacity (mult amplifies base + cap affix). NOT a bug: the intended consequence of making shields MULTIPLICATIVE (the "wired for shields" hull identity), but the item-budget system + amplification now interact untuned. THREADS for the 0.16.0 pass: (1) should the innate mult amplify AFFIXES, or only the IMPLICIT base? (amplify base only, leave affixes flat-additive -> tames the double-dip, keeps hull identity); (2) shieldRecharge specifically now has THREE sources on one stat (own floored curve + affixes + amplification) = the likeliest over-booster; (3) the implicit-vs-affix BUDGET SPLIT (IMPLICIT_BUDGET_SHARE etc.) was tuned for an additive world and may want rebalancing now that half of it gets multiplied. Folds into the crafted-defense-curve 0.16.0 item above (they are the same budgeting/amplification surface).

- **0.16.0 / stat-display consideration: FTL speed + fuel are UNIVERSAL, not exploration-specific (user 2026-08-27, QA).** The Unit 6 panel merged the old Prospecting + Logistics sections into one "Exploration / Prospecting", which mis-files FTL speed (transitSpeedMult) + fuel under a mission-specific header, but they affect ALL mission types (every mission travels). Re-split by SCOPE: a UNIVERSAL band (candidate names Mobility / Logistics / Propulsion, user to pick) = FTL speed, fuel capacity + efficiency, mass, power; vs Prospecting/Exploration (mission-specific) = extraction yield, sensors, cargo. Mirrors the combat groups (Offensive/Defensive/Support are role-scoped, so the economy side should be too). Small panel change (essentially restoring the split the rework collapsed); do in the review pass or when the name is chosen.

- **ANTI-CHEAT SEAM: Effectiveness ceiling + crafted-curve caps = a legitimacy bound (user 2026-08-27).** Once the combat-defense model is the Effectiveness-% form (each defensive stat = installed gear x hull effectiveness, effectiveness a known per-hull ratio with a roster maximum ~200%), the roster's TOP effectiveness combined with the crafted-defense curve CAPS defines the MAXIMUM value any legitimate item could ever produce for each defensive stat. Any item whose stats exceed that computed ceiling cannot exist in the wild -> a tripwire for the future item-legitimacy "nuke wave" (feeds the 0.14.0+ anti-cheat `origin`/cryptographic-legitimacy item above). The model change leaves a comment near the reference constants noting this. Do NOT build validation now; this just records that the effectiveness ceiling is a reusable legitimacy bound, tunable alongside the 0.16.0 balance pass.

- **SCALING ARCHITECTURE: additive-within-prestige, multiplicative-at-prestige (user 2026-08-27, FOUNDATIONAL).** How every future "% effectiveness"-style stat modifier stacks:
  - WITHIN a prestige, "% effectiveness" bonuses stack ADDITIVELY (PoE "increased" style): total = base x (1 + SUM of bonus%). E.g. a +5% hull-effectiveness stat on 100 base hull = 105; stack another +5% = 110 (not 1.05 x 1.05); a summed +200% = 100 x (1 + 2.00) = 300. The percentages SUM, then apply ONCE to the base.
  - AT prestige, prestige adds a SEPARATE MULTIPLICATIVE layer (PoE "more" style): total = base x (1 + SUM increased) x prestigeMultiplier. This is where explosive power jumps live.
  - RATIONALE (user): "be pretty gentle with multiplicative scaling for stats between prestiges, and prestiges will add in its own secondary multiplier." Keeps within-prestige growth gentle + predictable; reserves compounding for the prestige axis. Matches proven ARPG scaling (increased vs more) and the "build ease-of-use, sell peace" value (no runaway stress spirals mid-prestige).
  - APPLIES to hull effectiveness, and by extension every future % stat (shield effectiveness, damage, yield, etc.). The per-hull-type SHIELD effectiveness in the combat-defense model is a hull PROPERTY (a single ratio, the balance lever), not a stacking stat; future "% shield effectiveness" item/talent stats will SUM additively into it under this rule. Display convention (per-hull innate shown as a total % vs a +/- bonus around 0%) to be aligned when the first % stats are actually built (0.16.0-ish). Nothing to build now; this pins the stacking rule for when % stats arrive.

- **SAFETY INTERLOCKS: opt-in endgame risk/reward second difficulty axis (user 2026-08-27, design direction).** Reconciles "risk" with the "sell peace" value via the insight peace != no risk, peace = no UNCHOSEN risk. TWO difficulty axes: (1) Difficulty TIERS I-X (naming TBD) = the accessible main axis, escalating enemy scale + "lose SOME progress if under-prepared" stakes, but RECOVERABLE (lose loot/resources/time, retry), and opt-in (you choose to climb). (2) SAFETY INTERLOCKS = a Tier-X-EXCLUSIVE series of ~20 toggles, each DISENGAGED interlock grants a reward boost + a small enemy-stat scaling bump + a debuff + a permadeath-chance contribution; disengage 10 -> 10 boosts (additively-multiplicative stacks, matches [[the scaling architecture]]) + 10 debuffs + e.g. flat 50% chance a LOSS = permadeath (rolls captain, crew, ship; user open to <100% even at max). A special CURRENCY scales with interlocks disengaged. ACHIEVEMENTS built around high-interlock clears ("Complete campaign chapter 10 on Tier X with 20 interlocks disengaged") award custom chat icons / skins / cosmetics (feeds the skin/monetization system, cosmetic reward for chosen risk, no pay-to-win). GUARDS to design in (Claude push): (a) the PEACEFUL PATH must be COMPLETE: a player can fully progress the economy at safe low tiers, so risk is optional acceleration/prestige, never a gate; (b) INFORMED CONSENT at the moment of choice (unmissable stakes at toggle time AND a per-dispatch confirm when a captain is in permadeath range); (c) SOFTLOCK FLOOR: permadeath must never leave a player unable to continue (always retain a baseline to rebuild); (d) the risk CURRENCY should buy prestige/cosmetic + a self-contained economy, not big MANDATORY power (else it pressures everyone into the risk track and breaks opt-in). Endgame system, far future, not scoped to a near release.

- **FIRST CAMPAIGN + diegetic tutorial (user 2026-08-27; addresses onboarding; scope-flag its release).** Chapter I doubles as the intro + tutorial: the desktop console AI (diegetic, in-fiction) walks a new player through systems one at a time via RPG-style dialogue boxes. Story hook = the jump-gates-explode opening, the previous Captain promoted to Fleet Admiral and shown to a new office. Then guided progressive disclosure: gather first materials -> craft first item -> research -> etc., each system introduced + explained, one-time materials granted so the player actually does it once, blurred background clearing to reveal the relevant panel, a gently flashing coach-mark showing where to tap. Fits the desk-OS aesthetic perfectly (the tutorial IS the console AI). SCOPE FLAG (Claude, per [[feedback_push_back_on_scope]]): this is a DISTINCT system (dialogue engine + coach-mark/spotlight overlay + scripted-step engine + story content). User floated it for 0.14.0, but 0.14.0 is already the online overhaul. Recommend: build the tutorial ENGINE as a clean foundation + ship Chapter I only; layer later chapters incrementally; and weigh whether it ships WITH online or as its own focused drop. Its UI chrome (dialogue boxes, coach-marks, overlays) should be built on the design-system primitives so the 0.14.1 skinning engine can theme it.

- **DEV / ADMIN / MODERATOR panels + ANALYTICS (user 2026-08-27, part of 0.14.0).** Role-gated panels (visible only to dev/admin/mod accounts once online auth exists). Dev panel includes an ANALYTICS dashboard: DAU, feature-usage ("is this feature used often? is this one ignored?"), to tailor updates toward what has traction and seed Discord polls / chat discussions about underused features. Claude notes: (a) analytics-driven prioritization is the solo-dev superpower AND the antidote to scope creep (kill/de-prioritize unused systems, per [[feedback_push_back_on_scope]]); (b) the highest-value metric for a deep game is the RETENTION FUNNEL + where new players DROP OFF (feeds the tutorial/onboarding work); (c) PRIVACY/TRUST: be transparent about what is collected, anonymize, offer opt-out, no creepy tracking, consistent with the player-friendly/"sell peace" ethos; (d) the mod panel + chat moderation matters the moment online chat ships (toxicity management is itself a peace-of-the-community concern).

- **0.14.0 SCOPE FLAG (Claude, per [[feedback_push_back_on_scope]]):** as of 2026-08-27 the 0.14.0 "online" release is accumulating FIVE-PLUS distinct systems: online auth + cloud saves + one-time-file import, online chat, role-gated dev/admin/mod panels, an analytics dashboard, AND the first campaign + a dialogue/coach-mark tutorial engine. That is a two-headed-release risk multiplied. Recommend defining 0.14.0 as the online FOUNDATION (auth/saves/chat/role-gating + a minimal analytics event hook + the dev-panel shell) and sequencing the richer layers (full campaign content, deep analytics dashboards, mod tooling) into 0.14.x point releases. Revisit + partition before 0.14.0 build begins.

- **CORRECTIONS + additions to the above (user 2026-08-27):**
  - The first-campaign entry is **0.14.1, not 0.14.0** (user typo corrected). And it is not just a tutorial: it is the game's NARRATIVE / STORYTELLING ENGINE. Center dialog boxes for exposition, bottom boxes with character portraits for individual speech, scripted progression. It STARTS as the tutorial (campaign Chapter I, which completes immediately) but powers all campaign story delivery. That is precisely why it must be an ENGINE, not one-off tutorial code.
  - **FLAG / MILESTONE LEDGER (user, alongside 0.14.1): a clean-foundation win.** An append-only, idempotent per-account ledger that records milestones AS THEY HAPPEN (e.g. "completed Campaign Chapter I"), so when achievements ship LATER they mark retroactively complete and nothing is forgotten. Builds the achievement backend before achievements exist. Claude refinement: record the SALIENT CONTEXT of each milestone, not just a boolean (e.g. chapter + difficulty tier + interlocks-disengaged + timestamp), so a future granular achievement ("clear Ch10 on Tier X with 20 interlocks") can be satisfied retroactively; accept that truly novel future conditions may be forward-only; VERSION the ledger. Shares an event-emission layer conceptually with analytics, but keep them separate: the ledger is PER-PLAYER, analytics is AGGREGATE/anonymous (different privacy profiles).
  - **Analytics COLLECTION + privacy policy / ToS / consent are 0.14.0** (disclosed at account signup), even though the rich DASHBOARDS come later. Mod tooling is 0.14.0 too (0.14.0 ships in-game chat, which needs moderation from day one). Both agreed.
  - **0.14.1 SCOPE FLAG (Claude, per [[feedback_push_back_on_scope]]):** 0.14.1 is now accumulating the SKINNING engine + the NARRATIVE engine + Campaign Ch I + the flag ledger. Two substantial UI systems in one release is the two-headed-release risk again. Recommend: the flag ledger is cheap/foundational (seed it early, even 0.14.0, alongside analytics event emission); then sequence skinning vs narrative-engine into separate drops. SYNERGY to exploit: the narrative engine's UI (dialog boxes, portraits, coach-marks) is chrome the skinning engine themes, so build the skinning FOUNDATION/primitives first (or under) the narrative UI so it is skinnable from birth. User to pick the order.
  - **PRIVACY STANCE (user, strong + player-friendly):** will NEVER sell data or hand it to third parties; if any third party ever receives data, exactly what + why will be stated clearly; opt-out offered where possible over a small anonymous baseline (analytics = the business's lifeblood, used ONLY to build a game players want, not to monetize the data). 100% transparent. "Treat people the way you want to be treated." (User floated a joke line in the policy; acknowledged it deserves pushback.) **LEGAL-MINEFIELD FLAG (Claude, Omega 13):** good intentions are not legal compliance. Global online accounts + in-game chat (user-generated content) + likely minor players is a real GDPR / CCPA / COPPA surface (consent mechanisms, data-subject rights, age gating, UGC retention/moderation obligations). Get the privacy policy + data handling professionally/legally reviewed before 0.14.0 ships. Claude is not a lawyer; this is a flag to seek real review, not advice.

- **ROADMAP DECISIONS (user 2026-08-27):**
  - **Flag/milestone ledger -> 0.14.0** (confirmed). Ships with the analytics event emission and account backend.
  - **SKINNING DE-PRIORITIZED -> back to "later / unscheduled" in the suggestion box.** It is monetization polish, not core. The full skinnable-UI engine entries above stand as a FUTURE to-do with no version attached.
  - **NARRATIVE ENGINE -> 0.14.1 (replaces skinning).** Rationale (user): it is a FUNDAMENTAL system, not cosmetic. It teaches players how to play AND acts as the PROGRESSION SPINE that UNLOCKS new systems over time as the campaign advances. So the campaign is the gating mechanism for feature reveal, tightly coupled to the flag ledger (completing a chapter sets a flag + unlocks a system). Clean dependency order: ledger (0.14.0) lands before the engine that consumes it (0.14.1).
  - CHEAP HEDGE (Claude): even with skinning deferred, build the narrative engine's UI (dialog boxes, portraits, coach-marks) on clean tokenized primitives anyway (good practice regardless). That keeps future skinnability nearly free instead of a retrofit, without doing the skinning engine now.

- **### 0.14.0 HARD LAUNCH GATE: privacy/legal compliance MUST be confirmed before 0.14.0 ships (user 2026-08-27).** When 0.14.0 approaches, Claude MUST flag this if it is not yet confirmed. Global online accounts + analytics + in-game chat (UGC) + likely minor players = a real GDPR/CCPA/COPPA surface. User will source a PROFESSIONAL/legal review (explicitly NOT trusting forums, Google, community, or AI generation for this, correctly, this is legal-advice territory Claude must not generate). CONTINGENCY: if the compliance cost/effort for CHAT specifically is too high, chat may be HELD OUT of 0.14.0 and slipped to a later point release. So architect CHAT as a cleanly SEPARABLE sub-component of 0.14.0 (accounts/saves/analytics can ship without it). Auth stack = CLERK on Vercel: Clerk is a managed auth/identity provider that offloads much of the AUTH/identity-data + account-security surface (genuinely helpful), BUT (a) verify its current compliance posture against Clerk's own docs, do not assume, and (b) it covers the auth layer only, NOT the chat/UGC or analytics layers, which remain the app's responsibility. Claude can help with the TECHNICAL architecture (clean chat separation, where the consent flow hooks into signup, data-handling structure), NOT the legal content.

- **COMBAT-DEFENSE HOLISTIC REVIEW deferrals (2026-08-27, 3-lens review, NO blockers found):**
  - **0.16.0 - offense-gate healing mask:** `tiebreakByHullPercent` infers "team dealt hull damage" from end-of-battle hull vs a start snapshot (`resolveBattle.ts:1252`). Support-drone HEALING (`resolveBattle.ts:2101`) can mask damage: a weaponless carrier with SUPPORT drones that out-heals incoming damage over 60s reads `enemyDealtDamage=false` and DRAWS a timeout it should LOSE. Within design envelope (weaponless still never WINS; forecast counts only wins so it is unaffected), but a deserved enemy win becomes a draw. Only matters once loss-penalty stakes exist. EXACT FIX: a per-team "ever took hull damage this battle" LATCH set at damage-application time, replacing the end-vs-start proxy. Deferred to avoid touching the combat loop pre-debut.
  - **0.16.0 - crafted shield stats are floats:** the crafted fold does not round (`bridge.ts:687,692`), so a crafted emitter yields a float shieldMax/shieldRecharge (e.g. 7 x 5/6 = 5.833) feeding `advanceShieldRegen` whose comment claims "pure integer" (design S0.4 "never floats"). Deterministic + parity-safe (SI round-trips exact), harmless in combat, but shows a decimal in the panel ("507.4"). FIX: Math.round/floor the crafted shield cap + recharge at the bridge fold (restores the integer invariant + cleans the display); update any crafted-combat tests that assert the float values.
  - **0.13.1 - UI-label alignment (dev-only, non-destructive):** 4 reads in App.svelte (`selectedIsBaseline` ~2900, `wasBaseline` ~2963, `scIsBaseline` ~9292, `isBaseline` ~6210/6901) classify "baseline" for DISPLAY with bare `blueprintKey === null`, so a dev-granted radiant spare shows a "will be destroyed" button/modal though the engine then REFUSES (noRecipe) and the item survives. Align these 4 to the shared `isStandardIssueBaseline` predicate so the label matches engine behavior. Dev-only reachability (prod has no blueprintKey-null non-standard items); deferred off the debut path.

- **0.13.1 TOOLTIP REDESIGN: standardize ONE opaque tooltip-surface token (root-cause note, 2026-08-27).** The recurring "tooltip overlap on mobile" reports were never position/z-index: the shared `--color-panel-bg` is only 32% opaque (right for a large panel over the starfield with backdrop-blur, wrong for a blur-less tooltip), so content behind the tooltip bleeds through and scrambles the text. This has now been patched INDIVIDUALLY twice with the same idiom (a faint accent wash over an opaque `--color-bg-mid`): `.currency-tooltip` (2026-07-09) and `.threat-tooltip` (2026-08-27, commit 3cf9c9e). The upcoming tooltip-system redesign should make an OPAQUE tooltip-surface a single shared token / component so no future tooltip repeats this bug. (EquipmentTooltip.svelte is preserve-unchanged, so it is out of scope until the redesign.)
- **MINOR wording (observed 2026-08-27, user QA screenshot, NOT flagged by user): "4 guns" vs "No weapon installed".** The dispatch ship summary reads "Destroyer: hull 600 - shield 300 - 4 guns" while the advisory below says "No weapon installed." If "4 guns" is the hull's gun HARDPOINT capacity (not installed weapons) it is correct, but it reads as a contradiction to a player (especially the tutorial audience). Consider wording the capacity as "4 gun slots" / "4 hardpoints", or showing installed/total. Confirm it is capacity, not a bug, before changing (may be an intentional design decision).

- **DESIGN DECISIONS from the Fable pass, resolved by the user "fix it all" 2026-08-27:**
  - **EquipmentTooltip df53dd5: BLESSED.** The user's own on-branch change (weapon/drone blueprint name resolution) stands. Action during the fix session: update the preserve-unchanged constraint wording + the stale "EquipmentTooltip is UNCHANGED" comments in ShipSystemsPanel (~27, ~79) to match reality. The file itself stays as the user left it.
  - **"4 guns" -> "4 hardpoints":** confirmed it is weaponHardpoints (mount capacity), not a bug. Doing the wording tweak (App.svelte ~8083) for tutorial-audience clarity.
  - **Crafted-vs-SI mass asymmetry: ACCEPTED as a deliberate power-for-speed tradeoff for the debut; magnitude tuning deferred to the 0.16.0 balance pass.** SI combat gear is mass 0, crafted carries real mass (weapon 12 / emitter 8 / plating 20 / pod 14), so a first crafted install trades ~19% transit speed for combat power. This partially tensions "first crafted tier is always worth making", so 0.16.0 should revisit whether SI gear should carry a small non-zero mass (shrinking the delta) or crafted mass values should drop. NOT changing values now (no balance change wedged into the debut). Recorded per the user's conscious sign-off.
  - **Reactor gate direction (P2-3): STILL PENDING the user's call** (peace-override: extending the patrol reactor-block to extraction could strand a reactor-less player). Awaiting the T6 subagent's reactor-recoverability finding, then Claude brings the call to the user.

- **0.14.0 ONLINE compliance-shaping decision (user 2026-08-28): DEFER CHAT (fully code-gated OFF) + add one-way DEV-MESSAGES instead.**
  - **In-game CHAT is deferred.** Implement it later, but for now gate it OFF at the CODE level, not just hidden UI: no live endpoint, no stored messages, no waiting table. "Off" = the surface does not exist. Flipping it on later is a deliberate act bundled with doing the chat compliance (moderation, retention, minor-safety) properly. This removes the ENTIRE heaviest legal surface (user-generated content) from the 0.14.0 launch. Matches the earlier "chat as a separable/holdable sub-component" recommendation.
  - **DEV-MESSAGES (dev -> player broadcast) instead:** a banner-style announcement + an in-game MAIL inbox for dev updates / patch notes, authored by the dev via the dev panel. NOT user-generated content (players only receive), so it carries none of the chat moderation/liability burden. Also a genuine feature: "the dev is present" goodwill + a soft engagement/retention nudge. Implementation: BROADCAST (same message to all) is lightest (bulletin, ~zero personal data); if dev-mail tracks per-player read/unread, keep it minimal (a read flag only).
  - **CLAUDE HONEST CAVEAT (do not over-count coverage):** deferring chat lifts the UGC surface (#1) but NOT the privacy (#2, GDPR/CCPA) or minors (#3, COPPA/GDPR-K) obligations, which are triggered by ACCOUNTS + analytics collecting personal data, chat or no chat. So this is a large reduction, not a full clearance. Pair it with DATA MINIMIZATION (truly anonymous aggregate analytics, no PII especially from minors) to shrink #2/#3, which also makes the still-required professional/legal review cheap and short. Ties to the [[0.14.0 HARD LAUNCH GATE]] (privacy/legal review) above. Claude is not a lawyer: this shapes the surface, it does not replace the review.

- **0.14.0 PRIVACY / DATA ARCHITECTURE (user 2026-08-28, Claude endorsed): NO PASSIVE COLLECTION, OPT-IN ONLY, NO PII.** Core: comply with privacy law by not gathering ANYTHING passively; all data collection is explicit opt-in. Design:
  - Signup carries an age self-attestation checkbox (13+ recommended for the ACCOUNT gate, NOT 18: 13 is the COPPA line; 18 would wall off much of the audience). Unchecked does NOT block signup but gates future age-controlled features.
  - Options has an OPT-IN-ONLY data toggle (default OFF) with a "what is collected + why" window (careful wording). Collect only NON-identifying technical fields (platform / OS / browser), used to prioritize the fix schedule toward the most-affected players. In-game bug reporting reuses this info (naturally opt-in via the user clicking report).
  - AGE-GATED OPT-IN: if the 13+ checkbox is unchecked OR a backup birthdate check is under 13, opting in is BLOCKED entirely.
  - CONSENT RE-ACCEPTANCE: adding ANY new collected field/purpose RESETS everyone's acceptance (they must re-agree). This is the correct GDPR "consent specific to disclosed purposes" mechanism (most products get it wrong).
  - Feature age-gates: chat/whispers unavailable under a threshold (recommend CHAT = 16+, higher than the account gate, given chat's elevated risk; do not collapse all gates to one number).
  Claude ADVICE FOLDED IN: (a) a birthdate is itself PII: if collected for the backup check, compute over/under at entry and store ONLY the boolean flag, discard the raw date; (b) self-attestation is weak but fine here because no-collection-without-opt-in means an under-13 who lies still has zero data taken: just add a path to handle a discovered-underage account (delete + block); (c) keep bug-report payloads to non-identifying technical fields and show the user what is sent (a save file or free-text can smuggle PII). Ethos: "treat everyone how I want to be treated"; a genuine trust advantage. Still not a substitute for the [[0.14.0 HARD LAUNCH GATE]] professional review, but it shrinks that review to a short "confirm thresholds + consent wording" conversation. Pairs with the chat-defer + dev-messages decision above.

- **0.14.0 PRIVACY layer 2: GRANULAR PER-DATA-TYPE consent (user 2026-08-28, Claude endorsed as best-practice).** On top of the category opt-in: when opted in, a window gives full GRANULAR control over exactly what to submit. Per data type it shows: Data Type, a "Can this be used to personally identify you?" flag, and a careful plain-language description of what it does + what it is for. Each is an individual checkbox (checked = provide that field, unchecked = do not). This is the GOLD-STANDARD consent model: GDPR FAVORS granular per-purpose consent over bundled "accept all", and the per-field "can this identify?" column is a rare, trust-building transparency touch. Composes with the consent-re-acceptance rule (a newly-added field appears UNCHECKED = fresh active consent; note pre-ticked boxes are INVALID consent under GDPR, so new fields MUST default off). Claude CAVEAT (the one that matters): the MOSAIC / FINGERPRINT effect: fields that are non-identifying ALONE (platform, OS, browser, screen size, timezone, language) can COMBINE into a browser fingerprint that identifies. So judge each "can this identify?" label on the COMBINATION actually collected, not each field in a vacuum, and keep the collected set COARSE (e.g. "browser: Chrome", not exact version + GPU) so each honest "no" stays a no even combined. This is the single spot most worth the professional review. Implementation note: group the toggles ("Technical non-identifying" vs "Diagnostic detail") so granular does not become a wall of 40 switches. Builds on the no-passive-collection / opt-in-only / age-gated privacy architecture above.

- **0.14.0 PLANNING + SCOPE expectation (user 2026-08-31).** 0.14.0 (online) is the LONGEST patch: infrastructure, not a feature. User expects the PLANNING PHASE ALONE to take DAYS TO A WEEK+ (not the minutes/hours of prior work), and it should, rushing online architecture causes security holes + expensive retrofits. Treat planning as its own multi-stage effort: architecture brainstorm -> BaaS/auth/data-model tradeoffs -> privacy/consent -> a PHASING plan -> per-phase plans. ⚠️ THE CENTRAL LEVER (Claude): how much becomes SERVER-AUTHORITATIVE, and whether online can be PHASED rather than one monolith. Spectrum: (a) ADDITIVE FIRST = accounts + cloud SAVE-SYNC + the online bones (dev-messages, in-game mail, opt-in privacy framework), client stays authoritative (the "seams keep online additive" path, shippable, no economy rewrite); (b) AUTHORITATIVE = server runs/validates the sim so saves can't be forged, unlocks trustworthy leaderboards + PvP + FRAUD-RESISTANT REFERRALS, but the big expensive retrofit. STRONG recommendation: do NOT ship as one monolithic 0.14.0, ship the additive layer first, then layer authoritative-economy/anti-cheat + leaderboards/PvP/referrals as later phases (same incremental-cadence instinct one scale up). User may time a GROWTH PUSH around the 0.14.0 launch (mostly co-workers playing now); a growth push amplifies whatever it lands on, so the careful foundation SERVES the growth goal, not in tension with it. See [[project_fleet_admiral_online_strategy]].

- **0.14.0 REWARD / INCENTIVE model (user 2026-08-28, RESOLVED after Claude flagged a consent-coercion risk).** Original idea: reward the DATA OPT-IN with an exclusive currency stipend + a "DALM" chat badge + a gameplay buff. Claude STOPPED this (user had asked to be stopped if murky): under GDPR consent must be "freely given", and rewarding the opt-in (especially with a gameplay BUFF) creates a detriment for declining, which can render the consent NOT freely given and RETROACTIVELY INVALIDATE it, undermining the whole careful consent architecture. RESOLUTION (two tracks, hard wall between):
  - **PASSIVE-DATA OPT-IN: left completely alone, ZERO incentive of any kind** (no currency, no badge, no buff). It must never be seen as a bribe/reward, so the freely-given consent stays airtight.
  - **ACTIVE PARTICIPATION is where ALL the rewards live** (rewarding an ACTION / contribution is clean, unlike rewarding consent): in-game POLLS + SURVEYS ("what should I build next / which feature do you use / rank these"), a feedback box, playtest program sign-ups, and BUG REPORTS. Reward richly with the exclusive currency + chat badges + stacking buffs + opt-in patch-notes thanks. BONUS: active feedback (a poll saying "62% want more ship variety") is MORE direct + actionable for "where to point the fix schedule" than passive analytics could ever be, so this is an upgrade, not a consolation.
  - **BUG REPORTER track stands** (permanent Bug Reporter badge + stacking Bug Catcher / Bug Tattletale etc. for more verified reports; currency per verified bug; opt-in patch-notes credit). Reporting is a contribution, so rewarding it is clean.
  - **REFERRAL BONUSES (user 2026-08-31, 100% wants; 0.14.0+, needs online / accounts).** Refer friends via a link or code; when a referred player clears the gate, the REFERRER earns rewards: a referral currency + chat badge(s), possibly TIERED (refer 1 / 5 / 10 -> escalating flex for enthusiastic recruiters). FLEX not power (no P2W), same wall as every other reward track. Referring is a contribution, so rewarding it is clean, and it fits the privacy framework (the referral relationship is data, so consent + age-gates apply; rewarding the ACTION is fine, unlike rewarding the passive-data consent). ⚠️ THE KEY DESIGN TRAP = the playtime gate + self-referral fraud. User's proposed gate: "the referred player reaches a certain TIME ONLINE PLAYED (leave the game open and you are basically guaranteed it)." That is wonderfully player-friendly but also FARM-friendly: a folder of parked fake accounts farms self-referrals, and because this is an IDLE game even progression milestones tick up on a parked tab. So the gate wants an ACTIVE-ENGAGEMENT milestone (a real decision the player makes, not just elapsed / idle time) PLUS the device / account anti-abuse heuristics online needs anyway. Design the gate WITH the authoritative-economy / anti-cheat retrofit (see [[project_fleet_admiral_online_strategy]]), not bolted on afterward. Balance: low enough that every real referred friend clears it without thinking, high enough that a tab-farm does not.
  - **CHAT BADGES + buffs as a general system are fine** as long as a badge's SOURCE is a contribution/achievement, never the privacy opt-in. (Open brainstorm the user flagged: permanent vs feature-tied-temporary badges; where the stacking buffs apply.)
  - CAVEAT (Claude): keep POLLS/SURVEYS ANONYMOUS (no name, no linking answers to a person) and reward PARTICIPATION not specific answers, or a rewarded survey collecting identifiable data slides back toward "paying for personal data" and the freely-given question returns. Builds on the privacy layers above; still wants the short professional review at the [[0.14.0 HARD LAUNCH GATE]].

- **SAFETY INTERLOCKS reward-philosophy (user 2026-08-28, Claude framework, LOCKED direction). Resolves "how to make hard content worth doing without gate-locking the risk-averse."** The insight: it is not HOW MUCH you reward, it is WHAT you reward. Split reward into THREE and treat each differently:
  1. **PROGRESSION / POWER** (what you NEED to advance + complete) -> MUST be fully obtainable on the CALM path. Never exclusive to hard content. This is the line that protects the "sell peace" value.
  2. **EFFICIENCY** (the same progression, FASTER) -> this is what hard content sells. An SI run is not the ONLY way to earn currency/loot/XP, it is the FAST way (1x calm, ~3x juiced). The efficiency gap must be MEANINGFUL (or pushers ignore it) but the 1x calm path must reach EVERYTHING (or peace is betrayed). This gap is THE number to tune in the 0.16.0 balance pass.
  3. **PRESTIGE** (cosmetics, titles, leaderboard rank, chat badges, bragging rights) -> the elite carrot, can be as exclusive + hard as you like.
  RULE: **GATEKEEP FLEX, NEVER POWER.** Elitists/pushers get exclusive titles + leaderboard spots + shinies (satisfies gatekeeping desire); the risk-averse reach 100% power + 100% collection on the calm path, just slower, losing NOTHING they needed. "TWO LANES, ONE DESTINATION": the calm lane (collection, achievement lines, crafting mastery, steady peaceful accumulation, a REAL endgame) and the risk lane (SIs, endless-wave sim, leaderboards) both END at full power + full collection; efficiency is the bridge that makes the risk lane worth it without making it mandatory. ALSO give the CALM lane its OWN prestige (completionist titles, "crafted 1,000,000 of X" achievements) so collectors have status to chase through patience, not just risk: nobody is the lesser player. KEY DIFFERENTIATOR (born from the user's own WoW group-toxicity history): the hard content is SINGLE-PLAYER + self-sufficient (computer-controlled fleet, zero social pressure, no one berating your DPS), and leaderboards are ASYNC (snapshot scores, never live groups). This is literally "M+ without the toxic room": build the hard content the risk-averse-but-challenge-curious would actually touch. Ties to [[the endless modes feature below]] and the Safety Interlocks entry above.

- **ENDLESS MODES endgame feature (user 2026-08-28, future). Links to the SI reward-philosophy.** A series of ENDLESS MODES for endgame: you set up your captains/ships with the builds/gear you want, start, and grind through endless waves of enemies. SCORE = waves completed + time spent + (other factors). A public LEADERBOARD "for all to see and gawk at." Structure: WEEKLY LADDER RESETS, achievements, rewards for rankings, chat badges, and CUSTOM rewards (special skins, etc.). HARD RULE: **NO P2W: the ladder's exclusive rewards are EARNED, never purchasable.** (Reconciles with the sellable-skins monetization above: cosmetics can be SOLD in a store AND separately EARNED on the ladder, because cosmetics never affect power, so neither is pay-to-win; keep the ladder-exclusive rewards earn-only for prestige integrity.) This is the async, solo, pressure-free competitive endgame that keeps the game alive after the current content is over, and it is exactly the prestige lane the SI reward-philosophy points at.

- **RARE COMBAT ENCOUNTERS as the EXCLUSIVE source of certain components (user 2026-09-02, future feature, not scheduled).** Combat missions/patrols should have RARE ENCOUNTERS that can REPLACE the encounter that would otherwise appear. A rare encounter drops a GUARANTEED item (whatever that specific encounter is set to drop, e.g. a common or uncommon component) plus a CHANCE at a rarer component on top. **The strategic point (user): this makes combat genuinely WORTHWHILE and creates synergy, because future items will 100 percent REQUIRE those components to build and they will not be obtainable anywhere else.** So combat stops being just an alternate income stream and becomes a required input to the crafting economy: a player who never fights cannot build the top-end gear.
  - Design notes to settle when picked up: which encounters get rare variants and at what replacement chance; whether the rare drop scales with patrol difficulty / faction / FA level; how the guaranteed-vs-chance split is authored per encounter; how it surfaces in the patrol result and the combat log so the player KNOWS something rare happened (it must feel like an event, not a silent line item); and whether the components feed existing blueprint tiers or a new tier gated behind combat.
  - Fits the deterministic sim cleanly: the encounter roll is already seeded, so a rare-encounter substitution is one more seeded draw at wave generation, and it stays offline==live by construction.
  - ⚠️ Balance interaction: this is a POWER GATE (no combat, no top gear), so it needs the peace test applied ([[feedback_build_ease_of_use_sell_peace]]): the gate must be reachable by a reasonable player, not a grind wall, and it must never softlock a player who has lost their combat hulls (an alternate, slower path or a way back should exist).
  - Owner: Operations/combat, so a 0.13.4-or-later release, or its own feature patch. Pairs with the exploration content (0.15.0) and the balance pass (0.16.0).

- **⭐ COMPLETED-EVENTS LOG (user 2026-09-02, prompted by the 0.13.3 salvage-manifest loss; GENERALIZED by the user from a salvage fix into an all-timed-jobs feature).** When a timed job finishes, it should leave a timestamped entry the player can read, listing what they received, with item names in their rarity colors and amounts. Not just crafting: **every time-based event** (refine, fabricate, ship build, research, facility upgrade, salvage, repair, and missions where it makes sense). User's example shape: "Your run of 10,000 [Item] salvage completed. Time elapsed: X. Items received: [Super Awesome Reward] x999." Surfaced on the HOME DASHBOARD as a text or scrolling log of recent completions; a richer parsed/filtered interface can come later and REUSE the same records. **Capped at ~50 entries** (user), oldest evicted, to keep the save from ballooning.
  - **WHY it matters beyond the immediate regression:** every timed job in the game currently completes SILENTLY (the result just appears in inventory). That is an Omega 14 violation ("silent code is indistinguishable from broken code") repeated across every facility, and it is why the 0.13.3 salvage change was able to lose the manifest without anything else noticing. It also fixes a hole 0.13.3 Unit 4.4 could not: a job that starts AND finishes inside one offline catch-up is currently never observed at all.
  - ⚠️ **DESIGN CATCH 1, load-bearing: log per ORDER/BATCH, not per JOB ITERATION.** The user's own example ("your run of 10,000") implies this. A per-iteration log would let one 10,000-batch evict every other entry and blow the 50-cap instantly. So an entry should accumulate a running order's yield and emit ONE summary when the batch completes OR when the player cancels it partway (the user's explicit "stop partway through" case).
  - ⚠️ **DESIGN CATCH 2, parity: the timestamp must be INJECTED, never read inside the tick.** Calling Date.now() inside resolveProcesses is non-deterministic, so an offline catch-up would write different timestamps than live stepping and break the offline==live invariant. Thread a clock value in as an ARGUMENT, exactly as the seeded rng is threaded (the live loop passes one timestamp per tick; the offline path passes the reconstructed one). Determinism holds because it is an input, not an ambient read.
  - ⚠️ **DESIGN CATCH 3: the record must be written from inside `resolveProcesses`**, the parity-critical resolver, so offline and live produce identical logs. Store item IDS + amounts (not pre-rendered strings) so the UI can apply `warehouseRarityColor` and so a later richer interface can re-render the same data.
  - Save impact: a new `GameState` field (ring buffer). SAVE_VERSION 40 already belongs to 0.13.3, so it can ride that migration if built in this release.
  - Placement: the Home dashboard, as the natural companion to the existing IN PROGRESS section ("what is running" above, "what just finished" below). Ties to [[project_fleet_admiral_combat_1.0]]'s 0.13.1 dashboard work.

- **⭐⭐ THE UNSCANNABLE VESSEL: an easter-egg rare encounter that FORESHADOWS The First Cause (user 2026-09-02, concept stage, implementation undecided).** You are grinding pirate patrols over and over when a line appears on screen or LATER IN THE COMPLETED-EVENTS LOG describing something you have never seen. **A mysterious, unrecognized vessel that cannot be scanned. To your sensors it does not exist.**
  - ⚠️ **REVISED BY THE USER 2026-09-02, SUPERSEDES THE EARLIER "IT DESTROYS YOU" FRAMING: you are NOT destroyed and NOT punished. You NARROWLY ESCAPE, and you are REWARDED.** The user's reasoning, verbatim in spirit: "utterly destroy you" feels bad, and **you do not get punished for lore**. Instead the encounter is a NARRATIVE BEAT plus a bonus.
    - **The beat is prose, not a defeat screen.** The user's example: "The enemy opens fire and before you can blink, your shields are down, and an unknown projectile is hurtling past the bridge viewport. Captain [name]'s XO barks out a command to get the hell out of here, barely escaping from... whatever that was." Note it uses the CAPTAIN'S NAME, so it reads as something that happened to YOUR crew.
    - **The reward: a temporary "lucky to be alive" buff.** User's first pass: roughly 5 minutes, +100 percent drop rates, flavor text "You're just lucky to be alive."
    - ⭐ **WHY THIS IS BETTER THAN THE ORIGINAL (worth preserving as design intent): it builds DRAMATIC IRONY.** For the whole early game the player is trained to feel LUCKY when this silhouette appears (a free drop bonus). So when the DBD escalation arc turns them genuinely lethal later, the betrayal actually lands. Starting with horror is ordinary; starting with RELIEF and converting it into horror is much stronger, and it also makes players actively WANT to encounter it, which is what drives the community-discovery meta-game below.
  - ⚠️ **TWO MECHANICAL DEPENDENCIES this revision introduces (raised by Claude, settle before building):**
    1. **The game has NO timed-buff system.** Combat status effects are in-battle only and talents are permanent; a real-time, global, expiring drop-rate modifier is NEW persisted infrastructure (an expiry the tick honors, offline-correct). Not hard, but it is a feature rather than flavor text, and it would likely serve other future buffs too.
    2. **A time-based buff collides with OFFLINE CATCH-UP.** The encounter can fire during a two-day offline advance, in which case a 5-minute timer expires long before the player opens the game and they read a log entry about a bonus they never received, which is worse than no bonus. Options: start the timer when the player NEXT OPENS the game, or express the reward as "your next N missions" instead of minutes, which is offline-proof by construction. DECIDE THIS EXPLICITLY.
  - **WHY THIS IS BIGGER THAN A RARE ENCOUNTER: it is a seeding mechanism for [[project_fleet_admiral_first_cause_dt]]**, the already-designed north-star antagonist and Dimensional Traversal epic. Planting an unscannable ship NOW, cheaply, inside content players already grind, buys years of foreshadowing that pays off when The First Cause actually arrives. Players screenshot anomalies and argue about them; this is what makes a long game feel DEEP rather than merely long. Strongly recommend planting it well before the payoff exists.
  - **The completed-events log is the discovery surface, not an accident.** The user connected these two ideas in the same breath: you find the encounter as a LINE IN YOUR HISTORY that matches nothing else in the game. That means the log entry needs to be deliberately anomalous (unknown vessel, no scan data, no loot row) rather than a normal defeat line.
  - ✅ **PEACE TEST: RESOLVED, and resolved better than the original recommendation.** Claude had flagged that a permanent hull + installed-gear loss is an unpreparable punishing random event that [[feedback_build_ease_of_use_sell_peace]] rejects, and recommended it merely DISMISS the player (reuse the `limpingHome` defeat state, lose the run not the fleet). The user went further: **no loss at all, plus a reward.** The escape is narrative and the encounter is a net POSITIVE. This is the stronger answer, and it is a good example of the peace rule producing better design rather than just safer design. NOTE: since nothing is lost, `limpingHome` is no longer needed for the early version; the ship simply returns.
  - **Design questions still open (the user has not decided):** one-time discovery vs repeatable sighting; whether the reward is purely FLAVOR (a log line, a lore fragment, an unreadable sensor ghost) or eventually MECHANICAL (a unique unusable-until-later component, which would tie it to the rare-encounter-as-exclusive-component idea logged above); whether a player can HUNT it (a hint trail, rising odds in some region) or it stays purely serendipitous; how rare; whether it scales or is always unwinnable; and whether it ever becomes fightable after the DT/First Cause content lands (a satisfying long-term payoff).
  - **Cheap to plant:** the encounter roll is already seeded, so a substitution is one more seeded draw at wave generation, and offline == live holds by construction. The `limpingHome` path, the combat log, and (once 0.13.3 ships) the completed-events log all already exist. The expensive part is the CONTENT and the restraint to leave it unexplained.
  - Owner: Operations/combat, so 0.13.4-or-later or its own feature patch, but it should land BEFORE the First Cause payoff. Pairs with the rare-encounter framework logged above.

- **⭐⭐ THE DBD ESCALATION ARC: the unscannable vessel becomes a progression system (user 2026-09-02).** Extends the easter-egg entry above into a full long-arc design, and WELDS TOGETHER three previously separate ideas: the unscannable vessel, rare-encounters-as-an-exclusive-component-source, and the [[project_fleet_admiral_first_cause_dt]] north-star. The mystery does not sit beside the progression, it BECOMES the progression.
  - **The arc (user's words, structured):** the encounter is **very, very, very rare at the start**, and its frequency is **gated by CAMPAIGN CHAPTER COMPLETION**, rising gradually as the DBDs (Das Bad Doods, the First Cause's dispatched agents per the lore doc) take a more direct interest in Humanity. **Eventually these ships stop being untouchable**: late-arc they become a rare encounter the player can actually BEAT, and they **drop some of their tech**. (Early on they are not "unstoppable behemoths that kill you", they are untouchable things you escape from and are rewarded for surviving: see the revised entry above.)
  - **Why the structure is strong:** the same content object serves three jobs across the game's lifetime. Act 1 it is pure dread and foreshadowing (unwinnable, unscannable, a line in your log that matches nothing). Mid-game it is a rising threat that signals the story is moving. Late-game it is a rare, prestigious source of ALIEN TECH, which is exactly the "exclusive component you cannot get anywhere else" hook already logged for rare combat encounters. Frequency AND difficulty are both dials on one axis (chapter progress), so the escalation needs no separate systems.
  - ⚠️ **PREREQUISITE, flagged: there is no CAMPAIGN CHAPTER system today.** The roadmap (0.14.0 online, 0.15.0 exploration, 0.16.0 balance) defines no chapter spine, so "gated by chapter completion" needs either (a) a campaign/chapter progression feature designed first, or (b) the dial hung off something that already exists (Fleet Admiral level, Mission Control unlock tiers, story-mission completions, or the DT/prestige loop itself). Decide which before building, because it determines whether this is a small content addition or waits on a whole feature.
  - **Design questions still open:** the exact frequency curve per chapter; when the difficulty crossover happens (and whether it is a hard flip or a gradual weakening); whether the tech drops are a NEW component tier or feed existing blueprints; whether beating one is repeatable or a one-per-chapter set piece; and whether the early unwinnable version stays available later (a player who starts late should still get the dread, not just the loot).
  - **Peace test: see the RESOLVED note above.** The early version costs the player NOTHING and grants a bonus (a narrow narrative escape plus the "lucky to be alive" buff), so there is no punishment to mitigate. The late fightable version is a normal combat encounter and needs no special handling. ⚠️ **The arc therefore has a TONE CROSSOVER to design deliberately:** early sightings are a lucky windfall, late ones are a real fight, so decide when and how the reward framing stops (does the buff persist alongside the danger, or does its disappearance become the signal that something has changed?). The moment the bonus stops arriving is itself a storytelling beat and should be used on purpose rather than left as a side effect of a difficulty dial.

- **⭐ THE COMMUNITY-DISCOVERY EXPERIENCE for the unscannable vessel (user 2026-09-02), and the TECHNICAL CONSTRAINTS it imposes.** The user's intended meta-game: a player posts "Hey, I saw this in my combat log. What is this?", threads appear, the user is asked directly and plays it straight ("Hmmm. I don't know about that. I haven't seen anything like that before."), and the community speculates for as long as it takes until story chapters start making it apparent. The dev's non-answer is part of the design.
  - ⚠️ **CONSTRAINT 1: THE ENCOUNTER MUST BE IDENTICAL FOR EVERY PLAYER.** No randomized designation, no varying stats, no per-run flavor variation. If two players compare screenshots and see DIFFERENT things, the conclusion is "weird bug", not "wait, you saw it too". **Corroboration is the entire engine of a mystery thread**, so the signature, the log line, and the presentation must be byte-identical for everyone, every time. (This is easy to get wrong, because the codebase's instinct is to roll flavor from the seeded rng like everything else in combat does.)
  - ⚠️ **CONSTRAINT 2: IT MUST READ AS AUTHORED, NOT BROKEN.** A player's first instinct on seeing an anomaly in an idle game is "is this a bug?". If the log line resembles a missing string, a null name, an empty stat block or a placeholder, the result is BUG REPORTS, not lore threads. The copy must be clean, deliberately phrased and obviously written by a person: mysterious but POLISHED. Do not lean on visual glitchiness or corrupted-text effects to signal strangeness, because those are indistinguishable from a real defect.
  - **NAMELESSNESS IS THE FEATURE.** "DBD" / "Das Bad Doods" is internal shorthand only (a self-aware joke placeholder, per the lore doc); the in-game vessel should acquire NO name until the story gives it one. An unnamed thing is more unsettling than anything it could be called, and a name is the one piece of information that would let players slot it into a known category.
  - Corollary to the restraint already noted: no codex entry, no achievement, no quest marker, no "???" affordance. While it has no UI, it is a rumor; the moment it has one, it is content.

- **⭐ BUFF SYSTEM: local and global, including dev-granted game-wide buffs (user 2026-09-02).** The user intends to be "the generous dev that hands out game-wide buffs and such", so a real buff system is planned: **LOCAL buffs** (earned by a player through events, e.g. the unscannable vessel's "lucky to be alive" +100 percent drops) and **GLOBAL buffs** (granted by the dev to everyone, e.g. a double-drop weekend). This makes the unscannable-vessel buff the FIRST CUSTOMER of the system rather than a one-off hack, so build the system and let the encounter use it.
  - ⚠️ **CATCH 1 (the important one): a global buff plus OFFLINE CATCH-UP needs a TIMELINE, not a boolean.** If "double drops" runs for a weekend and a player is offline four days spanning it, the catch-up must know the buff was active for PART of the elapsed window. A simple "is the buff on now" flag gives one of two wrong answers: players lose bonuses they earned while away, or they retroactively receive bonuses for time before the grant. So a global buff wants a START and END TIMESTAMP PAIR that the offline advance INTERSECTS with the elapsed span, and the economy must be able to apply a modifier to only part of a catch-up. That is a meaningfully harder shape than a flag and should be designed in from the start rather than retrofitted.
  - ⚠️ **CATCH 2: delivery.** A dev-granted game-wide buff has to REACH a client that is currently offline-first with no backend. Either it is bundled into a build (workable, but then granting a buff is a DEPLOY, not a switch), or it waits on the 0.14.0 online work (a tiny remote config or a signed schedule the client fetches). Decide which is intended, because it determines whether global buffs can exist before 0.14.0 at all. LOCAL buffs have no such dependency and can ship earlier.
  - ⚠️ **CATCH 3: parity and (later) trust.** Any buff that touches the economy must keep offline == live (the modifier has to be part of the deterministic advance, not a UI-layer multiplier), and once leaderboards/anti-cheat exist a client-trusted buff is a forgery vector, so the eventual authoritative model needs the server to own the buff timeline. See [[project_fleet_admiral_online_strategy]].
  - Design questions: stacking rules (do two drop buffs add or multiply, is there a cap); which stats are buffable (drops, XP, speed, yield, credits); duration UI (where does the player SEE an active buff and its remaining time); whether local buffs pause while offline or burn down in real time (the "lucky to be alive" entry raises exactly this); and whether buffs persist through a prestige/DT reset.
  - Owner: local buffs could ride an early 0.13.x/0.14.x release; global buffs are gated on the delivery decision above.

- **⭐ APP-WIDE DESIGN-SYSTEM CONVERGENCE: the `rgba()` tints and the shared glyphs the 0.13.3 Facilities pass deliberately did NOT convert (Claude, 2026-09-02, deferred out of 0.13.3 Unit 6.5 by an explicit scope ruling).** Units 6.1 through 6.4 each hit the same two items, each deferred them "to 6.5", and 6.5 ruled both formally OUT of the release. This entry exists so that ruling is a decision on the record rather than four forgotten TODOs. **Neither is a Facilities problem. Both are app-wide, and each needs ONE deliberate pass across every tab, never a per-tab conversion.** Converting them tab by tab is actively worse than leaving them alone, because a half-converted app has two dialects on screen at once and regresses the already-shipped Home (0.13.1) and Ships (0.13.2) surfaces, which the direction rule (old adopts new, never regress shipped new work) forbids.
  - **ITEM 1, the `rgba(var(--color-X-rgb), N)` TINTS.** The 0.13.3 design system locked `color-mix(in srgb, var(--color-X) N%, transparent)` as the tint form, because `color-mix` composites against whatever is actually behind the element in either theme, while an `rgba()` triplet over an opaque background can go muddy when the surface beneath it changes. Every new class the release wrote (`.cq-*`, `.cl-*`, `.cfg-*`, `.fsheet-*`) already uses `color-mix`. The pre-existing sites still on `rgba()` triplets, named so nobody has to re-find them: **`.mission-card`, `.buy-btn`, `.dev-btn`, `.research-bar-track`, `.research-readout`.** These five are rendered on essentially every console in the game, Home and Ships included, so converting them is an app-wide restyle with an app-wide QA cost, not a Facilities tidy-up.
  - **ITEM 2, the SHARED GLYPHS.** Three emoji/text glyphs were left as-is while the Facilities passes converted 11 other sites to stroke-SVG `<Icon>`: **the `◈` credits sigil** (a global currency glyph, ~13 surfaces including Research, Shipyard, Fuel Depot, the Shipyard hull cost line and the offline summary), **the bare `⚠` warning glyph** (~6 surfaces including the shipped Ships tab), and **the `⏱` stopwatch** (one site, the Shipyard hull cost line, which SHARES ITS LINE with the credits sigil, so converting it alone would put a stroke-SVG clock immediately beside an emoji sigil, visibly worse than either uniform choice). The stopwatch is the clearest evidence for why these three travel together.
    - **A FOURTH GLYPH JOINED THIS LIST (Claude, 2026-09-02, 0.13.3 Unit 7.0): the literal `✓` dingbat.** Unit 7.0 converted the ONE site that made a single console contradict itself (the Research console rendered `<Icon name="check">` on its Upgrades readiness rows and a literal `✓` on its researched blueprint cards, two different marks for one meaning on one screen). **One site remains and was deliberately NOT touched: the Home dashboard's caught-up mark**, `<span class="home-caughtup-check" aria-hidden="true">✓</span>`. Converting it is a cross-tab edit to a SHIPPED 0.13.1 surface, which is precisely what this entry says must happen in one sweep and never tab by tab, so it belongs here with the other three. It is already `aria-hidden`, so the conversion is purely visual.
  - **RECOMMENDED SHAPE when it is scheduled:** ONE release (or one clearly-scoped unit inside one) that converts all five tint selectors and all three glyph families in a single sweep, with a full-surface QA in both themes rather than a delta, since the blast radius is every tab. It is a good candidate to pair with whatever release next touches shared chrome anyway.
  - **NOT A BUG, and not urgent.** Nothing here is broken today: the `rgba()` tints render correctly in both current themes, and the emoji glyphs are legible. This is consistency debt with a known, bounded fix, logged so it is paid deliberately and once.
  - ---
  - **✅ SCHEDULED: 0.13.5, and the SCOPE IS WIDER THAN THIS ENTRY ORIGINALLY DESCRIBED (user decision, 2026-09-04).** Raised as QA case F3 during the 0.13.3 QA pass, where the machine run found that the Facilities passes converted section headers and readiness marks to SVG but left **item and material tiles, and the Facilities overview cards, rendering literal OS emoji** that do not follow the theme. The user's ruling: **convert everything that can be converted, across the board.** That explicitly includes the four glyph families above AND every other emoji in the app, whether it is a graphics placeholder or an intentional glyph. The example the user gave: the padlock emoji on locked buttons should become a real SVG lock. Recommendation to defer it out of 0.13.3 was accepted, so 0.13.3 ships as-is and this lands in 0.13.5.
  - **⚠️ WHY 0.13.5 SPECIFICALLY, AND WHY THIS IS AN ARCHITECTURE TASK, NOT A FIND-AND-REPLACE.** The user's stated long-term plan is **paid cosmetic packs**: a pack bundles a colour theme, a layout skin, a custom ICON SET, lighting effects, and sells as one unit. That makes the icon layer a **product surface**, and it changes what "done" means here. A sweep that merely swaps each emoji for a hardcoded `<Icon name="x">` at hundreds of call sites satisfies the visual goal and then has to be unpicked when packs arrive. Build the seam FIRST:
    - every glyph resolved through a **named registry**, never a literal at a call site (`Icon.svelte` already has the bones: `IconName` is derived from data via `as const satisfies`, so a missing name is a compile error rather than a blank square);
    - the active set **swappable at runtime**, alongside the theme, since a pack changes both together;
    - a **defined fallback** when a pack omits an icon, so a partial pack degrades to the base set instead of rendering nothing;
    - and no pack able to ship a glyph that changes MEANING (a pack may restyle the warning mark, never replace it with something that does not read as a warning).
  - 0.13.5 is the right home because it already owns Options, theming and the accessibility pass, and icon packs and colour themes are the same swappable-presentation system. Designing that seam once, with theming, is the whole reason to wait. **Do the registry and pack-readiness design BEFORE the sweep**, or the sweep becomes the thing that blocks packs.
  - Accessibility overlap worth folding in: the same pass should give the converted tiles real accessible labels (see the 0.13.3 QA finding that Salvage Bay spare tiles and Warehouse material tiles announce as "iL 40" or "0% 4.31K" with no item name), because an icon-only control without a label is exactly what the accessibility pass exists to catch.

- **⭐ A LINT GUARD FOR THE INSTALL VOCABULARY (Claude, 2026-09-02, found clean during 0.13.3 Unit 6.5's terminology sweep).** Unit 6.5 swept every Facilities surface for player-facing "fit" / "fitting" / "fitment" wording and found **zero** occurrences: the vocabulary rule is currently fully honored across the crafting consoles, and the one place the engine's `"fitted"` reject token reaches a player already renders as **"the system is installed on a ship (uninstall it first)"**. So there was nothing to rename. **The risk is not the present state, it is drift**, and the user has had to correct this terminology twice.
  - `src/lib/helpTopics.test.ts` already guards exactly this for ONE data file ("uses install vocabulary, never fit/fitment/fitted/unfit"). The suggestion is to generalize that idea to a single test that scans **player-facing strings across `src/App.svelte` and the components** for the banned words, while explicitly ALLOWING the code identifiers (`fitEquipment`, `unfitEquipment`, `canFitEquipment`, the `"fitted"` reason token, `combatFit.ts`), which are internal names and deliberately out of scope.
  - **The hard part, and why it was not just built:** separating player-facing copy from identifiers and comments needs a real scanner rather than a naive grep, or the guard fails on the engine's own function names and gets deleted the first time it cries wolf. Worth doing carefully, or not at all.
  - Deliberately NOT built inside 6.5: that unit's brief listed six items and this would have been a seventh, and the standing rule is clean foundation now, log the rest.

- **⭐ SALVAGE LANES: parallel salvage slots bought on a Salvage Bay Upgrades tab (user, 2026-09-04, explicitly "for later").** The player's framing: queue 5000 of an item on one lane and get one per minute; buy a second lane and the same queue yields two per minute, because the lanes run concurrently. Throughput, bought with an upgrade track, on top of the existing queue depth.
  - **THE SEAM IS ALREADY BUILT, and the code says so.** `SALVAGE_SLOT_COUNT = 1` in `tick.ts` carries a note left when the queue engine shipped: "If a later release does want parallel salvage, this becomes a derived helper with the same signature the adapter already calls, and nothing else moves. FIRST-PASS TUNABLE." The promotion pass already asks each facility for its own free-slot count (`hasFreeSlot`), exactly as the Refinery asks about `refineSlotCount`, so lanes are a slot-count change and not an engine change.
  - **WHAT IS ACTUALLY MISSING** (the same note lists it): the Salvage Bay has **no level track at all**, so this needs rungs, costs, a console Upgrades block, and a save decision for the new level field. The Refinery's `addRefineSlots` rung is the working precedent to copy, and the shared `facilityUpgradeButton` / `canBuildFacilityUpgrade` / `startFacilityUpgrade` machinery already exists. After 0.13.3 the Salvage Bay has a two-tab rail (Salvage, Rules), so this adds a third tab rather than inventing navigation.
  - ⚠️ **THIS DELIBERATELY REVERSES A LOCKED CHOICE, and that is the user's call to make.** The same comment records why the bay shipped single-slot: "That keeps exactly ONE progression axis on this facility instead of two competing ones, and it is why the design asked for a queue here rather than for parallel slots." Lanes add a SECOND axis (talent-bought queue depth, plus credit-bought throughput). That is a legitimate design change, not a mistake being corrected, but whoever builds it should decide how the two axes relate rather than letting them collide: depth is how far ahead you can PLAN, lanes are how fast the bay CHEWS. If a player can buy depth 3 and 3 lanes, make sure the console still reads clearly about which number is which.
  - ⚠️ **PARITY GETS HARDER, not just wider.** More lanes means more salvages completing on the SAME tick, and completion order plus rng draw order must stay identical offline and live. The 0.13.3 bug where two salvages finishing in one tick discarded each other's results was found precisely because the queue made that case reachable; lanes make it the common case rather than the edge one. Any lanes build needs parity tests with several lanes completing simultaneously, not just sequentially.
  - **Interacts with auto-salvage's manual headroom.** Auto-salvage deliberately never fills the last QUEUE slot so a player can always act. With lanes, check whether that guarantee should also apply to lanes, or whether headroom on depth alone is enough. Getting this wrong means the rules can occupy every lane forever and a manual salvage can never win the race.
  - **Duration context:** as of the user's 2026-09-04 decision the base salvage is 60 ticks (60s), so one lane is one unit per minute and the player's "2 per minute on 2 lanes" is literally the arithmetic. Speed rungs were also floated as a future lever, so decide whether the Upgrades tab sells LANES, SPEED, or both before writing the rung table.

- **⭐ SHIPYARD BERTHS: explicit construction + repair berth upgrades (user, 2026-09-04, "for later"). ⚠️ READ THIS FIRST: MOST OF IT ALREADY EXISTS.** The user described construction berths that can build OR repair, repair berths that can only repair, a repair queue when nothing is free, and a free construction berth taking a waiting repair when no build is queued. **`processShipRepairs` in `tick.ts` already implements that behavior**, so do not rebuild it. Verified 2026-09-04:
  - Bays are a **SHARED POOL** (`shipyardBayCount`), drawn on by both builds and repairs.
  - `shipBuildSlotCount = min(BUILD_CONCURRENCY_CAP, bays - 1)`, described in-code as a **"repair-favored reservation"** and **"the enforced soft-lock invariant"**: a build can NEVER take the last bay a repair would need. This is the user's "they must be separated because if you have ships building in all slots and you lose a battle, then you're screwed" concern, already solved structurally.
  - Repairs claim ANY free bay, so **idle build capacity flexes into repair**, which is the user's "if a construction berth is open, a ship can repair there" rule verbatim.
  - Excess damaged hulls **wait in monotonic ship-id order**, a deterministic implicit repair queue, and that determinism is what keeps offline == live.
  - The user's own worked example (4 hulls home, 2 bays building, 2 repairing, a third slipping in when a build finishes) is what the current code does today.
  - **WHAT IS ACTUALLY MISSING**, and all this entry should cover:
    1. **Berths are not an explicit upgrade.** `shipyardBayCount` adds `+1 bay per build-speed upgrade rung` (marked FIRST-PASS TUNABLE), so a player gets a bay as a SIDE EFFECT of buying build speed and never chooses a berth. Making berths their own rungs is the clearest win here and is mostly a data/table change plus console copy.
    2. **No ship build QUEUE.** Tracked separately as part of the queue-coverage gap; the Shipyard is the most requested of the deferred queues.
    3. **No dedicated repair-only track.**
  - ⚠️ **THE DESIGN QUESTION, worth answering once rather than per facility.** The current single shared number plus the bays-1 cap ALREADY guarantees repairs cannot be starved. A separate repair-only track does not fix a hole; it buys higher total capacity and more player control (buy 4 repair berths and repair 4 hulls while still building 3, where today 4 bays means at most 4 concurrent repairs shared with builds). That is a legitimate want, but it is **the same second-progression-axis pattern as [[salvage lanes]]**, and it would now be the second facility gaining one. Decide whether "a facility has one capacity number" or "a facility has separately-bought specialised slots" is the game's pattern, then apply it consistently, rather than deciding it twice by accident.
  - **If the two-track model wins:** keep the asymmetry the user described (construction berths dual-purpose, repair berths repair-only), because it is strictly safer than the reverse and preserves the existing invariant for free. Preserve the deterministic wait order, and add parity tests for several hulls completing repairs on the same tick (the same hazard flagged for salvage lanes).

- **⭐⭐ MYSTERY REPAIRABLE COMPONENTS: the salvage mystery-box loop, and the reason combat exists (user, 2026-09-04, explicitly "not in spec for right now", logged in full at the user's request).** The most cross-cutting idea logged so far: it wires salvage, combat, prospecting and crafting into one incentive web instead of four parallel systems.
  - **THE MECHANIC.** Every salvage type carries a RARE chance to drop a "Mysterious Repairable Component" (working name, not locked). Each salvage source drops **its own variant**, so the component tells you where it came from. It is a mystery box: run it through a facility to repair it, and repairing rolls the reward. Opening venue is UNDECIDED, either a specialised new facility or a later Fabricator option; the user explicitly left this open.
  - **THE REWARD TABLE, two bands.** (1) Rare components **available through no other route**, so this loop is their only supply line. (2) A chance at a **UNIQUE ITEM**, also salvage-exclusive: a weapon type obtainable no other way, a module that cannot be crafted, and similar. These are ship systems, so they land in the combat loadout.
  - **THE STRATEGIC POINT, in the user's own framing: the unique items live in COMBAT.** This is the answer to combat being "just pew pew that looks fun". Combat becomes the content gating gear available nowhere else, so it stops being a flavour system and becomes a supply line.
  - **PROSPECTING GETS THE SAME TREATMENT.** Ancient alien ship salvage yields **spec-building modules**, and those alien salvage sources come from PROSPECTING, so exploration gains its own exclusive reward instead of being a resource faucet. Two content pillars, each supplying something only it can.
  - **ITEM LEVEL IS SET, NOT ROLLED (user decision, and it is what makes this work).** A salvage item's iLevel is FIXED, matching the reward a player should expect at that difficulty. If max iLevel for some high-level content is 5000, salvage from that content is iLevel 5000, and a repaired component yielding a ship system arrives at iL5000 immediately. ⚠️ **This is also what PRESERVES FUNGIBILITY.** A ROLLED iLevel would split every material stack along a second axis (300 at iL12, 900 at iL7) and force heterogeneous stacks through storage caps, tile display and batch selection. A SET iLevel per item TYPE keeps a stack one homogeneous number. Any future work must keep iLevel a property of the item type, never of the individual drop.
  - ⚠️ **DECIDE BEFORE BUILDING: this BYPASSES the crafting iLevel ceiling.** 0.13.3's crafting levels rest on a hard, locked cap (`computeItemLevel` clamps to the blueprint tier's ceiling, and the design states the tier cap must never be lifted). Salvage gear arriving at a set iL5000 sidesteps that progression entirely. That may be exactly right, a parallel track where crafted gear is the reliable floor and salvage-unique gear is the lottery ceiling, a well-proven shape. But it MUST be chosen deliberately, because the alternative outcome is that crafting levels stop mattering the day this ships. Decide explicitly: does salvage gear sit ABOVE the crafting ceiling, ALONGSIDE it on different axes, or FEED crafting rather than replace it?
  - ⚠️ **DOUBLE LOTTERY, against the standing build-ease-of-use / sell-peace value.** A rare drop that then rolls again for its reward is two stacked lotteries, the classic feels-cheated shape: a player who finally lands the rare component and then rolls the common band has been punished twice. Consider a pity floor, a visible progress counter toward a guaranteed unique, or making the common band genuinely worth opening on its own. The component itself must never feel like a loss.
  - **Never silently consume.** Opening must be explicit and the result shown in full, the same posture as the salvage manifest (fixed this release for claiming a recovery that never happened). A mystery box that eats itself and prints nothing is the worst possible version of this.
  - Open questions for design time: opening venue (new facility versus a Fabricator tab); whether an unwanted component can be salvaged back; whether variants are per salvage SOURCE or per salvage TYPE (the user said each salvage drops its own, which reads as per source); storage category and cap treatment; and whether unique items are tradeable, salvageable, or terminal.

- **⭐ SALVAGE DURATION: a small base times the item's own factors (user direction, 2026-09-04).** Duration should be a SMALL base scaled by the item's own attributes (iLevel, tier, rarity, quality), replacing today's shape: a large flat floor plus additive iLevel/quality terms on the equipment arm, and a completely FLAT constant on the material arm. Right now a common ore roll and a rare housing take the same base duration, which is the specific thing to fix.
  - The material arm is the gap: `SalvageDurationSpec`'s `{kind:"material"}` carries NO attributes, so balancing has nowhere to land. Give it the item's rarity and tier plus the consumed bucket's quality.
  - ⚠️ **Multiplicative factors compound.** Base times iLevel times tier times rarity times quality reaches hundreds of times a common item very fast, and that is a number you discover in play rather than choose. The equipment arm is deliberately additive today for that reason. Recommended: small base, ADDITIVE contributions from the numeric axes, multipliers only from the categorical ones (rarity, tier), plus a ceiling. Fully multiplicative is fine if that is the intended feel, but it needs a cap.
  - Build the SEAM before the numbers: widen the spec and default every factor to neutral so behaviour is unchanged, then balancing is a numbers pass rather than another visit to parity-critical duration code. The base is 60 ticks by user decision (2026-09-04) and would come DOWN under this model.
