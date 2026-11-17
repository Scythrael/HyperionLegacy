# Research filter + Standard-Issue crew modules (0.14.0, short design)

Date: 2026-11-17. Two small changes from the user's QA, both for 0.14.0. Source of the user's words: docs/qa/2026-11-13-fable-sweep-ledger.md ("User request 2026-11-17: Research screen cleanup", "User report 2026-11-17: new ships built without ...").

## 1. Research tab search and filter

**Why.** User: "It's hard to keep track of things in there." The catalog grew from about 36 blueprints (prod) to about 85+ (0.14.0) in one long tier-grouped list with researched blueprints mixed in.

**Approaches considered.**
- Search and filter on the existing list. **Chosen by the user** ("For now, we can use the search/filter option").
- A research tech tree like the talent trees. The user leans toward it and will ask players first; a later release, not this change.
- A redesign of the card list. Not chosen.

**Decided by the user.**
- Filters: a search box, Status, Category, Tier (all four). Tier grouping stays.
- Completed research: a Settings toggle to show completed research projects. Off means researched blueprints are hidden from the Research tab list.

**My calls (the user can correct).**
- Placement: a filter bar at the top of the RESEARCH panel, under the order queue panel, above the tier groups.
- Search matches the blueprint name and the material names in its recipe (and the hull it unlocks for unlock-only blueprints). Case-insensitive, as you type.
- Status chips: All, Can research, In progress or queued, Locked. A Researched chip appears only while the Settings toggle shows completed research.
- Category chips: the research families the game already has (researchFamilyOf: Propulsion, Defense, Weapons, Systems, Field, Hull Design, Materials, Sensors).
- Tier chips: one per tier present, in Roman numerals.
- Each chip group picks one value at a time, with All as its default. Groups combine (AND).
- Undiscovered relic projects (masked cards) never leak: search matches only their visible mask text, and they count as Locked.
- Empty tier groups and shelves are hidden. When nothing matches: "No blueprints match these filters." with a Clear filters button.
- A small line says how many researched blueprints are hidden while the toggle is off, pointing at Settings.
- The filter choices are remembered between sessions, like the ship roster sort (shipRosterViewPreference.ts pattern). The Settings toggle defaults to off.
- Phone (375 px): each chip group wraps or scrolls sideways in its own row; the page never scrolls sideways.
- Display only: no engine rule changes, no save changes beyond the remembered view preference.

**Not doing.** The Fabricator's Craft tab has the same tier-grouped list; the same filter could be added there later (not asked).

```
RESEARCH                                   Research slots: 1 / 2 in use
[ Search blueprints or materials...          ]
Status   (All) Can research  In progress or queued  Locked
Category (All) Propulsion Defense Weapons Systems Field Hull Design ...
Tier     (All) I  II  III  IV
12 researched blueprints hidden (Settings > Show completed research)
Tier II ________________________________________________
[card] [card] ...
```

## 2. Standard-Issue Sensor Suite, Bridge Module and Crew Quarters

**Why.** User: "ships are not building with their sensor/bridge/crew quarters set up." Cause: a ship build seeds Standard-Issue only for the four economy slots (DEFAULT_EQUIPMENT_VARIETY) plus the combat set; the three 0.14.0 slots had no Standard-Issue piece, so every ship starts with them empty.

**Approaches considered.** Free basic set on all ships; free set on new builds only; keep empty and explain. **The user chose: free basic set, all ships, new and existing.**

**Design.**
- The Standard-Issue pieces: Sensor Suite = Balanced Array (sensorBalanced), Bridge Module = Balanced Command (bridgeBalancedCommand), Crew Quarters = Utilitarian Quarters (quartersUtilitarian), each at the Standard-Issue floor (Standard rarity, quality 0, the same generateStandardIssue shape as the economy slots).
- Seeded everywhere a ship is born: freshState, the shipBuild completion, the captain-slot hull grant.
- Existing saves: a one-time load migration installs the set into each ship's EMPTY bridge / quarters / sensor slot. It never replaces an installed module, and it runs once per save (a new optional save field), so a slot the player empties later stays empty.
- The slots stay allow-empty: uninstalling leaves the slot empty; the pieces declutter like other Standard-Issue gear.
- Crafted modules become upgrades: module effects scale with rarity and quality (moduleEffectScale), so the quality-0 floor is the weakest. Utilitarian Quarters' 12 berths do not scale, so a crafted Utilitarian adds no berths over Standard-Issue; its upgrade is the division lift.
- Effects: every ship gains the floor's officer lift, a modest division lift, 12 berths and Balanced Array scanning. Goldens move: traced with a switch fixture, every moved pin named. Help texts that say these slots start empty are updated with numbers from engine constants.

**Left to the builder.** Exact migration field name, the switch fixture, the order the three seed (deterministic), and which goldens move.
