# Suggestions / Future Ideas

Ideas raised during development that aren't being built right now. Captured here so they survive
past the conversation they were mentioned in (Ops-style "write it down so you don't relitigate it" —
see KNOWN_ISSUES.md for actual bugs/gaps; this file is for not-yet-scoped future features).

- **Sector Space (Shipyard/Starbase).** Shelved mid-brainstorm in favor of the Captain & Homeworld
  Talent Trees. Shipyard would plausibly center on upgrading a captain's existing Vector-Fall Engine
  (reducing mission transit ticks) rather than building new ship hulls, given captains and ships are
  1:1 today. Starbase's whole described purpose (damaged/taken offline before a homeworld can be
  bombarded) needs Battlespace to exist first — fully deferred until then.

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
