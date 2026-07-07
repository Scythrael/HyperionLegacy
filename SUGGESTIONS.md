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

- **Header/layout changes.** Move the captain level bar to the top of the screen; shrink the "FLEET
  ADMIRAL" header/logo panel; put a captain info pane next to it; let panels use the full screen width
  instead of today's `max-width: 720px` constraint.

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
