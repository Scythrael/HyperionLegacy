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

- **"Fleet Captain's" / "Fleet Operations" nav-tab label distinction.** Code review flagged during the
  2026-07-07 UI Redesign: both bottom-nav labels render as 10px, uppercase, letter-spaced text and
  share the same first word ("Fleet"), which could make them harder to tell apart at a glance,
  especially on a small screen. Not a bug — a copy/visual-design tweak — worth a pass (e.g. distinct
  leading words, an icon per tab, or a stronger visual differentiator) once there's real usage/feedback
  to design against, rather than guessing at a fix now.
