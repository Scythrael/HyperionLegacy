# Salvaging (future feature) design notes

**Status:** NOTES, not a full design. Captured 2026-07-18 from a user brainstorm so the vision is not lost. Slots AFTER 0.11.0 (Legibility) and 0.11.1 (Material Lines); likely 0.11.2 or later. Gets its own design then plan then build cycle. These are the anchoring decisions to expand from.

## Core idea

Salvage items you no longer need for parts. NOT a flat percentage refund (boring). A VARIABLE, loot-table-driven system, modeled on the mission-loot system, so salvaging has its own roll and progression.

## Two salvage sources, two models

**1. Salvaging crafted EQUIPMENT (a ship system you do not need):**
- Returns a VARYING percentage of the crafting materials that went into it (refined materials + fabricated components).
- Base yield ~30-40%, UPGRADABLE via Fleet Admiral talents.
- Higher-quality items salvage for more / better.
- Variance, not a fixed number.

**2. Salvaging SALVAGED MATERIALS (a new item CATEGORY with its own Warehouse tab):**
- Salvaging one rolls from a rarity-tiered LOOT POOL: x% common, y% uncommon, and up the ladder, potentially to Radiant, possibly higher.
- First member: the **Damaged Reactor Housing** (formerly `intactReactorCore`, the rare Salvage-mission drop). Reclassified from "raw" to this new "salvaged material" category.
- Higher-quality salvaged items give better rolls / higher rarity ceilings.

## The salvage output pool can yield

- Refined materials
- Fabricated components
- EXCLUSIVE salvage-only materials: unique tech not obtainable anywhere else ("a wreck with tech you have never seen before"). These become ingredients for special / future recipes, which is what makes salvaging a MATERIAL SOURCE, not just a recycling bin.

## Progression

Fleet Admiral talents upgrade salvage yield percentage and/or the rarity odds of the roll.

## Controller design notes (to weigh at design time)

- The EXCLUSIVE-materials hook is the strongest idea here: it turns salvaging into a progression PILLAR (a source of things unobtainable elsewhere), not a boring refund. Lean into it.
- BALANCE CAUTION (economy integrity): a loot pool that can roll "up to Radiant, possibly higher" risks becoming the OPTIMAL way to get rare materials, undercutting missions and crafting. Design so salvage SUPPLEMENTS the economy (a sink for unwanted gear + a niche source of exclusives), not the dominant path to rares. Rarity odds should be steep, and the best exclusives should be genuinely niche.
- Two models means two code paths: equipment salvage (percentage material recovery) vs salvaged-material salvage (rarity loot roll). Confirm they stay distinct.

## Open questions for the real design pass

- Does salvaging DESTROY / consume the item? (assumed yes)
- Equipment salvage: strictly a percentage-of-materials return (with variance), or can it ALSO roll the loot pool? (user leans percentage-return)
- Exclusive salvage-only materials: which (future) recipes consume them? A dedicated "salvage tech" recipe branch, or scattered premium inputs?
- Rarity mapping: do salvaged materials carry the gear rarity ladder (Derelict..Radiant), or their own scale?
- Where does the salvage ACTION live: on each item in the Warehouse view (see the 0.11.0 Warehouse Ship Systems view, which is the surface it would attach to), a dedicated Salvage facility, or both?

## Ties to other work

- **Material Lines (0.11.1):** the Damaged Reactor Housing is reserved with a "salvageable for rare materials in a future update" tooltip. Salvaging activates it.
- **Legibility (0.11.0):** the Warehouse Ship Systems view is the surface a "salvage this" action would later attach to. The 0.11.0 view is read-only; salvaging adds the action.
