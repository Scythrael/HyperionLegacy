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

- **0.13.1 POST-COMBAT QoL BUNDLE (user-approved 2026-08-26).** A small quality-of-life patch right AFTER the combat 0.13.0 debut. Theme: ease-of-use, fewer clicks, zero new friction (see the user's stated design value: build ease-of-use, sell peace, never stress). Members: (1) salvage-as-timed-queued + its shared refinery/fabricator ORDER engine (both above); (2) AUTO-SALVAGE RULES (below); (3) Salvage Bay slots + speed upgrade (part of the salvage entry); (4) PATCH-NOTES ACCORDION (the existing collapsible-version-history suggestion, now GREENLIT for this patch); (5) PER-ITEM material icons (the existing suggestion); (6) LOADOUT PRESETS / bulk-install (below). NOTE: the update-available banner is ALREADY implemented, so it is NOT part of this bundle (its older SUGGESTIONS entry is effectively done). Build order: the shared order engine first (salvage + refinery both ride it), then the salvage UI + auto-rules, then the independent QoL (accordion, icons, presets).
- **Auto-salvage RULES (user-approved 2026-08-26, 0.13.1 bundle).** Rules that auto-QUEUE salvage so it clears loot clutter hands-off: auto-queue anything at or below a chosen quality tier, and/or auto-queue duplicates. Turns the salvage queue from more-clicks into fewer-clicks. Pairs with the salvage-timed-queue and the existing per-quality salvageConfirmPreference. Never destroys protected/needed gear (respects the current safeguards).
- **Gear LOADOUT PRESETS / bulk-install (user-approved 2026-08-26, 0.13.1 bundle).** Save a ship's gear loadout (combat + economy slots) as a named preset and re-apply it to a hull in ONE action (bulk-install from spares, respecting hardpoint/bay caps and spare availability, skipping what is not owned). Now that every hull has a full slate of slots, kitting out a fresh hull should be one tap, not a dozen. Pure ease-of-use QoL for the new gear system.

- **Quickswap / loadout-preset SCOPE + auto-unequip-on-drydock (user 2026-08-26; refines the 0.13.1 loadout-presets entry).** Questions to settle before building presets: (a) AUTO-UNEQUIP when a ship returns to drydock? Only sensible if COUPLED with one-tap restore (auto-unequip frees the gear for reuse, a preset re-applies it on deploy). Auto-unequip WITHOUT a painless restore is pure friction and violates the sell-peace value, so decide it together with quickswap, not separately. (b) SCOPE: captain-centric (the preset follows the captain), ship-centric (per individual ship), or ship-CLASS-centric (one preset per class that applies to any ship of that class, since e.g. destroyers are upgraded versions of one another). (c) SNAPSHOT vs TEMPLATE: a ship-level preset can be a SNAPSHOT of specific installed instances (re-install these exact pieces), but a class-level preset must be a TEMPLATE keyed by gear TYPE/role (pull the best-available matching gear from the spare pool on apply), since it spans multiple ships. Template is richer and lower-friction (auto-pull) but more logic. DRIVING USE CASE: ROLE builds, e.g. a battleship "solo DPS" build vs a "team tank" build, swapped in one tap. LEAN (for discussion, not decided): class-level ROLE templates applied to a ship; captain-centric feels awkward because captains move between ships. Resolve when 0.13.1 presets are designed.
- **Threat/taunt weapon role + class CAPSTONE weapons (user 2026-08-26; FUTURE, downstream of MULTI-SHIP / group combat, currently deferred Tier B).** For future group combat: a THREAT-generation weapon role so a tank ship can pull enemy aggro off its group. Pointless in solo missions, imperative in multi-group. ANTI-META design (the user's key instinct, and it is the right one): do NOT make threat a stackable generic weapon, that homogenizes into "every tank runs 4x threat-cannon." Instead give each combat class a signature CAPSTONE weapon (equip-only-ONE, class-specific) and let the CAPSTONE carry the threat-generation boost (e.g. the battleship's capstone). Threat then comes from a single limited slot you build AROUND, which preserves build diversity and gives the class a tank IDENTITY instead of a copy-paste meta. Adds new weapon type(s) to the roster. Log for the weapon-roster + fleet-combat design; build order is after multi-ship combat exists.

- **iLevel calculation redesign: crafting-level range + variance talent (user 2026-08-26; fold into 0.13.1).** Refine computeItemLevel (currently `iLevel = min(craftingLevel + achievementBoost + faTalentBonus, blueprintTier*20)`, all boosts 0 today). Proposed model, all CRAFTING-LEVEL driven (explicitly NOT FA level, the-more-you-craft-the-better): the crafting level sets a CAP (level 1 -> cap 10; +2 per level, so cap = 8 + 2*level), and a crafted item ROLLS an iLevel in a RANGE below the cap (level 1 -> roll in ~[6, 10], width ~4-5). A crafting TALENT tightens that range by 25% per point (4 points = 0 range = you always craft at the cap, e.g. always iL 10 at level 1). Talent + achievement iLevel bonuses are FLAT ADDITIVE on top of the level-based roll (compute the level-based value first, THEN add the flat bonuses). OPEN FORKS to settle at design: (1) does the blueprintTier*20 cap STAY as an outer ceiling, or is iLevel now purely crafting-level-driven (which changes what recipe TIER means, a tier-1 recipe would scale with crafting level like any other)? (2) the iLevel ROLL adds a THIRD variance axis on top of the existing quality + rarity rolls, so early crafts get swingy: keep the variance-reduction talent EARLY-accessible so it does not read as RNG frustration (the sell-peace value). (3) +2/level is LINEAR (crafting level 50 -> cap ~108); confirm that curve or make it accelerate at high levels. Needs new crafting-talent-tree hooks (the range-reduction talent + flat-iLevel talents/achievements), which may not exist yet, so this is a crafting-progression rebalance, a touch meatier than pure QoL, but it fits the 0.13.1 post-combat bucket.

- **Warehouse floating tooltips + inline salvage (user 2026-08-26; 0.13.1 QoL / consistency).** Apply the shared floating-tooltip treatment (floatingTip.ts, built for the ship-systems panel + combat pips) to the WAREHOUSE "Ship Systems" / system-bay item tiles: tapping or hovering an item shows a floating, viewport-clamped EquipmentTooltip near the cursor, replacing the current click-to-select-then-inline-card pattern. Put a SALVAGE / DESTROY button INSIDE that tooltip with the full existing salvage logic (crafted -> salvage for materials; Standard-Issue baseline -> Destroy for zero, per salvage.ts), so the player salvages from where they SEE the items instead of only in the separate Salvage Bay facility. Consistency goal: the floating tooltip becomes the ONE item-detail pattern everywhere items are shown (panel, combat, warehouse). Reuses floatingTip.ts + EquipmentTooltip (preserve-unchanged) + salvage.ts. Pairs with the salvage-as-timed-queued entry. Downstream of the combat 1.0 debut.

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
